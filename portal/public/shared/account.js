/**
 * My projects and access (/account). The hub knows nobody: every project
 * signs its own people in. So this page asks each project's own "me"
 * endpoint from the browser, which sends that project's own cookie (each is
 * scoped to the project's path), and fills in its row:
 *   signed in  -> "Signed in as NAME", the access level, "Open NAME"
 *   waiting    -> "Waiting for approval" (LadWani's operator check)
 *   signed out -> "Not signed in on this device", Sign in + Request access
 *   no answer  -> "Could not check", Try again
 * Nothing read here is stored or sent anywhere else.
 */
(function () {
  'use strict';
  const root = document.querySelector('[data-account]');
  if (!root) return;
  let W = {};
  try { W = JSON.parse(root.getAttribute('data-words') || '{}'); } catch { W = {}; }
  const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const chip = (cls, text) => el('span', `k-chip ${cls}`, text);
  const link = (cls, href, text) => { const a = el('a', cls, text); a.href = href; return a; };

  /** The level to show: a project's own role code, in words the visitor reads. */
  function levelOf(user) {
    const codes = [].concat(user.roles || [], user.role ? [user.role] : []).filter(Boolean);
    const words = codes.map((c) => (W.roles && W.roles[c]) || String(c).replace(/_/g, ' ').toLowerCase());
    return [...new Set(words)].join(', ');
  }

  function render(row, state, me) {
    const status = row.querySelector('[data-account-status]');
    const note = row.querySelector('[data-account-note]');
    const action = row.querySelector('[data-account-action]');
    const name = row.getAttribute('data-name');
    status.replaceChildren(); action.replaceChildren();
    if (state === 'in') {
      const user = me.user;
      const display = user.name || user.email || user.mobile || '';
      // LadWani has two steps before a member is in: confirming the email or
      // mobile (account status PENDING), then an operator checking the ID proof
      // (verification). Each shows where the person stands and where to go next.
      if (row.hasAttribute('data-pending')) {
        const step = String(user.status || '').toUpperCase() === 'PENDING' ? ['k-chip--soon', W.confirm, W.confirmNote, row.getAttribute('data-verify')]
          : { UNDER_REVIEW: ['k-chip--soon', W.pending, W.pendingNote], NEEDS_ATTENTION: ['k-chip--danger', W.attention, W.attentionNote],
            NOT_SUBMITTED: ['k-chip--soon', W.finish, W.finishNote] }[String(user.verification || '').toUpperCase()];
        if (step) {
          status.append(chip(step[0], step[1]));
          if (display) status.append(el('span', 'k-small', fill(W.as, { name: display })));
          note.textContent = step[2];
          action.append(link('k-btn k-btn--secondary', step[3] || row.getAttribute('data-pending'), W.seeStatus));
          return;
        }
      }
      status.append(chip('k-chip--live', W.signedIn));
      if (display) status.append(el('span', 'k-small', fill(W.as, { name: display })));
      const level = levelOf(user);
      if (level) status.append(chip('k-chip--accent', fill(W.level, { role: level })));
      action.append(link('k-btn k-btn--soft', row.getAttribute('data-open'), fill(W.open, { name })));
    } else if (state === 'out') {
      status.append(chip('', W.signedOut));
      action.append(link('k-btn k-btn--secondary', row.getAttribute('data-signin'), W.signIn));
      action.append(link('k-link-arrow hub-req-link', row.getAttribute('data-request'), W.request));
    } else {
      status.append(chip('k-chip--danger', W.error));
      note.textContent = W.errorNote;
      const again = el('button', 'k-btn k-btn--secondary', W.retry);
      again.type = 'button';
      again.addEventListener('click', () => check(row));
      action.append(again);
    }
  }

  function check(row) {
    const status = row.querySelector('[data-account-status]');
    status.replaceChildren(el('span', 'k-skel k-skel--line hub-skel-chip'), el('span', 'k-sr-only', W.checking));
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
    fetch(row.getAttribute('data-me'), { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then((r) => {
        // Signed out is 200 with user:null (LadWani, TaskList) or 401 (Education).
        if (r.status === 401) return { user: null };
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((me) => render(row, me && me.user ? 'in' : 'out', me))
      .catch(() => render(row, 'error'))
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  root.querySelectorAll('[data-account-row]').forEach(check);
})();
