import { expect, test } from 'bun:test'
import { lessonAttendance } from '../../src/lib/lessonAttendance.js'

test('keeps recorded absences for the group and excludes late and academic-leave students', () => {
  const entries = [{ id: 1, entryDate: '2026-11-12', entryType: 'SISSEKANNE_T' }]
  const students = ['A', 'B', 'C', 'D'].map((fullname, id) => ({
    id, fullname, studentGroup: id === 3 ? 'Other' : 'Group', status: id === 1 ? 'OPPURSTAATUS_A' : 'OPPURSTAATUS_O'
  }))
  const results = [{ id: 1, entryType: 'SISSEKANNE_T', journalStudentResults: {
    0: [{ lessonAbsences: [{ absence: 'PUUDUMINE_V' }] }],
    1: [{ absence: 'PUUDUMINE_P' }], 2: [{ absence: 'PUUDUMINE_H' }], 3: [{ absence: 'PUUDUMINE_P' }]
  } }]
  expect(lessonAttendance(entries, results, students, 'Group', ['Group', 'Other'])[0].names).toEqual(['A'])
  expect(lessonAttendance(entries, [], students, 'Group', ['Group'])).toBeNull()
})
