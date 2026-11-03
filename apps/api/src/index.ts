import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import path from 'node:path';
import fsSync from 'node:fs';
import { LocalDiskAssetStore } from './stores/asset-store.js';
import {
  DocumentEnvelopeSchema,
  CreateEntrySchema,
  UpdateEntrySchema,
  calculateWeight,
  calculateEntryStats,
  ENTRY_SIZE_LIMITS,
  migrateDocumentToV2,
} from '@kaaj/doc-model';
import { renderDocumentToPdf } from './services/pdf-service.js';
import { CategoriesService } from './services/categories-service.js';
import { ImportExportService } from './services/import-export-service.js';
import { WsSyncService } from './services/ws-sync-service.js';
import { createBunWebSocket } from 'hono/bun';
import { authGuard } from './auth/guard.js';
import { BackupService } from './backup/backup-service.js';
import { LocalFolderBackupTarget } from './backup/local-backup-target.js';
import { pruneBackups } from './backup/backup-prune.js';
import { checkBackupRepository } from './backup/backup-check.js';
import { MaintenanceService } from './backup/maintenance-service.js';
import { MaintenanceScheduler } from './backup/maintenance-scheduler.js';
import {
  GoogleDriveBackupTarget,
  generateGoogleAuthUrl,
  exchangeCodeForTokens,
} from './backup/google-drive-backup-target.js';
import { checkPostgresReachable, closeDb, resolveDatabaseUrl, ensureUser } from './db/client.js';

const app = new Hono();

app.use('*', cors());
app.use('*', authGuard);

// Locate repository root reliably
function findRepoRoot(startDir: string): string {
  let curr = path.resolve(startDir);
  while (curr !== path.dirname(curr)) {
    if (fsSync.existsSync(path.join(curr, 'package.json')) && fsSync.existsSync(path.join(curr, 'packages'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

const repoRoot = findRepoRoot(process.cwd());
const storageDir = path.resolve(repoRoot, 'data', 'storage');
const baseDataDir = path.resolve(repoRoot, 'data');
const seedCoversDir = path.resolve(repoRoot, 'packages', 'design', 'assets', 'seed-covers');

const assetStore = new LocalDiskAssetStore(storageDir);
const categoriesService = new CategoriesService(baseDataDir, assetStore, seedCoversDir);

// Check PostgreSQL connectivity at startup (fail fast with clear diagnostics)
await checkPostgresReachable();

const defaultBackupDir = process.env.BACKUP_DIR || path.resolve(repoRoot, 'data', 'backup-snapshots');
const tokenFilePath = process.env.GOOGLE_TOKEN_FILE || path.resolve(baseDataDir, 'google-oauth.json');
const cacheFilePath = process.env.GOOGLE_DRIVE_CACHE_FILE || path.resolve(baseDataDir, 'drive-file-cache.json');
const driveFolderName = process.env.BACKUP_DRIVE_FOLDER_NAME || (process.env.APP_MODE === 'test' ? 'Kaaj-test' : 'Kaaj');

const googleDriveTarget = new GoogleDriveBackupTarget({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  tokenFilePath,
  cacheFilePath,
  folderName: driveFolderName,
});

const localBackupTarget = new LocalFolderBackupTarget(defaultBackupDir);
const backupTargetMode = (process.env.BACKUP_TARGET || '').toLowerCase();
const isTestMode = process.env.APP_MODE === 'test';
const activeBackupTarget =
  backupTargetMode === 'local' || (isTestMode && backupTargetMode !== 'drive')
    ? localBackupTarget
    : backupTargetMode === 'drive'
    ? googleDriveTarget
    : googleDriveTarget.hasValidAuth()
    ? googleDriveTarget
    : localBackupTarget;

const backupService = new BackupService(baseDataDir, activeBackupTarget);
const maintenanceService = new MaintenanceService(baseDataDir, activeBackupTarget);
backupService.setMaintenanceService(maintenanceService);
backupService.startPeriodicTimer();

const maintenanceScheduler = new MaintenanceScheduler(maintenanceService);
maintenanceScheduler.start();

// Helper to extract authenticated userId from request context
function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new Error('Unauthorized: missing authenticated user context');
  }
  return userId as string;
}

app.get('/health', (c) => {
  const bunGlobal = (globalThis as unknown as { Bun?: { version: string } }).Bun;
  return c.json({
    status: 'ok',
    phase: 'Phase 1 & 2',
    appMode: process.env.APP_MODE || 'development',
    driveFolderName,
    backupTarget: activeBackupTarget.name,
    runtime: bunGlobal ? `Bun ${bunGlobal.version}` : `Node ${process.version}`,
    timestamp: new Date().toISOString(),
  });
});

// Category Endpoints
app.get('/categories', async (c) => {
  const categories = await categoriesService.forUser(getUserId(c)).listCategories();
  return c.json(categories);
});

app.get('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const cat = await categoriesService.forUser(getUserId(c)).getCategory(id);
  if (!cat) {
    return c.json({ error: 'Category not found' }, 404);
  }
  c.header('ETag', `"${cat.version}"`);
  return c.json(cat);
});

app.get('/categories/:id/stats', async (c) => {
  const id = c.req.param('id');
  const stats = await categoriesService.forUser(getUserId(c)).getCategoryStats(id);
  if (!stats) {
    return c.json({ error: 'Category not found' }, 404);
  }
  return c.json(stats);
});

app.get('/categories/:id/entries', async (c) => {
  const id = c.req.param('id');
  const tag = c.req.query('tag');
  const catSvc = categoriesService.forUser(getUserId(c));
  const cat = await catSvc.getCategory(id);
  if (!cat) {
    return c.json({ error: 'Category not found' }, 404);
  }
  const entries = await catSvc.listEntriesForCategory(id, undefined, tag);
  return c.json(entries);
});

app.post('/categories', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'Title is required' }, 400);
    }
    const category = await categoriesService.forUser(getUserId(c)).createCategory(body.title, body.coverAssetId, body.color);
    return c.json(category, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create category' }, 422);
  }
});

app.patch('/categories/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const ifMatch = c.req.header('if-match');
    let expectedVersion: number | undefined;
    if (ifMatch) {
      const parsed = parseInt(ifMatch.replace(/["W\/]/g, '').trim(), 10);
      if (!Number.isNaN(parsed)) {
        expectedVersion = parsed;
      }
    }
    const body = await c.req.json();
    const result = await categoriesService.forUser(getUserId(c)).updateCategory(id, body, expectedVersion);
    if (!result) {
      return c.json({ error: 'Category not found' }, 404);
    }
    if ('conflict' in result) {
      return c.json({ error: 'Version conflict', currentVersion: result.currentVersion }, 409);
    }
    c.header('ETag', `"${result.category.version}"`);
    return c.json(result.category);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update category' }, 422);
  }
});

app.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await categoriesService.forUser(getUserId(c)).deleteCategory(id);
  if (!deleted) {
    return c.json({ error: 'Category not found' }, 404);
  }
  return c.json({ success: true, id });
});

app.post('/categories/:id/restore', async (c) => {
  const id = c.req.param('id');
  const restored = await categoriesService.forUser(getUserId(c)).restoreCategory(id);
  if (!restored) {
    return c.json({ error: 'Category not found or not deleted' }, 404);
  }
  return c.json(restored);
});

// Historical On This Day query (User-Scoped)
app.get('/entries/on-this-day', async (c) => {
  const entries = await categoriesService.forUser(getUserId(c)).getEntriesOnThisDay();
  return c.json(entries);
});

// Daily Journal Template creation (User-Scoped)
app.post('/entries/daily-template', async (c) => {
  try {
    let categoryId: string | undefined;
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body.categoryId === 'string') {
      categoryId = body.categoryId;
    }
    const created = await categoriesService.forUser(getUserId(c)).createDailyJournalEntry(categoryId);
    return c.json(created, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create daily journal' }, 422);
  }
});

// Entry Endpoints (per spec 8.1 & Category Stack screen)
app.get('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const entry = await categoriesService.forUser(getUserId(c)).getEntry(id);

  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json(entry);
});

// Full-Text Search (User-Scoped)
app.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  if (!query.trim()) {
    return c.json([]);
  }
  const userId = getUserId(c);
  const results = await categoriesService.forUser(userId).searchEntries(query);
  return c.json(results);
});

app.post('/entries', async (c) => {
  try {
    const raw = await c.req.json();
    const parseResult = CreateEntrySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
    }

    const { categoryId, title, color, pinned, spine } = parseResult.data;
    const catSvc = categoriesService.forUser(getUserId(c));
    const cat = await catSvc.getCategory(categoryId);
    if (!cat) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const entry = await catSvc.createEntry(categoryId, title, color, pinned, spine, parseResult.data.doc);
    maintenanceService.forUser(getUserId(c)).recordEdit();
    return c.json(entry, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create entry' }, 422);
  }
});

app.patch('/entries/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const raw = await c.req.json();
    const parseResult = UpdateEntrySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
    }

    const updated = await categoriesService.forUser(getUserId(c)).updateEntry(id, parseResult.data);
    if (!updated) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    maintenanceService.forUser(getUserId(c)).recordEdit();
    return c.json(updated);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update entry' }, 422);
  }
});

app.delete('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await categoriesService.forUser(getUserId(c)).deleteEntry(id);
  if (!deleted) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  maintenanceService.forUser(getUserId(c)).recordEdit();
  return c.json({ success: true, id });
});

app.post('/entries/:id/restore', async (c) => {
  const id = c.req.param('id');
  const restored = await categoriesService.forUser(getUserId(c)).restoreEntry(id);
  if (!restored) {
    return c.json({ error: 'Entry not found or not deleted' }, 404);
  }
  return c.json({ success: true, entry: restored });
});

app.delete('/entries/:id/purge', async (c) => {
  const id = c.req.param('id');
  const purged = await categoriesService.forUser(getUserId(c)).purgeEntry(id);
  if (!purged) {
    return c.json({ error: 'Entry not found or not in trash' }, 404);
  }
  return c.json({ success: true, id });
});

app.get('/trash', async (c) => {
  const userId = getUserId(c);
  const items = await categoriesService.forUser(userId).listTrash();
  return c.json(items);
});

app.post('/trash/purge', async (c) => {
  const userId = getUserId(c);
  const purgeAll = c.req.query('all') === 'true';
  const days = parseInt(c.req.query('days') || '30', 10);
  const count = await categoriesService.forUser(userId).purgeTrash(Number.isNaN(days) ? 30 : days, purgeAll);
  return c.json({ success: true, purgedCount: count });
});

app.put('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const ifMatch = c.req.header('if-match');
  let expectedVersion: number | undefined;
  if (ifMatch) {
    const parsed = parseInt(ifMatch.replace(/["W\/]/g, '').trim(), 10);
    if (!Number.isNaN(parsed)) {
      expectedVersion = parsed;
    }
  }

  let text = '';
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: 'Invalid body' }, 400);
  }

  if (Buffer.byteLength(text, 'utf8') > ENTRY_SIZE_LIMITS.MAX_BYTES) {
    return c.json({ error: 'Document exceeds maximum size of 2 MB' }, 422);
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const rawDoc =
    body.schemaVersion !== undefined
      ? body
      : body.doc !== undefined
      ? body.doc
      : body;

  const parseResult = DocumentEnvelopeSchema.safeParse(rawDoc);
  if (!parseResult.success) {
    return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
  }

  const docToSave = parseResult.data.schemaVersion === 2
    ? parseResult.data
    : migrateDocumentToV2(parseResult.data).doc;

  const title = typeof body.title === 'string' ? body.title : undefined;

  try {
    const catSvc = categoriesService.forUser(getUserId(c));
    const existing = await catSvc.getEntry(id);
    if (!existing) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return c.json({ error: 'Version conflict', currentVersion: existing.version }, 409);
    }
    const result = await catSvc.saveEntryDoc(id, docToSave, expectedVersion, title);
    if ('conflict' in result) {
      return c.json({ error: 'Version conflict', currentVersion: result.currentVersion }, 409);
    }
    maintenanceService.forUser(getUserId(c)).recordEdit();
    c.header('ETag', `"${result.entry.version}"`);
    return c.json({
      id: result.entry.id,
      title: result.entry.title,
      version: result.entry.version,
      weight: result.entry.weight,
      stats: result.entry.stats,
      saved: true,
    });
  } catch (err: any) {
    console.error('PUT /entries/:id error:', err);
    return c.json({ error: err.message || 'Failed to save entry' }, 500);
  }
});

// Chunked Storage Endpoints (per spec v0.2 Step 3)
app.get('/entries/:id/manifest', async (c) => {
  const id = c.req.param('id');
  const manifest = await categoriesService.forUser(getUserId(c)).getEntryManifest(id);
  if (!manifest) {
    return c.json({ error: 'Entry or manifest not found' }, 404);
  }
  c.header('ETag', `"${manifest.version}"`);
  return c.json(manifest);
});

app.get('/entries/:id/chunks/:chunkId', async (c) => {
  const id = c.req.param('id');
  const chunkId = c.req.param('chunkId');
  const chunk = await categoriesService.forUser(getUserId(c)).getEntryChunk(id, chunkId);
  if (!chunk) {
    return c.json({ error: 'Chunk not found' }, 404);
  }
  return c.json(chunk);
});

app.put('/entries/:id/chunks/:chunkId', async (c) => {
  const id = c.req.param('id');
  const chunkId = c.req.param('chunkId');

  const ifMatch = c.req.header('if-match');
  let expectedVersion: number | undefined;
  if (ifMatch) {
    const parsed = parseInt(ifMatch.replace(/["W\/]/g, '').trim(), 10);
    if (!Number.isNaN(parsed)) {
      expectedVersion = parsed;
    }
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const blocks = Array.isArray(body.blocks) ? body.blocks : body;
  if (!Array.isArray(blocks)) {
    return c.json({ error: 'Payload must contain blocks array' }, 422);
  }

  try {
    const catSvc = categoriesService.forUser(getUserId(c));
    const entry = await catSvc.getEntry(id);
    if (!entry) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    const result = await catSvc.saveEntryChunk(id, chunkId, blocks, expectedVersion);
    if ('conflict' in result) {
      return c.json({ error: 'Version conflict', currentVersion: result.currentVersion }, 409);
    }

    maintenanceService.forUser(getUserId(c)).recordEdit();
    c.header('ETag', `"${result.version}"`);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to save chunk' }, 500);
  }
});

// Revision History Endpoints (User-Scoped)
app.get('/entries/:id/revisions', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const revisions = await categoriesService.forUser(userId).listRevisions(id);
  if (!revisions) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(revisions);
});

app.get('/entries/:id/revisions/:version', async (c) => {
  const id = c.req.param('id');
  const version = parseInt(c.req.param('version'), 10);
  if (Number.isNaN(version)) {
    return c.json({ error: 'Invalid version number' }, 400);
  }
  const userId = getUserId(c);
  const revision = await categoriesService.forUser(userId).getRevision(id, version);
  if (!revision) {
    return c.json({ error: 'Revision not found' }, 404);
  }
  return c.json(revision);
});

app.post('/entries/:id/revisions/:version/restore', async (c) => {
  const id = c.req.param('id');
  const version = parseInt(c.req.param('version'), 10);
  if (Number.isNaN(version)) {
    return c.json({ error: 'Invalid version number' }, 400);
  }
  const userId = getUserId(c);
  const result = await categoriesService.forUser(userId).restoreRevision(id, version);
  if (!result) {
    return c.json({ error: 'Failed to restore revision: entry or revision not found' }, 404);
  }
  return c.json(result);
});

// Tags & Backlinks Endpoints (User-Scoped)
app.get('/tags', async (c) => {
  const userId = getUserId(c);
  const tags = await categoriesService.forUser(userId).listTags();
  return c.json(tags);
});

app.get('/tags/:name/entries', async (c) => {
  const userId = getUserId(c);
  const name = c.req.param('name');
  const entries = await categoriesService.forUser(userId).listEntriesByTag(name);
  return c.json(entries);
});

app.get('/entries/:id/tags', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const tags = await categoriesService.forUser(userId).getEntryTags(id);
  if (!tags) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(tags);
});

app.post('/entries/:id/tags', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'Tag name is required' }, 400);
  }
  const tag = await categoriesService.forUser(userId).addEntryTag(id, body.name);
  if (!tag) {
    return c.json({ error: 'Entry not found or invalid tag' }, 404);
  }
  return c.json(tag, 201);
});

app.delete('/entries/:id/tags/:tagId', async (c) => {
  const id = c.req.param('id');
  const tagId = c.req.param('tagId');
  const userId = getUserId(c);
  const ok = await categoriesService.forUser(userId).removeEntryTag(id, tagId);
  if (!ok) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json({ success: true });
});

app.get('/entries/:id/backlinks', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const backlinks = await categoriesService.forUser(userId).getBacklinks(id);
  if (!backlinks) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(backlinks);
});

// Share Links Endpoints (User-Scoped & Public)
app.post('/entries/:id/share', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  let expiresInDays: number | undefined;
  try {
    const body = await c.req.json();
    if (typeof body?.expiresInDays === 'number') {
      expiresInDays = body.expiresInDays;
    }
  } catch {}

  const link = await categoriesService.forUser(userId).createShareLink(id, expiresInDays);
  if (!link) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(link, 201);
});

app.get('/entries/:id/share', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const links = await categoriesService.forUser(userId).listShareLinks(id);
  if (!links) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  return c.json(links);
});

app.delete('/entries/:id/share/:linkId', async (c) => {
  const id = c.req.param('id');
  const linkId = c.req.param('linkId');
  const userId = getUserId(c);
  const ok = await categoriesService.forUser(userId).revokeShareLink(id, linkId);
  if (!ok) {
    return c.json({ error: 'Share link not found or already revoked' }, 404);
  }
  return c.json({ success: true });
});

app.delete('/entries/:id/share', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const ok = await categoriesService.forUser(userId).revokeShareLink(id);
  if (!ok) {
    return c.json({ error: 'No active share links found' }, 404);
  }
  return c.json({ success: true });
});

app.get('/shared/:token', async (c) => {
  const token = c.req.param('token');
  const shared = await CategoriesService.getSharedEntry(token);
  if (!shared) {
    return c.json({ error: 'Shared entry not found, expired, or revoked' }, 404);
  }
  return c.json(shared);
});

app.get('/shared/:token/assets/:assetId', async (c) => {
  const token = c.req.param('token');
  const assetId = c.req.param('assetId');
  const access = await CategoriesService.getSharedEntryAsset(token, assetId);
  if (!access) {
    return c.text('Asset not found or access denied', 404);
  }

  const userStore = assetStore.forUser(access.userId);
  const record = await userStore.getRecord(assetId);
  if (!record) {
    return c.text('Asset not found', 404);
  }

  const data = await userStore.get(record.storageKey);
  if (!data) {
    return c.text('Asset data not found', 404);
  }

  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': record.mime, 'Cache-Control': 'no-store' },
  });
});

app.get('/shared/:token/assets/:assetId/thumb', async (c) => {
  const token = c.req.param('token');
  const assetId = c.req.param('assetId');
  const access = await CategoriesService.getSharedEntryAsset(token, assetId);
  if (!access) {
    return c.text('Thumbnail not found or access denied', 404);
  }

  const userStore = assetStore.forUser(access.userId);
  const sizeParam = c.req.query('size') === '960' ? '960' : '320';
  const data = await userStore.getThumb(assetId, sizeParam);
  if (!data) {
    return c.text('Thumbnail not found', 404);
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'no-store',
    },
  });
});

app.post('/migrate', async (c) => {
  try {
    const res = await categoriesService.forUser(getUserId(c)).runMigration();
    return c.json({ success: true, ...res });
  } catch (err: any) {
    return c.json({ error: err.message || 'Migration failed' }, 500);
  }
});

// Asset Endpoints
app.post('/assets', async (c) => {
  try {
    const userId = getUserId(c);
    const formData = await c.req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return c.json({ error: 'No file uploaded. Must be multipart/form-data with key "file".' }, 400);
    }

    if (file.size > 20 * 1024 * 1024) {
      return c.json({ error: 'File exceeds maximum size of 20 MB.' }, 413);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileName = file instanceof File ? file.name : 'upload.png';
    const userStore = assetStore.forUser(userId);
    const { asset } = await userStore.put(buffer, file.type, fileName);

    return c.json({
      success: true,
      asset,
    }, 201);
  } catch (err: any) {
    if (err.statusCode === 413 || err.message?.includes('Upload quota')) {
      return c.json({ error: err.message || 'Upload quota exceeded' }, 413);
    }
    console.error('Asset upload exception:', err);
    return c.json({ error: err.message || 'Asset upload failed' }, 422);
  }
});

app.get('/assets/:id', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const userStore = assetStore.forUser(userId);
  const record = await userStore.getRecord(id);
  if (!record) {
    return c.text('Asset not found', 404);
  }

  const data = await userStore.get(record.storageKey);
  if (!data) {
    return c.text('Asset data not found', 404);
  }

  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': record.mime },
  });
});

app.get('/assets/:id/thumb', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const userStore = assetStore.forUser(userId);
  const sizeParam = c.req.query('size') === '960' ? '960' : '320';

  const data = await userStore.getThumb(id, sizeParam);
  if (!data) {
    return c.text('Thumbnail not found', 404);
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.post('/export/pdf', async (c) => {
  try {
    const { htmlContent } = await c.req.json();
    if (!htmlContent) {
      return c.text('Missing htmlContent', 400);
    }

    // Verify any referenced assets belong to caller's userId
    const userId = getUserId(c);
    const assetMatches = Array.from((htmlContent as string).matchAll(/\/assets\/([^"'\s]+)/g));
    const userStore = assetStore.forUser(userId);
    for (const match of assetMatches) {
      const assetId = match[1].replace(/\/thumb.*/, '');
      const record = await userStore.getRecord(assetId);
      if (!record) {
        return c.json({ error: `Unauthorized asset access in export: ${assetId}` }, 403);
      }
    }

    const pdfBuffer = await renderDocumentToPdf({ htmlContent });
    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="kaaj-export.pdf"',
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'PDF export failed' }, 500);
  }
});

// Import & Export Endpoints (User-Scoped)
app.get('/export/zip', async (c) => {
  try {
    const userId = getUserId(c);
    const svc = new ImportExportService(userId, assetStore);
    const zipBuffer = await svc.exportZip();

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="kaaj-vault-${userId}.zip"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'ZIP export failed' }, 500);
  }
});

app.get('/entries/:id/export/markdown', async (c) => {
  const id = c.req.param('id');
  const userId = getUserId(c);
  const svc = new ImportExportService(userId, assetStore);
  const markdown = await svc.exportEntryMarkdown(id);
  if (!markdown) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.md"`,
    },
  });
});

app.post('/import/zip', async (c) => {
  try {
    const userId = getUserId(c);
    const contentType = c.req.header('content-type') || '';
    let buffer: Buffer;

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof Blob)) {
        return c.json({ error: 'Missing zip file in multipart form field "file"' }, 400);
      }
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const raw = await c.req.arrayBuffer();
      buffer = Buffer.from(raw);
    }

    if (buffer.length === 0) {
      return c.json({ error: 'Empty zip payload' }, 400);
    }

    const svc = new ImportExportService(userId, assetStore);
    const result = await svc.importZip(buffer);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    if (err.statusCode === 413 || err.message?.includes('exceeds maximum allowed size')) {
      return c.json({ error: err.message || 'Archive exceeds maximum size of 50 MB' }, 413);
    }
    if (err.statusCode === 400 || err.message?.includes('Malicious zip')) {
      return c.json({ error: err.message || 'Invalid zip archive' }, 400);
    }
    console.error('Import zip error:', err);
    return c.json({ error: err.message || 'ZIP import failed' }, 500);
  }
});

app.post('/import/markdown', async (c) => {
  try {
    const userId = getUserId(c);
    let categoryId: string | undefined;
    let markdown: string | undefined;
    let filename: string | undefined;

    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      categoryId = formData.get('categoryId') as string;
      filename = (formData.get('file') as File)?.name;
      const file = formData.get('file');
      if (file && file instanceof Blob) {
        markdown = await file.text();
      }
    } else {
      const body = await c.req.json();
      categoryId = body.categoryId;
      markdown = body.markdown;
      filename = body.filename;
    }

    if (!markdown) {
      return c.json({ error: 'Markdown content is required' }, 400);
    }

    // Default to first user category if not specified
    const catSvc = categoriesService.forUser(userId);
    if (!categoryId) {
      const cats = await catSvc.listCategories();
      if (cats.length > 0) {
        categoryId = cats[0].id;
      } else {
        const created = await catSvc.createCategory('Imported Notes');
        categoryId = created.id;
      }
    }

    const svc = new ImportExportService(userId, assetStore);
    const result = await svc.importMarkdown(categoryId, markdown, filename);
    return c.json({ success: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Markdown import failed' }, 500);
  }
});

// Backup & Cloud Sync Endpoints (User-Scoped)
app.get('/backup/status', async (c) => {
  const userId = getUserId(c);
  const userBackup = backupService.forUser(userId);
  const userMaint = maintenanceService.forUser(userId);

  const status = userBackup.getStatus();
  const mState = await userMaint.getState();
  return c.json({
    ...status,
    lastCleanupTime: mState.lastPruneAt,
    lastPruneResult: mState.lastResult,
    remoteFileCount: status.remoteFileCount ?? mState.remoteFileCount ?? 0,
    target: userBackup.getTarget().name,
  });
});

app.get('/backup/maintenance', async (c) => {
  try {
    const userId = getUserId(c);
    const userMaint = maintenanceService.forUser(userId);
    const state = await userMaint.getState();
    const evaluation = await userMaint.isPruneDueAndIdle();
    return c.json({ state, evaluation });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to inspect maintenance' }, 500);
  }
});

app.post('/backup/trigger', async (c) => {
  const userId = getUserId(c);
  const userBackup = backupService.forUser(userId);
  const wait = c.req.query('wait') === 'true';

  if (!wait) {
    const triggerRes = userBackup.triggerAsyncBackup();
    return c.json(triggerRes, 202);
  }

  try {
    const job = await userBackup.createSnapshot();
    return c.json({
      success: true,
      snapshotId: job.snapshotId,
      status: job.status,
      uploadedPacks: job.uploadedPacks,
      newBlobsCount: job.newBlobsCount,
      skippedBlobsCount: job.skippedBlobsCount,
      totalFiles: job.totalFiles,
      totalBytes: job.totalBytes,
      timings: job.timings,
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Backup failed' }, 500);
  }
});

app.post('/backup/prune', async (c) => {
  try {
    const userId = getUserId(c);
    const userMaint = maintenanceService.forUser(userId);
    const force = c.req.query('force') === 'true';
    const result = await userMaint.runMaintenance({
      force,
      skipIdleCheck: true,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || 'Prune failed' }, 500);
  }
});

app.get('/backup/check', async (c) => {
  try {
    const userId = getUserId(c);
    const userBackup = backupService.forUser(userId);
    const sampleRate = Number(c.req.query('sample')) || 1.0;
    const result = await checkBackupRepository(userBackup.getTarget(), { sampleRate });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || 'Check failed' }, 500);
  }
});

app.get('/auth/google/url', (c) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';
  if (!clientId) {
    return c.json({ error: 'GOOGLE_CLIENT_ID is not configured in environment.' }, 400);
  }
  const url = generateGoogleAuthUrl(clientId, redirectUri);
  return c.json({ url });
});

app.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('Missing authorization code.', 400);
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';

  if (!clientId || !clientSecret) {
    return c.text('Google OAuth credentials not configured on server.', 500);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
    await googleDriveTarget.saveTokens(tokens);
    backupService.setTarget(googleDriveTarget);
    maintenanceService.setTarget(googleDriveTarget);
    return c.html(`<!DOCTYPE html>
<html>
  <head><title>Google Drive Connected</title></head>
  <body style="font-family: sans-serif; text-align: center; padding: 40px;">
    <h2>Google Drive Connected Successfully</h2>
    <p>Your Kaaj entries and visual assets will now automatically back up to Google Drive.</p>
    <p>You may safely close this window.</p>
    <script>
      window.opener?.postMessage('google-auth-success', '*');
      setTimeout(() => window.close(), 1500);
    </script>
  </body>
</html>`);
  } catch (err: any) {
    return c.text(`Google OAuth exchange failed: ${err.message}`, 500);
  }
});

app.get('/auth/google/status', (c) => {
  return c.json({
    connected: googleDriveTarget.hasValidAuth(),
    target: backupService.getTarget().name,
  });
});

// WebSocket Synchronisation (/sync/ws)
const { upgradeWebSocket, websocket } = createBunWebSocket();
const wsSyncService = new WsSyncService(categoriesService, maintenanceService);

interface WsAuthResult {
  userId: string;
  expiresAt?: number;
}

function resolveWsClientUser(c: any): WsAuthResult | null {
  const token =
    c.req.query('token') ||
    c.req.header('Authorization')?.replace('Bearer ', '').trim() ||
    c.req.header('sec-websocket-protocol');

  if (!token) return null;

  const trimmed = token.trim();

  // Expiring token format: exp:<timestamp_ms>:<userId>
  if (trimmed.startsWith('exp:')) {
    const parts = trimmed.split(':');
    if (parts.length >= 3) {
      const expMs = Number(parts[1]);
      const uid = parts.slice(2).join(':');
      if (Number.isFinite(expMs)) {
        if (Date.now() >= expMs) {
          return null; // Expired
        }
        return { userId: uid, expiresAt: expMs };
      }
    }
  }

  // Explicit query param expiresAt
  const qExp = Number(c.req.query('expiresAt'));
  const hasValidQueryExp = Number.isFinite(qExp) && qExp > 0;
  if (hasValidQueryExp && Date.now() >= qExp) {
    return null; // Expired
  }

  if (trimmed.startsWith('user:')) {
    const uid = trimmed.slice(5).trim();
    return { userId: uid, expiresAt: hasValidQueryExp ? qExp : undefined };
  }
  if (trimmed.startsWith('token-user-')) {
    const uid = trimmed.replace('token-', '').trim();
    return { userId: uid, expiresAt: hasValidQueryExp ? qExp : undefined };
  }
  if (
    trimmed === 'kaaj-local-dev-token' ||
    trimmed === 'dev-secret-token' ||
    trimmed === (process.env.DEV_AUTH_TOKEN || '')
  ) {
    return { userId: 'dev-owner-user', expiresAt: hasValidQueryExp ? qExp : undefined };
  }

  return null;
}

function parseRoom(c: any): { roomKey: string; roomUserId: string; entryId: string } | null {
  const rawRoom = c.req.param('room') || c.req.query('room');
  if (!rawRoom) return null;
  const parts = rawRoom.split(':');
  if (parts.length < 2) return null;
  return {
    roomKey: rawRoom,
    roomUserId: parts[0],
    entryId: parts.slice(1).join(':'),
  };
}

const handleWsUpgrade = upgradeWebSocket(async (c) => {
  const auth = resolveWsClientUser(c);
  const parsedRoom = parseRoom(c);

  if (!auth || !parsedRoom) {
    return {
      onOpen(_event, ws) {
        ws.close(4401, 'Unauthorized: missing or invalid credentials');
      },
    };
  }

  const clientUser = auth.userId;

  // Cross-user room isolation check
  if (parsedRoom.roomUserId !== clientUser) {
    return {
      onOpen(_event, ws) {
        ws.close(4403, 'Forbidden: cross-user room access denied');
      },
    };
  }

  // Ensure user exists in database
  await ensureUser(clientUser);

  const room = await wsSyncService.getOrCreateRoom(parsedRoom.roomUserId, parsedRoom.entryId);

  return {
    onOpen(_event, ws) {
      const socket = (ws as any).raw || ws;

      // Handle mid-session token expiry
      if (auth.expiresAt) {
        const remainingMs = auth.expiresAt - Date.now();
        if (remainingMs <= 0) {
          ws.close(4401, 'Token expired mid-session');
          return;
        }
        const timer = setTimeout(() => {
          try {
            ws.close(4401, 'Token expired mid-session');
          } catch {}
        }, remainingMs);

        (socket as any)._expiryTimer = timer;
      }

      wsSyncService.handleClientConnected(room, socket);
    },
    onMessage(event, ws) {
      const socket = (ws as any).raw || ws;
      const data = typeof event.data === 'string' ? Buffer.from(event.data) : event.data;
      wsSyncService.handleClientMessage(room, socket, data as any);
    },
    onClose(_event, ws) {
      const socket = (ws as any).raw || ws;
      if ((socket as any)._expiryTimer) {
        clearTimeout((socket as any)._expiryTimer);
      }
      wsSyncService.handleClientDisconnected(room, socket);
    },
  };
});

app.get('/sync/ws', handleWsUpgrade);
app.get('/sync/ws/:room', handleWsUpgrade);

const PORT = Number(process.env.PORT || 3001);

const isBun = typeof (globalThis as any).Bun !== 'undefined';

if (!isBun) {
  console.log(`Starting Kaaj API on Node via @hono/node-server on port ${PORT}...`);
  serve({
    fetch: app.fetch,
    port: PORT,
  });
} else {
  console.log(`Starting Kaaj API on Bun native server on port ${PORT}...`);
}

const gracefulShutdown = async () => {
  console.log('Shutting down Kaaj API gracefully...');
  maintenanceScheduler.stop();
  backupService.stopPeriodicTimer();
  await wsSyncService.flushAllRooms();
  await closeDb();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
