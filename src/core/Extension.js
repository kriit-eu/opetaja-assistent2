/**
 * Core extension module - Main entry point for the Õpetaja Assistent 2
 */

import { navigationService } from '../services/NavigationService.js'
import { loadFeatures } from './FeaturesRegistry.js'
import Logger from '../services/Logger.js'
import versionCheckService from '../services/VersionCheckService.js'
import { cacheService } from '../services/CacheService.js'

// Main extension controller
const tahvelExtension = {
  // Feature collection (will be populated dynamically)
  activeFeatures: [],
  // Set to true after init() completes — skips redundant checkContextChange on first navigation
  _bootstrapComplete: false,

  // Initialize the extension
  async init() {
    Logger.success('Initializing Õpetaja Assistent 2...')

    // Register listener for update notifications from background script
    versionCheckService.listenForUpdates()

    // Add visual indicator to show the extension is active
    this.addVisualIndicator()

    // Set up URL change detection
    navigationService.init()

    // Bootstrap school ID for cache namespacing before any features activate
    try {
      const { api } = await import('./BaseFeature.js')
      const userInfo = await api.tahvel.get('/user', {}, { cache: false })
      if (userInfo?.school?.id != null) {
        cacheService.setSchoolId(userInfo.school.id)
        Logger.info(`[Extension] School ID set to ${userInfo.school.id}`)
      }
    } catch (e) {
      Logger.warning('[Extension] Could not set school ID:', e.message)
    }

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

    // Mark bootstrap complete so subsequent main page visits run checkContextChange
    this._bootstrapComplete = true

    Logger.success('Initialization complete')
  },

  // Add visual indicator to show the extension is active
  addVisualIndicator() {
    // Keep track of whether we've added the indicator
    this.indicatorAdded = false

    // Function to add the indicator
    const addIndicator = () => {
      // If we've already added the indicator, don't add it again
      if (this.indicatorAdded) {
        return
      }

      const userMenuButton = document.querySelector('#user-menu-button')
      if (userMenuButton) {
        // Check if indicator is already added to the DOM
        if (userMenuButton.querySelector('.oa-indicator')) {
          this.indicatorAdded = true
          return
        }

        // Get Kriit API URL from storage
        chrome.storage.sync.get(['OA_kriitApiBaseUrl'], result => {
          // Double-check that indicator hasn't been added while we were getting storage
          if (this.indicatorAdded || userMenuButton.querySelector('.oa-indicator')) {
            this.indicatorAdded = true
            return
          }

          const kriitApiUrl = result['OA_kriitApiBaseUrl'] || ''

          // Check if using dev Kriit (any URL that's not the default production Kriit)
          const isDevKriit = kriitApiUrl && !kriitApiUrl.includes('kriit.vikk.ee')

          // Create the indicator element
          const indicator = document.createElement('span')
          indicator.className = 'oa-indicator'
          indicator.style.cssText = `
            background-color: ${isDevKriit ? 'red' : 'green'};
            color: white;
            border-radius: 4px;
            padding: 2px;
            margin-left: 4px;
          `
          indicator.title = isDevKriit ? 'Õpetaja Assistent 2 kasutab dev Kriiti' : 'Õpetaja Assistent 2 on aktiivne'
          indicator.textContent = isDevKriit ? 'DEV' : 'ÕA2'

          // Append the indicator to the user menu button
          userMenuButton.appendChild(indicator)

          // Mark as added
          this.indicatorAdded = true

          Logger.debug(`Added visual indicator (${isDevKriit ? 'DEV' : 'ÕA2'})`)
        })
      }
    }

    // Try to add indicator immediately
    addIndicator()

    // If not found, wait for DOM changes and try again
    const observer = new MutationObserver(mutations => {
      // If we've already added the indicator, disconnect the observer
      if (this.indicatorAdded) {
        observer.disconnect()
        return
      }

      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          const userMenuButton = document.querySelector('#user-menu-button')
          if (userMenuButton && !userMenuButton.querySelector('.oa-indicator')) {
            addIndicator()

            // If indicator was added, disconnect the observer
            if (this.indicatorAdded) {
              observer.disconnect()
              break
            }
          }
        }
      }
    })

    // Start observing the document body for DOM changes
    observer.observe(document.body, { childList: true, subtree: true })

    // Also handle navigation events to ensure indicator is added after page changes
    navigationService.onNavigate(() => {
      // Check if the indicator is still in the DOM after navigation
      const userMenuButton = document.querySelector('#user-menu-button')
      const indicatorExists = userMenuButton && userMenuButton.querySelector('.oa-indicator')

      // Only reset the flag and try to add the indicator if it's not in the DOM
      if (!indicatorExists) {
        this.indicatorAdded = false
        setTimeout(addIndicator, 500)
      }
    })
  },

  // Check if URL is the main/home page (no specific sub-route)
  isMainPage(url) {
    try {
      const hash = new URL(url).hash
      return hash === '#/' || hash === '#' || hash === '' || hash === '#/students'
    } catch {
      return false
    }
  },

  // Check for role or school change and update cache namespace
  async checkContextChange() {
    try {
      const { api } = await import('./BaseFeature.js')
      const apiService = api?.tahvel
      if (!apiService) return

      const userInfo = await apiService.get('/user', {}, { cache: false })
      if (!userInfo?.roleCode) return

      const detectedSchoolId = userInfo.school?.id

      // Always update cache namespace to current school (null resets to unnamespaced)
      cacheService.setSchoolId(detectedSchoolId)

      const stored = await new Promise(resolve =>
        chrome.storage.local.get(['OA_currentRole', 'OA_currentSchoolId'], resolve)
      )

      const roleChanged = stored.OA_currentRole && stored.OA_currentRole !== userInfo.roleCode
      const schoolChanged = stored.OA_currentSchoolId != null && detectedSchoolId != null &&
        Number(stored.OA_currentSchoolId) !== Number(detectedSchoolId)

      // Only clear cache on role change (school change is handled by cache namespacing)
      if (roleChanged) {
        Logger.info(`[Extension] Role ${stored.OA_currentRole} → ${userInfo.roleCode}, clearing cache`)
        await cacheService.clearCache()
      } else if (schoolChanged) {
        Logger.info(`[Extension] School ${stored.OA_currentSchoolId} → ${detectedSchoolId}, cache namespace updated`)
      }

      chrome.storage.local.set({
        OA_currentRole: userInfo.roleCode,
        ...(detectedSchoolId != null && { OA_currentSchoolId: detectedSchoolId })
      })
    } catch (e) {
      Logger.warning('[Extension] Error checking role/school change:', e.message)
    }
  },

  // Handle navigation events
  handleNavigation(url) {
    Logger.debug(`Navigation detected: ${url}`)

    // Evict expired cache entries when visiting main page
    if (this.isMainPage(url)) {
      cacheService.evictExpired().catch(e => Logger.warning('[Cache] evictExpired error:', e.message))
      // Fire-and-forget: updates school cache namespace before next feature page
      if (this._bootstrapComplete) {
        this.checkContextChange()
      }
    }

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
  }
}

// Initialize extension when DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  tahvelExtension.init()
})

export default tahvelExtension
