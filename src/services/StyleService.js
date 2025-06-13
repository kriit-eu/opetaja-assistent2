/**
 * Style Service - Handles CSS injection for features
 */

const styleService = {
  /**
   * Inject CSS into the page
   * @param {string} css - CSS content to inject
   * @param {string} id - Unique identifier for the style element
   * @returns {HTMLStyleElement} The created style element
   */
  injectCSS (css, id) {
    // Check if style already exists
    const existingStyle = document.getElementById(id)
    if (existingStyle) {
      return existingStyle
    }

    // Create new style element
    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.appendChild(style)

    return style
  },

  /**
   * Remove injected CSS
   * @param {string} id - Identifier of the style to remove
   */
  removeCSS (id) {
    const style = document.getElementById(id)
    if (style) {
      style.remove()
    }
  },

  /**
   * Load CSS from a URL and inject it
   * @param {string} url - URL of the CSS file
   * @param {string} id - Unique identifier for the style element
   * @returns {Promise<HTMLStyleElement>} The created style element
   */
  async loadAndInjectCSS (url, id) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to load CSS: ${response.status} ${response.statusText}`)
      }

      const css = await response.text()
      return this.injectCSS(css, id)
    } catch (error) {
      console.error('Error loading CSS:', error)
      throw error
    }
  },
}

export { styleService }
