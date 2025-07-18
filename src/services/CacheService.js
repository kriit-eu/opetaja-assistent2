/**
 * Cache Service - Handles caching of API requests to prevent duplicate calls
 */

import Logger from './Logger.js'

const CACHE_PREFIX = 'OA_cache_'
const CACHE_EXPIRATION = {
  VERY_SHORT: 1000, // 1 second
  SHORT: 60 * 1000, // 1 minute
  MEDIUM: 5 * 60 * 1000, // 5 minutes
  LONG: 30 * 60 * 1000, // 30 minutes
  VERY_LONG: 24 * 60 * 60 * 1000 // 24 hours
}

// In-memory cache for the current page session
const memoryCache = {}

// Size thresholds for logging cache statistics (not limits)
const CACHE_SIZE_WARNING = 1000000 // 1MB
const CACHE_SIZE_LARGE = 5000000 // 5MB

const cacheService = {
  /**
   * Get data from cache or fetch it if not available
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch data if not in cache
   * @param {number} expiration - Cache expiration time in milliseconds
   * @param {boolean} useMemoryCache - Whether to use memory cache (default: true)
   * @returns {Promise<any>} The data
   */
  async getOrFetch(key, fetchFn, expiration = CACHE_EXPIRATION.MEDIUM, useMemoryCache = true) {
    const cacheKey = `${CACHE_PREFIX}${key}`

    // Try memory cache first (for current page session)
    if (useMemoryCache && memoryCache[cacheKey]) {
      const cachedItem = memoryCache[cacheKey]
      const now = Date.now()

      if (now - cachedItem.timestamp < expiration) {
        return cachedItem.data
      }
      // Memory cache expired, remove it
      delete memoryCache[cacheKey]
    }

    // Try storage cache
    try {
      const storageData = await new Promise(resolve => {
        chrome.storage.local.get([cacheKey], result => {
          resolve(result[cacheKey])
        })
      })

      if (storageData) {
        const now = Date.now()
        const timestamp = storageData.timestamp || 0

        if (now - timestamp < expiration) {
          // Cache hit - store in memory cache too
          if (useMemoryCache) {
            memoryCache[cacheKey] = {
              data: storageData.data,
              timestamp: timestamp
            }
          }

          // Calculate age in days for better logging
          const ageInDays = (now - timestamp) / (24 * 60 * 60 * 1000)
          const ageText = ageInDays < 0.001 ? 'just now' : ageInDays < 0.04 ? `${Math.round(ageInDays * 24 * 60)} minutes` : `${ageInDays.toFixed(1)} days`

          // Extract item description from key for better logging
          const itemDescription = key.includes('journalEntriesByDate')
            ? `journal entries for journal ${key.match(/journals\/(\d+)\/journalEntriesByDate/)?.[1] || 'unknown'}`
            : key.includes('journalStudents')
              ? `journal students for journal ${key.match(/journals\/(\d+)\/journalStudents/)?.[1] || 'unknown'}`
              : `data for ${key}`

          Logger.debug(`[Cache] HIT: ${itemDescription} (age: ${ageText})`)

          return storageData.data
        }
      }
    } catch (error) {
      Logger.warning(`Error reading cache for ${key}:`, error)
    }

    // Cache miss or expired - fetch fresh data
    Logger.debug(`Fetching fresh data for ${key}`)
    try {
      const data = await fetchFn()

      // Store in both caches
      const timestamp = Date.now()
      const cacheItem = { data, timestamp }

      // Store in memory cache
      if (useMemoryCache) {
        memoryCache[cacheKey] = cacheItem
      }

      // Check the size of the data for logging purposes
      const serializedData = JSON.stringify(cacheItem)
      const dataSize = serializedData.length

      // Log warnings for very large items, but store them anyway
      if (dataSize > CACHE_SIZE_LARGE) {
        Logger.warning(`Cache item for ${key} is very large (${Math.round(dataSize / 1024)}KB).`)
      } else if (dataSize > CACHE_SIZE_WARNING) {
        Logger.debug(`Cache item for ${key} is large (${Math.round(dataSize / 1024)}KB).`)
      }

      // Store full data in persistent cache - we have unlimitedStorage now
      chrome.storage.local.set({ [cacheKey]: cacheItem })

      // Always return the original unsanitized data
      return data
    } catch (error) {
      Logger.error(`Error fetching data for ${key}:`, error)
      throw error
    }
  },

  /**
   * Clear all API request caches
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearCache() {
    // Clear memory cache
    const memoryKeysCount = Object.keys(memoryCache).length
    Object.keys(memoryCache).forEach(key => {
      delete memoryCache[key]
    })

    // Clear storage cache
    return new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const keysToRemove = Object.keys(items).filter(key => key.startsWith(CACHE_PREFIX))

        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            Logger.debug(`Cleared ${keysToRemove.length} API cache entries from storage`)
            Logger.debug(`Cleared ${memoryKeysCount} API cache entries from memory`)
            resolve(keysToRemove.length + memoryKeysCount)
          })
        } else {
          Logger.debug('No API cache entries to clear from storage')
          Logger.debug(`Cleared ${memoryKeysCount} API cache entries from memory`)
          resolve(memoryKeysCount)
        }
      })
    })
  },

  /**
   * Clear journal-related API request caches only
   * @param {number} journalId - Optional journal ID to clear cache for specific journal
   * @returns {Promise<number>} Number of cache entries cleared
   */
  async clearJournalCache(journalId = null) {
    // Clear memory cache
    const memoryKeysToRemove = []
    for (const key in memoryCache) {
      if (this.isJournalRelatedCache(key, journalId)) {
        memoryKeysToRemove.push(key)
        delete memoryCache[key]
      }
    }

    // Clear storage cache
    return new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const keysToRemove = Object.keys(items).filter(key => key.startsWith(CACHE_PREFIX) && this.isJournalRelatedCache(key, journalId))

        if (keysToRemove.length > 0) {
          chrome.storage.local.remove(keysToRemove, () => {
            Logger.debug(`Cleared ${keysToRemove.length} journal cache entries from storage`)
            Logger.debug(`Cleared ${memoryKeysToRemove.length} journal cache entries from memory`)
            resolve(keysToRemove.length + memoryKeysToRemove.length)
          })
        } else {
          Logger.debug('No journal cache entries to clear from storage')
          Logger.debug(`Cleared ${memoryKeysToRemove.length} journal cache entries from memory`)
          resolve(memoryKeysToRemove.length)
        }
      })
    })
  },

  /**
   * Check if a cache key is journal-related (but not timetable-related)
   * @param {string} key - Cache key to check
   * @param {number} journalId - Optional journal ID to filter by
   * @returns {boolean} True if the cache key is journal-related
   */
  isJournalRelatedCache(key, journalId = null) {
    // Remove cache prefix for checking
    const cleanKey = key.replace(CACHE_PREFIX, '')

    // Journal-related patterns (but exclude timetable data)
    const journalPatterns = ['journalEntriesByDate', 'journalEntry', 'journalStudents', '/journals/']

    // Timetable-related patterns to exclude
    const timetablePatterns = ['timetableEvents', 'timetable', '/schools/', '/teachers/']

    // Check if it's timetable-related (should not be cleared)
    for (const pattern of timetablePatterns) {
      if (cleanKey.includes(pattern)) {
        return false
      }
    }

    // Check if it's journal-related
    let isJournalRelated = false
    for (const pattern of journalPatterns) {
      if (cleanKey.includes(pattern)) {
        isJournalRelated = true
        break
      }
    }

    // If specific journal ID provided, filter by it
    if (isJournalRelated && journalId) {
      const journalIdPattern = `/journals/${journalId}/`
      return cleanKey.includes(journalIdPattern)
    }

    return isJournalRelated
  },

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getStats() {
    // Get memory cache stats
    const memoryStats = {
      count: Object.keys(memoryCache).length,
      size: 0,
      items: []
    }

    // Calculate memory cache size
    for (const key in memoryCache) {
      const serialized = JSON.stringify(memoryCache[key])
      const size = serialized.length
      memoryStats.size += size

      // Get cache key without prefix
      const cacheKey = key.replace(CACHE_PREFIX, '')

      memoryStats.items.push({
        key: cacheKey,
        size,
        timestamp: memoryCache[key].timestamp
      })
    }

    // Get storage cache stats
    return new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const storageStats = {
          count: 0,
          size: 0,
          items: []
        }

        // Filter items with our cache prefix
        const cacheKeys = Object.keys(items).filter(key => key.startsWith(CACHE_PREFIX))

        storageStats.count = cacheKeys.length

        // Calculate total size and details
        for (const key of cacheKeys) {
          const serialized = JSON.stringify(items[key])
          const size = serialized.length
          storageStats.size += size

          // Get cache key without prefix
          const cacheKey = key.replace(CACHE_PREFIX, '')

          // Get age in minutes
          const timestamp = items[key].timestamp || 0
          const ageInMinutes = timestamp ? Math.round((Date.now() - timestamp) / (60 * 1000)) : 0

          storageStats.items.push({
            key: cacheKey,
            size,
            ageInMinutes,
            timestamp
          })
        }

        // Sort by size (descending)
        storageStats.items.sort((a, b) => b.size - a.size)

        // Get total storage usage
        chrome.storage.local.getBytesInUse(null, bytesInUse => {
          resolve({
            memory: memoryStats,
            storage: storageStats,
            totalBytesInUse: bytesInUse
          })
        })
      })
    })
  },

  /**
   * Cache expiration constants
   */
  EXPIRATION: CACHE_EXPIRATION
}

export { cacheService }
