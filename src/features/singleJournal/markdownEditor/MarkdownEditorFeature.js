import { BaseFeature } from '../../../core/BaseFeature.js'
import Logger from '../../../services/Logger.js'
import { styleService } from '../../../services/StyleService.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import { markdownEditorStyles } from './markdownEditorStyles.js'

export default class MarkdownEditorFeature extends BaseFeature {
  #dialogObserver = null
  #currentDialog = null
  #markdownRenderer = null
  #isProcessing = false

  constructor() {
    super('markdownEditor', /\/journal\/\d+\/edit/)
    this.name = 'MarkdownEditorFeature'
    this.#markdownRenderer = new MarkdownRenderer()
  }

  async activate() {
    Logger.debug(`[${this.name}] Activating markdown editor feature`)

    // Inject CSS styles
    styleService.injectCSS('markdown-editor-styles', markdownEditorStyles)

    // Set up dialog observer
    this.#setupDialogObserver()

    // Check for existing dialog
    this.#checkForExistingDialog()
  }

  onDeactivate() {
    this.#cleanup()
    styleService.removeCSS('markdown-editor-styles')
    super.onDeactivate()
  }

  #cleanup() {
    if (this.#dialogObserver) {
      this.#dialogObserver.disconnect()
      this.#dialogObserver = null
    }
    this.#currentDialog = null
    this.#isProcessing = false
  }

  #setupDialogObserver() {
    this.#dialogObserver = new MutationObserver(mutations => {
      if (this.#isProcessing) return

      mutations.forEach(mutation => {
        // Check for added nodes (dialog opening)
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const dialog = node.matches('md-dialog') ? node : node.querySelector('md-dialog')
            if (dialog) {
              this.#handleDialogOpened(dialog)
            }
          }
        })

        // Check for removed nodes (dialog closing)
        mutation.removedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const dialog = node.matches('md-dialog') ? node : node.querySelector('md-dialog')
            if (dialog === this.#currentDialog) {
              this.#handleDialogClosed()
            }
          }
        })
      })
    })

    this.#dialogObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  #checkForExistingDialog() {
    const existingDialog = document.querySelector('md-dialog')
    if (existingDialog && this.#isElementVisible(existingDialog)) {
      this.#handleDialogOpened(existingDialog)
    }
  }

  async #handleDialogOpened(dialog) {
    if (this.#isProcessing) return

    this.#isProcessing = true
    this.#currentDialog = dialog

    try {
      // Wait for dialog content to be ready
      await this.#waitForDialogContent(dialog)

      // Check if this is an "iseseisev töö" entry dialog
      if (await this.#isIndependentWorkDialog(dialog)) {
        await this.#enhanceDialog(dialog)
      }
    } catch (error) {
      Logger.error(`[${this.name}] Error handling dialog:`, error)
    } finally {
      this.#isProcessing = false
    }
  }

  #handleDialogClosed() {
    this.#currentDialog = null
  }

  async #waitForDialogContent(dialog, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Dialog content timeout'))
      }, timeout)

      const checkContent = () => {
        // Look for common form elements that indicate the dialog is ready
        const hasContent = dialog.querySelector('md-select, md-input-container, textarea, input')
        if (hasContent) {
          clearTimeout(timeoutId)
          resolve()
          return true
        }
        return false
      }

      if (checkContent()) return

      const observer = new MutationObserver(() => {
        if (checkContent()) {
          observer.disconnect()
        }
      })

      observer.observe(dialog, {
        childList: true,
        subtree: true
      })
    })
  }

  async #isIndependentWorkDialog(dialog) {
    // Check if this dialog contains entry type selection
    const entryTypeSelect = dialog.querySelector('md-select[ng-model*="entryType"]')
    if (!entryTypeSelect) return false

    // Check if "Iseseisev töö" is selected or if we can detect it by background color
    const isIseseisvToo = this.#detectIndependentWorkEntry(dialog)

    return isIseseisvToo
  }

  #detectIndependentWorkEntry(dialog) {
    // Method 1: Check for "Iseseisev töö" text in the dialog
    const textContent = dialog.textContent || ''
    if (textContent.includes('Iseseisev töö')) {
      return true
    }

    // Method 2: Check for background color that indicates independent work
    const elementsWithBackground = dialog.querySelectorAll('*')
    for (const element of elementsWithBackground) {
      const style = window.getComputedStyle(element)
      const backgroundColor = style.backgroundColor

      // Check for yellow-ish background that typically indicates independent work
      if (backgroundColor.includes('rgb(255, 255, 0)') ||
          backgroundColor.includes('rgb(255, 255, 204)') ||
          backgroundColor.includes('yellow')) {
        return true
      }
    }

    // Method 3: Check if entry type is set to SISSEKANNE_I
    const entryTypeSelect = dialog.querySelector('md-select[ng-model*="entryType"]')
    if (entryTypeSelect) {
      const selectedText = entryTypeSelect.textContent || ''
      if (selectedText.includes('Iseseisev töö') || selectedText.includes('SISSEKANNE_I')) {
        return true
      }
    }

    return false
  }

  async #enhanceDialog(dialog) {
    const sisuField = this.#findSisuField(dialog)
    if (!sisuField) {
      Logger.warning(`[${this.name}] Could not find Sisu field in dialog`)
      return
    }

    const container = sisuField.closest('md-input-container, .md-input-container')
    if (!container) {
      Logger.warning(`[${this.name}] Could not find container for Sisu field`)
      return
    }

    // Get existing content
    const existingContent = sisuField.value || ''

    // Create markdown editor
    const markdownEditor = this.#createMarkdownEditor(existingContent, sisuField)

    // Replace the original field
    container.style.display = 'none'
    container.parentNode.insertBefore(markdownEditor, container.nextSibling)
  }

  #findSisuField(dialog) {
    // Look for textarea or input field that might be the content field
    const candidates = [
      'textarea[ng-model*="content"]',
      'textarea[ng-model*="sisu"]',
      'input[ng-model*="content"]',
      'input[ng-model*="sisu"]',
      'md-input-container textarea',
      'md-input-container input[type="text"]'
    ]

    for (const selector of candidates) {
      const field = dialog.querySelector(selector)
      if (field) {
        const label = this.#getFieldLabel(field)
        if (label && (label.includes('Sisu') || label.includes('Content'))) {
          return field
        }
      }
    }

    // Fallback: look for any textarea in the dialog
    const textareas = dialog.querySelectorAll('textarea')
    if (textareas.length > 0) {
      return textareas[0]
    }

    return null
  }

  #getFieldLabel(field) {
    const container = field.closest('md-input-container, .md-input-container')
    if (!container) return null

    const label = container.querySelector('label, .md-input-label')
    return label ? label.textContent.trim() : null
  }

  #createMarkdownEditor(initialContent, originalField) {
    const wrapper = document.createElement('div')
    wrapper.className = 'markdown-editor-wrapper'
    wrapper.innerHTML = `
      <div class="markdown-editor-container">
        <div class="markdown-editor-header">
          <div class="markdown-editor-tabs">
            <button type="button" class="tab-button active" data-tab="view">View</button>
            <button type="button" class="tab-button" data-tab="edit">Edit</button>
          </div>
        </div>
        
        <div class="markdown-editor-content">
          <div class="tab-content active" data-tab="view">
            <div class="markdown-preview"></div>
          </div>
          <div class="tab-content" data-tab="edit">
            <textarea class="markdown-textarea" placeholder="Enter your markdown content here...">${this.#escapeHtml(initialContent)}</textarea>
            <div class="markdown-toolbar">
              <button type="button" class="toolbar-btn" data-action="bold" title="Bold (Ctrl+B)">
                <strong>B</strong>
              </button>
              <button type="button" class="toolbar-btn" data-action="italic" title="Italic (Ctrl+I)">
                <em>I</em>
              </button>
              <button type="button" class="toolbar-btn" data-action="link" title="Link (Ctrl+K)">
                🔗
              </button>
              <button type="button" class="toolbar-btn" data-action="list" title="List">
                ≡
              </button>
              <button type="button" class="toolbar-btn" data-action="code" title="Code">
                &lt;/&gt;
              </button>
            </div>
          </div>
        </div>
      </div>
    `

    // Set up event listeners
    this.#setupEditorEventListeners(wrapper, originalField)

    // Initial render
    this.#updatePreview(wrapper, initialContent)

    return wrapper
  }

  #setupEditorEventListeners(wrapper, originalField) {
    const tabs = wrapper.querySelectorAll('.tab-button')
    const contents = wrapper.querySelectorAll('.tab-content')
    const textarea = wrapper.querySelector('.markdown-textarea')
    const toolbarButtons = wrapper.querySelectorAll('.toolbar-btn')

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab

        // Update active tab
        tabs.forEach(t => t.classList.remove('active'))
        tab.classList.add('active')

        // Update active content
        contents.forEach(c => c.classList.remove('active'))
        wrapper.querySelector(`[data-tab="${targetTab}"]`).classList.add('active')

        // Update preview if switching to view tab
        if (targetTab === 'view') {
          this.#updatePreview(wrapper, textarea.value)
        }
      })
    })

    // Textarea input
    textarea.addEventListener('input', () => {
      // Update original field
      originalField.value = textarea.value

      // Trigger change event on original field
      originalField.dispatchEvent(new Event('input', { bubbles: true }))
      originalField.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Toolbar buttons
    toolbarButtons.forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault()
        this.#handleToolbarAction(btn.dataset.action, textarea)
      })
    })

    // Keyboard shortcuts
    textarea.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'b':
            e.preventDefault()
            this.#handleToolbarAction('bold', textarea)
            break
          case 'i':
            e.preventDefault()
            this.#handleToolbarAction('italic', textarea)
            break
          case 'k':
            e.preventDefault()
            this.#handleToolbarAction('link', textarea)
            break
          case 'Enter': {
            e.preventDefault()
            // Trigger save - find save button and click it
            const saveButton = this.#currentDialog.querySelector('button[ng-click*="save"], md-button[ng-click*="save"]')
            if (saveButton) {
              saveButton.click()
            }
            break
          }
        }
      }
    })

    // Auto-resize textarea
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto'
      textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px'
    })

    // Initial resize
    textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px'
  }

  #updatePreview(wrapper, content) {
    const preview = wrapper.querySelector('.markdown-preview')
    const renderedHtml = this.#markdownRenderer.render(content)
    preview.innerHTML = renderedHtml
  }

  #handleToolbarAction(action, textarea) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = textarea.value.substring(start, end)
    let replacement = ''

    switch (action) {
      case 'bold':
        replacement = `**${selectedText || 'bold text'}**`
        break
      case 'italic':
        replacement = `*${selectedText || 'italic text'}*`
        break
      case 'link': {
        const url = selectedText.startsWith('http') ? selectedText : 'https://example.com'
        const linkText = selectedText.startsWith('http') ? 'link text' : (selectedText || 'link text')
        replacement = `[${linkText}](${url})`
        break
      }
      case 'list':
        replacement = `\n- ${selectedText || 'list item'}\n- \n- `
        break
      case 'code':
        replacement = selectedText.includes('\n') ? `\`\`\`\n${selectedText || 'code'}\n\`\`\`` : `\`${selectedText || 'code'}\``
        break
    }

    if (replacement) {
      textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end)

      // Update cursor position
      const newPos = start + replacement.length
      textarea.setSelectionRange(newPos, newPos)

      // Trigger input event
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  #escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  #isElementVisible(element) {
    if (!element) return false
    const style = window.getComputedStyle(element)
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0
  }
}
