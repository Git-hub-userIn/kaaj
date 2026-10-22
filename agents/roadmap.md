# Project Roadmap & Phase Tracking

This document tracks progress through the development phases defined in Section 15 of the spec.

## Phase Overview

| Phase | Title | Status | Primary Focus |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Audit and Spike | **IN PROGRESS** | Library verification, editor canvas spike, SVG overlay, asset pipeline test |
| **Phase 1** | Foundations | PENDING | Monorepo setup, `doc-model`, `design`, Prisma schema, auth seam, AssetStore |
| **Phase 2** | Browsing | PENDING | Category collage, messy book stack, CRUD actions, responsive layout |
| **Phase 3** | Base Editor | PENDING | Tiptap integration, adapter, autosave queue, locks, IndexedDB draft |
| **Phase 4** | Layers | PENDING | Freeform overlay, transforms, layer manager, object caps |
| **Phase 5** | Export & Import | PENDING | ZIP archive round trip, Markdown export, PDF rendering via Playwright |
| **Phase 6** | Hardening | PENDING | Performance tuning, failure handling, backup and restore drills |

## Phase 0: Audit & Spike Details

### Goals
1. Audit and record verified versions for core libraries:
   - React 19 / 18, Vite
   - Tiptap Core & extensions (MIT compliance)
   - Hono and Node / Bun compatibility
   - Prisma ORM
   - sharp (image processing & WebP thumbnail generation)
   - Playwright (e2e testing and PDF export)
2. Build minimal spike prototypes:
   - Fixed-ratio 3:4 canvas with responsive CSS scaling.
   - Rich-text body inside the canvas.
   - SVG/DOM transform overlay for 200 objects (60 FPS benchmark).
   - Asset upload pipeline with sharp WebP thumbnails.
   - Playwright headless Chromium PDF capture test.
3. Determine overlay technology:
   - Benchmark SVG/DOM overlay versus Fabric.js.
   - Record architectural decision.

### Exit Criteria
- Text editing, overlay transforms, responsive scaling, persistence, and PDF export work cleanly without architectural dead ends.
