/**
 * Roles, features and the permission matrix. The one place they are defined.
 *
 * Projects never re-implement this: introspection hands them the evaluated
 * result (entitled features and permissions) for the user in front of them.
 *
 * ATIP is deliberately absent from FEATURES, ROLE_PERMISSIONS and every list
 * below. It is not a feature, permission, role or subscription: the only way
 * in is isAtipOwner(), and nothing a non-owner can receive mentions it.
 */

const ROLES = Object.freeze(['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'USER']);

/** Subscribable features. `tab` is the hub path the feature is served under. */
const FEATURES = Object.freeze([
  { code: 'MILK_DAIRY', name: 'Milk & Dairy Products', tab: '/milk/', prefix: 'milk' },
  { code: 'EDUCATION', name: 'Education', tab: '/edu/', prefix: 'education' },
  { code: 'LADWANI', name: 'LadWani', tab: '/ladwani/', prefix: 'ladwani' },
  { code: 'TASKLIST', name: 'TaskList', tab: '/tasks/', prefix: 'tasklist' },
  { code: 'AGTCI', name: 'AGTCI client area', tab: null, prefix: 'agtci' },
]);
const FEATURE_CODES = Object.freeze(FEATURES.map(f => f.code));

/** Per-feature permissions, split by the lowest role that holds them. */
const FEATURE_PERMISSIONS = Object.freeze({
  MILK_DAIRY: { user: ['milk.view', 'milk.order'], moderator: ['milk.manage'] },
  EDUCATION: { user: ['education.view_course'], moderator: ['education.manage'] },
  LADWANI: { user: ['ladwani.view', 'ladwani.edit_tree'], moderator: ['ladwani.moderate'] },
  TASKLIST: { user: ['tasklist.view'], moderator: ['tasklist.manage'] },
  AGTCI: { user: ['agtci.view_client_area'], moderator: ['agtci.manage_enquiries'] },
});

const ADMIN_PERMISSIONS = Object.freeze([
  'admin.view_users', 'admin.view_audit', 'admin.manage_users', 'admin.manage_subscriptions',
]);
const SUPER_ADMIN_ONLY = Object.freeze(['admin.manage_admins']);

const ALL_PERMISSIONS = Object.freeze([
  ...Object.values(FEATURE_PERMISSIONS).flatMap(p => [...p.user, ...p.moderator]),
  ...ADMIN_PERMISSIONS,
  ...SUPER_ADMIN_ONLY,
]);

const SUBSCRIPTION_STATUSES = Object.freeze(['pending', 'active', 'expired', 'revoked']);

function featureByCode(code) {
  return FEATURES.find(f => f.code === code) || null;
}

function featureForTab(tabPath) {
  return FEATURES.find(f => f.tab && f.tab === tabPath) || null;
}

/** A subscription row is live when active and not past its expiry. */
function isSubscriptionLive(sub, nowMs = Date.now()) {
  if (!sub || sub.status !== 'active') return false;
  if (!sub.expires_at) return true;
  return Date.parse(String(sub.expires_at).replace(' ', 'T') + 'Z') > nowMs;
}

/**
 * The status to show for a row: an active row past its expiry reads as
 * expired even before the lazy write-back has happened.
 */
function effectiveStatus(sub, nowMs = Date.now()) {
  if (sub.status === 'active' && !isSubscriptionLive(sub, nowMs)) return 'expired';
  return sub.status;
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

/**
 * The owner test, and the only door into ATIP: SUPER_ADMIN, the configured
 * owner email, and a session that passed TOTP. All three, every time.
 */
function isAtipOwner({ user, roles, mfa }, ownerEmail) {
  if (!user || !ownerEmail) return false;
  if (normalizeEmail(user.email) !== normalizeEmail(ownerEmail)) return false;
  if (user.status && user.status !== 'ACTIVE') return false;
  if (!(roles || []).some(r => r.role_code === 'SUPER_ADMIN')) return false;
  return Boolean(mfa);
}

/**
 * Evaluates what a user may do.
 *
 * roles:          rows { role_code, feature_code } ('' when not per-feature)
 * subscriptions:  rows { feature_code, status, expires_at }
 *
 * Returns { roles, moderatorOf, features, permissions, subscriptions, isAdmin, isSuperAdmin }.
 * `features` are the entitled ones. Permissions are the role grants
 * restricted to entitled features, plus admin permissions.
 */
function evaluate({ roles = [], subscriptions = [], nowMs = Date.now() }) {
  const roleCodes = [...new Set(roles.map(r => r.role_code))].filter(r => ROLES.includes(r));
  const isSuperAdmin = roleCodes.includes('SUPER_ADMIN');
  const isAdmin = isSuperAdmin || roleCodes.includes('ADMIN');
  const moderatorOf = [...new Set(roles.filter(r => r.role_code === 'MODERATOR' && FEATURE_CODES.includes(r.feature_code)).map(r => r.feature_code))];

  const subs = subscriptions
    .filter(s => FEATURE_CODES.includes(s.feature_code))
    .map(s => ({ feature: s.feature_code, status: effectiveStatus(s, nowMs), expires_at: s.expires_at || null }));
  const subscribed = subs.filter(s => s.status === 'active').map(s => s.feature);

  const features = FEATURE_CODES.filter(code => isAdmin || moderatorOf.includes(code) || subscribed.includes(code));

  const perms = new Set();
  for (const code of features) {
    const p = FEATURE_PERMISSIONS[code];
    p.user.forEach(x => perms.add(x));
    if (isAdmin || moderatorOf.includes(code)) p.moderator.forEach(x => perms.add(x));
  }
  if (isAdmin) ADMIN_PERMISSIONS.forEach(x => perms.add(x));
  if (isSuperAdmin) SUPER_ADMIN_ONLY.forEach(x => perms.add(x));

  return {
    roles: roleCodes,
    moderatorOf,
    features,
    permissions: ALL_PERMISSIONS.filter(p => perms.has(p)),
    subscriptions: subs,
    isAdmin,
    isSuperAdmin,
  };
}

/**
 * Whether `actor` may change `target`'s roles in the way described.
 * Returns null when allowed, or the reason it is not.
 */
function roleChangeDenied({ actor, actorRoles, target, targetRoles, role }) {
  const actorEval = evaluate({ roles: actorRoles });
  if (!actorEval.isAdmin) return 'Only admins can change roles.';
  if (actor.id === target.id) return 'You cannot change your own role.';
  if (role === 'SUPER_ADMIN') return 'The owner role is assigned only from the server.';
  if (!ROLES.includes(role)) return 'Unknown role.';
  const targetEval = evaluate({ roles: targetRoles });
  if (targetEval.isSuperAdmin) return 'The owner account cannot be changed here.';
  if ((role === 'ADMIN' || targetEval.isAdmin) && !actorEval.isSuperAdmin) return 'Only the owner can grant or remove admin.';
  return null;
}

module.exports = {
  ROLES, FEATURES, FEATURE_CODES, FEATURE_PERMISSIONS, ADMIN_PERMISSIONS, SUPER_ADMIN_ONLY,
  ALL_PERMISSIONS, SUBSCRIPTION_STATUSES, featureByCode, featureForTab, isSubscriptionLive,
  effectiveStatus, evaluate, isAtipOwner, roleChangeDenied,
};
