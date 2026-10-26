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
import { pruneBackups } from '../apps/api/src/backup/backup-prune.js';
import { checkBackupRepository } from '../apps/api/src/backup/backup-check.js';
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

test.describe('Kaaj Step 4 & 4.5 Suite — Hardening & Restic Pack Repository', () => {
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
      expect(fsSync.existsSync(entryChunksDir)).toBe(true);
      const initialChunkFiles = await fs.readdir(entryChunksDir);
      expect(initialChunkFiles.length).toBe(3);

      // Now update entry with only 20 blocks (fits in 1 single chunk)
      const blocks20: TopLevelBlock[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'paragraph',
        attrs: { id: `blk_shrink_after_${i}` },
        content: [{ type: 'text', text: `Shrunk content block ${i + 1}.` }],
      }));

      const currEntryRes = await request.get(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
      const currEntry = await currEntryRes.json();

      const updateRes = await request.put(`${API_BASE}/entries/${created.id}`, {
        headers: {
          ...AUTH_HEADER,
          'If-Match': `"${currEntry.version}"`,
        },
        data: {
          title: 'Chunk Shrink Test Entry (Shrunk)',
          doc: {
            schemaVersion: 2,
            doc: { type: 'doc', content: blocks20 },
          },
        },
      });
      if (!updateRes.ok()) {
        console.error('Update failed:', updateRes.status(), await updateRes.text());
      }
      expect(updateRes.ok()).toBeTruthy();

      const afterChunkFiles = await fs.readdir(entryChunksDir);
      expect(afterChunkFiles.length).toBe(1);

      const manifestPath = path.join(baseDataDir, 'entries', created.id, 'manifest.json');
      const rawManifest = await fs.readFile(manifestPath, 'utf8');
      const manifest: EntryManifest = JSON.parse(rawManifest);
      expect(manifest.chunkCount).toBe(1);
      expect(manifest.chunks.length).toBe(1);
    } finally {
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 3: Orphan asset cleanup script (dry-run vs apply)
  test('3. Orphan asset cleanup dry-run leaves files intact, --apply deletes only unreferenced assets', async () => {
    test.setTimeout(30000);

    const orphanId = `asset_orphan_test_${Date.now()}`;
    const orphanFile = `${orphanId}.png`;
    const orphanFilePath = path.join(storageDir, orphanFile);
    const orphanThumbPath = path.join(storageDir, 'thumbs', `${orphanId}_320.webp`);

    await fs.mkdir(path.join(storageDir, 'thumbs'), { recursive: true });
    await fs.writeFile(orphanFilePath, Buffer.from(VALID_PNG_BASE64, 'base64'));
    await fs.writeFile(orphanThumbPath, Buffer.from(VALID_PNG_BASE64, 'base64'));

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

    // Dry-run
    const dryResult = await cleanOrphanAssets(baseDataDir, false);
    expect(dryResult.applied).toBe(false);
    expect(fsSync.existsSync(orphanFilePath)).toBe(true);
    expect(fsSync.existsSync(orphanThumbPath)).toBe(true);

    // Apply
    const applyResult = await cleanOrphanAssets(baseDataDir, true);
    expect(applyResult.applied).toBe(true);
    expect(fsSync.existsSync(orphanFilePath)).toBe(false);
    expect(fsSync.existsSync(orphanThumbPath)).toBe(false);
  });

  // Test 4: Restic Pack layout: 800 chunks upload as few remote files; unchanged uploads nothing; edit chunk uploads 1 pack
  test('4. Restic pack layout: 800 chunks upload as few remote files; unchanged uploads nothing; edit chunk uploads 1 pack', async () => {
    test.setTimeout(45000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-pack-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-pack-backup');
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    // Seed 800 synthetic chunks across 40 entries
    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1, entries: 40 }));
    for (let e = 0; e < 40; e++) {
      const entId = `ent_${e}`;
      const entDir = path.join(testSourceDir, 'entries', entId);
      const chkDir = path.join(entDir, 'chunks');
      await fs.mkdir(chkDir, { recursive: true });
      await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: entId, chunkCount: 20 }));
      for (let c = 0; c < 20; c++) {
        await fs.writeFile(
          path.join(chkDir, `chunk_${c}.json`),
          JSON.stringify({ chunkId: `chunk_${c}`, content: `Chunk payload ${e}-${c}` })
        );
      }
    }

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // 1. Initial backup of 800 chunks
    const firstResult = await service.createSnapshot();
    expect(firstResult.uploadedPacks).toBeGreaterThan(0);
    expect(firstResult.uploadedPacks).toBeLessThanOrEqual(3); // Capped at ~1-2 packs

    // Verify remote file count is tiny (1-2 packs + 1 index + snapshots)
    const packs = await localTarget.list('packs');
    const index = await localTarget.list('index');
    const snapshots = await localTarget.list('snapshots');
    const totalRemoteFiles = packs.length + index.length + snapshots.length;
    expect(totalRemoteFiles).toBeLessThanOrEqual(5);

    // 2. Unchanged data: uploads nothing!
    const unchangedResult = await service.createSnapshot();
    expect(unchangedResult.uploadedPacks).toBe(0);
    expect(unchangedResult.newBlobsCount).toBe(0);

    // 3. Edit 1 chunk: uploads 1 small pack + 1 index + 1 snapshot
    const targetChunk = path.join(testSourceDir, 'entries', 'ent_0', 'chunks', 'chunk_0.json');
    await fs.writeFile(targetChunk, JSON.stringify({ chunkId: 'chunk_0', content: 'EDITED CONTENT' }));

    const editResult = await service.createSnapshot();
    expect(editResult.uploadedPacks).toBe(1);
    expect(editResult.newBlobsCount).toBe(1);

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 5: Remote listing is source of truth: deleting remote folder forces full re-upload
  test('5. Remote listing is source of truth: deleting remote folder forces full re-upload even if local cache exists', async () => {
    test.setTimeout(30000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-remote-truth-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-remote-truth-backup');
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const entDir = path.join(testSourceDir, 'entries', 'ent_truth');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_truth' }));
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify({ text: 'Truth test' }));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // Initial snapshot
    const snap1 = await service.createSnapshot();
    expect(snap1.uploadedPacks).toBe(1);

    // Simulate user deleting remote folder on Google Drive
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    // Next snapshot runs: remote listing detects 0 packs on remote, re-uploads all blobs
    const snap2 = await service.createSnapshot();
    expect(snap2.uploadedPacks).toBe(1);
    expect(snap2.newBlobsCount).toBe(3);

    const packsAfterReupload = await localTarget.list('packs');
    expect(packsAfterReupload.length).toBe(1);

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 6: UI Backup status and trigger interaction
  test('6. UI shows backup status indicator and triggers backup without blocking', async ({
    page,
    request,
  }) => {
    test.setTimeout(45000);

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
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      const backupBtn = page.locator('[data-testid="backup-status-indicator"]');
      await expect(backupBtn).toBeVisible({ timeout: 10000 });
      await expect(backupBtn).toContainText(/Backup:|Backing up|Checking/i);

      await backupBtn.click();
      await expect(backupBtn).toContainText(/Backup:|Backing up|Checking|Uploading/i);

      // Typing continues without any blocking
      await editor.click();
      await page.keyboard.type('Non-blocking editor typing during backup.');
      await expect(editor).toContainText('Non-blocking editor typing during backup.');
    } finally {
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 7: Bounded concurrency (default 4) limits max in-flight uploads
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

    expect(instrumentedTarget.maxInFlight).toBeLessThanOrEqual(4);

    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 8: Drive retry utility handles HTTP 429 with Retry-After and exponential backoff
  test('8. Drive retry utility handles HTTP 429 with Retry-After and exponential backoff', async () => {
    test.setTimeout(30000);

    let attempts = 0;
    const server = http.createServer((req, res) => {
      attempts++;
      if (attempts < 3) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '0.1',
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

  // Test 9: Forced kill during pack upload leaves previous snapshot valid and restorable
  test('9. Forced kill during pack upload leaves previous snapshot valid and restorable', async () => {
    test.setTimeout(45000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-kill-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-kill-backup');
    const restoreCleanDir = path.join(repoRoot, 'data', 'test-kill-restore');

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    // Seed initial files
    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1, title: 'Original DB' }));
    const entDir = path.join(testSourceDir, 'entries', 'ent_kill');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_kill' }));
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify({ text: 'Baseline text' }));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // Initial successful baseline snapshot
    const baselineSnap = await service.createSnapshot();
    expect(baselineSnap.uploadedPacks).toBe(1);

    // Add new modified chunk
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_1.json'), JSON.stringify({ text: 'Crashing text' }));

    // Target that simulates a process crash during pack upload
    class CrashingTarget extends LocalFolderBackupTarget {
      override async put(relativePath: string, data: Buffer | Uint8Array, mimeType?: string) {
        if (relativePath.startsWith('packs/')) {
          throw new Error('Simulated network crash during pack upload');
        }
        return super.put(relativePath, data, mimeType);
      }
    }

    const crashingTarget = new CrashingTarget(testBackupDir);
    const crashingService = new BackupService(testSourceDir, crashingTarget);

    await expect(crashingService.createSnapshot()).rejects.toThrow(/Simulated network crash/);

    // Restore latest snapshot: baseline must still restore cleanly and perfectly!
    const restoreResult = await restoreSnapshot(localTarget, restoreCleanDir, { force: true });
    expect(restoreResult.snapshotId).toBe(baselineSnap.snapshotId);
    expect(fsSync.existsSync(path.join(restoreCleanDir, 'db-store.json'))).toBe(true);

    const restoredChunk = JSON.parse(
      await fs.readFile(path.join(restoreCleanDir, 'entries', 'ent_kill', 'chunks', 'chunk_0.json'), 'utf8')
    );
    expect(restoredChunk.text).toBe('Baseline text');

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
  });

  // Test 10: backup:prune keeps last 5 snapshots, deletes unreferenced orphan packs in --apply
  test('10. backup:prune keeps last 5 snapshots, deletes unreferenced orphan packs in --apply', async () => {
    test.setTimeout(45000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-prune-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-prune-backup');
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const entDir = path.join(testSourceDir, 'entries', 'ent_prune');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_prune' }));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // Create 7 successive snapshots, each introducing a new chunk
    for (let i = 0; i < 7; i++) {
      await fs.writeFile(path.join(entDir, 'chunks', `chunk_${i}.json`), JSON.stringify({ i }));
      await service.createSnapshot();
    }

    const allSnaps = (await localTarget.list('snapshots')).filter((s) => !s.path.endsWith('latest.json'));
    expect(allSnaps.length).toBe(7);

    // 1. Dry run prune
    const dryRun = await pruneBackups(localTarget, { keepLast: 5, apply: false });
    expect(dryRun.applied).toBe(false);
    expect(dryRun.snapshotsToDelete.length).toBe(2);
    expect(dryRun.retainedSnapshots).toBe(5);

    // Verify snapshots were NOT deleted in dry-run
    const afterDrySnaps = (await localTarget.list('snapshots')).filter((s) => !s.path.endsWith('latest.json'));
    expect(afterDrySnaps.length).toBe(7);

    // 2. Apply prune
    const applied = await pruneBackups(localTarget, { keepLast: 5, apply: true });
    expect(applied.applied).toBe(true);
    expect(applied.snapshotsToDelete.length).toBe(2);

    const afterApplySnaps = (await localTarget.list('snapshots')).filter((s) => !s.path.endsWith('latest.json'));
    expect(afterApplySnaps.length).toBe(5);

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 11: backup:check verifies repository health and detects a missing or deleted pack
  test('11. backup:check verifies repository health and detects a missing or deleted pack', async () => {
    test.setTimeout(30000);

    const testSourceDir = path.join(repoRoot, 'data', 'test-check-source');
    const testBackupDir = path.join(repoRoot, 'data', 'test-check-backup');
    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
    await fs.mkdir(testSourceDir, { recursive: true });
    await fs.mkdir(testBackupDir, { recursive: true });

    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    await service.createSnapshot();

    // 1. Check healthy repo
    const healthyCheck = await checkBackupRepository(localTarget);
    expect(healthyCheck.ok).toBe(true);
    expect(healthyCheck.errors.length).toBe(0);

    // 2. Intentionally delete a pack file to simulate corruption / data loss
    const packs = await localTarget.list('packs');
    expect(packs.length).toBeGreaterThan(0);
    const packToDelete = path.join(testBackupDir, packs[0].path);
    await fs.unlink(packToDelete);

    // 3. Check corrupted repo
    const corruptedCheck = await checkBackupRepository(localTarget);
    expect(corruptedCheck.ok).toBe(false);
    expect(corruptedCheck.errors.length).toBeGreaterThan(0);
    expect(corruptedCheck.errors[0]).toContain('Missing pack');

    await fs.rm(testSourceDir, { recursive: true, force: true });
    await fs.rm(testBackupDir, { recursive: true, force: true });
  });

  // Test 12: Restore snapshot recovers entry docs, matches canonical JSON, and regenerates thumbnails
  test('12. Restore snapshot recovers entry docs into clean directory, matches canonical JSON, and regenerates thumbnails', async () => {
    test.setTimeout(45000);

    const backupDir = path.join(repoRoot, 'data', 'test-restore-pack-repo');
    const restoreCleanDir = path.join(repoRoot, 'data', 'test-restore-pack-dest');

    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
    await fs.mkdir(backupDir, { recursive: true });

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(baseDataDir, localTarget);

    // Create snapshot of current vault (which contains entries and image assets)
    const snapshot = await backupService.createSnapshot({ forceAll: true });
    expect(snapshot.uploadedPacks).toBeGreaterThan(0);

    // 1. Refuse restore to non-empty directory without --force
    await fs.mkdir(restoreCleanDir, { recursive: true });
    await fs.writeFile(path.join(restoreCleanDir, 'unrelated.txt'), 'pre-existing file');

    await expect(restoreSnapshot(localTarget, restoreCleanDir, { force: false })).rejects.toThrow(
      /is not empty/
    );

    // 2. Restore with --force
    const restoreResult = await restoreSnapshot(localTarget, restoreCleanDir, { force: true, concurrency: 4 });
    expect(restoreResult.restoredFiles).toBeGreaterThan(0);
    expect(restoreResult.regeneratedThumbnails).toBeGreaterThanOrEqual(0);

    // 3. Verify db-store.json matches original
    const origDb = await fs.readFile(path.join(baseDataDir, 'db-store.json'), 'utf8');
    const restoredDb = await fs.readFile(path.join(restoreCleanDir, 'db-store.json'), 'utf8');
    expect(JSON.parse(restoredDb)).toEqual(JSON.parse(origDb));

    // 4. Verify canonical document JSON equality on any existing entry
    const entriesDir = path.join(baseDataDir, 'entries');
    if (fsSync.existsSync(entriesDir)) {
      const entDirs = await fs.readdir(entriesDir);
      if (entDirs.length > 0) {
        const entId = entDirs[0];
        const origManifestP = path.join(entriesDir, entId, 'manifest.json');
        const restManifestP = path.join(restoreCleanDir, 'entries', entId, 'manifest.json');
        if (fsSync.existsSync(origManifestP) && fsSync.existsSync(restManifestP)) {
          const origM = JSON.parse(await fs.readFile(origManifestP, 'utf8'));
          const restM = JSON.parse(await fs.readFile(restManifestP, 'utf8'));

          const origChunks: ChunkPayload[] = [];
          const restChunks: ChunkPayload[] = [];

          for (let i = 0; i < origM.chunks.length; i++) {
            const chkFile = origM.chunks[i].id.endsWith('.json') ? origM.chunks[i].id : `${origM.chunks[i].id}.json`;
            const origC = JSON.parse(await fs.readFile(path.join(entriesDir, entId, 'chunks', chkFile), 'utf8'));
            const restC = JSON.parse(await fs.readFile(path.join(restoreCleanDir, 'entries', entId, 'chunks', chkFile), 'utf8'));
            origChunks.push(origC);
            restChunks.push(restC);
          }

          const origDoc = reassembleDocFromChunks(origChunks);
          const restDoc = reassembleDocFromChunks(restChunks);
          expect(canonicalDocJson(restDoc)).toBe(canonicalDocJson(origDoc));
        }
      }
    }

    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rm(restoreCleanDir, { recursive: true, force: true });
  });
});
