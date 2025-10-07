import { mock } from 'bun:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const window = dom.window
const document = window.document

global.window = window
global.document = document
global.HTMLElement = window.HTMLElement
global.MutationObserver = window.MutationObserver

// Mock console for Logger service
global.console = {
  log: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  info: () => {},
  group: () => {},
  groupEnd: () => {},
  groupCollapsed: () => {},
  trace: () => {}
}

global.chrome = {
  storage: {
    sync: {
      get: mock((keys, callback) => {
        callback({})
      }),
      set: mock(),
      remove: mock()
    },
    local: {
      get: mock((keys, callback) => {
        callback({})
      }),
      set: mock(),
      remove: mock(),
      getBytesInUse: mock((keys, callback) => {
        callback(0)
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: mock()
    },
    sendMessage: mock(),
    getManifest: mock(() => ({}))
  }
}

// Export a function to restore the default chrome mock
export function restoreChromeMock() {
  global.chrome = {
    storage: {
      sync: {
        get: mock((keys, callback) => {
          callback({})
        }),
        set: mock(),
        remove: mock()
      },
      local: {
        get: mock((keys, callback) => {
          callback({})
        }),
        set: mock(),
        remove: mock(),
        getBytesInUse: mock((keys, callback) => {
          callback(0)
        })
      }
    },
    runtime: {
      onMessage: {
        addListener: mock()
      },
      sendMessage: mock(),
      getManifest: mock(() => ({}))
    }
  }
}

// Export a function to restore the default DOM
export function restoreGlobalDOM() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const window = dom.window
  const document = window.document

  global.window = window
  global.document = document
  global.HTMLElement = window.HTMLElement
  global.MutationObserver = window.MutationObserver

  // Restore console mock
  global.console = {
    log: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    info: () => {},
    group: () => {},
    groupEnd: () => {},
    groupCollapsed: () => {},
    trace: () => {}
  }
}
