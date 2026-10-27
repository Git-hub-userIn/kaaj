import 'dotenv/config';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPrismaClient, closeDb } from '../apps/api/src/db/client.js';
import {
  canonicalDocJson,
  migrateDocumentToV2,
  reassembleDocFromChunks,
  splitBlocksIntoChunks,
  type TopLevelBlock,
} from '../packages/doc-model/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(rootDir, 'data');

export interface ImportOptions {
  dataDirectory?: string;
  targetDbUrl?: string;
}

export async function importFilesToPostgres(options: ImportOptions = {}): Promise<{
  categoriesImported: number;
  entriesImported: number;
  chunksImported: number;
  assetsImported: number;
}> {
  const sourceDir = options.dataDirectory || dataDir;
  const dbPath = path.join(sourceDir, 'db-store.json');

  if (!fsSync.existsSync(dbPath)) {
    throw new Error(`Cannot import: source file "${dbPath}" does not exist.`);
  }

  // 1. Immutable Backup First (reuse existing backup convention)
  const timestamp = Date.now();
  const backupDir = path.join(sourceDir, 'backups', `pre-import-${timestamp}`);
  await fs.mkdir(backupDir, { recursive: true });
  console.log(`Creating immutable safety backup in ${backupDir}...`);

  await fs.copyFile(dbPath, path.join(backupDir, 'db-store.json'));
  const storageMeta = path.join(sourceDir, 'storage', 'meta.json');
  if (fsSync.existsSync(storageMeta)) {
    await fs.copyFile(storageMeta, path.join(backupDir, 'storage-meta.json'));
  }
  const maintPath = path.join(sourceDir, 'maintenance-state.json');
  if (fsSync.existsSync(maintPath)) {
    await fs.copyFile(maintPath, path.join(backupDir, 'maintenance-state.json'));
  }

  // 2. Read old store
  const rawData = await fs.readFile(dbPath, 'utf8');
  const storeData = JSON.parse(rawData);
  const categories: any[] = storeData.categories || [];
  const entries: any[] = storeData.entries || [];

  console.log(`Loaded ${categories.length} categories and ${entries.length} entries from db-store.json.`);

  // 3. Prepare and Verify per Entry: reassembled canonical JSON equals old canonical JSON
  const preparedEntries: Array<{
    entry: any;
    manifest: any;
    chunks: Array<{ id: string; order: number; blocks: TopLevelBlock[]; checksum: string; bytes: number }>;
  }> = [];

  let totalChunksToInsert = 0;

  for (const entry of entries) {
    // Read or migrate document
    const migrationResult = migrateDocumentToV2(entry.doc);
    const docV2 = migrationResult.doc;
    const oldCanonical = canonicalDocJson(docV2.doc);

    // Read disk manifest if present to preserve stable chunk IDs
    let existingChunks: any[] = [];
    const entryDir = path.join(sourceDir, 'entries', entry.id);
    const manifestPath = path.join(entryDir, 'manifest.json');
    if (fsSync.existsSync(manifestPath)) {
      try {
        const mRaw = await fs.readFile(manifestPath, 'utf8');
        const mJson = JSON.parse(mRaw);
        existingChunks = mJson.chunks || [];
      } catch {}
    }

    const blocks = (docV2.doc?.content || []) as TopLevelBlock[];
    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      existingChunks,
      entryId: entry.id,
      version: entry.version || 1,
    });

    // Reassemble and strictly compare canonical JSON
    const reassembled = reassembleDocFromChunks(chunks.map((c) => ({ blocks: c.blocks })));
    const reassembledCanonical = canonicalDocJson(reassembled.doc);

    if (oldCanonical !== reassembledCanonical) {
      const err = `Verification failed for entry "${entry.id}" (${entry.title}): reassembled canonical JSON does not match old document JSON!`;
      console.error(err);
      throw new Error(err);
    }

    const entryChunks = chunks.map((c, idx) => {
      const canonicalChunk = canonicalDocJson(c.blocks);
      const checksum = crypto.createHash('sha256').update(canonicalChunk, 'utf8').digest('hex');
      const bytes = Buffer.byteLength(canonicalChunk, 'utf8');
      return {
        id: c.chunkId,
        order: idx,
        blocks: c.blocks,
        checksum,
        bytes,
      };
    });

    totalChunksToInsert += entryChunks.length;
    preparedEntries.push({
      entry,
      manifest,
      chunks: entryChunks,
    });
  }

  console.log(`Pre-verification PASSED for all ${entries.length} entries. No mismatch detected.`);

  // 4. Read AssetMeta
  let assetMetas: any[] = [];
  if (fsSync.existsSync(storageMeta)) {
    try {
      const rawMeta = await fs.readFile(storageMeta, 'utf8');
      const parsed = JSON.parse(rawMeta);
      if (Array.isArray(parsed)) assetMetas = parsed;
    } catch {}
  }

  // 5. Connect and Write to PostgreSQL via Prisma
  const prisma = getPrismaClient(options.targetDbUrl);

  try {
    // 5a. Upsert Categories
    for (const cat of categories) {
      await prisma.category.upsert({
        where: { id: cat.id },
        create: {
          id: cat.id,
          title: cat.title,
          description: cat.description ?? null,
          coverAssetId: cat.coverAssetId ?? null,
          sortOrder: cat.sortOrder ?? 0,
          color: cat.color ?? null,
          todo: Array.isArray(cat.todo) ? cat.todo : [],
          version: cat.version ?? 1,
          createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
          updatedAt: cat.updatedAt ? new Date(cat.updatedAt) : new Date(),
          deletedAt: cat.deletedAt ? new Date(cat.deletedAt) : null,
        },
        update: {
          title: cat.title,
          description: cat.description ?? null,
          coverAssetId: cat.coverAssetId ?? null,
          sortOrder: cat.sortOrder ?? 0,
          color: cat.color ?? null,
          todo: Array.isArray(cat.todo) ? cat.todo : [],
          version: cat.version ?? 1,
          updatedAt: cat.updatedAt ? new Date(cat.updatedAt) : new Date(),
          deletedAt: cat.deletedAt ? new Date(cat.deletedAt) : null,
        },
      });
    }

    // 5b. Upsert Entries, Chunks, Manifests
    for (const item of preparedEntries) {
      const e = item.entry;
      await prisma.entry.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          categoryId: e.categoryId,
          title: e.title,
          color: e.color ?? null,
          pinned: e.pinned ?? false,
          weight: e.weight ?? 1,
          sortOrder: e.sortOrder ?? 0,
          version: e.version ?? 1,
          schemaVersion: 2,
          spine: e.spine ? e.spine : undefined,
          stats: e.stats ? e.stats : undefined,
          lastOpenedAt: e.lastOpenedAt ? new Date(e.lastOpenedAt) : null,
          createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
          updatedAt: e.updatedAt ? new Date(e.updatedAt) : new Date(),
          deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
        },
        update: {
          categoryId: e.categoryId,
          title: e.title,
          color: e.color ?? null,
          pinned: e.pinned ?? false,
          weight: e.weight ?? 1,
          sortOrder: e.sortOrder ?? 0,
          version: e.version ?? 1,
          spine: e.spine ? e.spine : undefined,
          stats: e.stats ? e.stats : undefined,
          lastOpenedAt: e.lastOpenedAt ? new Date(e.lastOpenedAt) : null,
          updatedAt: e.updatedAt ? new Date(e.updatedAt) : new Date(),
          deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
        },
      });

      // Upsert Chunks
      for (const chk of item.chunks) {
        await prisma.chunk.upsert({
          where: {
            entryId_id: {
              entryId: e.id,
              id: chk.id,
            },
          },
          create: {
            id: chk.id,
            entryId: e.id,
            order: chk.order,
            version: e.version ?? 1,
            checksum: chk.checksum,
            bytes: chk.bytes,
            blockCount: chk.blocks.length,
            payload: chk.blocks as any,
          },
          update: {
            order: chk.order,
            version: e.version ?? 1,
            checksum: chk.checksum,
            bytes: chk.bytes,
            blockCount: chk.blocks.length,
            payload: chk.blocks as any,
          },
        });
      }

      // Upsert Manifest
      await prisma.entryManifest.upsert({
        where: { entryId: e.id },
        create: {
          id: `man_${crypto.randomUUID()}`,
          entryId: e.id,
          schemaVersion: 2,
          version: e.version ?? 1,
          totalBlocks: item.manifest.totalBlocks,
          chunkCount: item.manifest.chunkCount,
          stats: item.manifest.stats ? item.manifest.stats : undefined,
          chunks: item.manifest.chunks as any,
          updatedAt: new Date(item.manifest.updatedAt || Date.now()),
        },
        update: {
          schemaVersion: 2,
          version: e.version ?? 1,
          totalBlocks: item.manifest.totalBlocks,
          chunkCount: item.manifest.chunkCount,
          stats: item.manifest.stats ? item.manifest.stats : undefined,
          chunks: item.manifest.chunks as any,
          updatedAt: new Date(item.manifest.updatedAt || Date.now()),
        },
      });
    }

    // 5c. Upsert AssetMeta
    for (const asset of assetMetas) {
      if (asset && asset.id && asset.storageKey) {
        await prisma.assetMeta.upsert({
          where: { id: asset.id },
          create: {
            id: asset.id,
            storageKey: asset.storageKey,
            mime: asset.mime || 'application/octet-stream',
            bytes: asset.bytes || 0,
            width: asset.width ?? null,
            height: asset.height ?? null,
            originalName: asset.originalName ?? null,
            checksum: asset.checksum || '',
            createdAt: asset.createdAt ? new Date(asset.createdAt) : new Date(),
          },
          update: {
            storageKey: asset.storageKey,
            mime: asset.mime || 'application/octet-stream',
            bytes: asset.bytes || 0,
            width: asset.width ?? null,
            height: asset.height ?? null,
            originalName: asset.originalName ?? null,
            checksum: asset.checksum || '',
          },
        });
      }
    }

    // 5d. Import MaintenanceState if present
    if (fsSync.existsSync(maintPath)) {
      try {
        const mRaw = await fs.readFile(maintPath, 'utf8');
        const mState = JSON.parse(mRaw);
        await prisma.maintenanceState.upsert({
          where: { id: 'singleton' },
          create: {
            id: 'singleton',
            lastBackupAt: mState.lastBackupAt ? new Date(mState.lastBackupAt) : null,
            lastPruneAt: mState.lastPruneAt ? new Date(mState.lastPruneAt) : null,
            lastResult: mState.lastResult ?? null,
            lastError: mState.lastError ?? null,
            remoteFileCount: mState.remoteFileCount ?? null,
          },
          update: {
            lastBackupAt: mState.lastBackupAt ? new Date(mState.lastBackupAt) : null,
            lastPruneAt: mState.lastPruneAt ? new Date(mState.lastPruneAt) : null,
            lastResult: mState.lastResult ?? null,
            lastError: mState.lastError ?? null,
            remoteFileCount: mState.remoteFileCount ?? null,
          },
        });
      } catch {}
    }

    // 6. Verification: Check database counts match input counts
    const dbCategoryCount = await prisma.category.count();
    const dbEntryCount = await prisma.entry.count();
    const dbChunkCount = await prisma.chunk.count();
    const dbAssetCount = await prisma.assetMeta.count();

    console.log('Database Import Count Verification:');
    console.log(`  Categories: ${dbCategoryCount} (expected >= ${categories.length})`);
    console.log(`  Entries:    ${dbEntryCount} (expected >= ${entries.length})`);
    console.log(`  Chunks:     ${dbChunkCount} (expected >= ${totalChunksToInsert})`);
    console.log(`  AssetMeta:  ${dbAssetCount} (expected >= ${assetMetas.length})`);

    if (dbCategoryCount < categories.length || dbEntryCount < entries.length) {
      throw new Error('Database post-import count mismatch! Incomplete import.');
    }

    return {
      categoriesImported: dbCategoryCount,
      entriesImported: dbEntryCount,
      chunksImported: dbChunkCount,
      assetsImported: dbAssetCount,
    };
  } finally {
    if (!options.targetDbUrl) {
      await closeDb();
    }
  }
}

if (import.meta.main || process.argv[1]?.endsWith('db-import-files.ts')) {
  importFilesToPostgres()
    .then((res) => {
      console.log('db:import-files completed successfully:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('db:import-files failed:', err.message);
      process.exit(1);
    });
}
