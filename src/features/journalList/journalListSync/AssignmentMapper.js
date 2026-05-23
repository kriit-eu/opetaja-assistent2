/**
 * Pure data transforms that turn raw Tahvel journal entries into the
 * assignment + student shapes consumed by Kriit. No `this`, no API, no DOM.
 *
 *  - createStudentMap: builds journalStudentId / personalCode lookup maps
 *  - extractAssignmentsFromEntries: per-entry assignment + results list
 *  - getAssignmentNameFromEntry: readable name fallback
 *  - getAddInfoFromExistingStudents: extracts the addInfo URL pattern
 */

import Logger from '../../../services/Logger.js'

export function createStudentMap(journalStudents, studentDetailsMap = {}) {
  if (Logger.isDebugMode()) {
    Logger.debug('=== CREATING STUDENT MAP ===')
    Logger.debug(`Journal students count: ${journalStudents ? journalStudents.length : 0}`)
    Logger.debug(`Student details map count: ${Object.keys(studentDetailsMap).length}`)
  }

  const studentMap = {
    idToPersonalCode: {},
    personalCodeToName: {},
    journalStudentIdToId: {}
  }

  if (journalStudents && Array.isArray(journalStudents)) {
    if (Logger.isDebugMode()) {
      Logger.debug(`Processing ${journalStudents.length} journal students...`)
    }

    journalStudents.forEach((journalStudent, index) => {
      if (Logger.isDebugMode()) {
        Logger.debug(`Processing journal student ${index + 1}/${journalStudents.length}`)
      }

      if (journalStudent?.id && journalStudent?.studentId) {
        studentMap.journalStudentIdToId[journalStudent.id] = journalStudent.studentId
        if (Logger.isDebugMode()) {
          Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId}`)
        }

        if (studentDetailsMap[journalStudent.studentId]) {
          const details = studentDetailsMap[journalStudent.studentId]
          studentMap.idToPersonalCode[journalStudent.studentId] = details.personalCode
          studentMap.personalCodeToName[details.personalCode] = details.name
          if (Logger.isDebugMode()) {
            Logger.debug(`Added personal code mapping: studentId ${journalStudent.studentId} -> "${details.personalCode}" (${details.name})`)
          }
        } else {
          Logger.warning(`❌ No personal code found for student ID ${journalStudent.studentId} in student details map`)
          Logger.debug(`Available student detail IDs: ${Object.keys(studentDetailsMap).join(', ')}`)
          Logger.debug(`Journal student data: ${JSON.stringify(journalStudent)}`)

          if (journalStudent.student && journalStudent.student.idcode) {
            if (Logger.isDebugMode()) {
              Logger.debug(`✅ Found personal code in journal student data: ${journalStudent.student.idcode}`)
            }
            studentMap.idToPersonalCode[journalStudent.studentId] = journalStudent.student.idcode
            const studentName = journalStudent.student.fullname || journalStudent.studentName || 'Unknown'
            studentMap.personalCodeToName[journalStudent.student.idcode] = studentName
            if (Logger.isDebugMode()) {
              Logger.debug(
                `Added personal code mapping from journal data: studentId ${journalStudent.studentId} -> "${journalStudent.student.idcode}" (${studentName})`
              )
            }
          } else {
            Logger.error(`🚫 Cannot find personal code for student ID ${journalStudent.studentId} anywhere`)
            const errorMsg = `No personal code found for student ID ${journalStudent.studentId} in student details map - cannot proceed`
            Logger.error(errorMsg)
            throw new Error(errorMsg)
          }
        }
      } else {
        Logger.warning(`⚠️ Journal student ${index + 1} missing id or studentId: ${JSON.stringify(journalStudent)}`)
      }
    })
  } else {
    Logger.warning('⚠️ No valid journal students array provided')
  }

  if (Logger.isDebugMode()) {
    const personalCodeCount = Object.keys(studentMap.idToPersonalCode).length
    const nameCount = Object.keys(studentMap.personalCodeToName).length
    const journalMappingCount = Object.keys(studentMap.journalStudentIdToId).length

    Logger.debug(`Final mapping statistics:`)
    Logger.debug(`- Personal code mappings: ${personalCodeCount}`)
    Logger.debug(`- Name mappings: ${nameCount}`)
    Logger.debug(`- Journal student mappings: ${journalMappingCount}`)

    if (personalCodeCount > 0) {
      const samplePersonalCodes = Object.values(studentMap.idToPersonalCode).slice(0, 3)
      Logger.debug(`Sample personal codes: ${samplePersonalCodes.join(', ')}`)
    }

    Logger.debug('=== END CREATING STUDENT MAP ===')
  }

  return studentMap
}

export function extractAssignmentsFromEntries(
  journalEntries,
  studentMap,
  journalStudents = [],
  studentDetailsMap = {},
  journalEntriesWithGrades = []
) {
  const assignments = []

  if (!journalEntries || !Array.isArray(journalEntries)) {
    return assignments
  }

  const gradedEntries = journalEntries.filter(
    entry =>
      entry.entryType === 'SISSEKANNE_H' ||
      entry.entryType === 'SISSEKANNE_I' ||
      entry.entryType === 'SISSEKANNE_P'
  )

  const entriesWithGradesMap = {}
  if (journalEntriesWithGrades && Array.isArray(journalEntriesWithGrades)) {
    journalEntriesWithGrades.forEach(entry => {
      if (entry.id && (entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P')) {
        entriesWithGradesMap[entry.id] = entry
      }
      if (entry.curriculumModuleOutcomes && entry.entryType === 'SISSEKANNE_O') {
        entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`] = entry
      }
    })
  }

  gradedEntries.forEach(entry => {
    const results = []

    let entryWithGrades
    if (entry.entryType === 'SISSEKANNE_O') {
      entryWithGrades = entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`]
    } else {
      entryWithGrades = entriesWithGradesMap[entry.id]
    }

    const studentResultsMap = {}
    if (entryWithGrades) {
      if (entry.entryType === 'SISSEKANNE_O' && entryWithGrades.studentOutcomeResults) {
        Object.entries(entryWithGrades.studentOutcomeResults).forEach(([journalStudentId, studentResults]) => {
          studentResultsMap[journalStudentId] = studentResults
        })
      } else if (entryWithGrades.journalStudentResults) {
        Object.entries(entryWithGrades.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
          studentResultsMap[journalStudentId] = studentResults
        })
      }
    } else if (entry.journalStudentResults) {
      const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
      Logger.debug(`Using fallback entry for assignment ${entryIdForLog} (${entry.nameEt || 'Unnamed'})`)
      Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
        studentResultsMap[journalStudentId] = studentResults
      })
    } else {
      const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
      Logger.debug(`No grades found for assignment ${entryIdForLog} (${entry.nameEt || 'Unnamed'}), but including all students with empty grades`)
    }

    if (journalStudents && Array.isArray(journalStudents)) {
      journalStudents.forEach(journalStudent => {
        if (!journalStudent || !journalStudent.id) return

        const journalStudentId = journalStudent.id.toString()

        const studentResults = studentResultsMap[journalStudentId]
        let grade = ''

        if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
          grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
        }

        const studentId = studentMap.journalStudentIdToId[journalStudentId]
        if (!studentId) return

        const personalCode = studentMap.idToPersonalCode[studentId]

        if (!personalCode) {
          Logger.warning(`No personal code found for student ID ${studentId}, skipping`)
          return
        }

        let studentName = 'Unknown Student'
        let studentIsActive = true
        let studentIsDeleted = false

        if (personalCode && studentMap.personalCodeToName[personalCode]) {
          studentName = studentMap.personalCodeToName[personalCode]
        } else if (journalStudent.studentName) {
          studentName = journalStudent.studentName
          if (personalCode) {
            studentMap.personalCodeToName[personalCode] = journalStudent.studentName
            Logger.debug(`Added name mapping for ${personalCode}: ${journalStudent.studentName}`)
          }
        }

        let studentIsGraduated = false
        if (studentId && studentDetailsMap[studentId]) {
          studentIsActive = studentDetailsMap[studentId].isActive
          studentIsDeleted = studentDetailsMap[studentId].isDeleted || false
          studentIsGraduated = studentDetailsMap[studentId].isGraduated || false
        }

        results.push({
          grade,
          studentPersonalCode: personalCode,
          studentName,
          studentIsActive: studentIsActive,
          studentIsDeleted: studentIsDeleted,
          studentIsGraduated: studentIsGraduated
        })
      })
    } else {
      const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
      Logger.warning(`No journal students provided for assignment ${entryIdForLog}, cannot include all students`)
    }

    const assignmentName = entry.nameEt || getAssignmentNameFromEntry(entry)

    const assignmentId = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id

    if (assignmentId && assignmentName) {
      assignments.push({
        assignmentExternalId: assignmentId,
        assignmentName: assignmentName,
        assignmentInstructions: entry.content || '',
        assignmentDueAt: entry.homeworkDuedate ? entry.homeworkDuedate.split('T')[0] : entry.entryDate ? entry.entryDate.split('T')[0] : null,
        assignmentEntryDate: entry.entryDate ? entry.entryDate.split('T')[0] : null,
        lessons: typeof entry.lessons !== 'undefined' && entry.lessons !== null ? Number(entry.lessons) : null,
        entryType: entry.entryType || null,
        results
      })
    }
  })

  return assignments
}

export function getAddInfoFromExistingStudents(students) {
  if (!students || !Array.isArray(students) || students.length === 0) {
    return null
  }

  for (const student of students) {
    if (student.addInfo) {
      Logger.debug(`Found existing addInfo pattern: ${student.addInfo}`)

      const match = student.addInfo.match(/(.*\/)[0-9]+$/)
      if (match && match[1]) {
        const baseUrl = match[1]
        Logger.debug(`Extracted base URL: ${baseUrl}`)

        const lastPart = student.addInfo.split('/').pop()
        return `${baseUrl}${lastPart}`
      }

      return student.addInfo
    }
  }

  return null
}

export function getAssignmentNameFromEntry(entry) {
  if (entry.nameEt) return entry.nameEt

  if (entry.content) {
    const firstSentence = entry.content
      .split(/[.!\n]/)[0]
      .trim()
      .slice(0, 100)

    if (firstSentence) {
      return firstSentence.length === 100 ? `${firstSentence}...` : firstSentence
    }
  }

  return entry.entryType === 'SISSEKANNE_H'
    ? 'Hindeline töö'
    : entry.entryType === 'SISSEKANNE_I'
      ? 'Iseseisev töö'
      : entry.entryType === 'SISSEKANNE_P'
        ? 'Praktiline töö'
        : entry.entryType === 'SISSEKANNE_O'
          ? 'Õppetulemus'
          : 'Päeviku sissekanne'
}
