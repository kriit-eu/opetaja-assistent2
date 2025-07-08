# As a teacher, I see the cells in the independent work columns highlighted in red when the due date has passed but no grade has been assigned to the student

## Goal

When the due date for an independent work assignment has passed all grades must be assigned to the students. If the teacher has not assigned a grade to a student, the cell in the journal should be highlighted in red to indicate that the grade is missing. Additionally, a tooltip should be shown when hovering over the cell with the text "Tähtaeg oli mm.dd.yyyy, aga hinne puudub". Additionally, there should be a separate yellow "Õpetaja Assistent 2" banner at the top of the page that says "Mõnedel iseseisvatel töödel on hinded puudu".

## How it works

1. The extension checks if the due date for any independent work assignment has passed.
2. For the assignments that have a passed due date, the extension checks if the teacher has assigned a grade to each student.
3. If the teacher has not assigned a grade to a student, the cell in the journal is highlighted in red.

## Acceptance criteria

- [ ] The cells in the independent work columns are highlighted in red when the due date has passed but no grade has been assigned to the student.
- [ ] The cells are not highlighted if the due date has not passed.
- [ ] The cells are not highlighted if the teacher has assigned a grade to the student.
- [ ] The cells are not highlighted if the assignment is not an independent work assignment.
- [ ] A tooltip is shown when hovering over the cell with the text "Tähtaeg oli mm.dd.yyyy, aga hinne puudub".
- [ ] A yellow banner is shown at the top of the page that says "Mõnedel iseseisvatel töödel on hinded puudu" when there are cells highlighted in red.
