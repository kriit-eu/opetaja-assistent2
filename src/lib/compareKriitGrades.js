// Read each journal by its external ID. A journal can belong to an earlier school year.
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validId = value => /^[1-9]\d*$/.test(String(value))

async function readTahvel(path) {
  const response = await fetch('/hois_back/' + path, { cache: 'no-store' })
  if (response.status === 401) throw new Error('Logi Tahvlisse uuesti sisse.')
  const data = await response.json()
  return { status: response.status, data }
}

function readGrade(entry, memberId) {
  const results = entry.journalStudentResults
  if (!isRecord(results)) return { reason: 'gradeIncomplete' }
  if (!Object.hasOwn(results, memberId)) return { grade: null }
  const records = results[memberId]
  if (!Array.isArray(records) || records.length !== 1) return { reason: 'gradeIncomplete' }
  const row = records[0]
  if (!row || String(row.journalStudentId) !== String(memberId)) return { reason: 'gradeIncomplete' }
  if (row.grade === null) return { grade: null }
  const match = /^KUTSEHINDAMINE_(.+)$/.exec(row.grade?.code || '')
  return match ? { grade: match[1] } : { reason: 'gradeIncomplete' }
}

export async function compareJournal(targets, identities, read = readTahvel) {
  const journalId = targets[0].subjectExternalId
  if (!validId(journalId)) throw new Error('Päeviku ID on vigane.')
  const path = 'journals/' + journalId
  const blocked = reason => targets.map(target => ({ ...target, reason }))
  const journal = await read(path)
  if (journal.data?._errors?.some(error => error.code === 'main.messages.error.nopermission')) return blocked('denied')
  if (journal.status !== 200 || String(journal.data?.id) !== String(journalId)) return blocked('journalUnavailable')
  const entries = await read(path + '/journalEntriesByDate?allStudents=true')
  if (entries.status !== 200 || !Array.isArray(entries.data) || entries.data.some(entry => !validId(entry?.id) && !(entry?.entryType === 'SISSEKANNE_O' && entry.id === null && entry.curriculumModuleOutcomes))) return blocked('entriesIncomplete')
  const roster = await read(path + '/journalStudents?allStudents=true')
  if (roster.status !== 200 || !Array.isArray(roster.data)) return blocked('rosterIncomplete')
  const members = new Map()
  let complete = true
  for (const member of roster.data) {
    if (!validId(member?.id) || !validId(member.studentId)) {
      complete = false
      continue
    }
    if (!identities.has(member.studentId)) {
      const student = await read('students/' + member.studentId)
      if (student.status === 200 && typeof student.data?.person?.idcode === 'string') identities.set(member.studentId, student.data.person.idcode)
    }
    const code = identities.get(member.studentId)
    if (!code) complete = false
    else members.set(code, members.has(code) ? null : member.id)
  }
  return targets.map(target => {
    const matches = entries.data.filter(entry => String(entry.id) === String(target.assignmentExternalId))
    const code = target.studentPersonalCode
    if (!matches.length) return { ...target, reason: 'entryMissing' }
    if (matches.length !== 1) return { ...target, reason: 'entriesIncomplete' }
    if (!members.get(code)) return { ...target, reason: complete && code && !members.has(code) ? 'studentMissing' : 'identityIncomplete' }
    return { ...target, ...readGrade(matches[0], members.get(code)) }
  })
}

export async function compareKriitGrades(kriit, progress) {
  const { targets } = await kriit.get('/grades/comparisonTargets', {}, { cache: false })
  const journals = new Map()
  for (const target of targets) {
    if (!journals.has(target.subjectExternalId)) journals.set(target.subjectExternalId, [])
    journals.get(target.subjectExternalId).push(target)
  }
  const identities = new Map()
  let count = 0
  for (const group of journals.values()) {
    progress(++count, journals.size)
    const checks = await compareJournal(group, identities)
    await kriit.post('/grades/saveComparisons', { checks })
  }
}
