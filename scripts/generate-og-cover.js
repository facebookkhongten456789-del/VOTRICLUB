/**
 * Render assets/og-cover.svg → assets/og-cover.png (1200x630) for Discord/OG crawlers.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

async function main() {
    const svgPath = path.join(__dirname, '..', 'assets', 'og-cover.svg');
    const outPath = path.join(__dirname, '..', 'assets', 'og-cover.png');
    if (!fs.existsSync(svgPath)) {
        throw new Error('Missing assets/og-cover.svg');
    }

    const svg = fs.readFileSync(svgPath, 'utf8');
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #030308; }
    img, svg { display: block; width: 1200px; height: 630px; }
  </style>
</head>
<body>${svg}</body>
</html>`;

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    } finally {
        await browser.close();
    }

    const stat = fs.statSync(outPath);
    console.log('OK', outPath, stat.size, 'bytes');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
