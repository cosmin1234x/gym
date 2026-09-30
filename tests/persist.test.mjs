import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForge, at, tick, plain, pickEx, logWorkout, MemoryStorage, makeCloud, makeDocument } from './harness.mjs';

const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);
const KEY = 'forge:v1';

/** Boot like app.js: init from local, then (optionally) connect. */
async function boot(o = {}) {
  const env = loadForge({ storage: o.storage || new MemoryStorage(), cloud: o.cloud, document: o.document, now: o.now });
  env.F.store.init(env.F.persist.loadLocal());
  if (o.connect !== false && o.cloud) {
    await env.F.persist.connectCloud();
    await env.F.persist._idle();
  }
  return env;
}
async function settle(env) {
  env.F.persist.flush();
  await env.F.persist._idle();
}
const quiet = async (fn) => {
  const e = console.error; const w = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
};

/* ---------------------------------------------------------------- local layer */

test('persist: local round-trip through localStorage', async () => {
  const storage = new MemoryStorage();
  const a = await boot({ storage });
  const w = pickEx(a.F, 'weight');
  a.F.store.setSetting('name', 'Rae');
  a.F.store.addWater(500);
  a.F.store.saveJournal({ text: 'Felt good', mood: 5 });
  logWorkout(a, '2026-09-29', [{ exId: w, sets: [{ w: 20, r: 10 }] }]);
  a.F.store.startWorkout({ blank: true, title: 'In progress' });
  a.F.persist.flush();
  assert.ok(storage.getItem(KEY));
  const b = await boot({ storage });
  const s = b.F.store.get();
  assert.equal(s.settings.name, 'Rae');
  assert.equal(b.F.q.waterTotal('2026-09-30'), 500);
  assert.equal(s.journal[0].text, 'Felt good');
  assert.equal(s.sessions.length, 1);
  assert.equal(s.active.title, 'In progress', 'active workout survives reload');
  deq(s, a.F.store.get());
});

test('persist: schedule() saves shortly after a change', async () => {
  const storage = new MemoryStorage();
  const env = await boot({ storage });
  const writes = storage.writes;
  env.F.store.addWater(250);
  env.F.store.addWater(250);
  assert.equal(storage.writes, writes, 'not synchronous');
  await tick(30);
  assert.equal(storage.writes, writes + 1, 'coalesced into one write');
  assert.equal(JSON.parse(storage.getItem(KEY)).water['2026-09-30'].length, 2);
});

test('persist: loadLocal handles missing, corrupt, non-object and blocked storage', () => {
  const s1 = new MemoryStorage();
  assert.equal(loadForge({ storage: s1 }).F.persist.loadLocal(), null);
  s1.setItem(KEY, '{broken');
  const env = loadForge({ storage: s1 });
  const origWarn = console.warn; console.warn = () => {};
  try { assert.equal(env.F.persist.loadLocal(), null); } finally { console.warn = origWarn; }
  assert.equal(s1.getItem(KEY + ':corrupt'), '{broken', 'unreadable data is kept aside, not lost');
  s1.setItem(KEY, '[1,2]');
  assert.equal(loadForge({ storage: s1 }).F.persist.loadLocal(), null);
  const blocked = loadForge({ storage: new MemoryStorage({ throwOnAccess: true }) });
  assert.equal(blocked.F.persist.loadLocal(), null);
  blocked.F.store.init(null);
  assert.doesNotThrow(() => { blocked.F.store.addWater(100); blocked.F.persist.flush(); });
  const none = loadForge({ storage: null });
  assert.equal(none.F.persist.loadLocal(), null);
  none.F.store.init(null);
  assert.doesNotThrow(() => none.F.persist.flush());
});

test('persist: quota errors toast once', async () => {
  const storage = new MemoryStorage({ quotaChars: 200 });
  const env = await boot({ storage });
  env.F.store.addWater(100);
  env.F.persist.flush();
  env.F.store.addWater(100);
  env.F.persist.flush();
  assert.equal(env.toasts.length, 1);
  assert.equal(env.toasts[0].opts.type, 'warn');
});

test('persist: stamps mark changed partitions only; vanished partitions leave tombstones', async () => {
  const env = await boot();
  const { F } = env;
  F.persist.flush();
  deq(F.store.get().meta.stamps, {}, 'loading / defaults are not edits');
  env.advance(1000);
  const e = F.store.addWater(250);
  F.persist.flush();
  const t1 = env.now();
  deq(F.store.get().meta.stamps, { 'water-2026-09': t1 });
  env.advance(1000);
  F.store.removeWater('2026-09-30', e.id);
  F.persist.flush();
  deq(F.store.get().meta.stamps, { 'water-2026-09': env.now() }, 'tombstone');
  env.advance(1000);
  F.store.setSetting('name', 'Z');
  F.persist.flush();
  assert.equal(F.store.get().meta.stamps.settings, env.now());
  // stamping does not notify subscribers (no loop)
  await tick();
  let n = 0;
  F.store.subscribe(() => n++);
  F.store.addWater(1);
  F.persist.flush();
  await tick();
  assert.equal(n, 1, 'only the mutation notified');
  F.persist.flush();
  await tick();
  assert.equal(n, 1);
});

/* ---------------------------------------------------------------- cloud: availability */

test('persist.connectCloud: stays local without window.claude or when use()/id() give null', async () => {
  const env = await boot();
  const seen = [];
  env.F.persist.onStatus((s) => seen.push(s));
  await env.F.persist.connectCloud();
  assert.equal(env.F.persist.status(), 'local');
  deq(seen, []);

  for (const flag of ['dbNull', 'userNull', 'idNull']) {
    const cloud = makeCloud();
    cloud.opts[flag] = true;
    cloud.opts.useDelayMs = 5;
    const e2 = await boot({ cloud, connect: false });
    const st = [];
    e2.F.persist.onStatus((s) => st.push(s));
    const p = e2.F.persist.connectCloud();
    assert.equal(e2.F.persist.status(), 'connecting');
    await p;
    assert.equal(e2.F.persist.status(), 'local', flag);
    deq(st, ['connecting', 'local']);
    e2.F.store.addWater(100);
    await settle(e2);
    assert.equal(cloud.writes().length, 0, 'no cloud writes when local-only');
  }
});

/* ---------------------------------------------------------------- cloud: sync */

test('persist cloud: empty cloud → push every partition as { v, updatedAt }', async () => {
  const cloud = makeCloud();
  const storage = new MemoryStorage();
  const pre = await boot({ storage, now: at('2026-08-20', 9) });
  const w = pickEx(pre.F, 'weight');
  logWorkout(pre, '2026-08-20', [{ exId: w, sets: [{ w: 10, r: 10 }] }]);
  pre.setDay('2026-09-30', 10);
  logWorkout(pre, '2026-09-29', [{ exId: w, sets: [{ w: 12, r: 10 }] }]);
  pre.F.store.addWater(500);
  pre.F.store.saveJournal({ text: 'hello' });
  pre.F.persist.flush();

  const env = await boot({ storage, cloud });
  assert.equal(env.F.persist.status(), 'cloud');
  deq(cloud.keys(), ['active', 'journal-2026-09', 'library', 'meta', 'plan', 'sessions-2026-08', 'sessions-2026-09', 'settings', 'water-2026-09']);
  const s = env.F.store.get();
  deq(cloud.body('settings').v, s.settings);
  deq(cloud.body('sessions-2026-08').v, [s.sessions[0]]);
  deq(cloud.body('water-2026-09').v, { '2026-09-30': s.water['2026-09-30'] });
  deq(cloud.body('active'), { v: null, updatedAt: 0 });
  deq(cloud.body('meta').v, { createdAt: s.meta.createdAt, celebrated: {} });
  assert.equal(cloud.body('sessions-2026-09').updatedAt, s.meta.stamps['sessions-2026-09']);
  for (const k of cloud.keys()) assert.match(k, /^[A-Za-z0-9_\-.~:@+]+$/);
  assert.deepEqual(cloud.server.violations, []);
});

test('persist cloud: writes only changed docs, once, never overlapping per doc', async () => {
  const cloud = makeCloud();
  const env = await boot({ cloud });
  const { F } = env;
  cloud.clearLog();
  await settle(env);
  await settle(env);
  assert.equal(cloud.writes().length, 0, 'unchanged data is never rewritten');
  F.store.setSetting('name', 'Pat');
  await settle(env);
  deq(cloud.writes().map((l) => l.id), ['settings']);
  cloud.clearLog();
  cloud.server.latency = 5;
  for (let i = 0; i < 25; i++) { F.store.addWater(100); F.persist.flush(); }
  await F.persist._idle();
  assert.deepEqual(cloud.server.violations, [], 'one write at a time per doc');
  const waterWrites = cloud.writes().filter((l) => l.id === 'water-2026-09').length;
  assert.ok(waterWrites >= 1 && waterWrites <= 3, 'bursts coalesce (' + waterWrites + ' writes)');
  assert.equal(cloud.body('water-2026-09').v['2026-09-30'].length, 25, 'final state landed');
  // debounced path (schedule) also reaches the cloud
  cloud.clearLog();
  F.store.setSetting('waterGoal', 2000);
  await tick(80);
  await F.persist._idle();
  deq(cloud.writes().map((l) => l.id), ['settings']);
  assert.equal(cloud.body('settings').v.waterGoal, 2000);
});

test('persist cloud: second device adopts cloud data without writing back; frozen data is cloned', async () => {
  const cloud = makeCloud();
  const a = await boot({ cloud, now: at('2026-09-29', 9) });
  const w = pickEx(a.F, 'weight');
  a.F.store.setSetting('name', 'Morgan');
  a.F.store.setSetting('units', 'lb');
  a.F.store.addCustomExercise({ name: 'Door Row', muscle: 'back' });
  logWorkout(a, '2026-09-28', [{ exId: w, sets: [{ w: 30, r: 8 }] }]);
  a.F.store.addWater(750);
  await settle(a);
  cloud.clearLog();

  const cloudB = makeCloud({ server: cloud.server });
  const b = await boot({ cloud: cloudB, connect: false, now: at('2026-09-30', 10) });
  const reasons = [];
  b.F.store.subscribe((s, r) => reasons.push(r));
  await b.F.persist.connectCloud();
  await b.F.persist._idle();
  await tick();
  const sb = b.F.store.get();
  assert.equal(sb.settings.name, 'Morgan');
  assert.equal(sb.settings.units, 'lb');
  assert.equal(sb.customExercises[0].name, 'Door Row');
  assert.equal(sb.sessions.length, 1);
  assert.equal(b.F.q.waterTotal('2026-09-29'), 750);
  deq(sb.plan, a.F.store.get().plan);
  assert.ok(reasons.join(' ').includes('cloud'));
  assert.equal(cloudB.writes().length, 0, 'nothing written back after adopting cloud data');
  assert.equal(b.F.persist.status(), 'cloud');
  // mutating adopted data is safe (cloud snapshots are frozen)
  assert.doesNotThrow(() => { b.F.store.addWater(250, '2026-09-29'); b.F.store.setSetting('name', 'M'); b.F.store.updateSession(sb.sessions[0].id, { note: 'x' }); });
  await settle(b);
  assert.equal(cloud.body('water-2026-09').v['2026-09-29'].length, 2);
  assert.equal(cloud.body('settings').v.name, 'M');
  // and the adopted data was persisted locally
  assert.equal(JSON.parse(b.storage.getItem(KEY)).settings.name, 'M');
});

test('persist cloud: newest stamp wins per partition; ties go to the cloud', async () => {
  const cloud = makeCloud();
  const a = await boot({ cloud, now: at('2026-09-30', 8) });
  const b = await boot({ cloud: makeCloud({ server: cloud.server }), now: at('2026-09-30', 8) });
  // A edits settings at 09:00, B edits water at 09:30 (both after their last sync)
  a.setDay('2026-09-30', 9);
  a.F.store.setSetting('name', 'From A');
  await settle(a);
  b.setDay('2026-09-30', 9, 30);
  b.F.store.addWater(400);
  b.F.persist.flush(); // B pushes water; B's settings still default & older
  await b.F.persist._idle();
  // B restarts (same local storage) → adopts A's newer settings, keeps its own newer water
  const b2 = await boot({ cloud: makeCloud({ server: cloud.server }), storage: b.storage.clone(), now: at('2026-09-30', 10) });
  assert.equal(b2.F.store.get().settings.name, 'From A');
  assert.equal(b2.F.q.waterTotal('2026-09-30'), 400);
  // A pulls again and gets B's water; A's settings (newer) untouched
  const a2 = await boot({ cloud: makeCloud({ server: cloud.server }), storage: a.storage.clone(), now: at('2026-09-30', 10) });
  assert.equal(a2.F.q.waterTotal('2026-09-30'), 400);
  assert.equal(a2.F.store.get().settings.name, 'From A');
  // tie: fresh device (stamp 0) vs cloud doc with updatedAt 0 but different content → cloud wins
  const c3 = makeCloud({ uid: 'u_tie' });
  c3.put('settings', { v: { name: 'Cloudy', units: 'lb' }, updatedAt: 0 });
  const d3 = await boot({ cloud: c3 });
  assert.equal(d3.F.store.get().settings.name, 'Cloudy');
  assert.equal(d3.F.store.get().settings.units, 'lb');
  assert.equal(d3.F.store.get().settings.waterGoal, 3000, 'partial cloud settings merged over defaults');
  assert.ok(c3.keys().includes('plan'), 'partitions missing in the cloud are pushed');
});

test('persist cloud: deletions propagate (no resurrection) and newer local tombstones delete docs', async () => {
  const cloud = makeCloud();
  const a = await boot({ cloud, now: at('2026-08-15', 9) });
  const w = pickEx(a.F, 'weight');
  const aug = logWorkout(a, '2026-08-15', [{ exId: w, sets: [{ w: 10, r: 10 }] }]).session;
  a.setDay('2026-09-29', 9);
  const sep = logWorkout(a, '2026-09-29', [{ exId: w, sets: [{ w: 10, r: 10 }] }]).session;
  await settle(a);
  assert.ok(cloud.keys().includes('sessions-2026-08'));

  // Device B syncs, then deletes the only August session → doc deleted
  const b = await boot({ cloud: makeCloud({ server: cloud.server }), now: at('2026-09-30', 9) });
  assert.equal(b.F.store.get().sessions.length, 2);
  b.advance(60000);
  b.F.store.deleteSession(aug.id);
  await settle(b);
  assert.equal(cloud.keys().includes('sessions-2026-08'), false);

  // Device A reconnects (same local storage): accepts the deletion instead of re-uploading it
  const a2 = await boot({ cloud: makeCloud({ server: cloud.server }), storage: a.storage.clone(), now: at('2026-09-30', 12) });
  deq(a2.F.store.get().sessions.map((s) => s.id), [sep.id]);
  assert.equal(cloud.keys().includes('sessions-2026-08'), false, 'not resurrected');

  // A local deletion made while offline wins over the older cloud doc on the next sync
  const c2 = makeCloud({ server: cloud.server });
  const off = await boot({ cloud: c2, storage: a2.storage.clone(), now: at('2026-09-30', 13) });
  cloud.server.faults.push({ op: 'delete', code: 'unavailable', times: 2 });
  off.advance(1000);
  await quiet(async () => {
    off.F.store.deleteSession(sep.id);
    await settle(off);
  });
  assert.equal(off.F.persist.status(), 'offline');
  assert.ok(cloud.keys().includes('sessions-2026-09'), 'delete failed while offline');
  const again = await boot({ cloud: makeCloud({ server: cloud.server }), storage: off.storage.clone(), now: at('2026-09-30', 14) });
  assert.equal(again.F.store.get().sessions.length, 0);
  assert.equal(cloud.keys().includes('sessions-2026-09'), false, 'tombstone newer → cloud doc deleted');
});

test('persist cloud: edits made after the last sync beat a remote deletion', async () => {
  const cloud = makeCloud();
  const a = await boot({ cloud, now: at('2026-09-20', 9) });
  a.F.store.saveJournal({ date: '2026-09-20', text: 'v1' });
  await settle(a);
  const b = await boot({ cloud: makeCloud({ server: cloud.server }), now: at('2026-09-21', 9) });
  b.F.store.deleteJournal(b.F.store.get().journal[0].id);
  await settle(b);
  assert.equal(cloud.keys().includes('journal-2026-09'), false);
  // A edited the entry afterwards (offline, not yet synced) → its newer edit is kept and re-uploaded
  a.setDay('2026-09-22', 9);
  cloud.server.faults.push({ op: 'set', path: /journal/, code: 'unavailable', times: 2 });
  await quiet(async () => {
    a.F.store.saveJournal({ id: a.F.store.get().journal[0].id, text: 'v2' });
    await settle(a);
  });
  const a2 = await boot({ cloud: makeCloud({ server: cloud.server }), storage: a.storage.clone(), now: at('2026-09-22', 10) });
  assert.equal(a2.F.store.get().journal[0].text, 'v2');
  assert.equal(cloud.body('journal-2026-09').v[0].text, 'v2');
});

test('persist cloud: error codes — retry once on unavailable, offline, quota toast, revoked → local', async () => {
  // transient list failure: retried once, then succeeds
  const c1 = makeCloud();
  c1.server.faults.push({ op: 'list', code: 'unavailable', times: 1 });
  const e1 = await boot({ cloud: c1 });
  assert.equal(e1.F.persist.status(), 'cloud');

  // persistent unavailability → offline, recovers on the next successful write
  const c2 = makeCloud();
  const e2 = await boot({ cloud: c2 });
  c2.server.faults.push({ op: 'set', code: 'unavailable', times: 2 });
  await quiet(async () => { e2.F.store.addWater(100); await settle(e2); });
  assert.equal(e2.F.persist.status(), 'offline');
  assert.equal(c2.body('water-2026-09'), undefined);
  e2.F.store.addWater(100);
  await settle(e2);
  assert.equal(e2.F.persist.status(), 'cloud');
  assert.equal(c2.body('water-2026-09').v['2026-09-30'].length, 2, 'the missed change was sent with the next one');

  // quota_exceeded → toast once, data stays local
  const c3 = makeCloud();
  const e3 = await boot({ cloud: c3 });
  c3.server.faults.push({ op: 'set', code: 'quota_exceeded', times: 5 });
  e3.F.store.addWater(100); await settle(e3);
  e3.F.store.addWater(100); await settle(e3);
  assert.equal(e3.toasts.filter((t) => /Cloud storage is full/.test(t.msg)).length, 1);

  // revoked → silently local, no more cloud traffic
  const c4 = makeCloud();
  const e4 = await boot({ cloud: c4 });
  c4.server.faults.push({ op: 'set', code: 'revoked', times: 1 });
  e4.F.store.addWater(100); await settle(e4);
  assert.equal(e4.F.persist.status(), 'local');
  c4.clearLog();
  e4.F.store.addWater(100); await settle(e4);
  assert.equal(c4.writes().length, 0);
  assert.equal(e4.toasts.length, 0);

  // revoked on the initial pull
  const c5 = makeCloud();
  c5.server.faults.push({ op: 'list', code: 'not_granted', times: 1 });
  const e5 = await boot({ cloud: c5 });
  assert.equal(e5.F.persist.status(), 'local');
});

test('persist cloud: visibilitychange re-pulls at most every 30 s', async () => {
  const cloud = makeCloud();
  const document = makeDocument();
  const b = await boot({ cloud: makeCloud({ server: cloud.server }), document });
  const a = await boot({ cloud, now: at('2026-09-30', 11) });
  a.F.store.setSetting('name', 'Remote');
  await settle(a);
  const lists = () => cloud.server.log.length;
  b.advance(10000);
  document.dispatch('visibilitychange');
  await b.F.persist._idle();
  assert.notEqual(b.F.store.get().settings.name, 'Remote', 'throttled (< 30 s)');
  b.advance(25000);
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  await b.F.persist._idle();
  assert.notEqual(b.F.store.get().settings.name, 'Remote', 'hidden → no pull');
  document.visibilityState = 'visible';
  const before = lists();
  document.dispatch('visibilitychange');
  await b.F.persist._idle();
  await tick();
  assert.equal(b.F.store.get().settings.name, 'Remote');
  assert.equal(lists(), before, 'a pull alone writes nothing');
});

test('persist cloud: stays consistent across many random edits on two devices', async () => {
  const cloud = makeCloud();
  const docA = makeDocument(); const docB = makeDocument();
  const a = await boot({ cloud, now: at('2026-09-30', 8), document: docA });
  const b = await boot({ cloud: makeCloud({ server: cloud.server }), now: at('2026-09-30', 8), document: docB });
  a.F.persist._cfg.pullEveryMs = 0;
  b.F.persist._cfg.pullEveryMs = 0;
  let seed = 7;
  const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  for (let i = 0; i < 60; i++) {
    const dev = rnd(2) ? a : b;
    const step = 60000 + rnd(1000);
    a.advance(step); b.advance(step); // one shared wall clock
    const op = rnd(4);
    if (op === 0) dev.F.store.addWater(100 + rnd(400), '2026-09-' + String(20 + rnd(10)).padStart(2, '0'));
    else if (op === 1) dev.F.store.setSetting('waterGoal', 2000 + rnd(10) * 100);
    else if (op === 2) dev.F.store.saveJournal({ text: 'note ' + i, date: '2026-0' + (8 + rnd(2)) + '-1' + rnd(9) });
    else { const j = dev.F.store.get().journal; if (j.length) dev.F.store.deleteJournal(j[rnd(j.length)].id); }
    await settle(dev);
    // the other device comes back to the foreground now and then → re-pull
    if (rnd(3) === 0) {
      const other = dev === a ? b : a;
      (other === a ? docA : docB).dispatch('visibilitychange');
      await other.F.persist._idle();
    }
  }
  assert.deepEqual(cloud.server.violations, []);
  // final: fresh devices from each storage converge to the same partitions as the cloud
  const fa = await boot({ cloud: makeCloud({ server: cloud.server }), storage: a.storage.clone(), now: at('2026-10-01', 9) });
  const fb = await boot({ cloud: makeCloud({ server: cloud.server }), storage: b.storage.clone(), now: at('2026-10-01', 9) });
  const view = (env) => { const s = env.F.store.get(); return { water: s.water, goal: s.settings.waterGoal, journal: s.journal.map((j) => j.id).sort() }; };
  deq(view(fa), view(fb));
});

/* ---------------------------------------------------------------- export / import */

test('persist: exportJSON / importJSON round trip and validation', async () => {
  const env = await boot();
  const { F } = env;
  const w = pickEx(F, 'weight');
  F.store.setSetting('name', 'Exported');
  logWorkout(env, '2026-09-29', [{ exId: w, sets: [{ w: 20, r: 10 }] }]);
  const text = F.persist.exportJSON();
  const obj = JSON.parse(text);
  assert.equal(obj.app, 'forge');
  assert.equal(obj.exportedAt, env.now());
  assert.equal(obj.version, 1);
  assert.equal(obj.settings.name, 'Exported');
  assert.match(text, /\n {2}"app": "forge"/, 'pretty printed');

  const other = await boot();
  const reasons = [];
  other.F.store.subscribe((s, r) => reasons.push(r));
  deq(other.F.persist.importJSON(text), { ok: true });
  assert.equal(other.F.store.get().settings.name, 'Exported');
  assert.equal(other.F.store.get().sessions.length, 1);
  assert.equal('app' in other.F.store.get(), false, 'wrapper keys not kept in state');
  await tick();
  deq(reasons, ['import']);

  const bad = (t) => { const r = other.F.persist.importJSON(t); assert.equal(r.ok, false, t); assert.equal(typeof r.error, 'string'); assert.ok(r.error.length > 10); return r.error; };
  bad('');
  bad(null);
  assert.match(bad('{nope'), /valid JSON/);
  bad('[]');
  bad('"string"');
  assert.match(bad(JSON.stringify({ app: 'other', sessions: [] })), /different app/);
  assert.match(bad(JSON.stringify({ app: 'forge', version: 2, sessions: [] })), /newer version/);
  bad(JSON.stringify({ app: 'forge', version: 'one', sessions: [] }));
  assert.match(bad(JSON.stringify({ hello: 'world' })), /any FORGE data/);
  assert.match(bad(JSON.stringify({ sessions: {} })), /sessions/);
  bad(JSON.stringify({ plan: [] }));
  bad(JSON.stringify({ sessions: [], active: 'running' }));
  assert.equal(other.F.store.get().settings.name, 'Exported', 'failed imports change nothing');
  deq(other.F.persist.importJSON('\uFEFF' + JSON.stringify({ sessions: [] })), { ok: true }, 'BOM tolerated');
});

test('persist: import on a synced device uploads the imported data', async () => {
  const cloud = makeCloud();
  const env = await boot({ cloud });
  env.advance(5000);
  const r = env.F.persist.importJSON(JSON.stringify({ app: 'forge', version: 1, settings: { name: 'Imported' }, water: { '2026-07-01': [{ id: 'w1', ml: 300, at: at('2026-07-01', 9) }] } }));
  assert.equal(r.ok, true);
  await settle(env);
  assert.equal(cloud.body('settings').v.name, 'Imported');
  assert.equal(cloud.body('water-2026-07').v['2026-07-01'][0].ml, 300);
});

/* ---------------------------------------------------------------- download */

test('persist.download: artifact downloads capability, declined, and Blob fallback', async () => {
  // capability present
  const cloud = makeCloud();
  const saved = [];
  cloud.opts.downloads = { save: async (req) => { saved.push(req); return { status: 'saved' }; } };
  const env = await boot({ cloud, connect: false });
  assert.equal(await env.F.persist.download('forge-backup.json', '{"a":1}'), true);
  deq(saved, [{ filename: 'forge-backup.json', data: '{"a":1}' }]);

  // viewer declines → false, no fallback download
  const c2 = makeCloud();
  c2.opts.downloads = { save: async () => { throw { code: 'declined', message: 'no' }; } };
  const doc2 = makeDocument();
  const e2 = await boot({ cloud: c2, connect: false, document: doc2 });
  assert.equal(await e2.F.persist.download('x.json', '{}'), false);
  assert.equal(doc2.body.childNodes.length, 0);

  // capability unavailable → Blob + <a download> fallback
  const created = [];
  const doc3 = makeDocument();
  const origCreate = doc3.createElement;
  doc3.createElement = (t) => { const el = origCreate(t); created.push(el); return el; };
  const c3 = makeCloud();
  const e3 = loadForge({ cloud: c3, document: doc3, extra: { URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } } });
  e3.F.store.init(null);
  assert.equal(await e3.F.persist.download('forge.json', '{"b":2}'), true);
  const a = created.find((el) => el.localName === 'a');
  assert.ok(a);
  assert.equal(a.download, 'forge.json');
  assert.equal(a.href, 'blob:x');
  assert.equal(a.clicked, 1);
  assert.equal(doc3.body.childNodes.length, 0, 'temporary link removed');

  // no DOM, no capability → false (never throws)
  const e4 = loadForge({ storage: new MemoryStorage() });
  assert.equal(await e4.F.persist.download('x.json', 'y'), false);
});

test('persist cloud: an edit made while the initial pull is in flight is not overwritten', async () => {
  const cloud = makeCloud();
  // another device logged water this month earlier today
  cloud.put('water-2026-09', { v: { '2026-09-30': [{ id: 'w-other', ml: 300, at: at('2026-09-30', 8) }] }, updatedAt: at('2026-09-30', 9) });
  cloud.server.latency = 30;
  const env = await boot({ cloud, connect: false, now: at('2026-09-30', 10) });
  env.F.persist._cfg.localMs = 5000; // local stamping timer has not fired yet when the read returns
  const p = env.F.persist.connectCloud();
  await tick(5);
  const mine = env.F.store.addWater(500);
  await p;
  await env.F.persist._idle();
  const today = env.F.store.get().water['2026-09-30'];
  assert.ok(today.some((e) => e.id === mine.id), 'the edit made during the pull survives');
  assert.ok(cloud.body('water-2026-09').v['2026-09-30'].some((e) => e.id === mine.id), 'and is uploaded');
});

test('persist cloud: oversized or refused partitions are not re-sent until they change', async () => {
  const cloud = makeCloud();
  const env = await boot({ cloud });
  const { F } = env;
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    F.persist._cfg.maxDocBytes = 3000;
    const big = F.store.saveJournal({ text: 'x'.repeat(2500) + '\u00e9'.repeat(400) }); // > 3000 bytes in UTF-8, < 3000 chars
    await settle(env);
    F.store.addWater(100);
    await settle(env);
    F.store.addWater(100);
    await settle(env);
    assert.equal(cloud.body('journal-2026-09'), undefined, 'too big → kept local');
    assert.equal(cloud.body('water-2026-09').v['2026-09-30'].length, 2, 'other partitions keep syncing');
    assert.equal(warns.filter((w) => /too large/.test(w)).length, 1, 'warned once');
    F.store.saveJournal({ id: big.id, text: 'short now' });
    await settle(env);
    assert.equal(cloud.body('journal-2026-09').v[0].text, 'short now');
  } finally { console.warn = origWarn; }

  // quota_exceeded on one doc: toast, no retries of the same data on later saves
  cloud.server.faults.push({ op: 'set', path: /water/, code: 'quota_exceeded', times: 1 });
  cloud.server.attempts.length = 0;
  F.store.addWater(100);
  await settle(env);
  F.store.setSetting('name', 'Other change');
  await settle(env);
  await settle(env);
  assert.equal(cloud.server.attempts.filter((a) => a.id === 'water-2026-09').length, 1, 'refused body not re-sent');
  F.store.addWater(100);
  await settle(env);
  assert.equal(cloud.body('water-2026-09').v['2026-09-30'].length, 4, 'sent again once the data changed');
});

test('persist: another tab\'s save is adopted (no stale overwrite, no echo loop)', async () => {
  const shared = new MemoryStorage();
  const tab = () => {
    const handlers = {};
    const env = loadForge({ storage: shared, extra: { addEventListener: (t, fn) => { (handlers[t] || (handlers[t] = [])).push(fn); } } });
    env.F.store.init(env.F.persist.loadLocal());
    env.fire = (ev) => (handlers[ev.type] || []).forEach((fn) => fn(ev));
    return env;
  };
  const t1 = tab();
  const t2 = tab();
  t2.F.store.addWater(500);
  t2.F.persist.flush();
  const reasons = [];
  t1.F.store.subscribe((s, r) => reasons.push(r));
  t1.fire({ type: 'storage', key: 'forge:v1:sync', newValue: '{}' }); // other keys ignored
  t1.fire({ type: 'storage', key: KEY, newValue: shared.getItem(KEY) });
  assert.equal(t1.F.q.waterTotal('2026-09-30'), 500, 'tab 1 adopted tab 2\'s save');
  await tick();
  deq(reasons, ['storage']);
  const writes = shared.writes;
  t1.F.persist.flush();
  await tick(20);
  assert.equal(shared.writes, writes, 'adopting does not write the same state back');
  // tab 1 now edits on top of tab 2's data (nothing lost)
  t1.F.store.addWater(250);
  t1.F.persist.flush();
  assert.equal(JSON.parse(shared.getItem(KEY)).water['2026-09-30'].length, 2);
  // a tab with unsaved edits ignores the event (its own save follows and wins)
  t2.F.store.setSetting('name', 'unsaved');
  t2.fire({ type: 'storage', key: KEY, newValue: shared.getItem(KEY) });
  assert.equal(t2.F.store.get().settings.name, 'unsaved');
  assert.equal(t2.F.q.waterTotal('2026-09-30'), 500);
  // garbage events are ignored
  assert.doesNotThrow(() => { t1.fire({ type: 'storage', key: KEY, newValue: '{bad' }); t1.fire({ type: 'storage', key: KEY, newValue: null }); t1.fire({ type: 'storage' }); });
});

test('persist cloud: a viewer who cannot write (view-only) falls back to local quietly', async () => {
  const cloud = makeCloud();
  cloud.server.faults.push({ op: 'set', code: 'invalid_argument', times: 1000 });
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let env;
  try { env = await boot({ cloud }); await env.F.persist._idle(); } finally { console.warn = origWarn; }
  assert.equal(env.F.persist.status(), 'local');
  deq(warns, [], 'silent fallback');
  const attempts = cloud.server.attempts.length;
  env.F.store.addWater(100);
  await settle(env);
  assert.equal(cloud.server.attempts.length, attempts, 'no further cloud writes');
  assert.equal(env.toasts.length, 0);
  assert.equal(env.F.q.waterTotal('2026-09-30'), 100, 'local use unaffected');
});
