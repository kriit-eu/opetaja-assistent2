/**
 * Final Grading Feature
 * Adds automatic final grade calculation functionality
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class FinalGradingFeature extends BaseFeature {
  constructor () {
    super('finalGrading', /\/#\/journals\/(\d+)/)

    this.journalContentObserver = null
    this.addedStyles = null
    this.gradingType = null // 'binary' or 'numerical'
  }

  onActivate () {
    this.addFinalGradingStyles()
    this.setupJournalObserver()
  }

  onDeactivate () {
    this.disconnectJournalObserver()
    this.removeFinalGradingStyles()
    this.removeFinalGradingButton()
  }

  /**
   * Add CSS styles for final grading UI
   */
  addFinalGradingStyles () {
    const css = `
      .ta-final-grade-button {
        margin: 15px 0;
        background-color: #2196F3;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: 500;
      }

      .ta-final-grade-button:hover {
        background-color: #1976D2;
      }

      .ta-final-grade-container {
        margin: 10px 0;
        padding: 15px;
        background-color: #E3F2FD;
        border-radius: 4px;
        border-left: 4px solid #2196F3;
      }

      .ta-grade-preview {
        margin-top: 10px;
        background-color: white;
        padding: 10px;
        border-radius: 4px;
        max-height: 300px;
        overflow-y: auto;
      }

      .ta-grade-preview-item {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid #e0e0e0;
      }

      .ta-grade-preview-item:last-child {
        border-bottom: none;
      }

      .ta-apply-grades-button {
        margin-top: 10px;
        background-color: #4CAF50;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
      }

      .ta-apply-grades-button:hover {
        background-color: #388E3C;
      }
    `

    this.addedStyles = domService.addStyles(css)
  }

  /**
   * Remove added styles on deactivation
   */
  removeFinalGradingStyles () {
    if (this.addedStyles) {
      this.addedStyles.remove()
      this.addedStyles = null
    }
  }

  /**
   * Setup observer to detect when journal content loads
   */
  setupJournalObserver () {
    this.disconnectJournalObserver()

    // Create new observer
    this.journalContentObserver = new MutationObserver(() => {
      // Check if journal content is loaded
      const journalHeading = document.querySelector('#main-content md-card md-toolbar')

      if (journalHeading) {
        this.disconnectJournalObserver()
        this.insertFinalGradingButton()
      }
    })

    // Start observing
    this.journalContentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Also check immediately
    const journalHeading = document.querySelector('#main-content md-card md-toolbar')
    if (journalHeading) {
      this.disconnectJournalObserver()
      this.insertFinalGradingButton()
    }
  }

  /**
   * Disconnect journal observer if active
   */
  disconnectJournalObserver () {
    if (this.journalContentObserver) {
      this.journalContentObserver.disconnect()
      this.journalContentObserver = null
    }
  }

  /**
   * Insert final grading button into journal page
   */
  insertFinalGradingButton () {
    this.removeFinalGradingButton()

    // Find a suitable place to insert the button
    const journalActions = document.querySelector('#main-content md-card md-card-content')
    if (!journalActions) return

    // Create the button
    domService.createAndInsertElement(
      'button',
      {
        classList: ['ta-final-grade-button'],
        onclick: () => this.handleFinalGradingClick(),
      },
      'Update Final Grades',
      journalActions,
      'afterbegin'
    )

    // Detect grading type
    this.detectGradingType()
  }

  /**
   * Remove final grading button
   */
  removeFinalGradingButton () {
    const button = document.querySelector('.ta-final-grade-button')
    if (button) {
      button.remove()
    }

    const container = document.querySelector('.ta-final-grade-container')
    if (container) {
      container.remove()
    }
  }

  /**
   * Detect the type of grading used in this journal
   * (binary: pass/fail or numerical: 1-5)
   */
  detectGradingType () {
    // Look for indicators of grading type
    // In a real implementation, we would inspect actual grading fields
    // For demo purposes, we'll use a simple heuristic

    const gradeInputs = document.querySelectorAll('select.grade-select, input.grade-input')
    let hasBinary = false
    let hasNumerical = false

    gradeInputs.forEach(input => {
      // Check for select options or input values
      if (input.tagName === 'SELECT') {
        const options = Array.from(input.options).map(opt => opt.value)
        if (options.includes('PASS') || options.includes('FAIL')) {
          hasBinary = true
        }
        if (options.some(opt => /^[1-5]$/.test(opt))) {
          hasNumerical = true
        }
      }
    })

    // Determine grading type based on what we found
    if (hasBinary && !hasNumerical) {
      this.gradingType = 'binary'
    } else {
      // Default to numerical if we can't determine or if both are present
      this.gradingType = 'numerical'
    }

    console.log(`Detected grading type: ${this.gradingType}`)
  }

  /**
   * Handle click on final grading button
   */
  handleFinalGradingClick () {
    // Remove any existing container
    const existingContainer = document.querySelector('.ta-final-grade-container')
    if (existingContainer) {
      existingContainer.remove()
      return
    }

    // Create container for final grading UI
    const container = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-final-grade-container'],
      },
      '',
      document.querySelector('.ta-final-grade-button'),
      'afterend'
    )

    // Add explanation text
    domService.createAndInsertElement(
      'p',
      {},
      `This will automatically calculate and apply final grades based on ${
        this.gradingType === 'binary'
          ? 'whether all assignments are marked as "pass"'
          : 'the average of all numerical grades'
      }.`,
      container
    )

    // Get calculated grades (sample data for demo)
    const grades = this.calculateFinalGrades()

    // Create preview area
    const previewArea = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-grade-preview'],
      },
      '',
      container
    )

    // Add header
    domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-grade-preview-item'],
        style: { fontWeight: 'bold' },
      },
      '<span>Student</span><span>Final Grade</span>',
      previewArea
    )

    // Add grade previews
    grades.forEach(grade => {
      domService.createAndInsertElement(
        'div',
        {
          classList: ['ta-grade-preview-item'],
        },
        `<span>${grade.studentName}</span><span>${grade.finalGrade}</span>`,
        previewArea
      )
    })

    // Add apply button
    domService.createAndInsertElement(
      'button',
      {
        classList: ['ta-apply-grades-button'],
        onclick: () => this.applyFinalGrades(grades),
      },
      'Apply Final Grades',
      container
    )
  }

  /**
   * Calculate final grades for all students
   * @returns {Array} Array of student grades
   */
  calculateFinalGrades () {
    // In a real implementation, this would analyze actual grades
    // For demo purposes, we'll use sample data

    return [
      {
        studentId: '1',
        studentName: 'John Smith',
        assignments: [5, 4, 4, 5],
        finalGrade: this.gradingType === 'binary' ? 'PASS' : '5',
      },
      {
        studentId: '2',
        studentName: 'Jane Doe',
        assignments: [3, 4, 3, 4],
        finalGrade: this.gradingType === 'binary' ? 'PASS' : '4',
      },
      {
        studentId: '3',
        studentName: 'Bob Johnson',
        assignments: [2, 3, 'FAIL', 4],
        finalGrade: this.gradingType === 'binary' ? 'FAIL' : '3',
      },
      {
        studentId: '4',
        studentName: 'Alice Williams',
        assignments: [5, 5, 4, 5],
        finalGrade: this.gradingType === 'binary' ? 'PASS' : '5',
      },
    ]
  }

  /**
   * Apply final grades to the journal
   * @param {Array} grades - Final grades to apply
   */
  applyFinalGrades (grades) {
    // In a real implementation, this would update the actual grades in the UI
    // For demo purposes, we'll just show an alert

    alert(`Final grades would be applied for ${grades.length} students.`)

    // Remove the container after applying
    const container = document.querySelector('.ta-final-grade-container')
    if (container) {
      container.remove()
    }
  }
}

// Export a singleton instance
export const finalGrading = new FinalGradingFeature()
