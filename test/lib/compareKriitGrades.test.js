import { expect, test } from 'bun:test'
import { compareJournal } from '../../src/lib/compareKriitGrades.js'

const target = { subjectExternalId: 123, assignmentExternalId: 456, studentPersonalCode: 'fixture' }
async function check(entries, roster = [{ id: 1, studentId: 2, studentGroup: null }], person = { idcode: 'fixture' }) {
  const replies = [{ id: 123 }, entries, roster, { person }]
  const [result] = await compareJournal([target], new Map(), async () => ({ status: 200, data: replies.shift() }))
  return result
}

test('compare a previous group member even with a virtual outcome entry in the journal', async () => {
  const outcome = { id: null, entryType: 'SISSEKANNE_O', curriculumModuleOutcomes: 8 }
  const result = { journalStudentId: 1, grade: { code: 'KUTSEHINDAMINE_4' } }
  expect((await check([outcome, { id: 456, journalStudentResults: { 1: [result] } }])).grade).toBe('4')
})
test('require the entry, the roster identity and the results map before reporting an empty grade', async () => {
  expect((await check([])).reason).toBe('entryMissing')
  expect((await check([{ id: 456 }])).reason).toBe('gradeIncomplete')
  expect((await check([{ id: 456 }], [])).reason).toBe('studentMissing')
  expect((await check([{ id: 456 }], undefined, {})).reason).toBe('identityIncomplete')
  expect((await check([{ id: 456, journalStudentResults: {} }])).grade).toBeNull()
})
