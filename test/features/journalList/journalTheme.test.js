import chrome from '../../mocks/chrome.js'
import { test, expect } from 'bun:test'
import { getTahvelSubjectsWithAssignmentsAndGrades } from '../../../src/features/journalList/JournalListSync'

// Minimal test to ensure journalTheme is included when journal info contains curriculumVersions themes
test('includes journalTheme when curriculumVersions contains themes', async () => {
  const apiMock = {
    tahvel: {
      get: async endpoint => {
        if (endpoint === '/journals/123') {
          return {
            id: 123,
            nameEt: 'Test subject',
            curriculumVersions: [
              {
                themes: [{ id: 476998, nameEt: 'Keevitustehnoloogia' }]
              }
            ],
            journalTeachers: []
          }
        }
        if (endpoint === '/journals/123/journalStudents?allStudents=true') return [{ id: 10, studentId: 1, fullname: 'Student One', studentGroup: 'G1' }]
        if (endpoint === '/journals/123/journalEntriesByDate?allStudents=true')
          return [
            {
              entryDate: '2025-09-01T00:00:00Z',
              nameEt: 'Test assignment',
              entryType: 'SISSEKANNE_I',
              id: 555,
              journalStudentResults: {
                10: [{ journalStudentId: 10, grade: { code: 'KUTSEHINDAMINE_MA' } }]
              }
            }
          ]
        if (endpoint === '/students/1')
          return { id: 1, person: { idcode: '38001010001', firstname: 'Student', lastname: 'One' }, status: 'OPPURSTAATUS_O' }
        // Simulate theme endpoint call
        if (endpoint === '/journals/123/theme/476998') return { id: 476998, content: 'Theme body' }
        return null
      }
    }
  }

  const result = await getTahvelSubjectsWithAssignmentsAndGrades.call({ api: apiMock }, [123])
  expect(result).toHaveLength(1)
  expect(result[0].journalTheme).toBeDefined()
  expect(result[0].journalTheme.id).toBe(476998)
})
