import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3001';
const WEB_BASE = 'http://localhost:3000';

const ALICE_AUTH = { Authorization: 'Bearer token-user-alice' };
const BOB_AUTH = { Authorization: 'Bearer token-user-bob' };
const DEV_AUTH = { Authorization: 'Bearer kaaj-local-dev-token' };

test.describe('Phase 4D: Editor Blocks & Document Outline Suite', () => {
  let aliceCategoryId: string;
  let aliceEntryId: string;
  let devCategoryId: string;
  let devEntryId: string;

  test.beforeAll(async ({ request }) => {
    // 1. Seed Alice data with rich blocks
    const aCatRes = await request.post(`${API_BASE}/categories`, {
      headers: ALICE_AUTH,
      data: { title: 'Alice Laboratory Notebook', color: '#0284c7' },
    });
    expect(aCatRes.ok()).toBeTruthy();
    aliceCategoryId = (await aCatRes.json()).id;

    const aliceDocPayload = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Alice Experimental Methodology' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Introduction to modular experiment design.' }],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Metric' }] }],
                  },
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] }],
                  },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latency' }] }],
                  },
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '< 50ms' }] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Tasks and Checklist' }],
          },
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Calibrate sensors' }] }],
              },
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Record baseline reading' }] }],
              },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { language: 'typescript' },
            content: [{ type: 'text', text: 'const sample = analyzeSignal(stream);' }],
          },
          {
            type: 'callout',
            attrs: { variant: 'warning' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'High voltage caution zone.' }] }],
          },
        ],
      },
    };

    const aEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: ALICE_AUTH,
      data: {
        categoryId: aliceCategoryId,
        title: 'Alice Experimental Methodology',
        doc: aliceDocPayload,
      },
    });
    expect(aEntryRes.ok()).toBeTruthy();
    aliceEntryId = (await aEntryRes.json()).id;

    // 2. Seed Dev user data for UI test
    const devCatRes = await request.post(`${API_BASE}/categories`, {
      headers: DEV_AUTH,
      data: { title: 'Dev Blocks Project', color: '#10b981' },
    });
    expect(devCatRes.ok()).toBeTruthy();
    devCategoryId = (await devCatRes.json()).id;

    const devEntryRes = await request.post(`${API_BASE}/entries`, {
      headers: DEV_AUTH,
      data: {
        categoryId: devCategoryId,
        title: 'Dev Blocks and Outline Showcase',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Comprehensive System Overview' }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Paragraph under primary heading.' }],
              },
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Performance Specifications' }],
              },
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    content: [
                      {
                        type: 'tableHeader',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }],
                      },
                      {
                        type: 'tableHeader',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }],
                      },
                    ],
                  },
                  {
                    type: 'tableRow',
                    content: [
                      {
                        type: 'tableCell',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tables' }] }],
                      },
                      {
                        type: 'tableCell',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Complete' }] }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'taskList',
                content: [
                  {
                    type: 'taskItem',
                    attrs: { checked: true },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deliver phase 4D' }] }],
                  },
                ],
              },
              {
                type: 'codeBlock',
                content: [{ type: 'text', text: 'console.log("Kaaj rich blocks");' }],
              },
              {
                type: 'callout',
                attrs: { variant: 'info' },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Informational callout banner.' }] }],
              },
            ],
          },
        },
      },
    });
    expect(devEntryRes.ok()).toBeTruthy();
    devEntryId = (await devEntryRes.json()).id;
  });

  test('saves and reassembles rich blocks (table, taskList, codeBlock, callout) cleanly', async ({ request }) => {
    const res = await request.get(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: ALICE_AUTH,
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    const blocks = data.doc.doc.content;

    const tableBlock = blocks.find((b: any) => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock.content.length).toBe(2);

    const taskListBlock = blocks.find((b: any) => b.type === 'taskList');
    expect(taskListBlock).toBeDefined();
    expect(taskListBlock.content[0].attrs.checked).toBe(true);
    expect(taskListBlock.content[1].attrs.checked).toBe(false);

    const codeBlock = blocks.find((b: any) => b.type === 'codeBlock');
    expect(codeBlock).toBeDefined();
    expect(codeBlock.content[0].text).toContain('analyzeSignal');

    const calloutBlock = blocks.find((b: any) => b.type === 'callout');
    expect(calloutBlock).toBeDefined();
    expect(calloutBlock.attrs.variant).toBe('warning');
  });

  test('enforces cross-user isolation: User Bob cannot access Alice rich block entry', async ({ request }) => {
    const res = await request.get(`${API_BASE}/entries/${aliceEntryId}`, {
      headers: BOB_AUTH,
    });
    expect(res.status()).toBe(404);
  });

  test('renders rich blocks in editor and toggles outline sidebar in UI', async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('BROWSER ERROR:', err.message));

    await page.goto(`${WEB_BASE}/entry/${devEntryId}`);
    await page.waitForSelector('[data-testid="entry-editor-screen"]', { timeout: 10000 });

    // 1. Verify rich blocks exist in DOM
    const tableEl = page.locator('.kaaj-editor-content table');
    await expect(tableEl).toBeVisible();

    const taskListEl = page.locator('.kaaj-editor-content ul[data-type="taskList"]');
    await expect(taskListEl).toBeVisible();

    const codeBlockEl = page.locator('.kaaj-editor-content pre code');
    await expect(codeBlockEl).toBeVisible();

    const calloutEl = page.locator('.kaaj-editor-content [data-callout]');
    await expect(calloutEl).toBeVisible();

    // 2. Open Document Outline sidebar
    const outlineBtn = page.locator('[data-testid="toolbar-outline-btn"]');
    await expect(outlineBtn).toBeVisible();
    await outlineBtn.click();

    const outlineSidebar = page.locator('[data-testid="outline-sidebar"]');
    await expect(outlineSidebar).toBeVisible();

    // 3. Verify headings in outline
    const h1Item = page.locator('[data-testid="outline-item-h1"]');
    await expect(h1Item).toBeVisible();
    await expect(h1Item).toContainText('Comprehensive System Overview');

    const h2Item = page.locator('[data-testid="outline-item-h2"]');
    await expect(h2Item).toBeVisible();
    await expect(h2Item).toContainText('Performance Specifications');

    // 4. Click heading to navigate
    await h2Item.click();

    // 5. Close outline via button
    const closeBtn = page.locator('[data-testid="close-outline-btn"]');
    await closeBtn.click();
    await expect(outlineSidebar).toBeHidden();

    // 6. Reopen and close via Escape
    await outlineBtn.click();
    await expect(outlineSidebar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(outlineSidebar).toBeHidden();
  });
});
