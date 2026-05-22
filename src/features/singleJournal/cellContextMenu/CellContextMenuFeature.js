// Right-click context menu for Tahvel journal grade cells.
//
// Limitations:
// - When two teachers edit the same student row on the same entry concurrently,
//   the second PUT wins (matches Tahvel's own UI semantics). The GET-before-PUT
//   pulls Tahvel's latest snapshot, but a same-cell edit landing between our
//   GET and PUT is overwritten.

import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { cacheService } from '../../../services/CacheService.js'
import { getNativeJournalHeaderCells } from '../../../lib/journalTableHeaders.js'
import { findEntryIndexForHeader } from '../../../lib/journalEntryColumnMatcher.js'

const STYLE_ID = 'oa2-cell-context-menu-style'

const POSITIVE_LABELS = new Set(['A', '3', '4', '5'])
const NEGATIVE_LABELS = new Set(['MA', '1', '2', 'X'])

const GRADE_LABELS = ['Hinne puudub', '1', '2', '3', '4', '5', 'A', 'MA', 'X']
const ABSENCE_LABELS = ['Kohal', 'Puudus']
const CLEAR_GRADE_LABEL = 'Eemalda hinne'

// Tahvel entry types that have a real attendance concept.
// L (final grade) and O (outcome) do not — the menu hides Kohal/Puudus there.
const ATTENDANCE_ENTRY_TYPES = new Set([
  'SISSEKANNE_T',
  'SISSEKANNE_I',
  'SISSEKANNE_P',
  'SISSEKANNE_H'
])

const OUTCOME_ENTRY_TYPES = new Set(['SISSEKANNE_O'])

function getApiErrorStatus(error) {
  return error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1])
}

// ApiService throws Errors shaped "API Error: <status> (<details>)" or
// "API Error: <status> <statusText>". Extract the details part for display.
function extractErrorDetail(error) {
  const message = error?.message || ''
  const inParens = message.match(/API Error:\s*\d+\s*\(([^]*?)\)\s*$/)
  if (inParens) return inParens[1].trim().slice(0, 300)
  const trailing = message.match(/API Error:\s*\d+\s+(.+)$/)
  if (trailing) return trailing[1].trim().slice(0, 300)
  return ''
}

function normalizeGradeLabel(value) {
  return (value || '').replace(/\s+/g, ' ').trim().toUpperCase()
}

// Extract '5' from 'KUTSEHINDAMINE_5'. Falls back to the value field.
function gradeCodeToLabel(grade) {
  if (!grade) return null
  if (grade.code) {
    const suffix = String(grade.code).split('_').pop()
    if (suffix) return normalizeGradeLabel(suffix)
  }
  if (grade.value != null) return normalizeGradeLabel(grade.value)
  return null
}

function buildGradePayload(label) {
  if (label === 'Hinne puudub') return null
  if (!GRADE_LABELS.includes(label)) return null
  // X is a real grade code (KUTSEHINDAMINE_X), not a "clear grade" sentinel.
  const value = label
  return {
    code: `KUTSEHINDAMINE_${value}`,
    gradingSchemaRowId: null,
    value: String(value),
    value2: String(value),
    extraval1: null,
    extraval2: null,
    nameEt: `Hinne ${value}`,
    nameEn: `Grade ${value}`,
    valid: true
  }
}

function buildAbsencePayload(label) {
  if (label === 'Kohal') return null
  // Tahvel's UI sends PUUDUMINE_P (põhjuseta puudumine / unexcused) when the
  // teacher hits the plain "Puudus" toggle. PUUDUMINE_H exists too (haigus —
  // sick) but isn't the default and requires a medical justification flow.
  if (label === 'Puudus') return 'PUUDUMINE_P'
  return undefined
}

// Tahvel's PUT for a journalEntry rejects payloads that echo back
// version/id/inserted/teacherSelection (those cause 500 on freshly-created
// entries) but also rejects payloads that drop fields the entry actually
// uses — e.g. SISSEKANNE_P with a homework link requires homeworkDuedate to
// be present, otherwise it 412s with "must not be null". The whitelist
// below covers everything Tahvel's own dialog sends across entry types we
// support, preserving each value as the GET returned it.
function buildJournalEntryPutPayload(current, journalEntryStudents) {
  return {
    entryType: current.entryType,
    nameEt: current.nameEt ?? null,
    entryDate: current.entryDate ?? null,
    startLessonNr: current.startLessonNr ?? null,
    lessons: current.lessons ?? null,
    content: current.content ?? null,
    homework: current.homework ?? null,
    homeworkDuedate: current.homeworkDuedate ?? null,
    moodleGradeItemId: current.moodleGradeItemId ?? null,
    isSubstitute: Boolean(current.isSubstitute),
    journalEntryCapacityTypes: Array.isArray(current.journalEntryCapacityTypes)
      ? current.journalEntryCapacityTypes
      : [],
    journalEntryTeachers: Array.isArray(current.journalEntryTeachers)
      ? current.journalEntryTeachers
      : [],
    isTest: Boolean(current.isTest),
    journalOmoduleTheme: current.journalOmoduleTheme ?? null,
    studyPeriodEvent: current.studyPeriodEvent ?? null,
    journalEntryStudents
  }
}

// Tahvel's native UI sends the row whitelist shape below. We preserve the
// existing row's id (Tahvel's first-save curl had id: null only because no
// rows existed yet). For rows we are *changing*, set removeStudentHistory:
// true — otherwise Tahvel keeps the old grade in history and a subsequent
// "Hinne puudub" leaves the prior grade attached (mirrors
// JournalListSync.js:3730). Untouched rows keep removeStudentHistory: false.
function buildJournalEntryStudentRow(source, overrides = {}) {
  return {
    id: source.id ?? null,
    journalStudent: Number(source.journalStudent),
    isMicro: Boolean(source.isMicro),
    absence: 'absence' in overrides ? overrides.absence : source.absence ?? null,
    grade: 'grade' in overrides ? overrides.grade : source.grade ?? null,
    verbalGrade: source.verbalGrade ?? null,
    removeStudentHistory: 'removeStudentHistory' in overrides
      ? Boolean(overrides.removeStudentHistory)
      : false,
    addInfo: source.addInfo ?? null,
    hasOverlappingLessonAbsence: Boolean(source.hasOverlappingLessonAbsence),
    isPraise: Boolean(source.isPraise),
    isRemark: Boolean(source.isRemark),
    isLessonAbsence: Boolean(source.isLessonAbsence),
    lessonAbsences: source.lessonAbsences && typeof source.lessonAbsences === 'object'
      ? source.lessonAbsences
      : {}
  }
}

function todayAtMidnightIsoUtc() {
  // Tahvel's outcome PUT requires gradeDate as full ISO datetime at midnight
  // UTC, e.g. "2026-05-22T00:00:00.000Z". A date-only "2026-05-22" is
  // rejected.
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`
}

// Tahvel chains every grade/absence change as a history sequence like
// "X*/2*/3" (current value is the last one; earlier ones are struck through).
// To match Tahvel's eventual render exactly — at any depth of history — we
// take the cell's current textContent as the prior state (Tahvel already
// rendered any chain into it) and append "*/<new>" or "*/" for soft-clear.
function buildTransitionLabel(priorVisible, newVisible) {
  const prior = priorVisible || ''
  const next = newVisible || ''
  if (prior && next) return `${prior}*/${next}`
  if (prior && !next) return `${prior}*/`
  return next
}

// Collapse Tahvel's whitespace ("X * /  2 * /  3" → "X*/2*/3") so the prior
// label is a clean canonical form.
function readCellLabel(cell) {
  return (cell?.textContent || '').replace(/\s+/g, '').trim()
}

// Extract the short suffix of an absence code ("PUUDUMINE_P" → "P") for
// display.
function absenceCodeToSuffix(code) {
  if (!code) return ''
  const suffix = String(code).split('_').pop()
  return suffix || ''
}

function snapshotChildren(cell) {
  return Array.from(cell.childNodes).map(node => node.cloneNode(true))
}

function restoreChildren(cell, snapshot) {
  while (cell.firstChild) cell.removeChild(cell.firstChild)
  snapshot.forEach(node => cell.appendChild(node))
}

class CellContextMenuFeature extends BaseFeature {
  constructor() {
    super('cellContextMenu', /#\/journal\/\d+\/edit/)
    this._contextListener = null
    this._closeListeners = null
    this._menuEl = null
    this._toastEl = null
    this._toastTimeoutId = null
    this._entriesPromise = null
    this._journalEntries = []
    this._studentIdToJournalStudentId = new Map()
    this._loadedJournalId = null
    this._busy = false
  }

  onActivate() {
    this._injectCSS()
    this._contextListener = event => this._handleContextMenu(event)
    document.addEventListener('contextmenu', this._contextListener, true)
    // Kick off prefetch; first right-click can wait if it lands earlier.
    void this._loadJournalData()
  }

  onDeactivate() {
    if (this._contextListener) {
      document.removeEventListener('contextmenu', this._contextListener, true)
      this._contextListener = null
    }
    this._closeMenu()
    this._removeToast()
    styleService.removeCSS(STYLE_ID)
    this._entriesPromise = null
    this._journalEntries = []
    this._studentIdToJournalStudentId = new Map()
    this._loadedJournalId = null
  }

  _injectCSS() {
    styleService.injectCSS(
      `
        .oa2-cell-context-menu {
          position: fixed;
          z-index: 2147483647;
          background: #ffffff;
          color: #222;
          border: 1px solid #c5c5c5;
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          padding: 4px 0;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.4;
          min-width: 160px;
          user-select: none;
        }

        .oa2-cell-context-menu-row {
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 4px 0;
        }

        .oa2-cell-context-menu-row:hover {
          background-color: rgba(13, 110, 253, 0.12);
        }

        .oa2-cell-context-menu-mark {
          width: 22px;
          flex: 0 0 22px;
          text-align: center;
          color: #2e7d32;
          font-weight: 600;
        }

        .oa2-cell-context-menu-label {
          flex: 1 1 auto;
          padding-right: 16px;
          color: #222;
        }

        .oa2-cell-context-menu-label--positive {
          color: #0b7a4b;
        }

        .oa2-cell-context-menu-label--negative {
          color: #9d2c25;
        }

        .oa2-cell-context-menu-separator {
          border-top: 1px solid #e5e7eb;
          margin: 4px 0;
          height: 0;
        }

        .oa2-cell-toast {
          position: fixed;
          z-index: 2147483647;
          background: #b91c1c;
          color: #fff;
          padding: 8px 14px;
          border-radius: 4px;
          font-size: 13px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
          pointer-events: none;
          max-width: 360px;
        }
      `,
      STYLE_ID
    )
  }

  // --- Right-click resolution ----------------------------------------------

  _handleContextMenu(event) {
    // Right-clicking inside our own menu must never fall through to the
    // browser's native context menu.
    if (this._menuEl && this._menuEl.contains(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const context = this._resolveCellContext(event.target, event)
    if (!context) return

    event.preventDefault()
    event.stopPropagation()

    if (this._busy) return

    const { cell, entry, journalStudentId, studentId } = context
    const model = this._buildMenuModel({
      entry,
      currentGradeLabel: this._getCurrentGradeLabel(entry, journalStudentId, studentId),
      currentAbsenceCode: this._getCurrentAbsenceCode(entry, journalStudentId),
      isAcademicLeave: this._isAcademicLeaveRow(cell.parentElement)
    })

    this._openMenu(model, event.clientX, event.clientY, context)
  }

  _resolveCellContext(target, event = null) {
    if (!target?.closest) return null
    const table = this._findJournalTable()
    if (!table) return null

    // Normal path: the right-click landed inside a TD.
    let cell = target.closest('td')

    // Fallback: Tahvel's <tahvel-tooltip> popup floats over grade cells. When
    // the user happens to right-click while the tooltip is visible, the event
    // target is the tooltip body (rendered outside the table) and
    // closest('td') returns null. Look beneath the cursor for the real cell.
    if ((!cell || !table.contains(cell)) && event && typeof document.elementsFromPoint === 'function') {
      const stack = document.elementsFromPoint(event.clientX, event.clientY)
      cell = stack.find(el => el.tagName === 'TD' && table.contains(el)) || null
    }

    if (!cell || !table.contains(cell)) return null

    if (this._hasOpenQuickUpdate(table)) return null

    const row = cell.parentElement
    if (!row || !row.parentElement || row.parentElement.tagName !== 'TBODY') return null

    const columnIndex = Array.from(row.children).indexOf(cell)
    const firstGradeColumnIndex = this._getFirstGradeColumnIndex(table)
    if (columnIndex < firstGradeColumnIndex) return null

    if (!this._journalEntries.length) return null

    const columnEntryIndexes = this._getColumnEntryIndexes(table, firstGradeColumnIndex)
    const entryIndex = columnEntryIndexes.get(columnIndex)
    if (entryIndex == null) return null
    const entry = this._journalEntries[entryIndex]
    if (!entry) return null
    if (!this._isSupportedEntryType(entry.entryType)) return null

    const studentId = this._getStudentIdFromRow(row)
    if (!studentId) return null

    const journalStudentId = this._studentIdToJournalStudentId.get(studentId) || null
    if (this._isJournalEntryType(entry.entryType) && !journalStudentId) return null

    return { cell, row, table, columnIndex, entry, studentId, journalStudentId }
  }

  _isSupportedEntryType(entryType) {
    return this._isJournalEntryType(entryType) || OUTCOME_ENTRY_TYPES.has(entryType)
  }

  _isJournalEntryType(entryType) {
    return ATTENDANCE_ENTRY_TYPES.has(entryType) || entryType === 'SISSEKANNE_L'
  }

  // --- Menu model ----------------------------------------------------------

  _buildMenuModel({ entry, currentGradeLabel, currentAbsenceCode, isAcademicLeave }) {
    const rows = []
    const showAttendance =
      ATTENDANCE_ENTRY_TYPES.has(entry?.entryType) && !isAcademicLeave

    if (showAttendance) {
      const isAbsent = Boolean(currentAbsenceCode)
      ABSENCE_LABELS.forEach(label => {
        const marked = label === 'Puudus' ? isAbsent : !isAbsent
        rows.push({ kind: 'absence', label, marked, color: null })
      })
      rows.push({ kind: 'separator' })
    }

    GRADE_LABELS.forEach(label => {
      const marked =
        label === 'Hinne puudub'
          ? !currentGradeLabel
          : currentGradeLabel === label
      const color = POSITIVE_LABELS.has(label)
        ? 'positive'
        : NEGATIVE_LABELS.has(label)
          ? 'negative'
          : null
      rows.push({ kind: 'grade', label, marked, color })
    })

    // Destructive "remove grade + history" action — separated visually and
    // marked red so it's clearly distinct from picking a value or "Hinne
    // puudub" (which soft-clears the grade column only).
    if (currentGradeLabel) {
      rows.push({ kind: 'separator' })
      rows.push({ kind: 'clearGrade', label: CLEAR_GRADE_LABEL, marked: false, color: 'negative' })
    }

    return rows
  }

  _getCurrentGradeLabel(entry, journalStudentId, studentId) {
    if (!entry) return null
    if (this._isJournalEntryType(entry.entryType)) {
      const results = entry.journalStudentResults?.[journalStudentId]
      const first = Array.isArray(results) ? results[0] : results
      return gradeCodeToLabel(first?.grade)
    }
    if (OUTCOME_ENTRY_TYPES.has(entry.entryType)) {
      const result = entry.studentOutcomeResults?.[studentId]
      return gradeCodeToLabel(result?.grade)
    }
    return null
  }

  _getCurrentAbsenceCode(entry, journalStudentId) {
    if (!entry || !this._isJournalEntryType(entry.entryType)) return null
    const results = entry.journalStudentResults?.[journalStudentId]
    const first = Array.isArray(results) ? results[0] : results
    return first?.absence || null
  }

  // --- Menu rendering ------------------------------------------------------

  _openMenu(model, clientX, clientY, context) {
    this._closeMenu()

    const menu = document.createElement('div')
    menu.className = 'oa2-cell-context-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('tabindex', '-1')

    model.forEach(item => {
      if (item.kind === 'separator') {
        const sep = document.createElement('div')
        sep.className = 'oa2-cell-context-menu-separator'
        menu.appendChild(sep)
        return
      }
      const rowEl = document.createElement('div')
      rowEl.className = 'oa2-cell-context-menu-row'
      rowEl.setAttribute('role', 'menuitem')
      rowEl.dataset.kind = item.kind
      rowEl.dataset.label = item.label

      const mark = document.createElement('span')
      mark.className = 'oa2-cell-context-menu-mark'
      mark.textContent = item.marked ? '✓' : ''

      const label = document.createElement('span')
      label.className = 'oa2-cell-context-menu-label'
      if (item.color === 'positive') label.classList.add('oa2-cell-context-menu-label--positive')
      if (item.color === 'negative') label.classList.add('oa2-cell-context-menu-label--negative')
      label.textContent = item.label

      rowEl.appendChild(mark)
      rowEl.appendChild(label)

      // Use mousedown so the row's listener runs before the document-level
      // "click outside" mousedown handler can decide to close. Guard against
      // re-entry from any other event the browser may also fire on the same
      // gesture (mouseup → click on a detached element).
      let picked = false
      const onPick = pickEvent => {
        if (picked) return
        picked = true
        pickEvent.preventDefault()
        pickEvent.stopPropagation()
        if (Logger.isDebugMode()) {
          Logger.debug(`[CellContextMenuFeature] picked ${item.kind}:${item.label}`)
        }
        this._closeMenu()
        void this._applyChange(context, item)
      }
      rowEl.addEventListener('mousedown', mouseEvent => {
        if (mouseEvent.button === 0) onPick(mouseEvent)
      })
      // Click stays as a backstop for assistive tech (e.g. keyboard activation
      // and screen readers that synthesise click without mousedown).
      rowEl.addEventListener('click', onPick)

      menu.appendChild(rowEl)
    })

    menu.style.left = `${clientX}px`
    menu.style.top = `${clientY}px`
    menu.style.visibility = 'hidden'
    document.body.appendChild(menu)
    this._menuEl = menu
    this._clampMenuToViewport(menu, clientX, clientY)
    menu.style.visibility = ''

    this._wireMenuCloseListeners()
  }

  _clampMenuToViewport(menu, clientX, clientY) {
    const rect = menu.getBoundingClientRect()
    const vw =
      (typeof window !== 'undefined' && window.innerWidth) ||
      document.documentElement.clientWidth ||
      0
    const vh =
      (typeof window !== 'undefined' && window.innerHeight) ||
      document.documentElement.clientHeight ||
      0

    let left = clientX
    let top = clientY
    if (rect.width && left + rect.width > vw) {
      left = Math.max(0, vw - rect.width - 4)
    }
    if (rect.height && top + rect.height > vh) {
      top = Math.max(0, vh - rect.height - 4)
    }
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  _wireMenuCloseListeners() {
    const onMouseDown = event => {
      if (this._menuEl && this._menuEl.contains(event.target)) return
      this._closeMenu()
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this._closeMenu()
      }
    }
    const onScrollResize = () => this._closeMenu()
    const onBlur = () => this._closeMenu()
    const onContext = event => {
      if (this._menuEl && this._menuEl.contains(event.target)) return
      // Let the document-level contextmenu handler take over (it may re-open
      // a new menu); close the current one first.
      this._closeMenu()
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('contextmenu', onContext, true)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize, true)
    window.addEventListener('blur', onBlur, true)

    this._closeListeners = {
      onMouseDown,
      onKeyDown,
      onScrollResize,
      onBlur,
      onContext
    }
  }

  _closeMenu() {
    if (this._menuEl) {
      this._menuEl.remove()
      this._menuEl = null
    }
    if (this._closeListeners) {
      const { onMouseDown, onKeyDown, onScrollResize, onBlur, onContext } = this._closeListeners
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('contextmenu', onContext, true)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize, true)
      window.removeEventListener('blur', onBlur, true)
      this._closeListeners = null
    }
  }

  // --- Mutation dispatch ---------------------------------------------------

  async _applyChange(context, item) {
    const { cell, entry, journalStudentId, studentId } = context
    const journalId = this._extractJournalId()
    if (!journalId) return

    this._busy = true

    // Read the prior visible state straight from the cell. Tahvel renders the
    // full history chain into textContent (e.g. "X*/2*/3" for three grades),
    // and reading from there extends the chain correctly at any depth.
    // Reading from in-memory journalStudentResults would only give us the
    // latest grade, dropping the history.
    const priorVisible = readCellLabel(cell)

    const childSnapshot = snapshotChildren(cell)
    const originalClasses = cell.className

    // Optimistic paint — match Tahvel's rendering format so the cell looks
    // identical after the next refresh and there's no visual flicker.
    const previewLabel = this._getPreviewLabel(item, priorVisible)
    if (previewLabel !== null) {
      cell.textContent = previewLabel
    }

    // Tell LessonDiscrepanciesFeature's PUT interceptor not to schedule its
    // 1.5s validation refresh — our PUT only touched grade/absence, capacity
    // can't have changed. Flag is window-scoped so the fetch wrapper in that
    // feature can read it.
    window.__oaCellContextMenuPutInFlight = true
    const releaseSuppression = setTimeout(() => {
      window.__oaCellContextMenuPutInFlight = false
    }, 2500)

    try {
      if (this._isJournalEntryType(entry.entryType)) {
        await this._mutateJournalEntry({
          journalId,
          entry,
          journalStudentId,
          item
        })
      } else if (OUTCOME_ENTRY_TYPES.has(entry.entryType)) {
        await this._mutateOutcome({
          journalId,
          entry,
          studentId,
          item
        })
      }

      await cacheService.clearJournalCache(journalId)
    } catch (error) {
      restoreChildren(cell, childSnapshot)
      cell.className = originalClasses

      const status = getApiErrorStatus(error)
      const detail = extractErrorDetail(error)
      if (status === 412) {
        // Tahvel reports a concurrent change — invalidate our cache so the
        // next right-click refetches. Surface the server's reason too, since
        // 412 is reused for several distinct validation failures (stale
        // version, row conflict, etc.).
        this._invalidateLocalCaches()
        const detailSuffix = detail ? `: ${detail}` : ''
        this._showToast(`Sissekanne on vahepeal muutunud (HTTP 412)${detailSuffix}`)
      } else {
        const statusSuffix = status ? ` (HTTP ${status})` : ''
        const detailSuffix = detail ? `: ${detail}` : ''
        this._showToast(`Salvestamine ebaõnnestus${statusSuffix}${detailSuffix}`)
      }
      // Always console.error so the user can grab the full error in DevTools
      // without enabling debug mode. Dump the exact payload + URL so it can
      // be diffed against Tahvel's own UI requests.
      try {
        // eslint-disable-next-line no-console
        console.error(
          '[CellContextMenuFeature] mutation failed',
          {
            status,
            errorMessage: error?.message,
            payloadItem: item,
            sentTo: this._lastPutPayload?.url,
            sentBody: this._lastPutPayload?.body
          }
        )
      } catch { /* ignore */ }
      Logger.error('[CellContextMenuFeature] mutation failed', error)
    } finally {
      this._busy = false
      clearTimeout(releaseSuppression)
      window.__oaCellContextMenuPutInFlight = false
    }
  }

  _getPreviewLabel(item, priorVisible = '') {
    // "Eemalda hinne" is destructive — it wipes history. The cell should
    // render empty, not as a strike-through transition.
    if (item.kind === 'clearGrade') return ''

    let newVisible = ''
    if (item.kind === 'grade') {
      // X is a real grade — paint it. Only "Hinne puudub" clears the grade.
      if (item.label !== 'Hinne puudub') newVisible = item.label
    } else if (item.kind === 'absence') {
      // Tahvel renders absence as the short suffix: "P" for PUUDUMINE_P,
      // "H" for PUUDUMINE_H. Kohal clears the absence.
      if (item.label !== 'Kohal') {
        const code = buildAbsencePayload(item.label)
        if (typeof code === 'string') newVisible = absenceCodeToSuffix(code)
      }
    } else {
      return null
    }

    // Render Tahvel's transition format when there's a prior value to mark
    // as struck-through.
    return buildTransitionLabel(priorVisible, newVisible)
  }

  async _mutateJournalEntry({ journalId, entry, journalStudentId, item }) {
    const detailUrl = `/journals/${journalId}/journalEntry/${entry.id}`
    const current = await this.api.tahvel.get(detailUrl, { allStudents: true }, { cache: false })
    if (!current) throw new Error('Failed to fetch current journal entry')

    const studentNumber = Number(journalStudentId)
    const existingStudents = Array.isArray(current.journalEntryStudents) ? current.journalEntryStudents : []
    const existing = existingStudents.find(s => Number(s.journalStudent) === studentNumber)

    // Tahvel treats grade and absence as INDEPENDENT fields — a cell can
    // legitimately carry both (e.g. "P / 3" means absent AND graded; common
    // when a teacher marks attendance separately from submitted work). Verified
    // empirically: a PUT with both fields set returns 200 and Tahvel renders
    // "P / 3". So each quick-action only touches its own field and preserves
    // the other.
    let desiredGrade = existing?.grade ?? null
    let desiredAbsence = existing?.absence ?? null
    if (item.kind === 'grade') {
      desiredGrade = buildGradePayload(item.label)
    } else if (item.kind === 'clearGrade') {
      desiredGrade = null
    } else if (item.kind === 'absence') {
      desiredAbsence = buildAbsencePayload(item.label)
    }

    // Only the destructive "Eemalda hinne" action sets removeStudentHistory:
    // true (matches JournalListSync.js:3730 for explicit clears). Soft
    // "Hinne puudub", new grade picks, and absence picks all leave history
    // intact — matching Tahvel's own UI on regular saves.
    const targetOverrides = {
      absence: desiredAbsence,
      grade: desiredGrade,
      removeStudentHistory: item.kind === 'clearGrade'
    }
    const journalEntryStudents = existingStudents.map(row =>
      Number(row.journalStudent) === studentNumber
        ? buildJournalEntryStudentRow(row, targetOverrides)
        : buildJournalEntryStudentRow(row)
    )
    if (!existing) {
      journalEntryStudents.push(buildJournalEntryStudentRow(
        { journalStudent: studentNumber },
        targetOverrides
      ))
    }

    const payload = buildJournalEntryPutPayload(current, journalEntryStudents)

    // Stash the most recent PUT payload so console diagnostics can show what
    // was sent if the server rejects it.
    this._lastPutPayload = { url: detailUrl, body: payload }

    await this.api.tahvel.put(detailUrl, payload)

    // Update in-memory cached entry so the next right-click reflects the new state.
    if (!entry.journalStudentResults) entry.journalStudentResults = {}
    const key = String(journalStudentId)
    const existingResults = Array.isArray(entry.journalStudentResults[key]) ? entry.journalStudentResults[key] : []
    const updated = {
      ...(existingResults[0] || {}),
      grade: desiredGrade,
      absence: desiredAbsence
    }
    entry.journalStudentResults[key] = [updated, ...existingResults.slice(1)]
  }

  async _mutateOutcome({ journalId, entry, studentId, item }) {
    if (item.kind !== 'grade' && item.kind !== 'clearGrade') return
    // For SISSEKANNE_O entries the outcome ID is on entry.curriculumModuleOutcomes,
    // not entry.id (which is null for outcomes). See FinalGradesManagementFeature.js:889.
    const outcomeId = entry.curriculumModuleOutcomes ?? entry.id
    if (!outcomeId) throw new Error('Outcome entry is missing curriculumModuleOutcomes')

    const desiredGrade = item.kind === 'clearGrade' ? null : buildGradePayload(item.label)
    const url = `/journals/${journalId}/journalOutcome/${outcomeId}`

    // GET the outcome detail to find any existing row for this student.
    // journalEntriesByDate's entry.studentOutcomeResults omits id/version,
    // and the outcome PUT REQUIRES them when updating an existing row —
    // without them Tahvel attempts an INSERT and hits the (student,outcome)
    // unique constraint with 412 main.messages.error.unique. Verified.
    let existing = null
    try {
      const detail = await this.api.tahvel.get(url, {}, { cache: false })
      existing = detail?.outcomeStudents?.find(s => Number(s.studentId) === Number(studentId)) || null
    } catch (err) {
      if (Logger.isDebugMode()) Logger.debug('[CellContextMenuFeature] failed to load outcome detail', err)
    }

    const gradeDate = existing?.gradeDate || todayAtMidnightIsoUtc()

    // Base 5-field shape used for both create and update.
    const outcomeStudent = {
      studentId: Number(studentId),
      grade: desiredGrade,
      gradeDate,
      removeStudentHistory: item.kind === 'clearGrade',
      addInfo: null
    }
    // On update, attach the optimistic-lock fields Tahvel needs to match the
    // existing row. Matches the shape of Tahvel's own UI PUT for updates.
    if (existing) {
      outcomeStudent.id = existing.id
      outcomeStudent.version = existing.version
    }

    this._lastPutPayload = { url, body: { outcomeStudents: [outcomeStudent] } }
    await this.api.tahvel.post(url, { outcomeStudents: [outcomeStudent] })

    if (!entry.studentOutcomeResults) entry.studentOutcomeResults = {}
    entry.studentOutcomeResults[studentId] = {
      ...(existing || {}),
      grade: desiredGrade,
      gradeDate
    }
  }

  // --- Journal data prefetch ----------------------------------------------

  _extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  _loadJournalData() {
    const journalId = this._extractJournalId()
    if (!journalId || !this.api?.tahvel) return Promise.resolve()
    if (this._loadedJournalId === journalId && this._entriesPromise) return this._entriesPromise
    if (this._loadedJournalId === journalId && this._journalEntries.length) return Promise.resolve()

    this._loadedJournalId = journalId
    this._entriesPromise = Promise.all([
      this.api.tahvel.get(
        `/journals/${journalId}/journalEntriesByDate`,
        { allStudents: true },
        { cache: true, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] }
      ),
      this.api.tahvel.get(
        `/journals/${journalId}/journalStudents`,
        { allStudents: true },
        { cache: true, cacheExpiration: 6e4, suppressErrorStatuses: [403, 412] }
      )
    ])
      .then(([entries, journalStudents]) => {
        if (this._extractJournalId() !== journalId) return
        this._journalEntries = Array.isArray(entries) ? entries : []
        this._studentIdToJournalStudentId = new Map()
        if (Array.isArray(journalStudents)) {
          journalStudents.forEach(student => {
            if (student?.studentId && student?.id) {
              this._studentIdToJournalStudentId.set(String(student.studentId), String(student.id))
            }
          })
        }
      })
      .catch(error => {
        if (Logger.isDebugMode()) Logger.debug('[CellContextMenuFeature] failed to load journal data', error)
        this._journalEntries = []
        this._studentIdToJournalStudentId = new Map()
      })
      .finally(() => {
        if (this._loadedJournalId === journalId) this._entriesPromise = null
      })

    return this._entriesPromise
  }

  _invalidateLocalCaches() {
    this._journalEntries = []
    this._studentIdToJournalStudentId = new Map()
    this._loadedJournalId = null
    this._entriesPromise = null
    void this._loadJournalData()
  }

  // --- Cell lookup helpers (adapted from HighlightGradeCellsFeature) ------

  _findJournalTable() {
    const selectors = [
      '#studentTable table.tahvel-table',
      '#studentTable table',
      '.tahvel-table-wrapper#studentTable table',
      '.layout-padding table.tahvel-table',
      '.layout-padding table.journalTable',
      'table.journalTable',
      'table.tahvel-table.with-borders'
    ]
    for (const selector of selectors) {
      const table = document.querySelector(selector)
      if (this._isJournalTable(table)) return table
    }
    return null
  }

  _isJournalTable(table) {
    if (!table) return false
    const headers = getNativeJournalHeaderCells(table).map(th => (th.textContent || '').trim().toLowerCase())
    return headers.some(header => header.includes('õppija'))
  }

  _getFirstGradeColumnIndex(table) {
    const headers = getNativeJournalHeaderCells(table)
    const studentHeaderIndex = headers.findIndex(th => (th.textContent || '').trim().toLowerCase().includes('õppija'))
    return studentHeaderIndex >= 0 ? studentHeaderIndex + 1 : 2
  }

  _getColumnEntryIndexes(table, firstGradeColumnIndex) {
    const columnEntryIndexes = new Map()
    if (!this._journalEntries.length) return columnEntryIndexes
    const usedEntryIndexes = new Set()
    const headers = getNativeJournalHeaderCells(table)
    headers.forEach((header, columnIndex) => {
      if (columnIndex < firstGradeColumnIndex) return
      const entryIndex = findEntryIndexForHeader(header, this._journalEntries, usedEntryIndexes)
      if (entryIndex !== null && entryIndex !== undefined) {
        usedEntryIndexes.add(entryIndex)
        columnEntryIndexes.set(columnIndex, entryIndex)
      }
    })
    return columnEntryIndexes
  }

  _getStudentIdFromRow(row) {
    const studentLink = row?.querySelector?.('a[href*="/students/"]')
    return studentLink?.getAttribute('href')?.match(/\/students\/(\d+)/)?.[1] || null
  }

  _isAcademicLeaveRow(row) {
    if (!row?.children) return false
    return Array.from(row.children).some(cell =>
      Array.from(cell.querySelectorAll('i span, i')).some(element =>
        normalizeGradeLabel(element.textContent) === 'AP'
      )
    )
  }

  _hasOpenQuickUpdate(table) {
    return Boolean(table?.querySelector('.quick-update, select.grade-select, tahvel-grade-select select'))
  }

  // --- Toast ---------------------------------------------------------------

  _showToast(message) {
    this._removeToast()
    const toast = document.createElement('div')
    toast.className = 'oa2-cell-toast'
    toast.textContent = message
    toast.style.left = '50%'
    toast.style.top = '24px'
    toast.style.transform = 'translateX(-50%)'
    document.body.appendChild(toast)
    this._toastEl = toast
    this._toastTimeoutId = setTimeout(() => this._removeToast(), 4000)
  }

  _removeToast() {
    if (this._toastTimeoutId) {
      clearTimeout(this._toastTimeoutId)
      this._toastTimeoutId = null
    }
    if (this._toastEl) {
      this._toastEl.remove()
      this._toastEl = null
    }
  }
}

export default CellContextMenuFeature
export { buildGradePayload, buildAbsencePayload, gradeCodeToLabel }
