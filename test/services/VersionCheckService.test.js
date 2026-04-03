import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'

describe('VersionCheckService', () => {
  let mockChrome
  let messageListeners
  let dom
  let versionCheckService
  let sentMessages

  beforeEach(async () => {
    // Setup DOM
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
    global.document = dom.window.document
    global.window = dom.window

    // Track message listeners and sent messages
    messageListeners = []
    sentMessages = []

    // Mock chrome API
    mockChrome = {
      runtime: {
        onMessage: {
          addListener: mock(fn => messageListeners.push(fn))
        },
        getURL: mock(path => `chrome-extension://abc123/${path}`),
        sendMessage: mock(msg => sentMessages.push(msg))
      },
      storage: {
        session: {
          get: mock(() => Promise.resolve({})),
          set: mock(() => Promise.resolve())
        }
      }
    }
    global.chrome = mockChrome

    // Import fresh instance
    const module = await import('../../src/services/VersionCheckService.js')
    versionCheckService = new module.default.constructor()
  })

  afterEach(() => {
    const modal = document.getElementById('oa2-update-modal')
    if (modal) modal.remove()

    delete global.chrome
    delete global.document
    delete global.window
  })

  describe('listenForUpdates', () => {
    test('should register a chrome.runtime.onMessage listener', () => {
      versionCheckService.listenForUpdates()

      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
      expect(messageListeners.length).toBe(1)
    })

    test('should show update when receiving updateAvailable message', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have either opened a tab or shown a modal
      const modal = document.getElementById('oa2-update-modal')
      const tabOpened = sentMessages.some(m => m.action === 'openTab')
      expect(modal !== null || tabOpened).toBe(true)
    })

    test('should ignore unrelated messages', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'someOtherAction' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).toBeNull()
      expect(sentMessages.filter(m => m.action === 'openTab').length).toBe(0)
    })
  })

  describe('dismiss persistence', () => {
    test('should persist version on dismiss', async () => {
      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(mockChrome.storage.session.set).toHaveBeenCalledWith({
        oa2_update_banner_dismissed: '0.2.0'
      })
    })

    test('should not show update if previously dismissed for same version', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.resolve({ oa2_update_banner_dismissed: '0.2.0' })
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(document.getElementById('oa2-update-modal')).toBeNull()
      expect(sentMessages.filter(m => m.action === 'openTab').length).toBe(0)
    })

    test('should show update for new version even if previous was dismissed', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.resolve({ oa2_update_banner_dismissed: '0.1.0' })
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const modal = document.getElementById('oa2-update-modal')
      const tabOpened = sentMessages.some(m => m.action === 'openTab')
      expect(modal !== null || tabOpened).toBe(true)
    })

    test('should show update if dismiss key is not set', async () => {
      mockChrome.storage.session.get = mock(() => Promise.resolve({}))

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const modal = document.getElementById('oa2-update-modal')
      const tabOpened = sentMessages.some(m => m.action === 'openTab')
      expect(modal !== null || tabOpened).toBe(true)
    })

    test('should show update if storage.session throws (graceful fallback)', async () => {
      mockChrome.storage.session.get = mock(() =>
        Promise.reject(new Error('storage.session not available'))
      )

      versionCheckService.listenForUpdates()
      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})

      await new Promise(resolve => setTimeout(resolve, 10))

      const modal = document.getElementById('oa2-update-modal')
      const tabOpened = sentMessages.some(m => m.action === 'openTab')
      expect(modal !== null || tabOpened).toBe(true)
    })

    test('should not show update twice', async () => {
      versionCheckService.listenForUpdates()

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      messageListeners[0]({ action: 'updateAvailable', version: '0.2.0' }, {}, () => {})
      await new Promise(resolve => setTimeout(resolve, 10))

      const modals = document.querySelectorAll('#oa2-update-modal')
      const tabsOpened = sentMessages.filter(m => m.action === 'openTab')
      // At most one of either type
      expect(modals.length + tabsOpened.length).toBeLessThanOrEqual(1)
    })
  })
})
