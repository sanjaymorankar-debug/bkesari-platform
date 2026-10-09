/**
 * The bkesari.com top menu — the single source of truth for the tab bar.
 *
 * ONE PLACE TO EDIT. Adding, renaming or reordering a tab means editing `TABS`
 * below and nothing else, in any project.
 *
 * It loads in two environments on purpose:
 *
 *   Browser — `<script src="/shared/menu.js" defer></script>`. On load it
 *     injects the styles and the bar at the top of <body>, so a page needs that
 *     one tag and no markup of its own.
 *
 *   Node — `require('./public/shared/menu.js')` hands back `renderHtml()`, for
 *     pages the server builds. A page with a strict policy needs this: its
 *     Content-Security-Policy allows inline scripts but not `'self'`, so an
 *     external <script> there would be blocked. Server-rendering the same
 *     markup keeps that page's policy untouched and still shows the same bar.
 *
 * The menu needs NO JavaScript to work. The mobile hamburger is a checkbox and
 * its label, toggled through CSS, which is why the same markup is safe under a
 * strict CSP and why the bar still opens if scripts fail.
 *
 * A <details>/<summary> disclosure would read better, and was tried first, but a
 * closed <details> does not render its non-summary children at all — no CSS can
 * reveal them, so the tabs were invisible on desktop, where they must always
 * show. The checkbox is the one disclosure whose open state CSS can reach.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node: server-side rendering
  } else {
    root.BKESARI_MENU = api; // browser: self-mounting
    api.autoMount();
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** Apex domain. Tiers are subdomains of it: dev., test., and bare for production. */
  const DOMAIN = 'bkesari.com';

  /**
   * The tabs, in the order they appear. `path` is deliberately a path and not a
   * URL: every project is served under one origin per tier, so the same link
   * works on dev, test and production without substitution.
   *
   * `feature` names the subscription that opens a tab. With central login on,
   * the bar asks /auth/api/menu which of these the visitor gets; without it,
   * or if that call fails, every tab below is shown.
   *
   * This file is public, so it lists only what anyone may know exists. The
   * owner-only tab is added by the server for the owner and is never written
   * here (portal/auth/menu-tabs.js).
   */
  const TABS = [
    { name: 'Milk & Dairy Products', path: '/milk/',              icon: '🥛', tagline: 'Dairy and bakery ordering', feature: 'MILK_DAIRY' },
    { name: 'Education',             path: '/edu/',               icon: '🎓', tagline: 'School and student governance', feature: 'EDUCATION' },
    { name: 'Global Warming',        path: '/global-warming/',    icon: '🌍', tagline: 'Climate facts and local impact' },
    { name: 'LadWani',               path: '/ladwani/',           icon: '👪', tagline: 'Family and community portal', feature: 'LADWANI' },
    { name: 'TaskList',              path: '/tasks/',             icon: '✅', tagline: 'Projects, tasks and status updates', feature: 'TASKLIST' },
    { name: 'Driving Simulator',     path: '/driving-simulator/', icon: '🚗', tagline: 'Driver training simulator' },
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /**
   * Which tier this page is being served as: 'dev' | 'test' | 'prod'.
   *
   * Taken from the hostname, so one build serves every tier. An explicit
   * override wins, which is how a server passes its own APP_ENV in.
   */
  function resolveEnv(hostname, override) {
    const explicit = String(override || '').trim().toLowerCase();
    if (explicit === 'dev' || explicit === 'development') return 'dev';
    if (explicit === 'test' || explicit === 'staging') return 'test';
    if (explicit === 'prod' || explicit === 'production') return 'prod';

    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'dev';
    if (host.startsWith('dev.')) return 'dev';
    if (host.startsWith('test.')) return 'test';
    return 'prod';
  }

  /**
   * The tab a path belongs to, by longest matching prefix, or '/' for home.
   *
   * Prefix rather than equality so a page deep inside a project — /milk/cart,
   * /tasks/42 — still lights up its own tab.
   */
  function activeTabPath(pathname, tabs) {
    const path = String(pathname || '/');
    let match = '/';
    for (const tab of tabs || TABS) {
      // Compare without the trailing slash so /milk and /milk/ both match.
      const base = tab.path.replace(/\/$/, '');
      if ((path === base || path.startsWith(base + '/')) && base.length > match.length) {
        match = tab.path;
      }
    }
    return match;
  }

  /**
   * Styles for the bar. Scoped under `.bk-menu` — the tokens are declared on the
   * bar itself rather than on :root, so including this cannot change the colours
   * of the page that hosts it.
   */
  function styleTag() {
    return `<style id="bk-menu-style">
.bk-menu{--bk-surface:#fff;--bk-ink:#1b1d24;--bk-ink-soft:#5f6472;--bk-line:#e6e2d9;
  --bk-accent:#e0761f;--bk-accent-soft:#fdf0e3;--bk-accent-dark:#b85a0e;
  font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bk-surface);
  color:var(--bk-ink);border-bottom:1px solid var(--bk-line);position:sticky;top:0;z-index:9000}
@media (prefers-color-scheme:dark){.bk-menu{--bk-surface:#1d1f26;--bk-ink:#ecedf1;--bk-ink-soft:#a4a8b4;
  --bk-line:#2c2f38;--bk-accent:#f08a34;--bk-accent-soft:#3a2715;--bk-accent-dark:#ffb273}}
.bk-menu *{box-sizing:border-box}
.bk-menu-inner{max-width:1080px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.bk-brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px;letter-spacing:-.02em;
  color:var(--bk-ink);text-decoration:none;flex:none}
.bk-brand-dot{width:11px;height:11px;border-radius:50%;background:var(--bk-accent);flex:none}
.bk-env{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  background:var(--bk-accent-soft);color:var(--bk-accent-dark);padding:2px 7px;border-radius:20px}
.bk-nav-group{margin-left:auto;min-width:0;display:flex;align-items:center}
/* Visually hidden but still focusable, so the hamburger is keyboard-operable. */
.bk-toggle{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}
.bk-burger{display:none}
.bk-tabs{display:flex;gap:2px;flex-wrap:wrap;justify-content:flex-end;margin:0;padding:0;list-style:none}
.bk-tabs a{display:block;color:var(--bk-ink-soft);text-decoration:none;font-size:13.5px;font-weight:600;
  padding:7px 10px;border-radius:8px;white-space:nowrap}
.bk-tabs a:hover{background:var(--bk-accent-soft);color:var(--bk-accent-dark)}
.bk-tabs a:focus-visible{outline:2px solid var(--bk-accent);outline-offset:1px}
.bk-account{margin-left:6px;flex:none;font-size:13px;font-weight:600;color:var(--bk-ink-soft);text-decoration:none;
  padding:6px 10px;border:1px solid var(--bk-line);border-radius:8px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.bk-account:hover{color:var(--bk-accent-dark);border-color:var(--bk-accent)}
.bk-tabs a[aria-current="page"]{color:var(--bk-accent-dark);background:var(--bk-accent-soft);
  box-shadow:inset 0 -2px 0 var(--bk-accent)}
/* Mobile: the disclosure collapses into a hamburger. No JavaScript involved. */
@media (max-width:860px){
  .bk-burger{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13.5px;font-weight:600;
    color:var(--bk-ink-soft);padding:7px 10px;border-radius:8px;border:1px solid var(--bk-line);
    user-select:none}
  .bk-toggle:focus-visible+.bk-burger{outline:2px solid var(--bk-accent);outline-offset:1px}
  .bk-toggle:checked+.bk-burger{background:var(--bk-accent-soft);color:var(--bk-accent-dark)}
  .bk-bars{width:16px;height:11px;position:relative;flex:none}
  .bk-bars span{position:absolute;left:0;right:0;height:2px;border-radius:2px;background:currentColor}
  .bk-bars span:nth-child(1){top:0}.bk-bars span:nth-child(2){top:4.5px}.bk-bars span:nth-child(3){top:9px}
  .bk-tabs{display:none;position:absolute;right:16px;left:16px;top:100%;margin-top:-2px;
    flex-direction:column;flex-wrap:nowrap;background:var(--bk-surface);border:1px solid var(--bk-line);
    border-radius:12px;padding:6px;box-shadow:0 10px 30px rgba(20,24,33,.16)}
  .bk-toggle:checked~.bk-tabs{display:flex}
  .bk-tabs a{padding:10px 12px;font-size:15px;white-space:normal}
}
@media print{.bk-menu{display:none}}
</style>`;
  }

  /**
   * The bar's markup. Used by the browser mount and by the server alike, so the
   * two can never drift apart.
   */
  function renderHtml(options) {
    const opts = options || {};
    return `${styleTag()}\n${renderNav(opts)}`;
  }

  /**
   * Just the <nav>, without the stylesheet: what a refresh swaps in.
   *
   * `tabs` replaces TABS (the server's answer for this visitor). `account`,
   * when given, is the sign-in / account link at the end of the bar.
   */
  function renderNav(opts) {
    const env = opts.env || 'prod';
    const tabs = Array.isArray(opts.tabs) ? opts.tabs : TABS;
    const active = activeTabPath(opts.pathname || '/', tabs);
    const isHome = active === '/';
    const envPill = env === 'prod' ? '' : ` <span class="bk-env">${escapeHtml(env)}</span>`;

    const items = tabs.map((tab) => {
      const current = tab.path === active ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(tab.path)}"${current}>${escapeHtml(tab.name)}</a></li>`;
    }).join('');
    const account = opts.account && opts.account.href
      ? `<a class="bk-account" href="${escapeHtml(opts.account.href)}">${escapeHtml(opts.account.label || 'Account')}</a>`
      : '';

    // The brand doubles as the Home link, and carries aria-current on the
    // welcome page itself.
    return `<nav class="bk-menu" aria-label="bkesari projects">
  <div class="bk-menu-inner">
    <a class="bk-brand" href="/"${isHome ? ' aria-current="page"' : ''}>
      <span class="bk-brand-dot" aria-hidden="true"></span>bkesari${envPill}
    </a>
    <span class="bk-nav-group">
      <input class="bk-toggle" id="bk-menu-toggle" type="checkbox">
      <label class="bk-burger" for="bk-menu-toggle">
        <span class="bk-bars" aria-hidden="true"><span></span><span></span><span></span></span>Menu
      </label>
      <ul class="bk-tabs">${items}</ul>
    </span>${account}
  </div>
</nav>`;
  }

  /**
   * Browser entry point: puts the bar at the top of the page.
   *
   * Into `[data-bkesari-menu]` when the page marks a slot, otherwise as the
   * first thing in <body>. Idempotent, so a page that includes the script twice
   * does not get two bars.
   */
  function mount(doc) {
    const d = doc || document;
    if (d.getElementById('bk-menu-style')) return;
    const html = renderHtml({
      pathname: d.location ? d.location.pathname : '/',
      env: currentEnv(d),
    });
    const slot = d.querySelector('[data-bkesari-menu]');
    if (slot) {
      slot.innerHTML = html;
    } else {
      const holder = d.createElement('div');
      holder.innerHTML = html;
      while (holder.firstChild) d.body.insertBefore(holder.firstChild, d.body.firstChild);
    }
    personalise(d);
  }

  function currentEnv(d) {
    return resolveEnv(
      d.location ? d.location.hostname : '',
      // A server-rendered page can pin its own tier before this runs.
      typeof window !== 'undefined' ? window.BKESARI_ENV : '',
    );
  }

  /**
   * Asks the central login which tabs this visitor gets, and redraws the bar.
   *
   * The static bar is already on screen, so a slow, failed or absent answer
   * (central login off on this tier, a project on its own origin) leaves the
   * page exactly as it was. Hiding a tab here is presentation only: every
   * project refuses on the server whatever the bar shows.
   *
   * Fires `bkesari:menu` on the document with { tabs, account } either way,
   * so the welcome page can draw its cards from the same answer.
   */
  function personalise(d) {
    const done = (data) => {
      const detail = { tabs: (data && data.tabs) || TABS, account: (data && data.account) || null };
      api.current = detail;
      try { d.dispatchEvent(new CustomEvent('bkesari:menu', { detail })); } catch (e) { /* old browser */ }
    };
    if (typeof fetch !== 'function') return done(null);
    fetch('/auth/api/menu', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.tabs)) return done(null);
        const account = data.account && data.account.href === '/auth/login'
          ? { label: data.account.label, href: '/auth/login?return_to=' + encodeURIComponent(d.location.pathname + d.location.search) }
          : data.account;
        const nav = d.querySelector('nav.bk-menu');
        if (nav) {
          const holder = d.createElement('div');
          holder.innerHTML = renderNav({ pathname: d.location.pathname, env: currentEnv(d), tabs: data.tabs, account });
          nav.replaceWith(holder.firstElementChild);
        }
        done({ tabs: data.tabs, account });
      })
      .catch(() => done(null));
  }

  function autoMount() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mount(document), { once: true });
    } else {
      mount(document);
    }
  }

  const api = { DOMAIN, TABS, escapeHtml, resolveEnv, activeTabPath, styleTag, renderHtml, renderNav, mount, autoMount, current: null };
  return api;
});
