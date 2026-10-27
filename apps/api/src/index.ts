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

const defaultBackupDir = process.env.BACKUP_DIR || path.resolve(repoRoot, 'data', 'backup-snapshots');
const tokenFilePath = process.env.GOOGLE_TOKEN_FILE || path.resolve(baseDataDir, 'google-oauth.json');
const cacheFilePath = process.env.GOOGLE_DRIVE_CACHE_FILE || path.resolve(baseDataDir, 'drive-file-cache.json');

const googleDriveTarget = new GoogleDriveBackupTarget({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback',
  tokenFilePath,
  cacheFilePath,
});

const localBackupTarget = new LocalFolderBackupTarget(defaultBackupDir);
const activeBackupTarget = googleDriveTarget.hasValidAuth() ? googleDriveTarget : localBackupTarget;
const backupService = new BackupService(baseDataDir, activeBackupTarget);
const maintenanceService = new MaintenanceService(baseDataDir, activeBackupTarget);
backupService.setMaintenanceService(maintenanceService);
backupService.startPeriodicTimer();

const maintenanceScheduler = new MaintenanceScheduler(maintenanceService);
maintenanceScheduler.start();

app.get('/health', (c) => {
  const bunGlobal = (globalThis as unknown as { Bun?: { version: string } }).Bun;
  return c.json({
    status: 'ok',
    phase: 'Phase 1 & 2',
    runtime: bunGlobal ? `Bun ${bunGlobal.version}` : `Node ${process.version}`,
    timestamp: new Date().toISOString(),
  });
});

// Category Endpoints
app.get('/categories', async (c) => {
  const categories = await categoriesService.listCategories();
  return c.json(categories);
});

app.get('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const cat = await categoriesService.getCategory(id);
  if (!cat) {
    return c.json({ error: 'Category not found' }, 404);
  }
  c.header('ETag', `"${cat.version}"`);
  return c.json(cat);
});

app.get('/categories/:id/stats', async (c) => {
  const id = c.req.param('id');
  const stats = await categoriesService.getCategoryStats(id);
  if (!stats) {
    return c.json({ error: 'Category not found' }, 404);
  }
  return c.json(stats);
});

app.get('/categories/:id/entries', async (c) => {
  const id = c.req.param('id');
  const cat = await categoriesService.getCategory(id);
  if (!cat) {
    return c.json({ error: 'Category not found' }, 404);
  }
  const entries = await categoriesService.listEntriesForCategory(id);
  return c.json(entries);
});

app.post('/categories', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'Title is required' }, 400);
    }
    const category = await categoriesService.createCategory(body.title, body.coverAssetId, body.color);
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
    const result = await categoriesService.updateCategory(id, body, expectedVersion);
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
  const deleted = await categoriesService.deleteCategory(id);
  if (!deleted) {
    return c.json({ error: 'Category not found' }, 404);
  }
  return c.json({ success: true, id });
});

app.post('/categories/:id/restore', async (c) => {
  const id = c.req.param('id');
  const restored = await categoriesService.restoreCategory(id);
  if (!restored) {
    return c.json({ error: 'Category not found or not deleted' }, 404);
  }
  return c.json(restored);
});

// Entry Endpoints (per spec 8.1 & Category Stack screen)
app.get('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const entry = await categoriesService.getEntry(id);

  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json(entry);
});

app.post('/entries', async (c) => {
  try {
    const raw = await c.req.json();
    const parseResult = CreateEntrySchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
    }

    const { categoryId, title, color, pinned, spine } = parseResult.data;
    const cat = await categoriesService.getCategory(categoryId);
    if (!cat) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const entry = await categoriesService.createEntry(categoryId, title, color, pinned, spine, parseResult.data.doc);
    maintenanceService.recordEdit();
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

    const updated = await categoriesService.updateEntry(id, parseResult.data);
    if (!updated) {
      return c.json({ error: 'Entry not found' }, 404);
    }
    maintenanceService.recordEdit();
    return c.json(updated);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update entry' }, 422);
  }
});

app.delete('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await categoriesService.deleteEntry(id);
  if (!deleted) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  maintenanceService.recordEdit();
  return c.json({ success: true, id });
});

app.post('/entries/:id/restore', async (c) => {
  const id = c.req.param('id');
  const restored = await categoriesService.restoreEntry(id);
  if (!restored) {
    return c.json({ error: 'Entry not found or not deleted' }, 404);
  }
  return c.json({ success: true, entry: restored });
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

  const rawDoc = body.doc !== undefined ? body.doc : body;

  const parseResult = DocumentEnvelopeSchema.safeParse(rawDoc);
  if (!parseResult.success) {
    return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
  }

  const docToSave = parseResult.data.schemaVersion === 2
    ? parseResult.data
    : migrateDocumentToV2(parseResult.data).doc;

  const title = typeof body.title === 'string' ? body.title : undefined;

  try {
    const existing = await categoriesService.getEntry(id);
    if (!existing) {
      return c.json({ error: 'Entry not found' }, 404);
    }

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return c.json({ error: 'Version conflict', currentVersion: existing.version }, 409);
    }
    const result = await categoriesService.saveEntryDoc(id, docToSave, expectedVersion, title);
    if ('conflict' in result) {
      return c.json({ error: 'Version conflict', currentVersion: result.currentVersion }, 409);
    }
    maintenanceService.recordEdit();
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
  const manifest = await categoriesService.getEntryManifest(id);
  if (!manifest) {
    return c.json({ error: 'Entry or manifest not found' }, 404);
  }
  c.header('ETag', `"${manifest.version}"`);
  return c.json(manifest);
});

app.get('/entries/:id/chunks/:chunkId', async (c) => {
  const id = c.req.param('id');
  const chunkId = c.req.param('chunkId');
  const chunk = await categoriesService.getEntryChunk(id, chunkId);
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
    const result = await categoriesService.saveEntryChunk(id, chunkId, blocks, expectedVersion);
    if ('conflict' in result) {
      return c.json({ error: 'Version conflict', currentVersion: result.currentVersion }, 409);
    }

    maintenanceService.recordEdit();
    c.header('ETag', `"${result.version}"`);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to save chunk' }, 500);
  }
});

app.post('/migrate', async (c) => {
  try {
    const res = await categoriesService.runMigration();
    return c.json({ success: true, ...res });
  } catch (err: any) {
    return c.json({ error: err.message || 'Migration failed' }, 500);
  }
});

// Asset Endpoints
app.post('/assets', async (c) => {
  try {
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
    const { asset } = await assetStore.put(buffer, file.type, fileName);

    return c.json({
      success: true,
      asset,
    }, 201);
  } catch (err: any) {
    console.error('Asset upload exception:', err);
    return c.json({ error: err.message || 'Asset upload failed' }, 422);
  }
});

app.get('/assets/:id', async (c) => {
  const id = c.req.param('id');
  const record = assetStore.getRecord(id);
  if (!record) {
    return c.text('Asset not found', 404);
  }

  const data = await assetStore.get(record.storageKey);
  if (!data) {
    return c.text('Asset data not found', 404);
  }

  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': record.mime },
  });
});

app.get('/assets/:id/thumb', async (c) => {
  const id = c.req.param('id');
  const sizeParam = c.req.query('size') === '960' ? '960' : '320';

  const data = await assetStore.getThumb(id, sizeParam);
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

// Backup & Cloud Sync Endpoints
app.get('/backup/status', async (c) => {
  const status = backupService.getStatus();
  const mState = await maintenanceService.getState();
  return c.json({
    ...status,
    lastCleanupTime: mState.lastPruneAt,
    lastPruneResult: mState.lastResult,
    remoteFileCount: status.remoteFileCount ?? mState.remoteFileCount ?? 0,
    target: backupService.getTarget().name,
  });
});

app.get('/backup/maintenance', async (c) => {
  try {
    const state = await maintenanceService.getState();
    const evaluation = await maintenanceService.isPruneDueAndIdle();
    return c.json({ state, evaluation });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to inspect maintenance' }, 500);
  }
});

app.post('/backup/trigger', async (c) => {
  const wait = c.req.query('wait') === 'true';
  if (!wait) {
    const triggerRes = backupService.triggerAsyncBackup();
    return c.json(triggerRes, 202);
  }

  // When wait=true is requested, await completion and return only the summary (never full manifest)
  try {
    const job = await backupService.createSnapshot();
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
    const force = c.req.query('force') === 'true';
    const result = await maintenanceService.runMaintenance({
      force,
      skipIdleCheck: true, // Manual user invocation bypasses idle edit check
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message || 'Prune failed' }, 500);
  }
});

app.get('/backup/check', async (c) => {
  try {
    const sampleRate = Number(c.req.query('sample')) || 1.0;
    const result = await checkBackupRepository(backupService.getTarget(), { sampleRate });
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

export default {
  port: PORT,
  fetch: app.fetch,
};
