/**
 * Pure transforms that read feature.differences and produce the three
 * intermediate shapes the sync executor consumes:
 *
 *   1. syncData — flat list of per-student grade changes (one item per
 *      student × assignment that needs a grade update)
 *   2. assignmentLevelDifferences — list of assignment-level metadata
 *      changes (name, due date, entry date, type, hours)
 *   3. batches — combined per-assignment work units (assignmentId →
 *      { students[], plus any non-grade fields })
 *
 * No `this`, no API, no banner, no feature side effects (other than
 * throwing on invalid input — the outer orchestrator's try/catch turns
 * that into a user-facing error).
 */

import Logger from '../../../services/Logger.js'
import { getAssignmentLevelSyncFields, getAssignmentLevelChanges } from './assignmentLevelSync.js'

function normalizeGrade(grade) {
  if (grade === null || grade === undefined || grade === '' || grade === '(puudub)') {
    return null
  }
  const normalized = String(grade).trim()
  if (normalized.startsWith('KUTSEHINDAMINE_')) {
    return normalized.replace('KUTSEHINDAMINE_', '')
  }
  return normalized
}

export function collectGradeSyncData(differences) {
  const syncData = []
  if (Logger.isDebugMode()) {
    Logger.debug('=== COLLECTING SYNC DATA ===')
    Logger.debug(`Processing ${differences ? differences.length : 0} subjects with differences`)
  }

  if (!Array.isArray(differences)) return syncData

  differences.forEach((subject, subjectIndex) => {
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
          throw new Error('Found missing personal code for a student - cannot proceed with sync')
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
          throw new Error(`Found invalid personal code: ${result.studentPersonalCode} - cannot proceed with sync`)
        }

        const tahvelGrade = normalizeGrade(result.currentGrade)
        const kriitGrade = normalizeGrade(result.grade)

        Logger.debug(`    Grade comparison: Tahvel="${tahvelGrade}" vs Kriit="${kriitGrade}"`)

        if (tahvelGrade === kriitGrade) {
          Logger.debug(`⏭️ Result ${resultIndex + 1}: Grades are the same, skipping: Tahvel="${tahvelGrade}", Kriit="${kriitGrade}"`)
          return
        }

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

        syncData.push({
          journalId: subject.subjectExternalId,
          assignmentId: assignment.assignmentExternalId,
          studentPersonalCode: personalCode,
          grade: gradeStr
        })
        if (Logger.isDebugMode()) {
          Logger.debug(`📤 Added to sync queue: ${result.studentName} (${personalCode}) -> Grade ${gradeStr}`)
        }
      })
    })
  })

  if (Logger.isDebugMode()) {
    Logger.debug(`=== SYNC DATA COLLECTION COMPLETE: ${syncData.length} items to sync ===`)
  }

  return syncData
}

export function collectAssignmentLevelDifferences(differences) {
  const assignmentLevelFields = getAssignmentLevelSyncFields()
  const assignmentLevelDifferences = []

  if (!Array.isArray(differences)) return assignmentLevelDifferences

  differences.forEach(subject => {
    if (!subject.assignments || !Array.isArray(subject.assignments)) return

    subject.assignments.forEach(assignment => {
      const changes = getAssignmentLevelChanges(assignment, assignmentLevelFields)
      if (changes.length === 0) return

      assignmentLevelDifferences.push({
        journalId: subject.subjectExternalId,
        assignmentId: assignment.assignmentExternalId,
        changes
      })
      Logger.debug(
        `📋 Found assignment-level difference: ${assignment.assignmentName?.kriit || assignment.assignmentName?.Tahvel || assignment.assignmentExternalId} (${changes.map(change => change.field.statusType).join(', ')})`
      )
    })
  })

  return assignmentLevelDifferences
}

export function buildSyncBatches(syncData, assignmentLevelDifferences) {
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

  return Array.from(assignmentMap.values())
}

/**
 * Convenience aggregator: collect → collect → batch.
 */
export function collectSyncWorkItems(differences) {
  const syncData = collectGradeSyncData(differences)
  const assignmentLevelDifferences = collectAssignmentLevelDifferences(differences)
  const batches = buildSyncBatches(syncData, assignmentLevelDifferences)
  return { syncData, assignmentLevelDifferences, batches }
}
