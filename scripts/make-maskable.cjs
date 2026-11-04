// Builds the Android "maskable" icon from public/icons/icon-512.png: the artwork is shrunk to 78%
// on the brand vino background so Android's round/squircle crop never cuts the P or the dot.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const icons = path.join(__dirname, '../public/icons');
(async () => {
  const b64 = fs.readFileSync(path.join(icons, 'icon-512.png')).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<body style="margin:0;background:#6E1E2E;display:grid;place-items:center;width:512px;height:512px">
    <img src="data:image/png;base64,${b64}" style="width:78%;height:78%"></body>`);
  await page.screenshot({ path: path.join(icons, 'icon-maskable-512.png') });
  await browser.close();
  console.log('maskable icon written');
})();
