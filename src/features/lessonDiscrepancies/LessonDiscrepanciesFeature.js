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
  `font-size:12px;font-weight:bold;cursor:pointer;` +
  `" onmouseover="this.style.background='${hover}'" onmouseout="this.style.background='${bg}'`

const CELL_STYLE = 'padding:6px 8px;border:1px solid #dee2e6;font-size:14px;'
const CENTER_STYLE = CELL_STYLE + 'text-align:center;'

export default class LessonDiscrepanciesFeature extends BaseFeature {
  #tableCreated = false
  #currentJournalId = null
  #saveMonitoringSetup = false
  #tableObserver = null
  #isRefreshing = false
  #lastJournalData = null
  #originalFetch = null

  static SCHOOL_ID_FALLBACK = 9
  static JOURNAL_ENTRY_LESSON_TYPE = 'SISSEKANNE_T'

  constructor() {
    super('lessonDiscrepancies', /\/journal\/\d+\/edit/)
    this.name = 'LessonDiscrepanciesFeature'
    this.api.cache = cacheService
  }

  async activate() {
    this.reset()
    await this.#clearStaleCache()
    await this.#delay(1000)
    await this.#createLessonDiscrepanciesTable()
    this.#setupJournalSaveMonitoring()
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

  #delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  #formatDate = (date) => {
    try {
      return new Date(date).toISOString().split('T')[0]
    } catch {
      return null
    }
  }

  #formatDisplayDate = (date) => {
    const dateObj = new Date(date)
    const day = dateObj.getDate().toString().padStart(2, '0')
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}.${month}.${year}`
  }

  #isElementVisible = (element) => {
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
      await this.api.cache.clearJournalCache(journalId)
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

    const info = await this.api.tahvel.get(`/journals/${journalId}`, params, { cacheExpiration: 864e5 })
    const entries = await this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, entriesParams, { cacheExpiration })
    const timetable = await this.#fetchTimetableData(info, forceRefresh)
    return {
      journalData: { info, entries: entries ?? [] },
      timetableData: timetable ?? []
    }
  }

  #getCurrentStudyYearDates() {
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    return {
      from: new Date(Date.UTC(studyYear, 8, 1)).toISOString(),
      thru: new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    }
  }

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
      const data = await this.api.tahvel.get(endpoint, params, { cacheExpiration })
      return data?.timetableEvents?.filter(event => event.journalId === info.id) ?? []
    } catch (error) {
      Logger.warning(`[${this.name}] timetable`, error.message)
      return []
    }
  }

  async #fetchLessonTimes(schoolId = LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'loadLessonTimes' }, (response) => {
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
      timeMs: new Date(`1970-01-01T${lesson.timeStart}`).getTime()
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
          tEntries: timetableEntries
        }, journal, discrepancies)
      }
    }

    return discrepancies
  }



  async #createMissingLessonDiscrepancies({ date, tEntries }, journal, discrepancies) {
    const schoolId = journal.info.school?.id ?? LessonDiscrepanciesFeature.SCHOOL_ID_FALLBACK
    const missingLessons = await Promise.all(
      tEntries.map(async entry => ({
        date,
        timeStart: entry.timeStart,
        timeEnd: entry.timeEnd,
        name: entry.nameEt || journal.info.nameEt,
        rooms: entry.rooms ?? [],
        lessonNumber: await this.#calculateLessonNumber(entry.timeStart, schoolId),
        type: 'missing_journal_entry'
      }))
    )

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
        type: 'missing_journal_entry'
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
      timetableStart: data.timetableStart
    }

    if (data.entries.length === 1) {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'single_entry_fix',
        entryId: data.entries[0].id,
        entries: data.entries
      })
    } else {
      discrepancies.push({
        ...baseDiscrepancy,
        type: 'multi_entry_fix',
        entries: data.entries
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

  #createSmartDisplay = (currentValue, correctValue) => {
    const current = Number(currentValue)
    const correct = Number(correctValue)
    return current === correct
      ? `<span style="font-size:14px;font-weight:bold;">${current}</span>`
      : this.#createDiffPill(current, correct)
  }

  #createButton(id, text, colorKey, data = {}) {
    const dataAttributes = Object.entries(data)
      .map(([key, value]) => `data-${key}='${JSON.stringify(value)}'`)
      .join(' ')
    return `<button id="${id}" style="${createButtonStyle(HEX[colorKey])}" ${dataAttributes}>${text}</button>`
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
        rooms: discrepancy.rooms
      })
    }
  }

  #renderSingleEntryFix(discrepancy) {
    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: this.#createButton(`edit-single-${discrepancy.date}-${discrepancy.entryId}`, 'Muuda', 'amber', {
        handler: 'editEntry',
        type: 'single_entry_fix',
        date: discrepancy.date,
        entryId: discrepancy.entryId,
        timetableStart: discrepancy.timetableStart,
        timetableCount: discrepancy.timetableCount,
        currentStart: discrepancy.journalStart,
        currentCount: discrepancy.journalCount
      })
    }
  }

  #renderMultiEntryFix(discrepancy) {
    const buttons = (discrepancy.entries ?? []).map(entry =>
      this.#createButton(`edit-entry-${discrepancy.date}-${entry.id}`, `Muuda ${entry.startLessonNr}. (${entry.lessons}t)`, 'amber', {
        handler: 'editEntry',
        type: 'multi_entry_fix',
        date: discrepancy.date,
        entryId: entry.id
      })
    ).join('')

    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:4px;">${buttons}</div>`
    }
  }

  #createDiscrepancyRow(discrepancy) {
    const renderers = {
      missing_journal_entry: this.#renderMissingEntry,
      single_entry_fix: this.#renderSingleEntryFix,
      multi_entry_fix: this.#renderMultiEntryFix
    }
    const renderer = renderers[discrepancy.type] || this.#renderSingleEntryFix
    const { start, count, action } = renderer.call(this, discrepancy)
    return `<tr style="background-color:white"><td style="${CELL_STYLE}">${this.#formatDisplayDate(discrepancy.date)}</td><td style="${CENTER_STYLE}">${start}</td><td style="${CENTER_STYLE}">${count}</td><td style="${CENTER_STYLE}">${action}</td></tr>`
  }

  #createDiscrepanciesTableElement(discrepancies) {
    const sortedDiscrepancies = [...discrepancies].sort((a, b) => {
      const dateComparison = new Date(a.date) - new Date(b.date)
      if (dateComparison !== 0) return dateComparison

      const aLessonNumber = a.lessonNumber ?? a.timetableStart ?? 0
      const bLessonNumber = b.lessonNumber ?? b.timetableStart ?? 0
      return aLessonNumber - bLessonNumber
    })

    const rows = sortedDiscrepancies.map(discrepancy => this.#createDiscrepancyRow(discrepancy)).join('')
    const boxStyle = 'background:#fff3cd;border:1px solid #ffeaa7;border-radius:4px;padding:15px;' +
      'margin:20px 0;box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;'
    const header = `<div style="display:flex;align-items:center;margin-bottom:15px;"><span style="font-size:20px;margin-right:10px;">⚠️</span><h3 style="margin:0;color:#856404;">Tunnisissekannete probleemid (${discrepancies.length})</h3></div>`
    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:25%">Algustund</th><th style="${CENTER_STYLE}width:25%">Tundide arv</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    const element = document.createElement('div')
    element.dataset.discrepanciesTable = 'true'
    element.style.cssText = boxStyle
    element.innerHTML = `${header}<table style="width:100%;border-collapse:collapse;background:white;">${tableHead}<tbody>${rows}</tbody></table>`
    return element
  }

  #findInsertionPoint() {
    const selectors = ['md-content .layout-padding', '.layout-padding', 'md-content', '#main-content', '.main-content', 'main']
    return selectors
      .map(selector => document.querySelector(selector))
      .find(element => element && element.getBoundingClientRect().width > 100) || document.body
  }

  #insertDiscrepanciesTable(discrepancies) {
    try {
      document.querySelector('[data-discrepancies-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      insertionPoint.insertBefore(this.#createDiscrepanciesTableElement(discrepancies), insertionPoint.firstChild)
      this.#addDiscrepancyButtonListeners()
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert`, error)
      return false
    }
  }

  #insertUnifiedTable(discrepancies, capacityProblems) {
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
      return `<p style="color:#28a745;margin:0 0 20px 0;">Erinevusi tunniplaaniga pole.</p>`
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
    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:25%">Algustund</th><th style="${CENTER_STYLE}width:25%">Tundide arv</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    return sectionHeader + `<table style="width:100%;border-collapse:collapse;background:white;margin-bottom:20px;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
  }

  #createCapacitySection(capacityProblems) {
    if (!capacityProblems.length) {
      return `<p style="color:#28a745;margin:0;">Ebaloogilisi sissekande liigi ja tüüpi kombinatsioone ei leitud.</p>`
    }

    const sectionHeader = `<div style="margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0;color:#495057;">Ebaloogilised sissekande liigi ja tüübi kombinatsioonid</h4>
    </div>`

    const CELL_STYLE = 'padding:8px;border-bottom:1px solid #e0e0e0;'
    const CENTER_STYLE = `${CELL_STYLE}text-align:center;`

    const sortedEntries = [...capacityProblems].sort((a, b) =>
      new Date(a.entryDate) - new Date(b.entryDate)
    )

    const rows = sortedEntries.map(entry => this.#createCapacityProblemRow(entry)).join('')
    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:50%">Märkus</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    return sectionHeader + `<table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
  }

  #addDiscrepancyButtonListeners() {
    const buttons = document.querySelectorAll('[data-discrepancies-table] button')
    buttons.forEach(button => {
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
      cursor: button.style.cursor
    }
  }

  #setButtonProcessingState(button) {
    button.disabled = true
    button.style.background = '#6c757d'
    button.style.opacity = '0.6'
    button.style.cursor = 'not-allowed'
  }

  #parseButtonData(button) {
    return Object.fromEntries(
      Object.entries(button.dataset).map(([key, value]) => [key, JSON.parse(value)])
    )
  }

  async #executeButtonAction(data) {
    const actionHandlers = {
      addMissing: () => this.#handleAddMissingEntry(data.date, data.startLesson, data.lessonCount, data),
      editEntry: () => this.#handleEditEntry(data.date, data.entryId, data.type, data)
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

  async #handleEditEntry(date, entryId, type, data) {
    try {
      const actualEntryId = entryId || data.entryid

      const element = await this.#findJournalEntryElement(actualEntryId, date)
      if (!element) {
        Logger.error(`[${this.name}] Entry element not found for ID=${actualEntryId}, date=${date}`)
        throw new Error('entry element not found')
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      const algustundField = document.querySelector('md-select[aria-label="Algustund"]')
      const lessonsField = document.querySelector('input[aria-label="lessons"]')

      await this.#fillEditForm(type, data)
    } catch (error) {
      Logger.error(`[${this.name}] edit entry error`, error)
    }
  }

  async #findAndClickAddButton() {
    const selectors = [
      'button[ng-click*="addEntry"]',
      'button[ng-click*="lisa"]',
      '[aria-label*="Lisa sissekanne"]'
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
      !button.closest('[data-discrepancies-table]')
    )

    if (addButton) {
      await this.#clickElement(addButton)
      return addButton
    }

    return null
  }

  async #waitForFormOpen(isEditForm = false, maxAttempts = 20, interval = 250) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (isEditForm) {
        if (await this.#isEditFormOpen()) return
      } else {
        const entryTypeField = document.querySelector('md-select[ng-model*="entryType"]')
        const startLessonField = document.querySelector('md-select[ng-model*="startLessonNr"]')
        if (entryTypeField && startLessonField &&
          this.#isElementVisible(entryTypeField) && this.#isElementVisible(startLessonField)) {
          return
        }
      }
      await this.#delay(interval)
    }
    throw new Error('Form did not open')
  }

  async #fillAddForm(date, start, count, timetableData) {
    const formattedDate = this.#formatDisplayDate(date)
    const effectiveStart = timetableData.timetablestart || timetableData.timetableStart || start
    const effectiveCount = timetableData.timetablecount || timetableData.timetableCount || count

    await Promise.all([
      this.#fillFieldWithVisualFeedback(['md-select[ng-model*="entryType"]'], LessonDiscrepanciesFeature.JOURNAL_ENTRY_LESSON_TYPE, 'Entry type'),
      this.#fillFieldWithVisualFeedback(['md-datepicker input'], formattedDate, 'Date')
    ])

    await Promise.all([
      this.#fillStartLessonField(String(effectiveStart)),
      this.#fillLessonCountField(String(effectiveCount)),
      this.#checkAuditoriumLearningCheckbox()
    ])
  }

  async #fillEditForm(type, data) {
    try {
      if (type === 'single_entry_fix') {
        await this.#fillSingleEntryForm(data)
      } else if (type === 'multi_entry_fix') {
        return
      } else {
        Logger.warning(`[${this.name}] Unknown edit form type: ${type}`)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error filling edit form:`, error)
    }
  }

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
      error: '#dc3545'
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
      '#select_89'
    ]
    return this.#fillFieldWithVisualFeedback(selectors, value, 'Start lesson')
  }

  async #fillLessonCountField(value) {
    const selectors = [
      'input[aria-label="lessons"]',
      'input[ng-model*="lessons"]',
      '#input_69'
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

  async #clickElementWithScrollPreservation(element) {
    const originalPosition = {
      x: window.pageXOffset || document.documentElement.scrollLeft,
      y: window.pageYOffset || document.documentElement.scrollTop
    }

    const restoreScroll = () => window.scrollTo(originalPosition.x, originalPosition.y)
    let scrollMonitorInterval = null

    const startScrollMonitoring = () => {
      scrollMonitorInterval = setInterval(() => {
        const currentX = window.pageXOffset || document.documentElement.scrollLeft
        const currentY = window.pageYOffset || document.documentElement.scrollTop
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

    try {
      startScrollMonitoring()
      const rect = element.getBoundingClientRect()
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
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

  async #findJournalEntryElement(entryId, date) {
    const targetEntry = (this.#lastJournalData?.entries ?? []).find(entry => entry.id == entryId)
    if (!targetEntry) {
      Logger.error(`[${this.name}] Target entry with ID ${entryId} not found in cached data`)
      return null
    }

    const datePrefix = this.#formatDisplayDate(date).slice(0, 5)
    const allRows = document.querySelectorAll('tr[ng-click*="editJournalEntry"]')
    const matchingRows = [...allRows].filter(row => row.textContent.includes(datePrefix))

    if (matchingRows.length <= 1) {
      return matchingRows[0] || null
    }

    const targetRow = this.#findRowByLessonCountAndType(matchingRows, targetEntry)
    if (targetRow) {
      return targetRow
    }

    Logger.warning(`[${this.name}] Could not find row by lesson count/type matching for entry ID ${entryId}, using fallback`)
    return this.#findRowByIndexFallback(entryId, date, matchingRows)
  }

  #findRowByLessonCountAndType(rows, targetEntry) {
    return rows.find(row => {
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

      return lessonCount === targetEntry.lessons && entryType === targetEntry.entryType
    })
  }

  #findRowByIndexFallback(entryId, date, rows) {
    const sortedEntries = (this.#lastJournalData?.entries ?? [])
      .filter(entry => this.#formatDate(entry.entryDate) === date && entry.entryType === LessonDiscrepanciesFeature.JOURNAL_ENTRY_LESSON_TYPE)
      .sort((a, b) => a.startLessonNr - b.startLessonNr)

    const entryIndex = sortedEntries.findIndex(entry => entry.id == entryId)
    const selectedRow = entryIndex !== -1 && entryIndex < rows.length ? rows[entryIndex] : rows[0]

    return selectedRow
  }

  async #clickJournalEntry(element) {
    const originalPosition = {
      x: window.pageXOffset || document.documentElement.scrollLeft,
      y: window.pageYOffset || document.documentElement.scrollTop
    }

    let intervalId = null
    const restoreScroll = () => window.scrollTo(originalPosition.x, originalPosition.y)

    const startScrollMonitoring = () => {
      intervalId = setInterval(() => {
        const currentX = window.pageXOffset || document.documentElement.scrollLeft
        const currentY = window.pageYOffset || document.documentElement.scrollTop
        if (currentX !== originalPosition.x || currentY !== originalPosition.y) {
          restoreScroll()
        }
      }, 10)
    }

    const stopScrollMonitoring = () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    try {
      startScrollMonitoring()
      const dialogPromise = this.#waitForDialogToOpen()

      await this.#clickElementWithScrollPreservation(element)
      await this.#delay(200)

      const isFormOpen = await this.#isEditFormOpen()
      if (!isFormOpen) {
        await this.#performDoubleClick(element)
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
      clientY: rect.top + rect.height / 2
    })
    element.dispatchEvent(doubleClickEvent)
    await this.#delay(200)
  }

  async #waitForDialogToOpen(timeout = 8000) {
    return new Promise((resolve, reject) => {
      let observer = null

      const timeoutId = setTimeout(() => {
        if (observer) observer.disconnect()
        reject(new Error('Dialog open timeout'))
      }, timeout)

      observer = new MutationObserver((mutations) => {
        const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')

        if (algustundField && this.#isElementVisible(algustundField)) {
          const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')

          if (dialog && this.#isElementVisible(dialog)) {
            clearTimeout(timeoutId)
            observer.disconnect()
            resolve(dialog)
            return
          }
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true
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

  async #waitForDialogContentLoaded(timeout = 8000) {
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
        attributeFilter: ['style', 'class']
      })
    })
  }



  async #isEditFormOpen() {
    const algustundField = document.querySelector('md-select[aria-label*="Algustund"]')
    if (algustundField && this.#isElementVisible(algustundField)) {
      const dialog = algustundField.closest('md-dialog, .md-dialog, [role="dialog"]')
      return dialog && this.#isElementVisible(dialog)
    }
    return false
  }

  async #checkAuditoriumLearningCheckbox() {
    const checkbox = document.querySelector('md-checkbox[aria-label="Auditoorne õpe"]')

    if (checkbox && this.#isElementVisible(checkbox)) {
      this.#setFieldState(checkbox, 'processing')
      checkbox.click()
      const isChecked = checkbox.getAttribute('aria-checked') === 'true'
      this.#setFieldState(checkbox, isChecked ? 'success' : 'error')
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
    await this.api.cache.clearJournalCache(journalId)
    await this.api.cache.clearCache()
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
        subtree: true
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
          console.log(`[${this.name}] Detected journal entry save via PUT request:`, url)

          // Extract journal ID from URL
          const journalIdMatch = url.match(/\/journals\/(\d+)\/journalEntry\//)
          if (journalIdMatch && parseInt(journalIdMatch[1]) === this.#currentJournalId) {
            console.log(`[${this.name}] Journal entry save detected for current journal ${this.#currentJournalId}`)

            // Wait a bit for the save to complete, then refresh validation
            setTimeout(async () => {
              console.log(`[${this.name}] Refreshing capacity validation after journal entry save`)
              await this.#refreshCapacityValidationAfterSave()
            }, 1500)
          }
        }

        return response
      }
    }
  }

  async #refreshCapacityValidationAfterSave() {
    try {
      console.log(`[${this.name}] Starting capacity validation refresh after manual save`)

      // Check if we have a current journal ID
      if (!this.#currentJournalId) {
        console.log(`[${this.name}] No current journal ID - skipping refresh`)
        return
      }

      // Clear journal cache to get fresh data
      console.log(`[${this.name}] Clearing cache for journal ${this.#currentJournalId}`)
      await this.api.cache.clearJournalCache(this.#currentJournalId)

      // Fetch fresh journal data
      console.log(`[${this.name}] Fetching fresh journal data`)
      const { journalData } = await this.#fetchJournalAndTimetableData(this.#currentJournalId, true)

      // Re-run unified validation
      console.log(`[${this.name}] Re-running unified validation`)
      const capacityProblems = await this.#getCapacityTypeProblems(journalData)

      // Get current discrepancies (empty since we're only refreshing capacity)
      const discrepancies = []

      // Update unified display
      this.#insertUnifiedTable(discrepancies, capacityProblems)

      console.log(`[${this.name}] Capacity validation refresh completed successfully`)
    } catch (error) {
      console.error(`[${this.name}] Error refreshing capacity validation:`, error)
    }
  }

  #cleanupMonitoring() {
    this.#tableObserver?.disconnect()
    this.#tableObserver = null

    // Restore original fetch if we modified it
    if (this.#originalFetch) {
      window.fetch = this.#originalFetch
      this.#originalFetch = null
    }

    this.#saveMonitoringSetup = false
  }

  async #getCapacityTypeProblems(journalData) {
    try {
      console.log('DEBUG2: ========== AUDITOORNE ÕPE CHECKBOX VALIDATION START ==========')
      console.log('DEBUG2: Starting comprehensive debugging for auditoorne õpe checkbox validation')

      // Log journal data structure
      console.log('DEBUG2: Journal data structure:', {
        journalId: journalData.info?.id,
        totalEntries: journalData.entries?.length || 0,
        capacityHours: journalData.info?.lessonHours?.capacityHours || []
      })

      // First check if there's a discrepancy between planned and used hours for "MAHT_a"
      const capacityHours = journalData.info?.lessonHours?.capacityHours || []
      const auditoorneCapacity = capacityHours.find(c => c.capacity === 'MAHT_a')

      console.log('DEBUG2: Capacity hours analysis:', {
        totalCapacityTypes: capacityHours.length,
        auditoorneCapacity: auditoorneCapacity,
        capacityHours: JSON.stringify(capacityHours)
      })

      // Log capacity type code mappings
      console.log('DEBUG2: Capacity type code mappings:')
      console.log('DEBUG2: - "MAHT_a" = "Auditoorne õpe" (auditory learning)')
      console.log('DEBUG2: - "MAHT_i" = "Iseseisev õpe" (independent learning)')
      console.log('DEBUG2: Checkbox state interpretations:')
      console.log('DEBUG2: - Unchecked: "journalEntryCapacityTypes": []')
      console.log('DEBUG2: - "Auditoorne õpe" only: ["MAHT_a"]')
      console.log('DEBUG2: - "Iseseisev õpe" only: ["MAHT_i"]')
      console.log('DEBUG2: - Both checked: ["MAHT_a", "MAHT_i"] (ERROR CONDITION)')

      // Get detailed capacity validation results
      const validationResults = await this.#performDetailedCapacityValidation(journalData, auditoorneCapacity)

      console.log('DEBUG2: ========== AUDITOORNE ÕPE CHECKBOX VALIDATION END ==========')

      // Return problematic entries
      const problematicEntries = validationResults.filter(result => !result.isValid)
      return problematicEntries.map(r => ({
        ...r.entry,
        validationResult: r
      }))
    } catch (error) {
      console.log('DEBUG2: ERROR in capacity check:', error)
      Logger.error(`[${this.name}] capacity check error`, error)
      return []
    }
  }

  async #performDetailedCapacityValidation(journalData, auditoorneCapacity) {
    console.log('DEBUG2: ========== DETAILED CAPACITY VALIDATION START ==========')

    const entries = journalData.entries || []
    const journalId = journalData.info?.id

    console.log('DEBUG2: Entry type filtering and validation logic:')
    console.log('DEBUG2: Total journal entries before filtering:', entries.length)

    // Log each entry's type during processing
    entries.forEach((entry, index) => {
      console.log(`DEBUG2: Entry ${index + 1}: ID=${entry.id}, date=${entry.entryDate}, entryType="${entry.entryType}"`)
    })

    // Filter entries by type with detailed logging
    const targetEntries = entries.filter(entry => {
      const isTarget = entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_I'
      console.log(`DEBUG2: Entry ID=${entry.id} type="${entry.entryType}" - Target for validation: ${isTarget}`)
      return isTarget
    })

    console.log('DEBUG2: Entries matching SISSEKANNE_T, SISSEKANNE_P, or SISSEKANNE_I after filtering:', targetEntries.length)
    console.log('DEBUG2: Target entry IDs:', targetEntries.map(e => e.id))

    // Verify string comparison logic
    console.log('DEBUG2: String comparison verification:')
    console.log('DEBUG2: - Case sensitivity: exact match required')
    console.log('DEBUG2: - Whitespace handling: no trimming applied')
    console.log('DEBUG2: - Comparison method: === (strict equality)')

    if (targetEntries.length === 0) {
      console.log('DEBUG2: No target entries found for validation - exiting')
      return
    }

    // Fetch detailed data for each target entry
    const validationResults = await this.#validateEntriesWithDetailedData(journalId, targetEntries)

    // Log validation summary
    this.#logValidationSummary(validationResults, auditoorneCapacity)

    console.log('DEBUG2: ========== DETAILED CAPACITY VALIDATION END ==========')

    // Return validation results
    return validationResults
  }

  async #validateEntriesWithDetailedData(journalId, targetEntries) {
    console.log('DEBUG2: ========== API RESPONSE DATA STRUCTURE ANALYSIS ==========')

    const validationResults = []

    for (const entry of targetEntries) {
      console.log(`DEBUG2: Fetching detailed data for entry ID=${entry.id}, date=${entry.entryDate}`)

      try {
        // Fetch detailed entry data from API
        const detailUrl = `/journals/${journalId}/journalEntry/${entry.id}`
        console.log(`DEBUG2: API call URL: https://tahvel.edu.ee/hois_back${detailUrl}`)

        const detailedEntry = await this.api.tahvel.get(detailUrl, { allStudents: true }, { cache: false })

        console.log(`DEBUG2: Complete API response for entry ${entry.id}:`, JSON.stringify(detailedEntry, null, 2))

        // Analyze journalEntryCapacityTypes structure
        const capacityTypes = detailedEntry.journalEntryCapacityTypes
        console.log(`DEBUG2: Entry ${entry.id} journalEntryCapacityTypes:`, JSON.stringify(capacityTypes))
        console.log(`DEBUG2: Entry ${entry.id} capacityTypes type:`, typeof capacityTypes)
        console.log(`DEBUG2: Entry ${entry.id} capacityTypes isArray:`, Array.isArray(capacityTypes))

        // Validate the entry
        const validationResult = this.#validateSingleEntry(entry, detailedEntry, capacityTypes)
        validationResults.push(validationResult)

      } catch (error) {
        console.log(`DEBUG2: ERROR fetching detailed data for entry ${entry.id}:`, error)
        validationResults.push({
          entry,
          isValid: false,
          errorType: 'api_fetch_error',
          error: error.message,
          detailedData: null
        })
      }
    }

    return validationResults
  }

  #validateSingleEntry(entry, detailedEntry, capacityTypes) {
    console.log('DEBUG2: ========== CHECKBOX STATE DETECTION IMPLEMENTATION ==========')
    console.log(`DEBUG2: Validating entry ID=${entry.id}, date=${entry.entryDate}, entryType="${entry.entryType}"`)

    // Handle edge cases
    if (capacityTypes === null || capacityTypes === undefined) {
      console.log(`DEBUG2: Entry ${entry.id} - capacityTypes is null/undefined`)
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'null_capacity_types',
        actualState: { auditoorne: false, iseseisev: false },
        expectedState: { auditoorne: true, reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe' }
      }
    }

    if (!Array.isArray(capacityTypes)) {
      console.log(`DEBUG2: Entry ${entry.id} - capacityTypes is not an array:`, typeof capacityTypes)
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'invalid_capacity_types_format',
        actualState: { auditoorne: false, iseseisev: false },
        expectedState: { auditoorne: true, reasoning: 'SISSEKANNE_T/P entries should have auditoorne õpe' }
      }
    }

    // Detect checkbox states using different methods
    console.log(`DEBUG2: Entry ${entry.id} - Raw journalEntryCapacityTypes array:`, JSON.stringify(capacityTypes))

    // Method 1: Array.includes()
    const hasAuditoorneIncludes = capacityTypes.includes('MAHT_a')
    const hasIseseisvIncludes = capacityTypes.includes('MAHT_i')
    console.log(`DEBUG2: Entry ${entry.id} - Detection via includes(): auditoorne=${hasAuditoorneIncludes}, iseseisev=${hasIseseisvIncludes}`)

    // Method 2: Array.indexOf()
    const auditoorneIndex = capacityTypes.indexOf('MAHT_a')
    const iseseisvIndex = capacityTypes.indexOf('MAHT_i')
    const hasAuditoorneIndexOf = auditoorneIndex !== -1
    const hasIseseisvIndexOf = iseseisvIndex !== -1
    console.log(`DEBUG2: Entry ${entry.id} - Detection via indexOf(): auditoorne=${hasAuditoorneIndexOf} (index=${auditoorneIndex}), iseseisev=${hasIseseisvIndexOf} (index=${iseseisvIndex})`)

    // Method 3: Array.find()
    const auditoorneFind = capacityTypes.find(type => type === 'MAHT_a')
    const iseseisvFind = capacityTypes.find(type => type === 'MAHT_i')
    const hasAuditoorneFind = !!auditoorneFind
    const hasIseseisvFind = !!iseseisvFind
    console.log(`DEBUG2: Entry ${entry.id} - Detection via find(): auditoorne=${hasAuditoorneFind}, iseseisev=${hasIseseisvFind}`)

    // Use includes() as the primary method
    const actualAuditoorne = hasAuditoorneIncludes
    const actualIseseisev = hasIseseisvIncludes

    console.log(`DEBUG2: Entry ${entry.id} - Final detected states: auditoorne=${actualAuditoorne}, iseseisev=${actualIseseisev}`)
    console.log(`DEBUG2: Entry ${entry.id} - Method used for detection: Array.includes()`)

    return this.#performBusinessLogicValidation(entry, detailedEntry, {
      auditoorne: actualAuditoorne,
      iseseisev: actualIseseisev
    }, capacityTypes)
  }

  #performBusinessLogicValidation(entry, detailedEntry, actualState, capacityTypes) {
    console.log('DEBUG2: ========== BUSINESS LOGIC VALIDATION REQUIREMENTS ==========')
    console.log(`DEBUG2: Entry ${entry.id} - Business logic validation starting`)

    // Log the business rules
    console.log('DEBUG2: Business rules:')
    console.log('DEBUG2: 1. ALL SISSEKANNE_T and SISSEKANNE_P entries must have "auditoorne õpe" checkbox checked')
    console.log('DEBUG2: 2. SISSEKANNE_T (lesson) entries should NOT have "iseseisev õpe" checkbox checked')
    console.log('DEBUG2: 3. SISSEKANNE_I (independent work) entries should NOT have "auditoorne õpe" checkbox checked')
    console.log('DEBUG2: 4. Both checkboxes cannot be selected simultaneously for ANY entry type')
    console.log('DEBUG2: Source of requirements: HARDCODED ASSUMPTIONS (needs verification)')
    console.log('DEBUG2: Question: Are these assumptions correct for ALL entries of these types?')

    // Determine expected state based on entry type
    const shouldHaveAuditoorne = entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P'
    const shouldHaveIseseisev = entry.entryType === 'SISSEKANNE_I'
    const expectedState = {
      auditoorne: shouldHaveAuditoorne,
      iseseisev: shouldHaveIseseisev,
      reasoning: shouldHaveAuditoorne ?
        `Entry type "${entry.entryType}" requires auditoorne õpe checkbox` :
        shouldHaveIseseisev ?
          `Entry type "${entry.entryType}" requires iseseisev õpe checkbox` :
          `Entry type "${entry.entryType}" has specific checkbox requirements`
    }

    console.log(`DEBUG2: Entry ${entry.id} - Expected checkbox state:`, expectedState)
    console.log(`DEBUG2: Entry ${entry.id} - Actual checkbox state:`, actualState)

    // Check for error condition: both checkboxes selected
    const hasBothCheckboxes = actualState.auditoorne && actualState.iseseisev
    if (hasBothCheckboxes) {
      console.log(`DEBUG2: Entry ${entry.id} - ERROR CONDITION: Both auditoorne and iseseisev checkboxes are selected`)
      console.log('DEBUG2: Error message: "Korraga ei saa auditoorne õpe ja individuaalne õpe aktiivsed olla"')
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'both_checkboxes_selected',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: SISSEKANNE_T (lesson) with MAHT_i (independent work)
    const isLessonWithIndependentWork = entry.entryType === 'SISSEKANNE_T' && actualState.iseseisev && !actualState.auditoorne
    if (isLessonWithIndependentWork) {
      console.log(`DEBUG2: Entry ${entry.id} - ERROR CONDITION: Entry type is SISSEKANNE_T (lesson) but has MAHT_i (independent work) checkbox`)
      console.log('DEBUG2: Error message: "Sissekande liik on tund, aga iseseisva õppe linnuke on sees"')
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'lesson_with_independent_work',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Check for error condition: SISSEKANNE_I (independent work) with MAHT_a (auditory learning)
    const isIndependentWorkWithAuditory = entry.entryType === 'SISSEKANNE_I' && actualState.auditoorne && !actualState.iseseisev
    if (isIndependentWorkWithAuditory) {
      console.log(`DEBUG2: Entry ${entry.id} - ERROR CONDITION: Entry type is SISSEKANNE_I (independent work) but has MAHT_a (auditory learning) checkbox`)
      console.log('DEBUG2: Error message: "Iseseisval tööl ei saa olla auditoorne õpe linnuke sees"')
      return {
        entry,
        detailedData: detailedEntry,
        isValid: false,
        errorType: 'independent_work_with_auditory',
        actualState,
        expectedState,
        capacityTypes,
        validationResult: 'error'
      }
    }

    // Validate against expected state
    const auditoorneValid = actualState.auditoorne === expectedState.auditoorne
    const iseseisvValid = actualState.iseseisev === expectedState.iseseisev
    const isValid = auditoorneValid && iseseisvValid
    const validationResult = isValid ? 'pass' : 'fail'

    console.log(`DEBUG2: Entry ${entry.id} - Validation result: ${validationResult}`)
    if (!isValid) {
      if (!auditoorneValid) {
        console.log(`DEBUG2: Entry ${entry.id} - VALIDATION FAILED: Expected auditoorne=${expectedState.auditoorne}, got ${actualState.auditoorne}`)
      }
      if (!iseseisvValid) {
        console.log(`DEBUG2: Entry ${entry.id} - VALIDATION FAILED: Expected iseseisev=${expectedState.iseseisev}, got ${actualState.iseseisev}`)
      }

      // Determine specific error type
      let errorType = 'missing_required_checkbox'
      if (entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_P') {
        errorType = 'missing_auditoorne_checkbox'
      } else if (entry.entryType === 'SISSEKANNE_I') {
        errorType = 'missing_iseseisev_checkbox'
      }
      console.log(`DEBUG2: Entry ${entry.id} - Error type: ${errorType}`)
    }

    return {
      entry,
      detailedData: detailedEntry,
      isValid,
      errorType: isValid ? null : (entry.entryType === 'SISSEKANNE_I' ? 'missing_iseseisev_checkbox' : 'missing_auditoorne_checkbox'),
      actualState,
      expectedState,
      capacityTypes,
      validationResult
    }
  }

  #logValidationSummary(validationResults, auditoorneCapacity) {
    console.log('DEBUG2: ========== VALIDATION RESULTS AND COMPARISON ==========')

    const totalEntries = validationResults.length
    const passedEntries = validationResults.filter(r => r.isValid).length
    const failedEntries = validationResults.filter(r => !r.isValid).length
    const errorConditions = validationResults.filter(r => r.errorType === 'both_checkboxes_selected').length
    const lessonWithIndependentWork = validationResults.filter(r => r.errorType === 'lesson_with_independent_work').length
    const independentWorkWithAuditory = validationResults.filter(r => r.errorType === 'independent_work_with_auditory').length
    const missingAuditoorne = validationResults.filter(r => r.errorType === 'missing_auditoorne_checkbox').length
    const missingIseseisev = validationResults.filter(r => r.errorType === 'missing_iseseisev_checkbox').length
    const apiErrors = validationResults.filter(r => r.errorType === 'api_fetch_error').length
    const formatErrors = validationResults.filter(r => r.errorType === 'invalid_capacity_types_format' || r.errorType === 'null_capacity_types').length

    console.log('DEBUG2: Summary statistics:')
    console.log(`DEBUG2: - Total entries checked: ${totalEntries}`)
    console.log(`DEBUG2: - Passed validation: ${passedEntries}`)
    console.log(`DEBUG2: - Failed validation: ${failedEntries}`)
    console.log(`DEBUG2: - Error conditions (both checkboxes): ${errorConditions}`)
    console.log(`DEBUG2: - Lesson with independent work error: ${lessonWithIndependentWork}`)
    console.log(`DEBUG2: - Independent work with auditory error: ${independentWorkWithAuditory}`)
    console.log(`DEBUG2: - Missing auditoorne checkbox: ${missingAuditoorne}`)
    console.log(`DEBUG2: - Missing iseseisev checkbox: ${missingIseseisev}`)
    console.log(`DEBUG2: - API fetch errors: ${apiErrors}`)
    console.log(`DEBUG2: - Data format errors: ${formatErrors}`)

    // Log detailed results for each entry
    console.log('DEBUG2: Detailed validation results:')
    validationResults.forEach((result, index) => {
      console.log(`DEBUG2: Entry ${index + 1}:`)
      console.log(`DEBUG2:   - ID: ${result.entry.id}`)
      console.log(`DEBUG2:   - Date: ${result.entry.entryDate}`)
      console.log(`DEBUG2:   - Entry Type: ${result.entry.entryType}`)
      console.log(`DEBUG2:   - Expected auditoorne: ${result.expectedState?.auditoorne}`)
      console.log(`DEBUG2:   - Actual auditoorne: ${result.actualState?.auditoorne}`)
      console.log(`DEBUG2:   - Validation result: ${result.validationResult}`)
      console.log(`DEBUG2:   - Error type: ${result.errorType || 'none'}`)
      console.log(`DEBUG2:   - Capacity types: ${JSON.stringify(result.capacityTypes)}`)
    })

    // Log specific entry IDs that are failing each type of validation
    console.log('DEBUG2: Failed entry IDs by error type:')
    console.log(`DEBUG2: - Missing auditoorne: [${validationResults.filter(r => r.errorType === 'missing_auditoorne_checkbox').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - Missing iseseisev: [${validationResults.filter(r => r.errorType === 'missing_iseseisev_checkbox').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - Both checkboxes: [${validationResults.filter(r => r.errorType === 'both_checkboxes_selected').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - Lesson with independent work: [${validationResults.filter(r => r.errorType === 'lesson_with_independent_work').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - Independent work with auditory: [${validationResults.filter(r => r.errorType === 'independent_work_with_auditory').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - API errors: [${validationResults.filter(r => r.errorType === 'api_fetch_error').map(r => r.entry.id).join(', ')}]`)
    console.log(`DEBUG2: - Format errors: [${validationResults.filter(r => r.errorType === 'invalid_capacity_types_format' || r.errorType === 'null_capacity_types').map(r => r.entry.id).join(', ')}]`)

    // Root cause analysis logging
    this.#logRootCauseAnalysis(validationResults, auditoorneCapacity)
  }

  #logRootCauseAnalysis(validationResults, auditoorneCapacity) {
    console.log('DEBUG2: ========== ROOT CAUSE ANALYSIS LOGGING ==========')

    // Investigate potential causes
    console.log('DEBUG2: Investigating potential root causes:')

    // a) Incorrect business logic
    const allEntriesFailed = validationResults.every(r => !r.isValid)
    if (allEntriesFailed && validationResults.length > 0) {
      console.log('DEBUG2: a) POTENTIAL CAUSE: Incorrect business logic')
      console.log('DEBUG2:    - ALL entries are failing validation')
      console.log('DEBUG2:    - This suggests the assumption that ALL SISSEKANNE_T/P entries need auditoorne õpe may be wrong')
      console.log('DEBUG2:    - RECOMMENDATION: Verify business requirements with domain experts')
    }

    // b) Faulty API data parsing
    const hasValidCapacityTypes = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.length > 0)
    if (!hasValidCapacityTypes) {
      console.log('DEBUG2: b) POTENTIAL CAUSE: Faulty API data parsing')
      console.log('DEBUG2:    - No entries have valid capacity types arrays')
      console.log('DEBUG2:    - This suggests API data structure may be different than expected')
      console.log('DEBUG2:    - RECOMMENDATION: Examine actual API response structure')
    }

    // c) Wrong capacity type code
    const hasMAHT_a = validationResults.some(r => Array.isArray(r.capacityTypes) && r.capacityTypes.includes('MAHT_a'))
    if (!hasMAHT_a && hasValidCapacityTypes) {
      console.log('DEBUG2: c) POTENTIAL CAUSE: Wrong capacity type code')
      console.log('DEBUG2:    - No entries contain "MAHT_a" in their capacity types')
      console.log('DEBUG2:    - The code "MAHT_a" may not be correct for auditoorne õpe')
      console.log('DEBUG2:    - RECOMMENDATION: Verify correct capacity type codes from API documentation')
    }

    // d) Logic errors in boolean comparison
    const hasInconsistentDetection = validationResults.some(r => {
      if (!Array.isArray(r.capacityTypes)) return false
      const includesResult = r.capacityTypes.includes('MAHT_a')
      const indexOfResult = r.capacityTypes.indexOf('MAHT_a') !== -1
      return includesResult !== indexOfResult
    })
    if (hasInconsistentDetection) {
      console.log('DEBUG2: d) POTENTIAL CAUSE: Logic errors in boolean comparison')
      console.log('DEBUG2:    - Inconsistent results between different detection methods')
      console.log('DEBUG2:    - RECOMMENDATION: Review array operation logic')
    }

    // e) Case sensitivity issues
    const uniqueCapacityTypes = new Set()
    validationResults.forEach(r => {
      if (Array.isArray(r.capacityTypes)) {
        r.capacityTypes.forEach(type => uniqueCapacityTypes.add(type))
      }
    })
    console.log('DEBUG2: e) Case sensitivity analysis:')
    console.log('DEBUG2:    - All unique capacity type codes found:', Array.from(uniqueCapacityTypes))
    console.log('DEBUG2:    - Looking for variations of "MAHT_a": case differences, extra spaces, etc.')

    // Log hardcoded assumptions
    console.log('DEBUG2: Hardcoded assumptions that might be incorrect:')
    console.log('DEBUG2: - Assumption 1: ALL SISSEKANNE_T entries must have auditoorne õpe')
    console.log('DEBUG2: - Assumption 2: ALL SISSEKANNE_P entries must have auditoorne õpe')
    console.log('DEBUG2: - Assumption 3: "MAHT_a" is the correct code for auditoorne õpe')
    console.log('DEBUG2: - Assumption 4: Empty array means no checkboxes selected')
    console.log('DEBUG2: - Assumption 5: Both checkboxes selected is always an error')

    // Log edge cases
    console.log('DEBUG2: Edge cases analysis:')
    const nullCapacityTypes = validationResults.filter(r => r.capacityTypes === null || r.capacityTypes === undefined).length
    const emptyArrays = validationResults.filter(r => Array.isArray(r.capacityTypes) && r.capacityTypes.length === 0).length
    const nonArrayTypes = validationResults.filter(r => r.capacityTypes !== null && r.capacityTypes !== undefined && !Array.isArray(r.capacityTypes)).length

    console.log(`DEBUG2: - Null/undefined capacity types: ${nullCapacityTypes}`)
    console.log(`DEBUG2: - Empty arrays: ${emptyArrays}`)
    console.log(`DEBUG2: - Non-array capacity types: ${nonArrayTypes}`)

    // Final recommendations
    console.log('DEBUG2: FINAL RECOMMENDATIONS:')
    console.log('DEBUG2: 1. Verify business requirements: Do ALL SISSEKANNE_T/P entries really need auditoorne õpe?')
    console.log('DEBUG2: 2. Confirm capacity type codes: Is "MAHT_a" definitely correct for auditoorne õpe?')
    console.log('DEBUG2: 3. Check API data structure: Are we fetching the right endpoint and parsing correctly?')
    console.log('DEBUG2: 4. Review validation logic: Are our boolean operations and comparisons correct?')
    console.log('DEBUG2: 5. Test with known good data: Find entries that definitely should pass validation')
  }

  #insertCapacityProblemsTable(problematicEntries, capacityData) {
    try {
      document.querySelector('[data-capacity-problems-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      insertionPoint.insertBefore(
        this.#createCapacityProblemsTableElement(problematicEntries, capacityData),
        document.querySelector('[data-discrepancies-table]')?.nextSibling || insertionPoint.firstChild
      )
      this.#addCapacityProblemButtonListeners()
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert capacity problems table`, error)
      return false
    }
  }

  #createCapacityProblemsTableElement(problematicEntries, capacityData) {
    const CELL_STYLE = 'padding:8px;border-bottom:1px solid #e0e0e0;'
    const CENTER_STYLE = `${CELL_STYLE}text-align:center;`

    const sortedEntries = [...problematicEntries].sort((a, b) =>
      new Date(a.entryDate) - new Date(b.entryDate)
    )

    const rows = sortedEntries.map(entry => this.#createCapacityProblemRow(entry)).join('')
    const boxStyle = 'background:#ffebee;border:1px solid #ffcdd2;border-radius:4px;padding:15px;' +
      'margin:20px 0;box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;'

    // Add summary information about the capacity hours
    const plannedHours = capacityData?.plannedHours || 0
    const usedHours = capacityData?.usedHours || 0
    const hoursDiff = Math.abs(plannedHours - usedHours)

    const header = `
      <div style="display:flex;align-items:center;margin-bottom:15px;">
        <span style="font-size:20px;margin-right:10px;">⚠️</span>
        <h3 style="margin:0;color:#c62828;">Probleemid auditoorse õppe linnukesega (${problematicEntries.length})</h3>
      </div>`

    const tableHead = `<thead><tr style="background:#f8f9fa"><th style="${CELL_STYLE}width:20%">Kuupäev</th><th style="${CENTER_STYLE}width:50%">Märkus</th><th style="${CENTER_STYLE}width:30%">Tegevus</th></tr></thead>`

    const element = document.createElement('div')
    element.dataset.capacityProblemsTable = 'true'
    element.style.cssText = boxStyle
    element.innerHTML = `${header}<table style="width:100%;border-collapse:collapse;background:white;">${tableHead}<tbody>${rows}</tbody></table>`
    return element
  }

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
    let message = "Auditoorne õpe puudub"
    if (entry.validationResult) {
      if (entry.validationResult.errorType === 'both_checkboxes_selected') {
        message = "Auditoorne õpe ja iseseisva õppe linnukesed on samaaegselt sees"
      } else if (entry.validationResult.errorType === 'lesson_with_independent_work') {
        message = "Sissekande liik on tund, aga iseseisva õppe linnuke on sees"
      } else if (entry.validationResult.errorType === 'independent_work_with_auditory') {
        message = "Iseseisval tööl ei saa olla auditoorne õpe linnuke sees"
      } else if (entry.validationResult.errorType === 'missing_auditoorne_checkbox') {
        message = "Auditoorne õpe puudub"
      } else if (entry.validationResult.errorType === 'missing_iseseisev_checkbox') {
        message = "Iseseisev õpe puudub"
      }
    }

    const action = this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
      handler: 'fixCapacity',
      entryId: entry.id,
      date: this.#formatDate(entry.entryDate)
    })

    return `<tr style="background-color:white">
      <td style="${CENTER_STYLE}">${dateWithBadge}</td>
      <td style="${CENTER_STYLE}">${message}</td>
      <td style="${CENTER_STYLE}">${action}</td>
    </tr>`
  }

  #addCapacityProblemButtonListeners() {
    document.querySelectorAll('[data-discrepancies-table] button').forEach(button => {
      if (button.dataset.handler === 'fixCapacity') {
        button.addEventListener('click', () => {
          this.#handleFixCapacity(button.dataset.date, button.dataset.entryId)
        })
      }
    })
  }

  async #handleFixCapacity(date, entryId) {
    try {
      const element = await this.#findJournalEntryElement(entryId, date)
      if (!element) {
        Logger.error(`[${this.name}] Entry element not found for ID=${entryId}, date=${date}`)
        throw new Error('entry element not found')
      }

      await this.#clickJournalEntry(element)
      await this.#waitForDialogContentLoaded()

      // Find capacity type checkboxes
      const capacityTypeCheckboxes = document.querySelectorAll('md-checkbox[ng-model*="capacityType"]')
      const auditoorneCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Auditoorne õpe') ||
        checkbox.textContent.includes('Auditoorne õpe')
      )
      const iseseisvCheckbox = Array.from(capacityTypeCheckboxes).find(checkbox =>
        checkbox.getAttribute('aria-label')?.includes('Iseseisev õpe') ||
        checkbox.getAttribute('aria-label')?.includes('Individuaalne õpe') ||
        checkbox.textContent.includes('Iseseisev õpe') ||
        checkbox.textContent.includes('Individuaalne õpe')
      )

      let needsSave = false

      // Get the entry to determine its type for proper fixing
      const entryElement = await this.#findJournalEntryElement(entryId, date)
      const entryData = this.#lastJournalData?.entries?.find(e => e.id == entryId)
      const entryType = entryData?.entryType

      console.log(`[${this.name}] Fixing capacity for entry ${entryId} of type ${entryType}`)

      if (entryType === 'SISSEKANNE_I') {
        // For independent work entries: ensure iseseisev õpe is checked, auditoorne õpe is unchecked
        if (iseseisvCheckbox && iseseisvCheckbox.getAttribute('aria-checked') !== 'true') {
          await this.#clickElement(iseseisvCheckbox)
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
        if (iseseisvCheckbox && iseseisvCheckbox.getAttribute('aria-checked') === 'true') {
          await this.#clickElement(iseseisvCheckbox)
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
}
