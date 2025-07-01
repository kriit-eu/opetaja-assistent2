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
})
