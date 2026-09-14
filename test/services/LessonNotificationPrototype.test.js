import { test, expect } from 'bun:test'
import { JSDOM } from 'jsdom'
import { registerLessonNotificationPrototype, PROTOTYPE_ALARM, PROTOTYPE_URL } from '../../src/services/LessonNotificationPrototype.js'
import { openPrototypeEntryForm } from '../../src/services/PrototypeEntryForm.js'

test('prototype schedules once on request, displays notification, and opens only on click', async() => {
  const original = global.chrome
  const handlers = {}
  const calls = []
  global.chrome = {
    runtime: { id: 'test', getURL: path => path, onMessage: { addListener: fn => { handlers.message = fn } } },
    alarms: { create: async(...args) => calls.push(['alarm', ...args]), onAlarm: { addListener: fn => { handlers.alarm = fn } } },
    notifications: {
      getPermissionLevel: async() => 'granted',
      create: async(...args) => calls.push(['notification', ...args]),
      clear: async() => {},
      onClicked: { addListener: fn => { handlers.click = fn } }
    },
    tabs: { create: async options => calls.push(['tab', options]) }
  }
  try {
    registerLessonNotificationPrototype()
    expect(calls).toEqual([])
    expect(handlers.message({ action: 'scheduleLessonNotificationPrototype' }, { id: 'test', tab: {} }, () => {})).toBe(false)
    await new Promise(resolve => handlers.message({ action: 'scheduleLessonNotificationPrototype' }, { id: 'test' }, resolve))
    expect(calls[0]).toEqual(['alarm', PROTOTYPE_ALARM, { delayInMinutes: 1 }])
    handlers.alarm({ name: 'unrelated' })
    expect(calls).toHaveLength(1)
    handlers.alarm({ name: PROTOTYPE_ALARM })
    expect(calls[1][0]).toBe('notification')
    handlers.click('unrelated')
    expect(calls).toHaveLength(2)
    handlers.click(PROTOTYPE_ALARM)
    expect(calls[2]).toEqual(['tab', { url: PROTOTYPE_URL, active: true }])
    global.chrome.notifications.getPermissionLevel = async() => 'denied'
    const result = await new Promise(resolve => handlers.message({ action: 'scheduleLessonNotificationPrototype' }, { id: 'test' }, resolve))
    expect(result.success).toBe(false)
    expect(calls).toHaveLength(3)
  } finally { global.chrome = original }
})

test('marked journal opens native form once; ordinary journal stays untouched', () => {
  const originals = { window: global.window, document: global.document, setInterval: global.setInterval, clearInterval: global.clearInterval }
  const dom = new JSDOM('<button>Lisa sissekanne</button><button>Salvesta</button>', { url: PROTOTYPE_URL })
  let tick
  global.window = dom.window
  global.document = dom.window.document
  global.setInterval = fn => { tick = fn; return 1 }
  global.clearInterval = () => {}
  try {
    const button = document.querySelector('button')
    button.getClientRects = () => [{}]
    let clicks = 0
    button.addEventListener('click', () => clicks++)
    openPrototypeEntryForm()
    tick()
    expect(clicks).toBe(1)
    expect(window.location.href).not.toContain('oa2NewEntry')
    tick = undefined
    openPrototypeEntryForm()
    expect(tick).toBeUndefined()
  } finally {
    Object.assign(global, originals)
    dom.window.close()
  }
})
