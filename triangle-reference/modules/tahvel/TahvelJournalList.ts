import TahvelDom from '~src/modules/tahvel/TahvelDom'
import TahvelJournal from '~src/modules/tahvel/TahvelJournal'
import AssistentApiClient from '~src/shared/AssistentApiClient'
import { AssistentCache } from '~src/shared/AssistentCache'
import { default as AssistentStore } from '~src/shared/AssistentStore'

class TahvelJournalList {
    static addWarningTriangles() {
        const journalsListTableRowsSelector =
            '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr'
        const journalLinksSelector = `${journalsListTableRowsSelector} > td:nth-child(2) > a`

        const journalLinks = document.querySelectorAll(journalLinksSelector)

        journalLinks.forEach(async (link) => {
            const href = link.getAttribute('href')

            const journalId = parseInt(href.split('/')[3])

            const journal = AssistentCache.getJournal(journalId)

            // If journal is not found in cache, skip
            if (!journal) {
                return
            }

            const wrapper = document.createElement('span')
            wrapper.style.display = 'flex'
            wrapper.id = 'InjectionsWrapper'

            wrapper.appendChild(link.cloneNode(true))

            // If there are lessons in timetable that are not in journal
            if (journal.allLessonsAreMissingFromJournal) {
                const exclamationMark = TahvelDom.createExclamationMark(
                    'MissingLessonsAlert',
                    '#f8d00f',
                    '\u26A0',
                    'Päevikus pole ühtegi toimunud tunni sissekannet'
                )
                wrapper.appendChild(exclamationMark)
            }

            // If there are lessons in journal that are not in timetable
            if (journal.lessonDiscrepancies) {
                const exclamationMark = TahvelDom.createExclamationMark(
                    'DiscrepanciesAlert',
                    'grey',
                    '\u26A0',
                    'Erinevused päeviku sissekannete ja tunniplaani vahel'
                )
                wrapper.appendChild(exclamationMark)
            }

            // If there are missing grades in journal and the last lesson is in the past
            if (
                journal.missingGrades.length > 0 &&
                journal.lastLessonIsInThePast()
            ) {
                const exclamationMark = TahvelDom.createExclamationMark(
                    'MissingGradesAlert',
                    'red',
                    '\u26A0',
                    'Päevikus puuduvad hinded'
                )
                wrapper.appendChild(exclamationMark)
            }
            if (journal.isSynchronizedWithKriit === false) {
                const exclamationMark = TahvelDom.createExclamationMark(
                    'NotSynchronizedAlert',
                    'blue',
                    '\u26A0',
                    'Päevik pole Kriitiga sünkroniseeritud'
                )
                wrapper.appendChild(exclamationMark)
            }

            link.replaceWith(wrapper)
        })
    }

    static async addUnsynchronizedBanner() {
        const mainContent = document.querySelector(
            '#main-content > div.layout-padding > div'
        )
        if (!mainContent) return

        // Get current page journal IDs
        const journalsListTableRowsSelector =
            '#main-content > div.layout-padding > div > md-table-container > table > tbody > tr'
        const journalLinksSelector = `${journalsListTableRowsSelector} > td:nth-child(2) a`
        const journalLinks = document.querySelectorAll(journalLinksSelector)

        const currentPageJournals = Array.from(journalLinks).map((link) => {
            const href = link.getAttribute('href')
            const id = parseInt(href.split('/')[3])
            const name = link.textContent.trim()
            return { id, name }
        })

        // Fetch data for each journal
        const syncData = []

        // First collect all journal data
        for (const journalBasic of currentPageJournals) {
            try {

                // Get journal info using AssistentStore
                const journal = await AssistentStore.getJournalInfo(
                    journalBasic.id,
                    async () =>
                        await AssistentApiClient.get(
                            `/journals/${journalBasic.id}`
                        )
                )

                // Get journal entries using AssistentStore
                const entries = await AssistentStore.getJournalEntries(
                    journalBasic.id,
                    async () =>
                        await AssistentApiClient.get(
                            `/journals/${journalBasic.id}/journalEntriesByDate?allStudents=false`
                        )
                )

                // Get teacher info from journalTeachers
                const teacherInfo = journal?.journalTeachers?.[0]
                if (!journal || !teacherInfo || !journal.studentGroups?.[0]) {
                    console.error(
                        `Debug: Invalid journal data for ${journalBasic.id}:`,
                        {
                            hasJournal: !!journal,
                            hasTeacher: !!teacherInfo,
                            hasStudentGroups: !!journal?.studentGroups?.[0]
                        }
                    )
                    continue
                }

                // Get teacher data
                const teacherData = await TahvelJournal.fetchTeachersData(
                    teacherInfo.id,
                    teacherInfo.nameEt || teacherInfo.fullname
                )

                if (!teacherData || !teacherData.idcode) {
                    console.error(
                        `Debug: No teacher data found for journal ${journalBasic.id}`
                    )
                    continue
                }

                // Get students data with idcodes from the group
                const studentsData =
                    await TahvelJournal.fetchStudentsDataByGroupName(
                        journal.studentGroups[0]
                    )
                if (!studentsData) {
                    console.error(
                        `Debug: No student data found for group ${journal.studentGroups[0]}`
                    )
                    continue
                }

                // Create mapping from student ID to their idcode and name
                const studentIdToIdcode = {}
                const idcodeMap = {}
                const nameMap = {}
                studentsData.forEach((student) => {
                    if (student?.id) {
                        if (student.idcode) {
                            idcodeMap[student.id] = student.idcode
                        } else {
                            console.warn(
                                `Debug: No idcode for student ID ${
                                    student.id
                                } (${student.fullname || 'unknown name'})`
                            )
                        }
                        nameMap[student.id] =
                            student.fullname ||
                            student.name ||
                            (student.firstname &&
                                student.lastname &&
                                `${student.firstname} ${student.lastname}`) ||
                            'Unknown Student'
                    }
                })

                // Get all journal students
                const journalStudents = await AssistentStore.getJournalStudents(
                    journal.id,
                    async () =>
                        await AssistentApiClient.get(
                            `/journals/${journal.id}/journalStudents`
                        )
                )

                // Map journal student IDs to idcodes and names
                journalStudents?.forEach((journalStudent) => {
                    const idcode = idcodeMap[journalStudent.studentId]
                    const name = nameMap[journalStudent.studentId]
                    if (idcode) {
                        studentIdToIdcode[journalStudent.id] = {
                            idcode: idcode,
                            name: name
                        }
                    } else {
                        console.warn(
                            `Debug: Could not map journalStudent ${journalStudent.fullname} (ID: ${journalStudent.studentId}) to an idcode`
                        )
                    }
                })

                // Filter to entry types and convert grades
                const filteredEntries = entries.filter(
                    (e) =>
                        e?.entryType === 'SISSEKANNE_H' ||
                        e?.entryType === 'SISSEKANNE_I'
                )

                const assignments = filteredEntries
                    .map((entry) => {
                        if (!entry) return null

                        // Get all student results for this entry
                        const studentResults = Object.entries(
                            entry.journalStudentResults || {}
                        )

                        // Create a map of students who have grades
                        const studentGrades = {}
                        studentResults.forEach(
                            ([journalStudentId, results]) => {
                                const gradeCode =
                                    results?.[0]?.grade?.code || ''
                                const grade = gradeCode.replace(
                                    'KUTSEHINDAMINE_',
                                    ''
                                )
                                if (grade) {
                                    studentGrades[journalStudentId] = grade
                                }
                            }
                        )

                        // Include all journal students in results, with empty grade if they don't have one
                        const results = Object.entries(studentIdToIdcode).map(
                            ([journalStudentId, student]) => ({
                                grade: studentGrades[journalStudentId] || '',
                                studentPersonalCode: student.idcode,
                                studentName: student.name
                            })
                        )

                        return {
                            assignmentExternalId: entry.id,
                            assignmentName: entry.name || '',
                            assignmentInstructions: entry.content || '',
                            assignmentDueAt: entry.homeworkDuedate
                                ? new Date(entry.homeworkDuedate).toISOString()
                                : null,
                            results
                        }
                    })
                    .filter(Boolean)

                // Add this journal's data to the sync request
                syncData.push({
                    subjectName: journal.nameEt,
                    subjectExternalId: journal.id,
                    groupName: journal.studentGroups[0],
                    teacherPersonalCode: teacherData.idcode,
                    teacherName: teacherData.name,
                    assignments
                })
            } catch (error) {
                console.error('Debug: Failed to fetch journal data:', error)
            }
        }

        // Send all journals data to Kriit in a single request
        try {
            const kriitResponse = await AssistentApiClient.request(
                'POST',
                `${AssistentApiClient.kriitUrl}/api/subjects/getUnsyncedGrades`,
                syncData
            )

            // Get data from Kriit's response
            const kriitData = kriitResponse?.data || []
            if (!Array.isArray(kriitData)) {
                console.error(
                    'Debug: Unexpected Kriit response format:',
                    kriitResponse
                )
                return
            }

            // Process Kriit's response
            const unsyncedJournalDetails = []
            kriitData.forEach((journalResult) => {
                if (!journalResult?.assignments?.length) return

                // Find matching journal from our data
                const journal = currentPageJournals.find(
                    (j) => j.id === journalResult.subjectExternalId
                )
                if (!journal) return

                const diffDetails = journalResult.assignments
                    .map((assignment) => {

                        // Get a readable assignment name
                        let assignmentName = assignment.assignmentName
                        if (
                            !assignmentName &&
                            assignment.assignmentInstructions
                        ) {

                            // Extract first line or first sentence from instructions
                            assignmentName = assignment.assignmentInstructions
                                .split(/[.!\n]/)[0] // Split by period, exclamation mark or newline
                                .trim()
                                .slice(0, 100) // Limit length
                            if (assignmentName.length === 100) {
                                assignmentName += '...'
                            }
                        }
                        if (!assignmentName) {
                            assignmentName = 'Nimeta ülesanne'
                        }

                        // Find the original assignment in our data to get old grades
                        const originalAssignment = syncData
                            .find(
                                (s) =>
                                    s.subjectExternalId ===
                                    journalResult.subjectExternalId
                            )
                            ?.assignments.find(
                                (a) =>
                                    a.assignmentExternalId ===
                                    assignment.assignmentExternalId
                            )

                        const differentGrades = assignment.results
                            .filter((result) => result.grade) // Only include results where Kriit has a different grade
                            .map((result) => {

                                // Find the original grade for this student
                                const originalGrade =
                                    originalAssignment?.results.find(
                                        (r) =>
                                            r.studentPersonalCode ===
                                            result.studentPersonalCode
                                    )?.grade || ''

                                return {
                                    student: result.studentName,
                                    oldGrade: originalGrade,
                                    newGrade: result.grade
                                }
                            })
                            .filter(
                                (grade) => grade.oldGrade !== grade.newGrade
                            ) // Only include actual differences

                        return {
                            assignmentName,
                            differentGrades
                        }
                    })
                    .filter((diff) => diff.differentGrades.length > 0)

                if (diffDetails.length > 0) {
                    unsyncedJournalDetails.push({
                        name: journalResult.subjectName,
                        id: journalResult.subjectExternalId,
                        differences: diffDetails
                    })
                }
            })

            if (unsyncedJournalDetails.length === 0) return

            // Create banner with improved styling
            const banner = document.createElement('div')
            banner.style.cssText = `
                background-color: #e3f2fd;
                color: #1976d2;
                padding: 20px;
                margin: 16px;
                border-radius: 8px;
                border-left: 5px solid #1976d2;
                font-family: system-ui, -apple-system, sans-serif;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            `

            // Create banner content with improved styling
            const title = document.createElement('h4')
            title.style.cssText = `
                margin: 0 0 16px 0;
                font-size: 20px;
                font-weight: 600;
                color: #1565c0;
                border-bottom: 1px solid #90caf9;
                padding-bottom: 8px;
            `
            title.textContent = 'Sünkroniseerimata hinded'

            const list = document.createElement('ul')
            list.style.cssText = `
                margin: 0;
                padding: 0;
                list-style-type: none;
            `

            unsyncedJournalDetails.forEach((journal) => {
                const journalItem = document.createElement('li')
                journalItem.style.cssText = `
                    margin-bottom: 24px;
                    padding: 16px;
                    background-color: rgba(255,255,255,0.5);
                    border-radius: 6px;
                `

                const journalTitle = document.createElement('div')
                journalTitle.style.cssText = `
                    font-weight: 600;
                    font-size: 18px;
                    margin-bottom: 12px;
                    color: #1565c0;
                `
                journalTitle.textContent = journal.name

                const diffList = document.createElement('ul')
                diffList.style.cssText = `
                    margin: 0;
                    padding-left: 24px;
                    list-style-type: none;
                `

                journal.differences.forEach((diff) => {
                    if (diff.differentGrades.length > 0) {
                        const diffItem = document.createElement('li')
                        diffItem.style.cssText = `
                            margin-bottom: 16px;
                            padding: 12px;
                            background-color: white;
                            border-radius: 4px;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                        `

                        const assignmentTitle = document.createElement('div')
                        assignmentTitle.style.cssText = `
                            font-weight: 500;
                            margin-bottom: 8px;
                            color: #2196f3;
                            padding-bottom: 4px;
                            border-bottom: 1px solid #e3f2fd;
                        `
                        assignmentTitle.textContent = diff.assignmentName

                        const gradesList = document.createElement('ul')
                        gradesList.style.cssText = `
                            margin: 8px 0 0 0;
                            padding-left: 20px;
                            list-style-type: none;
                            font-size: 14px;
                        `

                        diff.differentGrades.forEach((grade) => {
                            const gradeItem = document.createElement('li')
                            gradeItem.style.cssText = `
                                margin-bottom: 4px;
                                padding: 4px 8px;
                                display: flex;
                                justify-content: space-between;
                                align-items: center;
                                background-color: #f5f5f5;
                                border-radius: 4px;
                            `
                            const studentName = document.createElement('span')
                            studentName.textContent = grade.student
                            studentName.style.color = '#333'

                            const gradeTransition =
                                document.createElement('span')
                            gradeTransition.style.cssText = `
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                font-weight: 600;
                            `

                            const oldGrade = document.createElement('span')
                            oldGrade.textContent = grade.oldGrade || '(puudub)'
                            oldGrade.style.color = '#666'

                            const arrow = document.createElement('span')
                            arrow.textContent = '→'
                            arrow.style.color = '#1976d2'

                            const newGrade = document.createElement('span')
                            newGrade.textContent = grade.newGrade
                            newGrade.style.color = '#1976d2'

                            gradeTransition.appendChild(oldGrade)
                            gradeTransition.appendChild(arrow)
                            gradeTransition.appendChild(newGrade)

                            gradeItem.appendChild(studentName)
                            gradeItem.appendChild(gradeTransition)
                            gradesList.appendChild(gradeItem)
                        })

                        diffItem.appendChild(assignmentTitle)
                        diffItem.appendChild(gradesList)
                        diffList.appendChild(diffItem)
                    }
                })

                journalItem.appendChild(journalTitle)
                journalItem.appendChild(diffList)
                list.appendChild(journalItem)
            })

            banner.appendChild(title)
            banner.appendChild(list)

            // Insert banner at the top of the content
            mainContent.insertBefore(banner, mainContent.firstChild)
        } catch (error) {
            console.error('Debug: Failed to sync with Kriit:', error)
            return
        }
    }
}

export default TahvelJournalList
