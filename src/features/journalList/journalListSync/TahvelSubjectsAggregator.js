/**
 * Aggregate Tahvel journals into the subject + assignment + grade shape
 * consumed by external callers. This is a standalone exported function
 * (not a feature method) — callers bind `this` to an object with an `api`
 * property, e.g. `getTahvelSubjectsWithAssignmentsAndGrades.call({ api }, ids)`.
 *
 * Single responsibility: walk a list of journal IDs, fetch journal info /
 * students / entries / theme via fetchCachedData, and return a normalised
 * subject list. No Kriit transport, no banner UI, no instance state.
 */

import Logger from '../../../services/Logger.js'
import { fetchCachedData, getTeacherPersonalCodeCached, TWO_WEEKS_MS } from './TeacherCache.js'

export async function getTahvelSubjectsWithAssignmentsAndGrades(journalIds = []) {
  try {
    if (!journalIds || journalIds.length === 0) {
      Logger.warning('No journal IDs provided to getTahvelSubjectsWithAssignmentsAndGrades')
      return []
    }

    Logger.debug(`Processing ${journalIds.length} journals`)

    const results = []

    for (const journalId of journalIds) {
      try {
        Logger.debug(`Processing journal ID: ${journalId}`)

        const journalInfo = await fetchCachedData(this.api, `/journals/${journalId}`)
        if (!journalInfo) {
          Logger.warning(`Could not get info for journal ${journalId}`)
          continue
        }

        const journalStudents = await fetchCachedData(this.api, `/journals/${journalId}/journalStudents?allStudents=true`)
        if (!Array.isArray(journalStudents) || journalStudents.length === 0) {
          Logger.warning(`No students found for journal ${journalId}`)
          continue
        }

        const journalEntries = await fetchCachedData(this.api, `/journals/${journalId}/journalEntriesByDate?allStudents=true`)
        if (!Array.isArray(journalEntries)) {
          Logger.warning(`No entries found for journal ${journalId}`)
          continue
        }

        const studentDetailsMap = {}
        for (const student of journalStudents) {
          if (student && student.studentId) {
            const studentDetails = await fetchCachedData(this.api, `/students/${student.studentId}`)

            if (studentDetails && studentDetails.person && studentDetails.person.idcode) {
              studentDetailsMap[student.id] = {
                personalCode: studentDetails.person.idcode,
                name: student.fullname || student.studentName,
                isActive: studentDetails.status === 'OPPURSTAATUS_O',
                isGraduated: studentDetails.status === 'OPPURSTAATUS_L'
              }
            }
          }
        }

        const assignments = []
        for (const entry of journalEntries) {
          if ((entry.entryType === 'SISSEKANNE_I' || entry.entryType === 'SISSEKANNE_P') && entry.nameEt && entry.id) {
            const assignmentResults = []

            const studentResultsMap = {}
            if (entry.journalStudentResults) {
              Object.entries(entry.journalStudentResults).forEach(([journalStudentId, studentResults]) => {
                studentResultsMap[journalStudentId] = studentResults
              })
            }

            Object.values(studentDetailsMap).forEach(studentDetails => {
              if (studentDetails) {
                const journalStudentId = Object.keys(studentDetailsMap).find(id => studentDetailsMap[id] === studentDetails)

                const studentResults = studentResultsMap[journalStudentId]
                let grade = ''

                if (studentResults && studentResults.length > 0 && studentResults[0].grade && studentResults[0].grade.code) {
                  grade = studentResults[0].grade.code.replace('KUTSEHINDAMINE_', '')
                }

                assignmentResults.push({
                  grade,
                  studentPersonalCode: studentDetails.personalCode,
                  studentName: studentDetails.name,
                  studentIsActive: studentDetails.isActive,
                  studentIsGraduated: studentDetails.isGraduated || false
                })
              }
            })

            let dueDate = null
            let entryDate = null
            if (entry.entryDate) {
              const date = new Date(entry.entryDate)
              entryDate = date.toISOString().split('T')[0]

              const dueDateObj = new Date(date)
              dueDateObj.setDate(dueDateObj.getDate() + 2)
              dueDate = dueDateObj.toISOString().split('T')[0]
            }

            if (assignmentResults.length > 0) {
              assignments.push({
                assignmentExternalId: entry.id,
                assignmentName: entry.nameEt,
                assignmentInstructions: entry.nameEt,
                assignmentDueAt: dueDate,
                assignmentEntryDate: entryDate,
                entryType: entry.entryType || null,
                results: assignmentResults
              })
            }
          }
        }

        let teacherName = ''
        let teacherPersonalCode = ''

        if (journalInfo.journalTeachers && journalInfo.journalTeachers.length > 0) {
          const teacher = journalInfo.journalTeachers[0]
          teacherName = teacher.nameEt || teacher.fullname || ''

          if (teacherName && teacher.id) {
            const teacherData = await getTeacherPersonalCodeCached(this.api, teacher)
            teacherPersonalCode = teacherData.personalCode
          }
        }

        let groupName = ''
        if (Array.isArray(journalInfo.studentGroups) && journalInfo.studentGroups.length > 0) {
          groupName = journalInfo.studentGroups[0]
        } else if (Array.isArray(journalStudents) && journalStudents.length > 0 && journalStudents[0].studentGroup) {
          groupName = journalStudents[0].studentGroup
        }

        let journalTheme = null
        try {
          let themeId = null
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

          if (themeId) {
            const themeContent = await fetchCachedData(this.api, `/journals/${journalId}/theme/${themeId}`, TWO_WEEKS_MS)
            journalTheme = { id: themeId, content: themeContent }
          }
        } catch (err) {
          Logger.debug(`Could not fetch theme for journal ${journalId}: ${err.message}`)
          journalTheme = null
        }

        if (assignments.length > 0) {
          results.push({
            subjectName: journalInfo.nameEt,
            subjectExternalId: journalId,
            groupName,
            teacherPersonalCode,
            teacherName,
            assignments,
            journalTheme
          })
        }
      } catch (error) {
        Logger.error(`Error processing journal ${journalId}:`, error)
      }
    }

    return results
  } catch (error) {
    Logger.error('Error in getTahvelSubjectsWithAssignmentsAndGrades:', error)
    throw error
  }
}
