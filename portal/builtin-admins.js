/* ============================================================
   Built-in administrators: smorankar and sonalimorankar.

   Two accounts that exist in the hub itself rather than in Neon Auth. They
   sign in on /auth/sign-in with a username instead of an email, and they are
   owners everywhere: the top role in every project (LadWani admin, Education
   admin, TaskList owner), ATIP, and /admin/access. Education also makes them
   system_admin (edu/app/Http/Middleware/HubSignIn.php, BUILTIN_ADMINS).

   THE PASSWORD IS NEVER IN THIS REPOSITORY. The repository is public, so a
   password or hash written here would let anyone sign in as an owner on every
   tier. The server reads one variable:

     BUILTIN_ADMIN_PASSWORD_HASH   scrypt:N:r:p:salt:key, from
                                   `node scripts/hash-builtin-admin-password.js`

   Unset (or not a valid hash) means the built-in sign-in is off: the form
   refuses it and any old session cookie stops counting. Changing the hash
   signs both accounts out everywhere, because the session key is derived
   from it.

   Their bkesari IDs are `builtin:<username>`. Neon Auth's ids never contain a
   colon, so no Neon account can be mistaken for one, and the user objects
   this module hands out carry a private Symbol that JSON from Neon Auth
   cannot.
   ============================================================ */

const crypto = require('crypto');

const USERNAMES = Object.freeze(['smorankar', 'sonalimorankar']);
const EMAIL_DOMAIN = 'builtin.bkesari.com';
const COOKIE = 'bk_builtin';
const SESSION_SECONDS = 12 * 60 * 60;
const MARK = Symbol('bkesari.builtinAdmin');

// scrypt cost for new hashes: 2^15 x 8 x 1 is about 32 MiB and ~0.1 s per check.
const DEFAULT_COST = Object.freeze({ N: 2 ** 15, r: 8, p: 1 });
const KEY_BYTES = 32;

// Failed sign-ins: per client, and a ceiling per username across all clients.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_CLIENT = 10;
const MAX_FAILS_PER_USERNAME = 50;
const MAX_TRACKED = 5000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const maxmem = (N, r) => 256 * N * r;

/** A scrypt hash for BUILTIN_ADMIN_PASSWORD_HASH. Colons, not `$`, so no env parser expands it. */
async function hashPassword(password, { N, r, p } = DEFAULT_COST, salt = crypto.randomBytes(16)) {
  const key = await scrypt(String(password), salt, KEY_BYTES, { N, r, p, maxmem: maxmem(N, r) });
  return ['scrypt', N, r, p, b64u(salt), b64u(key)].join(':');
}

function scrypt(password, salt, len, opts) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** The parts of a stored hash, or null when it is not one this module made. */
function parseHash(value) {
  const parts = String(value || '').trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : 0));
  const salt = Buffer.from(parts[4], 'base64url');
  const key = Buffer.from(parts[5], 'base64url');
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (salt.length < 16 || key.length < KEY_BYTES) return null;
  return { N, r, p, salt, key };
}

async function verifyPassword(password, parsed) {
  const got = await scrypt(String(password), parsed.salt, parsed.key.length,
    { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: maxmem(parsed.N, parsed.r) });
  return crypto.timingSafeEqual(got, parsed.key);
}

/** The canonical username, or null when it is not one of the built-in accounts. */
function normalizeUsername(value) {
  const name = String(value ?? '').trim().toLowerCase();
  return USERNAMES.includes(name) ? name : null;
}

function userFor(username) {
  return Object.freeze({
    id: `builtin:${username}`,
    email: `${username}@${EMAIL_DOMAIN}`,
    name: username,
    emailVerified: true,
    [MARK]: true,
  });
}

/** True only for a user object this module made (never for one parsed from JSON). */
function isBuiltinUser(user) {
  return Boolean(user && user[MARK] === true);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const isHttps = (req) => Boolean(req.secure) ||
  String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';

function cookieHeader(req, value, maxAge) {
  return [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(isHttps(req) ? ['Secure'] : [])].join('; ');
}

/**
 * The client a failed attempt is counted against. Behind the host's proxy the
 * last X-Forwarded-For entry is the one that proxy added; earlier entries are
 * whatever the client sent.
 */
function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : String((req.socket && req.socket.remoteAddress) || 'unknown');
}

/**
 * @param env  reads BUILTIN_ADMIN_PASSWORD_HASH
 * @param now  clock, for the tests
 */
function createBuiltinAdmins({ env = process.env, now = () => Date.now(), log = console } = {}) {
  const raw = String(env.BUILTIN_ADMIN_PASSWORD_HASH || '').trim();
  const parsed = raw ? parseHash(raw) : null;
  if (raw && !parsed) log.warn('BUILTIN_ADMIN_PASSWORD_HASH is not a valid scrypt hash: the built-in administrators cannot sign in.');
  // Derived from the hash, so a new password ends every built-in session.
  const sessionKey = parsed ? crypto.createHmac('sha256', 'bkesari builtin admin session v1').update(raw).digest() : null;
  const failures = new Map();

  const enabled = () => Boolean(parsed);
  const sign = (payload) => crypto.createHmac('sha256', sessionKey).update(payload).digest();

  function issue(username) {
    const payload = b64u(JSON.stringify({ u: username, exp: Math.floor(now() / 1000) + SESSION_SECONDS }));
    return `${payload}.${b64u(sign(payload))}`;
  }

  /** The built-in admin this request's cookie names, or null. */
  function currentUser(req) {
    if (!parsed) return null;
    const value = readCookie(req, COOKIE);
    if (!value) return null;
    const [payload, sig, extra] = value.split('.');
    if (!payload || !sig || extra !== undefined) return null;
    const given = Buffer.from(sig, 'base64url');
    const want = sign(payload);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
    const username = normalizeUsername(claims && claims.u);
    if (!username || username !== claims.u || !(Number(claims.exp) * 1000 > now())) return null;
    return userFor(username);
  }

  function lockedFor(key) {
    const f = failures.get(key);
    if (!f) return 0;
    if (f.resetAt <= now()) { failures.delete(key); return 0; }
    return f;
  }

  function recordFailure(key) {
    if (failures.size >= MAX_TRACKED) for (const [k, f] of failures) if (f.resetAt <= now()) failures.delete(k);
    if (failures.size >= MAX_TRACKED && !failures.has(key)) return;
    const f = lockedFor(key) || { count: 0, resetAt: now() + WINDOW_MS };
    f.count += 1;
    failures.set(key, f);
  }

  /** Seconds until this client or username may try again, or 0. */
  function retryAfter(client, username) {
    let wait = 0;
    for (const [key, limit] of [[`client:${client}`, MAX_FAILS_PER_CLIENT], ...(username ? [[`user:${username}`, MAX_FAILS_PER_USERNAME]] : [])]) {
      const f = lockedFor(key);
      if (f && f.count >= limit) wait = Math.max(wait, Math.ceil((f.resetAt - now()) / 1000));
    }
    return wait;
  }

  /**
   * The routes: POST /auth/builtin/sign-in, GET /auth/builtin/session, and a
   * sign-out that clears this cookie on the same /api/auth/sign-out every page
   * already calls. Mount BEFORE neonAuth.mount, which owns /api/auth/*. The
   * sign-in route parses its own body, so no global body parser is needed.
   *
   * @param audit  async (actor, action, detail) => void; failures are logged, never fatal
   * @param neonSignOut  true when Neon Auth answers /api/auth/sign-out after us
   */
  function mount(app, { express, audit = async () => {}, neonSignOut = () => false } = {}) {
    const record = (actor, action, detail) => Promise.resolve()
      .then(() => audit(actor, action, detail))
      .catch((err) => log.error('builtin admin audit failed:', err.message));

    app.post('/api/auth/sign-out', (req, res, next) => {
      res.append('Set-Cookie', cookieHeader(req, '', 0));
      if (neonSignOut()) return next();
      res.set('Cache-Control', 'no-store').json({ success: true });
    });

    app.get('/auth/builtin/session', (req, res) => {
      const user = currentUser(req);
      res.set('Cache-Control', 'private, no-store').json({ enabled: enabled(), user: user ? { username: user.name, email: user.email } : null });
    });

    app.post('/auth/builtin/sign-in', express.json({ limit: '4kb' }), async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        const origin = req.headers.origin;
        if (origin) {
          let host = null;
          try { host = new URL(origin).host; } catch { /* malformed: refused below */ }
          if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request refused' });
        }
        if (!parsed) return res.status(503).json({ error: 'Built-in sign-in is not configured on this site' });
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const typed = typeof body.username === 'string' ? body.username.slice(0, 64) : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const username = normalizeUsername(typed);
        const client = clientKey(req);
        const wait = retryAfter(client, username);
        if (wait) {
          res.set('Retry-After', String(wait));
          return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` });
        }
        // The hash is checked even for an unknown username, so both take as long.
        const ok = password.length > 0 && password.length <= 256 && await verifyPassword(password, parsed) && Boolean(username);
        if (!ok) {
          recordFailure(`client:${client}`);
          if (username) recordFailure(`user:${username}`);
          // Never the typed text itself: a password typed into the wrong box would land in the log.
          await record(username ? `${username}@${EMAIL_DOMAIN}` : 'unknown username', 'builtin-sign-in-failed', `from ${client}`);
          return res.status(401).json({ error: 'Wrong username or password' });
        }
        failures.delete(`client:${client}`);
        res.append('Set-Cookie', cookieHeader(req, issue(username), SESSION_SECONDS));
        await record(`${username}@${EMAIL_DOMAIN}`, 'builtin-sign-in', `from ${client}`);
        res.json({ ok: true, user: { username, email: `${username}@${EMAIL_DOMAIN}` } });
      } catch (err) { next(err); }
    });
  }

  return { enabled, currentUser, mount, issue };
}

module.exports = {
  createBuiltinAdmins, hashPassword, parseHash, verifyPassword, isBuiltinUser, normalizeUsername,
  USERNAMES, EMAIL_DOMAIN, COOKIE, SESSION_SECONDS,
};
