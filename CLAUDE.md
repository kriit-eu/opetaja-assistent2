# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- Install and run dev: `bun start` (installs dependencies and starts file watcher)
- Development build with watch: `bun run dev` (builds and starts watcher)
- Production build: `bun run build` (creates minified production build)
- Build only (dev): `bun run build:dev` (single development build)
- Build only (prod): `bun run build:prod` (single production build)
- Watch for changes: `bun run watch` (file watcher only)

## Project Structure

- Browser extension using Manifest V3
- Feature-based module system with services layer
- Core extension infrastructure in `src/core/`
- Features organized by page context in `src/features/`
    - Journal list feature in `src/features/journalList/`
    - Single journal view feature in `src/features/singleJournal/`
- Shared services in `src/services/`
- Assets directory structure:
    - Build scripts in `assets/scripts/`
    - Extension icons in `assets/icons/`
    - Templates in `assets/templates/`:
        - `manifest.json`: Browser extension manifest template that's copied to the dist directory during build
        - `icon.svg`: Source SVG icon that's converted to PNG icons (48x48, 128x128) during build using Sharp
- Distribution files in `dist/` (generated during build)

## Code Style Guidelines

- Modern ES modules with `import`/`export` syntax
- 2-space indentation (enforced by .editorconfig and .eslintrc.json)
- Class-based architecture with inheritance from BaseFeature
- Comprehensive JSDoc comments for all functions and parameters
- Service-oriented approach with singleton pattern for services
- Feature-based directory organization
- Error handling with Logger service (using "✨" emoji prefix)
- Camel case for variables, methods, and class properties
- PascalCase for class names
- Explicit return types in JSDoc
- DOM manipulation through DomService abstraction
- URL/navigation handling through NavigationService

## Code Formatting and Linting

- EditorConfig (.editorconfig) for consistent editor settings
- ESLint (.eslintrc.json) for both code quality and formatting
- Comprehensive ESLint rules for consistent code style
- Automatic code formatting on project start
- Available scripts:
    - `bun run lint`: Check code for style and quality issues
    - `bun run lint:fix`: Automatically fix linting and formatting issues
    - `bun run format`: Format code with ESLint (alias for lint:fix)
