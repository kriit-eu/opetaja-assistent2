/**
 * Module-scope cache for teacher personal codes + the cache-wrapping helper
 * used by Tahvel data fetchers.
 *
 * Two layers of dedup:
 *  - globalModuleTeacherCache: keyed by (teacherId + base64-endpoint), survives
 *    across feature activations and across sibling features.
 *  - pendingTeacherRequests: in-flight promise map so two near-simultaneous
 *    lookups for the same teacher coalesce into one network call.
 *
 * Persistence semantics are deliberate — see CLAUDE.md "Caching" notes.
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { ApiService } from '../../../services/ApiService.js'

export const ONE_DAY_MS = 24 * 60 * 60 * 1000
export const ONE_WEEK_MS = 7 * ONE_DAY_MS
export const TWO_WEEKS_MS = 2 * ONE_WEEK_MS

export const globalModuleTeacherCache = {}
export const pendingTeacherRequests = new Map()

export async function fetchCachedData(api, endpoint, expiration = ONE_DAY_MS) {
  const cacheKey = `${encodeURIComponent(endpoint.replace(/^\//, ''))}`

  // This is a secondary cache layer keyed by the URL-encoded endpoint, so
  // the inner ApiService routing for high-PII endpoints can't see it. Apply
  // the same check ourselves to force memory-only.
  const persist = !ApiService._isHighPiiEndpoint(endpoint)

  try {
    return await cacheService.getOrFetch(
      cacheKey,
      async() => {
        try {
          return await api.tahvel.get(endpoint)
        } catch (error) {
          Logger.warning(`Error fetching ${endpoint}: ${error.message}`)
          return null
        }
      },
      expiration,
      true,
      persist
    )
  } catch (error) {
    Logger.warning(`Error using cacheService for ${endpoint}: ${error.message}`)
    return null
  }
}

export async function getTeacherPersonalCodeCached(api, teacher) {
  const teacherId = teacher.id
  const teacherName = teacher.nameEt || teacher.fullname || ''

  if (!teacherId || !teacherName) {
    return { personalCode: '', name: teacherName, id: teacherId }
  }

  const encodedName = encodeURIComponent(teacherName)
  const endpoint = `/teachers?isActive=true&lang=ET&name=${encodedName}&page=0&size=50`
  const cacheKey = `teacher_${teacherId}_${btoa(endpoint).slice(0, 20)}`

  if (globalModuleTeacherCache[cacheKey]) {
    return globalModuleTeacherCache[cacheKey]
  }

  if (pendingTeacherRequests.has(cacheKey)) {
    return await pendingTeacherRequests.get(cacheKey)
  }

  const fetchPromise = (async() => {
    try {
      const teacherSearchResult = await fetchCachedData(api, endpoint, ONE_WEEK_MS)

      if (teacherSearchResult?.content && Array.isArray(teacherSearchResult.content) && teacherSearchResult.content.length > 0) {
        let foundTeacher = teacherSearchResult.content.find(t => t.id === teacherId)

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content.find(t => t.name === teacherName || t.name === teacher.fullname)
        }

        if (!foundTeacher) {
          foundTeacher = teacherSearchResult.content[0]
          Logger.warning(
            `No exact match found for teacher ${teacherName} (ID: ${teacherId}). Using first result: ${foundTeacher.name} (ID: ${foundTeacher.id})`
          )
        }

        const teacherData = {
          personalCode: foundTeacher.idcode || '',
          name: foundTeacher.name || teacherName,
          id: foundTeacher.id
        }

        globalModuleTeacherCache[cacheKey] = teacherData

        return teacherData
      }

      const fallbackData = {
        personalCode: '',
        name: teacherName,
        id: teacherId
      }

      globalModuleTeacherCache[cacheKey] = fallbackData
      return fallbackData
    } catch (error) {
      Logger.warning(`Failed to get teacher personal code for ${teacherName}: ${error.message}`)
      const errorData = { personalCode: '', name: teacherName, id: teacherId }
      globalModuleTeacherCache[cacheKey] = errorData
      return errorData
    } finally {
      pendingTeacherRequests.delete(cacheKey)
    }
  })()

  pendingTeacherRequests.set(cacheKey, fetchPromise)

  return await fetchPromise
}
