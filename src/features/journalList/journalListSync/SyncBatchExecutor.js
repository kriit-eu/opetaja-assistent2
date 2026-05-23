/**
 * Per-assignment PUT loop. Given the batches from syncDataCollection,
 * execute each one against Tahvel and produce successful/failed lists.
 *
 * Responsibilities scoped to this module:
 *   - Fetch each assignment's entry data from Tahvel (with per-sync cache).
 *   - Resolve each student in the batch to a journalEntryStudents row.
 *   - Build the Tahvel PUT payload (student rows, assignment-level fields,
 *     Kriit homework link, capacity types, OPPURSTAATUS_K filtering).
 *   - Send the PUT.
 *   - On success: notify Kriit, flip banner status indicators, clear the
 *     corresponding in-memory difference entries.
 *   - On failure: push a failure record, flip banner indicators to red.
 *
 * Owns the per-sync caches (assignmentEntryCache, feature._localStudentCache).
 * Returns { successfulSyncs, failedSyncs }. No banner orchestration above
 * the per-batch level, no outcome-message construction — those belong to
 * syncOutcomeReporter.
 */

import Logger from '../../../services/Logger.js'
import { buildGradesForNotification, notifyKriitGradesSynced } from '../KriitSyncNotifier.js'

const BATCH_DELAY_MS = 500

async function fetchEntryData(feature, batch, cache) {
  const cacheKey = `${batch.journalId}::${batch.assignmentId}`
  let entryData = cache.get(cacheKey)
  if (entryData) return entryData

  const params = batch.students.length > 0 ? { allStudents: true } : {}
  entryData = await feature.api.tahvel.get(
    `/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`,
    params,
    { cache: false }
  )
  cache.set(cacheKey, entryData)
  return entryData
}

async function findStudentEntryByJournalStudentLookup(feature, entryData, personalCode, journalId) {
  const journalStudents = await feature.getJournalStudents(journalId)
  if (!journalStudents || journalStudents.length === 0) return null
  const match = journalStudents.find(js => js.student && String(js.student.idcode) === personalCode)
  if (!match) return null
  return (entryData.journalEntryStudents || []).find(e => String(e.journalStudent) === String(match.id)) || null
}

function buildGradeObject(targetGrade) {
  if (targetGrade === null) return null
  return {
    code: `KUTSEHINDAMINE_${targetGrade}`,
    gradingSchemaRowId: null,
    value: String(targetGrade),
    value2: String(targetGrade),
    extraval1: null,
    extraval2: null,
    nameEt: `Hinne ${targetGrade}`,
    nameEn: `Grade ${targetGrade}`,
    valid: true
  }
}

function buildNewStudentEntry(journalStudentId, targetGrade, addInfo) {
  return {
    id: null,
    journalStudent: Number(journalStudentId),
    absence: null,
    grade: buildGradeObject(targetGrade),
    verbalGrade: null,
    removeStudentHistory: true,
    addInfo,
    isLessonAbsence: false,
    hasOverlappingLessonAbsence: false,
    isPraise: false,
    isRemark: false,
    lessonAbsences: {},
    studentName: null,
    studentGroup: null,
    journalEntryStudentHistories: [],
    hasWholeDayAcceptedAbsence: false,
    wholeDayAbsenceCode: null,
    gradeValue: null
  }
}

async function resolveStudentsToUpdate(feature, entryData, batch) {
  const studentsToUpdate = []
  for (const s of batch.students) {
    const personalCode = String(s.studentPersonalCode)
    const targetGrade = s.grade === null ? null : String(s.grade)

    let studentEntry = await (async() => {
      // Strategy 1: scan entryData rows, match by cached personal code.
      for (const student of entryData.journalEntryStudents || []) {
        if (!student.journalStudent) continue
        const mappedId = feature.journalStudentIdToStudentId[student.journalStudent]
        let cachedStudent = mappedId ? feature._localStudentCache?.[mappedId] : null
        if (!cachedStudent) {
          cachedStudent = await feature.getCachedStudent(student.journalStudent)
          if (mappedId) {
            if (!feature._localStudentCache) feature._localStudentCache = {}
            feature._localStudentCache[mappedId] = cachedStudent
          }
        }
        if (cachedStudent && String(cachedStudent.personalCode) === personalCode) {
          return student
        }
      }
      // Strategy 2: lookup via journalStudents.
      return findStudentEntryByJournalStudentLookup(feature, entryData, personalCode, batch.journalId)
    })()

    let finalStudentEntry
    if (studentEntry) {
      finalStudentEntry = { ...studentEntry, grade: buildGradeObject(targetGrade), removeStudentHistory: true }
    } else {
      const info = await feature.getDetailedStudentInfo(personalCode, batch.journalId)
      if (!info || !info.journalStudentId) {
        throw new Error(`Could not find journalStudentId for personal code ${personalCode} in journal ${batch.journalId}`)
      }
      const addInfo = feature.getAddInfoFromExistingStudents(entryData.journalEntryStudents)
      finalStudentEntry = buildNewStudentEntry(info.journalStudentId, targetGrade, addInfo)
    }

    const cachedForName = studentEntry
      ? await feature.getCachedStudent(studentEntry.journalStudent)
      : await feature.getCachedStudent(finalStudentEntry.journalStudent)
    const studentName = cachedForName ? cachedForName.name : studentEntry ? studentEntry.studentName : 'Unknown'
    const studentPersonal = cachedForName ? cachedForName.personalCode : personalCode

    studentsToUpdate.push({ ...finalStudentEntry, studentName, studentPersonalCode: studentPersonal })
  }
  return studentsToUpdate
}

function buildKriitHomeworkLink(feature, batch) {
  let kriitBaseUrl = (feature.api.kriit.baseUrl || '').replace(/\/$/, '')
  kriitBaseUrl = kriitBaseUrl.replace(/\/api$/, '')

  const subject = Array.isArray(feature.differences)
    ? feature.differences.find(s => s.subjectExternalId === batch.journalId)
    : null
  const groupCode = subject ? subject.groupName || '' : ''

  const kriitAssignmentUrl = `${kriitBaseUrl}/assignments/${batch.assignmentId}${groupCode ? `?group=${encodeURIComponent(groupCode)}` : ''}`
  return kriitAssignmentUrl ? `Link ülesandele: ${kriitAssignmentUrl}` : 'Link ülesandele: puudub'
}

function applyAssignmentLevelFieldsToPayload(feature, batch, updateData) {
  for (const { field, value } of feature.getAssignmentLevelBatchChanges(batch)) {
    if (field.batchKey === 'homeworkDuedate') {
      const due = feature.normalizeTahvelDueDate(value)
      updateData.homeworkDuedate = due
      batch.homeworkDuedate = due
    } else if (field.batchKey === 'entryDate') {
      let entryDate = value
      if (typeof entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        entryDate = `${entryDate}T00:00:00Z`
      }
      updateData.entryDate = entryDate
      batch.entryDate = entryDate
    } else {
      updateData[field.batchKey] = value
    }
  }
}

function applyCapacityTypes(feature, updateData, entryData) {
  const finalEntryType = updateData.entryType || entryData.entryType
  if (finalEntryType === 'SISSEKANNE_I') {
    updateData.journalEntryCapacityTypes = ['MAHT_i']
    if (!updateData.homeworkDuedate && updateData.entryDate) {
      updateData.homeworkDuedate = feature.normalizeTahvelDueDate(updateData.entryDate)
    }
  } else if (finalEntryType === 'SISSEKANNE_H') {
    updateData.journalEntryCapacityTypes = ['MAHT_h']
  } else if (finalEntryType === 'SISSEKANNE_P') {
    updateData.journalEntryCapacityTypes = []
  }
}

async function filterOutDeletedStudents(feature, updateData) {
  if (!Array.isArray(updateData.journalEntryStudents)) return
  const promises = updateData.journalEntryStudents.map(async student => {
    const journalStudentId = student.journalStudent
    if (!journalStudentId) return student
    const studentId = feature.journalStudentIdToStudentId[journalStudentId]
    if (!studentId) return student
    try {
      const studentDetails = await feature.getStudentDetails(studentId)
      if (studentDetails && studentDetails.status === 'OPPURSTAATUS_K') return null
    } catch (err) {
      Logger.warning(`Failed to get student details for ${studentId}: ${err.message}`)
    }
    return student
  })
  updateData.journalEntryStudents = (await Promise.all(promises)).filter(Boolean)
}

async function buildUpdatePayload(feature, entryData, batch, studentsToUpdate, isAssignmentLevelOnly) {
  const updateData = isAssignmentLevelOnly
    ? feature.buildAssignmentLevelUpdatePayload(entryData)
    : { ...entryData }

  if (isAssignmentLevelOnly) {
    // Tahvel's metadata-only contract is journalEntryStudents: []. Omitting
    // the field returns 500, while resending old/inactive rows can return 412.
    Logger.debug(`📋 Assignment-level only update: not resubmitting ${entryData.journalEntryStudents?.length || 0} existing students`)
  } else {
    updateData.journalEntryStudents = studentsToUpdate.map(s => ({ ...s }))
  }

  applyAssignmentLevelFieldsToPayload(feature, batch, updateData)

  if (batch.assignmentId) {
    updateData.homework = buildKriitHomeworkLink(feature, batch)
    Logger.debug(`📋 Added assignment link to homework field: ${updateData.homework}`)
  }

  if (Array.isArray(updateData.journalEntryTeachers)) {
    updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
  }

  applyCapacityTypes(feature, updateData, entryData)
  await filterOutDeletedStudents(feature, updateData)

  return updateData
}

async function flipBannerStatuses(feature, batch, studentsToUpdate, isSynced) {
  try {
    const { journalSyncBannerService } = await import('../JournalSyncBanner.js')
    feature.updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, isSynced)
    for (const s of studentsToUpdate) {
      const studentCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
      if (studentCode) {
        journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, 'grade', isSynced, studentCode)
      }
    }
  } catch (err) {
    Logger.warning(`Failed to update ${isSynced ? '' : 'failure '}UI status indicators: ${err.message}`)
  }
}

function clearSyncedDiffEntries(feature, batch, studentsToUpdate) {
  try {
    if (!Array.isArray(feature.differences)) return
    const subject = feature.differences.find(s => s.subjectExternalId === batch.journalId)
    if (!subject || !Array.isArray(subject.assignments)) return
    const assignmentObj = subject.assignments.find(a => a.assignmentExternalId === batch.assignmentId)
    if (!assignmentObj) return

    feature.applyAssignmentLevelChangesToDifference(assignmentObj, batch)
    if (!Array.isArray(assignmentObj.results)) return

    for (const s of studentsToUpdate) {
      const targetCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
      const match = assignmentObj.results.find(r => {
        const rc = r.studentPersonalCode ? String(r.studentPersonalCode) : ''
        const exactMatch = rc === targetCode
        const targetLast8 = targetCode ? String(targetCode).slice(-8) : null
        const rcLast8 = rc ? String(rc).slice(-8) : null
        const last8Match = targetLast8 && rcLast8 && rcLast8 === targetLast8
        let nameMatch = false
        if (r.studentName && s.studentName) {
          try {
            nameMatch = r.studentName.toLowerCase().includes(s.studentName.toLowerCase())
          } catch (e) {
            nameMatch = false
          }
        }
        return exactMatch || last8Match || nameMatch
      })
      if (match) {
        match.currentGrade = s.grade?.value || s.grade || (s.gradeValue ? s.gradeValue : null)
      }
    }
  } catch (err) {
    Logger.warning(`Failed to update in-memory differences after batch PUT ${batch.assignmentId}: ${err.message}`)
  }
}

async function executeBatch(feature, batch, assignmentEntryCache) {
  let studentsToUpdate = []
  let entryData = null
  try {
    entryData = await fetchEntryData(feature, batch, assignmentEntryCache)
    if (!entryData) {
      throw new Error(`No entry data for journal ${batch.journalId} assignment ${batch.assignmentId}`)
    }

    studentsToUpdate = await resolveStudentsToUpdate(feature, entryData, batch)

    const isAssignmentLevelOnly = batch.assignmentLevelOnly === true
    const hasStudentUpdates = studentsToUpdate.length > 0
    const hasAssignmentUpdates = feature.getAssignmentLevelBatchChanges(batch).length > 0

    if (!hasStudentUpdates && !isAssignmentLevelOnly) {
      Logger.debug(`No student updates required for assignment ${batch.assignmentId}`)
      return { success: { journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true } }
    }
    if (isAssignmentLevelOnly && !hasAssignmentUpdates) {
      Logger.debug(`Assignment-level only batch ${batch.assignmentId} has no actual assignment changes`)
      return { success: { journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true } }
    }

    const updateData = await buildUpdatePayload(feature, entryData, batch, studentsToUpdate, isAssignmentLevelOnly)

    if (Logger.isDebugMode()) {
      Logger.debug(`PUT /journals/${batch.journalId}/journalEntry/${batch.assignmentId} payload: ${JSON.stringify(updateData)}`)
    }
    await feature.api.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, updateData)

    if (!isAssignmentLevelOnly && studentsToUpdate.length > 0) {
      const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, studentsToUpdate)
      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(feature.api, syncedGrades)
      }
    }

    const success = isAssignmentLevelOnly
      ? { journalId: batch.journalId, assignmentId: batch.assignmentId, assignmentLevelUpdated: true, updated: 0 }
      : { journalId: batch.journalId, assignmentId: batch.assignmentId, updated: studentsToUpdate.length }
    Logger.debug(
      isAssignmentLevelOnly
        ? `✅ Assignment-level update successful: ${batch.journalId}/${batch.assignmentId}`
        : `✅ Student grade updates successful: ${studentsToUpdate.length} students in ${batch.journalId}/${batch.assignmentId}`
    )

    await flipBannerStatuses(feature, batch, studentsToUpdate, true)
    clearSyncedDiffEntries(feature, batch, studentsToUpdate)

    return { success }
  } catch (err) {
    Logger.error(`Failed to PUT assignment ${batch.assignmentId} in journal ${batch.journalId}: ${err.message}`)
    await flipBannerStatuses(feature, batch, studentsToUpdate, false)
    return {
      failure: {
        journalId: batch.journalId,
        assignmentId: batch.assignmentId,
        assignmentName: entryData?.nameEt,
        types: feature.getSyncFailureTypes(batch, studentsToUpdate.length > 0),
        status: feature.getApiErrorStatus(err),
        error: err.message
      }
    }
  }
}

export async function executeBatches(feature, batches) {
  const assignmentEntryCache = new Map()
  if (!feature._localStudentCache) feature._localStudentCache = {}

  const successfulSyncs = []
  const failedSyncs = []

  feature.updateProgressUI(0, batches.length)

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]
    if (Logger.isDebugMode()) {
      Logger.debug(`Processing assignment batch ${bi + 1}/${batches.length}: ${batch.journalId} / ${batch.assignmentId}`)
    }

    try {
      const { success, failure } = await executeBatch(feature, batch, assignmentEntryCache)
      if (success) successfulSyncs.push(success)
      if (failure) failedSyncs.push(failure)
    } catch (err) {
      // Outer catch — should not normally trigger since executeBatch catches internally.
      Logger.error(`Error processing assignment batch ${batch.journalId}/${batch.assignmentId}: ${err.message}`)
      failedSyncs.push({
        journalId: batch.journalId,
        assignmentId: batch.assignmentId,
        assignmentName: batch.nameEt,
        types: feature.getSyncFailureTypes(batch, batch.students.length > 0),
        status: feature.getApiErrorStatus(err),
        error: err.message
      })
    }

    try {
      feature.updateProgressUI(bi + 1, batches.length)
    } catch (err) {
      Logger.warning(`Progress UI update failed for batch ${bi}: ${err.message}`)
    }

    if (bi < batches.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  return { successfulSyncs, failedSyncs }
}
