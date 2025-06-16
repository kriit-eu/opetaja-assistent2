# Triangle Reference Files

This folder contains all the files related to creating and managing notification triangles in the Tahvel journal system.

## Overview

The notification triangles are visual indicators that appear next to journal entries to alert users about:

1. **Missing Lessons** (Yellow triangle) - When lessons from timetable are missing in the journal
2. **Lesson Discrepancies** (Grey triangle) - When there are differences between journal entries and timetable
3. **Missing Grades** (Red triangle) - When grades are missing and the last lesson is in the past
4. **Not Synchronized** (Blue triangle) - When the journal is not synchronized with Kriit

## File Structure

### Primary Triangle Creation Files

- **`modules/tahvel/TahvelJournalList.ts`** - Contains the main `addWarningTriangles()` method that creates all notification triangles
- **`modules/tahvel/TahvelDom.ts`** - Contains `createExclamationMark()` helper method to generate triangle DOM elements

### Data Analysis Files

- **`shared/AssistentCache.ts`** - Analyzes journal data to determine when triangles should be shown
- **`shared/AssistentTypes.ts`** - Type definitions for the data structures used

### Configuration Files

- **`modules/tahvel/index.ts`** - Configures when `addWarningTriangles()` should run

### Supporting Files (Simplified Stubs)

- **`shared/AssistentStore.ts`** - Caching layer for data retrieval
- **`shared/AssistentApiClient.ts`** - API client for data fetching
- **`shared/AssistentDom.ts`** - DOM manipulation utilities
- **`shared/AssistentDetailedError.ts`** - Error handling
- **`modules/tahvel/TahvelJournal.ts`** - Journal data fetching methods

## Key Methods

### Triangle Creation

- `TahvelJournalList.addWarningTriangles()` - Main method that creates all triangles
- `TahvelDom.createExclamationMark()` - Creates the visual triangle elements

### Data Analysis

- `AssistentCache.findJournalDiscrepancies()` - Finds differences between journal and timetable
- `AssistentCache.findCurriculumModuleOutcomeDiscrepancies()` - Finds missing grades
- `AssistentCache.findJournalLessonsDifferencesFact()` - Determines triangle conditions

## How to Use in Another Project

1. Copy the relevant files maintaining the folder structure
2. Update import paths to match your project structure
3. Replace the stub files with your actual implementations for:
   - API client
   - Data store/cache
   - DOM utilities
   - Error handling
4. Modify the selectors in `addWarningTriangles()` to match your HTML structure
5. Customize the triangle colors, icons, and messages as needed

## Triangle Conditions

The triangles are shown based on these conditions in the journal data:

- `journal.allLessonsAreMissingFromJournal` → Yellow triangle
- `journal.lessonDiscrepancies` → Grey triangle
- `journal.missingGrades.length > 0 && journal.lastLessonIsInThePast()` → Red triangle
- `journal.isSynchronizedWithKriit === false` → Blue triangle

## Notes

- The TypeScript files may show compilation errors due to missing ES2015+ features in the target configuration
- This is a reference implementation - adapt the code to fit your specific project requirements
- The stub files are simplified versions and should be replaced with proper implementations

## Tahvel API Calls

GET /journals/{journalId} - Basic journal info
GET /journals/{journalId}/journalEntriesByDate - Journal entries by date
GET /journals/{journalId}/journalStudents - Journal students
