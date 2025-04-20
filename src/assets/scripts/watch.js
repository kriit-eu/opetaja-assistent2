/**
 * Simple watch script for Opetaja Assistent 2
 *
 * This script watches for changes and rebuilds the extension but the user must
 * refresh the extension in Chrome using the Extension Reloader extension
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// Configuration
const CONFIG = {
  srcDir: 'src',
  distDir: 'dist'
}

console.log('👀 Watching for changes in src directory...')

// Track the last rebuild time to prevent multiple rebuilds in quick succession
let lastRebuildTime = 0
let pendingRebuild = null

// Watch the entire src directory recursively
fs.watch('./src', { recursive: true }, (eventType, filename) => {
  if (filename) {
    console.log(`📝 File changed: ${filename}`)

    const now = Date.now()
    // Prevent multiple rebuilds within 300ms of each other
    if (now - lastRebuildTime < 300) {
      // Clear any pending rebuild and schedule a new one
      clearTimeout(pendingRebuild)
      pendingRebuild = setTimeout(() => triggerRebuild(), 300)
    } else {
      // Trigger rebuild immediately if it's been more than 300ms
      triggerRebuild()
    }
  }
})

// Function to trigger a full rebuild
function triggerRebuild () {
  try {
    lastRebuildTime = Date.now()
    const buildScript = path.join(process.cwd(), 'src', 'assets', 'scripts', 'build.js')
    console.log('🔄 Rebuilding project...')
    execSync(`bun ${buildScript}`, { stdio: 'inherit' })
    console.log('✅ Rebuild complete')
  } catch (error) {
    console.error('❌ Rebuild failed:', error.message)
  }
}

// Handle termination
process.on('SIGINT', () => {
  console.log('Stopping watcher...')
  process.exit(0)
})
