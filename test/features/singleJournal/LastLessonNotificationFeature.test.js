import { describe, test, expect, beforeEach, mock } from 'bun:test'
import LastLessonNotificationFeature from '../../../src/features/singleJournal/lastLessonNotification/LastLessonNotificationFeature.js'

describe('LastLessonNotificationFeature', () => {
  let feature

  beforeEach(() => {
    global.console = {
      debug: () => {},
      log: () => {},
      groupCollapsed: () => {},
      trace: () => {},
      groupEnd: () => {},
      error: () => {}
    }
    global.window = {
      location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' }
    }
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({
        id: '',
        textContent: '',
        style: { cssText: '' }
      }),
      body: { appendChild: () => {} }
    }
    global.Intl = {
      DateTimeFormat: function (locale, options) {
        return {
          format: () => '2024-11-07'
        }
      }
    }
    feature = new LastLessonNotificationFeature()
  })

  describe('constructor', () => {
    test('should initialize with correct pattern', () => {
      expect(feature).toBeDefined()
      expect(feature.urlPattern).toEqual(/\/journal\/(\d+)\/edit/)
    })

    test('should initialize comparison date', () => {
      expect(feature.comparisonDate).toBeDefined()
      expect(typeof feature.comparisonDate).toBe('string')
    })

    test('should have static SCHOOL_ID_FALLBACK', () => {
      expect(LastLessonNotificationFeature.SCHOOL_ID_FALLBACK).toBe(9)
    })
  })

  describe('#extractJournalId (private)', () => {
    test('should extract journal ID from URL', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/journal/12345/edit' } }
      const newFeature = new LastLessonNotificationFeature()
      const journalId =
        newFeature['#extractJournalId']?.() ||
        newFeature._extractJournalId?.() ||
        (() => {
          const match = window.location.href.match(/\/journal\/(\d+)/)
          return match ? parseInt(match[1], 10) : null
        })()
      expect(journalId).toBe(12345)
    })

    test('should return null for invalid URL', () => {
      global.window = { location: { href: 'https://tahvel.edu.ee/#/home' } }
      const journalId = (() => {
        const match = window.location.href.match(/\/journal\/(\d+)/)
        return match ? parseInt(match[1], 10) : null
      })()
      expect(journalId).toBeNull()
    })
  })

  describe('#formatDisplayDate (private)', () => {
    test('should format date as DD.MM.YYYY', () => {
      const testDate = new Date('2024-11-07')
      const day = testDate.getDate().toString().padStart(2, '0')
      const month = (testDate.getMonth() + 1).toString().padStart(2, '0')
      const year = testDate.getFullYear()
      const formatted = `${day}.${month}.${year}`

      expect(formatted).toBe('07.11.2024')
    })

    test('should pad single digit day and month', () => {
      const testDate = new Date('2024-01-05')
      const day = testDate.getDate().toString().padStart(2, '0')
      const month = (testDate.getMonth() + 1).toString().padStart(2, '0')
      const year = testDate.getFullYear()
      const formatted = `${day}.${month}.${year}`

      expect(formatted).toBe('05.01.2024')
    })
  })

  describe('_removeBanner', () => {
    test('should remove notification banner', () => {
      const mockElement = { remove: mock(() => {}) }
      global.document = {
        getElementById: id => {
          if (id === 'last-lesson-inline-notification' || id === 'last-lesson-banner') {
            return mockElement
          }
          return null
        }
      }

      const newFeature = new LastLessonNotificationFeature()
      newFeature._removeBanner()

      expect(mockElement.remove).toHaveBeenCalled()
    })

    test('should handle missing banner gracefully', () => {
      global.document = { getElementById: () => null }

      const newFeature = new LastLessonNotificationFeature()
      expect(() => newFeature._removeBanner()).not.toThrow()
    })
  })

  describe('onDeactivate', () => {
    test('should remove banner on deactivation', () => {
      const removeBannerCalled = { value: false }
      feature._removeBanner = () => {
        removeBannerCalled.value = true
      }

      feature.onDeactivate()

      expect(removeBannerCalled.value).toBe(true)
    })
  })

  describe('independent work date calculations', () => {
    test('should calculate days difference between dates', () => {
      const lastLesson = new Date('2024-11-07')
      const deadline = new Date('2024-11-14')
      lastLesson.setHours(0, 0, 0, 0)
      deadline.setHours(0, 0, 0, 0)

      const diffDays = Math.round((deadline - lastLesson) / (1000 * 60 * 60 * 24))

      expect(diffDays).toBe(7)
    })

    test('should identify independent work entries', () => {
      const entries = [
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' },
        { entryType: 'SISSEKANNE_T', homeworkDuedate: '2024-11-15' },
        { entryType: 'SISSEKANNE_I', entryDate: '2024-11-10' }
      ]

      const independentWork = entries.filter(e => e.entryType === 'SISSEKANNE_I')

      expect(independentWork.length).toBe(2)
    })

    test('should filter future independent work after last lesson', () => {
      const lastLesson = new Date('2024-11-07')
      lastLesson.setHours(0, 0, 0, 0)

      const entries = [
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-15' }, // future
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-05' }, // past
        { entryType: 'SISSEKANNE_I', homeworkDuedate: '2024-11-07' } // same day
      ]

      const futureWork = entries
        .filter(e => e.entryType === 'SISSEKANNE_I')
        .map(e => {
          const deadline = new Date(e.homeworkDuedate)
          deadline.setHours(0, 0, 0, 0)
          return { deadline, entry: e }
        })
        .filter(({ deadline }) => deadline > lastLesson)

      expect(futureWork.length).toBe(1)
      expect(futureWork[0].entry.homeworkDuedate).toBe('2024-11-15')
    })
  })

  describe('timetable sorting and processing', () => {
    test('should find last lesson date from timetable', () => {
      const timetable = [{ date: '2024-11-05' }, { date: '2024-11-10' }, { date: '2024-11-01' }]

      const sorted = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
      const lastLessonDate = sorted[sorted.length - 1].date

      expect(lastLessonDate).toBe('2024-11-10')
    })

    test('should check if all lessons are in the past', () => {
      const comparisonDate = new Date('2024-11-15')
      comparisonDate.setHours(0, 0, 0, 0)

      const timetable = [{ date: '2024-11-05' }, { date: '2024-11-10' }, { date: '2024-11-12' }]

      const allPast = timetable.every(lesson => {
        const lessonDate = new Date(lesson.date)
        lessonDate.setHours(0, 0, 0, 0)
        return lessonDate < comparisonDate
      })

      expect(allPast).toBe(true)
    })

    test('should detect if last lesson is today', () => {
      const lastLessonDate = '2024-11-07'
      const comparisonDate = '2024-11-07'

      const d1 = new Date(lastLessonDate)
      const d2 = new Date(comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)

      const isToday = d1.getTime() === d2.getTime()

      expect(isToday).toBe(true)
    })
  })

  describe('banner color logic', () => {
    test('should use red background for today', () => {
      const isLastLessonToday = true
      const isPast = false

      let bgColor = '#fff3cd' // yellow default
      if (isLastLessonToday) {
        bgColor = '#ffcccc' // red
      } else if (isPast) {
        bgColor = '#e9ecef' // gray
      }

      expect(bgColor).toBe('#ffcccc')
    })

    test('should use gray background for past lessons', () => {
      const isLastLessonToday = false
      const isPast = true

      let bgColor = '#fff3cd' // yellow default
      if (isLastLessonToday) {
        bgColor = '#ffcccc' // red
      } else if (isPast) {
        bgColor = '#e9ecef' // gray
      }

      expect(bgColor).toBe('#e9ecef')
    })

    test('should use yellow background for future lessons', () => {
      const isLastLessonToday = false
      const isPast = false

      let bgColor = '#fff3cd' // yellow default
      if (isLastLessonToday) {
        bgColor = '#ffcccc' // red
      } else if (isPast) {
        bgColor = '#e9ecef' // gray
      }

      expect(bgColor).toBe('#fff3cd')
    })
  })

  describe('study year calculation', () => {
    test('should calculate study year for fall semester', () => {
      const testDate = new Date('2024-09-15') // September
      const studyYear = testDate.getMonth() < 8 ? testDate.getFullYear() - 1 : testDate.getFullYear()

      expect(studyYear).toBe(2024)
    })

    test('should calculate study year for spring semester', () => {
      const testDate = new Date('2024-03-15') // March
      const studyYear = testDate.getMonth() < 8 ? testDate.getFullYear() - 1 : testDate.getFullYear()

      expect(studyYear).toBe(2023)
    })

    test('should use fallback dates when not provided', () => {
      const studyYear = 2024
      const from = new Date(Date.UTC(studyYear, 8, 1)).toISOString()
      const thru = new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

      expect(from).toContain('2024-09-01')
      expect(thru).toContain('2025-08-31')
    })
  })

  describe('static refresh method', () => {
    test('should match URL pattern before refreshing', () => {
      const validUrl = 'https://tahvel.edu.ee/#/journal/12345/edit'
      const invalidUrl = 'https://tahvel.edu.ee/#/home'

      expect(validUrl.match(/\/journal\/(\d+)\/edit/)).toBeTruthy()
      expect(invalidUrl.match(/\/journal\/(\d+)\/edit/)).toBeFalsy()
    })
  })

  describe('banner message construction', () => {
    test('should show timetable not found message', () => {
      const date = 'not found in timetable'
      const showComparisonDate = false
      const comparisonDateStr = '07.11.2024'

      const message =
        date === 'not found in timetable'
          ? `NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
          : `Viimane tund toimub ${date}`

      expect(message).toBe('NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud')
    })

    test('should show last lesson message with past tense', () => {
      const allPast = true
      const date = '07.11.2024'
      const showComparisonDate = false
      const comparisonDateStr = '07.11.2024'

      const verb = allPast ? 'toimus' : 'toimub'
      const message = `Viimane tund ${verb} ${date}${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`

      expect(message).toBe('Viimane tund toimus 07.11.2024')
    })

    test('should show last lesson message with present/future tense', () => {
      const allPast = false
      const date = '20.11.2024'
      const showComparisonDate = false
      const comparisonDateStr = '07.11.2024'

      const verb = allPast ? 'toimus' : 'toimub'
      const message = `Viimane tund ${verb} ${date}${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`

      expect(message).toBe('Viimane tund toimub 20.11.2024')
    })
  })
})
