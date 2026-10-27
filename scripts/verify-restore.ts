import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { BackupTarget } from '../apps/api/src/backup/backup-target.js';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { GoogleDriveBackupTarget } from '../apps/api/src/backup/google-drive-backup-target.js';
import { restoreSnapshot } from './restore-snapshot.js';
import {
  type DocumentEnvelopeV2,
  type ChunkPayload,
  reassembleDocFromChunks,
  canonicalDocJson,
} from '../packages/doc-model/src/index.js';

function findRepoRoot(dir = process.cwd()): string {
  let curr = path.resolve(dir);
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, 'apps', 'api', 'package.json'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return dir;
}

export interface VerificationResult {
  success: boolean;
  snapshotId: string;
  entriesCompared: number;
  entriesMatched: number;
  assetsCompared: number;
  assetsMatched: number;
  categoriesCompared: number;
  categoriesMatched: number;
  errors: string[];
}

/**
 * Loads a full DocumentEnvelopeV2 from an entry's on-disk chunks directory.
 */
async function loadEntryDocFromDir(entryDir: string): Promise<DocumentEnvelopeV2 | null> {
  const manifestPath = path.join(entryDir, 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const chunkFiles = Array.isArray(manifest.chunks)
      ? manifest.chunks
      : [];

    const chunks: ChunkPayload[] = [];
    for (const chkMeta of chunkFiles) {
      const chunkFileName = chkMeta.id?.endsWith('.json') ? chkMeta.id : `${chkMeta.id}.json`;
      let chkPath = path.join(entryDir, 'chunks', chunkFileName);
      if (!fsSync.existsSync(chkPath) && chkMeta.path) {
        chkPath = path.isAbsolute(chkMeta.path)
          ? chkMeta.path
          : path.join(entryDir, chkMeta.path);
      }

      if (fsSync.existsSync(chkPath)) {
        const raw = await fs.readFile(chkPath, 'utf8');
        chunks.push(JSON.parse(raw));
      }
    }

    if (chunks.length === 0) return null;
    return reassembleDocFromChunks(chunks);
  } catch {
    return null;
  }
}

/**
 * Computes SHA-256 of a file on disk.
 */
async function computeFileSha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Restores latest snapshot into a clean temporary directory and compares
 * all entries, assets, and categories against live data without touching live data.
 */
export async function verifyRestore(
  target: BackupTarget,
  liveDataDir: string,
  options?: { snapshotId?: string }
): Promise<VerificationResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaaj-verify-restore-'));
  const errors: string[] = [];

  let entriesCompared = 0;
  let entriesMatched = 0;
  let assetsCompared = 0;
  let assetsMatched = 0;
  let categoriesCompared = 0;
  let categoriesMatched = 0;
  let resolvedSnapshotId = '';

  try {
    // 1. Restore into temp directory
    const restoreRes = await restoreSnapshot(target, tempDir, {
      force: true,
      snapshotId: options?.snapshotId || 'latest',
    });
    resolvedSnapshotId = restoreRes.snapshotId;

    // 2. Compare Entries (Canonical JSON)
    const liveEntriesDir = path.join(liveDataDir, 'entries');
    if (fsSync.existsSync(liveEntriesDir)) {
      const liveEntDirs = await fs.readdir(liveEntriesDir, { withFileTypes: true });
      for (const ed of liveEntDirs) {
        if (ed.isDirectory()) {
          const entId = ed.name;
          const liveEntryPath = path.join(liveEntriesDir, entId);
          const restoredEntryPath = path.join(tempDir, 'entries', entId);

          const liveDoc = await loadEntryDocFromDir(liveEntryPath);
          if (liveDoc) {
            entriesCompared++;
            if (!fsSync.existsSync(restoredEntryPath)) {
              errors.push(`Entry "${entId}" missing in restored repository.`);
              continue;
            }

            const restoredDoc = await loadEntryDocFromDir(restoredEntryPath);
            if (!restoredDoc) {
              errors.push(`Entry "${entId}" failed to reassemble from restored chunks.`);
              continue;
            }

            const liveCanonical = canonicalDocJson(liveDoc);
            const restoredCanonical = canonicalDocJson(restoredDoc);

            if (liveCanonical === restoredCanonical) {
              entriesMatched++;
            } else {
              errors.push(`Entry "${entId}" canonical JSON mismatch between live and restored.`);
            }
          }
        }
      }
    }

    // 3. Compare Asset Originals (SHA-256 hashes)
    const liveStorageDir = path.join(liveDataDir, 'storage');
    if (fsSync.existsSync(liveStorageDir)) {
      const liveFiles = await fs.readdir(liveStorageDir, { withFileTypes: true });
      for (const f of liveFiles) {
        if (
          f.isFile() &&
          f.name !== 'meta.json' &&
          !f.name.endsWith('.tmp') &&
          !f.name.endsWith('.webp')
        ) {
          assetsCompared++;
          const liveAssetPath = path.join(liveStorageDir, f.name);
          const restoredAssetPath = path.join(tempDir, 'storage', f.name);

          if (!fsSync.existsSync(restoredAssetPath)) {
            errors.push(`Asset "${f.name}" missing in restored storage.`);
            continue;
          }

          const liveHash = await computeFileSha256(liveAssetPath);
          const restoredHash = await computeFileSha256(restoredAssetPath);

          if (liveHash === restoredHash) {
            assetsMatched++;
          } else {
            errors.push(`Asset "${f.name}" hash mismatch (live: ${liveHash}, restored: ${restoredHash}).`);
          }
        }
      }
    }

    // 4. Compare Categories
    const liveCategoriesDir = path.join(liveDataDir, 'categories');
    if (fsSync.existsSync(liveCategoriesDir)) {
      const liveCatFiles = await fs.readdir(liveCategoriesDir);
      for (const cf of liveCatFiles) {
        if (cf.endsWith('.json')) {
          categoriesCompared++;
          const liveCatPath = path.join(liveCategoriesDir, cf);
          const restoredCatPath = path.join(tempDir, 'categories', cf);

          if (!fsSync.existsSync(restoredCatPath)) {
            errors.push(`Category file "${cf}" missing in restored categories.`);
            continue;
          }

          const liveCat = JSON.parse(await fs.readFile(liveCatPath, 'utf8'));
          const restoredCat = JSON.parse(await fs.readFile(restoredCatPath, 'utf8'));

          if (
            liveCat.id === restoredCat.id &&
            liveCat.title === restoredCat.title &&
            liveCat.color === restoredCat.color
          ) {
            categoriesMatched++;
          } else {
            errors.push(`Category "${cf}" metadata mismatch between live and restored.`);
          }
        }
      }
    }
  } finally {
    // Clean up temporary restore directory without touching live data
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  const success = errors.length === 0;
  return {
    success,
    snapshotId: resolvedSnapshotId,
    entriesCompared,
    entriesMatched,
    assetsCompared,
    assetsMatched,
    categoriesCompared,
    categoriesMatched,
    errors,
  };
}

// CLI runner
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.includes('verify-restore')
) {
  const root = findRepoRoot();
  const liveDir = path.resolve(root, 'data');
  const backupDir = process.env.BACKUP_DIR || path.resolve(liveDir, 'backup-snapshots');

  const target = new LocalFolderBackupTarget(backupDir);

  console.log('==================================================');
  console.log('KAAJ BACKUP VERIFY-RESTORE');
  console.log(`Live data: ${liveDir}`);
  console.log(`Target:    ${target.name} (${backupDir})`);
  console.log('==================================================');

  verifyRestore(target, liveDir)
    .then((result) => {
      console.log(`Snapshot:           ${result.snapshotId}`);
      console.log(`Entries verified:   ${result.entriesMatched} / ${result.entriesCompared} matched`);
      console.log(`Assets verified:    ${result.assetsMatched} / ${result.assetsCompared} matched`);
      console.log(`Categories verified:${result.categoriesMatched} / ${result.categoriesCompared} matched`);

      if (result.success) {
        console.log('--------------------------------------------------');
        console.log('STATUS: PASS (All data verified identical to live)');
        console.log('==================================================');
        process.exit(0);
      } else {
        console.log('--------------------------------------------------');
        console.log('STATUS: FAIL');
        console.log('Differences:');
        for (const err of result.errors.slice(0, 5)) {
          console.log(`  - ${err}`);
        }
        console.log('==================================================');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`Verification error: ${err.message}`);
      process.exit(1);
    });
}
