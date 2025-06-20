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

      if (!discrepancies.length) {
        existingTable?.remove()
        this.#insertSuccessMessage()
        this.#tableCreated = true
        this.#currentJournalId = journalId
        return
      }

      if (this.#insertDiscrepanciesTable(discrepancies)) {
        this.#tableCreated = true
        this.#currentJournalId = journalId
      }
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

  #insertSuccessMessage() {
    try {
      document.querySelector('[data-discrepancies-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      insertionPoint.insertBefore(this.#createSuccessMessageElement(), insertionPoint.firstChild)
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert success message`, error)
      return false
    }
  }

  #createSuccessMessageElement() {
    const boxStyle = 'background:#d1edcc;border:1px solid #c3e6cb;border-radius:4px;padding:15px;' +
      'margin:20px 0;box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;'
    const header = `<div style="display:flex;align-items:center;margin-bottom:0;"><span style="font-size:20px;margin-right:10px;">✅</span><h3 style="margin:0;color:#155724;">Tunnisissekannete probleeme ei tuvastatud</h3></div>`

    const element = document.createElement('div')
    element.dataset.discrepanciesTable = 'true'
    element.style.cssText = boxStyle
    element.innerHTML = header
    return element
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

  #cleanupMonitoring() {
    this.#tableObserver?.disconnect()
    this.#tableObserver = null
    this.#saveMonitoringSetup = false
  }
}
