/* TaskList sign-in pages: sign-in, sign-up, forgot-password, reset-password,
   verify. One page; the path picks the mode. Talks only to TaskList's own
   /tasklist/api/auth, with the CSRF token that API hands out. */
(function () {
  'use strict';
  const K = window.Kesari;
  const t = (k, v) => K.t(k, v);
  const API = '/tasklist/api/auth';
  const $ = (id) => document.getElementById(id);
  const mode = (location.pathname.replace(/\/+$/, '').split('/').pop()) || 'sign-in';
  const params = new URLSearchParams(location.search);
  const next = (() => { const n = params.get('next') || ''; return /^\/tasklist\/[^/\\]/.test(n) || n === '/tasklist/' ? n : '/tasklist/'; })();
  let csrf = null;
  // Where the code goes: { email } by default (SMS is on hold), or { mobile }.
  let target = null;
  let channel = 'email';

  async function call(path, body) {
    if (!csrf) await session();
    const r = await fetch(API + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf || '' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status, code: data.code });
    if (data.csrf) csrf = data.csrf;
    return data;
  }
  async function session() {
    const r = await fetch(`${API}/session`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const s = await r.json();
    csrf = s.csrf;
    return s;
  }

  /* ---- mode ---- */
  document.querySelectorAll('[data-mode]').forEach((el) => {
    const modes = el.getAttribute('data-mode').split(' ');
    el.hidden = !modes.includes(mode);
  });
  const titles = { 'sign-in': 'auth.signInTitle', 'sign-up': 'auth.signUpTitle', 'forgot-password': 'auth.forgotTitle', 'reset-password': 'auth.resetTitle', verify: 'auth.verifyTitle' };
  const h1 = $('auth-title');
  h1.setAttribute('data-i18n', titles[mode] || 'auth.signInTitle');
  h1.textContent = t(titles[mode] || 'auth.signInTitle');
  document.title = `${h1.textContent} — TaskList`;
  K.refresh(document);
  if (mode === 'sign-up') $('password').setAttribute('autocomplete', 'new-password');

  const showError = (msg) => { const b = $('auth-error'); b.innerHTML = `<p>${K.escapeHtml(msg)}</p>`; b.hidden = !msg; if (msg) b.focus && b.setAttribute('tabindex', '-1'); };
  const fieldError = (input, errEl, msg) => {
    $(errEl).textContent = msg || '';
    if (input) { if (msg) $(input).setAttribute('aria-invalid', 'true'); else $(input).removeAttribute('aria-invalid'); if (msg) $(input).focus(); }
    return !msg;
  };
  const busy = (form, on) => { const b = form.querySelector('button[type=submit]:not([hidden])'); if (b) { if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); } };
  const devNote = (html) => { const d = $('dev-note'); d.innerHTML = html; d.hidden = !html; };
  const done = () => { location.href = next; };

  // Already signed in? Straight to the app.
  session().then((s) => {
    if (s.user && (mode === 'sign-in' || mode === 'sign-up')) done();
    // A mobile number is offered only once an SMS provider is set up.
    if (s.smsLive) $('switch-channel').hidden = false;
  }).catch(() => {});

  /* ---- tabs (arrow keys move between them) ---- */
  const tabs = [$('tab-otp'), $('tab-pw')];
  function select(tab) {
    tabs.forEach((x) => {
      const on = x === tab;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      $(x.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; select(n); n.focus(); }
    });
  });
  if (params.get('method') === 'password') select(tabs[1]);

  /* ---- one-time code: by email, or by SMS when it is live ---- */
  const digits = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return d; };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function useChannel(c) {
    channel = c;
    $('email-field').hidden = c !== 'email';
    $('mobile-field').hidden = c !== 'mobile';
    $('code-email').required = c === 'email';
    $('mobile').required = c === 'mobile';
    const sw = $('switch-channel');
    sw.setAttribute('data-i18n', c === 'email' ? 'auth.useMobile' : 'auth.useEmail');
    sw.textContent = t(c === 'email' ? 'auth.useMobile' : 'auth.useEmail');
    const ch = $('change');
    ch.setAttribute('data-i18n', c === 'email' ? 'auth.changeEmail' : 'auth.changeNumber');
    ch.textContent = t(c === 'email' ? 'auth.changeEmail' : 'auth.changeNumber');
  }
  $('switch-channel').addEventListener('click', () => { useChannel(channel === 'email' ? 'mobile' : 'email'); $(channel === 'email' ? 'code-email' : 'mobile').focus(); });
  $('otp-send').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    let to;
    if (channel === 'email') {
      const v = $('code-email').value.trim();
      if (!fieldError('code-email', 'code-email-err', EMAIL.test(v) ? '' : t('auth.err.email'))) return;
      to = { email: v };
    } else {
      const m = digits($('mobile').value);
      if (!fieldError('mobile', 'mobile-err', /^[6-9]\d{9}$/.test(m) ? '' : t('auth.err.mobile'))) return;
      to = { mobile: m };
    }
    busy(e.target, true);
    try {
      const r = await call('/otp/send', { ...to, purpose: mode === 'sign-up' ? 'sign-up' : 'sign-in' });
      target = to;
      $('otp-send').hidden = true;
      $('otp-verify').hidden = false;
      $('code-sent').textContent = to.email
        ? t('auth.codeSentEmail', { email: to.email })
        : t('auth.codeSent', { mobile: `${to.mobile.slice(0, 5)} ${to.mobile.slice(5)}` });
      devNote(r.devCode ? K.escapeHtml(t('auth.devCode', { code: r.devCode })) : '');
      const first = document.querySelector('.k-otp input');
      if (first) first.focus();
    } catch (ex) { showError(ex.message); } finally { busy(e.target, false); }
  });
  $('otp-verify').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const code = (document.querySelector('.k-otp input[type=hidden]') || {}).value || '';
    if (!fieldError(null, 'code-err', code.length === 6 ? '' : t('auth.err.code'))) return;
    busy(e.target, true);
    try {
      await call('/otp/verify', { ...target, code, name: $('otp-name').value });
      done();
    } catch (ex) { fieldError(null, 'code-err', ex.message); } finally { busy(e.target, false); }
  });
  document.querySelector('.k-otp').addEventListener('kesari:otp', (e) => { if (e.detail.complete) $('otp-verify').requestSubmit(); });
  $('resend').addEventListener('click', () => { $('otp-verify').hidden = true; $('otp-send').hidden = false; $('otp-send').requestSubmit(); });
  $('change').addEventListener('click', () => { $('otp-verify').hidden = true; $('otp-send').hidden = false; devNote(''); $(channel === 'email' ? 'code-email' : 'mobile').focus(); });

  /* ---- email + password ---- */
  $('pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const id = $('identifier').value.trim();
    const pw = $('password').value;
    let ok = true;
    if (mode === 'sign-up') ok = fieldError('pw-name', 'pw-name-err', $('pw-name').value.trim() ? '' : t('auth.err.name')) && ok;
    ok = fieldError('identifier', 'identifier-err', id && (mode === 'sign-in' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) ? '' : t(mode === 'sign-up' ? 'auth.err.email' : 'auth.err.mobile')) && ok;
    ok = fieldError('password', 'password-err', pw ? '' : t('auth.err.password')) && ok;
    if (!ok) return;
    busy(e.target, true);
    try {
      if (mode === 'sign-up') {
        const r = await call('/sign-up', { name: $('pw-name').value, email: id, password: pw });
        if (r.devVerifyLink) { devNote(`${K.escapeHtml(t('auth.devLink'))} <a href="${K.escapeHtml(r.devVerifyLink)}">${K.escapeHtml(r.devVerifyLink)}</a>`); setTimeout(done, 4000); return; }
      } else {
        await call('/sign-in', { identifier: id, password: pw });
      }
      done();
    } catch (ex) {
      if (ex.code === 'password' || ex.code === 'credentials' || ex.code === 'locked') fieldError('password', 'password-err', ex.message);
      else showError(ex.message);
    } finally { busy(e.target, false); }
  });

  /* ---- forgot / reset / verify ---- */
  $('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('forgot-email').value.trim();
    if (!fieldError('forgot-email', 'forgot-err', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : t('auth.err.email'))) return;
    busy(e.target, true);
    try {
      const r = await call('/password/forgot', { email });
      e.target.outerHTML = `<div class="k-banner k-banner--success" role="status"><p>${K.escapeHtml(t('auth.linkSent'))}</p></div>`;
      if (r.devResetLink) devNote(`${K.escapeHtml(t('auth.devLink'))} <a href="${K.escapeHtml(r.devResetLink)}">${K.escapeHtml(r.devResetLink)}</a>`);
    } catch (ex) { showError(ex.message); busy(e.target, false); }
  });
  $('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('new-password').value;
    if (!fieldError('new-password', 'new-err', pw ? '' : t('auth.err.password'))) return;
    busy(e.target, true);
    try {
      await call('/password/reset', { token: params.get('token'), password: pw });
      e.target.outerHTML = `<div class="k-banner k-banner--success" role="status"><p>${K.escapeHtml(t('auth.resetDone'))}</p></div><a class="k-btn" href="/tasklist/sign-in?method=password">${K.escapeHtml(t('auth.signIn'))}</a>`;
    } catch (ex) { fieldError('new-password', 'new-err', ex.message); busy(e.target, false); }
  });
  if (mode === 'verify') {
    call('/verify-email', { token: params.get('token') })
      .then(() => { $('verify-msg').textContent = t('auth.verifyDone'); })
      .catch(() => { $('verify-msg').textContent = t('auth.verifyFail'); });
  }
  h1.focus();
})();
