import { test, expect } from '@playwright/test';

test.describe('Category Screen Layout, Gutters, Rails, and Floating Details Card', () => {
  const viewports = [1440, 1280, 1100, 768, 390];

  for (const width of viewports) {
    test(`1. Viewport ${width}px: hover and focus book at far edges, no clipping, no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://localhost:3000/category/cat_ideas');
      await page.waitForSelector('.book-spine-item');

      // Check document has no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

      const spines = page.locator('.book-spine-item');
      const count = await spines.count();
      expect(count).toBeGreaterThan(0);

      if (width >= 1280) {
        // Sticky right rail exists in right gutter
        const rightRail = page.locator('[data-testid="category-right-rail"]');
        await expect(rightRail).toBeVisible();
        const railBox = await rightRail.boundingBox();
        expect(railBox).not.toBeNull();
        if (railBox) {
          expect(railBox.x).toBeGreaterThanOrEqual(0);
          expect(railBox.x + railBox.width).toBeLessThanOrEqual(width + 1);
        }
      }

      // Test hover on first book
      const firstSpine = spines.first();
      await firstSpine.hover();
      await page.waitForTimeout(350);

      // Floating details card exists in top layer portal at pointer + (16,16) px
      const tooltip = page.locator('[role="tooltip"]').first();
      await expect(tooltip).toBeVisible();
      const tooltipBox = await tooltip.boundingBox();
      expect(tooltipBox).not.toBeNull();
      if (tooltipBox) {
        expect(tooltipBox.x).toBeGreaterThanOrEqual(10);
        expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(width - 10);
      }

      // Check document still has no horizontal overflow after hover
      const postHoverScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(postHoverScrollW).toBeLessThanOrEqual(clientWidth + 1);

      // Test keyboard focus
      await firstSpine.focus();
      await page.waitForTimeout(100);

      const postFocusScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(postFocusScrollW).toBeLessThanOrEqual(clientWidth + 1);
    });
  }

  test('2. Right rail components: Polaroid cover, category details with 6-month bar strip, and checklist note', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    const rightRail = page.locator('[data-testid="category-right-rail"]');
    await expect(rightRail).toBeVisible();

    // 1. Category image: Polaroid cover with "Change cover" action
    const polaroid = rightRail.locator('[data-testid="category-polaroid-cover"]');
    await expect(polaroid).toBeVisible();
    const changeCoverBtn = rightRail.locator('[data-testid="change-cover-btn"]');
    await expect(changeCoverBtn).toBeVisible();

    // Open change cover modal
    await changeCoverBtn.click();
    const coverModal = page.locator('[data-testid="cover-picker-modal"]');
    await expect(coverModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(coverModal).not.toBeVisible();

    // 2. Category details panel
    const statsPanel = rightRail.locator('[data-testid="category-stats-panel"]');
    await expect(statsPanel).toBeVisible();
    await expect(statsPanel.locator('[data-testid="stats-entry-count"]')).toHaveText('60');
    await expect(statsPanel.locator('[data-testid="stats-word-count"]')).not.toBeEmpty();
    await expect(statsPanel.locator('[data-testid="stats-created"]')).not.toBeEmpty();
    await expect(statsPanel.locator('[data-testid="stats-last-edited"]')).not.toBeEmpty();

    // 6-month bar strip and visually hidden text table fallback
    const barStrip = statsPanel.locator('[data-testid="entries-bar-strip"]');
    await expect(barStrip).toBeVisible();
    const tableFallback = statsPanel.locator('[data-testid="entries-table-fallback"]');
    await expect(tableFallback).toBeAttached();

    // 3. Sticky note checklist
    const sticky = rightRail.locator('[data-testid="category-checklist-sticky"]');
    await expect(sticky).toBeVisible();

    const addInput = sticky.locator('[data-testid="add-todo-input"]');
    await expect(addInput).toBeVisible();

    // Add note
    const noteText = `Test Note ${Date.now()}`;
    await addInput.fill(noteText);
    await addInput.press('Enter');
    await page.waitForTimeout(500);

    // Verify added note appears in checklist
    const noteInput = sticky.locator(`input[value="${noteText}"]`);
    await expect(noteInput).toBeVisible();

    // Delete note
    const deleteBtn = sticky.locator('button[aria-label="Delete item"]').last();
    await deleteBtn.click();
    await page.waitForTimeout(500);
    await expect(noteInput).not.toBeVisible();
  });

  test('3. Spacing: >= 48px header divider to first book, >= 64px last table strip to bottom, props visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    // Header divider to first book
    const header = page.locator('header').first();
    const headerBox = await header.boundingBox();
    const firstBook = page.locator('.book-spine-item').first();
    const firstBookBox = await firstBook.boundingBox();

    expect(headerBox).not.toBeNull();
    expect(firstBookBox).not.toBeNull();
    if (headerBox && firstBookBox) {
      const distance = firstBookBox.y - (headerBox.y + headerBox.height);
      expect(distance).toBeGreaterThanOrEqual(48);
    }

    // Last table strip to page bottom
    const lastStrip = page.locator('[data-testid^="table-strip-"]').last();
    const lastStripBox = await lastStrip.boundingBox();
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    expect(lastStripBox).not.toBeNull();
    if (lastStripBox) {
      const bottomDistance = scrollHeight - (lastStripBox.y + lastStripBox.height);
      expect(bottomDistance).toBeGreaterThanOrEqual(64);
    }

    // Verify pinned ribbon is fully visible
    const ribbon = page.locator('[data-testid="pinned-ribbon-entry_ideas_1"]');
    await expect(ribbon).toBeVisible();

    // Verify sticky flag is fully visible
    const flags = page.locator('[data-testid^="sticky-flag-"]');
    const flagCount = await flags.count();
    expect(flagCount).toBeGreaterThan(0);
    await expect(flags.first()).toBeVisible();
  });

  test('4. "Jump to" scrolls to pile, highlight follows, and focus lands on pile heading', async ({
    page,
  }) => {
    // Test wide screen (>= 1280px) Left Rail
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    const leftRail = page.locator('[data-testid="category-left-rail"]');
    await expect(leftRail).toBeVisible();

    const jumpBtn1 = page.locator('[data-testid="jump-to-pile-1"]');
    await expect(jumpBtn1).toBeVisible();
    await jumpBtn1.click();
    await page.waitForTimeout(600);

    // Focus lands on pile heading 1
    const pileHeading1 = page.locator('[data-testid="pile-heading-1"]');
    await expect(pileHeading1).toBeFocused();

    // Active highlight reflects selected pile
    await expect(jumpBtn1).toHaveAttribute('aria-current', 'true');

    // Test compact Jump to menu at 1100px (1024 - 1279px)
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.reload();
    await page.waitForSelector('.book-spine-item');

    // Left rail not visible in sidebar
    await expect(leftRail).not.toBeVisible();

    // Compact Jump to button exists next to sort control
    const compactBtn = page.locator('[data-testid="compact-jump-to-btn"]');
    await expect(compactBtn).toBeVisible();
    await compactBtn.click();

    const compactDropdown = page.locator('[data-testid="compact-jump-to-dropdown"]');
    await expect(compactDropdown).toBeVisible();

    const compactOption2 = page.locator('[data-testid="compact-jump-pile-2"]');
    await expect(compactOption2).toBeVisible();
    await compactOption2.click();
    await page.waitForTimeout(600);

    const pileHeading2 = page.locator('[data-testid="pile-heading-2"]');
    await expect(pileHeading2).toBeFocused();
  });

  test('5. Responsive collapsible "About this catalogue" section at 1100px and 390px', async ({
    page,
  }) => {
    // 1100px: section is expanded by default
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    const collapsible = page.locator('[data-testid="about-catalogue-collapsible"]');
    await expect(collapsible).toBeVisible();

    // Section is expanded on tablet
    const polaroid = collapsible.locator('[data-testid="category-polaroid-cover"]');
    await expect(polaroid).toBeVisible();

    // 390px: collapsed by default on phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector('.book-spine-item');

    const phoneCollapsible = page.locator('[data-testid="about-catalogue-collapsible"]');
    await expect(phoneCollapsible).toBeVisible();

    const toggleBtn = phoneCollapsible.locator('[data-testid="toggle-about-catalogue-btn"]');
    await expect(toggleBtn).toBeVisible();

    // Click toggle expands section
    await toggleBtn.click();
    await expect(phoneCollapsible.locator('[data-testid="category-polaroid-cover"]')).toBeVisible();
  });

  test('6. Escape dismisses floating card; reduced-motion uses instant scroll', async ({
    page,
  }) => {
    // Test Escape dismissal at 1100px
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    const firstSpine = page.locator('.book-spine-item').first();
    await firstSpine.hover();
    await page.waitForTimeout(350);

    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(tooltip).not.toBeVisible();

    // Test reduced-motion instant scroll
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.waitForSelector('.book-spine-item');

    const jumpBtn2 = page.locator('[data-testid="jump-to-pile-2"]');
    await jumpBtn2.click();
    // Instant scroll happens without delay
    const pileHeading2 = page.locator('[data-testid="pile-heading-2"]');
    await expect(pileHeading2).toBeFocused();
  });

  test('7. Phone/touch: tap opens entry, long-press opens menu with details in header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await page.waitForSelector('.book-spine-item');

    const firstSpine = page.locator('.book-spine-item').first();

    // Trigger long-press (> 500ms)
    await firstSpine.dispatchEvent('touchstart');
    await page.waitForTimeout(550);
    await firstSpine.dispatchEvent('touchend');

    // Menu opens
    const menu = page.locator('[data-testid="book-spine-menu"]');
    await expect(menu).toBeVisible();

    // Details appear in menu header
    const menuHeader = page.locator('[data-testid="menu-details-header"]');
    await expect(menuHeader).toBeVisible();
    await expect(menuHeader.locator('[data-testid="menu-details-title"]')).toBeVisible();
    await expect(menuHeader.locator('[data-testid="menu-details-last-edited"]')).toBeVisible();
    await expect(menuHeader.locator('[data-testid="menu-details-created"]')).toBeVisible();
    await expect(menuHeader.locator('[data-testid="menu-details-stats"]')).toBeVisible();

    // Dismiss menu
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    // Tap opens entry
    await firstSpine.click();
    await expect(page).toHaveURL(/\/entry\//);
  });
});
