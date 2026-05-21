import { describe, it, expect } from 'bun:test'
import {
  isMutatingMethod,
  extractJournalIdFromUrl,
  isJournalMutation
} from '../../src/lib/journalEditDetector.js'

describe('isMutatingMethod', () => {
  it('returns true for POST/PUT/PATCH/DELETE regardless of case', () => {
    expect(isMutatingMethod('POST')).toBe(true)
    expect(isMutatingMethod('put')).toBe(true)
    expect(isMutatingMethod('Patch')).toBe(true)
    expect(isMutatingMethod('DELETE')).toBe(true)
  })

  it('returns false for GET, HEAD, OPTIONS', () => {
    expect(isMutatingMethod('GET')).toBe(false)
    expect(isMutatingMethod('HEAD')).toBe(false)
    expect(isMutatingMethod('OPTIONS')).toBe(false)
  })

  it('returns false for non-string input', () => {
    expect(isMutatingMethod(null)).toBe(false)
    expect(isMutatingMethod(undefined)).toBe(false)
    expect(isMutatingMethod(123)).toBe(false)
  })
})

describe('extractJournalIdFromUrl', () => {
  it('extracts id from a /hois_back/journals/<id>/<child> URL', () => {
    expect(extractJournalIdFromUrl('https://tahvel.edu.ee/hois_back/journals/123/journalEntry')).toBe(123)
    expect(extractJournalIdFromUrl('https://test.tahvel.eenet.ee/hois_back/journals/4567/journalEntry/89')).toBe(4567)
  })

  it('extracts id when the URL ends at /hois_back/journals/<id>', () => {
    expect(extractJournalIdFromUrl('https://tahvel.edu.ee/hois_back/journals/426365')).toBe(426365)
  })

  it('extracts id when followed by a query string', () => {
    expect(extractJournalIdFromUrl('/hois_back/journals/77?allStudents=true')).toBe(77)
  })

  it('returns null for the SPA hash route — must anchor on /hois_back/', () => {
    // The hash route /#/journal/426365/edit is the page URL the user types
    // in the address bar. We must NOT confuse it with an API mutation.
    expect(extractJournalIdFromUrl('https://test.tahvel.eenet.ee/#/journal/426365/edit')).toBeNull()
    // Without anchoring, a careless regex would match 'journals/' substrings
    // elsewhere; require /hois_back/ as the prefix.
    expect(extractJournalIdFromUrl('https://tahvel.edu.ee/some/other/journals/1')).toBeNull()
  })

  it('returns null for non-journal /hois_back/ URLs', () => {
    expect(extractJournalIdFromUrl('https://tahvel.edu.ee/hois_back/user')).toBeNull()
    expect(extractJournalIdFromUrl('https://tahvel.edu.ee/hois_back/timetableevents/timetableByTeacher/9')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(extractJournalIdFromUrl(null)).toBeNull()
    expect(extractJournalIdFromUrl(undefined)).toBeNull()
    expect(extractJournalIdFromUrl('')).toBeNull()
    expect(extractJournalIdFromUrl(123)).toBeNull()
  })
})

describe('isJournalMutation', () => {
  it('is true for a 2xx mutating response to a journal child URL', () => {
    expect(isJournalMutation({
      method: 'PUT',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry/45',
      statusCode: 200
    })).toBe(true)
    expect(isJournalMutation({
      method: 'POST',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry',
      statusCode: 201
    })).toBe(true)
    expect(isJournalMutation({
      method: 'DELETE',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry/45',
      statusCode: 204
    })).toBe(true)
  })

  it('is false for non-2xx responses (no point invalidating cache on a failure)', () => {
    expect(isJournalMutation({
      method: 'PUT',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry/45',
      statusCode: 403
    })).toBe(false)
    expect(isJournalMutation({
      method: 'POST',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry',
      statusCode: 500
    })).toBe(false)
    expect(isJournalMutation({
      method: 'PUT',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry/45',
      statusCode: 199
    })).toBe(false)
    expect(isJournalMutation({
      method: 'PUT',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry/45',
      statusCode: 300
    })).toBe(false)
  })

  it('is false for GET regardless of URL', () => {
    expect(isJournalMutation({
      method: 'GET',
      url: 'https://tahvel.edu.ee/hois_back/journals/123/journalEntry',
      statusCode: 200
    })).toBe(false)
  })

  it('is false for non-journal URLs even with mutating method + 2xx', () => {
    expect(isJournalMutation({
      method: 'POST',
      url: 'https://tahvel.edu.ee/hois_back/user/login',
      statusCode: 200
    })).toBe(false)
  })

  it('is false for malformed inputs', () => {
    expect(isJournalMutation({})).toBe(false)
    expect(isJournalMutation()).toBe(false)
    expect(isJournalMutation({ method: 'PUT', url: '/foo', statusCode: '200' })).toBe(false)
  })
})
