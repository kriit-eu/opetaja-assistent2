import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { extractOutcomeNumbersFromEntryName } from '../../../lib/extractOutcomeNumbersFromEntryName.js'

const STYLE_ID = 'oa2-attach-ov-style'
const SECTION_CLASS = 'oa2-attach-ov-section'
const SECTION_ATTR = 'data-oa2-attach-ov'
const FORM_FIELDS_SELECTOR = 'add-entry .form-flexible-fields, add-entry .not-final-grade-view .form-flexible-fields'

const STYLES = `
  .${SECTION_CLASS} {
    grid-column: 1 / -1;
    border: 1px solid #d9d9d6;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 4px 0;
    background: #fafbfc;
    font-family: Arial, sans-serif;
    color: #212529;
  }
  .${SECTION_CLASS} .oa2-attach-ov-title {
    font-size: 13px;
    color: #6c757d;
    line-height: 1.25;
    margin-bottom: 8px;
  }
  .${SECTION_CLASS} .oa2-attach-ov-title strong {
    display: block;
    color: #212529;
    font-size: 14px;
    font-weight: 600;
  }
  .${SECTION_CLASS} .oa2-attach-ov-empty {
    color: #6c757d;
    font-style: italic;
    font-size: 13px;
    padding: 4px 0;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 2px;
    border-top: 1px solid #f1f3f5;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row:first-of-type {
    border-top: none;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row label {
    flex: 1;
    cursor: pointer;
    line-height: 1.35;
    font-size: 13px;
  }
  .${SECTION_CLASS} .oa2-attach-ov-row input[type="checkbox"] {
    margin-top: 3px;
    cursor: pointer;
  }
  .${SECTION_CLASS} .oa2-attach-ov-tag {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: #1565c0;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
  }
`

const NATIVE_INPUT_VALUE_SETTER = (() => {
  if (typeof window === 'undefined' || !window.HTMLInputElement) return null
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  return desc && typeof desc.set === 'function' ? desc.set : null
})()

export default class AttachOvToSissekanneIFeature extends BaseFeature {
  constructor() {
    super('attachOvToSissekanneI', /#\/journal\/\d+\/edit/)
    this._bodyObserver = null
    this._cachedOvs = null
    this._cachedJournalId = null
    this._cachedOvsLoadedAt = 0
    this._activeSection = null
    this._activeNameInput = null
    this._activeNameInputListener = null
    this._inflightOvLoad = null
  }

  onActivate() {
    styleService.injectCSS(STYLES, STYLE_ID)
    this._installBodyObserver()
    // If the modal is already open at activation time, inject immediately.
    this._checkAndInject().catch(err => Logger.debug(`[${this.name}] Initial inject failed`, err))
  }

  onDeactivate() {
    if (this._bodyObserver) {
      this._bodyObserver.disconnect()
      this._bodyObserver = null
    }
    this._teardownActiveSection()
    document.querySelectorAll(`.${SECTION_CLASS}`).forEach(el => el.remove())
    styleService.removeCSS(STYLE_ID)
    super.onDeactivate()
  }

  extractJournalId() {
    const match = (typeof window !== 'undefined' ? window.location.href : '').match(/#\/journal\/(\d+)/)
    return match ? match[1] : null
  }

  async loadAvailableOvs(journalId, { force = false } = {}) {
    if (!force && this._cachedOvs && this._cachedJournalId === journalId && Date.now() - this._cachedOvsLoadedAt < 60_000) {
      return this._cachedOvs
    }
    if (this._inflightOvLoad && this._inflightOvLoad.journalId === journalId) {
      return this._inflightOvLoad.promise
    }
    const promise = this.api.tahvel
      .get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: false })
      .then(entries => {
        const list = Array.isArray(entries) ? entries : []
        const ovs = list
          .filter(e => e && e.entryType === 'SISSEKANNE_O' && typeof e.outcomeOrderNr === 'number')
          .map(e => ({ ovNum: String(e.outcomeOrderNr + 1), nameEt: e.nameEt || '' }))
          .sort((a, b) => Number(a.ovNum) - Number(b.ovNum))
        this._cachedOvs = ovs
        this._cachedJournalId = journalId
        this._cachedOvsLoadedAt = Date.now()
        return ovs
      })
      .finally(() => {
        this._inflightOvLoad = null
      })
    this._inflightOvLoad = { journalId, promise }
    return promise
  }

  buildNewNameEt(currentNameEt, selectedOvNums) {
    let base = currentNameEt || ''
    const parsed = extractOutcomeNumbersFromEntryName(base)
    if (parsed.length > 0) {
      base = base.replace(/\s*\(([^()]+)\)\s*$/, '').replace(/\s+$/, '')
    }
    const sorted = [...new Set(selectedOvNums.map(String))].sort((a, b) => Number(a) - Number(b))
    if (sorted.length === 0) return base
    const suffix = `(${sorted.map(n => `ÕV${n}`).join(', ')})`
    return base ? `${base} ${suffix}` : suffix
  }

  setInputValue(input, newValue) {
    if (!input) return
    if (NATIVE_INPUT_VALUE_SETTER) NATIVE_INPUT_VALUE_SETTER.call(input, newValue)
    else input.value = newValue
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  _installBodyObserver() {
    if (this._bodyObserver) return
    this._bodyObserver = new MutationObserver(() => {
      this._checkAndInject().catch(err => Logger.debug(`[${this.name}] Inject after mutation failed`, err))
    })
    this._bodyObserver.observe(document.body, { childList: true, subtree: true })
  }

  _findNameInput(formFieldsRoot) {
    const tahvelInputs = Array.from(formFieldsRoot.querySelectorAll('tahvel-input'))
    for (const ti of tahvelInputs) {
      const text = (ti.textContent || '').replace(/\s+/g, ' ').trim()
      if (text.includes('Sissekande nimetus')) {
        return ti.querySelector('input')
      }
    }
    // Fallback: the second tahvel-input in the form (first is the entry type select label area).
    if (tahvelInputs[0]) {
      return tahvelInputs[0].querySelector('input')
    }
    return null
  }

  async _checkAndInject() {
    const formFieldsRoot = document.querySelector(FORM_FIELDS_SELECTOR)
    if (!formFieldsRoot) {
      // Modal closed — clean up if we had an active section.
      if (this._activeSection && !document.body.contains(this._activeSection)) {
        this._teardownActiveSection()
      }
      return
    }
    if (formFieldsRoot.querySelector(`.${SECTION_CLASS}`)) return // already injected

    const nameInput = this._findNameInput(formFieldsRoot)
    if (!nameInput) return

    const journalId = this.extractJournalId()
    if (!journalId) return

    const availableOvs = await this.loadAvailableOvs(journalId)
    // Re-check after the async hop — the modal may have closed.
    if (!document.body.contains(formFieldsRoot)) return
    if (formFieldsRoot.querySelector(`.${SECTION_CLASS}`)) return

    this._injectSection(formFieldsRoot, nameInput, availableOvs)
  }

  _injectSection(formFieldsRoot, nameInput, availableOvs) {
    const section = document.createElement('div')
    section.className = SECTION_CLASS
    section.setAttribute(SECTION_ATTR, '1')

    const title = document.createElement('div')
    title.className = 'oa2-attach-ov-title'
    const titleStrong = document.createElement('strong')
    titleStrong.textContent = 'Õpiväljundid'
    title.appendChild(titleStrong)
    title.appendChild(document.createTextNode('Õpiväljund'))
    section.appendChild(title)

    if (availableOvs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'oa2-attach-ov-empty'
      empty.textContent = 'Selles päevikus pole ühtegi õpiväljundit (SISSEKANNE_O) leitud.'
      section.appendChild(empty)
    } else {
      const initialOvs = new Set(extractOutcomeNumbersFromEntryName(nameInput.value || ''))
      for (const ov of availableOvs) {
        const row = document.createElement('div')
        row.className = 'oa2-attach-ov-row'

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.id = `oa2-attach-ov-cb-${ov.ovNum}`
        checkbox.checked = initialOvs.has(ov.ovNum)
        checkbox.dataset.ovNum = ov.ovNum
        checkbox.addEventListener('change', () => this._onCheckboxChange(section, nameInput))

        const label = document.createElement('label')
        label.htmlFor = checkbox.id

        const tag = document.createElement('span')
        tag.className = 'oa2-attach-ov-tag'
        tag.textContent = `ÕV${ov.ovNum}`
        label.appendChild(tag)
        label.appendChild(document.createTextNode(ov.nameEt))

        row.appendChild(checkbox)
        row.appendChild(label)
        section.appendChild(row)
      }
    }

    // Insert right after the entry-name field so the picker reads naturally below it.
    const nameTahvelInput = nameInput.closest('tahvel-input') || nameInput.parentElement
    if (nameTahvelInput && nameTahvelInput.parentElement === formFieldsRoot) {
      nameTahvelInput.insertAdjacentElement('afterend', section)
    } else {
      formFieldsRoot.appendChild(section)
    }

    this._activeSection = section
    this._activeNameInput = nameInput

    // Keep checkboxes in sync if the teacher manually edits the name field.
    this._activeNameInputListener = () => this._syncCheckboxesFromName(section, nameInput)
    nameInput.addEventListener('input', this._activeNameInputListener)
  }

  _onCheckboxChange(section, nameInput) {
    const selected = Array.from(section.querySelectorAll('input[type="checkbox"]'))
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.ovNum)
    const newName = this.buildNewNameEt(nameInput.value || '', selected)
    if (newName !== nameInput.value) {
      this.setInputValue(nameInput, newName)
    }
  }

  _syncCheckboxesFromName(section, nameInput) {
    const ovs = new Set(extractOutcomeNumbersFromEntryName(nameInput.value || ''))
    section.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = ovs.has(cb.dataset.ovNum)
    })
  }

  _teardownActiveSection() {
    if (this._activeNameInput && this._activeNameInputListener) {
      this._activeNameInput.removeEventListener('input', this._activeNameInputListener)
    }
    this._activeSection = null
    this._activeNameInput = null
    this._activeNameInputListener = null
  }
}
