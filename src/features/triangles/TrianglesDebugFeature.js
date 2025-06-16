/**
 * Triangles Debug Feature - Fetches data from Tahvel API endpoints and logs to console
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'
import { ApiService } from '../../services/ApiService.js'

/**
 * TrianglesDebugFeature class for debugging Tahvel API data
 */
export default class TrianglesDebugFeature extends BaseFeature {
    constructor() {
        // Match journal-related pages
        super('trianglesDebug', /\/journals|\/journal\//, [])

        this.name = 'TrianglesDebugFeature'

        // Initialize Tahvel API service
        this.api = {
            tahvel: new ApiService({
                name: 'tahvel',
                baseUrl: 'https://test.tahvel.eenet.ee/hois_back',
                defaultHeaders: {}
            })
        }
    }

    /**
     * Initialize the feature when activated
     */
    async activate() {
        Logger.info(`[${this.name}] Activating triangles debug feature`)

        // Wait a bit for page to load
        setTimeout(() => {
            this.debugJournalData()
        }, 2000)
    }

    /**
     * Extract journal ID from current page or find journal IDs on page
     */
    extractJournalIds() {
        const journalIds = []

        // Try to get journal ID from URL (single journal page)
        const urlMatch = window.location.pathname.match(/\/journal\/(\d+)/)
        if (urlMatch) {
            journalIds.push(parseInt(urlMatch[1]))
        }

        // Try to find journal IDs from journal list page
        const journalLinks = document.querySelectorAll('a[href*="/journal/"]')
        journalLinks.forEach(link => {
            const href = link.getAttribute('href')
            const match = href.match(/\/journal\/(\d+)/)
            if (match) {
                const id = parseInt(match[1])
                if (!journalIds.includes(id)) {
                    journalIds.push(id)
                }
            }
        })

        // If no journals found, try alternative selectors
        if (journalIds.length === 0) {
            const altLinks = document.querySelectorAll('a[href*="journals/"]')
            altLinks.forEach(link => {
                const href = link.getAttribute('href')
                const match = href.match(/journals\/(\d+)/)
                if (match) {
                    const id = parseInt(match[1])
                    if (!journalIds.includes(id)) {
                        journalIds.push(id)
                    }
                }
            })
        }

        return journalIds
    }

    /**
     * Debug journal data by fetching from all three endpoints
     */
    async debugJournalData() {
        try {
            const journalIds = this.extractJournalIds()

            if (journalIds.length === 0) {
                Logger.warn(`[${this.name}] No journal IDs found on current page`)
                console.warn('🔍 Triangles Debug: No journal IDs found on current page')
                return
            }

            Logger.info(`[${this.name}] Found ${journalIds.length} journal ID(s): ${journalIds.join(', ')}`)
            console.log(`🔍 Triangles Debug: Found ${journalIds.length} journal ID(s):`, journalIds)

            // Debug first few journals (limit to 3 to avoid too much data)
            const journalsToDebug = journalIds.slice(0, 3)

            for (const journalId of journalsToDebug) {
                await this.debugSingleJournal(journalId)
            }

        } catch (error) {
            Logger.error(`[${this.name}] Error in debugJournalData:`, error)
            console.error('❌ Triangles Debug Error:', error)
        }
    }

    /**
     * Debug a single journal by fetching data from all three endpoints
     * @param {number} journalId - The journal ID to debug
     */
    async debugSingleJournal(journalId) {
        console.group(`📚 Triangles Debug: Journal ${journalId}`)

        try {
            // 1. Fetch basic journal info
            console.log('🔄 Fetching basic journal info...')
            const journalInfo = await this.fetchJournalInfo(journalId)
            console.log('📋 Basic Journal Info:', journalInfo)

            // 2. Fetch journal entries by date
            console.log('🔄 Fetching journal entries by date...')
            const journalEntries = await this.fetchJournalEntriesByDate(journalId)
            console.log('📅 Journal Entries by Date:', journalEntries)

            // 3. Fetch journal students
            console.log('🔄 Fetching journal students...')
            const journalStudents = await this.fetchJournalStudents(journalId)
            console.log('👥 Journal Students:', journalStudents)

            // Summary
            console.log('📊 Summary for Journal', journalId, ':', {
                journalName: journalInfo?.nameEt || journalInfo?.name || 'Unknown',
                entriesCount: Array.isArray(journalEntries) ? journalEntries.length : 0,
                studentsCount: Array.isArray(journalStudents) ? journalStudents.length : 0,
                lastUpdated: new Date().toISOString()
            })

        } catch (error) {
            console.error(`❌ Error debugging journal ${journalId}:`, error)
            Logger.error(`[${this.name}] Error debugging journal ${journalId}:`, error)
        }

        console.groupEnd()
    }

    /**
     * Fetch basic journal information
     * @param {number} journalId - The journal ID
     * @returns {Promise<Object>} Journal info
     */
    async fetchJournalInfo(journalId) {
        try {
            const response = await this.api.tahvel.get(`/journals/${journalId}`, {}, {
                cache: false // Disable cache for debugging
            })
            Logger.debug(`[${this.name}] Fetched journal info for ${journalId}`)
            return response
        } catch (error) {
            Logger.error(`[${this.name}] Failed to fetch journal info for ${journalId}:`, error)
            throw error
        }
    }

    /**
     * Fetch journal entries by date
     * @param {number} journalId - The journal ID
     * @returns {Promise<Array>} Journal entries
     */
    async fetchJournalEntriesByDate(journalId) {
        try {
            const response = await this.api.tahvel.get(
                `/journals/${journalId}/journalEntriesByDate`,
                { allStudents: false }, // Match triangle-reference implementation
                { cache: false } // Disable cache for debugging
            )
            Logger.debug(`[${this.name}] Fetched journal entries by date for ${journalId}`)
            return response
        } catch (error) {
            Logger.error(`[${this.name}] Failed to fetch journal entries by date for ${journalId}:`, error)
            throw error
        }
    }

    /**
     * Fetch journal students
     * @param {number} journalId - The journal ID
     * @returns {Promise<Array>} Journal students
     */
    async fetchJournalStudents(journalId) {
        try {
            const response = await this.api.tahvel.get(
                `/journals/${journalId}/journalStudents`,
                {}, // No additional parameters like in triangle-reference
                { cache: false } // Disable cache for debugging
            )
            Logger.debug(`[${this.name}] Fetched journal students for ${journalId}`)
            return response
        } catch (error) {
            Logger.error(`[${this.name}] Failed to fetch journal students for ${journalId}:`, error)
            throw error
        }
    }

    /**
     * Cleanup when feature is deactivated
     */
    deactivate() {
        Logger.info(`[${this.name}] Deactivating triangles debug feature`)
    }
}

// Export a singleton instance
export const trianglesDebugFeature = new TrianglesDebugFeature()
