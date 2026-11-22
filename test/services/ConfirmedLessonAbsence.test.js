import { expect, test } from 'bun:test'
import { confirmedLessonAbsence } from '../../src/services/ConfirmedLessonAbsence.js'
import { lessonTimestamp } from '../../src/services/LessonSchedule.js'

const group = { id: 12, code: 'A' }
const block = { date: '2026-09-14', timeStart: '10:54', start: lessonTimestamp('2026-09-14', '10:54'),
  schoolId: 9, journalId: 81, eventIds: [202], groups: [group], lessonTimes: [{ number: 2, timeEnd: '09:55' }] }
const previous = { id: 201, date: '2026-09-11', timeStart: '09:10', timeEnd: '09:55', journalId: 80, studentGroups: [group] }
const current = { ...previous, id: 202, date: block.date, timeStart: '10:54', timeEnd: '11:39', journalId: 81 }
const response = { number: 0, totalElements: 2, content: [previous, current] }
const rows = [
  { journalStudent: 1, isLessonAbsence: true, lessonAbsences: [{ lessonNr: 2, absence: 'PUUDUMINE_P' }] },
  { journalStudent: 2, absence: 'PUUDUMINE_H' }, { journalStudent: 3, absence: 'PUUDUMINE_V' },
  { journalStudent: 4, absence: 'PUUDUMINE_PR', isLessonAbsence: true, lessonAbsences: [{ lessonNr: 1, absence: 'PUUDUMINE_PR' }] }
]
const entries = [{ id: 6, entryDate: previous.date, entryType: 'SISSEKANNE_T', startLessonNr: 2, lessons: 2 }]
const get = async path => {
  if (path === '/lessontimes') return { last: true, content: [
    { startTime: '09:10', endTime: '09:55', lessonNr: 3, validFrom: '2026-09-01', dayFri: true }
  ] }
  if (path === '/timetableevents/timetableSearch/9') return response
  if (path === '/journals/80/journalEntriesByDate') return entries
  if (path === '/journals/80/journalEntry/6') return { ...entries[0], journalEntryStudents: rows }
  if (path === '/journals/80/journalStudents') return [1, 2, 3, 4].map(id => ({
    id, studentId: id + 100, studentGroup: id === 3 ? 'B' : 'A'
  }))
  throw Error('Unexpected fixture request ' + path)
}

test('read marks for the last period in the previous journal and group', async() => {
  expect((await confirmedLessonAbsence(get, block, group)).absent).toEqual([101])
})

test('skip missing, conflicting and incomplete records', async() => {
  for (const [path, value] of [
    ['/timetableevents/timetableSearch/9', { ...response, totalElements: 1 }],
    ['/timetableevents/timetableSearch/9', { ...response, content: [previous, { ...previous, id: 203 }] }],
    ['/journals/80/journalEntriesByDate', []],
    ['/journals/80/journalEntriesByDate', [...entries, ...entries]],
    ['/journals/80/journalEntry/6', { ...entries[0], journalEntryStudents: [...rows, rows[0]] }]
  ]) {
    expect(await confirmedLessonAbsence(p => p === path ? value : get(p), block, group)).toBeNull()
  }
})
