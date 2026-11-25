import { expect, test } from 'bun:test'
import { enrollmentFlags, getEnrollmentStatuses } from '../../src/lib/enrollmentStatuses.js'

const row = (status, idcode = 'learner') => ({ idcode, status: 'OPPURSTAATUS_' + status })
const api = pages => ({ tahvel: { get: async (_, { page }) => pages[page] } })

test('a current enrolment takes precedence across pages and in either order', async () => {
  for (const statuses of [['O', 'L'], ['L', 'O'], ['A', 'K'], ['K', 'A']]) {
    const pages = statuses.map(s => ({ content: [row(s)], totalPages: 2 }))
    const result = await getEnrollmentStatuses(api(pages), [])
    expect(result.map(s => s.status)).toEqual([statuses.includes('O') ? 'OPPURSTAATUS_O' : 'OPPURSTAATUS_A'])
  }
})

test('a failed page cannot supply a partial status list', async () => {
  await expect(getEnrollmentStatuses(api([{ content: [row('L')], totalPages: 2 }]), [])).rejects.toThrow()
})

test('skip ambiguous closed records and unrelated active learners', async () => {
  const content = [row('K'), row('L'), row('O', 'active'), row('O', 'other'), row('L', 'graduate')]
  const journals = [{ assignments: [{ results: [{ studentPersonalCode: 'active' }] }] }]
  const result = await getEnrollmentStatuses(api([{ content }]), journals)
  expect(result.map(s => s.personalCode)).toEqual(['active', 'graduate'])
  expect(enrollmentFlags(undefined)).toEqual({})
  expect(enrollmentFlags('unknown')).toEqual({})
})
