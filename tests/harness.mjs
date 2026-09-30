// Test harness for FORGE's classic (IIFE) scripts: loads them into a fresh vm context per test with
// a controllable clock, an in-memory localStorage, an optional fake DOM, and an in-memory mock of the
// claude.ai Artifact runtime (claude.use('db' | 'user' | 'downloads')).
// Not a test file itself (no .test.mjs suffix); tests/index.js runs every *.test.mjs.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All date tests assume a DST-observing zone. Set before any Date use in this process.
export const DEFAULT_TZ = 'Europe/London';
process.env.TZ = DEFAULT_TZ;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** Run fn with process TZ switched (restored afterwards, even on failure). */
export async function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return await fn(); } finally { process.env.TZ = prev; }
}

/** Local timestamp for an ISO day + time in the CURRENT process TZ. */
export function at(iso, hh = 12, mm = 0) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/** Flush pending microtasks / short timers. */
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ localStorage mock */

export class MemoryStorage {
  constructor({ quotaChars = Infinity, throwOnAccess = false } = {}) {
    this.map = new Map();
    this.quotaChars = quotaChars;
    this.throwOnAccess = throwOnAccess;
    this.writes = 0;
  }
  _guard() { if (this.throwOnAccess) { const e = new Error('SecurityError: access denied'); e.name = 'SecurityError'; throw e; } }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { this._guard(); return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) {
    this._guard();
    const s = String(v);
    let total = s.length;
    for (const [kk, vv] of this.map) if (kk !== String(k)) total += vv.length;
    if (total > this.quotaChars) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
    this.map.set(String(k), s);
    this.writes++;
  }
  removeItem(k) { this._guard(); this.map.delete(String(k)); }
  clear() { this._guard(); this.map.clear(); }
  /** Snapshot copy — "restart the app" while the old instance (and its timers) is gone. */
  clone() { const c = new MemoryStorage({ quotaChars: this.quotaChars }); for (const [k, v] of this.map) c.map.set(k, v); return c; }
}

/* ------------------------------------------------------------------ minimal fake DOM (for util.h) */

const HTML_NS = 'http://www.w3.org/1999/xhtml';
class FakeText {
  constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
}
class FakeElement {
  constructor(tag, ns) {
    this.nodeType = 1;
    this.localName = tag;
    this.tagName = ns && ns !== HTML_NS ? tag : tag.toUpperCase();
    this.namespaceURI = ns || HTML_NS;
    this.attributes = new Map();
    this.childNodes = [];
    this.listeners = {};
    this.parentNode = null;
    const styleProps = {};
    this.style = { cssText: '', setProperty(k, v) { styleProps[k] = v; }, getPropertyValue(k) { return styleProps[k] ?? ''; }, _props: styleProps };
    this.dataset = {};
    if (this.namespaceURI === HTML_NS) {
      Object.assign(this, { hidden: false, title: '', disabled: false, htmlFor: '', type: '', name: '', placeholder: '' });
      if (tag === 'input' || tag === 'textarea' || tag === 'option') { this.value = ''; this.checked = false; }
      if (tag === 'input') Object.defineProperty(this, 'list', { get() { return null; }, enumerable: true });
      if (tag === 'select') {
        let v = '';
        Object.defineProperty(this, 'value', {
          get() { return v; },
          set(nv) { v = this.children.some((o) => o.value === nv) ? nv : ''; },
          enumerable: true
        });
      }
    }
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() { const el = this; return { contains: (c) => el.className.split(/\s+/).includes(c) }; }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; if (v !== '') this.appendChild(new FakeText(v)); }
  get innerHTML() { return this._html ?? ''; }
  set innerHTML(v) { this._html = String(v); this.childNodes = []; }
  addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); }
  dispatch(t, ev = {}) { for (const fn of this.listeners[t] || []) fn.call(this, Object.assign({ type: t, target: this }, ev)); }
  click() { this.clicked = (this.clicked || 0) + 1; this.dispatch('click'); }
}
export function makeDocument() {
  const listeners = {};
  const body = new FakeElement('body');
  return {
    body,
    documentElement: body,
    visibilityState: 'visible',
    createElement: (t) => new FakeElement(String(t).toLowerCase()),
    createElementNS: (ns, t) => new FakeElement(t, ns),
    createTextNode: (t) => new FakeText(t),
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) { const l = listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatch(t) { for (const fn of listeners[t] || []) fn({ type: t }); },
    listeners
  };
}

/* ------------------------------------------------------------------ claude.ai runtime mock */

const SEGMENT = /^[A-Za-z0-9_\-.~:@+]+$/;
function checkPath(p, wantDoc) {
  if (typeof p !== 'string' || !p) throw new TypeError('path must be a non-empty string');
  const segs = p.split('/');
  for (const s of segs) if (!SEGMENT.test(s) || s === '.' || s === '..') throw new TypeError('invalid segment "' + s + '" in ' + p);
  if ((segs.length % 2 === 0) !== wantDoc) throw new TypeError((wantDoc ? 'document' : 'collection') + ' path has wrong segment count: ' + p);
  if (segs.length > 16 || p.length > 1000) throw new TypeError('path too long');
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort().reverse()) o[k] = sortKeysDeep(v[k]); return o; }
  return v;
}
function deepFreeze(v) { if (v && typeof v === 'object') { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; }
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * In-memory mock honouring the documented API shape: use() → namespace|null, frozen snapshots with
 * keys REORDERED (reverse-sorted) to catch key-order-sensitive diffs, path grammar TypeErrors, error
 * objects { code, message }, and detection of overlapping writes to one document.
 * Share one mock (one `server`) between two loadForge() instances to simulate two devices.
 */
export function makeCloud({ uid = 'u_test_1', server = null } = {}) {
  const srv = server || { docs: new Map(), log: [], attempts: [], violations: [], faults: [], active: new Map(), latency: 2 };
  const opts = { dbNull: false, userNull: false, idNull: false, downloads: null, useDelayMs: 0 };
  const delay = () => new Promise((r) => setTimeout(r, srv.latency));
  function fault(op, p) {
    const f = srv.faults.find((x) => x.op === op && x.times > 0 && (!x.path || (x.path instanceof RegExp ? x.path.test(p) : x.path === p)));
    if (f) { f.times--; throw { code: f.code, message: 'mock failure: ' + f.code }; }
  }
  function snap(id, json) {
    const data = json === undefined ? undefined : deepFreeze(sortKeysDeep(JSON.parse(json)));
    return Object.freeze({ id, exists: json !== undefined, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } });
  }
  async function write(p, op, fn) {
    const n = (srv.active.get(p) || 0) + 1;
    srv.active.set(p, n);
    if (n > 1) srv.violations.push('overlapping ' + op + ' on ' + p);
    srv.attempts.push({ op, path: p, id: p.split('/').pop() });
    try { await delay(); fault(op, p); fn(); srv.log.push({ op, path: p, id: p.split('/').pop(), uid }); } finally { srv.active.set(p, srv.active.get(p) - 1); }
  }
  function docRef(p) {
    checkPath(p, true);
    const id = p.split('/').pop();
    return Object.freeze({
      id, path: p,
      async get() { await delay(); fault('get', p); return snap(id, srv.docs.get(p)); },
      async set(data) {
        if (!isPlain(data)) throw { code: 'invalid_argument', message: 'body must be an object' };
        const json = JSON.stringify(data);
        if (json.length > 262144) throw { code: 'invalid_argument', message: 'document over 256 KiB' };
        await write(p, 'set', () => srv.docs.set(p, json));
      },
      async update(data) {
        if (!srv.docs.has(p)) throw { code: 'invalid_argument', message: 'update requires existing doc' };
        await write(p, 'update', () => srv.docs.set(p, JSON.stringify(Object.assign(JSON.parse(srv.docs.get(p)), data))));
      },
      async delete() { await write(p, 'delete', () => srv.docs.delete(p)); },
      collection(sub) { return colRef(p + '/' + sub); }
    });
  }
  function colRef(p) {
    checkPath(p, false);
    const depth = p.split('/').length + 1;
    return Object.freeze({
      path: p,
      doc: (id) => docRef(p + '/' + id),
      async get() {
        await delay();
        fault('list', p);
        const docs = [];
        for (const [k, j] of srv.docs) if (k.startsWith(p + '/') && k.split('/').length === depth) docs.push(snap(k.split('/').pop(), j));
        docs.sort((a, b) => (a.id < b.id ? -1 : 1));
        return Object.freeze({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
      }
    });
  }
  const db = Object.freeze({ doc: docRef, collection: colRef });
  const user = Object.freeze({ id: async () => (opts.idNull ? null : uid), isOwner: async () => true, canEdit: async () => true, can: async () => null });
  const claude = {
    async use(name) {
      if (opts.useDelayMs) await new Promise((r) => setTimeout(r, opts.useDelayMs));
      if (name === 'db') return opts.dbNull ? null : db;
      if (name === 'user') return opts.userNull ? null : user;
      if (name === 'downloads') return opts.downloads;
      return null;
    }
  };
  const prefix = 'data/users/' + uid + '/';
  return {
    claude, server: srv, opts, uid,
    keys: () => Array.from(srv.docs.keys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort(),
    body: (key) => (srv.docs.has(prefix + key) ? JSON.parse(srv.docs.get(prefix + key)) : undefined),
    put: (key, body) => srv.docs.set(prefix + key, JSON.stringify(body)),
    remove: (key) => srv.docs.delete(prefix + key),
    writes: () => srv.log.filter((l) => l.uid === uid && l.op !== 'get'),
    clearLog: () => { srv.log.length = 0; }
  };
}

/* ------------------------------------------------------------------ data fixture */

// Mirrors the real data shape (SPEC §6.1): every library exercise has a movement `pattern`; some list
// hand-picked `alts`. The first exercise of each type (pickEx) is db-bench-press / pull-up / plank.
const FIXTURE_EXERCISES = [
  { id: 'db-bench-press', name: 'Dumbbell Bench Press', muscle: 'chest', pattern: 'h-push', secondary: ['triceps', 'shoulders'], equipment: ['dumbbells', 'bench'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 }, cues: ['Feet planted'], custom: false },
  { id: 'db-curl', name: 'Dumbbell Curl', muscle: 'biceps', pattern: 'elbow-flex', alts: ['chin-up'], secondary: [], equipment: ['dumbbells'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '10-12', rest: 60 }, cues: [], custom: false },
  { id: 'one-arm-db-row', name: 'One-arm Dumbbell Row', muscle: 'back', pattern: 'h-pull', secondary: ['biceps'], equipment: ['dumbbells', 'bench'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 }, cues: [], custom: false },
  { id: 'pull-up', name: 'Pull-up', muscle: 'back', pattern: 'v-pull', secondary: ['biceps'], equipment: ['pullupBar'], type: 'bodyweight', calisthenics: true, level: 'intermediate', defaults: { sets: 4, target: '5-8', rest: 120 }, cues: [], custom: false },
  { id: 'push-up', name: 'Push-up', muscle: 'chest', pattern: 'h-push', secondary: ['triceps'], equipment: ['bodyweight'], type: 'bodyweight', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: 'AMRAP', rest: 60 }, cues: [], custom: false },
  { id: 'bench-dip', name: 'Bench Dip', muscle: 'triceps', pattern: 'elbow-ext', secondary: [], equipment: ['bench'], type: 'bodyweight', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: '10-15', rest: 60 }, cues: [], custom: false },
  { id: 'plank', name: 'Plank', muscle: 'core', pattern: 'core-stab', secondary: [], equipment: ['bodyweight'], type: 'time', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: '30s', rest: 45 }, cues: [], custom: false },
  { id: 'goblet-squat', name: 'Goblet Squat', muscle: 'legs', pattern: 'squat', secondary: [], equipment: ['dumbbells'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '10-12', rest: 90 }, cues: [], custom: false },
  { id: 'barbell-back-squat', name: 'Barbell Back Squat', muscle: 'legs', pattern: 'squat', secondary: [], equipment: ['barbell'], type: 'weight', calisthenics: false, level: 'intermediate', defaults: { sets: 5, target: '5', rest: 150 }, cues: [], custom: false },
  // appended for swaps / the new split (order above is relied on by pickEx and exercises[0])
  { id: 'decline-push-up', name: 'Decline Push-up', muscle: 'chest', pattern: 'h-push', secondary: ['shoulders'], equipment: ['bench'], type: 'bodyweight', calisthenics: true, level: 'intermediate', defaults: { sets: 3, target: 'AMRAP', rest: 90 }, cues: [], custom: false },
  { id: 'archer-push-up', name: 'Archer Push-up', muscle: 'chest', pattern: 'h-push', secondary: ['triceps'], equipment: ['bodyweight'], type: 'bodyweight', calisthenics: true, level: 'advanced', defaults: { sets: 3, target: '5-8', rest: 90 }, cues: [], custom: false },
  { id: 'incline-db-press', name: 'Incline Dumbbell Press', muscle: 'chest', pattern: 'h-push', secondary: ['shoulders'], equipment: ['dumbbells', 'bench'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 4, target: '8-12', rest: 120 }, cues: [], custom: false },
  { id: 'db-fly', name: 'Dumbbell Fly', muscle: 'chest', pattern: 'fly', secondary: [], equipment: ['dumbbells', 'bench'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '10-15', rest: 60 }, cues: [], custom: false },
  { id: 'barbell-bench-press', name: 'Barbell Bench Press', muscle: 'chest', pattern: 'h-push', secondary: [], equipment: ['barbell', 'bench'], type: 'weight', calisthenics: false, level: 'intermediate', defaults: { sets: 5, target: '5', rest: 150 }, cues: [], custom: false },
  { id: 'chin-up', name: 'Chin-up', muscle: 'biceps', pattern: 'v-pull', secondary: ['back'], equipment: ['pullupBar'], type: 'bodyweight', calisthenics: true, level: 'intermediate', defaults: { sets: 3, target: 'AMRAP', rest: 120 }, cues: [], custom: false },
  { id: 'db-shoulder-press', name: 'Seated Dumbbell Shoulder Press', muscle: 'shoulders', pattern: 'v-push', secondary: ['triceps'], equipment: ['dumbbells', 'bench'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 4, target: '8-12', rest: 90 }, cues: [], custom: false },
  { id: 'pike-push-up', name: 'Pike Push-up', muscle: 'shoulders', pattern: 'v-push', secondary: ['triceps'], equipment: ['bodyweight'], type: 'bodyweight', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: '6-10', rest: 90 }, cues: [], custom: false },
  { id: 'lateral-raise', name: 'Lateral Raise', muscle: 'shoulders', pattern: 'raise', secondary: [], equipment: ['dumbbells'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '12-15', rest: 60 }, cues: [], custom: false },
  { id: 'db-wrist-curl', name: 'Dumbbell Wrist Curl', muscle: 'forearms', pattern: 'wrist', alts: ['dead-hang'], secondary: [], equipment: ['dumbbells'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '15-20', rest: 45 }, cues: [], custom: false },
  { id: 'dead-hang', name: 'Dead Hang', muscle: 'forearms', pattern: 'hang', secondary: ['back'], equipment: ['pullupBar'], type: 'time', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: '30s', rest: 60 }, cues: [], custom: false },
  { id: 'farmers-carry', name: "Farmer's Carry", muscle: 'forearms', pattern: 'carry', secondary: ['core'], equipment: ['dumbbells'], type: 'time', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '40s', rest: 60 }, cues: [], custom: false },
  { id: 'box-pistol-squat', name: 'Box Pistol Squat', muscle: 'legs', pattern: 'squat', secondary: ['core'], equipment: ['bench'], type: 'bodyweight', calisthenics: true, level: 'intermediate', defaults: { sets: 3, target: '5-8', rest: 90 }, cues: ['Per leg'], custom: false },
  { id: 'db-rdl', name: 'Dumbbell Romanian Deadlift', muscle: 'legs', pattern: 'hinge', secondary: [], equipment: ['dumbbells'], type: 'weight', calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 }, cues: [], custom: false },
  { id: 'hollow-body-hold', name: 'Hollow Body Hold', muscle: 'core', pattern: 'core-stab', secondary: [], equipment: ['bodyweight'], type: 'time', calisthenics: true, level: 'beginner', defaults: { sets: 3, target: '30s', rest: 45 }, cues: [], custom: false }
];
// The user's split (SPEC §6.2): Mon Chest & Biceps · Tue Back & Triceps · Wed Shoulders & Forearms ·
// Thu Legs · Fri Push · Sat & Sun rest, with calisthenics variations mixed in.
const FIXTURE_PROGRAM_SRC = `
(function (F) {
  'use strict';
  const it = (exId, sets, target, rest, note) => ({ id: F.util.uid('pi-'), exId, sets, target, rest, note: note || '' });
  F.data = F.data || {};
  F.data.program = {
    MUSCLES: { chest: { label: 'Chest', plate: 'red' }, back: { label: 'Back', plate: 'blue' }, biceps: { label: 'Biceps', plate: 'yellow' },
      triceps: { label: 'Triceps', plate: 'green' }, shoulders: { label: 'Shoulders', plate: 'orange' }, forearms: { label: 'Forearms', plate: 'teal' },
      legs: { label: 'Legs', plate: 'violet' }, core: { label: 'Core', plate: 'white' }, fullbody: { label: 'Full body', plate: 'white' } },
    EQUIPMENT: { bodyweight: { label: 'Bodyweight', icon: 'body' }, pullupBar: { label: 'Pull-up bar', icon: 'bar' }, dumbbells: { label: 'Dumbbells', icon: 'dumbbell' },
      bench: { label: 'Bench', icon: 'bench' }, barbell: { label: 'Barbell', icon: 'plate' }, bands: { label: 'Bands', icon: 'repeat' } },
    splitInfo: { name: '5-Day Bro Split', aka: [], summary: '', why: [], howToProgress: [] },
    defaultPlan() {
      const rest = () => ({ title: 'Rest Day', rest: true, focus: [], items: [] });
      return { days: {
        mon: { title: 'Chest & Biceps', rest: false, focus: ['chest', 'biceps'], items: [it('db-bench-press', 3, '8-12', 90), it('decline-push-up', 3, 'AMRAP', 90, 'Stop 1-2 reps before form breaks.'), it('chin-up', 3, 'AMRAP', 120), it('db-curl', 3, '10-12', 60)] },
        tue: { title: 'Back & Triceps', rest: false, focus: ['back', 'triceps'], items: [it('pull-up', 4, '5-8', 120), it('one-arm-db-row', 3, '8-12', 90), it('bench-dip', 3, '10-15', 60), it('dead-hang', 2, '30s', 60)] },
        wed: { title: 'Shoulders & Forearms', rest: false, focus: ['shoulders', 'forearms'], items: [it('db-shoulder-press', 4, '8-12', 90), it('pike-push-up', 3, '6-10', 90), it('lateral-raise', 3, '12-15', 60), it('db-wrist-curl', 3, '15-20', 45), it('dead-hang', 2, '30s', 60), it('farmers-carry', 3, '40s', 60)] },
        thu: { title: 'Legs', rest: false, focus: ['legs'], items: [it('goblet-squat', 3, '10-12', 90), it('db-rdl', 3, '8-12', 90), it('box-pistol-squat', 3, '5-8', 90), it('plank', 3, '30s', 45)] },
        fri: { title: 'Push', rest: false, focus: ['chest', 'shoulders', 'triceps'], items: [it('incline-db-press', 3, '8-12', 90), it('db-shoulder-press', 3, '8-12', 90), it('push-up', 3, 'AMRAP', 60), it('bench-dip', 3, '10-15', 60)] },
        sat: rest(), sun: rest()
      } };
    },
    templates: [
      { id: 'calisthenics-flow', title: 'Calisthenics Flow', focus: ['fullbody', 'core'], description: 'Light bodyweight session for a rest day.', restDay: true,
        items: [{ exId: 'push-up', sets: 2, target: 'AMRAP', rest: 60 }, { exId: 'pull-up', sets: 2, target: '5', rest: 90, note: 'Crisp reps.' }, { exId: 'hollow-body-hold', sets: 2, target: '20s', rest: 45 }] },
      { id: 'quick-pump', title: 'Quick Pump', focus: ['chest', 'back'], description: 'Short dumbbell session.', restDay: false,
        items: [{ exId: 'db-bench-press', sets: 2, target: '10-12', rest: 60 }, { exId: 'one-arm-db-row', sets: 2, target: '10-12', rest: 60 }] }
    ],
    restDayTemplateIds: ['calisthenics-flow'],
    quotes: ['Show up.'], quoteFor: () => 'Show up.',
    plateFor(m) { const M = F.data.program.MUSCLES; for (const k of Array.isArray(m) ? m : [m]) if (M[k]) return M[k].plate; return 'red'; }
  };
})(window.Forge = window.Forge || {});`;

/* ------------------------------------------------------------------ loader */

/**
 * Load FORGE's data-layer scripts into a fresh vm context.
 * @param {object} o
 *   now       initial clock (ms). Default: Wed 30 Sep 2026 10:00 local.
 *   storage   MemoryStorage (or null for "no localStorage").
 *   cloud     result of makeCloud() → window.claude.
 *   document  a fake document (makeDocument()) — omit for no DOM.
 *   data      'auto' (real js/data files when present & loadable, else fixture) | 'fixture'.
 *   init      true → F.store.init(F.persist.loadLocal()) after loading.
 */
export function loadForge(o = {}) {
  const now = o.now ?? at('2026-09-30', 10);
  // Long page timers (offline back-off, safety timers ≥ 1 s) are unref'd so they never keep the test
  // process alive; short ones (debounce, retries) stay referenced because tests await them.
  const unrefLong = (t, ms) => { if (Number(ms) >= 1000 && t && typeof t.unref === 'function') t.unref(); return t; };
  const sandbox = {
    console,
    setTimeout: (fn, ms, ...args) => unrefLong(setTimeout(fn, ms, ...args), ms),
    setInterval: (fn, ms, ...args) => unrefLong(setInterval(fn, ms, ...args), ms),
    clearTimeout, clearInterval, queueMicrotask, TextEncoder, URL,
    Blob: typeof Blob !== 'undefined' ? Blob : undefined
  };
  if (o.storage !== null) sandbox.localStorage = o.storage || new MemoryStorage();
  if (o.cloud) sandbox.claude = o.cloud.claude;
  if (o.document) sandbox.document = o.document;
  if (o.extra) Object.assign(sandbox, o.extra);
  const ctx = vm.createContext(sandbox);
  vm.runInContext(`
    var window = globalThis;
    (function () {
      const RealDate = Date;
      let now = ${Number(now)};
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(now); else super(...a); }
        static now() { return now; }
      }
      globalThis.Date = FakeDate;
      globalThis.__clock = { set(t) { now = t; }, get() { return now; } };
    })();`, ctx, { filename: 'harness-clock.js' });
  const run = (rel) => vm.runInContext(read(rel), ctx, { filename: rel });

  run('js/core/util.js');
  let dataMode = 'fixture';
  const wantReal = (o.data || 'auto') === 'auto' && !process.env.FORGE_FIXTURE &&
    exists('js/data/exercises.js') && exists('js/data/program.js');
  if (wantReal) {
    try {
      run('js/data/exercises.js');
      run('js/data/program.js');
      const d = ctx.Forge.data;
      if (d && Array.isArray(d.exercises) && d.exercises.length && d.program && typeof d.program.defaultPlan === 'function') {
        const p = d.program.defaultPlan();
        if (p && p.days && p.days.mon) dataMode = 'real';
      }
    } catch (e) {
      if (!loadForge.warned) { loadForge.warned = true; console.warn('[harness] real data files failed to load, using fixture:', e.message); }
    }
  }
  if (dataMode !== 'real') {
    ctx.Forge.data = { exercises: JSON.parse(JSON.stringify(FIXTURE_EXERCISES)) };
    vm.runInContext(FIXTURE_PROGRAM_SRC, ctx, { filename: 'fixture-program.js' });
  }
  run('js/core/store.js');
  run('js/core/queries.js');
  run('js/core/persist.js');
  const F = ctx.Forge;
  // Fast timers for tests.
  Object.assign(F.persist._cfg, { localMs: 5, cloudMs: 10, cloudMaxWaitMs: 50, retryMinMs: 5, retryMaxMs: 10, offlineRetryMs: 60000 });
  if (o.init) F.store.init(F.persist.loadLocal());
  const env = {
    F, ctx, dataMode, storage: sandbox.localStorage,
    now: () => ctx.__clock.get(),
    setNow: (t) => ctx.__clock.set(t),
    setDay: (iso, hh = 12, mm = 0) => ctx.__clock.set(at(iso, hh, mm)),
    advance: (ms) => ctx.__clock.set(ctx.__clock.get() + ms),
    /** Parse JSON inside the context realm (objects then pass instanceof/proto checks there). */
    json: (v) => vm.runInContext('(' + JSON.stringify(v) + ')', ctx),
    toasts: []
  };
  F.ui = { toast: (msg, opts) => env.toasts.push({ msg, opts }) };
  return env;
}

/* ------------------------------------------------------------------ domain helpers */

/** An exercise id of the given type from the loaded library (fixture or real). */
export function pickEx(F, type, { not = [], equipment } = {}) {
  const list = F.q.allExercises().filter((e) => e.type === type && !not.includes(e.id) && F.q.canDo(e) &&
    (!equipment || e.equipment.includes(equipment)));
  if (!list.length) throw new Error('no exercise of type ' + type);
  return list[0].id;
}

/** Deterministic week: every day trains `exId` except `restDays`. */
export function setWeek(F, exId, restDays = ['sun']) {
  for (const k of F.util.DAY_KEYS) {
    const rest = restDays.includes(k);
    F.store.setDay(k, { title: rest ? 'Rest' : 'Day ' + k, rest, focus: [], items: rest ? [] : [{ exId, sets: 3, target: '8-12', rest: 60 }] });
  }
}

/**
 * Log a completed workout on `iso` through the public store API.
 * exercises: [{ exId, sets: [{ w, r, t }] }]  (all sets marked done)
 */
export function logWorkout(env, iso, exercises, { hour = 18, dayKey, note } = {}) {
  const { F } = env;
  const prev = env.now();
  env.setDay(iso, hour);
  const a = F.store.startWorkout({ blank: true, dayKey, title: 'Test ' + iso });
  for (const ex of exercises) {
    const entry = F.store.addExerciseToActive(ex.exId);
    // make the row count match
    while (entry.sets.length < ex.sets.length) F.store.addSet(entry.id);
    while (entry.sets.length > ex.sets.length) F.store.removeSet(entry.id, entry.sets[entry.sets.length - 1].id);
    ex.sets.forEach((s, i) => {
      const row = entry.sets[i];
      F.store.updateSet(entry.id, row.id, { w: s.w ?? null, r: s.r ?? null, t: s.t ?? null });
      F.store.toggleSet(entry.id, row.id);
    });
  }
  env.advance(45 * 60 * 1000);
  const res = F.store.finishWorkout({ note });
  env.setNow(prev);
  if (!res) throw new Error('logWorkout produced no session for ' + iso + ' (active ' + JSON.stringify(a && a.id) + ')');
  return res;
}

/** Copy a value out of the vm realm (so deepStrictEqual compares structure, not prototypes). */
export const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
