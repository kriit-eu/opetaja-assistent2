// Test the duplicate request prevention logic
import { test, expect, describe } from 'bun:test'

describe('Duplicate Student Cache Prevention', () => {
    // Simulate the corrected logic
    class MockStudentProcessor {
        constructor() {
            this.globalStudentCache = {};
            this.pendingStudentRequests = new Map();
            this.apiCallCount = 0;
        }

        async processStudentData(journalStudents) {
            const studentPromises = journalStudents.map(async (journalStudent) => {
                console.log(`Processing student ${journalStudent.studentId}`);

                // Check global runtime cache first (fastest)
                if (this.globalStudentCache[journalStudent.studentId]) {
                    console.log(`Student ${journalStudent.studentId} found in global cache - reusing`);
                    return {
                        studentId: journalStudent.studentId,
                        data: this.globalStudentCache[journalStudent.studentId]
                    };
                }

                // Check if there's already a pending request for this student
                if (this.pendingStudentRequests.has(journalStudent.studentId)) {
                    console.log(`Student ${journalStudent.studentId} request already in progress - waiting for result`);
                    const data = await this.pendingStudentRequests.get(journalStudent.studentId);
                    return { studentId: journalStudent.studentId, data };
                }

                // Simulate API call with promise tracking
                const fetchPromise = (async () => {
                    this.apiCallCount++;
                    console.log(`Making API call #${this.apiCallCount} for student ${journalStudent.studentId}`);

                    // Simulate API delay
                    await new Promise(resolve => setTimeout(resolve, 50));

                    const studentData = {
                        personalCode: `PC${journalStudent.studentId}`,
                        name: `Student ${journalStudent.studentId}`,
                        isActive: true
                    };

                    // Add to global cache
                    this.globalStudentCache[journalStudent.studentId] = studentData;
                    console.log(`Added student ${journalStudent.studentId} to global cache`);

                    return studentData;
                })();

                // Store the promise in pending requests
                this.pendingStudentRequests.set(journalStudent.studentId, fetchPromise);

                // Clean up when done
                fetchPromise.finally(() => {
                    this.pendingStudentRequests.delete(journalStudent.studentId);
                });

                const studentData = await fetchPromise;
                return { studentId: journalStudent.studentId, data: studentData };
            });

            return Promise.all(studentPromises);
        }
    }

    test('should prevent duplicate API calls for same student', async () => {
        const processor = new MockStudentProcessor();
        const journalStudents = [
            { studentId: 84551 },
            { studentId: 84552 },
            { studentId: 84551 }, // Duplicate - should reuse cache or pending request
            { studentId: 84553 },
            { studentId: 84551 }, // Another duplicate
        ];

        console.log('\n--- Starting test with duplicates ---');

        const results = await processor.processStudentData(journalStudents);

        console.log('\n--- Results ---');
        console.log(`Total API calls made: ${processor.apiCallCount}`);
        console.log(`Expected API calls: 3 (for unique students 84551, 84552, 84553)`);
        console.log(`Results count: ${results.length}`);
        console.log('Results:', results.map(r => ({ studentId: r.studentId, hasData: !!r.data })));

        // Verify that only 3 API calls were made (one for each unique student)
        expect(processor.apiCallCount).toBe(3);

        // Verify that we got results for all 5 requests
        expect(results).toHaveLength(5);

        // Verify that all results have data
        results.forEach(result => {
            expect(result.data).toBeDefined();
            expect(result.data.personalCode).toBeDefined();
            expect(result.data.name).toBeDefined();
            expect(result.data.isActive).toBe(true);
        });

        if (processor.apiCallCount === 3) {
            console.log('\n✅ SUCCESS: Duplicate requests prevented!');
        } else {
            console.log('\n❌ FAILURE: Duplicate requests were made');
        }
    });

    test('should handle empty student list', async () => {
        const processor = new MockStudentProcessor();
        const results = await processor.processStudentData([]);

        expect(results).toHaveLength(0);
        expect(processor.apiCallCount).toBe(0);
    });

    test('should handle single student', async () => {
        const processor = new MockStudentProcessor();
        const journalStudents = [{ studentId: 12345 }];

        const results = await processor.processStudentData(journalStudents);

        expect(results).toHaveLength(1);
        expect(processor.apiCallCount).toBe(1);
        expect(results[0].studentId).toBe(12345);
        expect(results[0].data.personalCode).toBe('PC12345');
    });
});
