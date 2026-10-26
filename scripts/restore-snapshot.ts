import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { BackupTarget } from '../apps/api/src/backup/backup-target.js';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import { extractBlobFromPack } from '../apps/api/src/backup/pack-format.js';
import {
  type SnapshotManifestV3,
  type IndexFile,
  type BlobIndexRecord,
  runConcurrent,
} from '../apps/api/src/backup/backup-service.js';

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

function getSharpInstance() {
  try {
    const root = findRepoRoot();
    const req = createRequire(path.resolve(root, 'apps', 'api', 'package.json'));
    return req('sharp');
  } catch {
    return null;
  }
}

export interface RestoreOptions {
  snapshotId?: string; // Default: 'latest'
  force?: boolean;
  concurrency?: number; // Default: from BACKUP_CONCURRENCY or 4
}

export interface RestoreResult {
  restoredFiles: number;
  totalBytes: number;
  snapshotId: string;
  regeneratedThumbnails: number;
}

/**
 * Regenerates 320px and 960px WebP thumbnails for a restored original image.
 */
async function regenerateThumbnailsForAsset(
  originalImagePath: string,
  assetId: string,
  thumbsDir: string
): Promise<void> {
  const sharp = getSharpInstance();
  if (!sharp) {
    console.warn('[RESTORE] sharp not available, skipping thumbnail regeneration.');
    return;
  }
  try {
    const buffer = await fs.readFile(originalImagePath);
    const cleanBuffer = await sharp(buffer).rotate().toBuffer();

    await fs.mkdir(thumbsDir, { recursive: true });
    await sharp(cleanBuffer)
      .resize(320)
      .webp({ quality: 80 })
      .toFile(path.join(thumbsDir, `${assetId}_320.webp`));

    await sharp(cleanBuffer)
      .resize(960)
      .webp({ quality: 80 })
      .toFile(path.join(thumbsDir, `${assetId}_960.webp`));
  } catch (err: any) {
    console.warn(`[RESTORE] Thumbnail generation warning for ${assetId}:`, err.message || err);
  }
}

/**
 * Restores a snapshot into a clean target directory using restic-style pack repository format.
 * Refuses to overwrite a non-empty directory without explicit --force.
 * Concurrency 4 + backoff for download.
 * Automatically regenerates thumbnails.
 */
export async function restoreSnapshot(
  target: BackupTarget,
  destinationDir: string,
  options?: RestoreOptions
): Promise<RestoreResult> {
  const force = options?.force ?? false;
  const snapshotIdArg = options?.snapshotId ?? 'latest';
  const concurrency = Math.max(
    1,
    options?.concurrency ?? (Number(process.env.BACKUP_CONCURRENCY) || 4)
  );

  // 1. Verify destination directory is clean
  if (fsSync.existsSync(destinationDir)) {
    const items = await fs.readdir(destinationDir);
    const nonIgnored = items.filter((i) => i !== '.gitkeep' && !i.startsWith('.'));
    if (nonIgnored.length > 0 && !force) {
      throw new Error(
        `Destination directory "${destinationDir}" is not empty (${nonIgnored.length} items found). Pass --force to overwrite.`
      );
    }
  } else {
    await fs.mkdir(destinationDir, { recursive: true });
  }

  // 2. Fetch snapshot manifest
  let snapshotManifest: SnapshotManifestV3 | null = null;

  if (snapshotIdArg === 'latest') {
    const snapFiles = await target.list('snapshots');
    const filtered = snapFiles.filter((f) => !f.path.endsWith('latest.json') && f.path.endsWith('.json'));
    if (filtered.length === 0) {
      throw new Error('No snapshots found in backup repository.');
    }
    filtered.sort((a, b) => a.path.localeCompare(b.path));
    const latestFile = filtered[filtered.length - 1];
    const raw = await target.get(latestFile.path);
    if (!raw) {
      throw new Error(`Failed to read snapshot file: ${latestFile.path}`);
    }
    snapshotManifest = JSON.parse(raw.toString('utf8'));
  } else {
    const snapPath = snapshotIdArg.startsWith('snapshots/')
      ? snapshotIdArg
      : `snapshots/${snapshotIdArg}${snapshotIdArg.endsWith('.json') ? '' : '.json'}`;
    const raw = await target.get(snapPath);
    if (!raw) {
      throw new Error(`Snapshot not found at "${snapPath}" on backup target.`);
    }
    snapshotManifest = JSON.parse(raw.toString('utf8'));
  }

  if (!snapshotManifest) {
    throw new Error('Could not resolve snapshot manifest.');
  }

  // 3. Load all index files from remote repository
  const indexFiles = await target.list('index');
  const blobIndex = new Map<string, BlobIndexRecord>();

  await runConcurrent(indexFiles, concurrency, async (idxFile) => {
    try {
      const raw = await target.get(idxFile.path);
      if (!raw) return;
      const parsed: IndexFile = JSON.parse(raw.toString('utf8'));
      for (const b of parsed.blobs || []) {
        blobIndex.set(b.hash, b);
      }
    } catch {}
  });

  // 4. Collect all needed files to restore
  interface FileRestoreTask {
    destRelPath: string;
    blobHash: string;
  }
  const filesToRestore: FileRestoreTask[] = [];

  // db-store.json
  if (snapshotManifest.dbExport && snapshotManifest.dbExport.blobHash) {
    filesToRestore.push({
      destRelPath: 'db-store.json',
      blobHash: snapshotManifest.dbExport.blobHash,
    });
  }

  // storage/meta.json
  if (snapshotManifest.assetMeta && snapshotManifest.assetMeta.blobHash) {
    filesToRestore.push({
      destRelPath: 'storage/meta.json',
      blobHash: snapshotManifest.assetMeta.blobHash,
    });
  }

  // Entries manifests & chunks
  for (const ent of Object.values(snapshotManifest.entries || {})) {
    if (ent.manifestBlobHash) {
      filesToRestore.push({
        destRelPath: ent.manifestPath,
        blobHash: ent.manifestBlobHash,
      });
    }
    for (const chk of ent.chunks || []) {
      filesToRestore.push({
        destRelPath: chk.path,
        blobHash: chk.blobHash,
      });
    }
  }

  // Assets (originals)
  for (const asset of snapshotManifest.assets || []) {
    filesToRestore.push({
      destRelPath: `storage/${asset.storageKey}`,
      blobHash: asset.blobHash,
    });
  }

  // 5. Group blobs by packId
  const packBlobTasks = new Map<
    string,
    Array<{ destRelPath: string; blobHash: string; offset: number; length: number }>
  >();

  for (const f of filesToRestore) {
    const loc = blobIndex.get(f.blobHash);
    if (!loc) {
      throw new Error(`Blob ${f.blobHash} for "${f.destRelPath}" is missing from repository index.`);
    }
    if (!packBlobTasks.has(loc.packId)) {
      packBlobTasks.set(loc.packId, []);
    }
    packBlobTasks.get(loc.packId)!.push({
      destRelPath: f.destRelPath,
      blobHash: f.blobHash,
      offset: loc.offset,
      length: loc.length,
    });
  }

  let restoredFiles = 0;
  let totalBytes = 0;

  // 6. Download packs with concurrency and extract blobs
  const packEntries = Array.from(packBlobTasks.entries());

  await runConcurrent(packEntries, concurrency, async ([packId, blobs]) => {
    const packBuffer = await target.get(`packs/${packId}`);
    if (!packBuffer) {
      throw new Error(`Pack file missing on target: packs/${packId}`);
    }

    // Verify pack hash
    const actualPackHash = crypto.createHash('sha256').update(packBuffer).digest('hex');
    if (actualPackHash !== packId) {
      throw new Error(`Pack hash mismatch for pack ${packId}. Received: ${actualPackHash}`);
    }

    // Extract each blob from the pack
    for (const b of blobs) {
      const blobData = extractBlobFromPack(packBuffer, b.offset, b.length, b.blobHash);
      const fullDest = path.join(destinationDir, b.destRelPath);
      await fs.mkdir(path.dirname(fullDest), { recursive: true });

      const tmp = `${fullDest}.tmp`;
      await fs.writeFile(tmp, blobData);
      await fs.rename(tmp, fullDest);

      restoredFiles++;
      totalBytes += blobData.length;
    }
  });

  // 7. Regenerate WebP thumbnails
  let regeneratedThumbnails = 0;
  const thumbsDir = path.join(destinationDir, 'storage', 'thumbs');

  for (const asset of snapshotManifest.assets || []) {
    const originalPath = path.join(destinationDir, 'storage', asset.storageKey);
    if (fsSync.existsSync(originalPath)) {
      await regenerateThumbnailsForAsset(originalPath, asset.id, thumbsDir);
      regeneratedThumbnails += 2; // 320px + 960px
    }
  }

  return {
    restoredFiles,
    totalBytes,
    snapshotId: snapshotManifest.snapshotId,
    regeneratedThumbnails,
  };
}

// CLI Runner
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.includes('restore-snapshot')
) {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : undefined;
  const snapshotArg = args.find((a) => a.startsWith('--snapshot='));
  const snapshotId = snapshotArg ? snapshotArg.split('=')[1] : 'latest';

  const backupSource =
    args.find((a) => !a.startsWith('-') && !a.includes('=')) || 'data/backup-snapshots';
  const destDir = args[args.indexOf(backupSource) + 1] || 'data/restored-data';

  console.log(
    `[RESTORE] Source: ${backupSource} | Destination: ${destDir} | Force: ${force} | Snapshot: ${snapshotId}`
  );
  const target = new LocalFolderBackupTarget(path.resolve(backupSource));
  restoreSnapshot(target, path.resolve(destDir), { force, concurrency, snapshotId })
    .then((res) => {
      console.log(
        `[RESTORE COMPLETED] Restored ${res.restoredFiles} files (${res.totalBytes} bytes, ${res.regeneratedThumbnails} thumbnails) from snapshot ${res.snapshotId}.`
      );
    })
    .catch((err) => {
      console.error(`[RESTORE FAILED] ${err.message}`);
      process.exit(1);
    });
}
