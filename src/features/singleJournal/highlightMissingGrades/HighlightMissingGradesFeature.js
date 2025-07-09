// HighlightMissingGradesFeature.js
// Highlights cells in independent work columns in red if due date has passed and no grade is assigned

import { BaseFeature } from '../../../core/BaseFeature.js'
import { info as LoggerInfo } from '../../../services/Logger.js'

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

  /**
   * Checks for missing grades in independent work columns for a journal
   * @param {object} api - API object with tahvel.get
   * @param {number} journalId - Journal ID
   * @returns {Promise<string|null>} - Message to display or null
   */
  static async check(api, journalId) {
    let notif = null
    let waited = 0
    const maxWait = 2000
    const interval = 100
    while (waited < maxWait) {
      notif = document.getElementById('last-lesson-inline-notification')
      if (notif) break
      await new Promise(r => setTimeout(r, interval))
      waited += interval
    }
    if (!notif) return null
    const notifText = notif.textContent || ''
    const match = notifText.match(/Viimane tund toim(?:us|ub) (\d{2}\.\d{2}\.\d{4})/)
    if (!match) return null

    let journalEntries = []
    try {
      journalEntries = await api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: true, cacheExpiration: 6e4 })
    } catch (e) {
      return null
    }
    if (!Array.isArray(journalEntries) || journalEntries.length === 0) {
      return null
    }

    const nowDate = new Date()
    const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])
    for (const entry of journalEntries) {
      if (entry.entryType !== 'SISSEKANNE_I') continue
      let entryDetail = entry
      if (!entry.homeworkDuedate) {
        try {
          entryDetail = await api.tahvel.get(
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
      if (!dueDate || dueDate >= nowDate) {
        LoggerInfo('✨ [HighlightMissingGradesFeature.check] Skipping entry', { entryId: entry.id, dueDateStr })
        continue
      }
      let foundMissing = false
      if (Array.isArray(entryDetail.journalEntryStudents) && entryDetail.journalEntryStudents.length > 0) {
        for (const student of entryDetail.journalEntryStudents) {
          let grade = ''
          if (student.grade) {
            if (typeof student.grade === 'object' && student.grade.code) {
              grade = student.grade.code
            } else if (typeof student.grade === 'string') {
              grade = student.grade
            }
          }
          if (!grade && student.verbalGrade) {
            grade = student.verbalGrade
          }
          const absence = student.absence || ''
          LoggerInfo('✨ [HighlightMissingGradesFeature.check] Checking student', { entryId: entry.id, studentId: student.id, grade, absence })
          if (
            (!grade || !validGrades.has(grade)) &&
            (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
          ) {
            LoggerInfo('✨ [HighlightMissingGradesFeature.check] MISSING GRADE DETECTED', { entryId: entry.id, studentId: student.id, grade, absence })
            foundMissing = true
            break
          }
        }
      } else if (entryDetail.journalStudentResults && typeof entryDetail.journalStudentResults === 'object') {
        for (const studentId in entryDetail.journalStudentResults) {
          const results = entryDetail.journalStudentResults[studentId]
          if (Array.isArray(results) && results.length > 0) {
            let grade = ''
            const g = results[0].grade
            if (g === null || g === undefined || g === '' || (typeof g === 'object' && (!g.code || g.code === ''))) {
              grade = ''
            } else if (typeof g === 'object' && g.code) {
              grade = g.code
            } else {
              grade = g
            }
            if (!grade && results[0].verbalGrade) {
              grade = results[0].verbalGrade
            }
            const absence = results[0].absence || ''
            LoggerInfo('✨ [HighlightMissingGradesFeature.check] Checking student', { entryId: entry.id, studentId, grade, absence })
            if (
              (!grade || !validGrades.has(grade)) &&
              (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
            ) {
              LoggerInfo('✨ [HighlightMissingGradesFeature.check] MISSING GRADE DETECTED', { entryId: entry.id, studentId, grade, absence })
              foundMissing = true
              break
            }
          }
        }
      }
      if (foundMissing) {
        return 'Mõnedel iseseisevatel töödel on hinded puudu'
      }
    }
    return null
  }

  static findMissingGrades({ table, iseseisevColumns }) {
    const missing = []
    const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    rows.forEach((row, rowIdx) => {
      iseseisevColumns.forEach(({ idx, entry }) => {
        const cells = Array.from(row.children)
        const cell = cells[idx]
        if (!cell) return
        const studentId = cell.getAttribute('data-student-id') || row.getAttribute('data-student-id')
        let grade = ''
        let absence = ''
        if (studentId && entry.journalStudentResults && entry.journalStudentResults[studentId]) {
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
            if (!grade && results[0].verbalGrade) {
              grade = results[0].verbalGrade
            }
            absence = results[0].absence || ''
          }
        } else {
          grade = cell.getAttribute('data-grade') || cell.textContent.trim()
          absence = cell.getAttribute('data-absence') || cell.textContent.trim()
        }
        if (
          (!grade || !validGrades.has(grade)) &&
          (absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P')
        ) {
          missing.push({ cell, entry, row, rowIdx, colIdx: idx })
        }
      })
    })
    return missing
  }
}

export default HighlightMissingGradesFeature
