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
     * Fetch both journal and timetable data
     */
    async fetchJournalAndTimetableData(journalId) {
        // Get journal info
        const journalInfo = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true })

        // Get journal entries with allStudents=true to get all entries including those that might be filtered out
        const journalEntries = await this.api.tahvel.get(
            `/journals/${journalId}/journalEntriesByDate`,
            { allStudents: true },
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

            if (schoolLessonTimes) {
                return schoolLessonTimes
            }

            // Fallback to school ID 9 if specific school not found
            if (schoolId !== 9 && lessonTimesData['9']) {
                Logger.debug(`[${this.name}] Using fallback lesson times for school 9`)
                return lessonTimesData['9']
            }

            return {}
        } catch (error) {
            Logger.warning(`[${this.name}] Error loading lesson times:`, error.message)
            return {}
        }
    }

    /**
     * Determine if a timetable entry is for remote learning
     * @param {Object} timetableEntry - The timetable entry object
     * @returns {boolean} True if remote (no room assigned), false if in-person
     */
    isRemoteLesson(timetableEntry) {
        // Remote lessons have no room assigned or empty rooms array
        return !timetableEntry.rooms ||
            timetableEntry.rooms.length === 0 ||
            (Array.isArray(timetableEntry.rooms) && timetableEntry.rooms.every(room => !room || String(room).trim() === ''))
    }

    /**
     * Calculate lesson number based on start time from timetable data
     */
    async calculateLessonNumber(timeStart, schoolId = 9, timetableEntry = null) {
        // Fetch lesson times from local JSON
        const schoolLessonTimes = await this.fetchLessonTimes(schoolId)

        if (!timeStart || !schoolLessonTimes || Object.keys(schoolLessonTimes).length === 0) return 1

        // Determine if this is a remote lesson
        const isRemote = timetableEntry ? this.isRemoteLesson(timetableEntry) : false
        const lessonSchedule = isRemote ? 'remote' : 'inPerson'

        // Get the appropriate lesson times
        const lessonTimes = schoolLessonTimes[lessonSchedule] || schoolLessonTimes.inPerson || []

        if (!lessonTimes.length) {
            Logger.warning(`[${this.name}] No lesson times found for schedule: ${lessonSchedule}`)
            return 1
        }

        Logger.debug(`[${this.name}] Using ${lessonSchedule} schedule for time ${timeStart}`)

        // First, try to find exact match
        for (const lessonTime of lessonTimes) {
            if (lessonTime.timeStart === timeStart) {
                console.log(`[${this.name}] Found exact match: ${timeStart} = lesson ${lessonTime.number} (${lessonSchedule})`)
                return lessonTime.number
            }
        }

        // If no exact match, find closest lesson time
        console.log(`[${this.name}] No exact match for ${timeStart}, finding closest match in ${lessonSchedule} schedule`)
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

        console.log(`[${this.name}] Closest match for ${timeStart}: lesson ${closestLesson.number} (${closestLesson.timeStart}) in ${lessonSchedule} schedule`)
        return closestLesson.number
    }

    /**
     * Find discrepancies between journal entries and timetable
     */
    async findLessonDiscrepancies(journalData, timetableData) {
        const discrepancies = []
        const journalEntryLessons = new Set()
        const journalEntriesByDate = new Map() // Store all journal entries by date for lesson number checking

        Logger.debug(`[${this.name}] Analyzing ${journalData.entries.length} journal entries`)

        // Create set of date+lesson number combinations that have journal entries
        // Also store journal entries by date for lesson number validation
        for (const entry of journalData.entries) {
            if (entry.entryType === 'SISSEKANNE_T') { // Regular lesson entry
                const entryDate = this.formatDate(entry.entryDate)

                // Store the entry by date for later lesson number checking
                if (!journalEntriesByDate.has(entryDate)) {
                    journalEntriesByDate.set(entryDate, [])
                }
                journalEntriesByDate.get(entryDate).push(entry)

                // Handle multiple lessons in one entry
                // NOTE: We assume consecutive lessons for now, but this might not always be accurate
                // if the same subject has non-consecutive lessons on the same day
                const startLessonNr = entry.startLessonNr || 1
                const lessonCount = entry.lessons || 1

                // For entries with multiple lessons, we need to be more careful
                // as they might represent non-consecutive lessons
                if (lessonCount > 1) {
                    Logger.debug(`[${this.name}] Multi-lesson entry found:`, {
                        date: entryDate,
                        startLessonNr: startLessonNr,
                        lessonCount: lessonCount,
                        entryId: entry.id
                    })
                }

                for (let i = 0; i < lessonCount; i++) {
                    const lessonNumber = startLessonNr + i
                    const lessonKey = `${entryDate}_lesson_${lessonNumber}`
                    journalEntryLessons.add(lessonKey)
                    Logger.debug(`[${this.name}] Found journal entry: ${lessonKey}`)
                }
            }
        }

        Logger.debug(`[${this.name}] Found ${journalEntryLessons.size} unique journal entry lessons`)
        Logger.debug(`[${this.name}] Analyzing ${timetableData.length} timetable entries`)        // Check each timetable entry for missing journal entries or incorrect lesson numbers
        // First, collect all issues by date and entry
        const issuesByDateAndEntry = new Map() // "date_entryId" -> { entry, issues: [timetable entries] }

        for (const timetableEntry of timetableData) {
            const timetableDate = this.formatDate(timetableEntry.date)
            const timetableDateTime = new Date(timetableEntry.date)
            const now = new Date()

            // Only check past lessons
            if (timetableDateTime < now) {
                // Calculate lesson number using local lesson times data
                const schoolId = journalData.info.school?.id || 9
                const correctLessonNumber = await this.calculateLessonNumber(timetableEntry.timeStart, schoolId, timetableEntry)

                // Create the lesson key for timetable entry
                const correctLessonKey = `${timetableDate}_lesson_${correctLessonNumber}`

                // Check if this specific lesson has a journal entry
                if (!journalEntryLessons.has(correctLessonKey)) {
                    // Check if there are any journal entries on this date with wrong lesson numbers
                    const entriesOnDate = journalEntriesByDate.get(timetableDate) || []
                    let foundRelatedEntry = false

                    for (const entry of entriesOnDate) {
                        const entryStartLesson = entry.startLessonNr || 1
                        const entryLessonCount = entry.lessons || 1
                        const entryKey = `${timetableDate}_${entry.id}`

                        // Check if this entry might be related to this timetable slot
                        // by checking if it's a wrong lesson number case
                        for (let i = 0; i < entryLessonCount; i++) {
                            const entryLessonNumber = entryStartLesson + i

                            if (entryLessonNumber !== correctLessonNumber) {
                                const entryExpectedTime = await this.getLessonTimeForNumber(entryLessonNumber, schoolId, timetableEntry)

                                // If this entry is for a different time, it might be a wrong lesson number
                                if (entryExpectedTime && !this.timesAreClose(entryExpectedTime, timetableEntry.timeStart)) {
                                    // This timetable entry is missing because of wrong lesson number in this entry
                                    if (!issuesByDateAndEntry.has(entryKey)) {
                                        issuesByDateAndEntry.set(entryKey, {
                                            date: timetableDate,
                                            entry: entry,
                                            issues: []
                                        })
                                    }

                                    issuesByDateAndEntry.get(entryKey).issues.push({
                                        correctLessonNumber: correctLessonNumber,
                                        timeStart: timetableEntry.timeStart,
                                        timeEnd: timetableEntry.timeEnd,
                                        name: timetableEntry.nameEt || journalData.info.nameEt,
                                        rooms: timetableEntry.rooms || []
                                    })

                                    foundRelatedEntry = true
                                    break
                                }
                            }
                        }
                        if (foundRelatedEntry) break
                    }

                    // If no related entry found, it's just a missing journal entry
                    if (!foundRelatedEntry) {
                        Logger.debug(`[${this.name}] Missing journal entry for: ${correctLessonKey}`)

                        discrepancies.push({
                            date: timetableDate,
                            timeStart: timetableEntry.timeStart,
                            timeEnd: timetableEntry.timeEnd,
                            name: timetableEntry.nameEt || journalData.info.nameEt,
                            rooms: timetableEntry.rooms || [],
                            lessonNumber: correctLessonNumber,
                            type: 'missing_journal_entry'
                        })
                    }
                }
            }
        }

        // Process grouped issues to create appropriate discrepancies
        for (const [entryKey, data] of issuesByDateAndEntry) {
            const { date, entry, issues } = data

            if (issues.length === 1) {
                // Single issue - show as wrong lesson number
                const issue = issues[0]
                const currentStart = entry.startLessonNr || 1

                discrepancies.push({
                    date: date,
                    timeStart: issue.timeStart,
                    timeEnd: issue.timeEnd,
                    name: issue.name,
                    rooms: issue.rooms,
                    lessonNumber: issue.correctLessonNumber,
                    actualLessonNumber: currentStart,
                    entryId: entry.id,
                    type: 'wrong_lesson_number'
                })
            } else if (issues.length > 1) {
                // Multiple issues - suggest multi-lesson fix
                const lessonNumbers = issues.map(i => i.correctLessonNumber).sort((a, b) => a - b)
                const minLesson = Math.min(...lessonNumbers)
                const currentRange = `Algustund: ${entry.startLessonNr || 1}, Tundide arv: ${entry.lessons || 1}`

                discrepancies.push({
                    date: date,
                    timeStart: `${issues[0].timeStart} (${issues.length} tunnid)`,
                    timeEnd: issues[issues.length - 1].timeEnd,
                    name: issues[0].name,
                    rooms: issues[0].rooms,
                    lessonNumber: `Algustund: ${minLesson}, Tundide arv: ${issues.length}`,
                    actualLessonNumber: currentRange,
                    entryId: entry.id,
                    neededLessons: lessonNumbers,
                    type: 'multi_lesson_fix_needed'
                })
            }
        }

        Logger.info(`[${this.name}] Found ${discrepancies.length} lesson discrepancies`)
        return discrepancies
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
        // Separate different types of discrepancies
        const missingEntries = discrepancies.filter(d => d.type === 'missing_journal_entry')
        const wrongNumbers = discrepancies.filter(d => d.type === 'wrong_lesson_number')
        const multiLessonFixes = discrepancies.filter(d => d.type === 'multi_lesson_fix_needed')

        // Sort discrepancies by date (earliest first), then by lesson number
        const sortedMissing = missingEntries.sort((a, b) => {
            const dateA = new Date(a.date)
            const dateB = new Date(b.date)
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB
            }
            return a.lessonNumber - b.lessonNumber
        })

        const sortedWrong = wrongNumbers.sort((a, b) => {
            const dateA = new Date(a.date)
            const dateB = new Date(b.date)
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB
            }
            return a.lessonNumber - b.lessonNumber
        })

        const sortedMultiFixes = multiLessonFixes.sort((a, b) => {
            const dateA = new Date(a.date)
            const dateB = new Date(b.date)
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA - dateB
            }
            return a.neededLessons[0] - b.neededLessons[0]
        })

        // Sort and group missing entries by date
        const groupedMissing = sortedMissing.reduce((groups, discrepancy) => {
            const date = discrepancy.date
            if (!groups[date]) {
                groups[date] = []
            }
            groups[date].push(discrepancy)
            return groups
        }, {})

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
                <h3 style="margin: 0; color: #856404;">Tunnisisekannete probleemid (${discrepancies.length})</h3>
            </div>`

        // Missing journal entries section
        if (sortedMissing.length > 0) {
            content += `
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0; color: #856404;">Puuduvad tunnisisseukanded (${sortedMissing.length})</h4>
                    <p style="margin: 0 0 15px 0; color: #856404; font-size: 14px;">
                        Tunniplaanist leitud tunnid, millele ei vasta ühtegi päeviku sissekannet:
                    </p>
                    <table style="width: 100%; border-collapse: collapse; background: white; margin-bottom: 15px;">
                        <thead>
                            <tr style="background: #f8f9fa;">
                                <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kuupäev</th>
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tunnid</th>
                                <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kellaajad</th>
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tegevus</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.keys(groupedMissing).sort().map(date => {
                const dayMissing = groupedMissing[date]
                // Keep all lesson numbers, but sort them - don't deduplicate
                const lessonNumbers = dayMissing.map(d => d.lessonNumber).sort((a, b) => a - b)
                const timeRanges = dayMissing.map(d => `${d.timeStart}-${d.timeEnd}`)
                const buttonId = `add-missing-${date.replace(/\./g, '-')}`

                return `
                                <tr>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center; font-size: 14px; font-weight: bold;">${lessonNumbers.join(', ')}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${timeRanges.join(', ')}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                        <button 
                                            id="${buttonId}"
                                            data-date="${date}"
                                            data-lessons="${lessonNumbers.join(',')}"
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
            }).join('')}
                        </tbody>
                    </table>
                </div>`
        }

        // Wrong lesson numbers and multi-lesson fixes combined section
        if (sortedWrong.length > 0 || sortedMultiFixes.length > 0) {
            const allFixes = [...sortedWrong, ...sortedMultiFixes].sort((a, b) => {
                const dateA = new Date(a.date)
                const dateB = new Date(b.date)
                if (dateA.getTime() !== dateB.getTime()) {
                    return dateA - dateB
                }
                const lessonA = a.type === 'multi_lesson_fix_needed' ? a.neededLessons[0] : a.lessonNumber
                const lessonB = b.type === 'multi_lesson_fix_needed' ? b.neededLessons[0] : b.lessonNumber
                return lessonA - lessonB
            })

            content += `
                <div>
                    <h4 style="margin: 0 0 10px 0; color: #856404;">Erinevused (${allFixes.length})</h4>
                    <p style="margin: 0 0 15px 0; color: #856404; font-size: 14px;">
                        Tunnid, mis vajavad korrigeerimist:
                    </p>
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead>
                            <tr style="background: #fff2e6;">
                                <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kuupäev</th>
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Erinevus</th>
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tegevus</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allFixes.map(discrepancy => {
                if (discrepancy.type === 'multi_lesson_fix_needed') {
                    // Multi-lesson fix
                    const buttonId = `edit-multi-${discrepancy.date.replace(/\./g, '-')}-${discrepancy.entryId}`
                    return `
                                        <tr>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                                <div style="margin-bottom: 4px;">
                                                    <span style="color: #dc3545; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px;">${discrepancy.actualLessonNumber}</span>
                                                    <span style="color: #28a745; font-weight: bold; font-size: 14px;">${discrepancy.lessonNumber}</span>
                                                </div>
                                                <div style="padding: 2px 4px; background: #e6f3ff; border-radius: 2px; font-size: 11px; color: #0066cc;">
                                                    Tunnid: ${discrepancy.neededLessons.join(', ')}
                                                </div>
                                            </td>
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
                    // Single lesson fix
                    const buttonId = `edit-single-${discrepancy.date.replace(/\./g, '-')}-${discrepancy.entryId}`
                    return `
                                        <tr>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                                <span style="color: #dc3545; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px;">Algustund: ${discrepancy.actualLessonNumber}</span>
                                                <span style="color: #28a745; font-weight: bold; font-size: 14px;">Algustund: ${discrepancy.lessonNumber}</span>
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
            }).join('')}
                        </tbody>
                    </table>
                </div>`
        }

        container.innerHTML = content
        return container
    }

    /**
     * Get the start time for a specific lesson number
     */
    async getLessonTimeForNumber(lessonNumber, schoolId = 9, timetableEntry = null) {
        const schoolLessonTimes = await this.fetchLessonTimes(schoolId)

        if (!schoolLessonTimes || Object.keys(schoolLessonTimes).length === 0) {
            return null
        }

        // Determine if this should use remote or in-person schedule
        const isRemote = timetableEntry ? this.isRemoteLesson(timetableEntry) : false
        const lessonSchedule = isRemote ? 'remote' : 'inPerson'

        // Get the appropriate lesson times
        const lessonTimes = schoolLessonTimes[lessonSchedule] || schoolLessonTimes.inPerson || []

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
    async handleAddMissingEntry(date, lessonNumbers) {
        Logger.info(`[${this.name}] Adding missing entry for date: ${date}, lessons: ${lessonNumbers.join(', ')}`)

        try {
            // Try to automatically open the add entry form and fill it out
            await this.openAndFillAddEntryForm(date, lessonNumbers)
        } catch (error) {
            Logger.error(`[${this.name}] Error opening add entry form:`, error)

            // Fallback to instructions if automation fails
            const formattedDate = this.formatDisplayDate(date)
            const lessonsText = lessonNumbers.length === 1 ? `tund ${lessonNumbers[0]}` : `tunnid ${lessonNumbers.join(', ')}`
            alert(`Lisa sissekanne kuupäevale ${formattedDate} (${lessonsText})\n\nJuhised:\n1. Ava päeviku sissekannete leht\n2. Lisa uus sissekanne\n3. Määra õige kuupäev: ${formattedDate}\n4. Määra algustund: ${Math.min(...lessonNumbers)}\n5. Määra tundide arv: ${lessonNumbers.length}`)
        }
    }

    /**
     * Open and fill the add entry form automatically
     */
    async openAndFillAddEntryForm(date, lessonNumbers) {
        Logger.debug(`[${this.name}] Attempting to open and fill add entry form`)

        // First, try to find and click the "Lisa sissekanne" button
        const addButton = await this.findAndClickAddButton()
        if (!addButton) {
            throw new Error('Could not find "Lisa sissekanne" button')
        }

        // Wait for the form to open
        await this.waitForFormToOpen()

        // Fill out the form fields
        await this.fillEntryForm(date, lessonNumbers)

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
    async fillEntryForm(date, lessonNumbers) {
        Logger.debug(`[${this.name}] Filling entry form with date: ${date}, lessons: ${lessonNumbers}`)

        const formattedDate = this.formatDisplayDate(date)
        const minLesson = Math.min(...lessonNumbers)
        const lessonCount = lessonNumbers.length

        // Fill entry type (Sissekande liik) - set to "Tund"
        await this.fillEntryTypeField()

        // Fill date field
        await this.fillDateField(formattedDate)

        // Fill start lesson number
        await this.fillStartLessonField(minLesson)

        // Fill lesson count
        await this.fillLessonCountField(lessonCount)

        // Check "Auditoorne õpe" checkbox
        await this.checkAuditoriumLearningCheckbox()

        Logger.info(`[${this.name}] Form filled successfully - Entry type: Tund, Date: ${formattedDate}, Start lesson: ${minLesson}, Count: ${lessonCount}, Auditoorne õpe: checked`)
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
                    await this.handleAddMissingEntry(date, lessonNumbers)
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
            button.addEventListener('click', (event) => {
                const date = event.target.getAttribute('data-date')
                const entryId = event.target.getAttribute('data-entry-id')
                const current = event.target.getAttribute('data-current')
                const correct = event.target.getAttribute('data-correct')
                const type = event.target.getAttribute('data-type')
                const lessons = event.target.getAttribute('data-lessons')

                this.handleEditEntry(date, entryId, current, correct, type, lessons)
            })
        })

        Logger.debug(`[${this.name}] Added event listeners to ${buttons.length} Muuda buttons`)
    }

    /**
     * Handle editing journal entries
     */
    handleEditEntry(date, entryId, current, correct, type, lessons) {
        Logger.info(`[${this.name}] Editing entry for date: ${date}, entry ID: ${entryId}, type: ${type}`)

        const formattedDate = this.formatDisplayDate(date)

        if (type === 'multi_lesson_fix') {
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
