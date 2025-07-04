## Goal
Implement a feature that notifies the teacher of the date of the last lesson, so they can quickly verify that all independent‑work entries have been recorded.

---

## How It Works

1. When the teacher opens the journal, the extension checks the count of scheduled lessons in timetable and compares it to the journal's planned lessons count.
2. If the count of the scheduled lessons is the same or exceeds the count of planned lessons and the last lesson date is not in the past, it shows a yellow banner with the following content: "NB! Viimane tund toimub dd.mm.yyyy" where dd.mm.yyyy is the last lessons date in the timetable.
3. If all scheduled lessons are in the past, instead of "toimub" show "toimus"
