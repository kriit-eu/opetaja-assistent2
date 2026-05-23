/**
 * Pure functions that parse a Kriit `differences` array and return the typed
 * diff lists displayed in the sync banner. Each helper takes the differences
 * array as input and returns a fresh list — no `this`, no API, no DOM.
 */

import Logger from '../../../services/Logger.js'

function pickAssignmentName(assignmentName) {
  if (assignmentName && typeof assignmentName === 'object') {
    return assignmentName.kriit || assignmentName.Tahvel || ''
  }
  return assignmentName
}

export function extractEntryDateDifferences(differences) {
  Logger.debug('✨ [extractEntryDateDifferences] Called')
  const entryDateDiffs = []
  if (!differences || !Array.isArray(differences)) {
    return entryDateDiffs
  }

  differences.forEach(subjectDiff => {
    if (!Array.isArray(subjectDiff.assignments)) return
    subjectDiff.assignments.forEach(assignment => {
      if (assignment.assignmentEntryDate && typeof assignment.assignmentEntryDate === 'object') {
        const kriitEntryDate = assignment.assignmentEntryDate.kriit
        const tahvelEntryDate = assignment.assignmentEntryDate.Tahvel
        if (kriitEntryDate !== tahvelEntryDate && !(kriitEntryDate == null && tahvelEntryDate == null)) {
          entryDateDiffs.push({
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName: pickAssignmentName(assignment.assignmentName),
            kriit: kriitEntryDate,
            Tahvel: tahvelEntryDate,
            subjectName: subjectDiff.subjectName || '',
            subjectExternalId: subjectDiff.subjectExternalId || ''
          })
        }
      }
    })
  })

  return entryDateDiffs
}

export function extractAssignmentNameDifferences(differences) {
  Logger.debug('✨ [extractAssignmentNameDifferences] Called')
  const groupedDiffs = []
  if (!differences || !Array.isArray(differences)) {
    Logger.debug('✨ [extractAssignmentNameDifferences] No differences array found.')
    return groupedDiffs
  }
  differences.forEach(subject => {
    if (subject && Array.isArray(subject.assignments)) {
      const nameDiffs = subject.assignments
        .filter(a => {
          if (a.assignmentName && typeof a.assignmentName === 'object') {
            return a.assignmentName.kriit && a.assignmentName.Tahvel && a.assignmentName.kriit !== a.assignmentName.Tahvel
          }
          return false
        })
        .map(a => ({
          kriit: a.assignmentName.kriit,
          Tahvel: a.assignmentName.Tahvel,
          assignmentExternalId: a.assignmentExternalId
        }))
      if (nameDiffs.length > 0) {
        groupedDiffs.push({
          subjectName: subject.subjectName,
          subjectExternalId: subject.subjectExternalId,
          nameDiffs
        })
      }
    }
  })
  Logger.debug(`✨ [extractAssignmentNameDifferences] Total subjects with differences: ${groupedDiffs.length}`)
  return groupedDiffs
}

export function extractDueDateDifferences(differences) {
  const dueDateDiffs = []
  if (!differences || !Array.isArray(differences)) {
    return dueDateDiffs
  }
  differences.forEach(subjectDiff => {
    if (!Array.isArray(subjectDiff.assignments)) return
    subjectDiff.assignments.forEach(assignment => {
      if (assignment.assignmentDueAt && typeof assignment.assignmentDueAt === 'object') {
        const kriitDue = assignment.assignmentDueAt.kriit
        const tahvelDue = assignment.assignmentDueAt.Tahvel
        if (kriitDue !== tahvelDue && !(kriitDue == null && tahvelDue == null)) {
          dueDateDiffs.push({
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName: pickAssignmentName(assignment.assignmentName),
            kriit: kriitDue,
            Tahvel: tahvelDue,
            subjectName: subjectDiff.subjectName || '',
            subjectExternalId: subjectDiff.subjectExternalId || ''
          })
        }
      }
    })
  })
  return dueDateDiffs
}

export function extractAssignmentHoursDifferences(differences) {
  const hoursDiffs = []
  if (!differences || !Array.isArray(differences)) {
    return hoursDiffs
  }
  differences.forEach(subjectDiff => {
    if (!Array.isArray(subjectDiff.assignments)) return
    subjectDiff.assignments.forEach(assignment => {
      if (typeof assignment.assignmentHours !== 'undefined' && assignment.assignmentHours !== null) {
        hoursDiffs.push({
          assignmentExternalId: assignment.assignmentExternalId,
          assignmentName: pickAssignmentName(assignment.assignmentName),
          kriitHours: assignment.assignmentHours,
          subjectName: subjectDiff.subjectName || '',
          subjectExternalId: subjectDiff.subjectExternalId || ''
        })
      }
    })
  })
  return hoursDiffs
}

export function extractEntryTypeDifferences(differences) {
  Logger.debug('✨ [extractEntryTypeDifferences] Called')
  const entryTypeDiffs = []
  if (!differences || !Array.isArray(differences)) {
    Logger.debug('✨ [extractEntryTypeDifferences] No differences array found')
    return entryTypeDiffs
  }
  Logger.debug(`✨ [extractEntryTypeDifferences] Processing ${differences.length} subjects`)
  differences.forEach(subjectDiff => {
    if (!Array.isArray(subjectDiff.assignments)) return
    subjectDiff.assignments.forEach(assignment => {
      if (assignment.entryType && typeof assignment.entryType === 'object') {
        const kriitType = assignment.entryType.kriit
        const tahvelType = assignment.entryType.Tahvel
        Logger.debug(
          `✨ [extractEntryTypeDifferences] Assignment ${assignment.assignmentExternalId}: kriit="${kriitType}", tahvel="${tahvelType}"`
        )
        if (kriitType !== tahvelType && !(kriitType == null && tahvelType == null)) {
          const diff = {
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName: pickAssignmentName(assignment.assignmentName),
            kriit: kriitType,
            Tahvel: tahvelType,
            subjectName: subjectDiff.subjectName || '',
            subjectExternalId: subjectDiff.subjectExternalId || ''
          }
          entryTypeDiffs.push(diff)
          Logger.debug(`✨ [extractEntryTypeDifferences] Added diff:`, JSON.stringify(diff))
        }
      } else if (Logger.isDebugMode()) {
        Logger.debug(
          `✨ [extractEntryTypeDifferences] Assignment ${assignment.assignmentExternalId}: entryType is not an object (${typeof assignment.entryType})`
        )
      }
    })
  })
  Logger.debug(`✨ [extractEntryTypeDifferences] Total entry type differences: ${entryTypeDiffs.length}`)
  return entryTypeDiffs
}

/**
 * Total count across every diff type (grades + names + due dates + entry dates + hours + entry types).
 */
export function countTotalDifferences(differences) {
  Logger.debug('✨ [countTotalDifferences] Called')
  let count = 0

  if (!differences || !Array.isArray(differences)) {
    Logger.debug('✨ [countTotalDifferences] No differences array, returning 0')
    return 0
  }

  let gradeCount = 0
  differences.forEach(subject => {
    if (subject && Array.isArray(subject.assignments)) {
      subject.assignments.forEach(assignment => {
        if (assignment && Array.isArray(assignment.results)) {
          assignment.results.forEach(result => {
            const tahvelGrade = result.currentGrade || '(puudub)'
            const kriitGrade = result.grade || '(puudub)'
            if (tahvelGrade !== kriitGrade) {
              gradeCount++
            }
          })
        }
      })
    }
  })
  Logger.debug(`✨ [countTotalDifferences] Grade differences: ${gradeCount}`)
  count += gradeCount

  const assignmentNameDiffs = extractAssignmentNameDifferences(differences)
  let nameCount = 0
  assignmentNameDiffs.forEach(subject => {
    if (subject.nameDiffs && subject.nameDiffs.length > 0) {
      nameCount += subject.nameDiffs.length
    }
  })
  Logger.debug(`✨ [countTotalDifferences] Name differences: ${nameCount}`)
  count += nameCount

  const dueDateDiffs = extractDueDateDifferences(differences)
  Logger.debug(`✨ [countTotalDifferences] Due date differences: ${dueDateDiffs.length}`)
  count += dueDateDiffs.length

  const entryDateDiffs = extractEntryDateDifferences(differences)
  Logger.debug(`✨ [countTotalDifferences] Entry date differences: ${entryDateDiffs.length}`)
  count += entryDateDiffs.length

  const assignmentHoursDiffs = extractAssignmentHoursDifferences(differences)
  Logger.debug(`✨ [countTotalDifferences] Hours differences: ${assignmentHoursDiffs.length}`)
  count += assignmentHoursDiffs.length

  const entryTypeDiffs = extractEntryTypeDifferences(differences)
  Logger.debug(`✨ [countTotalDifferences] Entry type differences: ${entryTypeDiffs.length}`)
  count += entryTypeDiffs.length

  Logger.debug(`✨ [countTotalDifferences] TOTAL differences: ${count}`)
  return count
}
