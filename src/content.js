/**
 * Õpetaja Assistent 2 - Main content script
 */
import TahvelExtension from './core/Extension.js'
import Logger from './services/Logger.js'

const VERSION = '6'

// Print version and build time info using our new Logger
Logger.info(`Content script loaded - version ${VERSION}`)

// Initialize immediately or when DOM is ready
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', TahvelExtension.init) : TahvelExtension.init()

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggleDebugMode') {
    if (message.enabled) {
      Logger.enableDebugMode()
      if (Logger.isDebugMode()) Logger.debug('Debug mode enabled from popup')
    } else {
      Logger.disableDebugMode()
      Logger.info('Debug mode disabled from popup')
    }
    sendResponse({ success: true })
  } else if (message.action === 'runBenchmark') {
    if (Logger.isDebugMode()) Logger.debug('Received runBenchmark request')
    runPerformanceBenchmark()
      .then(results => {
        if (Logger.isDebugMode()) Logger.debug('Benchmark completed:', results)
        sendResponse({ success: true, results })
      })
      .catch(error => {
        Logger.error('Benchmark error:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true // Keep channel open for async response
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
  } else if (message.action === 'getFutureSubjects') {
    if (Logger.isDebugMode()) Logger.debug('Received getFutureSubjects request')
    handleGetFutureSubjects(message.comparisonDate)
      .then(subjects => {
        if (Logger.isDebugMode()) Logger.debug('Future subjects found:', subjects)
        sendResponse({ status: 'success', data: subjects })
      })
      .catch(error => {
        Logger.error('Error getting future subjects:', error)
        sendResponse({ status: 'error', message: error.message })
      })
    return true // Keep the message channel open for async responses
  }
  return true // Keep the message channel open for async responses
})

/**
 * Format benchmark results in a human-readable way
 * @param {Object} results - The benchmark results
 * @returns {string} Formatted summary
 */
function formatBenchmarkResults(results) {
  const { benchmarks, iterations } = results
  const { basic, memory } = benchmarks

  const formatBytes = bytes => {
    const mb = (bytes / 1024 / 1024).toFixed(2)
    return `${mb} MB`
  }

  const formatMs = ms => `${ms.toFixed(3)} ms`

  let output = '\n📊 PERFORMANCE BENCHMARK RESULTS\n'
  output += '━'.repeat(60) + '\n\n'

  output += `📝 What We're Testing:\n`
  output += `   This benchmark measures extension performance across:\n`
  output += `   • DOM query operations (finding elements)\n`
  output += `   • Data processing (array operations, calculations)\n`
  output += `   • Object creation and manipulation\n`
  output += `   • JSON serialization/deserialization\n`
  output += `   • Async task execution\n\n`

  // Test types breakdown
  if (basic.testTypes) {
    output += `🔬 Test Types: ${basic.testTypes.join(', ')}\n\n`
  }

  // Performance metrics
  output += `⚡ Performance (${iterations} iterations):\n`
  output += `   Average time per operation: ${formatMs(basic.avgDuration)}\n`
  output += `   Total execution time: ${formatMs(basic.totalDuration)}\n`
  output += `   Fastest operation: ${formatMs(Math.min(...basic.results.map(r => r.duration)))}\n`
  output += `   Slowest operation: ${formatMs(Math.max(...basic.results.map(r => r.duration)))}\n`
  output += `   Operations per second: ${(1000 / basic.avgDuration).toFixed(0)}\n\n`

  // Memory metrics
  output += `💾 Memory Usage:\n`
  output += `   Before tests: ${formatBytes(memory.before.used)} / ${formatBytes(memory.before.total)}\n`
  output += `   After tests:  ${formatBytes(memory.after.used)} / ${formatBytes(memory.after.total)}\n`
  output += `   Memory delta: ${formatBytes(Math.abs(memory.delta))} ${memory.delta > 0 ? '📈 increased' : memory.delta < 0 ? '📉 decreased' : '➡️ unchanged'}\n`
  output += `   Heap limit:   ${formatBytes(memory.before.limit)}\n\n`

  output += '━'.repeat(60)

  return output
}

/**
 * Run performance benchmark
 * @returns {Promise<Object>} Benchmark results
 */
async function runPerformanceBenchmark() {
  try {
    // Get the performance feature from the extension
    const extension = window.OA2_Extension
    if (!extension || !extension.activeFeatures) {
      throw new Error('Extension not initialized. Please reload the page.')
    }

    const perfFeature = extension.activeFeatures.find(f => f.name === 'PerformanceTools')
    if (!perfFeature) {
      throw new Error('Performance tools feature not found.')
    }

    // Run the benchmark through the feature
    Logger.info('🚀 Starting performance benchmark suite...')
    const results = await perfFeature.runBenchmark(10000)

    if (results) {
      // Format human-readable summary
      const summary = formatBenchmarkResults(results)
      Logger.info('✅ Benchmark complete:')
      // eslint-disable-next-line no-console
      console.log(summary)
      // Also log raw JSON for those who need it
      // eslint-disable-next-line no-console
      console.log('\nRaw JSON:', JSON.stringify(results, null, 2))
    }

    return results
  } catch (error) {
    Logger.error('Benchmark failed:', error)
    throw error
  }
}

/**
 * Handle getting future subjects from timetable
 * @param {string} comparisonDate - The comparison date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of future lesson subjects
 */
async function handleGetFutureSubjects(comparisonDate) {
  try {
    // Import the API service
    const { api } = await import('./core/BaseFeature.js')
    const apiService = api.tahvel

    if (!apiService) {
      throw new Error('API teenus pole saadaval')
    }

    // Get user info to get school ID
    const userInfo = await apiService.get(
      '/user',
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!userInfo || !userInfo.school) {
      throw new Error('Kasutaja pole sisse logitud või kool pole saadaval')
    }

    const schoolId = userInfo.school.id

    if (!schoolId) {
      throw new Error('Kooli ID pole saadaval')
    }

    // Get current study year dates
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

    // First, get all active teachers in the school
    const teachersData = await apiService.get(
      `/teachers?isActive=true&lang=ET&page=0&size=1000`,
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!teachersData || !teachersData.content) {
      throw new Error('Õpetajate andmed pole saadaval')
    }

    // Filter teachers by school
    const schoolTeachers = teachersData.content.filter(teacher => teacher.school && teacher.school.id === schoolId)

    if (Logger.isDebugMode()) Logger.debug(`Found ${schoolTeachers.length} teachers in school ${schoolId}`)

    // Get all teacher IDs
    const teacherIds = schoolTeachers.map(teacher => teacher.id)

    if (teacherIds.length === 0) {
      throw new Error('Aktiivseid õpetajaid pole leitud')
    }

    // Fetch timetable for all teachers at once
    const teacherIdsParam = teacherIds.join(',')
    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherIdsParam}&thru=${thru}`

    if (Logger.isDebugMode()) Logger.debug(`Fetching timetable for ${teacherIds.length} teachers`)

    const timetableData = await apiService.get(
      endpoint,
      {},
      {
        cache: true,
        cacheExpiration: 24 * 60 * 60 * 1000 // 24 hours
      }
    )

    if (!timetableData || !timetableData.timetableEvents) {
      throw new Error('Tunniplaani andmed pole saadaval')
    }

    // Filter for future lessons only based on the comparison date
    const compareDate = comparisonDate ? new Date(comparisonDate) : new Date()
    compareDate.setHours(0, 0, 0, 0)

    const futureEvents = timetableData.timetableEvents.filter(event => {
      const eventDate = new Date(event.date)
      eventDate.setHours(0, 0, 0, 0)
      // Exclude lessons with null journalId and only show future lessons
      return eventDate >= compareDate && event.journalId !== null && event.journalId !== undefined
    })

    if (Logger.isDebugMode()) {
      Logger.debug(
        `Found ${futureEvents.length} future timetable events from all teachers (from ${comparisonDate || 'today'}, excluding lessons without journalId)`
      )
    }
    return futureEvents
  } catch (error) {
    Logger.error('Error in handleGetFutureSubjects:', error)
    throw error
  }
}
