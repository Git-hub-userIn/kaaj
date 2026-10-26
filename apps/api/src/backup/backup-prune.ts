import path from 'node:path';
import type { BackupTarget } from './backup-target.js';
import type { SnapshotManifestV3 } from './repository-types.js';

export interface PruneOptions {
  keepLast?: number; // default: 5
  apply?: boolean;   // default: false (dry-run)
}

export interface PruneResult {
  applied: boolean;
  totalSnapshots: number;
  retainedSnapshots: number;
  snapshotsToDelete: string[];
  packsToDelete: string[];
}

/**
 * Prunes historical snapshots and unreferenced orphan packs from the repository.
 * Keeps the most recent `keepLast` snapshots (default 5).
 * Operates in dry-run mode unless `apply: true` is explicitly provided.
 */
export async function pruneBackups(
  target: BackupTarget,
  options?: PruneOptions
): Promise<PruneResult> {
  const keepLast = Math.max(1, options?.keepLast ?? 5);
  const apply = options?.apply ?? false;

  const snapshotFiles = await target.list('snapshots');
  const filteredSnapshots = snapshotFiles.filter((f) => !f.path.endsWith('latest.json'));

  // Sort descending by snapshot timestamp
  filteredSnapshots.sort((a, b) => b.path.localeCompare(a.path));

  const surviving = filteredSnapshots.slice(0, keepLast);
  const toDelete = filteredSnapshots.slice(keepLast);

  // Read all surviving snapshots to gather referenced pack IDs
  const referencedPacks = new Set<string>();

  for (const s of surviving) {
    try {
      const raw = await target.get(s.path);
      if (!raw) continue;
      const manifest: SnapshotManifestV3 = JSON.parse(raw.toString('utf8'));
      for (const p of manifest.packs || []) {
        referencedPacks.add(p);
      }
    } catch {}
  }

  // Find unreferenced packs on remote
  const packFiles = await target.list('packs');
  const unreferencedPacks: string[] = [];

  for (const pf of packFiles) {
    const packId = path.basename(pf.path);
    if (!referencedPacks.has(packId)) {
      unreferencedPacks.push(packId);
    }
  }

  const snapshotsToDeletePaths = toDelete.map((s) => s.path);
  const packsToDeletePaths = unreferencedPacks.map((p) => `packs/${p}`);

  if (apply) {
    if (target.delete) {
      for (const sp of snapshotsToDeletePaths) {
        await target.delete(sp);
      }
      for (const pp of packsToDeletePaths) {
        await target.delete(pp);
      }
    } else {
      throw new Error(`Target "${target.name}" does not support deletion.`);
    }
  }

  return {
    applied: apply,
    totalSnapshots: filteredSnapshots.length,
    retainedSnapshots: surviving.length,
    snapshotsToDelete: snapshotsToDeletePaths,
    packsToDelete: packsToDeletePaths,
  };
}
