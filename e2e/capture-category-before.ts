import { chromium } from '@playwright/test';

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/category/cat_ideas');
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-before-1440px.png', fullPage: false });

  // 1100px
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-before-1100px.png', fullPage: false });

  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/category-before-390px.png', fullPage: false });

  await browser.close();
  console.log('Captured category-before screenshots at 1440, 1100, and 390 px');
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
