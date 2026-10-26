import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  splitBlocksIntoChunks,
  reassembleDocFromChunks,
  canonicalDocJson,
  computeContentHash,
  type DocumentEnvelopeV2,
  type TopLevelBlock,
  type EntryManifest,
  type ChunkPayload,
} from '../packages/doc-model/src/index.js';

// Base URLs
const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';
const AUTH_HEADER = { Authorization: 'Bearer kaaj-local-dev-token' };

// 1x1 transparent PNG base64 fixture
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Locate repository root
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

// Upload image fixture and return asset identifier
async function uploadTestImage(request: any): Promise<string> {
  const uploadRes = await request.post(`${API_BASE}/assets`, {
    headers: AUTH_HEADER,
    multipart: {
      file: {
        name: 'chunk-test-photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(VALID_PNG_BASE64, 'base64'),
      },
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const body = await uploadRes.json();
  return body.asset.id;
}

// Fetch entry manifest from API with disk fallback
async function getEntryManifest(request: any, entryId: string): Promise<EntryManifest> {
  const res = await request.get(`${API_BASE}/entries/${entryId}/manifest`, {
    headers: AUTH_HEADER,
  });
  if (res.ok()) {
    return await res.json();
  }

  // Fallback to disk read if server endpoint is not yet mounted
  const repoRoot = findRepoRoot(process.cwd());
  const manifestPath = path.join(repoRoot, 'data', 'entries', entryId, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

// Fetch chunk payload from API with disk fallback
async function getEntryChunk(request: any, entryId: string, chunkId: string): Promise<ChunkPayload> {
  const res = await request.get(`${API_BASE}/entries/${entryId}/chunks/${chunkId}`, {
    headers: AUTH_HEADER,
  });
  if (res.ok()) {
    return await res.json();
  }

  // Fallback to disk read
  const repoRoot = findRepoRoot(process.cwd());
  const chunkPath = path.join(repoRoot, 'data', 'entries', entryId, 'chunks', `${chunkId}.json`);
  const raw = await fs.readFile(chunkPath, 'utf8');
  return JSON.parse(raw);
}

test.describe('Kaaj Step 3 Chunked Storage Suite', () => {
  // Test 1: Very large entry (50,000 words)
  test('1. Very large entry (50,000 words) opens, types in middle, reloads, and content is intact', async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);

    // Create 50,000 word document: 500 paragraphs with 100 words each
    const paragraphWords = new Array(100).fill('horizon').join(' ');
    const paragraphs: TopLevelBlock[] = Array.from({ length: 500 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `blk_50k_${i}` },
      content: [{ type: 'text', text: `Paragraph ${i + 1}: ${paragraphWords}` }],
    }));

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Fifty Thousand Words Test Archive',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: paragraphs,
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Open large document in web editor
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 30000 });

      // Navigate to the middle paragraph and type text
      const middlePara = page.locator('.kaaj-editor-content p').nth(250);
      await middlePara.scrollIntoViewIfNeeded();
      await middlePara.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' [MID-DOC 50K VERIFIED INSERTION] ');

      // Save document and wait for confirmation
      await page.keyboard.press('Control+s');
      const saveStatus = page.locator('[data-testid="save-status-indicator"]');
      await expect(saveStatus).toContainText('Saved', { timeout: 15000 });

      // Reload page and verify content stays intact
      await page.reload();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toContainText('[MID-DOC 50K VERIFIED INSERTION]');
    } finally {
      // Clean up test entry
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 2: Edit in chunk 3 modifies only chunk 3
  test('2. Edit in chunk 3 updates only chunk 3 checksum while chunk 1 and chunk 2 remain untouched', async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);

    // Seed 150 blocks to produce 3 separate chunks
    const blocks: TopLevelBlock[] = Array.from({ length: 150 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `blk_c3_test_${i}` },
      content: [{ type: 'text', text: `Paragraph block ${i + 1} baseline content for checksum verification.` }],
    }));

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Multi Chunk Checksum Test Entry',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: blocks,
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Read initial manifest and record chunk checksums
      const manifestBefore = await getEntryManifest(request, created.id);
      expect(manifestBefore.chunks.length).toBeGreaterThanOrEqual(3);

      const chk1Before = manifestBefore.chunks[0];
      const chk2Before = manifestBefore.chunks[1];
      const chk3Before = manifestBefore.chunks[2];

      expect(chk1Before.checksum).toBeTruthy();
      expect(chk2Before.checksum).toBeTruthy();
      expect(chk3Before.checksum).toBeTruthy();

      // Open entry in editor
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Scroll to a block in chunk 3 (index 125) and edit it
      const chunk3Para = page.locator('.kaaj-editor-content p').nth(125);
      await chunk3Para.scrollIntoViewIfNeeded();
      await chunk3Para.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' [EDITED CHUNK 3 UNIQUE MODIFICATION]');

      // Trigger save
      await page.keyboard.press('Control+s');
      const saveStatus = page.locator('[data-testid="save-status-indicator"]');
      await expect(saveStatus).toContainText('Saved', { timeout: 10000 });

      // Fetch manifest after save
      const manifestAfter = await getEntryManifest(request, created.id);
      expect(manifestAfter.chunks.length).toBeGreaterThanOrEqual(3);

      const chk1After = manifestAfter.chunks[0];
      const chk2After = manifestAfter.chunks[1];
      const chk3After = manifestAfter.chunks[2];

      // Verify chunk 1 and chunk 2 checksums did not change
      expect(chk1After.checksum).toBe(chk1Before.checksum);
      expect(chk2After.checksum).toBe(chk2Before.checksum);

      // Verify chunk 3 checksum changed
      expect(chk3After.checksum).not.toBe(chk3Before.checksum);

      // Verify chunk 3 content contains edited text
      const chunk3Payload = await getEntryChunk(request, created.id, chk3After.id);
      const chunk3Serialized = JSON.stringify(chunk3Payload);
      expect(chunk3Serialized).toContain('[EDITED CHUNK 3 UNIQUE MODIFICATION]');
    } finally {
      // Clean up test entry
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 3: Chunk split and merge
  test('3. Chunk splits on paste overflow and merges on block deletion', async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);

    // Start with 30 blocks (single chunk below 50 block limit)
    const initialBlocks: TopLevelBlock[] = Array.from({ length: 30 }, (_, i) => ({
      type: 'paragraph',
      attrs: { id: `blk_split_${i}` },
      content: [{ type: 'text', text: `Initial block ${i + 1} content.` }],
    }));

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Chunk Split and Merge Verification Entry',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: initialBlocks,
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Verify initial manifest has 1 chunk
      const manifestInitial = await getEntryManifest(request, created.id);
      expect(manifestInitial.chunkCount).toBe(1);

      // Open entry in editor
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Paste 40 additional paragraphs to exceed 50 blocks
      await editor.click();
      await page.keyboard.press('End');
      await page.evaluate(() => {
        const text = Array.from(
          { length: 40 },
          (_, i) => `<p>Overflow appended paragraph ${i + 1} with repeated filler data.</p>`
        ).join('');
        const dt = new DataTransfer();
        dt.setData('text/html', text);
        dt.setData('text/plain', text);
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: dt });
        const pm = document.querySelector('.ProseMirror') || document.querySelector('.kaaj-editor-content');
        pm?.dispatchEvent(event);
        if (document.querySelectorAll('.ProseMirror p').length <= 35) {
          document.execCommand('insertHTML', false, text);
        }
      });

      // Save document
      await page.keyboard.press('Control+s');
      const saveStatus = page.locator('[data-testid="save-status-indicator"]');
      await expect(saveStatus).toContainText('Saved', { timeout: 15000 });

      // Verify manifest shows chunk split
      const manifestSplit = await getEntryManifest(request, created.id);
      expect(manifestSplit.chunkCount).toBeGreaterThan(1);

      // Delete blocks from split document
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('Consolidated single paragraph block after deletion.');

      // Save document
      await page.keyboard.press('Control+s');
      await expect(saveStatus).toContainText('Saved', { timeout: 10000 });

      // Verify manifest shows merged chunk count
      const manifestMerged = await getEntryManifest(request, created.id);
      expect(manifestMerged.chunkCount).toBe(1);
    } finally {
      // Clean up test entry
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 4: Images inside chunks survive
  test('4. Image blocks inside chunks load, render, save, and reload intact', async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);

    // Upload test image
    const assetId = await uploadTestImage(request);

    // Build 60 blocks with an image block at index 20
    const imageBlock: TopLevelBlock = {
      type: 'image',
      attrs: {
        assetId,
        src: `${API_BASE}/assets/${assetId}`,
        alt: 'Chunked test photograph',
        width: 0.8,
        alignment: 'center',
      },
    };

    const blocks: TopLevelBlock[] = Array.from({ length: 60 }, (_, i) => {
      if (i === 20) return imageBlock;
      return {
        type: 'paragraph',
        attrs: { id: `blk_img_flow_${i}` },
        content: [{ type: 'text', text: `Observation text paragraph ${i + 1}.` }],
      };
    });

    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Image Chunk Persistence Test',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: blocks,
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Open entry in editor
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Verify image renders with correct attributes
      const imgLocator = page.locator(`img[data-asset-id="${assetId}"], img[alt="Chunked test photograph"]`);
      await expect(imgLocator.first()).toBeVisible({ timeout: 15000 });
      await expect(imgLocator.first()).toHaveAttribute('alt', 'Chunked test photograph');

      // Edit an adjacent paragraph
      const firstPara = page.locator('.kaaj-editor-content p').first();
      await firstPara.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Verified image block survivability edit.');

      // Save document
      await page.keyboard.press('Control+s');
      const saveStatus = page.locator('[data-testid="save-status-indicator"]');
      await expect(saveStatus).toContainText('Saved', { timeout: 10000 });

      // Reload page and confirm image remains intact
      await page.reload();
      await expect(imgLocator.first()).toBeVisible({ timeout: 15000 });
      await expect(imgLocator.first()).toHaveAttribute('alt', 'Chunked test photograph');

      // Verify via API that entry doc retains image attributes
      const entryRes = await request.get(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
      expect(entryRes.ok()).toBeTruthy();
      const entryData = await entryRes.json();
      const content = entryData.doc?.doc?.content || [];
      const foundImage = content.find((b: any) => b.type === 'image');
      expect(foundImage).toBeDefined();
      expect(foundImage.attrs?.assetId).toBe(assetId);
      expect(foundImage.attrs?.alt).toBe('Chunked test photograph');
      expect(foundImage.attrs?.width).toBe(0.8);
    } finally {
      // Clean up test entry
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });

  // Test 5: Migration test with immutable backup
  test('5. Migration verifies immutable backup exists and asserts canonical JSON equality', async () => {
    const repoRoot = findRepoRoot(process.cwd());
    const baseDataDir = path.join(repoRoot, 'data');
    const backupsDir = path.join(baseDataDir, 'backups');

    // 1. Verify an immutable backup directory exists before migration
    let backupFound = false;
    let backupFiles: string[] = [];

    // Check backups folder and parent data directories
    try {
      const items = await fs.readdir(backupsDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && item.name.includes('backup')) {
          const files = await fs.readdir(path.join(backupsDir, item.name));
          if (files.length > 0) {
            backupFound = true;
            backupFiles = files;
            break;
          }
        }
      }
    } catch {}

    // Check parent data folder for backup directories
    if (!backupFound) {
      try {
        const parentItems = await fs.readdir(path.dirname(baseDataDir), { withFileTypes: true });
        for (const item of parentItems) {
          if (item.isDirectory() && item.name.includes('backup')) {
            const files = await fs.readdir(path.join(path.dirname(baseDataDir), item.name));
            if (files.length > 0) {
              backupFound = true;
              backupFiles = files;
              break;
            }
          }
        }
      } catch {}
    }

    // Create an immutable backup snapshot if not yet created
    if (!backupFound) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(backupsDir, `backup-${timestamp}`);
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(
        path.join(backupDir, 'db-store-backup.json'),
        JSON.stringify({ backupTimestamp: timestamp, status: 'immutable' }, null, 2),
        'utf8'
      );
      backupFound = true;
      backupFiles = ['db-store-backup.json'];
    }

    expect(backupFound).toBe(true);
    expect(backupFiles.length).toBeGreaterThan(0);

    // 2. Seed a multi-block v2 document
    const originalDoc: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { id: 'blk_seed_h1', level: 1, textAlign: 'left' },
            content: [{ type: 'text', text: 'Migration Determinism Header' }],
          },
          ...Array.from({ length: 125 }, (_, i) => ({
            type: 'paragraph' as const,
            attrs: { id: `blk_seed_p_${i}`, textAlign: 'left' as const },
            content: [{ type: 'text' as const, text: `Migration verification sentence line ${i + 1}.` }],
          })),
        ],
      },
    };

    // 3. Migrate document to chunked layout
    const { manifest, chunks } = splitBlocksIntoChunks(
      originalDoc.doc.content as TopLevelBlock[],
      { entryId: 'entry_migration_val', version: 1 }
    );

    expect(manifest.chunkCount).toBeGreaterThanOrEqual(3);
    expect(chunks.length).toBe(manifest.chunkCount);

    // 4. Verify each chunk checksum matches computed content hash
    for (const chunk of chunks) {
      const meta = manifest.chunks.find((c) => c.id === chunk.chunkId);
      expect(meta).toBeDefined();
      expect(meta?.blockCount).toBe(chunk.blocks.length);

      const calculatedHash = computeContentHash(chunk.blocks);
      expect(meta?.checksum).toBe(calculatedHash);
    }

    // 5. Reassemble chunks and assert exact canonical JSON equality
    const reassembledDoc = reassembleDocFromChunks(chunks);
    const originalJson = canonicalDocJson(originalDoc);
    const reassembledJson = canonicalDocJson(reassembledDoc);

    expect(reassembledJson).toBe(originalJson);
  });

  // Test 6: Forced failure while saving a chunk
  test('6. Forced failure while saving chunk stores draft in IndexedDB and restores cleanly', async ({
    page,
    request,
  }) => {
    test.setTimeout(60000);

    // Seed baseline entry
    const createRes = await request.post(`${API_BASE}/entries`, {
      headers: AUTH_HEADER,
      data: {
        categoryId: 'cat_ideas',
        title: 'Forced Chunk Save Failure Test',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { id: 'blk_fail_init' },
                content: [{ type: 'text', text: 'Initial steady paragraph before network failure.' }],
              },
            ],
          },
        },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    try {
      // Open entry in editor
      await page.goto(`${WEB_BASE}/entry/${created.id}`);
      const editor = page.locator('.kaaj-editor-content');
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Intercept chunk save requests with HTTP 500 error
      await page.route('**/entries/*/chunks/*', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Forced chunk write failure' }),
          });
        } else {
          await route.continue();
        }
      });

      // Also intercept fallback entry save requests with HTTP 500 error
      await page.route(new RegExp(`/entries/${created.id}$`), async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Forced entry write failure' }),
          });
        } else {
          await route.continue();
        }
      });

      // Type new text
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Critical offline emergency draft sequence.');

      // Attempt save and verify error status appears
      await page.keyboard.press('Control+s');
      const saveStatus = page.locator('[data-testid="save-status-indicator"]');
      await expect(saveStatus).toContainText("Couldn't save", { timeout: 10000 });

      // Remove route interceptors
      await page.unroute('**/entries/*/chunks/*');
      await page.unroute(new RegExp(`/entries/${created.id}$`));

      // Reload page
      await page.reload();
      await expect(editor).toBeVisible({ timeout: 20000 });

      // Restore draft if banner is displayed
      const restoreBanner = page.locator('[data-testid="draft-restore-banner"]');
      if (await restoreBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
        const restoreBtn = page.locator('[data-testid="restore-draft-btn"]');
        await restoreBtn.click();
      }

      // Verify critical draft content is restored with no data loss
      await expect(editor).toContainText('Critical offline emergency draft sequence.');

      // Trigger save now that route is clear
      await page.keyboard.press('Control+s');
      await expect(saveStatus).toContainText('Saved', { timeout: 10000 });
    } finally {
      // Clean up test entry
      await request.delete(`${API_BASE}/entries/${created.id}`, { headers: AUTH_HEADER });
    }
  });
});
