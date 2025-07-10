import { BaseFeature } from '../../../core/BaseFeature.js'
import { styleService } from '../../../services/StyleService.js'
import Logger from '../../../services/Logger.js'

class HighlightFinalGradesFeature extends BaseFeature {
  constructor() {
    super('highlightFinalGrades', /#\/journal\//)
    this.finalGradeStyleId = 'highlight-final-grade-style'
    this._observer = null
    this._docObserver = null
    this._debounceTimeout = null
  }

  injectFinalGradeCSS() {
    if (!document.getElementById(this.finalGradeStyleId)) {
      styleService.injectCSS(
        `
        .highlight-final-grade-yellow {
          background: #fff9c4 !important;
          box-shadow: 0 0 0 2px #ffeaa7 inset !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-final-grade-red {
          background: #ffdddd !important;
          box-shadow: 0 0 0 2px #ff0000 inset !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-ov-red {
          background: #ffdddd !important;
          box-shadow: 0 0 0 2px #ff0000 inset !important;
          position: relative;
          cursor: pointer;
        }
      `,
        this.finalGradeStyleId
      )
    }
  }

  async getFinalLessonDate(journalId) {
    const info = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true, cacheExpiration: 864e5 })
    // Try to extract schoolId from curriculumVersions[0].curriculumId if available
    let schoolId = null
    if (info.curriculumVersions && info.curriculumVersions.length > 0) {
      schoolId = info.curriculumVersions[0].curriculumId
    }
    const teacherId = info.journalTeachers?.[0]?.id
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = info.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = info.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    let timetable = []
    if (schoolId && teacherId) {
      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
      try {
        const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
        timetable = timetableData?.timetableEvents?.filter(event => event.journalId == journalId) || []
      } catch (e) {
        Logger.info('✨ [HighlightFinalGradesFeature] Timetable fetch failed, falling back to journal entries', e)
      }
    }
    if (timetable.length > 0) {
      const sorted = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
      return sorted[sorted.length - 1].date
    }
    // Fallback: use latest journal entry date, ignoring nulls
    const journalEntries = await this.api.tahvel.get(
      `/journals/${journalId}/journalEntriesByDate`,
      { allStudents: true },
      { cache: true, cacheExpiration: 6e4 }
    )
    if (Array.isArray(journalEntries) && journalEntries.length > 0) {
      const validEntries = journalEntries.filter(e => e.entryDate)
      if (validEntries.length > 0) {
        const sorted = validEntries.slice().sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate))
        return sorted[sorted.length - 1].entryDate
      }
    }
    return null
  }

  findColumnIndices(table) {
    const headerRows = Array.from(table.querySelectorAll('thead tr'))
    const finalGradeCols = []
    const ovCols = []
    const debugHeaders = []
    headerRows.forEach(row => {
      let colIdx = 0
      Array.from(row.children).forEach(th => {
        const colspan = parseInt(th.getAttribute('colspan') || '1', 10)
        const rawText = th.innerText || th.textContent
        // Normalize: replace all whitespace (including line breaks) with single space, trim, lowercase
        const normalized = (rawText || '').replace(/\s+/g, ' ').trim().toLowerCase()
        let ovMatch = false
        let finalMatch = false
        // ÕV: match 'õv', 'õv1', 'õv2', 'õv 2', 'õv_2', 'õv-2', 'õv2 forward', or contains 'õpiväljund'
        if (/^õv(\d+)?([ _-]?.*)?$/i.test(normalized) || normalized.includes('õpiväljund')) {
          ovMatch = true
          for (let i = 0; i < colspan; i++) ovCols.push(colIdx + i)
        }
        // Final grade: match 'lõpptulemus', 'lõpptulemus 1', 'lõpptulemus_2', etc.
        if (/lõpptulemus/.test(normalized)) {
          finalMatch = true
          for (let i = 0; i < colspan; i++) finalGradeCols.push(colIdx + i)
        }
        debugHeaders.push(`[${colIdx}] "${rawText.trim()}" => "${normalized}" | OV: ${ovMatch} | FINAL: ${finalMatch} | colspan=${colspan}`)
        colIdx += colspan
      })
    })
    Logger.info('✨ HighlightFinalGrades: header debug:', debugHeaders.join(' | '))
    Logger.info('✨ HighlightFinalGrades: detected final grade columns:', finalGradeCols)
    Logger.info('✨ HighlightFinalGrades: detected ÕV columns:', ovCols)
    return { finalGradeCols: Array.from(new Set(finalGradeCols)), ovCols: Array.from(new Set(ovCols)) }
  }

  onActivate() {
    Logger.info('✨ [HighlightFinalGradesFeature] onActivate called')
    setTimeout(() => {
      Logger.info('✨ [HighlightFinalGradesFeature] Calling run() after timeout')
      this.run()
    }, 1000)
    if (!this._docObserver) {
      this._docObserver = new MutationObserver(() => {
        if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
        this._debounceTimeout = setTimeout(() => {
          Logger.info('✨ [HighlightFinalGradesFeature] MutationObserver triggered run()')
          this.run()
        }, 50)
      })
      this._docObserver.observe(document.body, { childList: true, subtree: true })
    }
  }

  async run() {
    Logger.info('✨ [HighlightFinalGradesFeature] run() called')
    this.injectFinalGradeCSS()
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) {
      Logger.info('✨ [HighlightFinalGradesFeature] .layout-padding not found')
      return
    }
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) {
      Logger.info('✨ [HighlightFinalGradesFeature] .journalTable not found')
      return
    }
    const { finalGradeCols, ovCols } = this.findColumnIndices(table)
    Logger.info('✨ [HighlightFinalGradesFeature] finalGradeCols:', finalGradeCols)
    Logger.info('✨ [HighlightFinalGradesFeature] ovCols:', ovCols)
    if (finalGradeCols.length === 0 && ovCols.length === 0) {
      Logger.info('✨ [HighlightFinalGradesFeature] No final grade or ÕV columns detected')
      return
    }
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    table.querySelectorAll('.highlight-final-grade-yellow, .highlight-final-grade-red, .highlight-ov-red').forEach(cell => {
      cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red', 'highlight-ov-red')
    })

    // Get journalId from URL
    const match = window.location.hash.match(/journal\/(\d+)/)
    const journalId = match ? match[1] : null
    // Try to read last lesson date from LastLessonNotificationFeature banner
    let bannerLessonDate = null
    const lastLessonBanner = document.getElementById('last-lesson-inline-notification')
    if (lastLessonBanner) {
      const text = lastLessonBanner.textContent || ''
      // Match date in format DD.MM.YYYY
      const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/)
      if (match) {
        const [_, day, month, year] = match
        // Use local time for date comparison
        bannerLessonDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
        Logger.info('✨ [HighlightFinalGradesFeature] Using last lesson date from banner:', bannerLessonDate.toISOString())
      }
    }
    let finalLessonDate = bannerLessonDate
    let inWarningWindow = false
    if (!finalLessonDate && journalId) {
      try {
        const apiDate = await this.getFinalLessonDate(journalId)
        Logger.info('✨ [HighlightFinalGradesFeature] getFinalLessonDate result:', apiDate)
        if (apiDate) finalLessonDate = new Date(apiDate)
      } catch (e) {
        Logger.warn('✨ [HighlightFinalGradesFeature] Failed to get final lesson date:', e)
      }
    }
    if (finalLessonDate) {
      // Normalize all dates to local midnight
      const finalDate = new Date(finalLessonDate)
      finalDate.setHours(0, 0, 0, 0)
      // Use comparison date from banner, global, or fallback to today
      let now
      let comparisonDateStr = null
      // Try to extract from banner (if present)
      if (lastLessonBanner) {
        // Try to parse comparison date from banner text: (võrdlus kuupäevaga DD.MM.YYYY)
        const compMatch = lastLessonBanner.textContent && lastLessonBanner.textContent.match(/\(võrdlus kuupäevaga (\d{2})\.(\d{2})\.(\d{4})\)/)
        if (compMatch) {
          const [_, day, month, year] = compMatch
          comparisonDateStr = `${year}-${month}-${day}`
        }
      }
      // Try global variable if set
      if (!comparisonDateStr && window.__oa2ComparisonDate) {
        comparisonDateStr = window.__oa2ComparisonDate
      }
      if (comparisonDateStr) {
        now = new Date(comparisonDateStr)
      } else {
        now = new Date()
      }
      now.setHours(0, 0, 0, 0)
      const warningStart = new Date(finalDate)
      warningStart.setDate(finalDate.getDate() - 7)
      const warningEnd = new Date(finalDate)
      warningEnd.setDate(finalDate.getDate() - 2)
      Logger.info(
        '✨ [HighlightFinalGradesFeature] Today:',
        now.toISOString(),
        'Warning window:',
        warningStart.toISOString(),
        '-',
        warningEnd.toISOString(),
        'Final lesson:',
        finalDate.toISOString()
      )
      inWarningWindow = now >= warningStart && now <= warningEnd
      Logger.info('✨ [HighlightFinalGradesFeature] inWarningWindow:', inWarningWindow)
    }

    // Only highlight if within 7 days of the final lesson date
    const shouldHighlight =
      finalLessonDate &&
      (() => {
        const finalDate = new Date(finalLessonDate)
        finalDate.setHours(0, 0, 0, 0)
        let now
        let comparisonDateStr = null
        if (lastLessonBanner) {
          const compMatch = lastLessonBanner.textContent && lastLessonBanner.textContent.match(/\(võrdlus kuupäevaga (\d{2})\.(\d{2})\.(\d{4})\)/)
          if (compMatch) {
            const [_, day, month, year] = compMatch
            comparisonDateStr = `${year}-${month}-${day}`
          }
        }
        if (!comparisonDateStr && window.__oa2ComparisonDate) {
          comparisonDateStr = window.__oa2ComparisonDate
        }
        if (comparisonDateStr) {
          now = new Date(comparisonDateStr)
        } else {
          now = new Date()
        }
        now.setHours(0, 0, 0, 0)
        const warningStart = new Date(finalDate)
        warningStart.setDate(finalDate.getDate() - 7)
        return now >= warningStart
      })()

    rows.forEach((row, rowIdx) => {
      const cells = Array.from(row.children).filter(n => n.nodeType === 1)
      Logger.info(`✨ [HighlightFinalGradesFeature] Row ${rowIdx} has ${cells.length} cells`)
      finalGradeCols.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell) {
          Logger.info(`✨ [HighlightFinalGradesFeature] Highlighting FINAL cell at row ${rowIdx}, col ${colIdx}, value: "${cell.textContent.trim()}"`)
          if (!cell.textContent.trim()) {
            if (shouldHighlight) {
              if (inWarningWindow) {
                cell.classList.add('highlight-final-grade-yellow')
                cell.classList.remove('highlight-final-grade-red')
              } else {
                cell.classList.add('highlight-final-grade-red')
                cell.classList.remove('highlight-final-grade-yellow')
              }
            } else {
              cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
            }
          } else {
            cell.classList.remove('highlight-final-grade-red', 'highlight-final-grade-yellow')
          }
        }
      })
      ovCols.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell) {
          Logger.info(`✨ [HighlightFinalGradesFeature] Highlighting ÕV cell at row ${rowIdx}, col ${colIdx}, value: "${cell.textContent.trim()}"`)
          if (!cell.textContent.trim()) {
            cell.classList.add('highlight-ov-red')
          } else {
            cell.classList.remove('highlight-ov-red')
          }
        }
      })
    })
  }

  onDeactivate() {
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    if (this._docObserver) {
      this._docObserver.disconnect()
      this._docObserver = null
    }
    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout)
      this._debounceTimeout = null
    }
    this.removeFinalGradeBanner()
  }
}

export default HighlightFinalGradesFeature
