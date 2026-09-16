/** Persisted timing preference; existing installs default to the lesson end. */
export const LESSON_TIMING_KEY = 'OA_lessonNotificationTiming'
export const DEFAULT_LESSON_TIMING = Object.freeze({ reference: 'end', direction: 'after', minutes: 0 })

/** Validate popup and runtime input before storing a timing preference. */
export function validateLessonTiming(value) {
  if (!value || !['start', 'end'].includes(value.reference) || !['before', 'after'].includes(value.direction) ||
      !Number.isSafeInteger(value.minutes) || value.minutes < 0 || value.minutes > Math.floor(8640000000000000 / 60000)) {
    throw new Error('Vali tunni algus või lõpp ning sisesta minutiteks mittenegatiivne täisarv.')
  }
  return { reference: value.reference, direction: value.direction, minutes: value.minutes }
}

/** Compute the notification time for the whole block, without changing its lesson date. */
export function lessonNotificationAt(block, timing = DEFAULT_LESSON_TIMING) {
  return block[timing.reference] + (timing.direction === 'before' ? -1 : 1) * timing.minutes * 60000
}

/** Read a preference safely when upgrading an existing installation. */
export async function readLessonTiming() {
  const stored = (await chrome.storage.local.get(LESSON_TIMING_KEY))[LESSON_TIMING_KEY]
  try { return validateLessonTiming(stored) } catch { return { ...DEFAULT_LESSON_TIMING } }
}
