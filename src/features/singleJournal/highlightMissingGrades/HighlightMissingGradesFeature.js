// HighlightMissingGradesFeature.js
// Highlights cells in independent work columns in red if due date has passed and no grade is assigned

import { BaseFeature } from '../../../core/BaseFeature.js'

class HighlightMissingGradesFeature extends BaseFeature {
  constructor() {
    super('highlightMissingGrades', /#\/journal\//)
    console.debug('[HighlightMissingGradesFeature] constructor called')
  }

  injectMissingGradeCSS() {
    if (!document.getElementById('highlight-missing-grade-style')) {
      const style = document.createElement('style')
      style.id = 'highlight-missing-grade-style'
      style.textContent = `
                .highlight-missing-grade {
                    background: #ffdddd !important;
                    box-shadow: 0 0 0 2px #ff0000 inset !important;
                    position: relative;
                    cursor: pointer;
                }
            `
      document.head.appendChild(style)
    }
  }

  onActivate() {
    console.debug('[HighlightMissingGradesFeature] onActivate called')
    setTimeout(() => {
      (async() => {
        await this.run()
      })()
    }, 1000)
    if (!this._observer) {
      this._observer = new MutationObserver(() => this.run())
      this._observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  onDeactivate() {
    console.debug('[HighlightMissingGradesFeature] onDeactivate called')
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
  }

  async run() {
    this.injectMissingGradeCSS()
    const layoutPadding = document.querySelector('.layout-padding')
    if (!layoutPadding) {
      return
    }
    const table = layoutPadding.querySelector('table.journalTable')
    if (!table) {
      return
    }
    const headerCells = Array.from(table.querySelectorAll('thead th'))
    const nowDate = new Date()

    // Try to extract journalId from URL
    const journalIdMatch = window.location.href.match(/\/journal\/(\d+)/)
    const journalId = journalIdMatch ? parseInt(journalIdMatch[1], 10) : null
    if (!journalId) {
      return
    }

    // Fetch journalEntries from API (cache for performance)
    let journalEntries = []
    try {
      journalEntries = await this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        { cache: true, cacheExpiration: 6e4 }
      )
    } catch (e) {
      return
    }
    if (!Array.isArray(journalEntries) || journalEntries.length === 0) {
      return
    }

    // Map columns to journalEntries by order (assumes first two columns are not entries)
    const entryColumns = headerCells.slice(2)
    const iseseisevColumns = []
    // Prepare to fetch extra details for each SISSEKANNE_I entry
    const entryDetailPromises = entryColumns.map(async(th, i) => {
      const entry = journalEntries[i]
      if (entry && entry.entryType === 'SISSEKANNE_I') {
        let entryDetail = entry
        // Fetch full entry details to get homeworkDuedate if not present
        if (!entry.homeworkDuedate) {
          try {
            entryDetail = await this.api.tahvel.get(
              `/journals/${journalId}/journalEntry/${entry.id}`,
              { allStudents: true },
              { cache: true, cacheExpiration: 6e4 }
            )
          } catch (e) {
            void e
          }
        }
        const dueDateStr = entryDetail.homeworkDuedate || entryDetail.entryDate
        const dueDate = dueDateStr ? new Date(dueDateStr) : null
        if (dueDate && dueDate < nowDate) {
          iseseisevColumns.push({ idx: i + 2, entry: entryDetail })
        }
      }
    })
    await Promise.all(entryDetailPromises)
    if (iseseisevColumns.length > 0) {
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      rows.forEach((row, _rowIdx) => {
        iseseisevColumns.forEach(({ idx, entry }) => {
          const cells = Array.from(row.children)
          const cell = cells[idx]
          if (!cell) return
          // Try to get studentId from row or cell (may need to adjust selector)
          const studentId = cell.getAttribute('data-student-id') || row.getAttribute('data-student-id')
          let grade = ''
          let absence = ''
          if (studentId && entry.journalStudentResults && entry.journalStudentResults[studentId]) {
            // Array of results for this student
            const results = entry.journalStudentResults[studentId]
            if (Array.isArray(results) && results.length > 0) {
              const g = results[0].grade
              if (g === null || g === undefined || g === '' || (typeof g === 'object' && (!g.code || g.code === ''))) {
                grade = ''
              } else if (typeof g === 'object' && g.code) {
                grade = g.code
              } else {
                grade = g
              }
              // Accept also verbalGrade if present
              if (!grade && results[0].verbalGrade) {
                grade = results[0].verbalGrade
              }
              absence = results[0].absence || ''
            }
          } else {
            grade = cell.getAttribute('data-grade') || cell.textContent.trim()
            absence = cell.getAttribute('data-absence') || cell.textContent.trim()
          }
          // Unified valid grades set
          const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])
          // Highlight if grade is missing (not in validGrades) and absence is empty or PUUDUMINE_H/PUUDUMINE_P/H/P
          if (
            (!grade || !validGrades.has(grade)) &&
            (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
          ) {
            cell.classList.add('highlight-missing-grade')
            // Set tooltip with due date in required format
            const dueDateStr = entry.homeworkDuedate || entry.entryDate
            let tooltipDate = ''
            if (dueDateStr) {
              const d = new Date(dueDateStr)
              tooltipDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
            }
            cell.title = tooltipDate ? `Tähtaeg oli ${tooltipDate}, aga hinne puudub` : 'Hinne puudub'
          } else {
            cell.classList.remove('highlight-missing-grade')
          }
        })
      })
    }
  }
}

export default HighlightMissingGradesFeature
