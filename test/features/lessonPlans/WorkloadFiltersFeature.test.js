import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'
import WorkloadFiltersFeature from '../../../src/features/lessonPlans/WorkloadFiltersFeature.js'

const KEY = 'OA_workloadFilters'
const section = (subject, group) => `<tr><td colspan="4"><span class="bold">${subject}</span></td><td colspan="2">Details</td></tr>
<tr><th rowspan="2"><div class="journal-items"><div class="journal-column"><div class="items">${group}</div><div class="items">Teacher</div></div></div></th><th>A</th><th>12</th><td>0</td><td></td><td>0.5</td></tr>
<tr><th>Kokku</th><th>12</th><td>0</td><td>-2</td><td>0,0</td></tr>`
const tableHTML = `<div class="tahvel-table-wrapper"><table class="tahvel-table"><thead><tr><th>2026</th></tr></thead><tbody>
${section('Programmeerimine', 'TAK25')}${section('Programmeerimine', 'TAK26')}${section('Märgendikeeled', 'TAK26')}
</tbody><tfoot><tr><th>KÕIK KOKKU</th><td>36</td></tr></tfoot></table></div>`

describe('WorkloadFiltersFeature', () => {
  let dom, feature, stored
  const inputs = () => [...document.querySelectorAll('#oa2-workload input')]
  const status = () => document.querySelector('#oa2-workload [role="status"]').textContent
  const setFilter = (index, value) => {
    inputs()[index].value = value
    inputs()[index].dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }

  beforeEach(() => {
    restoreChromeMock()
    dom = new JSDOM(`<html><head></head><body><main>${tableHTML}</main></body></html>`, {
      url: 'https://tahvel.edu.ee/#/lessonplans/vocational/byteacher?_menu'
    })
    global.window = dom.window
    global.document = dom.window.document
    global.MutationObserver = dom.window.MutationObserver
    stored = {}
    chrome.storage.local.get = (keys, callback) => callback(stored)
    chrome.storage.local.set = (values, callback) => {
      Object.assign(stored, structuredClone(values))
      callback?.()
    }
    feature = new WorkloadFiltersFeature()
  })

  afterEach(() => {
    feature.onDeactivate()
    dom.window.close()
    restoreChromeMock()
    restoreGlobalDOM()
  })

  it('matches only the teacher workload route', () => {
    expect(feature.shouldActivate(window.location.href)).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/lessonplans/vocational/byteacherOther')).toBe(false)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
  })

  it('combines partial case-insensitive filters and keeps complete row blocks', async () => {
    await feature.onActivate()
    setFilter(0, 'tak26')
    expect(status()).toContain('2 / 3')
    setFilter(1, 'PROGRAM')
    expect(status()).toContain('1 / 3')
    const visible = [...document.querySelectorAll('tbody tr')].filter(row => !row.classList.contains('oa2-workload-hidden'))
    expect(visible.length).toBe(3)
    expect(visible[0].textContent).toContain('Programmeerimine')
    expect(visible[1].textContent).toContain('TAK26')
    expect(visible[2].textContent).toContain('Kokku')
    expect(document.querySelector('tfoot').classList.contains('oa2-workload-hidden')).toBe(true)
    setFilter(0, '')
    expect(status()).toContain('2 / 3')
    setFilter(1, 'missing')
    expect(status()).toContain('0 / 3')
  })

  it('highlights numeric body and footer cells except blank cells and literal zero', async () => {
    await feature.onActivate()
    for (const cell of document.querySelectorAll('tbody td,tbody th,tfoot td,tfoot th')) {
      const value = cell.textContent.trim()
      expect(cell.classList.contains('oa2-workload-number')).toBe(['12', '0.5', '-2', '0,0', '36'].includes(value))
    }
    expect(document.querySelector('thead th').classList.contains('oa2-workload-number')).toBe(false)
  })

  it('restores saved values after a fresh instance and persists clearing both filters', async () => {
    await feature.onActivate()
    setFilter(0, 'TAK26')
    setFilter(1, 'Märgendi')
    feature.onDeactivate()
    feature = new WorkloadFiltersFeature()
    await feature.onActivate()
    expect(inputs().map(input => input.value)).toEqual(['TAK26', 'Märgendi'])
    expect(status()).toContain('1 / 3')
    document.querySelector('#oa2-workload button').click()
    expect(stored[KEY]).toEqual({ group: '', subject: '' })
    expect(status()).toContain('3 / 3')
    expect(document.querySelector('tfoot').classList.contains('oa2-workload-hidden')).toBe(false)
  })

  it('migrates legacy filters only when extension preferences do not exist', async () => {
    window.localStorage.setItem('henno-koormus-filters-v1', JSON.stringify({ group: 'TAK25', subject: 'Program' }))
    await feature.onActivate()
    expect(stored[KEY]).toEqual({ group: 'TAK25', subject: 'Program' })
    document.querySelector('#oa2-workload button').click()
    feature.onDeactivate()
    await feature.onActivate()
    expect(inputs().map(input => input.value)).toEqual(['', ''])
  })

  it('handles delayed tables and replacement without losing filters or adding duplicate controls', async () => {
    document.querySelector('main').replaceChildren()
    stored[KEY] = { group: 'TAK26', subject: 'Märgendi' }
    await feature.onActivate()
    document.querySelector('main').innerHTML = tableHTML
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(status()).toContain('1 / 3')
    document.querySelector('main').innerHTML = tableHTML
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(document.querySelectorAll('#oa2-workload').length).toBe(1)
    expect(inputs().map(input => input.value)).toEqual(['TAK26', 'Märgendi'])
  })

  it('cleans up all UI, styling and scheduled work on navigation', async () => {
    await feature.onActivate()
    setFilter(0, 'TAK25')
    document.querySelector('tbody').append(document.createElement('tr'))
    feature.onDeactivate()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(document.querySelector('#oa2-workload')).toBeNull()
    expect(document.querySelector('.oa2-workload-hidden, .oa2-workload-number')).toBeNull()
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('does not mount if navigation occurs while storage is loading', async () => {
    let complete
    chrome.storage.local.get = (keys, callback) => {
      complete = callback
    }
    const loading = feature.onActivate()
    feature.onDeactivate()
    complete({})
    await loading
    expect(document.querySelector('#oa2-workload')).toBeNull()
  })
})
