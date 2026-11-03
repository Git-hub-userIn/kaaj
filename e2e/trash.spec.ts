import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4C: Trash & Soft-Delete Suite', () => {
  let aliceCategoryId: string;
  let aliceEntry1Id: string;
  let aliceEntry2Id: string;
  let devCategoryId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice category and entries
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Recycle Vault', color: '#ec4899' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCategoryId = (await aCatRes.json()).id;

    const aEntry1Res = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCategoryId, title: 'Alice Document To Restore' },
    });
    expect(aEntry1Res.ok()).toBeTruthy();
    aliceEntry1Id = (await aEntry1Res.json()).id;

    const aEntry2Res = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCategoryId, title: 'Alice Document To Purge' },
    });
    expect(aEntry2Res.ok()).toBeTruthy();
    aliceEntry2Id = (await aEntry2Res.json()).id;

    // Soft-delete Alice entries
    await request.delete(`${API_BASE}/entries/${aliceEntry1Id}`, { headers: ALICE_AUTH });
    await request.delete(`${API_BASE}/entries/${aliceEntry2Id}`, { headers: ALICE_AUTH });

    // 2. Seed Dev user data for UI tests
    const devCatRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'Dev Discards', color: '#8b5cf6' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCategoryId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: { categoryId: devCategoryId, title: 'Dev Temporary Draft In Trash' },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;

    // Soft-delete Dev entry
    await request.delete(`${API_BASE}/entries/${devEntryId}`, { headers: DEV_AUTH });
  });

  test('excludes soft-deleted entries from standard category listing and search', async ({ request }) => {
    const listRes = await request.get(`${API_BASE}/categories/${aliceCategoryId}/entries`, {
      headers: ALICE_AUTH,
    });
    expect(listRes.status()).toBe(200);
    const entries = await listRes.json();
    const foundDeleted = entries.find((e: any) => e.id === aliceEntry1Id || e.id === aliceEntry2Id);
    expect(foundDeleted).toBeUndefined();

    const searchRes = await request.get(`${API_BASE}/search?q=Alice+Document`, {
      headers: ALICE_AUTH,
    });
    expect(searchRes.status()).toBe(200);
    const searchData = await searchRes.json();
    const foundInSearch = searchData.find((e: any) => e.id === aliceEntry1Id || e.id === aliceEntry2Id);
    expect(foundInSearch).toBeUndefined();
  });

  test('lists soft-deleted entries in GET /trash for current user', async ({ request }) => {
    const trashRes = await request.get(`${API_BASE}/trash`, {
      headers: ALICE_AUTH,
    });
    expect(trashRes.status()).toBe(200);
    const items = await trashRes.json();
    expect(Array.isArray(items)).toBeTruthy();
    const item1 = items.find((i: any) => i.id === aliceEntry1Id);
    const item2 = items.find((i: any) => i.id === aliceEntry2Id);
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
    expect(item1.deletedAt).toBeDefined();
  });

  test('enforces cross-user isolation: User Bob cannot see, restore, or purge Alice trash', async ({ request }) => {
    // 1. Bob's trash does not contain Alice's deleted entries
    const bTrashRes = await request.get(`${API_BASE}/trash`, {
      headers: BOB_AUTH,
    });
    expect(bTrashRes.status()).toBe(200);
    const bItems = await bTrashRes.json();
    const hasAliceItem = bItems.some((i: any) => i.id === aliceEntry1Id || i.id === aliceEntry2Id);
    expect(hasAliceItem).toBeFalsy();

    // 2. Bob cannot restore Alice's deleted entry
    const bRestoreRes = await request.post(`${API_BASE}/entries/${aliceEntry1Id}/restore`, {
      headers: BOB_AUTH,
    });
    expect(bRestoreRes.status()).toBe(404);

    // 3. Bob cannot purge Alice's deleted entry
    const bPurgeRes = await request.delete(`${API_BASE}/entries/${aliceEntry1Id}/purge`, {
      headers: BOB_AUTH,
    });
    expect(bPurgeRes.status()).toBe(404);
  });

  test('restores soft-deleted entry and clears deletedAt', async ({ request }) => {
    const restoreRes = await request.post(`${API_BASE}/entries/${aliceEntry1Id}/restore`, {
      headers: ALICE_AUTH,
    });
    expect(restoreRes.status()).toBe(200);
    const data = await restoreRes.json();
    expect(data.success).toBeTruthy();
    expect(data.entry.id).toBe(aliceEntry1Id);
    expect(data.entry.deletedAt).toBeNull();

    // Entry should now reappear in category listings
    const listRes = await request.get(`${API_BASE}/categories/${aliceCategoryId}/entries`, {
      headers: ALICE_AUTH,
    });
    expect(listRes.status()).toBe(200);
    const entries = await listRes.json();
    const restored = entries.find((e: any) => e.id === aliceEntry1Id);
    expect(restored).toBeDefined();
  });

  test('permanently purges single entry from database', async ({ request }) => {
    const purgeRes = await request.delete(`${API_BASE}/entries/${aliceEntry2Id}/purge`, {
      headers: ALICE_AUTH,
    });
    expect(purgeRes.status()).toBe(200);

    // Verifying it cannot be retrieved or restored anymore
    const getRes = await request.get(`${API_BASE}/entries/${aliceEntry2Id}`, {
      headers: ALICE_AUTH,
    });
    expect(getRes.status()).toBe(404);

    const restoreRes = await request.post(`${API_BASE}/entries/${aliceEntry2Id}/restore`, {
      headers: ALICE_AUTH,
    });
    expect(restoreRes.status()).toBe(404);
  });

  test('opens trash modal from home header, displays item, and handles close and restore in UI', async ({ page }) => {
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]', { timeout: 10000 });

    // Open trash modal via home header button
    const openTrashBtn = page.locator('[data-testid="open-trash-btn"]');
    await expect(openTrashBtn).toBeVisible();
    await openTrashBtn.click();

    // Verify modal is open
    const modal = page.locator('[data-testid="trash-modal"]');
    await expect(modal).toBeVisible();

    // Item should be rendered in modal
    const itemTitle = page.locator(`[data-testid="trash-item-title-${devEntryId}"]`);
    await expect(itemTitle).toBeVisible();
    await expect(itemTitle).toContainText('Dev Temporary Draft In Trash');

    // Click restore button in modal
    const restoreBtn = page.locator(`[data-testid="restore-trash-item-${devEntryId}"]`);
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Item should be removed from trash list
    await expect(itemTitle).toBeHidden();

    // Close modal via close button
    const closeBtn = page.locator('[data-testid="close-trash-modal-btn"]');
    await closeBtn.click();
    await expect(modal).toBeHidden();

    // Reopen and close via Escape key
    await openTrashBtn.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});
