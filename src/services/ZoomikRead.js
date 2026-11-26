import { lessonGet } from './LessonNotificationService.js'
import { lessonTimestamp } from './LessonSchedule.js'

const POSITIVE_ID = /^[1-9]\d{0,9}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Read the supported Tahvel data for Zoomik. Never accept a URL or HTTP method. */
export async function zoomikRead(request, get = lessonGet) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Vigane päring')
  const { operation, journalId, entryId, from, thru } = request
  const origin = 'https://tahvel.edu.ee'
  const id = value => POSITIVE_ID.test(String(value))
  if (operation === 'user') return get(origin, '/user')
  if (operation === 'timetable' || operation === 'lessonTimes') {
    if (!DATE.test(from || '') || !DATE.test(thru || '') || from > thru) throw new Error('Vigane ajavahemik')
    const start = Date.parse(`${from}T00:00:00Z`)
    const end = Date.parse(`${thru}T00:00:00Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 31 * 86400000 ||
        new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== thru) throw new Error('Vigane ajavahemik')
    const nextDay = new Date(end + 86400000).toISOString().slice(0, 10)
    const fromTime = new Date(lessonTimestamp(from, '00:00')).toISOString()
    const thruTime = new Date(lessonTimestamp(nextDay, '00:00') - 1).toISOString()
    if (operation === 'lessonTimes') {
      const rows = []
      for (let page = 0; page < 10; page++) {
        const result = await get(origin, '/lessontimes', { from: fromTime, thru: thruTime, size: 100, page })
        if (!Array.isArray(result?.content)) throw new Error('Tunniaegade vastus on vigane')
        rows.push(...result.content)
        if (result.last === true || (Number.isInteger(result.totalPages) && page + 1 >= result.totalPages)) return rows
        if (!result.content.length) throw new Error('Tunniaegade vastus on poolik')
      }
      throw new Error('Tunniaegu on liiga palju')
    }
    const user = await get(origin, '/user')
    const schoolId = user?.school?.id
    const teacherId = user?.teacherId ?? user?.teacher
    if (!id(schoolId) || !id(teacherId)) throw new Error('Logi Tahvlisse sisse õpetajana')
    return get(origin, `/timetableevents/timetableByTeacher/${schoolId}`, {
      teachers: teacherId,
      from: fromTime,
      thru: thruTime,
      lang: 'ET'
    })
  }
  if (!id(journalId)) throw new Error('Vigane päeviku tunnus')
  if (operation === 'journal') return get(origin, `/journals/${journalId}`)
  if (operation === 'entries') return get(origin, `/journals/${journalId}/journalEntriesByDate`, { allStudents: true })
  if (operation === 'students') return get(origin, `/journals/${journalId}/journalStudents`, { allStudents: true })
  if (operation === 'entry' && id(entryId)) return get(origin, `/journals/${journalId}/journalEntry/${entryId}`)
  throw new Error('Päring ei ole lubatud')
}
