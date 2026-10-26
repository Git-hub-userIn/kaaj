import path from 'node:path';
import type { BackupTarget } from './backup-target.js';
import type { SnapshotManifestV3 } from './repository-types.js';
import {
  calculateTieredRetention,
  type SnapshotMetaItem,
  RETENTION_CONFIG,
} from './retention-policy.js';

export { RETENTION_CONFIG };

export interface PruneOptions {
  keepLast?: number; // optional explicit override
  apply?: boolean;   // default: false (dry-run)
  nowMs?: number;    // timestamp for testing tiered retention
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
 * Uses tiered retention policy by default (last 5 + 1/day for 7d + 1/week for 4w).
 * Operates in dry-run mode unless `apply: true` is explicitly provided.
 */
export async function pruneBackups(
  target: BackupTarget,
  options?: PruneOptions
): Promise<PruneResult> {
  const apply = options?.apply ?? false;

  const snapshotFiles = await target.list('snapshots');
  const filteredSnapshots = snapshotFiles.filter((f) => !f.path.endsWith('latest.json') && f.path.endsWith('.json'));

  // Sort descending by snapshot timestamp
  filteredSnapshots.sort((a, b) => b.path.localeCompare(a.path));

  let survivingPaths: Set<string>;
  let toDeletePaths: string[];

  if (typeof options?.keepLast === 'number') {
    const keepN = Math.max(1, options.keepLast);
    const surviving = filteredSnapshots.slice(0, keepN);
    const toDelete = filteredSnapshots.slice(keepN);
    survivingPaths = new Set(surviving.map((s) => s.path));
    toDeletePaths = toDelete.map((s) => s.path);
  } else {
    // Read snapshot manifests to extract createdAt
    const metaItems: SnapshotMetaItem[] = [];
    for (const s of filteredSnapshots) {
      try {
        const raw = await target.get(s.path);
        if (!raw) continue;
        const manifest: SnapshotManifestV3 = JSON.parse(raw.toString('utf8'));
        metaItems.push({
          snapshotId: manifest.snapshotId || path.basename(s.path).replace(/\.json$/, ''),
          createdAt: manifest.createdAt || new Date().toISOString(),
          path: s.path,
        });
      } catch {
        // Corrupt snapshot files are kept by default to avoid premature data loss
      }
    }

    const { kept, dead } = calculateTieredRetention(metaItems, options?.nowMs);
    survivingPaths = new Set(kept.map((k) => k.path));
    toDeletePaths = dead.map((d) => d.path);
  }

  // Read all surviving snapshots to gather referenced pack IDs
  const referencedPacks = new Set<string>();

  for (const sPath of survivingPaths) {
    try {
      const raw = await target.get(sPath);
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

  const packsToDeletePaths = unreferencedPacks.map((p) => `packs/${p}`);

  if (apply) {
    if (target.delete) {
      for (const sp of toDeletePaths) {
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
    retainedSnapshots: survivingPaths.size,
    snapshotsToDelete: toDeletePaths,
    packsToDelete: packsToDeletePaths,
  };
}
