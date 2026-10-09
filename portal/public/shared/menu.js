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
 *     pages the server builds. The ATIP viewer needs this: its
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
   */
  const TABS = [
    { name: 'Milk & Dairy Products', path: '/milk/',              icon: '🥛', tagline: 'Dairy and bakery ordering' },
    { name: 'Education',             path: '/edu/',               icon: '🎓', tagline: 'School and student governance' },
    { name: 'Global Warming',        path: '/global-warming/',    icon: '🌍', tagline: 'Climate facts and local impact' },
    { name: 'LadWani',               path: '/ladwani/',           icon: '👪', tagline: 'Family and community portal' },
    { name: 'TaskList',              path: '/tasklist/',          icon: '✅', tagline: 'Projects, tasks and status updates' },
    { name: 'ATIP',                  path: '/atip/',              icon: '📈', tagline: 'Trading intelligence, view only' },
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
   * /tasklist/api/tasks — still lights up its own tab.
   */
  function activeTabPath(pathname) {
    const path = String(pathname || '/');
    let match = '/';
    for (const tab of TABS) {
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
    const env = opts.env || 'prod';
    const active = activeTabPath(opts.pathname || '/');
    const isHome = active === '/';
    const envPill = env === 'prod' ? '' : ` <span class="bk-env">${escapeHtml(env)}</span>`;

    const items = TABS.map((tab) => {
      const current = tab.path === active ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(tab.path)}"${current}>${escapeHtml(tab.name)}</a></li>`;
    }).join('');

    // The brand doubles as the Home link, and carries aria-current on the
    // welcome page itself.
    return `${styleTag()}
<nav class="bk-menu" aria-label="bkesari projects">
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
    </span>
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
      env: resolveEnv(
        d.location ? d.location.hostname : '',
        // A server-rendered page can pin its own tier before this runs.
        typeof window !== 'undefined' ? window.BKESARI_ENV : '',
      ),
    });
    const slot = d.querySelector('[data-bkesari-menu]');
    if (slot) { slot.innerHTML = html; return; }
    const holder = d.createElement('div');
    holder.innerHTML = html;
    while (holder.firstChild) d.body.insertBefore(holder.firstChild, d.body.firstChild);
  }

  function autoMount() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mount(document), { once: true });
    } else {
      mount(document);
    }
  }

  return { DOMAIN, TABS, escapeHtml, resolveEnv, activeTabPath, styleTag, renderHtml, mount, autoMount };
});
