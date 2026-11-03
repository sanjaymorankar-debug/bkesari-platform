/**
 * The Kesari app shell — the header and footer every bkesari project shows.
 *
 * ONE PLACE TO EDIT. The projects, their paths, accents and icons are in
 * `TABS` below; the hub's tiles, the "All projects" switcher and every
 * project header read it.
 *
 * Header: bkesari logo (to the hub) · the project's name in its accent ·
 * "All projects" switcher · language · theme · the CURRENT project's account.
 * Footer: About, Privacy (DPDP Act 2023), Terms, Contact, © bkesari.com.
 *
 * It loads in two environments on purpose:
 *
 *   Browser — `<script src="/shared/menu.js" defer></script>`. It injects the
 *     styles, the header at the top of <body> (or into [data-bkesari-menu])
 *     and the footer at the end (or into [data-kesari-footer]).
 *
 *   Node — `require('./public/shared/menu.js')` hands back `renderHtml()`,
 *     for pages the server builds. The ATIP viewer needs this: its CSP allows
 *     inline scripts but not 'self', so the bar is server-rendered there.
 *
 * Works without JavaScript: the project switcher is a <details> disclosure
 * (its panel SHOULD be hidden until opened, unlike a tab bar), and the
 * language, theme and account controls carry `hidden` until the script
 * that drives them has run, so nothing inert is ever shown.
 *
 * Accounts are per project. The shell never knows who anyone is: a project
 * page names its own "me" endpoint (data-me-url on the slot, or
 * window.KESARI_SHELL.meUrl) and the shell shows what THAT project says.
 * Signing out of one project leaves every other project alone.
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

  const ICONS = {
    ladwani: '<path d="M12 3v6m0 0-5 4m5-4 5 4M7 13v4m10-4v4M5 21h4m6 0h4M12 9v12"/><circle cx="12" cy="3" r="1.5"/>',
    atip: '<path d="M3 20h18M5 16l4-5 4 3 6-8"/><path d="M15 6h4v4"/>',
    education: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
    tasklist: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    driving: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10.5h6M14.5 10.5h6M12 14.5V21"/>',
    environment: '<path d="M5 19c8 0 14-6 14-15C10 4 5 9 5 15c0 1.5.4 3 1 4"/><path d="M5 19c2-5 5-8 9-10"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    theme: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };

  /**
   * The projects, in the order they appear. `path` is deliberately a path and
   * not a URL: every project is served under one origin per tier, so the same
   * link works on dev, test and production without substitution.
   *
   * `key` matches data-project (accent) and the hub's tile table.
   */
  const TABS = [
    { key: 'ladwani',     name: 'LadWani',                  path: '/ladwani/',           icon: 'ladwani',     accent: '#7C2D12', tagline: 'Family trees and community, for every village' },
    { key: 'atip',        name: 'ATIP',                     path: '/ATIP/',              icon: 'atip',        accent: '#C2560A', tagline: 'Trading intelligence, view only', ownerOnly: true, external: true },
    { key: 'education',   name: 'Education',                path: '/edu/',               icon: 'education',   accent: '#0F766E', tagline: 'Learning, progress and school life in one place' },
    { key: 'tasklist',    name: 'TaskList',                 path: '/tasklist/',          icon: 'tasklist',    accent: '#4338CA', tagline: 'Capture a task in two taps; see today at a glance' },
    { key: 'driving',     name: 'Driving Simulator',        path: '/driving-simulator/', icon: 'driving',     accent: '#C2560A', tagline: 'Practise safe driving before the road' },
    { key: 'environment', name: 'Environmental Activities', path: '/environment/',       icon: 'environment', accent: '#15803D', tagline: 'Climate facts and what we can do locally' },
  ];

  /** Shell strings. English is the source; Marathi and Hindi follow it key for key. */
  const STRINGS = {
    en: {
      skip: 'Skip to content', projects: 'All projects', projectsHub: 'Open the bkesari home page',
      language: 'Language', theme: 'Theme', signIn: 'Sign in', signOut: 'Sign out',
      account: 'Account', signedInTo: 'Signed in to {project}', separate: 'This is a separate account for {project}.',
      about: 'About', privacy: 'Privacy', terms: 'Terms', contact: 'Contact', footerNote: 'Each project keeps its own account and data.',
      'tag.ladwani': 'Family trees and community, for every village',
      'tag.atip': 'Trading intelligence, view only',
      'tag.education': 'Learning, progress and school life in one place',
      'tag.tasklist': 'Capture a task in two taps; see today at a glance',
      'tag.driving': 'Practise safe driving before the road',
      'tag.environment': 'Climate facts and what we can do locally',
    },
    mr: {
      skip: 'मुख्य मजकुराकडे जा', projects: 'सर्व प्रकल्प', projectsHub: 'bkesari मुख्यपृष्ठ उघडा',
      language: 'भाषा', theme: 'थीम', signIn: 'साइन इन', signOut: 'साइन आउट',
      account: 'खाते', signedInTo: '{project} मध्ये साइन इन', separate: 'हे {project} साठी स्वतंत्र खाते आहे.',
      about: 'आमच्याविषयी', privacy: 'गोपनीयता', terms: 'अटी', contact: 'संपर्क', footerNote: 'प्रत्येक प्रकल्पाचे खाते आणि माहिती स्वतंत्र असते.',
      'tag.ladwani': 'प्रत्येक गावासाठी वंशवृक्ष आणि समाज',
      'tag.atip': 'ट्रेडिंग माहिती, फक्त पाहण्यासाठी',
      'tag.education': 'शिक्षण, प्रगती आणि शाळेचे जीवन एकाच ठिकाणी',
      'tag.tasklist': 'दोन टॅपमध्ये काम नोंदवा; आजचे काम एका नजरेत',
      'tag.driving': 'रस्त्यावर जाण्यापूर्वी सुरक्षित ड्रायव्हिंगचा सराव',
      'tag.environment': 'हवामानाची माहिती आणि आपण स्थानिक पातळीवर काय करू शकतो',
    },
    hi: {
      skip: 'मुख्य सामग्री पर जाएँ', projects: 'सभी प्रोजेक्ट', projectsHub: 'bkesari मुखपृष्ठ खोलें',
      language: 'भाषा', theme: 'थीम', signIn: 'साइन इन', signOut: 'साइन आउट',
      account: 'खाता', signedInTo: '{project} में साइन इन', separate: 'यह {project} के लिए अलग खाता है।',
      about: 'हमारे बारे में', privacy: 'गोपनीयता', terms: 'शर्तें', contact: 'संपर्क', footerNote: 'हर प्रोजेक्ट का खाता और डेटा अलग रहता है।',
      'tag.ladwani': 'हर गाँव के लिए वंशवृक्ष और समुदाय',
      'tag.atip': 'ट्रेडिंग जानकारी, केवल देखने के लिए',
      'tag.education': 'पढ़ाई, प्रगति और स्कूल जीवन एक ही जगह',
      'tag.tasklist': 'दो टैप में काम लिखें; आज का काम एक नज़र में',
      'tag.driving': 'सड़क पर जाने से पहले सुरक्षित ड्राइविंग का अभ्यास',
      'tag.environment': 'जलवायु के तथ्य और हम स्थानीय रूप से क्या कर सकते हैं',
    },
  };
  const LANGS = [['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिंदी']];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function s(lang, key, vars) {
    let out = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return out;
  }

  function icon(name, cls) {
    return `<svg class="${cls || 'ks-ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  /**
   * Which tier this page is being served as: 'dev' | 'test' | 'prod'.
   * From the hostname, so one build serves every tier; an explicit override
   * (a server's APP_ENV) wins. Unknown hosts are production, never dev.
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

  /** Paths that belong to a project besides its own (old names, aliases). */
  const ALIASES = { '/tasks/': '/tasklist/', '/education/': '/edu/', '/atip/': '/ATIP/' };

  /**
   * The tab a path belongs to, by longest matching prefix, or '/' for home.
   * Prefix rather than equality so /ladwani/members/42 still lights LadWani.
   */
  function activeTabPath(pathname) {
    const path = String(pathname || '/').toLowerCase();
    let match = '/';
    let len = 0;
    const candidates = TABS.map((t) => [t.path, t.path]).concat(Object.entries(ALIASES));
    for (const [prefix, tabPath] of candidates) {
      const base = prefix.replace(/\/$/, '').toLowerCase();
      if ((path === base || path.startsWith(base + '/')) && base.length > len) {
        match = tabPath;
        len = base.length;
      }
    }
    return match;
  }

  const tabFor = (pathname) => TABS.find((t) => t.path === activeTabPath(pathname)) || null;

  /**
   * Styles for the shell. Scoped: the tokens are declared on .ks-bar and
   * .ks-foot themselves, never on :root, so including the shell cannot change
   * the colours of the page that hosts it (the ATIP viewer has its own).
   */
  function styleTag() {
    return `<style id="bk-menu-style">
.ks-bar,.ks-foot{--ks-surface:#fff;--ks-ink:#1C1917;--ks-muted:#57534E;--ks-line:#E7E5E4;--ks-brand:#C2560A;--ks-tint:#FDF1E8;
  --ks-accent:#C2560A;--ks-focus:#C2560A;font-family:'Mukta',system-ui,-apple-system,'Segoe UI','Noto Sans Devanagari',sans-serif;
  background:var(--ks-surface);color:var(--ks-ink);line-height:1.4}
.ks-bar[data-project=ladwani]{--ks-accent:#7C2D12}.ks-bar[data-project=education]{--ks-accent:#0F766E}
.ks-bar[data-project=tasklist]{--ks-accent:#4338CA}.ks-bar[data-project=environment]{--ks-accent:#15803D}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .ks-bar,:root:not([data-theme=light]) .ks-foot{--ks-surface:#1F1B19;--ks-ink:#F5F5F4;
  --ks-muted:#C9C4BF;--ks-line:#3A3532;--ks-brand:#F08A3C;--ks-tint:#3A2312;--ks-accent:#F08A3C;--ks-focus:#F5A869}
  :root:not([data-theme=light]) .ks-bar[data-project=ladwani]{--ks-accent:#F4A68C}:root:not([data-theme=light]) .ks-bar[data-project=education]{--ks-accent:#5EEAD4}
  :root:not([data-theme=light]) .ks-bar[data-project=tasklist]{--ks-accent:#A5B4FC}:root:not([data-theme=light]) .ks-bar[data-project=environment]{--ks-accent:#4ADE80}}
:root[data-theme=dark] .ks-bar,:root[data-theme=dark] .ks-foot{--ks-surface:#1F1B19;--ks-ink:#F5F5F4;--ks-muted:#C9C4BF;--ks-line:#3A3532;
  --ks-brand:#F08A3C;--ks-tint:#3A2312;--ks-accent:#F08A3C;--ks-focus:#F5A869}
:root[data-theme=dark] .ks-bar[data-project=ladwani]{--ks-accent:#F4A68C}:root[data-theme=dark] .ks-bar[data-project=education]{--ks-accent:#5EEAD4}
:root[data-theme=dark] .ks-bar[data-project=tasklist]{--ks-accent:#A5B4FC}:root[data-theme=dark] .ks-bar[data-project=environment]{--ks-accent:#4ADE80}
.ks-bar *,.ks-foot *{box-sizing:border-box}
.ks-bar{position:sticky;top:0;z-index:9000;border-bottom:1px solid var(--ks-line);border-top:3px solid var(--ks-accent)}
.ks-bar a,.ks-foot a{color:inherit}
.ks-bar :focus-visible,.ks-foot :focus-visible{outline:3px solid var(--ks-focus);outline-offset:2px}
.ks-skip{position:absolute;left:8px;top:-60px;background:var(--ks-surface);color:var(--ks-ink);padding:12px 16px;border-radius:8px;
  box-shadow:0 4px 12px rgba(0,0,0,.2);font-weight:600;z-index:2}
.ks-skip:focus{top:8px}
.ks-in{max-width:1120px;margin:0 auto;padding:6px 12px;display:flex;align-items:center;gap:4px;min-height:60px}
.ks-brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:19px;text-decoration:none;min-height:48px;padding:0 6px;border-radius:8px;flex:none}
.ks-mark{width:26px;height:26px;border-radius:8px;background:var(--ks-brand);display:grid;place-items:center;color:#fff;font-size:15px;font-weight:800;flex:none}
.ks-env{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:var(--ks-tint);color:var(--ks-ink);padding:2px 8px;border-radius:20px}
.ks-bar .ks-proj{display:inline-flex;align-items:center;gap:6px;min-height:48px;padding:0 8px;color:var(--ks-accent);font-weight:700;font-size:17px;
  text-decoration:none;flex:0 1 auto;min-width:4.5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ks-bar .ks-proj::before{content:"/";color:var(--ks-muted);font-weight:400;margin-right:2px}
.ks-tools{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
.ks-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:48px;min-height:48px;padding:0 10px;border:0;border-radius:10px;
  background:transparent;color:var(--ks-ink);font:inherit;font-weight:600;cursor:pointer;text-decoration:none;list-style:none}
.ks-btn::-webkit-details-marker{display:none}
.ks-btn:hover{background:var(--ks-tint)}
.ks-ico{width:22px;height:22px;flex:none}
.ks-lang{position:relative;display:inline-flex;align-items:center}
.ks-lang .ks-ico{position:absolute;left:10px;pointer-events:none}
.ks-lang select{appearance:none;-webkit-appearance:none;min-height:48px;padding:0 10px 0 38px;border:1px solid transparent;border-radius:10px;
  background:transparent;color:var(--ks-ink);font:inherit;font-weight:600;cursor:pointer}
.ks-lang select:hover{background:var(--ks-tint)}
.ks-pop{position:relative}
.ks-panel{position:absolute;right:0;top:calc(100% + 6px);width:min(340px,calc(100vw - 24px));background:var(--ks-surface);color:var(--ks-ink);
  border:1px solid var(--ks-line);border-radius:14px;box-shadow:0 16px 40px rgba(28,25,23,.18);padding:8px;z-index:9001}
.ks-panel ul{list-style:none;margin:0;padding:0}
.ks-panel a.ks-item{display:flex;align-items:center;gap:12px;min-height:52px;padding:6px 10px;border-radius:10px;text-decoration:none}
.ks-panel a.ks-item:hover{background:var(--ks-tint)}
.ks-panel a.ks-item[aria-current=page]{background:var(--ks-tint);font-weight:700}
.ks-dot{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;flex:none;color:#fff}
.ks-dot .ks-ico{width:20px;height:20px}
.ks-item small{display:block;color:var(--ks-muted);font-size:13px;line-height:1.3}
.ks-all{display:flex;justify-content:center;align-items:center;min-height:48px;margin-top:4px;border-top:1px solid var(--ks-line);font-weight:700;text-decoration:none;color:var(--ks-brand)!important}
.ks-avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--ks-accent);color:#fff;font-weight:700;font-size:14px;flex:none}
.ks-acct-head{padding:8px 10px 10px;border-bottom:1px solid var(--ks-line);margin-bottom:6px}
.ks-acct-head strong{display:block}.ks-acct-head small{color:var(--ks-muted)}
.ks-panel button.ks-item,.ks-panel a.ks-plain{display:flex;width:100%;align-items:center;min-height:48px;padding:0 10px;border:0;border-radius:10px;
  background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;text-decoration:none}
.ks-panel button.ks-item:hover,.ks-panel a.ks-plain:hover{background:var(--ks-tint)}
.ks-label{max-width:9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){.ks-label,.ks-hide-sm{display:none}.ks-in{padding:6px 6px}.ks-lang select{width:52px;padding:0;color:transparent}
  .ks-lang select option{color:#1C1917}.ks-lang .ks-ico{left:13px}.ks-bar .ks-proj{font-size:16px;padding:0 4px}.ks-brand{font-size:17px}
  .ks-account .ks-btn{padding:0 8px}}
/* Phones: inside a project the logo alone stands for bkesari, so the
   project's own name always fits beside it. */
@media (max-width:480px){.ks-bar[data-project] .ks-brand-name{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .ks-bar[data-project] .ks-brand{padding:0 4px}.ks-bar .ks-proj{min-width:3.5em}.ks-env{font-size:10px;padding:1px 5px}
  /* Signed out, every project page carries its own sign-in; the header link would not fit. */
  .ks-account .ks-signin{display:none}}
.ks-foot{border-top:1px solid var(--ks-line);color:var(--ks-muted);font-size:14px;padding:20px 16px;margin-top:auto}
.ks-foot-in{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;justify-content:space-between}
.ks-foot ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0 16px}
.ks-foot a{display:inline-flex;align-items:center;min-height:44px;color:var(--ks-muted)}
.ks-foot a:hover{color:var(--ks-ink)}
.ks-foot p{margin:0}
@media print{.ks-bar,.ks-foot{display:none}}
</style>`;
  }

  function projectList(opts, lang, activePath) {
    return TABS.filter((tab) => !tab.ownerOnly || opts.isOwner).map((tab) => {
      const current = tab.path === activePath ? ' aria-current="page"' : '';
      const ext = tab.external ? ` target="_blank" rel="noopener"` : '';
      return `<li><a class="ks-item" href="${escapeHtml(tab.path)}"${current}${ext}>` +
        `<span class="ks-dot" style="background:${escapeHtml(tab.accent)}">${icon(tab.icon)}</span>` +
        `<span>${escapeHtml(tab.name)}${tab.external ? ' ↗' : ''}<small>${escapeHtml(s(lang, `tag.${tab.key}`))}</small></span></a></li>`;
    }).join('');
  }

  /**
   * The header's markup. Used by the browser mount and by the server alike,
   * so the two can never drift apart. Adds no <script>.
   */
  function renderHtml(options) {
    const opts = options || {};
    const env = opts.env || 'prod';
    const lang = STRINGS[opts.lang] ? opts.lang : 'en';
    const active = activeTabPath(opts.pathname || '/');
    const isHome = active === '/';
    const tab = isHome ? null : TABS.find((t) => t.path === active);
    const envPill = env === 'prod' ? '' : ` <span class="ks-env">${escapeHtml(env)}</span>`;
    const projectAttr = tab ? ` data-project="${escapeHtml(tab.key)}"` : '';
    const projectName = tab
      ? `<a class="ks-proj" href="${escapeHtml(tab.path)}">${escapeHtml(tab.name)}</a>`
      : '';
    const langOptions = LANGS.map(([code, label]) => `<option value="${code}"${code === lang ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');

    return `${styleTag()}
<header class="ks-bar bk-menu"${projectAttr}>
  <a class="ks-skip" href="#main">${escapeHtml(s(lang, 'skip'))}</a>
  <nav class="ks-in" aria-label="bkesari">
    <a class="ks-brand" href="/"${isHome ? ' aria-current="page"' : ''}><span class="ks-mark" aria-hidden="true">b</span><span class="ks-brand-name">bkesari</span>${envPill}</a>
    ${projectName}
    <div class="ks-tools">
      <details class="ks-pop ks-switch">
        <summary class="ks-btn" aria-label="${escapeHtml(s(lang, 'projects'))}" title="${escapeHtml(s(lang, 'projects'))}">${icon('grid')}<span class="ks-label ks-hide-sm">${escapeHtml(s(lang, 'projects'))}</span></summary>
        <div class="ks-panel"><ul>${projectList(opts, lang, active)}</ul>
          <a class="ks-all" href="/#projects">${escapeHtml(s(lang, 'projectsHub'))}</a></div>
      </details>
      <label class="ks-lang" hidden data-ks-js>${icon('globe')}<select data-k-lang aria-label="${escapeHtml(s(lang, 'language'))}">${langOptions}</select></label>
      <button class="ks-btn" type="button" data-k-theme hidden data-ks-js aria-label="${escapeHtml(s(lang, 'theme'))}">${icon('theme')}</button>
      <div class="ks-account" data-ks-account hidden></div>
    </div>
  </nav>
</header>`;
  }

  /** The footer's markup: About, Privacy (DPDP Act 2023), Terms, Contact. */
  function renderFooter(options) {
    const opts = options || {};
    const lang = STRINGS[opts.lang] ? opts.lang : 'en';
    const year = opts.year || new Date().getFullYear();
    return `<footer class="ks-foot k-footer" data-ks-footer>
  <div class="ks-foot-in">
    <nav aria-label="${escapeHtml(s(lang, 'about'))}"><ul>
      <li><a href="/about">${escapeHtml(s(lang, 'about'))}</a></li>
      <li><a href="/privacy">${escapeHtml(s(lang, 'privacy'))}</a></li>
      <li><a href="/terms">${escapeHtml(s(lang, 'terms'))}</a></li>
      <li><a href="/contact">${escapeHtml(s(lang, 'contact'))}</a></li>
    </ul></nav>
    <p>${escapeHtml(s(lang, 'footerNote'))} &copy; ${year} bkesari.com</p>
  </div>
</footer>`;
  }

  /* ---------------- browser ---------------- */

  function storageGet(win, key) { try { return win.localStorage.getItem(key); } catch { return null; } }
  function storageSet(win, key, value) { try { if (value == null) win.localStorage.removeItem(key); else win.localStorage.setItem(key, value); } catch { /* blocked */ } }
  function pageLang(win) {
    if (win.Kesari) return win.Kesari.currentLang();
    const saved = storageGet(win, 'kesari.lang');
    if (STRINGS[saved]) return saved;
    const m = /(?:^|;\s*)k_lang=(en|mr|hi)/.exec(win.document.cookie || '');
    return m ? m[1] : 'en';
  }

  /** Account menu for the current project, from that project's own "me" endpoint. */
  function renderAccount(d, slot, me, tab, lang) {
    const project = tab ? tab.name : 'bkesari';
    if (!me || !me.user) {
      if (!me || !me.signInUrl) return;
      slot.innerHTML = `<a class="ks-btn ks-signin" href="${escapeHtml(me.signInUrl)}">${escapeHtml(s(lang, 'signIn'))}</a>`;
      slot.hidden = false;
      return;
    }
    const u = me.user;
    const display = u.name || u.email || u.mobile || '';
    const initials = (display.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
    const links = (me.links || []).map((l) => `<a class="ks-plain" href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`).join('');
    slot.innerHTML = `<details class="ks-pop"><summary class="ks-btn" aria-label="${escapeHtml(s(lang, 'account'))}: ${escapeHtml(display)}">` +
      `<span class="ks-avatar" aria-hidden="true">${escapeHtml(initials)}</span><span class="ks-label">${escapeHtml(display)}</span></summary>` +
      `<div class="ks-panel"><div class="ks-acct-head"><strong>${escapeHtml(s(lang, 'signedInTo', { project }))}</strong><small>${escapeHtml(u.email || u.mobile || '')}</small><br>` +
      `<small>${escapeHtml(s(lang, 'separate', { project }))}</small></div>${links}` +
      (me.signOut ? `<button class="ks-item" type="button" data-ks-signout>${escapeHtml(s(lang, 'signOut'))}</button>` : '') + '</div></details>';
    slot.hidden = false;
    const out = slot.querySelector('[data-ks-signout]');
    if (out) {
      out.addEventListener('click', () => {
        fetch(me.signOut.url, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(me.signOut.csrf ? { 'X-CSRF-Token': me.signOut.csrf } : {}) },
          body: '{}',
        }).catch(() => {}).then(() => { d.defaultView.location.href = me.signOut.next || (tab ? tab.path : '/'); });
      });
    }
  }

  function wireControls(d, win) {
    // Close an open disclosure when focus or a click leaves it, and on Escape.
    d.addEventListener('click', (e) => {
      d.querySelectorAll('.ks-bar details[open]').forEach((det) => { if (!det.contains(e.target)) det.removeAttribute('open'); });
    });
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      d.querySelectorAll('.ks-bar details[open]').forEach((det) => { det.removeAttribute('open'); const sm = det.querySelector('summary'); if (sm) sm.focus(); });
    });
    d.querySelectorAll('.ks-bar [data-ks-js]').forEach((el) => { el.hidden = false; });
    if (win.Kesari) { win.Kesari.wire(d.querySelector('.ks-bar')); return; }
    // Without the Kesari runtime the shell drives its own two controls.
    const sel = d.querySelector('.ks-bar select[data-k-lang]');
    if (sel) {
      sel.value = pageLang(win);
      sel.addEventListener('change', () => {
        storageSet(win, 'kesari.lang', sel.value);
        d.cookie = `k_lang=${sel.value}; Path=/; Max-Age=31536000; SameSite=Lax${win.location.protocol === 'https:' ? '; Secure' : ''}`;
        win.location.reload();
      });
    }
    const btn = d.querySelector('.ks-bar [data-k-theme]');
    if (btn) {
      btn.addEventListener('click', () => {
        const order = ['system', 'light', 'dark'];
        const cur = storageGet(win, 'kesari.theme') || 'system';
        const next = order[(order.indexOf(cur) + 1) % 3];
        storageSet(win, 'kesari.theme', next === 'system' ? null : next);
        if (next === 'system') d.documentElement.removeAttribute('data-theme'); else d.documentElement.setAttribute('data-theme', next);
      });
    }
  }

  /**
   * Browser entry point. Header into [data-bkesari-menu] or the top of <body>;
   * footer into [data-kesari-footer] or the end of <body>, unless the slot or
   * window.KESARI_SHELL says footer:false. Idempotent.
   */
  function mount(doc) {
    const d = doc || document;
    const htmlEl = d.documentElement;
    if (htmlEl.hasAttribute('data-ks-mounted')) return;
    htmlEl.setAttribute('data-ks-mounted', '');
    const win = d.defaultView || (typeof window !== 'undefined' ? window : {});
    const slot = d.querySelector('[data-bkesari-menu]');
    const meta = (n) => { const m = d.querySelector(`meta[name="${n}"]`); return m ? m.getAttribute('content') : undefined; };
    const cfg = Object.assign({}, win.KESARI_SHELL || {}, {
      meUrl: (slot && slot.getAttribute('data-me-url')) || meta('kesari-me-url') || undefined,
      footer: (slot && slot.getAttribute('data-footer') === 'false') || meta('kesari-footer') === 'false' ? false : undefined,
    });
    Object.keys(cfg).forEach((k) => cfg[k] === undefined && delete cfg[k]);
    const lang = pageLang(win);
    const pathname = cfg.pathname || (d.location ? d.location.pathname : '/');
    // A page the server built already carries the bar (renderHtml); only wire it.
    if (!d.getElementById('bk-menu-style')) {
      // The owner's hub admin session sets a non-secret hint cookie so the
      // switcher can list ATIP without asking the server on every page.
      const isOwner = /(?:^|;\s*)k_admin=1/.test(d.cookie || '');
      const html = renderHtml({
        pathname, lang, isOwner,
        env: resolveEnv(d.location ? d.location.hostname : '', win.BKESARI_ENV),
      });
      if (slot) { slot.innerHTML = html; } else {
        const holder = d.createElement('div');
        holder.innerHTML = html;
        while (holder.lastChild) d.body.insertBefore(holder.lastChild, d.body.firstChild);
      }
    }
    if (cfg.footer !== false && !d.querySelector('[data-ks-footer]')) {
      const fslot = d.querySelector('[data-kesari-footer]');
      const fhtml = renderFooter({ lang });
      if (fslot) fslot.innerHTML = fhtml; else d.body.insertAdjacentHTML('beforeend', fhtml);
    }
    // Give the page's main landmark the id the skip link targets.
    if (!d.getElementById('main')) { const m = d.querySelector('main'); if (m) m.id = 'main'; }
    wireControls(d, win);
    const tab = tabFor(pathname);
    if (cfg.meUrl && typeof fetch === 'function') {
      fetch(cfg.meUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => (r.ok || r.status === 401 ? r.json() : null))
        .then((me) => renderAccount(d, d.querySelector('[data-ks-account]'), me, tab, lang))
        .catch(() => {});
    }
  }

  function autoMount() {
    if (typeof document === 'undefined') return;
    // Installable on Android and iOS home screens: the worker only serves the
    // offline page and the static shell (see /sw.js).
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && location.protocol === 'https:' && !window.KESARI_NO_SW) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => mount(document), { once: true });
    } else {
      mount(document);
    }
  }

  return {
    DOMAIN, TABS, ICONS, STRINGS, LANGS, escapeHtml, icon, resolveEnv, activeTabPath, tabFor,
    styleTag, renderHtml, renderFooter, renderAccount, mount, autoMount,
  };
});
