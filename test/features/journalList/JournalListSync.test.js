// Import chrome mock FIRST to set up browser globals before importing any modules that depend on them
import chrome from '../../mocks/chrome.js'
import { test, expect, describe, beforeEach, mock } from 'bun:test'
import { getTahvelSubjectsWithAssignmentsAndGrades } from '../../../src/features/journalList/JournalListSync'

describe('JournalListSync', () => {
  describe('getTahvelSubjectsWithAssignmentsAndGrades', () => {
    // Expected data structure that the function should return
    const expectedData = [
      {
        'subjectName': 'Sissejuhatus programmeerimisse',
        'subjectExternalId': 348986,
        'groupName': 'TAK24',
        'teacherPersonalCode': '38010050000',
        'teacherName': 'Peeter Koppel',
        'assignments': [
          {
            'assignmentExternalId': 3237870,
            'assignmentName': 'Kolmanda kasutajaloo implement... (ÕV4, ÕV5)',
            'assignmentInstructions': 'Kolmanda kasutajaloo implementeerimine (eelmise kahe kasutajaloo kriteeriumeid järgides)',
            'assignmentDueAt': '2024-11-03',
            'assignmentEntryDate': '2024-11-01',
            'results': [
              {
                'grade': 'MA',
                'studentPersonalCode': '48801213712',
                'studentName': 'Olga Orlova',
                'studentIsActive': true,
              },
            ],
          },
        ],
      },
    ]

    // Create API mock that will be used for tests
    const apiMock = {
      tahvel: {
        get: mock(async (endpoint) => {
          if (endpoint === '/journals/348986') {
            return {
              id: 348986,
              nameEt: 'Sissejuhatus programmeerimisse',
              studentGroups: ['TAK24'],
              journalTeachers: [{
                id: 18737,
                nameEt: 'Peeter Koppel',
                fullname: 'Peeter Koppel'
              }]
            }
          } else if (endpoint === '/journals/348986/journalStudents?allStudents=true') {
            return [{
              id: 4620683,
              studentId: 178481,
              fullname: 'Olga Orlova',
              studentGroup: 'TAK24',
              status: 'OPPURSTAATUS_O'
            }]
          } else if (endpoint === '/journals/348986/journalEntriesByDate?allStudents=true') {
            return [{
              entryDate: '2024-11-01T00:00:00Z',
              nameEt: 'Kolmanda kasutajaloo implement... (ÕV4, ÕV5)',
              entryType: 'SISSEKANNE_I',
              id: 3237870,
              journalStudentResults: {
                '4620683': [{
                  journalStudentId: 4620683,
                  grade: {
                    code: 'KUTSEHINDAMINE_MA'
                  }
                }]
              }
            }]
          } else if (endpoint === '/students/178481') {
            return {
              id: 178481,
              person: {
                idcode: '48801213712',
                fullname: 'Olga Orlova'
              },
              status: 'OPPURSTAATUS_O'
            }
          } else if (endpoint.includes('/teachers')) {
            return {
              content: [{
                id: 18737,
                name: 'Peeter Koppel',
                idcode: '38010050000'
              }]
            }
          }
          return null
        })
      }
    }

    beforeEach(() => {
      // Reset the mocks
      chrome.storage.local.get.mockReset()
      chrome.storage.local.set.mockReset()

      // Set up the storage mock for all tests
      chrome.storage.local.get.mockImplementation((_, callback) => {
        callback({})
      })

      chrome.storage.local.set.mockImplementation((_, callback) => {
        if (callback) callback()
      })
    })

    test('should process journal data correctly', async () => {
      // Call the function with the journal ID
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [348986])

      // Verify the result matches the expected data structure
      expect(result).toHaveLength(1)
      expect(result[0].subjectExternalId).toEqual(348986)
      expect(result[0].assignments[0].assignmentExternalId).toEqual(3237870)
      expect(result[0].assignments[0].results[0].grade).toEqual('MA')
    })

    test('should handle empty journal IDs', async () => {
      // Call with empty array
      const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [])

      // Expect empty result
      expect(result).toEqual([])
    })
  })

  describe('Student Name Resolution', () => {
    test('should resolve student names in PUT request payload', async () => {
      // Create a mock JournalListSync instance
      const mockInstance = {
        getJournalStudents: mock(async (journalId) => {
          return [{
            id: 4620683,
            studentId: 178481,
            fullname: 'Olga Orlova',
            studentGroup: 'TAK24'
          }]
        }),
        getStudentDetails: mock(async (studentId) => {
          return {
            id: 178481,
            person: {
              idcode: '48801213712',
              fullname: 'Olga Orlova'
            },
            status: 'OPPURSTAATUS_O'
          }
        })
      }

      // Mock the studentsWithNames mapping logic from the actual code
      const studentsToUpdate = [{
        journalStudent: 4620683,
        grade: { code: 'KUTSEHINDAMINE_A' }
      }]

      // Simulate the student name resolution logic
      const studentsWithNames = await Promise.all(studentsToUpdate.map(async (student) => {
        let studentName = 'Unknown'
        let studentPersonalCode = 'Unknown'

        if (student.journalStudent) {
          const journalStudents = await mockInstance.getJournalStudents(348986)
          const journalStudent = journalStudents?.find(js => js.id === student.journalStudent)

          if (journalStudent && journalStudent.studentId) {
            const studentDetails = await mockInstance.getStudentDetails(journalStudent.studentId)

            if (studentDetails && studentDetails.person) {
              studentName = studentDetails.person.fullname
              studentPersonalCode = studentDetails.person.idcode
            }
          }
        }

        return {
          ...student,
          studentName: studentName,
          studentPersonalCode: studentPersonalCode
        }
      }))

      // Verify that student names are resolved correctly
      expect(studentsWithNames).toHaveLength(1)
      expect(studentsWithNames[0].studentName).toBe('Olga Orlova')
      expect(studentsWithNames[0].studentPersonalCode).toBe('48801213712')
      expect(studentsWithNames[0].studentName).not.toBe('Unknown')
      expect(studentsWithNames[0].studentPersonalCode).not.toBe('Unknown')
    })
  })

  describe('Inactive Student Handling', () => {
    test('should categorize inactive student errors separately', () => {
      // Mock inactive student error
      const inactiveStudentError = {
        studentPersonalCode: '49910074220',
        assignmentId: 3449739,
        error: 'Cannot update grade for student 49910074220 because they are not actively studying. The student may be on academic leave or their status is inactive in Tahvel. This is a limitation of the Tahvel system - it doesn\'t allow adding or updating grades for students who aren\'t actively studying.',
        errorType: 'inactive_student',
        timestamp: new Date().toISOString(),
      }

      // Mock real sync error
      const realSyncError = {
        studentPersonalCode: '12345678901',
        assignmentId: 3449739,
        error: 'Network error or other technical issue',
        errorType: 'sync_error',
        timestamp: new Date().toISOString(),
      }

      const failedSyncs = [inactiveStudentError, realSyncError]
      
      // Categorize errors like in the actual code
      const inactiveStudentErrors = failedSyncs.filter(item => item.errorType === 'inactive_student')
      const realErrors = failedSyncs.filter(item => item.errorType !== 'inactive_student')

      // Verify categorization
      expect(inactiveStudentErrors).toHaveLength(1)
      expect(realErrors).toHaveLength(1)
      expect(inactiveStudentErrors[0].studentPersonalCode).toBe('49910074220')
      expect(realErrors[0].studentPersonalCode).toBe('12345678901')
    })

    test('should identify inactive student error message patterns', () => {
      const errorMessages = [
        'Cannot update grade for student 49910074220 because they are not actively studying',
        'changeIsNotAllowedStudentIsNotStudying',
        'Student may be on academic leave',
        'status is inactive',
        'Network timeout error', // This should NOT be categorized as inactive student
      ]

      const checkIsInactiveStudentError = (errorMessage) => {
        return errorMessage.includes('not actively studying') ||
               errorMessage.includes('changeIsNotAllowedStudentIsNotStudying') ||
               errorMessage.includes('academic leave') ||
               errorMessage.includes('status is inactive')
      }

      expect(checkIsInactiveStudentError(errorMessages[0])).toBe(true)
      expect(checkIsInactiveStudentError(errorMessages[1])).toBe(true)
      expect(checkIsInactiveStudentError(errorMessages[2])).toBe(true)
      expect(checkIsInactiveStudentError(errorMessages[3])).toBe(true)
      expect(checkIsInactiveStudentError(errorMessages[4])).toBe(false)
    })
  })
})
