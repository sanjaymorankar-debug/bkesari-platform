/**
 * Small helpers shared by the auth service. No state, no I/O.
 */
const crypto = require('crypto');

/** UTC "YYYY-MM-DD HH:MM:SS", `offsetSec` from now. Same format the hub uses. */
function nowUtc(offsetSec = 0) {
  return new Date(Date.now() + offsetSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) to epoch milliseconds. */
function parseUtc(value) {
  if (!value) return NaN;
  return Date.parse(String(value).replace(' ', 'T') + 'Z');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function uuid() {
  return crypto.randomUUID();
}

/** Constant-time string comparison that does not leak length. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a ?? '').length === String(b ?? '').length;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue; // first wins, like browsers send most specific first
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.domain) s += `; Domain=${opts.domain}`;
  s += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure) s += '; Secure';
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  return s;
}

/** Adds a Set-Cookie header without dropping ones already set. */
function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Deliberately plain: one @, something on each side, a dot in the domain, no spaces.
function isValidEmail(value) {
  const s = String(value || '');
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/** True when a driver error is a unique-key violation, on MySQL or SQLite. */
function isUniqueViolation(err) {
  return Boolean(err) && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(err.message || ''));
}

module.exports = {
  nowUtc, parseUtc, randomToken, sha256hex, uuid, safeEqual, parseCookies, serializeCookie,
  appendCookie, normalizeEmail, isValidEmail, escapeHtml, truncate, isUniqueViolation,
};
