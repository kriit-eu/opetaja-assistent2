/**
 * Journal List Indicators Feature
 * Displays colored indicators next to journal names for various states
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class JournalListIndicatorsFeature extends BaseFeature {
  constructor () {
    super('journalListIndicators', /\/#\/journals\?_menu/)

    this.tableObserver = null
    this.journalRowsSelector = '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr'
    this.addedStyles = null
  }

  onActivate () {
    console.log('Journal List Indicators feature activated')
    this.addIndicatorStyles()
    this.setupTableObserver()
  }

  onDeactivate () {
    console.log('Journal List Indicators feature deactivated')
    this.disconnectTableObserver()
    this.removeIndicatorStyles()
  }

  /**
   * Add CSS styles for indicators
   */
  addIndicatorStyles () {
    const css = `
      .ta-journal-indicator {
        display: inline-block;
        width: 0;
        height: 0;
        margin-right: 5px;
        border-style: solid;
        border-width: 0 5px 8.7px 5px;
        border-color: transparent transparent #000 transparent;
        vertical-align: middle;
      }

      .ta-journal-indicator.warning {
        border-color: transparent transparent #ff9800 transparent;
      }

      .ta-journal-indicator.error {
        border-color: transparent transparent #f44336 transparent;
      }

      .ta-journal-indicator.info {
        border-color: transparent transparent #2196f3 transparent;
      }
    `

    this.addedStyles = domService.addStyles(css)
  }

  /**
   * Remove added styles on deactivation
   */
  removeIndicatorStyles () {
    if (this.addedStyles) {
      this.addedStyles.remove()
      this.addedStyles = null
    }
  }

  /**
   * Setup observer to wait for table to load
   */
  setupTableObserver () {
    this.disconnectTableObserver()

    // Create new observer
    this.tableObserver = new MutationObserver(() => {
      const tableRows = document.querySelectorAll(this.journalRowsSelector)

      if (tableRows.length > 0) {
        this.processJournalRows(tableRows)
        this.disconnectTableObserver()
      }
    })

    // Start observing
    this.tableObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Also check immediately
    const tableRows = document.querySelectorAll(this.journalRowsSelector)
    if (tableRows.length > 0) {
      this.processJournalRows(tableRows)
      this.disconnectTableObserver()
    }
  }

  /**
   * Disconnect table observer if active
   */
  disconnectTableObserver () {
    if (this.tableObserver) {
      this.tableObserver.disconnect()
      this.tableObserver = null
    }
  }

  /**
   * Process journal rows and add indicators
   * @param {NodeList} rows - Journal table rows
   */
  processJournalRows (rows) {
    console.log('Processing journal rows')

    rows.forEach((row, index) => {
      // In a real implementation, we would analyze the journal data
      // For demonstration, we'll add sample indicators based on row index

      const firstCell = row.querySelector('td:first-child')
      if (firstCell) {
        let indicatorType = ''

        // Demo logic - real implementation would check real journal data
        if (index % 3 === 0) {
          indicatorType = 'warning' // Missing final grades
        } else if (index % 5 === 0) {
          indicatorType = 'error' // Missing lessons
        } else if (index % 7 === 0) {
          indicatorType = 'info' // Other info
        }

        if (indicatorType) {
          // Only add indicator if we don't already have one
          if (!firstCell.querySelector('.ta-journal-indicator')) {
            const indicator = domService.createAndInsertElement(
              'span',
              {
                classList: ['ta-journal-indicator', indicatorType],
                title: `Sample ${indicatorType} indicator`,
              },
              '',
              firstCell,
              'afterbegin',
            )
          }
        }
      }
    })
  }
}

// Export a singleton instance
export const journalListIndicators = new JournalListIndicatorsFeature()
