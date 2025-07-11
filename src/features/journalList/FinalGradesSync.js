import Logger from '../../services/Logger.js'

/**
 * Collect and send only outcome entries (SISSEKANNE_O) to Kriit API
 * Stores results in the finalGrades table via /api/finalgrades/sync
 * @param {Object} api - API service instance
 * @param {Array} journalLinks - List of journal link elements
 * @returns {Promise<void>}
 */
export async function sendFinalGradesToKriit(api, journalLinks) {
  if (!api || !api.kriit || !api.kriit.authToken) {
    Logger.error('No Kriit API token set')
    return
  }
  if (!journalLinks || journalLinks.length === 0) {
    Logger.warning('No journal links available for final grades sync')
    return
  }

  Logger.debug('Collecting outcome entries (SISSEKANNE_O) for final grades sync')

  const journalPromises = Array.from(journalLinks).map(async link => {
    const href = link.getAttribute('href') || link.getAttribute('ng-href') || ''
    let id = null
    const idMatch = href.match(/\/journal\/(\d+)/)
    if (idMatch && idMatch[1]) {
      id = parseInt(idMatch[1], 10)
    } else {
      const parts = href.split('/')
      if (parts.length >= 4) {
        id = parseInt(parts[3], 10)
      }
    }
    if (!id) return null
    const name = link.textContent.trim()
    try {
      // Only fetch entries with grades
      const [journalInfo, journalEntriesWithGrades, journalStudents] = await Promise.all([
        api.tahvel.get(`/journals/${id}`),
        api.tahvel.get(`/journals/${id}/journalEntriesByDate`, { allStudents: true }),
        api.tahvel.get(`/journals/${id}/journalStudents`, { allStudents: true })
      ])
      if (!journalInfo || !Array.isArray(journalEntriesWithGrades) || !Array.isArray(journalStudents)) return null
      // Filter for outcome entries only
      const outcomeEntries = journalEntriesWithGrades.filter(e => e.entryType === 'SISSEKANNE_O')
      if (outcomeEntries.length === 0) return null
      // Build assignments array for outcome entries
      const assignments = await Promise.all(outcomeEntries.map(async entry => {
        // Log the full outcome entry object to debug available fields
        console.log('RAW OUTCOME ENTRY:', entry)
        // Always use curriculumModuleOutcomes as assignmentExternalId for SISSEKANNE_O
        const assignmentExternalId = entry.curriculumModuleOutcomes || null
        // Populate results with all journal students, even if grades are not present
        const results = journalStudents.map(student => {
          console.log('RAW JOURNAL STUDENT:', student)
          return {
            studentPersonalCode: student.studentId || '',
            studentName: student.fullname || '',
            grade: '',
            currentGrade: ''
          }
        })
        return {
          assignmentName: entry.nameEt || 'Õppetulemus',
          assignmentExternalId,
          results
        }
      }))
      // PATCH: filter out assignments with empty results
      const filteredAssignments = assignments.filter(a => Array.isArray(a.results) && a.results.length > 0);
      if (filteredAssignments.length === 0) return null;
      return {
        subjectName: journalInfo.nameEt || name,
        subjectExternalId: id,
        groupName: '',
        teacherPersonalCode: '',
        teacherName: '',
        assignments: filteredAssignments,
        allStudents: journalStudents.map(student => ({
          studentId: student.id || '',
          personalCode: student.studentId || '',
          name: student.fullname || '',
          status: student.status || ''
        }))
      }
    } catch (error) {
      Logger.error(`Failed to process journal ${id} for final grades:`, error)
      return null
    }
  })
  const results = await Promise.all(journalPromises)
  const finalGradesData = results.filter(r => r !== null)
  if (finalGradesData.length === 0) {
    Logger.info('No outcome entries to send for final grades')
    return
  }
  // Show the data being sent to finalGrades API in the console
  console.log('Final grades data being sent to finalGrades API:', finalGradesData)
  Logger.debug('Sending final grades (outcome entries) to finalGrades API:', JSON.stringify(finalGradesData))
  try {
    const response = await api.kriit.post('/finalgrades/sync', finalGradesData)
    Logger.debug('finalGrades API response:', JSON.stringify(response))
  } catch (error) {
    Logger.error('Error sending final grades to finalGrades API:', error)
  }
}
