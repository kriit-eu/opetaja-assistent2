// A complete journal snapshot can also contain zero absences.
export function lessonAttendance(entries, results, students, groupName, journalGroups) {
  const roster = new Map(students.map(student => [String(student.id), student]))
  const byId = new Map(results.map(entry => [entry.id, entry]))
  const lessons = entries.filter(entry => entry.entryType === 'SISSEKANNE_T')
  if (lessons.length !== results.filter(entry => entry.entryType === 'SISSEKANNE_T').length) return null
  const snapshots = []
  for (const entry of lessons) {
    const result = byId.get(entry.id)
    if (!result || !result.journalStudentResults || !roster.size) return null
    const names = new Set()
    for (const [id, marks] of Object.entries(result.journalStudentResults)) {
      for (const mark of marks) {
        const periods = Object.values(mark.lessonAbsences || {})
        const codes = [mark.absence, ...periods.map(period => period.absence ?? period)]
        if (!codes.some(value => ['PUUDUMINE_P', 'PUUDUMINE_V', 'PUUDUMINE_PR'].includes(value?.code ?? value))) continue
        const student = roster.get(id)
        if (!student || !student.fullname) return null
        if ((journalGroups.length === 1 && journalGroups[0] === groupName || student.studentGroup === groupName) && student.status !== 'OPPURSTAATUS_A') names.add(student.fullname)
      }
    }
    snapshots.push({ id: entry.id, date: entry.entryDate.slice(0, 10), names: [...names] })
  }
  return snapshots
}

export function lessonEntries(entries) {
  return entries.filter(entry => entry.entryType === 'SISSEKANNE_T').map(entry => ({
    id: entry.id,
    nameEt: entry.nameEt || 'Loeng',
    entryType: entry.entryType,
    entryDate: entry.entryDate,
    content: entry.content || ''
  }))
}
