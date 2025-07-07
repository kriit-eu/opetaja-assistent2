// IndependentWorkCapacityFeature.js
// Checks if the number of independent work entries matches the planned hours

export default class IndependentWorkCapacityFeature {
  /**
     * Checks independent work capacity for a journal
     * @param {object} api - API object with tahvel.get
     * @param {number} journalId - Journal ID
     * @returns {Promise<string|null>} - Message to display or null
     */
  static async check (api, journalId) {
    // Only activate if the last-lesson-banner exists and matches the required message
    const banner = document.getElementById('last-lesson-banner')
    if (!banner) return null
    const bannerText = banner.textContent || ''
    // Match: NB! Viimane tund toimus dd.mm.yyyy
    const match = bannerText.match(/NB! Viimane tund toimus (\d{2}\.\d{2}\.\d{4})/)
    if (!match) return null
    // Optionally, you could use match[1] as the last lesson date if needed

    try {
      const info = await api.tahvel.get(`/journals/${journalId}`)
      const capacityHours = info.lessonHours?.capacityHours || []
      const indep = capacityHours.find(c => c.capacity === 'MAHT_i')
      if (!indep) return null
      if (typeof indep.usedHours !== 'number' || typeof indep.plannedHours !== 'number') return null
      const diff = indep.usedHours - indep.plannedHours
      const absDiff = Math.abs(diff)
      if (diff < 0) {
        return `Iseseisvaid töid on ${absDiff}h liiga vähe`
      } else if (diff > 0) {
        return `Iseseisvaid töid on ${absDiff}h liiga palju`
      } else {
        return null
      }
    } catch (e) {
      // Fail silently
      return null
    }
  }

  /**
     * Returns a styled HTML block for the independent work capacity message
     * @param {string|null} message
     * @returns {string}
     */
  static renderMessageBlock (message) {
    if (!message) return ''
    return `<div style="background:#f8d7da;color:#721c24;padding:10px 16px;margin:12px 0 0 0;border-radius:6px;font-size:15px;font-weight:bold;border:1px solid #f5c6cb;">${message}</div>`
  }

  /**
     * Returns a table row HTML for the independent work capacity message
     * @param {string|null} message
     * @returns {string}
     */
  static renderTableRow (message) {
    if (!message) return ''
    // Use the same style as other capacity problem rows
    return `<tr style="background-color:#fffbe6;"><td style='padding:8px;border-bottom:1px solid #e0e0e0;text-align:center;font-weight:bold;' colspan='3'>${message}</td></tr>`
  }
}
