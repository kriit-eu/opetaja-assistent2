/**
 * Banner UI for the journal-list sync feature. Owns banner state branching
 * (loading / error / differences / all-in-sync / missing-API-key) and the
 * action callbacks each banner exposes (sync, refresh, clear cache, etc.).
 *
 * Every helper takes the feature instance as first arg — banners read
 * `feature.isActive`, `feature.isLoading`, `feature.error`,
 * `feature.differences`, and call back into orchestrator methods
 * (proceedWithKriitApiCall, syncWithKriit, fetchJournalData, clearCache,
 * resetKriitApiToken, waitForTableUpdate). No direct API or DOM access
 * beyond what bannerService / journalSyncBannerService / differenceRenderer
 * provide.
 */

import Logger from '../../../services/Logger.js'
import { bannerService } from '../../../services/BannerService.js'
import { differenceRenderer, journalSyncBannerService } from '../JournalSyncBanner.js'

export function updateUI(feature) {
  if (!feature.isActive) return
  if (!feature.isLoading) {
    bannerService.removeBanner()
  }

  if (feature.isLoading) {
    if (!bannerService.hasBanner()) {
      bannerService.showLoadingBanner()
    }
    return
  }

  if (feature.error) {
    showErrorBanner(feature)
    return
  }

  const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
  const hasNewAssignments = Object.keys(globalNewAssignments || {}).length > 0

  if ((feature.differences && feature.differences.length > 0) || hasNewAssignments) {
    showDifferencesBanner(feature)
    return
  }

  showAllInSyncBanner(feature)
}

export function updateProgressUI(feature, current, total) {
  if (!feature.isActive) return
  bannerService.updateProgressUI(current, total, 'Sünkroniseerin hindeid Kriidist Tahvlisse...')
}

export function showSuccessBanner(feature, message) {
  if (!feature.isActive) return
  bannerService.showSuccessBanner(message, {
    onRefresh: () => feature.proceedWithKriitApiCall(),
    onClose: () => bannerService.removeBanner()
  })
}

export function showErrorBanner(feature) {
  const options = {
    onRetry: () => feature.proceedWithKriitApiCall(),
    onClearCache: () => {
      feature.clearCache().then(result => {
        alert(
          `Puhastatud ${result.total} vahemälu kirjet:\n` +
            `- API vahemälu: ${result.api} kirjet\n` +
            `- Funktsiooni vahemälu: ${result.feature} kirjet\n` +
            `- Mälu vahemälu: ${result.runtime} kirjet\n\n` +
            'Klõpsake "Proovi uuesti" värske andmete saamiseks.'
        )
      })
    },
    onSettings: () => feature.resetKriitApiToken(),
    onRefresh: () => window.location.reload()
  }

  journalSyncBannerService.showSyncErrorBanner(feature.error, options)
}

export function showMissingApiKeyBanner() {
  journalSyncBannerService.showMissingApiKeyBanner()
}

export function showAllInSyncBanner(feature) {
  journalSyncBannerService.showAllInSyncBanner(
    async() => {
      Logger.debug('Värskenda button clicked - triggering Tahvel search for current study year')
      try {
        const submitButton = document.querySelector('button[type="submit"]')
        if (submitButton) {
          submitButton.click()
          await feature.waitForTableUpdate()
        } else {
          Logger.warning('Submit button not found, refreshing without triggering search')
        }
        await feature.clearCache()
      } catch (err) {
        Logger.warning('Failed to trigger search or clear cache:', err.message)
      }
      await feature.fetchJournalData()
    },
    () => bannerService.removeBanner()
  )
}

export function showDifferencesBanner(feature) {
  const totalDifferences = feature.countTotalDifferences()

  if (Logger.isDebugMode() && Array.isArray(feature.differences)) {
    feature.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        subject.assignments.forEach(assignment => {
          if (assignment && Array.isArray(assignment.results)) {
            assignment.results.forEach(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'
              if (tahvelGrade !== kriitGrade) {
                Logger.debug(
                  `[GRADE DIFF] Subject: ${subject.subjectName}, Assignment: ${assignment.assignmentName}, Student: ${result.studentName || '(nimi puudub)'}, Tahvel: ${tahvelGrade}, Kriit: ${kriitGrade}`
                )
              }
            })
          }
        })
      }
    })
  }

  const globalNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
  const newAssignmentsCount = Object.values(globalNewAssignments || {}).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
  const totalForBanner = totalDifferences + newAssignmentsCount

  journalSyncBannerService.showDifferencesBanner(
    totalForBanner,
    async() => {
      const currentNewAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
      if (Object.keys(currentNewAssignments).length > 0) {
        Logger.debug('Syncing new assignments to Tahvel before grade sync')
        try {
          const { tahvelNewAssignmentSync } = await import('../TahvelNewAssignmentSync.js')
          await tahvelNewAssignmentSync.syncNewAssignmentsToTahvel(currentNewAssignments)
        } catch (err) {
          Logger.error('Failed to sync new assignments to Tahvel:', err)
        }
      }

      const syncResult = await feature.syncWithKriit()
      const failedSyncs = syncResult?.failedSyncs || []
      const successfulCount = syncResult?.successfulChangeCount ?? syncResult?.successfulSyncs?.length ?? 0
      if (failedSyncs.length > 0) {
        feature.isLoading = false
        feature.error = feature.buildSyncFailureMessage(failedSyncs, successfulCount)
        feature.updateUI()
        return
      }
      if (feature.error && !feature.error.includes('Kõik hinded on juba sünkroonis')) return
    },
    async() => {
      Logger.debug('Refresh button clicked - triggering Tahvel search for current study year')
      try {
        const submitButton = document.querySelector('button[type="submit"]')
        if (submitButton) {
          submitButton.click()
          await feature.waitForTableUpdate()
        } else {
          Logger.warning('Submit button not found, refreshing without triggering search')
        }
        await feature.clearCache()
      } catch (err) {
        Logger.warning('Failed to trigger search or clear cache:', err.message)
      }
      await feature.fetchJournalData()
    },
    container => {
      const assignmentNameDiffs = feature.extractAssignmentNameDifferences()
      const gradeDiffs = Array.isArray(feature.differences) ? feature.differences : []
      const dueDateDiffs = feature.extractDueDateDifferences()
      const entryDateDiffs = feature.extractEntryDateDifferences()
      const assignmentHoursDiffs = feature.extractAssignmentHoursDifferences()
      const entryTypeDiffs = feature.extractEntryTypeDifferences()
      const newAssignments = (window.journalListSync && window.journalListSync.newAssignments) || {}
      differenceRenderer.render(
        container,
        assignmentNameDiffs,
        gradeDiffs,
        dueDateDiffs,
        entryDateDiffs,
        assignmentHoursDiffs,
        entryTypeDiffs,
        newAssignments
      )
    }
  )
}

export function removeSyncBanner() {
  bannerService.removeBanner()
}
