import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { JSDOM } from 'jsdom'
import TableReadingGuideFeature from '../../../src/features/singleJournal/tableReadingGuide/TableReadingGuideFeature.js'
import { restoreGlobalDOM } from '../../setup.js'

function setupDom(url = 'https://tahvel.edu.ee/#/journal/123/edit') {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url })
  global.window = dom.window
  global.document = dom.window.document
  global.HTMLElement = dom.window.HTMLElement
  global.MutationObserver = dom.window.MutationObserver
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  global.MouseEvent = dom.window.MouseEvent
  return dom
}

function makeCell(tag, text, { colspan, rowspan } = {}) {
  const cell = document.createElement(tag)
  if (text !== undefined && text !== null) cell.textContent = text
  if (colspan) cell.setAttribute('colspan', String(colspan))
  if (rowspan) cell.setAttribute('rowspan', String(rowspan))
  return cell
}

function makeRow(cellTag, items, className) {
  const tr = document.createElement('tr')
  if (className) tr.classList.add(className)
  for (const item of items) {
    if (item && typeof item === 'object' && 'tag' in item) {
      tr.appendChild(makeCell(item.tag, item.text, item))
    } else {
      tr.appendChild(makeCell(cellTag, item))
    }
  }
  return tr
}

function buildTable({ withCustomHeaderRows = false } = {}) {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)

  const wrapper = document.createElement('div')
  wrapper.id = 'studentTable'

  const table = document.createElement('table')
  table.classList.add('tahvel-table', 'with-borders')

  const thead = document.createElement('thead')
  if (withCustomHeaderRows) {
    thead.appendChild(makeRow('th', ['', '', 'Title A', 'Title B'], 'oa2-assignment-title-row'))
  }
  thead.appendChild(makeRow('th', ['Nr', 'Õppija', '25.03', '26.03']))
  if (withCustomHeaderRows) {
    thead.appendChild(makeRow('th', ['', '', 'ÕV1', 'ÕV2'], 'oa2-assignment-outcome-row'))
  }
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  tbody.appendChild(makeRow('td', ['1', 'Student 1', 'A', 'P']))
  tbody.appendChild(makeRow('td', ['2', 'Student 2', 'MA', 'V']))
  tbody.appendChild(makeRow('td', ['3', 'Student 3', '4', '']))
  table.appendChild(tbody)

  wrapper.appendChild(table)
  document.body.appendChild(wrapper)
  return table
}

function buildSpannedHeaderTable() {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild)

  const wrapper = document.createElement('div')
  wrapper.id = 'studentTable'

  const table = document.createElement('table')
  table.classList.add('tahvel-table', 'with-borders')

  const thead = document.createElement('thead')
  thead.appendChild(makeRow(null, [
    { tag: 'th', text: 'Nr', rowspan: 2 },
    { tag: 'th', text: 'Õppija', rowspan: 2 },
    { tag: 'th', text: 'Sissekanded', colspan: 2 }
  ]))
  thead.appendChild(makeRow('th', ['11.04', '13.04']))
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  tbody.appendChild(makeRow('td', ['1', 'Adelina', 'A', 'MA']))
  tbody.appendChild(makeRow('td', ['2', 'Marten', 'MA', 'A']))
  table.appendChild(tbody)

  wrapper.appendChild(table)
  document.body.appendChild(wrapper)
  return table
}

function fireMouse(eventName, target, relatedTarget = null) {
  const event = new window.MouseEvent(eventName, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target, writable: false })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget, writable: false })
  document.dispatchEvent(event)
}

describe('TableReadingGuideFeature', () => {
  let feature

  beforeEach(() => {
    setupDom()
    feature = new TableReadingGuideFeature()
  })

  afterEach(() => {
    feature?.deactivate()
    restoreGlobalDOM()
  })

  test('activates only on journal edit pages', () => {
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(true)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123')).toBe(false)
    expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
  })

  test('injects style with row, column, focal-cell rules and all warning-class exclusions', () => {
    feature.injectCSS()
    const style = document.getElementById('oa2-table-reading-guide-style')
    expect(style).not.toBeNull()
    const css = style.textContent
    expect(css).toContain('oa2-reading-guide-row')
    expect(css).toContain('oa2-reading-guide-col')
    expect(css).toContain('oa2-reading-guide-cell')
    expect(css).toContain('box-shadow')
    const warningClasses = [
      'highlight-final-grade-red',
      'highlight-final-grade-yellow',
      'highlight-ov-red',
      'highlight-ov-yellow',
      'highlight-missing-grade',
      'oa2-grade-cell-positive',
      'oa2-grade-cell-negative'
    ]
    for (const cls of warningClasses) {
      expect(css).toContain(`:not(.${cls})`)
    }
  })

  test('injects higher-specificity background-image rule for AssignmentTitleRow custom rows', () => {
    feature.injectCSS()
    const css = document.getElementById('oa2-table-reading-guide-style').textContent
    expect(css).toContain('thead tr.oa2-assignment-title-row th.oa2-reading-guide-col')
    expect(css).toContain('thead tr.oa2-assignment-outcome-row th.oa2-reading-guide-col')
    expect(css).toMatch(/background-color:\s*transparent\s*!important/)
  })

  test('hovering a body cell highlights its row, column header, and the focal cell', () => {
    buildTable()
    feature.activate()

    const rows = document.querySelectorAll('tbody tr')
    const focal = rows[1].children[2]
    fireMouse('mouseover', focal)

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)

    Array.from(rows[1].children).forEach(sibling => {
      if (sibling === focal) return
      expect(sibling.classList.contains('oa2-reading-guide-row')).toBe(true)
    })

    const headerCell = document.querySelectorAll('thead tr th')[2]
    expect(headerCell.classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(rows[0].children[2].classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(rows[2].children[2].classList.contains('oa2-reading-guide-col')).toBe(true)

    expect(rows[0].children[3].classList.contains('oa2-reading-guide-col')).toBe(false)
    expect(rows[0].children[1].classList.contains('oa2-reading-guide-col')).toBe(false)
  })

  test('moving to a new cell clears the prior highlight before painting the new one', () => {
    buildTable()
    feature.activate()

    const rows = document.querySelectorAll('tbody tr')
    const first = rows[1].children[2]
    const second = rows[2].children[3]

    fireMouse('mouseover', first)
    expect(first.classList.contains('oa2-reading-guide-cell')).toBe(true)

    fireMouse('mouseover', second, first)
    expect(first.classList.contains('oa2-reading-guide-cell')).toBe(false)
    expect(first.classList.contains('oa2-reading-guide-row')).toBe(false)
    expect(first.classList.contains('oa2-reading-guide-col')).toBe(false)

    expect(second.classList.contains('oa2-reading-guide-cell')).toBe(true)
  })

  test('mousing out of the table clears all reading-guide classes', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[1].children[2]
    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    fireMouse('mouseout', focal, outside)

    document.querySelectorAll('td, th').forEach(cell => {
      expect(cell.classList.contains('oa2-reading-guide-row')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-col')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-cell')).toBe(false)
    })
  })

  test('mouseout to a related target INSIDE the table does not clear', () => {
    buildTable()
    feature.activate()

    const rows = document.querySelectorAll('tbody tr')
    const focal = rows[1].children[2]
    const neighbor = rows[1].children[3]
    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)

    fireMouse('mouseout', focal, neighbor)

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)
    expect(rows[1].children[1].classList.contains('oa2-reading-guide-row')).toBe(true)
  })

  test('mouseout to a Material overlay (cdk-overlay-container) does not clear', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)

    const overlay = document.createElement('div')
    overlay.className = 'cdk-overlay-container'
    const popup = document.createElement('div')
    overlay.appendChild(popup)
    document.body.appendChild(overlay)

    fireMouse('mouseout', focal, popup)

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)
  })

  test('custom injected header rows participate in the column highlight (no mid-band gap)', () => {
    buildTable({ withCustomHeaderRows: true })
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)

    const customRows = document.querySelectorAll(
      'tr.oa2-assignment-title-row, tr.oa2-assignment-outcome-row'
    )
    expect(customRows.length).toBe(2)
    customRows.forEach(row => {
      const colCell = row.children[2]
      expect(colCell.classList.contains('oa2-reading-guide-col')).toBe(true)
    })
  })

  test('column highlight follows colspan/rowspan in native header', () => {
    buildSpannedHeaderTable()
    feature.activate()

    const bodyRows = document.querySelectorAll('tbody tr')
    const focal = bodyRows[0].children[2]
    fireMouse('mouseover', focal)

    const headerRows = document.querySelectorAll('thead tr')
    const sissekandedTh = headerRows[0].children[2]
    const dayTh = headerRows[1].children[0]
    expect(sissekandedTh.textContent).toBe('Sissekanded')
    expect(dayTh.textContent).toBe('11.04')

    expect(sissekandedTh.classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(dayTh.classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(headerRows[1].children[1].classList.contains('oa2-reading-guide-col')).toBe(false)
  })

  test('column highlight for second spanned column targets the right sub-row header', () => {
    buildSpannedHeaderTable()
    feature.activate()

    const bodyRows = document.querySelectorAll('tbody tr')
    const focal = bodyRows[1].children[3]
    fireMouse('mouseover', focal)

    const headerRows = document.querySelectorAll('thead tr')
    const sissekandedTh = headerRows[0].children[2]
    const dayTh11 = headerRows[1].children[0]
    const dayTh13 = headerRows[1].children[1]

    expect(sissekandedTh.classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(dayTh13.classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(dayTh11.classList.contains('oa2-reading-guide-col')).toBe(false)
  })

  test('hovering a cell outside the journal table is ignored', () => {
    buildTable()
    feature.activate()

    const outsideTable = document.createElement('table')
    const outsideTbody = document.createElement('tbody')
    const outsideRow = document.createElement('tr')
    const outsideCell = document.createElement('td')
    outsideCell.id = 'outside'
    outsideCell.textContent = 'X'
    outsideRow.appendChild(outsideCell)
    outsideTbody.appendChild(outsideRow)
    outsideTable.appendChild(outsideTbody)
    document.body.appendChild(outsideTable)

    fireMouse('mouseover', document.getElementById('outside'))

    document.querySelectorAll('#studentTable td, #studentTable th').forEach(cell => {
      expect(cell.classList.contains('oa2-reading-guide-cell')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-row')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-col')).toBe(false)
    })
  })

  test('hovering an UNRELATED th in the same table clears a body-cell highlight', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)

    const headerTh = document.querySelector('thead tr th')
    expect(headerTh.classList.contains('oa2-reading-guide-col')).toBe(false)
    fireMouse('mouseover', headerTh, focal)

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(false)
    document.querySelectorAll('td, th').forEach(cell => {
      expect(cell.classList.contains('oa2-reading-guide-row')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-col')).toBe(false)
      expect(cell.classList.contains('oa2-reading-guide-cell')).toBe(false)
    })
  })

  test('hovering the matching column header (already oa2-reading-guide-col) does NOT clear the highlight', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)
    const matchingHeader = document.querySelectorAll('thead tr th')[2]
    expect(matchingHeader.classList.contains('oa2-reading-guide-col')).toBe(true)

    fireMouse('mouseover', matchingHeader, focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)
    expect(matchingHeader.classList.contains('oa2-reading-guide-col')).toBe(true)
  })

  test('suppresses native title on focal cell and restores it on clear', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    focal.setAttribute('title', 'Hinne puudub')

    fireMouse('mouseover', focal)
    expect(focal.hasAttribute('title')).toBe(false)
    expect(focal.dataset.oa2ReadingGuideSuppressedTitle).toBe('Hinne puudub')
    expect(feature._suppressedTitleCell).toBe(focal)

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    fireMouse('mouseout', focal, outside)

    expect(focal.getAttribute('title')).toBe('Hinne puudub')
    expect(focal.dataset.oa2ReadingGuideSuppressedTitle).toBeUndefined()
    expect(feature._suppressedTitleCell).toBeNull()
  })

  test('non-cell elements inside <tr> are ignored for row siblings and column index', () => {
    buildTable()
    const tbodyRow = document.querySelectorAll('tbody tr')[1]
    const stray = document.createElement('div')
    stray.id = 'stray'
    tbodyRow.insertBefore(stray, tbodyRow.firstChild)

    feature.activate()
    const focal = tbodyRow.children[3]
    fireMouse('mouseover', focal)

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)
    expect(stray.classList.contains('oa2-reading-guide-row')).toBe(false)

    const headerCells = document.querySelectorAll('thead tr th')
    expect(headerCells[2].classList.contains('oa2-reading-guide-col')).toBe(true)
    expect(headerCells[1].classList.contains('oa2-reading-guide-col')).toBe(false)
  })

  test('clear sweeps reading-guide classes from cells not tracked in the Set (Angular node reuse)', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)

    const orphan = document.querySelectorAll('tbody tr')[2].children[2]
    expect(orphan.classList.contains('oa2-reading-guide-col')).toBe(true)

    feature._highlightedCells.delete(orphan)

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    fireMouse('mouseout', focal, outside)

    expect(orphan.classList.contains('oa2-reading-guide-col')).toBe(false)
  })

  test('onDeactivate removes listeners, clears classes, and removes the style tag', () => {
    buildTable()
    feature.activate()

    const focal = document.querySelectorAll('tbody tr')[0].children[2]
    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(true)
    expect(document.getElementById('oa2-table-reading-guide-style')).not.toBeNull()

    feature.deactivate()

    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(false)
    expect(document.getElementById('oa2-table-reading-guide-style')).toBeNull()

    fireMouse('mouseover', focal)
    expect(focal.classList.contains('oa2-reading-guide-cell')).toBe(false)
  })
})
