/**
 * Gap-fill tests for module-level helpers in JournalListSync.js that are not
 * directly covered by JournalListSync.test.js. These tests guard the helpers
 * before they are extracted into their own modules so the refactor cannot
 * silently change their behaviour.
 *
 * Helpers under test:
 *  - fetchCachedData(api, endpoint, expiration)
 *  - getTeacherPersonalCodeCached(api, teacher)
 *  - computePayloadHash(payload)
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import {
  fetchCachedData,
  getTeacherPersonalCodeCached,
  computePayloadHash
} from '../../../src/features/journalList/JournalListSync.js'
import { cacheService } from '../../../src/services/CacheService.js'
import { restoreChromeMock } from '../../setup.js'

function freshDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://tahvel.edu.ee/' })
  global.window = dom.window
  global.document = dom.window.document
  if (!global.btoa) global.btoa = str => Buffer.from(str).toString('base64')
}

function makeApi(handlers = {}) {
  return {
    tahvel: {
      get: mock(async (endpoint) => {
        if (handlers[endpoint] === undefined) return null
        const value = handlers[endpoint]
        return typeof value === 'function' ? await value(endpoint) : value
      })
    }
  }
}

describe('fetchCachedData', () => {
  beforeEach(() => {
    restoreChromeMock()
    freshDom()
    if (global.caches && typeof global.caches._clear === 'function') global.caches._clear()
    cacheService.invalidateAll && cacheService.invalidateAll()
  })

  test('returns API result on cache miss and stores it for subsequent calls', async () => {
    const endpoint = `/test/gapfill-miss-${Date.now()}-${Math.random()}`
    const api = makeApi({ [endpoint]: { value: 42 } })

    const first = await fetchCachedData(api, endpoint)
    const second = await fetchCachedData(api, endpoint)

    expect(first).toEqual({ value: 42 })
    expect(second).toEqual({ value: 42 })
    expect(api.tahvel.get.mock.calls.length).toBe(1) // second call hit cache
  })

  test('returns null when underlying api.tahvel.get throws', async () => {
    const endpoint = `/test/gapfill-throws-${Date.now()}-${Math.random()}`
    const api = {
      tahvel: {
        get: mock(async () => { throw new Error('upstream boom') })
      }
    }

    const result = await fetchCachedData(api, endpoint)
    expect(result).toBeNull()
  })

  test('respects different endpoints as different cache entries', async () => {
    const stamp = `${Date.now()}-${Math.random()}`
    const endpointA = `/test/gapfill-a-${stamp}`
    const endpointB = `/test/gapfill-b-${stamp}`
    const api = makeApi({
      [endpointA]: { from: 'a' },
      [endpointB]: { from: 'b' }
    })

    const a = await fetchCachedData(api, endpointA)
    const b = await fetchCachedData(api, endpointB)

    expect(a).toEqual({ from: 'a' })
    expect(b).toEqual({ from: 'b' })
    expect(api.tahvel.get.mock.calls.length).toBe(2)
  })
})

describe('getTeacherPersonalCodeCached', () => {
  beforeEach(() => {
    restoreChromeMock()
    freshDom()
    if (global.caches && typeof global.caches._clear === 'function') global.caches._clear()
    cacheService.invalidateAll && cacheService.invalidateAll()
  })

  test('returns empty-personalCode fallback when teacher has no id or name', async () => {
    const api = makeApi({})
    const result = await getTeacherPersonalCodeCached(api, { id: null, nameEt: '' })
    expect(result).toEqual({ personalCode: '', name: '', id: null })
    expect(api.tahvel.get.mock.calls.length).toBe(0)
  })

  test('returns personalCode for exact-id match in API result', async () => {
    const teacher = { id: 5001, nameEt: `Teacher Gapfill ${Date.now()}-${Math.random()}` }
    const api = makeApi({
      [`/teachers?isActive=true&lang=ET&name=${encodeURIComponent(teacher.nameEt)}&page=0&size=50`]: {
        content: [
          { id: 9999, name: 'Other Teacher', idcode: 'xxx' },
          { id: 5001, name: teacher.nameEt, idcode: '38001011234' }
        ]
      }
    })

    const result = await getTeacherPersonalCodeCached(api, teacher)
    expect(result).toEqual({ personalCode: '38001011234', name: teacher.nameEt, id: 5001 })
  })

  test('returns fallback when API returns no matching content', async () => {
    const teacher = { id: 6002, nameEt: `No Match ${Date.now()}-${Math.random()}` }
    const api = makeApi({
      [`/teachers?isActive=true&lang=ET&name=${encodeURIComponent(teacher.nameEt)}&page=0&size=50`]: {
        content: []
      }
    })

    const result = await getTeacherPersonalCodeCached(api, teacher)
    expect(result).toEqual({ personalCode: '', name: teacher.nameEt, id: 6002 })
  })

  test('dedupes in-flight requests for the same teacher (one network call)', async () => {
    const teacher = { id: 7003, nameEt: `Concurrent Teacher ${Date.now()}-${Math.random()}` }
    let resolveFetch
    const api = {
      tahvel: {
        get: mock(() => new Promise(resolve => { resolveFetch = resolve }))
      }
    }

    const p1 = getTeacherPersonalCodeCached(api, teacher)
    const p2 = getTeacherPersonalCodeCached(api, teacher)

    resolveFetch({ content: [{ id: 7003, name: teacher.nameEt, idcode: '39901011234' }] })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ personalCode: '39901011234', name: teacher.nameEt, id: 7003 })
    expect(r2).toEqual(r1)
    expect(api.tahvel.get.mock.calls.length).toBe(1)
  })

  test('reuses module-cache on subsequent calls without hitting the API again', async () => {
    const teacher = { id: 8004, nameEt: `Cached Teacher ${Date.now()}-${Math.random()}` }
    const api = makeApi({
      [`/teachers?isActive=true&lang=ET&name=${encodeURIComponent(teacher.nameEt)}&page=0&size=50`]: {
        content: [{ id: 8004, name: teacher.nameEt, idcode: '47712121234' }]
      }
    })

    const first = await getTeacherPersonalCodeCached(api, teacher)
    const callsAfterFirst = api.tahvel.get.mock.calls.length
    const second = await getTeacherPersonalCodeCached(api, teacher)

    expect(second).toEqual(first)
    expect(api.tahvel.get.mock.calls.length).toBe(callsAfterFirst)
  })
})

describe('computePayloadHash', () => {
  beforeEach(() => {
    freshDom()
  })

  describe('SubtleCrypto path (SHA-1)', () => {
    beforeEach(() => {
      // jsdom does not expose crypto.subtle by default; attach Bun's
      // globalThis.crypto so the SHA-1 branch executes.
      Object.defineProperty(global.window, 'crypto', { value: globalThis.crypto, configurable: true })
      if (!global.window.TextEncoder) global.window.TextEncoder = globalThis.TextEncoder
    })

    test('produces a stable 40-char hex SHA-1 hash for identical payloads', async () => {
      const payload = { a: 1, b: [1, 2, 3], c: 'hello' }
      const h1 = await computePayloadHash(payload)
      const h2 = await computePayloadHash(payload)
      expect(h1).toBe(h2)
      expect(h1).toMatch(/^[0-9a-f]{40}$/)
    })

    test('different payloads produce different hashes', async () => {
      const h1 = await computePayloadHash({ a: 1 })
      const h2 = await computePayloadHash({ a: 2 })
      expect(h1).not.toBe(h2)
    })

    test('hash is sensitive to JSON property ordering', async () => {
      const h1 = await computePayloadHash({ a: 1, b: 2 })
      const h2 = await computePayloadHash({ b: 2, a: 1 })
      expect(h1).not.toBe(h2)
    })
  })

  describe('checksum fallback (no SubtleCrypto)', () => {
    test('falls back to deterministic `fallback-N` checksum when crypto.subtle is missing', async () => {
      // Force the fallback branch regardless of what jsdom exposes.
      Object.defineProperty(global.window, 'crypto', { value: undefined, configurable: true })
      try {
        const r1 = await computePayloadHash({ x: 1 })
        const r2 = await computePayloadHash({ x: 1 })
        expect(r1.startsWith('fallback-')).toBe(true)
        expect(r1).toBe(r2)
      } finally {
        // leave window.crypto undefined for clean teardown; freshDom() resets in next test
      }
    })
  })

  test('returns hash-failed sentinel when JSON.stringify throws (circular)', async () => {
    const circular = {}
    circular.self = circular
    const result = await computePayloadHash(circular)
    expect(result).toBe('hash-failed')
  })
})
