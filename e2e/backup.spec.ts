import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { cleanOrphanAssets } from '../scripts/clean-orphan-assets.js';
import { restoreSnapshot } from '../scripts/restore-snapshot.js';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { BackupService } from '../apps/api/src/backup/backup-service.js';
import {
  type DocumentEnvelopeV2,
  type TopLevelBlock,
  type EntryManifest,
  type ChunkPayload,
  reassembleDocFromChunks,
  canonicalDocJson,
} from '../packages/doc-model/src/index.js';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';
const AUTH_HEADER = { Authorization: 'Bearer kaaj-local-dev-token' };

// 1x1 transparent PNG base64 fixture
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function findRepoRoot(startDir: string): string {
  let curr = path.resolve(startDir);
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, 'package.json')) && fsSync.existsSync(path.join(curr, 'packages'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

test.describe('Kaaj Step 4 Suite — Hardening & Cloud Backup', () => {
  const repoRoot = findRepoRoot(process.cwd());
  const baseDataDir = path.join(repoRoot, 'data');
  const storageDir = path.join(baseDataDir, 'storage');

  // Test 1: 960 px thumbnail generation and retrieval
  test('1. Image upload generates and serves 960 px WebP thumbnail', async ({ request }) => {
    test.setTimeout(30000);

    const imageBuffer = Buffer.from(VALID_PNG_BASE64, 'base64');
    const uploadRes = await request.post(`${API_BASE}/assets`, {
      headers: AUTH_HEADER,
      multipart: {
        file: {
          name: 'thumb_test_960.png',
          mimeType: 'image/png',
          buffer: imageBuffer,
        },
      },
    });

    expect(uploadRes.ok()).toBeTruthy();
    const { asset } = await uploadRes.json();
    expect(asset.id).toBeTruthy();

    // Fetch 960 px thumbnail
    const thumb960Res = await request.get(`${API_BASE}/assets/${asset.id}/thumb?size=960`, {
      headers: AUTH_HEADER,
    });
    expect(thumb960Res.ok()).toBeTruthy();
    expect(thumb960Res.headers()['content-type']).toBe('image/webp');
    const thumb960Body = await thumb960Res.body();
    expect(thumb960Body.length).toBeGreaterThan(0);

    // Fetch 320 px thumbnail
    const thumb320Res = await request.get(`${API_BASE}/assets/${asset.id}/thumb?size=320`, {
      headers: AUTH_HEADER,
    });
    expect(thumb320Res.ok()).toBeTruthy();
    expect(thumb320Res.headers()['content-type']).toBe('image/webp');
  });

  // Test 2: Chunk cleanup when entry shrinks
  test('2. Unused chunk files are deleted from disk when an entry shrinks', async ({ request }) => {
    test.setTimeout(30000);

    // Create entry with 150 blocks (produces 3 chunks: chunk_0, chunk_1, chunk_2)
    const blocks150: TopLevelBlock[] = Array.from({ length: 150 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `blk_shrink_${i}` },
      content: [{ type: 'text', text: `Paragraph block ${i + 1} before shrink.` }],
    }));

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Chunk Shrink Test Entry',
        doc: {
          schemaVersion: 2,
          doc: { type: 'doc', content: blocks150 },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const entryChunksDir = path.join(baseDataDir, 'entries', created.id, 'chunks');

    try {
      // Verify initial chunks on disk
      expect(fsSync.existsSync(entryChunksDir)).toBe(true);
      const initialChunkFiles = await fs.readdir(entryChunksDir);
      expect(initialChunkFiles.length).toBe(3);

      // Now update entry with only 20 blocks (fits in 1 single chunk)
      const blocks20: TopLevelBlock[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'paragraph',
        attrs: { id: `blk_shrink_after_${i}` },
        content: [{ type: 'text', text: `Shrunk content block ${i + 1}.` }],
      }));

      const updateRes = await request.put(`${API_BASE}/entries/${created.id}`, {
        headers: {
          ...AUTH_HEADER,
          'If-Match': `"${created.version}"`,
        },
        data: {
          title: 'Chunk Shrink Test Entry (Shrunk)',
          doc: {
            schemaVersion: 2,
            doc: { type: 'doc', content: blocks20 },
          },
        },
      });
      expect(updateRes.ok()).toBeTruthy();

      // Verify that stale chunk files were removed from disk
      const afterChunkFiles = await fs.readdir(entryChunksDir);
      expect(afterChunkFiles.length).toBe(1);

      // Verify manifest reflects 1 chunk
      const manifestPath = path.join(baseDataDir, 'entries', created.id, 'manifest.json');
      const rawManifest = await fs.readFile(manifestPath, 'utf8');
      const manifest: EntryManifest = JSON.parse(rawManifest);
      expect(manifest.chunkCount).toBe(1);
      expect(manifest.chunks.length).toBe(1);
    } finally {
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 3: Orphan cleanup script (dry-run vs apply)
  test('3. Orphan asset cleanup dry-run leaves files intact, --apply deletes only unreferenced assets', async () => {
    test.setTimeout(30000);

    // 1. Seed an unreferenced orphan asset
    const orphanId = `asset_orphan_test_${Date.now()}`;
    const orphanFile = `${orphanId}.png`;
    const orphanFilePath = path.join(storageDir, orphanFile);
    const orphanThumbPath = path.join(storageDir, 'thumbs', `${orphanId}_320.webp`);

    await fs.mkdir(path.join(storageDir, 'thumbs'), { recursive: true });
    await fs.writeFile(orphanFilePath, Buffer.from(VALID_PNG_BASE64, 'base64'));
    await fs.writeFile(orphanThumbPath, Buffer.from(VALID_PNG_BASE64, 'base64'));

    // Update meta.json
    const metaPath = path.join(storageDir, 'meta.json');
    let metaRecords: Record<string, any> = {};
    if (fsSync.existsSync(metaPath)) {
      metaRecords = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    }
    metaRecords[orphanId] = {
      id: orphanId,
      storageKey: orphanFile,
      mime: 'image/png',
      bytes: 120,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(metaPath, JSON.stringify(metaRecords, null, 2), 'utf8');

    // 2. Run cleanOrphanAssets with dry-run (apply = false)
    const dryResult = await cleanOrphanAssets(baseDataDir, false);
    expect(dryResult.applied).toBe(false);
    const foundOrphan = dryResult.orphanAssets.find((o) => o.id === orphanId);
    expect(foundOrphan).toBeDefined();

    // Verify files still exist after dry-run
    expect(fsSync.existsSync(orphanFilePath)).toBe(true);
    expect(fsSync.existsSync(orphanThumbPath)).toBe(true);

    // 3. Run cleanOrphanAssets with apply = true
    const applyResult = await cleanOrphanAssets(baseDataDir, true);
    expect(applyResult.applied).toBe(true);
    expect(applyResult.orphanCount).toBeGreaterThanOrEqual(1);

    // Verify orphan files and metadata were deleted
    expect(fsSync.existsSync(orphanFilePath)).toBe(false);
    expect(fsSync.existsSync(orphanThumbPath)).toBe(false);

    const updatedMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    expect(updatedMeta[orphanId]).toBeUndefined();
  });

  // Test 4: Incremental backup and single chunk upload diff
  test('4. Backup runs incrementally: editing one chunk uploads only modified chunk', async ({ request }) => {
    test.setTimeout(45000);

    const backupDir = path.join(repoRoot, 'data', 'test-backup-folder');
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.mkdir(backupDir, { recursive: true });

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(baseDataDir, localTarget);

    // Seed test entry with 100 blocks (2 chunks)
    const blocks: TopLevelBlock[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `blk_inc_${i}` },
      content: [{ type: 'text', text: `Incremental backup test block ${i + 1}.` }],
    }));

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Incremental Backup Test Entry',
        doc: {
          schemaVersion: 2,
          doc: { type: 'doc', content: blocks },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // 1. Initial snapshot
      const firstSnapshot = await backupService.createSnapshot();
      expect(firstSnapshot.uploadedCount).toBeGreaterThan(0);
      expect(firstSnapshot.skippedCount).toBe(0);

      // Verify backup target has files
      const backupFiles = await localTarget.list();
      expect(backupFiles.length).toBeGreaterThanOrEqual(2);

      // 2. Modify only chunk 1 of entry
      const entryChunksDir = path.join(baseDataDir, 'entries', created.id, 'chunks');
      const chunkFiles = await fs.readdir(entryChunksDir);
      expect(chunkFiles.length).toBe(2);

      const targetChunkFile = path.join(entryChunksDir, chunkFiles[1]);
      const chunkData: ChunkPayload = JSON.parse(await fs.readFile(targetChunkFile, 'utf8'));
      chunkData.blocks[0].content = [{ type: 'text', text: 'MODIFIED CHUNK 2 CONTENT FOR DIFF TEST' }];
      await fs.writeFile(targetChunkFile, JSON.stringify(chunkData, null, 2), 'utf8');

      // 3. Second snapshot (incremental)
      const secondSnapshot = await backupService.createSnapshot();
      // Should upload only modified chunk + modified db/manifests, skipping unmodified assets/chunks
      expect(secondSnapshot.skippedCount).toBeGreaterThan(0);
      expect(secondSnapshot.uploadedCount).toBeLessThan(firstSnapshot.uploadedCount);
    } finally {
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  });

  // Test 5: Restore snapshot into clean directory with checksum verification
  test('5. Restore snapshot recovers entry docs into clean directory and verifies checksums', async () => {
    test.setTimeout(45000);

    const backupDir = path.join(repoRoot, 'data', 'test-restore-backup');
    const restoreCleanDir = path.join(repoRoot, 'data', 'test-restore-destination');

    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
    await fs.mkdir(backupDir, { recursive: true });

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(baseDataDir, localTarget);

    // Create a snapshot
    const snapshot = await backupService.createSnapshot({ forceAll: true });
    expect(snapshot.uploadedCount).toBeGreaterThan(0);

    // 1. Attempt restore to non-empty directory without force (should throw error)
    await fs.mkdir(restoreCleanDir, { recursive: true });
    await fs.writeFile(path.join(restoreCleanDir, 'unrelated-file.txt'), 'existing data');

    await expect(restoreSnapshot(localTarget, restoreCleanDir, { force: false })).rejects.toThrow(
      /is not empty/
    );

    // 2. Restore with force flag to overwrite
    const restoreResult = await restoreSnapshot(localTarget, restoreCleanDir, { force: true });
    expect(restoreResult.restoredFiles).toBeGreaterThan(0);
    expect(restoreResult.totalBytes).toBeGreaterThan(0);

    // 3. Verify restored files exist on disk
    expect(fsSync.existsSync(path.join(restoreCleanDir, 'db-store.json'))).toBe(true);

    // Clean up
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
  });

  // Test 6: UI Backup status and trigger interaction
  test('6. UI shows backup status indicator and triggers backup without blocking', async ({
    page,
    request,
  }) => {
    test.setTimeout(45000);

    // Create entry
    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'UI Backup Test Entry',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Open entry
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Locate backup indicator button
      const backupBtn = page.locator('[data-testid="backup-status-indicator"]');
      await expect(backupBtn).toBeVisible({ timeout: 10000 });
      await expect(backupBtn).toContainText(/Backup:/i);

      // Click backup indicator to trigger backup
      await backupBtn.click();
      await expect(backupBtn).toContainText(/Backing up|Backup:/i);

      // Typing continues without any blocking
      await editor.click();
      await page.keyboard.type('Non-blocking editor typing during backup.');
      await expect(editor).toContainText('Non-blocking editor typing during backup.');
    } finally {
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });
});
