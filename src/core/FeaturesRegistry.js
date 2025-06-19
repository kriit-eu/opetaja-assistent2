/**
 * Features Registry - Import-based feature loading with organized structure
 */
import Logger from '../services/Logger.js'

/**
 * Provides a structured approach to loading features
 * @returns {Promise<Array>} Array of all features
 */
export async function loadFeatures() {
  Logger.debug('Loading features...')

  // Check if Kriit is enabled
  const kriitEnabled = await new Promise(resolve => {
    chrome.storage.sync.get(['OA_kriitEnabled'], result => {
      resolve(result['OA_kriitEnabled'] === true)
    })
  })

  Logger.debug(`Kriit support is ${kriitEnabled ? 'enabled' : 'disabled'}`)

  // Define all available features - load them conditionally
  const allAvailableFeatures = {
    journalList: [],
    singleJournal: [], // TODO: Add features when implemented
    triangles: [],
  }

  // Only import and instantiate features that should be loaded
  if (kriitEnabled) {
    // Import Kriit-dependent features only when Kriit is enabled
    try {
      const { journalListSync } = await import('../features/journalList/JournalListSync.js')
      allAvailableFeatures.journalList.push(journalListSync)
      Logger.debug('Feature "journalListSync" created')
    } catch (error) {
      Logger.error('Error loading journalListSync feature:', error)
    }

    // TODO: Import other Kriit-dependent features when implemented
  } else {
    Logger.debug('Skipping feature journalListSync because it requires Kriit and Kriit is disabled')
  }

  // Load non-Kriit features here (they should always be loaded)

  // Load warning triangles feature (always enabled)
  try {
    const WarningTrianglesFeature = (await import('../features/triangles/WarningTrianglesFeature.js')).default
    const warningTrianglesFeature = new WarningTrianglesFeature()
    allAvailableFeatures.journalList.push(warningTrianglesFeature)
    Logger.debug('Feature "WarningTrianglesFeature" created')
  } catch (error) {
    Logger.error('Error loading WarningTrianglesFeature:', error)
  }

  // Load lesson discrepancies feature (always enabled)
  try {
    const LessonDiscrepanciesFeature = (await import('../features/lessonDiscrepancies/LessonDiscrepanciesFeature.js')).default
    const lessonDiscrepanciesFeature = new LessonDiscrepanciesFeature()
    allAvailableFeatures.singleJournal.push(lessonDiscrepanciesFeature)
    Logger.debug('Feature "LessonDiscrepanciesFeature" created')
  } catch (error) {
    Logger.error('Error loading LessonDiscrepanciesFeature:', error)
  }

  // Load auditory learning checker feature (always enabled)
  try {
    const AuditoryLearningCheckerFeature = (await import('../features/lessonDiscrepancies/AuditoryLearningCheckerFeature.js')).default
    const auditoryLearningCheckerFeature = new AuditoryLearningCheckerFeature()
    allAvailableFeatures.singleJournal.push(auditoryLearningCheckerFeature)
    Logger.debug('Feature "AuditoryLearningCheckerFeature" created')
  } catch (error) {
    Logger.error('Error loading AuditoryLearningCheckerFeature:', error)
  }

  // Create a copy of the features structure for returning
  const featureGroups = {
    journalList: [...allAvailableFeatures.journalList],
    singleJournal: [...allAvailableFeatures.singleJournal],
    triangles: [...allAvailableFeatures.triangles],
  }

  // Flatten all features into a single array
  const allFeatures = Object.values(featureGroups).flat()

  // Log loaded features
  for (const feature of allFeatures) {
    Logger.debug(`Loaded feature: ${feature.name}`)
  }

  Logger.info(`Loaded ${allFeatures.length} feature(s)`)
  return allFeatures
}
