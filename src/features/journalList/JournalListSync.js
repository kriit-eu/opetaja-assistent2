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
import { setupKriitMessageListener } from '../../services/MessageListenerService.js'
import { bannerService } from '../../services/BannerService.js'
import { differenceRenderer, journalSyncBannerService } from './JournalSyncBanner.js'

import { sendOutcomeEntriesToKriit } from './OutComes.js'

class JournalListSyncFeature extends BaseFeature {
  /**
   * Extract assignment entry date differences from Kriit response
   */
  extractEntryDateDifferences() {
    Logger.debug('✨ [extractEntryDateDifferences] Called')
    const entryDateDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      return entryDateDiffs
    }
    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (
          assignment.assignmentEntryDate &&
          typeof assignment.assignmentEntryDate === 'object'
        ) {
          const kriitEntryDate = assignment.assignmentEntryDate.kriit
          const tahvelEntryDate = assignment.assignmentEntryDate.Tahvel
          if (
            (kriitEntryDate !== tahvelEntryDate) &&
            !(kriitEntryDate == null && tahvelEntryDate == null)
          ) {
            let assignmentName = assignment.assignmentName
            if (assignmentName && typeof assignmentName === 'object') {
              assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
            }
            entryDateDiffs.push({
              assignmentExternalId: assignment.assignmentExternalId,
              assignmentName,
              kriit: kriitEntryDate,
              Tahvel: tahvelEntryDate,
              subjectName: subjectDiff.subjectName || '',
              subjectExternalId: subjectDiff.subjectExternalId || ''
            })
          }
        }
      })
    })
    Logger.debug(`✨ [extractEntryDateDifferences] Total entry date diffs: ${entryDateDiffs.length}`)
    return entryDateDiffs
  }
  /**
   * Update assignment names in Tahvel to match Kriit
   */
  async syncAssignmentNameDifferences() {
    // Gather all diffs: name, due date, entry date
    const assignmentNameDiffs = this.extractAssignmentNameDifferences()
    const dueDateDiffs = this.extractDueDateDifferences()
    const entryDateDiffs = this.extractEntryDateDifferences()

    // Build a map: { journalId, assignmentId } => { name, dueDate, entryDate }
    const updateMap = new Map()

    // Helper to get key
    const getKey = (journalId, assignmentId) => `${journalId}::${assignmentId}`

    // Add name diffs
    Logger.debug(`[SYNC DEBUG] this.differences has ${this.differences ? this.differences.length : 0} subjects`)
    if (this.differences) {
      this.differences.forEach((subject, i) => {
        Logger.debug(`[SYNC DEBUG] Subject ${i}: ${subject.subjectName} (${subject.subjectExternalId}) with ${subject.assignments ? subject.assignments.length : 0} assignments`)
      })
    }

    assignmentNameDiffs.forEach(subjectDiff => {
      Logger.debug(`[SYNC DEBUG] Processing subject: ${subjectDiff.subjectName} (${subjectDiff.subjectExternalId}) with ${subjectDiff.nameDiffs.length} name diffs`)
      const subject = this.differences.find(s => s.subjectName === subjectDiff.subjectName && s.subjectExternalId === subjectDiff.subjectExternalId)
      if (!subject || !Array.isArray(subject.assignments)) {
        Logger.debug(`[SYNC DEBUG] Subject not found or has no assignments: ${subjectDiff.subjectName} (${subjectDiff.subjectExternalId})`)
        return
      }
      subjectDiff.nameDiffs.forEach(nameDiff => {
        Logger.debug(`[SYNC DEBUG] Looking for assignment with externalId: ${nameDiff.assignmentExternalId}`)
        const assignment = subject.assignments.find(a => a.assignmentExternalId === nameDiff.assignmentExternalId)
        if (!assignment) {
          Logger.debug(`[SYNC DEBUG] Assignment not found: ${nameDiff.assignmentExternalId}`)
          return
        }
        const key = getKey(subject.subjectExternalId, assignment.assignmentExternalId)
        if (!updateMap.has(key)) {
          updateMap.set(key, { journalId: subject.subjectExternalId, assignmentId: assignment.assignmentExternalId })
        }
        updateMap.get(key).nameEt = nameDiff.kriit
        Logger.debug(`[UPDATE MAP] Set nameEt for key ${key}: ${nameDiff.kriit}`)
      })
    })

    // Add due date diffs
    dueDateDiffs.forEach(diff => {
      // Find subject and assignment
      const subject = this.differences.find(s => s.assignments.some(a => a.assignmentExternalId === diff.assignmentExternalId))
      if (!subject) return
      const assignment = subject.assignments.find(a => a.assignmentExternalId === diff.assignmentExternalId)
      if (!assignment) return
      const key = getKey(subject.subjectExternalId, assignment.assignmentExternalId)
      if (!updateMap.has(key)) updateMap.set(key, { journalId: subject.subjectExternalId, assignmentId: assignment.assignmentExternalId })
      updateMap.get(key).homeworkDuedate = diff.kriit
    })

    // Add entry date diffs
    entryDateDiffs.forEach(diff => {
      const subject = this.differences.find(s => s.assignments.some(a => a.assignmentExternalId === diff.assignmentExternalId))
      if (!subject) return
      const assignment = subject.assignments.find(a => a.assignmentExternalId === diff.assignmentExternalId)
      if (!assignment) return
      const key = getKey(subject.subjectExternalId, assignment.assignmentExternalId)
      if (!updateMap.has(key)) updateMap.set(key, { journalId: subject.subjectExternalId, assignmentId: assignment.assignmentExternalId })
      updateMap.get(key).entryDate = diff.kriit
    })

    // For each assignment, send a single PUT to Tahvel
    Logger.debug(`[SYNC DEBUG] UpdateMap has ${updateMap.size} entries to process`)
    for (const update of updateMap.values()) {
      const { journalId, assignmentId, nameEt, homeworkDuedate, entryDate } = update
      let currentEntry
      try {
        currentEntry = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${assignmentId}`, {}, { cache: false, forceRefresh: true })
      } catch (error) {
        Logger.error(`Failed to fetch journal entry for journalId=${journalId}, assignmentId=${assignmentId}: ${error.message}`)
        continue
      }
      if (!currentEntry) {
        Logger.error(`No journal entry found for journalId=${journalId}, assignmentId=${assignmentId}`)
        continue
      }
      // Build the PUT payload by copying all fields, updating changed ones
      const payload = { ...currentEntry }
      if (nameEt && typeof nameEt === 'string' && nameEt.trim() !== '' && nameEt !== currentEntry.nameEt) {
        payload.nameEt = nameEt
      }
      // Ensure date fields are strings, extract from object if needed
      if (homeworkDuedate) {
        let dateValue = homeworkDuedate
        if (typeof dateValue === 'object' && dateValue !== null) {
          // If it's a Date object, convert to ISO string
          dateValue = dateValue.toISOString()
        }
        if (typeof dateValue === 'string') {
          // If format is 'YYYY-MM-DD HH:MM:SS', convert to ISO 8601
          let match = dateValue.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/)
          if (match) {
            // Convert to 'YYYY-MM-DDTHH:MM:SS.000Z'
            dateValue = `${match[1]}T${match[2]}.000Z`
          } else {
            // If format is 'YYYY-MM-DD', append T23:59:59.000Z
            match = dateValue.match(/^(\d{4}-\d{2}-\d{2})$/)
            if (match) {
              dateValue = `${match[1]}T23:59:59.000Z`
            }
            // If already ISO, leave as is
          }
        }
        payload.homeworkDuedate = dateValue
      }
      if (entryDate) {
        let dateValue = entryDate
        if (typeof dateValue === 'object' && dateValue !== null) {
          dateValue = dateValue.kriit || dateValue.Tahvel || ''
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
          payload.entryDate = `${dateValue}T00:00:00Z`
        } else if (typeof dateValue === 'string') {
          payload.entryDate = dateValue
        } else {
          payload.entryDate = String(dateValue)
        }
      }
      // Ensure teacher IDs are strings
      if (Array.isArray(payload.journalEntryTeachers)) {
        payload.journalEntryTeachers = payload.journalEntryTeachers.map(id => String(id))
      }
      payload.journalEntryCapacityTypes = ['MAHT_i']
      // Optionally add homework field with Kriit link
      let kriitAssignmentUrl = ''
      const groupCode = currentEntry.groupName || ''
  // Use the Kriit API base URL from the API service, trimming any trailing slash and removing '/api' if present
  let kriitBaseUrl = (this.api.kriit.baseUrl || '').replace(/\/$/, '')
  kriitBaseUrl = kriitBaseUrl.replace(/\/api$/, '')
  kriitAssignmentUrl = `${kriitBaseUrl}/assignments/${assignmentId}${groupCode ? `?group=${encodeURIComponent(groupCode)}` : ''}`
  payload.homework = kriitAssignmentUrl ? `Link ülesandele: ${kriitAssignmentUrl}` : 'Link ülesandele: puudub'

      // Filter out students with OPPURSTAATUS_K (studentIsDeleted: true) from journalEntryStudents if present
      if (Array.isArray(payload.journalEntryStudents)) {
        const studentPromises = payload.journalEntryStudents.map(async student => {
          const journalStudentId = student.journalStudent
          if (!journalStudentId) return student // Keep if no ID

          const studentId = this.journalStudentIdToStudentId[journalStudentId]
          if (!studentId) {
            Logger.warning(`[syncAssignmentNameDifferences] No studentId mapping for journalStudentId: ${journalStudentId}`)
            return student // Keep if no mapping
          }

          try {
            const studentDetails = await this.getStudentDetails(studentId)
            if (studentDetails && studentDetails.status === 'OPPURSTAATUS_K') {
              if (Logger.isDebugMode()) {
                Logger.debug(
                  `[syncAssignmentNameDifferences] Filtering out student ${studentDetails.person.lastname} (journalStudentId: ${journalStudentId}) with status OPPURSTAATUS_K`
                )
              }
              return null // Filter out
            }
          } catch (error) {
            Logger.error(`[syncAssignmentNameDifferences] Failed to get details for studentId ${studentId}, keeping in payload to be safe.`, error)
          }

          return student // Keep by default
        })

        payload.journalEntryStudents = (await Promise.all(studentPromises)).filter(Boolean)
      }

      if (Logger.isDebugMode()) {
        Logger.debug(`✨ [syncAssignmentNameDifferences] PUT /journals/${journalId}/journalEntry/${assignmentId} with payload: ${JSON.stringify(payload)}`)
      }
      try {
        await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, payload)
        // Invalidate cache for this journal so next fetch is fresh
        if (typeof cacheService?.clearJournalCache === 'function') {
          await cacheService.clearJournalCache(journalId)
          if (Logger.isDebugMode()) Logger.debug(`✨ Cleared cache for journalId=${journalId} after assignment update`)
        }
        if (Logger.isDebugMode()) {
          Logger.debug(`✨ Updated assignment in Tahvel: ${assignmentId} with changes: ${JSON.stringify(update)}`)
        }
      } catch (error) {
        Logger.error(`Failed to update assignment for journalId=${journalId}, assignmentId=${assignmentId}: ${error.message}`)
      }
    }
  }
  /**
   * Extract assignment name differences from Kriit response
   */
  extractAssignmentNameDifferences() {
    Logger.debug('✨ [extractAssignmentNameDifferences] Called')
    const groupedDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      Logger.debug('✨ [extractAssignmentNameDifferences] No differences array found.')
      return groupedDiffs
    }
    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        const nameDiffs = subject.assignments
          .filter(a => {
            if (a.assignmentName && typeof a.assignmentName === 'object') {
              // Only show difference if both are present and different
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

  extractDueDateDifferences() {
    const dueDateDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      return dueDateDiffs
    }
    this.differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (
          assignment.assignmentDueAt &&
          typeof assignment.assignmentDueAt === 'object'
        ) {
          const kriitDue = assignment.assignmentDueAt.kriit
          const tahvelDue = assignment.assignmentDueAt.Tahvel
          if (
            (kriitDue !== tahvelDue) &&
            !(kriitDue == null && tahvelDue == null)
          ) {
            let assignmentName = assignment.assignmentName
            if (assignmentName && typeof assignmentName === 'object') {
              assignmentName = assignmentName.kriit || assignmentName.Tahvel || ''
            }
            dueDateDiffs.push({
              assignmentExternalId: assignment.assignmentExternalId,
              assignmentName,
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

  /**
   * Send only outcome entries (SISSEKANNE_O) to Kriit API
   */
  async sendOutcomeEntriesToKriit() {
    if (!this.api || !this.api.kriit || !this.api.kriit.authToken) {
      Logger.error('No Kriit API token set')
      return
    }
    if (!this.journalLinks || this.journalLinks.length === 0) {
      Logger.warning('No journal links available for outcome sync')
      return
    }
    Logger.debug('Triggering outcome sync (outcome entries only)')
    await sendOutcomeEntriesToKriit(this.api, this.journalLinks)
  }
  constructor() {
    // Define selectors for journal links - using the most reliable selector first
    const journalLinkSelectors = [
      // Primary selector that works reliably
      '#main-content md-table-container td:nth-child(2) > a',

      // Fallback selectors in case the primary one doesn't work
      '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a',
      '#main-content a[ng-href^="/#/journal/"][ng-if="row.canEdit"]',
      'a[href^="/#/journal/"]'
    ]

    // Match the journal list page URL pattern and pass required selectors
    super('journalListSync', /#\/journals\?_menu/, journalLinkSelectors)

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

    // Set up message listener for settings changes using global service
    setupKriitMessageListener(this)
  }

  /**
   * Called when the feature is activated
   * @param {NodeList} elements - The found elements (journal links)
   */
  onActivate(elements) {
    this.isActive = true
    // Only activate if the URL is exactly 'journals?_menu'
    const url = window.location.hash.replace(/^#\/?/, '').split('&')[0]
    if (url !== 'journals?_menu') {
      Logger.debug('JournalListSync not activated: URL does not match journals?_menu')
      return
    }

    // Log a specific message for this feature's activation
    Logger.feature(this.name, 'Journal List Sync feature initialized')

    if (Logger.isDebugMode()) Logger.debug('[DEBUG] onActivate: elements', elements)

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
      Logger.warning('No Kriit API token found - JournalListSync feature will be disabled')
      this.showMissingApiKeyBanner()
    }
  }

  /**
   * Called when the feature is deactivated
   */
  onDeactivate() {
    this.isActive = false
    // Call parent method to clean up observers
    super.onDeactivate()

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
   * @param {NodeList} elements - The found elements
   * @param {string} selector - The selector that matched
   */
  onRequiredElementsFound(elements, selector) {
    Logger.debug(`Found ${elements.length} journal links with selector: ${selector}`)
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

  /**
   * Fetch journal data from Tahvel and check for differences with Kriit
   */
  async fetchJournalData() {
    try {
      if (Logger.isDebugMode()) Logger.debug('[DEBUG] fetchJournalData called')
      this.isLoading = true
      this.updateUI()

      // Always get the latest journal links from the DOM to handle filtering/sorting
      const journalLinkSelectors = [
        '#main-content md-table-container td:nth-child(2) > a',
        '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a',
        '#main-content a[ng-href^="/#/journal/"][ng-if="row.canEdit"]',
        'a[href^="/#/journal/"]'
      ]
      this.journalLinks = document.querySelectorAll(journalLinkSelectors.join(', '))
      Logger.debug(`Re-scanned for journal links, found ${this.journalLinks.length}`)

      // Verify that we have journal links
      if (!this.journalLinks || this.journalLinks.length === 0) {
        Logger.warning('No journal links available for data collection')
        this.isLoading = false
        this.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
        this.updateUI()
        return
      }

      // Collect data from Tahvel
      const journalData = await this.collectJournalData()
      // Store Tahvel assignments for due date diff feature
      if (!window.journalListSync) window.journalListSync = {}

      // Validate data before sending
      if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
        Logger.warning('No journal data to send to Kriit')
        this.isLoading = false
        this.differences = []
        this.updateUI()
        return
      }

      // Send data to Kriit immediately
      this.isLoading = true
      this.error = null
      this.differences = []

      // Make the API call directly
      await this.proceedWithKriitApiCall(journalData)

      // Automatically sync outcome entries (SISSEKANNE_O) to Kriit
      await this.sendOutcomeEntriesToKriit()
    } catch (error) {
      Logger.error('Error fetching journal data:', error)
      this.isLoading = false

      // Provide more specific error messages based on the error
      if (!this.journalLinks || this.journalLinks.length === 0) {
        this.error = 'No journal links found on the page. Please make sure you are on the journal list page.'
      } else if (error.message && error.message.includes('404')) {
        this.error = 'API endpoint not found (404). Please check if you are on the correct page.'
      } else if (error.message && error.message.includes('403')) {
        this.error = 'Authentication error (403). Please check your Kriit API token.'
      } else if (error.message && error.message.includes('undefined')) {
        this.error = 'Data processing error: ' + error.message + '. This may be due to missing student group data.'
      } else {
        this.error = error.message || 'Failed to fetch data'
      }

      Logger.debug('Setting error message:', this.error)

      // Reset differences to empty array
      this.differences = []

      this.updateUI()
    }
  }

  /**
   * Collect journal data from Tahvel
   * @returns {Promise<Array>} Array of journal data objects
   */
  async collectJournalData() {
    try {
      Logger.debug('Collecting journal data from Tahvel')
      Logger.debug('Using Tahvel API base URL:', this.api.tahvel.baseUrl)

      if (!this.journalLinks || this.journalLinks.length === 0) {
        Logger.warning('No journal links available for data collection')
        return []
      }

      Logger.debug(`Using ${this.journalLinks.length} journal links for data collection`)

      const journalPromises = Array.from(this.journalLinks).map(async link => {
        const href = link.getAttribute('href') || link.getAttribute('ng-href') || ''
        let id = null
        const idMatch = href.match(/\/journal\/([0-9]+)/)
        if (idMatch && idMatch[1]) {
          id = parseInt(idMatch[1], 10)
        } else {
          const parts = href.split('/')
          if (parts.length >= 4) {
            id = parseInt(parts[3], 10)
          }
        }

        if (!id) {
          Logger.warning(`Could not extract journal ID from href: ${href}`)
          return null
        }

        const name = link.textContent.trim()

        try {
          const [journalInfo, journalEntries, journalEntriesWithGrades, journalStudents] = await Promise.all([
            this.getJournalInfo(id),
            this.getJournalEntries(id),
            this.getJournalEntriesWithGrades(id),
            this.getJournalStudents(id)
          ])

          if (!journalInfo) {
            Logger.warning(`Could not get info for journal ${id}`)
            return null
          }
          if (!Array.isArray(journalEntries)) {
            Logger.warning(`Could not get entries for journal ${id}`)
            return null
          }
          if (!Array.isArray(journalStudents)) {
            return null
          }

          if (journalInfo.studentGroups) {
            Logger.debug(`Journal ${id} student groups:`, JSON.stringify(journalInfo.studentGroups))
          }

          const studentDetailsMap = await this.processStudentData(id, journalStudents)
          const studentMap = this.createStudentMap(journalStudents, studentDetailsMap)

          // Merge homeworkDuedate and other missing fields from journalEntries into journalEntriesWithGrades
          let mergedEntries
          if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0 && journalEntries && journalEntries.length > 0) {
            // Create a map of /journalEntry entries by id
            const entryById = {}
            journalEntries.forEach(e => {
              if (e && e.id) entryById[e.id] = e
            })
            // For each entry in journalEntriesWithGrades, copy homeworkDuedate if present in /journalEntry
            mergedEntries = journalEntriesWithGrades.map(e => {
              if (e && e.id && entryById[e.id]) {
                // Only copy homeworkDuedate if not present or is undefined/null
                if (!e.homeworkDuedate && entryById[e.id].homeworkDuedate) {
                  return { ...e, homeworkDuedate: entryById[e.id].homeworkDuedate }
                }
              }
              return e
            })
          } else if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0) {
            mergedEntries = journalEntriesWithGrades
          } else {
            mergedEntries = journalEntries
          }
          const assignments = this.extractAssignmentsFromEntries(mergedEntries, studentMap, journalStudents, studentDetailsMap, journalEntriesWithGrades)

          // Get last lesson date from timetable
          let lastLessonDate = null
          try {
            lastLessonDate = await this.getLastLessonDate(id, journalInfo)
          } catch (error) {
            Logger.warning(`Could not get last lesson date for journal ${id}:`, error)
          }

          let teacherName = ''
          let teacherPersonalCode = ''

          if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
            const teacher = journalInfo.journalTeachers[0]
            teacherName = teacher.nameEt || teacher.fullname || ''

            if (teacherName) {
              try {
                const teacherId = teacher.id
                if (!teacherId) {
                  Logger.warning(`No teacher ID available for teacher ${teacherName}`)
                } else {
                  // Use the shared global teacher cache function to prevent duplicate requests
                  const teacherData = await getTeacherPersonalCodeCached(this.api, teacher)
                  teacherPersonalCode = teacherData.personalCode

                  // Also store in instance cache for backward compatibility
                  this.globalTeacherCache[teacherId] = teacherData
                }
              } catch (error) {
                Logger.warning(`Failed to get teacher personal code: ${error.message}`)
              }
            }
          }

          // Handle multigroup journals by creating separate entries for each group
          const studentGroups = []
          if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
            studentGroups.push(...journalInfo.studentGroups)
          } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
            studentGroups.push(journalStudents[0].studentGroup)
          }

          // If no groups found, create a single entry with empty group name
          if (studentGroups.length === 0) {
            return {
              subjectName: journalInfo.nameEt || name,
              subjectExternalId: id,
              groupName: '',
              teacherPersonalCode,
              teacherName,
              assignments,
              lastLessonDate
            }
          }

          // For multigroup journals, create separate entries for each group
          const groupJournalEntries = []

          // Debug logging for multigroup journals
          if (studentGroups.length > 1) {
            if (assignments.length > 0) {
              Logger.debug(`First assignment "${assignments[0].assignmentName}" has ${assignments[0].results.length} students`)
            }
          }

          for (const groupName of studentGroups) {
            // Filter assignments to include only students from this group
            const filteredAssignments = assignments
              .map(assignment => {
                const filteredResults = assignment.results.filter(result => {
                  // Find the student in journalStudents to get their group
                  const student = journalStudents.find(js => {
                    const studentId = studentMap.journalStudentIdToId[js.id.toString()]
                    const personalCode = studentMap.idToPersonalCode[studentId]
                    // No-op block removed (was empty)
                    return personalCode === result.studentPersonalCode
                  })
                  // Include student if they belong to this group
                  // No-op block removed (was empty)
                  return student && student.studentGroup === groupName
                })
                return {
                  ...assignment,
                  results: filteredResults
                }
              })
              .filter(assignment => assignment.results.length > 0) // Only include assignments with students

            groupJournalEntries.push({
              subjectName: journalInfo.nameEt || name,
              subjectExternalId: id,
              groupName,
              teacherPersonalCode,
              teacherName,
              assignments: filteredAssignments,
              lastLessonDate
            })
          }

          return groupJournalEntries
        } catch (error) {
          Logger.error(`Failed to process journal ${id}:`, error)
          return null
        }
      })

      const results = await Promise.all(journalPromises)
      // Flatten the results as some journals may return arrays of group entries
      const journalData = results.filter(r => r !== null).flatMap(result => (Array.isArray(result) ? result : [result]))

      Logger.debug(`Collected data for ${journalData.length} journals`)
      return journalData
    } catch (error) {
      Logger.error('Error collecting journal data:', error)
      throw error
    }
  }

  /**
   * Process student data with caching
   * @param {number} journalId - Journal ID
   * @param {Array} journalStudents - Journal students
   * @returns {Promise<Object>} Student details map
   */
  async processStudentData(journalId, journalStudents) {
    const studentDetailsMap = {}

    // Process each journal student to get their personal code
    if (journalStudents && Array.isArray(journalStudents)) {
      // Initialize pending requests tracker if not exists
      if (!this.pendingStudentRequests) {
        this.pendingStudentRequests = new Map()
      }

      // Create an array to hold all promises
      const studentPromises = journalStudents.map(async journalStudent => {
        if (!journalStudent || !journalStudent.studentId) return null

        // Check if we already have this student in the API cache
        try {
          const studentDetails = await this.getStudentDetails(journalStudent.studentId)
          if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
            const isActive = studentDetails.status === 'OPPURSTAATUS_O'
            const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'

            const cachedStudent = {
              personalCode: studentDetails.person.idcode,
              name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`,
              isActive: isActive,
              isDeleted: isDeleted
            }

            // Store the mapping for later lookups
            this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

            return {
              studentId: journalStudent.studentId,
              data: cachedStudent
            }
          }
        } catch (error) {
          // If not in cache or error, continue to fetch it below
          Logger.debug(`Student ${journalStudent.studentId} not in API cache, will fetch`)
        }

        // Check if there's already a pending request for this student
        if (this.pendingStudentRequests.has(journalStudent.studentId)) {
          Logger.debug(`Student ${journalStudent.studentId} request already in progress - waiting for result`)
          try {
            const data = await this.pendingStudentRequests.get(journalStudent.studentId)
            return { studentId: journalStudent.studentId, data }
          } catch (error) {
            Logger.error(`Error waiting for pending student request ${journalStudent.studentId}:`, error)
            return { studentId: journalStudent.studentId, data: null }
          }
        }

        // Use cacheService to get or fetch student details
        const cacheKey = `student_${journalStudent.studentId}_details`

        // Define the fetch function to get student details if not in cache
        const fetchStudentDetails = async() => {
          try {
            Logger.debug(`Making API call for student ${journalStudent.studentId}`)
            const details = await this.getStudentDetails(journalStudent.studentId)

            if (details && details.person && details.person.idcode) {
              // OPPURSTAATUS_O means active (studying)
              // OPPURSTAATUS_A means on academic leave (not active)
              // OPPURSTAATUS_K means 'katkestanud' (exmatriculated)
              const isActive = details.status === 'OPPURSTAATUS_O'
              const isDeleted = details.status === 'OPPURSTAATUS_K'

              return {
                personalCode: details.person.idcode,
                name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`,
                isActive: isActive,
                isDeleted: isDeleted
              }
            }
            return null
          } catch (error) {
            Logger.error(`Error fetching details for student ${journalStudent.studentId}:`, error)
            return null
          }
        }

        // Create the fetch promise and store it in pending requests
        const fetchPromise = (async() => {
          try {
            const studentData = await cacheService.getOrFetch(
              cacheKey,
              fetchStudentDetails,
              24 * 60 * 60 * 1000 // 24 hours
            )

            if (studentData) {
              // Store the mapping from journalStudentId to studentId for API cache lookups
              this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
              Logger.debug(
                `✓ Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentData.personalCode} - ${studentData.name})`
              )
            }

            return studentData
          } catch (error) {
            Logger.error(`Error getting cached data for student ${journalStudent.studentId}:`, error)
            return null
          } finally {
            // Clean up the pending request
            this.pendingStudentRequests.delete(journalStudent.studentId)
          }
        })()

        // Store the promise in pending requests
        this.pendingStudentRequests.set(journalStudent.studentId, fetchPromise)

        // Wait for the result
        try {
          const studentData = await fetchPromise
          return { studentId: journalStudent.studentId, data: studentData }
        } catch (error) {
          Logger.error(`Error processing student ${journalStudent.studentId}:`, error)
          return { studentId: journalStudent.studentId, data: null }
        }
      })

      // Process all students in parallel
      const results = await Promise.all(studentPromises)

      // Process results and add to studentDetailsMap
      for (const result of results) {
        if (result && result.data) {
          studentDetailsMap[result.studentId] = result.data
        }
      }
    }

    return studentDetailsMap
  }

  /**
   * Update the UI based on current state
   */
  updateUI() {
    if (!this.isActive) return
    // Don't remove banner if we're currently syncing (loading state)
    if (!this.isLoading) {
      bannerService.removeBanner()
    }

    if (this.isLoading) {
      // If banner doesn't exist yet, create it; otherwise just update the content
      if (!bannerService.hasBanner()) {
        bannerService.showLoadingBanner()
      }
      return
    }

    if (this.error) {
      this.showErrorBanner()
      return
    }

    if (this.differences && this.differences.length > 0) {
      // Check if there are actual grade differences to sync
      const totalDifferences = this.countTotalDifferences()
      if (totalDifferences > 0) {
        this.showDifferencesBanner()
      } else {
        // Show green success banner when everything is in sync
        this.showAllInSyncBanner()
      }
    }
  }

  /**
   * Update progress UI during sync
   * @param {number} current - Current progress
   * @param {number} total - Total items
   */
  updateProgressUI(current, total) {
    if (!this.isActive) return
    // Show progress banner during sync
    bannerService.updateProgressUI(current, total, 'Sünkroniseerin hindeid Kriidist Tahvlisse...')
  }

  /**
   * Show success banner
   * @param {string} message - Success message
   */
  showSuccessBanner(message) {
    if (!this.isActive) return
    // Show success banner with refresh and close actions
    bannerService.showSuccessBanner(message, {
      onRefresh: () => this.fetchJournalData(),
      onClose: () => bannerService.removeBanner()
    })
  }

  /**
   * Show error banner
   */
  showErrorBanner() {
    const options = {
      onRetry: () => this.fetchJournalData(),
      onClearCache: () => {
        this.clearCache().then(result => {
          alert(
            `Puhastatud ${result.total} vahemälu kirjet:\n` +
              `- API vahemälu: ${result.api} kirjet\n` +
              `- Funktsiooni vahemälu: ${result.feature} kirjet\n` +
              `- Mälu vahemälu: ${result.runtime} kirjet\n\n` +
              'Klõpsake "Proovi uuesti" värske andmete saamiseks.'
          )
        })
      },
      onSettings: () => this.resetKriitApiToken(),
      onRefresh: () => window.location.reload()
    }

    journalSyncBannerService.showSyncErrorBanner(this.error, options)
  }

  /**
   * Show a banner when the Kriit API key is missing
   */
  showMissingApiKeyBanner() {
    journalSyncBannerService.showMissingApiKeyBanner()
  }

  /**
   * Show green banner when all grades are in sync
   */
  showAllInSyncBanner() {
    journalSyncBannerService.showAllInSyncBanner(
      () => this.fetchJournalData(),
      () => bannerService.removeBanner()
    )
  }

  /**
   * Show differences banner
   */
  showDifferencesBanner() {
    const totalDifferences = this.countTotalDifferences()

    // Print each detected grade difference with details only in debug mode
    if (Logger.isDebugMode() && Array.isArray(this.differences)) {
      this.differences.forEach(subject => {
        if (subject && Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            if (assignment && Array.isArray(assignment.results)) {
              assignment.results.forEach(result => {
                const tahvelGrade = result.currentGrade || '(puudub)'
                const kriitGrade = result.grade || '(puudub)'
                // Only log if there is a difference and kriitGrade is not null/empty
                if (kriitGrade !== '(puudub)' && tahvelGrade !== kriitGrade) {
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
    journalSyncBannerService.showDifferencesBanner(
      totalDifferences,
      async() => {
        await this.syncAssignmentNameDifferences()
        await this.syncWithKriit()
        await this.fetchJournalData()
      },
      () => this.fetchJournalData(),
      container => {
        const assignmentNameDiffs = this.extractAssignmentNameDifferences()
        const gradeDiffs = Array.isArray(this.differences) ? this.differences : []
        const dueDateDiffs = this.extractDueDateDifferences()
        const entryDateDiffs = this.extractEntryDateDifferences()
        differenceRenderer.render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs)
      }
    )
  }

  /**
   * Remove sync banner from the DOM (used by message listener through context)
   */
  // noinspection JSUnusedGlobalSymbols
  removeSyncBanner() {
    bannerService.removeBanner()
  }

  /**
   * Set Kriit API token and save to chrome.storage
   * @param {string} token - API token
   */
  setKriitApiToken(token) {
    if (!token) {
      Logger.error('Invalid token provided')
      return
    }

    // Save token to chrome.storage.sync
    chrome.storage.sync.set({ OA_kriitApiToken: token }, () => {
      // Update API service
      this.api.kriit.setAuthToken(token)

      Logger.debug('Kriit API token updated')

      // Refresh data
      this.fetchJournalData()
    })
  }

  /**
   * Reset Kriit API token and prompt for a new one
   */
  resetKriitApiToken() {
    // Remove current token
    chrome.storage.sync.remove(['OA_kriitApiToken'], () => {
      // Prompt user for a new token
      const newToken = prompt('Please enter your Kriit API token:', '')

      if (newToken) {
        // Set the new token
        this.setKriitApiToken(newToken)
        Logger.debug('New Kriit API token set')
      } else {
        // User cancelled or provided empty token
        this.error = 'No token provided. Please set a valid Kriit API token.'
        this.updateUI()
      }
    })
  }

  /**
   * Clear all cache data
   * @returns {Promise<Object>} Number of cache entries cleared
   */
  async clearCache() {
    // Clear the teacher runtime cache
    const teacherRuntimeCacheSize = Object.keys(this.globalTeacherCache).length

    this.globalTeacherCache = {}

    // Clear the module-level teacher cache too
    const moduleTeacherCacheSize = Object.keys(globalModuleTeacherCache).length
    Object.keys(globalModuleTeacherCache).forEach(key => {
      delete globalModuleTeacherCache[key]
    })

    // Clear pending teacher requests
    pendingTeacherRequests.clear()

    // Clear all caches using the CacheService
    const cacheCount = await cacheService.clearCache()

    const totalCleared = teacherRuntimeCacheSize + moduleTeacherCacheSize + cacheCount

    Logger.debug(`Cleared ${totalCleared} total cache entries:`)
    Logger.debug(`- Cache service: ${cacheCount} entries`)
    Logger.debug(`- Teacher runtime cache: ${teacherRuntimeCacheSize} entries`)
    Logger.debug(`- Module teacher cache: ${moduleTeacherCacheSize} entries`)

    return {
      total: totalCleared,
      api: cacheCount,
      feature: 0, // No longer separately tracked as we use CacheService for everything
      runtime: teacherRuntimeCacheSize + moduleTeacherCacheSize,
      students: 0, // Students now handled by CacheService
      teachers: teacherRuntimeCacheSize + moduleTeacherCacheSize
    }
  }

  /**
   * Proceed with the actual Kriit API call
   * @param {Array} [providedJournalData] - Optional journal data to use instead of collecting fresh data
   */
  async proceedWithKriitApiCall(providedJournalData = null) {
    try {
      this.isLoading = true
      this.updateUI()

      // Use provided data or collect fresh data
      const journalData = providedJournalData || (await this.collectJournalData())

      // Check if we have valid data
      if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
        Logger.error('No valid journal data to send to Kriit')
        this.error = 'No valid journal data to send to Kriit'
        this.isLoading = false
        this.updateUI()
        return
      }

      // Log the request data
      Logger.debug('Sending request to Kriit API:', JSON.stringify(journalData))

      // Check if we have a Kriit API token
      if (!this.api.kriit.authToken) {
        Logger.error('No Kriit API token set')
        this.error = 'No Kriit API token set. Please set a token in the extension settings.'
        this.isLoading = false
        this.updateUI()
        return
      }

      try {
        // Make the actual API call
        const response = await this.api.kriit.post('/subjects/getDifferences', journalData)
        // Store Kriit assignments for due date diff feature
        if (!window.journalListSync) window.journalListSync = {}

        // Log the full response for debugging
        Logger.debug('Raw response from Kriit:', JSON.stringify(response))

        // Process the response directly
        if (response && Array.isArray(response)) {
          this.differences = response
          Logger.debug('Response is an array with', response.length, 'items')
        } else if (response && response.data && Array.isArray(response.data)) {
          this.differences = response.data
          Logger.debug('Response has a data property with', response.data.length, 'items')
        } else if (response && response.status === 200) {
          // This is a success response with no differences
          Logger.debug('Received status 200 response from Kriit - no differences found')
          this.differences = []

          // Show a success message to the user
          this.isLoading = false
          this.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
          // Ensure global differences is cleared
          if (!window.journalListSync) window.journalListSync = {}
          window.journalListSync.differences = this.differences
          this.updateUI()
          return
        } else {
          if (Logger.isDebugMode()) Logger.debug('[DEBUG] Backend response is not an array:', response)
          Logger.warning('Unexpected response format from Kriit:', response)
          this.differences = []
        }

        // Always update global differences after setting this.differences
        if (!window.journalListSync) window.journalListSync = {}
        window.journalListSync.differences = this.differences
      } catch (error) {
        Logger.error('Error calling Kriit API:', error)

        // Show error details
        this.error = `Error calling Kriit API: ${error.message}`
        this.isLoading = false
        this.updateUI()
        return
      }
      this.isLoading = false
      this.error = null

      // Map subject IDs to names from our collected data and enhance the differences with additional data
      if (Array.isArray(this.differences) && Array.isArray(journalData)) {
        this.differences.forEach(diff => {
          // Find matching subject in our data
          const matchingSubject = journalData.find(s => s.subjectExternalId === diff.subjectExternalId)
          if (matchingSubject) {
            // Add subject name from our data
            diff.subjectName = matchingSubject.subjectName
            diff.groupName = matchingSubject.groupName

            // Process each assignment
            if (diff.assignments && Array.isArray(diff.assignments)) {
              diff.assignments.forEach(diffAssignment => {
                // Find matching assignment in our data
                const matchingAssignment = matchingSubject.assignments.find(a => a.assignmentExternalId === diffAssignment.assignmentExternalId)

                if (matchingAssignment) {
                  const kriitAssignment = diffAssignment
                  const tahvelAssignment = matchingAssignment

                  const normalizeDate = val => {
                    if (!val) return null
                    if (typeof val === 'string' && val.length >= 10) return val.slice(0, 10)
                    return val
                  }

                  const compareAndCreateDiff = fieldName => {
                    let kriitValue = kriitAssignment[fieldName]
                    let tahvelValue = tahvelAssignment[fieldName]

                    // For date fields, normalize to YYYY-MM-DD
                    if (fieldName === 'assignmentEntryDate' || fieldName === 'assignmentDueAt') {
                      kriitValue = normalizeDate(kriitValue)
                      tahvelValue = normalizeDate(tahvelValue)
                    }

                    // Normalize undefined to null for comparison
                    const normKriit = kriitValue === undefined ? null : kriitValue
                    const normTahvel = tahvelValue === undefined ? null : tahvelValue

                    // Only show a difference if Kriit has a value and it's different from Tahvel's
                    if (normKriit !== null && normKriit !== normTahvel) {
                      diffAssignment[fieldName] = { kriit: kriitValue, Tahvel: tahvelValue }
                    } else {
                      // If they are the same or Kriit is null, just use Tahvel's value.
                      diffAssignment[fieldName] = tahvelValue
                    }
                  }

                  compareAndCreateDiff('assignmentName')
                  compareAndCreateDiff('assignmentDueAt')
                  compareAndCreateDiff('assignmentEntryDate')

                  // Process each result
                  if (diffAssignment.results && Array.isArray(diffAssignment.results)) {
                    diffAssignment.results.forEach(diffResult => {
                      // Find matching student in our data
                      const matchingResult = matchingAssignment.results.find(r => r.studentPersonalCode === diffResult.studentPersonalCode)

                      if (matchingResult) {
                        // Add student name and active status from our data
                        // Kriit response for result has studentName, but we'll trust Tahvel's for consistency.
                        diffResult.studentName = matchingResult.studentName
                        diffResult.studentIsActive = matchingResult.studentIsActive
                        diffResult.studentIsDeleted = matchingResult.studentIsDeleted

                        // Add the Tahvel grade as currentGrade for UI display
                        diffResult.currentGrade = matchingResult.grade
                      }
                    })
                  }
                }
              })
            }
          }
        })
      }

      //Logger.debug('Processed differences:', JSON.stringify(this.differences))
      this.updateUI()
    } catch (error) {
      Logger.error('Error calling Kriit API:', error)
      this.isLoading = false
      this.error = error.message || 'Failed to call Kriit API'
      this.updateUI()
    }
  }

  /**
   * Count total number of differences
   * @returns {number} Total number of differences
   */
  countTotalDifferences() {
    let count = 0

    if (!this.differences || !Array.isArray(this.differences)) return 0

    // Count grade differences
    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        subject.assignments.forEach(assignment => {
          if (assignment && Array.isArray(assignment.results)) {
            assignment.results.forEach(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'
              // Count as difference if either grade is missing or different
              if (tahvelGrade !== kriitGrade) {
                count++
              }
            })
          }
        })
      }
    })

    // Count assignment name differences
    const assignmentNameDiffs = this.extractAssignmentNameDifferences()
    assignmentNameDiffs.forEach(subject => {
      if (subject.nameDiffs && subject.nameDiffs.length > 0) {
        count += subject.nameDiffs.length
      }
    })

    // Count due date differences
    const dueDateDiffs = this.extractDueDateDifferences()
    count += dueDateDiffs.length

    // Count entry date differences
    const entryDateDiffs = this.extractEntryDateDifferences()
    count += entryDateDiffs.length

    return count
  }

  /**
   * Get last lesson date from timetable
   * @param {number} journalId - Journal ID
   * @param {Object} journalInfo - Journal info object (already fetched)
   * @returns {Promise<string|null>} Last lesson date in ISO format or null if not found
   */
  async getLastLessonDate(journalId, journalInfo) {
    try {
      if (!journalInfo) {
        return null
      }

      const schoolId = journalInfo.school?.id || 9 // Fallback to school ID 9
      const teacherId = journalInfo.journalTeachers?.[0]?.id

      if (!teacherId) {
        Logger.debug(`No teacher ID available for journal ${journalId}`)
        return null
      }

      // Get study year dates
      const now = new Date()
      const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
      const from = journalInfo.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
      const thru = journalInfo.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`

      const timetableData = await this.api.tahvel.get(endpoint, {}, {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000  // 24 hours cache
      })

      if (!timetableData?.timetableEvents) {
        return null
      }

      // Filter timetable events for this specific journal
      const journalTimetable = timetableData.timetableEvents.filter(event => event.journalId == journalId)

      if (journalTimetable.length === 0) {
        return null
      }

      // Sort by date and get the last lesson
      const sortedTimetable = journalTimetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
      const lastLessonDate = sortedTimetable[sortedTimetable.length - 1]?.date

      return lastLessonDate || null

    } catch (error) {
      Logger.warning(`Error getting last lesson date for journal ${journalId}:`, error)
      return null
    }
  }

  /**
   * Get journal info from API with caching
   * @param {number} journalId - Journal ID
   * @returns {Promise<Object>} Journal info
   */
  async getJournalInfo(journalId) {
    // Use the built-in API service caching with a long expiration
    return this.api.tahvel.get(
      `/journals/${journalId}`,
      {},
      {
        cacheExpiration: 30 * 24 * 60 * 60 * 1000 // 30 days
      }
    )
  }

  /**
   * Get journal entries from API - never cached
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array>} Journal entries
   */
  async getJournalEntries(journalId) {
    try {
      // Use cache for 10 minutes to avoid excessive requests
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntry`,
        {},
        {
          cache: true,
          cacheExpiration: 10 * 60 * 1000 // 10 minutes
        }
      )

      // The response is paginated with a different structure than journalEntriesByDate
      // Extract the content array which contains the actual entries
      if (response && response.content && Array.isArray(response.content)) {
        return response.content
      }
      Logger.warning(`Unexpected response format from journalEntry endpoint: ${JSON.stringify(response)}`)
      return []
    } catch (error) {
      return null
    }
  }

  /**
   * Get journal entries with grades from API - never cached
   * This uses the journalEntriesByDate endpoint which includes the journalStudentResults field
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array>} Journal entries with grades
   */
  async getJournalEntriesWithGrades(journalId) {
    try {
      // Use cache for 10 minutes to avoid excessive requests
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        {
          cache: true,
          cacheExpiration: 10 * 60 * 1000 // 10 minutes
        }
      )

      if (Array.isArray(response)) {
        return response
      }
      Logger.warning(`Unexpected response format from journalEntriesByDate endpoint: ${JSON.stringify(response)}`)
      return []
    } catch (error) {
      return null
    }
  }

  /**
   * Get journal students from API with caching
   * @param {number} journalId - Journal ID
   * @returns {Promise<Array>} Journal students
   */
  async getJournalStudents(journalId) {
    try {
      if (Logger.isDebugMode()) {
        Logger.debug(`🔍 Fetching journal students for journal ${journalId}`)
      }

      // Use a shorter cache time (1 hour) to ensure data is relatively fresh
      // Use allStudents=true to get all students including their personal codes
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalStudents`,
        { allStudents: true },
        {
          cacheExpiration: 60 * 60 * 1000 // 1 hour
        }
      )

      if (response) {
        if (Logger.isDebugMode()) {
          Logger.debug(`✅ Retrieved ${response.length} journal students from API`)
        }

        // === ENHANCED DEBUG: LOG JOURNAL STUDENTS API RESPONSE ===
        if (response.length > 0) {
          const sampleStudent = response[0]
          if (Logger.isDebugMode()) {
            Logger.debug('=== JOURNAL STUDENTS API RESPONSE SAMPLE ===')
            Logger.debug(`Sample student structure: ${JSON.stringify(Object.keys(sampleStudent))}`)
            Logger.debug(`Sample student data: ${JSON.stringify(sampleStudent)}`)
          }

          // Check for personal codes structure - handle new API format
          const hasStudentObject = sampleStudent.student ? 'YES' : 'NO'
          const hasPersonalCodeInStudent = sampleStudent.student?.idcode ? 'YES' : 'NO'
          const hasDirectPersonalCode = sampleStudent.idcode ? 'YES' : 'NO'

          Logger.debug(`Has student object: ${hasStudentObject}, Has personal code in student: ${hasPersonalCodeInStudent}, Has direct personal code: ${hasDirectPersonalCode}`)
          Logger.debug('=== END JOURNAL STUDENTS API RESPONSE SAMPLE ===')
        }

        // Check if we have personal codes in the response (old format)
        const hasPersonalCodes = response.some(student => student.student?.idcode)
        if (Logger.isDebugMode()) {
          Logger.debug(`Personal codes available in response (old format): ${hasPersonalCodes}`)
        }

        if (hasPersonalCodes) {
          Logger.debug('Journal students response includes personal codes, updating mapping')

          // Update our mapping with the personal codes
          for (const journalStudent of response) {
            if (journalStudent.student && journalStudent.student.idcode && journalStudent.studentId) {
              // Store the mapping from journalStudentId to studentId
              this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
              Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${journalStudent.student.idcode})`)
            }
          }
        } else {
          Logger.warning('⚠️ Journal students response does NOT include personal codes in old format')
          if (Logger.isDebugMode()) {
            Logger.debug('🔧 Attempting to fetch personal codes for each student individually...')
          }

          // New approach: For each journal student, fetch their personal code from the student details API
          for (const journalStudent of response) {
            if (journalStudent.studentId) {
              try {
                if (Logger.isDebugMode()) {
                  Logger.debug(`📡 Fetching personal code for studentId ${journalStudent.studentId}`)
                }

                // Get student details to find personal code
                const studentDetails = await this.getStudentDetails(journalStudent.studentId)

                if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
                  // Store the mapping
                  this.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

                  if (Logger.isDebugMode()) {
                    Logger.debug(`✅ Found personal code for studentId ${journalStudent.studentId}: ${studentDetails.person.idcode}`)
                    Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentDetails.person.idcode})`)
                  }

                  // Create a compatible structure for the rest of the code
                  journalStudent.student = {
                    idcode: studentDetails.person.idcode,
                    fullname: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
                    status: studentDetails.status
                  }
                } else {
                  Logger.warning(`❌ Could not fetch personal code for studentId ${journalStudent.studentId}`)
                }
              } catch (error) {
                Logger.warning(`❌ Error fetching personal code for studentId ${journalStudent.studentId}: ${error.message}`)
              }
            }
          }

          // Check how many personal codes we successfully retrieved
          const studentsWithPersonalCodes = response.filter(student => student.student?.idcode).length
          if (Logger.isDebugMode()) {
            Logger.debug(`📊 Successfully retrieved personal codes for ${studentsWithPersonalCodes}/${response.length} students`)
          }
        }
      } else {
        Logger.error(`❌ No response received from journal students API for journal ${journalId}`)
      }

      return response
    } catch (error) {
      Logger.error(`❌ Error fetching journal students for journal ${journalId}: ${error.message}`)
      return null
    }
  }
  /**
   * Get detailed student information including personal code
   * @param {number} studentId - Student ID
   * @returns {Promise<Object>} Student details
   */
  async getStudentDetails(studentId) {
    // Use the built-in API service caching with a very long expiration
    return this.api.tahvel.get(
      `/students/${studentId}`,
      {},
      {
        cacheExpiration: 24 * 60 * 60 * 1000
      }
    )
  }

  /**
   * Create a mapping of student IDs to personal codes and names
   * @param {Array} journalStudents - Journal students
   * @param {Object} studentDetailsMap - Map of student IDs to their details including personal codes
   * @returns {Object} Student map
   */
  createStudentMap(journalStudents, studentDetailsMap = {}) {
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

    // First, map journal student IDs to student IDs
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

          // If we have details for this student from our direct API calls
          if (studentDetailsMap[journalStudent.studentId]) {
            const details = studentDetailsMap[journalStudent.studentId]
            studentMap.idToPersonalCode[journalStudent.studentId] = details.personalCode
            studentMap.personalCodeToName[details.personalCode] = details.name
            if (Logger.isDebugMode()) {
              Logger.debug(`Added personal code mapping: studentId ${journalStudent.studentId} -> "${details.personalCode}" (${details.name})`)
            }
          }
          // If we don't have details, log the issue but don't necessarily throw an error
          else {
            Logger.warning(`❌ No personal code found for student ID ${journalStudent.studentId} in student details map`)
            Logger.debug(`Available student detail IDs: ${Object.keys(studentDetailsMap).join(', ')}`)
            Logger.debug(`Journal student data: ${JSON.stringify(journalStudent)}`)

            // Instead of throwing an error immediately, let's try to get the data from the journal student itself
            if (journalStudent.student && journalStudent.student.idcode) {
              if (Logger.isDebugMode()) {
                Logger.debug(`✅ Found personal code in journal student data: ${journalStudent.student.idcode}`)
              }
              studentMap.idToPersonalCode[journalStudent.studentId] = journalStudent.student.idcode
              const studentName = journalStudent.student.fullname || journalStudent.studentName || 'Unknown'
              studentMap.personalCodeToName[journalStudent.student.idcode] = studentName
              if (Logger.isDebugMode()) {
                Logger.debug(`Added personal code mapping from journal data: studentId ${journalStudent.studentId} -> "${journalStudent.student.idcode}" (${studentName})`)
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

    // Log final mapping statistics
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
    const assignments = []

    if (!journalEntries || !Array.isArray(journalEntries)) {
      return assignments
    }

    // Filter for graded entries only (exclude outcome entries)
    const gradedEntries = journalEntries.filter(
      entry =>
        entry.entryType === 'SISSEKANNE_H' || // Graded entry
        entry.entryType === 'SISSEKANNE_I' // Independent work
    )

    // Debug: Log count of different entry types
    const entryCounts = {
      SISSEKANNE_H: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_H').length,
      SISSEKANNE_I: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_I').length,
      SISSEKANNE_O: gradedEntries.filter(e => e.entryType === 'SISSEKANNE_O').length
    }

    // Debug: Log outcome entries specifically
    if (entryCounts['SISSEKANNE_O'] > 0) {
      const outcomeEntries = gradedEntries.filter(e => e.entryType === 'SISSEKANNE_O')
      outcomeEntries.forEach(() => {})
    }

    // Create a map of entry IDs to entries with grades from journalEntriesByDate
    const entriesWithGradesMap = {}
    if (journalEntriesWithGrades && Array.isArray(journalEntriesWithGrades)) {
      journalEntriesWithGrades.forEach(entry => {
        // Handle regular entries with IDs
        if (entry.id && (entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_I')) {
          entriesWithGradesMap[entry.id] = entry
        }
        // Handle outcome entries with curriculumModuleOutcomes
        if (entry.curriculumModuleOutcomes && entry.entryType === 'SISSEKANNE_O') {
          entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`] = entry
        }
      })
    }

    gradedEntries.forEach(entry => {
      // Log when we process an outcome entry
      if (entry.entryType === 'SISSEKANNE_O') {
        // No-op block removed (was empty)
      }

      // Extract results for this assignment
      const results = []

      // Handle different entry types for finding grades
      let entryWithGrades
      if (entry.entryType === 'SISSEKANNE_O') {
        // For outcome entries, look up by curriculumModuleOutcomes
        entryWithGrades = entriesWithGradesMap[`outcome_${entry.curriculumModuleOutcomes}`]
      } else {
        // For regular entries, look up by ID
        entryWithGrades = entriesWithGradesMap[entry.id]
      }

      // Create a map of students who have results for this assignment
      const studentResultsMap = {}
      if (entryWithGrades) {
        if (entry.entryType === 'SISSEKANNE_O' && entryWithGrades.studentOutcomeResults) {
          // Handle outcome entries with studentOutcomeResults
          Object.entries(entryWithGrades.studentOutcomeResults).forEach(([journalStudentId, studentResults]) => {
            studentResultsMap[journalStudentId] = studentResults
          })
        } else if (entryWithGrades.journalStudentResults) {
          // Handle regular entries with journalStudentResults
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

      // Include ALL journal students for this assignment, not just those with results
      if (journalStudents && Array.isArray(journalStudents)) {
        journalStudents.forEach(journalStudent => {
          if (!journalStudent || !journalStudent.id) return

          const journalStudentId = journalStudent.id.toString()

          // Check if this student has results for this assignment
          const studentResults = studentResultsMap[journalStudentId]
          let grade = ''

          if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
            // Get grade if available
            grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
          }
          // If no results or no grade, grade remains empty string

          // Get student ID from journal student ID
          const studentId = studentMap.journalStudentIdToId[journalStudentId]
          if (!studentId) return

          // Get personal code from student ID
          const personalCode = studentMap.idToPersonalCode[studentId]

          // If we can't get the personal code, skip this student (don't throw error for missing students)
          if (!personalCode) {
            Logger.warning(`No personal code found for student ID ${studentId}, skipping`)
            return
          }

          // Get student name, active status, and deleted status from our maps
          let studentName = 'Unknown Student'
          let studentIsActive = true // Default to active if we can't determine status
          let studentIsDeleted = false

          // Get student details from our maps
          if (personalCode && studentMap.personalCodeToName[personalCode]) {
            studentName = studentMap.personalCodeToName[personalCode]
          } else {
            // Use the student name from the journal students array
            if (journalStudent.studentName) {
              studentName = journalStudent.studentName
              // Store this mapping for future use
              if (personalCode) {
                studentMap.personalCodeToName[personalCode] = journalStudent.studentName
                Logger.debug(`Added name mapping for ${personalCode}: ${journalStudent.studentName}`)
              }
            }
          }

          // Check if we have student details in our cache
          if (studentId && studentDetailsMap[studentId]) {
            // Use the isActive and isDeleted flags from the student details
            studentIsActive = studentDetailsMap[studentId].isActive
            studentIsDeleted = studentDetailsMap[studentId].isDeleted || false
          }

          // Add result for this student (including those with empty grades)
          results.push({
            grade,
            studentPersonalCode: personalCode,
            studentName,
            studentIsActive: studentIsActive,
            studentIsDeleted: studentIsDeleted
          })
        })
      } else {
        const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
        Logger.warning(`No journal students provided for assignment ${entryIdForLog}, cannot include all students`)
      }

      // Get the assignment name
      const assignmentName = entry.nameEt || this.getAssignmentNameFromEntry(entry)

      // Always include assignments with valid ID and name, even if they don't have results yet
      // This ensures all assignments are sent to Kriit, not just those with grades
      // Handle both regular entries (with id) and outcome entries (with curriculumModuleOutcomes)
      const assignmentId = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id

      if (assignmentId && assignmentName) {
        assignments.push({
          assignmentExternalId: assignmentId,
          assignmentName: assignmentName,
          assignmentInstructions: entry.content || '',
          assignmentDueAt: entry.homeworkDuedate ? entry.homeworkDuedate.split('T')[0] : entry.entryDate ? entry.entryDate.split('T')[0] : null, // Use homeworkDuedate if available, fall back to entryDate
          assignmentEntryDate: entry.entryDate ? entry.entryDate.split('T')[0] : null,
          results
        })

        // Log whether this assignment has results or not
      }
    })

    return assignments
  }

  /**
   * Get addInfo value from existing students
   * @param {Array} students - Journal entry students
   * @returns {string} addInfo value
   */
  getAddInfoFromExistingStudents(students) {
    if (!students || !Array.isArray(students) || students.length === 0) {
      return null
    }

    // Look for a student with a non-null addInfo
    for (const student of students) {
      if (student.addInfo) {
        Logger.debug(`Found existing addInfo pattern: ${student.addInfo}`)

        // Extract the base URL pattern (everything before the last slash and number)
        const match = student.addInfo.match(/(.*\/)[0-9]+$/)
        if (match && match[1]) {
          const baseUrl = match[1]
          Logger.debug(`Extracted base URL: ${baseUrl}`)

          // Return the base URL with a placeholder number
          // We'll use the same number as the existing pattern
          const lastPart = student.addInfo.split('/').pop()
          return `${baseUrl}${lastPart}`
        }

        // If we can't extract a pattern, just return the addInfo as is
        return student.addInfo
      }
    }

    // If no student has addInfo, return null
    return null
  }

  /**
   * Get a readable assignment name from a journal entry
   * @param {Object} entry - Journal entry
   * @returns {string} Assignment name
   */
  getAssignmentNameFromEntry(entry) {
    if (entry.nameEt) return entry.nameEt

    if (entry.content) {
      // Extract first line or first sentence from instructions
      const firstSentence = entry.content
        .split(/[.!\n]/)[0] // Split by period, exclamation mark or newline
        .trim()
        .slice(0, 100) // Limit length

      if (firstSentence) {
        return firstSentence.length === 100 ? `${firstSentence}...` : firstSentence
      }
    }

    // Use a type-specific name if nothing else is available
    return entry.entryType === 'SISSEKANNE_H'
      ? 'Hindeline töö'
      : entry.entryType === 'SISSEKANNE_I'
        ? 'Iseseisev töö'
        : entry.entryType === 'SISSEKANNE_O'
          ? 'Õppetulemus'
          : 'Päeviku sissekanne'
  }

  /**
   * Sync data with Kriit
   */
  async syncWithKriit() {
    // Debug: Log all journal students and their personal codes before syncing
    if (Array.isArray(this.differences)) {
      this.differences.forEach(subject => {
        if (Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            if (Array.isArray(assignment.results)) {
              assignment.results.forEach(() => {})
            }
          })
        }
      })
    }
    // Debug: Log mapping from journalStudentId to studentId and idToPersonalCode
    Logger.debug('[SYNC] Mapping journalStudentIdToStudentId:', JSON.stringify(this.journalStudentIdToStudentId))
    if (this.journalStudentIdToStudentId) {
      Object.entries(this.journalStudentIdToStudentId).forEach(([journalStudentId, studentId]) => {
        Logger.debug(`[SYNC] journalStudentId ${journalStudentId} -> studentId ${studentId}`)
      })
    }
    if (this.globalTeacherCache) {
      Logger.debug('[SYNC] Teacher cache:', JSON.stringify(this.globalTeacherCache))
    }
    Logger.feature(this.name, 'Syncing with Kriit...')

    // Prevent multiple sync operations from running simultaneously
    if (this.isLoading) {
      Logger.warning('Sync already in progress, ignoring new sync request')
      return
    }

    try {
      if (!this.differences || !Array.isArray(this.differences) || this.differences.length === 0) {
        Logger.warning('No differences to sync')
        return
      }

      // Prepare data for sync
      const syncData = []
      if (Logger.isDebugMode()) {
        Logger.debug('=== COLLECTING SYNC DATA ===')
        Logger.debug(`Processing ${this.differences ? this.differences.length : 0} subjects with differences`)
      }

      this.differences.forEach((subject, subjectIndex) => {
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
            Logger.warning(`⚠️ Assignment ${assignmentIndex + 1}: No results array`)
            return
          }

          if (Logger.isDebugMode()) {
            Logger.debug(`    - Has ${assignment.results.length} results`)
          }
          assignment.results.forEach((result, resultIndex) => {
            Logger.debug(`    Result ${resultIndex + 1}: ${result.studentName} | PersonalCode: "${result.studentPersonalCode}" | CurrentGrade: "${result.currentGrade}" | NewGrade: "${result.grade}"`)

            // Throw error if any results have missing personal codes
            if (!result.studentPersonalCode) {
              Logger.error(`❌ Result ${resultIndex + 1}: Missing personal code - cannot proceed with sync`)
              const errorMsg = 'Found missing personal code for a student - cannot proceed with sync'
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Skip syncing grades for deleted or inactive students
            if (result.studentIsDeleted === true) {
              if (Logger.isDebugMode()) {
                Logger.debug(`⏭️ Result ${resultIndex + 1}: Skipping grade sync for deleted student: ${result.studentName} (${result.studentPersonalCode})`)
              }
              return // Do not sync this student's grade
            }
            if (result.studentIsActive === false) {
              if (Logger.isDebugMode()) {
                Logger.debug(`⏭️ Result ${resultIndex + 1}: Skipping grade sync for inactive student: ${result.studentName} (${result.studentPersonalCode})`)
              }
              return // Do not sync this student's grade
            }

            // Check if personal code is a string and contains 'fallback-'
            if (typeof result.studentPersonalCode === 'string' && result.studentPersonalCode.includes('fallback-')) {
              const errorMsg = `Found invalid personal code: ${result.studentPersonalCode} - cannot proceed with sync`
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Only include results where the grade is different
            // Normalize grades for comparison - handle type mismatches and empty values
            const normalizeGrade = grade => {
              if (grade === null || grade === undefined || grade === '' || grade === '(puudub)') {
                return null
              }
              // Convert to string and trim whitespace
              const normalized = String(grade).trim()

              // Handle common Tahvel grade format
              if (normalized.startsWith('KUTSEHINDAMINE_')) {
                return normalized.replace('KUTSEHINDAMINE_', '')
              }

              return normalized
            }

            const tahvelGrade = normalizeGrade(result.currentGrade)
            const kriitGrade = normalizeGrade(result.grade)

            Logger.debug(`    Grade comparison: Tahvel="${tahvelGrade}" vs Kriit="${kriitGrade}"`)

            // Skip null grades from Kriit entirely - don't sync them
            if (kriitGrade === null) {
              Logger.debug(`⏭️ Result ${resultIndex + 1}: Skipping null/empty grade from Kriit - not syncing`)
              return // Skip this result entirely
            }

            // Only sync if grades are actually different
            if (tahvelGrade !== kriitGrade) {
              // Log the types we're getting for debugging
              if (Logger.isDebugMode()) {
                Logger.debug(`✅ Result ${resultIndex + 1}: Grade sync needed`)
              }
              Logger.debug(`Student personal code type: ${typeof result.studentPersonalCode}, value: "${result.studentPersonalCode}"`)
              Logger.debug(`Grade type: ${typeof result.grade}, value: "${result.grade}"`)
              Logger.debug(`Will sync: Tahvel="${tahvelGrade}" -> Kriit="${kriitGrade}"`)

              // Convert studentPersonalCode and grade to strings to ensure they're the correct type
              const personalCode = result.studentPersonalCode ? String(result.studentPersonalCode) : null
              const gradeStr = result.grade ? String(result.grade) : null

              // Double-check that we have valid data before adding to sync list
              if (!personalCode || !gradeStr) {
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

      if (syncData.length === 0) {
        Logger.warning('No data to sync after processing')
        Logger.debug('=== SYNC STATUS CHECK ===')
        Logger.debug('syncData is empty, meaning no differences were found or all are filtered out')
        Logger.debug(`Original differences count: ${this.differences ? this.differences.length : 0}`)

        // Count total assignments and results for debugging
        let _totalAssignments = 0
        let _totalResults = 0
        let _skippedResults = 0

        if (this.differences && Array.isArray(this.differences)) {
          this.differences.forEach(subject => {
            if (subject.assignments && Array.isArray(subject.assignments)) {
              _totalAssignments += subject.assignments.length
              subject.assignments.forEach(assignment => {
                if (assignment.results && Array.isArray(assignment.results)) {
                  _totalResults += assignment.results.length
                  assignment.results.forEach(result => {
                    const tahvelGrade = result.currentGrade || '(empty)'
                    const kriitGrade = result.grade || '(empty)'
                    if (tahvelGrade === kriitGrade) {
                      _skippedResults++
                    }
                  })
                }
              })
            }
          })
        }

        // Show a more informative message to the user
        this.isLoading = false
        this.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
        this.updateUI()
        return
      }

      // Log what we're going to sync
      Logger.debug('=== SYNC DATA TO PROCESS ===')
      Logger.debug(`Found ${syncData.length} grade differences to sync`)
      Logger.debug(`Differences to sync: ${JSON.stringify(syncData, null, 2)}`)

      // Show loading state
      this.isLoading = true
      this.updateUI()

      // Process grade changes grouped by assignment (batch multiple students per PUT)
      const successfulSyncs = []
      const failedSyncs = []
// Helper: group syncData by journalId::assignmentId
      const grouped = {}
      syncData.forEach(item => {
        const key = `${item.journalId}::${item.assignmentId}`
        if (!grouped[key]) grouped[key] = { journalId: item.journalId, assignmentId: item.assignmentId, items: [] }
        grouped[key].items.push(item)
      })

      try {
        // Update UI to show progress
        this.updateProgressUI(0, syncData.length)

        const groupKeys = Object.keys(grouped)
        let processedCount = 0

        for (let g = 0; g < groupKeys.length; g++) {
          const group = grouped[groupKeys[g]]
          if (Logger.isDebugMode()) {
            Logger.debug(`Processing batch ${g + 1}/${groupKeys.length} for journal ${group.journalId} assignment ${group.assignmentId} with ${group.items.length} students`)
          }

          // Update progress to show how many items have been processed so far
          try {
            this.updateProgressUI(processedCount, syncData.length)
          } catch (progressError) {
            Logger.warning(`Progress UI update failed: ${progressError.message}`)
          }

          // Perform the batch update for this assignment
          try {
            const batchResult = await this.syncGradesBatchToTahvel(group.journalId, group.assignmentId, group.items)
            // batchResult: { successes: [], failures: [] }
            if (Array.isArray(batchResult.successes)) {
              batchResult.successes.forEach(s => successfulSyncs.push(s))
            }
            if (Array.isArray(batchResult.failures)) {
              batchResult.failures.forEach(f => failedSyncs.push(f))
            }
            processedCount += group.items.length
          } catch (batchError) {
            // Mark all items in this group as failed
            Logger.error(`Batch update failed for journal ${group.journalId} assignment ${group.assignmentId}: ${batchError.message}`)
            group.items.forEach(it => {
              failedSyncs.push({ ...it, error: batchError.message, errorType: 'sync_error', timestamp: new Date().toISOString() })
            })
            processedCount += group.items.length
          }

          // Small delay between batch requests to reduce server load
          if (g < groupKeys.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300))
          }
        }

        // Final progress update
        if (Logger.isDebugMode()) {
          Logger.debug(`Batch sync completed. Updating final progress: ${syncData.length}/${syncData.length}`)
        }
        try {
          this.updateProgressUI(syncData.length, syncData.length)
        } catch (finalProgressError) {
          Logger.warning(`Final progress UI update failed: ${finalProgressError.message}`)
        }

        // Log results
        Logger.debug(`Sync completed: ${successfulSyncs.length} successful, ${failedSyncs.length} failed`)

        // Categorize failed syncs by error type
        const inactiveStudentErrors = failedSyncs.filter(item => item.errorType === 'inactive_student')
        const realErrors = failedSyncs.filter(item => item.errorType !== 'inactive_student')

        if (Logger.isDebugMode()) {
          Logger.debug(`=== SYNC SUMMARY ===`)
          Logger.debug(`Total items processed: ${syncData.length}`)
          Logger.debug(`Successful syncs: ${successfulSyncs.length}`)
          Logger.debug(`Failed syncs: ${failedSyncs.length}`)
        }
        if (inactiveStudentErrors.length > 0) {
          if (Logger.isDebugMode()) {
            Logger.debug(`  - Inactive students skipped: ${inactiveStudentErrors.length}`)
          }
        }
        if (realErrors.length > 0) {
          if (Logger.isDebugMode()) {
            Logger.debug(`  - Real sync errors: ${realErrors.length}`)
          }
        }
        if (Logger.isDebugMode()) {
          Logger.debug(`==================`)
        }

        // Count how many were actually updated vs skipped
        const actualUpdates = successfulSyncs.filter(item => !item.skipped).length
        const skippedUpdates = successfulSyncs.filter(item => item.skipped).length

        // Show appropriate message based on results
        if (realErrors.length === 0) {
          // No real errors occurred (only inactive students if any)
          this.isLoading = false
          this.error = null

          // Show success message in the banner
          let successMessage
          if (actualUpdates > 0) {
            successMessage = `Edukalt sünkroniseeritud ${actualUpdates} hinnet Kriidist Tahvlisse.`
            if (skippedUpdates > 0) {
              successMessage += ` ${skippedUpdates} hinnet olid juba õiged.`
            }
            if (inactiveStudentErrors.length > 0) {
              successMessage += ` ${inactiveStudentErrors.length} üliõpilast vahele jäetud (ei õpi aktiivselt).`
            }
            successMessage += ` Andmed värskendatakse automaatselt mõne sekundi pärast...`
          } else {
            if (inactiveStudentErrors.length > 0 && successfulSyncs.length === 0) {
              successMessage = `${inactiveStudentErrors.length} üliõpilast vahele jäetud, kuna nad ei õpi aktiivselt. Pole midagi sünkroniseerida.`
            } else {
              successMessage = `Kõik ${successfulSyncs.length} hinnet olid juba õiged - pole midagi sünkroniseerida.`
              if (inactiveStudentErrors.length > 0) {
                successMessage += ` ${inactiveStudentErrors.length} üliõpilast vahele jäetud (ei õpi aktiivselt).`
              }
            }
          }

          if (Logger.isDebugMode()) {
            Logger.debug(`Showing success banner: ${successMessage}`)
          }
          this.showSuccessBanner(successMessage)

          // Log the successful syncs for debugging
          Logger.debug(
            `Successful syncs: ${JSON.stringify(
              successfulSyncs.map(item => ({
                student: item.studentPersonalCode,
                assignment: item.assignmentId,
                grade: item.grade
              }))
            )}`
          )

          // Log inactive students for information
          if (inactiveStudentErrors.length > 0) {
            if (Logger.isDebugMode()) {
              Logger.debug(
                `Inactive students skipped: ${JSON.stringify(
                  inactiveStudentErrors.map(item => ({
                    student: item.studentPersonalCode,
                    assignment: item.assignmentId,
                    reason: 'Not actively studying'
                  }))
                )}`
              )
            }
          }

          // After 3 seconds, refresh data to show updated state
          Logger.debug('Setting timeout to refresh data in 3 seconds')
          setTimeout(() => {
            Logger.debug('Timeout triggered, refreshing journal data')
            // Clear all cache before fetching new data to ensure we get fresh results
            this.clearCache()
              .then(() => {
                Logger.debug('Cache cleared, now fetching fresh journal data')
                this.fetchJournalData()
              })
              .catch(error => {
                Logger.error('Error clearing cache:', error)
                // Still try to fetch data even if cache clearing fails
                this.fetchJournalData()
              })
          }, 3000)
        } else if (successfulSyncs.length === 0 && inactiveStudentErrors.length === 0) {
          // All syncs failed with real errors
          this.isLoading = false
          this.error = `Kõik ${realErrors.length} hinde sünkroniseerimine ebaõnnestus. Vaata konsoolist täpsemaid vigu.`
          this.updateUI()

          // Log detailed errors for debugging
          Logger.error(
            'All syncs failed. Details:',
            realErrors.map(item => ({
              student: item.studentPersonalCode,
              assignment: item.assignmentId,
              error: item.error
            }))
          )
        } else {
          // Mixed results
          this.isLoading = false

          let errorMessage = `Sünkroniseerimine osaliselt õnnestus: ${successfulSyncs.length} õnnestus`
          if (realErrors.length > 0) {
            errorMessage += `, ${realErrors.length} ebaõnnestus`
          }
          if (inactiveStudentErrors.length > 0) {
            errorMessage += `, ${inactiveStudentErrors.length} vahele jäetud (ei õpi aktiivselt)`
          }
          errorMessage += `.`

          this.error = errorMessage
          this.updateUI()

          // Log detailed errors for debugging
          if (realErrors.length > 0) {
            Logger.error(
              'Some syncs failed with real errors. Details:',
              realErrors.map(item => ({
                student: item.studentPersonalCode,
                assignment: item.assignmentId,
                error: item.error
              }))
            )
          }

          if (inactiveStudentErrors.length > 0) {
            if (Logger.isDebugMode()) {
              Logger.debug(
                'Some students skipped due to inactive status. Details:',
                inactiveStudentErrors.map(item => ({
                  student: item.studentPersonalCode,
                  assignment: item.assignmentId,
                  reason: 'Not actively studying'
                }))
              )
            }
          }

          // After 3 seconds, refresh data to show updated state
          setTimeout(() => {
            // Clear all cache before fetching new data to ensure we get fresh results
            this.clearCache()
              .then(() => {
                Logger.debug('Cache cleared, now fetching fresh journal data')
                this.fetchJournalData()
              })
              .catch(error => {
                Logger.error('Error clearing cache:', error)
                // Still try to fetch data even if cache clearing fails
                this.fetchJournalData()
              })
          }, 3000)
        }
      } catch (error) {
        // Handle unexpected errors in the sync loop
        Logger.error('Unexpected error during sync process:', error)
        Logger.error('Error stack:', error.stack)

        const errorMessage = 'Sünkroniseerimine ebaõnnestus ootamatu vea tõttu.'


        // Log how many items were processed before the error
        Logger.error(`Sync failed after processing ${successfulSyncs.length} successful and ${failedSyncs.length} failed items`)

        this.isLoading = false
        this.error = errorMessage
        this.updateUI()
      }
    } catch (error) {
      Logger.error('Error syncing with Kriit:', error)
      this.isLoading = false
      this.error = error.message || 'Failed to sync with Kriit'
      this.updateUI()
    }
  }
  /**
   * Sync multiple grades for the same journal+assignment in one PUT request.
   * items: array of { journalId, assignmentId, studentPersonalCode, grade }
   * Returns { successes: [], failures: [] }
   */
  async syncGradesBatchToTahvel(journalId, assignmentId, items = []) {
    const successes = []
    const failures = []
    try {
      if (!journalId || !assignmentId) throw new Error('journalId and assignmentId are required for batch sync')

      // Fetch the full assignment entry with all students
      let entryData
      try {
        const cacheKey = `GET_${this.api.tahvel.baseUrl}/journals/${journalId}/journalEntry/${assignmentId}?allStudents=true`
        await cacheService.clearCache(cacheKey)
        entryData = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${assignmentId}`, { allStudents: true })
      } catch (error) {
        throw new Error(`Failed to fetch assignment data for batch: ${error.message}`)
      }

      if (!entryData || !Array.isArray(entryData.journalEntryStudents)) {
        throw new Error('Invalid assignment data returned from Tahvel for batch update')
      }

      // Build a map of journalStudentId -> student object for quick updates
      const journalStudentsMap = {}
      for (const s of entryData.journalEntryStudents) {
        if (s && s.journalStudent) journalStudentsMap[String(s.journalStudent)] = s
      }

      // For items that correspond to existing journalEntryStudents, update their grade
      // Only use existing entryData.journalEntryStudents + getCachedStudent (API cache only)
      const studentsToSend = []

      for (const it of items) {
        try {
          const targetPersonalCode = String(it.studentPersonalCode)
          // Find matching journalStudent in entryData by cached mapping
          let match = null

          // Look through existing journalEntryStudents and use getCachedStudent to check personal codes
          for (const s of entryData.journalEntryStudents) {
            if (!s.journalStudent) continue
            const cached = await this.getCachedStudent(s.journalStudent)
            if (cached && String(cached.personalCode) === targetPersonalCode) {
              match = s
              break
            }
          }

          // If no match in assignment, try to find in our cached mapping (from initial data collection)
          if (!match) {
            // Look through our journalStudentIdToStudentId mapping to find the student
            for (const [journalStudentId] of Object.entries(this.journalStudentIdToStudentId)) {
              const cached = await this.getCachedStudent(journalStudentId)
              if (cached && String(cached.personalCode) === targetPersonalCode) {
                // Create a new student entry object for students not yet in this assignment
                match = {
                  journalStudent: Number(journalStudentId),
                  id: null,
                  studentName: cached.name || null,
                  grade: null,
                  addInfo: null
                }
                break
              }
            }
          }

          if (!match || !match.journalStudent) {
            throw new Error(`Student with personal code ${it.studentPersonalCode} not found in cached data. Student may not be enrolled in this journal or cache is incomplete.`)
          }

          // Prepare student entry object
          const updatedStudentEntry = {
            id: match.id || null,
            journalStudent: Number(match.journalStudent),
            absence: null,
            grade: {
              code: `KUTSEHINDAMINE_${it.grade}`,
              gradingSchemaRowId: null,
              value: String(it.grade),
              value2: String(it.grade),
              extraval1: null,
              extraval2: null,
              nameEt: `Hinne ${it.grade}`,
              nameEn: `Grade ${it.grade}`,
              valid: true
            },
            verbalGrade: null,
            removeStudentHistory: true,
            addInfo: this.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
            isLessonAbsence: false,
            hasOverlappingLessonAbsence: false,
            isPraise: false,
            isRemark: false,
            lessonAbsences: {},
            studentName: match.studentName || null,
            studentGroup: null,
            journalEntryStudentHistories: [],
            hasWholeDayAcceptedAbsence: false,
            wholeDayAbsenceCode: null,
            gradeValue: null
          }

          studentsToSend.push(updatedStudentEntry)
          successes.push({ ...it, skipped: false })
        } catch (itemErr) {
          failures.push({ ...it, error: itemErr.message, errorType: 'resolve_error', timestamp: new Date().toISOString() })
        }
      }

      if (studentsToSend.length === 0) {
        return { successes: [], failures }
      }

      // Build update payload similar to syncGradeToTahvel
      const updateData = { ...entryData, journalEntryStudents: studentsToSend }
      if (!updateData.version && entryData.version) updateData.version = entryData.version
      if (Array.isArray(updateData.journalEntryTeachers)) updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
      if (!updateData.journalEntryCapacityTypes && entryData.entryType) {
        updateData.journalEntryCapacityTypes = entryData.entryType === 'SISSEKANNE_I' ? ['MAHT_i'] : ['MAHT_h']
      }

      // Send PUT once for the assignment
      try {
        await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)
// treat as success for all studentsToSend
        return { successes, failures }
      } catch (err) {
        // mark all students in this batch as failed
        const msg = err.message || 'Batch PUT failed'
        const ts = new Date().toISOString()
        studentsToSend.forEach(s => {
          failures.push({ journalId, assignmentId, studentPersonalCode: s.studentPersonalCode || null, grade: s.grade?.value || null, error: msg, errorType: 'sync_error', timestamp: ts })
        })
        return { successes: [], failures }
      }
    } catch (error) {
      Logger.error('syncGradesBatchToTahvel error:', error)
      return { successes, failures: [...failures, { error: error.message, timestamp: new Date().toISOString() }] }
    }
  }

  /**
   * Get student from cache using only in-memory cached data (no API calls)
   * @param {string|number} journalStudentId - Journal student ID to look up
   * @returns {Promise<Object|null>} Cached student data or null if not found
   */
  async getCachedStudent(journalStudentId) {
    if (!journalStudentId) {
      Logger.debug(`❌ getCachedStudent called with null/undefined journalStudentId`)
      return null
    }

    // Prefer fast in-memory cache first
    if (this._studentCache && this._studentCache[journalStudentId]) {
      if (Logger.isDebugMode()) Logger.debug(`Returning student from in-memory cache for journalStudentId: ${journalStudentId}`)
      return this._studentCache[journalStudentId]
    }

    // Use the mapping to find the actual studentId and rely on ApiService cache via getStudentDetails
    const studentId = this.journalStudentIdToStudentId[journalStudentId]
    if (!studentId) {
      if (Logger.isDebugMode()) Logger.debug(`No studentId mapping for journalStudentId: ${journalStudentId} - will not attempt expensive lookups`)
      return null
    }

    try {
      const studentDetails = await this.getStudentDetails(studentId)
      if (!studentDetails || !studentDetails.person || !studentDetails.person.idcode) {
        if (Logger.isDebugMode()) Logger.debug(`No student details (or missing idcode) for studentId ${studentId}`)
        return null
      }

      const cachedStudent = {
        personalCode: studentDetails.person.idcode,
        name: `${studentDetails.person.firstname || ''} ${studentDetails.person.lastname || ''}`.trim(),
        studentId,
        journalStudentId,
        isActive: studentDetails.status === 'OPPURSTAATUS_O',
        isDeleted: studentDetails.status === 'OPPURSTAATUS_K',
        cacheInfo: studentDetails
      }

      // Populate in-memory cache for quick reuse in this sync run
      try {
        if (!this._studentCache) this._studentCache = {}
        this._studentCache[journalStudentId] = cachedStudent
        this._studentCache[studentId] = cachedStudent
      } catch (cacheErr) {
        if (Logger.isDebugMode()) Logger.debug(`Failed to write to in-memory student cache: ${cacheErr.message}`)
      }

      return cachedStudent
    } catch (error) {
      if (Logger.isDebugMode()) Logger.debug(`Error resolving studentId ${studentId} via ApiService: ${error.message}`)
      return null
    }
  }
}

// Cache expiration constants
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS

// Global teacher cache shared between collectJournalData and getTahvelSubjectsWithAssignmentsAndGrades
// to prevent duplicate API requests when processing multiple journals
const globalModuleTeacherCache = {}

// Map to track ongoing teacher requests to prevent race conditions
const pendingTeacherRequests = new Map()

/**
 * Fetches data from API with caching
 * @param {Object} api - API service instance
 * @param {string} endpoint - API endpoint to fetch from
 * @param {number} expiration - Cache expiration time in milliseconds
 * @returns {Promise<any>} The fetched data
 */
async function fetchCachedData(api, endpoint, expiration = ONE_DAY_MS) {
  // Create a cache key from the endpoint
  const cacheKey = `${encodeURIComponent(endpoint.replace(/^\//, ''))}`

  // Use cacheService.getOrFetch to handle caching
  try {
    return await cacheService.getOrFetch(
      cacheKey,
      async() => {
        try {
          return await api.tahvel.get(endpoint)
        } catch (error) {
          Logger.warning(`Error fetching ${endpoint}: ${error.message}`)
          return null
        }
      },
      expiration
    )
  } catch (error) {
    Logger.warning(`Error using cacheService for ${endpoint}: ${error.message}`)
    return null
  }
}

/**
 * Get teacher personal code with global caching and race condition prevention
 * @param {Object} api - API service instance
 * @param {Object} teacher - Teacher object with id, nameEt, fullname
 * @returns {Promise<Object>} Teacher data with personalCode, name, id
 */
async function getTeacherPersonalCodeCached(api, teacher) {
  const teacherId = teacher.id
  const teacherName = teacher.nameEt || teacher.fullname || ''

  if (!teacherId || !teacherName) {
    return { personalCode: '', name: teacherName, id: teacherId }
  }

  // Create URL-based cache key to prevent conflicts between different API endpoints
  const encodedName = encodeURIComponent(teacherName)
  const endpoint = `/teachers?isActive=true&lang=ET&name=${encodedName}&page=0&size=50`
  const cacheKey = `teacher_${teacherId}_${btoa(endpoint).slice(0, 20)}` // Use base64 encoded endpoint as part of cache key

  // Check global cache first
  if (globalModuleTeacherCache[cacheKey]) {
    return globalModuleTeacherCache[cacheKey]
  }

  // Check if request is already pending to prevent duplicate requests
  if (pendingTeacherRequests.has(cacheKey)) {
    return await pendingTeacherRequests.get(cacheKey)
  }

  // Create the fetch promise
  const fetchPromise = (async() => {
    try {
      const teacherSearchResult = await fetchCachedData(api, endpoint, ONE_WEEK_MS)

      if (teacherSearchResult?.content && Array.isArray(teacherSearchResult.content) && teacherSearchResult.content.length > 0) {
        let foundTeacher = teacherSearchResult.content.find(t => t.id === teacherId)

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content.find(t => t.name === teacherName || t.name === teacher.fullname)
        }

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content[0]
          Logger.warning(
            `No exact match found for teacher ${teacherName} (ID: ${teacherId}). Using first result: ${foundTeacher.name} (ID: ${foundTeacher.id})`
          )
        }

        const teacherData = {
          personalCode: foundTeacher.idcode || '',
          name: foundTeacher.name || teacherName,
          id: foundTeacher.id
        }

        // Store in global cache using URL-based key
        globalModuleTeacherCache[cacheKey] = teacherData

        return teacherData
      }

      const fallbackData = {
        personalCode: '',
        name: teacherName,
        id: teacherId
      }

      // Cache the fallback data too to prevent repeated requests
      globalModuleTeacherCache[cacheKey] = fallbackData
      return fallbackData
    } catch (error) {
      Logger.warning(`Failed to get teacher personal code for ${teacherName}: ${error.message}`)
      const errorData = { personalCode: '', name: teacherName, id: teacherId }
      globalModuleTeacherCache[cacheKey] = errorData
      return errorData
    } finally {
      // Remove from pending requests using URL-based key
      pendingTeacherRequests.delete(cacheKey)
    }
  })()

  // Store the promise to prevent duplicate requests using URL-based key
  pendingTeacherRequests.set(cacheKey, fetchPromise)

  return await fetchPromise
}

/**
 * Get Tahvel subjects with assignments and grades
 * This function is extracted from the collectJournalData method for testing purposes
 * @param {Array<string|number>} journalIds - List of journal IDs to process
 * @returns {Promise<Array>} Array of subjects with assignments and grades
 */
export async function getTahvelSubjectsWithAssignmentsAndGrades(journalIds = []) {
  try {
    // Ensure we have journal IDs to process
    if (!journalIds || journalIds.length === 0) {
      Logger.warning('No journal IDs provided to getTahvelSubjectsWithAssignmentsAndGrades')
      return []
    }

    Logger.debug(`Processing ${journalIds.length} journals`)

    // Process each journal
    const results = []

    for (const journalId of journalIds) {
      try {
        Logger.debug(`Processing journal ID: ${journalId}`)

        // Get journal info
        const journalInfo = await fetchCachedData(this.api, `/journals/${journalId}`)
        if (!journalInfo) {
          Logger.warning(`Could not get info for journal ${journalId}`)
          continue
        }

        // Get journal students
        const journalStudents = await fetchCachedData(this.api, `/journals/${journalId}/journalStudents?allStudents=true`)
        if (!Array.isArray(journalStudents) || journalStudents.length === 0) {
          Logger.warning(`No students found for journal ${journalId}`)
          continue
        }

        // Get journal entries
        const journalEntries = await fetchCachedData(this.api, `/journals/${journalId}/journalEntriesByDate?allStudents=true`)
        if (!Array.isArray(journalEntries)) {
          Logger.warning(`No entries found for journal ${journalId}`)
          continue
        }

        // Process students to get their details (especially personal code)
        const studentDetailsMap = {}
        for (const student of journalStudents) {
          if (student && student.studentId) {
            const studentDetails = await fetchCachedData(this.api, `/students/${student.studentId}`)

            if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
              studentDetailsMap[student.id] = {
                personalCode: studentDetails.person.idcode,
                name: student.fullname || student.studentName,
                isActive: studentDetails.status === 'OPPURSTAATUS_O' // O means actively studying
              }
            }
          }
        }

        // Process journal entries to extract assignments with grades
        const assignments = []
        for (const entry of journalEntries) {
          // We're mainly interested in assignments (independent work entries)
          if (entry.entryType === 'SISSEKANNE_I' && entry.nameEt && entry.id) {
            const results = []

            // Create a map of students who have results for this assignment
            const studentResultsMap = {}
            if (entry.journalStudentResults) {
              Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
                studentResultsMap[journalStudentId] = studentResults
              })
            }

            // Include ALL journal students for this assignment, not just those with results
            Object.values(studentDetailsMap).forEach(studentDetails => {
              if (studentDetails) {
                // Find this student's journal student ID
                const journalStudentId = Object.keys(studentDetailsMap).find(id => studentDetailsMap[id] === studentDetails)

                // Check if this student has results for this assignment
                const studentResults = studentResultsMap[journalStudentId]
                let grade = ''

                if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
                  // Map Tahvel grade codes to Kriit format (remove prefix)
                  grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
                }
                // If no results or no grade, grade remains empty string

                results.push({
                  grade,
                  studentPersonalCode: studentDetails.personalCode,
                  studentName: studentDetails.name,
                  studentIsActive: studentDetails.isActive
                })
              }
            })

            // Extract date from entryDate
            let dueDate = null
            let entryDate = null
            if (entry.entryDate) {
              const date = new Date(entry.entryDate)
              entryDate = date.toISOString().split('T')[0]

              // Use date + 2 days as due date if not specified
              const dueDateObj = new Date(date)
              dueDateObj.setDate(dueDateObj.getDate() + 2)
              dueDate = dueDateObj.toISOString().split('T')[0]
            }

            // Include assignments even if no students have grades yet (but only if we have students)
            if (results.length > 0) {
              assignments.push({
                assignmentExternalId: entry.id,
                assignmentName: entry.nameEt,
                assignmentInstructions: entry.nameEt,
                assignmentDueAt: dueDate,
                assignmentEntryDate: entryDate,
                results
              })
            }
          }
        }

        // Get teacher personal code using shared caching
        let teacherName = ''
        let teacherPersonalCode = ''

        if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
          const teacher = journalInfo.journalTeachers[0]
          teacherName = teacher.nameEt || teacher.fullname || ''

          if (teacherName && teacher.id) {
            const teacherData = await getTeacherPersonalCodeCached(this.api, teacher)
            teacherPersonalCode = teacherData.personalCode
          }
        }

        // Get group name
        let groupName = ''
        if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
          groupName = journalInfo.studentGroups[0]
        } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
          groupName = journalStudents[0].studentGroup
        }

        // Only add journals that have assignments with grades
        if (assignments.length > 0) {
          results.push({
            subjectName: journalInfo.nameEt,
            subjectExternalId: journalId,
            groupName,
            teacherPersonalCode,
            teacherName,
            assignments
          })
        }
      } catch (error) {
        Logger.error(`Error processing journal ${journalId}:`, error)
      }
    }

    return results
  } catch (error) {
    Logger.error('Error in getTahvelSubjectsWithAssignmentsAndGrades:', error)
    throw error
  }
}

// Expose the fetchCachedData function for testing purposes
getTahvelSubjectsWithAssignmentsAndGrades.__fetchCachedData = fetchCachedData

JournalListSyncFeature.requiresKriit = true

export const journalListSync = new JournalListSyncFeature()
