/* ============================================================
   bkesari.com menu - edit this file to change the menu.

   ENV_PREFIX is added in front of every subdomain:
     'test' -> https://testladwani.bkesari.com   (testing)
     ''     -> https://ladwani.bkesari.com       (production)

   Each site uses either `sub` (a subdomain of DOMAIN) or `url`
   (a full link / path, used as-is).
   ============================================================ */
window.BKESARI = {
  DOMAIN: 'bkesari.com',
  ENV_PREFIX: 'test',
  SITES: [
    { name: 'Ladwani',           sub: 'ladwani',   icon: '👪', tagline: 'Family & community portal' },
    { name: 'Asmy Milks',        sub: 'asmymilk',  icon: '🥛', tagline: 'Dairy & bakery ordering' },
    { name: 'ATIP',              sub: 'atip',      icon: '📈', tagline: 'ATIP platform' },
    { name: 'Education',         sub: 'edu',       icon: '🎓', tagline: 'Student growth & school platform' },
    { name: 'Driving Simulator', sub: 'driving',   icon: '🚗', tagline: 'Driver training simulator' },
    { name: 'Task Tracker',      url: '/tasks/',   icon: '✅', tagline: 'Projects, tasks & status updates' },
  ],
};
