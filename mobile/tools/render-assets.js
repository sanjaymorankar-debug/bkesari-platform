/**
 * Renders each app's icon and splash sources from the Kesari icon set
 * (packages/kesari-ui/src/icons.json) into apps/<app>/assets/, the folder
 * `npx @capacitor/assets generate` reads to make every Android and iOS size:
 *
 *   icon-only.png        1024 x 1024, iOS app icon (no transparency)
 *   icon-foreground.png  1024 x 1024, Android adaptive icon foreground (transparent, inside the safe zone)
 *   icon-background.png  1024 x 1024, Android adaptive icon background (the project accent)
 *   splash.png           2732 x 2732, light splash
 *   splash-dark.png      2732 x 2732, dark splash
 *
 * Run from the repository root: node mobile/tools/render-assets.js
 * Needs Playwright with Chromium (development only; nothing here ships).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..');
const set = JSON.parse(fs.readFileSync(path.join(root, 'packages/kesari-ui/src/icons.json'), 'utf8'));
const icons = { ...set.project, ...set.ui };
// The same accents as Kesari 1.1.0 (light fill, dark fill).
const APPS = {
  ladwani: { name: 'LadWani', accent: '#7C2D12', dark: '#F4A68C' },
  education: { name: 'Education', accent: '#0F766E', dark: '#5EEAD4' },
  tasklist: { name: 'TaskList', accent: '#4338CA', dark: '#A5B4FC' },
};

const glyph = (key, size, x, y, colour, stroke = 1.75) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${icons[key]}</g>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

function art(key, app) {
  return {
    // iOS masks the corners itself: a full square, the icon at 56 %.
    'icon-only.png': svg(1024, 1024, `<rect width="1024" height="1024" fill="${app.accent}"/>${glyph(key, 576, 224, 224, '#FFFFFF', 1.6)}` +
      // the bkesari mark in the corner: every app is part of bkesari
      `<rect x="760" y="760" width="168" height="168" rx="44" fill="#C2560A" stroke="#FFFFFF" stroke-width="10"/>` +
      `<text x="844" y="882" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="120" fill="#FFFFFF">b</text>`),
    // Android: the foreground must sit inside the central 66 % safe zone.
    'icon-foreground.png': svg(1024, 1024, glyph(key, 440, 292, 292, '#FFFFFF', 1.6)),
    'icon-background.png': svg(1024, 1024, `<rect width="1024" height="1024" fill="${app.accent}"/>`),
    'splash.png': svg(2732, 2732, `<rect width="2732" height="2732" fill="#FAF8F5"/><rect x="1106" y="1046" width="520" height="520" rx="146" fill="${app.accent}"/>` +
      `${glyph(key, 300, 1216, 1156, '#FFFFFF', 1.6)}<text x="1366" y="1760" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="112" fill="#1C1917">${app.name}</text>` +
      `<text x="1366" y="1860" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="64" fill="#57534E">bkesari.com</text>`),
    'splash-dark.png': svg(2732, 2732, `<rect width="2732" height="2732" fill="#141110"/><rect x="1106" y="1046" width="520" height="520" rx="146" fill="${app.dark}"/>` +
      `${glyph(key, 300, 1216, 1156, '#1C1917', 1.6)}<text x="1366" y="1760" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="112" fill="#F5F5F4">${app.name}</text>` +
      `<text x="1366" y="1860" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="64" fill="#C9C4BF">bkesari.com</text>`),
  };
}

(async () => {
  const browser = await chromium.launch();
  for (const [key, app] of Object.entries(APPS)) {
    const out = path.join(root, 'mobile', 'apps', key, 'assets');
    fs.mkdirSync(out, { recursive: true });
    for (const [file, markup] of Object.entries(art(key, app))) {
      const [, w, h] = markup.match(/width="(\d+)" height="(\d+)"/);
      const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`);
      await page.screenshot({ path: path.join(out, file), omitBackground: file === 'icon-foreground.png' });
      await page.close();
      console.log(`${key}/${file}`);
    }
  }
  await browser.close();
})();
