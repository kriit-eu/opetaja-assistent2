import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import IndependentWorkCapacityFeature from './IndependentWorkCapacityFeature.js'
import HighlightMissingGradesFeature from '../highlightMissingGrades/HighlightMissingGradesFeature.js'

/**
 * LessonDiscrepanciesTable class
 * Handles table creation and manipulation for lesson discrepancies
 */
export class LessonDiscrepanciesTable {
  /**
   * Configuration constants for button colors
   */
  static HEX = {
    green: ['#28a745', '#218838', '#fff'],
    amber: ['#ffc107', '#e0a800', '#212529'],
    blue: ['#17a2b8', '#138496', '#fff']
  }

  /**
   * Creates button styling
   * @param {Array} colors - Array of [background, hover, text] colors
   * @returns {string} CSS style string
   */
  static createButtonStyle = ([bg, hover, color]) =>
    `background:${bg};color:${color};border:none;padding:4px 8px;border-radius:3px;` +
    'font-size:12px;font-weight:bold;cursor:pointer;' +
    `" onmouseover="this.style.background='${hover}'" onmouseout="this.style.background='${bg}'`

  /**
   * Constructor for LessonDiscrepanciesTable
   * @param {Object} options - Configuration options
   * @param {Object} options.api - API service instance
   * @param {Function} options.formatDate - Date formatting function
   * @param {Function} options.extractJournalId - Function to extract journal ID
   * @param {Function} options.calculateDuplicateIndex - Function to calculate duplicate index
   * @param {Function} options.findDuplicateMatches - Function to find duplicate matches
   * @param {Function} options.addDiscrepancyButtonListeners - Function to add button listeners
   */
  constructor({ api, extractJournalId, calculateDuplicateIndex, findDuplicateMatches, addDiscrepancyButtonListeners }) {
    this.api = api
    this.extractJournalId = extractJournalId
    this.calculateDuplicateIndex = calculateDuplicateIndex
    this.findDuplicateMatches = findDuplicateMatches
    this.addDiscrepancyButtonListeners = addDiscrepancyButtonListeners
    this.tableCreated = false
    this.currentJournalId = null
    this.name = 'LessonDiscrepanciesTable'
  }

  /**
   * Injects CSS styles for the lesson discrepancies table
   * @private
   */
  #injectCSS() {
    const css = `
      .lesson-discrepancy-table-cell {
        padding: 8px;
        border-bottom: 1px solid #e0e0e0;
      }
      .lesson-discrepancy-table-cell-center {
        padding: 8px;
        border-bottom: 1px solid #e0e0e0;
        text-align: center;
      }
      .lesson-discrepancy-table-cell-20 {
        width: 20%;
      }
      .lesson-discrepancy-table-cell-25 {
        width: 25%;
      }
      .lesson-discrepancy-table-cell-30 {
        width: 30%;
      }
      .lesson-discrepancy-table-cell-50 {
        width: 50%;
      }
    `
    styleService.injectCSS(css, 'lesson-discrepancies-styles')
  }

  /**
   * Creates the main lesson discrepancies table
   * @param {Object} options - Table creation options
   * @param {Array} options.discrepancies - List of discrepancies
   * @param {Array} options.capacityProblems - List of capacity problems
   * @param {boolean} options.forceRefresh - Whether to force refresh
   * @returns {Promise<boolean>} Success status
   */
  async createTable({ discrepancies, capacityProblems, forceRefresh = false }) {
    try {
      const journalId = this.extractJournalId()
      if (!journalId) return false

      const existingTable = document.querySelector('[data-discrepancies-table]')
      if (!forceRefresh && this.tableCreated && this.currentJournalId === journalId && existingTable) {
        return true
      }
      if (existingTable) this.tableCreated = false

      // Collect all independent work messages (capacity and all deadlines), avoid duplicates
      const independentWorkMessages = []
      const capacityMsg = await IndependentWorkCapacityFeature.check(this.api, journalId)
      if (capacityMsg && !independentWorkMessages.includes(capacityMsg)) independentWorkMessages.push(capacityMsg)
      if (window.__lastLessonNotification_independentWorkMessage) {
        const globalMsgs = Array.isArray(window.__lastLessonNotification_independentWorkMessage)
          ? window.__lastLessonNotification_independentWorkMessage
          : [window.__lastLessonNotification_independentWorkMessage]
        for (const msg of globalMsgs) {
          if (msg && !independentWorkMessages.includes(msg)) independentWorkMessages.push(msg)
        }
        delete window.__lastLessonNotification_independentWorkMessage
      }
      // Check missing grades message
      const missingGradesMessage = await HighlightMissingGradesFeature.check(this.api, journalId)

      existingTable?.remove()
      const success = this.insertUnifiedTable(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage)
      if (success) {
        this.tableCreated = true
        this.currentJournalId = journalId
      }
      return success
    } catch (error) {
      Logger.error(`[${this.name}] table creation error`, error)
      return false
    }
  }

  /**
   * Inserts the unified table into the DOM
   * @param {Array} discrepancies - List of discrepancies
   * @param {Array} capacityProblems - List of capacity problems
   * @param {Array} independentWorkMessages - Array of independent work messages
   * @param {string} missingGradesMessage - Missing grades message
   * @returns {boolean} Success status
   */
  insertUnifiedTable(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage) {
    try {
      document.querySelector('[data-discrepancies-table]')?.remove()
      document.querySelector('[data-capacity-problems-table]')?.remove()
      const insertionPoint = this.#findInsertionPoint()
      if (!insertionPoint) return false

      this.#injectCSS()
      insertionPoint.insertBefore(
        this.#createUnifiedTableElement(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage),
        insertionPoint.firstChild
      )
      this.addDiscrepancyButtonListeners()
      return true
    } catch (error) {
      Logger.error(`[${this.name}] insert unified table error`, error)
      return false
    }
  }

  /**
   * Creates the unified table element
   * @param {Array} discrepancies - List of discrepancies
   * @param {Array} capacityProblems - List of capacity problems
   * @param {Array} independentWorkMessages - Array of independent work messages
   * @param {string} missingGradesMessage - Missing grades message
   * @returns {HTMLElement} The table element
   * @private
   */
  #createUnifiedTableElement(discrepancies, capacityProblems, independentWorkMessages, missingGradesMessage) {
    const hasProblems =
      discrepancies.length > 0 || capacityProblems.length > 0 || (independentWorkMessages && independentWorkMessages.length > 0) || !!missingGradesMessage
    const backgroundColor = hasProblems ? '#fff3cd' : '#d1edcc'
    const borderColor = hasProblems ? '#ffeaa7' : '#c3e6cb'
    const boxStyle =
      `background:${backgroundColor};border:1px solid ${borderColor};border-radius:4px;padding:15px;` +
      'box-shadow:0 2px 4px rgba(0,0,0,.1);width:600px;min-width:430px;max-width:600px;flex:0 0 600px;'
    const titleBar = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;">
      <div style="display:flex;align-items:center;">
        <span style="font-size:20px;margin-right:10px;">🎓</span>
        <h3 style="margin:0;color:#495057;">Õpetaja Assistent 2</h3>
      </div>
      <div style="background:#ffc107;color:#212529;font-weight:bold;padding:6px 16px;border-radius:16px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);">
        Probleemid sissekannetega
      </div>
    </div>`

    // Show all independent work banners if present
    let indepWorkBanners = ''
    if (independentWorkMessages && independentWorkMessages.length > 0) {
      indepWorkBanners = independentWorkMessages
        .map(
          msg =>
            `<div style='color:#721c24;font-weight:bold;font-size:15px;text-align:center;background:#f8d7da;border-radius:4px;border:1px solid #f5c6cb;padding:12px 8px;margin-bottom:10px;'>${msg}</div>`
        )
        .join('')
    }

    // Notifications section (side table)
    let notificationsSection = ''
    notificationsSection = `<div style='background:#fff3cd;border:1px solid #ffeaa7;border-radius:4px;padding:15px;min-width:260px;max-width:340px;box-shadow:0 2px 4px rgba(0,0,0,.07);display:flex;flex-direction:column;flex:1 1 260px;'>`
    notificationsSection += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;">
      <div style="display:flex;align-items:center;">
        <span style="font-size:20px;margin-right:10px;">🎓</span>
        <h3 style="margin:0;color:#495057;">Õpetaja Assistent 2</h3>
      </div>
      <div style="background:#ffc107;color:#212529;font-weight:bold;padding:6px 16px;border-radius:16px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);">
        Hinded
      </div>
    </div>`
    // Only show missing grades message in notifications section
    if (missingGradesMessage) {
      notificationsSection += `<div style='color:#721c24;font-weight:bold;font-size:15px;text-align:center;background:#f8d7da;border-radius:4px;border:1px solid #f5c6cb;padding:12px 8px;'>${missingGradesMessage}</div>`
    } else {
      notificationsSection += `<div style='color:#155724;font-weight:bold;font-size:15px;text-align:center;background:#d1edcc;border-radius:4px;border:1px solid #c3e6cb;padding:12px 8px;'>Kõik hinded on korras.</div>`
    }
    notificationsSection += `</div>`

    const timetableSection = this.#createTimetableSection(discrepancies)
    const capacitySection = this.#createCapacitySection(capacityProblems, null)
    const mainTableSection = `<div style='${boxStyle}'>${titleBar + indepWorkBanners + timetableSection + capacitySection}</div>`
    // Flex container for side-by-side layout
    const flexContainer = document.createElement('div')
    flexContainer.style.display = 'flex'
    flexContainer.style.flexWrap = 'wrap'
    flexContainer.style.gap = '16px'
    flexContainer.style.alignItems = 'flex-start'
    flexContainer.style.margin = '0' // Ensure no left margin on flex container
    flexContainer.innerHTML = mainTableSection + notificationsSection
    return flexContainer
  }

  /**
   * Creates the timetable section of the table
   * @param {Array} discrepancies - List of discrepancies
   * @returns {string} HTML string for timetable section
   * @private
   */
  #createTimetableSection(discrepancies) {
    if (!discrepancies.length) {
      return '<p style="color:#28a745;margin:0 0 20px 0;">Erinevusi tunniplaaniga pole.</p>'
    }

    const sectionHeader = `<div style="margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0;color:#495057;">Erinevused tunniplaaniga</h4>
    </div>`

    const sortedDiscrepancies = [...discrepancies].sort((a, b) => {
      const dateComparison = new Date(a.date) - new Date(b.date)
      if (dateComparison !== 0) return dateComparison

      const aLessonNumber = a.lessonNumber ?? a.timetableStart ?? 0
      const bLessonNumber = b.lessonNumber ?? b.timetableStart ?? 0
      return aLessonNumber - bLessonNumber
    })

    const rows = sortedDiscrepancies.map(discrepancy => this.#createDiscrepancyRow(discrepancy)).join('')
    const tableHead = `<thead><tr style="background:#f8f9fa"><th class="lesson-discrepancy-table-cell lesson-discrepancy-table-cell-20">Kuupäev</th><th class="lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-25">Algustund</th><th class="lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-25">Tundide arv</th><th class="lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-30">Tegevus</th></tr></thead>`

    return (
      sectionHeader +
      `<table style="width:100%;border-collapse:collapse;background:white;margin-bottom:20px;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
    )
  }

  /**
   * Creates the capacity section of the table
   * @param {Array} capacityProblems - List of capacity problems
   * @param {string} independentWorkMessage - Independent work message
   * @returns {string} HTML string for capacity section
   * @private
   */
  #createCapacitySection(capacityProblems, independentWorkMessage) {
    const hasCapacityProblems = capacityProblems.length > 0
    const hasindependentWorkMessage = !!independentWorkMessage
    let section = ''

    // Capacity problems section (table + header) only if there are problems
    if (hasCapacityProblems) {
      const sectionHeader = `<div style="margin-bottom:15px;">
        <h4 style="margin:0 0 10px 0;color:#495057;">Ebaloogilised sissekande liigi ja tüübi kombinatsioonid</h4>
      </div>`
      const sortedEntries = [...capacityProblems].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
      const rows = sortedEntries.map(entry => this.#createCapacityProblemRow(entry)).join('')
      const tableHead = `<thead><tr style="background:#f9f9f9"><th class="lesson-discrepancy-table-cell lesson-discrepancy-table-cell-20">Kuupäev</th><th class="lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-50">Märkus</th><th class="lesson-discrepancy-table-cell-center lesson-discrepancy-table-cell-30">Tegevus</th></tr></thead>`
      section +=
        sectionHeader +
        `<table style="width:100%;border-collapse:collapse;background:white;border:1px solid #dee2e6;">${tableHead}<tbody>${rows}</tbody></table>`
    }

    // Independent work message always in its own section if present
    if (hasindependentWorkMessage) {
      section += `<div style="margin-top:18px;margin-bottom:10px;padding:0 8px;">
        <div style='padding:12px 8px;color:#721c24;font-weight:bold;font-size:15px;text-align:center;background:#f8d7da;border-radius:4px;border:1px solid #f5c6cb;'>${independentWorkMessage}</div>
      </div>`
    }

    // If neither, show green message only
    if (!hasCapacityProblems && !hasindependentWorkMessage) {
      section = '<p style="color:#28a745;margin:0;">Ebaloogilisi sissekande liigi ja tüüpi kombinatsioone ei leitud.</p>'
    }

    return section
  }

  /**
   * Creates a discrepancy row for the table
   * @param {Object} discrepancy - Discrepancy data
   * @returns {string} HTML string for the row
   * @private
   */
  #createDiscrepancyRow(discrepancy) {
    const renderers = {
      missingJournalEntry: this.#renderMissingEntry,
      singleEntryFix: this.#renderSingleEntryFix,
      multiEntryFix: this.#renderMultiEntryFix
    }
    const renderer = renderers[discrepancy.type] || this.#renderSingleEntryFix
    const { start, count, action } = renderer.call(this, discrepancy)
    return `<tr style="background-color:white"><td class="lesson-discrepancy-table-cell">${this.#formatDisplayDate(discrepancy.date)}</td><td class="lesson-discrepancy-table-cell-center">${start}</td><td class="lesson-discrepancy-table-cell-center">${count}</td><td class="lesson-discrepancy-table-cell-center">${action}</td></tr>`
  }

  /**
   * Creates a capacity problem row for the table
   * @param {Object} entry - Entry data
   * @returns {string} HTML string for the row
   * @private
   */
  #createCapacityProblemRow(entry) {
    // Format date without year (DD.MM) - handle null dates properly
    let shortDate = 'Kuupäevata' // Default for null dates
    if (entry.entryDate) {
      try {
        const dateObj = new Date(entry.entryDate)
        if (!isNaN(dateObj.getTime())) {
          shortDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}`
        }
      } catch (error) {
        console.log('[LessonDiscrepanciesTable] Date formatting error for display:', error)
      }
    }

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
      } else if (entry.validationResult.errorType === 'missing_iseseive_checkbox') {
        message = 'Iseseisev õpe puudub'
      } else if (entry.validationResult.errorType === 'journal_missing_independent_work') {
        message = 'Vigane sissekanne: päevikule pole määratud iseisevaid töid'
      } else if (entry.validationResult.errorType === 'missing_praktiline_checkbox') {
        message = 'Praktiline töö puudub'
      }
    }

    // Get formatted date for button data
    // Handle null/undefined dates specially since they show as "-" in the main table
    console.log(`[LessonDiscrepanciesTable] Debug: entry object:`, entry)
    console.log(`[LessonDiscrepanciesTable] Debug: entry.entryDate:`, entry.entryDate, typeof entry.entryDate)
    console.log(`[LessonDiscrepanciesTable] Debug: entry.id:`, entry.id)

    let safeFormattedDate = 'NO_DATE' // Special identifier for null dates
    if (entry.entryDate) {
      try {
        console.log(`[LessonDiscrepanciesTable] Debug: Attempting to parse date:`, entry.entryDate)
        const dateObj = new Date(entry.entryDate)
        console.log(`[LessonDiscrepanciesTable] Debug: Date object created:`, dateObj)
        console.log(`[LessonDiscrepanciesTable] Debug: Date object time:`, dateObj.getTime())
        console.log(`[LessonDiscrepanciesTable] Debug: isNaN check:`, isNaN(dateObj.getTime()))

        if (!isNaN(dateObj.getTime())) {
          const day = dateObj.getDate().toString().padStart(2, '0')
          const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
          const year = dateObj.getFullYear()
          safeFormattedDate = `${day}.${month}.${year}`
          console.log(`[LessonDiscrepanciesTable] Debug: Successfully formatted date:`, safeFormattedDate)
        } else {
          console.log(`[LessonDiscrepanciesTable] Debug: Date object is invalid, using NO_DATE`)
          safeFormattedDate = 'NO_DATE'
        }
      } catch (error) {
        console.error('[LessonDiscrepanciesTable] Date formatting error:', error)
        safeFormattedDate = 'NO_DATE'
      }
    } else {
      console.log(`[LessonDiscrepanciesTable] Debug: entry.entryDate is falsy, using NO_DATE:`, entry.entryDate)
      safeFormattedDate = 'NO_DATE'
    }

    console.log(`[LessonDiscrepanciesTable] Debug: Final safeFormattedDate:`, safeFormattedDate)

    // Calculate duplicate index for entries with same date
    const duplicateIndexInput = {
      entryId: entry.id,
      date: safeFormattedDate,
      entryType: entry.entryType
    }
    console.log(`[LessonDiscrepanciesTable] Calculating duplicate index for:`, duplicateIndexInput)
    const duplicateIndex = this.calculateDuplicateIndex(duplicateIndexInput)
    console.log(`[LessonDiscrepanciesTable] Calculated duplicate index:`, duplicateIndex)

    const action =
      entry.validationResult?.errorType === 'no_teacher_selected'
        ? this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
          handler: 'fixCapacity',
          entryid: entry.id,
          date: safeFormattedDate,
          duplicateindex: duplicateIndex
        })
        : entry.validationResult?.errorType === 'journal_missing_independent_work'
          ? this.#createButton(`open-entry-${entry.id}`, 'Ava', 'blue', {
            handler: 'openEntry',
            entryid: entry.id,
            date: safeFormattedDate,
            duplicateindex: duplicateIndex
          })
          : this.#createButton(`fix-capacity-${entry.id}`, 'Paranda', 'amber', {
            handler: 'fixCapacity',
            entryid: entry.id,
            date: safeFormattedDate,
            duplicateindex: duplicateIndex
          })

    return `<tr style="background-color:white">
      <td class="lesson-discrepancy-table-cell-center">${dateWithBadge}</td>
      <td class="lesson-discrepancy-table-cell-center">${message}</td>
      <td class="lesson-discrepancy-table-cell-center">${action}</td>
    </tr>`
  }

  /**
   * Renders a missing entry discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
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

  /**
   * Renders a single entry fix discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
  #renderSingleEntryFix(discrepancy) {
    const duplicateIndex = this.calculateDuplicateIndex(discrepancy)
    const duplicateInfo = this.findDuplicateMatches(discrepancy.entryId, discrepancy.date)
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const humanIndex = duplicateIndex + 1
    const buttonText = hasDuplicates ? `Muuda #${humanIndex}` : 'Muuda'
    const tooltip = `Entry ID: ${discrepancy.entryId}, Duplicate Index: ${duplicateIndex}`
    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: this.#createButton(
        `edit-single-${discrepancy.date}-${discrepancy.entryId}`,
        buttonText,
        'amber',
        {
          handler: 'editEntry',
          type: 'singleEntryFix',
          date: discrepancy.date,
          entryid: discrepancy.entryId,
          timetableStart: discrepancy.timetableStart,
          timetableCount: discrepancy.timetableCount,
          currentStart: discrepancy.journalStart,
          currentCount: discrepancy.journalCount,
          duplicateindex: duplicateIndex
        },
        tooltip
      )
    }
  }

  /**
   * Renders a multi-entry fix discrepancy
   * @param {Object} discrepancy - Discrepancy data
   * @returns {Object} Render data with start, count, and action
   * @private
   */
  #renderMultiEntryFix(discrepancy) {
    // Check if there are duplicates by looking at the first entry
    const firstEntry = discrepancy.entries?.[0]
    const firstEntryDiscrepancy = firstEntry
      ? {
        ...discrepancy,
        entryId: firstEntry.id,
        journalStart: firstEntry.startLessonNr,
        journalCount: firstEntry.lessons
      }
      : null
    const duplicateInfo = firstEntryDiscrepancy
      ? this.findDuplicateMatches(firstEntryDiscrepancy.entryId, firstEntryDiscrepancy.date)
      : { exactMatches: [] }
    const hasDuplicates = duplicateInfo.exactMatches.length > 1

    const buttons = (discrepancy.entries ?? [])
      .map(entry => {
        const entryDiscrepancy = {
          ...discrepancy,
          entryId: entry.id,
          journalStart: entry.startLessonNr,
          journalCount: entry.lessons
        }
        const duplicateIndex = this.calculateDuplicateIndex(entryDiscrepancy)
        const humanIndex = duplicateIndex + 1
        const buttonText = hasDuplicates
          ? `Muuda ${entry.startLessonNr}. (${entry.lessons}t) #${humanIndex}`
          : `Muuda ${entry.startLessonNr}. (${entry.lessons}t)`
        const tooltip = `Entry ID: ${entry.id}, Duplicate Index: ${duplicateIndex}`
        return this.#createButton(
          `edit-entry-${discrepancy.date}-${entry.id}`,
          buttonText,
          'amber',
          {
            handler: 'editEntry',
            type: 'multiEntryFix',
            date: discrepancy.date,
            entryid: entry.id,
            duplicateindex: duplicateIndex
          },
          tooltip
        )
      })
      .join('')

    return {
      start: this.#createSmartDisplay(discrepancy.journalStart, discrepancy.timetableStart),
      count: this.#createSmartDisplay(discrepancy.journalCount, discrepancy.timetableCount),
      action: `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:4px;">${buttons}</div>`
    }
  }

  /**
   * Finds the insertion point for the table in the DOM
   * @returns {HTMLElement} The insertion point element
   * @private
   */
  #findInsertionPoint() {
    const selectors = ['md-content .layout-padding', '.layout-padding', 'md-content', '#main-content', '.main-content', 'main']
    return (
      selectors.map(selector => document.querySelector(selector)).find(element => element && element.getBoundingClientRect().width > 100) || document.body
    )
  }

  /**
   * Creates a button with specified properties
   * @param {string} id - Button ID
   * @param {string} text - Button text
   * @param {string} colorKey - Color key from HEX object
   * @param {Object} data - Data attributes
   * @param {string} tooltip - Tooltip text
   * @returns {string} HTML string for the button
   * @private
   */
  #createButton(id, text, colorKey, data = {}, tooltip = '') {
    const dataAttributes = Object.entries(data)
      .map(([key, value]) =>
        key === 'handler'
          ? `data-handler='${value}'`
          : `data-${key}='${JSON.stringify(value)}'`
      )
      .join(' ')
    const titleAttribute = tooltip ? `title="${tooltip}"` : ''
    return `<button id="${id}" style="${LessonDiscrepanciesTable.createButtonStyle(LessonDiscrepanciesTable.HEX[colorKey])}" ${dataAttributes} ${titleAttribute}>${text}</button>`
  }

  /**
   * Formats a date for display in DD.MM.YYYY format
   * @param {string} date - Date string
   * @returns {string} Formatted date string
   * @private
   */
  #formatDisplayDate = date => {
    const dateObj = new Date(date)
    const day = dateObj.getDate().toString().padStart(2, '0')
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}.${month}.${year}`
  }

  /**
   * Creates a smart display showing current vs correct values
   * @param {number} currentValue - Current value
   * @param {number} correctValue - Correct value
   * @returns {string} HTML string for the display
   * @private
   */
  #createSmartDisplay = (currentValue, correctValue) => {
    const current = Number(currentValue)
    const correct = Number(correctValue)
    return current === correct ? `<span style="font-size:14px;font-weight:bold;">${current}</span>` : this.#createDiffPill(current, correct)
  }

  /**
   * Creates a pill-shaped span with styling
   * @param {string} text - Text content
   * @param {string} color - Text color
   * @param {string} backgroundColor - Background color
   * @param {string} textDecoration - Text decoration
   * @returns {string} HTML string for the pill
   * @private
   */
  #createPill = (text, color, backgroundColor, textDecoration = 'none') =>
    `<span style="background-color:${backgroundColor};color:${color};font-weight:bold;font-size:14px;padding:4px 8px;text-decoration:${textDecoration};">${text}</span>`

  /**
   * Creates a diff pill showing current vs correct values
   * @param {number} current - Current value
   * @param {number} correct - Correct value
   * @returns {string} HTML string for the diff pill
   * @private
   */
  #createDiffPill = (current, correct) => {
    // Add strikethrough to the red (current) value
    const currentPill = this.#createPill(current, '#721c24', '#f8d7da', 'line-through')
    const correctPill = this.#createPill(correct, '#155724', '#d1edcc')
    const style = 'display:inline-flex;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);'
    return `<div style="${style}">${currentPill}${correctPill}</div>`
  }
}
