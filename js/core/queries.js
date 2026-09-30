/* FORGE — js/core/queries.js
 * Derived data / selectors over F.store.get(). Pure reads — never mutate state.
 * Contract: docs/SPEC.md §7.
 * Performance: one lazily-built index per store revision (+ calendar day) — history is walked once,
 * then every selector is a map lookup or a single pass.
 * Conventions: dates are local ISO 'YYYY-MM-DD'; weights kg; every `pct` is an integer 0..100.
 */
(function (F) {
  'use strict';

  const U = () => F.util;
  const S = () => F.store.get();
  const EMPTY_DAY = () => ({ title: '', rest: false, focus: [], items: [] });

  /* ---------------------------------------------------------------- index (per revision) */

  let cache = { key: null, st: null, data: null };

  function ix() {
    const st = S();
    const u = U();
    const rev = F.store && typeof F.store.rev === 'function' ? F.store.rev() : NaN;
    const today = u.todayISO();
    const key = rev + '|' + today;
    if (cache.data && cache.st === st && cache.key === key && !Number.isNaN(rev)) return cache.data;
    cache = { key, st, data: build(st, today) };
    return cache.data;
  }

  function build(st, today) {
    const u = U();
    let sessions = Array.isArray(st.sessions) ? st.sessions : [];
    for (let i = 1; i < sessions.length; i++) {
      if (sessions[i].startedAt < sessions[i - 1].startedAt) { sessions = sessions.slice().sort((a, b) => a.startedAt - b.startedAt); break; }
    }
    const byDate = new Map();
    for (const s of sessions) { const l = byDate.get(s.date); if (l) l.push(s); else byDate.set(s.date, [s]); }
    const journalDates = new Set();
    for (const j of Array.isArray(st.journal) ? st.journal : []) if (j && j.date) journalDates.add(j.date);
    const custom = new Map();
    for (const e of Array.isArray(st.customExercises) ? st.customExercises : []) if (e && e.id) custom.set(e.id, e);
    const restByKey = {};
    for (const k of u.DAY_KEYS) {
      const d = st.plan && st.plan.days && st.plan.days[k];
      restByKey[k] = !d || !!d.rest || !(Array.isArray(d.items) && d.items.length);
    }
    // First-use date: install day, or the earliest logged session if older (imports).
    let firstUse = u.toISO(st.meta && st.meta.createdAt) || today;
    if (sessions.length && sessions[0].date < firstUse) firstUse = sessions[0].date;
    return { st, today, sessions, byDate, journalDates, custom, restByKey, firstUse, byEx: null, stats: new WeakMap(), memo: new Map() };
  }

  const doneSets = (e) => (e && Array.isArray(e.sets) ? e.sets.filter((s) => s && s.done) : []);

  /** exId → [{ session, sets: doneSets[] }] chronological (one record per session, entries merged). */
  function byEx(I) {
    if (I.byEx) return I.byEx;
    const map = new Map();
    for (const s of I.sessions) {
      const per = new Map();
      for (const e of Array.isArray(s.exercises) ? s.exercises : []) {
        const d = doneSets(e);
        if (!d.length) continue;
        const cur = per.get(e.exId);
        if (cur) cur.push(...d); else per.set(e.exId, d.slice());
      }
      for (const [exId, sets] of per) {
        const l = map.get(exId);
        if (l) l.push({ session: s, sets }); else map.set(exId, [{ session: s, sets }]);
      }
    }
    I.byEx = map;
    return map;
  }
  function memo(key, fn) {
    const I = ix();
    if (I.memo.has(key)) return I.memo.get(key);
    const v = fn(I);
    I.memo.set(key, v);
    return v;
  }

  /* ---------------------------------------------------------------- exercises & equipment */

  let lib = { src: null, map: new Map() };
  function libMap() {
    const src = F.data && F.data.exercises;
    if (lib.src !== src) {
      const map = new Map();
      if (Array.isArray(src)) for (const e of src) if (e && e.id) map.set(e.id, e);
      lib = { src, map };
    }
    return lib.map;
  }
  function placeholder(id) {
    return {
      id: String(id == null ? '' : id), name: 'Deleted exercise', muscle: 'fullbody', secondary: [], equipment: [],
      type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 },
      cues: [], custom: false, missing: true
    };
  }
  function exercise(id) {
    return libMap().get(id) || ix().custom.get(id) || placeholder(id);
  }
  function allExercises() {
    return Array.from(libMap().values()).concat(Array.from(ix().custom.values()));
  }
  function owns(key) {
    if (key === 'bodyweight') return true;
    const eq = S().settings && S().settings.equipment;
    return !!(eq && eq[key]);
  }
  function canDo(ex) {
    const e = typeof ex === 'string' ? exercise(ex) : ex;
    if (!e || typeof e !== 'object') return false;
    return (Array.isArray(e.equipment) ? e.equipment : []).every(owns);
  }

  const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };
  const ALT_MAX = 8;
  const hasAlt = (a, id) => Array.isArray(a.alts) && a.alts.indexOf(id) >= 0;
  /**
   * Swap candidates for exId (SPEC §6.4): exercises the user can do, other than exId, that share its
   * movement pattern or are linked through `alts` (either direction) — tier 0 — or share its primary
   * muscle — tier 1. Split into calisthenics (calisthenics flag or non-weight type) and weights; each
   * sorted tier → level (beginner→advanced) → name, max 8. Custom exercises have no pattern, so they
   * match by muscle only. Unknown exId → empty lists. Cached per store revision; arrays are copies.
   */
  function alternatives(exId) {
    const empty = { calisthenics: [], weights: [] };
    if (typeof exId !== 'string' || !exId) return empty;
    const lists = memo('alt:' + exId, () => {
      const base = exercise(exId);
      if (!base || base.missing) return empty;
      const pattern = typeof base.pattern === 'string' && base.pattern ? base.pattern : null;
      const ranked = [];
      for (const ex of allExercises()) {
        if (!ex || ex.id === exId || !canDo(ex)) continue;
        const tier = (pattern && ex.pattern === pattern) || hasAlt(base, ex.id) || hasAlt(ex, exId) ? 0
          : (base.muscle && ex.muscle === base.muscle ? 1 : -1);
        if (tier >= 0) ranked.push({ ex, tier, level: Object.prototype.hasOwnProperty.call(LEVEL_RANK, ex.level) ? LEVEL_RANK[ex.level] : 1 });
      }
      ranked.sort((a, b) => a.tier - b.tier || a.level - b.level ||
        String(a.ex.name || '').localeCompare(String(b.ex.name || '')) || (a.ex.id < b.ex.id ? -1 : 1));
      const out = { calisthenics: [], weights: [] };
      for (const r of ranked) {
        const list = r.ex.calisthenics || r.ex.type !== 'weight' ? out.calisthenics : out.weights;
        if (list.length < ALT_MAX) list.push(r.ex);
      }
      return out;
    });
    return { calisthenics: lists.calisthenics.slice(), weights: lists.weights.slice() };
  }

  /* ---------------------------------------------------------------- plan */

  function dayPlan(dayKey) {
    const days = S().plan && S().plan.days;
    return (days && days[dayKey]) || EMPTY_DAY();
  }
  function planFor(iso) {
    const dayKey = U().dayKeyOf(iso);
    return { dayKey, day: dayPlan(dayKey) };
  }
  /** Σ sets × (45 s work + rest), rounded to 5 min, min 5. 0 for rest days / empty days. */
  function estimateMinutes(planDay) {
    if (!planDay || planDay.rest || !Array.isArray(planDay.items) || !planDay.items.length) return 0;
    const def = Number(S().settings.restSeconds) || 0;
    let sec = 0;
    for (const it of planDay.items) {
      const sets = Math.max(0, Number(it && it.sets) || 0);
      const rest = it && it.rest !== null && it.rest !== undefined && Number.isFinite(Number(it.rest)) ? Number(it.rest) : def;
      sec += sets * (45 + rest);
    }
    return Math.max(5, Math.round(sec / 60 / 5) * 5);
  }

  /* ---------------------------------------------------------------- sessions */

  const sessionsOn = (iso) => (ix().byDate.get(iso) || []).slice();
  function sessionsBetween(fromIso, toIso) {
    return ix().sessions.filter((s) => s.date >= fromIso && s.date <= toIso);
  }
  const trainedOn = (iso) => ix().byDate.has(iso);
  function lastSession() {
    const l = ix().sessions;
    return l.length ? l[l.length - 1] : null;
  }
  function lastPerformance(exId, opts) {
    const before = opts && Number.isFinite(Number(opts.before)) ? Number(opts.before) : Infinity;
    const list = byEx(ix()).get(exId);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const rec = list[i];
      if (rec.session.startedAt < before) {
        return { date: rec.session.date, sessionId: rec.session.id, sets: rec.sets.map((s) => Object.assign({}, s)) };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- bests & PRs */

  function metrics(set) {
    const w = Number(set && set.w); const r = Number(set && set.r); const t = Number(set && set.t);
    const W = Number.isFinite(w) && w > 0 ? w : 0;
    const R = Number.isFinite(r) && r > 0 ? r : 0;
    const T = Number.isFinite(t) && t > 0 ? t : 0;
    return { w: W, r: R, t: T, e: U().e1rm(W, R) };
  }
  const emptyBest = () => ({ maxW: 0, maxE1rm: 0, maxR: 0, maxT: 0, count: 0, historyCount: 0 });
  function accumulate(b, set) {
    const m = metrics(set);
    if (m.w > b.maxW) b.maxW = m.w;
    if (m.e > b.maxE1rm) b.maxE1rm = m.e;
    if (m.r > b.maxR) b.maxR = m.r;
    if (m.t > b.maxT) b.maxT = m.t;
    b.count++;
    return b;
  }
  function bestOfSets(sets) {
    const b = emptyBest();
    for (const s of sets) accumulate(b, s);
    return { w: b.maxW, r: b.maxR, t: b.maxT, e: b.maxE1rm };
  }

  /**
   * Bests over done sets of completed sessions (startedAt < before). When `exclude` (a set id) or
   * `includeActive: true` is given, the active session's other done sets of exId are included too.
   * Extra fields: count (sets considered), historyCount (sets from completed sessions only).
   */
  function bestFor(exId, opts) {
    const o = opts || {};
    const before = Number.isFinite(Number(o.before)) && o.before !== null ? Number(o.before) : Infinity;
    const b = emptyBest();
    for (const rec of byEx(ix()).get(exId) || []) {
      if (!(rec.session.startedAt < before) || (o.excludeSession && rec.session.id === o.excludeSession)) continue;
      for (const s of rec.sets) accumulate(b, s);
    }
    b.historyCount = b.count;
    const withActive = o.includeActive === true || (o.exclude !== undefined && o.exclude !== null);
    const a = withActive ? S().active : null;
    if (a && Array.isArray(a.exercises)) {
      for (const e of a.exercises) {
        if (e.exId !== exId) continue;
        for (const s of e.sets) if (s && s.done && s.id !== o.exclude) accumulate(b, s);
      }
    }
    return b;
  }

  const r1 = (n) => U().round(n, 1);
  /** SPEC §7 PR rules; `cur` = metrics of a set (or a session's bests). Needs prior completed history. */
  function prFrom(exId, type, cur, prev) {
    if (!prev || !prev.historyCount) return null; // first time = baseline, not a PR
    const EPS = 1e-6;
    const mk = (kind, value, before) => ({ exId, kind, value, prev: before });
    if (type === 'time') {
      return cur.t > 0 && prev.maxT > 0 && cur.t > prev.maxT + EPS ? mk('time', cur.t, prev.maxT) : null;
    }
    if (type === 'bodyweight') {
      if (cur.r > 0 && prev.maxR > 0 && cur.r > prev.maxR) return mk('reps', cur.r, prev.maxR);
      if (cur.w > 0 && prev.maxW > 0 && cur.w > prev.maxW + EPS) return mk('weight', cur.w, prev.maxW);
      return null;
    }
    if (cur.e > 0 && prev.maxE1rm > 0 && cur.e > prev.maxE1rm + EPS) return mk('e1rm', r1(cur.e), r1(prev.maxE1rm));
    if (cur.w > 0 && prev.maxW > 0 && cur.w > prev.maxW + EPS) return mk('weight', cur.w, prev.maxW);
    return null;
  }
  function checkPR(exId, set, opts) {
    if (!set || typeof set !== 'object') return null;
    const o = opts || {};
    const prev = bestFor(exId, { before: o.before, exclude: o.exclude, includeActive: o.includeActive });
    return prFrom(exId, exercise(exId).type, metrics(set), prev);
  }
  function groupDone(session) {
    const per = new Map();
    for (const e of session && Array.isArray(session.exercises) ? session.exercises : []) {
      const d = doneSets(e);
      if (!d.length) continue;
      const cur = per.get(e.exId);
      if (cur) cur.push(...d); else per.set(e.exId, d.slice());
    }
    return per;
  }
  /** One PR per exercise: the session's best vs everything logged before it. */
  function sessionPRs(session) {
    const out = [];
    if (!session) return out;
    for (const [exId, sets] of groupDone(session)) {
      const prev = bestFor(exId, { before: session.startedAt, excludeSession: session.id });
      const pr = prFrom(exId, exercise(exId).type, bestOfSets(sets), prev);
      if (pr) out.push(pr);
    }
    return out;
  }
  /** Every PR ever, chronological (single pass with running bests). */
  function allPRs() {
    return memo('allPRs', (I) => {
      const running = new Map();
      const out = [];
      for (const s of I.sessions) {
        for (const [exId, sets] of groupDone(s)) {
          const prev = running.get(exId) || emptyBest();
          if (prev.count) {
            prev.historyCount = prev.count;
            const pr = prFrom(exId, exercise(exId).type, bestOfSets(sets), prev);
            if (pr) out.push(Object.assign(pr, { date: s.date, sessionId: s.id }));
          }
          for (const set of sets) accumulate(prev, set);
          running.set(exId, prev);
        }
      }
      return out;
    });
  }
  /** Newest session first; PRs within one session keep exercise order. */
  function recentPRs(limit) {
    const n = limit === undefined ? 10 : Math.max(0, Math.floor(Number(limit) || 0));
    const all = allPRs();
    const out = [];
    let end = all.length;
    while (end > 0 && out.length < n) {
      let start = end - 1;
      while (start > 0 && all[start - 1].sessionId === all[end - 1].sessionId) start--;
      for (let i = start; i < end && out.length < n; i++) out.push(Object.assign({}, all[i]));
      end = start;
    }
    return out;
  }
  /** Per exercise ever performed; `date` = when its headline best was set. Newest first. */
  function records() {
    const list = memo('records', (I) => {
      const out = [];
      for (const [exId, recs] of byEx(I)) {
        const b = { maxW: 0, maxE1rm: 0, maxR: 0, maxT: 0 };
        const when = { w: '', e: '', r: '', t: '' };
        for (const rec of recs) {
          for (const set of rec.sets) {
            const m = metrics(set);
            if (m.w > b.maxW) { b.maxW = m.w; when.w = rec.session.date; }
            if (m.e > b.maxE1rm) { b.maxE1rm = m.e; when.e = rec.session.date; }
            if (m.r > b.maxR) { b.maxR = m.r; when.r = rec.session.date; }
            if (m.t > b.maxT) { b.maxT = m.t; when.t = rec.session.date; }
          }
        }
        const type = exercise(exId).type;
        const date = (type === 'time' ? when.t : type === 'bodyweight' ? (when.r || when.w) : (when.e || when.w)) ||
          recs[recs.length - 1].session.date;
        out.push({ exId, maxW: b.maxW, maxE1rm: r1(b.maxE1rm), maxR: b.maxR, maxT: b.maxT, date });
      }
      return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    });
    return list.map((r) => Object.assign({}, r));
  }
  /** Chronological per-session summary for one exercise. */
  function exerciseHistory(exId) {
    const u = U();
    return (byEx(ix()).get(exId) || []).map((rec) => {
      let topW = 0; let bestE1rm = 0; let totalReps = 0; let volume = 0; let maxT = 0;
      for (const s of rec.sets) {
        const m = metrics(s);
        if (m.w > topW) topW = m.w;
        if (m.e > bestE1rm) bestE1rm = m.e;
        if (m.t > maxT) maxT = m.t;
        totalReps += m.r;
        volume += m.w * m.r;
      }
      return {
        date: rec.session.date, sessionId: rec.session.id, topW, bestE1rm: u.round(bestE1rm, 1),
        totalReps, volume: u.round(volume, 1), maxT, sets: rec.sets.map((s) => Object.assign({}, s))
      };
    });
  }

  /* ---------------------------------------------------------------- stats */

  function computeStats(session) {
    let volume = 0; let sets = 0; let reps = 0; let exercises = 0;
    const byMuscle = {};
    for (const e of session && Array.isArray(session.exercises) ? session.exercises : []) {
      const d = doneSets(e);
      if (!d.length) continue;
      exercises++;
      const m = exercise(e.exId).muscle || 'fullbody';
      byMuscle[m] = (byMuscle[m] || 0) + d.length;
      for (const s of d) {
        const x = metrics(s);
        sets++;
        reps += x.r;
        volume += x.w * x.r;
      }
    }
    const start = Number(session && session.startedAt) || 0;
    const end = Number(session && session.endedAt) || Date.now();
    const durationSec = start ? Math.max(0, Math.round((end - start) / 1000)) : 0;
    return { volume: U().round(volume, 1), sets, reps, durationSec, exercises, byMuscle };
  }
  /** { volume (kg), sets, reps, durationSec, exercises, byMuscle } over DONE sets. */
  function sessionStats(session) {
    if (!session || typeof session !== 'object') return computeStats(null);
    // Completed sessions are cached per revision (by object identity); the live workout is always
    // recomputed because its duration depends on the clock.
    if (!session.endedAt) return computeStats(session);
    const I = ix();
    let st = I.stats.get(session);
    if (!st) { st = computeStats(session); I.stats.set(session, st); }
    return Object.assign({}, st, { byMuscle: Object.assign({}, st.byMuscle) });
  }
  function totals() {
    const t = memo('totals', (I) => {
      const acc = { workouts: I.sessions.length, volume: 0, sets: 0, reps: 0, minutes: 0 };
      let sec = 0;
      for (const s of I.sessions) {
        const st = sessionStats(s);
        acc.volume += st.volume; acc.sets += st.sets; acc.reps += st.reps; sec += st.durationSec;
      }
      acc.volume = U().round(acc.volume, 1);
      acc.minutes = Math.round(sec / 60);
      return acc;
    });
    return Object.assign({}, t);
  }

  /* ---------------------------------------------------------------- water & journal */

  function waterTotal(iso) {
    const list = S().water && S().water[iso];
    if (!Array.isArray(list)) return 0;
    let t = 0;
    for (const e of list) { const ml = Number(e && e.ml); if (ml > 0) t += ml; }
    return t;
  }
  function waterDays(n, endIso) {
    const u = U();
    const count = Math.max(1, Math.min(366, Math.floor(Number(n) || 7)));
    const end = u.isISO(endIso) ? endIso : u.todayISO();
    const goal = S().settings.waterGoal;
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const iso = u.addDays(end, -i);
      const ml = waterTotal(iso);
      out.push({ iso, ml, goal, hit: ml >= goal });
    }
    return out;
  }
  function journalFor(iso) {
    const j = S().journal;
    return (Array.isArray(j) ? j : []).filter((e) => e && e.date === iso).sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------------------------------------------------------------- calendar status */

  /** isRest is the EFFECTIVE rest flag: plan day marked rest OR it has no exercises. */
  function dayStatus(iso) {
    const u = U();
    const I = ix();
    const d = u.isISO(iso) ? iso : I.today;
    const dayKey = u.dayKeyOf(d);
    const day = dayPlan(dayKey);
    const isRest = I.restByKey[dayKey];
    const trained = I.byDate.has(d);
    const water = waterTotal(d);
    const isToday = d === I.today;
    const isFuture = d > I.today;
    return {
      iso: d, dayKey, day, isRest, trained, water, waterHit: water >= S().settings.waterGoal,
      journaled: I.journalDates.has(d), isToday, isFuture,
      missed: !isFuture && !isToday && !isRest && !trained && d >= I.firstUse
    };
  }
  function missionFor(iso) {
    const u = U();
    const d = dayStatus(iso === undefined ? u.todayISO() : iso);
    const goal = S().settings.waterGoal;
    const items = [
      { key: 'train', label: d.isRest ? 'Rest & recover' : 'Train: ' + (d.day.title || u.DAY_LONG[d.dayKey]), done: d.isRest || d.trained },
      { key: 'water', label: 'Drink ' + u.fmtMl(goal), done: d.waterHit },
      { key: 'journal', label: 'Write in your journal', done: d.journaled }
    ];
    const done = items.filter((x) => x.done).length;
    return { items, done, total: items.length, pct: Math.round((done / items.length) * 100) };
  }
  /** days = dayStatus ×7 (Mon..Sun); planned = non-rest days; done = days trained (any);
   *  plannedDone = planned days trained; waterAvg over days up to today. */
  function weekSummary(iso) {
    const u = U();
    const dates = u.weekDates(u.isISO(iso) ? iso : u.todayISO());
    const days = dates.map(dayStatus);
    let volume = 0;
    for (const s of sessionsBetween(dates[0], dates[6])) volume += sessionStats(s).volume;
    const past = days.filter((d) => !d.isFuture);
    return {
      dates, days,
      planned: days.filter((d) => !d.isRest).length,
      done: days.filter((d) => d.trained).length,
      plannedDone: days.filter((d) => !d.isRest && d.trained).length,
      volume: u.round(volume, 1),
      waterAvg: past.length ? Math.round(past.reduce((a, d) => a + d.water, 0) / past.length) : 0
    };
  }
  const MAX_WALK = 4000; // ~11 years — hard stop for backward walks

  /** Walk back from today: trained → +1 (rest-day extras count); rest → skip; today pending → skip; missed → stop. */
  function workoutStreak() {
    return memo('workoutStreak', (I) => {
      const u = U();
      let n = 0; let d = I.today; let guard = 0;
      while (d >= I.firstUse && guard++ < MAX_WALK) {
        if (I.byDate.has(d)) n++;
        else if (!(I.restByKey[u.dayKeyOf(d)] || d === I.today)) break;
        d = u.addDays(d, -1);
      }
      return n;
    });
  }
  /** Consecutive days the water goal was hit; today only counts once hit (never breaks the streak). */
  function waterStreak() {
    return memo('waterStreak', (I) => {
      const u = U();
      const goal = I.st.settings.waterGoal;
      let n = waterTotal(I.today) >= goal ? 1 : 0;
      let d = u.addDays(I.today, -1); let guard = 0;
      while (guard++ < MAX_WALK && waterTotal(d) >= goal) { n++; d = u.addDays(d, -1); }
      return n;
    });
  }
  /** Planned (non-rest) days trained over the window, counting only days since first use.
   *  Today counts only once trained. */
  function consistency(days) {
    const span = Math.max(1, Math.min(3650, Math.floor(Number(days) || 28)));
    return Object.assign({}, memo('consistency:' + span, (I) => {
      const u = U();
      let d = u.addDays(I.today, -(span - 1));
      if (d < I.firstUse) d = I.firstUse;
      let planned = 0; let done = 0; let guard = 0;
      while (d <= I.today && guard++ < MAX_WALK) {
        const trained = I.byDate.has(d);
        if (!I.restByKey[u.dayKeyOf(d)] && (d !== I.today || trained)) { planned++; if (trained) done++; }
        d = u.addDays(d, 1);
      }
      return { planned, done, pct: planned ? Math.round((done / planned) * 100) : 0 };
    }));
  }
  /** Done sets per primary muscle over the last `days` days, sorted desc. */
  function muscleSplit(days) {
    const u = U();
    const span = Math.max(1, Math.floor(Number(days) || 30));
    const today = u.todayISO();
    const counts = {};
    for (const s of sessionsBetween(u.addDays(today, -(span - 1)), today)) {
      for (const e of s.exercises) {
        const n = doneSets(e).length;
        if (!n) continue;
        const m = exercise(e.exId).muscle || 'fullbody';
        counts[m] = (counts[m] || 0) + n;
      }
    }
    return Object.keys(counts).map((muscle) => ({ muscle, sets: counts[muscle] }))
      .sort((a, b) => b.sets - a.sets || (a.muscle < b.muscle ? -1 : 1));
  }
  function weeklyVolume(weeks) {
    const u = U();
    const n = Math.max(1, Math.min(520, Math.floor(Number(weeks) || 8)));
    const ws = u.weekStart(u.todayISO());
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = u.addDays(ws, -7 * i);
      const list = sessionsBetween(start, u.addDays(start, 6));
      let volume = 0;
      for (const s of list) volume += sessionStats(s).volume;
      out.push({ weekStart: start, volume: u.round(volume, 1), sessions: list.length });
    }
    return out;
  }
  /** Mon-aligned cells (column-major: week by week, Mon..Sun) ending with the current week.
   *  Extra fields: sets, isToday, missed. */
  function heatmap(weeks) {
    const u = U();
    const I = ix();
    const n = Math.max(1, Math.min(260, Math.floor(Number(weeks) || 16)));
    const start = u.addDays(u.weekStart(I.today), -7 * (n - 1));
    const cells = [];
    let maxSets = 0;
    for (let i = 0; i < n * 7; i++) {
      const iso = u.addDays(start, i);
      const list = I.byDate.get(iso);
      let sets = 0;
      if (list) for (const s of list) for (const e of s.exercises) sets += doneSets(e).length;
      if (sets > maxSets) maxSets = sets;
      const isRest = I.restByKey[u.dayKeyOf(iso)];
      const future = iso > I.today;
      const isToday = iso === I.today;
      const trained = !!list;
      cells.push({ iso, level: 0, trained, isRest, future, sets, isToday, missed: !future && !isToday && !isRest && !trained && iso >= I.firstUse });
    }
    const scale = Math.max(maxSets, 12);
    for (const c of cells) c.level = c.trained ? Math.min(4, Math.max(1, Math.ceil((4 * c.sets) / scale))) : 0;
    return cells;
  }

  F.q = {
    alternatives, exercise, allExercises, owns, canDo,
    dayPlan, planFor, estimateMinutes,
    sessionsOn, sessionsBetween, trainedOn, lastSession, lastPerformance, exerciseHistory,
    bestFor, checkPR, sessionStats, sessionPRs, recentPRs, records, totals,
    waterTotal, waterDays, journalFor,
    dayStatus, missionFor, weekSummary, workoutStreak, waterStreak, consistency,
    muscleSplit, weeklyVolume, heatmap,
    /** Extra (not in §7): first-use ISO date (install day or earliest session). */
    firstUse: () => ix().firstUse
  };
})(window.Forge = window.Forge || {});
