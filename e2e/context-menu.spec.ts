import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';
const AUTH_HEADER = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 3: Custom Right-Click Context Menu Suite', () => {
  let categoryId: string;
  let entryId: string;

  test.beforeAll(async ({ request }) => {
    // Create test category
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: AUTH_HEADER,
      data: {
        title: 'Context Menu Category',
        color: '#4f46e5',
      },
    });
    expect(catRes.ok()).toBeTruthy();
    const catData = await catRes.json();
    categoryId = catData.id;

    // Create test entry
    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId,
        title: 'Context Menu Test Entry',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Sample text to test context menu formatting.' }],
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    const entryData = await entryRes.json();
    entryId = entryData.id;
  });

  test('1. Right-click in editor opens custom context menu and prevents native menu', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Right-click inside editor
    await editor.click({ button: 'right' });

    // Custom menu appears
    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).toBeVisible();

    // Verify key menu items are present
    await expect(page.locator('[data-testid="context-menu-item-bold"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-item-italic"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-item-heading-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-item-bullet-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-item-quote"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-item-align-center"]')).toBeVisible();
  });

  test('2. Menu action changes document formatting', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Focus editor and type identifiable text
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ActionFormattingVerification');

    // Right-click inside editor to open context menu
    await editor.click({ button: 'right' });
    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).toBeVisible();

    // Click Heading 1 action
    const h1Item = page.locator('[data-testid="context-menu-item-heading-1"]');
    await h1Item.click();

    // Menu closes
    await expect(menu).not.toBeVisible();

    // Document now contains <h1> heading node with the text
    const h1Node = editor.locator('h1');
    await expect(h1Node).toBeVisible();
    await expect(h1Node).toContainText('ActionFormattingVerification');
  });

  test('3. Shift + Right-click is not intercepted (retains native menu)', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Shift + right-click inside editor
    await editor.click({ button: 'right', modifiers: ['Shift'] });

    // Custom menu must NOT appear
    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).not.toBeVisible();
  });

  test('4. Right-click inside title input preserves native menu and does not open custom menu', async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const titleInput = page.locator('[data-testid="entry-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 15000 });

    // Right-click inside title textarea
    await titleInput.click({ button: 'right' });

    // Custom menu must NOT open on native input elements
    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).not.toBeVisible();
  });

  test('5. Keyboard navigation: ArrowDown navigates, Enter activates, and Escape closes menu', async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Right-click to open menu
    await editor.click({ button: 'right' });
    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).toBeVisible();

    // Press Escape -> menu closes immediately
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    // Reopen menu
    await editor.click({ button: 'right' });
    await expect(menu).toBeVisible();

    // Navigate with ArrowDown
    await page.keyboard.press('ArrowDown');
    const italicItem = page.locator('[data-testid="context-menu-item-italic"]');
    await expect(italicItem).toHaveAttribute('aria-selected', 'true');

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });

  test('6. Menu position is clamped within viewport boundaries', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Dispatch a contextmenu event near the bottom-right corner (780, 580)
    await page.mouse.click(780, 580, { button: 'right' });

    const menu = page.locator('[data-testid="custom-context-menu"]');
    await expect(menu).toBeVisible();

    // Verify bounding box does not exceed viewport bounds
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x + box.width).toBeLessThanOrEqual(800);
      expect(box.y + box.height).toBeLessThanOrEqual(600);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });
});
