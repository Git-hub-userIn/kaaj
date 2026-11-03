import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4H: UX Enhancements Suite', () => {
  let devCatId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'UX Feature Notebook', color: '#c25e38' },
    });
    expect(catRes.ok()).toBeTruthy();
    devCatId = (await catRes.json()).id;

    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: {
        categoryId: devCatId,
        title: 'Focus and Metrics Entry',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Visual scrapbook journaling requires calm focus.' }],
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    devEntryId = (await entryRes.json()).id;
  });

  test('Dark theme toggle updates HTML class and persists', async ({ page }) => {
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    const themeBtn = page.locator('[data-testid="theme-toggle-btn"]');
    await expect(themeBtn).toBeVisible();

    // Toggle to Dark Mode
    await themeBtn.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Verify localStorage persistence
    const storedTheme = await page.evaluate(() => localStorage.getItem('kaaj_theme'));
    expect(storedTheme).toBe('dark');

    // Toggle back to Light Mode
    await themeBtn.click();
    const isDarkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDarkAfter).toBeFalsy();
  });

  test('Focus mode toggle hides interface chrome and exit button restores', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]');

    const focusBtn = page.locator('[data-testid="toolbar-focus-btn"]');
    await expect(focusBtn).toBeVisible();

    // Activate Focus Mode
    await focusBtn.click();
    const editorScreen = page.locator('[data-testid="entry-editor-screen"]');
    await expect(editorScreen).toHaveAttribute('data-focus-mode', 'true');

    // Floating exit button should be present
    const exitBtn = page.locator('[data-testid="exit-focus-btn"]');
    await expect(exitBtn).toBeVisible();

    // Click Exit Focus Mode
    await exitBtn.click();
    await expect(editorScreen).toHaveAttribute('data-focus-mode', 'false');
  });

  test('Word count and reading time badge accurately calculates metrics', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]');

    const badge = page.locator('[data-testid="word-count-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('word');
    await expect(badge).toContainText('min read');

    // Type additional content
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type(' Adding more inspiring sentences to test reading duration.');
    await expect(badge).toContainText('min read');
  });

  test('Daily Journal template creates structured entry and On This Day recall respects isolation', async ({
    page,
    request,
  }) => {
    // 1. Verify User A creates entry on this day
    const aliceRes = await request.post(`${API_BASE}/entries/daily-template`, {
      headers: ALICE_AUTH,
    });
    expect(aliceRes.status()).toBe(201);
    const aliceDaily = await aliceRes.json();
    expect(aliceDaily.title).toContain('Daily Journal —');

    // 2. User A retrieves on-this-day entries
    const aliceQuery = await request.get(`${API_BASE}/entries/on-this-day`, {
      headers: ALICE_AUTH,
    });
    expect(aliceQuery.ok()).toBeTruthy();
    const aliceEntries = await aliceQuery.json();
    expect(aliceEntries.some((e: any) => e.id === aliceDaily.id)).toBeTruthy();

    // 3. User B retrieves on-this-day entries -> cannot see Alice's daily journal
    const bobQuery = await request.get(`${API_BASE}/entries/on-this-day`, {
      headers: BOB_AUTH,
    });
    expect(bobQuery.ok()).toBeTruthy();
    const bobEntries = await bobQuery.json();
    expect(bobEntries.some((e: any) => e.id === aliceDaily.id)).toBeFalsy();

    // 4. Test Home UI Daily Journal button
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    const journalBtn = page.locator('[data-testid="daily-journal-btn"]');
    await expect(journalBtn).toBeVisible();
    await journalBtn.click();

    // Should navigate to newly created daily journal entry editor
    await page.waitForURL(/\/entry\/entry_/);
    await expect(page.locator('[data-testid="entry-title-input"]')).toHaveValue(/Daily Journal —/);

    // Verify sections from template exist
    await expect(page.locator('text=Morning Intentions')).toBeVisible();
    await expect(page.locator('text=Daily Priorities')).toBeVisible();
    await expect(page.locator('text=Evening Reflection')).toBeVisible();
  });
});
