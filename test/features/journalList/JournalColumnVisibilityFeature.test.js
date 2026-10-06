import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { JSDOM } from 'jsdom'
import { restoreChromeMock, restoreGlobalDOM } from '../../setup.js'
import JournalColumnVisibilityFeature from '../../../src/features/journalList/JournalColumnVisibilityFeature.js'

const KEY = 'OA_journalListHiddenColumns'
const tableHTML = `<table class="tahvel-table"><thead><tr>
  <th md-order-by="group">Õpperühm(ad)</th><th md-order-by="name">Päevik</th><th md-order-by="teacher">Õpetaja(d)</th>
  </tr></thead><tbody><tr><td>TA26</td><td><a href="#/journal/123/edit">Andmebaasid</a></td><td>Õpetaja</td></tr>
  <tr><td colspan="3">Kokku</td></tr></tbody></table>`

describe('JournalColumnVisibilityFeature', () => {
  let dom, feature, stored

  beforeEach(() => {
    restoreChromeMock()
    dom = new JSDOM(`<html><head></head><body><div id="tahvelTable">${tableHTML}</div></body></html>`, { url: 'https://tahvel.edu.ee/#/journals' })
    global.window = dom.window
    global.document = dom.window.document
    global.MutationObserver = dom.window.MutationObserver
    stored = {}
    chrome.storage.local.get = (keys, callback) => callback(stored)
    chrome.storage.local.set = (values, callback) => { Object.assign(stored, values); callback?.() }
    feature = new JournalColumnVisibilityFeature()
  })

  afterEach(() => {
    feature.onDeactivate()
    dom.window.close()
    restoreChromeMock()
    restoreGlobalDOM()
  })

  it('activates only on the journal list', () => {
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(false)
  })

  it('opens with the hamburger and closes outside or with Escape', async () => {
    await feature.onActivate()
    const button = document.querySelector('.oa2-column-toggle')
    const menu = document.querySelector('.oa2-column-menu')
    expect(menu.hidden).toBe(true)
    button.click()
    expect(menu.hidden).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    document.querySelector('input').click()
    expect(menu.hidden).toBe(false)
    document.body.click()
    expect(menu.hidden).toBe(true)
    button.click()
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it('immediately hides columns, persists keys, and keeps journal names visible', async () => {
    await feature.onActivate()
    const inputs = document.querySelectorAll('.oa2-column-menu input')
    expect(inputs[1].disabled).toBe(true)
    inputs[2].click()
    expect(stored[KEY]).toEqual(['teacher'])
    expect(window.getComputedStyle(document.querySelector('tbody tr td:nth-child(3)')).display).toBe('none')
    expect(window.getComputedStyle(document.querySelector('tbody tr td:nth-child(2)')).display).not.toBe('none')
    expect(window.getComputedStyle(document.querySelector('[colspan]')).display).not.toBe('none')
    expect(document.querySelector('tbody tr td:nth-child(3)').textContent).toBe('Õpetaja')
  })

  it('restores preferences after a new activation and resets all columns', async () => {
    stored[KEY] = ['teacher', 'name']
    await feature.onActivate()
    expect(document.querySelectorAll('input')[2].checked).toBe(false)
    expect(document.querySelectorAll('input')[1].checked).toBe(true)
    document.querySelector('.oa2-column-menu button').click()
    expect(stored[KEY]).toEqual([])
    expect(window.getComputedStyle(document.querySelector('tbody tr td:nth-child(3)')).display).not.toBe('none')
  })

  it('handles delayed table rendering and replacement without duplicate menus', async () => {
    document.querySelector('#tahvelTable').innerHTML = ''
    stored[KEY] = ['teacher']
    await feature.onActivate()
    expect(document.querySelector('.oa2-column-toggle')).toBeNull()
    document.querySelector('#tahvelTable').innerHTML = tableHTML
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(document.querySelectorAll('.oa2-column-toggle').length).toBe(1)
    document.querySelector('#tahvelTable').innerHTML = tableHTML
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(document.querySelectorAll('.oa2-column-toggle').length).toBe(1)
    expect(window.getComputedStyle(document.querySelector('tbody tr td:nth-child(3)')).display).toBe('none')
  })

  it('removes styling and UI on deactivation', async () => {
    stored[KEY] = ['teacher']
    await feature.onActivate()
    feature.onDeactivate()
    expect(document.querySelector('.oa2-column-toolbar')).toBeNull()
    expect(document.querySelector('.oa2-column-table')).toBeNull()
    expect(window.getComputedStyle(document.querySelector('tbody tr td:nth-child(3)')).display).not.toBe('none')
  })
})
