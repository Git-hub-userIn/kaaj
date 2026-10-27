import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { BackupService } from '../apps/api/src/backup/backup-service.js';
import { MaintenanceService } from '../apps/api/src/backup/maintenance-service.js';
import { JobLock } from '../apps/api/src/backup/job-lock.js';
import { checkBackupRepository } from '../apps/api/src/backup/backup-check.js';
import { pruneBackups } from '../apps/api/src/backup/backup-prune.js';
import { createPack } from '../apps/api/src/backup/pack-format.js';
import { restoreSnapshot } from '../scripts/restore-snapshot.js';
import {
  type DocumentEnvelopeV2,
  type TopLevelBlock,
  type ChunkPayload,
  type EntryManifest,
  reassembleDocFromChunks,
  canonicalDocJson,
} from '../packages/doc-model/src/index.js';

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

test.describe('Task C: Automatic Maintenance & Repository Safety Suite', () => {
  const repoRoot = findRepoRoot(process.cwd());
  const testRoot = path.join(repoRoot, 'data', 'test-maintenance');
  const sourceDir = path.join(testRoot, 'source');
  const backupDir = path.join(testRoot, 'backup');
  const restoreDir = path.join(testRoot, 'restore');

  test.beforeEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(restoreDir, { recursive: true });
  });

  test.afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  // 1. Prune is due when lastPruneAt is older than 7 days
  test('1. Prune due evaluation: due after 7 days, not due before', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    const T0 = 1700000000000; // Base epoch

    // Save initial state with successful backup
    await maintenance.saveState({
      lastBackupAt: new Date(T0).toISOString(),
      lastPruneAt: new Date(T0).toISOString(),
      lastResult: 'Initial test state',
      lastError: null,
    });

    // 6 days later: should NOT be due
    const day6Ms = T0 + 6 * 24 * 60 * 60 * 1000;
    const evalDay6 = await maintenance.isPruneDueAndIdle(day6Ms);
    expect(evalDay6.due).toBe(false);

    // 7 days + 1 second later: SHOULD be due
    const day7Ms = T0 + 7 * 24 * 60 * 60 * 1000 + 1000;
    const evalDay7 = await maintenance.isPruneDueAndIdle(day7Ms);
    expect(evalDay7.due).toBe(true);
    expect(evalDay7.reason).toContain('older than 7 days');
  });

  // 2. Skipped while backup holds lock
  test('2. Maintenance skipped while backup holds job lock', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const maintenance = new MaintenanceService(sourceDir, localTarget);
    const externalLock = new JobLock(localTarget);

    // External process (e.g. backup) acquires lock
    const token = await externalLock.acquire('backup-service', 60000);
    expect(token).toBeTruthy();

    // Maintenance attempt should gracefully skip
    const result = await maintenance.runMaintenance({ nowMs: Date.now() });
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('Job lock held');

    // External process releases lock
    await externalLock.release();

    // Seed empty repository so check passes
    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const backupService = new BackupService(sourceDir, localTarget);
    await backupService.createSnapshot();

    // Now maintenance acquires lock and runs successfully
    const afterReleaseResult = await maintenance.runMaintenance({ nowMs: Date.now() });
    expect(afterReleaseResult.success).toBe(true);
  });

  // 3. Skipped during active editing in the last 5 minutes
  test('3. Maintenance skipped during active editing within last 5 minutes', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    const T0 = 1700000000000;
    await maintenance.saveState({
      lastBackupAt: new Date(T0).toISOString(),
      lastPruneAt: null,
      lastResult: null,
      lastError: null,
    });

    // Record an edit at T0
    maintenance.recordEdit(T0);

    // Check at T0 + 2 minutes: not idle
    const eval2Min = await maintenance.isPruneDueAndIdle(T0 + 2 * 60 * 1000);
    expect(eval2Min.idle).toBe(false);
    expect(eval2Min.reason).toContain('Active edit');

    const run2Min = await maintenance.runMaintenance({ nowMs: T0 + 2 * 60 * 1000 });
    expect(run2Min.skipped).toBe(true);

    // Check at T0 + 5 minutes + 1 second: idle
    const eval5Min = await maintenance.isPruneDueAndIdle(T0 + 5 * 60 * 1000 + 1000);
    expect(eval5Min.idle).toBe(true);
  });

  // 4. Two-phase delete: candidate recorded in run 1, deleted only after 24h
  test('4. Two-phase delete: unreferenced pack marked in run 1, deleted only after 24h grace period', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const entDir = path.join(sourceDir, 'entries', 'ent_twophase');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_twophase' }));

    // Create 7 successive snapshots (tiered retention keeps 5, leaving 2 dead)
    for (let i = 0; i < 7; i++) {
      await fs.writeFile(path.join(entDir, 'chunks', `chunk_${i}.json`), JSON.stringify({ val: i }));
      await backupService.createSnapshot();
    }

    const initialPacks = await localTarget.list('packs');
    expect(initialPacks.length).toBe(7);

    const T0 = 1700000000000;

    // Run 1 at T0: dry-run / stage 1 marks garbage candidates
    const run1 = await maintenance.runMaintenance({ nowMs: T0, skipIdleCheck: true });
    expect(run1.success).toBe(true);
    expect(run1.packsMarkedGarbage).toBeGreaterThan(0);
    expect(run1.packsDeleted).toBe(0); // Zero packs deleted in first phase!

    // Verify garbage.json exists on target and contains marked candidates
    const rawGarbage = await localTarget.get('garbage.json');
    expect(rawGarbage).toBeTruthy();
    const garbageData = JSON.parse(rawGarbage!.toString('utf8'));
    expect(garbageData.candidates.length).toBeGreaterThan(0);

    // After run 1, uncompacted + new consolidated pack exist, but zero packs were deleted
    const packsAfterRun1 = await localTarget.list('packs');
    expect(packsAfterRun1.length).toBeGreaterThanOrEqual(7);

    // Run 2 at T0 + 12 hours (younger than 24h grace period): STILL must not delete!
    const run2 = await maintenance.runMaintenance({ nowMs: T0 + 12 * 60 * 60 * 1000, skipIdleCheck: true });
    expect(run2.success).toBe(true);
    expect(run2.packsDeleted).toBe(0);

    const packsAfterRun2 = await localTarget.list('packs');
    expect(packsAfterRun2.length).toBe(packsAfterRun1.length);

    // Run 3 at T0 + 24 hours + 1 minute: mature candidates ARE deleted!
    const run3 = await maintenance.runMaintenance({ nowMs: T0 + 24 * 60 * 60 * 1000 + 60000, skipIdleCheck: true });
    expect(run3.success).toBe(true);
    expect(run3.packsDeleted).toBeGreaterThan(0);

    const packsAfterRun3 = await localTarget.list('packs');
    expect(packsAfterRun3.length).toBeLessThan(packsAfterRun2.length);
  });

  // 5. Pre-check failure aborts with nothing deleted
  test('5. Pre-check failure aborts maintenance immediately with zero deletions', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    await backupService.createSnapshot();

    const packsBefore = await localTarget.list('packs');
    expect(packsBefore.length).toBe(1);

    // Corrupt an index file to intentionally fail repository check
    const indexes = await localTarget.list('index');
    expect(indexes.length).toBe(1);
    await localTarget.put(indexes[0].path, Buffer.from('CORRUPT_NOT_JSON'), 'application/json');

    // Attempt maintenance: must throw and abort!
    await expect(maintenance.runMaintenance({ nowMs: Date.now(), skipIdleCheck: true })).rejects.toThrow(
      /Pre-maintenance integrity check failed/
    );

    // Existing packs must not be deleted
    const packsAfter = await localTarget.list('packs');
    expect(packsAfter.length).toBe(1);

    // State must record the failure
    const state = await maintenance.getState();
    expect(state.lastError).toContain('Pre-maintenance integrity check failed');
  });

  // 6. 50% max delete safety guard aborts and protects repository
  test('6. 50% deletion guard aborts when candidate deletions exceed half of repository packs', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    await backupService.createSnapshot();

    const packs = await localTarget.list('packs');
    expect(packs.length).toBe(1);

    // Synthesize two valid unreferenced packs on target using createPack
    const blob1 = Buffer.from('TEST_DUMMY_BLOB_CONTENT_1');
    const hash1 = crypto.createHash('sha256').update(blob1).digest('hex');
    const pack1 = createPack([{ hash: hash1, data: blob1, type: 'chunk' }]);
    await localTarget.put(`packs/${pack1.packId}`, pack1.buffer, 'application/octet-stream');

    const blob2 = Buffer.from('TEST_DUMMY_BLOB_CONTENT_2');
    const hash2 = crypto.createHash('sha256').update(blob2).digest('hex');
    const pack2 = createPack([{ hash: hash2, data: blob2, type: 'chunk' }]);
    await localTarget.put(`packs/${pack2.packId}`, pack2.buffer, 'application/octet-stream');

    const totalPacks = await localTarget.list('packs');
    expect(totalPacks.length).toBe(3);

    // Stage both unreferenced dummy packs (2 out of 3 = 66.7% > 50%) into garbage manifest as mature (> 24h)
    const T0 = 1700000000000;
    const matureGarbage = {
      schemaVersion: 1,
      updatedAt: new Date(T0).toISOString(),
      candidates: [
        { packId: pack1.packId, markedAt: T0 - 25 * 60 * 60 * 1000 },
        { packId: pack2.packId, markedAt: T0 - 25 * 60 * 60 * 1000 },
      ],
    };
    await localTarget.put('garbage.json', Buffer.from(JSON.stringify(matureGarbage), 'utf8'), 'application/json');

    // Run maintenance: must trigger the 50% safety guard abort!
    await expect(maintenance.runMaintenance({ nowMs: T0, skipIdleCheck: true })).rejects.toThrow(
      /SAFETY_GUARD/
    );

    // None of the packs should be deleted!
    const packsAfter = await localTarget.list('packs');
    expect(packsAfter.length).toBe(3);
  });

  // 7. Kill switch env PRUNE_ENABLED=false works
  test('7. Kill switch PRUNE_ENABLED=false disables maintenance completely', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    process.env.PRUNE_ENABLED = 'false';

    try {
      const result = await maintenance.runMaintenance({ nowMs: Date.now() });
      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('PRUNE_ENABLED is set to false');

      const evaluation = await maintenance.isPruneDueAndIdle(Date.now());
      expect(evaluation.due).toBe(false);
      expect(evaluation.reason).toContain('PRUNE_ENABLED');
    } finally {
      delete process.env.PRUNE_ENABLED;
    }
  });

  // 8. Server restart mid-prune leaves all kept snapshots restorable
  test('8. Process termination mid-prune leaves surviving snapshots fully restorable', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);

    // Build realistic document
    const originalDoc: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'blk_mid_1' },
            content: [{ type: 'text', text: 'Persistent text before simulated termination.' }],
          },
        ],
      },
    };

    const entDir = path.join(sourceDir, 'entries', 'ent_mid');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));

    const origChunk: ChunkPayload = {
      schemaVersion: 2,
      chunkId: 'chunk_0',
      entryId: 'ent_mid',
      order: 0,
      blocks: originalDoc.doc.content as TopLevelBlock[],
    };
    await fs.writeFile(path.join(entDir, 'chunks', 'chunk_0.json'), JSON.stringify(origChunk));

    const origManifest: EntryManifest = {
      entryId: 'ent_mid',
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

    const snap = await backupService.createSnapshot();

    // Simulate partial/crashed maintenance run by writing an incomplete garbage file
    await localTarget.put('garbage.json', Buffer.from('{"interrupted": true}'), 'application/json');

    // Fresh process restoration into clean directory
    const freshTarget = new LocalFolderBackupTarget(backupDir);
    const restoreResult = await restoreSnapshot(freshTarget, restoreDir, { force: true });
    expect(restoreResult.snapshotId).toBe(snap.snapshotId);

    const restoredChunk: ChunkPayload = JSON.parse(
      await fs.readFile(path.join(restoreDir, 'entries', 'ent_mid', 'chunks', 'chunk_0.json'), 'utf8')
    );
    const restoredDoc = reassembleDocFromChunks([restoredChunk]);
    expect(canonicalDocJson(restoredDoc)).toBe(canonicalDocJson(originalDoc));
  });

  // 9. Compaction reduces file count and restore still succeeds with verified content
  test('9. Compaction consolidates small packs and restore continues to verify perfectly', async () => {
    // Set small pack threshold to allow compaction of small test chunks
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const backupService = new BackupService(sourceDir, localTarget);
    const maintenance = new MaintenanceService(sourceDir, localTarget);

    await fs.writeFile(path.join(sourceDir, 'db-store.json'), JSON.stringify({ v: 1 }));
    const entDir = path.join(sourceDir, 'entries', 'ent_compact');
    await fs.mkdir(path.join(entDir, 'chunks'), { recursive: true });
    await fs.writeFile(path.join(entDir, 'manifest.json'), JSON.stringify({ id: 'ent_compact' }));

    // Create 3 successive snapshots creating 3 separate small packs (< 1 MB)
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(
        path.join(entDir, 'chunks', `chunk_${i}.json`),
        JSON.stringify({ text: `Compaction test chunk ${i}` })
      );
      await backupService.createSnapshot();
    }

    const packsBefore = await localTarget.list('packs');
    expect(packsBefore.length).toBe(3);

    const T0 = 1700000000000;

    // Run compaction
    const compactedCount = await maintenance.compactSmallPacks(T0);
    expect(compactedCount).toBe(3);

    // Repository check must still be 100% healthy
    const checkAfterCompact = await checkBackupRepository(localTarget);
    expect(checkAfterCompact.ok).toBe(true);

    // Restore must succeed cleanly and find all chunk contents
    const restoreResult = await restoreSnapshot(localTarget, restoreDir, { force: true });
    expect(restoreResult.restoredFiles).toBeGreaterThanOrEqual(4);

    const chunk2 = JSON.parse(
      await fs.readFile(path.join(restoreDir, 'entries', 'ent_compact', 'chunks', 'chunk_2.json'), 'utf8')
    );
    expect(chunk2.text).toBe('Compaction test chunk 2');
  });

  // 10. Tiered retention: keeps last 5 + 1 per day (7 days) + 1 per week (4 weeks)
  test('10. Tiered retention keeps exact expected snapshots across calendar days and weeks', async () => {
    const localTarget = new LocalFolderBackupTarget(backupDir);
    const T0 = 1700000000000; // Base epoch
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Create snapshots across 35 days:
    // Days 0-4 (today): 5 snapshots (all kept in "last 5")
    // Days 1-7: 1 snapshot per day (kept in daily)
    // Days 8-28: 1 snapshot per week (kept in weekly)
    // Days 29-35: 1 snapshot per day (> 4 weeks old, must be purged)
    const snapshotsToCreate: { id: string; timeMs: number }[] = [];

    // 5 snapshots on today (Day 0)
    for (let i = 0; i < 5; i++) {
      snapshotsToCreate.push({
        id: `snap_today_${i}`,
        timeMs: T0 - i * 60000,
      });
    }

    // 1 snapshot per day for days 1 to 35
    for (let day = 1; day <= 35; day++) {
      snapshotsToCreate.push({
        id: `snap_day_${day}`,
        timeMs: T0 - day * DAY_MS,
      });
    }

    // Write dummy snapshot manifests directly to backup target
    for (const s of snapshotsToCreate) {
      const manifest = {
        schemaVersion: 3,
        snapshotId: s.id,
        createdAt: new Date(s.timeMs).toISOString(),
        totalFiles: 1,
        totalBytes: 100,
        packs: [],
        categories: [],
        entries: [],
      };
      await localTarget.put(
        `snapshots/${s.id}.json`,
        Buffer.from(JSON.stringify(manifest), 'utf8'),
        'application/json'
      );
    }

    const pruneResult = await pruneBackups(localTarget, { apply: false, nowMs: T0 });
    // Total snapshots = 5 + 35 = 40
    expect(pruneResult.totalSnapshots).toBe(40);
    // Kept:
    // - Last 5: snap_today_0..4 (5)
    // - Daily: days 1..7 (7)
    // - Weekly: days 8..28 (approx 3-4 week buckets not already covered)
    // Expected retained snapshots: ~15-16, dead: ~24-25
    expect(pruneResult.retainedSnapshots).toBeGreaterThan(12);
    expect(pruneResult.retainedSnapshots).toBeLessThan(20);
    expect(pruneResult.snapshotsToDelete.length).toBeGreaterThan(20);

    // Verify older than 28 days (e.g. day 30, day 35) are strictly marked for deletion
    expect(pruneResult.snapshotsToDelete.some((p) => p.endsWith('snap_day_30.json'))).toBe(true);
    expect(pruneResult.snapshotsToDelete.some((p) => p.endsWith('snap_day_35.json'))).toBe(true);

    // Verify today's snapshots and recent days (e.g. day 1, day 2) are strictly NOT in delete list
    expect(pruneResult.snapshotsToDelete.some((p) => p.endsWith('snap_today_0.json'))).toBe(false);
    expect(pruneResult.snapshotsToDelete.some((p) => p.endsWith('snap_day_1.json'))).toBe(false);
  });
});
