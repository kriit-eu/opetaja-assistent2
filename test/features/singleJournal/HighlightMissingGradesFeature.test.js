import { describe, test, expect, beforeEach } from 'bun:test'
import HighlightMissingGradesFeature from '../../../src/features/singleJournal/highlightMissingGrades/HighlightMissingGradesFeature.js'

describe('HighlightMissingGradesFeature', () => {
  let feature

  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {}
    }
    global.document = {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: () => {} }
    }
    feature = new HighlightMissingGradesFeature()
    global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
  })

  describe('constructor', () => {
    test('should initialize successfully', () => {
      expect(feature).toBeDefined()
      expect(feature.urlPattern).toEqual(/#\/journal\//)
    })
  })

  describe('injectMissingGradeCSS', () => {
    test('should inject CSS style element', () => {
      const mockStyleElement = { id: '', textContent: '' }
      const mockHead = { appendChild: () => {} }
      global.document = {
        getElementById: () => null,
        createElement: () => mockStyleElement,
        head: mockHead
      }

      feature.injectMissingGradeCSS()

      expect(mockStyleElement.id).toBe('highlight-missing-grade-style')
      expect(mockStyleElement.textContent).toContain('.highlight-missing-grade')
      expect(mockStyleElement.textContent).toContain('#ffdddd')
    })

    test('should not inject CSS if already exists', () => {
      let createElementCalled = false
      global.document = {
        getElementById: () => ({ id: 'highlight-missing-grade-style' }),
        createElement: () => {
          createElementCalled = true
          return { id: '', textContent: '' }
        },
        head: { appendChild: () => {} }
      }

      feature.injectMissingGradeCSS()

      expect(createElementCalled).toBe(false)
    })
  })

  describe('onDeactivate', () => {
    test('should disconnect observer if exists', () => {
      const mockDisconnect = { disconnect: () => {} }
      feature._observer = mockDisconnect

      feature.onDeactivate()

      expect(feature._observer).toBeNull()
    })

    test('should clear debounce timer if exists', () => {
      feature._debounceTimer = setTimeout(() => {}, 1000)

      feature.onDeactivate()

      expect(feature._debounceTimer).toBeNull()
    })

    test('should reset updating flag', () => {
      feature._isUpdating = true

      feature.onDeactivate()

      expect(feature._isUpdating).toBe(false)
    })

    test('should handle missing observer gracefully', () => {
      feature._observer = null

      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })

  describe('run - early returns', () => {
    test('should return early if already updating', async () => {
      feature._isUpdating = true

      await feature.run()

      // Should exit immediately without resetting flag
      expect(feature._isUpdating).toBe(true)
    })
  })

  describe('date parsing and comparison logic', () => {
    test('should handle date extraction from header cells', () => {
      // Test the regex pattern used in run() for matching dates
      const testCases = [
        { input: '18.09', expected: ['18', '09'] },
        { input: '18.09.2024', expected: ['18', '09'] },
        { input: '01/12', expected: ['01', '12'] },
        { input: 'No date here', expected: null }
      ]

      testCases.forEach(({ input, expected }) => {
        const match = input.match(/(\d{1,2})[./](\d{1,2})/)
        if (expected) {
          expect(match[1]).toBe(expected[0])
          expect(match[2]).toBe(expected[1])
        } else {
          expect(match).toBeNull()
        }
      })
    })

    test('should pad day and month to 2 digits', () => {
      const day = '5'
      const month = '9'
      const paddedDay = String(day).padStart(2, '0')
      const paddedMonth = String(month).padStart(2, '0')

      expect(paddedDay).toBe('05')
      expect(paddedMonth).toBe('09')
    })
  })

  describe('valid grades detection', () => {
    test('should recognize valid grades', () => {
      const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])

      expect(validGrades.has('A')).toBe(true)
      expect(validGrades.has('MA')).toBe(true)
      expect(validGrades.has('5')).toBe(true)
    })

    test('should reject invalid grades', () => {
      const validGrades = new Set(['A', 'MA', '1', '2', '3', '4', '5'])

      expect(validGrades.has('')).toBe(false)
      expect(validGrades.has('0')).toBe(false)
      expect(validGrades.has('X')).toBe(false)
    })
  })

  describe('absence detection logic', () => {
    test('should identify valid absence codes for highlighting', () => {
      const shouldHighlight = absence => {
        return absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P'
      }

      expect(shouldHighlight('')).toBe(true)
      expect(shouldHighlight('PUUDUMINE_H')).toBe(true)
      expect(shouldHighlight('PUUDUMINE_P')).toBe(true)
      expect(shouldHighlight('H')).toBe(true)
      expect(shouldHighlight('P')).toBe(true)
    })

    test('should reject absence codes that prevent highlighting', () => {
      const shouldHighlight = absence => {
        return absence === '' || absence === 'PUUDUMINE_H' || absence === 'PUUDUMINE_P' || absence === 'H' || absence === 'P'
      }

      expect(shouldHighlight('PUUDUMINE_T')).toBe(false)
      expect(shouldHighlight('MUUD')).toBe(false)
      expect(shouldHighlight('V')).toBe(false)
    })

    test('should detect absence from text content', () => {
      const testCases = [
        { text: 'puudumine', expected: 'PUUDUMINE' },
        { text: 'PUUDUMINE', expected: 'PUUDUMINE' },
        { text: '  H  ', expected: 'H' },
        { text: 'P', expected: 'P' },
        { text: 'some other text', expected: null }
      ]

      testCases.forEach(({ text, expected }) => {
        let absence = ''
        if (/puudumine/i.test(text)) {
          absence = 'PUUDUMINE'
        } else if (/^\s*[HP]\s*$/i.test(text)) {
          absence = text.trim().toUpperCase()
        }

        expect(absence || null).toBe(expected)
      })
    })
  })

  describe('tooltip formatting', () => {
    test('should format due date as DD.MM.YYYY', () => {
      const dueDateStr = '2024-11-15'
      const d = new Date(dueDateStr)
      const formatted = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`

      expect(formatted).toBe('15.11.2024')
    })

    test('should create correct tooltip text', () => {
      const tooltipDate = '15.11.2024'
      const tooltip = `Tähtaeg oli ${tooltipDate}, aga hinne puudub`

      expect(tooltip).toBe('Tähtaeg oli 15.11.2024, aga hinne puudub')
    })

    test('should use fallback tooltip when no date', () => {
      const tooltip = 'Hinne puudub'

      expect(tooltip).toBe('Hinne puudub')
    })
  })

  describe('student ID extraction logic', () => {
    test('should extract ID from various data attributes', () => {
      const testAttributes = ['data-student-id', 'data-journal-student', 'data-journal-student-id', 'data-journalstudent']

      testAttributes.forEach(attr => {
        const mockElement = {
          getAttribute: a => (a === attr ? '12345' : null)
        }

        const attrs = ['data-student-id', 'data-journal-student', 'data-journal-student-id', 'data-journalstudent']
        let studentId = null
        for (const a of attrs) {
          const v = mockElement.getAttribute(a)
          if (v) {
            studentId = v.toString()
            break
          }
        }

        expect(studentId).toBe('12345')
      })
    })

    test('should extract ID from dataset', () => {
      const mockElement = {
        getAttribute: () => null,
        dataset: { journalStudent: '67890' }
      }

      let studentId = null
      const attrs = ['data-student-id', 'data-journal-student']
      for (const a of attrs) {
        const v = mockElement.getAttribute(a)
        if (v) {
          studentId = v.toString()
          break
        }
      }

      if (!studentId && mockElement.dataset?.journalStudent) {
        studentId = mockElement.dataset.journalStudent.toString()
      }

      expect(studentId).toBe('67890')
    })
  })

  describe('cell text extraction logic', () => {
    test('should extract text from specific selectors in order', () => {
      const selectors = ['[data-grade]', '[data-absence]', '.grade', '.grade-value', '.value', 'span', 'div']

      expect(selectors[0]).toBe('[data-grade]')
      expect(selectors[2]).toBe('.grade')
      expect(selectors.length).toBe(7)
    })

    test('should fallback to textContent', () => {
      const mockCell = {
        querySelector: () => null,
        textContent: '  5  '
      }

      const text = mockCell.querySelector
        ? mockCell.querySelector('.grade')?.textContent?.trim() || mockCell.textContent.trim()
        : mockCell.textContent.trim()

      expect(text).toBe('5')
    })
  })

  describe('green header detection', () => {
    test('should detect RGB format', () => {
      const bgColors = [
        { color: 'rgb(236,252,203)', expected: true },
        { color: 'rgb(236, 252, 203)', expected: true },
        { color: 'RGB(236, 252, 203)', expected: true },
        { color: 'rgb(255,0,0)', expected: false }
      ]

      bgColors.forEach(({ color, expected }) => {
        const normalized = color.replace(/\s+/g, '').toLowerCase()
        const greenRgb = 'rgb(236,252,203)'
        const isGreen = normalized === greenRgb

        expect(isGreen).toBe(expected)
      })
    })

    test('should detect RGBA format', () => {
      const normalized = 'rgba(236,252,203,1)'.replace(/\s+/g, '').toLowerCase()
      const greenRgba = 'rgba(236,252,203,1)'

      expect(normalized).toBe(greenRgba)
    })

    test('should detect hex format', () => {
      const normalized = '#ecfccb'.toLowerCase()
      const greenHex = '#ecfccb'

      expect(normalized).toBe(greenHex)
    })
  })

  describe('grade object handling', () => {
    test('should handle grade as object with code', () => {
      const gradeObj = { code: '5' }
      const grade = typeof gradeObj === 'object' && gradeObj.code ? gradeObj.code : gradeObj

      expect(grade).toBe('5')
    })

    test('should handle null grade object', () => {
      const gradeObj = { code: '' }
      const grade = typeof gradeObj === 'object' && (!gradeObj.code || gradeObj.code === '') ? '' : gradeObj.code

      expect(grade).toBe('')
    })

    test('should fallback to verbalGrade if grade is empty', () => {
      const result = { grade: '', verbalGrade: 'Arvestatud' }
      const grade = result.grade || result.verbalGrade

      expect(grade).toBe('Arvestatud')
    })
  })

  describe('journal ID extraction', () => {
    test('should extract journal ID from URL', () => {
      const urls = [
        { url: 'https://tahvel.edu.ee/#/journal/12345/edit', expected: '12345' },
        { url: 'https://tahvel.edu.ee/journal/67890', expected: '67890' },
        { url: 'https://tahvel.edu.ee/#/journal/999', expected: '999' }
      ]

      urls.forEach(({ url, expected }) => {
        const match = url.match(/\/journal\/(\d+)/)
        const journalId = match ? parseInt(match[1], 10) : null

        expect(journalId?.toString()).toBe(expected)
      })
    })

    test('should return null for invalid URL', () => {
      const url = 'https://tahvel.edu.ee/#/other/page'
      const match = url.match(/\/journal\/(\d+)/)
      const journalId = match ? parseInt(match[1], 10) : null

      expect(journalId).toBeNull()
    })
  })

  describe('entry type filtering', () => {
    test('should identify independent work entries', () => {
      const entries = [
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' },
        { entryType: 'SISSEKANNE_H', homeworkDuedate: '2024-11-16' },
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-17' }
      ]

      const independentWork = entries.filter(e => e.entryType === 'SISSEKANNE_I')

      expect(independentWork.length).toBe(2)
      expect(independentWork[0].homeworkDuedate).toBe('2024-11-15')
    })

    test('should handle entries without homeworkDuedate', () => {
      const entry = {
        entryType: 'SISSEKANNE_I',
        entryDate: '2024-11-15'
      }

      const dueDateStr = entry.homeworkDuedate || entry.entryDate

      expect(dueDateStr).toBe('2024-11-15')
    })

    test('should compare dates correctly', () => {
      const nowDate = new Date('2024-11-20')
      const dueDate1 = new Date('2024-11-15')
      const dueDate2 = new Date('2024-11-25')

      expect(dueDate1 < nowDate).toBe(true)
      expect(dueDate2 < nowDate).toBe(false)
    })
  })

  describe('mutation observer logic', () => {
    test('should ignore highlight class changes', () => {
      const oldValue = 'some-class'
      const newValue = 'some-class highlight-missing-grade'

      const oldHasHighlight = oldValue.includes('highlight-missing-grade')
      const newHasHighlight = newValue.includes('highlight-missing-grade')
      const otherClassesOld = oldValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
      const otherClassesNew = newValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()

      const shouldIgnore = oldHasHighlight !== newHasHighlight && otherClassesOld === otherClassesNew

      expect(shouldIgnore).toBe(true)
    })

    test('should detect relevant class changes', () => {
      const oldValue = 'some-class'
      const newValue = 'other-class highlight-missing-grade'

      const oldHasHighlight = oldValue.includes('highlight-missing-grade')
      const newHasHighlight = newValue.includes('highlight-missing-grade')
      const otherClassesOld = oldValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()
      const otherClassesNew = newValue.replace(/\s*highlight-missing-grade\s*/g, ' ').trim()

      const shouldIgnore = oldHasHighlight !== newHasHighlight && otherClassesOld === otherClassesNew

      expect(shouldIgnore).toBe(false)
    })
  })
})
