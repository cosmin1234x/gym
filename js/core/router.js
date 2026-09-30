/* FORGE router (SPEC §10.2) — view registry, hash history and the view lifecycle.
 *
 *   F.router.register('water', { title: 'Water', nav: 'water', wide: false, render(el, params, ctx) {…} })
 *
 * Each navigation tears the previous view down (its returned cleanup fn, ctx.onLeave callbacks and
 * ctx.onState subscriptions), then renders the next one into a fresh
 * <section class="view v-<name>" data-view="<name>"> inside #view. A view that throws while
 * rendering gets an in-place error card instead of taking the whole app down.
 */
(function (F) {
  'use strict';

  const HOME = 'today';
  const MAX_REDIRECTS = 12;   // go() chained from render calls — stops A → B → A loops

  const views = new Map();
  let host = null;            // #view
  let visit = null;           // the mounted view: { name, params, def, el, ctx, alive, cleanup, leaves, subs }
  let started = false;
  let busy = false;           // true while tearing down / rendering (re-entrancy guard)
  let queued = null;          // navigation requested while busy: [name, params, nav]
  let redirects = 0;
  let rerenderQueued = false;
  let rerenderChain = 0;      // re-renders requested from inside render — stops a view re-rendering forever
  let histOK = true;          // History API usable (may be refused in sandboxes)
  let idx = 0;                // index of the current entry in our history, to tell back from forward
  const memStack = [];        // in-memory history when pushState is unavailable

  const noop = () => {};
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const plainParams = (p) => (isObj(p) ? p : {});

  function reducedMotion() {
    try {
      if (F.util && typeof F.util.reducedMotion === 'function') return !!F.util.reducedMotion();
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  /** '#water', '#/water', '#water?x=1' → 'water'. */
  function parseHash(hash) {
    let s = String(hash || '').replace(/^#!?\/*/, '').split(/[/?&#]/)[0];
    try { s = decodeURIComponent(s); } catch (_) { /* keep raw */ }
    return s.trim().toLowerCase();
  }

  /** JSON-safe copy of params for history.state (functions / DOM nodes are dropped). */
  function storable(p) {
    try { return plainParams(JSON.parse(JSON.stringify(p))); } catch (_) { return {}; }
  }

  function paramsKey(p) {
    try { return JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]])); } catch (_) { return null; }
  }
  function sameParams(a, b) {
    const ka = paramsKey(a);
    return ka !== null && ka === paramsKey(b);
  }

  /** Registered name, else the home view, else null (nothing registered at all). */
  function resolve(name) {
    if (views.has(name)) return name;
    return views.has(HOME) ? HOME : null;
  }

  function ensureHost() {
    host = document.getElementById('view');
    if (!host) {
      host = document.createElement('div');
      host.id = 'view';
      host.className = 'view-host';
      (document.getElementById('main') || document.body).appendChild(host);
    }
    return host;
  }

  /* ------------------------------------------------------------------ chrome */

  function titleFor(def, name, params) {
    let t = def && def.title;
    if (typeof t === 'function') {
      try { t = t(params); } catch (err) { console.error('[FORGE] router: title() failed for "' + name + '"', err); t = null; }
    }
    if (t === null || t === undefined || t === '') t = name.charAt(0).toUpperCase() + name.slice(1);
    return String(t);
  }

  function setTitle(text, animate) {
    const t = String(text === null || text === undefined ? '' : text);
    const el = document.getElementById('topbar-title');
    if (el && el.textContent !== t) {
      el.textContent = t;
      if (animate && !reducedMotion()) {
        el.classList.remove('is-swapping');
        void el.offsetWidth; // restart the animation
        el.classList.add('is-swapping');
      }
    }
    try { document.title = t ? t + ' · FORGE' : 'FORGE'; } catch (_) { /* ignore */ }
  }

  /** .is-active + aria-current on the shell's [data-nav] items (tabbar, sidebar, topbar buttons). */
  function highlight(navKey) {
    for (const id of ['tabbar', 'sidebar', 'topbar']) {
      const scope = document.getElementById(id);
      if (!scope) continue;
      for (const item of scope.querySelectorAll('[data-nav]')) {
        const on = navKey !== null && item.getAttribute('data-nav') === navKey;
        item.classList.toggle('is-active', on);
        if (on) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      }
    }
  }

  function applyChrome(v, animateTitle) {
    const def = v.def;
    const main = document.getElementById('main');
    if (main) main.classList.toggle('is-wide', !!def.wide);
    const app = document.getElementById('app');
    if (app) {
      app.setAttribute('data-route', v.name);
      app.classList.toggle('is-wide', !!def.wide); // lets the topbar line up with the wide column
    }
    const nav = def.nav === false || def.nav === null ? null : (typeof def.nav === 'string' && def.nav ? def.nav : v.name);
    highlight(nav);
    setTitle(titleFor(def, v.name, v.params), animateTitle);
  }

  function scrollToTop() {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (_) {
      try { window.scrollTo(0, 0); } catch (__) { /* ignore */ }
    }
  }

  /** Move focus to the view's heading (screen readers announce the new page) without scrolling. */
  function focusHeading(el) {
    const target = el.querySelector('h1, h2, .h1, .h-display, .h2') || el;
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
      target.setAttribute('data-route-focus', '');
    }
    try { target.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  function animateIn(el, back) {
    if (reducedMotion()) return;
    const cls = back ? 'view-enter-back' : 'view-enter';
    const done = () => el.classList.remove(cls);
    el.classList.add(cls);
    el.addEventListener('animationend', (e) => { if (e.target === el) done(); });
    setTimeout(done, 700); // in case animationend never fires (hidden tab, display:none)
  }

  /* ---------------------------------------------------------------- lifecycle */

  function teardown(v) {
    if (!v || !v.alive) return;
    v.alive = false;
    const run = (fn, what) => {
      try { fn(); } catch (err) { console.error('[FORGE] router: ' + what + ' failed in "' + v.name + '"', err); }
    };
    const cleanup = v.cleanup;
    v.cleanup = null;
    if (typeof cleanup === 'function') run(cleanup, 'cleanup');
    for (const fn of v.leaves.splice(0)) run(fn, 'onLeave');
    for (const off of v.subs.splice(0)) run(off, 'unsubscribe');
  }

  function makeCtx(v) {
    const live = () => v.alive && visit === v;
    return {
      params: v.params,
      name: v.name,
      go: (name, params, opts) => go(name, params, opts),
      back: (fallback) => back(fallback),
      isActive: live,
      setTitle(text) { if (live()) setTitle(text, false); },
      rerender() { if (live()) requestRerender(v); },
      /** Store subscription that is removed automatically when the view is left. */
      onState(fn) {
        if (typeof fn !== 'function' || !v.alive || !F.store || typeof F.store.subscribe !== 'function') return noop;
        const unsub = F.store.subscribe((state, reason) => { if (live()) fn(state, reason); });
        let off = null;
        off = () => {
          const i = v.subs.indexOf(off);
          if (i >= 0) v.subs.splice(i, 1);
          try { unsub(); } catch (_) { /* ignore */ }
        };
        v.subs.push(off);
        return off;
      },
      /** Runs when the view is left or re-rendered (immediately if that already happened). */
      onLeave(fn) {
        if (typeof fn !== 'function') return;
        if (v.alive) { v.leaves.push(fn); return; }
        try { fn(); } catch (err) { console.error('[FORGE] router: onLeave failed in "' + v.name + '"', err); }
      }
    };
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, cls, onClick) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** In-view error card: keeps the rest of the app usable when one view breaks. */
  function renderError(v, err) {
    console.error('[FORGE] view "' + v.name + '" failed to render', err);
    teardown(v); // drop whatever the view registered before it threw
    const isHome = v.name === HOME;
    const card = el('div', 'route-error');
    card.setAttribute('role', 'alert');
    const badge = el('div', 'route-error__icon');
    try { if (typeof F.icon === 'function') badge.appendChild(F.icon('info', { size: 26 })); } catch (_) { /* ignore */ }
    const detail = el('details', 'route-error__details');
    detail.appendChild(el('summary', null, 'Technical details'));
    detail.appendChild(el('pre', null, String((err && (err.stack || err.message)) || err).slice(0, 1200)));
    const actions = el('div', 'route-error__actions');
    if (isHome) {
      actions.appendChild(button('Try again', 'btn btn--primary', () => requestRerender(v)));
      actions.appendChild(button('Settings', 'btn btn--ghost', () => go('settings')));
    } else {
      actions.appendChild(button('Back to Today', 'btn btn--primary', () => go(HOME)));
      actions.appendChild(button('Try again', 'btn btn--ghost', () => requestRerender(v)));
    }
    card.append(
      badge,
      el('h2', 'h3 route-error__title', 'This screen hit a snag'),
      el('p', 'route-error__text', 'Something went wrong while opening ' + titleFor(v.def, v.name, v.params) +
        '. The rest of FORGE still works.'),
      actions,
      detail
    );
    v.el.textContent = '';
    v.el.appendChild(card);
  }

  function runRender(v) {
    let out;
    try {
      out = v.def.render(v.el, v.params, v.ctx);
    } catch (err) {
      renderError(v, err);
      return;
    }
    if (typeof out === 'function') {
      v.cleanup = out;
    } else if (out && typeof out.then === 'function') {
      // async render: adopt the cleanup when it arrives, or run it at once if the view was already left
      out.then((fn) => {
        if (typeof fn !== 'function') return;
        if (v.alive) v.cleanup = fn;
        else { try { fn(); } catch (err) { console.error('[FORGE] router: cleanup failed in "' + v.name + '"', err); } }
      }, (err) => {
        if (v.alive && visit === v) renderError(v, err);
        else console.error('[FORGE] view "' + v.name + '" failed after it was left', err);
      });
    }
  }

  /** Swap the mounted view. opts: { dir: 'forward'|'back'|'none', scroll, focus, animateTitle, restoreFocus } */
  function mount(name, params, opts) {
    const def = views.get(name) || {
      title: 'FORGE',
      render() { throw new Error('No screens are available — the app files may not have loaded.'); }
    };
    const prev = visit;
    const focusId = opts.restoreFocus && prev && prev.el && document.activeElement &&
      prev.el.contains(document.activeElement) ? document.activeElement.id : '';
    if (prev) teardown(prev);

    const section = document.createElement('section');
    section.className = 'view v-' + name;
    section.setAttribute('data-view', name);
    const v = { name, params, def, el: section, alive: true, cleanup: null, leaves: [], subs: [] };
    v.ctx = makeCtx(v);
    visit = v;

    ensureHost();
    host.textContent = '';
    host.appendChild(section);
    applyChrome(v, opts.animateTitle);
    runRender(v);

    if (opts.dir === 'forward' || opts.dir === 'back') animateIn(section, opts.dir === 'back');
    if (opts.scroll) scrollToTop();
    if (opts.focus) focusHeading(section);
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again && section.contains(again)) { try { again.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
    }
  }

  /* ------------------------------------------------------------------ history */

  function writeHistory(name, params, replace) {
    const url = '#' + name;
    if (histOK) {
      try {
        const i = replace ? idx : idx + 1;
        const state = { name, params: storable(params), i };
        if (replace) history.replaceState(state, '', url);
        else history.pushState(state, '', url);
        idx = i;
        return;
      } catch (_) {
        histOK = false; // sandboxed / refused — fall back to an in-memory stack
      }
    }
    const entry = { name, params };
    if (replace && memStack.length) memStack[memStack.length - 1] = entry;
    else memStack.push(entry);
  }

  /** nav: { replace, fromPop, dir, focus } */
  function navigate(name, params, nav) {
    if (busy) { queued = [name, params, nav]; return; }
    rerenderChain = 0;
    const target = resolve(name) || name;
    if (target !== name) {
      if (name) console.warn('[FORGE] router: unknown route "' + name + '" → "' + target + '"');
      params = {};
    }
    const same = !!visit && visit.name === target && sameParams(visit.params, params);
    if (!nav.fromPop) writeHistory(target, params, nav.replace || same);
    else if (target !== name) writeHistory(target, params, true); // fix the URL of a bad hash

    busy = true;
    try {
      mount(target, params, {
        dir: same ? 'none' : (nav.dir || 'forward'),
        scroll: true,
        focus: nav.focus !== false,
        animateTitle: true
      });
    } catch (err) {
      console.error('[FORGE] router: navigation to "' + target + '" failed', err);
    } finally {
      busy = false;
    }
    drainQueue(target);
  }

  function drainQueue(from) {
    if (!queued) { redirects = 0; return; }
    const next = queued;
    queued = null;
    if (++redirects > MAX_REDIRECTS) {
      console.error('[FORGE] router: too many redirects, staying on "' + from + '"');
      redirects = 0;
      return;
    }
    navigate(next[0], next[1], next[2]);
  }

  function rerenderNow() {
    if (!visit) return;
    const v = visit;
    busy = true;
    try {
      mount(v.name, v.params, { dir: 'none', scroll: false, focus: false, animateTitle: false, restoreFocus: true });
    } catch (err) {
      console.error('[FORGE] router: re-render of "' + v.name + '" failed', err);
    } finally {
      busy = false;
    }
    drainQueue(v.name);
  }

  /** Re-render now, or right after the current render when called from inside one. */
  function requestRerender(v) {
    if (v && v !== visit) return;
    if (!busy) { rerenderChain = 0; rerenderNow(); return; }
    if (rerenderQueued) return;
    if (++rerenderChain > MAX_REDIRECTS) {
      console.error('[FORGE] router: "' + (visit && visit.name) + '" keeps re-rendering itself; ignoring rerender()');
      return;
    }
    rerenderQueued = true;
    const target = visit;
    Promise.resolve().then(() => {
      rerenderQueued = false;
      if (visit !== target) return;
      if (busy) { requestRerender(target); return; }
      rerenderNow(); // keeps rerenderChain, so a render → rerender → render cycle is caught
    });
  }

  function onPopState(e) {
    const st = e && e.state;
    let name;
    let params = {};
    let i = null;
    if (isObj(st) && typeof st.name === 'string') {
      name = st.name;
      params = plainParams(st.params);
      if (typeof st.i === 'number' && isFinite(st.i)) i = st.i;
    } else {
      name = parseHash(location.hash) || HOME; // typed URL / plain #link
    }
    const dir = i !== null && i < idx ? 'back' : 'forward';
    if (i !== null) {
      idx = i;
    } else if (histOK) {
      // tag the browser-created entry so back/forward detection keeps working
      idx += 1;
      const tagged = resolve(name) || name;
      try { history.replaceState({ name: tagged, params: {}, i: idx }, '', '#' + tagged); } catch (_) { /* ignore */ }
    }
    navigate(name, params, { fromPop: true, dir });
  }

  /** Fallback for browsers that do not fire popstate on fragment changes. */
  function onHashChange() {
    const name = parseHash(location.hash) || HOME;
    if (visit && (resolve(name) || name) === visit.name) return;
    navigate(name, {}, { fromPop: true, dir: 'forward' });
  }

  /* --------------------------------------------------------------------- API */

  function register(name, def) {
    if (typeof name !== 'string' || !name || !def || typeof def.render !== 'function') {
      console.error('[FORGE] router.register: a name and a render(el, params, ctx) function are required', name);
      return;
    }
    if (!/^[a-z][a-z0-9-]*$/.test(name)) console.warn('[FORGE] router.register: view names should be lowercase tokens:', name);
    views.set(name, def);
  }

  function begin(name, params) {
    started = true;
    ensureHost();
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) { /* ignore */ }
    try { window.addEventListener('popstate', onPopState); } catch (_) { /* ignore */ }
    try { window.addEventListener('hashchange', onHashChange); } catch (_) { /* ignore */ }
    navigate(name, params, { replace: true, dir: 'forward', focus: false });
  }

  function start() {
    if (started) return;
    const hashName = parseHash(location.hash);
    let st = null;
    try { st = history.state; } catch (_) { histOK = false; }
    let params = {};
    if (isObj(st) && typeof st.name === 'string' && st.name === hashName) {
      // reload: restore params and our position in the history stack
      params = plainParams(st.params);
      if (typeof st.i === 'number' && isFinite(st.i) && st.i >= 0) idx = st.i;
    }
    begin(hashName || HOME, params);
  }

  function go(name, params, opts) {
    const o = isObj(opts) ? opts : {};
    const target = typeof name === 'string' ? name : '';
    if (!started) { begin(target || HOME, plainParams(params)); return; }
    navigate(target, plainParams(params), { replace: !!o.replace, dir: o.back ? 'back' : 'forward' });
  }

  function back(fallback) {
    const fb = typeof fallback === 'string' && fallback ? fallback : HOME;
    if (histOK && idx > 0) {
      try { history.back(); return; } catch (_) { /* fall through */ }
    }
    if (!histOK && memStack.length > 1) {
      memStack.pop();
      const prev = memStack[memStack.length - 1];
      navigate(prev.name, prev.params, { fromPop: true, dir: 'back' });
      return;
    }
    navigate(fb, {}, { replace: true, dir: 'back' });
  }

  function current() {
    return visit ? { name: visit.name, params: visit.params } : { name: null, params: {} };
  }

  function refresh() {
    requestRerender(null);
  }

  F.router = {
    register,
    start,
    go,
    back,
    current,
    refresh,
    /** Extra (not in SPEC): whether a view with this name is registered. */
    has: (name) => views.has(name)
  };
})(window.Forge = window.Forge || {});
