/**
 * Kesari runtime: theme, language, formatting, toasts, dialogs and OTP
 * inputs. Framework-agnostic; loads as a plain <script> in the browser
 * (window.Kesari) and as a CommonJS module in Node, where the pure parts
 * (formatters, the language and theme resolution) are tested.
 *
 * Preferences are per browser, not per account, and shared across projects:
 *   theme    localStorage 'kesari.theme'  system | light | dark
 *   language localStorage 'kesari.lang' and the cookie k_lang (Path=/) so a
 *            server-rendered project can pick the same language. Neither
 *            carries anything about who the person is.
 * Every storage access is wrapped: private windows and blocked storage
 * throw, and the page must still work.
 */
(function (root, factory) {
  const api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Kesari = api; api.boot(); }
})(typeof self !== 'undefined' ? self : globalThis, function (win) {
  'use strict';

  const VERSION = '1.0.0';
  const LANGS = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'mr', label: 'मराठी', short: 'मरा' },
    { code: 'hi', label: 'हिंदी', short: 'हिं' },
  ];
  const THEMES = ['system', 'light', 'dark'];
  const IST_OFFSET_MIN = 330; // UTC + 5:30
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- safe storage ---------- */
  const store = {
    get(key) { try { return win && win.localStorage ? win.localStorage.getItem(key) : null; } catch { return null; } },
    set(key, value) { try { if (win && win.localStorage) win.localStorage.setItem(key, value); } catch { /* blocked */ } },
    remove(key) { try { if (win && win.localStorage) win.localStorage.removeItem(key); } catch { /* blocked */ } },
  };

  function readCookie(name, cookieString) {
    const src = cookieString != null ? cookieString : (win && win.document ? win.document.cookie : '');
    const hit = String(src || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  }

  /* ---------- language ---------- */
  const isLang = (c) => LANGS.some((l) => l.code === c);

  /** The language to show: saved choice, then cookie, then the browser's, then English. */
  function resolveLang({ saved, cookie, navigatorLangs } = {}) {
    if (isLang(saved)) return saved;
    if (isLang(cookie)) return cookie;
    for (const n of navigatorLangs || []) {
      const c = String(n || '').slice(0, 2).toLowerCase();
      if (isLang(c)) return c;
    }
    return 'en';
  }

  function currentLang() {
    return resolveLang({
      saved: store.get('kesari.lang'),
      cookie: readCookie('k_lang'),
      navigatorLangs: win && win.navigator ? win.navigator.languages || [win.navigator.language] : [],
    });
  }

  /* ---------- i18n ----------
     English lives in the markup itself; other languages are JSON files named by
     the page: <html data-i18n-src="/i18n/hub"> loads /i18n/hub.mr.json. Elements
     carry data-i18n="key" (text) and data-i18n-attr="placeholder:key;aria-label:key". */
  const dictionaries = {};
  const originals = new WeakMap();

  function add(lang, dict) { dictionaries[lang] = Object.assign(dictionaries[lang] || {}, dict); }

  function t(key, vars, lang) {
    const l = lang || currentLang();
    let s = (dictionaries[l] && dictionaries[l][key]) || (dictionaries.en && dictionaries.en[key]) || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }

  async function load(lang) {
    if (!win || lang === 'en' || dictionaries[lang + ':loaded']) return;
    const srcs = (win.document.documentElement.getAttribute('data-i18n-src') || '').split(/\s+/).filter(Boolean);
    await Promise.all(srcs.map((src) => fetch(`${src}.${lang}.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : {})).then((d) => add(lang, d)).catch(() => {})));
    dictionaries[lang + ':loaded'] = true;
  }

  function apply(lang, scope) {
    if (!win) return;
    const doc = win.document;
    const rootEl = scope || doc;
    const dict = dictionaries[lang] || {};
    rootEl.querySelectorAll('[data-i18n]').forEach((el) => {
      if (!originals.has(el)) originals.set(el, el.innerHTML);
      const key = el.getAttribute('data-i18n');
      el.innerHTML = lang === 'en' || !dict[key] ? originals.get(el) : escapeHtml(dict[key]).replace(/\n/g, '<br>');
    });
    rootEl.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
        const [attr, key] = pair.split(':').map((x) => x && x.trim());
        if (!attr || !key) return;
        const store_ = `k-orig-${attr}`;
        if (!el.hasAttribute(`data-${store_}`)) el.setAttribute(`data-${store_}`, el.getAttribute(attr) || '');
        el.setAttribute(attr, lang === 'en' || !dict[key] ? el.getAttribute(`data-${store_}`) : dict[key]);
      });
    });
  }

  async function setLang(lang, { persist = true } = {}) {
    if (!isLang(lang)) lang = 'en';
    if (persist) {
      store.set('kesari.lang', lang);
      if (win) win.document.cookie = `k_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${win.location && win.location.protocol === 'https:' ? '; Secure' : ''}`;
    }
    if (!win) return lang;
    // Pages the server renders in the chosen language (the hub's) reload instead.
    if (persist && win.document.documentElement.hasAttribute('data-i18n-reload')) { win.location.reload(); return lang; }
    win.document.documentElement.lang = lang;
    await load(lang);
    apply(lang);
    win.document.querySelectorAll('select[data-k-lang]').forEach((s) => { s.value = lang; });
    win.dispatchEvent(new CustomEvent('kesari:lang', { detail: { lang } }));
    return lang;
  }

  /* ---------- theme ---------- */
  const currentTheme = () => { const v = store.get('kesari.theme'); return THEMES.includes(v) ? v : 'system'; };
  const nextTheme = (v) => THEMES[(THEMES.indexOf(v) + 1) % THEMES.length];

  function applyTheme(theme) {
    if (!win) return;
    const el = win.document.documentElement;
    if (theme === 'light' || theme === 'dark') el.setAttribute('data-theme', theme);
    else el.removeAttribute('data-theme');
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'system';
    if (theme === 'system') store.remove('kesari.theme'); else store.set('kesari.theme', theme);
    applyTheme(theme);
    if (win) {
      win.document.querySelectorAll('[data-k-theme]').forEach(paintThemeButton);
      win.dispatchEvent(new CustomEvent('kesari:theme', { detail: { theme } }));
    }
    return theme;
  }

  const THEME_LABEL = { system: 'theme.system', light: 'theme.light', dark: 'theme.dark' };
  function paintThemeButton(btn) {
    const theme = currentTheme();
    const label = t(THEME_LABEL[theme]);
    btn.setAttribute('aria-label', `${t('theme.label')}: ${label}`);
    btn.setAttribute('title', `${t('theme.label')}: ${label}`);
    btn.setAttribute('data-k-theme', theme);
  }

  /* ---------- formatting: always Indian conventions, always IST ---------- */
  function toIstParts(input) {
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    const ist = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
    return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate(), h: ist.getUTCHours(), min: ist.getUTCMinutes(), dow: ist.getUTCDay() };
  }
  /** "3 Nov 2026" */
  function formatDate(input) {
    const p = toIstParts(input);
    return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : '';
  }
  /** "08:42 AM IST" */
  function formatTime(input, { suffix = true } = {}) {
    const p = toIstParts(input);
    if (!p) return '';
    const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
    return `${String(h12).padStart(2, '0')}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}${suffix ? ' IST' : ''}`;
  }
  /** "3 Nov 2026, 08:42 AM IST" */
  const formatDateTime = (input) => { const d = formatDate(input); return d ? `${d}, ${formatTime(input)}` : ''; };
  /** Indian digit grouping: 130000 -> "1,30,000". */
  function formatNumber(n, opts) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return new Intl.NumberFormat('en-IN', opts).format(v);
  }
  const formatRupees = (n) => formatNumber(n, { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  /** Today's date in IST as YYYY-MM-DD. */
  function istToday(now) {
    const p = toIstParts(now || new Date());
    return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }

  /* ---------- toasts, dialogs ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(message, { kind = '', action, onAction, timeout = 5000 } = {}) {
    if (!win) return null;
    const doc = win.document;
    let host = doc.querySelector('.k-toasts');
    if (!host) {
      host = doc.createElement('div');
      host.className = 'k-toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      doc.body.appendChild(host);
    }
    const el = doc.createElement('div');
    el.className = `k-toast${kind ? ` k-toast--${kind}` : ''}`;
    el.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action)}</button>` : ''}`;
    if (action && onAction) el.querySelector('button').addEventListener('click', () => { onAction(); el.remove(); });
    host.appendChild(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    return el;
  }

  /** Opens a <dialog class="k-dialog">; [data-k-close] inside closes it. Focus returns to the opener. */
  function openDialog(dialog, opener) {
    if (!dialog) return;
    const back = opener || (win.document.activeElement);
    dialog.querySelectorAll('[data-k-close]').forEach((b) => { b.onclick = () => dialog.close(); });
    dialog.addEventListener('close', () => { if (back && back.focus) back.focus(); }, { once: true });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  /* ---------- OTP inputs: <div class="k-otp" data-k-otp="6" data-name="otp"> ---------- */
  function wireOtp(box) {
    if (box.dataset.kReady) return;
    box.dataset.kReady = '1';
    const n = Number(box.dataset.kOtp) || 6;
    const hidden = win.document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = box.dataset.name || 'otp';
    box.innerHTML = '';
    const inputs = [];
    for (let i = 0; i < n; i++) {
      const inp = win.document.createElement('input');
      inp.inputMode = 'numeric';
      inp.autocomplete = i === 0 ? 'one-time-code' : 'off';
      inp.maxLength = n; // the first box takes a whole pasted or autofilled code
      inp.setAttribute('aria-label', `${t('otp.digit')} ${i + 1} / ${n}`);
      inp.pattern = '[0-9]*';
      inputs.push(inp);
      box.appendChild(inp);
    }
    box.appendChild(hidden);
    const sync = () => { hidden.value = inputs.map((x) => x.value).join(''); box.dispatchEvent(new CustomEvent('kesari:otp', { detail: { value: hidden.value, complete: hidden.value.length === n } })); };
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        const digits = inp.value.replace(/\D/g, '');
        if (digits.length > 1) {
          digits.slice(0, n - i).split('').forEach((d, j) => { inputs[i + j].value = d; });
          inputs[Math.min(i + digits.length, n - 1)].focus();
        } else {
          inp.value = digits;
          if (digits && i < n - 1) inputs[i + 1].focus();
        }
        sync();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
        if (e.key === 'ArrowLeft' && i > 0) inputs[i - 1].focus();
        if (e.key === 'ArrowRight' && i < n - 1) inputs[i + 1].focus();
      });
    });
  }

  /* ---------- shared English strings for the runtime itself ---------- */
  add('en', {
    'theme.label': 'Theme', 'theme.system': 'System', 'theme.light': 'Light', 'theme.dark': 'Dark',
    'otp.digit': 'Digit', 'lang.label': 'Language',
  });
  add('mr', {
    'theme.label': 'थीम', 'theme.system': 'सिस्टम', 'theme.light': 'फिकट', 'theme.dark': 'गडद',
    'otp.digit': 'अंक', 'lang.label': 'भाषा',
  });
  add('hi', {
    'theme.label': 'थीम', 'theme.system': 'सिस्टम', 'theme.light': 'हल्का', 'theme.dark': 'गहरा',
    'otp.digit': 'अंक', 'lang.label': 'भाषा',
  });

  /* ---------- wiring: idempotent, so a part rendered later can be wired too ---------- */
  function wire(scope) {
    if (!win) return;
    const s = scope || win.document;
    const lang = currentLang();
    s.querySelectorAll('[data-k-otp]').forEach(wireOtp);
    s.querySelectorAll('select[data-k-lang]').forEach((sel) => {
      sel.value = lang;
      if (!sel.dataset.kReady) { sel.dataset.kReady = '1'; sel.addEventListener('change', () => setLang(sel.value)); }
    });
    s.querySelectorAll('[data-k-theme]').forEach((b) => {
      paintThemeButton(b);
      if (!b.dataset.kReady) { b.dataset.kReady = '1'; b.addEventListener('click', () => setTheme(nextTheme(currentTheme()))); }
    });
  }

  /* ---------- boot: runs as soon as the script loads (put it in <head>) ---------- */
  function boot() {
    if (!win) return;
    applyTheme(currentTheme());
    const lang = currentLang();
    const html = win.document.documentElement;
    // A page the server rendered in one language says so; keep its lang.
    if (!html.hasAttribute('data-i18n-reload')) html.lang = lang;
    const ready = () => {
      wire(win.document);
      if (lang !== 'en' && !html.hasAttribute('data-i18n-reload')) setLang(lang, { persist: false });
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }

  return {
    VERSION, LANGS, THEMES, store, readCookie,
    resolveLang, currentLang, setLang, add, t, apply, load,
    currentTheme, nextTheme, setTheme, applyTheme,
    formatDate, formatTime, formatDateTime, formatNumber, formatRupees, istToday, toIstParts,
    escapeHtml, toast, openDialog, wireOtp, wire, boot,
    /** Re-scan a part of the page a script just rendered: controls, OTP boxes, text. */
    refresh(scope) {
      if (!win) return;
      wire(scope);
      const lang = currentLang();
      if (lang !== 'en' && !win.document.documentElement.hasAttribute('data-i18n-reload')) apply(lang, scope || win.document);
    },
  };
});
