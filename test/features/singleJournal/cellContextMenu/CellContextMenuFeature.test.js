import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { JSDOM } from 'jsdom'

import CellContextMenuFeature, {
  buildAbsencePayload,
  buildGradePayload,
  gradeCodeToLabel
} from '../../../../src/features/singleJournal/cellContextMenu/CellContextMenuFeature.js'
import { cacheService } from '../../../../src/services/CacheService.js'

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://tahvel.edu.ee/#/journal/123/edit'
  })
  global.window = dom.window
  global.document = dom.window.document
  global.MutationObserver = dom.window.MutationObserver
  global.Node = dom.window.Node
  global.DOMParser = dom.window.DOMParser
  return dom
}

// Build a table fixture using DOMParser so tests don't have to wire each cell
// by hand. The input string is hard-coded in the tests — no untrusted data.
function renderFixture(html) {
  const parsed = new window.DOMParser().parseFromString(html, 'text/html')
  document.body.replaceChildren(...parsed.body.childNodes)
}

function buildTable({ entries, rows }) {
  renderFixture(`
    <div id="studentTable">
      <table class="tahvel-table with-borders">
        <thead>
          <tr>
            <th>Nr</th>
            <th>Õppija</th>
            ${entries.map(e => `<th>${e.headerText || ''}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td><a href="/#/students/${row.studentId}/main">${row.name}</a></td>
                ${entries.map(() => '<td></td>').join('')}
              </tr>
            `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `)
  return document.querySelector('#studentTable table')
}

function attachJournalState(feature, entries, journalStudents) {
  feature._journalEntries = entries
  feature._studentIdToJournalStudentId = new Map(
    journalStudents.map(s => [String(s.studentId), String(s.id)])
  )
  feature._loadedJournalId = 123
}

function rightClick(target, { clientX = 100, clientY = 100 } = {}) {
  const event = new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 2
  })
  target.dispatchEvent(event)
  return event
}

function getMenu() {
  return document.querySelector('.oa2-cell-context-menu')
}

function getMenuRows() {
  return Array.from(document.querySelectorAll('.oa2-cell-context-menu-row'))
}

function rowFor(label) {
  return getMenuRows().find(row => row.dataset.label === label) || null
}

describe('CellContextMenuFeature', () => {
  let feature

  beforeEach(() => {
    setupDom()
    feature = new CellContextMenuFeature()
    // Avoid real prefetch calls.
    feature._loadJournalData = mock(() => Promise.resolve())
    feature.api = {
      tahvel: {
        get: mock(async () => null),
        put: mock(async () => ({})),
        post: mock(async () => ({}))
      }
    }
    cacheService.clearJournalCache = mock(async () => 0)
  })

  afterEach(() => {
    feature.onDeactivate()
  })

  describe('URL pattern', () => {
    test('matches single-journal edit pages', () => {
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/edit')).toBe(true)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journals')).toBe(false)
      expect(feature.shouldActivate('https://tahvel.edu.ee/#/journal/123/view')).toBe(false)
    })
  })

  describe('activation lifecycle', () => {
    test('injects CSS and binds contextmenu on activate', () => {
      feature.onActivate()
      expect(document.getElementById('oa2-cell-context-menu-style')).not.toBeNull()
      expect(feature._contextListener).not.toBeNull()
    })

    test('removes CSS and unbinds listener on deactivate', () => {
      feature.onActivate()
      feature.onDeactivate()
      expect(document.getElementById('oa2-cell-context-menu-style')).toBeNull()
      expect(feature._contextListener).toBeNull()
    })
  })

  describe('grade label helpers', () => {
    test('gradeCodeToLabel reads code suffix', () => {
      expect(gradeCodeToLabel({ code: 'KUTSEHINDAMINE_5', value: '5' })).toBe('5')
      expect(gradeCodeToLabel({ code: 'KUTSEHINDAMINE_A' })).toBe('A')
      expect(gradeCodeToLabel({ code: 'KUTSEHINDAMINE_MA' })).toBe('MA')
      expect(gradeCodeToLabel(null)).toBeNull()
    })

    test('buildGradePayload returns null only for "Hinne puudub"', () => {
      expect(buildGradePayload('Hinne puudub')).toBeNull()
    })

    test('buildGradePayload treats X as a real grade code', () => {
      expect(buildGradePayload('X')).toEqual({
        code: 'KUTSEHINDAMINE_X',
        gradingSchemaRowId: null,
        value: 'X',
        value2: 'X',
        extraval1: null,
        extraval2: null,
        nameEt: 'Hinne X',
        nameEn: 'Grade X',
        valid: true
      })
    })

    test('buildGradePayload returns canonical grade object', () => {
      const grade = buildGradePayload('5')
      expect(grade).toEqual({
        code: 'KUTSEHINDAMINE_5',
        gradingSchemaRowId: null,
        value: '5',
        value2: '5',
        extraval1: null,
        extraval2: null,
        nameEt: 'Hinne 5',
        nameEn: 'Grade 5',
        valid: true
      })
      expect(buildGradePayload('A').code).toBe('KUTSEHINDAMINE_A')
      expect(buildGradePayload('MA').code).toBe('KUTSEHINDAMINE_MA')
    })

    test('buildAbsencePayload maps Kohal to null and Puudus to PUUDUMINE_P', () => {
      expect(buildAbsencePayload('Kohal')).toBeNull()
      expect(buildAbsencePayload('Puudus')).toBe('PUUDUMINE_P')
      expect(buildAbsencePayload('something else')).toBeUndefined()
    })
  })

  describe('_buildMenuModel', () => {
    test('lesson entry (T) shows attendance + grades with correct ticks for unmarked student', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: null,
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      const labels = model.map(item => (item.kind === 'separator' ? '---' : item.label))
      expect(labels).toEqual([
        'Kohal',
        'Puudus',
        '---',
        'Hinne puudub',
        '1',
        '2',
        '3',
        '4',
        '5',
        'A',
        'MA',
        'X'
      ])
      const markedLabels = model.filter(item => item.marked).map(item => item.label)
      expect(markedLabels).toEqual(['Kohal', 'Hinne puudub'])
    })

    test('lesson entry with current grade A and absence sets the two ticks correctly', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: 'A',
        currentAbsenceCode: 'PUUDUMINE_H',
        isAcademicLeave: false
      })
      const markedLabels = model.filter(item => item.marked).map(item => item.label)
      expect(markedLabels).toEqual(['Puudus', 'A'])
    })

    test('final-grade entry (L) hides attendance section', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_L' },
        currentGradeLabel: null,
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      const labels = model.map(item => (item.kind === 'separator' ? '---' : item.label))
      expect(labels).toEqual(['Hinne puudub', '1', '2', '3', '4', '5', 'A', 'MA', 'X'])
    })

    test('outcome entry (O) hides attendance section', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_O' },
        currentGradeLabel: '5',
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      expect(model.find(item => item.label === 'Kohal')).toBeUndefined()
      expect(model.find(item => item.label === '5').marked).toBe(true)
    })

    test('AP student rows hide attendance section', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: null,
        currentAbsenceCode: null,
        isAcademicLeave: true
      })
      expect(model.find(item => item.label === 'Kohal')).toBeUndefined()
      expect(model.find(item => item.label === 'Puudus')).toBeUndefined()
    })

    test('positive and negative grade colors are tagged', () => {
      const model = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: null,
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      const colors = Object.fromEntries(
        model.filter(item => item.kind === 'grade').map(item => [item.label, item.color])
      )
      expect(colors['1']).toBe('negative')
      expect(colors['2']).toBe('negative')
      expect(colors['MA']).toBe('negative')
      expect(colors['X']).toBe('negative')
      expect(colors['3']).toBe('positive')
      expect(colors['4']).toBe('positive')
      expect(colors['5']).toBe('positive')
      expect(colors['A']).toBe('positive')
      expect(colors['Hinne puudub']).toBeNull()
    })
  })

  describe('right-click resolution', () => {
    test('right-click on student-name column does not preventDefault and does not open menu', () => {
      const entry = { id: 10, entryType: 'SISSEKANNE_T', entryDate: '2025-03-25', journalStudentResults: {} }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()

      const studentCell = document.querySelector('tbody tr td:nth-child(2)')
      const event = rightClick(studentCell)
      expect(event.defaultPrevented).toBe(false)
      expect(getMenu()).toBeNull()
    })

    test('right-click on grade cell opens menu and prevents default', () => {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()

      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      const event = rightClick(gradeCell)
      expect(event.defaultPrevented).toBe(true)
      expect(getMenu()).not.toBeNull()
      expect(rowFor('Kohal')).not.toBeNull()
      expect(rowFor('5')).not.toBeNull()
    })

    test('right-click on outcome (O) cell shows menu without absence section', () => {
      const entry = {
        id: 11,
        curriculumModuleOutcomes: 55761,
        entryType: 'SISSEKANNE_O',
        entryDate: null,
        studentOutcomeResults: { '5': { grade: { code: 'KUTSEHINDAMINE_4', value: '4' } } }
      }
      buildTable({
        entries: [{ headerText: 'ÕV1' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()

      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      rightClick(gradeCell)
      expect(getMenu()).not.toBeNull()
      expect(rowFor('Kohal')).toBeNull()
      expect(rowFor('Puudus')).toBeNull()
      // Tick on current grade
      const mark = rowFor('4').querySelector('.oa2-cell-context-menu-mark')
      expect(mark.textContent).toBe('✓')
    })

    test('right-click on a tooltip overlay falls back to the underlying cell via elementsFromPoint', () => {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()

      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      // Simulate Tahvel's tooltip-body element rendered into document.body
      // (not a descendant of the TD). Right-click target is this element.
      const tooltip = document.createElement('div')
      tooltip.className = 'fake-tahvel-tooltip-body'
      document.body.appendChild(tooltip)

      // Stub elementsFromPoint to return [tooltip, gradeCell] — what a real
      // browser returns when the tooltip overlays the cell.
      document.elementsFromPoint = () => [tooltip, gradeCell]

      const event = rightClick(tooltip)
      expect(event.defaultPrevented).toBe(true)
      expect(getMenu()).not.toBeNull()
    })

    test('right-click while quick-update select is open is ignored', () => {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()

      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      const select = document.createElement('select')
      select.className = 'grade-select'
      gradeCell.appendChild(select)

      const event = rightClick(gradeCell)
      expect(event.defaultPrevented).toBe(false)
      expect(getMenu()).toBeNull()
    })
  })

  describe('mutation flow (T entry)', () => {
    function setupSingleStudentTable({ grade = null, absence = null } = {}) {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      if (grade || absence) {
        entry.journalStudentResults['50'] = [{ grade, absence }]
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      return { entry, gradeCell }
    }

    test('picking "5" PUTs journalEntry with the target student added when missing from existing entry', async () => {
      const { entry, gradeCell } = setupSingleStudentTable()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        nameEt: 'Lesson',
        entryDate: '2026-04-13T00:00:00Z',
        startLessonNr: 1,
        lessons: 1,
        content: null,
        homework: null,
        journalEntryCapacityTypes: ['MAHT_a'],
        journalEntryTeachers: [22816],
        isTest: false,
        journalEntryStudents: []
      }))

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      expect(feature.api.tahvel.put).toHaveBeenCalledTimes(1)
      const [url, payload] = feature.api.tahvel.put.mock.calls[0]
      expect(url).toBe('/journals/123/journalEntry/10')
      // Payload must be Tahvel's stripped shape — no version, no id at the top.
      expect(payload).not.toHaveProperty('version')
      expect(payload).not.toHaveProperty('id')
      expect(payload).not.toHaveProperty('inserted')
      expect(payload.entryType).toBe('SISSEKANNE_T')
      expect(payload.journalEntryStudents).toHaveLength(1)
      const studentRow = payload.journalEntryStudents[0]
      expect(studentRow.id).toBeNull()
      expect(studentRow.journalStudent).toBe(50)
      expect(studentRow.isMicro).toBe(false)
      expect(studentRow.grade.code).toBe('KUTSEHINDAMINE_5')
      expect(studentRow.absence).toBeNull()
      // Normal grade picks keep history (matches Tahvel UI). Only the
      // explicit "Eemalda hinne" action wipes history.
      expect(studentRow.removeStudentHistory).toBe(false)
      expect(studentRow).not.toHaveProperty('studentName')
      expect(studentRow).not.toHaveProperty('gradeValue')
      expect(cacheService.clearJournalCache).toHaveBeenCalledWith(123)
      expect(entry.journalStudentResults['50'][0].grade.code).toBe('KUTSEHINDAMINE_5')
    })

    test('PUT preserves the state of all other students in the entry (id: null on every row)', async () => {
      const { gradeCell } = setupSingleStudentTable()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        nameEt: 'Lesson',
        entryDate: '2026-04-13T00:00:00Z',
        startLessonNr: 1,
        lessons: 1,
        content: null,
        homework: null,
        journalEntryCapacityTypes: ['MAHT_a'],
        journalEntryTeachers: [22816],
        isTest: false,
        journalEntryStudents: [
          { id: 100, journalStudent: 50, grade: null, absence: null, isMicro: false },
          { id: 101, journalStudent: 51, grade: { code: 'KUTSEHINDAMINE_4', value: '4' }, absence: null, isMicro: false },
          { id: 102, journalStudent: 52, grade: null, absence: 'PUUDUMINE_P', isMicro: false }
        ]
      }))

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      const payload = feature.api.tahvel.put.mock.calls[0][1]
      expect(payload.journalEntryStudents).toHaveLength(3)
      // Each row's id is preserved from the existing entry — Tahvel rejects
      // dropping ids that already exist in the DB with 412.
      const idsById = Object.fromEntries(payload.journalEntryStudents.map(r => [r.journalStudent, r.id]))
      expect(idsById[50]).toBe(100)
      expect(idsById[51]).toBe(101)
      expect(idsById[52]).toBe(102)
      // Normal grade picks don't wipe history on any row.
      payload.journalEntryStudents.forEach(row => expect(row.removeStudentHistory).toBe(false))
      // Target student gets the new grade
      const target = payload.journalEntryStudents.find(r => r.journalStudent === 50)
      expect(target.grade.code).toBe('KUTSEHINDAMINE_5')
      // Other students retain their state
      const other = payload.journalEntryStudents.find(r => r.journalStudent === 51)
      expect(other.grade.code).toBe('KUTSEHINDAMINE_4')
      const absent = payload.journalEntryStudents.find(r => r.journalStudent === 52)
      expect(absent.absence).toBe('PUUDUMINE_P')
    })

    test('picking "Hinne puudub" sends grade: null but preserves history (soft clear)', async () => {
      const prior = { code: 'KUTSEHINDAMINE_5', value: '5' }
      const { gradeCell } = setupSingleStudentTable({ grade: prior })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade: prior, absence: null, isMicro: false }
        ]
      }))

      rightClick(gradeCell)
      rowFor('Hinne puudub').click()
      await new Promise(r => setTimeout(r, 0))

      const studentRow = feature.api.tahvel.put.mock.calls[0][1].journalEntryStudents[0]
      expect(studentRow.grade).toBeNull()
      // Soft clear: history stays. Use "Eemalda hinne" for the destructive
      // wipe.
      expect(studentRow.removeStudentHistory).toBe(false)
    })

    test('"Eemalda hinne" row appears only when the student currently has a grade', () => {
      const withGrade = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: '5',
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      const noGrade = feature._buildMenuModel({
        entry: { entryType: 'SISSEKANNE_T' },
        currentGradeLabel: null,
        currentAbsenceCode: null,
        isAcademicLeave: false
      })
      expect(withGrade.some(item => item.kind === 'clearGrade')).toBe(true)
      expect(noGrade.some(item => item.kind === 'clearGrade')).toBe(false)
    })

    test('picking "Eemalda hinne" sends grade: null with removeStudentHistory: true', async () => {
      const prior = { code: 'KUTSEHINDAMINE_5', value: '5' }
      const { gradeCell } = setupSingleStudentTable({ grade: prior })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade: prior, absence: 'PUUDUMINE_P', isMicro: false }
        ]
      }))

      rightClick(gradeCell)
      const clearRow = Array.from(document.querySelectorAll('.oa2-cell-context-menu-row'))
        .find(r => r.dataset.kind === 'clearGrade')
      expect(clearRow).toBeTruthy()
      clearRow.click()
      await new Promise(r => setTimeout(r, 0))

      const studentRow = feature.api.tahvel.put.mock.calls[0][1].journalEntryStudents[0]
      expect(studentRow.grade).toBeNull()
      expect(studentRow.removeStudentHistory).toBe(true)
      // Eemalda hinne touches grade only — existing absence is preserved.
      expect(studentRow.absence).toBe('PUUDUMINE_P')
    })

    test('picking "X" sends grade: KUTSEHINDAMINE_X (X is a real grade code)', async () => {
      const { gradeCell } = setupSingleStudentTable()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: []
      }))

      rightClick(gradeCell)
      rowFor('X').click()
      await new Promise(r => setTimeout(r, 0))

      const payload = feature.api.tahvel.put.mock.calls[0][1]
      expect(payload.journalEntryStudents[0].grade.code).toBe('KUTSEHINDAMINE_X')
    })

    test('picking "Puudus" on a graded student sets absence and PRESERVES the grade', async () => {
      const grade = { code: 'KUTSEHINDAMINE_4', value: '4' }
      const { gradeCell } = setupSingleStudentTable({ grade })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade, absence: null }
        ]
      }))

      rightClick(gradeCell)
      rowFor('Puudus').click()
      await new Promise(r => setTimeout(r, 0))

      const payload = feature.api.tahvel.put.mock.calls[0][1]
      const studentRow = payload.journalEntryStudents[0]
      expect(studentRow.absence).toBe('PUUDUMINE_P')
      // Tahvel allows grade + absence simultaneously (renders as "P / 4").
      // Picking Puudus must NOT wipe a grade the teacher already entered.
      expect(studentRow.grade).toEqual(grade)
    })

    test('picking "Kohal" sends absence: null and keeps the grade', async () => {
      const grade = { code: 'KUTSEHINDAMINE_4', value: '4' }
      const { gradeCell } = setupSingleStudentTable({ absence: 'PUUDUMINE_P' })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade, absence: 'PUUDUMINE_P' }
        ]
      }))

      rightClick(gradeCell)
      rowFor('Kohal').click()
      await new Promise(r => setTimeout(r, 0))

      const studentRow = feature.api.tahvel.put.mock.calls[0][1].journalEntryStudents[0]
      expect(studentRow.absence).toBeNull()
      expect(studentRow.grade).toEqual(grade)
    })

    test('picking a real grade on an absent student PRESERVES the absence', async () => {
      const { gradeCell } = setupSingleStudentTable({ absence: 'PUUDUMINE_P' })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade: null, absence: 'PUUDUMINE_P' }
        ]
      }))

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      const studentRow = feature.api.tahvel.put.mock.calls[0][1].journalEntryStudents[0]
      expect(studentRow.grade.code).toBe('KUTSEHINDAMINE_5')
      // grade and absence are independent — picking a grade must NOT wipe
      // the absence the teacher already set.
      expect(studentRow.absence).toBe('PUUDUMINE_P')
    })

    test('picking "Hinne puudub" on an absent student keeps the absence', async () => {
      const grade = { code: 'KUTSEHINDAMINE_5', value: '5' }
      const { gradeCell } = setupSingleStudentTable({ grade, absence: 'PUUDUMINE_P' })
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [
          { id: 7, journalStudent: 50, grade, absence: 'PUUDUMINE_P' }
        ]
      }))

      rightClick(gradeCell)
      rowFor('Hinne puudub').click()
      await new Promise(r => setTimeout(r, 0))

      const studentRow = feature.api.tahvel.put.mock.calls[0][1].journalEntryStudents[0]
      expect(studentRow.grade).toBeNull()
      expect(studentRow.absence).toBe('PUUDUMINE_P')
    })

    test('PUT failure restores cell content and shows a toast; cache is not cleared', async () => {
      const { gradeCell } = setupSingleStudentTable()
      gradeCell.textContent = 'A'
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: []
      }))
      feature.api.tahvel.put = mock(async () => {
        throw new Error('API Error: 500')
      })

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      expect(gradeCell.textContent).toBe('A')
      expect(document.querySelector('.oa2-cell-toast')).not.toBeNull()
      expect(cacheService.clearJournalCache).not.toHaveBeenCalled()
    })

    test('failure toast surfaces the HTTP status code', async () => {
      const { gradeCell } = setupSingleStudentTable()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: []
      }))
      const err = new Error('API Error: 400 (validation failed)')
      err.status = 400
      feature.api.tahvel.put = mock(async () => { throw err })

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      const toast = document.querySelector('.oa2-cell-toast')
      expect(toast).not.toBeNull()
      expect(toast.textContent).toContain('HTTP 400')
      expect(toast.textContent).toContain('validation failed')
    })

    test('412 response invalidates local cache and shows the "changed elsewhere" message', async () => {
      const { gradeCell } = setupSingleStudentTable()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: []
      }))
      const err = new Error('API Error: 412')
      err.status = 412
      feature.api.tahvel.put = mock(async () => { throw err })

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      expect(document.querySelector('.oa2-cell-toast').textContent).toContain('vahepeal muutunud')
      expect(feature._journalEntries).toEqual([])
    })
  })

  describe('optimistic paint transition label (Tahvel-compatible)', () => {
    function setupWithCurrent({ grade = null, absence = null, cellText = '' } = {}) {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      if (grade || absence) {
        entry.journalStudentResults['50'] = [{ grade, absence }]
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      feature.api.tahvel.get = mock(async () => ({
        entryType: 'SISSEKANNE_T',
        journalEntryStudents: [{ id: 7, journalStudent: 50, grade, absence, isMicro: false }]
      }))
      const cell = document.querySelector('tbody tr td:nth-child(3)')
      // Simulate Tahvel's rendered state in the cell — the optimistic paint
      // now reads textContent for the prior visible state.
      if (cellText) cell.textContent = cellText
      return cell
    }

    test('grade → new grade paints "old*/new"', async () => {
      const gradeCell = setupWithCurrent({ grade: { code: 'KUTSEHINDAMINE_3', value: '3' }, cellText: '3' })
      rightClick(gradeCell)
      rowFor('5').click()
      expect(gradeCell.textContent).toBe('3*/5')
      await new Promise(r => setTimeout(r, 0))
    })

    test('grade → "Hinne puudub" paints "old*/"', async () => {
      const gradeCell = setupWithCurrent({ grade: { code: 'KUTSEHINDAMINE_4', value: '4' }, cellText: '4' })
      rightClick(gradeCell)
      rowFor('Hinne puudub').click()
      expect(gradeCell.textContent).toBe('4*/')
      await new Promise(r => setTimeout(r, 0))
    })

    test('no prior grade → pick grade paints just "5"', async () => {
      const gradeCell = setupWithCurrent()
      rightClick(gradeCell)
      rowFor('5').click()
      expect(gradeCell.textContent).toBe('5')
      await new Promise(r => setTimeout(r, 0))
    })

    test('"Eemalda hinne" wipes the cell, no strike-through', async () => {
      const gradeCell = setupWithCurrent({ grade: { code: 'KUTSEHINDAMINE_5', value: '5' }, cellText: '5' })
      rightClick(gradeCell)
      const clearRow = Array.from(document.querySelectorAll('.oa2-cell-context-menu-row'))
        .find(r => r.dataset.kind === 'clearGrade')
      clearRow.click()
      expect(gradeCell.textContent).toBe('')
      await new Promise(r => setTimeout(r, 0))
    })

    test('prior grade → pick Puudus paints "3*/P" (chain extends; grade not cleared by us)', async () => {
      // Tahvel renders the eventual state as "P / 3" (absence first, then
      // grade, slash separator), but our optimistic paint appends "*/P" to
      // the prior text — close enough to communicate "absence got added"
      // until Tahvel re-renders on next refresh. Server-side the grade is
      // preserved.
      const gradeCell = setupWithCurrent({ grade: { code: 'KUTSEHINDAMINE_3', value: '3' }, cellText: '3' })
      rightClick(gradeCell)
      rowFor('Puudus').click()
      expect(gradeCell.textContent).toBe('3*/P')
      await new Promise(r => setTimeout(r, 0))
    })

    test('prior absence → pick Kohal paints "P*/"', async () => {
      const gradeCell = setupWithCurrent({ absence: 'PUUDUMINE_P', cellText: 'P' })
      rightClick(gradeCell)
      rowFor('Kohal').click()
      expect(gradeCell.textContent).toBe('P*/')
      await new Promise(r => setTimeout(r, 0))
    })

    test('no prior state → pick Puudus paints just "P"', async () => {
      const gradeCell = setupWithCurrent()
      rightClick(gradeCell)
      rowFor('Puudus').click()
      expect(gradeCell.textContent).toBe('P')
      await new Promise(r => setTimeout(r, 0))
    })

    test('multi-history chain (X*/2*/3) → pick 5 paints "X*/2*/3*/5"', async () => {
      // Tahvel can render whitespace-padded "X * /  2 * /  3" — we normalize.
      const gradeCell = setupWithCurrent({
        grade: { code: 'KUTSEHINDAMINE_3', value: '3' },
        cellText: 'X * /  2 * /  3'
      })
      rightClick(gradeCell)
      rowFor('5').click()
      expect(gradeCell.textContent).toBe('X*/2*/3*/5')
      await new Promise(r => setTimeout(r, 0))
    })

    test('PUT failure rolls back to the original snapshot, including multi-history text', async () => {
      const gradeCell = setupWithCurrent({
        grade: { code: 'KUTSEHINDAMINE_3', value: '3' },
        cellText: '4*/3'
      })
      feature.api.tahvel.put = mock(async () => {
        const err = new Error('API Error: 500')
        err.status = 500
        throw err
      })
      rightClick(gradeCell)
      rowFor('5').click()
      // optimistic paint
      expect(gradeCell.textContent).toBe('4*/3*/5')
      await new Promise(r => setTimeout(r, 0))
      // rolled back
      expect(gradeCell.textContent).toBe('4*/3')
    })
  })

  describe('mutation flow (O entry)', () => {
    test('first-time grade on outcome (no prior row) POSTs the 5-field create shape — no id/version', async () => {
      const entry = {
        id: 11,
        curriculumModuleOutcomes: 55761,
        entryType: 'SISSEKANNE_O',
        studentOutcomeResults: {}
      }
      buildTable({
        entries: [{ headerText: 'ÕV1' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      // GET on the outcome returns no outcomeStudents → first-time create path.
      feature.api.tahvel.get = mock(async () => ({ id: 55761, outcomeStudents: [] }))
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')

      rightClick(gradeCell)
      rowFor('5').click()
      await new Promise(r => setTimeout(r, 0))

      expect(feature.api.tahvel.post).toHaveBeenCalledTimes(1)
      const [url, payload] = feature.api.tahvel.post.mock.calls[0]
      expect(url).toBe('/journals/123/journalOutcome/55761')
      const outcomeStudent = payload.outcomeStudents[0]
      // On create: id/version omitted; the 5-field shape Tahvel accepts.
      expect(Object.keys(outcomeStudent).sort()).toEqual(
        ['addInfo', 'grade', 'gradeDate', 'removeStudentHistory', 'studentId'].sort()
      )
      expect(outcomeStudent.studentId).toBe(5)
      expect(outcomeStudent.grade.code).toBe('KUTSEHINDAMINE_5')
      expect(outcomeStudent.gradeDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/)
      expect(outcomeStudent.removeStudentHistory).toBe(false)
      expect(outcomeStudent.addInfo).toBeNull()
      expect(cacheService.clearJournalCache).toHaveBeenCalledWith(123)
    })

    test('updating an existing outcome grade attaches id+version (avoids 412 main.messages.error.unique)', async () => {
      const entry = {
        id: 11,
        curriculumModuleOutcomes: 55761,
        entryType: 'SISSEKANNE_O',
        studentOutcomeResults: {}
      }
      buildTable({
        entries: [{ headerText: 'ÕV1' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      // GET on the outcome returns an existing row with id+version — Tahvel
      // needs both echoed back on update, otherwise it tries to INSERT and
      // hits the (studentId,outcomeId) unique constraint.
      feature.api.tahvel.get = mock(async () => ({
        id: 55761,
        outcomeStudents: [{
          id: 1319926,
          version: 1,
          studentId: 5,
          grade: { code: 'KUTSEHINDAMINE_5' },
          gradeDate: '2026-05-22T00:00:00Z'
        }]
      }))
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')

      rightClick(gradeCell)
      rowFor('3').click()
      await new Promise(r => setTimeout(r, 0))

      const outcomeStudent = feature.api.tahvel.post.mock.calls[0][1].outcomeStudents[0]
      expect(outcomeStudent.id).toBe(1319926)
      expect(outcomeStudent.version).toBe(1)
      expect(outcomeStudent.grade.code).toBe('KUTSEHINDAMINE_3')
      // gradeDate from the existing row is reused verbatim.
      expect(outcomeStudent.gradeDate).toBe('2026-05-22T00:00:00Z')
    })

    test('picking "Eemalda hinne" on an outcome sends grade: null with removeStudentHistory: true', async () => {
      const existingGrade = { code: 'KUTSEHINDAMINE_5', value: '5' }
      const entry = {
        id: 11,
        curriculumModuleOutcomes: 55761,
        entryType: 'SISSEKANNE_O',
        studentOutcomeResults: { '5': { grade: existingGrade, gradeDate: '2025-09-01T00:00:00.000Z' } }
      }
      buildTable({
        entries: [{ headerText: 'ÕV1' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      feature.api.tahvel.get = mock(async () => ({
        id: 55761,
        outcomeStudents: [{
          id: 1319926,
          version: 2,
          studentId: 5,
          grade: existingGrade,
          gradeDate: '2025-09-01T00:00:00.000Z'
        }]
      }))
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')

      rightClick(gradeCell)
      const clearRow = Array.from(document.querySelectorAll('.oa2-cell-context-menu-row'))
        .find(r => r.dataset.kind === 'clearGrade')
      expect(clearRow).toBeTruthy()
      clearRow.click()
      await new Promise(r => setTimeout(r, 0))

      const outcomeStudent = feature.api.tahvel.post.mock.calls[0][1].outcomeStudents[0]
      expect(outcomeStudent.grade).toBeNull()
      expect(outcomeStudent.removeStudentHistory).toBe(true)
      expect(outcomeStudent.id).toBe(1319926)
      expect(outcomeStudent.version).toBe(2)
      // Reuses the existing gradeDate when present.
      expect(outcomeStudent.gradeDate).toBe('2025-09-01T00:00:00.000Z')
    })
  })

  describe('menu close behavior', () => {
    function openMenu() {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')
      rightClick(gradeCell)
      return gradeCell
    }

    test('Escape closes the menu', () => {
      openMenu()
      expect(getMenu()).not.toBeNull()
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
      expect(getMenu()).toBeNull()
    })

    test('mousedown outside the menu closes it', () => {
      openMenu()
      const evt = new window.MouseEvent('mousedown', { bubbles: true })
      document.body.dispatchEvent(evt)
      expect(getMenu()).toBeNull()
    })

    test('scroll closes the menu', () => {
      openMenu()
      window.dispatchEvent(new window.Event('scroll'))
      expect(getMenu()).toBeNull()
    })

    test('a second right-click replaces the menu', () => {
      const gradeCell = openMenu()
      const firstMenu = getMenu()
      rightClick(gradeCell, { clientX: 200, clientY: 200 })
      const currentMenu = getMenu()
      expect(currentMenu).not.toBe(firstMenu)
    })
  })

  describe('viewport clamping', () => {
    test('menu near right/bottom edge is repositioned inside the viewport', () => {
      const entry = {
        id: 10,
        entryType: 'SISSEKANNE_T',
        entryDate: '2025-03-25',
        journalStudentResults: {}
      }
      buildTable({
        entries: [{ headerText: '25.03' }],
        rows: [{ studentId: 5, name: 'Õpilane' }]
      })
      attachJournalState(feature, [entry], [{ id: 50, studentId: 5 }])
      feature.onActivate()
      const gradeCell = document.querySelector('tbody tr td:nth-child(3)')

      Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true })

      const originalAppend = document.body.appendChild.bind(document.body)
      let menuEl = null
      document.body.appendChild = function (el) {
        if (el?.classList?.contains?.('oa2-cell-context-menu')) {
          menuEl = el
          el.getBoundingClientRect = () => ({ width: 200, height: 200 })
        }
        return originalAppend(el)
      }

      try {
        rightClick(gradeCell, { clientX: 380, clientY: 280 })
        expect(menuEl).not.toBeNull()
        const left = parseFloat(menuEl.style.left)
        const top = parseFloat(menuEl.style.top)
        expect(left).toBeLessThanOrEqual(400 - 200)
        expect(top).toBeLessThanOrEqual(300 - 200)
      } finally {
        document.body.appendChild = originalAppend
      }
    })
  })
})
