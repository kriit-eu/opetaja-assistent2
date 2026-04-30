const ONE_DAY_MS = 24 * 60 * 60 * 1000
const STUDY_YEARS_ENDPOINT = '/autocomplete/studyYears'

export function getCurrentStudyYearText(date = new Date()) {
  const studyYearStart = date.getMonth() < 8 ? date.getFullYear() - 1 : date.getFullYear()
  return `${studyYearStart}/${studyYearStart + 1}`
}

export async function resolveStudyYearIdFromText(api, yearText) {
  if (!yearText) return null

  const studyYearsResponse = await api.tahvel.get(
    STUDY_YEARS_ENDPOINT,
    {},
    {
      cache: true,
      cacheExpiration: ONE_DAY_MS
    }
  )

  if (!Array.isArray(studyYearsResponse)) return null

  const matchingYear = studyYearsResponse.find(studyYear => studyYear.nameEt === yearText)
  return matchingYear?.id ?? null
}

export async function resolveCurrentStudyYearId(api, date = new Date()) {
  return resolveStudyYearIdFromText(api, getCurrentStudyYearText(date))
}

function getWeekIndex(mahtAWeeks, position) {
  if (position === 'first') {
    return mahtAWeeks.findIndex(hours => hours !== null)
  }

  if (position === 'last') {
    for (let i = mahtAWeeks.length - 1; i >= 0; i--) {
      if (mahtAWeeks[i] !== null) {
        return i
      }
    }
    return -1
  }

  throw new Error(`getWeekIndex: unknown position "${position}", expected 'first' or 'last'`)
}

export async function resolveLessonPlanDate(api, journalId, teacherId, position) {
  const studyYearId = await resolveCurrentStudyYearId(api)
  if (studyYearId === null) return null

  const planData = await api.tahvel.get(
    `/lessonplans/byteacher/${teacherId}/${studyYearId}`,
    {},
    {
      cache: true,
      cacheExpiration: ONE_DAY_MS
    }
  )

  if (!planData?.journals || !planData?.studyPeriods) return null

  const journalPlan = planData.journals.find(journal => journal.id === journalId)
  if (!journalPlan?.hours?.MAHT_a) return null

  const weekIndex = getWeekIndex(journalPlan.hours.MAHT_a, position)
  if (weekIndex === -1) return null

  const weekNr = planData.weekNrs[weekIndex]
  if (!weekNr) return null

  for (const period of planData.studyPeriods) {
    const weekPosition = period.weekNrs.indexOf(weekNr)
    if (weekPosition !== -1 && period.weekBeginningDates?.[weekPosition]) {
      return period.weekBeginningDates[weekPosition]
    }
  }

  return null
}
