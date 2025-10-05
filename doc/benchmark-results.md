## Benchmark Results

Here's a sample output from running the benchmark with 10,000 iterations:

```
📊 PERFORMANCE BENCHMARK RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 What We're Testing:
   This benchmark measures extension performance across:
   • DOM query operations (finding elements)
   • Data processing (array operations, calculations)
   • Object creation and manipulation
   • JSON serialization/deserialization
   • Async task execution

🔬 Test Types: DOM Query, Data Processing, Object Creation, JSON Operations, Async Task

⚡ Performance (10000 iterations):
   Average time per operation: 0.013 ms
   Total execution time: 127.900 ms
   Fastest operation: 0.000 ms
   Slowest operation: 17.900 ms
   Operations per second: 78186

💾 Memory Usage:
   Before tests: 118.20 MB / 146.44 MB
   After tests:  118.20 MB / 146.44 MB
   Memory delta: 0.00 MB ➡️ unchanged
   Heap limit:   4095.75 MB
```

### What the Metrics Mean

- **Average time per operation**: How long each test operation takes on average
- **Total execution time**: Total time to run all 10,000 iterations
- **Fastest/Slowest operation**: Range of execution times (helps identify outliers)
- **Operations per second**: How many operations the extension can handle per second
- **Memory delta**: Memory usage change during testing (should be minimal for efficient code)

### Performance Targets

- ✅ **Good**: < 1ms average per operation, > 1000 ops/sec
- ⚠️ **Acceptable**: 1-5ms average, 200-1000 ops/sec
- ❌ **Needs optimization**: > 5ms average, < 200 ops/sec
