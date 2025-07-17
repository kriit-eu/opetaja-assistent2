import { domService } from '../../services/DomService.js'

class DifferenceRenderer {
  render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs) {
    // Render due date differences
    if (dueDateDiffs.length > 0) {
      this.insertDueDateDiffSection(dueDateDiffs, container)
    }

    // Render assignment name differences first (if any)
    assignmentNameDiffs.forEach(subjectDiff => {
      const subjectBlock = domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-diff-subject'], style: 'margin-bottom: 1.5em;' },
        '',
        container
      )
      domService.createAndInsertElement(
        'div',
        { classList: ['ta-sync-diff-subject-title'], style: 'font-weight: 600; margin-bottom: 0.5em; font-size: 1.1em;' },
        subjectDiff.subjectName,
        subjectBlock
      )
      subjectDiff.nameDiffs.forEach(nameDiff => {
        const row = domService.createAndInsertElement(
          'div',
          {
            classList: ['ta-sync-assignment-name-diff-row'],
            style: 'display: flex; align-items: center; margin-bottom: 0.5em; padding: 0.5em; border-bottom: 1px solid #eee;'
          },
          '',
          subjectBlock
        )
        domService.createAndInsertElement(
          'span',
          { classList: ['ta-sync-assignment-name-remote'], style: 'flex: 1; font-weight: 400;' },
          nameDiff.remote,
          row
        )
        domService.createAndInsertElement('span', { classList: ['ta-sync-grade-arrow'], style: 'margin: 0 0.5em;' }, '→', row)
        domService.createAndInsertElement(
          'span',
          { classList: ['ta-sync-assignment-name-kriit'], style: 'flex: 1; font-weight: 400;' },
          nameDiff.kriit,
          row
        )
      })
    })

    // Only render subject blocks for subjects with at least one assignment with a grade difference
    gradeDiffs.forEach(subjectGradeDiff => {
      if (!Array.isArray(subjectGradeDiff.assignments)) return
      // Filter assignments for those with at least one grade difference
      const assignmentsWithDiffs = subjectGradeDiff.assignments.filter(assignment => {
        const resultsWithDifferences = Array.isArray(assignment.results)
          ? assignment.results.filter(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'
              if (result.grade === null || result.grade === undefined || result.grade === '') {
                return false
              }
              return tahvelGrade !== kriitGrade
            })
          : []
        return resultsWithDifferences.length > 0
      })
      if (assignmentsWithDiffs.length === 0) return
      // If this subject was already rendered above, reuse the block, else create a new one
      let subjectBlock = Array.from(container.children).find(
        el =>
          el.classList.contains('ta-sync-diff-subject') &&
          el.querySelector('.ta-sync-diff-subject-title')?.textContent === subjectGradeDiff.subjectName
      )
      if (!subjectBlock) {
        subjectBlock = domService.createAndInsertElement('div', { classList: ['ta-sync-diff-subject'], style: 'margin-bottom: 1.5em;' }, '', container)
        domService.createAndInsertElement(
          'div',
          { classList: ['ta-sync-diff-subject-title'], style: 'font-weight: 600; margin-bottom: 0.5em; font-size: 1.1em;' },
          subjectGradeDiff.subjectName,
          subjectBlock
        )
      }
      assignmentsWithDiffs.forEach(assignment => {
        const resultsWithDifferences = Array.isArray(assignment.results)
          ? assignment.results.filter(result => {
              const tahvelGrade = result.currentGrade || '(puudub)'
              const kriitGrade = result.grade || '(puudub)'
              if (result.grade === null || result.grade === undefined || result.grade === '') {
                return false
              }
              return tahvelGrade !== kriitGrade
            })
          : []
        domService.createAndInsertElement(
          'div',
          { classList: ['ta-sync-assignment-title'], style: 'margin-top: 0.5em; font-weight: 500;' },
          assignment.assignmentName || '',
          subjectBlock
        )
        resultsWithDifferences.forEach(result => {
          const resultRow = domService.createAndInsertElement(
            'div',
            { classList: ['ta-sync-result-row'], style: 'margin-bottom: 0.25em;' },
            '',
            subjectBlock
          )
          domService.createAndInsertElement(
            'span',
            { classList: ['ta-sync-student-name'], style: 'margin-right: 0.5em;' },
            result.studentName,
            resultRow
          )
          const kriitGrade = result.grade || '(puudub)'
          domService.createAndInsertElement('span', { classList: ['ta-sync-grade-arrow'], style: 'margin: 0 0.5em;' }, '→', resultRow)
          domService.createAndInsertElement('span', { classList: ['ta-sync-grade-kriit'] }, kriitGrade, resultRow)
        })
      })
    })
  }

  insertDueDateDiffSection(diffs, banner) {
    // Find the sync banner container
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

  removeDueDateDiffSection() {
    const section = document.querySelector('.ta-sync-due-date-diff-section')
    if (section && section.parentNode) section.parentNode.removeChild(section)
  }
}

export const differenceRenderer = new DifferenceRenderer()
