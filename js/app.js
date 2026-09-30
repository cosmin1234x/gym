/* FORGE boot (SPEC §10.3) — theme, shell chrome (nav, topbar, rest dock), router start,
 * cloud sync, service worker and page lifecycle. Loaded last; boots once the DOM is ready. */
(function (F) {
  'use strict';

  const VERSION = '1.0.0';

  // Single source for the mobile tabbar (tab: true) and the desktop sidebar (everything).
  const NAV = [
    { key: 'today', label: 'Today', icon: 'home', tab: true },
    { key: 'plan', label: 'Plan', icon: 'calendar', tab: true },
    { key: 'workout', label: 'Train', icon: 'dumbbell', tab: true, primary: true },
    { key: 'progress', label: 'Progress', icon: 'chart', tab: true },
    { key: 'journal', label: 'Journal', icon: 'book', tab: true },
    { key: 'water', label: 'Water', icon: 'droplet', group: 'More' },
    { key: 'library', label: 'Exercises', icon: 'list' },
    { key: 'settings', label: 'Settings', icon: 'settings' }
  ];

  const SYNC = {
    local: {
      short: 'Saved on this device',
      long: 'Saved in this browser on this device. Export a backup in Settings to keep it safe.',
      icon: 'device'
    },
    connecting: {
      short: 'Connecting to sync…',
      long: 'Connecting to your Claude account to sync your data…',
      icon: 'cloud'
    },
    cloud: {
      short: 'Synced to your account',
      long: 'Synced — your data follows your Claude account to your other devices.',
      icon: 'cloud'
    },
    offline: {
      short: 'Offline — saved on this device',
      long: 'Offline right now. Changes are saved on this device and sync when you are back online.',
      icon: 'cloud-off'
    }
  };

  // Text inputs that open an on-screen keyboard (the tabbar slides away while typing on phones).
  const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"])' +
    ':not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]), textarea, [contenteditable="true"], [contenteditable=""]';

  let booted = false;
  let booting = false;
  const shown = { theme: null, ml: -1, goal: -1, day: '', active: null };

  const byId = (id) => document.getElementById(id);

  function reducedMotion() {
    try { return !!(F.util && F.util.reducedMotion && F.util.reducedMotion()); } catch (_) { return false; }
  }

  function icon(name, size) {
    try { return F.icon(name, { size }); } catch (_) { return document.createTextNode(''); }
  }

  function state() {
    try { return F.store.get(); } catch (_) { return null; }
  }

  /* ------------------------------------------------------------------- theme */

  let hostTheme;              // data-theme found on <html> before we touched it (e.g. set by the host page)
  let ourTheme = null;        // the value we forced, null while following 'auto'
  let pendingAttr;            // attribute value a queued (view-transition) write will set
  let probe = null;

  function wantedTheme() {
    const s = state();
    const t = s && s.settings && s.settings.theme;
    return t === 'dark' || t === 'light' ? t : 'auto';
  }

  /** Resolve a colour token to an rgb() string (custom properties may hold color-mix() etc.). */
  function tokenColor(token) {
    try {
      const root = document.documentElement;
      if (!getComputedStyle(root).getPropertyValue(token).trim()) return '';
      if (!probe) {
        probe = document.createElement('i');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
        (document.body || root).appendChild(probe);
      }
      probe.style.color = 'var(' + token + ')';
      return getComputedStyle(probe).color || '';
    } catch (_) {
      return '';
    }
  }

  function updateThemeColor() {
    try {
      const meta = byId('theme-color') || document.querySelector('meta[name="theme-color"]');
      const bg = meta && tokenColor('--bg');
      if (bg) meta.setAttribute('content', bg);
    } catch (_) { /* ignore */ }
  }

  function withTransition(fn) {
    if (booted && !reducedMotion() && typeof document.startViewTransition === 'function' &&
        document.visibilityState === 'visible') {
      try { document.startViewTransition(fn); return; } catch (_) { /* run directly */ }
    }
    fn();
  }

  /** Apply settings.theme: 'dark'/'light' force data-theme; 'auto' removes it only if we set it. */
  function applyTheme() {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme');
    if (hostTheme === undefined) {
      if (root.hasAttribute('data-forge-theme')) {
        // set early by the inline script in index.html from saved settings — ours, not the host's
        root.removeAttribute('data-forge-theme');
        hostTheme = null;
        ourTheme = cur;
      } else {
        hostTheme = cur;
      }
    }
    const want = wantedTheme();
    shown.theme = want;
    let next = cur;
    if (want !== 'auto') next = want;
    else if (ourTheme !== null && cur === ourTheme) next = hostTheme;
    ourTheme = want === 'auto' ? null : want;
    if (next === cur || next === pendingAttr) {
      if (next === cur) updateThemeColor();
      return;
    }
    pendingAttr = next;
    withTransition(() => {
      pendingAttr = undefined;
      if (next) root.setAttribute('data-theme', next);
      else root.removeAttribute('data-theme');
      updateThemeColor();
    });
  }

  function watchSystemTheme() {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      if (mq.addEventListener) mq.addEventListener('change', updateThemeColor);
      else if (mq.addListener) mq.addListener(updateThemeColor);
    } catch (_) { /* ignore */ }
  }

  /* --------------------------------------------------------------- nav chrome */

  function tabButton(item) {
    const h = F.util.h;
    if (item.primary) {
      return h('button.tab.tab--train', { type: 'button', 'data-nav': item.key },
        h('span.tab__plate', { 'aria-hidden': 'true' }, icon(item.icon, 26), h('span.tab__dot')),
        h('span.tab__label', item.label),
        h('span.sr-only.nav-live'));
    }
    return h('button.tab', { type: 'button', 'data-nav': item.key },
      h('span.tab__icon', { 'aria-hidden': 'true' }, icon(item.icon, 24)),
      h('span.tab__label', item.label));
  }

  function sideLink(item) {
    const h = F.util.h;
    return h('button.side-link', { type: 'button', 'data-nav': item.key, class: item.primary && 'side-link--train' },
      h('span.side-link__icon', { 'aria-hidden': 'true' }, icon(item.icon, item.primary ? 20 : 22)),
      h('span.side-link__label', item.label),
      item.primary && h('span.side-link__dot', { 'aria-hidden': 'true' }),
      item.primary && h('span.sr-only.nav-live'));
  }

  function buildNav() {
    const h = F.util.h;
    const tabbar = byId('tabbar');
    if (tabbar) {
      tabbar.textContent = '';
      for (const item of NAV) if (item.tab) tabbar.appendChild(tabButton(item));
    }
    const side = byId('side-nav') || byId('sidebar');
    if (side) {
      if (side.id === 'side-nav') side.textContent = '';
      for (const item of NAV) {
        if (item.group) side.appendChild(h('p.side-nav__group', { 'aria-hidden': 'true' }, item.group));
        side.appendChild(sideLink(item));
      }
    }
    const foot = byId('sidebar-foot');
    if (foot) foot.textContent = 'FORGE v' + VERSION + ' · Stick to the plan.';
    const settingsBtn = byId('settings-btn');
    if (settingsBtn && !settingsBtn.querySelector('svg')) settingsBtn.appendChild(icon('settings', 22));
  }

  function scrollTopSmooth() {
    try { window.scrollTo({ top: 0, left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) {
      try { window.scrollTo(0, 0); } catch (__) { /* ignore */ }
    }
  }

  function openRoute(key) {
    const cur = F.router.current();
    // tapping the section you are already on (at its root) just scrolls back to the top
    if (cur && cur.name === key && !Object.keys(cur.params || {}).length) { scrollTopSmooth(); return; }
    F.router.go(key);
  }

  function onNavClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-nav], [data-home]') : null;
    if (!t || !e.currentTarget.contains(t)) return;
    if (t.tagName === 'A' && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0)) return; // new tab etc.
    e.preventDefault();
    openRoute(t.hasAttribute('data-home') ? 'today' : t.getAttribute('data-nav'));
  }

  /* ------------------------------------------------------------ topbar state */

  function setSyncStatus(status) {
    const dot = byId('sync-dot');
    if (!dot) return;
    const key = Object.prototype.hasOwnProperty.call(SYNC, status) ? status : 'local';
    dot.setAttribute('data-status', key);
    dot.title = SYNC[key].short;
    dot.setAttribute('aria-label', 'Sync status: ' + SYNC[key].short);
  }

  function onSyncClick() {
    const dot = byId('sync-dot');
    const key = (dot && dot.getAttribute('data-status')) || 'local';
    const info = SYNC[key] || SYNC.local;
    try { F.ui.toast(info.long, { icon: info.icon, type: key === 'offline' ? 'warn' : 'info' }); } catch (_) { /* ignore */ }
  }

  function fmtMl(ml) {
    try { return F.util.fmtMl(ml); } catch (_) { return Math.round(ml) + ' ml'; }
  }

  function navItems(key) {
    const out = [];
    for (const id of ['tabbar', 'sidebar']) {
      const scope = byId(id);
      if (scope) out.push(...scope.querySelectorAll('[data-nav="' + key + '"]'));
    }
    return out;
  }

  /** Keep the water meter, active-workout dot and theme in step with the store. */
  function syncShell(s) {
    s = s || state();
    if (!s) return;
    const settings = s.settings || {};

    const theme = settings.theme === 'dark' || settings.theme === 'light' ? settings.theme : 'auto';
    if (theme !== shown.theme) applyTheme();

    let day = '';
    let ml = 0;
    try {
      day = F.util.todayISO();
      ml = Math.max(0, Number(F.q.waterTotal(day)) || 0);
    } catch (_) { /* keep 0 */ }
    const goal = Math.max(0, Number(settings.waterGoal) || 0);
    if (ml !== shown.ml || goal !== shown.goal || day !== shown.day) {
      shown.ml = ml;
      shown.goal = goal;
      shown.day = day;
      const pct = goal > 0 ? Math.min(100, Math.round((ml / goal) * 100)) : 0;
      const btn = byId('water-btn');
      if (btn) {
        btn.style.setProperty('--water-pct', String(pct));
        btn.classList.toggle('is-full', goal > 0 && ml >= goal);
        const label = 'Water: ' + fmtMl(ml) + (goal > 0 ? ' of ' + fmtMl(goal) + ' (' + pct + '%)' : '') + ' today';
        btn.setAttribute('aria-label', label);
        btn.title = label;
      }
    }

    const active = !!s.active;
    if (active !== shown.active) {
      shown.active = active;
      const tabbar = byId('tabbar');
      if (tabbar) tabbar.classList.toggle('has-active', active);
      for (const item of navItems('workout')) {
        item.classList.toggle('has-active', active);
        const live = item.querySelector('.nav-live');
        if (live) live.textContent = active ? ' — workout in progress' : '';
      }
    }
  }

  /* ------------------------------------------------------------ small watchers */

  function watchScroll() {
    const bar = byId('topbar');
    if (!bar) return;
    let ticking = false;
    const update = () => { ticking = false; bar.classList.toggle('is-scrolled', (window.scrollY || 0) > 4); };
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  function watchTyping() {
    const app = byId('app');
    if (!app) return;
    const isTyping = (node) => !!(node && node.matches && node.matches(TYPING));
    document.addEventListener('focusin', (e) => app.classList.toggle('is-typing', isTyping(e.target)));
    document.addEventListener('focusout', () => {
      setTimeout(() => app.classList.toggle('is-typing', isTyping(document.activeElement)), 0);
    });
  }

  /** Expose the rest dock's height as --rest-dock-h so content and scroll padding clear it. */
  function watchRestDock() {
    const dock = byId('rest-dock');
    if (!dock || typeof ResizeObserver !== 'function') return;
    const root = document.documentElement;
    let last = -1;
    const ro = new ResizeObserver(() => {
      const hgt = Math.ceil(dock.getBoundingClientRect().height);
      if (hgt === last) return;
      last = hgt;
      root.style.setProperty('--rest-dock-h', hgt + 'px');
    });
    ro.observe(dock);
  }

  function watchDayChange() {
    setInterval(() => {
      try { if (F.util.todayISO() !== shown.day) syncShell(); } catch (_) { /* ignore */ }
    }, 60 * 1000);
  }

  function watchLifecycle() {
    const flush = () => {
      try { F.persist.flush(); } catch (err) { console.error('[FORGE] saving on exit failed', err); }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else syncShell();
    });
  }

  /* --------------------------------------------------------------- wake lock */

  const wake = { wanted: false, lock: null, pending: null, listening: false };

  function acquireWake() {
    if (wake.lock && !wake.lock.released) return Promise.resolve(true);
    if (wake.pending) return wake.pending;
    let api = null;
    try { api = navigator.wakeLock; } catch (_) { api = null; }
    if (!api || typeof api.request !== 'function' || document.visibilityState !== 'visible') return Promise.resolve(false);
    wake.pending = Promise.resolve()
      .then(() => api.request('screen'))
      .then((lock) => {
        wake.pending = null;
        if (!wake.wanted) { releaseLock(lock); return false; }
        wake.lock = lock;
        try { lock.addEventListener('release', () => { if (wake.lock === lock) wake.lock = null; }); } catch (_) { /* ignore */ }
        return true;
      }, () => {
        wake.pending = null;
        return false;
      });
    return wake.pending;
  }

  function releaseLock(lock) {
    try {
      const p = lock && lock.release();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  /** Keep the screen on (e.g. during a workout). Resolves true when a wake lock is held. Never throws. */
  function keepAwake(on) {
    wake.wanted = !!on;
    if (!wake.listening) {
      wake.listening = true;
      // the browser drops the lock whenever the page is hidden — take it again on return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && wake.wanted) acquireWake();
      });
    }
    if (wake.wanted) return acquireWake();
    const lock = wake.lock;
    wake.lock = null;
    releaseLock(lock);
    return Promise.resolve(false);
  }

  /** Running as an installed app (home-screen / standalone window)? */
  function isStandalone() {
    try {
      if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: fullscreen)').matches)) return true;
    } catch (_) { /* ignore */ }
    try { return window.navigator.standalone === true; } catch (_) { return false; }
  }

  /* ------------------------------------------------------------ PWA & cloud */

  function registerServiceWorker() {
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      let framed = true;
      try { framed = window.top !== window.self; } catch (_) { framed = true; }
      if (framed || !('serviceWorker' in navigator)) return;
      const register = () => {
        try {
          const p = navigator.serviceWorker.register('sw.js');
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) { /* ignore */ }
      };
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    } catch (_) { /* ignore */ }
  }

  function connectCloud() {
    try {
      const p = F.persist.connectCloud();
      if (p && typeof p.catch === 'function') p.catch((err) => console.warn('[FORGE] cloud sync unavailable', err));
    } catch (err) {
      console.warn('[FORGE] cloud sync unavailable', err);
    }
  }

  /* -------------------------------------------------------------------- boot */

  function wireShell() {
    buildNav();
    for (const id of ['tabbar', 'sidebar', 'topbar']) {
      const el = byId(id);
      if (el) el.addEventListener('click', onNavClick);
    }
    const dot = byId('sync-dot');
    if (dot) dot.addEventListener('click', onSyncClick);
    try {
      setSyncStatus(F.persist.status());
      F.persist.onStatus(setSyncStatus);
    } catch (_) { setSyncStatus('local'); }
    F.store.subscribe((s, reason) => {
      syncShell(s);
      // Wholesale state swaps (cloud pull, import, reset, another tab) re-render the open screen.
      const reasons = String(reason || '').split(' ');
      if (['cloud', 'import', 'storage', 'reset'].some((r) => reasons.includes(r))) {
        try { F.router.refresh(); } catch (_) { /* router not started yet */ }
      }
    });
    syncShell();
    watchScroll();
    watchTyping();
    watchRestDock();
    watchDayChange();
    if (isStandalone()) document.documentElement.classList.add('is-standalone');
  }

  function mountRestTimer() {
    try {
      if (F.restTimer && typeof F.restTimer.mount === 'function') F.restTimer.mount(byId('rest-dock'));
    } catch (err) {
      console.error('[FORGE] rest timer failed to mount', err);
    }
  }

  /** Readable fallback instead of a blank page (plain DOM — the UI kit may be what failed). */
  function showBootError(err) {
    console.error('[FORGE] boot failed', err);
    try {
      const host = byId('view') || document.body;
      const box = document.createElement('div');
      box.className = 'boot-error';
      box.setAttribute('role', 'alert');
      const title = document.createElement('h2');
      title.textContent = 'FORGE couldn’t start';
      const text = document.createElement('p');
      text.textContent = 'Something went wrong while loading the app. Try reloading. Your saved workouts, ' +
        'water and journal stay in this browser’s storage.';
      const pre = document.createElement('pre');
      pre.textContent = String((err && err.message) || err).slice(0, 500);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--primary';
      btn.textContent = 'Reload';
      btn.addEventListener('click', () => { try { location.reload(); } catch (_) { /* ignore */ } });
      box.append(title, text, btn, pre);
      host.textContent = '';
      host.appendChild(box);
    } catch (_) { /* nothing else we can do */ }
  }

  function boot() {
    if (booted || booting) return;
    booting = true; // never boot twice, even after a failure (reload is the recovery)
    try {
      for (const mod of ['util', 'store', 'persist', 'router']) {
        if (!F[mod]) throw new Error('F.' + mod + ' is missing — a script failed to load.');
      }
      F.store.init(F.persist.loadLocal());
      applyTheme();
      watchSystemTheme();
      wireShell();
      mountRestTimer();
      F.router.start();
      booted = true;
    } catch (err) {
      showBootError(err);
      return;
    }
    connectCloud();
    registerServiceWorker();
    watchLifecycle();
  }

  F.app = {
    version: VERSION,
    boot,
    applyTheme,
    keepAwake,
    isStandalone
  };
  // read by the inline boot guard in index.html
  Object.defineProperty(F.app, 'booted', { get: () => booted, enumerable: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window.Forge = window.Forge || {});
