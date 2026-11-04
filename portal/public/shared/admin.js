/* Hub admin (/admin): sign in, then edit the tiles, the announcement banner,
   and read the contact inbox. Talks to /admin/api/* with the session's
   CSRF token. A file, not an inline script, so the hub's CSP holds. */
(function () {
  'use strict';
  const K = window.Kesari;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let csrf = null;

  async function call(method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, data });
    return data;
  }

  /* ---- sign in ---- */
  const form = document.querySelector('[data-admin-signin]');
  if (form) {
    call('GET', '/admin/api/auth/session').then((s) => { csrf = s.csrf; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('a-err');
      const btn = form.querySelector('button');
      err.textContent = '';
      btn.setAttribute('aria-busy', 'true');
      try {
        await call('POST', '/admin/api/auth/sign-in', { identifier: form.querySelector('#a-email').value, password: form.querySelector('#a-pass').value });
        location.reload();
      } catch (ex) {
        err.textContent = ex.message;
        form.querySelector('#a-pass').setAttribute('aria-invalid', 'true');
        btn.removeAttribute('aria-busy');
      }
    });
    return;
  }

  /* ---- dashboard ---- */
  const root = document.getElementById('admin-root');
  if (!root) return;
  const fmt = (v) => (K && v ? K.formatDateTime(String(v).replace(' ', 'T').replace(/\+00$/, 'Z')) : esc(v || ''));

  function render(state) {
    const tiles = state.tiles.map((t) => `<tr data-key="${esc(t.key)}">
      <td data-label="Order"><input class="k-input" name="sort_order" type="number" value="${esc(t.sort_order)}" aria-label="Order of ${esc(t.name)}" style="max-width:90px"></td>
      <td data-label="Tile"><input class="k-input" name="name" value="${esc(t.name)}" aria-label="Name"><input class="k-input" name="href" value="${esc(t.href)}" aria-label="Link of ${esc(t.name)}" style="margin-top:6px"></td>
      <td data-label="Text"><textarea class="k-textarea" name="benefit_en" aria-label="English text of ${esc(t.name)}">${esc(t.benefit_en)}</textarea>
        <textarea class="k-textarea" name="benefit_mr" lang="mr" aria-label="Marathi text of ${esc(t.name)}" style="margin-top:6px">${esc(t.benefit_mr)}</textarea>
        <textarea class="k-textarea" name="benefit_hi" lang="hi" aria-label="Hindi text of ${esc(t.name)}" style="margin-top:6px">${esc(t.benefit_hi)}</textarea></td>
      <td data-label="Status"><select class="k-select" name="status" aria-label="Status of ${esc(t.name)}">${state.statuses.map((s) => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <label class="k-check"><input type="checkbox" name="visible"${t.visible ? ' checked' : ''}> Visible</label>
        <label class="k-check"><input type="checkbox" name="external"${t.external ? ' checked' : ''}> New window</label></td></tr>`).join('');
    const a = state.announcement || {};
    const msgs = state.messages.length ? state.messages.map((m) => `<tr>
      <td data-label="When">${fmt(m.created_at)}</td><td data-label="From">${esc(m.name)}<br><span class="k-muted">${esc(m.email || '')} ${esc(m.mobile || '')}</span></td>
      <td data-label="About"><span class="k-chip k-chip--plain">${esc(m.topic)}</span></td><td data-label="Message">${esc(m.message)}</td>
      <td data-label="Status"><select class="k-select" data-msg="${esc(m.id)}" aria-label="Status of the message from ${esc(m.name)}">${['new', 'read', 'closed'].map((s) => `<option${s === m.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')
      : '<tr><td colspan="5"><div class="k-empty"><h3>No messages yet</h3><p>Messages from the contact page appear here.</p></div></td></tr>';
    root.innerHTML = `
<section class="k-card"><h2>Project tiles</h2><p class="k-muted">What the home page shows, in this order.</p>
  <form data-tiles><table class="k-table k-table--stack"><thead><tr><th>Order</th><th>Tile and link</th><th>Text (English, मराठी, हिंदी)</th><th>Status</th></tr></thead><tbody>${tiles}</tbody></table>
  <p><button class="k-btn k-btn--brand" type="submit">Save tiles</button></p></form></section>
<section class="k-card"><h2>Announcement banner</h2><p class="k-muted">One line across the top of the home page. Leave the English text empty to remove it.</p>
  <form data-announce class="k-stack">
   <div class="k-field"><label class="k-label" for="an-en">Message (English)</label><input class="k-input" id="an-en" name="message_en" maxlength="300" value="${esc(a.message_en)}"></div>
   <div class="k-field"><label class="k-label" for="an-mr">Message (मराठी)</label><input class="k-input" id="an-mr" lang="mr" name="message_mr" maxlength="300" value="${esc(a.message_mr)}"></div>
   <div class="k-field"><label class="k-label" for="an-hi">Message (हिंदी)</label><input class="k-input" id="an-hi" lang="hi" name="message_hi" maxlength="300" value="${esc(a.message_hi)}"></div>
   <div class="k-field"><label class="k-label" for="an-link">Link (optional)</label><input class="k-input" id="an-link" name="link" value="${esc(a.link)}" placeholder="/ladwani/"></div>
   <div class="k-field"><label class="k-label" for="an-kind">Style</label><select class="k-select" id="an-kind" name="kind">${state.kinds.map((k) => `<option${k === a.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
   <label class="k-check"><input type="checkbox" name="active"${a.active ? ' checked' : ''}> Show it now</label>
   <button class="k-btn k-btn--brand" type="submit">Save banner</button></form></section>
<section class="k-card"><h2>Contact messages</h2><table class="k-table k-table--stack"><thead><tr><th>When (IST)</th><th>From</th><th>About</th><th>Message</th><th>Status</th></tr></thead><tbody>${msgs}</tbody></table></section>`;

    root.querySelector('[data-tiles]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rows = [...root.querySelectorAll('[data-tiles] tbody tr')].map((tr) => {
        const v = (n) => tr.querySelector(`[name="${n}"]`);
        return { key: tr.dataset.key, name: v('name').value, href: v('href').value, benefit_en: v('benefit_en').value, benefit_mr: v('benefit_mr').value,
          benefit_hi: v('benefit_hi').value, status: v('status').value, sort_order: Number(v('sort_order').value), visible: v('visible').checked, external: v('external').checked };
      });
      try { await call('PUT', '/admin/api/tiles', { tiles: rows }); K.toast('Tiles saved', { kind: 'success' }); } catch (ex) { K.toast(ex.message, { kind: 'danger' }); }
    });
    root.querySelector('[data-announce]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = Object.fromEntries(['message_en', 'message_mr', 'message_hi', 'link', 'kind'].map((n) => [n, f.elements[n].value]));
      body.active = f.elements.active.checked;
      try { await call('PUT', '/admin/api/announcement', body); K.toast('Banner saved', { kind: 'success' }); } catch (ex) { K.toast(ex.message, { kind: 'danger' }); }
    });
    root.querySelectorAll('[data-msg]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await call('POST', `/admin/api/messages/${sel.dataset.msg}`, { status: sel.value }); K.toast('Saved'); } catch (ex) { K.toast(ex.message, { kind: 'danger' }); }
    }));
  }

  call('GET', '/admin/api/state').then((state) => { csrf = state.csrf; render(state); })
    .catch((ex) => { root.innerHTML = `<div class="k-banner k-banner--danger" role="alert"><p>${esc(ex.message)}</p></div>`; });
})();
