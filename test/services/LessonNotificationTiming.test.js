import { test, expect } from 'bun:test'
import { DEFAULT_LESSON_TIMING, validateLessonTiming, lessonNotificationAt } from '../../src/services/LessonNotificationTiming.js'

const block = { start: 10000000, end: 13600000 }
test('defaults to the real block end and supports all four timing combinations', () => {
  expect(lessonNotificationAt(block)).toBe(block.end)
  for (const reference of ['start', 'end']) {
    for (const direction of ['before', 'after']) {
      const timing = validateLessonTiming({ reference, direction, minutes: 10 })
      expect(lessonNotificationAt(block, timing)).toBe(block[reference] + (direction === 'before' ? -600000 : 600000))
      expect(lessonNotificationAt(block, { ...timing, minutes: 0 })).toBe(block[reference])
    }
  }
})

test('rejects malformed, negative, fractional, blank and unsafe offsets', () => {
  for (const minutes of [-1, 0.5, NaN, Infinity, '', '3', null, Number.MAX_SAFE_INTEGER]) {
    expect(() => validateLessonTiming({ ...DEFAULT_LESSON_TIMING, minutes })).toThrow()
  }
  expect(() => validateLessonTiming({ reference: 'middle', direction: 'after', minutes: 0 })).toThrow()
  expect(() => validateLessonTiming({ reference: 'end', direction: 'invalid', minutes: 0 })).toThrow()
})
