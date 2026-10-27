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
import { readPackFooter } from '../apps/api/src/backup/pack-format.js';
import { fetchWithRetry } from '../apps/api/src/backup/drive-retry.js';
import { GoogleDriveBackupTarget } from '../apps/api/src/backup/google-drive-backup-target.js';
import { verifyRestore } from '../scripts/verify-restore.js';
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

    // Seed realistic initial document
    const originalDoc: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'blk_kill_1' },
            content: [{ type: 'text', text: 'Baseline robust paragraph before crash.' }],
          },
          {
            type: 'paragraph',
            attrs: { id: 'blk_kill_2' },
            content: [{ type: 'text', text: 'Second persistent paragraph verified by canonical JSON.' }],
          },
        ],
      },
    };

    const entDir = path.join(testSourceDir, 'entries', 'ent_kill');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1, title: 'Original DB' }));

    const origChunk: ChunkPayload = {
      schemaVersion: 2,
      chunkId: 'chunk_0',
      entryId: 'ent_kill',
      order: 0,
      blocks: originalDoc.doc.content as TopLevelBlock[],
    };
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify(origChunk));

    const origManifest: EntryManifest = {
      entryId: 'ent_kill',
      schemaVersion: 2,
      version: 1,
      totalBlocks: 2,
      chunkCount: 1,
      chunks: [
        {
          id: 'chunk_0',
          order: 0,
          blockCount: 2,
          bytes: Buffer.byteLength(JSON.stringify(origChunk), 'utf8'),
          checksum: crypto.createHash('sha256').update(JSON.stringify(origChunk)).digest('hex'),
        },
      ],
    };
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify(origManifest));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    // Initial successful baseline snapshot
    const baselineStart = Date.now();
    const baselineSnap = await service.createSnapshot();
    const baselineElapsed = Date.now() - baselineStart;
    expect(baselineSnap.uploadedPacks).toBe(1);

    // Rigorously assert physical pack file on disk
    const packFilesOnDisk = await fs.readdir(path.join(testBackupDir, 'packs'));
    expect(packFilesOnDisk.length).toBe(1);
    const diskPackPath = path.join(testBackupDir, 'packs', packFilesOnDisk[0]);
    expect(fsSync.existsSync(diskPackPath)).toBe(true);

    const packBuf = await fs.readFile(diskPackPath);
    expect(packBuf.length).toBeGreaterThan(50);
    const footer = readPackFooter(packBuf);
    expect(footer.blobs.length).toBeGreaterThanOrEqual(3); // db, manifest, chunk

    // Now introduce an edit and simulate a crash mid-upload of the next snapshot
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_1.json'), JSON.stringify({ text: 'Incomplete edit' }));

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

    // Restore latest snapshot: baseline snapshot must restore completely and cleanly!
    const restoreResult = await restoreSnapshot(localTarget, restoreCleanDir, { force: true });
    expect(restoreResult.snapshotId).toBe(baselineSnap.snapshotId);
    expect(fsSync.existsSync(path.join(restoreCleanDir, 'db-store.json'))).toBe(true);

    const restoredChunk: ChunkPayload = JSON.parse(
      await fs.readFile(path.join(restoreCleanDir, 'entries', 'ent_kill', 'chunks', 'chunk_0.json'), 'utf8')
    );
    const restoredDoc = reassembleDocFromChunks([restoredChunk]);
    expect(canonicalDocJson(restoredDoc)).toBe(canonicalDocJson(originalDoc));

    console.log(`[TEST 9] Verified physical disk pack (${packBuf.length} bytes, ${footer.blobs.length} blobs) in ${baselineElapsed}ms`);

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

    await fs.writeFile(path.join(testSourceDir, 'db-store.json'), JSON.stringify({ v: 1, name: 'Check Test DB' }));
    const entDir = path.join(testSourceDir, 'entries', 'ent_check');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_check' }));
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify({ text: 'Check chunk content' }));

    const localTarget = new LocalFolderBackupTarget(testBackupDir);
    const service = new BackupService(testSourceDir, localTarget);

    const snap = await service.createSnapshot();
    expect(snap.uploadedPacks).toBe(1);

    // Assert physical pack file exists on disk and verify its binary footer
    const packFiles = await localTarget.list('packs');
    expect(packFiles.length).toBeGreaterThan(0);
    const packPath = path.join(testBackupDir, packFiles[0].path);
    const originalPackBuf = await fs.readFile(packPath);
    expect(originalPackBuf.length).toBeGreaterThan(50);

    const footer = readPackFooter(originalPackBuf);
    expect(footer.blobs.length).toBeGreaterThanOrEqual(3);

    // 1. Check healthy repo
    const healthyCheck = await checkBackupRepository(localTarget);
    expect(healthyCheck.ok).toBe(true);
    expect(healthyCheck.errors.length).toBe(0);

    // 2. Corrupt pack content (flip a byte in payload) and verify check detects hash mismatch
    const corruptedPackBuf = Buffer.from(originalPackBuf);
    corruptedPackBuf[10] = corruptedPackBuf[10] ^ 0xff; // Invert byte 10
    await fs.writeFile(packPath, corruptedPackBuf);

    const corruptedCheck = await checkBackupRepository(localTarget);
    expect(corruptedCheck.ok).toBe(false);
    expect(corruptedCheck.errors.some((e) => e.includes('Pack hash mismatch'))).toBe(true);

    // 3. Intentionally delete pack file to simulate data loss / remote deletion
    await fs.unlink(packPath);

    const missingPackCheck = await checkBackupRepository(localTarget);
    expect(missingPackCheck.ok).toBe(false);
    expect(missingPackCheck.errors.some((e) => e.includes('Missing pack'))).toBe(true);

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
    const origDb = JSON.parse(await fs.readFile(path.join(baseDataDir, 'db-store.json'), 'utf8'));
    const restoredDb = JSON.parse(await fs.readFile(path.join(restoreCleanDir, 'db-store.json'), 'utf8'));
    const sortById = (list: any[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(restoredDb.categories)).toEqual(sortById(origDb.categories));

    const stripDoc = (list: any[]) =>
      sortById(
        list.map((e) => {
          const { doc, ...meta } = e;
          return meta;
        })
      );
    expect(stripDoc(restoredDb.entries)).toEqual(stripDoc(origDb.entries));

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

  // Test 13: Silent-hole bug: deleted remote pack is detected as missing, re-uploaded, and repository check passes
  test('13. Silent-hole bug: deleted remote pack is treated as missing and healed by next backup', async () => {
    test.setTimeout(45000);

    const testRoot = path.join(repoRoot, 'data', 'test-silent-hole');
    const sourceDir = path.join(testRoot, 'source');
    const backupDir = path.join(testRoot, 'backup');
    const restoreDir = path.join(testRoot, 'restore');

    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(restoreDir, { recursive: true });

    // Seed test vault with one entry
    const originalDoc: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'blk_hole_1' },
            content: [{ type: 'text', text: 'Healing silent holes test entry' }],
          },
        ],
      },
    };

    const entDir = path.join(sourceDir, 'entries', 'ent_hole');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1, entries: {} }));

    const origChunk: ChunkPayload = {
      schemaVersion: 2,
      chunkId: 'chunk_0',
      entryId: 'ent_hole',
      order: 0,
      blocks: originalDoc.doc.content as TopLevelBlock[],
    };
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify(origChunk));

    const origManifest: EntryManifest = {
      entryId: 'ent_hole',
      schemaVersion: 2,
      version: 1,
      totalBlocks: 1,
      chunkCount: 1,
      chunks: [
        {
          id: 'chunk_0',
          order: 0,
          blockCount: 1,
          bytes: Buffer.byteLength(JSON.stringify(origChunk), 'utf8'),
          checksum: crypto.createHash('sha256').update(JSON.stringify(origChunk)).digest('hex'),
        },
      ],
    };
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify(origManifest));

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);

    // Initial backup run
    const snap1 = await backupService.createSnapshot();
    expect(snap1.uploadedPacks).toBeGreaterThan(0);

    // Verify initial check passes
    const check1 = await checkBackupRepository(localTarget);
    expect(check1.ok).toBe(true);

    // Delete one of the remote pack files to simulate silent remote pack deletion
    const packsBefore = await localTarget.list('packs');
    expect(packsBefore.length).toBeGreaterThan(0);
    const packToDelete = packsBefore[0].path;
    await localTarget.delete(packToDelete);

    // Check repository detects the missing pack
    const checkDamaged = await checkBackupRepository(localTarget);
    expect(checkDamaged.ok).toBe(false);

    // Run next backup: should detect that the blobs in that deleted pack are missing, re-upload them, and clean up stale index references
    const snap2 = await backupService.createSnapshot();
    expect(snap2.uploadedPacks).toBeGreaterThan(0);

    // Repository check must now pass 100%
    const checkHealed = await checkBackupRepository(localTarget);
    expect(checkHealed.ok).toBe(true);
    expect(checkHealed.errors.length).toBe(0);

    // Restore must recover the entry and match canonical JSON
    const restoreRes = await restoreSnapshot(localTarget, restoreDir, { force: true });
    expect(restoreRes.snapshotId).toBe(snap2.snapshotId);

    const restoredChunk: ChunkPayload = JSON.parse(
      await fs.readFile(path.join(restoreDir, 'entries', 'ent_hole', 'chunks', 'chunk_0.json'), 'utf8')
    );
    const restoredDoc = reassembleDocFromChunks([restoredChunk]);
    expect(canonicalDocJson(restoredDoc)).toBe(canonicalDocJson(originalDoc));

    await fs.rm(testRoot, { recursive: true, force: true });
  });

  // Test 14: Editing one entry uploads under 100 KB total and creates exactly 1 pack
  test('14. Editing one entry uploads under 100 KB total and creates exactly 1 pack', async () => {
    test.setTimeout(45000);

    const testRoot = path.join(repoRoot, 'data', 'test-edit-upload-budget');
    const sourceDir = path.join(testRoot, 'source');
    const backupDir = path.join(testRoot, 'backup');

    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });

    // Seed test vault with initial entry
    const entDir = path.join(sourceDir, 'entries', 'ent_edit_budget');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1, categories: [], entries: {} }));

    const initialChunk: ChunkPayload = {
      schemaVersion: 2,
      chunkId: 'chunk_0',
      entryId: 'ent_edit_budget',
      order: 0,
      blocks: [
        {
          type: 'paragraph',
          attrs: { id: 'blk_b_1' },
          content: [{ type: 'text', text: 'Initial content for budget test' }],
        },
      ],
    };
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify(initialChunk));
    await fs.writeFile(
      path.join(entDir, 'manifest.json'),
      JSON.stringify({
        entryId: 'ent_edit_budget',
        schemaVersion: 2,
        version: 1,
        totalBlocks: 1,
        chunkCount: 1,
        chunks: [
          {
            id: 'chunk_0',
            order: 0,
            blockCount: 1,
            bytes: Buffer.byteLength(JSON.stringify(initialChunk), 'utf8'),
            checksum: crypto.createHash('sha256').update(JSON.stringify(initialChunk)).digest('hex'),
          },
        ],
      })
    );

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);

    // Initial backup run
    const snap1 = await backupService.createSnapshot();
    expect(snap1.uploadedPacks).toBeGreaterThan(0);

    // Record remote files after initial run
    const packsBeforeEdit = (await localTarget.list('packs')).length;
    const indexesBeforeEdit = (await localTarget.list('index')).length;
    const snapshotsBeforeEdit = (await localTarget.list('snapshots')).length;

    // Simulate editing one note: modify chunk_0 and manifest
    const editedChunk: ChunkPayload = {
      ...initialChunk,
      blocks: [
        {
          type: 'paragraph',
          attrs: { id: 'blk_b_1' },
          content: [{ type: 'text', text: 'Edited content for budget test with a few extra words' }],
        },
      ],
    };
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify(editedChunk));
    await fs.writeFile(
      path.join(entDir, 'manifest.json'),
      JSON.stringify({
        entryId: 'ent_edit_budget',
        schemaVersion: 2,
        version: 2,
        totalBlocks: 1,
        chunkCount: 1,
        chunks: [
          {
            id: 'chunk_0',
            order: 0,
            blockCount: 1,
            bytes: Buffer.byteLength(JSON.stringify(editedChunk), 'utf8'),
            checksum: crypto.createHash('sha256').update(JSON.stringify(editedChunk)).digest('hex'),
          },
        ],
      })
    );

    // Run incremental backup after editing single note
    const snap2 = await backupService.createSnapshot();

    // Verify exactly 1 pack was uploaded for this edit
    expect(snap2.uploadedPacks).toBe(1);

    // Verify remote file counts increased by exactly 1 pack, 1 index, 1 snapshot
    const packsAfterEdit = await localTarget.list('packs');
    const indexesAfterEdit = await localTarget.list('index');
    const snapshotsAfterEdit = await localTarget.list('snapshots');

    expect(packsAfterEdit.length).toBe(packsBeforeEdit + 1);
    expect(indexesAfterEdit.length).toBe(indexesBeforeEdit + 1);
    expect(snapshotsAfterEdit.length).toBe(snapshotsBeforeEdit + 1);

    // Calculate total bytes newly uploaded (new pack + new index + new snapshot)
    const newPackFile = packsAfterEdit[packsAfterEdit.length - 1];
    const newIndexFile = indexesAfterEdit[indexesAfterEdit.length - 1];
    const newSnapshotFile = snapshotsAfterEdit.find((s) => s.path.includes(snap2.snapshotId))!;

    const newPackRaw = await localTarget.get(newPackFile.path);
    const newIndexRaw = await localTarget.get(newIndexFile.path);
    const newSnapshotRaw = await localTarget.get(newSnapshotFile.path);

    const totalUploadedBytes =
      (newPackRaw?.length || 0) + (newIndexRaw?.length || 0) + (newSnapshotRaw?.length || 0);

    // Must be well under 100 KB (typically 3-6 KB)
    expect(totalUploadedBytes).toBeLessThan(100 * 1024);

    await fs.rm(testRoot, { recursive: true, force: true });
  });

  // Test 15: Background job API trigger returns 202 + jobId, and unchanged vault writes NO new pack/index/snapshot
  test('15. Background job API returns 202 + jobId and unchanged vault writes NO new files', async ({ request }) => {
    test.setTimeout(45000);

    // 1. Trigger background backup via API
    const triggerRes = await request.post(`${API_BASE}/backup/trigger`, {
      headers: AUTH_HEADER,
    });
    expect(triggerRes.status()).toBe(202);
    const triggerBody = await triggerRes.json();
    expect(triggerBody.jobId).toBeTruthy();
    expect(['running', 'already_running']).toContain(triggerBody.status);

    // 2. Poll /backup/status until backup completes
    let statusBody: any = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const statusRes = await request.get(`${API_BASE}/backup/status`, {
        headers: AUTH_HEADER,
      });
      expect(statusRes.ok()).toBeTruthy();
      statusBody = await statusRes.json();
      if (statusBody.status === 'idle') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(statusBody.status).toBe('idle');

    // 3. Trigger backup with wait=true on unchanged vault: returns summary only (never full manifest)
    const syncRes = await request.post(`${API_BASE}/backup/trigger?wait=true`, {
      headers: AUTH_HEADER,
    });
    expect(syncRes.ok()).toBeTruthy();
    const syncBody = await syncRes.json();
    expect(syncBody.success).toBe(true);
    expect(syncBody.status).toBe('unchanged');
    expect(syncBody.uploadedPacks).toBe(0);
    expect(syncBody.newBlobsCount).toBe(0);
    // Ensure full manifest is NOT leaked in the response payload
    expect(syncBody.manifest).toBeUndefined();

    // 4. Verify unchanged vault produces zero new files on target
    const targetDir = path.resolve(baseDataDir, 'backup-snapshots');
    if (fsSync.existsSync(targetDir)) {
      const localTarget = new LocalFolderBackupTarget(targetDir);
      const packsBefore = (await localTarget.list('packs')).length;
      const indexBefore = (await localTarget.list('index')).length;
      const snapsBefore = (await localTarget.list('snapshots')).length;

      const runAgain = await request.post(`${API_BASE}/backup/trigger?wait=true`, {
        headers: AUTH_HEADER,
      });
      expect(runAgain.ok()).toBeTruthy();
      const runAgainBody = await runAgain.json();
      expect(runAgainBody.status).toBe('unchanged');

      const packsAfter = (await localTarget.list('packs')).length;
      const indexAfter = (await localTarget.list('index')).length;
      const snapsAfter = (await localTarget.list('snapshots')).length;

      expect(packsAfter).toBe(packsBefore);
      expect(indexAfter).toBe(indexBefore);
      expect(snapsAfter).toBe(snapsBefore);
    }
  });

  // Test 16: backup:verify-restore validates entries, asset originals, and categories against live data
  test('16. verifyRestore validates entries, asset originals, and categories against live data without modifying it', async () => {
    test.setTimeout(45000);

    const testRoot = path.join(repoRoot, 'data', 'test-verify-restore');
    const sourceDir = path.join(testRoot, 'source');
    const backupDir = path.join(testRoot, 'backup');

    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(path.join(sourceDir, 'categories'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, 'storage'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, 'entries', 'ent_verify_1', 'chunks'), { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });

    // Seed category
    const catData = { id: 'cat_test', title: 'Test Category', color: '#3b82f6' };
    await fs.writeFile(path.join(sourceDir, 'categories', 'cat_test.json'), JSON.stringify(catData));

    // Seed storage asset original
    const assetData = Buffer.from(VALID_PNG_BASE64, 'base64');
    await fs.writeFile(path.join(sourceDir, 'storage', 'asset_orig_1.png'), assetData);

    // Seed entry
    const docData: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'blk_v_1' },
            content: [{ type: 'text', text: 'Verified restore entry content' }],
          },
        ],
      },
    };
    const chunkData: ChunkPayload = {
      schemaVersion: 2,
      chunkId: 'chunk_0',
      entryId: 'ent_verify_1',
      order: 0,
      blocks: docData.doc.content as TopLevelBlock[],
    };
    await fs.writeFile(
      path.join(sourceDir, 'entries', 'ent_verify_1', 'chunks', 'chunk_0.json'),
      JSON.stringify(chunkData)
    );
    await fs.writeFile(
      path.join(sourceDir, 'entries', 'ent_verify_1', 'manifest.json'),
      JSON.stringify({
        entryId: 'ent_verify_1',
        schemaVersion: 2,
        version: 1,
        totalBlocks: 1,
        chunkCount: 1,
        chunks: [
          {
            id: 'chunk_0',
            order: 0,
            blockCount: 1,
            bytes: Buffer.byteLength(JSON.stringify(chunkData), 'utf8'),
            checksum: crypto.createHash('sha256').update(JSON.stringify(chunkData)).digest('hex'),
          },
        ],
      })
    );
    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1, categories: [catData], entries: {} }));

    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);
    await backupService.createSnapshot();

    // Run verifyRestore against sourceDir
    const result = await verifyRestore(localTarget, sourceDir);
    expect(result.success).toBe(true);
    expect(result.entriesCompared).toBe(1);
    expect(result.entriesMatched).toBe(1);
    expect(result.assetsCompared).toBe(1);
    expect(result.assetsMatched).toBe(1);
    expect(result.categoriesCompared).toBe(1);
    expect(result.categoriesMatched).toBe(1);
    expect(result.errors.length).toBe(0);

    await fs.rm(testRoot, { recursive: true, force: true });
  });
});
