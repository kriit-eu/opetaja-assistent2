export class MarkdownRenderer {
  constructor() {
    this.allowedTags = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'b', 'em', 'i',
      'ul', 'ol', 'li', 'blockquote',
      'code', 'pre', 'a', 'img',
      'hr', 'del', 'ins', 'mark',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ]
    
    this.allowedAttributes = {
      'a': ['href', 'title', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'code': ['class'],
      'pre': ['class'],
      'th': ['align'],
      'td': ['align']
    }
  }

  render(markdown) {
    if (!markdown || typeof markdown !== 'string') {
      return ''
    }

    let html = this.#parseMarkdown(markdown)
    html = this.#sanitizeHtml(html)
    
    return html
  }

  #parseMarkdown(markdown) {
    // Normalize line endings
    let html = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>')
    html = html.replace(/^\*\*\*$/gm, '<hr>')

    // Code blocks (must be before inline code)
    html = html.replace(/```([^`]*?)```/gs, '<pre><code>$1</code></pre>')

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

    // Bold and italic (must be in this order)
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')

    // Strikethrough
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>')

    // Links
    html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')

    // Lists
    html = this.#parseLists(html)

    // Blockquotes
    html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')

    // Line breaks and paragraphs
    html = this.#parseParagraphs(html)

    return html
  }

  #parseLists(html) {
    const lines = html.split('\n')
    const result = []
    let inList = false
    let listType = null
    let listLevel = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      
      // Check for list items
      const unorderedMatch = line.match(/^(\s*)-\s+(.*)/)
      const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)/)
      
      if (unorderedMatch || orderedMatch) {
        const match = unorderedMatch || orderedMatch
        const indent = match[1].length
        const content = match[2]
        const currentType = unorderedMatch ? 'ul' : 'ol'
        
        if (!inList || currentType !== listType) {
          // Start new list
          if (inList) {
            result.push(`</${listType}>`)
          }
          result.push(`<${currentType}>`)
          inList = true
          listType = currentType
          listLevel = indent
        }
        
        result.push(`<li>${content}</li>`)
      } else {
        // Not a list item
        if (inList) {
          result.push(`</${listType}>`)
          inList = false
          listType = null
        }
        
        if (trimmed !== '') {
          result.push(line)
        }
      }
    }
    
    // Close any remaining list
    if (inList) {
      result.push(`</${listType}>`)
    }
    
    return result.join('\n')
  }

  #parseParagraphs(html) {
    // Split by double newlines to get paragraphs
    const paragraphs = html.split(/\n\s*\n/)
    
    return paragraphs.map(paragraph => {
      const trimmed = paragraph.trim()
      if (!trimmed) return ''
      
      // Don't wrap block elements in paragraphs
      if (this.#isBlockElement(trimmed)) {
        return trimmed
      }
      
      // Convert single newlines to line breaks within paragraphs
      const withBreaks = trimmed.replace(/\n/g, '<br>')
      
      return `<p>${withBreaks}</p>`
    }).filter(p => p !== '').join('\n')
  }

  #isBlockElement(html) {
    const blockTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'table']
    return blockTags.some(tag => html.includes(`<${tag}>`))
  }

  #sanitizeHtml(html) {
    // Create a temporary DOM element for parsing
    const temp = document.createElement('div')
    temp.innerHTML = html
    
    // Recursively sanitize all nodes
    this.#sanitizeNode(temp)
    
    return temp.innerHTML
  }

  #sanitizeNode(node) {
    // Process all child nodes
    const childNodes = Array.from(node.childNodes)
    
    childNodes.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase()
        
        // Check if tag is allowed
        if (!this.allowedTags.includes(tagName)) {
          // Remove disallowed tags but keep content
          const textContent = child.textContent || ''
          const textNode = document.createTextNode(textContent)
          child.parentNode.replaceChild(textNode, child)
          return
        }
        
        // Sanitize attributes
        const attributes = Array.from(child.attributes)
        attributes.forEach(attr => {
          const attrName = attr.name.toLowerCase()
          const allowedAttrs = this.allowedAttributes[tagName] || []
          
          if (!allowedAttrs.includes(attrName)) {
            child.removeAttribute(attr.name)
          } else {
            // Additional sanitization for specific attributes
            const attrValue = attr.value
            
            if (attrName === 'href' || attrName === 'src') {
              // Only allow safe URLs
              if (!this.#isSafeUrl(attrValue)) {
                child.removeAttribute(attr.name)
              }
            }
          }
        })
        
        // Recursively sanitize children
        this.#sanitizeNode(child)
      }
    })
  }

  #isSafeUrl(url) {
    if (!url) return false
    
    // Allow relative URLs
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return true
    }
    
    // Allow safe protocols
    const safeProtocols = ['http:', 'https:', 'mailto:', 'tel:']
    
    try {
      const urlObj = new URL(url)
      return safeProtocols.includes(urlObj.protocol)
    } catch {
      return false
    }
  }
}