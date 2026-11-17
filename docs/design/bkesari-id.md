# One bkesari ID: Google sign-in at the hub, project access by admin approval

This document is the contract for decision **D-039** (owner's decision, 17 Nov 2026). It supersedes the
per-project sign-in rule of D-008/D-036 for *who a person is*. D-035 (an email code is not a way into an
account set up by someone else) and D-036's built-in administrators (`smorankar`, `sonalimorankar`) stay.
All times shown to people are IST (UTC + 5:30).

## 1. Who you are: the hub

| | |
|---|---|
| Account table | `users` in the hub database (`portal/sql/hub_schema.sql`): `id`, `email`, `name`, `picture`, `google_sub` (unique), `status` (`active` / `suspended` / `deleted`), `role` (`member`, `admin` for an address on `HUB_OWNER_EMAILS`, `owner` for the built-in administrators), `email_verified`, `created_at`, `last_login_at`, plus the columns `portal/project-auth.js` needs. |
| Session | Cookie `bk_sid` on `Path=/`, `HttpOnly`, `Secure` (except plain-http localhost), `SameSite=Lax`. The database keeps only the SHA-256 of the token (`hub_sessions`). CSRF, rate limits, lockout and audit are `project-auth.js`'s. Sign-out, suspension and deletion take effect on the next request. |
| Sign-in page | `/auth/sign-in?next=<path>`: **Continue with Google** first, then the email code; the built-in administrators type their username in the email field and get a password box. |
| Google | `GET /auth/google/start?next=` → Google → `GET /auth/google/callback`. OpenID Connect, authorization code + PKCE (S256), `state` and `nonce`. The ID token's **signature is checked against Google's JWKS**, then `iss`, `aud`, `exp`, `nonce` and `email_verified = true`. The account is found by `google_sub`, else by email **only if that account's email is confirmed** (GoKesari's `allowDangerousEmailAccountLinking: false`), else created. |
| Env | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (the same OAuth client as gokesari.com). Unset: Google is off, the button is hidden, the routes answer 404. |
| Redirect URIs | `https://bkesari.com/auth/google/callback`, `https://test.bkesari.com/auth/google/callback`, `https://dev.bkesari.com/auth/google/callback` (JavaScript origins: the three hosts). |
| Mobile | `/mobile-auth/start?app=<scheme>&challenge=<S256>` (system browser) → Google → `/mobile-auth/complete` → `<scheme>://auth-callback?code=…` → the app's WebView opens `/mobile-auth/finish?code=…&verifier=…` and gets its own `bk_sid`. The code is HMAC-signed, bound to the user and the PKCE challenge, and lasts two minutes (GoKesari's `src/server/mobile-auth.ts`). |

## 2. What you may open: project access

Projects come from `hub_projects` (`visibility`, `roles`):

| Project | Path | Visibility | Roles |
|---|---|---|---|
| Driving Simulator | `/driving-simulator/` | `open` | — |
| Environmental Activities | `/environment/` | `open` | — |
| ATIP | `/ATIP/` | `owner` (built-in administrators only, no request button) | owner |
| LadWani | `/ladwani/` | `approval`, **two steps** | member, karta, operator, admin |
| Education | `/edu/` | `approval` | parent, student, teacher, school_admin, admin |
| TaskList | `/tasklist/` (`/tasks/` redirects) | `approval` | viewer, editor, owner |

- A grant is a row in `project_access` (`user_id` = the hub user's id as text, `status` `active` / `revoked`).
  The built-in administrators (`role = owner`) hold the top role in every project without a row.
- A request is a row in `access_requests`; one pending request per person per project (unique index).
  A declined person may ask again 24 hours after the decision.
- LadWani's second step: after the hub grants access, the grant shows **Approved — awaiting LadWani
  verification** until LadWani's two operators have verified the person inside LadWani. LadWani reports its
  state on every response it sends to a signed-in hub user, in the response header
  `X-Bkesari-Project-State: verified | pending`; the hub stores it on the grant (`project_state`) and removes
  the header before the response leaves the hub.
- Every admin action (approve, decline, revoke, change role, suspend, grant) goes to `audit_log`; the person
  is emailed on approve, decline and revoke, the admins on each new request (`code@agtci.com`, D-034).

## 3. Enforcement (server side, at the hub, on every request)

For every request under `/ladwani/`, `/edu/` and `/tasklist/` (their APIs included):

1. Any `X-Bkesari-*` request header from the client is removed.
2. No `bk_sid` session → HTML: `302 /auth/sign-in?next=<original URL>`; API (`/api/` in the path or
   `Accept: application/json`): `401 {"error","signIn"}`.
3. Session, but no active grant (and not an owner) → HTML: `302 /access/request?project=<key>`; API: `403`.
4. Otherwise the request goes on with the identity headers below. The role comes from the database on this
   request; nothing from the client is believed.

Only `/ladwani/_next/static/` (immutable build files) skips the gate.

### Identity headers (hub → project)

| Header | Value |
|---|---|
| `X-Bkesari-User` | the hub user's id (digits) |
| `X-Bkesari-Email` | the confirmed email, lower-case |
| `X-Bkesari-Role` | the role of the active grant for this project |
| `X-Bkesari-Name` | the display name, base64url of UTF-8 (may be empty) |
| `X-Bkesari-Project` | `ladwani`, `edu` or `tasklist` |
| `X-Bkesari-Ts` | Unix time in seconds |
| `X-Bkesari-Sig` | base64url HMAC-SHA256, key `HUB_PROXY_SECRET`, over `bkesari-id-v1\n<project>\n<user>\n<email>\n<role>\n<name>\n<ts>` |

A project believes them only when `HUB_PROXY_SECRET` is set on its side, the signature matches
(timing-safe), `X-Bkesari-Project` is its own key, and `|now - ts| < 60` seconds. Otherwise it ignores
them completely (and its own sign-in, if it still has one, works as before). With a valid set, the project
finds its local user by `hub_user_id = X-Bkesari-User`, else by a **confirmed** email (then stores the hub id
on it), else creates one; it applies the role from the header; it signs that local user in for this request
(or its own session), and if its signed-in local user belongs to a different hub id, that session ends first.

## 4. Migration

`node tools/link_accounts_to_hub.mjs` (dry run) / `--apply`: for each LadWani, Education and TaskList account
with a **confirmed** email, find or create the hub user with that email and create the `project_access` row for
the role the account already holds, so nobody loses access on day one. Accounts with no confirmed email,
reserved addresses and roles with no hub equivalent are listed in the report and left alone.
