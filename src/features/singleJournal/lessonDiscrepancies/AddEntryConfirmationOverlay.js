// Lightweight confirmation overlay used by lesson discrepancies feature.
// Exposes `showAddConfirmationOverlay({date,start,count,timetableData,teacherLabel,onConfirm})`
export async function showAddConfirmationOverlay({ date, start, count, _timetableData = {}, teacherLabel = '—', onConfirm = null, onOpenForm = null } = {}) {
  try {
    // Remove any existing compact panel
    document.querySelector('#ra-add-entry-panel')?.remove()

    // Compact bottom-right non-blocking panel
    const panel = document.createElement('div')
    panel.id = 'ra-add-entry-panel'
    panel.style.position = 'fixed'
    panel.style.right = '16px'
    panel.style.bottom = '16px'
    panel.style.zIndex = 99999
    panel.style.background = '#fff'
    panel.style.padding = '12px 14px'
    panel.style.borderRadius = '8px'
    panel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.18)'
    panel.style.maxWidth = '360px'
    panel.style.width = '320px'
    panel.style.fontSize = '13px'
    panel.style.color = '#111'

    const titleRow = document.createElement('div')
    titleRow.style.display = 'flex'
    titleRow.style.alignItems = 'center'
    titleRow.style.justifyContent = 'space-between'

    const title = document.createElement('div')
    title.textContent = 'Lisa sissekanne'
    title.style.fontWeight = '600'
    titleRow.appendChild(title)

    const closeX = document.createElement('button')
    closeX.textContent = '✕'
    closeX.style.border = 'none'
    closeX.style.background = 'transparent'
    closeX.style.cursor = 'pointer'
    closeX.style.fontSize = '14px'
    closeX.onclick = () => panel.remove()
    titleRow.appendChild(closeX)

    panel.appendChild(titleRow)

    const info = document.createElement('div')
    info.style.margin = '8px 0'
    info.innerHTML = `
      <div><strong>Kuupäev:</strong> ${date || '—'}</div>
      <div><strong>Algus:</strong> ${start ?? '—'}</div>
      <div><strong>Tunnid:</strong> ${count ?? '—'}</div>
      <div><strong>Õpetaja:</strong> ${teacherLabel}</div>
    `
    panel.appendChild(info)

    const actions = document.createElement('div')
    actions.style.display = 'flex'
    actions.style.gap = '8px'
    actions.style.justifyContent = 'flex-end'

    const cancel = document.createElement('button')
    cancel.textContent = 'Tühista'
    cancel.style.padding = '6px 10px'
    cancel.style.border = '1px solid #d0d0d0'
    cancel.style.background = 'transparent'
    cancel.onclick = () => panel.remove()

    // Optional: open the full form if caller provided a handler
    let openFormBtn = null
    if (typeof onOpenForm === 'function') {
      openFormBtn = document.createElement('button')
      openFormBtn.textContent = 'Ava vorm'
      openFormBtn.style.padding = '6px 10px'
      openFormBtn.style.border = '1px solid #d0d0d0'
      openFormBtn.style.background = 'transparent'
      openFormBtn.onclick = async() => {
        try {
          await onOpenForm()
        } finally {
          panel.remove()
        }
      }
      actions.appendChild(openFormBtn)
    }

    const confirm = document.createElement('button')
    confirm.textContent = 'Lisa'
    confirm.style.padding = '6px 12px'
    confirm.style.background = '#007bff'
    confirm.style.color = '#fff'
    confirm.style.border = 'none'
    confirm.style.cursor = 'pointer'
    confirm.onclick = async() => {
      try {
        confirm.disabled = true
        if (typeof onConfirm === 'function') await onConfirm()
      } finally {
        panel.remove()
      }
    }

    actions.appendChild(cancel)
    actions.appendChild(confirm)
    panel.appendChild(actions)

    document.body.appendChild(panel)
    return panel
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
