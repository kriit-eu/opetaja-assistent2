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
        this.currentJournalId = null
    }

    /**
     * Activate the feature when on journal edit page
     */
    async activate() {
        Logger.debug(`[${this.name}] Activating feature`)
        Logger.debug(`[${this.name}] Activating lesson discrepancies feature`)

        // Reset any previous state first
        this.reset()

        // Wait for page to be ready and create the discrepancies table
        await this.waitForPageReady()
        await this.createLessonDiscrepanciesTable()
    }

    /**
     * Extract journal ID from current URL
     */
    extractJournalId() {
        // Check both pathname and hash for journal ID
        const fullUrl = window.location.pathname + window.location.hash
        const hashUrl = window.location.hash
        const pathUrl = window.location.pathname

        Logger.debug(`[${this.name}] Extracting journal ID from URL:`, {
            fullUrl,
            hashUrl,
            pathUrl
        })

        // Try different URL patterns
        const patterns = [
            /\/journal\/(\d+)/,           // Standard pattern
            /journal\/(\d+)/,             // Without leading slash
            /#.*\/journal\/(\d+)/,        // In hash
            /journalId[=:](\d+)/i,        // Query parameter style
        ]

        for (const pattern of patterns) {
            // Check full URL first
            const fullMatch = fullUrl.match(pattern)
            if (fullMatch) {
                const journalId = parseInt(fullMatch[1])
                Logger.debug(`[${this.name}] Journal ID found via pattern ${pattern}: ${journalId}`)
                return journalId
            }

            // Check hash separately
            const hashMatch = hashUrl.match(pattern)
            if (hashMatch) {
                const journalId = parseInt(hashMatch[1])
                Logger.debug(`[${this.name}] Journal ID found in hash via pattern ${pattern}: ${journalId}`)
                return journalId
            }

            // Check pathname separately
            const pathMatch = pathUrl.match(pattern)
            if (pathMatch) {
                const journalId = parseInt(pathMatch[1])
                Logger.debug(`[${this.name}] Journal ID found in path via pattern ${pattern}: ${journalId}`)
                return journalId
            }
        }

        Logger.debug(`[${this.name}] No journal ID found in URL`)
        return null
    }

    /**
     * Create the lesson discrepancies table
     */
    async createLessonDiscrepanciesTable() {
        try {
            const journalId = this.extractJournalId()
            if (!journalId) {
                Logger.warning(`[${this.name}] No journal ID found in URL after waiting`)
                return
            }

            // Check if we already created a table for this journal ID
            if (this.tableCreated && this.currentJournalId === journalId) {
                Logger.debug(`[${this.name}] Table already created for journal ${journalId}, checking if still visible`)

                // Check if table is still visible on the page
                const existingTable = document.querySelector('[data-discrepancies-table]')
                if (existingTable) {
                    Logger.debug(`[${this.name}] Table still visible, skipping`)
                    return
                } else {
                    Logger.debug(`[${this.name}] Table not found on page, recreating`)
                    this.tableCreated = false
                }
            }

            Logger.info(`[${this.name}] Creating lesson discrepancies table for journal ${journalId}`)

            // Collect journal and timetable data
            const { journalData, timetableData } = await this.fetchJournalAndTimetableData(journalId)

            // Store journal data for later use in position matching
            this.lastJournalData = journalData

            // Compare and find discrepancies (now async)
            const discrepancies = await this.findLessonDiscrepancies(journalData, timetableData)

            if (discrepancies.length === 0) {
                Logger.debug(`[${this.name}] No lesson discrepancies found`)
                return
            }

            // Create and insert the discrepancies table
            const tableInserted = this.insertDiscrepanciesTable(discrepancies)

            if (tableInserted) {
                this.tableCreated = true
                this.currentJournalId = journalId
                Logger.info(`[${this.name}] Lesson discrepancies table successfully created and inserted with ${discrepancies.length} discrepancies`)
            } else {
                Logger.warning(`[${this.name}] Failed to insert discrepancies table`)
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error creating lesson discrepancies table:`, error)
        }
    }

    /**
     * Fetch both journal and timetable data with proper cache expiration
     */
    async fetchJournalAndTimetableData(journalId) {
        // Get journal info (basic info can be cached for 24 hours)
        const journalInfo = await this.api.tahvel.get(
            `/journals/${journalId}`,
            {},
            { cacheExpiration: 24 * 60 * 60 * 1000 } // 24 hours
        )

        // Get journal entries with allStudents=true to get all entries including those that might be filtered out
        // Journal entries should be cached for shorter time as they change frequently
        const journalEntries = await this.api.tahvel.get(
            `/journals/${journalId}/journalEntriesByDate`,
            { allStudents: true },
            { cacheExpiration: 60 * 60 * 1000 } // 1 hour
        )

        // Get timetable data using the old extension's API pattern with date-based caching
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
     * Fetch timetable data using old extension's API with date-based cache expiration
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

            // Determine cache expiration based on date range
            const now = new Date()
            const endDate = new Date(thruDate)
            let cacheExpiration

            if (endDate < now) {
                // Past timetable data: 30 days cache expiration
                cacheExpiration = 30 * 24 * 60 * 60 * 1000
            } else {
                // Future timetable data: 24 hours cache expiration
                cacheExpiration = 24 * 60 * 60 * 1000
            }

            const data = await this.api.tahvel.get(endpoint, {}, { cacheExpiration })

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

            if (schoolLessonTimes) {
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
            return {}
        }
    }

    /**
     * Calculate lesson number based on start time from timetable data
     */
    async calculateLessonNumber(timeStart, schoolId = 9) {
        // Fetch lesson times from local JSON
        const schoolLessonTimes = await this.fetchLessonTimes(schoolId)

        if (!timeStart || !schoolLessonTimes || schoolLessonTimes.length === 0) {
            return 1
        }

        // Get the lesson times (now just a simple array)
        const lessonTimes = schoolLessonTimes

        Logger.debug(`[${this.name}] Using lesson schedule for time ${timeStart}`)

        // First, try to find exact match
        for (const lessonTime of lessonTimes) {
            if (lessonTime.timeStart === timeStart) {
                console.log(`[${this.name}] Found exact match: ${timeStart} = lesson ${lessonTime.number}`)
                return lessonTime.number
            }
        }

        // If no exact match, find closest lesson time
        console.log(`[${this.name}] No exact match for ${timeStart}, finding closest match`)
        const eventTime = new Date(`2021-01-01T${timeStart}`).getTime()

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

        console.log(`[${this.name}] Closest match for ${timeStart}: lesson ${closestLesson.number} (${closestLesson.timeStart})`)
        return closestLesson.number
    }

    /**
     * Find discrepancies between journal entries and timetable
     */
    async findLessonDiscrepancies(journalData, timetableData) {
        Logger.debug(`[${this.name}] Starting lesson discrepancies analysis using enhanced logic`)
        Logger.debug(`[${this.name}] Analyzing ${journalData.entries.length} journal entries and ${timetableData.length} timetable entries`)

        // Initialize data structures following legacy pattern
        const lessonCounts = {} // Record<string, { journal: number; timetable: number }>
        const firstLessonStartNumbers = {} // Record<string, { journal: number; timetable: number }>
        const journalEntriesPerDate = {} // Record<string, JournalEntry[]> - NEW: Track all entries per date
        const differences = [] // AssistentJournalDifference[]

        // Process journal entries (equivalent to journal.entriesInJournal)
        for (const journalEntry of journalData.entries) {
            // Only process regular lesson entries (equivalent to lessonType !== LessonType.lesson check)
            if (journalEntry.entryType !== 'SISSEKANNE_T') {
                continue // Skip entries with entryType other than regular lesson
            }

            const date = this.formatDate(journalEntry.entryDate)

            // Initialize tracking objects for this date if not exists
            if (!firstLessonStartNumbers[date]) {
                firstLessonStartNumbers[date] = {
                    journal: Infinity,
                    timetable: Infinity
                }
            }
            if (!lessonCounts[date]) {
                lessonCounts[date] = { journal: 0, timetable: 0 }
            }
            if (!journalEntriesPerDate[date]) {
                journalEntriesPerDate[date] = []
            }

            // Add this entry to the date's entry list
            journalEntriesPerDate[date].push(journalEntry)

            // Add lesson count (equivalent to journalEntry.lessonCount)
            const lessonCount = journalEntry.lessons || 1
            lessonCounts[date].journal += lessonCount

            // Track first lesson start number (equivalent to journalEntry.firstLessonStartNumber)
            const firstLessonStartNumber = journalEntry.startLessonNr || 1
            if (firstLessonStartNumber < firstLessonStartNumbers[date].journal) {
                firstLessonStartNumbers[date].journal = firstLessonStartNumber
            }

            Logger.debug(`[${this.name}] Journal entry on ${date}: start=${firstLessonStartNumber}, count=${lessonCount}`)
        }

        // Process timetable entries (equivalent to journal.entriesInTimetable)
        for (const timetableEntry of timetableData) {
            const date = this.formatDate(timetableEntry.date)

            // Initialize tracking objects for this date if not exists
            if (!firstLessonStartNumbers[date]) {
                firstLessonStartNumbers[date] = {
                    journal: Infinity,
                    timetable: Infinity
                }
            }
            if (!lessonCounts[date]) {
                lessonCounts[date] = { journal: 0, timetable: 0 }
            }

            // Calculate lesson number from time (equivalent to timetableEntry.firstLessonStartNumber)
            const schoolId = journalData.info.school?.id || 9
            const firstLessonStartNumber = await this.calculateLessonNumber(timetableEntry.timeStart, schoolId)

            if (firstLessonStartNumber < firstLessonStartNumbers[date].timetable) {
                firstLessonStartNumbers[date].timetable = firstLessonStartNumber
            }

            // Each timetable entry represents one lesson (equivalent to lessonCounts[date].timetable++)
            lessonCounts[date].timetable++

            Logger.debug(`[${this.name}] Timetable entry on ${date}: start=${firstLessonStartNumber}, total_count=${lessonCounts[date].timetable}`)
        }

        // Compare lesson counts and first lesson start numbers for each date (enhanced logic)
        for (const date in lessonCounts) {
            if (
                date !== 'null' &&
                (lessonCounts[date].journal !== lessonCounts[date].timetable ||
                    firstLessonStartNumbers[date].journal !== firstLessonStartNumbers[date].timetable)
            ) {
                // Enhanced: Pass all journal entries for this date instead of just the first one
                const entriesForDate = journalEntriesPerDate[date] || []
                const journalEntryId = entriesForDate.length > 0 ? entriesForDate[0].id : 0

                differences.push({
                    date: date,
                    lessonType: 'lesson', // LessonType.lesson equivalent
                    timetableLessonCount: lessonCounts[date].timetable,
                    timetableFirstLessonStartNumber: firstLessonStartNumbers[date].timetable,
                    journalLessonCount: lessonCounts[date].journal,
                    journalFirstLessonStartNumber: firstLessonStartNumbers[date].journal,
                    journalEntryId: journalEntryId,
                    allJournalEntries: entriesForDate // NEW: Include all entries for smart handling
                })

                Logger.info(`[${this.name}] Found discrepancy on ${date}: journal(${lessonCounts[date].journal} lessons, start=${firstLessonStartNumbers[date].journal}) vs timetable(${lessonCounts[date].timetable} lessons, start=${firstLessonStartNumbers[date].timetable}), entries: ${entriesForDate.length}`)
            }
        }

        // Replace Infinity with 0 (legacy logic)
        differences.forEach((difference) => {
            if (difference.timetableFirstLessonStartNumber === Infinity) {
                difference.timetableFirstLessonStartNumber = 0
            }
            if (difference.journalFirstLessonStartNumber === Infinity) {
                difference.journalFirstLessonStartNumber = 0
            }
        })

        Logger.info(`[${this.name}] Found ${differences.length} lesson discrepancies using legacy logic`)

        // Convert enhanced differences to the expected output format for the table
        return this.convertEnhancedDifferencesToDiscrepancies(differences, journalData, timetableData)
    }

    /**
     * Convert enhanced AssistentJournalDifference[] to the expected discrepancies format
     */
    async convertEnhancedDifferencesToDiscrepancies(differences, journalData, timetableData) {
        const discrepancies = []

        for (const difference of differences) {
            const date = difference.date
            const timetableLessonCount = difference.timetableLessonCount
            const timetableFirstLessonStartNumber = difference.timetableFirstLessonStartNumber
            const journalLessonCount = difference.journalLessonCount
            const journalFirstLessonStartNumber = difference.journalFirstLessonStartNumber
            const allJournalEntries = difference.allJournalEntries || []

            // Find corresponding timetable entries for this date
            const timetableEntriesForDate = timetableData.filter(entry =>
                this.formatDate(entry.date) === date
            )

            // Determine the type of discrepancy and create appropriate entries
            if (journalLessonCount === 0 && timetableLessonCount > 0) {
                // Missing journal entries - all timetable lessons are missing
                await this.createMissingLessonDiscrepancies(
                    date, timetableEntriesForDate, journalData, discrepancies
                )
            } else if (journalLessonCount > 0 && timetableLessonCount > 0) {
                // Enhanced: Check if we should filter out redundant start lesson displays (Issue 1)
                const startLessonsMatch = journalFirstLessonStartNumber === timetableFirstLessonStartNumber
                const lessonCountsMatch = journalLessonCount === timetableLessonCount

                // Only create discrepancy if there's actually something to fix
                if (!startLessonsMatch || !lessonCountsMatch) {
                    // Lesson count or start number mismatch - need to fix existing entry
                    await this.createEnhancedLessonMismatchDiscrepancies(
                        date, difference, timetableEntriesForDate, journalData, discrepancies
                    )
                }
            }
            // Note: We don't handle journalLessonCount > 0 && timetableLessonCount === 0
            // as that would mean journal entries exist but no timetable - this is handled elsewhere
        }

        Logger.info(`[${this.name}] Converted ${differences.length} enhanced differences to ${discrepancies.length} discrepancies`)
        return discrepancies
    }

    /**
     * Convert legacy AssistentJournalDifference[] to the expected discrepancies format (kept for compatibility)
     */
    async convertLegacyDifferencesToDiscrepancies(differences, journalData, timetableData) {
        const discrepancies = []

        for (const difference of differences) {
            const date = difference.date
            const timetableLessonCount = difference.timetableLessonCount
            const timetableFirstLessonStartNumber = difference.timetableFirstLessonStartNumber
            const journalLessonCount = difference.journalLessonCount
            const journalFirstLessonStartNumber = difference.journalFirstLessonStartNumber
            const journalEntryId = difference.journalEntryId

            // Find corresponding timetable entries for this date
            const timetableEntriesForDate = timetableData.filter(entry =>
                this.formatDate(entry.date) === date
            )

            // Determine the type of discrepancy and create appropriate entries
            if (journalLessonCount === 0 && timetableLessonCount > 0) {
                // Missing journal entries - all timetable lessons are missing
                await this.createMissingLessonDiscrepancies(
                    date, timetableEntriesForDate, journalData, discrepancies
                )
            } else if (journalLessonCount > 0 && timetableLessonCount > 0) {
                // Lesson count or start number mismatch - need to fix existing entry
                await this.createLessonMismatchDiscrepancies(
                    date, difference, timetableEntriesForDate, journalData, discrepancies
                )
            }
            // Note: We don't handle journalLessonCount > 0 && timetableLessonCount === 0
            // as that would mean journal entries exist but no timetable - this is handled elsewhere
        }

        Logger.info(`[${this.name}] Converted ${differences.length} legacy differences to ${discrepancies.length} discrepancies`)
        return discrepancies
    }
    /**
     * Create missing lesson discrepancies for dates with no journal entries
     */
    async createMissingLessonDiscrepancies(date, timetableEntriesForDate, journalData, discrepancies) {
        const missingLessons = []

        for (const timetableEntry of timetableEntriesForDate) {
            const schoolId = journalData.info.school?.id || 9
            const lessonNumber = await this.calculateLessonNumber(timetableEntry.timeStart, schoolId)

            missingLessons.push({
                date: date,
                timeStart: timetableEntry.timeStart,
                timeEnd: timetableEntry.timeEnd,
                name: timetableEntry.nameEt || journalData.info.nameEt,
                rooms: timetableEntry.rooms || [],
                lessonNumber: lessonNumber,
                type: 'missing_journal_entry'
            })
        }

        // Group consecutive lessons
        const lessonNumbers = missingLessons.map(ml => ml.lessonNumber).sort((a, b) => a - b)
        const groupedLessons = this.groupConsecutiveLessons(lessonNumbers)

        for (const group of groupedLessons) {
            const firstLesson = group[0]
            const lessonCount = group.length
            const firstMissing = missingLessons.find(ml => ml.lessonNumber === firstLesson)

            discrepancies.push({
                ...firstMissing,
                lessonNumber: firstLesson,
                lessonCount: lessonCount,
                lessonNumbers: group,
                type: 'missing_journal_entry'
            })
        }
    }

    /**
     * Create enhanced lesson mismatch discrepancies for dates with incorrect journal entries
     */
    async createEnhancedLessonMismatchDiscrepancies(date, difference, timetableEntriesForDate, journalData, discrepancies) {
        const timetableLessonCount = difference.timetableLessonCount
        const timetableFirstLessonStartNumber = difference.timetableFirstLessonStartNumber
        const journalLessonCount = difference.journalLessonCount
        const journalFirstLessonStartNumber = difference.journalFirstLessonStartNumber
        const allJournalEntries = difference.allJournalEntries || []

        // Find the first timetable entry for this date to get basic info
        const firstTimetableEntry = timetableEntriesForDate[0]
        if (!firstTimetableEntry) return

        const startLessonsMatch = journalFirstLessonStartNumber === timetableFirstLessonStartNumber
        const lessonCountsMatch = journalLessonCount === timetableLessonCount

        if (!startLessonsMatch || !lessonCountsMatch) {
            // This is a mismatch that needs fixing
            if (timetableLessonCount === 1 && journalLessonCount === 1 && !startLessonsMatch) {
                // Single lesson fix - only when both have 1 lesson but different start numbers
                discrepancies.push({
                    date: date,
                    timeStart: firstTimetableEntry.timeStart,
                    timeEnd: firstTimetableEntry.timeEnd,
                    name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                    rooms: firstTimetableEntry.rooms || [],
                    lessonNumber: timetableFirstLessonStartNumber,
                    actualLessonNumber: journalFirstLessonStartNumber,
                    entryId: allJournalEntries[0]?.id || difference.journalEntryId,
                    type: 'wrong_lesson_number'
                })
            } else {
                // Enhanced multi-lesson fix with smart button logic
                await this.createSmartMultiLessonDiscrepancy(
                    date, difference, firstTimetableEntry, journalData, discrepancies
                )
            }
        }
    }

    /**
     * Create lesson mismatch discrepancies for dates with incorrect journal entries (legacy method)
     */
    async createLessonMismatchDiscrepancies(date, difference, timetableEntriesForDate, journalData, discrepancies) {
        const timetableLessonCount = difference.timetableLessonCount
        const timetableFirstLessonStartNumber = difference.timetableFirstLessonStartNumber
        const journalLessonCount = difference.journalLessonCount
        const journalFirstLessonStartNumber = difference.journalFirstLessonStartNumber
        const journalEntryId = difference.journalEntryId

        // Find the first timetable entry for this date to get basic info
        const firstTimetableEntry = timetableEntriesForDate[0]
        if (!firstTimetableEntry) return

        if (timetableLessonCount !== journalLessonCount ||
            timetableFirstLessonStartNumber !== journalFirstLessonStartNumber) {

            // This is a mismatch that needs fixing
            if (timetableLessonCount === 1 && journalLessonCount === 1 && timetableFirstLessonStartNumber !== journalFirstLessonStartNumber) {
                // Single lesson fix - only when both have 1 lesson but different start numbers
                discrepancies.push({
                    date: date,
                    timeStart: firstTimetableEntry.timeStart,
                    timeEnd: firstTimetableEntry.timeEnd,
                    name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                    rooms: firstTimetableEntry.rooms || [],
                    lessonNumber: timetableFirstLessonStartNumber,
                    actualLessonNumber: journalFirstLessonStartNumber,
                    entryId: journalEntryId,
                    type: 'wrong_lesson_number'
                })
            } else {
                // Multi-lesson fix - for any lesson count mismatch or start number mismatch with different counts
                const neededLessons = []
                for (let i = 0; i < timetableLessonCount; i++) {
                    neededLessons.push(timetableFirstLessonStartNumber + i)
                }

                discrepancies.push({
                    date: date,
                    timeStart: firstTimetableEntry.timeStart,
                    timeEnd: firstTimetableEntry.timeEnd,
                    name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                    rooms: firstTimetableEntry.rooms || [],
                    lessonNumber: `Algustund: ${timetableFirstLessonStartNumber}, Tundide arv: ${timetableLessonCount}`,
                    actualLessonNumber: `Algustund: ${journalFirstLessonStartNumber}, Tundide arv: ${journalLessonCount}`,
                    entryId: journalEntryId,
                    neededLessons: neededLessons,
                    originalLessonCount: timetableLessonCount,
                    correctStartLesson: timetableFirstLessonStartNumber,
                    type: 'multi_lesson_fix_needed'
                })
            }
        }
    }

    /**
     * Create smart multi-lesson discrepancy with intelligent button logic
     */
    async createSmartMultiLessonDiscrepancy(date, difference, firstTimetableEntry, journalData, discrepancies) {
        const timetableLessonCount = difference.timetableLessonCount
        const timetableFirstLessonStartNumber = difference.timetableFirstLessonStartNumber
        const journalLessonCount = difference.journalLessonCount
        const journalFirstLessonStartNumber = difference.journalFirstLessonStartNumber
        const allJournalEntries = difference.allJournalEntries || []

        const neededLessons = []
        for (let i = 0; i < timetableLessonCount; i++) {
            neededLessons.push(timetableFirstLessonStartNumber + i)
        }

        // Calculate total excess lessons
        const totalExcess = journalLessonCount - timetableLessonCount

        // Sort entries by lesson count (descending) to find the largest entry
        const sortedEntries = [...allJournalEntries].sort((a, b) => (b.lessons || 1) - (a.lessons || 1))
        const largestEntry = sortedEntries[0]
        const largestEntryLessonCount = largestEntry?.lessons || 1

        // Check if smart adjustment is possible (would result in >= 1 lessons)
        const canUseSmartAdjustment = totalExcess > 0 && (largestEntryLessonCount - totalExcess) >= 1

        if (canUseSmartAdjustment && allJournalEntries.length > 1) {
            // Smart single button approach
            const targetLessonCount = largestEntryLessonCount - totalExcess

            discrepancies.push({
                date: date,
                timeStart: firstTimetableEntry.timeStart,
                timeEnd: firstTimetableEntry.timeEnd,
                name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                rooms: firstTimetableEntry.rooms || [],
                lessonNumber: `Algustund: ${timetableFirstLessonStartNumber}, Tundide arv: ${timetableLessonCount}`,
                actualLessonNumber: `Algustund: ${journalFirstLessonStartNumber}, Tundide arv: ${journalLessonCount}`,
                entryId: largestEntry.id,
                neededLessons: neededLessons,
                originalLessonCount: timetableLessonCount,
                correctStartLesson: timetableFirstLessonStartNumber,
                smartTargetLessonCount: targetLessonCount, // NEW: Smart prefill count
                type: 'smart_multi_lesson_fix'
            })

            Logger.debug(`[${this.name}] Created smart single button for ${date}: largest entry ${largestEntry.id} (${largestEntryLessonCount} lessons) -> target ${targetLessonCount} lessons`)
        } else {
            // Multiple buttons approach or single entry
            if (allJournalEntries.length > 1) {
                // Multiple entries - create single discrepancy with multiple entries data
                discrepancies.push({
                    date: date,
                    timeStart: firstTimetableEntry.timeStart,
                    timeEnd: firstTimetableEntry.timeEnd,
                    name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                    rooms: firstTimetableEntry.rooms || [],
                    lessonNumber: `Algustund: ${timetableFirstLessonStartNumber}, Tundide arv: ${timetableLessonCount}`,
                    actualLessonNumber: `Algustund: ${journalFirstLessonStartNumber}, Tundide arv: ${journalLessonCount}`,
                    neededLessons: neededLessons,
                    originalLessonCount: timetableLessonCount,
                    correctStartLesson: timetableFirstLessonStartNumber,
                    multipleEntries: allJournalEntries.map(entry => ({
                        id: entry.id,
                        lessonCount: entry.lessons || 1,
                        startLesson: entry.startLessonNr || 1
                    })), // NEW: Array of all entries for this date
                    type: 'multi_entry_lesson_fix'
                })

                Logger.debug(`[${this.name}] Created single row with multiple buttons for ${date}: ${allJournalEntries.length} entries`)
            } else {
                // Single entry - use standard multi-lesson fix
                const entry = allJournalEntries[0] || { id: difference.journalEntryId }
                discrepancies.push({
                    date: date,
                    timeStart: firstTimetableEntry.timeStart,
                    timeEnd: firstTimetableEntry.timeEnd,
                    name: firstTimetableEntry.nameEt || journalData.info.nameEt,
                    rooms: firstTimetableEntry.rooms || [],
                    lessonNumber: `Algustund: ${timetableFirstLessonStartNumber}, Tundide arv: ${timetableLessonCount}`,
                    actualLessonNumber: `Algustund: ${journalFirstLessonStartNumber}, Tundide arv: ${journalLessonCount}`,
                    entryId: entry.id,
                    neededLessons: neededLessons,
                    originalLessonCount: timetableLessonCount,
                    correctStartLesson: timetableFirstLessonStartNumber,
                    type: 'multi_lesson_fix_needed'
                })

                Logger.debug(`[${this.name}] Created standard multi-lesson fix for ${date}: single entry ${entry.id}`)
            }
        }
    }

    /**
     * Group consecutive lesson numbers into arrays
     * Example: [4, 5, 7, 8] becomes [[4, 5], [7, 8]]
     */
    groupConsecutiveLessons(lessonNumbers) {
        if (lessonNumbers.length === 0) return []

        const sorted = [...lessonNumbers].sort((a, b) => a - b)
        const groups = []
        let currentGroup = [sorted[0]]

        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === sorted[i - 1] + 1) {
                // Consecutive lesson
                currentGroup.push(sorted[i])
            } else {
                // Non-consecutive, start new group
                groups.push(currentGroup)
                currentGroup = [sorted[i]]
            }
        }

        // Add the last group
        groups.push(currentGroup)

        return groups
    }

    /**
     * Insert the discrepancies table into the page
     */
    insertDiscrepanciesTable(discrepancies) {
        try {
            // Remove any existing table first
            const existingTable = document.querySelector('[data-discrepancies-table]')
            if (existingTable) {
                Logger.debug(`[${this.name}] Removing existing table`)
                existingTable.remove()
            }

            // Find insertion point
            const insertionPoint = this.findInsertionPoint()
            if (!insertionPoint) {
                Logger.warning(`[${this.name}] Could not find insertion point`)
                return false
            }

            Logger.debug(`[${this.name}] Found insertion point:`, insertionPoint.tagName, insertionPoint.className)

            // Create table
            const table = this.createDiscrepanciesTableElement(discrepancies)

            // Add identifier to the table for easy detection
            table.setAttribute('data-discrepancies-table', 'true')

            // Insert into page at the top
            insertionPoint.insertBefore(table, insertionPoint.firstChild)

            // Verify the table was actually inserted
            const insertedTable = document.querySelector('[data-discrepancies-table]')
            if (!insertedTable) {
                Logger.error(`[${this.name}] Table was not successfully inserted into DOM`)
                return false
            }

            Logger.debug(`[${this.name}] Table successfully inserted into DOM`)

            // Add event listeners for "Lisa" buttons
            this.addMissingEntryButtonListeners()

            // Add event listeners for "Muuda" buttons
            this.addEditEntryButtonListeners()

            Logger.debug(`[${this.name}] Discrepancies table inserted into page`)
            return true

        } catch (error) {
            Logger.error(`[${this.name}] Error inserting discrepancies table:`, error)
            return false
        }
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
            '#main-content',
            '.main-content',
            'main',
            'body'
        ]

        for (const selector of selectors) {
            const element = document.querySelector(selector)
            if (element) {
                // Additional check to make sure the element is visible and has reasonable dimensions
                const rect = element.getBoundingClientRect()
                if (rect.width > 100 && rect.height > 100) {
                    Logger.debug(`[${this.name}] Found suitable insertion point: ${selector}`, {
                        tagName: element.tagName,
                        className: element.className,
                        id: element.id,
                        dimensions: { width: rect.width, height: rect.height }
                    })
                    return element
                } else {
                    Logger.debug(`[${this.name}] Found element but too small: ${selector}`, rect)
                }
            }
        }

        Logger.warning(`[${this.name}] No suitable insertion point found, falling back to body`)
        return document.body
    }

    /**
     * Create the HTML table element for discrepancies
     */
    createDiscrepanciesTableElement(discrepancies) {
        // Separate different types of discrepancies (including new types)
        const missingEntries = discrepancies.filter(d => d.type === 'missing_journal_entry')
        const wrongNumbers = discrepancies.filter(d => d.type === 'wrong_lesson_number')
        const multiLessonFixes = discrepancies.filter(d => d.type === 'multi_lesson_fix_needed')
        const smartMultiLessonFixes = discrepancies.filter(d => d.type === 'smart_multi_lesson_fix')
        const multiEntryLessonFixes = discrepancies.filter(d => d.type === 'multi_entry_lesson_fix')

        // Combine all discrepancies into one sorted list
        const allDiscrepancies = [...missingEntries, ...wrongNumbers, ...multiLessonFixes, ...smartMultiLessonFixes, ...multiEntryLessonFixes].sort((a, b) => {
            const dateA = new Date(a.date)
            const dateB = new Date(b.date)
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB
            }
            const lessonA = a.type.includes('multi') ? a.neededLessons[0] : a.lessonNumber
            const lessonB = b.type.includes('multi') ? b.neededLessons[0] : b.lessonNumber
            return lessonA - lessonB
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

        let content = `
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <span style="font-size: 20px; margin-right: 10px;">⚠️</span>
                <h3 style="margin: 0; color: #856404;">Tunnisissekannete probleemid (${discrepancies.length})</h3>
            </div>
            <table style="width: 100%; border-collapse: collapse; background: white;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kuupäev</th>
                        <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Algustund</th>
                        <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tundide arv</th>
                        <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tegevus</th>
                    </tr>
                </thead>
                <tbody>
                    ${allDiscrepancies.map(discrepancy => {
            if (discrepancy.type === 'missing_journal_entry') {
                // Use the new grouped lesson information
                const lessonNumbers = discrepancy.lessonNumbers || [discrepancy.lessonNumber]
                const startLesson = discrepancy.lessonNumber
                const lessonCount = discrepancy.lessonCount || 1

                const buttonId = `add-missing-${discrepancy.date.replace(/\./g, '-')}-${startLesson}`

                return `
                                <tr style="background: #f8f9fa;">
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center; font-size: 14px; font-weight: bold;">${startLesson}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center; font-size: 14px; font-weight: bold;">${lessonCount}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <button
                                            id="${buttonId}"
                                            data-date="${discrepancy.date}"
                                            data-lessons="${lessonNumbers.join(',')}"
                                            data-start-lesson="${startLesson}"
                                            data-lesson-count="${lessonCount}"
                                            style="
                                                background: #28a745;
                                                color: white;
                                                border: none;
                                                padding: 4px 8px;
                                                border-radius: 3px;
                                                font-size: 12px;
                                                cursor: pointer;
                                                font-weight: bold;
                                            "
                                            onmouseover="this.style.background='#218838'"
                                            onmouseout="this.style.background='#28a745'"
                                        >
                                            Lisa
                                        </button>
                                    </td>
                                </tr>`
            } else if (discrepancy.type === 'smart_multi_lesson_fix') {
                // Smart multi-lesson fix with intelligent prefilling
                const buttonId = `edit-smart-${discrepancy.date.replace(/\./g, '-')}-${discrepancy.entryId}`
                const currentStartLesson = parseInt(discrepancy.actualLessonNumber.match(/Algustund: (\d+)/)?.[1] || 1)
                const currentLessonCount = parseInt(discrepancy.actualLessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)
                const correctStartLesson = discrepancy.correctStartLesson || parseInt(discrepancy.lessonNumber.match(/Algustund: (\d+)/)?.[1] || discrepancy.neededLessons[0])
                const correctLessonCount = discrepancy.originalLessonCount !== undefined ? discrepancy.originalLessonCount : parseInt(discrepancy.lessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)

                // Enhanced display logic - Issue 1 fix: Only show differences when they exist
                const startLessonDisplay = currentStartLesson !== correctStartLesson
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentStartLesson}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctStartLesson}</span>`
                    : `<span style="font-size: 14px;">${correctStartLesson}</span>`

                const lessonCountDisplay = currentLessonCount !== correctLessonCount
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentLessonCount}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctLessonCount}</span>`
                    : `<span style="font-size: 14px;">${correctLessonCount}</span>`

                return `
                                <tr style="background: #fff2e6;">
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${startLessonDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${lessonCountDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <button
                                            id="${buttonId}"
                                            data-date="${discrepancy.date}"
                                            data-entry-id="${discrepancy.entryId}"
                                            data-current="${discrepancy.actualLessonNumber}"
                                            data-correct="${discrepancy.lessonNumber}"
                                            data-type="smart_multi_lesson_fix"
                                            data-lessons="${discrepancy.neededLessons.join(',')}"
                                            data-smart-target="${discrepancy.smartTargetLessonCount}"
                                            style="
                                                background: #17a2b8;
                                                color: white;
                                                border: none;
                                                padding: 4px 8px;
                                                border-radius: 3px;
                                                font-size: 12px;
                                                cursor: pointer;
                                                font-weight: bold;
                                            "
                                            onmouseover="this.style.background='#138496'"
                                            onmouseout="this.style.background='#17a2b8'"
                                        >
                                            Muuda
                                        </button>
                                    </td>
                                </tr>`
            } else if (discrepancy.type === 'multi_entry_lesson_fix') {
                // Multiple entry lesson fix - show multiple buttons in single row
                const currentStartLesson = parseInt(discrepancy.actualLessonNumber.match(/Algustund: (\d+)/)?.[1] || 1)
                const currentLessonCount = parseInt(discrepancy.actualLessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)
                const correctStartLesson = discrepancy.correctStartLesson || parseInt(discrepancy.lessonNumber.match(/Algustund: (\d+)/)?.[1] || discrepancy.neededLessons[0])
                const correctLessonCount = discrepancy.originalLessonCount !== undefined ? discrepancy.originalLessonCount : parseInt(discrepancy.lessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)

                // Enhanced display logic - Issue 1 fix: Only show differences when they exist
                const startLessonDisplay = currentStartLesson !== correctStartLesson
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentStartLesson}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctStartLesson}</span>`
                    : `<span style="font-size: 14px;">${correctStartLesson}</span>`

                const lessonCountDisplay = currentLessonCount !== correctLessonCount
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentLessonCount}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctLessonCount}</span>`
                    : `<span style="font-size: 14px;">${correctLessonCount}</span>`

                // Generate multiple buttons for each entry
                const multipleEntries = discrepancy.multipleEntries || []
                const buttonsHtml = multipleEntries.map(entry => {
                    const buttonId = `edit-entry-${discrepancy.date.replace(/\./g, '-')}-${entry.id}`
                    return `<button
                                id="${buttonId}"
                                data-date="${discrepancy.date}"
                                data-entry-id="${entry.id}"
                                data-current="${discrepancy.actualLessonNumber}"
                                data-correct="${discrepancy.lessonNumber}"
                                data-type="multi_entry_lesson_fix"
                                data-lessons="${discrepancy.neededLessons.join(',')}"
                                data-entry-lesson-count="${entry.lessonCount}"
                                style="
                                    background: #6c757d;
                                    color: white;
                                    border: none;
                                    padding: 4px 8px;
                                    border-radius: 3px;
                                    font-size: 12px;
                                    cursor: pointer;
                                    font-weight: bold;
                                    margin-right: 4px;
                                "
                                onmouseover="this.style.background='#5a6268'"
                                onmouseout="this.style.background='#6c757d'"
                            >
                                Muuda (${entry.lessonCount})
                            </button>`
                }).join('')

                return `
                                <tr style="background: #fff2e6;">
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${startLessonDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${lessonCountDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        ${buttonsHtml}
                                    </td>
                                </tr>`
            } else if (discrepancy.type === 'multi_lesson_fix_needed') {
                // Legacy multi-lesson fix
                const buttonId = `edit-multi-${discrepancy.date.replace(/\./g, '-')}-${discrepancy.entryId}`
                const currentStartLesson = parseInt(discrepancy.actualLessonNumber.match(/Algustund: (\d+)/)?.[1] || 1)
                const currentLessonCount = parseInt(discrepancy.actualLessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)
                const correctStartLesson = discrepancy.correctStartLesson || parseInt(discrepancy.lessonNumber.match(/Algustund: (\d+)/)?.[1] || discrepancy.neededLessons[0])
                const correctLessonCount = discrepancy.originalLessonCount !== undefined ? discrepancy.originalLessonCount : parseInt(discrepancy.lessonNumber.match(/Tundide arv: (\d+)/)?.[1] || 1)

                // Enhanced display logic - Issue 1 fix: Only show differences when they exist
                const startLessonDisplay = currentStartLesson !== correctStartLesson
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentStartLesson}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctStartLesson}</span>`
                    : `<span style="font-size: 14px;">${correctStartLesson}</span>`

                const lessonCountDisplay = currentLessonCount !== correctLessonCount
                    ? `<span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${currentLessonCount}</span>
                       <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${correctLessonCount}</span>`
                    : `<span style="font-size: 14px;">${correctLessonCount}</span>`

                return `
                                <tr style="background: #fff2e6;">
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${startLessonDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">${lessonCountDisplay}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <button
                                            id="${buttonId}"
                                            data-date="${discrepancy.date}"
                                            data-entry-id="${discrepancy.entryId}"
                                            data-current="${discrepancy.actualLessonNumber}"
                                            data-correct="${discrepancy.lessonNumber}"
                                            data-type="multi_lesson_fix"
                                            data-lessons="${discrepancy.neededLessons.join(',')}"
                                            style="
                                                background: #ffc107;
                                                color: #212529;
                                                border: none;
                                                padding: 4px 8px;
                                                border-radius: 3px;
                                                font-size: 12px;
                                                cursor: pointer;
                                                font-weight: bold;
                                            "
                                            onmouseover="this.style.background='#e0a800'"
                                            onmouseout="this.style.background='#ffc107'"
                                        >
                                            Muuda
                                        </button>
                                    </td>
                                </tr>`
            } else {
                // Single lesson fix (wrong_lesson_number)
                const buttonId = `edit-single-${discrepancy.date.replace(/\./g, '-')}-${discrepancy.entryId}`
                return `
                                <tr style="background: #fff2e6;">
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <span style="background-color: #f8d7da; color: #721c24; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${discrepancy.actualLessonNumber}</span>
                                        <span style="background-color: #d1edcc; color: #155724; font-weight: bold; font-size: 14px; padding: 2px 4px; border-radius: 3px;">${discrepancy.lessonNumber}</span>
                                    </td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <span style="font-size: 14px;">1</span>
                                    </td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <button
                                            id="${buttonId}"
                                            data-date="${discrepancy.date}"
                                            data-entry-id="${discrepancy.entryId}"
                                            data-current="${discrepancy.actualLessonNumber}"
                                            data-correct="${discrepancy.lessonNumber}"
                                            data-type="single_lesson_fix"
                                            style="
                                                background: #ffc107;
                                                color: #212529;
                                                border: none;
                                                padding: 4px 8px;
                                                border-radius: 3px;
                                                font-size: 12px;
                                                cursor: pointer;
                                                font-weight: bold;
                                            "
                                            onmouseover="this.style.background='#e0a800'"
                                            onmouseout="this.style.background='#ffc107'"
                                        >
                                            Muuda
                                        </button>
                                    </td>
                                </tr>`
            }
        }).filter(row => row !== '').join('')}
                </tbody>
            </table>`

        container.innerHTML = content
        return container
    }

    /**
     * Get the start time for a specific lesson number
     */
    async getLessonTimeForNumber(lessonNumber, schoolId = 9) {
        const schoolLessonTimes = await this.fetchLessonTimes(schoolId)

        if (!schoolLessonTimes || schoolLessonTimes.length === 0) {
            return null
        }

        // Get the lesson times (now just a simple array)
        const lessonTimes = schoolLessonTimes

        const lessonTime = lessonTimes.find(lt => lt.number === lessonNumber)
        return lessonTime ? lessonTime.timeStart : null
    }

    /**
     * Check if two times are close enough to be considered the same lesson
     */
    timesAreClose(time1, time2, toleranceMinutes = 15) {
        if (!time1 || !time2) return false

        const date1 = new Date(`2021-01-01T${time1}`)
        const date2 = new Date(`2021-01-01T${time2}`)

        const diffMs = Math.abs(date1.getTime() - date2.getTime())
        const diffMinutes = diffMs / (1000 * 60)

        return diffMinutes <= toleranceMinutes
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

    /**
     * Handle adding missing journal entries
     */
    async handleAddMissingEntry(date, lessonNumbers, startLesson, lessonCount) {
        Logger.info(`[${this.name}] Adding missing entry for date: ${date}, start lesson: ${startLesson}, lesson count: ${lessonCount}`)

        try {
            // Try to automatically open the add entry form and fill it out
            await this.openAndFillAddEntryForm(date, startLesson, lessonCount)
        } catch (error) {
            Logger.error(`[${this.name}] Error opening add entry form:`, error)

            // Fallback to instructions if automation fails
            const formattedDate = this.formatDisplayDate(date)
            const lessonsText = lessonCount === 1 ? `tund ${startLesson}` : `${lessonCount} tundi alates ${startLesson}. tunnist`
            alert(`Lisa sissekanne kuupäevale ${formattedDate} (${lessonsText})\n\nJuhised:\n1. Ava päeviku sissekannete leht\n2. Lisa uus sissekanne\n3. Määra õige kuupäev: ${formattedDate}\n4. Määra algustund: ${startLesson}\n5. Määra tundide arv: ${lessonCount}`)
        }
    }

    /**
     * Open and fill the add entry form automatically
     */
    async openAndFillAddEntryForm(date, startLesson, lessonCount) {
        Logger.debug(`[${this.name}] Attempting to open and fill add entry form`)

        // First, try to find and click the "Lisa sissekanne" button
        const addButton = await this.findAndClickAddButton()
        if (!addButton) {
            throw new Error('Could not find "Lisa sissekanne" button')
        }

        // Wait for the form to open
        await this.waitForFormToOpen()

        // Fill out the form fields
        await this.fillEntryForm(date, startLesson, lessonCount)

        Logger.info(`[${this.name}] Successfully opened and filled add entry form`)
    }

    /**
     * Find and click the "Lisa sissekanne" button
     */
    async findAndClickAddButton() {
        // Common selectors for the add entry button
        // Exclude our own discrepancies table buttons
        const selectors = [
            'button[ng-click*="addEntry"]',
            'button[ng-click*="lisa"]:not([id^="add-missing-"])',
            'md-button[ng-click*="addEntry"]',
            'md-button[ng-click*="lisa"]:not([id^="add-missing-"])',
            'button[ng-click*="addJournalEntry"]',
            'md-button[ng-click*="addJournalEntry"]',
            '[aria-label*="Lisa sissekanne"]',
            '[aria-label*="Add entry"]',
            '.add-entry-button',
            '.lisa-sissekanne',
            '.add-journal-entry'
        ]

        for (const selector of selectors) {
            const button = document.querySelector(selector)

            if (button && this.isElementVisible(button) && !this.isOurDiscrepanciesButton(button)) {
                Logger.debug(`[${this.name}] Found add button using selector: ${selector}`)

                // Scroll into view and click
                button.scrollIntoView({ behavior: 'smooth', block: 'center' })
                await this.delay(300)

                button.click()
                await this.delay(500) // Wait for click to register

                return button
            }
        }

        // If no button found with selectors, try to find by text content
        // but exclude our own buttons
        const allButtons = document.querySelectorAll('button, md-button, [role="button"]')
        const addButton = Array.from(allButtons).find(btn => {
            // Skip if it's one of our discrepancies buttons
            if (this.isOurDiscrepanciesButton(btn)) {
                return false
            }

            const text = btn.textContent.trim().toLowerCase()
            return (text.includes('lisa') && text.includes('sissekanne')) ||
                (text === 'lisa sissekanne') ||
                (text.includes('add') && text.includes('entry'))
        })

        if (addButton) {
            Logger.debug(`[${this.name}] Found add button by text content`)
            addButton.scrollIntoView({ behavior: 'smooth', block: 'center' })
            await this.delay(300)
            addButton.click()
            await this.delay(500)
            return addButton
        }

        return null
    }

    /**
     * Check if a button is one of our discrepancies table buttons
     */
    isOurDiscrepanciesButton(button) {
        if (!button) return false

        // Check if it has our button ID pattern
        if (button.id && button.id.startsWith('add-missing-')) {
            return true
        }

        // Check if it's inside our discrepancies table
        const discrepanciesTable = button.closest('[data-discrepancies-table]')
        if (discrepanciesTable) {
            return true
        }

        // Check if it has our specific data attributes
        if (button.hasAttribute('data-date') && button.hasAttribute('data-lessons')) {
            return true
        }

        return false
    }

    /**
     * Wait for the add entry form to open
     */
    async waitForFormToOpen(maxAttempts = 20, intervalMs = 250) {
        Logger.debug(`[${this.name}] Waiting for add entry form to open`)

        return new Promise((resolve, reject) => {
            let attempts = 0

            const checkForm = () => {
                attempts++

                // Look for form indicators
                const formSelectors = [
                    'md-dialog',
                    '.modal',
                    '.dialog',
                    'form[name*="entry"]',
                    'form[name*="sissekanne"]',
                    '[ng-form*="entry"]',
                    'md-card[ng-if*="showAddForm"]',
                    '.add-entry-form',
                    '.entry-form'
                ]

                let formFound = false
                for (const selector of formSelectors) {
                    const form = document.querySelector(selector)
                    if (form && this.isElementVisible(form)) {
                        Logger.debug(`[${this.name}] Form opened, found using selector: ${selector}`)
                        formFound = true
                        break
                    }
                }

                if (formFound || attempts >= maxAttempts) {
                    if (formFound) {
                        resolve()
                    } else {
                        reject(new Error(`Form did not open after ${maxAttempts} attempts`))
                    }
                    return
                }

                Logger.debug(`[${this.name}] Waiting for form to open, attempt ${attempts}/${maxAttempts}`)
                setTimeout(checkForm, intervalMs)
            }

            checkForm()
        })
    }

    /**
     * Fill out the entry form with the provided data
     */
    async fillEntryForm(date, startLesson, lessonCount) {
        Logger.debug(`[${this.name}] Filling entry form with date: ${date}, start lesson: ${startLesson}, lesson count: ${lessonCount}`)

        const formattedDate = this.formatDisplayDate(date)

        // Fill entry type (Sissekande liik) - set to "Tund"
        await this.fillEntryTypeField()

        // Fill date field
        await this.fillDateField(formattedDate)

        // Fill start lesson number
        await this.fillStartLessonField(startLesson)

        // Fill lesson count
        await this.fillLessonCountField(lessonCount)

        // Check "Auditoorne õpe" checkbox
        await this.checkAuditoriumLearningCheckbox()

        Logger.info(`[${this.name}] Form filled successfully - Entry type: Tund, Date: ${formattedDate}, Start lesson: ${startLesson}, Count: ${lessonCount}, Auditoorne õpe: checked`)
    }

    /**
     * Fill the entry type field (Sissekande liik) - set to "Tund"
     */
    async fillEntryTypeField() {
        const entryTypeSelectors = [
            'md-select[ng-model="journalEntry.entryType"]',
            'md-select[ng-model*="entryType"]',
            'select[ng-model="journalEntry.entryType"]',
            'select[ng-model*="entryType"]',
            'md-select[aria-label*="Sissekande liik"]',
            'md-select[aria-label*="Entry type"]'
        ]

        for (const selector of entryTypeSelectors) {
            const field = document.querySelector(selector)
            if (field && this.isElementVisible(field)) {
                Logger.debug(`[${this.name}] Found entry type field using selector: ${selector}`)

                if (field.tagName.toLowerCase() === 'md-select') {
                    // Try different values that might represent "Tund" (Lesson)
                    const possibleValues = [
                        'SISSEKANNE_T',  // This is likely the actual value based on the ng-required condition
                        'Tund',
                        'TUND',
                        'Lesson',
                        'LESSON'
                    ]

                    for (const value of possibleValues) {
                        const success = await this.selectMdSelectOption(field, value)
                        if (success) {
                            Logger.debug(`[${this.name}] Successfully selected entry type: ${value}`)
                            return
                        }
                    }

                    Logger.warning(`[${this.name}] Could not select any entry type value`)
                } else {
                    await this.selectOption(field, 'SISSEKANNE_T')
                }
                return
            }
        }

        Logger.warning(`[${this.name}] Could not find entry type field`)
    }

    /**
     * Fill the date field in the form
     */
    async fillDateField(dateString) {
        const dateSelectors = [
            'input[ng-model*="date"]',
            'input[ng-model*="Date"]',
            'input[name*="date"]',
            'input[name*="Date"]',
            'input[type="date"]',
            'md-datepicker input',
            '.date-input input',
            'input[placeholder*="kuupäev"]',
            'input[placeholder*="date"]'
        ]

        for (const selector of dateSelectors) {
            const field = document.querySelector(selector)
            if (field && this.isElementVisible(field)) {
                Logger.debug(`[${this.name}] Found date field using selector: ${selector}`)

                // Clear and set the date
                field.focus()
                await this.delay(100)
                field.value = ''
                await this.delay(100)

                // Try different date formats
                const formats = [
                    dateString, // DD.MM.YYYY
                    dateString.split('.').reverse().join('-'), // YYYY-MM-DD
                    dateString.split('.').join('/') // DD/MM/YYYY
                ]

                for (const format of formats) {
                    field.value = format
                    field.dispatchEvent(new Event('input', { bubbles: true }))
                    field.dispatchEvent(new Event('change', { bubbles: true }))
                    await this.delay(200)

                    // Check if the value stuck
                    if (field.value === format) {
                        Logger.debug(`[${this.name}] Date field filled successfully with format: ${format}`)
                        return
                    }
                }

                // If no format worked, try typing it
                await this.typeInField(field, dateString)
                return
            }
        }

        Logger.warning(`[${this.name}] Could not find date field`)
    }

    /**
     * Fill the start lesson number field
     */
    async fillStartLessonField(lessonNumber) {
        const lessonSelectors = [
            'md-select[ng-model="journalEntry.startLessonNr"]',
            'md-select[aria-label="Algustund"]',
            'md-select[ng-model*="startLessonNr"]',
            'md-select[ng-model*="startLesson"]',
            'md-select[ng-model*="algustund"]',
            'input[ng-model*="startLesson"]',
            'input[ng-model*="algustund"]',
            'input[name*="startLesson"]',
            'input[name*="algustund"]',
            'select[ng-model*="startLesson"]',
            'select[ng-model*="algustund"]',
            'input[placeholder*="algustund"]',
            'input[placeholder*="start"]'
        ]

        for (const selector of lessonSelectors) {
            const field = document.querySelector(selector)
            if (field && this.isElementVisible(field)) {
                Logger.debug(`[${this.name}] Found start lesson field using selector: ${selector}`)

                if (field.tagName.toLowerCase() === 'md-select') {
                    await this.selectMdSelectOption(field, lessonNumber.toString())
                } else if (field.tagName.toLowerCase() === 'select') {
                    await this.selectOption(field, lessonNumber.toString())
                } else {
                    await this.fillInputField(field, lessonNumber.toString())
                }
                return
            }
        }

        Logger.warning(`[${this.name}] Could not find start lesson field`)
    }

    /**
     * Fill the lesson count field
     */
    async fillLessonCountField(lessonCount) {
        const countSelectors = [
            'md-select[ng-model*="lessons"]',
            'md-select[ng-model*="count"]',
            'md-select[ng-model*="tundide"]',
            'md-select[ng-model*="arv"]',
            'input[ng-model*="lessons"]',
            'input[ng-model*="count"]',
            'input[ng-model*="tundide"]',
            'input[ng-model*="arv"]',
            'input[name*="lessons"]',
            'input[name*="count"]',
            'input[name*="tundide"]',
            'input[name*="arv"]',
            'select[ng-model*="lessons"]',
            'select[ng-model*="count"]',
            'input[placeholder*="tundide arv"]',
            'input[placeholder*="count"]'
        ]

        for (const selector of countSelectors) {
            const field = document.querySelector(selector)
            if (field && this.isElementVisible(field)) {
                Logger.debug(`[${this.name}] Found lesson count field using selector: ${selector}`)

                if (field.tagName.toLowerCase() === 'md-select') {
                    await this.selectMdSelectOption(field, lessonCount.toString())
                } else if (field.tagName.toLowerCase() === 'select') {
                    await this.selectOption(field, lessonCount.toString())
                } else {
                    await this.fillInputField(field, lessonCount.toString())
                }
                return
            }
        }

        Logger.warning(`[${this.name}] Could not find lesson count field`)
    }

    /**
     * Fill an input field with a value
     */
    async fillInputField(field, value) {
        field.focus()
        await this.delay(100)

        field.value = ''
        field.dispatchEvent(new Event('input', { bubbles: true }))
        await this.delay(100)

        field.value = value
        field.dispatchEvent(new Event('input', { bubbles: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
        field.dispatchEvent(new Event('blur', { bubbles: true }))

        await this.delay(200)
        Logger.debug(`[${this.name}] Field filled with value: ${value}`)
    }

    /**
     * Select an option in a select or md-select field
     */
    async selectOption(field, value) {
        // Handle regular select
        field.value = value
        field.dispatchEvent(new Event('change', { bubbles: true }))
        await this.delay(200)
        Logger.debug(`[${this.name}] Selected value: ${value}`)
    }

    /**
     * Select an option in an Angular Material md-select field
     */
    async selectMdSelectOption(field, value) {
        try {
            Logger.debug(`[${this.name}] Attempting to select option "${value}" in md-select`)

            // Focus on the field first
            field.focus()
            await this.delay(200)

            // Click to open the dropdown
            field.click()
            await this.delay(500) // Wait for dropdown to open

            // Look for the dropdown options in various possible containers
            const optionContainers = [
                'md-select-menu',
                '.md-select-menu-container',
                'md-content[role="listbox"]',
                '[aria-owns*="select_listbox"]',
                '.md-virtual-repeat-container'
            ]

            let options = []
            for (const containerSelector of optionContainers) {
                const container = document.querySelector(containerSelector)
                if (container && this.isElementVisible(container)) {
                    options = container.querySelectorAll('md-option, .md-option, [role="option"]')
                    if (options.length > 0) {
                        Logger.debug(`[${this.name}] Found ${options.length} options in container: ${containerSelector}`)
                        break
                    }
                }
            }

            // If no container found, try to find options globally
            if (options.length === 0) {
                options = document.querySelectorAll('md-option, .md-option, [role="option"]')
                Logger.debug(`[${this.name}] Found ${options.length} options globally`)
            }

            // Find the option that matches our value
            let targetOption = null
            for (const option of options) {
                if (!this.isElementVisible(option)) continue

                const optionText = option.textContent.trim()
                const optionValue = option.getAttribute('value') || option.getAttribute('ng-value')

                Logger.debug(`[${this.name}] Checking option: text="${optionText}", value="${optionValue}"`)

                // Try multiple matching strategies
                if (optionText === value ||
                    optionValue === value ||
                    optionText === value.toString() ||
                    optionValue === value.toString() ||
                    parseInt(optionText) === parseInt(value)) {
                    targetOption = option
                    break
                }
            } if (targetOption) {
                Logger.debug(`[${this.name}] Found matching option, clicking it`)

                // Scroll the option into view within its container
                targetOption.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                await this.delay(200)

                // Click the option
                targetOption.click()
                await this.delay(300)

                // Verify the selection worked by checking if the dropdown closed
                // and if the field's model was updated
                const isDropdownOpen = document.querySelector('md-select-menu, .md-select-menu-container')
                if (!isDropdownOpen || !this.isElementVisible(isDropdownOpen)) {
                    Logger.debug(`[${this.name}] Successfully selected option: ${value}`)
                } else {
                    Logger.warning(`[${this.name}] Dropdown still open, selection may have failed`)
                }

                // Try to trigger change events
                field.dispatchEvent(new Event('change', { bubbles: true }))
                field.dispatchEvent(new Event('blur', { bubbles: true }))

                return true
            } else {
                Logger.warning(`[${this.name}] Could not find option with value: ${value}`)
                Logger.debug(`[${this.name}] Available options:`, Array.from(options).map(opt => ({
                    text: opt.textContent.trim(),
                    value: opt.getAttribute('value') || opt.getAttribute('ng-value')
                })))

                // Close the dropdown by clicking elsewhere
                document.body.click()
                await this.delay(200)

                return false
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error selecting md-select option:`, error)

            // Try to close any open dropdown
            try {
                document.body.click()
                await this.delay(200)
            } catch (e) {
                // Ignore cleanup errors
            }

            return false
        }
    }

    /**
     * Type text into a field character by character
     */
    async typeInField(field, text) {
        field.focus()
        await this.delay(100)

        field.value = ''
        for (const char of text) {
            field.value += char
            field.dispatchEvent(new Event('input', { bubbles: true }))
            await this.delay(50)
        }

        field.dispatchEvent(new Event('change', { bubbles: true }))
        field.dispatchEvent(new Event('blur', { bubbles: true }))
        await this.delay(200)
    }

    /**
     * Check if an element is visible
     */
    isElementVisible(element) {
        if (!element) return false

        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)

        return rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
    }

    /**
     * Simple delay utility
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Add event listeners for missing entry buttons
     */
    addMissingEntryButtonListeners() {
        // Find all "Lisa" buttons and add event listeners
        const buttons = document.querySelectorAll('button[id^="add-missing-"]')
        buttons.forEach(button => {
            button.addEventListener('click', async (event) => {
                // Prevent event bubbling
                event.preventDefault()
                event.stopPropagation()

                const clickedButton = event.target
                const date = clickedButton.getAttribute('data-date')
                const lessonsStr = clickedButton.getAttribute('data-lessons')
                const startLesson = parseInt(clickedButton.getAttribute('data-start-lesson'))
                const lessonCount = parseInt(clickedButton.getAttribute('data-lesson-count'))
                const lessonNumbers = lessonsStr.split(',').map(n => parseInt(n.trim()))

                // Only disable and process the clicked button
                if (clickedButton.disabled) {
                    Logger.debug(`[${this.name}] Button already processing, ignoring click`)
                    return
                }

                // Disable only this button to prevent multiple clicks
                clickedButton.disabled = true
                const originalText = clickedButton.textContent
                clickedButton.textContent = 'Töötlen...'
                clickedButton.style.background = '#6c757d' // Gray color when disabled

                try {
                    Logger.debug(`[${this.name}] Processing button for date: ${date}`)
                    await this.handleAddMissingEntry(date, lessonNumbers, startLesson, lessonCount)
                } catch (error) {
                    Logger.error(`[${this.name}] Error processing button:`, error)
                } finally {
                    // Re-enable only this button after processing
                    setTimeout(() => {
                        clickedButton.disabled = false
                        clickedButton.textContent = originalText
                        clickedButton.style.background = '#28a745' // Restore original color
                    }, 2000)
                }
            })
        })

        Logger.debug(`[${this.name}] Added event listeners to ${buttons.length} Lisa buttons`)
    }

    /**
     * Add event listeners for edit entry buttons
     */
    addEditEntryButtonListeners() {
        // Find all "Muuda" buttons and add event listeners
        const buttons = document.querySelectorAll('button[id^="edit-"]')
        buttons.forEach(button => {
            button.addEventListener('click', async (event) => {
                // Prevent event bubbling
                event.preventDefault()
                event.stopPropagation()

                const clickedButton = event.target
                const date = clickedButton.getAttribute('data-date')
                const entryId = clickedButton.getAttribute('data-entry-id')
                const current = clickedButton.getAttribute('data-current')
                const correct = clickedButton.getAttribute('data-correct')
                const type = clickedButton.getAttribute('data-type')
                const lessons = clickedButton.getAttribute('data-lessons')

                // Only disable and process the clicked button
                if (clickedButton.disabled) {
                    Logger.debug(`[${this.name}] Button already processing, ignoring click`)
                    return
                }

                // Disable only this button to prevent multiple clicks
                clickedButton.disabled = true
                const originalText = clickedButton.textContent
                const originalBackground = clickedButton.style.background
                clickedButton.textContent = 'Töötlen...'
                clickedButton.style.background = '#6c757d' // Gray color when disabled

                try {
                    Logger.debug(`[${this.name}] Processing edit button for entry ID: ${entryId}, type: ${type}`)
                    await this.handleEditEntry(date, entryId, current, correct, type, lessons)
                } catch (error) {
                    Logger.error(`[${this.name}] Error processing edit button:`, error)
                } finally {
                    // Re-enable only this button after processing with correct original color
                    setTimeout(() => {
                        clickedButton.disabled = false
                        clickedButton.textContent = originalText

                        // Restore original background color based on button type
                        if (type === 'smart_multi_lesson_fix') {
                            clickedButton.style.background = '#17a2b8' // Blue for smart buttons
                        } else if (type === 'multi_entry_lesson_fix') {
                            clickedButton.style.background = '#6c757d' // Gray for multi-entry buttons
                        } else {
                            clickedButton.style.background = '#ffc107' // Yellow for standard buttons
                        }
                    }, 2000)
                }
            })
        })

        Logger.debug(`[${this.name}] Added event listeners to ${buttons.length} Muuda buttons`)
    }

    /**
     * Handle editing journal entries
     */
    async handleEditEntry(date, entryId, current, correct, type, lessons) {
        Logger.info(`[${this.name}] Editing entry for date: ${date}, entry ID: ${entryId}, type: ${type}`)

        try {
            // Try to automatically find and edit the journal entry
            await this.openAndEditJournalEntry(date, entryId, current, correct, type, lessons)
        } catch (error) {
            Logger.error(`[${this.name}] Error opening edit entry form:`, error)

            // Enhanced fallback instructions for different button types
            const formattedDate = this.formatDisplayDate(date)

            if (type === 'smart_multi_lesson_fix') {
                const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
                const minLesson = Math.min(...lessonNumbers)
                const targetCount = this.getSmartTargetLessonCount() || lessonNumbers.length

                alert(`Muuda sissekannet kuupäeval ${formattedDate} (Nutikas lahendus)\n\nPraegune seadistus:\n${current}\n\nUus seadistus:\n${correct}\n\nJuhised:\n1. Ava see sissekanne päevikus (ID: ${entryId})\n2. Muuda algustund: ${minLesson}\n3. Muuda tundide arv: ${targetCount} (nutikalt arvutatud)\n4. Vajalikud tunnid: ${lessonNumbers.join(', ')}`)
            } else if (type === 'multi_entry_lesson_fix') {
                const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
                const minLesson = Math.min(...lessonNumbers)

                alert(`Muuda sissekannet kuupäeval ${formattedDate} (Mitme sissekande lahendus)\n\nPraegune seadistus:\n${current}\n\nUus seadistus:\n${correct}\n\nJuhised:\n1. Ava see sissekanne päevikus (ID: ${entryId})\n2. Muuda algustund: ${minLesson}\n3. Otsusta ise tundide arv (mitu tundi sellest sissekandest eemaldada)\n4. Vajalikud tunnid kokku: ${lessonNumbers.join(', ')}`)
            } else if (type === 'multi_lesson_fix') {
                const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
                const minLesson = Math.min(...lessonNumbers)
                const lessonCount = lessonNumbers.length

                alert(`Muuda sissekannet kuupäeval ${formattedDate}\n\nPraegune seadistus:\n${current}\n\nUus seadistus:\n${correct}\n\nJuhised:\n1. Ava see sissekanne päevikus (ID: ${entryId})\n2. Muuda algustund: ${minLesson}\n3. Muuda tundide arv: ${lessonCount}\n4. Vajalikud tunnid: ${lessonNumbers.join(', ')}`)
            } else {
                const currentLesson = current.replace('Algustund: ', '')
                const correctLesson = correct.replace('Algustund: ', '')

                alert(`Muuda sissekannet kuupäeval ${formattedDate}\n\nPraegune algustund: ${currentLesson}\nUus algustund: ${correctLesson}\n\nJuhised:\n1. Ava see sissekanne päevikus (ID: ${entryId})\n2. Muuda algustund väärtuselt ${currentLesson} väärtusele ${correctLesson}`)
            }
        }
    }

    /**
     * Open and edit a specific journal entry automatically
     */
    async openAndEditJournalEntry(date, entryId, current, correct, type, lessons) {
        Logger.debug(`[${this.name}] Attempting to open and edit journal entry ID: ${entryId}`)

        // First, try to find and click the specific journal entry
        const entryElement = await this.findJournalEntryElement(entryId, date)
        if (!entryElement) {
            throw new Error(`Could not find journal entry element for ID: ${entryId}`)
        }

        // Click on the entry to open edit form
        await this.clickJournalEntry(entryElement)

        // Wait for the edit form to open
        await this.waitForEditFormToOpen()

        // Fill out the corrected values
        await this.fillEditForm(current, correct, type, lessons)

        Logger.info(`[${this.name}] Successfully opened and filled edit form for entry ${entryId}`)
    }

    /**
     * Find the journal entry element on the page
     */
    async findJournalEntryElement(entryId, date) {
        Logger.debug(`[${this.name}] Looking for journal entry with ID: ${entryId} on date: ${date}`)

        // Quick debug: Log available editJournalEntry elements
        const allEditElements = document.querySelectorAll('[ng-click*="editJournalEntry"]')
        Logger.debug(`[${this.name}] Found ${allEditElements.length} total editJournalEntry elements`)

        // Look for journal entry elements using streamlined strategies
        const strategies = [
            // Strategy 1: Primary - Date-based span matching with position intelligence (PROVEN TO WORK)
            () => {
                const formattedDate = this.formatDisplayDate(date)
                Logger.debug(`[${this.name}] Strategy 1: Looking for date ${formattedDate} in journal table`)

                // Look for spans with the date that have editJournalEntry ng-click
                const dateSpans = document.querySelectorAll('span[ng-click*="editJournalEntry"]')
                const matchingSpans = Array.from(dateSpans).filter(span => {
                    const spanText = span.textContent.trim()
                    return spanText === formattedDate.substring(0, 5) || spanText === formattedDate
                })

                Logger.debug(`[${this.name}] Found ${matchingSpans.length} date spans matching ${formattedDate}`)

                if (matchingSpans.length === 1) {
                    // Only one entry for this date, return it
                    return matchingSpans[0]
                } else if (matchingSpans.length > 1) {
                    // Multiple entries for this date - use intelligent position matching
                    return this.findSpecificJournalEntryByPosition(matchingSpans, entryId, date)
                }

                return null
            },

            // Strategy 2: Fallback - Table row matching with position intelligence
            () => {
                const formattedDate = this.formatDisplayDate(date)
                Logger.debug(`[${this.name}] Strategy 2: Looking for table rows with date ${formattedDate}`)

                // Look for TR elements with editJournalEntry ng-click
                const tableRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"]')
                const matchingRows = Array.from(tableRows).filter(row => {
                    const rowText = row.textContent
                    return rowText.includes(formattedDate.substring(0, 5))
                })

                Logger.debug(`[${this.name}] Found ${matchingRows.length} table rows matching ${formattedDate}`)

                if (matchingRows.length === 1) {
                    return matchingRows[0]
                } else if (matchingRows.length > 1) {
                    return this.findSpecificJournalEntryByPosition(matchingRows, entryId, date)
                }

                return null
            },

            // Strategy 3: Legacy fallback - Direct ID matching (rarely works but kept for edge cases)
            () => {
                const elements = document.querySelectorAll('[ng-click*="editJournalEntry"]')
                return Array.from(elements).find(el => {
                    const ngClick = el.getAttribute('ng-click')
                    // Look for exact entry ID match: editJournalEntry(123) or editJournalEntry('123')
                    return ngClick && (
                        ngClick.includes(`editJournalEntry(${entryId})`) ||
                        ngClick.includes(`editJournalEntry('${entryId}')`) ||
                        ngClick.includes(`editJournalEntry("${entryId}")`)
                    )
                })
            },


        ]

        for (let i = 0; i < strategies.length; i++) {
            try {
                Logger.debug(`[${this.name}] Trying strategy ${i + 1} to find entry ID ${entryId}`)
                const element = strategies[i]()
                if (element && this.isElementVisible(element) && !this.isOurDiscrepanciesButton(element)) {
                    Logger.debug(`[${this.name}] ✅ Found journal entry element using strategy ${i + 1}:`, {
                        tagName: element.tagName,
                        className: element.className,
                        ngClick: element.getAttribute('ng-click'),
                        id: element.id,
                        targetEntryId: entryId
                    })
                    return element
                } else if (element) {
                    Logger.debug(`[${this.name}] ❌ Strategy ${i + 1} found element but it's not visible or is our own button:`, {
                        tagName: element.tagName,
                        visible: this.isElementVisible(element),
                        isOurButton: this.isOurDiscrepanciesButton(element)
                    })
                }
            } catch (error) {
                Logger.debug(`[${this.name}] Strategy ${i + 1} failed:`, error.message)
                continue
            }
        }

        // If we still haven't found it, provide simplified debugging info
        Logger.warning(`[${this.name}] ❌ Could not find journal entry ${entryId} on date ${date}`)
        Logger.debug(`[${this.name}] Available editJournalEntry elements: ${allEditElements.length}`)
        Logger.debug(`[${this.name}] Date spans found: ${document.querySelectorAll('span[ng-click*="editJournalEntry"]').length}`)
        Logger.debug(`[${this.name}] Table rows found: ${document.querySelectorAll('tr[ng-click*="editJournalEntry"]').length}`)

        return null
    }

    /**
     * Find specific journal entry by position when multiple entries exist for the same date
     */
    findSpecificJournalEntryByPosition(matchingElements, targetEntryId, date) {
        Logger.debug(`[${this.name}] Finding specific entry ${targetEntryId} among ${matchingElements.length} elements for date ${date}`)

        // Get all journal entries for this date from our data
        const journalData = this.lastJournalData
        if (!journalData || !journalData.entries) {
            Logger.debug(`[${this.name}] No journal data available for position matching`)
            return matchingElements[0] // Fallback to first element
        }

        // Find all entries for this date and sort them by ID
        const entriesForDate = journalData.entries
            .filter(entry => this.formatDate(entry.entryDate) === date && entry.entryType === 'SISSEKANNE_T')
            .sort((a, b) => a.id - b.id) // Sort by ID to get consistent order

        Logger.debug(`[${this.name}] Found ${entriesForDate.length} journal entries for date ${date}:`,
            entriesForDate.map(e => ({ id: e.id, lessons: e.lessons || 1 })))

        // Find the index of our target entry ID
        const targetIndex = entriesForDate.findIndex(entry => entry.id.toString() === targetEntryId.toString())

        if (targetIndex === -1) {
            Logger.warning(`[${this.name}] Target entry ID ${targetEntryId} not found in journal data for date ${date}`)
            return matchingElements[0] // Fallback to first element
        }

        Logger.debug(`[${this.name}] Target entry ${targetEntryId} is at index ${targetIndex} in sorted list`)

        // Return the element at the corresponding position
        if (targetIndex < matchingElements.length) {
            Logger.debug(`[${this.name}] ✅ Selected element at index ${targetIndex} for entry ${targetEntryId}`)
            return matchingElements[targetIndex]
        } else {
            Logger.warning(`[${this.name}] Target index ${targetIndex} exceeds available elements (${matchingElements.length})`)
            return matchingElements[0] // Fallback to first element
        }
    }

    /**
     * Click on a journal entry to open its edit form
     */
    async clickJournalEntry(entryElement) {
        Logger.debug(`[${this.name}] Attempting to click journal entry element:`, {
            tagName: entryElement.tagName,
            className: entryElement.className,
            ngClick: entryElement.getAttribute('ng-click')
        })

        // Try different ways to trigger the edit action
        const clickTargets = [
            // If this is already the journal-entry-button, use it directly
            entryElement.classList.contains('journal-entry-button') ? entryElement : null,

            // Look for journal-entry-button within the entry
            entryElement.querySelector('.journal-entry-button[ng-click*="editJournalEntry"]'),
            entryElement.querySelector('span[ng-click*="editJournalEntry"]'),
            entryElement.querySelector('button[ng-click*="editJournalEntry"]'),

            // Look for any edit-related elements within the entry
            entryElement.querySelector('[ng-click*="editJournalEntry"]'),
            entryElement.querySelector('[ng-click*="edit"]'),
            entryElement.querySelector('button[ng-click*="edit"]'),
            entryElement.querySelector('a[ng-click*="edit"]'),

            // Look for any clickable element within the entry
            entryElement.querySelector('button[ng-click]'),
            entryElement.querySelector('span[ng-click]'),
            entryElement.querySelector('a[ng-click]'),
            entryElement.querySelector('[ng-click]'),

            // If the entry itself is clickable
            entryElement.hasAttribute('ng-click') ? entryElement : null,

            // Last resort: the entry element itself
            entryElement
        ]

        for (const target of clickTargets) {
            if (target && this.isElementVisible(target)) {
                Logger.debug(`[${this.name}] Trying to click target:`, {
                    tagName: target.tagName,
                    className: target.className,
                    ngClick: target.getAttribute('ng-click')
                })

                // Scroll into view
                target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                await this.delay(500)

                // Try clicking
                target.click()
                await this.delay(800) // Wait longer for the form to potentially open

                // Check if edit form opened
                if (await this.checkIfEditFormOpened()) {
                    Logger.debug(`[${this.name}] Successfully opened edit form`)
                    return
                }

                // If single click didn't work, try double click for this target
                Logger.debug(`[${this.name}] Single click didn't work, trying double click`)
                target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
                await this.delay(800)

                if (await this.checkIfEditFormOpened()) {
                    Logger.debug(`[${this.name}] Successfully opened edit form with double click`)
                    return
                }

                // Try triggering Angular click event manually
                if (target.getAttribute('ng-click')) {
                    Logger.debug(`[${this.name}] Trying to trigger Angular click manually`)
                    try {
                        // Try to get Angular scope and execute the ng-click function
                        const angularElement = angular ? angular.element(target) : null
                        if (angularElement && angularElement.scope) {
                            const scope = angularElement.scope()
                            const ngClick = target.getAttribute('ng-click')
                            if (scope && ngClick) {
                                // Try to evaluate the ng-click expression
                                scope.$eval(ngClick)
                                scope.$apply()
                                await this.delay(800)

                                if (await this.checkIfEditFormOpened()) {
                                    Logger.debug(`[${this.name}] Successfully opened edit form with Angular eval`)
                                    return
                                }
                            }
                        }
                    } catch (angularError) {
                        Logger.debug(`[${this.name}] Angular click failed:`, angularError.message)
                    }
                }
            }
        }

        throw new Error('Could not open edit form for journal entry')
    }

    /**
     * Check if edit form has opened
     */
    async checkIfEditFormOpened() {
        const editFormSelectors = [
            'md-dialog',
            '.modal',
            '.dialog',
            'form[name*="edit"]',
            'form[name*="entry"]',
            '[ng-form*="edit"]',
            '[ng-form*="entry"]',
            '.edit-form',
            '.entry-edit-form'
        ]

        for (const selector of editFormSelectors) {
            const form = document.querySelector(selector)
            if (form && this.isElementVisible(form)) {
                // Additional check: make sure it contains entry-related fields
                const hasEntryFields = form.querySelector('[ng-model*="startLessonNr"], [ng-model*="lessons"], [ng-model*="entryType"]')
                if (hasEntryFields) {
                    return true
                }
            }
        }

        return false
    }

    /**
     * Wait for the edit form to open
     */
    async waitForEditFormToOpen(maxAttempts = 20, intervalMs = 250) {
        Logger.debug(`[${this.name}] Waiting for edit form to open`)

        return new Promise((resolve, reject) => {
            let attempts = 0

            const checkForm = () => {
                attempts++

                if (this.checkIfEditFormOpened()) {
                    Logger.debug(`[${this.name}] Edit form opened`)
                    resolve()
                    return
                }

                if (attempts >= maxAttempts) {
                    reject(new Error(`Edit form did not open after ${maxAttempts} attempts`))
                    return
                }

                Logger.debug(`[${this.name}] Waiting for edit form to open, attempt ${attempts}/${maxAttempts}`)
                setTimeout(checkForm, intervalMs)
            }

            checkForm()
        })
    }

    /**
     * Fill the edit form with corrected values
     */
    async fillEditForm(current, correct, type, lessons) {
        Logger.debug(`[${this.name}] Filling edit form - type: ${type}`)

        if (type === 'smart_multi_lesson_fix') {
            // Enhanced: Smart multi-lesson fix with intelligent prefilling (Issue 2 fix)
            const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
            const minLesson = Math.min(...lessonNumbers)
            const lessonCount = lessonNumbers.length

            // Get the smart target lesson count from the button data
            const smartTargetCount = this.getSmartTargetLessonCount()
            const targetLessonCount = smartTargetCount || lessonCount

            Logger.debug(`[${this.name}] Smart multi-lesson fix: start=${minLesson}, target_count=${targetLessonCount}, original_count=${lessonCount}`)

            // Update start lesson and lesson count with smart prefilling
            await this.fillStartLessonField(minLesson)
            await this.fillLessonCountField(targetLessonCount)

        } else if (type === 'multi_lesson_fix') {
            const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
            const minLesson = Math.min(...lessonNumbers)
            const lessonCount = lessonNumbers.length

            Logger.debug(`[${this.name}] Multi-lesson fix: start=${minLesson}, count=${lessonCount}`)

            // Update start lesson and lesson count
            await this.fillStartLessonField(minLesson)
            await this.fillLessonCountField(lessonCount)

        } else if (type === 'multi_entry_lesson_fix') {
            // Enhanced: Multiple entry lesson fix - no prefilling, let user decide (Issue 2 fix)
            const lessonNumbers = lessons ? lessons.split(',').map(n => parseInt(n.trim())) : []
            const minLesson = Math.min(...lessonNumbers)

            Logger.debug(`[${this.name}] Multi-entry lesson fix: start=${minLesson}, no prefilling`)

            // Only update start lesson, let user decide on lesson count
            await this.fillStartLessonField(minLesson)

        } else if (type === 'single_lesson_fix') {
            const correctLesson = parseInt(correct.replace('Algustund: ', ''))

            Logger.debug(`[${this.name}] Single lesson fix: new start lesson=${correctLesson}`)

            // Update just the start lesson number
            await this.fillStartLessonField(correctLesson)
        }

        Logger.info(`[${this.name}] Edit form filled successfully`)
    }

    /**
     * Get the smart target lesson count from the currently clicked button
     */
    getSmartTargetLessonCount() {
        // Look for the currently processing button to get its smart target data
        const smartButtons = document.querySelectorAll('button[data-smart-target]')
        for (const button of smartButtons) {
            if (button.disabled && button.textContent.includes('Töötlen')) {
                const smartTarget = button.getAttribute('data-smart-target')
                return smartTarget ? parseInt(smartTarget) : null
            }
        }
        return null
    }

    /**
     * Wait for page to be ready and journal ID to be available
     */
    async waitForPageReady() {
        Logger.debug(`[${this.name}] Waiting for page to be ready...`)

        // First, wait for DOM to be ready
        await this.waitForDOMReady()

        // Then wait for journal ID to be available in URL
        await this.waitForJournalId()

        // Finally, wait for any Angular/AngularJS content to be loaded
        await this.waitForContentReady()

        Logger.debug(`[${this.name}] Page is ready!`)
    }

    /**
     * Wait for DOM to be ready
     */
    async waitForDOMReady() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                resolve()
            } else {
                document.addEventListener('DOMContentLoaded', resolve, { once: true })
                window.addEventListener('load', resolve, { once: true })
            }
        })
    }

    /**
     * Wait for journal ID to be available in URL with polling
     */
    async waitForJournalId(maxAttempts = 50, intervalMs = 200) {
        Logger.debug(`[${this.name}] Polling for journal ID in URL...`)

        return new Promise((resolve, reject) => {
            let attempts = 0

            const checkJournalId = () => {
                attempts++
                const journalId = this.extractJournalId()

                if (journalId) {
                    Logger.debug(`[${this.name}] Journal ID found: ${journalId} (attempt ${attempts})`)
                    resolve(journalId)
                    return
                }

                if (attempts >= maxAttempts) {
                    Logger.warning(`[${this.name}] Failed to find journal ID after ${maxAttempts} attempts`)
                    reject(new Error(`Journal ID not found after ${maxAttempts} attempts`))
                    return
                }

                Logger.debug(`[${this.name}] Journal ID not found, attempt ${attempts}/${maxAttempts}`)
                setTimeout(checkJournalId, intervalMs)
            }

            checkJournalId()
        })
    }

    /**
     * Wait for Angular content to be loaded by checking for key elements
     */
    async waitForContentReady(maxAttempts = 25, intervalMs = 400) {
        Logger.debug(`[${this.name}] Waiting for content to be ready...`)

        return new Promise((resolve) => {
            let attempts = 0

            const checkContent = () => {
                attempts++

                // Check for common Angular Material elements that indicate content is loaded
                const indicators = [
                    'md-content',
                    '.layout-padding',
                    '[ng-controller]',
                    '.md-toolbar',
                    'md-card'
                ]

                const hasContent = indicators.some(selector => {
                    const element = document.querySelector(selector)
                    if (element) {
                        const rect = element.getBoundingClientRect()
                        return rect.width > 50 && rect.height > 50 // Make sure it's actually rendered
                    }
                    return false
                })

                if (hasContent || attempts >= maxAttempts) {
                    if (hasContent) {
                        Logger.debug(`[${this.name}] Content ready detected (attempt ${attempts})`)
                    } else {
                        Logger.debug(`[${this.name}] Content wait timeout reached (attempt ${attempts})`)
                    }
                    resolve()
                    return
                }

                Logger.debug(`[${this.name}] Waiting for content, attempt ${attempts}/${maxAttempts}`)
                setTimeout(checkContent, intervalMs)
            }

            checkContent()
        })
    }

    /**
     * Reset the feature state (useful for navigation)
     */
    reset() {
        Logger.debug(`[${this.name}] Resetting feature state`)
        this.tableCreated = false
        this.currentJournalId = null

        // Remove any existing table
        const existingTable = document.querySelector('[data-discrepancies-table]')
        if (existingTable) {
            existingTable.remove()
            Logger.debug(`[${this.name}] Removed existing table during reset`)
        }
    }

    /**
     * Check the "Auditoorne õpe" (Auditorium learning) checkbox
     */
    async checkAuditoriumLearningCheckbox() {
        const checkboxSelectors = [
            'md-checkbox[ng-model*="selectedCapacityTypes"][aria-label*="Auditoorne"]',
            'md-checkbox[aria-label="Auditoorne õpe"]',
            'input[type="checkbox"][ng-model*="selectedCapacityTypes"]',
            'md-checkbox input[type="checkbox"]',
            '.md-checkbox-container input[type="checkbox"]'
        ]

        // First try to find the specific "Auditoorne õpe" checkbox
        for (const selector of checkboxSelectors) {
            const elements = document.querySelectorAll(selector)

            for (const element of elements) {
                if (!this.isElementVisible(element)) continue

                // Check if this is the "Auditoorne õpe" checkbox
                const isAuditoriumCheckbox = this.isAuditoriumLearningCheckbox(element)

                if (isAuditoriumCheckbox) {
                    Logger.debug(`[${this.name}] Found Auditoorne õpe checkbox using selector: ${selector}`)
                    await this.checkCheckbox(element)
                    return
                }
            }
        }

        // If specific selectors didn't work, try to find by looking for text content
        const allCheckboxes = document.querySelectorAll('md-checkbox, input[type="checkbox"]')
        for (const checkbox of allCheckboxes) {
            if (!this.isElementVisible(checkbox)) continue

            if (this.isAuditoriumLearningCheckbox(checkbox)) {
                Logger.debug(`[${this.name}] Found Auditoorne õpe checkbox by text search`)
                await this.checkCheckbox(checkbox)
                return
            }
        }

        Logger.warning(`[${this.name}] Could not find Auditoorne õpe checkbox`)
    }

    /**
     * Check if an element is the "Auditoorne õpe" checkbox
     */
    isAuditoriumLearningCheckbox(element) {
        if (!element) return false

        // Check aria-label
        const ariaLabel = element.getAttribute('aria-label')
        if (ariaLabel && ariaLabel.toLowerCase().includes('auditoorne')) {
            return true
        }

        // Check parent md-checkbox for aria-label
        const parentMdCheckbox = element.closest('md-checkbox')
        if (parentMdCheckbox) {
            const parentAriaLabel = parentMdCheckbox.getAttribute('aria-label')
            if (parentAriaLabel && parentAriaLabel.toLowerCase().includes('auditoorne')) {
                return true
            }
        }

        // Check nearby text content (labels, spans)
        const parent = element.parentElement
        if (parent) {
            const parentText = parent.textContent.toLowerCase()
            if (parentText.includes('auditoorne') && parentText.includes('õpe')) {
                return true
            }
        }

        // Check siblings and nearby elements
        const container = element.closest('.md-container, .md-checkbox-container, .checkbox-container')
        if (container) {
            const containerText = container.textContent.toLowerCase()
            if (containerText.includes('auditoorne') && containerText.includes('õpe')) {
                return true
            }
        }

        return false
    }

    /**
     * Check a checkbox element (handles both regular checkboxes and md-checkbox)
     */
    async checkCheckbox(element) {
        try {
            let checkboxInput = element

            // If it's an md-checkbox, find the actual input element
            if (element.tagName.toLowerCase() === 'md-checkbox') {
                checkboxInput = element.querySelector('input[type="checkbox"]')
                if (!checkboxInput) {
                    // Sometimes the input is a sibling or in a different structure
                    checkboxInput = element
                }
            }

            // Check if already checked
            if (checkboxInput.checked) {
                Logger.debug(`[${this.name}] Auditoorne õpe checkbox is already checked`)
                return
            }

            // Focus and click to check
            if (element.tagName.toLowerCase() === 'md-checkbox') {
                // For md-checkbox, click the md-checkbox element itself
                element.focus()
                await this.delay(100)
                element.click()
                await this.delay(200)
            } else {
                // For regular checkbox, click the input
                checkboxInput.focus()
                await this.delay(100)
                checkboxInput.click()
                await this.delay(200)
            }

            // Verify it's checked
            if (checkboxInput.checked) {
                Logger.debug(`[${this.name}] Successfully checked Auditoorne õpe checkbox`)

                // Trigger change events
                checkboxInput.dispatchEvent(new Event('change', { bubbles: true }))
                checkboxInput.dispatchEvent(new Event('input', { bubbles: true }))

                // For Angular, also trigger on the md-checkbox if applicable
                if (element.tagName.toLowerCase() === 'md-checkbox') {
                    element.dispatchEvent(new Event('change', { bubbles: true }))
                }
            } else {
                Logger.warning(`[${this.name}] Failed to check Auditoorne õpe checkbox`)
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error checking Auditoorne õpe checkbox:`, error)
        }
    }
}
