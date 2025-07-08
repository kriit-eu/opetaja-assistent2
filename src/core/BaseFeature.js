/**
 * Base Feature - Template for all features to extend
 */

import Logger from '../services/Logger.js'
import { domService } from '../services/DomService.js'
import { ApiService } from '../services/ApiService.js'

/**
 * Get the current Tahvel base URL based on the current domain
 */
function getTahvelBaseUrl() {
  const hostname = window.location.hostname
  if (hostname.includes('test.tahvel.eenet.ee')) {
    return 'https://test.tahvel.eenet.ee/hois_back'
  }
  return 'https://tahvel.edu.ee/hois_back'

}

/**
 * Centralized API configuration
 */
export const api = {
  // Tahvel API instance - baseUrl is dynamic based on current domain
  tahvel: new ApiService({
    name: 'tahvel',
    baseUrl: getTahvelBaseUrl(),
  }),

  // Kriit API instance - baseUrl will be set from user settings
  kriit: new ApiService({
    name: 'kriit',
    baseUrl: '', // Empty by default, will be set from chrome.storage.sync
    defaultHeaders: {
      'Accept': 'application/json',
    },
  }),
}

export class BaseFeature {
  constructor(name, urlPattern, requiredSelectors = null) {
    this.name = name
    this.urlPattern = urlPattern
    this.requiredSelectors = requiredSelectors
    this.isActive = false
    this.elementsObserver = null

    // Make API instances available to all features
    this.api = api

    // Initialize Kriit API base URL from storage
    this.initializeKriitApi()

    Logger.debug(`Feature "${name}" created`)
  }

  /**
   * Check if this feature should be activated for the current URL
   * @param {string} url - Current URL
   * @returns {boolean} True if should activate
   */
  shouldActivate(url) {
    if (typeof this.urlPattern === 'string') {
      return url.includes(this.urlPattern)
    } else if (this.urlPattern instanceof RegExp) {
      return this.urlPattern.test(url)
    } else if (typeof this.urlPattern === 'function') {
      return this.urlPattern(url)
    }
    return false
  }

  /**
   * Activate the feature
   */
  activate() {
    // Skip if already active
    if (this.isActive) return

    // Mark as active
    this.isActive = true
    Logger.feature(this.name, 'Base activation complete - initializing feature')

    // If we have required selectors, wait for them before calling onActivate
    if (this.requiredSelectors) {
      Logger.debug(`Feature ${this.name} waiting for required elements: ${this.requiredSelectors}`)

      // Set up observer for required elements
      this.elementsObserver = domService.observeForElements(
        this.requiredSelectors,
        (elements, selector, error) => {
          // Clean up the observer
          this.elementsObserver = null

          if (error) {
            Logger.warning(`Feature ${this.name} could not find required elements: ${error.message}`)
            this.onRequiredElementsNotFound(error)
            return
          }

          if (elements && elements.length > 0) {
            Logger.debug(`Feature ${this.name} found required elements with selector: ${selector}`)
            this.onRequiredElementsFound(elements, selector)
            this.onActivate(elements)
          }
        },
      )
    } else {
      // No required elements, activate immediately
      this.onActivate()
    }
  }

  /**
   * Deactivate the feature
   */
  deactivate() {
    if (this.isActive) {
      this.isActive = false
      Logger.feature(this.name, 'Deactivated')
      this.onDeactivate()
    }
  }

  /**
   * Called when the feature is activated
   * Should be overridden by child classes
   *
   * NOTE: Do not log 'Activated' in this method - BaseFeature.activate() already does that.
   * This method is for initialization logic only.
   */
  onActivate() {
    // Default implementation - override in subclasses
    Logger.debug(`Feature "${this.name}" activated, but no onActivate handler implemented`)
  }

  /**
   * Called when the feature is deactivated
   * Should be overridden by child classes
   */
  onDeactivate() {
    // Default implementation - override in subclasses

    // Clean up any observers
    if (this.elementsObserver) {
      this.elementsObserver.disconnect()
      this.elementsObserver = null
    }
  }

  /**
   * Called when required elements are found
   * Can be overridden by child classes
   * @param {NodeList} elements - The found elements
   * @param {string} selector - The selector that matched
   */
  onRequiredElementsFound(elements, selector) {
    // Default implementation - override in subclasses if needed
    Logger.debug(`Feature "${this.name}" found ${elements.length} required elements with selector: ${selector}`)
  }

  /**
   * Called when required elements are not found within timeout
   * Can be overridden by child classes
   * @param {Error} error - The error that occurred
   */
  onRequiredElementsNotFound(error) {
    // Default implementation - override in subclasses if needed
    Logger.warning(`Feature "${this.name}" could not find required elements: ${error.message}`)
  }

  /**
   * Initialize Kriit API with settings from chrome.storage.sync
   */
  initializeKriitApi() {
    // Check if API is properly initialized
    if (!this.api || !this.api.kriit) {
      Logger.error('API not properly initialized', { api: this.api })
      return
    }

    // Set Kriit API base URL if not already set
    if (!this.api.kriit.baseUrl) {
      // Try to load from storage
      chrome.storage.sync.get(['OA_kriitApiBaseUrl', 'OA_kriitApiToken', 'OA_kriitEnabled'], result => {
        const savedBaseUrl = result['OA_kriitApiBaseUrl']
        const savedToken = result['OA_kriitApiToken']
        const kriitEnabled = result['OA_kriitEnabled'] === true

        // Store Kriit enabled status
        this.api.kriit.enabled = kriitEnabled

        if (!kriitEnabled) {
          // Skip Kriit API initialization if disabled
          return
        }

        // Set base URL from storage - no default fallback
        if (savedBaseUrl) {
          this.api.kriit.setBaseUrl(savedBaseUrl)
        } else {
          Logger.debug('No Kriit API base URL found in settings')
        }

        // Set auth token if available
        if (savedToken) {
          this.api.kriit.setAuthToken(savedToken)
        } else {
          Logger.debug('No Kriit API token found, Kriit features will be disabled')
        }
      })
    }
  }
}
