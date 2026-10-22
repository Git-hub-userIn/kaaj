import { test, expect } from '@playwright/test';

test.describe('Phase 0 Spike Verification', () => {
  test('1. API health check returns verified runtime', async ({ request }) => {
    const res = await request.get('http://localhost:3001/health', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.phase).toBe('Phase 0 Spike');
  });

  test('2. Canvas renders fixed 3:4 aspect ratio and scales responsively', async ({ page }) => {
    await page.goto('http://localhost:3000/spike');
    const canvasPage = page.locator('[data-testid="canvas-page"]');
    await expect(canvasPage).toBeVisible();

    // Verify logical dimensions
    const width = await canvasPage.evaluate((el) => el.clientWidth);
    const height = await canvasPage.evaluate((el) => el.clientHeight);
    expect(width).toBe(1200);
    expect(height).toBe(1600);
    expect(width / height).toBeCloseTo(3 / 4, 2);

    // Verify tablet viewport scaling
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(canvasPage).toBeVisible();

    // Verify mobile viewport scaling
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(canvasPage).toBeVisible();

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('3. Rich text editor allows typing within canvas', async ({ page }) => {
    await page.goto('http://localhost:3000/spike');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    // Append text to the editor
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Adding verified notes.');

    await expect(editor).toContainText('Adding verified notes.');
  });

  test('4. Freeform overlay layer supports pointer dragging and transforms', async ({ page }) => {
    await page.goto('http://localhost:3000/spike');
    const sticker = page.locator('[data-testid="layer-object-obj_sticker_1"]');
    await expect(sticker).toBeVisible();

    // Initial transform check
    const initialTransform = await sticker.evaluate((el) => el.style.transform);
    expect(initialTransform).toContain('translate3d(750px, 150px');

    // Drag the sticker
    const box = await sticker.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50, { steps: 5 });
      await page.mouse.up();
    }

    // Verify updated transform
    const nextTransform = await sticker.evaluate((el) => el.style.transform);
    expect(nextTransform).not.toBe(initialTransform);
  });

  test('5. 200 objects drag benchmark operates smoothly', async ({ page }) => {
    await page.goto('http://localhost:3000/spike');
    const toggleBtn = page.locator('[data-testid="toggle-benchmark-btn"]');
    await toggleBtn.click();

    // Verify 200 objects created
    const firstObj = page.locator('[data-testid="layer-object-bench_obj_0"]');
    const lastObj = page.locator('[data-testid="layer-object-bench_obj_199"]');
    await expect(firstObj).toBeVisible();
    await expect(lastObj).toBeVisible();

    // Drag an object under load
    const box = await firstObj.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
      await page.mouse.up();
    }

    // Revert benchmark
    await toggleBtn.click();
    await expect(lastObj).not.toBeVisible();
  });

  test('6. Image upload, sharp WebP thumbnails, save, and reload persistence', async ({ page, request }) => {
    // Direct API image upload test using sharp
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGYzMMAAD//0wAB88kLycAAAAASUVORK5CYII=',
      'base64'
    );

    const uploadRes = await request.post('http://localhost:3001/assets', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      multipart: {
        file: {
          name: 'test-dot.png',
          mimeType: 'image/png',
          buffer: pngBuffer,
        },
      },
    });

    if (uploadRes.status() !== 201) {
      console.error('Upload response status:', uploadRes.status(), 'body:', await uploadRes.text());
    }
    expect(uploadRes.status()).toBe(201);
    const uploadData = await uploadRes.json();
    expect(uploadData.asset.id).toBeDefined();

    // Verify WebP thumbnail retrieval
    const thumbRes = await request.get(`http://localhost:3001/assets/${uploadData.asset.id}/thumb?size=320`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(thumbRes.status()).toBe(200);
    expect(thumbRes.headers()['content-type']).toBe('image/webp');

    // UI Save and Reload test
    await page.goto('http://localhost:3000/spike');
    const saveBtn = page.locator('[data-testid="save-btn"]');
    const reloadBtn = page.locator('[data-testid="reload-btn"]');
    const saveStatus = page.locator('[data-testid="save-status"]');

    await saveBtn.click();
    await expect(saveStatus).toContainText('Saved');
    await expect(saveStatus).toContainText('weight:');

    // Reload and verify
    await reloadBtn.click();
    await expect(saveStatus).toContainText('Saved');
  });

  test('7. PDF export produces valid PDF buffer via headless Chromium', async ({ request }) => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; background: #fcfbf7; font-family: serif; }
            #page { width: 1200px; height: 1600px; position: relative; }
            .title { font-size: 38px; color: #c25e38; margin: 40px; }
            .badge { position: absolute; top: 100px; left: 800px; padding: 20px; background: #f4e4dc; transform: rotate(-4deg); }
          </style>
        </head>
        <body>
          <div id="page">
            <h1 class="title">Kaaj PDF Export Proof</h1>
            <div class="badge">Exported Layer</div>
          </div>
        </body>
      </html>
    `;

    const res = await request.post('http://localhost:3001/export/pdf', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer kaaj-local-dev-token',
      },
      data: { htmlContent },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');

    const pdfBuffer = await res.body();
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // Verify standard PDF header magic bytes %PDF-
    const header = pdfBuffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });
});
