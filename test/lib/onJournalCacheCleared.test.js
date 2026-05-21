import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { onJournalCacheCleared } from '../../src/lib/onJournalCacheCleared.js'
import { restoreGlobalDOM } from '../setup.js'

describe('onJournalCacheCleared', () => {
  beforeEach(() => {
    // Other feature tests in this run stub `global.window` with a minimal
    // object (no addEventListener), which causes our helper's defensive
    // path to return a no-op. Restore the JSDOM window so dispatchEvent
    // actually drives the listener we register in this test.
    restoreGlobalDOM()
  })

  it('invokes the handler with the journalId from the event detail', () => {
    const handler = mock(() => {})
    const unsub = onJournalCacheCleared(handler)
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared', { detail: { journalId: 426365 } }))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(426365)
    unsub()
  })

  it('passes null when the event has no detail.journalId', () => {
    const handler = mock(() => {})
    const unsub = onJournalCacheCleared(handler)
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared', { detail: {} }))
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared'))
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, null)
    expect(handler).toHaveBeenNthCalledWith(2, null)
    unsub()
  })

  it('returns a function that removes the listener', () => {
    const handler = mock(() => {})
    const unsub = onJournalCacheCleared(handler)
    unsub()
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared', { detail: { journalId: 1 } }))
    expect(handler).toHaveBeenCalledTimes(0)
  })

  it('supports multiple independent subscribers', () => {
    const a = mock(() => {})
    const b = mock(() => {})
    const unsubA = onJournalCacheCleared(a)
    const unsubB = onJournalCacheCleared(b)
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared', { detail: { journalId: 7 } }))
    expect(a).toHaveBeenCalledWith(7)
    expect(b).toHaveBeenCalledWith(7)
    unsubA()
    window.dispatchEvent(new CustomEvent('oa2-journal-cache-cleared', { detail: { journalId: 8 } }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenLastCalledWith(8)
    unsubB()
  })

  it('calling unsubscribe twice is safe', () => {
    const handler = mock(() => {})
    const unsub = onJournalCacheCleared(handler)
    unsub()
    expect(() => unsub()).not.toThrow()
  })
})
