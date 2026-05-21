/**
 * Background script
 */
import Logger from './services/Logger.js'
import { sentryService } from './services/SentryService.js'
import { isJournalMutation, extractJournalIdFromUrl } from './lib/journalEditDetector.js'

// Initialize Sentry for background context (no window event listeners)
sentryService.initBackground()

// Use both the Logger and regular console.log for extra visibility
Logger.info('Background script loaded')
console.log('📔 Background script loaded - ' + new Date().toISOString())

// Single source of truth for the Tahvel hosts: derived from manifest.json's
// content_scripts matches so adding a host (e.g. a future staging server)
// only requires updating the manifest, not this file.
//   TAHVEL_TAB_URLS — match patterns for chrome.tabs.query / webRequest tabs
//   TAHVEL_HOIS_URLS — same patterns narrowed to the /hois_back/ REST prefix
//   TAHVEL_HOSTNAMES — bare hostnames for substring checks on URL strings
const TAHVEL_TAB_URLS = chrome.runtime.getManifest().content_scripts[0].matches
const TAHVEL_HOIS_URLS = TAHVEL_TAB_URLS.map(pattern => pattern.replace(/\/\*$/, '/hois_back/*'))
const TAHVEL_HOSTNAMES = TAHVEL_TAB_URLS.map(pattern => pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, ''))

// Issue #95: observe Tahvel mutations via chrome.webRequest in the SW realm
// (outside the page), then message the originating tab so content.js can
// invalidate the journal cache. Page-realm fetch/XHR wraps would depend on
// document_start beating the page's AngularJS bootstrap and could be
// silently bypassed by any script that captured a fetch reference earlier.
//
// MV3 service workers terminate after idle and re-run this module on wake.
// chrome.webRequest.onCompleted.addListener does NOT dedupe by function
// reference, so an unguarded call would re-attach on each wake. Gate on a
// globalThis flag to ensure single registration per SW process.
//
// Wrapped in try/catch as a safety net only — webRequest is declared in
// manifest permissions so it's always available; the guard exists for the
// rare case where enterprise policy revokes the API at runtime, in which
// case the rest of the SW (Kriit proxy, cache alarm, Sentry, message
// routing) must keep working.
try {
  if (!globalThis.__oa2WebRequestRegistered && chrome?.webRequest?.onCompleted?.addListener) {
    chrome.webRequest.onCompleted.addListener(
      details => {
        if (!isJournalMutation(details)) return
        const journalId = extractJournalIdFromUrl(details.url)
        console.log(`[OA2] journal mutation detected: ${details.method} ${details.url} → ${details.statusCode} (journalId=${journalId})`)
        // tabId is -1 for requests not attributable to a tab (e.g. SW prefetch).
        if (typeof details.tabId !== 'number' || details.tabId < 0) return
        chrome.tabs.sendMessage(details.tabId, { action: 'journalEdited', journalId }).catch(() => {
          // Content script may not be loaded yet mid-navigation; next mutation retries.
        })
      },
      { urls: TAHVEL_HOIS_URLS }
    )
    globalThis.__oa2WebRequestRegistered = true
    console.log('[OA2] webRequest listener registered for Tahvel hosts')
  } else if (!chrome?.webRequest?.onCompleted?.addListener) {
    console.warn('[OA2] chrome.webRequest unavailable — journal mutation auto-refresh disabled')
  }
} catch (error) {
  console.error('[OA2] Failed to register webRequest listener:', error)
}

// On fresh install, seed the banner-dismissed key to the current version so
// first-time users don't see a "you updated" modal. Updates leave the key
// untouched — the content script's checkForUpdate() then sees a mismatch
// against the new manifest version and shows the modal on the next Tahvel
// page load. Key kept in sync with DISMISS_KEY in VersionCheckService.js.
function seedDismissKeyOnFreshInstall(details) {
  if (details?.reason === 'install') {
    chrome.storage.local.set({
      OA_updateBannerDismissed: chrome.runtime.getManifest().version
    }).catch(() => {})
  }
}
chrome.runtime.onInstalled.addListener(seedDismissKeyOnFreshInstall)

// --- Cache maintenance alarm ---
// Every 6 h: ask each open Tahvel tab to evict cache entries past their
// per-key TTL. The content script does the actual work because it runs in
// the tahvel.edu.ee origin where the Cache API lives.
const CACHE_ALARM_NAME = 'cache-maintenance'

// Throttle to one broadcast per minute so the new tabs.onActivated/onUpdated
// listeners don't trigger an eviction sweep on every Tahvel navigation.
// Persisted to chrome.storage.session so the throttle survives MV3 SW
// restarts (the SW dies after ~30s idle and re-runs the module body on
// next event, which would reset a module-scoped variable to 0).
const BROADCAST_MIN_INTERVAL_MS = 60 * 1000
const BROADCAST_TS_KEY = 'OA_lastBroadcast'

async function broadcastCacheMaintenance() {
  const now = Date.now()
  let last = 0
  try {
    const stored = await chrome.storage.session.get(BROADCAST_TS_KEY)
    last = stored?.[BROADCAST_TS_KEY] || 0
  } catch {
    // chrome.storage.session may be unavailable; fall through with last=0.
  }
  if (now - last < BROADCAST_MIN_INTERVAL_MS) return
  try {
    await chrome.storage.session.set({ [BROADCAST_TS_KEY]: now })
  } catch {
    // Cache maintenance can still run even if throttling timestamp persistence fails.
  }
  try {
    const tabs = await chrome.tabs.query({ url: TAHVEL_TAB_URLS })
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'cacheMaintenanceTick' }).catch(() => {
        // Tab may not have content script loaded yet, ignore
      })
    }
  } catch (error) {
    Logger.debug('Cache maintenance broadcast failed:', error.message)
  }
}

// Gate creation on alarms.get — alarms.create cancels-and-replaces, and the
// MV3 service worker re-runs this module body on every wake, so an unguarded
// create() would reset the 6 h timer indefinitely under continuous use.
chrome.alarms.get(CACHE_ALARM_NAME, existing => {
  if (!existing) {
    chrome.alarms.create(CACHE_ALARM_NAME, { periodInMinutes: 360 })
  }
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CACHE_ALARM_NAME) {
    broadcastCacheMaintenance()
  }
})

chrome.runtime.onInstalled.addListener(broadcastCacheMaintenance)
chrome.runtime.onStartup.addListener(broadcastCacheMaintenance)

// Also fire when a Tahvel tab becomes active or finishes loading so eviction
// runs promptly when the user returns to Tahvel after extended idle. No new
// permissions required (uses `tabs`).
function isTahvelTabUrl(url) {
  if (!url) return false
  return TAHVEL_HOSTNAMES.some(host => url.includes(host))
}

chrome.tabs.onActivated.addListener(async({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (isTahvelTabUrl(tab?.url)) broadcastCacheMaintenance()
  } catch {
    // Tab may have closed between activation and lookup; ignore.
  }
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isTahvelTabUrl(tab?.url)) {
    broadcastCacheMaintenance()
  }
})

// Set up listener for inter-process communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Logger.debug('Received message in background:', message)

  // Fan out crypto key rotation to all open Tahvel tabs so each content script
  // drops its in-memory key handle — otherwise tabs that didn't initiate the
  // rotation keep encrypting under the removed key.
  if (message.action === 'cryptoKeyRotated') {
    chrome.tabs.query({ url: TAHVEL_TAB_URLS }).then(tabs => {
      for (const tab of tabs) {
        if (tab.id === sender.tab?.id) continue
        chrome.tabs.sendMessage(tab.id, { action: 'cryptoKeyRotated' }).catch(() => {})
      }
    }).catch(() => {})
    // No response expected; do not return true so the channel closes.
    return false
  }

  // Handle Kriit API requests to bypass mixed content restrictions
  if (message.action === 'kriitApiRequest') {
    const { method, url, headers, body } = message

    Logger.debug(`Making ${method} request to ${url} from background script`)

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    if (method !== 'GET' && body) {
      requestOptions.body = JSON.stringify(body)
    }

    fetch(url, requestOptions)
      .then(async response => {
        const responseText = await response.text()

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${responseText}`)
        }

        // Try to parse as JSON, fall back to text
        try {
          const data = JSON.parse(responseText)
          sendResponse({ status: 'success', data })
        } catch (error) {
          sendResponse({ status: 'success', data: responseText })
        }
      })
      .catch(error => {
        Logger.error('Kriit API request failed:', error)
        sendResponse({ status: 'error', message: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle lesson times loading request
  if (message.action === 'loadLessonTimes') {
    const jsonUrl = chrome.runtime.getURL('src/features/singleJournal/lessonDiscrepancies/LessonTimes.json')

    fetch(jsonUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then(data => {
        Logger.debug('Lesson times loaded successfully:', data)
        sendResponse({ status: 'success', data })
      })
      .catch(error => {
        Logger.error('Error loading lesson times:', error)
        sendResponse({ status: 'error', error: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle Sentry event sending (content scripts can't fetch cross-origin due to page CSP)
  if (message.action === 'sentryEvent') {
    const { url, publicKey, envelope } = message

    // Validate URL is a Sentry ingest endpoint
    try {
      const parsed = new URL(url)
      if (!parsed.hostname.endsWith('.sentry.io')) {
        console.warn('[Background] Blocked Sentry event to non-Sentry host:', parsed.hostname)
        return
      }
    } catch {
      return
    }

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${publicKey}`
      },
      body: envelope
    }).catch(err => {
      console.warn('[Background] Failed to send Sentry event:', err.message)
    })

    // Fire-and-forget, no response needed
    return
  }
})
