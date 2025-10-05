import { describe, test, expect, beforeEach } from 'bun:test'
import {
  OA_FINAL_GRADE_STYLE_ID,
  injectFinalGradeCSS,
  injectOaFinalGradeCSS,
  markMismatch,
  clearMismatch
} from '../../../src/features/singleJournal/addFinalGrades/FinalGradeHighlighter.js'

describe('FinalGradeHighlighter', () => {
  beforeEach(() => {
    global.document = {
      getElementById: () => null,
      createElement: () => ({
        id: '',
        textContent: ''
      }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} }
    }
  })

  describe('constants', () => {
    test('should export OA_FINAL_GRADE_STYLE_ID', () => {
      expect(OA_FINAL_GRADE_STYLE_ID).toBe('oa-final-grade-style')
    })
  })

  describe('injectFinalGradeCSS', () => {
    test('should create and inject style element', () => {
      const mockStyle = { id: '', textContent: '' }
      const mockHead = { appendChild: () => {} }
      global.document = {
        getElementById: () => null,
        createElement: () => mockStyle,
        head: mockHead,
        body: { appendChild: () => {} }
      }

      injectFinalGradeCSS()

      expect(mockStyle.id).toBe('oa-final-grade-style')
      expect(mockStyle.textContent).toContain('.oa-final-grade-red')
      expect(mockStyle.textContent).toContain('#ff5252')
    })

    test('should not inject if style already exists', () => {
      let createElementCalled = false
      global.document = {
        getElementById: id => (id === 'oa-final-grade-style' ? { id } : null),
        createElement: () => {
          createElementCalled = true
          return { id: '', textContent: '' }
        },
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      injectFinalGradeCSS()

      expect(createElementCalled).toBe(false)
    })

    test('should fallback to body if head append fails', () => {
      let appendedToBody = false
      const mockStyle = { id: '', textContent: '' }
      global.document = {
        getElementById: () => null,
        createElement: () => mockStyle,
        head: {
          appendChild: () => {
            throw new Error('Head append failed')
          }
        },
        body: {
          appendChild: () => {
            appendedToBody = true
          }
        }
      }

      injectFinalGradeCSS()

      expect(appendedToBody).toBe(true)
    })
  })

  describe('injectOaFinalGradeCSS', () => {
    test('should call injectFinalGradeCSS as alias', () => {
      const mockStyle = { id: '', textContent: '' }
      global.document = {
        getElementById: () => null,
        createElement: () => mockStyle,
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      injectOaFinalGradeCSS()

      expect(mockStyle.id).toBe('oa-final-grade-style')
    })
  })

  describe('markMismatch', () => {
    test('should add red border class to cell', () => {
      const cell = {
        classList: {
          contains: () => false,
          add: className => {
            cell.classList[className] = true
          }
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, '5', '4')

      expect(cell.classList['oa-final-grade-red']).toBe(true)
    })

    test('should set tooltip with current and calculated grades', () => {
      const cell = {
        classList: {
          contains: () => false,
          add: () => {}
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, '5', '4')

      expect(cell.title).toContain('Praegune: 5')
      expect(cell.title).toContain('Arvutatud: 4')
    })

    test('should not mark when current grade is empty', () => {
      const cell = {
        classList: {
          contains: () => false,
          add: className => {
            cell.classList[className] = true
          }
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, '', '4')

      expect(cell.classList['oa-final-grade-red']).toBeUndefined()
      expect(cell.title).toContain('Arvutatud hinne: 4')
    })

    test('should not mark when current grade is null', () => {
      const cell = {
        classList: {
          contains: () => false,
          add: className => {
            cell.classList[className] = true
          }
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, null, '4')

      expect(cell.classList['oa-final-grade-red']).toBeUndefined()
    })

    test('should mark when current grade is 0', () => {
      const cell = {
        classList: {
          contains: () => false,
          add: className => {
            cell.classList[className] = true
          }
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, 0, '4')

      expect(cell.classList['oa-final-grade-red']).toBe(true)
    })

    test('should not mark cells with highlight-missing-grade class', () => {
      const cell = {
        classList: {
          contains: className => className === 'highlight-missing-grade',
          add: className => {
            cell.classList[className] = true
          }
        },
        title: ''
      }
      global.document = {
        getElementById: () => ({ id: 'oa-final-grade-style' }),
        createElement: () => ({ id: '', textContent: '' }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      markMismatch(cell, '5', '4')

      expect(cell.classList['oa-final-grade-red']).toBeUndefined()
    })

    test('should handle errors gracefully', () => {
      const cell = null

      expect(() => markMismatch(cell, '5', '4')).not.toThrow()
    })

    test('should inject CSS before marking', () => {
      let cssInjected = false
      const mockStyle = { id: '', textContent: '' }
      global.document = {
        getElementById: () => null,
        createElement: () => {
          cssInjected = true
          return mockStyle
        },
        head: { appendChild: () => {} },
        body: { appendChild: () => {} }
      }

      const cell = {
        classList: {
          contains: () => false,
          add: () => {}
        },
        title: ''
      }

      markMismatch(cell, '5', '4')

      expect(cssInjected).toBe(true)
    })
  })

  describe('clearMismatch', () => {
    test('should remove red border class', () => {
      const cell = {
        classList: {
          remove: className => {
            cell.classList[className] = false
          },
          'oa-final-grade-red': true
        },
        title: 'Some tooltip'
      }

      clearMismatch(cell)

      expect(cell.classList['oa-final-grade-red']).toBe(false)
    })

    test('should clear tooltip', () => {
      const cell = {
        classList: {
          remove: () => {}
        },
        title: 'Some tooltip'
      }

      clearMismatch(cell)

      expect(cell.title).toBe('')
    })

    test('should handle null cell gracefully', () => {
      expect(() => clearMismatch(null)).not.toThrow()
    })

    test('should handle cell without classList gracefully', () => {
      const cell = { title: 'Some tooltip' }

      expect(() => clearMismatch(cell)).not.toThrow()
    })

    test('should handle title set error gracefully', () => {
      const cell = {
        classList: { remove: () => {} },
        get title() {
          return 'tooltip'
        },
        set title(val) {
          throw new Error('Cannot set')
        }
      }

      expect(() => clearMismatch(cell)).not.toThrow()
    })
  })
})
