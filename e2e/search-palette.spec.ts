import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4A: Search & Command Palette Suite', () => {
  let aliceCategoryId: string;
  let aliceEntryId: string;
  let bobCategoryId: string;
  let bobEntryId: string;
  let devCategoryId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice data
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Physics Lab', color: '#0ea5e9' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCategoryId = (await aCatRes.json()).id;

    const aEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCategoryId,
        title: 'QuantumSuperposition Research',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Entangled photon emitter states inside cavity.' }],
              },
            ],
          },
        },
      },
    });
    expect(aEntryRes.ok()).toBeTruthy();
    aliceEntryId = (await aEntryRes.json()).id;

    // 2. Seed Bob data
    const bCatRes = await request.post(`${API_BASE}/categories`, {
      headers: BOB_AUTH,
      data: { title: 'Bob Astronomy', color: '#f59e0b' },
    });
    expect(bCatRes.ok()).toBeTruthy();
    bobCategoryId = (await bCatRes.json()).id;

    const bEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: BOB_AUTH,
      data: {
        categoryId: bobCategoryId,
        title: 'PlanetaryKeplerOrbit Equations',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Gravitational ellipse calculations for satellites.' }],
              },
            ],
          },
        },
      },
    });
    expect(bEntryRes.ok()).toBeTruthy();
    bobEntryId = (await bEntryRes.json()).id;

    // 3. Seed default dev-owner-user data for browser tests
    const devCatRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'General Studies', color: '#10b981' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCategoryId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: {
        categoryId: devCategoryId,
        title: 'PaletteFindableNote Subject',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Deep learning neural networks and transformers.' }],
              },
            ],
          },
        },
      },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;
  });

  test('1. Full-text search returns matching entry for authorized user', async ({ request }) => {
    const searchRes = await request.get(`${API_BASE}/search?q=QuantumSuperposition`, {
      headers: ALICE_AUTH,
    });
    expect(searchRes.ok()).toBeTruthy();
    const results = await searchRes.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(aliceEntryId);
    expect(results[0].title).toBe('QuantumSuperposition Research');
    expect(results[0].categoryTitle).toBe('Alice Physics Lab');
  });

  test('2. Cross-user isolation: Bob cannot discover Alice search results', async ({ request }) => {
    const searchRes = await request.get(`${API_BASE}/search?q=QuantumSuperposition`, {
      headers: BOB_AUTH,
    });
    expect(searchRes.ok()).toBeTruthy();
    const results = await searchRes.json();
    expect(results.length).toBe(0);
  });

  test('3. Search matches across entry chunks and category metadata', async ({ request }) => {
    // Search by category title term
    const catSearchRes = await request.get(`${API_BASE}/search?q=Physics`, {
      headers: ALICE_AUTH,
    });
    expect(catSearchRes.ok()).toBeTruthy();
    const catResults = await catSearchRes.json();
    expect(catResults.some((r: any) => r.id === aliceEntryId)).toBeTruthy();

    // Search by chunk body content term
    const chunkSearchRes = await request.get(`${API_BASE}/search?q=photon`, {
      headers: ALICE_AUTH,
    });
    expect(chunkSearchRes.ok()).toBeTruthy();
    const chunkResults = await chunkSearchRes.json();
    expect(chunkResults.some((r: any) => r.id === aliceEntryId)).toBeTruthy();
  });

  test('4. Global hotkey Cmd/Ctrl + K opens and Escape closes the Command Palette', async ({ page }) => {
    await page.goto(WEB_BASE);
    await expect(page.locator('[data-testid="home-screen"]')).toBeVisible({ timeout: 15000 });
    const palette = page.locator('[data-testid="command-palette-modal"]');
    await expect(palette).not.toBeVisible();

    // Trigger Cmd+K / Ctrl+K
    await page.keyboard.press('ControlOrMeta+K');
    await expect(palette).toBeVisible();

    // Input must be auto-focused
    const input = page.locator('[data-testid="command-palette-input"]');
    await expect(input).toBeFocused();

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();
  });

  test('5. Typing in Command Palette searches and jumps to selected entry', async ({ page }) => {
    await page.goto(WEB_BASE);
    await expect(page.locator('[data-testid="home-screen"]')).toBeVisible({ timeout: 15000 });

    // Open palette via search button
    await page.locator('[data-testid="open-command-palette-btn"]').click();
    const input = page.locator('[data-testid="command-palette-input"]');
    await expect(input).toBeVisible();

    // Type search query
    await input.fill('PaletteFindableNote');

    // Wait for debounced search result
    const resultItem = page.locator(`[data-testid="command-result-${devEntryId}"]`);
    await expect(resultItem).toBeVisible({ timeout: 5000 });
    await expect(resultItem).toContainText('PaletteFindableNote Subject');

    // Press Enter to navigate
    await page.keyboard.press('Enter');

    // Modal closes and navigates to the entry
    await expect(page.locator('[data-testid="command-palette-modal"]')).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/entry/${devEntryId}`));
  });

  test('6. "Create New Entry" quick action creates and navigates to fresh entry', async ({ page }) => {
    await page.goto(WEB_BASE);
    await expect(page.locator('[data-testid="home-screen"]')).toBeVisible({ timeout: 15000 });

    // Open palette
    await page.locator('[data-testid="open-command-palette-btn"]').click();
    const newEntryAction = page.locator('[data-testid="command-palette-new-entry"]');
    await expect(newEntryAction).toBeVisible();

    // Click "Create New Entry"
    await newEntryAction.click();

    // Palette closes and navigates to newly created entry editor
    await expect(page.locator('[data-testid="command-palette-modal"]')).not.toBeVisible();
    await expect(page).toHaveURL(/\/entry\/entry_/);
    await expect(page.locator('[data-testid="entry-title-input"]')).toBeVisible({ timeout: 15000 });
  });
});
