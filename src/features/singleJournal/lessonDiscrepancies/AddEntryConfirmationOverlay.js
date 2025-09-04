// Lightweight confirmation overlay used by lesson discrepancies feature.
// Exposes `showAddConfirmationOverlay({date,start,count,timetableData,teacherLabel,onConfirm})`
export async function showAddConfirmationOverlay({ date, start, count, timetableData = {}, teacherLabel = '—', onConfirm = null } = {}) {
  try {
    // Remove any existing overlay with known IDs
    document.querySelector('#ra-overlay-add-entry')?.remove()
    document.querySelector('#oa-add-entry-confirmation-overlay')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'ra-overlay-add-entry'
    overlay.style.position = 'fixed'
    overlay.style.left = '0'
    overlay.style.top = '0'
    overlay.style.right = '0'
    overlay.style.bottom = '0'
    overlay.style.background = 'rgba(0,0,0,0.4)'
    overlay.style.zIndex = 99999
    overlay.style.display = 'flex'
    overlay.style.alignItems = 'center'
    overlay.style.justifyContent = 'center'

    const box = document.createElement('div')
    box.style.background = '#fff'
    box.style.padding = '16px'
    box.style.borderRadius = '6px'
    box.style.maxWidth = '520px'
    box.style.width = '90%'
    box.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)'

    const title = document.createElement('h3')
    title.textContent = 'Lisa sissekanne — kinnita'
    title.style.marginTop = '0'
    box.appendChild(title)

    const list = document.createElement('div')
    list.style.margin = '8px 0'
    list.innerHTML = `
      <div><strong>Kuupäev:</strong> ${date || '—'}</div>
      <div><strong>Algus:</strong> ${start ?? '—'}</div>
      <div><strong>Tunnid:</strong> ${count ?? '—'}</div>
      <div><strong>Õpetaja:</strong> ${teacherLabel}</div>
    `
    box.appendChild(list)

    const buttons = document.createElement('div')
    buttons.style.display = 'flex'
    buttons.style.gap = '8px'
    buttons.style.justifyContent = 'flex-end'

    const cancel = document.createElement('button')
    cancel.textContent = 'Tühista'
    cancel.style.padding = '6px 12px'
    cancel.onclick = () => overlay.remove()

    const confirm = document.createElement('button')
    confirm.textContent = 'Kinnita'
    confirm.style.padding = '6px 12px'
    confirm.style.background = '#007bff'
    confirm.style.color = '#fff'
    confirm.style.border = 'none'
    confirm.onclick = async() => {
      try {
        confirm.disabled = true
        if (typeof onConfirm === 'function') await onConfirm()
      } finally {
        overlay.remove()
      }
    }

    buttons.appendChild(cancel)
    buttons.appendChild(confirm)
    box.appendChild(buttons)

    overlay.appendChild(box)
    document.body.appendChild(overlay)

    return overlay
  } catch (err) {
    console.error('showAddConfirmationOverlay error', err)
    return null
  }
}

export default showAddConfirmationOverlay

/**
 * Show a simple non-blocking message overlay. Returns the overlay element (or null on error).
 * Options: { title, message, duration } - duration in ms, 0 means do not auto-dismiss.
 */
export async function showMessageOverlay({ title = 'Teade', message = '', duration = 3000 } = {}) {
  try {
    // Remove any existing message overlay
    document.querySelector('#ra-overlay-message')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'ra-overlay-message'
    overlay.style.position = 'fixed'
    overlay.style.left = '0'
    overlay.style.top = '0'
    overlay.style.right = '0'
    overlay.style.bottom = '0'
    overlay.style.background = 'rgba(0,0,0,0.25)'
    overlay.style.zIndex = 99999
    overlay.style.display = 'flex'
    overlay.style.alignItems = 'center'
    overlay.style.justifyContent = 'center'

    const box = document.createElement('div')
    box.style.background = '#fff'
    box.style.padding = '14px'
    box.style.borderRadius = '6px'
    box.style.maxWidth = '420px'
    box.style.width = '88%'
    box.style.boxShadow = '0 6px 24px rgba(0,0,0,0.18)'
    box.style.textAlign = 'left'

    const h = document.createElement('h4')
    h.textContent = title || 'Teade'
    h.style.margin = '0 0 8px 0'
    h.style.fontSize = '16px'
    box.appendChild(h)

    const p = document.createElement('div')
    p.innerHTML = message || ''
    p.style.marginBottom = '10px'
    box.appendChild(p)

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.justifyContent = 'flex-end'

    const ok = document.createElement('button')
    ok.textContent = 'OK'
    ok.style.padding = '6px 12px'
    ok.style.background = '#007bff'
    ok.style.color = '#fff'
    ok.style.border = 'none'
    ok.onclick = () => overlay.remove()

    btnRow.appendChild(ok)
    box.appendChild(btnRow)

    overlay.appendChild(box)
    document.body.appendChild(overlay)

    if (duration && duration > 0) {
      setTimeout(() => overlay.remove(), duration)
    }

    return overlay
  } catch (err) {
    console.error('showMessageOverlay error', err)
    return null
  }
}
