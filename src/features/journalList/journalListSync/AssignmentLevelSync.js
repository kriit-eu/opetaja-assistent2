/**
 * Pure helpers for assignment-level (non-grade) sync metadata.
 *
 * Field descriptors, change extraction, status update calls, payload builder,
 * date normaliser, error-status reader, failure-message formatter. No `this`,
 * no API, no DOM — the only collaborator passed in is the journalSyncBannerService
 * for status-update callbacks (an injected dependency, not module state).
 */

export function getAssignmentLevelSyncFields() {
  return [
    { batchKey: 'nameEt', diffKey: 'assignmentName', statusType: 'name', successLabel: 'ülesande nimetust', failureLabel: 'nimetus' },
    { batchKey: 'homeworkDuedate', diffKey: 'assignmentDueAt', statusType: 'duedate', successLabel: 'tähtaega', failureLabel: 'tähtaeg' },
    {
      batchKey: 'entryDate',
      diffKey: 'assignmentEntryDate',
      statusType: 'entrydate',
      successLabel: 'sissekande kuupäeva',
      failureLabel: 'sissekande kuupäev'
    },
    { batchKey: 'entryType', diffKey: 'entryType', statusType: 'entrytype', successLabel: 'sissekande tüüpi', failureLabel: 'sissekande tüüp' },
    {
      batchKey: 'lessons',
      diffKey: 'assignmentHours',
      statusType: 'hours',
      successLabel: 'ülesande tundide arvu',
      failureLabel: 'tundide arv',
      scalar: true
    }
  ]
}

export function getAssignmentLevelChangeValue(assignment, field) {
  if (field.scalar) {
    const value = assignment[field.diffKey]
    return value === undefined || value === null ? undefined : value
  }

  const diff = assignment[field.diffKey]
  if (!diff || typeof diff !== 'object' || !diff.kriit || diff.kriit === diff.Tahvel) return undefined
  return diff.kriit
}

export function getAssignmentLevelChanges(assignment, fields = getAssignmentLevelSyncFields()) {
  return fields
    .map(field => ({ field, value: getAssignmentLevelChangeValue(assignment, field) }))
    .filter(change => change.value !== undefined)
}

export function getAssignmentLevelBatchChanges(batch, fields = getAssignmentLevelSyncFields()) {
  return fields.map(field => ({ field, value: batch[field.batchKey] })).filter(change => change.value !== undefined && change.value !== null)
}

export function updateAssignmentLevelSyncStatuses(journalSyncBannerService, batch, isSynced) {
  for (const { field } of getAssignmentLevelBatchChanges(batch)) {
    journalSyncBannerService.updateItemSyncStatus(batch.journalId, batch.assignmentId, field.statusType, isSynced)
  }
}

export function applyAssignmentLevelChangesToDifference(assignmentObj, batch) {
  for (const { field, value } of getAssignmentLevelBatchChanges(batch)) {
    if (field.scalar) {
      delete assignmentObj[field.diffKey]
      continue
    }

    assignmentObj[field.diffKey] = assignmentObj[field.diffKey] || {}
    assignmentObj[field.diffKey].Tahvel = value
  }
}

export function getAssignmentLevelFailureTypes(batch) {
  const types = getAssignmentLevelBatchChanges(batch).map(({ field }) => field.statusType)
  return types.length > 0 ? types : ['assignment']
}

export function getSyncFailureTypes(batch, hasStudentUpdates) {
  const types = getAssignmentLevelFailureTypes(batch)
  if (hasStudentUpdates && !types.includes('grade')) types.push('grade')
  return types
}

export function getSyncTypeNames() {
  return {
    ...Object.fromEntries(getAssignmentLevelSyncFields().map(field => [field.statusType, field.failureLabel])),
    assignment: 'muudatus',
    grade: 'hinne'
  }
}

export function countSuccessfulSyncChanges(successfulSyncs, batches) {
  const successfulKeys = new Set(successfulSyncs.map(sync => `${sync.journalId}::${sync.assignmentId}`))
  const gradeCount = successfulSyncs.reduce((count, sync) => count + (sync.updated || 0), 0)
  const assignmentLevelCount = batches.reduce(
    (count, batch) =>
      successfulKeys.has(`${batch.journalId}::${batch.assignmentId}`)
        ? count + getAssignmentLevelBatchChanges(batch).length
        : count,
    0
  )

  return gradeCount + assignmentLevelCount
}

/**
 * Build a Tahvel journal entry update payload for assignment-level changes only.
 * Tahvel requires journalEntryStudents to be present on PUT; omitting it returns
 * 500, while [] preserves existing rows.
 */
export function buildAssignmentLevelUpdatePayload(entryData, updates = {}) {
  const payload = {
    ...entryData,
    ...updates,
    journalEntryStudents: []
  }

  if (Array.isArray(payload.journalEntryTeachers)) {
    payload.journalEntryTeachers = payload.journalEntryTeachers.map(id => String(id))
  }

  return payload
}

/**
 * Normalise a Tahvel due-date value to the datetime shape used by journal entry PUTs.
 */
export function normalizeTahvelDueDate(dueDate) {
  const due = dueDate
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return `${due}T23:59:59.000Z`
  }
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(due)) {
    return `${due}.000Z`
  }
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+$/.test(due)) {
    return `${due}Z`
  }
  return due
}

export function getApiErrorStatus(error) {
  return error?.status || Number(error?.message?.match(/API Error:\s*(\d+)/)?.[1]) || null
}

export function buildSyncFailureMessage(failedSyncs, successfulCount = 0) {
  const count = Array.isArray(failedSyncs) ? failedSyncs.length : 0
  const labels = (failedSyncs || [])
    .map(failure => {
      const assignmentName = failure.assignmentName || (failure.assignmentId ? `ülesanne ${failure.assignmentId}` : 'tundmatu ülesanne')
      const typeNames = getSyncTypeNames()
      const failureTypes = Array.isArray(failure.types) && failure.types.length > 0 ? failure.types : [failure.type]
      const typeName = failureTypes.map(type => typeNames[type] || 'muudatus').join(', ')
      const status = failure.status ? `, HTTP ${failure.status}` : ''
      return `${assignmentName} (${typeName}${status})`
    })
    .join('; ')

  let message = `Sünkroniseerimine ebaõnnestus ${count} muudatuse puhul${labels ? `: ${labels}` : ''}.`
  if (successfulCount > 0) message = `Sünkroniseerimine osaliselt õnnestus: ${successfulCount} õnnestus, ${count} ebaõnnestus${labels ? `. ${labels}.` : '.'}`
  if ((failedSyncs || []).some(failure => failure.status === 412 || String(failure.error || '').includes('412'))) {
    message += ' Tahvel lükkas vähemalt ühe päeviku sissekande uuenduse tagasi (412 Precondition Failed). Värskenda andmeid ja proovi uuesti.'
  }
  return message
}
