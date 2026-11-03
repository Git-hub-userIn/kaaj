import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'http://localhost:3001';

const ALICE_AUTH = { Authorization: 'Bearer user:user-alice' };
const BOB_AUTH = { Authorization: 'Bearer user:user-bob' };

function findRepoRoot(startDir: string): string {
  let curr = path.resolve(startDir);
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'package.json')) && fs.existsSync(path.join(curr, 'packages'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

// 1x1 transparent PNG fixture
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test.describe('Phase 1: User Isolation E2E Suite', () => {
  let aliceCategoryId: string;
  let aliceEntryId: string;
  let aliceChunkId: string;
  let aliceAssetId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Create a category for Alice
    const catRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: {
        title: 'Alice Secret Project',
        color: '#ff3366',
      },
    });
    expect(catRes.ok()).toBeTruthy();
    const catData = await catRes.json();
    aliceCategoryId = catData.id;
    expect(aliceCategoryId).toBeTruthy();

    // 2. Create an entry for Alice
    const entryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCategoryId,
        title: 'Alice Confidential Doc',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Alice Private Content' }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Sensitive information strictly for Alice.' }],
              },
            ],
          },
        },
      },
    });
    expect(entryRes.ok()).toBeTruthy();
    const entryData = await entryRes.json();
    aliceEntryId = entryData.id;
    expect(aliceEntryId).toBeTruthy();

    // 3. Update entry via raw SQL hot-path (PUT /entries/:id)
    const updateRes = await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
      data: {
        expectedVersion: entryData.version ?? 1,
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Alice Private Content Updated' }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Updated version through raw SQL hot-path.' }],
              },
            ],
          },
        },
      },
    });
    expect(updateRes.ok()).toBeTruthy();

    // 4. Fetch manifest to obtain chunkId
    const manifestRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/manifest`, {
      headers: ALICE_AUTH,
    });
    expect(manifestRes.ok()).toBeTruthy();
    const manifestData = await manifestRes.json();
    expect(manifestData.chunks?.length).toBeGreaterThan(0);
    aliceChunkId = manifestData.chunks[0].id;
    expect(aliceChunkId).toBeTruthy();

    // 5. Update chunk via raw SQL hot-path
    const chunkUpdateRes = await request.put(
      `${API_BASE}/entries/${aliceEntryId}/chunks/${aliceChunkId}`,
      {
        headers: ALICE_AUTH,
        data: {
          blocks: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Updated Heading in Chunk' }],
            },
          ],
        },
      }
    );
    expect(chunkUpdateRes.ok()).toBeTruthy();

    // 6. Upload an asset for Alice
    const uploadRes = await request.post(`${API_BASE}/assets`, {
      headers: ALICE_AUTH,
      multipart: {
        file: {
          name: 'alice-evidence.png',
          mimeType: 'image/png',
          buffer: Buffer.from(VALID_PNG_BASE64, 'base64'),
        },
      },
    });
    expect(uploadRes.ok()).toBeTruthy();
    const uploadData = await uploadRes.json();
    aliceAssetId = uploadData.asset.id;
    expect(aliceAssetId).toBeTruthy();
  });

  // --- Category Isolation Tests ---

  test('Bob GET /categories does not list Alice category', async ({ request }) => {
    const res = await request.get(`${API_BASE}/categories`, {
      headers: BOB_AUTH,
    });
    expect(res.ok()).toBeTruthy();
    const categories = await res.json();
    const found = categories.find((c: any) => c.id === aliceCategoryId);
    expect(found).toBeUndefined();
  });

  test('Bob GET /categories/:id returns 404 for Alice category', async ({ request }) => {
    const res = await request.get(`${API_BASE}/categories/${aliceCategoryId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob GET /categories/:id/stats returns 404 for Alice category', async ({ request }) => {
    const res = await request.get(`${API_BASE}/categories/${aliceCategoryId}/stats`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob GET /categories/:id/entries returns 404 for Alice category', async ({ request }) => {
    const res = await request.get(`${API_BASE}/categories/${aliceCategoryId}/entries`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob PATCH /categories/:id returns 404 for Alice category', async ({ request }) => {
    const res = await request.patch(`${API_BASE}/categories/${aliceCategoryId}`, {
      headers: BOB_AUTH,
      data: { title: 'Compromised by Bob' },
    });
    expect(res.status()).toBe(404);
  });

  test('Bob DELETE /categories/:id returns 404 for Alice category', async ({ request }) => {
    const res = await request.delete(`${API_BASE}/categories/${aliceCategoryId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob POST /categories/:id/restore returns 404 for Alice category', async ({ request }) => {
    const res = await request.post(`${API_BASE}/categories/${aliceCategoryId}/restore`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  // --- Entry Isolation Tests ---

  test('Bob POST /entries referencing Alice categoryId returns 404', async ({ request }) => {
    const res = await request.post(`${API_BASE}/entries`, {
      headers: BOB_AUTH,
      data: {
        categoryId: aliceCategoryId,
        title: 'Bob Trojan Entry',
      },
    });
    expect(res.status()).toBe(404);
  });

  test('Bob GET /entries/:id returns 404 for Alice entry', async ({ request }) => {
    const res = await request.get(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob PATCH /entries/:id returns 404 for Alice entry', async ({ request }) => {
    const res = await request.patch(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: BOB_AUTH,
      data: { title: 'Compromised Title' },
    });
    expect(res.status()).toBe(404);
  });

  test('Bob PUT /entries/:id (raw SQL hot path) returns 404 for Alice entry', async ({ request }) => {
    const res = await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: BOB_AUTH,
      data: {
        expectedVersion: 1,
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bob overwrite' }] }],
          },
        },
      },
    });
    expect(res.status()).toBe(404);
  });

  test('Bob DELETE /entries/:id returns 404 for Alice entry', async ({ request }) => {
    const res = await request.delete(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob POST /entries/:id/restore returns 404 for Alice entry', async ({ request }) => {
    const res = await request.post(`${API_BASE}/entries/${aliceEntryId}/restore`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  // --- Chunks & Manifest Isolation Tests (Raw SQL / Hot Path) ---

  test('Bob GET /entries/:id/manifest returns 404 for Alice entry', async ({ request }) => {
    const res = await request.get(`${API_BASE}/entries/${aliceEntryId}/manifest`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob GET /entries/:id/chunks/:chunkId returns 404 for Alice entry chunk', async ({ request }) => {
    const res = await request.get(`${API_BASE}/entries/${aliceEntryId}/chunks/${aliceChunkId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob PUT /entries/:id/chunks/:chunkId returns 404 for Alice entry chunk', async ({ request }) => {
    const res = await request.put(`${API_BASE}/entries/${aliceEntryId}/chunks/${aliceChunkId}`, {
      headers: BOB_AUTH,
      data: {
        blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hacked chunk' }] }],
      },
    });
    expect(res.status()).toBe(404);
  });

  // --- Asset Storage & Quota Isolation Tests ---

  test('Alice asset is written to vault/user-alice/ directory on disk', () => {
    const root = findRepoRoot(process.cwd());
    const vaultPath = path.resolve(root, 'data/vault/user-alice', `${aliceAssetId}.png`);
    expect(fs.existsSync(vaultPath)).toBe(true);
  });

  test('Bob GET /assets/:id returns 404 for Alice asset', async ({ request }) => {
    const res = await request.get(`${API_BASE}/assets/${aliceAssetId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Bob GET /assets/:id/thumb returns 404 for Alice asset thumbnail', async ({ request }) => {
    const res = await request.get(`${API_BASE}/assets/${aliceAssetId}/thumb`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('Single file upload exceeding 20 MB returns 413 Payload Too Large', async ({ request }) => {
    const largeBuffer = Buffer.alloc(21 * 1024 * 1024, 0); // 21 MB
    const res = await request.post(`${API_BASE}/assets`, {
      headers: BOB_AUTH,
      multipart: {
        file: {
          name: 'too-large.bin',
          mimeType: 'application/octet-stream',
          buffer: largeBuffer,
        },
      },
    });
    expect(res.status()).toBe(413);
  });

  // --- PDF Export Asset Ownership Check ---

  test('Bob POST /export/pdf referencing Alice asset returns 403 Forbidden', async ({ request }) => {
    const res = await request.post(`${API_BASE}/export/pdf`, {
      headers: BOB_AUTH,
      data: {
        htmlContent: `<html><body><h1>Bob trying to leak Alice image</h1><img src="/assets/${aliceAssetId}" /></body></html>`,
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Unauthorized asset access');
  });

  test('Alice POST /export/pdf referencing her own asset succeeds', async ({ request }) => {
    const res = await request.post(`${API_BASE}/export/pdf`, {
      headers: ALICE_AUTH,
      data: {
        htmlContent: `<html><body><h1>Alice Export</h1><img src="/assets/${aliceAssetId}" /></body></html>`,
      },
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('application/pdf');
  });

  // --- Backup Status Isolation ---

  test('Bob GET /backup/status returns isolated state without Alice backup data', async ({ request }) => {
    const res = await request.get(`${API_BASE}/backup/status`, {
      headers: BOB_AUTH,
    });
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('target');
    expect(status.lastBackupTime).toBeNull();
  });
});
