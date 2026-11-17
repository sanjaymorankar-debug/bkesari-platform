'use strict';

/* ============================================================
   The hub's own pages, rendered on the server in the visitor's language
   (cookie k_lang; portal/i18n/hub.json). Plain HTML on the Kesari design
   system: they work without JavaScript, and the only scripts are files on
   this origin, so the hub's Content-Security-Policy can forbid inline ones.
   ============================================================ */

const menu = require('./public/shared/menu.js');
const strings = require('./i18n/hub.json');

const KESARI = '/kesari-ui/1.0.0';
const LANGS = ['en', 'mr', 'hi'];
const esc = menu.escapeHtml;

/**
 * The visitor's language: the one they picked with the shell's switcher (the
 * k_lang cookie), else English. The browser's own language is not used: the
 * owner's rule is English by default, changed only by the visitor (D-030).
 */
function langOf(req) {
  const m = /(?:^|;\s*)k_lang=(en|mr|hi)(?:;|$)/.exec(String((req && req.headers && req.headers.cookie) || ''));
  return m ? m[1] : 'en';
}

function t(lang, key, vars) {
  let s = (strings[lang] && strings[lang][key]) || strings.en[key];
  if (s === undefined) throw new Error(`hub string missing: ${key}`);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}

const ILLUSTRATION = {
  compass: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="60" cy="48" r="34"/><path d="m60 22 9 26-9 26-9-26z" fill="currentColor" fill-opacity=".15"/><circle cx="60" cy="48" r="4" fill="currentColor"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
  plug: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M30 48h18m24 0h18M48 34v28a6 6 0 0 0 6 6h12a6 6 0 0 0 6-6V34z"/><path d="M54 24v10m12-10v10"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
  done: '<svg viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="22" y="14" width="76" height="62" rx="10"/><path d="m44 46 12 12 22-24"/><path d="M14 90h92" stroke-opacity=".3"/></svg>',
};

/**
 * One page: Kesari head, the shell header (server-rendered, so it shows with
 * scripts off), the page's <main>, the shell footer.
 */
function layout({ req, lang, env, title, description, body, pathname, isOwner = false, head = '', scripts = [], mainClass = 'k-main', status }) {
  const path = pathname || (req && req.path) || '/';
  return `<!doctype html>
<html lang="${lang}" data-i18n-reload>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || t(lang, 'site.description'))}">
<meta name="theme-color" content="#C2560A">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="bkesari">
<link rel="preload" href="${KESARI}/fonts/mukta-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
${lang === 'en' ? '' : `<link rel="preload" href="${KESARI}/fonts/mukta-devanagari-400-normal.woff2" as="font" type="font/woff2" crossorigin>`}
<link rel="stylesheet" href="${KESARI}/kesari.css">
<link rel="stylesheet" href="/shared/hub.css">
<script src="${KESARI}/kesari.js"></script>
<meta name="kesari-me-url" content="/account/api/auth/me">
${head}
</head>
<body${status ? ` data-status="${status}"` : ''}>
${menu.renderHtml({ pathname: path, env, lang, isOwner })}
<main id="main" class="${mainClass}">
${body}
</main>
${menu.renderFooter({ lang })}
<script src="/shared/menu.js" defer></script>
${scripts.map((s) => `<script src="${esc(s)}" defer></script>`).join('\n')}
</body>
</html>`;
}

const CHIP = { live: 'k-chip--live', beta: 'k-chip--beta', soon: 'k-chip--soon', private: 'k-chip--plain' };

// The home tiles are keyed by tile; access is keyed by project (hub_projects).
const TILE_PROJECT = { education: 'edu' };
const STATE_CHIP = { open: 'k-chip--live', approved: 'k-chip--live', awaiting: 'k-chip--beta', pending: 'k-chip--beta', declined: 'k-chip--plain', revoked: 'k-chip--plain', request: 'k-chip--soon', signin: 'k-chip--soon' };

/** The chip and the button for one project, from the person's access state (portal/access.js statusList). */
function accessAction(st, tile, lang) {
  if (!st || st.state === 'open' || st.state === 'hidden') return null;
  const label = st.state === 'approved' ? t(lang, 'access.state.approved', { role: st.role })
    : st.state === 'awaiting' ? t(lang, 'access.state.awaiting', { role: st.role })
      : t(lang, `access.state.${st.state}`);
  const chip = `<span class="k-chip ${STATE_CHIP[st.state] || ''}" data-access-state="${esc(st.state)}">${esc(label)}</span>`;
  if (st.state === 'approved' || st.state === 'awaiting') return { chip, href: tile.href, text: t(lang, 'tile.open') };
  if (st.state === 'signin') return { chip, href: `/auth/sign-in?next=${encodeURIComponent(st.path || tile.href)}`, text: t(lang, 'home.signInHelp') };
  if (st.state === 'pending') return { chip, href: '/account', text: t(lang, 'account.title') };
  return { chip, href: `/access/request?project=${encodeURIComponent(st.key)}`, text: t(lang, 'access.state.request') };
}

function tileHtml(tile, lang, st) {
  const benefit = tile[`benefit_${lang}`] || tile.benefit_en;
  const act = accessAction(st, tile, lang);
  const ext = tile.external;
  const label = t(lang, 'tile.openName', { name: tile.name });
  const project = ['ladwani', 'education', 'tasklist', 'environment'].includes(tile.icon) ? ` data-project="${tile.icon}"` : '';
  return `<li><article class="k-tile hub-tile"${project}>
  <div class="k-tile__head"><span class="k-tile__icon">${menu.icon(tile.icon, 'hub-ico')}</span>
    <h3 class="k-tile__name">${esc(tile.name)}${ext ? ' <span aria-hidden="true">↗</span>' : ''}</h3></div>
  <p class="k-tile__text">${esc(benefit)}</p>
  <div class="k-tile__foot"><span class="k-chip ${CHIP[tile.status] || ''}">${esc(t(lang, `chip.${tile.status}`))}</span>${act ? ` ${act.chip}` : ''}
    <a class="k-btn hub-open" href="${esc(act ? act.href : tile.href)}" aria-label="${esc(act ? `${act.text}: ${tile.name}` : label)}${ext && !act ? ` (${esc(t(lang, 'tile.newWindow'))})` : ''}"${ext && !act ? ' target="_blank" rel="noopener"' : ''}>${esc(act ? act.text : t(lang, 'tile.open'))}${ext && !act ? ' ↗' : ''}</a></div>
</article></li>`;
}

function announcementHtml(a, lang) {
  if (!a) return '';
  const msg = a[`message_${lang}`] || a.message_en;
  return `<div class="k-banner k-banner--${esc(a.kind)} hub-announce" role="status"><p>${esc(msg)}${a.link ? ` <a href="${esc(a.link)}">→</a>` : ''}</p></div>`;
}

function home({ lang, tiles, announcement, states = [], user = null }) {
  const stateOf = (tile) => states.find((x) => x.key === (TILE_PROJECT[tile.key] || tile.key));
  const others = LANGS.filter((l) => l !== lang);
  const names = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };
  return `${announcementHtml(announcement, lang)}
<section class="hub-hero" aria-labelledby="hero-h">
  <p class="hub-kicker">bkesari.com</p>
  <h1 id="hero-h" class="k-display">${esc(t(lang, 'home.h1'))}</h1>
  <p class="k-lead">${esc(t(lang, 'home.purpose'))}</p>
  <p class="hub-lead2">${esc(t(lang, 'home.lead'))}</p>
  <p class="hub-other"><span class="k-muted">${esc(t(lang, 'home.inOther'))}:</span>
    ${others.map((l) => `<span lang="${l}"><strong>${names[l]}</strong> — ${esc(t(l, 'home.purpose'))}</span>`).join(' ')}</p>
  <div class="k-row"><a class="k-btn k-btn--brand" href="#projects">${esc(t(lang, 'home.cta'))}</a>
    <a class="k-btn k-btn--secondary" href="/about">${esc(t(lang, 'home.about'))}</a></div>
</section>
<section id="projects" class="k-section" aria-labelledby="proj-h">
  <h2 id="proj-h">${esc(t(lang, 'home.projects'))}</h2>
  <p class="k-muted">${esc(t(lang, 'home.projectsLead'))}</p>
  <ul class="k-grid hub-tiles" role="list">${tiles.map((x) => tileHtml(x, lang, stateOf(x))).join('')}</ul>
</section>
<section class="k-section hub-values" aria-labelledby="why-h">
  <h2 id="why-h">${esc(t(lang, 'home.why'))}</h2>
  <ul class="k-grid" role="list">
    ${[1, 2, 3].map((i) => `<li class="k-card"><h3>${esc(t(lang, `home.v${i}t`))}</h3><p class="k-muted">${esc(t(lang, `home.v${i}`))}</p></li>`).join('')}
  </ul>
</section>
<section class="k-section k-card hub-accounts" aria-labelledby="acc-h">
  <h2 id="acc-h">${esc(t(lang, 'home.accountsTitle'))}</h2>
  <p>${esc(t(lang, 'home.accountsBody'))}</p>
  <p>${user ? `<a class="k-btn" href="/account">${esc(t(lang, 'account.title'))}</a>` : `<a class="k-btn k-btn--brand" href="/auth/sign-in">${esc(t(lang, 'home.signInHelp'))}</a>`}</p>
</section>`;
}

/**
 * The bkesari ID's sign-in page (D-039). `error`: the code after google_ in
 * ?error=. `google`: where "Continue with Google" leads (bkesari-id.js
 * googleEntry), or null for no button.
 */
function signIn({ lang, next = '/', google = null, error = null }) {
  const known = ['cancelled', 'state', 'failed', 'unverified', 'unconfirmed', 'conflict', 'builtin', 'status', 'rate_limited', 'retry'];
  const msg = error ? t(lang, `id.err.${known.includes(error) ? error : 'failed'}`) : '';
  return `<div class="k-main--narrow">
<h1 id="id-h">${esc(t(lang, 'id.title'))}</h1>
<p class="k-muted">${esc(t(lang, 'id.lead'))}</p>
${msg ? `<div class="k-banner k-banner--danger" role="alert"><p>${esc(msg)}</p></div>` : ''}
<div class="k-card hub-form" data-signin data-next="${esc(next)}">
${google ? `<a class="k-btn k-btn--brand k-btn--block hub-google" href="${esc(google)}">${esc(t(lang, 'id.google'))}</a>
<p class="hub-or k-muted"><span>${esc(t(lang, 'id.or'))}</span></p>` : ''}
<form id="si-send" novalidate>
<div class="k-field"><label class="k-label" for="si-email">${esc(t(lang, 'id.email'))}</label>
<input class="k-input" id="si-email" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required aria-describedby="si-err"></div>
<div class="k-field" id="si-pass-field" hidden><label class="k-label" for="si-pass">${esc(t(lang, 'id.password'))}</label>
<input class="k-input" id="si-pass" type="password" autocomplete="current-password" aria-describedby="si-err"></div>
<button class="k-btn k-btn--block" type="submit" id="si-send-btn">${esc(t(lang, 'id.sendCode'))}</button></form>
<form id="si-verify" novalidate hidden>
<p id="si-sent" class="k-muted" role="status" data-template="${esc(t(lang, 'id.codeSent'))}"></p>
<div class="k-field"><label class="k-label" for="si-code">${esc(t(lang, 'id.code'))}</label>
<input class="k-input" id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required aria-describedby="si-err"></div>
<button class="k-btn k-btn--block k-btn--brand" type="submit">${esc(t(lang, 'id.verify'))}</button></form>
<p class="k-error" id="si-err" role="alert"></p>
<p class="k-banner k-banner--warning" id="si-dev" role="status" hidden></p>
</div>
<p class="k-small k-muted">${esc(t(lang, 'home.accountsBody'))}</p>
</div>`;
}

function about({ lang, tiles }) {
  return `<div class="k-main--narrow hub-prose">
<h1>${esc(t(lang, 'about.h1'))}</h1>
<p class="k-lead">${esc(t(lang, 'about.lead'))}</p>
<h2>${esc(t(lang, 'about.visionT'))}</h2><p>${esc(t(lang, 'about.vision'))}</p>
<h2>${esc(t(lang, 'about.howT'))}</h2>
<ul>${[1, 2, 3].map((i) => `<li>${esc(t(lang, `about.how${i}`))}</li>`).join('')}</ul>
<h2>${esc(t(lang, 'about.projectsT'))}</h2>
<ul>${tiles.map((x) => `<li><a href="${esc(x.href)}"${x.external ? ' target="_blank" rel="noopener"' : ''}>${esc(x.name)}</a> — ${esc(x[`benefit_${lang}`] || x.benefit_en)}</li>`).join('')}</ul>
<h2>${esc(t(lang, 'about.contactT'))}</h2><p>${esc(t(lang, 'about.contact'))} <a href="/contact">/contact</a></p>
</div>`;
}

const TOPICS = ['general', 'ladwani', 'education', 'tasklist', 'privacy', 'problem'];

function field(lang, { id, label, type = 'text', value = '', error, hint, attrs = '' }) {
  const err = error ? t(lang, error) : '';
  return `<div class="k-field"><label class="k-label" for="${id}">${esc(t(lang, label))}</label>
${hint ? `<span class="k-hint" id="${id}-hint">${esc(t(lang, hint))}</span>` : ''}
${type === 'textarea'
    ? `<textarea class="k-textarea" id="${id}" name="${id}" rows="6"${err ? ' aria-invalid="true"' : ''} aria-describedby="${id}-err${hint ? ` ${id}-hint` : ''}" ${attrs}>${esc(value)}</textarea>`
    : `<input class="k-input" id="${id}" name="${id}" type="${type}" value="${esc(value)}"${err ? ' aria-invalid="true"' : ''} aria-describedby="${id}-err${hint ? ` ${id}-hint` : ''}" ${attrs}>`}
<span class="k-error" id="${id}-err">${esc(err)}</span></div>`;
}

function contact({ lang, csrf, stamp, values = {}, errors = {}, formError, sent }) {
  if (sent) {
    return `<div class="k-main--narrow"><div class="k-empty" role="status">${ILLUSTRATION.done}
<h1>${esc(t(lang, 'contact.sent'))}</h1><p>${esc(t(lang, 'contact.sentNext'))}</p>
<a class="k-btn k-btn--secondary" href="/contact">${esc(t(lang, 'contact.again'))}</a></div></div>`;
  }
  return `<div class="k-main--narrow">
<h1>${esc(t(lang, 'contact.h1'))}</h1>
<p class="k-lead">${esc(t(lang, 'contact.lead'))}</p>
${formError ? `<div class="k-banner k-banner--danger" role="alert"><p>${esc(t(lang, formError))}</p></div>` : ''}
<form class="k-card hub-form" method="post" action="/contact" novalidate data-hub-contact>
<input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="stamp" value="${esc(stamp)}">
<div class="hub-hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
${field(lang, { id: 'name', label: 'contact.name', value: values.name, error: errors.name, attrs: 'autocomplete="name" required maxlength="120"' })}
<p class="k-hint" id="reach-hint">${esc(t(lang, 'contact.reachHint'))}</p>
<div class="hub-two">
${field(lang, { id: 'email', label: 'contact.email', type: 'email', value: values.email, error: errors.email, attrs: 'autocomplete="email" maxlength="254"' })}
${field(lang, { id: 'mobile', label: 'contact.mobile', type: 'tel', value: values.mobile, error: errors.mobile, attrs: 'autocomplete="tel-national" inputmode="numeric" maxlength="15"' })}
</div>
<div class="k-field"><label class="k-label" for="topic">${esc(t(lang, 'contact.topic'))}</label>
<select class="k-select" id="topic" name="topic">${TOPICS.map((x) => `<option value="${x}"${values.topic === x ? ' selected' : ''}>${esc(t(lang, `contact.topic.${x}`))}</option>`).join('')}</select></div>
${field(lang, { id: 'message', label: 'contact.message', type: 'textarea', value: values.message, error: errors.message, attrs: 'required minlength="10" maxlength="4000"' })}
<label class="k-check"><input type="checkbox" name="consent" value="yes"${values.consent ? ' checked' : ''}${errors.consent ? ' aria-invalid="true"' : ''} aria-describedby="consent-err"><span>${esc(t(lang, 'contact.consent'))}</span></label>
<span class="k-error" id="consent-err">${errors.consent ? esc(t(lang, errors.consent)) : ''}</span>
<p class="k-hint">${esc(t(lang, 'contact.privacyNote'))} <a href="/privacy">${esc(t(lang, 'privacy.title'))}</a></p>
<button class="k-btn k-btn--brand" type="submit">${esc(t(lang, 'contact.send'))}</button>
</form></div>`;
}

function prose(lang, prefix, sections) {
  return `<div class="k-main--narrow hub-prose">
<h1>${esc(t(lang, `${prefix}.h1`))}</h1>
<p class="k-muted">${esc(t(lang, `${prefix}.updated`))}</p>
<p class="k-lead">${esc(t(lang, `${prefix}.lead`))}</p>
${sections.map(([h, ps]) => `<h2>${esc(t(lang, h))}</h2>${ps.length > 1 ? `<ul>${ps.map((p) => `<li>${esc(t(lang, p))}</li>`).join('')}</ul>` : `<p>${esc(t(lang, ps[0]))}</p>`}`).join('\n')}
</div>`;
}

const privacy = ({ lang }) => prose(lang, 'privacy', [
  ['privacy.whoT', ['privacy.who']],
  ['privacy.whatT', ['privacy.what1', 'privacy.what2', 'privacy.what3', 'privacy.what4']],
  ['privacy.consentT', ['privacy.consent']],
  ['privacy.rightsT', ['privacy.rights']],
  ['privacy.cookiesT', ['privacy.cookies']],
  ['privacy.keepT', ['privacy.keep']],
  ['privacy.grievanceT', ['privacy.grievance']],
]);

const terms = ({ lang }) => prose(lang, 'terms', [1, 2, 3, 4, 5].map((i) => [`terms.t${i}T`, [`terms.t${i}`]]));

/** The projects that sign people in, and where. */
const SIGN_IN = [
  { key: 'ladwani', name: 'LadWani', signIn: '/ladwani/sign-in/', join: '/ladwani/sign-up/' },
  { key: 'education', name: 'Education', signIn: '/edu/sign-in', join: '/edu/sign-up' },
  { key: 'tasklist', name: 'TaskList', signIn: '/tasklist/sign-in', join: '/tasklist/sign-up' },
];

function chooser({ lang }) {
  const tabs = Object.fromEntries(menu.TABS.map((x) => [x.key, x]));
  return `<div class="k-main--narrow">
<h1>${esc(t(lang, 'chooser.h1'))}</h1>
<p class="k-lead">${esc(t(lang, 'chooser.lead'))}</p>
<ul class="hub-choose" role="list">
${SIGN_IN.map((p) => `<li class="k-card hub-choice" data-project="${p.key}">
  <span class="k-tile__icon">${menu.icon(tabs[p.key].icon, 'hub-ico')}</span>
  <div><h2>${esc(p.name)}</h2><p class="k-muted">${esc(menu.STRINGS[lang][`tag.${p.key}`])}</p>
  <div class="k-row"><a class="k-btn" href="${p.signIn}">${esc(t(lang, 'chooser.signIn', { name: p.name }))}</a>
  <a class="k-btn k-btn--ghost" href="${p.join}">${esc(t(lang, 'chooser.join'))}</a></div></div></li>`).join('\n')}
</ul>
<div class="k-banner k-banner--brand"><div><p><strong>${esc(t(lang, 'chooser.movedT'))}</strong></p><p>${esc(t(lang, 'chooser.moved'))}</p></div></div>
<p class="k-small"><a href="/admin">${esc(t(lang, 'chooser.admin'))}</a></p>
</div>`;
}

function notFound({ lang }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.compass}
<h1>${esc(t(lang, 'nf.h1'))}</h1><p>${esc(t(lang, 'nf.lead'))}</p>
<div class="k-row" style="justify-content:center"><a class="k-btn k-btn--brand" href="/">${esc(t(lang, 'nf.home'))}</a>
<a class="k-btn k-btn--secondary" href="/#projects">${esc(t(lang, 'nf.projects'))}</a></div></div>`;
}

function serverError({ lang }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.plug}
<h1>${esc(t(lang, 'err.h1'))}</h1><p>${esc(t(lang, 'err.lead'))}</p>
<div class="k-row" style="justify-content:center"><a class="k-btn k-btn--brand" href="">${esc(t(lang, 'err.retry'))}</a>
<a class="k-btn k-btn--secondary" href="/contact">${esc(t(lang, 'contact.h1'))}</a></div></div>`;
}

function notOnTier({ lang, name, path }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.plug}
<h1>${esc(t(lang, 'notier.h1', { name }))}</h1><p>${esc(t(lang, 'notier.lead', { path }))}</p>
<a class="k-btn k-btn--secondary" href="/#projects">${esc(t(lang, 'nf.projects'))}</a></div>`;
}

module.exports = {
  KESARI, LANGS, langOf, t, layout, strings, SIGN_IN,
  home, about, contact, privacy, terms, chooser, signIn, notFound, serverError, notOnTier, tileHtml, TOPICS,
};
