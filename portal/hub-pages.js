'use strict';

/* ============================================================
   The hub's own pages, rendered on the server in the visitor's language
   (cookie k_lang; portal/i18n/hub.json). Plain HTML on the Kesari design
   system: they work without JavaScript, and the only scripts are files on
   this origin, so the hub's Content-Security-Policy can forbid inline ones.
   ============================================================ */

const menu = require('./public/shared/menu.js');
const strings = require('./i18n/hub.json');
const iconSet = require('../packages/kesari-ui/src/icons.json');

/** Every Kesari icon, drawn inline by the server (no request, no script). */
const ICON = { ...iconSet.project, ...iconSet.ui };
function ico(name, cls = 'k-icon') {
  if (!ICON[name]) throw new Error(`no Kesari icon named ${name}`);
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
}

const KESARI = '/kesari-ui/1.1.0';
const LANGS = ['en', 'mr', 'hi'];
/** Preload for pages whose heading uses the display face (.k-display). */
const DISPLAY_FONT_PRELOAD = `<link rel="preload" href="${KESARI}/fonts/tiro-devanagari-marathi-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>`;
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
/** Projects with an accent of their own in Kesari (data-project). */
const PROJECTS = ['ladwani', 'education', 'tasklist', 'environment', 'driving', 'atip'];
const projectAttr = (key) => (PROJECTS.includes(key) ? ` data-project="${key}"` : '');
const picon = (key, cls = '') => `<span class="k-picon${cls ? ` ${cls}` : ''}">${ico(key)}</span>`;
const arrow = (name = 'arrow-right') => ico(name);

/** A project card: icon, status, name, one line, and "Open" (its link covers the card). */
function tileHtml(tile, lang) {
  const benefit = tile[`benefit_${lang}`] || tile.benefit_en;
  const ext = tile.external;
  const label = t(lang, 'tile.openName', { name: tile.name });
  return `<li><article class="k-pcard hub-tile"${projectAttr(tile.icon)}>
  <div class="k-pcard__head">${picon(tile.icon)}<span class="k-chip ${CHIP[tile.status] || ''}">${esc(t(lang, `chip.${tile.status}`))}</span></div>
  <h3 class="k-pcard__name">${esc(tile.name)}</h3>
  <p class="k-pcard__text">${esc(benefit)}</p>
  <a class="k-btn k-btn--soft k-pcard__cta" href="${esc(tile.href)}"${ext ? ` target="_blank" rel="noopener" aria-label="${esc(label)} (${esc(t(lang, 'tile.newWindow'))})"` : ''}>${esc(label)}${ext ? ico('external') : arrow()}</a>
</article></li>`;
}

function announcementHtml(a, lang) {
  if (!a) return '';
  const msg = a[`message_${lang}`] || a.message_en;
  return `<div class="k-banner k-banner--${esc(a.kind)} hub-announce" role="status"><p>${esc(msg)}${a.link ? ` <a href="${esc(a.link)}">→</a>` : ''}</p></div>`;
}

/**
 * The hero's picture: the bkesari mark with the projects around it, drawn
 * with the icon set in each project's own colours. Decorative.
 */
function heroArt(lang) {
  const ring = [['ladwani', 220, 50], ['education', 363, 115], ['tasklist', 363, 245], ['driving', 220, 310], ['environment', 77, 245], ['atip', 77, 115]];
  const tiles = ring.map(([key, x, y]) => `<g class="hub-art-tile" data-project="${key}" transform="translate(${x - 34} ${y - 34})">
  <rect width="68" height="68" rx="20"/><g transform="translate(16 16) scale(1.5)" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</g></g>`).join('');
  const lines = ring.map(([, x, y]) => `<line x1="220" y1="180" x2="${x}" y2="${y}"/>`).join('');
  return `<svg class="hub-art" viewBox="0 0 440 360" role="img" aria-label="${esc(t(lang, 'home.artLabel'))}">
<circle class="hub-art-halo" cx="220" cy="180" r="150"/><g class="hub-art-lines">${lines}</g>
<g class="hub-art-core"><rect x="164" y="124" width="112" height="112" rx="32"/><text x="220" y="203" text-anchor="middle">b</text></g>${tiles}</svg>`;
}

const LANG_NAMES = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };
/** Links to read the page in the other languages: Kesari switches in place; without scripts, /lang/xx sets the cookie. */
function langLinks(lang, next = '/') {
  return `<p class="hub-langs"><span>${esc(t(lang, 'home.readIn'))}</span> ${LANGS.filter((l) => l !== lang)
    .map((l) => `<a href="/lang/${l}?next=${encodeURIComponent(next)}" lang="${l}" hreflang="${l}" data-k-setlang="${l}">${LANG_NAMES[l]}</a>`).join(' <span aria-hidden="true">·</span> ')}</p>`;
}

function home({ lang, tiles, announcement }) {
  return `${announcementHtml(announcement, lang)}
<section class="k-hero hub-hero" aria-labelledby="hero-h">
  <div>
    <p class="k-eyebrow">${ico('home')} bkesari.com</p>
    <h1 id="hero-h" class="k-display">${esc(t(lang, 'home.h1'))}</h1>
    <p class="k-hero__lead hub-purpose">${esc(t(lang, 'home.purpose'))}</p>
    <p class="hub-lead2">${esc(t(lang, 'home.lead'))}</p>
    <div class="k-hero__actions"><a class="k-btn k-btn--brand" href="#projects">${esc(t(lang, 'home.cta'))}${ico('chevron-down')}</a>
      <a class="k-link-arrow" href="/about">${esc(t(lang, 'home.about'))}${arrow()}</a></div>
    ${langLinks(lang)}
  </div>
  <div class="k-hero__art">${heroArt(lang)}</div>
</section>
<section id="projects" class="k-section hub-projects" aria-labelledby="proj-h">
  <div class="k-section-head"><h2 id="proj-h">${esc(t(lang, 'home.projects'))}</h2><p>${esc(t(lang, 'home.projectsLead'))}</p></div>
  <ul class="hub-grid" role="list">${tiles.map((x) => tileHtml(x, lang)).join('')}</ul>
</section>
<section class="k-section hub-about" aria-labelledby="about-h">
  <div class="hub-about__text">
    <h2 id="about-h">${esc(t(lang, 'home.aboutH'))}</h2>
    <p>${esc(t(lang, 'home.aboutBody'))}</p>
    <a class="k-link-arrow" href="/about">${esc(t(lang, 'home.more'))}${arrow()}</a>
  </div>
  <ul class="k-features hub-values" role="list" aria-label="${esc(t(lang, 'home.why'))}">
    <li class="k-feature">${picon('globe', 'hub-vicon')}<h3>${esc(t(lang, 'home.v1t'))}</h3><p>${esc(t(lang, 'home.v1'))}</p></li>
    <li class="k-feature">${picon('phone', 'hub-vicon')}<h3>${esc(t(lang, 'home.v2t'))}</h3><p>${esc(t(lang, 'home.v2'))}</p></li>
    <li class="k-feature">${picon('shield', 'hub-vicon')}<h3>${esc(t(lang, 'home.v3t'))}</h3><p>${esc(t(lang, 'home.v3'))}</p></li>
    <li class="k-feature">${picon('lock', 'hub-vicon')}<h3>${esc(t(lang, 'home.accountsTitle'))}</h3><p>${esc(t(lang, 'home.accountsBody'))}</p>
      <a class="k-link-arrow" href="/auth/sign-in">${esc(t(lang, 'home.signInHelp'))}${arrow()}</a></li>
  </ul>
</section>`;
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

const TOPICS = ['general', 'ladwani', 'education', 'tasklist', 'driving', 'environment', 'privacy', 'problem'];

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

/** The projects that sign people in, and where. `approval`: someone in the project says yes first. */
const SIGN_IN = [
  { key: 'ladwani', name: 'LadWani', signIn: '/ladwani/sign-in/', join: '/ladwani/sign-up/', approval: true, steps: 3 },
  { key: 'education', name: 'Education', signIn: '/edu/sign-in', join: '/edu/sign-up', approval: true, steps: 3 },
  { key: 'tasklist', name: 'TaskList', signIn: '/tasklist/sign-in', join: '/tasklist/sign-up', approval: false, steps: 3 },
];
const accessChip = (lang, p) => `<span class="k-chip ${p.approval ? 'k-chip--soon' : 'k-chip--live'}">${esc(t(lang, p.approval ? 'access.chip.approval' : 'access.chip.open'))}</span>`;

function crumbs(lang, here) {
  return `<nav class="k-breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">${ico('home', 'k-icon k-icon--sm')}${esc(t(lang, 'account.home'))}</a></li><li><span aria-current="page">${esc(here)}</span></li></ol></nav>`;
}

/** Sign in: one card per project; the card's own link is the way in. */
function chooser({ lang }) {
  return `<div class="hub-narrow">
${crumbs(lang, t(lang, 'chooser.title'))}
<h1>${esc(t(lang, 'chooser.h1'))}</h1>
<p class="k-lead">${esc(t(lang, 'chooser.lead'))}</p>
<ul class="hub-choose" role="list">
${SIGN_IN.map((p) => `<li class="k-pcard hub-choice" data-project="${p.key}">
  <div class="k-pcard__head">${picon(p.key)}${accessChip(lang, p)}</div>
  <h2 class="k-pcard__name">${esc(p.name)}</h2>
  <p class="k-pcard__text">${esc(t(lang, `access.${p.key}.how`))}</p>
  <a class="k-btn k-btn--soft k-pcard__cta" href="${p.signIn}">${esc(t(lang, 'chooser.signIn', { name: p.name }))}${arrow()}</a>
  <a class="hub-choice__join" href="/request-access?project=${p.key}">${esc(t(lang, 'chooser.request', { name: p.name }))}</a>
</li>`).join('\n')}
</ul>
<p><a class="k-link-arrow" href="/account">${esc(t(lang, 'chooser.mine'))}${arrow()}</a></p>
<div class="k-banner k-banner--brand"><div><p><strong>${esc(t(lang, 'chooser.movedT'))}</strong></p><p>${esc(t(lang, 'chooser.moved'))}</p></div></div>
<p class="k-small"><a href="/admin">${esc(t(lang, 'chooser.admin'))}</a></p>
</div>`;
}

/**
 * Request access: step 1 picks a project (a plain GET form, so it works
 * without scripts); step 2 says what that project will ask and who approves,
 * then hands over to the project's own sign-up.
 */
function requestAccess({ lang, project, error }) {
  const chosen = SIGN_IN.find((p) => p.key === project);
  const stepper = (n) => `<p class="k-stepper__count">${esc(t(lang, 'request.stepOf', { n }))}</p>
<ol class="k-stepper">${[1, 2, 3].map((i) => `<li${i < n ? ' data-done' : ''}${i === n ? ' aria-current="step"' : ''}>${esc(t(lang, `request.step${i}`))}</li>`).join('')}</ol>`;
  if (chosen) {
    const steps = Array.from({ length: chosen.steps }, (_, i) => `<li><p>${esc(t(lang, `access.${chosen.key}.s${i + 1}`))}</p></li>`).join('');
    return `<div class="hub-narrow" data-project="${chosen.key}">
${crumbs(lang, t(lang, 'request.title'))}
${stepper(2)}
<div class="hub-req-head">${picon(chosen.key, 'k-picon--lg')}<div><h1>${esc(t(lang, 'request.nextH', { name: chosen.name }))}</h1>${accessChip(lang, chosen)}</div></div>
<ol class="k-steps k-steps--list hub-req-steps">${steps}</ol>
<div class="k-hero__actions"><a class="k-btn" href="${chosen.join}">${esc(t(lang, 'request.go', { name: chosen.name }))}${arrow()}</a>
<a class="k-link-arrow" href="${chosen.signIn}">${esc(t(lang, 'request.already', { name: chosen.name }))}</a></div>
<p class="hub-req-back"><a class="k-link-arrow" href="/request-access">${ico('arrow-left')}${esc(t(lang, 'request.back'))}</a></p>
</div>`;
  }
  return `<div class="hub-narrow">
${crumbs(lang, t(lang, 'request.title'))}
<h1>${esc(t(lang, 'request.h1'))}</h1>
<p class="k-lead">${esc(t(lang, 'request.lead'))}</p>
${stepper(1)}
<form class="hub-req" method="get" action="/request-access" novalidate>
<input type="hidden" name="step" value="2">
<fieldset${error ? ' aria-describedby="req-err"' : ''}><legend>${esc(t(lang, 'request.which'))}</legend>
${error ? `<p class="k-error" id="req-err" role="alert">${esc(t(lang, 'request.noPick'))}</p>` : ''}
<ul class="hub-req-list" role="list">
${SIGN_IN.map((p) => `<li data-project="${p.key}"><label class="hub-req-option"><input type="radio" name="project" value="${p.key}" required>
  ${picon(p.key)}<span><strong>${esc(p.name)}</strong> ${accessChip(lang, p)}<span class="hub-req-how">${esc(t(lang, `access.${p.key}.how`))}</span></span></label></li>`).join('\n')}
</ul></fieldset>
<button class="k-btn k-btn--brand" type="submit">${esc(t(lang, 'request.continue'))}${arrow()}</button>
</form>
<div class="k-banner"><div><p><strong>${esc(t(lang, 'request.publicT'))}</strong></p><p>${esc(t(lang, 'request.public'))} <a href="/driving-simulator/">Driving Simulator</a> · <a href="/environment/">${esc(t(lang, 'contact.topic.environment'))}</a></p></div></div>
</div>`;
}

/** The access levels the projects' own "me" endpoints name, in the visitor's language. */
const ROLE_KEYS = Object.keys(strings.en).filter((k) => k.startsWith('role.')).map((k) => k.slice(5));

/**
 * My projects and access. The server knows nobody (each project signs its own
 * people in), so the rows start as "Checking…" and /shared/account.js asks
 * each project's own endpoint from the browser, with that project's cookie.
 */
function account({ lang, isOwner }) {
  const rows = SIGN_IN.map((p) => ({ ...p, me: { ladwani: '/ladwani/api/v1/auth/session', education: '/edu/shell/me', tasklist: '/tasklist/api/auth/me' }[p.key] }));
  const words = Object.fromEntries(['checking', 'signedIn', 'as', 'level', 'signedOut', 'pending', 'pendingNote', 'error', 'errorNote', 'retry', 'open', 'signIn', 'request', 'seeStatus']
    .map((k) => [k, t(lang, `account.${k}`)]));
  words.roles = Object.fromEntries(ROLE_KEYS.map((r) => [r, t(lang, `role.${r}`)]));
  const row = (p) => `<li class="k-statusrow" data-project="${p.key}" data-account-row data-me="${p.me}" data-name="${esc(p.name)}" data-open="${p.key === 'ladwani' ? '/ladwani/' : p.key === 'education' ? '/edu/dashboard' : '/tasklist/'}" data-signin="${p.signIn}" data-request="/request-access?project=${p.key}"${p.key === 'ladwani' ? ' data-pending="/ladwani/pending/"' : ''}>
  ${picon(p.key)}
  <div><h3>${esc(p.name)}</h3><div class="k-statusrow__meta" data-account-status aria-live="polite"><span class="k-skel k-skel--line hub-skel-chip" aria-hidden="true"></span><span class="k-sr-only">${esc(words.checking)}</span></div>
  <p data-account-note>${esc(t(lang, `access.${p.key}.how`))}</p></div>
  <div class="k-statusrow__action" data-account-action><a class="k-btn k-btn--secondary" href="${p.signIn}">${esc(words.signIn)}</a></div>
</li>`;
  return `<div class="hub-mid" data-account data-words="${esc(JSON.stringify(words))}">
${crumbs(lang, t(lang, 'account.title'))}
<h1>${esc(t(lang, 'account.title'))}</h1>
<p class="k-lead">${esc(t(lang, 'account.lead'))}</p>
<noscript><div class="k-banner k-banner--warning"><p>${esc(t(lang, 'account.noscript'))}</p></div></noscript>
<h2 class="hub-h2-sm">${esc(t(lang, 'account.yours'))}</h2>
<ul class="k-statuslist" role="list">${rows.map(row).join('\n')}
${isOwner ? `<li class="k-statusrow" data-project="atip">${picon('atip')}<div><h3>ATIP</h3><div class="k-statusrow__meta"><span class="k-chip k-chip--live">${esc(words.signedIn)}</span><span class="k-chip k-chip--accent">${esc(t(lang, 'account.level', { role: t(lang, 'account.atipLevel') }))}</span></div><p>${esc(t(lang, 'account.atipNote'))}</p></div>
  <div class="k-statusrow__action"><a class="k-btn k-btn--soft" href="/ATIP/" target="_blank" rel="noopener">${esc(t(lang, 'account.open', { name: 'ATIP' }))}${ico('external')}</a></div></li>` : ''}
</ul>
<h2 class="hub-h2-sm">${esc(t(lang, 'account.openT'))}</h2>
<ul class="k-statuslist" role="list">
${[['driving', 'Driving Simulator', '/driving-simulator/'], ['environment', t(lang, 'contact.topic.environment'), '/environment/']].map(([key, name, href]) => `<li class="k-statusrow" data-project="${key}">${picon(key)}<div><h3>${esc(name)}</h3><p>${esc(t(lang, 'account.openNote'))}</p></div>
  <div class="k-statusrow__action"><a class="k-btn k-btn--soft" href="${href}">${esc(t(lang, 'account.open', { name }))}${arrow()}</a></div></li>`).join('\n')}
</ul>
<aside class="k-card hub-why"><h2>${esc(t(lang, 'account.whyT'))}</h2><p>${esc(t(lang, 'account.why'))}</p>
<a class="k-link-arrow" href="/request-access">${esc(t(lang, 'request.h1'))}${arrow()}</a></aside>
</div>`;
}

/** Shortcut tiles for the error pages: every public project, by its icon. */
function projectLinks(lang) {
  return `<ul class="hub-jump" role="list">${menu.TABS.filter((x) => !x.ownerOnly).map((x) => `<li${projectAttr(x.key)}><a href="${x.path}">${picon(x.icon, 'k-picon--sm')}<span>${esc(x.name)}</span></a></li>`).join('')}</ul>`;
}

function notFound({ lang }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.compass}
<h1>${esc(t(lang, 'nf.h1'))}</h1><p>${esc(t(lang, 'nf.lead'))}</p>
<div class="k-row hub-error__actions"><a class="k-btn k-btn--brand" href="/">${esc(t(lang, 'nf.home'))}</a>
<a class="k-link-arrow" href="/contact?topic=problem">${esc(t(lang, 'contact.h1'))}${arrow()}</a></div>
<h2 class="hub-h2-sm">${esc(t(lang, 'nf.suggest'))}</h2>${projectLinks(lang)}</div>`;
}

function serverError({ lang }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.plug}
<h1>${esc(t(lang, 'err.h1'))}</h1><p>${esc(t(lang, 'err.lead'))}</p><p class="k-small">${esc(t(lang, 'err.status'))}</p>
<div class="k-row hub-error__actions"><a class="k-btn k-btn--brand" href="">${esc(t(lang, 'err.retry'))}</a>
<a class="k-link-arrow" href="/contact?topic=problem">${esc(t(lang, 'contact.h1'))}${arrow()}</a></div></div>`;
}

function notOnTier({ lang, name, path }) {
  return `<div class="k-empty hub-error">${ILLUSTRATION.plug}
<h1>${esc(t(lang, 'notier.h1', { name }))}</h1><p>${esc(t(lang, 'notier.lead', { path }))}</p>
<a class="k-btn k-btn--secondary" href="/#projects">${esc(t(lang, 'nf.projects'))}</a>${projectLinks(lang)}</div>`;
}

module.exports = {
  KESARI, LANGS, DISPLAY_FONT_PRELOAD, langOf, t, layout, strings, SIGN_IN,
  home, about, contact, privacy, terms, chooser, requestAccess, account, notFound, serverError, notOnTier, tileHtml, TOPICS, ICON, ico, langLinks,
};
