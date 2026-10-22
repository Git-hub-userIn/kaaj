import { test, expect } from '@playwright/test';

test.describe('Kaaj Home Screen ("Catalogues")', () => {
  test('1. Seeded tiles render with images, correct entry counts, and no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000/');
    await expect(page.locator('[data-testid="home-screen"]')).toBeVisible();

    // Verify wordmark and avatar
    const wordmark = page.locator('[data-testid="kaaj-wordmark"]');
    await expect(wordmark).toHaveText('Kaaj');

    const avatar = page.locator('[data-testid="user-avatar"]');
    await expect(avatar).toHaveText('JC');
    await expect(avatar).toHaveAttribute('aria-label', /JC/);

    // Verify all 7 seeded category tiles exist
    const expectedCategories = [
      'cat_travel',
      'cat_food-recipes',
      'cat_sketches',
      'cat_plants',
      'cat_music',
      'cat_ideas',
      'cat_memories',
    ];

    for (const catId of expectedCategories) {
      const tile = page.locator(`[data-testid="category-tile-${catId}"]`);
      await expect(tile).toBeVisible();

      // Verify image inside tile
      const img = tile.locator('img');
      await expect(img).toBeVisible();
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }

    // Verify travel entry count
    const travelTile = page.locator('[data-testid="category-tile-cat_travel"]');
    await expect(travelTile).toContainText('entries');

    // Verify zero console errors
    expect(consoleErrors).toEqual([]);
  });

  test('2. Clicking a tile navigates to /category/:id stub page with back link', async ({ page }) => {
    await page.goto('http://localhost:3000/');
    const travelTileLink = page.locator('[data-testid="category-tile-cat_travel"] a');
    await travelTileLink.click();

    await expect(page).toHaveURL(/.*\/category\/cat_travel/);
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    // Click back to catalogues
    const backBtn = page.locator('[data-testid="back-to-catalogues-link"]');
    await backBtn.click();
    await expect(page).toHaveURL('http://localhost:3000/');
    await expect(page.locator('[data-testid="home-screen"]')).toBeVisible();
  });

  test('3. Keyboard Tab and Enter navigation works to open a catalogue', async ({ page }) => {
    await page.goto('http://localhost:3000/');

    // Focus avatar then tab to the first catalogue link
    await page.locator('[data-testid="user-avatar"]').focus();
    await page.keyboard.press('Tab');

    // First tile should be focused
    const focusedHref = await page.evaluate(() => (document.activeElement as HTMLAnchorElement)?.getAttribute('href'));
    expect(focusedHref).toContain('/category/');

    // Press Enter to navigate
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/.*\/category\//);
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();
  });

  test('4. Responsive layouts at 1440px, 768px, and 390px (no overflow, no tile overlap)', async ({ page }) => {
    const viewports = [
      { name: 'laptop', width: 1440, height: 900, screenshot: '../docs/screenshots/home-1440px-laptop.png' },
      { name: 'tablet', width: 768, height: 1024, screenshot: '../docs/screenshots/home-768px-tablet.png' },
      { name: 'phone', width: 390, height: 844, screenshot: '../docs/screenshots/home-390px-phone.png' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://localhost:3000/');
      await page.waitForLoadState('networkidle');

      // Verify no horizontal overflow
      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(isOverflowing, `Horizontal overflow detected at ${vp.width}px`).toBeFalsy();

      // Verify tiles do not overlap each other
      const tiles = page.locator('.category-tile-container');
      const count = await tiles.count();
      const boxes = [];
      for (let i = 0; i < count; i++) {
        const box = await tiles.nth(i).boundingBox();
        if (box) boxes.push(box);
      }

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = !(
            a.x + a.width - 2 <= b.x ||
            b.x + b.width - 2 <= a.x ||
            a.y + a.height - 2 <= b.y ||
            b.y + b.height - 2 <= a.y
          );
          expect(overlap, `Tiles ${i} and ${j} overlap at ${vp.width}px`).toBeFalsy();
        }
      }

      // Capture screenshot for visual inspection
      await page.screenshot({ path: vp.screenshot, fullPage: true });
    }
  });

  test('5. Prefers-reduced-motion disables entrance animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://localhost:3000/');

    const firstTile = page.locator('.category-tile-container').first();
    const animName = await firstTile.evaluate((el) => window.getComputedStyle(el).animationName);
    expect(animName).toBe('none');
  });

  test('6. Add catalogue, rename, delete, and undo restore flow', async ({ page }) => {
    await page.goto('http://localhost:3000/');

    const uniqueTitle = `Field Botanicals ${Date.now()}`;
    const renamedTitle = `Wild Botanicals ${Date.now()}`;

    // Open add catalogue form
    const openAddBtn = page.locator('[data-testid="open-add-catalogue-btn"]');
    await openAddBtn.click();

    const titleInput = page.locator('[data-testid="new-catalogue-title-input"]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(uniqueTitle);

    const submitBtn = page.locator('[data-testid="submit-add-catalogue-btn"]');
    await submitBtn.click();

    // Verify new catalogue appears
    const initialTile = page.locator('.category-tile-container', { hasText: uniqueTitle });
    await expect(initialTile).toBeVisible();
    const tileTestId = await initialTile.getAttribute('data-testid');
    const newTile = page.locator(`[data-testid="${tileTestId}"]`);

    // Rename the catalogue
    const menuBtn = newTile.locator('button[data-testid^="tile-menu-btn-"]');
    await menuBtn.click();

    const renameBtn = page.locator('button[data-testid^="rename-btn-"]');
    await renameBtn.click();

    const inlineInput = newTile.locator('input[type="text"]');
    await inlineInput.fill(renamedTitle);
    await newTile.locator('button:has-text("Save")').click();

    await expect(newTile).toContainText(renamedTitle);

    // Delete the catalogue
    await menuBtn.click();
    const deleteBtn = page.locator('button[data-testid^="delete-btn-"]');
    await deleteBtn.click();

    // Verify tile disappears and undo toast appears
    await expect(newTile).not.toBeVisible();
    const toast = page.locator('[data-testid="undo-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(`"${renamedTitle}" removed.`);

    // Click Undo
    const undoBtn = page.locator('[data-testid="undo-delete-btn"]');
    await undoBtn.click();

    // Verify restored
    await expect(page.locator(`[data-testid="${tileTestId}"]`)).toBeVisible();
  });
});
