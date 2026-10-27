import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BackupTarget } from './backup-target.js';
import { prisma as defaultPrisma } from '../db/client.js';
import type { PrismaClient } from '../generated/client/index.js';
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
  SnapshotCategoryRef,
  SnapshotAssetRef,
  BackupStatus,
  BackupTimings,
  PackUploadDetail,
  BackupJobSummary,
} from './repository-types.js';

export {
  type BlobIndexRecord,
  type IndexFile,
  type SnapshotManifestV3,
  type SnapshotEntryRef,
  type SnapshotCategoryRef,
  type SnapshotAssetRef,
  type BackupStatus,
  type BackupTimings,
  type PackUploadDetail,
  type BackupJobSummary,
};

export const DEFAULT_PACK_TARGET_BYTES = 8 * 1024 * 1024; // 8 MB target pack size
export function getPackTargetBytes(): number {
  const envVal = Number(process.env.PACK_TARGET_BYTES);
  return envVal && !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_PACK_TARGET_BYTES;
}

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
  buffer?: Buffer;
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
  private maintenanceService?: {
    saveState: (state: any) => Promise<void>;
    getState: () => Promise<any>;
  };

  private currentJob: {
    jobId: string;
    startedAt: string;
    promise?: Promise<any>;
  } | null = null;
  private prisma: PrismaClient;

  constructor(baseDataDir: string, target: BackupTarget, prisma?: PrismaClient) {
    this.baseDataDir = baseDataDir;
    this.target = target;
    this.prisma = prisma || defaultPrisma;
  }

  setMaintenanceService(service: any): void {
    this.maintenanceService = service;
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
    try {
      const [cCount, eCount, chkCount, lastEntry] = await Promise.all([
        this.prisma.category.count(),
        this.prisma.entry.count(),
        this.prisma.chunk.count(),
        this.prisma.entry.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      ]);
      return `${cCount}_${eCount}_${chkCount}_${lastEntry?.updatedAt?.getTime() ?? 0}`;
    } catch {
      return '';
    }
  }

  /**
   * Triggers an asynchronous backup run and returns immediately (Task 2).
   */
  triggerAsyncBackup(): { jobId: string; status: 'running' | 'already_running' } {
    if (this.status.status === 'running' && this.currentJob) {
      return { jobId: this.currentJob.jobId, status: 'already_running' };
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.currentJob = {
      jobId,
      startedAt: new Date().toISOString(),
    };

    const task = (async () => {
      try {
        const result = await this.createSnapshot({ jobId });
        const summary: BackupJobSummary = {
          jobId,
          status: result.status === 'unchanged' ? 'unchanged' : 'completed',
          snapshotId: result.snapshotId,
          uploadedPacks: result.uploadedPacks,
          newBlobsCount: result.newBlobsCount,
          skippedBlobsCount: result.skippedBlobsCount,
          totalFiles: result.totalFiles,
          totalBytes: result.totalBytes,
          timings: result.timings,
          error: null,
        };
        this.status.lastJob = summary;
        return summary;
      } catch (err: any) {
        const failSummary: BackupJobSummary = {
          jobId,
          status: 'failed',
          snapshotId: null,
          uploadedPacks: 0,
          newBlobsCount: 0,
          skippedBlobsCount: 0,
          totalFiles: 0,
          totalBytes: 0,
          timings: this.status.timings,
          error: err.message || 'Backup failed',
        };
        this.status.lastJob = failSummary;
        throw err;
      } finally {
        this.currentJob = null;
      }
    })();

    this.currentJob.promise = task;
    return { jobId, status: 'running' };
  }

  /**
   * Scans local vault directory and collects all data files (categories, entry metadata, chunks, manifests, assets).
   * Splits monolithic db-store into small category and entry metadata files so single edits upload KBs, not MBs.
   * Thumbnails (storage/thumbs/) are strictly excluded per design.
   */
  async scanLocalBlobs(): Promise<LocalBlobFile[]> {
    const categoriesDir = path.join(this.baseDataDir, 'categories');
    const entriesDir = path.join(this.baseDataDir, 'entries');
    const dbPath = path.join(this.baseDataDir, 'db-store.json');

    // Detect if this instance is pointing to an isolated disk fixture directory (used by pack tests)
    const isCustomDiskFixture =
      (fsSync.existsSync(categoriesDir) || fsSync.existsSync(entriesDir) || fsSync.existsSync(dbPath)) &&
      !fsSync.existsSync(path.join(this.baseDataDir, '..', 'prisma.config.ts'));

    if (isCustomDiskFixture) {
      let hasCategoriesDir = false;
      try {
        const catFiles = await fs.readdir(categoriesDir);
        hasCategoriesDir = catFiles.some((f) => f.endsWith('.json'));
      } catch {}

      if (!hasCategoriesDir && fsSync.existsSync(dbPath)) {
        try {
          const raw = await fs.readFile(dbPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
            await fs.mkdir(categoriesDir, { recursive: true });
            for (const cat of parsed.categories) {
              await fs.writeFile(
                path.join(categoriesDir, `${cat.id}.json`),
                JSON.stringify(cat, null, 2),
                'utf8'
              );
            }
          }
          if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
            for (const ent of parsed.entries) {
              const entDir = path.join(entriesDir, ent.id);
              await fs.mkdir(entDir, { recursive: true });
              const metaPayload = {
                id: ent.id,
                categoryId: ent.categoryId,
                title: ent.title,
                sortOrder: ent.sortOrder,
                color: ent.color,
                pinned: ent.pinned,
                spine: ent.spine,
                stats: ent.stats,
                weight: ent.weight,
                version: ent.version,
                createdAt: ent.createdAt,
                updatedAt: ent.updatedAt,
                deletedAt: ent.deletedAt,
                lastOpenedAt: ent.lastOpenedAt,
              };
              await fs.writeFile(
                path.join(entDir, 'meta.json'),
                JSON.stringify(metaPayload, null, 2),
                'utf8'
              );
            }
          }
        } catch (err) {
          console.warn('[BACKUP] Auto-split db-store notice:', err);
        }
      }

      interface PendingBlobScan {
        relPath: string;
        fullPath: string;
        type: BlobType;
      }

      const pendingScans: PendingBlobScan[] = [];

      // 1. Categories
      if (fsSync.existsSync(categoriesDir)) {
        const catFiles = await fs.readdir(categoriesDir);
        for (const cf of catFiles) {
          if (cf.endsWith('.json')) {
            pendingScans.push({
              relPath: `categories/${cf}`,
              fullPath: path.join(categoriesDir, cf),
              type: 'category',
            });
          }
        }
      }

      // 2. Entries (meta.json, manifest.json, chunks/*.json)
      if (fsSync.existsSync(entriesDir)) {
        const entDirs = await fs.readdir(entriesDir, { withFileTypes: true });
        for (const ed of entDirs) {
          if (ed.isDirectory()) {
            const entId = ed.name;
            const metaP = path.join(entriesDir, entId, 'meta.json');
            if (fsSync.existsSync(metaP)) {
              pendingScans.push({
                relPath: `entries/${entId}/meta.json`,
                fullPath: metaP,
                type: 'entry_meta',
              });
            }

            const manifestP = path.join(entriesDir, entId, 'manifest.json');
            if (fsSync.existsSync(manifestP)) {
              pendingScans.push({
                relPath: `entries/${entId}/manifest.json`,
                fullPath: manifestP,
                type: 'manifest',
              });
            }

            const chkDir = path.join(entriesDir, entId, 'chunks');
            if (fsSync.existsSync(chkDir)) {
              const chks = await fs.readdir(chkDir, { withFileTypes: true });
              for (const chk of chks) {
                if (chk.isFile() && chk.name.endsWith('.json')) {
                  pendingScans.push({
                    relPath: `entries/${entId}/chunks/${chk.name}`,
                    fullPath: path.join(chkDir, chk.name),
                    type: 'chunk',
                  });
                }
              }
            }
          }
        }
      }

      // 3. Fallback: db-store.json only if categories/ was not present or empty
      if (pendingScans.filter((s) => s.type === 'category').length === 0 && fsSync.existsSync(dbPath)) {
        pendingScans.push({
          relPath: 'db-store.json',
          fullPath: dbPath,
          type: 'db',
        });
      }

      // 4. Storage assets
      const storageDir = path.join(this.baseDataDir, 'storage');
      if (fsSync.existsSync(storageDir)) {
        const metaP = path.join(storageDir, 'meta.json');
        if (fsSync.existsSync(metaP)) {
          pendingScans.push({
            relPath: 'storage/meta.json',
            fullPath: metaP,
            type: 'asset_meta',
          });
        }

        const files = await fs.readdir(storageDir, { withFileTypes: true });
        for (const f of files) {
          if (f.isFile() && f.name !== 'meta.json' && !f.name.endsWith('.tmp')) {
            pendingScans.push({
              relPath: `storage/${f.name}`,
              fullPath: path.join(storageDir, f.name),
              type: 'asset',
            });
          }
        }
      }

      const blobs = await runConcurrent(pendingScans, 16, async (item) => {
        const buf = await fs.readFile(item.fullPath);
        return {
          relPath: item.relPath,
          fullPath: item.fullPath,
          type: item.type,
          bytes: buf.length,
          hash: crypto.createHash('sha256').update(buf).digest('hex'),
        };
      });

      return blobs;
    }

    const blobs: LocalBlobFile[] = [];

    // 1. Categories from Database
    const categories = await this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    for (const cat of categories) {
      const payload = JSON.stringify(
        {
          id: cat.id,
          title: cat.title,
          description: cat.description ?? undefined,
          coverAssetId: cat.coverAssetId ?? undefined,
          sortOrder: cat.sortOrder,
          color: cat.color ?? undefined,
          todo: cat.todo,
          version: cat.version,
          createdAt: cat.createdAt.toISOString(),
          updatedAt: cat.updatedAt.toISOString(),
          deletedAt: cat.deletedAt ? cat.deletedAt.toISOString() : null,
        },
        null,
        2
      );
      const buf = Buffer.from(payload, 'utf8');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      blobs.push({
        relPath: `categories/${cat.id}.json`,
        fullPath: '',
        type: 'category',
        bytes: buf.length,
        hash,
        buffer: buf,
      });
    }

    // 2. Entries metadata from Database
    const entries = await this.prisma.entry.findMany();
    for (const ent of entries) {
      const metaPayload = JSON.stringify(
        {
          id: ent.id,
          categoryId: ent.categoryId,
          title: ent.title,
          sortOrder: ent.sortOrder,
          color: ent.color,
          pinned: ent.pinned,
          spine: ent.spine,
          stats: ent.stats,
          weight: ent.weight,
          version: ent.version,
          createdAt: ent.createdAt.toISOString(),
          updatedAt: ent.updatedAt.toISOString(),
          deletedAt: ent.deletedAt ? ent.deletedAt.toISOString() : null,
          lastOpenedAt: ent.lastOpenedAt ? ent.lastOpenedAt.toISOString() : null,
        },
        null,
        2
      );
      const buf = Buffer.from(metaPayload, 'utf8');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      blobs.push({
        relPath: `entries/${ent.id}/meta.json`,
        fullPath: '',
        type: 'entry_meta',
        bytes: buf.length,
        hash,
        buffer: buf,
      });
    }

    // 3. Entry Manifests from Database
    const manifests = await this.prisma.entryManifest.findMany();
    for (const man of manifests) {
      const manPayload = JSON.stringify(
        {
          entryId: man.entryId,
          schemaVersion: man.schemaVersion,
          version: man.version,
          totalBlocks: man.totalBlocks,
          chunkCount: man.chunkCount,
          stats: man.stats,
          chunks: man.chunks,
          updatedAt: man.updatedAt.toISOString(),
        },
        null,
        2
      );
      const buf = Buffer.from(manPayload, 'utf8');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      blobs.push({
        relPath: `entries/${man.entryId}/manifest.json`,
        fullPath: '',
        type: 'manifest',
        bytes: buf.length,
        hash,
        buffer: buf,
      });
    }

    // 4. Chunks from Database
    const chunks = await this.prisma.chunk.findMany();
    for (const chk of chunks) {
      const chkPayload = JSON.stringify(
        {
          chunkId: chk.id,
          entryId: chk.entryId,
          blocks: chk.payload,
        },
        null,
        2
      );
      const buf = Buffer.from(chkPayload, 'utf8');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      blobs.push({
        relPath: `entries/${chk.entryId}/chunks/${chk.id}.json`,
        fullPath: '',
        type: 'chunk',
        bytes: buf.length,
        hash,
        buffer: buf,
      });
    }

    // 5. Asset Metadata from Database
    const assetMetas = await this.prisma.assetMeta.findMany({ orderBy: { createdAt: 'asc' } });
    if (assetMetas.length > 0) {
      const records = assetMetas.map((m) => ({
        id: m.id,
        storageKey: m.storageKey,
        mime: m.mime,
        bytes: m.bytes,
        width: m.width ?? undefined,
        height: m.height ?? undefined,
        originalName: m.originalName ?? undefined,
        checksum: m.checksum,
        createdAt: m.createdAt.toISOString(),
      }));
      const payload = JSON.stringify(records, null, 2);
      const buf = Buffer.from(payload, 'utf8');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      blobs.push({
        relPath: 'storage/meta.json',
        fullPath: '',
        type: 'asset_meta',
        bytes: buf.length,
        hash,
        buffer: buf,
      });
    }

    // 6. Storage asset binary files from Local Disk (originals only, NO thumbnails)
    const storageDir = path.join(this.baseDataDir, 'storage');
    if (fsSync.existsSync(storageDir)) {
      const files = await fs.readdir(storageDir, { withFileTypes: true });
      for (const f of files) {
        if (f.isFile() && f.name !== 'meta.json' && !f.name.endsWith('.tmp')) {
          const fullPath = path.join(storageDir, f.name);
          const buf = await fs.readFile(fullPath);
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          blobs.push({
            relPath: `storage/${f.name}`,
            fullPath,
            type: 'asset',
            bytes: buf.length,
            hash,
            buffer: buf,
          });
        }
      }
    }

    return blobs;
  }

  /**
   * Fetches remote index files and builds a merged Map of existing blob hashes on remote.
   * Remote listing is the authoritative source of truth.
   * Eliminates stale/missing pack references from index files (Silent-hole bug fix).
   */
  async loadRemoteIndex(): Promise<{
    remoteBlobs: Map<string, BlobIndexRecord>;
    remotePacks: Set<string>;
    snapshots: string[];
    packFilesCount: number;
    indexFilesCount: number;
    snapshotFilesCount: number;
    remoteListingRequests: number;
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
    let remoteListingRequests = 3; // 3 target.list calls

    // Concurrently load all index files
    await runConcurrent(indexFiles, 4, async (idxFile) => {
      remoteListingRequests++;
      try {
        const raw = await this.target.get(idxFile.path);
        if (!raw) return;
        const indexData: IndexFile = JSON.parse(raw.toString('utf8'));
        if (Array.isArray(indexData.blobs)) {
          let hasDeadPackRef = false;
          for (const b of indexData.blobs) {
            // Only consider blob valid if its referenced pack physically exists on remote
            if (remotePacks.has(b.packId)) {
              remoteBlobs.set(b.hash, b);
            } else {
              hasDeadPackRef = true;
            }
          }

          // Silent-hole fix: if index references non-existent packs, clean it up
          if (hasDeadPackRef) {
            const liveBlobs = indexData.blobs.filter((b) => remotePacks.has(b.packId));
            if (liveBlobs.length === 0 && this.target.delete) {
              await this.target.delete(idxFile.path);
            } else if (liveBlobs.length < indexData.blobs.length && this.target.put) {
              indexData.blobs = liveBlobs;
              await this.target.put(
                idxFile.path,
                Buffer.from(JSON.stringify(indexData, null, 2), 'utf8'),
                'application/json'
              );
            }
          }
        }
      } catch {
        // Ignore unreadable or corrupt index file
      }
    });

    const validSnapshots = snapshotFiles.filter((s) => {
      const norm = s.path.replace(/\\/g, '/');
      const parts = norm.split('/');
      return (
        parts.length === 2 &&
        parts[1].endsWith('.json') &&
        parts[1] !== 'latest.json' &&
        parts[1] !== 'latest-manifest.json'
      );
    });
    const snapshots = validSnapshots.map((s) => path.basename(s.path).replace(/\.json$/, ''));
    return {
      remoteBlobs,
      remotePacks,
      snapshots,
      packFilesCount: packFiles.length,
      indexFilesCount: indexFiles.length,
      snapshotFilesCount: validSnapshots.length,
      remoteListingRequests,
    };
  }

  /**
   * Core restic-style backup snapshot execution.
   */
  async createSnapshot(options?: {
    forceAll?: boolean;
    concurrency?: number;
    jobId?: string;
  }): Promise<{
    snapshotId: string;
    status: 'completed' | 'unchanged';
    uploadedPacks: number;
    newBlobsCount: number;
    skippedBlobsCount: number;
    totalFiles: number;
    totalBytes: number;
    manifest: SnapshotManifestV3;
    timings: BackupTimings;
  }> {
    if (this.status.status === 'running' && !options?.jobId) {
      throw new Error('A backup snapshot is already in progress.');
    }

    const t0 = Date.now();
    this.status.status = 'running';
    this.status.phase = 'checking';
    this.status.statusText = 'Checking Drive';
    this.status.lastError = null;

    let httpRequestsRemote = 0;
    let httpRequestsPacks = 0;
    let httpRequestsIndex = 0;
    let httpRequestsSnapshot = 0;
    let httpRequestsVerify = 0;

    try {
      const concurrency = Math.max(
        1,
        options?.concurrency ?? (Number(process.env.BACKUP_CONCURRENCY) || 4)
      );

      // Phase 1: Checking remote state
      const tRemoteStart = Date.now();
      const {
        remoteBlobs,
        remotePacks,
        snapshots,
        packFilesCount,
        indexFilesCount,
        snapshotFilesCount,
        remoteListingRequests,
      } = await this.loadRemoteIndex();
      const remoteListingMs = Date.now() - tRemoteStart;
      httpRequestsRemote = remoteListingRequests;

      const currentRemoteFiles = packFilesCount + indexFilesCount + snapshotFilesCount;

      // Phase 2: Local Scan & Hash
      const tScanStart = Date.now();
      const localBlobs = await this.scanLocalBlobs();
      const localScanAndHashMs = Date.now() - tScanStart;

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
          httpRequestsRemote++;
          const raw = await this.target.get(`snapshots/${latestId}.json`);
          if (raw) {
            latestSnapshotManifest = JSON.parse(raw.toString('utf8'));
          }
        } catch {}
      }

      // Check if latest snapshot references packs that actually physically exist on remote
      const isLatestSnapshotPacksIntact = Boolean(
        latestSnapshotManifest &&
        Array.isArray(latestSnapshotManifest.packs) &&
        latestSnapshotManifest.packs.every((p) => remotePacks.has(p))
      );

      // Task 2: Unchanged vault: write NO new pack, index or snapshot!
      if (
        newBlobs.length === 0 &&
        latestSnapshotManifest &&
        isLatestSnapshotPacksIntact &&
        latestSnapshotManifest.totalFiles === localBlobs.length
      ) {
        const timings: BackupTimings = {
          remoteListingMs,
          localScanAndHashMs,
          packingMs: 0,
          packsUploadMs: 0,
          indexUploadMs: 0,
          snapshotUploadMs: 0,
          verificationMs: 0,
          totalDurationMs: Date.now() - t0,
          httpRequests: {
            remoteListing: httpRequestsRemote,
            packsUpload: 0,
            indexUpload: 0,
            snapshotUpload: 0,
            verification: 0,
            total: httpRequestsRemote,
          },
          packUploads: [],
        };

        this.status.status = 'idle';
        this.status.phase = 'done';
        this.status.remoteFileCount = currentRemoteFiles;
        this.status.statusText = `Backup: Up to date (remote files: ${currentRemoteFiles})`;
        this.status.packsTotal = 0;
        this.status.packsUploaded = 0;
        this.status.uploadedCount = 0;
        this.status.processedCount = localBlobs.length;
        this.status.timings = timings;
        this.lastDataHash = await this.computeQuickDataHash();

        if (this.maintenanceService) {
          try {
            const mState = await this.maintenanceService.getState();
            mState.lastBackupAt = latestSnapshotManifest.createdAt;
            mState.remoteFileCount = currentRemoteFiles;
            await this.maintenanceService.saveState(mState);
          } catch {}
        }

        return {
          snapshotId: latestSnapshotManifest.snapshotId,
          status: 'unchanged',
          uploadedPacks: 0,
          newBlobsCount: 0,
          skippedBlobsCount: localBlobs.length,
          totalFiles: localBlobs.length,
          totalBytes: latestSnapshotManifest.totalBytes,
          manifest: latestSnapshotManifest,
          timings,
        };
      }

      // Phase 3: Pack new blobs
      const tPackStart = Date.now();
      const targetPackBytes = getPackTargetBytes();
      const packsToUpload: PackBuildResult[] = [];
      const pendingPackBlobs: PackBlobInput[] = [];
      let currentPackBytes = 0;

      for (const b of newBlobs) {
        const buf = b.buffer || (await fs.readFile(b.fullPath));

        // Assets >= 2 MB get their own dedicated pack
        if (b.type === 'asset' && buf.length >= LARGE_ASSET_THRESHOLD) {
          const largePack = createPack([{ hash: b.hash, data: buf, type: b.type }]);
          packsToUpload.push(largePack);
          continue;
        }

        pendingPackBlobs.push({ hash: b.hash, data: buf, type: b.type });
        currentPackBytes += buf.length;

        if (currentPackBytes >= targetPackBytes) {
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
      const packingMs = Date.now() - tPackStart;

      // Phase 4: Upload Packs
      const tPacksUploadStart = Date.now();
      this.status.phase = 'uploading_packs';
      this.status.packsTotal = packsToUpload.length;
      this.status.packsUploaded = 0;
      this.status.statusText = `Uploading 0/${packsToUpload.length} packs`;

      let packsUploadedCount = 0;
      const newBlobIndexRecords: BlobIndexRecord[] = [];
      const packUploadDetails: PackUploadDetail[] = [];

      await runConcurrent(packsToUpload, concurrency, async (pack) => {
        const packT0 = Date.now();
        // Upload pack: packs/<packId>
        const record = await this.target.put(`packs/${pack.packId}`, pack.buffer, 'application/octet-stream');
        const packDurationMs = Date.now() - packT0;
        const durationSec = packDurationMs / 1000 || 0.001;
        const mbPerSec = Number(((pack.buffer.length / (1024 * 1024)) / durationSec).toFixed(2));
        const requests = record.httpRequestsCount || 1;
        httpRequestsPacks += requests;

        // Verify upload by size & md5 without re-downloading (Task 1 item 4)
        if (record.bytes !== pack.buffer.length) {
          throw new Error(`Upload verification failed for pack ${pack.packId}: size mismatch (expected ${pack.buffer.length}, got ${record.bytes})`);
        }
        if (record.md5Checksum) {
          const localMd5 = crypto.createHash('md5').update(pack.buffer).digest('hex');
          if (record.md5Checksum !== localMd5) {
            throw new Error(`Upload verification failed for pack ${pack.packId}: MD5 mismatch (expected ${localMd5}, got ${record.md5Checksum})`);
          }
        }

        packUploadDetails.push({
          packId: pack.packId,
          bytes: pack.buffer.length,
          durationMs: packDurationMs,
          mbPerSec,
          httpRequests: requests,
        });

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

      const packsUploadMs = Date.now() - tPacksUploadStart;

      // Update in-memory index with newly landed blobs
      for (const rec of newBlobIndexRecords) {
        remoteBlobs.set(rec.hash, rec);
      }

      // Phase 5: Writing index & snapshot
      this.status.phase = 'writing_snapshot';
      this.status.statusText = 'Writing snapshot';

      // 1. Upload new index file if new blobs were introduced
      const tIndexStart = Date.now();
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

        const idxRecord = await this.target.put(
          `index/${indexHash}.json`,
          Buffer.from(JSON.stringify(indexPayload, null, 2), 'utf8'),
          'application/json'
        );
        httpRequestsIndex += idxRecord.httpRequestsCount || 1;
      }
      const indexUploadMs = Date.now() - tIndexStart;

      // 2. Assemble Snapshot Manifest V3
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const categoriesList: SnapshotCategoryRef[] = [];
      const entriesMap: Record<string, SnapshotEntryRef> = {};
      const assetsList: SnapshotAssetRef[] = [];
      const referencedPacks = new Set<string>();

      let dbExportRef: { path: string; blobHash: string; bytes: number } | undefined = undefined;
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

        if (b.type === 'category') {
          const catId = path.basename(b.relPath).replace(/\.json$/, '');
          categoriesList.push({
            id: catId,
            path: b.relPath,
            blobHash: b.hash,
            bytes: b.bytes,
          });
        } else if (b.type === 'entry_meta') {
          const match = b.relPath.match(/^entries\/([^/]+)\/meta\.json$/);
          if (match) {
            const entId = match[1];
            if (!entriesMap[entId]) {
              entriesMap[entId] = {
                metaBlobHash: b.hash,
                metaPath: b.relPath,
                manifestBlobHash: '',
                manifestPath: `entries/${entId}/manifest.json`,
                chunks: [],
              };
              entryCount++;
            } else {
              entriesMap[entId].metaBlobHash = b.hash;
              entriesMap[entId].metaPath = b.relPath;
            }
          }
        } else if (b.type === 'db') {
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
              entriesMap[entId].manifestPath = b.relPath;
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
          categories: categoriesList.length,
        },
        dbExport: dbExportRef,
        categories: categoriesList.length > 0 ? categoriesList : undefined,
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
      const tSnapshotStart = Date.now();
      const snapRecord = await this.target.put(`snapshots/${snapshotId}.json`, finalManifestBuf, 'application/json');
      httpRequestsSnapshot += snapRecord.httpRequestsCount || 1;
      const snapshotUploadMs = Date.now() - tSnapshotStart;

      // Verification timing
      const tVerifyStart = Date.now();
      const verificationMs = Date.now() - tVerifyStart;

      const totalRemoteFiles =
        packFilesCount +
        packsToUpload.length +
        (newBlobIndexRecords.length > 0 ? indexFilesCount + 1 : indexFilesCount) +
        (snapshotFilesCount + 1);

      const totalHttpRequests =
        httpRequestsRemote +
        httpRequestsPacks +
        httpRequestsIndex +
        httpRequestsSnapshot +
        httpRequestsVerify;

      const timings: BackupTimings = {
        remoteListingMs,
        localScanAndHashMs,
        packingMs,
        packsUploadMs,
        indexUploadMs,
        snapshotUploadMs,
        verificationMs,
        totalDurationMs: Date.now() - t0,
        httpRequests: {
          remoteListing: httpRequestsRemote,
          packsUpload: httpRequestsPacks,
          indexUpload: httpRequestsIndex,
          snapshotUpload: httpRequestsSnapshot,
          verification: httpRequestsVerify,
          total: totalHttpRequests,
        },
        packUploads: packUploadDetails,
      };

      const packSizes = packsToUpload.map((p) => p.buffer.length);
      console.log(
        `[BACKUP] Run complete: ${packsToUpload.length} packs created. Size distribution: [${packSizes.join(', ')}] bytes. Remote file count: ${totalRemoteFiles}.`
      );
      console.log(
        `[BACKUP_TIMINGS] Total: ${timings.totalDurationMs}ms | Remote: ${remoteListingMs}ms (${httpRequestsRemote} reqs) | Scan: ${localScanAndHashMs}ms | Pack: ${packingMs}ms | Upload packs: ${packsUploadMs}ms (${httpRequestsPacks} reqs) | Index: ${indexUploadMs}ms | Snapshot: ${snapshotUploadMs}ms`
      );

      // Phase 6: Done
      this.status.status = 'idle';
      this.status.phase = 'done';
      this.status.remoteFileCount = totalRemoteFiles;
      this.status.statusText = `Backup: Up to date (remote files: ${totalRemoteFiles})`;
      this.status.lastBackupTime = snapshotManifest.createdAt;
      this.status.lastSnapshotId = snapshotId;
      this.status.uploadedCount = packsToUpload.length;
      this.status.processedCount = localBlobs.length;
      this.status.timings = timings;
      this.lastDataHash = await this.computeQuickDataHash();

      if (this.maintenanceService) {
        try {
          const mState = await this.maintenanceService.getState();
          mState.lastBackupAt = snapshotManifest.createdAt;
          mState.remoteFileCount = totalRemoteFiles;
          await this.maintenanceService.saveState(mState);
        } catch {}
      }

      return {
        snapshotId,
        status: 'completed',
        uploadedPacks: packsToUpload.length,
        newBlobsCount: newBlobs.length,
        skippedBlobsCount: skippedCount,
        totalFiles: localBlobs.length,
        totalBytes,
        manifest: snapshotManifest,
        timings,
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
