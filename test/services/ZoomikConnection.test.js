import { afterEach, expect, test } from 'bun:test'
import { connectZoomik } from '../../src/services/ZoomikConnection.js'

const originalChrome = globalThis.chrome
const OriginalWebSocket = globalThis.WebSocket
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.chrome = originalChrome
  globalThis.WebSocket = OriginalWebSocket
  globalThis.fetch = originalFetch
})

test('connects locally and returns a Tahvel read result', async() => {
  let connection
  class FakeSocket {
    static OPEN = 1
    static CONNECTING = 0
    readyState = 1
    sent = []
    constructor(url) { this.url = url; connection = this }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.readyState = 3; this.onclose?.() }
  }
  globalThis.WebSocket = FakeSocket
  globalThis.chrome = { storage: { local: { get: async() => ({ OA_zoomikBridge: { enabled: true, port: 8000, token: 'a'.repeat(64) } }) } } }
  globalThis.fetch = async(url, options) => {
    expect(String(url)).toBe('https://tahvel.edu.ee/hois_back/user')
    expect(options.credentials).toBe('include')
    return new Response(JSON.stringify({ teacherId: 7 }), { headers: { 'content-type': 'application/json' } })
  }
  await connectZoomik()
  expect(connection.url).toBe('ws://127.0.0.1:8000/internal/tahvel/socket')
  connection.onopen()
  expect(connection.sent[0]).toEqual({ token: 'a'.repeat(64) })
  await connection.onmessage({ data: JSON.stringify({ type: 'read', request: { operation: 'user' } }) })
  expect(connection.sent[1]).toEqual({ type: 'result', data: { teacherId: 7 } })
  connection.close()
})
