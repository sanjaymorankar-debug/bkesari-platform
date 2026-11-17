/**
 * bkesari app: the pure parts of "Continue with Google" (decision D-039,
 * docs/design/bkesari-id.md section 1, row "Mobile"). No Capacitor, no DOM:
 * start.js wires these to the plugins and the screen, and
 * mobile/test/bkesari-auth.test.js tests them with node:test.
 *
 * Google refuses to sign anyone in inside a WebView, so the app opens the hub
 * in the system browser (Custom Tab / SFSafariViewController):
 *
 *   app      makes a random verifier, keeps it, sends only its SHA-256 (challenge)
 *   browser  GET <site>/mobile-auth/start?app=<scheme>&challenge=<challenge>
 *            -> Google -> <site>/mobile-auth/complete
 *            -> <scheme>://auth-callback?code=<code>
 *   app      WebView: GET <site>/mobile-auth/finish?code=<code>&verifier=<verifier>
 *            -> the hub sets bk_sid in the WebView and redirects to /
 *
 * PKCE (RFC 7636, S256): another app that registers the same scheme can catch
 * the code but cannot redeem it without the verifier, which never leaves this
 * app. Same design as GoKesari's mobile/src/google-sign-in.ts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BkesariAuth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Schemes the hub hands a sign-in code back to. The hub keeps the same list. */
  var HUB_SCHEMES = ['in.bkesari.app'];
  /** `<scheme>://auth-callback?code=...` */
  var CALLBACK_HOST = 'auth-callback';
  /** How long a started sign-in waits for the browser to come back (the hub's code itself lasts 2 minutes). */
  var PENDING_TTL_MS = 10 * 60 * 1000;
  var PENDING_KEY = 'bk.mobileAuth.pending';

  /** RFC 7636 section 4.1 code_verifier; ours is always 43 characters (32 random bytes). */
  var VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
  /** base64url of a SHA-256 digest: always 43 characters. */
  var CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
  /** The code is the hub's to check (HMAC); here it only has to be printable ASCII of sane length. */
  var CODE_RE = /^[\x21-\x7E]{1,2048}$/;
  /** The hub's origin: https, no path, no trailing slash. */
  var SITE_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  /** An absolute path on the hub: one leading slash, no backslash, no whitespace. */
  var PATH_RE = /^\/(?!\/)[^\s\\]*$/;

  var B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function base64url(bytes) {
    var out = '';
    var i = 0;
    var n;
    for (; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
    }
    if (bytes.length - i === 1) {
      n = bytes[i] << 16;
      out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    } else if (bytes.length - i === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
    }
    return out;
  }

  function asciiBytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  /* SHA-256 (FIPS 180-4), used only when SubtleCrypto is missing (it needs a secure context). */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256(bytes) {
    var bitLength = bytes.length * 8;
    var padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(padded.length - 4, bitLength >>> 0);

    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var offset = 0; offset < padded.length; offset += 64) {
      var t;
      for (t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
      for (t = 16; t < 64; t++) {
        var x = w[t - 15];
        var y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    var outView = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) outView.setUint32(j * 4, h[j]);
    return out;
  }

  /** 32 random bytes as base64url: a 43-character RFC 7636 verifier. `cryptoObj` is `window.crypto`. */
  function createVerifier(cryptoObj) {
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
      throw new Error('No secure random source.');
    }
    var bytes = new Uint8Array(32);
    cryptoObj.getRandomValues(bytes);
    return base64url(bytes);
  }

  /**
   * The S256 challenge for a verifier: base64url(SHA-256(verifier)), 43 characters.
   * Uses SubtleCrypto when given (`window.crypto.subtle`), else the SHA-256 above.
   */
  function challengeFor(verifier, subtle) {
    if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) {
      return Promise.reject(new Error('Invalid PKCE verifier.'));
    }
    var bytes = asciiBytes(verifier);
    var fallback = function () { return base64url(sha256(bytes)); };
    if (subtle && typeof subtle.digest === 'function') {
      return Promise.resolve()
        .then(function () { return subtle.digest('SHA-256', bytes); })
        .then(function (digest) { return base64url(new Uint8Array(digest)); }, fallback);
    }
    return Promise.resolve(fallback());
  }

  function isAllowedScheme(scheme) {
    return typeof scheme === 'string' && HUB_SCHEMES.indexOf(scheme) !== -1;
  }

  function isValidSite(site) {
    return typeof site === 'string' && SITE_RE.test(site);
  }

  function checkSite(site) {
    if (!isValidSite(site)) throw new Error('The site must be an https origin without a trailing slash.');
  }

  /** Opened in the system browser. */
  function startUrl(site, scheme, challenge) {
    checkSite(site);
    if (!isAllowedScheme(scheme)) throw new Error('This app scheme is not one the hub accepts.');
    if (typeof challenge !== 'string' || !CHALLENGE_RE.test(challenge)) throw new Error('Invalid PKCE challenge.');
    return site + '/mobile-auth/start?app=' + encodeURIComponent(scheme) + '&challenge=' + challenge;
  }

  /**
   * What `url` means for this app: null when it is not our `auth-callback`
   * link (another link, another scheme, another host), `{ code }` when it
   * carries a code, `{ error }` when it came back without one.
   */
  function parseCallback(url, scheme) {
    if (typeof url !== 'string' || !isAllowedScheme(scheme)) return null;
    var prefix = scheme + '://' + CALLBACK_HOST;
    if (url.slice(0, prefix.length).toLowerCase() !== prefix) return null;
    var rest = url.slice(prefix.length).split('#')[0];
    if (rest.charAt(0) === '/') rest = rest.slice(1);
    if (rest !== '' && rest.charAt(0) !== '?') return null;
    var params = new URLSearchParams(rest.slice(1));
    var code = params.get('code');
    if (code !== null && CODE_RE.test(code)) return { code: code };
    var error = params.get('error');
    return { error: error && CODE_RE.test(error) ? error : 'missing_code' };
  }

  /** Loaded in the WebView; the hub sets bk_sid and redirects to /. */
  function finishUrl(site, code, verifier) {
    checkSite(site);
    if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('Invalid sign-in code.');
    if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) throw new Error('Invalid PKCE verifier.');
    return site + '/mobile-auth/finish?code=' + encodeURIComponent(code) + '&verifier=' + encodeURIComponent(verifier);
  }

  /** A page of the hub, for the app's own links (Projects /, Request access /access/request, Profile /account). */
  function siteUrl(site, path) {
    checkSite(site);
    if (typeof path !== 'string' || !PATH_RE.test(path)) throw new Error('Not a path on the site.');
    return site + path;
  }

  /** Remembers the verifier until the browser comes back (survives Android ending the app meanwhile). */
  function savePending(storage, verifier, now) {
    if (!VERIFIER_RE.test(verifier)) throw new Error('Invalid PKCE verifier.');
    storage.setItem(PENDING_KEY, JSON.stringify({ v: verifier, at: now }));
  }

  /** The verifier of the sign-in in progress, once: it is forgotten here whether or not it is still valid. */
  function takePending(storage, now) {
    var raw = storage.getItem(PENDING_KEY);
    storage.removeItem(PENDING_KEY);
    var pending;
    try {
      pending = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!pending || typeof pending.v !== 'string' || !VERIFIER_RE.test(pending.v)) return null;
    if (typeof pending.at !== 'number' || now - pending.at > PENDING_TTL_MS || pending.at - now > 60 * 1000) return null;
    return pending.v;
  }

  return {
    HUB_SCHEMES: HUB_SCHEMES.slice(),
    CALLBACK_HOST: CALLBACK_HOST,
    PENDING_KEY: PENDING_KEY,
    PENDING_TTL_MS: PENDING_TTL_MS,
    base64url: base64url,
    sha256: sha256,
    createVerifier: createVerifier,
    challengeFor: challengeFor,
    isAllowedScheme: isAllowedScheme,
    isValidSite: isValidSite,
    startUrl: startUrl,
    parseCallback: parseCallback,
    finishUrl: finishUrl,
    siteUrl: siteUrl,
    savePending: savePending,
    takePending: takePending
  };
});
