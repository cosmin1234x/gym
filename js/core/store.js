/* FORGE — js/core/store.js
 * Single state tree + all mutations. Contract: docs/SPEC.md §5.
 * - Every mutation goes through update(); subscribers are notified once per microtask.
 * - init()/replace() normalise ANY input (garbage, old versions, partial objects) against defaults().
 * - Mutations on missing ids are silent no-ops.
 * Notification reasons (space-joined when batched; test with reason.split(' ').includes(x)):
 *   settings plan library workout set rest finish session water journal meta reset + replace() reasons
 *   (e.g. 'import', 'cloud').
 */
(function (F) {
  'use strict';

  const U = () => F.util;
  const MUSCLE_KEYS = ['chest', 'back', 'biceps', 'triceps', 'shoulders', 'forearms', 'legs', 'core', 'fullbody'];
  const EX_TYPES = ['weight', 'bodyweight', 'time'];
  const LEVELS = ['beginner', 'intermediate', 'advanced'];
  const NOOP = Object.freeze({ noop: true }); // internal: mutator made no change

  /* ---------------------------------------------------------------- coercion helpers */

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, d = '') => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : d));
  function num(v, d = null) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(',', '.')) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : d;
  }
  function int(v, d = null) { const n = num(v, null); return n === null ? d : Math.round(n); }
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const ts = (v, d = null) => { const n = num(v, null); return n !== null && n > 0 ? n : d; };
  function rating(v) { const n = int(v, null); return n !== null && n >= 1 && n <= 5 ? n : null; }
  const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const dayKeyOk = (k) => typeof k === 'string' && U().DAY_KEYS.indexOf(k) >= 0;
  function jsonSafe(v) { try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch (_) { return undefined; } }
  function uniqStrings(arr, max, maxLen, lower) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const x of arr) {
      if (typeof x !== 'string') continue;
      let s = x.trim().slice(0, maxLen);
      if (lower) s = s.toLowerCase();
      if (s && out.indexOf(s) < 0) out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }
  /** Replace an object's contents in place (keeps references held by views valid). */
  function assignInPlace(target, src) {
    for (const k of Object.keys(target)) delete target[k];
    return Object.assign(target, src);
  }
  const findIdx = (arr, id) => (Array.isArray(arr) && id != null ? arr.findIndex((x) => x && x.id === id) : -1);
  function muscleKeys() {
    try {
      const m = F.data && F.data.program && F.data.program.MUSCLES;
      if (isObj(m) && Object.keys(m).length) return Object.keys(m);
    } catch (_) { /* ignore */ }
    return MUSCLE_KEYS;
  }
  function libraryIds() {
    const set = new Set();
    try { const ex = F.data && F.data.exercises; if (Array.isArray(ex)) for (const e of ex) if (e && e.id) set.add(e.id); } catch (_) { /* ignore */ }
    return set;
  }

  /* ---------------------------------------------------------------- defaults */

  function defaultSettings() {
    return {
      name: '', units: 'kg', theme: 'auto', waterGoal: 3000, waterServings: [250, 500, 750], restSeconds: 90,
      sound: true, vibrate: true, keepAwake: true,
      equipment: { pullupBar: true, dumbbells: true, bench: true, barbell: false, bands: false },
      onboarded: false
    };
  }
  function emptyPlan() {
    const days = {};
    for (const k of U().DAY_KEYS) days[k] = { title: '', rest: false, focus: [], items: [] };
    return { days };
  }
  /** F.data.program.defaultPlan() when available, else an empty 7-day plan (e.g. in unit tests). */
  function sourcePlan() {
    try {
      const prog = F.data && F.data.program;
      if (prog && typeof prog.defaultPlan === 'function') {
        const p = prog.defaultPlan();
        if (isObj(p) && isObj(p.days)) return p;
      }
    } catch (e) { console.error('[FORGE] defaultPlan() failed', e); }
    return emptyPlan();
  }
  function defaults() {
    const now = Date.now();
    return {
      version: 1,
      settings: defaultSettings(),
      plan: normPlan(sourcePlan()),
      customExercises: [],
      sessions: [],
      active: null,
      water: {},
      journal: [],
      meta: { createdAt: now, updatedAt: now, stamps: {}, celebrated: {} }
    };
  }

  /* ---------------------------------------------------------------- normalisers (never mutate input) */

  function normSettings(raw) {
    const d = defaultSettings();
    const r = isObj(raw) ? raw : {};
    const out = {};
    // keep unknown (forward-compatible) keys first, then overwrite known ones with validated values
    for (const k of Object.keys(r)) if (!(k in d) && k !== '__proto__') { const v = jsonSafe(r[k]); if (v !== undefined) out[k] = v; }
    out.name = str(r.name, '').slice(0, 60);
    out.units = r.units === 'lb' ? 'lb' : 'kg';
    out.theme = ['auto', 'dark', 'light'].indexOf(r.theme) >= 0 ? r.theme : 'auto';
    out.waterGoal = clampN(int(r.waterGoal, d.waterGoal), 250, 10000);
    const serv = Array.isArray(r.waterServings)
      ? r.waterServings.map((x) => int(x, null)).filter((x) => x !== null && x >= 10 && x <= 5000)
      : [];
    out.waterServings = serv.length ? Array.from(new Set(serv)).slice(0, 6) : d.waterServings;
    out.restSeconds = clampN(int(r.restSeconds, d.restSeconds), 0, 1800);
    out.sound = bool(r.sound, d.sound);
    out.vibrate = bool(r.vibrate, d.vibrate);
    out.keepAwake = bool(r.keepAwake, d.keepAwake);
    const re = isObj(r.equipment) ? r.equipment : {};
    const eq = {};
    for (const k of Object.keys(re)) if (!(k in d.equipment) && typeof re[k] === 'boolean') eq[k] = re[k];
    for (const k of Object.keys(d.equipment)) eq[k] = bool(re[k], d.equipment[k]);
    out.equipment = eq;
    out.onboarded = bool(r.onboarded, d.onboarded);
    return out;
  }

  function normPlanItem(raw) {
    if (!isObj(raw)) return null;
    const exId = str(raw.exId, '').trim();
    if (!exId) return null;
    const rest = raw.rest === null || raw.rest === undefined ? null : int(raw.rest, null);
    return {
      id: str(raw.id, '') || U().uid('pi-'),
      exId,
      sets: clampN(int(raw.sets, 3), 1, 20),
      target: str(raw.target, '').trim().slice(0, 24) || '8-12',
      rest: rest === null ? null : clampN(rest, 0, 1800),
      note: str(raw.note, '').slice(0, 500)
    };
  }
  function normDay(raw) {
    const r = isObj(raw) ? raw : {};
    const seen = new Set();
    const items = [];
    if (Array.isArray(r.items)) {
      for (const it of r.items) {
        const n = normPlanItem(it);
        if (!n) continue;
        if (seen.has(n.id)) n.id = U().uid('pi-');
        seen.add(n.id);
        items.push(n);
      }
    }
    return { title: str(r.title, '').slice(0, 60), rest: bool(r.rest, false), focus: uniqStrings(r.focus, 8, 24, false), items };
  }
  function normPlan(raw) {
    const days = isObj(raw) && isObj(raw.days) ? raw.days : null;
    let fallback = null;
    const out = { days: {} };
    for (const k of U().DAY_KEYS) {
      if (days && isObj(days[k])) out.days[k] = normDay(days[k]);
      else {
        if (!fallback) fallback = sourcePlan();
        out.days[k] = normDay(fallback.days && fallback.days[k]);
      }
    }
    return out;
  }

  function normCustomExercise(raw, takenIds) {
    if (!isObj(raw)) return null;
    const name = str(raw.name, '').trim().slice(0, 60);
    if (!name) return null;
    const muscles = muscleKeys();
    const type = EX_TYPES.indexOf(raw.type) >= 0 ? raw.type : 'weight';
    const dd = isObj(raw.defaults) ? raw.defaults : {};
    let id = str(raw.id, '').trim();
    if (!id || (takenIds && takenIds.has(id))) id = 'custom-' + U().uid();
    if (takenIds) takenIds.add(id);
    const rest = int(dd.rest, 90);
    return {
      id,
      name,
      muscle: muscles.indexOf(raw.muscle) >= 0 ? raw.muscle : 'fullbody',
      secondary: uniqStrings(raw.secondary, 6, 24, false).filter((m) => muscles.indexOf(m) >= 0 && m !== raw.muscle),
      equipment: uniqStrings(raw.equipment, 8, 24, false),
      type,
      calisthenics: bool(raw.calisthenics, false),
      level: LEVELS.indexOf(raw.level) >= 0 ? raw.level : 'beginner',
      defaults: {
        sets: clampN(int(dd.sets, 3), 1, 20),
        target: str(dd.target, '').trim().slice(0, 24) || (type === 'time' ? '30s' : '8-12'),
        rest: clampN(rest === null ? 90 : rest, 0, 1800)
      },
      cues: uniqStrings(raw.cues, 10, 160, false),
      ...(typeof raw.pattern === 'string' && F.data && F.data.program && F.data.program.PATTERNS &&
        Object.prototype.hasOwnProperty.call(F.data.program.PATTERNS, raw.pattern) ? { pattern: raw.pattern } : {}),
      custom: true
    };
  }

  function normSet(raw) {
    if (!isObj(raw)) return null;
    const w = num(raw.w, null); const r = int(raw.r, null); const t = num(raw.t, null);
    return {
      id: str(raw.id, '') || U().uid('st-'),
      w: w === null ? null : clampN(U().round(w, 3), -500, 2000),
      r: r === null ? null : clampN(r, 0, 1000),
      t: t === null ? null : clampN(Math.round(t), 0, 36000),
      done: bool(raw.done, false),
      at: ts(raw.at, null)
    };
  }
  function normEntry(raw) {
    if (!isObj(raw)) return null;
    const exId = str(raw.exId, '').trim();
    if (!exId) return null;
    const rest = raw.rest === null || raw.rest === undefined ? null : int(raw.rest, null);
    const seen = new Set();
    const sets = [];
    if (Array.isArray(raw.sets)) {
      for (const s of raw.sets) {
        const n = normSet(s);
        if (!n) continue;
        if (seen.has(n.id)) n.id = U().uid('st-');
        seen.add(n.id);
        sets.push(n);
      }
    }
    return {
      id: str(raw.id, '') || U().uid('se-'),
      exId,
      target: str(raw.target, '').trim().slice(0, 24),
      rest: rest === null ? null : clampN(rest, 0, 1800),
      note: str(raw.note, '').slice(0, 2000),
      sets
    };
  }
  function normRest(raw) {
    if (!isObj(raw)) return null;
    const endsAt = ts(raw.endsAt, null);
    const duration = int(raw.duration, null);
    if (endsAt === null || duration === null || duration < 0) return null;
    const out = { endsAt, duration: clampN(duration, 0, 7200), exEntryId: str(raw.exEntryId, '') || null };
    if (typeof raw.setId === 'string' && raw.setId) out.setId = raw.setId;
    return out;
  }
  function normSession(raw, isActive) {
    if (!isObj(raw)) return null;
    const u = U();
    const startedAt = ts(raw.startedAt, null);
    const date = u.isISO(raw.date) ? raw.date : (startedAt ? u.toISO(startedAt) : '');
    if (!date) return null;
    const start = startedAt || (u.fromISO(date).getTime() + 12 * 3600e3);
    let endedAt = ts(raw.endedAt, null);
    if (endedAt !== null && endedAt < start) endedAt = null;
    const seen = new Set();
    const exercises = [];
    if (Array.isArray(raw.exercises)) {
      for (const e of raw.exercises) {
        const n = normEntry(e);
        if (!n) continue;
        if (seen.has(n.id)) n.id = u.uid('se-');
        seen.add(n.id);
        exercises.push(n);
      }
    }
    return {
      id: str(raw.id, '') || u.uid('s-'),
      date,
      dayKey: dayKeyOk(raw.dayKey) ? raw.dayKey : null,
      title: str(raw.title, '').trim().slice(0, 80) || 'Workout',
      startedAt: start,
      endedAt: isActive ? null : endedAt,
      exercises,
      note: str(raw.note, '').slice(0, 5000),
      feeling: rating(raw.feeling),
      rest: isActive ? normRest(raw.rest) : null
    };
  }
  function sortSessions(list) { return list.sort((a, b) => a.startedAt - b.startedAt); }
  function normSessions(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const s of raw) {
      const n = normSession(s, false);
      if (!n) continue;
      if (seen.has(n.id)) n.id = U().uid('s-');
      seen.add(n.id);
      out.push(n);
    }
    return sortSessions(out);
  }

  function normWaterEntry(raw, iso) {
    if (!isObj(raw)) return null;
    const ml = int(raw.ml, null);
    if (ml === null || ml <= 0) return null;
    return { id: str(raw.id, '') || U().uid('w-'), ml: clampN(ml, 1, 5000), at: ts(raw.at, U().fromISO(iso).getTime() + 12 * 3600e3) };
  }
  function normWater(raw) {
    const out = {};
    if (!isObj(raw)) return out;
    for (const iso of Object.keys(raw).sort()) {
      if (!U().isISO(iso) || !Array.isArray(raw[iso])) continue;
      const seen = new Set();
      const list = [];
      for (const e of raw[iso]) {
        const n = normWaterEntry(e, iso);
        if (!n) continue;
        if (seen.has(n.id)) n.id = U().uid('w-');
        seen.add(n.id);
        list.push(n);
      }
      if (list.length) out[iso] = list.sort((a, b) => a.at - b.at);
    }
    return out;
  }

  function normJournalEntry(raw) {
    if (!isObj(raw)) return null;
    const u = U();
    const now = Date.now();
    const createdAt = ts(raw.createdAt, now);
    const sleep = num(raw.sleep, null);
    const bw = num(raw.bodyweight, null);
    return {
      id: str(raw.id, '') || u.uid('j-'),
      date: u.isISO(raw.date) ? raw.date : (u.toISO(createdAt) || u.todayISO()),
      createdAt,
      updatedAt: Math.max(createdAt, ts(raw.updatedAt, createdAt)),
      title: str(raw.title, '').slice(0, 120),
      text: str(raw.text, '').slice(0, 20000),
      mood: rating(raw.mood),
      energy: rating(raw.energy),
      sleep: sleep !== null && sleep >= 0 && sleep <= 24 ? u.round(sleep, 1) : null,
      bodyweight: bw !== null && bw > 0 && bw <= 500 ? u.round(bw, 3) : null,
      tags: uniqStrings(raw.tags, 12, 24, true),
      pinned: bool(raw.pinned, false)
    };
  }
  function normJournal(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const e of raw) {
      const n = normJournalEntry(e);
      if (!n) continue;
      if (seen.has(n.id)) n.id = U().uid('j-');
      seen.add(n.id);
      out.push(n);
    }
    return out;
  }

  function normMeta(raw, sessions) {
    const r = isObj(raw) ? raw : {};
    const now = Date.now();
    let createdAt = ts(r.createdAt, null);
    if (createdAt === null) createdAt = sessions.length ? Math.min(now, sessions[0].startedAt) : now;
    const stamps = {};
    if (isObj(r.stamps)) for (const k of Object.keys(r.stamps)) { const v = num(r.stamps[k], null); if (v !== null && v >= 0) stamps[k] = v; }
    const celebrated = {};
    if (isObj(r.celebrated)) for (const k of Object.keys(r.celebrated)) if (r.celebrated[k]) celebrated[k] = true;
    return { createdAt, updatedAt: ts(r.updatedAt, createdAt), stamps, celebrated };
  }

  /** Any input → a valid v1 state. Never throws. */
  function normalize(input) {
    let raw = input;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { raw = null; } }
    if (!isObj(raw)) return defaults();
    try {
      const taken = libraryIds();
      const custom = [];
      if (Array.isArray(raw.customExercises)) for (const e of raw.customExercises) { const n = normCustomExercise(e, taken); if (n) custom.push(n); }
      const sessions = normSessions(raw.sessions);
      return {
        version: 1,
        settings: normSettings(raw.settings),
        plan: normPlan(raw.plan),
        customExercises: custom,
        sessions,
        active: raw.active ? normSession(raw.active, true) : null,
        water: normWater(raw.water),
        journal: normJournal(raw.journal),
        meta: normMeta(raw.meta, sessions)
      };
    } catch (e) {
      console.error('[FORGE] state normalisation failed; starting fresh', e);
      return defaults();
    }
  }

  /* ---------------------------------------------------------------- core */

  let state = null;
  let rev = 0;
  const subs = [];
  let pendingReasons = [];
  let notifyQueued = false;

  const microtask = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);

  function ensure() { if (!state) state = defaults(); return state; }
  function setState(next) {
    if (!state) state = next; else assignInPlace(state, next);
    rev++;
    return state;
  }
  function flushNotify() {
    notifyQueued = false;
    const seen = [];
    for (const r of pendingReasons) for (const p of String(r || '').split(' ')) if (p && seen.indexOf(p) < 0) seen.push(p);
    pendingReasons = [];
    const reason = seen.join(' ');
    for (const fn of subs.slice()) {
      if (subs.indexOf(fn) < 0) continue; // unsubscribed during this flush
      try { fn(state, reason); } catch (e) { console.error('[FORGE] store subscriber failed', e); }
    }
  }
  function notify(reason) {
    pendingReasons.push(reason || '');
    if (notifyQueued) return;
    notifyQueued = true;
    microtask(flushNotify);
  }
  function schedulePersist() {
    try { if (F.persist && typeof F.persist.schedule === 'function') F.persist.schedule(); } catch (e) { console.error('[FORGE] persist.schedule failed', e); }
  }
  /** Run a mutator; NOOP return skips notify/persist. Revision bumps before AND after so query caches never serve stale data. */
  function mut(reason, fn) {
    ensure();
    rev++;
    let out;
    try { out = fn(state); } catch (e) { console.error('[FORGE] store mutation failed (' + reason + ')', e); out = undefined; }
    if (out === NOOP) return NOOP;
    rev++;
    state.meta.updatedAt = Date.now();
    notify(reason);
    schedulePersist();
    return out;
  }
  const ret = (v, fallback) => (v === NOOP || v === undefined ? fallback : v);

  function init(loaded) {
    let next;
    try { next = normalize(loaded); } catch (e) { console.error('[FORGE] init failed', e); next = defaults(); }
    setState(next);
    // Let persistence snapshot the pristine partitions so only real edits get sync stamps.
    try { if (F.persist && typeof F.persist.baseline === 'function') F.persist.baseline(); } catch (e) { console.error('[FORGE] persist.baseline failed', e); }
    return state;
  }
  function replace(nextState, reason) {
    setState(normalize(nextState));
    notify(reason || 'replace');
    schedulePersist();
    return state;
  }
  function reset() {
    setState(defaults());
    notify('reset');
    schedulePersist();
    return state;
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subs.push(fn);
    return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }
  function update(mutator, reason) {
    if (typeof mutator !== 'function') return undefined;
    return ret(mut(reason || '', mutator), undefined);
  }

  /* ---------------------------------------------------------------- settings */

  function setSetting(key, value) {
    if (typeof key !== 'string' || !key) return;
    const path = key.split('.');
    if (path.some((p) => !p || p === '__proto__' || p === 'constructor' || p === 'prototype')) return;
    mut('settings', (s) => {
      const next = jsonSafe(s.settings) || {};
      let o = next;
      for (let i = 0; i < path.length - 1; i++) { if (!isObj(o[path[i]])) o[path[i]] = {}; o = o[path[i]]; }
      o[path[path.length - 1]] = value === undefined ? undefined : jsonSafe(value);
      const norm = normSettings(next);
      if (JSON.stringify(norm) === JSON.stringify(s.settings)) return NOOP;
      assignInPlace(s.settings, norm);
    });
  }

  /* ---------------------------------------------------------------- plan */

  function exerciseDefaults(exId) {
    try {
      const ex = F.q && typeof F.q.exercise === 'function' ? F.q.exercise(exId) : null;
      if (ex && isObj(ex.defaults)) return ex.defaults;
    } catch (_) { /* ignore */ }
    return {};
  }
  /** A known exercise (library or custom) or null — never the 'Deleted exercise' placeholder. */
  function knownExercise(exId) {
    if (typeof exId !== 'string' || !exId) return null;
    try {
      const ex = F.q && typeof F.q.exercise === 'function' ? F.q.exercise(exId) : null;
      return ex && !ex.missing ? ex : null;
    } catch (_) { return null; }
  }
  const typeOf = (exId) => { const ex = knownExercise(exId); return ex && EX_TYPES.indexOf(ex.type) >= 0 ? ex.type : 'weight'; };
  const planDay = (k) => (dayKeyOk(k) && state && state.plan && state.plan.days ? state.plan.days[k] : null);

  function setDay(dayKey, patch) {
    ensure();
    const d = planDay(dayKey);
    if (!d || !isObj(patch)) return;
    const merged = Object.assign({}, d);
    for (const k of ['title', 'rest', 'focus', 'items']) if (k in patch) merged[k] = patch[k];
    const norm = normDay(jsonSafe(merged));
    mut('plan', () => { assignInPlace(d, norm); });
  }
  function addPlanItem(dayKey, exId, opts) {
    ensure();
    const d = planDay(dayKey);
    if (!d || typeof exId !== 'string' || !exId) return null;
    const o = isObj(opts) ? opts : {};
    const def = exerciseDefaults(exId);
    const item = normPlanItem({
      id: U().uid('pi-'), exId,
      sets: o.sets !== undefined ? o.sets : (def.sets !== undefined ? def.sets : 3),
      target: o.target !== undefined ? o.target : (def.target || '8-12'),
      rest: o.rest !== undefined ? o.rest : (def.rest !== undefined ? def.rest : null),
      note: o.note || ''
    });
    if (!item) return null;
    mut('plan', () => { d.items.push(item); });
    return item;
  }
  function updatePlanItem(dayKey, itemId, patch) {
    ensure();
    const d = planDay(dayKey);
    const i = d ? findIdx(d.items, itemId) : -1;
    if (i < 0 || !isObj(patch)) return;
    const merged = Object.assign({}, d.items[i]);
    for (const k of ['exId', 'sets', 'target', 'rest', 'note']) if (k in patch) merged[k] = patch[k];
    merged.id = d.items[i].id;
    const norm = normPlanItem(merged);
    if (!norm) return;
    mut('plan', () => { assignInPlace(d.items[i], norm); });
  }
  function removePlanItem(dayKey, itemId) {
    ensure();
    const d = planDay(dayKey);
    const index = d ? findIdx(d.items, itemId) : -1;
    if (index < 0) return null;
    const item = d.items[index];
    mut('plan', () => { d.items.splice(index, 1); });
    return { item, index };
  }
  function insertPlanItem(dayKey, item, index) {
    ensure();
    const d = planDay(dayKey);
    const norm = d ? normPlanItem(item) : null;
    if (!norm || findIdx(d.items, norm.id) >= 0) return;
    const at = clampN(int(index, d.items.length), 0, d.items.length);
    mut('plan', () => { d.items.splice(at, 0, norm); });
  }
  function movePlanItem(dayKey, itemId, toIndex) {
    ensure();
    const d = planDay(dayKey);
    const from = d ? findIdx(d.items, itemId) : -1;
    if (from < 0) return;
    const to = clampN(int(toIndex, from), 0, d.items.length - 1);
    if (to === from) return;
    mut('plan', () => { const [it] = d.items.splice(from, 1); d.items.splice(to, 0, it); });
  }
  function copyDay(fromKey, toKey) {
    ensure();
    const src = planDay(fromKey); const dst = planDay(toKey);
    if (!src || !dst || fromKey === toKey) return;
    const copy = normDay({
      title: src.title, rest: src.rest, focus: src.focus.slice(),
      items: src.items.map((it) => Object.assign({}, it, { id: U().uid('pi-') }))
    });
    mut('plan', () => { assignInPlace(dst, copy); });
  }
  /**
   * Swap a plan item's exercise (e.g. DB bench press → decline push-up). Same exercise type: the
   * item keeps its sets / target / rest / note. Different type (weight ↔ bodyweight ↔ time): the new
   * exercise's defaults replace sets / target / rest and the old coaching note is cleared (it was
   * written for the other movement). Returns { item (live), prev (copy, for undo via
   * updatePlanItem(dayKey, prev.id, prev)) } or null (missing day/item, unknown or same exercise).
   */
  function swapPlanItem(dayKey, itemId, newExId) {
    ensure();
    const d = planDay(dayKey);
    const i = d ? findIdx(d.items, itemId) : -1;
    const ex = knownExercise(newExId);
    if (i < 0 || !ex || d.items[i].exId === ex.id) return null;
    const cur = d.items[i];
    const prev = Object.assign({}, cur);
    const next = Object.assign({}, cur, { exId: ex.id });
    if (typeOf(cur.exId) !== typeOf(ex.id)) {
      const def = isObj(ex.defaults) ? ex.defaults : {};
      next.sets = def.sets !== undefined ? def.sets : 3;
      next.target = def.target || (ex.type === 'time' ? '30s' : '8-12');
      next.rest = def.rest !== undefined ? def.rest : null;
      next.note = '';
    }
    const norm = normPlanItem(next);
    if (!norm) return null;
    mut('plan', () => { assignInPlace(cur, norm); });
    return { item: cur, prev };
  }
  function resetPlan() {
    ensure();
    const plan = normPlan(sourcePlan());
    mut('plan', (s) => { assignInPlace(s.plan, plan); });
  }

  /* ---------------------------------------------------------------- custom exercises */

  function addCustomExercise(ex) {
    ensure();
    if (!isObj(ex)) return null;
    const taken = libraryIds();
    for (const e of state.customExercises) taken.add(e.id);
    const slug = str(ex.name, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    const n = normCustomExercise(Object.assign({}, ex, { id: 'custom-' + (slug ? slug + '-' : '') + U().uid() }), taken);
    if (!n) return null;
    mut('library', (s) => { s.customExercises.push(n); });
    return n;
  }
  function updateCustomExercise(id, patch) {
    ensure();
    const i = findIdx(state.customExercises, id);
    if (i < 0 || !isObj(patch)) return;
    const n = normCustomExercise(Object.assign({}, state.customExercises[i], patch, { id }), null);
    if (!n) return;
    mut('library', (s) => { assignInPlace(s.customExercises[i], n); });
  }
  /** Returns { exercise, index } (pass both to restoreCustomExercise for undo) or null. */
  function removeCustomExercise(id) {
    ensure();
    const i = findIdx(state.customExercises, id);
    if (i < 0) return null;
    const exercise = state.customExercises[i];
    mut('library', (s) => { s.customExercises.splice(i, 1); });
    return { exercise, index: i };
  }
  /**
   * Undo helper: re-insert a removed custom exercise with its original id (at `index` when given,
   * else at the end). No-op (null) when that id is already in the library. Returns the exercise.
   */
  function restoreCustomExercise(ex, index) {
    ensure();
    if (!isObj(ex) || findIdx(state.customExercises, str(ex.id, '').trim()) >= 0) return null;
    const taken = libraryIds();
    for (const e of state.customExercises) taken.add(e.id);
    const n = normCustomExercise(ex, taken);
    if (!n) return null;
    const list = state.customExercises;
    const at = clampN(int(index, list.length), 0, list.length);
    mut('library', () => { list.splice(at, 0, n); });
    return n;
  }

  /* ---------------------------------------------------------------- workout */

  /** Set rows for a new SessionExercise: copy the last performance (same index, else its last set), else the target. */
  function prefillSets(exId, count, target) {
    const u = U();
    const n = clampN(int(count, 3), 1, 20);
    let last = null;
    try { last = F.q && typeof F.q.lastPerformance === 'function' ? F.q.lastPerformance(exId) : null; } catch (_) { last = null; }
    const prev = last && Array.isArray(last.sets) && last.sets.length ? last.sets : null;
    const pt = u.parseTarget(target);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const src = prev ? (prev[i] || prev[prev.length - 1]) : null;
      rows.push({
        id: u.uid('st-'),
        w: src ? num(src.w, null) : null,
        r: src ? int(src.r, null) : pt.reps,
        t: src ? num(src.t, null) : pt.secs,
        done: false,
        at: null
      });
    }
    return rows;
  }
  function makeEntry(exId, sets, target, rest, note) {
    return normEntry({ id: U().uid('se-'), exId, target: target || '', rest, note: note || '', sets: prefillSets(exId, sets, target) });
  }
  const active = () => (state && state.active) || null;
  function activeEntry(exEntryId) {
    const a = active();
    const i = a ? findIdx(a.exercises, exEntryId) : -1;
    return i < 0 ? null : { a, i, entry: a.exercises[i] };
  }
  function activeSet(exEntryId, setId) {
    const ae = activeEntry(exEntryId);
    const j = ae ? findIdx(ae.entry.sets, setId) : -1;
    return j < 0 ? null : Object.assign(ae, { j, set: ae.entry.sets[j] });
  }

  /** A program template by id, or null. */
  function templateById(id) {
    if (typeof id !== 'string' || !id) return null;
    try {
      const list = F.data && F.data.program && F.data.program.templates;
      const t = Array.isArray(list) ? list.find((x) => x && x.id === id) : null;
      return isObj(t) ? t : null;
    } catch (_) { return null; }
  }
  /** PlanItem-like input ({exId, sets?, target?, rest?, note?}, a SessionExercise, or a bare exId)
   *  → normalised item; missing fields come from the exercise's defaults. */
  function itemFrom(raw) {
    const r = typeof raw === 'string' ? { exId: raw } : raw;
    if (!isObj(r) || typeof r.exId !== 'string' || !r.exId.trim()) return null;
    const def = exerciseDefaults(r.exId.trim());
    return normPlanItem({
      exId: r.exId,
      // a SessionExercise (sets = rows) works too, so "repeat this session" can pass session.exercises
      sets: Array.isArray(r.sets) ? Math.max(1, r.sets.length) : (r.sets !== undefined && r.sets !== null ? r.sets : (def.sets !== undefined ? def.sets : 3)),
      target: str(r.target, '').trim() || def.target || '8-12',
      rest: r.rest !== undefined ? r.rest : (def.rest !== undefined ? def.rest : null),
      note: r.note
    });
  }

  /**
   * Start a workout (returns the existing active one unchanged if there is one).
   * Source priority: blank → no exercises; else `items` (PlanItem-like array) > `templateId`
   * (F.data.program.templates; unknown id falls back to the plan) > the `dayKey` plan day (default
   * today). Title: opts.title, else template title / plan day title.
   */
  function startWorkout(opts) {
    ensure();
    if (state.active) return state.active;
    const u = U();
    const o = isObj(opts) ? opts : {};
    const today = u.todayISO();
    const blank = o.blank === true;
    const key = dayKeyOk(o.dayKey) ? o.dayKey : (blank ? null : u.dayKeyOf(today));
    const tpl = !blank && !Array.isArray(o.items) ? templateById(o.templateId) : null;
    let items = [];
    let fallbackTitle = 'Workout';
    if (blank) fallbackTitle = 'Quick workout';
    else if (Array.isArray(o.items)) items = o.items;
    else if (tpl) {
      items = Array.isArray(tpl.items) ? tpl.items : [];
      fallbackTitle = str(tpl.title, '').trim() || 'Workout';
    } else {
      const day = key ? state.plan.days[key] : null;
      items = day ? day.items : [];
      fallbackTitle = (day && day.title) || (key ? u.DAY_LONG[key] : 'Workout');
    }
    const exercises = [];
    for (const raw of items) {
      const it = itemFrom(raw);
      const e = it ? makeEntry(it.exId, it.sets, it.target, it.rest, it.note) : null;
      if (e) exercises.push(e);
    }
    const title = str(o.title, '').trim() || fallbackTitle;
    const session = normSession({
      id: u.uid('s-'), date: today, dayKey: key, title, startedAt: Date.now(), endedAt: null,
      exercises, note: '', feeling: null, rest: null
    }, true);
    mut('workout', (s) => { s.active = session; });
    return state.active;
  }
  function addExerciseToActive(exId) {
    ensure();
    const a = active();
    if (!a || typeof exId !== 'string' || !exId) return null;
    const def = exerciseDefaults(exId);
    const entry = makeEntry(exId, def.sets !== undefined ? def.sets : 3, def.target || '8-12', def.rest !== undefined ? def.rest : null, '');
    if (!entry) return null;
    mut('workout', () => { a.exercises.push(entry); });
    return entry;
  }
  function removeExerciseFromActive(exEntryId) {
    const ae = activeEntry(exEntryId);
    if (!ae) return null;
    const { a, i, entry } = ae;
    mut('workout', () => {
      a.exercises.splice(i, 1);
      if (a.rest && a.rest.exEntryId === exEntryId) a.rest = null;
    });
    return { entry, index: i };
  }
  function insertExerciseToActive(entry, index) {
    const a = active();
    const n = a ? normEntry(entry) : null;
    if (!n || findIdx(a.exercises, n.id) >= 0) return;
    const at = clampN(int(index, a.exercises.length), 0, a.exercises.length);
    mut('workout', () => { a.exercises.splice(at, 0, n); });
  }
  function moveActiveExercise(exEntryId, toIndex) {
    const ae = activeEntry(exEntryId);
    if (!ae) return;
    const { a, i } = ae;
    const to = clampN(int(toIndex, i), 0, a.exercises.length - 1);
    if (to === i) return;
    mut('workout', () => { const [e] = a.exercises.splice(i, 1); a.exercises.splice(to, 0, e); });
  }
  /**
   * Swap the exercise of an active entry, keeping its place and number of set rows (row ids too).
   * Same type: target / rest / note and DONE sets are kept; undone rows are re-prefilled for the new
   * exercise (its last performance, else the target) exactly like startWorkout. Different type: the
   * new exercise's default target / rest apply, the note is cleared and every row is reset to undone
   * and re-prefilled. A rest timer started from this entry is cleared.
   * Returns the live entry, or null (missing entry, unknown or same exercise). For undo, snapshot the
   * entry first (F.util.clone) and restore with removeExerciseFromActive + insertExerciseToActive.
   */
  function swapActiveExercise(exEntryId, newExId) {
    const ae = activeEntry(exEntryId);
    const ex = knownExercise(newExId);
    if (!ae || !ex || ae.entry.exId === ex.id) return null;
    const { a, entry } = ae;
    const same = typeOf(entry.exId) === typeOf(ex.id);
    let target = entry.target;
    let rest = entry.rest;
    let note = entry.note;
    if (!same) {
      const def = isObj(ex.defaults) ? ex.defaults : {};
      target = def.target || (ex.type === 'time' ? '30s' : '8-12');
      rest = def.rest !== undefined ? def.rest : null;
      note = '';
    }
    const count = entry.sets.length;
    const fill = count ? prefillSets(ex.id, count, target) : [];
    const sets = entry.sets.map((s, i) => (same && s.done
      ? s
      : Object.assign({}, fill[i] || fill[fill.length - 1], { id: s.id, done: false, at: null })));
    const next = normEntry({ id: entry.id, exId: ex.id, target, rest, note, sets });
    if (!next) return null;
    mut('workout', () => {
      assignInPlace(entry, next);
      if (a.rest && a.rest.exEntryId === exEntryId) a.rest = null;
    });
    return entry;
  }
  function addSet(exEntryId) {
    const ae = activeEntry(exEntryId);
    if (!ae) return null;
    const { entry } = ae;
    const prev = entry.sets[entry.sets.length - 1];
    const pt = U().parseTarget(entry.target);
    const set = {
      id: U().uid('st-'),
      w: prev ? prev.w : null,
      r: prev ? prev.r : pt.reps,
      t: prev ? prev.t : pt.secs,
      done: false,
      at: null
    };
    if (entry.sets.length >= 50) return null;
    mut('set', () => { entry.sets.push(set); });
    return set;
  }
  function removeSet(exEntryId, setId) {
    const as = activeSet(exEntryId, setId);
    if (!as) return;
    mut('set', () => {
      as.entry.sets.splice(as.j, 1);
      if (as.a.rest && as.a.rest.setId === setId) as.a.rest = null;
    });
  }
  function updateSet(exEntryId, setId, patch) {
    const as = activeSet(exEntryId, setId);
    if (!as || !isObj(patch)) return;
    const merged = Object.assign({}, as.set);
    for (const k of ['w', 'r', 't']) if (k in patch) merged[k] = patch[k] === '' ? null : patch[k];
    const n = normSet(merged);
    if (!n || (n.w === as.set.w && n.r === as.set.r && n.t === as.set.t)) return;
    mut('set', () => { as.set.w = n.w; as.set.r = n.r; as.set.t = n.t; });
  }
  function toggleSet(exEntryId, setId) {
    const as = activeSet(exEntryId, setId);
    if (!as) return { done: false, pr: null };
    const { a, entry, set } = as;
    const done = !set.done;
    const now = Date.now();
    let pr = null;
    if (done) {
      try { pr = F.q && typeof F.q.checkPR === 'function' ? F.q.checkPR(entry.exId, set, { exclude: set.id }) : null; } catch (e) { console.error('[FORGE] checkPR failed', e); pr = null; }
    }
    mut('set rest', (s) => {
      set.done = done;
      set.at = done ? now : null;
      if (done) {
        const rest = entry.rest !== null && entry.rest !== undefined ? entry.rest : s.settings.restSeconds;
        a.rest = rest > 0 ? { endsAt: now + rest * 1000, duration: rest, exEntryId, setId } : null;
      } else if (a.rest && a.rest.setId === setId) {
        a.rest = null; // un-ticking a mis-tap cancels the rest it started
      }
    });
    return { done, pr: pr || null };
  }
  function setRest(restObj) {
    const a = active();
    if (!a) return;
    const n = restObj === null || restObj === undefined ? null : normRest(restObj);
    if (restObj && !n) return;
    mut('rest', () => { a.rest = n; });
  }
  function setActiveField(key, value) {
    const a = active();
    if (!a) return;
    let v;
    if (key === 'title') { v = str(value, '').trim().slice(0, 80); if (!v) return; }
    else if (key === 'note') v = str(value, '').slice(0, 5000);
    else if (key === 'feeling') v = rating(value);
    else return;
    if (a[key] === v) return;
    mut('workout', () => { a[key] = v; });
  }
  function setExerciseNote(exEntryId, text) {
    const ae = activeEntry(exEntryId);
    if (!ae) return;
    const v = str(text, '').slice(0, 2000);
    if (ae.entry.note === v) return;
    mut('workout', () => { ae.entry.note = v; });
  }
  function insertSessionSorted(list, session) {
    let i = list.length;
    while (i > 0 && list[i - 1].startedAt > session.startedAt) i--;
    list.splice(i, 0, session);
    return i;
  }
  function finishWorkout(opts) {
    const a = active();
    if (!a) return null;
    const o = isObj(opts) ? opts : {};
    const draft = jsonSafe(a);
    draft.exercises = (draft.exercises || [])
      .map((e) => Object.assign(e, { sets: (e.sets || []).filter((s) => s && s.done) }))
      .filter((e) => e.sets.length);
    if (!draft.exercises.length) return null;
    draft.endedAt = Math.max(Date.now(), draft.startedAt);
    draft.rest = null;
    if (o.note !== undefined) draft.note = o.note;
    if (o.feeling !== undefined) draft.feeling = o.feeling;
    const session = normSession(draft, false);
    if (!session) return null;
    session.endedAt = draft.endedAt;
    let stats = null; let prs = [];
    try { stats = F.q ? F.q.sessionStats(session) : null; } catch (e) { console.error('[FORGE] sessionStats failed', e); }
    try { prs = F.q ? F.q.sessionPRs(session) : []; } catch (e) { console.error('[FORGE] sessionPRs failed', e); }
    mut('finish', (s) => { insertSessionSorted(s.sessions, session); s.active = null; });
    return { session, stats, prs };
  }
  function discardWorkout() {
    if (!active()) return;
    mut('workout', (s) => { s.active = null; });
  }
  function updateSession(id, patch) {
    ensure();
    const i = findIdx(state.sessions, id);
    if (i < 0 || !isObj(patch)) return;
    const merged = Object.assign(jsonSafe(state.sessions[i]), jsonSafe(patch) || {}, { id });
    const n = normSession(merged, false);
    if (!n) return;
    mut('session', (s) => {
      const [old] = s.sessions.splice(i, 1);
      assignInPlace(old, n);
      insertSessionSorted(s.sessions, old);
    });
  }
  function deleteSession(id) {
    ensure();
    const index = findIdx(state.sessions, id);
    if (index < 0) return null;
    const session = state.sessions[index];
    mut('session', (s) => { s.sessions.splice(index, 1); });
    return { session, index };
  }
  function restoreSession(session) {
    ensure();
    const n = normSession(session, false);
    if (!n || findIdx(state.sessions, n.id) >= 0) return;
    mut('session', (s) => { insertSessionSorted(s.sessions, n); });
  }

  /* ---------------------------------------------------------------- water */

  function addWater(ml, iso) {
    ensure();
    const day = iso === undefined || iso === null ? U().todayISO() : iso;
    const n = int(ml, null);
    if (n === null || n <= 0 || !U().isISO(day)) return null;
    const entry = { id: U().uid('w-'), ml: clampN(n, 1, 5000), at: Date.now() };
    mut('water', (s) => { (s.water[day] || (s.water[day] = [])).push(entry); });
    return entry;
  }
  function removeWater(iso, entryId) {
    ensure();
    const list = state.water[iso];
    const i = findIdx(list, entryId);
    if (i < 0) return null;
    const entry = list[i];
    mut('water', (s) => {
      list.splice(i, 1);
      if (!list.length) delete s.water[iso];
    });
    return entry;
  }
  function restoreWater(iso, entry) {
    ensure();
    if (!U().isISO(iso)) return;
    const n = normWaterEntry(entry, iso);
    if (!n || findIdx(state.water[iso], n.id) >= 0) return;
    mut('water', (s) => {
      const list = s.water[iso] || (s.water[iso] = []);
      let i = list.length;
      while (i > 0 && list[i - 1].at > n.at) i--;
      list.splice(i, 0, n);
    });
  }

  /* ---------------------------------------------------------------- journal */

  function saveJournal(entry) {
    ensure();
    if (!isObj(entry)) return null;
    const now = Date.now();
    const i = entry.id ? findIdx(state.journal, entry.id) : -1;
    const base = i >= 0 ? state.journal[i] : {};
    const merged = Object.assign({}, base, jsonSafe(entry) || {});
    merged.id = str(entry.id, '') || U().uid('j-');
    merged.createdAt = base.createdAt || ts(entry.createdAt, now);
    if (!U().isISO(merged.date)) merged.date = U().todayISO();
    const n = normJournalEntry(merged);
    if (!n) return null;
    n.updatedAt = Math.max(now, n.createdAt);
    mut('journal', (s) => {
      if (i >= 0) assignInPlace(s.journal[i], n); else s.journal.push(n);
    });
    return i >= 0 ? state.journal[i] : n;
  }
  function deleteJournal(id) {
    ensure();
    const i = findIdx(state.journal, id);
    if (i < 0) return null;
    const entry = state.journal[i];
    mut('journal', (s) => { s.journal.splice(i, 1); });
    return entry;
  }
  function restoreJournal(entry) {
    ensure();
    const n = normJournalEntry(entry);
    if (!n || findIdx(state.journal, n.id) >= 0) return;
    mut('journal', (s) => { s.journal.push(n); });
  }

  /* ---------------------------------------------------------------- misc */

  function markCelebrated(key) {
    ensure();
    if (typeof key !== 'string' || !key || state.meta.celebrated[key] === true) return;
    mut('meta', (s) => { s.meta.celebrated[key] = true; });
  }

  F.store = {
    init, defaults, get: () => ensure(), update, replace, subscribe, reset,
    /** Monotonic revision (bumps on every change) — cache key for derived data. Not part of the view contract. */
    rev: () => rev,
    /** Validation used by init/replace; exposed for persist/import. Returns a fresh normalised state. */
    normalize,
    setSetting,
    setDay, addPlanItem, updatePlanItem, removePlanItem, insertPlanItem, movePlanItem, copyDay, swapPlanItem, resetPlan,
    addCustomExercise, updateCustomExercise, removeCustomExercise, restoreCustomExercise,
    startWorkout, addExerciseToActive, removeExerciseFromActive, insertExerciseToActive, moveActiveExercise, swapActiveExercise,
    addSet, removeSet, updateSet, toggleSet, setRest, setActiveField, setExerciseNote,
    finishWorkout, discardWorkout, updateSession, deleteSession, restoreSession,
    addWater, removeWater, restoreWater,
    saveJournal, deleteJournal, restoreJournal,
    markCelebrated
  };
})(window.Forge = window.Forge || {});
