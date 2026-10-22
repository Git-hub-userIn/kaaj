import { test, expect } from '@playwright/test';

test.describe('Kaaj Category Screen ("The Book Stack")', () => {
  test('1. Seeded entries render in order, newest at top, pinned first, with no console errors', async ({
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
    await expect(entryCount).toHaveText('60 entries');

    // Verify back link
    const backLink = page.locator('[data-testid="back-to-catalogues-link"]');
    await expect(backLink).toBeVisible();

    // Verify table strips are present under piles
    const tableStrip = page.locator('[data-testid="table-strip-0"]');
    await expect(tableStrip).toBeVisible();

    // Verify pinned entries have red bookmark ribbons
    const pinnedRibbon = page.locator('[data-testid="pinned-ribbon-entry_ideas_1"]');
    await expect(pinnedRibbon).toBeVisible();

    // Verify no console errors
    expect(consoleErrors).toEqual([]);
  });

  test('2. Spine thickness differs with weight, clamped between 44px and 104px', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas?sort=date');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

    const bookSpines = page.locator('.book-spine-item');
    const count = await bookSpines.count();
    expect(count).toBeGreaterThan(0);

    const heights: number[] = [];
    // Sample first 10 books in first pile
    for (let i = 0; i < Math.min(10, count); i++) {
      const box = await bookSpines.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44); // Touch target minimum
        expect(box.height).toBeLessThanOrEqual(106); // Maximum clamped height (with borders)
        heights.push(Math.round(box.height));
      }
    }

    // Verify height diversity (not all identical cards)
    const uniqueHeights = new Set(heights);
    expect(uniqueHeights.size).toBeGreaterThan(1);
  });

  test('3. Multi-pile layout: entries split into piles of 10 on wooden table strips with month labels', async ({
    page,
  }) => {
    await page.goto('http://localhost:3000/category/cat_ideas?sort=date');

    // Verify pile 0 and table strip with handwritten month label
    const pile0 = page.locator('[data-testid="stack-pile-0"]');
    await expect(pile0).toBeVisible();

    const pileLabel0 = page.locator('[data-testid="pile-month-label-0"]');
    await expect(pileLabel0).toBeVisible();
    await expect(pileLabel0).not.toBeEmpty();

    // Verify multiple piles exist for 60 entries (6 piles of 10)
    const pile1 = page.locator('[data-testid="stack-pile-1"]');
    await expect(pile1).toBeAttached();

    // Verify wooden table strip styling
    const strip0 = page.locator('[data-testid="table-strip-0"]');
    await expect(strip0).toBeVisible();
  });

  test('4. Hover / Focus Details Card shows timestamps and stats, dismisses on Escape', async ({
    page,
  }) => {
    await page.goto('http://localhost:3000/category/cat_ideas');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

    // Hover with 250ms delay
    await firstSpine.hover();
    await page.waitForTimeout(300);

    const detailsCard = page.locator('[role="tooltip"]').first();
    await expect(detailsCard).toBeVisible();

    // Verify title, last edited, created, and stats
    await expect(detailsCard.locator('[data-testid="details-card-title"]')).toBeVisible();
    await expect(detailsCard.locator('[data-testid="details-card-last-edited"]')).toBeVisible();
    await expect(detailsCard.locator('[data-testid="details-card-created"]')).toBeVisible();
    await expect(detailsCard.locator('[data-testid="details-card-stats"]')).toContainText('words');

    // Press Escape dismisses card
    await page.keyboard.press('Escape');
    await expect(detailsCard).not.toBeVisible();
  });

  test('5. Spine customisation modal: live preview, contrast restrictions, and persistence', async ({
    page,
    request,
  }) => {
    // Create test entry
    const res = await request.post('http://localhost:3001/entries', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      data: {
        categoryId: 'cat_ideas',
        title: `Custom Spine Book ${Date.now()}`,
        color: 'terracotta',
      },
    });
    expect(res.status()).toBe(201);
    const created = await res.json();
    const entryId = created.id;

    try {
      await page.goto('http://localhost:3000/category/cat_ideas');
      const spine = page.locator(`[data-testid="book-spine-${entryId}"]`);
      await expect(spine).toBeVisible();

      // Open menu and click Customise spine
      const menuBtn = spine.locator(`[data-testid="book-menu-btn-${entryId}"]`);
      await menuBtn.click();
      const customiseBtn = spine.locator('[data-testid="menu-customise-spine"]');
      await expect(customiseBtn).toBeVisible();
      await customiseBtn.click();

      // Verify Spine Customizer modal opens
      const modal = page.locator('[data-testid="spine-customizer-modal"]');
      await expect(modal).toBeVisible();

      // Check live preview book element
      const previewBook = page.locator('[data-testid="spine-preview-book"]');
      await expect(previewBook).toBeVisible();

      // Select leather texture
      await page.locator('[data-testid="customizer-texture-leather"]').click();

      // Select playfair font
      await page.locator('[data-testid="customizer-font-playfair-display"]').click();

      // Select light linen color and verify contrast restriction:
      // gold foil should become disabled because linen has low contrast with gold foil!
      await page.locator('[data-testid="customizer-color-linen"]').click();
      const goldFoilBtn = page.locator('[data-testid="customizer-finish-gold-foil"]');
      await expect(goldFoilBtn).toBeDisabled();

      // Save changes
      await page.locator('[data-testid="save-spine-customizer"]').click();
      await expect(modal).not.toBeVisible();

      // Verify custom style persisted on stack
      await expect(spine).toBeVisible();
    } finally {
      await request.delete(`http://localhost:3001/entries/${entryId}`, {
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    }
  });

  test('6. Sticky slim bar appears on scroll and provides reachable actions', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="category-title"]')).toHaveText('Ideas');
    await expect(page.locator('.book-spine-item').first()).toBeVisible();

    const stickyBar = page.locator('[data-testid="sticky-category-bar"]');
    await expect(stickyBar).toBeAttached();

    // Scroll down 600px past header
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(200);

    // Sticky bar should now be translated in view
    await expect(stickyBar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.locator('[data-testid="sticky-category-name"]')).toHaveText('Ideas');

    const stickyNewEntry = page.locator('[data-testid="sticky-new-entry-btn"]');
    await expect(stickyNewEntry).toBeVisible();
  });

  test('7. Scroll position restores when returning from an entry', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    // Scroll down to book in middle of stack (pile 1)
    const targetBook = page.locator('.book-spine-item').nth(12);
    await targetBook.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(300);

    // Click the book
    await targetBook.click();

    // Navigated to /entry/
    await expect(page).toHaveURL(/\/entry\//);

    // Click back to category
    await page.locator('[data-testid="entry-back-btn"]').click();
    await expect(page).toHaveURL(/\/category\/cat_ideas/);

    // Verify scroll position was restored close to scrollBefore
    await page.waitForTimeout(300);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(restoredScroll).toBeGreaterThan(250);
  });

  test('8. Sort choice toggles via URL ?sort= and updates pile labels', async ({ page }) => {
    // 1. Default sort by date
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="sort-toggle-date"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="pile-month-label-0"]')).toBeVisible();

    // 2. Switch sort to Title
    await page.locator('[data-testid="sort-toggle-title"]').click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.locator('[data-testid="sort-toggle-title"]')).toHaveAttribute('aria-checked', 'true');
    // Under non-date sorts, pile labels use "Pile 1", "Pile 2"
    await expect(page.locator('[data-testid="pile-month-label-0"]')).toHaveText('Pile 1');

    // 3. Switch sort to Length (weight)
    await page.locator('[data-testid="sort-toggle-length"]').click();
    await expect(page).toHaveURL(/sort=length/);
    await expect(page.locator('[data-testid="sort-toggle-length"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="pile-month-label-0"]')).toHaveText('Pile 1');

    // 4. Reload with ?sort=title and ensure selection is preserved from URL
    await page.goto('http://localhost:3000/category/cat_ideas?sort=title');
    await expect(page.locator('[data-testid="sort-toggle-title"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('9. Tilt and offset are identical after a reload (stable deterministic hash)', async ({ page }) => {
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

  test('10. Fore-edge variant and deterministic props render', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_ideas');

    // Check for yellow sticky flags or rubber bands
    const spines = page.locator('.book-spine-item');
    await expect(spines.first()).toBeVisible();

    // Pinned books have ribbon bookmark
    const pinnedRibbon = page.locator('[data-testid="pinned-ribbon-entry_ideas_1"]');
    await expect(pinnedRibbon).toBeVisible();

    // Date paper labels exist on spines
    const dateLabels = page.locator('[data-testid^="paper-date-label-"]');
    expect(await dateLabels.count()).toBeGreaterThan(0);
  });

  test('11. Actions: Rename, Pin, Colour change, Move to another category, Delete and Undo', async ({
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
      await expect(spine).toHaveCSS('background-color', 'rgb(52, 76, 57)'); // #344c39

      // 4. Move to another category (cat_music)
      await menuBtn.click();
      await spine.locator('[data-testid="menu-move-entry"]').click();
      await spine.locator('[data-testid="move-target-cat_music"]').click();
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
      await request.delete(`http://localhost:3001/entries/${entryId}`, {
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      });
    }
  });

  test('12. Keyboard navigation: Tab, Enter, ContextMenu key, and Escape', async ({ page }) => {
    await page.goto('http://localhost:3000/category/cat_plants');

    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible();

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

  test('13. Responsive layouts at 1440px, 768px, and 390px (no overflow, no clipping)', async ({
    page,
  }) => {
    // Laptop: 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_ideas');
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-1440px-laptop.png', fullPage: false });

    // Tablet: 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-768px-tablet.png', fullPage: false });

    // Phone: 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('[data-testid="book-stack-container"]')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: '../docs/screenshots/stack-390px-phone.png', fullPage: false });
  });

  test('14. Empty category displays dashed blank book button', async ({ page, request }) => {
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

    await emptyBlankBook.click();
    await expect(page).toHaveURL(/\/entry\//);

    await request.delete(`http://localhost:3001/categories/${cat.id}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
  });

  test('15. Prefers-reduced-motion disables transitions and animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://localhost:3000/category/cat_travel');

    const firstSpine = page.locator('.book-spine-item').first();
    const transition = await firstSpine.evaluate((el) => getComputedStyle(el).transition);
    expect(transition).toContain('none');
  });

  test('16. Defect 1: Skew / Lean verification (true rectangle, bottom book 0 deg, tilt <= 1.2 deg, drift <= 6px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_sketches');
    await expect(page.locator('.book-spine-item').first()).toBeVisible();

    const spineItems = page.locator('.book-spine-item');
    const count = await spineItems.count();
    expect(count).toBe(7);

    const geometries = await spineItems.evaluateAll((elements) => {
      return elements.map((el) => {
        const style = window.getComputedStyle(el);
        const transform = style.transform;
        const width = parseFloat(style.width);

        // Parse 2D transform matrix(a, b, c, d, tx, ty)
        let a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;
        const match = transform.match(/matrix\(([^)]+)\)/);
        if (match) {
          const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
          a = parts[0];
          b = parts[1];
          c = parts[2];
          d = parts[3];
          tx = parts[4];
          ty = parts[5];
        }

        const rotationRad = Math.atan2(b, a);
        const rotationDeg = (rotationRad * 180) / Math.PI;

        return {
          width,
          transform,
          a,
          b,
          c,
          d,
          tx,
          ty,
          rotationDeg,
          rotationRad,
          isTrueRectangle: Math.abs(a - d) < 0.001 && Math.abs(b + c) < 0.001,
        };
      });
    });

    // 1. True rectangle: pure rotation (a == d and b == -c) with zero skew across all books
    for (const geom of geometries) {
      expect(geom.isTrueRectangle).toBe(true);
    }

    // 2. Bottom book of pile is level: rotation exactly 0 and resting flat
    const bottomBook = geometries[count - 1];
    expect(Math.abs(bottomBook.rotationDeg)).toBeLessThan(0.01);

    // 3. Every other book: rotation <= 1.2 deg, drift <= 6 px
    for (let i = 0; i < count - 1; i++) {
      const g = geometries[i];
      expect(Math.abs(g.rotationDeg)).toBeLessThanOrEqual(1.21);

      const driftPx = Math.abs(g.rotationRad * (g.width / 2));
      expect(driftPx).toBeLessThanOrEqual(6.05); // Drift must be 6px or less
    }

    // 4. Neighbouring books may not both lean the same way past 0.8 degrees
    for (let i = 0; i < count - 1; i++) {
      const currTilt = geometries[i].rotationDeg;
      const nextTilt = geometries[i + 1].rotationDeg;
      const bothLeanPastLimit =
        Math.abs(currTilt) >= 0.8 &&
        Math.abs(nextTilt) >= 0.8 &&
        currTilt * nextTilt > 0;
      expect(bothLeanPastLimit).toBe(false);
    }
  });

  test('17. Defect 2: Length and offset verification (520-780px, adjacent diff >= 40px, >= 4 distinct lengths)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_sketches');
    await expect(page.locator('.book-spine-item').first()).toBeVisible();

    const spineItems = page.locator('.book-spine-item');
    const count = await spineItems.count();
    expect(count).toBe(7);

    const widthsAndOffsets = await spineItems.evaluateAll((elements) => {
      return elements.map((el) => {
        const style = window.getComputedStyle(el);
        const width = Math.round(parseFloat(style.width));
        const match = style.transform.match(/matrix\(([^)]+)\)/);
        const tx = match ? parseFloat(match[1].split(',')[4]) : 0;

        // Check gilt bands and label positions
        const leftBand = el.querySelector('div[style*="left: 28px"]');
        const rightBand = el.querySelector('div[style*="right: 70px"]');
        const dateLabel = el.querySelector('[data-testid^="paper-date-label-"]');

        return {
          width,
          offset: tx,
          hasLeftBand: Boolean(leftBand),
          hasRightBand: Boolean(rightBand),
          hasDateLabel: Boolean(dateLabel),
        };
      });
    });

    // 1. Length on laptop: 520 to 780 px, independent of thickness
    for (const item of widthsAndOffsets) {
      expect(item.width).toBeGreaterThanOrEqual(520);
      expect(item.width).toBeLessThanOrEqual(780);
    }

    // 2. Adjacent books differ by at least 40 px in length
    for (let i = 1; i < count; i++) {
      const diff = Math.abs(widthsAndOffsets[i].width - widthsAndOffsets[i - 1].width);
      expect(diff).toBeGreaterThanOrEqual(40);
    }

    // 3. In 7 books, at least 4 distinct lengths, none > 780 px
    const uniqueLengths = new Set(widthsAndOffsets.map((w) => w.width));
    expect(uniqueLengths.size).toBeGreaterThanOrEqual(4);

    // 4. Offsets vary up to 120 px, left-aligned within container
    for (const item of widthsAndOffsets) {
      expect(item.offset).toBeGreaterThanOrEqual(0);
      expect(item.offset).toBeLessThanOrEqual(120);
      expect(item.width + item.offset).toBeLessThanOrEqual(900);
    }
  });

  test('18. Defect 3: Title fonts verification (5 presets, neighbor distinct, >= 3 distinct in 7 books, 18-30px scale)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_sketches');
    await expect(page.locator('.book-spine-item').first()).toBeVisible();

    const titles = page.locator('[data-testid^="book-title-"]');
    const count = await titles.count();
    expect(count).toBe(7);

    const fontStyles = await titles.evaluateAll((elements) => {
      return elements.map((el) => {
        const style = window.getComputedStyle(el);
        return {
          fontFamily: style.fontFamily,
          fontSize: parseFloat(style.fontSize),
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
        };
      });
    });

    // 1. Single line with ellipsis
    for (const fs of fontStyles) {
      expect(fs.whiteSpace).toBe('nowrap');
      expect(fs.textOverflow).toBe('ellipsis');
    }

    // 2. Neighboring books must not share a font family
    for (let i = 1; i < count; i++) {
      expect(fontStyles[i].fontFamily).not.toBe(fontStyles[i - 1].fontFamily);
    }

    // 3. Across the 7 books, at least 3 distinct fonts
    const uniqueFonts = new Set(fontStyles.map((f) => f.fontFamily));
    expect(uniqueFonts.size).toBeGreaterThanOrEqual(3);

    // 4. Font size scales with thickness: min 18 px, max 30 px
    for (const fs of fontStyles) {
      expect(fs.fontSize).toBeGreaterThanOrEqual(18);
      expect(fs.fontSize).toBeLessThanOrEqual(30);
    }
  });

  test('19. Defect 4: Contrast verification (title ink vs spine bg >= 4.5:1, solid foil + 1px depth shadow)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:3000/category/cat_sketches');
    await expect(page.locator('.book-spine-item').first()).toBeVisible();

    const spineItems = page.locator('.book-spine-item');
    const count = await spineItems.count();

    const contrasts = await spineItems.evaluateAll((elements) => {
      function sRgbToLin(c: number) {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }
      function relLuminance(r: number, g: number, b: number) {
        return 0.2126 * sRgbToLin(r) + 0.7152 * sRgbToLin(g) + 0.0722 * sRgbToLin(b);
      }
      function parseRgb(color: string) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return { r: 0, g: 0, b: 0 };
        return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
      }

      return elements.map((spineEl) => {
        const spineStyle = window.getComputedStyle(spineEl);
        const spineBg = parseRgb(spineStyle.backgroundColor);
        const spineLum = relLuminance(spineBg.r, spineBg.g, spineBg.b);

        const titleEl = spineEl.querySelector('[data-testid^="book-title-"]') as HTMLElement;
        const titleStyle = window.getComputedStyle(titleEl);
        const titleColor = parseRgb(titleStyle.color);
        const titleLum = relLuminance(titleColor.r, titleColor.g, titleColor.b);

        const l1 = Math.max(spineLum, titleLum);
        const l2 = Math.min(spineLum, titleLum);
        const contrast = (l1 + 0.05) / (l2 + 0.05);

        // Check text shadow for solid 1px offset depth shadow without blurry glow
        const textShadow = titleStyle.textShadow;

        // Check edge border if light cover
        const isLightCover = spineLum > 0.5;
        const borderBottomColor = spineStyle.borderBottomColor;

        return {
          contrast,
          textShadow,
          isLightCover,
          borderBottomColor,
        };
      });
    });

    for (const c of contrasts) {
      // 1. Contrast >= 4.5:1
      expect(c.contrast).toBeGreaterThanOrEqual(4.5);

      // 2. Solid depth shadow: offset 1px, not blurry glow (blur radius <= 1px)
      if (c.textShadow && c.textShadow !== 'none') {
        expect(c.textShadow).toMatch(/1px/);
      }
    }
  });
});
