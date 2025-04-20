/**
 * Journal List Sync Feature
 *
 * Syncs data between Tahvel and Kriit:
 * - Assignments and their grades
 * - Students and their personal codes
 * - Student statuses (active/inactive)
 *
 * Displays a banner on journal list page showing differences that need to be synced
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'
import Logger from '../../services/Logger.js'
import { apiService } from '../../services/ApiService.js'
import { styleService } from '../../services/StyleService.js'

class JournalListSyncFeature extends BaseFeature {
  constructor () {
    // Match the journal list page URL pattern
    super('journalListSync', /#\/journals\?_menu/)

    // Initialize state
    this.differences = null
    this.isLoading = false
    this.error = null
    this.syncBanner = null
  }

  /**
   * Called when the feature is activated
   */
  onActivate () {
    Logger.feature(this.name, 'Activated')

    // Load CSS
    this.loadStyles()

    // Set Kriit API token (hardcoded for now, should be configurable)
    apiService.kriit.setAuthToken('Mu5jS13o8mqdIKOoH1ZTgXdcZ1LQiob')

    // Fetch journal data
    this.fetchJournalData()
  }

  /**
   * Load CSS styles for the feature
   */
  loadStyles () {
    const css = `
      .ta-sync-banner {
        background-color: #e6f3ff;
        border: 1px solid #b3d9ff;
        border-radius: 4px;
        margin: 10px;
        padding: 15px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        max-width: 800px;
        margin-left: auto;
        margin-right: auto;
      }

      .ta-sync-loading {
        background-color: #f8f9fa;
        color: #6c757d;
        text-align: center;
        padding: 20px;
      }

      .ta-sync-error {
        background-color: #f8d7da;
        border-color: #f5c6cb;
        color: #721c24;
      }

      .ta-sync-title {
        color: #0056b3;
        font-size: 1.5rem;
        margin-top: 0;
        margin-bottom: 10px;
      }

      .ta-sync-divider {
        border: 0;
        border-top: 1px solid #b3d9ff;
        margin: 10px 0;
      }

      .ta-sync-differences-container {
        margin-top: 15px;
      }

      .ta-sync-subject-section {
        margin-bottom: 20px;
      }

      .ta-sync-subject-title {
        color: #0056b3;
        font-size: 1.2rem;
        margin-bottom: 10px;
      }

      .ta-sync-assignment-section {
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        margin-bottom: 15px;
        padding: 10px;
      }

      .ta-sync-assignment-title {
        color: #495057;
        font-size: 1rem;
        margin-top: 0;
        margin-bottom: 10px;
      }

      .ta-sync-results-container {
        margin-left: 10px;
      }

      .ta-sync-result-row {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid #eee;
      }

      .ta-sync-result-row:last-child {
        border-bottom: none;
      }

      .ta-sync-student-name {
        font-weight: 500;
      }

      .ta-sync-grade-difference {
        display: flex;
        align-items: center;
      }

      .ta-sync-current-grade {
        color: #6c757d;
      }

      .ta-sync-arrow {
        color: #6c757d;
        margin: 0 5px;
      }

      .ta-sync-new-grade {
        color: #007bff;
        font-weight: bold;
      }

      .ta-sync-button {
        background-color: #007bff;
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        font-size: 1rem;
        margin-top: 10px;
        padding: 8px 16px;
        transition: background-color 0.2s;
      }

      .ta-sync-button:hover {
        background-color: #0069d9;
      }
    `

    styleService.injectCSS(css, 'journal-list-sync-styles')
  }

  /**
   * Called when the feature is deactivated
   */
  onDeactivate () {
    Logger.feature(this.name, 'Deactivated')
    this.removeSyncBanner()
    styleService.removeCSS('journal-list-sync-styles')
  }

  /**
   * Fetch journal data from Tahvel and check for differences with Kriit
   */
  async fetchJournalData () {
    try {
      this.isLoading = true
      this.updateUI()

      // TODO: Implement data collection from Tahvel
      const journalData = await this.collectJournalData()

      // Send data to Kriit and get differences
      const differences = await apiService.kriit.getDifferences(journalData)

      this.differences = differences
      this.isLoading = false
      this.error = null

      Logger.debug('Differences from Kriit:', this.differences)
      this.updateUI()
    } catch (error) {
      Logger.error('Error fetching journal data:', error)
      this.isLoading = false
      this.error = error.message || 'Failed to fetch data'
      this.updateUI()
    }
  }

  /**
   * Collect journal data from Tahvel
   * @returns {Promise<Array>} Array of journal data objects
   */
  async collectJournalData () {
    try {
      Logger.debug('Collecting journal data from Tahvel')

      // For testing purposes, we'll use a mock data structure
      // In a real implementation, this would extract data from the Tahvel DOM

      // Get teacher info (in real implementation, extract from Tahvel)
      const teacherName = 'Henno Täht'
      const teacherPersonalCode = '38010050352'

      // Mock data for testing - this would be extracted from the DOM in real implementation
      const mockData = [
        {
          subjectName: 'Märgendikeeled',
          subjectExternalId: 348995,
          groupName: 'TAK24',
          teacherPersonalCode: teacherPersonalCode,
          teacherName: teacherName,
          assignments: [
            {
              assignmentExternalId: 3222337,
              assignmentName: 'Loo HTML fail, mis kasutab või... (ÕV1) (Iseseisev töö)',
              assignmentInstructions: '',
              assignmentDueAt: null,
              results: [
                {
                  grade: 'A',
                  studentPersonalCode: '50409020827',
                  studentName: 'Efe Marko Güldere',
                  studentIsActive: true
                }
              ]
            }
          ]
        }
      ]

      // In a real implementation, we would:
      // 1. Extract all journals from the journal list page
      // 2. For each journal, extract assignments and grades
      // 3. Format the data according to the Kriit API requirements

      return mockData
    } catch (error) {
      Logger.error('Error collecting journal data:', error)
      throw error
    }
  }

  /**
   * Update the UI based on current state
   */
  updateUI () {
    this.removeSyncBanner()

    if (this.isLoading) {
      this.showLoadingBanner()
      return
    }

    if (this.error) {
      this.showErrorBanner()
      return
    }

    if (this.differences && this.differences.length > 0) {
      this.showDifferencesBanner()
    }
  }

  /**
   * Show loading banner
   */
  showLoadingBanner () {
    this.syncBanner = domService.createAndInsertElement('div', {
      classList: ['ta-sync-banner', 'ta-sync-loading'],
    }, 'Loading journal data...', document.body, 'afterbegin')
  }

  /**
   * Show error banner
   */
  showErrorBanner () {
    this.syncBanner = domService.createAndInsertElement('div', {
      classList: ['ta-sync-banner', 'ta-sync-error'],
    }, `Error: ${this.error}`, document.body, 'afterbegin')
  }

  /**
   * Show differences banner
   */
  showDifferencesBanner () {
    // Create main banner container
    this.syncBanner = domService.createAndInsertElement('div', {
      classList: ['ta-sync-banner'],
    }, '', document.body, 'afterbegin')

    // Add title
    domService.createAndInsertElement('h2', {
      classList: ['ta-sync-title'],
    }, 'Sünkroniseerimata hinded', this.syncBanner)

    // Add horizontal rule
    domService.createAndInsertElement('hr', {
      classList: ['ta-sync-divider'],
    }, '', this.syncBanner)

    // Add differences content
    this.renderDifferences()

    // Add sync button
    const totalDifferences = this.countTotalDifferences()
    domService.createAndInsertElement('button', {
      classList: ['ta-sync-button'],
      onclick: () => this.syncWithKriit(),
    }, `Sünkroniseeri ${totalDifferences} erinevat hinnet Kriidist`, this.syncBanner)
  }

  /**
   * Count total number of differences
   * @returns {number} Total number of differences
   */
  countTotalDifferences () {
    let count = 0

    if (!this.differences) return 0

    this.differences.forEach(subject => {
      subject.assignments.forEach(assignment => {
        count += assignment.results.length
      })
    })

    return count
  }

  /**
   * Render differences in the banner
   */
  renderDifferences () {
    if (!this.differences || !this.syncBanner) return

    const container = domService.createAndInsertElement('div', {
      classList: ['ta-sync-differences-container'],
    }, '', this.syncBanner)

    // Render each subject
    this.differences.forEach(subject => {
      // Create subject section
      const subjectSection = domService.createAndInsertElement('div', {
        classList: ['ta-sync-subject-section'],
      }, '', container)

      // Add subject title
      domService.createAndInsertElement('h3', {
        classList: ['ta-sync-subject-title'],
      }, subject.subjectName || `Subject ID: ${subject.subjectExternalId}`, subjectSection)

      // Render assignments for this subject
      subject.assignments.forEach(assignment => {
        this.renderAssignment(assignment, subjectSection)
      })
    })
  }

  /**
   * Render a single assignment with its differences
   * @param {Object} assignment Assignment data
   * @param {Element} container Container element
   */
  renderAssignment (assignment, container) {
    // Create assignment section
    const assignmentSection = domService.createAndInsertElement('div', {
      classList: ['ta-sync-assignment-section'],
    }, '', container)

    // Add assignment title
    domService.createAndInsertElement('h4', {
      classList: ['ta-sync-assignment-title'],
    }, assignment.assignmentName || `Assignment ID: ${assignment.assignmentExternalId}`, assignmentSection)

    // Create results container
    const resultsContainer = domService.createAndInsertElement('div', {
      classList: ['ta-sync-results-container'],
    }, '', assignmentSection)

    // Render each result
    assignment.results.forEach(result => {
      const resultRow = domService.createAndInsertElement('div', {
        classList: ['ta-sync-result-row'],
      }, '', resultsContainer)

      // Student name
      domService.createAndInsertElement('span', {
        classList: ['ta-sync-student-name'],
      }, result.studentName, resultRow)

      // Grade difference
      const gradeDisplay = domService.createAndInsertElement('span', {
        classList: ['ta-sync-grade-difference'],
      }, '', resultRow)

      // Format: (current) → new
      const currentGrade = result.currentGrade || '(puudub)'
      domService.createAndInsertElement('span', {
        classList: ['ta-sync-current-grade'],
      }, currentGrade, gradeDisplay)

      domService.createAndInsertElement('span', {
        classList: ['ta-sync-arrow'],
      }, ' → ', gradeDisplay)

      domService.createAndInsertElement('span', {
        classList: ['ta-sync-new-grade'],
      }, result.grade, gradeDisplay)
    })
  }

  /**
   * Remove sync banner from the DOM
   */
  removeSyncBanner () {
    if (this.syncBanner && this.syncBanner.parentNode) {
      this.syncBanner.parentNode.removeChild(this.syncBanner)
      this.syncBanner = null
    }
  }

  /**
   * Sync data with Kriit
   */
  async syncWithKriit () {
    // TODO: Implement sync functionality
    Logger.feature(this.name, 'Syncing with Kriit...')

    try {
      // Placeholder for sync implementation
      await new Promise(resolve => setTimeout(resolve, 1000))

      // After successful sync, refresh data
      this.fetchJournalData()
    } catch (error) {
      Logger.error('Error syncing with Kriit:', error)
      this.error = error.message || 'Failed to sync with Kriit'
      this.updateUI()
    }
  }
}

// Export a singleton instance
export const journalListSync = new JournalListSyncFeature()
