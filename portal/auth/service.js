/**
 * The auth service's business logic: accounts, sessions, MFA, roles and
 * subscriptions. No HTTP here; routes.js and oidc.js call these functions.
 *
 * Every function that changes who can do what writes an audit row.
 */
const passwords = require('./passwords');
const totp = require('./totp');
const rbac = require('./rbac');
const { encrypt, decrypt, hmac } = require('./crypto');
const {
  nowUtc, parseUtc, randomToken, sha256hex, uuid, normalizeEmail, isValidEmail, truncate,
  isUniqueViolation, safeEqual,
} = require('./util');

const LOCK_THRESHOLD = 5;
const LOCK_BASE_SECONDS = 15 * 60;
const LOCK_MAX_SECONDS = 24 * 3600;
const VERIFY_TTL = 24 * 3600;
const RESET_TTL = 30 * 60;
const PENDING_MFA_TTL = 5 * 60;

class AuthError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function createService({ db, config, mailer, audit, log = console }) {
  const link = (p) => `${config.publicUrl}${p}`;

  /* ------------------------------------------------------------ users */

  async function findUserByEmail(email) {
    return db.get('SELECT * FROM auth_users WHERE email = ?', [normalizeEmail(email)]);
  }

  async function findUserById(id) {
    if (!id) return null;
    return db.get('SELECT * FROM auth_users WHERE id = ?', [String(id)]);
  }

  async function rolesOf(userId) {
    return db.all('SELECT role_code, feature_code, granted_by, created_at FROM auth_user_roles WHERE user_id = ? ORDER BY role_code, feature_code', [userId]);
  }

  async function subscriptionsOf(userId) {
    return db.all('SELECT * FROM auth_subscriptions WHERE user_id = ? ORDER BY feature_code', [userId]);
  }

  async function insertUser({ email, name, passwordHash = null, verified = false, googleSub = null, consent = false }) {
    const id = uuid();
    const now = nowUtc();
    await db.run(
      `INSERT INTO auth_users (id, email, name, password_hash, email_verified_at, google_sub, status, failed_logins,
        privacy_consent_at, privacy_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, normalizeEmail(email), truncate(name, 120), passwordHash, verified ? now : null, googleSub, 'ACTIVE', 0,
        consent ? now : null, consent ? config.privacyVersion : null, now, now],
    );
    await db.run('INSERT INTO auth_user_roles (user_id, role_code, feature_code, granted_by, created_at) VALUES (?,?,?,?,?)',
      [id, 'USER', '', null, now]);
    return findUserById(id);
  }

  /* ------------------------------------------------------------ email tokens */

  async function issueEmailToken(userId, purpose, ttl) {
    const token = randomToken(32);
    const now = nowUtc();
    // One live token per purpose: issuing a new one retires the old.
    await db.run('UPDATE auth_email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [now, userId, purpose]);
    await db.run('INSERT INTO auth_email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?,?,?,?,?)',
      [sha256hex(token), userId, purpose, nowUtc(ttl), now]);
    return token;
  }

  async function consumeEmailToken(token, purpose) {
    const row = await db.get('SELECT * FROM auth_email_tokens WHERE token_hash = ? AND purpose = ?', [sha256hex(token || ''), purpose]);
    if (!row || row.used_at || parseUtc(row.expires_at) <= Date.now()) return null;
    const r = await db.run('UPDATE auth_email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', [nowUtc(), row.token_hash]);
    if (!r.changes) return null; // lost a race with another use
    return row;
  }

  async function sendVerification(user) {
    const token = await issueEmailToken(user.id, 'verify', VERIFY_TTL);
    await mailer.send({
      to: user.email,
      subject: 'Confirm your bkesari email address',
      text: `Hello${user.name ? ' ' + user.name : ''},\n\nConfirm your email address to finish creating your bkesari account:\n\n${link(`/auth/verify?token=${token}`)}\n\nThe link works once and expires in 24 hours. If you did not sign up, ignore this email.\n`,
    });
  }

  /* ------------------------------------------------------------ sign up */

  /**
   * Creates an account. Answers the same way whether or not the email is
   * already registered, so the form cannot be used to find out who has an
   * account. An existing, still-unverified account gets a fresh link.
   */
  async function signup({ email, name, password, consent, req }) {
    const clean = normalizeEmail(email);
    if (!isValidEmail(clean)) throw new AuthError('invalid_email', 'Enter a valid email address.');
    if (!consent) throw new AuthError('consent_required', 'Please accept the privacy notice to create an account.');
    const problem = passwords.validatePassword(password);
    if (problem) throw new AuthError('weak_password', problem);
    const nameClean = String(name || '').trim();
    if (nameClean.length > 120) throw new AuthError('invalid_name', 'Name is too long.');

    const existing = await findUserByEmail(clean);
    if (existing) {
      if (!existing.email_verified_at) await sendVerification(existing);
      return { created: false };
    }
    let user;
    try {
      user = await insertUser({ email: clean, name: nameClean || null, passwordHash: await passwords.hashPassword(password), consent: true });
    } catch (err) {
      if (isUniqueViolation(err)) return { created: false };
      throw err;
    }
    await audit.record({ action: 'SIGNUP', actorId: user.id, subjectId: user.id, detail: { method: 'password', privacy_version: config.privacyVersion }, req });
    await sendVerification(user);
    return { created: true, userId: user.id };
  }

  async function verifyEmail(token, { req } = {}) {
    const row = await consumeEmailToken(token, 'verify');
    if (!row) return null;
    const now = nowUtc();
    await db.run('UPDATE auth_users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', [now, now, row.user_id]);
    await audit.record({ action: 'EMAIL_VERIFIED', actorId: row.user_id, subjectId: row.user_id, req });
    return findUserById(row.user_id);
  }

  async function resendVerification(email) {
    const user = await findUserByEmail(email);
    if (user && !user.email_verified_at && user.status === 'ACTIVE') await sendVerification(user);
  }

  /* ------------------------------------------------------------ login */

  function lockSeconds(failures) {
    const over = Math.max(failures - LOCK_THRESHOLD, 0);
    return Math.min(LOCK_BASE_SECONDS * 2 ** over, LOCK_MAX_SECONDS);
  }

  function isLocked(user) {
    return Boolean(user.locked_until) && parseUtc(user.locked_until) > Date.now();
  }

  async function recordFailure(user, req, reason) {
    const failures = Number(user.failed_logins || 0) + 1;
    let lockedUntil = user.locked_until;
    if (failures >= LOCK_THRESHOLD) lockedUntil = nowUtc(lockSeconds(failures));
    await db.run('UPDATE auth_users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      [failures, lockedUntil, nowUtc(), user.id]);
    await audit.record({ action: reason === 'totp' ? 'MFA_FAILED' : 'LOGIN_FAILED', subjectId: user.id, detail: { failures }, req });
    if (failures >= LOCK_THRESHOLD) {
      await audit.record({ action: 'ACCOUNT_LOCKED', subjectId: user.id, detail: { failures, until: lockedUntil }, req });
    }
  }

  async function clearFailures(user) {
    if (user.failed_logins || user.locked_until) {
      await db.run('UPDATE auth_users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [user.id]);
    }
  }

  /** Signed, short-lived proof that the password step passed, for the TOTP step. */
  function pendingMfaToken(userId) {
    const exp = Math.floor(Date.now() / 1000) + PENDING_MFA_TTL;
    const body = `${userId}.${exp}`;
    return `${body}.${hmac(config.keys.state, `mfa:${body}`)}`;
  }

  function readPendingMfaToken(token) {
    const [userId, exp, sig] = String(token || '').split('.');
    if (!userId || !exp || !sig) return null;
    if (!safeEqual(sig, hmac(config.keys.state, `mfa:${userId}.${exp}`))) return null;
    if (Number(exp) * 1000 < Date.now()) return null;
    return userId;
  }

  /**
   * Password step. Returns { user } when done, { mfa: pendingToken } when a
   * TOTP code is needed next, or throws AuthError. Every refusal for a known
   * account counts toward its lockout.
   */
  async function passwordLogin({ email, password, req }) {
    const user = await findUserByEmail(email);
    const ok = await passwords.verifyPassword(password, user ? user.password_hash : null);
    const generic = new AuthError('invalid_credentials', 'That email and password do not match.', 401);
    if (!user) {
      await audit.record({ action: 'LOGIN_FAILED', detail: { email: truncate(normalizeEmail(email), 254), reason: 'no_account' }, req });
      throw generic;
    }
    if (isLocked(user)) {
      await audit.record({ action: 'LOGIN_FAILED', subjectId: user.id, detail: { reason: 'locked' }, req });
      throw new AuthError('locked', 'Too many failed attempts. Try again later, or reset your password.', 429);
    }
    if (!ok) { await recordFailure(user, req, 'password'); throw generic; }
    if (user.status !== 'ACTIVE') {
      await audit.record({ action: 'LOGIN_FAILED', subjectId: user.id, detail: { reason: 'suspended' }, req });
      throw new AuthError('suspended', 'This account is suspended.', 403);
    }
    if (!user.email_verified_at) {
      throw new AuthError('unverified', 'Confirm your email address first. We have sent you a new link.', 403);
    }
    if (user.totp_enabled_at) return { mfa: pendingMfaToken(user.id) };
    await clearFailures(user);
    return { user };
  }

  /** TOTP step after a password. */
  async function completeMfaLogin({ pending, code, req }) {
    const userId = readPendingMfaToken(pending);
    if (!userId) throw new AuthError('mfa_expired', 'That sign-in took too long. Start again.', 401);
    const user = await findUserById(userId);
    if (!user || user.status !== 'ACTIVE' || !user.totp_enabled_at) throw new AuthError('mfa_expired', 'Start again.', 401);
    if (isLocked(user)) throw new AuthError('locked', 'Too many failed attempts. Try again later.', 429);
    if (!(await checkTotp(user, code))) {
      await recordFailure(user, req, 'totp');
      throw new AuthError('mfa_invalid', 'That code is not right. Use the current code from your authenticator app.', 401);
    }
    await clearFailures(user);
    return { user, mfa: true };
  }

  /* ------------------------------------------------------------ Google */

  /**
   * Signs in with claims Google returned from its token endpoint over TLS.
   *
   * Links to an existing account only by a Google-verified email. If that
   * account was never verified, its password is cleared: otherwise whoever
   * registered the address first (perhaps not its owner) would keep a working
   * password on an account the real owner now uses.
   */
  async function googleLogin({ sub, email, emailVerified, name, consent = false, req }) {
    if (!sub || !email || !emailVerified) throw new AuthError('google_unverified', 'Google did not confirm that email address.', 403);
    let user = await db.get('SELECT * FROM auth_users WHERE google_sub = ?', [String(sub)]);
    if (!user) {
      const existing = await findUserByEmail(email);
      if (existing) {
        const now = nowUtc();
        const wasUnverified = !existing.email_verified_at;
        await db.run(`UPDATE auth_users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?),
          password_hash = ${wasUnverified ? 'NULL' : 'password_hash'}, updated_at = ? WHERE id = ?`, [String(sub), now, now, existing.id]);
        await audit.record({ action: 'GOOGLE_LINKED', actorId: existing.id, subjectId: existing.id, detail: { cleared_password: wasUnverified }, req });
        user = await findUserById(existing.id);
      } else {
        // A new account needs the privacy consent, ticked on the page that
        // started the flow and carried through Google in the sealed state.
        if (!consent) throw new AuthError('consent_required', 'To create a new account with Google, tick the privacy notice box first.');
        user = await insertUser({ email, name, verified: true, googleSub: String(sub), consent: true });
        await audit.record({ action: 'SIGNUP', actorId: user.id, subjectId: user.id, detail: { method: 'google', privacy_version: config.privacyVersion }, req });
      }
    }
    if (user.status !== 'ACTIVE') throw new AuthError('suspended', 'This account is suspended.', 403);
    if (isLocked(user)) throw new AuthError('locked', 'This account is locked for now.', 429);
    if (user.totp_enabled_at) return { mfa: pendingMfaToken(user.id) };
    return { user };
  }

  /* ------------------------------------------------------------ sessions */

  async function createSession(user, { mfa = false, req = null, method = 'password' } = {}) {
    const token = randomToken(32);
    const id = uuid();
    const now = nowUtc();
    const roles = await rolesOf(user.id);
    const isOwnerAccount = roles.some(r => r.role_code === 'SUPER_ADMIN');
    const absolute = isOwnerAccount ? config.session.ownerAbsoluteSeconds : config.session.absoluteSeconds;
    await db.run(
      `INSERT INTO auth_sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, idle_expires_at, mfa_at, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, sha256hex(token), user.id, now, now, nowUtc(absolute), nowUtc(Math.min(config.session.idleSeconds, absolute)),
        mfa ? now : null, req ? truncate(req.ip, 64) : null, req ? truncate(req.headers['user-agent'], 255) : null],
    );
    await db.run('UPDATE auth_users SET last_login_at = ? WHERE id = ?', [now, user.id]);
    await audit.record({ action: 'LOGIN_SUCCESS', actorId: user.id, subjectId: user.id, detail: { method, mfa, sid: id }, req });
    return { token, sessionId: id };
  }

  /**
   * The session behind a cookie token, with everything needed to authorise:
   * { session, user, roles, subscriptions, evaluation, mfa, atip }.
   * null when the token is unknown, revoked, expired or the user is not active.
   */
  async function resolveToken(token, { touch = true } = {}) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const session = await db.get('SELECT * FROM auth_sessions WHERE token_hash = ?', [sha256hex(token)]);
    return resolveSessionRow(session, { touch });
  }

  async function resolveSessionId(sid, { touch = false } = {}) {
    if (!sid) return null;
    const session = await db.get('SELECT * FROM auth_sessions WHERE id = ?', [String(sid)]);
    return resolveSessionRow(session, { touch });
  }

  async function resolveSessionRow(session, { touch }) {
    if (!session || session.revoked_at) return null;
    const nowMs = Date.now();
    if (parseUtc(session.expires_at) <= nowMs || parseUtc(session.idle_expires_at) <= nowMs) return null;
    const user = await findUserById(session.user_id);
    if (!user || user.status !== 'ACTIVE') return null;
    const [roles, subscriptions] = await Promise.all([rolesOf(user.id), subscriptionsOf(user.id)]);
    await expireLapsed(user.id, subscriptions);
    // Slide the idle window, at most once a minute per session.
    if (touch && nowMs - parseUtc(session.last_seen_at) > 60_000) {
      const idle = nowUtc(config.session.idleSeconds);
      const capped = parseUtc(idle) > parseUtc(session.expires_at) ? session.expires_at : idle;
      await db.run('UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?', [nowUtc(), capped, session.id]);
    }
    const evaluation = rbac.evaluate({ roles, subscriptions, nowMs });
    const mfa = Boolean(session.mfa_at);
    const atip = rbac.isAtipOwner({ user, roles, mfa }, config.ownerEmail);
    return { session, user, roles, subscriptions, evaluation, mfa, atip };
  }

  /** Marks the session as having passed TOTP (step-up). */
  async function markSessionMfa(sessionId) {
    await db.run('UPDATE auth_sessions SET mfa_at = ? WHERE id = ?', [nowUtc(), sessionId]);
  }

  async function revokeSession(sessionId, { req = null, actorId = null } = {}) {
    const row = await db.get('SELECT user_id FROM auth_sessions WHERE id = ? AND revoked_at IS NULL', [sessionId]);
    if (!row) return false;
    await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowUtc(), sessionId]);
    await audit.record({ action: 'LOGOUT', actorId: actorId || row.user_id, subjectId: row.user_id, detail: { sid: sessionId }, req });
    return true;
  }

  async function revokeAllSessions(userId) {
    const rows = await db.all('SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowUtc(), userId]);
    return rows.map(r => r.id);
  }

  async function activeSessions(userId) {
    return db.all(`SELECT id, created_at, last_seen_at, expires_at, mfa_at, ip, user_agent FROM auth_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND idle_expires_at > ? ORDER BY last_seen_at DESC`,
    [userId, nowUtc(), nowUtc()]);
  }

  /* ------------------------------------------------------------ password reset */

  async function requestPasswordReset(email, { req } = {}) {
    const user = await findUserByEmail(email);
    if (!user || user.status !== 'ACTIVE') return;
    const token = await issueEmailToken(user.id, 'reset', RESET_TTL);
    await audit.record({ action: 'PASSWORD_RESET_REQUESTED', subjectId: user.id, req });
    await mailer.send({
      to: user.email,
      subject: 'Reset your bkesari password',
      text: `Someone asked to reset the password for this bkesari account.\n\nTo choose a new password, open:\n\n${link(`/auth/reset?token=${token}`)}\n\nThe link works once and expires in 30 minutes. If it was not you, ignore this email; your password has not changed.\n`,
    });
  }

  /** Sets a new password, unlocks the account and ends every session. */
  async function resetPassword({ token, password, req }) {
    const problem = passwords.validatePassword(password);
    if (problem) throw new AuthError('weak_password', problem);
    const row = await consumeEmailToken(token, 'reset');
    if (!row) throw new AuthError('invalid_token', 'That reset link is not valid any more. Ask for a new one.');
    const now = nowUtc();
    await db.run(`UPDATE auth_users SET password_hash = ?, failed_logins = 0, locked_until = NULL,
      email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
    [await passwords.hashPassword(password), now, now, row.user_id]);
    const ended = await revokeAllSessions(row.user_id);
    await audit.record({ action: 'PASSWORD_RESET', actorId: row.user_id, subjectId: row.user_id, detail: { sessions_ended: ended.length }, req });
    return { userId: row.user_id, endedSessions: ended };
  }

  /* ------------------------------------------------------------ TOTP */

  async function checkTotp(user, code) {
    if (!user.totp_secret_enc || !user.totp_enabled_at) return false;
    let secret;
    try { secret = decrypt(config.keys.encryption, user.totp_secret_enc); } catch { return false; }
    const step = totp.verify(secret, code, { afterStep: user.totp_last_step });
    if (step === null) return false;
    // Conditional on the last step, so the same code cannot be used twice even concurrently.
    const r = await db.run('UPDATE auth_users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', [step, user.id, step]);
    return r.changes > 0;
  }

  /** Starts enrolment. The owner may only enrol from the server CLI. */
  async function beginTotpEnrollment(user, { allowOwner = false } = {}) {
    if (user.totp_enabled_at) throw new AuthError('mfa_exists', 'Two-step sign-in is already on.');
    const roles = await rolesOf(user.id);
    if (roles.some(r => r.role_code === 'SUPER_ADMIN') && !allowOwner) {
      throw new AuthError('owner_cli_only', 'The owner account enrols its authenticator from the server.', 403);
    }
    const secret = totp.generateSecret();
    await db.run('UPDATE auth_users SET totp_secret_enc = ?, totp_last_step = NULL, updated_at = ? WHERE id = ?',
      [encrypt(config.keys.encryption, secret), nowUtc(), user.id]);
    return { secret, uri: totp.otpauthUri(secret, user.email) };
  }

  async function confirmTotpEnrollment(user, code, { req } = {}) {
    const fresh = await findUserById(user.id);
    if (!fresh.totp_secret_enc || fresh.totp_enabled_at) throw new AuthError('mfa_state', 'Start enrolment again.');
    const secret = decrypt(config.keys.encryption, fresh.totp_secret_enc);
    const step = totp.verify(secret, code);
    if (step === null) throw new AuthError('mfa_invalid', 'That code is not right. Check the time on your phone and try the next code.');
    await db.run('UPDATE auth_users SET totp_enabled_at = ?, totp_last_step = ?, updated_at = ? WHERE id = ?', [nowUtc(), step, nowUtc(), user.id]);
    await audit.record({ action: 'MFA_ENABLED', actorId: user.id, subjectId: user.id, req });
  }

  /** Step-up for an existing session (admin pages, ATIP). */
  async function stepUp(resolved, code, { req } = {}) {
    const user = await findUserById(resolved.user.id);
    if (isLocked(user)) throw new AuthError('locked', 'Too many failed attempts. Try again later.', 429);
    if (!(await checkTotp(user, code))) {
      await recordFailure(user, req, 'totp');
      throw new AuthError('mfa_invalid', 'That code is not right.', 401);
    }
    await clearFailures(user);
    await markSessionMfa(resolved.session.id);
    await audit.record({ action: 'MFA_VERIFIED', actorId: user.id, subjectId: user.id, detail: { sid: resolved.session.id }, req });
  }

  /* ------------------------------------------------------------ roles */

  async function changeRole({ actor, targetId, role, feature = '', grant, req }) {
    const target = await findUserById(targetId);
    if (!target) throw new AuthError('not_found', 'No such user.', 404);
    const featureCode = role === 'MODERATOR' ? String(feature || '') : '';
    if (role === 'MODERATOR' && !rbac.FEATURE_CODES.includes(featureCode)) throw new AuthError('invalid_feature', 'Pick a feature to moderate.');
    const [actorRoles, targetRoles] = await Promise.all([rolesOf(actor.id), rolesOf(target.id)]);
    const denied = rbac.roleChangeDenied({ actor, actorRoles, target, targetRoles, role });
    if (denied) {
      await audit.record({ action: 'ROLE_CHANGE_DENIED', actorId: actor.id, subjectId: target.id, feature: featureCode || null, detail: { role, grant, reason: denied }, req });
      throw new AuthError('forbidden', denied, 403);
    }
    if (grant) {
      try {
        await db.run('INSERT INTO auth_user_roles (user_id, role_code, feature_code, granted_by, created_at) VALUES (?,?,?,?,?)',
          [target.id, role, featureCode, actor.id, nowUtc()]);
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    } else {
      const r = await db.run('DELETE FROM auth_user_roles WHERE user_id = ? AND role_code = ? AND feature_code = ?', [target.id, role, featureCode]);
      if (!r.changes) return false;
    }
    await audit.record({ action: grant ? 'ROLE_GRANTED' : 'ROLE_REVOKED', actorId: actor.id, subjectId: target.id, feature: featureCode || null, detail: { role }, req });
    return true;
  }

  /* ------------------------------------------------------------ subscriptions */

  function assertFeature(feature) {
    if (!rbac.FEATURE_CODES.includes(feature)) throw new AuthError('invalid_feature', 'Unknown feature.', 404);
  }

  /** Writes back 'expired' for active rows past their expiry (lazily, on read). */
  async function expireLapsed(userId, rows) {
    for (const s of rows) {
      if (s.status === 'active' && rbac.effectiveStatus(s) === 'expired') {
        const r = await db.run("UPDATE auth_subscriptions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'", [nowUtc(), s.id]);
        if (r.changes) {
          s.status = 'expired';
          await audit.record({ action: 'SUBSCRIPTION_EXPIRED', subjectId: userId, feature: s.feature_code, detail: { expires_at: s.expires_at } });
        }
      }
    }
  }

  async function getSubscription(userId, feature) {
    return db.get('SELECT * FROM auth_subscriptions WHERE user_id = ? AND feature_code = ?', [userId, feature]);
  }

  async function upsertSubscription(userId, feature, fields) {
    const now = nowUtc();
    const existing = await getSubscription(userId, feature);
    const cols = Object.keys(fields);
    if (existing) {
      await db.run(`UPDATE auth_subscriptions SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...cols.map(c => fields[c]), now, existing.id]);
    } else {
      await db.run(`INSERT INTO auth_subscriptions (user_id, feature_code, ${cols.join(', ')}, created_at, updated_at) VALUES (?,?,${cols.map(() => '?').join(',')},?,?)`,
        [userId, feature, ...cols.map(c => fields[c]), now, now]);
    }
    return { before: existing, after: await getSubscription(userId, feature) };
  }

  /** The user asks for access. Becomes 'pending' unless already active. */
  async function requestAccess({ user, feature, note, req }) {
    assertFeature(feature);
    const existing = await getSubscription(user.id, feature);
    if (existing && rbac.effectiveStatus(existing) === 'active') return { status: 'active' };
    if (existing && existing.status === 'pending') return { status: 'pending' };
    await upsertSubscription(user.id, feature, {
      status: 'pending', source: 'request', requested_at: nowUtc(), note: truncate(String(note || '').trim() || null, 500),
      decided_by: null, decided_at: null,
    });
    await audit.record({ action: 'SUBSCRIPTION_REQUESTED', actorId: user.id, subjectId: user.id, feature, req });
    return { status: 'pending' };
  }

  function cleanExpiry(expiresAt) {
    if (!expiresAt) return null;
    const s = String(expiresAt).trim();
    if (!s) return null;
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(s);
    if (!m || Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`))) throw new AuthError('invalid_expiry', 'Expiry must be a date (YYYY-MM-DD).');
    const value = m[2] ? `${m[1]} ${m[2].length === 5 ? m[2] + ':00' : m[2]}` : `${m[1]} 23:59:59`;
    if (parseUtc(value) <= Date.now()) throw new AuthError('invalid_expiry', 'Expiry must be in the future.');
    return value;
  }

  async function requireAdminActor(actor, permission) {
    const evaluation = rbac.evaluate({ roles: await rolesOf(actor.id) });
    if (!evaluation.permissions.includes(permission)) throw new AuthError('forbidden', 'Not allowed.', 403);
  }

  /** Admin approval (today's activation path). */
  async function approveSubscription({ actor, userId, feature, expiresAt, req }) {
    assertFeature(feature);
    await requireAdminActor(actor, 'admin.manage_subscriptions');
    if (!(await findUserById(userId))) throw new AuthError('not_found', 'No such user.', 404);
    const expiry = cleanExpiry(expiresAt);
    const { before } = await upsertSubscription(userId, feature, {
      status: 'active', source: 'admin', starts_at: nowUtc(), expires_at: expiry, decided_by: actor.id, decided_at: nowUtc(),
    });
    await audit.record({ action: 'SUBSCRIPTION_APPROVED', actorId: actor.id, subjectId: userId, feature, detail: { from: before ? before.status : null, expires_at: expiry }, req });
  }

  async function revokeSubscription({ actor, userId, feature, note, req }) {
    assertFeature(feature);
    await requireAdminActor(actor, 'admin.manage_subscriptions');
    const existing = await getSubscription(userId, feature);
    if (!existing) throw new AuthError('not_found', 'No subscription to revoke.', 404);
    await upsertSubscription(userId, feature, { status: 'revoked', decided_by: actor.id, decided_at: nowUtc(), note: truncate(note || null, 500) });
    await audit.record({ action: 'SUBSCRIPTION_REVOKED', actorId: actor.id, subjectId: userId, feature, detail: { from: existing.status }, req });
  }

  /**
   * THE PAYMENT HOOK. A payment provider's verified webhook calls this, and
   * only this, to activate a paid subscription. Idempotent per reference.
   */
  async function activateFromPayment({ userId, feature, provider, reference, expiresAt }) {
    assertFeature(feature);
    if (!provider || !reference) throw new AuthError('invalid_payment', 'provider and reference are required.');
    const existing = await getSubscription(userId, feature);
    if (existing && existing.payment_provider === provider && existing.payment_ref === reference && existing.status === 'active') return false;
    const expiry = expiresAt ? cleanExpiry(expiresAt) : null;
    await upsertSubscription(userId, feature, {
      status: 'active', source: 'payment', starts_at: nowUtc(), expires_at: expiry,
      payment_provider: truncate(provider, 40), payment_ref: truncate(reference, 120), decided_by: null, decided_at: nowUtc(),
    });
    await audit.record({ action: 'SUBSCRIPTION_PAID', subjectId: userId, feature, detail: { provider, reference, expires_at: expiry } });
    return true;
  }

  /* ------------------------------------------------------------ admin */

  async function setUserStatus({ actor, userId, status, req }) {
    await requireAdminActor(actor, 'admin.manage_users');
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new AuthError('invalid_status', 'Unknown status.');
    const target = await findUserById(userId);
    if (!target) throw new AuthError('not_found', 'No such user.', 404);
    if (target.id === actor.id) throw new AuthError('forbidden', 'You cannot change your own account status.', 403);
    const [actorRoles, targetRoles] = await Promise.all([rolesOf(actor.id), rolesOf(target.id)]);
    const t = rbac.evaluate({ roles: targetRoles });
    if (t.isSuperAdmin) throw new AuthError('forbidden', 'The owner account cannot be changed here.', 403);
    if (t.isAdmin && !rbac.evaluate({ roles: actorRoles }).isSuperAdmin) throw new AuthError('forbidden', 'Only the owner can suspend an admin.', 403);
    await db.run('UPDATE auth_users SET status = ?, updated_at = ? WHERE id = ?', [status, nowUtc(), target.id]);
    let ended = [];
    if (status === 'SUSPENDED') ended = await revokeAllSessions(target.id);
    await audit.record({ action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED', actorId: actor.id, subjectId: target.id, detail: { sessions_ended: ended.length }, req });
    return ended;
  }

  async function listUsers({ q = '', limit = 50, offset = 0 } = {}) {
    const term = String(q || '').trim().toLowerCase();
    const params = [];
    let where = '';
    if (term) { where = 'WHERE email LIKE ? OR LOWER(COALESCE(name, \'\')) LIKE ?'; params.push(`%${term}%`, `%${term}%`); }
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    const users = await db.all(`SELECT id, email, name, status, email_verified_at, totp_enabled_at, created_at, last_login_at, locked_until
      FROM auth_users ${where} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, params);
    for (const u of users) {
      u.roles = await rolesOf(u.id);
      u.subscriptions = (await subscriptionsOf(u.id)).map(s => ({ ...s, status: rbac.effectiveStatus(s) }));
    }
    return users;
  }

  async function pendingRequests() {
    return db.all(`SELECT s.*, u.email, u.name FROM auth_subscriptions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.status = 'pending' ORDER BY s.requested_at`);
  }

  /* ------------------------------------------------------------ owner (CLI only) */

  async function bootstrapOwner({ email, name, password }) {
    const clean = normalizeEmail(email);
    if (!config.ownerEmail || clean !== config.ownerEmail) throw new AuthError('owner_mismatch', 'The email must equal AUTH_OWNER_EMAIL.');
    let user = await findUserByEmail(clean);
    if (!user) {
      const problem = passwords.validatePassword(password);
      if (problem) throw new AuthError('weak_password', problem);
      user = await insertUser({ email: clean, name, passwordHash: await passwords.hashPassword(password), verified: true, consent: true });
    } else if (password) {
      const problem = passwords.validatePassword(password);
      if (problem) throw new AuthError('weak_password', problem);
      await db.run('UPDATE auth_users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), status = ?, updated_at = ? WHERE id = ?',
        [await passwords.hashPassword(password), nowUtc(), 'ACTIVE', nowUtc(), user.id]);
    }
    // SUPER_ADMIN belongs to exactly one account.
    await db.run("DELETE FROM auth_user_roles WHERE role_code = 'SUPER_ADMIN' AND user_id <> ?", [user.id]);
    try {
      await db.run('INSERT INTO auth_user_roles (user_id, role_code, feature_code, granted_by, created_at) VALUES (?,?,?,?,?)',
        [user.id, 'SUPER_ADMIN', '', null, nowUtc()]);
    } catch (err) { if (!isUniqueViolation(err)) throw err; }
    await audit.record({ action: 'OWNER_BOOTSTRAPPED', subjectId: user.id, detail: { via: 'cli' } });
    return findUserById(user.id);
  }

  return {
    AuthError,
    findUserByEmail, findUserById, rolesOf, subscriptionsOf,
    signup, verifyEmail, resendVerification,
    passwordLogin, completeMfaLogin, googleLogin, readPendingMfaToken,
    createSession, resolveToken, resolveSessionId, markSessionMfa, revokeSession, revokeAllSessions, activeSessions,
    requestPasswordReset, resetPassword,
    beginTotpEnrollment, confirmTotpEnrollment, stepUp, checkTotp,
    changeRole, requestAccess, approveSubscription, revokeSubscription, activateFromPayment, getSubscription,
    setUserStatus, listUsers, pendingRequests, bootstrapOwner,
    _log: log,
  };
}

module.exports = { createService, AuthError };
