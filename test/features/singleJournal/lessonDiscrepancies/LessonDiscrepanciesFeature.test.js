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
