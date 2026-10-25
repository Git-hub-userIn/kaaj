import { test } from '@playwright/test';

test('Capture entry editor screenshots at 1440, 768, and 390 px', async ({ page }) => {
  test.setTimeout(60000);

  // 1440px Desktop
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/entry/entry_ideas_1');
  await page.waitForSelector('.kaaj-editor-content');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '../docs/screenshots/entry-1440px.png', fullPage: false });

  // 1440px with Selection Toolbar
  const editor = page.locator('.kaaj-editor-content');
  await editor.click();
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../docs/screenshots/entry-1440px-selection.png', fullPage: false });

  // 768px Tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await page.waitForSelector('.kaaj-editor-content');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '../docs/screenshots/entry-768px.png', fullPage: false });

  // 390px Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('.kaaj-editor-content');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '../docs/screenshots/entry-390px.png', fullPage: false });

  // 390px Mobile with docked toolbar
  const mobileEditor = page.locator('.kaaj-editor-content');
  await mobileEditor.click();
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../docs/screenshots/entry-390px-toolbar.png', fullPage: false });
});
