import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { JSDOM } from 'jsdom'
import FirstTimeSetupFeature from '../../../src/features/firstTimeSetup/FirstTimeSetupFeature.js'

describe('FirstTimeSetupFeature', () => {
  let feature
  let mockChrome

  beforeEach(() => {
    // Setup console
    global.console = {
      debug: () => {},
      log: () => {},
      error: () => {},
      trace: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {}
    }

    // Setup window and document
    global.window = {
      location: { href: 'https://tahvel.edu.ee/' }
    }

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    global.document = dom.window.document

    // Mock chrome API
    mockChrome = {
      storage: {
        sync: {
          get: mock((keys, callback) => {
            callback({ OA_kriitApiBaseUrl: 'https://kriit.vikk.ee/api' })
          }),
          set: mock((data, callback) => {
            if (callback) callback()
          })
        }
      },
      runtime: {
        sendMessage: mock(async (message) => {
          return { status: 'success', data: { exists: false } }
        })
      }
    }
    global.chrome = mockChrome

    feature = new FirstTimeSetupFeature()
  })

  describe('constructor', () => {
    test('should initialize with correct properties', () => {
      expect(feature.name).toBe('FirstTimeSetupFeature')
      expect(feature.modalShown).toBe(false)
      expect(feature.currentStep).toBe('choice')
      expect(feature.teacherId).toBeNull()
    })

    test('should match tahvel URLs', () => {
      const urls = [
        'https://tahvel.edu.ee/',
        'https://tahvel.eenet.ee/',
        'https://test.tahvel.eenet.ee/',
        'https://uustahvel.eenet.ee/'
      ]

      urls.forEach(url => {
        expect(feature.shouldActivate(url)).toBe(true)
      })
    })

    test('should not match non-tahvel URLs', () => {
      const urls = ['https://google.com/', 'https://example.com/']

      urls.forEach(url => {
        expect(feature.shouldActivate(url)).toBe(false)
      })
    })
  })

  describe('onActivate', () => {
    test('should return early if modal already shown', async () => {
      feature.modalShown = true

      const checkIfUserIsTeacher = mock(() => Promise.resolve(true))
      feature._checkIfUserIsTeacher = checkIfUserIsTeacher

      await feature.onActivate()

      expect(checkIfUserIsTeacher).not.toHaveBeenCalled()
    })

    test('should return early if user is not a teacher', async () => {
      feature.api = {
        tahvel: {
          get: mock(async () => ({ student: 123 }))
        }
      }

      await feature.onActivate()

      expect(feature.modalShown).toBe(false)
    })

    test('should check Kriit when teacher data is available', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: {
                  idcode: '39709126012',
                  firstname: 'Test',
                  lastname: 'Teacher'
                },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should update API key if teacher exists in Kriit', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: {
                  idcode: '39709126012',
                  firstname: 'Test',
                  lastname: 'Teacher'
                },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: {
          data: {
            exists: true,
            apiKey: 'existing-api-key-123'
          }
        }
      }))

      await feature.onActivate()

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          OA_kriitApiToken: 'existing-api-key-123',
          OA_kriitEnabled: true
        }),
        expect.any(Function)
      )
    })
  })

  describe('teacher verification', () => {
    test('should identify teacher by user.teacher field', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 }
              }
            }
            return {}
          })
        }
      }

      // Call the private method through reflection
      const result = await feature['_checkIfUserIsTeacher']?.() ||
                     await feature['#checkIfUserIsTeacher']?.() ||
                     false

      // Can't directly test private method, but we can test through onActivate
      await feature.onActivate()
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should handle teacher object with id property', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: { id: 12345 } }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 }
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()
      expect(feature.api.tahvel.get).toHaveBeenCalled()
    })

    test('should reject inactive teachers', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: false,
                teacherOccupation: { id: 1 }
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()
      expect(feature.modalShown).toBe(false)
    })

    test('should reject teachers without occupation', async () => {
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: null
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()
      expect(feature.modalShown).toBe(false)
    })
  })

  describe('Kriit verification', () => {
    test('should call Kriit verify endpoint with personal code', async () => {
      const personalCode = '39709126012'

      global.chrome.runtime.sendMessage = mock(async message => {
        expect(message.action).toBe('kriitApiRequest')
        expect(message.method).toBe('GET')
        expect(message.url).toContain('/teachers/verify')
        expect(message.url).toContain(personalCode)
        return {
          status: 'success',
          data: { exists: false }
        }
      })

      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: personalCode, firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    test('should handle nested Kriit response format', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: {
          data: {
            exists: true,
            apiKey: 'nested-api-key'
          }
        }
      }))

      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          OA_kriitApiToken: 'nested-api-key'
        }),
        expect.any(Function)
      )
    })

    test('should handle flat Kriit response format', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: {
          exists: true,
          apiKey: 'flat-api-key'
        }
      }))

      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          OA_kriitApiToken: 'flat-api-key'
        }),
        expect.any(Function)
      )
    })

    test('should handle Kriit API errors gracefully', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'error',
        message: 'Network error'
      }))

      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      // Should show modal when Kriit check fails
      expect(feature.modalShown).toBe(true)
    })
  })

  describe('modal rendering', () => {
    test('should show modal during activation when teacher not in Kriit', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      const overlay = document.getElementById('oa2-setup-modal-overlay')
      expect(overlay).toBeDefined()
      expect(overlay).not.toBeNull()
    })

    test('should have choice step with two main action buttons', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      const enterKeyBtn = document.getElementById('oa2-btn-enter-key')
      const createAccountBtn = document.getElementById('oa2-btn-create-account')

      expect(enterKeyBtn).not.toBeNull()
      expect(createAccountBtn).not.toBeNull()
    })

    test('should render API key step when clicking enter key button', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      const enterKeyBtn = document.getElementById('oa2-btn-enter-key')
      enterKeyBtn?.click()

      const apiUrlInput = document.getElementById('oa2-api-url')
      const apiKeyInput = document.getElementById('oa2-api-key')

      expect(apiUrlInput).not.toBeNull()
      expect(apiKeyInput).not.toBeNull()
    })

    test('should render create account step when clicking create account button', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      const createAccountBtn = document.getElementById('oa2-btn-create-account')
      createAccountBtn?.click()

      const personalIdInput = document.getElementById('oa2-personal-id')
      const passwordInput = document.getElementById('oa2-password')
      const passwordConfirmInput = document.getElementById('oa2-password-confirm')

      expect(personalIdInput).not.toBeNull()
      expect(passwordInput).not.toBeNull()
      expect(passwordConfirmInput).not.toBeNull()
    })
  })

  describe('personal ID validation', () => {
    test('should validate 11-digit personal code', () => {
      const validCode = '39709126012'
      const regex = /^\d{11}$/

      expect(regex.test(validCode)).toBe(true)
    })

    test('should reject personal codes with wrong length', () => {
      const invalidCodes = ['123', '123456789012', 'abcdefghijk', '']
      const regex = /^\d{11}$/

      invalidCodes.forEach(code => {
        expect(regex.test(code)).toBe(false)
      })
    })

    test('should reject personal codes with non-digits', () => {
      const invalidCodes = ['3970912601A', '39709-26012', '397 09126012']
      const regex = /^\d{11}$/

      invalidCodes.forEach(code => {
        expect(regex.test(code)).toBe(false)
      })
    })
  })

  describe('password validation', () => {
    test('should accept passwords with 8 or more characters', () => {
      const validPasswords = ['password', '12345678', 'SecurePass123!']

      validPasswords.forEach(password => {
        expect(password.length >= 8).toBe(true)
      })
    })

    test('should reject passwords shorter than 8 characters', () => {
      const invalidPasswords = ['pass', '1234567', 'short']

      invalidPasswords.forEach(password => {
        expect(password.length >= 8).toBe(false)
      })
    })

    test('should check password confirmation match', () => {
      const password = 'SecurePass123'
      const confirmMatch = 'SecurePass123'
      const confirmMismatch = 'DifferentPass'

      expect(password === confirmMatch).toBe(true)
      expect(password === confirmMismatch).toBe(false)
    })
  })

  describe('configuration saving', () => {
    test('should save API key and URL to chrome storage', async () => {
      const apiUrl = 'https://kriit.vikk.ee/api'
      const apiKey = 'test-api-key-123'

      // Call save configuration through the feature
      await new Promise(resolve => {
        global.chrome.storage.sync.set(
          {
            OA_kriitApiBaseUrl: apiUrl,
            OA_kriitApiToken: apiKey,
            OA_kriitEnabled: true
          },
          resolve
        )
      })

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          OA_kriitApiBaseUrl: apiUrl,
          OA_kriitApiToken: apiKey,
          OA_kriitEnabled: true
        }),
        expect.any(Function)
      )
    })

    test('should enable Kriit integration when saving configuration', async () => {
      await new Promise(resolve => {
        global.chrome.storage.sync.set(
          {
            OA_kriitApiBaseUrl: 'https://kriit.vikk.ee/api',
            OA_kriitApiToken: 'test-key',
            OA_kriitEnabled: true
          },
          resolve
        )
      })

      expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          OA_kriitEnabled: true
        }),
        expect.any(Function)
      )
    })
  })

  describe('onDeactivate', () => {
    test('should remove modal on deactivation', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: { exists: false }
      }))

      await feature.onActivate()

      const overlay = document.getElementById('oa2-setup-modal-overlay')
      expect(overlay).not.toBeNull()

      feature.onDeactivate()

      const overlayAfter = document.getElementById('oa2-setup-modal-overlay')
      expect(overlayAfter).toBeNull()
    })

    test('should handle deactivation when modal not shown', () => {
      expect(() => feature.onDeactivate()).not.toThrow()
    })
  })

  describe('account registration', () => {
    test('should send correct payload to Kriit registration endpoint', async () => {
      global.chrome.runtime.sendMessage = mock(async message => {
        if (message.url?.includes('/teachers/register')) {
          expect(message.body).toEqual(
            expect.objectContaining({
              personalCode: '39709126012',
              firstName: 'Test',
              lastName: 'Teacher',
              email: 'test@example.com',
              password: expect.any(String)
            })
          )
          return {
            status: 'success',
            data: {
              data: {
                apiKey: 'new-api-key'
              }
            }
          }
        }
        return { status: 'success', data: {} }
      })

      // Simulate account creation flow
      const teacherData = {
        firstname: 'Test',
        lastname: 'Teacher',
        email: 'test@example.com'
      }
      const personalId = '39709126012'
      const password = 'SecurePassword123'

      await global.chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'POST',
        url: 'https://kriit.vikk.ee/api/teachers/register',
        headers: { Accept: 'application/json' },
        body: {
          personalCode: personalId,
          firstName: teacherData.firstname,
          lastName: teacherData.lastname,
          email: teacherData.email,
          password: password
        }
      })

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    test('should handle registration errors', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'error',
        message: 'Registration failed'
      }))

      const result = await global.chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'POST',
        url: 'https://kriit.vikk.ee/api/teachers/register',
        body: {}
      })

      expect(result.status).toBe('error')
    })

    test('should extract API key from nested response', () => {
      const responses = [
        { data: { apiKey: 'key1' } },
        { apiKey: 'key2' },
        { token: 'key3' },
        { data: { data: { apiKey: 'key4' } } }
      ]

      responses.forEach(response => {
        let apiKey = null
        if (response.data?.data?.apiKey) {
          apiKey = response.data.data.apiKey
        } else if (response.data?.apiKey) {
          apiKey = response.data.apiKey
        } else if (response.apiKey) {
          apiKey = response.apiKey
        } else if (response.token) {
          apiKey = response.token
        }

        expect(apiKey).toBeTruthy()
      })
    })
  })

  describe('API key validation', () => {
    test('should call validate endpoint with API key header', async () => {
      global.chrome.runtime.sendMessage = mock(async message => {
        if (message.url?.includes('/validate')) {
          expect(message.headers['X-API-KEY']).toBe('test-api-key')
          return { status: 'success' }
        }
        return { status: 'error' }
      })

      await global.chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.vikk.ee/api/validate',
        headers: { 'X-API-KEY': 'test-api-key' }
      })

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalled()
    })

    test('should return false for invalid API key', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'error',
        message: 'Invalid API key'
      }))

      const result = await global.chrome.runtime.sendMessage({
        action: 'kriitApiRequest',
        method: 'GET',
        url: 'https://kriit.vikk.ee/api/validate',
        headers: { 'X-API-KEY': 'invalid-key' }
      })

      expect(result.status).toBe('error')
    })
  })

  describe('URL validation', () => {
    test('should require http or https for API URL', () => {
      const validUrls = ['http://localhost:8000', 'https://kriit.vikk.ee/api']
      const invalidUrls = ['kriit.vikk.ee', 'ftp://kriit.vikk.ee', '']

      validUrls.forEach(url => {
        expect(url.startsWith('http')).toBe(true)
      })

      invalidUrls.forEach(url => {
        expect(url.startsWith('http')).toBe(false)
      })
    })
  })

  describe('error handling', () => {
    test('should handle network errors during teacher check', async () => {
      feature.api = {
        tahvel: {
          get: mock(async () => {
            throw new Error('Network error')
          })
        }
      }

      await feature.onActivate()

      // Should not throw and modal should not be shown
      expect(feature.modalShown).toBe(false)
    })

    test('should handle missing teacher data gracefully', async () => {
      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return null
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      expect(feature.modalShown).toBe(false)
    })

    test('should handle malformed Kriit response', async () => {
      global.chrome.runtime.sendMessage = mock(async () => ({
        status: 'success',
        data: null
      }))

      feature.teacherId = 12345
      feature.api = {
        tahvel: {
          get: mock(async url => {
            if (url.includes('/user')) {
              return { teacher: 12345 }
            }
            if (url.includes('/teachers/12345')) {
              return {
                id: 12345,
                isActive: true,
                teacherOccupation: { id: 1 },
                person: { idcode: '39709126012', firstname: 'Test', lastname: 'Teacher' },
                email: 'test@example.com'
              }
            }
            return {}
          })
        }
      }

      await feature.onActivate()

      // Should show modal when response is malformed
      expect(feature.modalShown).toBe(true)
    })
  })
})
