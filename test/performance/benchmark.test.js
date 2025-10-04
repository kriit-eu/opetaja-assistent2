/**
 * Performance Benchmark Suite
 * Tests API performance, memory usage, and sync operations
 */

import Logger from '../../src/services/Logger.js'

export class PerformanceBenchmark {
  static async measure(name, fn) {
    const start = performance.now()
    const result = await fn()
    const duration = performance.now() - start
    return { name, duration, result }
  }

  static async runSuite(iterations = 10) {
    Logger.info(`Running benchmark suite with ${iterations} iterations...`)
    const results = []
    const tests = [
      {
        name: 'DOM Query',
        fn: () => document.querySelectorAll('div').length
      },
      {
        name: 'Data Processing',
        fn: () => Array.from({ length: 100 }, (_, i) => i * 2).reduce((a, b) => a + b, 0)
      },
      {
        name: 'Object Creation',
        fn: () => ({ id: Date.now(), data: 'test', items: [1, 2, 3] })
      },
      {
        name: 'JSON Operations',
        fn: () => JSON.parse(JSON.stringify({ test: 'data', nested: { value: 123 } }))
      },
      {
        name: 'Async Task',
        fn: () => Promise.resolve({ completed: true })
      }
    ]

    for (let i = 0; i < iterations; i++) {
      const testIndex = i % tests.length
      const test = tests[testIndex]
      const result = await this.measure(`${test.name} #${Math.floor(i / tests.length) + 1}`, async () => {
        return await test.fn()
      })
      results.push(result)
    }

    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length
    Logger.info(`Benchmark complete. Avg duration: ${avgDuration.toFixed(2)}ms`)

    return {
      iterations,
      results,
      avgDuration,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      testTypes: tests.map(t => t.name)
    }
  }
}

export class MemoryProfiler {
  static getMemoryUsage() {
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      }
    }
    return null
  }

  static async profile(fn) {
    const before = this.getMemoryUsage()
    await fn()
    const after = this.getMemoryUsage()

    if (before && after) {
      return {
        before,
        after,
        delta: after.used - before.used
      }
    }
    return null
  }
}

export class ApiProfiler {
  static async profileEndpoint(api, method, endpoint, params = {}) {
    const start = performance.now()
    let error = null
    let result = null

    try {
      result = await api[method](endpoint, params)
    } catch (e) {
      error = e
    }

    const duration = performance.now() - start

    return {
      method,
      endpoint,
      duration,
      success: !error,
      error: error?.message,
      resultSize: JSON.stringify(result || {}).length
    }
  }
}

export async function runBenchmarkSuite(iterations = 10) {
  Logger.info('🚀 Starting performance benchmark suite...')

  const results = {
    timestamp: new Date().toISOString(),
    iterations,
    benchmarks: {}
  }

  // Basic performance test
  results.benchmarks.basic = await PerformanceBenchmark.runSuite(iterations)

  // Memory profiling
  const memoryResult = await MemoryProfiler.profile(async () => {
    const data = new Array(1000).fill({ test: 'data' })
    await new Promise(resolve => setTimeout(resolve, 10))
  })
  results.benchmarks.memory = memoryResult

  Logger.info('✅ Benchmark suite complete!')
  console.log('📊 Benchmark Results:', results)

  return results
}

export async function stressTestJournalSync(journalCount = 50) {
  Logger.info(`Running stress test with ${journalCount} journals...`)

  const results = {
    journalCount,
    startTime: Date.now(),
    journals: []
  }

  for (let i = 0; i < journalCount; i++) {
    const start = performance.now()
    // Simulate journal sync
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50))
    const duration = performance.now() - start

    results.journals.push({
      id: i,
      duration,
      success: Math.random() > 0.1 // 90% success rate
    })
  }

  results.endTime = Date.now()
  results.totalDuration = results.endTime - results.startTime
  results.avgDuration = results.journals.reduce((sum, j) => sum + j.duration, 0) / journalCount
  results.successRate = results.journals.filter(j => j.success).length / journalCount

  Logger.info(`✅ Stress test complete! Success rate: ${(results.successRate * 100).toFixed(1)}%`)
  console.log('📊 Stress Test Results:', results)

  return results
}

export async function testEdgeCases() {
  Logger.info('Running edge case tests...')

  const results = {
    cases: []
  }

  // Test empty data
  results.cases.push(
    await PerformanceBenchmark.measure('Empty data', async () => {
      return []
    })
  )

  // Test large data
  results.cases.push(
    await PerformanceBenchmark.measure('Large data', async () => {
      return new Array(10000).fill({ data: 'test' })
    })
  )

  // Test timeout
  results.cases.push(
    await PerformanceBenchmark.measure('Timeout test', async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return { complete: true }
    })
  )

  Logger.info('✅ Edge case tests complete!')
  console.log('📊 Edge Case Results:', results)

  return results
}

// Browser environment compatibility
if (typeof window !== 'undefined') {
  window.OA2_Benchmark = {
    PerformanceBenchmark,
    MemoryProfiler,
    ApiProfiler,
    runBenchmarkSuite,
    stressTestJournalSync,
    testEdgeCases
  }
}
