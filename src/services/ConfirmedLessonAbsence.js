import { loadPeriods } from './LessonEntryDetails.js'
import { lessonTimestamp } from './LessonSchedule.js'

const absenceCodes = new Set(['PUUDUMINE_P', 'PUUDUMINE_V'])
const positive = value => Number.isSafeInteger(value) && value > 0

/** Read the complete group timetable and verify the last period in the journal. */
export async function confirmedLessonAbsence(get, block, group) {
  if (!positive(group.id) || !group.code || !positive(block.eventIds[0])) return null
  const midnight = Date.parse(block.date + 'T00:00:00Z')
  const dateAt = days => new Date(midnight + days * 86400000).toISOString().slice(0, 10)
  const from = new Date(lessonTimestamp(dateAt(-14), '00:00')).toISOString()
  const thru = new Date(lessonTimestamp(dateAt(1), '00:00') - 1).toISOString()
  const events = []
  let total
  for (let page = 0; page < 50; page++) {
    const data = await get(`/timetableevents/timetableSearch/${block.schoolId}`, { studentGroups: group.id, from, thru, page, size: 100 })
    if (!Array.isArray(data.content) || data.number !== page || !Number.isInteger(data.totalElements) ||
        (total !== undefined && total !== data.totalElements)) return null
    total = data.totalElements
    events.push(...data.content)
    if (events.length === total) break
    if (!data.content.length || events.length > total || page === 49) return null
  }
  if (new Set(events.map(e => e.id)).size !== events.length) return null
  const target = events.find(e => e.id === block.eventIds[0])
  if (!target || target.journalId !== block.journalId || target.date?.slice(0, 10) !== block.date ||
      target.timeStart?.slice(0, 5) !== block.timeStart) return null
  const prior = []
  for (const event of events) {
    if (!positive(event.id) || !event.studentGroups?.some(g => g.id === group.id && g.code === group.code) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(event.date?.slice(0, 10)) ||
        ![event.timeStart, event.timeEnd].every(t => /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(t))) return null
    const start = lessonTimestamp(event.date, event.timeStart)
    const end = lessonTimestamp(event.date, event.timeEnd)
    if (end <= start || (start < block.start && end > block.start)) return null
    if (end <= block.start) {
      if (event.date.slice(0, 10) === block.date && !event.subgroups?.length &&
          !event.students?.length && !event.includesEventStudents) return null
      prior.push({ event, end })
    }
  }
  prior.sort((a, b) => b.end - a.end)
  if (!prior.length || prior[0].end === prior[1]?.end) return null
  const previous = prior[0].event
  if (!positive(previous.journalId) || previous.subgroups?.length || previous.students?.length || previous.includesEventStudents) return null
  const mapping = await loadPeriods(get, {
    date: previous.date.slice(0, 10),
    timeStart: previous.timeStart.slice(0, 5),
    timeEnd: previous.timeEnd.slice(0, 5)
  })
  if (!mapping) return null
  const period = mapping.startLessonNr + mapping.lessons - 1
  const path = '/journals/' + previous.journalId
  const entries = await get(path + '/journalEntriesByDate', { allStudents: true })
  const contact = entries.filter(e => e.isCurrentJournal !== false && ['SISSEKANNE_T', 'SISSEKANNE_P'].includes(e.entryType) &&
    e.entryDate?.slice(0, 10) === previous.date.slice(0, 10))
  if (contact.some(e => !positive(Number(e.startLessonNr)) || !positive(Number(e.lessons)))) return null
  const matches = contact.filter(e => Number(e.startLessonNr) <= period && Number(e.startLessonNr) + Number(e.lessons) > period)
  if (matches.length !== 1 || !positive(matches[0].id)) return null
  // Tahvel numbers lessonAbsences from one inside each journal entry.
  const entryPeriod = period - Number(matches[0].startLessonNr) + 1
  const detail = await get(path + '/journalEntry/' + matches[0].id)
  if (detail.id !== matches[0].id || detail.entryDate?.slice(0, 10) !== previous.date.slice(0, 10) ||
      Number(detail.startLessonNr) !== Number(matches[0].startLessonNr) ||
      Number(detail.lessons) !== Number(matches[0].lessons) || detail.entryType !== matches[0].entryType) return null
  const roster = await get(path + '/journalStudents', { allStudents: true })
  if (!Array.isArray(roster) || !Array.isArray(detail.journalEntryStudents)) return null
  const absent = []
  const seen = new Set()
  for (const row of detail.journalEntryStudents) {
    if (!positive(row.journalStudent) || seen.has(row.journalStudent)) return null
    seen.add(row.journalStudent)
    const records = roster.filter(s => s.id === row.journalStudent)
    if (records.length !== 1) return null
    const student = records[0]
    if (student.studentGroup !== group.code) continue
    if (!positive(student.studentId) || roster.filter(s => s.studentId === student.studentId).length !== 1) return null
    let mark = row.absence
    const periods = Object.values(row.lessonAbsences || {})
    if (row.isLessonAbsence === true) {
      const marks = periods.filter(a => Number(a.lessonNr) === entryPeriod)
      if (marks.length !== 1) continue
      mark = marks[0].absence
    } else if (periods.length || (row.isLessonAbsence != null && row.isLessonAbsence !== false)) continue
    if (absenceCodes.has(mark?.code ?? mark)) absent.push(student.studentId)
  }
  return {
    group: group.code,
    groupExternalId: group.id,
    journalId: block.journalId,
    eventId: block.eventIds[0],
    date: block.date,
    timeStart: block.timeStart,
    previousEventId: previous.id,
    previousDate: previous.date.slice(0, 10),
    entryId: matches[0].id,
    absent: absent.sort((a, b) => a - b)
  }
}

/** Send a short-lived confirmation through the configured teacher connection. */
export async function reportLessonAbsence(settings, get, block) {
  for (const group of block.groups) {
    const evidence = await confirmedLessonAbsence(get, block, group)
    if (!evidence) continue
    const response = await fetch(new URL('attendance', settings.url), {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.token },
      body: JSON.stringify({ ...evidence, schoolId: block.schoolId })
    })
    const result = await response.json()
    if (!response.ok || result.data?.ok !== true) throw new Error('Puudumismärke saatmine ebaõnnestus.')
  }
}
