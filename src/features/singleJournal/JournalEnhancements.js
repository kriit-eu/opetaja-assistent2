/**
 * Journal Enhancements Feature
 * Enhances journal entries table by replacing dates with assignment titles
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class JournalEnhancementsFeature extends BaseFeature {
  constructor () {
    super('journalEnhancements', /\/#\/journals\/(\d+)/)

    this.journalTableObserver = null
    this.tableHeaderSelector = '#main-content table thead tr th'
    this.addedStyles = null
    this.originalHeaders = new Map()
  }

  onActivate () {
    console.log('Journal Enhancements feature activated')
    this.addEnhancementStyles()
    this.setupJournalTableObserver()
  }

  onDeactivate () {
    console.log('Journal Enhancements feature deactivated')
    this.disconnectJournalTableObserver()
    this.removeEnhancementStyles()
    this.restoreOriginalHeaders()
  }

  /**
   * Add CSS styles for enhancements
   */
  addEnhancementStyles () {
    const css = `
      .ta-enhanced-header {
        white-space: normal !important;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: bold;
        position: relative;
      }

      .ta-enhanced-header .ta-original-date {
        display: block;
        font-size: 10px;
        color: #666;
        margin-top: 3px;
        font-weight: normal;
      }

      .ta-enhanced-header:hover::after {
        content: attr(data-full-title);
        position: absolute;
        top: 100%;
        left: 0;
        background: #333;
        color: white;
        padding: 5px 8px;
        border-radius: 4px;
        z-index: 100;
        white-space: normal;
        width: 200px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      }
    `

    this.addedStyles = domService.addStyles(css)
  }

  /**
   * Remove added styles on deactivation
   */
  removeEnhancementStyles () {
    if (this.addedStyles) {
      this.addedStyles.remove()
      this.addedStyles = null
    }
  }

  /**
   * Setup observer to detect journal table
   */
  setupJournalTableObserver () {
    this.disconnectJournalTableObserver()

    // Create new observer
    this.journalTableObserver = new MutationObserver(() => {
      // Check if journal table is loaded
      const tableHeaders = document.querySelectorAll(this.tableHeaderSelector)

      if (tableHeaders.length > 0) {
        this.enhanceTableHeaders(tableHeaders)
      }
    })

    // Start observing
    this.journalTableObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Also check immediately
    const tableHeaders = document.querySelectorAll(this.tableHeaderSelector)
    if (tableHeaders.length > 0) {
      this.enhanceTableHeaders(tableHeaders)
    }
  }

  /**
   * Disconnect journal table observer if active
   */
  disconnectJournalTableObserver () {
    if (this.journalTableObserver) {
      this.journalTableObserver.disconnect()
      this.journalTableObserver = null
    }
  }

  /**
   * Enhance table headers by replacing dates with assignment titles
   * @param {NodeList} headers - Table header elements
   */
  enhanceTableHeaders (headers) {
    // Skip the first column which is usually student names
    for (let i = 1; i < headers.length; i++) {
      const header = headers[i]

      // Skip if already enhanced
      if (header.classList.contains('ta-enhanced-header')) {
        continue
      }

      // Store original content
      this.originalHeaders.set(header, header.innerHTML)

      // Extract date (assuming format is something like "2025-03-30")
      const originalDate = header.textContent.trim()

      // Get assignment title for this column
      // In a real implementation, we would look up the assignment details
      // For demo purposes, we'll use sample titles
      const assignmentTitle = this.getAssignmentTitleForDate(originalDate, i)

      // Apply enhancement
      header.classList.add('ta-enhanced-header')
      header.setAttribute('data-full-title', assignmentTitle)
      header.innerHTML = `
        ${assignmentTitle}
        <span class="ta-original-date">${originalDate}</span>
      `
    }
  }

  /**
   * Get a sample assignment title for a date
   * @param {string} date - Date string
   * @param {number} index - Column index
   * @returns {string} Assignment title
   */
  getAssignmentTitleForDate (date, index) {
    // In a real implementation, we would fetch the actual assignment title
    // For demo purposes, we'll generate sample titles

    const assignments = [
      'Introduction to Programming',
      'Variables and Data Types',
      'Control Structures',
      'Functions and Methods',
      'Object-Oriented Programming',
      'Arrays and Collections',
      'Exception Handling',
      'File I/O',
      'Database Connections',
      'Web Programming Basics',
    ]

    // Use modulo to cycle through sample assignments
    return assignments[index % assignments.length]
  }

  /**
   * Restore original headers on deactivation
   */
  restoreOriginalHeaders () {
    this.originalHeaders.forEach((content, header) => {
      if (header) {
        header.innerHTML = content
        header.classList.remove('ta-enhanced-header')
        header.removeAttribute('data-full-title')
      }
    })

    this.originalHeaders.clear()
  }
}

// Export a singleton instance
export const journalEnhancements = new JournalEnhancementsFeature()
