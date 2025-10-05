import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { styleService } from '../../src/services/StyleService.js'

describe('StyleService', () => {
  let mockElements = {}
  let mockHead

  beforeEach(() => {
    mockElements = {}
    mockHead = {
      appendChild: mock(element => {
        mockElements[element.id] = element
      })
    }

    global.document = {
      getElementById: mock(id => mockElements[id] || null),
      createElement: mock(tag => ({
        tagName: tag.toUpperCase(),
        id: '',
        textContent: '',
        remove: mock(function () {
          delete mockElements[this.id]
        })
      })),
      head: mockHead
    }
  })

  describe('injectCSS', () => {
    test('should inject CSS into the page', () => {
      const css = '.test { color: red; }'
      const styleElement = styleService.injectCSS(css, 'test-style')

      expect(styleElement.tagName).toBe('STYLE')
      expect(styleElement.id).toBe('test-style')
      expect(styleElement.textContent).toBe(css)
      expect(mockHead.appendChild).toHaveBeenCalled()
    })

    test('should return existing style if already injected', () => {
      const css1 = '.test1 { color: blue; }'
      const css2 = '.test2 { color: green; }'

      const style1 = styleService.injectCSS(css1, 'same-id')
      const style2 = styleService.injectCSS(css2, 'same-id')

      expect(style1).toBe(style2)
      expect(style1.textContent).toBe(css1)
    })

    test('should inject multiple styles with different ids', () => {
      const style1 = styleService.injectCSS('.style1 {}', 'style-1')
      const style2 = styleService.injectCSS('.style2 {}', 'style-2')
      const style3 = styleService.injectCSS('.style3 {}', 'style-3')

      expect(mockElements['style-1']).toBeDefined()
      expect(mockElements['style-2']).toBeDefined()
      expect(mockElements['style-3']).toBeDefined()
    })
  })

  describe('removeCSS', () => {
    test('should remove injected CSS', () => {
      const css = '.remove-test { color: red; }'
      const style = styleService.injectCSS(css, 'remove-test-style')

      expect(mockElements['remove-test-style']).toBeDefined()

      styleService.removeCSS('remove-test-style')

      expect(style.remove).toHaveBeenCalled()
    })

    test('should handle removing non-existent style gracefully', () => {
      expect(() => {
        styleService.removeCSS('non-existent-style')
      }).not.toThrow()
    })

    test('should only remove the specified style', () => {
      const style1 = styleService.injectCSS('.style1 {}', 'keep-style')
      const style2 = styleService.injectCSS('.style2 {}', 'remove-style')

      styleService.removeCSS('remove-style')

      expect(mockElements['keep-style']).toBeDefined()
      expect(style2.remove).toHaveBeenCalled()
    })
  })
})
