/**
 * Kriit API token management + cache invalidation.
 *
 * Stateful helpers — they take the feature instance to access feature.api,
 * feature.globalTeacherCache, feature.error / feature.updateUI, and to
 * trigger a data refresh via feature.fetchJournalData().
 */

import Logger from '../../../services/Logger.js'
import { cacheService } from '../../../services/CacheService.js'
import { globalModuleTeacherCache, pendingTeacherRequests } from './TeacherCache.js'

export function setKriitApiToken(feature, token) {
  if (!token) {
    Logger.error('Invalid token provided')
    return
  }

  chrome.storage.local.set({ OA_kriitApiToken: token }, () => {
    feature.api.kriit.setAuthToken(token)
    Logger.debug('Kriit API token updated')
    feature.fetchJournalData()
  })
}

export function resetKriitApiToken(feature) {
  chrome.storage.local.remove(['OA_kriitApiToken'], () => {
    const newToken = prompt('Please enter your Kriit API token:', '')

    if (newToken) {
      setKriitApiToken(feature, newToken)
      Logger.debug('New Kriit API token set')
    } else {
      feature.error = 'No token provided. Please set a valid Kriit API token.'
      feature.updateUI()
    }
  })
}

export async function clearCache(feature) {
  const teacherRuntimeCacheSize = Object.keys(feature.globalTeacherCache).length

  feature.globalTeacherCache = {}

  const moduleTeacherCacheSize = Object.keys(globalModuleTeacherCache).length
  Object.keys(globalModuleTeacherCache).forEach(key => {
    delete globalModuleTeacherCache[key]
  })

  pendingTeacherRequests.clear()

  const cacheCount = await cacheService.clearCache()

  const totalCleared = teacherRuntimeCacheSize + moduleTeacherCacheSize + cacheCount

  Logger.debug(`Cleared ${totalCleared} total cache entries:`)
  Logger.debug(`- Cache service: ${cacheCount} entries`)
  Logger.debug(`- Teacher runtime cache: ${teacherRuntimeCacheSize} entries`)
  Logger.debug(`- Module teacher cache: ${moduleTeacherCacheSize} entries`)

  return {
    total: totalCleared,
    api: cacheCount,
    feature: 0,
    runtime: teacherRuntimeCacheSize + moduleTeacherCacheSize,
    students: 0,
    teachers: teacherRuntimeCacheSize + moduleTeacherCacheSize
  }
}
