# Architecture Reference

This document summarizes core technical decisions and schemas for Kaaj.

## 1. System Topology

```
kaaj/
  apps/
    web/                React + Vite single-page application
    api/                Hono API server running on Node
  packages/
    doc-model/          Shared Zod schemas, migrations, weight() formula
    design/             Static design tokens, fonts, paper textures, icons
  e2e/                  Playwright end-to-end test suite
  docs/                 Product and architectural specifications
  agents/               Agent instructions, rules, and workflows
```

## 2. Canonical Document Model

- **Logical Canvas Units**: 1200 x 1600 (fixed 3:4 portrait aspect ratio).
- **Coordinate Rules**: All stored positions and sizes use logical canvas units. Never store viewport pixels.
- **Layers**: Soft cap of 8 layers and 200 objects per page.
- **Envelope Structure**:
  - `schemaVersion`: Integer tracking document model versions.
  - `pages`: Ordered array of page objects.
  - `page.background`: Background fill or paper texture token.
  - `page.body`: Formatted content in `kaaj-rich-text-v1` format.
  - `page.layers`: Freeform visual overlay layers with ordered objects.
- **Object Types**: `image`, `sticker`, `text`, `line`, `shape`, `tape`.

## 3. Concurrency and Save Protocol

- **Debounced Save**: Save after 1.5 seconds idle or 10 seconds maximum delay.
- **Optimistic Locking**: `PUT /entries/:id` requires `If-Match: <version>` and `X-Lock-Token`.
- **Atomic Persistence**:
  1. Verify version matches database version.
  2. Write canonical document and update `weight`.
  3. Rebuild `EntryAsset` join table rows.
  4. Increment version counter.
- **Edit Lock Lease**:
  - Expiration: 90 seconds.
  - Heartbeat interval: 30 seconds.
  - Takeover mechanism: Invalidates previous lease token immediately.
- **Local Fallback**: Store drafts in IndexedDB during active editing. Delete draft upon server confirmation.

## 4. Asset Pipeline

- **Interface**: `AssetStore` with `put()`, `get()`, `delete()`, `exists()`.
- **Storage**: Local filesystem during local development. S3-compatible store in production.
- **Validation**: Strict magic-byte inspection (JPEG, PNG, WebP, GIF). Max size: 20 MB. Strip EXIF metadata.
- **Thumbnails**: Generate two WebP thumbnails on upload (320px and 960px).
