/**
 * Navigation Service - Detects URL changes in the SPA
 */

const navigationService = {
  // Current URL
  currentUrl: '',

  // Callbacks to notify on navigation
  listeners: [],

  // Initialize the service
  init() {
    this.currentUrl = window.location.href
    this.setupUrlObserver()
  },

  // Register a callback to be notified of navigation events
  onNavigate(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback)
    }
  },

  // Set up an observer to detect URL changes in the SPA
  setupUrlObserver() {
    // Create a MutationObserver to watch for URL changes
    const observer = new MutationObserver(() => {
      // Check if URL has changed
      if (window.location.href !== this.currentUrl) {
        const previousUrl = this.currentUrl
        this.currentUrl = window.location.href

        // Notify all listeners of the URL change
        this.notifyListeners(this.currentUrl, previousUrl)
      }
    })

    // Start observing the document for changes
    observer.observe(document, {
      childList: true,
      subtree: true
    })
  },

  // Notify all listeners of a navigation event
  notifyListeners(newUrl, previousUrl) {
    this.listeners.forEach(callback => {
      try {
        callback(newUrl, previousUrl)
      } catch (error) {
        console.error('Error in navigation listener:', error)
      }
    })
  }
}

export { navigationService }
