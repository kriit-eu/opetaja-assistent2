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
        .highlight-ov-yellow {
          background: #ffe066 !important;
          box-shadow: 0 0 0 2px #ffd43b inset !important;
          position: relative;
          cursor: pointer;
        }
      `,
        this.finalGradeStyleId
      )
    }
  }

  _getStudyYearRange(info) {
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = info.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = info.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    return { from, thru }
  }

  _getComparisonDate(finalLessonDate, lastLessonBanner) {
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
    return { now, finalDate }
  }

  async getFinalLessonDate(journalId) {
    const info = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true, cacheExpiration: 864e5 })
    // Try to extract schoolId from curriculumVersions[0].curriculumId if available
    let schoolId = null
    if (info.curriculumVersions && info.curriculumVersions.length > 0) {
      schoolId = info.curriculumVersions[0].curriculumId
    }
    const teacherId = info.journalTeachers?.[0]?.id
    const { from, thru } = this._getStudyYearRange(info)
    let timetable = []
    if (schoolId && teacherId) {
      const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
      try {
        const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
        timetable = timetableData?.timetableEvents?.filter(event => event.journalId == journalId) || []
      } catch (e) {
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Timetable fetch failed, falling back to journal entries', e)
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
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: header debug:', debugHeaders.join(' | '))
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: detected final grade columns:', finalGradeCols)
    if (Logger.isDebugMode()) Logger.info('✨ HighlightFinalGrades: detected ÕV columns:', ovCols)
    return { finalGradeCols: Array.from(new Set(finalGradeCols)), ovCols: Array.from(new Set(ovCols)) }
  }

  onActivate() {
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] onActivate called')
    setTimeout(() => {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Calling run() after timeout')
      void this.run()
      this._setupTableObserver()
    }, 1000)
  }

  _setupTableObserver() {
    if (this._docObserver) {
      this._docObserver.disconnect()
      this._docObserver = null
    }
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) return
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) return
    this._docObserver = new MutationObserver(mutations => {
      let relevant = false
      for (const m of mutations) {
        if (m.target === table || table.contains(m.target)) {
          relevant = true
          break
        }
      }
      if (relevant) {
        if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
        this._debounceTimeout = setTimeout(() => {
          if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Table MutationObserver triggered run()')
          void this.run()
        }, 50)
      }
    })
    this._docObserver.observe(table, { childList: true, subtree: true, attributes: false })
  }

  async run() {
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] run() called')
    this.injectFinalGradeCSS()
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] .layout-padding not found')
      return
    }
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] .journalTable not found')
      return
    }
    // If observer is not set or table changed, re-setup observer
    if (!this._docObserver || this._docObserverTable !== table) {
      this._setupTableObserver()
      this._docObserverTable = table
    }
    const { finalGradeCols, ovCols } = this.findColumnIndices(table)
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] finalGradeCols:', finalGradeCols)
    if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] ovCols:', ovCols)
    if (finalGradeCols.length === 0 && ovCols.length === 0) {
      if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] No final grade or ÕV columns detected')
      return
    }
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    // Clean up any previously applied highlight classes (including both ÕV yellow/red)
    table.querySelectorAll('.highlight-final-grade-yellow, .highlight-final-grade-red, .highlight-ov-red, .highlight-ov-yellow').forEach(cell => {
      cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red', 'highlight-ov-red', 'highlight-ov-yellow')
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
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] Using last lesson date from banner:', bannerLessonDate.toISOString())
      }
    }
    let finalLessonDate = bannerLessonDate
    let inWarningWindow = false
    if (!finalLessonDate && journalId) {
      try {
        const apiDate = await this.getFinalLessonDate(journalId)
        if (Logger.isDebugMode()) Logger.info('✨ [HighlightFinalGradesFeature] getFinalLessonDate result:', apiDate)
        if (apiDate) finalLessonDate = new Date(apiDate)
      } catch (e) {
        if (Logger.isDebugMode()) Logger.warn('✨ [HighlightFinalGradesFeature] Failed to get final lesson date:', e)
      }
    }
    if (finalLessonDate) {
      const { now, finalDate } = this._getComparisonDate(finalLessonDate, lastLessonBanner)
      const warningStart = new Date(finalDate)
      warningStart.setDate(finalDate.getDate() - 7)
      const warningEnd = new Date(finalDate)
      warningEnd.setDate(finalDate.getDate() - 2)
      if (Logger.isDebugMode()) {
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
      } else {
        inWarningWindow = now >= warningStart && now <= warningEnd
      }
    }
    // Only highlight if within 7 days of the final lesson date
    const shouldHighlight =
      finalLessonDate &&
      (() => {
        const { now, finalDate } = this._getComparisonDate(finalLessonDate, lastLessonBanner)
        const warningStart = new Date(finalDate)
        warningStart.setDate(finalDate.getDate() - 7)
        return now >= warningStart
      })()

    rows.forEach((row, rowIdx) => {
      // Helper: detect AP (academic leave) marker in the student row. The template renders
      // <span ng-if="row.status === 'OPPURSTAATUS_A'">AP</span> inside the first fixed-cell.
      const rowHasAcademicLeave = r => {
        try {
          // Look for a span whose textContent is exactly 'AP' inside the row
          return Array.from(r.querySelectorAll('span')).some(s => (s.textContent || '').trim() === 'AP')
        } catch (e) {
          return false
        }
      }
      const cells = Array.from(row.children).filter(n => n.nodeType === 1)
      const isRowAP = rowHasAcademicLeave(row)
      if (Logger.isDebugMode()) Logger.info(`✨ [HighlightFinalGradesFeature] Row ${rowIdx} has ${cells.length} cells`)
      finalGradeCols.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell) {
          // Skip highlighting for students on academic leave
          if (isRowAP) {
            cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
            return
          }
          if (Logger.isDebugMode())
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
          // Skip highlighting for students on academic leave
          if (isRowAP) {
            cell.classList.remove('highlight-ov-yellow', 'highlight-ov-red')
            return
          }
          if (Logger.isDebugMode())
            Logger.info(`✨ [HighlightFinalGradesFeature] Highlighting ÕV cell at row ${rowIdx}, col ${colIdx}, value: "${cell.textContent.trim()}"`)
          if (!cell.textContent.trim()) {
            if (shouldHighlight) {
              if (inWarningWindow) {
                cell.classList.add('highlight-ov-yellow')
                cell.classList.remove('highlight-ov-red')
              } else {
                cell.classList.add('highlight-ov-red')
                cell.classList.remove('highlight-ov-yellow')
              }
            } else {
              cell.classList.remove('highlight-ov-yellow', 'highlight-ov-red')
            }
          } else {
            cell.classList.remove('highlight-ov-red', 'highlight-ov-yellow')
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
