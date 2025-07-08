// HighlightMissingGradesFeature.js
// Highlights cells in independent work columns in red if due date has passed and no grade is assigned

import { BaseFeature } from '../../../core/BaseFeature.js'

class HighlightMissingGradesFeature extends BaseFeature {
  constructor () {
    super('highlightMissingGrades', /#\/journal\//)
    console.debug('[HighlightMissingGradesFeature] constructor called')
  }

  injectMissingGradeCSS () {
    if (!document.getElementById('highlight-missing-grade-style')) {
      const style = document.createElement('style')
      style.id = 'highlight-missing-grade-style'
      style.textContent = `
                .highlight-missing-grade {
                    background: #ffdddd !important;
                    border: 1.5px solid #ff0000ff !important;
                    position: relative;
                    cursor: pointer;
                }
            `
      document.head.appendChild(style)
    }
  }

  onActivate () {
    console.debug('[HighlightMissingGradesFeature] onActivate called')
    setTimeout(() => {
      (async () => {
        await this.run()
      })()
    }, 1000) // Delay to ensure DOM is ready
    // Observe DOM changes to re-run highlighting if new columns/cells are added
    if (!this._observer) {
      this._observer = new MutationObserver(() => this.run())
      this._observer.observe(document.body, { childList: true, subtree: true })
    }
  }

  onDeactivate () {
    console.debug('[HighlightMissingGradesFeature] onDeactivate called')
    if (this._observer) {
      this._observer.disconnect()
      this._observer = null
    }
  }

  async run () {
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
      journalEntries = await this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: true, cacheExpiration: 6e4 })
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
    const entryDetailPromises = entryColumns.map(async (th, i) => {
      const entry = journalEntries[i]
      if (entry && entry.entryType === 'SISSEKANNE_I') {
        let entryDetail = entry
        // Fetch full entry details to get homeworkDuedate if not present
        if (!entry.homeworkDuedate) {
          try {
            entryDetail = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${entry.id}`, { allStudents: true }, { cache: true, cacheExpiration: 6e4 })
          } catch (e) {
            // fallback to entry
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
          // Highlight if grade is missing (null, empty, H, P) and absence is empty or PUUDUMINE_H/PUUDUMINE_P/H/P
          if (
            (!grade || grade === 'H' || grade === 'P') &&
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

  /**
         * Checks for missing grades in independent work columns for a journal
         * @param {object} api - API object with tahvel.get
         * @param {number} journalId - Journal ID
         * @returns {Promise<string|null>} - Message to display or null
         */
  static async check (api, journalId) {
    // Only activate if the last-lesson-banner exists and matches the required message
    const banner = document.getElementById('last-lesson-banner')
    if (!banner) return null
    const bannerText = banner.textContent || ''
    const match = bannerText.match(/NB! Viimane tund toimus (\d{2}\.\d{2}\.\d{4})/)
    if (!match) return null

    // Fetch journalEntries from API (cache for performance)
    let journalEntries = []
    try {
      journalEntries = await api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: true, cacheExpiration: 6e4 })
    } catch (e) {
      return null
    }
    if (!Array.isArray(journalEntries) || journalEntries.length === 0) {
      return null
    }

    // Find overdue independent work columns with missing grades
    const nowDate = new Date()
    let hasMissing = false
    for (const entry of journalEntries) {
      if (entry.entryType === 'SISSEKANNE_I') {
        const dueDateStr = entry.homeworkDuedate || entry.entryDate
        const dueDate = dueDateStr ? new Date(dueDateStr) : null
        if (dueDate && dueDate < nowDate) {
          // Check for missing grades for any student
          if (entry.journalStudentResults) {
            for (const studentId in entry.journalStudentResults) {
              const results = entry.journalStudentResults[studentId]
              if (Array.isArray(results) && results.length > 0) {
                let grade = results[0].grade
                if (grade === null || grade === undefined || grade === '' || (typeof grade === 'object' && (!grade.code || grade.code === ''))) {
                  grade = ''
                } else if (typeof grade === 'object' && grade.code) {
                  grade = grade.code
                }
                if (!grade && results[0].verbalGrade) {
                  grade = results[0].verbalGrade
                }
                const absence = results[0].absence || ''
                if (
                  (!grade || grade === 'H' || grade === 'P') &&
                                    (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
                ) {
                  hasMissing = true
                  break
                }
              }
            }
          }
        }
      }
      if (hasMissing) break
    }
    if (hasMissing) {
      return 'Mõnedel iseseisvatel töödel on hinded puudu'
    }
    return null
  }
}

export default HighlightMissingGradesFeature
