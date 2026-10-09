/**
 * Which tabs a visitor sees. Server side only.
 *
 * The owner-only ATIP tab is defined here and nowhere public: the static
 * menu.js that every browser downloads never names it.
 */
const menu = require('../public/shared/menu.js');

const OWNER_TABS = Object.freeze([
  { name: 'ATIP', path: '/atip/', icon: '📈', tagline: 'Trading intelligence (owner only)' },
]);

/**
 * Logged out: every public tab, so the catalogue is visible and each project
 * tab leads to sign-in. Logged in: static pages plus the features the user
 * is entitled to. The owner (with TOTP passed) also gets ATIP, placed where
 * it always sat in the bar.
 */
function tabsFor(resolved) {
  if (!resolved) return menu.TABS.map(strip);
  const entitled = new Set(resolved.evaluation.features);
  const tabs = menu.TABS.filter(t => !t.feature || entitled.has(t.feature)).map(strip);
  if (resolved.atip) {
    const at = tabs.findIndex(t => t.path === '/driving-simulator/');
    tabs.splice(at < 0 ? tabs.length : at, 0, ...OWNER_TABS.map(strip));
  }
  return tabs;
}

function accountFor(resolved) {
  if (!resolved) return { label: 'Sign in', href: '/auth/login' };
  return { label: resolved.user.name || resolved.user.email, href: '/auth/account' };
}

function strip(tab) {
  return { name: tab.name, path: tab.path, icon: tab.icon, tagline: tab.tagline };
}

module.exports = { tabsFor, accountFor, OWNER_TABS };
