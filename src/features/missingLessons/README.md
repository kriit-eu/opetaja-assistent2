# Missing Lessons Feature

## Overview

The Missing Lessons feature displays a table showing lessons that are scheduled in the timetable but are missing from the journal entries. This helps teachers identify which lessons they haven't recorded yet.

## User Story

As a teacher, I can see a table of missing lessons from the journal so that I know which lessons I need to add to complete my journal entries.

## Acceptance Criteria

✅ On a journal page, the teacher sees the "Puuduvad tunnid" section
✅ The system compares the timetable with the journal entries  
✅ A lesson is considered missing if, on the same date and start time, no entry exists in the journal
✅ The table contains three columns: "Kuupäev", "Algustund", and "Tundide arv"
✅ The table is sorted by date in ascending order
✅ If no lessons are missing, the table is not shown and the text "Puuduolevaid tunde pole" is displayed
✅ Loading the table is optimized for speed with caching

## How It Works

### Data Sources

1. **Journal Entries**: Fetches real journal entries using `/journals/{id}/journalEntriesByDate`
2. **Timetable Data**: Attempts to fetch from multiple possible timetable API endpoints:
   - `/journals/{id}/timetable`
   - `/journals/{id}/schedule`
   - `/timetable/journal/{id}`
   - `/schedule/journal/{id}`
   - `/journals/{id}/lessons/planned`
3. **Pattern Analysis**: If no timetable API is available, analyzes existing journal entry patterns to identify potential missing lessons

### Missing Lesson Detection Strategy

The feature uses a multi-step approach:

1. **Direct Timetable Comparison**: If timetable API data is available, directly compares planned vs actual lessons
2. **Pattern-Based Analysis**: If no timetable API, analyzes journal history to identify:
   - Typical lesson days (Monday, Wednesday, etc.)
   - Common lesson times and durations
   - Missing entries on days that usually have lessons

A lesson is considered missing when:

- There's a timetable entry for a specific date and lesson number
- No corresponding journal entry exists for that date/lesson combination
- Only lesson entries (`SISSEKANNE_T`) are considered, not independent work or other entry types

### Display Logic

- **With Missing Lessons**: Shows a table with date, start lesson, and lesson count
- **No Missing Lessons**: Shows "Puuduolevaid tunde pole" message
- **Table Styling**: Matches Tahvel's design patterns with proper spacing and colors

## Technical Implementation

### File Structure

```
src/features/missingLessons/
├── MissingLessonsFeature.js     # Main feature implementation
└── README.md                    # This documentation
```

### Key Methods

- `fetchComparisonData()` - Retrieves journal and timetable data
- `fetchTimetableData()` - Tries multiple API endpoints to find timetable data
- `analyzeJournalPatterns()` - Fallback pattern analysis when no timetable API available
- `normalizeTimetableData()` - Converts API data to consistent format
- `findMissingLessons()` - Compares data to find missing lessons
- `buildMissingLessonsTable()` - Creates the HTML table
- `formatDate()` / `parseDate()` - Date utility functions

### Integration

The feature is registered in `FeaturesRegistry.js` and automatically activates on journal edit pages (`/journal/{id}/edit`).

## Performance Optimizations

- **Caching**: Journal entries are cached for 5 minutes to reduce API calls
- **Multiple API Attempts**: Tries several timetable endpoints efficiently with early termination on success
- **Efficient Comparison**: Uses Map/Set data structures for fast lookups
- **Pattern Analysis**: Smart pattern recognition minimizes computation while maximizing accuracy
- **Limited Results**: Results are limited to prevent UI overload

## Future Enhancements

1. **Enhanced Pattern Recognition**: More sophisticated algorithms for detecting lesson patterns
2. **Machine Learning**: Learn from teacher behavior to predict missing lessons
3. **Click Actions**: Add ability to click on missing lessons to create journal entries
4. **Filtering**: Add options to filter by date range or lesson type
5. **Visual Indicators**: Add color coding for different confidence levels of missing lessons
6. **Timetable Integration**: Direct integration when official timetable APIs become available

## Dependencies

- BaseFeature (core framework)
- ApiService (for API calls)
- Logger (for debugging)

## Browser Support

Works in all modern browsers that support ES6+ features and Chrome Extensions API.
