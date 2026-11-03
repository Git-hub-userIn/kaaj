# Changelog

All notable changes to Kaaj are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Roadmap (Open Items)
- **Step 5 Native OS Wrappers**: Package desktop and mobile applications for macOS, Windows, iOS, and Android (Tauri / Capacitor).
- **Client-Side Pack Encryption**: Implement zero-knowledge end-to-end encryption for Google Drive backup packs with Argon2id passphrase derivation.

---

## [0.5.0] - 2026-11-03

### Added
- **Phase 1: User Isolation & Multi-Tenancy**:
  - Added `User` table and `userId` foreign keys across `Category`, `Entry`, `Chunk`, `EntryManifest`, `AssetMeta`, `MaintenanceState`, and `JobLease`.
  - Created scoped Prisma Client extension via `forUser(userId)` with query interception.
  - Implemented dev-token authentication guard seam in Hono API.
  - Separated vault storage by user path (`data/vault/<userId>/`).
  - Added user-level Google Drive token encryption at rest using AES-256-GCM.
  - Added user rate limiting and storage quotas.
- **Phase 2: Real-Time WebSocket Synchronization**:
  - Replaced SSE sync with WebSocket `/sync/ws` endpoint in Hono.
  - Implemented multi-client Yjs document rooms scoped to `userId:entryId`.
  - Added client-side awareness state and cursor presence.
  - Added offline IndexedDB persistence with automatic sync merge on reconnection.
  - Added live status badges ("Saved", "Syncing...", "Offline", "Error").
- **Phase 3: Custom Right-Click Context Menu**:
  - Prevented default browser context menu in editor content area.
  - Added rich formatting actions: headings, lists, quotes, tables, alignment, cut, copy, paste.
  - Enforced viewport boundaries and keyboard navigation with Escape key dismissal.
  - Preserved native browser context menu on `Shift + right-click` and inside native input elements.
  - Added long-press touch trigger for mobile devices.
- **Phase 4A: Full-Text Search & Command Palette**:
  - Added PostgreSQL `tsvector` weighted search over entry chunks and category metadata.
  - Created global Cmd+K / Ctrl+K Command Palette with instant search, jump-to, and entry creation.
- **Phase 4B: Document Revision History**:
  - Added content-addressed chunk snapshotting (`EntryRevision` model).
  - Built sliding revision history drawer with version list, side-by-side preview, and one-click restore.
- **Phase 4C: Trash & Soft-Delete**:
  - Implemented 30-day soft-delete retention window for categories and entries (`deletedAt`).
  - Created Trash Modal interface with restore, single-entry purge, and empty trash actions.
- **Phase 4D: Rich Editor Blocks & Outline Navigation**:
  - Integrated Tiptap tables, task lists, code blocks, and custom callouts (warning, success, note).
  - Added markdown shortcut triggers (`##`, `- [ ]`, ````code`, `> [!NOTE]`).
  - Created collapsible Outline Sidebar for table-of-contents jump navigation.
- **Phase 4E: Tags & Wikilinks Backlinks**:
  - Added `Tag` and `EntryTag` models with scoped management endpoints.
  - Added dynamic `[[entry]]` wikilink resolution across stored chunk payloads.
  - Built Backlinks Drawer displaying incoming references and mentions.
- **Phase 4F: Read-Only Public Share Links**:
  - Added `ShareLink` model with unguessable cryptographic tokens.
  - Added public `/shared/:token` route bypassing authentication.
  - Added expiration durations and one-click link revocation.
- **Phase 4G: Archive Import & Export**:
  - Added ZIP archive round-trip (`manifest.json`, `categories.json`, `entries/`, `markdown/`, `attachments/`).
  - Added Markdown export with YAML frontmatter and Obsidian vault importer.
- **Phase 4H: Enhanced User Experience**:
  - Implemented Dark Theme with CSS custom properties, toggle button, and persistent storage.
  - Added distraction-free Focus Mode with centered canvas and floating exit button.
  - Added live word count and reading time badge.
  - Added Daily Journal template creation and "On This Day" historical memory recall.
- **Phase 4I: Accessibility Pass (WCAG 2.1 AA)**:
  - Added explicit ARIA labels and semantic roles across modals, drawers, and buttons.
  - Added keyboard skip-to-content link.
  - Added Escape key dismiss handlers for all overlays.
  - Added `prefers-reduced-motion` media queries and visible high-contrast focus rings.
- **Phase 4J: Progressive Web App (PWA)**:
  - Created `manifest.webmanifest` with standalone display configuration.
  - Added Service Worker (`sw.js`) with app shell pre-caching and offline capability.
  - Registered service worker in web client entrypoint.
