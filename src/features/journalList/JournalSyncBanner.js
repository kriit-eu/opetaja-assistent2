import { domService } from '../../services/DomService.js'
import { styleService } from '../../services/StyleService.js'
import { bannerService } from '../../services/BannerService.js'
import Logger from '../../services/Logger.js'

class DifferenceRenderer {
  render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs) {
    // Only render on journal list page, never on edit page
    if (!window.location.hash.includes('journals?_menu')) return
    const groupedDiffs = this.collectAndGroupDifferences(assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs)

    for (const subjectName in groupedDiffs) {
      const subjectContainer = this.createSubjectContainer(container, subjectName)
      groupedDiffs[subjectName].forEach(diff => {
        const row = this.createRow(subjectContainer)
        const badges = domService.createAndInsertElement('div', { classList: ['badges'] }, '', row)
        this.createBadge(badges, diff.typeName, `badge-${diff.type}`)
        this.createBadge(badges, diff.assignmentName, 'badge-assignment')

        const values = domService.createAndInsertElement('div', { classList: ['values'] }, '', row)
        if (diff.studentName) {
          domService.createAndInsertElement('span', { classList: ['student-name'] }, `${diff.studentName}:`, values)
        }
        const valueBadge = domService.createAndInsertElement('span', { classList: ['value-badge'] }, '', values)
        domService.createAndInsertElement('span', { classList: ['value-old'] }, diff.oldValue, valueBadge)
        domService.createAndInsertElement('span', { classList: ['value-new'] }, diff.newValue, valueBadge)
      })
    }
  }

  collectAndGroupDifferences(assignmentNameDiffs, gradeDiffs, dueDateDiffs, entryDateDiffs) {
    const grouped = {}
    const normalize = val => (val === null || val === undefined || val === '' ? null : String(val))

    // Create a map of new assignment names
    const newNames = {}
    ;(assignmentNameDiffs || []).forEach(subject => {
      (subject.nameDiffs || []).forEach(nameDiff => {
        newNames[nameDiff.assignmentExternalId] = nameDiff.kriit
      })
    })

    // Helper to add a difference to the grouped object (by subjectName only)
    const addDiff = (subjectName, diff) => {
      const key = subjectName
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(diff)
    }

    // Name Diffs first
    ;(assignmentNameDiffs || []).forEach(subject => {
      (subject.nameDiffs || []).forEach(nameDiff => {
        addDiff(subject.subjectName, {
          type: 'name',
          typeName: 'Nimetus',
          assignmentName: nameDiff.Tahvel,
          studentName: '',
          oldValue: normalize(nameDiff.Tahvel) || 'puudub',
          newValue: normalize(nameDiff.kriit) || 'puudub'
        })
      })
    })

    const getAssignmentName = assignment => {
      if (typeof assignment.assignmentName === 'object' && assignment.assignmentName !== null) {
        return newNames[assignment.assignmentExternalId] || assignment.assignmentName.Tahvel || assignment.assignmentName.kriit
      }
      return newNames[assignment.assignmentExternalId] || assignment.assignmentName
    }

    // Grade Diffs
    ;(gradeDiffs || []).forEach(subject => {
      (subject.assignments || []).forEach(assignment => {
        const assignmentName = getAssignmentName(assignment)
        ;(assignment.results || []).forEach(result => {
          const tahvelGrade = normalize(result.currentGrade)
          const kriitGrade = normalize(result.grade)

          if (tahvelGrade !== kriitGrade) {
            addDiff(subject.subjectName, {
              type: 'grade',
              typeName: 'Hinne',
              assignmentName: assignmentName,
              studentName: result.studentName,
              oldValue: tahvelGrade || 'puudub',
              newValue: kriitGrade || 'puudub'
            })
          }
        })
      })
    })

    // Due Date Diffs
    ;(dueDateDiffs || []).forEach(diff => {
      const assignmentName = newNames[diff.assignmentExternalId] || diff.assignmentName
      addDiff(diff.subjectName || '', {
        type: 'duedate',
        typeName: 'Tähtaeg',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: normalize(diff.Tahvel) || 'puudub',
        newValue: normalize(diff.kriit) || 'puudub'
      })
    })

    // Entry Date Diffs
    ;(entryDateDiffs || []).forEach(diff => {
      const assignmentName = newNames[diff.assignmentExternalId] || diff.assignmentName
      addDiff(diff.subjectName || '', {
        type: 'entrydate',
        typeName: 'Sissekande kuupäev',
        assignmentName: assignmentName,
        studentName: '',
        oldValue: normalize(diff.Tahvel) || 'puudub',
        newValue: normalize(diff.kriit) || 'puudub'
      })
    })

    return grouped
  }

  createSubjectContainer(container, subjectGroupKey) {
    const subjectContainer = domService.createAndInsertElement('div', {}, '', container)
    domService.createAndInsertElement('h3', {}, subjectGroupKey, subjectContainer)
    return subjectContainer
  }

  createRow(container) {
    return domService.createAndInsertElement('div', { classList: ['change-item'] }, '', container)
  }

  createBadge(row, text, className) {
    return domService.createAndInsertElement(
      'span',
      {
        classList: ['badge', className]
      },
      text,
      row
    )
  }
}

export const differenceRenderer = new DifferenceRenderer()

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
        classList: ['container']
      },
      '',
      container,
      'afterbegin'
    )

    // Add title
    domService.createAndInsertElement('h1', {}, 'Kriit API võti puudub', banner)

    // Add message
    domService.createAndInsertElement(
      'p',
      {},
      'Kriit API võti on vajalik, et sünkroniseerida hindeid Tahvli ja Kriidi vahel. Palun sisestage API võti laienduse seadetes.',
      banner
    )

    // Add button to open extension popup
    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)
    domService.createAndInsertElement(
      'button',
      {
        classList: ['btn-primary'],
        onclick:
          onOpenSettings ||
          (() => {
            alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
          })
      },
      'Ava seaded',
      actions
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
        classList: ['container']
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
    domService.createAndInsertElement('h1', {}, 'Kõik hinded on sünkroonis!', banner)

    // Add message
    domService.createAndInsertElement('p', {}, 'Tahvli ja Kriidi vahel pole erinevusi. Kõik hinded on juba õigesti sünkroniseeritud.', banner)

    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)
    // Add refresh button
    if (onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary'],
          onclick: onRefresh
        },
        'Värskenda andmeid',
        actions
      )
    }

    // Add close button
    if (onClose) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary'],
          onclick: onClose
        },
        'Sulge',
        actions
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
        classList: ['container']
      },
      '',
      container,
      'afterbegin'
    )

    // Add title
    domService.createAndInsertElement('h1', {}, 'Sünkroniseerimata muudatused', banner)

    const changesContainer = domService.createAndInsertElement('div', { id: 'changes' }, '', banner)

    // Add differences content if render function provided
    if (renderDifferences) {
      renderDifferences(changesContainer)
    }

    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)

    // Add sync button only if there are differences to sync
    if (totalDifferences > 0 && onSync) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-primary'],
          onclick: onSync
        },
        'Sünkroniseeri kõik',
        actions
      )
    }

    if (onRefresh) {
      domService.createAndInsertElement(
        'button',
        {
          classList: ['btn-secondary'],
          onclick: onRefresh
        },
        'Tühista',
        actions
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
        classList: ['container', 'ta-sync-error']
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

    domService.createAndInsertElement('h1', {}, errorTitle, banner)

    // Add error message
    domService.createAndInsertElement('p', {}, error, banner)

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
    const actions = domService.createAndInsertElement('div', { classList: ['actions'] }, '', banner)
    if (error && error.includes('403')) {
      if (error.includes('Permission denied') || error.includes('rights to modify')) {
        // Permission error for journal modification
        domService.createAndInsertElement(
          'p',
          {},
          'Teil puuduvad õigused selle päeviku muutmiseks. Sünkroniseerimine Tahvlisse on võimalik ainult päeviku õpetajal.',
          banner
        )

        domService.createAndInsertElement(
          'p',
          {},
          'Tahvel lubab päeviku hindeid muuta ainult päeviku õpetajal. Kui te pole selle päeviku õpetaja, siis ei saa te hindeid sünkroniseerida.',
          banner
        )

        // Add refresh button
        if (options.onRetry) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: options.onRetry
            },
            'Värskenda andmeid',
            actions
          )
        }
      } else {
        // Authentication error
        domService.createAndInsertElement('p', {}, 'See on autentimise viga. Palun kontrollige oma Kriit API võtit.', banner)

        // Add button to reset token
        if (options.onSettings) {
          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-primary'],
              onclick: options.onSettings
            },
            'Lähtesta Kriit API võti',
            actions
          )

          domService.createAndInsertElement(
            'button',
            {
              classList: ['btn-secondary'],
              onclick: () => {
                alert('Klõpsake laienduse ikoonil brauseri tööriistaribal ja sisestage Kriit API võti.')
              }
            },
            'Ava seaded',
            actions
          )
        }
      }
    } else if (error && error.includes('No journal links found')) {
      // Journal link detection error
      domService.createAndInsertElement('p', {}, 'See funktsioon vajab päeviku linke lehel. Palun veenduge, et olete päevikute nimekirja lehel.', banner)

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRefresh
          },
          'Värskenda lehte',
          actions
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
            classList: ['btn-secondary'],
            onclick: options.onRetry
          },
          'Värskenda andmeid',
          actions
        )
      }

      // Add clear cache button
      if (options.onClearCache) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onClearCache
          },
          'Puhasta vahemälu',
          actions
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

      domService.createAndInsertElement('p', {}, helpText, banner)

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRetry
          },
          'Värskenda andmeid',
          actions
        )
      }
    } else {
      // Generic error
      domService.createAndInsertElement('p', {}, 'Proovige lehte värskendada või puhastada vahemälu.', banner)

      // Add retry button
      if (options.onRetry) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onRetry
          },
          'Proovi uuesti',
          actions
        )
      }

      // Add refresh page button
      if (options.onRefresh) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: () => window.location.reload()
          },
          'Värskenda lehte',
          actions
        )
      }

      // Add clear cache button
      if (options.onClearCache) {
        domService.createAndInsertElement(
          'button',
          {
            classList: ['btn-secondary'],
            onclick: options.onClearCache
          },
          'Puhasta vahemälu',
          actions
        )
      }
    }
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
