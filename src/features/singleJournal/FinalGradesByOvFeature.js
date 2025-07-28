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
            this._lastEntries = entries
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
        Logger.warning('✨ FinalGradesByOvFeature: No journal ID found, feature will not work')
        return
      }
      // Fetch entries and students to check for ÕV columns or SISSEKANNE_L
      const [entries, students] = await Promise.all([
        this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
        this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
      ])
      const results = this.#calculateFinalGrades(entries, students)
      const hasSissekanneL = entries.some(entry => entry.entryType === 'SISSEKANNE_L')
      if (!results.allOvNums || (results.allOvNums.length === 0 && !hasSissekanneL)) {
        Logger.info('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected, feature will not activate')
        return
      }
      // Wait for the table container in #main-content
      let tableContainer = null
      try {
        tableContainer = await domService.waitForElement('.journalTableContainer', 20000, 100)
        Logger.info('✨ FinalGradesByOvFeature: Table container found', tableContainer)
      } catch (e) {
        Logger.warning('FinalGradesByOvFeature: Table container not found, will try fallback', e)
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
          this._lastEntries = entries
          const results = this.#calculateFinalGrades(entries, students)
          const hasSissekanneL = entries.some(entry => entry.entryType === 'SISSEKANNE_L')
          if (!results.allOvNums || (results.allOvNums.length === 0 && !hasSissekanneL)) {
            Logger.info('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected on button click, aborting')
            btn.textContent = 'ÕV-sid või lõpptulemust ei leitud'
            btn.style.background = '#d32f2f'
            setTimeout(() => {
              btn.disabled = false
              btn.textContent = 'Näita lõpptulemust ja õpiväljundeid'
              btn.style.background = 'rgb(21, 101, 192)'
            }, 3000)
            return
          }
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
    const journalStudentIdToStudentId = {}
    students.forEach(s => {
      Logger.info('✨ FinalGradesByOvFeature: DEBUG processing student:', s)
      // Check if student data is nested under .student or directly on the object
      let name, idcode, studentId, journalStudentId
      if (s.student && s.student.idcode) {
        name = s.student.fullname || `${s.student.firstname} ${s.student.lastname}`
        idcode = s.student.idcode
        studentId = s.student.id
        journalStudentId = s.id
      } else {
        name = s.fullname || `${s.firstname} ${s.lastname}`
        idcode = s.idcode || 'N/A'
        studentId = s.studentId || s.id
        journalStudentId = s.id
      }
      studentMap[journalStudentId] = { name, idcode, studentId }
      journalStudentIdToStudentId[journalStudentId] = studentId
    })
    Logger.info('✨ FinalGradesByOvFeature: DEBUG studentMap after processing:', studentMap)

    // Map outcomes to their leading number (e.g. 7 for "7) ...")
    const outcomesByNumber = {}
    const ovNumToOutcomeId = {} // Map ÕV number to curriculumModuleOutcomes from SISSEKANNE_O
    entries.forEach(entry => {
      if (entry.entryType === 'SISSEKANNE_O' && entry.nameEt) {
        const match = entry.nameEt.match(/^(\d+)\)/)
        if (match) {
          const ovNum = match[1]
          outcomesByNumber[ovNum] = entry.nameEt
          if (entry.curriculumModuleOutcomes) {
            ovNumToOutcomeId[ovNum] = entry.curriculumModuleOutcomes
          }
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
    // Collect final grades from SISSEKANNE_L entries
    const finalGradesByStudent = {}

    entries.forEach(entry => {
      // SISSEKANNE_L: final grades (lõpptulemus)
      if (entry.entryType === 'SISSEKANNE_L' && entry.journalEntryStudents) {
        entry.journalEntryStudents.forEach(entryStudent => {
          if (entryStudent.grade && entryStudent.grade.code && entryStudent.journalStudent) {
            const grade = entryStudent.grade.code.replace('KUTSEHINDAMINE_', '')
            finalGradesByStudent[entryStudent.journalStudent] = grade
            Logger.info('✨ FinalGradesByOvFeature: Found SISSEKANNE_L grade', {
              journalStudent: entryStudent.journalStudent,
              grade
            })
          }
        })
      }
      // SISSEKANNE_O: outcomes (for display, not for calculation)
      else if (entry.entryType === 'SISSEKANNE_O' && entry.studentOutcomeResults) {
        Object.entries(entry.studentOutcomeResults).forEach(([journalStudentId, results]) => {
          if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
          if (Array.isArray(results)) {
            results.forEach(r => {
              if (r.grade && r.grade.code) gradesByStudent[journalStudentId].push(r.grade.code.replace('KUTSEHINDAMINE_', ''))
            })
          } else {
            Logger.warning('✨ FinalGradesByOvFeature: SISSEKANNE_O results is not array', { journalStudentId, results })
          }
        })
      }
      // SISSEKANNE_H: always count toward final grade
      else if (entry.entryType === 'SISSEKANNE_H' && entry.journalStudentResults) {
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
          if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
          if (Array.isArray(results)) {
            results.forEach(r => {
              if (r.grade && r.grade.code) gradesByStudent[journalStudentId].push(r.grade.code.replace('KUTSEHINDAMINE_', ''))
            })
          } else {
            Logger.warning('✨ FinalGradesByOvFeature: SISSEKANNE_H results is not array', { journalStudentId, results })
          }
        })
      }
      // SISSEKANNE_I: check for ÕVn in nameEt
      else if (entry.entryType === 'SISSEKANNE_I' && entry.journalStudentResults) {
        // Try to extract ÕV number from nameEt
        const ovMatch = entry.nameEt && entry.nameEt.match(/ÕV(\d+)/i)
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
          if (Array.isArray(results)) {
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
                  Logger.info('✨ FinalGradesByOvFeature: SISSEKANNE_I grade not mapped to ÕV column', {
                    journalStudentId,
                    grade,
                    entryName: entry.nameEt
                  })
                }
              }
            })
          } else {
            Logger.warning('✨ FinalGradesByOvFeature: SISSEKANNE_I results is not array', { journalStudentId, results })
          }
        })
      }
    })

    // Calculate per-ÕV grades for each student
    const allOvNums = Object.keys(outcomesByNumber).sort((a, b) => Number(a) - Number(b))
    Logger.info('✨ FinalGradesByOvFeature: All ÕV numbers:', allOvNums)

    const output = []
    const summary = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      // Final grade: prioritize SISSEKANNE_L, fallback to calculated grade
      let finalGrade = ''
      if (finalGradesByStudent[journalStudentId]) {
        finalGrade = finalGradesByStudent[journalStudentId]
        Logger.info('✨ FinalGradesByOvFeature: Using SISSEKANNE_L grade', { student: student.name, finalGrade })
      } else {
        // Calculate from gradesByStudent (not outcomeGradesByStudent)
        const grades = gradesByStudent[journalStudentId] || []
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
        Logger.info('✨ FinalGradesByOvFeature: Calculated final grade', { student: student.name, finalGrade, grades })
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
        ovGrades,
        journalStudentId, // for reference
        studentId: student.studentId // <-- add correct studentId for payload
      })
      summary.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        ovGrades,
        journalStudentId,
        studentId: student.studentId
      })
    })
    Logger.info('✨ FinalGradesByOvFeature: SUMMARY', summary)
    return { output, allOvNums, outcomesByNumber, ovNumToOutcomeId, journalStudentIdToStudentId }
  }

  #showResults(results, button) {
    Logger.info('✨ FinalGradesByOvFeature: #showResults called', { results, button })
    Logger.info('✨ FinalGradesByOvFeature: button parent:', button && button.parentElement)
    Logger.info("✨ FinalGradesByOvFeature: document.getElementById('oa-final-grades-results'):", document.getElementById('oa-final-grades-results'))
    Logger.info('✨ FinalGradesByOvFeature: Results to render:', results)
    // results is now {output, allOvNums, outcomesByNumber, journalStudentIdToStudentId}
    const { output, allOvNums, outcomesByNumber, ovNumToOutcomeId, journalStudentIdToStudentId } = results

    // Build a map of (studentId|ovNum) => existing grade object for updating
    const existingGradesMap = {}
    Logger.info('✨ FinalGradesByOvFeature: journalStudentIdToStudentId mapping', journalStudentIdToStudentId)
    if (this._lastEntries) {
      this._lastEntries.forEach(entry => {
        if (entry.entryType === 'SISSEKANNE_O' && entry.studentOutcomeResults) {
          const match = entry.nameEt && entry.nameEt.match(/^([0-9]+)\)/)
          const ovNum = match && match[1]
          if (ovNum) {
            Object.entries(entry.studentOutcomeResults).forEach(([journalStudentId, results]) => {
              const studentId = journalStudentIdToStudentId[journalStudentId]
              Logger.info('✨ FinalGradesByOvFeature: Mapping SISSEKANNE_O', { journalStudentId, studentId, ovNum, results })
              if (studentId && Array.isArray(results) && results.length > 0) {
                // Use the first result (should only be one per student/outcome)
                existingGradesMap[`${studentId}|${ovNum}`] = results[0]
              }
            })
          }
        }
      })
    }
    Logger.info('✨ FinalGradesByOvFeature: existingGradesMap keys', Object.keys(existingGradesMap))
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
      let display = '',
        tooltip = ''
      if (allOvNums.length > 0) {
        var firstOvNum = allOvNums[0]
        const grade = r.ovGrades[firstOvNum]
        if (/^\d+(\.\d+)?$/.test(grade)) {
          // Numeric: show rounded, tooltip original
          display = String(Math.round(Number(grade)))
          tooltip = grade
        } else {
          display = grade || ''
        }
      } else {
        // Show final grade (from SISSEKANNE_L or calculated)
        const grade = r.finalGrade
        if (/^\d+(\.\d+)?$/.test(grade)) {
          display = String(Math.round(Number(grade)))
          tooltip = grade
        } else {
          display = grade || ''
        }
      }
      if (tooltip && tooltip !== display) {
        html += `<span title="${tooltip}">${display}</span>`
      } else {
        html += display
      }
      html += '</td></tr>'
    })
    html += '</tbody></table>'
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    container.innerHTML = html

    // Add send ÕV grades button only if there are ÕV columns
    if (allOvNums.length > 0) {
      let sendBtn = document.getElementById('oa-send-ov-grades-btn')
      if (!sendBtn) {
        sendBtn = domService.createAndInsertElement(
          'button',
          {
            id: 'oa-send-ov-grades-btn',
            style: {
              margin: '16px 0px',
              padding: '8px 16px',
              background: '#388e3c',
              color: '#fff',
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
          'Saada ÕV hinded Tahvlisse',
          container,
          'afterend'
        )
      }
      // Status message
      let statusDiv = document.getElementById('oa-send-ov-status')
      if (!statusDiv) {
        statusDiv = domService.createAndInsertElement(
          'div',
          { id: 'oa-send-ov-status', style: { margin: '8px 0', color: '#1976d2', fontWeight: 'bold' } },
          '',
          sendBtn,
          'afterend'
        )
      }
      sendBtn.onclick = async () => {
        sendBtn.disabled = true
        sendBtn.textContent = 'Saatmine...'
        statusDiv.textContent = ''
        try {
          const journalId = this.#extractJournalId()
          // Get current date in Europe/Tallinn as YYYY-MM-DD
          const estDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' })
          const gradeDate = estDate + 'T00:00:00.000Z'
          let anySuccess = false
          let skipped = []
          for (const ovNum of results.allOvNums) {
            // Always fetch the latest outcome entry for this ÕV
            const journalId = this.#extractJournalId()
            const journalOutcomeId = ovNumToOutcomeId && ovNumToOutcomeId[ovNum] ? ovNumToOutcomeId[ovNum] : ovNum
            let latestOutcomeEntry = null
            try {
              latestOutcomeEntry = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${journalOutcomeId}`)
              Logger.info('✨ FinalGradesByOvFeature: Latest outcome entry fetched', { ovNum, journalOutcomeId, latestOutcomeEntry })
              Logger.info('✨ FinalGradesByOvFeature: Full outcome entry structure', {
                keys: Object.keys(latestOutcomeEntry || {}),
                hasStudentOutcomeResults: latestOutcomeEntry?.hasStudentOutcomeResults,
                studentOutcomeResults: latestOutcomeEntry?.studentOutcomeResults,
                studentOutcomeResultsKeys: latestOutcomeEntry?.studentOutcomeResults ? Object.keys(latestOutcomeEntry.studentOutcomeResults) : null
              })
            } catch (err) {
              Logger.warning('✨ FinalGradesByOvFeature: Could not fetch latest outcome entry', { ovNum, journalOutcomeId, err })
            }
            // Build a map of (studentId|ovNum) => existing grade object for updating
            const freshGradesMap = {}
            Logger.info('✨ FinalGradesByOvFeature: latestOutcomeEntry structure', {
              hasStudentOutcomeResults: latestOutcomeEntry?.hasStudentOutcomeResults,
              studentOutcomeResults: latestOutcomeEntry?.studentOutcomeResults,
              outcomeStudents: latestOutcomeEntry?.outcomeStudents
            })

            // Check if outcomeStudents exists (this contains existing grades)
            if (latestOutcomeEntry && latestOutcomeEntry.outcomeStudents && Array.isArray(latestOutcomeEntry.outcomeStudents)) {
              Logger.info('✨ FinalGradesByOvFeature: Processing existing outcomeStudents', {
                ovNum,
                outcomeStudentsCount: latestOutcomeEntry.outcomeStudents.length
              })

              latestOutcomeEntry.outcomeStudents.forEach(outcomeStudent => {
                if (outcomeStudent.studentId) {
                  const key = `${outcomeStudent.studentId}|${ovNum}`
                  freshGradesMap[key] = outcomeStudent
                  Logger.info('✨ FinalGradesByOvFeature: Added to freshGradesMap', {
                    key,
                    studentId: outcomeStudent.studentId,
                    hasId: !!outcomeStudent.id,
                    hasVersion: !!outcomeStudent.version
                  })
                }
              })
            } else {
              Logger.info('✨ FinalGradesByOvFeature: No existing grades found for this ÕV', {
                ovNum,
                hasOutcomeEntry: !!latestOutcomeEntry,
                hasOutcomeStudents: !!latestOutcomeEntry?.outcomeStudents,
                outcomeStudentsType: typeof latestOutcomeEntry?.outcomeStudents,
                outcomeStudentsIsArray: Array.isArray(latestOutcomeEntry?.outcomeStudents)
              })
            }
            Logger.info('✨ FinalGradesByOvFeature: freshGradesMap keys', Object.keys(freshGradesMap))
            Logger.info('✨ FinalGradesByOvFeature: freshGradesMap full', freshGradesMap)
            // Build payload for this ÕV, always include all students with a grade (overwrite existing)
            const outcomeStudents = results.output
              .map(r => {
                let grade = r.ovGrades[ovNum]
                if (!grade) return null
                // If grade is a numeric string with decimals, round and convert to string
                if (/^\d+(\.\d+)?$/.test(grade)) {
                  const rounded = Math.round(Number(grade))
                  if (rounded >= 1 && rounded <= 5) grade = String(rounded)
                }
                const studentId = Number(r.studentId)
                const lookupKey = `${studentId}|${ovNum}`
                Logger.info('✨ FinalGradesByOvFeature: Payload build', { studentId, ovNum, lookupKey, existing: !!freshGradesMap[lookupKey] })
                // Only send numeric grades 1-5 or MA/A
                let code = null,
                  nameEt = '',
                  nameEn = '',
                  value = ''
                if (['1', '2', '3', '4', '5'].includes(grade)) {
                  code = `KUTSEHINDAMINE_${grade}`
                  value = grade
                  // Map numeric grades to nameEt/nameEn as in Tahvel UI
                  const gradeNames = {
                    5: { nameEt: 'Väga hea', nameEn: 'Very good' },
                    4: { nameEt: 'Hea', nameEn: 'Good' },
                    3: { nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
                    2: { nameEt: 'Puudulik', nameEn: 'Insufficient' },
                    1: { nameEt: 'Nõrk', nameEn: 'Weak' }
                  }
                  nameEt = gradeNames[grade]?.nameEt || ''
                  nameEn = gradeNames[grade]?.nameEn || ''
                } else if (grade === 'MA') {
                  code = 'KUTSEHINDAMINE_MA'
                  value = 'MA'
                  nameEt = 'Mitte arvestatud'
                  nameEn = 'Fail'
                } else if (grade === 'A') {
                  code = 'KUTSEHINDAMINE_A'
                  value = 'A'
                  nameEt = 'Arvestatud'
                  nameEn = 'Pass'
                } else {
                  return null
                }
                // If an existing grade exists for this student/ÕV, include update fields
                const existing = freshGradesMap[lookupKey]
                if (existing) {
                  Logger.info('✨ FinalGradesByOvFeature: Updating existing grade', { studentId, ovNum, id: existing.id, version: existing.version })
                  return {
                    version: existing.version,
                    id: existing.id,
                    studentId,
                    canEdit: true,
                    isCurriculumOutcome: true,
                    grade: {
                      code,
                      gradingSchemaRowId: null,
                      value,
                      value2: value,
                      extraval1: null,
                      extraval2: null,
                      nameEt,
                      nameEn,
                      valid: true
                    },
                    gradeDate,
                    removeStudentHistory: true,
                    addInfo: null,
                    gradeInserted: existing.gradeInserted,
                    gradeInsertedBy: existing.gradeInsertedBy,
                    history: existing.history || []
                  }
                } else {
                  Logger.info('✨ FinalGradesByOvFeature: Adding new grade', { studentId, ovNum })
                  // New grade
                  return {
                    studentId,
                    canEdit: true,
                    isCurriculumOutcome: true,
                    grade: {
                      code,
                      gradingSchemaRowId: null,
                      value,
                      value2: value,
                      extraval1: null,
                      extraval2: null,
                      nameEt,
                      nameEn,
                      valid: true
                    },
                    gradeDate
                  }
                }
              })
              .filter(Boolean)
            if (!outcomeStudents.length) continue
            const url = `/journals/${journalId}/journalOutcome/${journalOutcomeId}`
            const payload = { outcomeStudents }
            Logger.info('✨ FinalGradesByOvFeature: Sending payload for ÕV', { ovNum, payload })
            let resp
            try {
              resp = await this.api.tahvel.post(url, payload)
              statusDiv.textContent += `ÕV ${ovNum}: OK. `
              anySuccess = true
            } catch (err) {
              statusDiv.textContent += `ÕV ${ovNum}: VIGA! `
            }
          }
          if (!anySuccess) statusDiv.textContent = 'Ühtegi hinnet ei saadetud.'
          sendBtn.textContent = 'Saada ÕV hinded Tahvlisse'
        } catch (err) {
          statusDiv.textContent = 'Viga saatmisel.'
          sendBtn.textContent = 'Saada ÕV hinded Tahvlisse'
        } finally {
          sendBtn.disabled = false
        }
      }
    } else {
      // Remove send button if it exists (for SISSEKANNE_L case)
      const existingSendBtn = document.getElementById('oa-send-ov-grades-btn')
      if (existingSendBtn) {
        existingSendBtn.remove()
      }
      const existingStatusDiv = document.getElementById('oa-send-ov-status')
      if (existingStatusDiv) {
        existingStatusDiv.remove()
      }
    }
    Logger.info('✨ FinalGradesByOvFeature: Results table rendered and visible')
  }
}

export default FinalGradesByOvFeature
