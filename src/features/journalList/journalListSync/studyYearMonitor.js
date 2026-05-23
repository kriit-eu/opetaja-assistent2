/**
 * Study-year reading + table-mutation monitoring.
 *
 *  - getSelectedStudyYear: read the year text from the Tahvel dropdown.
 *  - getStudyYearIdFromText: turn that text into an ID via the API.
 *  - setupStudyYearMonitoring: attach a click listener to the search button
 *    and refetch journal data once the table redraws.
 *  - waitForTableUpdate: MutationObserver-based promise that resolves when
 *    the journal table redraws (or after a 10s fallback).
 *
 * Stateful helpers take the feature instance — they read feature.api and
 * write feature.lastStudyYear / feature.tableObserver, and call back into
 * feature.fetchJournalData / feature.waitForTableUpdate. No banner concerns
 * here; no Kriit transport.
 */

import Logger from '../../../services/Logger.js'
import { resolveStudyYearIdFromText } from '../../../lib/studyYear.js'

export function getSelectedStudyYear() {
  const studyYearSelector = document.querySelector('.selected-option.ng-tns-c929221873-0')
  if (studyYearSelector) {
    const yearText = studyYearSelector.textContent.trim()
    Logger.debug('Selected study year from dropdown:', yearText)
    return yearText
  }
  Logger.debug('Study year selector not found in DOM')
  return null
}

export async function getStudyYearIdFromText(api, yearText) {
  if (!yearText) return null

  try {
    const yearId = await resolveStudyYearIdFromText(api, yearText)
    if (yearId) {
      Logger.debug(`Resolved study year "${yearText}" to ID: ${yearId}`)
      return yearId
    }
  } catch (err) {
    Logger.warning('Failed to resolve study year ID from text:', err.message)
  }

  return null
}

export function setupStudyYearMonitoring(feature) {
  feature.lastStudyYear = getSelectedStudyYear()
  Logger.debug('Initial study year:', feature.lastStudyYear)

  const submitButton = document.querySelector('button[type="submit"]')
  if (!submitButton) {
    Logger.debug('Submit button not found for study year monitoring')
    return
  }

  submitButton.addEventListener('click', () => {
    Logger.debug('Submit button clicked - monitoring for table changes')
    waitForTableUpdate(feature)
      .then(() => {
        Logger.debug('Table updated - refreshing journal sync data')
        feature.fetchJournalData()
      })
      .catch(err => {
        Logger.warning('Error waiting for table update:', err)
        setTimeout(() => feature.fetchJournalData(), 2000)
      })
  })

  Logger.debug('Study year monitoring set up successfully')
}

export function waitForTableUpdate(feature) {
  return new Promise((resolve, _reject) => {
    let timeout
    const timeoutDuration = 10000

    const findTableContainer = () => {
      const selectors = [
        'md-table-container',
        '#main-content md-table-container',
        'md-table-container table',
        '#main-content table',
        '[role="table"]',
        'table tbody'
      ]

      for (const selector of selectors) {
        const element = document.querySelector(selector)
        if (element) {
          Logger.debug(`Found table container with selector: ${selector}`)
          return element
        }
      }
      return null
    }

    let tableContainer = findTableContainer()

    const setupObserver = container => {
      if (feature.tableObserver) {
        feature.tableObserver.disconnect()
      }

      feature.tableObserver = new MutationObserver(mutations => {
        const hasTableChanges = mutations.some(
          mutation =>
            mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0 || mutation.type === 'characterData' || mutation.type === 'attributes'
        )

        if (hasTableChanges) {
          Logger.debug('Table content changed - mutations detected')
          clearTimeout(timeout)
          if (feature.tableObserver) {
            feature.tableObserver.disconnect()
          }
          setTimeout(() => resolve(), 500)
        }
      })

      feature.tableObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      })

      timeout = setTimeout(() => {
        Logger.debug('Table update timeout - proceeding anyway')
        if (feature.tableObserver) {
          feature.tableObserver.disconnect()
        }
        resolve()
      }, timeoutDuration)
    }

    if (!tableContainer) {
      Logger.debug('Table container not found immediately, waiting 500ms...')
      setTimeout(() => {
        tableContainer = findTableContainer()

        if (!tableContainer) {
          Logger.warning('Table container not found after delay - using fallback timeout')
          timeout = setTimeout(() => {
            Logger.debug('Fallback timeout - proceeding with refresh')
            resolve()
          }, 2000)
          return
        }

        setupObserver(tableContainer)
      }, 500)
      return
    }

    setupObserver(tableContainer)
  })
}
