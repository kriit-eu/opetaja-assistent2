import { BaseFeature } from '../../../core/BaseFeature.js'
import { info as LoggerInfo } from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'

class HighlightFinalGradesFeature extends BaseFeature {
  constructor() {
    super('highlightFinalGrades', /#\/journal\//)
    this.finalGradeStyleId = 'highlight-final-grade-style'
    this._observer = null
    this._interval = null
  }

  injectFinalGradeCSS() {
    if (!document.getElementById(this.finalGradeStyleId)) {
      styleService.injectCSS(
        `
        .highlight-final-grade-yellow {
          background: #fff9c4 !important;
          border: 1.5px solid #ffeaa7 !important;
          position: relative;
          cursor: pointer;
        }
        .highlight-final-grade-red {
          background: #ffdddd !important;
          border: 1.5px solid #ff0000 !important;
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
    const schoolId = info.school?.id
    const teacherId = info.journalTeachers?.[0]?.id
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = info.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = info.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()
    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
    const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
    const timetable = timetableData?.timetableEvents?.filter(event => event.journalId == journalId) || []
    if (timetable.length > 0) {
      const sorted = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
      return sorted[sorted.length - 1].date
    }
    // Fallback: use latest journal entry date
    const journalEntries = await this.api.tahvel.get(
      `/journals/${journalId}/journalEntriesByDate`,
      { allStudents: true },
      { cache: true, cacheExpiration: 6e4 }
    )
    if (Array.isArray(journalEntries) && journalEntries.length > 0) {
      const sorted = journalEntries.slice().sort((a, b) => new Date(a.entryDate || 0) - new Date(b.entryDate || 0))
      return sorted[sorted.length - 1].entryDate
    }
    return null
  }

  findFinalGradeColumns(table) {
    const headerCells = Array.from(table.querySelectorAll('thead th'))
    const finalGradeColumns = []
    headerCells.forEach((th, idx) => {
      const text = th.textContent.trim().toLowerCase()
      if (text.includes('ÕV') || text.includes('Lõpptulemus')) {
        finalGradeColumns.push(idx)
      }
    })
    return finalGradeColumns
  }

  findEmptyFinalGradeCells(table, finalGradeColumns) {
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    const emptyCells = []
    rows.forEach(row => {
      const cells = Array.from(row.children)
      finalGradeColumns.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell && !cell.textContent.trim()) {
          emptyCells.push(cell)
        }
      })
    })
    return emptyCells
  }

  getFinalGradeWarningState(finalLessonDate) {
    if (!finalLessonDate) return { color: null, show: false }
    const now = new Date()
    const finalDate = new Date(finalLessonDate)
    finalDate.setHours(0, 0, 0, 0)
    now.setHours(0, 0, 0, 0)
    const diffDays = Math.floor((finalDate - now) / (1000 * 60 * 60 * 24))
    if (diffDays > 7) return { color: null, show: false }
    if (diffDays >= 2 && diffDays <= 7) return { color: 'yellow', show: true }
    if (diffDays <= 1) return { color: 'red', show: true }
    return { color: null, show: false }
  }

  updateFinalGradeHighlightsAndBanner(table, finalGradeColumns, finalLessonDate) {
    const emptyCells = this.findEmptyFinalGradeCells(table, finalGradeColumns)
    // If there are final grade columns but no student results, treat all as empty
    const allCellsEmpty = emptyCells.length === table.querySelectorAll('tbody tr').length * finalGradeColumns.length
    const { color, show } = emptyCells.length > 0 || allCellsEmpty ? { color: 'red', show: true } : this.getFinalGradeWarningState(finalLessonDate)
    table.querySelectorAll('.highlight-final-grade-yellow, .highlight-final-grade-red').forEach(cell => {
      cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
    })
    if ((show && color && emptyCells.length > 0) || allCellsEmpty) {
      (emptyCells.length > 0
        ? emptyCells
        : Array.from(table.querySelectorAll('tbody tr')).flatMap(row => finalGradeColumns.map(idx => row.children[idx]).filter(Boolean))
      ).forEach(cell => cell.classList.add('highlight-final-grade-red'))
    }
  }

  showFinalGradeBanner(color, count) {
    // No-op: banner creation is handled in DiscrepanciesTable.js
  }

  removeFinalGradeBanner() {
    // No-op: banner removal is handled in DiscrepanciesTable.js
  }

  observeFinalGradeChanges(table, finalGradeColumns, finalLessonDate) {
    if (this._observer) this._observer.disconnect()
    this._observer = new MutationObserver(() => {
      this.updateFinalGradeHighlightsAndBanner(table, finalGradeColumns, finalLessonDate)
    })
    this._observer.observe(table, { childList: true, subtree: true, characterData: true })
    if (this._interval) clearInterval(this._interval)
    this._interval = setInterval(() => {
      this.updateFinalGradeHighlightsAndBanner(table, finalGradeColumns, finalLessonDate)
    }, 2000)
  }

  async run() {
    this.injectFinalGradeCSS()
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) return
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) return
    const journalIdMatch = window.location.href.match(/\/journal\/(\d+)/)
    const journalId = journalIdMatch ? parseInt(journalIdMatch[1], 10) : null
    if (!journalId) return
    LoggerInfo('✨ [HighlightFinalGradesFeature] Running for journal', { journalId })
    const finalLessonDate = await this.getFinalLessonDate(journalId)
    LoggerInfo('✨ [HighlightFinalGradesFeature] Final lesson date', { finalLessonDate })
    const finalGradeColumns = this.findFinalGradeColumns(table)
    if (finalGradeColumns.length === 0) return
    this.updateFinalGradeHighlightsAndBanner(table, finalGradeColumns, finalLessonDate)
    this.observeFinalGradeChanges(table, finalGradeColumns, finalLessonDate)
  }

  onActivate() {
    setTimeout(() => {
      (async() => {
        await this.run()
      })()
    }, 1000)
  }

  onDeactivate() {
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
    if (this._interval) {
      clearInterval(this._interval)
      this._interval = null
    }
    this.removeFinalGradeBanner()
  }
}

export default HighlightFinalGradesFeature
