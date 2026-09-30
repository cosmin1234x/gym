/* FORGE — js/core/persist.js
 * Persistence: localStorage ('forge:v1') + optional claude.ai Artifact cloud sync. Contract: docs/SPEC.md §8.
 *
 * Cloud model: the state is split into partitions (settings, plan, library, active, meta,
 * sessions-YYYY-MM, water-YYYY-MM, journal-YYYY-MM), one document each in the viewer's private
 * collection data/users/<uid>, body { v, updatedAt }. meta.stamps[key] records when a partition last
 * changed locally (a stamp without data is a tombstone). Merge = per partition, newest stamp wins
 * (ties → cloud). Writes are diffed against the last JSON known to be in the cloud, serialised per
 * document, and never repeated for unchanged data.
 */
(function (F) {
  'use strict';

  const KEY = 'forge:v1';
  const SYNC_KEY = 'forge:v1:sync'; // device-local sync bookkeeping { uid, keys: { partition: stamp } }
  const FIXED = ['settings', 'plan', 'library', 'active', 'meta'];
  const MONTHLY = /^(sessions|water|journal)-(\d{4}-\d{2})$/;
  const TERMINAL = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'];
  const KNOWN_CODES = ['invalid_argument', 'resource_exhausted', 'quota_exceeded', 'unavailable', 'transform_error'].concat(TERMINAL);

  /** Tunables (exposed as _cfg for tests). */
  const cfg = { localMs: 400, cloudMs: 1000, cloudMaxWaitMs: 5000, retryMinMs: 1000, retryMaxMs: 3000, offlineRetryMs: 20000, pullEveryMs: 30000, maxDocBytes: 250000 };

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const root = typeof window !== 'undefined' ? window : globalThis;
  const state = () => (F.store && typeof F.store.get === 'function' ? F.store.get() : null);
  function ls() { try { return root.localStorage || null; } catch (_) { return null; } }
  function toast(message, type) { try { if (F.ui && typeof F.ui.toast === 'function') F.ui.toast(message, { type: type || 'info' }); } catch (_) { /* ignore */ } }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  /** JSON with sorted object keys — stable across stores that reorder keys. */
  function stable(v) {
    if (v === null || typeof v !== 'object') { const s = JSON.stringify(v); return s === undefined ? 'null' : s; }
    if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : stable(x))).join(',') + ']';
    const keys = Object.keys(v).sort();
    const out = [];
    for (const k of keys) { const x = v[k]; if (x === undefined || typeof x === 'function') continue; out.push(JSON.stringify(k) + ':' + stable(x)); }
    return '{' + out.join(',') + '}';
  }

  /* ---------------------------------------------------------------- status */

  let status = 'local';
  const statusSubs = [];
  function setStatus(s) {
    if (s === status) return;
    status = s;
    for (const fn of statusSubs.slice()) { try { fn(s); } catch (e) { console.error('[FORGE] onStatus listener failed', e); } }
  }

  /* ---------------------------------------------------------------- partitions */

  const monthOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null);
  const validKey = (k) => typeof k === 'string' && (FIXED.indexOf(k) >= 0 || MONTHLY.test(k));

  function partitions(st) {
    const out = new Map();
    out.set('settings', st.settings);
    out.set('plan', st.plan);
    out.set('library', st.customExercises);
    out.set('active', st.active === undefined ? null : st.active);
    out.set('meta', { createdAt: st.meta.createdAt, celebrated: st.meta.celebrated });
    for (const s of Array.isArray(st.sessions) ? st.sessions : []) {
      const m = monthOf(s && s.date); if (!m) continue;
      const k = 'sessions-' + m;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(s);
    }
    for (const iso of Object.keys(isObj(st.water) ? st.water : {})) {
      const m = monthOf(iso); if (!m) continue;
      const k = 'water-' + m;
      if (!out.has(k)) out.set(k, {});
      out.get(k)[iso] = st.water[iso];
    }
    for (const e of Array.isArray(st.journal) ? st.journal : []) {
      const m = monthOf(e && e.date); if (!m) continue;
      const k = 'journal-' + m;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(e);
    }
    return out;
  }
  function jsonMap(parts) {
    const m = new Map();
    for (const [k, v] of parts) m.set(k, stable(v));
    return m;
  }
  function validValue(key, v) {
    if (key === 'settings' || key === 'plan' || key === 'meta') return isObj(v);
    if (key === 'library') return Array.isArray(v);
    if (key === 'active') return v === null || isObj(v);
    const m = MONTHLY.exec(key);
    if (!m) return false;
    return m[1] === 'water' ? isObj(v) : Array.isArray(v);
  }
  /** Write one partition's value into a (cloned) state; value === undefined removes it. */
  function applyPartition(next, key, value) {
    if (key === 'settings') next.settings = value;
    else if (key === 'plan') next.plan = value;
    else if (key === 'library') next.customExercises = value;
    else if (key === 'active') next.active = value;
    else if (key === 'meta') { if (isObj(value)) { next.meta.createdAt = value.createdAt; next.meta.celebrated = value.celebrated; } }
    else {
      const m = MONTHLY.exec(key);
      if (!m) return;
      const [, kind, month] = m;
      if (kind === 'water') {
        if (!isObj(next.water)) next.water = {};
        for (const iso of Object.keys(next.water)) if (monthOf(iso) === month) delete next.water[iso];
        if (isObj(value)) for (const iso of Object.keys(value)) if (monthOf(iso) === month) next.water[iso] = value[iso];
      } else {
        const field = kind === 'sessions' ? 'sessions' : 'journal';
        const keep = (Array.isArray(next[field]) ? next[field] : []).filter((x) => monthOf(x && x.date) !== month);
        next[field] = keep.concat(Array.isArray(value) ? value.filter((x) => monthOf(x && x.date) === month) : []);
      }
    }
  }

  /* ---------------------------------------------------------------- local layer */

  let baseline = null;      // Map partition → JSON as last stamped
  let quotaToasted = false;
  let lastSaved = null;     // JSON last written to / adopted from localStorage (skips identical writes)
  let tabSyncAttached = false;

  /** Snapshot current partitions as "unchanged" (called by F.store.init at boot). */
  function takeBaseline() {
    const st = state();
    baseline = st ? jsonMap(partitions(st)) : null;
    attachTabSync();
  }
  /** Another tab of the app saved: adopt its state so this (stale) tab never overwrites newer data.
   *  Skipped while this tab has unsaved edits — its own save follows and wins. */
  function onStorage(e) {
    if (!e || e.key !== KEY || typeof e.newValue !== 'string' || !e.newValue || localTimer) return;
    if (e.newValue === lastSaved) return;
    let next = null;
    try { next = JSON.parse(e.newValue); } catch (_) { return; }
    if (!isObj(next)) return;
    lastSaved = e.newValue;
    F.store.replace(next, 'storage');
    takeBaseline(); // the other tab already stamped these edits
  }
  function attachTabSync() {
    if (tabSyncAttached) return;
    tabSyncAttached = true;
    try { if (typeof root.addEventListener === 'function') root.addEventListener('storage', onStorage); } catch (_) { /* ignore */ }
  }
  /** Stamp partitions that changed since the baseline (tombstones for vanished ones). Mutates
   *  state.meta.stamps directly — no store notification, so no loop. */
  function stampChanges() {
    const st = state();
    if (!st) return null;
    const parts = partitions(st);
    const json = jsonMap(parts);
    let changed = false;
    if (baseline) {
      const now = Date.now();
      const stamps = st.meta.stamps || (st.meta.stamps = {});
      const bump = (k) => { stamps[k] = Math.max(now, (Number(stamps[k]) || 0) + 1); changed = true; };
      for (const [k, j] of json) if (baseline.get(k) !== j) bump(k);
      for (const k of baseline.keys()) if (!json.has(k)) bump(k);
    }
    baseline = json;
    return { parts, json, changed };
  }
  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
  }
  function saveLocal() {
    const st = state();
    const s = ls();
    if (!st || !s) return false;
    try {
      const json = JSON.stringify(st);
      if (json === lastSaved) return true; // unchanged (also stops tabs echoing each other's saves)
      s.setItem(KEY, json);
      lastSaved = json;
      return true;
    } catch (e) {
      if (isQuotaError(e) && !quotaToasted) {
        quotaToasted = true;
        toast('Device storage is full — export a backup in Settings so nothing is lost.', 'warn');
      }
      return false;
    }
  }
  function loadLocal() {
    const s = ls();
    if (!s) return null;
    let raw = null;
    try { raw = s.getItem(KEY); } catch (_) { return null; }
    if (raw === null || raw === undefined || raw === '') return null;
    try {
      const v = JSON.parse(raw);
      if (!isObj(v)) return null;
      lastSaved = raw;
      return v;
    } catch (_) {
      try { s.setItem(KEY + ':corrupt', raw); } catch (__) { /* ignore */ }
      console.warn('[FORGE] saved data was unreadable; a copy was kept under "' + KEY + ':corrupt".');
      return null;
    }
  }

  let localTimer = null;
  let cloudTimer = null;
  let cloudFirstAt = 0;

  function runLocal() {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    const r = stampChanges();
    saveLocal();
    return r;
  }
  /** Called by F.store after every change: local save soon, cloud push after a quiet second. */
  function schedule() {
    if (!localTimer) localTimer = setTimeout(runLocal, cfg.localMs);
    if (cloud) {
      if (cloudTimer) clearTimeout(cloudTimer);
      const now = Date.now();
      if (!cloudFirstAt) cloudFirstAt = now;
      const waitMs = Math.max(0, Math.min(cfg.cloudMs, cloudFirstAt + cfg.cloudMaxWaitMs - now));
      cloudTimer = setTimeout(runCloud, waitMs);
    }
  }
  /** Immediate save (pagehide / tab hidden). Also pushes pending cloud changes (best effort). */
  function flush() {
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; cloudFirstAt = 0; }
    const r = runLocal();
    if (r && cloud && pulledOnce) pushChanges(r);
  }

  /* ---------------------------------------------------------------- cloud layer */

  let cloud = null;              // { col, uid }
  let synced = new Map();        // partition → JSON known to be in the cloud
  let syncedStamps = {};         // partition → stamp known to be in the cloud (persisted per uid)
  let pulledOnce = false;
  let pulling = null;
  let lastPullAt = 0;
  let connecting = null;
  let retryTimer = null;
  let retryDelay = 0;           // backoff for re-trying after going offline (0 = use cfg.offlineRetryMs)
  let cloudQuotaToasted = false;
  let listenersAttached = false;
  let writesOk = 0;              // successful cloud writes this session
  const pending = new Map();     // partition → latest job { json, body } (json null = delete)
  const inflight = new Map();    // partition → drain promise
  const rejected = new Map();    // partition → JSON the cloud refused for good (retry only once it changes)

  /** UTF-8 size without allocating when the string is clearly small. */
  function byteLength(str) {
    if (str.length * 3 <= cfg.maxDocBytes) return str.length;
    try { if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length; } catch (_) { /* ignore */ }
    return str.length * 3;
  }

  function loadSyncMeta(uid) {
    syncedStamps = {};
    try {
      const s = ls();
      const raw = s ? JSON.parse(s.getItem(SYNC_KEY) || 'null') : null;
      if (isObj(raw) && raw.uid === uid && isObj(raw.keys)) {
        for (const k of Object.keys(raw.keys)) if (validKey(k) && Number.isFinite(raw.keys[k])) syncedStamps[k] = raw.keys[k];
      }
    } catch (_) { syncedStamps = {}; }
  }
  function saveSyncMeta() {
    if (!cloud) return;
    try { const s = ls(); if (s) s.setItem(SYNC_KEY, JSON.stringify({ uid: cloud.uid, keys: syncedStamps })); } catch (_) { /* ignore */ }
  }
  const codeOf = (e) => (e && typeof e.code === 'string' ? e.code : '');
  const isTransient = (e) => { const c = codeOf(e); return c === 'unavailable' || KNOWN_CODES.indexOf(c) < 0; };

  /** One retry after a random 1–3 s pause for transient failures. */
  async function withRetry(fn) {
    try { return await fn(); } catch (e) {
      if (!isTransient(e)) throw e;
      await sleep(cfg.retryMinMs + Math.random() * (cfg.retryMaxMs - cfg.retryMinMs));
      return fn();
    }
  }
  function disconnect() {
    cloud = null;
    pending.clear();
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }
  /** While offline, try again later with exponential backoff (20 s → 5 min). */
  function scheduleRetry() {
    if (retryTimer || !cloud) return;
    const delay = retryDelay || cfg.offlineRetryMs;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!cloud) return;
      if (!pulledOnce) pull(); else runCloud();
    }, delay);
    retryDelay = Math.min(delay * 2, 300000);
  }
  /** Returns true when the failed job must not be retried until its data changes. */
  function onCloudError(e, where) {
    const code = codeOf(e);
    if (TERMINAL.indexOf(code) >= 0) { disconnect(); setStatus('local'); return true; }
    if (code === 'quota_exceeded') {
      if (!cloudQuotaToasted) { cloudQuotaToasted = true; toast('Cloud storage is full — new changes are saved on this device only.', 'warn'); }
      return true;
    }
    if (code === 'invalid_argument' || code === 'transform_error') { console.warn('[FORGE] cloud rejected ' + where, e); return true; }
    setStatus('offline');
    scheduleRetry();
    return false;
  }
  function markHealthy() {
    retryDelay = 0;
    if (status !== 'cloud' && cloud) setStatus('cloud');
  }

  /** Queue the newest body for a document; at most one drain (= one write at a time) per document. */
  function enqueue(key, job) {
    pending.set(key, job);
    if (inflight.has(key)) return;
    const p = drain(key);
    inflight.set(key, p);
    p.then(() => {
      if (inflight.get(key) === p) inflight.delete(key);
      if (pending.has(key) && cloud) enqueue(key, pending.get(key));
    });
  }
  /** Writes pending jobs for one document sequentially, skipping bodies the cloud already has. */
  async function drain(key) {
    while (pending.has(key) && cloud) {
      const job = pending.get(key);
      pending.delete(key);
      if (job.json === null ? !synced.has(key) : synced.get(key) === job.json) continue;
      const c = cloud;
      try {
        const ref = c.col.doc(key);
        await withRetry(() => (job.json === null ? ref.delete() : ref.set(job.body)));
        if (cloud !== c) return;
        if (job.json === null) { synced.delete(key); delete syncedStamps[key]; } else { synced.set(key, job.json); syncedStamps[key] = job.body.updatedAt; }
        writesOk++;
        saveSyncMeta();
        markHealthy();
      } catch (e) {
        if (cloud !== c) return; // disconnected meanwhile (e.g. by a sibling document's failure)
        // A viewer who may read but not write their own subtree (view-only sharing) gets
        // invalid_argument on every write: treat the cloud as unavailable for this visit.
        if (codeOf(e) === 'invalid_argument' && !writesOk) { disconnect(); setStatus('local'); return; }
        if (onCloudError(e, 'write ' + key) && job.json !== null) rejected.set(key, job.json);
      }
    }
  }
  /** Write every partition whose JSON differs from the cloud copy; delete vanished ones. */
  function pushChanges(r) {
    if (!cloud || !pulledOnce || !r) return;
    const st = state();
    const stamps = (st && st.meta && st.meta.stamps) || {};
    for (const [k, j] of r.json) {
      if (synced.get(k) === j) { pending.delete(k); continue; }
      if (rejected.get(k) === j) continue; // refused before and unchanged since → don't hammer the store
      if (byteLength(j) > cfg.maxDocBytes) {
        rejected.set(k, j);
        console.warn('[FORGE] "' + k + '" is too large to sync; it stays on this device.');
        continue;
      }
      rejected.delete(k);
      enqueue(k, { json: j, body: { v: JSON.parse(j), updatedAt: Number(stamps[k]) || 0 } });
    }
    for (const k of Array.from(synced.keys())) if (!r.json.has(k)) enqueue(k, { json: null, body: null });
  }
  function runCloud() {
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
    cloudFirstAt = 0;
    if (!cloud) return;
    if (!pulledOnce) { pull(); return; }
    const r = stampChanges();
    if (r && r.changed) saveLocal();
    pushChanges(r);
  }

  /** Merge a collection snapshot into local state (newest stamp per partition wins). */
  function merge(snap, cur) {
    const st = state();
    const stamps = Object.assign({}, st.meta.stamps);
    const docs = new Map();
    for (const d of snap && Array.isArray(snap.docs) ? snap.docs : []) {
      if (!d || d.exists === false || !validKey(d.id)) continue;
      let body = null;
      try { body = typeof d.data === 'function' ? d.data() : null; } catch (_) { body = null; }
      if (!isObj(body) || !('v' in body) || !validValue(d.id, body.v)) continue;
      docs.set(d.id, { v: body.v, updatedAt: Number(body.updatedAt) || 0, json: stable(body.v) });
    }
    const cloudEmpty = docs.size === 0;
    const keys = new Set([...cur.json.keys(), ...docs.keys(), ...Object.keys(stamps).filter(validKey)]);
    const take = new Map();
    synced = new Map();
    for (const [k, d] of docs) synced.set(k, d.json);
    for (const k of keys) {
      const c = docs.get(k);
      const local = cur.json.get(k);
      const ls0 = Number(stamps[k]) || 0;
      if (c && local !== undefined) {
        if (c.updatedAt >= ls0) { if (c.json !== local) take.set(k, c.v); stamps[k] = c.updatedAt; }
      } else if (c) {
        if (c.updatedAt >= ls0) { take.set(k, c.v); stamps[k] = c.updatedAt; }
        // else: our tombstone is newer → pushChanges deletes the doc
      } else if (local !== undefined && !cloudEmpty && MONTHLY.test(k)) {
        // Cloud lacks a month we have. If we last saw it in the cloud at this very stamp, another
        // device deleted it → drop locally; otherwise it is new/edited here → push.
        const known = syncedStamps[k];
        if (known !== undefined && ls0 <= known) take.set(k, undefined);
      }
    }
    if (take.size) {
      const next = JSON.parse(JSON.stringify(st));
      for (const [k, v] of take) applyPartition(next, k, v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
      next.meta.stamps = stamps;
      F.store.replace(next, 'cloud');
    } else {
      st.meta.stamps = Object.assign(st.meta.stamps || {}, stamps);
    }
    // The merged state is the new unchanged baseline; record what the cloud already holds.
    const after = partitions(state());
    baseline = jsonMap(after);
    const nextKnown = {};
    for (const [k, d] of docs) if (baseline.get(k) === d.json) nextKnown[k] = d.updatedAt;
    syncedStamps = nextKnown;
    saveSyncMeta();
    saveLocal();
    return { parts: after, json: baseline, changed: take.size > 0 };
  }

  function pull() {
    if (!cloud) return Promise.resolve();
    if (pulling) return pulling;
    const c = cloud;
    pulling = (async () => {
      lastPullAt = Date.now();
      try {
        const snap = await withRetry(() => c.col.get());
        if (cloud !== c) return;
        // Stamp edits made while the read was in flight, so the merge sees them as the newest.
        const cur = runLocal();
        const merged = merge(snap, cur || { json: new Map() });
        pulledOnce = true;
        markHealthy();
        pushChanges(merged);
      } catch (e) {
        onCloudError(e, 'pull');
      } finally {
        pulling = null;
      }
    })();
    return pulling;
  }
  function onVisible() {
    try {
      if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return;
    } catch (_) { return; }
    if (cloud && Date.now() - lastPullAt >= cfg.pullEveryMs) pull();
  }
  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisible); } catch (_) { /* ignore */ }
    try { if (root.addEventListener) root.addEventListener('online', onVisible); } catch (_) { /* ignore */ }
  }

  function connectCloud() {
    if (connecting) return connecting;
    connecting = (async () => {
      let c = null;
      try { c = root.claude; } catch (_) { c = null; }
      if (!c || typeof c.use !== 'function') { setStatus('local'); return; }
      setStatus('connecting');
      try {
        const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
        const uid = user && typeof user.id === 'function' ? await user.id() : null;
        if (!db || typeof db.collection !== 'function' || typeof uid !== 'string' || !uid) { setStatus('local'); return; }
        cloud = { col: db.collection('data/users/' + uid), uid };
        loadSyncMeta(uid);
        await pull();
        if (cloud) attachListeners();
      } catch (e) {
        console.warn('[FORGE] cloud sync unavailable; staying on this device.', e);
        disconnect();
        setStatus('local');
      }
    })();
    return connecting;
  }

  /* ---------------------------------------------------------------- backup */

  function exportJSON() {
    const st = state() || {};
    return JSON.stringify(Object.assign({ app: 'forge', exportedAt: Date.now() }, JSON.parse(JSON.stringify(st))), null, 2);
  }
  function importJSON(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'That file is empty.' };
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (_) {
      return { ok: false, error: 'That file isn’t valid JSON. Choose a FORGE backup (.json).' };
    }
    if (!isObj(data)) return { ok: false, error: 'That file isn’t a FORGE backup.' };
    if (data.app !== undefined && data.app !== 'forge') return { ok: false, error: 'That backup is from a different app.' };
    if (data.version !== undefined) {
      if (typeof data.version !== 'number' || !Number.isFinite(data.version)) return { ok: false, error: 'That backup has an unknown format version.' };
      if (data.version > 1) return { ok: false, error: 'That backup was made by a newer version of FORGE. Update the app and try again.' };
    }
    const fields = { sessions: 'list', journal: 'list', customExercises: 'list', plan: 'object', settings: 'object', water: 'object', meta: 'object' };
    if (!Object.keys(fields).some((k) => k in data)) return { ok: false, error: 'That file doesn’t contain any FORGE data.' };
    for (const k of Object.keys(fields)) {
      if (!(k in data) || data[k] === null) continue;
      const okType = fields[k] === 'list' ? Array.isArray(data[k]) : isObj(data[k]);
      if (!okType) return { ok: false, error: 'That backup looks damaged (' + k + ' should be a ' + fields[k] + ').' };
    }
    if (data.active !== undefined && data.active !== null && !isObj(data.active)) return { ok: false, error: 'That backup looks damaged (active workout).' };
    try {
      F.store.replace(data, 'import');
    } catch (e) {
      console.error('[FORGE] import failed', e);
      return { ok: false, error: 'Import failed — your current data was not changed.' };
    }
    return { ok: true };
  }

  let downloadsNs = null;
  /** Save a text file: claude.ai downloads capability when present, else Blob + <a download>. */
  async function download(filename, text) {
    const name = String(filename || 'forge-backup.json');
    const data = String(text == null ? '' : text);
    try {
      const c = root.claude;
      if (c && typeof c.use === 'function') {
        if (!downloadsNs) downloadsNs = Promise.resolve(c.use('downloads')).catch(() => null);
        const dl = await downloadsNs;
        if (dl && typeof dl.save === 'function') {
          try { await dl.save({ filename: name, data }); return true; } catch (e) {
            const code = codeOf(e);
            // The viewer answered (declined / busy / bad file) → report failure; only fall back when saves are unusable.
            if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].indexOf(code) < 0) return false;
          }
        }
      }
    } catch (_) { /* fall back */ }
    try {
      if (typeof document === 'undefined' || typeof Blob === 'undefined' || !root.URL || !root.URL.createObjectURL) return false;
      const type = /\.json$/i.test(name) ? 'application/json' : 'text/plain';
      const url = root.URL.createObjectURL(new Blob([data], { type: type + ';charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { root.URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 4000);
      return true;
    } catch (_) {
      return false;
    }
  }

  F.persist = {
    loadLocal, schedule, flush, connectCloud,
    status: () => status,
    /** fn(status) on every change (not called immediately — read status() for the current value). */
    onStatus(fn) {
      if (typeof fn !== 'function') return () => {};
      statusSubs.push(fn);
      return () => { const i = statusSubs.indexOf(fn); if (i >= 0) statusSubs.splice(i, 1); };
    },
    exportJSON, importJSON, download,
    /** Internal: F.store.init calls this so only real edits (not load/normalisation) get sync stamps. */
    baseline: takeBaseline,
    /** Testing hooks. */
    _cfg: cfg,
    _idle: async () => {
      for (let i = 0; i < 50; i++) {
        const waits = Array.from(inflight.values()).concat(pulling ? [pulling] : []);
        if (!waits.length) return;
        await Promise.all(waits.map((p) => p.catch(() => {})));
      }
    }
  };
})(window.Forge = window.Forge || {});
