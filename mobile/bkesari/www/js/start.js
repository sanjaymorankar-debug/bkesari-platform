/**
 * The bkesari app's start screen (www/index.html, the app's own page at
 * https://localhost/ on Android and capacitor://localhost/ on iOS).
 *
 * - "Continue with Google": PKCE in auth-core.js, the hub's /mobile-auth/start
 *   in the system browser (@capacitor/browser), the `<scheme>://auth-callback`
 *   link back (@capacitor/app, appUrlOpen), then /mobile-auth/finish in this
 *   WebView, which gives the WebView its own bk_sid and lands on / (the projects).
 * - "Sign in with an email code": the hub's own sign-in page, in this WebView.
 * - Projects (/), Request access (/access/request), Profile (/account): hub pages.
 *
 * After the first visit the app goes straight to the hub at launch. The screen
 * comes back with Android's back button from the first hub page, and when the
 * hub sends the app here with ?google=1 (its own Continue with Google, inside
 * the app: Google refuses WebViews). See mobile/README.md.
 */
(function () {
  'use strict';

  var cfg = window.BKESARI_APP;
  var Auth = window.BkesariAuth;
  var core = window.capacitorExports;
  var Cap = core && core.Capacitor;
  var App = window.capacitorApp && window.capacitorApp.App;
  var Browser = window.capacitorBrowser && window.capacitorBrowser.Browser;
  var isNative = Boolean(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  /** localStorage: this phone has gone on to the hub before, so later launches open it directly. */
  var KEY_CONTINUED = 'bk.continued';
  /** sessionStorage: this run of the app has already been through the start screen. */
  var KEY_LAUNCHED = 'bk.launched';
  /** localStorage: the code last redeemed, so a launch link read again (back button) is ignored. */
  var KEY_LAST_CODE = 'bk.mobileAuth.lastCode';

  function memoryStorage() {
    var items = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null; },
      setItem: function (key, value) { items[key] = String(value); },
      removeItem: function (key) { delete items[key]; }
    };
  }

  function storage(name) {
    try {
      var store = window[name];
      store.getItem('bk.probe');
      return store;
    } catch (error) {
      return memoryStorage();
    }
  }

  var local = storage('localStorage');
  var session = storage('sessionStorage');

  var googleButton = document.getElementById('google');
  var emailLink = document.getElementById('email');
  var statusLine = document.getElementById('status');
  var routes = document.getElementById('routes');
  var busy = false;

  function setStatus(message, isError) {
    statusLine.textContent = message || '';
    statusLine.className = isError ? 'status error' : 'status';
  }

  function setBusy(value) {
    busy = value;
    googleButton.disabled = value;
    googleButton.setAttribute('aria-busy', value ? 'true' : 'false');
  }

  function show() {
    document.body.classList.remove('is-starting');
    routes.hidden = local.getItem(KEY_CONTINUED) !== '1';
  }

  /** Opens a hub page in this WebView. The start screen stays in the history (Android's back button). */
  function openSite(path, replace) {
    local.setItem(KEY_CONTINUED, '1');
    var url = Auth.siteUrl(cfg.site, path);
    if (replace) window.location.replace(url);
    else window.location.assign(url);
  }

  async function startGoogle() {
    if (busy) return;
    if (!isNative || !Browser) {
      // Previewing www/ in a desktop browser: the hub's web sign-in works there.
      openSite('/auth/google/start?next=%2F');
      return;
    }
    setBusy(true);
    setStatus('Opening Google…');
    try {
      var verifier = Auth.createVerifier(window.crypto);
      var challenge = await Auth.challengeFor(verifier, window.crypto && window.crypto.subtle);
      Auth.savePending(local, verifier, Date.now());
      await Browser.open({ url: Auth.startUrl(cfg.site, cfg.scheme, challenge), toolbarColor: '#C2560A' });
      setStatus('Signing in with Google in the browser…');
    } catch (error) {
      setBusy(false);
      setStatus('Could not open Google sign-in. Check the internet connection and try again.', true);
    }
  }

  /**
   * A link the app was opened with. 'navigating' when it was our sign-in code
   * and the WebView is on its way to /mobile-auth/finish, 'shown' when the
   * screen now shows why it could not be, 'ignored' when it is not ours or was
   * already used.
   */
  function handleUrl(url) {
    var callback = Auth.parseCallback(url, cfg.scheme);
    if (!callback) return 'ignored';
    if (callback.code && local.getItem(KEY_LAST_CODE) === callback.code) return 'ignored';
    if (Browser) Browser.close().catch(function () {});
    var verifier = Auth.takePending(local, Date.now());
    setBusy(false);
    show();
    if (!callback.code) {
      setStatus('Google sign-in did not finish. Please try again.', true);
      return 'shown';
    }
    if (!verifier) {
      setStatus('This sign-in has expired. Tap Continue with Google again.', true);
      return 'shown';
    }
    local.setItem(KEY_LAST_CODE, callback.code);
    local.setItem(KEY_CONTINUED, '1');
    setStatus('Signing you in…');
    window.location.replace(Auth.finishUrl(cfg.site, callback.code, verifier));
    return 'navigating';
  }

  async function init() {
    document.getElementById('version').textContent = 'Version ' + cfg.version;
    emailLink.href = Auth.siteUrl(cfg.site, '/auth/sign-in?next=%2F');
    emailLink.addEventListener('click', function (event) {
      event.preventDefault();
      openSite('/auth/sign-in?next=%2F');
    });
    googleButton.addEventListener('click', function () { startGoogle(); });
    Array.prototype.forEach.call(routes.querySelectorAll('a[data-path]'), function (link) {
      var path = link.getAttribute('data-path');
      link.href = Auth.siteUrl(cfg.site, path);
      link.addEventListener('click', function (event) {
        event.preventDefault();
        openSite(path);
      });
    });

    if (!Auth.isValidSite(cfg.site) || !Auth.isAllowedScheme(cfg.scheme)) {
      googleButton.disabled = true;
      setStatus('This build is not set up for sign-in (www/config.js).', true);
      show();
      return;
    }

    // Only the first load in a run of the app may go on to the hub by itself; a later one is
    // the back button, which must show this screen. Noted before anything can return early.
    var firstLoad = session.getItem(KEY_LAUNCHED) !== '1';
    session.setItem(KEY_LAUNCHED, '1');

    var wantsGoogle = new URLSearchParams(window.location.search).get('google') === '1';
    // Drop ?google=1 so coming back to this page later does not start another sign-in.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);

    if (isNative && App) {
      App.addListener('appUrlOpen', function (event) { handleUrl(event && event.url); });
      if (Browser) {
        Browser.addListener('browserFinished', function () {
          if (busy) {
            setBusy(false);
            setStatus('');
          }
        });
      }
      try {
        // Android ended the app while the browser was open: the link arrives as the launch link.
        var launch = await App.getLaunchUrl();
        if (launch && launch.url && handleUrl(launch.url) !== 'ignored') return;
      } catch (error) {
        // No launch link.
      }
    }

    if (wantsGoogle) {
      show();
      startGoogle();
      return;
    }

    if (firstLoad && local.getItem(KEY_CONTINUED) === '1') {
      openSite('/');
      return;
    }
    show();
  }

  // Back from the hub with the page restored from the back/forward cache.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      setBusy(false);
      setStatus('');
      show();
    }
  });

  init().catch(function () {
    show();
  });
})();
