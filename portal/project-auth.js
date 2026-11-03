'use strict';

/* ============================================================
   Per-project sign-in. Each bkesari project owns its accounts end to end:
   its own users, sessions, password_resets, otp codes, rate limits and
   audit log, in ITS OWN database, and its own session cookie scoped by
   name and path. Nothing here is shared between projects at run time:
   TaskList and the hub admin each call createProjectAuth() with their own
   database and their own table prefix, and a session from one is never
   looked up by the other.

   Methods
     - mobile number + OTP (primary, India-first)
     - email + password (secondary), bcrypt
   Protections
     - lock after 5 failed passwords for 15 minutes
     - rate limits on sign-in, OTP sends/checks, sign-up and resets,
       counted in the database so every process shares them
     - CSRF: every state-changing request carries X-CSRF-Token. Signed-in,
       it must equal the token stored with the session; signed-out, it must
       equal the HttpOnly <cookie>_csrf cookie (double submit). Requests
       must also be JSON and, when the browser says, same-origin.
     - session tokens and reset tokens are stored only as SHA-256 hashes;
       OTP codes as an HMAC with the project's secret.
   ============================================================ */

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const SESSION_DAYS = 30;
const OTP_MINUTES = 10;
const OTP_MAX_TRIES = 5;
const RESET_MINUTES = 60;
const VERIFY_HOURS = 48;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const BCRYPT_COST = 11;
const MIN_PASSWORD = 8;
// Compared against when no account matches, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a || '').length > 0;
}

/** +91 mobile numbers, stored as the 10 digits. Accepts spaces, dashes, +91 / 0 prefixes. */
function normalizeMobile(value) {
  let d = String(value ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+91')) d = d.slice(3);
  else if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

function normalizeEmail(value) {
  const e = String(value ?? '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Why a password is not acceptable, or null. Long beats clever: 8+ characters, not all one kind. */
function passwordProblem(pw) {
  const p = String(pw ?? '');
  if (p.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (p.length > 200) return 'That password is too long.';
  if (/^\d+$/.test(p)) return 'Use letters as well as numbers.';
  if (/^(.)\1+$/.test(p)) return 'Choose a less predictable password.';
  return null;
}

class AuthError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/**
 * @param {object} o
 * @param o.db        the project's database (db.js helpers: get/all/run/tx)
 * @param o.key       project key, e.g. 'tasklist'
 * @param o.name      display name, e.g. 'TaskList'
 * @param o.base      the project's path, e.g. '/tasklist' (cookie Path and routes)
 * @param o.cookie    session cookie name, e.g. 'tl_sid'
 * @param o.prefix    table prefix, e.g. 'tl_' (tables <prefix>users, …)
 * @param o.cookiePath  override the cookie path (the hub admin uses '/')
 * @param o.allowSignUp whether anyone may create an account (TaskList yes, hub admin no)
 * @param o.methods   ['otp','password'] (default both)
 * @param o.notify    { sms(to, text), mail(to, subject, text) } -> resolves true when sent
 * @param o.tier      () => 'dev'|'test'|'prod' for this request; dev/test may echo codes
 * @param o.secret    HMAC secret for OTP codes (string, 32+ chars)
 * @param o.log       console-like
 */
function createProjectAuth(o) {
  const {
    db, key, name, base, cookie, prefix,
    allowSignUp = true, methods = ['otp', 'password'],
    notify = {}, tier = () => 'prod', log = console, hooks = {},
  } = o;
  if (!/^[a-z_]+$/.test(prefix)) throw new Error('table prefix must be lower-case letters and _');
  const cookiePath = o.cookiePath || base || '/';
  const csrfCookie = `${cookie}_csrf`;
  const secret = o.secret || crypto.randomBytes(32).toString('hex');
  if (!o.secret) log.warn(`${name}: no auth secret set; OTP codes will not survive a restart.`);
  const T = {
    users: `${prefix}users`, sessions: `${prefix}sessions`, resets: `${prefix}password_resets`,
    otp: `${prefix}otp_codes`, audit: `${prefix}audit_log`, limits: `${prefix}rate_limits`,
  };

  /* ---------- helpers ---------- */
  const clientIp = (req) => String(req.ip || req.socket?.remoteAddress || '').slice(0, 45);
  const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const plainLocal = (req) => !isHttps(req) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));

  function setCookie(req, res, nameValue, { maxAge, httpOnly = true, path = cookiePath } = {}) {
    const parts = [nameValue, `Path=${path}`, 'SameSite=Lax'];
    if (httpOnly) parts.push('HttpOnly');
    if (!plainLocal(req)) parts.push('Secure');
    if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
    res.append('Set-Cookie', parts.join('; '));
  }

  function readCookie(req, n) {
    const raw = String(req.headers.cookie || '');
    for (const part of raw.split(/;\s*/)) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i) === n) {
        try { return decodeURIComponent(part.slice(i + 1)); } catch { return null; }
      }
    }
    return null;
  }

  const audit = (userId, actor, action, detail, req) =>
    db.run(`INSERT INTO ${T.audit} (user_id, actor, action, detail, ip) VALUES ($1,$2,$3,$4,$5)`,
      [userId || null, String(actor || '').slice(0, 254) || null, action, String(detail || '').slice(0, 500) || null, req ? clientIp(req) : null])
      .catch((err) => log.error(`${name} audit failed:`, err.message));

  /** Count a hit in `bucket` for the window; throws 429 past `max`. */
  async function limit(bucket, max, windowSeconds) {
    const row = await db.get(`INSERT INTO ${T.limits} (bucket, hits, window_start) VALUES ($1, 1, now())
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE WHEN ${T.limits}.window_start < now() - make_interval(secs => $2) THEN 1 ELSE ${T.limits}.hits + 1 END,
        window_start = CASE WHEN ${T.limits}.window_start < now() - make_interval(secs => $2) THEN now() ELSE ${T.limits}.window_start END
      RETURNING hits, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $2) - now())))::int AS retry`,
    [bucket.slice(0, 200), windowSeconds]);
    if (row.hits > max) {
      throw new AuthError(429, 'rate_limited', 'Too many attempts. Please wait and try again.', { retryAfter: Math.max(1, row.retry) });
    }
  }

  const otpHash = (target, purpose, code) => crypto.createHmac('sha256', secret).update(`${key}|${purpose}|${target}|${code}`).digest('hex');

  function publicUser(u) {
    return u ? { id: Number(u.id), name: u.name || null, email: u.email || null, mobile: u.mobile || null, role: u.role,
      emailVerified: Boolean(u.email_verified), mobileVerified: Boolean(u.mobile_verified), hasPassword: Boolean(u.password_hash) } : null;
  }

  /* ---------- sessions ---------- */
  async function startSession(req, res, user, how) {
    const token = randomToken();
    const csrf = randomToken(24);
    await db.run(`INSERT INTO ${T.sessions} (user_id, token_hash, csrf, expires_at, ip, user_agent)
      VALUES ($1,$2,$3, now() + make_interval(days => $4), $5, $6)`,
    [user.id, sha256(token), csrf, SESSION_DAYS, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300)]);
    await db.run(`UPDATE ${T.users} SET last_login_at = now(), failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    setCookie(req, res, `${cookie}=${token}`, { maxAge: SESSION_DAYS * 86400 });
    if (hooks.afterSignIn) hooks.afterSignIn(req, res, user, { setCookie: (v, opt) => setCookie(req, res, v, opt) });
    await audit(user.id, user.email || user.mobile, 'sign-in', how, req);
    return csrf;
  }

  /** The signed-in user for this request (cached on req), or null. */
  async function currentSession(req) {
    const cacheKey = `__auth_${key}`;
    if (req[cacheKey] !== undefined) return req[cacheKey];
    const token = readCookie(req, cookie);
    let found = null;
    if (token && token.length >= 20 && token.length <= 100) {
      const row = await db.get(`SELECT s.id AS session_id, s.csrf, s.last_seen_at < now() - interval '5 minutes' AS stale, u.*
        FROM ${T.sessions} s JOIN ${T.users} u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`, [sha256(token)]);
      if (row) {
        if (row.stale) db.run(`UPDATE ${T.sessions} SET last_seen_at = now() WHERE id = $1`, [row.session_id]).catch(() => {});
        found = { user: row, sessionId: row.session_id, csrf: row.csrf };
      }
    }
    req[cacheKey] = found;
    return found;
  }

  /* ---------- CSRF ---------- */
  function anonCsrf(req, res) {
    let t = readCookie(req, csrfCookie);
    if (!t || !/^[A-Za-z0-9_-]{20,64}$/.test(t)) {
      t = randomToken(24);
      setCookie(req, res, `${csrfCookie}=${t}`, { maxAge: 86400 });
    }
    return t;
  }

  async function checkCsrf(req) {
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
      if (!ok) throw new AuthError(403, 'cross_site', 'Cross-site request refused.');
    }
    if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') throw new AuthError(403, 'cross_site', 'Cross-site request refused.');
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new AuthError(415, 'json_only', 'Send JSON.');
    const given = req.headers['x-csrf-token'];
    const session = await currentSession(req);
    const expected = session ? session.csrf : readCookie(req, csrfCookie);
    if (!sameText(given, expected)) throw new AuthError(403, 'csrf', 'Your session form expired. Reload the page and try again.');
  }

  /** Middleware: state-changing requests must pass the CSRF check. */
  const csrfGuard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    checkCsrf(req).then(() => next(), next);
  };

  /** Middleware for a project's API: 401 without a session; sets req.user. */
  const requireUser = (req, res, next) => {
    currentSession(req).then((s) => {
      if (!s) return res.status(401).json({ error: 'Sign in required', code: 'signin', signIn: `${base}/sign-in` });
      req.user = s.user;
      req.session = s;
      return next();
    }, next);
  };

  /* ---------- users ---------- */
  const findByEmail = (email) => db.get(`SELECT * FROM ${T.users} WHERE lower(email) = $1`, [email]);
  const findByMobile = (mobile) => db.get(`SELECT * FROM ${T.users} WHERE mobile = $1`, [mobile]);
  const echoCodes = (req) => tier(req) !== 'prod';

  async function deliver(req, kind, to, subject, text, devValue) {
    let sent = false;
    try {
      sent = kind === 'sms' ? Boolean(notify.sms && await notify.sms(to, text)) : Boolean(notify.mail && await notify.mail(to, subject, text));
    } catch (err) {
      log.error(`${name}: ${kind} to ${kind === 'sms' ? to.slice(0, 2) + '******' + to.slice(-2) : to} failed:`, err.message);
    }
    if (sent) return {};
    if (echoCodes(req)) return { dev: devValue }; // dev/test only: no provider configured
    throw new AuthError(503, 'delivery', kind === 'sms'
      ? 'We could not send the SMS right now. Try again later or sign in with email.'
      : 'We could not send the email right now. Try again later.');
  }

  /* ---------- routes ---------- */
  const router = express.Router();
  router.use(express.json({ limit: '20kb' }));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(csrfGuard);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Who is signed in, the token forms must send, and what this project offers.
  router.get('/session', wrap(async (req, res) => {
    const s = await currentSession(req);
    res.json({
      project: { key, name, base }, user: publicUser(s && s.user), csrf: s ? s.csrf : anonCsrf(req, res),
      methods, allowSignUp, smsLive: Boolean(notify.sms), mailLive: Boolean(notify.mail),
    });
  }));

  // The shell's account menu reads this (data-me-url).
  router.get('/me', wrap(async (req, res) => {
    const s = await currentSession(req);
    // 200 either way: a signed-out visitor is not an error, and the browser
    // would log a 401 to the console on every page.
    if (!s) return res.json({ user: null, signInUrl: `${base}/sign-in` });
    res.json({ user: publicUser(s.user), signOut: { url: `${base}/api/auth/sign-out`, csrf: s.csrf, next: `${base}/sign-in` },
      links: o.accountLinks || [] });
  }));

  router.post('/sign-in', wrap(async (req, res) => {
    if (!methods.includes('password')) throw new AuthError(404, 'method', 'Password sign-in is not offered here.');
    const { identifier, password } = req.body || {};
    const email = normalizeEmail(identifier);
    const mobile = email ? null : normalizeMobile(identifier);
    if (!email && !mobile) throw new AuthError(400, 'identifier', 'Enter your email or 10-digit mobile number.');
    if (!password) throw new AuthError(400, 'password', 'Enter your password.');
    await limit(`signin:ip:${clientIp(req)}`, 20, 15 * 60);
    await limit(`signin:id:${email || mobile}`, 10, 15 * 60);
    const user = email ? await findByEmail(email) : await findByMobile(mobile);
    const locked = user ? await db.get(`SELECT locked_until > now() AS locked, CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int AS minutes FROM ${T.users} WHERE id = $1`, [user.id]) : null;
    if (locked && locked.locked) {
      throw new AuthError(423, 'locked', `Too many wrong passwords. Try again in ${locked.minutes} minute${locked.minutes === 1 ? '' : 's'}, or reset your password.`);
    }
    // Compare against a dummy hash for unknown users so timing does not reveal who has an account.
    const hash = (user && user.password_hash) || DUMMY_HASH;
    const ok = await bcrypt.compare(String(password), hash);
    if (!user || !ok || !user.password_hash) {
      if (user) {
        const r = await db.get(`UPDATE ${T.users} SET failed_attempts = failed_attempts + 1,
          locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1 RETURNING failed_attempts`, [user.id, LOCK_AFTER, LOCK_MINUTES]);
        await audit(user.id, email || mobile, 'sign-in-failed', `attempt ${r.failed_attempts}`, req);
        if (r.failed_attempts >= LOCK_AFTER) {
          throw new AuthError(423, 'locked', `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes, or reset your password.`);
        }
      }
      throw new AuthError(401, 'credentials', 'That email/mobile and password do not match.');
    }
    if (user.status !== 'active') throw new AuthError(403, 'status', user.status === 'pending' ? 'Your account is waiting for approval.' : 'This account is suspended.');
    const csrf = await startSession(req, res, user, 'password');
    res.json({ user: publicUser(user), csrf });
  }));

  router.post('/sign-up', wrap(async (req, res) => {
    if (!allowSignUp || !methods.includes('password')) throw new AuthError(403, 'closed', 'New accounts are not open here.');
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const nm = String(body.name || '').trim().slice(0, 120);
    if (!nm) throw new AuthError(400, 'name', 'Enter your name.');
    if (!email) throw new AuthError(400, 'email', 'Enter a valid email address.');
    const problem = passwordProblem(body.password);
    if (problem) throw new AuthError(400, 'password', problem);
    await limit(`signup:ip:${clientIp(req)}`, 10, 60 * 60);
    if (await findByEmail(email)) throw new AuthError(409, 'exists', 'An account with this email already exists. Sign in instead.');
    const hash = await bcrypt.hash(String(body.password), BCRYPT_COST);
    const user = await db.get(`INSERT INTO ${T.users} (email, name, password_hash) VALUES ($1,$2,$3) RETURNING *`, [email, nm, hash]);
    await audit(user.id, email, 'sign-up', 'password', req);
    const extra = await sendVerify(req, user).catch((err) => { log.error(err.message); return {}; });
    const csrf = await startSession(req, res, user, 'sign-up');
    res.status(201).json({ user: publicUser(user), csrf, ...extra });
  }));

  async function sendVerify(req, user) {
    const token = randomToken();
    await db.run(`INSERT INTO ${T.resets} (user_id, purpose, token_hash, expires_at) VALUES ($1,'verify',$2, now() + make_interval(hours => $3))`,
      [user.id, sha256(token), VERIFY_HOURS]);
    const link = `${origin(req)}${base}/verify?token=${token}`;
    const out = await deliver(req, 'mail', user.email, `Confirm your ${name} email`,
      `Confirm the email for your ${name} account (this is a separate account from other bkesari projects):\n\n${link}\n\nThe link works for ${VERIFY_HOURS} hours.`, link)
      .catch(() => ({}));
    return out.dev ? { devVerifyLink: out.dev } : {};
  }

  function origin(req) {
    const proto = isHttps(req) ? 'https' : 'http';
    return `${proto}://${req.headers.host}`;
  }

  router.post('/verify-email', wrap(async (req, res) => {
    const token = String((req.body || {}).token || '');
    if (token.length < 20) throw new AuthError(400, 'token', 'This link is not valid.');
    const row = await db.get(`UPDATE ${T.resets} SET used_at = now() WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(token)]);
    if (!row) throw new AuthError(400, 'token', 'This link has expired or was already used.');
    await db.run(`UPDATE ${T.users} SET email_verified = TRUE WHERE id = $1`, [row.user_id]);
    await audit(row.user_id, null, 'email-verified', null, req);
    res.json({ ok: true });
  }));

  router.post('/otp/send', wrap(async (req, res) => {
    if (!methods.includes('otp')) throw new AuthError(404, 'method', 'OTP sign-in is not offered here.');
    const body = req.body || {};
    const mobile = normalizeMobile(body.mobile);
    if (!mobile) throw new AuthError(400, 'mobile', 'Enter a valid 10-digit Indian mobile number.');
    const purpose = body.purpose === 'sign-up' ? 'sign-up' : 'sign-in';
    const existing = await findByMobile(mobile);
    if (purpose === 'sign-up' && !allowSignUp) throw new AuthError(403, 'closed', 'New accounts are not open here.');
    await limit(`otp:mobile:${mobile}`, 5, 60 * 60);
    await limit(`otp:ip:${clientIp(req)}`, 20, 60 * 60);
    // Do not reveal whether a number is registered: always answer the same way.
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const mode = existing ? 'sign-in' : (allowSignUp ? 'sign-up' : 'none');
    if (mode !== 'none') {
      await db.run(`UPDATE ${T.otp} SET used_at = now() WHERE target = $1 AND used_at IS NULL`, [mobile]);
      await db.run(`INSERT INTO ${T.otp} (target, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`,
        [mobile, mode, otpHash(mobile, mode, code), OTP_MINUTES]);
    }
    const out = mode === 'none' ? {} : await deliver(req, 'sms', mobile, null,
      `${code} is your ${name} code. It works for ${OTP_MINUTES} minutes. Never share it. - bkesari`, code);
    await audit(existing ? existing.id : null, mobile, 'otp-sent', mode, req);
    res.json({ sent: true, expiresInMinutes: OTP_MINUTES, newAccount: mode === 'sign-up', ...(out.dev ? { devCode: out.dev } : {}) });
  }));

  router.post('/otp/verify', wrap(async (req, res) => {
    const body = req.body || {};
    const mobile = normalizeMobile(body.mobile);
    const code = String(body.code || '').replace(/\D/g, '');
    if (!mobile) throw new AuthError(400, 'mobile', 'Enter a valid 10-digit Indian mobile number.');
    if (code.length !== 6) throw new AuthError(400, 'code', 'Enter the 6-digit code.');
    await limit(`otpcheck:ip:${clientIp(req)}`, 30, 15 * 60);
    const row = await db.get(`SELECT id, purpose, code_hash, attempts FROM ${T.otp} WHERE target = $1 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`, [mobile]);
    if (!row) throw new AuthError(400, 'expired', 'That code has expired. Ask for a new one.');
    if (row.attempts >= OTP_MAX_TRIES) throw new AuthError(429, 'tries', 'Too many wrong codes. Ask for a new one.');
    if (!sameText(otpHash(mobile, row.purpose, code), row.code_hash)) {
      await db.run(`UPDATE ${T.otp} SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      throw new AuthError(400, 'code', `That code is not right. ${OTP_MAX_TRIES - row.attempts - 1} tries left.`);
    }
    await db.run(`UPDATE ${T.otp} SET used_at = now() WHERE id = $1`, [row.id]);
    let user = await findByMobile(mobile);
    if (!user) {
      if (row.purpose !== 'sign-up' || !allowSignUp) throw new AuthError(403, 'closed', 'New accounts are not open here.');
      const nm = String(body.name || '').trim().slice(0, 120) || null;
      user = await db.get(`INSERT INTO ${T.users} (mobile, name, mobile_verified) VALUES ($1,$2,TRUE) RETURNING *`, [mobile, nm]);
      await audit(user.id, mobile, 'sign-up', 'otp', req);
    } else if (!user.mobile_verified) {
      user = await db.get(`UPDATE ${T.users} SET mobile_verified = TRUE WHERE id = $1 RETURNING *`, [user.id]);
    }
    if (user.status !== 'active') throw new AuthError(403, 'status', 'This account is suspended.');
    const csrf = await startSession(req, res, user, 'otp');
    res.json({ user: publicUser(user), csrf, created: row.purpose === 'sign-up' });
  }));

  router.post('/sign-out', wrap(async (req, res) => {
    const s = await currentSession(req);
    if (s) {
      await db.run(`DELETE FROM ${T.sessions} WHERE id = $1`, [s.sessionId]);
      await audit(s.user.id, s.user.email || s.user.mobile, 'sign-out', null, req);
    }
    setCookie(req, res, `${cookie}=`, { maxAge: 0 });
    if (hooks.afterSignOut) hooks.afterSignOut(req, res, { setCookie: (v, opt) => setCookie(req, res, v, opt) });
    res.json({ ok: true });
  }));

  router.post('/password/forgot', wrap(async (req, res) => {
    const email = normalizeEmail((req.body || {}).email);
    if (!email) throw new AuthError(400, 'email', 'Enter a valid email address.');
    await limit(`reset:ip:${clientIp(req)}`, 10, 60 * 60);
    await limit(`reset:email:${email}`, 3, 60 * 60);
    const user = await findByEmail(email);
    let extra = {};
    if (user && user.status === 'active') {
      const token = randomToken();
      await db.run(`INSERT INTO ${T.resets} (user_id, purpose, token_hash, expires_at) VALUES ($1,'reset',$2, now() + make_interval(mins => $3))`,
        [user.id, sha256(token), RESET_MINUTES]);
      const link = `${origin(req)}${base}/reset-password?token=${token}`;
      const out = await deliver(req, 'mail', email, `Reset your ${name} password`,
        `Someone asked to reset the password of your ${name} account. If it was you, open:\n\n${link}\n\nThe link works for ${RESET_MINUTES} minutes. If it was not you, ignore this email.`, link);
      if (out.dev) extra = { devResetLink: out.dev };
      await audit(user.id, email, 'reset-requested', null, req);
    }
    // Same answer whether or not the email has an account.
    res.json({ sent: true, ...extra });
  }));

  router.post('/password/reset', wrap(async (req, res) => {
    const { token, password } = req.body || {};
    const problem = passwordProblem(password);
    if (problem) throw new AuthError(400, 'password', problem);
    if (String(token || '').length < 20) throw new AuthError(400, 'token', 'This link is not valid.');
    const hash = await bcrypt.hash(String(password), BCRYPT_COST);
    const row = await db.tx(async (q) => {
      const r = await q.get(`UPDATE ${T.resets} SET used_at = now() WHERE token_hash = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(token)]);
      if (!r) return null;
      await q.run(`UPDATE ${T.users} SET password_hash = $1, failed_attempts = 0, locked_until = NULL, email_verified = TRUE WHERE id = $2`, [hash, r.user_id]);
      // A new password ends every session, everywhere.
      await q.run(`DELETE FROM ${T.sessions} WHERE user_id = $1`, [r.user_id]);
      return r;
    });
    if (!row) throw new AuthError(400, 'token', 'This link has expired or was already used. Ask for a new one.');
    await audit(row.user_id, null, 'password-reset', null, req);
    res.json({ ok: true });
  }));

  // Signed in: change name, add or change a password.
  router.post('/account', requireUser, wrap(async (req, res) => {
    const body = req.body || {};
    const sets = [];
    const vals = [];
    if (body.name !== undefined) { vals.push(String(body.name || '').trim().slice(0, 120) || null); sets.push(`name = $${vals.length}`); }
    if (body.newPassword !== undefined) {
      const problem = passwordProblem(body.newPassword);
      if (problem) throw new AuthError(400, 'password', problem);
      if (req.user.password_hash && !(await bcrypt.compare(String(body.currentPassword || ''), req.user.password_hash))) {
        throw new AuthError(400, 'current', 'Your current password is not right.');
      }
      vals.push(await bcrypt.hash(String(body.newPassword), BCRYPT_COST));
      sets.push(`password_hash = $${vals.length}`);
    }
    if (body.email !== undefined && !req.user.email) {
      const email = normalizeEmail(body.email);
      if (!email) throw new AuthError(400, 'email', 'Enter a valid email address.');
      if (await findByEmail(email)) throw new AuthError(409, 'exists', 'Another account uses that email.');
      vals.push(email); sets.push(`email = $${vals.length}`);
    }
    if (!sets.length) return res.json({ user: publicUser(req.user) });
    vals.push(req.user.id);
    const u = await db.get(`UPDATE ${T.users} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    await audit(u.id, u.email || u.mobile, 'account-updated', Object.keys(body).join(','), req);
    res.json({ user: publicUser(u) });
  }));

  // Errors from this router are JSON, with a machine-readable code.
  router.use((err, req, res, next) => {
    if (err instanceof AuthError) {
      if (err.extra && err.extra.retryAfter) res.set('Retry-After', String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON', code: 'json' });
    return next(err);
  });

  /** Mount the JSON API at <base>/api/auth. */
  function mount(app, at = `${base}/api/auth`) { app.use(at, router); }

  return {
    mount, router, requireUser, csrfGuard, checkCsrf, currentSession, publicUser, audit, limit, tables: T, readCookie,
    setCookie: (req, res, v, opt) => setCookie(req, res, v, opt),
    cookie, cookiePath, AuthError,
    /** For the migration and admin tools: create a user directly. */
    async createUser({ email, mobile, name: nm, password, role = 'member', migratedFrom = null }) {
      const hash = password ? await bcrypt.hash(String(password), BCRYPT_COST) : null;
      return db.get(`INSERT INTO ${T.users} (email, mobile, name, password_hash, role, migrated_from, email_verified)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [normalizeEmail(email), normalizeMobile(mobile), nm || null, hash, role, migratedFrom, Boolean(email && migratedFrom)]);
    },
  };
}

/** The tables for one project, as SQL. `prefix` like 'tl_'. Safe to run more than once. */
function authSchema(prefix) {
  if (!/^[a-z_]+$/.test(prefix)) throw new Error('bad prefix');
  const p = prefix;
  return `
CREATE TABLE IF NOT EXISTS ${p}users (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email           VARCHAR(254) NULL,
  mobile          VARCHAR(10)  NULL,
  name            VARCHAR(120) NULL,
  password_hash   VARCHAR(100) NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'member',
  status          VARCHAR(12)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  mobile_verified BOOLEAN      NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER      NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ  NULL,
  settings        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  migrated_from   VARCHAR(80)  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ  NULL,
  CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_${p}users_email ON ${p}users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_${p}users_mobile ON ${p}users (mobile) WHERE mobile IS NOT NULL;

CREATE TABLE IF NOT EXISTS ${p}sessions (
  id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id      BIGINT       NOT NULL REFERENCES ${p}users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)     NOT NULL UNIQUE,
  csrf         VARCHAR(64)  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ  NOT NULL,
  ip           VARCHAR(45)  NULL,
  user_agent   VARCHAR(300) NULL
);
CREATE INDEX IF NOT EXISTS idx_${p}sessions_user ON ${p}sessions (user_id);

CREATE TABLE IF NOT EXISTS ${p}password_resets (
  id         BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES ${p}users(id) ON DELETE CASCADE,
  purpose    VARCHAR(10) NOT NULL DEFAULT 'reset' CHECK (purpose IN ('reset','verify')),
  token_hash CHAR(64)    NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${p}otp_codes (
  id         BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  target     VARCHAR(254) NOT NULL,
  purpose    VARCHAR(10)  NOT NULL,
  code_hash  CHAR(64)     NOT NULL,
  attempts   INTEGER      NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ  NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_${p}otp_target ON ${p}otp_codes (target, id);

CREATE TABLE IF NOT EXISTS ${p}rate_limits (
  bucket       VARCHAR(200) PRIMARY KEY,
  hits         INTEGER      NOT NULL,
  window_start TIMESTAMPTZ  NOT NULL
);

CREATE TABLE IF NOT EXISTS ${p}audit_log (
  id         BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    BIGINT       NULL,
  actor      VARCHAR(254) NULL,
  action     VARCHAR(40)  NOT NULL,
  detail     VARCHAR(500) NULL,
  ip         VARCHAR(45)  NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
`;
}

module.exports = { createProjectAuth, authSchema, normalizeMobile, normalizeEmail, passwordProblem, AuthError, LOCK_AFTER, LOCK_MINUTES, SESSION_DAYS };
