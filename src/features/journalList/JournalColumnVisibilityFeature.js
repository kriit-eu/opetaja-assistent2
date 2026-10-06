import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

const STORAGE_KEY = 'OA_journalListHiddenColumns'

/** Local, persistent column preferences for the journal list. */
export default class JournalColumnVisibilityFeature extends BaseFeature {
  constructor() {
    super('journalColumnVisibility', /#\/journals(?:[/?]|$)/)
    this.hiddenColumns = new Set()
    this.generation = 0
    this.outsideClick = event => {
      if (!this.toolbar?.contains(event.target)) this.setOpen(false)
    }
    this.escapeKey = event => {
      if (event.key === 'Escape' && this.menu && !this.menu.hidden) {
        this.setOpen(false)
        this.button.focus()
      }
    }
  }

  /** Load preferences before watching asynchronously rendered tables. */
  async onActivate() {
    const generation = ++this.generation
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get([STORAGE_KEY], values => {
          if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message))
          else resolve(values)
        })
      })
      if (generation !== this.generation) return
      this.hiddenColumns = new Set(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].filter(key => typeof key === 'string') : [])
    } catch (error) {
      Logger.error('[JournalColumnVisibility] Could not load preferences:', error)
    }
    if (generation !== this.generation) return
    this.style = document.createElement('style')
    document.head.appendChild(this.style)
    document.addEventListener('click', this.outsideClick)
    document.addEventListener('keydown', this.escapeKey)
    this.observer = new MutationObserver(() => {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = setTimeout(() => this.refresh(), 50)
    })
    this.refresh()
  }

  /** Find the list table again after filtering, pagination, or Angular rendering. */
  refresh() {
    this.observer?.disconnect()
    const table = document.querySelector('#tahvelTable table.tahvel-table')
    const headers = table ? Array.from(table.querySelectorAll('thead tr:first-child th')) : []
    const columns = headers.map((header, index) => {
      const label = header.textContent.replace(/\s+/g, ' ').trim()
      const key = header.getAttribute('md-order-by') || header.querySelector('[translate]')?.getAttribute('translate') || label.toLowerCase()
      const locked = /^(päevik|journal)$/i.test(label) || !!table.querySelector(`tbody tr td:nth-child(${index + 1}) a[href*="/journal/"]`)
      return { key, label, index, locked }
    })
    const signature = JSON.stringify(columns)
    if (table !== this.table || signature !== this.signature || !this.toolbar?.isConnected) {
      this.table?.classList.remove('oa2-column-table')
      this.toolbar?.remove()
      this.table = table
      this.columns = columns
      this.signature = signature
      if (table && columns.length) {
        table.classList.add('oa2-column-table')
        this.createMenu()
      }
    }
    this.applyVisibility()
    this.observer?.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  /** Create a compact, keyboard-accessible dropdown above the table. */
  createMenu() {
    this.toolbar = document.createElement('div')
    this.toolbar.className = 'oa2-column-toolbar'
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'oa2-column-toggle'
    this.button.textContent = '☰'
    this.button.title = 'Vali nähtavad tulbad'
    this.button.setAttribute('aria-label', 'Vali nähtavad tulbad')
    this.button.setAttribute('aria-expanded', 'false')
    this.button.setAttribute('aria-controls', 'oa2-column-menu')
    this.menu = document.createElement('div')
    this.menu.id = 'oa2-column-menu'
    this.menu.className = 'oa2-column-menu'
    this.menu.hidden = true
    const title = document.createElement('strong')
    title.textContent = 'Nähtavad tulbad'
    this.menu.appendChild(title)
    for (const column of this.columns) {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = column.locked || !this.hiddenColumns.has(column.key)
      input.disabled = column.locked
      input.addEventListener('change', () => {
        if (input.checked) this.hiddenColumns.delete(column.key)
        else this.hiddenColumns.add(column.key)
        this.applyVisibility()
        this.savePreferences()
      })
      label.append(input, document.createTextNode(column.label))
      if (column.locked) label.title = 'Päeviku nimi jääb alati nähtavaks'
      this.menu.appendChild(label)
    }
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.textContent = 'Taasta kõik tulbad'
    reset.addEventListener('click', () => {
      this.hiddenColumns.clear()
      this.menu.querySelectorAll('input').forEach(input => { input.checked = true })
      this.applyVisibility()
      this.savePreferences()
    })
    this.menu.appendChild(reset)
    this.button.addEventListener('click', () => this.setOpen(this.menu.hidden))
    this.toolbar.append(this.button, this.menu)
    this.table.before(this.toolbar)
  }

  /** Toggle the dropdown without stealing checkbox focus.
   * @param {boolean} open Whether the dropdown should be visible.
   */
  setOpen(open) {
    if (!this.menu) return
    this.menu.hidden = !open
    this.button.setAttribute('aria-expanded', String(open))
  }

  /** CSS hides cells without removing data needed by other features. */
  applyVisibility() {
    if (!this.style) return
    const selectors = (this.columns || [])
      .filter(column => !column.locked && this.hiddenColumns.has(column.key))
      .flatMap(column => ['th', 'td'].map(tag => `.oa2-column-table > ${tag === 'th' ? 'thead' : 'tbody'} > tr > ${tag}:nth-child(${column.index + 1}):not([colspan])`))
    const css = `
      .oa2-column-toolbar { position: relative; display: flex; justify-content: flex-end; margin: 4px 0; }
      .oa2-column-toggle { background: transparent; border: 0; border-radius: 4px; color: #315b9c; font-size: 22px; width: 36px; height: 36px; cursor: pointer; }
      .oa2-column-toggle:hover { background: #edf2f8; }
      .oa2-column-menu { position: absolute; right: 0; top: 40px; z-index: 100; background: white; color: #333; border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 4px 16px #0002; padding: 12px; min-width: 250px; max-width: min(360px, 90vw); max-height: 65vh; overflow: auto; text-align: left; }
      .oa2-column-menu[hidden] { display: none; }
      .oa2-column-menu strong { display: block; margin-bottom: 8px; }
      .oa2-column-menu label { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; font-weight: normal; }
      .oa2-column-menu input { margin: 0; accent-color: #315b9c; }
      .oa2-column-menu button { background: transparent; border: 0; border-top: 1px solid #eee; color: #315b9c; padding: 10px 0 0; margin-top: 8px; width: 100%; text-align: left; cursor: pointer; }
      ${selectors.length ? `${selectors.join(',')} { display: none !important; }` : ''}
    `
    if (this.style.textContent !== css) this.style.textContent = css
  }

  /** Persist stable column keys, not column positions or journal data. */
  savePreferences() {
    chrome.storage.local.set({ [STORAGE_KEY]: [...this.hiddenColumns] }, () => {
      if (chrome.runtime?.lastError) Logger.error('[JournalColumnVisibility] Could not save preferences:', chrome.runtime.lastError.message)
    })
  }

  /** Restore the original table and release all listeners on navigation. */
  onDeactivate() {
    ++this.generation
    clearTimeout(this.refreshTimer)
    this.observer?.disconnect()
    document.removeEventListener('click', this.outsideClick)
    document.removeEventListener('keydown', this.escapeKey)
    this.toolbar?.remove()
    this.style?.remove()
    this.table?.classList.remove('oa2-column-table')
    this.table = null
    this.signature = null
    super.onDeactivate()
  }
}
