/**
 * Opetaja Assistent 2 - Main content script
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
