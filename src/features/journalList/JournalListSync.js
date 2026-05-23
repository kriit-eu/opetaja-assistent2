/**
 * Journal List Sync Feature
 *
 * Syncs data between Tahvel and Kriit:
 * - Assignments and their grades (SISSEKANNE_H, SISSEKANNE_I)
 * - Curriculum outcomes and their grades (SISSEKANNE_O)
 * - Students and their personal codes
 * - Student statuses (active/inactive)
 *
 * Displays a banner on journal list page showing differences that need to be synced
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { styleService } from '../../services/StyleService.js'
import { cacheService } from '../../services/CacheService.js'
import { ApiService } from '../../services/ApiService.js'
import { buildDiffSummary } from '../../lib/kriitSyncCheck.js'
import { setupKriitMessageListener } from '../../services/MessageListenerService.js'
import { bannerService } from '../../services/BannerService.js'
import { differenceRenderer, journalSyncBannerService } from './JournalSyncBanner.js'

import { sendOutcomeEntriesToKriit } from './OutComes.js'
import { notifyKriitGradesSynced, buildGradesForNotification } from './KriitSyncNotifier.js'
import { getSchoolId } from '../../lib/schoolId.js'
import { resolveLessonPlanDate, resolveStudyYearIdFromText } from '../../lib/studyYear.js'
import { resolveJournalFromElement } from './journalListSync/journalLinkResolver.js'
import {
  extractEntryDateDifferences,
  extractAssignmentNameDifferences,
  extractDueDateDifferences,
  extractAssignmentHoursDifferences,
  extractEntryTypeDifferences,
  countTotalDifferences
} from './journalListSync/differenceExtractors.js'
import {
  createStudentMap,
  extractAssignmentsFromEntries,
  getAddInfoFromExistingStudents,
  getAssignmentNameFromEntry
} from './journalListSync/assignmentMapper.js'
import {
  getAssignmentLevelSyncFields,
  getAssignmentLevelChangeValue,
  getAssignmentLevelChanges,
  getAssignmentLevelBatchChanges,
  updateAssignmentLevelSyncStatuses,
  applyAssignmentLevelChangesToDifference,
  getAssignmentLevelFailureTypes,
  getSyncFailureTypes,
  getSyncTypeNames,
  countSuccessfulSyncChanges,
  buildAssignmentLevelUpdatePayload,
  normalizeTahvelDueDate,
  getApiErrorStatus,
  buildSyncFailureMessage
} from './journalListSync/assignmentLevelSync.js'
import { computePayloadHash } from './journalListSync/payloadHash.js'
import {
  ONE_DAY_MS,
  ONE_WEEK_MS,
  TWO_WEEKS_MS,
  globalModuleTeacherCache,
  pendingTeacherRequests,
  fetchCachedData,
  getTeacherPersonalCodeCached
} from './journalListSync/teacherCache.js'
import {
  getJournalInfo,
  getJournalEntries,
  getJournalEntriesWithGrades,
  getStudentDetails,
  getJournalStudents,
  fetchInactiveStudents,
  getInactiveStudentsCache,
  getFirstLessonFromPlan,
  getLastLessonFromPlan,
  getLessonDates,
  fetchJournalsFromApi
} from './journalListSync/tahvelDataFetchers.js'
import { getTahvelSubjectsWithAssignmentsAndGrades } from './journalListSync/tahvelSubjectsAggregator.js'
import {
  updateUI,
  updateProgressUI,
  showSuccessBanner,
  showErrorBanner,
  showMissingApiKeyBanner,
  showAllInSyncBanner,
  showDifferencesBanner,
  removeSyncBanner
} from './journalListSync/syncBannerUI.js'
import {
  getSelectedStudyYear,
  getStudyYearIdFromText,
  setupStudyYearMonitoring,
  waitForTableUpdate
} from './journalListSync/studyYearMonitor.js'
import {
  setKriitApiToken,
  resetKriitApiToken,
  clearCache
} from './journalListSync/tokenAndCache.js'
import {
  processStudentData,
  getDetailedStudentInfo,
  getCachedStudent
} from './journalListSync/studentDataPipeline.js'
import { proceedWithKriitApiCall } from './journalListSync/kriitClient.js'
import { collectJournalData } from './journalListSync/journalDataCollector.js'
import { syncWithKriit, syncGradeToTahvel } from './journalListSync/gradeSyncEngine.js'
import { fetchJournalData } from './journalListSync/fetchOrchestrator.js'

// Re-exported to preserve the existing public import path.
export { getTahvelSubjectsWithAssignmentsAndGrades }

// Test-only hook: expose fetchCachedData on the aggregator function so
// existing tests can replace it without re-importing internals.
getTahvelSubjectsWithAssignmentsAndGrades.__fetchCachedData = fetchCachedData

// Re-exported so the existing test import path keeps working.
export { computePayloadHash, fetchCachedData, getTeacherPersonalCodeCached }

class JournalListSyncFeature extends BaseFeature {
  /**
   * Resolve a journal link element and extract journal ID from it.
   * Accepts anchor elements, elements inside anchors (like span.linked-name),
   * or elements with data attributes containing the ID.
   * @param {Element} el - Element matched by selector
   * @returns {Object|null} { href, id } or null if not resolvable
   */
  // Alias kept for legacy underscore-prefixed callers in test/main convention.
  _resolveJournalFromElement(el) { return resolveJournalFromElement(el) }

  resolveJournalFromElement(el) { return resolveJournalFromElement(el) }
  /**
   * Extract assignment entry date differences from Kriit response
   */
  extractEntryDateDifferences() { return extractEntryDateDifferences(this.differences) }

  extractAssignmentNameDifferences() { return extractAssignmentNameDifferences(this.differences) }

  extractDueDateDifferences() { return extractDueDateDifferences(this.differences) }

  extractAssignmentHoursDifferences() { return extractAssignmentHoursDifferences(this.differences) }

  extractEntryTypeDifferences() { return extractEntryTypeDifferences(this.differences) }

  /**
   * Send only outcome entries (SISSEKANNE_O) to Kriit API
   */
  async sendOutcomeEntriesToKriit(accessibleJournalIds) {
    if (!this.api || !this.api.kriit || !this.api.kriit.authToken) {
      Logger.error('No Kriit API token set')
      return
    }
    if (!this.journalLinks || this.journalLinks.length === 0) {
      Logger.debug('No journal links available for outcome sync')
      return
    }
    Logger.debug('Triggering outcome sync (outcome entries only)')
    await sendOutcomeEntriesToKriit(this.api, this.journalLinks, accessibleJournalIds)
  }
  constructor() {
    // Define selectors for journal links - using the most reliable selector first
    const journalLinkSelectors = [
      // Primary selector that works reliably in older layout
      '#main-content md-table-container td:nth-child(2) > a',

      // Fallback selectors in case the primary one doesn't work
      '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a',
      '#main-content a[ng-href^="/#/journal/"][ng-if="row.canEdit"]',
      'a[href^="/#/journal/"]',

      // Newer layout variations: look for links with data-test or contain '/journal/' in href
      'a[data-test*="journal"]',
      'a[href*="/journal/"]',
      // New Tahvel markup: journal name may be inside a span.linked-name inside a clickable cell
      'span.linked-name',
      // Clickable row/element attributes used by Angular/JS frameworks
      '[ng-reflect-router-link*="/journal/"]',
      '[routerlink*="/journal/"]',
      '[data-href*="/journal/"]',
      '[onclick*="/journal/"]',
      '[data-journal-id]',
      '[role="link"]',
      '[tabindex][onclick]',
      '#main-content a',
      'md-table-container a'
    ]

    // Match the journal list page URL pattern and pass required selectors
    // Accept modern variants like '#/journals' and '#/journals?...'
    super('journalListSync', /#\/journals/, journalLinkSelectors)

    // Initialize state
    this.differences = null
    this.isLoading = false
    this.error = null
    this.journalLinks = null
    this.isActive = false

    // Global teacher cache to avoid redundant API calls across journals
    this.globalTeacherCache = {}

    // Mapping from journalStudentId to studentId for API cache lookups
    this.journalStudentIdToStudentId = {}

    // Study year selector state
    this.tableObserver = null
    this.lastStudyYear = null

    // Set up message listener for settings changes using global service
    setupKriitMessageListener(this)
  }

  /**
   * Called when the feature is activated
   * @param {NodeList} elements - The found elements (journal links)
   */
  async onActivate(elements) {
    // Only activate on journals page (accept variants like 'journals?…')
    const url = window.location.hash.replace(/^#\/?/, '').split('&')[0]
    if (!url.startsWith('journals')) {
      Logger.debug('JournalListSync not activated: URL does not match journals')
      return
    }

    // Log a specific message for this feature's activation
    Logger.debug(`[${this.name}] Journal List Sync feature initialized`)

    if (Logger.isDebugMode()) Logger.debug('[DEBUG] onActivate: elements', elements)

    // Wait for Kriit API settings to be loaded from chrome.storage before checking.
    // initializeKriitApi() runs in the constructor but uses an async callback,
    // so this.api.kriit.enabled may not be set yet when onActivate fires.
    try {
      await (this.api._kriitInitPromise || Promise.resolve())

      if (!this.isActive) return

      // First check if Kriit support is enabled
      if (!this.api.kriit.enabled) {
        Logger.debug('Kriit support is disabled - JournalListSync feature will not be activated')
        return
      }

      // Then check if we have a Kriit API token
      if (this.api.kriit.authToken) {
        Logger.debug('Using Kriit API token')

        // If we have journal links from the observer, store them
        if (elements && elements.length > 0) {
          this.journalLinks = elements
          if (Logger.isDebugMode()) Logger.debug('[DEBUG] onActivate: journalLinks set', this.journalLinks)

          // Wait for preferred banner container before showing any UI
          if (!document.querySelector('.tahvel-form-buttons')) {
            await bannerService.waitForBannerContainer(5000).catch(() => {
              Logger.debug('[JournalListSync] Banner container wait timeout, proceeding anyway')
            })
          }

          this.fetchJournalData()
        } else {
          // This case should not happen anymore with the fixed observer
          Logger.warning('No journal links found during activation, but observer reported success')
          this.isLoading = false
          this.error = 'No journal links found on the page. Please refresh and try again.'
          this.updateUI()
        }
      } else {
        // No token available - feature will be disabled
        Logger.debug('No Kriit API token found - JournalListSync feature will be disabled')
        this.showMissingApiKeyBanner()
      }

    } catch (err) {
      Logger.error('[JournalListSync] Initialization failed:', err)
    }

    // Set up study year selector monitoring (doesn't depend on Kriit)
    this.setupStudyYearMonitoring()
  }

  getSelectedStudyYear() { return getSelectedStudyYear() }
  async getStudyYearIdFromText(yearText) { return getStudyYearIdFromText(this.api, yearText) }
  setupStudyYearMonitoring() { return setupStudyYearMonitoring(this) }
  waitForTableUpdate() { return waitForTableUpdate(this) }

  /**
   * Called when the feature is deactivated
   */
  onDeactivate() {
    this.isActive = false
    // Call parent method to clean up observers
    super.onDeactivate()

    // Clean up table observer
    if (this.tableObserver) {
      this.tableObserver.disconnect()
      this.tableObserver = null
    }

    // Clean up UI elements
    bannerService.removeBanner()
    styleService.removeCSS('journal-list-sync-styles')

    // Reset state
    this.resetJournalLinks()
  }

  /**
   * Reset journal links cache
   * This ensures we don't reuse links from a previous page
   */
  resetJournalLinks() {
    Logger.debug('Resetting journal links cache')
    this.journalLinks = null
  }

  /**
   * Called when required elements (journal links) are found
   * Note: DOM elements are only used to detect when we're on the journals page.
   * All journal data is fetched via the Tahvel API for reliability.
   * @param {NodeList} elements - The found elements
   * @param {string} selector - The selector that matched
   */
  onRequiredElementsFound(elements, selector) {
    Logger.debug(`Found ${elements.length} journal links with selector: ${selector}`)
    Logger.debug('Note: DOM elements are used for activation only, journal data will be fetched via API')
    this.journalLinks = elements

    // Log the first 3 links for debugging
    Array.from(elements)
      .slice(0, 3)
      .forEach((el, i) => {
        const href = el.getAttribute('href') || el.getAttribute('ng-href') || ''
        const text = el.textContent.trim()
        Logger.debug(`Link ${i + 1}: href=${href}, text=${text}`)
      })
  }

  /**
   * Called when required elements (journal links) are not found
   * @param {Error} error - The error that occurred
   */
  onRequiredElementsNotFound(error) {
    Logger.warning(`Could not find journal links: ${error.message}`)
    this.isLoading = false
    this.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
    this.updateUI()
  }

  async fetchJournalData() { return fetchJournalData(this) }

  async collectJournalData(apiList = null) { return collectJournalData(this, apiList) }

  /**
   * Process student data with caching
   * @param {number} journalId - Journal ID
   * @param {Array} journalStudents - Journal students
   * @returns {Promise<Object>} Student details map
   */
  async processStudentData(journalId, journalStudents) { return processStudentData(this, journalId, journalStudents) }

  updateUI() { return updateUI(this) }
  updateProgressUI(current, total) { return updateProgressUI(this, current, total) }
  showSuccessBanner(message) { return showSuccessBanner(this, message) }
  showErrorBanner() { return showErrorBanner(this) }
  showMissingApiKeyBanner() { return showMissingApiKeyBanner() }
  showAllInSyncBanner() { return showAllInSyncBanner(this) }
  showDifferencesBanner() { return showDifferencesBanner(this) }
  removeSyncBanner() { return removeSyncBanner() }

  setKriitApiToken(token) { return setKriitApiToken(this, token) }
  resetKriitApiToken() { return resetKriitApiToken(this) }
  async clearCache() { return clearCache(this) }

  async proceedWithKriitApiCall(providedJournalData = null) { return proceedWithKriitApiCall(this, providedJournalData) }

  countTotalDifferences() { return countTotalDifferences(this.differences) }

  /**
   * Get comprehensive lesson dates (first, next, last) from timetable and õppetöögraafik
   * @param {number} journalId - Journal ID
   * @param {Object} journalInfo - Journal info object (already fetched)
   * @returns {Promise<Object>} Object with firstLessonDate, nextLessonDate, lastLessonDate (all ISO strings or null)
   */
  async getLessonDates(journalId, journalInfo) { return getLessonDates(this.api, journalId, journalInfo) }

  async getFirstLessonFromPlan(journalId, teacherId) { return getFirstLessonFromPlan(this.api, journalId, teacherId) }

  async getLastLessonFromPlan(journalId, teacherId) { return getLastLessonFromPlan(this.api, journalId, teacherId) }

  async getJournalInfo(journalId) { return getJournalInfo(this.api, journalId) }

  async fetchJournalsFromApi() { return fetchJournalsFromApi(this) }

  /**
   * Get journal entries from API (cached for 24 hours)
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array|null>} Journal entries, empty array if unexpected format, null on error
   */
  async getJournalEntries(journalId) { return getJournalEntries(this.api, journalId) }

  async getJournalEntriesWithGrades(journalId) { return getJournalEntriesWithGrades(this.api, journalId) }

  async getJournalStudents(journalId) { return getJournalStudents(this, journalId) }

  /**
   * Get detailed information about a student by personal code
   * @param {string} personalCode - Student personal code
   * @param {number} journalId - Journal ID
   * @returns {Promise<Object>} Detailed student information
   */
  async getDetailedStudentInfo(personalCode, journalId) { return getDetailedStudentInfo(this, personalCode, journalId) }
  async getStudentDetails(studentId) { return getStudentDetails(this.api, studentId) }

  async fetchInactiveStudents() { return fetchInactiveStudents(this.api) }

  async getInactiveStudentsCache() { return getInactiveStudentsCache(this.api) }

  /**
   * Create a mapping of student IDs to personal codes and names
   * @param {Array} journalStudents - Journal students
   * @param {Object} studentDetailsMap - Map of student IDs to their details including personal codes
   * @returns {Object} Student map
   */
  createStudentMap(journalStudents, studentDetailsMap = {}) {
    return createStudentMap(journalStudents, studentDetailsMap)
  }

  /**
   * Extract assignments and their results from journal entries
   * @param {Array} journalEntries - Journal entries
   * @param {Object} studentMap - Student map
   * @param {Array} journalStudents - Journal students (optional)
   * @param {Object} studentDetailsMap - Map of student IDs to their details (optional)
   * @param {Array} journalEntriesWithGrades - Journal entries with grades from journalEntriesByDate endpoint (optional)
   * @returns {Array} Assignments
   */
  extractAssignmentsFromEntries(journalEntries, studentMap, journalStudents = [], studentDetailsMap = {}, journalEntriesWithGrades = []) {
    return extractAssignmentsFromEntries(journalEntries, studentMap, journalStudents, studentDetailsMap, journalEntriesWithGrades)
  }

  /**
   * Get addInfo value from existing students
   * @param {Array} students - Journal entry students
   * @returns {string} addInfo value
   */
  getAddInfoFromExistingStudents(students) { return getAddInfoFromExistingStudents(students) }

  /**
   * Get a readable assignment name from a journal entry
   * @param {Object} entry - Journal entry
   * @returns {string} Assignment name
   */
  getAssignmentNameFromEntry(entry) { return getAssignmentNameFromEntry(entry) }

  getAssignmentLevelSyncFields() { return getAssignmentLevelSyncFields() }
  getAssignmentLevelChangeValue(assignment, field) { return getAssignmentLevelChangeValue(assignment, field) }
  getAssignmentLevelChanges(assignment, fields) { return getAssignmentLevelChanges(assignment, fields) }
  getAssignmentLevelBatchChanges(batch, fields) { return getAssignmentLevelBatchChanges(batch, fields) }
  updateAssignmentLevelSyncStatuses(service, batch, isSynced) { return updateAssignmentLevelSyncStatuses(service, batch, isSynced) }
  applyAssignmentLevelChangesToDifference(assignmentObj, batch) { return applyAssignmentLevelChangesToDifference(assignmentObj, batch) }
  getAssignmentLevelFailureTypes(batch) { return getAssignmentLevelFailureTypes(batch) }
  getSyncFailureTypes(batch, hasStudentUpdates) { return getSyncFailureTypes(batch, hasStudentUpdates) }
  getSyncTypeNames() { return getSyncTypeNames() }
  countSuccessfulSyncChanges(successfulSyncs, batches) { return countSuccessfulSyncChanges(successfulSyncs, batches) }
  buildAssignmentLevelUpdatePayload(entryData, updates) { return buildAssignmentLevelUpdatePayload(entryData, updates) }
  normalizeTahvelDueDate(dueDate) { return normalizeTahvelDueDate(dueDate) }
  getApiErrorStatus(error) { return getApiErrorStatus(error) }
  buildSyncFailureMessage(failedSyncs, successfulCount) { return buildSyncFailureMessage(failedSyncs, successfulCount) }

  async syncWithKriit() { return syncWithKriit(this) }
  async syncGradeToTahvel(journalId, assignmentId, studentPersonalCode, grade) { return syncGradeToTahvel(this, journalId, assignmentId, studentPersonalCode, grade) }

  /**
   * Get student from cache using multiple lookup strategies
   * @param {string|number} journalStudentId - Journal student ID to look up
   * @returns {Promise<Object|null>} Cached student data or null if not found
   */
  async getCachedStudent(journalStudentId) { return getCachedStudent(this, journalStudentId) }
}

JournalListSyncFeature.requiresKriit = true

export const journalListSync = new JournalListSyncFeature()
