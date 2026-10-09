/**
 * CSRF protection for every form the auth service renders.
 *
 * Double-submit with a keyed MAC: the browser holds a random value in an
 * HttpOnly cookie, and each form carries HMAC(key, value). A forged
 * cross-site POST can neither read the cookie nor compute the MAC. The session
 * cookie's SameSite=Lax is the second layer.
 */
const { hmac } = require('./crypto');
const { randomToken, parseCookies, serializeCookie, appendCookie, safeEqual } = require('./util');

function createCsrf(config) {
  function cookieValue(req) {
    return parseCookies(req.headers.cookie)[config.csrfCookieName] || null;
  }

  /** The token for this browser's forms, setting the cookie if it has none. */
  function token(req, res) {
    let value = req._bkCsrf || cookieValue(req);
    if (!value || value.length < 20 || value.length > 100) {
      value = randomToken(24);
      appendCookie(res, serializeCookie(config.csrfCookieName, value, {
        secure: config.secure, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 30,
      }));
    }
    req._bkCsrf = value;
    return hmac(config.keys.csrf, value);
  }

  function valid(req) {
    const value = cookieValue(req);
    const given = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!value || !given) return false;
    return safeEqual(String(given), hmac(config.keys.csrf, value));
  }

  /** Middleware for POST routes. */
  function check(req, res, next) {
    if (valid(req)) return next();
    res.status(403).type('text').send('This form expired or did not come from this site. Go back, reload the page and try again.');
  }

  return { token, valid, check };
}

module.exports = { createCsrf };
