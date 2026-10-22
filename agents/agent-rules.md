# Agent Rules and Standards

This document defines the operating rules for coding agents working on Kaaj.
These rules enforce Section 16 of the [spec](file:///E:/personal-projects/kaaj/docs/spec.md) and project communication standards.

## 1. Phased Execution

1. Work strictly one phase at a time.
2. Read the current phase requirements before writing code.
3. State the goal and scope in a few lines before each change.
4. Do not start a later phase early.
5. Do not add features outside the current phase scope.
6. Verify phase completion against the exit criteria.

## 2. ASD-STE100 Communication Rules (80% Capacity)

Apply ASD-STE100 (Simplified Technical English) rules in all messages, docs, and code comments:

1. **Short, Direct Sentences**:
   - Keep sentences under 25 words.
   - Express one instruction or concept per sentence.
2. **Active Voice & Imperative Mood**:
   - Use active voice.
   - Use imperative verbs for steps ("Run", "Configure", "Verify", "Build").
3. **Clarity & Consistent Terms**:
   - Use identical terms for the same concept.
   - Avoid ambiguous pronouns (`it`, `this`, `that`).
   - Limit noun clusters to three nouns maximum.
4. **Simple Verb Forms**:
   - Use simple present, past, and future tenses.
   - Avoid progressive and passive forms.
5. **Software Engineering Terms**:
   - Use standard developer terms and API names for clarity.

## 3. Architecture & Boundary Rules

1. **Package Boundaries**:
   - `packages/doc-model`: Pure TypeScript with Zod only. No I/O, no framework imports.
   - `packages/design`: Static assets, tokens, fonts, and textures only. No components or logic.
   - `apps/web` and `apps/api` must never import each other.
2. **Component Rules**:
   - UI components read tokens from `packages/design`.
   - Never hardcode hex colors or font families in components.
   - Store shared UI primitives in a single directory in `apps/web`.
   - Never duplicate a shared primitive.
3. **Format Adapters**:
   - Convert Tiptap JSON to the canonical document format only in `apps/web/src/features/editor/richtext/`.
   - No other code interacts with Tiptap JSON.
4. **Asset Isolation**:
   - User uploads are never design assets.
   - Manage uploads strictly through the `AssetStore` and database.
5. **Auth Seam**:
   - Process authentication solely inside the auth guard seam in `apps/api/src/auth/`.
   - Pass the authenticated `subject` into services.

## 4. Documentation Verification

1. Read official documentation before using any third-party library.
2. Never assume library APIs or behaviors for Tiptap, Hono, Prisma, sharp, or Playwright.
3. Record confirmed library versions and notes in Phase 0 audit records.

## 5. Testing Policy

1. Write **no unit tests**.
2. Perform all testing through Playwright end-to-end tests.
3. Enforce TypeScript strict mode and Zod runtime schema validation.
4. Run the end-to-end test suite after every meaningful change.
5. Never mark a phase complete if any test fails.

## 6. Data Safety

1. Prioritize document saving and reopening integrity over visual features.
2. Never perform destructive migrations without an explicit database backup.
3. Prevent data loss on import through duplicate checks and preview confirmations.

## 7. Trade-off Priority Order

1. Safe, reliable saving and reopening.
2. Responsive base writing experience.
3. Stable canonical document format.
4. Correct, persistent freeform layers.
5. Full-fidelity export and import.
6. Image-led browsing screens.
7. Decorative polish.
