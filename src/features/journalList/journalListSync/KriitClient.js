/**
 * Kriit /subjects/getDifferences transport.
 *
 * Single responsibility: POST the assembled journal data to Kriit, normalise
 * the differences response shape, fill in Tahvel-side context (subject name,
 * group, lesson values, student names), persist the counts-only summary, and
 * trigger the UI update.
 *
 * Owns all writes to window.journalListSync.{tahvelData, differences,
 * newAssignments, subjectsCache}.
 *
 * No banner rendering, no Tahvel REST calls beyond what feature.* wrappers
 * provide (fetchJournalsFromApi, collectJournalData, getInactiveStudentsCache).
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { buildDiffSummary } from '../../../lib/kriitSyncCheck.js'
import { computePayloadHash } from './PayloadHash.js'

export async function proceedWithKriitApiCall(feature, providedJournalData = null) {
  try {
    feature.isLoading = true
    feature.updateUI()

    let journalData = providedJournalData

    if (!journalData) {
      const apiJournalList = await feature.fetchJournalsFromApi()
      if (apiJournalList && apiJournalList.length > 0) {
        const mapped = apiJournalList.map(item => ({
          __apiJournal: true,
          id: item.id,
          nameEt: item.nameEt || item.name || item.nameEt,
          studentCount: item.studentCount || 0,
          canEdit: item.canEdit
        }))
        journalData = await feature.collectJournalData(mapped)
      }
    }

    if (!journalData || !Array.isArray(journalData) || journalData.length === 0) {
      Logger.error('No valid journal data to send to Kriit')
      feature.error = 'No valid journal data to send to Kriit'
      feature.isLoading = false
      feature.updateUI()
      return
    }

    if (!feature.api.kriit.authToken) {
      Logger.error('No Kriit API token set')
      feature.error = 'No Kriit API token set. Please set a token in the extension settings.'
      feature.isLoading = false
      feature.updateUI()
      return
    }

    Logger.debug('🔍 Fetching inactive students for Kriit')
    let inactiveStudentsArray = []
    try {
      const inactiveStudentsCache = await feature.getInactiveStudentsCache()

      Logger.debug(`📦 Cache structure: ${JSON.stringify({
        hasCache: !!inactiveStudentsCache,
        hasByPersonalCode: !!(inactiveStudentsCache && inactiveStudentsCache.byPersonalCode),
        personalCodeCount: inactiveStudentsCache && inactiveStudentsCache.byPersonalCode
          ? Object.keys(inactiveStudentsCache.byPersonalCode).length
          : 0
      })}`)

      if (inactiveStudentsCache && inactiveStudentsCache.byPersonalCode) {
        for (const personalCode in inactiveStudentsCache.byPersonalCode) {
          const student = inactiveStudentsCache.byPersonalCode[personalCode]
          inactiveStudentsArray.push({
            personalCode: student.personalCode,
            name: student.name,
            status: student.status
          })
        }
      }

      Logger.debug(`✅ Including ${inactiveStudentsArray.length} inactive students in payload for Kriit`)
    } catch (error) {
      Logger.warning(`❌ Failed to fetch inactive students: ${error.message}`)
      Logger.error(error)
      inactiveStudentsArray = []
    }

    if (!window.journalListSync) window.journalListSync = {}
    window.journalListSync.tahvelData = journalData

    try {
      const payload = {
        journals: journalData,
        inactiveStudents: inactiveStudentsArray
      }

      Logger.debug('Sending request to Kriit API:', JSON.stringify(payload))

      const payloadHash = await computePayloadHash(payload)
      try {
        const ONE_DAY = 24 * 60 * 60 * 1000
        const lastHash = await cacheService.get('journalList_lastPayloadHash', ONE_DAY)
        if (lastHash && lastHash === payloadHash) {
          Logger.debug('Journal data payload unchanged since last check - will still call Kriit to get fresh differences')
        }
      } catch (err) {
        Logger.warning('Failed to compare payload hash:', err.message)
      }

      const response = await feature.api.kriit.post('/subjects/getDifferences', payload)
      if (!window.journalListSync) window.journalListSync = {}

      Logger.debug('Raw response from Kriit:', JSON.stringify(response))

      let respDifferences = null
      if (response && Array.isArray(response)) {
        respDifferences = response
        Logger.debug('Response is an array with', response.length, 'items')
      } else if (response && response.data && Array.isArray(response.data)) {
        respDifferences = response.data
        Logger.debug('Response has a data array with', response.data.length, 'items')
      } else if (response && response.data && Array.isArray(response.data.differences)) {
        respDifferences = response.data.differences
        Logger.debug('Response has data.differences with', response.data.differences.length, 'items')
      } else if (response && Array.isArray(response.differences)) {
        respDifferences = response.differences
        Logger.debug('Response has differences property with', response.differences.length, 'items')
      }

      feature.differences = Array.isArray(respDifferences) ? respDifferences : []

      if (!window.journalListSync) window.journalListSync = {}

      try {
        window.journalListSync.subjectsCache = window.journalListSync.subjectsCache || {}
        if (Array.isArray(journalData)) {
          journalData.forEach(j => {
            try {
              const id = j.subjectExternalId || j.subjectExternalId === 0 ? String(j.subjectExternalId) : null
              if (id) {
                window.journalListSync.subjectsCache[id] = j.subjectName || window.journalListSync.subjectsCache[id] || `Päevik ${id}`
              }
            } catch (err) {
              // ignore per-item failures
            }
          })
        }
      } catch (err) {
        Logger.debug('Failed to populate subjectsCache:', err)
      }

      const respNewAssignments = (response && response.data && response.data.newAssignments) || (response && response.newAssignments) || {}
      if (respNewAssignments && Object.keys(respNewAssignments).length > 0) {
        window.journalListSync.newAssignments = respNewAssignments
        Logger.debug('Stored newAssignments in runtime cache for banner:', JSON.stringify(Object.keys(respNewAssignments)))
      } else if (window.journalListSync.newAssignments && Object.keys(window.journalListSync.newAssignments).length === 0) {
        window.journalListSync.newAssignments = window.journalListSync.newAssignments || {}
      }

      window.journalListSync.differences = feature.differences

      if (
        (!feature.differences || feature.differences.length === 0) &&
        window.journalListSync.newAssignments &&
        Object.keys(window.journalListSync.newAssignments).length > 0
      ) {
        feature.error = null
        feature.isLoading = false
        feature.updateUI()
        return
      }

      if (
        (!feature.differences || feature.differences.length === 0) &&
        (!window.journalListSync.newAssignments || Object.keys(window.journalListSync.newAssignments).length === 0)
      ) {
        feature.error = 'Kõik hinded on juba sünkroonis. Pole midagi sünkroniseerida.'
        feature.isLoading = false
        feature.updateUI()
        return
      }

      // The payload hash is just a checksum (no PII) — safe to persist so we
      // can detect "same payload" across reloads. The differences and new
      // assignments are aggregated student-level diffs (high PII) and stay
      // in memory only. A counts-only summary is persisted so the header
      // sync button can render its "pending syncs" state on page load.
      try {
        const newAssignmentsForCache = window.journalListSync.newAssignments || {}
        await cacheService.set('journalList_lastPayloadHash', payloadHash)
        await cacheService.set('journalList_lastDifferences', feature.differences, 0, false)
        await cacheService.set('journalList_lastNewAssignments', newAssignmentsForCache, 0, false)
        await cacheService.set('journalList_diffSummary', buildDiffSummary(feature.differences, newAssignmentsForCache), 0, true)
      } catch (err) {
        Logger.warning('Failed to update journal list cache:', err.message)
      }
    } catch (error) {
      Logger.error('Error calling Kriit API:', error)

      // Pass error.message through unchanged — JournalSyncBanner maps
      // HTTP status / network errors to friendly Estonian text and never
      // exposes "[REDACTED-PII]" or English boilerplate to the user.
      feature.error = error.message || 'Kriidiga suhtlemisel tekkis viga.'
      feature.isLoading = false
      feature.updateUI()
      return
    }
    feature.isLoading = false
    feature.error = null

    if (Array.isArray(feature.differences) && Array.isArray(journalData)) {
      feature.differences.forEach(diff => {
        const matchingSubject = journalData.find(s => s.subjectExternalId === diff.subjectExternalId)
        if (matchingSubject) {
          diff.subjectName = matchingSubject.subjectName
          diff.groupName = matchingSubject.groupName

          if (diff.assignments && Array.isArray(diff.assignments)) {
            diff.assignments.forEach(diffAssignment => {
              const matchingAssignment = matchingSubject.assignments.find(a => a.assignmentExternalId === diffAssignment.assignmentExternalId)

              if (matchingAssignment) {
                const kriitAssignment = diffAssignment
                const tahvelAssignment = matchingAssignment

                const normalizeDate = val => {
                  if (!val) return null
                  if (typeof val === 'string' && val.length >= 10) return val.slice(0, 10)
                  return val
                }

                const compareAndCreateDiff = fieldName => {
                  let kriitValue = kriitAssignment[fieldName]
                  let tahvelValue = tahvelAssignment[fieldName]

                  if (fieldName === 'assignmentEntryDate' || fieldName === 'assignmentDueAt') {
                    kriitValue = normalizeDate(kriitValue)
                    tahvelValue = normalizeDate(tahvelValue)
                  }

                  const normKriit = kriitValue === undefined ? null : kriitValue
                  const normTahvel = tahvelValue === undefined ? null : tahvelValue

                  if (normKriit !== null && normKriit !== normTahvel) {
                    diffAssignment[fieldName] = { kriit: kriitValue, Tahvel: tahvelValue }
                  } else {
                    diffAssignment[fieldName] = tahvelValue
                  }
                }

                compareAndCreateDiff('assignmentName')
                compareAndCreateDiff('assignmentDueAt')
                compareAndCreateDiff('assignmentEntryDate')

                if (kriitAssignment.assignmentEntryType) {
                  const kriitType = kriitAssignment.assignmentEntryType
                  const tahvelType = tahvelAssignment.entryType
                  if (Logger.isDebugMode()) {
                    Logger.debug(
                      `[Entry Type] Assignment ${diffAssignment.assignmentExternalId}: Kriit="${kriitType}", Tahvel="${tahvelType}"`
                    )
                  }
                  if (kriitType && kriitType !== tahvelType) {
                    diffAssignment.entryType = { kriit: kriitType, Tahvel: tahvelType }
                    Logger.debug(`[Entry Type] DIFFERENCE DETECTED: Assignment ${diffAssignment.assignmentExternalId}`)
                  } else {
                    diffAssignment.entryType = tahvelType
                    if (Logger.isDebugMode()) {
                      Logger.debug(`[Entry Type] No difference: Assignment ${diffAssignment.assignmentExternalId}`)
                    }
                  }
                } else if (Logger.isDebugMode()) {
                  Logger.debug(
                    `[Entry Type] No assignmentEntryType from Kriit for assignment ${diffAssignment.assignmentExternalId}`
                  )
                }

                if (diffAssignment.results && Array.isArray(diffAssignment.results)) {
                  diffAssignment.results.forEach(diffResult => {
                    const targetCode = diffResult.studentPersonalCode ? String(diffResult.studentPersonalCode).trim() : ''

                    let matchingResult = null

                    if (targetCode) {
                      matchingResult = matchingAssignment.results.find(r => {
                        const rc = r.studentPersonalCode ? String(r.studentPersonalCode).trim() : ''
                        return rc === targetCode
                      })

                      if (!matchingResult) {
                        const targetLast8 = targetCode.slice(-8)
                        matchingResult = matchingAssignment.results.find(r => {
                          const rc = r.studentPersonalCode ? String(r.studentPersonalCode).trim() : ''
                          return rc.slice(-8) === targetLast8 && rc.length >= 8
                        })
                      }
                    }

                    if (!matchingResult && diffResult.studentName) {
                      const targetName = String(diffResult.studentName).toLowerCase()
                      matchingResult = matchingAssignment.results.find(r => {
                        const rn = r.studentName ? String(r.studentName).toLowerCase() : ''
                        return rn && (rn === targetName || rn.includes(targetName) || targetName.includes(rn))
                      })
                    }

                    if (matchingResult) {
                      diffResult.studentName = matchingResult.studentName
                      diffResult.studentIsActive = matchingResult.studentIsActive
                      diffResult.studentIsDeleted = matchingResult.studentIsDeleted
                      diffResult.studentIsGraduated = matchingResult.studentIsGraduated

                      diffResult.currentGrade = matchingResult.grade
                    } else if (Logger.isDebugMode()) {
                      Logger.debug(
                        `Could not find matching Tahvel result for personalCode="${diffResult.studentPersonalCode}" name="${diffResult.studentName || ''}" in assignment ${diffAssignment.assignmentExternalId}`
                      )
                    }
                  })
                }
              }
            })
          }
        }
      })
    }

    feature.updateUI()
  } catch (error) {
    Logger.error('Error calling Kriit API:', error)
    feature.isLoading = false
    feature.error = error.message || 'Failed to call Kriit API'
    feature.updateUI()
  }
}
