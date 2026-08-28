import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { getNativeJournalHeaderCells } from '../../../lib/journalTableHeaders.js'

const STYLE_ID = 'oa2-table-reading-guide-style'
const ROW_CLASS = 'oa2-reading-guide-row'
const COL_CLASS = 'oa2-reading-guide-col'
const CELL_CLASS = 'oa2-reading-guide-cell'
const WARNING_CLASSES = [
  'highlight-final-grade-red',
  'highlight-final-grade-yellow',
  'highlight-ov-red',
  'highlight-ov-yellow',
  'highlight-missing-grade',
  'oa2-grade-cell-positive',
  'oa2-grade-cell-negative'
]
const WARNING_NOT = WARNING_CLASSES.map(cls => `:not(.${cls})`).join('')
const OVERLAY_SELECTOR = [
  '.cdk-overlay-container',
  '.cdk-overlay-pane',
  '.cdk-overlay-backdrop',
  'md-select-menu-container',
  '.md-select-menu-container',
  'md-menu-content',
  '.md-menu-content',
  'md-tooltip',
  '.md-tooltip',
  'md-virtual-repeat-container',
  '.md-virtual-repeat-container',
  'md-backdrop',
  'md-dialog',
  'md-dialog-container',
  'mat-select-panel',
  '.mat-mdc-select-panel',
  '.mat-select-panel',
  '.mat-mdc-menu-panel',
  'tahvel-tooltip',
  '.tahvel-tooltip',
  '.oa2-grade-tooltip',
  '[role="tooltip"]',
  '[role="dialog"]'
].join(', ')

export default class TableReadingGuideFeature extends BaseFeature {
  constructor() {
    super('tableReadingGuide', /#\/journal\/\d+\/edit/)
    this._mouseOverListener = null
    this._mouseOutListener = null
    this._highlightedCells = new Set()
    this._currentCell = null
    this._suppressedTitleCell = null
    this._cachedTable = null
  }

  onActivate() {
    if (Logger.isDebugMode()) Logger.debug('[TableReadingGuideFeature] onActivate called')
    this.injectCSS()

    this._mouseOverListener = event => this._onMouseOver(event)
    this._mouseOutListener = event => this._onMouseOut(event)
    document.addEventListener('mouseover', this._mouseOverListener, true)
    document.addEventListener('mouseout', this._mouseOutListener, true)
  }

  onDeactivate() {
    if (this._mouseOverListener) {
      document.removeEventListener('mouseover', this._mouseOverListener, true)
      this._mouseOverListener = null
    }
    if (this._mouseOutListener) {
      document.removeEventListener('mouseout', this._mouseOutListener, true)
      this._mouseOutListener = null
    }
    this._clearHighlight()
    this._cachedTable = null
    styleService.removeCSS(STYLE_ID)
    super.onDeactivate()
  }

  injectCSS() {
    styleService.injectCSS(
      `
        td.${ROW_CLASS}${WARNING_NOT} {
          background-image: linear-gradient(rgba(255, 193, 7, 0.28), rgba(255, 193, 7, 0.28)) !important;
        }

        th.${COL_CLASS} {
          background-image: linear-gradient(rgba(255, 193, 7, 0.28), rgba(255, 193, 7, 0.28)) !important;
        }

        td.${COL_CLASS}${WARNING_NOT} {
          background-image: linear-gradient(rgba(255, 193, 7, 0.28), rgba(255, 193, 7, 0.28)) !important;
        }

        thead tr.oa2-assignment-title-row th.${COL_CLASS},
        thead tr.oa2-assignment-outcome-row th.${COL_CLASS} {
          background-image: linear-gradient(rgba(255, 193, 7, 0.28), rgba(255, 193, 7, 0.28)) !important;
          background-color: transparent !important;
        }

        td.${CELL_CLASS}${WARNING_NOT} {
          background-image: linear-gradient(rgba(255, 152, 0, 0.45), rgba(255, 152, 0, 0.45)) !important;
          box-shadow: inset 0 0 0 2px #ef6c00 !important;
        }
      `,
      STYLE_ID
    )
  }

  _onMouseOver(event) {
    const target = event.target
    if (!target?.closest) return

    const cell = target.closest('td')
    if (cell) {
      const table = this._findJournalTable()
      if (!table || !table.contains(cell)) return
      if (cell === this._currentCell) return
      this._clearHighlight()
      this._applyHighlight(cell, table)
      return
    }

    if (!this._currentCell) return
    const th = target.closest('th')
    if (!th) return
    if (th.classList.contains(COL_CLASS)) return
    const table = this._findJournalTable()
    if (table && table.contains(th)) {
      this._clearHighlight()
    }
  }

  _onMouseOut(event) {
    if (!this._currentCell) return
    const related = event.relatedTarget
    const table = this._findJournalTable()
    if (!table) {
      this._clearHighlight()
      return
    }
    if (related && table.contains(related)) return
    if (related?.closest?.(OVERLAY_SELECTOR)) return
    this._clearHighlight()
  }

  _applyHighlight(cell, table) {
    const row = cell.parentElement
    if (!row) return

    const bodyRows = this._collectBodyRows(table)
    const headerRows = this._collectHeaderRows(table)

    const bodyMap = this._buildColumnGrid(bodyRows)
    const headerMap = this._buildColumnGrid(headerRows)

    const rowCells = this._cellChildren(row)
    const focal = bodyMap.cellInfo.get(cell)
    const visualCol = focal ? focal.startCol : rowCells.indexOf(cell)
    if (visualCol < 0) return

    rowCells.forEach(sibling => {
      if (sibling === cell) return
      sibling.classList.add(ROW_CLASS)
      this._highlightedCells.add(sibling)
    })

    bodyRows.forEach((bodyRow, rowIdx) => {
      if (bodyRow === row) return
      const targetCell = bodyMap.grid[rowIdx]?.[visualCol]
      if (!targetCell || targetCell === cell) return
      targetCell.classList.add(COL_CLASS)
      this._highlightedCells.add(targetCell)
    })

    headerRows.forEach((headerRow, rowIdx) => {
      const targetCell = headerMap.grid[rowIdx]?.[visualCol]
      if (!targetCell) return
      targetCell.classList.add(COL_CLASS)
      this._highlightedCells.add(targetCell)
    })

    this._suppressTitle(cell)
    cell.classList.add(CELL_CLASS)
    this._highlightedCells.add(cell)
    this._currentCell = cell
  }

  _collectBodyRows(table) {
    return Array.from(table.querySelectorAll('tbody tr')).filter(tr => tr.closest('table') === table)
  }

  _collectHeaderRows(table) {
    return Array.from(table.querySelectorAll('thead tr')).filter(tr => tr.closest('table') === table)
  }

  _cellChildren(row) {
    return Array.from(row.children).filter(el => el.tagName === 'TD' || el.tagName === 'TH')
  }

  _buildColumnGrid(rows) {
    const grid = []
    const cellInfo = new Map()
    rows.forEach((tr, rowIdx) => {
      grid[rowIdx] = grid[rowIdx] || []
      let colIdx = 0
      this._cellChildren(tr).forEach(cell => {
        while (grid[rowIdx][colIdx]) colIdx += 1
        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan'), 10) || 1)
        const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan'), 10) || 1)
        cellInfo.set(cell, { rowIdx, startCol: colIdx, colspan, rowspan })
        for (let r = 0; r < rowspan; r += 1) {
          for (let c = 0; c < colspan; c += 1) {
            grid[rowIdx + r] = grid[rowIdx + r] || []
            grid[rowIdx + r][colIdx + c] = cell
          }
        }
        colIdx += colspan
      })
    })
    return { grid, cellInfo }
  }

  _clearHighlight() {
    if (this._highlightedCells.size === 0 && !this._currentCell && !this._suppressedTitleCell) return

    const table = this._findJournalTable()
    if (table) {
      table.querySelectorAll(`.${ROW_CLASS}, .${COL_CLASS}, .${CELL_CLASS}`)
        .forEach(el => el.classList.remove(ROW_CLASS, COL_CLASS, CELL_CLASS))
    }
    this._highlightedCells.forEach(element => {
      if (element.isConnected) {
        element.classList.remove(ROW_CLASS, COL_CLASS, CELL_CLASS)
      }
    })
    this._highlightedCells.clear()
    this._currentCell = null
    this._restoreSuppressedTitle()
  }

  _suppressTitle(cell) {
    this._restoreSuppressedTitle()
    if (!cell.hasAttribute('title')) return
    this._suppressedTitleCell = cell
    cell.dataset.oa2ReadingGuideSuppressedTitle = cell.getAttribute('title')
    cell.removeAttribute('title')
  }

  _restoreSuppressedTitle() {
    const cell = this._suppressedTitleCell
    this._suppressedTitleCell = null
    if (!cell || !cell.isConnected) return
    const saved = cell.dataset.oa2ReadingGuideSuppressedTitle
    delete cell.dataset.oa2ReadingGuideSuppressedTitle
    if (saved !== undefined) cell.setAttribute('title', saved)
  }

  _findJournalTable() {
    if (this._cachedTable && this._cachedTable.isConnected && this._isJournalTable(this._cachedTable)) {
      return this._cachedTable
    }
    this._cachedTable = null
    const selectors = [
      '#studentTable table.tahvel-table',
      '#studentTable table',
      '.tahvel-table-wrapper#studentTable table',
      '.layout-padding table.tahvel-table',
      '.layout-padding table.journalTable',
      'table.journalTable',
      'table.tahvel-table.with-borders'
    ]
    for (const selector of selectors) {
      const table = document.querySelector(selector)
      if (this._isJournalTable(table)) {
        this._cachedTable = table
        return table
      }
    }
    return null
  }

  _isJournalTable(table) {
    if (!table) return false
    const headerCells = getNativeJournalHeaderCells(table)
    return headerCells.some(th => (th.textContent || '').trim().toLowerCase().includes('õppija'))
  }
}
