import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { domService } from '../../services/DomService.js'

class FinalGradesByOvFeature extends BaseFeature {
  constructor() {
    super('finalGradesByOv', () => true, null) // Activate on any page for testing
    Logger.info('✨ FinalGradesByOvFeature: Constructor called - will activate on any page for testing')
  }

  shouldActivate(url) {
    const result = super.shouldActivate(url)
    Logger.info('✨ FinalGradesByOvFeature: shouldActivate called', { url, result })
    return result
  }

  async onActivate() {
    // Mutation observer to re-attach the real async handler if button is replaced
    const attachAsyncHandler = () => {
      const btn = document.querySelector('.oa-final-grades-btn')
      if (!btn) return
      if (!btn._oaHandlerAttached) {
        btn.addEventListener('click', async e => {
          Logger.info('✨ FinalGradesByOvFeature: Direct button click detected')
          btn.disabled = true
          btn.textContent = 'Laen...'
          btn.style.background = '#ff9800'
          try {
            Logger.info('✨ FinalGradesByOvFeature: Button click handler start (direct)')
            const [entries, students] = await Promise.all([
              this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
              this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
            ])
            Logger.info('✨ FinalGradesByOvFeature: API entries fetched:', entries)
            Logger.info('✨ FinalGradesByOvFeature: API students fetched:', students)
            const results = this.#calculateFinalGrades(entries, students)
            Logger.info('✨ FinalGradesByOvFeature: Results calculated:', results)
            this.#showResults(results, btn)
            btn.textContent = 'Valmis! (vaata all)'
            btn.style.background = '#388e3c'
          } catch (e) {
            Logger.error('FinalGradesByOvFeature error', e)
            btn.textContent = 'Viga!'
            btn.style.background = '#d32f2f'
          } finally {
            setTimeout(() => {
              btn.disabled = false
              btn.textContent = 'Näita lõpptulemust ja õpiväljundeid'
              btn.style.background = 'rgb(21, 101, 192)'
            }, 3000)
          }
        })
        btn._oaHandlerAttached = true
      }
    }
    // Observe changes to #main-content
    const mainContent = document.querySelector('#main-content')
    if (mainContent) {
      const observer = new MutationObserver(() => {
        attachAsyncHandler()
      })
      observer.observe(mainContent, { childList: true, subtree: true })
      // Initial attach
      attachAsyncHandler()
    }
    Logger.info('✨ FinalGradesByOvFeature: onActivate called')
    Logger.info('✨ FinalGradesByOvFeature: Current URL:', window.location.href)

    // For testing, create a simple button anywhere on the page
    Logger.info('✨ FinalGradesByOvFeature: Test button logic start')

    try {
      const journalId = this.#extractJournalId()
      Logger.info('✨ FinalGradesByOvFeature: Journal ID extracted:', journalId)
      if (!journalId) {
        Logger.warn('✨ FinalGradesByOvFeature: No journal ID found, feature will not work')
        return
      }
      // Wait for the table container in #main-content
      let tableContainer = null
      try {
        tableContainer = await domService.waitForElement('.journalTableContainer', 20000, 100)
        Logger.info('✨ FinalGradesByOvFeature: Table container found', tableContainer)
      } catch (e) {
        Logger.warn('FinalGradesByOvFeature: Table container not found, will try fallback', e)
      }
      // Use existing button if present, otherwise insert
      let button = document.querySelector('.oa-final-grades-btn')
      Logger.info('✨ FinalGradesByOvFeature: Existing button found:', button)
      if (!button) {
        if (tableContainer) {
          button = domService.createAndInsertElement(
            'button',
            {
              type: 'button',
              class: 'oa-final-grades-btn',
              style: {
                margin: '16px 0px',
                padding: '8px 16px',
                background: 'rgb(21, 101, 192)',
                color: 'rgb(255, 255, 255)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px',
                zIndex: 1000,
                display: 'block',
                width: 'auto',
                maxWidth: '100%'
              }
            },
            'Näita lõpptulemust ja õpiväljundeid',
            tableContainer,
            'afterend'
          )
          Logger.info('✨ FinalGradesByOvFeature: Button inserted after table container', button)
        } else {
          // Fallback: insert at end of #main-content
          const mainContent = document.querySelector('#main-content')
          if (mainContent) {
            button = domService.createAndInsertElement(
              'button',
              {
                type: 'button',
                class: 'oa-final-grades-btn',
                style: {
                  margin: '16px 0px',
                  padding: '8px 16px',
                  background: 'rgb(21, 101, 192)',
                  color: 'rgb(255, 255, 255)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  zIndex: 1000,
                  display: 'block',
                  width: 'auto',
                  maxWidth: '100%'
                }
              },
              'Näita lõpptulemust ja õpiväljundeid',
              mainContent,
              'beforeend'
            )
            Logger.info('✨ FinalGradesByOvFeature: Button inserted at end of #main-content', button)
          } else {
            Logger.error('FinalGradesByOvFeature: #main-content not found, cannot insert button')
            return
          }
        }
      } else {
        Logger.info('✨ FinalGradesByOvFeature: Using existing button', button)
        Logger.info('✨ FinalGradesByOvFeature: Button visibility:', {
          display: button.style.display,
          visibility: button.style.visibility,
          opacity: button.style.opacity,
          offsetWidth: button.offsetWidth,
          offsetHeight: button.offsetHeight,
          clientWidth: button.clientWidth,
          clientHeight: button.clientHeight
        })
      }
      // Remove any old event delegation to avoid duplicates
      if (window._oaFinalGradesDelegation) {
        document.removeEventListener('click', window._oaFinalGradesDelegation, true)
      }
      // Use event delegation for robustness
      const delegatedHandler = async e => {
        const btn = e.target.closest('.oa-final-grades-btn')
        if (!btn) return
        Logger.info('✨ FinalGradesByOvFeature: Delegated button click detected')
        btn.disabled = true
        btn.textContent = 'Laen...'
        btn.style.background = '#ff9800'
        try {
          Logger.info('✨ FinalGradesByOvFeature: Button click handler start (delegated)')
          const [entries, students] = await Promise.all([
            this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
            this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
          ])
          Logger.info('✨ FinalGradesByOvFeature: API entries fetched:', entries)
          Logger.info('✨ FinalGradesByOvFeature: API students fetched:', students)
          const results = this.#calculateFinalGrades(entries, students)
          Logger.info('✨ FinalGradesByOvFeature: Results calculated:', results)
          this.#showResults(results, btn)
          btn.textContent = 'Valmis! (vaata all)'
          btn.style.background = '#388e3c'
        } catch (e) {
          Logger.error('FinalGradesByOvFeature error', e)
          btn.textContent = 'Viga!'
          btn.style.background = '#d32f2f'
        } finally {
          setTimeout(() => {
            btn.disabled = false
            btn.textContent = 'Näita lõpptulemust ja õpiväljundeid'
            btn.style.background = 'rgb(21, 101, 192)'
          }, 3000)
        }
      }
      window._oaFinalGradesDelegation = delegatedHandler
      document.addEventListener('click', delegatedHandler, true)

      // No need to add a direct event listener here; handled by mutation observer logic above
    } catch (e) {
      Logger.error('FinalGradesByOvFeature init error', e)
    }
  }

  #extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? match[1] : null
  }

  #calculateFinalGrades(entries, students) {
    Logger.info('✨ FinalGradesByOvFeature: DEBUG students structure:', students)
    const studentMap = {}
    students.forEach(s => {
      Logger.info('✨ FinalGradesByOvFeature: DEBUG processing student:', s)
      // Check if student data is nested under .student or directly on the object
      if (s.student && s.student.idcode) {
        studentMap[s.id] = {
          name: s.student.fullname || `${s.student.firstname} ${s.student.lastname}`,
          idcode: s.student.idcode
        }
      } else if (s.idcode || s.fullname || (s.firstname && s.lastname)) {
        // Student data is directly on the object
        studentMap[s.id] = {
          name: s.fullname || `${s.firstname} ${s.lastname}`,
          idcode: s.idcode || 'N/A'
        }
      }
    })
    Logger.info('✨ FinalGradesByOvFeature: DEBUG studentMap after processing:', studentMap)

    // Map outcomes to their leading number (e.g. 7 for "7) ...")
    const outcomesByNumber = {}
    entries.forEach(entry => {
      if (entry.entryType === 'SISSEKANNE_O' && entry.nameEt) {
        const match = entry.nameEt.match(/^(\d+)\)/)
        if (match) {
          outcomesByNumber[match[1]] = entry.nameEt
        }
      }
      // Also support ÕVn in nameEt for SISSEKANNE_I
      if (entry.entryType === 'SISSEKANNE_I' && entry.nameEt) {
        const ovMatch = entry.nameEt.match(/ÕV(\d+)/i)
        if (ovMatch && ovMatch[1]) {
          outcomesByNumber[ovMatch[1]] = `ÕV${ovMatch[1]}`
        }
      }
    })

    // Collect grades for each student
    const gradesByStudent = {}
    // Collect outcome grades for each student and outcome number
    const outcomeGradesByStudent = {}

    entries.forEach(entry => {
      // SISSEKANNE_O: outcomes (for display, not for calculation)
      if (entry.entryType === 'SISSEKANNE_O' && entry.studentOutcomeResults) {
        Object.entries(entry.studentOutcomeResults).forEach(([journalStudentId, results]) => {
          if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
          results.forEach(r => {
            if (r.grade && r.grade.code) gradesByStudent[journalStudentId].push(r.grade.code.replace('KUTSEHINDAMINE_', ''))
          })
        })
      }
      // SISSEKANNE_H: always count toward final grade
      else if (entry.entryType === 'SISSEKANNE_H' && entry.journalStudentResults) {
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
          if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
          results.forEach(r => {
            if (r.grade && r.grade.code) gradesByStudent[journalStudentId].push(r.grade.code.replace('KUTSEHINDAMINE_', ''))
          })
        })
      }
      // SISSEKANNE_I: check for ÕVn in nameEt
      else if (entry.entryType === 'SISSEKANNE_I' && entry.journalStudentResults) {
        // Try to extract ÕV number from nameEt
        const ovMatch = entry.nameEt && entry.nameEt.match(/ÕV(\d+)/i)
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
          results.forEach(r => {
            if (r.grade && r.grade.code) {
              const grade = r.grade.code.replace('KUTSEHINDAMINE_', '')
              // Always count toward final grade, even if ÕVn is present
              if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
              gradesByStudent[journalStudentId].push(grade)
              if (ovMatch && ovMatch[1]) {
                // Only map to outcome if the ÕV number matches a column
                const ovNum = ovMatch[1]
                if (!outcomeGradesByStudent[journalStudentId]) outcomeGradesByStudent[journalStudentId] = {}
                if (!outcomeGradesByStudent[journalStudentId][ovNum]) outcomeGradesByStudent[journalStudentId][ovNum] = []
                outcomeGradesByStudent[journalStudentId][ovNum].push(grade)
                Logger.info('✨ FinalGradesByOvFeature: Mapped SISSEKANNE_I grade to ÕV column', {
                  journalStudentId,
                  grade,
                  ovNum,
                  entryName: entry.nameEt
                })
              } else {
                Logger.info('✨ FinalGradesByOvFeature: SISSEKANNE_I grade not mapped to ÕV column', { journalStudentId, grade, entryName: entry.nameEt })
              }
            }
          })
        })
      }
    })

    // Calculate per-ÕV grades for each student
    const allOvNums = Object.keys(outcomesByNumber).sort((a, b) => Number(a) - Number(b))
    Logger.info('✨ FinalGradesByOvFeature: All ÕV numbers:', allOvNums)

    const output = []
    const summary = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      // Final grade: only from gradesByStudent (not outcomeGradesByStudent)
      const grades = gradesByStudent[journalStudentId] || []
      let finalGrade = ''
      if (grades.includes('MA')) {
        finalGrade = 'MA'
      } else {
        const numeric = grades.filter(g => ['1', '2', '3', '4', '5'].includes(g)).map(Number)
        if (numeric.length) {
          finalGrade = (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2)
        } else if (grades.includes('A')) {
          finalGrade = 'A'
        }
      }

      // Per-ÕV grades
      const ovGrades = {}
      allOvNums.forEach(ovNum => {
        const gradesArr = (outcomeGradesByStudent[journalStudentId] && outcomeGradesByStudent[journalStudentId][ovNum]) || []
        let ovGrade = ''
        if (gradesArr.includes('MA')) {
          ovGrade = 'MA'
        } else {
          const numeric = gradesArr.filter(g => ['1', '2', '3', '4', '5'].includes(g)).map(Number)
          if (numeric.length) {
            ovGrade = (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2)
          } else if (gradesArr.includes('A')) {
            ovGrade = 'A'
          }
        }
        ovGrades[ovNum] = ovGrade
        Logger.info('✨ FinalGradesByOvFeature: Per-ÕV grade calculated', { student: student.name, ovNum, ovGrade, gradesArr })
      })

      output.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        ovGrades
      })
      summary.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        ovGrades
      })
    })
    Logger.info('✨ FinalGradesByOvFeature: SUMMARY', summary)
    return { output, allOvNums, outcomesByNumber }
  }

  #showResults(results, button) {
    Logger.info('✨ FinalGradesByOvFeature: #showResults called', { results, button })
    Logger.info('✨ FinalGradesByOvFeature: button parent:', button && button.parentElement)
    Logger.info("✨ FinalGradesByOvFeature: document.getElementById('oa-final-grades-results'):", document.getElementById('oa-final-grades-results'))
    Logger.info('✨ FinalGradesByOvFeature: Results to render:', results)
    // results is now {output, allOvNums, outcomesByNumber}
    const { output, allOvNums, outcomesByNumber } = results
    // If there are ÕV columns, show only the first ÕV as the second column (with its label)
    // If not, show Lõpptulemus as the second column
    let html = ''
    html += '<style>'
    html += '.oa-final-grades-table {margin-top:16px;border-collapse:collapse;width:100%;font-size:15px;}'
    html += '.oa-final-grades-table th {background:#1976d2;color:#fff;padding:8px 12px;border:1px solid #1976d2;text-align:left;}'
    html += '.oa-final-grades-table td {padding:8px 12px;border:1px solid #e0e0e0;}'
    html += '.oa-final-grades-table tr:nth-child(even) {background:#f5f7fa;}'
    html += '.oa-final-grades-table tr:hover {background:#e3f2fd;}'
    html += '</style>'
    html += '<table class="oa-final-grades-table">'
    html += '<thead><tr><th>Õpilane</th><th>'
    if (allOvNums.length > 0) {
      var firstOvNum = allOvNums[0]
      html += outcomesByNumber[firstOvNum] || 'ÕV' + firstOvNum
    } else {
      html += 'Lõpptulemus'
    }
    html += '</th></tr></thead><tbody>'
    output.forEach(function (r) {
      html += '<tr><td>' + r.name + '</td><td>'
      if (allOvNums.length > 0) {
        var firstOvNum = allOvNums[0]
        html += r.ovGrades[firstOvNum] || ''
      } else {
        html += r.finalGrade || ''
      }
      html += '</td></tr>'
    })
    html += '</tbody></table>'
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    container.innerHTML = html
    Logger.info('✨ FinalGradesByOvFeature: Results table rendered and visible')
  }
}

export default FinalGradesByOvFeature
