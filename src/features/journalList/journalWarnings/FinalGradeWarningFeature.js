/**
 * Final Grade Warning Feature - Shows warning icons for journals with missing final grades
 *
 * Requirements:
 * - Shows yellow or red star icon when the journal has missing final grades
 * - Only shows warning if journal contains an ÕV or Lõpphinne (final grade) column
 * - Yellow icon if current date is 7 to 2 days before the final lesson date
 * - Red icon if current date is 1 day before or later than the final lesson date
 * - Respects the selected study year from dropdown
 * - Auto-updates when study year changes
 * - Shares logic with HighlightFinalGradesFeature
 */

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'

export default class FinalGradeWarningFeature extends BaseFeature {
  constructor() {
    // Match journal list pages
    super('finalGradeWarning', /#\/journals/, [
      '#tahvelTable table.tahvel-table tbody tr td:nth-child(2) a.linked-name'
    ])
    this.name = 'FinalGradeWarningFeature'
    this.processedJournals = new Set()
    this.studyYearObserver = null
    this.mainContentObserver = null
    this.currentStudyYear = null
    this.currentSchoolId = null
  }

  /**
   * Activate the feature on journal list pages
   */
  async activate() {
    Logger.info(`✨ [${this.name}] Activating final grade warning feature`)

    // Get current user info for school ID
    await this.getCurrentUserInfo()

    // Get current study year
    this.getCurrentStudyYear()

    // Set up study year observer
    this.setupStudyYearObserver()

    // Set up main content observer for DOM changes
    this.setupMainContentObserver()

    // Wait for the page to be ready, then process journals
    setTimeout(() => {
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in delayed processJournalList:`, error)
      })
    }, 1000)
  }

  /**
   * Deactivate the feature
   */
  onDeactivate() {
    super.onDeactivate()

    // Clean up study year observer
    if (this.studyYearObserver) {
      this.studyYearObserver.disconnect()
      this.studyYearObserver = null
    }

    // Clean up the main content observer
    if (this.mainContentObserver) {
      this.mainContentObserver.disconnect()
      this.mainContentObserver = null
    }

    // Remove all warning indicators
    this.removeAllWarningIndicators()

    // Reset state
    this.processedJournals.clear()
    this.currentStudyYear = null
    this.currentSchoolId = null
    this.studyYearObserver = null
    this.mainContentObserver = null
  }

  /**
   * Get current user info from the API
   */
  async getCurrentUserInfo() {
    try {
      const userInfo = await this.api.tahvel.get('/user', {}, { cache: true })
      this.currentSchoolId = userInfo.school?.id || 9
    } catch (error) {
      Logger.error(`[${this.name}] Error getting user info:`, error)
      this.currentSchoolId = 9 // Default school ID
    }
  }

  /**
   * Get current study year from dropdown
   */
  getCurrentStudyYear() {
    try {
      const studyYearElement = document.querySelector('[ng-model="criteria.studyYear"] div.md-text span')
      if (studyYearElement) {
        this.currentStudyYear = studyYearElement.textContent.trim()
      } else {
        Logger.warning(`[${this.name}] Study year dropdown not found, using current year`)
        this.currentStudyYear = this.getDefaultStudyYear()
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error getting study year:`, error)
      this.currentStudyYear = this.getDefaultStudyYear()
    }

    return this.currentStudyYear
  }

  /**
   * Get default study year based on current date
   */
  getDefaultStudyYear() {
    const now = new Date()
    const currentYear = now.getFullYear()
    const isBeforeAugust = now.getMonth() < 7 // August is month 7

    if (isBeforeAugust) {
      return `${currentYear - 1}/${currentYear}`
    } else {
      return `${currentYear}/${currentYear + 1}`
    }
  }

  /**
   * Parse study year string to get date range
   */
  parseStudyYear(studyYearStr) {
    try {
      // Parse "2024/2025" format
      const match = studyYearStr.match(/(\d{4})\/(\d{4})/)
      if (match) {
        const startYear = parseInt(match[1])
        const endYear = parseInt(match[2])

        return {
          from: new Date(Date.UTC(startYear, 8, 1)).toISOString(), // September 1st
          thru: new Date(Date.UTC(endYear, 7, 31, 23, 59, 59, 999)).toISOString() // August 31st
        }
      } else {
        Logger.warning(`[${this.name}] Could not parse study year format: ${studyYearStr}`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error parsing study year:`, error)
    }

    // Fallback to current study year
    const now = new Date()
    const currentYear = now.getFullYear()
    const studyYear = now.getMonth() < 7 ? currentYear - 1 : currentYear

    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    }
  }

  /**
   * Set up observer for study year changes
   */
  setupStudyYearObserver() {
    const trySetup = () => {
      const studyYearElement = document.querySelector('[ng-model="criteria.studyYear"]')
      if (!studyYearElement) {
        // Retry after a short delay
        setTimeout(trySetup, 500)
        return
      }

      // Update current study year now that we found the dropdown
      this.getCurrentStudyYear()

      this.studyYearObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            const newStudyYear = this.getCurrentStudyYear()
            if (newStudyYear !== this.currentStudyYear) {
              Logger.info(`✨ [${this.name}] Study year changed from ${this.currentStudyYear} to ${newStudyYear}`)
              this.currentStudyYear = newStudyYear
              this.onStudyYearChange()
            }
          }
        }
      })

      this.studyYearObserver.observe(studyYearElement, {
        childList: true,
        subtree: true,
        characterData: true
      })

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Study year observer set up successfully`)
    }

    trySetup()
  }

  /**
   * Set up observer for main content changes (journal list updates)
   */
  setupMainContentObserver() {
    const mainContentElement = document.querySelector('#tahvelTable')
    if (!mainContentElement) {
      Logger.warning(`[${this.name}] Main content element not found for observer`)
      return
    }

    let debounceTimer = null

    this.mainContentObserver = new MutationObserver(mutations => {
      // Check if any mutations affect the journal table
      const hasRelevantChanges = mutations.some(mutation => {
        // Check if table-related elements were added/removed
        if (mutation.type === 'childList') {
          const relevantNodes = [...mutation.addedNodes, ...mutation.removedNodes]
          return relevantNodes.some(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false
            // Check if it's table-related or contains table elements
            return (
              node.matches &&
              (node.matches('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper') || (node.querySelector && node.querySelector('table, tbody, tr, .tahvel-table, .tahvel-table-wrapper')))
            )
          })
        }
        return false
      })

      if (hasRelevantChanges) {
        // Debounce to avoid too frequent processing
        if (debounceTimer) {
          clearTimeout(debounceTimer)
        }

        debounceTimer = setTimeout(() => {
          this.onMainContentChange()
        }, 300) // 300ms debounce
      }
    })

    this.mainContentObserver.observe(mainContentElement, {
      childList: true,
      subtree: true
    })
  }

  /**
   * Handle the main content change (journal list updated)
   */
  onMainContentChange() {
    Logger.info(`✨ [${this.name}] Processing main content change`)
    // Clear the processed journals cache
    this.processedJournals.clear()

    // Remove existing warning indicators
    this.removeAllWarningIndicators()

    // Update current study year in case it changed
    this.getCurrentStudyYear()

    // Reprocess all journals
    setTimeout(() => {
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in onMainContentChange processJournalList:`, error)
      })
    }, 100)
  }

  /**
   * Handle study year change
   */
  onStudyYearChange() {
    Logger.info(`✨ [${this.name}] Processing study year change`)
    // Clear the processed journals cache
    this.processedJournals.clear()

    // Remove existing warning indicators
    this.removeAllWarningIndicators()

    // Reprocess all journals with new study year
    setTimeout(() => {
      this.processJournalList().catch(error => {
        Logger.error(`[${this.name}] Error in onStudyYearChange processJournalList:`, error)
      })
    }, 500)
  }

  /**
   * Process all journals on the current page
   */
  async processJournalList() {
    try {
      // Find all journal rows
      const journalRows = this.findJournalRows()
      Logger.info(`✨ [${this.name}] Found ${journalRows.length} journal rows`)

      if (journalRows.length === 0) {
        Logger.warning(`[${this.name}] No journal rows found`)
        return
      }

      // Process each journal row
      for (const row of journalRows) {
        await this.processJournalRow(row)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal list:`, error)
    }
  }

  /**
   * Find all journal rows in the table
   */
  findJournalRows() {
    const rows = document.querySelectorAll('#tahvelTable table.tahvel-table tbody tr')

    if (rows.length === 0) {
      Logger.warning(`[${this.name}] No journal rows found`)
      return []
    }

    return Array.from(rows)
  }

  /**
   * Process a single journal row
   */
  async processJournalRow(row) {
    try {
      // Extract journal info from row
      const journalInfo = this.extractJournalInfoFromRow(row)
      if (!journalInfo) {
        return
      }

      // Skip if already processed
      if (this.processedJournals.has(journalInfo.id)) {
        return
      }

      // Check if journal has missing final grades
      const warningInfo = await this.checkMissingFinalGrades(journalInfo.id)

      // Add warning indicator if there are missing final grades
      if (warningInfo && warningInfo.hasMissing) {
        this.addWarningIndicator(journalInfo.linkElement, warningInfo)
      }

      // Mark as processed
      this.processedJournals.add(journalInfo.id)
    } catch (error) {
      Logger.error(`[${this.name}] Error processing journal row:`, error)
    }
  }

  /**
   * Extract journal information from table row
   */
  extractJournalInfoFromRow(row) {
    try {
      // Get journal link (2nd column)
      const linkElement = row.querySelector('td:nth-child(2) a.linked-name')
      if (!linkElement) {
        return null
      }

      // Extract journal ID from link
      const href = linkElement.getAttribute('href') || linkElement.getAttribute('ng-href') || ''
      const match = href.match(/\/journal\/(\d+)/)
      if (!match) {
        return null
      }

      const journalId = parseInt(match[1])

      return {
        id: journalId,
        linkElement: linkElement
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error extracting journal info from row:`, error)
      return null
    }
  }

  /**
   * Check if journal has missing final grades
   * Returns object with hasMissing, color ('yellow' or 'red')
   */
  async checkMissingFinalGrades(journalId) {
    try {
      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Checking journal ${journalId} for missing final grades`)

      // Construct base URL - detect which Tahvel environment we're on
      const currentHost = window.location.hostname
      let baseUrl = 'https://tahvel.edu.ee/hois_back'

      if (currentHost.includes('test.tahvel')) {
        baseUrl = 'https://test.tahvel.eenet.ee/hois_back'
      } else if (currentHost.includes('uustahvel')) {
        baseUrl = 'https://uustahvel.eenet.ee/hois_back'
      }

      // Get journal details
      const journalEndpoint = `/journals/${journalId}`
      const journalFullUrl = `${baseUrl}${journalEndpoint}`
      const journalCacheKey = `GET_${journalFullUrl}`

      // Try to read from cache first
      let journalData = await cacheService.get(journalCacheKey)

      // If not in cache, fetch from API with caching enabled
      if (!journalData) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Not in cache, fetching from API`)
        journalData = await this.api.tahvel.get(journalEndpoint, {}, { cache: true, cacheExpiration: cacheService.EXPIRATION.MEDIUM })
      }

      if (!journalData) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: No journal data`)
        return null
      }

      // Check if this journal has final grade columns (ÕV or Lõpphinne)
      const hasFinalGradeColumn = this.hasFinalGradeStructure(journalData)

      if (!hasFinalGradeColumn) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: No final grade column found`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Has final grade column`)

      // Check if lessons are complete by comparing planned vs timetable lesson count
      const lessonsComplete = await this.areLessonsComplete(journalId, journalData)

      if (!lessonsComplete) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Lessons not yet complete, skipping warning`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Lessons are complete`)

      // Get journal entries to check for missing final grades
      const entriesEndpoint = `/journals/${journalId}/journalEntriesByDate`
      const entriesFullUrl = `${baseUrl}${entriesEndpoint}`
      const entriesCacheKey = `GET_${entriesFullUrl}?allStudents=true`

      let journalEntries = await cacheService.get(entriesCacheKey)

      if (!journalEntries) {
        journalEntries = await this.api.tahvel.get(entriesEndpoint, { allStudents: true }, { cache: true, cacheExpiration: cacheService.EXPIRATION.SHORT })
      }

      if (!journalEntries || !Array.isArray(journalEntries) || journalEntries.length === 0) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: No journal entries found`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Found ${journalEntries.length} journal entries`)

      // Check if any student has empty final grade
      const hasMissingGrades = this.hasAnyMissingFinalGrades(journalEntries)

      if (!hasMissingGrades) {
        if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: No missing grades found`)
        return null
      }

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Has missing final grades!`)

      // Get final lesson date to determine warning color
      const finalLessonDate = await this.getFinalLessonDate(journalId, journalData)

      // Determine warning color based on date
      const color = finalLessonDate ? this.getWarningColor(finalLessonDate) : 'red'

      if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Journal ${journalId}: Returning warning with color ${color}`)

      return {
        hasMissing: true,
        color: color,
        finalLessonDate: finalLessonDate
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error checking missing final grades:`, error)
      return null
    }
  }

  /**
   * Check if lessons are complete (past timetable lessons >= planned lesson count)
   */
  async areLessonsComplete(journalId, journalData) {
    try {
      // Get planned lesson count from journal data
      const plannedLessonCount = this.getPlannedLessonCount(journalData)
      if (plannedLessonCount === null) {
        Logger.debug(`[${this.name}] Journal ${journalId}: Could not get planned lesson count`)
        return false
      }

      // Get teacher IDs from journal data
      const teacherIds = journalData.journalTeachers?.map(t => t.id) || []
      if (teacherIds.length === 0) {
        Logger.debug(`[${this.name}] Journal ${journalId}: No teacher IDs found`)
        return false
      }

      // Get timetable lessons for this journal
      const timetableLessons = await this.getTimetableLessons(journalId, teacherIds)

      // Count past timetable lessons
      const pastTimetableLessons = this.countPastLessons(timetableLessons)

      Logger.debug(`[${this.name}] Journal ${journalId}: Planned lessons: ${plannedLessonCount}, Past timetable lessons: ${pastTimetableLessons}`)

      // Lessons are complete if past timetable >= planned
      return pastTimetableLessons >= plannedLessonCount
    } catch (error) {
      Logger.error(`[${this.name}] Error checking if lessons complete:`, error)
      return false
    }
  }

  /**
   * Get planned lesson count (only MAHT_a capacity hours)
   */
  getPlannedLessonCount(journalData) {
    if (!journalData || !journalData.lessonHours || !journalData.lessonHours.capacityHours) {
      return null
    }

    // Get only MAHT_a (auditorium/class lessons), exclude MAHT_i (independent work)
    const mahtA = journalData.lessonHours.capacityHours.find(h => h.capacity === 'MAHT_a')

    if (!mahtA) {
      // If no MAHT_a found, use totalPlannedHours as fallback
      Logger.debug(`[${this.name}] No MAHT_a found, using totalPlannedHours`)
      return journalData.lessonHours.totalPlannedHours || 0
    }

    return mahtA.plannedHours || 0
  }

  /**
   * Count past lessons from timetable events
   */
  countPastLessons(timetableEvents) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const pastEvents = timetableEvents.filter(event => {
      if (!event.date) return false

      const eventDate = new Date(event.date)
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())

      return eventDay < today
    })

    return pastEvents.length
  }

  /**
   * Get timetable lessons for a journal
   */
  async getTimetableLessons(journalId, teacherIds) {
    try {
      if (!this.currentSchoolId) {
        Logger.warning(`[${this.name}] Missing school ID`)
        return []
      }

      if (!teacherIds || teacherIds.length === 0) {
        Logger.warning(`[${this.name}] No teacher IDs provided for journal ${journalId}`)
        return []
      }

      // Get study year date range
      const { from, thru } = this.parseStudyYear(this.currentStudyYear)

      // Build teacher IDs parameter
      const teacherIdsParam = teacherIds.join(',')

      // Build timetable API endpoint
      const endpoint = `/timetableevents/timetableByTeacher/${this.currentSchoolId}?from=${from}&lang=ET&teachers=${teacherIdsParam}&thru=${thru}`

      // Fetch timetable data
      const data = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: cacheService.EXPIRATION.VERY_LONG })

      if (!data || !data.timetableEvents || !Array.isArray(data.timetableEvents)) {
        return []
      }

      // Filter events for this journal
      return data.timetableEvents.filter(event => event.journalId === journalId)
    } catch (error) {
      Logger.error(`[${this.name}] Error fetching timetable lessons:`, error)
      return []
    }
  }

  /**
   * Check if journal data structure indicates a final grade column exists
   */
  hasFinalGradeStructure(journalData) {
    // Check includesOutcomes flag (ÕV columns)
    if (journalData.includesOutcomes === true) {
      return true
    }

    // Check assessment field (KUTSEHINDAMISVIIS_E is exam/final grading)
    if (journalData.assessment && (journalData.assessment === 'KUTSEHINDAMISVIIS_E' || journalData.assessment === 'HINDAMISVIIS_E')) {
      return true
    }

    // Check if isDistinctiveAssessment (final grades required)
    if (journalData.isDistinctiveAssessment === true) {
      return true
    }

    return false
  }

  /**
   * Check if any student in journal entries has missing final grades
   */
  hasAnyMissingFinalGrades(journalEntries) {
    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Checking ${journalEntries.length} journal entries for missing grades`)

    // Journal entries structure can vary, need to find students
    for (const entry of journalEntries) {
      // Try both possible field names
      const students = entry.journalStudentResults || entry.journalEntryStudents

      if (!students || !Array.isArray(students)) {
        continue
      }

      for (const studentResult of students) {
        // Skip students on academic leave (status = 'OPPURSTAATUS_A')
        if (studentResult.status === 'OPPURSTAATUS_A') {
          continue
        }

        // Check various fields that might contain final grade
        const hasGrade = studentResult.grade || studentResult.verbalGrade || studentResult.gradeValue || studentResult.gradeCode || studentResult.gradeInserted

        if (!hasGrade) {
          // Found at least one student without final grade
          if (Logger.isDebugMode()) Logger.debug(`[${this.name}] Found student without final grade in entry ${entry.id}`)
          return true
        }
      }
    }

    if (Logger.isDebugMode()) Logger.debug(`[${this.name}] No missing grades found`)
    return false
  }

  /**
   * Get final lesson date for a journal (shared logic with HighlightFinalGradesFeature)
   */
  async getFinalLessonDate(journalId, journalData) {
    try {
      // Try to extract schoolId and teacherId
      let schoolId = this.currentSchoolId || 9
      if (journalData.curriculumVersions && journalData.curriculumVersions.length > 0) {
        schoolId = journalData.curriculumVersions[0].curriculumId || schoolId
      }
      const teacherId = journalData.journalTeachers?.[0]?.id

      const { from, thru } = this.parseStudyYear(this.currentStudyYear)

      let timetable = []
      if (schoolId && teacherId) {
        const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
        try {
          const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: cacheService.EXPIRATION.VERY_LONG })
          timetable = timetableData?.timetableEvents?.filter(event => event.journalId == journalId) || []
        } catch (e) {
          if (Logger.isDebugMode()) Logger.info(`[${this.name}] Timetable fetch failed, falling back to journal entries`, e)
        }
      }

      if (timetable.length > 0) {
        const sorted = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
        return sorted[sorted.length - 1].date
      }

      // Fallback: use latest journal entry date
      const journalEntries = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        { cache: true, cacheExpiration: cacheService.EXPIRATION.SHORT }
      )
      if (Array.isArray(journalEntries) && journalEntries.length > 0) {
        const validEntries = journalEntries.filter(e => e.entryDate)
        if (validEntries.length > 0) {
          const sorted = validEntries.slice().sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
          return sorted[sorted.length - 1].entryDate
        }
      }

      return null
    } catch (error) {
      Logger.error(`[${this.name}] Error getting final lesson date:`, error)
      return null
    }
  }

  /**
   * Get warning color based on final lesson date (shared logic with HighlightFinalGradesFeature)
   */
  getWarningColor(finalLessonDate) {
    const finalDate = new Date(finalLessonDate)
    finalDate.setHours(0, 0, 0, 0)

    // Get comparison date (check for window.__oa2ComparisonDate for testing)
    let now
    if (window.__oa2ComparisonDate) {
      now = new Date(window.__oa2ComparisonDate)
    } else {
      now = new Date()
    }
    now.setHours(0, 0, 0, 0)

    // Warning window: 7 to 2 days before final lesson date
    const warningStart = new Date(finalDate)
    warningStart.setDate(finalDate.getDate() - 7)
    const warningEnd = new Date(finalDate)
    warningEnd.setDate(finalDate.getDate() - 2)

    // Yellow if within warning window (7-2 days before)
    // Red if past warning window (1 day before or later)
    if (now >= warningStart && now <= warningEnd) {
      return 'yellow'
    } else {
      return 'red'
    }
  }

  /**
   * Add warning indicator to journal link
   */
  addWarningIndicator(linkElement, warningInfo) {
    try {
      // Check if indicator already exists
      const existingIndicator = linkElement.parentElement.querySelector('.oa-final-grade-warning-indicator')
      if (existingIndicator) {
        return
      }

      // Create warning indicator - yellow or red pill with star icon
      const indicator = document.createElement('span')
      indicator.className = 'oa-final-grade-warning-indicator'

      const backgroundColor = warningInfo.color === 'yellow' ? '#fff3cd' : '#ff6b6b'
      const borderColor = warningInfo.color === 'yellow' ? '#ffc107' : '#ff0000'

      indicator.style.cssText = `
        display: inline;
        background-color: ${backgroundColor};
        color: #000;
        border: 1px solid ${borderColor};
        border-radius: 15px;
        padding: 2px 6px;
        margin-left: 6px;
        font-size: 12px;
        font-weight: normal;
        cursor: help;
        vertical-align: middle;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        white-space: nowrap;
      `
      indicator.textContent = '⭐'
      indicator.title = 'Päevikus on puuduolevad lõpphinded'

      // Create wrapper to keep link and indicator on same line
      const wrapper = document.createElement('span')
      wrapper.style.cssText = `
        display: inline;
        white-space: nowrap;
      `

      // Move link into wrapper
      const parentCell = linkElement.parentElement
      parentCell.insertBefore(wrapper, linkElement)
      wrapper.appendChild(linkElement)

      // Add indicator to wrapper
      wrapper.appendChild(indicator)

      Logger.info(`✨ [${this.name}] Successfully added warning indicator (${warningInfo.color}) for journal ${warningInfo.journalId || 'unknown'}`)
    } catch (error) {
      Logger.error(`[${this.name}] Error adding warning indicator:`, error)
    }
  }

  /**
   * Remove all warning indicators
   */
  removeAllWarningIndicators() {
    try {
      const indicators = document.querySelectorAll('.oa-final-grade-warning-indicator')
      indicators.forEach(indicator => {
        // Remove the whole wrapper if it exists
        const wrapper = indicator.parentElement
        if (wrapper && wrapper.children.length === 2) {
          // If the wrapper has exactly 2 children (link + indicator), move the link back to the parent
          const link = wrapper.querySelector('a')
          if (link) {
            const parentCell = wrapper.parentElement
            parentCell.insertBefore(link, wrapper)
          }
          wrapper.remove()
        } else {
          // Remove the indicator
          indicator.remove()
        }
      })
    } catch (error) {
      Logger.error(`[${this.name}] Error removing warning indicators:`, error)
    }
  }
}
