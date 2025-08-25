import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { domService } from '../../../services/DomService.js'
import FinalGradesLFeature from './FinalGradesLFeature.js'
import HighlightFinalGradesFeature from '../highlightFinalGrades/HighlightFinalGradesFeature.js'

class FinalGradesByOvFeature extends BaseFeature {
  // Helper to fetch and transform detailed outcome data for SISSEKANNE_O
  async #fetchDetailedOutcomeStudents(journalId, outcomeId, students, opts = {}) {
    // opts: { output: 'studentOutcomeResults' | 'existingGradesMap', ovNum }
    try {
      const detailedOutcome = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${outcomeId}`)
      if (!detailedOutcome.outcomeStudents) return opts.output === 'studentOutcomeResults' ? {} : {}
      if (opts.output === 'studentOutcomeResults') {
        // Map to { [journalStudentId]: [ { grade } ] }
        const result = {}
        detailedOutcome.outcomeStudents.forEach(outcomeStudent => {
          const matchingStudent = students.find(s => {
            const studentId = s.student ? s.student.id : s.id
            return String(studentId) === String(outcomeStudent.studentId)
          })
          if (matchingStudent && outcomeStudent.grade) {
            const journalStudentId = matchingStudent.id
            result[journalStudentId] = [{ grade: outcomeStudent.grade }]
          }
        })
        return result
      } else if (opts.output === 'existingGradesMap' && opts.ovNum) {
        // Map to { `${studentId}|${ovNum}`: outcomeStudent }
        const result = {}
        detailedOutcome.outcomeStudents.forEach(outcomeStudent => {
          if (outcomeStudent.studentId && outcomeStudent.grade) {
            const key = `${outcomeStudent.studentId}|${opts.ovNum}`
            result[key] = outcomeStudent
          }
        })
        return result
      }
      return {}
    } catch (err) {
      // Logging is handled by caller
      return opts.output === 'studentOutcomeResults' ? {} : {}
    }
  }
  static OA_BTN_STYLE = {
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

  #mapGradeToSchema(grade) {
    let code = null,
      nameEt = '',
      nameEn = '',
      value = ''
    if (['1', '2', '3', '4', '5'].includes(grade)) {
      code = `KUTSEHINDAMINE_${grade}`
      value = grade
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
    return { code, value, nameEt, nameEn }
  }

  async #syncOvGrades({ results, ovNumToOutcomeId, filteredOutput, container, statusDiv = null, button = null }) {
    let allSuccess = true
    try {
      const journalId = this.#extractJournalId()
      const estDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' })
      const gradeDate = estDate + 'T00:00:00.000Z'
      for (const ovNum of results.allOvNums) {
        if (!ovNumToOutcomeId || !ovNumToOutcomeId[ovNum]) {
          Logger.error('FinalGradesByOvFeature: No outcomeId mapping for ÕV', { ovNum, ovNumToOutcomeId })
          if (container)
            container.innerHTML = `<div style="margin:16px 0;color:#d32f2f;font-weight:bold;">Viga: ei leitud ÕV ${ovNum} outcomeId vastendust selles päevikus!</div>`
          allSuccess = false
          continue
        }
        const journalOutcomeId = ovNumToOutcomeId[ovNum]
        let latestOutcomeEntry = null
        try {
          latestOutcomeEntry = await this.api.tahvel.get(`/journals/${journalId}/journalOutcome/${journalOutcomeId}`)
        } catch (err) {
          Logger.error('FinalGradesByOvFeature: Error fetching journalOutcome', { journalId, journalOutcomeId, err })
          if (container)
            container.innerHTML = `<div style="margin:16px 0;color:#d32f2f;font-weight:bold;">Viga: ei saanud kätte ÕV ${ovNum} outcome andmeid!</div>`
          allSuccess = false
          continue
        }
        const freshGradesMap = {}
        if (latestOutcomeEntry && latestOutcomeEntry.outcomeStudents && Array.isArray(latestOutcomeEntry.outcomeStudents)) {
          latestOutcomeEntry.outcomeStudents.forEach(outcomeStudent => {
            if (outcomeStudent.studentId) {
              const key = `${outcomeStudent.studentId}|${ovNum}`
              freshGradesMap[key] = outcomeStudent
            }
          })
        }
        // Fetch statuses for students in filteredOutput so we can apply OPPURSTAATUS_A rule
        const uniqueStudentIds = Array.from(new Set((filteredOutput || []).map(r => Number(r.studentId)).filter(Boolean)))
        const studentStatusMap = {}
        await Promise.all(uniqueStudentIds.map(async sid => {
          try {
            const det = await this.api.tahvel.get(`/students/${sid}`)
            studentStatusMap[String(sid)] = det && det.status ? det.status : null
          } catch (e) {
            Logger.error('FinalGradesByOvFeature: Failed to fetch student details, defaulting to include', { studentId: sid, err: e })
            studentStatusMap[String(sid)] = null
          }
        }))
        const outcomeStudents = filteredOutput
          .map(r => {
            let grade = r.ovGrades[ovNum]
            if (!grade) return null
            if (/^\d+(\.\d+)?$/.test(grade)) {
              const rounded = Math.round(Number(grade))
              if (rounded >= 1 && rounded <= 5) grade = String(rounded)
            }
            const studentId = Number(r.studentId)
            // If student is on academic leave (OPPURSTAATUS_A) only allow adding ÕV if grade is not MA, 1 or 2
            const status = studentStatusMap[String(studentId)]
            const normalizedGrade = String(grade || '').toUpperCase()
            if (status === 'OPPURSTAATUS_A' && (normalizedGrade === 'MA' || normalizedGrade === '1' || normalizedGrade === '2')) {
              Logger.info('FinalGradesByOvFeature: Skipping ÕV grade for OPPURSTAATUS_A student due to disallowed grade', { studentId, ovNum, grade: normalizedGrade })
              return null
            }
            const lookupKey = `${studentId}|${ovNum}`
            const mapped = this.#mapGradeToSchema(grade)
            if (!mapped) return null
            const existing = freshGradesMap[lookupKey]
            const gradeObj = {
              code: mapped.code,
              gradingSchemaRowId: null,
              value: mapped.value,
              value2: mapped.value,
              extraval1: null,
              extraval2: null,
              nameEt: mapped.nameEt,
              nameEn: mapped.nameEn,
              valid: true
            }
            if (existing) {
              return {
                version: existing.version,
                id: existing.id,
                studentId,
                canEdit: true,
                isCurriculumOutcome: true,
                grade: gradeObj,
                gradeDate,
                removeStudentHistory: true,
                addInfo: null,
                gradeInserted: existing.gradeInserted,
                gradeInsertedBy: existing.gradeInsertedBy,
                history: existing.history || []
              }
            } else {
              return {
                studentId,
                canEdit: true,
                isCurriculumOutcome: true,
                grade: gradeObj,
                gradeDate
              }
            }
          })
          .filter(Boolean)
        if (!outcomeStudents.length) continue
        const url = `/journals/${journalId}/journalOutcome/${journalOutcomeId}`
        const payload = { outcomeStudents }
        Logger.info('✨ FinalGradesByOvFeature: Sending payload for ÕV', { ovNum, payload })
        try {
          await this.api.tahvel.post(url, payload)
          if (statusDiv) statusDiv.textContent += `ÕV ${ovNum}: OK. `
        } catch (err) {
          allSuccess = false
          if (statusDiv) statusDiv.textContent += `ÕV ${ovNum}: VIGA! `
        }
      }
      if (allSuccess) {
        // mark button as intentionally disabled after successful send
        if (button) {
          try {
            button._oaFinalGradesDisabled = true
            button.disabled = true
            button.style.opacity = '0.6'
            button.title = 'Hinded saadetud — enam pole midagi saata'
              try {
                const isL = (button && String(button.textContent || '').toLowerCase().includes('lõpptulemus'))
                button.textContent = isL ? 'Lõpptulemused saadetud' : 'Õpiväljundite hinded saadetud'
              } catch (innerErr) { Logger.warn('FinalGradesByOvFeature: Ignored inner error', innerErr) }
          } catch (e) {
            Logger.warn('FinalGradesByOvFeature: Failed to update button state after sync', e)
          }
        }
        if (statusDiv && statusDiv.textContent === '') statusDiv.textContent = 'Kõik õpiväljundite hinded saadetud.'
      } else if (!allSuccess && statusDiv && statusDiv.textContent === '') {
        statusDiv.textContent = 'Ühtegi hinnet ei saadetud.'
      }
      return allSuccess
    } catch (err) {
      if (statusDiv) statusDiv.textContent = 'Viga saatmisel.'
      throw err
    }
  }
  constructor() {
    super('finalGradesByOv', () => true, null) // Activate on any page for testing
    Logger.info('✨ FinalGradesByOvFeature: Constructor called - will activate on any page for testing')
  }

  shouldActivate(url) {
    // Only activate on /journal/<id>/edit URLs
    const match = url.match(/\/journal\/(\d+)\/edit/)
    const result = !!match && super.shouldActivate(url)
    Logger.info('✨ FinalGradesByOvFeature: shouldActivate called', { url, result })
    if (!result && url.match(/\/journal\/(\d+)/)) {
      Logger.info('[DEBUG] Not activating: journal page but not /edit subpage', { url })
    }
    return result
  }

  async onActivate() {
    Logger.info('✨ FinalGradesByOvFeature: onActivate called')
    Logger.info('✨ FinalGradesByOvFeature: Current URL:', window.location.href)

    // Mutation observer to re-attach the real async handler if button is replaced
    const attachAsyncHandler = () => {
      const btn = document.querySelector('.oa-final-grades-btn')
      Logger.info('[DEBUG] attachAsyncHandler called. Button found:', btn)
      if (!btn) return
      if (!btn._oaHandlerAttached) {
        Logger.info('[DEBUG] Attaching direct click handler to button')
        btn.addEventListener('click', async() => {
          Logger.info('✨ FinalGradesByOvFeature: Direct button click detected')
          btn.disabled = true
          btn.textContent = 'Laen...'
          btn.style.background = '#ff9800'
          try {
            Logger.info('✨ FinalGradesByOvFeature: Button click handler start (direct)')
            const journalId = this.#extractJournalId()
            Logger.info('[DEBUG] Direct click: journalId:', journalId)
            if (!journalId) {
              Logger.error('[DEBUG] Direct click: No journalId found!')
              btn.textContent = 'Viga!'
              btn.style.background = '#d32f2f'
              return
            }
            const [entries, students] = await Promise.all([
              this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
              this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
            ])
            Logger.info('✨ FinalGradesByOvFeature: API entries fetched:', entries)
            Logger.info('✨ FinalGradesByOvFeature: API students fetched:', students)
            this._lastEntries = entries
            const results = await this.#calculateFinalGrades(entries, students)
            Logger.info('✨ FinalGradesByOvFeature: Results calculated:', results)
            await this.#showResults(results, btn)
            btn.textContent = 'Valmis!'
            btn.style.background = '#388e3c'
          } catch (e) {
            Logger.error('FinalGradesByOvFeature error', e && (e.stack || e.message || e))
            btn.textContent = 'Viga!'
            btn.style.background = '#d32f2f'
          } finally {
            setTimeout(() => {
              try {
                if (!btn._oaFinalGradesDisabled) {
                  btn.disabled = false
                  btn.textContent = 'Lisa õpiväljundite hinded'
                  btn.style.background = 'rgb(21, 101, 192)'
                }
              } catch (e) {
                Logger.warn('FinalGradesByOvFeature: Error restoring button state', e)
              }
            }, 3000)
          }
        })
        btn._oaHandlerAttached = true
      }
    }

    // Observe changes to #main-content
    const mainContent = document.querySelector('#main-content')
    Logger.info('[DEBUG] mainContent found:', mainContent)
    if (mainContent) {
      const observer = new MutationObserver(() => {
        Logger.info('[DEBUG] MutationObserver triggered')
        attachAsyncHandler()
      })
      observer.observe(mainContent, { childList: true, subtree: true })
      // Initial attach
      Logger.info('[DEBUG] Initial attachAsyncHandler call')
      attachAsyncHandler()
    } else {
      Logger.warning('[DEBUG] #main-content not found on page load')
    }

    Logger.info('✨ FinalGradesByOvFeature: Test button logic start')

    try {
      // Only proceed if URL matches /journal/<id>/edit
      const url = window.location.href
      const match = url.match(/\/journal\/(\d+)\/edit/)
      if (!match) {
        Logger.info('[DEBUG] Not on /journal/<id>/edit, skipping button logic', { url })
        return
      }
      const journalId = match[1]
      Logger.info('[DEBUG] Journal ID extracted:', journalId)
      if (!journalId) {
        Logger.warning('✨ FinalGradesByOvFeature: No journal ID found, feature will not work')
        return
      }
      // Fetch entries and students to check for ÕV columns or SISSEKANNE_L
      Logger.info('[DEBUG] Fetching entries and students for journalId:', journalId)
      const [entries, students] = await Promise.all([
        this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
        this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
      ])
      Logger.info('[DEBUG] Entries fetched:', entries)
      Logger.info('[DEBUG] Students fetched:', students)
      const lFeature = new FinalGradesLFeature(this.api, this.#extractJournalId)
      const hasSissekanneL = lFeature.detect(entries)
      Logger.info('[DEBUG] hasSissekanneL:', hasSissekanneL)
      const results = hasSissekanneL ? lFeature.extractFinalGrades(entries, students) : await this.#calculateFinalGrades(entries, students)
      Logger.info('[DEBUG] Results:', results)
      if (!hasSissekanneL && (!results.allOvNums || results.allOvNums.length === 0)) {
        Logger.info('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected, feature will not activate')
        Logger.info('[DEBUG] Not activating: hasSissekanneL:', hasSissekanneL, 'allOvNums:', results.allOvNums)
        return
      }
      // Wait for the table container in #main-content
      let tableContainer = null
      try {
        Logger.info('[DEBUG] Waiting for .journalTableContainer')
        tableContainer = await domService.waitForElement('.journalTableContainer', 20000, 100)
        Logger.info('✨ FinalGradesByOvFeature: Table container found', tableContainer)
      } catch (e) {
        Logger.warning('FinalGradesByOvFeature: Table container not found, will try fallback', e)
        Logger.info('[DEBUG] Table container not found, fallback to #main-content')
      }
      // Use existing button if present, otherwise insert
      let button = document.querySelector('.oa-final-grades-btn')
      Logger.info('[DEBUG] Existing button found:', button)
      const buttonText = hasSissekanneL ? 'Lisa lõpptulemuse hinded' : 'Lisa õpiväljundite hinded'
      if (!button) {
        Logger.info('[DEBUG] No existing button, will insert new button')
        if (tableContainer) {
          button = domService.createAndInsertElement(
            'button',
            {
              type: 'button',
              class: 'oa-final-grades-btn',
              style: FinalGradesByOvFeature.OA_BTN_STYLE
            },
            buttonText,
            tableContainer,
            'afterend'
          )
          Logger.info('✨ FinalGradesByOvFeature: Button inserted after table container', button)
        } else {
          // Fallback: insert at end of #main-content
          const mainContent = document.querySelector('#main-content')
          Logger.info('[DEBUG] Fallback mainContent:', mainContent)
          if (mainContent) {
            button = domService.createAndInsertElement(
              'button',
              {
                type: 'button',
                class: 'oa-final-grades-btn',
                style: FinalGradesByOvFeature.OA_BTN_STYLE
              },
              buttonText,
              mainContent,
              'beforeend'
            )
            Logger.info('✨ FinalGradesByOvFeature: Button inserted at end of #main-content', button)
          } else {
            Logger.error('FinalGradesByOvFeature: #main-content not found, cannot insert button')
            Logger.info('[DEBUG] Could not insert button: #main-content missing')
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
      // Store entries for later use (used by #showResults and delegated handler)
      this._lastEntries = entries

      // --- NEW: Calculate grades on page load (without auto-sync) ---
      try {
        Logger.info('✨ FinalGradesByOvFeature: Calculating grades on page load')
        const lFeature = new FinalGradesLFeature(this.api, this.#extractJournalId)
        const hasSissekanneL = lFeature.detect(entries)
        const resultsOnLoad = hasSissekanneL ? lFeature.extractFinalGrades(entries, students) : await this.#calculateFinalGrades(entries, students)
        // Call showResults with autoSync=false so we only compute filteredOutput and update button state/UI
        if (hasSissekanneL) {
          // Use the L feature's showResults which accepts autoSync flag
          await lFeature.showResults(resultsOnLoad, button, entries, { autoSync: false })
          // Attach L-specific DOM observer so the L-button is kept up-to-date on meaningful DOM changes
          try {
            const lObserver = lFeature.attachDomObserver(button, entries)
            // store observer so it can be disconnected later if needed
            this._lObserver = lObserver
          } catch (e) {
            Logger.warn('FinalGradesByOvFeature: Failed to attach L DOM observer', e)
          }
        } else {
          await this.#showResults(resultsOnLoad, button, { autoSync: false })
        }
      } catch (err) {
        Logger.warn('FinalGradesByOvFeature: Failed to calculate grades on page load', err)
      }

      // Determine whether there are any grade changes to send and disable button if none
      try {
        const allOvNums = results.allOvNums || []
        const existingGradesMap = {}
        if (this._lastEntries) {
          for (const entry of this._lastEntries) {
            if (entry.entryType === 'SISSEKANNE_O') {
              const match = entry.nameEt && entry.nameEt.match(/^([0-9]+)\)/)
              const ovNum = match && match[1]
              if (ovNum) {
                const studentOutcomeResults = entry.studentOutcomeResults
                if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
                  // best-effort: try to fetch detailed outcome map synchronously-like (avoid awaiting here)
                } else if (studentOutcomeResults) {
                  Object.entries(studentOutcomeResults).forEach(([studentIdFromResults, res]) => {
                    const studentId = studentIdFromResults
                    if (studentId && res && res.grade) {
                      const key = `${studentId}|${ovNum}`
                      existingGradesMap[key] = res
                    }
                  })
                }
              }
            }
          }
        }
        const output = results.output || []
        const filteredOutput = output.filter(student => {
          if (allOvNums.length > 0) {
            return allOvNums.some(ovNum => {
              const calculatedGrade = student.ovGrades[ovNum]
              const existingGradeKey = `${student.studentId}|${ovNum}`
              const existingGradeEntry = existingGradesMap[existingGradeKey]
              let existingGrade = ''
              if (existingGradeEntry && existingGradeEntry.grade && existingGradeEntry.grade.code) {
                existingGrade = existingGradeEntry.grade.code.replace('KUTSEHINDAMINE_', '')
              }
              let normalizedCalculated = String(calculatedGrade || '').trim()
              const normalizedExisting = String(existingGrade || '').trim()
              if (/^\d+(\.\d+)?$/.test(normalizedCalculated) && /^\d+$/.test(normalizedExisting)) {
                normalizedCalculated = String(Math.round(Number(normalizedCalculated)))
              }
              return normalizedCalculated !== normalizedExisting
            })
          } else {
            return true
          }
        })
        if (allOvNums.length > 0 && filteredOutput.length === 0) {
          // No changes needed — disable button and indicate so with clearer text/title
          try {
            button.disabled = true
            button.style.opacity = '0.6'
            button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
              try {
                const isL = (button && String(button.textContent || '').toLowerCase().includes('lõpptulemus'))
                button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
              } catch (innerErr) { Logger.warn('FinalGradesByOvFeature: Ignored inner error', innerErr) }
            // mark as intentionally disabled (no further re-enable)
            button._oaFinalGradesDisabled = true
            Logger.info('✨ FinalGradesByOvFeature: No grade changes detected — disabled button')
          } catch (e) {
            Logger.warn('FinalGradesByOvFeature: Failed to disable button', e)
          }
        }
      } catch (e) {
        Logger.warn('FinalGradesByOvFeature: Error while checking for grade changes', e)
      }
      // Remove any old event delegation to avoid duplicates
      if (window._oaFinalGradesDelegation) {
        Logger.info('[DEBUG] Removing old event delegation')
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
          const journalId = this.#extractJournalId()
          Logger.info('[DEBUG] Delegated click: journalId:', journalId)
          if (!journalId) {
            Logger.error('[DEBUG] Delegated click: No journalId found!')
            btn.textContent = 'Viga!'
            btn.style.background = '#d32f2f'
            return
          }
          const [entries, students] = await Promise.all([
            this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false }),
            this.api.tahvel.get(`/journals/${journalId}/journalStudents`, { allStudents: true }, { cache: false })
          ])
          Logger.info('✨ FinalGradesByOvFeature: API entries fetched:', entries)
          Logger.info('✨ FinalGradesByOvFeature: API students fetched:', students)
          this._lastEntries = entries
          const lFeature = new FinalGradesLFeature(this.api, this.#extractJournalId)
          const hasSissekanneL = lFeature.detect(entries)
          Logger.info('[DEBUG] Delegated click: hasSissekanneL:', hasSissekanneL)
          const results = hasSissekanneL ? lFeature.extractFinalGrades(entries, students) : await this.#calculateFinalGrades(entries, students)
          Logger.info('[DEBUG] Delegated click: results:', results)
          if (!hasSissekanneL && (!results.allOvNums || results.allOvNums.length === 0)) {
            Logger.info('✨ FinalGradesByOvFeature: No ÕV columns or SISSEKANNE_L detected on button click, aborting')
            Logger.info('[DEBUG] Delegated click: Not activating: hasSissekanneL:', hasSissekanneL, 'allOvNums:', results.allOvNums)
            btn.textContent = 'ÕV-sid või lõpptulemust ei leitud'
            btn.style.background = '#d32f2f'
            setTimeout(() => {
              btn.disabled = false
              btn.textContent = 'Lisa lõpptulemuse hinded'
              btn.style.background = 'rgb(21, 101, 192)'
            }, 3000)
            return
          }
          Logger.info('✨ FinalGradesByOvFeature: Results calculated:', results)
          if (hasSissekanneL) {
            await lFeature.showResults(results, btn, entries)
          } else {
            await this.#showResults(results, btn)
          }
          btn.textContent = 'Valmis!'
          btn.style.background = '#388e3c'
        } catch (e) {
          Logger.error('FinalGradesByOvFeature error', e)
          btn.textContent = 'Viga!'
          btn.style.background = '#d32f2f'
        } finally {
          setTimeout(() => {
            try {
              if (!btn._oaFinalGradesDisabled) {
                btn.disabled = false
                // Set button text based on latest SISSEKANNE_L detection and whether any ÕV grades already exist
                const lFeature = new FinalGradesLFeature(this.api, this.#extractJournalId)
                const hasL = lFeature.detect(this._lastEntries || [])
                if (hasL) {
                  btn.textContent = 'Lisa lõpptulemuse hinded'
                } else {
                  const hasExistingOv = this.#hasAnyOvGrades(this._lastEntries || [])
                  btn.textContent = hasExistingOv ? 'Uuenda õpiväljundite hinded' : 'Lisa õpiväljundite hinded'
                }
                btn.style.background = 'rgb(21, 101, 192)'
              }
            } catch (e) {
              Logger.warn('FinalGradesByOvFeature: Error restoring button state (delegated)', e)
            }
          }, 3000)
        }
      }
      window._oaFinalGradesDelegation = delegatedHandler
      Logger.info('[DEBUG] Adding event delegation for .oa-final-grades-btn')
      document.addEventListener('click', delegatedHandler, true)
      // No need to add a direct event listener here; handled by mutation observer logic above
      // --- NEW: Observe journal table for changes and re-evaluate button state ---
      try {
        const tableEl = document.querySelector('.journalTableContainer') || document.querySelector('#main-content')
        if (tableEl) {
          let debounceTimer = null
          let lastSnapshot = null
          const getSnapshot = () => {
            try {
              // Lightweight visible text snapshot — trim to avoid huge strings
              const txt = (tableEl && tableEl.innerText) ? tableEl.innerText.trim() : ''
              return txt ? txt.slice(0, 20000) : ''
            } catch (e) {
              return ''
            }
          }
          const onTableChange = _records => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(async() => {
              try {
                // Compute snapshot and bail out quickly if nothing meaningful changed
                const snapshot = getSnapshot()
                if (snapshot === lastSnapshot) {
                  Logger.info('✨ FinalGradesByOvFeature: DOM changed but table snapshot unchanged — skipping API')
                  return
                }
                lastSnapshot = snapshot
                Logger.info('✨ FinalGradesByOvFeature: Detected meaningful DOM change — re-evaluating grade diffs')
                const journalId = this.#extractJournalId()
                if (!journalId) return
                    const [newEntries, newStudents] = await Promise.all([
                      this.api.tahvel.get(
                        `/journals/${journalId}/journalEntriesByDate`,
                        { allStudents: true },
                        { cache: false }
                      ),
                      this.api.tahvel.get(
                        `/journals/${journalId}/journalStudents`,
                        { allStudents: true },
                        { cache: false }
                      )
                    ])
                this._lastEntries = newEntries
                const lFeatureLocal = new FinalGradesLFeature(this.api, this.#extractJournalId)
                const hasLLocal = lFeatureLocal.detect(newEntries)
                let newResults
                if (hasLLocal) {
                  newResults = lFeatureLocal.extractFinalGrades(newEntries, newStudents)
                } else {
                  newResults = await this.#calculateFinalGrades(newEntries, newStudents)
                }
                // Call showResults with autoSync=false to compute filteredOutput and update button state
                const filtered = await this.#showResults(newResults, button, { autoSync: false })
                // If filtered is an array and has items -> enable button, otherwise disable and set global marker
                try {
                  if (Array.isArray(filtered) && filtered.length > 0) {
                    // enable
                    window._oaFinalGradesDisabled = false
                    if (button) {
                      button._oaFinalGradesDisabled = false
                      button.disabled = false
                      button.style.opacity = ''
                      button.title = ''
                      try {
                        // Decide proper label based on whether L-flow is present
                          const lFeatureCheck = new FinalGradesLFeature(this.api, this.#extractJournalId)
                          const hasLNow = lFeatureCheck.detect(this._lastEntries || [])
                          if (hasLNow) {
                            button.textContent = 'Lisa lõpptulemuse hinded'
                          } else {
                            const hasExistingOvNow = this.#hasAnyOvGrades(this._lastEntries || [])
                            button.textContent = hasExistingOvNow ? 'Uuenda õpiväljundite hinded' : 'Lisa õpiväljundite hinded'
                          }
                        button.style.background = 'rgb(21, 101, 192)'
                      } catch (innerErr) {
                        // ignore and leave title/style as-is
                      }
                    }
                    Logger.info('✨ FinalGradesByOvFeature: Button enabled after DOM change — changes detected')
                  } else {
                    // disable globally
                    window._oaFinalGradesDisabled = true
                    if (button) {
                      button._oaFinalGradesDisabled = true
                      button.disabled = true
                      button.style.opacity = '0.6'
                      button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
                      try {
                        const isL = (typeof buttonText !== 'undefined' && buttonText) ? buttonText.toLowerCase().includes('lõpptulemus')
                          : (button && String(button.textContent || '').toLowerCase().includes('lõpptulemus'))
                        button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
                        } catch (innerErr) { Logger.warn('FinalGradesByOvFeature: Ignored inner error', innerErr) }
                    }
                    Logger.info('✨ FinalGradesByOvFeature: Button disabled after DOM change — no changes detected')
                  }
                } catch (e) {
                  Logger.warn('FinalGradesByOvFeature: Failed to update button state after DOM change', e)
                }
              } catch (err) {
                Logger.warn('FinalGradesByOvFeature: Error while re-evaluating after DOM change', err)
              }
            }, 250)
          }
          const mo = new MutationObserver(onTableChange)
          mo.observe(tableEl, { childList: true, subtree: true, attributes: true })
        }
      } catch (e) {
        Logger.warn('FinalGradesByOvFeature: Failed to attach DOM observer for table changes', e)
      }
    } catch (e) {
      Logger.error('FinalGradesByOvFeature init error', e)
      Logger.info('[DEBUG] Exception in onActivate:', e)
    }
  }

  #extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? match[1] : null
  }

  async #calculateFinalGrades(entries, students) {
    Logger.info('✨ FinalGradesByOvFeature: DEBUG students structure:', students)
    const studentMap = {}
    const journalStudentIdToStudentId = {}
    let hasOvSissekanneI = false
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

    // Map ÕV number using outcomeOrderNr+1 for SISSEKANNE_O (robust to all nameEt formats)
    // This ensures correct mapping regardless of how ÕV is tagged in nameEt
    const ovNumToOutcomeId = {} // Map ÕV number (as string) to curriculumModuleOutcomes from SISSEKANNE_O
    entries.forEach(entry => {
      if (entry.entryType === 'SISSEKANNE_O' && typeof entry.outcomeOrderNr === 'number') {
        const ovNum = String(entry.outcomeOrderNr + 1)
        if (entry.curriculumModuleOutcomes) {
          ovNumToOutcomeId[ovNum] = entry.curriculumModuleOutcomes
        }
      }
      // Support ÕVn in nameEt for SISSEKANNE_I, including patterns like (ÕV1) or (ÕV1, ÕV2)
      if (entry.entryType === 'SISSEKANNE_I' && entry.nameEt) {
        // Find all ÕV numbers in parentheses, e.g. (ÕV1), (ÕV2), (ÕV1, ÕV2)
        const parenOvMatches = entry.nameEt.match(/\(\s*ÕV(\d+)(?:,\s*ÕV(\d+))*\s*\)/gi)
        if (parenOvMatches) {
          hasOvSissekanneI = true
          // (allOvNumsInParen removed as it was never used)
          parenOvMatches.forEach(m => {
            // just trigger hasOvSissekanneI, no need to collect
            [...m.matchAll(/ÕV(\d+)/gi)].map(x => x[1])
          })
        }
        // Also support plain ÕVn in nameEt
        const ovMatch = entry.nameEt.match(/ÕV(\d+)/i)
        if (ovMatch && ovMatch[1]) {
          hasOvSissekanneI = true
        }
      }
    })
    Logger.info('✨ FinalGradesByOvFeature: ovNumToOutcomeId mapping for this journal', ovNumToOutcomeId)

    // Collect grades for each student
    const gradesByStudent = {}
    // Collect outcome grades for each student and outcome number
    const outcomeGradesByStudent = {}
    // Collect final grades from SISSEKANNE_L entries
    const finalGradesByStudent = {}

    for (const entry of entries) {
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
      else if (entry.entryType === 'SISSEKANNE_O') {
        let studentOutcomeResults = entry.studentOutcomeResults

        // If studentOutcomeResults is missing, fetch detailed outcome data
        if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
          const journalId = this.#extractJournalId()
          studentOutcomeResults = await this.#fetchDetailedOutcomeStudents(journalId, entry.curriculumModuleOutcomes, students, {
            output: 'studentOutcomeResults'
          })
        }

        if (studentOutcomeResults) {
          Object.entries(studentOutcomeResults).forEach(([journalStudentId, results]) => {
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
      // SISSEKANNE_I: check for ÕVn in nameEt, including patterns like (ÕV1), (ÕV1, ÕV2)
      else if (entry.entryType === 'SISSEKANNE_I' && entry.journalStudentResults) {
        // Try to extract all ÕV numbers from nameEt
        let ovNums = []
        // Find all ÕV numbers in parentheses, e.g. (ÕV1), (ÕV2), (ÕV1, ÕV2)
        const parenOvMatches = entry.nameEt && entry.nameEt.match(/\(\s*ÕV(\d+)(?:,\s*ÕV(\d+))*\s*\)/gi)
        if (parenOvMatches) {
          hasOvSissekanneI = true
          parenOvMatches.forEach(m => {
            const nums = [...m.matchAll(/ÕV(\d+)/gi)].map(x => x[1])
            ovNums.push(...nums)
          })
        }
        // Also support plain ÕVn in nameEt
        const ovMatch = entry.nameEt && entry.nameEt.match(/ÕV(\d+)/i)
        if (ovMatch && ovMatch[1]) {
          hasOvSissekanneI = true
          ovNums.push(ovMatch[1])
        }
        // Remove duplicates
        ovNums = [...new Set(ovNums)]
        Object.entries(entry.journalStudentResults).forEach(([journalStudentId, results]) => {
          if (Array.isArray(results)) {
            results.forEach(r => {
              if (r.grade && r.grade.code) {
                const grade = r.grade.code.replace('KUTSEHINDAMINE_', '')
                // Always count toward final grade, even if ÕVn is present
                if (!gradesByStudent[journalStudentId]) gradesByStudent[journalStudentId] = []
                gradesByStudent[journalStudentId].push(grade)
                if (ovNums.length > 0) {
                  ovNums.forEach(ovNum => {
                    if (!outcomeGradesByStudent[journalStudentId]) outcomeGradesByStudent[journalStudentId] = {}
                    if (!outcomeGradesByStudent[journalStudentId][ovNum]) outcomeGradesByStudent[journalStudentId][ovNum] = []
                    outcomeGradesByStudent[journalStudentId][ovNum].push(grade)
                    Logger.info('✨ FinalGradesByOvFeature: Mapped SISSEKANNE_I grade to ÕV column', {
                      journalStudentId,
                      grade,
                      ovNum,
                      entryName: entry.nameEt
                    })
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
    }

    // Calculate per-ÕV grades for each student
    // Use ovNumToOutcomeId keys for allOvNums
    const allOvNums = Object.keys(ovNumToOutcomeId).sort((a, b) => Number(a) - Number(b))
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
    return { output, allOvNums, ovNumToOutcomeId, journalStudentIdToStudentId, hasOvSissekanneI }
  }

  async #showResults(results, button, opts = { autoSync: true }) {
    Logger.info('✨ FinalGradesByOvFeature: #showResults called', { results, button, opts })
    // Only perform sync logic, do not render a table
    // eslint-disable-next-line no-unused-vars
    const { allOvNums, ovNumToOutcomeId,
      hasOvSissekanneI, output } = results
    // Build a map of (studentId|ovNum) => existing grade object for updating
    const existingGradesMap = {}
    if (this._lastEntries) {
      for (const entry of this._lastEntries) {
        if (entry.entryType === 'SISSEKANNE_O') {
          const match = entry.nameEt && entry.nameEt.match(/^([0-9]+)\)/)
          const ovNum = match && match[1]
          if (ovNum) {
            const studentOutcomeResults = entry.studentOutcomeResults
            if (!studentOutcomeResults && entry.curriculumModuleOutcomes) {
              const journalId = this.#extractJournalId()
              const map = await this.#fetchDetailedOutcomeStudents(journalId, entry.curriculumModuleOutcomes, [], { output: 'existingGradesMap', ovNum })
              Object.assign(existingGradesMap, map)
            } else if (studentOutcomeResults) {
              Object.entries(studentOutcomeResults).forEach(([studentIdFromResults, results]) => {
                const studentId = studentIdFromResults
                if (studentId && results && results.grade) {
                  const key = `${studentId}|${ovNum}`
                  existingGradesMap[key] = results
                }
              })
            }
          }
        }
      }
    }
    // Filter output to only show students whose calculated grades differ from existing grades
    const filteredOutput = output.filter(student => {
      if (allOvNums.length > 0) {
        return allOvNums.some(ovNum => {
          const calculatedGrade = student.ovGrades[ovNum]
          const existingGradeKey = `${student.studentId}|${ovNum}`
          const existingGradeEntry = existingGradesMap[existingGradeKey]
          let existingGrade = ''
          if (existingGradeEntry && existingGradeEntry.grade && existingGradeEntry.grade.code) {
            existingGrade = existingGradeEntry.grade.code.replace('KUTSEHINDAMINE_', '')
          }
          let normalizedCalculated = String(calculatedGrade || '').trim()
          const normalizedExisting = String(existingGrade || '').trim()
          if (/^\d+(\.\d+)?$/.test(normalizedCalculated) && /^\d+$/.test(normalizedExisting)) {
            normalizedCalculated = String(Math.round(Number(normalizedCalculated)))
          }
          return normalizedCalculated !== normalizedExisting
        })
      } else {
        return true
      }
    })
    // If ÕV columns exist but there are no SISSEKANNE_I with ÕV, show message
    let container = document.getElementById('oa-final-grades-results')
    if (!container) {
      container = domService.createAndInsertElement('div', { id: 'oa-final-grades-results' }, '', button, 'afterend')
    }
    if (allOvNums.length > 0 && !hasOvSissekanneI) {
      container.innerHTML = '<div style="margin:16px 0;color:#d32f2f;font-weight:bold;">Ühtegi õpiväljundit pole märgitud iseseisvatesse töödesse!</div>'
      return
    }
  // If ÕV columns exist, automatically sync grades silently (no status message unless error)
  if (allOvNums.length > 0) {
      container.innerHTML = ''
      // --- Highlight mismatched cells in the journal table ---
      try {
        // Locate the journal table
        const table = document.querySelector('.layout-padding table.journalTable') || document.querySelector('table.journalTable')
        if (table) {
          // Use HighlightFinalGradesFeature to detect column indices
          const hf = new HighlightFinalGradesFeature()
          const { finalGradeCols, ovCols } = hf.findColumnIndices(table)
          // Map ovCols -> ovNum using results.allOvNums; fall back to sequence if lengths mismatch
          const sortedOvCols = (ovCols || []).slice().sort((a, b) => a - b)
          const ovColToNum = {}
          if (sortedOvCols.length === (allOvNums || []).length) {
            sortedOvCols.forEach((colIdx, i) => {
              ovColToNum[colIdx] = String(allOvNums[i])
            })
          } else {
            // Best-effort: try to parse numbers from header cells
            let headerCols = []
            const headerRows = Array.from(table.querySelectorAll('thead tr'))
            headerRows.forEach(row => {
              let colIdx = 0
              Array.from(row.children).forEach(th => {
                const colspan = parseInt(th.getAttribute('colspan') || '1', 10)
                const rawText = th.innerText || th.textContent || ''
                for (let i = 0; i < colspan; i++) {
                  headerCols[colIdx + i] = rawText
                }
                colIdx += colspan
              })
            })
            sortedOvCols.forEach(colIdx => {
              const txt = headerCols[colIdx] || ''
              const m = txt.match(/õv\s*[_\-\s]?(\d+)/i) || txt.match(/õv(\d+)/i)
              if (m && m[1]) ovColToNum[colIdx] = String(m[1])
            })
            // If still empty, map in order to available ovNums
            const unmappedCols = sortedOvCols.filter(c => !ovColToNum[c])
            let next = 0
            for (const c of unmappedCols) {
              if (allOvNums[next]) ovColToNum[c] = String(allOvNums[next])
              next++
            }
          }

          const rows = Array.from(table.querySelectorAll('tbody tr'))

          // Helper to detect AP rows (academic leave)
          const rowHasAcademicLeave = r => {
            try {
              return Array.from(r.querySelectorAll('span')).some(s => (s.textContent || '').trim() === 'AP')
            } catch (e) {
              return false
            }
          }

          // Helper: extract canonical grade token from text: 'MA', 'A', or numeric (supports comma decimal)
          const extractGradeToken = txt => {
            if (!txt) return ''
            const s = String(txt || '')
              .replace(/\u00A0/g, ' ') // NBSP
              .replace(/[,\s]+(?=\d{1,2}$)/, '.') // convert comma decimals like '4,0' to '4.0' conservatively
              .trim()
              // Find all tokens (MA, A, or numeric) and prefer the last occurring token in the cell
              const tokens = []
              // push MA/A tokens with an explicit marker
              Array.from(s.matchAll(/\bMA\b/ig)).forEach(m => tokens.push({ type: 'MA', value: 'MA', index: m.index }))
              Array.from(s.matchAll(/\bA\b/ig)).forEach(m => tokens.push({ type: 'A', value: 'A', index: m.index }))
              // numeric tokens
              Array.from(s.matchAll(/\b([1-5](?:[.,]\d+)?)\b/g)).forEach(m => tokens.push({ type: 'NUM', value: m[1].replace(',', '.'), index: m.index }))
              if (tokens.length) {
                // sort by occurrence index and pick last
                tokens.sort((a, b) => (a.index || 0) - (b.index || 0))
                const lastTok = tokens[tokens.length - 1]
                if (lastTok.type === 'MA') return 'MA'
                if (lastTok.type === 'A') return 'A'
                if (lastTok.type === 'NUM') return lastTok.value
              }
            return ''
          }

          // Iterate over results and try to find matching row for each student
          for (const student of output) {
            let row = null
            // Prefer matching by name or idcode within row text to avoid index-order mismatches
            const needleName = (student.name || '').trim()
            const needleIdcode = (student.idcode || '').trim()
            if (needleName) {
              row = rows.find(r => (r.textContent || '').includes(needleName)) || null
            }
            if (!row && needleIdcode) {
              row = rows.find(r => (r.textContent || '').includes(needleIdcode)) || null
            }
            // Fallback: index-based mapping if table order appears to match
            if (!row) {
              try {
                const idx = output.indexOf(student)
                if (rows && rows[idx]) row = rows[idx]
              } catch (e) {
                row = null
              }
            }
            if (!row) continue
            const isAP = rowHasAcademicLeave(row)
            if (isAP) continue
            const cells = Array.from(row.children).filter(n => n.nodeType === 1)

            // Check final grade columns
            finalGradeCols.forEach(colIdx => {
              const cell = cells[colIdx]
              if (!cell) return
              const cellToken = extractGradeToken(cell.textContent || '')
              const calcToken = extractGradeToken(String(student.finalGrade || ''))
              const setTooltip = (current, calculated) => {
                try {
                  cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}`
                } catch (e) {
                  // ignore
                }
              }
              const clearTooltip = () => { try { cell.title = '' } catch (e) {} }
              // If both empty, consider equal
              if (!cellToken && !calcToken) {
                cell.classList.remove('highlight-final-grade-red')
                clearTooltip()
                return
              }
              // If either token empty, treat as mismatch
              if (!cellToken || !calcToken) {
                cell.classList.add('highlight-final-grade-red')
                setTooltip(cellToken || '(tühi)', calcToken || '(tühi)')
                return
              }
              // Compare MA/A directly
              if (/^MA$/i.test(calcToken) || /^MA$/i.test(cellToken) || /^A$/i.test(calcToken) || /^A$/i.test(cellToken)) {
                if (calcToken.toUpperCase() !== cellToken.toUpperCase()) {
                  cell.classList.add('highlight-final-grade-red')
                  setTooltip(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-final-grade-red')
                  clearTooltip()
                }
                return
              }
              // Numeric comparison: if cell shows integer (no dot), round calculated to nearest int
              const cellIsInt = /^[1-5]$/.test(cellToken)
              const calcIsNum = /^[1-5](?:\.\d+)?$/.test(calcToken)
              if (cellIsInt && calcIsNum) {
                const rounded = String(Math.round(Number(calcToken)))
                if (rounded !== cellToken) {
                  cell.classList.add('highlight-final-grade-red')
                  setTooltip(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-final-grade-red')
                  clearTooltip()
                }
                return
              }
              // Otherwise compare numeric to two decimals
              if (calcIsNum && /^[1-5](?:\.\d+)?$/.test(cellToken)) {
                const c1 = Number(parseFloat(calcToken).toFixed(2))
                const c2 = Number(parseFloat(cellToken).toFixed(2))
                if (Number.isNaN(c1) || Number.isNaN(c2) || Math.abs(c1 - c2) > 0.01) {
                  cell.classList.add('highlight-final-grade-red')
                  setTooltip(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-final-grade-red')
                  clearTooltip()
                }
                return
              }
              // Fallback: strict comparison
              if (calcToken !== cellToken) {
                cell.classList.add('highlight-final-grade-red')
                setTooltip(cellToken, calcToken)
              } else {
                cell.classList.remove('highlight-final-grade-red')
                clearTooltip()
              }
            })

            // Check ÕV columns
            Object.entries(ovColToNum).forEach(([colIdxStr, ovNum]) => {
              const colIdx = Number(colIdxStr)
              const cell = cells[colIdx]
              if (!cell) return
              const cellToken = extractGradeToken(cell.textContent || '')
              const calcToken = extractGradeToken(String((student.ovGrades && student.ovGrades[ovNum]) ? student.ovGrades[ovNum] : ''))
              const setTooltipOv = (current, calculated) => {
                try {
                  cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}`
                } catch (e) {}
              }
              const clearTooltipOv = () => { try { cell.title = '' } catch (e) {} }
              if (!cellToken && !calcToken) {
                cell.classList.remove('highlight-ov-red')
                clearTooltipOv()
                return
              }
              if (!cellToken || !calcToken) {
                cell.classList.add('highlight-ov-red')
                setTooltipOv(cellToken || '(tühi)', calcToken || '(tühi)')
                return
              }
              if (/^MA$/i.test(calcToken) || /^MA$/i.test(cellToken) || /^A$/i.test(calcToken) || /^A$/i.test(cellToken)) {
                if (calcToken.toUpperCase() !== cellToken.toUpperCase()) {
                  cell.classList.add('highlight-ov-red')
                  setTooltipOv(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-ov-red')
                  clearTooltipOv()
                }
                return
              }
              const cellIsInt = /^[1-5]$/.test(cellToken)
              const calcIsNum = /^[1-5](?:\.\d+)?$/.test(calcToken)
              if (cellIsInt && calcIsNum) {
                const rounded = String(Math.round(Number(calcToken)))
                if (rounded !== cellToken) {
                  cell.classList.add('highlight-ov-red')
                  setTooltipOv(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-ov-red')
                  clearTooltipOv()
                }
                return
              }
              if (calcIsNum && /^[1-5](?:\.\d+)?$/.test(cellToken)) {
                const c1 = Number(parseFloat(calcToken).toFixed(2))
                const c2 = Number(parseFloat(cellToken).toFixed(2))
                if (Number.isNaN(c1) || Number.isNaN(c2) || Math.abs(c1 - c2) > 0.01) {
                  cell.classList.add('highlight-ov-red')
                  setTooltipOv(cellToken, calcToken)
                } else {
                  cell.classList.remove('highlight-ov-red')
                  clearTooltipOv()
                }
                return
              }
              if (calcToken !== cellToken) {
                cell.classList.add('highlight-ov-red')
                setTooltipOv(cellToken, calcToken)
              } else {
                cell.classList.remove('highlight-ov-red')
                clearTooltipOv()
              }
            })
          }
        }
      } catch (e) {
        Logger.warn('FinalGradesByOvFeature: Failed to highlight mismatched cells', e)
      }
      // If autoSync is false, we only compute filteredOutput and update button/UI state, do not post grades
  if (!opts.autoSync) {
        Logger.info('✨ FinalGradesByOvFeature: autoSync disabled on page load — skipping POST')
        // If there are no changes, disable the button (this logic mirrors earlier checks)
        if (filteredOutput.length === 0) {
          try {
            button.disabled = true
            button.style.opacity = '0.6'
            // Use a clearer, localized disabled title
            button.title = 'Kõik õpiväljundite hinded on juba olemas — pole vaja saata'
            // Prefer to set visible text when possible (use existing button text to detect L-flow)
            try {
              const isL = (button && String(button.textContent || '').toLowerCase().includes('lõpptulemus'))
              button.textContent = isL ? 'Kõik hinded on õiged' : 'Kõik hinded on õiged'
            } catch (innerErr) {
              Logger.warn('FinalGradesByOvFeature: Ignored inner error setting button text', innerErr)
            }
            // Mark as intentionally disabled so click handlers don't re-enable
            button._oaFinalGradesDisabled = true
            Logger.info('✨ FinalGradesByOvFeature: Button disabled on page load because no changes detected')
          } catch (e) {
            Logger.warn('FinalGradesByOvFeature: Failed to disable button on page load', e)
          }
        }
        return filteredOutput
      }

      setTimeout(() => {
        this.#syncOvGrades({ results, ovNumToOutcomeId, filteredOutput, container, button })
          .then(success => {
            if (success) {
              window.location.reload()
            }
          })
          .catch(err => {
            Logger.error('FinalGradesByOvFeature: Fatal error in sync loop', { err })
            container.innerHTML = '<div style="margin:16px 0;color:#d32f2f;font-weight:bold;">Viga õpiväljundite hinnete saatmisel!</div>'
          })
      }, 0)
      return filteredOutput
    }
    // If no ÕV columns, do not render a table, just remove any old send button/status
    const existingSendBtn = document.getElementById('oa-send-ov-grades-btn')
    if (existingSendBtn) {
      existingSendBtn.remove()
    }
    const existingStatusDiv = document.getElementById('oa-send-ov-status')
    if (existingStatusDiv) {
      existingStatusDiv.remove()
    }
    Logger.info('✨ FinalGradesByOvFeature: Table rendering skipped as requested')
  }

  // Helper: detect whether any SISSEKANNE_O outcome grades exist in the provided entries
  // Returns true if at least one student outcome grade exists for any SISSEKANNE_O entry
  #hasAnyOvGrades(entries) {
    try {
      if (!entries || !Array.isArray(entries)) return false
      for (const entry of entries) {
        if (entry && entry.entryType === 'SISSEKANNE_O') {
          const sor = entry.studentOutcomeResults
          if (sor && typeof sor === 'object' && Object.keys(sor).length > 0) return true
          if (entry.outcomeStudents && Array.isArray(entry.outcomeStudents) && entry.outcomeStudents.length > 0) return true
        }
      }
    } catch (e) {
      Logger.warn('FinalGradesByOvFeature: Error while checking for existing ÕV grades', e)
    }
    return false
  }
}
export default FinalGradesByOvFeature
