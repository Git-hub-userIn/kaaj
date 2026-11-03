import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4E: Tags & [[entry]] Backlinks Suite', () => {
  let aliceCatId: string;
  let aliceEntry1Id: string;
  let aliceEntry2Id: string;
  let devCatId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice category and entries
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Tags Category', color: '#10b981' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCatId = (await aCatRes.json()).id;

    const aEntry1Res = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCatId, title: 'Alice Main Documentation' },
    });
    expect(aEntry1Res.ok()).toBeTruthy();
    aliceEntry1Id = (await aEntry1Res.json()).id;

    const aEntry2Res = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCatId, title: 'Alice Related Research' },
    });
    expect(aEntry2Res.ok()).toBeTruthy();
    aliceEntry2Id = (await aEntry2Res.json()).id;

    // Seed wikilink inside Alice Entry 2 pointing to Alice Entry 1
    const putRes = await request.put(`${API_BASE}/entries/${aliceEntry2Id}`, {
      headers: ALICE_AUTH,
      data: {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Refer to [[Alice Main Documentation]] for architecture guidelines.',
                },
              ],
            },
          ],
        },
      },
    });
    expect(putRes.ok()).toBeTruthy();

    // 2. Seed Dev user data for browser UI tests
    const devCatRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'Dev Journal Vault', color: '#3b82f6' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCatId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: { categoryId: devCatId, title: 'Dev Daily Notes' },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;
  });

  test('adds, lists, and deletes tags on entries via API with user scoping', async ({ request }) => {
    // Add tag #planning to Alice Entry 1
    const tagRes1 = await request.post(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: ALICE_AUTH,
      data: { name: 'planning' },
    });
    expect(tagRes1.status()).toBe(201);
    const tag1 = await tagRes1.json();
    expect(tag1.name).toBe('planning');

    // Add tag #urgent to Alice Entry 1
    const tagRes2 = await request.post(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: ALICE_AUTH,
      data: { name: '#urgent' },
    });
    expect(tagRes2.status()).toBe(201);
    const tag2 = await tagRes2.json();
    expect(tag2.name).toBe('urgent');

    // List tags on Alice Entry 1
    const entryTagsRes = await request.get(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: ALICE_AUTH,
    });
    expect(entryTagsRes.status()).toBe(200);
    const entryTags = await entryTagsRes.json();
    expect(entryTags.length).toBe(2);
    expect(entryTags.some((t: any) => t.name === 'planning')).toBeTruthy();
    expect(entryTags.some((t: any) => t.name === 'urgent')).toBeTruthy();

    // List all tags for Alice
    const allTagsRes = await request.get(`${API_BASE}/tags`, {
      headers: ALICE_AUTH,
    });
    expect(allTagsRes.status()).toBe(200);
    const allTags = await allTagsRes.json();
    expect(allTags.some((t: any) => t.name === 'planning' && t.count >= 1)).toBeTruthy();

    // Delete tag #urgent from Alice Entry 1
    const delRes = await request.delete(`${API_BASE}/entries/${aliceEntry1Id}/tags/${tag2.id}`, {
      headers: ALICE_AUTH,
    });
    expect(delRes.status()).toBe(200);

    // Verify tag was removed from entry
    const entryTagsAfterRes = await request.get(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: ALICE_AUTH,
    });
    const entryTagsAfter = await entryTagsAfterRes.json();
    expect(entryTagsAfter.length).toBe(1);
    expect(entryTagsAfter[0].name).toBe('planning');
  });

  test('resolves [[entry]] backlinks dynamically across chunks', async ({ request }) => {
    // Alice Entry 1 should have Alice Entry 2 in its backlinks
    const backlinkRes = await request.get(`${API_BASE}/entries/${aliceEntry1Id}/backlinks`, {
      headers: ALICE_AUTH,
    });
    expect(backlinkRes.status()).toBe(200);
    const backlinks = await backlinkRes.json();
    expect(backlinks.length).toBe(1);
    expect(backlinks[0].id).toBe(aliceEntry2Id);
    expect(backlinks[0].title).toBe('Alice Related Research');
  });

  test('enforces strict cross-user isolation on tags and backlinks', async ({ request }) => {
    // Bob attempts to get Alice's entry tags -> 404
    const bobGetTags = await request.get(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: BOB_AUTH,
    });
    expect(bobGetTags.status()).toBe(404);

    // Bob attempts to add tag to Alice's entry -> 404
    const bobAddTag = await request.post(`${API_BASE}/entries/${aliceEntry1Id}/tags`, {
      headers: BOB_AUTH,
      data: { name: 'malicious' },
    });
    expect(bobAddTag.status()).toBe(404);

    // Bob attempts to get Alice's backlinks -> 404
    const bobBacklinks = await request.get(`${API_BASE}/entries/${aliceEntry1Id}/backlinks`, {
      headers: BOB_AUTH,
    });
    expect(bobBacklinks.status()).toBe(404);

    // Bob's tag list should not contain Alice's tags
    const bobTagsRes = await request.get(`${API_BASE}/tags`, {
      headers: BOB_AUTH,
    });
    expect(bobTagsRes.status()).toBe(200);
    const bobTags = await bobTagsRes.json();
    expect(bobTags.find((t: any) => t.name === 'planning')).toBeUndefined();
  });

  test('manages tags and inspects backlinks drawer in browser editor', async ({ page }) => {
    // Navigate to Dev entry
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]', { timeout: 10000 });

    // 1. Tag interaction: Click "+ Tag" button and type a new tag
    const addTagBtn = page.locator('[data-testid="add-tag-btn"]');
    await expect(addTagBtn).toBeVisible();
    await addTagBtn.click();

    const addTagInput = page.locator('[data-testid="add-tag-input"]');
    await expect(addTagInput).toBeVisible();
    await addTagInput.fill('roadmap');

    const saveTagBtn = page.locator('[data-testid="save-tag-btn"]');
    await saveTagBtn.click();

    // Verify tag pill appears
    const tagBadge = page.locator('[data-testid="tag-badge"]').first();
    await expect(tagBadge).toContainText('#roadmap');

    // 2. Open Backlinks drawer via toolbar
    const backlinksBtn = page.locator('[data-testid="toolbar-backlinks-btn"]');
    await expect(backlinksBtn).toBeVisible();
    await backlinksBtn.click();

    // Verify drawer opened
    const backlinksDrawer = page.locator('[data-testid="backlinks-drawer"]');
    await expect(backlinksDrawer).toBeVisible();

    // Close drawer
    const closeBtn = page.locator('[data-testid="close-backlinks-btn"]');
    await closeBtn.click();
    await expect(backlinksDrawer).not.toBeVisible();

    // 3. Delete tag pill
    const removeTagBtn = tagBadge.locator('[data-testid="remove-tag-btn"]');
    await removeTagBtn.click();
    await expect(page.locator('[data-testid="tag-badge"]')).toHaveCount(0);
  });
});
