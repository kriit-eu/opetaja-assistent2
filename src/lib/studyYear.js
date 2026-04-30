const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function getCurrentStudyYearText(date = new Date()) {
  const studyYearStart = date.getMonth() < 8 ? date.getFullYear() - 1 : date.getFullYear()
  return `${studyYearStart}/${studyYearStart + 1}`
}

function getStudyYearsEndpoint(api) {
  const base = api?.tahvel?.baseUrl ? String(api.tahvel.baseUrl) : ''
  return base.endsWith('/hois_back') ? '/autocomplete/studyYears' : '/hois_back/autocomplete/studyYears'
}

export async function resolveStudyYearIdFromText(api, yearText) {
  if (!yearText) return null

  const studyYearsResponse = await api.tahvel.get(
    getStudyYearsEndpoint(api),
    {},
    {
      cache: true,
      cacheExpiration: ONE_DAY_MS
    }
  )

  if (!Array.isArray(studyYearsResponse)) return null

  const matchingYear = studyYearsResponse.find(studyYear => studyYear.nameEt === yearText)
  return matchingYear?.id || null
}

export async function resolveCurrentStudyYearId(api, date = new Date()) {
  return resolveStudyYearIdFromText(api, getCurrentStudyYearText(date))
}
