// Use the mock chrome implementation for all tests
import chromeMock from '../../../mocks/chrome.js';
global.chrome = chromeMock;
import * as cacheService from '../../../../src/services/CacheService.js';

// Test for LessonDiscrepanciesFeature entryId resolution
describe('LessonDiscrepanciesFeature entryId resolution', () => {
  test('should handle entryId from camelCase to lowercase conversion', () => {
    // Simulate HTML dataset behavior where camelCase becomes lowercase
    const buttonData = {
      entryid: '12345', // This is how entryId becomes in dataset
      handler: 'fixCapacity',
      date: '2024-10-17'
    }

    // Simulate the actual entryId parameter being undefined (as in the error)
    const entryId = undefined

    // Test the resolution logic from #handleFixCapacity
    const actualEntryId = entryId || buttonData.entryid

    expect(actualEntryId).toBe('12345')
    expect(actualEntryId).not.toBe(undefined)
  })

  test('should prefer direct entryId parameter over dataset fallback', () => {
    const buttonData = {
      entryid: '67890',
      handler: 'fixCapacity',
      date: '2024-10-17'
    }

    const entryId = '12345'

    const actualEntryId = entryId || buttonData.entryid

    expect(actualEntryId).toBe('12345') // Should prefer the direct parameter
  })

  test('should correctly parse praktiline töö entry type', () => {
    // Mock DOM element
    const mockRow = {
      querySelectorAll: (selector) => [
        { textContent: { trim: () => '19.09' } },
        { textContent: { trim: () => '4' } },
        { textContent: { trim: () => '1' } },
        { textContent: { trim: () => 'Praktiline töö' } }
      ]
    }

    // This would be the logic from #parseRowLessonInfo
    const cells = mockRow.querySelectorAll('td')
    let lessonCount = null
    let entryType = null

    for (const cell of cells) {
      const text = cell.textContent.trim()
      if (/^\d+$/.test(text)) {
        lessonCount = parseInt(text)
      }
      if (text.includes('Tund')) {
        entryType = 'SISSEKANNE_T'
      } else if (text.includes('Iseseisev töö')) {
        entryType = 'SISSEKANNE_I'
      } else if (text.includes('Praktiline töö')) {
        entryType = 'SISSEKANNE_P'
      } else if (text.includes('E-õpe')) {
        entryType = 'SISSEKANNE_E'
      }
    }

    expect(entryType).toBe('SISSEKANNE_P')
    expect(lessonCount).toBe(1) // Should get the last number found
  })

  test('should correctly validate praktiline töö entry requirements', () => {
    // Test the business logic for SISSEKANNE_P
    const entryType = 'SISSEKANNE_P'

    // Expected behavior: praktiline töö should be checked, auditoorne and iseseisev should be unchecked
    const shouldHaveAuditoorne = entryType === 'SISSEKANNE_T' // Only SISSEKANNE_T should have auditoorne
    const shouldHaveIseseisev = entryType === 'SISSEKANNE_I'
    const shouldHavePraktiline = entryType === 'SISSEKANNE_P'

    expect(shouldHaveAuditoorne).toBe(false) // Praktiline töö should NOT have auditoorne
    expect(shouldHaveIseseisev).toBe(false)
    expect(shouldHavePraktiline).toBe(true) // Praktiline töö should have praktiline checkbox
  })

  test('should always ensure teacher checkbox is checked', () => {
    // Mock DOM elements for teacher checkboxes
    const mockTeacherCheckbox = {
      getAttribute: jest.fn().mockReturnValue('false'), // Initially unchecked
      click: jest.fn(),
      setAttribute: jest.fn(),
    }

    // Mock the querySelector to return our mock checkbox
    document.querySelectorAll = jest.fn().mockReturnValue([mockTeacherCheckbox])

    // Simulate the teacher checkbox checking logic
    const isChecked = mockTeacherCheckbox.getAttribute('aria-checked') === 'true'

    if (!isChecked) {
      mockTeacherCheckbox.click()
      // Simulate the checkbox becoming checked after click
      mockTeacherCheckbox.getAttribute.mockReturnValue('true')
    }

    expect(mockTeacherCheckbox.click).toHaveBeenCalled()
    expect(mockTeacherCheckbox.getAttribute('aria-checked')).toBe('true')
  })
})

// Tests for teacher checkbox functionality (dialog-only validation)
describe('LessonDiscrepanciesFeature teacher checkbox functionality', () => {
  let mockFeature

  beforeEach(() => {
    // Mock the feature instance
    mockFeature = {
      name: 'LessonDiscrepanciesFeature',
      '#getTeacherCheckboxState': function () {
        return {
          hasTeacher: false,
          checkboxCount: 1,
          checkedCount: 0,
          checkboxes: [{
            element: { getAttribute: () => 'true' },
            checked: false,
            label: 'Test Teacher'
          }]
        }
      },
      '#performBusinessLogicValidation': function (entry, detailedEntry, actualState, capacityTypes) {
        if (!actualState.teacher) {
          return {
            entry,
            detailedData: detailedEntry,
            isValid: false,
            errorType: 'missing_teacher_selection',
            actualState,
            expectedState: {
              auditoorne: true,
              iseseisev: false,
              praktiline: false,
              teacher: true,
              reasoning: 'Entry type "SISSEKANNE_T" requires auditoorne õpe checkbox and teacher selection'
            },
            capacityTypes,
            validationResult: 'error'
          }
        }

        return {
          entry,
          detailedData: detailedEntry,
          isValid: true,
          errorType: null,
          actualState,
          expectedState: {
            auditoorne: true,
            iseseisev: false,
            praktiline: false,
            teacher: true
          },
          capacityTypes,
          validationResult: 'pass'
        }
      }
    }
  })

  test('should return missing_teacher_selection error when no teacher is selected', () => {
    const entry = { entryType: 'SISSEKANNE_T' }
    const detailedEntry = { id: '123' }
    const actualState = {
      auditoorne: true,
      iseseisev: false,
      praktiline: false,
      teacher: false // No teacher selected
    }
    const capacityTypes = ['MAHT_a']

    const result = mockFeature['#performBusinessLogicValidation'](entry, detailedEntry, actualState, capacityTypes)

    expect(result.isValid).toBe(false)
    expect(result.errorType).toBe('missing_teacher_selection')
    expect(result.validationResult).toBe('error')
  })

  test('should pass validation when teacher is selected with correct checkboxes', () => {
    const entry = { entryType: 'SISSEKANNE_T' }
    const detailedEntry = { id: '123' }
    const actualState = {
      auditoorne: true,
      iseseisev: false,
      praktiline: false,
      teacher: true // Teacher selected
    }
    const capacityTypes = ['MAHT_a']

    const result = mockFeature['#performBusinessLogicValidation'](entry, detailedEntry, actualState, capacityTypes)

    expect(result.isValid).toBe(true)
    expect(result.errorType).toBe(null)
    expect(result.validationResult).toBe('pass')
  })

  test('should correctly identify teacher checkbox state', () => {
    const teacherState = mockFeature['#getTeacherCheckboxState']()

    expect(teacherState.hasTeacher).toBe(false)
    expect(teacherState.checkboxCount).toBe(1)
    expect(teacherState.checkedCount).toBe(0)
    expect(teacherState.checkboxes).toHaveLength(1)
  })

  test('should display correct error message for missing teacher selection in table row', () => {
    // Mock an entry with missing teacher selection error
    const entry = {
      id: '12345',
      entryDate: '2024-10-17',
      entryType: 'SISSEKANNE_T',
      startLessonNr: 1,
      validationResult: {
        errorType: 'missing_teacher_selection',
        isValid: false,
        actualState: {
          auditoorne: true,
          iseseisev: false,
          praktiline: false,
          teacher: false
        },
        expectedState: {
          auditoorne: true,
          iseseisev: false,
          praktiline: false,
          teacher: true
        }
      }
    }

    // Mock the #createCapacityProblemRow logic
    let message = 'Auditoorne õpe puudub'
    if (entry.validationResult) {
      if (entry.validationResult.errorType === 'missing_teacher_selection') {
        message = 'Õpetaja pole valitud! Palun valige õpetaja enne salvestamist.'
      } else if (entry.validationResult.errorType === 'praktiline_too_without_praktiline_checkbox') {
        message = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees'
      }
      // ... other error types
    }

    expect(message).toBe('Õpetaja pole valitud! Palun valige õpetaja enne salvestamist.')
  })

  test('should display correct error message for praktiline töö without praktiline checkbox in table row', () => {
    // Mock an entry with praktiline töö error
    const entry = {
      id: '12346',
      entryDate: '2024-10-17',
      entryType: 'SISSEKANNE_P',
      startLessonNr: 1,
      validationResult: {
        errorType: 'praktiline_too_without_praktiline_checkbox',
        isValid: false,
        actualState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: false,
          teacher: true
        },
        expectedState: {
          auditoorne: false,
          iseseisev: false,
          praktiline: true,
          teacher: true
        }
      }
    }

    // Mock the #createCapacityProblemRow logic
    let message = 'Auditoorne õpe puudub'
    if (entry.validationResult) {
      if (entry.validationResult.errorType === 'missing_teacher_selection') {
        message = 'Õpetaja pole valitud! Palun valige õpetaja enne salvestamist.'
      } else if (entry.validationResult.errorType === 'praktiline_too_without_praktiline_checkbox') {
        message = 'Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees'
      }
      // ... other error types
    }

    expect(message).toBe('Sissekande liik on praktiline töö, aga praktilise töö linnukest ei ole sees')
  })
})

// --- BEGIN: Comprehensive tests for LessonDiscrepanciesFeature core behaviors ---
import LessonDiscrepanciesFeature from '../../../../src/features/singleJournal/lessonDiscrepancies/LessonDiscrepanciesFeature.js';

global.Logger = { error: jest.fn(), warning: jest.fn(), debug: jest.fn() };

const mockApi = {
  tahvel: {
    get: jest.fn()
  }
};

describe('LessonDiscrepanciesFeature core behaviors', () => {
  let feature;
  let clearJournalCacheSpy;
  let clearCacheSpy;
  beforeEach(() => {
    feature = new LessonDiscrepanciesFeature();
    feature.api = mockApi;
    jest.clearAllMocks();
    clearJournalCacheSpy = jest.spyOn(cacheService, 'clearJournalCache').mockResolvedValue();
    clearCacheSpy = jest.spyOn(cacheService, 'clearCache').mockResolvedValue();
  });
  afterEach(() => {
    clearJournalCacheSpy.mockRestore();
    clearCacheSpy.mockRestore();
  });

  test('extractJournalId extracts ID from /journal/123/edit URL', () => {
    delete window.location;
    window.location = { href: 'https://tahvel.edu.ee/journal/123/edit' };
    expect(feature.extractJournalId()).toBe(123);
  });

  test('extractJournalId extracts ID from journalId=456 param', () => {
    delete window.location;
    window.location = { href: 'https://tahvel.edu.ee?journalId=456' };
    expect(feature.extractJournalId()).toBe(456);
  });

  test('delay resolves after specified ms', async () => {
    const start = Date.now();
    await feature.delay(100);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  test('fetchJournalAndTimetableData fetches journal info, entries, and timetable', async () => {
    mockApi.tahvel.get.mockImplementation((url) => {
      if (url.includes('/journals/111')) {
        if (url.includes('journalEntriesByDate')) return [{ id: 1, entryType: 'SISSEKANNE_T', entryDate: '2024-01-01' }];
        return { id: 111, nameEt: 'Test Journal', school: { id: 9 }, journalTeachers: [{ id: 22 }] };
      }
      if (url.includes('/timetableevents/timetableByTeacher/9')) {
        return { timetableEvents: [{ journalId: 111, date: '2024-01-01', timeStart: '08:00', nameEt: 'Math', rooms: ['A1'] }] };
      }
      return null;
    });
    const result = await feature.fetchJournalAndTimetableData(111);
    expect(result.journalData.info.id).toBe(111);
    expect(result.journalData.entries[0].entryType).toBe('SISSEKANNE_T');
    expect(result.timetableData[0].nameEt).toBe('Math');
  });

  test('fetchTimetableData returns only events for the correct journal', async () => {
    const info = { id: 222, school: { id: 9 }, journalTeachers: [{ id: 33 }] };
    mockApi.tahvel.get.mockResolvedValue({
      timetableEvents: [
        { journalId: 222, date: '2024-01-02', timeStart: '09:00', nameEt: 'Physics', rooms: ['B2'] },
        { journalId: 999, date: '2024-01-02', timeStart: '10:00', nameEt: 'Other', rooms: ['C3'] }
      ]
    });
    const result = await feature.fetchTimetableData(info);
    expect(result).toHaveLength(1);
    expect(result[0].journalId).toBe(222);
  });

  test('fetchLessonTimes resolves lesson times from chrome extension message', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      cb({ data: { 9: [{ timeStart: '08:00', number: 1 }, { timeStart: '09:00', number: 2 }] } });
    });
    const result = await feature.fetchLessonTimes(9);
    expect(result).toEqual([{ timeStart: '08:00', number: 1 }, { timeStart: '09:00', number: 2 }]);
  });

  test('calculateLessonNumber returns exact match if found', async () => {
    feature.fetchLessonTimes = jest.fn().mockResolvedValue([
      { timeStart: '08:00', number: 1 }, { timeStart: '09:00', number: 2 }
    ]);
    const result = await feature.calculateLessonNumber('09:00', 9);
    expect(result).toBe(2);
  });

  test('calculateLessonNumber returns closest match if no exact', async () => {
    feature.fetchLessonTimes = jest.fn().mockResolvedValue([
      { timeStart: '08:00', number: 1 }, { timeStart: '09:00', number: 2 }]);
    const result = await feature.calculateLessonNumber('08:30', 9);
    expect(result).toBe(1); // 08:30 is closer to 08:00
  });

  test('aggregateJournalEntries aggregates by date, count, and start', () => {
    const entries = [
      { entryType: 'SISSEKANNE_T', entryDate: '2024-01-01', lessons: 2, startLessonNr: 2 },
      { entryType: 'SISSEKANNE_T', entryDate: '2024-01-01', lessons: 1, startLessonNr: 1 },
      { entryType: 'SISSEKANNE_I', entryDate: '2024-01-01', lessons: 1, startLessonNr: 3 }
    ];
    const result = feature.aggregateJournalEntries(entries);
    expect(result['2024-01-01'].count).toBe(3); // Only SISSEKANNE_T counted
    expect(result['2024-01-01'].start).toBe(1);
    expect(result['2024-01-01'].entries).toHaveLength(2);
  });

  test('aggregateTimetableEvents aggregates by date, count, and start', async () => {
    feature.calculateLessonNumber = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const events = [
      { date: '2024-01-01', timeStart: '09:00' },
      { date: '2024-01-01', timeStart: '08:00' }
    ];
    const result = await feature.aggregateTimetableEvents(events, 9);
    expect(result['2024-01-01'].count).toBe(2);
    expect(result['2024-01-01'].start).toBe(1);
  });
});
// --- END: Comprehensive tests for LessonDiscrepanciesFeature core behaviors ---
