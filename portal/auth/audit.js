/**
 * The audit log: append-only. Nothing in the application updates or deletes
 * a row of auth_audit_log.
 */
const { nowUtc, truncate } = require('./util');

const ACTIONS = Object.freeze([
  'SIGNUP', 'EMAIL_VERIFIED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'LOGOUT',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'GOOGLE_LINKED',
  'MFA_ENABLED', 'MFA_DISABLED', 'MFA_FAILED', 'MFA_VERIFIED',
  'ROLE_GRANTED', 'ROLE_REVOKED', 'ROLE_CHANGE_DENIED',
  'SUBSCRIPTION_REQUESTED', 'SUBSCRIPTION_APPROVED', 'SUBSCRIPTION_REVOKED',
  'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_PAID',
  'USER_SUSPENDED', 'USER_REACTIVATED',
  'OAUTH_CODE_ISSUED', 'OAUTH_TOKEN_ISSUED', 'OAUTH_TOKEN_DENIED', 'OAUTH_LOGOUT',
  'ATIP_ACCESS', 'ATIP_SNAPSHOT_UPLOADED',
  'OWNER_BOOTSTRAPPED', 'OWNER_TOTP_ENROLLED', 'CLIENT_REGISTERED',
]);

function createAudit(db, { log = console } = {}) {
  /**
   * Records one event. Never throws: losing an audit row must not turn a
   * successful logout into an error page, but it is logged loudly.
   */
  async function record({ action, actorId = null, subjectId = null, feature = null, detail = null, req = null }) {
    if (!ACTIONS.includes(action)) log.warn(`audit: unknown action ${action}`);
    try {
      await db.run(
        'INSERT INTO auth_audit_log (at, actor_user_id, subject_user_id, action, feature_code, detail, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)',
        [nowUtc(), actorId, subjectId, action, feature, detail ? truncate(JSON.stringify(detail), 4000) : null,
          req ? truncate(req.ip, 64) : null, req ? truncate(req.headers['user-agent'], 255) : null],
      );
    } catch (err) {
      log.error(`audit write failed for ${action}: ${err.message}`);
    }
  }

  /**
   * Newest first. Owner-only events (ATIP_*) are left out unless the viewer is
   * the owner: an admin reading the log must not learn ATIP exists.
   */
  async function list({ action, userId, limit = 100, offset = 0, includeOwnerOnly = false } = {}) {
    const where = [];
    const params = [];
    if (!includeOwnerOnly) where.push("SUBSTR(a.action, 1, 5) <> 'ATIP_'");
    if (action) { where.push('a.action = ?'); params.push(action); }
    if (userId) { where.push('(a.subject_user_id = ? OR a.actor_user_id = ?)'); params.push(userId, userId); }
    const sql = `SELECT a.*, actor.email AS actor_email, subject.email AS subject_email
      FROM auth_audit_log a
      LEFT JOIN auth_users actor ON actor.id = a.actor_user_id
      LEFT JOIN auth_users subject ON subject.id = a.subject_user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 100, 1), 500)} OFFSET ${Math.max(Number(offset) || 0, 0)}`;
    return db.all(sql, params);
  }

  const OWNER_ONLY = ACTIONS.filter(a => a.startsWith('ATIP_'));
  const visibleActions = (includeOwnerOnly) => ACTIONS.filter(a => includeOwnerOnly || !OWNER_ONLY.includes(a));

  return { record, list, ACTIONS, visibleActions };
}

module.exports = { createAudit, ACTIONS };
