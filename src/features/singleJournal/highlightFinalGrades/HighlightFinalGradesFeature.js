import { BaseFeature } from '../../../core/BaseFeature.js'
import { info as LoggerInfo } from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'

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
      if (text.includes('lõpptulemus')) {
        finalGradeColumns.push(idx)
      }
    })
    return finalGradeColumns
  }

  async run() {
    this.injectFinalGradeCSS()
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) return
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) return
    const finalGradeColumns = this.findFinalGradeColumns(table)
    if (finalGradeColumns.length === 0) return
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    table.querySelectorAll('.highlight-final-grade-yellow, .highlight-final-grade-red').forEach(cell => {
      cell.classList.remove('highlight-final-grade-yellow', 'highlight-final-grade-red')
    })
    rows.forEach(row => {
      const cells = Array.from(row.children)
      finalGradeColumns.forEach(colIdx => {
        const cell = cells[colIdx]
        if (cell && !cell.textContent.trim()) {
          cell.classList.add('highlight-final-grade-red')
        }
      })
    })
  }

  onActivate() {
    setTimeout(() => {
      this.run()
    }, 1000)
    if (!this._docObserver) {
      this._docObserver = new MutationObserver(() => {
        if (this._debounceTimeout) clearTimeout(this._debounceTimeout)
        this._debounceTimeout = setTimeout(() => {
          this.run()
        }, 50)
      })
      this._docObserver.observe(document.body, { childList: true, subtree: true })
    }
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
