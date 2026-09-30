/* FORGE UI kit — F.ui (SPEC §9). Sheets, toasts, form controls, rings, moods,
   confetti and the celebration stamp. Styles live in css/components.css. */
(function (F) {
  'use strict';

  /* ------------------------------------------------------------ helpers */

  const h = (...args) => F.util.h(...args);
  const icon = (name, opts) => (F.icon ? F.icon(name, opts) : document.createElement('span'));

  function reducedMotion() {
    try {
      if (F.util && typeof F.util.reducedMotion === 'function') return !!F.util.reducedMotion();
    } catch (_) { /* fall through */ }
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  let seq = 0;
  const uid = (prefix) => 'fg-' + (prefix || 'x') + '-' + (++seq).toString(36);

  function haptic(pattern) {
    try { if (F.util && typeof F.util.haptic === 'function') F.util.haptic(pattern); } catch (_) { /* optional */ }
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (v, fallback) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && isFinite(n) ? n : fallback;
  };
  const decimalsOf = (n) => {
    const s = String(n);
    const i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(4, s.length - i - 1);
  };
  const roundTo = (n, dp) => {
    const f = Math.pow(10, dp);
    return Math.round(n * f) / f;
  };

  /** Call a user callback without letting its errors break the UI. */
  function safe(fn, ...args) {
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); } catch (err) { console.error('[forge/ui]', err); return undefined; }
  }

  /** Append Node | string | number | array (null/false skipped). Strings become text nodes. */
  function append(parent, content) {
    if (content === null || content === undefined || content === false || content === true) return;
    if (Array.isArray(content)) { content.forEach((c) => append(parent, c)); return; }
    if (typeof content === 'object' && typeof content.nodeType === 'number') { parent.appendChild(content); return; }
    parent.appendChild(document.createTextNode(String(content)));
  }

  /** Remove an element after its exit animation (or immediately under reduced motion). */
  function removeAfter(el, target, ms) {
    let done = false;
    const finish = () => { if (done) return; done = true; if (el.parentNode) el.parentNode.removeChild(el); };
    if (reducedMotion()) { finish(); return; }
    (target || el).addEventListener('animationend', (e) => { if (e.target === (target || el)) finish(); });
    setTimeout(finish, ms || 400);
  }

  /** Restart a one-shot CSS animation class. */
  function replay(el, cls) {
    if (!el || reducedMotion()) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add(cls);
  }

  function hostEl(id, cls) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      if (cls) el.className = cls;
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }
  const overlayRoot = () => hostEl('overlay-root');
  function toastRoot() {
    const el = hostEl('toast-root', 'toast-stack');
    el.classList.add('toast-stack');
    if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
    return el;
  }

  /* ------------------------------------------------------------ plates */

  const PLATES = ['red', 'blue', 'yellow', 'green', 'white', 'orange', 'violet', 'teal'];
  const MUSCLE_PLATE = {
    chest: 'red', back: 'blue', biceps: 'yellow', triceps: 'green',
    shoulders: 'orange', forearms: 'teal', legs: 'violet', core: 'white', fullbody: 'white'
  };

  /** 'chest' | 'red' | … → plate colour name, or null when unknown. */
  function plateOf(value) {
    if (!value) return null;
    const key = String(value).toLowerCase();
    if (PLATES.indexOf(key) >= 0) return key;
    try {
      const M = F.data && F.data.program && F.data.program.MUSCLES;
      if (M && M[key] && PLATES.indexOf(M[key].plate) >= 0) return M[key].plate;
    } catch (_) { /* program not loaded */ }
    return MUSCLE_PLATE[key] || null;
  }

  function plateDot(muscleOrPlate) {
    const el = h('span.plate-dot', { attrs: { 'aria-hidden': 'true' } });
    const p = plateOf(muscleOrPlate);
    if (p) el.dataset.plate = p;
    return el;
  }

  /* ------------------------------------------------------------ toast */

  const TOAST_ICON = { info: 'info', ok: 'check-circle', warn: 'info', error: 'x', pr: 'trophy' };

  /**
   * Show a toast. Returns { el, close }.
   * Default duration is 3200ms (5000ms when an action such as Undo is offered
   * and no duration is given). duration <= 0 keeps it until dismissed.
   */
  function toast(message, opts) {
    const o = opts || {};
    const type = Object.prototype.hasOwnProperty.call(TOAST_ICON, o.type) ? o.type : 'info';
    const hasAction = !!(o.action && o.action.label);
    const duration = finite(o.duration, hasAction ? 5000 : 3200);
    const host = toastRoot();
    const text = message === null || message === undefined ? '' : String(message);

    // Same message already on screen → replace it instead of stacking duplicates.
    host.querySelectorAll('.toast:not(.is-leaving)').forEach((t) => {
      if (t.dataset.key === type + '|' + text && t._fgClose) t._fgClose(true);
    });
    const live = host.querySelectorAll('.toast:not(.is-leaving)');
    if (live.length >= 3 && live[0]._fgClose) live[0]._fgClose();

    let timer = null;
    let closed = false;
    const el = h('div', {
      class: ['toast', 'toast--' + type],
      attrs: { role: type === 'error' ? 'alert' : null }, // others are announced by #toast-root's aria-live
      dataset: { key: type + '|' + text }
    });
    el.appendChild(h('span.toast__icon', null, icon(o.icon || TOAST_ICON[type], { size: 22 })));
    el.appendChild(h('div.toast__msg', null, text));
    if (hasAction) {
      el.appendChild(h('button.btn.btn--ghost.btn--sm.toast__action', {
        type: 'button',
        on: { click: () => { close(); safe(o.action.onClick); } }
      }, String(o.action.label)));
    }
    el.appendChild(h('button.btn.btn--ghost.btn--icon.btn--sm.toast__close', {
      type: 'button',
      attrs: { 'aria-label': 'Dismiss' },
      on: { click: () => close() }
    }, icon('x', { size: 18 })));

    function close(instant) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (instant) { el.remove(); return; }
      el.classList.add('is-leaving');
      removeAfter(el, el, 320);
    }
    function arm() {
      clearTimeout(timer);
      if (duration > 0 && !closed) timer = setTimeout(close, duration);
    }
    el._fgClose = close;

    // Pause while hovered / focused so people can read or reach the action.
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') clearTimeout(timer); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') arm(); });
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('focusout', arm);

    // Swipe sideways to dismiss.
    let sx = null;
    let dx = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      sx = e.clientX; dx = 0;
    });
    el.addEventListener('pointermove', (e) => {
      if (sx === null) return;
      dx = e.clientX - sx;
      el.style.transform = 'translateX(' + dx + 'px)';
      el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220));
    });
    const endSwipe = () => {
      if (sx === null) return;
      sx = null;
      if (Math.abs(dx) > 80) { close(true); return; }
      el.style.transform = '';
      el.style.opacity = '';
    };
    el.addEventListener('pointerup', endSwipe);
    el.addEventListener('pointercancel', endSwipe);

    host.appendChild(el);
    if (type === 'pr') haptic([18, 40, 18]);
    arm();
    return { el, close: () => close() };
  }

  /* ------------------------------------------------------------ sheet */

  const stack = []; // open sheets, topmost last
  let globalBound = false;
  const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

  function focusables(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) =>
      !el.closest('[inert]') && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function focusEl(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) { /* ignore */ } }
  }

  function bindGlobal() {
    if (globalBound) return;
    globalBound = true;
    document.addEventListener('keydown', (e) => {
      const top = stack[stack.length - 1];
      if (!top) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        if (top.dismissible) top.close('escape');
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(top.panel);
      if (!items.length) { e.preventDefault(); focusEl(top.panel); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === top.panel || !top.panel.contains(active))) {
        e.preventDefault(); focusEl(last);
      } else if (!e.shiftKey && (active === last || !top.panel.contains(active))) {
        e.preventDefault(); focusEl(first);
      }
    }, true);
    document.addEventListener('focusin', (e) => {
      const top = stack[stack.length - 1];
      if (!top || top.panel.contains(e.target)) return;
      // Toasts and the celebration layer may take focus; everything else is behind the modal.
      if (e.target.closest && e.target.closest('.toast-stack, .celebrate')) return;
      focusEl(top.panel);
    });
  }

  function syncScrollLock() {
    document.documentElement.classList.toggle('is-scroll-locked', stack.length > 0);
  }

  /**
   * Swipe-down-to-dismiss on narrow screens: drag the handle/header (pointer
   * events), or pull the body down while it is scrolled to the very top (touch).
   */
  function enableSwipe(api, zones, body, backdrop) {
    const panel = api.panel;
    let dy = 0;
    let t0 = 0;
    const narrow = () => { try { return window.matchMedia('(max-width: 719.98px)').matches; } catch (_) { return true; } };
    const NO_DRAG = 'button, a, input, textarea, select, [contenteditable], .scroll-x, .chips, .tabs';
    const NO_BODY_DRAG = 'input, textarea, select, [contenteditable], .scroll-x, .chips, .tabs, .seg, .stepper, [data-no-swipe]';

    function begin() {
      dy = 0;
      t0 = performance.now();
      api.el.classList.add('is-in', 'is-dragging');
      api.el.classList.remove('is-settling');
    }
    function follow(raw) {
      dy = raw > 0 ? raw : raw / 6; // slight resistance when pulled up
      panel.style.transform = 'translate3d(0,' + dy + 'px,0)';
      backdrop.style.opacity = String(clamp(1 - dy / (panel.offsetHeight || 600), 0.15, 1));
    }
    function release() {
      api.el.classList.remove('is-dragging');
      const velocity = dy / Math.max(1, performance.now() - t0);
      if (dy > Math.min(140, (panel.offsetHeight || 400) * 0.3) || (velocity > 0.6 && dy > 24)) {
        api.close('swipe');
      } else {
        api.el.classList.add('is-settling');
        panel.style.transform = '';
        backdrop.style.opacity = '';
        setTimeout(() => api.el.classList.remove('is-settling'), 280);
      }
    }

    // Handle + header: pointer drag (mouse, pen, touch).
    let pid = null;
    let startY = 0;
    zones.forEach((z) => {
      if (!z) return;
      z.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || !narrow() || e.target.closest(NO_DRAG)) return;
        pid = e.pointerId;
        startY = e.clientY;
        try { z.setPointerCapture(pid); } catch (_) { /* ignore */ }
        begin();
      });
      z.addEventListener('pointermove', (e) => { if (pid !== null && e.pointerId === pid) follow(e.clientY - startY); });
      const up = (e) => { if (pid === null || e.pointerId !== pid) return; pid = null; release(); };
      z.addEventListener('pointerup', up);
      z.addEventListener('pointercancel', up);
    });

    // Body: pull down from scrollTop 0 (touch only; upward drags scroll natively).
    let ty = null;
    let tx = 0;
    let dragging = false;
    body.addEventListener('touchstart', (e) => {
      ty = null;
      if (!narrow() || e.touches.length !== 1 || body.scrollTop > 0 || e.target.closest(NO_BODY_DRAG)) return;
      ty = e.touches[0].clientY;
      tx = e.touches[0].clientX;
      dragging = false;
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (ty === null) return;
      const ddy = e.touches[0].clientY - ty;
      const ddx = e.touches[0].clientX - tx;
      if (!dragging) {
        if (Math.abs(ddy) < 8 && Math.abs(ddx) < 8) return;
        if (ddy <= 0 || Math.abs(ddx) > Math.abs(ddy) || body.scrollTop > 0) { ty = null; return; }
        dragging = true;
        ty += ddy; // start following from here so the sheet doesn't jump
        begin();
      }
      if (e.cancelable) e.preventDefault();
      follow(Math.max(0, e.touches[0].clientY - ty));
    }, { passive: false });
    const endTouch = () => {
      if (ty === null) return;
      ty = null;
      if (dragging) { dragging = false; release(); }
    };
    body.addEventListener('touchend', endTouch);
    body.addEventListener('touchcancel', endTouch);
  }

  /**
   * Bottom sheet (< 720px) / centred dialog (≥ 720px).
   * @returns {{el: HTMLElement, body: HTMLElement, close: (reason?: string) => void, panel: HTMLElement}}
   */
  function sheet(opts) {
    const o = opts || {};
    const dismissible = o.dismissible !== false;
    const titleId = uid('sheet-title');
    const restoreTo = document.activeElement;
    let closed = false;

    const el = h('div', { class: ['sheet', o.size === 'full' ? 'sheet--full' : null, o.className || null] });
    const backdrop = h('div.sheet__backdrop', { attrs: { 'aria-hidden': 'true' } });
    const panel = h('div.sheet__panel', {
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        tabindex: '-1',
        'aria-labelledby': o.title ? titleId : null,
        'aria-label': o.title ? null : (o.ariaLabel || 'Dialog')
      }
    });
    const handle = dismissible ? h('div.sheet__handle', { attrs: { 'aria-hidden': 'true' } }) : null;

    let head = null;
    if (o.title || o.subtitle || dismissible) {
      head = h('div.sheet__head', null,
        h('div.sheet__titles', null,
          o.title ? h('h2.sheet__title', { id: titleId }, String(o.title)) : null,
          o.subtitle ? h('p.sheet__subtitle', null, o.subtitle) : null),
        dismissible ? h('button.btn.btn--ghost.btn--icon.sheet__close', {
          type: 'button',
          attrs: { 'aria-label': 'Close' },
          on: { click: () => close('button') }
        }, icon('x', { size: 22 })) : null);
    }

    const body = h('div.sheet__body');
    panel.append(...[handle, head, body].filter(Boolean));

    const api = { el, body, panel, close, dismissible };

    append(body, typeof o.content === 'function' ? safe(o.content, close) : o.content);

    const actions = Array.isArray(o.actions) ? o.actions.filter(Boolean) : [];
    if (actions.length) {
      const foot = h('div.sheet__foot');
      actions.forEach((a) => {
        const variant = ['primary', 'secondary', 'ghost', 'danger'].indexOf(a.variant) >= 0 ? a.variant : 'secondary';
        const btn = h('button', {
          type: 'button',
          class: ['btn', 'btn--' + variant, a.className || null],
          disabled: !!a.disabled,
          on: { click: () => (typeof a.onClick === 'function' ? safe(a.onClick, close) : close('action')) }
        }, a.icon ? icon(a.icon) : null, a.label ? String(a.label) : null);
        if (a.id) btn.id = a.id;
        if (a.autofocus) btn.setAttribute('data-autofocus', '');
        foot.appendChild(btn);
      });
      panel.appendChild(foot);
      panel.classList.add('has-foot');
    }

    el.append(backdrop, panel);
    overlayRoot().appendChild(el);
    stack.push(api);
    bindGlobal();
    syncScrollLock();

    // Once the entrance animation is over, drop it so drag/settle can't restart it.
    panel.addEventListener('animationend', function onIn(e) {
      if (e.target !== panel) return;
      panel.removeEventListener('animationend', onIn);
      if (!closed) el.classList.add('is-in');
    });

    if (dismissible) {
      backdrop.addEventListener('click', () => close('backdrop'));
      enableSwipe(api, [handle, head], body, backdrop);
    }

    // Initial focus: an explicit [data-autofocus]/[autofocus] element, else the dialog itself.
    const auto = panel.querySelector('[data-autofocus], [autofocus]');
    focusEl(auto || panel);

    function close(reason) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      syncScrollLock();
      el.classList.add('is-closing');
      removeAfter(el, panel, 360);
      const top = stack[stack.length - 1];
      if (panel.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement) {
        if (restoreTo && restoreTo.isConnected && restoreTo !== document.body && (!top || top.panel.contains(restoreTo))) focusEl(restoreTo);
        else if (top) focusEl(top.panel);
      }
      safe(o.onClose, reason || 'close');
    }

    return api;
  }

  /* ------------------------------------------------------------ confirm / prompt / menu */

  function confirm(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let result = false;
      sheet({
        title: o.title || 'Are you sure?',
        className: 'sheet--confirm',
        content: o.message ? h('div.sheet__message', null, o.message) : null,
        actions: [
          { label: o.cancelLabel || 'Cancel', variant: 'secondary', autofocus: !!o.danger, onClick: (close) => close('cancel') },
          {
            label: o.confirmLabel || 'Confirm',
            variant: o.danger ? 'danger' : 'primary',
            autofocus: !o.danger,
            onClick: (close) => { result = true; close('confirm'); }
          }
        ],
        onClose: () => resolve(result)
      });
    });
  }

  function prompt(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let result = null;
      const inputId = uid('prompt');
      const input = h('input.input', {
        id: inputId,
        type: o.type || 'text',
        placeholder: o.placeholder || '',
        value: o.value === null || o.value === undefined ? '' : String(o.value),
        attrs: {
          autocomplete: 'off',
          inputmode: o.inputmode || null,
          enterkeyhint: 'done',
          'data-autofocus': '',
          'aria-label': o.label ? null : (o.title || 'Value')
        }
      });
      let s = null;
      const submit = () => { result = String(input.value).trim(); s.close('confirm'); };
      const form = h('form', {
        attrs: { novalidate: '' },
        on: { submit: (e) => { e.preventDefault(); submit(); } }
      }, o.label ? field({ label: o.label, input, id: inputId }) : input);
      s = sheet({
        title: o.title || 'Enter a value',
        className: 'sheet--prompt',
        content: form,
        actions: [
          { label: o.cancelLabel || 'Cancel', variant: 'secondary', onClick: (close) => close('cancel') },
          { label: o.confirmLabel || 'Save', variant: 'primary', onClick: submit }
        ],
        onClose: () => resolve(result)
      });
      try { input.select(); } catch (_) { /* some input types can't select */ }
    });
  }

  function menu(items, opts) {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter((it) => it && it.label);
    let s = null;
    const content = h('div.menu', { attrs: { role: 'menu' } }, list.map((it) => h('button', {
      type: 'button',
      class: ['menu__item', it.danger ? 'is-danger' : null],
      disabled: !!it.disabled,
      attrs: { role: 'menuitem' },
      on: {
        click: () => {
          s.close('select');
          safe(it.onClick);
        }
      }
    }, it.icon ? icon(it.icon, { size: 22 }) : null, h('span', null, String(it.label)), it.hint ? h('span.menu__hint', null, String(it.hint)) : null)));
    s = sheet({ title: o.title, ariaLabel: o.title || 'Actions', className: 'sheet--menu', content });
    const first = content.querySelector('.menu__item:not(:disabled)');
    if (first) focusEl(first);
    return s;
  }

  /* ------------------------------------------------------------ ring */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    return el;
  }

  /** Progress ring. value 0..1 (may exceed 1: arc caps at full and glows). */
  function ring(opts) {
    const o = opts || {};
    const size = clamp(finite(o.size, 120), 24, 600);
    const stroke = clamp(finite(o.stroke, 10), 1, size / 3);
    const c = size / 2;
    const r = (size - stroke) / 2;
    const C = 2 * Math.PI * r;
    const el = h('div', { class: ['ring', o.className || null], attrs: { role: 'img' } });
    el.style.setProperty('--size', size + 'px');
    el.style.color = o.color || 'var(--accent)';
    el.dataset.c = String(C);

    const s = svg('svg', { class: 'ring__svg', viewBox: '0 0 ' + size + ' ' + size, 'aria-hidden': 'true', focusable: 'false' });
    const track = svg('circle', { class: 'ring__track', cx: c, cy: c, r, 'stroke-width': stroke });
    track.style.stroke = o.track || 'var(--surface-2)';
    const bar = svg('circle', {
      class: 'ring__bar', cx: c, cy: c, r, 'stroke-width': stroke,
      'stroke-dasharray': C.toFixed(2), transform: 'rotate(-90 ' + c + ' ' + c + ')'
    });
    bar.style.stroke = o.color || 'var(--accent)';
    bar.style.setProperty('--c', C.toFixed(2));
    s.append(track, bar);
    el.appendChild(s);

    if ((o.label !== undefined && o.label !== null) || o.sublabel) {
      const center = h('div.ring__center', { attrs: { 'aria-hidden': 'true' } },
        o.label !== undefined && o.label !== null ? h('span.ring__label', null, o.label) : null,
        o.sublabel ? h('span.ring__sublabel', null, o.sublabel) : null);
      center.style.color = 'var(--fg)';
      el.appendChild(center);
    }
    const textOf = (v) => (v && typeof v === 'object' ? v.textContent : v);
    el._fgLabel = [textOf(o.label), textOf(o.sublabel)].filter((x) => x !== null && x !== undefined && x !== '').join(' ');
    setRing(el, o.value);
    return el;
  }

  /** Update a ring's value; the arc animates via CSS transition. */
  function setRing(ringEl, value) {
    if (!ringEl) return;
    const el = ringEl.classList && ringEl.classList.contains('ring') ? ringEl : (ringEl.querySelector && ringEl.querySelector('.ring'));
    const bar = el && el.querySelector('.ring__bar');
    if (!bar) return;
    const C = parseFloat(el.dataset.c) || 0;
    const v = Math.max(0, finite(value, 0));
    bar.style.strokeDashoffset = (C * (1 - Math.min(1, v))).toFixed(2);
    bar.style.opacity = v > 0 ? '1' : '0';
    el.classList.toggle('is-over', v > 1);
    el.dataset.value = String(v);
    const pct = Math.round(v * 100) + '%';
    el.setAttribute('aria-label', el._fgLabel ? (el._fgLabel.indexOf('%') >= 0 ? el._fgLabel : el._fgLabel + ' — ' + pct) : pct);
  }

  /* ------------------------------------------------------------ stepper */

  /**
   * − [input] + with long-press auto-repeat (accelerating), direct typing
   * (comma or dot decimals), clamping on blur and ArrowUp/Down support.
   * Extras on the returned element: el.setValue(n), el.getValue(), el.input.
   */
  function stepper(opts) {
    const o = opts || {};
    const step = Math.abs(finite(o.step, 1)) || 1;
    let min = finite(o.min, 0);
    let max = finite(o.max, 9999);
    if (max < min) { const t = min; min = max; max = t; }
    const dp = clamp(Math.max(Math.round(finite(o.decimals, 0)), decimalsOf(step)), 0, 4);
    const size = ['sm', 'md', 'lg'].indexOf(o.size) >= 0 ? o.size : 'md';
    const id = o.id || uid('stepper');
    const label = o.label ? String(o.label) : '';

    const norm = (v) => {
      const n = finite(typeof v === 'string' ? v.replace(',', '.') : v, NaN);
      return isFinite(n) ? clamp(roundTo(n, dp), min, max) : null;
    };
    const fmt = (v) => (v === null ? '' : String(roundTo(v, dp)));
    let value = norm(o.value);

    const input = h('input.stepper__input', {
      id,
      type: 'text',
      value: fmt(value),
      placeholder: String(roundTo(Math.max(min, 0), dp)),
      attrs: {
        inputmode: dp > 0 ? 'decimal' : 'numeric',
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'done',
        role: 'spinbutton',
        'aria-valuemin': String(min),
        'aria-valuemax': String(max),
        'aria-label': label || null
      }
    });
    const btn = (dir) => h('button.stepper__btn', {
      type: 'button',
      attrs: { tabindex: '-1', 'aria-label': (dir < 0 ? 'Decrease' : 'Increase') + (label ? ' ' + label.toLowerCase() : '') }
    }, icon(dir < 0 ? 'minus' : 'plus', { size: size === 'lg' ? 24 : 20 }));
    const dec = btn(-1);
    const inc = btn(1);
    const fieldEl = h('div.stepper__field', null, input, o.unit ? h('span.stepper__unit', { attrs: { 'aria-hidden': 'true' } }, String(o.unit)) : null);
    fieldEl.addEventListener('click', (e) => { if (e.target !== input) input.focus(); });

    const el = h('div', { class: ['stepper', 'stepper--' + size, o.unit ? 'stepper--unit' : null], attrs: { role: 'group', 'aria-label': label || null } },
      label && !o.labelHidden ? h('label.stepper__label', { for: id }, label) : null,
      h('div.stepper__box', null, dec, fieldEl, inc));

    // With a unit, the input hugs its text so "22.5 kg" reads as one centred group.
    const fit = () => { if (o.unit) input.style.width = (Math.max(1, (input.value || input.placeholder).length) + 0.35) + 'ch'; };
    input.addEventListener('input', fit);

    function sync() {
      fit();
      dec.disabled = value !== null && value <= min;
      inc.disabled = value !== null && value >= max;
      if (value === null) input.removeAttribute('aria-valuenow');
      else input.setAttribute('aria-valuenow', String(value));
    }
    function set(v, silent) {
      const changed = v !== value;
      value = v;
      if (document.activeElement !== input || silent) input.value = fmt(v);
      sync();
      if (changed && !silent) safe(o.onChange, value);
      return changed;
    }
    function bump(dir) {
      const base = value === null ? min : value;
      const next = clamp(roundTo(base + dir * step, dp), min, max);
      if (value !== null && next === value) return false;
      input.value = fmt(next);
      set(next);
      replay(el, 'is-bump');
      return true;
    }

    // Long-press auto-repeat, accelerating from 150ms down to 40ms per step.
    let timer = null;
    const stop = () => {
      clearTimeout(timer); timer = null;
      dec.classList.remove('is-pressed'); inc.classList.remove('is-pressed');
    };
    function press(b, dir, e) {
      if (e.button > 0 || b.disabled) return;
      e.preventDefault(); // keep focus where it is; no text selection / callout
      try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      stop();
      b.classList.add('is-pressed');
      if (!bump(dir)) return;
      haptic(6);
      let interval = 150;
      const tick = () => {
        if (!el.isConnected || !bump(dir)) { stop(); return; }
        interval = Math.max(40, interval * 0.85);
        timer = setTimeout(tick, interval);
      };
      timer = setTimeout(tick, 420);
    }
    [[dec, -1], [inc, 1]].forEach(([b, dir]) => {
      b.addEventListener('pointerdown', (e) => press(b, dir, e));
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // Keyboard / assistive tech activation (no pointer involved).
      b.addEventListener('click', (e) => { if (e.detail === 0) bump(dir); });
    });

    // Select on focus so a new number simply replaces the old one (deferred for iOS;
    // guarded because select() would steal focus back if the user already moved on).
    input.addEventListener('focus', () => {
      setTimeout(() => { if (document.activeElement === input) { try { input.select(); } catch (_) { /* ignore */ } } }, 0);
    });
    input.addEventListener('input', () => {
      const raw = finite(input.value.trim().replace(',', '.'), NaN);
      if (isFinite(raw) && raw >= min && raw <= max) set(roundTo(raw, dp));
    });
    const commit = () => {
      const txt = input.value.trim();
      if (txt === '' && value === null) return;
      const v = txt === '' ? value : norm(txt);
      set(v === null ? value : v, false);
      input.value = fmt(value);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); input.value = fmt(value); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); input.value = fmt(value); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
    });

    sync();
    el.input = input;
    el.getValue = () => value;
    el.setValue = (v) => { set(norm(v), true); };
    return el;
  }

  /* ------------------------------------------------------------ segmented & tabs */

  function normOptions(list) {
    return (Array.isArray(list) ? list : []).filter((x) => x !== null && x !== undefined).map((x) =>
      (typeof x === 'object' ? x : { value: x, label: String(x) }));
  }
  const same = (a, b) => String(a) === String(b);

  /** Roving-focus arrow-key navigation for radio-like groups. */
  function arrowNav(container, getButtons, onPick) {
    container.addEventListener('keydown', (e) => {
      const btns = getButtons();
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = btns.length - 1;
      if (j === null) return;
      e.preventDefault();
      focusEl(btns[j]);
      onPick(j);
    });
  }

  /** Equal-width segmented control; the ink slides with pure CSS (--i / --n). */
  function segmented(opts) {
    const o = opts || {};
    const options = normOptions(o.options);
    let value = o.value;
    const el = h('div', { class: 'seg', id: o.id || null, attrs: { role: 'radiogroup', 'aria-label': o.label || null } });
    el.style.setProperty('--n', String(Math.max(1, options.length)));
    el.appendChild(h('span.seg__ink', { attrs: { 'aria-hidden': 'true' } }));
    const btns = options.map((op, i) => h('button.seg__opt', {
      type: 'button',
      attrs: { role: 'radio', 'aria-checked': 'false', 'data-value': String(op.value), 'aria-label': op.label ? null : String(op.value), title: op.title || null },
      on: { click: () => pick(i) }
    }, op.icon ? icon(op.icon, { size: 18 }) : null, op.label ? h('span.seg__label', null, String(op.label)) : null));
    el.append(...btns);

    function sync() {
      const idx = options.findIndex((op) => same(op.value, value));
      el.style.setProperty('--i', String(Math.max(0, idx)));
      el.classList.toggle('is-empty', idx < 0);
      btns.forEach((b, i) => {
        b.setAttribute('aria-checked', String(i === idx));
        b.tabIndex = i === idx || (idx < 0 && i === 0) ? 0 : -1;
      });
    }
    function pick(i) {
      const op = options[i];
      if (!op) return;
      const changed = !same(op.value, value);
      value = op.value;
      sync();
      if (changed) { haptic(8); safe(o.onChange, value); }
    }
    arrowNav(el, () => btns, pick);
    sync();
    el.getValue = () => value;
    el.setValue = (v) => { value = v; sync(); };
    return el;
  }

  /** Underline tabs; the ink is measured so it fits labels of any width. */
  function tabs(opts) {
    const o = opts || {};
    const list = normOptions(o.tabs);
    const baseId = o.id || uid('tabs');
    let value = o.value !== undefined ? o.value : (list[0] && list[0].value);
    const el = h('div', { class: 'tabs', id: o.id || null, attrs: { role: 'tablist' } });
    const btns = list.map((t, i) => h('button.tabs__tab', {
      type: 'button',
      id: baseId + '-tab-' + String(t.value).replace(/[^\w-]/g, '_'),
      attrs: { role: 'tab', 'aria-selected': 'false', 'data-value': String(t.value) },
      on: { click: () => pick(i) }
    }, h('span', null, String(t.label === undefined ? t.value : t.label)),
      t.count !== undefined && t.count !== null && t.count !== '' ? h('span.tabs__count', null, String(t.count)) : null));
    const ink = h('span.tabs__ink', { attrs: { 'aria-hidden': 'true' } });
    el.append(...btns, ink);

    const index = () => list.findIndex((t) => same(t.value, value));
    function place() {
      const b = btns[index()];
      if (!b || !el.isConnected || !b.offsetWidth) { el.classList.remove('has-ink'); return false; }
      ink.style.width = b.offsetWidth + 'px';
      ink.style.transform = 'translateX(' + b.offsetLeft + 'px)';
      if (!el.classList.contains('has-ink')) {
        el.classList.add('has-ink');
        requestAnimationFrame(() => el.classList.add('is-ready'));
      }
      return true;
    }
    function reveal(b) {
      if (!b || el.scrollWidth <= el.clientWidth) return;
      const left = b.offsetLeft - 16;
      const right = b.offsetLeft + b.offsetWidth + 16 - el.clientWidth;
      const target = el.scrollLeft > left ? left : (el.scrollLeft < right ? right : null);
      if (target !== null) {
        try { el.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { el.scrollLeft = target; }
      }
    }
    function sync() {
      const idx = index();
      btns.forEach((b, i) => {
        b.setAttribute('aria-selected', String(i === idx));
        b.tabIndex = i === idx || (idx < 0 && i === 0) ? 0 : -1;
      });
      place();
    }
    function pick(i) {
      const t = list[i];
      if (!t) return;
      const changed = !same(t.value, value);
      value = t.value;
      sync();
      reveal(btns[i]);
      if (changed) { haptic(8); safe(o.onChange, value); }
    }
    arrowNav(el, () => btns, pick);

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => place()).observe(el);
    } else {
      let tries = 0;
      const poll = () => { if (!place() && tries++ < 30) requestAnimationFrame(poll); };
      requestAnimationFrame(poll);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place).catch(() => {});
    sync();
    el.getValue = () => value;
    el.setValue = (v) => { value = v; sync(); };
    return el;
  }

  /* ------------------------------------------------------------ switch, chip, field */

  function switchEl(opts) {
    const o = opts || {};
    const id = o.id || uid('switch');
    const hintId = o.hint ? id + '-hint' : null;
    const input = h('input.switch__input', {
      type: 'checkbox',
      id,
      checked: !!o.checked,
      disabled: !!o.disabled,
      attrs: { role: 'switch', 'aria-describedby': hintId, 'aria-label': o.label ? null : 'Toggle' },
      on: { change: () => { haptic(8); safe(o.onChange, input.checked); } }
    });
    const el = h('label.switch', null,
      o.label || o.hint ? h('span.switch__text', null,
        o.label ? h('span.switch__label', null, o.label) : null,
        o.hint ? h('span.switch__hint', { id: hintId }, o.hint) : null) : null,
      input,
      h('span.switch__track', { attrs: { 'aria-hidden': 'true' } }, h('span.switch__thumb')));
    el.input = input;
    el.getValue = () => input.checked;
    el.setValue = (v) => { input.checked = !!v; };
    return el;
  }

  /** Stateless chip button. Toggle with el.setActive(bool) or re-render. */
  function chip(opts) {
    const o = opts || {};
    const plate = plateOf(o.plate);
    const el = h('button', {
      type: 'button',
      class: ['chip', o.active ? 'is-active' : null],
      attrs: { 'aria-pressed': typeof o.active === 'boolean' ? String(o.active) : null, title: o.title || null },
      on: { click: (e) => safe(o.onClick, e) }
    },
    o.icon ? icon(o.icon, { size: 16 }) : null, // a [data-plate] chip draws its plate dot in CSS
    o.label !== undefined && o.label !== null ? h('span.chip__label', null, String(o.label)) : null,
    o.count !== undefined && o.count !== null && o.count !== '' ? h('span.chip__count', null, String(o.count)) : null);
    if (plate) el.dataset.plate = plate;
    el.setActive = (on) => {
      el.classList.toggle('is-active', !!on);
      if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(!!on));
    };
    return el;
  }

  function field(opts) {
    const o = opts || {};
    const input = o.input && typeof o.input.nodeType === 'number' ? o.input : null;
    const control = input && (input.matches('input, select, textarea') ? input : input.querySelector('input, select, textarea'));
    let id = o.id || uid('field');
    if (control) {
      if (control.id) id = control.id; else control.id = id;
    }
    const hintId = o.hint ? id + '-hint' : null;
    if (control && hintId) {
      const prev = control.getAttribute('aria-describedby');
      control.setAttribute('aria-describedby', prev ? prev + ' ' + hintId : hintId);
    }
    return h('div.field', null,
      o.label ? (control ? h('label.field__label', { for: id }, o.label) : h('div.field__label', null, o.label)) : null,
      input,
      o.hint ? h('p.field__hint', { id: hintId }, o.hint) : null);
  }

  /* ------------------------------------------------------------ mood & rating */

  const MOODS = [
    { value: 1, label: 'Rough', icon: 'mood-1' },
    { value: 2, label: 'Meh', icon: 'mood-2' },
    { value: 3, label: 'Okay', icon: 'mood-3' },
    { value: 4, label: 'Good', icon: 'mood-4' },
    { value: 5, label: 'Beast mode', icon: 'mood-5' }
  ];
  const validMood = (v) => { const n = Math.round(finite(v, NaN)); return n >= 1 && n <= 5 ? n : null; };

  /** Five faces; tapping the selected face again clears it (onChange(null)). */
  function moodPicker(opts) {
    const o = opts || {};
    const size = ['sm', 'md', 'lg'].indexOf(o.size) >= 0 ? o.size : 'md';
    let value = validMood(o.value);
    const el = h('div', { class: ['mood', 'mood--' + size], id: o.id || null, attrs: { role: 'radiogroup', 'aria-label': o.label || 'Mood' } });
    const btns = MOODS.map((m, i) => h('button.mood__opt', {
      type: 'button',
      attrs: { role: 'radio', 'aria-checked': 'false', 'data-mood': String(m.value), title: m.label },
      on: { click: () => pick(i, true) }
    }, icon(m.icon, { size: size === 'lg' ? 42 : size === 'sm' ? 26 : 32 }), h('span.mood__label', null, m.label)));
    el.append(...btns);

    function sync() {
      btns.forEach((b, i) => {
        b.setAttribute('aria-checked', String(MOODS[i].value === value));
        b.tabIndex = MOODS[i].value === value || (value === null && i === 2) ? 0 : -1;
      });
    }
    function pick(i, toggle) {
      const v = MOODS[i].value;
      value = toggle && value === v ? null : v;
      sync();
      haptic(10);
      safe(o.onChange, value);
    }
    arrowNav(el, () => btns, (i) => pick(i, false));
    sync();
    el.getValue = () => value;
    el.setValue = (v) => { value = validMood(v); sync(); };
    return el;
  }

  /** Energy-style rating. Interactive when onChange is given, otherwise a static read-out. */
  function ratingDots(opts) {
    const o = opts || {};
    const max = clamp(Math.round(finite(o.max, 5)), 1, 10);
    const iconName = o.icon || 'bolt';
    const interactive = typeof o.onChange === 'function';
    let value = (() => { const n = Math.round(finite(o.value, 0)); return n >= 1 ? Math.min(n, max) : null; })();
    const el = h('div', {
      class: ['rating', interactive ? null : 'rating--static'],
      attrs: interactive ? { role: 'radiogroup', 'aria-label': o.label || 'Rating' } : { role: 'img' }
    });
    const items = [];
    for (let i = 1; i <= max; i++) {
      const it = interactive
        ? h('button.rating__opt', {
          type: 'button',
          attrs: { role: 'radio', 'aria-checked': 'false', 'aria-label': i + ' of ' + max },
          on: { click: () => pick(i, true) }
        }, icon(iconName, { size: 24 }))
        : h('span.rating__opt', null, icon(iconName, { size: 16 }));
      items.push(it);
    }
    el.append(...items);

    function sync() {
      items.forEach((it, idx) => {
        const n = idx + 1;
        it.classList.toggle('is-on', value !== null && n <= value);
        if (interactive) {
          it.setAttribute('aria-checked', String(n === value));
          it.tabIndex = n === value || (value === null && n === 1) ? 0 : -1;
        }
      });
      if (!interactive) el.setAttribute('aria-label', (o.label ? o.label + ': ' : '') + (value || 0) + ' of ' + max);
    }
    function pick(n, toggle) {
      value = toggle && value === n ? null : n;
      sync();
      if (value !== null) replay(items[value - 1], 'is-pop');
      haptic(8);
      safe(o.onChange, value);
    }
    if (interactive) arrowNav(el, () => items, (i) => pick(i + 1, false));
    sync();
    el.getValue = () => value;
    el.setValue = (v) => { const n = Math.round(finite(v, 0)); value = n >= 1 ? Math.min(n, max) : null; sync(); };
    return el;
  }

  /* ------------------------------------------------------------ progress, empty, dots */

  /**
   * Linear progress. With a label it returns a .progress-wrap (label row + bar),
   * otherwise the bare .progress track. el.setValue(v) updates either.
   */
  function progressBar(opts) {
    const o = opts || {};
    const plate = plateOf(o.plate);
    const track = h('div.progress', {
      attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': o.label ? String(o.label) : 'Progress' }
    }, h('div.progress__bar'));
    if (plate) track.dataset.plate = plate;
    const pctEl = o.label ? h('span') : null;
    const el = o.label
      ? h('div.progress-wrap', null, h('div.progress__label', null, h('span', null, String(o.label)), pctEl), track)
      : track;
    el.setValue = (v) => {
      const n = clamp(finite(v, 0), 0, 1);
      track.style.setProperty('--v', String(n));
      track.setAttribute('aria-valuenow', String(Math.round(n * 100)));
      if (pctEl) pctEl.textContent = Math.round(n * 100) + '%';
    };
    el.setValue(o.value);
    return el;
  }

  function empty(opts) {
    const o = opts || {};
    const a = o.action && o.action.label ? o.action : null;
    return h('div.empty', null,
      h('div.empty__icon', { attrs: { 'aria-hidden': 'true' } }, icon(o.icon || 'plate', { size: 30 })),
      o.title ? h('h3.empty__title', null, String(o.title)) : null,
      o.text ? h('p.empty__text', null, o.text) : null,
      a ? h('button.btn.btn--primary', { type: 'button', on: { click: () => safe(a.onClick) } },
        a.icon ? icon(a.icon) : null, String(a.label)) : null);
  }

  /* ------------------------------------------------------------ confetti */

  let confettiState = null;
  const PLATE_VARS = ['--plate-red', '--plate-blue', '--plate-yellow', '--plate-green', '--plate-white', '--plate-orange', '--plate-violet', '--plate-teal'];

  function plateColours() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const list = PLATE_VARS.map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
      if (list.length) return list;
      return [getComputedStyle(document.body).color];
    } catch (_) { return ['currentColor']; }
  }

  /** Burst of plate-coloured confetti from (x, y). No-op under reduced motion. */
  function confetti(opts) {
    if (reducedMotion()) return;
    const o = opts || {};
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = finite(o.x, W / 2);
    const y = finite(o.y, H * 0.4);
    const count = clamp(Math.round(finite(o.count, 90)), 1, 400);
    const colours = plateColours();

    if (!confettiState) {
      const canvas = document.createElement('canvas');
      canvas.className = 'confetti-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;
      document.body.appendChild(canvas);
      confettiState = { canvas, ctx, parts: [], raf: 0, last: 0, w: 0, h: 0, dpr: 1 };
    }
    const st = confettiState;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const speed = 7 + Math.random() * 10;
      const kind = Math.random();
      st.parts.push({
        x, y,
        vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.6),
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        shape: kind < 0.62 ? 'rect' : kind < 0.85 ? 'dot' : 'plate',
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.4,
        tilt: Math.random() * Math.PI * 2,
        tiltSpeed: 0.08 + Math.random() * 0.12,
        colour: colours[(Math.random() * colours.length) | 0],
        age: 0,
        life: 1600 + Math.random() * 1300
      });
    }
    if (!st.raf) {
      st.last = performance.now();
      st.raf = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    const st = confettiState;
    if (!st) return;
    const dt = Math.min(48, now - st.last);
    st.last = now;
    const k = dt / 16.67;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (st.w !== W || st.h !== H || st.dpr !== dpr) {
      st.w = W; st.h = H; st.dpr = dpr;
      st.canvas.width = Math.round(W * dpr);
      st.canvas.height = Math.round(H * dpr);
    }
    const ctx = st.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    st.parts = st.parts.filter((p) => p.age < p.life && p.y < H + 40);
    for (const p of st.parts) {
      p.age += dt;
      p.vx *= Math.pow(0.985, k);
      p.vy = p.vy * Math.pow(0.985, k) + 0.28 * k;
      p.x += (p.vx + Math.sin(p.tilt) * 0.6) * k;
      p.y += p.vy * k;
      p.rot += p.spin * k;
      p.tilt += p.tiltSpeed * k;
      const fade = Math.min(1, (p.life - p.age) / 450);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.colour;
      ctx.strokeStyle = p.colour;
      if (p.shape === 'rect') {
        ctx.scale(1, Math.cos(p.tilt)); // paper flutter
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.shape === 'dot') {
        ctx.beginPath(); ctx.arc(0, 0, p.h * 0.8, 0, Math.PI * 2); ctx.fill();
      } else { // tiny bumper plate: a ring
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (st.parts.length) {
      st.raf = requestAnimationFrame(frame);
    } else {
      st.canvas.remove();
      confettiState = null;
    }
  }

  /* ------------------------------------------------------------ celebrate */

  let celebrating = null;

  /** Full-screen stencil stamp ("NEW PR", "WORKOUT DONE") that slams in, plus confetti. */
  function celebrate(opts) {
    const o = opts || {};
    const plate = plateOf(o.plate) || 'red';
    if (celebrating) celebrating.remove();
    const el = h('div.celebrate', { attrs: { role: 'status', 'aria-live': 'assertive' } },
      h('div.celebrate__shock', { attrs: { 'aria-hidden': 'true' } }),
      h('div.stack.center', { style: { '--gap': '14px' } },
        h('div.celebrate__stamp', null,
          h('span.celebrate__icon', null, icon(o.icon || 'trophy', { size: 44 })),
          h('span.celebrate__title', null, String(o.title || 'Nice work'))),
        o.subtitle ? h('span.celebrate__sub', null, String(o.subtitle)) : null));
    el.dataset.plate = plate;
    document.body.appendChild(el);
    celebrating = el;
    haptic([30, 50, 70]);
    if (!reducedMotion()) {
      setTimeout(() => confetti({ count: 130, y: window.innerHeight * 0.45 }), 200);
    }
    const leave = () => {
      if (!el.isConnected) return;
      el.classList.add('is-leaving');
      removeAfter(el, el, 420);
      if (celebrating === el) celebrating = null;
    };
    setTimeout(leave, reducedMotion() ? 1600 : 1400);
    return { el, close: leave };
  }

  /* ------------------------------------------------------------ export */

  F.ui = {
    toast,
    sheet,
    confirm,
    prompt,
    menu,
    ring,
    setRing,
    stepper,
    segmented,
    tabs,
    switchEl,
    chip,
    field,
    moodPicker,
    ratingDots,
    progressBar,
    empty,
    confetti,
    celebrate,
    plateDot,
    // extras (not in the contract, safe to use)
    plateOf,
    MOODS,
    moodLabel: (v) => { const m = MOODS[validMood(v) - 1]; return m ? m.label : ''; }
  };
})(window.Forge = window.Forge || {});
