/**
 * Auditory Learning Checker Feature - Detects and helps fix missing "Auditoorne õpe" (auditory learning) on journal entries
 * User Story: As a teacher, I want the system to automatically detect when the auditory learning option is missing from an entry, so that I can quickly correct the error and ensure the data is accurate.
 */

import { BaseFeature } from '../../core/BaseFeature'
import Logger from '../../services/Logger'

export default class AuditoryLearningCheckerFeature extends BaseFeature {
    constructor() {
        // Match journal edit pages specifically
        super('auditoryLearningChecker', /\/journal\/\d+\/edit/, [])
        this.name = 'AuditoryLearningCheckerFeature'
        this.tableCreated = false
        this.currentJournalId = null
        this.incompleteEntries = []
        this.lastJournalData = null
    }

    async activate() {
        Logger.debug(`[${this.name}] Activating feature`)
        this.reset()
        await this.waitForPageReady()
        // Only activate if the A: lessonHours capacityHours is not full
        const capacitySpans = document.querySelectorAll('span[ng-repeat*="type in journal.lessonHours.capacityHours"]')
        let shouldActivate = false
        capacitySpans.forEach(span => {
            const labelSpan = span.querySelectorAll('span')[0]
            const valueSpan = span.querySelectorAll('span')[1]
            if (labelSpan && valueSpan && labelSpan.textContent.trim() === 'A:') {
                const match = valueSpan.textContent.match(/(\d+)\/(\d+)/)
                if (match) {
                    const [_, total, filled] = match.map(Number)
                    if (total !== filled) {
                        shouldActivate = true
                    }
                }
            }
        })
        if (!shouldActivate) {
            Logger.debug(`[${this.name}] Auditoorne (A:) lesson hours are full, not activating auditory checker feature`)
            return
        }
        await this.checkAuditoryLearningOnEntries()
    }

    onDeactivate() {
        Logger.debug(`[${this.name}] Deactivating feature`)
        this.reset()
        super.onDeactivate()
    }

    async checkAuditoryLearningOnEntries() {
        Logger.debug(`[${this.name}] Starting auditory learning check`)
        const journalId = this.extractJournalId()
        if (!journalId) {
            Logger.warning(`[${this.name}] No journal ID found, cannot check auditory learning`)
            return
        }
        Logger.debug(`[${this.name}] Checking auditory learning for journal ${journalId}`)
        const { journalData } = await this.fetchJournalAndTimetableData(journalId)
        this.lastJournalData = journalData
        this.incompleteEntries = []
        Logger.debug(`[${this.name}] Found ${journalData.entries.length} journal entries to check`)
        // Fetch details for each entry
        const detailPromises = journalData.entries.map(async entry => {
            if (entry.entryType !== 'SISSEKANNE_T') return null
            try {
                const detail = await this.api.tahvel.get(`/journals/${journalId}/journalEntry/${entry.id}`)
                if (!this.hasAuditoryLearning(detail)) {
                    Logger.debug(`[${this.name}] Entry ${entry.id} missing auditory learning: journalEntryCapacityTypes=${JSON.stringify(detail.journalEntryCapacityTypes)}`)
                    return {
                        id: entry.id,
                        date: entry.entryDate,
                        lessons: entry.lessons || 1,
                        startLessonNr: entry.startLessonNr || 1,
                        note: 'Auditoorne õpe puudub',
                        fixed: false
                    }
                }
            } catch (e) {
                Logger.error(`[${this.name}] Failed to fetch details for entry ${entry.id}:`, e)
            }
            return null
        })
        const incomplete = (await Promise.all(detailPromises)).filter(Boolean)
        this.incompleteEntries = incomplete
        Logger.debug(`[${this.name}] Total incomplete entries found: ${this.incompleteEntries.length}`)
        this.insertIncompleteAuditoryLearningTable()
    }

    hasAuditoryLearning(entry) {
        // Use journalEntryCapacityTypes if present, otherwise capacityTypes
        const types = Array.isArray(entry.journalEntryCapacityTypes) && entry.journalEntryCapacityTypes.length > 0
            ? entry.journalEntryCapacityTypes
            : (Array.isArray(entry.capacityTypes) ? entry.capacityTypes : [])
        Logger.debug(`[${this.name}] Entry ${entry.id}: journalEntryCapacityTypes=${JSON.stringify(entry.journalEntryCapacityTypes)}, capacityTypes=${JSON.stringify(entry.capacityTypes)}, using types=${JSON.stringify(types)}`)
        if (!types || types.length === 0) return false
        const found = types.some(type => {
            if (typeof type === 'string') {
                Logger.debug(`[${this.name}] Entry ${entry.id}: checking type string '${type}'`)
                return type === 'MAHT_a' || type.toLowerCase().includes('auditoorne')
            }
            if (type && type.nameEt) {
                Logger.debug(`[${this.name}] Entry ${entry.id}: checking type object nameEt '${type.nameEt}'`)
                return type.nameEt.toLowerCase().includes('auditoorne')
            }
            return false
        })
        Logger.debug(`[${this.name}] Entry ${entry.id}: hasAuditoryLearning result: ${found}`)
        return found
    }

    insertIncompleteAuditoryLearningTable() {
        // Remove any existing table first
        const existingTable = document.querySelector('[data-auditory-learning-table]')
        if (existingTable) existingTable.remove()
        if (this.incompleteEntries.length === 0) return

        // Find insertion point (reuse logic from LessonDiscrepanciesFeature)
        const insertionPoint = this.findInsertionPoint()
        if (!insertionPoint) return

        const container = document.createElement('div')
        container.setAttribute('data-auditory-learning-table', 'true')
        container.style.cssText = `
            background: #ffe0e0;
            border: 1px solid #ffb3b3;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            width: 600px;
            min-width: 430px;
        `
        let content = `
            <div style="display: flex; align-items: center; margin-bottom: 15px;">
                <span style="font-size: 20px; margin-right: 10px;">\u26A0\uFE0F</span>
                <h3 style="margin: 0; color: #a94442;">Puudub Auditoorne \u00F5pe (${this.incompleteEntries.length})</h3>
            </div>
            <table style="width: 600px; border-collapse: collapse; background: white;">
                <thead>
                    <tr style="background: #f8d7da;">
                        <th style="padding: 6px 8px; text-align: left; border: 1px solid #f5c6cb; font-size: 14px; width: 80px;">Kuup\u00E4ev</th>
                        <th style="padding: 6px 8px; text-align: center; border: 1px solid #f5c6cb; font-size: 14px; width: 200px;">M\u00E4rkus</th>
                        <th style="padding: 6px 8px; text-align: center; border: 1px solid #f5c6cb; font-size: 14px; width: 80px;">Tegevus</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.incompleteEntries.map(entry => `
                        <tr>
                            <td style="border: 1px solid #f5c6cb;">${this.formatDisplayDate(entry.date)}</td>
                            <td style="border: 1px solid #f5c6cb; text-align: center;">${entry.note}${entry.fixed ? ' (parandatud)' : ''}</td>
                            <td style="border: 1px solid #f5c6cb; text-align: center;">
                                ${entry.fixed ? '<span style=\'color:green\'>OK</span>' : `<button id="fix-auditory-${entry.id}" data-entry-id="${entry.id}" style="background:#a94442;color:white;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;">Paranda</button>`}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`
        container.innerHTML = content
        insertionPoint.insertBefore(container, insertionPoint.firstChild)
        this.addFixButtonListeners()
    }

    addFixButtonListeners() {
        this.incompleteEntries.forEach(entry => {
            if (entry.fixed) return
            const btn = document.getElementById(`fix-auditory-${entry.id}`)
            if (btn) {
                btn.addEventListener('click', async () => {
                    await this.fixAuditoryLearning(entry)
                })
            }
        })
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async fixAuditoryLearning(entry) {
        Logger.info(`[${this.name}] Fixing auditory learning for entry ${entry.id}`)
        try {
            // Use the date from the table row (already in entry.date)
            await this.openAndEditJournalEntry(entry.date, entry.id)
            await this.waitForEditFormToOpen()
            await this.checkAuditoriumLearningCheckbox()
            // Optionally, trigger save (simulate clicking the save button)
            const saveButton = Array.from(document.querySelectorAll('button, md-button, [role="button"]')).find(btn => {
                const text = btn.textContent.trim().toLowerCase()
                return text.includes('salvesta') || text.includes('save')
            })
            if (saveButton) {
                saveButton.click()
                Logger.info(`[${this.name}] Clicked save button for entry ${entry.id}`)
            } else {
                Logger.warning(`[${this.name}] Could not find save button after checking Auditoorne õpe for entry ${entry.id}`)
            }
            entry.fixed = true
            this.insertIncompleteAuditoryLearningTable()
        } catch (e) {
            Logger.error(`[${this.name}] Failed to fix auditory learning for entry ${entry.id}:`, e)
        }
    }

    async openAndEditJournalEntry(date, entryId) {
        // Reuse logic from LessonDiscrepanciesFeature to find and open the entry
        const entryElement = await this.findJournalEntryElement(entryId, this.formatDate(date))
        if (!entryElement) throw new Error('Entry element not found')
        await this.clickJournalEntry(entryElement)
        await this.waitForEditFormToOpen()
        await this.checkAuditoriumLearningCheckbox()
        // Optionally, save the form (could trigger save button click here)
    }

    // --- Utility methods (reuse from LessonDiscrepanciesFeature) ---

    extractJournalId() {
        const fullUrl = window.location.pathname + window.location.hash
        const patterns = [/\/journal\/(\d+)/]
        for (const pattern of patterns) {
            const match = fullUrl.match(pattern)
            if (match) return match[1]
        }
        return null
    }

    async fetchJournalAndTimetableData(journalId) {
        // Only fetch journal data, timetable not needed for this feature
        const journalInfo = await this.api.tahvel.get(
            `/journals/${journalId}`,
            {},
            { cacheExpiration: 24 * 60 * 60 * 1000 }
        )
        const journalEntries = await this.api.tahvel.get(
            `/journals/${journalId}/journalEntriesByDate`,
            { allStudents: true },
            { cacheExpiration: 60 * 60 * 1000 }
        )
        return {
            journalData: {
                info: journalInfo,
                entries: journalEntries || []
            }
        }
    }

    findInsertionPoint() {
        const selectors = [
            'md-content .layout-padding',
            '.layout-padding',
            'md-content',
            '#main-content',
            '.main-content',
            'main',
            'body'
        ]
        for (const selector of selectors) {
            const element = document.querySelector(selector)
            if (element) return element
        }
        return document.body
    }

    formatDisplayDate(dateString) {
        const date = new Date(dateString)
        const day = date.getDate().toString().padStart(2, '0')
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const year = date.getFullYear()
        return `${day}.${month}.${year}`
    }

    async waitForPageReady(timeout = 1000) {
        return new Promise(resolve => setTimeout(resolve, timeout));
    }

    reset() {
        Logger.debug(`[${this.name}] Resetting feature state`)
        this.tableCreated = false
        this.currentJournalId = null
        this.incompleteEntries = []

        // Remove any existing table
        const existingTable = document.querySelector('[data-auditory-learning-table]')
        if (existingTable) {
            existingTable.remove()
        }
    }

    formatDate(dateString) {
        const date = new Date(dateString)
        return date.toISOString().split('T')[0]
    }

    // --- The following methods are copied from LessonDiscrepanciesFeature for reuse ---
    async findJournalEntryElement(entryId, date) {
        // Try to find the journal entry element by matching the date (DD.MM or DD.MM.YYYY) and entryId
        const formattedDate = this.formatDisplayDate(date)
        const shortDate = formattedDate.slice(0, 5) // 'DD.MM'
        // Look for spans with the date (short format) and editJournalEntry ng-click in the parent row
        const dateSpans = document.querySelectorAll('span[ng-if*="journalEntry.entryType.code"]')
        for (const span of dateSpans) {
            if (span.textContent.trim() === shortDate) {
                // Try to find the edit button in the same row or parent
                let row = span.closest('tr') || span.parentElement
                if (row) {
                    const editBtn = row.querySelector('[ng-click*="editJournalEntry"]')
                    if (editBtn) return editBtn
                }
            }
        }
        // Fallback: try to find by entryId in data attributes or text
        const allEditElements = document.querySelectorAll('[ng-click*="editJournalEntry"]')
        for (const el of allEditElements) {
            if (el.getAttribute('data-entry-id') == entryId || el.id == entryId || el.textContent.includes(entryId)) {
                return el
            }
        }
        // Fallback: return the first element if only one entry for the date
        if (allEditElements.length === 1) return allEditElements[0]
        return null
    }

    async clickJournalEntry(entryElement) {
        entryElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await this.delay(200)
        entryElement.click()
        await this.delay(500)
    }

    async waitForEditFormToOpen(maxAttempts = 20, intervalMs = 250) {
        Logger.debug(`[${this.name}] Waiting for edit form to open`)
        let attempts = 0
        return new Promise((resolve, reject) => {
            const check = () => {
                const form = document.querySelector('form[name*="edit"], form[name*="entry"], .edit-form, .entry-edit-form, md-dialog, .modal, .dialog')
                if (form) return resolve()
                if (++attempts >= maxAttempts) return reject(new Error('Edit form did not open'))
                setTimeout(check, intervalMs)
            }
            check()
        })
    }

    async checkAuditoriumLearningCheckbox() {
        // Try to find the "Auditoorne õpe" checkbox and check it
        const checkboxSelectors = [
            'md-checkbox[ng-model*="selectedCapacityTypes"][aria-label*="Auditoorne"]',
            'md-checkbox[aria-label="Auditoorne õpe"]',
            'input[type="checkbox"][ng-model*="selectedCapacityTypes"]',
            'md-checkbox input[type="checkbox"]',
            '.md-checkbox-container input[type="checkbox"]'
        ]
        for (const selector of checkboxSelectors) {
            const el = document.querySelector(selector)
            if (el && !el.checked) {
                el.click()
                await this.delay(200)
                return
            }
        }
        // Fallback: try to find by label text
        const allCheckboxes = document.querySelectorAll('md-checkbox, input[type="checkbox"]')
        for (const checkbox of allCheckboxes) {
            const label = checkbox.getAttribute('aria-label') || (checkbox.closest('md-checkbox') && checkbox.closest('md-checkbox').getAttribute('aria-label'))
            if (label && label.toLowerCase().includes('auditoorne') && !checkbox.checked) {
                checkbox.click()
                await this.delay(200)
                return
            }
        }
    }
}
