// Renders PNG app icons from public/icons/logo.svg using the preinstalled Playwright Chromium.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const svg = fs.readFileSync(path.join(__dirname, '../public/icons/logo.svg'), 'utf8');
const out = (f) => path.join(__dirname, '../public/icons', f);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (size, file, { maskable = false, square = false } = {}) => {
    await page.setViewportSize({ width: size, height: size });
    const inner = maskable ? Math.round(size * 0.72) : size;
    const bg = maskable || square ? '#1f5e3a' : 'transparent';
    // Full-bleed for maskable/apple icons: the platform applies its own rounding.
    const s = maskable || square ? svg.replace('rx="18"', 'rx="0"') : svg;
    await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${s.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    await page.screenshot({ path: out(file), omitBackground: !(maskable || square) });
  };
  await render(192, 'icon-192.png');
  await render(512, 'icon-512.png');
  await render(512, 'icon-maskable-512.png', { maskable: true });
  await render(180, 'apple-touch-icon.png', { square: true });
  await browser.close();
  console.log('icons written');
})();
