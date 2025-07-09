/**
 * Warning Triangles Feature - Shows pink calendar icons for journals with missing lessons
 *
 * Requirements:
 * - Shows pink pill with calendar icon when journal has discrepancies between DOM lesson count and timetable
 * - Reads lesson count from DOM (not API)
 * - Respects selected study year from dropdown
 * - Auto-updates when study year changes
 * - Only counts past timetable lessons
 */

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'

export default class WarningTrianglesFeature extends BaseFeature {
  constructor() {
    // Match journal list pages
    super('warningTriangles', /#\/journals/, [
      '#main-content md-table-container td:nth-child(2) > a',
      '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a'
    ])
    this.name = 'WarningTrianglesFeature'
    this.processedJournals = new Set()
    this.studyYearObserver = null
    this.currentStudyYear = null
    this.currentTeacherId = null
    this.currentSchoolId = null
  }

  /**
   * Activate the feature on journal list pages
   */
  async activate() {
    Logger.info(`✨ [${this.name}] Activating warning triangles feature`)

    // Get current user info for teacher ID and school ID
    await this.getCurrentUserInfo()

    // Get current study year
    this.getCurrentStudyYear()

    // Set up study year observer
    this.setupStudyYearObserver()

    // Wait for page to be ready, then process journals
    setTimeout(() => {
      this.processJournalList()
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

    // Remove all warning indicators
    this.removeAllWarningIndicators()

    // Reset state
    this.processedJournals.clear()
    this.currentStudyYear = null
    this.currentTeacherId = null
    this.currentSchoolId = null
  }

  /**
   * Get current user info from API
   */
  async getCurrentUserInfo() {
    try {
      const userInfo = await this.api.tahvel.get('/user', {}, { cache: true })
      this.currentSchoolId = userInfo.school?.id || 9
      this.currentTeacherId = userInfo.person?.id

      Logger.debug(`✨ [${this.name}] Current user - School ID: ${this.currentSchoolId}, Teacher ID: ${this.currentTeacherId}`)
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
        Logger.debug(`✨ [${this.name}] Current study year: ${this.currentStudyYear}`)
      } else {
        Logger.warning(`[${this.name}] Study year dropdown not found, using current year`)
        this.currentStudyYear = this.getDefaultStudyYear()
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error getting study year:`, error)
      this.currentStudyYear = this.getDefaultStudyYear()
    }
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
    const studyYearElement = document.querySelector('[ng-model="criteria.studyYear"]')
    if (!studyYearElement) {
      Logger.warning(`[${this.name}] Study year dropdown not found for observer`)
      return
    }

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
  }

  /**
   * Handle study year change
   */
  onStudyYearChange() {
    Logger.info(`✨ [${this.name}] Processing study year change`)

    // Clear processed journals cache
    this.processedJournals.clear()

    // Remove existing warning indicators
    this.removeAllWarningIndicators()

    // Reprocess all journals with new study year
    setTimeout(() => {
      this.processJournalList()
    }, 500)
  }

  /**
   * Process all journals on the current page
   */
  async processJournalList() {
    try {
      Logger.debug(`✨ [${this.name}] Starting to process journal list`)

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
    const selectors = [
      '#main-content md-table-container table tbody tr',
      '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr'
    ]

    for (const selector of selectors) {
      const rows = document.querySelectorAll(selector)
      if (rows.length > 0) {
        Logger.debug(`✨ [${this.name}] Using selector: ${selector} (found ${rows.length} rows)`)
        return Array.from(rows)
      }
    }

    Logger.warning(`[${this.name}] No journal rows found with any selector`)
    return []
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

      Logger.debug(`✨ [${this.name}] Processing journal ${journalInfo.id}`)

      // Get timetable data for this journal
      const timetableLessons = await this.getTimetableLessons(journalInfo.id)

      // Count past timetable lessons
      const pastTimetableLessons = this.countPastLessons(timetableLessons)

      // Compare with DOM lesson count
      const hasDiscrepancy = pastTimetableLessons !== journalInfo.lessonCount

      Logger.debug(`✨ [${this.name}] Journal ${journalInfo.id}: DOM count = ${journalInfo.lessonCount}, Timetable count = ${pastTimetableLessons}`)

      // Add warning indicator if there's a discrepancy
      if (hasDiscrepancy) {
        this.addWarningIndicator(journalInfo.linkElement, {
          journalId: journalInfo.id,
          domCount: journalInfo.lessonCount,
          timetableCount: pastTimetableLessons
        })
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
      const linkElement = row.querySelector('td:nth-child(2) > a')
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

      // Get lesson count from 6th column
      const lessonCountCell = row.querySelector('td:nth-child(6)')
      let lessonCount = 0

      if (lessonCountCell) {
        const text = lessonCountCell.textContent.trim()
        const countMatch = text.match(/\d+/)
        if (countMatch) {
          lessonCount = parseInt(countMatch[0])
        }
      }

      return {
        id: journalId,
        linkElement: linkElement,
        lessonCount: lessonCount
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error extracting journal info from row:`, error)
      return null
    }
  }

  /**
   * Get timetable lessons for a journal
   */
  async getTimetableLessons(journalId) {
    try {
      if (!this.currentTeacherId || !this.currentSchoolId) {
        Logger.warning(`[${this.name}] Missing teacher ID or school ID`)
        return []
      }

      // Get study year date range
      const { from, thru } = this.parseStudyYear(this.currentStudyYear)

      // Build timetable API endpoint
      const endpoint = `/timetableevents/timetableByTeacher/${this.currentSchoolId}?from=${from}&lang=ET&teachers=${this.currentTeacherId}&thru=${thru}`

      Logger.debug(`✨ [${this.name}] Fetching timetable from: ${endpoint}`)

      // Fetch timetable data
      const data = await this.api.tahvel.get(endpoint, {}, { cache: true })

      if (!data || !data.timetableEvents || !Array.isArray(data.timetableEvents)) {
        Logger.debug(`✨ [${this.name}] No timetable events found`)
        return []
      }

      // Filter events for this journal
      const journalEvents = data.timetableEvents.filter(event => event.journalId === journalId)

      Logger.debug(`✨ [${this.name}] Found ${journalEvents.length} timetable events for journal ${journalId}`)
      return journalEvents
    } catch (error) {
      Logger.error(`[${this.name}] Error fetching timetable lessons:`, error)
      return []
    }
  }

  /**
   * Count past lessons from timetable events
   */
  countPastLessons(timetableEvents) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    return timetableEvents.filter(event => {
      if (!event.date) return false

      const eventDate = new Date(event.date)
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())

      return eventDay < today
    }).length
  }

  /**
   * Add warning indicator to journal link
   */
  addWarningIndicator(linkElement, discrepancy) {
    try {
      // Check if indicator already exists
      const existingIndicator = linkElement.parentElement.querySelector('.oa-warning-indicator')
      if (existingIndicator) {
        return
      }

      // Create warning indicator - pink pill with calendar icon
      const indicator = document.createElement('span')
      indicator.className = 'oa-warning-indicator'
      indicator.style.cssText = `
        display: inline;
        background-color: #ff69b4;
        color: white;
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
      indicator.textContent = '📅'
      indicator.title = `Päevikus on ${discrepancy.domCount} tunni sissekanne, aga tunniplaani järgi peaks olema ${discrepancy.timetableCount} toimunud tundi`

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

      Logger.debug(`✨ [${this.name}] Added warning indicator for journal ${discrepancy.journalId}`)
    } catch (error) {
      Logger.error(`[${this.name}] Error adding warning indicator:`, error)
    }
  }

  /**
   * Remove all warning indicators
   */
  removeAllWarningIndicators() {
    try {
      const indicators = document.querySelectorAll('.oa-warning-indicator')
      indicators.forEach(indicator => {
        // Remove the whole wrapper if it exists
        const wrapper = indicator.parentElement
        if (wrapper && wrapper.children.length === 2) {
          // If wrapper has exactly 2 children (link + indicator), move link back to parent
          const link = wrapper.querySelector('a')
          if (link) {
            const parentCell = wrapper.parentElement
            parentCell.insertBefore(link, wrapper)
          }
          wrapper.remove()
        } else {
          // Just remove the indicator
          indicator.remove()
        }
      })
      Logger.debug(`✨ [${this.name}] Removed ${indicators.length} warning indicators`)
    } catch (error) {
      Logger.error(`[${this.name}] Error removing warning indicators:`, error)
    }
  }
}
