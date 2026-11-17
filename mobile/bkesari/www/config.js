/**
 * This build's settings. Keep in step with capacitor.config.json (allowNavigation,
 * appendUserAgent), android/app/build.gradle (versionName) and the iOS project
 * (MARKETING_VERSION): mobile/test/bkesari-shell.test.js checks they agree.
 *
 * A build for the test server: site "https://test.bkesari.com" and
 * allowNavigation ["test.bkesari.com"] (mobile/README.md). Never ship that to a store.
 */
(function (root) {
  var config = {
    /** The hub: home (/) is the project list with each project's access status. */
    site: 'https://bkesari.com',
    /** The hub hands Google sign-in back to `<scheme>://auth-callback`. Same as the app id. */
    scheme: 'in.bkesari.app',
    version: '1.1.0'
  };
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.BKESARI_APP = config;
})(typeof self !== 'undefined' ? self : this);
