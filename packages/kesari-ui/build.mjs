// Builds kesari-ui into portal/public/kesari-ui/<version>/, the pinned copy the
// hub serves and every project links to:
//   /kesari-ui/1.0.0/kesari.css   tokens + base + components, minified
//   /kesari-ui/1.0.0/kesari.js    the runtime, minified
//   /kesari-ui/1.0.0/fonts/*      Mukta and Tiro Devanagari Marathi subsets (OFL)
// The output is committed, so the hosting build needs no extra step;
// tests/kesari-ui.test.js fails when it is out of date or over budget.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const out = join(here, '..', '..', 'portal', 'public', 'kesari-ui', version);

export function build() {
  const css = ['tokens.css', 'base.css', 'components.css'].map((f) => readFileSync(join(here, 'src', f), 'utf8')).join('\n');
  const js = readFileSync(join(here, 'src', 'kesari.js'), 'utf8');
  const banner = `/* kesari-ui ${version} | bkesari.com */`;
  return {
    css: `${banner}\n${transformSync(css, { loader: 'css', minify: true, legalComments: 'none' }).code}`,
    js: `${banner}\n${transformSync(js, { loader: 'js', minify: true, target: 'es2019', legalComments: 'none' }).code}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, js } = build();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'fonts'), { recursive: true });
  writeFileSync(join(out, 'kesari.css'), css);
  writeFileSync(join(out, 'kesari.js'), js);
  for (const f of readdirSync(join(here, 'fonts'))) copyFileSync(join(here, 'fonts', f), join(out, 'fonts', f));
  console.log(`kesari-ui ${version} -> ${out} (css ${css.length} B, js ${js.length} B)`);
}
