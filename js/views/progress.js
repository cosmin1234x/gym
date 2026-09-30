/* FORGE — js/views/progress.js  [VIEW:progress]
 * Progress, history and records (SPEC §12 "progress").
 *
 *   Overview   lifetime totals (count-ups), consistency ring, workout & water streaks, 16-week training
 *              calendar (tap a lit day → that session), weekly volume / sets bars, 30-day muscle split.
 *   History    every session newest first, grouped by month (sticky headers) → detail sheet with the
 *              sets tables, PR markers, feeling & note, "Repeat this workout" and Delete (+ Undo).
 *   Exercises  everything you have logged with a sparkline and best set → detail sheet with a trend
 *              chart (e1RM / top weight / volume, max reps, longest hold), best sets, recent history and
 *              calisthenics variations.
 *   Records    trophy hero, the latest PR as a stamp, a PR timeline and the PR board grouped by muscle.
 *
 * Params: { tab, exId, sessionId }. Switching tabs is done in place (no re-render of the view); the new
 * tab and any open detail sheet are written back into this history entry, so a reload lands on the
 * same tab / sheet. Store changes (delete / undo / units / cloud) rebuild only the visible panel,
 * quietly (no entrance animations), and keep the search text, paging and chart choices.
 */
(function (F) {
  'use strict';

  const TABS = [
    { value: 'overview', label: 'Overview' },
    { value: 'history', label: 'History' },
    { value: 'exercises', label: 'Exercises' },
    { value: 'records', label: 'Records' }
  ];
  const TAB_KEYS = TABS.map((t) => t.value);
  const REASONS = ['session', 'finish', 'settings', 'library', 'plan'];
  const MOOD_PLATE = { 1: 'violet', 2: 'blue', 3: 'white', 4: 'green', 5: 'red' };
  const PR_KIND = { e1rm: 'Est. 1RM', weight: 'Heaviest', reps: 'Most reps', time: 'Longest hold' };
  const HISTORY_PAGE = 40;
  const HEAT_WEEKS = 16;
  const VOLUME_WEEKS = 8;
  const SPLIT_DAYS = 30;
  const TIMELINE_SHORT = 8;

  // "That's about N …" — a playful yardstick for the lifetime volume (kg each).
  const YARDSTICKS = [
    { kg: 150000, one: 'blue whale', many: 'blue whales' },
    { kg: 11000, one: 'school bus', many: 'school buses' },
    { kg: 6000, one: 'African elephant', many: 'African elephants' },
    { kg: 1500, one: 'family car', many: 'family cars' },
    { kg: 450, one: 'grand piano', many: 'grand pianos' },
    { kg: 270, one: 'grizzly bear', many: 'grizzly bears' }
  ];

  /* ------------------------------------------------------------------ small helpers */

  const h = (...a) => F.util.h(...a);
  const ic = (name, size, cls) => F.icon(name, { size: size || 20, cls: cls || '' });
  const prog = () => (F.data && F.data.program) || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : (d || ''));
  const fmtNum = (n, dp) => F.util.fmtNum(n, dp);
  const plural = (n, one, many) => fmtNum(n) + ' ' + (n === 1 ? one : (many || one + 's'));
  const today = () => F.util.todayISO();

  function units() {
    try { return F.store.get().settings.units === 'lb' ? 'lb' : 'kg'; } catch (_) { return 'kg'; }
  }
  /** kg → number in display units. */
  const disp = (kg) => F.util.toDisplayWeight(num(kg), units()) || 0;
  const fmtW = (kg) => F.util.fmtWeight(num(kg), units());
  /** Estimated 1RMs are estimates: one decimal is plenty. */
  const fmtE1 = (kg) => fmtNum(disp(kg), 1) + ' ' + units();
  function fmtHold(sec) {
    const s = Math.max(0, Math.round(num(sec)));
    return s < 60 ? s + 's' : F.util.fmtClock(s);
  }
  /** 950 → '950', 12450 → '12.5k', 2.1e6 → '2.1M'. */
  function compact(n) {
    const x = num(n);
    const a = Math.abs(x);
    if (a >= 1e6) return fmtNum(x / 1e6, 1) + 'M';
    if (a >= 1e3) return fmtNum(x / 1e3, a >= 1e5 ? 0 : 1) + 'k';
    return fmtNum(Math.round(x));
  }
  function fmtMinutes(min) {
    const m = Math.max(0, Math.round(num(min)));
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }

  const plateOf = (m) => (F.ui && F.ui.plateOf && F.ui.plateOf(m)) || 'white';
  function muscleLabel(m) {
    const M = prog().MUSCLES || {};
    if (M[m] && M[m].label) return M[m].label;
    const s = String(m || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other';
  }
  function typeLabel(t) {
    const T = prog().TYPES || {};
    return (T[t] && T[t].label) || (t === 'time' ? 'Timed hold' : t === 'bodyweight' ? 'Bodyweight' : 'Weighted');
  }
  function exOf(id) {
    try { return F.q.exercise(id); } catch (_) {
      return { id: String(id), name: 'Deleted exercise', muscle: 'fullbody', type: 'weight', equipment: [], missing: true };
    }
  }
  const exName = (ex) => str(ex && ex.name, 'Exercise');
  const exType = (ex) => (ex && (ex.type === 'time' || ex.type === 'bodyweight') ? ex.type : 'weight');

  function relDate(iso) {
    const u = F.util;
    if (!u.isISO(iso)) return '';
    const d = u.diffDays(iso, today());
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d > 1 && d < 7) return d + ' days ago';
    return u.fmtDate(iso, iso.slice(0, 4) === today().slice(0, 4) ? 'dm' : 'dmy');
  }

  /** For running text: 'today', 'yesterday', '3 days ago', 'on 12 Sep'. */
  function whenText(iso) {
    const d = F.util.isISO(iso) ? F.util.diffDays(iso, today()) : 99;
    const r = relDate(iso);
    return d >= 0 && d < 7 ? r.toLowerCase() : 'on ' + r;
  }

  /* ------------------------------------------------------------------ data helpers */

  function allSessions() {
    const l = F.store.get().sessions;
    return Array.isArray(l) ? l.filter((s) => s && typeof s === 'object') : [];
  }
  const newestFirst = () => allSessions().slice().sort((a, b) => num(b.startedAt) - num(a.startedAt));
  const findSession = (id) => allSessions().find((s) => s.id === id) || null;
  const doneSets = (e) => (e && Array.isArray(e.sets) ? e.sets.filter((x) => x && x.done) : []);

  function statsOf(s) {
    try { return F.q.sessionStats(s); } catch (_) { return { volume: 0, sets: 0, reps: 0, durationSec: 0, exercises: 0, byMuscle: {} }; }
  }
  function prsOf(s) {
    try { return F.q.sessionPRs(s) || []; } catch (_) { return []; }
  }
  function historyOf(exId) {
    try { return F.q.exerciseHistory(exId) || []; } catch (_) { return []; }
  }

  /** Plate of the plan day the session came from, else of its most-trained muscle. */
  function sessionPlate(s) {
    try {
      const day = s.dayKey ? F.q.dayPlan(s.dayKey) : null;
      if (day && Array.isArray(day.focus) && day.focus.length && str(day.title) && str(day.title) === str(s.title)) {
        const p = prog().plateFor ? prog().plateFor(day.focus) : null;
        if (p) return p;
      }
    } catch (_) { /* fall back to the content */ }
    const by = statsOf(s).byMuscle || {};
    let best = null;
    for (const m of Object.keys(by)) if (!best || by[m] > by[best]) best = m;
    return best ? plateOf(best) : 'red';
  }

  const setE1 = (x) => F.util.e1rm(num(x && x.w), num(x && x.r));

  /** Best sets of an exercise across its history (with dates). */
  function bestsOf(hist) {
    const b = {
      e1: { v: 0, set: null, date: '' }, w: { v: 0, set: null, date: '' },
      r: { v: 0, set: null, date: '' }, t: { v: 0, set: null, date: '' },
      totalReps: 0, totalT: 0, sets: 0, addedW: { v: 0, set: null, date: '' }
    };
    for (const rec of hist) {
      for (const x of rec.sets || []) {
        const e = setE1(x); const w = num(x.w); const r = num(x.r); const t = num(x.t);
        b.sets++;
        b.totalReps += Math.max(0, r);
        b.totalT += Math.max(0, t);
        if (e > b.e1.v) b.e1 = { v: e, set: x, date: rec.date };
        if (w > b.w.v) b.w = { v: w, set: x, date: rec.date };
        if (r > b.r.v) b.r = { v: r, set: x, date: rec.date };
        if (t > b.t.v) b.t = { v: t, set: x, date: rec.date };
      }
    }
    b.addedW = b.w;
    return b;
  }
  const maxReps = (rec) => (rec.sets || []).reduce((m, x) => Math.max(m, num(x.r)), 0);

  /** Human text for one set, by exercise type. */
  function setText(x, type) {
    const w = num(x && x.w); const r = num(x && x.r); const t = num(x && x.t);
    if (type === 'time') return fmtHold(t) + (w > 0 ? ' +' + fmtW(w) : '');
    if (type === 'bodyweight') return plural(r, 'rep') + (w > 0 ? ' +' + fmtW(w) : '');
    return (w > 0 ? fmtW(w) : 'BW') + ' × ' + r;
  }
  /** Short inline summary of a session's sets: '22×10 · 22×9 · 20×8'. */
  function setsInline(sets, type) {
    return (sets || []).map((x) => {
      const w = num(x.w); const r = num(x.r); const t = num(x.t);
      if (type === 'time') return fmtHold(t);
      if (type === 'bodyweight') return (w > 0 ? '+' + fmtNum(disp(w), 2) + '×' : '') + r;
      return (w > 0 ? fmtNum(disp(w), 2) : 'BW') + '×' + r;
    }).join(' · ');
  }

  function prValue(pr) {
    if (!pr) return '';
    if (pr.kind === 'reps') return plural(num(pr.value), 'rep');
    if (pr.kind === 'time') return fmtHold(pr.value);
    return pr.kind === 'e1rm' ? fmtE1(pr.value) : fmtW(pr.value);
  }
  function prDelta(pr) {
    const d = num(pr && pr.value) - num(pr && pr.prev);
    if (!(d > 0)) return '';
    if (pr.kind === 'reps') return '+' + plural(d, 'rep');
    if (pr.kind === 'time') return '+' + fmtHold(d);
    return '+' + (pr.kind === 'e1rm' ? fmtE1(d) : fmtW(d));
  }

  function yardstick(kg) {
    const v = num(kg);
    if (v <= 0) return '';
    for (const y of YARDSTICKS) {
      const n = v / y.kg;
      if (n >= 1.5) {
        const r = n >= 10 ? Math.round(n) : Math.round(n * 2) / 2;
        return 'That’s about ' + fmtNum(r, 1) + ' ' + (r === 1 ? y.one : y.many) + ' of iron moved.';
      }
    }
    const plate = units() === 'lb' ? { kg: 20.41, name: '45 lb plates' } : { kg: 20, name: '20 kg plates' };
    const n = Math.max(1, Math.round(v / plate.kg));
    return 'That’s ' + fmtNum(n) + ' ' + (n === 1 ? plate.name.replace('plates', 'plate') : plate.name) + ' — and counting.';
  }

  function moodFace(f, size) {
    const v = Math.round(num(f));
    if (v < 1 || v > 5) return null;
    return h('span.pg-mood', { dataset: { plate: MOOD_PLATE[v] }, attrs: { title: F.ui.moodLabel ? F.ui.moodLabel(v) : '' } },
      ic('mood-' + v, size || 20),
      h('span.sr-only', 'Feeling: ' + (F.ui.moodLabel ? F.ui.moodLabel(v) : v)));
  }

  /* ------------------------------------------------------------------ params & motion */

  /** Merge a patch into this view's params and into the current history entry (reload-safe). */
  function syncParams(view, patch) {
    const ctx = view.ctx;
    if (!ctx.isActive()) return;
    const p = ctx.params;
    if (!p || typeof p !== 'object') return;
    Object.keys(patch).forEach((k) => {
      if (patch[k] === null || patch[k] === undefined || patch[k] === '') delete p[k];
      else p[k] = patch[k];
    });
    try {
      const st = history.state;
      if (st && typeof st === 'object' && st.name === 'progress') {
        history.replaceState(Object.assign({}, st, { params: JSON.parse(JSON.stringify(p)) }), '');
      }
    } catch (_) { /* history refused (sandbox) — params still live in memory */ }
  }

  function count(view, el, to, format) {
    if (!el) return;
    const fmt = typeof format === 'function' ? format : (n) => fmtNum(Math.round(n));
    if (view.quiet) { el.textContent = fmt(to); return; }
    F.util.countUp(el, to, { duration: 900, format: fmt });
  }

  function startAction(view) {
    const st = F.store.get();
    if (st.active) return { label: 'Resume workout', icon: 'play', onClick: () => view.ctx.go('workout') };
    let hasPlan = false;
    let dayKey = null;
    try {
      const p = F.q.planFor(today());
      dayKey = p.dayKey;
      hasPlan = !p.day.rest && Array.isArray(p.day.items) && p.day.items.length > 0;
    } catch (_) { hasPlan = false; }
    if (hasPlan) {
      return {
        label: 'Start today’s workout',
        icon: 'play',
        onClick: () => { F.store.startWorkout({ dayKey }); view.ctx.go('workout'); }
      };
    }
    return { label: 'Start a workout', icon: 'play', onClick: () => view.ctx.go('workout') };
  }

  function cardHead(eyebrow, title, aside) {
    return h('div.pg-card-head',
      h('div.pg-card-head__titles', h('p.eyebrow', eyebrow), title ? h('h3.pg-card-title', title) : null),
      aside || null);
  }

  /* ================================================================== OVERVIEW */

  function buildOverview(view, panel) {
    const T = F.q.totals();
    if (!T.workouts) {
      panel.append(
        h('div.pg-empty-wrap', F.ui.empty({
          icon: 'chart',
          title: 'Your progress starts here',
          text: 'Finish your first workout to see your totals, streaks, weekly volume, muscle split and PRs here.',
          action: startAction(view)
        })),
        heatCard(view));
      return;
    }
    panel.append(totalsHero(view, T), streakRow(view), heatCard(view),
      h('div.pg-duo', volumeCard(view), splitCard(view)));
  }

  function totalsHero(view, T) {
    const u = units();
    const big = h('span.pg-hero__num', '0');
    const first = F.q.firstUse ? F.q.firstUse() : '';
    const mins = num(T.minutes);
    const timeIsHours = mins >= 60;
    const minis = [
      { label: 'Workouts', to: num(T.workouts), fmt: (n) => fmtNum(Math.round(n)) },
      { label: 'Time', to: timeIsHours ? mins / 60 : mins, fmt: (n) => (mins < 1 ? '<1' : fmtNum(n, timeIsHours ? 1 : 0)), unit: timeIsHours ? 'h' : 'min' },
      { label: 'Sets', to: num(T.sets), fmt: (n) => fmtNum(Math.round(n)) },
      { label: 'Reps', to: num(T.reps), fmt: (n) => compact(n) }
    ];
    const miniEls = minis.map((m) => {
      const v = h('span.pg-mini__num', '0');
      count(view, v, m.to, m.fmt);
      return h('div.pg-mini', h('span.pg-mini__v', v, m.unit ? h('span.pg-mini__unit', m.unit) : null), h('span.pg-mini__l', m.label));
    });
    const fun = yardstick(T.volume);
    const card = h('section.card.card--hero.pg-hero', { dataset: { plate: 'red' }, attrs: { 'aria-label': 'Lifetime totals' } },
      h('div.pg-hero__top',
        h('p.eyebrow', 'Total volume lifted'),
        F.util.isISO(first) ? h('span.pg-hero__since', 'Since ' + F.util.fmtDate(first, 'dmy')) : null),
      h('div.pg-hero__big', big, h('span.pg-hero__unit', u)),
      fun ? h('p.pg-hero__fun', fun) : null,
      h('div.pg-hero__stats', miniEls));
    count(view, big, disp(T.volume), (n) => fmtNum(Math.round(n)));
    return card;
  }

  function streakRow(view) {
    const c = F.q.consistency(28);
    const ring = F.ui.ring({
      size: 96, stroke: 9, value: c.planned ? c.pct / 100 : 0, color: 'var(--plate-green)',
      label: c.planned ? c.pct + '%' : '—', sublabel: '28 days', className: 'pg-cons__ring'
    });
    const cons = h('section.card.pg-cons', { attrs: { 'aria-label': 'Consistency' } },
      ring,
      h('div.pg-cons__txt',
        h('p.eyebrow', 'Consistency'),
        h('p.pg-cons__main', c.planned ? c.done + ' of ' + plural(c.planned, 'planned day') : 'No planned days yet'),
        h('p.pg-cons__sub', c.planned ? (c.pct >= 80 ? 'Locked in. Keep stacking days.' : c.pct >= 50 ? 'Solid — close the gaps.' : 'Every planned day counts.')
          : 'Your first planned day starts the count.')));
    const tile = (kind, n) => {
      const v = h('span.pg-streak__num', '0');
      count(view, v, n, (x) => fmtNum(Math.round(x)));
      const hot = n > 0;
      return h('div', { class: ['pg-streak', 'pg-streak--' + kind, hot ? 'is-hot' : null] },
        h('span.pg-streak__icon', ic(kind === 'water' ? 'droplet' : 'flame', 22, hot && kind === 'train' ? 'flicker' : '')),
        h('div.pg-streak__txt',
          h('span.pg-streak__v', v, h('span.pg-streak__unit', n === 1 ? 'day' : 'days')),
          h('span.pg-streak__l', kind === 'water' ? 'Water streak' : 'Workout streak')));
    };
    return h('div.pg-streaks', cons, h('div.pg-streaks__col', tile('train', F.q.workoutStreak()), tile('water', F.q.waterStreak())));
  }

  function heatCard(view) {
    const cells = F.q.heatmap(HEAT_WEEKS);
    const n = cells.filter((c) => c.trained).length;
    return h('section.card.pg-heat', { attrs: { 'aria-label': 'Training calendar' } },
      cardHead('Training calendar · ' + HEAT_WEEKS + ' weeks', n ? plural(n, 'training day') : 'Nothing logged yet'),
      h('div.pg-heat__map', F.charts.heatmap({ cells, onCell: (iso) => onHeatCell(view, iso) })),
      h('p.pg-hint', ic('info', 14), n ? 'Tap a lit day to open that workout.' : 'Every workout you finish lights up its day.'));
  }

  function onHeatCell(view, iso) {
    let list = [];
    try { list = F.q.sessionsOn(iso); } catch (_) { list = []; }
    if (!list.length) {
      let rest = false;
      try { rest = F.q.dayStatus(iso).isRest; } catch (_) { rest = false; }
      const msg = iso === today() ? 'Nothing logged yet today' : (rest ? 'Rest day' : 'No workout logged') + ' · ' + F.util.fmtDate(iso, 'short');
      F.ui.toast(msg, { icon: rest ? 'bed' : 'calendar' });
      return;
    }
    if (list.length === 1) { openSession(view, list[0].id); return; }
    F.ui.menu(list.map((s) => ({
      label: str(s.title, 'Workout'),
      icon: 'dumbbell',
      hint: F.util.fmtTime(s.startedAt),
      onClick: () => openSession(view, s.id)
    })), { title: F.util.fmtDate(iso, 'long') });
  }

  function volumeCard(view) {
    const u = F.util;
    let weeks = F.q.weeklyVolume(VOLUME_WEEKS);
    // Weeks before the first use are noise: drop them, but keep at least 4 bars for scale.
    try {
      const fu = F.q.firstUse ? u.weekStart(F.q.firstUse()) : '';
      const idx = fu ? weeks.findIndex((w) => w.weekStart >= fu) : 0;
      if (idx > 0) weeks = weeks.slice(Math.min(idx, Math.max(0, weeks.length - 4)));
    } catch (_) { /* keep all weeks */ }
    const sets = weeks.map((w) => {
      let n = 0;
      try { for (const s of F.q.sessionsBetween(w.weekStart, u.addDays(w.weekStart, 6))) n += statsOf(s).sets; } catch (_) { n = 0; }
      return n;
    });
    const holder = h('div.pg-chart');
    const valueEl = h('span.pg-week__num');
    const unitEl = h('span.pg-week__unit');
    const deltaEl = h('span.pg-delta');
    const last = weeks.length - 1;

    function draw(metric, animate) {
      const isVol = metric !== 'sets';
      const vals = weeks.map((w, i) => (isVol ? disp(w.volume) : sets[i]));
      const cur = vals[last] || 0;
      const prev = vals[last - 1] || 0;
      valueEl.textContent = isVol ? fmtNum(Math.round(cur)) : fmtNum(cur);
      unitEl.textContent = isVol ? units() : (cur === 1 ? 'set' : 'sets');
      if (animate && !view.quiet) count(view, valueEl, cur, (n) => fmtNum(Math.round(n)));
      deltaEl.replaceChildren();
      deltaEl.className = 'pg-delta';
      if (prev > 0 && cur >= prev) {
        const pct = Math.round(((cur - prev) / prev) * 100);
        deltaEl.classList.add('is-up');
        deltaEl.append(ic('arrow-up', 14), pct > 0 ? '+' + pct + '% vs last week' : 'Level with last week');
      } else if (prev > 0) {
        // the week is still running: show last week as the number to beat, not a red "-39%"
        deltaEl.classList.add('is-goal');
        deltaEl.append(ic('target', 14), 'Beat last week: ' + (isVol ? fmtNum(Math.round(prev)) + ' ' + units() : plural(prev, 'set')));
      } else {
        deltaEl.classList.add('is-flat');
        deltaEl.append(weeks[last].sessions ? plural(weeks[last].sessions, 'workout') + ' this week' : 'No workouts yet this week');
      }
      holder.replaceChildren(F.charts.bars({
        height: 170,
        bars: weeks.map((w, i) => {
          const dm = u.fmtDate(w.weekStart, 'dm');
          return {
            label: i === last ? 'This wk' : dm,
            value: vals[i],
            highlight: i === last,
            title: 'Week of ' + dm + ': ' + (isVol ? u.fmtVolume(w.volume, units()) : plural(sets[i], 'set')) + ' · ' + plural(w.sessions, 'workout')
          };
        }),
        fmtY: isVol ? compact : (n) => fmtNum(n),
        emptyText: 'No weeks logged yet.'
      }));
    }

    const seg = F.ui.segmented({
      id: 'pg-vol-metric',
      label: 'Weekly chart metric',
      options: [{ value: 'volume', label: 'Volume' }, { value: 'sets', label: 'Sets' }],
      value: view.volMetric,
      onChange: (v) => { view.volMetric = v; draw(v, true); }
    });
    draw(view.volMetric, true);
    return h('section.card.pg-week', { attrs: { 'aria-label': 'Weekly training' } },
      h('div.pg-card-head',
        h('div.pg-card-head__titles',
          h('p.eyebrow', 'This week · ' + weeks.length + '-week trend'),
          h('p.pg-week__v', valueEl, unitEl)),
        seg),
      deltaEl,
      holder);
  }

  function splitCard() {
    let rows = [];
    try { rows = F.q.muscleSplit(SPLIT_DAYS).slice(); } catch (_) { rows = []; }
    // Planned muscles you haven't touched yet show up as empty bars — a gentle nudge.
    const have = new Set(rows.map((r) => r.muscle));
    try {
      const days = F.store.get().plan.days || {};
      for (const k of F.util.DAY_KEYS) {
        const d = days[k];
        if (!d || d.rest || !Array.isArray(d.focus)) continue;
        for (const m of d.focus) if (m && m !== 'fullbody' && !have.has(m)) { have.add(m); rows.push({ muscle: m, sets: 0 }); }
      }
    } catch (_) { /* plan unavailable */ }
    const total = rows.reduce((a, r) => a + num(r.sets), 0);
    const chart = total
      ? F.charts.hbars({ rows: rows.map((r) => ({ label: muscleLabel(r.muscle), value: r.sets, plate: plateOf(r.muscle) })), fmt: (n) => fmtNum(n) })
      : F.charts.hbars({ rows: [], emptyText: 'No sets in the last ' + SPLIT_DAYS + ' days.' });
    const top = rows.find((r) => r.sets > 0);
    return h('section.card.pg-split', { attrs: { 'aria-label': 'Muscle split' } },
      cardHead('Muscle split · ' + SPLIT_DAYS + ' days', total ? plural(total, 'set') : 'No sets yet',
        top ? h('span.pg-card-aside', 'Most: ' + muscleLabel(top.muscle)) : null),
      chart);
  }

  /* ================================================================== HISTORY */

  function buildHistory(view, panel) {
    const list = newestFirst();
    if (!list.length) {
      panel.append(h('div.pg-empty-wrap', F.ui.empty({
        icon: 'calendar',
        title: 'No workouts logged',
        text: 'Every workout you finish lands here — grouped by month, with sets, volume, PRs and how it felt.',
        action: startAction(view)
      })));
      return;
    }
    const T = F.q.totals();
    panel.append(h('div.pg-hsum',
      h('div.pg-hsum__item', h('span.pg-hsum__v', fmtNum(T.workouts)), h('span.pg-hsum__l', T.workouts === 1 ? 'Workout' : 'Workouts')),
      h('div.pg-hsum__item', h('span.pg-hsum__v', fmtMinutes(T.minutes)), h('span.pg-hsum__l', 'Trained')),
      h('div.pg-hsum__item', h('span.pg-hsum__v', compact(disp(T.volume)), h('small', units())), h('span.pg-hsum__l', 'Volume'))));

    const shown = list.slice(0, view.histLimit);
    const groups = [];
    for (const s of shown) {
      const key = String(s.date || '').slice(0, 7);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
      g.items.push(s);
    }
    // month totals over ALL sessions of that month, not just the shown page
    const monthCount = {};
    for (const s of list) { const k = String(s.date || '').slice(0, 7); monthCount[k] = (monthCount[k] || 0) + 1; }

    let i = 0;
    for (const g of groups) {
      const label = F.util.isISO(g.key + '-01') ? F.util.fmtDate(g.key + '-01', 'month') : 'Undated';
      const rows = g.items.map((s) => sessionRow(view, s, i++));
      panel.append(h('section.pg-month', { attrs: { 'aria-label': label } },
        h('h3.pg-month__head', h('span.pg-month__name', label), h('span.pg-month__count', plural(monthCount[g.key] || g.items.length, 'workout'))),
        h('div.pg-month__list.stagger', rows)));
    }
    if (list.length > shown.length) {
      const more = list.length - shown.length;
      panel.append(h('button.btn.btn--secondary.btn--block.pg-more', {
        type: 'button',
        on: { click: () => { view.histLimit += HISTORY_PAGE; rebuild(view, { keepScroll: true, quiet: true }); } }
      }, ic('chevron-down'), 'Show ' + Math.min(more, HISTORY_PAGE) + ' older' + (more > HISTORY_PAGE ? ' (' + more + ' left)' : '')));
    }
  }

  function sessionRow(view, s, i) {
    const st = statsOf(s);
    const prs = prsOf(s).length;
    const meta = [F.util.fmtDuration(st.durationSec), plural(st.sets, 'set')];
    if (st.volume > 0) meta.push(F.util.fmtVolume(st.volume, units()));
    else if (st.reps > 0) meta.push(plural(st.reps, 'rep'));
    const row = h('button.pg-sess', {
      type: 'button',
      dataset: { plate: sessionPlate(s), sid: String(s.id) },
      style: { '--i': Math.min(i, 14) },
      on: { click: () => openSession(view, s.id) }
    },
    h('span.pg-sess__date', { attrs: { 'aria-hidden': 'true' } },
      h('span.pg-sess__day', F.util.fmtDate(s.date, 'day') || '–'),
      h('span.pg-sess__wd', F.util.fmtDate(s.date, 'wd'))),
    h('span.pg-sess__main',
      h('span.sr-only', F.util.fmtDate(s.date, 'long') + ': '),
      h('span.pg-sess__title', str(s.title, 'Workout')),
      h('span.pg-sess__meta', meta.join(' · '))),
    h('span.pg-sess__side',
      prs ? h('span.pg-prbadge', ic('trophy', 14), h('span', prs + ' PR'), h('span.sr-only', prs === 1 ? ' (personal record)' : ' (personal records)')) : null,
      moodFace(s.feeling, 22)));
    if (view.flashId && view.flashId === s.id) { row.classList.add('is-flash'); view.flashId = null; }
    return row;
  }

  /* ------------------------------------------------------------------ session detail sheet */

  function openSession(view, id) {
    const s = findSession(id);
    if (!s) {
      F.ui.toast('That workout is no longer in your history.', { type: 'warn' });
      syncParams(view, { sessionId: null });
      return null;
    }
    syncParams(view, { sessionId: s.id });
    const st = statsOf(s);
    const prs = prsOf(s);
    const plate = sessionPlate(s);
    const u = F.util;
    const time = s.startedAt ? u.fmtTime(s.startedAt) + (s.endedAt ? '–' + u.fmtTime(s.endedAt) : '') : '';
    let api = null;

    const statBox = (label, value, unit) => h('div.pg-sd__stat', h('span.pg-sd__v', value, unit ? h('small', unit) : null), h('span.pg-sd__l', label));
    const vol = st.volume > 0 ? disp(st.volume) : 0;
    const stats = h('div.pg-sd__stats',
      statBox('Duration', u.fmtDuration(st.durationSec)),
      statBox('Volume', vol ? fmtNum(Math.round(vol)) : '—', vol ? units() : null),
      statBox('Sets', fmtNum(st.sets)),
      statBox('Reps', fmtNum(st.reps)));

    const prBanner = prs.length ? h('div.pg-sd__prs', { dataset: { plate: 'yellow' } },
      h('div.pg-sd__prs-head', h('span.pg-sd__trophy', ic('trophy', 22)),
        h('span', h('strong', prs.length === 1 ? 'New personal record' : prs.length + ' new personal records'), h('small', 'Beat everything you logged before this session'))),
      h('ul.pg-sd__prlist', prs.map((pr) => h('li',
        h('span.pg-sd__prname', exName(exOf(pr.exId))),
        h('span.pg-sd__prval', PR_KIND[pr.kind] || 'PR', ' ', h('strong', prValue(pr)), prDelta(pr) ? h('em', prDelta(pr)) : null))))) : null;

    // which set carries each exercise's PR
    const prSet = new Map();
    for (const pr of prs) {
      let best = null; let bestV = -Infinity;
      for (const e of s.exercises || []) {
        if (e.exId !== pr.exId) continue;
        for (const x of doneSets(e)) {
          const v = pr.kind === 'e1rm' ? setE1(x) : pr.kind === 'weight' ? num(x.w) : pr.kind === 'reps' ? num(x.r) : num(x.t);
          if (v > bestV) { bestV = v; best = x; }
        }
      }
      if (best) prSet.set(best.id, pr);
    }

    const blocks = (Array.isArray(s.exercises) ? s.exercises : []).map((e, i) => {
      const sets = doneSets(e);
      if (!sets.length) return null;
      const ex = exOf(e.exId);
      return exerciseBlock(view, e, ex, sets, prSet, i, () => api);
    }).filter(Boolean);

    const feeling = Math.round(num(s.feeling));
    const note = str(s.note);
    const reflect = feeling || note ? h('section.pg-sd__reflect',
      feeling >= 1 && feeling <= 5 ? h('div.pg-sd__feel', moodFace(feeling, 30), h('span', h('small', 'Felt'), h('strong', F.ui.moodLabel ? F.ui.moodLabel(feeling) : ''))) : null,
      note ? h('blockquote.pg-sd__note', note) : null) : null;

    const content = h('div.pg-sd', { dataset: { plate } },
      stats,
      prBanner,
      reflect,
      h('div.pg-sd__list.stagger', blocks.length ? blocks : h('p.muted', 'No completed sets were saved in this workout.')));

    api = F.ui.sheet({
      title: str(s.title, 'Workout'),
      subtitle: u.fmtDate(s.date, 'full') + (time ? ' · ' + time : ''),
      className: 'pg-sheet pg-sheet--session',
      content,
      actions: [
        { label: 'Delete', icon: 'trash', variant: 'danger', className: 'pg-sd__del', onClick: () => deleteFlow(view, s, api) },
        { label: 'Repeat workout', icon: 'repeat', variant: 'primary', onClick: () => repeatFlow(view, s, api) }
      ],
      onClose: (reason) => {
        view.sheets.delete(api);
        if (reason !== 'leave' && reason !== 'nav') syncParams(view, { sessionId: null });
      }
    });
    api.el.dataset.plate = plate;
    view.sheets.add(api);
    return api;
  }

  function exerciseBlock(view, e, ex, sets, prSet, i, getSheet) {
    const type = exType(ex);
    const anyW = sets.some((x) => num(x.w) > 0);
    const u = units();
    const cols = type === 'weight' ? ['Set', 'Weight', 'Reps', 'e1RM']
      : type === 'bodyweight' ? (anyW ? ['Set', 'Reps', 'Added'] : ['Set', 'Reps'])
        : (anyW ? ['Set', 'Hold', 'Added'] : ['Set', 'Hold']);
    const rows = sets.map((x, k) => {
      const pr = prSet.get(x.id);
      const cells = [];
      cells.push(h('td.pg-set__n', pr ? h('span.pg-set__pr', { attrs: { title: 'Personal record' } }, ic('trophy', 14), h('span.sr-only', 'PR, ')) : null, String(k + 1)));
      if (type === 'weight') {
        cells.push(h('td', num(x.w) > 0 ? fmtNum(disp(x.w), 2) : h('span.muted', 'BW')));
        cells.push(h('td', fmtNum(num(x.r))));
        const e1 = setE1(x);
        cells.push(h('td.pg-set__e1', e1 > 0 ? fmtNum(disp(e1), 1) : '—'));
      } else if (type === 'bodyweight') {
        cells.push(h('td', fmtNum(num(x.r))));
        if (anyW) cells.push(h('td', num(x.w) > 0 ? '+' + fmtW(x.w) : '—'));
      } else {
        cells.push(h('td', fmtHold(x.t)));
        if (anyW) cells.push(h('td', num(x.w) > 0 ? '+' + fmtW(x.w) : '—'));
      }
      return h('tr', { class: pr ? 'is-pr' : null }, cells);
    });
    const pr = sets.map((x) => prSet.get(x.id)).find(Boolean);
    const plate = plateOf(ex.muscle);
    return h('section.pg-sx', { dataset: { plate }, style: { '--i': Math.min(i, 14) } },
      h('div.pg-sx__head',
        F.ui.plateDot(plate),
        h('div.pg-sx__titles',
          h('h4.pg-sx__name', exName(ex), ex.missing ? h('span.badge.pg-sx__gone', 'Removed') : null),
          h('p.pg-sx__sub', muscleLabel(ex.muscle) + ' · ' + plural(sets.length, 'set') + (str(e.target) ? ' · target ' + str(e.target) : ''))),
        pr ? h('span.pg-prbadge', { attrs: { title: 'New PR: ' + (PR_KIND[pr.kind] || '') } }, ic('trophy', 14), 'PR') : null,
        ex.missing ? null : h('button.btn.btn--ghost.btn--sm.btn--icon.pg-sx__trend', {
          type: 'button',
          attrs: { 'aria-label': 'Progress for ' + exName(ex), title: 'Progress for this exercise' },
          on: {
            click: () => {
              const sh = getSheet();
              const under = Array.from(view.sheets).find((x) => x !== sh && x.exId === e.exId);
              if (sh) sh.close('button');
              if (!under) openExercise(view, e.exId);
            }
          }
        }, ic('chart', 18))),
      h('table.pg-set', h('thead', h('tr', cols.map((c, k) => h('th', { attrs: { scope: 'col' } }, k === 1 && type === 'weight' ? c + ' (' + u + ')' : k === 3 ? c + ' (' + u + ')' : c)))),
        h('tbody', rows)),
      str(e.note) ? h('p.pg-sx__note', ic('note', 14), str(e.note)) : null);
  }

  function repeatFlow(view, s, api) {
    const st = F.store.get();
    if (st.active) {
      F.ui.toast('You already have a workout in progress. Finish or discard it first.', {
        type: 'warn',
        action: { label: 'Resume', onClick: () => { if (api) api.close('nav'); F.router.go('workout'); } }
      });
      return;
    }
    const items = [];
    for (const e of s.exercises || []) {
      const ex = exOf(e.exId);
      if (ex.missing) continue;
      const n = doneSets(e).length || (Array.isArray(e.sets) ? e.sets.length : 0);
      items.push({ exId: e.exId, sets: Math.max(1, n), target: str(e.target, (ex.defaults && ex.defaults.target) || '8-12'), rest: e.rest === undefined ? null : e.rest, note: str(e.note) });
    }
    if (!items.length) {
      F.ui.toast('Nothing to repeat — the exercises in this workout were removed.', { type: 'warn' });
      return;
    }
    const a = F.store.startWorkout({ items, title: str(s.title, 'Workout') });
    if (!a) { F.ui.toast('Couldn’t start the workout.', { type: 'error' }); return; }
    if (api) api.close('nav');
    F.ui.toast('Loaded ' + plural(items.length, 'exercise') + ' from ' + F.util.fmtDate(s.date, 'dm') + '. Let’s go.', { type: 'ok', icon: 'repeat' });
    view.ctx.go('workout');
  }

  function deleteFlow(view, s, api) {
    F.ui.confirm({
      title: 'Delete this workout?',
      message: '“' + str(s.title, 'Workout') + '” on ' + F.util.fmtDate(s.date, 'short') + ' will be removed from your history, stats and records.',
      confirmLabel: 'Delete',
      danger: true
    }).then((ok) => {
      if (!ok) return;
      if (api) api.close('action');
      const doDelete = () => {
        const res = F.store.deleteSession(s.id);
        if (!res) return;
        F.util.haptic(14);
        F.ui.toast('Workout deleted', {
          icon: 'trash',
          action: {
            label: 'Undo',
            onClick: () => {
              view.flashId = res.session.id;
              F.store.restoreSession(res.session);
              F.ui.toast('Workout restored', { type: 'ok', icon: 'undo' });
            }
          }
        });
      };
      const row = view.ctx.isActive() && !F.util.reducedMotion() ? view.el.querySelector('.pg-sess[data-sid="' + cssEsc(s.id) + '"]') : null;
      if (row) {
        row.style.height = row.offsetHeight + 'px';
        row.classList.add('is-removing');
        setTimeout(doDelete, 260);
      } else {
        doDelete();
      }
    });
  }

  function cssEsc(v) {
    try { return window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'); } catch (_) { return String(v); }
  }

  /* ================================================================== EXERCISES */

  function exerciseItems() {
    let recs = [];
    try { recs = F.q.records(); } catch (_) { recs = []; }
    return recs.map((r) => {
      const ex = exOf(r.exId);
      const hist = historyOf(r.exId);
      return {
        id: r.exId, ex, hist, rec: r,
        name: exName(ex),
        count: hist.length,
        last: hist.length ? hist[hist.length - 1].date : r.date
      };
    }).filter((it) => it.count > 0);
  }

  /** Headline best of an exercise: { node: [..], label } — the unit is set small inside the value. */
  function headline(it) {
    const type = exType(it.ex);
    const b = bestsOf(it.hist);
    const sm = (t) => h('small', t);
    if (type === 'time') return { node: [fmtHold(b.t.v), sm(' hold')], label: 'Longest hold' };
    if (type === 'bodyweight') return { node: [fmtNum(b.r.v), sm(b.r.v === 1 ? ' rep' : ' reps')], label: 'Max reps' };
    if (b.e1.set) return { node: [fmtNum(disp(b.e1.set.w), 2), sm(' ' + units()), ' × ' + num(b.e1.set.r)], label: 'Best set' };
    return { node: [fmtNum(b.r.v), sm(' reps')], label: 'Most reps' };
  }
  function sparkValues(it) {
    const type = exType(it.ex);
    const vals = it.hist.map((rec) => (type === 'time' ? num(rec.maxT) : type === 'bodyweight' ? maxReps(rec) : num(rec.bestE1rm) || maxReps(rec)));
    return vals.slice(-12);
  }

  function buildExercises(view, panel) {
    const items = exerciseItems();
    if (!items.length) {
      panel.append(h('div.pg-empty-wrap', F.ui.empty({
        icon: 'dumbbell',
        title: 'No lifts yet',
        text: 'Exercises show up here once you log them — each with a trend line of your best sets and your calisthenics variations.',
        action: allSessions().length ? null : startAction(view)
      })));
      return;
    }
    const cal = items.filter((it) => it.ex.calisthenics || exType(it.ex) !== 'weight').length;
    const listEl = h('div.pg-exlist');
    const countEl = h('p.pg-exbar__count');

    function draw() {
      const q = String(view.exQuery || '').trim().toLowerCase();
      let list = items.filter((it) => !q || it.name.toLowerCase().includes(q) || muscleLabel(it.ex.muscle).toLowerCase().includes(q));
      const sort = view.exSort;
      list = list.slice().sort((a, b) => {
        if (sort === 'az') return a.name.localeCompare(b.name);
        if (sort === 'most') return b.count - a.count || (a.last < b.last ? 1 : -1);
        return a.last < b.last ? 1 : a.last > b.last ? -1 : b.count - a.count;
      });
      countEl.textContent = q ? plural(list.length, 'match', 'matches') + ' for “' + String(view.exQuery).trim() + '”'
        : plural(items.length, 'exercise') + ' logged · ' + cal + ' calisthenics';
      if (!list.length) {
        listEl.replaceChildren(h('div.pg-nomatch', ic('search', 22), h('p', 'Nothing you’ve logged matches that.'),
          h('button.btn.btn--ghost.btn--sm', { type: 'button', on: { click: () => { view.exQuery = ''; input.value = ''; draw(); input.focus(); } } }, 'Clear search')));
        return;
      }
      listEl.replaceChildren(h('div.pg-exrows.stagger', list.map((it, i) => exerciseRow(view, it, i))));
    }

    const input = h('input.input.pg-search__input#pg-ex-search', {
      type: 'search',
      placeholder: 'Search your exercises',
      value: view.exQuery || '',
      attrs: { 'aria-label': 'Search your exercises', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false' },
      on: { input: () => { view.exQuery = input.value; draw(); } }
    });
    const seg = F.ui.segmented({
      id: 'pg-ex-sort',
      label: 'Sort exercises',
      options: [{ value: 'recent', label: 'Recent' }, { value: 'most', label: 'Most done' }, { value: 'az', label: 'A–Z' }],
      value: view.exSort,
      onChange: (v) => { view.exSort = v; draw(); }
    });
    panel.append(
      h('div.pg-exbar', h('label.pg-search', ic('search', 20), input), seg, countEl),
      listEl);
    draw();
  }

  function exerciseRow(view, it, i) {
    const plate = plateOf(it.ex.muscle);
    const best = headline(it);
    return h('button.pg-ex', {
      type: 'button',
      dataset: { plate, exid: it.id },
      style: { '--i': Math.min(i, 14) },
      on: { click: () => openExercise(view, it.id) }
    },
    F.ui.plateDot(plate),
    h('span.pg-ex__name', it.name,
      it.ex.missing ? h('span.badge.pg-sx__gone', 'Removed') : null,
      it.ex.calisthenics ? h('span.pg-ex__cal', { attrs: { title: 'Calisthenics' } }, ic('body', 14), h('span.sr-only', ' (calisthenics)')) : null),
    h('span.pg-ex__best', { attrs: { title: best.label } }, h('span.sr-only', best.label + ': '), best.node),
    h('span.pg-ex__sub', plural(it.count, 'session') + ' · ' + relDate(it.last)),
    h('span.pg-ex__spark', { attrs: { 'aria-hidden': 'true' } }, F.charts.spark({ values: sparkValues(it), width: 76, height: 24, color: 'var(--plate)' })));
  }

  /* ------------------------------------------------------------------ exercise detail sheet */

  function metricsFor(type) {
    if (type === 'time') return [{ value: 'hold', label: 'Longest hold' }, { value: 'ttotal', label: 'Total time' }];
    if (type === 'bodyweight') return [{ value: 'reps', label: 'Max reps' }, { value: 'rtotal', label: 'Total reps' }];
    return [{ value: 'e1rm', label: 'Est. 1RM' }, { value: 'top', label: 'Heaviest' }, { value: 'volume', label: 'Volume' }];
  }

  function seriesFor(hist, metric) {
    const u = F.util;
    const pts = [];
    for (const rec of hist) {
      let y = 0; let label = '';
      const dm = u.fmtDate(rec.date, 'dm');
      switch (metric) {
        case 'hold': y = num(rec.maxT); label = dm + ': longest hold ' + fmtHold(y); break;
        case 'ttotal': y = (rec.sets || []).reduce((a, x) => a + num(x.t), 0); label = dm + ': ' + fmtHold(y) + ' total'; break;
        case 'reps': y = maxReps(rec); label = dm + ': best set ' + plural(y, 'rep'); break;
        case 'rtotal': y = num(rec.totalReps); label = dm + ': ' + plural(y, 'rep') + ' total'; break;
        case 'top': y = disp(rec.topW); label = dm + ': top set ' + fmtW(rec.topW); break;
        case 'volume': y = disp(rec.volume); label = dm + ': ' + F.util.fmtVolume(rec.volume, units()) + ' volume'; break;
        default: {
          y = disp(rec.bestE1rm);
          const top = (rec.sets || []).reduce((b, x) => (setE1(x) > setE1(b) ? x : b), null);
          label = dm + ': est. 1RM ' + fmtE1(rec.bestE1rm) + (top ? ' (' + setText(top, 'weight') + ')' : '');
        }
      }
      if (y > 0) pts.push({ x: rec.date, y: Math.round(y * 10) / 10, label });
    }
    return pts;
  }
  function fmtAxis(metric) {
    const u = units();
    if (metric === 'hold' || metric === 'ttotal') return fmtHold;
    if (metric === 'reps' || metric === 'rtotal') return (n) => fmtNum(n);
    if (metric === 'volume') return (n) => compact(n) + ' ' + u;
    return (n) => fmtNum(n, 1) + ' ' + u;
  }
  function fmtMetric(metric, v) {
    if (metric === 'hold' || metric === 'ttotal') return fmtHold(v);
    if (metric === 'reps' || metric === 'rtotal') return plural(Math.round(v), 'rep');
    return fmtNum(v, 1) + ' ' + units();
  }

  function openExercise(view, exId) {
    const ex = exOf(exId);
    const hist = historyOf(exId);
    if (!hist.length) {
      F.ui.toast('No logged sets for ' + exName(ex) + ' yet.', { icon: 'dumbbell' });
      syncParams(view, { exId: null });
      return null;
    }
    syncParams(view, { exId });
    const type = exType(ex);
    const plate = plateOf(ex.muscle);
    const b = bestsOf(hist);
    const u = F.util;
    let api = null;

    // --- headline bests
    const bestBox = (label, value, sub, hi) => h('div', { class: ['pg-xd__best', hi ? 'is-hi' : null] },
      h('span.pg-xd__bl', label), h('span.pg-xd__bv', value), sub ? h('span.pg-xd__bs', sub) : null);
    const bests = [];
    if (type === 'weight') {
      bests.push(bestBox('Est. 1RM', b.e1.v ? fmtE1(b.e1.v) : '—', b.e1.set ? setText(b.e1.set, 'weight') + ' · ' + relDate(b.e1.date) : '', true));
      bests.push(bestBox('Heaviest', b.w.v ? fmtW(b.w.v) : '—', b.w.set ? '× ' + plural(num(b.w.set.r), 'rep') + ' · ' + relDate(b.w.date) : ''));
      bests.push(bestBox('Most reps', b.r.v ? plural(b.r.v, 'rep') : '—', b.r.set ? '@ ' + (num(b.r.set.w) > 0 ? fmtW(b.r.set.w) : 'BW') + ' · ' + relDate(b.r.date) : ''));
    } else if (type === 'bodyweight') {
      bests.push(bestBox('Max reps', b.r.v ? plural(b.r.v, 'rep') : '—', b.r.date ? relDate(b.r.date) : '', true));
      bests.push(bestBox('Total reps', fmtNum(b.totalReps), 'across ' + plural(hist.length, 'session')));
      bests.push(bestBox('Added weight', b.w.v ? '+' + fmtW(b.w.v) : '—', b.w.set ? '× ' + plural(num(b.w.set.r), 'rep') + ' · ' + relDate(b.w.date) : 'Bodyweight only so far'));
    } else {
      bests.push(bestBox('Longest hold', b.t.v ? fmtHold(b.t.v) : '—', b.t.date ? relDate(b.t.date) : '', true));
      bests.push(bestBox('Total time', fmtHold(b.totalT), 'across ' + plural(b.sets, 'set')));
      bests.push(bestBox('Sessions', fmtNum(hist.length), 'since ' + u.fmtDate(hist[0].date, 'dm')));
    }

    // --- trend chart
    const metrics = metricsFor(type);
    let metric = metrics.some((m) => m.value === view.exMetric[type]) ? view.exMetric[type] : metrics[0].value;
    const chartBox = h('div.pg-xd__chart');
    const change = h('p.pg-xd__change');
    function drawChart() {
      const pts = seriesFor(hist, metric);
      chartBox.replaceChildren(F.charts.line({
        points: pts,
        height: 200,
        color: 'var(--plate)',
        fmtY: fmtAxis(metric),
        emptyText: 'No data for this measure yet.'
      }));
      change.replaceChildren();
      change.className = 'pg-xd__change';
      if (pts.length >= 2) {
        const d = pts[pts.length - 1].y - pts[0].y;
        const bestPt = pts.reduce((a, p) => (p.y > a.y ? p : a), pts[0]);
        change.classList.add(d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-flat');
        change.append(ic(d >= 0 ? 'arrow-up' : 'arrow-down', 14),
          h('strong', (d > 0 ? '+' : d < 0 ? '−' : '±') + fmtMetric(metric, Math.abs(d))),
          ' since ' + u.fmtDate(pts[0].x, 'dm') + ' · best ' + fmtMetric(metric, bestPt.y) + ' on ' + u.fmtDate(bestPt.x, 'dm'));
      }
    }
    const chartCard = h('section.pg-xd__card',
      h('div.pg-xd__cardhead', h('h3.pg-xd__h', 'Trend'),
        metrics.length > 1 ? F.ui.segmented({
          label: 'Chart measure',
          options: metrics,
          value: metric,
          onChange: (v) => { metric = v; view.exMetric[type] = v; drawChart(); }
        }) : null),
      chartBox, change);
    drawChart();

    // --- recent history
    const newest = hist.slice().reverse();
    const histList = h('ol.pg-xd__hist');
    let expanded = false;
    const moreBtn = newest.length > 6 ? h('button.btn.btn--ghost.btn--sm.pg-xd__more', { type: 'button' }) : null;
    function drawHist() {
      const list = expanded ? newest : newest.slice(0, 6);
      histList.replaceChildren(...list.map((rec) => {
        const best = type === 'time' ? fmtHold(rec.maxT) : type === 'bodyweight' ? plural(maxReps(rec), 'rep')
          : rec.bestE1rm > 0 ? fmtE1(rec.bestE1rm) : plural(maxReps(rec), 'rep');
        return h('li', h('button.pg-xd__row', {
          type: 'button',
          on: { click: () => openSession(view, rec.sessionId) }
        },
        h('span.pg-xd__date', h('strong', u.fmtDate(rec.date, 'dm')), h('small', u.fmtDate(rec.date, 'wd'))),
        h('span.pg-xd__sets', setsInline(rec.sets, type)),
        h('span.pg-xd__rb', h('strong', best), h('small', type === 'weight' && rec.bestE1rm > 0 ? 'e1RM' : 'best'))));
      }));
      if (moreBtn) moreBtn.replaceChildren(ic(expanded ? 'chevron-up' : 'chevron-down', 16), expanded ? 'Show fewer' : 'Show all ' + newest.length);
    }
    if (moreBtn) moreBtn.addEventListener('click', () => { expanded = !expanded; drawHist(); });
    drawHist();
    const histCard = h('section.pg-xd__card',
      h('div.pg-xd__cardhead', h('h3.pg-xd__h', 'History'), h('span.pg-xd__aside', plural(hist.length, 'session'))),
      h('p.pg-xd__cols', { attrs: { 'aria-hidden': 'true' } }, h('span', 'Date'), h('span', type === 'weight' ? 'Sets (' + units() + ' × reps)' : type === 'time' ? 'Holds' : 'Reps per set'), h('span', 'Best')),
      histList, moreBtn);

    // --- calisthenics variations
    let alts = [];
    try { alts = ex.missing ? [] : (F.q.alternatives(exId).calisthenics || []).slice(0, 6); } catch (_) { alts = []; }
    const altCard = alts.length ? h('section.pg-xd__card.pg-xd__alts',
      h('div.pg-xd__cardhead', h('h3.pg-xd__h', ex.calisthenics ? 'More calisthenics variations' : 'Calisthenics variations')),
      h('p.pg-xd__lead', 'Same movement, bodyweight style. Swap one in from your Plan or mid-workout.'),
      h('div.pg-xd__altlist', alts.map((a) => {
        const lv = (prog().LEVELS && prog().LEVELS[a.level] && prog().LEVELS[a.level].label) || '';
        return h('button.pg-alt', {
          type: 'button',
          dataset: { plate: plateOf(a.muscle), level: a.level || '' },
          on: { click: () => { try { F.picker.info(a.id); } catch (err) { console.error('[forge/progress]', err); } } }
        }, h('span.pg-alt__lv', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')),
        h('span.pg-alt__name', exName(a)), lv ? h('span.pg-alt__meta', lv) : null, ic('chevron-right', 16));
      }))) : null;

    const meta = h('div.pg-xd__meta',
      h('span.pg-xd__tag', { dataset: { plate } }, F.ui.plateDot(plate), muscleLabel(ex.muscle)),
      h('span.pg-xd__tag', ic((prog().TYPES && prog().TYPES[type] && prog().TYPES[type].icon) || 'dumbbell', 14), typeLabel(type)),
      ex.calisthenics && type === 'weight' ? h('span.pg-xd__tag', ic('body', 14), 'Calisthenics') : null,
      ex.missing ? h('span.badge.pg-sx__gone', 'Removed from library') : h('button.btn.btn--ghost.btn--sm.pg-xd__info', {
        type: 'button',
        on: { click: () => { try { F.picker.info(exId); } catch (err) { console.error('[forge/progress]', err); } } }
      }, ic('info', 16), 'How to'));

    const content = h('div.pg-xd', { dataset: { plate } },
      meta,
      h('div.pg-xd__bests', bests),
      chartCard,
      histCard,
      altCard);

    api = F.ui.sheet({
      title: exName(ex),
      subtitle: plural(hist.length, 'session') + ' · last logged ' + whenText(hist[hist.length - 1].date),
      size: 'full',
      className: 'pg-sheet pg-sheet--exercise',
      content,
      onClose: (reason) => {
        view.sheets.delete(api);
        if (reason !== 'leave' && reason !== 'nav') syncParams(view, { exId: null });
      }
    });
    api.exId = exId;
    api.el.dataset.plate = plate;
    view.sheets.add(api);
    return api;
  }

  /* ================================================================== RECORDS */

  function buildRecords(view, panel) {
    let recs = [];
    try { recs = F.q.records(); } catch (_) { recs = []; }
    if (!recs.length) {
      panel.append(h('div.pg-empty-wrap', F.ui.empty({
        icon: 'trophy',
        title: 'No records yet',
        text: 'Your first session sets the baseline for every exercise. Beat it next time and the PR lands here with a trophy.',
        action: startAction(view)
      })), prGuide());
      return;
    }
    let prs = [];
    try { prs = F.q.recentPRs(100000); } catch (_) { prs = []; }
    const t = today();
    const recent30 = prs.filter((p) => F.util.diffDays(p.date, t) < 30).length;

    // --- trophy hero
    const numEl = h('span.pg-trophy__num', '0');
    count(view, numEl, prs.length, (n) => fmtNum(Math.round(n)));
    const hero = h('section.pg-trophy', { attrs: { 'aria-label': 'Personal records' } },
      h('span.pg-trophy__medal', { attrs: { 'aria-hidden': 'true' } }, ic('trophy', 34)),
      h('div.pg-trophy__txt',
        h('p.eyebrow', 'Personal records'),
        h('p.pg-trophy__big', numEl, h('span.pg-trophy__unit', prs.length === 1 ? 'PR' : 'PRs')),
        h('p.pg-trophy__sub', prs.length
          ? (recent30 ? plural(recent30, 'PR') + ' in the last 30 days' : 'None in the last 30 days — time to chase one')
          : 'Baselines set for ' + plural(recs.length, 'exercise') + '. Beat one to log your first PR.')));
    panel.append(hero);

    // --- latest PR stamp + timeline
    if (prs.length) {
      const latest = prs[0];
      const lex = exOf(latest.exId);
      panel.append(h('button.pg-stamp', {
        type: 'button',
        dataset: { plate: plateOf(lex.muscle) },
        on: { click: () => openExercise(view, latest.exId) }
      },
      h('span.pg-stamp__ink', { attrs: { 'aria-hidden': 'true' } }, 'New PR'),
      h('span.pg-stamp__body',
        h('span.eyebrow', 'Latest PR · ' + relDate(latest.date)),
        h('span.pg-stamp__name', exName(lex)),
        h('span.pg-stamp__val', h('span.pg-stamp__kind', PR_KIND[latest.kind] || 'PR'), h('strong', prValue(latest)), prDelta(latest) ? h('em', prDelta(latest)) : null)),
      ic('chevron-right', 20)));

      const rest = prs.slice(1);
      if (rest.length) {
        const ol = h('ol.pg-tl.stagger');
        const more = rest.length > TIMELINE_SHORT ? h('button.btn.btn--ghost.btn--sm.pg-tl__more', { type: 'button' }) : null;
        const draw = () => {
          const list = view.tlAll ? rest : rest.slice(0, TIMELINE_SHORT);
          ol.replaceChildren(...list.map((pr, i) => {
            const ex = exOf(pr.exId);
            return h('li.pg-tl__item', { dataset: { plate: plateOf(ex.muscle) }, style: { '--i': Math.min(i, 14) } },
              h('span.pg-tl__node', { attrs: { 'aria-hidden': 'true' } }, ic('trophy', 14)),
              h('button.pg-tl__card', { type: 'button', on: { click: () => openExercise(view, pr.exId) } },
                h('span.pg-tl__main', h('span.pg-tl__name', exName(ex)), h('span.pg-tl__kind', (PR_KIND[pr.kind] || 'PR') + ' · ' + relDate(pr.date))),
                h('span.pg-tl__val', h('strong', prValue(pr)), prDelta(pr) ? h('em', prDelta(pr)) : null)));
          }));
          if (more) more.replaceChildren(ic(view.tlAll ? 'chevron-up' : 'chevron-down', 16), view.tlAll ? 'Show fewer' : 'Show all ' + rest.length);
        };
        if (more) more.addEventListener('click', () => { view.tlAll = !view.tlAll; draw(); });
        draw();
        panel.append(h('section.pg-sec', h('h3.pg-sec__title', ic('sparkle', 18), 'Recent PRs'), ol, more));
      }
    }

    // --- PR board grouped by muscle
    const order = Object.keys(prog().MUSCLES || {});
    const groups = new Map();
    for (const r of recs) {
      const ex = exOf(r.exId);
      const m = ex.muscle && order.indexOf(ex.muscle) >= 0 ? ex.muscle : 'fullbody';
      const hist = historyOf(r.exId);
      if (!hist.length) continue;
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push({ r, ex, hist, name: exName(ex) });
    }
    const keys = Array.from(groups.keys()).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const board = h('section.pg-sec.pg-board', h('h3.pg-sec__title', ic('target', 18), 'PR board'));
    const recentIds = new Set(prs.filter((p) => F.util.diffDays(p.date, t) < 7).map((p) => p.exId));
    for (const m of keys) {
      const list = groups.get(m).sort((a, b) => b.hist.length - a.hist.length || a.name.localeCompare(b.name));
      board.append(h('div.pg-bgroup', { dataset: { plate: plateOf(m) } },
        h('h4.pg-bgroup__head', h('span.pg-bgroup__name', muscleLabel(m)), h('span.pg-bgroup__count', plural(list.length, 'exercise'))),
        h('div.pg-bgroup__grid.stagger', list.map((it, i) => boardCard(view, it, i, recentIds.has(it.r.exId))))));
    }
    panel.append(board);
  }

  /** "How PRs are counted" — shown with the empty Records state. */
  function prGuide() {
    const rows = [
      { icon: 'dumbbell', plate: 'red', title: 'Est. 1RM', text: 'Weighted lifts: your best set scored as a one-rep max (Epley).' },
      { icon: 'plate', plate: 'blue', title: 'Heaviest', text: 'The most weight you have moved for a set.' },
      { icon: 'body', plate: 'teal', title: 'Most reps', text: 'Calisthenics: the most clean reps in one set.' },
      { icon: 'timer', plate: 'orange', title: 'Longest hold', text: 'Planks, L-sits, dead hangs: your longest hold.' }
    ];
    return h('section.card.pg-guide', { attrs: { 'aria-label': 'How PRs are counted' } },
      cardHead('How PRs are counted', null),
      h('ul.pg-guide__list', rows.map((r) => h('li', { dataset: { plate: r.plate } },
        h('span.pg-guide__icon', ic(r.icon, 20)),
        h('span.pg-guide__txt', h('strong', r.title), h('span', r.text))))));
  }

  function boardCard(view, it, i, fresh) {
    const type = exType(it.ex);
    const b = bestsOf(it.hist);
    let big = '—'; let label = ''; let when = ''; const facts = [];
    const fact = (l, v, d) => h('li', h('span', l), h('strong', v), d ? h('small', relDate(d)) : null);
    if (type === 'time') {
      big = b.t.v ? fmtHold(b.t.v) : '—'; label = 'Longest hold'; when = b.t.date;
      facts.push(fact('Total held', fmtHold(b.totalT)));
      facts.push(fact('Sessions', fmtNum(it.hist.length)));
    } else if (type === 'bodyweight') {
      big = fmtNum(b.r.v); label = b.r.v === 1 ? 'Max rep' : 'Max reps'; when = b.r.date;
      if (b.w.v > 0) facts.push(fact('Added', '+' + fmtW(b.w.v), b.w.date));
      facts.push(fact('Total', plural(b.totalReps, 'rep')));
    } else {
      big = b.e1.v ? fmtNum(disp(b.e1.v), 1) : '—'; label = 'Est. 1RM · ' + units(); when = b.e1.date;
      facts.push(fact('Heaviest', b.w.v ? fmtW(b.w.v) : '—', b.w.date));
      facts.push(fact('Most reps', b.r.v ? fmtNum(b.r.v) : '—', b.r.date));
    }
    return h('button.pg-rec', {
      type: 'button',
      dataset: { plate: plateOf(it.ex.muscle) },
      style: { '--i': Math.min(i, 14) },
      on: { click: () => openExercise(view, it.r.exId) }
    },
    h('span.pg-rec__head', h('span.pg-rec__name', it.name), fresh ? h('span.pg-rec__new', 'New') : null),
    h('span.pg-rec__score', h('span.pg-rec__big', big), h('span.pg-rec__label', label), when ? h('span.pg-rec__when', relDate(when)) : null),
    h('ul.pg-rec__facts', facts));
  }

  /* ================================================================== view shell */

  const BUILDERS = { overview: buildOverview, history: buildHistory, exercises: buildExercises, records: buildRecords };

  function eyebrowText() {
    const list = allSessions();
    if (!list.length) return 'Your training log';
    const first = F.q.firstUse ? F.q.firstUse() : list[0].date;
    return plural(list.length, 'workout') + (F.util.isISO(first) ? ' since ' + F.util.fmtDate(first, first.slice(0, 4) === today().slice(0, 4) ? 'dm' : 'dmy') : '');
  }

  /** Render `tab` into the panel host. opts: { dir: -1|0|1, quiet, keepScroll } */
  function showTab(view, tab, opts) {
    const o = opts || {};
    view.tab = tab;
    view.quiet = !!o.quiet;
    const panel = h('div.pg-panel', {
      id: 'pg-panel',
      class: [
        'pg-panel--' + tab,
        view.quiet ? 'is-quiet' : 'stagger',
        !view.quiet && o.dir > 0 ? 'pg-panel--from-right' : null,
        !view.quiet && o.dir < 0 ? 'pg-panel--from-left' : null
      ],
      attrs: { role: 'tabpanel', 'aria-labelledby': 'pg-tabs-tab-' + tab, tabindex: '-1' }
    });
    try {
      BUILDERS[tab](view, panel);
    } catch (err) {
      console.error('[forge/progress] ' + tab + ' failed', err);
      panel.replaceChildren(F.ui.empty({ icon: 'info', title: 'Couldn’t load this tab', text: 'Something in your data tripped it up. Your workouts are safe.' }));
    }
    Array.from(panel.children).forEach((c, i) => { if (!c.style.getPropertyValue('--i')) c.style.setProperty('--i', String(Math.min(i, 14))); });
    view.host.replaceChildren(panel);
    view.quiet = false;
    if (view.eyebrow) view.eyebrow.textContent = eyebrowText();
  }

  /** Rebuild the current tab without entrance animations (store changes, paging). */
  function rebuild(view, opts) {
    if (!view.ctx.isActive()) return;
    const active = document.activeElement;
    const focusId = active && active.id && view.host.contains(active) ? active.id : '';
    const sel = focusId && active.selectionStart !== undefined ? [active.selectionStart, active.selectionEnd] : null;
    const y = window.scrollY;
    showTab(view, view.tab, { quiet: (opts && opts.quiet) !== false });
    if (opts && opts.keepScroll) { try { window.scrollTo(0, y); } catch (_) { /* ignore */ } }
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) {
        try { again.focus({ preventScroll: true }); if (sel) again.setSelectionRange(sel[0], sel[1]); } catch (_) { /* ignore */ }
      }
    }
  }

  function switchTab(view, tab) {
    if (!TAB_KEYS.includes(tab) || tab === view.tab) return;
    const dir = TAB_KEYS.indexOf(tab) > TAB_KEYS.indexOf(view.tab) ? 1 : -1;
    // If the tab bar is stuck under the topbar, bring the new panel's top into view.
    let natural = null;
    try {
      const topbar = document.getElementById('topbar');
      const tb = topbar ? topbar.getBoundingClientRect().bottom : 0;
      natural = window.scrollY + view.head.getBoundingClientRect().bottom - tb;
    } catch (_) { natural = null; }
    showTab(view, tab, { dir });
    syncParams(view, { tab: tab === 'overview' ? null : tab }); // bare Overview: the Progress nav tab then just scrolls to top
    if (natural !== null && window.scrollY > natural) {
      try { window.scrollTo({ top: Math.max(0, natural), behavior: 'auto' }); } catch (_) { window.scrollTo(0, Math.max(0, natural)); }
    }
  }

  F.router.register('progress', {
    title: 'Progress',
    render(el, params, ctx) {
      const p = (ctx && ctx.params) || params || {};
      const tab = TAB_KEYS.includes(p.tab) ? p.tab : (p.sessionId ? 'history' : p.exId ? 'exercises' : 'overview');
      const view = {
        ctx, el, tab,
        host: h('div.pg-host'),
        head: null, eyebrow: null, tabs: null,
        sheets: new Set(),
        quiet: false,
        histLimit: HISTORY_PAGE,
        exQuery: '', exSort: 'recent', exMetric: {},
        volMetric: 'volume', tlAll: false, flashId: null
      };

      view.eyebrow = h('p.eyebrow.pg-eyebrow', eyebrowText());
      view.head = h('header.view-head.pg-head',
        h('div.view-head__titles', view.eyebrow, h('h2.h1', 'Progress')));
      view.tabs = F.ui.tabs({ id: 'pg-tabs', tabs: TABS, value: tab, onChange: (v) => switchTab(view, v) });
      view.tabs.setAttribute('aria-label', 'Progress sections');
      view.tabs.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-controls', 'pg-panel'));
      const bar = h('div.pg-tabbar', view.tabs);
      el.append(view.head, bar, view.host);
      // Paint the bar's backdrop only while it is stuck under the topbar.
      let raf = 0;
      const topbar = document.getElementById('topbar');
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!bar.isConnected) return;
          const edge = topbar ? topbar.getBoundingClientRect().bottom : 0;
          bar.classList.toggle('is-stuck', window.scrollY > 0 && bar.getBoundingClientRect().top <= edge + 1);
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      ctx.onLeave(() => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); });
      onScroll();
      showTab(view, tab, { dir: 0 });
      const want = tab === 'overview' ? undefined : tab;
      if (p.tab !== want) syncParams(view, { tab: want || null });

      ctx.onState((state, reason) => {
        const r = String(reason || '').split(' ');
        const waterOnly = view.tab === 'overview' && r.includes('water');
        if (!waterOnly && !r.some((x) => REASONS.includes(x))) return;
        rebuild(view, { quiet: true });
      });
      ctx.onLeave(() => {
        for (const s of Array.from(view.sheets)) { try { s.close('leave'); } catch (_) { /* ignore */ } }
        view.sheets.clear();
      });

      // Deep links: open the requested sheets once the view is on screen.
      const exId = typeof p.exId === 'string' && p.exId ? p.exId : null;
      const sessionId = typeof p.sessionId === 'string' && p.sessionId ? p.sessionId : null;
      if (exId || sessionId) {
        setTimeout(() => {
          if (!ctx.isActive()) return;
          if (exId) openExercise(view, exId);
          if (sessionId) openSession(view, sessionId);
        }, 90);
      }
    }
  });
})(window.Forge = window.Forge || {});
