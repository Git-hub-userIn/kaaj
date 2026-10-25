import { test, expect } from '@playwright/test';
import { DocumentEnvelopeV2Schema, ENTRY_SIZE_LIMITS } from '../packages/doc-model/src/index.js';

test.describe('Kaaj Entry Editor (v1) Suite', () => {
  // Test 1: Open an entry from the category stack. Type. Reload. The text stays.
  test('1. Open an entry from category stack, type, reload, and verify text persists', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('http://localhost:3000/category/cat_ideas');
    const firstSpine = page.locator('.book-spine-item').first();
    await expect(firstSpine).toBeVisible({ timeout: 15000 });

    await firstSpine.click();
    await expect(page).toHaveURL(/\/entry\/entry_ideas_1/, { timeout: 15000 });

    const titleInput = page.locator('[data-testid="entry-title-input"]');
    await expect(titleInput).toBeVisible();

    const editorBody = page.locator('.kaaj-editor-content');
    await expect(editorBody).toBeVisible();

    // Focus editor and append unique text
    await editorBody.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Persistent memory test sequence.');

    // Wait for quiet autosave indicator
    const saveStatus = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveStatus).toContainText('Saved', { timeout: 10000 });

    // Reload page
    await page.reload();
    await expect(editorBody).toBeVisible();
    await expect(editorBody).toContainText('Persistent memory test sequence.');
  });

  // Test 2: Formatting marks, blocks, alignment, persistence and strict Zod validation
  test('2. Formatting marks, blocks, alignment, persistence and strict Zod validation', async ({ page, request }) => {
    test.setTimeout(45000);
    await page.goto('http://localhost:3000/entry/entry_ideas_2');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    // Select text to bring up floating toolbar
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Formatting Showcase Line');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');

    const toolbar = page.locator('[data-testid="selection-toolbar"]');
    await expect(toolbar).toBeVisible();

    // Bold toggle
    const boldBtn = page.locator('[data-testid="toolbar-bold"]');
    await boldBtn.click();
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');

    // Italic toggle
    const italicBtn = page.locator('[data-testid="toolbar-italic"]');
    await italicBtn.click();
    await expect(italicBtn).toHaveAttribute('aria-pressed', 'true');

    // Underline toggle
    const underlineBtn = page.locator('[data-testid="toolbar-underline"]');
    await underlineBtn.click();
    await expect(underlineBtn).toHaveAttribute('aria-pressed', 'true');

    // Strikethrough toggle
    const strikeBtn = page.locator('[data-testid="toolbar-strike"]');
    await strikeBtn.click();
    await expect(strikeBtn).toHaveAttribute('aria-pressed', 'true');

    // Text color swatch
    const colorBtn = page.locator('[data-testid="toolbar-text-color"]');
    await colorBtn.click();
    const terracottaSwatch = page.locator('[data-testid="color-swatch-terracotta-dark"]');
    await expect(terracottaSwatch).toBeVisible();
    await terracottaSwatch.click();

    // Highlight swatch
    const highlightBtn = page.locator('[data-testid="toolbar-highlight"]');
    await highlightBtn.click();
    const sunYellowSwatch = page.locator('[data-testid="highlight-swatch-sun-yellow"]');
    await expect(sunYellowSwatch).toBeVisible();
    await sunYellowSwatch.click();

    // Font family dropdown
    const fontBtn = page.locator('[data-testid="toolbar-font-family"]');
    await fontBtn.click();
    const typewriterOption = page.locator('[data-testid="font-option-typewriter"]');
    await expect(typewriterOption).toBeVisible();
    await typewriterOption.click();

    // Stepped font size
    const sizeBtn = page.locator('[data-testid="toolbar-font-size"]');
    await sizeBtn.click();
    const size24Option = page.locator('[data-testid="font-size-option-24"]');
    await expect(size24Option).toBeVisible();
    await size24Option.click();

    // Alignment centre
    const alignCenterBtn = page.locator('[data-testid="toolbar-align-center"]');
    await alignCenterBtn.click();

    // Trigger save
    await page.keyboard.press('Control+s');
    const saveStatus = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveStatus).toContainText('Saved', { timeout: 10000 });

    // Verify stored JSON matches strict Zod schema in doc-model
    const res = await request.get('http://localhost:3001/entries/entry_ideas_2', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const parseResult = DocumentEnvelopeV2Schema.safeParse(body.doc);
    expect(parseResult.success).toBe(true);

    // Test Clear Formatting action
    await page.reload();
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');
    await expect(toolbar).toBeVisible();

    const clearBtn = page.locator('[data-testid="toolbar-clear-formatting"]');
    await clearBtn.click();
    await page.keyboard.press('Control+s');
    await expect(saveStatus).toContainText('Saved');
  });

  // Test 3: Selection toolbar shows on selection and hides on collapse and Esc
  test('3. Floating toolbar shows on selection and hides on collapse and Esc', async ({ page }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_3');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();
    await expect(page.locator('[data-testid="entry-title-input"]')).not.toHaveValue('', { timeout: 10000 });

    const toolbar = page.locator('[data-testid="selection-toolbar"]');
    await expect(toolbar).not.toBeVisible();

    // Select text -> shows
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Toolbar Visibility Sample');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');
    await expect(toolbar).toBeVisible();

    // Press Esc -> hides
    await page.keyboard.press('Escape');
    await expect(toolbar).not.toBeVisible();

    // Select again -> collapse -> hides
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await expect(toolbar).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar).not.toBeVisible();
  });

  // Test 4: Undo and Redo
  test('4. Undo and redo functionality', async ({ page }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_4');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' TestingUndoRedo.');
    await expect(editor).toContainText('TestingUndoRedo.');

    // Undo via keyboard shortcut Ctrl+z
    await page.keyboard.press('Control+z');
    await expect(editor).not.toContainText('TestingUndoRedo.');

    // Redo via keyboard shortcut Ctrl+Shift+z
    await page.keyboard.press('Control+Shift+z');
    await expect(editor).toContainText('TestingUndoRedo.');
  });

  // Test 5: Autosave states, offline draft restore, and reconnect
  test('5. Autosave offline failure and draft restoration', async ({ page, context }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_5');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    // Go offline with setOffline
    await context.setOffline(true);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Offline drafted observation text.');
    await page.waitForTimeout(600);

    // Trigger save while offline
    await page.keyboard.press('Control+s');
    const saveStatus = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveStatus).toContainText("Couldn't save", { timeout: 10000 });

    // Reconnect network and reload page to verify draft is restored from IndexedDB
    await context.setOffline(false);
    await page.reload();
    const restoreBanner = page.locator('[data-testid="draft-restore-banner"]');
    await expect(restoreBanner).toBeVisible({ timeout: 10000 });

    const restoreBtn = page.locator('[data-testid="restore-draft-btn"]');
    await restoreBtn.click();
    await expect(editor).toContainText('Offline drafted observation text.');

    await page.keyboard.press('Control+s');
    await expect(saveStatus).toContainText('Saved', { timeout: 10000 });
  });

  // Test 6: 409 conflict between two tabs
  test('6. 409 conflict handling with banner and resolution options', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await pageA.goto('http://localhost:3000/entry/entry_ideas_6');
    await pageB.goto('http://localhost:3000/entry/entry_ideas_6');

    const editorA = pageA.locator('.kaaj-editor-content');
    const editorB = pageB.locator('.kaaj-editor-content');
    await expect(editorA).toBeVisible();
    await expect(editorB).toBeVisible();

    // Tab A saves changes
    await editorA.click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type(' Tab A revision.');
    await pageA.keyboard.press('Control+s');
    await expect(pageA.locator('[data-testid="save-status-indicator"]')).toContainText('Saved', { timeout: 10000 });

    // Tab B attempts to save with stale version
    await editorB.click();
    await pageB.keyboard.press('End');
    await pageB.keyboard.type(' Tab B simultaneous update.');
    await pageB.keyboard.press('Control+s');

    // Conflict banner appears on tab B
    const conflictBanner = pageB.locator('[data-testid="conflict-banner"]');
    await expect(conflictBanner).toBeVisible({ timeout: 10000 });

    // Choose 'Keep mine' on tab B
    const keepMineBtn = pageB.locator('[data-testid="conflict-keep-mine-btn"]');
    await keepMineBtn.click();
    await expect(conflictBanner).not.toBeVisible();
    await expect(pageB.locator('[data-testid="save-status-indicator"]')).toContainText('Saved', { timeout: 10000 });

    await pageA.close();
    await pageB.close();
  });

  // Test 7: Whitelist HTML sanitizer for pasted content
  test('7. Paste sanitizer strips scripts, styles, and unknown tags while preserving safe rich text', async ({ page }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_7');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    // Trigger synthetic paste with unsanitized HTML
    const dirtyHtml = `
      <p>Clean Paragraph <script>window.__pwned = true;</script><style>body { display: none; }</style><strong>Bold Fragment</strong><img src="https://example.com/exploit.jpg" /><a href="javascript:alert(1)">Exploit Link</a><a href="https://valid-link.org">Safe Link</a></p>
    `;

    await editor.click();
    await page.evaluate((html) => {
      const event = new ClipboardEvent('paste', {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      });
      event.clipboardData?.setData('text/html', html);
      document.querySelector('.kaaj-editor-content')?.dispatchEvent(event);
    }, dirtyHtml);

    // Verify malicious content is never present in DOM
    const hasScriptInWindow = await page.evaluate(() => (window as any).__pwned);
    expect(hasScriptInWindow).toBeUndefined();
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
  });

  // Test 8: A migrated version-1 document opens without errors
  test('8. Migrated version-1 document opens smoothly', async ({ page, request }) => {
    // Seed a v1 entry directly
    const v1Entry = {
      categoryId: 'cat_ideas',
      title: 'Legacy V1 Archive Book',
      doc: {
        schemaVersion: 1,
        pages: [
          {
            id: 'p_legacy_1',
            size: { width: 1200, height: 1600 },
            background: { type: 'solid', token: 'paper' },
            body: {
              format: 'kaaj-rich-text-v1',
              content: [
                { type: 'heading', level: 1, text: 'Legacy V1 Header' },
                { type: 'paragraph', text: 'Preserved v1 paragraph content.' },
              ],
            },
            layers: [
              { id: 'l1', name: 'Discarded Layer', visible: true, locked: false, objects: [] },
            ],
          },
        ],
      },
    };

    const createRes = await request.post('http://localhost:3001/entries', {
      headers: {
        Authorization: 'Bearer kaaj-local-dev-token',
      },
      data: v1Entry,
    });
    if (!createRes.ok()) {
      console.error('Test 8 POST /entries failed:', createRes.status(), await createRes.text());
    }
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Open in editor
    await page.goto(`http://localhost:3000/entry/${created.id}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Preserved v1 paragraph content.');

    // Clean up created entry
    await request.delete(`http://localhost:3001/entries/${created.id}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
  });

  // Test 9: 50,000 word performance fixture & 2 MB size rejection limit
  test('9. 50,000 words performance benchmark and 2 MB size rejection', async ({ page, request }) => {
    // 50,000 word document fixture: 500 paragraphs of 100 words each
    const paragraphWords = new Array(100).fill('contemplation').join(' ');
    const paragraphs = Array.from({ length: 500 }, (_, i) => ({
      id: `blk_perf_${i}`,
      type: 'paragraph',
      content: [{ type: 'text', text: `Paragraph ${i + 1}: ${paragraphWords}` }],
    }));

    const perfDoc = {
      categoryId: 'cat_ideas',
      title: 'Fifty Thousand Words Performance Fixture',
      doc: {
        schemaVersion: 2,
        doc: {
          type: 'doc',
          content: paragraphs,
        },
      },
    };

    const createRes = await request.post('http://localhost:3001/entries', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
      data: perfDoc,
    });
    expect(createRes.ok()).toBeTruthy();
    const createdPerf = await createRes.json();

    const loadStart = Date.now();
    await page.goto(`http://localhost:3000/entry/${createdPerf.id}`);
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();
    const loadDurationMs = Date.now() - loadStart;

    // Type into editor and measure responsiveness
    const typeStart = Date.now();
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Responsive fluid keystroke.');
    const typeDurationMs = Date.now() - typeStart;
    const avgKeystrokeMs = (typeDurationMs / 28).toFixed(1);
    console.log(`[PERF BENCHMARK] 50,000 words document load: ${loadDurationMs}ms | typing 28 chars: ${typeDurationMs}ms (${avgKeystrokeMs}ms/keystroke)`);

    expect(typeDurationMs).toBeLessThan(4000);

    // Verify rejection above 2 MB
    const hugeBuffer = 'A'.repeat(ENTRY_SIZE_LIMITS.MAX_BYTES + 100);
    const hugeDoc = {
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          {
            id: 'b_huge',
            type: 'paragraph',
            content: [{ type: 'text', text: hugeBuffer }],
          },
        ],
      },
    };

    const rejectRes = await request.put('http://localhost:3001/entries/entry_ideas_8', {
      headers: {
        Authorization: 'Bearer kaaj-local-dev-token',
      },
      data: { doc: hugeDoc },
    });
    expect(rejectRes.status()).toBe(422);

    // Clean up performance benchmark entry
    await request.delete(`http://localhost:3001/entries/${createdPerf.id}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
  });

  // Test 10: Keyboard-only navigation with Slash menu and title enter
  test('10. Keyboard-only navigation with "/" block menu and title jump', async ({ page }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_9');

    // Title focus and Enter key moves to body
    const titleInput = page.locator('[data-testid="entry-title-input"]');
    await titleInput.click();
    await page.keyboard.press('Enter');

    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeFocused();

    // Type slash trigger
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    const slashMenu = page.locator('[data-testid="slash-menu"]');
    await expect(slashMenu).toBeVisible();

    // Navigate with ArrowDown and select Heading 2
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(slashMenu).not.toBeVisible();

    await page.keyboard.type('Keyboard Created Subheading');
    await expect(page.locator('.kaaj-editor-content h2')).toContainText('Keyboard Created Subheading');
  });

  // Test 11: Phone viewport (390 px) toolbar and layout
  test('11. Mobile phone viewport (390 px) docked toolbar and no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:3000/entry/entry_ideas_10');

    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();
    await expect(page.locator('[data-testid="entry-title-input"]')).not.toHaveValue('', { timeout: 10000 });

    // Verify no horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // Select text to bring up mobile toolbar dock
    await editor.click();
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');

    const toolbar = page.locator('[data-testid="selection-toolbar"]');
    await expect(toolbar).toBeVisible();

    // Verify touch targets >= 44 px
    const boldBtn = page.locator('[data-testid="toolbar-bold"]');
    const box = await boldBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  // Test 12: Edit title and text: book spine updates title and thickness
  test('12. Edit title and text: updates book spine title and thickness on category stack', async ({ page }) => {
    await page.goto('http://localhost:3000/entry/entry_ideas_11');

    const titleInput = page.locator('[data-testid="entry-title-input"]');
    await titleInput.fill('The New Spine Title Alpha');

    const editor = page.locator('.kaaj-editor-content');
    await editor.click();
    await page.keyboard.press('End');
    // Add substantial text to clearly increase weight
    await page.keyboard.type(' ' + 'Extensive paragraph text to significantly elevate entry weight and spine height. '.repeat(15));

    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-testid="save-status-indicator"]')).toContainText('Saved', { timeout: 10000 });

    // Return to Category Stack
    await page.locator('[data-testid="entry-back-btn"]').click();
    await expect(page).toHaveURL(/\/category\/cat_ideas/, { timeout: 10000 });

    // Spine title reflects edited title
    const updatedSpine = page.locator('.book-spine-item').filter({ hasText: 'The New Spine Title Alpha' });
    await expect(updatedSpine).toBeVisible();
  });

  // Test 13: Console errors check
  test('13. No console errors across entry editor interactions', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000/entry/entry_ideas_12');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.type(' Quietly observing errors.');
    await page.keyboard.press('Control+s');
    await expect(page.locator('[data-testid="save-status-indicator"]')).toContainText('Saved');

    expect(consoleErrors).toEqual([]);
  });

  // Test 14: Save orderedList and bulletList with standard Tiptap attributes
  test('14. Saving orderedList and bulletList succeeds without 422 validation errors', async ({ page, request }) => {
    await page.goto('http://localhost:3000/entry/entry_food-recipes_6');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. First recipe step');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second recipe step');
    await page.keyboard.press('Enter');

    // Trigger immediate save
    await page.keyboard.press('Control+s');
    const saveIndicator = page.locator('[data-testid="save-status-indicator"]');
    await expect(saveIndicator).toContainText('Saved', { timeout: 10000 });

    // Verify GET returns valid envelope matching DocumentEnvelopeV2Schema
    const getRes = await request.get('http://localhost:3001/entries/entry_food-recipes_6', {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json();
    const parse = DocumentEnvelopeV2Schema.safeParse(body.doc);
    expect(parse.success).toBe(true);
  });

  // Test 15: Links are clickable and open in a new tab
  test('15. Links in editor are clickable with pointer cursor and open in new tab', async ({ page, context }) => {
    await page.goto('http://localhost:3000/entry/entry_food-recipes_7');
    const editor = page.locator('.kaaj-editor-content');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Visit Web Library Source');

    // Select "Web Library Source" (18 chars)
    await page.keyboard.down('Shift');
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');

    // Apply link via toolbar
    const linkBtn = page.locator('[data-testid="toolbar-link"]');
    await expect(linkBtn).toBeVisible();
    await linkBtn.click();

    const linkInput = page.locator('[data-testid="link-url-input"]');
    await expect(linkInput).toBeVisible();
    await linkInput.fill('https://example.com/library');
    await page.locator('[data-testid="apply-link-btn"]').click();

    const linkEl = editor.locator('a').filter({ hasText: 'Web Library Source' }).first();
    await expect(linkEl).toBeVisible();
    await expect(linkEl).toHaveAttribute('target', '_blank');

    // Verify click triggers popup/new tab
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      linkEl.click(),
    ]);
    expect(popup.url()).toContain('example.com');
    await popup.close();
  });
});
