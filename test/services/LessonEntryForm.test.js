import { test, expect } from 'bun:test'
import { JSDOM } from 'jsdom'
import { openLessonEntry } from '../../src/services/LessonEntryForm.js'

test('fills current Tahvel controls, leaves topic/content to teacher and never saves', async() => {
  const dom = new JSDOM(`<button id="add">LISA UUS SISSEKANNE</button><form class="tahvel-form">
    <tahvel-select formcontrolname="entryType"><div class="field"></div><button type="button" class="dropdown-item">Tund</button></tahvel-select>
    <checkbox formcontrolname="selected"><button type="button"><div class="box"></div>Auditoorne õpe</button></checkbox>
    <date-picker formcontrolname="entryDate"><input></date-picker>
    <tahvel-select formcontrolname="startLessonNr"><div class="field"></div><button type="button" class="dropdown-item">5</button></tahvel-select>
    <tahvel-input formcontrolname="lessons"><input></tahvel-input>
    <tahvel-input formcontrolname="entryName"><input></tahvel-input>
    <textarea></textarea><button id="save">Salvesta</button></form>`, { url: 'https://tahvel.edu.ee/#/journal/8/edit' })
  const original = { window: global.window, document: global.document, Event: global.Event }
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event })
  let saved = false
  let selected = false
  let dateInput = false
  document.getElementById('add').getClientRects = () => [{}]
  document.getElementById('save').onclick = event => { event.preventDefault(); saved = true }
  document.querySelector('[formcontrolname="entryType"] button').onclick = () => { selected = true }
  document.querySelector('[formcontrolname="entryDate"] input').oninput = () => { dateInput = true }
  try {
    await openLessonEntry({ journalId: 8, date: '2026-09-14', startLessonNr: 5, lessons: 2, capacityType: 'MAHT_a', groups: [{ id: 1, code: 'A' }] }, async() => { throw new Error('No access') })
    expect(selected).toBe(true)
    expect(dateInput).toBe(true)
    expect(document.querySelector('[formcontrolname="entryDate"] input').value).toBe('14.09.2026')
    expect(document.querySelector('[formcontrolname="lessons"] input').value).toBe('2')
    expect(document.querySelector('[formcontrolname="entryName"] input').value).toBe('')
    expect(document.querySelector('textarea').value).toBe('')
    expect(saved).toBe(false)
    expect(document.querySelector('[role="status"]').textContent).toContain('pole kättesaadav')
  } finally { Object.assign(global, original); dom.window.close() }
})
