// Test file to check formatting rules
import { test, expect, describe } from 'bun:test'

describe('Formatting Rules', () => {
  test('should handle function calls with multiple arguments', () => {
    // This is a formatting test to ensure code style is consistent
    // Testing that complex function calls are properly formatted
    function testFormatting() {
      // Example of a function call with multiple arguments
      const mockDomService = {
        createAndInsertElement: (tag, options, content, parent) => {
          return { tag, options, content, parent }
        }
      }

      const mockModalHeader = {}

      const result = mockDomService.createAndInsertElement('button', {
        classList: ['ta-modal-close'],
        onclick: () => console.log('close modal'),
      }, '×', mockModalHeader)

      expect(result.tag).toBe('button')
      expect(result.content).toBe('×')
      expect(result.options.classList).toEqual(['ta-modal-close'])

      return result
    }

    const result = testFormatting()
    expect(result).toBeDefined()
  })

  test('should handle element creation and manipulation', () => {
    // Mock document for testing
    const mockElement = {
      classList: { add: () => { } },
      setAttribute: () => { },
      addEventListener: () => { }
    }

    const mockDocument = {
      createElement: () => mockElement
    }

    function createTestElement() {
      const element = mockDocument.createElement('div')
      element.classList.add('test-class')
      element.setAttribute('data-test', 'value')
      element.addEventListener('click', () => {
        console.log('Clicked')
      })

      return element
    }

    const element = createTestElement()
    expect(element).toBe(mockElement)
  })
})
