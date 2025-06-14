export interface AssistentJournal {
    id: number
    name: string
    entriesInTimetable: AssistentTimetableEntry[]
    entriesInJournal: AssistentJournalEntry[]
    exercisesLists: AssistentExerciseListEntry[]
    differencesToTimetable: AssistentJournalDifference[]
    students: AssistentStudent[]
    studentGroups: string[]
    teachers: AssistentJournaTeacher[]
    learningOutcomes: AssistentLearningOutcomes[]
    studentsMissingIndependentWork: AssistentStudentsWithoutIndependentWork[]
    missingGrades: AssistentStudentsWithoutGrades[]
    unsynchronizedGradesDataFromKriit: AssistentMismatchedGradesInfoFromKriit
    independentWorkPlanned: number
    independentWorkGiven: number
    contactLessonsPlanned: number
    contactLessonsInJournal: number
    gradingType: AssistentGradingType
    allLessonsAreMissingFromJournal: boolean
    lessonDiscrepancies: boolean
    isSynchronizedWithKriit: boolean
    lastLessonDate: () => Date | false
    lastLessonIsInThePast: () => boolean
}

export enum AssistentGradingType {
    numeric = 'numeric',
    passFail = 'passFail'
}

export interface AssistentStudent {
    id: number
    studentId: number
    name: string
    status: AssistentStudentStatus
    studentGroup: string
}

export enum AssistentStudentStatus {
    active = 'active',
    academicLeave = 'academicLeave',
    exmatriculated = 'exmatriculated',
    individualCurriculum = 'individualCurriculum',
    finished = 'finished'
}

export interface AssistentJournalDifference {
    date: string
    lessonType: LessonType
    timetableLessonCount: number
    timetableFirstLessonStartNumber: number
    journalLessonCount: number
    journalFirstLessonStartNumber: number
    journalEntryId: number
}

export interface AssistentExerciseListEntry {
    id: number
    entryDate: string
    learningOutcomes: number[]
    nameEt: string
    content: string
    lessonType: LessonType
    homeworkDuedate: string
}

export interface AssistentTimetableEntry {
    id: number
    name: string
    date: string
    timeStart: string
    timeEnd: string
    firstLessonStartNumber: number
    journalId: number
}

export interface AssistentJournalEntry {
    id: number
    date: string
    name: string
    lessonType: LessonType
    lessonCount: number
    firstLessonStartNumber: number
    journalStudentResults: AssistentStudentEntryResults[]
}

export interface AssistentLessonTime {
    number: number
    timeStart: string
    timeEnd: string
    note?: string
}

export enum LessonType {
    independentWork = 'independentWork',
    lesson = 'lesson',
    endResult = 'endResult',
    other = 'other',
    eLearning = 'eLearning',
    grading = 'grading',
    practicalWork = 'practicalWork'
}

export interface AssistentLearningOutcomes {
    curriculumModuleOutcomes: number
    entryType: string
    name: string
    code?: string
    studentOutcomeResults?: AssistentStudentOutcomeResults[]
}

export interface AssistentStudentOutcomeResults {
    id: number
    studentId: number
    gradeCode: string
    gradeNumber: number
}

export interface AssistentStudentEntryResults {
    studentId: number
    addInfo: string
    gradeCode: string
    gradeNumber?: number
}

export interface AssistentJournaTeacher {
    id: number
    fullname: string
}

export interface AssistentStudentsWithoutGrades {
    curriculumModuleOutcomes: number
    name: string
    code: string
    studentList: AssistentStudent[]
}

export interface AssistentStudentsWithoutIndependentWork {
    studentId: number
    name: string
    exerciseList: AssistentExerciseListEntry[]
}

export interface AssistentMismatchedGradesInfoFromKriit {
    mismatchedGradesInfo: {
        [journalEntryId: string]: AssistentAssignmentInfoFromKriit
    }
}

export interface AssistentAssignmentInfoFromKriit {
    assignmentName: string
    students: AssistentStudentInfoFromKriit[]
}

export interface AssistentStudentInfoFromKriit {
    studentId: number
    studentName: string
    kriitGrade?: string | null
    tahvelGrade?: string
    kriitComment?: string
    tahvelComment?: string
}
