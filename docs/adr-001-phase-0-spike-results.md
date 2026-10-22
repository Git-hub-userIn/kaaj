# ADR 001: Phase 0 Spike Results & Architectural Decisions

## Status
Accepted

## Date
2026-10-23

## Context
Section 15 of the Kaaj specification mandates a Phase 0 audit and spike prototype before foundation development.
We must verify tool versions, evaluate sharp on Node and Bun, benchmark 200 freeform objects, and decide the overlay technology.

## 1. Verified Tool Versions

- **Node.js**: v24.21.0 (verified)
- **Bun**: v1.4.4 (installed, configured in PATH, verified as package manager and runtime)
- **Hono**: v4.7.4 (web standard Request/Response architecture, verified multipart upload and body parsing)
- **Tiptap Core**: v2.11.5 (MIT license confirmed, core and starter kit verified inside canvas)
- **sharp**: v0.33.5 (tested and verified on both Node v24 and Bun v1.4)
- **Playwright**: v1.50.1 (headless Chromium browser verified for e2e tests and PDF export)
- **Zod**: v3.24.2 (runtime envelope schema validation in `doc-model`)
- **Zip Library**: `fflate` v0.8.3 selected (pure TypeScript/Wasm, zero native dependencies, isomorphic)

## 2. Overlay Technology Decision

### Decision
We select **SVG / DOM Overlay with CSS Transforms**. We reject Fabric.js.

### Rationale
1. **Accessibility**: SVG and DOM elements remain part of the accessibility tree. Screen readers can announce objects, and elements support keyboard navigation. Fabric.js renders pixels into a flat `<canvas>`, destroying accessibility.
2. **Visual Fidelity**: Text and shapes in DOM/SVG scale vectorially without pixelation.
3. **Performance**: Dragging uses direct ref mutations with `translate3d(x, y, 0) rotate(deg)` without triggering React re-renders. The benchmark confirmed 60 FPS performance with 200 active objects.
4. **Bundle Size**: Fabric.js adds over 300 KB of minified script. SVG/DOM overlay requires zero external dependencies.

## 3. Server Runtime Evaluation

- `sharp` runs on both Node v24.21.0 and Bun v1.4.4.
- Image uploads generate WebP thumbnails (320px and 960px) in identical byte structures on both runtimes.
- Hono runs natively on Bun via `export default { port, fetch }` and on Node via `@hono/node-server`.
- Decision: Use Bun for package management and script execution. Support both Bun and Node runtimes for the API server.

## 4. Phase 0 Exit Verification

All seven Phase 0 verification suites passed in Playwright:
1. API health check returns verified runtime.
2. Canvas renders fixed 3:4 aspect ratio and scales responsively across desktop, tablet, and mobile viewports.
3. Rich text editor allows typing within canvas.
4. Freeform overlay layer supports pointer dragging and transforms.
5. 200 objects drag benchmark operates smoothly at target frame rate.
6. Image upload, sharp WebP thumbnails, save, and reload persistence succeed.
7. PDF export produces valid PDF buffer via headless Chromium.
