/**
 * API Service - Handles communication with external systems
 */

const apiService = {
  /**
   * Base URL for API requests (can be configured)
   */
  baseUrl: 'https://tahvel.edu.ee/hois_back',

  /**
   * Kriit API configuration
   */
  kriit: {
    baseUrl: 'https://kriit.vikk.ee/api',
    authToken: '', // Will be set by user or loaded from storage

    /**
     * Set the Kriit API auth token
     * @param {string} token - The auth token
     */
    setAuthToken (token) {
      this.authToken = token
    },

    /**
     * Get differences between Tahvel and Kriit
     * @param {Array} journalData - Array of journal data
     * @returns {Promise<Array>} - Array of differences
     */
    async getDifferences (journalData) {
      try {
        const url = `${this.baseUrl}/subjects/getDifferences`

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
          },
          body: JSON.stringify(journalData)
        })

        if (!response.ok) {
          throw new Error(`Kriit API Error: ${response.status} ${response.statusText}`)
        }

        const responseData = await response.json()

        if (responseData.status !== 200) {
          throw new Error(`Kriit API Error: ${responseData.status} - ${responseData.message || 'Unknown error'}`)
        }

        return responseData.data || []
      } catch (error) {
        console.error('Kriit API Error:', error)
        throw error
      }
    },

    /**
     * Sync changes from Kriit to Tahvel
     * @param {Array} differences - Array of differences to sync
     * @returns {Promise<Object>} - Sync result
     */
    async syncChanges (differences) {
      try {
        const url = `${this.baseUrl}/subjects/syncChanges`

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
          },
          body: JSON.stringify(differences)
        })

        if (!response.ok) {
          throw new Error(`Kriit API Error: ${response.status} ${response.statusText}`)
        }

        const responseData = await response.json()

        if (responseData.status !== 200) {
          throw new Error(`Kriit API Error: ${responseData.status} - ${responseData.message || 'Unknown error'}`)
        }

        return responseData.data || {}
      } catch (error) {
        console.error('Kriit API Error:', error)
        throw error
      }
    }
  },

  /**
   * Set the base URL for API requests
   * @param {string} url - The base URL for the API
   */
  setBaseUrl (url) {
    this.baseUrl = url
  },

  /**
   * Make a GET request to the specified endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @returns {Promise<any>} Response data
   */
  async get (endpoint, params = {}) {
    try {
      const url = new URL(this.resolveUrl(endpoint))

      // Add query parameters
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('API GET Error:', error)
      throw error
    }
  },

  /**
   * Make a POST request to the specified endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body data
   * @returns {Promise<any>} Response data
   */
  async post (endpoint, data = {}) {
    try {
      const url = this.resolveUrl(endpoint)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      console.error('API POST Error:', error)
      throw error
    }
  },

  /**
   * Resolve a URL, handling both relative and absolute URLs
   * @param {string} endpoint - API endpoint
   * @returns {string} Full URL
   */
  resolveUrl (endpoint) {
    if (endpoint.startsWith('http')) {
      return endpoint
    }
    return `${this.baseUrl}${endpoint}`
  },

  /**
   * Compare grades with external system
   * @param {Array} journalData - Array of journal data with grades
   * @returns {Promise<Array>} - Array of discrepancies
   */
  async compareGrades (journalData) {
    return this.post('/api/compare-grades', { journals: journalData })
  },

  /**
   * Sync assignment with Kriit system
   * @param {Object} assignmentData - Assignment data
   * @returns {Promise<Object>} - Sync result
   */
  async syncAssignmentWithKriit (assignmentData) {
    return this.post('/api/kriit/sync-assignment', assignmentData)
  },
}

export { apiService }
