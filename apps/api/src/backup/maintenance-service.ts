import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget } from './backup-target.js';
import { JobLock } from './job-lock.js';
import { checkBackupRepository } from './backup-check.js';
import { pruneBackups } from './backup-prune.js';
import { createPack, extractBlobFromPack, readPackFooter, type PackBlobInput } from './pack-format.js';
import type { IndexFile, SnapshotManifestV3 } from './repository-types.js';

export const REMOTE_FILE_COUNT_THRESHOLD = 100;
export const SMALL_PACK_THRESHOLD_BYTES = 1 * 1024 * 1024; // 1 MB
export const GARBAGE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PRUNE_DUE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface GarbageCandidate {
  packId: string;
  markedAt: number; // epoch ms
}

export interface GarbageManifest {
  schemaVersion: 1;
  updatedAt: string;
  candidates: GarbageCandidate[];
}

export interface MaintenanceState {
  lastBackupAt: string | null;
  lastPruneAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  remoteFileCount?: number;
}

export interface MaintenanceRunResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  snapshotsPruned?: number;
  packsCompacted?: number;
  packsMarkedGarbage?: number;
  packsDeleted?: number;
  error?: string;
}

export class MaintenanceService {
  private baseDataDir: string;
  private target: BackupTarget;
  private jobLock: JobLock;
  private stateFilePath: string;
  private lastEditAt = 0;

  constructor(baseDataDir: string, target: BackupTarget) {
    this.baseDataDir = baseDataDir;
    this.target = target;
    this.jobLock = new JobLock(target);
    this.stateFilePath = path.join(baseDataDir, 'maintenance-state.json');
  }

  setTarget(target: BackupTarget): void {
    this.target = target;
    this.jobLock = new JobLock(target);
  }

  recordEdit(nowMs = Date.now()): void {
    this.lastEditAt = nowMs;
  }

  getLastEditAt(): number {
    return this.lastEditAt;
  }

  async getState(): Promise<MaintenanceState> {
    try {
      if (fsSync.existsSync(this.stateFilePath)) {
        const raw = await fs.readFile(this.stateFilePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {}

    // Fallback: try remote maintenance.json
    try {
      const rawRemote = await this.target.get('maintenance.json');
      if (rawRemote) {
        return JSON.parse(rawRemote.toString('utf8'));
      }
    } catch {}

    return {
      lastBackupAt: null,
      lastPruneAt: null,
      lastResult: null,
      lastError: null,
    };
  }

  async saveState(state: MaintenanceState): Promise<void> {
    try {
      await fs.mkdir(this.baseDataDir, { recursive: true });
      const raw = JSON.stringify(state, null, 2);
      await fs.writeFile(this.stateFilePath, raw, 'utf8');

      // Mirror state onto remote backup target
      await this.target.put('maintenance.json', Buffer.from(raw, 'utf8'), 'application/json');
    } catch (err) {
      console.warn('[MAINTENANCE] Failed to persist state:', err);
    }
  }

  /**
   * Evaluates "due and idle" conditions to determine whether prune should run:
   * 1. Kill switch: PRUNE_ENABLED !== 'false'
   * 2. Due: lastPruneAt > 7 days OR > 50 packs < 1 MB OR remote files > 100
   * 3. Idle: last backup succeeded, no edit in last 5 minutes, no job lock held
   */
  async isPruneDueAndIdle(nowMs = Date.now()): Promise<{ due: boolean; idle: boolean; reason: string }> {
    if (process.env.PRUNE_ENABLED === 'false') {
      return { due: false, idle: false, reason: 'PRUNE_ENABLED is false' };
    }

    // Check idle: no edit in last 5 minutes
    if (this.lastEditAt > 0 && nowMs - this.lastEditAt < 5 * 60 * 1000) {
      return { due: false, idle: false, reason: 'Active edit within last 5 minutes' };
    }

    const state = await this.getState();
    if (!state.lastBackupAt) {
      return { due: false, idle: false, reason: 'No successful backup recorded yet' };
    }

    const [packFiles, indexFiles, snapshotFiles] = await Promise.all([
      this.target.list('packs'),
      this.target.list('index'),
      this.target.list('snapshots'),
    ]);

    const totalRemoteFiles = packFiles.length + indexFiles.length + snapshotFiles.length;

    let smallPacksCount = 0;
    for (const pf of packFiles) {
      if (pf.bytes && pf.bytes < SMALL_PACK_THRESHOLD_BYTES) {
        smallPacksCount++;
      }
    }

    let isDue = false;
    let dueReason = '';

    const lastPruneMs = state.lastPruneAt ? Date.parse(state.lastPruneAt) : 0;
    if (!lastPruneMs || nowMs - lastPruneMs >= PRUNE_DUE_INTERVAL_MS) {
      isDue = true;
      dueReason = 'lastPruneAt is older than 7 days';
    } else if (smallPacksCount >= 50) {
      isDue = true;
      dueReason = `Found ${smallPacksCount} packs under 1 MB`;
    } else if (totalRemoteFiles >= REMOTE_FILE_COUNT_THRESHOLD) {
      isDue = true;
      dueReason = `Remote file count (${totalRemoteFiles}) exceeds threshold (${REMOTE_FILE_COUNT_THRESHOLD})`;
    }

    return {
      due: isDue,
      idle: true,
      reason: isDue ? dueReason : 'Prune not due yet',
    };
  }

  /**
   * Executes repository maintenance (safety pre-check -> compaction -> two-phase prune -> post-check).
   */
  async runMaintenance(options?: {
    force?: boolean;
    nowMs?: number;
    skipIdleCheck?: boolean;
  }): Promise<MaintenanceRunResult> {
    const nowMs = options?.nowMs ?? Date.now();

    // 1. Kill switch check
    if (process.env.PRUNE_ENABLED === 'false') {
      return {
        success: false,
        skipped: true,
        reason: 'PRUNE_ENABLED is set to false',
      };
    }

    // 2. Idle check
    if (!options?.skipIdleCheck && this.lastEditAt > 0 && nowMs - this.lastEditAt < 5 * 60 * 1000) {
      return {
        success: false,
        skipped: true,
        reason: 'Skipped: Edit active within the last 5 minutes',
      };
    }

    // 3. Acquire job lock with lease and fencing token
    const token = await this.jobLock.acquire('maintenance-worker', 120000);
    if (!token) {
      return {
        success: false,
        skipped: true,
        reason: 'Skipped: Job lock held by another process',
      };
    }

    try {
      // 4. Safety rule 1: Pre-check repository integrity
      const preCheck = await checkBackupRepository(this.target);
      if (!preCheck.ok) {
        const errorMsg = `Pre-maintenance integrity check failed: ${preCheck.errors.join('; ')}`;
        await this.recordFailure(errorMsg);
        throw new Error(errorMsg);
      }

      // 5. Compaction: compact packs < 1 MB into larger packs + write new index
      const compactedCount = await this.compactSmallPacks(nowMs);

      // 6. Two-phase prune
      const pruneResult = await this.executeTwoPhasePrune(nowMs);

      // 7. Safety rule 2: Post-check repository integrity
      const postCheck = await checkBackupRepository(this.target);
      if (!postCheck.ok) {
        const errorMsg = `Post-maintenance integrity check failed: ${postCheck.errors.join('; ')}`;
        await this.recordFailure(errorMsg);
        throw new Error(errorMsg);
      }

      // Calculate new remote file count
      const [packs, indexes, snapshots] = await Promise.all([
        this.target.list('packs'),
        this.target.list('index'),
        this.target.list('snapshots'),
      ]);
      const totalRemoteFiles = packs.length + indexes.length + snapshots.length;

      const state: MaintenanceState = {
        lastBackupAt: (await this.getState()).lastBackupAt,
        lastPruneAt: new Date(nowMs).toISOString(),
        lastResult: `Success: deleted ${pruneResult.deletedPacksCount} packs, ${pruneResult.deletedSnapshotsCount} snapshots, compacted ${compactedCount} packs`,
        lastError: null,
        remoteFileCount: totalRemoteFiles,
      };
      await this.saveState(state);

      return {
        success: true,
        snapshotsPruned: pruneResult.deletedSnapshotsCount,
        packsCompacted: compactedCount,
        packsMarkedGarbage: pruneResult.markedPacksCount,
        packsDeleted: pruneResult.deletedPacksCount,
      };
    } catch (err: any) {
      await this.recordFailure(err.message || String(err));
      throw err;
    } finally {
      await this.jobLock.release();
    }
  }

  private async recordFailure(errMsg: string): Promise<void> {
    const currentState = await this.getState();
    currentState.lastError = errMsg;
    currentState.lastResult = `Failed: ${errMsg}`;
    await this.saveState(currentState);
  }

  /**
   * Compaction: Rewrites packs under 1 MB into a consolidated pack and marks old packs as garbage candidates.
   */
  async compactSmallPacks(nowMs: number): Promise<number> {
    const garbageManifest = await this.loadGarbageManifest();
    const existingGarbagePacks = new Set(garbageManifest.candidates.map((c) => c.packId));

    const packFiles = await this.target.list('packs');
    const smallPacks: Array<{ path: string; packId: string; bytes: number }> = [];

    for (const pf of packFiles) {
      const packId = path.basename(pf.path);
      if (existingGarbagePacks.has(packId)) {
        continue; // Already marked for garbage/pruning, do not re-compact
      }
      const bytes = pf.bytes ?? (await this.target.get(pf.path))?.length ?? 0;
      if (bytes > 0 && bytes < SMALL_PACK_THRESHOLD_BYTES) {
        smallPacks.push({
          path: pf.path,
          packId,
          bytes,
        });
      }
    }

    // Compact when at least 2 small packs exist
    if (smallPacks.length < 2) {
      return 0;
    }

    // Read remote indexes to find blobs located in these small packs
    const indexFiles = await this.target.list('index');
    const smallPackIds = new Set(smallPacks.map((s) => s.packId));
    const blobsToRebundle: PackBlobInput[] = [];

    // Map packId -> Buffer for fast blob extraction
    const packBuffers = new Map<string, Buffer>();

    for (const idxFile of indexFiles) {
      const raw = await this.target.get(idxFile.path);
      if (!raw) continue;
      try {
        const idx: IndexFile = JSON.parse(raw.toString('utf8'));
        for (const b of idx.blobs || []) {
          if (smallPackIds.has(b.packId)) {
            let pBuf = packBuffers.get(b.packId);
            if (!pBuf) {
              const fetched = await this.target.get(`packs/${b.packId}`);
              if (!fetched) continue;
              pBuf = fetched;
              packBuffers.set(b.packId, pBuf);
            }
            const blobData = extractBlobFromPack(pBuf, b.offset, b.length);
            blobsToRebundle.push({
              hash: b.hash,
              type: b.type,
              data: blobData,
            });
          }
        }
      } catch {}
    }

    if (blobsToRebundle.length === 0) {
      return 0;
    }

    // Create consolidated pack
    const newPack = createPack(blobsToRebundle);
    await this.target.put(`packs/${newPack.packId}`, newPack.buffer, 'application/octet-stream');

    // Create new index file
    const newIndexPayload: IndexFile = {
      schemaVersion: 3,
      indexId: '',
      createdAt: new Date(nowMs).toISOString(),
      blobs: newPack.entries.map((entry) => ({
        hash: entry.hash,
        packId: newPack.packId,
        offset: entry.offset,
        length: entry.length,
        type: entry.type,
      })),
    };
    const newIndexRaw = JSON.stringify(newIndexPayload, null, 2);
    const newIndexHash = crypto.createHash('sha256').update(newIndexRaw).digest('hex');
    newIndexPayload.indexId = newIndexHash;

    await this.target.put(
      `index/${newIndexHash}.json`,
      Buffer.from(JSON.stringify(newIndexPayload, null, 2), 'utf8'),
      'application/json'
    );

    // Register old small packs into garbage manifest (do not delete immediately!)
    for (const sp of smallPacks) {
      if (!existingGarbagePacks.has(sp.packId)) {
        garbageManifest.candidates.push({
          packId: sp.packId,
          markedAt: nowMs,
        });
      }
    }

    await this.saveGarbageManifest(garbageManifest, nowMs);
    return smallPacks.length;
  }

  /**
   * Two-phase delete:
   * 1. Finds unreferenced packs.
   * 2. Writes newly discovered unreferenced packs to garbage.json with markedAt timestamp.
   * 3. Only candidates in garbage.json that are >= 24h old AND still unreferenced are deleted.
   * 4. Enforces the 50% max delete safety guard and zero kept-pack safety guard.
   */
  private async executeTwoPhasePrune(nowMs: number): Promise<{
    deletedSnapshotsCount: number;
    markedPacksCount: number;
    deletedPacksCount: number;
  }> {
    // 1. Run dry-run prune using tiered retention
    const prunePlanning = await pruneBackups(this.target, { apply: false, nowMs });

    // 2. Determine all surviving snapshots and all packs referenced by kept snapshots
    const snapshotFiles = await this.target.list('snapshots');
    const survivingSnapshots = snapshotFiles.filter(
      (s) => !prunePlanning.snapshotsToDelete.includes(s.path) && s.path.endsWith('.json')
    );

    const keptReferencedPacks = new Set<string>();
    for (const snap of survivingSnapshots) {
      try {
        const raw = await this.target.get(snap.path);
        if (!raw) continue;
        const manifest: SnapshotManifestV3 = JSON.parse(raw.toString('utf8'));
        for (const p of manifest.packs || []) {
          keptReferencedPacks.add(p);
        }
      } catch {}
    }

    // 3. Find unreferenced packs on remote
    const packFiles = await this.target.list('packs');
    const totalPacksCount = packFiles.length;
    const currentUnreferencedPacks = new Set<string>();

    for (const pf of packFiles) {
      const packId = path.basename(pf.path);
      if (!keptReferencedPacks.has(packId)) {
        currentUnreferencedPacks.add(packId);
      }
    }

    // 4. Load garbage manifest
    const garbageManifest = await this.loadGarbageManifest();
    const existingCandidatesMap = new Map<string, number>();
    for (const c of garbageManifest.candidates) {
      existingCandidatesMap.set(c.packId, c.markedAt);
    }

    let newlyMarkedCount = 0;
    // Add current unreferenced packs to garbage if not already listed
    for (const unrefPackId of currentUnreferencedPacks) {
      if (!existingCandidatesMap.has(unrefPackId)) {
        garbageManifest.candidates.push({
          packId: unrefPackId,
          markedAt: nowMs,
        });
        existingCandidatesMap.set(unrefPackId, nowMs);
        newlyMarkedCount++;
      }
    }

    // 5. Identify candidates eligible for deletion: >= 24 hours old AND still unreferenced
    const packsEligibleForDeletion: string[] = [];
    const retainedCandidates: GarbageCandidate[] = [];

    for (const cand of garbageManifest.candidates) {
      // If pack is now referenced again (e.g. reused or restored), remove it from garbage!
      if (keptReferencedPacks.has(cand.packId)) {
        continue;
      }

      const ageMs = nowMs - cand.markedAt;
      if (ageMs >= GARBAGE_GRACE_PERIOD_MS) {
        packsEligibleForDeletion.push(cand.packId);
      } else {
        // Younger than 24h: retain in garbage manifest!
        retainedCandidates.push(cand);
      }
    }

    // 6. LOCKED SAFETY RULE: Kept snapshot pack check
    for (const packId of packsEligibleForDeletion) {
      if (keptReferencedPacks.has(packId)) {
        throw new Error(
          `[SAFETY_GUARD] Critical violation: attempt to delete pack "${packId}" referenced by a kept snapshot. Aborting immediately.`
        );
      }
    }

    // 7. LOCKED SAFETY RULE: 50% max delete guard
    if (totalPacksCount > 0 && packsEligibleForDeletion.length > Math.floor(totalPacksCount * 0.5)) {
      throw new Error(
        `[SAFETY_GUARD] Prune aborted: would delete ${packsEligibleForDeletion.length}/${totalPacksCount} packs (> 50%). Manual override prevented.`
      );
    }

    // 8. Execute actual deletions
    if (this.target.delete) {
      // Delete dead snapshots
      for (const snapPath of prunePlanning.snapshotsToDelete) {
        await this.target.delete(snapPath);
      }
      // Delete mature unreferenced packs
      for (const packId of packsEligibleForDeletion) {
        await this.target.delete(`packs/${packId}`);
      }

      // Update remaining pack IDs set
      const packFilesAfter = await this.target.list('packs');
      const survivingPackIds = new Set(packFilesAfter.map((p) => path.basename(p.path)));

      // Clean up index files referencing deleted packs (restic index cleanup)
      const indexFiles = await this.target.list('index');
      for (const idx of indexFiles) {
        try {
          const raw = await this.target.get(idx.path);
          if (!raw) continue;
          const indexData: IndexFile = JSON.parse(raw.toString('utf8'));
          const liveBlobs = (indexData.blobs || []).filter((b) => survivingPackIds.has(b.packId));
          if (liveBlobs.length === 0) {
            await this.target.delete(idx.path);
          } else if (liveBlobs.length < indexData.blobs.length) {
            indexData.blobs = liveBlobs;
            await this.target.put(
              idx.path,
              Buffer.from(JSON.stringify(indexData, null, 2), 'utf8'),
              'application/json'
            );
          }
        } catch {}
      }
    } else {
      throw new Error(`Target "${this.target.name}" does not support deletion.`);
    }

    // Update garbage manifest with surviving candidates
    garbageManifest.candidates = retainedCandidates;
    await this.saveGarbageManifest(garbageManifest, nowMs);

    return {
      deletedSnapshotsCount: prunePlanning.snapshotsToDelete.length,
      markedPacksCount: newlyMarkedCount,
      deletedPacksCount: packsEligibleForDeletion.length,
    };
  }

  private async loadGarbageManifest(): Promise<GarbageManifest> {
    try {
      const raw = await this.target.get('garbage.json');
      if (raw) {
        return JSON.parse(raw.toString('utf8'));
      }
    } catch {}

    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      candidates: [],
    };
  }

  private async saveGarbageManifest(manifest: GarbageManifest, nowMs = Date.now()): Promise<void> {
    manifest.updatedAt = new Date(nowMs).toISOString();
    await this.target.put(
      'garbage.json',
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      'application/json'
    );
  }
}
