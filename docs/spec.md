# Kaaj — Product, Architecture & Agent Spec

Working spec v0.2 · 26 Oct 2026 · Status: Active implementation.

## 0. How to read this

Audience: the owner and the coding agent (Antigravity). Section 16 is the agent rulebook.

Every decision carries an explicit status:
- **LOCKED**: build it exactly as specified.
- **DEFAULT**: build it unless the owner directs a change.
- **SPIKE**: evaluate with a prototype before finalizing.
- **OPEN**: needs a decision from the owner.

## 1. Product

**Kaaj** (काज) is a personal visual scrapbook and journal app. In Hindi, *kaaj* means work or task, and also the buttonhole in tailoring. The app must feel like a handmade archive, not a productivity dashboard.

### Principles (LOCKED)

- Writing first, decoration optional. A new entry opens ready for typing.
- Visual discovery over folder administration: categories display imagery.
- The document is one infinite-scroll rich text. It has no fixed pages and no layers.
- Single user. Web codebase, later wrapped for Windows, macOS, iOS, and Android.
- The user owns the content: export and import in a documented format.
- Responsive design on phone, tablet, and laptop viewports.
- App-owned document format. Tiptap JSON is never the canonical copy.
- Snappy interactions. Typing and navigation never wait on the network.
- Fast local vault storage paired with cloud backup.

### Non-goals for v1

Real-time collaboration across multiple users, user accounts, automatic pagination, public sharing, video hosting, freeform drawing canvas.

### Future (design must not block these)

Read-only share links per entry (token-based). Ownership via the auth seam. Full-text search. Content-anchored annotations. Native OS wrappers (Capacitor/Tauri/Electron).

## 2. Screens and journeys

### 2.1 Home: image-led category collage (LOCKED)

- Categories show as a collage of varied-size image cards. The category name is a small caption.
- Missing cover image: designed placeholder (color or composition), never a broken-image icon.
- Create, rename, delete: discoverable and accessible via keyboard.
- Narrow screens reflow into a clean column. Never retain desktop coordinates.
- Collage placement: DEFAULT derived from category ID and sort order. Persist positions only if drag-to-arrange is added.

### 2.2 Category: messy stack of books (LOCKED look, details DEFAULT)

- Entries display as books lying flat in structured piles. Title is on the left, date is on the right of each spine.
- Thickness reflects entry **weight**, clamped between 44 px and 104 px.
- Newest entries sit at the top. Pinned entries appear first.
- Visual variation (left offset, tilt up to 1.2 degrees, spine color when unset) derives from a hash of the entry ID. Never store random visual noise. Titles stay horizontal and readable.
- Multi-pile layout: entries divide into piles of 10 resting on wooden table strips with month or pile labels. Continuous vertical scroll.
- Actions per book: open, rename, move category, customize spine, pin, delete. Open on click or tap. Menu via `...` button, long-press, or right-click.
- Hover or focus displays a floating entry details card after 250 ms.
- Accessibility: the stack is a semantic list of buttons. Tab order follows sort order.

### 2.3 Editor: infinite-scroll rich text (LOCKED)

- Layout: single continuous rich-text column (maximum width ~760 px) on paper background.
- Infinite scroll: no fixed pages, no page breaks, no "page full" warnings. Pages exist only inside storage as chunks.
- No freeform layers or canvas overlays. Layers are postponed.
- Typography: per-selection fonts and font sizes are allowed. Inline marks apply via selection toolbar.
- Title: large serif title field at top. Title saves with the entry and renders on the book spine.
- Visible save state: `Saving`, `Saved · just now`, `Couldn't save · Retry`.
- Undo and redo support. Reduced-motion settings respected.
- Mobile (<768 px): docked toolbar above on-screen keyboard (`visualViewport`). Touch targets >= 44 px.

### 2.4 Journeys the e2e suite must cover

- **A.** Create, rename, delete a category with an optional cover.
- **B.** Create an entry, type rich text, apply formatting marks and per-selection fonts, autosave, leave, reopen, verify text.
- **C.** Insert images via paste, drag-and-drop, and toolbar button; resize image width; verify asset ID storage and thumbnail generation.
- **D.** View entry across laptop, tablet, and phone viewports without horizontal scroll.
- **E.** Edit large entry with chunked storage, verify smooth scrolling, fast typing, and reload persistence.
- **F.** Verify sync states (0 local only, 1 upload, 2 editing), Yjs merge, and crash recovery from Google Drive backup.

## 3. Decision log

| Topic | Decision | Status |
| --- | --- | --- |
| Name | Kaaj | LOCKED |
| Users | Single user, no multi-user accounts | LOCKED |
| Platforms | Web first, wrapped later for Windows/Mac/iOS/Android | LOCKED |
| Editor Layout | Single continuous infinite-scroll rich-text column (~760 px) | LOCKED |
| Pages | No fixed pages in UI. Pages exist only inside storage as chunks | LOCKED |
| Layers & Canvas | Postponed. No freeform objects or overlay canvas in v1 | LOCKED |
| Images in Editor | Inline images via asset ID only. Paste, drop, button insert | LOCKED |
| Storage Architecture | Local vault folder (notes + attachments) for fast lookup | LOCKED |
| Cloud Storage | Google Drive holds bulk data and backups | LOCKED |
| Hot Writes & Sync | WebSocket (/sync/ws) Yjs room sync, awareness, and debounced flush | LOCKED |
| Database | PostgreSQL on Render (metadata, spine weight, hot state) | LOCKED |
| Sync States | State 0: local only, State 1: upload, State 2: editing | LOCKED |
| Document Merging | Yjs CRDT performs merge operations | LOCKED |
| Crash Recovery | Base state from Google Drive + local changes replay | LOCKED |
| Spine Size | `weight` stored in DB, derived from content and stats | LOCKED |
| Fonts | Per-selection fonts and sizes allowed via inline marks | LOCKED |
| Server Runtime | Node and Bun compatible Hono API | DEFAULT |
| Testing | End-to-end only via Playwright. No unit tests | LOCKED |
| PDF Export | Headless Chromium via Playwright | DEFAULT |
| Vault Architecture | OPFS in browser (IndexedDB fallback), OS app-data folder in wrappers later. One VaultStore interface | LOCKED |
| Google Drive Auth | User OAuth2, refresh token, narrow scope (`drive.file`). Set to Production mode to avoid 7-day token expiry | LOCKED |
| Backup Policy | Periodic (15 min, only if changed) + on entry close + manual | LOCKED |
| Chunks | 50 blocks / 64 KB split boundary | DEFAULT |

## 4. Tech stack

- **Frontend:** React, Vite, TypeScript, single-page app.
- **Rich text:** Tiptap core with MIT extensions. No paid or Pro extensions.
- **Collaborative Sync & Merge:** Yjs CRDT for document state and chunk merge.
- **Validation:** Zod schemas shared across web and api via `@kaaj/doc-model`.
- **Backend:** Hono running on Node or Bun. Provides REST endpoints and WebSocket `/sync/ws`.
- **Database:** PostgreSQL on Render. Stores categories, entry metadata, spine styles, weights, and hot sync logs.
- **Local Storage:** Local vault file system structure for instant lookup and offline access.
- **Cloud Bulk Storage & Backup:** Google Drive API for full backups and media archives.
- **Image Processing:** `sharp` for magic byte validation, EXIF stripping, and WebP thumbnail generation.
- **Export Engine:** Headless Chromium via Playwright.
- **Tests:** Playwright end-to-end tests only.

## 5. Repository layout and module boundaries

```
kaaj/
  apps/
    web/                React UI. No direct database or file system access
      src/features/     home, category, editor (richtext, images), sync
      src/lib/          api client, vault client, yjs provider, draft store
    api/                Hono server
      src/routes/       thin route handlers: validate with Zod, invoke service
      src/services/     entries, categories, assets, sync, export, drive
      src/stores/       local vault store, drive client
      src/auth/         single-user auth guard seam
  packages/
    doc-model/          Zod schemas, chunk types, migrations, weight(). Pure TS
    design/             tokens, fonts, icons, seed covers. No components
  e2e/                  Playwright e2e tests
  docs/                 specs and technical documentation
```

### Boundary rules (LOCKED)

- `doc-model` is pure TypeScript. It has no I/O, no React, and no framework dependencies. It depends only on Zod.
- `web` and `api` never import each other. They share `doc-model` and `design`.
- `design` contains static design assets and tokens only. It contains no components and no business logic.
- User uploads are never design assets. Uploads pass through the asset store, receive an asset ID, and store in the vault.
- Convert between Tiptap and canonical format only in the editor adapter.
- Shared UI primitives live in one directory in `web` and are reused.
- Routes contain no business logic. Services receive dependencies as arguments.

## 6. Document and chunk model

### 6.1 Infinite-scroll editor document (LOCKED)

- The user edits a single continuous document without visible page boundaries.
- Every top-level block possesses a stable string ID (`blk_...`).
- The canonical document format is ProseMirror JSON validated against `@kaaj/doc-model`.

### 6.2 Storage chunk model (LOCKED)

- Documents split into chunks for storage and sync.
- A chunk contains an ordered group of top-level blocks.
- Chunks split by block count (DEFAULT 50 blocks) or serialized size (DEFAULT 64 KB).
- Chunks load on demand as the user scrolls.
- Chunks save independently to reduce network payload and disk I/O.
- Chunk manifest records chunk sequence, chunk IDs, block counts, and checksums.

### 6.3 Envelope Schema (schemaVersion: 2)

```json
{
  "schemaVersion": 2,
  "doc": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "id": "blk_a1b2c3d4", "level": 1, "textAlign": "left" },
        "content": [{ "type": "text", "text": "Field Notes" }]
      },
      {
        "type": "paragraph",
        "attrs": { "id": "blk_e5f6g7h8", "textAlign": "left" },
        "content": [
          { "type": "text", "text": "Writing in " },
          {
            "type": "text",
            "text": "Newsreader serif",
            "marks": [{ "type": "textStyle", "attrs": { "fontFamily": "newsreader" } }]
          }
        ]
      }
    ]
  }
}
```

### 6.4 Node and mark whitelist (LOCKED)

- **Blocks:** `doc`, `paragraph`, `heading` (levels 1-3), `bulletList`, `orderedList`, `listItem`, `blockquote`, `horizontalRule`, `image`.
- **Image Block:** `assetId` (string), `alt` (string?), `width` (number, percentage 20-100%). Never stores URLs.
- **Marks:** `bold`, `italic`, `underline`, `strike`, `link` (`http`, `https`, `mailto`), `textStyle` (`fontFamily`, `fontSize`, `color`), `highlight`.
- **Palette Tokens:** Text colors and highlights use tokens from `@kaaj/design`. Text colors satisfy 4.5:1 contrast.

## 7. Data model (PostgreSQL & Local Vault)

### PostgreSQL (Render)

**Category:** id, title, description?, coverAssetId?, sortOrder, color?, todo (jsonb), version (int), createdAt, updatedAt, deletedAt?.

**CategoryStats (computed):** entries, words, images, createdAt, lastEditedAt, entriesPerMonth (6-month array).

**Entry:** id, categoryId (FK), title, schemaVersion (int), version (int), weight (int), sortOrder, color?, pinned (bool), spine (jsonb), stats (jsonb), syncState (int: 0, 1, 2), chunkCount (int), createdAt, updatedAt, lastOpenedAt?, deletedAt?.

**Asset:** id, storageKey, mime, bytes, width?, height?, originalName?, checksum, createdAt.

**EntryAsset:** entryId, assetId. Tracks asset references for cleanup and export.

### Rules

- Foreign keys and constraints remain active. Transactions protect multi-table writes.
- `weight` stays in the PostgreSQL database row. The backend computes weight from character, word, and image counts.
- Category and entry lists return light rows only. They never return chunk bodies.

## 8. Storage, sync, and concurrency

### 8.1 Multi-tier storage architecture (LOCKED)

1. **Local Vault Folder:** Fast disk storage on the user device. Contains notes, chunks, attachments, and manifests.
2. **PostgreSQL on Render:** Stores metadata, spine weight, sync logs, and active editing state. Handles hot writes.
3. **Google Drive:** Holds bulk data, media archives, and complete system backups. Protects against Render database loss.

### 8.2 Sync states (LOCKED)

- **State 0: Local only.** Changes exist only in the local vault or IndexedDB draft. Not yet sent to backend.
- **State 1: Upload.** Changes sent to backend. Backend persists hot write to database and vault, and queues Drive backup.
- **State 2: Editing.** Active editing session. Changes stream via Yjs updates over WebSocket `/sync/ws`.

### 8.3 Concurrency and Yjs merge (LOCKED)

- Yjs CRDT handles document merges across devices and offline reconnection.
- Edit-lock leases are removed. Multiple devices merge concurrent edits deterministically.
- Backend acts as the central relay: manages in-memory `Y.Doc` rooms (`userId:entryId`) over `/sync/ws`, debouncing flushes to chunked storage.

### 8.4 Crash recovery (LOCKED)

- If a client or backend crashes, restore the document from the Google Drive base state plus local changes.
- Local IndexedDB drafts and vault journal replay uncommitted edits onto the base state.
- Data loss must not occur.

### 8.5 Backup target and Google Drive architecture (LOCKED)

- **Target Abstraction:** Backups sit behind a unified `BackupTarget` interface (`put`, `list`, `get`). Implementations include `LocalFolderBackupTarget` (for offline/testing) and `GoogleDriveBackupTarget` (cloud snapshots).
- **Google Drive Auth & Scope:** Standard OAuth 2.0 consent flow. Refresh tokens store locally in `data/google-oauth.json` (gitignored). Uses the narrow scope `https://www.googleapis.com/auth/drive.file`. Google Cloud project publishing status is set to **In production** to avoid the 7-day testing refresh token expiry.
- **Incremental Snapshots:** Snapshots diff previous manifests by SHA-256 checksums and upload only modified chunks and new assets.
- **Triggers:** Manual UI button ("Backup now"), periodic background timer (every 15 minutes only if data hash changed), and on entry close (debounced). Backups run asynchronously and never block typing.
- **Restore Safety:** Restores snapshots into clean directories with SHA-256 integrity validation. Rejects non-empty target directories unless `--force` is explicitly provided.

## 9. Assets and images

### 9.1 Asset requirements (LOCKED)

- Insertion: paste from clipboard, drag-and-drop into editor, or toolbar button file selection.
- Validation: inspect file magic bytes (signatures), enforce 20 MB size limit, allow JPEG, PNG, WebP, GIF. Reject SVG uploads.
- Sanitization: strip EXIF metadata using `sharp`.
- Thumbnails: generate WebP thumbnails (320 px and 960 px widths) on upload.
- Document reference: doc stores asset ID only (`assetId`), never a file URL or signed URL.
- Resize control: inline image displays width resize handle (20% to 100% column width).
- Failure safety: a failed upload removes the placeholder node immediately. No dangling references exist in the document.

## 10. Export and import

- **Full archive:** ZIP with `manifest.json`, `categories/<id>.json`, `entries/<id>/`, and `assets/<assetId>.<ext>`.
- **Markdown:** plain Markdown text, relative asset references, companion frontmatter.
- **PDF:** rendered via headless Chromium through Playwright.

## 11. Authentication & User Isolation (LOCKED)

### 11.1 User Model & Multi-Tenant Isolation
- The database contains a `User` model (`id`, `email`, `name`, `createdAt`, `updatedAt`).
- All persistent resources require a `userId` foreign key with an index.
- Resources with `userId`: Category, Entry, Chunk, EntryManifest, AssetMeta, MaintenanceState, JobLease.
- Base data backfills to one initial seed user (`dev-owner-user`).

### 11.2 Auth Guard Seam
- The application uses a swappable authentication guard in `apps/api/src/auth/guard.ts`.
- In development and test modes, the guard resolves the user from request tokens or defaults to `dev-owner-user`.
- The guard attaches the authenticated `userId` to the Hono request context (`c.get('userId')`).
- Production deployments can swap this seam with an external Identity Provider (IdP) or Cloudflare Access headers.

### 11.3 Database Scoping via Prisma Client Extension
- Database isolation uses Prisma Client Extensions via `forUser(userId)`.
- Base `PrismaClient` remains private to the database module.
- The extension automatically injects `userId` into query filters (`where`) and mutation payloads (`data`).
- Queries use `findFirst` instead of `findUnique` for user-owned records.
- Raw SQL queries (hot paths, atomic chunk saves, searches) accept explicit `userId` parameters and filter strictly.

### 11.4 Storage, Google Drive & Asset Isolation
- Vault assets store inside user-scoped paths: `data/vault/<userId>/...`.
- Asset retrieval routes assert user ownership before returning files or WebP thumbnails.
- Google Drive OAuth tokens store encrypted at rest per user (`data/users/<userId>/google-oauth.enc`).
- Google Drive pack backups upload into dedicated per-user folders.
- The API enforces per-user rate limiting and upload quotas (e.g. 500 MB total assets, 60 requests/minute).

## 12. Performance rules

- Typing must remain instant (<16 ms frame budget). Network saves happen asynchronously in the background.
- Infinite scroll virtualizes rendered blocks when block count exceeds threshold.
- Large documents load initial chunks immediately, then stream remaining chunks.
- Images use lazy loading and WebP thumbnails.

## 13. Accessibility and security

- Complete keyboard navigation for all editor commands and stack interactions.
- Visible focus indicators. Minimum 4.5:1 text contrast.
- Input validation via Zod on both client and server.
- File magic bytes verification prevents malicious file uploads.

## 14. Testing policy (LOCKED)

- **No unit tests.** All verification is Playwright end-to-end tests.
- Pure functions in `doc-model` are covered through e2e workflows and fixture data.
- Required e2e coverage:
  - Create, format, save, and reload entries.
  - Image paste, drop, button insert, resize, and failed upload cleanup.
  - Infinite scroll and chunked storage with very large entries.
  - Sync states and crash recovery simulation.
  - Responsive viewports (390 px, 768 px, 1440 px).
- Tests must pass before completing each step.

## 15. Implementation phases

- **Phase 0: Spike.** (Completed). Runtime and tooling verification.
- **Phase 1: Browsing.** (Completed). Home category collage and book stack.
- **Phase 2: Base Editor.** (Completed). Continuous rich text, autosave, typography.
- **Step 1 (Docs & Audit):** (Current). Update spec to v0.2, create `docs/storage-and-sync.md`, audit repo.
- **Step 2 (Images in Editor):** Asset module, paste/drop/button, magic bytes, EXIF strip, thumbnails, resize handle, e2e tests.
- **Step 3 (Infinite Scroll & Chunks):** Chunk storage, smooth scroll, migration from v2, large entry e2e tests.
- **Step 4 (Sync & Backup):** Local vault integration, Google Drive backup, SSE updates, Yjs merge, crash recovery.
- **Step 5 (OS Wrappers):** Package app for Windows, macOS, iOS, Android.

## 16. Rulebook for the coding agent (Antigravity)

### Workflow

1. Read this spec and repository state before making changes. Reuse existing code.
2. Follow section 16: small modules, no overengineering, e2e tests only, no unit tests.
3. Stop after each step and report. Never start the next step early.
4. Read official docs before assuming library behavior (Tiptap, Hono, Prisma, Playwright, Vite, Yjs, Google Drive API).
5. If a decision marked OPEN blocks progress, ask the user. Do not guess.

### Architecture rules

- Respect module boundaries. `web` and `api` never import each other.
- Design tokens live in `packages/design`.
- All user uploads use the asset module and vault storage.
- Tiptap conversions exist solely within the editor adapter.
- Reuse shared primitives. Do not duplicate components.

### Data safety

- Note preservation is the highest priority.
- Perform backups before schema migrations.
- Failed operations must never corrupt existing documents.

## 17. Resolved Decisions (LOCKED)

1. **Vault Architecture:** OPFS in browser (with IndexedDB fallback). OS application data folder in native wrappers later. Unified `VaultStore` interface.
2. **Google Drive Auth Flow:** User OAuth2 flow with refresh token. Narrow scope (`https://www.googleapis.com/auth/drive.file`). Note on testing mode: Google Cloud projects in "Testing" mode expire refresh tokens after 7 days; project must be switched to "In Production" status.
3. **Backup Policy:** Periodic (every 15 minutes, only if content changed), on entry close, and manual user trigger.
4. **Chunk Size Thresholds:** DEFAULT 50 blocks / 64 KB split boundary. To be tuned in Step 3.

## 18. Custom Context Menu (LOCKED)

### 18.1 Trigger & Interception Rules
- Intercept right-click (`contextmenu`) events inside the editor and page canvas.
- Call `preventDefault()` and open the custom context menu at the cursor coordinates.
- Preserve the native browser context menu when the user presses `Shift + Right-Click`.
- Preserve the native browser context menu inside native `<input>` and `<textarea>` elements.
- On touch devices, open the custom context menu after a 500 ms long-press gesture.

### 18.2 Actions and Capabilities
- **Formatting Actions:** Bold, Italic, Underline, Strike, Code, Highlight.
- **Block Styles:** Heading 1, Heading 2, Heading 3, Bullet List, Ordered List, Blockquote.
- **Alignment:** Align Left, Align Center, Align Right.
- **Font Selection:** Classic Serif (Newsreader), Clean Sans (Inter).
- **Insert & Clipboard:** Insert Link, Insert Image, Cut, Copy, Paste.

### 18.3 Viewport Clamping & Keyboard Navigation
- Clamp menu position within the visible viewport bounds. Prevent overflow past the right or bottom edges.
- Close the menu on pressing `Escape`, clicking outside, or executing any menu action.
- Navigate menu options using the `ArrowUp` and `ArrowDown` keys. Activate selected items with `Enter`.

## 19. Search & Command Palette (LOCKED)

### 19.1 User-Scoped Search Endpoint
- Provide `GET /search?q=...` endpoint on the API.
- Execute full-text search across entry titles, category metadata, and chunk text contents using PostgreSQL `tsvector`.
- Rank title matches highest, category matches second, and body chunk matches third.
- Enforce strict user isolation. Inject `userId` into SQL queries. User B cannot see User A results.
- Exclude soft-deleted entries and categories from search results.

### 19.2 Command Palette Modal (Cmd/Ctrl + K)
- Open the command palette modal with `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux).
- Provide a dedicated search button in top-level navigation bars.
- Display instant matching results as the user types queries.
- Support direct keyboard navigation using `ArrowUp` and `ArrowDown`. Activate selection with `Enter`.
- Close the palette on pressing `Escape` or clicking the backdrop.
- Provide a "New Entry" shortcut inside the palette to create and open a new entry instantly.

## 20. Revision History (LOCKED)

### 20.1 Snapshot Model
- Store immutable historical snapshots in the `EntryRevision` table.
- Record snapshot on each major document save containing version, title, manifest, and document state.
- Scope all revisions strictly to `userId`.

### 20.2 Revision Endpoints
- `GET /entries/:id/revisions`: List historical revisions for the entry, ordered newest to oldest.
- `GET /entries/:id/revisions/:version`: Retrieve historical document preview for inspection.
- `POST /entries/:id/revisions/:version/restore`: Restore the selected revision as the active head version.
- Enforce user isolation. Reject cross-user revision inspection and restore requests with 404 or 403.

### 20.3 Editor Revision History UI
- Provide a "History" trigger button in the entry editor toolbar.
- Open a slide-over revision drawer showing timestamped snapshots.
- Allow users to select a snapshot to preview contents in read-only mode.
- Provide a "Restore this revision" button to commit the restored version.

## 21. Trash & Soft-Delete Lifecycle (LOCKED)

### 21.1 Soft-Delete Window
- Mark deleted entries by setting `deletedAt` timestamp.
- Retain soft-deleted entries for 30 days before automatic purge.
- Exclude soft-deleted entries from standard category listings and search queries.

### 21.2 Trash Endpoints
- `GET /trash`: List soft-deleted entries for the authenticated user with deletion timestamps.
- `POST /entries/:id/restore`: Restore a soft-deleted entry back to its parent category.
- `DELETE /entries/:id/purge`: Permanently purge a single soft-deleted entry and its chunks.
- `POST /trash/purge`: Purge entries older than 30 days or all trash when `all=true` is set.
- Enforce user isolation. Reject cross-user trash operations with status 404 or 403.

### 21.3 Trash Management UI
- Provide a Trash view accessible from the home screen navigation header.
- Display all soft-deleted entries with deleted dates and category indicators.
- Provide "Restore" buttons for individual entries to restore them immediately.
- Provide a "Delete Permanently" button per item and an "Empty Trash" bulk action.
- Show confirmation dialog before permanent deletion.

## 22. Editor Blocks & Outline Navigation (LOCKED)

### 22.1 Rich Editor Blocks
- **Tables**: Support tabular data with `@tiptap/extension-table`, `TableRow`, `TableHeader`, and `TableCell`. Provide commands to insert table, add/remove rows and columns.
- **Task Lists**: Support interactive checkable tasks with `@tiptap/extension-task-list` and `@tiptap/extension-task-item`. Persist checked state.
- **Code Blocks**: Support multi-line formatted code blocks with monospace font styling.
- **Callouts**: Provide custom callout block with custom border, background tint, and icon indicator for notes and warnings.
- **Markdown Shortcuts**: Enable standard input rules for headings (`#`, `##`, `###`), lists (`-`, `1.`), task list (`[ ]`), blockquotes (`>`), bold (`**`), and code blocks (```).

### 22.2 Document Outline Sidebar
- Extract document outline from all active H1, H2, and H3 headings.
- Display outline hierarchy in a floating or docked sidebar panel.
- Allow users to click any outline item to scroll immediately to the corresponding section.
- Provide toggle button in the editor toolbar to open and close the outline sidebar.

## 23. Tags and [[entry]] Backlinks (LOCKED)

### 23.1 Tags Taxonomy
- Organize entries with user-defined tags.
- Tag names are normalized, case-insensitive identifiers.
- Store tags per user with unique constraints on `(userId, name)`.
- Link entries to tags with many-to-many associations in `EntryTag`.
- Return tag listing with entry counts via `GET /tags`.
- Filter entries by tag via `GET /entries?tag=:name`.
- Add tags via `POST /entries/:id/tags` and delete tags via `DELETE /entries/:id/tags/:tagId`.

### 23.2 [[entry]] Backlinks and Wikilinks
- Support bidirectional linking between journal entries using `[[Title]]` or `[[entryId]]` syntax.
- Auto-complete or type wikilinks inside entry content.
- Query incoming backlinks via `GET /entries/:id/backlinks`.
- Backlink queries return referring entries belonging to the authenticated user.
- Enforce strict user isolation on all tag and backlink endpoints. Cross-user requests return 404 or 403.

## 24. Read-Only Share Links (LOCKED)

### 24.1 Link Capabilities
- Generate unique, secure, unguessable access tokens for individual entries.
- Share links provide read-only access to entry snapshots.
- Support optional expiry timestamps.
- Support immediate revocation by the owner.
- Disallow edits, deletions, or category changes via share links.

### 24.2 Endpoints
- `POST /entries/:id/share`: Generate a new share token for an entry.
- `GET /entries/:id/share`: List active share tokens for an entry.
- `DELETE /entries/:id/share/:linkId`: Revoke a share token immediately.
- `GET /shared/:token`: Public unauthenticated endpoint returning read-only entry content.
- Cross-user revocation or inspection attempts return 404 or 403.

## 25. Archive Import and Export Architecture (LOCKED)

### 25.1 ZIP Archive Round Trip
- Export all user categories, entries, chunks, and visual attachments into a structured ZIP archive via `GET /export/zip`.
- The archive contains `manifest.json`, `categories.json`, `entries/<id>.json`, `markdown/<id>.md`, and `attachments/<assetId>.<ext>`.
- Import full archive back via `POST /import/zip`.
- The importer restores categories, entries, and assets under the authenticated `userId`.

### 25.2 Markdown and Obsidian Import/Export
- Export single entries with YAML frontmatter via `GET /entries/:id/export/markdown`.
- Import standard Markdown or Obsidian vaults via `POST /import/markdown`.
- Frontmatter preserves title, tags, creation date, and metadata.
- Body parser converts markdown syntax (headings, task lists, code blocks, wikilinks) into Kaaj blocks.



