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
  injectCSS(css, id) {
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
  removeCSS(id) {
    const style = document.getElementById(id)
    if (style) {
      style.remove()
    }
  }
}

export { styleService }
