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
    // Wait for kriitAssignments and tahvelAssignments to be available
    if (window.journalListSync && window.journalListSync.kriitAssignments && window.journalListSync.tahvelAssignments) {
      this.renderDueDateDifferences()
      return
    }
    let attempts = 0
    const maxAttempts = 17
    const poll = () => {
      if (window.journalListSync && window.journalListSync.kriitAssignments && window.journalListSync.tahvelAssignments) {
        this.renderDueDateDifferences()
        return
      }
      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 300)
      } else {
        // eslint-disable-next-line no-console
        console.warn('[DueDateDiff] window.journalListSync kriitAssignments/tahvelAssignments still not defined after waiting')
      }
    }
    poll()
  }

  onDeactivate() {
    this.isActive = false
    this.removeDueDateDiffSection()
  }

  renderDueDateDifferences() {
    if (!window.journalListSync || !window.journalListSync.kriitAssignments || !window.journalListSync.tahvelAssignments) {
      // eslint-disable-next-line no-console
      console.warn('[DueDateDiff] kriitAssignments or tahvelAssignments not available on window.journalListSync')
      return
    }
    const kriitAssignments = window.journalListSync.kriitAssignments
    const tahvelAssignments = window.journalListSync.tahvelAssignments
    // Debug: Show all assignments in the console
    // eslint-disable-next-line no-console
    console.log('[DueDateDiff] kriitAssignments:', JSON.parse(JSON.stringify(kriitAssignments)))
    console.log('[DueDateDiff] tahvelAssignments:', JSON.parse(JSON.stringify(tahvelAssignments)))
    const dueDateDiffs = []
    kriitAssignments.forEach(subjectKriit => {
      const subjectTahvel = tahvelAssignments.find(s => s.subjectExternalId === subjectKriit.subjectExternalId && s.groupName === subjectKriit.groupName)
      if (!subjectTahvel) return
      if (!Array.isArray(subjectKriit.assignments) || !Array.isArray(subjectTahvel.assignments)) return
      subjectKriit.assignments.forEach(kriitAssignment => {
        const tahvelAssignment = subjectTahvel.assignments.find(a => a.assignmentExternalId === kriitAssignment.assignmentExternalId)
        if (!tahvelAssignment) return
        const dueDateKriit = kriitAssignment.assignmentDueAt || ''
        const dueDateTahvel = tahvelAssignment.assignmentDueAt || ''
        if (dueDateKriit !== dueDateTahvel) {
          dueDateDiffs.push({
            subjectName: subjectKriit.subjectName,
            groupName: subjectKriit.groupName,
            assignmentExternalId: kriitAssignment.assignmentExternalId,
            assignmentName: kriitAssignment.assignmentName || tahvelAssignment.assignmentName || '',
            dueDateKriit,
            dueDateTahvel
          })
        }
      })
    })
    if (dueDateDiffs.length > 0) {
      // Debug: Show due date diffs in the console
      // eslint-disable-next-line no-console
      console.log('[DueDateDiff] Assignment due date differences:', dueDateDiffs)
    }
    if (dueDateDiffs.length === 0) return
    this.insertDueDateDiffSection(dueDateDiffs)
  }

  insertDueDateDiffSection(diffs) {
    // Find the sync banner container
    const banner = document.querySelector('.ta-sync-banner')
    if (!banner) return
    // Remove old section if present
    this.removeDueDateDiffSection()
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
    diffs.forEach(diff => {
      const row = domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-diff-row'], style: 'margin-bottom: 0.5em; padding: 0.5em; border-bottom: 1px solid #ffe58f;' },
        '',
        section
      )
      domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-due-date-diff-title'], style: 'font-weight: 600; margin-bottom: 0.2em;' },
        `${diff.subjectName || ''} (${diff.groupName || ''}) — ${diff.assignmentName || diff.assignmentExternalId}`,
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

  removeDueDateDiffSection() {
    const section = document.querySelector('.ta-sync-due-date-diff-section')
    if (section && section.parentNode) section.parentNode.removeChild(section)
  }
}

export const assignmentDueDateDiff = new AssignmentDueDateDiffFeature()
