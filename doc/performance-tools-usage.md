# Performance Tools Usage Guide

## Overview

The performance tools are now integrated as a proper feature in the extension. They automatically load when debug mode is enabled.

## How to Use

### 1. Enable Debug Mode

1. Open the extension popup (click the ÕA2 icon in your browser)
2. Toggle "Debug režiim" to ON
3. The page will automatically reload
4. Performance tools are now loaded and available

### 2. Run Benchmarks from Popup

1. With debug mode enabled, a "Käivita jõudlustestid" button appears in the popup
2. Click the button to run the benchmark suite
3. Results will be logged to the browser console (F12)

### 3. Use Tools from Console

After debug mode is enabled, the following are available in the page console:

#### API Performance Monitor

```javascript
// Enable monitoring
window.OA2_ApiMonitor.enable()

// View statistics
window.OA2_ApiMonitor.report()

// Export data
window.OA2_ApiMonitor.exportJSON() // Download as JSON
window.OA2_ApiMonitor.exportCSV() // Download as CSV

// Reset stats
window.OA2_ApiMonitor.reset()
```

#### Benchmark Tools

```javascript
// Run full benchmark suite
await window.OA2_Benchmark.runBenchmarkSuite(10) // 10 iterations

// Run stress test
await window.OA2_Benchmark.stressTestJournalSync(50) // 50 journals

// Run edge case tests
await window.OA2_Benchmark.testEdgeCases()
```

## Architecture

The performance tools are implemented as a `PerformanceToolsFeature` that:

1. **Activates on all Tahvel pages** - Uses a URL pattern function `() => true` to always activate
2. **Loads only when debug mode is enabled** - Checks `chrome.storage.sync` directly during `onActivate()`
3. **Exposes global APIs** - Sets `window.OA2_ApiMonitor` and `window.OA2_Benchmark`
4. **Integrates with the feature system** - Registered in `FeaturesRegistry` and activates via standard `onActivate()` lifecycle
5. **Provides popup controls** - Benchmark button appears in popup when debug mode is on

### Key Implementation Details

- The feature uses `onActivate()` (not `init()`) to hook into the BaseFeature lifecycle
- Debug mode is checked directly from `chrome.storage.sync` to avoid timing issues with Logger's cache
- The page reloads when debug mode is toggled to ensure all features reinitialize with the correct state

## Files

- **Feature**: `src/features/performance/PerformanceToolsFeature.js`
- **Monitor**: `src/services/ApiPerformanceMonitor.js`
- **Benchmarks**: `test/performance/benchmark.test.js`
- **Registry**: `src/core/FeaturesRegistry.js` (registration)
- **Popup**: `src/assets/templates/popup.html` & `src/popup.js` (UI controls)

## Troubleshooting

**Problem**: "Performance tools not loaded" error when clicking benchmark button

**Solution**:

1. Make sure debug mode is enabled (toggle ON in popup)
2. The page will reload automatically when you toggle debug mode
3. After reload, the performance tools should be loaded (check console for "✨ Performance tools loaded" message)
4. Now the benchmark button should work

**Problem**: `window.OA2_Benchmark` is undefined

**Solution**:

1. Debug mode must be ON - toggle it in the popup
2. Wait for the page to reload automatically
3. Check the console for "✨ Performance tools loaded → window.OA2_ApiMonitor, window.OA2_Benchmark"
4. If you don't see this message, check for any errors in the console

**Problem**: Extension features not accessible

**Solution**: The extension exposes itself globally as `window.OA2_Extension` which contains all active features. You can inspect it in the console:

```javascript
// View all loaded features
console.log(window.OA2_Extension.activeFeatures)

// Find the performance tools feature
const perfFeature = window.OA2_Extension.activeFeatures.find(f => f.name === 'PerformanceTools')
console.log(perfFeature)
```

## Notes

- Performance tools are **development-only** and only load when debug mode is active
- The page automatically reloads when you toggle debug mode to ensure proper initialization
- All benchmark results are logged to the console for analysis
- API monitoring data can be exported for further analysis
