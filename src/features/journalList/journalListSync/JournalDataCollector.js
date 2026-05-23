/**
 * Bulk Tahvel collection: per-journal info + students + entries + grades,
 * normalised into the subject + assignments + group + teachers shape that
 * gets POSTed to Kriit.
 *
 * Single responsibility: orchestrate per-journal data assembly. Calls into
 * tahvelDataFetchers / assignmentMapper / studentDataPipeline / teacherCache
 * modules to do the actual work. Writes feature.globalTeacherCache for
 * teacher dedup across journals.
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { resolveJournalFromElement } from './JournalLinkResolver.js'
import { getTeacherPersonalCodeCached } from './TeacherCache.js'

export async function collectJournalData(feature, apiList = null) {
  try {
    Logger.debug('Collecting journal data from Tahvel')
    Logger.debug('Using Tahvel API base URL:', feature.api.tahvel.baseUrl)

    if (!feature.journalLinks || feature.journalLinks.length === 0) {
      Logger.warning('No journal links available for data collection')
      return []
    }

    Logger.debug(`Using ${feature.journalLinks.length} journal links for data collection`)

    const journalPromises = (apiList ? apiList : Array.from(feature.journalLinks)).map(async link => {
      let resolved = null
      let id = null
      let href = ''
      let name = ''

      if (link && link.__apiJournal) {
        id = link.id
        name = link.nameEt || link.name || ''
      } else {
        resolved = resolveJournalFromElement(link)
        id = resolved && resolved.id ? resolved.id : null
        href = resolved && resolved.href ? resolved.href : link.getAttribute ? link.getAttribute('href') || link.getAttribute('ng-href') || '' : ''
        name = (link.textContent || link.innerText || '').trim()
      }

      if (!id) {
        const idMatch = String(href).match(/\/journal\/([0-9]+)/)
        if (idMatch && idMatch[1]) {
          id = parseInt(idMatch[1], 10)
        } else {
          const parts = String(href).split('/')
          if (parts.length >= 4) {
            const maybe = parseInt(parts[3], 10)
            if (!isNaN(maybe)) id = maybe
          }
        }
      }

      if (!id) {
        const snippet = link && link.outerHTML ? link.outerHTML.replace(/\s+/g, ' ').slice(0, 300) : String(link)
        Logger.warning(`Could not extract journal ID from element or href: ${href} / element snippet: ${snippet}`)
        return null
      }

      try {
        const [journalInfo, journalEntries, journalEntriesWithGrades, journalStudents] = await Promise.all([
          feature.getJournalInfo(id),
          feature.getJournalEntries(id),
          feature.getJournalEntriesWithGrades(id),
          feature.getJournalStudents(id)
        ])

        if (!journalInfo) {
          Logger.warning(`Could not get info for journal ${id}`)
          return null
        }
        if (!Array.isArray(journalEntries)) {
          Logger.warning(`Could not get entries for journal ${id}`)
          return null
        }
        if (!Array.isArray(journalStudents)) {
          return null
        }

        if (journalInfo.studentGroups) {
          Logger.debug(`Journal ${id} student groups:`, JSON.stringify(journalInfo.studentGroups))
        }

        const studentDetailsMap = await feature.processStudentData(id, journalStudents)
        const studentMap = feature.createStudentMap(journalStudents, studentDetailsMap)

        let mergedEntries
        if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0 && journalEntries && journalEntries.length > 0) {
          const entryById = {}
          journalEntries.forEach(e => {
            if (e && e.id) entryById[e.id] = e
          })
          mergedEntries = journalEntriesWithGrades.map(e => {
            if (e && e.id && entryById[e.id]) {
              if (!e.homeworkDuedate && entryById[e.id].homeworkDuedate) {
                return { ...e, homeworkDuedate: entryById[e.id].homeworkDuedate }
              }
            }
            return e
          })
        } else if (journalEntriesWithGrades && journalEntriesWithGrades.length > 0) {
          mergedEntries = journalEntriesWithGrades
        } else {
          mergedEntries = journalEntries
        }
        const assignments = feature.extractAssignmentsFromEntries(mergedEntries, studentMap, journalStudents, studentDetailsMap, journalEntriesWithGrades)

        let firstLessonDate = null
        let firstLessonDateIsApproximate = false
        let nextLessonDate = null
        let lastLessonDate = null
        let lastLessonDateIsApproximate = false
        try {
          const lessonDates = await feature.getLessonDates(id, journalInfo)
          firstLessonDate = lessonDates.firstLessonDate
          firstLessonDateIsApproximate = lessonDates.firstLessonDateIsApproximate
          nextLessonDate = lessonDates.nextLessonDate
          lastLessonDate = lessonDates.lastLessonDate
          lastLessonDateIsApproximate = lessonDates.lastLessonDateIsApproximate
        } catch (error) {
          Logger.warning(`Could not get lesson dates for journal ${id}:`, error)
        }

        let capacityHours = []
        try {
          if (journalInfo.lessonHours && Array.isArray(journalInfo.lessonHours.capacityHours)) {
            const relevantCapacities = journalInfo.lessonHours.capacityHours.filter(
              c => c.capacity === 'MAHT_i' || c.capacity === 'MAHT_p'
            )

            capacityHours = relevantCapacities.map(c => ({
              capacity: c.capacity,
              plannedHours: c.plannedHours,
              usedHours: c.usedHours
            }))
          }
        } catch (error) {
          Logger.warning(`Could not extract capacity hours for journal ${id}:`, error)
        }

        let plannedHours = null
        const mahtICapacity = capacityHours.find(c => c.capacity === 'MAHT_i')
        if (mahtICapacity) {
          plannedHours = mahtICapacity.plannedHours
        }

        let journalTheme = null
        try {
          // Prefer curriculumVersions -> top-level themes -> journalThemes:
          // many Tahvel responses include the canonical theme under
          // curriculumVersions[0].themes while journalThemes may contain a
          // different (derived) id. Prefer the curriculum one.
          let themeId = null
          try {
            if (
              journalInfo &&
              Array.isArray(journalInfo.curriculumVersions) &&
              journalInfo.curriculumVersions[0] &&
              Array.isArray(journalInfo.curriculumVersions[0].themes) &&
              journalInfo.curriculumVersions[0].themes[0] &&
              journalInfo.curriculumVersions[0].themes[0].id
            ) {
              themeId = journalInfo.curriculumVersions[0].themes[0].id
            } else if (journalInfo && Array.isArray(journalInfo.themes) && journalInfo.themes[0] && journalInfo.themes[0].id) {
              themeId = journalInfo.themes[0].id
            } else if (journalInfo && Array.isArray(journalInfo.journalThemes) && journalInfo.journalThemes[0] && journalInfo.journalThemes[0].id) {
              themeId = journalInfo.journalThemes[0].id
            }
          } catch (err) {
            themeId = null
          }

          if (themeId) {
            try {
              const themeEndpoint = `/journals/${id}/theme/${themeId}`
              const cacheKey = `theme_${id}_${themeId}`
              const themeContent = await cacheService.getOrFetch(
                cacheKey,
                async() => await feature.api.tahvel.get(themeEndpoint),
                cacheService.EXPIRATION.TWO_WEEKS
              )
              journalTheme = { id: themeId, content: themeContent }
            } catch (err) {
              Logger.debug(`Could not fetch theme ${themeId} for journal ${id}: ${err.message}`)
              journalTheme = { id: themeId, content: null }
            }
          }
        } catch (err) {
          Logger.debug(`Error while trying to resolve journal theme for ${id}: ${err.message}`)
          journalTheme = null
        }

        const teachers = []

        if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
          for (const teacher of journalInfo.journalTeachers) {
            const teacherName = teacher.nameEt || teacher.fullname || ''

            if (teacherName) {
              try {
                const teacherId = teacher.id
                if (!teacherId) {
                  Logger.warning(`No teacher ID available for teacher ${teacherName}`)
                  teachers.push({ name: teacherName, personalCode: '' })
                } else {
                  const teacherData = await getTeacherPersonalCodeCached(feature.api, teacher)
                  teachers.push({
                    name: teacherName,
                    personalCode: teacherData.personalCode
                  })

                  feature.globalTeacherCache[teacherId] = teacherData
                }
              } catch (error) {
                Logger.warning(`Failed to get teacher personal code: ${error.message}`)
                teachers.push({ name: teacherName, personalCode: '' })
              }
            }
          }
        }

        const studentGroups = []
        if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
          studentGroups.push(...journalInfo.studentGroups)
        } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
          studentGroups.push(journalStudents[0].studentGroup)
        }

        if (studentGroups.length === 0) {
          return {
            subjectName: journalInfo.nameEt || name,
            subjectExternalId: id,
            groupName: '',
            teachers,
            assignments,
            firstLessonDate,
            firstLessonDateIsApproximate,
            nextLessonDate,
            lastLessonDate,
            plannedHours,
            capacityHours,
            journalTheme
          }
        }

        const groupJournalEntries = []

        if (studentGroups.length > 1 && assignments.length > 0) {
          Logger.debug(`First assignment "${assignments[0].assignmentName}" has ${assignments[0].results.length} students`)
        }

        for (const groupName of studentGroups) {
          const filteredAssignments = assignments
            .map(assignment => {
              const filteredResults = assignment.results.filter(result => {
                const student = journalStudents.find(js => {
                  const studentId = studentMap.journalStudentIdToId[js.id.toString()]
                  const personalCode = studentMap.idToPersonalCode[studentId]
                  return personalCode === result.studentPersonalCode
                })
                return student && student.studentGroup === groupName
              })
              return {
                ...assignment,
                results: filteredResults
              }
            })
            .filter(assignment => assignment.results.length > 0)

          groupJournalEntries.push({
            subjectName: journalInfo.nameEt || name,
            subjectExternalId: id,
            groupName,
            teachers,
            assignments: filteredAssignments,
            firstLessonDate,
            firstLessonDateIsApproximate,
            nextLessonDate,
            lastLessonDate,
            lastLessonDateIsApproximate,
            plannedHours,
            capacityHours,
            journalTheme
          })
        }

        return groupJournalEntries
      } catch (error) {
        Logger.error(`Failed to process journal ${id}:`, error)
        return null
      }
    })
    const results = await Promise.all(journalPromises)

    try {
      const resolvedCount = results.filter(r => r !== null).length
      const failed = results.filter(r => r === null)
      Logger.debug(`Pre-flight: Resolved ${resolvedCount}/${results.length} journal entries (failed: ${failed.length})`)
      if (failed.length > 0 && Logger.isDebugMode()) {
        const samples = Array.from(feature.journalLinks)
          .map(el => (el.outerHTML ? el.outerHTML.replace(/\s+/g, ' ').slice(0, 200) : String(el)))
          .slice(0, 5)
        Logger.debug('Sample observed elements (first 5):', samples)
      }
    } catch (err) {
      // ignore logging errors
    }

    const journalData = results.filter(r => r !== null).flatMap(result => (Array.isArray(result) ? result : [result]))

    Logger.debug(`Collected data for ${journalData.length} journals`)
    return journalData
  } catch (error) {
    Logger.error('Error collecting journal data:', error)
    throw error
  }
}
