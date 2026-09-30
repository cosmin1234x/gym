/* FORGE - js/core/picker.js
 * F.picker (SPEC 6.3): the exercise picker sheet (search + sticky filters, multi or single select),
 * the exercise info sheet, the create/edit form for custom exercises, and the swap sheet
 * (calisthenics variations + dumbbell & bench alternatives, SPEC 6.4).
 * Built on F.ui.sheet + F.util.h; styles in css/picker.css (scoped under .picker / .ex-info / .ex-form / .ex-swap).
 * Load time: definitions only. All user text is rendered as text nodes.
 * Muscles always come from F.data.program.MUSCLES (key order = display order); nothing here
 * hardcodes the muscle list.
 */
(function (F) {
  'use strict';

  /* ================================================================ shared helpers */

  const h = (...args) => F.util.h(...args);
  const icon = (name, opts) => (typeof F.icon === 'function' ? F.icon(name, opts) : document.createElement('span'));

  /** Muscles seen in the library, in library order. Only used if program.js failed to load. */
  function derivedMuscles() {
    const out = {};
    const list = F.data && Array.isArray(F.data.exercises) ? F.data.exercises : [];
    for (const e of list) {
      const m = e && typeof e.muscle === 'string' ? e.muscle : '';
      if (m && !Object.prototype.hasOwnProperty.call(out, m)) out[m] = { label: m.charAt(0).toUpperCase() + m.slice(1), plate: null };
    }
    return out;
  }

  // Fallbacks keep the picker usable even if program.js failed to load.
  const FALLBACK = {
    PATTERNS: {},
    EQUIPMENT: {
      bodyweight: { label: 'Bodyweight', icon: 'body' }, pullupBar: { label: 'Pull-up bar', icon: 'bar' },
      dumbbells: { label: 'Dumbbells', icon: 'dumbbell' }, bench: { label: 'Bench', icon: 'bench' },
      barbell: { label: 'Barbell', icon: 'plate' }, bands: { label: 'Bands', icon: 'repeat' }
    },
    TYPES: {
      weight: { label: 'Weighted', short: 'Weight', icon: 'dumbbell', logs: 'Logs weight \u00d7 reps' },
      bodyweight: { label: 'Bodyweight', short: 'Reps', icon: 'body', logs: 'Logs reps (added weight optional)' },
      time: { label: 'Timed hold', short: 'Hold', icon: 'timer', logs: 'Logs seconds held' }
    },
    LEVELS: {
      beginner: { label: 'Beginner', rank: 1 }, intermediate: { label: 'Intermediate', rank: 2 },
      advanced: { label: 'Advanced', rank: 3 }
    }
  };
  const program = () => (F.data && F.data.program) || {};
  const vocab = (key) => program()[key] || (key === 'MUSCLES' ? derivedMuscles() : FALLBACK[key]);
  const has = (obj, key) => !!obj && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

  const muscleKeys = () => Object.keys(vocab('MUSCLES'));
  const isMuscle = (m) => has(vocab('MUSCLES'), m);
  const muscleLabel = (m) => (isMuscle(m) ? vocab('MUSCLES')[m].label : 'Other');
  /** Default muscle for new custom exercises: 'fullbody' when it exists, else the last group. */
  const defaultMuscle = () => (isMuscle('fullbody') ? 'fullbody' : (muscleKeys().slice(-1)[0] || 'fullbody'));
  const equipMeta = (k) => (has(vocab('EQUIPMENT'), k) ? vocab('EQUIPMENT')[k] : { label: String(k || 'Gear'), icon: 'dumbbell' });
  const typeKey = (t) => (has(vocab('TYPES'), t) ? t : 'weight');
  const typeMeta = (t) => vocab('TYPES')[typeKey(t)];
  const levelKey = (l) => (has(vocab('LEVELS'), l) ? l : 'beginner');
  const levelMeta = (l) => vocab('LEVELS')[levelKey(l)];
  const patternMeta = (p) => (has(vocab('PATTERNS'), p) ? vocab('PATTERNS')[p] : null);

  function plateFor(m) {
    try { if (typeof program().plateFor === 'function') return program().plateFor(m); } catch (_) { /* fall through */ }
    return (isMuscle(m) && vocab('MUSCLES')[m].plate) || 'red';
  }

  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); } catch (err) { console.error('[forge/picker]', err); return undefined; }
  }

  function allExercises() {
    try { if (F.q && typeof F.q.allExercises === 'function') return F.q.allExercises().filter(Boolean); } catch (err) { console.error('[forge/picker]', err); }
    return F.data && Array.isArray(F.data.exercises) ? F.data.exercises.slice() : [];
  }
  function getExercise(id) {
    try { if (F.q && typeof F.q.exercise === 'function') return F.q.exercise(id); } catch (err) { console.error('[forge/picker]', err); }
    return allExercises().find((e) => e.id === id) || {
      id: String(id), name: 'Deleted exercise', muscle: 'fullbody', secondary: [], equipment: [], type: 'weight',
      calisthenics: false, level: 'beginner', defaults: { sets: 3, target: '8-12', rest: 90 }, cues: [], custom: false, missing: true
    };
  }
  const canDo = (ex) => { try { return F.q && typeof F.q.canDo === 'function' ? !!F.q.canDo(ex) : true; } catch (_) { return true; } };
  const owns = (k) => { try { return F.q && typeof F.q.owns === 'function' ? !!F.q.owns(k) : true; } catch (_) { return true; } };
  const reducedMotion = () => { try { return !!F.util.reducedMotion(); } catch (_) { return false; } };
  const haptic = (p) => { try { F.util.haptic(p); } catch (_) { /* optional */ } };
  const toast = (msg, opts) => { try { F.ui.toast(msg, opts); } catch (_) { /* optional */ } };

  /** Restart a one-shot CSS animation class (no-op under reduced motion). */
  function replay(el, cls) {
    if (!el || reducedMotion()) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add(cls);
  }
  /** Contract-level chip toggle (.is-active + aria-pressed) without relying on ui.js extras. */
  function setChip(el, on) {
    el.classList.toggle('is-active', !!on);
    el.setAttribute('aria-pressed', String(!!on));
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const setsLine = (ex) => {
    const d = ex && ex.defaults ? ex.defaults : {};
    return (d.sets || 3) + ' \u00d7 ' + (d.target || '8-12');
  };
  /** 45 -> { value: '45', unit: 's' }, 90 -> '1:30 min', 120 -> '2 min'. */
  function restParts(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 60) return { value: String(s), unit: 's' };
    const m = Math.floor(s / 60);
    const r = s % 60;
    return { value: r ? m + ':' + String(r).padStart(2, '0') : String(m), unit: 'min' };
  }

  /* ---------------------------------------------------------------- search */

  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) { /* old engines */ }
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Gym slang -> words that appear in names / labels.
  const SYNONYMS = {
    db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', bw: 'bodyweight', kb: 'kettlebell',
    abs: 'core', ab: 'core', lats: 'back', lat: 'back', traps: 'shrug', pecs: 'chest', pec: 'chest',
    grip: 'forearms', wrists: 'wrist', brachioradialis: 'forearms',
    delts: 'shoulders', delt: 'shoulders', bis: 'biceps', bi: 'biceps', tris: 'triceps', tri: 'triceps',
    glutes: 'legs', glute: 'legs', quads: 'legs', hamstrings: 'legs', hams: 'legs', calves: 'calf',
    cali: 'calisthenics', calis: 'calisthenics', calisthenic: 'calisthenics',
    hold: 'hold', holds: 'hold', hspu: 'handstand', ohp: 'shoulder press', rdl: 'romanian', t2b: 'toes'
  };
  function tokenize(q) {
    return norm(q).split(' ').filter(Boolean).map((t) => {
      const alts = [t];
      if (SYNONYMS[t]) alts.push(norm(SYNONYMS[t]));
      return alts;
    });
  }
  function haystack(ex) {
    const pat = patternMeta(ex.pattern);
    const parts = [ex.name, ex.id, muscleLabel(ex.muscle), ex.muscle, levelMeta(ex.level).label, typeMeta(ex.type).label,
      pat ? pat.label : '', ex.type === 'time' ? 'hold timed' : '', ex.calisthenics ? 'calisthenics bodyweight' : '', ex.custom ? 'custom mine' : ''];
    for (const m of Array.isArray(ex.secondary) ? ex.secondary : []) parts.push(muscleLabel(m));
    for (const k of Array.isArray(ex.equipment) ? ex.equipment : []) parts.push(equipMeta(k).label);
    const spaced = ' ' + norm(parts.join(' ')) + ' ';
    return { spaced, compact: spaced.replace(/ /g, '') };
  }
  function matchesQuery(ex, tokens) {
    if (!tokens.length) return true;
    const hs = haystack(ex);
    return tokens.every((alts) => alts.some((t) => hs.spaced.indexOf(t) >= 0 || hs.compact.indexOf(t.replace(/ /g, '')) >= 0));
  }
  /** Lower is better: whole query at the start of the name, then a name word starting with it. */
  function score(ex, q) {
    const n = norm(ex.name);
    if (!q) return 2;
    if (n.startsWith(q) || n.replace(/ /g, '').startsWith(q.replace(/ /g, ''))) return 0;
    if ((' ' + n).indexOf(' ' + q.split(' ')[0]) >= 0) return 1;
    return 2;
  }

  /* ---------------------------------------------------------------- shared bits of markup */

  function equipIcons(ex, cls) {
    const keys = (Array.isArray(ex.equipment) ? ex.equipment : []).filter((k) => k !== 'bodyweight');
    const list = keys.length ? keys : ['bodyweight'];
    const labels = list.map((k) => equipMeta(k).label);
    return h('span', { class: cls, title: labels.join(', ') },
      list.map((k) => h('span', { class: ['picker__eq-ico', owns(k) ? null : 'is-missing'], attrs: { 'aria-hidden': 'true' } },
        icon(equipMeta(k).icon, { size: 16 }))),
      h('span.sr-only', null, '. Equipment: ' + labels.join(', ')));
  }

  /* ================================================================ picker */

  const TYPE_FILTERS = [
    { value: 'weight', label: 'Weighted' },
    { value: 'bodyweight', label: 'Bodyweight' },
    { value: 'time', label: 'Holds' }
  ];

  /**
   * Exercise picker sheet.
   * open({ title = 'Add exercises', multi = true, onPick(exIds) })
   * Private extras: muscle (preset muscle filter), subtitle.
   */
  function open(opts) {
    const o = opts || {};
    const multi = o.multi !== false;
    const st = { query: '', muscle: isMuscle(o.muscle) ? o.muscle : null, cali: false, type: null, mine: true, selected: [] };
    const rows = new Map(); // exId -> { li, pick }
    let sheetApi = null;
    let footBtn = null;
    let resizeObs = null;
    let finished = false;

    /* --- search */
    const search = h('input.input.picker__search-input', {
      type: 'search',
      placeholder: 'Search exercises',
      attrs: {
        'aria-label': 'Search exercises', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
        spellcheck: 'false', enterkeyhint: 'search'
      },
      on: {
        input: () => setQuery(search.value),
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); search.blur(); } }
      }
    });
    const clearBtn = h('button.picker__search-clear', {
      type: 'button', hidden: true, attrs: { 'aria-label': 'Clear search' },
      on: { click: () => { search.value = ''; setQuery(''); search.focus(); } }
    }, icon('x', { size: 18 }));
    const searchWrap = h('div.picker__search', { attrs: { role: 'search' } },
      icon('search', { size: 20, cls: 'picker__search-icon' }), search, clearBtn);

    /* --- muscle chips */
    const allChip = F.ui.chip({ label: 'All', active: st.muscle === null, onClick: () => setMuscle(null) });
    const muscleChips = muscleKeys().map((m) => {
      const c = F.ui.chip({ label: muscleLabel(m), plate: m, active: st.muscle === m, onClick: () => setMuscle(st.muscle === m ? null : m) });
      c.dataset.muscle = m;
      return c;
    });
    const muscleRow = h('div.chips.picker__chips', { attrs: { role: 'group', 'aria-label': 'Filter by muscle' } }, allChip, muscleChips);

    /* --- calisthenics + type chips */
    const caliChip = F.ui.chip({
      label: 'Calisthenics', icon: 'body', active: false,
      onClick: () => { st.cali = !st.cali; setChip(caliChip, st.cali); changed(); }
    });
    const typeChips = TYPE_FILTERS.map((t) => {
      const c = F.ui.chip({
        label: t.label, active: false,
        onClick: () => { st.type = st.type === t.value ? null : t.value; syncChips(); changed(); }
      });
      c.dataset.type = t.value;
      return c;
    });
    const filterRow = h('div.chips.picker__chips', { attrs: { role: 'group', 'aria-label': 'More filters' } },
      caliChip, h('span.picker__sep', { attrs: { 'aria-hidden': 'true' } }), typeChips);

    /* --- equipment switch + result count */
    const mineSwitch = F.ui.switchEl({
      label: 'My equipment only', checked: true,
      onChange: (v) => { st.mine = !!v; changed(); }
    });
    mineSwitch.classList.add('picker__mine');
    const countEl = h('span.picker__count', { attrs: { 'aria-live': 'polite' } });
    const metaRow = h('div.picker__meta', null, countEl, mineSwitch);

    const bar = h('div.picker__bar', null, searchWrap, muscleRow, filterRow, metaRow);
    const listEl = h('div.picker__list');
    const root = h('div.picker__root', null, bar, listEl);

    /* --- state changes */
    function syncChips() {
      setChip(allChip, st.muscle === null);
      muscleChips.forEach((c) => setChip(c, c.dataset.muscle === st.muscle));
      typeChips.forEach((c) => setChip(c, c.dataset.type === st.type));
      setChip(caliChip, st.cali);
    }
    function setMuscle(m) {
      st.muscle = m;
      syncChips();
      changed();
    }
    function setQuery(q) {
      st.query = String(q || '');
      clearBtn.hidden = !st.query;
      render('typing');
      scrollTop();
    }
    function changed() {
      haptic(8);
      render('filter');
      scrollTop();
    }
    function scrollTop() {
      if (sheetApi && sheetApi.body) sheetApi.body.scrollTop = 0;
    }

    /* --- selection */
    function isSelected(id) { return st.selected.indexOf(id) >= 0; }
    function syncRow(id) {
      const r = rows.get(id);
      if (!r) return;
      const on = isSelected(id);
      r.li.classList.toggle('is-selected', on);
      if (multi) r.pick.setAttribute('aria-pressed', String(on));
    }
    function toggle(id) {
      const i = st.selected.indexOf(id);
      const on = i < 0;
      if (on) st.selected.push(id); else st.selected.splice(i, 1);
      syncRow(id);
      const r = rows.get(id);
      if (on && r) replay(r.li.querySelector('.picker__check'), 'is-popping');
      haptic(on ? 12 : 6);
      syncFooter(true);
    }
    function pickOne(id) {
      if (finished) return;
      finished = true;
      haptic(12);
      if (sheetApi) sheetApi.close('pick');
      safeCall(o.onPick, [id]);
    }
    function submit() {
      if (!st.selected.length) {
        toast('Tap exercises to select them first', { type: 'info' });
        if (footBtn) replay(footBtn, 'shake');
        return;
      }
      if (finished) return;
      finished = true;
      const ids = st.selected.slice();
      if (sheetApi) sheetApi.close('pick');
      safeCall(o.onPick, ids);
    }
    function syncFooter(bump) {
      if (!footBtn) return;
      const n = st.selected.length;
      footBtn.disabled = n === 0;
      F.util.clear(footBtn);
      footBtn.appendChild(icon(n ? 'check' : 'plus'));
      footBtn.appendChild(document.createTextNode(n ? 'Add ' + plural(n, 'exercise') : 'Select exercises'));
      if (bump) replay(footBtn, 'is-bump');
    }

    /* --- list */
    function compute() {
      const tokens = tokenize(st.query);
      const q = norm(st.query);
      const order = muscleKeys();
      const groups = new Map(order.map((m) => [m, []]));
      let total = 0;
      let hidden = 0;
      allExercises().forEach((ex, i) => {
        if (!ex || !ex.id) return;
        if (st.muscle && ex.muscle !== st.muscle) return;
        if (st.cali && !ex.calisthenics) return;
        if (st.type && typeKey(ex.type) !== st.type) return;
        if (!matchesQuery(ex, tokens)) return;
        if (st.mine && !canDo(ex)) { hidden++; return; }
        const key = groups.has(ex.muscle) ? ex.muscle : (groups.has('fullbody') ? 'fullbody' : order[order.length - 1]);
        const list = groups.get(key);
        if (!list) return;
        list.push({ ex, i, s: score(ex, q) });
        total++;
      });
      for (const list of groups.values()) {
        // relevance while searching; otherwise library order with custom exercises last
        list.sort((a, b) => (a.s - b.s) || ((a.ex.custom ? 1 : 0) - (b.ex.custom ? 1 : 0)) || (a.i - b.i));
      }
      return { groups, total, hidden };
    }

    function createRow() {
      return h('button.picker__create', { type: 'button', on: { click: () => createCustom(st.query.trim()) } },
        h('span.picker__create-ico', { attrs: { 'aria-hidden': 'true' } }, icon('plus', { size: 20 })),
        h('span.picker__main', null,
          h('span.picker__name', null, 'Create custom exercise'),
          h('span.picker__sub', null, 'Not in the list? Add your own.')));
    }

    function rowEl(ex, n) {
      const plate = plateFor(ex.muscle);
      const pick = h('button.picker__pick', {
        type: 'button',
        attrs: { 'aria-pressed': multi ? String(isSelected(ex.id)) : null },
        on: { click: () => (multi ? toggle(ex.id) : pickOne(ex.id)) }
      },
      F.ui.plateDot(ex.muscle),
      h('span.picker__main', null,
        h('span.picker__name', null, ex.name, ex.custom ? h('span.badge.picker__custom', null, 'Custom') : null),
        h('span.picker__sub', null,
          h('span', null, levelMeta(ex.level).label + ' \u00b7 '),
          h('span.picker__sets', null, setsLine(ex)),
          equipIcons(ex, 'picker__eq'))),
      multi
        ? h('span.picker__check', { attrs: { 'aria-hidden': 'true' } }, icon('check', { size: 16 }))
        : h('span.picker__go', { attrs: { 'aria-hidden': 'true' } }, icon('chevron-right', { size: 18 })));
      const infoBtn = h('button.picker__info', {
        type: 'button',
        attrs: { 'aria-label': 'How to do ' + ex.name },
        on: { click: () => showInfo(ex.id) }
      }, icon('info', { size: 20 }));
      const li = h('li.picker__row', {
        class: isSelected(ex.id) ? 'is-selected' : null,
        dataset: { id: ex.id, plate },
        style: n < 14 ? { '--i': String(n) } : null
      }, pick, infoBtn);
      rows.set(ex.id, { li, pick });
      return li;
    }

    function render(mode) {
      const { groups, total, hidden } = compute();
      rows.clear();
      F.util.clear(listEl);
      listEl.classList.remove('is-entering', 'is-filtering');
      if (mode === 'enter' && !reducedMotion()) listEl.classList.add('is-entering');
      else if (mode === 'filter') replay(listEl, 'is-filtering');

      F.util.clear(countEl);
      countEl.appendChild(h('span.picker__nowrap', null, plural(total, 'exercise')));
      if (hidden) countEl.appendChild(h('span.picker__nowrap', null, ' \u00b7 ' + hidden + ' hidden'));
      // With no results the empty state carries the (more specific) create action instead.
      if (total || hidden || !st.query.trim()) listEl.appendChild(createRow());

      let n = 0;
      for (const [m, list] of groups) {
        if (!list.length) continue;
        const ul = h('ul.picker__rows', { attrs: { 'aria-label': muscleLabel(m) } }, list.map((x) => rowEl(x.ex, n++)));
        listEl.appendChild(h('section.picker__group', { dataset: { plate: plateFor(m) } },
          h('h3.picker__group-head', null, F.ui.plateDot(m), h('span', null, muscleLabel(m)),
            h('span.picker__group-count', null, String(list.length))),
          ul));
      }

      if (!total) {
        const q = st.query.trim();
        listEl.appendChild(F.ui.empty({
          icon: 'search',
          title: 'Nothing found',
          text: hidden
            ? plural(hidden, 'match', 'matches') + ' need equipment you haven\u2019t ticked in Settings.'
            : (q ? 'No exercise matches \u201c' + q + '\u201d. Create it and it\u2019s yours to reuse.' : 'No exercise matches these filters.'),
          action: hidden
            ? { label: 'Show all equipment', icon: 'filter', onClick: () => setMine(false) }
            : (q ? { label: 'Create \u201c' + q.slice(0, 30) + '\u201d', icon: 'plus', onClick: () => createCustom(q) }
              : { label: 'Clear filters', icon: 'x', onClick: clearFilters })
        }));
      } else if (hidden && st.mine) {
        listEl.appendChild(h('div.picker__note', null,
          h('span', null, plural(hidden, 'more exercise') + ' need equipment you don\u2019t have.'),
          h('button.btn.btn--ghost.btn--sm', { type: 'button', on: { click: () => setMine(false) } }, 'Show them')));
      }
    }

    function setMine(on) {
      st.mine = !!on;
      const input = mineSwitch.querySelector('input');
      if (input) input.checked = st.mine;
      changed();
    }
    function clearFilters() {
      st.muscle = null; st.cali = false; st.type = null; st.query = ''; search.value = ''; clearBtn.hidden = true;
      syncChips();
      changed();
    }

    /* --- info + custom exercises from inside the picker */
    function showInfo(id) {
      let infoApi = null;
      const label = multi ? (isSelected(id) ? 'Remove from selection' : 'Select exercise') : 'Choose exercise';
      const btn = h('button.btn.btn--primary.btn--lg.btn--block', {
        type: 'button',
        on: {
          click: () => {
            if (infoApi) infoApi.close('select');
            if (multi) toggle(id); else pickOne(id);
          }
        }
      }, icon(multi && isSelected(id) ? 'minus' : 'plus'), label);
      infoApi = info(id, { extra: btn });
    }

    function createCustom(name) {
      customForm({
        name,
        muscle: st.muscle,
        onSave: (ex) => {
          if (!ex || !ex.id || finished) return;
          if (!multi) { pickOne(ex.id); return; }
          if (!isSelected(ex.id)) st.selected.push(ex.id);
          // Show the new exercise: its muscle group, no other filters.
          st.query = ''; search.value = ''; clearBtn.hidden = true;
          st.muscle = isMuscle(ex.muscle) ? ex.muscle : null;
          st.cali = false; st.type = null;
          if (!canDo(ex)) { st.mine = false; const inp = mineSwitch.querySelector('input'); if (inp) inp.checked = false; }
          syncChips();
          lastSig = signature();
          render('filter');
          syncFooter(true);
          const r = rows.get(ex.id);
          if (r) {
            try { r.li.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { /* old engines */ }
            replay(r.li, 'is-new');
            replay(r.li.querySelector('.picker__check'), 'is-popping');
          }
        }
      });
    }

    /* --- keep in sync with the store (custom exercises / equipment edited elsewhere) */
    function signature() {
      try {
        const s = F.store.get();
        return JSON.stringify([s.settings && s.settings.equipment, (s.customExercises || []).map((e) =>
          [e.id, e.name, e.muscle, e.type, e.level, e.equipment, e.calisthenics, e.defaults])]);
      } catch (_) { return ''; }
    }
    let lastSig = signature();
    let unsub = null;
    try {
      if (F.store && typeof F.store.subscribe === 'function') {
        unsub = F.store.subscribe(() => {
          const sig = signature();
          if (sig === lastSig || finished) return;
          lastSig = sig;
          // drop selections whose exercise was deleted
          st.selected = st.selected.filter((id) => !getExercise(id).missing);
          render('store');
          syncFooter(false);
        });
      }
    } catch (err) { console.error('[forge/picker]', err); }

    /* --- mount */
    render('enter');
    sheetApi = F.ui.sheet({
      title: o.title || (multi ? 'Add exercises' : 'Choose exercise'),
      subtitle: o.subtitle || null,
      content: root,
      size: 'full',
      className: 'picker',
      actions: multi ? [{ label: 'Select exercises', variant: 'primary', icon: 'plus', onClick: submit }] : null,
      onClose: () => {
        finished = true;
        if (typeof unsub === 'function') safeCall(unsub);
        if (resizeObs) { try { resizeObs.disconnect(); } catch (_) { /* ignore */ } }
      }
    });
    if (sheetApi && sheetApi.el) {
      footBtn = sheetApi.el.querySelector('.sheet__foot .btn--primary') || sheetApi.el.querySelector('.sheet__foot button');
      syncFooter(false);
      const body = sheetApi.body;
      if (body) {
        body.addEventListener('scroll', () => bar.classList.toggle('is-stuck', body.scrollTop > 2), { passive: true });
      }
      // Group headers stick just below the (variable-height) filter bar.
      const measure = () => root.style.setProperty('--picker-bar-h', bar.offsetHeight + 'px');
      measure();
      if (typeof ResizeObserver === 'function') {
        try { resizeObs = new ResizeObserver(measure); resizeObs.observe(bar); } catch (_) { resizeObs = null; }
      }
    }
    return sheetApi;
  }

  /* ================================================================ info sheet */

  /** Exercise info sheet: muscles, defaults, level, logging type, equipment, numbered cues, then `extra`. */
  function info(exId, opts) {
    const o = opts || {};
    const ex = getExercise(exId);
    const plate = plateFor(ex.muscle);
    const d = ex.defaults || {};
    const lv = levelMeta(ex.level);
    const tp = typeMeta(ex.type);

    const muscleTag = (m, primary) => h('span', {
      class: ['ex-info__muscle', primary ? 'is-primary' : null],
      dataset: { plate: plateFor(m) }
    }, h('span.plate-dot', { attrs: { 'aria-hidden': 'true' } }), muscleLabel(m),
    primary ? h('span.ex-info__main', null, 'Main') : null);
    const secondary = (Array.isArray(ex.secondary) ? ex.secondary : []).filter((m) => isMuscle(m) && m !== ex.muscle);

    const rest = restParts(d.rest);
    const stats = h('div.ex-info__stats', null,
      h('div.stat', { dataset: { plate } },
        h('span.stat__label', null, icon('repeat', { size: 15 }), 'Sets \u00d7 target'),
        h('span.stat__value', null, String(d.sets || 3), h('span.stat__unit', null, '\u00d7'), String(d.target || '8-12'))),
      h('div.stat', null,
        h('span.stat__label', null, icon('timer', { size: 15 }), 'Rest'),
        h('span.stat__value', null, rest.value, h('span.stat__unit', null, rest.unit))));

    const fact = (ic, label, value) => h('div.ex-info__fact', null,
      h('dt', null, icon(ic, { size: 18 }), label), h('dd', null, value));
    const equipment = (Array.isArray(ex.equipment) && ex.equipment.length ? ex.equipment : ['bodyweight']);
    const pat = patternMeta(ex.pattern);
    const facts = h('dl.ex-info__facts', null,
      fact('target', 'Level', h('span.ex-info__level', { dataset: { level: String(lv.rank || 1) } },
        h('span.ex-info__bars', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')), lv.label)),
      pat ? fact('bolt', 'Movement', pat.label) : null,
      fact(tp.icon || 'dumbbell', 'Tracking', tp.logs || tp.label),
      fact('bench', 'Equipment', h('span.ex-info__equip', null, equipment.map((k) => {
        const mine = owns(k);
        return h('span', { class: ['ex-info__eq', mine ? null : 'is-missing'], title: mine ? null : 'Not in your equipment' },
          icon(equipMeta(k).icon, { size: 16 }), equipMeta(k).label, mine ? null : h('span.sr-only', null, ' (not in your equipment)'));
      }))));

    const cueList = (Array.isArray(ex.cues) ? ex.cues : []).filter((c) => typeof c === 'string' && c.trim());
    const cues = cueList.length
      ? h('ol.ex-info__cues', null, cueList.map((c, i) => h('li', { style: { '--i': String(i) } },
        h('span.ex-info__cue-n', { attrs: { 'aria-hidden': 'true' } }, String(i + 1)), h('span', null, c))))
      : h('p.ex-info__empty', null, ex.custom ? 'No form cues yet. Edit this exercise to add your own.' : 'No form cues for this one yet.');

    let extra = null;
    if (o.extra && (typeof o.extra.nodeType === 'number' || Array.isArray(o.extra) || typeof o.extra === 'string')) {
      extra = h('div.ex-info__extra', null, o.extra);
    }

    const content = ex.missing
      ? h('div.ex-info__content', null,
        h('p.ex-info__empty', null, 'This exercise was deleted from your library. Sets you already logged stay in your history.'),
        extra)
      : h('div.ex-info__content', null,
        h('section.ex-info__section', null,
          h('h3.eyebrow', null, 'Muscles worked'),
          h('div.ex-info__muscles', null, muscleTag(ex.muscle, true), secondary.map((m) => muscleTag(m, false)))),
        stats,
        facts,
        h('section.ex-info__section', null, h('h3.eyebrow', null, 'Form cues'), cues),
        extra);

    const subtitle = [muscleLabel(ex.muscle), ex.calisthenics ? 'Calisthenics' : null, ex.custom ? 'Custom' : null].filter(Boolean).join(' \u00b7 ');
    const api = F.ui.sheet({ title: ex.name, subtitle: ex.missing ? null : subtitle, content, className: 'ex-info' });
    if (api && api.el) api.el.dataset.plate = plate; // tints the sheet's top rim
    return api;
  }

  /* ================================================================ custom exercise form */

  const TARGET_PRESETS = {
    weight: ['5', '6-8', '8-12', '12-15'],
    bodyweight: ['5-8', '8-12', '12-15', 'AMRAP'],
    time: ['20s', '30s', '45s', '60s']
  };
  const DEFAULT_TARGET = { weight: '8-12', bodyweight: 'AMRAP', time: '30s' };
  const MAX_NAME = 60;
  const MAX_CUES = 6;

  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const cleanText = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /** Put a removed custom exercise back (undo). Prefers the store's own action when it exists. */
  function restoreCustom(ex, index) {
    try {
      if (typeof F.store.restoreCustomExercise === 'function') { F.store.restoreCustomExercise(ex, index); return; }
      F.store.update((s) => {
        if (!Array.isArray(s.customExercises) || s.customExercises.some((e) => e && e.id === ex.id)) return;
        s.customExercises.splice(Math.max(0, Math.min(index, s.customExercises.length)), 0, ex);
      }, 'library');
    } catch (err) { console.error('[forge/picker]', err); }
  }

  /**
   * Create / edit a custom exercise.
   * customForm({ exercise = null, onSave(ex) })
   * Private extras: name / muscle (prefill for a new one), onDelete(ex).
   * Passing a library exercise opens a pre-filled "custom copy".
   */
  function customForm(opts) {
    const o = opts || {};
    const src = o.exercise && typeof o.exercise === 'object' ? o.exercise : null;
    const current = src && src.id ? getExercise(src.id) : null;
    const editing = !!(current && current.custom && !current.missing);
    const base = editing ? current : (src || {});
    const bd = base.defaults || {};

    const type0 = typeKey(base.type);
    const draft = {
      muscle: isMuscle(base.muscle) ? base.muscle : (isMuscle(o.muscle) ? o.muscle : defaultMuscle()),
      type: type0,
      equipment: (Array.isArray(base.equipment) ? base.equipment : []).filter((k) => has(vocab('EQUIPMENT'), k)),
      calisthenics: typeof base.calisthenics === 'boolean' ? base.calisthenics : type0 !== 'weight',
      sets: clampInt(bd.sets, 1, 10, 3),
      rest: clampInt(bd.rest, 0, 600, type0 === 'time' ? 60 : 90)
    };
    if (!draft.equipment.length) draft.equipment = [type0 === 'weight' ? 'dumbbells' : 'bodyweight'];
    // Until the user touches these, they follow the chosen type.
    const touched = { equipment: !!src, target: !!src, cali: !!src };

    let sheetApi = null;
    const initialName = editing ? current.name : (src ? (cleanText(src.name) + ' (custom)') : cleanText(o.name));

    /* --- name */
    const nameId = 'ex-form-name-' + Math.random().toString(36).slice(2, 8);
    const nameInput = h('input.input', {
      id: nameId, type: 'text', value: initialName.slice(0, MAX_NAME), placeholder: 'e.g. Towel Row', maxLength: MAX_NAME,
      attrs: { autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', 'aria-required': 'true', 'aria-describedby': nameId + '-err' },
      on: {
        input: () => { clearError(); syncCount(); },
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } }
      }
    });
    const nameErr = h('p.ex-form__error', { id: nameId + '-err', hidden: true, attrs: { role: 'alert' } });
    const nameCount = h('span.ex-form__count', { attrs: { 'aria-hidden': 'true' } });
    const nameField = h('div.field.ex-form__name', null,
      h('div.ex-form__label-row', null, h('label.field__label', { for: nameId }, 'Name'), nameCount),
      nameInput, nameErr);
    function syncCount() { nameCount.textContent = String(nameInput.value.length) + '/' + MAX_NAME; }
    function clearError() {
      if (nameErr.hidden) return;
      nameErr.hidden = true;
      nameInput.removeAttribute('aria-invalid');
    }
    function showError(msg) {
      nameErr.textContent = msg;
      nameErr.hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      replay(nameField, 'shake');
      haptic([20, 40, 20]);
      try { nameInput.focus(); } catch (_) { /* ignore */ }
    }
    syncCount();

    /* --- muscle */
    const muscleChips = muscleKeys().map((m) => {
      const c = F.ui.chip({ label: muscleLabel(m), plate: m, active: draft.muscle === m, onClick: () => { draft.muscle = m; syncMuscles(); } });
      c.dataset.muscle = m;
      return c;
    });
    function syncMuscles() { muscleChips.forEach((c) => setChip(c, c.dataset.muscle === draft.muscle)); }
    const muscleGroup = h('div.field.ex-form__group', { attrs: { role: 'group', 'aria-labelledby': nameId + '-m' } },
      h('div.field__label', { id: nameId + '-m' }, 'Main muscle'),
      h('div.chips.chips--wrap', null, muscleChips));

    /* --- type */
    const typeHint = h('p.field__hint', null, typeMeta(draft.type).logs);
    const typeSeg = F.ui.segmented({
      label: 'How it is tracked',
      value: draft.type,
      options: [
        { value: 'weight', label: 'Weighted', icon: 'dumbbell' },
        { value: 'bodyweight', label: 'Reps', icon: 'body' },
        { value: 'time', label: 'Hold', icon: 'timer' }
      ],
      onChange: (v) => setType(v)
    });
    const typeGroup = h('div.field.ex-form__group', { attrs: { role: 'group', 'aria-labelledby': nameId + '-t' } },
      h('div.field__label', { id: nameId + '-t' }, 'Tracking'), typeSeg, typeHint);

    /* --- equipment */
    const equipChips = Object.keys(vocab('EQUIPMENT')).map((k) => {
      const c = F.ui.chip({ label: equipMeta(k).label, icon: equipMeta(k).icon, active: draft.equipment.indexOf(k) >= 0, onClick: () => toggleEquip(k) });
      c.dataset.equip = k;
      return c;
    });
    function syncEquip() { equipChips.forEach((c) => setChip(c, draft.equipment.indexOf(c.dataset.equip) >= 0)); }
    function toggleEquip(k) {
      touched.equipment = true;
      let list = draft.equipment.filter((x) => x !== 'bodyweight');
      if (k === 'bodyweight') list = [];
      else if (list.indexOf(k) >= 0) list = list.filter((x) => x !== k);
      else list.push(k);
      draft.equipment = list.length ? list : ['bodyweight'];
      syncEquip();
    }
    const equipGroup = h('div.field.ex-form__group', { attrs: { role: 'group', 'aria-labelledby': nameId + '-e' } },
      h('div.field__label', { id: nameId + '-e' }, 'Equipment'),
      h('div.chips.chips--wrap', null, equipChips),
      h('p.field__hint', null, 'Pick everything it needs. Bodyweight means no gear at all.'));

    /* --- calisthenics */
    const caliSwitch = F.ui.switchEl({
      label: 'Calisthenics',
      hint: 'Shows up under the Calisthenics filter',
      checked: draft.calisthenics,
      onChange: (v) => { draft.calisthenics = !!v; touched.cali = true; }
    });

    /* --- defaults: sets, rest, target */
    const setsStep = F.ui.stepper({ label: 'Sets', value: draft.sets, min: 1, max: 10, onChange: (v) => { if (v !== null) draft.sets = v; } });
    const restStep = F.ui.stepper({ label: 'Rest', value: draft.rest, min: 0, max: 600, step: 15, unit: 's', onChange: (v) => { if (v !== null) draft.rest = v; } });
    const targetId = nameId + '-target';
    const targetInput = h('input.input', {
      id: targetId, type: 'text', maxLength: 24,
      value: cleanText(bd.target).slice(0, 24) || DEFAULT_TARGET[draft.type],
      attrs: { autocomplete: 'off', enterkeyhint: 'done', spellcheck: 'false' },
      on: {
        input: () => { touched.target = true; syncPresets(); },
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); targetInput.blur(); } }
      }
    });
    const presetRow = h('div.chips.ex-form__presets', { attrs: { role: 'group', 'aria-label': 'Target presets' } });
    function syncPresets() {
      F.util.clear(presetRow);
      const cur = cleanText(targetInput.value).toLowerCase();
      TARGET_PRESETS[draft.type].forEach((p) => {
        presetRow.appendChild(F.ui.chip({
          label: p, active: cur === p.toLowerCase(),
          onClick: () => { targetInput.value = p; touched.target = true; syncPresets(); }
        }));
      });
    }
    syncPresets();
    const targetField = h('div.field.ex-form__group', null,
      h('label.field__label', { for: targetId }, 'Target per set'),
      targetInput, presetRow,
      h('p.field__hint', null, 'Reps like 8-12 or 5, AMRAP for max reps, or seconds like 30s.'));

    function setType(v) {
      const t = typeKey(v);
      if (t === draft.type) return;
      draft.type = t;
      typeHint.textContent = typeMeta(t).logs;
      if (!touched.target) targetInput.value = DEFAULT_TARGET[t];
      if (!touched.equipment) { draft.equipment = [t === 'weight' ? 'dumbbells' : 'bodyweight']; syncEquip(); }
      if (!touched.cali) {
        draft.calisthenics = t !== 'weight';
        const inp = caliSwitch.querySelector('input');
        if (inp) inp.checked = draft.calisthenics;
      }
      syncPresets();
    }

    /* --- cues */
    const cuesId = nameId + '-cues';
    const cuesInput = h('textarea.textarea.ex-form__cues', {
      id: cuesId, rows: 4,
      placeholder: 'One cue per line, e.g.\nElbows tucked\nSlow on the way down',
      value: (Array.isArray(base.cues) ? base.cues : []).filter((c) => typeof c === 'string').join('\n')
    });
    const cuesField = F.ui.field({ label: 'Form cues', input: cuesInput, hint: 'Optional. Up to ' + MAX_CUES + ' short cues, one per line.' });

    /* --- delete (edit mode) */
    const delBtn = editing ? h('button.btn.btn--danger.btn--block.ex-form__delete', {
      type: 'button', on: { click: () => remove() }
    }, icon('trash'), 'Delete exercise') : null;

    const content = h('div.ex-form__content', null,
      nameField, muscleGroup, typeGroup, equipGroup, caliSwitch,
      h('div.ex-form__row', null, setsStep, restStep),
      targetField, cuesField, delBtn);

    /* --- save / delete */
    function validateName(name) {
      if (!name) return 'Give your exercise a name.';
      if (name.length > MAX_NAME) return 'Keep the name to ' + MAX_NAME + ' characters or fewer.';
      const key = norm(name);
      const clash = allExercises().find((e) => e && e.id !== (editing ? current.id : null) && norm(e.name) === key);
      if (clash) return 'You already have an exercise called \u201c' + clash.name + '\u201d.';
      return null;
    }

    function save() {
      const name = cleanText(nameInput.value);
      const err = validateName(name);
      if (err) { showError(err); return; }
      const cues = String(cuesInput.value || '').split(/\r?\n/).map(cleanText).filter(Boolean).slice(0, MAX_CUES).map((c) => c.slice(0, 140));
      const target = cleanText(targetInput.value).slice(0, 24) || DEFAULT_TARGET[draft.type];
      const payload = {
        name,
        muscle: draft.muscle,
        secondary: (Array.isArray(base.secondary) ? base.secondary : []).filter((m) => isMuscle(m) && m !== draft.muscle),
        equipment: draft.equipment.slice(),
        type: draft.type,
        calisthenics: !!draft.calisthenics,
        level: levelKey(base.level),
        defaults: { sets: clampInt(draft.sets, 1, 10, 3), target, rest: clampInt(draft.rest, 0, 600, 90) },
        cues
      };
      // A custom copy keeps the movement pattern of its source so it still finds swaps (when the
      // store keeps the field); only if the main muscle is unchanged, otherwise it would mislead.
      if (patternMeta(base.pattern) && base.muscle === draft.muscle) payload.pattern = base.pattern;
      let saved = null;
      try {
        if (editing) {
          F.store.updateCustomExercise(current.id, payload);
          saved = getExercise(current.id);
        } else {
          saved = F.store.addCustomExercise(payload);
        }
      } catch (e2) { console.error('[forge/picker]', e2); }
      if (!saved || saved.missing) { toast('Couldn\u2019t save that exercise. Try again.', { type: 'error' }); return; }
      if (sheetApi) sheetApi.close('save');
      haptic(14);
      toast(editing ? 'Exercise updated' : '\u201c' + saved.name + '\u201d added to your library', { type: 'ok' });
      safeCall(o.onSave, saved);
    }

    function remove() {
      if (!editing) return;
      const name = current.name;
      Promise.resolve(F.ui.confirm({
        title: 'Delete exercise?',
        message: '\u201c' + name + '\u201d will be removed from your library. Logged workouts keep their sets, and plan days that use it will show it as deleted.',
        confirmLabel: 'Delete',
        danger: true
      })).then((ok) => {
        if (!ok) return;
        const list = F.store.get().customExercises || [];
        const index = list.findIndex((e) => e && e.id === current.id);
        if (index < 0) { if (sheetApi) sheetApi.close('delete'); return; }
        const snapshot = JSON.parse(JSON.stringify(list[index]));
        F.store.removeCustomExercise(current.id);
        if (sheetApi) sheetApi.close('delete');
        toast('Deleted \u201c' + name + '\u201d', { action: { label: 'Undo', onClick: () => restoreCustom(snapshot, index) } });
        safeCall(o.onDelete, snapshot);
      }).catch((err) => console.error('[forge/picker]', err));
    }

    sheetApi = F.ui.sheet({
      title: editing ? 'Edit exercise' : 'New exercise',
      subtitle: editing ? null : 'Build it once, then add it to any plan or workout.',
      content,
      className: 'ex-form',
      actions: [
        { label: 'Cancel', variant: 'secondary', onClick: (close) => close('cancel') },
        { label: editing ? 'Save' : 'Create', variant: 'primary', icon: 'check', onClick: save }
      ]
    });
    if (sheetApi && sheetApi.el) sheetApi.el.dataset.plate = plateFor(draft.muscle);
    return sheetApi;
  }

  /* ================================================================ swap sheet */

  const MAX_ALTS = 8;
  const levelRank = (ex) => Number(levelMeta(ex && ex.level).rank) || 1;
  const altsOf = (ex) => (ex && Array.isArray(ex.alts) ? ex.alts : []);
  const r2list = (a) => (Array.isArray(a) ? a : []);
  /** exId -> position in the library (custom exercises after it), for stable, progression-friendly ties. */
  function libraryOrder() {
    const map = new Map();
    allExercises().forEach((e, i) => { if (e && typeof e.id === 'string' && !map.has(e.id)) map.set(e.id, i); });
    return map;
  }

  /** b is a close swap for a: same movement pattern, or hand-picked in `alts` in either direction. */
  function isClose(a, b) {
    if (!a || !b) return false;
    return (!!a.pattern && a.pattern === b.pattern) || altsOf(a).indexOf(b.id) >= 0 || altsOf(b).indexOf(a.id) >= 0;
  }

  /**
   * Local mirror of F.q.alternatives (SPEC 6.4), used only when queries.js doesn't provide it:
   * exercises you can do, excluding the current one, with the same pattern or linked via alts,
   * then the same primary muscle; each list sorted close matches first, then beginner -> advanced.
   */
  function localAlternatives(cur) {
    const found = [];
    allExercises().forEach((e, i) => {
      if (!e || !e.id || e.id === cur.id || e.missing || !canDo(e)) return;
      const close = isClose(cur, e);
      if (!close && e.muscle !== cur.muscle) return;
      found.push({ e, i, rank: close ? 0 : 1 });
    });
    found.sort((a, b) => (a.rank - b.rank) || (levelRank(a.e) - levelRank(b.e)) || (a.i - b.i));
    const out = { calisthenics: [], weights: [] };
    for (const x of found) {
      const list = x.e.calisthenics ? out.calisthenics : out.weights;
      if (list.length < MAX_ALTS) list.push(x.e);
    }
    return out;
  }

  /**
   * { calisthenics, weights } for the swap sheet. Candidates come from F.q.alternatives when present
   * (else the local mirror). The sheet's two sections follow the exercise's `calisthenics` flag, so
   * a timed dumbbell move (farmer carry) lands under "Dumbbell & bench", not "Calisthenics": the
   * candidates are merged, sorted close matches -> level -> library order (which runs from
   * fundamental to advanced, so progressions read in order) and split again by that flag.
   */
  function alternativesFor(cur) {
    let src = null;
    try {
      if (F.q && typeof F.q.alternatives === 'function') {
        const r = F.q.alternatives(cur.id);
        if (r && Array.isArray(r.calisthenics) && Array.isArray(r.weights)) src = r;
      }
    } catch (err) { console.error('[forge/picker]', err); }
    if (!src) return localAlternatives(cur);
    const seen = new Set();
    const merged = [];
    const order = libraryOrder();
    r2list(src.calisthenics).concat(r2list(src.weights)).forEach((e, j) => {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || e.id === cur.id || seen.has(e.id)) return;
      seen.add(e.id);
      merged.push({ e, i: order.has(e.id) ? order.get(e.id) : order.size + j, rank: isClose(cur, e) ? 0 : 1 });
    });
    merged.sort((a, b) => (a.rank - b.rank) || (levelRank(a.e) - levelRank(b.e)) || (a.i - b.i));
    const out = { calisthenics: [], weights: [] };
    for (const x of merged) {
      const list = x.e.calisthenics ? out.calisthenics : out.weights;
      if (list.length < MAX_ALTS) list.push(x.e);
    }
    return out;
  }

  /** Level read-out: three little bars + label (shared look with the info sheet). */
  function levelTag(ex, cls) {
    const lv = levelMeta(ex.level);
    return h('span', { class: cls, dataset: { level: String(lv.rank || 1) } },
      h('span.ex-swap__bars', { attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i')), lv.label);
  }
  function typeTag(ex) {
    const tp = typeMeta(ex.type);
    return h('span.ex-swap__type', { title: tp.logs || tp.label },
      icon(tp.icon || 'dumbbell', { size: 14 }), h('span', null, tp.short || tp.label));
  }

  /**
   * Swap sheet (SPEC 6.3 / 6.4): the current exercise, then "Calisthenics variations", then
   * "Dumbbell & bench" alternatives, then "Browse all exercises". Tapping a row picks it at once.
   * swap(exId, { title = 'Swap exercise', onPick(newExId) })
   * Private extras: subtitle. Returns the F.ui.sheet api.
   */
  function swap(exId, opts) {
    const o = opts || {};
    const browseMode = o.mode === 'browse'; // library "Variations": rows open instead of swapping
    const cur = getExercise(exId);
    const alt = alternativesFor(cur);
    const mLabel = muscleLabel(cur.muscle);
    let sheetApi = null;
    let done = false;

    function choose(id, rowEl) {
      if (done || !id) return;
      done = true;
      haptic(12);
      if (rowEl) rowEl.classList.add('is-picked');
      if (sheetApi) sheetApi.close('pick');
      if (id !== cur.id) safeCall(o.onPick, id);
    }

    function browse() {
      if (done) return;
      open({
        multi: false,
        title: 'Swap for\u2026',
        subtitle: 'Replacing ' + cur.name,
        muscle: !cur.missing && isMuscle(cur.muscle) ? cur.muscle : null,
        onPick: (ids) => { if (Array.isArray(ids) && ids[0]) choose(ids[0], null); }
      });
    }

    function showInfo(id) {
      let infoApi = null;
      const btn = h('button.btn.btn--primary.btn--lg.btn--block', {
        type: 'button',
        on: { click: () => { if (infoApi) infoApi.close('select'); choose(id, null); } }
      }, icon(browseMode ? 'chevron-right' : 'repeat'), browseMode ? 'Open' : 'Swap to this');
      infoApi = info(id, { extra: btn });
    }

    /* --- the exercise being replaced */
    const curPat = patternMeta(cur.pattern);
    const current = h('div.ex-swap__current', { dataset: { plate: plateFor(cur.muscle) } },
      h('span.ex-swap__disc', { attrs: { 'aria-hidden': 'true' } }, icon(typeMeta(cur.type).icon || 'dumbbell', { size: 22 })),
      h('span.ex-swap__main', null,
        h('span.ex-swap__eyebrow', null, browseMode ? 'Variations of' : 'Swapping out'),
        h('span.ex-swap__current-name', null, cur.name),
        h('span.ex-swap__sub', null,
          h('span', null, cur.missing ? 'No longer in your library' : mLabel + (curPat ? ' \u00b7 ' + curPat.label : '')),
          cur.missing ? null : equipIcons(cur, 'ex-swap__eq'))),
      cur.missing ? null : h('button.ex-swap__info', {
        type: 'button',
        attrs: { 'aria-label': 'How to do ' + cur.name },
        on: { click: () => info(cur.id) }
      }, icon('info', { size: 20 })));

    /* --- alternative rows */
    let n = 0;
    function row(ex) {
      const i = n++;
      const li = h('li.ex-swap__row', { dataset: { id: ex.id, plate: plateFor(ex.muscle) }, style: { '--i': String(Math.min(i, 14)) } });
      const pick = h('button.ex-swap__pick', {
        type: 'button',
        on: { click: () => choose(ex.id, li) }
      },
      F.ui.plateDot(ex.muscle),
      h('span.ex-swap__main', null,
        h('span.ex-swap__name', null, ex.name, ex.custom ? h('span.badge.ex-swap__custom', null, 'Custom') : null),
        h('span.ex-swap__sub', null,
          levelTag(ex, 'ex-swap__level'),
          typeTag(ex),
          equipIcons(ex, 'ex-swap__eq'))),
      h('span.ex-swap__go', { attrs: { 'aria-hidden': 'true' } }, icon(browseMode ? 'chevron-right' : 'repeat', { size: 18 })),
      h('span.sr-only', null, browseMode ? '. Open' : '. Swap in'));
      const infoBtn = h('button.ex-swap__info', {
        type: 'button',
        attrs: { 'aria-label': 'How to do ' + ex.name },
        on: { click: () => showInfo(ex.id) }
      }, icon('info', { size: 20 }));
      li.append(pick, infoBtn);
      return li;
    }

    function section(kind, title, iconName, list, noneText) {
      const headId = 'ex-swap-' + kind + '-' + Math.random().toString(36).slice(2, 7);
      return h('section.ex-swap__section', { dataset: { kind }, attrs: { 'aria-labelledby': headId } },
        h('h3.ex-swap__head', { id: headId },
          h('span.ex-swap__head-ico', { attrs: { 'aria-hidden': 'true' } }, icon(iconName, { size: 18 })),
          h('span', null, title),
          h('span.ex-swap__count', { attrs: { 'aria-label': plural(list.length, 'option') } }, String(list.length))),
        list.length
          ? h('ul.ex-swap__list', null, list.map(row))
          : h('p.ex-swap__none', null, noneText));
    }

    const total = alt.calisthenics.length + alt.weights.length;
    const browseRow = h('button.ex-swap__browse', { type: 'button', on: { click: browse } },
      h('span.ex-swap__browse-ico', { attrs: { 'aria-hidden': 'true' } }, icon('search', { size: 20 })),
      h('span.ex-swap__main', null,
        h('span.ex-swap__name', null, 'Browse all exercises'),
        h('span.ex-swap__sub', null, 'Search the whole library, ' + (isMuscle(cur.muscle) ? mLabel.toLowerCase() + ' first' : 'every muscle'))),
      h('span.ex-swap__go', { attrs: { 'aria-hidden': 'true' } }, icon('chevron-right', { size: 18 })));

    const content = total
      ? h('div.ex-swap__content', null,
        current,
        section('cali', 'Calisthenics variations', 'body', alt.calisthenics,
          'No bodyweight or bar variation fits this one with your equipment.'),
        section('weights', 'Dumbbell & bench', 'dumbbell', alt.weights,
          'No dumbbell or bench alternative for this one. The calisthenics moves above work the same muscles.'),
        browseRow)
      : h('div.ex-swap__content', null,
        current,
        F.ui.empty({
          icon: 'repeat',
          title: cur.missing ? 'Pick a replacement' : 'No close swaps yet',
          text: cur.missing
            ? 'This exercise is no longer in your library. Browse every exercise to choose what goes here instead.'
            : 'Nothing else in your library works ' + (isMuscle(cur.muscle) ? mLabel.toLowerCase() : 'this') +
              ' with the equipment you have. Browse every exercise, or create your own there.',
          action: { label: 'Browse all exercises', icon: 'search', onClick: browse }
        }));

    sheetApi = F.ui.sheet({
      title: o.title || 'Swap exercise',
      subtitle: o.subtitle || (total ? 'Same muscles, your equipment. Tap one to swap it in.' : null),
      content,
      className: 'ex-swap',
      onClose: () => { done = true; }
    });
    if (sheetApi && sheetApi.el) sheetApi.el.dataset.plate = plateFor(cur.muscle); // tints the sheet's top rim
    return sheetApi;
  }

  F.picker = { open, info, customForm, swap };
})(window.Forge = window.Forge || {});
