import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

class PerformanceToolsFeature extends BaseFeature {
  constructor() {
    // Always activate on any Tahvel page
    super('PerformanceTools', () => true)
    this.isLoaded = false
  }

  async onActivate() {
    // Always load tools regardless of debug mode - we'll check debug when running benchmarks
    if (this.isLoaded) {
      Logger.debug('Performance tools already loaded')
      return
    }

    try {
      const monitorModule = await import('../../services/ApiPerformanceMonitor.js')
      window.OA2_ApiMonitor = monitorModule.apiMonitor

      const benchmarkModule = await import('../../../test/performance/benchmark.test.js')
      window.OA2_Benchmark = {
        PerformanceBenchmark: benchmarkModule.PerformanceBenchmark,
        MemoryProfiler: benchmarkModule.MemoryProfiler,
        ApiProfiler: benchmarkModule.ApiProfiler,
        runBenchmarkSuite: benchmarkModule.runBenchmarkSuite,
        stressTestJournalSync: benchmarkModule.stressTestJournalSync,
        testEdgeCases: benchmarkModule.testEdgeCases
      }

      this.isLoaded = true
      Logger.info('✨ Performance tools loaded → window.OA2_ApiMonitor, window.OA2_Benchmark')
    } catch (err) {
      Logger.error('Failed to load performance tools:', err.message, err.stack)
    }
  }

  async runBenchmark(iterations = 10) {
    if (!this.isLoaded || !window.OA2_Benchmark) {
      Logger.error('Performance tools not loaded.')
      return null
    }

    try {
      Logger.info(`Running benchmark suite with ${iterations} iterations...`)
      const results = await window.OA2_Benchmark.runBenchmarkSuite(iterations)
      Logger.info('Benchmark complete:', results)
      return results
    } catch (err) {
      Logger.error('Benchmark failed:', err.message)
      return null
    }
  }

  async runStressTest(journalCount = 50) {
    if (!this.isLoaded || !window.OA2_Benchmark) {
      Logger.error('Performance tools not loaded.')
      return null
    }

    try {
      Logger.info(`Running stress test with ${journalCount} journals...`)
      const results = await window.OA2_Benchmark.stressTestJournalSync(journalCount)
      Logger.info('Stress test complete:', results)
      return results
    } catch (err) {
      Logger.error('Stress test failed:', err.message)
      return null
    }
  }

  getMonitorReport() {
    if (!this.isLoaded || !window.OA2_ApiMonitor) {
      Logger.error('Performance monitor not loaded.')
      return null
    }

    return window.OA2_ApiMonitor.report()
  }

  exportMonitorData(format = 'json') {
    if (!this.isLoaded || !window.OA2_ApiMonitor) {
      Logger.error('Performance monitor not loaded.')
      return
    }

    if (format === 'csv') {
      window.OA2_ApiMonitor.exportCSV()
    } else {
      window.OA2_ApiMonitor.exportJSON()
    }
  }
}

export default PerformanceToolsFeature
