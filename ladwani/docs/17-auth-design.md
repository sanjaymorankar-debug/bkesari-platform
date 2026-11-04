# Phase 2.4 — Authentication & Authorization Design (Concrete)

## 1. Authentication

- **Library**: `@nestjs/passport` + `passport-jwt` (access tokens) + a custom `LocalStrategy`-style credential check for login (identifier can be mobile or email, resolved server-side — the exact bug fixed in the previous build's `authorize()` mismatch is avoided here by having exactly one code path that accepts a single `identifier` field, never separate `email`/`mobile` fields the frontend has to choose between).
- **Password hashing**: bcrypt, cost factor 12 — proven, no reason to introduce argon2 complexity at this scale.
- **Access token**: JWT, 15-minute expiry, payload = `{ sub: userId, roles, memberId }` — deliberately minimal, since a role change shouldn't require reasoning about what else might be stale in the token.
- **Refresh token**: opaque random token, stored **hashed** in `refresh_tokens` (never the raw token), delivered to the web client as the `lw_sid` cookie: HttpOnly, SameSite=Lax, Path=/ladwani (`LADWANI_COOKIE_PATH`), Secure except on plain http to localhost (`auth/session-cookie.ts`). Rotated on every use (old one invalidated, new one issued); a reused, already-rotated token is refused.
- **OTP**: 6-digit, hashed at rest (bcrypt, same as passwords — never stored or logged in plaintext), 10-minute expiry, at most 3 sent per account per hour (counted under a row lock on the account, so requests sent together cannot exceed it), at most 5 tries per code (each try recorded before it is checked, so parallel guesses cannot exceed it), single use. **Codes go by email** (owner's decision, 4 Nov 2026: SMS is on hold), over SMTP (Hostinger email; `MAIL_*` settings, `apps/api/src/mail/mail-settings.ts`). Sign-up requires an email and the code verifies it (`email_verified`); the mobile number is kept on the account but not verified while SMS is on hold. Email + code is the primary sign-in (`/auth/otp/send` and `/auth/otp/login` with `{ email }`); a reset code goes to the account's email (`/auth/password/forgot`, `/auth/password/reset`). Sending answers the same whether or not the address or account exists, and sends nothing to an address without an account. The `{ mobile }` paths stay in the API for when SMS is back (`auth/code-delivery.service.ts`); the web screens offer them only when `GET /auth/session` reports `smsLive: true`.
- **A code on screen (`devOtp`)**: only on the dev tier (`APP_ENV=dev`) or a local run (`APP_ENV` unset and `NODE_ENV` not `production`), and only when no mail provider is configured. Never on the test or production tiers (`APP_ENV=test`/`prod`, or no `APP_ENV` with `NODE_ENV=production`): there, without a provider, sending answers 503 "We could not send the email right now. Try again later or sign in with your password." (`apps/api/src/common/tier.ts`).
- **Login rate limiting**: `@nestjs/throttler` per visitor on every auth route, plus 5 wrong passwords per account → password sign-in locked for 15 minutes (`failed_attempts`/`locked_until`). A code still signs in during a lock, and a reset clears it.
- **Cross-site requests**: every `/auth` route refuses them (`auth/same-origin.guard.ts`): an `Origin` must name the host, and `Sec-Fetch-Site: cross-site` is refused.
- **Own accounts only**: LadWani never trusts another bkesari project's sign-in; the hub's app shell only reads `GET /auth/session` to show who is signed in.

## 2. Authorization

### 2.1 Role → Permission Resolution

```ts
@Injectable()
class PermissionsGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string[]>('permissions', ctx.getHandler())
    if (!required?.length) return true
    const { user } = ctx.switchToHttp().getRequest()
    const granted = await this.permissionsForUser(user.sub)   // cached per-request, invalidated on role change
    return required.every(p => granted.has(p))
  }
}

// Usage on a controller method:
@Permissions('family:member:add')
@Post(':id/members')
addMember(...) { ... }
```

### 2.2 Record-Scoped Checks

A permission string alone answers "can this role ever do this," not "can this user do this to this specific record." Scope checks are explicit, per-module policy functions called inside the handler — not folded into the guard, because the guard can't know what "own family" means for an arbitrary route without every module leaking its data model into a generic layer:

```ts
// inside FamiliesService
async assertKartaOrAdmin(familyId: string, user: RequestUser) {
  if (user.roles.includes('ADMIN') || user.roles.includes('OPERATOR')) return
  const membership = await this.prisma.familyMember.findFirst({
    where: { familyId, memberId: user.memberId, isKarta: true, leftAt: null }
  })
  if (!membership) throw new ForbiddenException('Only the family Karta can do this.')
}
```

This is a direct carry-forward of a real gap found and fixed in the previous build (the "add member" endpoint had no ownership check at all, mid-project) — designing the scope-check pattern in from day one here rather than retrofitting it.

### 2.3 Approval-Gated Mutations

Some actions are permission-gated *and* approval-gated simultaneously (e.g. `member.mark_deceased`): the permission check confirms the submitter is even allowed to *propose* the change; the approval engine (Phase 1 §12) governs whether it takes effect immediately or waits for Operator/Admin sign-off, per `approval_rules`. The two systems are deliberately separate — a permission check is a yes/no at request time, an approval is a workflow with state.

## 3. Session/Token Storage on the Frontend

- Access token: in-memory (a React context/store), never `localStorage` — eliminates a whole class of XSS-driven token theft.
- Refresh token: httpOnly cookie, inaccessible to JavaScript entirely.
- On app load, silently attempt `/auth/refresh` using the cookie to re-establish an access token; a 401 there means genuinely logged out. With an access token already held, `GET /auth/session` checks the cookie still holds a session (the app shell may have signed out) without rotating it.

## 4. What Explicitly Never Changes Based on Role

Per Phase 1 §80's hard rules — encoded here as guard-level invariants, not just documentation: no permission check ever grants Karta the ability to edit another adult member's `PRIVATE`-visibility fields (mobile, income, matrimony settings) without that member's own consent; the guard for `profile:edit:*` always requires `user.sub == target.userId` regardless of family relationship, full stop, with the only exception being the explicit Admin escape hatch (`profile:edit:any`), which is itself `[audit]`-tagged so every use of it is traceable.
