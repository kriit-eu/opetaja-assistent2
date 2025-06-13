/**
 * Õpetaja Assistent 2 - Main content script
 */
import TahvelExtension from './core/Extension.js'
import Logger from './services/Logger.js'

const VERSION = '6'

// Print version and build time info using our new Logger
Logger.info(`Content script loaded - version ${VERSION}`)

// Initialize immediately or when DOM is ready
document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', TahvelExtension.init)
  : TahvelExtension.init()

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleDebugMode') {
    if (message.enabled) {
      Logger.enableDebugMode()
      Logger.debug('Debug mode enabled from popup')
    } else {
      Logger.disableDebugMode()
      Logger.info('Debug mode disabled from popup')
    }
    sendResponse({ success: true })
  } else if (message.action === 'cacheClearedFromPopup') {
    Logger.info('Cache cleared from popup')
    // Refresh the page to reload data
    window.location.reload()
    sendResponse({ success: true })
  } else if (message.action === 'kriitSettingsUpdated') {
    Logger.info('Kriit API settings updated from popup')
    // Refresh the page to apply new settings
    window.location.reload()
    sendResponse({ success: true })
  }
  return true // Keep the message channel open for async responses
})
