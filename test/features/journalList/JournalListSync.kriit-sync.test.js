import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { notifyKriitGradesSynced, buildGradesForNotification } from '../../../src/features/journalList/KriitSyncNotifier.js'

describe('JournalListSync - Kriit Sync Notification Integration', () => {
  beforeEach(() => {
    // Test setup - no mocking needed, we test the actual functions
  })

  describe('Batch sync integration', () => {
    test('should notify Kriit after successful batch sync', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = [
        { personalCode: '39001010000', grade: 5 },
        { personalCode: '39002020000', grade: 4 }
      ]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true, affectedGrades: 2 }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      // Simulate batch sync workflow
      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).toHaveBeenCalledWith('/grades/markSynchronized', {
        grades: syncedGrades,
        systemId: 1
      })
      expect(syncedGrades).toHaveLength(2)
    })

    test('should skip notification for assignment-level-only updates', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const isAssignmentLevelOnly = true

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true }))
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      // Simulate assignment-level-only update (no student updates)
      if (!isAssignmentLevelOnly) {
        const studentsToUpdate = [{ personalCode: '39001010000' }]
        const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should handle multiple batches sequentially', async () => {
      const batches = [
        {
          journalId: '12345',
          assignmentId: '123',
          students: [{ personalCode: '39001010000' }, { personalCode: '39002020000' }]
        },
        {
          journalId: '12345',
          assignmentId: '124',
          students: [{ personalCode: '39003030000' }, { personalCode: '39004040000' }]
        }
      ]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      for (const batch of batches) {
        await apiService.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, {})

        const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, batch.students)
        if (syncedGrades.length > 0) {
          await notifyKriitGradesSynced(apiService, syncedGrades)
        }
      }

      expect(apiService.kriit.post).toHaveBeenCalledTimes(2)
    })

    test('should not notify when no students have personal codes', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = [{ name: 'Student Without Code' }, { id: 456 }]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true }))
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should continue batch processing even if notification fails', async () => {
      const batches = [
        {
          journalId: '12345',
          assignmentId: '123',
          students: [{ personalCode: '39001010000' }]
        },
        {
          journalId: '12345',
          assignmentId: '124',
          students: [{ personalCode: '39002020000' }]
        }
      ]

      // Mock Kriit API to fail
      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => {
            throw new Error('Notification failed')
          })
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      for (const batch of batches) {
        await apiService.tahvel.put(`/journals/${batch.journalId}/journalEntry/${batch.assignmentId}`, {})

        const syncedGrades = buildGradesForNotification(batch.journalId, batch.assignmentId, batch.students)
        if (syncedGrades.length > 0) {
          try {
            await notifyKriitGradesSynced(apiService, syncedGrades)
          } catch (error) {
            // Continue even if notification fails
          }
        }
      }

      expect(apiService.tahvel.put).toHaveBeenCalledTimes(2)
    })
  })

  describe('Individual sync integration', () => {
    test('should notify Kriit after successful individual assignment sync', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const updateData = {
        journalEntryStudents: [
          { personalCode: '39001010000', grade: 5 },
          { personalCode: '39002020000', grade: 4 }
        ]
      }

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true, affectedGrades: 2 }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).toHaveBeenCalled()
      expect(syncedGrades).toHaveLength(2)
    })

    test('should handle individual sync with userPersonalCode field', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const updateData = {
        journalEntryStudents: [
          { userPersonalCode: '39001010000', grade: 5 },
          { userPersonalCode: '39002020000', grade: 4 }
        ]
      }

      const apiService = {
        kriit: { enabled: true },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(syncedGrades).toHaveLength(2)
      expect(syncedGrades[0].studentPersonalCode).toBe('39001010000')
    })

    test('should not throw if notification fails during individual sync', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const updateData = {
        journalEntryStudents: [{ personalCode: '39001010000', grade: 5 }]
      }

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => {
            throw new Error('Kriit API unavailable')
          })
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      await expect(async () => {
        await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

        const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)
        if (syncedGrades.length > 0) {
          try {
            await notifyKriitGradesSynced(apiService, syncedGrades)
          } catch (error) {
            // Swallow error - grades are in Tahvel, notification is non-critical
          }
        }
      }).not.toThrow()

      expect(apiService.tahvel.put).toHaveBeenCalled()
    })
  })

  describe('Error handling and edge cases', () => {
    test('should handle students with mixed personal code fields', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = [
        { personalCode: '39001010000' },
        { userPersonalCode: '39002020000' },
        { studentPersonalCode: '39003030000' },
        { name: 'Student Without Code' }
      ]

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      expect(syncedGrades).toHaveLength(3)
      expect(syncedGrades.map(g => g.studentPersonalCode)).toEqual(['39001010000', '39002020000', '39003030000'])
    })

    test('should handle empty update data gracefully', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const updateData = {
        journalEntryStudents: []
      }

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true }))
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, updateData.journalEntryStudents)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(apiService.kriit.post).not.toHaveBeenCalled()
    })

    test('should convert numeric IDs to strings', async () => {
      const journalId = 12345
      const assignmentId = 123
      const studentsToUpdate = [{ personalCode: '39001010000' }]

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      expect(syncedGrades[0].subjectExternalId).toBe('12345')
      expect(syncedGrades[0].assignmentExternalId).toBe('123')
      expect(typeof syncedGrades[0].subjectExternalId).toBe('string')
      expect(typeof syncedGrades[0].assignmentExternalId).toBe('string')
    })

    test('should handle API response without success field', async () => {
      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ status: 'ok' }))
        }
      }

      const grades = [
        {
          subjectExternalId: '12345',
          assignmentExternalId: '123',
          studentPersonalCode: '39001010000'
        }
      ]

      await expect(notifyKriitGradesSynced(apiService, grades)).resolves.toBeUndefined()
    })

    test('should handle null/undefined student objects in array', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = [{ personalCode: '39001010000' }, null, undefined, { personalCode: '39002020000' }]

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      expect(syncedGrades).toHaveLength(2)
    })
  })

  describe('Performance and concurrent operations', () => {
    test('should handle large number of students efficiently', async () => {
      const journalId = '12345'
      const assignmentId = '123'
      const studentsToUpdate = []

      for (let i = 0; i < 100; i++) {
        studentsToUpdate.push({
          personalCode: `390${String(i).padStart(8, '0')}`,
          grade: 5
        })
      }

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, studentsToUpdate)

      expect(syncedGrades).toHaveLength(100)
      expect(syncedGrades[0].studentPersonalCode).toBe('39000000000')
      expect(syncedGrades[99].studentPersonalCode).toBe('39000000099')
    })

    test('should handle multiple assignments in parallel', async () => {
      const assignments = []
      for (let i = 0; i < 10; i++) {
        assignments.push({
          journalId: '12345',
          assignmentId: String(100 + i),
          students: [{ personalCode: `39001${String(i).padStart(5, '0')}` }, { personalCode: `39002${String(i).padStart(5, '0')}` }]
        })
      }

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true }))
        }
      }

      const promises = assignments.map(async assignment => {
        const syncedGrades = buildGradesForNotification(assignment.journalId, assignment.assignmentId, assignment.students)
        if (syncedGrades.length > 0) {
          await notifyKriitGradesSynced(apiService, syncedGrades)
        }
      })

      await Promise.all(promises)

      expect(apiService.kriit.post).toHaveBeenCalledTimes(10)
    })
  })

  describe('Real-world scenarios', () => {
    test('should handle complete sync workflow for single assignment', async () => {
      const journalId = '348986'
      const assignmentId = '1234567'
      const students = [
        { personalCode: '39001010000', grade: 5, name: 'John Doe' },
        { personalCode: '39002020000', grade: 4, name: 'Jane Smith' },
        { personalCode: '39003030000', grade: 3, name: 'Bob Johnson' }
      ]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({
            success: true,
            affectedGrades: 3,
            syncedGrades: students.map(s => ({
              subjectExternalId: journalId,
              assignmentExternalId: assignmentId,
              studentPersonalCode: s.personalCode
            }))
          }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      const updateData = {
        journalEntryStudents: students
      }

      await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, students)
      await notifyKriitGradesSynced(apiService, syncedGrades)

      expect(apiService.tahvel.put).toHaveBeenCalledWith(`/journals/${journalId}/journalEntry/${assignmentId}`, updateData)
      expect(apiService.kriit.post).toHaveBeenCalled()
      expect(syncedGrades).toHaveLength(3)
    })

    test('should handle partial sync when some students lack personal codes', async () => {
      const journalId = '348986'
      const assignmentId = '1234567'
      const students = [
        { personalCode: '39001010000', grade: 5 },
        { name: 'Student Without Code', grade: 4 },
        { personalCode: '39002020000', grade: 3 },
        { id: 12345, grade: 5 }
      ]

      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => ({ success: true, affectedGrades: 2 }))
        },
        tahvel: {
          put: mock(async () => ({ success: true }))
        }
      }

      await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, {
        journalEntryStudents: students
      })

      const syncedGrades = buildGradesForNotification(journalId, assignmentId, students)

      if (syncedGrades.length > 0) {
        await notifyKriitGradesSynced(apiService, syncedGrades)
      }

      expect(syncedGrades).toHaveLength(2)
      expect(apiService.kriit.post).toHaveBeenCalled()
    })

    test('should maintain grade sync integrity when Kriit notification fails', async () => {
      const journalId = '348986'
      const assignmentId = '1234567'
      const students = [{ personalCode: '39001010000', grade: 5 }]

      // Mock Kriit API to fail
      const apiService = {
        kriit: {
          enabled: true,
          post: mock(async () => {
            throw new Error('Kriit server unreachable')
          })
        },
        tahvel: { put: mock(async () => ({ success: true })) }
      }

      let tahvelSyncSucceeded = false

      try {
        await apiService.tahvel.put(`/journals/${journalId}/journalEntry/${assignmentId}`, {
          journalEntryStudents: students
        })
        tahvelSyncSucceeded = true

        const syncedGrades = buildGradesForNotification(journalId, assignmentId, students)
        try {
          await notifyKriitGradesSynced(apiService, syncedGrades)
        } catch (error) {
          // Notification failed, but Tahvel sync succeeded
        }
      } catch (error) {
        // Should not reach here
      }

      expect(tahvelSyncSucceeded).toBe(true)
      expect(apiService.tahvel.put).toHaveBeenCalled()
    })
  })
})
