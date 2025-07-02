import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { cacheService } from '../../services/CacheService.js'

const HEX = {
  green: ['#28a745', '#218838', '#fff'],
  amber: ['#ffc107', '#e0a800', '#212529'],
  blue: ['#17a2b8', '#138496', '#fff'],
}

const createButtonStyle = ([bg, hover, color]) =>
  `background:${bg};color:${color};border:none;padding:4px 8px;border-radius:3px;` +
  'font-size:12px;font-weight:bold;cursor:pointer;' +
  `" onmouseover="this.style.background='${hover}'" onmouseout="this.style.background='${bg}'`

const CELL_STYLE = 'padding:6px 8px;border:1px solid #dee2e6;font-size:14px;'
const CENTER_STYLE = CELL_STYLE + 'text-align:center;'

/**
 * @typedef {Object} JournalInfo
 * @property {Array} journalTeachers - Array of teacher objects
 * @property {Object} school - School information
 * @property {string} school.id - School ID
 * @property {string} [studyYearStartDate] - Study year's start date
 * @property {string} [studyYearEndDate] - Study year's end date
 * @property {string} id - Journal ID
 */

/**
 * @typedef {Object} TimetableEvent
 * @property {string} journalId - Journal ID
 * @property {string} date - Event date
 * @property {string} timeStart - Start time
 */

/**
 * @typedef {Object} ButtonData
 * @property {string} [entryid] - Entry ID
 * @property {number} [duplicateindex] - Duplicate index
 * @property {number} [currentstart] - Current start lesson
 * @property {number} [timetablestart] - Timetable start lesson
 * @property {number} [currentcount] - Current lesson count
 * @property {number} [timetablecount] - Timetable lesson count
 */

export default class LessonDiscrepanciesFeature extends BaseFeature {

  #tableCreated = false
  #currentJournalId = null
  #saveMonitoringSetup = false
  #tableObserver = null
  #dialogObserver = null
  #isRefreshing = false
  #lastJournalData = null
  #originalFetch = null
  #problematicEntriesCache = null
  #dialogCloseObserver = null
  #dialogWasPresent = false

  static SCHOOL_ID_FALLBACK = 9
  static JOURNAL_ENTRY_LESSON_TYPE = 'SISSEKANNE_T'

  constructor() {
    super('lessonDiscrepancies', /\/journal\/\d+\/edit/)
    this.name = 'LessonDiscrepanciesFeature'
  }

  async activate() {
    this.reset()
    await this.#clearStaleCache()
    await this.#delay(1000)
    await this.#createLessonDiscrepanciesTable()
    this.#setupJournalSaveMonitoring()
    this.#setupDialogObserver()
  }

  onDeactivate() {
    this.#cleanupMonitoring()
    this.reset()
    super.onDeactivate()
  }

  reset() {
    this.#tableCreated = false
    this.#currentJournalId = null
    this.#cleanupMonitoring()
    document.querySelector('[data-discrepancies-table]')?.remove()
  }

  #delay = ms => new Promise(resolve => setTimeout(resolve, ms))

  #formatDate = date => {
    try {
      return new Date(date).toISOString().split('T')[0]
    } catch {
      return null
    }
  }

  #formatDisplayDate = date => {
    const dateObj = new Date(date)
    const day = dateObj.getDate().toString().padStart(2, '0')
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}.${month}.${year}`
  }

  #isElementVisible = element => {
    if (!element) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
  }

  #extractJournalId = () => {
    const match = window.location.href.match(/\/journal\/(\d+)/) ||
      window.location.href.match(/journalId[=:](\d+)/i)
    return match ? parseInt(match[1], 10) : null
  }

  async #clearStaleCache() {
    const journalId = this.#extractJournalId()
    if (journalId) {
      await cacheService.clearJournalCache(journalId)
    }
  }

  async #createLessonDiscrepanciesTable(forceRefresh = false) {
    try {
      const journalId = this.#extractJournalId()
      if (!journalId) return

      const existingTable = document.querySelector('[data-discrepancies-table]')
      if (!forceRefresh && this.#tableCreated && this.#currentJournalId === journalId && existingTable) return
      if (existingTable) this.#tableCreated = false

      const { journalData, timetableData } = await this.#fetchJournalAndTimetableData(journalId, forceRefresh)
      this.#lastJournalData = journalData

      const discrepancies = await this.#findLessonDiscrepancies(journalData, timetableData)

      // Always check for capacity type problems
      const capacityProblems = await this.#getCapacityTypeProblems(journalData)

      // Create unified display
      existingTable?.remove()
      this.#insertUnifiedTable(discrepancies, capacityProblems)
      this.#tableCreated = true
      this.#currentJournalId = journalId
    } catch (error) {
      Logger.error(`[${this.name}] table error`, error)
    }
  }

  async #fetchJournalAndTimetableData(journalId, forceRefresh = false) {
    const cacheExpiration = forceRefresh ? 0 : 6e4
    const cacheBuster = forceRefresh ? Date.now() : undefined
    const params = cacheBuster ? { _t: cacheBuster } : {}
    const entriesParams = { allStudents: true, ...params }

    const info = await this.api.tahvel.get(`/journals/${journalId}`, params, {
      cache: true,
      cacheExpiration: 864e5
    })
    const entries = await this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, entriesParams, {
      cache: true,
      cacheExpiration
    })
    const timetable = await this.#fetchTimetableData(info, forceRefresh)
    return {
      journalData: { info, entries: entries ?? [] },
      timetableData: timetable ?? [],
    }
  }

  #getCurrentStudyYearDates() {
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString(),
    }
  }

  /**
   * @param {JournalInfo} info - Journal info object
   * @param {boolean} forceRefresh - Whether to force refresh cache
   * @returns {Promise<Array<TimetableEvent>>} Timetable events
   */
  async #fetchTimetableData(info, forceRefresh = false) {
    try {
      const teacherId = info.journalTeachers?.[0]?.id
      if (!teacherId) return []

      const schoolId = info.school?.id ?? LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK
      const { from: defaultFrom, thru: defaultThru } = this.#getCurrentStudyYearDates()
      const from = info.studyYearStartDate ?? defaultFrom
      const thru = info.studyYearEndDate ?? defaultThru
      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
      const isPastData = new Date(thru) < new Date()
      const baseCacheExpiration = isPastData ? 2592e6 : 864e5
      const cacheExpiration = forceRefresh ? 0 : baseCacheExpiration

      const params = forceRefresh ? { _t: Date.now() } : {}
      /** @type {{timetableEvents?: Array<TimetableEvent>}} */
      const data = await this.api.tahvel.get(endpoint, params, {
        cache: true,
        cacheExpiration
      })
      return data?.timetableEvents?.filter(event => event.journalId === info.id) ?? []
    } catch (error) {
      Logger.warning(`[${this.name}] timetable`, error.message)
      return []
    }
  }

  async #fetchLessonTimes(schoolId = LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK) {
    try {
      return await new Promise((resolve, reject) => {
        /** @type {any} */
        const message = { action: 'loadLessonTimes' }
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message))
          }
          if (response.error) {
            return reject(new Error(response.error))
          }
          const lessonTimes = response.data?.[schoolId] ||
            response.data?.[LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK] ||
            []
          resolve(lessonTimes)
        })
      })
    } catch (error) {
      Logger.warning(`[${this.name}] times`, error.message)
      return []
    }
  }

  async #calculateLessonNumber(timeStart, schoolId) {
    const times = await this.#fetchLessonTimes(schoolId)
    if (!timeStart || !times.length) return 1

    const exactMatch = times.find(lesson => lesson.timeStart === timeStart)
    if (exactMatch) return exactMatch.number

    const targetTime = new Date(`1970-01-01T${timeStart}`).getTime()
    const timesWithMs = times.map(lesson => ({
      ...lesson,
      timeMs: new Date(`1970-01-01T${lesson.timeStart}`).getTime(),
    }))

    return timesWithMs.reduce((closest, current) => {
      const currentDiff = Math.abs(current.timeMs - targetTime)
      const closestDiff = Math.abs(closest.timeMs - targetTime)
      return currentDiff < closestDiff ? current : closest
    }).number
  }

  #aggregateJournalEntries(entries) {
    return entries.reduce((aggregated, entry) => {
      if (entry.entryType !== LessonDiscrepanciesFeature.JOURNAL_ENTRY_LESSON_TYPE) {
        return aggregated
      }

      const date = this.#formatDate(entry.entryDate)
      aggregated[date] ??= { count: 0, start: Infinity, entries: [] }
      aggregated[date].count += (entry.lessons ?? 1)

      const startLessonNumber = Number(entry.startLessonNr ?? 1)
      aggregated[date].start = Math.min(aggregated[date].start, startLessonNumber)
      aggregated[date].entries.push(entry)
      return aggregated
    }, {})
  }

  async #aggregateTimetableEvents(events, schoolId) {
    const stats = {}
    for (const event of events) {
      const date = this.#formatDate(event.date)
      stats[date] ??= { count: 0, start: Infinity }

      const lessonNumber = await this.#calculateLessonNumber(event.timeStart, schoolId)
      const validLessonNumber = Number(lessonNumber)
      stats[date].count++
      stats[date].start = Math.min(stats[date].start, validLessonNumber)
    }
    return stats
  }

  async #findLessonDiscrepancies(journal, timetable) {
    const schoolId = journal.info.school?.id ?? LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK
    const journalStats = this.#aggregateJournalEntries(journal.entries)
    const timetableStats = await this.#aggregateTimetableEvents(timetable, schoolId)

    const allDates = [...new Set([...Object.keys(journalStats), ...Object.keys(timetableStats)])]

    const differences = allDates
      .map(date => {
        const journalData = journalStats[date] ?? { count: 0, start: Infinity, entries: [] }
        const timetableData = timetableStats[date] ?? { count: 0, start: Infinity }
        const hasDifference = journalData.count !== timetableData.count ||
          journalData.start !== timetableData.start

        return hasDifference ? { date, journal: journalData, timetable: timetableData } : null
      })
      .filter(Boolean)

    return this.#convertDifferencesToDiscrepancies(differences, journal, timetable)
  }

  async #convertDifferencesToDiscrepancies(differences, journal, timetable) {
    const discrepancies = []

    for (const difference of differences) {
      const { date, journal: journalData, timetable: timetableData } = difference
      const { count: journalCount, start: journalStart, entries } = journalData
      const { count: timetableCount, start: timetableStart } = timetableData
      const timetableEntries = timetable.filter(event => this.#formatDate(event.date) === date)

      if (!journalCount && timetableCount) {
        await this.#createMissingLessonDiscrepancies({ date, tEntries: timetableEntries }, journal, discrepancies)
      } else if (journalCount && timetableCount) {
        await this.#createLessonMismatchDiscrepancies({
          date,
          journalCount,
          journalStart,
          timetableCount,
          timetableStart,
          entries,
          tEntries: timetableEntries,
        }, journal, discrepancies)
      }
    }

    return discrepancies
  }


  async #createMissingLessonDiscrepancies({ date, tEntries }, journal, discrepancies) {
    const schoolId = journal.info.school?.id ?? LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK
    /** @type {Array<{date: string, timeStart: string, timeEnd: string, name: string, rooms: Array, lessonNumber: number, type: string}>} */
    const missingLessons = await Promise.all(tEntries.map(async entry => ({
      date,
      timeStart: entry.timeStart,
      timeEnd: entry.timeEnd,
      name: entry.nameEt || journal.info.nameEt,
      rooms: entry.rooms ?? [],
      lessonNumber: await this.#calculateLessonNumber(entry.timeStart, schoolId),
      type: 'missingJournalEntry',
    })))

    if (missingLessons.length > 0) {
      const lessonNumbers = missingLessons.map(lesson => lesson.lessonNumber).sort((a, b) => a - b)
      const firstLesson = missingLessons.find(lesson => lesson.lessonNumber === Math.min(...lessonNumbers))
      const allRooms = [...new Set(missingLessons.flatMap(lesson => lesson.rooms ?? []))]

      discrepancies.push({
        ...firstLesson,
        lessonNumber: Math.min(...lessonNumbers),
        lessonCount: missingLessons.length,
        lessonNumbers: lessonNumbers,
        rooms: allRooms,
        type: 'missingJournalEntry',
      })
    }
  }

  async #createLessonMismatchDiscrepancies(data, journal, discrepancies) {
    const [firstTimetableEntry] = data.tEntries
    if (!firstTimetableEntry) return

    const baseDiscrepancy = {
      date: data.date,
      timeStart: firstTimetableEntry.timeStart,
      timeEnd: firstTimetableEntry.timeEnd,
      name: firstTimetableEntry.nameEt || journal.info.nameEt,
      rooms: firstTimetableEntry.rooms ?? [],
      journalCount: data.journalCount,
      journalStart: data.journalStart,
      timetableCount: data.timetableCount,
      timetableStart: data.timetableStart,
    }

    if (data.entries.length === 1) {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'singleEntryFix',
        entryId: data.entries[0].id,
        entries: data.entries,
      })
    } else {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'multiEntryFix',
        entries: data.entries,
      })
    }
  }

  #createPill = (text, color, backgroundColor) =>
    `<span style="background-color:${backgroundColor};color:${color};font-weight:bold;font-size:14px;padding:4px 8px;">${text}</span>`

  #createDiffPill = (current, correct) => {
    const currentPill = this.#createPill(current, '#721c24', '#f8d7da')
    const correctPill = this.#createPill(correct, '#155724', '#d1edcc')
    const style = 'display:inline-flex;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);'
    return `<div style="${style}">${currentPill}${correctPill}</div>`
  }

  #calculateDuplicateIndex(discrepancy) {
    // Use the same logic as #findJournalEntryElement to ensure consistency
    const duplicateInfo = this.#findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    return duplicateInfo.targetIndex
  }

  #findDuplicateMatches(entryId, date) {
    if (!this.#lastJournalData?.entries) {
      Logger.warning(`No journal data available for findDuplicateMatches`)
      return { exactMatches: [], targetIndex: 0 }
    }

    const targetEntry = this.#lastJournalData.entries.find(entry => entry.id == entryId)
    if (!targetEntry) {
      Logger.warning(`Target entry ${entryId} not found in journal data`)
      return { exactMatches: [], targetIndex: 0 }
    }

    Logger.debug(`[${this.name}] Target entry for ${entryId}:`, {
      id: targetEntry.id,
      entryType: targetEntry.entryType,
      lessons: targetEntry.lessons,
      lessonCount: targetEntry.lessonCount,
      entryDate: targetEntry.entryDate
    })

    // Get all rows that match the date
    const datePrefix = this.#formatDisplayDate(date).slice(0, 5)

    // Try multiple selectors to find journal entry rows
    let allRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"]')
    if (allRows.length === 0) {
      allRows = document.querySelectorAll('tr[onclick*="editJournalEntry"]')
    }
    if (allRows.length === 0) {
      // Fallback: look for any clickable table rows
      allRows = document.querySelectorAll('tr[ng-click], tr[onclick]')
    }

    Logger.debug(`[${this.name}] Total rows found: ${allRows.length}`)

    const dateMatchingRows = [...allRows].filter(row => row.textContent.includes(datePrefix))

    Logger.debug(`[${this.name}] Found ${dateMatchingRows.length} rows matching date ${datePrefix}`)

    // Get the lesson count from targetEntry (could be lessons or lessonCount property)
    const targetLessonCount = targetEntry.lessons || targetEntry.lessonCount || 1

    // Filter by lesson count and type to get the exact matches in DOM order
    const exactMatches = dateMatchingRows.filter(row => {
      const { lessonCount, entryType } = this.#parseRowLessonInfo(row)
      Logger.debug(`[${this.name}] Row info:`, { lessonCount, entryType, targetLessonCount, targetEntryType: targetEntry.entryType })
      return lessonCount === targetLessonCount && entryType === targetEntry.entryType
    })

    // For single matches, index is always 0
    if (exactMatches.length <= 1) {
      Logger.debug(`[${this.name}] Found ${exactMatches.length} exact matches`)
      return { exactMatches, targetIndex: 0 }
    }

    // Find all duplicate entries in API data, sorted by ID (for consistent ordering)
    const duplicateEntries = this.#lastJournalData.entries.filter(entry => this.#formatDate(entry.entryDate) === this.#formatDate(targetEntry.entryDate) &&
      (entry.lessons || entry.lessonCount || 1) === targetLessonCount &&
      entry.entryType === targetEntry.entryType).sort((a, b) => a.id - b.id)

    // Simple position-based matching: assume DOM order matches API order
    const targetIndex = duplicateEntries.findIndex(entry => entry.id == entryId)

    return { exactMatches, targetIndex: Math.max(0, targetIndex) }
  }

  #createSmartDisplay = (currentValue, correctValue) => {
    const current = Number(currentValue)
    const correct = Number(correctValue)
    return current === correct
      ? `<span style="font-size:14px;font-weight:bold;">${current}</span>`
      : this.#createDiffPill(current, correct)
  }

  #createButton(id, text, colorKey, data = {}, tooltip = '') {
    const dataAttributes = Object.entries(data)
      .map(([key, value]) => `data-${key}='${JSON.stringify(value)}'`)
      .join(' ')
    const titleAttribute = tooltip ? `title="${tooltip}"` : ''
    return `<button id="${id}" style="${createButtonStyle(HEX[colorKey])}" ${dataAttributes} ${titleAttribute}>${text}</button>`
  }

  #renderMissingEntry(discrepancy) {
    return {
      start: `<span style="font-weight:bold;">${discrepancy.lessonNumber}</span>`,
      count: `<span style="font-weight:bold;">${discrepancy.lessonCount}</span>`,
      action: this.#createButton(`add-missing-${discrepancy.date}-${discrepancy.lessonNumber}`, 'Lisa', 'green', {
        handler: 'addMissing',
        date: discrepancy.date,
        startLesson: discrepancy.lessonNumber,
        lessonCount: discrepancy.lessonCount,
        timetableStart: discrepancy.lessonNumber,
        timetableCount: discrepancy.lessonCount,
        timeStart: discrepancy.timeStart,
        timeEnd: discrepancy.timeEnd,
        rooms: discrepancy.rooms,
      }),
    }
  }

  #renderSingleEntryFix(discrepancy) {
    const duplicateIndex = this.#calculateDuplicateIndex(discrepancy)
    const duplicateInfo = this.#findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const humanIndex = duplicateIndex + 1
    const buttonText = hasDuplicates ? `Muuda #${humanIndex}` : 'Muuda'
    const tooltip = `Entry ID: ${discrepancy.entryId}, Duplicate Index: ${duplicateIndex}`
    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: this.#createButton(`edit-single-${discrepancy.date}-${discrepancy.entryId}`, buttonText, 'amber', {
        handler: 'editEntry',
        type: 'singleEntryFix',
        date: discrepancy.date,
        entryId: discrepancy.entryId,
        timetableStart: discrepancy.timetableStart,
        timetableCount: discrepancy.timetableCount,
        currentStart: discrepancy.journalStart,
        currentCount: discrepancy.journalCount,
        duplicateIndex: duplicateIndex,
      }, tooltip),
    }
  }

  #renderMultiEntryFix(discrepancy) {
    // Check if there are duplicates by looking at the first entry
    const firstEntry = discrepancy.entries?.[0]
    const firstEntryDiscrepancy = firstEntry ? {
      ...discrepancy,
      entryId: firstEntry.id,
      journalStart: firstEntry.startLessonNr,
      journalCount: firstEntry.lessons,
    } : null
    const duplicateInfo = firstEntryDiscrepancy
      ? this.#findDuplicateMatches(firstEntryDiscrepancy.entryId, firstEntryDiscrepancy.date)
      : { exactMatches: [] }
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const buttons = (discrepancy.entries ?? []).map(entry => {
      const entryDiscrepancy = {
        ...discrepancy,
        entryId: entry.id,
        journalStart: entry.startLessonNr,
        journalCount: entry.lessons
      }
      const duplicateIndex = this.#calculateDuplicateIndex(entryDiscrepancy)
      const humanIndex = duplicateIndex + 1
      const buttonText = hasDuplicates ? `Muuda ${entry.startLessonNr}. (${entry.lessons}t) #${humanIndex}` : `Muuda ${entry.startLessonNr}. (${entry.lessons}t)`
      const tooltip = `Entry ID: ${entry.id}, Duplicate Index: ${duplicateIndex}`
      return this.#createButton(`edit-entry-${discrepancy.date}-${entry.id}`, buttonText, 'amber', {
        handler: 'editEntry',
        type: 'multiEntryFix',
        date: discrepancy.date,
        entryId: entry.id,
        duplicateIndex: duplicateIndex,
      }, tooltip)
    }).join('')

    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:4px;">${buttons}</div>`,
    }
  }

  #createDiscrepancyRow(discrepancy) {
    const renderers = {
      missingJournalEntry: this.#renderMissingEntry,
      singleEntryFix: this.#renderSingleEntryFix,
      multiEntryFix: this.#renderMultiEntryFix,
    }
    const renderer = renderers[discrepancy.type] || this.#renderSingleEntryFix
    const { start, count, action } = renderer.call(this, discrepancy)
    return `<tr style="background-color:white"><td style="${CELL_STYLE}">${this.#formatDisplayDate(discrepancy.date)}</td><td style="${CENTER_STYLE}">${start}</td><td style="${CENTER_STYLE}">${count}</td><td style="${CENTER_STYLE}">${action}</td></tr>`
  }

  #findInsertionPoint() {
    const selectors = ['md-content .layout-padding', '.layout-padding', 'md-content', '#main-content', '.main-content', 'main']
    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => element && element.getBoundingClientRect().width > 100) || document.body
  }

  #insertUnifiedTable(discrepancies, capacityProblems) {
    try {
      document.querySelector('[data-discrepancies-table]')?.remove()
      document.querySelector('[data-capacity-problems-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      insertionPoint.insertBefore(this.#createUnifiedTableElement(discrepancies, capacityProblems), insertionPoint.firstChild)
      this.#addDiscrepancyButtonListeners()
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert unified table`, error)
      return false
    }
  }

  #createUnifiedTableElement(discrepancies, capacityProblems) {
    // Determine background color based on whether there are any problems
    const hasProblems = discrepancies.length > 0 || capacityProblems.length > 0
    const backgroundColor = hasProblems ? '#fff3cd' : '#d1edcc' // yellow if problems, green if none
    const borderColor = hasProblems ? '#ffeaa7' : '#c3e6cb'

    const boxStyle = `background:${backgroundColor};border:1px solid ${borderColor};border-radius:4px;padding:15px;` +
      'margin:8px;box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;'

    // Title bar
    const titleBar = `<div style="display:flex;align-items:center;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;">
      <span style="font-size:20px;margin-right:10px;">🎓</span>
      <h3 style="margin:0;color:#495057;">Õpetaja Assistent 2</h3>
    </div>`

    // Timetable discrepancies section
    const timetableSection = this.#createTimetableSection(discrepancies)

    // Capacity problems section
    const capacitySection = this.#createCapacitySection(capacityProblems)

    const element = document.createElement('div')
    element.dataset.discrepanciesTable = 'true'
    element.style.cssText = boxStyle
    element.innerHTML = titleBar + timetableSection + capacitySection
    return element
  }

  #createTimetableSection(discrepancies) {
    if (!discrepancies.length) {
      return '<p style="color:#28a745;margin:0 0 20px 0;">Erinevusi tunniplaaniga pole.</p>'
    }

    const sectionHeader = `<div style="margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0;color:#495057;">Erinevused tunniplaaniga</h4>
    </div>`

    const CELL_STYLE = 'padding:8px;border-bottom:1px solid #e0e0e0;'
    const CENTER_STYLE = `${CELL_STYLE}text-align:center;`

    const sortedDiscrepancies = [...discrepancies].sort((a, b) => {
      const dateComparison = new Date(a.date) - new Date(b.date)
      if (dateComparison !== 0) return dateComparison

      const aLessonNumber = a.lessonNumber ?? a.timetableStart ?? 0
      const bLessonNumber = b.lessonNumber ?? b.timetableStart ?? 0
      return aLessonNumber - bLessonNumber
    })

    const rows = sortedDiscrepancies.map(discrepancy => this.#createDiscrepancyRow(discrepancy)).join('')
    // noinspection CssUnknownProperty
    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:25%">Algustund</th><th style="${CENTER_STYLE}width:25%">Tundide arv</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    return sectionHeader + `<table style="width:100%;border-collapse:collapse;background:white;margin-bottom:20px;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
  }

  #createCapacitySection(capacityProblems) {
    if (!capacityProblems.length) {
      return '<p style="color:#28a745;margin:0;">Ebaloogilisi sissekande liigi ja tüüpi kombinatsioone ei leitud.</p>'
    }

    const sectionHeader = `<div style="margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0;color:#495057;">Ebaloogilised sissekande liigi ja tüübi kombinatsioonid</h4>
    </div>`

    const CELL_STYLE = 'padding:8px;border-bottom:1px solid #e0e0e0;'
    const CENTER_STYLE = `${CELL_STYLE}text-align:center;`

    const sortedEntries = [...capacityProblems].sort((a, b) =>
      new Date(a.entryDate) - new Date(b.entryDate))

    const rows = sortedEntries.map(entry => this.#createCapacityProblemRow(entry)).join('')
    // noinspection CssUnknownProperty
    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:50%">Märkus</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    return sectionHeader + `<table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
  }

  #addDiscrepancyButtonListeners() {
    const buttons = document.querySelectorAll('[data-discrepancies-table] button')
    buttons.forEach(/** @param {HTMLElement} button */ button => {
      if (button.dataset.handler) {
        button.addEventListener('click', event => this.#handleDiscrepancyButtonClick(event, button))
      }
    })
  }

  async #handleDiscrepancyButtonClick(event, button) {
    event.preventDefault()
    event.stopPropagation()
    if (button.disabled) return

    const originalState = this.#captureButtonState(button)
    this.#setButtonProcessingState(button)

    try {
      const data = this.#parseButtonData(button)
      await this.#executeButtonAction(data)
    } catch (error) {
      Logger.error(`[${this.name}] button action error`, error)
    } finally {
      this.#restoreButtonState(button, originalState)
    }
  }

  #captureButtonState(button) {
    return {
      text: button.textContent,
      background: button.style.background,
      opacity: button.style.opacity,
      cursor: button.style.cursor,
    }
  }

  #setButtonProcessingState(button) {
    button.disabled = true
    button.style.background = '#6c757d'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'
  }

  #parseButtonData(button) {
    const parsedData = Object.fromEntries(Object.entries(button.dataset).map(([key, value]) => [key, JSON.parse(value)]))
    Logger.debug(`[${this.name}] Parsed button data:`, parsedData)
    return parsedData
  }

  async #executeButtonAction(data) {
    Logger.debug(`[${this.name}] Executing button action with data:`, data)

    const actionHandlers = {
      addMissing: () => this.#handleAddMissingEntry(data.date, data.startLesson, data.lessonCount, data),
      editEntry: () => this.#handleEditEntry(data.date, data.entryId, data.type, data),
      fixCapacity: () => this.#handleFixCapacity(data.date, data.entryId, data),
      openEntry: () => this.#handleOpenEntry(data.entryId, data),
    }

    const handler = actionHandlers[data.handler]
    if (handler) {
      await handler()
    } else {
      Logger.warning(`[${this.name}] Unknown handler: ${data.handler}`)
    }
  }

  #restoreButtonState(button, originalState) {
    setTimeout(() => {
      button.disabled = false
      button.textContent = originalState.text
      button.style.background = originalState.background
      button.style.opacity = originalState.opacity || ''
      button.style.cursor = originalState.cursor || ''
    }, 2000)
  }

  async #handleAddMissingEntry(date, start, count, timetableData = {}) {
    try {
      const addButton = await this.#findAndClickAddButton()
      if (!addButton) throw new Error('Lisa sissekanne not found')

      await this.#waitForDialogContentLoaded()
      await this.#fillAddForm(date, start, count, timetableData)
    } catch (error) {
      Logger.error(`[${this.name}] missing entry error`, error)
    }
  }

  /**
   * @param {string} date - Entry date
   * @param {string} entryId - Entry ID
   * @param {string} type - Entry type
   * @param {ButtonData} data - Button data object
   */
  async #handleEditEntry(date, entryId, type, data) {
    try {
      const actualEntryId = entryId || data.entryid
      const duplicateIndex = data.duplicateindex || 0


      const element = await this.#findJournalEntryElement(actualEntryId, date, duplicateIndex)
      if (!element) {
        Logger.error(`[${this.name}] Entry element not found for ID=${actualEntryId}, date=${date}, duplicateIndex=${duplicateIndex}`)
        throw new Error('entry element not found')
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      await this.#fillEditForm(type, data)
    } catch (error) {
      Logger.error(`[${this.name}] edit entry error`, error)
    }
  }

  async #findAndClickAddButton() {
    const selectors = [
      'button[ng-click*="addEntry"]',
      'button[ng-click*="lisa"]',
      '[aria-label*="Lisa sissekanne"]',
    ]

    for (const selector of selectors) {
      const button = document.querySelector(selector)
      if (button && this.#isElementVisible(button) && !button.closest('[data-discrepancies-table]')) {
        await this.#clickElement(button)
        return button
      }
    }

    const allButtons = document.querySelectorAll('button,md-button,[role="button"]')
    const addButton = [...allButtons].find(button =>
      /lisa.*sissekanne|add.*entry/i.test(button.textContent) &&
      !button.closest('[data-discrepancies-table]'))

    if (addButton) {
      await this.#clickElement(addButton)
      return addButton
    }

    return null
  }


  async #fillAddForm(date, start, count, timetableData) {
    const formattedDate = this.#formatDisplayDate(date)
    const effectiveStart = timetableData.timetablestart || timetableData.timetableStart || start
    const effectiveCount = timetableData.timetablecount || timetableData.timetableCount || count

    await Promise.all([
      this.#fillFieldWithVisualFeedback(['md-select[ng-model*="entryType"]'], LessonDiscrepanciesFeature.JOURNAL_ENTRY_LESSON_TYPE, 'Entry type'),
      this.#fillFieldWithVisualFeedback(['md-datepicker input'], formattedDate, 'Date'),
    ])

    await Promise.all([
      this.#fillStartLessonField(String(effectiveStart)),
      this.#fillLessonCountField(String(effectiveCount)),
      this.#checkAuditoriumLearningCheckbox(),
      this.#checkTeacherCheckbox(),
    ])

    // Add teacher checkbox change listeners for validation refresh
    this.#addTeacherCheckboxListeners()
  }

  async #fillEditForm(type, data) {
    try {
      if (type === 'singleEntryFix' || type === 'multiEntryFix') {
        // Both single and multi-entry fixes use the same form filling logic
        // Multi-entry just means multiple buttons are shown, but each operates on a single entry
        await this.#fillSingleEntryForm(data)
      } else {
        Logger.warning(`[${this.name}] Unknown edit form type: ${type}`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error filling edit form:`, error)
    }
  }

  /**
   * @param {ButtonData} data - Form data object
   */
  async #fillSingleEntryForm(data) {
    const currentStart = data.currentstart
    const timetableStart = data.timetablestart
    const currentCount = data.currentcount
    const timetableCount = data.timetablecount

    if (this.#isValidValue(timetableStart) && currentStart !== timetableStart) {
      await this.#fillStartLessonField(String(timetableStart))
    }

    if (this.#isValidValue(timetableCount) && currentCount !== timetableCount) {
      await this.#fillLessonCountField(String(timetableCount))
    }
  }

  #isValidValue(value) {
    return value !== Infinity && value !== -Infinity && !isNaN(value) && value != null
  }

  #setFieldState(field, state) {
    const colors = {
      processing: '#DAA520',
      success: '#006400',
      error: '#dc3545',
    }
    field.style.border = `3px solid ${colors[state]}`
  }

  async #fillFieldWithVisualFeedback(selectors, value, logName) {
    const field = this.#findVisibleElement(selectors)
    if (!field) {
      Logger.warning(`[${this.name}] ${logName} field not found`)
      return false
    }

    this.#setFieldState(field, 'processing')
    const success = field.tagName.toLowerCase() === 'md-select'
      ? await this.#selectMdSelectOption(field, value)
      : await this.#fillInputField(field, value)
    this.#setFieldState(field, success ? 'success' : 'error')
    return success
  }

  async #fillStartLessonField(value) {
    const selectors = [
      'md-select[aria-label*="Algustund"]',
      'md-select[ng-model*="startLessonNr"]',
      '#select_89',
    ]
    return this.#fillFieldWithVisualFeedback(selectors, value, 'Start lesson')
  }

  async #fillLessonCountField(value) {
    const selectors = [
      'input[aria-label="lessons"]',
      'input[ng-model*="lessons"]',
      '#input_69',
    ]
    return this.#fillFieldWithVisualFeedback(selectors, value, 'Lesson count')
  }


  async #fillInputField(field, value) {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  async #selectMdSelectOption(field, value) {
    field.click()
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    const contentId = await this.#getOrWaitForContentId(field)
    if (!contentId) return false

    const optionElement = await this.#waitForElement(`md-content[id="${contentId}"] md-option[value="${value}"]`).catch(() => null)
    if (!optionElement) return false

    optionElement.scrollIntoView()
    await this.#delay(200)
    optionElement.click()
    optionElement.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }

  async #getOrWaitForContentId(field) {
    const existingId = field.getAttribute('aria-owns')
    if (existingId) return existingId

    try {
      return await this.#waitForAttributeToAppear(field, 'aria-owns', 3000)
    } catch {
      return null
    }
  }


  async #waitForAttributeToAppear(element, attribute, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const attributeValue = element.getAttribute(attribute)
        if (attributeValue) {
          observer.disconnect()
          resolve(attributeValue)
        }
      })
      observer.observe(element, { attributes: true })

      setTimeout(() => {
        observer.disconnect()
        reject(new Error(`${attribute} attribute not found within ${timeout} milliseconds`))
      }, timeout)
    })
  }

  async #waitForElement(selector, timeout = 3000) {
    const existing = document.querySelector(selector)
    if (existing) return existing

    return new Promise((resolve, reject) => {
      let resolved = false

      const intervalId = setInterval(() => {
        const targetElement = document.querySelector(selector)
        if (targetElement && !resolved) {
          resolved = true
          clearInterval(intervalId)
          resolve(targetElement)
        }
      }, 100)

      setTimeout(() => {
        if (!resolved) {
          resolved = true
          clearInterval(intervalId)
          const finalElement = document.querySelector(selector)
          if (finalElement) {
            resolve(finalElement)
          } else {
            reject(new Error(`Element ${selector} not found within ${timeout / 1000} sec time limit`))
          }
        }
      }, timeout)
    })
  }

  async #clickElement(element, delay = 500) {
    await this.#clickElementWithScrollPreservation(element)
    await this.#delay(delay)
  }

  #createScrollPreservation() {
    const originalPosition = {
      x: window.scrollX || document.documentElement.scrollLeft,
      y: window.scrollY || document.documentElement.scrollTop,
    }

    const restoreScroll = () => window.scrollTo(originalPosition.x, originalPosition.y)
    let scrollMonitorInterval = null

    const startScrollMonitoring = () => {
      scrollMonitorInterval = setInterval(() => {
        const currentX = window.scrollX || document.documentElement.scrollLeft
        const currentY = window.scrollY || document.documentElement.scrollTop
        if (currentX !== originalPosition.x || currentY !== originalPosition.y) {
          restoreScroll()
        }
      }, 10)
    }

    const stopScrollMonitoring = () => {
      if (scrollMonitorInterval) {
        clearInterval(scrollMonitorInterval)
        scrollMonitorInterval = null
      }
    }

    return { restoreScroll, startScrollMonitoring, stopScrollMonitoring }
  }

  async #clickElementWithScrollPreservation(element) {
    const { restoreScroll, startScrollMonitoring, stopScrollMonitoring } = this.#createScrollPreservation()

    try {
      startScrollMonitoring()
      const rect = element.getBoundingClientRect()
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })

      element.dispatchEvent(clickEvent)
      await this.#delay(100)
    } finally {
      stopScrollMonitoring()
      restoreScroll()
    }
  }

  #findVisibleElement(selectors) {
    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => this.#isElementVisible(element))
  }

  async #findJournalEntryElement(entryId, date, duplicateIndex = 0) {

    const { exactMatches } = this.#findDuplicateMatches(entryId, date)

    Logger.debug(`[${this.name}] findJournalEntryElement: entryId=${entryId}, date=${date}, exactMatches.length=${exactMatches.length}`)

    if (exactMatches.length === 0) {
      // Fallback: try a broader search if exact matching fails
      Logger.warning(`[${this.name}] No exact matches found, trying fallback search`)

      const datePrefix = this.#formatDisplayDate(date).slice(0, 5)
      const allRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"], tr[onclick*="editJournalEntry"], tr[ng-click], tr[onclick]')
      const dateMatchingRows = [...allRows].filter(row => row.textContent.includes(datePrefix))

      Logger.debug(`[${this.name}] Fallback found ${dateMatchingRows.length} rows matching date ${datePrefix}`)

      if (dateMatchingRows.length > 0) {
        // Return the first matching row as a last resort
        Logger.warning(`[${this.name}] Using fallback row for entryId ${entryId}`)
        return dateMatchingRows[0]
      }

      return null
    }

    if (exactMatches.length === 1) {
      return exactMatches[0]
    }

    // Multiple matches - use the provided duplicate index
    if (duplicateIndex < exactMatches.length) {
      return exactMatches[duplicateIndex]
    }
    return exactMatches[0]

  }

  #parseRowLessonInfo(row) {
    const cells = row.querySelectorAll('td')
    let lessonCount = null
    let entryType = null

    for (const cell of cells) {
      const text = cell.textContent.trim()
      if (/^\d+$/.test(text)) {
        lessonCount = parseInt(text)
      }
      if (text.includes('Tund')) {
        entryType = 'SISSEKANNE_T'
      } else if (text.includes('Iseseisev töö')) {
        entryType = 'SISSEKANNE_I'
      } else if (text.includes('Praktiline töö')) {
        entryType = 'SISSEKANNE_P'
      } else if (text.includes('E-õpe')) {
        entryType = 'SISSEKANNE_E'
      }
    }

    return { lessonCount, entryType }
  }


  async #clickJournalEntry(element) {
    const { restoreScroll, startScrollMonitoring, stopScrollMonitoring } = this.#createScrollPreservation()

    try {
      startScrollMonitoring()
      const dialogPromise = this.#waitForDialogToOpen()


      // First try: click the element directly
      await this.#clickElementWithScrollPreservation(element)
      await this.#delay(300)

      // Check if dialog opened
      let isFormOpen = await this.#isEditFormOpen()
      if (!isFormOpen) {
        await this.#performDoubleClick(element)
        await this.#delay(300)
        isFormOpen = await this.#isEditFormOpen()
      }

      // If still not open, try clicking a specific child element
      if (!isFormOpen) {
        const clickableChild = element.querySelector('[ng-click*="editJournalEntry"], [onclick*="editJournalEntry"], td, a')
        if (clickableChild && clickableChild !== element) {
          await this.#clickElementWithScrollPreservation(clickableChild)
          await this.#delay(300)
          isFormOpen = await this.#isEditFormOpen()
        }
      }

      // Final check and error handling
      if (!isFormOpen) {
        // Sometimes the dialog opens, but we don't detect it immediately
        await this.#delay(500)
        isFormOpen = await this.#isEditFormOpen()
      }

      if (!isFormOpen) {
        throw new Error('Edit form failed to open after all attempts')
      }

      try {
        await dialogPromise
      } catch (error) {
        Logger.error(`[${this.name}] Dialog failed to open:`, error.message)

        if (await this.#isEditFormOpen()) {
          return
        }

        throw new Error('edit form not open')
      }
    } finally {
      await this.#delay(100)
      stopScrollMonitoring()
      restoreScroll()
    }
  }

  async #performDoubleClick(element) {
    const rect = element.getBoundingClientRect()
    const doubleClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    })
    element.dispatchEvent(doubleClickEvent)
    await this.#delay(200)
  }

  async #waitForDialogToOpen(timeout = 15000) {
    return new Promise((resolve, reject) => {
      let observer = null

      const timeoutId = setTimeout(() => {
        if (observer) observer.disconnect()
        reject(new Error('Dialog open timeout'))
      }, timeout)

      observer = new MutationObserver(_mutations => {
        const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')

        if (algustundField && this.#isElementVisible(algustundField)) {
          const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')

          if (dialog && this.#isElementVisible(dialog)) {
            clearTimeout(timeoutId)
            observer.disconnect()
            resolve(dialog)
          }
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })

      const existingAlgustundField = document.querySelector('md-select[aria-label*="Algustund"]')
      if (existingAlgustundField && this.#isElementVisible(existingAlgustundField)) {
        const existingDialog = existingAlgustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
        if (existingDialog && this.#isElementVisible(existingDialog)) {
          clearTimeout(timeoutId)
          observer.disconnect()
          resolve(existingDialog)
        }
      }
    })
  }

  async #waitForDialogContentLoaded(timeout = 15000) {
    return new Promise((resolve, reject) => {
      let observer = null

      const timeoutId = setTimeout(() => {
        if (observer) observer.disconnect()
        reject(new Error('Dialog content load timeout'))
      }, timeout)

      const checkDialogReady = () => {
        const algustundField = document.querySelector('md-select[aria-label="Algustund"]')
        const lessonsField = document.querySelector('input[aria-label="lessons"]')

        if (algustundField && lessonsField &&
          this.#isElementVisible(algustundField) && this.#isElementVisible(lessonsField)) {

          const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
          if (dialog && this.#isElementVisible(dialog)) {
            clearTimeout(timeoutId)
            if (observer) observer.disconnect()
            resolve(dialog)
            return true
          }
        }
        return false
      }

      if (checkDialogReady()) return

      observer = new MutationObserver(() => checkDialogReady())
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    })
  }


  async #isEditFormOpen() {
    // Method 1: Check for "Algustund" field
    const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')
    if (algustundField && this.#isElementVisible(algustundField)) {
      const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
      if (dialog && this.#isElementVisible(dialog)) {
        return true
      }
    }

    // Method 2: Check for any visible md-dialog
    const anyDialog = document.querySelector('md-dialog')
    if (anyDialog && this.#isElementVisible(anyDialog)) {
      // Check if it contains journal entry fields
      const hasJournalFields = anyDialog.querySelector('md-select[aria-label*="Algustund"], input[aria-label="lessons"], md-select[ng-model*="entryType"]')
      if (hasJournalFields) {
        return true
      }
    }

    // Method 3: Check for "lessons" field (another common field in journal entry forms)
    const lessonsField = document.querySelector('input[aria-label="lessons"]')
    if (lessonsField && this.#isElementVisible(lessonsField)) {
      const dialog = lessonsField.closest('md-dialog, .md-dialog, [role="dialog"]')
      if (dialog && this.#isElementVisible(dialog)) {
        return true
      }
    }

    return false
  }

  async #checkAuditoriumLearningCheckbox() {
    /** @type {HTMLElement} */
    const checkbox = document.querySelector('md-checkbox[ng-model*="selectedCapacityTypes"][aria-label="Auditoorne õpe"]')

    if (checkbox && this.#isElementVisible(checkbox)) {
      this.#setFieldState(checkbox, 'processing')
      checkbox.click()
      const isChecked = checkbox.getAttribute('aria-checked') === 'true'
      this.#setFieldState(checkbox, isChecked ? 'success' : 'error')
    }
  }

  async #checkTeacherCheckbox() {
    /** @type {HTMLElement} */
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')

    for (const checkbox of teacherCheckboxes) {
      if (checkbox && this.#isElementVisible(checkbox)) {
        const isChecked = checkbox.getAttribute('aria-checked') === 'true'

        if (!isChecked) {
          this.#setFieldState(checkbox, 'processing')
          checkbox.click()

          // Verify it was checked
          await this.#delay(200)
          const nowChecked = checkbox.getAttribute('aria-checked') === 'true'
          this.#setFieldState(checkbox, nowChecked ? 'success' : 'error')

          Logger.debug(`[${this.name}] Teacher checkbox toggled: ${checkbox.getAttribute('aria-label')} - checked: ${nowChecked}`)
        }
      }
    }
  }

  #getTeacherCheckboxState() {
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')
    const checkboxes = []
    let checkedCount = 0

    teacherCheckboxes.forEach(checkbox => {
      const checked = checkbox.getAttribute('aria-checked') === 'true'
      if (checked) checkedCount++

      checkboxes.push({
        element: checkbox,
        checked,
        label: checkbox.getAttribute('aria-label') || checkbox.textContent.trim()
      })
    })

    return {
      hasTeacher: checkedCount > 0,
      checkboxCount: teacherCheckboxes.length,
      checkedCount,
      checkboxes
    }
  }

  async #refreshTableWithRetry(maxRetries = 3) {
    if (this.#isRefreshing) return

    this.#isRefreshing = true

    try {
      const journalId = this.#currentJournalId ?? this.#extractJournalId()
      if (!journalId) return

      const currentCount = this.#getCurrentDiscrepancyCount()

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await this.#performRefreshAttempt(journalId)
        const newCount = this.#getCurrentDiscrepancyCount()

        if (this.#isRefreshSuccessful(currentCount, newCount, attempt, maxRetries)) {
          break
        }

        if (attempt < maxRetries) {
          await this.#delay(attempt * 1000)
        }
      }
    } catch (error) {
      Logger.error(`[${this.name}] refresh retry`, error)
    } finally {
      this.#isRefreshing = false
    }
  }

  #getCurrentDiscrepancyCount() {
    const table = document.querySelector('[data-discrepancies-table]')
    return table ? table.querySelectorAll('tbody tr').length : 0
  }

  async #performRefreshAttempt(journalId) {
    await cacheService.clearJournalCache(journalId)
    await cacheService.clearCache()
    this.#tableCreated = false
    this.#currentJournalId = null
    await this.#delay(300)
    await this.#createLessonDiscrepanciesTable(true)
  }

  #isRefreshSuccessful(oldCount, newCount, attempt, maxAttempts) {
    return newCount < oldCount ||
      !document.querySelector('[data-discrepancies-table]') ||
      attempt === maxAttempts
  }

  #setupJournalSaveMonitoring() {
    if (this.#saveMonitoringSetup) return

    this.#setupJournalTableMonitoring()
    this.#setupJournalDialogSaveMonitoring()
    this.#saveMonitoringSetup = true
  }

  #setupJournalTableMonitoring() {
    const journalTable = document.querySelector('table.journalTable')
    if (journalTable) {
      const tableObserver = new MutationObserver(mutations => {
        if (this.#isRefreshing) return

        let hasTableChanges = false
        for (const mutation of mutations) {
          if (mutation.type === 'childList' &&
            (mutation.removedNodes.length > 0 || mutation.addedNodes.length > 0)) {
            for (const node of [...mutation.removedNodes, ...mutation.addedNodes]) {
              if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TR') {
                hasTableChanges = true
                break
              }
            }
          }
        }

        if (hasTableChanges) {
          setTimeout(() => this.#refreshTableWithRetry(), 1000)
        }
      })

      tableObserver.observe(journalTable, {
        childList: true,
        subtree: true,
      })

      this.#tableObserver = tableObserver
    }
  }

  #setupJournalDialogSaveMonitoring() {
    // Only set up monitoring once and store original fetch
    if (!this.#originalFetch) {
      this.#originalFetch = window.fetch

      // Monitor for journal entry dialog saves by watching for PUT requests to journal entry endpoints
      window.fetch = async (...args) => {
        const response = await this.#originalFetch.apply(window, args)

        // Check if this is a PUT request to a journal entry endpoint
        const url = args[0]
        if (typeof url === 'string' && url.includes('/journalEntry/') && args[1]?.method === 'PUT') {

          // Extract journal ID from URL
          const journalIdMatch = url.match(/\/journals\/(\d+)\/journalEntry\//)
          if (journalIdMatch && parseInt(journalIdMatch[1]) === this.#currentJournalId) {

            // Wait a bit for the save to complete, then refresh validation
            setTimeout(async () => {
              await this.#refreshCapacityValidationAfterSave()
            }, 1500)
          }
        }

        return response
      }
    }
  }

  /**
   * Setup observer to monitor for journal entry dialogs being opened and auto-check teacher checkboxes
   */
  #setupDialogObserver() {
    // Dialog observer removed - no longer auto-checking teacher checkbox
    // Teacher validation is now handled in table/background validation
  }

  async #refreshCapacityValidationAfterSave() {
    try {

      // Check if we have a current journal ID
      if (!this.#currentJournalId) {
        return
      }

      // Clear journal cache to get fresh data
      await cacheService.clearJournalCache(this.#currentJournalId)

      // Fetch fresh journal data
      const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)

      // Re-run unified validation
      const capacityProblems = await this.#getCapacityTypeProblems(journalData)

      // Get current discrepancies (empty since we're only refreshing capacity)
      const discrepancies = []

      // Update unified display
      this.#insertUnifiedTable(discrepancies, capacityProblems)

    } catch (error) {
      console.error(`[${this.name}] Error refreshing capacity validation:`, error)
    }
  }

  #cleanupMonitoring() {
    this.#tableObserver?.disconnect()
    this.#tableObserver = null

    this.#dialogObserver?.disconnect()
    this.#dialogObserver = null

    // Restore original fetch if we modified it
    if (this.#originalFetch) {
      window.fetch = this.#originalFetch
      this.#originalFetch = null
    }

    this.#saveMonitoringSetup = false
  }

  async #getCapacityTypeProblems(journalData) {
    try {

      // First check if there's a discrepancy between planned and used hours for "MAHT_a"
      const capacityHours = journalData.info?.lessonHours?.capacityHours || []
      const auditoorneCapacity = capacityHours.find(c => c.capacity === 'MAHT_a')

      // Log capacity type code mappings

      // Get detailed capacity validation results
      const validationResults = await this.#performDetailedCapacityValidation(journalData, auditoorneCapacity, capacityHours)


      // Return problematic entries
      const problematicEntries = validationResults.filter(result => !result.isValid)
      const enrichedProblematicEntries = problematicEntries.map(r => ({
        ...r.entry,
        validationResult: r,
      }))

      // Store problematic entries for later access during fixing
      this.#problematicEntriesCache = enrichedProblematicEntries

      return enrichedProblematicEntries
    } catch (error) {
      Logger.error(`[${this.name}] capacity check error`, error)
      return []
    }
  }

  async #performDetailedCapacityValidation(journalData, auditoorneCapacity, capacityHours) {

    const entries = journalData.entries || []
    const journalId = journalData.info?.id


    // Filter entries by type with detailed logging
    const targetEntries = entries.filter(entry => entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_I')


    // Verify string comparison logic

    if (targetEntries.length === 0) {
      return
    }

    // Fetch detailed data for each target entry
    const validationResults = await this.#validateEntriesWithDetailedData(journalId, targetEntries, capacityHours)

    // Log validation summary
    this.#logValidationSummary(validationResults, auditoorneCapacity)


    // Return validation results
    return validationResults
  }

  async #validateEntriesWithDetailedData(journalId, targetEntries, journalCapacityHours) {

    const validationResults = []

    for (const entry of targetEntries) {

      try {
        // Fetch detailed entry data from API
        const detailUrl = `/journals/${journalId}/journalEntry/${entry.id}`

        const detailedEntry = await this.api.tahvel.get(detailUrl, { allStudents: true }, {
          cache: false,
          cacheExpiration: 0
        })


        // Analyze journalEntryCapacityTypes structure
        const capacityTypes = detailedEntry.journalEntryCapacityTypes

        // Validate the entry
        const validationResult = this.#validateSingleEntry(entry, detailedEntry, capacityTypes, journalCapacityHours)
        validationResults.push(validationResult)

      } catch (error) {
        validationResults.push({
          entry,
          isValid: false,
          errorType: 'api_fetch_error',
          error: error.message,
          detailedData: null,
        })
      }
    }

    return validationResults
  }

  #validateSingleEntry(entry, detailedEntry, capacityTypes, journalCapacityHours) {

    // Check if entry requires independent work but journal doesn't have MAHT_i configured
    const journalHasIndependentWork = journalCapacityHours && journalCapacityHours.some(c => c.capacity === 'MAHT_i')

    if (entry.entryType === 'SISSEKANNE_I' && !journalHasIndependentWork) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'journal_missing_independent_work',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true,
        },
        expectedState: {
          auditoorne: false,
          iseseiv: true,
          praktiline: false,
          teacher: true,
          reasoning: 'Journal must have MAHT_i capacity configured for independent work entries',
        },
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Handle edge cases
    if (capacityTypes === null || capacityTypes === undefined) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'null_capacity_types',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true,
        },
        expectedState: {
          auditoorne: true,
          iseseiv: false,
          praktiline: false,
          teacher: true,
          reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe',
        },
      }
    }

    if (!Array.isArray(capacityTypes)) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'invalid_capacity_types_format',
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true,
        },
        expectedState: {
          auditoorne: true,
          iseseiv: false,
          praktiline: false,
          teacher: true,
          reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe',
        },
      }
    }

    // Detect checkbox states using different methods

    // Method 1: Array.includes()
    const hasAuditoorneIncludes = capacityTypes.includes('MAHT_a')
    const hasIseseisvIncludes = capacityTypes.includes('MAHT_i')
    const hasPraktiliseIncludes = capacityTypes.includes('MAHT_p')

    // Teacher validation - check if any teachers are selected
    const hasTeacher = Array.isArray(detailedEntry?.journalEntryTeachers) && detailedEntry.journalEntryTeachers.length > 0

    // Using includes() as the primary method

    return this.#performBusinessLogicValidation(entry, detailedEntry, {
      auditoorne: hasAuditoorneIncludes,
      iseseiv: hasIseseisvIncludes,
      praktiline: hasPraktiliseIncludes,
      teacher: hasTeacher,
    }, capacityTypes)
  }

  #performBusinessLogicValidation(entry, detailedEntry, actualState, capacityTypes) {

    // Log the business rules

    // Determine expected state based on entry type
    const shouldHaveAuditoorne = entry.entryType === 'SISSEKANNE_T' // Only SISSEKANNE_T should have auditoorne
    const shouldHaveIseseisev = entry.entryType === 'SISSEKANNE_I'
    const shouldHavePraktiline = entry.entryType === 'SISSEKANNE_P'

    const expectedState = {
      auditoorne: shouldHaveAuditoorne,
      iseseiv: shouldHaveIseseisev,
      praktiline: shouldHavePraktiline,
      teacher: true, // All entries should have a teacher selected
      reasoning: shouldHaveAuditoorne
        ? `Entry type "${entry.entryType}" requires auditoorne õpe checkbox`
        : shouldHaveIseseisev
          ? `Entry type "${entry.entryType}" requires iseseisev õpe checkbox`
          : shouldHavePraktiline
            ? `Entry type "${entry.entryType}" requires praktiline töö checkbox`
            : `Entry type "${entry.entryType}" has specific checkbox requirements`,
    }

    // Check for specific error condition: SISSEKANNE_T (Tund) without auditoorne õpe
    if (entry.entryType === 'SISSEKANNE_T' && !actualState.auditoorne) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'lesson_without_auditoorne',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Check for error condition: no teacher selected
    if (!actualState.teacher) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'no_teacher_selected',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Check for error condition: both checkboxes selected
    const hasBothCheckboxes = actualState.auditoorne && actualState.iseseiv
    if (hasBothCheckboxes) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'both_checkboxes_selected',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Check for error condition: SISSEKANNE_T (lesson) with MAHT_i (independent work)
    const isLessonWithIndependentWork = entry.entryType === 'SISSEKANNE_T' && actualState.iseseiv && !actualState.auditoorne
    if (isLessonWithIndependentWork) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'lesson_with_independent_work',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Check for error condition: SISSEKANNE_I (independent work) with MAHT_a (auditory learning)
    const isIndependentWorkWithAuditory = entry.entryType === 'SISSEKANNE_I' && actualState.auditoorne && !actualState.iseseiv
    if (isIndependentWorkWithAuditory) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'independent_work_with_auditory',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Check for error condition: SISSEKANNE_P (praktiline töö) without praktiline töö checkbox
    const isPraktiliseTooWithoutPraktiliseCheckbox = entry.entryType === 'SISSEKANNE_P' && !actualState.praktiline
    if (isPraktiliseTooWithoutPraktiliseCheckbox) {
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'praktiline_too_without_praktiline_checkbox',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error',
      }
    }

    // Validate against expected state
    const auditoorneValid = actualState.auditoorne === expectedState.auditoorne
    const iseseisvValid = actualState.iseseiv === expectedState.iseseiv
    const praktiliseValid = actualState.praktiline === expectedState.praktiline
    const teacherValid = actualState.teacher === expectedState.teacher
    const isValid = auditoorneValid && iseseisvValid && praktiliseValid && teacherValid
    const validationResult = isValid ? 'pass' : 'fail'

    // Determine specific error type
    let errorType = null
    if (!isValid) {
      errorType = 'missing_required_checkbox'
      if (entry.entryType === 'SISSEKANNE_T') {
        errorType = 'missing_auditoorne_checkbox'
      } else if (entry.entryType === 'SISSEKANNE_P') {
        if (!praktiliseValid) {
          errorType = 'missing_praktiline_checkbox'
        } else {
          errorType = 'missing_auditoorne_checkbox'
        }
      } else if (entry.entryType === 'SISSEKANNE_I') {
        errorType = 'missing_iseseisev_checkbox'
      }
    }

    return {
      entry,
      detailedData: detailedEntry,
      isValid,
      errorType,
      actualState,
      expectedState,
      capacityTypes,
      validationResult,
    }
  }

  #logValidationSummary(validationResults, auditoorneCapacity) {


    // Log detailed results for each entry

    // Log specific entry IDs that are failing each type of validation

    // Root cause analysis logging
    this.#logRootCauseAnalysis(validationResults, auditoorneCapacity)
  }

  #logRootCauseAnalysis(validationResults, _auditoorneCapacity) {

    // Investigate potential causes

    // a) Incorrect business logic
    const allEntriesFailed = validationResults.every(r => !r.isValid)
    if (allEntriesFailed && validationResults.length > 0) {
      Logger.warning('All entries failed validation - possible business logic error')
    }

    // b) Faulty API data parsing
    const hasValidCapacityTypes = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.length > 0)
    if (!hasValidCapacityTypes) {
      Logger.warning('No valid capacity types found - possible API data parsing error')
    }

    // c) Wrong capacity type code
    const hasMAHT_a = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.includes('MAHT_a'))
    if (!hasMAHT_a && hasValidCapacityTypes) {
      Logger.warning('No MAHT_a capacity type found - possible wrong capacity type code')
    }

    // d) Logic errors in boolean comparison
    const hasInconsistentDetection = validationResults.some(r => {
      if (!Array.isArray(r.capacityTypes)) return false
      const includesResult = r.capacityTypes.includes('MAHT_a')
      const indexOfResult = r.capacityTypes.indexOf('MAHT_a') !== -1
      return includesResult !== indexOfResult
    })
    if (hasInconsistentDetection) {
      Logger.warning('Inconsistent capacity type detection - possible logic error')
    }

    // e) Case sensitivity issues
    const uniqueCapacityTypes = new Set()
    validationResults.forEach(r => {
      if (Array.isArray(r.capacityTypes)) {
        r.capacityTypes.forEach(type => uniqueCapacityTypes.add(type))
      }
    })
  }

  /**
   * @param {Object} entry - Journal entry
   * @param {string} entry.entryDate - Entry date
   * @param {string} entry.entryType - Entry type (SISSEKANNE_T, SISSEKANNE_I, SISSEKANNE_P)
   * @param {number} [entry.startLessonNr] - Start lesson number
   * @param {Array} [entry.lessons] - Array of lesson objects

   * @param {number} [entry.lessons[].lessonNr] - Lesson number
   * @param {Object} [entry.validationResult] - Validation result object
   * @param {string} [entry.validationResult.errorType] - Error type
   * @param {number} entry.id - Entry ID

     */
  #createCapacityProblemRow(entry) {
    const CELL_STYLE = 'padding:8px;border-bottom:1px solid #e0e0e0;'
    const CENTER_STYLE = `${CELL_STYLE}text-align:center;`

    // Format date without year (DD.MM)
    const dateObj = new Date(entry.entryDate)
    const shortDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}`
    const startLesson = entry.startLessonNr || entry.lessons?.[0]?.lessonNr || ''
    const dateWithLesson = startLesson ? `${shortDate} (${startLesson}.)` : shortDate

    // Determine badge color based on entry type
    let badgeColor = '#e0e0e0' // light gray default for SISSEKANNE_T
    if (entry.entryType === 'SISSEKANNE_I') {
      badgeColor = '#f0f4c3' // light yellow-green for independent work
    } else if (entry.entryType === 'SISSEKANNE_P') {
      badgeColor = '#b2dfdb' // light teal for practical work
    }

    const dateWithBadge = `<span style="background-color:${badgeColor};padding:2px 6px;border-radius:4px;font-size:12px;border:1px solid #ccc;">${dateWithLesson}</span>`

    // Determine the correct message based on the validation result
    let message = 'Auditoorne õpe puudub'
    if (entry.validationResult) {
      if (entry.validationResult.errorType === 'no_teacher_selected') {
        message = 'Õpetaja pole valitud'
      } else if (entry.validationResult.errorType === 'both_checkboxes_selected') {
        message = 'Auditoorne õpe ja iseseisva õppe linnukesed on samaaegselt sees'
      } else if (entry.validationResult.errorType === 'lesson_with_independent_work') {
        message = 'Sissekande liik on tund, aga ainult iseseisva õppe linnuke on sees'
      } else if (entry.validationResult.errorType === 'lesson_without_auditoorne') {
        message = 'Sissekande liik on tund, aga auditoorne õpe linnuke pole sees'
      } else if (entry.validationResult.errorType === 'independent_work_with_auditory') {
        message = 'Iseseisev tööl ei saa olla auditoorne õpe linnuke sees'
      } else if (entry.validationResult.errorType === 'praktiline_too_without_praktiline_checkbox') {
        message = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees'
      } else if (entry.validationResult.errorType === 'missing_auditoorne_checkbox') {
        message = 'Auditoorne õpe puudub'
      } else if (entry.validationResult.errorType === 'missing_iseseisev_checkbox') {
        message = 'Iseseisev õpe puudub'
      } else if (entry.validationResult.errorType === 'journal_missing_independent_work') {
        message = 'Vigane sissekanne: päevikule pole määratud iseisevaid töid'
      } else if (entry.validationResult.errorType === 'missing_praktiline_checkbox') {
        message = 'Praktiline töö puudub'
      }
    }

    const action = entry.validationResult?.errorType === 'no_teacher_selected'
      ? this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
        handler: 'fixCapacity',
        entryId: entry.id,
        date: this.#formatDate(entry.entryDate),
      })
      : entry.validationResult?.errorType === 'journal_missing_independent_work'
        ? this.#createButton(`open-entry-${entry.id}`, 'Ava', 'blue', {
          handler: 'openEntry',
          entryId: entry.id,
          date: this.#formatDate(entry.entryDate),
        })
        : this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
          handler: 'fixCapacity',
          entryId: entry.id,
          date: this.#formatDate(entry.entryDate),
        })

    return `<tr style="background-color:white">
      <td style="${CENTER_STYLE}">${dateWithBadge}</td>
      <td style="${CENTER_STYLE}">${message}</td>
      <td style="${CENTER_STYLE}">${action}</td>
    </tr>`
  }

  #addCapacityProblemButtonListeners() {
    document.querySelectorAll('[data-discrepancies-table] button').forEach(/** @param {HTMLElement} button */ button => {
      if (button.dataset.handler) {
        button.addEventListener('click', event => this.#handleDiscrepancyButtonClick(event, button))
      }
    })
  }

  #highlightProblematicElements(elements, message = '', color = '#ff0000') {
    // Clean up any existing highlights first
    this.#cleanupHighlights()

    const highlights = []

    elements.forEach(element => {
      if (!element) return

      // Add border highlight directly to the element instead of creating an overlay
      element.style.border = `2px solid ${color}`
      element.style.boxShadow = `0 0 8px ${color}`
      element.dataset.capacityHighlight = 'true'

      highlights.push(element)
    })

    // Store original styles for restoration
    if (highlights.length > 0) {
      highlights.forEach(element => {
        if (!element.dataset.originalBorder) {
          element.dataset.originalBorder = element.style.border || ''
          element.dataset.originalBoxShadow = element.style.boxShadow || ''
        }
      })
    }

    // Add a message tooltip if provided
    if (message && highlights.length > 0) {
      const tooltip = document.createElement('div')
      tooltip.dataset.capacityHighlight = 'true'
      tooltip.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${color};
        color: white;
        padding: 12px 18px;
        border-radius: 8px;
        z-index: 10000;
        font-weight: bold;
        font-size: 14px;
        max-width: 350px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        border: 2px solid #ffffff;
        line-height: 1.4;
      `
      tooltip.textContent = message
      document.body.appendChild(tooltip)

    }


    // Auto-remove highlights after 15 seconds
    setTimeout(() => {
      this.#cleanupHighlights()
    }, 15000)

    return highlights
  }

  #findProblematicElementsForHighlighting(entryType, validationResult) {
    const elements = []

    // Find capacity type checkbox elements specifically
    const allCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')

    // Handle specific error types
    if (entryType === 'SISSEKANNE_T' && validationResult?.errorType === 'lesson_with_independent_work') {

      // Find and highlight both "Iseseisev õpe" (incorrectly checked) and "Praktiline töö" checkboxes
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if ((ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) ||
          (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö'))) {
          elements.push(checkbox)
        }
      })

    } else if (entryType === 'SISSEKANNE_T' && validationResult?.errorType === 'lesson_without_auditoorne') {

      // Find and highlight only "Auditoorne õpe" checkbox (should be checked but isn't)
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })

    } else if (entryType === 'SISSEKANNE_I' && validationResult?.errorType === 'independent_work_with_auditory') {

      // Find and highlight only "Auditoorne õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })

    } else if (validationResult?.errorType === 'both_checkboxes_selected') {

      // Highlight both "Auditoorne õpe" and "Iseseisev õpe" checkboxes only
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if ((ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) ||
          (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe'))) {
          elements.push(checkbox)
        }
      })

    } else if (validationResult?.errorType === 'missing_auditoorne_checkbox') {

      // Find and highlight only "Auditoorne õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
          elements.push(checkbox)
        }
      })

    } else if (validationResult?.errorType === 'missing_iseseisev_checkbox') {

      // Find and highlight only "Iseseisev õpe" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) {
          elements.push(checkbox)
        }
      })

    } else if (validationResult?.errorType === 'journal_missing_independent_work') {
      // For journal missing independent work, no specific checkbox highlighting needed
      // The issue is with journal configuration, not entry checkboxes

    } else if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {

      // Find and highlight only "Praktiline töö" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
          elements.push(checkbox)
        }
      })

    } else if (validationResult?.errorType === 'missing_praktiline_checkbox') {

      // Find and highlight only "Praktiline töö" checkbox
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
          elements.push(checkbox)
        }
      })
    }

    // Handle cases where we have entryType but no specific validation result
    else if (entryType && !validationResult?.errorType) {

      if (entryType === 'SISSEKANNE_T') {
        // For lesson entries, highlight "Auditoorne õpe" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
            elements.push(checkbox)
          }
        })

      } else if (entryType === 'SISSEKANNE_P') {
        // For practical work entries, highlight "Praktiline töö" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö')) {
            elements.push(checkbox)
          }
        })

      } else if (entryType === 'SISSEKANNE_I') {
        // For independent work entries, highlight "Iseseisev õpe" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) {
            elements.push(checkbox)
          }
        })
      }
    }

    // General fallback: if no elements found yet, highlight only the main capacity checkboxes
    if (elements.length === 0) {
      allCheckboxes.forEach(checkbox => {
        const ariaLabel = checkbox.getAttribute('aria-label') || ''
        const textContent = checkbox.textContent || ''

        // Look for any capacity-related checkboxes (including Praktiline töö)
        if ((ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) ||
          (ariaLabel.includes('Iseseisev õpe') || textContent.includes('Iseseisev õpe')) ||
          (ariaLabel.includes('Praktiline töö') || textContent.includes('Praktiline töö'))) {
          elements.push(checkbox)
        }
      })

      // If still no capacity checkboxes found, highlight ALL checkboxes for debugging
      if (elements.length === 0) {
        // Fall back to any checkbox with capacity-related ng-model or all checkboxes if none found
        const anyCapacityCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"], md-checkbox[ng-model*="capacityType"]')
        if (anyCapacityCheckboxes.length > 0) {
          anyCapacityCheckboxes.forEach(checkbox => {
            elements.push(checkbox)
          })
        } else {
          // Last resort: highlight all checkboxes
          document.querySelectorAll('md-checkbox').forEach(checkbox => {
            elements.push(checkbox)
          })
        }
      }
    }

    return [...new Set(elements)] // Remove duplicates
  }

  /**
   * @param {string} date - Entry date
   * @param {string} entryId - Entry ID
   * @param {ButtonData} data - Button data object
   */
  async #handleFixCapacity(date, entryId, data = {}) {
    try {
      const actualEntryId = entryId || data.entryid
      const duplicateIndex = data.duplicateindex || 0

      // Debug logging for entryId resolution
      Logger.debug(`[${this.name}] handleFixCapacity called with entryId=${entryId}, data.entryid=${data.entryid}, actualEntryId=${actualEntryId}`)


      // Try to refresh journal data if it's missing
      if (!this.#lastJournalData && this.#currentJournalId) {
        try {
          const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)
          this.#lastJournalData = journalData
        } catch (refreshError) {
          console.error(`[${this.name}] Failed to refresh journal data:`, refreshError)
        }
      }

      const element = await this.#findJournalEntryElement(actualEntryId, date, duplicateIndex)
      if (!element) {
        // Enhanced error logging
        const debugInfo = {
          entryId,
          actualEntryId,
          date,
          duplicateIndex,
          formattedDate: this.#formatDisplayDate(date),
          datePrefix: this.#formatDisplayDate(date).slice(0, 5),
          hasJournalData: !!this.#lastJournalData,
          entriesInCache: this.#lastJournalData?.entries?.length || 0,
          targetEntryExists: !!(this.#lastJournalData?.entries ?? []).find(entry => entry.id == actualEntryId),
          rowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"]').length,
          clickableRowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"], tr[onclick*="editJournalEntry"]').length,
          allTableRows: document.querySelectorAll('tr').length,
        }

        Logger.error(`[${this.name}] Entry element not found for ID=${actualEntryId}, date=${date}, duplicateIndex=${duplicateIndex}`, debugInfo)

        throw new Error(`entry element not found - entryId: ${entryId}, actualEntryId: ${actualEntryId}, date: ${date}, duplicateIndex: ${duplicateIndex}`)
      }


      return this.#continueFixCapacity(element, actualEntryId, date)
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  async #continueFixCapacity(element, entryId, _date) {
    try {

      // Get the entry to determine its type and validation result for highlighting
      let entryData = null
      let validationResult = null

      // First try to get from cached problematic entries (this is the most reliable source)
      if (this.#problematicEntriesCache) {
        const cachedEntry = this.#problematicEntriesCache.find(e => e.id == entryId)
        if (cachedEntry) {
          entryData = cachedEntry
          validationResult = cachedEntry.validationResult
        }
      }

      // Fallback to journal data if not found in problematic entries cache
      if (!entryData && this.#lastJournalData?.entries) {
        entryData = this.#lastJournalData.entries.find(e => e.id == entryId)
        if (entryData) {
          // Note: validationResult will be null in this case
        }
      }

      const entryType = entryData?.entryType


      // Prepare highlight message
      let highlightMessage
      if (validationResult?.errorType === 'no_teacher_selected') {
        highlightMessage = 'Õpetaja pole valitud! Palun valige õpetaja.'
      } else if (validationResult?.errorType === 'lesson_with_independent_work') {
        highlightMessage = 'Sissekande liik on tund, aga ainult iseseisva õppe linnuke on sees. Palun eemalda iseseisev õpe ja märgi auditoorne õpe!'
      } else if (validationResult?.errorType === 'lesson_without_auditoorne') {
        highlightMessage = 'Sissekande liik on tund, aga auditoorne õpe linnuke pole sees. Palun lülita auditoorne õpe sisse!'
      } else if (validationResult?.errorType === 'independent_work_with_auditory') {
        highlightMessage = 'Iseseisev tööl ei saa olla auditoorne õpe linnuke sees. Palun eemalda vale linnuke!'
      } else if (validationResult?.errorType === 'both_checkboxes_selected') {
        highlightMessage = 'Korraga ei saa auditoorne õpe ja individuaalne õpe aktiivsed olla. Palun eemalda üks linnuke!'
      } else if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {
        highlightMessage = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees. Palun lülita praktiline töö sisse!'
      } else if (validationResult?.errorType === 'missing_auditoorne_checkbox') {
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (validationResult?.errorType === 'missing_iseseisev_checkbox') {
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else if (validationResult?.errorType === 'journal_missing_independent_work') {
        highlightMessage = 'Vigane sissekanne: päevikule pole määratud iseisevaid töid. Kontrolli päeviku seadistusi!'
      } else if (validationResult?.errorType === 'missing_praktiline_checkbox') {
        highlightMessage = 'Praktiline töö linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_T') {
        // Default message for lesson entries
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_P') {
        // Default message for practical work entries
        highlightMessage = 'Praktiline töö linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_I') {
        // Default message for independent work entries
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else {
        // Fallback message
        highlightMessage = 'Kontrollige auditoorse õppe ja iseseiseva õppe linnukesi!'
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      // Wait a bit for dialog content to fully render
      await new Promise(resolve => setTimeout(resolve, 500))

      // Special handling for teacher validation issues
      if (validationResult?.errorType === 'no_teacher_selected') {
        // Auto-check teacher checkbox but don't auto-save
        await this.#checkTeacherCheckbox()

        // Highlight teacher checkboxes in green to show they were fixed
        const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')
        const teacherElements = [...teacherCheckboxes].filter(cb => this.#isElementVisible(cb))

        if (teacherElements.length > 0) {
          // Use green highlight for successful fix - no message needed
          this.#highlightProblematicElements(teacherElements, 'Õpetaja on valitud! Palun salvestage muudatused käsitsi.', '#4CAF50')
          this.#addDialogCloseListeners()
        }

        return // Exit early for teacher validation - no auto-save
      }

      // Special handling for lesson_without_auditoorne - only check capacity checkbox, not teacher
      if (validationResult?.errorType === 'lesson_without_auditoorne') {
        // Do NOT auto-check teacher checkbox for this specific error type
        // Just highlight the auditoorne checkbox and let user handle teacher selection manually
      } else {
        // Ensure teacher checkbox is always checked for other validation types
        await this.#checkTeacherCheckbox()
      }

      // Check if teacher is actually selected after auto-checking (skip for lesson_without_auditoorne)
      if (validationResult?.errorType !== 'lesson_without_auditoorne') {
        const teacherState = this.#getTeacherCheckboxState()

        // If no teacher is selected, show specific error and highlight teacher checkboxes
        if (!teacherState.hasTeacher) {
          const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')
          const teacherElements = [...teacherCheckboxes].filter(cb => this.#isElementVisible(cb))

          if (teacherElements.length > 0) {
            this.#highlightProblematicElements(teacherElements, 'Õpetaja pole valitud! Palun valige õpetaja enne salvestamist.')
            this.#addDialogCloseListeners()

            // Add event listeners to automatically clear the highlight when a teacher is selected
            this.#addTeacherSelectionMonitoring()

            return // Exit early - don't process capacity checkboxes until teacher is selected
          }
        }

        // Add teacher checkbox change listeners for validation refresh
        this.#addTeacherCheckboxListeners()
      }

      // Find and highlight problematic elements to guide the user
      const elementsToHighlight = this.#findProblematicElementsForHighlighting(entryType, validationResult)

      // Special green highlight for praktiline töö missing checkbox error
      if (validationResult?.errorType === 'praktiline_too_without_praktiline_checkbox') {
        // Find the relevant checkboxes
        const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')
        const praktiliseCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
          checkbox.getAttribute('aria-label')?.includes('Praktiline töö') ||
          checkbox.textContent.includes('Praktiline töö'))
        const iseseisvCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
          checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') ||
          checkbox.textContent.includes('Iseseisev õpe'))

        // Uncheck and highlight Iseseisev õpe in red if checked
        if (iseseisvCheckbox && iseseisvCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseisvCheckbox)
          this.#highlightProblematicElements([iseseisvCheckbox], 'Iseseisev õpe linnuke eemaldati!', '#ff0000')
        }
        // Check and highlight Praktiline töö in green if not checked
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(praktiliseCheckbox)
          this.#highlightProblematicElements([praktiliseCheckbox], highlightMessage, '#4CAF50')
        }
        this.#addDialogCloseListeners()
      } else if (elementsToHighlight.length > 0) {
        this.#highlightProblematicElements(elementsToHighlight, highlightMessage)
        // Add listeners to remove highlights when dialog is closed or saved
        this.#addDialogCloseListeners()
      } else {
        console.warn(`[${this.name}] No elements found to highlight for error type: ${validationResult?.errorType}`)
        // Show tooltip anyway to guide user
        if (highlightMessage) {
          const tooltip = document.createElement('div')
          tooltip.dataset.capacityHighlight = 'true'
          tooltip.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff0000;
            color: white;
            padding: 12px 18px;
            border-radius: 8px;
            z-index: 10000;
            font-weight: bold;
            font-size: 14px;
            max-width: 350px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            border: 2px solid #ffffff;
            line-height: 1.4;
          `
          tooltip.textContent = highlightMessage
          document.body.appendChild(tooltip)

          setTimeout(() => tooltip.remove(), 10000)
        }
      }

      // Find capacity type checkboxes
      // noinspection CssInvalidHtmlTagReference
      const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedCapacityTypes"]')
      const auditoorneCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Auditoorne õpe') ||
        checkbox.textContent.includes('Auditoorne õpe'))
      const iseseivCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') ||
        checkbox.getAttribute('aria-label')?.includes('Individuaalne õpe') ||
        checkbox.textContent.includes('Iseseisv õpe') ||
        checkbox.textContent.includes('Individuaalne õpe'))
      const praktiliseCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Praktiline töö') ||
        checkbox.textContent.includes('Praktiline töö'))

      // Special auto-fix for lesson_without_auditoorne: automatically check auditoorne õpe
      if (validationResult?.errorType === 'lesson_without_auditoorne') {
        // Auto-check the auditoorne checkbox but don't auto-save
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(auditoorneCheckbox)

          // Highlight the checkbox in green to show it was automatically fixed
          this.#highlightProblematicElements([auditoorneCheckbox], 'Auditoorne õpe on automaatselt sisse lülitatud! Palun salvestage muudatused käsitsi.', '#4CAF50')
          this.#addDialogCloseListeners()
        }
        return // Exit early - no auto-saving
      } else if (entryType === 'SISSEKANNE_I') {
        // For independent work entries: ensure iseseivCheckbox is checked, others are unchecked
        if (iseseivCheckbox && iseseivCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(iseseivCheckbox)
        }
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
      } else if (entryType === 'SISSEKANNE_P') {
        // For practical work entries: ensure praktiline töö is checked, others are unchecked
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (iseseivCheckbox && iseseivCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseivCheckbox)
        }
      } else {
        // For regular lesson entries (SISSEKANNE_T): ensure auditoorne õpe is checked, others are unchecked
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(auditoorneCheckbox)
        }
        if (iseseivCheckbox && iseseivCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseivCheckbox)
        }
        if (praktiliseCheckbox && praktiliseCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(praktiliseCheckbox)
        }
      }

      // Note: No auto-save functionality - user must manually save after making changes
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  #addTeacherSelectionMonitoring() {
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]')

    for (const checkbox of teacherCheckboxes) {
      if (checkbox && this.#isElementVisible(checkbox) && !checkbox.dataset.teacherMonitoringAdded) {
        const handleTeacherSelection = () => {
          // Small delay to let the change propagate
          setTimeout(() => {
            const teacherState = this.#getTeacherCheckboxState()
            if (teacherState.hasTeacher) {
              // Teacher is now selected, clear highlights and continue with normal validation
              this.#cleanupHighlights()
              Logger.debug(`[${this.name}] Teacher selected, continuing with capacity validation...`)
            }
          }, 200)
        }

        checkbox.addEventListener('click', handleTeacherSelection)
        checkbox.addEventListener('change', handleTeacherSelection)
        checkbox.dataset.teacherMonitoringAdded = 'true'
      }
    }
  }

  #addTeacherCheckboxListeners() {
    const teacherCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="selectedTeachers"]:not([data-teacher-listener-added])')

    for (const checkbox of teacherCheckboxes) {
      if (checkbox && this.#isElementVisible(checkbox)) {
        const handleTeacherChange = async () => {
          Logger.debug(`[${this.name}] Teacher checkbox state changed, refreshing validation...`)
          // Small delay to let the change propagate
          await this.#delay(300)
          // Refresh the capacity validation table
          await this.#refreshTableWithRetry()
        }

        // Listen for both click and change events
        checkbox.addEventListener('click', handleTeacherChange)
        checkbox.addEventListener('change', handleTeacherChange)

        // Mark this checkbox as having listeners to avoid duplicates
        checkbox.dataset.teacherListenerAdded = 'true'
      }
    }
  }

  #addDialogCloseListeners() {

    // Remove any existing listeners to avoid duplicates
    if (this.dialogCloseListener) {
      document.removeEventListener('click', this.dialogCloseListener, true)
      this.dialogCloseListener = null
    }

    // Create a listener function that will clean up highlights
    this.dialogCloseListener = event => {
      const target = event.target

      // Check if user clicked close button, cancel button, or save button
      // noinspection HtmlUnknownTag
      const isCloseButton = target.matches('md-icon[aria-label*="close"], button[aria-label*="close"], .md-dialog-close, [ng-click*="close"], [ng-click*="cancel"]')
      const isSaveButton = target.matches('button[type="submit"], button[ng-click*="save"], .md-primary, [aria-label*="save"], [ng-click*="submit"]')
      const isDialogBackdrop = target.matches('md-backdrop, .md-backdrop') ||
        (target.classList.contains('md-dialog-container') && event.target === event.currentTarget)

      // Also check if clicked element is inside a close/save button
      // noinspection HtmlUnknownTag
      const closestCloseButton = target.closest('.md-icon[aria-label*="close"], button[aria-label*="close"], .md-dialog-close, [ng-click*="close"], [ng-click*="cancel"]')
      const closestSaveButton = target.closest('button[type="submit"], button[ng-click*="save"], .md-primary, [aria-label*="save"], [ng-click*="submit"]')

      if (isCloseButton || isSaveButton || isDialogBackdrop || closestCloseButton || closestSaveButton) {

        // Small delay to allow dialog close animation
        setTimeout(() => {
          this.#cleanupHighlights()
        }, 100)
      }
    }

    // Add listener to capture clicks globally
    document.addEventListener('click', this.dialogCloseListener, true)

    // Also listen for dialog removal via mutation observer
    if (!this.dialogMutationObserver) {
      this.dialogMutationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.removedNodes.forEach(/** @param {Element} node */ node => {
            // Check if a dialog was removed
            if (node.nodeType === Node.ELEMENT_NODE &&
              (node.matches('md-dialog') || node.querySelector('md-dialog'))) {
              this.#cleanupHighlights()
            }
          })
        })
      })

      this.dialogMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }
  }

  #cleanupHighlights() {
    // Remove only tooltip popups (not checkboxes)
    document.querySelectorAll('[data-capacity-highlight="true"]').forEach(el => {
      if (el.tagName === 'MD-CHECKBOX') {
        // Restore original styles and remove highlight attribute
        if (el.dataset.originalBorder !== undefined) {
          el.style.border = el.dataset.originalBorder
          delete el.dataset.originalBorder
        } else {
          el.style.border = ''
        }
        if (el.dataset.originalBoxShadow !== undefined) {
          el.style.boxShadow = el.dataset.originalBoxShadow
          delete el.dataset.originalBoxShadow
        } else {
          el.style.boxShadow = ''
        }
        el.removeAttribute('data-capacity-highlight')
      } else {
        // Remove tooltip or other non-checkbox highlight
        el.remove()
      }
    })
    // Clean up dialog close observer if present
    if (this.#dialogCloseObserver) {
      this.#dialogCloseObserver.disconnect()
      this.#dialogCloseObserver = null
    }
  }

  /**
   * Handle opening a journal entry and highlighting the entry type field
   * @param {string} entryId - Entry ID
   * @param {Object} data - Button data object
   */
  async #handleOpenEntry(entryId, data = {}) {
    try {
      const actualEntryId = entryId || data.entryid
      Logger.debug(`[${this.name}] handleOpenEntry called with entryId=${entryId}, actualEntryId=${actualEntryId}`)

      // Find the journal entry element and click it to open
      const element = await this.#findJournalEntryElement(actualEntryId, data.date)
      if (!element) {
        Logger.error(`[${this.name}] Could not find journal entry element for ID: ${actualEntryId}`)
        return
      }

      // Click the element to open the entry dialog
      await this.#clickElement(element)

      // Wait for the dialog to open
      await this.#waitForElement('md-dialog', 5000)

      // Find and highlight the "Sissekande liik" (Entry type) field
      setTimeout(() => {
        this.#highlightEntryTypeField()
      }, 500) // Small delay to ensure dialog is fully loaded

    } catch (error) {
      Logger.error(`[${this.name}] Error in handleOpenEntry:`, error)
    }
  }

  /**
   * Find and highlight the entry type field with a red box
   */
  #highlightEntryTypeField() {
    try {
      // Look for entry type related elements
      const entryTypeSelectors = [
        'md-select[ng-model*="entryType"]',
        'md-select[ng-model*="EntryType"]',
        'md-select[aria-label*="sissekande liik"]',
        'md-select[aria-label*="Sissekande liik"]',
        'select[ng-model*="entryType"]',
        '[ng-model*="entryType"]'
      ]

      let entryTypeElement = null

      for (const selector of entryTypeSelectors) {
        entryTypeElement = document.querySelector(selector)
        if (entryTypeElement) {
          Logger.debug(`[${this.name}] Found entry type element with selector: ${selector}`)
          break
        }
      }

      // If not found, try finding by text content
      if (!entryTypeElement) {
        const labels = document.querySelectorAll('label, .md-input-label, md-input-container label')
        for (const label of labels) {
          if (label.textContent.toLowerCase().includes('sissekande liik') || 
              label.textContent.toLowerCase().includes('sissekannetüüp')) {
            // Look for nearby input/select elements
            const parent = label.closest('md-input-container, .md-input-container, md-select, .form-group')
            if (parent) {
              entryTypeElement = parent.querySelector('md-select, select, input') || parent
              Logger.debug(`[${this.name}] Found entry type element by label text`)
              break
            }
          }
        }
      }

      if (entryTypeElement) {
        // Create and apply red highlight
        const highlightBox = document.createElement('div')
        highlightBox.dataset.entryTypeHighlight = 'true'
        highlightBox.style.cssText = `
          position: absolute;
          border: 3px solid #ff0000;
          background: rgba(255, 0, 0, 0.1);
          pointer-events: none;
          z-index: 10000;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
        `

        // Position the highlight box over the element
        const rect = entryTypeElement.getBoundingClientRect()
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft

        highlightBox.style.top = (rect.top + scrollTop - 2) + 'px'
        highlightBox.style.left = (rect.left + scrollLeft - 2) + 'px'
        highlightBox.style.width = (rect.width + 4) + 'px'
        highlightBox.style.height = (rect.height + 4) + 'px'

        document.body.appendChild(highlightBox)

        // Add tooltip message
        const tooltip = document.createElement('div')
        tooltip.dataset.entryTypeTooltip = 'true'
        tooltip.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #ff0000;
          color: white;
          padding: 12px 18px;
          border-radius: 8px;
          z-index: 10001;
          font-weight: bold;
          font-size: 14px;
          max-width: 350px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          border: 2px solid #ffffff;
          line-height: 1.4;
        `
        tooltip.textContent = 'Vigane sissekanne: Kontrollige sissekande liiki! See peaks olema õige tüüp päeviku seadistuste järgi.'
        document.body.appendChild(tooltip)

        // Add cleanup listener for dialog close
        this.#addEntryTypeHighlightCleanup()

        Logger.debug(`[${this.name}] Entry type field highlighted`)
      } else {
        Logger.warn(`[${this.name}] Could not find entry type field to highlight`)
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error highlighting entry type field:`, error)
    }
  }

  /**
   * Add listeners to clean up entry type highlights when dialog is closed or entry type is clicked
   */
  #addEntryTypeHighlightCleanup() {
    const cleanupHighlights = () => {
      // Remove highlight box
      document.querySelectorAll('[data-entry-type-highlight="true"]').forEach(el => el.remove())
      // Remove tooltip
      document.querySelectorAll('[data-entry-type-tooltip="true"]').forEach(el => el.remove())
    }

    // Listen for clicks on entry type elements to remove highlight when user interacts
    const addEntryTypeClickListeners = () => {
      const entryTypeSelectors = [
        'md-select[ng-model*="entryType"]',
        'md-select[ng-model*="EntryType"]',
        'md-select[aria-label*="sissekande liik"]',
        'md-select[aria-label*="Sissekande liik"]',
        'select[ng-model*="entryType"]',
        '[ng-model*="entryType"]'
      ]

      entryTypeSelectors.forEach(selector => {
        const element = document.querySelector(selector)
        if (element && !element.dataset.highlightCleanupAdded) {
          element.dataset.highlightCleanupAdded = 'true'
          element.addEventListener('click', cleanupHighlights, { once: true })
          element.addEventListener('focus', cleanupHighlights, { once: true })
          Logger.debug(`[${this.name}] Added cleanup listener to entry type element: ${selector}`)
        }
      })

      // Also look for entry type elements by label text
      const labels = document.querySelectorAll('label, .md-input-label, md-input-container label')
      labels.forEach(label => {
        if (label.textContent.toLowerCase().includes('sissekande liik') || 
            label.textContent.toLowerCase().includes('sissekannetüüp')) {
          const parent = label.closest('md-input-container, .md-input-container, md-select, .form-group')
          if (parent) {
            const entryTypeElement = parent.querySelector('md-select, select, input')
            if (entryTypeElement && !entryTypeElement.dataset.highlightCleanupAdded) {
              entryTypeElement.dataset.highlightCleanupAdded = 'true'
              entryTypeElement.addEventListener('click', cleanupHighlights, { once: true })
              entryTypeElement.addEventListener('focus', cleanupHighlights, { once: true })
              Logger.debug(`[${this.name}] Added cleanup listener to entry type element found by label`)
            }
          }
        }
      })
    }

    // Add entry type click listeners with a small delay to ensure elements are loaded
    setTimeout(addEntryTypeClickListeners, 100)

    // Listen for dialog close
    const dialog = document.querySelector('md-dialog')
    if (dialog) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            mutation.removedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE && 
                  (node.matches('md-dialog') || node.querySelector('md-dialog'))) {
                cleanupHighlights()
                observer.disconnect()
              }
            })
          }
        })
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    // Also clean up after 30 seconds as fallback
    setTimeout(cleanupHighlights, 30000)
  }
}
