/**
 * Warning Triangles Feature - Shows warning triangles on journal list page
 * 
 * Uses LessonDiscrepanciesFeature's sophisticated analysis logic to accurately
 * detect journal issues and show appropriate warning triangles.
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import LessonDiscrepanciesFeature from '../lessonDiscrepancies/LessonDiscrepanciesFeature.js'

export default class WarningTrianglesFeature extends BaseFeature {
    constructor() {
        // Match journal list pages
        super('warningTriangles', /#\/journals/, [])
        this.name = 'WarningTrianglesFeature'
        this.journalCache = new Map()
        this.processedJournals = new Set()

        // Create instance of LessonDiscrepanciesFeature to use its analysis methods
        this.discrepanciesAnalyzer = new LessonDiscrepanciesFeature()
    }

    /**
     * Activate the feature on journal list pages
     */
    async activate() {
        Logger.info(`[${this.name}] Activating warning triangles feature`)

        // Clear previous state when reactivating
        this.processedJournals.clear()

        // Wait for page to be ready
        setTimeout(() => {
            this.processJournalList()
        }, 2000)

        // Also listen for URL changes (navigation back to journals page)
        this.setupNavigationListener()
    }

    /**
     * Setup listener for navigation changes
     */
    setupNavigationListener() {
        // Listen for URL changes (for SPA navigation)
        let lastUrl = window.location.href

        const checkUrlChange = () => {
            const currentUrl = window.location.href
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl

                // Check if we're on journals list page
                if (currentUrl.includes('/#/journals')) {
                    Logger.debug(`[${this.name}] Navigation detected back to journals page`)
                    // Clear processed journals and reprocess after a delay
                    this.processedJournals.clear()
                    setTimeout(() => {
                        this.processJournalList()
                    }, 1000)
                }
            }
        }

        // Check for URL changes periodically
        this.navigationInterval = setInterval(checkUrlChange, 500)

        // Also listen for browser navigation events
        window.addEventListener('popstate', () => {
            setTimeout(checkUrlChange, 100)
        })
    }

    /**
     * Cleanup when feature is deactivated
     */
    onDeactivate() {
        if (this.navigationInterval) {
            clearInterval(this.navigationInterval)
            this.navigationInterval = null
        }
        super.onDeactivate()
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
                return
            }

            // Check if triangles are already present (avoid reprocessing if already done)
            const existingTriangles = document.querySelectorAll('#WarningTrianglesWrapper')
            if (existingTriangles.length > 0) {
                Logger.debug(`[${this.name}] Warning triangles already present (${existingTriangles.length}), skipping reprocess`)
                return
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
            const issues = await this.analyzeJournalIssues(journalData)
            Logger.debug(`[${this.name}] Analysis complete, found ${issues.length} issues for journal ${journalId}`)

            // Add warning triangles if there are issues
            if (issues.length > 0) {
                Logger.info(`[${this.name}] Adding warning triangles for journal ${journalId}: ${issues.map(i => i.type).join(', ')}`)
                this.addWarningTriangles(linkElement, issues)
            } else {
                Logger.debug(`[${this.name}] No issues found for journal ${journalId}, not adding triangles`)
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error processing journal ${journalId}:`, error)
        }
    }

    /**
     * Collect all data for a journal using the same format as LessonDiscrepanciesFeature
     */
    async collectJournalData(journalId) {
        try {
            // Get journal basic info
            const journalInfo = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })
            Logger.debug(`[${this.name}] Fetched journal info for ${journalId}`)

            // Get journal entries (use same parameters as LessonDiscrepanciesFeature)
            const journalEntries = await this.api.tahvel.get(
                `/journals/${journalId}/journalEntriesByDate`,
                { allStudents: true },
                { cache: true }
            )
            Logger.debug(`[${this.name}] Fetched ${journalEntries?.length || 0} journal entries for ${journalId}`)

            // Get timetable data using the same method as LessonDiscrepanciesFeature
            const timetableEntries = await this.fetchTimetableDataForAnalysis(journalInfo)
            Logger.debug(`[${this.name}] Fetched ${timetableEntries?.length || 0} timetable entries for ${journalId}`)

            return {
                info: journalInfo,
                entries: journalEntries || [],
                timetableData: timetableEntries || []
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error collecting data for journal ${journalId}:`, error)
            return {
                info: null,
                entries: [],
                timetableData: []
            }
        }
    }

    /**
     * Fetch timetable data using the same method as LessonDiscrepanciesFeature
     */
    async fetchTimetableDataForAnalysis(journalInfo) {
        if (!journalInfo || !journalInfo.journalTeachers?.[0]?.id) {
            return []
        }

        const teacherId = journalInfo.journalTeachers[0].id
        const schoolId = journalInfo.school?.id || 9

        try {
            // Use the same date calculation as LessonDiscrepanciesFeature
            const { from, thru } = this.getCurrentStudyYearDates()

            const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
            Logger.debug(`[${this.name}] Fetching timetable data from: ${endpoint}`)

            const data = await this.api.tahvel.get(endpoint, {}, { cache: true })

            if (!data || !data.timetableEvents || !Array.isArray(data.timetableEvents)) {
                Logger.debug(`[${this.name}] No timetable events found`)
                return []
            }

            // Filter to only events for this journal
            const journalEvents = data.timetableEvents.filter(event =>
                event.journalId === journalInfo.id
            )

            Logger.debug(`[${this.name}] Fetched ${journalEvents.length} timetable entries for journal ${journalInfo.id}`)
            return journalEvents

        } catch (error) {
            Logger.error(`[${this.name}] Error fetching timetable data:`, error)
            return []
        }
    }

    /**
     * Get current study year dates (same as LessonDiscrepanciesFeature)
     */
    getCurrentStudyYearDates() {
        const now = new Date()
        const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
        return {
            from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
            thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
        }
    }

    /**
     * Analyze journal data using LessonDiscrepanciesFeature's sophisticated logic
     */
    async analyzeJournalIssues(journalData) {
        const issues = []

        try {
            // Use LessonDiscrepanciesFeature's analysis methods
            Logger.debug(`[${this.name}] Running lesson discrepancies analysis for journal ${journalData.info?.id}`)

            // Find lesson discrepancies (missing lessons, count mismatches, etc.)
            const discrepancies = await this.findLessonDiscrepancies(journalData, journalData.timetableData)
            Logger.debug(`[${this.name}] Found ${discrepancies.length} lesson discrepancies`)

            // Find capacity type problems
            const capacityProblems = await this.getCapacityTypeProblems(journalData)
            Logger.debug(`[${this.name}] Found ${capacityProblems.length} capacity problems`)

            // Convert discrepancies to warning triangles
            if (discrepancies.length > 0) {
                issues.push({
                    type: 'lessonDiscrepancies',
                    count: discrepancies.length,
                    message: `Erinevused tunniplaaniga (${discrepancies.length})`,
                    color: '#f8d00f',
                    icon: '⚠'
                })
            }

            // Convert capacity problems to warning triangles  
            if (capacityProblems.length > 0) {
                issues.push({
                    type: 'capacityProblems',
                    count: capacityProblems.length,
                    message: `Ebaloogilised sissekande kombinatsioonid (${capacityProblems.length})`,
                    color: '#dc3545',
                    icon: '❌'
                })
            }

            Logger.debug(`[${this.name}] Found ${issues.length} total issues for journal ${journalData.info?.id}`)
            return issues

        } catch (error) {
            Logger.error(`[${this.name}] Error analyzing journal issues:`, error)
            return []
        }
    }

    /**
     * Use LessonDiscrepanciesFeature's sophisticated discrepancy detection
     */
    async findLessonDiscrepancies(journalData, timetableData) {
        try {
            Logger.debug(`[${this.name}] Calling LessonDiscrepanciesFeature.findLessonDiscrepancies with ${journalData.entries?.length || 0} entries and ${timetableData?.length || 0} timetable events`)
            // Delegate to the discrepancies analyzer
            const result = await this.discrepanciesAnalyzer.findLessonDiscrepancies(journalData, timetableData)
            Logger.debug(`[${this.name}] LessonDiscrepanciesFeature returned ${result?.length || 0} discrepancies`)
            return result
        } catch (error) {
            Logger.error(`[${this.name}] Error calling findLessonDiscrepancies:`, error)
            return []
        }
    }

    /**
     * Use LessonDiscrepanciesFeature's capacity type problem detection
     */
    async getCapacityTypeProblems(journalData) {
        try {
            Logger.debug(`[${this.name}] Calling LessonDiscrepanciesFeature.getCapacityTypeProblems`)
            // Delegate to the discrepancies analyzer
            const result = await this.discrepanciesAnalyzer.getCapacityTypeProblems(journalData)
            Logger.debug(`[${this.name}] LessonDiscrepanciesFeature returned ${result?.length || 0} capacity problems`)
            return result
        } catch (error) {
            Logger.error(`[${this.name}] Error calling getCapacityTypeProblems:`, error)
            return []
        }
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
}
