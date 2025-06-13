/**
 * Popup script for Õpetaja Assistent 2
 */

// Constants
const DEBUG_MODE_KEY = 'OA_debug_mode';
const CACHE_PREFIX = 'OA_cache_';
const STUDENT_CACHE_PREFIX = CACHE_PREFIX + 'student_';
const KRIIT_ENABLED_KEY = 'OA_kriitEnabled';
const KRIIT_API_URL_KEY = 'OA_kriitApiBaseUrl';
const KRIIT_API_KEY_KEY = 'OA_kriitApiToken';

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup DOM loaded');

  try {
    initPopup();
  } catch (error) {
    console.error('Error initializing popup:', error);
    showError('Failed to initialize popup: ' + error.message);
  }
});

/**
 * Initialize the popup
 */
function initPopup() {
  // Get DOM elements
  const debugModeCheckbox = document.getElementById('debug-mode');
  const clearCacheButton = document.getElementById('clear-cache');
  const versionElement = document.getElementById('version');
  const kriitEnabledCheckbox = document.getElementById('kriit-enabled');
  const kriitSettingsContainer = document.getElementById('kriit-settings-container');
  const kriitApiUrlInput = document.getElementById('kriit-api-url');
  const kriitApiKeyInput = document.getElementById('kriit-api-key');
  const saveKriitSettingsButton = document.getElementById('save-kriit-settings');
  const saveStatusElement = document.getElementById('save-status');
  const errorLogElement = document.getElementById('error-log');
  const cacheStatsContainer = document.getElementById('cache-stats-container');
  const viewCacheDetailsButton = document.getElementById('view-cache-details');
  const refreshCacheStatsButton = document.getElementById('refresh-cache-stats');
  const cacheDetailsContainer = document.getElementById('cache-details');

  // Check if all elements are found
  if (!debugModeCheckbox) throw new Error('Debug mode checkbox not found');
  if (!clearCacheButton) throw new Error('Clear cache button not found');
  if (!versionElement) throw new Error('Version element not found');
  if (!kriitEnabledCheckbox) throw new Error('Kriit enabled checkbox not found');
  if (!kriitSettingsContainer) throw new Error('Kriit settings container not found');
  if (!kriitApiUrlInput) throw new Error('Kriit API URL input not found');
  if (!kriitApiKeyInput) throw new Error('Kriit API key input not found');
  if (!saveKriitSettingsButton) throw new Error('Save Kriit settings button not found');
  if (!saveStatusElement) throw new Error('Save status element not found');
  if (!errorLogElement) throw new Error('Error log element not found');

  // Set version from manifest
  try {
    chrome.runtime.getManifest().then(manifest => {
      versionElement.textContent = manifest.version;
    }).catch(error => {
      console.error('Error getting manifest:', error);
    });
  } catch (error) {
    console.error('Error accessing manifest:', error);
  }

  // Initialize debug mode checkbox
  chrome.storage.sync.get([DEBUG_MODE_KEY], function(result) {
    debugModeCheckbox.checked = result[DEBUG_MODE_KEY] === true;
  });

  // Initialize Kriit API settings
  chrome.storage.sync.get([KRIIT_ENABLED_KEY, KRIIT_API_URL_KEY, KRIIT_API_KEY_KEY], function(result) {
    const kriitEnabled = result[KRIIT_ENABLED_KEY] === true;
    kriitEnabledCheckbox.checked = kriitEnabled;

    // Show/hide Kriit settings based on enabled state
    kriitSettingsContainer.style.display = kriitEnabled ? 'block' : 'none';

    // Set values
    kriitApiUrlInput.value = result[KRIIT_API_URL_KEY] || '';
    kriitApiKeyInput.value = result[KRIIT_API_KEY_KEY] || '';
  });

  // Add event listeners
  debugModeCheckbox.addEventListener('change', function() {
    try {
      toggleDebugMode(debugModeCheckbox.checked);
    } catch (error) {
      console.error('Error toggling debug mode:', error);
      showError('Failed to toggle debug mode: ' + error.message);
    }
  });

  kriitEnabledCheckbox.addEventListener('change', function() {
    try {
      toggleKriitEnabled(kriitEnabledCheckbox.checked, kriitSettingsContainer);
    } catch (error) {
      console.error('Error toggling Kriit support:', error);
      showError('Failed to toggle Kriit support: ' + error.message);
    }
  });

  clearCacheButton.addEventListener('click', function() {
    try {
      clearCache();
    } catch (error) {
      console.error('Error clearing cache:', error);
      showError('Failed to clear cache: ' + error.message);
    }
  });

  saveKriitSettingsButton.addEventListener('click', function() {
    try {
      saveKriitSettings(kriitApiUrlInput.value, kriitApiKeyInput.value, saveStatusElement);
    } catch (error) {
      console.error('Error saving Kriit settings:', error);
      showError('Failed to save Kriit settings: ' + error.message);
    }
  });
  
  // Add event listeners for cache statistics
  viewCacheDetailsButton.addEventListener('click', function() {
    try {
      toggleCacheDetails();
    } catch (error) {
      console.error('Error showing cache details:', error);
      showError('Failed to show cache details: ' + error.message);
    }
  });
  
  refreshCacheStatsButton.addEventListener('click', function() {
    try {
      loadCacheStatistics();
    } catch (error) {
      console.error('Error refreshing cache statistics:', error);
      showError('Failed to refresh cache statistics: ' + error.message);
    }
  });
  
  // Load cache statistics
  loadCacheStatistics();

  console.log('Popup initialized successfully');
}

/**
 * Toggle debug mode
 * @param {boolean} enabled - Whether debug mode should be enabled
 */
function toggleDebugMode(enabled) {
  chrome.storage.sync.set({ [DEBUG_MODE_KEY]: enabled }, function() {
    console.log('Debug mode set to:', enabled);

    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggleDebugMode',
          enabled: enabled
        }).catch(error => {
          console.error('Error sending message:', error);
        });
      }
    });
  });
}

/**
 * Toggle Kriit integration
 * @param {boolean} enabled - Whether Kriit integration should be enabled
 * @param {HTMLElement} settingsContainer - Container for Kriit settings
 */
function toggleKriitEnabled(enabled, settingsContainer) {
  chrome.storage.sync.set({ [KRIIT_ENABLED_KEY]: enabled }, function() {
    console.log('Kriit integration set to:', enabled);

    // Show/hide settings container
    settingsContainer.style.display = enabled ? 'block' : 'none';

    // Notify content script about the change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && (tabs[0].url.includes('tahvel.edu.ee') || tabs[0].url.includes('tahvel.eenet.ee'))) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'kriitEnabledChanged',
          enabled: enabled
        }).catch(error => {
          console.error('Error sending message:', error);
        });
      }
    });
  });
}

/**
 * Save Kriit API settings
 * @param {string} apiUrl - The API URL
 * @param {string} apiKey - The API key
 * @param {HTMLElement} statusElement - Element to show status message
 */
function saveKriitSettings(apiUrl, apiKey, statusElement) {
  apiUrl = apiUrl.trim();
  apiKey = apiKey.trim();

  // Validate URL
  if (apiUrl && !apiUrl.startsWith('http')) {
    alert('API URL peab algama http:// või https://');
    return;
  }

  // Save settings to chrome.storage.sync
  chrome.storage.sync.set({
    [KRIIT_ENABLED_KEY]: true, // Enable Kriit integration when settings are saved
    [KRIIT_API_URL_KEY]: apiUrl || DEFAULT_KRIIT_API_URL,
    [KRIIT_API_KEY_KEY]: apiKey
  }, function() {
    console.log('Kriit API settings saved');

    // Show success message
    statusElement.textContent = 'Salvestatud!';
    setTimeout(() => {
      statusElement.textContent = '';
    }, 2000);

    // Notify content script about the settings change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && (tabs[0].url.includes('tahvel.edu.ee') || tabs[0].url.includes('tahvel.eenet.ee'))) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'kriitSettingsUpdated',
          enabled: true,
          apiUrl: apiUrl,
          apiKey: apiKey
        }).catch(error => {
          console.error('Error sending message:', error);
        });
      }
    });
  });
}

/**
 * Load and display cache statistics
 */
function loadCacheStatistics() {
  const cacheStatsContainer = document.getElementById('cache-stats-container');
  
  if (!cacheStatsContainer) {
    console.error('Cache stats container not found');
    return;
  }
  
  cacheStatsContainer.innerHTML = '<div>Laadimine...</div>';
  
  // Send message to background script to get cache statistics
  chrome.runtime.sendMessage({ action: 'getCacheStats' }, function(response) {
    if (!response || !response.stats) {
      cacheStatsContainer.innerHTML = '<div>Vahemälu statistika pole saadaval</div>';
      return;
    }
    
    const stats = response.stats;
    
    // Format the statistics
    const storageSize = formatSize(stats.storage.size);
    const memorySize = formatSize(stats.memory.size);
    const totalSize = formatSize(stats.totalBytesInUse);
    
    // Update the container
    cacheStatsContainer.innerHTML = `
      <div><b>Vahemälu kirjeid:</b> ${stats.storage.count}</div>
      <div><b>Vahemälu suurus:</b> ${storageSize}</div>
      <div><b>Kogu kasutus:</b> ${totalSize}</div>
    `;
    
    // Update details container
    updateCacheDetailsContent(stats);
  });
}

/**
 * Update cache details content
 * @param {Object} stats - Cache statistics
 */
function updateCacheDetailsContent(stats) {
  const cacheDetailsContainer = document.getElementById('cache-details');
  
  if (!cacheDetailsContainer) return;
  
  // Generate HTML for the details
  let html = '<h3>Vahemälu sisu:</h3>';
  
  // Add table of largest items
  if (stats.storage.items.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse;">';
    html += '<tr><th style="text-align: left;">Kirje</th><th style="text-align: right;">Suurus</th><th style="text-align: right;">Vanus</th></tr>';
    
    // Show only top 10 items
    const topItems = stats.storage.items.slice(0, 10);
    
    topItems.forEach(item => {
      // Format key name to be shorter
      let displayKey = item.key;
      if (displayKey.includes('/')) {
        const parts = displayKey.split('/');
        displayKey = parts[parts.length - 1];
        if (displayKey.includes('?')) {
          displayKey = displayKey.split('?')[0];
        }
      }
      
      // Format size and age
      const size = formatSize(item.size);
      const age = formatAge(item.ageInMinutes);
      
      html += `<tr>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0;" title="${item.key}">${displayKey}</td>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0; text-align: right;">${size}</td>
        <td style="border-bottom: 1px solid #eee; padding: 4px 0; text-align: right;">${age}</td>
      </tr>`;
    });
    
    html += '</table>';
    
    if (stats.storage.items.length > 10) {
      html += `<div style="text-align: center; margin-top: 8px; font-style: italic;">+ ${stats.storage.items.length - 10} muud kirjet</div>`;
    }
  } else {
    html += '<div>Vahemälu on tühi</div>';
  }
  
  cacheDetailsContainer.innerHTML = html;
}

/**
 * Toggle cache details visibility
 */
function toggleCacheDetails() {
  const cacheDetailsContainer = document.getElementById('cache-details');
  const viewCacheDetailsButton = document.getElementById('view-cache-details');
  
  if (!cacheDetailsContainer || !viewCacheDetailsButton) return;
  
  const isVisible = cacheDetailsContainer.style.display !== 'none';
  
  if (isVisible) {
    cacheDetailsContainer.style.display = 'none';
    viewCacheDetailsButton.textContent = 'Vaata detaile';
  } else {
    cacheDetailsContainer.style.display = 'block';
    viewCacheDetailsButton.textContent = 'Peida detailid';
  }
}

/**
 * Format a byte size to a human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Format age in minutes to a human-readable string
 * @param {number} minutes - Age in minutes
 * @returns {string} Formatted age
 */
function formatAge(minutes) {
  if (minutes < 1) return 'äsja';
  if (minutes < 60) return minutes + ' min';
  if (minutes < 24 * 60) return Math.round(minutes / 60) + ' h';
  return Math.round(minutes / (60 * 24)) + ' päeva';
}

/**
 * Clear all cache items
 */
function clearCache() {
  chrome.storage.local.get(null, function(items) {
    const keysToRemove = Object.keys(items).filter(key => key.startsWith(CACHE_PREFIX));

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, function() {
        console.log(`Cleared ${keysToRemove.length} cache items`);

        // Notify the user
        alert(`Tühjendatud ${keysToRemove.length} vahemälu kirjet.`);
        
        // Refresh the cache statistics
        loadCacheStatistics();

        // Notify content script about the cache clear
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'cacheClearedFromPopup'
            }).catch(error => {
              console.error('Error sending message:', error);
            });
          }
        });
      });
    } else {
      alert('Vahemälu on juba tühi.');
    }
  });
}

/**
 * Show error message in the error log element
 * @param {string} message - Error message to display
 */
function showError(message) {
  const errorLogElement = document.getElementById('error-log');
  if (errorLogElement) {
    errorLogElement.textContent = message;
    errorLogElement.style.display = 'block';
  }
}
