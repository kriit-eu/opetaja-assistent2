import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

const STORAGE_KEY = 'OA_workloadFilters'
const LEGACY_KEY = 'henno-koormus-filters-v1'

/** Check stored filter values before using them in the controls.
 * @param {object} value Stored preferences.
 * @returns {boolean} Whether both filters are strings.
 */
function validFilters(value) {
  return value && typeof value.group === 'string' && typeof value.subject === 'string'
}

/** Check numeric cell text without treating labels or dates as numbers.
 * @param {string} value Cell text without whitespace.
 * @returns {boolean} Whether the cell must be highlighted.
 */
function highlightNumber(value) {
  if (value === '0') return false
  const unsigned = /^[+-]/.test(value) ? value.slice(1) : value
  const parts = unsigned.split(/[.,]/)
  return parts.length <= 2 && parts.every(part => /^\d+$/.test(part))
}

/** Filter planned workloads without changing the source data. */
export default class WorkloadFiltersFeature extends BaseFeature {
  constructor() {
    super('WorkloadFiltersFeature', /#\/lessonplans\/vocational\/byteacher(?:[/?]|$)/)
    this.generation = 0
  }

  /** Load saved filters, then watch the table for changes. */
  async onActivate() {
    const generation = ++this.generation
    this.cleanup?.()
    let filters = { group: '', subject: '' }
    try {
      const stored = await new Promise((resolve, reject) => {
        chrome.storage.local.get([STORAGE_KEY], values => {
          if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message))
          else resolve(values)
        })
      })
      if (generation !== this.generation) return
      if (validFilters(stored[STORAGE_KEY])) {
        filters = stored[STORAGE_KEY]
      } else if (stored[STORAGE_KEY] === undefined) {
        const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY))
        if (validFilters(legacy)) {
          filters = { group: legacy.group, subject: legacy.subject }
          this.saveFilters(filters)
        }
      }
    } catch (error) {
      Logger.error('[WorkloadFilters] Could not load filters:', error)
    }
    if (generation !== this.generation) return
    this.cleanup = mountFilters(filters, values => this.saveFilters(values))
  }

  /** Save the two filter values in extension storage.
   * @param {{group: string, subject: string}} filters Current filters.
   */
  saveFilters(filters) {
    chrome.storage.local.set({ [STORAGE_KEY]: filters }, () => {
      if (chrome.runtime?.lastError) Logger.error('[WorkloadFilters] Could not save filters:', chrome.runtime.lastError.message)
    })
  }

  /** Restore table visibility and stop pending work when leaving the page. */
  onDeactivate() {
    ++this.generation
    this.cleanup?.()
    this.cleanup = null
    super.onDeactivate()
  }
}

/** Mount the controls and return their cleanup function.
 * @param {{group: string, subject: string}} filters Initial filters.
 * @param {Function} persist Save changed filters.
 * @returns {Function} Remove controls, styles, and observers.
 */
function mountFilters(filters, persist) {
  const prefix = 'oa2-workload'
  const normalize = value => value.trim().toLocaleLowerCase('et')
  const text = element => element?.textContent.trim() || ''
  let panel
  let table
  let refreshTimer
  let stopped = false
  let groupInput
  let subjectInput
  let count
  const style = document.createElement('style')
  style.textContent = `
    .${prefix}-hidden { display: none !important; }
    table.tahvel-table .${prefix}-number { background: #fff59d !important; color: #171717 !important; }
    #${prefix} { margin: 12px 0; padding: 14px 16px; border: 1px solid #bbc9d2;
      border-radius: 6px; background: #f4f8fa; display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
    #${prefix} label { display: flex; flex-direction: column; gap: 5px; font-weight: 600; }
    #${prefix} input { padding: 8px 10px; border: 1px solid #788995; border-radius: 4px;
      background: white; color: #171717; font: inherit; width: 240px; max-width: 65vw; }
    #${prefix} button { padding: 9px 14px; cursor: pointer; }
    #${prefix} .status { flex-basis: 100%; font-size: 14px; }
  `
  document.head.append(style)

  /** Create controls above the table.
   * @param {HTMLTableElement} target Workload table.
   */
  function createPanel(target) {
    panel = document.createElement('section')
    panel.id = prefix
    panel.setAttribute('aria-label', 'Koormuse filtrid')
    function addInput(labelText, name, placeholder) {
      const label = document.createElement('label')
      label.textContent = labelText
      const input = document.createElement('input')
      input.type = 'search'
      input.placeholder = placeholder
      input.setAttribute('list', `${prefix}-${name}`)
      const list = document.createElement('datalist')
      list.id = `${prefix}-${name}`
      label.append(input, list)
      panel.append(label)
      input.addEventListener('input', saveFilters)
      return input
    }
    groupInput = addInput('Grupp', 'groups', 'Kõik grupid')
    subjectInput = addInput('Aine', 'subjects', 'Kõik ained')
    groupInput.value = filters.group
    subjectInput.value = filters.subject
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.textContent = 'Tühjenda filtrid'
    clear.addEventListener('click', () => {
      groupInput.value = ''
      subjectInput.value = ''
      saveFilters()
    })
    count = document.createElement('div')
    count.className = 'status'
    count.setAttribute('role', 'status')
    panel.append(clear, count)
    target.parentElement.before(panel)
  }

  /** Save the current values and apply both filters. */
  function saveFilters() {
    filters = { group: groupInput.value, subject: subjectInput.value }
    try {
      persist(filters)
    } catch (error) {
      Logger.error('[WorkloadFilters] Could not save filters:', error)
    }
    refresh()
  }

  /** Update suggestions only when the table values change.
   * @param {string} name Filter name.
   * @param {string[]} values Available names.
   */
  function updateOptions(name, values) {
    const list = panel.querySelector(`#${prefix}-${name}`)
    const sorted = [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'et'))
    if (JSON.stringify([...list.options].map(option => option.value)) === JSON.stringify(sorted)) return
    list.replaceChildren(
      ...sorted.map(value => {
        const option = document.createElement('option')
        option.value = value
        return option
      })
    )
  }

  /** Apply filters to complete row blocks after table changes. */
  function refresh() {
    if (stopped) return
    observer.disconnect()
    try {
      table = [...document.querySelectorAll('table.tahvel-table')].find(item => item.querySelector('.journal-items'))
      if (!table) {
        panel?.remove()
        panel = null
        return
      }
      if (!panel?.isConnected || !table.parentElement.parentElement?.contains(panel)) {
        panel?.remove()
        createPanel(table)
      }
      const groupQuery = normalize(groupInput.value)
      const subjectQuery = normalize(subjectInput.value)
      const sections = []
      let section
      let block
      for (const body of table.tBodies) {
        for (const row of body.rows) {
          if (row.cells[0]?.colSpan === 4 && row.cells[0].querySelector('.bold')) {
            section = { header: row, subject: text(row.cells[0]), blocks: [] }
            sections.push(section)
            block = null
            continue
          }
          if (!section) continue
          const groupCell = row.querySelector('.journal-items')
          if (groupCell) {
            const groups = [...groupCell.querySelectorAll('.journal-column')].map(column => text(column.querySelector('.items'))).join(', ')
            block = { groups, rows: [] }
            section.blocks.push(block)
          }
          if (block) block.rows.push(row)
        }
      }
      let visible = 0
      let total = 0
      for (const item of sections) {
        let showHeader = false
        for (const entry of item.blocks) {
          total++
          const show = normalize(item.subject).includes(subjectQuery) && normalize(entry.groups).includes(groupQuery)
          if (show) visible++
          showHeader ||= show
          entry.rows.forEach(row => row.classList.toggle(`${prefix}-hidden`, !show))
        }
        item.header.classList.toggle(`${prefix}-hidden`, !showHeader)
      }
      for (const cell of table.querySelectorAll('tbody td, tbody th, tfoot td, tfoot th')) {
        const value = text(cell).replace(/\s/g, '')
        cell.classList.toggle(`${prefix}-number`, highlightNumber(value))
      }
      const filtered = Boolean(groupQuery || subjectQuery)
      table.tFoot?.classList.toggle(`${prefix}-hidden`, filtered)
      const message =
        `Näitan ${visible} / ${total} aine ja grupi kirjet. ` +
        (filtered ? 'Filtrid kehtivad koos. Üldsumma on filtreerimise ajal peidetud.' : 'Otsi nime või nimeosa järgi.')
      if (count.textContent !== message) count.textContent = message
      updateOptions(
        'groups',
        sections.flatMap(item => item.blocks.map(entry => entry.groups))
      )
      updateOptions(
        'subjects',
        sections.map(item => item.subject)
      )
    } finally {
      if (!stopped) observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    }
  }

  /** Combine nearby DOM changes into one update. */
  function schedule() {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(refresh, 50)
  }
  const observer = new MutationObserver(schedule)
  refresh()
  return () => {
    stopped = true
    clearTimeout(refreshTimer)
    observer.disconnect()
    panel?.remove()
    style.remove()
    document.querySelectorAll(`.${prefix}-hidden, .${prefix}-number`).forEach(element => {
      element.classList.remove(`${prefix}-hidden`, `${prefix}-number`)
    })
  }
}
