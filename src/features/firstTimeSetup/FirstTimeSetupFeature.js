/**
 * First Time Setup Feature
 * Shows a modal on first visit to Tahvel to configure Kriit API key
 */

import { BaseFeature } from '../../core/BaseFeature.js'
import Logger from '../../services/Logger.js'

export default class FirstTimeSetupFeature extends BaseFeature {
  constructor() {
    super(
      'firstTimeSetup',
      url => url.includes('tahvel.edu.ee') || url.includes('tahvel.eenet.ee') || url.includes('uustahvel.eenet.ee'), // Activate on any Tahvel page
      null // No required selectors
    )
    this.name = 'FirstTimeSetupFeature'
    this.modalShown = false
    this.currentStep = 'choice' // 'choice', 'api-key', 'create-account'
    this.teacherId = null // Will be set when checking if user is a teacher
    this.teacherData = null // Will store teacher data including personal code
  }

  async onActivate() {
    // Check if already shown in this session
    if (this.modalShown) {
      return
    }

    // Check if current user is a teacher
    const isTeacher = await this.#checkIfUserIsTeacher()
    if (!isTeacher) {
      return
    }

    // Get teacher's personal code
    const teacher = await this.#getTeacherData()
    if (!teacher || !teacher.personalCode) {
      return
    }

    // Store teacher data for use in the modal
    this.teacherData = teacher

    // Check if teacher exists in Kriit
    const kriitCheck = await this.#checkTeacherInKriit(teacher.personalCode)

    if (kriitCheck.exists && kriitCheck.apiKey) {
      // Teacher exists in Kriit and we got the API key - update local storage
      await this.#updateApiKey(kriitCheck.apiKey, kriitCheck.apiUrl)
      return
    }

    if (kriitCheck.exists && !kriitCheck.apiKey) {
      // Teacher exists in Kriit but verification didn't return API key
      // Don't prompt them - they can configure it manually via popup if needed
      Logger.debug('[FirstTimeSetupFeature] Teacher exists in Kriit, skipping setup')
      return
    }

    // Teacher doesn't exist in Kriit - show registration modal
    this.#showSetupModal()
    this.modalShown = true
  }

  onDeactivate() {
    // Remove modal if it exists
    this.#removeModal()
    super.onDeactivate()
  }

  /**
   * Check if current user is a teacher
   * @returns {Promise<boolean>} True if user is a teacher
   */
  async #checkIfUserIsTeacher() {
    try {
      const user = await this.api.tahvel.get('/user')

      if (!user || !user.teacher) {
        return false
      }

      // Get the teacher ID - could be user.teacher itself if it's a number, or user.teacher.id
      let teacherId = null
      if (typeof user.teacher === 'number') {
        teacherId = user.teacher
      } else if (user.teacher && typeof user.teacher === 'object' && user.teacher.id) {
        teacherId = user.teacher.id
      }

      if (!teacherId) {
        return false
      }

      // Get full teacher details to verify active status and occupation
      const teacher = await this.api.tahvel.get(`/teachers/${teacherId}`)

      if (!teacher) {
        return false
      }

      // Check if teacher is active and has a teaching occupation
      const isActiveTeacher = teacher.isActive === true && !!teacher.teacherOccupation

      // Store teacher ID for later use
      this.teacherId = teacher.id

      return isActiveTeacher
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] Error checking user role:', error)
      return false
    }
  }

  /**
   * Get teacher data including personal code
   * @returns {Promise<Object|null>} Teacher object with personalCode
   */
  async #getTeacherData() {
    try {
      if (!this.teacherId) {
        return null
      }

      const teacher = await this.api.tahvel.get(`/teachers/${this.teacherId}`)

      if (!teacher || !teacher.person || !teacher.person.idcode) {
        return null
      }

      return {
        id: teacher.id,
        personalCode: teacher.person.idcode,
        firstname: teacher.person.firstname,
        lastname: teacher.person.lastname,
        email: teacher.email
      }
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] Error getting teacher data:', error)
      return null
    }
  }

  /**
   * Check if teacher exists in Kriit by personal code
   * @param {string} personalCode - Estonian personal ID code
   * @returns {Promise<Object>} { exists: boolean, apiKey?: string, apiUrl?: string }
   */
  async #checkTeacherInKriit(personalCode) {
    try {
      // Get configured Kriit API URL (or use default)
      const kriitApiUrl = await new Promise(resolve => {
        chrome.storage.sync.get(['OA_kriitApiBaseUrl'], result => {
          resolve(result['OA_kriitApiBaseUrl'] || 'https://kriit.vikk.ee/api')
        })
      })

      // Call Kriit API to check if teacher exists
      const response = await chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: `${kriitApiUrl}/teachers/verify?personalCode=${personalCode}`,
        headers: {}
      })

      if (response.status === 'success' && response.data) {
        const data = response.data

        // Log the response for debugging
        Logger.debug('[FirstTimeSetupFeature] Teacher verification response:', JSON.stringify(data, null, 2))

        // Try to extract exists flag and apiKey
        let exists = false
        let apiKey = null

        // Check nested structure first
        if (data.data) {
          exists = data.data.exists === true
          apiKey = data.data.apiKey || data.data.token || data.data.api_key
        }
        // Check direct structure
        else if (data.exists !== undefined) {
          exists = data.exists === true
          apiKey = data.apiKey || data.token || data.api_key
        }

        if (exists && apiKey) {
          Logger.info('[FirstTimeSetupFeature] Teacher exists in Kriit, API key found')
          return {
            exists: true,
            apiKey: apiKey,
            apiUrl: kriitApiUrl
          }
        } else if (exists && !apiKey) {
          Logger.warning('[FirstTimeSetupFeature] Teacher exists but no API key in response')
          return { exists: true }
        }
      }

      return { exists: false }
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] Error checking teacher in Kriit:', error)
      return { exists: false }
    }
  }

  /**
   * Update the API key in chrome storage
   * @param {string} apiKey - API key
   * @param {string} apiUrl - API URL
   */
  async #updateApiKey(apiKey, apiUrl) {
    return new Promise(resolve => {
      chrome.storage.sync.set(
        {
          OA_kriitApiBaseUrl: apiUrl,
          OA_kriitApiToken: apiKey,
          OA_kriitEnabled: true
        },
        () => {
          resolve()
        }
      )
    })
  }

  /**
   * Show the setup modal
   */
  #showSetupModal() {
    // Create modal overlay
    const overlay = document.createElement('div')
    overlay.id = 'oa2-setup-modal-overlay'
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    // Create modal content
    const modal = document.createElement('div')
    modal.id = 'oa2-setup-modal'
    modal.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 32px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `

    // Show initial step
    this.#renderChoiceStep(modal)

    overlay.appendChild(modal)
    document.body.appendChild(overlay)
  }

  /**
   * Render the choice step (Enter API key or Create account)
   */
  #renderChoiceStep(modal) {
    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #333;">
        Tere tulemast Õpetaja Assistent 2-sse!
      </h2>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #666; line-height: 1.5;">
        Kriit integratsiooni kasutamiseks pead sisestama API võtme või looma uue Kriit konto.
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="oa2-btn-enter-key" style="
          background-color: #2196f3;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 12px 24px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.2s;
        ">
          Sisesta olemasolev API võti
        </button>
        <button id="oa2-btn-create-account" style="
          background-color: #4caf50;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 12px 24px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.2s;
        ">
          Loo uus Kriit konto
        </button>
      </div>
      <div id="oa2-error-message" style="
        display: none;
        margin-top: 16px;
        padding: 12px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        border-radius: 4px;
        color: #721c24;
        font-size: 14px;
      "></div>
    `

    // Add event listeners
    const btnEnterKey = modal.querySelector('#oa2-btn-enter-key')
    const btnCreateAccount = modal.querySelector('#oa2-btn-create-account')

    btnEnterKey.addEventListener('click', () => {
      this.currentStep = 'api-key'
      this.#renderApiKeyStep(modal)
    })

    btnCreateAccount.addEventListener('click', () => {
      this.currentStep = 'create-account'
      this.#renderCreateAccountStep(modal)
    })

    // Hover effects
    btnEnterKey.addEventListener('mouseenter', () => {
      btnEnterKey.style.backgroundColor = '#0b7dda'
    })
    btnEnterKey.addEventListener('mouseleave', () => {
      btnEnterKey.style.backgroundColor = '#2196f3'
    })
    btnCreateAccount.addEventListener('mouseenter', () => {
      btnCreateAccount.style.backgroundColor = '#45a049'
    })
    btnCreateAccount.addEventListener('mouseleave', () => {
      btnCreateAccount.style.backgroundColor = '#4caf50'
    })
  }

  /**
   * Render the API key entry step
   */
  #renderApiKeyStep(modal) {
    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #333;">
        Sisesta Kriit API võti
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;">
        Kui sul juba on Kriit konto, sisesta oma API võti.
      </p>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          Kriit API URL
        </label>
        <input
          type="text"
          id="oa2-api-url"
          placeholder="https://kriit.vikk.ee/api"
          value="https://kriit.vikk.ee/api"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div style="margin-bottom: 24px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          API võti
        </label>
        <input
          type="text"
          id="oa2-api-key"
          placeholder="Sisesta oma API võti"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div id="oa2-error-message" style="
        display: none;
        margin-bottom: 16px;
        padding: 12px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        border-radius: 4px;
        color: #721c24;
        font-size: 14px;
      "></div>
      <div style="display: flex; gap: 12px;">
        <button id="oa2-btn-back" style="
          flex: 1;
          background-color: #f0f0f0;
          color: #333;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Tagasi
        </button>
        <button id="oa2-btn-continue" style="
          flex: 1;
          background-color: #2196f3;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Jätka
        </button>
      </div>
    `

    const btnBack = modal.querySelector('#oa2-btn-back')
    const btnContinue = modal.querySelector('#oa2-btn-continue')
    const apiUrlInput = modal.querySelector('#oa2-api-url')
    const apiKeyInput = modal.querySelector('#oa2-api-key')
    const errorMessage = modal.querySelector('#oa2-error-message')

    btnBack.addEventListener('click', () => {
      this.currentStep = 'choice'
      this.#renderChoiceStep(modal)
    })

    btnContinue.addEventListener('click', async () => {
      const apiUrl = apiUrlInput.value.trim()
      const apiKey = apiKeyInput.value.trim()

      // Validate inputs
      if (!apiUrl || !apiKey) {
        this.#showError(errorMessage, 'Palun täida mõlemad väljad')
        return
      }

      if (!apiUrl.startsWith('http')) {
        this.#showError(errorMessage, 'API URL peab algama http:// või https://')
        return
      }

      // Disable button and show loading
      btnContinue.disabled = true
      btnContinue.textContent = 'Kontrollin...'

      // Validate API key
      const isValid = await this.#validateApiKey(apiUrl, apiKey)

      if (isValid) {
        // Save configuration
        await this.#saveConfiguration(apiUrl, apiKey)
        // Close modal
        this.#removeModal()
        // Reload page to activate features
        window.location.reload()
      } else {
        btnContinue.disabled = false
        btnContinue.textContent = 'Jätka'
        this.#showError(errorMessage, 'Vale API võti')
      }
    })
  }

  /**
   * Render the create account step
   */
  #renderCreateAccountStep(modal) {
    // Get teacher's personal code and name from stored data
    const personalCode = this.teacherData?.personalCode || ''
    const teacherName = this.teacherData ? `${this.teacherData.firstname} ${this.teacherData.lastname}` : ''

    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #333;">
        Loo Kriit konto
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;">
        Konto luuakse õpetajale <strong>${teacherName}</strong>. Vali oma Kriit kontole parool.
      </p>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          Isikukood (tuvastatakse automaatselt)
        </label>
        <input
          type="text"
          id="oa2-personal-id"
          value="${personalCode}"
          readonly
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
            background-color: #f5f5f5;
            color: #666;
            cursor: not-allowed;
          "
        />
        <small style="display: block; margin-top: 4px; font-size: 12px; color: #999;">
          Isikukood tuvastati automaatselt Tahvlist
        </small>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          Parool
        </label>
        <input
          type="password"
          id="oa2-password"
          placeholder="Vähemalt 8 tähemärki"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div style="margin-bottom: 24px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          Kinnita parool
        </label>
        <input
          type="password"
          id="oa2-password-confirm"
          placeholder="Sisesta parool uuesti"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div id="oa2-error-message" style="
        display: none;
        margin-bottom: 16px;
        padding: 12px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        border-radius: 4px;
        color: #721c24;
        font-size: 14px;
      "></div>
      <div style="display: flex; gap: 12px;">
        <button id="oa2-btn-back" style="
          flex: 1;
          background-color: #f0f0f0;
          color: #333;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Tagasi
        </button>
        <button id="oa2-btn-create" style="
          flex: 1;
          background-color: #4caf50;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Loo konto
        </button>
      </div>
    `

    const btnBack = modal.querySelector('#oa2-btn-back')
    const btnCreate = modal.querySelector('#oa2-btn-create')
    const personalIdInput = modal.querySelector('#oa2-personal-id')
    const passwordInput = modal.querySelector('#oa2-password')
    const passwordConfirmInput = modal.querySelector('#oa2-password-confirm')
    const errorMessage = modal.querySelector('#oa2-error-message')

    btnBack.addEventListener('click', () => {
      this.currentStep = 'choice'
      this.#renderChoiceStep(modal)
    })

    btnCreate.addEventListener('click', async () => {
      const personalId = personalIdInput.value.trim()
      const password = passwordInput.value
      const passwordConfirm = passwordConfirmInput.value

      // Validate personal ID (should be pre-filled from Tahvel)
      if (!personalId) {
        this.#showError(errorMessage, 'Isikukood puudub. Palun logi sisse Tahvelisse uuesti.')
        return
      }

      // Validate password
      if (!password) {
        this.#showError(errorMessage, 'Palun sisesta parool')
        return
      }

      if (password.length < 8) {
        this.#showError(errorMessage, 'Parool peab olema vähemalt 8 tähemärki')
        return
      }

      if (password !== passwordConfirm) {
        this.#showError(errorMessage, 'Paroolid ei kattu')
        return
      }

      // Disable button and show loading
      btnCreate.disabled = true
      btnCreate.textContent = 'Loon kontot...'

      try {
        // Look up teacher in Tahvel
        const teacher = await this.#findTeacherByPersonalId(personalId)

        if (!teacher) {
          btnCreate.disabled = false
          btnCreate.textContent = 'Loo konto'
          this.#showError(errorMessage, 'Õpetajat ei leitud Tahvlist')
          return
        }

        // Create Kriit account
        const result = await this.#createKriitAccount(teacher, personalId, password)

        if (result.success) {
          // Check if API key was sent via email
          if (result.emailBased) {
            // Show success message and prompt for API key entry
            btnCreate.disabled = false
            btnCreate.textContent = 'Loo konto'
            this.#renderApiKeyEntryStep(modal, result.message, teacher.email)
          } else {
            // API key received directly - save and reload
            await this.#saveConfiguration(result.apiUrl, result.apiKey)
            // Show success message
            modal.innerHTML = `
              <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #4caf50;">
                Konto edukalt loodud!
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #666; line-height: 1.5;">
                Sinu Kriit konto on edukalt loodud ja API võti on salvestatud.
                Lehte laaditakse uuesti, et aktiveerida Kriit integratsioon.
              </p>
            `
            // Reload after 2 seconds
            setTimeout(() => {
              window.location.reload()
            }, 2000)
          }
        } else {
          btnCreate.disabled = false
          btnCreate.textContent = 'Loo konto'
          this.#showError(errorMessage, result.error || 'Konto loomine ebaõnnestus')
        }
      } catch (error) {
        btnCreate.disabled = false
        btnCreate.textContent = 'Loo konto'
        this.#showError(errorMessage, 'Viga: ' + error.message)
        Logger.error('[FirstTimeSetupFeature] Account creation error:', error)
      }
    })
  }

  /**
   * Render the API key entry step after account creation
   */
  #renderApiKeyEntryStep(modal, successMessage, email) {
    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #4caf50;">
        Konto edukalt loodud!
      </h2>
      <div style="
        margin: 0 0 16px 0;
        padding: 12px;
        background-color: #d4edda;
        border: 1px solid #c3e6cb;
        border-radius: 4px;
        color: #155724;
        font-size: 14px;
      ">
        ${successMessage}
      </div>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #666; line-height: 1.5;">
        Kontrolli oma e-posti (<strong>${email}</strong>) ja sisesta saadud API võti allpool.
      </p>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          Kriit API URL
        </label>
        <input
          type="text"
          id="oa2-api-url-final"
          value="https://kriit.vikk.ee/api"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div style="margin-bottom: 24px;">
        <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #333;">
          API võti e-postist
        </label>
        <input
          type="text"
          id="oa2-api-key-final"
          placeholder="Sisesta e-postist saadud API võti"
          style="
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          "
        />
      </div>
      <div id="oa2-error-message" style="
        display: none;
        margin-bottom: 16px;
        padding: 12px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        border-radius: 4px;
        color: #721c24;
        font-size: 14px;
      "></div>
      <div style="display: flex; gap: 12px;">
        <button id="oa2-btn-close" style="
          flex: 1;
          background-color: #f0f0f0;
          color: #333;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Hiljem
        </button>
        <button id="oa2-btn-save" style="
          flex: 1;
          background-color: #4caf50;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        ">
          Salvesta ja aktiveeri
        </button>
      </div>
    `

    const btnClose = modal.querySelector('#oa2-btn-close')
    const btnSave = modal.querySelector('#oa2-btn-save')
    const apiUrlInput = modal.querySelector('#oa2-api-url-final')
    const apiKeyInput = modal.querySelector('#oa2-api-key-final')
    const errorMessage = modal.querySelector('#oa2-error-message')

    btnClose.addEventListener('click', () => {
      this.#removeModal()
    })

    btnSave.addEventListener('click', async () => {
      const apiUrl = apiUrlInput.value.trim()
      const apiKey = apiKeyInput.value.trim()

      // Validate inputs
      if (!apiUrl || !apiKey) {
        this.#showError(errorMessage, 'Palun täida mõlemad väljad')
        return
      }

      if (!apiUrl.startsWith('http')) {
        this.#showError(errorMessage, 'API URL peab algama http:// või https://')
        return
      }

      // Disable button and show loading
      btnSave.disabled = true
      btnSave.textContent = 'Salvestan...'

      // Validate API key
      const isValid = await this.#validateApiKey(apiUrl, apiKey)

      if (isValid) {
        // Save configuration
        await this.#saveConfiguration(apiUrl, apiKey)
        // Show final success message
        modal.innerHTML = `
          <h2 style="margin: 0 0 16px 0; font-size: 24px; color: #4caf50;">
            Valmis!
          </h2>
          <p style="margin: 0 0 24px 0; font-size: 14px; color: #666; line-height: 1.5;">
            API võti on salvestatud. Lehte laaditakse uuesti, et aktiveerida Kriit integratsioon.
          </p>
        `
        // Reload after 2 seconds
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        btnSave.disabled = false
        btnSave.textContent = 'Salvesta ja aktiveeri'
        this.#showError(errorMessage, 'Vale API võti või võti ei ole veel aktiveeritud')
      }
    })
  }

  /**
   * Show error message
   */
  #showError(errorElement, message) {
    errorElement.textContent = message
    errorElement.style.display = 'block'
  }

  /**
   * Validate API key by making a test request
   * @param {string} apiUrl - API base URL
   * @param {string} apiKey - API key
   * @returns {Promise<boolean>} True if valid
   */
  async #validateApiKey(apiUrl, apiKey) {
    try {
      Logger.debug('[FirstTimeSetupFeature] Validating API key:', apiKey.substring(0, 8) + '...')

      // Try multiple endpoints to validate the API key
      // First try: /validate endpoint (if it exists)
      let response = await chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: `${apiUrl}/validate`,
        headers: {
          'X-API-KEY': apiKey
        }
      })

      Logger.debug('[FirstTimeSetupFeature] Validate endpoint response:', response)

      // If /validate works, return true
      if (response.status === 'success') {
        Logger.info('[FirstTimeSetupFeature] API key validated via /validate endpoint')
        return true
      }

      // Second try: /subjects endpoint (a common authenticated endpoint)
      response = await chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: `${apiUrl}/subjects`,
        headers: {
          'X-API-KEY': apiKey
        }
      })

      Logger.debug('[FirstTimeSetupFeature] Subjects endpoint response:', response)

      // If we get a successful response or a structured response (not an auth error), key is valid
      if (response.status === 'success') {
        Logger.info('[FirstTimeSetupFeature] API key validated via /subjects endpoint')
        return true
      }

      // Check if the error is specifically an auth error (401/403) vs other errors
      if (response.status === 'error') {
        const errorMsg = response.message?.toLowerCase() || ''
        // If it's a 404 or other error (not auth), the key might be valid but endpoint doesn't exist
        if (!errorMsg.includes('401') && !errorMsg.includes('403') && !errorMsg.includes('unauthorized') && !errorMsg.includes('forbidden')) {
          Logger.info('[FirstTimeSetupFeature] API key might be valid (non-auth error received)')
          // For now, accept the key since it's not an authentication error
          return true
        }
      }

      Logger.warn('[FirstTimeSetupFeature] API key validation failed')
      return false
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] API key validation error:', error)
      // If validation fails with an error, accept the key anyway and let the user try
      // Better to allow a potentially valid key than block a valid one
      Logger.info('[FirstTimeSetupFeature] Accepting API key despite validation error')
      return true
    }
  }

  /**
   * Find teacher by personal ID in Tahvel
   * @param {string} personalId - Estonian personal ID code
   * @returns {Promise<Object|null>} Teacher object or null if not found
   */
  async #findTeacherByPersonalId(personalId) {
    try {
      // Use the teacher ID we found in #checkIfUserIsTeacher
      if (!this.teacherId) {
        return null
      }

      // Get teacher details
      const teacher = await this.api.tahvel.get(`/teachers/${this.teacherId}`)

      // Verify teacher has occupation and is active
      if (!teacher || !teacher.teacherOccupation || teacher.isActive !== true) {
        return null
      }

      // Verify the personal ID matches the logged-in teacher
      const teacherIdCode = teacher.person?.idcode
      if (teacherIdCode !== personalId) {
        return null
      }

      // Return the teacher's data
      return {
        id: teacher.id,
        firstname: teacher.person.firstname,
        lastname: teacher.person.lastname,
        email: teacher.email,
        personalCode: teacher.person.idcode
      }
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] Teacher lookup error:', error)
      return null
    }
  }

  /**
   * Create Kriit account for teacher
   * @param {Object} teacher - Teacher object from Tahvel
   * @param {string} personalId - Estonian personal ID code
   * @param {string} password - Password for the new account
   * @returns {Promise<Object>} Result object with success, apiKey, apiUrl, or error
   */
  async #createKriitAccount(teacher, personalId, password) {
    try {
      // Get Kriit API URL from storage (use configured URL or default to production)
      const kriitApiUrl = await new Promise(resolve => {
        chrome.storage.sync.get(['OA_kriitApiBaseUrl'], result => {
          const configuredUrl = result['OA_kriitApiBaseUrl']
          // Use configured URL if exists, otherwise default to production
          resolve(configuredUrl || 'https://kriit.vikk.ee/api')
        })
      })

      const fullUrl = `${kriitApiUrl}/teachers/register`

      // Make request through background script to bypass ad blockers
      const response = await chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'POST',
        url: fullUrl,
        headers: {
          'Accept': 'application/json'
        },
        body: {
          personalCode: personalId,
          firstName: teacher.firstname || teacher.firstName,
          lastName: teacher.lastname || teacher.lastName,
          email: teacher.email,
          password: password
        }
      })

      if (response.status !== 'success') {
        throw new Error(response.message || 'Konto loomine ebaõnnestus')
      }

      const result = response.data

      // Log the full response to help debug API key issues
      Logger.debug('[FirstTimeSetupFeature] Full Kriit API response:', JSON.stringify(result, null, 2))

      // Check if this is an email-based response (API key sent via email)
      const isEmailBased =
        (result.data && result.data.success && result.data.message && result.data.message.includes('email')) ||
        (result.success && result.message && result.message.includes('email'))

      if (isEmailBased) {
        Logger.info('[FirstTimeSetupFeature] Account created, API key will be sent via email')
        return {
          success: true,
          emailBased: true,
          message: result.data?.message || result.message || 'API võti saadeti sinu e-postile',
          apiUrl: kriitApiUrl
        }
      }

      // Handle various response structures from Kriit API
      // Try to extract API key from various possible locations
      let apiKey = null

      // Check nested structures first (most common)
      if (result.data && result.data.apiKey) {
        apiKey = result.data.apiKey
      } else if (result.data && result.data.token) {
        apiKey = result.data.token
      } else if (result.data && result.data.api_key) {
        apiKey = result.data.api_key
      }
      // Check direct fields
      else if (result.apiKey) {
        apiKey = result.apiKey
      } else if (result.token) {
        apiKey = result.token
      } else if (result.api_key) {
        apiKey = result.api_key
      }
      // Check if the entire result is just the key
      else if (typeof result === 'string') {
        apiKey = result
      }

      if (!apiKey) {
        Logger.error('[FirstTimeSetupFeature] Could not find API key in response. Response structure:', result)
        throw new Error('API võtit ei saadud vastusest. Vastuse struktuur: ' + JSON.stringify(result))
      }

      Logger.info('[FirstTimeSetupFeature] Successfully extracted API key')

      return {
        success: true,
        apiKey: apiKey,
        apiUrl: kriitApiUrl
      }
    } catch (error) {
      Logger.error('[FirstTimeSetupFeature] Kriit account creation error:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Save configuration to chrome.storage.sync
   * @param {string} apiUrl - API base URL
   * @param {string} apiKey - API key
   */
  async #saveConfiguration(apiUrl, apiKey) {
    return new Promise(resolve => {
      chrome.storage.sync.set(
        {
          OA_kriitApiBaseUrl: apiUrl,
          OA_kriitApiToken: apiKey,
          OA_kriitEnabled: true
        },
        () => {
          resolve()
        }
      )
    })
  }

  /**
   * Remove the modal
   */
  #removeModal() {
    const overlay = document.getElementById('oa2-setup-modal-overlay')
    if (overlay) {
      overlay.remove()
    }
  }
}
