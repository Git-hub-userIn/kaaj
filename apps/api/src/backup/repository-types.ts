import type { BlobType } from './pack-format.js';

export interface BlobIndexRecord {
  hash: string;
  packId: string;
  offset: number;
  length: number;
  type: BlobType;
}

export interface IndexFile {
  schemaVersion: 3;
  indexId: string;
  createdAt: string;
  blobs: BlobIndexRecord[];
}

export interface SnapshotCategoryRef {
  id: string;
  path: string;
  blobHash: string;
  bytes: number;
}

export interface SnapshotEntryRef {
  metaBlobHash?: string;
  metaPath?: string;
  manifestBlobHash: string;
  manifestPath: string;
  chunks: Array<{ path: string; blobHash: string; bytes: number }>;
}

export interface SnapshotAssetRef {
  id: string;
  storageKey: string;
  mime: string;
  bytes: number;
  blobHash: string;
}

export interface SnapshotManifestV3 {
  schemaVersion: 3;
  snapshotId: string; // <timestamp>-<hash>
  createdAt: string;
  totalFiles: number;
  totalBytes: number;
  counts: {
    entries: number;
    chunks: number;
    assets: number;
    packs: number;
    categories?: number;
  };
  dbExport?: {
    path: string;
    blobHash: string;
    bytes: number;
  };
  categories?: SnapshotCategoryRef[];
  assetMeta?: {
    path: string;
    blobHash: string;
    bytes: number;
  };
  entries: Record<string, SnapshotEntryRef>;
  assets: SnapshotAssetRef[];
  packs: string[]; // List of pack IDs referenced by this snapshot
}

export interface PackUploadDetail {
  packId: string;
  bytes: number;
  durationMs: number;
  mbPerSec: number;
  httpRequests: number;
}

export interface BackupTimings {
  remoteListingMs: number;
  localScanAndHashMs: number;
  packingMs: number;
  packsUploadMs: number;
  indexUploadMs: number;
  snapshotUploadMs: number;
  verificationMs: number;
  totalDurationMs: number;
  httpRequests: {
    remoteListing: number;
    packsUpload: number;
    indexUpload: number;
    snapshotUpload: number;
    verification: number;
    total: number;
  };
  packUploads: PackUploadDetail[];
}

export interface BackupJobSummary {
  jobId: string;
  status: 'completed' | 'unchanged' | 'failed';
  snapshotId: string | null;
  uploadedPacks: number;
  newBlobsCount: number;
  skippedBlobsCount: number;
  totalFiles: number;
  totalBytes: number;
  timings?: BackupTimings;
  error?: string | null;
}

export interface BackupStatus {
  status: 'idle' | 'running' | 'failed';
  phase?: 'idle' | 'checking' | 'uploading_packs' | 'writing_snapshot' | 'done';
  statusText?: string;
  lastBackupTime: string | null;
  lastCleanupTime?: string | null;
  lastError: string | null;
  lastSnapshotId: string | null;
  packsTotal?: number;
  packsUploaded?: number;
  uploadedCount?: number;
  totalFiles?: number;
  processedCount?: number;
  remoteFileCount?: number;
  timings?: BackupTimings;
  lastJob?: BackupJobSummary;
}
