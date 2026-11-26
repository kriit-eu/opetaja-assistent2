import { describe, expect, test } from 'bun:test'
import { zoomikRead } from '../../src/services/ZoomikRead.js'

describe('Zoomik Tahvel reads', () => {
  test('uses the signed-in teacher and a fixed Tahvel origin for the timetable', async() => {
    const calls = []
    const get = async(...args) => {
      calls.push(args)
      return args[1] === '/user' ? { school: { id: 9 }, teacherId: 12 } : { timetableEvents: [] }
    }
    await zoomikRead({ operation: 'timetable', from: '2026-11-01', thru: '2026-11-02', schoolId: 1, teacherId: 2 }, get)
    expect(calls[1]).toEqual(['https://tahvel.edu.ee', '/timetableevents/timetableByTeacher/9', {
      teachers: 12, from: '2026-10-31T22:00:00.000Z', thru: '2026-11-02T21:59:59.999Z', lang: 'ET'
    }])
  })

  test('rejects paths, invalid IDs and invalid date ranges without a request', async() => {
    let calls = 0
    const get = async() => { calls++ }
    for (const request of [
      { operation: 'entry', journalId: '../user', entryId: 1 },
      { operation: 'entries', journalId: '1/../../user' },
      { operation: 'write', journalId: 1 },
      { operation: 'timetable', from: '2026-02-30', thru: '2026-03-01' },
      { operation: 'timetable', from: '2026-01-01', thru: '2026-03-01' }
    ]) await expect(zoomikRead(request, get)).rejects.toThrow()
    expect(calls).toBe(0)
  })
})
