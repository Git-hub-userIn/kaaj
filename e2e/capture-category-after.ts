import { chromium } from '@playwright/test';

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // 1440px default
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/category/cat_ideas');
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-after-1440px.png', fullPage: false });

  // 1440px with hover
  const firstSpine1440 = page.locator('.book-spine-item').nth(1);
  await firstSpine1440.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/category-after-1440px-hover.png', fullPage: false });

  // 1100px
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-after-1100px.png', fullPage: false });

  // 1100px with hover showing collision-aware floating card
  const firstSpine1100 = page.locator('.book-spine-item').first();
  await firstSpine1100.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/category-after-1100px-hover.png', fullPage: false });

  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-after-390px.png', fullPage: false });

  await browser.close();
  console.log('Captured category-after screenshots at 1440, 1100, and 390 px');
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
