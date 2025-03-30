/**
 * Core extension module - Main entry point for the Opetaja Assistent 2
 */

import { navigationService } from '../services/NavigationService.js'
import { loadFeatures } from './FeaturesRegistry.js'
import Logger from '../services/Logger.js'

// Main extension controller
const tahvelExtension = {
  // Feature collection (will be populated dynamically)
  activeFeatures: [],

  // Initialize the extension
  async init () {
    Logger.success('Initializing Opetaja Assistant...')

    // Set up URL change detection
    navigationService.init()

    try {
      // Load features dynamically
      this.activeFeatures = await loadFeatures()
      if (this.activeFeatures.length > 0) {
        Logger.success(`Loaded ${this.activeFeatures.length} features dynamically`)
      } else {
        Logger.error('No features were loaded')
      }
    } catch (error) {
      Logger.error('Failed to load features:', error)
    }

    // Listen for navigation events
    navigationService.onNavigate(this.handleNavigation.bind(this))

    // Initial navigation check
    this.handleNavigation(window.location.href)

    Logger.success('Initialization complete')
  },

  // Handle navigation events
  handleNavigation (url) {
    Logger.debug(`Navigation detected: ${url}`)

    // Activate relevant features for current page
    this.activeFeatures.forEach(feature => {
      if (feature.shouldActivate(url)) {
        if (!feature.isActive) {
          Logger.feature(feature.name, 'Activating feature')
        }
        feature.activate()
      } else if (feature.isActive) {
        Logger.feature(feature.name, 'Deactivating feature')
        feature.deactivate()
      }
    })
  },
}

// Initialize extension when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  tahvelExtension.init()
})

export default tahvelExtension
