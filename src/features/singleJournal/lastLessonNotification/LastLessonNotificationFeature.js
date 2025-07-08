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

  constructor () {
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
    // this.comparisonDate = "2023-06-22" // Uncomment for testing with a fixed date

  }

  async activate () {
    console.debug('[LastLessonNotificationFeature] activate called')
    console.debug('[LastLessonNotificationFeature] Using comparison date:', this.comparisonDate)
    console.debug('[LastLessonNotificationFeature] Current URL:', window.location.href)

    try {
      // Only show the last lesson notification banner
      await this.#showLastLessonNotification()
      // Table creation is now handled by LessonDiscrepanciesTable
    } catch (error) {
      console.error('[LastLessonNotificationFeature] Error in activate:', error)
    }
  }

  onDeactivate () {
    this._removeBanner()
    super.onDeactivate()
  }

  async #waitForDiscrepanciesTable () {
    console.debug('[LastLessonNotificationFeature] Waiting for discrepancies table...')
    const maxWaitTime = 3000 // 3 seconds
    const checkInterval = 100 // Check every 100ms
    let waited = 0

    while (waited < maxWaitTime) {
      const container = this._findInsertionPoint()
      const existingTable = container.querySelector('[data-discrepancies-table]')

      if (existingTable) {
        console.debug('[LastLessonNotificationFeature] Discrepancies table found, proceeding...')
        return
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
      waited += checkInterval
    }

    console.debug('[LastLessonNotificationFeature] Timeout waiting for discrepancies table, proceeding anyway...')
  }

  async #showLastLessonNotification () {
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

    const timetableCount = timetable.length
    const journalCount = journalEntries.length
    console.debug('[LastLessonNotificationFeature] timetableCount:', timetableCount, 'journalCount:', journalCount)

    // Check if all timetable lessons are in the past
    const comparisonDateTime = new Date(this.comparisonDate)
    comparisonDateTime.setHours(0, 0, 0, 0)

    const allPast = timetable.length > 0 && timetable.every(lesson => {
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

  _showBanner (date, allPast = false) {
    console.log('[LastLessonNotificationFeature] Last lesson date:', date)
    this._removeBanner()
    const banner = document.createElement('div')
    banner.setAttribute('id', 'last-lesson-banner')

    // Determine if the last lesson date is the comparison date
    let isLastLessonToday = false
    if (date !== 'not found in timetable') {
      const d1 = new Date(date)
      const d2 = new Date(this.comparisonDate)
      d1.setHours(0, 0, 0, 0)
      d2.setHours(0, 0, 0, 0)
      isLastLessonToday = d1.getTime() === d2.getTime()
    }

    banner.style.cssText = `
      background: ${isLastLessonToday ? '#ffcccc' : '#fff3cd'};
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      padding: 15px;
      margin: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,.1);
      width: 600px;
      min-width: 430px;
    `

    const comparisonDateStr = this.#formatDisplayDate(this.comparisonDate)
    const todayStr = this.#formatDisplayDate(new Date())
    const showComparisonDate = comparisonDateStr !== todayStr

    let bannerMessage
    if (date === 'not found in timetable') {
      bannerMessage = `NB! Õppetöö kirjed on olemas, kuid tunniplaani andmeid ei leitud${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    } else {
      const verb = allPast ? 'toimus' : 'toimub'
      bannerMessage = `NB! Viimane tund ${verb} ${this.#formatDisplayDate(date)}${showComparisonDate ? ` (võrdlus kuupäevaga ${comparisonDateStr})` : ''}`
    }

    // Header bar: left = logo + Õpetaja Assistent 2, right = Last lesson notification label
    const titleBar = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #dee2e6;">
        <div style="display:flex;align-items:center;">
            <span style="font-size:20px;margin-right:10px;">🎓</span>
            <h3 style="margin:0;color:#495057;">Õpetaja Assistent 2</h3>
        </div>
        <div style="background:#ffc107;color:#212529;font-weight:bold;padding:6px 16px;border-radius:16px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);">
            Viimase tunni teavitus
        </div>
    </div>`

    banner.innerHTML = `
        ${titleBar}
        <div style="font-size:16px;font-weight:bold;color:#212529;">${bannerMessage}</div>
    `

    const container = this._findInsertionPoint()

    // Check if there's already a discrepancies table and insert after it
    const existingTable = container.querySelector('[data-discrepancies-table]')
    console.debug('[LastLessonNotificationFeature] Container:', container)
    console.debug('[LastLessonNotificationFeature] Existing table found:', !!existingTable)

    if (existingTable) {
      // Insert after the discrepancies table
      console.debug('[LastLessonNotificationFeature] Inserting after discrepancies table')
      container.insertBefore(banner, existingTable.nextSibling)
    } else {
      // Insert at the beginning if no table exists
      console.debug('[LastLessonNotificationFeature] Inserting at beginning of container')
      container.insertBefore(banner, container.firstChild)
    }
  }

  _removeBanner () {
    document.getElementById('last-lesson-banner')?.remove()
  }

  _findInsertionPoint () {
    // Use the same insertion point logic as LessonDiscrepanciesFeature
    const selectors = ['md-content .layout-padding', '.layout-padding', 'md-content', '#main-content', '.main-content', 'main']
    const container = selectors
      .map(selector => document.querySelector(selector))
      .find(element => element && element.getBoundingClientRect().width > 100) || document.body

    console.debug('[LastLessonNotificationFeature] Found insertion container:', container)
    return container
  }

  #formatDisplayDate (date) {
    const d = new Date(date)
    const day = d.getDate().toString().padStart(2, '0')
    const month = (d.getMonth() + 1).toString().padStart(2, '0')
    const year = d.getFullYear()
    return `${day}.${month}.${year}`
  }

  #extractJournalId () {
    const match = window.location.href.match(/\/journal\/(\d+)/)
    return match ? parseInt(match[1], 10) : null
  }

  async #fetchData (journalId) {
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

    const timetable = timetableData?.timetableEvents?.filter(event => {
      const matches = event.journalId == journalId
      console.debug(`[LastLessonNotificationFeature] Event journalId ${event.journalId} ${matches ? 'MATCHES' : 'does not match'} target journalId ${journalId}`)
      return matches
    }) || []

    console.debug('[LastLessonNotificationFeature] Filtered timetable events for journal:', timetable)

    // Fetch journal entries
    const journalEntries = await this.api.tahvel.get(`/journals/${journalId}/journalEntriesByDate`, { allStudents: true }, { cache: true, cacheExpiration: 6e4 })
    console.debug('[LastLessonNotificationFeature] Journal entries:', journalEntries)

    return { timetable, journalEntries: journalEntries ?? [] }
  }
}
