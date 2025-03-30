/**
 * Features Registry - Import-based feature loading with organized structure
 */
import Logger from '../services/Logger.js'

// Journal List Features
import { journalListIndicators } from '../features/journalList/JournalListIndicators.js'
import { gradeComparison } from '../features/journalList/GradeComparison.js'

// Single Journal Features
import { missingLessons } from '../features/singleJournal/MissingLessons.js'
import { assignmentSync } from '../features/singleJournal/AssignmentSync.js'
import { finalGrading } from '../features/singleJournal/FinalGrading.js'
import { journalEnhancements } from '../features/singleJournal/JournalEnhancements.js'

/**
 * Provides a structured approach to loading features
 * @returns {Promise<Array>} Array of all features
 */
export async function loadFeatures () {
  Logger.debug('Loading features...')

  // Define feature groups for better organization
  const featureGroups = {
    journalList: [journalListIndicators, gradeComparison],
    singleJournal: [missingLessons, assignmentSync, finalGrading, journalEnhancements],
  }

  // Flatten all features into a single array
  const allFeatures = Object.values(featureGroups).flat()

  // Log loaded features
  for (const feature of allFeatures) {
    Logger.debug(`Loaded feature: ${feature.name}`)
  }

  Logger.success(`Successfully loaded ${allFeatures.length} features`)
  return allFeatures
}

// Export all features in an array for backward compatibility
export const features = [
  // Journal List Features
  journalListIndicators,
  gradeComparison,

  // Single Journal Features
  missingLessons,
  assignmentSync,
  finalGrading,
  journalEnhancements,
]
