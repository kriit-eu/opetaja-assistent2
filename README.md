# Õpetaja Assistent 2

A browser extension providing additional functionality for Tahvel educational platform.

## Purpose

The primary goal of this project is to streamline the workflow for teachers using the Tahvel platform by automating
repetitive tasks, providing better data visualization, and integrating with external systems like Kriit (like Moodle but
provides a nice overview of all ungraded assignments across all journals on a single web page). This helps reduce manual
effort and ensures data consistency across systems.

### Features:

#### Implemented:
- **Journal List Sync**: Comprehensive synchronization between Tahvel and Kriit systems
  - Compares grades between Tahvel and Kriit and highlights discrepancies
  - Syncs assignments, students, and their personal codes
  - Displays interactive banners showing differences that need to be synced
  - Handles student status validation (active/inactive)
  - Provides detailed sync progress and error reporting
- **Popup Interface**: Extension popup with settings and cache management
  - Debug mode toggle for enhanced logging
  - Kriit integration settings (API URL and key configuration)
  - Cache statistics and management tools
  - Real-time cache size monitoring and cleanup
- **Visual Indicators**: Extension activity indicator in the Tahvel interface
- **Caching System**: Intelligent caching to prevent redundant API calls
- **Error Handling**: Comprehensive error logging and user feedback
- **Lesson Discrepancies**: Detects and displays discrepancies between the timetable and journal entries for lessons, and validates lesson capacity types.
  - Highlights missing or mismatched lessons between the timetable and journal.
  - Performs background and table-based validation of lesson capacity (e.g., “auditoorne”/“independent work”).
  - Integrates with the UI to allow fixing issues directly from the discrepancies table.

#### Planned (TODO):
- **Single Journal Features**: Features for individual journal pages
  - Missing Lessons Overview: Identify lessons in timetable but missing from journal
  - Assignment Sync for Single Journal: Sync assignments with external systems
  - Final Grading: Automatically calculate and apply final grades
  - Journal Enhancements: Improve journal interface with better visualization
- **Enhanced Journal List Indicators**: Additional visual indicators for various issues

*Note: Additional features are under active development.*

### Architecture:

- **Core Modules**: Handle the main extension logic, feature activation, and navigation handling.
- **Features**: Implement specific functionalities organized by page context (journal list, single journal).
- **Services**: Provide shared utilities like DOM manipulation, API communication, caching, and UI components.
- **Popup Interface**: Provides user settings, debug controls, and cache management.
- **Testing Suite**: Comprehensive tests for core functionality and edge cases.

## Project Structure

This extension uses a Feature-Based Module System with Services Layer architecture:

```
src/
├── background.js                 # Service worker for extension reloading
├── content.js                    # Main entry point
├── assets/                       # Static assets and build scripts
│   ├── icons/                       # SVG icons for the extension
│   ├── scripts/                     # Build and watch scripts
│   ├── styles/                      # CSS for feature components
│   └── templates/                   # Templates for manifest and icons
├── core/                         # Core extension infrastructure
│   ├── Extension.js                 # Main extension controller
│   ├── BaseFeature.js               # Base class for all features
│   └── FeaturesRegistry.js          # Central registry of all features
├── features/                     # Feature modules
│   ├── journalList/                 # Features for journal list page
│   │   ├── JournalListSync.js          # Journal list sync implementation
│   │   └── README.md                   # Documentation for planned features
│   └── singleJournal/               # Features for single journal page
│       └── README.md                   # Documentation for planned features
└── services/                     # Shared services
    ├── ApiService.js                # API communication
    ├── CacheService.js              # Data caching utilities
    ├── DomService.js                # DOM manipulation utilities
    ├── Logger.js                    # Logging and debugging utilities
    ├── NavigationService.js         # URL/navigation handling
    └── StyleService.js              # CSS injection utilities
```

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0.0 or higher
- [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
  Chrome extension (for extension reloading)

### Development Workflow

1. Start the development server:
   ```bash
   bun start
   ```

   This single command:
    - Installs dependencies
    - Automatically formats and lints code
    - Builds the extension
    - Starts the file watcher

2. Load the extension in your browser:
    - Navigate to `chrome://extensions/` (or equivalent for your browser)
    - Enable "Developer mode"
    - Click "Load unpacked" and select the `dist` directory

3. Set up Extensions Reloader:
    - Install
      the [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
      Chrome extension
    - Configure it to reload the page automatically (via its options)

4. Make changes to the code:
    - Edit files in the `src` directory and save the file
    - The dev server will automatically rebuild when files change
    - Click the Extensions Reloader's icon or use its keyboard shortcut (Alt+R or Opt+Shift+R) to reload the extension
      and refresh the page

5. View debug output:
    - Open browser's Developer Tools (F12 or Cmd+Option+I)
    - Look for extension logs in the Console tab
    - Filter console by "✨" to see only extension logs

### Code Style and Linting

This project uses several tools to maintain consistent code style:

- **EditorConfig**: Ensures consistent editor settings across different IDEs
- **ESLint**: Enforces code quality and style rules

Code is automatically formatted and linted when you run `bun start`. You can also run these commands manually:

```bash
# Check for linting issues
bun run lint

# Fix linting issues automatically
bun run lint:fix

# Format code with ESLint
bun run format
```

## Production Build

For a production build:

```bash
bun run build
```

This will:

1. Clean the dist directory
2. Build and minify the JavaScript files
3. Copy static assets and manifest.json
4. Output production-ready files to the `dist` directory
5. Open your browser and navigate to the extensions page
    - Chrome: `chrome://extensions/`
    - Edge: `edge://extensions/`
    - Other Chromium browsers: Check your browser's extension management page
6. Enable "Developer mode"
7. Click "Load unpacked" and select the `dist` directory
