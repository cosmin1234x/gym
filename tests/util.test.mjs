import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadForge, at, withTZ, makeDocument, MemoryStorage, tick, plain } from './harness.mjs';

const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

/* ---------------------------------------------------------------- dates */

test('util: ISO helpers use the local calendar (not UTC)', async () => {
  // 00:30 local on 1 Oct in Auckland is still 30 Sep in UTC — toISOString() would be wrong.
  await withTZ('Pacific/Auckland', () => {
    const { F } = loadForge({ now: at('2026-10-01', 0, 30) });
    assert.equal(F.util.todayISO(), '2026-10-01');
    assert.equal(F.util.toISO(new Date(2026, 9, 1, 0, 30)), '2026-10-01');
  });
  // 23:30 local on 30 Sep in Los Angeles is already 1 Oct in UTC.
  await withTZ('America/Los_Angeles', () => {
    const { F } = loadForge({ now: at('2026-09-30', 23, 30) });
    assert.equal(F.util.todayISO(), '2026-09-30');
    assert.equal(F.util.isToday('2026-09-30'), true);
    assert.equal(F.util.fmtRelDay('2026-10-01'), 'Tomorrow');
  });
});

test('util: toISO / fromISO / isISO edge cases', () => {
  const { F } = loadForge();
  const u = F.util;
  assert.equal(u.toISO(at('2026-02-03', 9)), '2026-02-03');       // timestamp
  assert.equal(u.toISO('2026-02-03'), '2026-02-03');              // passthrough
  assert.equal(u.toISO('nonsense'), '');
  assert.equal(u.toISO(new Date(NaN)), '');
  assert.equal(u.toISO(null), '');
  const d = u.fromISO('2026-03-29');
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 29);
  assert.ok(Number.isNaN(u.fromISO('2026-02-30').getTime()));
  assert.equal(u.isISO('2024-02-29'), true);
  assert.equal(u.isISO('2026-02-29'), false);
  assert.equal(u.isISO('2026-13-01'), false);
  assert.equal(u.isISO('2026-1-01'), false);
});

test('util: addDays / diffDays are DST-safe (Europe/London)', () => {
  const { F } = loadForge();
  const u = F.util;
  // Clocks go forward Sun 29 Mar 2026, back Sun 25 Oct 2026.
  assert.equal(u.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(u.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(u.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(u.addDays('2026-10-26', -2), '2026-10-24');
  assert.equal(u.diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(u.diffDays('2026-10-24', '2026-10-26'), 2);
  assert.equal(u.diffDays('2026-10-26', '2026-10-24'), -2);
  assert.equal(u.diffDays('2026-01-01', '2027-01-01'), 365);
  assert.equal(u.diffDays('2024-02-28', '2024-03-01'), 2);
  assert.equal(u.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(u.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(u.diffDays('bad', '2026-01-01'), 0);
  // walking a whole year one day at a time never skips or repeats across both DST changes
  let d = '2026-01-01';
  for (let i = 0; i < 365; i++) {
    const n = u.addDays(d, 1);
    assert.equal(u.diffDays(d, n), 1, 'step from ' + d);
    d = n;
  }
  assert.equal(d, '2027-01-01');
});

test('util: day keys and Monday-based weeks', () => {
  const { F } = loadForge();
  const u = F.util;
  deq(u.DAY_KEYS, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  assert.equal(u.dayKeyOf('2026-09-30'), 'wed');
  assert.equal(u.dayKeyOf('2026-09-28'), 'mon');
  assert.equal(u.dayKeyOf('2026-10-04'), 'sun');
  assert.equal(u.dayKeyOf('2026-03-29'), 'sun'); // DST day
  assert.equal(u.weekStart('2026-09-30'), '2026-09-28');
  assert.equal(u.weekStart('2026-10-04'), '2026-09-28'); // Sunday belongs to the week that started Monday
  assert.equal(u.weekStart('2026-09-28'), '2026-09-28');
  assert.equal(u.weekStart('2026-03-29'), '2026-03-23');
  deq(u.weekDates('2026-09-30'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  deq(u.weekDates('2026-10-25').slice(0, 1), ['2026-10-19']);
  assert.equal(u.DAY_SHORT.tue, 'Tue');
  assert.equal(u.DAY_LONG.sun, 'Sunday');
});

test('util: date / time formatting', () => {
  const { F } = loadForge({ now: at('2026-09-30', 10) });
  const u = F.util;
  assert.equal(u.fmtDate('2026-09-29'), 'Tue 29 Sep');
  assert.equal(u.fmtDate('2026-09-29', 'short'), 'Tue 29 Sep');
  assert.equal(u.fmtDate('2026-09-29', 'long'), 'Tuesday 29 September');
  assert.equal(u.fmtDate('2026-09-29', 'dm'), '29 Sep');
  assert.equal(u.fmtDate('2026-09-29', 'month'), 'September 2026');
  assert.equal(u.fmtDate('2026-09-09', 'day'), '9');
  assert.equal(u.fmtDate('2026-09-29', 'wd'), 'Tue');
  assert.equal(u.fmtDate('2026-09-29', 'dmy'), '29 Sep 2026');
  assert.equal(u.fmtDate('garbage'), '');
  assert.equal(u.fmtRelDay('2026-09-30'), 'Today');
  assert.equal(u.fmtRelDay('2026-09-29'), 'Yesterday');
  assert.equal(u.fmtRelDay('2026-10-01'), 'Tomorrow');
  assert.equal(u.fmtRelDay('2026-09-20'), 'Sun 20 Sep');
  assert.equal(u.fmtTime(at('2026-09-30', 18, 42)), '18:42');
  assert.equal(u.fmtTime(at('2026-09-30', 7, 5)), '07:05');
  assert.equal(u.fmtTime(null), '');
  assert.equal(u.fmtClock(65), '1:05');
  assert.equal(u.fmtClock(3723), '1:02:03');
  assert.equal(u.fmtClock(0), '0:00');
  assert.equal(u.fmtClock(-5), '0:00');
  assert.equal(u.fmtClock(59.9), '0:59');
  assert.equal(u.fmtDuration(35), '35s');
  assert.equal(u.fmtDuration(42 * 60), '42m');
  assert.equal(u.fmtDuration(3900), '1h 05m');
  assert.equal(u.fmtDuration(3600), '1h 00m');
  assert.equal(u.fmtDuration(59.6 * 60), '1h 00m');
  assert.equal(u.fmtDuration(NaN), '0s');
});

/* ---------------------------------------------------------------- numbers & units */

test('util: number formatting and collection helpers', () => {
  const { F } = loadForge();
  const u = F.util;
  assert.equal(u.fmtNum(12450), '12,450');
  assert.equal(u.fmtNum(1234567.891, 2), '1,234,567.89');
  assert.equal(u.fmtNum(22.5, 1), '22.5');
  assert.equal(u.fmtNum(22, 2), '22');
  assert.equal(u.fmtNum(-1234.5), '-1,235');
  assert.equal(u.fmtNum(-0.2), '0');
  assert.equal(u.fmtNum(NaN), '0');
  assert.equal(u.round(1.005, 2), 1.01);
  assert.equal(u.round(2.5), 3);
  assert.equal(u.round(Infinity), 0);
  assert.equal(u.clamp(5, 0, 3), 3);
  assert.equal(u.clamp(-1, 0, 3), 0);
  assert.equal(u.clamp(NaN, 1, 3), 1);
  assert.equal(u.sum([1, 2, 'x', 3]), 6);
  assert.equal(u.sum([{ a: 2 }, { a: 3 }], (x) => x.a), 5);
  assert.equal(u.sum(null), 0);
  assert.equal(u.avg([2, 4]), 3);
  assert.equal(u.avg([]), 0);
  assert.equal(u.maxBy([{ v: 1 }, { v: 7 }, { v: 3 }], (x) => x.v).v, 7);
  assert.equal(u.maxBy([], (x) => x), null);
  const g = u.groupBy([{ k: 'a' }, { k: 'b' }, { k: 'a' }], (x) => x.k);
  assert.equal(g.a.length, 2);
  assert.equal(g.b.length, 1);
  deq(u.clone({ a: [1, { b: 2 }] }), { a: [1, { b: 2 }] });
  assert.equal(u.clone(undefined), undefined);
  assert.equal(u.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(u.esc(null), '');
  const ids = new Set(Array.from({ length: 2000 }, () => u.uid('x-')));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^x-[0-9a-z]+$/);
});

test('util: kg/lb conversions round-trip and formatting', () => {
  const { F } = loadForge();
  const u = F.util;
  assert.equal(u.LB_PER_KG, 2.20462);
  assert.equal(u.toDisplayWeight(20, 'kg'), 20);
  assert.equal(u.toDisplayWeight(22.25, 'kg'), 22.25);      // 1.25 kg plates survive
  assert.equal(u.toDisplayWeight(20, 'lb'), 44.1);
  assert.equal(u.toDisplayWeight(null, 'kg'), null);
  assert.equal(u.toDisplayWeight('', 'lb'), null);
  assert.equal(u.fromDisplayWeight('22,5', 'kg'), 22.5);
  assert.equal(u.fromDisplayWeight('', 'kg'), null);
  assert.equal(u.fromDisplayWeight('abc', 'lb'), null);
  // every 0.1 lb value 0..600 lb survives display → kg → display
  for (let tenth = 0; tenth <= 6000; tenth += 7) {
    const lb = tenth / 10;
    assert.equal(u.toDisplayWeight(u.fromDisplayWeight(lb, 'lb'), 'lb'), lb, 'lb ' + lb);
  }
  for (let q = 0; q <= 1200; q += 5) {
    const kg = q / 4; // 0.25 kg steps
    assert.equal(u.toDisplayWeight(u.fromDisplayWeight(kg, 'kg'), 'kg'), kg);
  }
  assert.equal(u.fmtWeight(22.5, 'kg'), '22.5 kg');
  assert.equal(u.fmtWeight(22.5, 'lb'), '49.6 lb');
  assert.equal(u.fmtWeight(20, 'kg', { unit: false }), '20');
  assert.equal(u.fmtWeight(null, 'kg'), '—');
  assert.equal(u.fmtVolume(12450, 'kg'), '12,450 kg');
  assert.equal(u.fmtVolume(1000, 'lb'), '2,205 lb');
  assert.equal(u.fmtMl(750), '750 ml');
  assert.equal(u.fmtMl(2250), '2.25 L');
  assert.equal(u.fmtMl(3000), '3 L');
  assert.equal(u.fmtMl(-5), '0 ml');
  // units default to the user's setting when omitted
  F.store.init({ settings: { units: 'lb' } });
  assert.equal(u.fmtWeight(20), '44.1 lb');
});

test('util: e1rm (Epley) and parseTarget', () => {
  const { F } = loadForge();
  const u = F.util;
  assert.equal(u.e1rm(100, 1), 100);
  assert.ok(Math.abs(u.e1rm(100, 10) - 133.333) < 0.001);
  assert.equal(u.e1rm(100, 0), 0);
  assert.equal(u.e1rm(0, 10), 0);
  assert.equal(u.e1rm(null, 5), 0);
  assert.equal(u.e1rm(-10, 5), 0);
  const T = (s) => u.parseTarget(s);
  deq(T('8-12'), { reps: 8, secs: null, amrap: false });
  deq(T('8–12'), { reps: 8, secs: null, amrap: false });
  deq(T('12'), { reps: 12, secs: null, amrap: false });
  deq(T('30s'), { reps: null, secs: 30, amrap: false });
  deq(T('45 sec'), { reps: null, secs: 45, amrap: false });
  deq(T('1:00'), { reps: null, secs: 60, amrap: false });
  deq(T('1:30'), { reps: null, secs: 90, amrap: false });
  deq(T('2 min'), { reps: null, secs: 120, amrap: false });
  deq(T('30-45s'), { reps: null, secs: 30, amrap: false });
  deq(T('AMRAP'), { reps: null, secs: null, amrap: true });
  deq(T('amrap'), { reps: null, secs: null, amrap: true });
  deq(T('max'), { reps: null, secs: null, amrap: true });
  deq(T('5 reps'), { reps: 5, secs: null, amrap: false });
  deq(T(''), { reps: null, secs: null, amrap: false });
  deq(T(null), { reps: null, secs: null, amrap: false });
  deq(T(10), { reps: 10, secs: null, amrap: false });
});

/* ---------------------------------------------------------------- timing helpers */

test('util: debounce / throttle / wait', async () => {
  const { F } = loadForge();
  const u = F.util;
  let n = 0; let last = null;
  const d = u.debounce((x) => { n++; last = x; }, 15);
  d(1); d(2); d(3);
  await tick(40);
  assert.equal(n, 1);
  assert.equal(last, 3);
  d(4); d.cancel();
  await tick(30);
  assert.equal(n, 1);
  d(5); d.flush();
  assert.equal(n, 2);
  assert.equal(last, 5);
  let m = 0;
  const t = u.throttle(() => { m++; }, 1000);
  t(); t(); t();
  assert.equal(m, 1); // leading call only (clock is frozen in the harness)
  t.cancel();
  const t0 = Date.now();
  await u.wait(10);
  assert.ok(Date.now() - t0 >= 8);
});

/* ---------------------------------------------------------------- storage */

test('util: storage wrapper survives missing / throwing localStorage', () => {
  const ok = loadForge({ storage: new MemoryStorage() });
  assert.equal(ok.F.util.storage.set('k', { a: 1 }), true);
  deq({ ...ok.F.util.storage.get('k') }, { a: 1 });
  assert.equal(ok.F.util.storage.get('missing', 7), 7);
  ok.storage.setItem('bad', '{not json');
  assert.equal(ok.F.util.storage.get('bad', 'fb'), 'fb');
  ok.F.util.storage.remove('k');
  assert.equal(ok.F.util.storage.get('k'), null);

  const denied = loadForge({ storage: new MemoryStorage({ throwOnAccess: true }) });
  assert.equal(denied.F.util.storage.set('k', 1), false);
  assert.equal(denied.F.util.storage.get('k', 'fb'), 'fb');
  assert.doesNotThrow(() => denied.F.util.storage.remove('k'));

  const none = loadForge({ storage: null });
  assert.equal(none.F.util.storage.set('k', 1), false);
  assert.equal(none.F.util.storage.get('k', 2), 2);

  const full = loadForge({ storage: new MemoryStorage({ quotaChars: 10 }) });
  assert.equal(full.F.util.storage.set('k', 'x'.repeat(100)), false);
});

/* ---------------------------------------------------------------- DOM builder */

test('util.h: tag shorthand, classes, props, attrs, events, children', () => {
  const document = makeDocument();
  const { F } = loadForge({ document });
  const h = F.util.h;
  let clicks = 0; let inputs = 0; let refEl = null;
  const el = h('button.btn.btn--primary#go', {
    class: ['is-active', false, null, '', 'extra'],
    type: 'button',
    style: { color: 'red', '--i': 3, display: null },
    dataset: { exId: 'db-curl', skip: null },
    attrs: { 'aria-pressed': 'false', hidden: false },
    'aria-label': 'Start workout',
    'aria-expanded': false,
    'data-plate': 'red',
    title: 'Go',
    disabled: true,
    tabindex: 0,
    role: 'switch',
    on: { click: () => clicks++ },
    onInput: () => inputs++,
    ref: (e) => { refEl = e; }
  }, 'Start ', 3, null, false, true, undefined, ['<b>not html</b>', [h('span', null, 'deep')]]);

  assert.equal(el.tagName, 'BUTTON');
  assert.equal(el.id, 'go');
  assert.equal(el.className, 'btn btn--primary is-active extra');
  assert.equal(el.type, 'button');
  assert.equal(el.style.color, 'red');
  assert.equal(el.style._props['--i'], '3');
  assert.equal(el.style.display, undefined);
  assert.equal(el.dataset.exId, 'db-curl');
  assert.equal('skip' in el.dataset, false);
  assert.equal(el.getAttribute('aria-pressed'), 'false');
  assert.equal(el.hasAttribute('hidden'), false);
  assert.equal(el.getAttribute('aria-label'), 'Start workout');
  assert.equal(el.getAttribute('aria-expanded'), 'false');
  assert.equal(el.getAttribute('data-plate'), 'red');
  assert.equal(el.getAttribute('tabindex'), '0');
  assert.equal(el.getAttribute('role'), 'switch');
  assert.equal(el.disabled, true);
  assert.equal(el.title, 'Go');
  el.dispatch('click'); el.dispatch('input');
  assert.equal(clicks, 1);
  assert.equal(inputs, 1);
  assert.equal(refEl, el);
  // children: text nodes (XSS-safe) + nested arrays flattened; null/false/true/undefined skipped
  deq(el.childNodes.map((n) => n.nodeType), [3, 3, 3, 1]);
  assert.equal(el.textContent, 'Start 3<b>not html</b>deep');
  assert.equal(el._html, undefined);
});

test('util.h: props omitted, text/html, for, deferred select value, read-only props, svg', () => {
  const document = makeDocument();
  const env = loadForge({ document });
  const { F } = env;
  const h = F.util.h;
  const child = h('i');
  const a = h('div', child, 'x');                // props omitted → first arg is a child
  assert.equal(a.childNodes.length, 2);
  const b = h('p', 'hello');
  assert.equal(b.textContent, 'hello');
  const c = h('.card', { text: '<script>' });      // tag defaults to div
  assert.equal(c.tagName, 'DIV');
  assert.equal(c.className, 'card');
  assert.equal(c.textContent, '<script>');
  const d = h('span', { html: '<svg></svg>' });
  assert.equal(d.innerHTML, '<svg></svg>');
  const l = h('label', { for: 'w' }, 'Weight');
  assert.equal(l.htmlFor, 'w');
  const sel = h('select', { value: 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'));
  assert.equal(sel.value, 'b');
  const inp = h('input', { list: 'suggestions', inputmode: 'decimal', value: 0, placeholder: 'kg', name: 'w' });
  assert.equal(inp.getAttribute('list'), 'suggestions');
  assert.equal(inp.getAttribute('inputmode'), 'decimal');
  assert.equal(inp.value, 0);
  const svg = h('svg', { viewBox: '0 0 24 24', class: 'ico', width: 20 }, h('path', { d: 'M0 0' }));
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('class'), 'ico');
  assert.equal(svg.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
  // props object created inside the page realm is recognised too (the tests above use this realm's objects)
  const ctxEl = vm.runInContext("Forge.util.h('b', { title: 't' }, 'y')", env.ctx);
  assert.equal(ctxEl.title, 't');
  assert.equal(ctxEl.textContent, 'y');
  // a class instance / Date is a child, not props
  const dt = h('time', new Date(0));
  assert.equal(dt.childNodes.length, 1);
});

test('util: $ / $$ / clear / svgEl without a DOM do not throw', () => {
  const { F } = loadForge();
  assert.equal(F.util.$('.x'), null);
  deq(F.util.$$('.x'), []);
  assert.equal(F.util.clear(null), null);
});

/* ---------------------------------------------------------------- feedback */

test('util: haptic / beep respect settings and never throw', () => {
  const vibrations = [];
  const created = [];
  class FakeAudio {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; created.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createOscillator() { const p = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; return { type: '', frequency: p, connect() {}, start() {}, stop() {} }; }
    createGain() { const p = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; return { gain: p, connect() {} }; }
  }
  const document = makeDocument();
  const env = loadForge({
    document,
    extra: { navigator: { vibrate: (p) => { vibrations.push(p); return true; }, userActivation: { hasBeenActive: false } }, AudioContext: FakeAudio }
  });
  const { F } = env;
  F.store.init(null);
  // before any gesture: no vibrate, no AudioContext created
  F.util.haptic(); F.util.beep('end');
  assert.equal(vibrations.length, 0);
  assert.equal(created.length, 0);
  // first pointerdown unlocks
  document.dispatch('pointerdown');
  assert.equal(created.length, 1);
  assert.equal(created[0].state, 'running');
  F.util.haptic(); F.util.haptic([10, 20]);
  deq(vibrations, [12, [10, 20]]);
  for (const k of ['end', 'tick', 'pr', 'done', 'weird']) assert.doesNotThrow(() => F.util.beep(k));
  F.store.setSetting('vibrate', false);
  F.store.setSetting('sound', false);
  F.util.haptic();
  assert.equal(vibrations.length, 2);
  // broken audio implementation → silent
  created[0].createOscillator = () => { throw new Error('boom'); };
  F.store.setSetting('sound', true);
  assert.doesNotThrow(() => F.util.beep('pr'));
  assert.equal(F.util.reducedMotion(), false);
});

test('util: countUp sets the final value without rAF / under reduced motion', async () => {
  const { F } = loadForge();
  const el = { textContent: '' };
  F.util.countUp(el, 12450);
  assert.equal(el.textContent, '12,450');
  F.util.countUp(el, 7, { format: (n) => n.toFixed(1) + ' L' });
  assert.equal(el.textContent, '7.0 L');
  // with a rAF that never fires (hidden tab), the safety timer still lands on the value
  const env2 = loadForge({ extra: { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} } });
  const el2 = { textContent: '' };
  env2.F.util.countUp(el2, 50, { duration: 10 });
  assert.equal(el2.textContent, '0');
  await tick(400);
  assert.equal(el2.textContent, '50');
  assert.doesNotThrow(() => F.util.countUp(null, 5));
});
