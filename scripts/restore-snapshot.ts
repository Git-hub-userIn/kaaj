import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget } from '../apps/api/src/backup/backup-target.js';
import { LocalFolderBackupTarget } from '../apps/api/src/backup/local-backup-target.js';
import type { SnapshotManifest } from '../apps/api/src/backup/backup-service.js';

export interface RestoreOptions {
  snapshotId?: string; // Default: 'latest'
  force?: boolean;
}

export interface RestoreResult {
  restoredFiles: number;
  totalBytes: number;
  snapshotId: string;
}

/**
 * Restores a snapshot into a clean target directory and verifies content checksums.
 * Never overwrites non-empty directory without explicit force flag.
 */
export async function restoreSnapshot(
  target: BackupTarget,
  destinationDir: string,
  options?: RestoreOptions
): Promise<RestoreResult> {
  const force = options?.force ?? false;
  const snapshotId = options?.snapshotId ?? 'latest';

  // 1. Validate destination directory is clean
  if (fsSync.existsSync(destinationDir)) {
    const existingItems = await fs.readdir(destinationDir);
    const nonIgnored = existingItems.filter((i) => i !== '.gitkeep' && !i.startsWith('.'));
    if (nonIgnored.length > 0 && !force) {
      throw new Error(
        `Destination directory "${destinationDir}" is not empty (${nonIgnored.length} items found). Pass --force to overwrite.`
      );
    }
  } else {
    await fs.mkdir(destinationDir, { recursive: true });
  }

  // 2. Fetch snapshot manifest
  const manifestPath = snapshotId === 'latest'
    ? 'snapshots/latest-manifest.json'
    : `snapshots/${snapshotId}/manifest.json`;

  const rawManifest = await target.get(manifestPath);
  if (!rawManifest) {
    throw new Error(`Snapshot manifest not found at "${manifestPath}" on backup target.`);
  }

  const manifest: SnapshotManifest = JSON.parse(rawManifest.toString('utf8'));
  let restoredCount = 0;
  let totalBytes = 0;

  // 3. Download and verify each file
  for (const item of manifest.files) {
    const fileData = await target.get(item.path);
    if (!fileData) {
      throw new Error(`File missing on backup target: ${item.path}`);
    }

    // Verify SHA-256 checksum
    const downloadedChecksum = crypto.createHash('sha256').update(fileData).digest('hex');
    if (downloadedChecksum !== item.checksum) {
      throw new Error(
        `Checksum mismatch for restored file "${item.path}". Expected: ${item.checksum}, Received: ${downloadedChecksum}`
      );
    }

    // Map storage path to destination layout
    let destSubPath = item.path;
    if (item.path.startsWith('assets/')) {
      destSubPath = path.join('storage', item.path.replace(/^assets\//, ''));
    }

    const fullDestPath = path.join(destinationDir, destSubPath);
    await fs.mkdir(path.dirname(fullDestPath), { recursive: true });

    const tmpPath = `${fullDestPath}.tmp`;
    await fs.writeFile(tmpPath, fileData);
    await fs.rename(tmpPath, fullDestPath);

    restoredCount++;
    totalBytes += fileData.length;
  }

  return {
    restoredFiles: restoredCount,
    totalBytes,
    snapshotId: manifest.snapshotId,
  };
}

// CLI Runner
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.includes('restore-snapshot')) {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const backupSource = args.find((a) => !a.startsWith('-') && !a.includes('=')) || 'data/backups/snapshots';
  const destDir = args[args.indexOf(backupSource) + 1] || 'data/restored-data';

  console.log(`[RESTORE] Source: ${backupSource} | Destination: ${destDir} | Force: ${force}`);
  const target = new LocalFolderBackupTarget(path.resolve(backupSource));
  restoreSnapshot(target, path.resolve(destDir), { force })
    .then((res) => {
      console.log(`[RESTORE COMPLETED] Restored ${res.restoredFiles} files (${res.totalBytes} bytes) from snapshot ${res.snapshotId}.`);
    })
    .catch((err) => {
      console.error(`[RESTORE FAILED] ${err.message}`);
      process.exit(1);
    });
}
