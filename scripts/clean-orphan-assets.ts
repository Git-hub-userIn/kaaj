import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Information about a single orphan asset.
 */
export interface OrphanAssetInfo {
  id: string;
  bytes: number;
  mainFile?: string;
  thumbFiles: string[];
}

/**
 * Result returned by cleanOrphanAssets.
 */
export interface CleanOrphanAssetsResult {
  orphanAssets: OrphanAssetInfo[];
  orphanCount: number;
  totalBytes: number;
  deletedFilesCount: number;
  metaRemovedCount: number;
  applied: boolean;
  message: string;
}

/**
 * Extract asset ID from thumbnail filename.
 * Example: "asset_123_320.webp" returns "asset_123".
 */
export function getAssetIdFromThumbName(filename: string): string {
  const match = filename.match(/^(.+)_\d+\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[1];
  }
  return path.parse(filename).name;
}

/**
 * Scan an object recursively to extract referenced asset IDs.
 * Collects values from "attrs.assetId", "assetId", and "coverAssetId".
 */
export function scanForAssetIds(value: unknown, targetSet: Set<string>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      scanForAssetIds(item, targetSet);
    }
    return;
  }

  const record = value as Record<string, unknown>;

  // Check block attrs for assetId
  if (record.attrs && typeof record.attrs === 'object') {
    const attrs = record.attrs as Record<string, unknown>;
    if (typeof attrs.assetId === 'string' && attrs.assetId.trim()) {
      targetSet.add(attrs.assetId.trim());
    }
  }

  // Check direct assetId property
  if (typeof record.assetId === 'string' && record.assetId.trim()) {
    targetSet.add(record.assetId.trim());
  }

  // Check category coverAssetId property
  if (typeof record.coverAssetId === 'string' && record.coverAssetId.trim()) {
    targetSet.add(record.coverAssetId.trim());
  }

  // Traverse all child properties
  for (const key of Object.keys(record)) {
    if (key !== 'attrs') {
      scanForAssetIds(record[key], targetSet);
    }
  }
}

/**
 * Resolve directory paths from base data directory.
 */
function resolveDataPaths(baseDataDir: string) {
  let resolvedBase = path.resolve(baseDataDir);
  let storageDir = path.join(resolvedBase, 'storage');

  // Support direct storage directory as input
  if (
    !fsSync.existsSync(storageDir) &&
    (resolvedBase.endsWith('storage') || fsSync.existsSync(path.join(resolvedBase, 'thumbs')))
  ) {
    storageDir = resolvedBase;
    resolvedBase = path.dirname(resolvedBase);
  }

  return {
    baseDir: resolvedBase,
    storageDir,
    thumbsDir: path.join(storageDir, 'thumbs'),
    metaFile: path.join(storageDir, 'meta.json'),
    dbStorePath: path.join(resolvedBase, 'db-store.json'),
    entriesDir: path.join(resolvedBase, 'entries'),
  };
}

/**
 * Collect all referenced asset IDs from entries and categories.
 */
async function collectReferencedAssetIds(
  dbStorePath: string,
  entriesDir: string
): Promise<Set<string>> {
  const referenced = new Set<string>();

  // Read references from db-store.json
  try {
    const raw = await fs.readFile(dbStorePath, 'utf8');
    const db = JSON.parse(raw);

    // Read category cover assets
    if (Array.isArray(db.categories)) {
      for (const cat of db.categories) {
        if (cat && typeof cat.coverAssetId === 'string' && cat.coverAssetId.trim()) {
          referenced.add(cat.coverAssetId.trim());
        }
      }
    }

    // Read entry document references
    if (Array.isArray(db.entries)) {
      for (const entry of db.entries) {
        if (entry && entry.doc) {
          scanForAssetIds(entry.doc, referenced);
        }
      }
    }
  } catch {
    // File may not exist yet in test environments
  }

  // Read references from chunk files in entries directory
  try {
    const entryFolders = await fs.readdir(entriesDir, { withFileTypes: true });
    for (const folder of entryFolders) {
      if (!folder.isDirectory()) continue;

      const entryDirPath = path.join(entriesDir, folder.name);

      // Scan chunks directory
      const chunksDir = path.join(entryDirPath, 'chunks');
      try {
        const chunkFiles = await fs.readdir(chunksDir);
        for (const file of chunkFiles) {
          if (!file.endsWith('.json')) continue;
          try {
            const rawChunk = await fs.readFile(path.join(chunksDir, file), 'utf8');
            const chunkData = JSON.parse(rawChunk);
            scanForAssetIds(chunkData, referenced);
          } catch {
            // Ignore unreadable chunk file
          }
        }
      } catch {
        // Chunks directory may not exist
      }

      // Scan manifest file
      const manifestPath = path.join(entryDirPath, 'manifest.json');
      try {
        const rawManifest = await fs.readFile(manifestPath, 'utf8');
        const manifestData = JSON.parse(rawManifest);
        scanForAssetIds(manifestData, referenced);
      } catch {
        // Manifest file may not exist
      }
    }
  } catch {
    // Entries directory may not exist
  }

  return referenced;
}

interface DiscoveredAsset {
  id: string;
  mainFile?: string;
  thumbFiles: string[];
  bytes: number;
}

/**
 * Collect all assets stored on disk and registered in metadata.
 */
async function discoverStoredAssets(
  storageDir: string,
  thumbsDir: string,
  metaFile: string
): Promise<Map<string, DiscoveredAsset>> {
  const assetMap = new Map<string, DiscoveredAsset>();

  function getOrCreate(id: string): DiscoveredAsset {
    let item = assetMap.get(id);
    if (!item) {
      item = { id, thumbFiles: [], bytes: 0 };
      assetMap.set(id, item);
    }
    return item;
  }

  // Scan storage root for primary asset files
  try {
    const items = await fs.readdir(storageDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isFile()) continue;
      if (item.name === 'meta.json' || item.name.endsWith('.tmp')) continue;

      const id = path.parse(item.name).name;
      const fullPath = path.join(storageDir, item.name);
      const stat = await fs.stat(fullPath);

      const asset = getOrCreate(id);
      asset.mainFile = fullPath;
      asset.bytes += stat.size;
    }
  } catch {
    // Storage directory may not exist
  }

  // Scan thumbs directory for thumbnail files
  try {
    const thumbItems = await fs.readdir(thumbsDir, { withFileTypes: true });
    for (const item of thumbItems) {
      if (!item.isFile()) continue;

      const id = getAssetIdFromThumbName(item.name);
      const fullPath = path.join(thumbsDir, item.name);
      const stat = await fs.stat(fullPath);

      const asset = getOrCreate(id);
      asset.thumbFiles.push(fullPath);
      asset.bytes += stat.size;
    }
  } catch {
    // Thumbs directory may not exist
  }

  // Scan meta.json for registered records
  try {
    const raw = await fs.readFile(metaFile, 'utf8');
    const records = JSON.parse(raw);
    if (Array.isArray(records)) {
      for (const record of records) {
        if (!record || typeof record.id !== 'string') continue;
        const asset = getOrCreate(record.id);
        // Add recorded byte size if file is missing on disk
        if (asset.bytes === 0 && typeof record.bytes === 'number') {
          asset.bytes = record.bytes;
        }
      }
    }
  } catch {
    // Meta file may not exist
  }

  return assetMap;
}

/**
 * Remove orphan assets from storage, thumbnails, and metadata.
 *
 * @param baseDataDir Base directory containing storage and entries.
 * @param apply Set true to delete files. Defaults to false (dry run).
 */
export async function cleanOrphanAssets(
  baseDataDir: string,
  apply = false
): Promise<CleanOrphanAssetsResult> {
  const paths = resolveDataPaths(baseDataDir);

  // Collect references from database and chunks
  const referencedIds = await collectReferencedAssetIds(paths.dbStorePath, paths.entriesDir);

  // Discover all stored assets
  const storedAssets = await discoverStoredAssets(paths.storageDir, paths.thumbsDir, paths.metaFile);

  // Identify orphan assets
  const orphanAssets: OrphanAssetInfo[] = [];
  const orphanIdSet = new Set<string>();
  let totalBytes = 0;

  for (const [id, item] of storedAssets.entries()) {
    if (!referencedIds.has(id)) {
      orphanAssets.push({
        id: item.id,
        bytes: item.bytes,
        mainFile: item.mainFile,
        thumbFiles: item.thumbFiles,
      });
      orphanIdSet.add(id);
      totalBytes += item.bytes;
    }
  }

  let deletedFilesCount = 0;
  let metaRemovedCount = 0;

  if (apply) {
    // Delete orphan files from storage root
    for (const orphan of orphanAssets) {
      if (orphan.mainFile) {
        try {
          await fs.unlink(orphan.mainFile);
          deletedFilesCount++;
        } catch {
          // File may already be absent
        }
      }

      // Delete orphan thumbnail files
      for (const thumbPath of orphan.thumbFiles) {
        try {
          await fs.unlink(thumbPath);
          deletedFilesCount++;
        } catch {
          // File may already be absent
        }
      }
    }

    // Update meta.json to remove deleted asset records
    try {
      const raw = await fs.readFile(paths.metaFile, 'utf8');
      const records = JSON.parse(raw);
      if (Array.isArray(records)) {
        const remainingRecords = records.filter(
          (rec) => rec && typeof rec.id === 'string' && !orphanIdSet.has(rec.id)
        );
        metaRemovedCount = records.length - remainingRecords.length;

        // Write updated meta file atomically
        const tmpPath = `${paths.metaFile}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(remainingRecords, null, 2), 'utf8');
        await fs.rename(tmpPath, paths.metaFile);
      }
    } catch {
      // Meta file may not exist
    }
  }

  const orphanCount = orphanAssets.length;
  const message = apply
    ? `Cleanup completed. Deleted ${orphanCount} orphan assets (${totalBytes} bytes).`
    : `Dry run completed. Found ${orphanCount} orphan assets (${totalBytes} bytes). Pass --apply to delete.`;

  return {
    orphanAssets,
    orphanCount,
    totalBytes,
    deletedFilesCount,
    metaRemovedCount,
    applied: apply,
    message,
  };
}

/**
 * Main execution function for command line use.
 */
async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply') || args.includes('-f') || args.includes('--force');

  // Parse custom directory argument or use default
  let customDir = 'data';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir' && args[i + 1]) {
      customDir = args[i + 1];
      break;
    }
    if (!arg.startsWith('-')) {
      customDir = arg;
    }
  }

  console.log(`[clean-orphan-assets] Target directory: ${customDir}`);
  console.log(`[clean-orphan-assets] Mode: ${apply ? 'APPLY (delete files)' : 'DRY RUN (no deletions)'}`);

  try {
    const result = await cleanOrphanAssets(customDir, apply);

    // List each orphan asset
    if (result.orphanAssets.length > 0) {
      console.log('\nOrphan assets:');
      for (const asset of result.orphanAssets) {
        const fileCount = (asset.mainFile ? 1 : 0) + asset.thumbFiles.length;
        console.log(`  - ${asset.id} (${asset.bytes} bytes, ${fileCount} files)`);
      }
      console.log('');
    }

    console.log(result.message);
  } catch (error) {
    console.error('[clean-orphan-assets] Execution failed:', error);
    process.exit(1);
  }
}

// Detect direct CLI execution in Bun and Node environments
const isMainScript =
  (typeof (import.meta as unknown as { main?: boolean }).main === 'boolean' &&
    (import.meta as unknown as { main?: boolean }).main) ||
  (process.argv[1] &&
    (process.argv[1].endsWith('clean-orphan-assets.ts') ||
      process.argv[1].endsWith('clean-orphan-assets.js')));

if (isMainScript) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
