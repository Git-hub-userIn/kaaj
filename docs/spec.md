# Kaaj — Product, Architecture & Agent Spec

Working spec v0.1 · 23 Oct 2026 · Status: design phase. No implementation has started.

## 0. How to read this

Audience: the owner and the coding agent (Antigravity). Section 16 is the agent's rulebook.

Every decision carries a status: **LOCKED** (build it), **DEFAULT** (build it unless the owner changes it), **SPIKE** (decide after the Phase 0 prototype), **OPEN** (needs the owner).

UI mockup of the category screen: https://claude.ai/artifact/SjgixyXDL6XPeYGy1YmizY (static, placeholder colours and fonts).

## 1. Product

**Kaaj** (काज) is a personal visual scrapbook and journal web app. In Hindi, *kaaj* means work or task, and also the buttonhole in tailoring, a craft word. The app should feel like a handmade archive, not a productivity dashboard.

### Principles (LOCKED)

- Writing first, decoration optional. A new entry opens ready to type.
- Visual discovery over folder admin: categories are recognised by imagery.
- Progressive complexity: advanced decoration appears only when the user adds a layer.
- The user owns the content: full export and import in a documented format.
- Responsive by design on phone, tablet and laptop, not a shrunken desktop.
- App-owned document format. Tiptap JSON is never the canonical copy.
- Snappy. Typing, dragging and navigation never wait on the network.
- No unnecessary infrastructure. Single user, inexpensive, maintainable.

### Non-goals for v1

Real-time collaboration, multi-user accounts, automatic pagination, public sharing, a video platform, a full illustration suite, search, offline-first sync.

### Future (design must not block these)

Read-only share links per entry (token to entry, outside the auth guard). Ownership via the auth seam (section 11). Search. Content-anchored annotations.

## 2. Screens and journeys

### 2.1 Home: image-led category collage (LOCKED)

- Categories shown as a collage of varied-size image cards, not identical folder tiles. Name is a small caption.
- Missing cover image: designed placeholder (colour or simple composition), never a broken-image icon.
- Create, rename, delete: discoverable and keyboard-accessible.
- Narrow screens reflow into a usable composition. Never keep desktop coordinates.
- Collage placement: DEFAULT derived from category id and sort order. Persist positions only if a drag-to-arrange feature is added later.

### 2.2 Category: messy stack of books (LOCKED look, details DEFAULT)

- Entries are books lying flat in a messy pile. Title on the left, date on the right of each spine.
- Thickness reflects entry **weight**, clamped between a minimum and maximum. One huge entry must not dominate the screen.
- Newest at the bottom. Sort options: date, title, weight. Pinned entries first.
- Messiness (left offset, tilt up to about 2 degrees, spine colour when unset) is derived from a hash of the entry id. Never stored, never re-randomised on reload. Titles stay horizontal and readable.
- Overflow: DEFAULT show the newest 8, fold older ones into an expandable "older entries" pile. OPEN: internal scroll instead.
- Actions per book: open, rename, move category, set colour, pin, delete. Open on click or tap. Menu via `⋯` button (keyboard), long-press (touch), right-click (desktop).
- Hover or focus nudges the book out sideways. Prefetch the entry on hover or focus.
- Accessibility: the stack is a real list of buttons, tab order follows sort order, aria-label has title and date. The visual mess is CSS only.

### 2.3 Editor (LOCKED)

- A fixed-ratio page (default 3:4 portrait) containing a flowing rich-text body, with optional freeform layers above it.
- Core writing controls are restrained. Everything decorative sits behind **Add layer** or **Decorate**. Contextual controls appear when an object is selected.
- Visible save state: `Saving`, `Saved`, `Couldn't save`. `Saved` only after the server confirms.
- Undo and redo. Reduced-motion respected. Mobile: compact toolbar, bottom sheet for selected-object controls, zoom or scroll instead of shrinking the page until text is unreadable.
- Desktop: side panel for layers and assets.

### 2.4 Journeys the e2e suite must cover

- **A.** Create, rename, delete a category with an optional cover.
- **B.** Create an entry, write, format, insert an image, autosave, leave, reopen, content intact.
- **C.** Add a layer, add objects, move, resize, rotate, reorder, hide, delete, save, reopen, same positions.
- **D.** Same entry at laptop, tablet and phone widths: aspect ratio kept, objects stay put.
- **E.** Export, import into a clean database, verify content and assets, unsupported items reported.

## 3. Decision log

| Topic | Decision | Status |
| --- | --- | --- |
| Name | Kaaj | LOCKED |
| Users | Single user, no user id columns | LOCKED |
| Pages | Explicit pages, no auto-flow between pages | LOCKED |
| Layers | Per page, soft caps 8 layers and 200 objects per page, as validation constants | DEFAULT |
| Concurrency | Version check plus edit-lock lease with fencing token | LOCKED |
| Realtime | No websockets. Debounced HTTP saves | LOCKED |
| Spine size | `weight` stored on the entry row | LOCKED |
| Body schema | Whitelist blocks and marks, palette-token colours | DEFAULT |
| Video | Type reserved, disabled in UI for v1 | DEFAULT |
| Overlay tech | SVG/DOM overlay preferred over Fabric.js | SPIKE |
| Server runtime | Node. Bun as package manager and script runner | DEFAULT |
| Hosting | Deferred until local works well | LOCKED |
| Testing | End-to-end only, no unit tests | LOCKED |

## 4. Tech stack

- **Frontend:** React, Vite, TypeScript, single-page app. Heavy editor code is lazy-loaded.
- **Rich text:** Tiptap core, minimal extensions. Checked on tiptap.dev: the core editor and its open extensions are MIT. Paid features (cloud, collaboration, AI, version history) and subscription-gated Pro extensions are **not used**.
- **Freeform layers:** SVG and DOM overlay with CSS transforms. Fabric.js is the fallback. Decide after the spike.
- **Validation:** Zod schemas shared by web and api, from the `doc-model` package.
- **Backend:** Hono with Zod and Prisma, running on Node. Hono is runtime-agnostic, so moving the API to Bun later is a runtime swap if the spike supports it.
- **Bun:** package manager, script and tool runner. API on Bun only after the spike proves sharp, Prisma and uploads behave.
- **Database:** PostgreSQL. Canonical document in `jsonb`. Prisma migrations.
- **Assets:** S3-style `AssetStore` interface. Local disk implementation in development.
- **Export render:** headless Chromium via Playwright in a separate Node process.
- **Tests:** Playwright e2e.

**Verify from official docs before relying on them** (not yet checked): Hono's current version, multipart and body-size handling, sharp on Bun, a zip library choice, any transform-handle library, Fabric.js version and licence if it is considered.

## 5. Repository layout and module boundaries

Split into a separate package only when two or more consumers share it, or a boundary must be enforced. Everything else is a folder inside an app. Do not create packages speculatively.

```
kaaj/
  apps/
    web/                React UI. No server code, no database access
      src/features/     home, category, editor (richtext/, layers/), export
      src/lib/          api client, save queue, draft store, small helpers
    api/                Hono server
      src/routes/       thin: parse with Zod, call a service, reply
      src/services/     entries, categories, assets, locks, export
      src/stores/       asset-store interface and implementations
      src/auth/         guard seam
  packages/
    doc-model/          Zod schemas, schemaVersion, migrations, weight(). Pure
    design/             design assets and tokens. No logic
  e2e/                  Playwright tests
  docs/                 this spec and any ADRs
```

### Boundary rules (LOCKED)

- `doc-model` is pure TypeScript: no I/O, no React, no framework imports. It depends on Zod only.
- `web` and `api` never import each other. They share only `doc-model` and `design`.
- `design` holds **static design assets and tokens only**: colour and type tokens, spacing and radius scale, fonts, paper textures, icons, the sticker library, placeholder covers, and a manifest that names each asset by key. It contains no components and no business logic.
- Components read colours, fonts and spacing from tokens. No hard-coded hex values or font names in components.
- **User uploads are never design assets.** They go through the `AssetStore`, get database rows, and are referenced by asset id.
- Convert between Tiptap and canonical format in exactly one place: the adapter in `apps/web/src/features/editor/richtext/`. No other code touches Tiptap JSON.
- Shared UI primitives (button, menu, bottom sheet, dialog) live in one folder in `web` and are reused. Do not create a second version of a primitive.
- Routes contain no business logic. Services receive dependencies (database, asset store) as arguments.

## 6. Document model

### 6.1 Page and overflow (LOCKED)

- A document is an ordered list of pages. Each page has a logical size (default 1200 by 1600, ratio 3:4), a background, one `body` and its own `layers`.
- Text does not flow between pages. When a page is full, the editor shows "page full" and offers **Add page**. Nothing is silently clipped.
- The page's content area height is defined in logical units and measured in the editor.
- All stored positions and sizes are in page-relative logical units. Never store screen pixels. The browser scales the page, keeping the ratio. Rotation is in degrees, clockwise.
- Z-order is array order: later items draw on top.

### 6.2 Envelope

```json
{
  "schemaVersion": 1,
  "pages": [
    {
      "id": "p_1",
      "size": { "width": 1200, "height": 1600 },
      "background": { "type": "solid", "token": "paper" },
      "body": { "format": "kaaj-rich-text-v1", "content": [] },
      "layers": [
        {
          "id": "l_1", "name": "Decorations", "visible": true, "locked": false,
          "objects": [
            {
              "id": "o_1", "type": "image", "assetId": "a_1",
              "transform": { "x": 100, "y": 120, "width": 240, "height": 180, "rotation": -4 },
              "anchor": { "type": "page" },
              "style": {}
            }
          ]
        }
      ]
    }
  ]
}
```

### 6.3 Rules

- Every page, layer, object and body block has a stable id.
- Assets are referenced by asset id, never by URL or signed URL.
- `anchor` is `{type:"page"}` in v1. The field is reserved for `{type:"block", id}` so content-anchored annotations need no migration later.
- Object types v1: `image`, `sticker`, `text`, `line` (with arrow option), `shape` (rect, ellipse), `tape`. Freehand `doodle` is OPEN, default v1.1.
- Validation constants (single file in `doc-model`): max layers per page, max objects per page, max pages per entry, max body size.
- Unknown fields and types are preserved on import and migration, reported to the user, never silently dropped.
- Schema changes need a migration function in `doc-model`. No ad hoc rewrites. Migrations are pure functions.

### 6.4 Body schema `kaaj-rich-text-v1` (DEFAULT)

- **Blocks:** `paragraph`, `heading` (levels 1 to 3), `bulletList`, `orderedList`, `blockquote`, `image`, `videoEmbed` (reserved, UI disabled), `divider`.
- **Marks:** `bold`, `italic`, `underline`, `strike`, `link`, `textColor`, `highlight`.
- Colours are palette tokens only. The token list lives in `design`.
- Image block: `assetId`, `alt`, `width` as a fraction (0 to 1) of content width.
- Video: provider plus video id, never raw embed HTML.
- Links: only `http`, `https`, `mailto`.
- Pasted content is sanitised to this whitelist. Anything else is dropped from the pasted text, not stored.

## 7. Data model (PostgreSQL via Prisma)

**Category:** id, title, description?, coverAssetId?, sortOrder, createdAt, updatedAt.

**Entry:** id, categoryId (FK), title, doc (jsonb), schemaVersion, version (int, starts at 1), weight (int), sortOrder?, color? (palette token), pinned (bool), createdAt, updatedAt, lastOpenedAt?, deletedAt? (soft delete, DEFAULT keep 30 days).

**Asset:** id, storageKey (generated, never the user's filename), mime, bytes, width?, height?, originalName?, checksum, createdAt. Thumbnails are derived, not rows.

**EntryAsset:** entryId, assetId. Rebuilt from the document on every save, in the same transaction. Used for safe deletion, orphan cleanup and export.

**EntryLock:** entryId (unique), deviceId, token, expiresAt.

### Rules

- Foreign keys and constraints on. Transactions wherever writes must succeed together.
- Validate every id on the server. Never trust client-provided storage keys or asset metadata.
- **Weight:** one function in `doc-model` from character count, image count and embed count. Clamping happens at render time. If the formula changes, a script recomputes all weights.
- Category list and entry list queries never load `doc`. They return light rows (id, title, weight, updatedAt, color, pinned, sortOrder).
- Delete an asset only if no EntryAsset row references it. Orphan cleanup is a periodic script.

## 8. Saving and concurrency

### 8.1 API (all JSON except uploads and exports)

- `GET/POST /categories`, `PATCH/DELETE /categories/:id`
- `GET /categories/:id/entries` (light rows)
- `POST /entries`, `GET /entries/:id`, `PUT /entries/:id` (save document), `PATCH /entries/:id` (title, category, colour, pin, sortOrder), `DELETE /entries/:id` (soft), `POST /entries/:id/restore`
- `POST /entries/:id/lock`, `POST /entries/:id/lock/heartbeat`, `DELETE /entries/:id/lock`, `POST /entries/:id/lock/takeover`
- `POST /assets` (multipart), `GET /assets/:id`, `GET /assets/:id/thumb?size=`
- `POST /export`, `POST /import` (validate and preview first, then confirm)
- Errors: 409 version conflict, 423 locked by another device, 413 too large, 415 unsupported type, 422 validation.

### 8.2 Save flow (LOCKED)

- The client saves after about 1.5 s idle, with a maximum wait of about 10 s, and flushes on blur, `visibilitychange` and `pagehide` (fetch with `keepalive`).
- One save in flight at a time. Edits made meanwhile coalesce into the next save. Stale responses never overwrite newer local state.
- `PUT /entries/:id` carries `If-Match: <version>` and `X-Lock-Token`. The server runs one atomic update: set doc, weight and EntryAsset rows, increment version, **where version equals the sent version**. Zero rows means 409.
- The UI shows `Saved` only after the server returns the new version.
- Every local change is also written to an IndexedDB draft. The draft is deleted after the server acknowledges. On a failed save or crash, the draft is offered for recovery.
- Drag, resize and draw state stays local. Persist on pointer-up only.
- v1 saves the whole document per request. Switch to per-page saves only if size becomes a measured problem.

### 8.3 Edit lock (LOCKED)

- Opening an entry for editing requests a lock. If another device holds it, the response is 423 and the client opens read-only.
- **Lease:** expires after 90 s, renewed by a heartbeat every 30 s and by each save. A crashed device frees the lock on its own.
- **Take over:** a button issues a new token and invalidates the old holder.
- **Fencing:** every save must carry the current token and version. A device that woke from sleep with an expired lease is rejected, and its draft stays in IndexedDB for manual recovery.
- The lock is for experience. The version check is what guarantees correctness. Keep both.
- A read-only device may poll the entry every few seconds, or use server-sent events later. No websockets.

## 9. Assets and uploads

- Upload flow: select or drop, server validates size and type, stores under a generated key, creates the Asset row, returns the id, the client inserts the id into the document.
- DEFAULT limits: 20 MB per image. Allowed: JPEG, PNG, WebP, GIF. Verify file signatures (magic bytes), not only the declared MIME type. Strip EXIF. User-uploaded SVG is **not allowed in v1** (script risk). Built-in stickers in `design` may be SVG.
- Generate WebP thumbnails (two sizes, DEFAULT 320 and 960 px wide) on upload. Home and stack screens use thumbnails. The editor loads originals only when needed.
- A failed upload never leaves a dangling reference in the document.
- Assets are private. Serve through an authenticated route or short-lived signed URLs. Never store signed URLs in documents.
- The `AssetStore` interface has `put`, `get`, `delete`, `exists`. Implementations: local disk now, S3-compatible later. No other code touches storage directly.
- Backups: the database and the asset files are separate backup jobs. Test restoring both.

## 10. Export and import

- **Full archive (first):** ZIP with `manifest.json` (schema version, export version, counts), `categories/<id>.json`, `entries/<id>.json`, `assets/<assetId>.<ext>`. Stable ids, relative paths, no signed URLs.
- **Import:** validate the archive first, prevent path traversal, handle duplicate ids and missing files, non-destructive by default, show a report of anything unsupported or missing. Never overwrite without explicit confirmation.
- **Markdown (second):** text, headings, lists, links and inline images to `assets/` with relative paths. A companion metadata file records what Markdown cannot hold (layers, rotations, colours). Documented as lossy.
- **HTML and PDF or image (last):** rendered by headless Chromium from the real page, so fonts, layers and rotation match. Wait for fonts and images to load. Report failures, never omit silently. PDF is a rendering, not a backup.
- Required round-trip: export an entry with formatted text, images, several layers and rotated objects, import into an empty database, compare the canonical documents. Only documented normalisations may differ.

## 11. Authentication

- Build an **auth seam**: one guard in `apps/api/src/auth/` that turns a request into `{ subject }`. Nothing else in the app knows how authentication works.
- Local development: the guard accepts a fixed dev token from an environment variable. It is disabled when `NODE_ENV` is production.
- Later: replace the guard internals with Cloudflare Access JWT validation, or generic OIDC (verify signature against the issuer's keys, plus issuer and audience). Per Cloudflare's docs, the origin must validate the `Cf-Access-Jwt-Assertion` header and its `aud` tag, not trust it blindly.
- No ownership columns now. Pass `subject` into services so ownership checks can be added in one place.
- Share links, when added, are a separate read-only route with its own token, outside the guard.
- Do not build login screens or password storage.

## 12. Performance rules (snappy UI)

These are requirements, not suggestions.

- Optimistic UI: local edits apply immediately. Network work is in the background and never blocks typing or dragging.
- Active drag, resize and draw interactions run on refs and CSS `transform`, not React state per pointer move. Commit on pointer-up.
- Move with `transform` and `opacity` only. Use `will-change` only during an interaction. No animating layout properties.
- Re-render narrowly: each layer object is memoised and keyed by id. Selecting one object must not re-render the page. Keep editor state out of top-level React state.
- Code-split the editor and layer renderer. Home and category screens do not load them.
- Images: thumbnails with explicit width and height, lazy loading, originals only in the editor.
- Cache lists with stale-while-revalidate. Prefetch an entry on hover or focus.
- Virtualise lists only if measured slow.
- Initial budgets (tune after the spike): interaction response under 100 ms, home route JavaScript under about 150 KB gzipped, editor lazy chunk loaded on demand, 60 fps while dragging with 200 objects on a mid-range phone.
- Measure first. No caching systems or state libraries without a measured problem.

## 13. Accessibility and security

**Accessibility**

- Every action available by keyboard. Visible focus. Accessible names on icon-only controls. No state conveyed by colour alone. Reduced-motion respected.
- Category collage and entry stack are keyboard navigable.
- Dragging is never the only way to position an object: provide nudge keys or numeric fields.
- Layers are manageable from a list panel even if the page is drawn visually.
- Text contrast 4.5:1 or better. Decorative images have empty alt text. Meaningful ones have descriptions.

**Security**

- Secrets only in server environment variables. Validate all input on the server with Zod.
- Sanitise HTML and pasted content. Restrict upload size and type. Never fetch arbitrary remote URLs server-side (SSRF).
- Validate archive paths on import. Do not log note content, uploads or credentials.
- Back up the database before destructive migrations.

## 14. Testing (end-to-end only)

- **LOCKED:** no unit tests. All verification is Playwright e2e, plus TypeScript type checking, linting and Zod runtime validation.
- Consequence to respect: pure logic in `doc-model` (weight, migrations, validation) has no unit coverage. Keep those functions small and pure, and cover them through e2e flows with seeded fixtures, including a document saved at an older `schemaVersion` that must open and migrate correctly.
- Required e2e suites:
  - Journeys A to E from section 2.4.
  - Save, reload, content intact. Autosave states, including a forced server failure and retry.
  - Two browser contexts: lock (423, read-only), lease expiry, take over, stale save rejected (409).
  - Responsive: phone, tablet, laptop viewports. Aspect ratio held, objects in place.
  - Upload: success, too large, wrong type, failure mid-upload leaves no dangling reference.
  - Export then import round trip on a clean database.
  - Layer limits, page-full behaviour and Add page.
  - Keyboard-only path through the main flows.
- Tests use a dedicated empty database and asset folder per run. A phase is not done until its e2e tests pass.

## 15. Phases

**Phase 0: audit and spike.** Confirm tool versions and read the official docs for each library used. Prototype one rich-text page inside the fixed-ratio page, one layer with transforms, one image through upload, thumbnail and database, reload, one PDF render via Playwright, and 200 objects dragged at target frame rate. Run the same upload and thumbnail path on Node and on Bun. Decide the overlay technology and write down the result. *Exit:* text, overlay, responsive scaling, persistence and export work together with no architectural dead end.

**Phase 1: foundations.** Monorepo, `doc-model` (schema, migrations, weight), `design` tokens, Prisma schema, auth seam with dev token, asset store. *Exit:* create, load, update and delete a category and entry through the API with no data loss, proven by e2e.

**Phase 2: browsing.** Home collage, messy book stack, create, rename, move, delete flows, empty and loading states, responsive layout, keyboard access. *Exit:* categories and entries are findable on phone and laptop.

**Phase 3: base editor.** Tiptap with the whitelist, adapter, inline images, autosave queue, IndexedDB draft, lock and version checks, paste sanitising, pages and page-full behaviour. *Exit:* ordinary multi-page writing works without any layers.

**Phase 4: layers.** Add, rename, reorder, hide layers. Object types, selection, transforms, nudge controls, persistence, caps. *Exit:* layers survive reload and stay positioned at all viewport sizes.

**Phase 5: export and import.** Archive first, then Markdown, then HTML and PDF. *Exit:* round trip verified on a clean database.

**Phase 6: hardening.** Large entries, many assets, failure paths, backup and restore drill, bundle review. Fix what is found. Add no features.

## 16. Rulebook for the coding agent (Antigravity)

### Workflow

1. Read this spec and the repository state before changing anything. Reuse what exists.
2. Work one phase at a time. State goal and scope in a few lines, implement the smallest complete change, run the e2e tests, review your own diff, report.
3. Do not start a later phase early. Do not add features not listed in the current phase.
4. Before relying on how any library, SDK or API behaves (Tiptap, Hono, Prisma, sharp, Playwright, Vite, Bun, Cloudflare), read its official documentation. Do not assume.
5. If a decision marked OPEN blocks safe progress, ask. Otherwise pick the DEFAULT and record the assumption.

### Keep modules separate and reusable

- Follow section 5 exactly. Respect the dependency directions. Do not let `web` import from `api` or the reverse.
- **Design assets live in `packages/design` only**: tokens, fonts, textures, icons, stickers, placeholder covers, manifest. No logic, no components. Components consume tokens. No hard-coded colours or fonts in components.
- User uploads are never mixed with design assets. They use the `AssetStore` and the database.
- Tiptap conversion happens only in the adapter. Storage access happens only through the `AssetStore`. Authentication happens only in the guard.
- Before writing a new component, helper or service, search for an existing one and reuse or extend it. One shared UI primitive per concern.
- Keep features in their own folders. A feature may import shared primitives and `doc-model`, but not another feature's internals.

### Do not overengineer

- First ask whether the code needs to exist at all. Use the platform and installed dependencies before adding anything.
- Prefer plain functions and straightforward code over new abstractions, plugin systems, generic engines, dependency injection containers, or state-management libraries.
- Introduce an interface only where this spec names one (`AssetStore`, the auth guard) or where two real implementations exist.
- Add a dependency only with a written reason. Do not add one because it is popular.
- Do not build features for hypothetical future needs. The future items in section 1 only require that the design stays compatible.
- Do not refactor unrelated code.
- Simplicity never justifies removing validation, error handling, accessibility, security checks or e2e tests.

### Testing

- Write **no unit tests**. Write Playwright e2e tests as defined in section 14. Run them after every meaningful change.
- Do not claim a feature is complete unless its e2e test passes. Never skip a failing test silently.

### Data safety

- Losing a user's notes is the worst possible failure. Saving and reopening content reliably outranks every visual feature.
- Never destructive-migrate without a backup step. Never overwrite on import without confirmation.

### Reporting

End each phase with: what changed, key files, e2e tests run with results including failures, known limitations, dependencies added and why, and any data or backup concern.

### Priority order if trade-offs are forced

1. Safe, reliable saving and reopening.
2. A pleasant, responsive base writing experience.
3. A stable canonical document format.
4. Correct, persistent freeform layers.
5. Full-fidelity export and import.
6. Image-led home and book-stack browsing.
7. Decorative polish.

## 17. Open items

- Category stack overflow: collapsed pile (default) or internal scroll.
- Freehand doodles in v1 or v1.1.
- Trash retention period and whether to expose a trash screen (default soft delete, 30 days).
- Palette token names and values, and the sticker library source (must be licensed or self-made).
- Weight formula constants and the min and max spine thickness.
- Overlay technology (spike result).
- Whether the API moves to Bun after the spike.
- Page default size and content-area margins.
- Future: share links, search, content-anchored annotations, hosting and backup plan, SSO provider.
