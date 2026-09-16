/* ============================================================
   bkesari.com menu - edit this file to change the menu.

   The environment is picked from the address the page is opened on:
     test.bkesari.com (or localhost) -> ENV_PREFIX 'test'
                                        https://testladwani.bkesari.com
     bkesari.com                     -> ENV_PREFIX ''
                                        https://ladwani.bkesari.com

   Each site uses either `sub` (a subdomain of DOMAIN, gets the prefix)
   or `url` (a path on this same site, used as-is).
   ============================================================ */
(function () {
  const host = location.hostname.toLowerCase();
  const isTest = host.startsWith('test.') || host === 'localhost' || host === '127.0.0.1';

  window.BKESARI = {
    DOMAIN: 'bkesari.com',
    ENV_PREFIX: isTest ? 'test' : '',
    SITES: [
      { name: 'Ladwani',           sub: 'ladwani',  icon: '👪', tagline: 'Family & community portal' },
      { name: 'Asmy Milks',        sub: 'asmymilk', icon: '🥛', tagline: 'Dairy & bakery ordering' },
      { name: 'ATIP',              url: '/atip/',   icon: '📈', tagline: 'Trading intelligence dashboard (view only)' },
      { name: 'Education',         sub: 'edu',      icon: '🎓', tagline: 'School & student governance platform' },
      { name: 'Driving Simulator', sub: 'driving',  icon: '🚗', tagline: 'Driver training simulator' },
      { name: 'Task Tracker',      url: '/tasks/',  icon: '✅', tagline: 'Projects, tasks & status updates' },
    ],
  };
})();
