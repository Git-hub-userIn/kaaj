import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget, BackupFileRecord } from './backup-target.js';

export interface SnapshotFileEntry {
  path: string;
  bytes: number;
  checksum: string;
}

export interface SnapshotManifest {
  schemaVersion: 2;
  snapshotId: string;
  createdAt: string;
  totalFiles: number;
  totalBytes: number;
  files: SnapshotFileEntry[];
  counts: {
    entries: number;
    chunks: number;
    assets: number;
  };
}

export interface BackupStatus {
  status: 'idle' | 'running' | 'failed';
  lastBackupTime: string | null;
  lastError: string | null;
  lastSnapshotId: string | null;
  uploadedCount: number;
  totalFiles?: number;
  processedCount?: number;
}

/**
 * Executes async tasks with bounded concurrency pool.
 */
export async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  };

  const poolSize = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

export class BackupService {
  private baseDataDir: string;
  private target: BackupTarget;
  private status: BackupStatus = {
    status: 'idle',
    lastBackupTime: null,
    lastError: null,
    lastSnapshotId: null,
    uploadedCount: 0,
    processedCount: 0,
  };
  private intervalTimer: NodeJS.Timeout | null = null;
  private lastDataHash: string | null = null;

  constructor(baseDataDir: string, target: BackupTarget) {
    this.baseDataDir = baseDataDir;
    this.target = target;
  }

  setTarget(target: BackupTarget): void {
    this.target = target;
  }

  getTarget(): BackupTarget {
    return this.target;
  }

  getStatus(): BackupStatus {
    return { ...this.status };
  }

  /**
   * Start 15-minute periodic backup timer (runs only if data changed).
   */
  startPeriodicTimer(intervalMs = 15 * 60 * 1000): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => {
      this.triggerPeriodicBackup().catch(() => {});
    }, intervalMs);
  }

  stopPeriodicTimer(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async triggerPeriodicBackup(): Promise<void> {
    const currentHash = await this.computeQuickDataHash();
    if (currentHash === this.lastDataHash) {
      // Nothing changed since last snapshot, skip backup
      return;
    }
    await this.createSnapshot();
  }

  private async computeQuickDataHash(): Promise<string> {
    const dbPath = path.join(this.baseDataDir, 'db-store.json');
    try {
      const stat = await fs.stat(dbPath);
      return `${stat.mtimeMs}_${stat.size}`;
    } catch {
      return '';
    }
  }

  /**
   * Core snapshot creation method.
   * Incremental: uploads only chunks/assets whose hash changed since previous snapshot.
   * Bounded concurrency: default 4 (configurable via BACKUP_CONCURRENCY).
   * Ordering rule: latest-manifest.json updated only after ALL uploads succeed.
   */
  async createSnapshot(options?: {
    forceAll?: boolean;
    concurrency?: number;
  }): Promise<{
    snapshotId: string;
    uploadedCount: number;
    skippedCount: number;
    manifest: SnapshotManifest;
  }> {
    if (this.status.status === 'running') {
      throw new Error('A backup snapshot is already in progress.');
    }

    this.status.status = 'running';
    this.status.lastError = null;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotId = `snapshot_${timestamp}`;

      // 1. Fetch previous manifest for incremental diffing
      let prevManifest: SnapshotManifest | null = null;
      if (!options?.forceAll) {
        try {
          const rawPrev = await this.target.get('snapshots/latest-manifest.json');
          if (rawPrev) {
            prevManifest = JSON.parse(rawPrev.toString('utf8'));
          }
        } catch {
          // No previous manifest
        }
      }

      const prevMap = new Map<string, string>();
      if (prevManifest && Array.isArray(prevManifest.files)) {
        for (const f of prevManifest.files) {
          prevMap.set(f.path, f.checksum);
        }
      }

      // 2. Discover local files to backup
      const localFiles: Array<{ relPath: string; fullPath: string }> = [];

      // Add db-store.json
      const dbStorePath = path.join(this.baseDataDir, 'db-store.json');
      if (fsSync.existsSync(dbStorePath)) {
        localFiles.push({ relPath: 'db-store.json', fullPath: dbStorePath });
      }

      // Add entries (manifests + chunks)
      const entriesDir = path.join(this.baseDataDir, 'entries');
      if (fsSync.existsSync(entriesDir)) {
        const entDirs = await fs.readdir(entriesDir, { withFileTypes: true });
        for (const ed of entDirs) {
          if (ed.isDirectory()) {
            const entId = ed.name;
            const manifestP = path.join(entriesDir, entId, 'manifest.json');
            if (fsSync.existsSync(manifestP)) {
              localFiles.push({ relPath: `entries/${entId}/manifest.json`, fullPath: manifestP });
            }
            const chkDir = path.join(entriesDir, entId, 'chunks');
            if (fsSync.existsSync(chkDir)) {
              const chks = await fs.readdir(chkDir, { withFileTypes: true });
              for (const chk of chks) {
                if (chk.isFile() && chk.name.endsWith('.json')) {
                  localFiles.push({
                    relPath: `entries/${entId}/chunks/${chk.name}`,
                    fullPath: path.join(chkDir, chk.name),
                  });
                }
              }
            }
          }
        }
      }

      // Add assets (originals and thumbnails)
      const storageDir = path.join(this.baseDataDir, 'storage');
      if (fsSync.existsSync(storageDir)) {
        const files = await fs.readdir(storageDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && !file.name.endsWith('.tmp')) {
            localFiles.push({ relPath: `assets/${file.name}`, fullPath: path.join(storageDir, file.name) });
          }
        }
        const thumbsDir = path.join(storageDir, 'thumbs');
        if (fsSync.existsSync(thumbsDir)) {
          const thumbs = await fs.readdir(thumbsDir, { withFileTypes: true });
          for (const thumb of thumbs) {
            if (thumb.isFile() && thumb.name.endsWith('.webp')) {
              localFiles.push({ relPath: `assets/thumbs/${thumb.name}`, fullPath: path.join(thumbsDir, thumb.name) });
            }
          }
        }
      }

      // 3. Process each file with bounded concurrency
      const concurrency = Math.max(
        1,
        options?.concurrency ?? (Number(process.env.BACKUP_CONCURRENCY) || 4)
      );

      this.status.totalFiles = localFiles.length;
      this.status.uploadedCount = 0;
      this.status.processedCount = 0;

      let uploadedCount = 0;
      let skippedCount = 0;
      let processedCount = 0;
      let totalBytes = 0;
      const manifestFileEntries: SnapshotFileEntry[] = new Array(localFiles.length);

      let entryCount = 0;
      let chunkCount = 0;
      let assetCount = 0;

      await runConcurrent(localFiles, concurrency, async (item, index) => {
        const buffer = await fs.readFile(item.fullPath);
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

        manifestFileEntries[index] = {
          path: item.relPath,
          bytes: buffer.length,
          checksum,
        };

        totalBytes += buffer.length;
        if (item.relPath.includes('entries/') && item.relPath.endsWith('manifest.json')) entryCount++;
        if (item.relPath.includes('chunks/')) chunkCount++;
        if (item.relPath.startsWith('assets/')) assetCount++;

        // Incremental check:
        // 1. Matches previous snapshot manifest
        // 2. Or already landed on target (e.g. after interrupted run)
        if (prevMap.get(item.relPath) === checksum) {
          skippedCount++;
        } else if (this.target.has && (await this.target.has(item.relPath, checksum))) {
          skippedCount++;
        } else {
          await this.target.put(item.relPath, buffer);
          uploadedCount++;
          this.status.uploadedCount = uploadedCount;
        }

        processedCount++;
        this.status.processedCount = processedCount;
      });

      // 4. Create and upload Snapshot Manifest
      const snapshotManifest: SnapshotManifest = {
        schemaVersion: 2,
        snapshotId,
        createdAt: new Date().toISOString(),
        totalFiles: manifestFileEntries.length,
        totalBytes,
        files: manifestFileEntries,
        counts: {
          entries: entryCount,
          chunks: chunkCount,
          assets: assetCount,
        },
      };

      const manifestBuf = Buffer.from(JSON.stringify(snapshotManifest, null, 2), 'utf8');

      // Ordering rule: Update historical snapshot and latest-manifest strictly after all uploads succeed
      await this.target.put(`snapshots/${snapshotId}/manifest.json`, manifestBuf, 'application/json');
      await this.target.put('snapshots/latest-manifest.json', manifestBuf, 'application/json');

      this.status.status = 'idle';
      this.status.lastBackupTime = snapshotManifest.createdAt;
      this.status.lastSnapshotId = snapshotId;
      this.status.uploadedCount = uploadedCount;
      this.status.processedCount = processedCount;
      this.lastDataHash = await this.computeQuickDataHash();

      return {
        snapshotId,
        uploadedCount,
        skippedCount,
        manifest: snapshotManifest,
      };
    } catch (err: any) {
      this.status.status = 'failed';
      this.status.lastError = err.message || 'Backup failed';
      throw err;
    }
  }
}
