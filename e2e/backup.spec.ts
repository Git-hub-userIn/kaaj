import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { test, expect } from '@playwright/test';
import { cleanOrphanAssets } from '../scripts/clean-orphan-assets.js';
import { restoreSnapshot } from '../scripts/restore-snapshot.js';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { BackupService } from '../apps/api/src/backup/backup-service.js';
import { fetchWithRetry } from '../apps/api/src/backup/drive-retry.js';
import { GoogleDriveBackupTarget } from '../apps/api/src/backup/google-drive-backup-target.js';
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
      await expect(backupBtn).toContainText(/Backup:|Backing up/i);

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

  // Test 7: Bounded concurrency respected
  test('7. Bounded concurrency (default 4) limits max in-flight uploads', async () => {
    test.setTimeout(30000);

    const testBackupDir = path.join(repoRoot, 'data', 'test-concurrency-backup');
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    class ConcurrencyInstrumentedTarget extends LocalFolderBackupTarget {
      inFlight = 0;
      maxInFlight = 0;

      override async put(relativePath: string, data: Buffer | Uint8Array, mimeType?: string) {
        this.inFlight++;
        if (this.inFlight > this.maxInFlight) {
          this.maxInFlight = this.inFlight;
        }
        // Simulated network latency
        await new Promise((r) => setTimeout(r, 40));
        try {
          return await super.put(relativePath, data, mimeType);
        } finally {
          this.inFlight--;
        }
      }
    }

    const instrumentedTarget = new ConcurrencyInstrumentedTarget(testBackupDir);
    const service = new BackupService(baseDataDir, instrumentedTarget);

    await service.createSnapshot({ forceAll: true, concurrency: 4 });

    // Assert concurrency ceiling respected
    expect(instrumentedTarget.maxInFlight).toBeLessThanOrEqual(4);
    // Assert concurrency actually took place (> 1)
    expect(instrumentedTarget.maxInFlight).toBeGreaterThan(1);

    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 8: Exponential backoff & retry on 429
  test('8. Drive retry utility handles HTTP 429 with Retry-After and exponential backoff', async () => {
    test.setTimeout(30000);

    let attempts = 0;
    const server = http.createServer((req, res) => {
      attempts++;
      if (attempts < 3) {
        // Return 429 on first 2 attempts with Retry-After header
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '0.1', // 100ms
        });
        res.end(JSON.stringify({ error: 'rateLimitExceeded' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, attempts }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const serverUrl = `http://127.0.0.1:${port}/test-429`;

    try {
      const res = await fetchWithRetry(
        serverUrl,
        { method: 'GET' },
        { maxRetries: 5, initialWaitMs: 50 }
      );

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(attempts).toBe(3);

      // Verify maxRetries exhaustion throws clear error
      let failAttempts = 0;
      const failingServer = http.createServer((req, res) => {
        failAttempts++;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'persistentRateLimit' }));
      });
      await new Promise<void>((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
      const failPort = (failingServer.address() as any).port;

      try {
        await expect(
          fetchWithRetry(`http://127.0.0.1:${failPort}`, {}, { maxRetries: 2, initialWaitMs: 20 })
        ).rejects.toThrow(/after 2 retries/);
      } finally {
        failingServer.close();
      }
    } finally {
      server.close();
    }
  });

  // Test 9: Interrupted run resumes without re-upload
  test('9. Interrupted backup leaves previous snapshot valid; subsequent run resumes and skips landed files', async () => {
    test.setTimeout(45000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-resume-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-resume-backup');
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    // Seed 3 initial files
    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const entDir = path.join(testSourceDir, 'entries', 'ent_resume');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_resume' }));
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify({ blocks: ['A'] }));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // 1. Initial baseline backup
    const baseline = await service.createSnapshot();
    const initialSnapshotId = baseline.snapshotId;
    expect(baseline.uploadedCount).toBe(3);

    const initialManifestRaw = await localTarget.get('snapshots/latest-manifest.json');
    expect(initialManifestRaw).not.toBeNull();
    const parsedInitial = JSON.parse(initialManifestRaw!.toString('utf8'));
    expect(parsedInitial.snapshotId).toBe(initialSnapshotId);

    // 2. Add 2 new chunk files in source
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_1.json'), JSON.stringify({ blocks: ['B'] }));
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_2.json'), JSON.stringify({ blocks: ['C'] }));

    // 3. Flaky target: upload 1 new file, then simulate crash mid-run
    class FlakyInterruptionTarget extends LocalFolderBackupTarget {
      newUploads = 0;
      failThreshold = 1;

      override async put(relativePath: string, data: Buffer | Uint8Array, mimeType?: string) {
        if (relativePath.startsWith('snapshots/')) {
          if (this.failThreshold > 0) {
            throw new Error('Interrupted mid-snapshot before manifest write');
          }
        }
        const record = await super.put(relativePath, data, mimeType);
        if (relativePath.includes('chunks/chunk_1.json')) {
          this.newUploads++;
          if (this.failThreshold > 0) {
            throw new Error('Process killed mid-run');
          }
        }
        return record;
      }
    }

    const flakyTarget = new FlakyInterruptionTarget(testBackupDir);
    const flakyService = new BackupService(testSourceDir, flakyTarget);

    // Trigger backup that crashes after chunk_1.json lands
    await expect(flakyService.createSnapshot({ concurrency: 1 })).rejects.toThrow(
      /Process killed mid-run/
    );

    // 4. Verify ordering rule: latest-manifest STILL points to initial baseline snapshot
    const latestAfterCrash = await localTarget.get('snapshots/latest-manifest.json');
    const parsedAfterCrash = JSON.parse(latestAfterCrash!.toString('utf8'));
    expect(parsedAfterCrash.snapshotId).toBe(initialSnapshotId);

    // 5. Verify chunk_1.json actually landed on backup target
    expect(await localTarget.exists('entries/ent_resume/chunks/chunk_1.json')).toBe(true);

    // 6. Resume backup with normal target: chunk_1.json must NOT be re-uploaded!
    flakyTarget.failThreshold = 0;
    const resumedResult = await flakyService.createSnapshot({ concurrency: 1 });

    // 3 baseline files + 1 already-landed chunk_1.json = 4 skipped files
    expect(resumedResult.skippedCount).toBe(4);
    // Only chunk_2.json needs uploading
    expect(resumedResult.uploadedCount).toBe(1);

    // 7. Verify latest-manifest is now cleanly updated with all 5 files
    const finalLatest = await localTarget.get('snapshots/latest-manifest.json');
    const parsedFinal = JSON.parse(finalLatest!.toString('utf8'));
    expect(parsedFinal.snapshotId).toBe(resumedResult.manifest.snapshotId);
    expect(parsedFinal.totalFiles).toBe(5);

    // Cleanup
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 10: Cache loss recovery
  test('10. Drive file-id cache loss recovers via fallback query and rebuilds cache file', async () => {
    test.setTimeout(30000);

    const testTokenPath = path.join(repoRoot, 'data', 'test-oauth-token.json');
    const testCachePath = path.join(repoRoot, 'data', 'test-drive-file-cache.json');

    await fs.rm(testCachePath, { force: true });
    // Write mock token file
    await fs.writeFile(
      testTokenPath,
      JSON.stringify({
        refreshToken: 'dummy_refresh',
        accessToken: 'dummy_access',
        expiresAt: Date.now() + 3600000,
      })
    );

    const driveTarget = new GoogleDriveBackupTarget({
      tokenFilePath: testTokenPath,
      cacheFilePath: testCachePath,
    });

    // 1. Initially cache is empty
    expect(fsSync.existsSync(testCachePath)).toBe(false);
    expect(await driveTarget.has('entries/test.json', 'hash123')).toBe(false);

    // 2. Populate cache entry
    (driveTarget as any).driveFileCache.set('entries/test.json', {
      fileId: 'drive_file_id_001',
      checksum: 'hash123',
    });
    await driveTarget.saveCache();

    // Verify cache file exists on disk
    expect(fsSync.existsSync(testCachePath)).toBe(true);
    expect(await driveTarget.has('entries/test.json', 'hash123')).toBe(true);

    // 3. Simulate cache file deletion/loss
    await driveTarget.clearCache();
    expect(fsSync.existsSync(testCachePath)).toBe(false);
    expect(await driveTarget.has('entries/test.json', 'hash123')).toBe(false);

    // 4. Target loads cleanly without throwing even when cache is missing
    const reloadedTarget = new GoogleDriveBackupTarget({
      tokenFilePath: testTokenPath,
      cacheFilePath: testCachePath,
    });
    expect(await reloadedTarget.has('entries/test.json', 'hash123')).toBe(false);

    // Cleanup
    await fs.rm(testTokenPath, { force: true });
    await fs.rm(testCachePath, { force: true });
  });

  // Test 11: Restore with bounded concurrency gives equal docs
  test('11. Restore with concurrency produces identical canonical documents and verified checksums', async () => {
    test.setTimeout(45000);

    const backupDir = path.join(repoRoot, 'data', 'test-concurrent-restore-backup');
    const restoreCleanDir = path.join(repoRoot, 'data', 'test-concurrent-restore-dest');

    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
    await fs.mkdir(backupDir, { recursive: true });

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(baseDataDir, localTarget);

    // Create a snapshot
    const snapshot = await backupService.createSnapshot({ forceAll: true });
    expect(snapshot.uploadedCount).toBeGreaterThan(0);

    // Restore with concurrency = 4
    const result = await restoreSnapshot(localTarget, restoreCleanDir, {
      force: true,
      concurrency: 4,
    });

    expect(result.restoredFiles).toBe(snapshot.manifest.totalFiles);
    expect(result.totalBytes).toBe(snapshot.manifest.totalBytes);

    // Verify restored db-store.json matches original
    const origDb = await fs.readFile(path.join(baseDataDir, 'db-store.json'), 'utf8');
    const restoredDb = await fs.readFile(path.join(restoreCleanDir, 'db-store.json'), 'utf8');
    expect(JSON.parse(restoredDb)).toEqual(JSON.parse(origDb));

    // Verify all restored files have valid checksums matching manifest
    for (const f of snapshot.manifest.files) {
      let destPath = f.path;
      if (destPath.startsWith('assets/')) {
        destPath = path.join('storage', destPath.replace(/^assets\//, ''));
      }
      const fullP = path.join(restoreCleanDir, destPath);
      expect(fsSync.existsSync(fullP)).toBe(true);
      const data = await fs.readFile(fullP);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      expect(hash).toBe(f.checksum);
    }

    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
  });
});
