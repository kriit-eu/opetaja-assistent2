/**
 * Top-level orchestrator called from onActivate.
 *
 *  1. Fetch the Tahvel journal list via feature.fetchJournalsFromApi.
 *  2. Collect per-journal data via feature.collectJournalData.
 *  3. POST the result to Kriit via feature.proceedWithKriitApiCall.
 *  4. Sync outcome entries (SISSEKANNE_O) via feature.sendOutcomeEntriesToKriit.
 *
 * Takes the feature instance because it sets feature.isLoading /
 * feature.error / feature.differences and drives feature.updateUI for the
 * banner state machine.
 */

import Logger from '../../../services/Logger.js'

export async function fetchJournalData(feature) {
  try {
    if (Logger.isDebugMode()) Logger.debug('[DEBUG] fetchJournalData called')
    feature.isLoading = true
    feature.updateUI()

    const apiJournalList = await feature.fetchJournalsFromApi()
    if (Logger.isDebugMode()) Logger.debug(`Fetched ${apiJournalList ? apiJournalList.length : 0} journals from Tahvel API`)

    if (!apiJournalList || apiJournalList.length === 0) {
      Logger.warning('No journals returned from API')
      feature.isLoading = false
      feature.differences = []
      feature.error = 'Could not fetch journal list from Tahvel API'
      feature.updateUI()
      return
    }

    Logger.debug('Using API-provided journal list for data collection')
    const mapped = apiJournalList.map(item => ({
      __apiJournal: true,
      id: item.id,
      nameEt: item.nameEt || item.name || item.nameEt,
      studentCount: item.studentCount || 0,
      canEdit: item.canEdit
    }))

    const journalData = await feature.collectJournalData(mapped)

    if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
      Logger.warning('No journal data to send to Kriit')
      feature.isLoading = false
      feature.differences = []
      feature.updateUI()
      return
    }

    feature.isLoading = true
    feature.error = null
    feature.differences = []
    await feature.proceedWithKriitApiCall(journalData)

    const accessibleJournalIds = new Set(journalData.map(j => j.subjectExternalId).filter(Boolean))
    await feature.sendOutcomeEntriesToKriit(accessibleJournalIds)
  } catch (error) {
    Logger.error('Error fetching journal data:', error)
    feature.isLoading = false

    if (!feature.journalLinks || feature.journalLinks.length === 0) {
      feature.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
    } else if (error.message && error.message.includes('404')) {
      feature.error = 'API endpoint not found (404). Please check if you are on the correct page.'
    } else if (error.message && error.message.includes('403')) {
      feature.error = 'Authentication error (403). Please check your Kriit API token.'
    } else if (error.message && error.message.includes('undefined')) {
      feature.error = 'Data processing error: ' + error.message + '. This may be due to missing student group data.'
    } else {
      feature.error = error.message || 'Failed to fetch data'
    }

    Logger.debug('Setting error message:', feature.error)

    feature.differences = []

    feature.updateUI()
  }
}
