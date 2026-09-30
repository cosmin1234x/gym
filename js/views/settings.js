/* FORGE — js/views/settings.js  [VIEW:settings]  (SPEC §12 "settings")
 *
 * Settings & data, organised into numbered sections with a sticky jump bar:
 *   01 Profile     membership card: bumper-plate avatar, name (debounced save), since / plan / workouts
 *   02 Training    units (kg | lb), default rest (big m:ss stepper, 15 s steps + presets),
 *                  sound / vibration / keep-screen-awake switches (vibration disabled + hint when unsupported)
 *   03 Water       daily goal stepper (250 ml steps, presets, glass tally) + quick-add serving sizes (50 ml steps)
 *   04 Equipment   toggle tiles (bodyweight always on) with "you can do X of Y exercises"
 *   05 Appearance  Auto / Iron / Chalk segmented control with live mini previews
 *   06 Data & sync sync status (F.persist.status/onStatus), storage summary, export / import backup,
 *                  reset plan (with Undo), erase everything (confirm + type ERASE)
 *   07 About       version, the split explained (week list from the live plan), home-gym line
 *
 * Every control writes to the store immediately and flashes a small "Saved" tick in its section head;
 * no Save button. External changes (another tab, cloud, other screens) are reflected surgically through
 * ctx.onState, so focused inputs keep focus. Wholesale swaps (import / reset / cloud / storage) are
 * re-rendered by app.js via F.router.refresh().
 *
 * Params: { section: 'profile' | 'training' | 'water' | 'equipment' | 'appearance' | 'data' | 'about' }
 * scrolls straight to that section (aliases: sync, backup, theme, units, rest, name, gear, split).
 */
(function (F) {
  'use strict';

  /* ------------------------------------------------------------------ constants */

  const SECTIONS = [
    { id: 'profile', label: 'Profile', icon: 'user' },
    { id: 'training', label: 'Training', icon: 'timer' },
    { id: 'water', label: 'Water', icon: 'droplet' },
    { id: 'equipment', label: 'Equipment', icon: 'dumbbell' },
    { id: 'appearance', label: 'Appearance', icon: 'sun' },
    { id: 'data', label: 'Data & sync', icon: 'cloud' },
    { id: 'about', label: 'About', icon: 'info' }
  ];
  const ALIASES = {
    sync: 'data', backup: 'data', export: 'data', import: 'data', theme: 'appearance', units: 'training',
    rest: 'training', sound: 'training', name: 'profile', gear: 'equipment', split: 'about', version: 'about'
  };

  const REST_STEP = 15;
  const REST_MIN = 15;
  const REST_MAX = 600;
  const REST_PRESETS = [45, 60, 90, 120, 180];

  const GOAL_STEP = 250;
  const GOAL_MIN = 250;       // store range: 250–10000
  const GOAL_MAX = 10000;
  const GOAL_PRESETS = [2000, 2500, 3000, 3500, 4000];
  const GLASS_ML = 250;

  const SERV_STEP = 50;
  const SERV_MIN = 50;
  const SERV_MAX = 5000;      // store accepts 10–5000
  const SERV_FALLBACK = [250, 500, 750];

  const THEMES = [
    { value: 'auto', label: 'Auto', sub: 'Match device' },
    { value: 'dark', label: 'Iron', sub: 'Dark' },
    { value: 'light', label: 'Chalk', sub: 'Light' }
  ];

  const SYNC = {
    cloud: {
      icon: 'cloud', short: 'Synced',
      title: 'Synced to your Claude account',
      text: 'Workouts, water and journal follow you to every device where you open FORGE with this account.'
    },
    local: {
      icon: 'device', short: 'This device',
      title: 'Saved on this device',
      text: 'Saved in this browser on this device — export a backup to move it.'
    },
    connecting: {
      icon: 'cloud', short: 'Connecting',
      title: 'Connecting…',
      text: 'Linking up with your Claude account so your data can sync across devices.'
    },
    offline: {
      icon: 'cloud-off', short: 'Offline',
      title: 'Offline right now',
      text: 'Changes are saved on this device and sync when you’re back online.'
    }
  };

  const BACKUP_KEY = 'forge:settings:lastBackup'; // device-local convenience: when this device last exported

  // Trusted static glyphs the shared icon set lacks (same 24px, 2px-stroke style).
  const GLYPH = {
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>',
    vibrate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.5" width="8" height="17" rx="2"/><path d="M4.5 8.5v7M19.5 8.5v7M1.8 10.5v3M22.2 10.5v3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };

  /* ------------------------------------------------------------------ helpers */

  const U = () => F.util;
  const S = () => F.store.get();
  const h = (...args) => F.util.h(...args);
  const ic = (name, size, cls) => F.icon(name, { size: size || 20, cls: cls || '' });
  const num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
  const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const reasonsOf = (reason) => String(reason || '').split(' ').filter(Boolean);
  const hasAny = (parts, keys) => keys.some((k) => parts.indexOf(k) >= 0);
  const settings = () => (S() && S().settings) || {};
  const plural = (n, one, many) => (n === 1 ? one : (many || one + 's'));
  const fmtN = (n) => { try { return U().fmtNum(n); } catch (_) { return String(n); } };

  function glyph(name, size) {
    const el = U().svgEl(GLYPH[name] || GLYPH.lock);
    el.setAttribute('width', String(size || 20));
    el.setAttribute('height', String(size || 20));
    el.setAttribute('class', 'icon icon-' + name);
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    return el;
  }

  function reduced() {
    try { return U().reducedMotion(); } catch (_) { return false; }
  }

  /** Restart a one-shot CSS animation class (no-op under reduced motion). */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    if (reduced()) return;
    void el.getBoundingClientRect();
    el.classList.add(cls);
  }

  function restOf() {
    const v = Math.round(num(settings().restSeconds, 90));
    return clampN(v, 0, 1800);
  }
  const restText = (sec) => U().fmtClock(Math.max(0, Math.round(sec)));
  function restSpoken(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const out = [];
    if (m) out.push(m + ' ' + plural(m, 'minute'));
    if (s) out.push(s + ' ' + plural(s, 'second'));
    return out.join(' ') || '0 seconds';
  }

  function goalOf() {
    return clampN(Math.round(num(settings().waterGoal, 3000)), GOAL_MIN, GOAL_MAX);
  }
  function servingsOf() {
    const raw = settings().waterServings;
    const list = Array.isArray(raw) ? raw.map((x) => Math.round(num(x, 0))).filter((x) => x > 0 && x <= 5000) : [];
    const uniq = Array.from(new Set(list)).slice(0, 6);
    return uniq.length ? uniq : SERV_FALLBACK.slice();
  }
  /** Name + icon for a serving size, matching the Water screen (glass / bottle / shaker). */
  function kindOf(ml) {
    if (ml <= 300) return { name: 'Glass', icon: 'glass' };
    if (ml <= 600) return { name: 'Bottle', icon: 'bottle' };
    return { name: 'Shaker', icon: 'bottle' };
  }
  function litres(ml) {
    const l = ml / 1000;
    return (Math.round(l * 100) / 100).toString() + ' L';
  }

  function counts() {
    const s = S() || {};
    const workouts = Array.isArray(s.sessions) ? s.sessions.length : 0;
    const journal = Array.isArray(s.journal) ? s.journal.length : 0;
    let waterDays = 0;
    if (s.water && typeof s.water === 'object') {
      for (const k of Object.keys(s.water)) {
        const list = s.water[k];
        if (Array.isArray(list) && list.some((e) => e && num(e.ml, 0) > 0)) waterDays++;
      }
    }
    const custom = Array.isArray(s.customExercises) ? s.customExercises.length : 0;
    return { workouts, journal, waterDays, custom, any: workouts + journal + waterDays + custom > 0 };
  }

  function trainingDays() {
    const days = (S().plan && S().plan.days) || {};
    return U().DAY_KEYS.filter((k) => days[k] && !days[k].rest && Array.isArray(days[k].items) && days[k].items.length).length;
  }

  function sinceText() {
    try {
      const iso = F.q && typeof F.q.firstUse === 'function' ? F.q.firstUse() : U().toISO(S().meta && S().meta.createdAt);
      return iso ? U().fmtDate(iso, 'my') : '—';
    } catch (_) { return '—'; }
  }

  /** Structural signature of a plan (ids and notes ignored) — tells whether it still matches the default. */
  function planSig(plan) {
    const days = (plan && plan.days) || {};
    return U().DAY_KEYS.map((k) => {
      const d = days[k] || {};
      const items = Array.isArray(d.items) ? d.items : [];
      return [d.title || '', d.rest ? 1 : 0, (Array.isArray(d.focus) ? d.focus : []).join('+'),
        items.map((it) => [it.exId, it.sets, it.target, it.rest === null || it.rest === undefined ? '' : it.rest].join(':')).join(',')].join('|');
    }).join('/');
  }
  function planIsDefault() {
    try { return planSig(S().plan) === planSig(F.data.program.defaultPlan()); } catch (_) { return false; }
  }

  function equipStats() {
    const EQ = (F.data.program && F.data.program.EQUIPMENT) || {};
    const per = {};
    Object.keys(EQ).forEach((k) => { per[k] = 0; });
    let all = [];
    try { all = F.q.allExercises(); } catch (_) { all = []; }
    let can = 0;
    for (const ex of all) {
      if (!ex) continue;
      const eq = Array.isArray(ex.equipment) && ex.equipment.length ? ex.equipment : ['bodyweight'];
      for (const k of eq) if (Object.prototype.hasOwnProperty.call(per, k)) per[k]++;
      try { if (F.q.canDo(ex)) can++; } catch (_) { /* ignore */ }
    }
    return { per, can, total: all.length };
  }

  function supportsVibrate() {
    try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch (_) { return false; }
  }
  function supportsWakeLock() {
    try { return typeof navigator !== 'undefined' && 'wakeLock' in navigator; } catch (_) { return false; }
  }
  function systemIsLight() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); } catch (_) { return false; }
  }

  function backupName() {
    return 'forge-backup-' + U().todayISO() + '.json';
  }
  function lastBackupText() {
    const ts = num(U().storage.get(BACKUP_KEY, null), 0);
    if (!ts) return 'No backup exported from this device yet.';
    const iso = U().toISO(new Date(ts));
    let when;
    try { when = U().fmtRelDay(iso); } catch (_) { when = iso; }
    if (when === 'Today' || when === 'Yesterday') when = when.toLowerCase() + ' at ' + U().fmtTime(ts);
    else when = U().fmtDate(iso, 'dmy');
    return 'Last backup from this device: ' + when + '.';
  }

  /** Peek inside a backup so the confirm can say what it holds. null when unreadable. */
  function describeBackup(text) {
    try {
      const d = JSON.parse(String(text).replace(/^﻿/, ''));
      if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
      const workouts = Array.isArray(d.sessions) ? d.sessions.length : 0;
      const journal = Array.isArray(d.journal) ? d.journal.length : 0;
      let water = 0;
      if (d.water && typeof d.water === 'object' && !Array.isArray(d.water)) {
        for (const k of Object.keys(d.water)) if (Array.isArray(d.water[k]) && d.water[k].length) water++;
      }
      const at = num(d.exportedAt, 0) > 0 ? num(d.exportedAt, 0) : 0;
      return { workouts, journal, water, at };
    } catch (_) { return null; }
  }

  function listPhrase(parts) {
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /* ------------------------------------------------------------------ render */

  function render(el, params, ctx) {
    const u = U();
    const program = F.data.program || {};
    const EQ = program.EQUIPMENT || {};
    const refs = { saved: {}, secs: {}, chips: {} };
    const commits = []; // flush pending typed values when leaving

    const root = h('div.st.stagger');
    el.appendChild(root);
    let order = 0;
    const put = (node) => { node.style.setProperty('--i', String(order++)); root.appendChild(node); return node; };

    /** Brief "Saved" tick in a section head: subtle confirmation, no Save button needed. */
    function flash(secId, text) {
      const pill = refs.saved[secId];
      if (!pill) return;
      pill.querySelector('.st-saved__txt').textContent = text || 'Saved';
      pill.classList.remove('is-on');
      void pill.offsetWidth;
      pill.classList.add('is-on');
      clearTimeout(pill._t);
      pill._t = setTimeout(() => pill.classList.remove('is-on'), 1700);
    }

    /* -------------------------------------------------------------- header */

    const status0 = F.persist && typeof F.persist.status === 'function' ? F.persist.status() : 'local';
    const headLed = h('span.st-led', { 'aria-hidden': 'true' });
    const headTxt = h('span.st-status__txt', (SYNC[status0] || SYNC.local).short);
    const headStatus = h('button.st-status', {
      type: 'button',
      dataset: { status: SYNC[status0] ? status0 : 'local' },
      'aria-label': 'Sync status: ' + (SYNC[status0] || SYNC.local).title + '. Show data and sync settings',
      onClick: () => jumpTo('data', true)
    }, headLed, headTxt);

    put(h('header.view-head.st-head', null,
      h('div.view-head__titles', null,
        h('p.eyebrow', 'Settings · saves as you go'),
        h('h2.h1.st-title', 'Dial it in')),
      h('div.view-head__actions', null, headStatus)));

    /* -------------------------------------------------------------- jump bar */

    const jumpChips = h('div.chips.st-jump__chips', null, SECTIONS.map((sec) => {
      const chip = h('button.chip.st-jump__chip', {
        type: 'button',
        dataset: { sec: sec.id },
        attrs: { 'aria-controls': 'st-sec-' + sec.id },
        onClick: () => jumpTo(sec.id, true)
      }, ic(sec.icon, 16), h('span.chip__label', sec.label));
      refs.chips[sec.id] = chip;
      return chip;
    }));
    put(h('nav.st-jump', { 'aria-label': 'Settings sections' },
      h('p.eyebrow.st-jump__title', { 'aria-hidden': 'true' }, 'Jump to'),
      jumpChips));

    let activeSec = null;
    function setActive(id) {
      if (id === activeSec) return;
      activeSec = id;
      SECTIONS.forEach((s) => {
        const c = refs.chips[s.id];
        if (!c) return;
        const on = s.id === id;
        c.classList.toggle('is-active', on);
        if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });
      const chip = refs.chips[id];
      if (chip && jumpChips.scrollWidth > jumpChips.clientWidth) {
        const left = chip.offsetLeft - 24;
        const right = chip.offsetLeft + chip.offsetWidth + 24 - jumpChips.clientWidth;
        const target = jumpChips.scrollLeft > left ? left : (jumpChips.scrollLeft < right ? right : null);
        if (target !== null) {
          try { jumpChips.scrollTo({ left: target, behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { jumpChips.scrollLeft = target; }
        }
      }
    }

    let lockSpy = 0; // ignore the scroll spy while a jump's smooth scroll is running
    function jumpTo(id, smooth) {
      const node = refs.secs[id];
      if (!node) return;
      lockSpy = Date.now() + (smooth ? 900 : 200);
      setActive(id);
      try { node.scrollIntoView({ behavior: smooth && !reduced() ? 'smooth' : 'auto', block: 'start' }); } catch (_) {
        try { node.scrollIntoView(true); } catch (__) { /* ignore */ }
      }
      const head = node.querySelector('.st-sec__title');
      if (head) { try { head.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
      replay(node, 'is-target');
    }

    /* -------------------------------------------------------------- section shell */

    function section(id, title, sub, ...content) {
      const idx = SECTIONS.findIndex((s) => s.id === id) + 1;
      const saved = h('span.st-saved', { 'aria-hidden': 'true' }, ic('check', 14), h('span.st-saved__txt', 'Saved'));
      refs.saved[id] = saved;
      const node = h('section.st-sec', {
        id: 'st-sec-' + id,
        dataset: { sec: id },
        'aria-labelledby': 'st-h-' + id
      },
      h('div.st-sec__head', null,
        h('span.st-sec__num', { 'aria-hidden': 'true' }, (idx < 10 ? '0' : '') + idx),
        h('h3.st-sec__title', { id: 'st-h-' + id, tabindex: '-1' }, title),
        h('span.st-sec__rule', { 'aria-hidden': 'true' }),
        saved),
      sub ? h('p.st-sec__sub', null, sub) : null,
      ...content);
      refs.secs[id] = node;
      return put(node);
    }

    /** Wire a F.ui.stepper so typed values are previewed while typing and saved on blur / Enter,
     *  while +/− presses (and long-press repeats) save immediately. */
    function typedStepper(opts, { save, preview }) {
      let typing = false;
      const stp = F.ui.stepper(Object.assign({}, opts, {
        onChange: (v) => {
          if (v === null || v === undefined) return;
          if (typing) { if (preview) preview(v); return; }
          save(v, stp);
        }
      }));
      stp.addEventListener('input', () => { typing = true; }, true);
      stp.addEventListener('pointerdown', () => { typing = false; }, true);
      const commit = () => {
        if (!typing) return;
        typing = false;
        const v = stp.getValue();
        if (v !== null && v !== undefined) save(v, stp, true);
      };
      // Registered after the stepper's own blur handler, so its clamped value is final here.
      stp.input.addEventListener('blur', commit);
      commits.push(commit);
      stp.isTyping = () => typing;
      return stp;
    }

    const isFocused = (node) => !!node && document.activeElement === node;

    /* ============================================================== 01 PROFILE */

    const st0 = settings();
    const avatarTxt = h('span.st-avatar__txt');
    const avatarIcon = h('span.st-avatar__icon', null, ic('user', 30));
    const avatar = h('div.st-avatar', { 'aria-hidden': 'true', dataset: { plate: 'red' } }, avatarIcon, avatarTxt);
    function paintAvatar(name) {
      const first = String(name || '').trim().charAt(0).toUpperCase();
      const had = avatarTxt.textContent;
      avatarTxt.textContent = first;
      avatarTxt.hidden = !first;
      avatarIcon.hidden = !!first;
      if (first && first !== had) replay(avatar, 'is-pop');
    }

    const nameInput = h('input.input.st-name', {
      id: 'st-name',
      type: 'text',
      value: st0.name || '',
      placeholder: 'Your name',
      maxLength: 60,
      attrs: { autocomplete: 'nickname', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done' }
    });
    function commitName() {
      const v = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (v !== String(settings().name || '')) {
        F.store.setSetting('name', v);
        flash('profile');
      }
    }
    const saveName = u.debounce(commitName, 450);
    nameInput.addEventListener('input', () => { paintAvatar(nameInput.value); saveName(); });
    nameInput.addEventListener('blur', () => saveName.flush());
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
    commits.push(() => saveName.flush());
    paintAvatar(st0.name);

    const metaSince = h('span.st-id__val', sinceText());
    const metaDays = h('span.st-id__val');
    const metaWorkouts = h('span.st-id__val.num');
    function paintDays() {
      const n = trainingDays();
      metaDays.textContent = n + ' ' + plural(n, 'day');
    }
    paintDays();
    const c0 = counts();
    metaWorkouts.textContent = fmtN(c0.workouts);
    const metaCell = (label, valEl) => h('div.st-id__cell', null, h('span.st-id__lbl', label), valEl);

    section('profile', 'Profile', null,
      h('div.card.card--hero.st-id', { dataset: { plate: 'red' } },
        h('div.st-id__top', null,
          avatar,
          h('div.st-id__main', null,
            h('label.st-id__label', { for: 'st-name' }, 'Your name'),
            nameInput,
            h('p.st-id__hint', null, 'Used for your greetings on Today.'))),
        h('div.st-id__meta', null,
          metaCell('Member since', metaSince),
          metaCell('Per week', metaDays),
          metaCell('Workouts', metaWorkouts))));
    u.countUp(metaWorkouts, c0.workouts, { from: 0, duration: 800 });

    /* ============================================================== 02 TRAINING */

    // Units
    const unitsNote = h('p.st-row__hint');
    function paintUnits() {
      const lb = settings().units === 'lb';
      unitsNote.textContent = lb
        ? 'A 22.5 kg dumbbell reads ' + u.fmtWeight(22.5, 'lb') + '. History stays stored in kg.'
        : 'History is stored in kg, so switching never changes your numbers.';
    }
    paintUnits();
    const unitsSeg = F.ui.segmented({
      id: 'st-units',
      label: 'Weight units',
      options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
      value: st0.units === 'lb' ? 'lb' : 'kg',
      onChange: (v) => {
        F.store.setSetting('units', v);
        paintUnits();
        flash('training', v === 'lb' ? 'Pounds' : 'Kilograms');
      }
    });
    unitsSeg.classList.add('st-units');

    // Default rest: big m:ss stepper + one-tap presets
    let restVal = restOf();
    const restValEl = h('span.st-big__val');
    const restUnitEl = h('span.st-big__unit');
    const restDisp = h('div.st-big__display', {
      id: 'st-rest',
      role: 'spinbutton',
      tabindex: '0',
      'aria-label': 'Default rest between sets',
      'aria-valuemin': String(REST_MIN),
      'aria-valuemax': String(REST_MAX)
    }, restValEl, restUnitEl);
    const restBtn = (dir) => h('button.stepper__btn', {
      type: 'button',
      tabindex: '-1',
      'aria-label': (dir < 0 ? 'Less' : 'More') + ' rest, 15 seconds'
    }, ic(dir < 0 ? 'minus' : 'plus', 24));
    const restDec = restBtn(-1);
    const restInc = restBtn(1);
    const restBox = h('div.stepper.stepper--lg.st-big', { role: 'group', 'aria-label': 'Default rest' },
      h('div.stepper__box', null, restDec, restDisp, restInc));
    const restChips = REST_PRESETS.map((sec) => {
      const c = F.ui.chip({ label: restText(sec), active: false, onClick: () => setRest(sec, true) });
      c.dataset.sec = String(sec);
      c.setAttribute('aria-label', 'Rest ' + restSpoken(sec));
      return c;
    });
    function paintRest(bump) {
      restValEl.textContent = restText(restVal);
      restUnitEl.textContent = restVal >= 60 ? 'min' : 'sec';
      restDisp.setAttribute('aria-valuenow', String(restVal));
      restDisp.setAttribute('aria-valuetext', restSpoken(restVal));
      restDec.disabled = restVal <= REST_MIN;
      restInc.disabled = restVal >= REST_MAX;
      restChips.forEach((c) => c.setActive(Number(c.dataset.sec) === restVal));
      if (bump) replay(restBox, 'is-bump');
    }
    function setRest(v, save) {
      const next = clampN(Math.round(v), 0, 1800);
      if (next === restVal && !save) return false;
      const changed = next !== restVal;
      restVal = next;
      paintRest(changed);
      if (save && next !== restOf()) {
        F.store.setSetting('restSeconds', next);
        flash('training', 'Rest ' + restText(next));
      }
      return changed;
    }
    function stepRest(dir) {
      const next = dir > 0
        ? Math.min(REST_MAX, Math.floor(restVal / REST_STEP) * REST_STEP + REST_STEP)
        : Math.max(REST_MIN, Math.ceil(restVal / REST_STEP) * REST_STEP - REST_STEP);
      if (next === restVal || (dir > 0 && restVal >= REST_MAX) || (dir < 0 && restVal <= REST_MIN)) return false;
      return setRest(next, true);
    }
    // Long-press repeat (accelerating), like the shared stepper.
    let restTimer = null;
    const stopRest = () => {
      clearTimeout(restTimer); restTimer = null;
      restDec.classList.remove('is-pressed'); restInc.classList.remove('is-pressed');
    };
    [[restDec, -1], [restInc, 1]].forEach(([b, dir]) => {
      b.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || b.disabled) return;
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        stopRest();
        b.classList.add('is-pressed');
        if (!stepRest(dir)) return;
        try { u.haptic(6); } catch (_) { /* optional */ }
        let interval = 170;
        const tick = () => {
          if (!b.isConnected || !stepRest(dir)) { stopRest(); return; }
          interval = Math.max(50, interval * 0.85);
          restTimer = setTimeout(tick, interval);
        };
        restTimer = setTimeout(tick, 420);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stopRest));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { if (e.detail === 0) stepRest(dir); });
    });
    ctx.onLeave(stopRest);
    restDisp.addEventListener('keydown', (e) => {
      const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
      if (map[e.key]) { e.preventDefault(); stepRest(map[e.key]); }
      else if (e.key === 'PageUp') { e.preventDefault(); setRest(Math.min(REST_MAX, restVal + 60), true); }
      else if (e.key === 'PageDown') { e.preventDefault(); setRest(Math.max(REST_MIN, restVal - 60), true); }
      else if (e.key === 'Home') { e.preventDefault(); setRest(REST_MIN, true); }
      else if (e.key === 'End') { e.preventDefault(); setRest(REST_MAX, true); }
    });
    paintRest(false);

    // Feedback switches
    const canVibrate = supportsVibrate();
    const canWake = supportsWakeLock();
    function withIcon(sw, iconNode) {
      sw.insertBefore(h('span.st-sw__icon', { 'aria-hidden': 'true' }, iconNode), sw.firstChild);
      return sw;
    }
    const swSound = withIcon(F.ui.switchEl({
      id: 'st-sound',
      checked: st0.sound !== false,
      label: 'Sound',
      hint: 'Beeps when rest ends and when you hit a PR',
      onChange: (v) => {
        F.store.setSetting('sound', v);
        flash('training', v ? 'Sound on' : 'Sound off');
        if (v) { try { u.beep('done'); } catch (_) { /* optional */ } }
      }
    }), glyph('sound', 22));
    const swVibrate = withIcon(F.ui.switchEl({
      id: 'st-vibrate',
      checked: canVibrate && st0.vibrate !== false,
      disabled: !canVibrate,
      label: 'Vibration',
      hint: canVibrate ? 'Buzzes on ticked sets and when rest ends' : 'Not supported on this device or browser',
      onChange: (v) => {
        F.store.setSetting('vibrate', v);
        flash('training', v ? 'Vibration on' : 'Vibration off');
        if (v) { try { u.haptic([14, 60, 14]); } catch (_) { /* optional */ } }
      }
    }), glyph('vibrate', 22));
    if (!canVibrate) swVibrate.classList.add('is-unsupported');
    const swAwake = withIcon(F.ui.switchEl({
      id: 'st-awake',
      checked: st0.keepAwake !== false,
      label: 'Keep screen awake',
      hint: canWake ? 'Your screen stays on during a workout' : 'Stays on during a workout where the browser allows it',
      onChange: (v) => {
        F.store.setSetting('keepAwake', v);
        flash('training', v ? 'Screen stays on' : 'Screen can sleep');
      }
    }), ic('sun', 22));

    section('training', 'Training', null,
      h('div.st-panel.st-train', null,
        h('div.st-row.st-row--units', null,
          h('div.st-row__text', null,
            h('span.st-row__label', { id: 'st-units-lbl' }, 'Weight units'),
            unitsNote),
          unitsSeg),
        h('div.st-row.st-row--rest', null,
          h('div.st-row__text', null,
            h('label.st-row__label', { for: 'st-rest' }, 'Default rest'),
            h('p.st-row__hint', null, 'Starts after every ticked set, unless an exercise has its own rest.')),
          h('div.st-rest', null,
            restBox,
            h('div.chips.chips--wrap.st-presets', { attrs: { role: 'group', 'aria-label': 'Rest presets' } }, restChips))),
        h('div.st-switches', null, swSound, swVibrate, swAwake)));
    unitsSeg.setAttribute('aria-labelledby', 'st-units-lbl');

    /* ============================================================== 03 WATER */

    const tally = h('div.st-tally', { 'aria-hidden': 'true' });
    const goalCaption = h('p.st-goal__cap');
    const goalChips = GOAL_PRESETS.map((ml) => {
      const c = F.ui.chip({ label: litres(ml), active: false, onClick: () => saveGoal(ml, goalStepper, false, true) });
      c.dataset.ml = String(ml);
      return c;
    });
    function paintGoal(ml, animate) {
      const n = Math.max(1, Math.round(ml / GLASS_ML));
      const shown = Math.min(n, 40);
      const have = tally.children.length;
      if (have > shown) {
        for (let i = have - 1; i >= shown; i--) tally.removeChild(tally.children[i]);
      } else {
        for (let i = have; i < shown; i++) {
          const g = h('span.st-tally__glass', null, ic('glass', 18));
          if (animate && !reduced()) { g.classList.add('is-new'); g.style.setProperty('--j', String(i - have)); }
          tally.appendChild(g);
        }
      }
      goalCaption.textContent = litres(ml) + ' a day ≈ ' + n + ' ' + plural(n, 'glass', 'glasses') + ' of ' + GLASS_ML + ' ml';
      goalChips.forEach((c) => c.setActive(Number(c.dataset.ml) === ml));
    }
    function saveGoal(v, stp, typed, fromChip) {
      const next = clampN(Math.round(v), GOAL_MIN, GOAL_MAX);
      if (stp && fromChip) stp.setValue(next);
      paintGoal(next, true);
      if (next !== goalOf()) {
        F.store.setSetting('waterGoal', next);
        flash('water', 'Goal ' + litres(next));
      }
    }
    const goalStepper = typedStepper({
      id: 'st-goal', value: goalOf(), step: GOAL_STEP, min: GOAL_MIN, max: GOAL_MAX,
      unit: 'ml', size: 'lg', label: 'Daily water goal', labelHidden: true
    }, {
      save: (v, stp) => saveGoal(v, stp),
      preview: (v) => paintGoal(v, false)
    });
    paintGoal(goalOf(), false);

    const servList = h('div.st-servs');
    const servSteppers = [];
    function markDup(i, on, ml) {
      const row = servList.children[i];
      const stp = servSteppers[i];
      if (!row || !stp) return;
      row.classList.toggle('is-dup', !!on);
      if (on) stp.input.setAttribute('aria-invalid', 'true'); else stp.input.removeAttribute('aria-invalid');
      const note = row.querySelector('.st-serv__dup');
      if (note) note.textContent = on ? 'You already have a ' + ml + ' ml button' : '';
    }
    function paintServKind(i, ml) {
      const row = servList.children[i];
      if (!row) return;
      const k = kindOf(ml);
      const nameEl = row.querySelector('.st-serv__name');
      const iconWrap = row.querySelector('.st-serv__icon');
      if (nameEl && nameEl.textContent !== k.name) nameEl.textContent = k.name;
      if (iconWrap && iconWrap.dataset.icon !== k.icon) {
        iconWrap.dataset.icon = k.icon;
        iconWrap.textContent = '';
        iconWrap.appendChild(ic(k.icon, 22));
      }
    }
    function saveServing(i, v, stp, typed) {
      const cur = servingsOf();
      if (i >= cur.length) return;
      const others = cur.filter((_, j) => j !== i);
      let next = clampN(Math.round(v), SERV_MIN, SERV_MAX);
      if (others.indexOf(next) >= 0) {
        if (typed) {
          // Typed a size that already exists: keep the old one.
          stp.setValue(cur[i]);
          markDup(i, false);
          paintServKind(i, cur[i]);
          F.ui.toast('You already have a ' + next + ' ml button — kept ' + cur[i] + ' ml.', { type: 'warn' });
          return;
        }
        // Stepping onto an existing size: hop over it in the same direction.
        const dir = next >= cur[i] ? 1 : -1;
        while (others.indexOf(next) >= 0) next += dir * SERV_STEP;
        if (next < SERV_MIN || next > SERV_MAX) { stp.setValue(cur[i]); return; }
        stp.setValue(next);
      }
      markDup(i, false);
      paintServKind(i, next);
      if (next === cur[i]) return;
      const arr = cur.slice();
      arr[i] = next;
      F.store.setSetting('waterServings', arr);
      flash('water', 'Quick-add ' + next + ' ml');
    }
    function buildServings() {
      servList.textContent = '';
      servSteppers.length = 0;
      const list = servingsOf();
      list.forEach((ml, i) => {
        const k = kindOf(ml);
        const stp = typedStepper({
          id: 'st-serv-' + i, value: ml, step: SERV_STEP, min: SERV_MIN, max: SERV_MAX,
          unit: 'ml', size: 'sm', label: 'Quick-add size ' + (i + 1), labelHidden: true
        }, {
          save: (v, s, typed) => saveServing(i, v, s, typed),
          preview: (v) => {
            const others = servingsOf().filter((_, j) => j !== i);
            markDup(i, others.indexOf(v) >= 0, v);
            paintServKind(i, v);
          }
        });
        servSteppers.push(stp);
        servList.appendChild(h('div.st-serv', { style: { '--i': i } },
          h('span.st-serv__icon', { 'aria-hidden': 'true', dataset: { icon: k.icon } }, ic(k.icon, 22)),
          h('div.st-serv__text', null,
            h('span.st-serv__name', null, k.name),
            h('span.st-serv__dup', { 'aria-live': 'polite' })),
          stp));
      });
      servList.dataset.sig = list.join(',');
    }
    // Normally three sizes; an imported backup may carry fewer, so offer a way back up to three.
    const addServBtn = h('button.btn.btn--ghost.btn--sm.st-serv__add', {
      type: 'button',
      onClick: () => {
        const cur = servingsOf();
        if (cur.length >= 3) return;
        let cand = [250, 500, 750, 1000, 330, 1500].find((x) => cur.indexOf(x) < 0);
        if (!cand) cand = Math.min(SERV_MAX, Math.max.apply(null, cur) + SERV_STEP);
        F.store.setSetting('waterServings', cur.concat(cand));
        flash('water', 'Quick-add ' + cand + ' ml');
      }
    }, ic('plus', 16), 'Add a size');
    function paintAddServ() { addServBtn.hidden = servingsOf().length >= 3; }
    buildServings();
    paintAddServ();

    section('water', 'Water', null,
      h('div.st-panel.st-water', null,
        h('div.st-goal', null,
          h('div.st-block__head', null,
            h('span.st-block__icon', { 'aria-hidden': 'true' }, ic('target', 18)),
            h('label.st-row__label', { for: 'st-goal' }, 'Daily goal')),
          goalStepper,
          tally,
          goalCaption,
          h('div.chips.chips--wrap.st-presets', { attrs: { role: 'group', 'aria-label': 'Goal presets' } }, goalChips)),
        h('div.st-servings', null,
          h('div.st-block__head', null,
            h('span.st-block__icon', { 'aria-hidden': 'true' }, ic('glass', 18)),
            h('span.st-row__label', null, 'Quick-add sizes')),
          h('p.st-row__hint', null, 'The one-tap buttons on Today and Water.'),
          servList,
          addServBtn)));

    /* ============================================================== 04 EQUIPMENT */

    let eq = equipStats();
    const canEl = h('span.st-kit__can', fmtN(eq.can));
    const totalEl = h('span.st-kit__total', fmtN(eq.total));
    const kitBar = F.ui.progressBar({ value: eq.total ? eq.can / eq.total : 0, label: null });
    kitBar.classList.add('st-kit__bar');
    const tiles = {};
    function ownsKey(key) {
      if (key === 'bodyweight') return true;
      const e = settings().equipment || {};
      return !!e[key];
    }
    function paintTile(key) {
      const t = tiles[key];
      if (!t) return;
      const on = ownsKey(key);
      t.btn.setAttribute('aria-checked', String(on));
      t.btn.classList.toggle('is-on', on);
      const n = eq.per[key] || 0;
      t.meta.textContent = key === 'bodyweight' ? 'Always on · ' + n + ' moves' : n + ' ' + plural(n, 'move');
    }
    function paintKit(animateFrom) {
      const prev = animateFrom;
      eq = equipStats();
      if (typeof prev === 'number' && prev !== eq.can) u.countUp(canEl, eq.can, { from: prev, duration: 520 });
      else canEl.textContent = fmtN(eq.can);
      totalEl.textContent = fmtN(eq.total);
      kitBar.setValue(eq.total ? eq.can / eq.total : 0);
      Object.keys(tiles).forEach(paintTile);
    }
    function toggleKit(key) {
      const t = tiles[key];
      if (key === 'bodyweight') {
        replay(t.btn, 'shake');
        F.ui.toast('Bodyweight is always on — no kit needed.', { icon: 'body' });
        return;
      }
      const before = eq.can;
      const next = !ownsKey(key);
      F.store.setSetting('equipment.' + key, next);
      paintKit(before);
      replay(t.icon, 'pop');
      flash('equipment', (EQ[key] ? EQ[key].label : key) + (next ? ' on' : ' off'));
    }
    const grid = h('div.st-kit__grid', null, Object.keys(EQ).map((key, i) => {
      const locked = key === 'bodyweight';
      const iconEl = h('span.st-kit__icon', null, ic(EQ[key].icon || 'dumbbell', 26));
      const meta = h('span.st-kit__meta');
      const btn = h('button.st-kit__tile', {
        type: 'button',
        role: 'switch',
        'aria-checked': 'false',
        'aria-disabled': locked ? 'true' : null,
        dataset: { key },
        style: { '--i': i },
        onClick: () => toggleKit(key)
      },
      h('span.st-kit__row', null,
        iconEl,
        locked
          ? h('span.st-kit__lock', { 'aria-hidden': 'true' }, glyph('lock', 16))
          : h('span.st-kit__switch', { 'aria-hidden': 'true' }, h('span.st-kit__knob'))),
      h('span.st-kit__name', null, EQ[key].label || key),
      meta);
      tiles[key] = { btn, icon: iconEl, meta };
      return btn;
    }));
    grid.classList.add('stagger');
    Object.keys(tiles).forEach(paintTile);

    section('equipment', 'Equipment', null,
      h('div.st-kit', null,
        h('div.st-kit__sum', null,
          h('p.st-kit__big', null, canEl, h('span.st-kit__of', null, ' / '), totalEl),
          h('div.st-kit__sumtext', null,
            h('p.st-kit__lead', null, 'exercises you can do with your kit'),
            h('p.st-row__hint', null, 'Filters the exercise library and suggestions.'))),
        kitBar,
        grid));

    /* ============================================================== 05 APPEARANCE */

    function mini(kind) {
      return h('span', { class: ['st-mini', 'st-mini--' + kind] },
        h('span.st-mini__top', null, h('span.st-mini__brand')),
        h('span.st-mini__hero', null, h('span.st-mini__line'), h('span.st-mini__line.is-short')),
        h('span.st-mini__row', null, h('span.st-mini__dot'), h('span.st-mini__dot'), h('span.st-mini__dot')));
    }
    function swatch(value) {
      if (value === 'auto') return h('span.st-swatch.st-swatch--auto', { 'aria-hidden': 'true' }, mini('iron'), mini('chalk'));
      return h('span.st-swatch', { 'aria-hidden': 'true' }, mini(value === 'light' ? 'chalk' : 'iron'));
    }
    const themeNote = h('p.st-theme__note');
    function paintThemeNote() {
      const t = settings().theme;
      if (t === 'dark') themeNote.textContent = 'Iron: rubber-floor black with chalk-white type. Easy on the eyes at night.';
      else if (t === 'light') themeNote.textContent = 'Chalk: bright chalk-dust white with iron-black type. Great in daylight.';
      else themeNote.textContent = 'Following your device — ' + (systemIsLight() ? 'Chalk (light)' : 'Iron (dark)') + ' right now.';
    }
    paintThemeNote();
    const themeSeg = F.ui.segmented({
      id: 'st-theme',
      label: 'Theme',
      options: THEMES.map((t) => ({ value: t.value, label: t.label })),
      value: ['auto', 'dark', 'light'].indexOf(st0.theme) >= 0 ? st0.theme : 'auto',
      onChange: (v) => {
        F.store.setSetting('theme', v);
        try { if (F.app && typeof F.app.applyTheme === 'function') F.app.applyTheme(); } catch (_) { /* app.js also applies it */ }
        paintThemeNote();
        const t = THEMES.find((x) => x.value === v);
        flash('appearance', t ? t.label : 'Saved');
      }
    });
    themeSeg.classList.add('st-theme');
    themeSeg.querySelectorAll('.seg__opt').forEach((btn) => {
      const t = THEMES.find((x) => x.value === btn.getAttribute('data-value'));
      if (!t) return;
      btn.insertBefore(swatch(t.value), btn.firstChild);
      btn.appendChild(h('span.st-theme__sub', null, t.sub));
    });
    try {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      if (mq) {
        const onMq = () => { if (ctx.isActive()) paintThemeNote(); };
        if (mq.addEventListener) { mq.addEventListener('change', onMq); ctx.onLeave(() => mq.removeEventListener('change', onMq)); }
        else if (mq.addListener) { mq.addListener(onMq); ctx.onLeave(() => mq.removeListener(onMq)); }
      }
    } catch (_) { /* ignore */ }

    section('appearance', 'Appearance', null,
      h('div.st-appear', null, themeSeg, themeNote));

    /* ============================================================== 06 DATA & SYNC */

    const syncIcon = h('span.st-sync__icon', { 'aria-hidden': 'true' });
    const syncTitle = h('p.st-sync__title');
    const syncText = h('p.st-sync__text');
    const syncCard = h('div.st-sync', { attrs: { role: 'status' } },
      syncIcon,
      h('div.st-sync__body', null, syncTitle, syncText),
      h('span.st-led.st-sync__led', { 'aria-hidden': 'true' }));
    function paintSync(status) {
      const key = SYNC[status] ? status : 'local';
      const info = SYNC[key];
      const changed = syncCard.dataset.status && syncCard.dataset.status !== key;
      syncCard.dataset.status = key;
      headStatus.dataset.status = key;
      headTxt.textContent = info.short;
      headStatus.setAttribute('aria-label', 'Sync status: ' + info.title + '. Show data and sync settings');
      syncIcon.textContent = '';
      syncIcon.appendChild(ic(info.icon, 24));
      syncTitle.textContent = info.title;
      syncText.textContent = info.text;
      if (changed) replay(syncCard, 'is-changed');
    }
    paintSync(status0);
    if (F.persist && typeof F.persist.onStatus === 'function') {
      const off = F.persist.onStatus((s) => { if (ctx.isActive()) paintSync(s); });
      ctx.onLeave(off);
    }

    const statHost = h('div.st-store');
    const statEls = {};
    function statTile(key, label, iconName, plate) {
      const val = h('span.st-store__num');
      statEls[key] = val;
      return h('div.stat.st-store__tile', { dataset: plate ? { plate } : null },
        h('span.stat__label', null, ic(iconName, 15), label),
        h('span.stat__value', null, val));
    }
    let statsShown = null;
    function paintStore(animate) {
      const c = counts();
      const sig = c.any ? 'full' : 'empty';
      if (statsShown !== sig) {
        statsShown = sig;
        statHost.textContent = '';
        if (c.any) {
          statHost.appendChild(h('div.st-store__grid', null,
            statTile('workouts', 'Workouts', 'dumbbell'),
            statTile('journal', 'Journal', 'book'),
            statTile('waterDays', 'Water days', 'droplet')));
        } else {
          Object.keys(statEls).forEach((k) => delete statEls[k]);
          statHost.appendChild(F.ui.empty({
            icon: 'plate',
            title: 'Nothing logged yet',
            text: 'Finish a workout, log some water or write a journal entry and it’s counted here — and saved in every backup. New device? Import your backup below.'
          }));
        }
      }
      ['workouts', 'journal', 'waterDays'].forEach((k) => {
        const node = statEls[k];
        if (!node) return;
        if (animate) u.countUp(node, c[k], { from: 0, duration: 900 });
        else node.textContent = fmtN(c[k]);
      });
      const extra = statHost.querySelector('.st-store__extra');
      if (extra) extra.remove();
      if (c.any && c.custom) {
        statHost.appendChild(h('p.st-store__extra', null, '+ ' + c.custom + ' custom ' + plural(c.custom, 'exercise') + ' in your library.'));
      }
    }
    paintStore(false);

    const lastBackupEl = h('p.st-backup__last', null, ic('clock', 15), h('span', null, lastBackupText()));
    const fileInput = h('input.st-file', {
      type: 'file',
      accept: '.json,application/json',
      tabindex: '-1',
      'aria-hidden': 'true',
      hidden: true
    });
    const exportBtn = h('button.btn.btn--secondary.btn--lg.st-backup__btn', {
      type: 'button',
      onClick: () => doExport()
    }, ic('download', 22), h('span.st-backup__txt', null, h('span', null, 'Export backup'), h('small', null, '.json file')));
    const importBtn = h('button.btn.btn--secondary.btn--lg.st-backup__btn', {
      type: 'button',
      onClick: () => { try { fileInput.click(); } catch (_) { F.ui.toast('This browser can’t open files here.', { type: 'error' }); } }
    }, ic('upload', 22), h('span.st-backup__txt', null, h('span', null, 'Import backup'), h('small', null, 'Replaces your data')));

    async function doExport() {
      if (exportBtn.classList.contains('is-loading')) return;
      exportBtn.classList.add('is-loading');
      exportBtn.setAttribute('aria-busy', 'true');
      const name = backupName();
      let ok = false;
      try { ok = await F.persist.download(name, F.persist.exportJSON()); } catch (e) { console.error('[FORGE] export failed', e); ok = false; }
      exportBtn.classList.remove('is-loading');
      exportBtn.removeAttribute('aria-busy');
      if (ok) {
        u.storage.set(BACKUP_KEY, Date.now());
        if (ctx.isActive()) {
          lastBackupEl.lastChild.textContent = lastBackupText();
          flash('data', 'Backup saved');
        }
        F.ui.toast('Backup saved · ' + name, { type: 'ok', icon: 'download' });
      } else {
        F.ui.toast('Backup wasn’t saved. Try again.', { type: 'error' });
      }
    }

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) {
        fileInput.value = '';
        F.ui.toast('That file is too big to be a FORGE backup.', { type: 'error' });
        return;
      }
      let reader;
      try { reader = new FileReader(); } catch (_) {
        fileInput.value = '';
        F.ui.toast('This browser can’t read files here.', { type: 'error' });
        return;
      }
      reader.onerror = () => { fileInput.value = ''; F.ui.toast('Couldn’t read that file. Try again.', { type: 'error' }); };
      reader.onload = async () => {
        fileInput.value = '';
        const text = typeof reader.result === 'string' ? reader.result : '';
        const info = describeBackup(text);
        if (!info) {
          // Not JSON at all: let persist produce the friendly reason (it changes nothing on failure).
          const res = F.persist.importJSON(text);
          F.ui.toast((res && res.error) || 'That file isn’t a FORGE backup.', { type: 'error' });
          return;
        }
        const parts = [];
        parts.push(info.workouts + ' ' + plural(info.workouts, 'workout'));
        parts.push(info.journal + ' journal ' + plural(info.journal, 'entry', 'entries'));
        parts.push(info.water + ' ' + plural(info.water, 'day') + ' of water');
        const when = info.at ? ', saved ' + u.fmtDate(u.toISO(new Date(info.at)), 'dmy') + ' at ' + u.fmtTime(info.at) : '';
        const ok = await F.ui.confirm({
          title: 'Restore backup?',
          message: 'Replace all your data with this backup? It holds ' + listPhrase(parts) + when +
            '. Everything FORGE has stored right now will be overwritten.',
          confirmLabel: 'Replace my data',
          danger: true
        });
        if (!ok) { F.ui.toast('Import cancelled. Nothing changed.'); return; }
        const res = F.persist.importJSON(text);
        if (res && res.ok) F.ui.toast('Backup restored. Welcome back.', { type: 'ok', icon: 'upload' });
        else F.ui.toast((res && res.error) || 'Import failed. Your data was not changed.', { type: 'error' });
      };
      try { reader.readAsText(file); } catch (_) { fileInput.value = ''; F.ui.toast('Couldn’t read that file.', { type: 'error' }); }
    });

    // Danger zone
    const planHint = h('p.st-row__hint');
    const resetPlanBtn = h('button.btn.btn--secondary.st-danger__btn', { type: 'button', onClick: () => doResetPlan() },
      ic('repeat', 18), 'Reset plan');
    function paintPlanState() {
      const same = planIsDefault();
      const name = (program.splitInfo && program.splitInfo.name) || 'default split';
      planHint.textContent = same
        ? 'Your plan already matches the ' + name + '.'
        : 'Put the ' + name + ' back on every day. Logged workouts are kept.';
      resetPlanBtn.disabled = same;
    }
    paintPlanState();

    async function doResetPlan() {
      const name = (program.splitInfo && program.splitInfo.name) || 'default split';
      const ok = await F.ui.confirm({
        title: 'Reset your plan?',
        message: 'Your week goes back to the ' + name + ' (Mon Chest & Biceps · Tue Back & Triceps · Wed Shoulders & Forearms · Thu Legs · Fri Push). Your custom days and swaps are replaced. Logged workouts, water and journal are kept.',
        confirmLabel: 'Reset plan',
        danger: true
      });
      if (!ok) return;
      let prev = null;
      try { prev = u.clone(S().plan.days); } catch (_) { prev = null; }
      F.store.resetPlan();
      if (ctx.isActive()) flash('data', 'Plan reset');
      F.ui.toast('Plan reset to the ' + name + '.', {
        type: 'ok',
        icon: 'calendar',
        action: prev ? {
          label: 'Undo',
          onClick: () => {
            u.DAY_KEYS.forEach((k) => { if (prev[k]) F.store.setDay(k, prev[k]); });
            F.ui.toast('Your previous plan is back.', { type: 'ok', icon: 'undo' });
          }
        } : undefined
      });
    }

    async function doErase() {
      const c = counts();
      const cloud = F.persist && F.persist.status && F.persist.status() === 'cloud';
      const what = [];
      if (c.workouts) what.push(c.workouts + ' ' + plural(c.workouts, 'workout'));
      if (c.journal) what.push(c.journal + ' journal ' + plural(c.journal, 'entry', 'entries'));
      if (c.waterDays) what.push(c.waterDays + ' ' + plural(c.waterDays, 'day') + ' of water');
      const ok1 = await F.ui.confirm({
        title: 'Erase everything?',
        message: 'This deletes ' + (what.length ? listPhrase(what) + ', ' : '') + 'your plan and your settings' +
          (cloud ? ' — here and in your Claude account' : ' from this device') +
          '. It can’t be undone, so export a backup first if you might want it back.',
        confirmLabel: 'Continue',
        danger: true
      });
      if (!ok1) return;
      const typed = await F.ui.prompt({
        title: 'Type ERASE to confirm',
        label: 'Last step — this wipes FORGE clean',
        placeholder: 'ERASE',
        confirmLabel: 'Erase everything'
      });
      if (typed === null) return;
      if (String(typed).trim().toUpperCase() !== 'ERASE') {
        F.ui.toast('Nothing erased — type ERASE to confirm.', { type: 'warn' });
        return;
      }
      F.store.reset();
      try { F.persist.flush(); } catch (_) { /* scheduled anyway */ }
      F.ui.toast('Everything erased. Fresh start.', {
        type: 'ok',
        icon: 'sparkle',
        action: { label: 'Today', onClick: () => { try { F.router.go('today'); } catch (_) { /* ignore */ } } }
      });
    }

    section('data', 'Data & sync', null,
      syncCard,
      statHost,
      h('div.st-backup', null,
        h('div.st-backup__btns', null, exportBtn, importBtn),
        lastBackupEl,
        fileInput),
      h('div.st-danger', null,
        h('p.st-danger__title', null, ic('info', 16), 'Danger zone'),
        h('div.st-danger__row', null,
          h('div.st-row__text', null,
            h('span.st-row__label', null, 'Reset plan to the default split'),
            planHint),
          resetPlanBtn),
        h('div.st-danger__row', null,
          h('div.st-row__text', null,
            h('span.st-row__label', null, 'Erase everything'),
            h('p.st-row__hint', null, 'Deletes every workout, water log, journal entry and setting. Asks twice.')),
          h('button.btn.btn--danger.st-danger__btn', { type: 'button', onClick: () => doErase() }, ic('trash', 18), 'Erase all'))));

    // Count the storage tiles up the first time the section scrolls into view.
    try {
      if (typeof IntersectionObserver === 'function' && !reduced()) {
        const once = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            once.disconnect();
            if (ctx.isActive()) paintStore(true);
          }
        }, { threshold: 0.25 });
        once.observe(statHost);
        ctx.onLeave(() => once.disconnect());
      }
    } catch (_) { /* numbers are already shown */ }

    /* ============================================================== 07 ABOUT */

    const info = program.splitInfo || {};
    const version = (F.app && F.app.version) || '1.0.0';
    const weekList = h('ol.st-week');
    function paintWeek() {
      weekList.textContent = '';
      const days = (S().plan && S().plan.days) || {};
      const today = u.dayKeyOf(u.todayISO());
      u.DAY_KEYS.forEach((k, i) => {
        const d = days[k] || {};
        const rest = !!d.rest || !(Array.isArray(d.items) && d.items.length);
        const focus = Array.isArray(d.focus) ? d.focus.filter((m) => program.MUSCLES && program.MUSCLES[m]) : [];
        const plates = rest ? [] : (focus.length ? focus : ['fullbody']).slice(0, 3).map((m) => F.ui.plateOf(m) || 'white');
        const title = String(d.title || (rest ? 'Rest' : 'Training'));
        weekList.appendChild(h('li', { style: { '--i': i } },
          h('button', {
            type: 'button',
            class: ['st-week__day', rest ? 'is-rest' : null, k === today ? 'is-today' : null],
            dataset: { plate: plates[0] || null },
            'aria-label': u.DAY_LONG[k] + ': ' + title + (k === today ? ' (today)' : '') + '. Open in Plan',
            onClick: () => ctx.go('plan', { day: k })
          },
          h('span.st-week__wd', null, u.DAY_SHORT[k]),
          h('span.st-week__plates', { 'aria-hidden': 'true' }, rest
            ? h('span.st-week__rest', null, ic('bed', 14))
            : plates.map((p) => h('span.st-week__plate', { dataset: { plate: p } }))),
          h('span.st-week__title', null, title))));
      });
    }
    paintWeek();

    const whyList = h('ul.st-why', null, (Array.isArray(info.why) ? info.why : []).map((line) =>
      h('li', null, h('span.st-why__tick', { 'aria-hidden': 'true' }, ic('check', 14)), h('span', null, String(line)))));
    const howList = h('ol.st-how', null, (Array.isArray(info.howToProgress) ? info.howToProgress : []).map((line, i) =>
      h('li', null, h('span.st-how__n', { 'aria-hidden': 'true' }, String(i + 1)), h('span', null, String(line)))));

    section('about', 'About', null,
      h('div.st-brand', null,
        h('div.st-brand__row', null,
          h('span.st-brand__mark', null, 'FORGE'),
          h('span.badge.st-brand__ver', null, 'v' + version)),
        h('p.st-brand__tag', null, 'Stick to the plan. Earn the plates.')),
      h('div.st-panel.st-split', null,
        h('p.eyebrow', null, 'Your split'),
        h('h4.st-split__name', null, String(info.name || 'Your split')),
        Array.isArray(info.aka) && info.aka.length
          ? h('p.st-split__aka', null, h('span.st-split__aka-lbl', null, 'Also called'),
            info.aka.map((a) => h('span.badge', null, String(a))))
          : null,
        weekList,
        info.summary ? h('p.st-split__summary', null, String(info.summary)) : null,
        whyList.children.length ? h('div.st-split__block', null, h('p.st-split__h', null, 'Why it works'), whyList) : null,
        howList.children.length ? h('details.st-split__more', null,
          h('summary', null, h('span', null, 'How to progress'), ic('chevron-down', 18)),
          howList) : null),
      h('div.st-made', null,
        h('span.st-made__icons', { 'aria-hidden': 'true' },
          ['dumbbell', 'bar', 'bench', 'body'].map((n) => h('span.st-made__icon', null, ic(n, 20)))),
        h('p', null, 'Made for home training: dumbbells, pull-up bar, bench & bodyweight.')));

    /* -------------------------------------------------------------- scroll spy */

    try {
      if (typeof IntersectionObserver === 'function') {
        const visible = new Set();
        const spy = new IntersectionObserver((entries) => {
          entries.forEach((e) => { if (e.isIntersecting) visible.add(e.target.dataset.sec); else visible.delete(e.target.dataset.sec); });
          if (Date.now() < lockSpy) return;
          const first = SECTIONS.find((s) => visible.has(s.id));
          if (first) setActive(first.id);
        }, { rootMargin: '-130px 0px -55% 0px', threshold: 0 });
        SECTIONS.forEach((s) => { if (refs.secs[s.id]) spy.observe(refs.secs[s.id]); });
        ctx.onLeave(() => spy.disconnect());
      }
    } catch (_) { /* chips still work as plain jump links */ }
    setActive('profile');

    /* -------------------------------------------------------------- external changes */

    function syncSettings() {
      const st = settings();
      if (!isFocused(nameInput) && !saveName.pending() && nameInput.value !== String(st.name || '')) {
        nameInput.value = String(st.name || '');
        paintAvatar(nameInput.value);
      }
      unitsSeg.setValue(st.units === 'lb' ? 'lb' : 'kg');
      paintUnits();
      const r = restOf();
      if (r !== restVal && !restTimer) { restVal = r; paintRest(false); }
      swSound.setValue(st.sound !== false);
      swVibrate.setValue(canVibrate && st.vibrate !== false);
      swAwake.setValue(st.keepAwake !== false);
      if (!isFocused(goalStepper.input) && !goalStepper.isTyping()) {
        const g = goalOf();
        if (goalStepper.getValue() !== g) goalStepper.setValue(g);
        paintGoal(g, false);
      }
      const list = servingsOf();
      if (servList.dataset.sig !== list.join(',')) {
        const typingNow = servSteppers.some((s) => isFocused(s.input));
        if (list.length !== servSteppers.length && !typingNow) { buildServings(); paintAddServ(); }
        else {
          list.forEach((ml, i) => {
            const stp = servSteppers[i];
            if (!stp || isFocused(stp.input) || stp.isTyping()) return;
            if (stp.getValue() !== ml) stp.setValue(ml);
            paintServKind(i, ml);
          });
          servList.dataset.sig = list.join(',');
        }
      }
      paintKit();
      themeSeg.setValue(['auto', 'dark', 'light'].indexOf(st.theme) >= 0 ? st.theme : 'auto');
      paintThemeNote();
    }

    ctx.onState((state, reason) => {
      const parts = reasonsOf(reason);
      if (hasAny(parts, ['settings'])) syncSettings();
      if (hasAny(parts, ['finish', 'session', 'journal', 'water', 'library', 'workout'])) {
        paintStore(false);
        metaWorkouts.textContent = fmtN(counts().workouts);
      }
      if (hasAny(parts, ['library'])) paintKit();
      if (hasAny(parts, ['plan'])) { paintPlanState(); paintWeek(); paintDays(); }
    });

    ctx.onLeave(() => { commits.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } }); });

    /* -------------------------------------------------------------- params */

    const want = params && params.section ? String(params.section).toLowerCase() : '';
    const target = refs.secs[want] ? want : (ALIASES[want] && refs.secs[ALIASES[want]] ? ALIASES[want] : '');
    if (target && target !== 'profile') {
      // The router scrolls to top right after render; jump on the next frame.
      requestAnimationFrame(() => { if (ctx.isActive()) jumpTo(target, false); });
    }
  }

  // wide: a sticky section rail sits beside the content on desktop (≥ 1024px).
  F.router.register('settings', { title: 'Settings', nav: 'settings', wide: true, render });
})(window.Forge = window.Forge || {});
