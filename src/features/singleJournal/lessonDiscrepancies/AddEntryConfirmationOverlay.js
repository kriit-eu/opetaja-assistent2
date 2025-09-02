// Lightweight overlay used to preview the payload for adding a journal entry
// and call a confirmation callback. Kept intentionally small to avoid heavy
// DOM dependencies; it injects a simple modal into the document body.

export async function showAddConfirmationOverlay({ date, start, count, timetableData = {}, teacherLabel = '—', onConfirm = null } = {}) {
  // Remove any existing overlay
  const existing = document.querySelector('#oa-add-entry-confirmation-overlay')
  if (existing) existing.remove()

  const container = document.createElement('div')
  container.id = 'oa-add-entry-confirmation-overlay'
  container.style.position = 'fixed'
  container.style.left = '0'
  container.style.top = '0'
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.display = 'flex'
  container.style.alignItems = 'center'
  container.style.justifyContent = 'center'
  container.style.background = 'rgba(0,0,0,0.4)'
  container.style.zIndex = '99999'

  const card = document.createElement('div')
  card.style.background = '#fff'
  card.style.padding = '18px'
  card.style.borderRadius = '8px'
  card.style.maxWidth = '560px'
  card.style.width = '90%'
  card.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)'

  const title = document.createElement('h3')
  title.textContent = 'Lisa sissekanne — kinnita toiming'
  title.style.marginTop = '0'

  const info = document.createElement('div')
  info.style.margin = '12px 0'
  info.innerHTML = `
    <div><strong>Kuupäev:</strong> ${date ? String(date) : '—'}</div>
    <div><strong>Algustund:</strong> ${start ?? '—'}</div>
    <div><strong>Tunnid:</strong> ${count ?? '—'}</div>
    <div><strong>Õpetaja:</strong> ${teacherLabel}</div>
  `

  const buttons = document.createElement('div')
  buttons.style.display = 'flex'
  buttons.style.gap = '8px'
  buttons.style.justifyContent = 'flex-end'
  buttons.style.marginTop = '16px'

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = 'Tühista'
  cancelBtn.style.padding = '8px 12px'
  cancelBtn.onclick = () => container.remove()

  const confirmBtn = document.createElement('button')
  confirmBtn.textContent = 'Kinnita ja loo'
  confirmBtn.style.padding = '8px 12px'
  confirmBtn.style.background = '#0069d9'
  confirmBtn.style.color = '#fff'
  confirmBtn.style.border = 'none'
  confirmBtn.style.borderRadius = '4px'
  confirmBtn.onclick = async () => {
    try {
      if (typeof onConfirm === 'function') {
        await onConfirm()
      }
    } catch (err) {
      // swallow - callers should handle logging
    } finally {
      container.remove()
    }
  }

  buttons.appendChild(cancelBtn)
  buttons.appendChild(confirmBtn)

  card.appendChild(title)
  card.appendChild(info)
  card.appendChild(buttons)
  container.appendChild(card)
  document.body.appendChild(container)

  // Return a promise that resolves when the dialog is removed (useful if caller awaits)
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        observer.disconnect()
        resolve()
      }
    })
    observer.observe(document.body, { childList: true })
  })
}

export default showAddConfirmationOverlay
