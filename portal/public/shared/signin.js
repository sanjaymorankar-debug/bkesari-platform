/* The bkesari ID's sign-in page (/auth/sign-in, D-039). "Continue with
   Google" is a plain link; this file runs the email code, and the built-in
   administrators' password (a username, not an email, in the first box).
   Talks to /account/api/auth with the CSRF token that API hands out. A file,
   not an inline script, so the hub's Content-Security-Policy holds. */
(function () {
  'use strict';
  const API = '/account/api/auth';
  const $ = (id) => document.getElementById(id);
  const box = document.querySelector('[data-signin]');
  if (!box) return;
  const next = box.getAttribute('data-next') || '/';
  let csrf = null;
  let email = null;

  async function session() {
    const r = await fetch(`${API}/session`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const s = await r.json();
    csrf = s.csrf;
    return s;
  }
  async function call(path, body) {
    if (!csrf) await session();
    const r = await fetch(API + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf || '' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  const err = (msg) => { $('si-err').textContent = msg || ''; };
  const busy = (form, on) => { const b = form.querySelector('button[type=submit]'); if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); };
  const done = () => { location.href = next; };

  session().catch(() => {});

  // A username (no @) is a built-in administrator: ask for the password instead of a code.
  const idInput = $('si-email');
  const passField = $('si-pass-field');
  const sendBtn = $('si-send-btn');
  const sendLabel = sendBtn.textContent;
  idInput.addEventListener('input', () => {
    const user = idInput.value.trim() !== '' && !idInput.value.includes('@');
    passField.hidden = !user;
    sendBtn.textContent = user ? (document.documentElement.lang === 'en' ? 'Sign in' : sendLabel) : sendLabel;
  });

  $('si-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    const value = idInput.value.trim();
    if (!value) { err(idInput.getAttribute('aria-label') || 'Enter your email.'); idInput.focus(); return; }
    busy(e.target, true);
    try {
      if (!value.includes('@')) {
        await call('/sign-in', { identifier: value, password: $('si-pass').value });
        return done();
      }
      email = value;
      const r = await call('/otp/send', { email, purpose: 'sign-in' });
      const sent = $('si-sent');
      sent.textContent = (sent.getAttribute('data-template') || '').replace('{email}', email);
      if (r.devCode) { const d = $('si-dev'); d.textContent = `Dev server only — your code is ${r.devCode}`; d.hidden = false; }
      e.target.hidden = true;
      $('si-verify').hidden = false;
      $('si-code').focus();
    } catch (ex) {
      err(ex.message);
    }
    busy(e.target, false);
  });

  $('si-verify').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    busy(e.target, true);
    try {
      await call('/otp/verify', { email, code: $('si-code').value });
      return done();
    } catch (ex) {
      err(ex.message);
    }
    busy(e.target, false);
  });
}());
