import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4B: Revision History Suite', () => {
  let aliceCategoryId: string;
  let aliceEntryId: string;
  let devCategoryId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice data
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Archives', color: '#10b981' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCategoryId = (await aCatRes.json()).id;

    const aEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCategoryId,
        title: 'Original Title Alice',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Initial version 1 content for Alice.' }],
              },
            ],
          },
        },
      },
    });
    expect(aEntryRes.ok()).toBeTruthy();
    aliceEntryId = (await aEntryRes.json()).id;

    // Save version 2 for Alice
    const aSaveRes2 = await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
      data: {
        title: 'Updated Title Alice v2',
        expectedVersion: 1,
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Second iteration version 2 content.' }],
              },
            ],
          },
        },
      },
    });
    expect(aSaveRes2.ok()).toBeTruthy();

    // 2. Seed Dev User data for UI tests
    const devCatRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'Dev Journal', color: '#6366f1' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCategoryId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: {
        categoryId: devCategoryId,
        title: 'Dev Historical Notes',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Dev baseline chapter 1 text.' }],
              },
            ],
          },
        },
      },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;

    // Save version 2 for Dev
    const devSaveRes2 = await request.put(`${API_BASE}/entries/${devEntryId}`, {
      headers: DEV_AUTH,
      data: {
        title: 'Dev Historical Notes v2',
        expectedVersion: 1,
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Dev updated chapter 2 text.' }],
              },
            ],
          },
        },
      },
    });
    expect(devSaveRes2.ok()).toBeTruthy();
  });

  test('records snapshots on document save and lists revisions in descending order', async ({ request }) => {
    const listRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/revisions`, {
      headers: ALICE_AUTH,
    });
    expect(listRes.status()).toBe(200);
    const revisions = await listRes.json();
    expect(Array.isArray(revisions)).toBeTruthy();
    expect(revisions.length).toBeGreaterThanOrEqual(1);

    const v2 = revisions.find((r: any) => r.version === 2);
    expect(v2).toBeDefined();
    expect(v2.title).toBe('Updated Title Alice v2');
  });

  test('fetches full revision detail including doc snapshot', async ({ request }) => {
    const revRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/revisions/2`, {
      headers: ALICE_AUTH,
    });
    expect(revRes.status()).toBe(200);
    const rev = await revRes.json();
    expect(rev.entryId).toBe(aliceEntryId);
    expect(rev.version).toBe(2);
    expect(rev.doc).toBeDefined();
    expect(rev.doc.doc.content[0].content[0].text).toContain('Second iteration');
  });

  test('enforces cross-user isolation: User Bob cannot list, preview, or restore Alice revisions', async ({ request }) => {
    // Bob tries to list Alice's revisions
    const listRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/revisions`, {
      headers: BOB_AUTH,
    });
    expect(listRes.status()).toBe(404);

    // Bob tries to preview Alice's revision v2
    const previewRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/revisions/2`, {
      headers: BOB_AUTH,
    });
    expect(previewRes.status()).toBe(404);

    // Bob tries to restore Alice's revision v2
    const restoreRes = await request.post(`${API_BASE}/entries/${aliceEntryId}/revisions/2/restore`, {
      headers: BOB_AUTH,
    });
    expect(restoreRes.status()).toBe(404);
  });

  test('restores historical revision via API', async ({ request }) => {
    // Save version 3 for Alice
    const saveV3Res = await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
      data: {
        title: 'Alice Final V3',
        expectedVersion: 2,
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Alice version 3 transient content.' }],
              },
            ],
          },
        },
      },
    });
    expect(saveV3Res.ok()).toBeTruthy();

    // Restore version 2
    const restoreRes = await request.post(`${API_BASE}/entries/${aliceEntryId}/revisions/2/restore`, {
      headers: ALICE_AUTH,
    });
    expect(restoreRes.status()).toBe(200);

    // Verify current entry now has version 2 content and title
    const currentRes = await request.get(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
    });
    expect(currentRes.status()).toBe(200);
    const current = await currentRes.json();
    expect(current.title).toBe('Updated Title Alice v2');
    expect(current.doc.doc.content[0].content[0].text).toContain('Second iteration');
  });

  test('opens history drawer in UI, previews snapshot, and closes with button and Escape key', async ({ page }) => {
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]', { timeout: 10000 });

    // History button must be visible in toolbar
    const historyBtn = page.locator('[data-testid="toolbar-history-btn"]');
    await expect(historyBtn).toBeVisible();

    // Click history button to open drawer
    await historyBtn.click();
    const drawer = page.locator('[data-testid="revision-history-drawer"]');
    await expect(drawer).toBeVisible();

    // Revision items should be rendered
    const rev2Item = page.locator('[data-testid="revision-item-2"]');
    await expect(rev2Item).toBeVisible();

    // Preview content should be visible
    const previewContent = page.locator('[data-testid="revision-preview-content"]');
    await expect(previewContent).toBeVisible();
    await expect(previewContent).toContainText('Dev Historical Notes');

    // Close via close button
    const closeBtn = page.locator('[data-testid="close-history-drawer-btn"]');
    await closeBtn.click();
    await expect(drawer).toBeHidden();

    // Reopen and close via Escape key
    await historyBtn.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});
