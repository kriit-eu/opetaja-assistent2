/**
 * Features Registry - Import-based feature loading with organized structure
 */
import Logger from '../services/Logger.js'

// Journal List Features
import { journalListSync } from '../features/journalList/JournalListSync.js'
// TODO: Import other features when implemented
// import { journalListIndicators } from '../features/journalList/JournalListIndicators.js'
// import { gradeComparison } from '../features/journalList/GradeComparison.js'

// Single Journal Features
// import { missingLessons } from '../features/singleJournal/MissingLessons.js'
// import { assignmentSync } from '../features/singleJournal/AssignmentSync.js'
// import { finalGrading } from '../features/singleJournal/FinalGrading.js'
// import { journalEnhancements } from '../features/singleJournal/JournalEnhancements.js'

/**
 * Provides a structured approach to loading features
 * @returns {Promise<Array>} Array of all features
 */
export async function loadFeatures () {
  Logger.debug('Loading features...')

  // Define feature groups for better organization
  const featureGroups = {
    journalList: [journalListSync],  // Add more features when implemented
    singleJournal: [], // TODO: Add features when implemented
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

// Export all features in an array for backward compatibility
export const features = [
  // Journal List Features
  journalListSync,

  // Single Journal Features
  // TODO: Add more features when implemented
]
