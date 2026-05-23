/**
 * Grade + assignment-level sync from Kriit → Tahvel.
 *
 *  - syncWithKriit: builds per-assignment batches from feature.differences,
 *    fires one PUT per batch, updates banner statuses, refreshes the in-memory
 *    diff after success, and finally reports per-batch successes/failures.
 *  - syncGradeToTahvel: legacy single-student PUT path (kept for the few
 *    tests + callers that still target it).
 *
 * Both take the feature instance because they read/write feature.differences,
 * feature.isLoading, feature.error, feature.journalStudentIdToStudentId,
 * feature._localStudentCache, feature._assignmentEntryCache, and they reach
 * into feature.* wrappers for studentDataPipeline / assignmentLevelSync /
 * tahvelDataFetchers / banner helpers.
 */

import Logger from '../../../services/Logger.js'
import { buildGradesForNotification, notifyKriitGradesSynced } from '../KriitSyncNotifier.js'

export async function syncWithKriit(feature) {
  if (Array.isArray(feature.differences)) {
    feature.differences.forEach(subject => {
      if (Array.isArray(subject.assignments)) {
        subject.assignments.forEach(assignment => {
          if (Array.isArray(assignment.results)) {
            assignment.results.forEach(() => {})
          }
        })
      }
    })
  }
  Logger.debug('[SYNC] Mapping journalStudentIdToStudentId:', JSON.stringify(feature.journalStudentIdToStudentId))
  if (feature.journalStudentIdToStudentId) {
    Object.entries(feature.journalStudentIdToStudentId).forEach(([journalStudentId, studentId]) => {
      Logger.debug(`[SYNC] journalStudentId ${journalStudentId} -> studentId ${studentId}`)
    })
  }
  if (feature.globalTeacherCache) {
    Logger.debug('[SYNC] Teacher cache:', JSON.stringify(feature.globalTeacherCache))
  }
  Logger.debug(`[${feature.name}] Syncing with Kriit...`)

  if (feature.isLoading) {
    Logger.warning('Sync already in progress, ignoring new sync request')
    return
  }

  // Per-sync caches keyed inside this function — assignmentEntryCache caches
  // /journals/:journalId/journalEntry/:assignmentId responses across batches.
  const assignmentEntryCache = new Map()

  // localStudentCache: cache student details fetched during this sync to avoid repeated API/cacheService calls
  if (!feature._localStudentCache) feature._localStudentCache = {}

  try {
    if (!feature.differences || !Array.isArray(feature.differences) || feature.differences.length === 0) {
      Logger.debug('No differences to sync')
      return
    }

    const syncData = []
    if (Logger.isDebugMode()) {
      Logger.debug('=== COLLECTING SYNC DATA ===')
      Logger.debug(`Processing ${feature.differences ? feature.differences.length : 0} subjects with differences`)
    }

    feature.differences.forEach((subject, subjectIndex) => {
      if (Logger.isDebugMode()) {
        Logger.debug(`Subject ${subjectIndex + 1}: ${subject.subjectName} (ID: ${subject.subjectExternalId})`)
      }

      if (!subject.assignments || !Array.isArray(subject.assignments)) {
        Logger.warning(`⚠️ Subject ${subjectIndex + 1}: No assignments array`)
        return
      }

      if (Logger.isDebugMode()) {
        Logger.debug(`  - Has ${subject.assignments.length} assignments`)
      }
      subject.assignments.forEach((assignment, assignmentIndex) => {
        if (Logger.isDebugMode()) {
          Logger.debug(`  Assignment ${assignmentIndex + 1}: ${assignment.assignmentName} (ID: ${assignment.assignmentExternalId})`)
        }

        if (!assignment.results || !Array.isArray(assignment.results)) {
          Logger.debug(`⚠️ Assignment ${assignmentIndex + 1}: No results array`)
          return
        }

        if (Logger.isDebugMode()) {
          Logger.debug(`    - Has ${assignment.results.length} results`)
        }
        assignment.results.forEach((result, resultIndex) => {
          Logger.debug(
            `    Result ${resultIndex + 1}: ${result.studentName} | PersonalCode: "${result.studentPersonalCode}" | CurrentGrade: "${result.currentGrade}" | NewGrade: "${result.grade}"`
          )

          if (!result.studentPersonalCode) {
            Logger.error(`❌ Result ${resultIndex + 1}: Missing personal code - cannot proceed with sync`)
            const errorMsg = 'Found missing personal code for a student - cannot proceed with sync'
            Logger.error(errorMsg)
            feature.error = errorMsg
            throw new Error(errorMsg)
          }

          if (result.studentIsDeleted === true) {
            if (Logger.isDebugMode()) {
              Logger.debug(
                `⏭️ Result ${resultIndex + 1}: Skipping grade sync for deleted student: ${result.studentName} (${result.studentPersonalCode})`
              )
            }
            return
          }

          if (typeof result.studentPersonalCode === 'string' && result.studentPersonalCode.includes('fallback-')) {
            const errorMsg = `Found invalid personal code: ${result.studentPersonalCode} - cannot proceed with sync`
            Logger.error(errorMsg)
            feature.error = errorMsg
            throw new Error(errorMsg)
          }

          const normalizeGrade = grade => {
            if (grade === null || grade === undefined || grade === '' || grade === '(puudub)') {
              return null
            }
            const normalized = String(grade).trim()
            if (normalized.startsWith('KUTSEHINDAMINE_')) {
              return normalized.replace('KUTSEHINDAMINE_', '')
            }
            return normalized
          }

          const tahvelGrade = normalizeGrade(result.currentGrade)
          const kriitGrade = normalizeGrade(result.grade)

          Logger.debug(`    Grade comparison: Tahvel="${tahvelGrade}" vs Kriit="${kriitGrade}"`)

          if (tahvelGrade !== kriitGrade) {
            if (Logger.isDebugMode()) {
              Logger.debug(`✅ Result ${resultIndex + 1}: Grade sync needed`)
            }
            Logger.debug(`Student personal code type: ${typeof result.studentPersonalCode}, value: "${result.studentPersonalCode}"`)
            Logger.debug(`Grade type: ${typeof result.grade}, value: "${result.grade}"`)
            Logger.debug(`Will sync: Tahvel="${tahvelGrade}" -> Kriit="${kriitGrade}"`)

            const personalCode = result.studentPersonalCode ? String(result.studentPersonalCode) : null
            const gradeStr = result.grade === null ? null : result.grade === undefined ? undefined : String(result.grade)

            if (!personalCode || gradeStr === undefined) {
              Logger.warning(`⚠️ Result ${resultIndex + 1}: Skipping sync item due to missing data: personalCode="${personalCode}", grade="${gradeStr}"`)
              return
            }

            const syncItem = {
              journalId: subject.subjectExternalId,
              assignmentId: assignment.assignmentExternalId,
              studentPersonalCode: personalCode,
              grade: gradeStr
            }

            syncData.push(syncItem)
            if (Logger.isDebugMode()) {
              Logger.debug(`📤 Added to sync queue: ${result.studentName} (${personalCode}) -> Grade ${gradeStr}`)
            }
          } else {
            Logger.debug(`⏭️ Result ${resultIndex + 1}: Grades are the same, skipping: Tahvel="${tahvelGrade}", Kriit="${kriitGrade}"`)
          }
        })
      })
    })

    if (Logger.isDebugMode()) {
      Logger.debug(`=== SYNC DATA COLLECTION COMPLETE: ${syncData.length} items to sync ===`)
    }

    const assignmentLevelFields = feature.getAssignmentLevelSyncFields()
    const assignmentLevelDifferences = []
    if (feature.differences && Array.isArray(feature.differences)) {
      feature.differences.forEach(subject => {
        if (subject.assignments && Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            const changes = feature.getAssignmentLevelChanges(assignment, assignmentLevelFields)

            if (changes.length > 0) {
              assignmentLevelDifferences.push({
                journalId: subject.subjectExternalId,
                assignmentId: assignment.assignmentExternalId,
                changes
              })
              Logger.debug(
                `📋 Found assignment-level difference: ${assignment.assignmentName?.kriit || assignment.assignmentName?.Tahvel || assignment.assignmentExternalId} (${changes.map(change => change.field.statusType).join(', ')})`
              )
            }
          })
        }
      })
    }

    if (syncData.length === 0 && assignmentLevelDifferences.length === 0) {
      Logger.warning('No data to sync after processing')
      Logger.debug('=== SYNC STATUS CHECK ===')
      Logger.debug('syncData is empty and no assignment-level differences found')
      Logger.debug(`Original differences count: ${feature.differences ? feature.differences.length : 0}`)

      feature.isLoading = false
      const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
      if (globalNewAssignments && Object.keys(globalNewAssignments).length > 0) {
        feature.error = null
        feature.updateUI()
        return
      }
      feature.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
      feature.updateUI()
      return
    }

    Logger.debug('=== SYNC DATA TO PROCESS ===')
    Logger.debug(`Found ${syncData.length} grade differences to sync`)
    Logger.debug(`Found ${assignmentLevelDifferences.length} assignment-level differences to sync`)
    if (syncData.length > 0) {
      Logger.debug(`Grade differences to sync: ${JSON.stringify(syncData, null, 2)}`)
    }
    if (assignmentLevelDifferences.length > 0) {
      Logger.debug(`Assignment-level differences to sync: ${JSON.stringify(assignmentLevelDifferences, null, 2)}`)
    }

    feature.isLoading = true
    feature.updateUI()

    const successfulSyncs = []
    const failedSyncs = []

    try {
      const assignmentMap = new Map()

      for (const item of syncData) {
        const key = `${item.journalId}::${item.assignmentId}`
        if (!assignmentMap.has(key)) {
          assignmentMap.set(key, {
            journalId: item.journalId,
            assignmentId: item.assignmentId,
            students: [],
            assignmentLevelOnly: false
          })
        }
        assignmentMap.get(key).students.push({ studentPersonalCode: item.studentPersonalCode, grade: item.grade })
      }

      for (const assignmentDiff of assignmentLevelDifferences) {
        const key = `${assignmentDiff.journalId}::${assignmentDiff.assignmentId}`
        if (!assignmentMap.has(key)) {
          assignmentMap.set(key, {
            journalId: assignmentDiff.journalId,
            assignmentId: assignmentDiff.assignmentId,
            students: [],
            assignmentLevelOnly: true
          })
          Logger.debug(`📋 Added assignment-level only batch: ${assignmentDiff.journalId}/${assignmentDiff.assignmentId}`)
        }

        const batch = assignmentMap.get(key)
        for (const { field, value } of assignmentDiff.changes) {
          batch[field.batchKey] = value
        }
      }

      const batches = Array.from(assignmentMap.values())
      feature.updateProgressUI(0, batches.length)

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi]
        if (Logger.isDebugMode()) Logger.debug(`Processing assignment batch ${bi + 1}/${batches.length}: ${batch.journalId} / ${batch.assignmentId}`)

        try {
          const entryCacheKey = `${batch.journalId}::${batch.assignmentId}`
          let entryData = assignmentEntryCache.get(entryCacheKey)
          if (!entryData) {
            const params = batch.students.length > 0 ? { allStudents: true } : {}
            entryData = await feature.api.tahvel.get(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, params, { cache: false })
            assignmentEntryCache.set(entryCacheKey, entryData)
          }

          if (!entryData) {
            throw new Error(`No entry data for journal ${batch.journalId} assignment ${batch.assignmentId}`)
          }

          const studentsToUpdate = []
          for (const s of batch.students) {
            const personalCode = String(s.studentPersonalCode)
            const targetGrade = s.grade === null ? null : String(s.grade)

            let studentEntry = null
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
                studentEntry = student
                break
              }
            }

            if (!studentEntry) {
              const journalStudents = await feature.getJournalStudents(batch.journalId)
              if (journalStudents && journalStudents.length > 0) {
                const match = journalStudents.find(js => js.student && String(js.student.idcode) === personalCode)
                if (match) {
                  const potential = (entryData.journalEntryStudents || []).find(e => String(e.journalStudent) === String(match.id))
                  if (potential) studentEntry = potential
                }
              }
            }

            let finalStudentEntry = null
            if (studentEntry) {
              finalStudentEntry = { ...studentEntry }
              if (targetGrade === null) {
                finalStudentEntry.grade = null
              } else {
                finalStudentEntry.grade = {
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
              finalStudentEntry.removeStudentHistory = true
            } else {
              const info = await feature.getDetailedStudentInfo(personalCode, batch.journalId)
              if (!info || !info.journalStudentId) {
                throw new Error(`Could not find journalStudentId for personal code ${personalCode} in journal ${batch.journalId}`)
              }
              finalStudentEntry = {
                id: null,
                journalStudent: Number(info.journalStudentId),
                absence: null,
                grade:
                  targetGrade === null
                    ? null
                    : {
                        code: `KUTSEHINDAMINE_${targetGrade}`,
                        gradingSchemaRowId: null,
                        value: String(targetGrade),
                        value2: String(targetGrade),
                        extraval1: null,
                        extraval2: null,
                        nameEt: `Hinne ${targetGrade}`,
                        nameEn: `Grade ${targetGrade}`,
                        valid: true
                      },
                verbalGrade: null,
                removeStudentHistory: true,
                addInfo: feature.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
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

            let cachedForName = null
            if (studentEntry) {
              cachedForName = await feature.getCachedStudent(studentEntry.journalStudent)
            } else {
              cachedForName = await feature.getCachedStudent(finalStudentEntry.journalStudent)
            }
            const studentName = cachedForName ? cachedForName.name : studentEntry ? studentEntry.studentName : 'Unknown'
            const studentPersonal = cachedForName ? cachedForName.personalCode : personalCode

            studentsToUpdate.push({ ...finalStudentEntry, studentName, studentPersonalCode: studentPersonal })
          }

          const isAssignmentLevelOnly = batch.assignmentLevelOnly === true
          const hasStudentUpdates = studentsToUpdate.length > 0
          const hasAssignmentUpdates = feature.getAssignmentLevelBatchChanges(batch).length > 0

          if (!hasStudentUpdates && !isAssignmentLevelOnly) {
            Logger.debug(`No student updates required for assignment ${batch.assignmentId}`)
            successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true })
            feature.updateProgressUI(bi + 1, batches.length)
            continue
          }

          if (isAssignmentLevelOnly && !hasAssignmentUpdates) {
            Logger.debug(`Assignment-level only batch ${batch.assignmentId} has no actual assignment changes`)
            successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, skipped: true })
            feature.updateProgressUI(bi + 1, batches.length)
            continue
          }

          const updateData = isAssignmentLevelOnly ? feature.buildAssignmentLevelUpdatePayload(entryData) : { ...entryData }

          if (isAssignmentLevelOnly) {
            // Tahvel's metadata-only contract is journalEntryStudents: []. Omitting
            // the field returns 500, while resending old/inactive rows can return 412.
            Logger.debug(`📋 Assignment-level only update: not resubmitting ${entryData.journalEntryStudents?.length || 0} existing students`)
          } else {
            updateData.journalEntryStudents = studentsToUpdate.map(s => ({ ...s }))
          }

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

          if (batch.assignmentId) {
            let kriitBaseUrl = (feature.api.kriit.baseUrl || '').replace(/\/$/, '')
            kriitBaseUrl = kriitBaseUrl.replace(/\/api$/, '')

            const subject =
              feature.differences && Array.isArray(feature.differences) ? feature.differences.find(s => s.subjectExternalId === batch.journalId) : null
            const groupCode = subject ? subject.groupName || '' : ''

            const kriitAssignmentUrl = `${kriitBaseUrl}/assignments/${batch.assignmentId}${groupCode ? `?group=${encodeURIComponent(groupCode)}` : ''}`
            const homeworkText = kriitAssignmentUrl ? `Link ülesandele: ${kriitAssignmentUrl}` : 'Link ülesandele: puudub'

            updateData.homework = homeworkText
            Logger.debug(`📋 Added assignment link to homework field: ${homeworkText}`)
          }

          if (Array.isArray(updateData.journalEntryTeachers)) {
            updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
          }
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

          if (Array.isArray(updateData.journalEntryStudents)) {
            const studentPromises = updateData.journalEntryStudents.map(async student => {
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
            updateData.journalEntryStudents = (await Promise.all(studentPromises)).filter(Boolean)
          }

          try {
            if (Logger.isDebugMode())
              Logger.debug(`PUT /journals/${batch.journalId}/journalEntry/${batch.assignmentId} payload: ${JSON.stringify(updateData)}`)
            await feature.api.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, updateData)

            if (!isAssignmentLevelOnly && studentsToUpdate.length > 0) {
              const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, studentsToUpdate)
              if (syncedGrades.length > 0) {
                await notifyKriitGradesSynced(feature.api, syncedGrades)
              }
            }

            if (isAssignmentLevelOnly) {
              successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, assignmentLevelUpdated: true, updated: 0 })
              Logger.debug(`✅ Assignment-level update successful: ${batch.journalId}/${batch.assignmentId}`)
            } else {
              successfulSyncs.push({ journalId: batch.journalId, assignmentId: batch.assignmentId, updated: studentsToUpdate.length })
              Logger.debug(`✅ Student grade updates successful: ${studentsToUpdate.length} students in ${batch.journalId}/${batch.assignmentId}`)
            }

            try {
              const { journalSyncBannerService } = await import('../JournalSyncBanner.js')

              feature.updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, true)

              for (const s of studentsToUpdate) {
                const studentCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
                if (studentCode) {
                  journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, 'grade', true, studentCode)
                }
              }
            } catch (err) {
              Logger.warning(`Failed to update UI status indicators: ${err.message}`)
            }

            try {
              if (Array.isArray(feature.differences)) {
                const subject = feature.differences.find(s => s.subjectExternalId === batch.journalId)
                if (subject && Array.isArray(subject.assignments)) {
                  const assignmentObj = subject.assignments.find(a => a.assignmentExternalId === batch.assignmentId)
                  if (assignmentObj) {
                    feature.applyAssignmentLevelChangesToDifference(assignmentObj, batch)
                    if (Array.isArray(assignmentObj.results)) {
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
                    }
                  }
                }
              }
            } catch (err) {
              Logger.warning(`Failed to update in-memory differences after batch PUT ${batch.assignmentId}: ${err.message}`)
            }
          } catch (err) {
            Logger.error(`Failed to PUT assignment ${batch.assignmentId} in journal ${batch.journalId}: ${err.message}`)
            failedSyncs.push({
              journalId: batch.journalId,
              assignmentId: batch.assignmentId,
              assignmentName: entryData?.nameEt,
              types: feature.getSyncFailureTypes(batch, studentsToUpdate.length > 0),
              status: feature.getApiErrorStatus(err),
              error: err.message
            })

            try {
              const { journalSyncBannerService } = await import('../JournalSyncBanner.js')

              feature.updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, false)

              for (const s of studentsToUpdate) {
                const studentCode = s.studentPersonalCode ? String(s.studentPersonalCode) : null
                if (studentCode) {
                  journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, 'grade', false, studentCode)
                }
              }
            } catch (updateErr) {
              Logger.warning(`Failed to update failure UI status indicators: ${updateErr.message}`)
            }
          }

          try {
            feature.updateProgressUI(bi + 1, batches.length)
          } catch (err) {
            Logger.warning(`Progress UI update failed for batch ${bi}: ${err.message}`)
          }
        } catch (err) {
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

        if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 500))
      }

      const actualUpdates = successfulSyncs.reduce((acc, s) => acc + (s.updated || 0), 0)
      const assignmentLevelUpdates = successfulSyncs.filter(s => s.assignmentLevelUpdated).length
      const skippedUpdates = successfulSyncs.filter(s => s.skipped).length

      const assignmentLevelCounts = new Map(
        feature.getAssignmentLevelSyncFields().map(field => [field.statusType, { count: 0, label: field.successLabel }])
      )
      for (const batch of batches) {
        if (successfulSyncs.some(s => s.journalId === batch.journalId && s.assignmentId === batch.assignmentId)) {
          for (const { field } of feature.getAssignmentLevelBatchChanges(batch)) {
            const item = assignmentLevelCounts.get(field.statusType)
            if (item) item.count++
          }
        }
      }

      const successfulChangeCount = feature.countSuccessfulSyncChanges(successfulSyncs, batches)
      feature.isLoading = false
      if (failedSyncs.length === 0) {
        let successMessage = ''

        if (actualUpdates > 0 || assignmentLevelUpdates > 0) {
          const parts = []
          if (actualUpdates > 0) {
            parts.push(`${actualUpdates} hinnet`)
          }
          for (const { count, label } of assignmentLevelCounts.values()) {
            if (count > 0) parts.push(`${count} ${label}`)
          }

          if (parts.length > 0) {
            successMessage = `Edukalt sünkroniseeritud ${parts.join(', ')} Kriidist Tahvlisse.`
          } else {
            successMessage = `Edukalt sünkroniseeritud Kriidist Tahvlisse.`
          }

          if (skippedUpdates > 0) successMessage += ` ${skippedUpdates} kirjet olid juba õiged.`
          successMessage += ` Andmed värskendatakse automaatselt mõne sekundi pärast...`
        } else {
          successMessage = `Kõik ${successfulSyncs.length} kirjet olid juba õiged - pole midagi sünkroniseerida.`
        }
        feature.showSuccessBanner(successMessage)

        setTimeout(() => {
          feature.clearCache()
            .then(() => feature.fetchJournalData())
            .catch(() => feature.fetchJournalData())
        }, 3000)
      } else {
        feature.error = feature.buildSyncFailureMessage(failedSyncs, successfulChangeCount)
        feature.updateUI()
        return { successfulSyncs, failedSyncs, successfulChangeCount }
      }
      return { successfulSyncs, failedSyncs, successfulChangeCount }
    } catch (error) {
      Logger.error('Unexpected error during batch sync process:', error)
      feature.isLoading = false
      feature.error = 'Sünkroniseerimine ebaõnnestus ootamatu vea tõttu.'
      feature.updateUI()
      return { successfulSyncs, failedSyncs: [{ status: feature.getApiErrorStatus(error), error: error.message }] }
    }
  } catch (error) {
    Logger.error('Error syncing with Kriit:', error)
    feature.isLoading = false
    feature.error = error.message || 'Failed to sync with Kriit'
    feature.updateUI()
    return { successfulSyncs: [], failedSyncs: [{ status: feature.getApiErrorStatus(error), error: error.message }] }
  }
}

export async function syncGradeToTahvel(feature, journalId, assignmentId, studentPersonalCode, grade) {
  try {
    Logger.debug('=== STARTING GRADE SYNC ===')
    if (Logger.isDebugMode()) {
      Logger.debug(`Syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}`)
    }
    Logger.debug(
      `Full sync parameters: journalId=${journalId}, assignmentId=${assignmentId}, studentPersonalCode=${studentPersonalCode}, grade=${grade}`
    )

    if (!journalId) throw new Error('Journal ID is required for syncing grades')
    if (!assignmentId) throw new Error('Assignment ID is required for syncing grades')
    if (!studentPersonalCode) throw new Error('Student personal code is required for syncing grades')

    if (typeof studentPersonalCode !== 'string') {
      Logger.debug(`Converting studentPersonalCode from ${typeof studentPersonalCode} to string: ${studentPersonalCode}`)
      studentPersonalCode = String(studentPersonalCode)
    }

    Logger.debug(`Checking if student ${studentPersonalCode} is active before sync...`)

    let studentCacheEntry = null
    const journalStudentsForValidation = await feature.getJournalStudents(journalId)

    if (journalStudentsForValidation) {
      for (const journalStudent of journalStudentsForValidation) {
        if (journalStudent.student && journalStudent.student.idcode === studentPersonalCode) {
          studentCacheEntry = {
            personalCode: journalStudent.student.idcode,
            name: journalStudent.student.fullname || journalStudent.studentName,
            isActive: journalStudent.student.status === 'OPPURSTAATUS_O',
            isDeleted: false
          }
          break
        }
      }
    }

    if (studentCacheEntry) {
      Logger.debug(
        `Found student ${studentCacheEntry.name} (${studentPersonalCode}) in cache. Active: ${studentCacheEntry.isActive}, Deleted: ${studentCacheEntry.isDeleted}`
      )

      if (!studentCacheEntry.isActive || studentCacheEntry.isDeleted) {
        const statusReason = studentCacheEntry.isDeleted ? 'deleted' : 'inactive'
        throw new Error(
          `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
        )
      }
    } else {
      Logger.warning(
        `Student ${studentPersonalCode} not found in cache during proactive check. Will proceed with sync attempt but may fail if student is inactive.`
      )
    }

    if (!grade) throw new Error('Grade value is required for syncing grades')

    const gradeStr = String(grade).toUpperCase()
    const numericGrade = parseInt(gradeStr, 10)

    const isValidNumeric = !isNaN(numericGrade) && numericGrade >= 1 && numericGrade <= 5
    const isValidNonNumeric = gradeStr === 'MA' || gradeStr === 'A'

    if (!isValidNumeric && !isValidNonNumeric) {
      throw new Error(`Invalid grade value: ${grade}. Expected numeric grade 1-5, MA (Mittearvestatav), or A (Arvestatud).`)
    }

    if (Logger.isDebugMode()) Logger.debug(`Syncing grade ${grade} directly to Tahvel`)

    let entryData
    try {
      if (!feature._assignmentEntryCache) feature._assignmentEntryCache = new Map()
      const entryCacheKey = `${journalId}::${assignmentId}`
      entryData = feature._assignmentEntryCache.get(entryCacheKey)
      if (!entryData) {
        entryData = await feature.api.tahvel.get(`/journals/${journalId}/journalEntry/${assignmentId}`, { allStudents: true })
        feature._assignmentEntryCache.set(entryCacheKey, entryData)
      }
    } catch (error) {
      throw new Error(`Failed to fetch assignment data: ${error.message}. Check if the assignment still exists in Tahvel.`)
    }

    if (!entryData) {
      throw new Error(`No data returned for assignment ${assignmentId}. The assignment may have been deleted.`)
    }

    if (!entryData.journalEntryStudents || !Array.isArray(entryData.journalEntryStudents)) {
      throw new Error(`Assignment ${assignmentId} has no student data. Structure: ${JSON.stringify(Object.keys(entryData))}`)
    }

    if (Logger.isDebugMode()) {
      Logger.debug(`Assignment ${assignmentId} has ${entryData.journalEntryStudents.length} students`)
    }

    let targetStudentInAssignment = null
    for (const student of entryData.journalEntryStudents) {
      if (student.journalStudent) {
        const cachedStudent = await feature.getCachedStudent(student.journalStudent)
        if (cachedStudent && String(cachedStudent.personalCode) === String(studentPersonalCode)) {
          targetStudentInAssignment = student
          if (Logger.isDebugMode()) {
            Logger.debug(`✅ Target student FOUND in assignment: ${cachedStudent.name} (${cachedStudent.personalCode})`)
          }
          break
        }
      }
    }

    if (!targetStudentInAssignment) {
      Logger.warning(`❌ Target student with personal code "${studentPersonalCode}" NOT FOUND in assignment ${assignmentId}`)
    }

    const journalStudentsForMatching = await feature.getJournalStudents(journalId)

    await feature.getJournalStudents(journalId)

    let matchingStudentId = null
    const targetPersonalCode = String(studentPersonalCode)

    if (journalStudentsForMatching) {
      for (const journalStudent of journalStudentsForMatching) {
        if (journalStudent.student && journalStudent.student.idcode === targetPersonalCode) {
          matchingStudentId = journalStudent.studentId
          Logger.debug(
            `Found exact matching student in journal students: ${journalStudent.student.fullname || journalStudent.studentName} (${journalStudent.student.idcode})`
          )
          break
        }
      }
    }

    let studentEntry = null
    if (matchingStudentId) {
      studentEntry = entryData.journalEntryStudents.find(
        student => student.journalStudent && String(student.journalStudent) === String(matchingStudentId)
      )

      if (studentEntry) {
        Logger.debug(`Found matching student entry in assignment data: ${studentEntry.journalStudent}`)
      } else {
        const cachedStudent = await feature.getCachedStudent(matchingStudentId)
        const studentName = cachedStudent ? cachedStudent.name : 'Unknown'

        Logger.warning(
          `Student ${studentName} (${targetPersonalCode}) with ID ${matchingStudentId} found in global cache but not in assignment API response`
        )
        Logger.warning(`This may indicate an API discrepancy - student exists in database but not returned by /journalEntry/${assignmentId}`)

        const info = await feature.getDetailedStudentInfo(targetPersonalCode, journalId)
        Logger.debug(`Detailed student info for ${targetPersonalCode}: ${JSON.stringify(info)}`)

        if (info.journalStudentId) {
          studentEntry = {
            journalStudent: info.journalStudentId,
            id: null,
            studentName: cachedStudent ? cachedStudent.name : 'Unknown',
            grade: null,
            addInfo: null,
            absence: null,
            absenceInserted: null,
            gradeInserted: null,
            gradeInsertedBy: null,
            inserted: null,
            isRemark: false,
            journalEntryStudentHistories: [],
            lessonAbsences: [],
            verbalGrade: null
          }

          if (Logger.isDebugMode()) {
            Logger.debug(`Created student entry with journalStudentId ${info.journalStudentId} to handle API discrepancy`)
            Logger.debug(`Database shows student is enrolled - proceeding with sync despite API inconsistency`)
          }
          Logger.debug(`Student entry created successfully, studentEntry.journalStudent = ${studentEntry.journalStudent}`)
        } else {
          if (cachedStudent && !cachedStudent.isActive) {
            Logger.warning(`Student ${studentName} (${targetPersonalCode}) is not active. Status: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
            throw new Error(
              `Cannot add student ${studentName} (${targetPersonalCode}) to the assignment because they are not actively studying. The student may be on academic leave or their status is inactive.`
            )
          }

          throw new Error(
            `❌ Student ${studentName} (${targetPersonalCode}) exists in the journal but has no valid journal student ID. This may indicate a data integrity issue. Please contact support.`
          )
        }
      }
    }

    if (!studentEntry) {
      Logger.debug(`Falling back to searching through entry data for student with personal code ${studentPersonalCode}`)

      for (const student of entryData.journalEntryStudents) {
        if (!student.journalStudent) continue

        const studentId = student.journalStudent
        const cachedStudent = await feature.getCachedStudent(studentId)
        if (cachedStudent) {
          if (!cachedStudent.personalCode) continue

          const cachedPersonalCode = String(cachedStudent.personalCode)
          const matches = cachedPersonalCode === targetPersonalCode

          if (matches) {
            if (Logger.isDebugMode()) {
              Logger.debug(`✅ Found exact matching student in entry data: ${cachedStudent.name} (${cachedPersonalCode})`)
            }
            Logger.debug(`Student entry details: ID=${student.id}, journalStudent=${student.journalStudent}, addInfo=${student.addInfo}`)
            studentEntry = student
            break
          }
        }
      }

      if (!studentEntry) {
        Logger.warning(`❌ Could not find student with exact personal code ${studentPersonalCode}, trying to find similar personal codes...`)

        for (const student of entryData.journalEntryStudents) {
          if (!student.journalStudent) continue

          const cachedStudent = await feature.getCachedStudent(student.journalStudent)
          if (!cachedStudent || !cachedStudent.personalCode) continue

          const cachedPersonalCode = String(cachedStudent.personalCode)
          Logger.debug(`Comparing "${targetPersonalCode}" with "${cachedPersonalCode}"`)

          if (cachedPersonalCode.includes(targetPersonalCode) || targetPersonalCode.includes(cachedPersonalCode)) {
            Logger.warning(`⚠️ Found student with similar personal code: ${cachedStudent.name} (${cachedPersonalCode}) - SUBSTRING MATCH`)
            studentEntry = student
            break
          }

          const cachedLastDigits = cachedPersonalCode.slice(-8)
          const targetLastDigits = targetPersonalCode.slice(-8)
          if (cachedLastDigits === targetLastDigits && cachedLastDigits.length === 8) {
            Logger.warning(`⚠️ Found student with matching last 8 digits: ${cachedStudent.name} (${cachedPersonalCode}) - LAST 8 DIGITS MATCH`)
            studentEntry = student
            break
          }
        }

        if (!studentEntry) {
          Logger.error(
            `🚫 FINAL RESULT: Could not find student with personal code ${studentPersonalCode} or any similar personal code. Refusing to update a different student's grade for safety reasons.`
          )
          throw new Error(
            `Could not find student with personal code ${studentPersonalCode} or any similar personal code. Refusing to update a different student's grade for safety reasons.`
          )
        }
      }
    }

    if (!studentEntry) {
      let errorMessage = `Student with personal code ${studentPersonalCode} not found in assignment ${assignmentId}.`
      errorMessage += `\n\nDiagnostic Info:`
      errorMessage += `\n- Assignment ID: ${assignmentId}`
      errorMessage += `\n- Journal ID: ${journalId}`
      errorMessage += `\n- Students in assignment: ${entryData.journalEntryStudents.length}`

      const journalStudentsForCheck = await feature.getJournalStudents(journalId)
      let studentInJournal = null

      if (journalStudentsForCheck) {
        for (const journalStudent of journalStudentsForCheck) {
          if (journalStudent.student && journalStudent.student.idcode === String(studentPersonalCode)) {
            studentInJournal = {
              name: journalStudent.student.fullname || journalStudent.studentName,
              personalCode: journalStudent.student.idcode,
              isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
            }
            break
          }
        }
      }

      if (studentInJournal) {
        errorMessage += `\n- Student EXISTS in journal: ${studentInJournal.name} (${studentInJournal.personalCode})`
        errorMessage += `\n- Student status: ${studentInJournal.isActive ? 'Active' : 'Inactive'}`
        errorMessage += `\n- This means the student is NOT enrolled in this specific assignment`
        errorMessage += `\n\nSOLUTION: The student needs to be manually added to this assignment in Tahvel first, then you can sync the grade.`
      } else {
        errorMessage += `\n- Student NOT FOUND in journal`
        errorMessage += `\n- This means the student is not enrolled in this journal at all`
      }

      throw new Error(errorMessage)
    }

    if (!studentEntry.journalStudent) {
      Logger.warning(`No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update.`)
      throw new Error(
        `No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update. This might be because the student is not enrolled in this journal.`
      )
    }

    const currentGradeCode = studentEntry.grade?.code || 'No grade'
    Logger.debug(`Current grade for student ${studentPersonalCode}: ${currentGradeCode}`)

    const cachedStudentForFallback = await feature.getCachedStudent(studentEntry.journalStudent)
    if (cachedStudentForFallback && String(cachedStudentForFallback.personalCode) !== String(studentPersonalCode)) {
      Logger.warning(
        `WARNING: Using fallback student ${cachedStudentForFallback.name} (${cachedStudentForFallback.personalCode}) instead of requested student with personal code ${studentPersonalCode}`
      )
    }

    Logger.debug(`About to prepare update data. studentEntry.journalStudent = ${studentEntry.journalStudent}`)

    const updatedStudentEntry = {
      id: studentEntry.id,
      journalStudent: Number(studentEntry.journalStudent),
      absence: null,
      grade: {
        code: `KUTSEHINDAMINE_${grade}`,
        gradingSchemaRowId: null,
        value: String(grade),
        value2: String(grade),
        extraval1: null,
        extraval2: null,
        nameEt: `Hinne ${grade}`,
        nameEn: `Grade ${grade}`,
        valid: true
      },
      verbalGrade: null,
      removeStudentHistory: true,
      addInfo: feature.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
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

    const existingStudentIndex = entryData.journalEntryStudents.findIndex(
      student => student.journalStudent && Number(student.journalStudent) === Number(updatedStudentEntry.journalStudent)
    )

    let finalStudentEntry
    if (existingStudentIndex !== -1) {
      if (Logger.isDebugMode()) {
        Logger.debug(`Student ${studentPersonalCode} is already in the assignment. Updating existing entry.`)
      }

      const originalStudentEntry = entryData.journalEntryStudents[existingStudentIndex]
      Logger.debug(
        `Original student entry: ${JSON.stringify({
          id: originalStudentEntry.id,
          journalStudent: originalStudentEntry.journalStudent,
          addInfo: originalStudentEntry.addInfo,
          grade: originalStudentEntry.grade?.code || 'No grade'
        })}`
      )

      finalStudentEntry = {
        ...originalStudentEntry,
        grade: updatedStudentEntry.grade,
        id: originalStudentEntry.id,
        removeStudentHistory: true
      }
    } else {
      if (Logger.isDebugMode()) {
        Logger.debug(`Student ${studentPersonalCode} is not in the assignment. Adding new entry.`)
      }
      finalStudentEntry = updatedStudentEntry
    }

    const cachedStudentForStatus = await feature.getCachedStudent(finalStudentEntry.journalStudent)
    if (cachedStudentForStatus && (!cachedStudentForStatus.isActive || cachedStudentForStatus.isDeleted)) {
      const statusReason = cachedStudentForStatus.isDeleted ? 'deleted' : 'inactive'
      throw new Error(
        `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
      )
    }

    const studentsToUpdate = [finalStudentEntry]

    const studentsWithNames = []
    for (const student of studentsToUpdate) {
      const cachedStudent = await feature.getCachedStudent(student.journalStudent)
      const studentName = cachedStudent ? cachedStudent.name : 'Unknown'
      const studentPersonalCodeLocal = cachedStudent ? cachedStudent.personalCode : 'Unknown'
      const isActive = cachedStudent ? cachedStudent.isActive : 'Unknown'
      const isDeleted = cachedStudent ? cachedStudent.isDeleted : 'Unknown'
      const gradeCode = student.grade?.code || 'No grade'

      if (Logger.isDebugMode()) {
        Logger.debug(
          `Student: ${studentName} (${studentPersonalCodeLocal}) - Active: ${isActive}, Deleted: ${isDeleted}, Grade: ${gradeCode}, JournalStudentId: ${student.journalStudent}`
        )
      }

      studentsWithNames.push({
        ...student,
        studentName,
        studentPersonalCode: studentPersonalCodeLocal
      })
    }

    const updateData = {
      ...entryData,
      journalEntryStudents: studentsWithNames
    }

    if (!updateData.version && entryData.version) {
      updateData.version = entryData.version
    }

    if (entryData.teacherSelection && Array.isArray(entryData.teacherSelection)) {
      updateData.teacherSelection = entryData.teacherSelection
    }

    if (Array.isArray(updateData.journalEntryTeachers)) {
      updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
    }

    if (!updateData.journalEntryCapacityTypes) {
      if (entryData.entryType === 'SISSEKANNE_I') {
        updateData.journalEntryCapacityTypes = ['MAHT_i']
      } else if (entryData.entryType === 'SISSEKANNE_H') {
        updateData.journalEntryCapacityTypes = ['MAHT_h']
      } else if (entryData.entryType === 'SISSEKANNE_P') {
        updateData.journalEntryCapacityTypes = []
      }
    }

    if (Array.isArray(updateData.journalEntryTeachers)) {
      updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => id.toString())
    }

    Logger.debug(`Sending update for assignment ${assignmentId}, student ${studentPersonalCode}, new grade: ${grade}`)

    if (studentEntry.id) {
      if (Logger.isDebugMode()) {
        Logger.debug(`Updating grade for existing student ${studentPersonalCode} in assignment ${assignmentId}`)
      } else {
        Logger.debug(`Adding new student ${studentPersonalCode} to assignment ${assignmentId} with grade ${grade}`)
      }
    }

    Logger.debug(`Sending update with student: ${studentEntry.studentName || 'Unknown'} (${studentEntry.journalStudent}) with grade ${grade}`)

    let response
    try {
      if (Logger.isDebugMode()) {
        Logger.debug(`Sending PUT request to /journals/${journalId}/journalEntry/${assignmentId}`)
      }
      Logger.debug(`PUT request data: ${JSON.stringify(updateData)}`)

      const requestUrl = `${feature.api.tahvel.baseUrl}/journals/${journalId}/journalEntry/${assignmentId}`
      Logger.debug(`Full request URL: ${requestUrl}`)

      const startTime = Date.now()
      Logger.debug(`Starting PUT request at ${new Date().toISOString()}`)

      response = await feature.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

      const endTime = Date.now()
      Logger.debug(`PUT request completed in ${endTime - startTime}ms`)

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)
      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(feature.api, syncedGrades)
        Logger.info(`Notified Kriit about ${syncedGrades.length} synced grade(s) for assignment ${assignmentId}`)
      }
    } catch (error) {
      let errorMessage = `Failed to update grade in Tahvel: ${error.message}`

      if (error.message.includes('403')) {
        errorMessage = 'Permission denied. You may not have rights to modify this journal. This is expected if you are not the teacher of this journal.'
        Logger.warning(
          `Permission denied when updating journal ${journalId}, assignment ${assignmentId}. This is expected if you are not the teacher of this journal.`
        )

        const teacherInfo = entryData.teacherSelection ? entryData.teacherSelection.map(t => t.nameEt || t.fullname || t.id).join(', ') : 'Unknown'
        Logger.debug(`Journal teachers: ${teacherInfo}`)
        errorMessage += ` Journal teachers: ${teacherInfo}`

        const cookies = document.cookie.split(';')
        let hasXsrfToken = false
        for (const cookie of cookies) {
          const [name] = cookie.trim().split('=')
          if (name === 'XSRF-TOKEN') {
            hasXsrfToken = true
            break
          }
        }
        if (!hasXsrfToken) {
          Logger.warning('XSRF-TOKEN cookie is missing. This might be causing the 403 error.')
          errorMessage += ' XSRF-TOKEN cookie is missing, which might be causing this error. Try refreshing the page.'
        }
      } else if (error.message.includes('404')) {
        errorMessage = 'Assignment not found. It may have been deleted or moved.'
      } else if (error.message.includes('400')) {
        errorMessage = `Bad request: ${error.message}. The data format may be incorrect.`
      } else if (error.message.includes('412')) {
        Logger.warning(`Server returned 412 error when updating assignment ${assignmentId}`)

        if (
          error.message.includes('changeIsNotAllowedStudentIsNotStudying') ||
          error.message.includes('journal.messages.changeIsNotAllowedStudentIsNotStudying')
        ) {
          errorMessage = `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student may be on academic leave or their status is inactive in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`

          const cachedStudent = await feature.getCachedStudent(studentEntry.journalStudent)
          if (cachedStudent) {
            Logger.debug(`Student status in cache: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
            if (!cachedStudent.isActive) {
              errorMessage += ' Student status in our cache is marked as inactive.'
            }
          }
        } else {
          errorMessage = `Precondition failed: ${error.message}. The server rejected the request.`
        }
      } else if (error.message.includes('500')) {
        Logger.error(`Server returned 500 error when updating assignment ${assignmentId}`)
        Logger.debug(`Update data that caused 500 error: ${JSON.stringify(updateData)}`)

        if (!studentEntry.id && !updateData.version) {
          errorMessage = 'Server error when adding new student. The server might require a version number for the update.'
          Logger.warning('Missing version number might be causing the 500 error')
        } else if (!studentEntry.id) {
          errorMessage = 'Server error when adding new student. The server might not allow adding students through this API.'
          Logger.warning('Adding new student might not be supported by the API')
        } else {
          errorMessage = 'Tahvel server error. Please try again later.'
        }

        errorMessage += ' Try adding the student to the assignment manually in Tahvel first, then sync the grade.'
      }

      throw new Error(errorMessage)
    }

    if (response === null || response === undefined) {
      throw new Error('No response from Tahvel API after update')
    }

    Logger.debug(`Response type: ${typeof response}, Content: ${JSON.stringify(response)}`)

    return response
  } catch (error) {
    const contextualError = new Error(`Error syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}: ${error.message}`)
    Logger.error('Grade sync error:', contextualError)
    throw contextualError
  }
}
