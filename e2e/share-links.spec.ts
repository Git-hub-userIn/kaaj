import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4F: Share Links Suite', () => {
  let aliceCatId: string;
  let aliceEntryId: string;
  let devCatId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice category and entry
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Shared Project', color: '#6366f1' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCatId = (await aCatRes.json()).id;

    const aEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCatId, title: 'Alice Public Brief' },
    });
    expect(aEntryRes.ok()).toBeTruthy();
    aliceEntryId = (await aEntryRes.json()).id;

    // Save content for Alice entry
    const putRes = await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
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
                  text: 'This is a shared document visible to anyone with the secret link.',
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
      data: { title: 'Dev Shared Vault', color: '#14b8a6' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCatId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: { categoryId: devCatId, title: 'Dev Presentation Draft' },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;
  });

  test('generates, reads publicly, and revokes share links with user isolation', async ({ request }) => {
    // 1. Alice creates share link
    const shareRes = await request.post(`${API_BASE}/entries/${aliceEntryId}/share`, {
      headers: ALICE_AUTH,
      data: { expiresInDays: 7 },
    });
    expect(shareRes.status()).toBe(201);
    const link = await shareRes.json();
    expect(link.token).toBeDefined();
    expect(link.entryId).toBe(aliceEntryId);

    // 2. Public unauthenticated client fetches the shared document
    const publicRes = await request.get(`${API_BASE}/shared/${link.token}`);
    expect(publicRes.status()).toBe(200);
    const sharedDoc = await publicRes.json();
    expect(sharedDoc.title).toBe('Alice Public Brief');
    expect(sharedDoc.doc).toBeDefined();

    // 3. User B isolation check: Bob cannot list Alice's share links
    const bobListRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/share`, {
      headers: BOB_AUTH,
    });
    expect(bobListRes.status()).toBe(404);

    // 4. User B isolation check: Bob cannot revoke Alice's share link
    const bobRevokeRes = await request.delete(
      `${API_BASE}/entries/${aliceEntryId}/share/${link.id}`,
      { headers: BOB_AUTH }
    );
    expect(bobRevokeRes.status()).toBe(404);

    // 5. Alice lists her share links
    const aliceListRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/share`, {
      headers: ALICE_AUTH,
    });
    expect(aliceListRes.status()).toBe(200);
    const links = await aliceListRes.json();
    expect(links.length).toBe(1);
    expect(links[0].token).toBe(link.token);

    // 6. Alice revokes the share link
    const aliceRevokeRes = await request.delete(
      `${API_BASE}/entries/${aliceEntryId}/share/${link.id}`,
      { headers: ALICE_AUTH }
    );
    expect(aliceRevokeRes.status()).toBe(200);

    // 7. Public access is now revoked (returns 404)
    const publicAfterRevoke = await request.get(`${API_BASE}/shared/${link.token}`);
    expect(publicAfterRevoke.status()).toBe(404);
  });

  test('interacts with share modal in browser editor', async ({ page }) => {
    // Navigate to Dev entry
    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]', { timeout: 10000 });

    // Open share modal
    const shareBtn = page.locator('[data-testid="toolbar-share-btn"]');
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // Verify modal is open
    const shareModal = page.locator('[data-testid="share-modal"]');
    await expect(shareModal).toBeVisible();

    // Generate link
    const createBtn = page.locator('[data-testid="create-share-btn"]');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Verify share link input appeared with URL
    const urlInput = page.locator('[data-testid="share-url-input"]');
    await expect(urlInput).toBeVisible();
    const urlValue = await urlInput.inputValue();
    expect(urlValue).toContain('/shared/');

    // Revoke link
    const revokeBtn = page.locator('[data-testid="revoke-share-btn"]');
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.click();

    // Verify link is revoked and empty notice appears
    await expect(page.locator('[data-testid="share-link-item"]')).toHaveCount(0);

    // Close modal
    const closeBtn = page.locator('[data-testid="close-share-btn"]');
    await closeBtn.click();
    await expect(shareModal).not.toBeVisible();
  });

  test('enforces sliding-window per-IP rate limiting on public shared routes with 429 response', async ({
    request,
  }) => {
    // 1. Create a share link for testing
    const shareRes = await request.post(`${API_BASE}/entries/${aliceEntryId}/share`, {
      headers: ALICE_AUTH,
      data: { expiresInDays: 7 },
    });
    expect(shareRes.ok()).toBeTruthy();
    const { token } = await shareRes.json();

    const clientIp = '198.51.100.77';

    // 2. Perform rapid requests under limit
    for (let i = 0; i < 10; i++) {
      const res = await request.get(`${API_BASE}/shared/${token}`, {
        headers: {
          'x-forwarded-for': clientIp,
          'x-test-rate-limit': '10',
        },
      });
      expect(res.status()).toBe(200);
    }

    // 3. 11th request from same IP exceeds rate limit -> returns 429
    const rateLimitedRes = await request.get(`${API_BASE}/shared/${token}`, {
      headers: {
        'x-forwarded-for': clientIp,
        'x-test-rate-limit': '10',
      },
    });
    expect(rateLimitedRes.status()).toBe(429);
    const body = await rateLimitedRes.json();
    expect(body.error).toContain('Rate limit exceeded');

    // 4. Request from a different IP is unaffected
    const otherIpRes = await request.get(`${API_BASE}/shared/${token}`, {
      headers: {
        'x-forwarded-for': '198.51.100.88',
        'x-test-rate-limit': '10',
      },
    });
    expect(otherIpRes.status()).toBe(200);
  });
});
