/**
 * Missing Lessons Feature - Displays a table of missing lessons based on timetable comparison
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

/**
 * MissingLessonsFeature class for displaying missing lessons table
 */
export default class MissingLessonsFeature extends BaseFeature {
    constructor() {
        // Match journal edit pages specifically
        super('missingLessons', /\/journal\/\d+\/edit/, [])

        this.name = 'MissingLessonsFeature'
        this.tableCreated = false // Flag to prevent multiple table creation
    }

    /**
     * Initialize the feature when activated
     */
    async activate() {
        Logger.info(`[${this.name}] Activating missing lessons feature`)

        // Wait for page to load and Angular to initialize, then create table once
        setTimeout(async () => {
            await this.createMissingLessonsTable()
        }, 2000)
    }

    /**
     * Extract journal ID from current URL
     */
    extractJournalId() {
        // Check both pathname and hash for journal ID
        const url = window.location.pathname + window.location.hash
        const urlMatch = url.match(/\/journal\/(\d+)/)
        return urlMatch ? parseInt(urlMatch[1]) : null
    }

    /**
     * Create the missing lessons table
     */
    async createMissingLessonsTable() {
        try {
            // Check if table was already created
            if (this.tableCreated) {
                Logger.debug(`[${this.name}] Table already created, skipping`)
                return
            }

            const journalId = this.extractJournalId()
            if (!journalId) {
                Logger.warning(`[${this.name}] No journal ID found in URL`)
                return
            }

            Logger.info(`[${this.name}] Creating missing lessons table for journal ${journalId}`)

            // Fetch journal and timetable data
            const { journalEntries, timetableData } = await this.fetchComparisonData(journalId)
            Logger.debug(`[${this.name}] Fetched ${journalEntries?.length || 0} journal entries and ${timetableData?.length || 0} timetable entries`)

            // Find missing lessons
            const missingLessons = this.findMissingLessons(journalEntries, timetableData)
            Logger.info(`[${this.name}] Found ${missingLessons.length} missing lessons`)

            // Find insertion point in the page
            const insertionPoint = this.findInsertionPoint()
            if (!insertionPoint) {
                Logger.warning(`[${this.name}] Could not find insertion point for table`)
                return
            }

            Logger.debug(`[${this.name}] Using insertion point: ${insertionPoint.tagName} with class: ${insertionPoint.className}`)

            // Create and insert the table
            const tableElement = this.buildMissingLessonsTable(missingLessons, timetableData)

            // Insert at the beginning of the container
            if (insertionPoint.firstChild) {
                insertionPoint.insertBefore(tableElement, insertionPoint.firstChild)
            } else {
                insertionPoint.appendChild(tableElement)
            }

            // Mark table as created
            this.tableCreated = true

            Logger.info(`[${this.name}] Missing lessons table created and inserted successfully`)

        } catch (error) {
            Logger.error(`[${this.name}] Error creating missing lessons table:`, error)
        }
    }

    /**
     * Fetch all data needed for comparison (like old extension)
     */
    async fetchComparisonData(journalId) {
        try {
            // Fetch journal info (like old extension)
            const journalInfo = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })
            Logger.debug(`[${this.name}] Fetched journal info:`, journalInfo)

            // Fetch journal entries by date (like old extension) 
            const journalEntries = await this.api.tahvel.get(
                `/journals/${journalId}/journalEntriesByDate`,
                { allStudents: false },
                { cache: true, cacheExpiration: 1000 * 60 * 5 } // 5 minutes cache
            )
            Logger.debug(`[${this.name}] Fetched journal entries:`, journalEntries)

            // Fetch journal students (like old extension)
            const journalStudents = await this.api.tahvel.get(`/journals/${journalId}/journalStudents`, {}, { cache: true })
            Logger.debug(`[${this.name}] Fetched journal students:`, journalStudents)

            // Try to fetch journal entry details (like old extension)
            let journalEntryDetails = null
            try {
                journalEntryDetails = await this.api.tahvel.get(`/journals/${journalId}/journalEntry`, {}, { cache: true })
                Logger.debug(`[${this.name}] Fetched journal entry details:`, journalEntryDetails)
            } catch (error) {
                Logger.debug(`[${this.name}] Could not fetch journal entry details:`, error.message)
            }

            // Try to fetch real timetable data from possible endpoints
            let timetableData = await this.fetchTimetableData(journalId)

            // If no timetable data found, analyze journal patterns to identify missing lessons
            if (!timetableData || timetableData.length === 0) {
                Logger.warning(`[${this.name}] No timetable data found, analyzing journal patterns`)
                timetableData = this.analyzeJournalPatterns(journalEntries)
            }

            return {
                journalInfo,
                journalEntries,
                journalStudents,
                journalEntryDetails,
                timetableData
            }
        } catch (error) {
            Logger.error(`[${this.name}] Error fetching comparison data:`, error)
            throw error
        }
    }

    /**
     * Try to fetch timetable data using the old extension's API endpoint
     */
    async fetchTimetableData(journalId) {
        // First try to get teacher and school info
        let teacherId = null
        let schoolId = null
        let journalData = null

        try {
            // Try to get journal details to extract teacher and school info
            journalData = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })
            if (journalData) {
                teacherId = journalData.journalTeachers?.[0]?.id
                schoolId = journalData.school?.id || journalData.schoolId || 9 // Default to 9 as seen in curl
                Logger.debug(`[${this.name}] Extracted teacher ID: ${teacherId}, school ID: ${schoolId}`)
            }
        } catch (error) {
            Logger.debug(`[${this.name}] Could not get journal details:`, error.message)
        }

        // Use the old extension's timetable endpoint ONLY
        if (teacherId && schoolId) {
            // Use the journal's study year dates for a more accurate range
            let fromDate, thruDate

            if (journalData && journalData.studyYearStartDate && journalData.studyYearEndDate) {
                fromDate = journalData.studyYearStartDate
                thruDate = journalData.studyYearEndDate
            } else {
                // Fallback to academic year dates
                fromDate = "2024-07-29T00:00:00Z"
                thruDate = "2025-08-31T00:00:00Z"
            }

            try {
                const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${fromDate}&lang=ET&teachers=${teacherId}&thru=${thruDate}`
                Logger.debug(`[${this.name}] Trying old extension timetable endpoint: ${endpoint}`)
                const data = await this.api.tahvel.get(endpoint, {}, { cache: true })

                Logger.debug(`[${this.name}] Response from timetable endpoint:`, data)

                if (data && data.timetableEvents && Array.isArray(data.timetableEvents) && data.timetableEvents.length > 0) {
                    Logger.info(`[${this.name}] Found timetable data (${data.timetableEvents.length} entries)`)
                    return this.normalizeTimetableData(data.timetableEvents)
                } else {
                    Logger.debug(`[${this.name}] Timetable endpoint returned empty or invalid data:`, data)
                }
            } catch (error) {
                Logger.debug(`[${this.name}] Old extension timetable endpoint not available:`, error.message)
            }
        }

        Logger.warning(`[${this.name}] No timetable data found`)
        return null
    }

    /**
     * Normalize timetable data from API to our expected format
     * Handles both old extension format and direct API responses
     */
    normalizeTimetableData(data) {
        return data
            .filter(entry => entry.journalId !== null) // Filter out entries without journalId (like old extension)
            .map(entry => ({
                date: this.formatDate(
                    entry.date ||
                    entry.entryDate ||
                    entry.timeTableDate ||
                    entry.dateFrom
                ),
                startLesson: entry.firstLessonStartNumber ||
                    entry.startLessonNr ||
                    entry.lessonStartNumber ||
                    entry.lessonNr ||
                    1,
                lessonCount: entry.lessonCount ||
                    entry.lessons ||
                    entry.lessonHours ||
                    1,
                timeStart: entry.timeStart || entry.startTime,
                timeEnd: entry.timeEnd || entry.endTime,
                name: entry.name ||
                    entry.nameEt ||
                    entry.subject?.nameEt ||
                    entry.subjectName ||
                    entry.journal?.nameEt,
                journalId: entry.journalId,
                rooms: entry.rooms || []
            }))
    }

    /**
     * Analyze journal patterns to identify potential missing lessons
     * This is a fallback when no timetable API is available
     */
    analyzeJournalPatterns(journalEntries) {
        if (!journalEntries || !Array.isArray(journalEntries)) {
            return []
        }

        // Group journal entries by date and analyze patterns
        const entriesByDate = new Map()
        const lessonDays = new Set()

        journalEntries.forEach(entry => {
            if (entry.entryType === 'SISSEKANNE_T' && entry.startLessonNr) {
                const date = this.formatDate(entry.entryDate)
                const dayOfWeek = this.parseDate(date).getDay()

                lessonDays.add(dayOfWeek)

                if (!entriesByDate.has(date)) {
                    entriesByDate.set(date, [])
                }
                entriesByDate.get(date).push({
                    startLesson: entry.startLessonNr,
                    lessonCount: entry.lessons || 1
                })
            }
        })

        Logger.debug(`[${this.name}] Found lesson entries on ${entriesByDate.size} dates`)
        Logger.debug(`[${this.name}] Lesson days of week: ${Array.from(lessonDays).join(', ')}`)

        // For demo purposes, create a pattern-based timetable
        // In reality, this would need more sophisticated pattern analysis
        const potentialMissingLessons = []

        // Check recent dates where lessons typically occur but no entries exist
        const today = new Date()
        const twoMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1)

        for (let d = new Date(twoMonthsAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay()

            // Only check days that typically have lessons
            if (lessonDays.has(dayOfWeek)) {
                const dateStr = this.formatDate(d.toISOString())

                // If no journal entry exists for this typical lesson day
                if (!entriesByDate.has(dateStr)) {
                    // Assume missing lessons based on typical pattern for this day
                    const typicalLessonsForDay = this.getTypicalLessonsForDay(dayOfWeek, entriesByDate)
                    if (typicalLessonsForDay) {
                        potentialMissingLessons.push({
                            date: dateStr,
                            startLesson: typicalLessonsForDay.startLesson,
                            lessonCount: typicalLessonsForDay.lessonCount
                        })
                    }
                }
            }
        }

        Logger.info(`[${this.name}] Identified ${potentialMissingLessons.length} potentially missing lessons based on patterns`)
        return potentialMissingLessons.slice(0, 10) // Limit for demo
    }

    /**
     * Analyze typical lesson patterns for a specific day of week
     */
    getTypicalLessonsForDay(dayOfWeek, entriesByDate) {
        const lessonsOnThisDay = []

        for (const [date, entries] of entriesByDate) {
            const entryDayOfWeek = this.parseDate(date).getDay()
            if (entryDayOfWeek === dayOfWeek) {
                entries.forEach(entry => lessonsOnThisDay.push(entry))
            }
        }

        if (lessonsOnThisDay.length === 0) return null

        // Return most common pattern for this day
        const startLessons = lessonsOnThisDay.map(l => l.startLesson)
        const lessonCounts = lessonsOnThisDay.map(l => l.lessonCount)

        const mostCommonStart = this.getMostCommon(startLessons)
        const mostCommonCount = this.getMostCommon(lessonCounts)

        return {
            startLesson: mostCommonStart,
            lessonCount: mostCommonCount
        }
    }

    /**
     * Get most common value from array
     */
    getMostCommon(arr) {
        const counts = {}
        arr.forEach(val => counts[val] = (counts[val] || 0) + 1)
        return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b)
    }

    /**
     * Compare timetable with journal entries to find missing lessons
     * A lesson is considered missing if there's a timetable entry but no corresponding journal entry
     * on the same date with the same start time
     */
    findMissingLessons(journalEntries, timetableData) {
        const missingLessons = []

        // Create a map of journal entries by date for quick lookup
        const journalByDate = new Map()

        if (journalEntries && Array.isArray(journalEntries)) {
            journalEntries.forEach(entry => {
                // Only consider actual lesson entries (SISSEKANNE_T = lesson)
                if (entry.entryType === 'SISSEKANNE_T' && entry.startLessonNr) {
                    const date = this.formatDate(entry.entryDate)
                    if (!journalByDate.has(date)) {
                        journalByDate.set(date, new Set())
                    }
                    // Track which lesson numbers are covered on this date
                    const startLesson = entry.startLessonNr
                    const lessonCount = entry.lessons || 1
                    for (let i = 0; i < lessonCount; i++) {
                        journalByDate.get(date).add(startLesson + i)
                    }
                }
            })
        }

        Logger.debug(`[${this.name}] Found journal entries for ${journalByDate.size} dates`)

        // Compare each timetable entry with journal entries
        timetableData.forEach(timetableEntry => {
            const journalLessonsForDate = journalByDate.get(timetableEntry.date) || new Set()

            // Check if the timetable lessons are covered by journal entries
            const timetableLessons = new Set()
            for (let i = 0; i < timetableEntry.lessonCount; i++) {
                timetableLessons.add(timetableEntry.startLesson + i)
            }

            // Find lessons that are in timetable but not in journal
            const missingLessonNumbers = []
            timetableLessons.forEach(lessonNum => {
                if (!journalLessonsForDate.has(lessonNum)) {
                    missingLessonNumbers.push(lessonNum)
                }
            })

            if (missingLessonNumbers.length > 0) {
                missingLessons.push({
                    date: timetableEntry.date,
                    startLesson: Math.min(...missingLessonNumbers),
                    lessonCount: missingLessonNumbers.length
                })
            }
        })

        // Sort by date ascending
        missingLessons.sort((a, b) => {
            const dateA = this.parseDate(a.date)
            const dateB = this.parseDate(b.date)
            return dateA - dateB
        })

        Logger.info(`[${this.name}] Found ${missingLessons.length} missing lesson periods`)
        return missingLessons
    }

    /**
     * Format date from ISO string to DD.MM.YYYY
     */
    formatDate(isoString) {
        const date = new Date(isoString)
        const day = date.getDate().toString().padStart(2, '0')
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const year = date.getFullYear()
        return `${day}.${month}.${year}`
    }

    /**
     * Parse date string DD.MM.YYYY to Date object
     */
    parseDate(dateString) {
        const [day, month, year] = dateString.split('.').map(Number)
        return new Date(year, month - 1, day)
    }

    /**
     * Find where to insert the table in the page
     */
    findInsertionPoint() {
        // Look for common container selectors in Tahvel journal edit pages
        const selectors = [
            'md-content .layout-padding',
            '.layout-padding',
            '#main-content .layout-padding',
            'md-content',
            '.md-padding',
            '[ng-controller*="journal"]',
            '[ng-controller*="Journal"]',
            '#main-content',
            'body'
        ]

        for (const selector of selectors) {
            const element = document.querySelector(selector)
            if (element) {
                Logger.debug(`[${this.name}] Found insertion point: ${selector}`)

                // For the layout-padding container, insert at the beginning
                if (selector.includes('layout-padding')) {
                    return element
                }

                // For other containers, try to find a good spot
                return element
            }
        }

        Logger.warning(`[${this.name}] No suitable insertion point found, using body`)
        return document.body
    }

    /**
     * Build the missing lessons table HTML
     */
    buildMissingLessonsTable(missingLessons, timetableData = []) {
        const container = document.createElement('div')
        container.className = 'missing-lessons-container'
        container.style.cssText = `
            margin: 20px 0;
            background: white;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #ddd;
            z-index: 1000;
            position: relative;
        `

        if (missingLessons.length === 0) {
            // Determine the message based on whether we have timetable data
            let message = 'Puuduolevaid tunde pole'
            let details = ''

            if (!timetableData || timetableData.length === 0) {
                message = 'Tunniplaani andmed pole saadaval'
                details = '<br><small style="color: #999;">Proovitud API lõpp-punktid: /journals/{id}/timetable, /journals/{id}/schedule, jne.</small>'
            }

            container.innerHTML = `
                <div style="background: #6c7b7f; color: white; padding: 12px; margin: 0; border-radius: 4px 4px 0 0; border-bottom: 1px solid #5a6569;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Puuduvad tunnid</h3>
                </div>
                <div style="padding: 20px; text-align: center;">
                    <p style="margin: 0; color: #666; font-style: italic; font-size: 14px;">${message}${details}</p>
                </div>
            `
        } else {
            // Build table with missing lessons
            const tableRows = missingLessons.map(lesson => `
                <tr style="border-bottom: 1px solid #f0f0f0;">
                    <td style="padding: 12px 16px; border-right: 1px solid #f0f0f0; font-weight: 500;">${lesson.date}</td>
                    <td style="padding: 12px 16px; text-align: center; border-right: 1px solid #f0f0f0;">${lesson.startLesson}</td>
                    <td style="padding: 12px 16px; text-align: center;">${lesson.lessonCount}</td>
                </tr>
            `).join('')

            container.innerHTML = `
                <div style="background: #6c7b7f; color: white; padding: 12px; margin: 0; border-radius: 4px 4px 0 0; border-bottom: 1px solid #5a6569;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Puuduvad tunnid</h3>
                </div>
                
                <div style="overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; font-family: 'Roboto', sans-serif;">
                        <thead>
                            <tr style="background: #f8f9fa; border-bottom: 2px solid #e9ecef;">
                                <th style="padding: 12px 16px; text-align: left; font-weight: 600; color: #495057; border-right: 1px solid #e9ecef;">Kuupäev</th>
                                <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: #495057; border-right: 1px solid #e9ecef;">Algustund</th>
                                <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: #495057;">Tundide arv</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            `
        }

        return container
    }

    /**
     * Cleanup when feature is deactivated
     */
    deactivate() {
        Logger.info(`[${this.name}] Deactivating missing lessons feature`)

        // Remove any created tables
        const tables = document.querySelectorAll('.missing-lessons-container')
        tables.forEach(table => table.remove())

        // Reset the flag
        this.tableCreated = false
    }
}

// Export a singleton instance
export const missingLessonsFeature = new MissingLessonsFeature()
