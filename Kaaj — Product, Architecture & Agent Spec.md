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
| Hot Writes & Sync | Backend hot writes, SSE notifications to other devices | LOCKED |
| Database | PostgreSQL on Render (metadata, spine weight, hot state) | LOCKED |
| Sync States | State 0: local only, State 1: upload, State 2: editing | LOCKED |
| Document Merging | Yjs CRDT performs merge operations | LOCKED |
| Crash Recovery | Base state from Google Drive + local changes replay | LOCKED |
| Spine Size | `weight` stored in DB, derived from content and stats | LOCKED |
| Fonts | Per-selection fonts and sizes allowed via inline marks | LOCKED |
| Server Runtime | Node and Bun compatible Hono API | DEFAULT |
| Testing | End-to-end only via Playwright. No unit tests | LOCKED |
| PDF Export | Headless Chromium via Playwright | DEFAULT |
| Vault Path | User-configured directory or app data folder | OPEN |
| Drive Auth Flow | OAuth2 user consent vs Service Account | OPEN |

## 4. Tech stack

- **Frontend:** React, Vite, TypeScript, single-page app.
- **Rich text:** Tiptap core with MIT extensions. No paid or Pro extensions.
- **Collaborative Sync & Merge:** Yjs CRDT for document state and chunk merge.
- **Validation:** Zod schemas shared across web and api via `@kaaj/doc-model`.
- **Backend:** Hono running on Node or Bun. Provides REST endpoints and SSE stream.
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
- **State 2: Editing.** Active editing session. Changes stream via Yjs updates. Backend broadcasts updates via Server-Sent Events (SSE).

### 8.3 Concurrency and Yjs merge (LOCKED)

- Yjs CRDT handles document merges across devices and offline reconnection.
- Edit-lock leases are removed. Multiple devices merge concurrent edits deterministically.
- Backend acts as the central relay: receives Yjs update messages and broadcasts via SSE to active clients.

### 8.4 Crash recovery (LOCKED)

- If a client or backend crashes, restore the document from the Google Drive base state plus local changes.
- Local IndexedDB drafts and vault journal replay uncommitted edits onto the base state.
- Data loss must not occur.

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

## 11. Authentication (LOCKED)

- Single-user application.
- Auth seam: single guard in `apps/api/src/auth/` validating request tokens.
- Development uses `AUTH_TOKEN` from environment variables.
- Production uses secure token or Cloudflare Access header validation.
- Do not build multi-user tables or login credential systems.

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

## 17. Open items

1. **Local Vault Location:** Default path for local vault on desktop and mobile platforms.
2. **Google Drive Authentication Flow:** OAuth2 user login with refresh tokens versus automated service account.
3. **Chunk Threshold:** Exact boundary for splitting chunks (50 blocks vs 100 blocks, or byte threshold).
4. **Drive Backup Frequency:** Trigger backup on every save, on sync state change, or on timer (e.g. every 15 minutes).
