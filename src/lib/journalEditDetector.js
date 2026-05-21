/**
 * Pure helpers used by the background service worker to decide whether an
 * observed Tahvel network response represents a journal mutation that should
 * invalidate cached GETs for that journal.
 *
 * Lives in src/lib so unit tests can import it without pulling in the SW
 * runtime. Background calls these from the `chrome.webRequest.onCompleted`
 * listener.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Anchor on /hois_back/ so we never match the SPA's own /#/journal/... hash
// route by accident. The hois_back prefix is the Tahvel REST API.
const JOURNAL_PATH_RE = /\/hois_back\/journals\/(\d+)(?:\/|$|\?)/

export function isMutatingMethod(method) {
  return MUTATING_METHODS.has(method?.toUpperCase?.())
}

export function extractJournalIdFromUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  const match = url.match(JOURNAL_PATH_RE)
  return match ? parseInt(match[1], 10) : null
}

export function isJournalMutation({ method, url, statusCode } = {}) {
  if (!isMutatingMethod(method)) return false
  if (typeof statusCode !== 'number' || statusCode < 200 || statusCode >= 300) return false
  return extractJournalIdFromUrl(url) !== null
}
