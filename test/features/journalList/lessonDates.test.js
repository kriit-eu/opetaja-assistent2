import { journalListSync } from '../../../src/features/journalList/JournalListSync'

// Minimal mock API wrapper to inject timetable and lessonplan responses
function makeMockApi({ timetableEvents = [], planData = null } = {}) {
  return {
    tahvel: {
      get: async (endpoint, params, opts) => {
        if (endpoint.includes('timetableByTeacher')) {
          return { timetableEvents }
        }
        if (endpoint.includes('lessonplans/byteacher')) {
          return planData
        }
        // default: return empty
        return null
      }
    }
  }
}

describe('JournalListSync lesson dates', () => {
  it('returns exact first lesson from timetable and marks it not approximate', async () => {
    const now = new Date()
    const d1 = new Date(now)
    d1.setDate(now.getDate() - 10)
    const d2 = new Date(now)
    d2.setDate(now.getDate() + 5)

    const timetableEvents = [
      { journalId: 123, date: d1.toISOString() },
      { journalId: 123, date: d2.toISOString() }
    ]

    journalListSync.api = makeMockApi({ timetableEvents })

    const journalInfo = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 2 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(123, journalInfo)
    expect(res.firstLessonDate).toBe(d1.toISOString())
    expect(res.firstLessonDateIsApproximate).toBe(false)
    // next should be the future one (>= tomorrow)
    expect(res.nextLessonDate).toBe(d2.toISOString())
  })

  it('falls back to lessonplan for first lesson and marks approximate', async () => {
    // plan data structure based on provided fixture
    const planData = {
      weekNrs: [1, 2, 3],
      studyPeriods: [{ weekNrs: [1, 2, 3], weekBeginningDates: ['2025-09-01T00:00:00Z', '2025-09-08T00:00:00Z', '2025-09-15T00:00:00Z'] }],
      journals: [{ id: 321, hours: { MAHT_a: [null, 2, null] } }]
    }

    journalListSync.api = makeMockApi({ timetableEvents: [], planData })

    const journalInfo = {
      school: { id: 9 },
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 1 }] },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(321, journalInfo)
    expect(res.firstLessonDate).toBe('2025-09-08T00:00:00Z')
    expect(res.firstLessonDateIsApproximate).toBe(true)
    expect(res.nextLessonDate).toBe(null)
  })

  it('skips today when selecting next lesson', async () => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(10, 0, 0, 0)
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    const later = new Date(now)
    later.setDate(now.getDate() + 2)

    const timetableEvents = [
      { journalId: 555, date: today.toISOString() },
      { journalId: 555, date: tomorrow.toISOString() },
      { journalId: 555, date: later.toISOString() }
    ]

    journalListSync.api = makeMockApi({ timetableEvents })
    const journalInfo = {
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 3 }] },
      school: { id: 9 },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }

    const res = await journalListSync.getLessonDates(555, journalInfo)
    // nextLessonDate should be tomorrow (not today)
    expect(res.nextLessonDate).toBe(tomorrow.toISOString())
  })

  it('only sends lastLessonDate when timetable length matches planned MAHT_a', async () => {
    const d1 = new Date()
    d1.setDate(d1.getDate() - 5)
    const d2 = new Date()
    d2.setDate(d2.getDate() + 5)
    const timetableEvents = [
      { journalId: 777, date: d1.toISOString() },
      { journalId: 777, date: d2.toISOString() }
    ]

    // planned MAHT_a equals timetable length -> lastLessonDate set
    journalListSync.api = makeMockApi({ timetableEvents })
    const journalInfoMatch = {
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 2 }] },
      school: { id: 9 },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }
    const resMatch = await journalListSync.getLessonDates(777, journalInfoMatch)
    expect(resMatch.lastLessonDate).toBe(d2.toISOString())

    // planned MAHT_a mismatch -> lastLessonDate null
    const journalInfoMismatch = {
      journalTeachers: [{ id: 1 }],
      lessonHours: { capacityHours: [{ capacity: 'MAHT_a', plannedHours: 1 }] },
      school: { id: 9 },
      studyYearStartDate: new Date(Date.UTC(new Date().getFullYear(), 8, 1)).toISOString(),
      studyYearEndDate: new Date(Date.UTC(new Date().getFullYear() + 1, 7, 31)).toISOString()
    }
    const resMismatch = await journalListSync.getLessonDates(777, journalInfoMismatch)
    expect(resMismatch.lastLessonDate).toBe(null)
  })
})
