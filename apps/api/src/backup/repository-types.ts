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

export interface SnapshotEntryRef {
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
  };
  dbExport: {
    path: string;
    blobHash: string;
    bytes: number;
  };
  assetMeta?: {
    path: string;
    blobHash: string;
    bytes: number;
  };
  entries: Record<string, SnapshotEntryRef>;
  assets: SnapshotAssetRef[];
  packs: string[]; // List of pack IDs referenced by this snapshot
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
}
