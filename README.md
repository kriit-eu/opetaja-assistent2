# Õpetaja Assistent 2

A browser extension providing additional functionality for Tahvel educational platform.

## Purpose

The primary goal of this project is to streamline the workflow for teachers using the Tahvel platform by automating
repetitive tasks, providing better data visualization, and integrating with external systems like Kriit (like Moodle but
provides a nice overview of all ungraded assignments across all journals on a single web page). This helps reduce manual
effort and ensures data consistency across systems.

### Key Features:

- **Colored Indicators**: Displays visual indicators (e.g., colored triangles) next to journal names to highlight issues
  like missing grades or lessons.
- **Grade Comparison**: Compares grades in the Tahvel system with an external system and highlights discrepancies.
- **Missing Lessons Overview**: Identifies lessons that are in the timetable but missing from the journal.
- **Assignment Syncing**: Automatically syncs assignments with an external system called **Kriit**.
- **Automatic Final Grading**: Calculates and applies final grades based on assignment data.
- **Journal Enhancements**: Improves the journal interface by replacing date headers with assignment titles for better
  clarity.

### Architecture:

- **Core Modules**: Handle the main extension logic, such as feature activation and navigation handling.
- **Features**: Implement specific functionalities (e.g., grade comparison, missing lessons).
- **Services**: Provide shared utilities like DOM manipulation, API communication, and navigation detection.

## Project Structure

This extension uses a Feature-Based Module System with Services Layer architecture:

```
src/
├── background.js                 # Service worker for extension reloading
├── content.js                    # Main entry point
├── core/                         # Core extension infrastructure
│   ├── Extension.js                 # Main extension controller
│   ├── BaseFeature.js               # Base class for all features
│   └── FeaturesRegistry.js          # Central registry of all features
├── features/                     # Feature modules
│   ├── journalList/                 # Features for journal list page
│   │   ├── GradeComparison.js          # Grade comparison functionality
│   │   └── JournalListIndicators.js    # Visual indicators for journals
│   └── singleJournal/               # Features for single journal page
│       ├── AssignmentSync.js           # Syncing with Kriit
│       ├── FinalGrading.js             # Automatic grade calculation
│       ├── JournalEnhancements.js      # UI improvements
│       └── MissingLessons.js           # Missing lesson detection
└── services/                     # Shared services
    ├── ApiService.js                # API communication
    ├── DomService.js                # DOM manipulation utilities
    ├── Logger.js                    # Logging and debugging utilities
    └── NavigationService.js         # URL/navigation handling
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
- **Prettier**: Automatically formats code

Code is automatically formatted and linted when you run `bun start`. You can also run these commands manually:

```bash
# Check for linting issues
bun run lint

# Fix linting issues automatically
bun run lint:fix

# Format code with Prettier
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
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist` directory
