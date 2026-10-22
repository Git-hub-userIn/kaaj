import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import path from 'node:path';
import { LocalDiskAssetStore } from './stores/asset-store.js';
import { DocumentEnvelopeSchema, calculateWeight } from '@kaaj/doc-model';
import { renderDocumentToPdf } from './services/pdf-service.js';
import { authGuard } from './auth/guard.js';

const app = new Hono();

app.use('*', cors());
app.use('*', authGuard);

const storageDir = path.resolve(process.cwd(), 'data', 'storage');
const assetStore = new LocalDiskAssetStore(storageDir);

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
    headers: { 'Content-Type': 'image/webp' },
  });
});

app.get('/entries/:id', (c) => {
  const id = c.req.param('id');
  const entry = entryStore.get(id);

  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json({
    id,
    version: entry.version,
    weight: entry.weight,
    doc: entry.doc,
  });
});

app.put('/entries/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const parseResult = DocumentEnvelopeSchema.safeParse(body.doc);
  if (!parseResult.success) {
    return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 422);
  }

  const doc = parseResult.data;
  const current = entryStore.get(id);
  const nextVersion = (current?.version ?? 0) + 1;
  const weight = calculateWeight(doc);

  entryStore.set(id, {
    doc,
    version: nextVersion,
    weight,
  });

  return c.json({
    id,
    version: nextVersion,
    weight,
    saved: true,
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
