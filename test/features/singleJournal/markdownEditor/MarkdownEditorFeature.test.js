import { describe, it, expect, beforeEach, jest } from 'bun:test'
import { MarkdownRenderer } from '../../../../src/features/singleJournal/markdownEditor/MarkdownRenderer.js'

describe('MarkdownRenderer', () => {
  let renderer

  beforeEach(() => {
    renderer = new MarkdownRenderer()
  })

  describe('Basic markdown parsing', () => {
    it('should render headers correctly', () => {
      const input = '# Header 1\n## Header 2\n### Header 3'
      const output = renderer.render(input)
      
      expect(output).toContain('<h1>Header 1</h1>')
      expect(output).toContain('<h2>Header 2</h2>')
      expect(output).toContain('<h3>Header 3</h3>')
    })

    it('should render bold and italic text', () => {
      const input = '**bold text** and *italic text* and ***bold italic***'
      const output = renderer.render(input)
      
      expect(output).toContain('<strong>bold text</strong>')
      expect(output).toContain('<em>italic text</em>')
      expect(output).toContain('<strong><em>bold italic</em></strong>')
    })

    it('should render code blocks and inline code', () => {
      const input = '`inline code` and\n\n```\ncode block\n```'
      const output = renderer.render(input)
      
      expect(output).toContain('<code>inline code</code>')
      expect(output).toContain('<pre><code>code block</code></pre>')
    })

    it('should render links correctly', () => {
      const input = '[Link text](https://example.com)'
      const output = renderer.render(input)
      
      expect(output).toContain('<a href="https://example.com">Link text</a>')
    })

    it('should render images correctly', () => {
      const input = '![Alt text](https://example.com/image.jpg)'
      const output = renderer.render(input)
      
      expect(output).toContain('<img src="https://example.com/image.jpg" alt="Alt text">')
    })

    it('should render lists correctly', () => {
      const input = '- Item 1\n- Item 2\n- Item 3'
      const output = renderer.render(input)
      
      expect(output).toContain('<ul>')
      expect(output).toContain('<li>Item 1</li>')
      expect(output).toContain('<li>Item 2</li>')
      expect(output).toContain('<li>Item 3</li>')
      expect(output).toContain('</ul>')
    })

    it('should render ordered lists correctly', () => {
      const input = '1. First item\n2. Second item\n3. Third item'
      const output = renderer.render(input)
      
      expect(output).toContain('<ol>')
      expect(output).toContain('<li>First item</li>')
      expect(output).toContain('<li>Second item</li>')
      expect(output).toContain('<li>Third item</li>')
      expect(output).toContain('</ol>')
    })

    it('should render blockquotes correctly', () => {
      const input = '> This is a blockquote'
      const output = renderer.render(input)
      
      expect(output).toContain('<blockquote>This is a blockquote</blockquote>')
    })

    it('should render horizontal rules correctly', () => {
      const input = '---'
      const output = renderer.render(input)
      
      expect(output).toContain('<hr>')
    })

    it('should render strikethrough text', () => {
      const input = '~~deleted text~~'
      const output = renderer.render(input)
      
      expect(output).toContain('<del>deleted text</del>')
    })
  })

  describe('Paragraphs and line breaks', () => {
    it('should wrap text in paragraphs', () => {
      const input = 'This is a paragraph.'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>This is a paragraph.</p>')
    })

    it('should convert single newlines to line breaks within paragraphs', () => {
      const input = 'Line one\nLine two'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>Line one<br>Line two</p>')
    })

    it('should create separate paragraphs for double newlines', () => {
      const input = 'Paragraph one\n\nParagraph two'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>Paragraph one</p>')
      expect(output).toContain('<p>Paragraph two</p>')
    })

    it('should not wrap block elements in paragraphs', () => {
      const input = '# Header\n\nSome text'
      const output = renderer.render(input)
      
      expect(output).toContain('<h1>Header</h1>')
      expect(output).toContain('<p>Some text</p>')
      expect(output).not.toContain('<p><h1>Header</h1></p>')
    })
  })

  describe('Security and sanitization', () => {
    it('should sanitize script tags', () => {
      const input = 'Hello <script>alert("xss")</script> world'
      const output = renderer.render(input)
      
      expect(output).not.toContain('<script>')
      expect(output).not.toContain('alert("xss")')
      expect(output).toContain('alert("xss")')  // Text content should remain
    })

    it('should sanitize onclick attributes', () => {
      const input = '[Click me](javascript:alert("xss"))'
      const output = renderer.render(input)
      
      expect(output).not.toContain('javascript:')
      expect(output).not.toContain('onclick')
    })

    it('should allow safe URL protocols', () => {
      const safeUrls = [
        'https://example.com',
        'http://example.com',
        'mailto:test@example.com',
        '/relative/path',
        './relative/path'
      ]
      
      safeUrls.forEach(url => {
        const input = `[Link](${url})`
        const output = renderer.render(input)
        expect(output).toContain(`href="${url}"`)
      })
    })

    it('should remove dangerous URL protocols', () => {
      const dangerousUrls = [
        'javascript:alert("xss")',
        'data:text/html,<script>alert("xss")</script>',
        'vbscript:alert("xss")'
      ]
      
      dangerousUrls.forEach(url => {
        const input = `[Link](${url})`
        const output = renderer.render(input)
        expect(output).not.toContain(`href="${url}"`)
      })
    })

    it('should preserve allowed HTML tags', () => {
      const allowedTags = ['strong', 'em', 'code', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'p', 'blockquote', 'pre', 'a', 'img']
      
      allowedTags.forEach(tag => {
        expect(renderer.allowedTags).toContain(tag)
      })
    })

    it('should remove disallowed HTML tags but keep content', () => {
      const input = 'Hello <div>content</div> world'
      const output = renderer.render(input)
      
      expect(output).not.toContain('<div>')
      expect(output).not.toContain('</div>')
      expect(output).toContain('content')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const output = renderer.render('')
      expect(output).toBe('')
    })

    it('should handle null input', () => {
      const output = renderer.render(null)
      expect(output).toBe('')
    })

    it('should handle undefined input', () => {
      const output = renderer.render(undefined)
      expect(output).toBe('')
    })

    it('should handle non-string input', () => {
      const output = renderer.render(123)
      expect(output).toBe('')
    })

    it('should handle mixed line endings', () => {
      const input = 'Line 1\r\nLine 2\rLine 3\nLine 4'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>Line 1<br>Line 2<br>Line 3<br>Line 4</p>')
    })

    it('should handle nested markdown correctly', () => {
      const input = '**Bold with *italic* inside**'
      const output = renderer.render(input)
      
      expect(output).toContain('<strong>Bold with <em>italic</em> inside</strong>')
    })
  })

  describe('Back-compatibility', () => {
    it('should handle plain text without markdown', () => {
      const input = 'This is just plain text with no markdown formatting.'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>This is just plain text with no markdown formatting.</p>')
    })

    it('should preserve existing content formatting', () => {
      const input = 'Line 1\nLine 2\n\nNew paragraph'
      const output = renderer.render(input)
      
      expect(output).toContain('<p>Line 1<br>Line 2</p>')
      expect(output).toContain('<p>New paragraph</p>')
    })
  })
})

describe('MarkdownRenderer Integration', () => {
  let renderer

  beforeEach(() => {
    renderer = new MarkdownRenderer()
  })

  it('should render a complete markdown document', () => {
    const input = `# Assignment Instructions

## Overview
This assignment requires you to:

1. Read the **requirements** carefully
2. Implement the solution
3. Test your code

### Code Example
Here's a simple example:

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
}
\`\`\`

For inline code, use \`console.log()\`.

### Links and Resources
- [JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
- [MDN Web Docs](https://developer.mozilla.org/)

> **Note:** Make sure to test your solution thoroughly.

Good luck! 🚀`

    const output = renderer.render(input)
    
    // Check that major elements are present
    expect(output).toContain('<h1>Assignment Instructions</h1>')
    expect(output).toContain('<h2>Overview</h2>')
    expect(output).toContain('<h3>Code Example</h3>')
    expect(output).toContain('<ol>')
    expect(output).toContain('<li>Read the <strong>requirements</strong> carefully</li>')
    expect(output).toContain('<pre><code>function hello() {')
    expect(output).toContain('<code>console.log()</code>')
    expect(output).toContain('<ul>')
    expect(output).toContain('<a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide">JavaScript Guide</a>')
    expect(output).toContain('<blockquote><strong>Note:</strong> Make sure to test your solution thoroughly.</blockquote>')
    expect(output).toContain('<p>Good luck! 🚀</p>')
  })
})