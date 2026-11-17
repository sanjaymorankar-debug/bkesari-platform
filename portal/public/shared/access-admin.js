/* The bkesari admin's access page (/admin/access, D-039): approve (with the
   role), decline (with a reason), change a role, revoke, grant directly,
   suspend or restore a person. Every action posts JSON to
   /hub/api/admin/access/* with the session's CSRF token, then reloads. */
(function () {
  'use strict';
  const csrf = (document.querySelector('meta[name="bk-csrf"]') || {}).content || '';
  const err = (msg) => { const e = document.getElementById('ax-err'); if (e) e.textContent = msg || ''; };
  async function post(url, body) {
    const r = await fetch(`/hub/api/admin/access${url}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }
  async function act(btn, url, body) {
    err('');
    btn.disabled = true;
    try {
      await post(url, body);
      location.reload();
    } catch (ex) {
      err(ex.message);
      btn.disabled = false;
    }
  }

  // Granting: the role box follows the chosen project's first role.
  document.querySelectorAll('[data-grant-project]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const roles = (sel.selectedOptions[0].getAttribute('data-roles') || '').split(',');
      const box = sel.closest('tr').querySelector('[data-grant-new-role]');
      if (box) box.value = roles[0] || '';
    });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const reqRow = btn.closest('[data-request]');
    const grantRow = btn.closest('[data-grant]');
    const userRow = btn.closest('[data-user]');
    if (btn.hasAttribute('data-approve') && reqRow) {
      return act(btn, `/requests/${reqRow.getAttribute('data-request')}/approve`, { role: reqRow.querySelector('[data-role]').value });
    }
    if (btn.hasAttribute('data-decline') && reqRow) {
      const reason = reqRow.querySelector('[data-reason]').value.trim();
      if (!reason) { err('A reason is required to decline.'); reqRow.querySelector('[data-reason]').focus(); return undefined; }
      return act(btn, `/requests/${reqRow.getAttribute('data-request')}/decline`, { reason });
    }
    if (btn.hasAttribute('data-change-role') && grantRow) {
      return act(btn, `/grants/${grantRow.getAttribute('data-grant')}/role`, { role: grantRow.querySelector('[data-grant-role]').value });
    }
    if (btn.hasAttribute('data-revoke') && grantRow) {
      const reason = window.prompt('Reason for removing this access (sent to the person):', '');
      if (reason === null) return undefined;
      return act(btn, `/grants/${grantRow.getAttribute('data-grant')}/revoke`, { reason });
    }
    if (btn.hasAttribute('data-grant-btn') && userRow) {
      return act(btn, `/users/${userRow.getAttribute('data-user')}/grant`, {
        project: userRow.querySelector('[data-grant-project]').value, role: userRow.querySelector('[data-grant-new-role]').value.trim(),
      });
    }
    if (btn.hasAttribute('data-status') && userRow) {
      const status = btn.getAttribute('data-status');
      if (status === 'suspended' && !window.confirm('Suspend this person? All their sessions end now.')) return undefined;
      return act(btn, `/users/${userRow.getAttribute('data-user')}/status`, { status });
    }
    return undefined;
  });
}());
