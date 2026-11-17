// Builds kesari-ui into portal/public/kesari-ui/<version>/, the pinned copy the
// hub serves and every project links to:
//   /kesari-ui/<version>/kesari.css   tokens + base + components, minified
//   /kesari-ui/<version>/kesari.js    the runtime, minified
//   /kesari-ui/<version>/icons.svg    the icon set as a sprite: <use href="…/icons.svg#k-i-NAME">
//   /kesari-ui/<version>/icons/*.svg  each icon on its own (docs, app icons, design tools)
//   /kesari-ui/<version>/fonts/*      Mukta and Tiro Devanagari Marathi subsets (OFL)
// Older versions stay committed beside it (1.0.0): they are cached immutably for
// a year, so a page that still names one keeps working.
// The output is committed, so the hosting build needs no extra step;
// tests/kesari-ui.test.js fails when it is out of date or over budget.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const out = join(here, '..', '..', 'portal', 'public', 'kesari-ui', version);

/** The icon set, flattened: { name: '<path…>' }, project icons first. */
export function icons() {
  const src = JSON.parse(readFileSync(join(here, 'src', 'icons.json'), 'utf8'));
  return { ...src.project, ...src.ui };
}

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

export function build() {
  const css = ['tokens.css', 'base.css', 'components.css'].map((f) => readFileSync(join(here, 'src', f), 'utf8')).join('\n');
  const js = readFileSync(join(here, 'src', 'kesari.js'), 'utf8');
  const banner = `/* kesari-ui ${version} | bkesari.com */`;
  return {
    css: `${banner}\n${transformSync(css, { loader: 'css', minify: true, legalComments: 'none' }).code}`,
    js: `${banner}\n${transformSync(js, { loader: 'js', minify: true, target: 'es2019', legalComments: 'none' }).code}`,
    sprite: `<svg xmlns="http://www.w3.org/2000/svg"><!-- kesari-ui ${version} icons | bkesari.com -->\n` +
      Object.entries(icons()).map(([n, d]) => `<symbol id="k-i-${n}" ${SVG_ATTRS}>${d}</symbol>`).join('\n') + '\n</svg>\n',
    files: Object.fromEntries(Object.entries(icons()).map(([n, d]) => [n, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ${SVG_ATTRS}>${d}</svg>\n`])),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, js, sprite, files } = build();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  writeFileSync(join(out, 'kesari.css'), css);
  writeFileSync(join(out, 'kesari.js'), js);
  writeFileSync(join(out, 'icons.svg'), sprite);
  for (const [n, svg] of Object.entries(files)) writeFileSync(join(out, 'icons', `${n}.svg`), svg);
  for (const f of readdirSync(join(here, 'fonts'))) copyFileSync(join(here, 'fonts', f), join(out, 'fonts', f));
  console.log(`kesari-ui ${version} -> ${out} (css ${css.length} B, js ${js.length} B)`);
}
