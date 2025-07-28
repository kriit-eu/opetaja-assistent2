import Logger from '../../services/Logger.js'
import { domService } from '../../services/DomService.js'

class FinalGradesLFeature {
  constructor(api, extractJournalId) {
    this.api = api
    this.extractJournalId = extractJournalId
    this._lastEntries = null
  }

  detect(entries) {
    return entries.some(entry => entry.entryType === 'SISSEKANNE_L')
  }

  extractFinalGrades(entries, students) {
    const studentMap = {}
    students.forEach(s => {
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
    })

    // Only use grades from SISSEKANNE_I and SISSEKANNE_T for calculation
    const gradesT = {}
    const gradesI = {}

    entries.forEach(entry => {
      if ((entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_I') && entry.journalStudentResults) {
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, resultsArr]) => {
          if (Array.isArray(resultsArr)) {
            resultsArr.forEach(result => {
              if (result.grade && result.grade.code) {
                const grade = result.grade.code.replace('KUTSEHINDAMINE_', '')
                if (entry.entryType === 'SISSEKANNE_T') {
                  gradesT[journalStudentId] = grade
                } else if (entry.entryType === 'SISSEKANNE_I') {
                  gradesI[journalStudentId] = grade
                }
              }
            })
          }
        })
      }
    })

    const output = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      // Priority: T > I
      let finalGrade = ''
      if (gradesT[journalStudentId]) {
        finalGrade = gradesT[journalStudentId]
      } else if (gradesI[journalStudentId]) {
        finalGrade = gradesI[journalStudentId]
      }
      output.push({
        name: student.name,
        idcode: student.idcode,
        finalGrade,
        journalStudentId,
        studentId: student.studentId
      })
    })
    Logger.info('✨ FinalGradesLFeature: output', output)
    return { output }
  }

  showResults(results, button, lastEntries) {
    const { output } = results
    let html = ''
    html += '<style>'
    html += '.oa-final-grades-table {margin-top:16px;border-collapse:collapse;width:100%;font-size:15px;}'
    html += '.oa-final-grades-table th {background:#1976d2;color:#fff;padding:8px 12px;border:1px solid #1976d2;text-align:left;}'
    html += '.oa-final-grades-table td {padding:8px 12px;border:1px solid #e0e0e0;}'
    html += '.oa-final-grades-table tr:nth-child(even) {background:#f5f7fa;}'
    html += '.oa-final-grades-table tr:hover {background:#e3f2fd;}'
    html += '</style>'
    html += '<table class="oa-final-grades-table">'
    html += '<thead><tr><th>Õpilane</th><th>Lõpptulemus</th></tr></thead><tbody>'
    output.forEach(function (r) {
      html += '<tr><td>' + r.name + '</td><td>'
      let display = '',
        tooltip = ''
      const grade = r.finalGrade
      if (/^\d+(\.\d+)?$/.test(grade)) {
        const numGrade = Number(grade)
        display = String(Math.round(numGrade))
        // Show tooltip if the grade is not an integer (e.g., 3.25)
        if (!Number.isInteger(numGrade)) {
          tooltip = grade
        }
      } else {
        display = grade || ''
      }
      if (tooltip) {
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
    // Add sync button
    let syncBtn = document.getElementById('oa-sync-lopp-btn')
    if (!syncBtn) {
      syncBtn = domService.createAndInsertElement(
        'button',
        {
          id: 'oa-sync-lopp-btn',
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
        'Sync Lõpptulemus Tahvlisse',
        container,
        'afterend'
      )
    }
    let statusDiv = document.getElementById('oa-sync-lopp-status')
    if (!statusDiv) {
      statusDiv = domService.createAndInsertElement(
        'div',
        { id: 'oa-sync-lopp-status', style: { margin: '8px 0', color: '#1976d2', fontWeight: 'bold' } },
        '',
        syncBtn,
        'afterend'
      )
    }
    syncBtn.onclick = async () => {
      syncBtn.disabled = true
      syncBtn.textContent = 'Saatmine...'
      statusDiv.textContent = ''
      try {
        const journalId = this.extractJournalId()
        // Find the SISSEKANNE_L entry
        const lEntry = (lastEntries || []).find(e => e.entryType === 'SISSEKANNE_L')
        if (!lEntry) {
          statusDiv.textContent = 'Lõpptulemus puudub.'
          syncBtn.textContent = 'Sync Lõpptulemus Tahvlisse'
          return
        }
        // Build journalEntryStudents array from output
        const journalEntryStudents = results.output
          .map(r => {
            const existing = (lEntry.journalEntryStudents || []).find(js => js.journalStudent === r.journalStudentId)
            let grade = r.finalGrade
            let code = null,
              value = '',
              value2 = '',
              nameEt = '',
              nameEn = '',
              valid = true
            if (["1", "2", "3", "4", "5"].includes(grade)) {
              code = `KUTSEHINDAMINE_${grade}`
              value = grade
              value2 = grade
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
              value2 = 'ma'
              nameEt = 'Mittearvestatud'
              nameEn = 'Failed'
            } else if (grade === 'A') {
              code = 'KUTSEHINDAMINE_A'
              value = 'A'
              value2 = 'a'
              nameEt = 'Arvestatud'
              nameEn = 'Passed'
            } else {
              return null
            }
            // If updating, preserve all fields from existing, only update grade
            if (existing) {
              return {
                ...existing,
                grade: {
                  code,
                  gradingSchemaRowId: null,
                  value,
                  value2,
                  extraval1: null,
                  extraval2: null,
                  nameEt,
                  nameEn,
                  valid
                }
              }
            } else {
              // Add new with full structure
              return {
                id: undefined,
                journalStudent: r.journalStudentId,
                absence: null,
                grade: {
                  code,
                  gradingSchemaRowId: null,
                  value,
                  value2,
                  extraval1: null,
                  extraval2: null,
                  nameEt,
                  nameEn,
                  valid
                },
                verbalGrade: null,
                removeStudentHistory: false,
                addInfo: null,
                isLessonAbsence: false,
                hasOverlappingLessonAbsence: false,
                isPraise: false,
                isRemark: false,
                lessonAbsences: {},
                studentName: null,
                studentGroup: null,
                journalEntryStudentHistories: [],
                hasWholeDayAcceptedAbsence: false,
                wholeDayAbsenceCode: null
              }
            }
          })
          .filter(Boolean)
        // Build payload
        const payload = {
          ...lEntry,
          journalEntryStudents
        }
        Logger.info('✨ FinalGradesLFeature: Sending SISSEKANNE_L PUT', { url: `/journals/${journalId}/journalEntry/${lEntry.id}`, payload })
        await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${lEntry.id}`, payload)
        statusDiv.textContent = 'Lõpptulemus sünkroonitud!'
        syncBtn.textContent = 'Sync Lõpptulemus Tahvlisse'
      } catch (err) {
        statusDiv.textContent = 'Viga saatmisel.'
        syncBtn.textContent = 'Sync Lõpptulemus Tahvlisse'
      } finally {
        syncBtn.disabled = false
      }
    }
  }
}

export default FinalGradesLFeature
