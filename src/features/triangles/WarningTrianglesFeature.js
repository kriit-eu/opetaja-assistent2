/**
 * Warning Triangles Feature - Shows warning triangles on journal list page
 * 
 * Based on the old extension's approach:
 * - Collects both journal entries and timetable data for each journal
 * - Shows warning triangles for missing lessons, discrepancies, etc.
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

export default class WarningTrianglesFeature extends BaseFeature {
    constructor() {
        // Match journal list pages
        super('warningTriangles', /#\/journals/, [])
        this.name = 'WarningTrianglesFeature'
        this.journalCache = new Map()
        this.processedJournals = new Set()
    }

    /**
     * Activate the feature on journal list pages
     */
    async activate() {
        Logger.info(`[${this.name}] Activating warning triangles feature`)

        // Wait for page to be ready
        setTimeout(() => {
            this.processJournalList()
        }, 2000)
    }

    /**
     * Process all journals on the current page
     */
    async processJournalList() {
        try {
            Logger.debug(`[${this.name}] Starting to process journal list`)
            const journalLinks = this.findJournalLinks()
            Logger.info(`[${this.name}] Found ${journalLinks.length} journals on page`)

            if (journalLinks.length === 0) {
                Logger.warning(`[${this.name}] No journal links found. Page structure might have changed.`)
                // Log the page structure for debugging
                const tableRows = document.querySelectorAll('table tbody tr')
                Logger.debug(`[${this.name}] Found ${tableRows.length} table rows on page`)
                const allLinks = document.querySelectorAll('a[href*="/journal/"]')
                Logger.debug(`[${this.name}] Found ${allLinks.length} links containing "/journal/" on page`)
            }

            for (const link of journalLinks) {
                const journalId = this.extractJournalId(link)
                Logger.debug(`[${this.name}] Processing link with href: ${link.href}, extracted ID: ${journalId}`)

                if (journalId && !this.processedJournals.has(journalId)) {
                    await this.processJournal(journalId, link)
                    this.processedJournals.add(journalId)
                } else if (!journalId) {
                    Logger.warning(`[${this.name}] Could not extract journal ID from link: ${link.href}`)
                }
            }
        } catch (error) {
            Logger.error(`[${this.name}] Error processing journal list:`, error)
        }
    }

    /**
     * Find all journal links on the current page
     */
    findJournalLinks() {
        const selectors = [
            '#main-content md-table-container td:nth-child(2) > a',
            '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr > td:nth-child(2) > a',
            'a[href^="/#/journal/"]',
            'a[href*="/journal/"]'  // More flexible selector
        ]

        for (const selector of selectors) {
            Logger.debug(`[${this.name}] Trying selector: ${selector}`)
            const links = document.querySelectorAll(selector)
            Logger.debug(`[${this.name}] Selector ${selector} found ${links.length} links`)

            if (links.length > 0) {
                Logger.info(`[${this.name}] Using selector: ${selector} (found ${links.length} links)`)
                return Array.from(links)
            }
        }

        Logger.warning(`[${this.name}] No journal links found with any selector`)
        return []
    }

    /**
     * Extract journal ID from link
     */
    extractJournalId(link) {
        const href = link.getAttribute('href') || link.getAttribute('ng-href') || ''
        const match = href.match(/\/journal\/(\d+)/)
        return match ? parseInt(match[1]) : null
    }

    /**
     * Process a single journal - collect data and add warning triangles
     */
    async processJournal(journalId, linkElement) {
        try {
            Logger.debug(`[${this.name}] Processing journal ${journalId}`)

            // Collect journal data (same as old extension)
            const journalData = await this.collectJournalData(journalId)

            // Analyze the data for issues
            const issues = this.analyzeJournalIssues(journalData)

            // Add warning triangles if there are issues
            if (issues.length > 0) {
                this.addWarningTriangles(linkElement, issues)
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error processing journal ${journalId}:`, error)
        }
    }

    /**
     * Collect all data for a journal (journal entries + timetable data)
     */
    async collectJournalData(journalId) {
        const data = {
            id: journalId,
            journalInfo: null,
            journalEntries: [],
            timetableEntries: [],
            students: []
        }

        try {
            // Get journal basic info
            data.journalInfo = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })
            Logger.debug(`[${this.name}] Fetched journal info for ${journalId}`)

            // Get journal entries
            data.journalEntries = await this.api.tahvel.get(
                `/journals/${journalId}/journalEntriesByDate`,
                { allStudents: false },
                { cache: true }
            )
            Logger.debug(`[${this.name}] Fetched ${data.journalEntries?.length || 0} journal entries for ${journalId}`)

            // Get timetable data using the working API endpoint
            data.timetableEntries = await this.fetchTimetableData(journalId, data.journalInfo)
            Logger.debug(`[${this.name}] Fetched ${data.timetableEntries?.length || 0} timetable entries for ${journalId}`)

            // Get students
            data.students = await this.api.tahvel.get(
                `/journals/${journalId}/journalStudents`,
                { allStudents: false },
                { cache: true }
            )
            Logger.debug(`[${this.name}] Fetched ${data.students?.length || 0} students for ${journalId}`)

        } catch (error) {
            Logger.error(`[${this.name}] Error collecting data for journal ${journalId}:`, error)
        }

        return data
    }

    /**
     * Fetch timetable data using the old extension's API endpoint
     */
    async fetchTimetableData(journalId, journalInfo) {
        if (!journalInfo || !journalInfo.journalTeachers?.[0]?.id) {
            return []
        }

        const teacherId = journalInfo.journalTeachers[0].id
        const schoolId = journalInfo.school?.id || 9

        try {
            // Use study year dates from journal info
            let fromDate, thruDate
            if (journalInfo.studyYearStartDate && journalInfo.studyYearEndDate) {
                fromDate = journalInfo.studyYearStartDate
                thruDate = journalInfo.studyYearEndDate
            } else {
                fromDate = "2024-07-29T00:00:00Z"
                thruDate = "2025-08-31T00:00:00Z"
            }

            // Use the old extension's API endpoint format
            const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${fromDate}&lang=ET&teachers=${teacherId}&thru=${thruDate}`

            Logger.debug(`[${this.name}] Fetching timetable data from: ${endpoint}`)

            const data = await this.api.tahvel.get(endpoint, {}, { cache: true })

            if (!data || !data.timetableEvents || !Array.isArray(data.timetableEvents)) {
                Logger.debug(`[${this.name}] No timetable events found`)
                return []
            }

            Logger.info(`[${this.name}] Fetched ${data.timetableEvents.length} timetable entries for journal ${journalId}`)

            // Filter events with journalId and transform to our format
            return data.timetableEvents
                .filter(event => event.journalId !== null)
                .map(event => ({
                    id: event.id,
                    name: event.nameEt,
                    date: event.date,
                    timeStart: event.timeStart,
                    timeEnd: event.timeEnd,
                    firstLessonStartNumber: this.calculateLessonNumber(event),
                    journalId: event.journalId,
                    rooms: event.rooms || []
                }))

        } catch (error) {
            Logger.error(`[${this.name}] Error fetching timetable data for journal ${journalId}:`, error)
            return []
        }
    }

    /**
     * Calculate lesson number from timetable event
     */
    calculateLessonNumber(event) {
        // Simple calculation based on time - can be improved
        if (!event.timeStart) return 1

        const hour = parseInt(event.timeStart.split(':')[0])
        if (hour < 9) return 1
        if (hour < 10) return 2
        if (hour < 11) return 3
        if (hour < 12) return 4
        if (hour < 13) return 5
        if (hour < 14) return 6
        return 7
    }

    /**
     * Analyze journal data for issues (same logic as old extension)
     */
    analyzeJournalIssues(journalData) {
        const issues = []

        if (!journalData.journalEntries || !journalData.timetableEntries) {
            return issues
        }

        // Group entries by date for comparison
        const journalDates = new Set()
        const timetableDates = new Set()

        // Process journal entries
        journalData.journalEntries.forEach(entry => {
            if (entry.entryType === 'SISSEKANNE_T' && entry.entryDate) {
                const date = this.formatDate(entry.entryDate)
                journalDates.add(date)
            }
        })

        // Process timetable entries  
        journalData.timetableEntries.forEach(entry => {
            if (entry.date || entry.timeTableDate) {
                const date = this.formatDate(entry.date || entry.timeTableDate)
                // Only consider past dates for missing lesson detection
                if (new Date(date) < new Date()) {
                    timetableDates.add(date)
                }
            }
        })

        // Check for missing lessons (lessons in timetable but not in journal)
        const missingLessonDates = []
        timetableDates.forEach(date => {
            if (!journalDates.has(date)) {
                missingLessonDates.push(date)
            }
        })

        // Check for discrepancies (different lesson counts or times)
        const discrepancies = []
        journalDates.forEach(date => {
            if (timetableDates.has(date)) {
                // Could add more detailed comparison logic here
                // For now, just check if dates exist in both
            }
        })

        // Add issues based on analysis
        if (missingLessonDates.length > 0) {
            issues.push({
                type: 'missingLessons',
                count: missingLessonDates.length,
                message: 'Päevikus pole ühtegi toimunud tunni sissekannet',
                color: '#f8d00f',
                icon: '⚠'
            })
        }

        if (discrepancies.length > 0) {
            issues.push({
                type: 'discrepancies',
                count: discrepancies.length,
                message: 'Erinevused päeviku sissekannete ja tunniplaani vahel',
                color: 'grey',
                icon: '⚠'
            })
        }

        Logger.debug(`[${this.name}] Found ${issues.length} issues for journal ${journalData.id}`)
        return issues
    }

    /**
     * Add warning triangles to journal link
     */
    addWarningTriangles(linkElement, issues) {
        try {
            // Create wrapper for link + triangles
            const wrapper = document.createElement('span')
            wrapper.style.display = 'flex'
            wrapper.style.alignItems = 'center'
            wrapper.style.gap = '5px'
            wrapper.id = 'WarningTrianglesWrapper'

            // Clone the original link
            const clonedLink = linkElement.cloneNode(true)
            wrapper.appendChild(clonedLink)

            // Add warning triangles for each issue
            issues.forEach(issue => {
                const triangle = this.createWarningTriangle(issue)
                wrapper.appendChild(triangle)
            })

            // Replace original link with wrapper
            linkElement.replaceWith(wrapper)

            Logger.debug(`[${this.name}] Added ${issues.length} warning triangles`)

        } catch (error) {
            Logger.error(`[${this.name}] Error adding warning triangles:`, error)
        }
    }

    /**
     * Create a warning triangle element
     */
    createWarningTriangle(issue) {
        const triangle = document.createElement('span')
        triangle.style.cssText = `
            display: inline-block;
            color: ${issue.color};
            font-size: 16px;
            font-weight: bold;
            margin-left: 5px;
            cursor: help;
            title: "${issue.message}";
        `
        triangle.textContent = issue.icon
        triangle.title = issue.message
        triangle.setAttribute('data-issue-type', issue.type)

        return triangle
    }

    /**
     * Format date to YYYY-MM-DD
     */
    formatDate(dateStr) {
        if (!dateStr) return null
        const date = new Date(dateStr)
        return date.toISOString().split('T')[0]
    }
}
