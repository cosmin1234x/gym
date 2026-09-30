import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForge, at, tick, plain, pickEx, setWeek, logWorkout } from './harness.mjs';

const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

/** Ensure an active entry has at least n set rows (real library defaults may differ from the fixture). */
function atLeast(F, entry, n) { while (entry.sets.length < n) F.store.addSet(entry.id); return entry; }

function fresh(opts = {}) {
  const env = loadForge(opts);
  env.F.store.init(opts.loaded === undefined ? null : opts.loaded);
  return env;
}
function assertValidState(F, s) {
  const u = F.util;
  assert.equal(s.version, 1);
  assert.ok(s.settings && typeof s.settings === 'object');
  assert.ok(['kg', 'lb'].includes(s.settings.units));
  assert.ok(Number.isFinite(s.settings.waterGoal));
  assert.ok(Array.isArray(s.settings.waterServings) && s.settings.waterServings.length);
  for (const k of u.DAY_KEYS) {
    const d = s.plan.days[k];
    assert.ok(d, 'day ' + k);
    assert.equal(typeof d.title, 'string');
    assert.equal(typeof d.rest, 'boolean');
    assert.ok(Array.isArray(d.focus));
    assert.ok(Array.isArray(d.items));
    for (const it of d.items) { assert.equal(typeof it.id, 'string'); assert.equal(typeof it.exId, 'string'); assert.ok(it.sets >= 1); }
  }
  assert.ok(Array.isArray(s.customExercises));
  assert.ok(Array.isArray(s.sessions));
  assert.ok(s.active === null || typeof s.active === 'object');
  assert.ok(s.water && typeof s.water === 'object' && !Array.isArray(s.water));
  assert.ok(Array.isArray(s.journal));
  assert.ok(Number.isFinite(s.meta.createdAt) && Number.isFinite(s.meta.updatedAt));
  assert.ok(s.meta.stamps && s.meta.celebrated);
  JSON.stringify(s); // serialisable
}

/* ---------------------------------------------------------------- init / normalisation */

test('store.init: defaults and default plan', () => {
  const { F, now } = fresh();
  const s = F.store.get();
  assertValidState(F, s);
  deq(s.settings, {
    name: '', units: 'kg', theme: 'auto', waterGoal: 3000, waterServings: [250, 500, 750], restSeconds: 90,
    sound: true, vibrate: true, keepAwake: true,
    equipment: { pullupBar: true, dumbbells: true, bench: true, barbell: false, bands: false }, onboarded: false
  });
  assert.equal(s.meta.createdAt, now());
  assert.ok(s.plan.days.mon.items.length > 0, 'Monday has exercises');
  // the user's split: Mon–Fri train, Sat & Sun are rest days (details in data.test.mjs)
  for (const k of ['mon', 'tue', 'wed', 'thu', 'fri']) assert.equal(s.plan.days[k].rest, false, k);
  for (const k of ['sat', 'sun']) { assert.equal(s.plan.days[k].rest, true, k); assert.equal(s.plan.days[k].items.length, 0, k); }
  // defaults() returns a fresh object each call (plan ids too)
  const a = F.store.defaults(); const b = F.store.defaults();
  assert.notEqual(a, b);
  assert.notEqual(a.plan.days.mon.items[0].id, b.plan.days.mon.items[0].id);
});

test('store.init: never throws on garbage and always yields a valid state', () => {
  const garbage = [
    null, undefined, 0, 42, '', 'not json', '[]', '{"settings":5}', [], [1, 2], true,
    { settings: null, plan: 'x', sessions: {}, water: [], journal: null, meta: 5, customExercises: 'y', active: 7 },
    { settings: [], plan: { days: [] }, sessions: [null, 1, 'x', { date: 'nope' }], water: { 'bad-key': [{ ml: 5 }], '2026-09-01': 'x' } },
    { plan: { days: { mon: null, tue: [], wed: { items: 'no' }, thu: { items: [null, { exId: 5 }, { sets: 3 }] } } } },
    { sessions: [{ date: '2026-09-01', exercises: [{ exId: 'db-curl', sets: [{ w: 'heavy', r: '8', done: 'yes' }, null] }, { nope: 1 }] }] },
    { journal: [{ text: 5, mood: 9, tags: 'x' }, 'x', null], meta: { createdAt: 'yesterday', stamps: { a: 'x', b: 5 }, celebrated: [] } },
    { active: { date: 'bad' } },
    { active: { date: '2026-09-30', exercises: [{ exId: 'db-curl', sets: [{ w: 10, r: 5, done: true }] }], rest: { endsAt: 'soon' } } },
    JSON.stringify({ settings: { name: 'Sam' } })
  ];
  for (const g of garbage) {
    const { F } = loadForge();
    let s;
    assert.doesNotThrow(() => { s = F.store.init(g); }, 'init(' + JSON.stringify(g) + ')');
    assertValidState(F, s);
  }
  const { F } = loadForge();
  const s = F.store.init(JSON.stringify({ settings: { name: 'Sam' } }));
  assert.equal(s.settings.name, 'Sam'); // JSON strings are accepted
});

test('store.init: merges loaded over defaults, fills new keys, coerces types', () => {
  const { F } = loadForge();
  const s = F.store.init({
    settings: {
      name: 'Alex', units: 'stone', theme: 'purple', waterGoal: '2500', waterServings: [300, 'x', -1, 300, 9999],
      restSeconds: -20, sound: 'yes', vibrate: false, equipment: { barbell: true, kettlebell: true, dumbbells: 'no' },
      futureSetting: { a: 1 }
      // keepAwake / onboarded / bench missing → defaults
    },
    plan: { days: { mon: { title: 'Push', rest: 0, focus: ['chest', 5, 'chest'], items: [{ exId: 'db-curl', sets: '4', target: 8, rest: '75' }, { id: 'dup', exId: 'a' }, { id: 'dup', exId: 'b' }] } } },
    customExercises: [{ name: '  Towel Row ', muscle: 'back', type: 'nope', equipment: ['bodyweight'] }, { name: '' }],
    sessions: [
      { id: 's2', date: '2026-09-20', startedAt: at('2026-09-20', 18), exercises: [] },
      { id: 's1', date: '2026-09-10', startedAt: at('2026-09-10', 18), endedAt: at('2026-09-10', 17), exercises: [{ exId: 'db-curl', sets: [{ w: '12,5', r: 10.4, done: true }] }] },
      { id: 's1', startedAt: at('2026-09-11', 18) }
    ],
    water: { '2026-09-29': [{ ml: 500, at: at('2026-09-29', 12) }, { ml: 0 }, { ml: '250', at: at('2026-09-29', 9) }], '2026-09-28': [] },
    journal: [{ date: '2026-09-29', text: 'ok', mood: '4', energy: 0, sleep: 30, bodyweight: '80.5', tags: ['PR', ' Sore ', 'pr', 3] }],
    meta: { createdAt: at('2026-09-01', 9), stamps: { plan: 10, bad: -1 }, celebrated: { 'water:2026-09-29': 1, x: 0 } }
  });
  assertValidState(F, s);
  assert.equal(s.settings.name, 'Alex');
  assert.equal(s.settings.units, 'kg');
  assert.equal(s.settings.theme, 'auto');
  assert.equal(s.settings.waterGoal, 2500);
  deq(s.settings.waterServings, [300]);
  assert.equal(s.settings.restSeconds, 0);
  assert.equal(s.settings.sound, true);
  assert.equal(s.settings.vibrate, false);
  assert.equal(s.settings.keepAwake, true);
  assert.equal(s.settings.onboarded, false);
  deq(s.settings.equipment, { kettlebell: true, pullupBar: true, dumbbells: true, bench: true, barbell: true, bands: false });
  deq(s.settings.futureSetting, { a: 1 });
  // plan: loaded day kept & coerced, missing days come from the default plan
  assert.equal(s.plan.days.mon.title, 'Push');
  assert.equal(s.plan.days.mon.rest, false);
  deq(s.plan.days.mon.focus, ['chest']);
  const it = s.plan.days.mon.items[0];
  deq({ ...it, id: 'x' }, { id: 'x', exId: 'db-curl', sets: 4, target: '8', rest: 75, note: '' });
  assert.notEqual(s.plan.days.mon.items[1].id, s.plan.days.mon.items[2].id); // duplicate ids repaired
  assert.ok(s.plan.days.tue.items.length > 0);
  // custom exercise normalised
  assert.equal(s.customExercises.length, 1);
  assert.equal(s.customExercises[0].name, 'Towel Row');
  assert.equal(s.customExercises[0].type, 'weight');
  assert.equal(s.customExercises[0].custom, true);
  assert.match(s.customExercises[0].id, /^custom-/);
  // sessions sorted, deduped ids, coerced sets, invalid endedAt dropped
  deq(s.sessions.map((x) => x.date), ['2026-09-10', '2026-09-11', '2026-09-20']);
  assert.equal(new Set(s.sessions.map((x) => x.id)).size, 3);
  const set = s.sessions[0].exercises[0].sets[0];
  assert.equal(set.w, 12.5);
  assert.equal(set.r, 10);
  assert.equal(set.done, true);
  assert.equal(s.sessions[0].endedAt, null);
  // water: invalid entries dropped, sorted by time, empty days removed
  deq(s.water['2026-09-29'].map((e) => e.ml), [250, 500]);
  assert.equal('2026-09-28' in s.water, false);
  // journal coercion
  const j = s.journal[0];
  assert.equal(j.mood, 4);
  assert.equal(j.energy, null);
  assert.equal(j.sleep, null);
  assert.equal(j.bodyweight, 80.5);
  deq(j.tags, ['pr', 'sore']);
  // meta
  assert.equal(s.meta.createdAt, at('2026-09-01', 9));
  deq(s.meta.stamps, { plan: 10 });
  deq(s.meta.celebrated, { 'water:2026-09-29': true });
});

test('store.init: without F.data.program falls back to an empty 7-day plan', () => {
  const env = loadForge();
  env.F.data.program = undefined;
  const s = env.F.store.init(null);
  for (const k of env.F.util.DAY_KEYS) deq(s.plan.days[k], { title: '', rest: false, focus: [], items: [] });
  // a throwing defaultPlan() is also survived
  const env2 = loadForge();
  env2.F.data.program.defaultPlan = () => { throw new Error('boom'); };
  const origErr = console.error; console.error = () => {};
  try { assertValidState(env2.F, env2.F.store.init({ plan: null })); } finally { console.error = origErr; }
});

test('store: createdAt falls back to earliest session when missing', () => {
  const { F } = fresh({ loaded: { sessions: [{ date: '2026-01-05', startedAt: at('2026-01-05', 18), exercises: [] }] } });
  assert.equal(F.store.get().meta.createdAt, at('2026-01-05', 18));
});

/* ---------------------------------------------------------------- notifications */

test('store: notifications are batched per microtask, reasons joined, subscriber errors isolated', async () => {
  const { F } = fresh();
  const calls = [];
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a);
  try {
    F.store.subscribe(() => { throw new Error('bad subscriber'); });
    const un = F.store.subscribe((s, reason) => calls.push(reason));
    F.store.setSetting('name', 'Jo');
    F.store.addWater(250);
    F.store.addWater(250);
    F.store.update((s) => { s.settings.onboarded = true; }, 'custom');
    assert.equal(calls.length, 0, 'not synchronous');
    await tick();
    deq(calls, ['settings water custom']);
    assert.equal(errs.length, 1);
    un();
    F.store.addWater(100);
    await tick();
    assert.equal(calls.length, 1);
    // update() whose mutator returns false still notifies (no accidental no-op)
    const seen = [];
    F.store.subscribe((s, r) => seen.push(r));
    F.store.update((s) => (s.settings.onboarded = false));
    await tick();
    deq(seen, ['']);
    assert.equal(F.store.get().settings.onboarded, false);
  } finally { console.error = origErr; }
});

test('store: update bumps meta.updatedAt and rev; replace keeps object identity', async () => {
  const env = fresh();
  const { F } = env;
  const s = F.store.get();
  const r0 = F.store.rev();
  env.advance(5000);
  F.store.update((st) => { st.settings.name = 'Kim'; }, 'test');
  assert.equal(s.meta.updatedAt, env.now());
  assert.ok(F.store.rev() > r0);
  await tick();
  const reasons = [];
  F.store.subscribe((st, r) => reasons.push(r));
  const out = F.store.replace({ settings: { name: 'Lee' } }, 'import');
  assert.equal(out, s, 'same live object');
  assert.equal(F.store.get().settings.name, 'Lee');
  await tick();
  deq(reasons, ['import']);
  F.store.reset();
  assert.equal(F.store.get(), s);
  assert.equal(s.settings.name, '');
  await tick();
  assert.equal(reasons[1], 'reset');
});

/* ---------------------------------------------------------------- settings & plan */

test('store.setSetting: dotted keys, coercion, no-op when unchanged', async () => {
  const { F } = fresh();
  let n = 0;
  F.store.subscribe(() => n++);
  F.store.setSetting('equipment.barbell', true);
  F.store.setSetting('waterGoal', '2750');
  F.store.setSetting('units', 'lb');
  F.store.setSetting('theme', 'neon');
  await tick();
  const st = F.store.get().settings;
  assert.equal(st.equipment.barbell, true);
  assert.equal(st.waterGoal, 2750);
  assert.equal(st.units, 'lb');
  assert.equal(st.theme, 'auto');
  assert.equal(n, 1);
  const before = F.store.get().meta.updatedAt;
  F.store.setSetting('units', 'lb'); // unchanged
  F.store.setSetting('__proto__.x', 1);
  F.store.setSetting('', 1);
  await tick();
  assert.equal(n, 1);
  assert.equal(F.store.get().meta.updatedAt, before);
  assert.equal({}.x, undefined);
});

test('store: plan mutations (setDay, add/update/remove/insert/move, copyDay, resetPlan) and no-ops', () => {
  const { F } = fresh();
  const s = F.store.get();
  const ex = pickEx(F, 'weight');
  F.store.setDay('mon', { title: 'Push Day', rest: false, focus: ['chest'], items: [] });
  deq(s.plan.days.mon, { title: 'Push Day', rest: false, focus: ['chest'], items: [] });
  const a = F.store.addPlanItem('mon', ex);
  const def = F.q.exercise(ex).defaults;
  assert.equal(a.sets, def.sets);
  assert.equal(a.target, def.target);
  assert.equal(a.rest, def.rest);
  const b = F.store.addPlanItem('mon', ex, { sets: 5, target: '5', rest: null });
  assert.equal(b.sets, 5);
  assert.equal(b.rest, null);
  const c = F.store.addPlanItem('mon', ex, { sets: 99 });
  assert.equal(c.sets, 20);
  F.store.updatePlanItem('mon', b.id, { target: 'AMRAP', note: 'slow', id: 'hijack', sets: 0 });
  assert.equal(s.plan.days.mon.items[1].target, 'AMRAP');
  assert.equal(s.plan.days.mon.items[1].note, 'slow');
  assert.equal(s.plan.days.mon.items[1].id, b.id);
  assert.equal(s.plan.days.mon.items[1].sets, 1);
  F.store.movePlanItem('mon', c.id, 0);
  deq(s.plan.days.mon.items.map((i) => i.id), [c.id, a.id, b.id]);
  F.store.movePlanItem('mon', c.id, 99);
  deq(s.plan.days.mon.items.map((i) => i.id), [a.id, b.id, c.id]);
  const removed = F.store.removePlanItem('mon', a.id);
  assert.equal(removed.index, 0);
  assert.equal(removed.item.id, a.id);
  F.store.insertPlanItem('mon', removed.item, removed.index);
  deq(s.plan.days.mon.items.map((i) => i.id), [a.id, b.id, c.id]);
  F.store.insertPlanItem('mon', removed.item, 0); // already present → no-op
  assert.equal(s.plan.days.mon.items.length, 3);
  F.store.copyDay('mon', 'thu');
  assert.equal(s.plan.days.thu.title, 'Push Day');
  assert.equal(s.plan.days.thu.items.length, 3);
  assert.ok(s.plan.days.thu.items.every((it, i) => it.id !== s.plan.days.mon.items[i].id && it.exId === s.plan.days.mon.items[i].exId));
  s.plan.days.thu.items[0].sets = 1; // deep copy
  assert.notEqual(s.plan.days.mon.items[0].sets, 1);
  // no-ops on bad keys / ids never throw and don't bump updatedAt
  const before = JSON.stringify(s.plan);
  const upd = s.meta.updatedAt;
  assert.equal(F.store.addPlanItem('xyz', ex), null);
  assert.equal(F.store.removePlanItem('mon', 'nope'), null);
  F.store.updatePlanItem('mon', 'nope', { sets: 2 });
  F.store.movePlanItem('mon', 'nope', 1);
  F.store.setDay('funday', { title: 'x' });
  F.store.copyDay('mon', 'mon');
  F.store.copyDay('mon', 'nope');
  F.store.insertPlanItem('mon', { nope: 1 }, 0);
  assert.equal(JSON.stringify(s.plan), before);
  assert.equal(s.meta.updatedAt, upd);
  F.store.resetPlan();
  assert.notEqual(s.plan.days.mon.title, 'Push Day');
  assert.ok(s.plan.days.mon.items.length > 0);
});

test('store: custom exercises CRUD', () => {
  const { F } = fresh();
  const ex = F.store.addCustomExercise({ name: 'Towel Curl', muscle: 'biceps', type: 'weight', equipment: ['bodyweight'], defaults: { sets: 4, target: '10', rest: 45 }, cues: ['Squeeze'] });
  assert.match(ex.id, /^custom-towel-curl-/);
  assert.equal(ex.custom, true);
  assert.equal(F.q.exercise(ex.id).name, 'Towel Curl');
  assert.ok(F.q.allExercises().some((e) => e.id === ex.id));
  F.store.updateCustomExercise(ex.id, { name: 'Towel Hammer Curl', id: 'changed', custom: false });
  assert.equal(F.q.exercise(ex.id).name, 'Towel Hammer Curl');
  assert.equal(F.q.exercise(ex.id).custom, true);
  assert.equal(F.store.addCustomExercise({ name: '   ' }), null);
  assert.equal(F.store.addCustomExercise(null), null);
  F.store.updateCustomExercise('nope', { name: 'x' });
  F.store.removeCustomExercise('nope');
  F.store.removeCustomExercise(ex.id);
  assert.equal(F.q.exercise(ex.id).name, 'Deleted exercise');
  // a custom id colliding with a library id is re-issued
  const lib = F.data.exercises[0].id;
  const s2 = F.store.replace({ customExercises: [{ id: lib, name: 'Clash' }] }, 'import');
  assert.notEqual(s2.customExercises[0].id, lib);
});

/* ---------------------------------------------------------------- workout */

test('store.startWorkout: builds from the plan, prefills from targets, returns existing active', () => {
  const { F } = fresh();
  const w = pickEx(F, 'weight');
  const t = pickEx(F, 'time');
  const bw = pickEx(F, 'bodyweight');
  F.store.setDay('wed', { title: 'Mixed', rest: false, items: [
    { exId: w, sets: 3, target: '8-12', rest: 90, note: 'tempo' },
    { exId: t, sets: 2, target: '45s', rest: null },
    { exId: bw, sets: 2, target: 'AMRAP', rest: 60 }
  ] });
  const a = F.store.startWorkout(); // today is Wednesday
  assert.equal(a.date, '2026-09-30');
  assert.equal(a.dayKey, 'wed');
  assert.equal(a.title, 'Mixed');
  assert.equal(a.endedAt, null);
  assert.equal(a.rest, null);
  assert.equal(a.exercises.length, 3);
  const [e1, e2, e3] = a.exercises;
  assert.equal(e1.exId, w);
  assert.equal(e1.target, '8-12');
  assert.equal(e1.rest, 90);
  assert.equal(e1.note, 'tempo');
  deq(e1.sets.map(({ w: ww, r, t: tt, done, at: when }) => ({ w: ww, r, t: tt, done, at: when })), Array(3).fill({ w: null, r: 8, t: null, done: false, at: null }));
  deq(e2.sets.map((x) => [x.r, x.t]), [[null, 45], [null, 45]]);
  deq(e3.sets.map((x) => [x.r, x.t]), [[null, null], [null, null]]);
  assert.equal(new Set(a.exercises.flatMap((e) => e.sets.map((x) => x.id))).size, 7);
  // second call returns the same active workout unchanged
  const again = F.store.startWorkout({ dayKey: 'mon', blank: true });
  assert.equal(again, a);
  F.store.discardWorkout();
  assert.equal(F.store.get().active, null);
  const blank = F.store.startWorkout({ blank: true, title: 'Garage session' });
  assert.equal(blank.exercises.length, 0);
  assert.equal(blank.title, 'Garage session');
  assert.equal(blank.dayKey, null);
  F.store.discardWorkout();
  const tue = F.store.startWorkout({ dayKey: 'tue' });
  assert.equal(tue.dayKey, 'tue');
  assert.equal(tue.exercises.length, F.store.get().plan.days.tue.items.length);
});

test('store.startWorkout: prefills weights/reps from the most recent performance', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  F.store.setDay('wed', { title: 'W', rest: false, items: [{ exId: w, sets: 3, target: '8-12', rest: 90 }] });
  logWorkout(env, '2026-09-20', [{ exId: w, sets: [{ w: 18, r: 12 }] }]);
  logWorkout(env, '2026-09-23', [{ exId: w, sets: [{ w: 20, r: 10 }, { w: 22.5, r: 8 }] }]);
  const a = F.store.startWorkout();
  deq(a.exercises[0].sets.map((s) => [s.w, s.r, s.done]), [[20, 10, false], [22.5, 8, false], [22.5, 8, false]]);
  // addExerciseToActive prefills the same way and uses exercise defaults for the row count
  const e = F.store.addExerciseToActive(w);
  assert.equal(e.sets.length, F.q.exercise(w).defaults.sets);
  assert.equal(e.sets[0].w, 20);
});

test('store: active workout editing (sets, notes, fields, order) and no-ops', () => {
  const { F } = fresh();
  const w = pickEx(F, 'weight');
  assert.equal(F.store.addExerciseToActive(w), null, 'no active → null');
  F.store.startWorkout({ blank: true });
  const e1 = F.store.addExerciseToActive(w);
  const e2 = F.store.addExerciseToActive(pickEx(F, 'bodyweight'));
  const a = F.store.get().active;
  const s1 = e1.sets[0];
  F.store.updateSet(e1.id, s1.id, { w: '25', r: '6', t: 'x', done: true });
  assert.equal(a.exercises[0].sets[0].w, 25);
  assert.equal(a.exercises[0].sets[0].r, 6);
  assert.equal(a.exercises[0].sets[0].t, null);
  assert.equal(a.exercises[0].sets[0].done, false, 'updateSet never toggles done');
  F.store.updateSet(e1.id, s1.id, { w: '' });
  assert.equal(a.exercises[0].sets[0].w, null);
  F.store.updateSet(e1.id, s1.id, { w: 25 });
  const added = F.store.addSet(e1.id);
  assert.equal(added.w, a.exercises[0].sets[a.exercises[0].sets.length - 2].w);
  assert.equal(added.done, false);
  const n = a.exercises[0].sets.length;
  F.store.removeSet(e1.id, added.id);
  assert.equal(a.exercises[0].sets.length, n - 1);
  F.store.setExerciseNote(e1.id, 'elbows in');
  assert.equal(a.exercises[0].note, 'elbows in');
  F.store.setActiveField('title', 'Evening pump');
  F.store.setActiveField('note', 'felt strong');
  F.store.setActiveField('feeling', 4);
  F.store.setActiveField('startedAt', 0); // not allowed
  assert.equal(a.title, 'Evening pump');
  assert.equal(a.note, 'felt strong');
  assert.equal(a.feeling, 4);
  F.store.setActiveField('feeling', 9);
  assert.equal(a.feeling, null);
  F.store.moveActiveExercise(e2.id, 0);
  deq(a.exercises.map((e) => e.id), [e2.id, e1.id]);
  const rem = F.store.removeExerciseFromActive(e2.id);
  assert.equal(rem.index, 0);
  F.store.insertExerciseToActive(rem.entry, rem.index);
  deq(a.exercises.map((e) => e.id), [e2.id, e1.id]);
  // rest control
  F.store.setRest({ endsAt: Date.now() + 1000, duration: 60, exEntryId: e1.id });
  assert.equal(a.rest.duration, 60);
  F.store.setRest({ endsAt: 'bad' });
  assert.equal(a.rest.duration, 60, 'invalid rest ignored');
  F.store.setRest(null);
  assert.equal(a.rest, null);
  // missing ids → silent no-ops
  const before = JSON.stringify(a);
  F.store.updateSet('nope', s1.id, { w: 1 });
  F.store.updateSet(e1.id, 'nope', { w: 1 });
  assert.equal(F.store.addSet('nope'), null);
  F.store.removeSet(e1.id, 'nope');
  deq(F.store.toggleSet('nope', 'nope'), { done: false, pr: null });
  assert.equal(F.store.removeExerciseFromActive('nope'), null);
  F.store.moveActiveExercise('nope', 0);
  F.store.setExerciseNote('nope', 'x');
  F.store.insertExerciseToActive(rem.entry, 0); // duplicate id
  assert.equal(JSON.stringify(a), before);
});

test('store.toggleSet: done/at, rest timer from entry or settings, untoggle clears its rest', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  F.store.setSetting('restSeconds', 75);
  F.store.startWorkout({ blank: true });
  const e = atLeast(F, F.store.addExerciseToActive(w), 2);
  const a = F.store.get().active;
  a.exercises[0].rest = null; // use settings.restSeconds
  const [s1, s2] = e.sets;
  F.store.updateSet(e.id, s1.id, { w: 20, r: 10 });
  const r1 = F.store.toggleSet(e.id, s1.id);
  deq(r1, { done: true, pr: null }); // first time ever → baseline, no PR
  assert.equal(a.exercises[0].sets[0].done, true);
  assert.equal(a.exercises[0].sets[0].at, env.now());
  deq(a.rest, { endsAt: env.now() + 75000, duration: 75, exEntryId: e.id, setId: s1.id });
  F.store.updatePlanItem('mon', 'x', {});
  a.exercises[0].rest = 30;
  F.store.toggleSet(e.id, s2.id);
  assert.equal(a.rest.duration, 30);
  assert.equal(a.rest.setId, s2.id);
  // un-ticking s1 (not the set that started the current rest) keeps the timer
  const r2 = F.store.toggleSet(e.id, s1.id);
  deq(r2, { done: false, pr: null });
  assert.equal(a.exercises[0].sets[0].at, null);
  assert.equal(a.rest.setId, s2.id);
  // un-ticking s2 cancels its rest
  F.store.toggleSet(e.id, s2.id);
  assert.equal(a.rest, null);
  // rest 0 → no timer
  a.exercises[0].rest = 0;
  F.store.toggleSet(e.id, s1.id);
  assert.equal(a.rest, null);
});

test('store.toggleSet: PR detection vs history AND the other done sets of this workout', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  logWorkout(env, '2026-09-23', [{ exId: w, sets: [{ w: 20, r: 10 }, { w: 20, r: 9 }] }]); // best e1rm 26.67, maxW 20
  F.store.startWorkout({ blank: true });
  const e = F.store.addExerciseToActive(w);
  while (e.sets.length < 4) F.store.addSet(e.id);
  const rows = F.store.get().active.exercises[0].sets;
  const tick1 = (i, ww, r) => { F.store.updateSet(e.id, rows[i].id, { w: ww, r }); return F.store.toggleSet(e.id, rows[i].id); };
  // e1rm 30 > 26.67 → e1rm PR (e1rm checked before weight, per spec)
  deq(tick1(0, 22.5, 10), { done: true, pr: { exId: w, kind: 'e1rm', value: 30, prev: 26.7 } });
  // same set again → not a PR (compared against the first done set of this workout)
  deq(tick1(1, 22.5, 10).pr, null);
  // heavier but lower e1rm (25×3 = 27.5 < 30) → weight PR vs max(20 history, 22.5 this workout)
  deq(tick1(2, 25, 3).pr, { exId: w, kind: 'weight', value: 25, prev: 22.5 });
  // lighter → nothing
  deq(tick1(3, 15, 8).pr, null);
  // toggling the SAME set off and on again re-evaluates without comparing against itself
  F.store.toggleSet(e.id, rows[2].id);
  deq(F.store.toggleSet(e.id, rows[2].id).pr, { exId: w, kind: 'weight', value: 25, prev: 22.5 });
  // …but an identical set elsewhere in the workout means no PR (rows[1] also did 22.5×10)
  F.store.toggleSet(e.id, rows[0].id);
  deq(F.store.toggleSet(e.id, rows[0].id).pr, null);
});

test('store.toggleSet: bodyweight reps / added weight and time PRs', () => {
  const env = fresh();
  const { F } = env;
  const bw = pickEx(F, 'bodyweight');
  const tm = pickEx(F, 'time');
  logWorkout(env, '2026-09-22', [{ exId: bw, sets: [{ r: 8 }, { r: 7, w: 5 }] }, { exId: tm, sets: [{ t: 45 }] }]);
  F.store.startWorkout({ blank: true });
  const eb = atLeast(F, F.store.addExerciseToActive(bw), 2);
  const et = F.store.addExerciseToActive(tm);
  const a = F.store.get().active;
  const b0 = a.exercises[0].sets[0]; const b1 = a.exercises[0].sets[1];
  F.store.updateSet(eb.id, b0.id, { r: 9, w: null });
  deq(F.store.toggleSet(eb.id, b0.id).pr, { exId: bw, kind: 'reps', value: 9, prev: 8 });
  F.store.updateSet(eb.id, b1.id, { r: 6, w: 7.5 });
  deq(F.store.toggleSet(eb.id, b1.id).pr, { exId: bw, kind: 'weight', value: 7.5, prev: 5 });
  const t0 = a.exercises[1].sets[0];
  F.store.updateSet(et.id, t0.id, { t: 60 });
  deq(F.store.toggleSet(et.id, t0.id).pr, { exId: tm, kind: 'time', value: 60, prev: 45 });
});

test('store.finishWorkout: drops undone sets / empty exercises, saves session, returns stats + PRs', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  const w2 = pickEx(F, 'weight', { not: [w] });
  assert.equal(F.store.finishWorkout(), null, 'no active');
  logWorkout(env, '2026-09-23', [{ exId: w, sets: [{ w: 20, r: 10 }] }]);
  env.setDay('2026-09-30', 18);
  F.store.startWorkout({ blank: true });
  const e1 = atLeast(F, F.store.addExerciseToActive(w), 3);
  const e2 = F.store.addExerciseToActive(w2);
  const a = F.store.get().active;
  // nothing done → null, active untouched
  const snapshot = JSON.stringify(a);
  assert.equal(F.store.finishWorkout({ note: 'x' }), null);
  assert.equal(F.store.get().active, a);
  assert.equal(JSON.stringify(a), snapshot);
  const [s1, s2] = a.exercises[0].sets;
  F.store.updateSet(e1.id, s1.id, { w: 25, r: 10 });
  F.store.toggleSet(e1.id, s1.id);
  F.store.updateSet(e1.id, s2.id, { w: 25, r: 8 });
  F.store.toggleSet(e1.id, s2.id);
  env.advance(30 * 60 * 1000);
  const res = F.store.finishWorkout({ note: 'Great', feeling: 5 });
  assert.ok(res);
  const { session, stats, prs } = res;
  assert.equal(F.store.get().active, null);
  assert.equal(session.exercises.length, 1, 'exercise with no done sets dropped');
  assert.equal(session.exercises[0].id, e1.id);
  assert.equal(session.exercises[0].sets.length, 2, 'undone sets dropped');
  assert.ok(session.exercises[0].sets.every((s) => s.done));
  assert.equal(session.note, 'Great');
  assert.equal(session.feeling, 5);
  assert.equal(session.rest, null);
  assert.equal(session.endedAt, env.now());
  assert.equal(stats.sets, 2);
  assert.equal(stats.reps, 18);
  assert.equal(stats.volume, 25 * 10 + 25 * 8);
  assert.equal(stats.exercises, 1);
  assert.equal(stats.durationSec, 30 * 60);
  assert.equal(stats.byMuscle[F.q.exercise(w).muscle], 2);
  deq(prs, [{ exId: w, kind: 'e1rm', value: 33.3, prev: 26.7 }]);
  const saved = F.store.get().sessions;
  assert.equal(saved[saved.length - 1].id, session.id);
  assert.ok(e2);
});

test('store: session history edit / delete / restore (sorted, undo-friendly)', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  const a = logWorkout(env, '2026-09-20', [{ exId: w, sets: [{ w: 10, r: 10 }] }]).session;
  const b = logWorkout(env, '2026-09-25', [{ exId: w, sets: [{ w: 12, r: 10 }] }]).session;
  F.store.updateSession(a.id, { title: 'Renamed', note: 'n', feeling: 3, id: 'hijack' });
  const s = F.store.get();
  assert.equal(s.sessions[0].title, 'Renamed');
  assert.equal(s.sessions[0].id, a.id);
  F.store.updateSession(a.id, { startedAt: at('2026-09-26', 9), date: '2026-09-26' });
  deq(s.sessions.map((x) => x.id), [b.id, a.id], 're-sorted by startedAt');
  const del = F.store.deleteSession(b.id);
  assert.equal(del.index, 0);
  assert.equal(s.sessions.length, 1);
  F.store.restoreSession(del.session);
  deq(s.sessions.map((x) => x.id), [b.id, a.id]);
  F.store.restoreSession(del.session); // duplicate → no-op
  assert.equal(s.sessions.length, 2);
  assert.equal(F.store.deleteSession('nope'), null);
  F.store.updateSession('nope', { title: 'x' });
});

/* ---------------------------------------------------------------- water & journal */

test('store: water add / remove / restore', () => {
  const env = fresh();
  const { F } = env;
  const e1 = F.store.addWater(250);
  env.advance(60000);
  const e2 = F.store.addWater('500');
  assert.equal(F.store.addWater(0), null);
  assert.equal(F.store.addWater(-5), null);
  assert.equal(F.store.addWater('abc'), null);
  assert.equal(F.store.addWater(250, 'not-a-date'), null);
  const y = F.store.addWater(1000, '2026-09-29');
  const s = F.store.get();
  deq(s.water['2026-09-30'].map((e) => e.ml), [250, 500]);
  assert.equal(e2.at, env.now());
  assert.equal(F.q.waterTotal('2026-09-30'), 750);
  const removed = F.store.removeWater('2026-09-30', e1.id);
  assert.equal(removed.id, e1.id);
  F.store.restoreWater('2026-09-30', removed);
  deq(s.water['2026-09-30'].map((e) => e.id), [e1.id, e2.id]);
  F.store.restoreWater('2026-09-30', removed); // duplicate
  assert.equal(s.water['2026-09-30'].length, 2);
  F.store.removeWater('2026-09-29', y.id);
  assert.equal('2026-09-29' in s.water, false, 'empty day removed');
  assert.equal(F.store.removeWater('2026-09-29', y.id), null);
  assert.equal(F.store.removeWater('nope', 'nope'), null);
  assert.equal(F.store.addWater(99999).ml, 5000, 'clamped');
});

test('store: journal save (create + upsert) / delete / restore', () => {
  const env = fresh();
  const { F } = env;
  const e = F.store.saveJournal({ text: 'First entry', mood: 4, tags: ['Motivated'] });
  assert.match(e.id, /^j-/);
  assert.equal(e.date, '2026-09-30');
  assert.equal(e.createdAt, env.now());
  assert.equal(e.updatedAt, env.now());
  deq(e.tags, ['motivated']);
  assert.equal(e.pinned, false);
  env.advance(60000);
  const e2 = F.store.saveJournal({ id: e.id, title: 'Day 1', pinned: true });
  assert.equal(e2.text, 'First entry', 'upsert merges into the existing entry');
  assert.equal(e2.title, 'Day 1');
  assert.equal(e2.pinned, true);
  assert.equal(e2.createdAt, e.createdAt);
  assert.equal(e2.updatedAt, env.now());
  assert.equal(F.store.get().journal.length, 1);
  const other = F.store.saveJournal({ id: 'imported-1', date: '2026-09-01', text: 'old', bodyweight: 81.2, sleep: 7.5 });
  assert.equal(other.id, 'imported-1');
  assert.equal(F.store.get().journal.length, 2);
  const del = F.store.deleteJournal(e.id);
  assert.equal(del.id, e.id);
  assert.equal(F.store.get().journal.length, 1);
  F.store.restoreJournal(del);
  F.store.restoreJournal(del);
  assert.equal(F.store.get().journal.length, 2);
  assert.equal(F.store.deleteJournal('nope'), null);
  assert.equal(F.store.saveJournal(null), null);
  F.store.markCelebrated('water:2026-09-30');
  assert.equal(F.store.get().meta.celebrated['water:2026-09-30'], true);
});

test('store: mutations call F.persist.schedule', () => {
  const { F } = fresh();
  let n = 0;
  F.persist.schedule = () => { n++; };
  F.store.addWater(100);
  F.store.setSetting('name', 'Q');
  F.store.removeWater('nope', 'nope'); // no-op → no schedule
  assert.equal(n, 2);
});

test('store: setWeek helper + logWorkout helper produce sessions on the right days', () => {
  const env = fresh();
  const { F } = env;
  const w = pickEx(F, 'weight');
  setWeek(F, w, ['sun']);
  const { session } = logWorkout(env, '2026-09-28', [{ exId: w, sets: [{ w: 10, r: 5 }] }]);
  assert.equal(session.date, '2026-09-28');
  assert.equal(F.q.trainedOn('2026-09-28'), true);
});
