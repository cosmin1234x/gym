import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForge, at, plain, pickEx, setWeek, logWorkout } from './harness.mjs';

const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

/** User who installed on Mon 21 Sep 2026 09:00; plan trains every day but Sunday. Today = Wed 30 Sep. */
function scenario({ installed = '2026-09-21', restDays = ['sun'] } = {}) {
  const env = loadForge({ now: at(installed, 9) });
  env.F.store.init(null);
  const w = pickEx(env.F, 'weight');
  setWeek(env.F, w, restDays);
  env.setDay('2026-09-30', 10);
  const train = (iso, sets = [{ w: 20, r: 10 }], ex = w) => logWorkout(env, iso, [{ exId: ex, sets }]);
  return { env, F: env.F, w, train };
}

/* ---------------------------------------------------------------- exercises / plan */

test('q: exercise lookup, placeholder, equipment ownership', () => {
  const { F } = scenario();
  const lib = F.data.exercises[0];
  assert.equal(F.q.exercise(lib.id), lib);
  const ph = F.q.exercise('gone');
  deq(ph, { id: 'gone', name: 'Deleted exercise', muscle: 'fullbody', secondary: [], equipment: [], type: 'weight', calisthenics: false,
    level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 }, cues: [], custom: false, missing: true });
  assert.equal(F.q.exercise(undefined).name, 'Deleted exercise');
  assert.equal(F.q.allExercises().length, F.data.exercises.length);
  assert.equal(F.q.owns('bodyweight'), true);
  assert.equal(F.q.owns('pullupBar'), true);
  assert.equal(F.q.owns('barbell'), false);
  assert.equal(F.q.owns('unicycle'), false);
  const barbellEx = F.data.exercises.find((e) => e.equipment.includes('barbell'));
  if (barbellEx) {
    assert.equal(F.q.canDo(barbellEx), false);
    F.store.setSetting('equipment.barbell', true);
    assert.equal(F.q.canDo(barbellEx.id), true);
  }
  assert.equal(F.q.canDo({ equipment: [] }), true);
  assert.equal(F.q.canDo(null), false);
});

test('q: dayPlan / planFor / estimateMinutes', () => {
  const { F, w } = scenario();
  assert.equal(F.q.dayPlan('mon'), F.store.get().plan.days.mon);
  deq(F.q.dayPlan('xyz'), { title: '', rest: false, focus: [], items: [] });
  const pf = F.q.planFor('2026-09-30');
  assert.equal(pf.dayKey, 'wed');
  assert.equal(pf.day, F.store.get().plan.days.wed);
  F.store.setSetting('restSeconds', 60);
  // 3×(45+90) + 3×(45+60) = 720 s = 12 min → rounds to 10
  const day = { rest: false, items: [{ exId: w, sets: 3, rest: 90 }, { exId: w, sets: 3, rest: null }] };
  assert.equal(F.q.estimateMinutes(day), 10);
  assert.equal(F.q.estimateMinutes({ rest: false, items: [{ exId: w, sets: 1, rest: 0 }] }), 5, 'min 5');
  assert.equal(F.q.estimateMinutes({ rest: true, items: [{ exId: w, sets: 3 }] }), 0);
  assert.equal(F.q.estimateMinutes({ rest: false, items: [] }), 0);
  assert.equal(F.q.estimateMinutes(null), 0);
  // 8 exercises × 3 sets × (45 + 90) = 3240 s = 54 min → 55
  assert.equal(F.q.estimateMinutes({ rest: false, items: Array(8).fill({ exId: w, sets: 3, rest: 90 }) }), 55);
});

/* ---------------------------------------------------------------- sessions & history */

test('q: sessions by day / range, lastSession, lastPerformance(before), exerciseHistory', () => {
  const { F, w, train } = scenario();
  const s1 = train('2026-09-21', [{ w: 20, r: 10 }, { w: 20, r: 8 }]).session;
  const s2 = train('2026-09-23', [{ w: 22.5, r: 8 }]).session;
  const s3 = train('2026-09-23', [{ w: 25, r: 5 }]).session; // second session same day
  assert.equal(F.q.sessionsOn('2026-09-23').length, 2);
  assert.equal(F.q.sessionsOn('2026-09-22').length, 0);
  deq(F.q.sessionsBetween('2026-09-21', '2026-09-22').map((s) => s.id), [s1.id]);
  deq(F.q.sessionsBetween('2026-09-21', '2026-09-23').map((s) => s.id), [s1.id, s2.id, s3.id]);
  assert.equal(F.q.trainedOn('2026-09-23'), true);
  assert.equal(F.q.trainedOn('2026-09-24'), false);
  assert.equal(F.q.lastSession().id, s3.id);
  const lp = F.q.lastPerformance(w);
  assert.equal(lp.sessionId, s3.id);
  deq(lp.sets.map((s) => [s.w, s.r]), [[25, 5]]);
  const lpBefore = F.q.lastPerformance(w, { before: s2.startedAt });
  assert.equal(lpBefore.sessionId, s1.id);
  assert.equal(F.q.lastPerformance(w, { before: s1.startedAt }), null);
  assert.equal(F.q.lastPerformance('never-done'), null);
  // returned sets are copies
  lp.sets[0].w = 999;
  assert.equal(F.q.lastPerformance(w).sets[0].w, 25);
  const hist = F.q.exerciseHistory(w);
  deq(hist.map((h) => [h.date, h.topW, h.bestE1rm, h.totalReps, h.volume]), [
    ['2026-09-21', 20, 26.7, 18, 360],
    ['2026-09-23', 22.5, 28.5, 8, 180],
    ['2026-09-23', 25, 29.2, 5, 125]
  ]);
  deq(F.q.exerciseHistory('never'), []);
});

test('q: bestFor / checkPR rules (baseline first time, exclude + active sets, before)', () => {
  const { F, w, train } = scenario();
  assert.equal(F.q.checkPR(w, { w: 100, r: 5, done: true }), null, 'no history → baseline, not a PR');
  const first = train('2026-09-21', [{ w: 20, r: 10 }]).session;
  deq(F.q.bestFor(w), { maxW: 20, maxE1rm: 20 * (1 + 10 / 30), maxR: 10, maxT: 0, count: 1, historyCount: 1 });
  deq(F.q.checkPR(w, { w: 20, r: 11 }), { exId: w, kind: 'e1rm', value: 27.3, prev: 26.7 });
  deq(F.q.checkPR(w, { w: 21, r: 1 }), { exId: w, kind: 'weight', value: 21, prev: 20 });
  assert.equal(F.q.checkPR(w, { w: 20, r: 10 }), null, 'equal is not a PR');
  assert.equal(F.q.checkPR(w, { w: null, r: 10 }), null);
  assert.equal(F.q.checkPR(w, null), null);
  // before: history strictly before the timestamp
  assert.equal(F.q.checkPR(w, { w: 30, r: 5 }, { before: first.startedAt }), null);
  // active session sets are only considered with exclude/includeActive
  F.store.startWorkout({ blank: true });
  const e = F.store.addExerciseToActive(w);
  const rows = F.store.get().active.exercises[0].sets;
  F.store.updateSet(e.id, rows[0].id, { w: 30, r: 10 });
  F.store.toggleSet(e.id, rows[0].id);
  assert.equal(F.q.bestFor(w).maxW, 20);
  assert.equal(F.q.bestFor(w, { includeActive: true }).maxW, 30);
  assert.equal(F.q.bestFor(w, { exclude: rows[0].id }).maxW, 20, 'excluded set not counted');
  assert.equal(F.q.bestFor(w, { exclude: 'other' }).maxW, 30);
  assert.equal(F.q.checkPR(w, { w: 25, r: 10 }, { exclude: 'x' }), null);
});

test('q: sessionStats, sessionPRs, recentPRs, records, totals', () => {
  const { env, F, w, train } = scenario();
  const bw = pickEx(F, 'bodyweight');
  const tm = pickEx(F, 'time');
  logWorkout(env, '2026-09-21', [{ exId: w, sets: [{ w: 20, r: 10 }] }, { exId: bw, sets: [{ r: 8 }] }, { exId: tm, sets: [{ t: 30 }] }]);
  const r2 = logWorkout(env, '2026-09-23', [{ exId: w, sets: [{ w: 22.5, r: 10 }, { w: 25, r: 2 }] }, { exId: bw, sets: [{ r: 10 }] }, { exId: tm, sets: [{ t: 25 }] }]);
  deq(r2.prs, [{ exId: w, kind: 'e1rm', value: 30, prev: 26.7 }, { exId: bw, kind: 'reps', value: 10, prev: 8 }]);
  deq(F.q.sessionPRs(r2.session), r2.prs, 'recomputed from history gives the same PRs');
  train('2026-09-25', [{ w: 22.5, r: 8 }]); // no PR
  train('2026-09-26', [{ w: 27.5, r: 3 }]); // weight PR (e1rm 30.25 > 30 → e1rm first)
  const st = F.q.sessionStats(r2.session);
  assert.equal(st.sets, 4);
  assert.equal(st.reps, 22);
  assert.equal(st.volume, 22.5 * 10 + 25 * 2);
  assert.equal(st.exercises, 3);
  assert.equal(st.durationSec, 45 * 60);
  assert.equal(Object.values(st.byMuscle).reduce((a, b) => a + b, 0), 4);
  deq(F.q.sessionStats(null), { volume: 0, sets: 0, reps: 0, durationSec: 0, exercises: 0, byMuscle: {} });
  // live workout: duration uses now
  F.store.startWorkout({ blank: true });
  env.advance(90 * 1000);
  assert.equal(F.q.sessionStats(F.store.get().active).durationSec, 90);
  F.store.discardWorkout();
  const recent = F.q.recentPRs();
  deq(recent.map((p) => [p.date, p.kind]), [['2026-09-26', 'e1rm'], ['2026-09-23', 'e1rm'], ['2026-09-23', 'reps']], 'newest session first, exercise order within');
  assert.equal(F.q.recentPRs(1).length, 1);
  assert.equal(F.q.recentPRs(0).length, 0);
  assert.equal(recent[0].sessionId, F.q.lastSession().id);
  const recs = F.q.records();
  const rw = recs.find((r) => r.exId === w);
  deq(rw, { exId: w, maxW: 27.5, maxE1rm: 30.3, maxR: 10, maxT: 0, date: '2026-09-26' });
  deq(recs.find((r) => r.exId === bw), { exId: bw, maxW: 0, maxE1rm: 0, maxR: 10, maxT: 0, date: '2026-09-23' });
  deq(recs.find((r) => r.exId === tm), { exId: tm, maxW: 0, maxE1rm: 0, maxR: 0, maxT: 30, date: '2026-09-21' });
  assert.equal(recs[0].date, '2026-09-26', 'newest first');
  const t = F.q.totals();
  assert.equal(t.workouts, 4);
  assert.equal(t.sets, 3 + 4 + 1 + 1);
  assert.equal(t.minutes, 4 * 45);
  assert.equal(t.volume, 200 + 275 + 180 + 82.5);
  // callers can't corrupt the cache
  t.workouts = 99; recent.length = 0;
  assert.equal(F.q.totals().workouts, 4);
  assert.equal(F.q.recentPRs().length, 3);
});

/* ---------------------------------------------------------------- calendar */

test('q: dayStatus — rest, trained, today, future, missed respects first use', () => {
  const { F, train } = scenario();
  train('2026-09-22');
  const before = F.q.dayStatus('2026-09-20'); // before install
  assert.equal(before.missed, false);
  const mon = F.q.dayStatus('2026-09-21'); // install day, not trained
  assert.equal(mon.missed, true);
  const tue = F.q.dayStatus('2026-09-22');
  assert.equal(tue.trained, true);
  assert.equal(tue.missed, false);
  const sun = F.q.dayStatus('2026-09-27');
  assert.equal(sun.isRest, true);
  assert.equal(sun.missed, false);
  const today = F.q.dayStatus('2026-09-30');
  assert.equal(today.isToday, true);
  assert.equal(today.missed, false, 'today is pending, never missed');
  assert.equal(today.dayKey, 'wed');
  const fut = F.q.dayStatus('2026-10-02');
  assert.equal(fut.isFuture, true);
  assert.equal(fut.missed, false);
  // day with no exercises counts as rest (nothing to miss)
  F.store.setDay('thu', { rest: false, items: [] });
  assert.equal(F.q.dayStatus('2026-09-24').isRest, true);
  assert.equal(F.q.dayStatus('2026-09-24').missed, false);
  // water / journal flags
  F.store.addWater(3000);
  F.store.saveJournal({ text: 'hi' });
  const t2 = F.q.dayStatus('2026-09-30');
  assert.equal(t2.water, 3000);
  assert.equal(t2.waterHit, true);
  assert.equal(t2.journaled, true);
  assert.equal(F.q.dayStatus('garbage').iso, '2026-09-30');
});

test('q: workoutStreak — rest days skipped, today pending, missed breaks, first-use boundary', () => {
  const { env, F, train } = scenario();
  assert.equal(F.q.workoutStreak(), 0);
  for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29']) train(d);
  // Sun 27 is a rest day (skipped); today not trained yet (pending); stops at the install day
  assert.equal(F.q.workoutStreak(), 8);
  train('2026-09-30');
  assert.equal(F.q.workoutStreak(), 9);
  // extra session on the rest day also counts
  train('2026-09-27');
  assert.equal(F.q.workoutStreak(), 10);
  // a missed planned day breaks it
  const tue = F.q.sessionsOn('2026-09-29')[0];
  F.store.deleteSession(tue.id);
  assert.equal(F.q.workoutStreak(), 1, 'only today counts after missing Tuesday');
  // tomorrow morning, nothing done yet today: yesterday (trained) keeps the streak alive
  env.setDay('2026-10-01', 7);
  assert.equal(F.q.workoutStreak(), 1);
  env.setDay('2026-10-02', 7); // Thu 1 Oct missed
  assert.equal(F.q.workoutStreak(), 0);
});

test('q: brand-new user sees no missed days and a zero streak without errors', () => {
  const env = loadForge({ now: at('2026-09-30', 8) });
  env.F.store.init(null);
  const { F } = env;
  assert.equal(F.q.workoutStreak(), 0);
  deq(F.q.consistency(), { planned: 0, done: 0, pct: 0 });
  assert.ok(F.q.heatmap().every((c) => !c.missed));
  assert.ok(F.q.weekSummary().days.every((d) => !d.missed));
  assert.equal(F.q.firstUse(), '2026-09-30');
});

test('q: waterStreak and waterDays', () => {
  const { env, F } = scenario();
  const goal = F.store.get().settings.waterGoal; // 3000
  F.store.addWater(3000, '2026-09-26');
  F.store.addWater(3000, '2026-09-28');
  F.store.addWater(1600, '2026-09-29');
  F.store.addWater(1600, '2026-09-29');
  F.store.addWater(1000); // today, not hit yet
  assert.equal(F.q.waterStreak(), 2, 'today pending does not break');
  F.store.addWater(2000);
  assert.equal(F.q.waterStreak(), 3);
  F.store.addWater(3000, '2026-09-27');
  assert.equal(F.q.waterStreak(), 5);
  const days = F.q.waterDays(7);
  deq(days.map((d) => d.iso), ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
  deq(days.map((d) => d.hit), [false, false, true, true, true, true, true]);
  assert.equal(days[5].ml, 3200);
  assert.equal(days[0].goal, goal);
  deq(F.q.waterDays(3, '2026-09-27').map((d) => d.ml), [0, 3000, 3000]);
  env.setDay('2026-10-01', 9);
  assert.equal(F.q.waterStreak(), 5, 'yesterday still counts the next morning');
  assert.equal(F.q.waterTotal('2026-09-30'), 3000);
  assert.equal(F.q.waterTotal('nope'), 0);
});

test('q: consistency counts only planned days since first use; today only once trained', () => {
  const { F, train } = scenario();
  // window 28 days → clipped to install day (21 Sep). Planned Mon–Sat: 21..26, 28, 29 = 8 days before today.
  train('2026-09-21'); train('2026-09-22'); train('2026-09-24'); train('2026-09-27'); // Sunday extra doesn't count
  deq(F.q.consistency(28), { planned: 8, done: 3, pct: 38 });
  train('2026-09-30');
  deq(F.q.consistency(28), { planned: 9, done: 4, pct: 44 });
  deq(F.q.consistency(3), { planned: 3, done: 1, pct: 33 }, '28, 29, 30');
  deq(F.q.consistency(1), { planned: 1, done: 1, pct: 100 });
});

test('q: missionFor and weekSummary', () => {
  const { F, train } = scenario();
  const m0 = F.q.missionFor('2026-09-30');
  deq(m0.items.map((i) => [i.key, i.done]), [['train', false], ['water', false], ['journal', false]]);
  assert.equal(m0.total, 3);
  assert.equal(m0.pct, 0);
  assert.match(m0.items[0].label, /^Train: /);
  assert.equal(m0.items[1].label, 'Drink 3 L');
  const sun = F.q.missionFor('2026-10-04');
  assert.equal(sun.items[0].done, true, 'rest day: train item done automatically');
  assert.equal(sun.items[0].label, 'Rest & recover');
  train('2026-09-30');
  F.store.addWater(3000);
  F.store.saveJournal({ text: 'x' });
  const m1 = F.q.missionFor();
  assert.equal(m1.done, 3);
  assert.equal(m1.pct, 100);
  train('2026-09-28', [{ w: 10, r: 10 }]);
  F.store.addWater(1000, '2026-09-28');
  const wk = F.q.weekSummary('2026-09-30');
  deq(wk.dates, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(wk.days.length, 7);
  assert.equal(wk.days[0].dayKey, 'mon');
  assert.equal(wk.planned, 6);
  assert.equal(wk.done, 2);
  assert.equal(wk.plannedDone, 2);
  assert.equal(wk.volume, 200 + 100);
  assert.equal(wk.waterAvg, Math.round((1000 + 0 + 3000) / 3), 'average over days up to today');
  assert.equal(wk.days[1].missed, true);
  assert.equal(F.q.weekSummary().dates[0], '2026-09-28');
});

test('q: heatmap is Monday-aligned, ends this week, levels 0..4', () => {
  const { F, train } = scenario();
  train('2026-09-22', [{ w: 20, r: 10 }]);
  train('2026-09-29', Array(12).fill({ w: 20, r: 10 }));
  const cells = F.q.heatmap(16);
  assert.equal(cells.length, 16 * 7);
  for (let i = 0; i < cells.length; i += 7) assert.equal(F.util.dayKeyOf(cells[i].iso), 'mon', 'row 0 is Monday: ' + cells[i].iso);
  assert.equal(cells[cells.length - 1].iso, '2026-10-04', 'last cell is this Sunday');
  assert.equal(cells[0].iso, F.util.addDays('2026-09-28', -7 * 15));
  for (let i = 1; i < cells.length; i++) assert.equal(F.util.diffDays(cells[i - 1].iso, cells[i].iso), 1);
  const by = Object.fromEntries(cells.map((c) => [c.iso, c]));
  assert.equal(by['2026-09-29'].level, 4);
  assert.equal(by['2026-09-22'].level, 1);
  assert.equal(by['2026-09-23'].level, 0);
  assert.equal(by['2026-09-23'].missed, true);
  assert.equal(by['2026-09-01'].missed, false, 'before install');
  assert.equal(by['2026-10-01'].future, true);
  assert.equal(by['2026-09-30'].isToday, true);
  assert.equal(by['2026-09-27'].isRest, true);
  assert.ok(cells.every((c) => c.level >= 0 && c.level <= 4));
  assert.equal(F.q.heatmap(1).length, 7);
  // across a DST change the grid stays aligned
  const env2 = loadForge({ now: at('2026-10-28', 12) });
  env2.F.store.init(null);
  const c2 = env2.F.q.heatmap(4);
  for (let i = 0; i < c2.length; i += 7) assert.equal(env2.F.util.dayKeyOf(c2[i].iso), 'mon');
  assert.equal(c2[c2.length - 1].iso, '2026-11-01');
});

test('q: muscleSplit and weeklyVolume', () => {
  const { env, F, w, train } = scenario();
  const bw = pickEx(F, 'bodyweight');
  logWorkout(env, '2026-09-29', [{ exId: w, sets: [{ w: 10, r: 10 }, { w: 10, r: 10 }] }, { exId: bw, sets: [{ r: 5 }] }]);
  train('2026-09-22', [{ w: 20, r: 5 }]);
  const split = F.q.muscleSplit(30);
  const mw = F.q.exercise(w).muscle; const mb = F.q.exercise(bw).muscle;
  if (mw === mb) deq(split, [{ muscle: mw, sets: 4 }]);
  else deq(split, [{ muscle: mw, sets: 3 }, { muscle: mb, sets: 1 }]);
  deq(F.q.muscleSplit(1), []);
  const wv = F.q.weeklyVolume(3);
  deq(wv, [
    { weekStart: '2026-09-14', volume: 0, sessions: 0 },
    { weekStart: '2026-09-21', volume: 100, sessions: 1 },
    { weekStart: '2026-09-28', volume: 200, sessions: 1 }
  ]);
  assert.equal(F.q.weeklyVolume().length, 8);
});

test('q: journalFor sorts newest first', () => {
  const { env, F } = scenario();
  const a = F.store.saveJournal({ text: 'a' });
  env.advance(1000);
  const b = F.store.saveJournal({ text: 'b' });
  F.store.saveJournal({ text: 'c', date: '2026-09-01' });
  deq(F.q.journalFor('2026-09-30').map((e) => e.id), [b.id, a.id]);
  deq(F.q.journalFor('2026-01-01'), []);
});

test('q: caches invalidate on every mutation even within the same millisecond', () => {
  const { F, w, train } = scenario();
  train('2026-09-29');
  assert.equal(F.q.workoutStreak(), 1);
  const st = F.q.lastSession();
  F.store.deleteSession(st.id); // same frozen Date.now()
  assert.equal(F.q.workoutStreak(), 0);
  assert.equal(F.q.lastSession(), null);
  F.store.restoreSession(st);
  assert.equal(F.q.workoutStreak(), 1);
  assert.equal(F.q.totals().workouts, 1);
  assert.ok(w);
});

test('q: stays fast with two years of history', () => {
  const env = loadForge({ now: at('2024-10-01', 9) });
  const { F } = env;
  F.store.init(null);
  const w = pickEx(F, 'weight');
  // Build 2 years of sessions directly (8 exercises × 4 sets, 6 days/week).
  const sessions = [];
  let d = '2024-10-01';
  let n = 0;
  while (d < '2026-09-30') {
    if (F.util.dayKeyOf(d) !== 'sun') {
      const start = at(d, 18);
      sessions.push({ id: 's' + n++, date: d, startedAt: start, endedAt: start + 3600e3, title: 'x', exercises:
        Array.from({ length: 8 }, (_, i) => ({ id: 'e' + n + '-' + i, exId: i % 2 ? w : F.data.exercises[i % F.data.exercises.length].id,
          sets: Array.from({ length: 4 }, (_, k) => ({ id: 'k' + n + i + k, w: 20 + (n % 30), r: 8 + (k % 3), done: true, at: start })) })) });
    }
    d = F.util.addDays(d, 1);
  }
  F.store.replace({ sessions, meta: { createdAt: at('2024-10-01', 9) } }, 'import');
  env.setDay('2026-09-30', 10);
  const t0 = performance.now();
  F.q.workoutStreak(); F.q.consistency(28); F.q.heatmap(16); F.q.weekSummary(); F.q.recentPRs(); F.q.records();
  F.q.totals(); F.q.weeklyVolume(8); F.q.muscleSplit(30); F.q.exerciseHistory(w); F.q.lastPerformance(w);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < 50; i++) { F.q.workoutStreak(); F.q.weekSummary(); F.q.heatmap(16); F.q.missionFor(); F.q.lastPerformance(w); }
  const warm = (performance.now() - t1) / 50;
  assert.ok(sessions.length > 600);
  assert.ok(cold < 1500, 'cold queries took ' + cold.toFixed(1) + 'ms');
  assert.ok(warm < 20, 'warm render-set took ' + warm.toFixed(2) + 'ms');
});
