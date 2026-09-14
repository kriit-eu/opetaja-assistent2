import { test, expect } from 'bun:test'
import { registerLessonNotifications } from '../../src/services/LessonNotificationService.js'
import { cryptoService } from '../../src/services/CryptoService.js'
import { tallinnDate } from '../../src/services/LessonSchedule.js'

test('refresh reconciles cancellations, preserves schedule on session failure, and deduplicates notifications', async() => {
  const original = { chrome: global.chrome, fetch: global.fetch, encrypt: cryptoService.encrypt, decrypt: cryptoService.decrypt }
  const handlers = {}
  const alarms = new Map()
  let stored = {}
  let events = [{ id: 1, journalId: 8, date: tallinnDate(), timeStart: '23:00', timeEnd: '23:45', studentGroups: [] }]
  let expired = false
  let notifications = 0
  cryptoService.encrypt = async text => ({ ct: text })
  cryptoService.decrypt = async blob => blob.ct
  global.fetch = async url => {
    if (String(url).includes('LessonTimes')) return Response.json({})
    if (expired) return new Response('', { status: 401 })
    return Response.json(String(url).includes('/user') ? { teacher: 10, school: { id: 9 } } : { timetableEvents: events })
  }
  global.chrome = {
    runtime: { id: 'test', getURL: p => p, onInstalled: { addListener: () => {} }, onStartup: { addListener: fn => { handlers.start = fn } }, onMessage: { addListener: fn => { handlers.message = fn } } },
    storage: { local: { get: async() => stored, set: async value => { stored = { ...stored, ...value } } } },
    alarms: {
      get: (name, cb) => cb ? cb(alarms.get(name)) : Promise.resolve(alarms.get(name)),
      getAll: async() => [...alarms.values()], clear: async name => alarms.delete(name),
      create: async(name, options) => alarms.set(name, { name, scheduledTime: options.when, ...options }),
      onAlarm: { addListener: fn => { handlers.alarm = fn } }
    },
    notifications: { getPermissionLevel: async() => 'granted', create: async() => { notifications++ }, onClicked: { addListener: fn => { handlers.click = fn } } }
  }
  const message = (action, fields = {}) => new Promise(resolve => handlers.message({ action, ...fields }, { id: 'test' }, resolve))
  const refresh = async() => {
    handlers.message({ action: 'refreshLessonNotifications' }, { url: 'https://tahvel.edu.ee/' }, () => {})
    await message('lessonNotificationStatus')
  }
  try {
    registerLessonNotifications()
    await refresh()
    let state = JSON.parse(stored.OA_lessonNotifications.ct)
    expect(state.blocks).toHaveLength(1)
    expired = true
    await refresh()
    expect(JSON.parse(stored.OA_lessonNotifications.ct).blocks).toHaveLength(1)
    expired = false
    events = []
    await refresh()
    expect([...alarms.keys()].filter(k => k.startsWith('oa2-lesson:'))).toEqual([])
    state.blocks[0].end = Date.now() - 1000
    stored.OA_lessonNotifications = { ct: JSON.stringify(state) }
    handlers.alarm({ name: 'oa2-lesson:' + state.blocks[0].key })
    await message('lessonNotificationStatus')
    handlers.alarm({ name: 'oa2-lesson:' + state.blocks[0].key })
    await message('lessonNotificationStatus')
    expect(notifications).toBe(1)
  } finally {
    global.chrome = original.chrome
    global.fetch = original.fetch
    cryptoService.encrypt = original.encrypt
    cryptoService.decrypt = original.decrypt
  }
})
