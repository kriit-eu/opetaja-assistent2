/**
 * Lesson Discrepancies Feature - Shows detailed table of missing lessons on journal edit page
 * Based on the old extension's TahvelJournal.addLessonDiscrepanciesTable functionality
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

/**
 * LessonDiscrepanciesFeature class for displaying detailed missing lessons table
 */
export default class LessonDiscrepanciesFeature extends BaseFeature {
    constructor() {
        // Match journal edit pages specifically
        super('lessonDiscrepancies', /\/journal\/\d+\/edit/, [])
        this.name = 'LessonDiscrepanciesFeature'
        this.tableCreated = false
    }

    /**
     * Activate the feature when on journal edit page
     */
    async activate() {
        Logger.debug(`[${this.name}] Activating feature`)
        Logger.debug(`[${this.name}] Activating lesson discrepancies feature`)

        // Wait for page to be ready and create the discrepancies table
        setTimeout(async () => {
            await this.createLessonDiscrepanciesTable()
        }, 2000)
    }

    /**
     * Extract journal ID from current URL
     */
    extractJournalId() {
        const url = window.location.pathname + window.location.hash
        const urlMatch = url.match(/\/journal\/(\d+)/)
        return urlMatch ? parseInt(urlMatch[1]) : null
    }

    /**
     * Create the lesson discrepancies table
     */
    async createLessonDiscrepanciesTable() {
        try {
            if (this.tableCreated) {
                Logger.debug(`[${this.name}] Table already created, skipping`)
                return
            }

            const journalId = this.extractJournalId()
            if (!journalId) {
                Logger.debug(`[${this.name}] No journal ID found in URL`)
                return
            }

            Logger.info(`[${this.name}] Creating lesson discrepancies table for journal ${journalId}`)

            // Collect journal and timetable data
            const { journalData, timetableData } = await this.fetchJournalAndTimetableData(journalId)

            // Compare and find discrepancies (now async)
            const discrepancies = await this.findLessonDiscrepancies(journalData, timetableData)

            if (discrepancies.length === 0) {
                Logger.debug(`[${this.name}] No lesson discrepancies found`)
                return
            }

            // Create and insert the discrepancies table
            this.insertDiscrepanciesTable(discrepancies)
            this.tableCreated = true

            Logger.info(`[${this.name}] Lesson discrepancies table created with ${discrepancies.length} discrepancies`)

        } catch (error) {
            Logger.error(`[${this.name}] Error creating lesson discrepancies table:`, error)
        }
    }

    /**
     * Fetch both journal and timetable data
     */
    async fetchJournalAndTimetableData(journalId) {
        // Get journal info
        const journalInfo = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })

        // Get journal entries
        const journalEntries = await this.api.tahvel.get(
            `/journals/${journalId}/journalEntriesByDate`,
            { allStudents: false },
            { cache: true }
        )

        // Get timetable data using the old extension's API pattern
        const timetableData = await this.fetchTimetableData(journalInfo)

        return {
            journalData: {
                info: journalInfo,
                entries: journalEntries || []
            },
            timetableData: timetableData || []
        }
    }

    /**
     * Fetch timetable data using old extension's API
     */
    async fetchTimetableData(journalInfo) {
        try {
            const teacherId = journalInfo.journalTeachers?.[0]?.id
            const schoolId = journalInfo.school?.id || 9

            if (!teacherId || !schoolId) {
                Logger.debug(`[${this.name}] Missing teacher ID or school ID`)
                return []
            }

            // Use study year dates
            let fromDate, thruDate
            if (journalInfo.studyYearStartDate && journalInfo.studyYearEndDate) {
                fromDate = journalInfo.studyYearStartDate
                thruDate = journalInfo.studyYearEndDate
            } else {
                fromDate = "2024-07-29T00:00:00Z"
                thruDate = "2025-08-31T00:00:00Z"
            }

            // Use old extension's API pattern
            const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${fromDate}&lang=ET&teachers=${teacherId}&thru=${thruDate}`

            Logger.debug(`[${this.name}] Fetching timetable data from: ${endpoint}`)

            const data = await this.api.tahvel.get(endpoint, {}, { cache: true })

            if (data && data.timetableEvents && Array.isArray(data.timetableEvents)) {
                // Filter for this journal only
                const journalTimetableEvents = data.timetableEvents.filter(event =>
                    event.journalId === parseInt(journalInfo.id)
                )

                Logger.info(`[${this.name}] Found ${journalTimetableEvents.length} timetable events for journal ${journalInfo.id}`)
                return journalTimetableEvents
            }

            return []

        } catch (error) {
            Logger.warning(`[${this.name}] Error fetching timetable data:`, error.message)
            return []
        }
    }

    /**
     * Fetch lesson times from the API (like old extension)
     */
    async fetchLessonTimes(schoolId = 9) {
        try {
            // Try to load lesson times using chrome.runtime messaging to background script
            const lessonTimesData = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { action: 'loadLessonTimes' },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message))
                        } else if (response.error) {
                            reject(new Error(response.error))
                        } else {
                            resolve(response.data)
                        }
                    }
                )
            })
            console.log(`[${this.name}] DEBUG: Loaded lesson times data:`, lessonTimesData)

            Logger.debug(`[${this.name}] Loaded lesson times for school ${schoolId}:`, lessonTimesData)

            // Get lesson times for the specific school ID
            const schoolLessonTimes = lessonTimesData[schoolId.toString()]

            if (schoolLessonTimes && Array.isArray(schoolLessonTimes)) {
                return schoolLessonTimes
            }

            // Fallback to school ID 9 if specific school not found
            if (schoolId !== 9 && lessonTimesData['9']) {
                Logger.debug(`[${this.name}] Using fallback lesson times for school 9`)
                return lessonTimesData['9']
            }

            return []
        } catch (error) {
            Logger.warning(`[${this.name}] Error loading lesson times:`, error.message)
            return []
        }
    }

    /**
     * Calculate lesson number based on start time (like old extension)
     */
    async calculateLessonNumber(timeStart, schoolId = 9) {
        // Fetch lesson times from local JSON
        const lessonTimes = await this.fetchLessonTimes(schoolId)

        if (!timeStart || !lessonTimes.length) return 1

        // Convert timeStart to comparable format
        const eventTime = new Date(`2021-01-01T${timeStart}`).getTime()

        // Find closest lesson time
        let closestLesson = lessonTimes[0]
        let smallestDifference = Infinity

        for (const lessonTime of lessonTimes) {
            const lessonTimeMs = new Date(`2021-01-01T${lessonTime.timeStart}`).getTime()
            const difference = Math.abs(lessonTimeMs - eventTime)

            if (difference < smallestDifference) {
                smallestDifference = difference
                closestLesson = lessonTime
            }
        }

        return closestLesson.number
    }

    /**
     * Find discrepancies between journal entries and timetable
     */
    async findLessonDiscrepancies(journalData, timetableData) {
        const discrepancies = []
        const journalEntryDates = new Set()

        // Create set of dates that have journal entries
        journalData.entries.forEach(entry => {
            if (entry.entryType === 'SISSEKANNE_T') { // Regular lesson entry
                journalEntryDates.add(this.formatDate(entry.entryDate))
            }
        })

        // Check each timetable entry for missing journal entries
        for (const timetableEntry of timetableData) {
            const timetableDate = this.formatDate(timetableEntry.date)
            const timetableDateTime = new Date(timetableEntry.date)
            const now = new Date()

            // Only check past lessons
            if (timetableDateTime < now && !journalEntryDates.has(timetableDate)) {
                // Calculate lesson number using local lesson times data
                const schoolId = journalData.info.school?.id || 9
                const lessonNumber = await this.calculateLessonNumber(timetableEntry.timeStart, schoolId)

                discrepancies.push({
                    date: timetableDate,
                    timeStart: timetableEntry.timeStart,
                    timeEnd: timetableEntry.timeEnd,
                    name: timetableEntry.nameEt || journalData.info.nameEt,
                    rooms: timetableEntry.rooms || [],
                    lessonNumber: lessonNumber,
                    type: 'missing_journal_entry'
                })
            }
        }

        return discrepancies
    }

    /**
     * Insert the discrepancies table into the page
     */
    insertDiscrepanciesTable(discrepancies) {
        // Find insertion point
        const insertionPoint = this.findInsertionPoint()
        if (!insertionPoint) {
            Logger.warning(`[${this.name}] Could not find insertion point`)
            return
        }

        // Create table
        const table = this.createDiscrepanciesTableElement(discrepancies)

        // Insert into page
        insertionPoint.insertBefore(table, insertionPoint.firstChild)

        Logger.debug(`[${this.name}] Discrepancies table inserted into page`)
    }

    /**
     * Find appropriate insertion point on the page
     */
    findInsertionPoint() {
        // Try multiple selectors to find the main content area
        const selectors = [
            'md-content .layout-padding',
            '.layout-padding',
            'md-content',
            '#main-content'
        ]

        for (const selector of selectors) {
            const element = document.querySelector(selector)
            if (element) {
                Logger.debug(`[${this.name}] Found insertion point: ${selector}`)
                return element
            }
        }

        Logger.warning(`[${this.name}] No suitable insertion point found`)
        return document.body
    }

    /**
     * Create the HTML table element for discrepancies
     */
    createDiscrepanciesTableElement(discrepancies) {
        // Sort discrepancies by date (earliest first), then by lesson number
        const sortedDiscrepancies = discrepancies.sort((a, b) => {
            const dateA = new Date(a.date)
            const dateB = new Date(b.date)

            // First sort by date
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB
            }

            // If dates are the same, sort by lesson number
            return a.lessonNumber - b.lessonNumber
        })

        const container = document.createElement('div')
        container.style.cssText = `
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `

        container.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <span style="font-size: 20px; margin-right: 10px;">⚠️</span>
                <h3 style="margin: 0; color: #856404;">Puuduvad tunnisisseukanded (${sortedDiscrepancies.length})</h3>
            </div>
            <p style="margin: 0 0 15px 0; color: #856404;">
                Tunniplaanist leitud tunnid, millele ei vasta ühtegi päeviku sissekannet:
            </p>
            <table style="width: 100%; border-collapse: collapse; background: white;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Kuupäev</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Tund</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Kellaaeg</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">Aine</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedDiscrepancies.map(discrepancy => `
                        <tr>
                            <td style="padding: 10px; border: 1px solid #dee2e6;">${this.formatDisplayDate(discrepancy.date)}</td>
                            <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">${discrepancy.lessonNumber}</td>
                            <td style="padding: 10px; border: 1px solid #dee2e6;">${discrepancy.timeStart} - ${discrepancy.timeEnd}</td>
                            <td style="padding: 10px; border: 1px solid #dee2e6;">${discrepancy.name}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `

        return container
    }

    /**
     * Format date for comparison (YYYY-MM-DD)
     */
    formatDate(dateString) {
        const date = new Date(dateString)
        return date.toISOString().split('T')[0]
    }

    /**
     * Format date for display (DD.MM.YYYY)
     */
    formatDisplayDate(dateString) {
        const date = new Date(dateString)
        const day = date.getDate().toString().padStart(2, '0')
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const year = date.getFullYear()
        return `${day}.${month}.${year}`
    }
}
