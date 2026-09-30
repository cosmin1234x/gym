/* FORGE — js/views/library.js  [VIEW:library]
 * Exercise library (SPEC §12 "library"). Route 'library', params { id } (opens that exercise's info).
 *
 *   header     "Exercises" + live result count, how many moves you've logged, "Create" button
 *   bar        sticky search (debounced, clear button, '/' to focus) + Calisthenics chip + muscle chips
 *              (plate dots + live counts, read from F.data.program.MUSCLES)
 *   tools      type segmented (All / Weights / Bodyweight / Holds) + "My equipment" switch (F.q.canDo)
 *   list       "My exercises" (custom, with Edit) first, then groups by muscle with sticky plate headers;
 *              rows: plate dot, name, level, Calisthenics tag, equipment icons, your best set
 *   info       tap a row → F.picker.info(exId, { extra }) with your numbers (best set, est. 1RM, sessions,
 *              last done, sparkline), an "Add to plan" day strip (Mon..Sun), Calisthenics variations
 *              (F.picker.swap), See progress, and Edit for custom exercises
 *
 * Filters live in module state, so they persist while the app stays open. Typing/filtering only
 * re-assembles cached row nodes (the search input is never re-rendered, so it keeps focus).
 * Wide layout: at ≥1024px the filters become a sticky side panel next to the list.
 * User text (custom names) is rendered as text nodes only.
 */
(function (F) {
  'use strict';

  const h = (...args) => F.util.h(...args);
  const icon = (name, opts) => (typeof F.icon === 'function' ? F.icon(name, opts) : document.createElement('span'));
  const program = () => (F.data && F.data.program) || {};
  const has = (obj, key) => !!obj && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

  const FALLBACK_TYPES = {
    weight: { label: 'Weighted', short: 'Weight', icon: 'dumbbell' },
    bodyweight: { label: 'Bodyweight', short: 'Reps', icon: 'body' },
    time: { label: 'Timed hold', short: 'Hold', icon: 'timer' }
  };
  const FALLBACK_LEVELS = {
    beginner: { label: 'Beginner', rank: 1 }, intermediate: { label: 'Intermediate', rank: 2 }, advanced: { label: 'Advanced', rank: 3 }
  };
  const MUSCLES = () => program().MUSCLES || {};
  const EQUIP = () => program().EQUIPMENT || {};
  const TYPES = () => program().TYPES || FALLBACK_TYPES;
  const LEVELS = () => program().LEVELS || FALLBACK_LEVELS;
  const PATTERNS = () => program().PATTERNS || {};

  const muscleKeys = () => Object.keys(MUSCLES());
  const isMuscle = (m) => has(MUSCLES(), m);
  const muscleLabel = (m) => (isMuscle(m) ? MUSCLES()[m].label : 'Other');
  const typeKey = (t) => (has(TYPES(), t) ? t : 'weight');
  const levelMeta = (l) => (has(LEVELS(), l) ? LEVELS()[l] : LEVELS().beginner || FALLBACK_LEVELS.beginner);
  const equipMeta = (k) => (has(EQUIP(), k) ? EQUIP()[k] : { label: String(k || 'Gear'), icon: 'dumbbell' });
  function plateFor(m) {
    try { if (typeof program().plateFor === 'function') return program().plateFor(m) || 'white'; } catch (_) { /* fall through */ }
    return (isMuscle(m) && MUSCLES()[m].plate) || 'white';
  }
  /** Group a (possibly odd) exercise under a known muscle. */
  function groupKey(ex) {
    if (ex && isMuscle(ex.muscle)) return ex.muscle;
    const keys = muscleKeys();
    return keys.indexOf('fullbody') >= 0 ? 'fullbody' : keys[keys.length - 1];
  }

  const DAY_KEYS = () => F.util.DAY_KEYS;
  const dayShort = (k) => (F.util.DAY_SHORT && F.util.DAY_SHORT[k]) || String(k);
  const dayLong = (k) => (F.util.DAY_LONG && F.util.DAY_LONG[k]) || String(k);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const reduced = () => { try { return !!F.util.reducedMotion(); } catch (_) { return false; } };
  const haptic = (p) => { try { F.util.haptic(p); } catch (_) { /* optional */ } };
  const toast = (msg, opts) => { try { return F.ui.toast(msg, opts); } catch (_) { return null; } };
  const canDo = (ex) => { try { return !!F.q.canDo(ex); } catch (_) { return true; } };
  const owns = (k) => { try { return !!F.q.owns(k); } catch (_) { return true; } };
  const exOf = (id) => {
    try { const e = F.q.exercise(id); if (e && typeof e === 'object') return e; } catch (_) { /* fall through */ }
    return { id: String(id), name: 'Deleted exercise', muscle: 'fullbody', equipment: [], type: 'weight', cues: [], defaults: {}, missing: true };
  };
  const nameOf = (ex) => (ex && typeof ex.name === 'string' && ex.name.trim() ? ex.name : 'Untitled exercise');
  function allExercises() {
    try { return (F.q.allExercises() || []).filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.id); } catch (_) { return []; }
  }

  /** Restart a one-shot CSS animation class (skipped under reduced motion). */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    if (reduced()) return;
    void el.offsetWidth;
    el.classList.add(cls);
    const done = (e) => { if (e.target === el) { el.classList.remove(cls); el.removeEventListener('animationend', done); } };
    el.addEventListener('animationend', done);
    setTimeout(() => el.classList.remove(cls), 1800);
  }

  /* ================================================================ filters (persist during the visit) */

  const TYPE_OPTS = [
    { value: 'all', label: 'All' },
    { value: 'weight', label: 'Weights' },
    { value: 'bodyweight', label: 'Bodyweight' },
    { value: 'time', label: 'Holds' }
  ];
  const filters = { q: '', muscle: null, cali: false, type: 'all', mine: true };
  const narrowed = () => !!(filters.q.trim() || filters.muscle || filters.cali || filters.type !== 'all');

  /* ================================================================ search */

  const SYNONYMS = {
    db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', bw: 'bodyweight', abs: 'core', ab: 'core', lats: 'back', lat: 'back',
    traps: 'shrug', pecs: 'chest', pec: 'chest', grip: 'forearms', wrists: 'wrist', delts: 'shoulders', delt: 'shoulders',
    bis: 'biceps', bi: 'biceps', tris: 'triceps', tri: 'triceps', glutes: 'legs', glute: 'legs', quads: 'legs',
    hamstrings: 'legs', hams: 'legs', calves: 'calf', cali: 'calisthenics', calis: 'calisthenics', calisthenic: 'calisthenics',
    holds: 'hold', hspu: 'handstand', ohp: 'shoulder press', rdl: 'romanian', t2b: 'toes', pullup: 'pull up', chinup: 'chin up',
    pushup: 'push up', situp: 'sit up', mine: 'custom'
  };
  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* old engines */ }
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function tokenize(q) {
    return norm(q).split(' ').filter(Boolean).map((t) => (SYNONYMS[t] ? [t, norm(SYNONYMS[t])] : [t]));
  }
  const hayCache = new Map(); // library exercises only (custom ones are edited in place)
  function haystack(ex) {
    if (!ex.custom && hayCache.has(ex.id)) return hayCache.get(ex.id);
    const pat = has(PATTERNS(), ex.pattern) ? PATTERNS()[ex.pattern].label : '';
    const tp = TYPES()[typeKey(ex.type)] || {};
    const parts = [nameOf(ex), ex.id, muscleLabel(ex.muscle), ex.muscle, levelMeta(ex.level).label, tp.label, pat,
      ex.type === 'time' ? 'hold timed' : '', ex.calisthenics ? 'calisthenics bodyweight' : '', ex.custom ? 'custom mine' : ''];
    for (const m of Array.isArray(ex.secondary) ? ex.secondary : []) parts.push(muscleLabel(m));
    for (const k of Array.isArray(ex.equipment) ? ex.equipment : []) parts.push(equipMeta(k).label);
    const spaced = ' ' + norm(parts.join(' ')) + ' ';
    const out = { spaced, compact: spaced.replace(/ /g, '') };
    if (!ex.custom) hayCache.set(ex.id, out);
    return out;
  }
  function matches(ex, toks) {
    if (!toks.length) return true;
    const hs = haystack(ex);
    return toks.every((alts) => alts.some((t) => hs.spaced.indexOf(t) >= 0 || hs.compact.indexOf(t.replace(/ /g, '')) >= 0));
  }
  /** Lower is better: the query starts the name, then a name word starts with it. */
  function score(ex, q) {
    if (!q) return 2;
    const n = norm(nameOf(ex));
    if (n.startsWith(q) || n.replace(/ /g, '').startsWith(q.replace(/ /g, ''))) return 0;
    return (' ' + n).indexOf(' ' + q.split(' ')[0]) >= 0 ? 1 : 2;
  }

  /* ================================================================ your numbers (per store revision) */

  let pcache = { key: null, map: new Map() };
  const setNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  /** exId → { sessions, last, best: {w, r}, bestE, bestR: {w, r}, bestT, maxW, maxE, totalReps, totalT }. */
  function personal() {
    const st = F.store.get();
    const rev = typeof F.store.rev === 'function' ? F.store.rev() : NaN;
    const key = Number.isNaN(rev) ? null : rev;
    if (key !== null && pcache.key === key) return pcache.map;
    const map = new Map();
    const sessions = Array.isArray(st.sessions) ? st.sessions : [];
    for (const s of sessions) {
      if (!s || !Array.isArray(s.exercises)) continue;
      for (const e of s.exercises) {
        if (!e || typeof e.exId !== 'string' || !Array.isArray(e.sets)) continue;
        const done = e.sets.filter((x) => x && x.done);
        if (!done.length) continue;
        let p = map.get(e.exId);
        if (!p) {
          p = { sessions: 0, lastSid: null, last: '', bestE: { e: 0, w: 0, r: 0 }, bestR: { r: 0, w: 0 }, bestT: 0, maxW: 0, totalReps: 0, totalT: 0 };
          map.set(e.exId, p);
        }
        if (p.lastSid !== s.id) { p.sessions++; p.lastSid = s.id; }
        if (typeof s.date === 'string' && s.date > p.last) p.last = s.date;
        for (const set of done) {
          const w = setNum(set.w); const r = setNum(set.r); const t = setNum(set.t);
          const e1 = w && r ? F.util.e1rm(w, r) : 0;
          if (e1 > p.bestE.e + 1e-9 || (Math.abs(e1 - p.bestE.e) < 1e-9 && e1 > 0 && w > p.bestE.w)) p.bestE = { e: e1, w, r };
          if (r > p.bestR.r || (r === p.bestR.r && r > 0 && w > p.bestR.w)) p.bestR = { r, w };
          if (t > p.bestT) p.bestT = t;
          if (w > p.maxW) p.maxW = w;
          p.totalReps += r;
          p.totalT += t;
        }
      }
    }
    pcache = { key, map };
    return map;
  }
  const statsFor = (id) => personal().get(id) || null;

  function fmtHold(t) {
    const s = Math.round(setNum(t));
    return s < 60 ? { value: String(s), unit: 's' } : { value: F.util.fmtClock(s), unit: 'min' };
  }
  /** 'Today' | 'Yesterday' | '3 days ago' | '28 Sep'. */
  function relDay(iso) {
    try {
      const d = F.util.diffDays(iso, F.util.todayISO());
      if (d === 0) return 'Today';
      if (d === 1) return 'Yesterday';
      if (d > 1 && d < 7) return d + ' days ago';
      return F.util.fmtDate(iso, 'dm');
    } catch (_) { return String(iso || ''); }
  }
  /** Row read-out of your best set, or null. */
  function bestText(ex, p) {
    if (!p) return null;
    const type = typeKey(ex.type);
    if (type === 'time' && p.bestT) { const x = fmtHold(p.bestT); return x.value + ' ' + x.unit; }
    if (type === 'weight' && p.bestE.e > 0) return F.util.fmtWeight(p.bestE.w) + ' × ' + p.bestE.r;
    if (p.bestR.r > 0) return plural(p.bestR.r, 'rep');
    if (p.bestT) { const x = fmtHold(p.bestT); return x.value + ' ' + x.unit; }
    return null;
  }

  /* ================================================================ info sheet: your numbers + actions */

  const liveStrips = new Set(); // sync fns of open "Add to plan" strips
  const openSheets = new Set(); // sheet apis opened by this view

  function numbersCard(ex) {
    const p = statsFor(ex.id);
    if (!p) {
      return h('div.lib-you.lib-you--empty', null,
        h('span.lib-you__empty-ico', { attrs: { 'aria-hidden': 'true' } }, icon('chart', { size: 22 })),
        h('div.lib-you__empty-text', null,
          h('p.lib-you__empty-title', null, 'No sets logged yet'),
          h('p.lib-you__empty-sub', null, 'Add it to a day below and log it. Your best set, est. 1RM and trend show up here.')));
    }
    const type = typeKey(ex.type);
    const units = F.store.get().settings.units;
    let hero = null; // { value, unit, tail, count(el) }
    let label = 'Best set';
    const cells = [];
    const hist = (() => { try { return F.q.exerciseHistory(ex.id) || []; } catch (_) { return []; } })();
    let series = [];
    let trendLabel = '';

    if (type === 'weight' && p.bestE.e > 0) {
      const dw = F.util.toDisplayWeight(p.bestE.w, units);
      const dp = Math.abs(dw - Math.round(dw)) < 1e-9 ? 0 : (Math.abs(dw * 10 - Math.round(dw * 10)) < 1e-9 ? 1 : 2);
      hero = { value: dw, fmt: (n) => F.util.fmtNum(n, dp), unit: units === 'lb' ? 'lb' : 'kg', tail: '× ' + p.bestE.r };
      cells.push(['Est. 1RM', F.util.fmtWeight(F.util.round(p.bestE.e, 1))]);
      series = hist.map((x) => setNum(x.bestE1rm));
      trendLabel = 'Est. 1RM trend';
    } else if (type === 'time' && p.bestT) {
      const x = fmtHold(p.bestT);
      label = 'Longest hold';
      hero = p.bestT < 60 ? { value: p.bestT, fmt: (n) => String(Math.round(n)), unit: 's' } : { value: p.bestT, fmt: (n) => F.util.fmtClock(n), unit: x.unit };
      cells.push(['Total held', F.util.fmtDuration(p.totalT)]);
      series = hist.map((x2) => setNum(x2.maxT));
      trendLabel = 'Longest hold trend';
    } else if (p.bestR.r > 0) {
      label = 'Most reps';
      hero = { value: p.bestR.r, fmt: (n) => String(Math.round(n)), unit: p.bestR.r === 1 ? 'rep' : 'reps', tail: p.bestR.w ? '+' + F.util.fmtWeight(p.bestR.w) : '' };
      cells.push(p.maxW && type !== 'weight' ? ['Most added', '+' + F.util.fmtWeight(p.maxW)] : ['Total reps', F.util.fmtNum(p.totalReps)]);
      series = hist.map((x) => Math.max(0, ...((x.sets || []).map((s) => setNum(s.r)))));
      trendLabel = 'Top reps trend';
    } else if (p.bestT) {
      const x = fmtHold(p.bestT);
      label = 'Longest hold';
      hero = { value: p.bestT, fmt: (n) => (p.bestT < 60 ? String(Math.round(n)) : F.util.fmtClock(n)), unit: x.unit };
      cells.push(['Total held', F.util.fmtDuration(p.totalT)]);
      series = hist.map((x2) => setNum(x2.maxT));
      trendLabel = 'Longest hold trend';
    }
    cells.push(['Sessions', String(p.sessions)]);
    cells.push(['Last done', p.last ? relDay(p.last) : '—']);

    const valueEl = h('span.lib-you__value', null, hero ? hero.fmt(hero.value) : '—');
    const heroEl = h('div.lib-you__hero', null,
      h('p.eyebrow.lib-you__label', null, icon('trophy', { size: 14 }), label),
      h('p.lib-you__best', null,
        valueEl,
        hero && hero.unit ? h('span.lib-you__unit', null, hero.unit) : null,
        hero && hero.tail ? h('span.lib-you__tail', null, hero.tail) : null));

    const vals = series.filter((v) => Number.isFinite(v)).slice(-12);
    let spark = null;
    try { spark = F.charts.spark({ values: vals, width: 132, height: 44, color: 'var(--plate, var(--accent))' }); } catch (_) { spark = null; }
    const trend = h('div.lib-you__trend', null,
      spark,
      h('span.lib-you__trend-label', { title: trendLabel }, vals.length > 1 ? vals.length + '-session trend' : 'Trend after 2 sessions'));

    const card = h('div.lib-you', { attrs: { role: 'group', 'aria-label': 'Your numbers' } },
      h('div.lib-you__top', null, heroEl, trend),
      h('dl.lib-you__cells', null, cells.map(([k, v], i) => h('div.lib-you__cell', { style: { '--i': String(i) } },
        h('dt', null, k), h('dd', null, v)))));
    if (hero) {
      try { F.util.countUp(valueEl, hero.value, { duration: 650, format: hero.fmt }); } catch (_) { valueEl.textContent = hero.fmt(hero.value); }
    }
    return card;
  }

  /** "Add to plan": 7 plate-coloured day tiles; one tap adds (with Undo). */
  function dayStrip(ex, isAlive) {
    const tiles = new Map();
    const note = h('p.lib-days__note', { attrs: { 'aria-live': 'polite' } });
    const todayKey = F.util.dayKeyOf(F.util.todayISO());
    const grid = h('div.lib-days__grid', { attrs: { role: 'group', 'aria-label': 'Add to a day of your plan' } },
      DAY_KEYS().map((k) => {
        const ico = h('span.lib-day__ico', { attrs: { 'aria-hidden': 'true' } });
        const b = h('button.lib-day', {
          type: 'button',
          class: k === todayKey ? 'is-today' : null,
          dataset: { day: k },
          on: { click: () => add(k) }
        }, h('span.lib-day__bar', { attrs: { 'aria-hidden': 'true' } }), h('span.lib-day__name', null, dayShort(k)), ico);
        tiles.set(k, { b, ico, state: '' });
        return b;
      }));

    function dayOf(k) {
      try { return F.q.dayPlan(k) || { title: '', rest: false, focus: [], items: [] }; } catch (_) { return { title: '', rest: false, focus: [], items: [] }; }
    }
    const itemsOf = (d) => (Array.isArray(d.items) ? d.items.filter((it) => it && typeof it === 'object') : []);
    function sync() {
      const inDays = [];
      tiles.forEach((t, k) => {
        const d = dayOf(k);
        const items = itemsOf(d);
        const inDay = items.some((it) => it.exId === ex.id);
        const state = inDay ? 'in' : (d.rest ? 'rest' : 'open');
        if (inDay) inDays.push(k);
        t.b.dataset.plate = d.rest && !inDay ? 'white' : plateFor(Array.isArray(d.focus) && d.focus.length ? d.focus : ex.muscle);
        t.b.dataset.state = state;
        t.b.setAttribute('aria-pressed', String(inDay));
        const title = d.title || dayLong(k);
        t.b.setAttribute('aria-label', dayLong(k) + ', ' + title + (d.rest ? ', rest day' : ', ' + plural(items.length, 'exercise')) +
          (inDay ? '. Already in this day' : '. Add ' + nameOf(ex)));
        t.b.title = title;
        if (t.state !== state) {
          F.util.clear(t.ico);
          t.ico.appendChild(icon(state === 'in' ? 'check' : state === 'rest' ? 'bed' : 'plus', { size: 18 }));
          if (t.state && state === 'in') replay(t.b, 'is-added');
          t.state = state;
        }
      });
      note.textContent = inDays.length
        ? 'In your plan on ' + inDays.map(dayShort).join(' · ') + '. Tap another day to add it there too.'
        : 'Not in your plan yet. Tap a day to add it.';
    }

    function doAdd(k) {
      const item = F.store.addPlanItem(k, ex.id);
      if (!item) { toast('Couldn’t add that exercise. Try again.', { type: 'error' }); return null; }
      haptic(12);
      return item;
    }
    function add(k) {
      const d = dayOf(k);
      const items = itemsOf(d);
      const t = tiles.get(k);
      if (items.some((it) => it.exId === ex.id)) {
        replay(t && t.b, 'shake');
        toast(nameOf(ex) + ' is already in ' + dayLong(k) + '’s plan', {
          action: { label: 'Add again', onClick: () => { const it = doAdd(k); if (it) toastAdded(k, it); } }
        });
        return;
      }
      if (d.rest) { makeTrainingDay(k, d); return; }
      const item = doAdd(k);
      if (item) toastAdded(k, item);
    }
    function toastAdded(k, item) {
      const d = dayOf(k);
      toast('Added to ' + dayLong(k) + (d.title ? ' · ' + d.title : ''), {
        type: 'ok', icon: 'calendar',
        action: { label: 'Undo', onClick: () => { F.store.removePlanItem(k, item.id); } }
      });
    }
    function makeTrainingDay(k, d) {
      Promise.resolve(F.ui.confirm({
        title: 'Train on ' + dayLong(k) + '?',
        message: dayLong(k) + ' is a rest day in your plan. Adding ' + nameOf(ex) + ' turns it into a training day.',
        confirmLabel: 'Yes, train'
      })).then((ok) => {
        if (!ok || (typeof isAlive === 'function' && !isAlive())) return;
        let snap = null;
        try { snap = JSON.parse(JSON.stringify(dayOf(k))); } catch (_) { snap = null; }
        const patch = { rest: false };
        if (!d.title || /^rest\b/i.test(d.title)) patch.title = ex.calisthenics ? 'Calisthenics' : muscleLabel(groupKey(ex));
        if (!Array.isArray(d.focus) || !d.focus.length) patch.focus = [groupKey(ex)];
        F.store.setDay(k, patch);
        const item = doAdd(k);
        if (!item) { if (snap) F.store.setDay(k, snap); return; }
        toast(dayLong(k) + ' is now a training day with ' + nameOf(ex), {
          type: 'ok', icon: 'calendar',
          action: { label: 'Undo', onClick: () => { if (snap) F.store.setDay(k, snap); else F.store.removePlanItem(k, item.id); } }
        });
      }).catch((err) => console.error('[forge/library]', err));
    }

    sync();
    const wrap = h('section.lib-days', { attrs: { 'aria-label': 'Add to plan' } },
      h('div.lib-days__head', null, h('h3.eyebrow', null, 'Add to plan'), h('span.lib-days__hint', null, 'One tap')),
      grid, note);
    liveStrips.add({ el: wrap, sync });
    return wrap;
  }

  function linkRow(ic, title, sub, meta, onClick, extraCls) {
    return h('button', { type: 'button', class: ['lib-link', extraCls || null], on: { click: onClick } },
      h('span.lib-link__ico', { attrs: { 'aria-hidden': 'true' } }, icon(ic, { size: 20 })),
      h('span.lib-link__main', null, h('span.lib-link__title', null, title), sub ? h('span.lib-link__sub', null, sub) : null),
      meta !== null && meta !== undefined ? h('span.lib-link__meta', null, String(meta)) : null,
      h('span.lib-link__go', { attrs: { 'aria-hidden': 'true' } }, icon('chevron-right', { size: 18 })));
  }

  /** Opens F.picker.info with the library's extra block (your numbers + plan + variations + progress). */
  function openInfo(exId, ctx) {
    if (typeof exId !== 'string' || !exId) return null;
    const ex = exOf(exId);
    let api = null;
    const alive = () => !!(api && api.el && api.el.isConnected) && (!ctx || ctx.isActive());
    const p = statsFor(ex.id);

    const links = [];
    if (!ex.missing) {
      let alts = { calisthenics: [] };
      try { alts = F.q.alternatives(ex.id) || alts; } catch (_) { /* ignore */ }
      const n = Array.isArray(alts.calisthenics) ? alts.calisthenics.length : 0;
      links.push(linkRow('body', 'Calisthenics variations',
        n ? 'Bodyweight & bar moves for the same muscles' : 'Browse alternatives for your equipment', n || null, () => {
          F.picker.swap(ex.id, {
            title: 'Variations',
            mode: 'browse',
            subtitle: 'Bodyweight and bar options for ' + muscleLabel(groupKey(ex)).toLowerCase() + '. Tap one to open it.',
            onPick: (id) => { if (id) openInfo(id, ctx); }
          });
        }, 'lib-link--cali'));
    }
    if (p) {
      links.push(linkRow('chart', 'See progress', 'Every session, charted', null, () => {
        if (api) api.close('nav');
        if (ctx && ctx.isActive()) ctx.go('progress', { tab: 'exercises', exId: ex.id });
        else F.router.go('progress', { tab: 'exercises', exId: ex.id });
      }));
    }
    if (ex.custom && !ex.missing) {
      links.push(linkRow('edit', 'Edit exercise', 'Name, muscle, tracking, cues', null, () => {
        F.picker.customForm({
          exercise: ex,
          onSave: (saved) => { if (api) api.close('edit'); if (saved && saved.id) setTimeout(() => openInfo(saved.id, ctx), 60); },
          onDelete: () => { if (api) api.close('delete'); }
        });
      }));
    }

    const block = h('div.lib-info', { dataset: { plate: plateFor(groupKey(ex)) } },
      numbersCard(ex),
      ex.missing ? null : dayStrip(ex, alive),
      links.length ? h('div.lib-links', null, links) : null);

    try { api = F.picker.info(ex.id, { extra: block }); } catch (err) { console.error('[forge/library]', err); return null; }
    if (!api) return null;
    openSheets.forEach((a) => { if (!a.el || !a.el.isConnected) openSheets.delete(a); });
    openSheets.add(api);
    // Your numbers and the day strip are the summary: lift them above the reference detail.
    try {
      const content = api.body && api.body.querySelector('.ex-info__content');
      const wrap = block.parentElement;
      if (!ex.missing && content && wrap && wrap !== content && content.firstChild) {
        content.insertBefore(block, content.firstChild);
        block.classList.add('is-lead');
        if (!wrap.children.length) wrap.remove();
      }
    } catch (_) { /* keeps the block at the end of the sheet */ }
    return api;
  }

  /* ================================================================ list rows */

  function levelTag(ex) {
    const lv = levelMeta(ex.level);
    return h('span.lib-level', { dataset: { level: String(lv.rank || 1) } },
      h('span.lib-level__bars', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')), lv.label);
  }
  function equipIcons(ex) {
    const keys = (Array.isArray(ex.equipment) ? ex.equipment : []).filter((k) => typeof k === 'string' && k !== 'bodyweight');
    const list = keys.length ? keys : ['bodyweight'];
    const labels = list.map((k) => equipMeta(k).label + (owns(k) ? '' : ' (not in your gear)'));
    return h('span.lib-eq', { title: labels.join(', ') },
      list.map((k) => h('span', { class: ['lib-eq__ico', owns(k) ? null : 'is-missing'], attrs: { 'aria-hidden': 'true' } },
        icon(equipMeta(k).icon, { size: 16 }))),
      h('span.sr-only', null, '. Equipment: ' + labels.join(', ')));
  }

  function rowSig(ex, best) {
    const eq = Array.isArray(ex.equipment) ? ex.equipment.map((k) => k + (owns(k) ? '1' : '0')).join(',') : '';
    return [nameOf(ex), ex.muscle, ex.level, ex.type, !!ex.calisthenics, !!ex.custom, eq, best || ''].join('|');
  }

  /* ================================================================ view */

  function render(el, params, ctx) {
    el.classList.add('lib');
    let first = true;
    let lastCount = 0;
    const rowCache = new Map(); // exId -> { sig, li }
    let flashId = null;

    /* ---------------------------------------------------------------- header */
    const countEl = h('span.lib-head__count', { attrs: { 'aria-hidden': 'true' } }, '0');
    const countSr = h('span.sr-only', { attrs: { 'aria-live': 'polite' } });
    const eyebrow = h('p.eyebrow.lib-head__eyebrow');
    const createBtn = h('button.btn.btn--secondary.btn--sm.lib-head__create', {
      type: 'button', on: { click: () => createCustom('') }
    }, icon('plus'), 'Create');
    const head = h('header.view-head.lib-head', null,
      h('div.view-head__titles', null, eyebrow,
        h('h2.h1.lib-head__title', null, h('span', null, 'Exercises'), countEl, countSr)),
      h('div.view-head__actions', null, createBtn));

    /* ---------------------------------------------------------------- search + chips (sticky) */
    const search = h('input.input.lib-search__input', {
      type: 'search', value: filters.q, placeholder: 'Search ' + allExercises().length + ' exercises',
      attrs: {
        'aria-label': 'Search exercises', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
        spellcheck: 'false', enterkeyhint: 'search'
      },
      on: {
        input: () => { clearBtn.hidden = !search.value; filters.q = search.value; debounced(); },
        keydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); flush(); search.blur(); }
          else if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); setQuery(''); }
        }
      }
    });
    const clearBtn = h('button.lib-search__clear', {
      type: 'button', hidden: !filters.q, attrs: { 'aria-label': 'Clear search' },
      on: { click: () => { setQuery(''); try { search.focus(); } catch (_) { /* ignore */ } } }
    }, icon('x', { size: 18 }));
    const searchWrap = h('div.lib-search', { attrs: { role: 'search' } },
      icon('search', { size: 20, cls: 'lib-search__icon' }), search, clearBtn,
      h('span.kbd.lib-search__kbd', { attrs: { 'aria-hidden': 'true' } }, '/'));

    const caliChip = F.ui.chip({
      label: 'Calisthenics', icon: 'body', active: filters.cali,
      onClick: () => { filters.cali = !filters.cali; syncChips(); changed(); }
    });
    caliChip.classList.add('lib-chip-cali');
    const allChip = F.ui.chip({ label: 'All', active: filters.muscle === null, count: 0, onClick: () => setMuscle(null) });
    allChip.dataset.muscle = '';
    const muscleChips = muscleKeys().map((m) => {
      const c = F.ui.chip({ label: muscleLabel(m), plate: plateFor(m), active: filters.muscle === m, count: 0, onClick: () => setMuscle(filters.muscle === m ? null : m) });
      c.dataset.muscle = m;
      return c;
    });
    const chipRow = h('div.chips.lib-chips', { attrs: { role: 'group', 'aria-label': 'Filter by muscle' } },
      caliChip, h('span.lib-chips__sep', { attrs: { 'aria-hidden': 'true' } }), allChip, muscleChips);
    const bar = h('div.lib-bar', null, searchWrap, chipRow);

    /* ---------------------------------------------------------------- type + equipment */
    const typeSeg = F.ui.segmented({
      options: TYPE_OPTS, value: filters.type, label: 'Exercise type',
      onChange: (v) => { filters.type = v; changed(); }
    });
    typeSeg.classList.add('lib-type');
    const mineSwitch = F.ui.switchEl({
      label: 'My equipment', checked: filters.mine,
      onChange: (v) => { filters.mine = !!v; changed(); }
    });
    mineSwitch.classList.add('lib-mine');
    mineSwitch.title = 'Only show moves your equipment allows';
    const tools = h('div.lib-tools', null, typeSeg);
    const side = h('div.lib-side', null, bar, tools);

    /* ---------------------------------------------------------------- results */
    const resultLine = h('span.lib-meta__line', { attrs: { 'aria-live': 'polite' } });
    const resetBtn = h('button.lib-meta__reset', { type: 'button', on: { click: resetFilters } }, icon('undo', { size: 14 }), 'Reset');
    const meta = h('div.lib-meta', null, h('p.lib-meta__info', null, resultLine, resetBtn), mineSwitch);
    resetBtn.setAttribute('aria-label', 'Reset filters');
    const listEl = h('div.lib-list');
    const main = h('div.lib-main', null, meta, listEl);
    const layout = h('div.lib-layout', null, side, main);

    el.append(head, layout);

    /* ---------------------------------------------------------------- filter actions */
    function syncChips() {
      allChip.setActive(filters.muscle === null);
      muscleChips.forEach((c) => c.setActive(c.dataset.muscle === filters.muscle));
      caliChip.setActive(filters.cali);
    }
    function setMuscle(m) {
      filters.muscle = m;
      syncChips();
      changed();
      const c = m ? muscleChips.find((x) => x.dataset.muscle === m) : allChip;
      try { if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
    }
    function setQuery(q) {
      search.value = q;
      filters.q = q;
      clearBtn.hidden = !q;
      flush();
    }
    function changed() {
      haptic(8);
      renderList('filter');
    }
    function resetFilters() {
      filters.q = ''; filters.muscle = null; filters.cali = false; filters.type = 'all';
      search.value = ''; clearBtn.hidden = true;
      typeSeg.setValue('all');
      syncChips();
      changed();
    }
    let qTimer = 0;
    function debounced() {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { qTimer = 0; renderList('typing'); }, 140);
    }
    function flush() { clearTimeout(qTimer); qTimer = 0; renderList('typing'); }

    function createCustom(name) {
      F.picker.customForm({
        name: name || '',
        muscle: filters.muscle || undefined,
        onSave: (ex) => {
          if (!ex || !ex.id || !ctx.isActive()) return;
          // Make sure the new exercise is visible: clear filters that would hide it.
          if (!matches(ex, tokenize(filters.q)) || (filters.muscle && ex.muscle !== filters.muscle) ||
              (filters.cali && !ex.calisthenics) || (filters.type !== 'all' && typeKey(ex.type) !== filters.type)) {
            filters.q = ''; search.value = ''; clearBtn.hidden = true;
            filters.muscle = null; filters.cali = false; filters.type = 'all';
            typeSeg.setValue('all'); syncChips();
          }
          if (filters.mine && !canDo(ex)) { filters.mine = false; mineSwitch.setValue(false); }
          flashId = ex.id; // the 'library' store notification re-renders the list and flashes the row
        }
      });
    }

    /* ---------------------------------------------------------------- compute */
    function compute() {
      const toks = tokenize(filters.q);
      const q = norm(filters.q);
      const keys = muscleKeys();
      const groups = new Map(keys.map((m) => [m, []]));
      const custom = [];
      const counts = {};
      keys.forEach((m) => { counts[m] = 0; });
      let countAll = 0; let total = 0; let hidden = 0; let customTotal = 0;
      const hiddenGear = new Set();
      allExercises().forEach((ex, i) => {
        if (ex.custom) customTotal++;
        if (!matches(ex, toks)) return;
        if (filters.cali && !ex.calisthenics) return;
        if (filters.type !== 'all' && typeKey(ex.type) !== filters.type) return;
        const gk = groupKey(ex);
        if (filters.mine && !canDo(ex)) {
          if (!filters.muscle || gk === filters.muscle) {
            hidden++;
            (Array.isArray(ex.equipment) ? ex.equipment : []).forEach((k) => { if (!owns(k)) hiddenGear.add(equipMeta(k).label); });
          }
          return;
        }
        counts[gk] = (counts[gk] || 0) + 1;
        countAll++;
        if (filters.muscle && gk !== filters.muscle) return;
        const rec = { ex, i, s: score(ex, q) };
        if (ex.custom) custom.push(rec);
        else if (groups.has(gk)) groups.get(gk).push(rec);
        total++;
      });
      const byScore = (a, b) => (a.s - b.s) || (a.i - b.i);
      custom.sort(byScore);
      for (const list of groups.values()) list.sort(byScore);
      return { groups, custom, counts, countAll, total, hidden, hiddenGear: Array.from(hiddenGear), customTotal };
    }

    /* ---------------------------------------------------------------- rows */
    function rowFor(ex) {
      const p = statsFor(ex.id);
      const best = bestText(ex, p);
      const sig = rowSig(ex, best);
      const cached = rowCache.get(ex.id);
      if (cached && cached.sig === sig) return cached.li;
      const name = nameOf(ex);
      const open = h('button.lib-row__open', { type: 'button', on: { click: () => openInfo(ex.id, ctx) } },
        F.ui.plateDot(groupKey(ex)),
        h('span.lib-row__text', null,
          h('span.lib-row__name', null, name),
          h('span.lib-row__sub', null,
            levelTag(ex),
            ex.calisthenics ? h('span.lib-tag', null, icon('body', { size: 13 }), 'Calisthenics') : null,
            ex.custom ? h('span.lib-tag.lib-tag--custom', null, 'Custom') : null,
            equipIcons(ex))),
        best
          ? h('span.lib-row__best', null, h('span.lib-row__best-label', null, 'Best'), h('span.lib-row__best-val', null, best))
          : h('span.lib-row__go', { attrs: { 'aria-hidden': 'true' } }, icon('chevron-right', { size: 18 })));
      const edit = ex.custom ? h('button.btn.btn--ghost.btn--icon.lib-row__edit', {
        type: 'button', attrs: { 'aria-label': 'Edit ' + name },
        on: {
          click: () => F.picker.customForm({
            exercise: ex,
            onSave: (saved) => { if (saved && saved.id) { flashId = saved.id; } }
          })
        }
      }, icon('edit', { size: 20 })) : null;
      const li = h('li.lib-row', {
        class: [ex.custom ? 'lib-row--custom' : null, canDo(ex) ? null : 'is-locked'],
        dataset: { id: ex.id, plate: plateFor(groupKey(ex)) }
      }, open, edit);
      rowCache.set(ex.id, { sig, li });
      return li;
    }

    function groupEl(key, title, list, opts) {
      const o = opts || {};
      const plate = o.plate || plateFor(key);
      const headId = 'lib-g-' + key;
      return h('section.lib-group', { class: o.cls || null, dataset: { plate, group: key }, attrs: { 'aria-labelledby': headId } },
        h('h3.lib-group__head', { id: headId },
          o.icon ? h('span.lib-group__ico', { attrs: { 'aria-hidden': 'true' } }, icon(o.icon, { size: 16 })) : h('span.lib-group__disc', { attrs: { 'aria-hidden': 'true' } }),
          h('span.lib-group__title', null, title),
          h('span.lib-group__count', null, h('span.sr-only', null, ', '), plural(list.length, 'exercise'))),
        list.length ? h('ul.lib-rows', null, list.map((r) => rowFor(r.ex))) : null,
        o.after || null);
    }

    function createCard(name) {
      return h('button.lib-create', { type: 'button', on: { click: () => createCustom(name || '') } },
        h('span.lib-create__ico', { attrs: { 'aria-hidden': 'true' } }, icon('plus', { size: 22 })),
        h('span.lib-create__main', null,
          h('span.lib-create__title', null, 'Create your own exercise'),
          h('span.lib-create__sub', null, 'Not in the library? Add your own move.')));
    }

    /* ---------------------------------------------------------------- list render */
    function renderList(mode) {
      const res = compute();
      const anchor = (mode === 'filter' || mode === 'typing') ? stuckAnchor() : null;

      // chips: live counts
      setCount(allChip, res.countAll);
      muscleChips.forEach((c) => setCount(c, res.counts[c.dataset.muscle] || 0));

      const frag = document.createDocumentFragment();
      const q = filters.q.trim();
      const showCreate = !res.customTotal && !q;
      if (res.custom.length) frag.appendChild(groupEl('mine', 'My exercises', res.custom, { cls: 'lib-group--mine', icon: 'user', plate: 'white' }));
      else if (showCreate && !filters.cali && filters.type === 'all') frag.appendChild(createCard(''));

      for (const [m, list] of res.groups) {
        if (!list.length) continue;
        frag.appendChild(groupEl(m, muscleLabel(m), list));
      }

      if (!res.total) {
        frag.appendChild(emptyState(res));
      } else if (res.hidden && filters.mine) {
        frag.appendChild(h('div.lib-hidden', null,
          h('span.lib-hidden__ico', { attrs: { 'aria-hidden': 'true' } }, icon('filter', { size: 18 })),
          h('p.lib-hidden__text', null, plural(res.hidden, 'more exercise') + ' need ' +
            (res.hiddenGear.length ? res.hiddenGear.join(' or ').toLowerCase() : 'gear you don’t have') + '.'),
          h('button.btn.btn--ghost.btn--sm', { type: 'button', on: { click: () => { filters.mine = false; mineSwitch.setValue(false); changed(); } } }, 'Show them')));
      }
      if (q && res.total) {
        frag.appendChild(h('button.lib-create.lib-create--inline', { type: 'button', on: { click: () => createCustom(q) } },
          h('span.lib-create__ico', { attrs: { 'aria-hidden': 'true' } }, icon('plus', { size: 20 })),
          h('span.lib-create__main', null,
            h('span.lib-create__title', null, 'Create “' + q.slice(0, 40) + '”'),
            h('span.lib-create__sub', null, 'Not what you meant? Make it a custom exercise.'))));
      }

      listEl.classList.remove('is-entering', 'is-filtering');
      if (first && !reduced()) {
        // Stagger-in on first render only (nested lists, so the view sets --i itself).
        listEl.classList.add('is-entering');
        Array.from(frag.querySelectorAll('.lib-group__head, .lib-row, .lib-create, .empty')).slice(0, 18).forEach((n, i) => {
          n.classList.add('lib-in');
          n.style.setProperty('--i', String(i));
        });
      }
      listEl.replaceChildren(frag);
      if (!first && mode === 'filter') replay(listEl, 'is-filtering');

      // header + meta
      const shown = res.total;
      if (first) { try { F.util.countUp(countEl, shown, { duration: 700 }); } catch (_) { countEl.textContent = String(shown); } }
      else if (shown !== lastCount) { try { F.util.countUp(countEl, shown, { from: lastCount, duration: 280 }); } catch (_) { countEl.textContent = String(shown); } }
      lastCount = shown;
      countSr.textContent = plural(shown, 'exercise') + ' shown';
      syncMeta(res);
      resetBtn.hidden = !narrowed();

      if (anchor !== null) restoreAnchor(anchor);
      if (flashId) {
        const r = rowCache.get(flashId);
        flashId = null;
        if (r && r.li.isConnected) {
          try { r.li.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
          replay(r.li, 'is-flash');
        }
      }
      first = false;
    }

    function setCount(chip, n) {
      const c = chip.querySelector('.chip__count');
      if (c) c.textContent = String(n);
      chip.classList.toggle('is-zero', !n);
    }

    /** One short line: what the equipment switch is hiding (the live count sits in the header badge). */
    function syncMeta(res) {
      let line;
      if (!filters.mine) line = 'Every move, gear or not';
      else if (res.hidden) line = res.hidden + ' need other gear';
      else if (narrowed()) line = plural(res.total, 'match', 'matches');
      else line = 'All fit your gear';
      resultLine.textContent = line;
      resultLine.classList.toggle('is-hidden-info', !!(filters.mine && res.hidden));
    }

    function emptyState(res) {
      const q = filters.q.trim();
      let node;
      if (res.hidden && filters.mine) {
        node = F.ui.empty({
          icon: 'filter',
          title: 'Needs other gear',
          text: plural(res.hidden, 'match', 'matches') + ' need ' + (res.hiddenGear.length ? res.hiddenGear.join(' or ').toLowerCase() : 'equipment') +
            ', which isn’t in your gear. Show them anyway, or tick it in Settings.',
          action: { label: 'Show all equipment', icon: 'filter', onClick: () => { filters.mine = false; mineSwitch.setValue(false); changed(); } }
        });
      } else if (q) {
        node = F.ui.empty({
          icon: 'search',
          title: 'No match',
          text: 'Nothing in your library matches “' + q.slice(0, 40) + '”. Create it once and it’s yours in every plan and workout.',
          action: { label: 'Create “' + q.slice(0, 24) + '” as a custom exercise', icon: 'plus', onClick: () => createCustom(q) }
        });
      } else {
        node = F.ui.empty({
          icon: 'filter',
          title: 'Nothing here',
          text: 'No exercise fits these filters. Loosen one, or reset them all.',
          action: { label: 'Reset filters', icon: 'undo', onClick: resetFilters }
        });
      }
      if ((filters.muscle || filters.cali || filters.type !== 'all') && (q || (res.hidden && filters.mine))) {
        node.appendChild(h('button.btn.btn--ghost.btn--sm', { type: 'button', on: { click: resetFilters } }, 'Reset filters'));
      }
      node.classList.add('lib-empty');
      return node;
    }

    /* ---------------------------------------------------------------- scroll anchoring (no jump) */
    const isWide = () => { try { return window.matchMedia('(min-width: 1024px)').matches; } catch (_) { return false; } };
    /** Bottom edge of the fixed topbar (the sticky bar docks under it). */
    function shellTop() {
      try {
        const tb = document.getElementById('topbar');
        const r = tb ? tb.getBoundingClientRect() : null;
        return r && r.height ? r.bottom : 0;
      } catch (_) { return 0; }
    }
    /** If the list was scrolled under the sticky bar, remember to pin the results to its bottom edge. */
    function stuckAnchor() {
      try {
        const top = main.getBoundingClientRect().top;
        const edge = isWide() ? shellTop() : bar.getBoundingClientRect().bottom;
        return top < edge ? edge : null;
      } catch (_) { return null; }
    }
    function restoreAnchor(edge) {
      try {
        const top = main.getBoundingClientRect().top;
        const y = window.scrollY + top - edge - 4;
        window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
      } catch (_) { /* ignore */ }
    }

    /* ---------------------------------------------------------------- measure sticky bar */
    let ro = null;
    const measure = () => {
      try { el.style.setProperty('--lib-bar-h', Math.round(bar.getBoundingClientRect().height) + 'px'); } catch (_) { /* ignore */ }
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      try { ro = new ResizeObserver(measure); ro.observe(bar); } catch (_) { ro = null; }
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          const stuck = !isWide() && bar.getBoundingClientRect().top <= shellTop() + 0.5 && window.scrollY > 4;
          bar.classList.toggle('is-stuck', stuck);
        } catch (_) { /* ignore */ }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('#overlay-root .sheet')) return;
      e.preventDefault();
      try { search.focus(); search.select(); } catch (_) { /* ignore */ }
    };
    document.addEventListener('keydown', onKey);

    /* ---------------------------------------------------------------- header eyebrow */
    function syncEyebrow() {
      const all = allExercises();
      const map = personal();
      let tried = 0;
      for (const ex of all) if (map.has(ex.id)) tried++;
      eyebrow.textContent = tried
        ? 'Library · ' + tried + ' of ' + all.length + ' logged'
        : 'Library · ' + all.length + ' moves';
    }

    /* ---------------------------------------------------------------- store */
    ctx.onState((state, reason) => {
      const rs = String(reason || '').split(' ');
      const any = (...k) => k.some((x) => rs.indexOf(x) >= 0);
      if (any('library', 'settings', 'finish', 'session')) {
        if (any('library')) hayCache.clear();
        renderList('store');
        syncEyebrow();
      }
      if (any('plan', 'library', 'settings')) {
        liveStrips.forEach((s) => {
          if (!s.el.isConnected) { liveStrips.delete(s); return; }
          try { s.sync(); } catch (err) { console.error('[forge/library]', err); }
        });
      }
    });

    ctx.onLeave(() => {
      clearTimeout(qTimer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      if (raf) cancelAnimationFrame(raf);
      if (ro) { try { ro.disconnect(); } catch (_) { /* ignore */ } }
      openSheets.forEach((api) => { try { if (api.el && api.el.isConnected) api.close('leave'); } catch (_) { /* ignore */ } });
      openSheets.clear();
      liveStrips.clear();
    });

    /* ---------------------------------------------------------------- first paint */
    syncEyebrow();
    renderList('enter');
    onScroll();

    const wanted = params && typeof params.id === 'string' ? params.id : '';
    if (wanted) {
      setTimeout(() => {
        if (!ctx.isActive()) return;
        const r = rowCache.get(wanted);
        if (r && r.li.isConnected) {
          try { r.li.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) { /* ignore */ }
          replay(r.li, 'is-flash');
        }
        openInfo(wanted, ctx);
      }, 120);
    }
  }

  F.router.register('library', { title: 'Exercises', nav: 'library', wide: true, render });
})(window.Forge = window.Forge || {});
