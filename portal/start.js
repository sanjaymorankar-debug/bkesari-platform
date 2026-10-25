// Entry file for hosts that load the app through their own launcher, such as
// Hostinger's Node.js hosting, where `require.main === module` is false in
// server.js and the server would never start. `npm start` keeps using server.js.
require('./server').main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
