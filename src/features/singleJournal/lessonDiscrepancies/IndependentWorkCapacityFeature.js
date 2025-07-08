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
    const match = bannerText.match(/NB! Viimane tund toimus (\d{2}\.\d{2}\.\d{4})/)
    if (!match) return null

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
}

