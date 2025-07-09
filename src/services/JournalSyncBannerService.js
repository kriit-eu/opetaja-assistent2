/**
 * Journal Sync Banner Service
 *
 * Handles sync-specific UI banner management for journal sync features
 * Extends the generic BannerService with sync-specific functionality
 */

import { domService } from './DomService.js'
import { styleService } from './StyleService.js'
import { bannerService } from './BannerService.js'
import Logger from './Logger.js'

export class JournalSyncBannerService {
  constructor() {
    this.stylesLoaded = false
  }

  /**
   * Load CSS styles specific to sync banners (lazy loading)
   */
  loadSyncStyles() {
    if (this.stylesLoaded || typeof document === 'undefined') {
      return
    }

    this.stylesLoaded = true

    // Load CSS asynchronously without blocking UI
    this._loadCSSAsync()
  }

  /**
   * Asynchronously load CSS from external file
   * @private
   */
  async _loadCSSAsync() {
    try {
      // Load CSS from external file
      const cssUrl = chrome.runtime.getURL('styles/JournalSyncBannerService.css')
      const response = await fetch(cssUrl)

      if (!response.ok) {
        throw new Error(`Failed to load CSS: ${response.status} ${response.statusText}`)
      }

      const css = await response.text()
      styleService.injectCSS(css, 'journal-sync-banner-styles')
    } catch (error) {
      Logger.error('Failed to load JournalSyncBannerService CSS:', error)
      // Fallback: continue without styles rather than breaking functionality
    }
  }

  /**
   * Show a banner when the Kriit API key is missing
   * @param {Function} onOpenSettings - Callback for opening settings
   */
  showMissingApiKeyBanner(onOpenSettings = null) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    if (!container) return

    bannerService.removeBanner()

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner', 'ta-sync-info']
      },
      '',
      container,
      'afterbegin'
    )

    // Add title
    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-sync-title']
      },
      'Kriit API võti puudub',
      banner
    )

    // Add message
    domService.createAndInsertElement(
      'p',
      {
        classList: ['ta-sync-message']
      },
      'Kriit API võti on vajalik, et sünkroniseerida hindeid Tahvli ja Kriidi vahel. Palun sisestage API võti laienduse seadetes.',
      banner
    )

    // Add button to open extension popup
    domService.createAndInsertElement(
      'button',
      {
        classList: ['ta-sync-button'],
        onclick:
          onOpenSettings ||
          (() => {
            alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
          })
      },
      'Ava seaded',
      banner
    )

    // Update the banner service's current banner reference
    bannerService.currentBanner = banner

    Logger.debug('Missing API key banner created and displayed')
  }

  /**
   * Show green banner when all grades are in sync
   * @param {Function} onRefresh - Callback for refresh button
   * @param {Function} onClose - Callback for close button
   */
  showAllInSyncBanner(onRefresh = null, onClose = null) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    bannerService.removeBanner()

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner', 'ta-sync-success']
      },
      '',
      container,
      'afterbegin'
    )

    // Add success icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 1.5rem; margin-bottom: 10px;'
      },
      '✅',
      banner
    )

    // Add title
    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-sync-title'],
        style: 'margin: 0 0 10px 0; font-weight: bold;'
      },
      'Kõik hinded on sünkroonis!',
      banner
    )

    // Add message
    domService.createAndInsertElement(
      'p',
      {
        classList: ['ta-sync-message'],
        style: 'margin: 0 0 15px 0;'
      },
      'Tahvli ja Kriidi vahel pole erinevusi. Kõik hinded on juba õigesti sünkroniseeritud.',
      banner
    )

    // Add refresh button
    if (onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-sync-button'],
          onclick: onRefresh,
          style: 'margin-right: 10px; background-color: #28a745; border-color: #28a745; color: white;'
        },
        'Värskenda andmeid',
        banner
      )
    }

    // Add close button
    if (onClose) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-sync-button'],
          onclick: onClose,
          style: 'background-color: transparent; border-color: #28a745; color: #28a745;'
        },
        'Sulge',
        banner
      )
    }

    // Update the banner service's current banner reference
    bannerService.currentBanner = banner

    Logger.debug('All in sync banner created and displayed')
  }

  /**
   * Show differences banner
   * @param {number} totalDifferences - Total number of differences
   * @param {Function} onSync - Callback for sync button
   * @param {Function} onRefresh - Callback for refresh button
   * @param {Function} renderDifferences - Function to render the differences content
   */
  showDifferencesBanner(totalDifferences, onSync = null, onRefresh = null, renderDifferences = null) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    bannerService.removeBanner()

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner']
      },
      '',
      container,
      'afterbegin'
    )

    // Add title
    domService.createAndInsertElement(
      'h2',
      {
        classList: ['ta-sync-title']
      },
      'Sünkroniseerimata hinded',
      banner
    )

    // Add horizontal rule
    domService.createAndInsertElement(
      'hr',
      {
        classList: ['ta-sync-divider']
      },
      '',
      banner
    )

    // Add differences content if render function provided
    if (renderDifferences) {
      renderDifferences(banner)
    }

    // Add sync button only if there are differences to sync
    if (totalDifferences > 0 && onSync) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-sync-button'],
          onclick: onSync,
          style: 'margin-right: 10px;'
        },
        `Sünkroniseeri ${totalDifferences} hinnet Kriidist Tahvlisse`,
        banner
      )
    } else if (onRefresh) {
      // If no differences to sync, show a refresh button instead
      domService.createAndInsertElement(
        'button',
        {
          classList: ['ta-sync-button'],
          onclick: onRefresh,
          style: 'margin-right: 10px;'
        },
        'Värskenda andmeid',
        banner
      )
    }

    // Update the banner service's current banner reference
    bannerService.currentBanner = banner

    Logger.debug('Differences banner created and displayed')
  }

  /**
   * Show sync-specific error banner with detailed error handling
   * @param {string} error - Error message
   * @param {Object} options - Additional options
   * @param {Function} options.onRetry - Callback for retry button
   * @param {Function} options.onClearCache - Callback for clear cache button
   * @param {Function} options.onSettings - Callback for settings button
   * @param {Function} options.onRefresh - Callback for refresh button
   */
  showSyncErrorBanner(error, options = {}) {
    this.loadSyncStyles()
    const container = bannerService.getBannerContainer()
    bannerService.removeBanner()

    const banner = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-banner', 'ta-sync-error']
      },
      '',
      container,
      'afterbegin'
    )

    // Add error icon
    domService.createAndInsertElement(
      'div',
      {
        style: 'font-size: 1.5rem; margin-bottom: 10px;'
      },
      '❌',
      banner
    )

    // Add error title - use different titles based on error type
    let errorTitle = 'Viga'

    if (error && error.includes('403')) {
      if (error.includes('Permission denied') || error.includes('rights to modify')) {
        errorTitle = 'Õiguste viga'
      } else {
        errorTitle = 'Autentimise viga'
      }
    } else if (error && error.includes('No journal links found')) {
      errorTitle = 'Päevikute leidmise viga'
    } else if (error && error.includes('API')) {
      errorTitle = 'API viga'
    } else if (error && error.includes('sync')) {
      errorTitle = 'Sünkroniseerimise viga'
    } else if (error && error.includes('Kõik hinded on juba sünkroonis')) {
      errorTitle = 'Info'
    }

    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-sync-error-title']
      },
      errorTitle,
      banner
    )

    // Add error message
    domService.createAndInsertElement(
      'p',
      {
        classList: ['ta-banner-error-message']
      },
      error,
      banner
    )

    // Add appropriate action buttons and help text based on error type
    this._addSyncErrorActions(banner, error, options)

    // Update the banner service's current banner reference
    bannerService.currentBanner = banner

    Logger.debug('Sync error banner created and displayed')
  }

  /**
   * Add sync-specific error actions and help text
   * @private
   */
  _addSyncErrorActions(banner, error, options) {
    if (error && error.includes('403')) {
      if (error.includes('Permission denied') || error.includes('rights to modify')) {
        // Permission error for journal modification
        domService.createAndInsertElement(
          'p',
          {
            classList: ['ta-sync-error-help']
          },
          'Teil puuduvad õigused selle päeviku muutmiseks. Sünkroniseerimine Tahvlisse on võimalik ainult päeviku õpetajal.',
          banner
        )

        domService.createAndInsertElement(
          'p',
          {
            classList: ['ta-sync-error-help']
          },
          'Tahvel lubab päeviku hindeid muuta ainult päeviku õpetajal. Kui te pole selle päeviku õpetaja, siis ei saa te hindeid sünkroniseerida.',
          banner
        )

        // Add refresh button
        if (options.onRetry) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['ta-sync-button', 'ta-sync-error-button'],
              onclick: options.onRetry,
              style: 'margin-right: 10px;'
            },
            'Värskenda andmeid',
            banner
          )
        }
      } else {
        // Authentication error
        domService.createAndInsertElement(
          'p',
          {
            classList: ['ta-sync-error-help']
          },
          'See on autentimise viga. Palun kontrollige oma Kriit API võtit.',
          banner
        )

        // Add button to reset token
        if (options.onSettings) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['ta-sync-button', 'ta-sync-error-button'],
              onclick: options.onSettings,
              style: 'margin-right: 10px;'
            },
            'Lähtesta Kriit API võti',
            banner
          )

          domService.createAndInsertElement(
            'button',
            {
              classList: ['ta-sync-button'],
              onclick: () => {
                alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
              }
            },
            'Ava seaded',
            banner
          )
        }
      }
    } else if (error && error.includes('No journal links found')) {
      // Journal link detection error
      domService.createAndInsertElement(
        'p',
        {
          classList: ['ta-sync-error-help']
        },
        'See funktsioon vajab päeviku linke lehel. Palun veenduge, et olete päevikute nimekirja lehel.',
        banner
      )

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button', 'ta-sync-error-button'],
            onclick: options.onRefresh,
            style: 'margin-right: 10px;'
          },
          'Värskenda lehte',
          banner
        )
      }
    } else if (error && error.includes('Kõik hinded on juba sünkroonis')) {
      // All grades already in sync - show as info, not error
      banner.classList.remove('ta-sync-error')
      banner.classList.add('ta-sync-info')

      // Add refresh button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button'],
            onclick: options.onRetry,
            style: 'margin-right: 10px;'
          },
          'Värskenda andmeid',
          banner
        )
      }

      // Add clear cache button
      if (options.onClearCache) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button'],
            onclick: options.onClearCache
          },
          'Puhasta vahemälu',
          banner
        )
      }
    } else if (error && (error.includes('sync') || error.includes('sünkroniseerimine'))) {
      // Sync error
      let helpText = 'Sünkroniseerimisel tekkis viga. Täpsemad veateated on saadaval konsoolist (F12).'

      // Add more specific help text for common errors
      if (error.includes('is not enrolled in this assignment')) {
        helpText =
          'Õpilane on leitud Tahvlis, kuid ta ei ole selle ülesande nimekirjas. Sünkroniseerimine ei ole võimalik, kuna õpilane ei ole selle ülesande osalejate nimekirjas. See võib juhtuda, kui õpilane on Kriidis, kuid ei ole selle konkreetse ülesande nimekirjas Tahvlis.'
      } else if (error.includes('Could not find student with personal code') || error.includes('Refusing to update a different student')) {
        helpText =
          'Õpilase isikukoodi ei leitud Tahvlis. Sünkroniseerimine ei ole võimalik, kuna me ei saa tuvastada, millise õpilase hinnet tuleks muuta. See võib juhtuda, kui õpilane on Kriidis, kuid mitte Tahvlis, või kui isikukoodid on erinevates formaatides.'
      }

      domService.createAndInsertElement(
        'p',
        {
          classList: ['ta-sync-error-help']
        },
        helpText,
        banner
      )

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button', 'ta-sync-error-button'],
            onclick: options.onRetry,
            style: 'margin-right: 10px;'
          },
          'Värskenda andmeid',
          banner
        )
      }
    } else {
      // Generic error
      domService.createAndInsertElement(
        'p',
        {
          classList: ['ta-sync-error-help']
        },
        'Proovige lehte värskendada või puhastada vahemälu.',
        banner
      )

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button', 'ta-sync-error-button'],
            onclick: options.onRetry,
            style: 'margin-right: 10px;'
          },
          'Proovi uuesti',
          banner
        )
      }

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button'],
            onclick: () => window.location.reload(),
            style: 'margin-right: 10px;'
          },
          'Värskenda lehte',
          banner
        )
      }

      // Add clear cache button
      if (options.onClearCache) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['ta-sync-button'],
            onclick: options.onClearCache
          },
          'Puhasta vahemälu',
          banner
        )
      }
    }
  }

  /**
   * Utility method to create a differences container
   * This can be used by features to create a standardized differences container
   * @param {Element} parent - Parent element to append the container to
   * @returns {Element} The created differences container
   */
  createDifferencesContainer(parent) {
    return domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-differences-container']
      },
      '',
      parent
    )
  }

  /**
   * Utility method to create a category section for grouping differences
   * @param {Element} parent - Parent element to append the section to
   * @param {string} categoryName - Name of the category
   * @returns {Element} The created category section
   */
  createCategorySection(parent, categoryName) {
    const categorySection = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-category']
      },
      '',
      parent
    )

    domService.createAndInsertElement(
      'h3',
      {
        classList: ['ta-sync-subject-title']
      },
      categoryName,
      categorySection
    )

    return categorySection
  }

  /**
   * Utility method to create a "no differences" message
   * @param {Element} parent - Parent element to append the message to
   * @param {string} message - Custom message to display
   */
  createNoDifferencesMessage(parent, message = 'No differences found') {
    domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-no-differences']
      },
      message,
      parent
    )
  }

  /**
   * Utility method to create a comparison display (e.g., "old value → new value")
   * @param {Element} parent - Parent element to append the comparison to
   * @param {string} oldValue - The old/current value
   * @param {string} newValue - The new/target value
   * @param {string} oldLabel - Label for the old value (optional)
   * @param {string} newLabel - Label for the new value (optional)
   * @returns {Element} The created comparison display element
   */
  createComparisonDisplay(parent, oldValue, newValue, oldLabel = '', newLabel = '') {
    const comparisonDisplay = domService.createAndInsertElement(
      'span',
      {
        classList: ['ta-sync-grade-difference']
      },
      '',
      parent
    )

    domService.createAndInsertElement(
      'span',
      {
        classList: ['ta-sync-current-grade'],
        title: oldLabel
      },
      oldValue,
      comparisonDisplay
    )

    domService.createAndInsertElement(
      'span',
      {
        classList: ['ta-sync-arrow']
      },
      ' → ',
      comparisonDisplay
    )

    domService.createAndInsertElement(
      'span',
      {
        classList: ['ta-sync-new-grade'],
        title: newLabel
      },
      newValue,
      comparisonDisplay
    )

    return comparisonDisplay
  }

  /**
   * Clean up sync-specific resources
   */
  destroy() {
    styleService.removeCSS('journal-sync-banner-styles')
  }
}

// Export a singleton instance
export const journalSyncBannerService = new JournalSyncBannerService()
