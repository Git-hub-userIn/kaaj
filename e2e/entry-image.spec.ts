import { test, expect, type Page } from '@playwright/test';
import { DocumentEnvelopeV2Schema } from '../packages/doc-model/src/index.js';

// 1x1 transparent PNG base64 fixture (valid magic bytes: 0x89 0x50 0x4e 0x47)
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// SVG fixture (explicitly prohibited in editor image uploads)
const INVALID_SVG_CONTENT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red" /></svg>';

/**
 * Dispatch a synthetic clipboard paste event with a binary file to the editor.
 */
async function pasteImageFile(
  page: Page,
  payload: { base64: string; mime: string; filename: string }
) {
  await page.evaluate(({ base64, mime, filename }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const file = new File([bytes], filename, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);

    const event = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    const editor = document.querySelector('.kaaj-editor-content');
    editor?.dispatchEvent(event);
  }, payload);
}

/**
 * Dispatch synthetic dragenter, dragover, and drop events with a binary file to the editor.
 */
async function dropImageFile(
  page: Page,
  payload: { base64: string; mime: string; filename: string }
) {
  await page.evaluate(({ base64, mime, filename }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const file = new File([bytes], filename, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);

    const target = document.querySelector('.kaaj-editor-content');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const dragEnter = new DragEvent('dragenter', { clientX, clientY, bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, 'dataTransfer', { value: dt });

    const dragOver = new DragEvent('dragover', { clientX, clientY, bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, 'dataTransfer', { value: dt });

    const drop = new DragEvent('drop', { clientX, clientY, bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dt });

    target.dispatchEvent(dragEnter);
    target.dispatchEvent(dragOver);
    target.dispatchEvent(drop);
  }, payload);
}

/**
 * Dispatch a paste event with an oversized file (21 MB, exceeding the 20 MB limit).
 */
async function pasteOversizedFile(page: Page, filename = 'oversized-photo.png') {
  await page.evaluate(({ filename }) => {
    // Allocate 21 MB in browser memory
    const size = 21 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    // Set PNG magic bytes so type validator recognizes image format
    bytes[0] = 0x89;
    bytes[1] = 0x50;
    bytes[2] = 0x4e;
    bytes[3] = 0x47;

    const file = new File([bytes], filename, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);

    const event = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    const editor = document.querySelector('.kaaj-editor-content');
    editor?.dispatchEvent(event);
  }, { filename });
}

test.describe('Kaaj Entry Image Handling (Step 2) Suite', () => {
  let testEntryId: string;

  test.beforeEach(async ({ request }) => {
    // Create an isolated test entry before each test
    const res = await request.post('http://localhost:3001/entries', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      data: {
        categoryId: 'cat_ideas',
        title: 'Image Test Workspace',
        doc: {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: [
              {
                id: `blk_${Date.now()}`,
                type: 'paragraph',
                content: [{ type: 'text', text: 'Document body ready for image testing.' }],
              },
            ],
          },
        },
      },
    });

    expect(res.ok()).toBeTruthy();
    const created = await res.json();
    testEntryId = created.id;
  });

  test.afterEach(async ({ request, page }) => {
    // Unroute any pending route mocks
    try {
      await page.unroute('**/assets');
    } catch {
      // Ignore if no route was intercepted
    }

    // Clean up test entry from storage
    if (testEntryId) {
      await request.delete(`http://localhost:3001/entries/${testEntryId}`, {
        headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      }).catch(() => {});
    }
  });

  // Test 1: Paste image into editor -> upload succeeds -> image node rendered with assetId -> reload page -> image still present
  test('1. Paste image into editor -> upload succeeds -> image node rendered with assetId -> reload page -> image still present', async ({ page, request }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Focus editor body
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Paste valid PNG image and wait for successful upload response
    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/assets') && res.request().method() === 'POST' && res.status() === 201,
        { timeout: 15000 }
      ),
      pasteImageFile(page, {
        base64: VALID_PNG_BASE64,
        mime: 'image/png',
        filename: 'pasted-visual.png',
      }),
    ]);

    const uploadResult = await uploadResponse.json();
    const expectedAssetId = uploadResult.asset?.id;
    expect(expectedAssetId).toMatch(/^asset_/);

    // Verify image element is rendered with assetId attribute in editor DOM
    const imageNode = page
      .locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content [data-asset-id], .kaaj-editor-content img[data-asset-id]')
      .first();
    await expect(imageNode).toBeVisible({ timeout: 10000 });
    await expect(imageNode).toHaveAttribute('data-asset-id', expectedAssetId);

    // Save entry and verify quiet saved indicator
    await page.keyboard.press('Control+s');
    const saveIndicator = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveIndicator).toContainText('Saved', { timeout: 10000 });

    // Reload page and verify image node persistence
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const reloadedImage = page
      .locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content [data-asset-id], .kaaj-editor-content img[data-asset-id]')
      .first();
    await expect(reloadedImage).toBeVisible({ timeout: 10000 });
    await expect(reloadedImage).toHaveAttribute('data-asset-id', expectedAssetId);

    // Confirm doc envelope storage in API contains assetId reference without raw URL
    const getRes = await request.get(`http://localhost:3001/entries/${testEntryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(getRes.ok()).toBeTruthy();
    const entryData = await getRes.json();
    const blocks = entryData.doc?.doc?.content || [];
    const storedImageBlock = blocks.find((b: any) => b.type === 'image');
    expect(storedImageBlock).toBeDefined();
    expect(storedImageBlock.attrs?.assetId).toBe(expectedAssetId);
  });

  // Test 2: Drag and drop image file into editor -> image inserted
  test('2. Drag and drop image file into editor -> image inserted', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();

    // Drop valid image file into editor and await upload
    const [dropUploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/assets') && res.request().method() === 'POST' && res.status() === 201,
        { timeout: 15000 }
      ),
      dropImageFile(page, {
        base64: VALID_PNG_BASE64,
        mime: 'image/png',
        filename: 'dropped-sketch.png',
      }),
    ]);

    const uploadResult = await dropUploadResponse.json();
    const droppedAssetId = uploadResult.asset?.id;
    expect(droppedAssetId).toMatch(/^asset_/);

    // Verify dropped image element appears in editor
    const droppedImage = page
      .locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content [data-asset-id], .kaaj-editor-content img[data-asset-id]')
      .first();
    await expect(droppedImage).toBeVisible({ timeout: 10000 });
    await expect(droppedImage).toHaveAttribute('data-asset-id', droppedAssetId);

    // Save entry
    await page.keyboard.press('Control+s');
    const saveIndicator = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveIndicator).toContainText('Saved', { timeout: 10000 });
  });

  // Test 3: Resize image width (e.g. using resize buttons/handles) -> reload page -> new width persists in doc
  test('3. Resize image width -> reload page -> new width persists in doc', async ({ page, request }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Insert an initial image via paste
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/assets') && res.request().method() === 'POST' && res.status() === 201),
      pasteImageFile(page, {
        base64: VALID_PNG_BASE64,
        mime: 'image/png',
        filename: 'resizable-graphic.png',
      }),
    ]);

    const imageNode = page
      .locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content [data-asset-id], .kaaj-editor-content img')
      .first();
    await expect(imageNode).toBeVisible({ timeout: 10000 });

    // Click image to reveal resize controls
    await imageNode.click();

    // Check for preset resize button (e.g. 50%) or draggable resize handle
    const resize50Btn = page.locator(
      '[data-testid="image-resize-50"], [data-testid="image-resize-btn-50"], [data-testid="image-width-50"]'
    );
    const resizeHandle = page.locator(
      '[data-testid="image-resize-handle"], [data-testid="image-width-handle"], .image-resizer-handle'
    );

    if (await resize50Btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await resize50Btn.click();
    } else if (await resizeHandle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const box = await resizeHandle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 120, box.y);
        await page.mouse.up();
      }
    } else {
      // Fallback: trigger resize change via keyboard or node attribute if controls use selection toolbar
      const toolbarResize = page.locator('[data-testid="toolbar-image-resize-50"]');
      if (await toolbarResize.isVisible({ timeout: 1000 }).catch(() => false)) {
        await toolbarResize.click();
      }
    }

    // Save and wait for confirmation
    await page.keyboard.press('Control+s');
    const saveIndicator = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveIndicator).toContainText('Saved', { timeout: 10000 });

    // Reload page to verify persistence of resized width
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const reloadedImage = page
      .locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content [data-asset-id], .kaaj-editor-content img')
      .first();
    await expect(reloadedImage).toBeVisible({ timeout: 10000 });

    const widthAttr = await reloadedImage.getAttribute('data-width');
    const styleAttr = await reloadedImage.getAttribute('style');
    const hasResizedWidth = (widthAttr && widthAttr !== '100') || (styleAttr && /width:\s*(?:50%|[2-8][0-9]%|[0-9]+px)/i.test(styleAttr));
    expect(hasResizedWidth).toBeTruthy();

    // Verify stored doc envelope retains width attribute
    const entryRes = await request.get(`http://localhost:3001/entries/${testEntryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    const entryData = await entryRes.json();
    const storedBlock = entryData.doc?.doc?.content?.find((b: any) => b.type === 'image');
    expect(storedBlock).toBeDefined();
    if (storedBlock?.attrs?.width !== undefined) {
      expect(storedBlock.attrs.width).toBeLessThanOrEqual(80);
    }
  });

  // Test 4: Wrong file type rejected (e.g. .txt or .svg) -> error toast/banner displayed, no image node inserted into editor
  test('4. Wrong file type rejected (e.g. .txt or .svg) -> error toast/banner displayed, no image node inserted into editor', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await page.keyboard.press('End');

    // Attempt to paste SVG file (prohibited format)
    const svgBase64 = Buffer.from(INVALID_SVG_CONTENT).toString('base64');
    await pasteImageFile(page, {
      base64: svgBase64,
      mime: 'image/svg+xml',
      filename: 'diagram.svg',
    });

    // Error notification or banner is shown
    const errorNotice = page.locator(
      '[data-testid="editor-error-toast"], [data-testid="image-error-toast"], [data-testid="toast-error"], [data-testid="error-banner"], [role="alert"]'
    ).first();
    await expect(errorNotice).toBeVisible({ timeout: 10000 });
    await expect(errorNotice).toContainText(/unsupported|invalid|format|svg|reject/i);

    // Ensure no image node is inserted in editor
    const imageElements = page.locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content img');
    await expect(imageElements).toHaveCount(0);

    // Attempt to drop a text file (.txt)
    const txtBase64 = Buffer.from('Plain text notes that are not image bytes').toString('base64');
    await dropImageFile(page, {
      base64: txtBase64,
      mime: 'text/plain',
      filename: 'notes.txt',
    });

    await expect(errorNotice).toBeVisible({ timeout: 10000 });
    await expect(imageElements).toHaveCount(0);
  });

  // Test 5: File larger than 20 MB rejected -> error message displayed, no image node inserted
  test('5. File larger than 20 MB rejected -> error message displayed, no image node inserted', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    await editor.click();
    await page.keyboard.press('End');

    // Dispatch paste with 21 MB payload
    await pasteOversizedFile(page, 'oversized-capture.png');

    // Error banner or toast message appears informing user of 20 MB limit
    const sizeError = page.locator(
      '[data-testid="size-error-banner"], [data-testid="editor-error-toast"], [data-testid="image-error-toast"], [data-testid="toast-error"], [role="alert"]'
    ).first();
    await expect(sizeError).toBeVisible({ timeout: 10000 });
    await expect(sizeError).toContainText(/20 MB|exceeds|too large|limit/i);

    // Verify editor content remains clean without any image element
    const images = page.locator('.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content img');
    await expect(images).toHaveCount(0);
  });

  // Test 6: Simulated upload failure (route intercept returning 500) -> error shown, editor remains clean with no broken image or dangling reference
  test('6. Simulated upload failure (route intercept returning 500) -> error shown, editor remains clean with no broken image or dangling reference', async ({ page, request }) => {
    test.setTimeout(45000);

    await page.goto(`http://localhost:3000/entry/${testEntryId}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible({ timeout: 15000 });

    // Mock 500 internal server error for asset upload endpoint
    await page.route('**/assets', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Storage cluster temporarily unavailable' }),
        });
      } else {
        await route.continue();
      }
    });

    await editor.click();
    await page.keyboard.press('End');

    // Attempt image paste while upload endpoint is failing
    await pasteImageFile(page, {
      base64: VALID_PNG_BASE64,
      mime: 'image/png',
      filename: 'faulty-upload.png',
    });

    // Verify error notification appears
    const failureToast = page.locator(
      '[data-testid="editor-error-toast"], [data-testid="image-error-toast"], [data-testid="toast-error"], [data-testid="error-banner"], [role="alert"]'
    ).first();
    await expect(failureToast).toBeVisible({ timeout: 10000 });

    // Verify editor has no broken image, placeholder node, or empty image element
    const images = page.locator(
      '.kaaj-editor-content [data-testid="editor-image"], .kaaj-editor-content img, .kaaj-editor-content [data-type="image"], .kaaj-editor-content .image-placeholder'
    );
    await expect(images).toHaveCount(0);

    // Remove route intercept
    await page.unroute('**/assets');

    // Save document to ensure clean document envelope state
    await page.keyboard.press('Control+s');
    const saveIndicator = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveIndicator).toContainText('Saved', { timeout: 10000 });

    // Verify stored doc envelope in API contains zero dangling image blocks
    const res = await request.get(`http://localhost:3001/entries/${testEntryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const imageBlocks = (data.doc?.doc?.content || []).filter((b: any) => b.type === 'image');
    expect(imageBlocks.length).toBe(0);
  });
});
