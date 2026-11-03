import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';
const AUTH_HEADER = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 2: WebSocket Sync & Collaboration Suite', () => {
  let categoryId: string;
  let entryId: string;

  test.beforeAll(async ({ request }) => {
    // Create test category
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: AUTH_HEADER,
      data: {
        title: 'WebSocket Sync Category',
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
        title: 'Collaborative Sync Entry',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Initial collaborative document line.' }],
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

  test('1. Cross-user room connection is rejected with 4403 Forbidden', async () => {
    const wsUrl = `ws://localhost:3001/sync/ws/user-alice:${entryId}?token=user:user-bob`;
    const ws = new WebSocket(wsUrl);

    const closeCode = await new Promise<number>((resolve) => {
      ws.onclose = (event) => resolve(event.code);
      ws.onerror = () => {};
    });

    expect(closeCode).toBe(4403);
  });

  test('2. Two browser contexts for same user reflect typing in < 1 second', async ({ browser }) => {
    test.setTimeout(45000);
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Both contexts open the same entry
      await page1.goto(`${WEB_BASE}/entry/${entryId}`);
      await page2.goto(`${WEB_BASE}/entry/${entryId}`);

      const editor1 = page1.locator('.kaaj-editor-content');
      const editor2 = page2.locator('.kaaj-editor-content');

      await expect(editor1).toBeVisible({ timeout: 15000 });
      await expect(editor2).toBeVisible({ timeout: 15000 });

      // Focus editor 1 and type unique text
      await editor1.click();
      await page1.keyboard.press('End');
      await page1.keyboard.type(' [Peer1-Realtime-Pulse]');

      // Editor 2 must receive and reflect the update in less than 1 second
      await expect(editor2).toContainText('[Peer1-Realtime-Pulse]', { timeout: 1000 });

      // Focus editor 2 and type response
      await editor2.click();
      await page2.keyboard.press('End');
      await page2.keyboard.type(' [Peer2-Instant-Ack]');

      // Editor 1 must reflect peer 2 text in less than 1 second
      await expect(editor1).toContainText('[Peer2-Instant-Ack]', { timeout: 1000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('3. Offline edit in context 1 merges cleanly on reconnect with concurrent online edits in context 2', async ({
    browser,
  }) => {
    test.setTimeout(45000);
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await page1.goto(`${WEB_BASE}/entry/${entryId}`);
      await page2.goto(`${WEB_BASE}/entry/${entryId}`);

      const editor1 = page1.locator('.kaaj-editor-content');
      const editor2 = page2.locator('.kaaj-editor-content');

      await expect(editor1).toBeVisible({ timeout: 15000 });
      await expect(editor2).toBeVisible({ timeout: 15000 });

      // Disconnect context 1 (offline simulation)
      await context1.setOffline(true);

      // Verify save badge switches to Offline
      const saveStatus1 = page1.locator('[data-testid="save-status-text"]');
      await expect(saveStatus1).toContainText('Offline', { timeout: 5000 });

      // Edit in context 1 while offline
      await editor1.click();
      await page1.keyboard.press('End');
      await page1.keyboard.type(' [Offline-Chunk-Alpha]');

      // Edit in context 2 concurrently while online
      await editor2.click();
      await page2.keyboard.press('End');
      await page2.keyboard.type(' [Online-Chunk-Beta]');

      // Verify context 1 does not have context 2's edits yet (since offline)
      expect(await editor1.innerText()).not.toContain('[Online-Chunk-Beta]');

      // Bring context 1 back online
      await context1.setOffline(false);

      // Both editors must merge without conflicts
      await expect(editor1).toContainText('[Online-Chunk-Beta]', { timeout: 8000 });
      await expect(editor2).toContainText('[Offline-Chunk-Alpha]', { timeout: 8000 });

      // Save badge updates back to Saved
      await expect(saveStatus1).toContainText('Saved', { timeout: 8000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('4. In-memory Y.Doc persists to database chunks and manifest after debounced flush', async ({
    page,
    request,
  }) => {
    test.setTimeout(30000);
    await page.goto(`${WEB_BASE}/entry/${entryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' [Debounced-Persist-Commit]');

    // Wait for debounced flush (> 1.5s) and verify save status
    const saveStatus = page.locator('[data-testid="save-status-text"]');
    await expect(saveStatus).toContainText('Saved', { timeout: 5000 });

    // Verify database chunks and manifest reflect the updated text
    await page.waitForTimeout(2000);
    const dbRes = await request.get(`${API_BASE}/entries/${entryId}`, {
      headers: AUTH_HEADER,
    });
    expect(dbRes.ok()).toBeTruthy();
    const entryData = await dbRes.json();
    const serializedDoc = JSON.stringify(entryData.doc);
    expect(serializedDoc).toContain('Debounced-Persist-Commit');

    const manifestRes = await request.get(`${API_BASE}/entries/${entryId}/manifest`, {
      headers: AUTH_HEADER,
    });
    expect(manifestRes.ok()).toBeTruthy();
    const manifest = await manifestRes.json();
    expect(manifest.chunks?.length).toBeGreaterThan(0);
  });
});
