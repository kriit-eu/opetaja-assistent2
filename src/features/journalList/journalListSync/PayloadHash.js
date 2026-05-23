/**
 * Stable hash for a JSON payload. Uses SubtleCrypto SHA-1 when available;
 * falls back to a simple character-sum checksum when crypto is missing.
 */

import Logger from '../../../services/Logger.js'

export async function computePayloadHash(payload) {
  try {
    const text = JSON.stringify(payload)
    if (window && window.crypto && window.crypto.subtle && window.TextEncoder) {
      const encoder = new TextEncoder()
      const data = encoder.encode(text)
      const hashBuffer = await window.crypto.subtle.digest('SHA-1', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }
    let sum = 0
    for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i)) % 0xffffffff
    return `fallback-${sum}`
  } catch (error) {
    Logger.warning('computePayloadHash failed:', error.message)
    return 'hash-failed'
  }
}
