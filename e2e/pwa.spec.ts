import { test, expect } from '@playwright/test';

const WEB_BASE = 'http://localhost:3000';

test.describe('Phase 4J: PWA Suite', () => {
  test('Web App Manifest is properly linked and structured', async ({ page, request }) => {
    await page.goto(`${WEB_BASE}/`);

    // Verify manifest link tag in head
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');

    // Fetch and validate manifest contents
    const manifestRes = await request.get(`${WEB_BASE}/manifest.webmanifest`);
    expect(manifestRes.ok()).toBeTruthy();

    const manifest = await manifestRes.json();
    expect(manifest.name).toBe('Kaaj');
    expect(manifest.short_name).toBe('Kaaj');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.background_color).toBe('#f6f4ee');
    expect(manifest.theme_color).toBe('#f6f4ee');
    expect(Array.isArray(manifest.icons)).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('Service worker script serves correctly and registers in browser', async ({ page, request }) => {
    // 1. Validate sw.js serves with valid javascript
    const swRes = await request.get(`${WEB_BASE}/sw.js`);
    expect(swRes.ok()).toBeTruthy();
    const swText = await swRes.text();
    expect(swText).toContain('kaaj-pwa-v1');
    expect(swText).toContain('self.addEventListener');

    // 2. Load page and verify registration in client runtime
    await page.goto(`${WEB_BASE}/`);
    await page.waitForSelector('[data-testid="home-screen"]');

    // Wait for service worker registration to resolve
    const isRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });

    expect(isRegistered).toBeTruthy();
  });
});
