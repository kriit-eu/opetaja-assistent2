# Triangles Debug Feature

This feature fetches data from the three main Tahvel API endpoints used by the triangle-reference implementation and logs the results to the browser console for debugging purposes.

## Purpose

The Triangles Debug Feature helps developers understand the data structure and content returned by the Tahvel API endpoints that are used for creating notification triangles in the journal system.

## API Endpoints

The feature fetches data from these three endpoints:

1. **GET `/journals/{journalId}`** - Basic journal information
2. **GET `/journals/{journalId}/journalEntriesByDate`** - Journal entries grouped by date
3. **GET `/journals/{journalId}/journalStudents`** - Students enrolled in the journal

## How It Works

1. **Auto-detection**: Automatically detects journal IDs from the current page URL or journal links
2. **Sequential fetching**: Fetches data from all three endpoints for each detected journal
3. **Console logging**: Logs all data with clear formatting and grouping in the browser console
4. **Error handling**: Catches and logs any API errors for debugging

## Usage

1. Navigate to a Tahvel journal page or journal list page
2. The feature will automatically activate and start fetching data
3. Open the browser console (F12) to see the debug output
4. Look for messages starting with "🔍 Triangles Debug:"

## Console Output

The feature provides structured console output:

```
🔍 Triangles Debug: Found 2 journal ID(s): [348986, 348987]
📚 Triangles Debug: Journal 348986
  🔄 Fetching basic journal info...
  📋 Basic Journal Info: { id: 348986, nameEt: "...", ... }
  🔄 Fetching journal entries by date...
  📅 Journal Entries by Date: [{ date: "...", entries: [...] }]
  🔄 Fetching journal students...
  👥 Journal Students: [{ id: 123, student: {...} }]
  📊 Summary for Journal 348986: { journalName: "...", entriesCount: 5, studentsCount: 25 }
```

## Configuration

- **Cache disabled**: All API calls are made with `cache: false` to ensure fresh data
- **Limited journals**: Only debugs the first 3 journals found to avoid overwhelming output
- **Parameters match triangle-reference**: Uses the same parameters as the triangle-reference implementation

## Integration

The feature is automatically registered when the extension loads and will activate on journal-related pages in the Tahvel system.
