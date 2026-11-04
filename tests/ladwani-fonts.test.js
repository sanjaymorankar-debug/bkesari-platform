'use strict';

// LadWani's text is set in Kesari's fonts: layout.tsx links the hub's
// /kesari-ui/1.0.0/kesari.css, whose @font-face rules (packages/kesari-ui/src/
// tokens.css) load the Mukta subsets in packages/kesari-ui/fonts, and
// globals.css uses only Kesari's font tokens. LadWani bundles no fonts of its
// own any more (it had Fraunces, Work Sans and IBM Plex Mono until 2026-11).
// Nothing else checks what those files can draw: a weight the app sets with no
// face of its own is faked by the browser (faux bold), and a character outside
// the subsets -- Marathi and Hindi included -- is drawn by whatever system font
// is there. These read the font files themselves (WOFF2, brotli from
// node:zlib), so they need neither LadWani's build nor its node_modules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const WEB = path.join(__dirname, '..', 'ladwani', 'apps', 'web', 'src');
const APP = path.join(WEB, 'app');
const KESARI = path.join(__dirname, '..', 'packages', 'kesari-ui');

// Characters the app writes that no Mukta subset has: they come from a system font.
// † marks a member who has passed away; Kesari's own k-node--expired writes it too.
const NO_SUBSET_HAS = new Set([...'→←★✓†']);

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

/** Kesari's @font-face rules for one family: file, weights, unicode-range. */
function kesariFaces(family) {
  const css = fs.readFileSync(path.join(KESARI, 'src', 'tokens.css'), 'utf8');
  const faces = [];
  for (const [, body] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    if (!body.includes(`font-family:'${family}'`)) continue;
    const [lo, hi = lo] = /font-weight:(\d+)(?: (\d+))?/.exec(body).slice(1).filter(Boolean).map(Number);
    const file = /url\(fonts\/([^)]+)\)/.exec(body)[1];
    const ranges = /unicode-range:([^;]+)/.exec(body)[1].split(',').map((r) => {
      const [a, b = a] = r.trim().replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
      return [a, b];
    });
    const tables = readWoff2(path.join(KESARI, 'fonts', file));
    faces.push({
      file, lo, hi, tables,
      hasWeight: (w) => w >= lo && w <= hi,
      draws: (cp) => ranges.some(([a, b]) => cp >= a && cp <= b) && hasGlyph(tables.cmap, cp),
    });
  }
  assert.ok(faces.length >= 3, `tokens.css declares ${family}`);
  return faces;
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : /\.(tsx?|css|json)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** Every weight LadWani sets: inline fontWeight in its pages, font-weight in globals.css. */
function weightsUsed() {
  const weights = new Set([400]);
  for (const f of sourceFiles(WEB)) {
    for (const [, w] of fs.readFileSync(f, 'utf8').matchAll(/font(?:-w|W)eight:\s*'?(\d{3})/g)) weights.add(Number(w));
  }
  return weights;
}

test('LadWani bundles no fonts of its own and loads Kesari\'s', () => {
  assert.equal(fs.existsSync(path.join(APP, 'fonts')), false, 'apps/web/src/app/fonts is gone');
  const layout = fs.readFileSync(path.join(APP, 'layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /next\/font/, 'layout.tsx loads no next/font');
  assert.match(layout, /\/kesari-ui\/1\.0\.0/, 'layout.tsx links the pinned Kesari build');
  assert.match(layout, /kesari\.css/);
  const version = JSON.parse(fs.readFileSync(path.join(KESARI, 'package.json'), 'utf8')).version;
  assert.equal(version, '1.0.0', 'layout.tsx pins the version kesari-ui builds');
});

test('globals.css names no font family: only Kesari\'s tokens', () => {
  const css = fs.readFileSync(path.join(APP, 'globals.css'), 'utf8');
  const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(families.length >= 2, 'globals.css sets the body and the mono family');
  for (const value of families) assert.match(value, /^var\(--k-font(?:-mono)?\)$/, `font-family: ${value}`);
});

test('every Mukta file is WOFF2 and of the weight tokens.css declares for it', () => {
  for (const f of kesariFaces('Mukta')) assert.equal(f.tables['OS/2'].readUInt16BE(4), f.lo, `${f.file}: OS/2 usWeightClass`);
});

test('every weight LadWani sets has a Mukta face of its own (no faux bold)', () => {
  const faces = kesariFaces('Mukta');
  assert.ok(weightsUsed().has(600), 'the app sets 600 somewhere');
  for (const w of weightsUsed()) assert.ok(faces.some((f) => f.hasWeight(w)), `Mukta has no face at ${w}`);
});

test('every character LadWani writes, Marathi and Hindi included, is drawn by Mukta at every weight it uses (₹ included)', () => {
  const chars = new Set();
  for (const f of sourceFiles(WEB)) for (const ch of fs.readFileSync(f, 'utf8')) if (ch.codePointAt(0) > 0x7e) chars.add(ch);
  assert.ok(chars.has('₹'), 'the app writes ₹');
  assert.ok([...chars].some((ch) => /[\u0900-\u097F]/.test(ch)), 'the app writes Devanagari (src/i18n)');
  const faces = kesariFaces('Mukta');
  for (const w of weightsUsed()) {
    const missing = [...chars].filter((ch) => !NO_SUBSET_HAS.has(ch) && !faces.some((f) => f.hasWeight(w) && f.draws(ch.codePointAt(0))));
    assert.deepEqual(missing, [], `Mukta at ${w}: drawn by a system font instead`);
  }
});
