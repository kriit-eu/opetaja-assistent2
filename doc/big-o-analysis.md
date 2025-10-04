# Big-O Complexity Analysis - Õpetaja Assistent 2

## Overview

This document provides a comprehensive Big-O analysis of the key algorithms and operations in the Õpetaja Assistent 2 extension, focusing on time and space complexity for critical paths.

---

## Core Services

### 1. ApiService

#### `request(method, endpoint, params, options)`

**Time Complexity:** O(1) for cache hit, O(n) for network request

- **Best Case:** O(1) - Cached result exists and is not expired
- **Average Case:** O(n) - Network request where n is response size
- **Worst Case:** O(n) + O(m) - Network request fails, retries m times

**Space Complexity:** O(n) where n is the response size

- Stores response in memory
- May cache response (additional O(n) in cache storage)

**Key Optimizations:**

- **Request deduplication:** O(1) lookup in `pendingRequests` map prevents duplicate in-flight requests
- **Throttling:** Limits concurrent requests to avoid server overload
- **Caching:** O(1) cache lookup via key-based storage

```javascript
// Request deduplication - O(1) lookup
const reqKey = `${method}_${urlString}`
if (ApiService.pendingRequests[reqKey]) {
  return await ApiService.pendingRequests[reqKey] // O(1)
}
```

---

### 2. CacheService

#### `get(key)`

**Time Complexity:** O(1)

- In-memory cache: O(1) Map lookup
- Chrome storage: O(1) async key lookup

**Space Complexity:** O(n) where n is total cached data size

#### `set(key, value, expiration)`

**Time Complexity:** O(1)

- Writing to Map and chrome.storage.local

**Space Complexity:** O(k) where k is size of value being cached

#### `cleanup()`

**Time Complexity:** O(m) where m is number of cache entries

- Iterates through all entries to check expiration

```javascript
// O(m) iteration through all cache entries
for (const [key, entry] of this.cache.entries()) {
  if (entry.expiration && entry.expiration < now) {
    this.cache.delete(key) // O(1)
  }
}
```

---

### 3. DomService

#### `observeForElements(selectors, callback)`

**Time Complexity:** O(d \* s) where d is DOM depth, s is number of selectors

- MutationObserver triggers on every DOM mutation
- Each mutation checks all selectors against DOM tree

**Space Complexity:** O(1) - Observer maintains minimal state

#### `waitForElement(selector, timeout)`

**Time Complexity:** O(t/p \* d) where t is timeout, p is polling interval, d is DOM depth

- Polls every 100ms until timeout
- Each poll does querySelectorAll which is O(d)

**Optimization Opportunity:** Use MutationObserver instead of polling

---

## Feature-Specific Algorithms

### 4. Journal List Sync (JournalListSync)

#### `syncJournals(journals)`

**Time Complexity:** O(j \* (s + a)) where:

- j = number of journals
- s = avg students per journal
- a = avg assignments per journal

**Breakdown:**

1. Fetch journal data from Tahvel: O(j) API calls
2. For each journal:
   - Fetch students: O(1) API call → O(s) response processing
   - Fetch assignments: O(1) API call → O(a) response processing
   - Compare with Kriit: O(s \* a) comparisons
3. Build diff report: O(j _ s _ a) worst case

**Space Complexity:** O(j \* (s + a))

- Stores all journal data, students, and assignments in memory

**Critical Path:**

```javascript
// O(j) - iterate journals
for (const journal of journals) {
  // O(1) - API call, O(s) response
  const tahvelStudents = await api.tahvel.get(`/journals/${journal.id}/students`)

  // O(1) - API call, O(a) response
  const tahvelAssignments = await api.tahvel.get(`/journals/${journal.id}/assignments`)

  // O(1) - API call, O(s) response
  const kriitStudents = await api.kriit.get(`/journals/${journal.id}/students`)

  // O(s * a) - compare each student's grades for each assignment
  for (const student of tahvelStudents) {
    for (const assignment of tahvelAssignments) {
      compareGrade(student, assignment) // O(1)
    }
  }
}
```

**Optimization Strategies:**

1. **Parallel fetching:** Use `Promise.all()` to fetch all journals concurrently
   - Reduces wall-clock time from O(j) sequential to O(1) parallel (limited by throttling)
2. **Incremental comparison:** Only compare changed data
   - Reduce from O(s \* a) to O(c) where c is number of changed items
3. **Caching:** Cache journal/student/assignment data
   - Subsequent syncs become O(1) cache lookup

---

### 5. Lesson Discrepancies (LessonDiscrepanciesFeature)

#### `detectDiscrepancies(timetable, journal)`

**Time Complexity:** O(t \* j) where:

- t = number of timetable entries
- j = number of journal entries

**Algorithm:**

```javascript
// O(t) - iterate timetable
for (const timetableLesson of timetable) {
  // O(j) - search for matching journal entry
  const match = journalEntries.find(je => je.date === timetableLesson.date && je.startTime === timetableLesson.startTime)

  if (!match) {
    discrepancies.push(timetableLesson) // O(1)
  }
}
```

**Space Complexity:** O(d) where d is number of discrepancies

**Optimization:** Use a Map for O(1) lookups

```javascript
// Build O(j) map for O(1) lookups
const journalMap = new Map()
for (const entry of journalEntries) {
  const key = `${entry.date}_${entry.startTime}`
  journalMap.set(key, entry)
}

// O(t) iteration with O(1) lookups
for (const timetableLesson of timetable) {
  const key = `${timetableLesson.date}_${timetableLesson.startTime}`
  if (!journalMap.has(key)) {
    // O(1)
    discrepancies.push(timetableLesson)
  }
}
```

**Improved Time Complexity:** O(t + j) instead of O(t \* j)

---

### 6. Student Data Fetching (with Deduplication)

#### `fetchStudentsData(studentIds)`

**Time Complexity:** O(u + d) where:

- u = number of unique students
- d = number of duplicate requests

**Current Implementation:**

```javascript
// O(n) where n is total student requests (including duplicates)
const pendingRequests = {}

for (const studentId of studentIds) {
  // O(n)
  if (pendingRequests[studentId]) {
    // O(1) - reuse existing promise
    results.push(await pendingRequests[studentId])
  } else {
    // O(1) - create new request
    const promise = api.tahvel.get(`/students/${studentId}`)
    pendingRequests[studentId] = promise
    results.push(await promise)
  }
}
```

**Key Insight:** Deduplication reduces API calls from O(n) to O(u)

- If 100 students with 50% duplicates: 50 API calls instead of 100
- Significant savings when processing multiple journals with overlapping students

**Space Complexity:** O(u) for pending requests map

---

## Edge Cases & Worst-Case Scenarios

### 1. Large Journal Sync

**Scenario:** 50 journals, each with 30 students and 20 assignments

- Total comparisons: 50 _ 30 _ 20 = 30,000 operations
- API calls: 50 \* 3 = 150 calls (journals, students, assignments)
- With caching: Subsequent syncs = O(1) cache lookups

**Mitigation:**

- Throttle API calls to 10 concurrent
- Cache aggressively (24hr expiration)
- Incremental updates (only changed data)

### 2. DOM Mutation Storm

**Scenario:** Rapid DOM changes trigger excessive MutationObserver callbacks

- Without throttling: O(m \* s) where m = mutations, s = selectors checked
- Each callback checks all selectors

**Mitigation:**

- Debounce observer callbacks
- Disconnect observer after finding elements
- Use more specific selectors

### 3. Cache Bloat

**Scenario:** Caching everything without cleanup

- Memory usage grows unbounded: O(∞)
- Chrome storage quota exceeded (10MB limit)

**Mitigation:**

- Periodic cleanup: O(m) every 10 minutes
- LRU eviction when approaching quota
- Separate critical vs non-critical cache tiers

---

## Summary Table

| Operation              | Time Complexity | Space Complexity | Optimizable           |
| ---------------------- | --------------- | ---------------- | --------------------- |
| API request (cached)   | O(1)            | O(n)             | ✅ Already optimal    |
| API request (uncached) | O(n)            | O(n)             | ⚠️ Network bound      |
| Request deduplication  | O(1)            | O(u)             | ✅ Already optimal    |
| Cache lookup           | O(1)            | O(1)             | ✅ Already optimal    |
| Cache cleanup          | O(m)            | O(1)             | ✅ Already optimal    |
| Journal sync           | O(j\*(s+a))     | O(j*s*a)         | ⚠️ Can parallelize    |
| Lesson discrepancy     | O(t\*j)         | O(d)             | ✅ Use Map for O(t+j) |
| DOM observation        | O(m\*s)         | O(1)             | ⚠️ Debounce callbacks |
| Student fetch (dedup)  | O(u)            | O(u)             | ✅ Already optimal    |

**Legend:**

- ✅ = Already optimized
- ⚠️ = Optimization possible
- ❌ = Needs optimization

---

## Recommendations

### High Priority

1. **Lesson Discrepancies:** Implement Map-based O(1) lookup instead of O(j) array search
   - Current: O(t \* j)
   - Optimized: O(t + j)
   - Impact: 10x-100x faster for large datasets

2. **Journal Sync Parallelization:** Use Promise.all() for concurrent journal fetching
   - Current: Sequential O(j) API calls
   - Optimized: Parallel O(1) wall-clock time
   - Impact: 10x-50x faster sync

### Medium Priority

3. **DOM Observer Debouncing:** Throttle mutation callbacks
   - Reduces CPU usage during rapid DOM changes
   - Impact: Smoother UI, less jank

4. **Incremental Sync:** Only process changed data
   - Track last sync timestamp
   - Only compare new/modified entries
   - Impact: 90% reduction in processing for repeat syncs

### Low Priority

5. **Cache Tiering:** Separate hot/cold data
   - Keep frequently accessed data in memory
   - Move infrequent data to chrome.storage
   - Impact: Better memory management

---

## Performance Metrics (Theoretical)

Based on Big-O analysis:

| Scenario                                | Current   | Optimized | Improvement     |
| --------------------------------------- | --------- | --------- | --------------- |
| Sync 50 journals                        | ~30s      | ~3s       | 10x faster      |
| Find lesson discrepancies (100 entries) | ~100ms    | ~10ms     | 10x faster      |
| Fetch 100 students (50% dupes)          | 100 calls | 50 calls  | 50% reduction   |
| Cache lookup                            | <1ms      | <1ms      | Already optimal |

**Note:** Actual performance depends on network latency, server response time, and browser performance. These metrics represent algorithmic improvements only.

---

## Conclusion

The codebase demonstrates good understanding of performance optimization through:

- Effective caching (O(1) lookups)
- Request deduplication (O(u) instead of O(n))
- Throttling (prevents server overload)

Key areas for improvement:

- Use Map/Set for O(1) lookups instead of array.find() O(n)
- Parallelize independent operations
- Implement incremental updates

Overall, the algorithmic foundation is solid with clear paths to 10x+ performance gains through targeted optimizations.
