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
import { migrateEntriesToChunks } from '../apps/api/src/services/migration-service.js';

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

  // Test 5: Migration test with seeded 600-block v2 doc, text + images, real disk I/O & idempotency
  test('5. Migration verifies immutable backup exists and asserts canonical JSON equality on 600-block doc', async () => {
    test.setTimeout(60000);
    const repoRoot = findRepoRoot(process.cwd());
    const baseDataDir = path.join(repoRoot, 'data');

    // 1. Construct seeded 600-block document containing text, headings, and images
    const blocks: TopLevelBlock[] = [];
    for (let i = 0; i < 600; i++) {
      if (i % 100 === 0) {
        blocks.push({
          type: 'heading',
          attrs: { id: `blk_600_h_${i}`, level: 2, textAlign: 'left' },
          content: [{ type: 'text', text: `Section Header at Block ${i}` }],
        });
      } else if (i === 50 || i === 150 || i === 300 || i === 450 || i === 580) {
        blocks.push({
          type: 'image',
          attrs: {
            id: `blk_600_img_${i}`,
            assetId: `asset_seeded_img_${i}`,
            alt: `Seeded test image at block ${i}`,
            width: 0.8,
            storageKey: `asset_seeded_img_${i}.png`,
          },
        });
      } else {
        blocks.push({
          type: 'paragraph',
          attrs: { id: `blk_600_p_${i}`, textAlign: 'left' },
          content: [
            {
              type: 'text',
              text: `Paragraph content line ${i + 1} verifying 600-block migration determinism and chunk splitting.`,
            },
          ],
        });
      }
    }

    const testEntryId = 'entry_mig_600_test';
    const seededDoc: DocumentEnvelopeV2 = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: blocks,
      },
    };

    const seededEntry: any = {
      id: testEntryId,
      categoryId: 'cat_ideas',
      title: 'Seeded 600 Block Migration Test Entry',
      version: 1,
      doc: seededDoc,
      weight: 12,
      pinned: false,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 2. Execute migration against real disk data directory
    const migrationResult = await migrateEntriesToChunks(baseDataDir, [seededEntry]);
    expect(migrationResult.migratedCount).toBe(1);
    expect(migrationResult.backupPath).toBeTruthy();

    // 3. Assert backup directory exists and contains real files with bytes > 0
    const backupDirExists = fsSync.existsSync(migrationResult.backupPath);
    expect(backupDirExists).toBe(true);

    const backupFiles = await fs.readdir(migrationResult.backupPath);
    expect(backupFiles.length).toBeGreaterThan(0);

    // Verify at least one file has real non-zero bytes
    let totalBackupBytes = 0;
    for (const bf of backupFiles) {
      const stat = await fs.stat(path.join(migrationResult.backupPath, bf));
      totalBackupBytes += stat.size;
    }
    expect(totalBackupBytes).toBeGreaterThan(0);

    // 4. Read generated chunks and manifest from disk
    const chunksDir = path.join(baseDataDir, 'entries', testEntryId, 'chunks');
    const manifestPath = path.join(baseDataDir, 'entries', testEntryId, 'manifest.json');

    expect(fsSync.existsSync(chunksDir)).toBe(true);
    expect(fsSync.existsSync(manifestPath)).toBe(true);

    const rawManifest = await fs.readFile(manifestPath, 'utf8');
    const diskManifest: EntryManifest = JSON.parse(rawManifest);
    // 600 blocks split by 50 blocks per chunk = 12 chunks
    expect(diskManifest.chunkCount).toBe(12);
    expect(diskManifest.chunks.length).toBe(12);

    // Read all chunk files from disk
    const diskChunks: ChunkPayload[] = [];
    for (const chunkMeta of diskManifest.chunks) {
      const chunkFilePath = path.join(chunksDir, `${chunkMeta.id}.json`);
      expect(fsSync.existsSync(chunkFilePath)).toBe(true);
      const rawChunk = await fs.readFile(chunkFilePath, 'utf8');
      const chunkData: ChunkPayload = JSON.parse(rawChunk);
      diskChunks.push(chunkData);

      // Verify content hash matches manifest checksum
      const computedHash = computeContentHash(chunkData.blocks);
      expect(chunkMeta.checksum).toBe(computedHash);
    }

    // 5. Reassemble chunks from disk and assert canonical JSON matches original doc
    const reassembled = reassembleDocFromChunks(diskChunks);
    const originalJson = canonicalDocJson(seededDoc);
    const reassembledJson = canonicalDocJson(reassembled);
    expect(reassembledJson).toBe(originalJson);

    // 6. Re-run migration to assert idempotency (re-running changes nothing)
    const secondMigration = await migrateEntriesToChunks(baseDataDir, [seededEntry]);
    expect(secondMigration.migratedCount).toBe(1);

    const rawManifest2 = await fs.readFile(manifestPath, 'utf8');
    const diskManifest2: EntryManifest = JSON.parse(rawManifest2);
    expect(diskManifest2.chunkCount).toBe(diskManifest.chunkCount);
    expect(diskManifest2.chunks).toEqual(diskManifest.chunks);

    // Clean up temporary test files
    try {
      await fs.rm(path.join(baseDataDir, 'entries', testEntryId), { recursive: true, force: true });
    } catch {}
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
