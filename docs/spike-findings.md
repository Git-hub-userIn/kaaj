# Spike Findings & Out-of-Scope Items

This document records architectural findings and backlog items identified during the Phase 0 spike to address in subsequent editor phases.

## Deferred Editor Items

1. **Editor Text Scaling & Typography**:
   - Issue: Editor text is currently too small and lacks proportional scaling across viewports.
   - Requirement: Introduce a dedicated type scale with user-adjustable font sizes in Phase 3.

2. **Editor Chrome & Toolbar Clutter**:
   - Issue: Too many manual utility buttons clutter the current viewport.
   - Requirement: Remove manual "Save" and "Reload" controls in favor of pure debounced autosave.
   - Requirement: Provide a minimal floating contextual toolbar. Consolidate "Add layer" behind a single progressive disclosure action.
   - Requirement: Restrict development tools (such as "Test 200 Objects" and "PDF Export") to development builds.

3. **Asset Insertion Affordances**:
   - Issue: Uploads currently require explicit file dialog selection.
   - Requirement: Enable clipboard paste and drag-and-drop ingestion directly onto pages in Phase 3/4.
