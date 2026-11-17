/**
 * The bkesari app's launcher icons and splash screens, in the Kesari brand:
 * a white "b" (Mukta 700, Kesari's own face) on saffron #C2560A, the mark the
 * site's header uses. Replaces Capacitor's placeholder images in
 * mobile/bkesari/android/app/src/main/res and ios/App/App/Assets.xcassets,
 * each at the size and colour mode it already had.
 *
 * Run from the repository root: node mobile/tools/render-bkesari-app.js
 * Needs Playwright with Chromium and python3 with Pillow (development only).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..');
const app = path.join(root, 'mobile', 'bkesari');
const res = path.join(app, 'android', 'app', 'src', 'main', 'res');
const ios = path.join(app, 'ios', 'App', 'App', 'Assets.xcassets');
const font = fs.readFileSync(path.join(root, 'packages', 'kesari-ui', 'fonts', 'mukta-latin-700-normal.woff2')).toString('base64');
const SAFFRON = '#C2560A';

const page = (w, h, body) => `<!doctype html><html><head><style>
@font-face{font-family:M;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:700}
html,body{margin:0;width:${w}px;height:${h}px;background:transparent;overflow:hidden}
.c{position:absolute;inset:0;display:grid;place-items:center}
.b{font:700 1px/1 M;color:#fff;transform:translateY(-4%)}
</style></head><body>${body}</body></html>`;

// shape: 'square' (full bleed), 'rounded', 'round', 'none' (foreground only); glyph as a share of the side.
function icon(size, shape, share) {
  const radius = shape === 'round' ? '50%' : shape === 'rounded' ? `${Math.round(size * 0.22)}px` : '0';
  const bg = shape === 'none' ? 'transparent' : SAFFRON;
  return page(size, size, `<div class="c" style="background:${bg};border-radius:${radius}"><span class="b" style="font-size:${Math.round(size * share)}px">b</span></div>`);
}
function splash(w, h) {
  const s = Math.round(Math.min(w, h) * 0.26);
  return page(w, h, `<div class="c" style="background:${SAFFRON}"><div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(s * 0.18)}px">
<div style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.28)}px;background:#fff;display:grid;place-items:center"><span class="b" style="font-size:${Math.round(s * 0.78)}px;color:${SAFFRON}">b</span></div>
<span style="font:700 ${Math.round(s * 0.32)}px/1 M;color:#fff;letter-spacing:.01em">bkesari</span></div></div>`);
}

const jobs = [];
for (const [dir, legacy, fg] of [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]) {
  jobs.push([path.join(res, `mipmap-${dir}`, 'ic_launcher.png'), icon(legacy, 'rounded', 0.72), true]);
  jobs.push([path.join(res, `mipmap-${dir}`, 'ic_launcher_round.png'), icon(legacy, 'round', 0.68), true]);
  // Adaptive foreground: 108dp canvas, the mark inside the 66dp safe circle.
  jobs.push([path.join(res, `mipmap-${dir}`, 'ic_launcher_foreground.png'), icon(fg, 'none', 0.46), true]);
}
for (const f of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const p = path.join(res, f, 'splash.png');
  if (fs.existsSync(p)) jobs.push([p, null, false]);
}
jobs.push([path.join(ios, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), icon(1024, 'square', 0.72), false]);
for (const f of fs.readdirSync(path.join(ios, 'Splash.imageset')).filter((x) => x.endsWith('.png'))) jobs.push([path.join(ios, 'Splash.imageset', f), null, false]);

(async () => {
  const browser = await chromium.launch();
  for (const [file, html0, alpha] of jobs) {
    const [w, h] = execFileSync('python3', ['-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', file]).toString().trim().split(' ').map(Number);
    const html = html0 || splash(w, h);
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.setContent(html); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: file, omitBackground: alpha });
    await p.close();
    if (!alpha) execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[1])', file]);
    console.log(path.relative(root, file), `${w}x${h}`);
  }
  await browser.close();
  const bg = path.join(res, 'values', 'ic_launcher_background.xml');
  fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace(/#[0-9A-Fa-f]{6}/, SAFFRON));
})();
