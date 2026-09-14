/** Open the native add-entry form only for the explicit prototype URL. */
export function openPrototypeEntryForm() {
  const target = '#/journal/433792/edit'
  if (window.location.hash.split('?')[0] !== target ||
      new URLSearchParams(window.location.search).get('oa2NewEntry') !== '1') return

  const started = Date.now()
  const timer = setInterval(() => {
    if (window.location.hash.split('?')[0] !== target || Date.now() - started > 60000) {
      clearInterval(timer)
      return
    }
    const button = [...document.querySelectorAll('button,md-button,[role="button"]')].find(element =>
      /lisa\s+(uus\s+)?sissekanne/i.test(element.textContent || element.getAttribute('aria-label') || '') &&
      !element.closest('[data-discrepancies-table]') &&
      !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
      element.getClientRects().length > 0
    )
    if (!button) return
    clearInterval(timer)
    // Consume the marker so refreshing cannot open the form again.
    const url = new URL(window.location.href)
    url.searchParams.delete('oa2NewEntry')
    window.history.replaceState(window.history.state, '', url)
    button.click()
  }, 250)
}
