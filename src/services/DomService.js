/**
 * DOM Service - Utilities for DOM manipulation
 */

const domService = {
  /**
   * Wait for an element to appear in the DOM
   * @param {string} selector - CSS selector for the element
   * @param {number} timeout - Maximum time to wait in ms (default: 10000)
   * @param {number} interval - Check interval in ms (default: 100)
   * @returns {Promise<Element>} The found element
   */
  waitForElement (selector, timeout = 10000, interval = 100) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector)
      if (element) {
        return resolve(element)
      }

      const startTime = Date.now()
      const timer = setInterval(() => {
        const element = document.querySelector(selector)
        if (element) {
          clearInterval(timer)
          resolve(element)
        } else if (Date.now() - startTime >= timeout) {
          clearInterval(timer)
          reject(new Error(`Element not found: ${selector}`))
        }
      }, interval)
    })
  },

  /**
   * Create and insert an element into the DOM
   * @param {string} tag - HTML tag name
   * @param {Object} attributes - Element attributes
   * @param {string|Node} content - Inner content (string or DOM node)
   * @param {Element} parent - Parent element to append to
   * @param {string} position - InsertPosition (beforebegin, afterbegin, beforeend, afterend)
   * @returns {Element} The created element
   */
  createAndInsertElement (tag, attributes = {}, content = '', parent, position = 'beforeend') {
    const element = document.createElement(tag)

    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value)
      } else if (key === 'classList' && Array.isArray(value)) {
        element.classList.add(...value)
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.entries(value).forEach(([dataKey, dataValue]) => {
          element.dataset[dataKey] = dataValue
        })
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.substring(2).toLowerCase()
        element.addEventListener(eventName, value)
      } else {
        element.setAttribute(key, value)
      }
    })

    // Set content
    if (content) {
      if (typeof content === 'string') {
        element.innerHTML = content
      } else if (content instanceof Node) {
        element.appendChild(content)
      }
    }

    // Insert into parent
    if (parent) {
      parent.insertAdjacentElement(position, element)
    }

    return element
  },

  /**
   * Add styles to the page
   * @param {string} css - CSS rules to add
   * @returns {HTMLStyleElement} The created style element
   */
  addStyles (css) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    return style
  },
}

export { domService }
