import { chromium } from '@playwright/test';

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/category/cat_sketches');
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/sketches-after-1440px.png' });

  // 768px
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/sketches-after-768px.png' });

  // 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector('.book-spine-item');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/sketches-after-390px.png' });

  await browser.close();
  console.log('Captured after screenshots');
}

capture();
