import { test, expect } from '@playwright/test'
import { launchWithExtension } from './helpers/loadExtension.js'
import { mockTahvel } from './helpers/mockTahvel.js'

const JOURNAL_ID = 404498
const JOURNAL_ROUTE = `/#/journal/${JOURNAL_ID}/edit`
const JOURNAL_URL = `https://tahvel.edu.ee${JOURNAL_ROUTE}`

test.describe('issue #95 webRequest → journalEdited message → cache invalidation → feature refresh', () => {
  let context
  let serviceWorker

  test.beforeEach(async() => {
    ({ context, serviceWorker } = await launchWithExtension())
  })

  test.afterEach(async() => {
    await context.close()
  })

  test('background SW dispatches journalEdited via chrome.tabs.sendMessage on a 2xx PUT to /hois_back/journals/<id>', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    // Instrument chrome.tabs.sendMessage in the SW to capture journalEdited
    // dispatches, then restore the original in finally{} so the next test
    // sharing this worker's SW starts clean.
    await serviceWorker.evaluate(() => {
      globalThis.__oa2CapturedSent = []
      globalThis.__oa2OriginalSend = chrome.tabs.sendMessage
      chrome.tabs.sendMessage = function(tabId, message, ...rest) {
        if (message && message.action === 'journalEdited') {
          globalThis.__oa2CapturedSent.push({ tabId, message })
        }
        return globalThis.__oa2OriginalSend.call(this, tabId, message, ...rest)
      }
    })

    try {
      // Trigger a 2xx PUT from the page. The fixture mock handler returns 200
      // for any /hois_back/* path, so this is observable from the SW's
      // webRequest listener even though no real backend exists.
      await page.evaluate(async journalId => {
        await fetch(`/hois_back/journals/${journalId}/journalEntry/999`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        })
      }, JOURNAL_ID)

      await expect.poll(
        () => serviceWorker.evaluate(() => globalThis.__oa2CapturedSent?.length || 0),
        { timeout: 5000 }
      ).toBeGreaterThan(0)

      const captured = await serviceWorker.evaluate(() => globalThis.__oa2CapturedSent)
      expect(captured[0].message).toEqual({ action: 'journalEdited', journalId: JOURNAL_ID })
    } finally {
      await serviceWorker.evaluate(() => {
        if (globalThis.__oa2OriginalSend) chrome.tabs.sendMessage = globalThis.__oa2OriginalSend
        delete globalThis.__oa2OriginalSend
        delete globalThis.__oa2CapturedSent
      })
    }
  })

  test('content.js handles journalEdited → clearJournalCache → dispatches oa2-journal-cache-cleared', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    // Wait for extension init (Extension.js installs the cache-cleared
    // listener during init).
    await expect(page.locator('#oa2-timetable-discrepancy-header-button')).toBeAttached({ timeout: 15000 })

    // Install a CustomEvent capture in the page BEFORE we trigger anything.
    // Stash captures on document (an Element, traversable from the SW via
    // CDP) so we can read them back later via page.evaluate.
    await page.evaluate(() => {
      window.__oa2CapturedEvents = []
      window.addEventListener('oa2-journal-cache-cleared', e => {
        window.__oa2CapturedEvents.push(e.detail)
      })
    })

    // The page lives in a Tahvel tab — query for that exact tab from the SW
    // and dispatch the runtime message. This exercises the same code path
    // the webRequest listener uses to reach the content script.
    await serviceWorker.evaluate(async journalId => {
      const tabs = await chrome.tabs.query({
        url: ['*://tahvel.edu.ee/*', '*://test.tahvel.eenet.ee/*']
      })
      for (const tab of tabs) {
        await chrome.tabs.sendMessage(tab.id, { action: 'journalEdited', journalId })
      }
    }, JOURNAL_ID)

    await expect.poll(
      () => page.evaluate(() => window.__oa2CapturedEvents?.length || 0),
      { timeout: 10000 }
    ).toBeGreaterThan(0)

    const captured = await page.evaluate(() => window.__oa2CapturedEvents)
    expect(captured[0]).toEqual({ journalId: JOURNAL_ID })
  })

  test('discrepancies table re-renders after a simulated journal mutation goes through the full chain', async() => {
    const page = await context.newPage()
    await mockTahvel(page, JOURNAL_ROUTE)
    await page.goto(JOURNAL_URL, { waitUntil: 'domcontentloaded' })

    const table = page.locator('[data-discrepancies-table]')
    await expect(table).toBeAttached({ timeout: 30000 })

    // Mark the current table so we can detect re-creation: the feature's
    // reset() removes the data-discrepancies-table element on reactivation,
    // so an element keyed by this stamp will be gone after the refresh.
    await page.evaluate(() => {
      const t = document.querySelector('[data-discrepancies-table]')
      if (t) t.setAttribute('data-oa2-test-stamp', 'before-mutation')
    })

    // Issue a real PUT from the page. webRequest in the SW will see the
    // response, decide it's a journal mutation, send 'journalEdited' to
    // this tab, content.js will clear cache and dispatch the event,
    // Extension.reactivateActiveFeatures will rebuild the table.
    await page.evaluate(async journalId => {
      await fetch(`/hois_back/journals/${journalId}/journalEntry/999`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
    }, JOURNAL_ID)

    // Stamp is on the old element; after reactivation a fresh element with
    // no stamp replaces it. Poll until the stamp disappears.
    await expect.poll(
      () => page.evaluate(() => {
        const t = document.querySelector('[data-discrepancies-table]')
        return t ? t.getAttribute('data-oa2-test-stamp') : 'missing'
      }),
      { timeout: 30000 }
    ).toBeNull()

    await expect(table).toBeAttached({ timeout: 30000 })
  })
})
