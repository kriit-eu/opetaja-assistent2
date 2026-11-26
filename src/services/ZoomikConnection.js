import { zoomikRead } from './ZoomikRead.js'

const KEY = 'OA_zoomikBridge'
const ALARM = 'zoomik-reconnect'
let socket = null

/** Connect only to a user-configured Zoomik service on this computer. */
export async function connectZoomik() {
  const config = (await chrome.storage.local.get(KEY))[KEY]
  if (!config?.enabled || !/^[a-f0-9]{64}$/.test(config.token || '') || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const current = new WebSocket(`ws://127.0.0.1:${config.port}/internal/tahvel/socket`)
  socket = current
  current.onopen = () => current.send(JSON.stringify({ token: config.token }))
  current.onmessage = async event => {
    let message
    try { message = JSON.parse(event.data) } catch { current.close(); return }
    if (message.type !== 'read') return
    try {
      const data = await zoomikRead(message.request)
      if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'result', data }))
    } catch (error) {
      if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'result', error: error.message }))
    }
  }
  current.onclose = () => { if (socket === current) socket = null }
  current.onerror = () => current.close()
}

/** Start the opt-in connection and retry it after service-worker restarts. */
export function registerZoomikConnection() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void connectZoomik().catch(() => {}) })
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return
    if (socket) { const old = socket; socket = null; old.close() }
    void connectZoomik().catch(() => {})
  })
  void connectZoomik().catch(() => {})
}
