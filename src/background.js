/**
 * Background script
 */
import Logger from './services/Logger.js'
import { cacheService } from './services/CacheService.js'

// Use both the Logger and regular console.log for extra visibility
Logger.info('Background script loaded')
console.log('📔 Background script loaded - ' + new Date().toISOString())

// Set up listener for inter-process communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  Logger.debug('Received message in background:', message)

  // Handle cache statistics request
  if (message.action === 'getCacheStats') {
    cacheService.getStats().then(stats => {
      Logger.debug('Cache stats retrieved:', stats)
      sendResponse({ status: 'success', stats })
    }).catch(error => {
      Logger.error('Error getting cache stats:', error)
      sendResponse({ status: 'error', message: error.message })
    })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle Kriit API requests to bypass mixed content restrictions
  if (message.action === 'kriitApiRequest') {
    const { method, url, headers, body } = message

    Logger.debug(`Making ${method} request to ${url} from background script`)

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    if (method !== 'GET' && body) {
      requestOptions.body = JSON.stringify(body)
    }

    fetch(url, requestOptions)
      .then(async response => {
        const responseText = await response.text()

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${responseText}`)
        }

        // Try to parse as JSON, fall back to text
        try {
          const data = JSON.parse(responseText)
          sendResponse({ status: 'success', data })
        } catch (error) {
          sendResponse({ status: 'success', data: responseText })
        }
      })
      .catch(error => {
        Logger.error('Kriit API request failed:', error)
        sendResponse({ status: 'error', message: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }

  // Handle lesson times loading request
  if (message.action === 'loadLessonTimes') {
    const jsonUrl = chrome.runtime.getURL('src/features/lessonDiscrepancies/TahvelLessonTimes.json')

    fetch(jsonUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then(data => {
        Logger.debug('Lesson times loaded successfully:', data)
        sendResponse({ status: 'success', data })
      })
      .catch(error => {
        Logger.error('Error loading lesson times:', error)
        sendResponse({ status: 'error', error: error.message })
      })

    // Return true to indicate we will send a response asynchronously
    return true
  }
})
