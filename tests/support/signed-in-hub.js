/**
 * The real server.js app with one stand-in: Neon Auth's "who is signed in"
 * answers the owner (HUB_OWNER_EMAILS' first address, verified). Everything
 * else (the gates, the signed token, the proxy, the body parsers) is
 * server.js's own. TEST_SPEC.md S5 uses it to check the proxied tabs, which a
 * local run cannot otherwise sign in to. Reads DATABASE_URL and PORT like the
 * hub; never point it at anything but a scratch database.
 *
 * LadWani goes through the proxy (LADWANI_ORIGIN) by default. With
 * SIGNED_IN_HUB_LADWANI=embedded it is mounted in this process from its built
 * export, as main() does (portal/ladwani.js); its API then reads
 * LADWANI_DATABASE_URL, which must also name a scratch database.
 */
const createDb = require('../../portal/db.js');
const { createApp } = require('../../portal/server.js');
const { ownerEmails } = require('../../portal/hub.js');

(async () => {
  const db = await createDb({ schemaFiles: ['hub_schema.sql', 'tasklist_schema.sql', 'atip_schema.sql'] });
  const owner = { id: 'signed-in-owner', email: [...ownerEmails()][0], emailVerified: true };
  const embed = process.env.SIGNED_IN_HUB_LADWANI === 'embedded';
  const { app, ladwaniTab } = createApp(db, { getUser: async () => owner, ...(embed ? { ladwani: {} } : {}) });
  if (embed && !ladwaniTab) throw new Error('SIGNED_IN_HUB_LADWANI=embedded, but ladwani/apps/web/out is not built');
  if (ladwaniTab) console.log(`LadWani API: ${await ladwaniTab.api}`);
  const port = Number(process.env.PORT || 3101);
  app.listen(port, '127.0.0.1', () => console.log(`bkesari portal running at http://127.0.0.1:${port} (signed in as the owner)`));
})().catch((err) => { console.error('Failed to start:', err.message); process.exit(1); });
