# Lesson notifications (#156, #157, #158)

## Behaviour

- Chrome schedules native notifications from the signed-in teacher's timetable. Adjacent periods in the same journal/group/type become one block.
- Default notification time is the block end. The popup supports a whole-minute offset before/after the block start/end; changing it reschedules unsent notifications, without replaying already sent blocks.
- The scheduler refreshes every 15 minutes, on startup, on Tahvel navigation and at Tallinn midnight. It fetches adjacent/shifted dates when timing offsets cross midnight.
- Clicking a notification opens a new entry, prefills type/capacity/date/periods and copies available previous-lesson attendance. Topic/content remain manual. Nothing saves automatically.
- Notification links are retained per tab in extension session storage across sign-in. Email links can reconstruct the lesson from the authenticated teacher's historical timetable without requiring a previously delivered Chrome notification.

## Email deployment (#157)

Requires the companion Kriit change: https://github.com/kriit-eu/kriit/issues/203 (branch `203-lesson-reminders`). Deploy its migration and endpoint before enabling this flow in production.

With Kriit enabled and API URL/token configured, the extension schedules a separate alarm at block end + 10 minutes. It checks the current Tahvel identity, fresh timetable and fresh journal entries. Only an unrecorded block triggers `POST {configured API base}/lessonreminders/send`. This alarm is independent of the popup's Chrome-notification timing.

The request contains only origin, school/journal IDs, date, start/end times, starting period and subject name. It sends no Tahvel cookies, student details or attendance to Kriit. Kriit uses the authenticated teacher's email, validates timing and constructs the Tahvel link itself. Its unique database claim prevents duplicate emails across retries/devices.

An expired session, inaccessible or ambiguous lesson data, an unsupported/missing Kriit endpoint, or network failure does not count as successful delivery. Failed checks can retry on subsequent schedule refreshes, up to 24 hours after the block. Already recorded blocks are marked complete without emailing.

**Runtime requirement:** Chrome must be running (background mode is sufficient) and Tahvel authentication must remain valid for email checks. There is no server-side Tahvel cookie storage or offline verification. Sleeping/stopped browsers cannot guarantee exact delivery time. Kriit must have working SMTP and an email on the teacher's account.

## Verification

Automated coverage includes scheduling/rescheduling, duplicate suppression, all four timing combinations, midnight planning, validation, fresh-entry coverage, expired sessions, email payload privacy, older links, sign-in pending-link state, prefilled form controls and real popup/worker persistence.

Before closing #156, verify on Windows with a **test profile and test lesson**:

1. Load the development build, sign in and check the next notification time in the popup.
2. Enable Chrome background mode and Windows notifications; keep the computer awake.
3. Close the last Chrome window (do not terminate Chrome).
4. Confirm one native notification at the block's configured time.
5. Click it, confirm the correct journal/form, date, lesson count and attendance; do not save a synthetic lesson.
6. Repeat with an expired Tahvel session and confirm sign-in resumes the intended form.

Before closing #157, deploy the Kriit migration/endpoint in a test environment. Use a controlled teacher inbox to verify one actual email for a missing entry, none for a recorded entry, and a working link after sign-in. Automated tests do not prove OS toast delivery or SMTP delivery.
