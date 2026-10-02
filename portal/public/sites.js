/* ============================================================
   bkesari.com menu - edit this file to change the menu.

   The environment is picked from the address the page is opened on:
     dev.bkesari.com                 -> ENV_PREFIX 'dev'
                                        https://devladwani.bkesari.com
     test.bkesari.com (or localhost) -> ENV_PREFIX 'test'
                                        https://testladwani.bkesari.com
     bkesari.com                     -> ENV_PREFIX ''
                                        https://ladwani.bkesari.com

   localhost stays on 'test' deliberately: the test subdomains already exist, so
   the menu's outbound links work while iterating locally. The dev subdomains are
   created per DEPLOY.md and may not resolve yet.

   Each site uses either `sub` (a subdomain of DOMAIN, gets the prefix)
   or `url` (a path on this same site, used as-is).
   ============================================================ */
(function () {
  const host = location.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  // Three tiers now (DEPLOY.md): dev -> test -> production. Without the dev case
  // dev.bkesari.com fell through to '' and linked every card at PRODUCTION.
  const prefix = host.startsWith('dev.') ? 'dev'
    : (host.startsWith('test.') || isLocal) ? 'test'
      : '';

  window.BKESARI = {
    DOMAIN: 'bkesari.com',
    ENV_PREFIX: prefix,
    SITES: [
      { name: 'Ladwani',           sub: 'ladwani',  icon: '👪', tagline: 'Family & community portal' },
      { name: 'Asmy Milks',        sub: 'asmymilk', icon: '🥛', tagline: 'Dairy & bakery ordering' },
      { name: 'ATIP',              url: '/ATIP/',   icon: '📈', tagline: 'AI trading intelligence platform' },
      { name: 'Education',         sub: 'edu',      icon: '🎓', tagline: 'School & student governance platform' },
      { name: 'Driving Simulator', sub: 'driving',  icon: '🚗', tagline: 'Driver training simulator' },
      { name: 'Task Tracker',      url: '/tasks/',  icon: '✅', tagline: 'Projects, tasks & status updates' },
    ],
  };
})();
