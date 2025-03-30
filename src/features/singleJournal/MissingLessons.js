/**
 * Missing Lessons Feature
 * Shows a list of lessons that appear in timetable but not in journal
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class MissingLessonsFeature extends BaseFeature {
  constructor () {
    super('missingLessons', /\/#\/journals\/(\d+)/)

    this.journalContentObserver = null
    this.journalIdPattern = /\/#\/journals\/(\d+)/
    this.addedStyles = null
    this.missingLessonsContainer = null
  }

  onActivate () {
    this.addMissingLessonsStyles()
    this.setupJournalObserver()
  }

  onDeactivate () {
    this.disconnectJournalObserver()
    this.removeMissingLessonsStyles()
    this.removeMissingLessonsUI()
  }

  /**
   * Add CSS styles for missing lessons UI
   */
  addMissingLessonsStyles () {
    const css = `
      .ta-missing-lessons-container {
        margin: 10px 0;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 15px;
        background-color: #f5f5f5;
      }

      .ta-missing-lessons-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .ta-missing-lessons-title {
        margin: 0;
        color: #333;
      }

      .ta-missing-lesson-item {
        background-color: white;
        padding: 8px 12px;
        margin-bottom: 8px;
        border-radius: 4px;
        border-left: 3px solid #ff9800;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .ta-add-lesson-button {
        background-color: #4CAF50;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
      }

      .ta-add-lesson-button:hover {
        background-color: #388E3C;
      }
    `

    this.addedStyles = domService.addStyles(css)
  }

  /**
   * Remove added styles on deactivation
   */
  removeMissingLessonsStyles () {
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
      const journalContent = document.querySelector('#main-content md-card')

      if (journalContent) {
        this.disconnectJournalObserver()
        this.insertMissingLessonsUI()
      }
    })

    // Start observing
    this.journalContentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Also check immediately
    const journalContent = document.querySelector('#main-content md-card')
    if (journalContent) {
      this.disconnectJournalObserver()
      this.insertMissingLessonsUI()
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
   * Get current journal ID from URL
   * @returns {string|null} Journal ID or null if not found
   */
  getCurrentJournalId () {
    const match = window.location.href.match(this.journalIdPattern)
    return match ? match[1] : null
  }

  /**
   * Insert missing lessons UI into page
   */
  insertMissingLessonsUI () {
    this.removeMissingLessonsUI()

    const journalContent = document.querySelector('#main-content md-card')
    if (!journalContent) return

    // Create container for missing lessons UI
    this.missingLessonsContainer = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-missing-lessons-container'],
      },
      '',
      journalContent,
      'afterbegin'
    )

    // Create header
    const header = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-missing-lessons-header'],
      },
      '',
      this.missingLessonsContainer
    )

    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-missing-lessons-title'],
      },
      'Missing Lessons',
      header
    )

    // In a real implementation, we would fetch missing lessons from timetable
    // For demo purposes, we'll show sample missing lessons
    this.showMissingLessons(this.getSampleMissingLessons())
  }

  /**
   * Remove missing lessons UI
   */
  removeMissingLessonsUI () {
    if (this.missingLessonsContainer) {
      this.missingLessonsContainer.remove()
      this.missingLessonsContainer = null
    }
  }

  /**
   * Get sample missing lessons for demonstration
   * @returns {Array} Sample missing lessons
   */
  getSampleMissingLessons () {
    return [
      {
        id: '12345',
        date: '2025-03-25',
        startTime: '09:00',
        endTime: '10:30',
        topic: 'Introduction to JavaScript',
      },
      {
        id: '67890',
        date: '2025-03-27',
        startTime: '09:00',
        endTime: '10:30',
        topic: 'Advanced JavaScript Concepts',
      },
    ]
  }

  /**
   * Display missing lessons in the UI
   * @param {Array} missingLessons - Array of missing lessons
   */
  showMissingLessons (missingLessons) {
    if (!this.missingLessonsContainer) return

    if (missingLessons.length === 0) {
      domService.createAndInsertElement('p', {}, 'No missing lessons found.', this.missingLessonsContainer)
      return
    }

    missingLessons.forEach(lesson => {
      const item = domService.createAndInsertElement(
        'div',
        {
          classList: ['ta-missing-lesson-item'],
        },
        '',
        this.missingLessonsContainer
      )

      domService.createAndInsertElement(
        'div',
        {},
        `${lesson.date} (${lesson.startTime} - ${lesson.endTime}): ${lesson.topic}`,
        item
      )

      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-add-lesson-button'],
          onclick: () => this.addLessonToJournal(lesson),
        },
        'Add to Journal',
        item
      )
    })
  }

  /**
   * Add a missing lesson to the journal
   * @param {Object} lesson - Missing lesson to add
   */
  addLessonToJournal (lesson) {
    // In a real implementation, this would add the lesson to the journal
    // For now, we'll just show an alert
    alert(`Lesson "${lesson.topic}" on ${lesson.date} would be added to the journal.`)
  }
}

// Export a singleton instance
export const missingLessons = new MissingLessonsFeature()
