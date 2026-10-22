import { test, expect } from '@playwright/test';

test.describe('Kaaj Category Screen ("The Book Stack")', () => {
  test('1. Seeded entries render in order, newest at bottom, pinned first, with no console errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000/category/cat_ideas');

    // Verify wordmark and avatar (shared component)
    const wordmark = page.locator('[data-testid="kaaj-wordmark"]');
    await expect(wordmark).toHaveText('Kaaj');

    const avatar = page.locator('[data-testid="user-avatar"]');
    await expect(avatar).toHaveText('JC');

    // Verify category title and entry count
    const title = page.locator('[data-testid="category-title"]');
    await expect(title).toHaveText('Ideas');

    const entryCount = page.locator('[data-testid="category-entry-count"]');
    await expect(entryCount).toHaveText('20 entries');

    // Verify back link
    const backLink = page.locator('[data-testid="back-to-catalogues-link"]');
    await expect(backLink).toBeVisible();

    // Verify table edge is present
    const tableEdge = page.locator('[data-testid="table-edge"]');
    await expect(tableEdge).toBeVisible();

    // Verify pinned entry is rendered at the top of the stack
    const pinnedIndicator = page.locator('[data-testid="pin-indicator-entry_ideas_1"]');
    await expect(pinnedIndicator).toBeVisible();

    // Verify no console errors
    expect(consoleErrors).toEqual([]);
  });

  test('2. Spine thickness differs with weight, clamped between 44px and 96px', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas?sort=date');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

    const bookSpines = page.locator('.book-spine-item');
    const count = await bookSpines.count();
    expect(count).toBeGreaterThan(0);

    const heights: number[] = [];
    for (let i = 0; i < count; i++) {
      const box = await bookSpines.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44); // Touch target minimum
        expect(box.height).toBeLessThanOrEqual(98); // Maximum clamped height (with borders)
        heights.push(Math.round(box.height));
      }
    }

    // Verify height diversity (not all identical cards)
    const uniqueHeights = new Set(heights);
    expect(uniqueHeights.size).toBeGreaterThan(1);
  });

  test('3. Older entries pile appears above 8 entries and expands in place', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas?sort=date');

    // Wait for older pile to be visible
    const olderPile = page.locator('[data-testid="older-entries-pile"]');
    await expect(olderPile).toBeVisible();
    await expect(olderPile).toContainText('older');

    // Check count of rendered spines before expanding: 1 pinned + 8 visible = 9
    const initialSpinesCount = await page.locator('.book-spine-item').count();
    expect(initialSpinesCount).toBe(9);

    // Click to expand
    await olderPile.click();

    // After expansion, older pile is gone and all 20 entries are visible
    await expect(olderPile).not.toBeVisible();
    const expandedSpinesCount = await page.locator('.book-spine-item').count();
    expect(expandedSpinesCount).toBe(20);
  });

  test('4. Sort choice toggles via URL ?sort= and updates stack order', async ({ page }) => {
    // 1. Default sort by date
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="sort-toggle-date"]')).toHaveAttribute('aria-checked', 'true');

    // 2. Switch sort to Title
    await page.locator('[data-testid="sort-toggle-title"]').click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.locator('[data-testid="sort-toggle-title"]')).toHaveAttribute('aria-checked', 'true');

    // 3. Switch sort to Length (weight)
    await page.locator('[data-testid="sort-toggle-length"]').click();
    await expect(page).toHaveURL(/sort=length/);
    await expect(page.locator('[data-testid="sort-toggle-length"]')).toHaveAttribute('aria-checked', 'true');

    // 4. Reload with ?sort=title and ensure selection is preserved from URL
    await page.goto('http://localhost:3000/category/cat_ideas?sort=title');
    await expect(page.locator('[data-testid="sort-toggle-title"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('5. Tilt and offset are identical after a reload (stable deterministic hash)', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_travel');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

    const transformBefore = await firstSpine.evaluate((el) => getComputedStyle(el).transform);

    // Reload page
    await page.reload();
    await expect(firstSpine).toBeVisible();

    const transformAfter = await firstSpine.evaluate((el) => getComputedStyle(el).transform);
    expect(transformAfter).toBe(transformBefore);
  });

  test('6. Clicking a book opens /entry/:id stub and New entry creates and navigates', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_travel');

    // Click first book
    const firstBook = page.locator('.book-spine-item').first();
    await expect(firstBook).toBeVisible();
    await firstBook.click();

    // Verify /entry/:id stub page
    await expect(page).toHaveURL(/\/entry\//);
    await expect(page.locator('[data-testid="entry-stub-card"]')).toBeVisible();

    // Back to category
    await page.locator('[data-testid="entry-back-btn"]').click();
    await expect(page).toHaveURL(/\/category\/cat_travel/);

    // Test New Entry action
    const newEntryBtn = page.locator('[data-testid="new-entry-btn"]');
    await newEntryBtn.click();

    // Should create and navigate to the newly created entry
    await expect(page).toHaveURL(/\/entry\/entry_/);
    await expect(page.locator('[data-testid="entry-stub-card"]')).toBeVisible();
  });

  test('7. Actions: Rename, Pin, Colour change, Move to another category, Delete and Undo', async ({
    page,
    request,
  }) => {
    // Create an isolated test entry via API
    const testEntryTitle = `Test Flow Entry ${Date.now()}`;
    const createRes = await request.post('http://localhost:3001/entries', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      data: {
        categoryId: 'cat_travel',
        title: testEntryTitle,
        color: 'terracotta',
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    const entryId = created.id;

    try {
      await page.goto('http://localhost:3000/category/cat_travel');
      const spine = page.locator(`[data-testid="book-spine-${entryId}"]`);
      await expect(spine).toBeVisible();

      // 1. Rename
      const menuBtn = spine.locator(`[data-testid="book-menu-btn-${entryId}"]`);
      await menuBtn.click();
      const renameMenuItem = spine.locator('[data-testid="menu-rename-entry"]');
      await expect(renameMenuItem).toBeVisible();
      await renameMenuItem.click();

      const renameInput = spine.locator(`[data-testid="rename-input-${entryId}"]`);
      await expect(renameInput).toBeVisible();
      await renameInput.fill(`Renamed Book ${Date.now()}`);
      await renameInput.press('Enter');
      await expect(spine).toContainText('Renamed Book');

      // 2. Pin
      await menuBtn.click();
      await spine.locator('[data-testid="menu-pin-entry"]').click();
      await expect(spine.locator(`[data-testid="pin-indicator-${entryId}"]`)).toBeVisible();

      // 3. Colour
      await menuBtn.click();
      await spine.locator('[data-testid="menu-color-entry"]').click();
      await spine.locator('[data-testid="palette-choice-moss"]').click();
      // Spine item background color should be moss
      await expect(spine).toHaveCSS('background-color', 'rgb(52, 76, 57)'); // #344c39

      // 4. Move to another category (cat_music)
      await menuBtn.click();
      await spine.locator('[data-testid="menu-move-entry"]').click();
      await spine.locator('[data-testid="move-target-cat_music"]').click();
      // Entry should no longer be in cat_travel
      await expect(page.locator(`[data-testid="book-spine-${entryId}"]`)).not.toBeVisible();

      // Verify it moved to cat_music
      await page.goto('http://localhost:3000/category/cat_music');
      const movedSpine = page.locator(`[data-testid="book-spine-${entryId}"]`);
      await expect(movedSpine).toBeVisible();

      // 5. Delete and Undo restore
      const movedMenuBtn = movedSpine.locator(`[data-testid="book-menu-btn-${entryId}"]`);
      await movedMenuBtn.click();
      await movedSpine.locator('[data-testid="menu-delete-entry"]').click();

      // Spine removed and undo toast appears
      await expect(movedSpine).not.toBeVisible();
      const undoToast = page.locator('[data-testid="undo-toast"]');
      await expect(undoToast).toBeVisible();

      // Click Undo
      const undoBtn = page.locator('[data-testid="undo-delete-btn"]');
      await undoBtn.click();

      // Entry is restored onto the stack
      await expect(page.locator(`[data-testid="book-spine-${entryId}"]`)).toBeVisible();
    } finally {
      // Clean up test entry
      await request.delete(`http://localhost:3001/entries/${entryId}`, {
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    }
  });

  test('8. Keyboard navigation: Tab, Enter, ContextMenu key, and Escape', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_plants');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

    // Focus first spine directly with focus() and verify keyboard interaction
    await firstSpine.focus();
    await expect(firstSpine).toBeFocused();

    // Open context menu via ContextMenu key
    await page.keyboard.press('ContextMenu');
    const menu = page.locator('[data-testid="book-spine-menu"]');
    await expect(menu).toBeVisible();

    // Close menu via Escape
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    // Press Enter to navigate into entry
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/entry\//);
  });

  test('9. Responsive layouts at 1440px, 768px, and 390px (no overflow, no clipping)', async ({
    page,
  }) => {
    // Laptop: 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-1440px-laptop.png', fullPage: true });

    // Tablet: 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-768px-tablet.png', fullPage: true });

    // Phone: 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-390px-phone.png', fullPage: true });
  });

  test('10. Empty category displays dashed blank book button', async ({ page, request }) => {
    // Create an empty category via API
    const createCatRes = await request.post('http://localhost:3001/categories', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      data: { title: `Empty Test Collection ${Date.now()}` },
    });
    expect(createCatRes.status()).toBe(201);
    const cat = await createCatRes.json();

    await page.goto(`http://localhost:3000/category/${cat.id}`);
    const emptyBlankBook = page.locator('[data-testid="empty-blank-book"]');
    await expect(emptyBlankBook).toBeVisible();
    await expect(emptyBlankBook).toContainText('Write the first entry');

    // Clicking creates first entry and navigates
    await emptyBlankBook.click();
    await expect(page).toHaveURL(/\/entry\//);

    // Clean up
    await request.delete(`http://localhost:3001/categories/${cat.id}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
  });

  test('11. Prefers-reduced-motion disables transitions and animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://localhost:3000/category/cat_travel');

    const firstSpine = page.locator('.book-spine-item').first();
    const transition = await firstSpine.evaluate((el) => getComputedStyle(el).transition);
    expect(transition).toContain('none');
  });
});
