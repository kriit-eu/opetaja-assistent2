// LastLessonNotificationFeature.js
// Feature: Notify teacher about the date of the last lesson in the journal, based on timetable and journal entries.
// See feature.md for requirements and LessonDiscrepanciesFeature.js for reference implementation.

import { BaseFeature } from '../../../core/BaseFeature.js'

/**
 * LastLessonNotificationFeature
 * Notifies the teacher about the last lesson date if all lessons are not yet in the past.
 */
export default class LastLessonNotificationFeature extends BaseFeature {
  static SCHOOL_ID_FALLBACK = 9

  constructor() {
    super('lastLessonNotification', /\/journal\/(\d+)\/edit/)
    this.name = 'LastLessonNotificationFeature'

    // Use Intl.DateTimeFormat with timeZone 'Europe/Tallinn' and en-CA locale
    // to produce an ISO-like YYYY-MM-DD string directly.
    this.comparisonDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Tallinn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    this.comparisonDate = '2024-11-15' // Uncomment for testing with a fixed date  22.11.2024
  }

  async activate() {
    console.debug('[LastLessonNotificationFeature] activate called')
    console.debug('[LastLessonNotificationFeature] Using comparison date:', this.comparisonDate)
    console.debug('[LastLessonNotificationFeature] Current URL:', window.location.href)

    try {
      // Only show the last lesson notification banner
      await this.#showLastLessonNotification()
      // Table creation is now handled by DiscrepanciesTable
    } catch (error) {
      console.error('[LastLessonNotificationFeature] Error in activate:', error)
    }
  }

  onDeactivate() {
    this._removeBanner()
    super.onDeactivate()
  }
  async #showLastLessonNotification() {
    const journalId = this.#extractJournalId()
    console.debug('[LastLessonNotificationFeature] journalId:', journalId)
    if (!journalId) {
      console.debug('[LastLessonNotificationFeature] No journalId found, exiting')
      return
    }

    const { timetable, journalEntries } = await this.#fetchData(journalId)
    console.debug('[LastLessonNotificationFeature] timetable:', timetable)
    console.debug('[LastLessonNotificationFeature] journalEntries:', journalEntries)

    if (!timetable.length) {
      console.debug('[LastLessonNotificationFeature] No timetable data found')
    }

    if (!journalEntries.length) {
      console.debug('[LastLessonNotificationFeature] No journal entries, exiting')
      return
    }

    // Find last lesson in timetable (if any)
    let lastLessonDate = null
    if (timetable.length > 0) {
      const sortedTimetable = timetable.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
      lastLessonDate = sortedTimetable[sortedTimetable.length - 1].date
    }

    // Prepare independent work messages for all deadlines after last lesson
    let independentWorkMessages = []
    if (lastLessonDate && Array.isArray(journalEntries)) {
      const lastLesson = new Date(lastLessonDate)
      lastLesson.setHours(0, 0, 0, 0)
      const futureIndependents = journalEntries
        .filter(entry => entry.entryType === 'SISSEKANNE_I')
        .map(entry => {
          const dueDateStr = entry.homeworkDuedate || entry.entryDate
          if (!dueDateStr) return null
          const deadline = new Date(dueDateStr)
          deadline.setHours(0, 0, 0, 0)
          return { deadline, entry }
        })
        .filter(Boolean)
        .filter(({ deadline }) => deadline > lastLesson)
        .sort((a, b) => a.deadline - b.deadline)
      if (futureIndependents.length > 0) {
        independentWorkMessages = futureIndependents.map(({ deadline }) => {
          const diffDays = Math.round((deadline - lastLesson) / (1000 * 60 * 60 * 24))
          const deadlineStr = this.#formatDisplayDate(deadline)
          return `${deadlineStr} iseseiseva töö tähtaeg on ${diffDays} päeva hiljem kui viimane tund`
        })
      }
    }

    // Always set the global message(s) before table creation
    if (independentWorkMessages.length > 0) {
      window.__lastLessonNotification_independentWorkMessage = independentWorkMessages
      document.getElementById('independent-work-deadline-banner')?.remove()
      console.debug('[LastLessonNotificationFeature] Provided independent work messages to table:', independentWorkMessages)
    }

    const timetableCount = timetable.length
    const journalCount = journalEntries.length
    console.debug('[LastLessonNotificationFeature] timetableCount:', timetableCount, 'journalCount:', journalCount)

    // Check if all timetable lessons are in the past
    const comparisonDateTime = new Date(this.comparisonDate)
    comparisonDateTime.setHours(0, 0, 0, 0)

    const allPast =
      timetable.length > 0 &&
      timetable.every(lesson => {
        const lessonDate = new Date(lesson.date)
        lessonDate.setHours(0, 0, 0, 0)
        return lessonDate < comparisonDateTime
      })
    console.debug('[LastLessonNotificationFeature] allPast (compared to ' + this.comparisonDate + '):', allPast)

    // Show detailed condition check
    const countsMatchOrExceed = timetableCount >= journalCount
    const hasFutureLessons = !allPast
    const hasJournalEntriesButNoTimetable = journalCount > 0 && timetableCount === 0

    console.debug('[LastLessonNotificationFeature] Condition check:')
    console.debug('  - Counts match or exceed (timetable >= journal):', countsMatchOrExceed, `(${timetableCount} >= ${journalCount})`)
    console.debug('  - Has future lessons (!allPast):', hasFutureLessons)
    console.debug('  - Has journal entries but no timetable:', hasJournalEntriesButNoTimetable)
    console.debug('  - Show banner condition met:', (countsMatchOrExceed && hasFutureLessons) || hasJournalEntriesButNoTimetable)

    if ((countsMatchOrExceed && hasFutureLessons) || hasJournalEntriesButNoTimetable) {
      const displayDate = timetableCount > 0 ? lastLessonDate : 'not found in timetable'
      this._showBanner(displayDate, allPast)
    } else if (countsMatchOrExceed && allPast) {
      // If all scheduled lessons are in the past, show 'toimus'
      const displayDate = timetableCount > 0 ? lastLessonDate : 'not found in timetable'
      this._showBanner(displayDate, true)
    } else {
      this._removeBanner()
    }
  }

  _showBanner(date, allPast = false) {
    this._removeBanner()
    const subjectSpan = document.querySelector('.hois-collapse-header .flex-gt-md-50 span')
    if (!subjectSpan) {
      console.debug('[LastLessonNotificationFeature] Subject span not found, cannot show notification')
      return
    }
    const oldNotif = document.getElementById('last-lesson-inline-notification')
    if (oldNotif) oldNotif.remove()
    let isLastLessonToday = false
    let isPast = false
    if (date !== 'not found in timetable') {
      const d1 = new Date(date)
      const d2 = new Date(this.comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)
      if (d1.getTime() === d2.getTime()) {
        isLastLessonToday = true
      } else if (d1.getTime() < d2.getTime()) {
        isPast = true
      }
    }
    const comparisonDateStr = this.#formatDisplayDate(this.comparisonDate)
    const todayStr = this.#formatDisplayDate(new Date())
    const showComparisonDate = comparisonDateStr !== todayStr
    let bannerMessage
    if (date === 'not found in timetable') {
      bannerMessage = `NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    } else {
      const verb = allPast ? 'toimus' : 'toimub'
      bannerMessage = `Viimane tund ${verb} ${this.#formatDisplayDate(date)}${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    }
    let bgColor = '#fff3cd' // yellow default
    let borderColor = '#ffeaa7'
    if (isLastLessonToday) {
      bgColor = '#ffcccc' // red
      borderColor = '#ff8888'
    } else if (isPast) {
      bgColor = '#e9ecef' // gray
      borderColor = '#adb5bd'
    }
    // Force red if last lesson date equals comparison date
    if (date !== 'not found in timetable') {
      const d1 = new Date(date)
      const d2 = new Date(this.comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)
      if (d1.getTime() === d2.getTime()) {
        bgColor = '#ffcccc'
        borderColor = '#ff8888'
      }
    }
    const notif = document.createElement('span')
    notif.id = 'last-lesson-inline-notification'
    notif.style.cssText = `
      display: inline-block;
      margin-left: 16px;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      border-radius: 12px;
      padding: 4px 12px;
      font-size: 15px;
      font-weight: bold;
      color: #212529;
      vertical-align: middle;
    `
    notif.textContent = bannerMessage
    subjectSpan.parentNode.insertBefore(notif, subjectSpan.nextSibling)
  }

  _removeBanner() {
    document.getElementById('last-lesson-inline-notification')?.remove()
    document.getElementById('last-lesson-banner')?.remove()
  }
  #formatDisplayDate(date) {
    const d = new Date(date)
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `${day}.${month}.${year}`
  }

  #extractJournalId() {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  async #fetchData(journalId) {
    console.debug('[LastLessonNotificationFeature] #fetchData called with journalId:', journalId)

    // Fetch journal info to get schoolId and teacherId
    const info = await this.api.tahvel.get(`/journals/${journalId}`, {}, { cache: true, cacheExpiration: 864e5 })
    console.debug('[LastLessonNotificationFeature] Journal info:', info)

    if (!info) {
      console.debug('[LastLessonNotificationFeature] No journal info found')
      return { timetable: [], journalEntries: [] }
    }

    const schoolId = info.school?.id || LastLessonNotificationFeature.SCHOOL_ID_FALLBACK
    const teacherId = info.journalTeachers?.[0]?.id
    console.debug('[LastLessonNotificationFeature] schoolId:', schoolId, 'teacherId:', teacherId)

    if (!teacherId) {
      console.debug('[LastLessonNotificationFeature] Missing teacherId')
      return { timetable: [], journalEntries: [] }
    }

    // Get study year dates
    const now = new Date()
    const studyYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear()
    const from = info.studyYearStartDate || new Date(Date.UTC(studyYear, 8, 1)).toISOString()
    const thru = info.studyYearEndDate || new Date(Date.UTC(studyYear + 1, 7, 31, 23, 59, 59, 999)).toISOString()

    console.debug('[LastLessonNotificationFeature] Date range:', { from, thru })

    const endpoint = `/timetableevents/timetableByTeacher/${schoolId}?from=${from}&lang=ET&teachers=${teacherId}&thru=${thru}`
    console.debug('[LastLessonNotificationFeature] Timetable endpoint:', endpoint)

    const timetableData = await this.api.tahvel.get(endpoint, {}, { cache: true, cacheExpiration: 864e5 })
    console.debug('[LastLessonNotificationFeature] Raw timetable data:', timetableData)
    console.debug('[LastLessonNotificationFeature] Timetable events count:', timetableData?.timetableEvents?.length || 0)

    // Log all timetable events with their journalIds for debugging
    if (timetableData?.timetableEvents) {
      console.debug('[LastLessonNotificationFeature] All timetable events with journalIds:')
      timetableData.timetableEvents.forEach((event, index) => {
        console.debug(`  Event ${index}: journalId=${event.journalId}, date=${event.date}, name=${event.nameEt}`)
      })
    }

    const timetable =
      timetableData?.timetableEvents?.filter(event => {
        const matches = event.journalId == journalId
        console.debug(
          `[LastLessonNotificationFeature] Event journalId ${event.journalId} ${matches ? 'MATCHES' : 'does not match'} target journalId ${journalId}`
        )
        return matches
      }) || []

    console.debug('[LastLessonNotificationFeature] Filtered timetable events for journal:', timetable)

    // Fetch journal entries
    const journalEntries = await this.api.tahvel.get(
      `/journals/${journalId}/journalEntriesByDate`,
      { allStudents: true },
      { cache: true, cacheExpiration: 6e4 }
    )
    console.debug('[LastLessonNotificationFeature] Journal entries:', journalEntries)

    return { timetable, journalEntries: journalEntries ?? [] }
  }

  static async refresh(api) {
    if (!window.location.href.match(/\/journal\/(\d+)\/edit/)) return
    const feature = new LastLessonNotificationFeature()
    feature.api = api || (window.__opetajaAssistentApiService && window.__opetajaAssistentApiService.api)
    if (!feature.api) return
    await feature.#showLastLessonNotification()
  }
}

// Attach refresh to window for global access (outside class)
if (typeof window !== 'undefined' && !window.__lastLessonNotificationRefresh) {
  window.__lastLessonNotificationRefresh = LastLessonNotificationFeature.refresh
}
