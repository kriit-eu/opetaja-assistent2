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
  #isRefreshing = false
  #lastJournalData = null
  #originalFetch = null
  #problematicEntriesCache = null

  static SCHOOL_ID_FALLBACK = 9
  static JOURNAL_ENTRY_LESSON_TYPE = 'SISSEKANNE_T'

  constructor () {
    super('lessonDiscrepancies', /\/journal\/\d+\/edit/)
    this.name = 'LessonDiscrepanciesFeature'
  }

  async activate () {
    this.reset()
    await this.#clearStaleCache()
    await this.#delay(1000)
    await this.#createLessonDiscrepanciesTable()
    this.#setupJournalSaveMonitoring()
  }

  onDeactivate () {
    this.#cleanupMonitoring()
    this.reset()
    super.onDeactivate()
  }

  reset () {
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

  async #clearStaleCache () {
    const journalId = this.#extractJournalId()
    if (journalId) {
      await cacheService.clearJournalCache(journalId)
    }
  }

  async #createLessonDiscrepanciesTable (forceRefresh = false) {
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

  async #fetchJournalAndTimetableData (journalId, forceRefresh = false) {
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

  #getCurrentStudyYearDates () {
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
  async #fetchTimetableData (info, forceRefresh = false) {
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

  async #fetchLessonTimes (schoolId = LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK) {
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

  async #calculateLessonNumber (timeStart, schoolId) {
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

  #aggregateJournalEntries (entries) {
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

  async #aggregateTimetableEvents (events, schoolId) {
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

  async #findLessonDiscrepancies (journal, timetable) {
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

  async #convertDifferencesToDiscrepancies (differences, journal, timetable) {
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


  async #createMissingLessonDiscrepancies ({ date, tEntries }, journal, discrepancies) {
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

  async #createLessonMismatchDiscrepancies (data, journal, discrepancies) {
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

  #calculateDuplicateIndex (discrepancy) {
    // Use the same logic as #findJournalEntryElement to ensure consistency
    const duplicateInfo = this.#findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    return duplicateInfo.targetIndex
  }

  #findDuplicateMatches (entryId, date) {
    if (!this.#lastJournalData?.entries) {
      Logger.warning(`No journal data available for findDuplicateMatches`)
      return { exactMatches: [], targetIndex: 0 }
    }

    const targetEntry = this.#lastJournalData.entries.find(entry => entry.id == entryId)
    if (!targetEntry) {
      Logger.warning(`Target entry ${entryId} not found in journal data`)
      return { exactMatches: [], targetIndex: 0 }
    }

    // Get all rows that match the date
    const datePrefix = this.#formatDisplayDate(date).slice(0, 5)
    const allRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"]')
    const dateMatchingRows = [...allRows].filter(row => row.textContent.includes(datePrefix))

    // Filter by lesson count and type to get the exact matches in DOM order
    const exactMatches = dateMatchingRows.filter(row => {
      const { lessonCount, entryType } = this.#parseRowLessonInfo(row)
      return lessonCount === targetEntry.lessons && entryType === targetEntry.entryType
    })

    // For single matches, index is always 0
    if (exactMatches.length <= 1) {
      return { exactMatches, targetIndex: 0 }
    }

    // Find all duplicate entries in API data, sorted by ID (for consistent ordering)
    const duplicateEntries = this.#lastJournalData.entries.filter(entry => this.#formatDate(entry.entryDate) === this.#formatDate(targetEntry.entryDate) &&
      entry.lessons === targetEntry.lessons &&
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

  #createButton (id, text, colorKey, data = {}, tooltip = '') {
    const dataAttributes = Object.entries(data)
      .map(([key, value]) => `data-${key}='${JSON.stringify(value)}'`)
      .join(' ')
    const titleAttribute = tooltip ? `title="${tooltip}"` : ''
    return `<button id="${id}" style="${createButtonStyle(HEX[colorKey])}" ${dataAttributes} ${titleAttribute}>${text}</button>`
  }

  #renderMissingEntry (discrepancy) {
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

  #renderSingleEntryFix (discrepancy) {
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

  #renderMultiEntryFix (discrepancy) {
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

  #createDiscrepancyRow (discrepancy) {
    const renderers = {
      missingJournalEntry: this.#renderMissingEntry,
      singleEntryFix: this.#renderSingleEntryFix,
      multiEntryFix: this.#renderMultiEntryFix,
    }
    const renderer = renderers[discrepancy.type] || this.#renderSingleEntryFix
    const { start, count, action } = renderer.call(this, discrepancy)
    return `<tr style="background-color:white"><td style="${CELL_STYLE}">${this.#formatDisplayDate(discrepancy.date)}</td><td style="${CENTER_STYLE}">${start}</td><td style="${CENTER_STYLE}">${count}</td><td style="${CENTER_STYLE}">${action}</td></tr>`
  }

  #findInsertionPoint () {
    const selectors = ['md-content .layout-padding', '.layout-padding', 'md-content', '#main-content', '.main-content', 'main']
    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => element && element.getBoundingClientRect().width > 100) || document.body
  }

  #insertUnifiedTable (discrepancies, capacityProblems) {
    try {
      document.querySelector('[data-discrepancies-table]')?.remove()
      document.querySelector('[data-capacity-problems-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      insertionPoint.insertBefore(this.#createUnifiedTableElement(discrepancies, capacityProblems), insertionPoint.firstChild)
      this.#addDiscrepancyButtonListeners()
      this.#addCapacityProblemButtonListeners()
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert unified table`, error)
      return false
    }
  }

  #createUnifiedTableElement (discrepancies, capacityProblems) {
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

  #createTimetableSection (discrepancies) {
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

  #createCapacitySection (capacityProblems) {
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

  #addDiscrepancyButtonListeners () {
    const buttons = document.querySelectorAll('[data-discrepancies-table] button')
    buttons.forEach(/** @param {HTMLElement} button */ button => {
      if (button.dataset.handler) {
        button.addEventListener('click', event => this.#handleDiscrepancyButtonClick(event, button))
      }
    })
  }

  async #handleDiscrepancyButtonClick (event, button) {
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

  #captureButtonState (button) {
    return {
      text: button.textContent,
      background: button.style.background,
      opacity: button.style.opacity,
      cursor: button.style.cursor,
    }
  }

  #setButtonProcessingState (button) {
    button.disabled = true
    button.style.background = '#6c757d'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'
  }

  #parseButtonData (button) {
    return Object.fromEntries(Object.entries(button.dataset).map(([key, value]) => [key, JSON.parse(value)]))
  }

  async #executeButtonAction (data) {
    const actionHandlers = {
      addMissing: () => this.#handleAddMissingEntry(data.date, data.startLesson, data.lessonCount, data),
      editEntry: () => this.#handleEditEntry(data.date, data.entryId, data.type, data),
      fixCapacity: () => this.#handleFixCapacity(data.date, data.entryId, data),
    }

    const handler = actionHandlers[data.handler]
    if (handler) {
      await handler()
    } else {
      Logger.warning(`[${this.name}] Unknown handler: ${data.handler}`)
    }
  }

  #restoreButtonState (button, originalState) {
    setTimeout(() => {
      button.disabled = false
      button.textContent = originalState.text
      button.style.background = originalState.background
      button.style.opacity = originalState.opacity || ''
      button.style.cursor = originalState.cursor || ''
    }, 2000)
  }

  async #handleAddMissingEntry (date, start, count, timetableData = {}) {
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
  async #handleEditEntry (date, entryId, type, data) {
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

  async #findAndClickAddButton () {
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


  async #fillAddForm (date, start, count, timetableData) {
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
    ])
  }

  async #fillEditForm (type, data) {
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
  async #fillSingleEntryForm (data) {
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

  #isValidValue (value) {
    return value !== Infinity && value !== -Infinity && !isNaN(value) && value != null
  }

  #setFieldState (field, state) {
    const colors = {
      processing: '#DAA520',
      success: '#006400',
      error: '#dc3545',
    }
    field.style.border = `3px solid ${colors[state]}`
  }

  async #fillFieldWithVisualFeedback (selectors, value, logName) {
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

  async #fillStartLessonField (value) {
    const selectors = [
      'md-select[aria-label*="Algustund"]',
      'md-select[ng-model*="startLessonNr"]',
      '#select_89',
    ]
    return this.#fillFieldWithVisualFeedback(selectors, value, 'Start lesson')
  }

  async #fillLessonCountField (value) {
    const selectors = [
      'input[aria-label="lessons"]',
      'input[ng-model*="lessons"]',
      '#input_69',
    ]
    return this.#fillFieldWithVisualFeedback(selectors, value, 'Lesson count')
  }


  async #fillInputField (field, value) {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  async #selectMdSelectOption (field, value) {
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

  async #getOrWaitForContentId (field) {
    const existingId = field.getAttribute('aria-owns')
    if (existingId) return existingId

    try {
      return await this.#waitForAttributeToAppear(field, 'aria-owns', 3000)
    } catch {
      return null
    }
  }


  async #waitForAttributeToAppear (element, attribute, timeout = 3000) {
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

  async #waitForElement (selector, timeout = 3000) {
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

  async #clickElement (element, delay = 500) {
    await this.#clickElementWithScrollPreservation(element)
    await this.#delay(delay)
  }

  #createScrollPreservation () {
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

  async #clickElementWithScrollPreservation (element) {
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

  #findVisibleElement (selectors) {
    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => this.#isElementVisible(element))
  }

  async #findJournalEntryElement (entryId, date, duplicateIndex = 0) {

    const { exactMatches } = this.#findDuplicateMatches(entryId, date)


    if (exactMatches.length === 0) {
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

  #parseRowLessonInfo (row) {
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
      } else if (text.includes('E-õpe')) {
        entryType = 'SISSEKANNE_E'
      }
    }

    return { lessonCount, entryType }
  }


  async #clickJournalEntry (element) {
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

  async #performDoubleClick (element) {
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

  async #waitForDialogToOpen (timeout = 15000) {
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

  async #waitForDialogContentLoaded (timeout = 15000) {
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


  async #isEditFormOpen () {
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

  async #checkAuditoriumLearningCheckbox () {
    /** @type {HTMLElement} */
    const checkbox = document.querySelector('md-checkbox[aria-label="Auditoorne õpe"]')

    if (checkbox && this.#isElementVisible(checkbox)) {
      this.#setFieldState(checkbox, 'processing')
      checkbox.click()
      const isChecked = checkbox.getAttribute('aria-checked') === 'true'
      this.#setFieldState(checkbox, isChecked ? 'success' : 'error')
    }
  }

  async #refreshTableWithRetry (maxRetries = 3) {
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

  #getCurrentDiscrepancyCount () {
    const table = document.querySelector('[data-discrepancies-table]')
    return table ? table.querySelectorAll('tbody tr').length : 0
  }

  async #performRefreshAttempt (journalId) {
    await cacheService.clearJournalCache(journalId)
    await cacheService.clearCache()
    this.#tableCreated = false
    this.#currentJournalId = null
    await this.#delay(300)
    await this.#createLessonDiscrepanciesTable(true)
  }

  #isRefreshSuccessful (oldCount, newCount, attempt, maxAttempts) {
    return newCount < oldCount ||
      !document.querySelector('[data-discrepancies-table]') ||
      attempt === maxAttempts
  }

  #setupJournalSaveMonitoring () {
    if (this.#saveMonitoringSetup) return

    this.#setupJournalTableMonitoring()
    this.#setupJournalDialogSaveMonitoring()
    this.#saveMonitoringSetup = true
  }

  #setupJournalTableMonitoring () {
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

  #setupJournalDialogSaveMonitoring () {
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

  async #refreshCapacityValidationAfterSave () {
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

  #cleanupMonitoring () {
    this.#tableObserver?.disconnect()
    this.#tableObserver = null

    // Restore original fetch if we modified it
    if (this.#originalFetch) {
      window.fetch = this.#originalFetch
      this.#originalFetch = null
    }

    this.#saveMonitoringSetup = false
  }

  async #getCapacityTypeProblems (journalData) {
    try {

      // First check if there's a discrepancy between planned and used hours for "MAHT_a"
      const capacityHours = journalData.info?.lessonHours?.capacityHours || []
      const auditoorneCapacity = capacityHours.find(c => c.capacity === 'MAHT_a')

      // Log capacity type code mappings

      // Get detailed capacity validation results
      const validationResults = await this.#performDetailedCapacityValidation(journalData, auditoorneCapacity)


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

  async #performDetailedCapacityValidation (journalData, auditoorneCapacity) {

    const entries = journalData.entries || []
    const journalId = journalData.info?.id


    // Filter entries by type with detailed logging
    const targetEntries = entries.filter(entry => entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_I')


    // Verify string comparison logic

    if (targetEntries.length === 0) {
      return
    }

    // Fetch detailed data for each target entry
    const validationResults = await this.#validateEntriesWithDetailedData(journalId, targetEntries)

    // Log validation summary
    this.#logValidationSummary(validationResults, auditoorneCapacity)


    // Return validation results
    return validationResults
  }

  async #validateEntriesWithDetailedData (journalId, targetEntries) {

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
        const validationResult = this.#validateSingleEntry(entry, detailedEntry, capacityTypes)
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

  #validateSingleEntry (entry, detailedEntry, capacityTypes) {

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
        },
        expectedState: {
          auditoorne: true,
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
        },
        expectedState: {
          auditoorne: true,
          reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe',
        },
      }
    }

    // Detect checkbox states using different methods

    // Method 1: Array.includes()
    const hasAuditoorneIncludes = capacityTypes.includes('MAHT_a')
    const hasIseseisvIncludes = capacityTypes.includes('MAHT_i')
    const hasPraktiliseIncludes = capacityTypes.includes('MAHT_p')

    // Using includes() as the primary method

    return this.#performBusinessLogicValidation(entry, detailedEntry, {
      auditoorne: hasAuditoorneIncludes,
      iseseisev: hasIseseisvIncludes,
      praktiline: hasPraktiliseIncludes,
    }, capacityTypes)
  }

  #performBusinessLogicValidation (entry, detailedEntry, actualState, capacityTypes) {

    // Log the business rules

    // Determine expected state based on entry type
    const shouldHaveAuditoorne = entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P'
    const shouldHaveIseseisev = entry.entryType === 'SISSEKANNE_I'
    const shouldHavePraktiline = entry.entryType === 'SISSEKANNE_P'
    const expectedState = {
      auditoorne: shouldHaveAuditoorne,
      iseseisev: shouldHaveIseseisev,
      praktiline: shouldHavePraktiline,
      reasoning: shouldHaveAuditoorne
        ? `Entry type "${entry.entryType}" requires auditoorne õpe checkbox`
        : shouldHaveIseseisev
          ? `Entry type "${entry.entryType}" requires iseseisev õpe checkbox`
          : shouldHavePraktiline
            ? `Entry type "${entry.entryType}" requires praktiline töö checkbox`
            : `Entry type "${entry.entryType}" has specific checkbox requirements`,
    }


    // Check for error condition: both checkboxes selected
    const hasBothCheckboxes = actualState.auditoorne && actualState.iseseisev
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
    const isLessonWithIndependentWork = entry.entryType === 'SISSEKANNE_T' && actualState.iseseisev && !actualState.auditoorne
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
    const isIndependentWorkWithAuditory = entry.entryType === 'SISSEKANNE_I' && actualState.auditoorne && !actualState.iseseisev
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
    const iseseisvValid = actualState.iseseisev === expectedState.iseseisev
    const praktiliseValid = actualState.praktiline === expectedState.praktiline
    const isValid = auditoorneValid && iseseisvValid && praktiliseValid
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

  #logValidationSummary (validationResults, auditoorneCapacity) {


    // Log detailed results for each entry

    // Log specific entry IDs that are failing each type of validation

    // Root cause analysis logging
    this.#logRootCauseAnalysis(validationResults, auditoorneCapacity)
  }

  #logRootCauseAnalysis (validationResults, _auditoorneCapacity) {

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
  #createCapacityProblemRow (entry) {
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
      if (entry.validationResult.errorType === 'both_checkboxes_selected') {
        message = 'Auditoorne õpe ja iseseisva õppe linnukesed on samaaegselt sees'
      } else if (entry.validationResult.errorType === 'lesson_with_independent_work') {
        message = 'Sissekande liik on tund, aga ainult iseseisva õppe linnuke on sees'
      } else if (entry.validationResult.errorType === 'independent_work_with_auditory') {
        message = 'Iseseisev tööl ei saa olla auditoorne õpe linnuke sees'
      } else if (entry.validationResult.errorType === 'praktiline_too_without_praktiline_checkbox') {
        message = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees'
      } else if (entry.validationResult.errorType === 'missing_auditoorne_checkbox') {
        message = 'Auditoorne õpe puudub'
      } else if (entry.validationResult.errorType === 'missing_iseseisev_checkbox') {
        message = 'Iseseisev õpe puudub'
      } else if (entry.validationResult.errorType === 'missing_praktiline_checkbox') {
        message = 'Praktiline töö puudub'
      }
    }

    const action = this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
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

  #addCapacityProblemButtonListeners () {
    document.querySelectorAll('[data-capacity-problems-table] button').forEach(/** @param {HTMLElement} button */ button => {
      if (button.dataset.handler) {
        button.addEventListener('click', event => this.#handleDiscrepancyButtonClick(event, button))
      }
    })
  }

  #highlightProblematicElements (elements, message = '') {
    // Clean up any existing highlights first
    this.#cleanupHighlights()

    const highlights = []

    elements.forEach((element, index) => {
      if (!element) return

      // Create fixed overlay div that follows the element when scrolling
      const highlight = document.createElement('div')
      highlight.dataset.capacityHighlight = 'true'
      highlight.dataset.targetElement = index
      highlight.style.cssText = `
        position: fixed;
        border: 2px solid #ff0000;
        border-radius: 10px;
        pointer-events: none;
        z-index: 9998;
        box-shadow: 0 0 15px rgba(255, 0, 0, 0.6);
        background: rgba(255, 0, 0, 0.05);
      `

      // Function to update highlight position based on element's current position
      const updatePosition = () => {
        if (!element.isConnected) {
          highlight.remove()
          return
        }

        const rect = element.getBoundingClientRect()
        // Only show highlight if element is visible in viewport
        if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
          highlight.style.top = `${rect.top - 2}px`
          highlight.style.left = `${rect.left - 2}px`
          highlight.style.width = `${rect.width + 4}px`
          highlight.style.height = `${rect.height + 4}px`
          highlight.style.display = 'block'
        } else {
          highlight.style.display = 'none'
        }
      }

      // Initial position
      updatePosition()

      // Store the update function and element reference
      highlight.updatePosition = updatePosition
      highlight.targetElement = element

      document.body.appendChild(highlight)
      highlights.push(highlight)

    })

    // Add scroll listener to update all highlight positions when user scrolls
    if (highlights.length > 0) {
      this.highlightScrollListener = () => {
        highlights.forEach(highlight => {
          if (highlight.updatePosition && highlight.targetElement && highlight.targetElement.isConnected) {
            highlight.updatePosition()
          }
        })
      }

      // Listen to scroll events on window and all scrollable containers
      window.addEventListener('scroll', this.highlightScrollListener, true)
      document.addEventListener('scroll', this.highlightScrollListener, true)

    }

    // Add a message tooltip if provided
    if (message && highlights.length > 0) {
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
      tooltip.textContent = message
      document.body.appendChild(tooltip)

    }


    // Auto-remove highlights after 15 seconds
    setTimeout(() => {
      this.#cleanupHighlights()
    }, 15000)

    return highlights
  }

  #findProblematicElementsForHighlighting (entryType, validationResult) {
    const elements = []

    // Find all checkbox elements specifically
    const allCheckboxes = document.querySelectorAll('md-checkbox')

    // Handle specific error types first
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

      if (entryType === 'SISSEKANNE_T' || entryType === 'SISSEKANNE_P') {
        // For lesson entries, highlight "Auditoorne õpe" as it's likely missing
        allCheckboxes.forEach(checkbox => {
          const ariaLabel = checkbox.getAttribute('aria-label') || ''
          const textContent = checkbox.textContent || ''

          if (ariaLabel.includes('Auditoorne õpe') || textContent.includes('Auditoorne õpe')) {
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

      // If still no capacity checkboxes found, highlight ALL checkboxes in the dialog for debugging
      if (elements.length === 0) {
        allCheckboxes.forEach(checkbox => {
          elements.push(checkbox)
        })
      }
    }

    return [...new Set(elements)] // Remove duplicates
  }

  /**
   * @param {string} date - Entry date
   * @param {string} entryId - Entry ID
   * @param {ButtonData} data - Button data object
   */
  async #handleFixCapacity (date, entryId, data = {}) {
    try {
      const duplicateIndex = data.duplicateindex || 0


      // Try to refresh journal data if it's missing
      if (!this.#lastJournalData && this.#currentJournalId) {
        try {
          const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)
          this.#lastJournalData = journalData
        } catch (refreshError) {
          console.error(`[${this.name}] Failed to refresh journal data:`, refreshError)
        }
      }

      const element = await this.#findJournalEntryElement(entryId, date, duplicateIndex)
      if (!element) {
        // Enhanced error logging
        const debugInfo = {
          entryId,
          date,
          duplicateIndex,
          formattedDate: this.#formatDisplayDate(date),
          datePrefix: this.#formatDisplayDate(date).slice(0, 5),
          hasJournalData: !!this.#lastJournalData,
          entriesInCache: this.#lastJournalData?.entries?.length || 0,
          targetEntryExists: !!(this.#lastJournalData?.entries ?? []).find(entry => entry.id == entryId),
          rowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"]').length,
          clickableRowsFound: document.querySelectorAll('tr[ng-click*="editJournalEntry"], tr[onclick*="editJournalEntry"]').length,
          allTableRows: document.querySelectorAll('tr').length,
        }

        Logger.error(`[${this.name}] Entry element not found for ID=${entryId}, date=${date}, duplicateIndex=${duplicateIndex}`, debugInfo)

        throw new Error(`entry element not found - entryId: ${entryId}, date: ${date}, duplicateIndex: ${duplicateIndex}`)
      }


      return this.#continueFixCapacity(element, entryId, date)
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  async #continueFixCapacity (element, entryId, _date) {
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
      if (validationResult?.errorType === 'lesson_with_independent_work') {
        highlightMessage = 'Sissekande liik on tund, aga ainult iseseisva õppe linnuke on sees. Palun eemalda iseseisev õpe ja märgi praktiline töö!'
      } else if (validationResult?.errorType === 'independent_work_with_auditory') {
        highlightMessage = 'Iseseisel tööl ei saa olla auditoorne õpe linnuke sees. Palun eemalda vale linnuke!'
      } else if (validationResult?.errorType === 'both_checkboxes_selected') {
        highlightMessage = 'Korraga ei saa auditoorne õpe ja individuaalne õpe aktiivsed olla. Palun eemalda üks linnuke!'
      } else if (validationResult?.errorType === 'missing_auditoorne_checkbox') {
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (validationResult?.errorType === 'missing_iseseisev_checkbox') {
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_T' || entryType === 'SISSEKANNE_P') {
        // Default message for lesson entries
        highlightMessage = 'Auditoorne õpe linnuke puudub. Palun lülita see sisse!'
      } else if (entryType === 'SISSEKANNE_I') {
        // Default message for independent work entries
        highlightMessage = 'Iseseisev õpe linnuke puudub. Palun lülita see sisse!'
      } else {
        // Fallback message
        highlightMessage = 'Kontrollige auditoorse õppe ja iseseisva õppe linnukesi!'
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      // Wait a bit for dialog content to fully render
      await new Promise(resolve => setTimeout(resolve, 500))

      // Find and highlight problematic elements to guide the user
      const elementsToHighlight = this.#findProblematicElementsForHighlighting(entryType, validationResult)


      if (elementsToHighlight.length > 0) {
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
      const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="capacityType"]')
      const auditoorneCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Auditoorne õpe') ||
        checkbox.textContent.includes('Auditoorne õpe'))
      const iseseivCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') ||
        checkbox.getAttribute('aria-label')?.includes('Individuaalne õpe') ||
        checkbox.textContent.includes('Iseseisev õpe') ||
        checkbox.textContent.includes('Individuaalne õpe'))

      let needsSave = false

      if (entryType === 'SISSEKANNE_I') {
        // For independent work entries: ensure iseseisev õpe is checked, auditoorne õpe is unchecked
        if (iseseivCheckbox && iseseivCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(iseseivCheckbox)
          needsSave = true
        }
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(auditoorneCheckbox)
          needsSave = true
        }
      } else {
        // For lesson entries (SISSEKANNE_T/P): ensure auditoorne õpe is checked, iseseisev õpe is unchecked
        if (auditoorneCheckbox && auditoorneCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(auditoorneCheckbox)
          needsSave = true
        }
        if (iseseivCheckbox && iseseivCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseivCheckbox)
          needsSave = true
        }
      }

      if (needsSave) {
        // Find and click the save button
        const saveButton = document.querySelector('button[ng-click*="save"]')
        if (saveButton) {
          await this.#clickElement(saveButton)

          // Refresh the table after saving
          setTimeout(() => this.#refreshTableWithRetry(), 1000)
        }
      }
    } catch (error) {
      Logger.error(`[${this.name}] fix capacity error`, error)
    }
  }

  #addDialogCloseListeners () {

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

  #cleanupHighlights () {

    // Remove all highlight overlays
    const remainingHighlights = document.querySelectorAll('[data-capacity-highlight]')
    remainingHighlights.forEach(highlight => highlight.remove())

    // Remove scroll listeners
    if (this.highlightScrollListener) {
      window.removeEventListener('scroll', this.highlightScrollListener, true)
      document.removeEventListener('scroll', this.highlightScrollListener, true)
      this.highlightScrollListener = null
    }

    // Clean up dialog listeners
    if (this.dialogCloseListener) {
      document.removeEventListener('click', this.dialogCloseListener, true)
      this.dialogCloseListener = null
    }

    if (this.dialogMutationObserver) {
      this.dialogMutationObserver.disconnect()
      this.dialogMutationObserver = null
    }

  }
}
