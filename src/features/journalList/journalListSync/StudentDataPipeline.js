/**
 * Stateful student data pipeline that maintains the journalStudentId →
 * studentId map and per-session student-detail memoization.
 *
 *  - processStudentData: bulk-fetch student details for a journal, populating
 *    feature.pendingStudentRequests dedup map and feature.journalStudentIdToStudentId.
 *  - getDetailedStudentInfo: by-personal-code lookup with enrolled-assignment list.
 *  - getCachedStudent: by-journalStudentId memoized lookup via
 *    feature._cachedStudents and the journalStudentIdToStudentId map.
 *
 * All take the feature instance as first arg so they read/write feature state
 * explicitly. They reuse data fetchers (getStudentDetails, getJournalStudents,
 * getJournalEntries) via the same import surface other modules use.
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { getStudentDetails, getJournalStudents, getJournalEntries } from './TahvelDataFetchers.js'

export async function processStudentData(feature, journalId, journalStudents) {
  const studentDetailsMap = {}

  if (journalStudents && Array.isArray(journalStudents)) {
    if (!feature.pendingStudentRequests) {
      feature.pendingStudentRequests = new Map()
    }

    const studentPromises = journalStudents.map(async journalStudent => {
      if (!journalStudent || !journalStudent.studentId) return null

      try {
        const studentDetails = await getStudentDetails(feature.api, journalStudent.studentId)
        if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
          const isActive = studentDetails.status === 'OPPURSTAATUS_O'
          const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'
          const isGraduated = studentDetails.status === 'OPPURSTAATUS_L'

          const cachedStudent = {
            personalCode: studentDetails.person.idcode,
            name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`,
            isActive,
            isDeleted,
            isGraduated
          }

          feature.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

          return { studentId: journalStudent.studentId, data: cachedStudent }
        }
      } catch (error) {
        Logger.debug(`Student ${journalStudent.studentId} not in API cache, will fetch`)
      }

      if (feature.pendingStudentRequests.has(journalStudent.studentId)) {
        Logger.debug(`Student ${journalStudent.studentId} request already in progress - waiting for result`)
        try {
          const data = await feature.pendingStudentRequests.get(journalStudent.studentId)
          return { studentId: journalStudent.studentId, data }
        } catch (error) {
          Logger.error(`Error waiting for pending student request ${journalStudent.studentId}:`, error)
          return { studentId: journalStudent.studentId, data: null }
        }
      }

      // Two cache tiers for student details:
      //   - status (isActive/isDeleted/isGraduated): no PII, persisted on disk encrypted
      //   - pii (personalCode/name): memory-only
      const statusKey = `student_${journalStudent.studentId}_status`
      const piiKey = `student_${journalStudent.studentId}_pii`
      const ONE_DAY = 24 * 60 * 60 * 1000

      const fetchStatus = async() => {
        const details = await getStudentDetails(feature.api, journalStudent.studentId)
        if (!details || !details.status) return null
        return {
          isActive: details.status === 'OPPURSTAATUS_O',
          isDeleted: details.status === 'OPPURSTAATUS_K',
          isGraduated: details.status === 'OPPURSTAATUS_L'
        }
      }

      const fetchPii = async() => {
        const details = await getStudentDetails(feature.api, journalStudent.studentId)
        if (!details || !details.person || !details.person.idcode) return null
        return {
          personalCode: details.person.idcode,
          name: journalStudent.fullname || `${journalStudent.firstname} ${journalStudent.lastname}`
        }
      }

      const fetchPromise = (async() => {
        try {
          const [status, pii] = await Promise.all([
            cacheService.getOrFetch(statusKey, fetchStatus, ONE_DAY, true, true),
            cacheService.getOrFetch(piiKey, fetchPii, ONE_DAY, true, false)
          ])
          const studentData = (status && pii) ? { ...pii, ...status } : null

          if (studentData) {
            feature.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
            Logger.debug(
              `✓ Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentData.personalCode} - ${studentData.name})`
            )
          }

          return studentData
        } catch (error) {
          Logger.error(`Error getting cached data for student ${journalStudent.studentId}:`, error)
          return null
        } finally {
          feature.pendingStudentRequests.delete(journalStudent.studentId)
        }
      })()

      feature.pendingStudentRequests.set(journalStudent.studentId, fetchPromise)

      try {
        const studentData = await fetchPromise
        return { studentId: journalStudent.studentId, data: studentData }
      } catch (error) {
        Logger.error(`Error processing student ${journalStudent.studentId}:`, error)
        return { studentId: journalStudent.studentId, data: null }
      }
    })

    const results = await Promise.all(studentPromises)

    for (const result of results) {
      if (result && result.data) {
        studentDetailsMap[result.studentId] = result.data
      }
    }
  }

  return studentDetailsMap
}

export async function getDetailedStudentInfo(feature, personalCode, journalId) {
  try {
    Logger.debug(`Getting detailed info for student with personal code ${personalCode} in journal ${journalId}`)

    let studentId = null
    let studentInfo = null
    let journalStudentId = null

    const journalStudentsForLookup = await getJournalStudents(feature, journalId)

    for (const journalStudent of journalStudentsForLookup || []) {
      if (journalStudent.student && journalStudent.student.idcode === personalCode) {
        studentId = journalStudent.studentId
        journalStudentId = journalStudent.id
        studentInfo = {
          personalCode: journalStudent.student.idcode,
          name: journalStudent.student.fullname || journalStudent.studentName,
          isActive: journalStudent.student.status === 'OPPURSTAATUS_O'
        }
        break
      }
    }

    if (!studentId) {
      return { error: `Student with personal code ${personalCode} not found in cache` }
    }

    const journalStudents = journalStudentsForLookup

    if (journalStudents && journalStudents.length > 0) {
      Logger.debug(`Journal students response structure: ${Object.keys(journalStudents[0]).join(', ')}`)
      Logger.debug(`First journal student: ${JSON.stringify(journalStudents[0])}`)
    }

    let matchingJournalStudent = null
    const isEnrolled =
      journalStudents &&
      journalStudents.some(js => {
        const matches = String(js.studentId) === String(studentId)
        if (matches) {
          matchingJournalStudent = js
          journalStudentId = js.id
        }
        return matches
      })

    if (matchingJournalStudent) {
      Logger.debug(
        `Found matching journal student: ID=${matchingJournalStudent.id}, studentId=${matchingJournalStudent.studentId}, name=${matchingJournalStudent.studentName}`
      )
    } else {
      Logger.debug(`Could not find student with ID ${studentId} in journal students. Trying to find by name...`)

      const studentName = studentInfo?.name
      if (studentName) {
        const matchByName =
          journalStudents && journalStudents.find(js => js.studentName && js.studentName.toLowerCase().includes(studentName.toLowerCase()))

        if (matchByName) {
          matchingJournalStudent = matchByName
          journalStudentId = matchByName.id
          Logger.debug(`Found student by name: ID=${matchByName.id}, studentId=${matchByName.studentId}, name=${matchByName.studentName}`)
        }
      }

      if (!matchingJournalStudent && journalStudents && journalStudents.length > 0) {
        Logger.debug(`All journal students (${journalStudents.length}):`)
        journalStudents.forEach(js => {
          Logger.debug(`- ID=${js.id}, studentId=${js.studentId}, name=${js.studentName || 'Unknown'}`)
        })
      }
    }

    const journalEntries = await getJournalEntries(feature.api, journalId)

    const enrolledAssignments = []
    if (journalEntries && Array.isArray(journalEntries)) {
      Logger.debug(`Found ${journalEntries.length} entries in journal ${journalId}`)

      for (const entry of journalEntries) {
        if (entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P' || entry.entryType === 'SISSEKANNE_H' || entry.entryType === 'SISSEKANNE_O') {
          if (entry.entryType === 'SISSEKANNE_O') {
            const outcomeDetails = await feature.api.tahvel.get(`/journals/${journalId}/journalOutcome/${entry.curriculumModuleOutcomes}`)

            if (outcomeDetails && outcomeDetails.outcomeStudents) {
              const isInOutcome = outcomeDetails.outcomeStudents.some(
                student => student.journalStudent && String(student.journalStudent) === String(studentId)
              )

              if (isInOutcome) {
                const assignmentName = entry.nameEt || outcomeDetails.nameEt || 'Õppetulemus'
                Logger.debug(`Student ${studentId} is enrolled in outcome: ${assignmentName}`)

                enrolledAssignments.push({
                  id: entry.curriculumModuleOutcomes,
                  name: assignmentName,
                  entryType: entry.entryType
                })
              }
            }
          } else {
            const entryDetails = await feature.api.tahvel.get(`/journals/${journalId}/journalEntry/${entry.id}`, { allStudents: true })

            if (entryDetails && entryDetails.journalEntryStudents) {
              const isInAssignment = entryDetails.journalEntryStudents.some(
                student => student.journalStudent && String(student.journalStudent) === String(studentId)
              )

              if (isInAssignment) {
                const assignmentName = entry.nameEt || entry.name

                enrolledAssignments.push({
                  id: entry.id,
                  name: assignmentName,
                  entryType: entry.entryType
                })
              }
            }
          }
        }
      }

      Logger.debug(`Student ${studentInfo?.name} is enrolled in ${enrolledAssignments.length} assignments in journal ${journalId}`)
    } else {
      Logger.warning(`No entries found in journal ${journalId} or unexpected response format`)
      Logger.debug(`Journal entries response: ${JSON.stringify(journalEntries)}`)
    }

    return {
      personalCode,
      studentId,
      journalStudentId,
      name: studentInfo?.name,
      isActive: studentInfo?.isActive,
      isEnrolledInJournal: isEnrolled,
      enrolledAssignments,
      journalId,
      cacheInfo: studentInfo
    }
  } catch (error) {
    Logger.error(`Error getting detailed student info: ${error.message}`)
    return { error: error.message }
  }
}

export async function getCachedStudent(feature, journalStudentId) {
  if (!journalStudentId) {
    Logger.debug(`❌ getCachedStudent called with null/undefined journalStudentId`)
    return null
  }

  Logger.debug(`🔍 Looking for student in cache with journalStudentId: ${journalStudentId} (type: ${typeof journalStudentId})`)

  if (Logger.isDebugMode()) {
    const mappingKeys = Object.keys(feature.journalStudentIdToStudentId)
    Logger.debug(`Current mapping has ${mappingKeys.length} entries`)
    if (mappingKeys.length > 0) {
      Logger.debug(
        `Sample mapping entries: ${mappingKeys
          .slice(0, 3)
          .map(key => `${key}->${feature.journalStudentIdToStudentId[key]}`)
          .join(', ')}`
      )
    }
  }

  if (!feature._cachedStudents) feature._cachedStudents = {}
  const memoKey = String(journalStudentId)
  if (Object.prototype.hasOwnProperty.call(feature._cachedStudents, memoKey)) {
    return feature._cachedStudents[memoKey]
  }

  const studentId = feature.journalStudentIdToStudentId[journalStudentId]
  if (studentId) {
    Logger.debug(`✅ Found mapping: journalStudentId ${journalStudentId} -> studentId ${studentId}`)

    try {
      Logger.debug(`📡 Fetching student details for studentId ${studentId}`)
      const studentDetails = await getStudentDetails(feature.api, studentId)

      if (studentDetails) {
        Logger.debug(`📋 Student details structure: ${JSON.stringify(Object.keys(studentDetails))}`)

        if (studentDetails.person) {
          Logger.debug(
            `👤 Person data: ${JSON.stringify({
              firstname: studentDetails.person.firstname,
              lastname: studentDetails.person.lastname,
              idcode: studentDetails.person.idcode
            })}`
          )
        } else {
          Logger.warning(`⚠️ No person data in student details for studentId ${studentId}`)
        }

        if (studentDetails.person && studentDetails.person.idcode) {
          const isActive = studentDetails.status === 'OPPURSTAATUS_O'
          const isDeleted = studentDetails.status === 'OPPURSTAATUS_K'

          const cachedStudent = {
            personalCode: studentDetails.person.idcode,
            name: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
            isActive,
            isDeleted
          }

          Logger.debug(
            `✅ Successfully cached student: ${cachedStudent.personalCode} (${cachedStudent.name}) - Active: ${isActive}, Deleted: ${isDeleted}`
          )
          feature._cachedStudents[memoKey] = cachedStudent
          return cachedStudent
        } else {
          Logger.warning(`⚠️ Missing person.idcode in student details for studentId ${studentId}`)
        }
      } else {
        Logger.warning(`⚠️ No student details returned for studentId ${studentId}`)
      }
    } catch (error) {
      Logger.error(`❌ Error getting student ${studentId} from API cache: ${error.message}`)
    }
  } else {
    Logger.warning(`❌ No studentId mapping found for journalStudentId: ${journalStudentId}`)

    if (Logger.isDebugMode()) {
      const mappingKeys = Object.keys(feature.journalStudentIdToStudentId)
      if (mappingKeys.length > 0) {
        Logger.debug(`Available journalStudentId mappings: ${mappingKeys.join(', ')}`)
      } else {
        Logger.debug(`No mappings available at all - this suggests journal students data wasn't loaded properly`)
      }
    }
  }

  Logger.debug(`🚫 Student not found in cache for journalStudentId: ${journalStudentId}`)
  feature._cachedStudents[memoKey] = null
  return null
}
