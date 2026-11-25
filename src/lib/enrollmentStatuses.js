// Resolve a person's status only after Tahvel returns all matching enrolments.
export async function getEnrollmentStatuses(api, journals) {
  const journalCodes = new Set()
  for (const journal of journals) {
    for (const assignment of journal.assignments || []) {
      for (const result of assignment.results || []) journalCodes.add(result.studentPersonalCode)
    }
  }

  const people = new Map()
  const size = 2000
  for (let page = 0; page < 50; page++) {
    const response = await api.tahvel.get('/students', {
      lang: 'ET',
page,
size,
showMyStudentGroups: false,
      sort: 'id,asc',
status: ['OPPURSTAATUS_O', 'OPPURSTAATUS_A', 'OPPURSTAATUS_L', 'OPPURSTAATUS_K']
    }, { cache: false })
    if (!Array.isArray(response?.content)) throw new Error('Missing Tahvel enrolment page')
    for (const row of response.content) {
      if (!row.idcode) continue
      if (!people.has(row.idcode)) people.set(row.idcode, new Map())
      people.get(row.idcode).set(row.status, row)
    }
    const last = response.totalPages != null ? page + 1 >= response.totalPages : response.content.length < size
    if (!last) {
      if (!response.content.length) throw new Error('Incomplete Tahvel enrolment list')
      continue
    }

    const statuses = []
    for (const [personalCode, records] of people) {
      const studying = records.get('OPPURSTAATUS_O')
      if (studying && records.size === 1 && !journalCodes.has(personalCode)) continue
      const current = studying || records.get('OPPURSTAATUS_A')
      // Two different closed statuses need a confirmed end date to choose between them.
      const row = current || (records.size === 1 && records.values().next().value)
      if (row) statuses.push({ personalCode, status: row.status, name: row.fullname || [row.firstname, row.lastname].filter(Boolean).join(' ') })
    }
    return statuses
  }
  throw new Error('Incomplete Tahvel enrolment list')
}

// A journal can supply enrolment flags only if Tahvel supplied a known status.
export function enrollmentFlags(status) {
  if (!['OPPURSTAATUS_O', 'OPPURSTAATUS_A', 'OPPURSTAATUS_L', 'OPPURSTAATUS_K'].includes(status)) return {}
  return {
    isActive: status === 'OPPURSTAATUS_O',
    isDeleted: status === 'OPPURSTAATUS_K',
    isGraduated: status === 'OPPURSTAATUS_L'
  }
}
