import Logger from './Logger.js'
import { cryptoService } from './CryptoService.js'
import { buildLessonBlocks, tallinnDate, lessonTimestamp, timetableSourceDate, mapTimetableToDate, shiftTestNotifications } from './LessonSchedule.js'

const KEY = 'OA_lessonNotifications'
const REFRESH = 'oa2-lesson-refresh'
const MIDNIGHT = 'oa2-lesson-midnight'
const PREFIX = 'oa2-lesson:'
const ORIGINS = ['https://tahvel.edu.ee', 'https://test.tahvel.eenet.ee']
let queue = Promise.resolve()

/** Serialize background state changes across alarms, page loads, and notification clicks. */
function serialize(operation) {
  const task = queue.then(operation)
  queue = task.catch(() => {})
  return task
}

/** Read only the scheduler's encrypted state, treating invalid data as a cache miss. */
async function readState() {
  const stored = (await chrome.storage.local.get(KEY))[KEY]
  try { return stored ? JSON.parse(await cryptoService.decrypt(stored)) : {} } catch { return {} }
}

/** Persist timetable data encrypted using the extension's existing cache key. */
async function saveState(state) {
  await chrome.storage.local.set({ [KEY]: await cryptoService.encrypt(JSON.stringify(state)) })
}

/** Make a read-only authenticated request to an explicitly supported Tahvel origin. */
export async function lessonGet(origin, path, params = {}) {
  if (!ORIGINS.includes(origin)) throw new Error('Tundmatu Tahvli aadress')
  const url = new URL(`${origin}/hois_back${path}`)
  Object.entries(params).forEach(([key, value]) => { if (value != null) url.searchParams.set(key, String(value)) })
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Tahvli sessioon pole kättesaadav')
  return response.json()
}

/** Reconcile alarms with the latest successful timetable without replaying earlier lessons. */
async function reconcile(state) {
  const now = Date.now()
  const alarms = await chrome.alarms.getAll()
  const existing = new Set(alarms.map(a => a.name))
  const planned = new Map((state.blocks || []).filter(b => b.date === tallinnDate(now) && ((b.notificationAt ?? b.end) > now || existing.has(PREFIX + b.key)) && !state.sent?.[b.key])
    .map(b => [PREFIX + b.key, b]))
  for (const alarm of alarms) {
    if (alarm.name.startsWith(PREFIX) && !planned.has(alarm.name)) await chrome.alarms.clear(alarm.name)
  }
  for (const [name, block] of planned) {
    const alarm = await chrome.alarms.get(name)
    const when = block.notificationAt ?? block.end
    if (!alarm || alarm.scheduledTime !== when) await chrome.alarms.create(name, { when })
  }
  const tomorrow = new Date(`${tallinnDate(now)}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  await chrome.alarms.create(MIDNIGHT, { when: lessonTimestamp(tomorrow.toISOString().slice(0, 10), '00:00') })
}

/** Refresh today's timetable; an expired session retains only today's previous schedule. */
async function refresh(origin) {
  const state = await readState()
  origin ||= state.origin
  if (!ORIGINS.includes(origin)) return
  const date = tallinnDate()
  const sourceDate = timetableSourceDate(date)
  try {
    const user = await lessonGet(origin, '/user')
    const teacherId = user.teacherId ?? user.teacher
    const schoolId = user.school?.id
    if (!Number.isInteger(teacherId) || !schoolId) {
      await reconcile({ blocks: [] })
      await saveState({ origin, blocks: [], error: 'Logi Tahvlisse sisse õpetajana.' })
      return
    }
    const owner = `${origin}:${schoolId}:${teacherId}`
    if (state.owner !== owner) { state.blocks = []; state.sent = {}; state.testClock = null }
    // Record the identity before fetching the timetable, so a failed fetch after an
    // account switch cannot reuse another teacher's schedule.
    Object.assign(state, { origin, owner, schoolId, teacherId })
    const nextDate = new Date(`${sourceDate}T12:00:00Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const data = await lessonGet(origin, `/timetableevents/timetableByTeacher/${schoolId}`, {
      teachers: teacherId, from: new Date(lessonTimestamp(sourceDate, '00:00')).toISOString(),
      thru: new Date(lessonTimestamp(nextDate.toISOString().slice(0, 10), '00:00') - 1).toISOString(), lang: 'ET'
    })
    if (!Array.isArray(data?.timetableEvents)) throw new Error('Tunniplaani vastus on vigane')
    const timesResponse = await fetch(chrome.runtime.getURL('src/features/singleJournal/lessonDiscrepancies/LessonTimes.json'))
    const times = (await timesResponse.json())[schoolId] || []
    if (state.sourceDate !== sourceDate) {
      state.sent = {}
      await reconcile({ blocks: [] })
    }
    state.blocks = buildLessonBlocks(mapTimetableToDate(data.timetableEvents, sourceDate, date), times, date).map(block => ({ ...block, lessonTimes: times }))
    if (sourceDate !== date) {
      const testKey = `${date}:${sourceDate}`
      const savedOffset = state.testClock?.key === testKey ? state.testClock.offset : null
      const shifted = shiftTestNotifications(state.blocks, Date.now(), savedOffset)
      if (savedOffset == null && shifted.offset != null) state.sent = {}
      state.blocks = shifted.blocks
      state.testClock = { key: testKey, offset: shifted.offset }
    } else {
      state.testClock = null
    }
    state.sourceDate = sourceDate
    state.sent = Object.fromEntries(Object.entries(state.sent || {}).filter(([, sent]) => sent.date === date))
    state.updatedAt = Date.now()
    state.error = null
  } catch (error) {
    state.error = error.message
    state.blocks = (state.blocks || []).filter(b => b.date === date)
  }
  await saveState(state)
  await reconcile(state)
}

/** Display each scheduled block once, keeping enough state for a later click. */
async function notify(name) {
  const state = await readState()
  const block = state.blocks?.find(b => PREFIX + b.key === name)
  if (!block || state.sent?.[block.key] || block.date !== tallinnDate() || (block.notificationAt ?? block.end) > Date.now()) return
  if (await chrome.notifications.getPermissionLevel() !== 'granted') return
  await chrome.notifications.create(name, {
    type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
    title: `Tund lõppes: ${block.name} · ${block.groups.map(g => g.code).join(', ')}`,
    message: `${block.timeStart}–${block.timeEnd}. Klõpsa päeviku sissekande lisamiseks.`, requireInteraction: true
  })
  state.sent ||= {}
  state.sent[block.key] = block
  await saveState(state)
}

/** Install persistent alarm handlers; the 15-minute timer is not reset on worker wakes. */
export function registerLessonNotifications() {
  const run = task => task.catch(error => Logger.warning('Tunni märguanne:', error.message))
  chrome.alarms.get(REFRESH, alarm => { if (!alarm) chrome.alarms.create(REFRESH, { periodInMinutes: 15 }) })
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH || alarm.name === MIDNIGHT) run(serialize(() => refresh()))
    else if (alarm.name.startsWith(PREFIX)) run(serialize(() => notify(alarm.name)))
  })
  chrome.runtime.onStartup.addListener(() => run(serialize(() => refresh())))
  chrome.runtime.onInstalled.addListener(() => run(serialize(() => refresh())))
  chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith(PREFIX)) return
    run(serialize(async() => {
      const state = await readState()
      const block = state.sent?.[id.slice(PREFIX.length)]
      if (!block) return
      // Use a query parameter before the hash: Tahvel tests its route's suffix
      // to decide whether the journal is editable.
      await chrome.tabs.create({ url: `${state.origin}/?oa2Lesson=${encodeURIComponent(block.key)}#/journal/${block.journalId}/edit`, active: true })
      await chrome.notifications.clear(id)
    }))
  })
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    let origin
    try { origin = new URL(sender.url).origin } catch {}
    if (message.action === 'lessonNotificationStatus' && sender.id === chrome.runtime.id && !sender.tab) {
      serialize(async() => {
        const state = await readState()
        const future = (state.blocks || []).filter(b => (b.notificationAt ?? b.end) > Date.now() && !state.sent?.[b.key])
        return { updatedAt: state.updatedAt, error: state.error, sourceDate: state.sourceDate, testMode: state.sourceDate && state.sourceDate !== tallinnDate(), planned: future.length, nextAt: future[0]?.notificationAt ?? future[0]?.end }
      }).then(respond, () => respond({ error: 'Tunniplaani olekut ei saanud lugeda' }))
      return true
    }
    if (message.action === 'refreshLessonNotifications' && ORIGINS.includes(origin)) {
      run(serialize(() => refresh(origin)))
      return false
    }
    if (message.action === 'getLessonNotification' && ORIGINS.includes(origin)) {
      serialize(async() => {
        const state = await readState()
        const block = state.sent?.[message.key]
        if (state.origin !== origin || !block || block.date !== tallinnDate()) throw new Error('Salvestatud teavituse andmed puuduvad või teavitus on aegunud.')
        const user = await lessonGet(origin, '/user')
        if (`${origin}:${user.school?.id}:${user.teacherId ?? user.teacher}` !== state.owner) throw new Error('Logi Tahvlisse sisse teavituse saanud õpetaja kontoga.')
        return { ...block, schoolId: state.schoolId }
      }).then(block => respond({ block }), error => respond({ block: null, error: error.message }))
      return true
    }
    return false
  })
}
