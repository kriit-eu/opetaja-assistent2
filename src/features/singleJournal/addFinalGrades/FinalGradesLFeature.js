import Logger from '../../../services/Logger.js'
import { domService } from '../../../services/DomService.js'

class FinalGradesLFeature {
  constructor(api, extractJournalId) {
    this.api = api
    this.extractJournalId = extractJournalId
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
    const gradesT = {} // Will store arrays of grades for each student
    const gradesI = {} // Will store arrays of grades for each student

    entries.forEach(entry => {
      if (entry.entryType === 'SISSEKANNE_T' || entry.entryType === 'SISSEKANNE_I') {
        // 1. Extract from journalStudentResults (if present)
        if (entry.journalStudentResults) {
          Logger.info(`✨ FinalGradesLFeature: Processing ${entry.entryType} entry (journalStudentResults)`, entry.journalStudentResults)
          Object.entries(entry.journalStudentResults).forEach(([journalStudentId, resultsArr]) => {
            if (Array.isArray(resultsArr)) {
              resultsArr.forEach(result => {
                if (result.grade && result.grade.code) {
                  const grade = result.grade.code.replace('KUTSEHINDAMINE_', '')
                  if (['1', '2', '3', '4', '5'].includes(grade)) {
                    if (entry.entryType === 'SISSEKANNE_T') {
                      if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                      gradesT[journalStudentId].push(parseInt(grade))
                      Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_T grade for student ${journalStudentId}: ${grade}`)
                    } else if (entry.entryType === 'SISSEKANNE_I') {
                      if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                      gradesI[journalStudentId].push(parseInt(grade))
                      Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_I grade for student ${journalStudentId}: ${grade}`)
                    }
                  } else if (['A', 'MA'].includes(grade)) {
                    const key = journalStudentId + '_str'
                    if (entry.entryType === 'SISSEKANNE_T') {
                      if (!gradesT[key]) gradesT[key] = []
                      gradesT[key].push(grade)
                      Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_T string grade for student ${journalStudentId}: ${grade}`)
                    } else if (entry.entryType === 'SISSEKANNE_I') {
                      if (!gradesI[key]) gradesI[key] = []
                      gradesI[key].push(grade)
                      Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_I string grade for student ${journalStudentId}: ${grade}`)
                    }
                  }
                }
              })
            }
          })
        }
        // 2. Extract from journalEntryStudents (if present)
        if (Array.isArray(entry.journalEntryStudents)) {
          Logger.info(`✨ FinalGradesLFeature: Processing ${entry.entryType} entry (journalEntryStudents)`, entry.journalEntryStudents)
          entry.journalEntryStudents.forEach(js => {
            if (js.grade && js.grade.code) {
              const grade = js.grade.code.replace('KUTSEHINDAMINE_', '')
              const journalStudentId = js.journalStudent
              if (['1', '2', '3', '4', '5'].includes(grade)) {
                if (entry.entryType === 'SISSEKANNE_T') {
                  if (!gradesT[journalStudentId]) gradesT[journalStudentId] = []
                  gradesT[journalStudentId].push(parseInt(grade))
                  Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_T grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                } else if (entry.entryType === 'SISSEKANNE_I') {
                  if (!gradesI[journalStudentId]) gradesI[journalStudentId] = []
                  gradesI[journalStudentId].push(parseInt(grade))
                  Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_I grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                }
              } else if (['A', 'MA'].includes(grade)) {
                const key = journalStudentId + '_str'
                if (entry.entryType === 'SISSEKANNE_T') {
                  if (!gradesT[key]) gradesT[key] = []
                  gradesT[key].push(grade)
                  Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_T string grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                } else if (entry.entryType === 'SISSEKANNE_I') {
                  if (!gradesI[key]) gradesI[key] = []
                  gradesI[key].push(grade)
                  Logger.info(`✨ FinalGradesLFeature: Added SISSEKANNE_I string grade for student ${journalStudentId} (journalEntryStudents): ${grade}`)
                }
              }
            }
          })
        }
      }
    })

    Logger.info('✨ FinalGradesLFeature: All SISSEKANNE_T grades', gradesT)
    Logger.info('✨ FinalGradesLFeature: All SISSEKANNE_I grades', gradesI)

    const output = []
    Object.entries(studentMap).forEach(([journalStudentId, student]) => {
      const tGrades = gradesT[journalStudentId] || []
      const iGrades = gradesI[journalStudentId] || []
      const allGrades = [...tGrades, ...iGrades]
      const allStringGrades = [...(gradesT[journalStudentId + '_str'] || []), ...(gradesI[journalStudentId + '_str'] || [])]
      Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL SISSEKANNE_T grades:`, tGrades)
      Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL SISSEKANNE_I grades:`, iGrades)
      Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL COMBINED grades:`, allGrades)
      Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) ALL STRING grades:`, allStringGrades)
      let finalGrade = ''
      if (allStringGrades.includes('MA')) {
        finalGrade = 'MA'
        Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: at least one MA → MA`)
      } else if (allStringGrades.length > 0 && allStringGrades.every(g => g === 'A')) {
        finalGrade = 'A'
        Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: all A → A`)
      } else if (allGrades.length > 0) {
        const sum = allGrades.reduce((a, b) => a + b, 0)
        const avg = sum / allGrades.length
        finalGrade = String(Math.round(avg))
        Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: combined avg ${avg} → ${finalGrade}`)
      } else {
        Logger.info(`✨ FinalGradesLFeature: Student ${journalStudentId} (${student.name}) FINAL: no grades`)
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

  async showResults(results, button, lastEntries) {
    // Only sync grades and show a status message, do not render a table
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    container.innerHTML = ''
    let statusDiv = document.getElementById('oa-sync-lopp-status')
    if (!statusDiv) {
      statusDiv = domService.createAndInsertElement(
        'div',
        { id: 'oa-sync-lopp-status', style: { margin: '8px 0', color: '#1976d2', fontWeight: 'bold' } },
        '',
        container,
        'afterend'
      )
    }
    statusDiv.textContent = ''
    try {
      const journalId = this.extractJournalId()
      // Find the SISSEKANNE_L entry
      const lEntry = (lastEntries || []).find(e => e.entryType === 'SISSEKANNE_L')
      if (!lEntry) {
        statusDiv.textContent = 'Lõpptulemus puudub.'
        return
      }
      // Fetch current state from API first
      const currentEntry = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${lEntry.id}`)
      Logger.info('✨ FinalGradesLFeature: Current entry from API', currentEntry)
      // Build journalEntryStudents array from our filtered calculated grades
      const lGrades = {}
      if (currentEntry && Array.isArray(currentEntry.journalEntryStudents)) {
        currentEntry.journalEntryStudents.forEach(js => {
          if (js && js.journalStudent != null && js.grade && js.grade.code) {
            const code = js.grade.code
            lGrades[String(js.journalStudent)] = code.replace('KUTSEHINDAMINE_', '').toUpperCase()
          }
        })
      }
      const filteredOutput = results.output.filter(r => {
        const key = String(r.journalStudentId).trim()
        const current = lGrades[key]
        if (!current) return r.finalGrade && r.finalGrade !== ''
        return (r.finalGrade && String(r.finalGrade).toUpperCase()) !== current
      })
      Logger.info(
        '✨ FinalGradesLFeature: filtered results.output journalStudentIds',
        filteredOutput.map(r => r.journalStudentId)
      )
      // Fetch student statuses for filtered students so we can apply OPPURSTAATUS_A rule
      const uniqueStudentIds = Array.from(new Set(filteredOutput.map(r => r.studentId).filter(Boolean)))
      const studentStatusMap = {}
      await Promise.all(uniqueStudentIds.map(async id => {
        try {
          const det = await this.api.tahvel.get(`/students/${id}`)
          studentStatusMap[String(id)] = det && det.status ? det.status : null
        } catch (e) {
          Logger.error('✨ FinalGradesLFeature: Failed to fetch student details, defaulting to include', { studentId: id, err: e })
          studentStatusMap[String(id)] = null
        }
      }))

      const mappedStudents = filteredOutput
        .map(r => {
          // If student is on status A (OPPURSTAATUS_A) only allow adding if finalGrade is not MA, 1 or 2
          const status = studentStatusMap[String(r.studentId)]
          const gradeStr = String(r.finalGrade || '').toUpperCase()
          if (status === 'OPPURSTAATUS_A' && (gradeStr === 'MA' || gradeStr === '1' || gradeStr === '2')) {
            Logger.info('✨ FinalGradesLFeature: Skipping L grade for OPPURSTAATUS_A student due to disallowed grade', { journalStudentId: r.journalStudentId, studentId: r.studentId, grade: gradeStr })
            return null
          }
          
          // existing mapping logic
          
          
          const existing = (currentEntry.journalEntryStudents || []).find(js => String(js.journalStudent) === String(r.journalStudentId))
          const grade = r.finalGrade
          let code = null,
            value = '',
            value2 = '',
            nameEt = '',
            nameEn = ''
          const valid = true
          if (['1', '2', '3', '4', '5'].includes(grade)) {
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
          if (existing) {
            return {
              ...existing,
              journalStudent: String(r.journalStudentId),
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
              removeStudentHistory: true
            }
          } else {
            return {
              id: undefined,
              journalStudent: String(r.journalStudentId),
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
                valid: true
              },
              verbalGrade: null,
              removeStudentHistory: true,
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
      // Deduplicate by journalStudent (last one wins), filter out null/undefined journalStudent
      const seen = new Map()
      mappedStudents.forEach(js => {
        if (js && js.journalStudent != null) {
          seen.set(String(js.journalStudent), js)
        }
      })
      const journalEntryStudents = Array.from(seen.values()).filter(js => js && js.journalStudent != null)
      Logger.info('✨ FinalGradesLFeature: journalEntryStudents to send', journalEntryStudents)
      // Build payload using the current entry from API
      const payload = {
        ...currentEntry,
        journalEntryStudents
      }
      Logger.info('✨ FinalGradesLFeature: Sending SISSEKANNE_L PUT', { url: `/journals/${journalId}/journalEntry/${lEntry.id}`, payload })
      await this.api.tahvel.put(`/journals/${journalId}/journalEntry/${lEntry.id}`, payload)
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      statusDiv.textContent = 'Viga saatmisel.'
    }
  }
}

export default FinalGradesLFeature
