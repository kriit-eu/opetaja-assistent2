import {
    type AssistentExerciseListEntry,
    type AssistentJournal,
    type AssistentJournalDifference,
    type AssistentLessonTime,
    AssistentStudentStatus,
    type AssistentStudentsWithoutGrades,
    type AssistentStudentsWithoutIndependentWork,
    LessonType
} from '~src/shared/AssistentTypes'

export class AssistentCache {
    public static journals: AssistentJournal[] = []
    public static lessonTimes: AssistentLessonTime[] = []

    /**
     * Find lessons in timetable entries that are missing in journal entries. This function takes into account that the lessons in journal may be
     * @param journalId
     */

    public static findJournalDiscrepancies(
        journalId: number
    ): AssistentJournal | [] {
        const journal = AssistentCache.getJournal(journalId)

        if (!journal) return []

        const lessonCounts: Record<
            string,
            { journal: number; timetable: number }
        > = {}
        const firstLessonStartNumbers: Record<
            string,
            { journal: number; timetable: number }
        > = {}
        const differences: AssistentJournalDifference[] = []

        for (const journalEntry of journal.entriesInJournal) {
            if (journalEntry.lessonType !== LessonType.lesson) {
                continue // Skip entries with lessonType other than lesson
            }
            if (!firstLessonStartNumbers[journalEntry.date]) {
                firstLessonStartNumbers[journalEntry.date] = {
                    journal: Infinity,
                    timetable: Infinity
                }
            }
            if (!lessonCounts[journalEntry.date]) {
                lessonCounts[journalEntry.date] = { journal: 0, timetable: 0 }
            }
            lessonCounts[journalEntry.date].journal += journalEntry.lessonCount
            if (
                journalEntry.firstLessonStartNumber <
                firstLessonStartNumbers[journalEntry.date].journal
            ) {
                firstLessonStartNumbers[journalEntry.date].journal =
                    journalEntry.firstLessonStartNumber
            }
        }

        for (const timetableEntry of journal.entriesInTimetable) {
            if (!firstLessonStartNumbers[timetableEntry.date]) {
                firstLessonStartNumbers[timetableEntry.date] = {
                    journal: Infinity,
                    timetable: Infinity
                }
            }
            if (!lessonCounts[timetableEntry.date]) {
                lessonCounts[timetableEntry.date] = { journal: 0, timetable: 0 }
            }

            if (
                timetableEntry.firstLessonStartNumber <
                firstLessonStartNumbers[timetableEntry.date].timetable
            ) {
                firstLessonStartNumbers[timetableEntry.date].timetable =
                    timetableEntry.firstLessonStartNumber
            }

            lessonCounts[timetableEntry.date].timetable++
        }

        for (const date in lessonCounts) {
            if (
                date !== 'null' &&
                (lessonCounts[date].journal !== lessonCounts[date].timetable ||
                    firstLessonStartNumbers[date].journal !==
                        firstLessonStartNumbers[date].timetable)
            ) {
                differences.push({
                    date: date,
                    lessonType: LessonType.lesson,
                    timetableLessonCount: lessonCounts[date].timetable,
                    timetableFirstLessonStartNumber:
                        firstLessonStartNumbers[date].timetable,
                    journalLessonCount: lessonCounts[date].journal,
                    journalFirstLessonStartNumber:
                        firstLessonStartNumbers[date].journal,

                    // Find the journal entry id for the date and where lessonType is lesson

                    journalEntryId:
                        journal.entriesInJournal.find(
                            (j) =>
                                j.date === date &&
                                j.lessonType === LessonType.lesson
                        )?.id || 0
                })
            }
        }

        // Replacing Infinity with 0

        differences.forEach((difference) => {
            if (difference.timetableFirstLessonStartNumber === Infinity) {
                difference.timetableFirstLessonStartNumber = 0
            }
            if (difference.journalFirstLessonStartNumber === Infinity) {
                difference.journalFirstLessonStartNumber = 0
            }
        })

        journal.differencesToTimetable = differences
    }

    static getJournal(journalId: number): AssistentJournal | undefined {
        return AssistentCache.journals.find((j) => j.id === journalId)
    }

    // compare studentOutcomeResults and students for each curriculumModuleOutcome and for each journal

    static findCurriculumModuleOutcomeDiscrepancies(journalId: number): void {
        const journal = AssistentCache.getJournal(journalId)
        const missingGrades: AssistentStudentsWithoutGrades[] = []

        if (!journal) return

        // If contact lessons count in timetable are equal or greater than contact lessons planned, then add data into cache

        if (
            journal.entriesInTimetable.length >= journal.contactLessonsPlanned
        ) {

            // iterate over curriculumModules and find the discrepancies of studentOutcomeResults and students

            for (const learningOutcome of journal.learningOutcomes) {
                const missingGradesForModule: AssistentStudentsWithoutGrades = {
                    curriculumModuleOutcomes:
                        learningOutcome.curriculumModuleOutcomes,
                    name: learningOutcome.name,
                    code: learningOutcome.code,
                    studentList: []
                }

                for (const student of journal.students) {

                    // Check if student's status is active before calculating missing grades

                    if (
                        student.status === AssistentStudentStatus.active &&
                        !learningOutcome.studentOutcomeResults.find(
                            (result) => result.studentId === student.studentId
                        )
                    ) {
                        missingGradesForModule.studentList.push(student)
                    }
                }

                if (missingGradesForModule.studentList.length > 0) {
                    missingGrades.push(missingGradesForModule)
                }
            }
            journal.missingGrades = missingGrades
        }
    }

    static findIndependentWorkDiscrepancies(journalId: number) {
        const journal = AssistentCache.getJournal(journalId)
        const missingIndependentWork: AssistentStudentsWithoutIndependentWork[] =
            []

        if (!journal) return []

        // Helper function to parse 'dd.mm.yyyy' format to Date object

        function parseDate(dateStr: string): Date | null {
            if (!dateStr) return null
            const [day, month, year] = dateStr.split('.').map(Number)
            return new Date(year, month - 1, day) // month is zero-indexed
        }

        // Helper function to check if a date has passed

        function isDatePassed(dueDateStr: string | null): boolean {
            const dueDate = parseDate(dueDateStr)
            if (!dueDate) return false // If dueDate is null, consider it as not passed
            const today = new Date()

            // Compare only the date parts, ignoring the time

            return (
                dueDate <
                new Date(today.getFullYear(), today.getMonth(), today.getDate())
            )
        }

        journal.students.forEach((student) => {
            const studentMissingWorks: AssistentExerciseListEntry[] = []

            journal.exercisesLists.forEach((exercise) => {
                if (
                    exercise.lessonType !== LessonType.lesson &&
                    exercise.learningOutcomes.length > 0
                ) {
                    const isDueDatePassed = isDatePassed(
                        exercise.homeworkDuedate
                    )
                    const hasGrade = journal.entriesInJournal.some((entry) =>
                        entry.journalStudentResults.some(
                            (result) =>
                                result.studentId === student.id &&
                                result.gradeCode &&
                                exercise.id === entry.id
                        )
                    )

                    // Add the exercise to the missing list if the grade is missing and the due date is passed or not set

                    if (
                        !hasGrade &&
                        (isDueDatePassed || !exercise.homeworkDuedate)
                    ) {
                        studentMissingWorks.push(exercise)
                    }
                }
            })

            if (studentMissingWorks.length > 0) {
                missingIndependentWork.push({
                    studentId: student.id,
                    name: student.name,
                    exerciseList: studentMissingWorks
                })
            }
        })

        journal.studentsMissingIndependentWork = missingIndependentWork
    }

    static findJournalLessonsDifferencesFact(id: number) {
        const journal = AssistentCache.getJournal(id)

        if (
            journal &&
            journal.differencesToTimetable.length > 0 &&
            journal.differencesToTimetable.find(
                (difference) =>
                    difference.journalLessonCount === 0 &&

                    // Ignore future lessons

                    new Date(difference.date).setHours(0, 0, 0, 0) <
                        new Date().setHours(0, 0, 0, 0)
            )
        ) {
            journal.allLessonsAreMissingFromJournal = true
        }

        if (
            journal &&
            journal.differencesToTimetable.length > 0 &&
            journal.differencesToTimetable.find(
                (difference) =>
                    (difference.timetableLessonCount > 0 &&
                        difference.journalLessonCount > 0 &&
                        (difference.timetableLessonCount !==
                            difference.journalLessonCount ||
                            difference.timetableFirstLessonStartNumber !==
                                difference.journalFirstLessonStartNumber)) ||
                    (difference.journalLessonCount > 0 &&
                        difference.timetableLessonCount === 0)
            )
        ) {
            journal.lessonDiscrepancies = true
        }
    }

    static updateJournal(journal: AssistentJournal) {
        const existingJournal = AssistentCache.journals.find(
            (j) => j.id === journal.id
        )
        if (existingJournal) {
            Object.assign(existingJournal, journal)
        } else {
            AssistentCache.journals.push(journal)
        }
    }
}

export default AssistentCache

console.log('AssistentCache', AssistentCache.journals)
