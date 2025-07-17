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
import { domService } from '../../services/DomService.js'
import Logger from '../../services/Logger.js'
import { styleService } from '../../services/StyleService.js'
import { cacheService } from '../../services/CacheService.js'
import { setupKriitMessageListener } from '../../services/MessageListenerService.js'
import { bannerService } from '../../services/BannerService.js'
import { journalSyncBannerService } from '../../services/JournalSyncBannerService.js'
import { differenceRenderer } from './DifferenceRenderer.js'

import { sendOutcomeEntriesToKriit } from './OutComes.js'

class JournalListSyncFeature extends BaseFeature {
  /**
   * Update assignment names in Tahvel to match Kriit
   */
  async syncAssignmentNameDifferences() {
    const assignmentNameDiffs = this.extractAssignmentNameDifferences()
    if (!assignmentNameDiffs || assignmentNameDiffs.length === 0) return
    for (const subjectDiff of assignmentNameDiffs) {
      const subject = this.differences.find(s => s.subjectName === subjectDiff.subjectName)
      if (!subject || !Array.isArray(subject.assignments)) continue
      // For each nameDiff, match by both remote name and assignmentExternalId if possible
      for (const nameDiff of subjectDiff.nameDiffs) {
        // Find all assignments with matching remote name
        const matchingAssignments = subject.assignments.filter(a => a.assignmentName && a.assignmentName.remote === nameDiff.remote)
        // If there are multiple, try to match by assignmentExternalId if present in nameDiff
        let assignmentToUpdate = null
        if (nameDiff.assignmentExternalId) {
          assignmentToUpdate = matchingAssignments.find(a => a.assignmentExternalId === nameDiff.assignmentExternalId)
        } else if (matchingAssignments.length === 1) {
          assignmentToUpdate = matchingAssignments[0]
        } else {
          // If multiple and no id, skip to avoid wrong update
          Logger.warning(
            `Multiple assignments found for remote name '${nameDiff.remote}' in subject '${subjectDiff.subjectName}', but no assignmentExternalId to disambiguate. Skipping.`
          )
          continue
        }
        if (!assignmentToUpdate) {
          Logger.warning(
            `No matching assignment found for remote name '${nameDiff.remote}' in subject '${subjectDiff.subjectName}' with assignmentExternalId='${nameDiff.assignmentExternalId || 'N/A'}'. Skipping.`
          )
          continue
        }
        const journalId = subject.subjectExternalId
        const assignmentId = assignmentToUpdate.assignmentExternalId
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
        // Build the PUT payload by copying all fields, updating nameEt, and always setting journalEntryCapacityTypes
        // Construct Kriit assignment URL
        let kriitAssignmentUrl = ''
        if (assignmentToUpdate && assignmentToUpdate.assignmentExternalId) {
          // Try to get group name from subject if available
          const groupCode = subject.groupName || ''
          kriitAssignmentUrl = `http://localhost:8000/assignments/${assignmentToUpdate.assignmentExternalId}${groupCode ? `?group=${encodeURIComponent(groupCode)}` : ''}`
        }
        // Add homework field with Kriit link, always non-empty
        const homeworkText = kriitAssignmentUrl ? `Link ülesandele: ${kriitAssignmentUrl}` : 'Link ülesandele: puudub'
        const payload = { ...currentEntry, nameEt: nameDiff.kriit, journalEntryCapacityTypes: ['MAHT_i'], homework: homeworkText }
        Logger.info(`✨ [syncAssignmentNameDifferences] PUT /journals/${journalId}/journalEntry/${assignmentId} with payload: ${JSON.stringify(payload)}`)
        try {
          await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, payload)
          Logger.info(`✨ Updated assignment name in Tahvel: ${nameDiff.remote} → ${nameDiff.kriit} and set journalEntryCapacityTypes to ["MAHT_i"]`)
        } catch (error) {
          Logger.error(`Failed to update assignment name for journalId=${journalId}, assignmentId=${assignmentId}: ${error.message}`)
        }
      }
    }
  }
  /**
   * Extract assignment name differences from Kriit response
   */
  extractAssignmentNameDifferences() {
    Logger.info('✨ [extractAssignmentNameDifferences] Called')
    const groupedDiffs = []
    if (!this.differences || !Array.isArray(this.differences)) {
      Logger.info('✨ [extractAssignmentNameDifferences] No differences array found.')
      return groupedDiffs
    }
    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        const nameDiffs = subject.assignments
          .filter(a => a.assignmentName && a.assignmentName.kriit !== a.assignmentName.remote)
          .map(a => ({ kriit: a.assignmentName.kriit, remote: a.assignmentName.remote, assignmentExternalId: a.assignmentExternalId }))
        if (nameDiffs.length > 0) {
          groupedDiffs.push({ subjectName: subject.subjectName, nameDiffs })
        }
      }
    })
    Logger.info(`✨ [extractAssignmentNameDifferences] Total subjects with differences: ${groupedDiffs.length}`)
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
          typeof assignment.assignmentDueAt === 'object' &&
          assignment.assignmentDueAt.kriit !== assignment.assignmentDueAt.remote
        ) {
          dueDateDiffs.push({
            subjectName: subjectDiff.subjectName,
            groupName: subjectDiff.groupName,
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName: assignment.assignmentName || '',
            dueDateKriit: assignment.assignmentDueAt.kriit,
            dueDateTahvel: assignment.assignmentDueAt.remote
          })
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

    console.log('[DEBUG] onActivate: elements', elements)

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
        console.log('[DEBUG] onActivate: journalLinks set', this.journalLinks)
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
      console.log('[DEBUG] fetchJournalData called')
      this.isLoading = true
      this.updateUI()

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
          }

          const studentDetailsMap = await this.processStudentData(id, journalStudents)
          const studentMap = this.createStudentMap(journalStudents, studentDetailsMap)

          // Merge homeworkDuedate and other missing fields from journalEntries into journalEntriesWithGrades
          let mergedEntries = []
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
              assignments
            }
          }

          // For multigroup journals, create separate entries for each group
          const groupJournalEntries = []

          // Debug logging for multigroup journals
          if (studentGroups.length > 1) {
            if (assignments.length > 0) {
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
                    const matches = personalCode === result.studentPersonalCode

                    if (matches) {
                    }

                    return matches
                  })

                  // Include student if they belong to this group
                  const belongsToGroup = student && student.studentGroup === groupName
                  if (student && !belongsToGroup) {
                  }

                  return belongsToGroup
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
              assignments: filteredAssignments
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
        const fetchStudentDetails = async () => {
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
        const fetchPromise = (async () => {
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

      // Count successes for logging
      let successCount = 0

      // Process results and add to studentDetailsMap
      for (const result of results) {
        if (result && result.data) {
          studentDetailsMap[result.studentId] = result.data
          successCount++
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
    bannerService.updateProgressUI(current, total, 'Sünkroniseerin hindeid Kriidist Tahvlisse...')
  }

  /**
   * Show success banner
   * @param {string} message - Success message
   */
  showSuccessBanner(message) {
    if (!this.isActive) return
    bannerService.showSuccessBanner(message, {
      onRefresh: () => this.fetchJournalData(),
      onClose: () => bannerService.removeBanner()
    })

    // Force a refresh of the data after 3 seconds
    Logger.debug('Setting up forced refresh in 3 seconds')
    setTimeout(() => {
      Logger.info('Forced refresh triggered')
      this.fetchJournalData()
    }, 3000)
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
    // Log the full differences array to inspect due date and other diffs
    console.log('[DEBUG] showDifferencesBanner: this.differences =', JSON.stringify(this.differences, null, 2))

    // Print each detected grade difference with details
    if (Array.isArray(this.differences)) {
      this.differences.forEach(subject => {
        if (subject && Array.isArray(subject.assignments)) {
          subject.assignments.forEach(assignment => {
            if (assignment && Array.isArray(assignment.results)) {
              assignment.results.forEach(result => {
                const tahvelGrade = result.currentGrade || '(puudub)'
                const kriitGrade = result.grade || '(puudub)'
                // Only log if there is a difference and kriitGrade is not null/empty
                if (kriitGrade !== '(puudub)' && tahvelGrade !== kriitGrade) {
                  console.log(
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
      async () => {
        await this.syncAssignmentNameDifferences()
        await this.syncWithKriit()
        await this.fetchJournalData()
      },
      () => this.fetchJournalData(),
      container => {
        const assignmentNameDiffs = this.extractAssignmentNameDifferences()
        const gradeDiffs = Array.isArray(this.differences) ? this.differences : []
        const dueDateDiffs = this.extractDueDateDifferences()
        differenceRenderer.render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs)
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
        console.log('[DEBUG] Raw diff response from backend:', JSON.stringify(response, null, 2))

        // Process the response directly
        if (response && Array.isArray(response)) {
          console.log('[DEBUG] Setting this.differences to:', JSON.stringify(response, null, 2))
          this.differences = response
          Logger.debug('Response is an array with', response.length, 'items')
        } else if (response && response.data && Array.isArray(response.data)) {
          console.log('[DEBUG] Setting this.differences to:', JSON.stringify(response.data, null, 2))
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
          console.log('[DEBUG] Backend response is not an array:', response)
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
                  // Preserve assignmentName object from diffAssignment if present, otherwise use matchingAssignment.assignmentName
                  if (
                    diffAssignment.assignmentName &&
                    typeof diffAssignment.assignmentName === 'object' &&
                    diffAssignment.assignmentName.kriit !== undefined &&
                    diffAssignment.assignmentName.remote !== undefined
                  ) {
                    // Already an object from Kriit response, keep as is
                  } else {
                    diffAssignment.assignmentName = matchingAssignment.assignmentName
                  }

                  // Process each result
                  if (diffAssignment.results && Array.isArray(diffAssignment.results)) {
                    diffAssignment.results.forEach(diffResult => {
                      // Find matching student in our data
                      const matchingResult = matchingAssignment.results.find(r => r.studentPersonalCode === diffResult.studentPersonalCode)

                      if (matchingResult) {
                        // Add student name and active status from our data
                        diffResult.studentName = matchingResult.studentName
                        diffResult.studentIsActive = matchingResult.studentIsActive

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

    this.differences.forEach(subject => {
      if (subject && Array.isArray(subject.assignments)) {
        subject.assignments.forEach(assignment => {
          if (assignment && Array.isArray(assignment.results)) {
            // Only count results that have different grades
            assignment.results.forEach(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'

              // Direct comparison since both should now be numeric
              if (tahvelGrade !== kriitGrade) {
                count++
              }
            })
          }
        })
      }
    })

    return count
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
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntry`,
        {},
        {
          cache: false, // Explicitly disable caching
          forceRefresh: true // Force a refresh
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
      const response = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        {
          cache: false, // Explicitly disable caching
          forceRefresh: true // Force a refresh
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
        // Check if we have personal codes in the response
        const hasPersonalCodes = response.some(student => student.student?.idcode)
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
        }
      }

      return response
    } catch (error) {
      return null
    }
  }

  /**
   * Get detailed information about a student by personal code
   * @param {string} personalCode - Student personal code
   * @param {number} journalId - Journal ID
   * @returns {Promise<Object>} Detailed student information
   */
  async getDetailedStudentInfo(personalCode, journalId) {
    try {
      Logger.debug(`Getting detailed info for student with personal code ${personalCode} in journal ${journalId}`)

      // First, find the student ID by personal code in our cache
      let studentId = null
      let studentInfo = null
      let journalStudentId = null // This is the ID we need for the journalStudent field

      // Get journal students to find the student by personal code
      const journalStudentsForLookup = await this.getJournalStudents(journalId)

      // Search through journal students for matching personal code
      for (const journalStudent of journalStudentsForLookup || []) {
        if (journalStudent.student && journalStudent.student.idcode === personalCode) {
          studentId = journalStudent.studentId
          journalStudentId = journalStudent.id
          studentInfo = {
            personalCode: journalStudent.student.idcode,
            name: journalStudent.student.fullname || journalStudent.studentName,
            isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
          }
          break
        }
      }

      if (!studentId) {
        return { error: `Student with personal code ${personalCode} not found in cache` }
      }

      // Get all journal students to see if this student is enrolled
      const journalStudents = await this.getJournalStudents(journalId)

      // Log the journal students response for debugging
      if (journalStudents && journalStudents.length > 0) {
        Logger.debug(`Journal students response structure: ${Object.keys(journalStudents[0]).join(', ')}`)
        Logger.debug(`First journal student: ${JSON.stringify(journalStudents[0])}`)
      }

      // Check if the student is enrolled in this journal and get their journalStudentId
      let matchingJournalStudent = null
      const isEnrolled =
        journalStudents &&
        journalStudents.some(js => {
          const matches = String(js.studentId) === String(studentId)
          if (matches) {
            matchingJournalStudent = js
            journalStudentId = js.id // This is the ID we need for the journalStudent field
          }
          return matches
        })

      if (matchingJournalStudent) {
        Logger.debug(
          `Found matching journal student: ID=${matchingJournalStudent.id}, studentId=${matchingJournalStudent.studentId}, name=${matchingJournalStudent.studentName}`
        )
      } else {
        // If we couldn't find the student in the journal students, try to find them by name
        Logger.debug(`Could not find student with ID ${studentId} in journal students. Trying to find by name...`)

        // Try to find the student by name
        const studentName = studentInfo?.name
        if (studentName) {
          const matchByName =
            journalStudents && journalStudents.find(js => js.studentName && js.studentName.toLowerCase().includes(studentName.toLowerCase()))

          if (matchByName) {
            matchingJournalStudent = matchByName
            journalStudentId = matchByName.id
            Logger.debug(`Found student by name: ID=${matchByName.id}, studentId=${matchByName.studentId}, name=${matchByName.studentName}`)
          }
        }

        // If we still couldn't find the student, log all journal students for debugging
        if (!matchingJournalStudent && journalStudents && journalStudents.length > 0) {
          Logger.debug(`All journal students (${journalStudents.length}):`)
          journalStudents.forEach(js => {
            Logger.debug(`- ID=${js.id}, studentId=${js.studentId}, name=${js.studentName || 'Unknown'}`)
          })
        }
      }

      // Get all assignments for this journal
      const journalEntries = await this.api.tahvel.get(`/journals/${journalId}/journalEntry`, {})

      // Check which assignments the student is enrolled in
      const enrolledAssignments = []

      // The journalEntry endpoint returns a paginated list of entries
      if (journalEntries && Array.isArray(journalEntries)) {
        Logger.debug(`Found ${journalEntries.length} entries in journal ${journalId}`)

        for (const entry of journalEntries) {
          // Only process entries that are homework, graded entries, or outcomes
          if (entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_O') {
            // Handle outcome entries differently since they don't have regular entry IDs
            if (entry.entryType === 'SISSEKANNE_O') {
              // For outcome entries, we need to use the journalOutcome endpoint
              const outcomeDetails = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${entry.curriculumModuleOutcomes}`)

              if (outcomeDetails && outcomeDetails.outcomeStudents) {
                const isInOutcome = outcomeDetails.outcomeStudents.some(
                  student => student.journalStudent && String(student.journalStudent) === String(studentId)
                )

                if (isInOutcome) {
                  // Get the outcome name
                  const assignmentName = entry.nameEt || outcomeDetails.nameEt || 'Õppetulemus'
                  Logger.debug(`Student ${studentId} is enrolled in outcome: ${assignmentName}`)

                  enrolledAssignments.push({
                    id: entry.curriculumModuleOutcomes,
                    name: assignmentName,
                    entryType: entry.entryType
                  })
                }
              }
            } else {
              // Get the entry details with allStudents=true to get data for all students
              const entryDetails = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${entry.id}`, { allStudents: true })

              if (entryDetails && entryDetails.journalEntryStudents) {
                const isInAssignment = entryDetails.journalEntryStudents.some(
                  student => student.journalStudent && String(student.journalStudent) === String(studentId)
                )

                if (isInAssignment) {
                  // Get the assignment name
                  const assignmentName = entry.nameEt || entry.name

                  enrolledAssignments.push({
                    id: entry.id,
                    name: assignmentName,
                    entryType: entry.entryType
                  })
                }
              }
            }
          }
        }

        Logger.debug(`Student ${studentInfo?.name} is enrolled in ${enrolledAssignments.length} assignments in journal ${journalId}`)
      } else {
        Logger.warning(`No entries found in journal ${journalId} or unexpected response format`)
        Logger.debug(`Journal entries response: ${JSON.stringify(journalEntries)}`)
      }

      // Return detailed information
      return {
        personalCode,
        studentId,
        journalStudentId, // This is the ID we need for the journalStudent field
        name: studentInfo?.name,
        isActive: studentInfo?.isActive,
        isEnrolledInJournal: isEnrolled,
        enrolledAssignments,
        journalId,
        cacheInfo: studentInfo
      }
    } catch (error) {
      Logger.error(`Error getting detailed student info: ${error.message}`)
      return { error: error.message }
    }
  }

  /**
   * Get student group data from API with caching
   * @param {number} groupId - Student group ID
   * @returns {Promise<Array>} Student group data
   */
  async getStudentGroupData(groupId) {
    if (!groupId) {
      Logger.error('Cannot fetch student group data: groupId is undefined or null')
      return null
    }

    try {
      const response = await this.api.tahvel.get(
        `/studentGroups/${groupId}/students`,
        {},
        {
          cacheExpiration: 30 * 24 * 60 * 60 * 1000 // 30 days
        }
      )

      if (response && Array.isArray(response)) {
        Logger.debug(`Retrieved ${response.length} students for group ${groupId}`)
      } else {
        Logger.warning(`Unexpected response format for student group ${groupId}:`, response)
      }

      return response
    } catch (error) {
      Logger.error(`Error fetching student group data for ${groupId}:`, error)
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
    const studentMap = {
      idToPersonalCode: {},
      personalCodeToName: {},
      journalStudentIdToId: {}
    }

    // First, map journal student IDs to student IDs
    if (journalStudents && Array.isArray(journalStudents)) {
      // Only log once per journal, not for every student

      journalStudents.forEach(journalStudent => {
        if (journalStudent?.id && journalStudent?.studentId) {
          studentMap.journalStudentIdToId[journalStudent.id] = journalStudent.studentId

          // If we have details for this student from our direct API calls
          if (studentDetailsMap[journalStudent.studentId]) {
            const details = studentDetailsMap[journalStudent.studentId]
            studentMap.idToPersonalCode[journalStudent.studentId] = details.personalCode
            studentMap.personalCodeToName[details.personalCode] = details.name
          }
          // If we don't have details, throw an error to stop execution
          else {
            const errorMsg = `No personal code found for student ID ${journalStudent.studentId} in student details map - cannot proceed`
            Logger.error(errorMsg)
            throw new Error(errorMsg)
          }
        }
      })

      // Log mapping statistics
    } else {
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

    console.log('[DEBUG] extractAssignmentsFromEntries called', { journalEntries })

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
      outcomeEntries.forEach(entry => {})
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

    console.log('[DEBUG] Processing gradedEntries', gradedEntries)
    gradedEntries.forEach(entry => {
      // Log when we process an outcome entry
      if (entry.entryType === 'SISSEKANNE_O') {
      }

      // Extract results for this assignment
      const results = []

      // Handle different entry types for finding grades
      let entryWithGrades = null
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
          const entryIdForLog = entry.entryType === 'SISSEKANNE_O' ? entry.curriculumModuleOutcomes : entry.id
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
        Logger.info(
          `✨ [DEBUG] Mapping assignment: id=${assignmentId}, name=${assignmentName}, homeworkDuedate=${entry.homeworkDuedate}, entryDate=${entry.entryDate}`
        )
        console.log('[DEBUG] Mapping assignment FULL ENTRY', entry)
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
              assignment.results.forEach(result => {
                Logger.debug(
                  `[SYNC] Assignment ${assignment.assignmentExternalId} - Student: ${result.studentName}, PersonalCode: ${result.studentPersonalCode}`
                )
              })
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

      this.differences.forEach(subject => {
        if (!subject.assignments || !Array.isArray(subject.assignments)) return

        subject.assignments.forEach(assignment => {
          if (!assignment.results || !Array.isArray(assignment.results)) return

          assignment.results.forEach(result => {
            // Throw error if any results have missing personal codes
            if (!result.studentPersonalCode) {
              const errorMsg = 'Found missing personal code for a student - cannot proceed with sync'
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Skip syncing grades for deleted or inactive students
            if (result.studentIsDeleted === true) {
              Logger.info(`Skipping grade sync for deleted student: ${result.studentName} (${result.studentPersonalCode})`)
              return // Do not sync this student's grade
            }
            if (result.studentIsActive === false) {
              Logger.info(`Skipping grade sync for inactive student: ${result.studentName} (${result.studentPersonalCode})`)
              return // Do not sync this student's grade
            }

            // Check if personal code is a string and contains 'fallback-'
            if (typeof result.studentPersonalCode === 'string' && result.studentPersonalCode.includes('fallback-')) {
              const errorMsg = `Found invalid personal code: ${result.studentPersonalCode} - cannot proceed with sync`
              Logger.error(errorMsg)
              this.error = errorMsg
              throw new Error(errorMsg)
            }

            // Enhanced debug logging for every grade being processed
            Logger.debug('=== PROCESSING GRADE ===')
            Logger.debug(`Subject: ${subject.subjectName} (${subject.subjectExternalId})`)
            Logger.debug(`Assignment: ${assignment.assignmentName} (${assignment.assignmentExternalId})`)
            Logger.debug(`Student: ${result.studentName} (${result.studentPersonalCode})`)
            Logger.debug(`Raw Tahvel grade: "${result.currentGrade}"`)
            Logger.debug(`Raw Kriit grade: "${result.grade}"`)

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

            Logger.debug(`Processed Tahvel grade: "${tahvelGrade}"`)
            Logger.debug(`Kriit grade: "${kriitGrade}"`)

            // Skip null grades from Kriit entirely - don't sync them
            if (kriitGrade === null) {
              Logger.debug('Skipping null/empty grade from Kriit - not syncing')
              return // Skip this result entirely
            }

            // Only sync if grades are actually different
            if (tahvelGrade !== kriitGrade) {
              // Log the types we're getting for debugging
              Logger.debug(`Student personal code type: ${typeof result.studentPersonalCode}, value: ${result.studentPersonalCode}`)
              Logger.debug(`Grade type: ${typeof result.grade}, value: ${result.grade}`)
              Logger.debug(`Will sync: Tahvel="${tahvelGrade}" -> Kriit="${kriitGrade}"`)

              // Convert studentPersonalCode and grade to strings to ensure they're the correct type
              const personalCode = result.studentPersonalCode ? String(result.studentPersonalCode) : null
              const gradeStr = result.grade ? String(result.grade) : null

              // Double-check that we have valid data before adding to sync list
              if (!personalCode || !gradeStr) {
                Logger.warning(`Skipping sync item due to missing data: personalCode="${personalCode}", grade="${gradeStr}"`)
                return
              }

              syncData.push({
                journalId: subject.subjectExternalId,
                assignmentId: assignment.assignmentExternalId,
                studentPersonalCode: personalCode,
                grade: gradeStr
              })
            } else {
              Logger.debug(`Grades are the same, skipping: Tahvel="${tahvelGrade}", Kriit="${kriitGrade}"`)
            }
          })
        })
      })

      if (syncData.length === 0) {
        Logger.warning('No data to sync after processing')
        Logger.debug('=== SYNC STATUS CHECK ===')
        Logger.debug('syncData is empty, meaning no differences were found or all are filtered out')
        Logger.debug(`Original differences count: ${this.differences ? this.differences.length : 0}`)

        // Count total assignments and results for debugging
        let totalAssignments = 0
        let totalResults = 0
        let skippedResults = 0

        if (this.differences && Array.isArray(this.differences)) {
          this.differences.forEach(subject => {
            if (subject.assignments && Array.isArray(subject.assignments)) {
              totalAssignments += subject.assignments.length
              subject.assignments.forEach(assignment => {
                if (assignment.results && Array.isArray(assignment.results)) {
                  totalResults += assignment.results.length
                  assignment.results.forEach(result => {
                    const tahvelGrade = result.currentGrade || '(empty)'
                    const kriitGrade = result.grade || '(empty)'
                    if (tahvelGrade === kriitGrade) {
                      skippedResults++
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

      // Process each grade change one by one
      const successfulSyncs = []
      const failedSyncs = []
      let currentItem = null

      try {
        // Update UI to show progress
        this.updateProgressUI(0, syncData.length)

        for (let i = 0; i < syncData.length; i++) {
          const item = syncData[i]
          currentItem = item

          Logger.info(`=== Syncing student ${i + 1}/${syncData.length}: ${item.studentPersonalCode} ===`)

          // Update progress in UI (with safe error handling)
          try {
            this.updateProgressUI(i, syncData.length)
          } catch (progressError) {
            Logger.warning(`Progress UI update failed: ${progressError.message}`)
            // Continue with sync even if progress UI fails
          }

          try {
            // Validate item properties before calling syncGradeToTahvel
            if (!item.journalId) {
              throw new Error('Missing journalId in sync item')
            }

            if (!item.assignmentId) {
              throw new Error('Missing assignmentId in sync item')
            }

            if (!item.studentPersonalCode) {
              throw new Error('Missing studentPersonalCode in sync item')
            }

            if (!item.grade) {
              throw new Error('Missing grade in sync item')
            }

            // Log the item we're about to process
            Logger.debug(
              `Processing sync item: ${JSON.stringify({
                journalId: item.journalId,
                assignmentId: item.assignmentId,
                studentPersonalCode: item.studentPersonalCode,
                grade: item.grade
              })}`
            )

            // Additional validation: check if this grade actually needs updating
            // by fetching the current state from Tahvel
            try {
              const entryData = await this.api.tahvel.get(`/journals/${item.journalId}/journalEntry/${item.assignmentId}`, { allStudents: true })

              if (entryData && entryData.journalEntryStudents) {
                // Find the student in the assignment
                let studentEntry = null
                for (const student of entryData.journalEntryStudents) {
                  if (!student.journalStudent) continue
                  const cachedStudent = await this.getCachedStudent(student.journalStudent)
                  if (cachedStudent && String(cachedStudent.personalCode) === String(item.studentPersonalCode)) {
                    studentEntry = student
                    break
                  }
                }

                if (studentEntry && studentEntry.grade && studentEntry.grade.code) {
                  const currentTahvelGrade = studentEntry.grade.code.replace('KUTSEHINDAMINE_', '')
                  const targetGrade = String(item.grade)

                  if (currentTahvelGrade === targetGrade) {
                    Logger.info(
                      `Grade already up to date for student ${item.studentPersonalCode}: current="${currentTahvelGrade}", target="${targetGrade}" - skipping`
                    )
                    successfulSyncs.push({ ...item, skipped: true }) // Count as successful since no action was needed
                    continue
                  }

                  Logger.debug(`Grade needs update for student ${item.studentPersonalCode}: current="${currentTahvelGrade}", target="${targetGrade}"`)
                }
              }
            } catch (preCheckError) {
              Logger.warning(`Could not pre-validate grade for student ${item.studentPersonalCode}: ${preCheckError.message}`)
              // Continue with sync attempt anyway
            }

            // Call the sync method with validated data
            Logger.info(`Calling syncGradeToTahvel for student ${item.studentPersonalCode}...`)
            await this.syncGradeToTahvel(item.journalId, item.assignmentId, item.studentPersonalCode, item.grade)

            Logger.info(`Successfully synced grade for student ${item.studentPersonalCode}`)
            // Add to successful syncs
            successfulSyncs.push(item)
          } catch (error) {
            // Check if this is an inactive student error
            const errorMessage = error.message || 'Unknown error'
            const isInactiveStudentError =
              errorMessage.includes('not actively studying') ||
              errorMessage.includes('changeIsNotAllowedStudentIsNotStudying') ||
              errorMessage.includes('academic leave') ||
              errorMessage.includes('status is inactive')

            if (isInactiveStudentError) {
              // Log as warning instead of error for inactive students
              Logger.warning(
                `Skipping inactive student ${item.studentPersonalCode || 'unknown'} in assignment ${item.assignmentId || 'unknown'}: ${errorMessage}`
              )

              // Add to failed syncs but mark as inactive (not a real error)
              failedSyncs.push({
                ...item,
                error: errorMessage,
                errorType: 'inactive_student',
                timestamp: new Date().toISOString()
              })
            } else {
              // Log the error with full context for real errors
              Logger.error(
                `Failed to sync grade for student ${item.studentPersonalCode || 'unknown'} in assignment ${item.assignmentId || 'unknown'}:`,
                error
              )

              // Add to failed syncs with detailed error info
              failedSyncs.push({
                ...item,
                error: errorMessage,
                errorType: 'sync_error',
                timestamp: new Date().toISOString()
              })
            }
          }

          Logger.debug(`Completed processing student ${i + 1}/${syncData.length}. Moving to next student...`)

          // Add delay between sync operations to prevent race conditions
          if (i < syncData.length - 1) {
            // Don't delay after the last item
            Logger.debug(`Adding 500ms delay before next sync operation...`)
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }

        // Final progress update
        Logger.info(`Sync loop completed. Updating final progress: ${syncData.length}/${syncData.length}`)
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

        Logger.info(`=== SYNC SUMMARY ===`)
        Logger.info(`Total items processed: ${syncData.length}`)
        Logger.info(`Successful syncs: ${successfulSyncs.length}`)
        Logger.info(`Failed syncs: ${failedSyncs.length}`)
        if (inactiveStudentErrors.length > 0) {
          Logger.info(`  - Inactive students skipped: ${inactiveStudentErrors.length}`)
        }
        if (realErrors.length > 0) {
          Logger.info(`  - Real sync errors: ${realErrors.length}`)
        }
        Logger.info(`==================`)

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

          Logger.info(`Showing success banner: ${successMessage}`)
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
            Logger.info(
              `Inactive students skipped: ${JSON.stringify(
                inactiveStudentErrors.map(item => ({
                  student: item.studentPersonalCode,
                  assignment: item.assignmentId,
                  reason: 'Not actively studying'
                }))
              )}`
            )
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
            Logger.info(
              'Some students skipped due to inactive status. Details:',
              inactiveStudentErrors.map(item => ({
                student: item.studentPersonalCode,
                assignment: item.assignmentId,
                reason: 'Not actively studying'
              }))
            )
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

        let errorMessage = 'Sünkroniseerimine ebaõnnestus ootamatu vea tõttu.'

        if (currentItem) {
          errorMessage += ` Viga tekkis õpilase ${currentItem.studentPersonalCode} hinde sünkroniseerimisel.`

          // Log details about which item caused the error
          Logger.error(`Error occurred while processing item: ${JSON.stringify(currentItem)}`)
        }

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
   * Sync a single grade from Kriit to Tahvel
   * @param {number} journalId - Journal ID
   * @param {number} assignmentId - Assignment ID
   * @param {string} studentPersonalCode - Student personal code
   * @param {string|number} grade - Grade to set (numeric 1-5, MA, or A)
   * @returns {Promise<Object>} Response data
   */
  async syncGradeToTahvel(journalId, assignmentId, studentPersonalCode, grade) {
    try {
      Logger.info('=== STARTING GRADE SYNC ===')
      Logger.info(`Syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}`)
      Logger.debug(
        `Full sync parameters: journalId=${journalId}, assignmentId=${assignmentId}, studentPersonalCode=${studentPersonalCode}, grade=${grade}`
      )

      // Validate input parameters
      if (!journalId) {
        throw new Error('Journal ID is required for syncing grades')
      }

      if (!assignmentId) {
        throw new Error('Assignment ID is required for syncing grades')
      }

      if (!studentPersonalCode) {
        throw new Error('Student personal code is required for syncing grades')
      }

      // Ensure studentPersonalCode is a string - convert if necessary
      if (typeof studentPersonalCode !== 'string') {
        Logger.debug(`Converting studentPersonalCode from ${typeof studentPersonalCode} to string: ${studentPersonalCode}`)
        studentPersonalCode = String(studentPersonalCode)
      }

      // Proactive check: verify student is active before attempting sync
      Logger.debug(`Checking if student ${studentPersonalCode} is active before sync...`)

      // First, try to find the student by getting journal students
      let studentCacheEntry = null
      const journalStudentsForValidation = await this.getJournalStudents(journalId)

      if (journalStudentsForValidation) {
        for (const journalStudent of journalStudentsForValidation) {
          if (journalStudent.student && journalStudent.student.idcode === studentPersonalCode) {
            studentCacheEntry = {
              personalCode: journalStudent.student.idcode,
              name: journalStudent.student.fullname || journalStudent.studentName,
              isActive: journalStudent.student.status === 'OPPURSTAATUS_O',
              isDeleted: false // Assume false if student is in journal
            }
            break
          }
        }
      }

      // If we found the student in cache, check their status
      if (studentCacheEntry) {
        Logger.debug(
          `Found student ${studentCacheEntry.name} (${studentPersonalCode}) in cache. Active: ${studentCacheEntry.isActive}, Deleted: ${studentCacheEntry.isDeleted}`
        )

        if (!studentCacheEntry.isActive || studentCacheEntry.isDeleted) {
          const statusReason = studentCacheEntry.isDeleted ? 'deleted' : 'inactive'
          throw new Error(
            `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
          )
        }
      } else {
        Logger.warning(
          `Student ${studentPersonalCode} not found in cache during proactive check. Will proceed with sync attempt but may fail if student is inactive.`
        )
      }

      if (!grade) {
        throw new Error('Grade value is required for syncing grades')
      }

      // Validate that grade is either numeric (1-5) or valid Estonian vocational grade (MA, A)
      const gradeStr = String(grade).toUpperCase()
      const numericGrade = parseInt(gradeStr, 10)

      // Allow numeric grades 1-5 or Estonian vocational grades MA (Mittearvestatav) and A (Arvestatud)
      const isValidNumeric = !isNaN(numericGrade) && numericGrade >= 1 && numericGrade <= 5
      const isValidNonNumeric = gradeStr === 'MA' || gradeStr === 'A'

      if (!isValidNumeric && !isValidNonNumeric) {
        throw new Error(`Invalid grade value: ${grade}. Expected numeric grade 1-5, MA (Mittearvestatav), or A (Arvestatud).`)
      }

      // Use the grade directly (numeric or Estonian vocational grade)
      Logger.info(`Syncing grade ${grade} directly to Tahvel`)

      // First, get the current entry data - force fresh data to avoid caching issues
      let entryData
      try {
        // Clear any existing cache for this specific assignment to ensure fresh data
        const cacheKey = `GET_${this.api.tahvel.baseUrl}/journals/${journalId}/journalEntry/${assignmentId}?allStudents=true`
        await cacheService.clearCache(cacheKey)

        // Use allStudents=true to get data for all students, not just the current user's students
        entryData = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${assignmentId}`, { allStudents: true })
      } catch (error) {
        throw new Error(`Failed to fetch assignment data: ${error.message}. Check if the assignment still exists in Tahvel.`)
      }

      if (!entryData) {
        throw new Error(`No data returned for assignment ${assignmentId}. The assignment may have been deleted.`)
      }

      if (!entryData.journalEntryStudents || !Array.isArray(entryData.journalEntryStudents)) {
        throw new Error(`Assignment ${assignmentId} has no student data. Structure: ${JSON.stringify(Object.keys(entryData))}`)
      }

      // Log the number of students in the entry for debugging
      Logger.info(`Assignment ${assignmentId} has ${entryData.journalEntryStudents.length} students`)

      // Log the target personal code we're looking for
      Logger.info(`Looking for student with personal code: ${studentPersonalCode}`)

      // Ensure we have journal students data (this will use caching)
      await this.getJournalStudents(journalId)

      // First, try to find the student by personal code using journal students
      // This is more reliable than searching through the entry data
      let matchingStudentId = null

      // Convert target personal code to string for comparison
      const targetPersonalCode = String(studentPersonalCode)

      // Get journal students to find the matching student
      const journalStudentsForMatching = await this.getJournalStudents(journalId)

      if (journalStudentsForMatching) {
        for (const journalStudent of journalStudentsForMatching) {
          if (journalStudent.student && journalStudent.student.idcode === targetPersonalCode) {
            matchingStudentId = journalStudent.studentId
            Logger.debug(
              `Found exact matching student in journal students: ${journalStudent.student.fullname || journalStudent.studentName} (${journalStudent.student.idcode})`
            )
            break
          }
        }
      }

      // If we found the student in our global cache, find that student in the entry data
      let studentEntry = null
      if (matchingStudentId) {
        studentEntry = entryData.journalEntryStudents.find(
          student => student.journalStudent && String(student.journalStudent) === String(matchingStudentId)
        )

        if (studentEntry) {
          Logger.debug(`Found matching student entry in assignment data: ${studentEntry.journalStudent}`)
        } else {
          // This is a special case: we found the student in journal students but they're not in this assignment API response
          const cachedStudent = await this.getCachedStudent(matchingStudentId)
          const studentName = cachedStudent ? cachedStudent.name : 'Unknown'

          Logger.warning(
            `Student ${studentName} (${targetPersonalCode}) with ID ${matchingStudentId} found in global cache but not in assignment API response`
          )
          Logger.warning(`This may indicate an API discrepancy - student exists in database but not returned by /journalEntry/${assignmentId}`)

          // Get detailed student info to find the correct journalStudentId
          const info = await this.getDetailedStudentInfo(targetPersonalCode, journalId)
          Logger.debug(`Detailed student info for ${targetPersonalCode}: ${JSON.stringify(info)}`)

          // Try to create a student entry with the journalStudentId
          // This handles cases where the API doesn't return all enrolled students but they exist in the database
          if (info.journalStudentId) {
            // Create a new student entry with the correct journalStudentId
            studentEntry = {
              journalStudent: info.journalStudentId,
              id: null, // This will be assigned by the server
              studentName: cachedStudent ? cachedStudent.name : 'Unknown',
              grade: null, // Will be set later
              addInfo: null,
              absence: null,
              absenceInserted: null,
              gradeInserted: null,
              gradeInsertedBy: null,
              inserted: null,
              isRemark: false,
              journalEntryStudentHistories: [],
              lessonAbsences: [],
              verbalGrade: null
            }

            Logger.info(`Created student entry with journalStudentId ${info.journalStudentId} to handle API discrepancy`)
            Logger.info(`Database shows student is enrolled - proceeding with sync despite API inconsistency`)
          } else {
            // If we couldn't find a journalStudentId, check if the student is active
            if (cachedStudent && !cachedStudent.isActive) {
              Logger.warning(`Student ${studentName} (${targetPersonalCode}) is not active. Status: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
              throw new Error(
                `Cannot add student ${studentName} (${targetPersonalCode}) to the assignment because they are not actively studying. The student may be on academic leave or their status is inactive.`
              )
            }

            // If we couldn't find a journalStudentId, throw an error
            throw new Error(
              `❌ Student ${studentName} (${targetPersonalCode}) exists in the journal but has no valid journal student ID. This may indicate a data integrity issue. Please contact support.`
            )
          }
        }
      }

      // If we still don't have a match, try the old method of searching through entry data
      if (!studentEntry) {
        Logger.debug(`Falling back to searching through entry data for student with personal code ${studentPersonalCode}`)

        // First, log all students in the entry data for debugging
        Logger.debug('All students in entry data:')
        for (const student of entryData.journalEntryStudents) {
          const studentId = student.journalStudent
          const cachedStudent = await this.getCachedStudent(studentId)
          const personalCode = cachedStudent ? cachedStudent.personalCode : 'Unknown'
          const name = cachedStudent ? cachedStudent.name : 'Unknown'
          Logger.debug(`- ID: ${student.id}, journalStudent: ${studentId}, personalCode: ${personalCode}, name: ${name}, addInfo: ${student.addInfo}`)
        }

        // Find student by iterating through entry data and checking cache
        for (const student of entryData.journalEntryStudents) {
          // We need to find the student by personal code, but the entry data doesn't have it directly
          if (!student.journalStudent) {
            continue
          }

          // Try to find the student in our cache
          const studentId = student.journalStudent

          // Check if we have this student in our cache
          const cachedStudent = await this.getCachedStudent(studentId)
          if (cachedStudent) {
            // Ensure the cached student has a personalCode property
            if (!cachedStudent.personalCode) {
              continue
            }

            // Convert both to strings for comparison to handle number vs string issues
            const cachedPersonalCode = String(cachedStudent.personalCode)

            // Now we can safely compare the personal codes
            const matches = cachedPersonalCode === targetPersonalCode

            if (matches) {
              Logger.debug(`Found matching student in entry data: ${cachedStudent.name} (${cachedPersonalCode})`)
              Logger.debug(`Student entry details: ID=${student.id}, journalStudent=${student.journalStudent}, addInfo=${student.addInfo}`)
              studentEntry = student
              break
            }
          }
        }

        // If we couldn't find the student by personal code, try to find by similar personal code
        // but DO NOT substitute with a completely different student
        if (!studentEntry) {
          Logger.debug(`Could not find student with personal code ${studentPersonalCode}, trying to find similar personal codes...`)

          // Try to find a student with a similar personal code
          // This is useful if the personal code formats are different (e.g., with/without leading zeros)
          const targetPersonalCode = String(studentPersonalCode)

          // First, try to find a student with a similar personal code
          for (const student of entryData.journalEntryStudents) {
            if (!student.journalStudent) continue

            const cachedStudent = await this.getCachedStudent(student.journalStudent)
            if (!cachedStudent || !cachedStudent.personalCode) continue

            const cachedPersonalCode = String(cachedStudent.personalCode)

            // Check if the personal codes are similar (one contains the other)
            if (cachedPersonalCode.includes(targetPersonalCode) || targetPersonalCode.includes(cachedPersonalCode)) {
              Logger.debug(`Found student with similar personal code: ${cachedStudent.name} (${cachedPersonalCode})`)
              studentEntry = student
              break
            }

            // Check if the last 8 digits match (sometimes personal codes have different formats)
            const cachedLastDigits = cachedPersonalCode.slice(-8)
            const targetLastDigits = targetPersonalCode.slice(-8)
            if (cachedLastDigits === targetLastDigits && cachedLastDigits.length === 8) {
              Logger.debug(`Found student with matching last 8 digits: ${cachedStudent.name} (${cachedPersonalCode})`)
              studentEntry = student
              break
            }
          }

          // If we still don't have a match, DO NOT use a random student as fallback
          // Instead, throw an error to prevent updating the wrong student's grade
          if (!studentEntry) {
            throw new Error(
              `Could not find student with personal code ${studentPersonalCode} or any similar personal code. Refusing to update a different student's grade for safety reasons.`
            )
          }
        }

        if (!studentEntry) {
          // Build a helpful error message
          let errorMessage = `Student with personal code ${studentPersonalCode} not found in assignment ${assignmentId}.`

          // Add more specific diagnostic information
          errorMessage += `\n\nDiagnostic Info:`
          errorMessage += `\n- Assignment ID: ${assignmentId}`
          errorMessage += `\n- Journal ID: ${journalId}`
          errorMessage += `\n- Students in assignment: ${entryData.journalEntryStudents.length}`

          // Check if student exists in journal students
          const journalStudentsForCheck = await this.getJournalStudents(journalId)
          let studentInJournal = null

          if (journalStudentsForCheck) {
            for (const journalStudent of journalStudentsForCheck) {
              if (journalStudent.student && journalStudent.student.idcode === String(studentPersonalCode)) {
                studentInJournal = {
                  name: journalStudent.student.fullname || journalStudent.studentName,
                  personalCode: journalStudent.student.idcode,
                  isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
                }
                break
              }
            }
          }

          if (studentInJournal) {
            errorMessage += `\n- Student EXISTS in journal: ${studentInJournal.name} (${studentInJournal.personalCode})`
            errorMessage += `\n- Student status: ${studentInJournal.isActive ? 'Active' : 'Inactive'}`
            errorMessage += `\n- This means the student is NOT enrolled in this specific assignment`
            errorMessage += `\n\nSOLUTION: The student needs to be manually added to this assignment in Tahvel first, then you can sync the grade.`
          } else {
            errorMessage += `\n- Student NOT FOUND in journal`
            errorMessage += `\n- This means the student is not enrolled in this journal at all`
          }

          throw new Error(errorMessage)
        }

        // Check if we have a valid journalStudent ID
        if (!studentEntry.journalStudent) {
          // We need to wait for the journalStudentId from getDetailedStudentInfo
          Logger.warning(`No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update.`)
          throw new Error(
            `No valid journalStudent ID found for student ${studentPersonalCode}. Cannot proceed with update. This might be because the student is not enrolled in this journal.`
          )
        }

        // Log the current grade for debugging
        const currentGradeCode = studentEntry.grade?.code || 'No grade'
        Logger.debug(`Current grade for student ${studentPersonalCode}: ${currentGradeCode}`)

        // If we're using a fallback student, log a warning
        const cachedStudentForFallback = await this.getCachedStudent(studentEntry.journalStudent)
        if (cachedStudentForFallback && String(cachedStudentForFallback.personalCode) !== String(studentPersonalCode)) {
          Logger.warning(
            `WARNING: Using fallback student ${cachedStudentForFallback.name} (${cachedStudentForFallback.personalCode}) instead of requested student with personal code ${studentPersonalCode}`
          )
        }

        // Prepare the update data - following the exact structure used by the Angular app
        // Create the updated student entry with the new grade
        const updatedStudentEntry = {
          id: studentEntry.id, // This might be null for new students
          journalStudent: Number(studentEntry.journalStudent), // Convert to number to match Angular's format
          absence: null,
          grade: {
            code: `KUTSEHINDAMINE_${grade}`,
            gradingSchemaRowId: null,
            value: String(grade),
            value2: String(grade),
            extraval1: null,
            extraval2: null,
            nameEt: `Hinne ${grade}`,
            nameEn: `Grade ${grade}`,
            valid: true
          },
          verbalGrade: null,
          removeStudentHistory: true, // Don't remove history for grade updates
          // For addInfo, we'll use the pattern from existing students or a default
          addInfo: this.getAddInfoFromExistingStudents(entryData.journalEntryStudents),
          isLessonAbsence: false,
          hasOverlappingLessonAbsence: false,
          isPraise: false,
          isRemark: false,
          lessonAbsences: {},
          studentName: null,
          studentGroup: null,
          journalEntryStudentHistories: [],
          hasWholeDayAcceptedAbsence: false,
          wholeDayAbsenceCode: null,
          gradeValue: null
        }

        // Create the update data with ONLY the student we're updating
        // This prevents 412 errors caused by inactive students in the assignment
        const existingStudentIndex = entryData.journalEntryStudents.findIndex(
          student => student.journalStudent && Number(student.journalStudent) === Number(updatedStudentEntry.journalStudent)
        )

        let finalStudentEntry
        if (existingStudentIndex !== -1) {
          // If the student is already in the entry, update their entry
          Logger.info(`Student ${studentPersonalCode} is already in the assignment. Updating existing entry.`)

          // Get the original student entry
          const originalStudentEntry = entryData.journalEntryStudents[existingStudentIndex]
          Logger.debug(
            `Original student entry: ${JSON.stringify({
              id: originalStudentEntry.id,
              journalStudent: originalStudentEntry.journalStudent,
              addInfo: originalStudentEntry.addInfo,
              grade: originalStudentEntry.grade?.code || 'No grade'
            })}`
          )

          // Only update the grade, keeping all other fields intact
          finalStudentEntry = {
            ...originalStudentEntry,
            grade: updatedStudentEntry.grade,
            // Make sure to keep the original ID
            id: originalStudentEntry.id,
            // Don't remove student history when updating existing student
            removeStudentHistory: true
          }
        } else {
          // If the student is not in the entry, use the new entry
          Logger.info(`Student ${studentPersonalCode} is not in the assignment. Adding new entry.`)
          finalStudentEntry = updatedStudentEntry
        }

        // Check if this specific student is active before sending the update
        const cachedStudentForStatus = await this.getCachedStudent(finalStudentEntry.journalStudent)
        if (cachedStudentForStatus && (!cachedStudentForStatus.isActive || cachedStudentForStatus.isDeleted)) {
          const statusReason = cachedStudentForStatus.isDeleted ? 'deleted' : 'inactive'
          throw new Error(
            `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student's status is ${statusReason} in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`
          )
        }

        // Create array with only the student we're updating to avoid 412 errors from inactive students
        const studentsToUpdate = [finalStudentEntry]

        // Add student names to the entry for debugging purposes
        const studentsWithNames = []
        for (const student of studentsToUpdate) {
          // Use the cache lookup helper method
          const cachedStudent = await this.getCachedStudent(student.journalStudent)
          const studentName = cachedStudent ? cachedStudent.name : 'Unknown'
          const studentPersonalCode = cachedStudent ? cachedStudent.personalCode : 'Unknown'
          const isActive = cachedStudent ? cachedStudent.isActive : 'Unknown'
          const isDeleted = cachedStudent ? cachedStudent.isDeleted : 'Unknown'
          const gradeCode = student.grade?.code || 'No grade'

          Logger.info(
            `Student: ${studentName} (${studentPersonalCode}) - Active: ${isActive}, Deleted: ${isDeleted}, Grade: ${gradeCode}, JournalStudentId: ${student.journalStudent}`
          )

          studentsWithNames.push({
            ...student,
            // Add student name for debugging
            studentName: studentName,
            // Also add personal code for easier identification
            studentPersonalCode: studentPersonalCode
          })
        }

        // Create the update data with filtered students that include names
        const updateData = {
          ...entryData,
          journalEntryStudents: studentsWithNames
        }

        // Make sure we include all the fields that the Angular app includes
        if (!updateData.version && entryData.version) {
          updateData.version = entryData.version
        }

        // Ensure teacher information is in the correct format
        if (entryData.teacherSelection && Array.isArray(entryData.teacherSelection)) {
          updateData.teacherSelection = entryData.teacherSelection
        }

        // Convert journalEntryTeachers to strings if they're not already
        if (Array.isArray(updateData.journalEntryTeachers)) {
          updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => String(id))
        }

        // Make sure we have the correct capacity types
        if (!updateData.journalEntryCapacityTypes && entryData.entryType) {
          // Set default capacity types based on entry type
          if (entryData.entryType === 'SISSEKANNE_I') {
            updateData.journalEntryCapacityTypes = ['MAHT_i']
          } else if (entryData.entryType === 'SISSEKANNE_H') {
            updateData.journalEntryCapacityTypes = ['MAHT_h']
          }
        }

        // Convert teacher IDs from numbers to strings for the PUT request
        if (Array.isArray(updateData.journalEntryTeachers)) {
          updateData.journalEntryTeachers = updateData.journalEntryTeachers.map(id => id.toString())
        }

        // Log the update data for debugging
        Logger.debug(`Sending update for assignment ${assignmentId}, student ${studentPersonalCode}, new grade: ${grade}`)

        // Log whether we're adding a new student or updating an existing one
        if (studentEntry.id) {
          Logger.info(`Updating grade for existing student ${studentPersonalCode} in assignment ${assignmentId}`)
        } else {
          Logger.info(`Adding new student ${studentPersonalCode} to assignment ${assignmentId} with grade ${grade}`)
        }

        // Log the student being sent in the update
        Logger.debug(`Sending update with student: ${studentEntry.studentName || 'Unknown'} (${studentEntry.journalStudent}) with grade ${grade}`)

        // Log the structure of the update data
        Logger.debug(`Update data structure: ${Object.keys(updateData).join(', ')}`)
        Logger.debug(`Student entry structure: ${Object.keys(updatedStudentEntry).join(', ')}`)

        // Log the number of students in the update (should be 1 now)
        Logger.info(
          `Sending update with ${updateData.journalEntryStudents.length} student (${existingStudentIndex !== -1 ? 'updating existing' : 'adding new'} student)`
        )

        // Enhanced logging: Log the specific student being updated
        Logger.info('=== STUDENT BEING UPDATED ===')
        for (const [_index, student] of updateData.journalEntryStudents.entries()) {
          const cachedStudentInfo = await this.getCachedStudent(student.journalStudent)
          const studentName = cachedStudentInfo ? cachedStudentInfo.name : 'Unknown'
          const personalCode = cachedStudentInfo ? cachedStudentInfo.personalCode : 'Unknown'
          const isActive = cachedStudentInfo ? cachedStudentInfo.isActive : 'Unknown'
          const isDeleted = cachedStudentInfo ? cachedStudentInfo.isDeleted : 'Unknown'
          const gradeCode = student.grade?.code || 'No grade'

          Logger.info(
            `Student: ${studentName} (${personalCode}) - Active: ${isActive}, Deleted: ${isDeleted}, Grade: ${gradeCode}, JournalStudentId: ${student.journalStudent}`
          )
        }
        Logger.info('=== END STUDENT BEING UPDATED ===')

        // Send the update request
        let response
        try {
          Logger.info(`Sending PUT request to /journals/${journalId}/journalEntry/${assignmentId}`)
          Logger.debug(`PUT request data: ${JSON.stringify(updateData)}`)

          // Log the request URL for debugging
          const requestUrl = `${this.api.tahvel.baseUrl}/journals/${journalId}/journalEntry/${assignmentId}`
          Logger.debug(`Full request URL: ${requestUrl}`)

          // Add a timestamp to track how long the request takes
          const startTime = Date.now()
          Logger.debug(`Starting PUT request at ${new Date().toISOString()}`)

          response = await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

          // Log the time it took to complete the request
          const endTime = Date.now()
          Logger.debug(`PUT request completed in ${endTime - startTime}ms`)

          // Log detailed response information
          Logger.debug(`Response type: ${typeof response}`)
          Logger.debug(`Response value: ${response}`)
          Logger.debug(`Response JSON: ${JSON.stringify(response)}`)
          Logger.debug(`Response is null: ${response === null}`)
          Logger.debug(`Response is undefined: ${response === undefined}`)
          Logger.debug(`Response is empty string: ${response === ''}`)
          Logger.debug(`Response is falsy: ${!response}`)
        } catch (error) {
          // Provide detailed error information
          let errorMessage = `Failed to update grade in Tahvel: ${error.message}`

          // Check for common error cases
          if (error.message.includes('403')) {
            errorMessage =
              'Permission denied. You may not have rights to modify this journal. This is expected if you are not the teacher of this journal.'

            // Log more details about the permission issue
            Logger.warning(
              `Permission denied when updating journal ${journalId}, assignment ${assignmentId}. This is expected if you are not the teacher of this journal.`
            )

            // Add more context to the error message
            const teacherInfo = entryData.teacherSelection ? entryData.teacherSelection.map(t => t.nameEt || t.fullname || t.id).join(', ') : 'Unknown'

            Logger.debug(`Journal teachers: ${teacherInfo}`)
            errorMessage += ` Journal teachers: ${teacherInfo}`

            // Check if XSRF token might be missing
            const cookies = document.cookie.split(';')
            let hasXsrfToken = false

            for (const cookie of cookies) {
              const [name] = cookie.trim().split('=')
              if (name === 'XSRF-TOKEN') {
                hasXsrfToken = true
                break
              }
            }

            if (!hasXsrfToken) {
              Logger.warning('XSRF-TOKEN cookie is missing. This might be causing the 403 error.')
              errorMessage += ' XSRF-TOKEN cookie is missing, which might be causing this error. Try refreshing the page.'
            }
          } else if (error.message.includes('404')) {
            errorMessage = 'Assignment not found. It may have been deleted or moved.'
          } else if (error.message.includes('400')) {
            errorMessage = `Bad request: ${error.message}. The data format may be incorrect.`
          } else if (error.message.includes('412')) {
            // Precondition Failed - often means the student is not actively studying
            Logger.warning(`Server returned 412 error when updating assignment ${assignmentId}`)

            // Check if the error message contains specific error codes
            if (
              error.message.includes('changeIsNotAllowedStudentIsNotStudying') ||
              error.message.includes('journal.messages.changeIsNotAllowedStudentIsNotStudying')
            ) {
              errorMessage = `Cannot update grade for student ${studentPersonalCode} because they are not actively studying. The student may be on academic leave or their status is inactive in Tahvel. This is a limitation of the Tahvel system - it doesn't allow adding or updating grades for students who aren't actively studying.`

              // Check the student's status in our cache
              const cachedStudent = await this.getCachedStudent(studentEntry.journalStudent)
              if (cachedStudent) {
                Logger.debug(`Student status in cache: ${cachedStudent.isActive ? 'Active' : 'Inactive'}`)
                if (!cachedStudent.isActive) {
                  errorMessage += ' Student status in our cache is marked as inactive.'
                }
              }

              // Enhanced debugging: Log all students in the update request to identify the problematic one
              Logger.debug('=== 412 ERROR DEBUGGING ===')
              Logger.debug(`Assignment ID: ${assignmentId}, Journal ID: ${journalId}`)
              Logger.debug(`Total students in update request: ${updateData.journalEntryStudents.length}`)

              // Log the student names that are actually being sent in the request payload
              Logger.debug('=== STUDENTS IN REQUEST PAYLOAD ===')
              updateData.journalEntryStudents.forEach((student, index) => {
                Logger.debug(
                  `Student ${index + 1} in payload: Name="${student.studentName || 'Not set'}", PersonalCode="${student.studentPersonalCode || 'Not set'}", JournalStudentId=${student.journalStudent}`
                )
              })
              Logger.debug('=== END STUDENTS IN REQUEST PAYLOAD ===')

              // Log each student's status from cache
              for (const [index, student] of updateData.journalEntryStudents.entries()) {
                const cachedStudentData = await this.getCachedStudent(student.journalStudent)
                if (cachedStudentData) {
                  const status = cachedStudentData.isActive ? 'ACTIVE' : 'INACTIVE'
                  const isDeleted = cachedStudentData.isDeleted ? 'DELETED' : 'NOT_DELETED'
                  Logger.debug(`Student ${index + 1}: ${cachedStudentData.name} (${cachedStudentData.personalCode}) - Status: ${status}, ${isDeleted}`)
                } else {
                  Logger.debug(`Student ${index + 1}: journalStudent=${student.journalStudent} - NO CACHE DATA`)
                }
              }

              // Check for inactive students (simplified check without iteration)
              Logger.debug('Checking for inactive students...')
              let hasInactiveStudents = false
              for (const student of updateData.journalEntryStudents) {
                const cachedStudentData = await this.getCachedStudent(student.journalStudent)
                if (cachedStudentData && (!cachedStudentData.isActive || cachedStudentData.isDeleted)) {
                  hasInactiveStudents = true
                  Logger.debug(`Found inactive student: ${cachedStudentData.name} (${cachedStudentData.personalCode})`)
                }
              }

              if (hasInactiveStudents) {
                Logger.debug(`Found inactive/deleted students in the update request`)
                errorMessage += ` Found inactive/deleted students that may be causing this error.`
              }

              Logger.debug('=== END 412 ERROR DEBUGGING ===')
            } else {
              errorMessage = `Precondition failed: ${error.message}. The server rejected the request.`
            }
          } else if (error.message.includes('500')) {
            // Server error - likely due to invalid data structure
            Logger.error(`Server returned 500 error when updating assignment ${assignmentId}`)

            // Log the data we sent for debugging
            Logger.debug(`Update data that caused 500 error: ${JSON.stringify(updateData)}`)

            // Check for common issues
            if (!studentEntry.id && !updateData.version) {
              errorMessage = 'Server error when adding new student. The server might require a version number for the update.'
              Logger.warning('Missing version number might be causing the 500 error')
            } else if (!studentEntry.id) {
              errorMessage = 'Server error when adding new student. The server might not allow adding students through this API.'
              Logger.warning('Adding new student might not be supported by the API')
            } else {
              errorMessage = 'Tahvel server error. Please try again later.'
            }

            // Suggest a workaround
            errorMessage += ' Try adding the student to the assignment manually in Tahvel first, then sync the grade.'
          }

          throw new Error(errorMessage)
        }

        // Handle successful responses, including empty responses
        // Some PUT operations return empty body with 200 status, which is valid
        if (response === null || response === undefined) {
          throw new Error('No response from Tahvel API after update')
        }

        // Log the response type and content for debugging
        Logger.debug(`Response type: ${typeof response}, Content: ${JSON.stringify(response)}`) // === DETAILED DEBUG INFORMATION (shown at end to avoid scrolling) ===
        Logger.debug('=== DETAILED DEBUG INFORMATION ===')
        Logger.debug(`Assignment ${assignmentId} has ${entryData.journalEntryStudents.length} students`)
        Logger.debug('Cache summary skipped - using API cache service')
        Logger.debug('=== END DETAILED DEBUG INFORMATION ===')

        // Return the response, even if it's an empty string (which indicates success)
        return response
      }
    } catch (error) {
      // Add context to the error message
      const contextualError = new Error(`Error syncing grade for student ${studentPersonalCode} in assignment ${assignmentId}: ${error.message}`)

      // Log the error with full details
      Logger.error('Grade sync error:', contextualError)

      // Rethrow with the enhanced message
      throw contextualError
    }
  }

  /**
   * Get student from cache using multiple lookup strategies
   * @param {string|number} journalStudentId - Journal student ID to look up
   * @returns {Promise<Object|null>} Cached student data or null if not found
   */
  async getCachedStudent(journalStudentId) {
    if (!journalStudentId) return null

    Logger.debug(`🔍 Looking for student in cache with journalStudentId: ${journalStudentId}`)

    // Use the mapping to find the actual studentId
    const studentId = this.journalStudentIdToStudentId[journalStudentId]
    if (studentId) {
      Logger.debug(`✓ Found mapping: journalStudentId ${journalStudentId} -> studentId ${studentId}`)

      try {
        // Use the API cache to get student details
        const studentDetails = await this.getStudentDetails(studentId)
        if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
          const isActive = studentDetails.status === 'OPPURSTAATUS_O'
          const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'

          const cachedStudent = {
            personalCode: studentDetails.person.idcode,
            name: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
            isActive: isActive,
            isDeleted: isDeleted
          }

          Logger.debug(`✓ Found student from API cache: ${cachedStudent.personalCode} (${cachedStudent.name})`)
          return cachedStudent
        }
      } catch (error) {
        Logger.debug(`Error getting student ${studentId} from API cache: ${error.message}`)
      }
    }

    Logger.debug(`❌ Student not found in cache for journalStudentId: ${journalStudentId}`)
    return null
  }

  /**
   * Get all students from cache by iterating through possible keys
   * @returns {Promise<Object>} Object with studentId as key and student data as value
   */
  async getAllStudentsFromCache() {
    // Since we use the API cache directly, we can return the mapping
    return this.journalStudentIdToStudentId
  }

  /**
   * Clear all student cache entries
   * @returns {Promise<number>} Number of entries cleared
   */
  async clearStudentCache() {
    // Clear the mapping
    const count = Object.keys(this.journalStudentIdToStudentId).length
    this.journalStudentIdToStudentId = {}
    Logger.debug(`Cleared ${count} student mappings`)
    return count
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
      async () => {
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
  const fetchPromise = (async () => {
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

// Patch showDifferencesBanner to activate due date diff feature after banner is rendered
const origShowDifferencesBanner = JournalListSyncFeature.prototype.showDifferencesBanner
JournalListSyncFeature.prototype.showDifferencesBanner = function (...args) {
  const result = origShowDifferencesBanner.apply(this, args)
  // Activate due date diff feature after banner is rendered
  setTimeout(() => {
    assignmentDueDateDiff.renderDueDateDifferences()
  }, 0)
  return result
}

export const journalListSync = new JournalListSyncFeature()
