/**
 * API Performance Monitor - Tracks API call performance metrics
 */

import Logger from './Logger.js'

class ApiPerformanceMonitor {
  constructor() {
    this.enabled = false
    this.calls = []
    this.stats = {}
  }

  enable() {
    this.enabled = true
    Logger.info('API Performance Monitor enabled')
  }

  disable() {
    this.enabled = false
    Logger.info('API Performance Monitor disabled')
  }

  recordCall(method, url, duration, fromCache = false, error = null) {
    if (!this.enabled) return

    const call = {
      timestamp: Date.now(),
      method,
      url,
      duration,
      fromCache,
      error: error ? error.message : null
    }

    this.calls.push(call)

    // Update stats
    const key = `${method} ${url}`
    if (!this.stats[key]) {
      this.stats[key] = {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        cacheHits: 0,
        errors: 0
      }
    }

    const stat = this.stats[key]
    stat.count++
    stat.totalDuration += duration
    stat.avgDuration = stat.totalDuration / stat.count
    stat.minDuration = Math.min(stat.minDuration, duration)
    stat.maxDuration = Math.max(stat.maxDuration, duration)
    if (fromCache) stat.cacheHits++
    if (error) stat.errors++
  }

  getStats() {
    return {
      calls: this.calls,
      stats: this.stats,
      summary: {
        totalCalls: this.calls.length,
        cacheHits: this.calls.filter(c => c.fromCache).length,
        errors: this.calls.filter(c => c.error).length,
        avgDuration: this.calls.reduce((sum, c) => sum + c.duration, 0) / this.calls.length || 0
      }
    }
  }

  report() {
    const stats = this.getStats()
    console.group('📊 API Performance Report')
    console.log('Summary:', stats.summary)
    console.log('Detailed Stats:', stats.stats)
    console.groupEnd()
    return stats
  }

  reset() {
    this.calls = []
    this.stats = {}
    Logger.info('API Performance Monitor reset')
  }

  exportJSON() {
    const stats = this.getStats()
    const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' })
    this.download(blob, 'api-performance.json')
  }

  exportCSV() {
    const csv = ['Method,URL,Duration,From Cache,Error']
    this.calls.forEach(call => {
      csv.push(`${call.method},"${call.url}",${call.duration},${call.fromCache},${call.error || ''}`)
    })
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' })
    this.download(blob, 'api-performance.csv')
  }

  download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

export const apiMonitor = new ApiPerformanceMonitor()
