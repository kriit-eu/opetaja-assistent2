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
        this.activeRequests = new Map() // Track active requests to prevent duplicates

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
        this.activeRequests.clear()

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
                    this.activeRequests.clear()
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
     * Process all journals on the current page with parallel processing
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

            // Process all journals in parallel
            const journalPromises = []
            for (const link of journalLinks) {
                const journalId = this.extractJournalId(link)
                Logger.debug(`[${this.name}] Preparing parallel processing for journal ${journalId}`)

                if (journalId && !this.processedJournals.has(journalId)) {
                    // Add to parallel processing queue
                    journalPromises.push(this.processJournalWithDeduplication(journalId, link))
                    this.processedJournals.add(journalId)
                } else if (!journalId) {
                    Logger.warning(`[${this.name}] Could not extract journal ID from link: ${link.href}`)
                }
            }

            // Process all journals in parallel with controlled concurrency
            const batchSize = 10 // Process 10 journals at a time to avoid overwhelming the API
            Logger.info(`[${this.name}] Processing ${journalPromises.length} journals in batches of ${batchSize}`)
            
            for (let i = 0; i < journalPromises.length; i += batchSize) {
                const batch = journalPromises.slice(i, i + batchSize)
                Logger.debug(`[${this.name}] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(journalPromises.length / batchSize)} (${batch.length} journals)`)
                
                // Wait for this batch to complete before starting the next
                await Promise.allSettled(batch)
                
                // Small delay between batches to be nice to the API
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            Logger.info(`[${this.name}] Completed processing all journals`)
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

            // Collect journal data
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

            return issues

        } catch (error) {
            Logger.error(`[${this.name}] Error processing journal ${journalId}:`, error)
            return []
        }
    }

    /**
     * Collect all data for a journal using parallel requests
     */
    async collectJournalData(journalId) {
        try {
            // Start all requests in parallel
            const [journalInfo, journalEntries] = await Promise.all([
                // Get journal basic info
                this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true }),
                // Get journal entries (use same parameters as LessonDiscrepanciesFeature)
                this.api.tahvel.get(
                    `/journals/${journalId}/journalEntriesByDate`,
                    { allStudents: true },
                    { cache: true }
                )
            ])

            Logger.debug(`[${this.name}] Fetched journal info for ${journalId}`)
            Logger.debug(`[${this.name}] Fetched ${journalEntries?.length || 0} journal entries for ${journalId}`)

            // Get timetable data (depends on journal info)
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
     * Analyze journal data using LessonDiscrepanciesFeature's sophisticated logic with parallel processing
     */
    async analyzeJournalIssues(journalData) {
        const issues = []

        try {
            // Use LessonDiscrepanciesFeature's analysis methods
            Logger.debug(`[${this.name}] Running parallel analysis for journal ${journalData.info?.id}`)

            // Run both analyses in parallel
            const [discrepancies, capacityProblems] = await Promise.all([
                // Find lesson discrepancies (missing lessons, count mismatches, etc.)
                this.findLessonDiscrepancies(journalData, journalData.timetableData),
                // Find capacity type problems
                this.getCapacityTypeProblems(journalData)
            ])

            Logger.debug(`[${this.name}] Found ${discrepancies.length} lesson discrepancies`)
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

            // Add timeout to catch hanging calls
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('findLessonDiscrepancies timeout')), 10000)
            })

            const analysisPromise = this.discrepanciesAnalyzer.findLessonDiscrepancies(journalData, timetableData)

            const result = await Promise.race([analysisPromise, timeoutPromise])
            Logger.debug(`[${this.name}] LessonDiscrepanciesFeature returned ${result?.length || 0} discrepancies`)
            return result || []
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
     * Map issue types to emoji icons (from example.html)
     */
    getIssueIcon(issue) {
        // Map known types to icons
        const typeToIcon = {
            // Timetable discrepancies
            lessonDiscrepancies: '📅', // Missing lessons based on timetable
            missingLessons: '📅',
            // Checkbox mismatch
            capacityProblems: '☑️', // Checkbox mismatch for lesson type
            checkboxMismatch: '☑️',
            // Final grades missing
            missingFinalGrades: '⭐',
            // Independent work entries missing
            missingIndependentWork: '📝',
            // Overdue independent work missing grades
            overdueIndependentWork: '⏰',
        };
        // Try to use the type, fallback to icon property if present
        return typeToIcon[issue.type] || issue.icon || '⚠';
    }

    /**
     * Add warning pill with icons to journal link
     */
    addWarningTriangles(linkElement, issues) {
        try {
            // Create wrapper for link + pill
            const wrapper = document.createElement('span');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '5px';
            wrapper.id = 'WarningTrianglesWrapper';

            // Clone the original link
            const clonedLink = linkElement.cloneNode(true);
            wrapper.appendChild(clonedLink);

            // Collect all icons for this journal's issues
            const icons = issues.map(issue => this.getIssueIcon(issue));
            // Remove duplicates, just in case
            const uniqueIcons = [...new Set(icons)];

            // Create the pill element styled as in example.html, but slightly bigger than the icons (only pill, not icons)
            const pill = document.createElement('span');
            pill.className = 'error-pill';
            pill.style.display = 'inline-flex';
            pill.style.alignItems = 'center';
            pill.style.gap = '0.3em';
            pill.style.backgroundColor = '#ffe5e5';
            pill.style.border = '1.5px solid #ff0000';
            pill.style.borderRadius = '999px';
            pill.style.padding = '0.2em 0.7em'; // slightly more padding
            pill.style.fontSize = '1em'; // normal font size
            pill.style.height = '2em'; // slightly taller than icon
            pill.style.lineHeight = '1.2';
            pill.title = issues.map(issue => issue.message).join(' | ');

            // Add each icon to the pill
            uniqueIcons.forEach(icon => {
                const iconSpan = document.createElement('span');
                iconSpan.textContent = icon;
                iconSpan.style.fontSize = '1em'; // icon stays normal size
                iconSpan.style.verticalAlign = 'middle';
                pill.appendChild(iconSpan);
            });

            // Add the pill after the link
            wrapper.appendChild(pill);

            // Replace original link with wrapper
            linkElement.replaceWith(wrapper);

            Logger.debug(`[${this.name}] Added warning pill with icons: ${uniqueIcons.join(' ')} for issues: ${issues.map(i => i.type).join(', ')}`);
        } catch (error) {
            Logger.error(`[${this.name}] Error adding warning pill:`, error);
        }
    }

    /**
     * Process a journal with request deduplication
     */
    async processJournalWithDeduplication(journalId, linkElement) {
        // Check if we already have an active request for this journal
        if (this.activeRequests.has(journalId)) {
            Logger.debug(`[${this.name}] Request for journal ${journalId} already in progress, waiting for existing request`)
            try {
                // Wait for the existing request to complete
                const result = await this.activeRequests.get(journalId)
                // Apply triangles if the existing request found issues
                if (result && result.length > 0) {
                    this.addWarningTriangles(linkElement, result)
                }
                return result
            } catch (error) {
                Logger.warning(`[${this.name}] Existing request for journal ${journalId} failed, starting new request`)
            }
        }

        // Create new request promise
        const requestPromise = this.processJournal(journalId, linkElement)
        this.activeRequests.set(journalId, requestPromise)

        try {
            const result = await requestPromise
            return result
        } catch (error) {
            Logger.error(`[${this.name}] Error processing journal ${journalId}:`, error)
            return []
        } finally {
            // Clean up the active request
            this.activeRequests.delete(journalId)
        }
    }
}
