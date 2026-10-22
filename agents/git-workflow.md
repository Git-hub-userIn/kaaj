# Git Workflow for Kaaj

This document defines the Git branching and commit rules for the Kaaj project.

## 1. Branch Structure

The repository maintains three core branches:

- **`master`**:
  - Contains production-ready code.
  - Apply changes only via fast-forward merges from `main` or release tags.
  - Never commit directly to `master`.

- **`main`**:
  - Serves as the primary integration branch.
  - Reflects the latest verified release candidate.
  - Receive merges from `dev` only when all Playwright end-to-end tests pass.

- **`dev`**:
  - Serves as the active development branch.
  - All day-to-day work, spikes, and phase implementations occur here.
  - Create feature or spike branches from `dev` when needed.

## 2. Working Rules

1. Always verify the active branch before making changes:
   ```bash
   git branch --show-current
   ```
2. Keep the working tree clean.
3. Commit small, logical changes.
4. Merge `dev` into `main` only at the end of each verified phase.
5. Merge `main` into `master` for milestone releases.

## 3. Commit Message Standards

- Use the imperative mood in the subject line (e.g., "Add doc-model Zod schema", not "Added doc-model...").
- Keep the subject line under 50 characters.
- Follow ASD-STE100 principles for commit descriptions.
- Reference the phase or feature directly.
