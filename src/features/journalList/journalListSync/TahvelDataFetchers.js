/**
 * Read-only Tahvel REST data fetchers. Each helper takes the API service
 * (or, for the two stateful ones, the feature instance) as its first arg.
 *
 *  - Pure (api, …): journal info, journal entries, entries with grades,
 *    student details, inactive-student list, lesson dates, lesson-plan fallback.
 *  - Stateful (feature, …): getJournalStudents writes
 *    feature.journalStudentIdToStudentId; fetchJournalsFromApi reads the
 *    study-year dropdown via feature methods.
 *
 * No banner UI, no Kriit transport, no DOM mutation beyond what the api/feature
 * collaborators do — single concern: pull data from Tahvel.
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { getSchoolId } from '../../../lib/schoolId.js'
import { resolveLessonPlanDate } from '../../../lib/studyYear.js'

export async function getJournalInfo(api, journalId) {
  return api.tahvel.get(
    `/journals/${journalId}`,
    {},
    { cacheExpiration: 30 * 24 * 60 * 60 * 1000 } // 30 days
  )
}

export async function getJournalEntries(api, journalId) {
  try {
    const response = await api.tahvel.get(
      `/journals/${journalId}/journalEntry`,
      { size: 2000 },
      { cache: true, cacheExpiration: 24 * 60 * 60 * 1000 }
    )

    if (response && response.content && Array.isArray(response.content)) {
      if (response.totalElements > 2000) {
        Logger.warning(`Journal ${journalId} has ${response.totalElements} entries, only first 2000 fetched`)
      }
      return response.content
    }
    return []
  } catch (error) {
    Logger.warning(`Error fetching journal entries for journal ${journalId}: ${error.message}`)
    return null
  }
}

export async function getJournalEntriesWithGrades(api, journalId) {
  try {
    const response = await api.tahvel.get(
      `/journals/${journalId}/journalEntriesByDate`,
      { allStudents: true },
      { cache: true, forceRefresh: false }
    )

    if (Array.isArray(response)) {
      return response
    }
    Logger.warning(`Unexpected response format from journalEntriesByDate endpoint: ${JSON.stringify(response)}`)
    return []
  } catch (error) {
    return null
  }
}

export async function getStudentDetails(api, studentId) {
  return api.tahvel.get(
    `/students/${studentId}`,
    {},
    { cacheExpiration: 24 * 60 * 60 * 1000 }
  )
}

export async function getJournalStudents(feature, journalId) {
  try {
    if (Logger.isDebugMode()) {
      Logger.debug(`🔍 Fetching journal students for journal ${journalId}`)
    }

    const response = await feature.api.tahvel.get(
      `/journals/${journalId}/journalStudents`,
      { allStudents: true },
      { cacheExpiration: 60 * 60 * 1000 } // 1 hour
    )

    if (response) {
      if (Logger.isDebugMode()) {
        Logger.debug(`✅ Retrieved ${response.length} journal students from API`)
      }

      if (response.length > 0) {
        const sampleStudent = response[0]
        if (Logger.isDebugMode()) {
          Logger.debug('=== JOURNAL STUDENTS API RESPONSE SAMPLE ===')
          Logger.debug(`Sample student structure: ${JSON.stringify(Object.keys(sampleStudent))}`)
          Logger.debug(`Sample student data: ${JSON.stringify(sampleStudent)}`)
        }

        const hasStudentObject = sampleStudent.student ? 'YES' : 'NO'
        const hasPersonalCodeInStudent = sampleStudent.student?.idcode ? 'YES' : 'NO'
        const hasDirectPersonalCode = sampleStudent.idcode ? 'YES' : 'NO'

        Logger.debug(
          `Has student object: ${hasStudentObject}, Has personal code in student: ${hasPersonalCodeInStudent}, Has direct personal code: ${hasDirectPersonalCode}`
        )
        Logger.debug('=== END JOURNAL STUDENTS API RESPONSE SAMPLE ===')
      }

      const hasPersonalCodes = response.some(student => student.student?.idcode)
      if (Logger.isDebugMode()) {
        Logger.debug(`Personal codes available in response (old format): ${hasPersonalCodes}`)
      }

      if (hasPersonalCodes) {
        Logger.debug('Journal students response includes personal codes, updating mapping')

        for (const journalStudent of response) {
          if (journalStudent.student && journalStudent.student.idcode && journalStudent.studentId) {
            feature.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId
            Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${journalStudent.student.idcode})`)
          }
        }
      } else {
        Logger.debug('Journal students response does not include personal codes in old format')
        if (Logger.isDebugMode()) {
          Logger.debug('🔧 Attempting to fetch personal codes for each student individually...')
        }

        for (const journalStudent of response) {
          if (journalStudent.studentId) {
            try {
              if (Logger.isDebugMode()) {
                Logger.debug(`📡 Fetching personal code for studentId ${journalStudent.studentId}`)
              }

              const studentDetails = await getStudentDetails(feature.api, journalStudent.studentId)

              if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
                feature.journalStudentIdToStudentId[journalStudent.id] = journalStudent.studentId

                if (Logger.isDebugMode()) {
                  Logger.debug(`✅ Found personal code for studentId ${journalStudent.studentId}: ${studentDetails.person.idcode}`)
                  Logger.debug(`Mapped journalStudentId ${journalStudent.id} -> studentId ${journalStudent.studentId} (${studentDetails.person.idcode})`)
                }

                journalStudent.student = {
                  idcode: studentDetails.person.idcode,
                  fullname: studentDetails.person.firstname + ' ' + studentDetails.person.lastname,
                  status: studentDetails.status
                }
              } else {
                Logger.warning(`❌ Could not fetch personal code for studentId ${journalStudent.studentId}`)
              }
            } catch (error) {
              Logger.warning(`❌ Error fetching personal code for studentId ${journalStudent.studentId}: ${error.message}`)
            }
          }
        }

        if (Logger.isDebugMode()) {
          const studentsWithPersonalCodes = response.filter(student => student.student?.idcode).length
          Logger.debug(`📊 Successfully retrieved personal codes for ${studentsWithPersonalCodes}/${response.length} students`)
        }
      }
    } else {
      Logger.error(`❌ No response received from journal students API for journal ${journalId}`)
    }

    return response
  } catch (error) {
    Logger.error(`❌ Error fetching journal students for journal ${journalId}: ${error.message}`)
    return null
  }
}

export async function fetchInactiveStudents(api) {
  try {
    Logger.debug('📡 Fetching inactive students from Tahvel API')

    const inactiveStudentsMap = {
      byPersonalCode: {},
      byStudentId: {}
    }

    let page = 0
    let hasMorePages = true

    while (hasMorePages) {
      Logger.debug(`📄 Fetching page ${page} of inactive students`)

      const response = await api.tahvel.get(
        '/students',
        {
          lang: 'ET',
          page: page,
          showMyStudentGroups: false,
          size: 2000,
          sort: 'person.lastname,person.firstname,asc',
          status: ['OPPURSTAATUS_K', 'OPPURSTAATUS_L', 'OPPURSTAATUS_A']
        },
        { cacheExpiration: 24 * 60 * 60 * 1000 }
      )

      if (!response || !response.content || !Array.isArray(response.content)) {
        Logger.warning('⚠️ Invalid response from inactive students API')
        Logger.debug(`Response structure: ${JSON.stringify(Object.keys(response || {}))}`)
        break
      }

      if (page === 0 && response.totalElements) {
        Logger.debug(`📊 Total inactive students reported by API: ${response.totalElements}`)
      }

      const studentsInPage = response.content.length
      Logger.debug(`📋 Processing ${studentsInPage} students from page ${page}`)

      if (studentsInPage === 0) {
        hasMorePages = false
        break
      }

      for (const student of response.content) {
        if (student.idcode) {
          const isActive = student.status === 'OPPURSTAATUS_O'
          const isDeleted = student.status === 'OPPURSTAATUS_K'
          const isGraduated = student.status === 'OPPURSTAATUS_L'

          const studentData = {
            personalCode: student.idcode,
            name: student.fullname || `${student.firstname} ${student.lastname}`,
            isActive,
            isDeleted,
            isGraduated,
            studentId: student.id,
            status: student.status
          }

          inactiveStudentsMap.byPersonalCode[student.idcode] = studentData
          if (student.id) {
            inactiveStudentsMap.byStudentId[student.id] = studentData
          }
        } else {
          Logger.debug(`⚠️ Skipping student without idcode: ${JSON.stringify(student)}`)
        }
      }

      if (studentsInPage < 2000) {
        hasMorePages = false
      } else {
        page++
      }
    }

    const fetchedCount = Object.keys(inactiveStudentsMap.byPersonalCode).length
    Logger.debug(`✅ Fetched ${fetchedCount} inactive students from ${page + 1} page(s) (indexed by personal code and student ID)`)

    return inactiveStudentsMap
  } catch (error) {
    Logger.error(`❌ Error fetching inactive students: ${error.message}`)
    return { byPersonalCode: {}, byStudentId: {} }
  }
}

export async function getInactiveStudentsCache(api) {
  const cacheKey = 'inactive_students_all'

  // Memory-only: keyed by personal code, contains names — must not persist.
  const result = await cacheService.getOrFetch(
    cacheKey,
    () => fetchInactiveStudents(api),
    24 * 60 * 60 * 1000,
    true,
    false
  )

  if (!result || typeof result !== 'object') {
    return { byPersonalCode: {}, byStudentId: {} }
  }
  if (!result.byPersonalCode && !result.byStudentId) {
    return { byPersonalCode: {}, byStudentId: {} }
  }
  return result
}

export async function getFirstLessonFromPlan(api, journalId, teacherId) {
  try {
    return await resolveLessonPlanDate(api, journalId, teacherId, 'first')
  } catch (error) {
    Logger.debug(`Could not get first lesson from plan for journal ${journalId}:`, error.message)
    return null
  }
}

export async function getLastLessonFromPlan(api, journalId, teacherId) {
  try {
    return await resolveLessonPlanDate(api, journalId, teacherId, 'last')
  } catch (error) {
    Logger.debug(`Could not get last lesson from plan for journal ${journalId}:`, error.message)
    return null
  }
}

export async function getLessonDates(api, journalId, journalInfo) {
  try {
    const result = {
      firstLessonDate: null,
      firstLessonDateIsApproximate: false,
      nextLessonDate: null,
      lastLessonDate: null,
      lastLessonDateIsApproximate: false
    }

    if (!journalInfo) {
      return result
    }

    const schoolId = await getSchoolId(api, journalInfo)
    const teacherId = journalInfo.journalTeachers?.[0]?.id

    if (!teacherId || !schoolId) {
      Logger.debug(`No teacher ID or school ID available for journal ${journalId}`)
      return result
    }

    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = journalInfo.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = journalInfo.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`

    const timetableData = await api.tahvel.get(
      endpoint,
      {},
      { cache: true, cacheExpiration: 24 * 60 * 60 * 1000 }
    )

    if (!timetableData?.timetableEvents) {
      return result
    }

    const journalTimetable = timetableData.timetableEvents
      .filter(event => event.journalId == journalId)
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    if (journalTimetable.length === 0) {
      const firstLessonFromPlan = await getFirstLessonFromPlan(api, journalId, teacherId)
      if (firstLessonFromPlan) {
        result.firstLessonDate = firstLessonFromPlan
        result.firstLessonDateIsApproximate = true
      }

      const lastLessonFromPlan = await getLastLessonFromPlan(api, journalId, teacherId)
      if (lastLessonFromPlan) {
        result.lastLessonDate = lastLessonFromPlan
        result.lastLessonDateIsApproximate = true
      }

      return result
    }

    result.firstLessonDate = journalTimetable[0]?.date || null
    result.firstLessonDateIsApproximate = false

    const nowDate = new Date()
    nowDate.setHours(0, 0, 0, 0)
    const tomorrowDate = new Date(nowDate)
    tomorrowDate.setDate(tomorrowDate.getDate() + 1)
    const futureLessons = journalTimetable.filter(event => new Date(event.date) >= tomorrowDate)

    if (futureLessons.length > 0) {
      const firstLessonDateOnly = result.firstLessonDate ? result.firstLessonDate.split('T')[0] : null
      const nextDifferentDayLesson = futureLessons.find(event => {
        const eventDateOnly = event.date.split('T')[0]
        return eventDateOnly !== firstLessonDateOnly
      })
      result.nextLessonDate = nextDifferentDayLesson?.date || futureLessons[0]?.date || null
    } else {
      result.nextLessonDate = null
    }

    const mahtACapacity = journalInfo.lessonHours?.capacityHours?.find(c => c.capacity === 'MAHT_a')
    const plannedMahtALessons = mahtACapacity?.plannedHours || 0
    const timetableLessons = journalTimetable.length

    Logger.debug(`[getLessonDates] Journal ${journalId}: plannedMahtALessons=${plannedMahtALessons}, timetableLessons=${timetableLessons}`)

    if (plannedMahtALessons === timetableLessons) {
      result.lastLessonDate = journalTimetable[journalTimetable.length - 1]?.date || null
      result.lastLessonDateIsApproximate = false
      Logger.debug(`[getLessonDates] Journal ${journalId}: Using exact last lesson from timetable: ${result.lastLessonDate}`)
    } else if (timetableLessons < plannedMahtALessons) {
      Logger.debug(`[getLessonDates] Journal ${journalId}: Timetable incomplete, fetching from lesson plan`)
      const lastLessonFromPlan = await getLastLessonFromPlan(api, journalId, teacherId)
      if (lastLessonFromPlan) {
        result.lastLessonDate = lastLessonFromPlan
        result.lastLessonDateIsApproximate = true
        Logger.debug(`[getLessonDates] Journal ${journalId}: Using approximate last lesson from plan: ${result.lastLessonDate}`)
      } else {
        Logger.debug(`[getLessonDates] Journal ${journalId}: Could not get last lesson from plan`)
      }
    } else {
      Logger.debug(`[getLessonDates] Journal ${journalId}: Timetable has MORE lessons than planned (${timetableLessons} > ${plannedMahtALessons})`)
    }

    return result
  } catch (error) {
    Logger.warning(`Error getting lesson dates for journal ${journalId}:`, error)
    return {
      firstLessonDate: null,
      firstLessonDateIsApproximate: false,
      nextLessonDate: null,
      lastLessonDate: null,
      lastLessonDateIsApproximate: false
    }
  }
}

/**
 * Fetch the paginated journal list from Tahvel REST API. Takes the feature
 * instance because it reads the study-year selector via feature methods.
 */
export async function fetchJournalsFromApi(feature) {
  try {
    if (Logger.isDebugMode()) Logger.debug('Attempting to fetch journals via Tahvel REST API /hois_back/journals')
    const base = feature.api && feature.api.tahvel && feature.api.tahvel.baseUrl ? String(feature.api.tahvel.baseUrl) : ''
    let endpoint = '/hois_back/journals'
    if (base.endsWith('/hois_back')) endpoint = '/journals'

    const detectStudyYear = async() => {
      const selectedYearText = feature.getSelectedStudyYear()
      if (!selectedYearText) {
        Logger.debug('No study year selected in dropdown')
        return null
      }

      const yearId = await feature.getStudyYearIdFromText(selectedYearText)
      if (yearId) {
        Logger.debug(`Using study year from dropdown: ${selectedYearText} (ID: ${yearId})`)
        return yearId
      }

      Logger.warning(`Could not resolve study year ID for: ${selectedYearText}`)
      return null
    }

    const studyYear = await detectStudyYear()

    const baseParams = { onlyMyJournals: true, sort: '2, 5, 3', size: 50 }
    if (studyYear) {
      baseParams.studyYear = studyYear
      if (Logger.isDebugMode()) Logger.debug('Detected studyYear for journals API:', studyYear)
    } else {
      if (Logger.isDebugMode()) Logger.debug('No studyYear detected; calling journals API without studyYear param')
    }

    const allItems = []
    let page = 0
    let totalPages = null
    let safetyCounter = 0
    const SAFETY_MAX_PAGES = 50

    while (safetyCounter <= SAFETY_MAX_PAGES && (totalPages === null || page < totalPages)) {
      const params = Object.assign({}, baseParams, { page })
      if (Logger.isDebugMode()) Logger.debug(`Fetching journals page ${page} (params: ${JSON.stringify(params)})`)

      const response = await feature.api.tahvel.get(endpoint, params, { cache: true, cacheExpiration: 5 * 60 * 1000 })

      if (!response) {
        if (Logger.isDebugMode()) Logger.debug('Unexpected /hois_back/journals response (null) on page', page)
        break
      }

      let items = []
      if (Array.isArray(response.content)) {
        items = response.content
      } else if (Array.isArray(response)) {
        items = response
      } else {
        if (Logger.isDebugMode()) Logger.debug('Unexpected /hois_back/journals response format on page', page, response)
        break
      }

      if (items && items.length > 0) {
        allItems.push(...items)
      }

      if (totalPages === null) {
        if (typeof response.totalPages === 'number') {
          totalPages = response.totalPages
        } else if (response.pageable && typeof response.pageable.totalPages === 'number') {
          totalPages = response.pageable.totalPages
        } else if (typeof response.totalElements === 'number' && typeof params.size === 'number') {
          totalPages = Math.ceil(response.totalElements / params.size)
        }
      }

      if (totalPages === null && items.length < params.size) break
      if (totalPages !== null && page + 1 >= totalPages) break

      page += 1
      safetyCounter += 1
    }

    if (allItems.length === 0) {
      if (Logger.isDebugMode()) Logger.debug('No journals found from API')
      return null
    }

    return allItems.map(item => ({
      id: item.id,
      nameEt: item.nameEt || item.name || '',
      studentCount: item.studentCount || 0,
      canEdit: item.canEdit
    }))
  } catch (error) {
    Logger.debug('Error fetching journals from API:', error && error.message ? error.message : error)
    return null
  }
}
