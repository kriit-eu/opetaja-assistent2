/**
 * VersionCheckService - Shows update modal when background script detects an update
 *
 * Architecture:
 * - background.js calls requestUpdateCheck() and listens for onUpdateAvailable
 * - When an update is detected, background.js sends a message to content script tabs
 * - This service listens for that message and shows a modal overlay on the Tahvel page
 * - Dismiss state is persisted to chrome.storage.session so the modal only shows once per version
 */

import Logger from './Logger.js'

const DISMISS_KEY = 'oa2_update_banner_dismissed'

// 'modal' = overlay on Tahvel page, 'tab' = open dedicated page in new tab
const UPDATE_DISPLAY_MODE = 'tab'

const PATCH_NOTES = [
  { tag: 'UUS', type: 'new', text: 'Koolide vahel vahetamine ei kaota enam vahemälu andmeid' },
  { tag: 'UUS', type: 'new', text: 'API silumisandmete allalaadimine veaotsinguks' },
  { tag: 'UUS', type: 'new', text: 'Iseseisva töö puuduvate hinnete esiletõstmise sisse/välja lülitamine' },
  { tag: 'PARANDUS', type: 'fix', text: 'Lõpptulemus ei kirjutata enam üle, kui SISSEKANNE_T/I hindeid pole' },
  { tag: 'PARANDUS', type: 'fix', text: 'Hinnatud iseseisva töö lahtri kohal hõljumine ei käivita enam esiletõstmist uuesti' },
  { tag: 'PAREM', type: 'improved', text: 'Tunniplaani lahknevuste tuvastamine töötab kõigis koolides' }
]

const TAG_STYLES = {
  new: 'background:#e8f5e9;color:#2e7d32',
  fix: 'background:#fff3e0;color:#e65100',
  improved: 'background:#e3f2fd;color:#1565c0'
}

class VersionCheckService {
  constructor() {
    this.shown = false
  }

  /**
   * Register message listener for update notifications from background script.
   * Call once during extension initialization.
   */
  listenForUpdates() {
    chrome.runtime.onMessage.addListener(message => {
      if (message.action === 'updateAvailable') {
        Logger.info('[VersionCheckService] Received update notification:', message.version)
        this.#showUpdateIfNotDismissed(message.version || null)
      }
    })
  }

  /**
   * Check dismiss state before showing modal
   * @param {string|null} version - Available version string
   */
  async #showUpdateIfNotDismissed(version) {
    try {
      const result = await chrome.storage.session.get(DISMISS_KEY)
      if (result[DISMISS_KEY] && result[DISMISS_KEY] === version) {
        Logger.debug('[VersionCheckService] Update already shown for this version, skipping')
        return
      }
    } catch (error) {
      Logger.debug('[VersionCheckService] Could not check dismiss state:', error.message)
    }

    if (UPDATE_DISPLAY_MODE === 'tab') {
      this.#openTab(version)
    } else {
      this.#showModal(version)
    }
  }

  /**
   * Open the update notification page in a new tab
   * @param {string|null} version - Available version string
   */
  #openTab(version) {
    if (this.shown) return
    this.shown = true

    const url = version
      ? chrome.runtime.getURL(`update.html?v=${version}`)
      : chrome.runtime.getURL('update.html')

    chrome.runtime.sendMessage({ action: 'openTab', url })
    chrome.storage.session.set({ [DISMISS_KEY]: version }).catch(() => {})
    Logger.info('[VersionCheckService] Update tab opened')
  }

  /**
   * Dismiss and remove the modal
   * @param {HTMLElement} overlay - The modal overlay element
   * @param {string|null} version - Version to persist as dismissed
   */
  #dismiss(overlay, version) {
    overlay.remove()
    chrome.storage.session.set({ [DISMISS_KEY]: version }).catch(() => {})
  }

  /**
   * Show update notification as a modal overlay on the current page
   * @param {string|null} version - Available version string
   */
  #showModal(version) {
    if (this.shown || document.getElementById('oa2-update-modal')) return
    this.shown = true

    // Overlay backdrop
    const overlay = document.createElement('div')
    overlay.id = 'oa2-update-modal'
    overlay.style.cssText = `
      position:fixed; top:0; left:0; right:0; bottom:0;
      background:rgba(0,0,0,0.5);
      display:flex; justify-content:center; align-items:center;
      z-index:99999;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    `

    // Card
    const card = document.createElement('div')
    card.style.cssText = `
      background:white; border-radius:12px;
      box-shadow:0 4px 24px rgba(0,0,0,0.2);
      padding:40px; max-width:560px; width:90%; max-height:90vh; overflow-y:auto;
    `

    // Header
    const header = document.createElement('div')
    header.style.cssText = 'text-align:center;margin-bottom:28px'

    const icon = document.createElement('div')
    icon.style.cssText = 'font-size:48px;margin-bottom:16px'
    icon.textContent = '✨'

    const title = document.createElement('h1')
    title.style.cssText = 'font-size:22px;color:#333;margin:0 0 8px'
    title.textContent = 'Õpetaja Assistent 2 uuendus'

    header.appendChild(icon)
    header.appendChild(title)

    if (version) {
      const versionEl = document.createElement('div')
      versionEl.style.cssText = 'font-size:15px;color:#666;margin-bottom:16px'
      versionEl.textContent = `Versioon ${version}`
      header.appendChild(versionEl)
    }

    const hint = document.createElement('p')
    hint.style.cssText = 'font-size:14px;color:#888;line-height:1.5;margin:0'
    hint.textContent = 'Chrome uuendab laiendust automaatselt. Sulgege ja avage brauser uuesti, et uuendus rakenduks.'
    header.appendChild(hint)

    // Patch notes
    const changes = document.createElement('div')
    changes.style.cssText = 'margin-bottom:28px'

    const changesTitle = document.createElement('h2')
    changesTitle.style.cssText = 'font-size:16px;color:#333;margin:0 0 12px'
    changesTitle.textContent = 'Mis on uut?'
    changes.appendChild(changesTitle)

    const list = document.createElement('ul')
    list.style.cssText = 'list-style:none;padding:0;margin:0'

    PATCH_NOTES.forEach((note, i) => {
      const li = document.createElement('li')
      li.style.cssText = `font-size:14px;color:#555;line-height:1.6;padding:6px 0;${i < PATCH_NOTES.length - 1 ? 'border-bottom:1px solid #f0f0f0' : ''}`

      const tag = document.createElement('span')
      tag.style.cssText = `display:inline-block;font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;margin-right:6px;${TAG_STYLES[note.type]}`
      tag.textContent = note.tag

      li.appendChild(tag)
      li.appendChild(document.createTextNode(note.text))
      list.appendChild(li)
    })

    changes.appendChild(list)

    // Footer
    const footer = document.createElement('div')
    footer.style.cssText = 'text-align:center'

    const closeBtn = document.createElement('button')
    closeBtn.style.cssText = `
      background:#4CAF50; color:white; border:none; border-radius:6px;
      padding:10px 32px; font-size:15px; cursor:pointer;
    `
    closeBtn.textContent = 'Selge'
    closeBtn.onclick = () => this.#dismiss(overlay, version)
    footer.appendChild(closeBtn)

    // Assemble
    card.appendChild(header)
    card.appendChild(changes)
    card.appendChild(footer)
    overlay.appendChild(card)

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this.#dismiss(overlay, version)
    })

    document.body.appendChild(overlay)
    Logger.info('[VersionCheckService] Update modal shown')
  }
}

// Export singleton instance
export const versionCheckService = new VersionCheckService()
export default versionCheckService
