/* The person's side of project access (D-039): the request form on
   /access/request and the sign-out button on /account. The CSRF token is the
   bkesari ID session's, in <meta name="bk-csrf">. */
(function () {
  'use strict';
  const csrf = (document.querySelector('meta[name="bk-csrf"]') || {}).content || '';
  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }

  const form = document.querySelector('[data-access-request]');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('ar-err');
      const btn = form.querySelector('button[type=submit]');
      err.textContent = '';
      btn.setAttribute('aria-busy', 'true');
      try {
        await post('/hub/api/access/requests', {
          project: form.getAttribute('data-access-request'),
          role: document.getElementById('ar-role').value,
          note: document.getElementById('ar-note').value,
        });
        location.href = '/account';
      } catch (ex) {
        err.textContent = ex.message;
        btn.removeAttribute('aria-busy');
      }
    });
  }

  const out = document.querySelector('[data-signout-btn]');
  if (out) {
    out.addEventListener('click', async () => {
      await post('/account/api/auth/sign-out', {}).catch(() => {});
      location.href = '/';
    });
  }
}());
