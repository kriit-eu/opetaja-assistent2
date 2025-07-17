import { domService } from '../../services/DomService.js'

class DifferenceRenderer {
  render(container, assignmentNameDiffs, gradeDiffs, dueDateDiffs) {
    const groupedDiffs = this.collectAndGroupDifferences(assignmentNameDiffs, gradeDiffs, dueDateDiffs)

    for (const subjectName in groupedDiffs) {
      const subjectContainer = this.createSubjectContainer(container, subjectName)
      groupedDiffs[subjectName].forEach(diff => {
        const row = this.createRow(subjectContainer)
        this.createBadge(row, diff.type, diff.color)
        this.createBadge(row, diff.assignmentName, '#ffc107') // yellow
        this.createDifferenceText(row, diff.studentName, diff.oldValue, diff.newValue)
      })
    }
  }

  collectAndGroupDifferences(assignmentNameDiffs, gradeDiffs, dueDateDiffs) {
    const grouped = {}
    const normalize = grade => (grade === null || grade === undefined || grade === '') ? null : String(grade)

    // Create a map of new assignment names
    const newNames = {}
    ;(assignmentNameDiffs || []).forEach(subject => {
      ;(subject.nameDiffs || []).forEach(nameDiff => {
        newNames[nameDiff.assignmentExternalId] = nameDiff.kriit
      })
    })

    // Helper to add a difference to the grouped object
    const addDiff = (subjectName, diff) => {
      if (!grouped[subjectName]) {
        grouped[subjectName] = []
      }
      grouped[subjectName].push(diff)
    }

    // Name Diffs first
    ;(assignmentNameDiffs || []).forEach(subject => {
        ;(subject.nameDiffs || []).forEach(nameDiff => {
            addDiff(subject.subjectName, {
                type: 'Nimi',
                color: '#6c757d', // gray
                assignmentName: nameDiff.remote,
                studentName: '',
                oldValue: nameDiff.remote,
                newValue: nameDiff.kriit
            })
        })
    })

    // Grade Diffs
    ;(gradeDiffs || []).forEach(subject => {
      ;(subject.assignments || []).forEach(assignment => {
        const assignmentName = newNames[assignment.assignmentExternalId] || assignment.assignmentName
        ;(assignment.results || []).forEach(result => {
          const tahvelGrade = normalize(result.currentGrade)
          const kriitGrade = normalize(result.grade)

          if (tahvelGrade !== kriitGrade) {
            addDiff(subject.subjectName, {
              type: 'Hinne',
              color: '#007bff', // blue
              assignmentName: assignmentName,
              studentName: result.studentName,
              oldValue: tahvelGrade || 'puudub',
              newValue: kriitGrade || 'puudub'
            })
          }
        })
      })
    })

    // Due Date Diffs
    ;(dueDateDiffs || []).forEach(diff => {
      const assignmentName = newNames[diff.assignmentExternalId] || diff.assignmentName
      addDiff(diff.subjectName, {
        type: 'Tähtaeg',
        color: '#e83e8c', // magenta
        assignmentName: assignmentName,
        studentName: '',
        oldValue: diff.dueDateTahvel,
        newValue: diff.dueDateKriit
      })
    })

    return grouped
  }

  createSubjectContainer(container, subjectName) {
    const subjectContainer = domService.createAndInsertElement('div', { style: 'margin-bottom: 1.5em;' }, '', container)
    domService.createAndInsertElement('h3', { style: 'font-weight: 600; margin-bottom: 0.5em; font-size: 1.1em;' }, subjectName, subjectContainer)
    return subjectContainer
  }

  createRow(container) {
    return domService.createAndInsertElement(
      'div',
      { style: 'display: flex; align-items: center; margin-bottom: 0.6em; font-size: 0.95em;' },
      '',
      container
    )
  }

  createBadge(row, text, color) {
    const badgeText = text && text.length > 25 ? text.substring(0, 22) + '...' : text
    const badge = domService.createAndInsertElement(
      'span',
      {
        style: `background-color: ${color}; color: white; padding: 4px 8px; border-radius: 12px; margin-right: 8px; white-space: nowrap;`,
      },
      badgeText,
      row
    )
    return badge
  }

  createDifferenceText(row, studentName, oldValue, newValue) {
    const textContainer = domService.createAndInsertElement('span', { style: 'display: flex; align-items: center;' }, '', row)

    if (studentName) {
      domService.createAndInsertElement('span', { style: 'margin-right: 8px;' }, studentName, textContainer)
    }
    domService.createAndInsertElement(
      'span',
      { style: 'color: #6c757d; margin-right: 8px;' }, // gray
      oldValue,
      textContainer
    )
    domService.createAndInsertElement('span', { style: 'margin-right: 8px;' }, '→', textContainer)
    domService.createAndInsertElement('span', { style: 'font-weight: 600;' }, newValue, textContainer)
  }
}

export const differenceRenderer = new DifferenceRenderer()