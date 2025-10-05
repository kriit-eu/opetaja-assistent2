import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { cacheService } from '../../src/services/CacheService.js'
import { restoreChromeMock } from '../setup.js'

describe('CacheService', () => {
  let chromeMocks

  beforeEach(() => {
    chromeMocks = {
      storage: {
        local: {
          get: mock((keys, callback) => {
            callback({})
          }),
          set: mock((items, callback) => {
            if (callback) callback()
          }),
          remove: mock((keys, callback) => {
            if (callback) callback()
          }),
          getBytesInUse: mock((keys, callback) => {
            callback(0)
          })
        },
        sync: {
          get: mock((keys, callback) => {
            callback({})
          }),
          set: mock((items, callback) => {
            if (callback) callback()
          })
        }
      }
    }

    global.chrome = chromeMocks
  })

  afterEach(async () => {
    await cacheService.clearCache()
    restoreChromeMock()
  })

  describe('set and get', () => {
    test('should set and get cache value', async () => {
      const testData = { name: 'test', value: 123 }

      chromeMocks.storage.local.set = mock((items, callback) => {
        callback()
      })

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          OA_cache_testKey: {
            data: testData,
            timestamp: Date.now()
          }
        })
      })

      await cacheService.set('testKey', testData)
      const result = await cacheService.get('testKey')

      expect(result).toEqual(testData)
    })

    test('should return null for expired cache', async () => {
      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          OA_cache_expiredKey: {
            data: { test: 'data' },
            timestamp: Date.now() - 10000
          }
        })
      })

      const result = await cacheService.get('expiredKey', 5000)
      expect(result).toBeNull()
    })

    test('should return null for non-existent cache', async () => {
      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({})
      })

      const result = await cacheService.get('nonExistent')
      expect(result).toBeNull()
    })
  })

  describe('getOrFetch', () => {
    test('should fetch data when cache is empty', async () => {
      const testData = { id: 1, name: 'fetchTest' }
      const fetchFn = mock(async () => testData)

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({})
      })

      const result = await cacheService.getOrFetch('fetchKey1', fetchFn, cacheService.EXPIRATION.SHORT)

      expect(result).toEqual(testData)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    test('should use cached data when available and not expired', async () => {
      const cachedData = { id: 1, name: 'cached' }
      const fetchFn = mock(async () => ({ id: 2, name: 'fresh' }))

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          OA_cache_cachedKey: {
            data: cachedData,
            timestamp: Date.now() - 1000
          }
        })
      })

      const result = await cacheService.getOrFetch('cachedKey', fetchFn, cacheService.EXPIRATION.MEDIUM)

      expect(result).toEqual(cachedData)
      expect(fetchFn).not.toHaveBeenCalled()
    })

    test('should fetch fresh data when cache is expired', async () => {
      const freshData = { id: 2, name: 'fresh' }
      const fetchFn = mock(async () => freshData)

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          OA_cache_expiredFetchKey: {
            data: { id: 1, name: 'old' },
            timestamp: Date.now() - 10000
          }
        })
      })

      const result = await cacheService.getOrFetch('expiredFetchKey', fetchFn, 5000)

      expect(result).toEqual(freshData)
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    test('should deduplicate concurrent requests', async () => {
      const testData = { id: 1 }
      let fetchCount = 0
      const fetchFn = mock(async () => {
        fetchCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return testData
      })

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({})
      })

      const [result1, result2, result3] = await Promise.all([
        cacheService.getOrFetch('dedupeKey', fetchFn),
        cacheService.getOrFetch('dedupeKey', fetchFn),
        cacheService.getOrFetch('dedupeKey', fetchFn)
      ])

      expect(result1).toEqual(testData)
      expect(result2).toEqual(testData)
      expect(result3).toEqual(testData)
      expect(fetchCount).toBe(1)
    })
  })

  describe('clearCache', () => {
    test('should clear all cache entries', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          OA_cache_key1: { data: 'test1' },
          OA_cache_key2: { data: 'test2' },
          other_key: { data: 'other' }
        })
      })

      global.chrome.storage.local.remove.mockImplementation((keys, callback) => {
        expect(keys).toEqual(['OA_cache_key1', 'OA_cache_key2'])
        callback()
      })

      const count = await cacheService.clearCache()
      expect(count).toBe(2)
    })
  })

  describe('clearJournalCache', () => {
    test('should clear only journal-related cache', async () => {
      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          'OA_cache_journals/123/journalEntriesByDate': { data: 'test1' },
          'OA_cache_journals/456/journalStudents': { data: 'test2' },
          'OA_cache_schools/789/timetable': { data: 'test3' },
          OA_cache_other: { data: 'test4' }
        })
      })

      let removedKeys = []
      chromeMocks.storage.local.remove = mock((keys, callback) => {
        removedKeys = keys
        callback()
      })

      await cacheService.clearJournalCache()

      expect(removedKeys.length).toBe(2)
      expect(removedKeys).toContain('OA_cache_journals/123/journalEntriesByDate')
      expect(removedKeys).toContain('OA_cache_journals/456/journalStudents')
    })

    test('should clear cache for specific journal ID', async () => {
      let removedKeys = []

      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          'OA_cache_/journals/123/journalEntriesByDate': { data: 'test1' },
          'OA_cache_/journals/456/journalStudents': { data: 'test2' }
        })
      })

      chromeMocks.storage.local.remove = mock((keys, callback) => {
        removedKeys = keys
        callback()
      })

      global.chrome = chromeMocks

      await cacheService.clearJournalCache(123)

      expect(removedKeys.length).toBe(1)
      expect(removedKeys).toContain('OA_cache_/journals/123/journalEntriesByDate')
    })

    test('should not clear timetable cache', async () => {
      chromeMocks.storage.local.get = mock((keys, callback) => {
        callback({
          OA_cache_timetableEvents: { data: 'timetable' },
          'OA_cache_journals/123/journalEntriesByDate': { data: 'journal' }
        })
      })

      let removedKeys = []
      chromeMocks.storage.local.remove = mock((keys, callback) => {
        removedKeys = keys
        callback()
      })

      await cacheService.clearJournalCache()

      expect(removedKeys.length).toBe(1)
      expect(removedKeys).toContain('OA_cache_journals/123/journalEntriesByDate')
      expect(removedKeys).not.toContain('OA_cache_timetableEvents')
    })
  })

  describe('isJournalRelatedCache', () => {
    test('should identify journal-related cache keys', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_journals/123/journalEntriesByDate')).toBe(true)
      expect(cacheService.isJournalRelatedCache('OA_cache_journals/123/journalStudents')).toBe(true)
      expect(cacheService.isJournalRelatedCache('OA_cache_journals/123/journalEntry')).toBe(true)
    })

    test('should exclude timetable-related cache keys', () => {
      expect(cacheService.isJournalRelatedCache('OA_cache_timetableEvents')).toBe(false)
      expect(cacheService.isJournalRelatedCache('OA_cache_schools/789/timetable')).toBe(false)
      expect(cacheService.isJournalRelatedCache('OA_cache_teachers/456')).toBe(false)
    })

    test('should filter by journal ID when provided', () => {
      // Test with prefix (will be removed by function)
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/123/journalEntriesByDate', 123)).toBe(true)
      expect(cacheService.isJournalRelatedCache('OA_cache_/journals/456/journalEntriesByDate', 123)).toBe(false)
    })
  })

  describe('getStats', () => {
    test('should return cache statistics', async () => {
      global.chrome.storage.local.get.mockImplementation((keys, callback) => {
        callback({
          OA_cache_key1: {
            data: { test: 'data1' },
            timestamp: Date.now() - 60000
          },
          OA_cache_key2: {
            data: { test: 'data2' },
            timestamp: Date.now() - 120000
          }
        })
      })

      global.chrome.storage.local.getBytesInUse.mockImplementation((keys, callback) => {
        callback(1024)
      })

      const stats = await cacheService.getStats()

      expect(stats).toHaveProperty('memory')
      expect(stats).toHaveProperty('storage')
      expect(stats).toHaveProperty('totalBytesInUse')
      expect(stats.storage.count).toBe(2)
      expect(stats.totalBytesInUse).toBe(1024)
    })
  })

  describe('EXPIRATION constants', () => {
    test('should have correct expiration values', () => {
      expect(cacheService.EXPIRATION.VERY_SHORT).toBe(1000)
      expect(cacheService.EXPIRATION.SHORT).toBe(60 * 1000)
      expect(cacheService.EXPIRATION.MEDIUM).toBe(5 * 60 * 1000)
      expect(cacheService.EXPIRATION.LONG).toBe(30 * 60 * 1000)
      expect(cacheService.EXPIRATION.VERY_LONG).toBe(24 * 60 * 60 * 1000)
    })
  })
})
