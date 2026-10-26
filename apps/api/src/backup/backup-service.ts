import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget } from './backup-target.js';
import {
  type BlobType,
  type PackBlobInput,
  type PackBlobEntry,
  type PackBuildResult,
  createPack,
} from './pack-format.js';
import type {
  BlobIndexRecord,
  IndexFile,
  SnapshotManifestV3,
  SnapshotEntryRef,
  SnapshotAssetRef,
  BackupStatus,
} from './repository-types.js';

export {
  type BlobIndexRecord,
  type IndexFile,
  type SnapshotManifestV3,
  type SnapshotEntryRef,
  type SnapshotAssetRef,
  type BackupStatus,
};

const TARGET_PACK_SIZE = 4 * 1024 * 1024; // 4 MB target pack size
const LARGE_ASSET_THRESHOLD = 2 * 1024 * 1024; // Assets >= 2 MB get their own pack

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

export interface LocalBlobFile {
  relPath: string;
  fullPath: string;
  type: BlobType;
  bytes: number;
  hash: string;
}

export class BackupService {
  private baseDataDir: string;
  private target: BackupTarget;
  private status: BackupStatus = {
    status: 'idle',
    phase: 'idle',
    statusText: 'Backup: Ready',
    lastBackupTime: null,
    lastError: null,
    lastSnapshotId: null,
    packsTotal: 0,
    packsUploaded: 0,
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
   * Scans local vault directory and collects all data files (chunks, manifests, db, assets).
   * Thumbnails (storage/thumbs/) are strictly excluded per design.
   */
  async scanLocalBlobs(): Promise<LocalBlobFile[]> {
    const blobs: LocalBlobFile[] = [];

    // 1. db-store.json
    const dbPath = path.join(this.baseDataDir, 'db-store.json');
    if (fsSync.existsSync(dbPath)) {
      const buf = await fs.readFile(dbPath);
      blobs.push({
        relPath: 'db-store.json',
        fullPath: dbPath,
        type: 'db',
        bytes: buf.length,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
      });
    }

    // 2. Entries (manifests + chunks)
    const entriesDir = path.join(this.baseDataDir, 'entries');
    if (fsSync.existsSync(entriesDir)) {
      const entDirs = await fs.readdir(entriesDir, { withFileTypes: true });
      for (const ed of entDirs) {
        if (ed.isDirectory()) {
          const entId = ed.name;
          const manifestP = path.join(entriesDir, entId, 'manifest.json');
          if (fsSync.existsSync(manifestP)) {
            const buf = await fs.readFile(manifestP);
            blobs.push({
              relPath: `entries/${entId}/manifest.json`,
              fullPath: manifestP,
              type: 'manifest',
              bytes: buf.length,
              hash: crypto.createHash('sha256').update(buf).digest('hex'),
            });
          }
          const chkDir = path.join(entriesDir, entId, 'chunks');
          if (fsSync.existsSync(chkDir)) {
            const chks = await fs.readdir(chkDir, { withFileTypes: true });
            for (const chk of chks) {
              if (chk.isFile() && chk.name.endsWith('.json')) {
                const full = path.join(chkDir, chk.name);
                const buf = await fs.readFile(full);
                blobs.push({
                  relPath: `entries/${entId}/chunks/${chk.name}`,
                  fullPath: full,
                  type: 'chunk',
                  bytes: buf.length,
                  hash: crypto.createHash('sha256').update(buf).digest('hex'),
                });
              }
            }
          }
        }
      }
    }

    // 3. Storage assets (originals and metadata only, NO thumbnails)
    const storageDir = path.join(this.baseDataDir, 'storage');
    if (fsSync.existsSync(storageDir)) {
      const metaP = path.join(storageDir, 'meta.json');
      if (fsSync.existsSync(metaP)) {
        const buf = await fs.readFile(metaP);
        blobs.push({
          relPath: 'storage/meta.json',
          fullPath: metaP,
          type: 'asset_meta',
          bytes: buf.length,
          hash: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }

      const files = await fs.readdir(storageDir, { withFileTypes: true });
      for (const f of files) {
        if (f.isFile() && f.name !== 'meta.json' && !f.name.endsWith('.tmp')) {
          const full = path.join(storageDir, f.name);
          const buf = await fs.readFile(full);
          blobs.push({
            relPath: `storage/${f.name}`,
            fullPath: full,
            type: 'asset',
            bytes: buf.length,
            hash: crypto.createHash('sha256').update(buf).digest('hex'),
          });
        }
      }
    }

    return blobs;
  }

  /**
   * Fetches remote index files and builds a merged Map of existing blob hashes on remote.
   * Remote listing is the authoritative source of truth.
   */
  async loadRemoteIndex(): Promise<{
    remoteBlobs: Map<string, BlobIndexRecord>;
    remotePacks: Set<string>;
    snapshots: string[];
  }> {
    const [packFiles, indexFiles, snapshotFiles] = await Promise.all([
      this.target.list('packs'),
      this.target.list('index'),
      this.target.list('snapshots'),
    ]);

    const remotePacks = new Set<string>();
    for (const p of packFiles) {
      remotePacks.add(path.basename(p.path));
    }

    const remoteBlobs = new Map<string, BlobIndexRecord>();

    // Concurrently load all index files
    await runConcurrent(indexFiles, 4, async (idxFile) => {
      try {
        const raw = await this.target.get(idxFile.path);
        if (!raw) return;
        const indexData: IndexFile = JSON.parse(raw.toString('utf8'));
        if (Array.isArray(indexData.blobs)) {
          for (const b of indexData.blobs) {
            // Only consider blob valid if its referenced pack actually exists on remote
            if (remotePacks.has(b.packId)) {
              remoteBlobs.set(b.hash, b);
            }
          }
        }
      } catch {
        // Ignore unreadable or corrupt index file
      }
    });

    const snapshots = snapshotFiles.map((s) => path.basename(s.path).replace(/\.json$/, ''));
    return { remoteBlobs, remotePacks, snapshots };
  }

  /**
   * Core restic-style backup snapshot execution.
   */
  async createSnapshot(options?: {
    forceAll?: boolean;
    concurrency?: number;
  }): Promise<{
    snapshotId: string;
    uploadedPacks: number;
    newBlobsCount: number;
    skippedBlobsCount: number;
    manifest: SnapshotManifestV3;
  }> {
    if (this.status.status === 'running') {
      throw new Error('A backup snapshot is already in progress.');
    }

    this.status.status = 'running';
    this.status.phase = 'checking';
    this.status.statusText = 'Checking Drive';
    this.status.lastError = null;

    try {
      const concurrency = Math.max(
        1,
        options?.concurrency ?? (Number(process.env.BACKUP_CONCURRENCY) || 4)
      );

      // Phase 1: Checking remote state
      const { remoteBlobs, remotePacks, snapshots } = await this.loadRemoteIndex();

      // Phase 2: Local Scan
      const localBlobs = await this.scanLocalBlobs();
      this.status.totalFiles = localBlobs.length;

      const newBlobs: LocalBlobFile[] = [];
      let skippedCount = 0;

      for (const b of localBlobs) {
        if (!options?.forceAll && remoteBlobs.has(b.hash)) {
          skippedCount++;
        } else {
          newBlobs.push(b);
        }
      }

      // Check if remote already has the latest snapshot and nothing changed
      let latestSnapshotManifest: SnapshotManifestV3 | null = null;
      if (snapshots.length > 0 && !options?.forceAll) {
        snapshots.sort();
        const latestId = snapshots[snapshots.length - 1];
        try {
          const raw = await this.target.get(`snapshots/${latestId}.json`);
          if (raw) {
            latestSnapshotManifest = JSON.parse(raw.toString('utf8'));
          }
        } catch {}
      }

      // If no new blobs and latest snapshot exists with identical file count, nothing to upload
      if (
        newBlobs.length === 0 &&
        latestSnapshotManifest &&
        latestSnapshotManifest.totalFiles === localBlobs.length
      ) {
        this.status.status = 'idle';
        this.status.phase = 'done';
        this.status.statusText = 'Backup: Up to date';
        this.status.packsTotal = 0;
        this.status.packsUploaded = 0;
        this.status.uploadedCount = 0;
        this.status.processedCount = localBlobs.length;
        this.lastDataHash = await this.computeQuickDataHash();

        return {
          snapshotId: latestSnapshotManifest.snapshotId,
          uploadedPacks: 0,
          newBlobsCount: 0,
          skippedBlobsCount: localBlobs.length,
          manifest: latestSnapshotManifest,
        };
      }

      // Phase 3: Pack new blobs
      const packsToUpload: PackBuildResult[] = [];
      const pendingPackBlobs: PackBlobInput[] = [];
      let currentPackBytes = 0;

      for (const b of newBlobs) {
        const buf = await fs.readFile(b.fullPath);

        // Assets >= 2 MB get their own dedicated pack
        if (b.type === 'asset' && buf.length >= LARGE_ASSET_THRESHOLD) {
          const largePack = createPack([{ hash: b.hash, data: buf, type: b.type }]);
          packsToUpload.push(largePack);
          continue;
        }

        pendingPackBlobs.push({ hash: b.hash, data: buf, type: b.type });
        currentPackBytes += buf.length;

        if (currentPackBytes >= TARGET_PACK_SIZE) {
          const pack = createPack(pendingPackBlobs);
          packsToUpload.push(pack);
          pendingPackBlobs.length = 0;
          currentPackBytes = 0;
        }
      }

      if (pendingPackBlobs.length > 0) {
        const pack = createPack(pendingPackBlobs);
        packsToUpload.push(pack);
      }

      // Phase 4: Upload Packs
      this.status.phase = 'uploading_packs';
      this.status.packsTotal = packsToUpload.length;
      this.status.packsUploaded = 0;
      this.status.statusText = `Uploading 0/${packsToUpload.length} packs`;

      let packsUploadedCount = 0;
      const newBlobIndexRecords: BlobIndexRecord[] = [];

      await runConcurrent(packsToUpload, concurrency, async (pack) => {
        // Upload pack: packs/<packId>
        await this.target.put(`packs/${pack.packId}`, pack.buffer, 'application/octet-stream');
        packsUploadedCount++;
        this.status.packsUploaded = packsUploadedCount;
        this.status.uploadedCount = packsUploadedCount;
        this.status.statusText = `Uploading ${packsUploadedCount}/${packsToUpload.length} packs`;

        for (const entry of pack.entries) {
          newBlobIndexRecords.push({
            hash: entry.hash,
            packId: pack.packId,
            offset: entry.offset,
            length: entry.length,
            type: entry.type,
          });
        }
      });

      // Update in-memory index with newly landed blobs
      for (const rec of newBlobIndexRecords) {
        remoteBlobs.set(rec.hash, rec);
      }

      // Phase 5: Writing index & snapshot
      this.status.phase = 'writing_snapshot';
      this.status.statusText = 'Writing snapshot';

      // 1. Upload new index file if new blobs were introduced
      if (newBlobIndexRecords.length > 0) {
        const indexPayload: IndexFile = {
          schemaVersion: 3,
          indexId: '',
          createdAt: new Date().toISOString(),
          blobs: newBlobIndexRecords,
        };
        const indexBuf = Buffer.from(JSON.stringify(indexPayload, null, 2), 'utf8');
        const indexHash = crypto.createHash('sha256').update(indexBuf).digest('hex');
        indexPayload.indexId = indexHash;

        await this.target.put(
          `index/${indexHash}.json`,
          Buffer.from(JSON.stringify(indexPayload, null, 2), 'utf8'),
          'application/json'
        );
      }

      // 2. Assemble Snapshot Manifest V3
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const entriesMap: Record<string, SnapshotEntryRef> = {};
      const assetsList: SnapshotAssetRef[] = [];
      const referencedPacks = new Set<string>();

      let dbExportRef = { path: 'db-store.json', blobHash: '', bytes: 0 };
      let assetMetaRef: { path: string; blobHash: string; bytes: number } | undefined = undefined;

      let entryCount = 0;
      let chunkCount = 0;
      let totalBytes = 0;

      for (const b of localBlobs) {
        totalBytes += b.bytes;
        const loc = remoteBlobs.get(b.hash);
        if (loc) {
          referencedPacks.add(loc.packId);
        }

        if (b.type === 'db') {
          dbExportRef = { path: b.relPath, blobHash: b.hash, bytes: b.bytes };
        } else if (b.type === 'asset_meta') {
          assetMetaRef = { path: b.relPath, blobHash: b.hash, bytes: b.bytes };
        } else if (b.type === 'manifest') {
          const match = b.relPath.match(/^entries\/([^/]+)\/manifest\.json$/);
          if (match) {
            const entId = match[1];
            if (!entriesMap[entId]) {
              entriesMap[entId] = { manifestBlobHash: b.hash, manifestPath: b.relPath, chunks: [] };
              entryCount++;
            } else {
              entriesMap[entId].manifestBlobHash = b.hash;
            }
          }
        } else if (b.type === 'chunk') {
          const match = b.relPath.match(/^entries\/([^/]+)\/chunks\/(.+)$/);
          if (match) {
            const entId = match[1];
            if (!entriesMap[entId]) {
              entriesMap[entId] = { manifestBlobHash: '', manifestPath: `entries/${entId}/manifest.json`, chunks: [] };
              entryCount++;
            }
            entriesMap[entId].chunks.push({
              path: b.relPath,
              blobHash: b.hash,
              bytes: b.bytes,
            });
            chunkCount++;
          }
        } else if (b.type === 'asset') {
          const fileName = path.basename(b.relPath);
          const assetId = fileName.replace(/\.[^.]+$/, '');
          assetsList.push({
            id: assetId,
            storageKey: fileName,
            mime: fileName.endsWith('.png') ? 'image/png' : 'image/jpeg',
            bytes: b.bytes,
            blobHash: b.hash,
          });
        }
      }

      const snapshotManifest: SnapshotManifestV3 = {
        schemaVersion: 3,
        snapshotId: '',
        createdAt: new Date().toISOString(),
        totalFiles: localBlobs.length,
        totalBytes,
        counts: {
          entries: entryCount,
          chunks: chunkCount,
          assets: assetsList.length,
          packs: referencedPacks.size,
        },
        dbExport: dbExportRef,
        assetMeta: assetMetaRef,
        entries: entriesMap,
        assets: assetsList,
        packs: Array.from(referencedPacks),
      };

      const manifestRawWithoutId = JSON.stringify(snapshotManifest, null, 2);
      const snapshotHash = crypto.createHash('sha256').update(manifestRawWithoutId).digest('hex').slice(0, 16);
      const snapshotId = `${timestamp}-${snapshotHash}`;
      snapshotManifest.snapshotId = snapshotId;

      const finalManifestBuf = Buffer.from(JSON.stringify(snapshotManifest, null, 2), 'utf8');

      // Ordering rule: Write snapshot file LAST!
      await this.target.put(`snapshots/${snapshotId}.json`, finalManifestBuf, 'application/json');
      await this.target.put(`snapshots/latest.json`, finalManifestBuf, 'application/json');

      // Phase 6: Done
      this.status.status = 'idle';
      this.status.phase = 'done';
      this.status.statusText = 'Backup: Up to date';
      this.status.lastBackupTime = snapshotManifest.createdAt;
      this.status.lastSnapshotId = snapshotId;
      this.status.uploadedCount = packsToUpload.length;
      this.status.processedCount = localBlobs.length;
      this.lastDataHash = await this.computeQuickDataHash();

      return {
        snapshotId,
        uploadedPacks: packsToUpload.length,
        newBlobsCount: newBlobs.length,
        skippedBlobsCount: skippedCount,
        manifest: snapshotManifest,
      };
    } catch (err: any) {
      this.status.status = 'failed';
      this.status.phase = 'idle';
      this.status.statusText = 'Backup failed · Retry';
      this.status.lastError = err.message || 'Backup failed';
      throw err;
    }
  }
}
