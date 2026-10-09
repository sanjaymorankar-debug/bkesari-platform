/**
 * The one shape every project receives for a signed-in user, from
 * introspection, /auth/api/me and OIDC userinfo alike.
 *
 * `atip` appears only for the owner. For anyone else the key is absent, not
 * false, so no response to a non-owner mentions it.
 */
function toIdentity(resolved) {
  if (!resolved) return { active: false };
  const { session, user, evaluation, mfa } = resolved;
  const out = {
    active: true,
    sid: session.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || null,
      email_verified: Boolean(user.email_verified_at),
    },
    roles: evaluation.roles,
    moderator_of: evaluation.moderatorOf,
    features: evaluation.features,
    permissions: evaluation.permissions,
    subscriptions: evaluation.subscriptions,
    mfa,
    session_expires_at: session.expires_at,
  };
  if (resolved.atip) out.atip = true;
  return out;
}

module.exports = { toIdentity };
