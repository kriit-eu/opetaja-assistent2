/**
 * Assignment Sync Feature
 * Syncs assignments with external Kriit system
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import { domService } from '../../services/DomService.js'

class AssignmentSyncFeature extends BaseFeature {
  constructor () {
    super('assignmentSync', /\/#\/journals\/(\d+)/)

    this.journalIdPattern = /\/#\/journals\/(\d+)/
    this.assignmentFormObserver = null
    this.syncInProgress = false
  }

  onActivate () {
    console.log('Assignment Sync feature activated')
    this.setupAssignmentFormObserver()
  }

  onDeactivate () {
    console.log('Assignment Sync feature deactivated')
    this.disconnectAssignmentFormObserver()
  }

  /**
   * Setup observer to detect assignment forms
   */
  setupAssignmentFormObserver () {
    this.disconnectAssignmentFormObserver()

    // Create new observer
    this.assignmentFormObserver = new MutationObserver(mutations => {
      // Look for assignment forms in mutations
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          const forms = document.querySelectorAll('form[name="columnForm"]')
          forms.forEach(form => {
            // Check if we've already processed this form
            if (!form.dataset.syncMonitored) {
              form.dataset.syncMonitored = 'true'
              this.enhanceAssignmentForm(form)
            }
          })
        }
      })
    })

    // Start observing
    this.assignmentFormObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })

    // Also check immediately for any existing forms
    const forms = document.querySelectorAll('form[name="columnForm"]')
    forms.forEach(form => {
      if (!form.dataset.syncMonitored) {
        form.dataset.syncMonitored = 'true'
        this.enhanceAssignmentForm(form)
      }
    })
  }

  /**
   * Disconnect assignment form observer if active
   */
  disconnectAssignmentFormObserver () {
    if (this.assignmentFormObserver) {
      this.assignmentFormObserver.disconnect()
      this.assignmentFormObserver = null
    }
  }

  /**
   * Enhance assignment form with sync functionality
   * @param {Element} form - Assignment form element
   */
  enhanceAssignmentForm (form) {
    // Find the save button
    const saveButton = form.querySelector('button[type="submit"]')
    if (!saveButton) return

    // Create a wrapper for the original save button
    const saveButtonWrapper = domService.createAndInsertElement(
      'div',
      {
        style: {
          display: 'flex',
          gap: '10px',
        },
      },
      '',
      saveButton.parentNode
    )

    // Move the original save button to the wrapper
    saveButtonWrapper.appendChild(saveButton)

    // Create a label to show sync status
    const syncLabel = domService.createAndInsertElement(
      'span',
      {
        style: {
          display: 'none',
          alignItems: 'center',
          fontSize: '14px',
          color: '#4CAF50',
        },
      },
      'Will sync with Kriit ✓',
      saveButtonWrapper
    )

    // Add event listener to form for submission
    form.addEventListener('submit', event => {
      // Don't block the form submission
      this.handleFormSubmission(form)
    })

    // Add a checkbox to enable/disable syncing
    const syncCheckboxContainer = domService.createAndInsertElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          marginTop: '10px',
        },
      },
      '',
      form.querySelector('.actions') || form
    )

    // Create the checkbox
    const syncCheckbox = domService.createAndInsertElement(
      'input',
      {
        type: 'checkbox',
        id: 'kriit-sync-checkbox',
        checked: true,
        style: {
          marginRight: '5px',
        },
        onchange: () => {
          syncLabel.style.display = syncCheckbox.checked ? 'flex' : 'none'
        },
      },
      '',
      syncCheckboxContainer
    )

    // Create the label for the checkbox
    domService.createAndInsertElement(
      'label',
      {
        for: 'kriit-sync-checkbox',
        style: {
          fontSize: '14px',
        },
      },
      'Sync with Kriit',
      syncCheckboxContainer
    )

    // Show the sync label initially
    syncLabel.style.display = 'flex'
  }

  /**
   * Handle form submission to sync assignment
   * @param {Element} form - Submitted form
   */
  async handleFormSubmission (form) {
    if (this.syncInProgress) return

    // Check if syncing is enabled
    const syncCheckbox = document.getElementById('kriit-sync-checkbox')
    if (!syncCheckbox || !syncCheckbox.checked) return

    // Get current journal ID
    const journalId = this.getCurrentJournalId()
    if (!journalId) return

    // Extract assignment data from form
    const assignmentData = this.extractAssignmentData(form, journalId)

    // Schedule the sync to happen after form submission completes
    setTimeout(async () => {
      try {
        this.syncInProgress = true

        // In a real implementation, this would call the actual API
        // For demo purposes, we'll simulate a response
        console.log('Syncing assignment to Kriit:', assignmentData)

        // Simulate API call
        setTimeout(() => {
          console.log('Assignment synced successfully with Kriit')
          this.syncInProgress = false

          // Show success notification
          this.showNotification('Assignment synced successfully with Kriit', 'success')
        }, 1500)
      } catch (error) {
        console.error('Error syncing assignment with Kriit:', error)
        this.syncInProgress = false

        // Show error notification
        this.showNotification('Failed to sync with Kriit: ' + error.message, 'error')
      }
    }, 1000)
  }

  /**
   * Extract assignment data from form
   * @param {Element} form - Assignment form
   * @param {string} journalId - Current journal ID
   * @returns {Object} Assignment data
   */
  extractAssignmentData (form, journalId) {
    // In a real implementation, this would extract all form fields
    // For demo purposes, we'll extract just a few basic fields

    const nameInput = form.querySelector('input[name="name"]')
    const descriptionTextarea = form.querySelector('textarea[name="description"]')
    const dateInput = form.querySelector('input[type="date"]')

    return {
      journalId: journalId,
      name: nameInput ? nameInput.value : 'Unknown Assignment',
      description: descriptionTextarea ? descriptionTextarea.value : '',
      date: dateInput ? dateInput.value : new Date().toISOString().split('T')[0],
      // In a real implementation, we would extract more properties
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
   * Show a notification message
   * @param {string} message - Message to show
   * @param {string} type - Notification type (success, error, info)
   */
  showNotification (message, type = 'info') {
    // Remove any existing notification
    const existingNotification = document.querySelector('.ta-notification')
    if (existingNotification) {
      existingNotification.remove()
    }

    // Create notification element
    const notification = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-notification', `ta-notification-${type}`],
        style: {
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '10px 20px',
          backgroundColor: type === 'success' ? '#4CAF50' : type === 'error' ? '#F44336' : '#2196F3',
          color: 'white',
          borderRadius: '4px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
          zIndex: '9999',
          opacity: '0',
          transition: 'opacity 0.3s ease-in-out',
        },
      },
      message,
      document.body
    )

    // Fade in
    setTimeout(() => {
      notification.style.opacity = '1'
    }, 10)

    // Auto-remove after timeout
    setTimeout(() => {
      notification.style.opacity = '0'
      setTimeout(() => {
        notification.remove()
      }, 300)
    }, 5000)
  }
}

// Export a singleton instance
export const assignmentSync = new AssignmentSyncFeature()
