import fs from 'node:fs/promises';
import path from 'node:path';
import {
  splitBlocksIntoChunks,
  reassembleDocFromChunks,
  canonicalDocJson,
  migrateDocumentToV2,
  type EntryManifest,
  type ChunkPayload,
  type DocumentEnvelopeV2,
  type TopLevelBlock,
} from '@kaaj/doc-model';
import type { EntryRecord } from './categories-service.js';

export interface MigrationResult {
  migratedCount: number;
  backupPath: string;
  entriesDir: string;
}

/**
 * Creates an immutable backup of the data directory before migration.
 */
export async function createDataBackup(baseDataDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupParent = path.dirname(baseDataDir);
  const backupDir = path.join(backupParent, `data-backup-${timestamp}`);

  await fs.mkdir(backupDir, { recursive: true });

  // Copy data folder contents recursively to backupDir (excluding any nested backup folders)
  try {
    await fs.cp(baseDataDir, backupDir, {
      recursive: true,
      filter: (src) => !src.includes('backups') && !src.includes('backup-snapshots'),
    });
  } catch (err) {
    console.warn('Backup copy error:', err);
  }

  return backupDir;
}

/**
 * Migrates entries to chunked storage layout.
 * Ensures reassembled chunks exactly equal original doc JSON before committing.
 * Idempotent: safe to run multiple times.
 */
export async function migrateEntriesToChunks(
  baseDataDir: string,
  entries: EntryRecord[]
): Promise<MigrationResult> {
  const backupPath = await createDataBackup(baseDataDir);
  const entriesDir = path.join(baseDataDir, 'entries');
  await fs.mkdir(entriesDir, { recursive: true });

  let migratedCount = 0;

  for (const entry of entries) {
    if (!entry.doc) continue;

    // Convert to v2 if legacy v1
    const v2Doc: DocumentEnvelopeV2 = entry.doc.schemaVersion === 2
      ? (entry.doc as DocumentEnvelopeV2)
      : migrateDocumentToV2(entry.doc).doc;

    const blocks: TopLevelBlock[] = Array.isArray(v2Doc.doc?.content)
      ? v2Doc.doc.content
      : [];

    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      entryId: entry.id,
      version: entry.version,
    });

    // Verification check: Reassembled doc must equal original v2 doc
    const reassembled = reassembleDocFromChunks(chunks);
    const origJson = canonicalDocJson(v2Doc);
    const reassembledJson = canonicalDocJson(reassembled);

    if (origJson !== reassembledJson) {
      throw new Error(
        `[MIGRATION ERROR] Verification failed for entry ${entry.id}. Reassembled JSON does not match original.`
      );
    }

    // Persist chunked files atomically
    const entryDir = path.join(entriesDir, entry.id);
    const chunksDir = path.join(entryDir, 'chunks');
    await fs.mkdir(chunksDir, { recursive: true });

    // Write chunk files
    for (const chunk of chunks) {
      const chunkFilePath = path.join(chunksDir, `${chunk.chunkId}.json`);
      const tmpChunkPath = `${chunkFilePath}.tmp`;
      await fs.writeFile(tmpChunkPath, JSON.stringify(chunk, null, 2), 'utf8');
      await fs.rename(tmpChunkPath, chunkFilePath);
    }

    // Write manifest
    const manifestPath = path.join(entryDir, 'manifest.json');
    const tmpManifestPath = `${manifestPath}.tmp`;
    await fs.writeFile(tmpManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(tmpManifestPath, manifestPath);

    // Write entry metadata
    const entryMetaPath = path.join(entryDir, 'entry.json');
    const tmpEntryMetaPath = `${entryMetaPath}.tmp`;
    const metaPayload = {
      id: entry.id,
      categoryId: entry.categoryId,
      title: entry.title,
      version: entry.version,
      weight: entry.weight,
      stats: entry.stats,
      spine: entry.spine,
      pinned: entry.pinned,
      color: entry.color,
      sortOrder: entry.sortOrder,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      deletedAt: entry.deletedAt,
    };
    await fs.writeFile(tmpEntryMetaPath, JSON.stringify(metaPayload, null, 2), 'utf8');
    await fs.rename(tmpEntryMetaPath, entryMetaPath);

    migratedCount++;
  }

  return {
    migratedCount,
    backupPath,
    entriesDir,
  };
}
