import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import AttachOvToSissekanneIFeature from '../../../../src/features/singleJournal/attachOvToSissekanneI/AttachOvToSissekanneIFeature.js'

function setupDom(url = 'https://test.tahvel.eenet.ee/#/journal/426365/edit') {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url })
  global.window = dom.window
  global.document = dom.window.document
  global.MutationObserver = dom.window.MutationObserver
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  return dom
}

function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag)
  if (opts.className) e.className = opts.className
  if (opts.text) e.appendChild(document.createTextNode(opts.text))
  if (opts.value != null) e.value = opts.value
  if (opts.type) e.type = opts.type
  for (const c of children) e.appendChild(c)
  return e
}

function mountModal({ entryName = '' } = {}) {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  const formFields = el('div', { className: 'form-flexible-fields' }, [
    el('tahvel-select', { className: 'ng-untouched ng-pristine ng-invalid' }, [
      el('span', { text: 'Sissekande liik *' })
    ]),
    el('tahvel-input', { className: 'ng-untouched ng-pristine ng-valid' }, [
      el('span', { text: 'Sissekande nimetus' }),
      el('input', { type: 'text', value: entryName })
    ]),
    el('checkbox', { className: 'centered ng-untouched ng-pristine ng-valid' }, [
      el('span', { text: 'Teavita õppijat - märgitakse sisu lahtri info' })
    ])
  ])
  const notFinalGradeView = el('div', { className: 'not-final-grade-view ng-star-inserted' }, [formFields])
  const tree = el('div', { id: 'main-content' }, [
    el('dg-journal-edit-component', {}, [
      el('div', {}, [
        el('add-entry', {}, [
          el('modal', {}, [
            el('div', {}, [
              el('div', {}, [
                el('form', {}, [notFinalGradeView])
              ])
            ])
          ])
        ])
      ])
    ])
  ])
  document.body.appendChild(tree)
  return document.querySelector('add-entry tahvel-input input')
}

describe('AttachOvToSissekanneIFeature', () => {
  let feature

  beforeEach(() => {
    setupDom()
    feature = new AttachOvToSissekanneIFeature()
    feature.isActive = true
  })

  describe('shouldActivate', () => {
    test('matches journal edit URLs', () => {
      expect(feature.shouldActivate('https://test.tahvel.eenet.ee/#/journal/426365/edit')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/1/edit')).toBe(true)
    })

    test('does not match journal list or other pages', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/1')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/dashboard')).toBe(false)
    })
  })

  describe('buildNewNameEt', () => {
    test('appends a single (ÕVn) suffix to a plain name', () => {
      expect(feature.buildNewNameEt('Iseseisev töö', ['3'])).toBe('Iseseisev töö (ÕV3)')
    })

    test('sorts multiple ÕVs ascending and dedupes', () => {
      expect(feature.buildNewNameEt('Iseseisev töö', ['3', '1', '3'])).toBe('Iseseisev töö (ÕV1, ÕV3)')
    })

    test('replaces an existing ÕV-only suffix instead of appending', () => {
      expect(feature.buildNewNameEt('Iseseisev töö (ÕV1)', ['2', '5'])).toBe('Iseseisev töö (ÕV2, ÕV5)')
    })

    test('strips the ÕV-only suffix when nothing is selected', () => {
      expect(feature.buildNewNameEt('Iseseisev töö (ÕV1, ÕV3)', [])).toBe('Iseseisev töö')
    })

    test('preserves non-ÕV trailing parentheses when nothing is selected', () => {
      expect(feature.buildNewNameEt('Praktiline töö (vabatahtlik)', [])).toBe('Praktiline töö (vabatahtlik)')
    })

    test('preserves non-ÕV trailing parens while appending ÕV suffix', () => {
      expect(feature.buildNewNameEt('Praktiline töö (vabatahtlik)', ['2'])).toBe('Praktiline töö (vabatahtlik) (ÕV2)')
    })
  })

  describe('loadAvailableOvs', () => {
    test('builds catalog from SISSEKANNE_O entries sorted by outcomeOrderNr+1', async () => {
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: 100, entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '5) test', outcomeOrderNr: 4 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 },
            { id: 200, entryType: 'SISSEKANNE_T', nameEt: 'Tund' }
          ])
        }
      }
      const ovs = await feature.loadAvailableOvs('426365')
      expect(ovs).toEqual([
        { ovNum: '3', nameEt: '3) loob andmebaasi' },
        { ovNum: '5', nameEt: '5) test' }
      ])
    })

    test('caches results within 60s for the same journal id', async () => {
      let calls = 0
      feature.api = {
        tahvel: {
          get: mock(async () => {
            calls += 1
            return [{ id: null, entryType: 'SISSEKANNE_O', nameEt: '1) x', outcomeOrderNr: 0 }]
          })
        }
      }
      await feature.loadAvailableOvs('1')
      await feature.loadAvailableOvs('1')
      expect(calls).toBe(1)
    })
  })

  describe('modal injection', () => {
    test('injects the ÕV section after the name input when the modal is open', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }

      await feature._checkAndInject()

      const section = document.querySelector('.oa2-attach-ov-section')
      expect(section).not.toBeNull()
      const nameTahvel = nameInput.closest('tahvel-input')
      expect(nameTahvel.nextElementSibling).toBe(section)
      expect(section.textContent).toContain('Õpiväljundid')
      expect(section.textContent).toContain('Õpiväljund')
      expect(section.textContent).toContain('3) loob andmebaasi')
      expect(section.textContent).toContain('ÕV3')
    })

    test('pre-ticks checkboxes from existing (ÕVn) suffix on the name input', async () => {
      mountModal({ entryName: 'Iseseisev töö (ÕV1, ÕV3)' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) eelis', outcomeOrderNr: 0 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '2) teine', outcomeOrderNr: 1 },
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const checked = Array.from(document.querySelectorAll('.oa2-attach-ov-section input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.ovNum)
      expect(checked.sort()).toEqual(['1', '3'])
    })

    test('toggling a checkbox updates the name input value with the new suffix', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      let inputEventCount = 0
      nameInput.addEventListener('input', () => { inputEventCount += 1 })

      cb.checked = true
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))

      expect(nameInput.value).toBe('Iseseisev töö (ÕV3)')
      expect(inputEventCount).toBe(1)
    })

    test('unticking the last checkbox strips the ÕV suffix', async () => {
      const nameInput = mountModal({ entryName: 'Iseseisev töö (ÕV3)' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '3) loob andmebaasi', outcomeOrderNr: 2 }
          ])
        }
      }
      await feature._checkAndInject()
      const cb = document.querySelector('.oa2-attach-ov-section input[type="checkbox"]')
      expect(cb.checked).toBe(true)
      cb.checked = false
      cb.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(nameInput.value).toBe('Iseseisev töö')
    })

    test('skips injection when the section is already present', async () => {
      mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: null, entryType: 'SISSEKANNE_O', nameEt: '1) x', outcomeOrderNr: 0 }
          ])
        }
      }
      await feature._checkAndInject()
      await feature._checkAndInject()
      expect(document.querySelectorAll('.oa2-attach-ov-section').length).toBe(1)
    })

    test('shows empty-state when journal has no SISSEKANNE_O', async () => {
      mountModal({ entryName: 'Iseseisev töö' })
      feature.api = {
        tahvel: {
          get: mock(async () => [
            { id: 1, entryType: 'SISSEKANNE_I', nameEt: 'Iseseisev töö' }
          ])
        }
      }
      await feature._checkAndInject()
      const section = document.querySelector('.oa2-attach-ov-section')
      expect(section).not.toBeNull()
      expect(section.textContent).toContain('Selles päevikus pole ühtegi õpiväljundit')
      expect(section.querySelector('input[type="checkbox"]')).toBeNull()
    })
  })

  describe('extractJournalId', () => {
    test('parses the id from the current journal edit URL', () => {
      expect(feature.extractJournalId()).toBe('426365')
    })

    test('returns null when not on a journal page', () => {
      setupDom('https://tahvel.edu.ee/#/journals')
      const f = new AttachOvToSissekanneIFeature()
      expect(f.extractJournalId()).toBeNull()
    })
  })
})
