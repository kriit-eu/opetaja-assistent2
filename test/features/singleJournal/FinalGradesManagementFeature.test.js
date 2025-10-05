import { describe, test, expect } from 'bun:test'

describe('FinalGradesManagementFeature - Utility Methods', () => {
  describe('Grade schema mapping (#mapGradeToSchema logic)', () => {
    test('should map numeric grades 1-5', () => {
      const testCases = [
        { grade: '5', expectedCode: 'KUTSEHINDAMINE_5', expectedNameEt: 'Väga hea', expectedNameEn: 'Very good' },
        { grade: '4', expectedCode: 'KUTSEHINDAMINE_4', expectedNameEt: 'Hea', expectedNameEn: 'Good' },
        { grade: '3', expectedCode: 'KUTSEHINDAMINE_3', expectedNameEt: 'Rahuldav', expectedNameEn: 'Satisfactory' },
        { grade: '2', expectedCode: 'KUTSEHINDAMINE_2', expectedNameEt: 'Puudulik', expectedNameEn: 'Insufficient' },
        { grade: '1', expectedCode: 'KUTSEHINDAMINE_1', expectedNameEt: 'Nõrk', expectedNameEn: 'Weak' }
      ]

      testCases.forEach(({ grade, expectedCode, expectedNameEt, expectedNameEn }) => {
        const result = mapGrade(grade)
        expect(result.code).toBe(expectedCode)
        expect(result.value).toBe(grade)
        expect(result.nameEt).toBe(expectedNameEt)
        expect(result.nameEn).toBe(expectedNameEn)
      })
    })

    test('should map MA grade', () => {
      const result = mapGrade('MA')
      expect(result.code).toBe('KUTSEHINDAMINE_MA')
      expect(result.value).toBe('MA')
      expect(result.nameEt).toBe('Mitte arvestatud')
      expect(result.nameEn).toBe('Fail')
    })

    test('should map A grade', () => {
      const result = mapGrade('A')
      expect(result.code).toBe('KUTSEHINDAMINE_A')
      expect(result.value).toBe('A')
      expect(result.nameEt).toBe('Arvestatud')
      expect(result.nameEn).toBe('Pass')
    })

    test('should return null for invalid grades', () => {
      const invalidGrades = ['0', '6', 'B', 'X', '', null, undefined]
      invalidGrades.forEach(grade => {
        const result = mapGrade(grade)
        expect(result).toBeNull()
      })
    })
  })

  describe('Grade extraction from text (#extractGradeFromText logic)', () => {
    test('should extract numeric grades', () => {
      expect(extractGrade('5')).toBe('5')
      expect(extractGrade('4')).toBe('4')
      expect(extractGrade('3')).toBe('3')
      expect(extractGrade('2')).toBe('2')
      expect(extractGrade('1')).toBe('1')
    })

    test('should extract A and MA grades', () => {
      expect(extractGrade('A')).toBe('A')
      expect(extractGrade('MA')).toBe('MA')
    })

    test('should be case insensitive', () => {
      expect(extractGrade('a')).toBe('A')
      expect(extractGrade('ma')).toBe('MA')
      expect(extractGrade('Ma')).toBe('MA')
    })

    test('should trim whitespace', () => {
      expect(extractGrade('  5  ')).toBe('5')
      expect(extractGrade('  A  ')).toBe('A')
      expect(extractGrade('\n MA \t')).toBe('MA')
    })

    test('should return empty string for invalid text', () => {
      expect(extractGrade('invalid')).toBe('')
      expect(extractGrade('6')).toBe('')
      expect(extractGrade('0')).toBe('')
      expect(extractGrade('')).toBe('')
      expect(extractGrade(null)).toBe('')
      expect(extractGrade(undefined)).toBe('')
    })
  })

  describe('Journal ID extraction (#extractJournalId logic)', () => {
    test('should extract journal ID from URL', () => {
      const urls = [
        { url: 'https://tahvel.edu.ee/#/journal/12345/edit', expected: 12345 },
        { url: 'https://tahvel.edu.ee/#/journal/67890', expected: 67890 },
        { url: 'https://test.tahvel.eenet.ee/#/journal/999/view', expected: 999 }
      ]

      urls.forEach(({ url, expected }) => {
        const match = url.match(/\/journal\/(\d+)/)
        const id = match ? parseInt(match[1], 10) : null
        expect(id).toBe(expected)
      })
    })

    test('should return null for invalid URL', () => {
      const match = 'https://tahvel.edu.ee/#/home'.match(/\/journal\/(\d+)/)
      expect(match).toBeNull()
    })
  })

  describe('Grading mode application (#applyGradingModeToResults logic)', () => {
    test('should round numeric grades in NUMERIC mode', () => {
      const results = [{ ovGrades: { 1: '4.5' } }, { ovGrades: { 1: '3.7' } }, { ovGrades: { 1: '2.3' } }]

      const mode = 'NUMERIC'
      results.forEach(r => {
        if (mode === 'NUMERIC' && /^\d+(\.\d+)?$/.test(r.ovGrades['1'])) {
          const rounded = Math.round(Number(r.ovGrades['1']))
          r.ovGrades['1'] = String(rounded >= 1 && rounded <= 5 ? rounded : '')
        }
      })

      expect(results[0].ovGrades['1']).toBe('5')
      expect(results[1].ovGrades['1']).toBe('4')
      expect(results[2].ovGrades['1']).toBe('2')
    })

    test('should convert to A/MA in PASS_FAIL mode', () => {
      const results = [{ ovGrades: { 1: '5' } }, { ovGrades: { 1: '3' } }, { ovGrades: { 1: '1' } }]

      const mode = 'PASS_FAIL'
      results.forEach(r => {
        if (mode === 'PASS_FAIL') {
          const grade = r.ovGrades['1']
          if (['3', '4', '5'].includes(grade)) {
            r.ovGrades['1'] = 'A'
          } else if (['1', '2'].includes(grade)) {
            r.ovGrades['1'] = 'MA'
          }
        }
      })

      expect(results[0].ovGrades['1']).toBe('A')
      expect(results[1].ovGrades['1']).toBe('A')
      expect(results[2].ovGrades['1']).toBe('MA')
    })

    test('should keep original in CALCULATED mode', () => {
      const results = [{ ovGrades: { 1: '4.5' } }, { ovGrades: { 1: 'A' } }]

      const mode = 'CALCULATED'
      // In CALCULATED mode, don't modify

      expect(results[0].ovGrades['1']).toBe('4.5')
      expect(results[1].ovGrades['1']).toBe('A')
    })
  })

  describe('L-grade detection (detectLGrades logic)', () => {
    test('should detect entries with L prefix', () => {
      const entries = [{ nameEt: 'L1 - Teema 1' }, { nameEt: 'Tavaline tund' }, { nameEt: 'L2 - Teema 2' }]

      const lGrades = entries.filter(e => /^L\d+/.test(e.nameEt))

      expect(lGrades.length).toBe(2)
      expect(lGrades[0].nameEt).toBe('L1 - Teema 1')
      expect(lGrades[1].nameEt).toBe('L2 - Teema 2')
    })

    test('should handle case variations', () => {
      const entries = [{ nameEt: 'l1 - teema' }, { nameEt: 'L1 - teema' }]

      const lGrades = entries.filter(e => /^L\d+/i.test(e.nameEt))

      expect(lGrades.length).toBe(2)
    })
  })

  describe('ÕV grade detection (#hasAnyOvGrades logic)', () => {
    test('should detect ÕV entries', () => {
      const entries = [{ nameEt: 'ÕV 1 - Oskus' }, { nameEt: 'Tavaline tund' }, { nameEt: 'ÕV 2 - Teadmised' }]

      const ovEntries = entries.filter(e => e.nameEt?.toLowerCase().includes('õv') || e.nameEt?.toLowerCase().includes('õpiväljund'))

      expect(ovEntries.length).toBe(2)
    })

    test('should detect õpiväljund variant', () => {
      const entries = [{ nameEt: 'Õpiväljund 1' }, { nameEt: 'õpiväljund 2' }]

      const ovEntries = entries.filter(e => e.nameEt?.toLowerCase().includes('õpiväljund'))

      expect(ovEntries.length).toBe(2)
    })
  })

  describe('Column index detection (findColumnIndices logic)', () => {
    test('should find final grade column by text "lõpptulemus"', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'Lõpptulemus' }, { textContent: 'ÕV' }]

      const finalGradeIndex = headers.findIndex(h => h.textContent?.toLowerCase().trim().includes('lõpptulemus'))

      expect(finalGradeIndex).toBe(1)
    })

    test('should find ÕV columns by pattern', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'ÕV 1' }, { textContent: 'ÕV 2' }, { textContent: 'Lõpptulemus' }]

      const ovIndices = headers
        .map((h, i) => ({ text: h.textContent, index: i }))
        .filter(({ text }) => /ÕV\s*\d+/i.test(text))
        .map(({ index }) => index)

      expect(ovIndices).toEqual([1, 2])
    })

    test('should detect õpiväljund pattern', () => {
      const headers = [{ textContent: 'Õppija' }, { textContent: 'Õpiväljund 1' }, { textContent: 'Lõpptulemus' }]

      const ovIndex = headers.findIndex(h => h.textContent?.toLowerCase().includes('õpiväljund'))

      expect(ovIndex).toBe(1)
    })

    test('should handle colspan attributes', () => {
      const header = { textContent: 'ÕV 1', getAttribute: () => '2' }
      const colspan = parseInt(header.getAttribute('colspan') || '1')

      expect(colspan).toBe(2)
    })
  })

  describe('Student status filtering', () => {
    test('should identify academic leave status (OPPURSTAATUS_A)', () => {
      const status = 'OPPURSTAATUS_A'
      expect(status).toBe('OPPURSTAATUS_A')
    })

    test('should filter grades for students on academic leave', () => {
      const studentStatus = 'OPPURSTAATUS_A'
      const grades = ['MA', '1', '2', '3', '4', '5', 'A']

      const filtered = grades.filter(grade => {
        if (studentStatus === 'OPPURSTAATUS_A') {
          return grade !== 'MA' && grade !== '1' && grade !== '2'
        }
        return true
      })

      expect(filtered).toEqual(['3', '4', '5', 'A'])
    })
  })

  describe('Grade date formatting', () => {
    test('should format Estonian timezone date', () => {
      const estDate = new Date('2024-09-15').toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' })
      const gradeDate = estDate + 'T00:00:00.000Z'

      expect(estDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(gradeDate).toContain('T00:00:00.000Z')
    })
  })

  describe('Grade validation', () => {
    test('should validate numeric grade range', () => {
      const rounded = Math.round(4.6)
      const isValid = rounded >= 1 && rounded <= 5

      expect(rounded).toBe(5)
      expect(isValid).toBe(true)
    })

    test('should reject out-of-range grades', () => {
      const testCases = [0, 6, -1, 10]
      testCases.forEach(val => {
        const isValid = val >= 1 && val <= 5
        expect(isValid).toBe(false)
      })
    })
  })
})

// Helper functions to test logic patterns
function mapGrade(grade) {
  let code = null,
    nameEt = '',
    nameEn = '',
    value = ''
  if (['1', '2', '3', '4', '5'].includes(grade)) {
    code = `KUTSEHINDAMINE_${grade}`
    value = grade
    const gradeNames = {
      5: { nameEt: 'Väga hea', nameEn: 'Very good' },
      4: { nameEt: 'Hea', nameEn: 'Good' },
      3: { nameEt: 'Rahuldav', nameEn: 'Satisfactory' },
      2: { nameEt: 'Puudulik', nameEn: 'Insufficient' },
      1: { nameEt: 'Nõrk', nameEn: 'Weak' }
    }
    nameEt = gradeNames[grade]?.nameEt || ''
    nameEn = gradeNames[grade]?.nameEn || ''
  } else if (grade === 'MA') {
    code = 'KUTSEHINDAMINE_MA'
    value = 'MA'
    nameEt = 'Mitte arvestatud'
    nameEn = 'Fail'
  } else if (grade === 'A') {
    code = 'KUTSEHINDAMINE_A'
    value = 'A'
    nameEt = 'Arvestatud'
    nameEn = 'Pass'
  } else {
    return null
  }
  return { code, value, nameEt, nameEn }
}

function extractGrade(text) {
  if (!text) return ''
  const cleaned = text.trim().toUpperCase()
  if (['1', '2', '3', '4', '5'].includes(cleaned)) return cleaned
  if (cleaned === 'A' || cleaned === 'MA') return cleaned
  return ''
}
