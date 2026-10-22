import { chromium } from '@playwright/test';

export interface RenderPdfOptions {
  htmlContent: string;
}

export async function renderDocumentToPdf(options: RenderPdfOptions): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // 1200 x 1600 logical canvas viewport
    await page.setViewportSize({ width: 1200, height: 1600 });
    await page.setContent(options.htmlContent, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      width: '1200px',
      height: '1600px',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
