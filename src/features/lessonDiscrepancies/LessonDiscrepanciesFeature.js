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
     * Calculate lesson number based on start time from timetable data
     */
    async calculateLessonNumber(timeStart, schoolId = 9) {
        // Fetch lesson times from local JSON
        const lessonTimes = await this.fetchLessonTimes(schoolId)

        if (!timeStart || !lessonTimes.length) return 1

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
                const correctLessonNumber = await this.calculateLessonNumber(timetableEntry.timeStart, schoolId)

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
                                const entryExpectedTime = await this.getLessonTimeForNumber(entryLessonNumber, schoolId)

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
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Tund</th>
                                <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kellaaeg</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedMissing.map(discrepancy => `
                                <tr>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center; font-size: 14px; font-weight: bold;">${discrepancy.lessonNumber}</td>
                                    <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${discrepancy.timeStart} - ${discrepancy.timeEnd}</td>
                                </tr>
                            `).join('')}
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
                    <h4 style="margin: 0 0 10px 0; color: #856404;">Vale tunniaeg märgitud (${allFixes.length})</h4>
                    <p style="margin: 0 0 15px 0; color: #856404; font-size: 14px;">
                        Tunnid, millel on sissekanne olemas, kuid vale tunninumbriga märgitud:
                    </p>
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead>
                            <tr style="background: #fff2e6;">
                                <th style="padding: 6px 8px; text-align: left; border: 1px solid #dee2e6; font-size: 14px;">Kuupäev</th>
                                <th style="padding: 6px 8px; text-align: center; border: 1px solid #dee2e6; font-size: 14px;">Erinevus</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allFixes.map(discrepancy => {
                if (discrepancy.type === 'multi_lesson_fix_needed') {
                    // Multi-lesson fix
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
                                        </tr>`
                } else {
                    // Single lesson fix
                    return `
                                        <tr>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; font-size: 14px;">${this.formatDisplayDate(discrepancy.date)}</td>
                                            <td style="padding: 6px 8px; border: 1px solid #dee2e6; text-align: center;">
                                                <span style="color: #dc3545; font-weight: bold; text-decoration: line-through; margin-right: 8px; font-size: 14px;">Algustund: ${discrepancy.actualLessonNumber}</span>
                                                <span style="color: #28a745; font-weight: bold; font-size: 14px;">Algustund: ${discrepancy.lessonNumber}</span>
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
    async getLessonTimeForNumber(lessonNumber, schoolId = 9) {
        const lessonTimes = await this.fetchLessonTimes(schoolId)
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
}
