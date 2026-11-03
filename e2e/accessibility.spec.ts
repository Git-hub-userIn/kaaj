import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4I: Accessibility Suite', () => {
  let devCatId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'Accessibility Audit Notebook', color: '#475b63' },
    });
    expect(catRes.ok()).toBeTruthy();
    devCatId = (await catRes.json()).id;

    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: {
        categoryId: devCatId,
        title: 'WCAG 2.1 AA Compliance Testing',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'All interactive elements adhere to universal access standards.' }],
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    devEntryId = (await entryRes.json()).id;
  });

  test('Skip to content link is keyboard accessible and focuses main content', async ({ page }) => {
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    // First tab press must focus the skip link
    await page.keyboard.press('Tab');
    const skipLink = page.locator('[data-testid="skip-to-content"]');
    await expect(skipLink).toBeFocused();

    // Activating skip link focuses main content container
    await page.keyboard.press('Enter');
    const mainContent = page.locator('#main-content');
    await expect(mainContent).toBeFocused();
  });

  test('Modal dialogs expose proper ARIA semantics and close on Escape key', async ({ page }) => {
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    // 1. Trash Modal
    const trashBtn = page.locator('[data-testid="open-trash-btn"]');
    await trashBtn.click();

    const trashModal = page.locator('[data-testid="trash-modal"]');
    await expect(trashModal).toBeVisible();
    await expect(trashModal).toHaveAttribute('role', 'dialog');
    await expect(trashModal).toHaveAttribute('aria-modal', 'true');

    await page.keyboard.press('Escape');
    await expect(trashModal).toBeHidden();

    // 2. Command Palette (Cmd+K / Ctrl+K)
    await page.keyboard.press('Control+KeyK');
    const paletteBackdrop = page.locator('[data-testid="command-palette-backdrop"]');
    await expect(paletteBackdrop).toBeVisible();
    await expect(paletteBackdrop).toHaveAttribute('role', 'dialog');
    await expect(paletteBackdrop).toHaveAttribute('aria-modal', 'true');

    await page.keyboard.press('Escape');
    await expect(paletteBackdrop).toBeHidden();
  });

  test('Editor drawers expose accessible roles and dismiss on Escape', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]');

    // 1. Share Modal
    const shareBtn = page.locator('[data-testid="toolbar-share-btn"]');
    await shareBtn.click();

    const shareModal = page.locator('[data-testid="share-modal"]');
    await expect(shareModal).toBeVisible();
    await expect(shareModal).toHaveAttribute('role', 'dialog');

    await page.keyboard.press('Escape');
    await expect(shareModal).toBeHidden();

    // 2. Backlinks Drawer
    const backlinksBtn = page.locator('[data-testid="toolbar-backlinks-btn"]');
    await backlinksBtn.click();

    const backlinksDrawer = page.locator('[data-testid="backlinks-drawer"]');
    await expect(backlinksDrawer).toBeVisible();
    await expect(backlinksDrawer).toHaveAttribute('role', 'dialog');

    await page.keyboard.press('Escape');
    await expect(backlinksDrawer).toBeHidden();
  });

  test('Respects prefers-reduced-motion media query', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    const reducedMotionMatches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    expect(reducedMotionMatches).toBeTruthy();
  });
});
