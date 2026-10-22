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
} from '@kaaj/doc-model';
import { renderDocumentToPdf } from './services/pdf-service.js';
import { CategoriesService } from './services/categories-service.js';
import { authGuard } from './auth/guard.js';

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

// In-memory / local mock store for Phase 0 spike entry documents
const entryStore = new Map<string, { doc: unknown; version: number; weight: number }>();

app.get('/health', (c) => {
  const bunGlobal = (globalThis as unknown as { Bun?: { version: string } }).Bun;
  return c.json({
    status: 'ok',
    phase: 'Phase 0 Spike',
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
  return c.json(cat);
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
    const body = await c.req.json();
    const updated = await categoriesService.updateCategory(id, body);
    if (!updated) {
      return c.json({ error: 'Category not found' }, 404);
    }
    return c.json(updated);
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
    // Check fallback for spike in-memory store
    const spike = entryStore.get(id);
    if (spike) {
      return c.json({
        id,
        version: spike.version,
        weight: spike.weight,
        doc: spike.doc,
      });
    }
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

    const { categoryId, title, color, pinned } = parseResult.data;
    const cat = await categoriesService.getCategory(categoryId);
    if (!cat) {
      return c.json({ error: 'Category not found' }, 404);
    }

    const entry = await categoriesService.createEntry(categoryId, title, color, pinned);
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
  const body = await c.req.json();

  const parseResult = DocumentEnvelopeSchema.safeParse(body.doc);
  if (!parseResult.success) {
    return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
  }

  const doc = parseResult.data;

  // If entry exists in categoriesService, persist it there
  const existing = await categoriesService.getEntry(id);
  if (existing) {
    const result = await categoriesService.saveEntryDoc(id, doc);
    return c.json({
      id: result.entry.id,
      version: result.entry.version,
      weight: result.entry.weight,
      saved: true,
    });
  }

  // Fallback to spike in-memory store
  const current = entryStore.get(id);
  const nextVersion = (current?.version ?? 0) + 1;
  const weightVal = calculateWeight(doc);

  entryStore.set(id, {
    doc,
    version: nextVersion,
    weight: weightVal,
  });

  return c.json({
    id,
    version: nextVersion,
    weight: weightVal,
    saved: true,
  });
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
