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
      const [journalInfo, journalEntriesWithGrades, journalStudents] = await Promise.all([
        api.tahvel.get(`/journals/${id}`),
        api.tahvel.get(`/journals/${id}/journalEntriesByDate`, { allStudents: true }),
        api.tahvel.get(`/journals/${id}/journalStudents`, { allStudents: true })
      ])
      if (!journalInfo || !Array.isArray(journalEntriesWithGrades) || !Array.isArray(journalStudents)) return null
      // Filter for outcome entries only
      const outcomeEntries = journalEntriesWithGrades.filter(e => e.entryType === 'SISSEKANNE_O')
      if (outcomeEntries.length === 0) return null

      // Build assignments array for outcome entries, only required fields
      const assignments = outcomeEntries.map(entry => ({
        assignmentExternalId: entry.curriculumModuleOutcomes,
        assignmentName: entry.nameEt,
        learningOutcomeOrderNr: entry.outcomeOrderNr ?? null
      }))
      if (assignments.length === 0) return null
      return {
        subjectName: journalInfo.nameEt || name,
        subjectExternalId: id,
        groupName: '',
        teacherPersonalCode: '',
        teacherName: '',
        assignments
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
  // Build payload: only subjectId, outcomeId, outcomeName, learningOutcomeOrderNr
  const outcomesPayload = []
  finalGradesData.forEach(subject => {
    subject.assignments.forEach(assignment => {
      outcomesPayload.push({
        subjectId: subject.subjectExternalId,
        curriculumModuleOutcomes: assignment.assignmentExternalId,
        outcomeName: assignment.assignmentName,
        learningOutcomeOrderNr: assignment.learningOutcomeOrderNr
      })
    })
  })
  console.log('Outcomes data being sent to outcomes API:', outcomesPayload)
  Logger.debug('Sending outcomes to API:', JSON.stringify(outcomesPayload))
  try {
    const response = await api.kriit.post('/outcomes/sync', outcomesPayload)
    Logger.debug('outcomes API response:', JSON.stringify(response))
  } catch (error) {
    Logger.error('Error sending outcomes to API:', error)
  }
}
