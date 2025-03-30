/**
 * Base Feature - Template for all features to extend
 */

import Logger from '../services/Logger.js'

export class BaseFeature {
  constructor (name, urlPattern) {
    this.name = name
    this.urlPattern = urlPattern
    this.isActive = false
    Logger.debug(`Feature "${name}" created`)
  }

  /**
   * Check if this feature should be activated for the current URL
   * @param {string} url - Current URL
   * @returns {boolean} True if should activate
   */
  shouldActivate (url) {
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
  activate () {
    if (!this.isActive) {
      this.isActive = true
      Logger.feature(this.name, 'Activated')
      this.onActivate()
    }
  }

  /**
   * Deactivate the feature
   */
  deactivate () {
    if (this.isActive) {
      this.isActive = false
      Logger.feature(this.name, 'Deactivated')
      this.onDeactivate()
    }
  }

  /**
   * Called when the feature is activated
   * Should be overridden by child classes
   */
  onActivate () {
    // Default implementation - override in subclasses
    Logger.debug(`Feature "${this.name}" activated, but no onActivate handler implemented`)
  }

  /**
   * Called when the feature is deactivated
   * Should be overridden by child classes
   */
  onDeactivate () {
    // Default implementation - override in subclasses
  }
}
