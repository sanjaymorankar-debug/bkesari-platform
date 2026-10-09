/**
 * Server-rendered pages for the auth service. Plain HTML forms: every page
 * works with JavaScript off, and none loads a script.
 */
const menu = require('../public/shared/menu.js');
const { tabsFor, accountFor } = require('./menu-tabs');
const rbac = require('./rbac');
const { escapeHtml: e } = require('./util');

// No scripts at all; styles inline; images only from here and data URIs.
const CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'";

const STYLE = `<style>
:root{--bg:#F6F4EF;--surface:#fff;--ink:#1B1D24;--ink-soft:#5F6472;--ink-faint:#9A9EA9;--line:#E6E2D9;
  --accent:#E0761F;--accent-soft:#FDF0E3;--accent-dark:#B85A0E;--danger:#B42318;--danger-soft:#FDECEA;--ok:#1E7A4C;--ok-soft:#E4F4EA}
@media (prefers-color-scheme:dark){:root{--bg:#14151A;--surface:#1D1F26;--ink:#ECEDF1;--ink-soft:#A4A8B4;--ink-faint:#6F7380;
  --line:#2C2F38;--accent:#F08A34;--accent-soft:#3A2715;--accent-dark:#FFB273;--danger:#FF8A80;--danger-soft:#3D2220;--ok:#5BD69A;--ok-soft:#1C3A2B}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 'Inter',system-ui,-apple-system,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px 64px}
main.wide{max-width:1080px}
h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px;line-height:1.2}
h2{font-size:19px;margin:32px 0 10px}
p{margin:0 0 12px}
a{color:var(--accent-dark)}
.muted{color:var(--ink-soft)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px;margin:18px 0}
form.stack{display:grid;gap:14px}
label{font-weight:600;font-size:14px;display:grid;gap:6px}
label.check{display:flex;gap:10px;align-items:flex-start;font-weight:500}
input[type=email],input[type=password],input[type=text],input[type=date],select,textarea{font:inherit;padding:10px 12px;border-radius:10px;
  border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
button,.button{font:inherit;font-weight:600;padding:10px 16px;border-radius:10px;border:1px solid var(--accent);
  background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
button.secondary,.button.secondary{background:transparent;color:var(--accent-dark);border-color:var(--line)}
button.danger{background:transparent;color:var(--danger);border-color:var(--danger)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.notice{padding:12px 14px;border-radius:10px;margin:0 0 16px}
.notice.error{background:var(--danger-soft);color:var(--danger)}
.notice.ok{background:var(--ok-soft);color:var(--ok)}
.notice.info{background:var(--accent-soft);color:var(--accent-dark)}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink-soft);font-weight:600}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:20px;background:var(--accent-soft);color:var(--accent-dark);margin:1px 2px 1px 0}
.pill.active{background:var(--ok-soft);color:var(--ok)}
.pill.pending{background:var(--accent-soft);color:var(--accent-dark)}
.pill.expired,.pill.revoked{background:var(--danger-soft);color:var(--danger)}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
.inline{display:inline}
.divider{display:flex;align-items:center;gap:10px;color:var(--ink-faint);font-size:13px;margin:6px 0}
.divider:before,.divider:after{content:"";flex:1;height:1px;background:var(--line)}
@media (max-width:640px){main{padding:28px 16px 48px}table{font-size:13px}}
</style>`;

function layout({ title, body, req, resolved, env, wide = false }) {
  const pathname = req ? req.path : '/auth/';
  const bar = menu.renderHtml({ pathname, env, tabs: tabsFor(resolved), account: accountFor(resolved) });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)} · bkesari</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
${STYLE}</head><body>
${bar}
<main${wide ? ' class="wide"' : ''}>${body}</main>
</body></html>`;
}

function notice(kind, text) {
  return text ? `<div class="notice ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${e(text)}</div>` : '';
}

const csrfField = (t) => `<input type="hidden" name="_csrf" value="${e(t)}">`;
const returnField = (r) => (r ? `<input type="hidden" name="return_to" value="${e(r)}">` : '');
const qs = (r) => (r ? `?return_to=${encodeURIComponent(r)}` : '');

function googleButton({ csrf, returnTo, google, withConsent }) {
  if (!google) return '';
  return `<div class="divider">or</div>
<form method="post" action="/auth/google/start" class="stack">${csrfField(csrf)}${returnField(returnTo)}
  ${withConsent ? `<label class="check"><input type="checkbox" name="consent" value="1"> <span>I have read the <a href="/auth/privacy">privacy notice</a> and agree to it (needed for a new account).</span></label>` : '<input type="hidden" name="consent" value="0">'}
  <button type="submit" class="secondary">Continue with Google</button>
</form>`;
}

const pages = {
  login({ csrf, returnTo, error, info, email, google }) {
    return {
      title: 'Sign in',
      body: `<h1>Sign in</h1><p class="muted">One account for every bkesari project and agtci.com.</p>
<div class="card">${notice('error', error)}${notice('info', info)}
<form method="post" action="/auth/login" class="stack">${csrfField(csrf)}${returnField(returnTo)}
  <label>Email <input type="email" name="email" autocomplete="username" required value="${e(email || '')}"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
</form>
${googleButton({ csrf, returnTo, google, withConsent: true })}
</div>
<p><a href="/auth/forgot">Forgot your password?</a> · <a href="/auth/signup${qs(returnTo)}">Create an account</a></p>`,
    };
  },

  mfa({ csrf, returnTo, pending, error }) {
    return {
      title: 'Two-step sign-in',
      body: `<h1>Enter your code</h1><p class="muted">Open your authenticator app and enter the 6-digit code for bkesari.</p>
<div class="card">${notice('error', error)}
<form method="post" action="/auth/login/mfa" class="stack">${csrfField(csrf)}${returnField(returnTo)}
  <input type="hidden" name="pending" value="${e(pending)}">
  <label>Code <input type="text" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" autocomplete="one-time-code" required autofocus></label>
  <button type="submit">Continue</button>
</form></div>`,
    };
  },

  stepUp({ csrf, returnTo, error, enrolled }) {
    if (!enrolled) {
      return {
        title: 'Two-step sign-in required',
        body: `<h1>Two-step sign-in required</h1>
<div class="card"><p>This page needs two-step sign-in (an authenticator app code) on your account.</p>
<p><a class="button" href="/auth/account#mfa">Set it up on your account page</a></p></div>`,
      };
    }
    return {
      title: 'Confirm it is you',
      body: `<h1>Confirm it is you</h1><p class="muted">This area needs a code from your authenticator app.</p>
<div class="card">${notice('error', error)}
<form method="post" action="/auth/step-up" class="stack">${csrfField(csrf)}${returnField(returnTo)}
  <label>Code <input type="text" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" autocomplete="one-time-code" required autofocus></label>
  <button type="submit">Continue</button>
</form></div>`,
    };
  },

  signup({ csrf, returnTo, error, values = {}, google, minLength }) {
    return {
      title: 'Create an account',
      body: `<h1>Create an account</h1><p class="muted">One account for every bkesari project and agtci.com.</p>
<div class="card">${notice('error', error)}
<form method="post" action="/auth/signup" class="stack">${csrfField(csrf)}${returnField(returnTo)}
  <label>Name <input type="text" name="name" maxlength="120" autocomplete="name" value="${e(values.name || '')}"></label>
  <label>Email <input type="email" name="email" autocomplete="email" required value="${e(values.email || '')}"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" minlength="${minLength}" required>
    <span class="muted" style="font-weight:400">At least ${minLength} characters.</span></label>
  <label class="check"><input type="checkbox" name="consent" value="1" required>
    <span>I have read the <a href="/auth/privacy">privacy notice</a> and agree to my data being used as it describes.</span></label>
  <button type="submit">Create account</button>
</form>
${googleButton({ csrf, returnTo, google, withConsent: true })}
</div>
<p>Already have an account? <a href="/auth/login${qs(returnTo)}">Sign in</a></p>`,
    };
  },

  checkEmail({ email }) {
    return {
      title: 'Check your email',
      body: `<h1>Check your email</h1><div class="card">
<p>If <strong>${e(email)}</strong> can be used for a new account, we have sent a link to confirm it. Open it to finish signing up.</p>
<p class="muted">Nothing arrived? Check spam, or <a href="/auth/login">sign in</a> to be sent a new link.</p></div>`,
    };
  },

  message({ title, text, kind = 'info', link }) {
    return {
      title,
      body: `<h1>${e(title)}</h1><div class="card">${notice(kind, text)}${link ? `<p><a class="button" href="${e(link.href)}">${e(link.label)}</a></p>` : ''}</div>`,
    };
  },

  forgot({ csrf, sent, error }) {
    return {
      title: 'Reset your password',
      body: `<h1>Reset your password</h1><div class="card">${notice('error', error)}
${sent ? notice('ok', 'If that email has an account, a reset link is on its way. It expires in 30 minutes.') : ''}
<form method="post" action="/auth/forgot" class="stack">${csrfField(csrf)}
  <label>Email <input type="email" name="email" autocomplete="email" required></label>
  <button type="submit">Send reset link</button>
</form></div>`,
    };
  },

  reset({ csrf, token, error, minLength }) {
    return {
      title: 'Choose a new password',
      body: `<h1>Choose a new password</h1><div class="card">${notice('error', error)}
<form method="post" action="/auth/reset" class="stack">${csrfField(csrf)}
  <input type="hidden" name="token" value="${e(token)}">
  <label>New password <input type="password" name="password" autocomplete="new-password" minlength="${minLength}" required></label>
  <button type="submit">Save password</button>
</form><p class="muted">Saving signs you out everywhere.</p></div>`,
    };
  },

  account({ csrf, resolved, sessions, enrolment, error, info }) {
    const { user, evaluation } = resolved;
    const subs = new Map(evaluation.subscriptions.map(s => [s.feature, s]));
    const rows = rbac.FEATURES.map((f) => {
      const s = subs.get(f.code);
      const entitled = evaluation.features.includes(f.code);
      let state = s ? `<span class="pill ${e(s.status)}">${e(s.status)}</span>${s.expires_at ? ` <span class="muted">until ${e(s.expires_at.slice(0, 10))}</span>` : ''}` : '<span class="muted">not subscribed</span>';
      if (entitled && !(s && s.status === 'active')) state = '<span class="pill active">included with your role</span>';
      const open = entitled && f.tab ? ` <a href="${e(f.tab)}">Open</a>` : '';
      const ask = !entitled && !(s && s.status === 'pending')
        ? `<a class="button secondary" href="/auth/subscribe/${e(f.code.toLowerCase())}">Request access</a>` : '';
      return `<tr><td>${e(f.name)}</td><td>${state}${open}</td><td>${ask}</td></tr>`;
    }).join('');
    const sessionRows = sessions.map(s => `<tr><td>${e(s.created_at)} UTC${s.id === resolved.session.id ? ' <span class="pill">this browser</span>' : ''}</td><td class="mono">${e(s.ip || '')}</td><td>${e((s.user_agent || '').slice(0, 60))}</td></tr>`).join('');
    const isOwnerAccount = evaluation.isSuperAdmin;
    let mfa;
    if (user.totp_enabled_at) {
      mfa = `<p><span class="pill active">on</span> since ${e(user.totp_enabled_at.slice(0, 10))}. ${resolved.mfa ? 'This browser passed it.' : `<a href="/auth/step-up?return_to=/auth/account">Confirm with a code</a> to open admin pages.`}</p>`;
    } else if (isOwnerAccount) {
      mfa = '<p>The owner account sets up its authenticator from the server: <code>npm run auth -- owner:totp</code>.</p>';
    } else if (enrolment) {
      mfa = `<p>Add this key to your authenticator app (Google Authenticator, 1Password, Authy …), choosing "enter a setup key":</p>
<p class="mono" style="font-size:16px">${e(enrolment.secret.replace(/(.{4})/g, '$1 ').trim())}</p>
<p class="muted">Or open on your phone: <a href="${e(enrolment.uri)}">otpauth link</a></p>
<form method="post" action="/auth/account/mfa/confirm" class="stack">${csrfField(csrf)}
  <label>Code from the app <input type="text" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" autocomplete="one-time-code" required></label>
  <button type="submit">Turn on two-step sign-in</button></form>`;
    } else {
      mfa = `<p class="muted">Off. Admin pages need it.</p><form method="post" action="/auth/account/mfa/begin">${csrfField(csrf)}<button type="submit" class="secondary">Set up two-step sign-in</button></form>`;
    }
    return {
      title: 'Your account',
      body: `<h1>Your account</h1>${notice('error', error)}${notice('ok', info)}
<div class="card"><p><strong>${e(user.name || user.email)}</strong><br><span class="muted">${e(user.email)}</span></p>
<p>${evaluation.roles.map(r => `<span class="pill">${e(r)}</span>`).join('')}${evaluation.moderatorOf.map(f => `<span class="pill">moderates ${e(f)}</span>`).join('')}</p>
<div class="row">${evaluation.isAdmin ? '<a class="button secondary" href="/auth/admin">Admin panel</a>' : ''}
<form method="post" action="/auth/logout" class="inline">${csrfField(csrf)}<button type="submit" class="secondary">Sign out everywhere on this browser</button></form></div></div>
<h2>Projects</h2><div class="card"><table><thead><tr><th>Project</th><th>Access</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<h2 id="mfa">Two-step sign-in</h2><div class="card">${mfa}</div>
<h2>Signed-in browsers</h2><div class="card"><table><thead><tr><th>Since</th><th>IP</th><th>Browser</th></tr></thead><tbody>${sessionRows}</tbody></table></div>
<p class="muted"><a href="/auth/privacy">Privacy notice</a></p>`,
    };
  },

  subscribe({ csrf, feature, resolved, status, info }) {
    const loggedIn = Boolean(resolved);
    let action;
    if (!loggedIn) {
      action = `<p><a class="button" href="/auth/login?return_to=${encodeURIComponent(`/auth/subscribe/${feature.code.toLowerCase()}`)}">Sign in to request access</a></p>`;
    } else if (status === 'pending') {
      action = '<p><span class="pill pending">requested</span> An admin will review your request. You will have access as soon as it is approved.</p>';
    } else {
      action = `<form method="post" action="/auth/subscribe/${e(feature.code.toLowerCase())}" class="stack">${csrfField(csrf)}
  <label>Anything the admin should know? (optional) <textarea name="note" maxlength="500" rows="3"></textarea></label>
  <button type="submit">Request access</button></form>
  ${status === 'expired' ? '<p class="muted">Your previous access has expired.</p>' : ''}${status === 'revoked' ? '<p class="muted">Your previous access was withdrawn.</p>' : ''}`;
    }
    return {
      title: `${feature.name}: subscribe`,
      body: `<h1>${e(feature.name)}</h1>${notice('ok', info)}
<div class="card"><p>Your account does not include <strong>${e(feature.name)}</strong> yet.</p>${action}
<p class="muted">Paid plans are coming; for now an admin approves each request.</p></div>`,
    };
  },

  privacy({ version }) {
    return {
      title: 'Privacy notice',
      body: `<h1>Privacy notice</h1><p class="muted">Version ${e(version)}. Applies to bkesari.com and the login it provides for agtci.com.</p>
<div class="card">
<h2 style="margin-top:0">What we keep</h2>
<p>Your name and email address; a bcrypt hash of your password (never the password itself); if you use Google sign-in, Google's identifier for your account; which projects you have access to; and, for security, the time, IP address and browser of sign-ins and of changes to your account.</p>
<h2>Why</h2>
<p>To sign you in once across bkesari.com projects and agtci.com, to decide what you can open, and to protect accounts against misuse. We do not sell your data or use it for advertising.</p>
<h2>Who sees it</h2>
<p>The site owner and the admins who manage access. Each project you use (for example LadWani or Education) receives your name, email and access rights when you open it, and keeps its own records under its own notice. Email is delivered by our mail provider.</p>
<h2>How long</h2>
<p>For as long as your account exists. Security records are kept for up to two years.</p>
<h2>Your choices</h2>
<p>You can see your access and sign-ins on your account page, and ask the site owner to correct or delete your account by writing to the address on the contact page.</p>
<h2>Cookies</h2>
<p>One sign-in cookie and one form-protection cookie, both strictly necessary. No tracking cookies.</p>
</div>`,
    };
  },
};

module.exports = { layout, pages, CSP, notice };
