// Small helper to inject OA-specific and general final-grade CSS used by FinalGradesByOvFeature
export const OA_FINAL_GRADE_STYLE_ID = 'oa-final-grade-style'
export function injectOaFinalGradeCSS() {
  // Backwards-compatible alias
  injectFinalGradeCSS()
}

export function injectFinalGradeCSS() {
  // If style is already present, skip injection
  if (document.getElementById(OA_FINAL_GRADE_STYLE_ID)) return

  const css = `
    /* OA-specific mismatch border */
    .oa-final-grade-red {
      background: transparent !important;
      box-shadow: none !important;
      border: 2px solid #ff5252 !important; /* red border (mismatch) */
      position: relative;
      cursor: pointer;
    }
  `

  const style = document.createElement('style')
  style.id = OA_FINAL_GRADE_STYLE_ID
  style.textContent = css
  try { document.head.appendChild(style) } catch (e) { document.body.appendChild(style) }
}

export default {
  OA_FINAL_GRADE_STYLE_ID,
  injectOaFinalGradeCSS,
  injectFinalGradeCSS
}

// Helper to mark a cell as mismatched and set tooltip text
export function markMismatch(cell, current, calculated) {
  try {
    injectFinalGradeCSS()
    // Do not mark as mismatch when there is no current grade (null/empty)
    // or when the cell is already marked as missing (highlight-missing-grade).
    if (!current && current !== 0 && current !== '0') {
      // only set tooltip for missing case if possible, but do not add red border
      try { if (cell) cell.title = `Arvutatud hinne: ${calculated}` } catch (e) { /* ignore */ }
      return
    }

    if (cell && cell.classList && !(cell.classList.contains && cell.classList.contains('highlight-missing-grade'))) {
      cell.classList.add('oa-final-grade-red')
    }

    try { cell.title = `Praegune hinne erineb arvutatud hindest\nPraegune: ${current}\nArvutatud: ${calculated}` } catch (e) { /* ignore */ }
  } catch (e) {
    void e
  }
}

// Helper to clear mismatch styling and tooltip
export function clearMismatch(cell) {
  try {
    if (cell && cell.classList) cell.classList.remove('oa-final-grade-red')
    try { cell.title = '' } catch (e) { /* ignore */ }
  } catch (e) {
    void e
  }
}
