import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const API_BASE = 'http://localhost:3001';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };

test.describe('Phase 4G: Import/Export Suite', () => {
  let aliceCatId: string;
  let aliceEntryId: string;
  let exportedZipBuffer: Buffer;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice category and entry
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Export Vault', color: '#f59e0b' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCatId = (await aCatRes.json()).id;

    const aEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: { categoryId: aliceCatId, title: 'Alice Comprehensive Research' },
    });
    expect(aEntryRes.ok()).toBeTruthy();
    aliceEntryId = (await aEntryRes.json()).id;

    // Save structured blocks and tags
    await request.put(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
      data: {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Executive Summary' }],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'This document tests full round-trip export and import.',
                },
              ],
            },
            {
              type: 'taskList',
              attrs: {},
              content: [
                {
                  type: 'taskItem',
                  attrs: { checked: true },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Prepare export specs' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    // Tag the entry
    await request.post(`${API_BASE}/entries/${aliceEntryId}/tags`, {
      headers: ALICE_AUTH,
      data: { name: 'archive' },
    });
  });

  test('exports single entry as Markdown with YAML frontmatter and enforces user isolation', async ({ request }) => {
    // Alice exports her entry
    const mdRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/export/markdown`, {
      headers: ALICE_AUTH,
    });
    expect(mdRes.status()).toBe(200);
    const mdText = await mdRes.text();
    expect(mdText).toContain('---');
    expect(mdText).toContain('title: "Alice Comprehensive Research"');
    expect(mdText).toContain('# Executive Summary');
    expect(mdText).toContain('- [x] Prepare export specs');

    // Bob cannot export Alice's entry (404 isolation)
    const bobRes = await request.get(`${API_BASE}/entries/${aliceEntryId}/export/markdown`, {
      headers: BOB_AUTH,
    });
    expect(bobRes.status()).toBe(404);
  });

  test('exports ZIP archive and round-trips via import under isolated user', async ({ request }) => {
    // 1. Alice exports full ZIP
    const zipRes = await request.get(`${API_BASE}/export/zip`, {
      headers: ALICE_AUTH,
    });
    expect(zipRes.status()).toBe(200);
    expect(zipRes.headers()['content-type']).toContain('application/zip');

    const arrayBuf = await zipRes.body();
    exportedZipBuffer = Buffer.from(arrayBuf);
    expect(exportedZipBuffer.length).toBeGreaterThan(100);

    // Verify ZIP structure with JSZip
    const zip = await JSZip.loadAsync(exportedZipBuffer);
    expect(zip.file('manifest.json')).toBeDefined();
    expect(zip.file('categories.json')).toBeDefined();
    expect(zip.file(`entries/${aliceEntryId}.json`)).toBeDefined();
    expect(zip.file(`markdown/${aliceEntryId}.md`)).toBeDefined();

    // 2. Bob imports Alice's ZIP archive
    const importRes = await request.post(`${API_BASE}/import/zip`, {
      headers: {
        ...BOB_AUTH,
        'Content-Type': 'application/zip',
      },
      data: exportedZipBuffer,
    });
    expect(importRes.status()).toBe(200);
    const importResult = await importRes.json();
    expect(importResult.success).toBe(true);
    expect(importResult.categoriesImported).toBeGreaterThanOrEqual(1);
    expect(importResult.entriesImported).toBeGreaterThanOrEqual(1);

    // 3. Verify Bob now has his own isolated copy of the category and entry
    const bobCatsRes = await request.get(`${API_BASE}/categories`, {
      headers: BOB_AUTH,
    });
    expect(bobCatsRes.status()).toBe(200);
    const bobCats = await bobCatsRes.json();
    const bobImportedCat = bobCats.find((c: any) => c.title === 'Alice Export Vault');
    expect(bobImportedCat).toBeDefined();

    const bobEntriesRes = await request.get(`${API_BASE}/categories/${bobImportedCat.id}/entries`, {
      headers: BOB_AUTH,
    });
    expect(bobEntriesRes.status()).toBe(200);
    const bobEntries = await bobEntriesRes.json();
    const bobImportedEntry = bobEntries.find((e: any) => e.title === 'Alice Comprehensive Research');
    expect(bobImportedEntry).toBeDefined();
  });

  test('imports raw Markdown with YAML frontmatter into target category', async ({ request }) => {
    const rawMarkdown = `---
title: "Imported Markdown Protocol"
tags: ["spec", "offline"]
---

# Protocol Title
This is paragraph content imported from standard Obsidian markdown.

- [ ] Task item 1
- [x] Task item 2

> Important note quote block
`;

    const importMdRes = await request.post(`${API_BASE}/import/markdown`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCatId,
        markdown: rawMarkdown,
        filename: 'protocol.md',
      },
    });
    expect(importMdRes.status()).toBe(201);
    const imported = await importMdRes.json();
    expect(imported.id).toBeDefined();
    expect(imported.title).toBe('Imported Markdown Protocol');

    // Verify imported entry exists in Alice's category
    const entryRes = await request.get(`${API_BASE}/entries/${imported.id}`, {
      headers: ALICE_AUTH,
    });
    expect(entryRes.status()).toBe(200);
    const entryData = await entryRes.json();
    expect(entryData.title).toBe('Imported Markdown Protocol');
  });
});
