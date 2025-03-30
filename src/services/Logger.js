/**
 * Logger utility - Provides consistent logging across the extension
 * with better source line information in developer tools
 */

// Define log levels with their emoji prefixes (using only yellow emojis)
export const LogLevel = {
  INFO: '✨',
  SUCCESS: '✨',
  WARNING: '✨',
  ERROR: '✨',
  DEBUG: '✨',
  FEATURE: '✨',
}

// Function removed to avoid unused variable warning

/**
 * Log a message to the console with better caller information
 * @param {string} message - The message to log
 * @param {string} emoji - The emoji prefix (use LogLevel constants)
 * @param {any[]} args - Additional arguments to log
 */
export function log (message, emoji = LogLevel.INFO, ...args) {
  // Format the basic message
  const formattedMessage = `${emoji} ${message}`

  // For browsers that support it, use console.groupCollapsed for cleaner output
  if (typeof console.groupCollapsed === 'function') {
    // Open a collapsed group with our message
    console.groupCollapsed(formattedMessage, ...args)

    // Show the trace inside the group - this will include clickable links to the actual source
    console.trace('Source:')

    // Close the group
    console.groupEnd()
  } else {
    // Fallback for browsers without groupCollapsed support
    console.log(formattedMessage, ...args)
    console.trace('Source:')
  }
}

/**
 * Log an info message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function info (message, ...args) {
  log(message, LogLevel.INFO, ...args)
}

/**
 * Log a success message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function success (message, ...args) {
  log(message, LogLevel.SUCCESS, ...args)
}

/**
 * Log a warning message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function warning (message, ...args) {
  log(message, LogLevel.WARNING, ...args)
}

/**
 * Log an error message
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function error (message, ...args) {
  log(message, LogLevel.ERROR, ...args)
}

/**
 * Log a debug message (only in development mode)
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function debug (message, ...args) {
  // Check if we're in development mode
  let isDev = true

  // If chrome API is available, use it to check for production mode
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    isDev = !chrome.runtime.getManifest().update_url
  }

  if (isDev) {
    log(message, LogLevel.DEBUG, ...args)
  }
}

/**
 * Log a feature-related message
 * @param {string} featureName - The name of the feature
 * @param {string} message - The message to log
 * @param {any[]} args - Additional arguments to log
 */
export function feature (featureName, message, ...args) {
  log(`[${featureName}] ${message}`, LogLevel.FEATURE, ...args)
}

// Default export for convenient importing
export default {
  log,
  info,
  success,
  warning,
  error,
  debug,
  feature,
  LogLevel,
}
