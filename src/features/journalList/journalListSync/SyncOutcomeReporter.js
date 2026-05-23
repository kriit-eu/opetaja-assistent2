/**
 * User-facing reporting after the sync executor finishes (or finds nothing
 * to do).
 *
 *  - reportNothingToSync: empty-after-collection branch. Either clears the
 *    error so the banner can show pending new assignments, or sets the
 *    "all in sync" message.
 *  - reportBatchOutcome: post-execution branch. Tallies updates, builds the
 *    Estonian-language success/failure message, drives banner + scheduled
 *    refresh, and returns the final result shape.
 *
 * Both take the feature instance because they need to set
 * feature.isLoading / feature.error and call into feature.showSuccessBanner /
 * feature.updateUI / feature.clearCache / feature.fetchJournalData /
 * feature.buildSyncFailureMessage. No HTTP work, no per-batch logic.
 */

const REFRESH_DELAY_MS = 3000

export function reportNothingToSync(feature) {
  feature.isLoading = false
  const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
  if (globalNewAssignments && Object.keys(globalNewAssignments).length > 0) {
    feature.error = null
    feature.updateUI()
    return
  }
  feature.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
  feature.updateUI()
}

function countAssignmentLevelChangesByType(feature, batches, successfulSyncs) {
  const counts = new Map(
    feature.getAssignmentLevelSyncFields().map(field => [field.statusType, { count: 0, label: field.successLabel }])
  )
  for (const batch of batches) {
    const wasSuccessful = successfulSyncs.some(s => s.journalId === batch.journalId && s.assignmentId === batch.assignmentId)
    if (!wasSuccessful) continue
    for (const { field } of feature.getAssignmentLevelBatchChanges(batch)) {
      const item = counts.get(field.statusType)
      if (item) item.count++
    }
  }
  return counts
}

function buildSuccessMessage(successfulSyncs, actualUpdates, assignmentLevelUpdates, skippedUpdates, assignmentLevelCounts) {
  if (actualUpdates === 0 && assignmentLevelUpdates === 0) {
    return `Kõik ${successfulSyncs.length} kirjet olid juba õiged - pole midagi sünkroniseerida.`
  }

  const parts = []
  if (actualUpdates > 0) parts.push(`${actualUpdates} hinnet`)
  for (const { count, label } of assignmentLevelCounts.values()) {
    if (count > 0) parts.push(`${count} ${label}`)
  }

  let message = parts.length > 0
    ? `Edukalt sünkroniseeritud ${parts.join(', ')} Kriidist Tahvlisse.`
    : `Edukalt sünkroniseeritud Kriidist Tahvlisse.`

  if (skippedUpdates > 0) message += ` ${skippedUpdates} kirjet olid juba õiged.`
  message += ` Andmed värskendatakse automaatselt mõne sekundi pärast...`
  return message
}

function scheduleRefresh(feature) {
  setTimeout(() => {
    feature.clearCache()
      .then(() => feature.fetchJournalData())
      .catch(() => feature.fetchJournalData())
  }, REFRESH_DELAY_MS)
}

export function reportBatchOutcome(feature, batches, successfulSyncs, failedSyncs) {
  const actualUpdates = successfulSyncs.reduce((acc, s) => acc + (s.updated || 0), 0)
  const assignmentLevelUpdates = successfulSyncs.filter(s => s.assignmentLevelUpdated).length
  const skippedUpdates = successfulSyncs.filter(s => s.skipped).length

  const assignmentLevelCounts = countAssignmentLevelChangesByType(feature, batches, successfulSyncs)

  const successfulChangeCount = feature.countSuccessfulSyncChanges(successfulSyncs, batches)
  feature.isLoading = false

  if (failedSyncs.length === 0) {
    const successMessage = buildSuccessMessage(successfulSyncs, actualUpdates, assignmentLevelUpdates, skippedUpdates, assignmentLevelCounts)
    feature.showSuccessBanner(successMessage)
    scheduleRefresh(feature)
  } else {
    feature.error = feature.buildSyncFailureMessage(failedSyncs, successfulChangeCount)
    feature.updateUI()
  }

  return { successfulSyncs, failedSyncs, successfulChangeCount }
}
