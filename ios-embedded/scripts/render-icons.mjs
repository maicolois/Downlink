// Rasterize the existing brand artwork; no separate iOS visual identity.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const icons = new URL('../public/assets/icons/', import.meta.url);
const svg = await fs.readFile(new URL('../../public/assets/icons/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : { channel: 'chrome' });
try {
  for (const [name, size, inset] of [
    ['apple-touch-icon', 180, 0], ['app-192', 192, 0],
    ['app-512', 512, 0], ['app-maskable-512', 512, 64],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:#0b0c0e}body{padding:${inset}px}svg{display:block;width:100%;height:auto}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, icons)) });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('Iconos de Downlink preparados.');
