# Central login, RBAC and subscriptions: design note

Scope: bkesari.com (hub and every project behind it) and agtci.com.
**gokesari.com is out of scope.** It shares no users, sessions, cookies, tables or
code with anything here. Nothing below names it, reads its database or sets a
cookie it could receive.

Work order: central auth → RBAC and admin panel → subscription gating →
LadWani / Education / TaskList / Milk & Dairy → ATIP owner gate → agtci.com SSO.
Everything is **off until switched on** (`AUTH_ENABLED=1` on the hub,
`BKESARI_SSO_*` on each project), so merging any of this changes no running tier.

---

## 0. What exists today (inspected 2026-10-09)

| Repo | Serves | Stack | Auth today |
|---|---|---|---|
| `bkesari-platform/portal` | the hub: `/`, `/tasks/`, `/atip/`, static pages, and a reverse proxy for `/milk/`, `/edu/`, `/ladwani/` | Node 22, Express 4, mysql2 (SQLite locally) | HTTP Basic auth from env vars on `/tasks/` and `/atip/`. No user accounts. |
| `bkesari` | Milk & Dairy at `/milk` | Next.js 16.3, React 19, Drizzle, MySQL 8 | Auth.js v5, **Google only** (+ a dev-only email form), JWT sessions, roles CUSTOMER/SHOP_OWNER/OPERATOR/ADMIN/DELIVERY_PARTNER. No passwords stored. |
| `Ladwani` | LadWani at `/ladwani` | Next.js **14.2**, next-auth **v4**, Prisma 5, MySQL | Credentials (email or mobile + **bcrypt password**), lockout after 5 failures, JWT sessions, table-driven roles MEMBER/KARTA/OPERATOR/ADMIN with family/area scope. |
| `bkesari-platform/edu` | Education at `/edu` (canonical copy) | Laravel 13, Livewire/Volt, spatie/permission | Breeze email + **password**, own TOTP 2FA for admin roles, 15 domain roles (parent, teacher, system_admin, ...). |
| `edu` (standalone repo) | — | same app, **stale** (last real change 2026-08-26) | Superseded by `bkesari-platform/edu`; not changed by this work. |
| `ATIP-DEV` | the owner's trading platform (Mac / VPS) | Python, FastAPI | Optional `X-ATIP-Token` on mutating routes, optional enterprise login. Dhan credentials from `atip_data/config.json` or `DHAN_*` env (both git-ignored). Hub shows a read-only snapshot at `/atip/` behind Basic auth. |
| `agtci` | agtci.com | Next.js 16.3, Drizzle, MySQL | **None.** One placeholder page; schema has `leads`, `products`, `services`, `admin_users` (unused). No enquiry form, no client area. |

Consequences for the design:

* **The hub is the right home for the identity provider.** It already owns the
  `bkesari.com` origin on every tier and fronts every project, so one cookie on
  that origin reaches every project path without any cross-site machinery.
* Two projects (LadWani, Education) hold their own passwords today. They keep
  their tables untouched (additive), but with `BKESARI_SSO_ENFORCE=1` their own
  login pages redirect to the central login and local password checks are
  refused, so no project *uses* its own passwords any more.
* Milk & Dairy and the hub's `users`/`sessions`/`roles`/`audit_logs` names would
  collide if the auth tables were unprefixed in the main database, so every
  auth table is prefixed `auth_`.

---

## 1. Architecture

```
                         ┌──────────────────────── dev.bkesari.com (one origin per tier) ───────────────────────┐
 browser ── __Host-bk_sso ─▶ hub (Express)                                                                     │
                         │   ├─ /auth/*            identity provider: login, signup, Google, MFA, admin, OIDC  │
                         │   ├─ edge gate          session → entitlements; 401/403/subscribe page/404 (ATIP)  │
                         │   ├─ /tasks/            TaskList (in the hub)                                        │
                         │   ├─ /atip/             ATIP snapshot viewer (owner gate)                            │
                         │   └─ proxy ─▶ /milk/ (Next 16) /ladwani/ (Next 14) /edu/ (Laravel)                   │
                         │                 each re-validates the cookie: POST /auth/api/introspect (client creds)│
                         └───────────────────────────────────────────────────────────────────────────────────────┘
 agtci.com (Next 16) ── OIDC authorization code + PKCE ──▶ /auth/oauth/authorize → /token (server-side) → own cookie
                     ◀─ back-channel logout (logout_token JWT) ── on any logout
```

* **One identity provider** in `bkesari-platform/portal/auth/`, mounted at `/auth`.
  Plain Express, server-rendered HTML forms (work without JavaScript), no new
  framework. New dependencies: `bcryptjs` (pure JS: nothing to compile on
  Hostinger) and `nodemailer`.
* **Two layers of enforcement** for every project behind the hub:
  1. *Edge gate (hub)*: before a request is proxied, the hub resolves the session
     and the tab's feature. Logged out → login redirect (pages) or 401 (APIs).
     Not subscribed → "Subscribe / request access" page (pages) or 403 (APIs).
     ATIP → 404 unless owner.
  2. *Project check*: each project validates the same cookie against the central
     service itself (`/auth/api/introspect`, cached ≤ 30 s), because each project
     is also reachable on its own origin and needs fine-grained permissions
     (`ladwani.edit_tree`) the hub knows nothing about.
* **Database.** The auth tables live in the **main database** (Milk & Dairy's
  MySQL) as asked, via `AUTH_DB_*` variables that default to the hub's `DB_*`.
  Locally and in CI the same migrations run on SQLite, so the suite needs no
  server.

---

## 2. Table schemas (migration `portal/sql/auth/{mysql,sqlite}/001_auth.sql`)

All times are UTC `DATETIME` (`YYYY-MM-DD HH:MM:SS`), matching the hub. IDs are
UUID strings: the user id is the OIDC `sub`. Secrets are only ever stored hashed
(SHA-256 for random tokens, bcrypt for passwords) or encrypted (AES-256-GCM for
TOTP secrets).

| Table | Columns (abridged) | Notes |
|---|---|---|
| `auth_users` | id, email (unique, lower-case), name, password_hash NULL, email_verified_at, google_sub (unique) NULL, status ACTIVE/SUSPENDED, failed_logins, locked_until, totp_secret_enc, totp_enabled_at, privacy_consent_at, privacy_version, created_at, updated_at, last_login_at | `password_hash` NULL for Google-only accounts |
| `auth_roles` | code PK (SUPER_ADMIN, ADMIN, MODERATOR, USER), name, description | reference data |
| `auth_features` | code PK (LADWANI, EDUCATION, TASKLIST, MILK_DAIRY, AGTCI), name, path, subscribable | ATIP is **not** a row |
| `auth_user_roles` | id, user_id, role_code, feature_code NULL (set only for MODERATOR), granted_by, created_at; unique (user_id, role_code, feature_code) | |
| `auth_subscriptions` | id, user_id, feature_code, status pending/active/expired/revoked, starts_at, expires_at NULL, source admin/payment/request, payment_provider, payment_ref, requested_at, decided_by, decided_at, note; unique (user_id, feature_code) | one row per user and feature, history in the audit log |
| `auth_sessions` | id (sid), token_hash (unique), user_id, created_at, last_seen_at, expires_at, idle_expires_at, mfa_at NULL, ip, user_agent, revoked_at | idle 2 h sliding, absolute 7 days (owner: 12 h) |
| `auth_oauth_clients` | client_id PK, name, secret_hash, redirect_uris (JSON), post_logout_redirect_uris (JSON), backchannel_logout_uri, kind oidc/internal, tier, active, created_at | `internal` = a bkesari project allowed to introspect |
| `auth_oauth_codes` | code_hash PK, client_id, user_id, session_id, redirect_uri, code_challenge, nonce, scope, expires_at (60 s), used_at | single use |
| `auth_email_tokens` | token_hash PK, user_id, purpose verify/reset, expires_at, used_at | verify 24 h, reset 30 min |
| `auth_audit_log` | id, at, actor_user_id, subject_user_id, action, feature_code, detail (JSON), ip, user_agent | append-only, never updated |
| `auth_schema_migrations` | version, applied_at | migration ledger |

---

## 3. Roles, features and the permission matrix

The matrix is code (`portal/auth/rbac.js`), version-controlled and tested, and is
returned to projects already evaluated, so no project re-implements it.

**Effective permissions** = permissions granted by the user's roles, **restricted
to features the user is entitled to**. A user is entitled to a feature when they
have an *active, unexpired* subscription to it, or are a MODERATOR of it, or are
ADMIN / SUPER_ADMIN (who administer every feature).

| Permission | USER | MODERATOR (of that feature) | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|
| `milk.view`, `milk.order` | ✓ | ✓ | ✓ | ✓ |
| `milk.manage` | | ✓ | ✓ | ✓ |
| `education.view_course` | ✓ | ✓ | ✓ | ✓ |
| `education.manage` | | ✓ | ✓ | ✓ |
| `ladwani.view`, `ladwani.edit_tree` | ✓ | ✓ | ✓ | ✓ |
| `ladwani.moderate` | | ✓ | ✓ | ✓ |
| `tasklist.view` | ✓ | ✓ | ✓ | ✓ |
| `tasklist.manage` | | ✓ | ✓ | ✓ |
| `agtci.view_client_area` | ✓ | ✓ | ✓ | ✓ |
| `agtci.manage_enquiries` | | ✓ | ✓ | ✓ |
| `admin.view_users`, `admin.view_audit` | | | ✓ | ✓ |
| `admin.manage_users`, `admin.manage_subscriptions` | | | ✓ | ✓ |
| `admin.manage_admins` (grant/revoke ADMIN) | | | | ✓ |
| ATIP | — | — | — | owner only, see §6 |

Rules enforced on the server:

* Nobody can change **their own** roles (UI and API both refuse; audited).
* SUPER_ADMIN cannot be granted or revoked from the UI or API at all; it exists
  only through the server-side CLI (`npm run auth -- owner:bootstrap`) and must
  match `AUTH_OWNER_EMAIL`.
* ADMIN cannot modify a SUPER_ADMIN account, and cannot grant ADMIN.
* Admin pages require a session that passed TOTP (`mfa_at` set).

---

## 4. Subscriptions

* Subscribable features: `LADWANI`, `EDUCATION`, `TASKLIST`, `MILK_DAIRY`, `AGTCI`.
* Status: `pending` (user requested) → `active` (admin approved, optional
  `expires_at`) → `expired` (computed at read time when `expires_at` passes, and
  written back lazily) or `revoked` (admin).
* A user's entitlements decide the menu (`GET /auth/api/menu`) and every gate.
  An unsubscribed feature shows the **Subscribe / request access** page at
  `/auth/subscribe/<feature>`, never the content; its APIs return **403**.
* **Payment hook:** `subscriptions.activateFromPayment({userId, feature, provider,
  reference, expiresAt})` is the single function a future payment webhook calls.
  It writes `source='payment'`, the provider reference and an audit row. Today
  only the admin panel calls the equivalent `approve()`.

---

## 5. Single sign-on

### 5.1 Within bkesari.com: one cookie

`__Host-bk_sso=<256-bit random token>; Path=/; Secure; HttpOnly; SameSite=Lax`
(`bk_sso` without the prefix on plain-http localhost).

* **Host-only on purpose.** Every project is served through the hub under the
  tier's one origin (`dev.bkesari.com/milk/`, `/edu/`, ...), so a host-only cookie
  already reaches all of them. A `Domain=.bkesari.com` cookie would also be sent
  by browsers to `dev.` and `test.`, handing a **production** session to
  less-trusted dev code. If a project ever has to be reached on its own
  subdomain, `AUTH_COOKIE_DOMAIN` + a tier-specific `AUTH_COOKIE_NAME` enable it.
* `SameSite=Lax` (not Strict) so that the top-level redirect from agtci.com to
  `/auth/oauth/authorize` still carries the cookie and SSO is silent.
* Only the SHA-256 of the token is stored. Rotated on login and on MFA step-up.
* **Projects validate it** with `POST /auth/api/introspect` (`Authorization: Basic
  client_id:secret`, body `{token}`); the response carries user, roles,
  entitled features, subscriptions, evaluated permissions and `mfa`. Projects
  cache the answer for at most 30 s, so a logout or revocation takes effect within
  30 s everywhere (immediately at the hub's edge gate).

### 5.2 agtci.com: OpenID Connect, authorization code + PKCE

```
agtci /auth/login          → state, nonce, code_verifier in a short-lived signed cookie
  302 https://bkesari.com/auth/oauth/authorize?response_type=code&client_id=agtci-prod
      &redirect_uri=https://agtci.com/auth/callback&scope=openid email profile
      &state=…&nonce=…&code_challenge=…&code_challenge_method=S256
IdP: logged in?  no  → login page → back to authorize
                 yes → issue code (60 s, single use)                    ← silent when already logged in
  302 https://agtci.com/auth/callback?code=…&state=…
agtci server → POST /auth/oauth/token (client_secret_basic + code_verifier)
            ← id_token (RS256, sid, nonce), access_token (bound to the IdP session)
agtci verifies iss/aud/exp/nonce/signature (JWKS) → creates its own session row → sets
  __Host-agtci_session (HttpOnly, Secure, SameSite=Lax)
```

* Redirect URIs are matched **exactly** against the client's registered list,
  and registration itself only accepts hosts on an allow-list:
  `bkesari.com`, `*.bkesari.com`, `agtci.com`, `*.agtci.com` (and `localhost` in
  dev only). Discovery at `/auth/.well-known/openid-configuration`.
* Permissions and the AGTCI entitlement come from `/auth/oauth/userinfo`, which
  agtci re-reads at most every 60 s (it doubles as the "is the IdP session
  still alive" check).

### 5.3 Single logout

* Logout on bkesari.com (`POST /auth/logout`) revokes the IdP session, clears
  the cookie, and sends an OIDC **back-channel logout** (`logout_token` JWT with
  `sid`) to every client with a `backchannel_logout_uri`. agtci deletes its
  sessions with that `sid`.
* Logout on agtci.com deletes its own session, then redirects to the IdP's
  `end_session_endpoint` with `id_token_hint`; the IdP revokes the bkesari.com
  session and fans out back-channel logout as above, then returns to an
  allow-listed `post_logout_redirect_uri`.
* Belt and braces: agtci's 60 s userinfo re-check and the projects' 30 s
  introspection cache mean a lost back-channel call still ends the session.

---

## 6. ATIP: owner only

* ATIP is **not** a feature, permission, role or subscription. The single test is
  `isAtipOwner(identity)`: role `SUPER_ADMIN` **and** email equal to
  `AUTH_OWNER_EMAIL` **and** the session passed TOTP. No other role, including
  ADMIN, can satisfy it, and nothing in the admin panel can grant it.
* For everyone else ATIP does not exist: the static menu no longer lists it; the
  dynamic menu adds it only for the owner; `/auth/api/me`, `/menu`, introspection
  and userinfo never mention it to anyone else; the feature list and admin
  subscription screen never show it.
* Every ATIP route (`/atip/*`, `/ATIP/*`, including the snapshot upload when its
  token is wrong) answers a **bare 404** to logged-out and non-owner requests.
  Every owner access is written to the audit log.
* The ATIP app itself (`ATIP-DEV/dashboard/owner_gate.py`) gets the same gate as
  its outermost middleware when hosted: it introspects the cookie and returns 404
  unless `atip: true`. Dhan credentials stay where they are (git-ignored
  `atip_data/config.json` or `DHAN_*` env on the ATIP host); nothing new is sent
  to the browser, and there is no multi-user portfolio or broker linking.
* **TOTP** is mandatory for the owner and for admins. The owner's TOTP can only be
  enrolled from the server CLI (`npm run auth -- owner:totp`), so a stolen
  password alone can neither open ATIP nor enrol an attacker's authenticator.

---

## 7. Security controls

| Control | Implementation |
|---|---|
| Passwords | bcrypt cost 12 (`bcryptjs`), 10–72 bytes, never logged |
| Rate limiting | per IP and per account on login, signup, forgot-password, TOTP, token endpoint |
| Lockout | 5 consecutive failures → 15 min lock, doubling to 24 h max; audited |
| CSRF | every form carries an HMAC token bound to a per-browser `bk_csrf` cookie; checked on every POST; `SameSite=Lax` session cookie as second layer |
| Enumeration | signup / forgot-password answer identically whether or not the email exists |
| Headers | strict CSP, `frame-ancestors 'none'`, `no-store` on auth pages |
| Secrets | only in env (`.env.dev` / `.env.test` / `.env.prod` on the server, never in Git): `AUTH_SECRET`, `AUTH_OIDC_PRIVATE_KEY`, client secrets, Google, SMTP |
| Audit | logins (success and failure), logouts, lockouts, role changes, subscription changes, MFA changes, OAuth grants, every ATIP access |
| Privacy | `/auth/privacy`; sign-up requires an explicit consent checkbox; version and time stored |

---

## 8. Integration per project

| Project | Change (all additive, all behind env flags) |
|---|---|
| Hub / TaskList | `/tasks/` requires `TASKLIST`; reads need `tasklist.view`, writes `tasklist.manage`. Basic auth stays as the fallback when `AUTH_ENABLED` is off. |
| Milk & Dairy | `src/server/sso/` introspection client; `getCurrentUser()` accepts a central session and links or creates the local user by verified email; `MILK_DAIRY` required; 403 for APIs, subscribe page for pages. |
| LadWani | `bkesari-sso` next-auth provider mints the existing JWT from a central session (so the ~119 `getServerSession` call sites keep working); middleware re-checks the central session; password login refused when enforced; central ADMIN/MODERATOR mapped to local ADMIN/OPERATOR roles (only roles granted by SSO are ever revoked by SSO). |
| Education | `BkesariSso` middleware on the `web` group: introspect, link/create the local user, log in, log out when the central session ends; admin/officer roles require central MFA. |
| ATIP | hub viewer owner gate; `owner_gate.py` for the hosted app. |
| agtci.com | OIDC client, own session table, public pages (home, services, contact/enquiry form → `leads`), client area gated by `AGTCI` + `agtci.view_client_area`, enquiry management for `agtci.manage_enquiries`. |

Deployment steps and the promotion checklist: [DEPLOY_AUTH.md](./DEPLOY_AUTH.md).
