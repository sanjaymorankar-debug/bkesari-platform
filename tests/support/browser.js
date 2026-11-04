'use strict';

/**
 * A minimal browser for the API tests: keeps cookies the way a browser does
 * for one host (by name AND path, sending a cookie only under its Path), and
 * never follows redirects, so a test sees each one.
 */
class Browser {
  constructor(base) { this.base = base; this.jar = new Map(); this.origin = new URL(base).origin; }

  cookieFor(path) {
    const out = [];
    for (const c of this.jar.values()) {
      const p = c.path.replace(/\/$/, '');
      if (path === c.path || path === p || path.startsWith(`${p}/`) || c.path === '/') out.push(`${c.name}=${c.value}`);
    }
    return out.join('; ');
  }

  /** Every cookie the browser holds, with its attributes. */
  cookies() { return [...this.jar.values()]; }
  get(name) { return [...this.jar.values()].find((c) => c.name === name) || null; }

  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(/;\s*/);
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      const c = { name, value, path: '/', httpOnly: false, secure: false, sameSite: null, maxAge: null, raw: line };
      for (const a of attrs) {
        const [k, v] = a.split('=');
        const key = k.toLowerCase();
        if (key === 'path') c.path = v;
        if (key === 'httponly') c.httpOnly = true;
        if (key === 'secure') c.secure = true;
        if (key === 'samesite') c.sameSite = v;
        if (key === 'max-age') c.maxAge = Number(v);
      }
      const id = `${name}|${c.path}`;
      if (c.maxAge === 0 || value === '') this.jar.delete(id); else this.jar.set(id, c);
    }
  }

  async fetch(method, path, { body, json, headers = {}, csrf } = {}) {
    const url = new URL(path, this.base);
    const h = { accept: 'application/json', ...headers };
    const cookie = this.cookieFor(url.pathname);
    if (cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    let payload = body;
    if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json); }
    const res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: res.status, json: data, text, headers: res.headers, location: res.headers.get('location') };
  }
}

module.exports = { Browser };
