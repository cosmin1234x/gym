// Data contract checks for the user's split (SPEC §6.2), movement patterns (§6.4), the forearms
// muscle group and its teal plate (§2.1). They run against the real js/data files (or the fixture
// when FORGE_FIXTURE=1) and assert SPEC semantics — focus muscles, rest days, valid references —
// rather than exact titles or exercise lists, so the library can keep evolving.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadForge, makeDocument, plain } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

const PATTERNS = ['h-push', 'v-push', 'h-pull', 'v-pull', 'elbow-flex', 'elbow-ext', 'fly', 'raise', 'shrug', 'wrist',
  'carry', 'squat', 'hinge', 'lunge', 'calf', 'core-flex', 'core-stab', 'hang', 'skill', 'conditioning'];
const PLATES = ['red', 'blue', 'yellow', 'green', 'white', 'orange', 'violet', 'teal'];
const MUSCLE_PLATES = { chest: 'red', back: 'blue', biceps: 'yellow', triceps: 'green', shoulders: 'orange', forearms: 'teal', legs: 'violet', core: 'white', fullbody: 'white' };
// SPEC §6.2: Mon Chest & Biceps · Tue Back & Triceps · Wed Shoulders & Forearms · Thu Legs · Fri Push · Sat/Sun off
const SPLIT = { mon: ['chest', 'biceps'], tue: ['back', 'triceps'], wed: ['shoulders', 'forearms'], thu: ['legs'], fri: ['chest', 'shoulders', 'triceps'] };

function env() {
  const e = loadForge();
  e.F.store.init(null);
  return e;
}

test('data: MUSCLES has forearms on the teal plate; every muscle maps to its SPEC plate', () => {
  const { F } = env();
  const M = F.data.program.MUSCLES;
  deq(Object.keys(M).sort(), Object.keys(MUSCLE_PLATES).sort());
  for (const [k, plate] of Object.entries(MUSCLE_PLATES)) {
    assert.equal(M[k].plate, plate, k);
    assert.ok(typeof M[k].label === 'string' && M[k].label, k + ' label');
  }
  assert.equal(M.forearms.label, 'Forearms');
  if (typeof F.data.program.plateFor === 'function') assert.equal(F.data.program.plateFor('forearms'), 'teal');
});

test('data: every library exercise has a SPEC pattern, valid muscles, equipment and alts', () => {
  const { F } = env();
  const lib = F.data.exercises;
  const byId = new Map(lib.map((e) => [e.id, e]));
  assert.equal(byId.size, lib.length, 'ids are unique');
  const M = F.data.program.MUSCLES;
  const EQ = Object.keys(F.data.program.EQUIPMENT || {});
  for (const e of lib) {
    assert.ok(PATTERNS.includes(e.pattern), e.id + ' pattern ' + e.pattern);
    assert.ok(M[e.muscle], e.id + ' muscle ' + e.muscle);
    for (const m of e.secondary || []) assert.ok(M[m], e.id + ' secondary ' + m);
    assert.ok(['weight', 'bodyweight', 'time'].includes(e.type), e.id + ' type');
    assert.ok(['beginner', 'intermediate', 'advanced'].includes(e.level), e.id + ' level');
    if (EQ.length) for (const k of e.equipment) assert.ok(EQ.includes(k), e.id + ' equipment ' + k);
    if (e.alts !== undefined) {
      assert.ok(Array.isArray(e.alts), e.id + ' alts is an array');
      for (const a of e.alts) {
        assert.ok(byId.has(a), e.id + ' alt ' + a + ' exists');
        assert.notEqual(a, e.id, e.id + ' does not list itself');
      }
    }
  }
  const forearms = lib.filter((e) => e.muscle === 'forearms' && F.q.canDo(e));
  assert.ok(forearms.length >= 2, 'forearm work exists for the home-gym equipment');
});

test('data: defaultPlan follows the user\'s split (focus, rest days, calisthenics every training day)', () => {
  const { F } = env();
  const plan = F.data.program.defaultPlan();
  const again = F.data.program.defaultPlan();
  for (const [k, focus] of Object.entries(SPLIT)) {
    const d = plan.days[k];
    assert.equal(d.rest, false, k + ' is a training day');
    for (const m of focus) assert.ok(d.focus.includes(m), k + ' focus includes ' + m);
    assert.ok(typeof d.title === 'string' && d.title.trim(), k + ' has a title');
    assert.ok(d.items.length >= 4, k + ' has a real workout');
    const exs = d.items.map((it) => F.q.exercise(it.exId));
    for (const ex of exs) {
      assert.ok(!ex.missing, k + ': ' + ex.id + ' exists');
      assert.ok(F.q.canDo(ex), k + ': ' + ex.id + ' fits dumbbells + pull-up bar + bench');
    }
    assert.ok(exs.some((ex) => ex.calisthenics), k + ' mixes in a calisthenics variation');
    const muscles = new Set(exs.map((ex) => ex.muscle));
    for (const m of focus) assert.ok(muscles.has(m), k + ' trains ' + m);
    assert.notEqual(d.items[0].id, again.days[k].items[0].id, 'fresh ids per call');
  }
  for (const k of ['sat', 'sun']) {
    assert.equal(plan.days[k].rest, true, k + ' is a rest day');
    deq(plan.days[k].items, [], k + ' has no exercises');
  }
  // the store's default state uses it, and those days read as rest
  const s = F.store.get();
  assert.equal(s.plan.days.sat.rest, true);
  assert.equal(F.q.dayStatus('2026-10-03').isRest, true, 'Saturday');
  assert.equal(F.q.dayStatus('2026-10-02').isRest, false, 'Friday');
  deq(s.plan.days.wed.focus.filter((m) => m === 'shoulders' || m === 'forearms').sort(), ['forearms', 'shoulders']);
});

test('data: templates reference real exercises; rest-day templates are flagged and startable', () => {
  const { F } = env();
  const P = F.data.program;
  const list = P.templates || [];
  assert.equal(new Set(list.map((t) => t.id)).size, list.length, 'template ids unique');
  for (const t of list) {
    assert.ok(t.title && Array.isArray(t.items) && t.items.length, t.id);
    for (const it of t.items) assert.ok(!F.q.exercise(it.exId).missing, t.id + ': ' + it.exId);
  }
  const restIds = P.restDayTemplateIds;
  assert.ok(Array.isArray(restIds) && restIds.length >= 1, 'rest days offer at least one optional session');
  for (const id of restIds) {
    const t = list.find((x) => x.id === id);
    assert.ok(t, id + ' exists');
    assert.equal(t.restDay, true, id + ' is flagged restDay');
    const exs = t.items.map((i) => F.q.exercise(i.exId));
    assert.ok(exs.every((e) => F.q.canDo(e)), id + ' fits the home gym');
    assert.ok(exs.some((e) => e.calisthenics), id + ' is calisthenics');
    const a = F.store.startWorkout({ templateId: id });
    assert.equal(a.title, t.title);
    assert.equal(a.exercises.length, t.items.length);
    F.store.discardWorkout();
  }
});

test('ui: forearms → teal plate (F.ui.plateOf / plateDot) even without program data', () => {
  const e = loadForge({ document: makeDocument() });
  const run = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), e.ctx, { filename: rel });
  run('js/core/ui.js');
  const { F } = e;
  assert.equal(F.ui.plateOf('forearms'), 'teal');
  assert.equal(F.ui.plateOf('teal'), 'teal');
  assert.equal(F.ui.plateOf('shoulders'), 'orange');
  assert.equal(F.ui.plateOf('nope'), null);
  F.data.program = undefined;
  assert.equal(F.ui.plateOf('forearms'), 'teal', 'built-in map');
  const dot = F.ui.plateDot('forearms');
  assert.equal(dot.dataset.plate || dot.getAttribute('data-plate'), 'teal');
});

test('tokens.css: teal plate + forearms alias on :root, both light blocks and the data-plate helper', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/tokens.css'), 'utf8');
  const lightAuto = css.slice(css.indexOf('@media (prefers-color-scheme: light)'));
  const forced = css.slice(css.indexOf(':root[data-theme="light"]'));
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  for (const p of PLATES) {
    assert.match(rootBlock, new RegExp('--plate-' + p + ':\\s*#[0-9a-f]{6};'), ':root --plate-' + p);
    assert.match(lightAuto.slice(0, lightAuto.indexOf('}')), new RegExp('--plate-' + p + ':'), 'auto-light --plate-' + p);
    assert.match(forced.slice(0, forced.indexOf('}')), new RegExp('--plate-' + p + ':'), 'forced-light --plate-' + p);
    assert.match(css, new RegExp('\\[data-plate="' + p + '"\\]\\s*\\{\\s*--plate:\\s*var\\(--plate-' + p + '\\)'), 'helper ' + p);
  }
  for (const [m, p] of Object.entries(MUSCLE_PLATES)) assert.match(rootBlock, new RegExp('--m-' + m + ':\\s*var\\(--plate-' + p + '\\);'), '--m-' + m);
  // contrast: teal reads on the rubber-black floor and (deepened) on chalk
  const hex = (v) => [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lum = (v) => { const [r, g, b] = hex(v).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const val = (block, name) => (block.match(new RegExp(name + ':\\s*(#[0-9a-f]{6})')) || [])[1];
  const darkTeal = val(rootBlock, '--plate-teal');
  const lightTeal = val(forced, '--plate-teal');
  assert.equal(val(lightAuto, '--plate-teal'), lightTeal, 'both light blocks agree');
  assert.ok(ratio(darkTeal, val(rootBlock, '--bg')) >= 4.5, 'dark teal on bg');
  assert.ok(ratio(lightTeal, val(forced, '--bg')) >= 3, 'light teal on chalk bg');
  assert.ok(ratio(lightTeal, '#ffffff') >= 4.5, 'white text on light teal fill');
});
