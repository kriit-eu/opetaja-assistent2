/**
 * Background script
 */
import Logger from './services/Logger.js'

// Use both the Logger and regular console.log for extra visibility
Logger.info('Background script loaded')
console.log('📔 Background script loaded - ' + new Date().toISOString())

// No active listeners needed at this time
// If inter-process communication is needed in the future,
// chrome.runtime.onMessage listeners can be added here
