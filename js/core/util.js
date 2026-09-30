/* FORGE — js/core/util.js
 * Shared helpers: DOM builder, number/date/unit formatting, feedback (haptics, beeps), storage.
 * Contract: docs/SPEC.md §3. Pure definitions at load time (plus a passive audio-unlock listener).
 */
(function (F) {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const hasDoc = () => typeof document !== 'undefined' && document && typeof document.createElement === 'function';

  /* ---------------------------------------------------------------- small helpers */

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toNum = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v.trim().replace(',', '.'));
    return NaN;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const isDateObj = (v) => Object.prototype.toString.call(v) === '[object Date]';
  const DAY_MS = 86400000;

  /** Settings lookup that never throws (store may not be initialised yet). */
  function setting(key, fallback) {
    try {
      const s = F.store && typeof F.store.get === 'function' ? F.store.get() : null;
      if (s && s.settings && s.settings[key] !== undefined) return s.settings[key];
    } catch (_) { /* store not ready */ }
    return fallback;
  }

  /** True once the user has interacted with the page (needed for audio / vibrate). */
  let gestured = false;
  function hasGesture() {
    if (gestured) return true;
    try {
      const ua = root.navigator && root.navigator.userActivation;
      if (ua && ua.hasBeenActive) return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  /* ---------------------------------------------------------------- DOM */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // SVG-only tag names that h() creates in the SVG namespace ('title' and 'a' stay HTML).
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
    'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
    'use', 'symbol', 'filter', 'feTurbulence', 'feColorMatrix', 'feGaussianBlur', 'feBlend',
    'feComposite', 'foreignObject', 'animate', 'animateTransform', 'textPath']);
  // Props assigned as DOM properties (not attributes) on HTML elements.
  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'id', 'type', 'name', 'placeholder',
    'title', 'selected', 'multiple', 'readOnly', 'required', 'autofocus', 'open', 'indeterminate', 'src',
    'href', 'alt', 'min', 'max', 'step', 'rows', 'cols', 'download', 'target', 'rel', 'accept',
    'autocomplete', 'draggable', 'spellcheck', 'lang', 'dir', 'inputMode', 'enterKeyHint', 'maxLength',
    'minLength', 'pattern', 'colSpan', 'rowSpan', 'defaultValue', 'width', 'height', 'loading']);
  // Applied after children so <select value> can find its <option>.
  const DEFERRED = new Set(['value', 'checked', 'selected', 'defaultValue']);

  function flatClass(v, out) {
    if (!v) return out;
    if (Array.isArray(v)) { for (const x of v) flatClass(x, out); return out; }
    if (typeof v === 'string') { for (const c of v.split(/\s+/)) if (c) out.push(c); return out; }
    if (isObj(v)) { for (const k of Object.keys(v)) if (v[k]) out.push(k); }
    return out;
  }

  function setAttr(el, key, val) {
    if (val === null || val === undefined || val === false) { el.removeAttribute(key); return; }
    el.setAttribute(key, val === true ? '' : String(val));
  }

  function applyStyle(el, style) {
    if (style == null || style === false) return;
    if (typeof style === 'string') {
      if (el.style) el.style.cssText = style; else el.setAttribute('style', style);
      return;
    }
    if (!isObj(style) || !el.style) return;
    for (const k of Object.keys(style)) {
      const v = style[k];
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(v));
      else el.style[k] = String(v);
    }
  }

  function appendChild(el, c) {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { for (const x of c) appendChild(el, x); return; }
    if (typeof c === 'object') {
      if (typeof c.nodeType === 'number') { el.appendChild(c); return; }
      // NodeList / HTMLCollection
      if (typeof c.length === 'number' && typeof c.item === 'function') {
        for (const x of Array.from(c)) appendChild(el, x);
        return;
      }
    }
    el.appendChild(document.createTextNode(String(c)));
  }

  function isProps(p) {
    if (!isObj(p) || typeof p.nodeType === 'number') return false;
    if (typeof p.length === 'number' && typeof p.item === 'function') return false; // NodeList
    const proto = Object.getPrototypeOf(p);
    // plain object literal — also from another realm (iframe / vm), whose Object.prototype differs
    return proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null;
  }

  /**
   * Hyperscript element builder. String children become text nodes (XSS-safe).
   * h('button.btn.btn--primary#go', { onClick, 'aria-label': 'Go' }, icon, 'Start')
   */
  function h(tag, props, ...children) {
    let tagName = 'div';
    let shortId = null;
    const classes = [];
    if (typeof tag === 'string' && tag) {
      const parts = tag.split(/(?=[.#])/);
      for (const p of parts) {
        if (p[0] === '.') { if (p.length > 1) classes.push(p.slice(1)); }
        else if (p[0] === '#') { if (p.length > 1) shortId = p.slice(1); }
        else if (p) tagName = p;
      }
    }
    if (props !== undefined && props !== null && !isProps(props)) { children.unshift(props); props = null; }
    const isSvg = SVG_TAGS.has(tagName);
    const el = isSvg ? document.createElementNS(SVG_NS, tagName) : document.createElement(tagName);
    if (shortId) el.id = shortId;

    let ref = null;
    const deferred = [];
    if (props) {
      for (const key of Object.keys(props)) {
        const val = props[key];
        switch (key) {
          case 'class': case 'className': flatClass(val, classes); break;
          case 'style': applyStyle(el, val); break;
          case 'dataset':
            if (isObj(val)) {
              for (const k of Object.keys(val)) {
                if (val[k] === null || val[k] === undefined) continue;
                if (el.dataset) el.dataset[k] = String(val[k]);
                else el.setAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(val[k]));
              }
            }
            break;
          case 'attrs':
            if (isObj(val)) for (const k of Object.keys(val)) setAttr(el, k, val[k]);
            break;
          case 'text': el.textContent = val === null || val === undefined ? '' : String(val); break;
          case 'html': el.innerHTML = val === null || val === undefined ? '' : String(val); break; // TRUSTED ONLY
          case 'ref': if (typeof val === 'function') ref = val; break;
          case 'on':
            if (isObj(val)) for (const ev of Object.keys(val)) if (typeof val[ev] === 'function') el.addEventListener(ev, val[ev]);
            break;
          case 'children': break;
          case 'for': case 'htmlFor':
            if (val !== null && val !== undefined) { if (isSvg) el.setAttribute('for', String(val)); else el.htmlFor = String(val); }
            break;
          case 'tabindex': case 'tabIndex':
            if (val !== null && val !== undefined && val !== false) el.setAttribute('tabindex', String(val));
            break;
          case 'role': setAttr(el, 'role', val); break;
          default: {
            if (val === undefined) break;
            if (/^on[A-Z]/.test(key)) {
              if (typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
              break;
            }
            if (key.startsWith('aria-')) { if (val !== null) el.setAttribute(key, String(val)); break; }
            if (key.startsWith('data-')) { setAttr(el, key, val); break; }
            if (DEFERRED.has(key) && !isSvg) { deferred.push([key, val]); break; }
            if (isSvg) { setAttr(el, key, val); break; }
            if (val === null) break;
            if (PROP_KEYS.has(key) || key in el) {
              try { el[key] = val; } catch (_) { setAttr(el, key, val); } // read-only props (e.g. 'list', 'form')
            } else {
              setAttr(el, key, val);
            }
          }
        }
      }
    }
    if (classes.length) {
      const cls = Array.from(new Set(classes)).join(' ');
      if (isSvg) el.setAttribute('class', cls); else el.className = cls;
    }
    appendChild(el, children);
    for (const [k, v] of deferred) {
      if (v === null) continue;
      try { el[k] = v; } catch (_) { setAttr(el, k, v); }
    }
    if (ref) ref(el);
    return el;
  }

  /** Parse a TRUSTED static SVG string into an element. */
  function svgEl(markup) {
    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(markup == null ? '' : markup).trim();
      const node = tpl.content && tpl.content.firstElementChild;
      if (node) return node;
    } catch (_) { /* fall through */ }
    return document.createElementNS(SVG_NS, 'svg');
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ESC[c]);

  function $(sel, rootEl) {
    const r = rootEl || (hasDoc() ? document : null);
    try { return r ? r.querySelector(sel) : null; } catch (_) { return null; }
  }
  function $$(sel, rootEl) {
    const r = rootEl || (hasDoc() ? document : null);
    try { return r ? Array.from(r.querySelectorAll(sel)) : []; } catch (_) { return []; }
  }
  function clear(el) {
    if (el) { while (el.firstChild) el.removeChild(el.firstChild); }
    return el;
  }

  let seq = 0;
  /** Unique-enough id: prefix + time + random + counter, all [0-9a-z]. */
  function uid(prefix) {
    seq = (seq + 1) % 1679616;
    return String(prefix == null ? '' : prefix) + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7) + seq.toString(36);
  }

  /* ---------------------------------------------------------------- numbers & collections */

  function clamp(n, min, max) {
    const x = Number(n);
    if (Number.isNaN(x)) return min;
    return Math.min(max, Math.max(min, x));
  }

  /** Decimal-safe rounding (round(1.005, 2) === 1.01). Non-finite → 0. */
  function round(n, dp) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const d = Math.max(0, Math.min(10, Math.floor(Number(dp) || 0)));
    if (!d) return Math.round(x);
    const r = Number(Math.round(Number(x + 'e' + d)) + 'e-' + d);
    return Number.isFinite(r) ? r : Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
  }

  const pick = (fn) => (typeof fn === 'function' ? fn : typeof fn === 'string' ? (x) => (x == null ? undefined : x[fn]) : (x) => x);

  function sum(arr, fn) {
    if (!Array.isArray(arr)) return 0;
    const f = pick(fn);
    let s = 0;
    for (let i = 0; i < arr.length; i++) { const v = Number(f(arr[i], i)); if (Number.isFinite(v)) s += v; }
    return s;
  }
  function avg(arr, fn) {
    if (!Array.isArray(arr)) return 0;
    const f = pick(fn);
    let s = 0; let n = 0;
    for (let i = 0; i < arr.length; i++) { const v = Number(f(arr[i], i)); if (Number.isFinite(v)) { s += v; n++; } }
    return n ? s / n : 0;
  }
  function maxBy(arr, fn) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const f = pick(fn);
    let best = null; let bestV = -Infinity;
    for (const x of arr) { const v = Number(f(x)); if (Number.isFinite(v) && v > bestV) { best = x; bestV = v; } }
    return best;
  }
  function groupBy(arr, fn) {
    const out = {};
    if (!Array.isArray(arr)) return out;
    const f = pick(fn);
    for (const x of arr) { const k = f(x); (out[k] || (out[k] = [])).push(x); }
    return out;
  }

  /** Debounced fn with .cancel() and .flush(). */
  function debounce(fn, ms) {
    let t = null; let lastArgs = null; let lastThis = null;
    const run = () => { t = null; const a = lastArgs; lastArgs = null; fn.apply(lastThis, a || []); };
    const d = function (...args) { lastArgs = args; lastThis = this; if (t) clearTimeout(t); t = setTimeout(run, ms); };
    d.cancel = () => { if (t) clearTimeout(t); t = null; lastArgs = null; };
    d.flush = () => { if (t) { clearTimeout(t); run(); } };
    d.pending = () => t !== null;
    return d;
  }
  /** Throttle: runs at most once per `ms` (leading + trailing call). */
  function throttle(fn, ms) {
    let last = 0; let t = null; let lastArgs = null; let lastThis = null;
    const run = () => { last = Date.now(); t = null; const a = lastArgs; lastArgs = null; fn.apply(lastThis, a || []); };
    const th = function (...args) {
      lastArgs = args; lastThis = this;
      const wait = ms - (Date.now() - last);
      if (wait <= 0 || wait > ms) { if (t) { clearTimeout(t); t = null; } run(); }
      else if (!t) t = setTimeout(run, wait);
    };
    th.cancel = () => { if (t) clearTimeout(t); t = null; lastArgs = null; };
    return th;
  }
  const clone = (obj) => (obj === undefined ? undefined : JSON.parse(JSON.stringify(obj)));
  const wait = (ms) => new Promise((res) => setTimeout(res, Math.max(0, Number(ms) || 0)));

  /* ---------------------------------------------------------------- dates (local calendar ISO) */

  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const DAY_LONG = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /** [y, m(1-12), d] for a valid ISO date string, else null. */
  function parts(iso) {
    if (typeof iso !== 'string') return null;
    const m = ISO_RE.exec(iso);
    if (!m) return null;
    const y = +m[1]; const mo = +m[2]; const d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return null;
    const dim = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // days in month (leap handled below)
    const max = mo === 2 ? (((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28) : dim;
    return d > max ? null : [y, mo, d];
  }
  const isISO = (v) => parts(v) !== null;
  /** Integer day number (UTC based → immune to DST). */
  function dayNum(iso) { const p = parts(iso); return p ? Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / DAY_MS) : NaN; }
  function fromDayNum(n) {
    const d = new Date(n * DAY_MS);
    return String(d.getUTCFullYear()).padStart(4, '0') + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Local 'YYYY-MM-DD' for a Date / timestamp / ISO string. Invalid → ''. */
  function toISO(date) {
    if (typeof date === 'string') {
      if (isISO(date)) return date;
      if (isISO(date.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T/.test(date)) date = new Date(date);
      else return '';
    }
    const d = isDateObj(date) ? date : (typeof date === 'number' ? new Date(date) : null);
    if (!d || Number.isNaN(d.getTime())) return '';
    return String(d.getFullYear()).padStart(4, '0') + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  const todayISO = () => toISO(new Date());
  /** Date at LOCAL midnight of the ISO day (Invalid Date for bad input). */
  function fromISO(iso) {
    const p = parts(typeof iso === 'string' ? iso : toISO(iso));
    if (!p) return new Date(NaN);
    const d = new Date(0);
    d.setFullYear(p[0], p[1] - 1, p[2]);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function addDays(iso, n) {
    const base = dayNum(iso);
    if (Number.isNaN(base)) return '';
    return fromDayNum(base + Math.trunc(Number(n) || 0));
  }
  /** Whole days from a to b (b - a). DST-safe. Invalid input → 0. */
  function diffDays(aIso, bIso) {
    const a = dayNum(aIso); const b = dayNum(bIso);
    return Number.isNaN(a) || Number.isNaN(b) ? 0 : b - a;
  }
  function dayIndex(iso) {
    const n = dayNum(iso);
    if (Number.isNaN(n)) return dayIndex(todayISO());
    const dow = new Date(n * DAY_MS).getUTCDay(); // 0 = Sun
    return (dow + 6) % 7;                          // 0 = Mon
  }
  const dayKeyOf = (iso) => DAY_KEYS[dayIndex(iso)];
  function weekStart(iso) {
    const i = isISO(iso) ? iso : todayISO();
    return addDays(i, -dayIndex(i));
  }
  function weekDates(iso) {
    const ws = weekStart(iso);
    return DAY_KEYS.map((_, i) => addDays(ws, i));
  }
  const isToday = (iso) => iso === todayISO();

  /** 'short' Tue 30 Sep | 'long' Tuesday 30 September | 'dm' 30 Sep | 'month' September 2026 | 'day' 30 | 'wd' Tue
   *  (extras: 'dmy' 30 Sep 2026 | 'full' Tuesday 30 September 2026 | 'm' Sep | 'my' Sep 2026) */
  function fmtDate(iso, style) {
    const s = style || 'short';
    const p = parts(typeof iso === 'string' ? iso : toISO(iso));
    if (!p) return '';
    const [y, mo, d] = p;
    const key = dayKeyOf(fromDayNum(Math.round(Date.UTC(y, mo - 1, d) / DAY_MS)));
    switch (s) {
      case 'long': return DAY_LONG[key] + ' ' + d + ' ' + MONTH_LONG[mo - 1];
      case 'dm': return d + ' ' + MONTH_SHORT[mo - 1];
      case 'month': return MONTH_LONG[mo - 1] + ' ' + y;
      case 'day': return String(d);
      case 'wd': return DAY_SHORT[key];
      case 'dmy': return d + ' ' + MONTH_SHORT[mo - 1] + ' ' + y;
      case 'full': return DAY_LONG[key] + ' ' + d + ' ' + MONTH_LONG[mo - 1] + ' ' + y;
      case 'm': return MONTH_SHORT[mo - 1];
      case 'my': return MONTH_SHORT[mo - 1] + ' ' + y;
      default: return DAY_SHORT[key] + ' ' + d + ' ' + MONTH_SHORT[mo - 1];
    }
  }
  function fmtRelDay(iso) {
    if (!isISO(iso)) return fmtDate(iso, 'short');
    const d = diffDays(todayISO(), iso);
    if (d === 0) return 'Today';
    if (d === -1) return 'Yesterday';
    if (d === 1) return 'Tomorrow';
    return fmtDate(iso, 'short');
  }
  function fmtTime(ts) {
    const d = isDateObj(ts) ? ts : new Date(Number(ts));
    if (ts === null || ts === undefined || Number.isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  /** Seconds → '1:05' / '1:02:03' (floors; negative → 0:00). */
  function fmtClock(sec) {
    let s = Math.floor(Math.max(0, Number(sec) || 0) + 1e-6);
    const hh = Math.floor(s / 3600); s -= hh * 3600;
    const mm = Math.floor(s / 60); const ss = s - mm * 60;
    return hh ? hh + ':' + pad2(mm) + ':' + pad2(ss) : mm + ':' + pad2(ss);
  }
  /** Seconds → '1h 05m' | '42m' | '35s'. */
  function fmtDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    if (s < 60) return Math.round(s) + 's';
    const mins = Math.round(s / 60);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + pad2(mins % 60) + 'm';
  }
  /** Thousands separators, up to `dp` decimals (trailing zeros trimmed). Invalid → '0'. */
  function fmtNum(n, dp) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    const d = Math.max(0, Math.min(10, Math.floor(Number(dp) || 0)));
    const fixed = round(Math.abs(x), d).toFixed(d);
    const [intPart, frac = ''] = fixed.split('.');
    const f = frac.replace(/0+$/, '');
    const body = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
    return (x < 0 && body !== '0' ? '-' : '') + body;
  }

  /* ---------------------------------------------------------------- units (storage is ALWAYS kg) */

  const LB_PER_KG = 2.20462;
  const unitsOr = (u) => (u === 'lb' || u === 'kg' ? u : (setting('units', 'kg') === 'lb' ? 'lb' : 'kg'));

  /** kg → display number (lb: 0.1 precision; kg: 0.01 so 1.25 kg plates survive). null for empty. */
  function toDisplayWeight(kg, units) {
    if (kg === null || kg === undefined || kg === '') return null;
    const n = toNum(kg);
    if (!Number.isFinite(n)) return null;
    return unitsOr(units) === 'lb' ? round(n * LB_PER_KG, 1) : round(n, 2);
  }
  /** Display value (number or user string, ',' decimal ok) → kg, or null when empty/invalid. */
  function fromDisplayWeight(value, units) {
    if (value === null || value === undefined) return null;
    const n = toNum(value);
    if (!Number.isFinite(n)) return null;
    return unitsOr(units) === 'lb' ? round(n / LB_PER_KG, 3) : round(n, 3);
  }
  function fmtWeight(kg, units, opts) {
    const u = unitsOr(units);
    const v = toDisplayWeight(kg, u);
    if (v === null) return '—';
    const showUnit = !(opts && opts.unit === false);
    return fmtNum(v, 2) + (showUnit ? ' ' + u : '');
  }
  function fmtVolume(kg, units) {
    const u = unitsOr(units);
    return fmtNum(Math.round(toDisplayWeight(kg, u) || 0)) + ' ' + u;
  }
  function fmtMl(ml) {
    const n = Math.max(0, Number(ml) || 0);
    return n >= 1000 ? fmtNum(n / 1000, 2) + ' L' : fmtNum(Math.round(n)) + ' ml';
  }
  /** Epley estimated 1RM. reps<=0 or no weight → 0; reps 1 → kg. */
  function e1rm(kg, reps) {
    const w = Number(kg); const r = Number(reps);
    if (!(w > 0) || !(r > 0) || !Number.isFinite(w) || !Number.isFinite(r)) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }
  /** '8-12'→{reps:8} '30s'→{secs:30} '1:00'→{secs:60} 'AMRAP'→{amrap:true} '12'→{reps:12} */
  function parseTarget(str) {
    const out = { reps: null, secs: null, amrap: false };
    if (typeof str === 'number') { if (str > 0) out.reps = Math.round(str); return out; }
    const s = String(str == null ? '' : str).trim().toLowerCase();
    if (!s) return out;
    if (/amrap|^max\b|fail/.test(s)) { out.amrap = true; return out; }
    let m = /^(\d{1,3}):(\d{1,2})\b/.exec(s);
    if (m) { out.secs = (+m[1]) * 60 + (+m[2]); return out; }
    m = /^(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?\s*(seconds?|secs?|s|minutes?|mins?|m)\b/.exec(s);
    if (m) {
      const n = parseFloat(m[1]);
      out.secs = Math.round(m[2][0] === 'm' ? n * 60 : n);
      return out;
    }
    m = /(\d+)/.exec(s);
    if (m && +m[1] > 0) out.reps = +m[1];
    return out;
  }

  /* ---------------------------------------------------------------- feedback */

  function haptic(pattern) {
    if (setting('vibrate', true) === false) return;
    try {
      const nav = root.navigator;
      if (nav && typeof nav.vibrate === 'function' && hasGesture()) nav.vibrate(pattern === undefined ? 12 : pattern);
    } catch (_) { /* refused */ }
  }

  let actx = null;
  function audioCtx(create) {
    if (actx) return actx;
    if (!create) return null;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (AC) actx = new AC();
    } catch (_) { actx = null; }
    return actx;
  }
  function unlockAudio() {
    gestured = true;
    try {
      const a = audioCtx(true);
      if (a && a.state === 'suspended' && typeof a.resume === 'function') a.resume().catch(() => {});
    } catch (_) { /* ignore */ }
  }
  function tone(a, t0, freq, dur, type, gain, freqEnd) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  /** Tiny synth: 'end' two blips, 'pr' rising triad, 'done' two-note chime, 'tick' click. */
  function beep(kind) {
    if (setting('sound', true) === false) return;
    try {
      const a = audioCtx(hasGesture());
      if (!a) return;
      if (a.state === 'suspended' && typeof a.resume === 'function') a.resume().catch(() => {});
      const t = a.currentTime + 0.02;
      switch (kind || 'end') {
        case 'tick': tone(a, t, 1800, 0.035, 'triangle', 0.05); break;
        case 'pr':
          tone(a, t, 523.25, 0.14, 'triangle', 0.12);
          tone(a, t + 0.11, 659.25, 0.14, 'triangle', 0.12);
          tone(a, t + 0.22, 783.99, 0.34, 'triangle', 0.14);
          break;
        case 'done':
          tone(a, t, 659.25, 0.12, 'triangle', 0.12);
          tone(a, t + 0.12, 987.77, 0.26, 'triangle', 0.12);
          break;
        default: // 'end'
          tone(a, t, 880, 0.11, 'square', 0.06);
          tone(a, t + 0.18, 880, 0.16, 'square', 0.06);
      }
    } catch (_) { /* audio refused — stay silent */ }
  }
  // Browsers only allow audio after a gesture: create/resume the context on the first interaction.
  try {
    if (hasDoc() && typeof document.addEventListener === 'function') {
      const opts = { capture: true, passive: true };
      document.addEventListener('pointerdown', unlockAudio, opts);
      document.addEventListener('keydown', unlockAudio, opts);
    }
  } catch (_) { /* ignore */ }

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  const counters = typeof WeakMap === 'function' ? new WeakMap() : null;
  /** Animate a number in el.textContent. Always lands on the final value (even if rAF is throttled). */
  function countUp(el, to, opts) {
    if (!el) return;
    const o = opts || {};
    const from = Number(o.from) || 0;
    const duration = o.duration === undefined ? 700 : Number(o.duration) || 0;
    const format = typeof o.format === 'function' ? o.format : (n) => fmtNum(n);
    const target = Number(to) || 0;
    const prev = counters && counters.get(el);
    if (prev) { prev.stop(); counters.delete(el); }
    const raf = root.requestAnimationFrame;
    if (reducedMotion() || duration <= 0 || typeof raf !== 'function' || from === target) {
      el.textContent = format(target);
      return;
    }
    let frame = 0; let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (frame && root.cancelAnimationFrame) root.cancelAnimationFrame(frame);
      clearTimeout(safety);
      el.textContent = format(target);
      if (counters && counters.get(el) === handle) counters.delete(el);
    };
    const handle = { stop() { done = true; if (frame && root.cancelAnimationFrame) root.cancelAnimationFrame(frame); clearTimeout(safety); } };
    const safety = setTimeout(finish, duration + 300);
    const start = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
    const step = (now) => {
      if (done) return;
      const p = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      if (p >= 1) { finish(); return; }
      el.textContent = format(from + (target - from) * eased);
      frame = raf(step);
    };
    el.textContent = format(from);
    frame = raf(step);
    if (counters) counters.set(el, handle);
  }

  /* ---------------------------------------------------------------- storage */

  function ls() { try { return root.localStorage || null; } catch (_) { return null; } }
  const storage = {
    get(key, fallback) {
      const fb = fallback === undefined ? null : fallback;
      try {
        const s = ls();
        const raw = s ? s.getItem(key) : null;
        return raw === null || raw === undefined ? fb : JSON.parse(raw);
      } catch (_) { return fb; }
    },
    set(key, value) {
      try { const s = ls(); if (!s) return false; s.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
    },
    remove(key) {
      try { const s = ls(); if (s) s.removeItem(key); } catch (_) { /* ignore */ }
    }
  };

  F.util = {
    // DOM
    h, svgEl, esc, $, $$, clear, uid,
    // numbers & collections
    clamp, round, sum, avg, maxBy, groupBy, debounce, throttle, clone, wait,
    // dates
    DAY_KEYS, DAY_SHORT, DAY_LONG, MONTH_SHORT, MONTH_LONG,
    todayISO, toISO, fromISO, addDays, diffDays, dayKeyOf, weekStart, weekDates, isToday, isISO,
    fmtDate, fmtRelDay, fmtTime, fmtClock, fmtDuration, fmtNum,
    // units
    LB_PER_KG, toDisplayWeight, fromDisplayWeight, fmtWeight, fmtVolume, fmtMl, e1rm, parseTarget,
    // feedback
    haptic, beep, reducedMotion, countUp,
    storage
  };
})(window.Forge = window.Forge || {});
