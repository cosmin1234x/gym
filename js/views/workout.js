/* FORGE — js/views/workout.js  [VIEW:workout]
 * The live workout logger (SPEC §12 "workout") and the global rest timer F.restTimer.
 *
 * No active workout → start screen: today's plan hero (or rest-day calisthenics flows), the other
 * training days, an empty workout, "repeat a recent session" and optional calisthenics flows.
 *
 * Active workout → a sticky console (title, live clock, Finish) with a barbell that loads a plate in
 * the exercise's muscle colour for every completed set; exercise cards with set rows (previous,
 * kg|lb / +kg / seconds with a HOLD stopwatch, reps, a big check); swap / move / note / remove;
 * add exercise; workout notes; finish → summary sheet.
 *
 * Rendering is keyed and surgical: cards are keyed by entry id and set rows by set id. A store
 * notification reconciles only what changed, never rewrites a focused input, and animates rows and
 * cards in and out — so typing weights keeps focus and checks stay snappy.
 *
 * F.restTimer.mount(dockEl) renders a floating countdown pill into #rest-dock while
 * state.active.rest is running (survives navigation and reloads: endsAt is persisted).
 */
(function (F) {
  'use strict';

  /* ================================================================ helpers */

  const h = (...a) => F.util.h(...a);
  const U = () => F.util;
  const S = () => F.store.get();
  const ic = (name, size, cls) => (F.icon ? F.icon(name, { size: size || 20, cls: cls || '' }) : document.createElement('span'));
  const prog = () => (F.data && F.data.program) || {};
  const units = () => (S().settings && S().settings.units === 'lb' ? 'lb' : 'kg');
  const pad2 = (n) => String(n).padStart(2, '0');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const reduced = () => { try { return U().reducedMotion(); } catch (_) { return false; } };

  function reasonHas(reason, keys) {
    const parts = String(reason || '').split(' ');
    return keys.some((k) => parts.indexOf(k) >= 0);
  }
  /** Run an event-handler body; log (never swallow silently) and keep the UI alive. */
  function guard(label, fn) {
    try { return fn(); } catch (err) { console.error('[FORGE] workout: ' + label + ' failed', err); return undefined; }
  }
  function exOf(id) {
    try { const ex = F.q.exercise(id); if (ex) return ex; } catch (_) { /* fall through */ }
    return { id: String(id || ''), name: 'Deleted exercise', muscle: 'fullbody', type: 'weight', cues: [], equipment: [], defaults: {}, missing: true };
  }
  const typeOf = (ex) => (ex && (ex.type === 'bodyweight' || ex.type === 'time') ? ex.type : 'weight');
  function plateOf(muscle) {
    try { const p = F.ui.plateOf(muscle); if (p) return p; } catch (_) { /* ignore */ }
    try { return prog().plateFor(muscle) || 'red'; } catch (_) { return 'red'; }
  }
  const dayItems = (day) => (day && Array.isArray(day.items) ? day.items : []);
  const isRestDay = (day) => !day || !!day.rest || !dayItems(day).length;
  function plateOfDay(day) {
    if (day && Array.isArray(day.focus) && day.focus.length) { try { return prog().plateFor(day.focus); } catch (_) { /* ignore */ } }
    const first = dayItems(day)[0];
    return first ? plateOf(exOf(first.exId).muscle) : 'white';
  }
  function dayTitle(day, key) { return str(day && day.title) || U().DAY_LONG[key] || 'Workout'; }
  function muscleLabel(m) {
    const M = prog().MUSCLES || {};
    if (M[m] && M[m].label) return M[m].label;
    const s = String(m || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other';
  }
  function setTotal(items) { let n = 0; for (const it of items) n += Math.max(0, Number(it && it.sets) || 0); return n; }
  function restOf(entry) {
    const r = entry && entry.rest !== null && entry.rest !== undefined ? Number(entry.rest) : Number(S().settings.restSeconds);
    return Number.isFinite(r) ? Math.max(0, r) : 90;
  }
  /** Title text with a plate-coloured ampersand (text nodes only). */
  function titleNodes(text) {
    const out = [];
    String(text).replace(/&[ \t]+/g, '& ').split('&').forEach((part, i) => {
      if (i) out.push(h('span.wo-amp', '&'));
      if (part) out.push(part);
    });
    return out;
  }
  /** Replace an element's children (null / false entries skipped). */
  function fill(el, ...kids) {
    U().clear(el);
    for (const k of kids) if (k) el.appendChild(k);
    return el;
  }
  function replay(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function wake(on) {
    try {
      if (F.app && typeof F.app.keepAwake === 'function') {
        const p = F.app.keepAwake(!!on);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (_) { /* optional */ }
  }
  function scrollIntoViewSoft(el, block) {
    if (!el || !el.isConnected) return;
    try { el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: block || 'center' }); } catch (_) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- value formatting */

  function wDisp(kg) {
    const v = U().toDisplayWeight(kg, units());
    return v === null ? '' : String(v);
  }
  function fmtSecs(t) {
    const n = Number(t);
    if (!Number.isFinite(n)) return '–';
    return n < 60 ? Math.round(n) + 's' : U().fmtClock(n);
  }
  /** Compact one-set value: '20×10' | '+5×8' | '8' | '30s'. */
  function fmtSetShort(set, type) {
    if (!set) return '';
    if (type === 'time') return set.t !== null && set.t !== undefined ? fmtSecs(set.t) : '–';
    const r = set.r !== null && set.r !== undefined ? String(set.r) : '–';
    if (type === 'bodyweight') return Number(set.w) > 0 ? '+' + wDisp(set.w) + '×' + r : r;
    return (set.w !== null && set.w !== undefined ? wDisp(set.w) : '–') + '×' + r;
  }
  /** A run of sets: '20 kg × 10 · 10 · 9' | '12 · 10 · 9 reps' | '30s · 30s' | '20×10 · 22.5×8 kg'. */
  function fmtSetsLine(sets, type) {
    if (!Array.isArray(sets) || !sets.length) return '';
    const u = units();
    if (type === 'time') return sets.map((s) => fmtSecs(s.t)).join(' · ');
    const reps = sets.map((s) => (s.r !== null && s.r !== undefined ? s.r : '–'));
    const ws = sets.map((s) => (Number(s.w) > 0 ? Number(s.w) : 0));
    const same = ws.every((w) => w === ws[0]);
    if (same && !ws[0]) return reps.join(' · ') + ' reps';
    if (same) return (type === 'bodyweight' ? '+' : '') + U().fmtWeight(ws[0], u) + ' × ' + reps.join(' · ');
    return sets.map((s) => fmtSetShort(s, type)).join(' · ') + ' ' + u;
  }
  function targetText(entry) {
    const t = str(entry.target) || '—';
    return entry.sets.length + ' × ' + (t.toUpperCase() === 'AMRAP' ? 'AMRAP' : t);
  }
  /** '90' | '1:30' | '1m30' → seconds, null when unreadable. */
  function parseSecs(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let m = /^(\d{1,3}):(\d{1,2})$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /^(\d{1,5})\s*s?$/i.exec(s);
    return m ? Number(m[1]) : null;
  }
  function prText(pr, ex) {
    const u = units();
    const name = ex ? ex.name : 'Exercise';
    switch (pr.kind) {
      case 'e1rm': return name + ': est. 1RM ' + U().fmtWeight(pr.value, u) + ' (was ' + U().fmtWeight(pr.prev, u) + ')';
      case 'weight': return name + ': heaviest yet, ' + U().fmtWeight(pr.value, u) + ' (was ' + U().fmtWeight(pr.prev, u) + ')';
      case 'reps': return name + ': ' + pr.value + ' reps (best was ' + pr.prev + ')';
      case 'time': return name + ': ' + fmtSecs(pr.value) + ' hold (best was ' + fmtSecs(pr.prev) + ')';
      default: return name + ': new personal record';
    }
  }
  function prShort(pr) {
    const u = units();
    switch (pr.kind) {
      case 'e1rm': return 'Est. 1RM ' + U().fmtWeight(pr.value, u);
      case 'weight': return 'Heaviest ' + U().fmtWeight(pr.value, u);
      case 'reps': return pr.value + ' reps';
      case 'time': return fmtSecs(pr.value) + ' hold';
      default: return 'New record';
    }
  }
  function prPrev(pr) {
    const u = units();
    if (pr.kind === 'reps') return 'was ' + pr.prev;
    if (pr.kind === 'time') return 'was ' + fmtSecs(pr.prev);
    return 'was ' + U().fmtWeight(pr.prev, u);
  }

  /* ---------------------------------------------------------------- active-state lookups */

  function findSet(entryId, setId) {
    const a = S().active;
    const entry = a && a.exercises.find((e) => e.id === entryId);
    const set = entry && entry.sets.find((s) => s.id === setId);
    return set ? { a, entry, set, index: entry.sets.indexOf(set) } : null;
  }
  /** The set to do next: first unchecked set in (or after) the exercise you last ticked. */
  function nextUp(a) {
    if (!a || !Array.isArray(a.exercises) || !a.exercises.length) return null;
    const list = a.exercises;
    let start = 0;
    let latest = -1;
    list.forEach((e, i) => e.sets.forEach((s) => { if (s.done && (s.at || 0) >= latest) { latest = s.at || 0; start = i; } }));
    for (let k = 0; k < list.length; k++) {
      const e = list[(start + k) % list.length];
      const j = e.sets.findIndex((s) => !s.done);
      if (j >= 0) return { entry: e, set: e.sets[j], index: j };
    }
    return null;
  }

  /* ---------------------------------------------------------------- view-local memory (survives re-renders) */

  const mem = {
    expanded: new Set(),  // completed entries the user re-opened
    cues: new Set(),      // entries with form cues shown
    hold: null,           // running HOLD stopwatch { entryId, setId, t0, phase, target, lastN, hit }
    scrollTo: null,       // entry id to bring into view after the next sync
    fresh: false          // just started: play the loading entrance
  };
  const LEADIN_KEY = 'forge:workout:leadin';
  const HOLD_KEY = 'forge:workout:hold';
  /** Keep a running HOLD stopwatch across reloads (per device). */
  function saveHold() { U().storage.set(HOLD_KEY, mem.hold || null); }
  function loadHold() {
    if (mem.hold) return;
    const hd = U().storage.get(HOLD_KEY, null);
    if (!hd || typeof hd !== 'object' || !isNum(hd.t0) || Date.now() - hd.t0 > 30 * 60 * 1000) return;
    const f = findSet(hd.entryId, hd.setId);
    if (f && !f.set.done) mem.hold = { entryId: hd.entryId, setId: hd.setId, t0: hd.t0, phase: Date.now() >= hd.t0 ? 'run' : 'count', target: isNum(hd.target) ? hd.target : null, lastN: null, hit: !!hd.hit };
    else U().storage.remove(HOLD_KEY);
  }
  const leadIn = () => U().storage.get(LEADIN_KEY, true) !== false;

  /* ================================================================ start screen */

  const FLOW_LOOK = [{ plate: 'teal', icon: 'body' }, { plate: 'orange', icon: 'bar' }, { plate: 'violet', icon: 'heart' }];

  function restFlows() {
    const P = prog();
    const all = Array.isArray(P.templates) ? P.templates : [];
    const ids = Array.isArray(P.restDayTemplateIds) ? P.restDayTemplateIds : [];
    let list = ids.map((id) => all.find((t) => t && t.id === id)).filter((t) => t && Array.isArray(t.items));
    if (!list.length) list = all.filter((t) => t && t.restDay && Array.isArray(t.items));
    return list;
  }

  function start(ctx, opts, after) {
    if (S().active) { ctx.go('workout', {}, { replace: true }); return; }
    const a = guard('startWorkout', () => F.store.startWorkout(opts));
    if (!a) { F.ui.toast('Could not start that workout', { type: 'error' }); return; }
    U().haptic(18);
    mem.fresh = true;
    mem.expanded.clear();
    if (ctx.isActive()) ctx.go('workout', {}, { replace: true });
    else F.router.go('workout');
    if (typeof after === 'function') after();
  }

  function renderStart(el, ctx) {
    ctx.setTitle('Train');
    const u = U();
    const today = u.todayISO();
    const plan = F.q.planFor(today);
    const dayKey = plan.dayKey;
    const day = plan.day;
    const rest = isRestDay(day);
    let week = null;
    try { week = F.q.weekSummary(today); } catch (_) { week = null; }
    const weekDone = week ? (isNum(week.plannedDone) ? week.plannedDone : week.done) : 0;

    const doneToday = F.q.sessionsOn(today).length > 0;
    const heading = doneToday ? 'Done for today' : (rest ? 'Recover or move' : 'Time to lift');
    const head = h('header.view-head',
      h('div.view-head__titles',
        h('p.eyebrow', u.fmtDate(today, 'long')),
        h('h2.h1', heading)),
      week && week.planned ? h('div.view-head__actions',
        h('span.wo-weekpill', { attrs: { 'aria-label': weekDone + ' of ' + week.planned + ' training days done this week' } },
          h('span.wo-weekpill__dots', { attrs: { 'aria-hidden': 'true' } },
            Array.from({ length: Math.min(7, week.planned) }, (_, i) => h('i', { class: i < weekDone ? 'is-on' : null }))),
          h('span.num', weekDone + '/' + week.planned), ' this week')) : null);

    const sections = [head, rest ? restHero(ctx, dayKey, day, today) : todayHero(ctx, dayKey, day, today)];
    const others = otherDays(ctx, dayKey);
    if (others) sections.push(others);
    sections.push(quickStart(ctx));
    sections.push(recentSessions(ctx));
    if (!rest) { const f = flowsSection(ctx); if (f) sections.push(f); }

    el.appendChild(h('div.wo-start.stack-lg', sections));

    ctx.onState((st, reason) => {
      if (S().active && reasonHas(reason, ['workout'])) { ctx.go('workout', {}, { replace: true }); return; }
      if (reasonHas(reason, ['plan', 'session', 'finish', 'settings', 'library'])) ctx.rerender();
    });
  }

  function todayHero(ctx, dayKey, day, today) {
    const u = U();
    const items = dayItems(day);
    const title = dayTitle(day, dayKey);
    const plate = plateOfDay(day);
    const sets = setTotal(items);
    const mins = F.q.estimateMinutes(day);
    const doneToday = F.q.sessionsOn(today).length > 0;
    const focus = Array.isArray(day.focus) ? day.focus.filter((m) => prog().MUSCLES && prog().MUSCLES[m]) : [];
    const shown = items.slice(0, 5);
    const long = title.length > 16;

    // Preview barbell: every planned set as a plate in its muscle colour.
    const plates = [];
    for (const it of items) { const p = plateOf(exOf(it.exId).muscle); for (let i = 0; i < Math.max(0, Number(it.sets) || 0); i++) plates.push(p); }

    return h('section.card.card--hero.wo-hero', { dataset: { plate }, attrs: { 'aria-labelledby': 'wo-hero-title' } },
      h('div.wo-hero__top',
        h('p.eyebrow.wo-hero__eyebrow', 'Today · ' + u.DAY_LONG[dayKey]),
        doneToday
          ? h('span.badge.badge--ok', ic('check', 13), 'Done today')
          : h('span.wo-hero__chip', ic('clock', 15), '~' + mins + ' min')),
      h('h3', { id: 'wo-hero-title', class: ['h-display', 'wo-hero__title', long ? 'is-long' : null] }, titleNodes(title)),
      h('div.wo-hero__meta',
        focus.map((m) => h('span.badge.badge--plate', { dataset: { plate: plateOf(m) } }, muscleLabel(m))),
        h('span.wo-hero__facts', plural(items.length, 'exercise') + ' · ' + plural(sets, 'set'))),
      miniBarbell(plates),
      h('ol.wo-hero__list', shown.map((it, i) => {
        const ex = exOf(it.exId);
        return h('li.wo-hero__item', { dataset: { plate: plateOf(ex.muscle) }, class: ex.missing ? 'is-missing' : null },
          h('span.wo-hero__n', pad2(i + 1)),
          h('span.wo-hero__name', ex.name),
          ex.calisthenics ? h('span.wo-hero__cali', { attrs: { title: 'Calisthenics', 'aria-label': 'Calisthenics' } }, ic('body', 14)) : null,
          h('span.wo-hero__sets', it.sets + '×' + (str(it.target) || '—')));
      })),
      items.length > shown.length ? h('p.wo-hero__more', '+ ' + plural(items.length - shown.length, 'more exercise')) : null,
      h('div.wo-hero__cta',
        h('button.btn.btn--primary.btn--lg.wo-cta', { type: 'button', onClick: () => start(ctx, { dayKey }) },
          ic('play', 22), doneToday ? 'Train again' : 'Start workout'),
        h('button.btn.btn--secondary.btn--lg.btn--icon', {
          type: 'button', title: 'Edit in plan', 'aria-label': 'Edit ' + title + ' in the plan',
          onClick: () => ctx.go('plan', { day: dayKey })
        }, ic('edit', 22))));
  }

  /** A little loaded barbell used as a preview on the start hero. */
  function miniBarbell(plates) {
    if (!plates.length) return null;
    const left = []; const right = [];
    plates.forEach((p, i) => (i % 2 ? right : left).push(h('i.wo-mini__plate', { dataset: { plate: p }, style: { '--i': Math.floor(i / 2) } })));
    return h('div.wo-mini', { attrs: { 'aria-hidden': 'true' } },
      h('span.wo-mini__cap'), h('span.wo-mini__sleeve.is-left', left), h('span.wo-mini__collar'),
      h('span.wo-mini__shaft'),
      h('span.wo-mini__collar'), h('span.wo-mini__sleeve.is-right', right), h('span.wo-mini__cap'));
  }

  function restHero(ctx, dayKey, day, today) {
    const u = U();
    const flows = restFlows();
    const doneToday = F.q.sessionsOn(today).length > 0;
    return h('section.card.card--hero.wo-hero.wo-hero--rest', { dataset: { plate: 'teal' }, attrs: { 'aria-labelledby': 'wo-hero-title' } },
      h('div.wo-hero__top',
        h('p.eyebrow.wo-hero__eyebrow', 'Today · ' + u.DAY_LONG[dayKey]),
        doneToday ? h('span.badge.badge--ok', ic('check', 13), 'Moved today') : h('span.wo-hero__chip', ic('bed', 15), 'Recovery')),
      h('h3.h-display.wo-hero__title#wo-hero-title', 'Rest day'),
      h('p.wo-hero__lede', 'Recovery is part of the plan. Feeling fresh? Pick an optional calisthenics flow: bodyweight only, easy on the joints, done in about 20 minutes.'),
      flows.length
        ? h('div.wo-flows.stagger', flows.map((t, i) => flowCard(ctx, t, i)))
        : null);
  }

  function flowCard(ctx, t, i) {
    const look = FLOW_LOOK[i % FLOW_LOOK.length];
    let mins = 0;
    try { mins = F.q.estimateMinutes({ rest: false, items: t.items }); } catch (_) { mins = 0; }
    return h('button.wo-flow', {
      type: 'button', dataset: { plate: look.plate }, style: { '--i': i },
      'aria-label': 'Start ' + t.title + ', ' + plural(t.items.length, 'move') + (mins ? ', about ' + mins + ' minutes' : ''),
      onClick: () => start(ctx, { templateId: t.id })
    },
    h('span.wo-flow__disc', ic(look.icon, 22)),
    h('span.wo-flow__main',
      h('span.wo-flow__title', t.title),
      t.description ? h('span.wo-flow__desc', t.description) : null,
      h('span.wo-flow__meta', plural(t.items.length, 'move') + (mins ? ' · ~' + mins + ' min' : ''))),
    h('span.wo-flow__go', ic('play', 18)));
  }

  function sectionHead(title, sub, action) {
    return h('div.wo-sec__head',
      h('div.wo-sec__titles', h('h3.h3', title), sub ? h('p.wo-sec__sub', sub) : null),
      action || null);
  }

  function otherDays(ctx, todayKey) {
    const u = U();
    const rows = u.DAY_KEYS.filter((k) => k !== todayKey).map((k) => ({ k, day: F.q.dayPlan(k) })).filter((x) => !isRestDay(x.day));
    const planLink = h('button.btn.btn--ghost.btn--sm', { type: 'button', onClick: () => ctx.go('plan', {}) }, 'Edit plan', ic('chevron-right', 16));
    if (!rows.length) {
      return h('section.wo-sec', sectionHead('Your week', null, null),
        F.ui.empty({
          icon: 'calendar', title: 'No training days yet',
          text: 'Set up your split in the plan and every training day shows up here, ready to start in one tap.',
          action: { label: 'Open the plan', icon: 'calendar', onClick: () => ctx.go('plan', {}) }
        }));
    }
    return h('section.wo-sec', sectionHead('Other days', 'Train any day of your split, any time.', planLink),
      h('div.list.wo-days.stagger', rows.map(({ k, day }, i) => {
        const title = dayTitle(day, k);
        const items = dayItems(day);
        return h('button.list-row.wo-day', {
          type: 'button', dataset: { plate: plateOfDay(day) }, style: { '--i': i },
          'aria-label': 'Start ' + title + ' (' + u.DAY_LONG[k] + ')',
          onClick: () => start(ctx, { dayKey: k })
        },
        h('span.wo-day__tag', u.DAY_SHORT[k]),
        h('span.list-row__main',
          h('span.list-row__title.wo-day__title', title),
          h('span.list-row__sub', plural(items.length, 'exercise') + ' · ' + plural(setTotal(items), 'set') + ' · ~' + F.q.estimateMinutes(day) + ' min')),
        h('span.wo-day__go', ic('play', 16)));
      })));
  }

  function emptyWorkout(ctx) {
    F.ui.prompt({ title: 'Empty workout', label: 'Name it (optional)', value: '', placeholder: 'Quick workout', confirmLabel: 'Start' })
      .then((name) => {
        if (name === null || S().active) return;
        const title = name || 'Quick workout';
        if (ctx.isActive()) start(ctx, { blank: true, title }, () => openAddExercise());
        else {
          guard('startWorkout', () => F.store.startWorkout({ blank: true, title }));
          F.router.go('workout');
          openAddExercise();
        }
      });
  }

  function quickStart(ctx) {
    return h('section.wo-sec', sectionHead('Quick start', null, null),
      h('button.wo-quick', { type: 'button', onClick: () => emptyWorkout(ctx) },
        h('span.wo-quick__icon', ic('plus', 26)),
        h('span.wo-quick__main',
          h('span.wo-quick__title', 'Empty workout'),
          h('span.wo-quick__sub', 'Name it, then add exercises as you go.')),
        h('span.wo-quick__go', ic('chevron-right', 20))));
  }

  function recentSessions(ctx) {
    const u = U();
    const list = (Array.isArray(S().sessions) ? S().sessions : []).slice(-3).reverse();
    if (!list.length) {
      return h('section.wo-sec', sectionHead('Repeat a recent session', null, null),
        h('div.wo-empty-compact', F.ui.empty({
          icon: 'repeat',
          title: 'Nothing to repeat yet',
          text: 'Your last three finished workouts land here. Repeat any of them, same exercises and sets, in one tap.'
        })));
    }
    return h('section.wo-sec', sectionHead('Repeat a recent session', 'Same exercises and sets, fresh start.', null),
      h('div.list.wo-recent.stagger', list.map((s, i) => {
        let stats = null;
        try { stats = F.q.sessionStats(s); } catch (_) { stats = null; }
        const exCount = s.exercises.length;
        const sets = stats ? stats.sets : setTotal(s.exercises.map((e) => ({ sets: e.sets.length })));
        const bits = [u.fmtRelDay(s.date), plural(exCount, 'exercise'), plural(sets, 'set')];
        if (stats && stats.durationSec) bits.push(u.fmtDuration(stats.durationSec));
        let plate = 'red';
        if (stats && stats.byMuscle) {
          let best = null;
          for (const m of Object.keys(stats.byMuscle)) if (!best || stats.byMuscle[m] > stats.byMuscle[best]) best = m;
          if (best) plate = plateOf(best);
        }
        return h('button.list-row.wo-rec', {
          type: 'button', dataset: { plate }, style: { '--i': i },
          'aria-label': 'Repeat ' + s.title + ' from ' + u.fmtRelDay(s.date),
          onClick: () => start(ctx, {
            items: s.exercises.map((e) => ({ exId: e.exId, sets: e.sets.length, target: e.target, rest: e.rest })),
            title: s.title
          })
        },
        h('span.wo-rec__icon', ic('repeat', 20)),
        h('span.list-row__main',
          h('span.list-row__title', s.title),
          h('span.list-row__sub', bits.join(' · '))),
        h('span.wo-rec__go', ic('play', 16)));
      })));
  }

  function flowsSection(ctx) {
    const flows = restFlows();
    if (!flows.length) return null;
    return h('section.wo-sec', sectionHead('Calisthenics flows', 'Optional bodyweight sessions, made for rest days.', null),
      h('div.wo-flows.wo-flows--row.stagger', flows.map((t, i) => flowCard(ctx, t, i))));
  }

  /* ================================================================ active workout */

  function renderActive(el, ctx) {
    const a0 = S().active;
    ctx.setTitle('Workout');
    const V = { el, ctx, activeId: a0.id, cards: new Map(), units: units(), initial: true, nextId: null, alive: true };

    V.bar = buildBar(V);
    loadHold();
    V.list = h('div.wo-list', { class: mem.fresh ? 'is-fresh' : null });
    V.emptyHost = h('div.wo-emptyhost');
    V.foot = buildFoot(V);
    el.appendChild(h('div.wo-active', V.bar.el, V.list, V.emptyHost, V.foot.el));

    syncAll(V);
    V.initial = false;
    if (mem.fresh) {
      mem.fresh = false;
      setTimeout(() => V.list.classList.remove('is-fresh'), 1400);
    }

    wake(S().settings.keepAwake !== false);
    const clock = setInterval(() => tickClock(V), 1000);
    loadHold();
    if (mem.hold) startHoldTicker(V);

    ctx.onLeave(() => {
      V.alive = false;
      clearInterval(clock);
      stopHoldTicker();
      wake(false);
      V.foot.flushNote();
    });

    ctx.onState((st, reason) => {
      const a = S().active;
      if (!a || a.id !== V.activeId) { ctx.go('workout', {}, { replace: true }); return; }
      if (reasonHas(reason, ['settings'])) {
        if (units() !== V.units) { ctx.rerender(); return; }
        wake(S().settings.keepAwake !== false);
      }
      if (reasonHas(reason, ['workout', 'set', 'rest', 'library', 'settings', 'plan', 'session', 'finish'])) syncAll(V);
    });
  }

  function syncAll(V) {
    const a = S().active;
    if (!a) return;
    syncBar(V, a);
    syncCards(V, a);
    syncNext(V, a);
    V.foot.sync(a);
  }

  /* ---------------------------------------------------------------- sticky console + barbell */

  function buildBar(V) {
    const b = {};
    b.title = h('h2.wo-bar__title#wo-title');
    b.clock = h('span.wo-bar__clock.num', { attrs: { 'aria-label': 'Elapsed time' } }, '0:00');
    b.count = h('span.wo-bar__count.num');
    b.since = h('span.wo-bar__since');
    b.bb = buildBarbell();
    b.el = h('div.wo-bar',
      h('div.wo-bar__row',
        b.title,
        h('button.btn.btn--ghost.btn--icon.wo-bar__more', {
          type: 'button', 'aria-label': 'Workout options', onClick: () => barMenu(V)
        }, ic('more', 22))),
      h('div.wo-bar__row.wo-bar__row--sub',
        h('p.wo-bar__stats',
          h('span.wo-bar__live', { attrs: { 'aria-hidden': 'true' } }),
          b.clock, b.since,
          h('span.wo-bar__sep', { attrs: { 'aria-hidden': 'true' } }, '·'),
          b.count),
        h('button.btn.btn--primary.wo-bar__finish', { type: 'button', onClick: () => finish(V) }, ic('check', 20), 'Finish')),
      b.bb.el);
    return b;
  }

  function buildBarbell() {
    const L = h('span.wo-bb__sleeve.is-left');
    const R = h('span.wo-bb__sleeve.is-right');
    const el = h('div.wo-bb', { attrs: { role: 'img', 'aria-label': 'Barbell progress' } },
      h('span.wo-bb__cap.is-left'), L, h('span.wo-bb__collar'),
      h('span.wo-bb__shaft', h('span.wo-bb__knurl')),
      h('span.wo-bb__collar'), R, h('span.wo-bb__cap.is-right'));
    return { el, L, R, left: [], right: [], ids: new Set(), total: -1 };
  }

  function tickClock(V) {
    const a = S().active;
    if (!a || !V.alive) return;
    V.bar.clock.textContent = U().fmtClock((Date.now() - a.startedAt) / 1000);
  }

  function syncBar(V, a) {
    const b = V.bar;
    const u = U();
    if (b.title.textContent !== a.title) b.title.textContent = a.title;
    tickClock(V);
    const rel = u.fmtRelDay(a.date);
    const since = a.date !== u.todayISO() ? ' · since ' + (rel === 'Yesterday' ? 'yesterday' : u.fmtDate(a.date, 'dm')) : '';
    if (b.since.textContent !== since) b.since.textContent = since;

    // plates: done sets in completion order, alternating left / right from the collars out
    const done = [];
    let total = 0;
    for (const e of a.exercises) {
      const plate = plateOf(exOf(e.exId).muscle);
      for (const s of e.sets) { total++; if (s.done) done.push({ id: s.id, at: s.at || 0, plate }); }
    }
    done.sort((x, y) => x.at - y.at);
    const bb = b.bb;
    const nL = Math.ceil(total / 2);
    const nR = Math.floor(total / 2);
    const fit = (arr, host, n) => {
      while (arr.length < n) { const p = h('i.wo-bb__plate'); arr.push(p); host.appendChild(p); }
      while (arr.length > n) arr.pop().remove();
    };
    fit(bb.left, bb.L, nL);
    fit(bb.right, bb.R, nR);
    let fresh = false;
    const ids = new Set();
    for (let k = 0; k < total; k++) {
      const slot = k % 2 ? bb.right[Math.floor(k / 2)] : bb.left[Math.floor(k / 2)];
      if (!slot) continue;
      const d = done[k];
      if (d) {
        ids.add(d.id);
        slot.dataset.plate = d.plate;
        slot.classList.add('is-on');
        if (!V.initial && !bb.ids.has(d.id)) { replay(slot, 'is-new'); fresh = true; }
      } else {
        delete slot.dataset.plate;
        slot.classList.remove('is-on', 'is-new');
      }
    }
    bb.ids = ids;
    if (fresh) replay(bb.el, 'is-clank');
    const full = total > 0 && done.length === total;
    bb.el.classList.toggle('is-full', full);
    bb.el.setAttribute('aria-label', done.length + ' of ' + plural(total, 'set') + ' done');
    const countText = total ? (full ? 'All ' + total + ' sets done' : done.length + '/' + total + ' sets') : 'No sets yet';
    if (b.count.textContent !== countText) {
      b.count.textContent = countText;
      if (!V.initial) replay(b.count, 'is-bump');
    }
    b.count.classList.toggle('is-full', full);
  }

  function barMenu(V) {
    const a = S().active;
    if (!a) return;
    F.ui.menu([
      { label: 'Add exercise', icon: 'plus', onClick: () => openAddExercise() },
      { label: 'Rename workout', icon: 'edit', onClick: () => renameWorkout() },
      {
        label: '3-2-1 lead-in for holds: ' + (leadIn() ? 'on' : 'off'), icon: 'timer',
        hint: 'Countdown beeps before the HOLD stopwatch starts',
        onClick: () => {
          const next = !leadIn();
          U().storage.set(LEADIN_KEY, next);
          F.ui.toast('Hold lead-in ' + (next ? 'on: 3-2-1 beeps first' : 'off: starts instantly'), { icon: 'timer' });
        }
      },
      { label: 'Discard workout', icon: 'trash', danger: true, onClick: () => discard(V, false) }
    ], { title: a.title });
  }

  function renameWorkout() {
    const a = S().active;
    if (!a) return;
    F.ui.prompt({ title: 'Rename workout', label: 'Workout name', value: a.title, confirmLabel: 'Save' })
      .then((v) => { if (v) F.store.setActiveField('title', v); });
  }

  /* ---------------------------------------------------------------- exercise cards */

  function syncCards(V, a) {
    const list = a.exercises;
    const ids = new Set(list.map((e) => e.id));
    for (const [id, card] of V.cards) {
      if (!ids.has(id)) { V.cards.delete(id); clearTimeout(card.timer); leaveEl(card.el); }
    }
    const beforeOrder = Array.from(V.cards.keys());
    const nowOrder = list.map((e) => e.id).filter((id) => V.cards.has(id));
    const moved = !V.initial && beforeOrder.length > 1 && beforeOrder.join() !== nowOrder.join();
    const rects = moved ? new Map(Array.from(V.cards).map(([id, c]) => [id, c.el.getBoundingClientRect().top])) : null;

    let cursor = null;
    list.forEach((entry, i) => {
      let card = V.cards.get(entry.id);
      if (card && card.exId !== entry.exId) { // swapped: rebuild in place
        const fresh = buildCard(V, entry);
        clearTimeout(card.timer);
        card.el.replaceWith(fresh.el);
        V.cards.set(entry.id, fresh);
        card = fresh;
        replay(card.el, 'is-swapped');
      } else if (!card) {
        card = buildCard(V, entry);
        V.cards.set(entry.id, card);
        if (!V.initial) card.el.classList.add('is-entering');
      }
      card.el.style.setProperty('--i', String(Math.min(i, 14)));
      syncCard(V, card, entry, i, list.length);
      place(V.list, card.el, cursor);
      cursor = card.el;
    });
    // keep the Map in display order
    const ordered = new Map();
    for (const e of list) if (V.cards.has(e.id)) ordered.set(e.id, V.cards.get(e.id));
    V.cards = ordered;

    if (rects && !reduced()) {
      for (const [id, top] of rects) {
        const c = V.cards.get(id);
        if (!c) continue;
        const dy = top - c.el.getBoundingClientRect().top;
        if (Math.abs(dy) > 2) {
          try { c.el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch (_) { /* ignore */ }
        }
      }
    }

    // empty workout
    V.el.classList.toggle('is-empty', !list.length);
    if (!list.length) {
      if (!V.emptyHost.firstChild) {
        V.emptyHost.appendChild(F.ui.empty({
          icon: 'dumbbell',
          title: 'Empty bar',
          text: 'Add your first exercise: dumbbells, bench or pure calisthenics. Sets, weights and the rest timer are ready when you are.',
          action: { label: 'Add exercise', icon: 'plus', onClick: () => openAddExercise() }
        }));
      }
    } else if (V.emptyHost.firstChild) {
      U().clear(V.emptyHost);
    }

    if (mem.scrollTo) {
      const c = V.cards.get(mem.scrollTo);
      mem.scrollTo = null;
      if (c) setTimeout(() => scrollIntoViewSoft(c.el, 'start'), 60);
    }
  }

  /** Put el right after `cursor` (or first) inside container, skipping elements on their way out. */
  function place(container, el, cursor) {
    let expected = cursor ? cursor.nextElementSibling : container.firstElementChild;
    while (expected && expected.classList.contains('is-leaving')) expected = expected.nextElementSibling;
    if (expected === el) return;
    container.insertBefore(el, cursor ? cursor.nextSibling : container.firstChild);
  }

  function leaveEl(el) {
    if (!el || !el.parentNode) return;
    if (reduced() || typeof el.animate !== 'function') { el.remove(); return; }
    el.classList.add('is-leaving');
    el.setAttribute('inert', '');
    const hgt = el.offsetHeight;
    try {
      const anim = el.animate([
        { height: hgt + 'px', opacity: 1 },
        { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }
      ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
      anim.onfinish = () => el.remove();
      setTimeout(() => el.remove(), 600);
    } catch (_) { el.remove(); }
  }

  function buildCard(V, entry) {
    const ex = exOf(entry.exId);
    const type = typeOf(ex);
    const plate = plateOf(ex.muscle);
    const nameId = 'wo-ex-' + entry.id;
    const c = {
      id: entry.id, exId: entry.exId, ex, type, plate, rows: new Map(),
      headSig: null, doneSig: null, complete: null, collapsed: false, timer: 0, index: 0
    };
    try { c.lastPerf = F.q.lastPerformance(entry.exId); } catch (_) { c.lastPerf = null; }
    c.pt = U().parseTarget(entry.target);

    c.num = h('span.wo-ex__num', { attrs: { 'aria-hidden': 'true' } }, '01');
    c.meta = h('p.wo-ex__meta');
    c.nameBtn = h('button.wo-ex__name', {
      type: 'button', id: nameId, title: ex.missing ? 'Not in your library' : 'How to do it',
      onClick: () => F.picker.info(c.exId)
    }, ex.name);
    c.moreBtn = h('button.btn.btn--ghost.btn--icon.wo-ex__more', {
      type: 'button', 'aria-label': 'Options for ' + ex.name, onClick: () => cardMenu(V, c)
    }, ic('more', 22));

    c.sumText = h('span.wo-ex__sumtext');
    c.summary = h('button.wo-ex__summary', { type: 'button', onClick: () => expand(V, c, true) },
      h('span.wo-ex__sumcheck', ic('check', 16)),
      c.sumText,
      h('span.wo-ex__stamp', { attrs: { 'aria-hidden': 'true' } }, 'Done'),
      h('span.wo-ex__sumopen', ic('chevron-down', 18)));
    c.sumWrap = h('div.wo-ex__sumwrap', h('div.wo-ex__clip', c.summary));

    c.last = h('p.wo-ex__last');
    c.note = h('p.wo-ex__note');
    c.rowsEl = h('div.wo-sets__rows');
    const u = units();
    const headCells = type === 'time'
      ? [h('span.wo-sets__c', 'Set'), h('span.wo-sets__c', 'Prev'), h('span.wo-sets__c.wo-span2', 'Seconds'), h('span.wo-sets__c.wo-sets__ok', ic('check', 16))]
      : [h('span.wo-sets__c', 'Set'), h('span.wo-sets__c', 'Prev'), h('span.wo-sets__c', (type === 'bodyweight' ? '+' : '') + u),
        h('span.wo-sets__c', 'Reps'), h('span.wo-sets__c.wo-sets__ok', ic('check', 16))];
    c.table = h('div.wo-sets', { dataset: { type } }, h('div.wo-sets__head', { attrs: { 'aria-hidden': 'true' } }, headCells), c.rowsEl);

    const cues = Array.isArray(ex.cues) ? ex.cues.filter((x) => typeof x === 'string' && x.trim()) : [];
    c.cuesPanel = cues.length ? h('ol.wo-ex__cues', cues.slice(0, 6).map((t) => h('li', t))) : null;
    c.cuesBtn = cues.length ? h('button.btn.btn--ghost.btn--sm.wo-ex__cuesbtn', {
      type: 'button', 'aria-expanded': 'false', onClick: () => toggleCues(c)
    }, ic('target', 16), 'Cues', ic('chevron-down', 14, 'wo-ex__chev')) : null;

    c.foot = h('div.wo-ex__foot',
      h('button.btn.btn--secondary.btn--sm.wo-ex__add', { type: 'button', onClick: () => addSet(V, c) }, ic('plus', 16), 'Add set'),
      h('div.wo-ex__tools',
        c.cuesBtn,
        h('button.btn.btn--ghost.btn--sm.wo-ex__swap', { type: 'button', onClick: () => swapEx(V, c), 'aria-label': 'Swap ' + ex.name }, ic('repeat', 16), 'Swap')));

    c.inner = h('div.wo-ex__inner', c.last, c.note, c.table, c.foot, c.cuesPanel ? h('div.wo-ex__cueswrap', h('div.wo-ex__clip', c.cuesPanel)) : null);
    c.body = h('div.wo-ex__body', h('div.wo-ex__clip', c.inner));

    c.el = h('article.card.wo-ex', {
      dataset: { plate, type, entry: entry.id },
      class: ex.missing ? 'is-missing' : null,
      attrs: { 'aria-labelledby': nameId }
    },
    h('header.wo-ex__head', c.num,
      h('div.wo-ex__titles', h('h3.wo-ex__h', c.nameBtn), c.meta),
      c.moreBtn),
    c.sumWrap,
    c.body);
    c.sumWrap.setAttribute('inert', '');
    if (c.cuesPanel) setCues(c, mem.cues.has(entry.id));
    return c;
  }

  function syncCard(V, c, entry, i, n) {
    c.index = i;
    c.count = n;
    const num = pad2(i + 1);
    if (c.num.textContent !== num) c.num.textContent = num;

    // header meta + notes (cheap signature)
    const rest = restOf(entry);
    const headSig = [entry.sets.length, entry.target, rest, entry.note].join('|');
    if (headSig !== c.headSig) {
      c.headSig = headSig;
      c.pt = U().parseTarget(entry.target);
      fill(c.meta,
        h('span.wo-ex__target', targetText(entry)),
        h('span.wo-ex__rest', ic('timer', 14), rest ? U().fmtClock(rest) : 'No rest'),
        c.ex.calisthenics ? h('span.wo-ex__tag', ic('body', 13), 'Calisthenics') : null,
        c.ex.missing ? h('span.badge.badge--warn', 'Not in library') : null);
      const note = str(entry.note);
      c.note.hidden = !note;
      U().clear(c.note);
      if (note) c.note.append(ic('note', 15), h('span', note));
      renderLast(c);
    }

    // set rows (keyed by set id)
    const prevSets = (c.lastPerf && Array.isArray(c.lastPerf.sets)) ? c.lastPerf.sets : [];
    const seen = new Set(entry.sets.map((s) => s.id));
    for (const [id, row] of c.rows) if (!seen.has(id)) { c.rows.delete(id); leaveEl(row.el); }
    let cursor = null;
    entry.sets.forEach((set, j) => {
      let row = c.rows.get(set.id);
      if (!row) {
        row = buildRow(V, c, set);
        c.rows.set(set.id, row);
        if (!V.initial && c.built) row.el.classList.add('is-entering');
      }
      syncRow(V, c, row, set, j, prevSets[j] || null);
      place(c.rowsEl, row.el, cursor);
      cursor = row.el;
    });
    c.built = true;

    // PR marks: only when this card's logged numbers changed
    const doneSig = entry.sets.filter((s) => s.done).map((s) => s.id + ':' + s.w + ':' + s.r + ':' + s.t).join(',');
    if (doneSig !== c.doneSig) {
      c.doneSig = doneSig;
      for (const set of entry.sets) {
        const row = c.rows.get(set.id);
        if (!row) continue;
        let pr = null;
        if (set.done) { try { pr = F.q.checkPR(c.exId, set, { exclude: set.id }); } catch (_) { pr = null; } }
        row.el.classList.toggle('is-pr', !!pr);
        row.num.title = pr ? 'Personal record: ' + prShort(pr) : '';
      }
    }

    // completion → grey out + collapse to a summary line with a DONE stamp
    const complete = entry.sets.length > 0 && entry.sets.every((s) => s.done);
    if (complete) c.sumText.textContent = plural(entry.sets.length, 'set') + ' · ' + fmtSetsLine(entry.sets, c.type);
    c.summary.setAttribute('aria-label', c.ex.name + ' complete, ' + c.sumText.textContent + '. Show sets');
    if (complete !== c.complete) {
      const was = c.complete;
      c.complete = complete;
      c.el.classList.toggle('is-complete', complete);
      clearTimeout(c.timer);
      if (!complete) {
        mem.expanded.delete(c.id);
        setCollapsed(c, false);
      } else if (!mem.expanded.has(c.id)) {
        if (was === null || V.initial) setCollapsed(c, true);
        else {
          c.timer = setTimeout(() => {
            if (!c.complete || mem.expanded.has(c.id) || !c.el.isConnected) return;
            const ae = document.activeElement;
            const inside = !!(ae && c.body.contains(ae));
            if (inside && ae.matches('input, textarea')) return; // still typing here
            setCollapsed(c, true);
            if (inside) { try { c.summary.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
          }, 900);
        }
      }
    }
  }

  function renderLast(c) {
    U().clear(c.last);
    const lp = c.lastPerf;
    if (lp && Array.isArray(lp.sets) && lp.sets.length) {
      c.last.append(h('span.wo-ex__lastlabel', 'Last'), h('span.wo-ex__lastval', fmtSetsLine(lp.sets, c.type)),
        h('span.wo-ex__lastdate', U().fmtRelDay(lp.date)));
    } else {
      c.last.append(h('span.wo-ex__lastlabel.is-first', 'First time'), h('span.wo-ex__lastval.is-first', 'Today sets your baseline.'));
    }
  }

  function setCollapsed(c, on) {
    if (c.collapsed === on) return;
    c.collapsed = on;
    c.el.classList.toggle('is-collapsed', on);
    if (on) { c.body.setAttribute('inert', ''); c.sumWrap.removeAttribute('inert'); } else { c.body.removeAttribute('inert'); c.sumWrap.setAttribute('inert', ''); }
  }
  function expand(V, c, focus) {
    mem.expanded.add(c.id);
    setCollapsed(c, false);
    if (focus) {
      const first = c.body.querySelector('.wo-set__check');
      if (first) { try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
    }
  }
  function setCues(c, on) {
    if (!c.cuesPanel) return;
    c.el.classList.toggle('is-cues', on);
    c.cuesBtn.setAttribute('aria-expanded', String(on));
    const wrap = c.cuesPanel.parentNode && c.cuesPanel.parentNode.parentNode;
    if (wrap) { if (on) wrap.removeAttribute('inert'); else wrap.setAttribute('inert', ''); }
  }
  function toggleCues(c) {
    const on = !mem.cues.has(c.id);
    if (on) mem.cues.add(c.id); else mem.cues.delete(c.id);
    setCues(c, on);
  }

  /* ---------------------------------------------------------------- set rows */

  function buildRow(V, c, set) {
    const r = { id: set.id, inputs: {}, n: 0, done: null };
    r.nText = h('span.wo-set__n');
    r.num = h('button.wo-set__num', { type: 'button', onClick: () => rowMenu(V, c, r) },
      r.nText, h('span.wo-set__trophy', { attrs: { 'aria-hidden': 'true' } }, ic('trophy', 12)));
    r.prev = h('button.wo-set__prev', { type: 'button', onClick: () => copyPrev(c, r) });
    let cells;
    if (c.type === 'time') {
      r.inputs.t = numInput(V, c, r, 't');
      r.holdLabel = h('span.wo-set__holdlabel', 'Hold');
      r.hold = h('button.wo-set__hold', { type: 'button', onClick: () => toggleHold(V, c, r) },
        h('span.wo-set__holdico', ic('timer', 18)), r.holdLabel);
      cells = [r.inputs.t, r.hold];
    } else {
      r.inputs.w = numInput(V, c, r, 'w');
      r.inputs.r = numInput(V, c, r, 'r');
      cells = [r.inputs.w, r.inputs.r];
    }
    r.check = h('button.wo-set__check', { type: 'button', 'aria-pressed': 'false', onClick: () => onCheck(V, c, r) }, ic('check', 26));
    r.slide = h('div.wo-set__slide', r.num, r.prev, cells, r.check);
    r.el = h('div.wo-set', { dataset: { set: set.id } },
      h('div.wo-set__bin', { attrs: { 'aria-hidden': 'true' } }, ic('trash', 18), 'Remove'),
      r.slide);
    enableSwipe(V, c, r);
    return r;
  }

  function dispVal(k, set) {
    if (k === 'w') return set.w === null || set.w === undefined ? '' : wDisp(set.w);
    const v = set[k];
    return v === null || v === undefined ? '' : String(v);
  }
  function placeholderFor(k, c, prevSet) {
    const pt = c.pt || {};
    if (k === 'w') {
      if (c.type === 'bodyweight') return 'BW';
      return prevSet && prevSet.w !== null && prevSet.w !== undefined ? wDisp(prevSet.w) : units();
    }
    if (k === 'r') {
      if (prevSet && isNum(prevSet.r)) return String(prevSet.r);
      if (pt.reps) return String(pt.reps);
      return pt.amrap ? 'max' : '0';
    }
    if (prevSet && isNum(prevSet.t)) return String(prevSet.t);
    return pt.secs ? String(pt.secs) : 'sec';
  }

  function labelRow(c, r, n) {
    const u = units();
    const name = c.ex.name;
    r.num.setAttribute('aria-label', 'Set ' + n + ' options');
    if (r.inputs.w) r.inputs.w.setAttribute('aria-label', name + ', set ' + n + (c.type === 'bodyweight' ? ', added weight in ' + u : ', weight in ' + u));
    if (r.inputs.r) r.inputs.r.setAttribute('aria-label', name + ', set ' + n + ', reps');
    if (r.inputs.t) r.inputs.t.setAttribute('aria-label', name + ', set ' + n + ', seconds');
    if (r.hold) r.hold.setAttribute('aria-label', 'Hold stopwatch for set ' + n);
  }

  function syncRow(V, c, r, set, j, prevSet) {
    const n = j + 1;
    if (r.n !== n) { r.n = n; r.nText.textContent = String(n); labelRow(c, r, n); }
    r.prevSet = prevSet;
    const holding = mem.hold && mem.hold.setId === r.id;
    for (const k of Object.keys(r.inputs)) {
      const inp = r.inputs[k];
      if (document.activeElement !== inp && !(holding && k === 't')) {
        const want = dispVal(k, set);
        if (inp.value !== want) inp.value = want;
        inp.removeAttribute('aria-invalid');
      }
      const ph = placeholderFor(k, c, prevSet);
      if (inp.placeholder !== ph) inp.placeholder = ph;
    }
    const pv = prevSet ? fmtSetShort(prevSet, c.type) : '—';
    if (r.prev.textContent !== pv) {
      r.prev.textContent = pv;
      r.prev.disabled = !prevSet;
      r.prev.setAttribute('aria-label', prevSet ? 'Last time ' + pv + '. Copy into set ' + n : 'No previous set');
    }
    const done = !!set.done;
    if (r.done !== done) {
      const was = r.done;
      r.done = done;
      r.el.classList.toggle('is-done', done);
      r.check.setAttribute('aria-pressed', String(done));
      if (was === false && done && !V.initial) replay(r.el, 'is-popped');
    }
    r.check.setAttribute('aria-label', (done ? 'Undo set ' : 'Complete set ') + n + ' of ' + c.ex.name);
    if (r.hold) syncHoldRow(r);
  }

  function numInput(V, c, r, k) {
    const inp = h('input.input.wo-in', {
      type: 'text',
      attrs: {
        inputmode: k === 'w' ? 'decimal' : 'numeric',
        enterkeyhint: 'next',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        maxlength: k === 'w' ? '7' : '5'
      },
      dataset: { k }
    });
    // Select-all on focus so a new number replaces the old one. Deferred for iOS / caret placement,
    // but skipped if the user already started typing.
    inp.addEventListener('focus', () => {
      const v0 = inp.value;
      try { inp.select(); } catch (_) { /* ignore */ }
      setTimeout(() => { if (document.activeElement === inp && inp.value === v0) { try { inp.select(); } catch (_) { /* ignore */ } } }, 0);
    });
    inp.addEventListener('input', () => guard('input', () => onInput(c, r, k, inp)));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); focusNext(V, inp); }
    });
    inp.addEventListener('blur', () => {
      const f = findSet(c.id, r.id);
      if (!f) return;
      if (mem.hold && mem.hold.setId === r.id && k === 't') return;
      const want = dispVal(k, f.set);
      if (inp.value !== want) inp.value = want;
      inp.removeAttribute('aria-invalid');
    });
    return inp;
  }

  function onInput(c, r, k, inp) {
    const raw = inp.value.trim();
    let val = null;
    if (raw !== '') {
      if (k === 'w') {
        val = /^-?\d*[.,]?\d*$/.test(raw) ? U().fromDisplayWeight(raw, units()) : null;
        if (val === null) { inp.setAttribute('aria-invalid', 'true'); return; }
      } else if (k === 'r') {
        if (!/^\d{1,4}$/.test(raw)) { inp.setAttribute('aria-invalid', 'true'); return; }
        val = parseInt(raw, 10);
      } else {
        val = parseSecs(raw);
        if (val === null) { inp.setAttribute('aria-invalid', 'true'); return; }
      }
    }
    inp.removeAttribute('aria-invalid');
    F.store.updateSet(c.id, r.id, { [k]: val });
  }

  function focusNext(V, inp) {
    const all = Array.from(V.el.querySelectorAll('.wo-in')).filter((x) => !x.closest('[inert]'));
    const i = all.indexOf(inp);
    const next = i >= 0 ? all[i + 1] : null;
    if (next) {
      try { next.focus({ preventScroll: true }); } catch (_) { next.focus(); }
      const rect = next.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 120 || rect.top < 180) scrollIntoViewSoft(next, 'center');
    } else {
      inp.blur();
    }
  }

  function numFromPlaceholder(ph) {
    return /^\d+(\.\d+)?$/.test(String(ph || '')) ? Number(ph) : null;
  }

  function onCheck(V, c, r) {
    guard('check', () => {
      const f = findSet(c.id, r.id);
      if (!f) return;
      if (!f.set.done) {
        // Empty fields take the ghost value (last time / target), like the gym-notebook habit.
        const patch = {};
        if (c.type === 'time') {
          if (!isNum(f.set.t)) {
            const p = numFromPlaceholder(r.inputs.t.placeholder);
            if (p === null) { needValue(r.inputs.t); return; }
            patch.t = p;
          }
        } else {
          if (!isNum(f.set.r)) {
            const p = numFromPlaceholder(r.inputs.r.placeholder);
            if (p === null) { needValue(r.inputs.r); return; }
            patch.r = p;
          }
          if (c.type === 'weight' && !isNum(f.set.w)) {
            const p = numFromPlaceholder(r.inputs.w.placeholder);
            if (p !== null) patch.w = U().fromDisplayWeight(p, units());
          }
        }
        if (Object.keys(patch).length) F.store.updateSet(c.id, r.id, patch);
      }
      if (r.el.contains(document.activeElement) && document.activeElement !== r.check) {
        try { document.activeElement.blur(); } catch (_) { /* ignore */ }
      }
      if (mem.hold && mem.hold.setId === r.id) { mem.hold = null; saveHold(); syncHoldRow(r); }
      const res = F.store.toggleSet(c.id, r.id);
      if (res.done) {
        U().haptic(16);
        if (res.pr) celebratePR(res.pr, c);
      } else {
        U().haptic(8);
      }
    });
  }

  function needValue(inp) {
    replay(inp, 'is-shake');
    U().haptic([20, 40, 20]);
    try { inp.focus(); } catch (_) { /* ignore */ }
    F.ui.toast(inp.dataset.k === 't' ? 'How long? Type the seconds or use HOLD, then tick the set.' : 'How many reps? Type them in, then tick the set.', { type: 'warn', duration: 2600 });
  }

  function celebratePR(pr, c) {
    F.ui.celebrate({ title: 'NEW PR', subtitle: c.ex.name + ' · ' + prShort(pr), icon: 'trophy', plate: c.plate });
    U().beep('pr');
    F.ui.toast(prText(pr, c.ex), { type: 'pr', icon: 'trophy' });
  }

  function copyPrev(c, r) {
    const p = r.prevSet;
    if (!p) return;
    const patch = c.type === 'time' ? { t: p.t } : { w: p.w, r: p.r };
    F.store.updateSet(c.id, r.id, patch);
    U().haptic(8);
    for (const k of Object.keys(r.inputs)) replay(r.inputs[k], 'is-filled');
  }

  function addSet(V, c) {
    const set = F.store.addSet(c.id);
    if (!set) { F.ui.toast('That exercise already has the maximum number of sets', { type: 'warn' }); return; }
    U().haptic(10);
  }

  function removeSetUndo(c, setId) {
    const f = findSet(c.id, setId);
    if (!f) return;
    const snap = U().clone(f.set);
    const idx = f.index;
    F.store.removeSet(c.id, setId);
    U().haptic(12);
    F.ui.toast('Set ' + (idx + 1) + ' removed from ' + c.ex.name, {
      icon: 'trash',
      action: { label: 'Undo', onClick: () => restoreSet(c.id, snap, idx) }
    });
  }
  /** Undo for removeSet (no insertSet in the store): re-insert the entry with the set spliced back. */
  function restoreSet(entryId, set, idx) {
    const a = S().active;
    if (!a) return;
    const ei = a.exercises.findIndex((e) => e.id === entryId);
    if (ei < 0) return;
    const entry = U().clone(a.exercises[ei]);
    if (entry.sets.some((s) => s.id === set.id)) return;
    entry.sets.splice(Math.min(idx, entry.sets.length), 0, set);
    const rest = a.rest ? U().clone(a.rest) : null;
    F.store.removeExerciseFromActive(entryId);
    F.store.insertExerciseToActive(entry, ei);
    const now = S().active;
    if (rest && now && !now.rest && rest.endsAt > Date.now()) F.store.setRest(rest);
  }

  function rowMenu(V, c, r) {
    const f = findSet(c.id, r.id);
    if (!f) return;
    const n = f.index + 1;
    const above = f.index > 0 ? f.entry.sets[f.index - 1] : null;
    F.ui.menu([
      r.prevSet && { label: 'Use last time (' + fmtSetShort(r.prevSet, c.type) + ')', icon: 'undo', onClick: () => copyPrev(c, r) },
      above && {
        label: 'Copy set ' + (n - 1) + ' (' + fmtSetShort(above, c.type) + ')', icon: 'copy',
        onClick: () => { F.store.updateSet(c.id, r.id, c.type === 'time' ? { t: above.t } : { w: above.w, r: above.r }); for (const k of Object.keys(r.inputs)) replay(r.inputs[k], 'is-filled'); }
      },
      { label: 'Remove set ' + n, icon: 'trash', danger: true, hint: 'Tip: swipe a set left to remove it', onClick: () => removeSetUndo(c, r.id) }
    ], { title: c.ex.name + ' · Set ' + n });
  }

  /** Swipe a set row left to remove it (touch, pen or mouse drag). */
  function enableSwipe(V, c, r) {
    const el = r.el;
    let sx = 0; let sy = 0; let dx = 0; let pid = null; let active = false; let swiped = 0;
    const W = () => el.offsetWidth || 320;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || c.collapsed) return;
      if (e.target.closest('input') && document.activeElement === e.target) return; // editing text: let selection work
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = 0; active = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      const mx = e.clientX - sx; const my = e.clientY - sy;
      if (!active) {
        if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { pid = null; return; }
        if (mx < -14 && Math.abs(mx) > Math.abs(my) * 1.4) {
          active = true;
          try { el.setPointerCapture(pid); } catch (_) { /* ignore */ }
          el.classList.add('is-swiping');
        } else return;
      }
      dx = Math.min(0, mx);
      r.slide.style.transform = 'translate3d(' + dx + 'px,0,0)';
      el.classList.toggle('is-armed', dx < -Math.min(110, W() * 0.32));
    });
    const end = (e) => {
      if (pid === null || (e && e.pointerId !== pid)) return;
      pid = null;
      if (!active) return;
      active = false;
      swiped = Date.now();
      el.classList.remove('is-swiping');
      if (dx < -Math.min(110, W() * 0.32)) {
        el.classList.add('is-removing');
        r.slide.style.transform = 'translate3d(' + (-W()) + 'px,0,0)';
        setTimeout(() => removeSetUndo(c, r.id), reduced() ? 0 : 160);
      } else {
        el.classList.remove('is-armed');
        el.classList.add('is-settling');
        r.slide.style.transform = '';
        setTimeout(() => el.classList.remove('is-settling'), 280);
      }
      dx = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    // a swipe must not also count as a tap on the button under the finger
    el.addEventListener('click', (e) => { if (Date.now() - swiped < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  /* ---------------------------------------------------------------- HOLD stopwatch (timed sets) */

  let holdTimer = 0;
  let holdView = null;
  function startHoldTicker(V) {
    holdView = V;
    if (!holdTimer) holdTimer = setInterval(holdTick, 200);
    holdTick();
  }
  function stopHoldTicker() {
    clearInterval(holdTimer);
    holdTimer = 0;
    holdView = null;
  }
  function holdRow(V) {
    const hd = mem.hold;
    const c = hd && V && V.cards.get(hd.entryId);
    return c ? { c, r: c.rows.get(hd.setId) } : null;
  }
  function holdTick() {
    const V = holdView;
    const hd = mem.hold;
    if (!hd || !V || !V.alive) { stopHoldTicker(); return; }
    const found = holdRow(V);
    if (!found || !found.r) { mem.hold = null; saveHold(); stopHoldTicker(); return; }
    const now = Date.now();
    if (now < hd.t0) {
      const n = Math.ceil((hd.t0 - now) / 1000);
      if (hd.lastN !== n) { hd.lastN = n; U().beep('tick'); U().haptic(10); }
    } else {
      if (hd.phase !== 'run') { hd.phase = 'run'; U().beep('done'); U().haptic(30); }
      const secs = Math.floor((now - hd.t0) / 1000);
      const inp = found.r.inputs.t;
      if (inp && document.activeElement !== inp && inp.value !== String(secs)) inp.value = String(secs);
      if (hd.target && secs >= hd.target && !hd.hit) { hd.hit = true; saveHold(); U().beep('end'); U().haptic([60, 60, 60]); }
    }
    syncHoldRow(found.r);
  }
  function syncHoldRow(r) {
    if (!r.hold) return;
    const hd = mem.hold && mem.hold.setId === r.id ? mem.hold : null;
    const now = Date.now();
    const counting = !!hd && now < hd.t0;
    const running = !!hd && now >= hd.t0;
    r.el.classList.toggle('is-holding', !!hd);
    r.el.classList.toggle('is-counting', counting);
    r.el.classList.toggle('is-hit', !!(hd && hd.hit));
    let label = 'Hold';
    if (counting) label = String(Math.ceil((hd.t0 - now) / 1000));
    else if (running) label = U().fmtClock((now - hd.t0) / 1000);
    if (r.holdLabel.textContent !== label) r.holdLabel.textContent = label;
    r.hold.setAttribute('aria-pressed', String(!!hd));
    r.hold.setAttribute('aria-label', hd ? (counting ? 'Get ready. Tap to cancel' : 'Holding ' + label + '. Tap to stop and log') : 'Start hold stopwatch for set ' + r.n);
  }
  function toggleHold(V, c, r) {
    guard('hold', () => {
      const hd = mem.hold;
      if (hd && hd.setId === r.id) {
        mem.hold = null;
        saveHold();
        if (Date.now() < hd.t0) { syncHoldRow(r); stopHoldTicker(); return; } // cancelled during the lead-in
        const secs = Math.max(1, Math.round((Date.now() - hd.t0) / 1000));
        stopHoldTicker();
        F.store.updateSet(c.id, r.id, { t: secs });
        syncHoldRow(r);
        const f = findSet(c.id, r.id);
        if (f && !f.set.done) {
          const res = F.store.toggleSet(c.id, r.id);
          U().haptic(16);
          if (res.pr) celebratePR(res.pr, c);
        }
        return;
      }
      if (hd) { // one stopwatch at a time: cancel the other
        const other = holdRow(V);
        mem.hold = null;
        if (other && other.r) syncHoldRow(other.r);
      }
      const f = findSet(c.id, r.id);
      if (f && f.set.done) F.store.toggleSet(c.id, r.id); // re-timing a logged hold
      const lead = leadIn() ? 3 : 0;
      mem.hold = { entryId: c.id, setId: r.id, t0: Date.now() + lead * 1000, phase: lead ? 'count' : 'run', target: (c.pt && c.pt.secs) || null, lastN: null, hit: false };
      saveHold();
      if (!lead) { U().beep('done'); U().haptic(30); }
      if (document.activeElement === r.inputs.t) r.inputs.t.blur();
      startHoldTicker(V);
    });
  }

  /* ---------------------------------------------------------------- exercise actions */

  function openAddExercise() {
    F.picker.open({
      title: 'Add exercises',
      multi: true,
      onPick: (ids) => guard('add exercise', () => {
        const added = [];
        for (const id of Array.isArray(ids) ? ids : []) { const e = F.store.addExerciseToActive(id); if (e) added.push(e); }
        if (!added.length) return;
        mem.scrollTo = added[0].id;
        F.ui.toast(added.length === 1 ? exOf(added[0].exId).name + ' added' : plural(added.length, 'exercise') + ' added', { type: 'ok' });
      })
    });
  }

  function cardMenu(V, c) {
    const a = S().active;
    const i = a ? a.exercises.findIndex((e) => e.id === c.id) : -1;
    if (i < 0) return;
    const entry = a.exercises[i];
    const n = a.exercises.length;
    F.ui.menu([
      { label: 'Swap exercise', icon: 'repeat', hint: 'Calisthenics or dumbbell variation', onClick: () => swapEx(V, c) },
      { label: 'How to do it', icon: 'info', onClick: () => F.picker.info(c.exId) },
      { label: str(entry.note) ? 'Edit note' : 'Add note', icon: 'note', onClick: () => editNote(c) },
      { label: 'Move up', icon: 'arrow-up', disabled: i === 0, onClick: () => moveEx(c, i - 1) },
      { label: 'Move down', icon: 'arrow-down', disabled: i >= n - 1, onClick: () => moveEx(c, i + 1) },
      { label: 'Remove exercise', icon: 'trash', danger: true, onClick: () => removeEx(c) }
    ], { title: c.ex.name });
  }

  function moveEx(c, to) {
    F.store.moveActiveExercise(c.id, to);
    mem.scrollTo = c.id;
    U().haptic(8);
  }

  function editNote(c) {
    const a = S().active;
    const entry = a && a.exercises.find((e) => e.id === c.id);
    if (!entry) return;
    F.ui.prompt({ title: str(entry.note) ? 'Edit note' : 'Add note', label: c.ex.name, value: entry.note || '', placeholder: 'e.g. bench on notch 3, slow negatives', confirmLabel: 'Save' })
      .then((v) => { if (v !== null) F.store.setExerciseNote(c.id, v); });
  }

  function removeEx(c) {
    const res = F.store.removeExerciseFromActive(c.id);
    if (!res) return;
    const snap = U().clone(res.entry);
    U().haptic(12);
    F.ui.toast(c.ex.name + ' removed', {
      icon: 'trash',
      action: { label: 'Undo', onClick: () => F.store.insertExerciseToActive(snap, res.index) }
    });
  }

  function swapEx(V, c) {
    F.picker.swap(c.exId, {
      onPick: (newId) => guard('swap', () => {
        const a = S().active;
        const i = a ? a.exercises.findIndex((e) => e.id === c.id) : -1;
        if (i < 0) return;
        const snap = U().clone(a.exercises[i]);
        const res = F.store.swapActiveExercise(c.id, newId);
        if (!res) return;
        U().haptic(12);
        F.ui.toast('Swapped to ' + exOf(newId).name, {
          icon: 'repeat',
          action: {
            label: 'Undo',
            onClick: () => {
              const cur = S().active;
              const j = cur ? cur.exercises.findIndex((e) => e.id === snap.id) : -1;
              if (j < 0) return;
              F.store.removeExerciseFromActive(snap.id);
              F.store.insertExerciseToActive(snap, j);
            }
          }
        });
      })
    });
  }

  /* ---------------------------------------------------------------- next-set marker */

  function syncNext(V, a) {
    const nx = nextUp(a);
    const id = nx ? nx.set.id : null;
    if (id === V.nextId) return;
    const mark = (setId, on) => {
      if (!setId) return;
      for (const c of V.cards.values()) { const r = c.rows.get(setId); if (r) { r.el.classList.toggle('is-next', on); return; } }
    };
    mark(V.nextId, false);
    mark(id, true);
    V.nextId = id;
  }

  /* ---------------------------------------------------------------- bottom: add, notes, finish */

  function buildFoot(V) {
    const f = {};
    f.note = h('textarea.textarea.wo-note#wo-note', { rows: 3, placeholder: 'How it’s going, weights to bump next time, how the joints feel…' });
    const save = U().debounce(() => { if (S().active) F.store.setActiveField('note', f.note.value); }, 600);
    f.note.addEventListener('input', save);
    f.note.addEventListener('blur', () => save.flush());
    f.el = h('div.wo-foot',
      h('button.wo-addex', { type: 'button', onClick: () => openAddExercise() },
        h('span.wo-addex__plus', ic('plus', 26)),
        h('span.wo-addex__main',
          h('span.wo-addex__title', 'Add exercise'),
          h('span.wo-addex__sub', 'Dumbbells, bar, bench or pure calisthenics'))),
      h('div.card.wo-notecard',
        h('label.wo-notecard__label', { for: 'wo-note' }, ic('note', 16), 'Workout notes'),
        f.note),
      h('div.wo-finishbox',
        h('button.btn.btn--primary.btn--lg.btn--block.wo-finish', { type: 'button', onClick: () => finish(V) }, ic('check-circle', 22), 'Finish workout'),
        h('button.btn.btn--ghost.btn--sm.wo-discard', { type: 'button', onClick: () => discard(V, false) }, ic('trash', 16), 'Discard workout')));
    f.sync = (a) => {
      if (document.activeElement !== f.note && !save.pending() && f.note.value !== (a.note || '')) f.note.value = a.note || '';
    };
    f.flushNote = () => save.flush();
    return f;
  }

  function discard(V, skipConfirm) {
    const run = () => {
      mem.hold = null;
      saveHold();
      stopHoldTicker();
      F.store.discardWorkout();
      wake(false);
      mem.expanded.clear();
      F.ui.toast('Workout discarded', { icon: 'trash' });
      if (V.ctx.isActive()) V.ctx.go('workout', {}, { replace: true });
    };
    if (skipConfirm) { run(); return; }
    F.ui.confirm({
      title: 'Discard this workout?',
      message: 'Every set logged in this session will be deleted. This can’t be undone.',
      confirmLabel: 'Discard', cancelLabel: 'Keep training', danger: true
    }).then((ok) => { if (ok) run(); });
  }

  function finish(V) {
    V.foot.flushNote();
    const a = S().active;
    if (!a) return;
    let done = 0; let open = 0;
    for (const e of a.exercises) for (const s of e.sets) { if (s.done) done++; else open++; }
    if (!done) {
      F.ui.confirm({
        title: 'Nothing logged yet',
        message: 'Tick at least one set to save this workout. Or discard it and nothing is kept.',
        confirmLabel: 'Discard workout', cancelLabel: 'Keep training', danger: true
      }).then((ok) => { if (ok) discard(V, true); });
      return;
    }
    const doFinish = () => guard('finish', () => {
      mem.hold = null;
      saveHold();
      stopHoldTicker();
      const res = F.store.finishWorkout();
      if (!res) { F.ui.toast('Could not save this workout', { type: 'error' }); return; }
      wake(false);
      mem.expanded.clear();
      mem.cues.clear();
      if (V.ctx.isActive()) V.ctx.go('workout', {}, { replace: true });
      showSummary(res);
    });
    if (open) {
      F.ui.confirm({
        title: 'Finish workout?',
        message: 'Finish with ' + plural(open, 'set') + ' unchecked? They won’t be saved.',
        confirmLabel: 'Finish', cancelLabel: 'Keep training'
      }).then((ok) => { if (ok) doFinish(); });
    } else doFinish();
  }

  /* ---------------------------------------------------------------- summary sheet */

  function showSummary(res) {
    const u = U();
    const session = res.session;
    let stats = res.stats;
    if (!stats) { try { stats = F.q.sessionStats(session); } catch (_) { stats = { volume: 0, sets: 0, reps: 0, durationSec: 0, exercises: 0, byMuscle: {} }; } }
    const prs = Array.isArray(res.prs) ? res.prs : [];
    const by = stats.byMuscle || {};
    const muscles = Object.keys(by).sort((x, y) => by[y] - by[x]);
    const plate = muscles.length ? plateOf(muscles[0]) : 'red';

    F.ui.celebrate({ title: 'WORKOUT DONE', subtitle: session.title, icon: 'trophy', plate });
    u.beep('done');

    let feeling = session.feeling || null;
    const noteEl = h('textarea.textarea.wo-sum__note#wo-sum-note', { rows: 3, placeholder: 'Anything to remember? Energy, form, what to bump next time…', value: session.note || '' });
    const save = () => guard('save summary', () => F.store.updateSession(session.id, { feeling, note: noteEl.value }));
    const saveSoon = u.debounce(save, 500);
    noteEl.addEventListener('input', saveSoon);

    const vol = u.toDisplayWeight(stats.volume, units()) || 0;
    const tile = (label, iconName, valueEl, unit, p) => h('div.stat.wo-sum__stat', { dataset: p ? { plate: p } : {} },
      h('span.stat__label', ic(iconName, 15), label),
      h('span.stat__value', valueEl, unit ? h('span.stat__unit', unit) : null));
    const vVol = h('span', '0');
    const vSets = h('span', '0');
    const vReps = h('span', '0');
    const dur = stats.durationSec || 0;
    const durMain = dur >= 3600 ? u.fmtClock(dur).split(':').slice(0, 2).join(':') : String(Math.max(1, Math.round(dur / 60)));
    const durUnit = dur >= 3600 ? 'h' : 'min';

    const segs = muscles.map((m) => h('span.wo-sum__seg', { dataset: { plate: plateOf(m) }, style: { flexGrow: String(by[m]) }, attrs: { title: muscleLabel(m) + ': ' + plural(by[m], 'set') } }));
    const legend = muscles.map((m) => h('span.wo-sum__leg', { dataset: { plate: plateOf(m) } }, h('i'), muscleLabel(m), h('b.num', String(by[m]))));

    const content = h('div.wo-sum.stack',
      h('div.wo-sum__hero', { dataset: { plate } },
        h('span.wo-sum__stampmark', { attrs: { 'aria-hidden': 'true' } }, 'Done'),
        h('p.eyebrow', u.fmtDate(session.date, 'long')),
        h('p.wo-sum__title', session.title),
        h('p.wo-sum__sub', plural(stats.exercises || session.exercises.length, 'exercise') + ' · ' + u.fmtTime(session.startedAt) + '–' + u.fmtTime(session.endedAt))),
      h('div.grid-2.wo-sum__grid',
        tile('Time', 'clock', h('span', durMain), durUnit),
        tile('Volume', 'dumbbell', vVol, units()),
        tile('Sets', 'check-circle', vSets, null),
        tile('Reps', 'repeat', vReps, null)),
      muscles.length ? h('div.wo-sum__split',
        h('p.eyebrow', 'Sets by muscle'),
        h('div.wo-sum__bar', { attrs: { 'aria-hidden': 'true' } }, segs),
        h('div.wo-sum__legend', legend)) : null,
      prs.length ? h('div.wo-sum__prs',
        h('p.eyebrow.wo-sum__prhead', ic('trophy', 14), plural(prs.length, 'personal record')),
        h('ul.wo-sum__prlist', prs.map((pr) => {
          const ex = exOf(pr.exId);
          return h('li.wo-sum__pr', { dataset: { plate: plateOf(ex.muscle) } },
            h('span.wo-sum__prico', ic('trophy', 18)),
            h('span.wo-sum__prmain', h('span.wo-sum__prname', ex.name), h('span.wo-sum__prval', prShort(pr), h('span.wo-sum__prwas', ' · ' + prPrev(pr)))));
        }))) : null,
      h('div.field',
        h('span.field__label#wo-sum-feel', 'How did it feel?'),
        F.ui.moodPicker({ id: 'wo-sum-mood', value: feeling, label: 'How did it feel?', onChange: (v) => { feeling = v; save(); } })),
      h('div.field',
        h('label.field__label', { for: 'wo-sum-note' }, 'Note'),
        noteEl));

    let closedBy = null;
    F.ui.sheet({
      title: 'Workout saved',
      subtitle: 'Nice work. Add how it felt, then you’re done.',
      className: 'wo-sum-sheet',
      content,
      actions: [
        {
          label: 'Write in journal', variant: 'secondary', icon: 'book',
          onClick: (close) => {
            closedBy = 'journal';
            saveSoon.cancel(); save(); close('journal');
            const params = { new: true, date: session.date };
            if (feeling) params.mood = feeling;
            F.router.go('journal', params);
          }
        },
        {
          label: 'Save', variant: 'primary', icon: 'check', autofocus: true,
          onClick: (close) => {
            closedBy = 'save';
            saveSoon.cancel(); save(); close('save');
            F.router.go('today');
          }
        }
      ],
      onClose: () => { if (!closedBy) { saveSoon.cancel(); save(); } }
    });

    // count-ups once the stamp has had its moment
    setTimeout(() => {
      u.countUp(vVol, vol, { duration: 900, format: (n) => u.fmtNum(Math.round(n)) });
      u.countUp(vSets, stats.sets || 0, { duration: 700, format: (n) => String(Math.round(n)) });
      u.countUp(vReps, stats.reps || 0, { duration: 900, format: (n) => u.fmtNum(Math.round(n)) });
    }, reduced() ? 0 : 900);
  }

  /* ================================================================ register */

  F.router.register('workout', {
    title: () => (S().active ? 'Workout' : 'Train'),
    nav: 'workout',
    render(el, params, ctx) {
      if (S().active) renderActive(el, ctx);
      else renderStart(el, ctx);
    }
  });

  /* ================================================================ F.restTimer */

  const RT = { dock: null, pill: null, parts: null, gone: null, pendingToast: false, raf: 0, timeout: 0, firedFor: 0, lastSec: -1, ticked: '', leaving: 0, key: '', subscribed: false };
  const RT_C = 2 * Math.PI * 21;

  function rtRest() {
    const a = S().active;
    return a && a.rest && Number(a.rest.endsAt) > 0 ? a.rest : null;
  }

  function rtMount(dockEl) {
    RT.dock = dockEl || null;
    if (!RT.dock) return;
    if (!RT.subscribed) {
      RT.subscribed = true;
      try { F.store.subscribe(() => rtSync(false)); } catch (err) { console.error('[FORGE] rest timer: subscribe failed', err); }
      try {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'hidden' && RT.pendingToast) { RT.pendingToast = false; rtToast(); }
          rtSync(false);
        });
      } catch (_) { /* ignore */ }
    }
    rtSync(true);
  }

  function rtSync(boot) {
    const r = rtRest();
    if (!r) { rtHide(); return; }
    const left = r.endsAt - Date.now();
    if (left <= 0) {
      rtHide();
      if (RT.firedFor !== r.endsAt) {
        RT.firedFor = r.endsAt;
        // on time → beep + buzz (even in a background tab); a little late (phone was locked) → just the toast
        rtDone(r, !boot && left > -5000, !boot && left > -90000);
      }
      return;
    }
    rtShow(r);
  }

  function rtDone(r, loud, notify) {
    const a = S().active;
    if (a && a.rest && a.rest.endsAt === r.endsAt) F.store.setRest(null);
    if (loud) { U().beep('end'); U().haptic([200, 100, 200]); }
    if (!notify) return;
    if (document.visibilityState === 'hidden') RT.pendingToast = true; // show it when they look again
    else rtToast();
  }
  function rtToast() { F.ui.toast('Rest done — next set', { type: 'ok', icon: 'timer' }); }

  function rtBuild() {
    const arc = h('circle.rest-pill__arc', { cx: '24', cy: '24', r: '21', 'stroke-dasharray': RT_C.toFixed(2), transform: 'rotate(-90 24 24)' });
    const ring = h('svg.rest-pill__ring', { viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
      h('circle.rest-pill__track', { cx: '24', cy: '24', r: '21' }), arc);
    const time = h('span.rest-pill__time', '0:00');
    const next = h('span.rest-pill__next');
    const main = h('button.rest-pill__main', { type: 'button', onClick: rtOpen },
      h('span.rest-pill__dial', ring, ic('timer', 18, 'rest-pill__ico')),
      h('span.rest-pill__text',
        h('span.rest-pill__top', time, h('span.rest-pill__label', 'Rest')),
        next));
    const btn = (label, aria, fn, cls) => h('button', { type: 'button', class: ['rest-pill__btn', cls || null], 'aria-label': aria, onClick: fn }, label);
    RT.pill = h('div.rest-pill', { attrs: { role: 'group', 'aria-label': 'Rest timer' } },
      main,
      h('div.rest-pill__ctrls',
        btn('−15', 'Rest 15 seconds less', () => rtAdjust(-15)),
        btn('+15', 'Rest 15 seconds more', () => rtAdjust(15)),
        btn(ic('skip', 20), 'Skip rest', rtSkip, 'rest-pill__skip')));
    RT.parts = { arc, time, next, main };
    RT.lastSec = -1;
    RT.key = '';
    RT.dock.appendChild(RT.pill);
  }

  function rtShow(r) {
    if (!RT.dock) return;
    if (RT.leaving) { // a new rest started while the old pill was animating out: bring it back
      clearTimeout(RT.leaving);
      RT.leaving = 0;
      if (RT.gone && RT.gone.pill.isConnected) {
        RT.pill = RT.gone.pill;
        RT.parts = RT.gone.parts;
        RT.pill.classList.remove('is-leaving');
      }
      RT.gone = null;
    }
    if (!RT.pill || !RT.pill.isConnected) rtBuild();
    const a = S().active;
    const entry = a && a.exercises.find((e) => e.id === r.exEntryId);
    const ex = entry ? exOf(entry.exId) : null;
    const nx = nextUp(a);
    const nextEx = nx ? exOf(nx.entry.exId) : null;
    const key = [r.endsAt, r.duration, r.exEntryId, nx ? nx.set.id : '', nextEx ? nextEx.name : ''].join('|');
    if (key !== RT.key) {
      RT.key = key;
      RT.pill.dataset.plate = plateOf(nextEx ? nextEx.muscle : (ex ? ex.muscle : 'chest'));
      RT.parts.next.textContent = nx ? 'Next: ' + nextEx.name + ' · set ' + (nx.index + 1) : 'All sets done: finish up!';
      RT.parts.main.setAttribute('aria-label', 'Resting. ' + RT.parts.next.textContent + '. Open workout');
    }
    rtFrame(true);
    clearTimeout(RT.timeout);
    RT.timeout = setTimeout(() => rtSync(false), Math.max(40, r.endsAt - Date.now() + 40));
  }

  function rtFrame(sync) {
    if (!sync) RT.raf = 0;
    const r = rtRest();
    if (!r || !RT.pill) return;
    const left = r.endsAt - Date.now();
    if (left <= 0) { rtSync(false); return; }
    const sec = Math.ceil(left / 1000);
    if (sec !== RT.lastSec) {
      RT.lastSec = sec;
      RT.parts.time.textContent = U().fmtClock(sec);
      RT.pill.classList.toggle('is-ending', sec <= 3);
      const tk = r.endsAt + ':' + sec;
      if (sec <= 3 && RT.ticked !== tk && document.visibilityState !== 'hidden' && !sync) { RT.ticked = tk; U().beep('tick'); }
    }
    const frac = Math.max(0, Math.min(1, left / (Math.max(1, r.duration) * 1000)));
    RT.parts.arc.style.strokeDashoffset = (RT_C * (1 - frac)).toFixed(2);
    if (!RT.raf && document.visibilityState !== 'hidden') {
      try { RT.raf = requestAnimationFrame(() => rtFrame(false)); } catch (_) { RT.raf = 0; }
    }
  }

  function rtHide() {
    if (RT.raf) { try { cancelAnimationFrame(RT.raf); } catch (_) { /* ignore */ } RT.raf = 0; }
    clearTimeout(RT.timeout);
    RT.timeout = 0;
    const pill = RT.pill;
    if (!pill) return;
    RT.gone = { pill, parts: RT.parts };
    RT.pill = null;
    RT.parts = null;
    RT.lastSec = -1;
    if (reduced() || !pill.isConnected) { pill.remove(); RT.gone = null; return; }
    pill.classList.add('is-leaving');
    RT.leaving = setTimeout(() => { RT.leaving = 0; RT.gone = null; pill.remove(); }, 230);
  }

  function rtAdjust(delta) {
    const r = rtRest();
    if (!r) return;
    U().haptic(8);
    const now = Date.now();
    const ends = r.endsAt + delta * 1000;
    if (ends <= now + 1000) { F.store.setRest(null); return; }
    const duration = delta > 0 ? r.duration + delta : Math.max(Math.ceil((ends - now) / 1000), r.duration + delta);
    F.store.setRest(Object.assign({}, r, { endsAt: ends, duration }));
  }

  function rtSkip() {
    if (!rtRest()) return;
    U().haptic(10);
    F.store.setRest(null);
  }

  function rtOpen() {
    let cur = null;
    try { cur = F.router.current(); } catch (_) { cur = null; }
    if (cur && cur.name === 'workout') {
      const row = document.querySelector('.v-workout .wo-set.is-next');
      if (row) {
        const card = row.closest('.wo-ex');
        if (card && card.classList.contains('is-collapsed')) { const b = card.querySelector('.wo-ex__summary'); if (b) b.click(); }
        scrollIntoViewSoft(row, 'center');
        replay(row, 'is-flash');
      }
      return;
    }
    F.router.go('workout');
  }

  F.restTimer = { mount: rtMount };
})(window.Forge = window.Forge || {});
