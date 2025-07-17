import { BaseFeature } from '../../core/BaseFeature'
import Logger from '../../services/Logger'
import { domService } from '../../services/DomService'

/**
 * Assignment Due Date Difference Feature
 *
 * Scans the differences array for assignments with due date mismatches and renders them in the sync banner.
 */
class AssignmentDueDateDiffFeature extends BaseFeature {
  constructor() {
    super('assignmentDueDateDiff', /#\/journals\?_menu/)
    this.isActive = false
  }

  onActivate() {
    this.isActive = true
    Logger.feature(this.name, 'Assignment Due Date Diff feature initialized')
    this.waitForJournalListSync()
  }

  waitForJournalListSync() {
    // Wait for differences to be available
    if (window.journalListSync && window.journalListSync.differences) {
      this.renderDueDateDifferences()
      return
    }
    let attempts = 0
    const maxAttempts = 17
    const poll = () => {
      if (window.journalListSync && window.journalListSync.differences) {
        this.renderDueDateDifferences()
        return
      }
      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 300)
      } else {
        // eslint-disable-next-line no-console
        console.warn('[DueDateDiff] window.journalListSync.differences still not defined after waiting')
      }
    }
    poll()
  }

  onDeactivate() {
    this.isActive = false
    this.removeDueDateDiffSection()
  }

  renderDueDateDifferences() {
    if (!window.journalListSync || !window.journalListSync.differences) {
      // eslint-disable-next-line no-console
      console.warn('[DueDateDiff] differences not available on window.journalListSync')
      return
    }
    const differences = window.journalListSync.differences || []
    const dueDateDiffs = []
    differences.forEach(subjectDiff => {
      if (!Array.isArray(subjectDiff.assignments)) return
      subjectDiff.assignments.forEach(assignment => {
        if (
          assignment.assignmentDueAt &&
          typeof assignment.assignmentDueAt === 'object' &&
          assignment.assignmentDueAt.kriit !== assignment.assignmentDueAt.remote
        ) {
          dueDateDiffs.push({
            subjectName: subjectDiff.subjectName,
            groupName: subjectDiff.groupName,
            assignmentExternalId: assignment.assignmentExternalId,
            assignmentName: assignment.assignmentName || '',
            dueDateKriit: assignment.assignmentDueAt.kriit,
            dueDateTahvel: assignment.assignmentDueAt.remote
          })
        }
      })
    })
    if (dueDateDiffs.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[DueDateDiff] Assignment due date differences:', dueDateDiffs)
    }
    if (dueDateDiffs.length === 0) return
    this.insertDueDateDiffSection(dueDateDiffs)
  }

  insertDueDateDiffSection(diffs) {
    // Find the sync banner container
    const banner = document.querySelector('.ta-sync-banner')
    if (!banner) {
      // eslint-disable-next-line no-console
      console.warn('[DueDateDiff] .ta-sync-banner not found, cannot insert due date diff section')
      return
    }
    // Remove old section if present
    this.removeDueDateDiffSection()
    // eslint-disable-next-line no-console
    console.log('[DueDateDiff] Inserting due date diff section with', diffs.length, 'diffs')
    const section = domService.createAndInsertElement(
      'div',
      {
        classList: ['ta-sync-due-date-diff-section'],
        style: 'margin-bottom: 1.5em; background: #fffbe6; border: 1px solid #ffe58f; padding: 1em; border-radius: 6px;'
      },
      '',
      banner,
      'afterbegin'
    )
    domService.createAndInsertElement(
      'h3',
      { style: 'margin-bottom: 0.75em; font-size: 1.1em; font-weight: bold; color: #ad8b00;' },
      'Assignment Due Date Differences',
      section
    )
    // Add Sync Due Dates button
    const syncBtn = domService.createAndInsertElement(
      'button',
      {
        classList: ['ta-sync-due-date-btn'],
        style:
          'margin-bottom: 1em; background: #ffd666; color: #ad8b00; border: none; border-radius: 4px; padding: 0.5em 1em; font-weight: bold; cursor: pointer;'
      },
      'Sünkroniseeri tähtajad Tahvlisse',
      section
    )
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true
      syncBtn.textContent = 'Sünkroniseerin...'
      try {
        await this.syncDueDatesToTahvel(diffs)
        syncBtn.textContent = 'Tähtajad sünkroniseeritud!'
        setTimeout(() => {
          syncBtn.textContent = 'Sünkroniseeri tähtajad Tahvlisse'
          syncBtn.disabled = false
        }, 2000)
      } catch (e) {
        syncBtn.textContent = 'Sünkroniseerimine ebaõnnestus!'
        setTimeout(() => {
          syncBtn.textContent = 'Sünkroniseeri tähtajad Tahvlisse'
          syncBtn.disabled = false
        }, 3000)
      }
    })
    diffs.forEach(diff => {
      const row = domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-diff-row'], style: 'margin-bottom: 0.5em; padding: 0.5em; border-bottom: 1px solid #ffe58f;' },
        '',
        section
      )
      // Handle assignmentName as object or string
      let assignmentName = diff.assignmentName
      if (assignmentName && typeof assignmentName === 'object') {
        assignmentName = assignmentName.kriit || assignmentName.remote || JSON.stringify(assignmentName)
      }
      domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-diff-title'], style: 'font-weight: 600; margin-bottom: 0.2em;' },
        `${diff.subjectName || ''} (${diff.groupName || ''}) — ${assignmentName || diff.assignmentExternalId}`,
        row
      )
      domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-kriit'], style: 'color: #d48806;' },
        `Kriit: ${diff.dueDateKriit || '—'}`,
        row
      )
      domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-tahvel'], style: 'color: #cf1322;' },
        `Tahvel: ${diff.dueDateTahvel || '—'}`,
        row
      )
    })
  }

  /**
   * Sync due date differences to Tahvel using the same API as assignment name sync
   */
  async syncDueDatesToTahvel(diffs) {
    try {
      if (!window.journalListSync || !window.journalListSync.differences) {
        Logger.error('[DueDateSync] differences not available on window.journalListSync')
        throw new Error('Vigu: differences pole saadaval')
      }
      // Use the same API instance as assignment name sync
      const api = (window.journalListSync.api && window.journalListSync.api.tahvel) || (window.api && window.api.tahvel) || (this.api && this.api.tahvel)
      if (!api) {
        Logger.error('[DueDateSync] Tahvel API not available')
        throw new Error('Tahvel API pole saadaval')
      }
      for (const diff of diffs) {
        try {
          // Find the subject in the backend diff
          const subject = window.journalListSync.differences.find(s => s.subjectName === diff.subjectName)
          if (!subject || !Array.isArray(subject.assignments)) {
            Logger.error(`[DueDateSync] Subject not found or assignments missing for subjectName=${diff.subjectName}`)
            continue
          }
          const assignment = subject.assignments.find(a => a.assignmentExternalId === diff.assignmentExternalId)
          if (!assignment) {
            Logger.error(`[DueDateSync] Assignment not found for assignmentExternalId=${diff.assignmentExternalId}`)
            continue
          }
          const journalId = subject.subjectExternalId
          const assignmentId = assignment.assignmentExternalId
          if (!journalId || !assignmentId) {
            Logger.error(`[DueDateSync] journalId or assignmentId missing: journalId=${journalId}, assignmentId=${assignmentId}`)
            continue
          }
          let currentEntry
          try {
            currentEntry = await api.get(`/journals/${journalId}/journalEntry/${assignmentId}`, {}, { cache: false, forceRefresh: true })
          } catch (error) {
            Logger.error(`[DueDateSync] Failed to fetch journal entry for journalId=${journalId}, assignmentId=${assignmentId}: ${error.message}`)
            continue
          }
          if (!currentEntry) {
            Logger.error(`[DueDateSync] No journal entry found for journalId=${journalId}, assignmentId=${assignmentId}`)
            continue
          }
          // Build the PUT payload by copying all fields, updating homeworkDuedate
          let newDueDate = diff.dueDateKriit
          // Ensure due date is in ISO format with time and Z
          if (typeof newDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
            // Convert YYYY-MM-DD to YYYY-MM-DDT00:00:00Z
            newDueDate = new Date(newDueDate + 'T00:00:00Z').toISOString()
          } else if (newDueDate instanceof Date) {
            newDueDate = newDueDate.toISOString()
          }
          const payload = { ...currentEntry, homeworkDuedate: newDueDate, journalEntryCapacityTypes: currentEntry.journalEntryCapacityTypes || ['MAHT_i'] }
          Logger.info(`✨ [AssignmentDueDateDiffFeature] PUT /journals/${journalId}/journalEntry/${assignmentId} with payload: ${JSON.stringify(payload)}`)
          try {
            await api.put(`/journals/${journalId}/journalEntry/${assignmentId}`, payload)
            Logger.info(`✨ Updated assignment due date in Tahvel: ${diff.dueDateTahvel} → ${diff.dueDateKriit}`)
          } catch (error) {
            Logger.error(`[DueDateSync] Failed to update assignment due date for journalId=${journalId}, assignmentId=${assignmentId}: ${error.message}`)
          }
        } catch (err) {
          Logger.error(`[DueDateSync] Unexpected error for diff: ${JSON.stringify(diff)}: ${err.message}`)
        }
      }
    } catch (mainErr) {
      Logger.error(`[DueDateSync] Fatal error in syncDueDatesToTahvel: ${mainErr.message}`)
      throw mainErr
    }
  }

  removeDueDateDiffSection() {
    const section = document.querySelector('.ta-sync-due-date-diff-section')
    if (section && section.parentNode) section.parentNode.removeChild(section)
  }
}

export const assignmentDueDateDiff = new AssignmentDueDateDiffFeature()
