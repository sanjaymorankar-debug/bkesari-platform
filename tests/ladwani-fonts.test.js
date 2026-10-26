'use strict';

// LadWani's web fonts ship with the app (ladwani/apps/web/src/app/fonts), loaded
// by next/font/local in layout.tsx and used through the font-family stacks in
// globals.css. Nothing else checks what those files can draw: a weight the app
// sets with no face of its own is faked by the browser (faux bold), and a
// character outside the bundled subsets is drawn by whatever system font is
// there. These read the font files themselves (WOFF2, brotli from node:zlib),
// so they need neither LadWani's build nor its node_modules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const WEB = path.join(__dirname, '..', 'ladwani', 'apps', 'web', 'src');
const APP = path.join(WEB, 'app');

// Characters the app writes that no subset of Fraunces, Work Sans or IBM Plex
// Mono has (Google's or Fontsource's): they always came from a system font.
const NO_SUBSET_HAS = new Set([...'→←★✓']);

/** The tables of a WOFF2 file, by tag (https://www.w3.org/TR/WOFF2/, section 5). */
function readWoff2(file) {
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
    'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
    'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln',
    'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf',
    'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'wOF2', `${path.basename(file)} is not a WOFF2 file`);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; }
    throw new Error(`${path.basename(file)}: bad UIntBase128`);
  };
  const dir = [];
  for (let i = buf.readUInt16BE(12); i > 0; i--) {
    const flags = buf[p++];
    const tag = (flags & 0x3f) === 63 ? buf.toString('latin1', p, (p += 4)) : KNOWN[flags & 0x3f];
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? flags >> 6 === 0 : flags >> 6 !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)));
  const tables = {};
  let off = 0;
  for (const { tag, length } of dir) { tables[tag] = data.subarray(off, off + length); off += length; }
  return tables;
}

/** Whether a font's cmap (format 4 or 12, Unicode) maps the code point to a glyph. */
function hasGlyph(cmap, cp) {
  let sub;
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const pid = cmap.readUInt16BE(4 + i * 8), eid = cmap.readUInt16BE(6 + i * 8), off = cmap.readUInt32BE(8 + i * 8);
    const fmt = cmap.readUInt16BE(off);
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) { sub = { fmt, off }; break; }
    if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1))) sub = sub || { fmt, off };
  }
  assert.ok(sub, 'no Unicode cmap');
  const { fmt, off } = sub;
  if (fmt === 12) {
    for (let g = 0, n = cmap.readUInt32BE(off + 12); g < n; g++) {
      const at = off + 16 + g * 12, start = cmap.readUInt32BE(at), end = cmap.readUInt32BE(at + 4);
      if (cp >= start && cp <= end) return cmap.readUInt32BE(at + 8) + (cp - start) !== 0;
    }
    return false;
  }
  if (cp > 0xffff) return false;
  const segX2 = cmap.readUInt16BE(off + 6);
  const ends = off + 14, starts = ends + 2 + segX2, deltas = starts + segX2, ranges = deltas + segX2;
  for (let i = 0; i < segX2 / 2; i++) {
    if (cmap.readUInt16BE(ends + 2 * i) < cp) continue;
    const start = cmap.readUInt16BE(starts + 2 * i);
    if (start > cp) return false;
    const delta = cmap.readUInt16BE(deltas + 2 * i), ro = cmap.readUInt16BE(ranges + 2 * i);
    if (ro === 0) return ((cp + delta) & 0xffff) !== 0;
    const g = cmap.readUInt16BE(ranges + 2 * i + ro + 2 * (cp - start));
    return g !== 0 && ((g + delta) & 0xffff) !== 0;
  }
  return false;
}

/** The faces each localFont() call in layout.tsx declares, by its CSS variable. */
function bundledFaces() {
  const layout = fs.readFileSync(path.join(APP, 'layout.tsx'), 'utf8');
  const byVariable = {};
  for (const [, call] of layout.matchAll(/localFont\(\{([\s\S]*?)\n\}\)/g)) {
    const variable = /variable:\s*'([^']+)'/.exec(call)[1];
    const range = /prop:\s*'unicode-range',\s*value:\s*'([^']+)'/.exec(call);
    const inRange = !range ? () => true : (cp) => range[1].split(',').some((r) => {
      const [a, b = a] = r.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
      return cp >= a && cp <= b;
    });
    byVariable[variable] = [...call.matchAll(/path:\s*'([^']+)',\s*weight:\s*'(\d+)'/g)].map(([, file, weight]) => {
      const tables = readWoff2(path.join(APP, file));
      return { file: path.basename(file), weight: Number(weight), tables, draws: (cp) => inRange(cp) && hasGlyph(tables.cmap, cp) };
    });
  }
  assert.ok(Object.keys(byVariable).length >= 3, 'layout.tsx declares its fonts with localFont()');
  return byVariable;
}

/** Each font-family stack in globals.css that uses the bundled fonts: the faces its text can use. */
function stacks(faces) {
  const css = fs.readFileSync(path.join(APP, 'globals.css'), 'utf8');
  const out = new Map();
  for (const [, value] of css.matchAll(/font-family:\s*([^;]+);/g)) {
    const vars = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    if (vars.length) out.set(vars.join(', '), vars.flatMap((v) => faces[v] || assert.fail(`${v} is not a localFont() variable`)));
  }
  assert.ok(out.size >= 3, 'globals.css sets the three families');
  return out;
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

test('every bundled font file is WOFF2 and of the weight layout.tsx declares for it', () => {
  for (const list of Object.values(bundledFaces())) {
    for (const f of list) assert.equal(f.tables['OS/2'].readUInt16BE(4), f.weight, `${f.file}: OS/2 usWeightClass`);
  }
});

test('every weight the app sets has a face of its own in each family (no faux bold)', () => {
  // An explicit weight lands on any family: inline weights reach .mono text by inheritance
  // (the Total and Outstanding rows), so each family carries every weight the app sets.
  const weights = new Set();
  for (const f of sourceFiles(WEB)) {
    for (const [, w] of fs.readFileSync(f, 'utf8').matchAll(/font(?:-w|W)eight:\s*'?(\d{3})/g)) weights.add(Number(w));
  }
  assert.ok(weights.has(600), 'the app sets 600 somewhere');
  for (const [stack, list] of stacks(bundledFaces())) {
    for (const w of weights) {
      assert.ok(list.some((f) => f.weight === w), `font-family ${stack}: no face at ${w}, so the browser fakes it (have ${[...new Set(list.map((f) => f.weight))]})`);
    }
  }
});

test("every character the app writes is drawn by its own fonts, in each family and weight (₹ included)", () => {
  const chars = new Set();
  for (const f of sourceFiles(WEB)) for (const ch of fs.readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 0x7e) chars.add(ch);
  assert.ok(chars.has('₹'), 'the app writes ₹');
  for (const [stack, list] of stacks(bundledFaces())) {
    for (const w of new Set(list.map((f) => f.weight))) {
      const missing = [...chars].filter((ch) => !NO_SUBSET_HAS.has(ch) && !list.some((f) => f.weight === w && f.draws(ch.codePointAt(0))));
      assert.deepEqual(missing, [], `font-family ${stack} at ${w}: drawn by a system font instead`);
    }
  }
});
