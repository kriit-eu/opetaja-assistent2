/**
 * Top-level grade + assignment-level sync orchestrator from Kriit → Tahvel.
 *
 * Thin coordinator that wires three single-purpose modules together:
 *
 *   1. syncDataCollection.collectSyncWorkItems → turn feature.differences
 *      into { syncData, assignmentLevelDifferences, batches }.
 *   2. syncBatchExecutor.executeBatches → fire one PUT per batch, return
 *      { successfulSyncs, failedSyncs }.
 *   3. syncOutcomeReporter.reportBatchOutcome → tally results, build the
 *      user-facing message, drive banner + refresh.
 *
 * Owns only the top-level guards (in-progress check, empty differences,
 * empty post-collection), the outer try/catch, and the feature.isLoading
 * lifecycle. Returns the result shape consumed by the banner.
 */

import Logger from '../../../services/Logger.js'
import { collectSyncWorkItems } from './SyncDataCollection.js'
import { executeBatches } from './SyncBatchExecutor.js'
import { reportNothingToSync, reportBatchOutcome } from './SyncOutcomeReporter.js'

function logSyncContext(feature) {
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
}

export async function syncWithKriit(feature) {
  logSyncContext(feature)

  if (feature.isLoading) {
    Logger.warning('Sync already in progress, ignoring new sync request')
    return
  }

  try {
    if (!feature.differences || !Array.isArray(feature.differences) || feature.differences.length === 0) {
      Logger.debug('No differences to sync')
      return
    }

    const { syncData, assignmentLevelDifferences, batches } = collectSyncWorkItems(feature.differences)

    if (syncData.length === 0 && assignmentLevelDifferences.length === 0) {
      Logger.warning('No data to sync after processing')
      reportNothingToSync(feature)
      return
    }

    Logger.debug(`Found ${syncData.length} grade differences and ${assignmentLevelDifferences.length} assignment-level differences to sync`)

    feature.isLoading = true
    feature.updateUI()

    try {
      const { successfulSyncs, failedSyncs } = await executeBatches(feature, batches)
      return reportBatchOutcome(feature, batches, successfulSyncs, failedSyncs)
    } catch (error) {
      Logger.error('Unexpected error during batch sync process:', error)
      feature.isLoading = false
      feature.error = 'Sünkroniseerimine ebaõnnestus ootamatu vea tõttu.'
      feature.updateUI()
      return { successfulSyncs: [], failedSyncs: [{ status: feature.getApiErrorStatus(error), error: error.message }] }
    }
  } catch (error) {
    Logger.error('Error syncing with Kriit:', error)
    feature.isLoading = false
    feature.error = error.message || 'Failed to sync with Kriit'
    feature.updateUI()
    return { successfulSyncs: [], failedSyncs: [{ status: feature.getApiErrorStatus(error), error: error.message }] }
  }
}
