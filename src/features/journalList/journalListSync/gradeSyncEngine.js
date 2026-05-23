/**
 * Grade + assignment-level sync from Kriit → Tahvel.
 *
 * syncWithKriit builds per-assignment batches from feature.differences, fires
 * one PUT per batch, updates banner statuses, refreshes the in-memory diff
 * after success, and finally reports per-batch successes/failures.
 *
 * Takes the feature instance because it reads/writes feature.differences,
 * feature.isLoading, feature.error, feature.journalStudentIdToStudentId,
 * and feature._localStudentCache, and reaches into feature.* wrappers for
 * studentDataPipeline / assignmentLevelSync / tahvelDataFetchers / banner
 * helpers.
 */

import Logger from '../../../services/Logger.js'
import { collectSyncWorkItems } from './syncDataCollection.js'
import { executeBatches } from './syncBatchExecutor.js'

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

  try {
    if (!feature.differences || !Array.isArray(feature.differences) || feature.differences.length === 0) {
      Logger.debug('No differences to sync')
      return
    }

    const { syncData, assignmentLevelDifferences, batches: collectedBatches } = collectSyncWorkItems(feature.differences)

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

    try {
      const batches = collectedBatches
      const { successfulSyncs, failedSyncs } = await executeBatches(feature, batches)

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
