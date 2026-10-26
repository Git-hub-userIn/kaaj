import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget } from './backup-target.js';
import { readPackFooter, extractBlobFromPack } from './pack-format.js';
import type { IndexFile } from './repository-types.js';

export interface CheckOptions {
  sampleRate?: number; // 0.0 to 1.0 (default 1.0 = check all)
}

export interface CheckResult {
  ok: boolean;
  totalPacks: number;
  totalIndexes: number;
  totalBlobs: number;
  sampledPacksChecked: number;
  errors: string[];
}

/**
 * Verifies repository integrity:
 * 1. Ensures every index entry points to a pack that physically exists on the target.
 * 2. Samples and verifies pack SHA-256 checksums and blob content integrity.
 */
export async function checkBackupRepository(
  target: BackupTarget,
  options?: CheckOptions
): Promise<CheckResult> {
  const sampleRate = options?.sampleRate ?? 1.0;
  const errors: string[] = [];

  const [packFiles, indexFiles] = await Promise.all([
    target.list('packs'),
    target.list('index'),
  ]);

  const existingPackIds = new Set<string>();
  for (const pf of packFiles) {
    existingPackIds.add(path.basename(pf.path));
  }

  let totalBlobs = 0;
  const packsWithBlobs = new Map<string, Array<{ hash: string; offset: number; length: number }>>();

  // 1. Verify index files
  for (const idxFile of indexFiles) {
    try {
      const raw = await target.get(idxFile.path);
      if (!raw) {
        errors.push(`Unreadable index file: ${idxFile.path}`);
        continue;
      }
      const parsed: IndexFile = JSON.parse(raw.toString('utf8'));
      for (const b of parsed.blobs || []) {
        totalBlobs++;
        if (!existingPackIds.has(b.packId)) {
          errors.push(
            `Missing pack "${b.packId}" referenced for blob ${b.hash} in index ${idxFile.path}.`
          );
        } else {
          if (!packsWithBlobs.has(b.packId)) {
            packsWithBlobs.set(b.packId, []);
          }
          packsWithBlobs.get(b.packId)!.push({
            hash: b.hash,
            offset: b.offset,
            length: b.length,
          });
        }
      }
    } catch (err: any) {
      errors.push(`Failed to parse index file ${idxFile.path}: ${err.message}`);
    }
  }

  // 2. Sample and verify pack content integrity
  const packIdsToCheck = Array.from(existingPackIds).filter(() => Math.random() <= sampleRate);
  let sampledPacksChecked = 0;

  for (const packId of packIdsToCheck) {
    try {
      const packBuffer = await target.get(`packs/${packId}`);
      if (!packBuffer) {
        errors.push(`Missing pack file: packs/${packId}`);
        continue;
      }

      sampledPacksChecked++;

      // Verify overall pack SHA-256
      const actualPackHash = crypto.createHash('sha256').update(packBuffer).digest('hex');
      if (actualPackHash !== packId) {
        errors.push(`Pack hash mismatch for ${packId}: computed ${actualPackHash}`);
        continue;
      }

      // Read footer
      const footer = readPackFooter(packBuffer);

      // Verify each blob in footer
      for (const b of footer.blobs) {
        try {
          extractBlobFromPack(packBuffer, b.offset, b.length, b.hash);
        } catch (err: any) {
          errors.push(`Pack ${packId} corrupted blob ${b.hash}: ${err.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Failed reading pack ${packId}: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    totalPacks: packFiles.length,
    totalIndexes: indexFiles.length,
    totalBlobs,
    sampledPacksChecked,
    errors,
  };
}
