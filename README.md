# Kaaj (काज) — Visual Scrapbook & Journal

Kaaj is a personal visual scrapbook and journal designed around tactile desk paper metaphors, content-addressed block storage, multi-user isolation, and real-time collaboration.

---

## Architecture Overview

Kaaj is structured as a Bun monorepo:

- **`apps/web`**: React 19 frontend with Vite, Tailwind-compatible design tokens, Tiptap rich text editor, Yjs real-time collaboration, and PWA offline capabilities.
- **`apps/api`**: Hono backend on Bun runtime, WebSocket sync server, REST endpoints, Google Drive backup integration, and Prisma ORM 7 database layer.
- **`packages/doc-model`**: Document schemas, TopLevelBlock definitions, chunk slicing logic, and content hashing utilities.
- **`packages/design`**: Pure token definitions (colors, typography, spacing, shadows, physical props) without business logic.
- **`e2e`**: End-to-end integration test suites using Playwright.

---

## Implemented Features

### Phase 1: Multi-Tenancy & User Isolation
- Scoped Prisma extension (`forUser(userId)`) filtering queries and mutations.
- Swappable dev-token authentication seam.
- User-isolated vault paths (`data/vault/<userId>/`).
- Encrypted Google Drive tokens at rest (AES-256-GCM).
- Per-user rate limiting and upload quotas.

### Phase 2: Real-Time Synchronization & Offline Collaboration
- WebSocket server (`/sync/ws`) using Yjs document rooms (`userId:entryId`).
- Awareness protocol for live cursor presence and multi-device editing.
- Offline IndexedDB persistence merging automatically on network reconnection.
- Conflict-free editing replacing pessimistic document locks.

### Phase 3: Custom Right-Click Context Menu
- Custom editor context menu with text styles, headings, lists, quotes, tables, and images.
- Native menu fallback on `Shift + Right-Click` and inside standard input fields.
- Viewport boundary detection, keyboard navigation, and touch long-press support.

### Phase 4: Extended Feature Set
- **Search & Command Palette (4A)**: PostgreSQL `tsvector` weighted search, Cmd+K / Ctrl+K quick switcher.
- **Revision History (4B)**: Content-addressed snapshots, preview, and one-click rollback.
- **Trash & Soft-Delete (4C)**: 30-day retention window, restore, and cascade permanent purge.
- **Rich Editor Blocks (4D)**: Tables, task lists, syntax code blocks, callouts, and collapsible outline sidebar.
- **Tags & Wikilinks (4E)**: `#tags` taxonomy and dynamic `[[entry]]` backlinks drawer.
- **Share Links (4F)**: Unguessable cryptographic tokens, read-only public access, expiration, and revocation.
- **Archive Import & Export (4G)**: ZIP round-trip archives, Markdown export with YAML frontmatter, and Obsidian vault import.
- **User Experience (4H)**: Dark theme, distraction-free focus mode, live word count metrics, daily journal template, and "On This Day" historical recall.
- **Accessibility (4I)**: WCAG 2.1 AA compliant, skip link, ARIA dialog roles, Escape dismissal, and reduced motion support.
- **Progressive Web App (4J)**: Web app manifest and service worker app-shell caching.

---

## Roadmap & Open Items

The following items remain open for future releases:
- **Step 5: Native OS Wrappers**: Package desktop and mobile builds for macOS, Windows, iOS, and Android (Tauri / Capacitor).
- **Client-Side Pack Encryption**: Zero-knowledge end-to-end encryption for backup packs using Argon2id passphrase derivation.

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) (v1.2+)
- [PostgreSQL](https://www.postgresql.org) 17+ running on `localhost:5432`

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/kaaj.git
cd kaaj

# Install dependencies
bun install

# Run database migrations
bun run db:migrate

# Start development servers (frontend on port 3000, backend on port 3001)
bun run dev
```

### Verification & Testing
```bash
# Typecheck all packages and applications
bun run typecheck

# Run end-to-end tests with Playwright
bun run test:e2e
```
