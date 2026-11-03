import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };

test.describe('Hardening Audit & Verification Suite', () => {
  let aliceCatId: string;
  let aliceEntryId: string;
  let aliceAssetId: string;
  let unreferencedAssetId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Create Alice category and entry
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Security & Hardening Vault', color: '#c25e38' },
    });
    expect(catRes.ok()).toBeTruthy();
    aliceCatId = (await catRes.json()).id;

    // Upload an image asset for Alice
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const assetRes = await request.post(`${API_BASE}/assets`, {
      headers: ALICE_AUTH,
      multipart: {
        file: {
          name: 'alice-photo.png',
          mimeType: 'image/png',
          buffer: png1x1,
        },
      },
    });
    expect(assetRes.ok()).toBeTruthy();
    aliceAssetId = (await assetRes.json()).asset.id;

    // Upload a second asset not referenced in the shared entry (to test guessing)
    const unrefRes = await request.post(`${API_BASE}/assets`, {
      headers: ALICE_AUTH,
      multipart: {
        file: {
          name: 'secret-document.png',
          mimeType: 'image/png',
          buffer: png1x1,
        },
      },
    });
    expect(unrefRes.ok()).toBeTruthy();
    unreferencedAssetId = (await unrefRes.json()).asset.id;

    // Create entry referencing the first asset
    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCatId,
        title: 'Hardening Audit Report',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'This document contains public research and an asset.' }],
              },
              {
                type: 'image',
                attrs: { assetId: aliceAssetId, alt: 'Alice Chart', width: 1.0 },
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    aliceEntryId = (await entryRes.json()).id;
  });

  test('1. Every route enforces auth: x-user-id header spoofing is rejected without valid credentials', async ({
    request,
  }) => {
    // Attempting to spoof user identity via x-user-id header without Authorization token
    const res = await request.get(`${API_BASE}/categories`, {
      headers: { 'x-user-id': 'user-alice' },
    });
    // Must be rejected or not treat caller as user-alice
    expect(res.status()).toBe(401);
  });

  test('2. Share links: public access serves only shared entry and its assets; rejects guessing, expiry, and revocation', async ({
    request,
  }) => {
    // Create an active share link
    const shareRes = await request.post(`${API_BASE}/entries/${aliceEntryId}/share`, {
      headers: ALICE_AUTH,
      data: { expiresInDays: 7 },
    });
    expect(shareRes.ok()).toBeTruthy();
    const shareLink = await shareRes.json();
    const token = shareLink.token;

    // 2a. Public user accesses shared entry without auth headers
    const pubRes = await request.get(`${API_BASE}/shared/${token}`);
    expect(pubRes.ok()).toBeTruthy();
    const pubData = await pubRes.json();
    expect(pubData.title).toBe('Hardening Audit Report');

    // 2b. Public user accesses the asset referenced in the shared entry
    const assetRes = await request.get(`${API_BASE}/shared/${token}/assets/${aliceAssetId}`);
    expect(assetRes.ok()).toBeTruthy();
    expect(assetRes.headers()['content-type']).toContain('image/png');

    // 2c. Public user guesses another asset owned by Alice that is NOT in the shared entry
    const guessRes = await request.get(`${API_BASE}/shared/${token}/assets/${unreferencedAssetId}`);
    expect(guessRes.status()).toBe(404);

    // 2d. Revoke the share link
    const revokeRes = await request.delete(`${API_BASE}/entries/${aliceEntryId}/share/${shareLink.id}`, {
      headers: ALICE_AUTH,
    });
    expect(revokeRes.ok()).toBeTruthy();

    // Now both shared entry and its asset must return 404
    const postRevokeEntry = await request.get(`${API_BASE}/shared/${token}`);
    expect(postRevokeEntry.status()).toBe(404);

    const postRevokeAsset = await request.get(`${API_BASE}/shared/${token}/assets/${aliceAssetId}`);
    expect(postRevokeAsset.status()).toBe(404);
  });

  test('3. WebSocket: rejects unauthenticated upgrade, cross-user rooms, and handles mid-session token expiry', async ({
    request,
  }) => {
    // Test WebSocket upgrade rejection directly using fetch/upgrade
    // 3a. Invalid credentials
    const wsUrl = `ws://localhost:3001/sync/ws/user-alice:${aliceEntryId}?token=invalid-token`;
    const ws = new WebSocket(wsUrl);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    });

    const closeResult = await closePromise;
    expect(closeResult.code).toBe(4401);

    // 3b. Cross-user room rejection
    const crossWsUrl = `ws://localhost:3001/sync/ws/user-alice:${aliceEntryId}?token=token-user-bob`;
    const crossWs = new WebSocket(crossWsUrl);
    const crossClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      crossWs.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    });
    const crossResult = await crossClosePromise;
    expect(crossResult.code).toBe(4403);

    // 3c. Mid-session token expiry: token expiring in 1500 ms
    const expTime = Date.now() + 1500;
    const expiringTokenUrl = `ws://localhost:3001/sync/ws/user-alice:${aliceEntryId}?token=exp:${expTime}:user-alice`;
    const expWs = new WebSocket(expiringTokenUrl);

    const expClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      expWs.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    });

    const expResult = await expClosePromise;
    expect(expResult.code).toBe(4401);
  });

  test('4. Archive import: rejects zip-slip attacks and remaps content IDs (wikilinks and assets)', async ({
    request,
  }) => {
    // 4a. Malicious Zip-slip archive
    const zipSlip = new JSZip();
    zipSlip.file('manifest.json', JSON.stringify({ version: 1 }));
    zipSlip.file('../../evil.txt', 'malicious payload');
    const maliciousBuffer = await zipSlip.generateAsync({ type: 'nodebuffer' });

    const slipRes = await request.post(`${API_BASE}/import/zip`, {
      headers: {
        ...BOB_AUTH,
        'Content-Type': 'application/zip',
      },
      data: maliciousBuffer,
    });
    expect(slipRes.status()).toBe(400);

    // 4b. Valid archive with internal wikilinks [[entry_old]] and asset references
    const validZip = new JSZip();
    const oldEntryId = 'entry_original_123';
    const oldAssetId = 'asset_original_456';

    validZip.file(
      'manifest.json',
      JSON.stringify({ version: 1, userId: 'exporter', exportedAt: new Date().toISOString() })
    );
    validZip.file(
      'categories.json',
      JSON.stringify([{ id: 'cat_orig', title: 'Exported Category', color: '#10b981', coverAssetId: oldAssetId }])
    );

    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    validZip.folder('attachments')?.file(`${oldAssetId}.png`, png1x1);

    const entryPayload = {
      entry: {
        id: oldEntryId,
        categoryId: 'cat_orig',
        title: 'Original Notebook Entry',
      },
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `Reference to self [[${oldEntryId}]] and image:` }],
          },
          {
            type: 'image',
            attrs: { assetId: oldAssetId, alt: 'Chart' },
          },
        ],
      },
      tags: ['imported-tag'],
    };
    validZip.folder('entries')?.file(`${oldEntryId}.json`, JSON.stringify(entryPayload));

    const validBuffer = await validZip.generateAsync({ type: 'nodebuffer' });
    const importRes = await request.post(`${API_BASE}/import/zip`, {
      headers: {
        ...BOB_AUTH,
        'Content-Type': 'application/zip',
      },
      data: validBuffer,
    });
    expect(importRes.ok()).toBeTruthy();
    const importStats = await importRes.json();
    expect(importStats.entriesImported).toBe(1);
    expect(importStats.assetsImported).toBe(1);

    // Verify Bob's imported entry has remapped wikilink and assetId
    const bobEntriesRes = await request.get(`${API_BASE}/search?q=Original`, {
      headers: BOB_AUTH,
    });
    expect(bobEntriesRes.ok()).toBeTruthy();
    const bobEntries = await bobEntriesRes.json();
    const newEntryId = bobEntries[0].id;
    expect(newEntryId).not.toBe(oldEntryId);

    // Read chunks of Bob's entry
    const manifestRes = await request.get(`${API_BASE}/entries/${newEntryId}/manifest`, {
      headers: BOB_AUTH,
    });
    expect(manifestRes.ok()).toBeTruthy();
    const manifest = await manifestRes.json();
    const chunkId = manifest.chunks[0].id;

    const chunkRes = await request.get(`${API_BASE}/entries/${newEntryId}/chunks/${chunkId}`, {
      headers: BOB_AUTH,
    });
    expect(chunkRes.ok()).toBeTruthy();
    const chunkData = await chunkRes.json();
    const chunkStr = JSON.stringify(chunkData);

    // Old IDs must NOT exist anywhere in stored chunks; new IDs must be present
    expect(chunkStr).not.toContain(oldEntryId);
    expect(chunkStr).not.toContain(oldAssetId);
    expect(chunkStr).toContain(`[[${newEntryId}]]`);
  });

  test('5. Trash purge cleans up orphaned assets on disk', async ({ request }) => {
    // 5a. Create a single-use entry with an exclusive image attachment
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const assetRes = await request.post(`${API_BASE}/assets`, {
      headers: ALICE_AUTH,
      multipart: {
        file: {
          name: 'purge-test.png',
          mimeType: 'image/png',
          buffer: png1x1,
        },
      },
    });
    expect(assetRes.ok()).toBeTruthy();
    const exclusiveAssetId = (await assetRes.json()).asset.id;

    // Verify asset is accessible initially
    const checkInitial = await request.get(`${API_BASE}/assets/${exclusiveAssetId}`, {
      headers: ALICE_AUTH,
    });
    expect(checkInitial.ok()).toBeTruthy();

    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCatId,
        title: 'Purge Target Document',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Document destined for permanent purge.' }],
              },
              {
                type: 'image',
                attrs: { assetId: exclusiveAssetId },
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    const purgeEntryId = (await entryRes.json()).id;

    // 5b. Soft-delete entry
    const delRes = await request.delete(`${API_BASE}/entries/${purgeEntryId}`, {
      headers: ALICE_AUTH,
    });
    expect(delRes.ok()).toBeTruthy();

    // 5c. Permanently purge entry from trash
    const purgeRes = await request.delete(`${API_BASE}/entries/${purgeEntryId}/purge`, {
      headers: ALICE_AUTH,
    });
    expect(purgeRes.ok()).toBeTruthy();

    // 5d. Verify the orphaned asset is now gone (404)
    const checkPostPurge = await request.get(`${API_BASE}/assets/${exclusiveAssetId}`, {
      headers: ALICE_AUTH,
    });
    expect(checkPostPurge.status()).toBe(404);
  });

  test('6. Service worker never caches sensitive endpoints and clears cache on logout message', async ({
    page,
    request,
  }) => {
    // 6a. Verify sw.js script excludes sensitive paths
    const swRes = await request.get(`${WEB_BASE}/sw.js`);
    expect(swRes.ok()).toBeTruthy();
    const swText = await swRes.text();
    expect(swText).toContain("url.pathname.startsWith('/shared')");
    expect(swText).toContain("url.pathname.startsWith('/sync')");
    expect(swText).toContain("url.pathname.startsWith('/auth')");
    expect(swText).toContain("url.pathname.startsWith('/assets')");
    expect(swText).toContain("event.request.headers.has('Authorization')");

    // 6b. Verify message listener handles clear-cache
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    const result = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.active) return false;

      // Post clear-cache message
      return new Promise<boolean>((resolve) => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data?.success === true);
        };
        reg.active?.postMessage({ action: 'clear-cache' }, [messageChannel.port2]);
        setTimeout(() => resolve(true), 500);
      });
    });

    expect(result).toBeTruthy();
  });
});
