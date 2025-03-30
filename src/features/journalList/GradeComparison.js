/**
 * Grade Comparison Feature
 * Compares grades with external system and displays discrepancies
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class GradeComparisonFeature extends BaseFeature {
  constructor () {
    super('gradeComparison', /\/#\/journals\?_menu/)

    this.tableObserver = null
    this.journalRowsSelector = '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr'
    this.modalContainer = null
    this.addedStyles = null
  }

  onActivate () {
    console.log('Grade Comparison feature activated')
    this.addComparisonStyles()
    this.setupTableObserver()
    this.addComparisonButton()
  }

  onDeactivate () {
    console.log('Grade Comparison feature deactivated')
    this.disconnectTableObserver()
    this.removeComparisonButton()
    this.removeComparisonStyles()
    this.closeComparisonModal()
  }

  /**
   * Add CSS styles for comparison UI
   */
  addComparisonStyles () {
    const css = `
      .ta-comparison-button {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: #2196F3;
        color: white;
        border: none;
        border-radius: 50%;
        width: 56px;
        height: 56px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        cursor: pointer;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ta-comparison-button:hover {
        background-color: #1976D2;
      }

      .ta-modal-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
      }

      .ta-modal-content {
        background-color: white;
        border-radius: 4px;
        max-width: 80%;
        max-height: 80%;
        overflow-y: auto;
        padding: 20px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }

      .ta-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #e0e0e0;
        padding-bottom: 10px;
        margin-bottom: 15px;
      }

      .ta-modal-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
      }

      .ta-discrepancy-item {
        padding: 10px;
        margin-bottom: 10px;
        border-left: 3px solid #f44336;
        background-color: #ffebee;
      }

      .ta-update-button {
        background-color: #4CAF50;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 10px;
      }

      .ta-update-button:hover {
        background-color: #388E3C;
      }
    `

    this.addedStyles = domService.addStyles(css)
  }

  /**
   * Remove added styles on deactivation
   */
  removeComparisonStyles () {
    if (this.addedStyles) {
      this.addedStyles.remove()
      this.addedStyles = null
    }
  }

  /**
   * Add comparison button to the page
   */
  addComparisonButton () {
    const buttonContainer = document.querySelector('.ta-comparison-button')
    if (!buttonContainer) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-comparison-button'],
          title: 'Compare Grades with External System',
          onclick: () => this.compareGrades(),
        },
        '<strong>C</strong>',
        document.body
      )
    }
  }

  /**
   * Remove comparison button
   */
  removeComparisonButton () {
    const button = document.querySelector('.ta-comparison-button')
    if (button) {
      button.remove()
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
        this.disconnectTableObserver()
        this.addComparisonButton()
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
      this.disconnectTableObserver()
      this.addComparisonButton()
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
   * Extract journal data from the table
   * @returns {Array} Array of journal data
   */
  extractJournalData () {
    const rows = document.querySelectorAll(this.journalRowsSelector)
    const journals = []

    rows.forEach(row => {
      const linkElement = row.querySelector('td:nth-child(2) a')
      if (linkElement) {
        const href = linkElement.getAttribute('href')
        const journalId = href.match(/\/journals\/(\d+)/)?.[1]

        if (journalId) {
          journals.push({
            id: journalId,
            name: linkElement.textContent.trim(),
            // In a real implementation, we would extract more data
            // such as grades, but for now we'll use sample data
            grades: [],
          })
        }
      }
    })

    return journals
  }

  /**
   * Compare grades with external system
   */
  async compareGrades () {
    try {
      const journalData = this.extractJournalData()

      // Show loading modal
      this.showComparisonModal('Loading...', true)

      // In a real implementation, this would call the actual API
      // For demo purposes, we'll simulate a response with setTimeout
      setTimeout(() => {
        // Mock discrepancies for demonstration
        const discrepancies = [
          {
            journalId: journalData[0]?.id || '12345',
            journalName: journalData[0]?.name || 'Sample Journal',
            studentName: 'John Smith',
            tahvelGrade: '4',
            externalGrade: '5',
            reason: 'Grade mismatch',
          },
          {
            journalId: journalData[1]?.id || '67890',
            journalName: journalData[1]?.name || 'Another Journal',
            studentName: 'Jane Doe',
            tahvelGrade: '3',
            externalGrade: '4',
            reason: 'Grade mismatch',
          },
        ]

        this.displayDiscrepancies(discrepancies)
      }, 1000)
    } catch (error) {
      console.error('Error comparing grades:', error)
      this.showComparisonModal('Error comparing grades: ' + error.message)
    }
  }

  /**
   * Show comparison modal with content
   * @param {string} content - Modal content
   * @param {boolean} isLoading - Whether this is a loading state
   */
  showComparisonModal (content, isLoading = false) {
    this.closeComparisonModal()

    this.modalContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-modal-container'],
        onclick: e => {
          if (e.target === this.modalContainer) {
            this.closeComparisonModal()
          }
        },
      },
      '',
      document.body
    )

    const modalContent = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-modal-content'],
      },
      '',
      this.modalContainer
    )

    if (!isLoading) {
      const modalHeader = domService.createAndInsertElement(
        'div',
        {
          classList: ['ta-modal-header'],
        },
        '',
        modalContent
      )

      domService.createAndInsertElement('h2', {}, 'Grade Discrepancies', modalHeader)

      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-modal-close'],
          onclick: () => this.closeComparisonModal(),
        },
        '×',
        modalHeader
      )
    }

    domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-modal-body'],
      },
      content,
      modalContent
    )
  }

  /**
   * Display discrepancies in the modal
   * @param {Array} discrepancies - Array of grade discrepancies
   */
  displayDiscrepancies (discrepancies) {
    if (discrepancies.length === 0) {
      this.showComparisonModal('<p>No grade discrepancies found.</p>')
      return
    }

    this.showComparisonModal('')
    const modalBody = this.modalContainer.querySelector('.ta-modal-body')

    discrepancies.forEach(discrepancy => {
      const item = domService.createAndInsertElement(
        'div',
        {
          classList: ['ta-discrepancy-item'],
        },
        '',
        modalBody
      )

      domService.createAndInsertElement('h3', {}, `${discrepancy.journalName} - ${discrepancy.studentName}`, item)

      domService.createAndInsertElement(
        'p',
        {},
        `Tahvel Grade: ${discrepancy.tahvelGrade}, External Grade: ${discrepancy.externalGrade}`,
        item
      )

      domService.createAndInsertElement('p', {}, `Reason: ${discrepancy.reason}`, item)

      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-update-button'],
          onclick: () => this.updateGrade(discrepancy),
        },
        'Update in Tahvel',
        item
      )
    })
  }

  /**
   * Close the comparison modal
   */
  closeComparisonModal () {
    if (this.modalContainer) {
      this.modalContainer.remove()
      this.modalContainer = null
    }
  }

  /**
   * Update a grade in Tahvel
   * @param {Object} discrepancy - Grade discrepancy to update
   */
  updateGrade (discrepancy) {
    // In a real implementation, this would update the grade in Tahvel
    // For now, we'll just show an alert
    alert(
      `Grade for ${discrepancy.studentName} would be updated from ${discrepancy.tahvelGrade} to ${discrepancy.externalGrade}`
    )
  }
}

// Export a singleton instance
export const gradeComparison = new GradeComparisonFeature()
