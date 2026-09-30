// Swaps & calisthenics variations (SPEC §5.2 swapPlanItem / swapActiveExercise / startWorkout sources,
// §6.4 F.q.alternatives), restoreCustomExercise, and the forearms muscle group.
// Tests that need exact lists use the fixture library (data: 'fixture'); the rest pick ids
// dynamically so they keep passing while the real exercise library evolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForge, tick, plain, pickEx, logWorkout } from './harness.mjs';

const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);
const ids = (list) => plain(list).map((e) => e.id);

function fresh(opts = {}) {
  const env = loadForge(opts);
  env.F.store.init(null);
  return env;
}
/** Record notification reasons (flush with await tick()). */
function spy(F) {
  const reasons = [];
  F.store.subscribe((s, r) => reasons.push(r));
  return reasons;
}
/** First library exercise matching pred that the default equipment allows. */
function findEx(F, pred) {
  return F.data.exercises.find((e) => F.q.canDo(e) && pred(e)) || null;
}

/* ---------------------------------------------------------------- forearms */

test('forearms is a first-class muscle for custom exercises (with and without program data)', () => {
  const { F } = fresh({ data: 'fixture' });
  const ex = F.store.addCustomExercise({ name: 'Towel Wring', muscle: 'forearms', type: 'time', equipment: ['bodyweight'], secondary: ['forearms', 'back'] });
  assert.equal(ex.muscle, 'forearms');
  deq(ex.secondary, ['back'], 'primary muscle is dropped from secondary');
  // fallback muscle list (no F.data.program at all) also knows forearms
  const env2 = loadForge();
  env2.F.data.program = undefined;
  env2.F.store.init(null);
  assert.equal(env2.F.store.addCustomExercise({ name: 'Grip', muscle: 'forearms' }).muscle, 'forearms');
  assert.equal(env2.F.store.addCustomExercise({ name: 'Nope', muscle: 'wrists' }).muscle, 'fullbody');
});

/* ---------------------------------------------------------------- swapPlanItem */

test('store.swapPlanItem: same type keeps sets/target/rest/note; other type takes the new defaults', async () => {
  const { F } = fresh();
  const w1 = pickEx(F, 'weight');
  const w2 = pickEx(F, 'weight', { not: [w1] });
  const bw = pickEx(F, 'bodyweight');
  const tm = pickEx(F, 'time');
  F.store.setDay('mon', { title: 'Test', rest: false, items: [
    { exId: w1, sets: 5, target: '5', rest: 150, note: 'heavy' },
    { exId: w1, sets: 2, target: '12', rest: null, note: 'pump' }
  ] });
  const day = F.store.get().plan.days.mon;
  const [a, b] = day.items.map((i) => i.id);
  await tick();
  const reasons = spy(F);

  const res = F.store.swapPlanItem('mon', a, w2);
  deq(day.items[0], { id: a, exId: w2, sets: 5, target: '5', rest: 150, note: 'heavy' });
  assert.equal(res.item, day.items[0], 'returns the live item');
  deq(res.prev, { id: a, exId: w1, sets: 5, target: '5', rest: 150, note: 'heavy' });
  await tick();
  deq(reasons, ['plan']);

  // weight → bodyweight: the new exercise's defaults, note cleared
  F.store.swapPlanItem('mon', b, bw);
  const d = F.q.exercise(bw).defaults;
  deq(day.items[1], { id: b, exId: bw, sets: d.sets, target: d.target, rest: d.rest, note: '' });
  // bodyweight → time
  F.store.swapPlanItem('mon', b, tm);
  const dt = F.q.exercise(tm).defaults;
  deq(day.items[1], { id: b, exId: tm, sets: dt.sets, target: dt.target, rest: dt.rest, note: '' });
  assert.ok(F.util.parseTarget(day.items[1].target).secs > 0, 'time exercises get a seconds target');

  // undo with the returned snapshot
  F.store.updatePlanItem('mon', res.prev.id, res.prev);
  deq(day.items[0], res.prev);
  deq(day.items.map((i) => i.id), [a, b], 'order and ids unchanged');

  // a custom exercise is a valid swap target
  const custom = F.store.addCustomExercise({ name: 'Ring Row', muscle: 'back', type: 'bodyweight', equipment: ['bodyweight'], defaults: { sets: 4, target: '6-10', rest: 75 } });
  F.store.swapPlanItem('mon', a, custom.id);
  deq(day.items[0], { id: a, exId: custom.id, sets: 4, target: '6-10', rest: 75, note: '' });
});

test('store.swapPlanItem: silent no-ops (missing day/item, unknown or same exercise)', async () => {
  const { F } = fresh();
  const w1 = pickEx(F, 'weight');
  const w2 = pickEx(F, 'weight', { not: [w1] });
  F.store.setDay('tue', { items: [{ exId: w1, sets: 3, target: '8-12', rest: 90 }] });
  const s = F.store.get();
  const itemId = s.plan.days.tue.items[0].id;
  await tick();
  const reasons = spy(F);
  const before = JSON.stringify(s.plan);
  const upd = s.meta.updatedAt;
  assert.equal(F.store.swapPlanItem('xyz', itemId, w2), null);
  assert.equal(F.store.swapPlanItem('mon', itemId, w2), null, 'item lives on another day');
  assert.equal(F.store.swapPlanItem('tue', 'nope', w2), null);
  assert.equal(F.store.swapPlanItem('tue', itemId, 'no-such-exercise'), null);
  assert.equal(F.store.swapPlanItem('tue', itemId, ''), null);
  assert.equal(F.store.swapPlanItem('tue', itemId, null), null);
  assert.equal(F.store.swapPlanItem('tue', itemId, w1), null, 'same exercise');
  assert.equal(JSON.stringify(s.plan), before);
  assert.equal(s.meta.updatedAt, upd);
  await tick();
  deq(reasons, []);
});

/* ---------------------------------------------------------------- swapActiveExercise */

test('store.swapActiveExercise: same type keeps done sets, re-prefills undone rows from history, clears its rest', async () => {
  const env = fresh();
  const { F } = env;
  const w1 = pickEx(F, 'weight');
  const w2 = pickEx(F, 'weight', { not: [w1] });
  logWorkout(env, '2026-09-24', [{ exId: w2, sets: [{ w: 30, r: 6 }, { w: 27.5, r: 7 }] }]);
  F.store.startWorkout({ blank: true });
  const other = F.store.addExerciseToActive(w1);
  const e = F.store.addExerciseToActive(w1);
  while (e.sets.length < 3) F.store.addSet(e.id);
  while (e.sets.length > 3) F.store.removeSet(e.id, e.sets[e.sets.length - 1].id);
  const a = F.store.get().active;
  const rowIds = e.sets.map((s) => s.id);
  F.store.setExerciseNote(e.id, 'elbows in');
  a.exercises[1].target = '6-8';
  a.exercises[1].rest = 100;
  F.store.updateSet(e.id, rowIds[0], { w: 20, r: 10 });
  F.store.toggleSet(e.id, rowIds[0]);
  const doneAt = a.exercises[1].sets[0].at;
  F.store.updateSet(e.id, rowIds[1], { w: 99, r: 1 }); // typed but not done → replaced
  assert.equal(a.rest.exEntryId, e.id);
  await tick();
  const reasons = spy(F);

  const out = F.store.swapActiveExercise(e.id, w2);
  assert.equal(out, a.exercises[1], 'returns the live entry, same position');
  assert.equal(out.id, e.id);
  assert.equal(out.exId, w2);
  assert.equal(out.target, '6-8');
  assert.equal(out.rest, 100);
  assert.equal(out.note, 'elbows in');
  deq(out.sets.map((s) => s.id), rowIds, 'row count and ids kept');
  deq(out.sets.map((s) => [s.w, s.r, s.done]), [[20, 10, true], [27.5, 7, false], [27.5, 7, false]]);
  assert.equal(out.sets[0].at, doneAt);
  assert.equal(a.rest, null, 'rest timer from this entry cleared');
  assert.equal(a.exercises[0], other, 'other entries untouched');
  await tick();
  deq(reasons, ['workout']);

  // the kept done set now counts for the new exercise
  env.advance(10 * 60 * 1000);
  const res = F.store.finishWorkout();
  const saved = res.session.exercises.find((x) => x.id === e.id);
  assert.equal(saved.exId, w2);
  deq(saved.sets.map((s) => [s.w, s.r]), [[20, 10]]);
});

test('store.swapActiveExercise: another type resets every row, applies its defaults, keeps the row count', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  const bw = pickEx(F, 'bodyweight');
  const tm = pickEx(F, 'time');
  F.store.startWorkout({ blank: true });
  const keep = F.store.addExerciseToActive(w);
  const e = F.store.addExerciseToActive(w);
  while (e.sets.length < 5) F.store.addSet(e.id);
  const n = e.sets.length;
  const a = F.store.get().active;
  F.store.setExerciseNote(e.id, 'for the dumbbell');
  F.store.updateSet(e.id, e.sets[0].id, { w: 20, r: 10 });
  F.store.toggleSet(e.id, e.sets[0].id);
  // a rest started by ANOTHER entry survives the swap
  F.store.updateSet(keep.id, keep.sets[0].id, { w: 10, r: 10 });
  F.store.toggleSet(keep.id, keep.sets[0].id);
  const rest = plain(a.rest);

  F.store.swapActiveExercise(e.id, bw);
  const x = a.exercises[1];
  const d = F.q.exercise(bw).defaults;
  assert.equal(x.exId, bw);
  assert.equal(x.target, d.target);
  assert.equal(x.rest, d.rest);
  assert.equal(x.note, '');
  assert.equal(x.sets.length, n);
  const pt = F.util.parseTarget(d.target);
  deq(x.sets.map((s) => [s.w, s.r, s.t, s.done, s.at]), Array(n).fill([null, pt.reps, pt.secs, false, null]), 'no history → prefilled from the target');
  deq(plain(a.rest), rest);

  F.store.swapActiveExercise(e.id, tm);
  const dt = F.q.exercise(tm).defaults;
  assert.equal(a.exercises[1].target, dt.target);
  assert.equal(a.exercises[1].sets.length, n);
  assert.ok(a.exercises[1].sets.every((s) => s.t === F.util.parseTarget(dt.target).secs && s.r === null && !s.done));
});

test('store.swapActiveExercise: time exercise prefills seconds from its last performance; empty entry stays empty', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  const tm = pickEx(F, 'time');
  logWorkout(env, '2026-09-25', [{ exId: tm, sets: [{ t: 40 }, { t: 35 }] }]);
  F.store.startWorkout({ blank: true });
  const e = F.store.addExerciseToActive(w);
  while (e.sets.length < 3) F.store.addSet(e.id);
  while (e.sets.length > 3) F.store.removeSet(e.id, e.sets[e.sets.length - 1].id);
  F.store.swapActiveExercise(e.id, tm);
  deq(F.store.get().active.exercises[0].sets.map((s) => s.t), [40, 35, 35]);
  // every row removed → swap keeps zero rows
  const e2 = F.store.addExerciseToActive(w);
  for (const s of e2.sets.slice()) F.store.removeSet(e2.id, s.id);
  F.store.swapActiveExercise(e2.id, tm);
  assert.equal(F.store.get().active.exercises[1].exId, tm);
  assert.equal(F.store.get().active.exercises[1].sets.length, 0);
});

test('store.swapActiveExercise: silent no-ops', async () => {
  const { F } = fresh();
  const w = pickEx(F, 'weight');
  const w2 = pickEx(F, 'weight', { not: [w] });
  assert.equal(F.store.swapActiveExercise('nope', w2), null, 'no active workout');
  F.store.startWorkout({ blank: true });
  const e = F.store.addExerciseToActive(w);
  const a = F.store.get().active;
  await tick();
  const reasons = spy(F);
  const before = JSON.stringify(a);
  assert.equal(F.store.swapActiveExercise('nope', w2), null);
  assert.equal(F.store.swapActiveExercise(e.id, 'no-such-exercise'), null);
  assert.equal(F.store.swapActiveExercise(e.id, w), null, 'same exercise');
  assert.equal(F.store.swapActiveExercise(e.id, undefined), null);
  assert.equal(JSON.stringify(a), before);
  await tick();
  deq(reasons, []);
});

/* ---------------------------------------------------------------- startWorkout sources */

test('store.startWorkout({ items }): PlanItem-like objects, bare ids and session exercises; defaults fill gaps', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  const bw = pickEx(F, 'bodyweight');
  const tm = pickEx(F, 'time');
  logWorkout(env, '2026-09-26', [{ exId: w, sets: [{ w: 22.5, r: 8 }] }]);
  const a = F.store.startWorkout({ items: [
    { exId: w, sets: 2, target: '5', rest: 30, note: 'go heavy' },
    bw,
    { exId: tm, rest: null },
    { nope: true }, null, { exId: '' }, 42
  ] });
  assert.equal(a.exercises.length, 3, 'invalid items skipped');
  assert.equal(a.title, 'Workout');
  assert.equal(a.dayKey, 'wed', "dayKey defaults to today's key");
  const [e1, e2, e3] = a.exercises;
  deq([e1.exId, e1.target, e1.rest, e1.note, e1.sets.length], [w, '5', 30, 'go heavy', 2]);
  deq(e1.sets.map((s) => [s.w, s.r]), [[22.5, 8], [22.5, 8]], 'prefilled from history');
  const d2 = F.q.exercise(bw).defaults;
  deq([e2.exId, e2.target, e2.rest, e2.sets.length], [bw, d2.target, d2.rest, d2.sets]);
  const d3 = F.q.exercise(tm).defaults;
  deq([e3.exId, e3.target, e3.rest, e3.sets.length], [tm, d3.target, null, d3.sets]);
  assert.ok(e3.sets.every((s) => s.t === F.util.parseTarget(d3.target).secs));
  F.store.discardWorkout();

  // "repeat this session": session.exercises work as items (row count = logged sets)
  const last = F.q.lastSession();
  const again = F.store.startWorkout({ items: last.exercises, title: last.title, dayKey: 'sat' });
  assert.equal(again.title, last.title);
  assert.equal(again.dayKey, 'sat');
  deq(again.exercises.map((x) => [x.exId, x.sets.length]), [[w, 1]]);
  assert.notEqual(again.exercises[0].id, last.exercises[0].id, 'fresh entry ids');
  F.store.discardWorkout();

  // an empty items array means an empty workout (it does NOT fall back to the plan)
  assert.equal(F.store.startWorkout({ items: [] }).exercises.length, 0);
});

test('store.startWorkout({ templateId }): template items + title, today key, priorities and fallbacks', () => {
  const { F } = fresh({ data: 'fixture' });
  const tpl = F.data.program.templates.find((t) => t.id === 'calisthenics-flow');
  const tplBefore = JSON.stringify(tpl);
  const a = F.store.startWorkout({ templateId: 'calisthenics-flow' });
  assert.equal(a.title, 'Calisthenics Flow');
  assert.equal(a.dayKey, 'wed');
  deq(a.exercises.map((e) => [e.exId, e.sets.length, e.target, e.rest, e.note]), tpl.items.map((i) => [i.exId, i.sets, i.target, i.rest, i.note || '']));
  assert.equal(JSON.stringify(tpl), tplBefore, 'template data not mutated');
  assert.equal(F.store.startWorkout({ templateId: 'quick-pump' }), a, 'an active workout is returned unchanged');
  F.store.discardWorkout();

  const b = F.store.startWorkout({ templateId: 'calisthenics-flow', dayKey: 'sun', title: 'Sunday flow' });
  assert.equal(b.dayKey, 'sun');
  assert.equal(b.title, 'Sunday flow');
  F.store.discardWorkout();

  // items beat templateId
  const w = pickEx(F, 'weight');
  const c = F.store.startWorkout({ templateId: 'calisthenics-flow', items: [{ exId: w }] });
  deq(c.exercises.map((e) => e.exId), [w]);
  assert.equal(c.title, 'Workout');
  F.store.discardWorkout();

  // blank beats everything
  const d = F.store.startWorkout({ blank: true, templateId: 'calisthenics-flow' });
  assert.equal(d.exercises.length, 0);
  assert.equal(d.title, 'Quick workout');
  F.store.discardWorkout();

  // unknown template → today's plan (same as no options)
  const plan = F.store.get().plan.days.wed;
  for (const bad of ['nope', 5, null, '']) {
    const e = F.store.startWorkout({ templateId: bad });
    assert.equal(e.title, plan.title);
    deq(e.exercises.map((x) => x.exId), plan.items.map((i) => i.exId));
    F.store.discardWorkout();
  }
  // a missing templates list is survived
  F.data.program.templates = undefined;
  assert.equal(F.store.startWorkout({ templateId: 'calisthenics-flow' }).title, plan.title);
});

test('store.startWorkout({ templateId }): every real template starts with all of its exercises', () => {
  const { F } = fresh();
  const list = (F.data.program && F.data.program.templates) || [];
  for (const t of list) {
    const a = F.store.startWorkout({ templateId: t.id });
    assert.equal(a.title, t.title, t.id);
    deq(a.exercises.map((e) => e.exId), t.items.map((i) => i.exId), t.id);
    assert.ok(a.exercises.every((e) => e.sets.length >= 1));
    F.store.discardWorkout();
  }
});

test('store.startWorkout: plan path unchanged (plan note, rest null → settings, prefill)', () => {
  const { F } = fresh();
  const w = pickEx(F, 'weight');
  F.store.setDay('wed', { title: 'Plan day', rest: false, items: [{ exId: w, sets: 2, target: '6-8', rest: null, note: 'tip' }] });
  const a = F.store.startWorkout();
  assert.equal(a.title, 'Plan day');
  deq(a.exercises.map((e) => [e.exId, e.target, e.rest, e.note, e.sets.length, e.sets[0].r]), [[w, '6-8', null, 'tip', 2, 6]]);
});

/* ---------------------------------------------------------------- restoreCustomExercise */

test('store.removeCustomExercise / restoreCustomExercise: undo keeps id and position', async () => {
  const { F } = fresh();
  const a = F.store.addCustomExercise({ name: 'Towel Row', muscle: 'back', type: 'bodyweight', equipment: ['bodyweight'] });
  const b = F.store.addCustomExercise({ name: 'Sandbag Carry', muscle: 'forearms', type: 'time', equipment: ['bodyweight'] });
  F.store.addPlanItem('mon', a.id);
  const snapshot = plain(a);
  const removed = F.store.removeCustomExercise(a.id);
  deq(plain(removed), { exercise: snapshot, index: 0 });
  assert.equal(F.q.exercise(a.id).missing, true);
  assert.equal(F.store.removeCustomExercise(a.id), null, 'already gone');
  await tick();
  const reasons = spy(F);
  const back = F.store.restoreCustomExercise(removed.exercise, removed.index);
  deq(plain(back), snapshot);
  deq(F.store.get().customExercises.map((e) => e.id), [a.id, b.id], 'back at its old index');
  assert.equal(F.q.exercise(a.id).name, 'Towel Row', 'plan items resolve again');
  await tick();
  deq(reasons, ['library']);
  // duplicates and garbage are no-ops
  assert.equal(F.store.restoreCustomExercise(removed.exercise), null);
  assert.equal(F.store.restoreCustomExercise(null), null);
  assert.equal(F.store.restoreCustomExercise({ name: '  ' }), null);
  assert.equal(F.store.get().customExercises.length, 2);
  // no index → appended; a library id collision gets a fresh custom id
  const rb = F.store.removeCustomExercise(b.id);
  F.store.restoreCustomExercise(rb.exercise);
  deq(F.store.get().customExercises.map((e) => e.id), [a.id, b.id]);
  const lib = F.data.exercises[0].id;
  const clash = F.store.restoreCustomExercise({ id: lib, name: 'Clash', muscle: 'chest' });
  assert.notEqual(clash.id, lib);
  assert.match(clash.id, /^custom-/);
  assert.equal(clash.custom, true);
  assert.equal(F.store.restoreCustomExercise(b, 99), null, 'present id');
});

/* ---------------------------------------------------------------- F.q.alternatives */

test('q.alternatives: exact lists on the fixture (pattern, alts both ways, muscle fallback, equipment, order)', () => {
  const { F } = fresh({ data: 'fixture' });
  const alt = (id) => { const r = F.q.alternatives(id); return { calisthenics: ids(r.calisthenics), weights: ids(r.weights) }; };
  // same pattern first (by level: beginner → advanced), then same muscle; barbell hidden by default
  deq(alt('db-bench-press'), { calisthenics: ['push-up', 'decline-push-up', 'archer-push-up'], weights: ['incline-db-press', 'db-fly'] });
  F.store.setSetting('equipment.barbell', true);
  deq(alt('db-bench-press').weights, ['incline-db-press', 'barbell-bench-press', 'db-fly']);
  F.store.setSetting('equipment.barbell', false);
  // alts listed on the base…
  deq(alt('db-curl'), { calisthenics: ['chin-up'], weights: [] });
  // …and on the candidate (reverse direction); same pattern v-pull too
  deq(alt('chin-up'), { calisthenics: ['pull-up'], weights: ['db-curl'] });
  // alts rank before same-muscle matches; the calisthenics flag (not the type) picks the list,
  // so a timed dumbbell carry is a dumbbell alternative
  deq(alt('db-wrist-curl'), { calisthenics: ['dead-hang'], weights: ['farmers-carry'] });
  deq(alt('dead-hang'), { calisthenics: [], weights: ['db-wrist-curl', 'farmers-carry'] });
  // v-push both ways
  deq(alt('pike-push-up'), { calisthenics: [], weights: ['db-shoulder-press', 'lateral-raise'] });
  // equipment I don't own drops out
  F.store.setSetting('equipment.pullupBar', false);
  deq(alt('db-curl'), { calisthenics: [], weights: [] });
  deq(alt('db-wrist-curl'), { calisthenics: [], weights: ['farmers-carry'] });
  // unknown / bad ids
  for (const bad of ['nope', '', null, undefined, 5]) deq(F.q.alternatives(bad), { calisthenics: [], weights: [] });
});

test('q.alternatives: custom exercises match by muscle only, both as base and as candidates; max 8; copies', () => {
  const { F } = fresh({ data: 'fixture' });
  const mine = F.store.addCustomExercise({ name: 'Band Press', muscle: 'chest', type: 'weight', equipment: ['bodyweight'], level: 'beginner' });
  const r = F.q.alternatives(mine.id);
  deq(ids(r.calisthenics), ['push-up', 'decline-push-up', 'archer-push-up']);
  deq(ids(r.weights), ['db-bench-press', 'incline-db-press', 'db-fly'], 'all tier 1 → level, then library order');
  // as a candidate it ranks with the same-muscle group, after same-pattern moves
  deq(ids(F.q.alternatives('db-bench-press').weights), ['incline-db-press', 'db-fly', mine.id], 'custom ranks after library moves of the same tier and level');
  // a custom exercise needing gear I don't own is excluded
  const gear = F.store.addCustomExercise({ name: 'Cable Fly', muscle: 'chest', equipment: ['cable'] });
  assert.ok(!ids(F.q.alternatives('db-bench-press').weights).includes(gear.id));
  // cap at 8 per list
  for (let i = 0; i < 12; i++) F.store.addCustomExercise({ name: 'Push variation ' + String(i).padStart(2, '0'), muscle: 'chest', type: 'bodyweight', equipment: ['bodyweight'] });
  const big = F.q.alternatives('db-bench-press');
  assert.equal(big.calisthenics.length, 8);
  deq(ids(big.calisthenics).slice(0, 3), ['push-up', 'decline-push-up', 'archer-push-up'], 'same pattern stays on top');
  // callers get copies
  big.calisthenics.length = 0;
  assert.equal(F.q.alternatives('db-bench-press').calisthenics.length, 8);
  // the removed custom exercise disappears (cache invalidates)
  F.store.removeCustomExercise(mine.id);
  assert.ok(!ids(F.q.alternatives('db-bench-press').weights).includes(mine.id));
  deq(F.q.alternatives(mine.id), { calisthenics: [], weights: [] }, 'deleted → unknown');
});

test('q.alternatives: invariants hold for every exercise in the loaded library', () => {
  const { F } = fresh();
  const RANK = { beginner: 0, intermediate: 1, advanced: 2 };
  let withCalis = 0;
  const libIdx = new Map(F.data.exercises.map((e, i) => [e.id, i]));
  for (const base of F.data.exercises) {
    const r = F.q.alternatives(base.id);
    assert.ok(Array.isArray(r.calisthenics) && Array.isArray(r.weights), base.id);
    for (const [kind, list] of Object.entries(r)) {
      assert.ok(list.length <= 8, base.id + ' ' + kind + ' max 8');
      const key = [];
      for (const ex of list) {
        assert.notEqual(ex.id, base.id, 'never itself');
        assert.ok(F.q.canDo(ex), ex.id + ' must be doable');
        const cali = ex.custom ? !!(ex.calisthenics || ex.type !== 'weight') : !!ex.calisthenics;
        assert.equal(kind === 'calisthenics', cali, ex.id + ' in the right list');
        const tier0 = (base.pattern && ex.pattern === base.pattern) || (base.alts || []).includes(ex.id) || (ex.alts || []).includes(base.id);
        assert.ok(tier0 || ex.muscle === base.muscle, ex.id + ' is related to ' + base.id);
        key.push([tier0 ? 0 : 1, RANK[ex.level] ?? 1, libIdx.get(ex.id) ?? 1e6]);
      }
      for (let i = 1; i < key.length; i++) {
        const [a, b] = [key[i - 1], key[i]];
        assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))),
          base.id + ' ' + kind + ' sorted: ' + JSON.stringify(a) + ' then ' + JSON.stringify(b));
      }
      assert.equal(new Set(list.map((e) => e.id)).size, list.length, 'no duplicates');
    }
    if (r.calisthenics.length) withCalis++;
  }
  assert.ok(withCalis > 0, 'some exercise has a calisthenics variation');
});

test('q.alternatives(db-bench-press): push-up variations lead the calisthenics list (real data)', (t) => {
  const { F, dataMode } = fresh();
  const base = F.data.exercises.find((e) => e.id === 'db-bench-press');
  if (!base || !base.pattern) { t.skip('library has no patterns yet (' + dataMode + ')'); return; }
  const r = F.q.alternatives('db-bench-press');
  assert.ok(r.calisthenics.length >= 2, 'several calisthenics variations');
  assert.equal(r.calisthenics[0].pattern, base.pattern, 'same movement pattern first');
  assert.ok(r.calisthenics.some((e) => /push-up/.test(e.id)), 'a push-up variation is offered');
  assert.ok(r.weights.length >= 1);
  assert.ok(r.weights.every((e) => e.type === 'weight' && !e.calisthenics));
  // and back again: from a push-up you can get to a dumbbell press
  const pu = findEx(F, (e) => e.id === 'push-up');
  if (pu) assert.ok(F.q.alternatives('push-up').weights.some((e) => e.pattern === pu.pattern));
});
