/**
 * Subscribe to journal-cache-cleared events.
 *
 * src/content.js dispatches `oa2-journal-cache-cleared` on `window` after
 * the background SW (via chrome.webRequest) sees a Tahvel mutation and
 * cacheService.clearJournalCache() finishes. Features that depend on
 * journal-scoped cached data subscribe here to refresh in place when their
 * journal changes.
 *
 * Usage:
 *
 *   // In feature.activate()
 *   this._unsubCacheCleared = onJournalCacheCleared(journalId => {
 *     if (journalId !== this.currentJournalId) return
 *     this.refreshTable()
 *   })
 *
 *   // In feature.onDeactivate()
 *   this._unsubCacheCleared?.()
 *   this._unsubCacheCleared = null
 *
 * The handler receives the journalId so each feature decides whether the
 * event is relevant to it. The returned function MUST be called on
 * deactivate to avoid leaking listeners across feature lifecycles.
 *
 * @param {(journalId: number|null) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function onJournalCacheCleared(handler) {
  // Defensive: some unit tests stub `window` with a minimal object that has
  // no addEventListener. Treat that as a no-op subscription so tests of
  // unrelated feature logic don't blow up just because they imported a
  // module that ends up importing this helper. In real production
  // (content script realm) window always has addEventListener.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  const listener = event => {
    handler(event?.detail?.journalId ?? null)
  }
  window.addEventListener('oa2-journal-cache-cleared', listener)
  return () => window.removeEventListener('oa2-journal-cache-cleared', listener)
}
