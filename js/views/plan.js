/* FORGE — js/views/plan.js  [VIEW:plan]
 * Weekly split editor (SPEC §12 "plan", swaps per §6.4). Route 'plan', params { day: 'mon'..'sun' }.
 *
 *   header      split name + one-line explainer + info sheet (F.data.program.splitInfo)
 *   week rail   7 plate-coloured day tiles with a sliding selection slab (tablist)
 *   hero        selected day: inline-editable title, est. time / sets / exercises (count-ups),
 *               sets-by-muscle bar, Start / Resume
 *   setup       rest-day switch + focus muscle chips
 *   body        training: keyed exercise cards (edit / swap / info / move / remove, FLIP reorder),
 *               "Add exercises", day tools (template, copy, clear)
 *               rest: calm recovery panel + optional calisthenics flows (restDayTemplateIds)
 *
 * All mutations go through F.store.*; the view re-syncs surgically from ctx.onState (reasons
 * plan / settings / library / workout / finish). User text is rendered as text nodes only.
 */
(function (F) {
  'use strict';

  const h = (...args) => F.util.h(...args);
  const icon = (name, opts) => F.icon(name, opts);
  const program = () => (F.data && F.data.program) || {};
  const MUSCLES = () => program().MUSCLES || {};
  const EQUIP = () => program().EQUIPMENT || {};
  const has = (obj, key) => !!obj && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

  const TARGET_PRESETS = ['5', '6-8', '8-12', '12-15', '15-20', 'AMRAP', '30s', '45s', '60s'];
  const REST_STEP = 15;
  const REST_MAX = 600;
  const TITLE_MAX = 60;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';

  /* ------------------------------------------------------------------ small helpers */

  function reduced() { try { return !!F.util.reducedMotion(); } catch (_) { return false; } }
  function haptic(p) { try { F.util.haptic(p); } catch (_) { /* optional */ } }
  function toast(msg, opts) { try { return F.ui.toast(msg, opts); } catch (_) { return null; } }
  const dayKeys = () => F.util.DAY_KEYS;
  const validDay = (k) => typeof k === 'string' && dayKeys().indexOf(k) >= 0;
  const dayLong = (k) => (F.util.DAY_LONG && F.util.DAY_LONG[k]) || String(k);
  const dayShort = (k) => (F.util.DAY_SHORT && F.util.DAY_SHORT[k]) || String(k);
  const todayKey = () => F.util.dayKeyOf(F.util.todayISO());
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  /** Restart a one-shot CSS animation class; removed again when it ends. */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    if (reduced()) return;
    void el.offsetWidth;
    el.classList.add(cls);
    const done = (e) => { if (e.target === el) { el.classList.remove(cls); el.removeEventListener('animationend', done); } };
    el.addEventListener('animationend', done);
    setTimeout(() => el.classList.remove(cls), 1600);
  }

  /** A defensive read of a plan day (never throws on odd data). */
  function getDay(k) {
    const st = F.store.get();
    const d = st && st.plan && st.plan.days ? st.plan.days[k] : null;
    const o = d && typeof d === 'object' ? d : {};
    return {
      title: typeof o.title === 'string' ? o.title : '',
      rest: !!o.rest,
      focus: Array.isArray(o.focus) ? o.focus.filter((m) => typeof m === 'string') : [],
      items: Array.isArray(o.items) ? o.items.filter((it) => it && typeof it === 'object' && it.id) : []
    };
  }
  function findItem(k, id) { return getDay(k).items.find((it) => it.id === id) || null; }

  function exOf(id) {
    try { const e = F.q.exercise(id); if (e && typeof e === 'object') return e; } catch (_) { /* fall through */ }
    return { id: String(id), name: 'Deleted exercise', muscle: 'fullbody', equipment: [], type: 'weight', defaults: {}, missing: true };
  }
  const muscleLabel = (m) => (has(MUSCLES(), m) ? MUSCLES()[m].label : String(m || ''));
  const plateOfMuscle = (m) => (has(MUSCLES(), m) && MUSCLES()[m].plate) || null;
  function plateForFocus(focus) {
    try { if (typeof program().plateFor === 'function') return program().plateFor(focus) || 'red'; } catch (_) { /* ignore */ }
    return 'red';
  }
  function owns(k) { try { return !!F.q.owns(k); } catch (_) { return true; } }

  /** Primary muscle with the most planned sets (ignores removed exercises). */
  function setsByMuscle(items) {
    const tally = {};
    for (const it of items) {
      const ex = exOf(it.exId);
      if (ex.missing) continue;
      const m = has(MUSCLES(), ex.muscle) ? ex.muscle : 'fullbody';
      tally[m] = (tally[m] || 0) + (Number(it.sets) || 0);
    }
    const order = Object.keys(MUSCLES());
    return Object.keys(tally).map((m) => ({ muscle: m, sets: tally[m] }))
      .sort((a, b) => b.sets - a.sets || order.indexOf(a.muscle) - order.indexOf(b.muscle));
  }
  function dayPlate(d) {
    if (d.rest) return 'white';
    const known = d.focus.filter((m) => has(MUSCLES(), m));
    if (known.length) return plateForFocus(known);
    const top = setsByMuscle(d.items)[0];
    return (top && plateOfMuscle(top.muscle)) || 'red';
  }

  function defaultRest() {
    const s = F.store.get().settings || {};
    const n = Number(s.restSeconds);
    return Number.isFinite(n) && n >= 0 ? n : 90;
  }
  const hasOwnRest = (it) => it.rest !== null && it.rest !== undefined && Number.isFinite(Number(it.rest));
  const restOf = (it) => (hasOwnRest(it) ? Number(it.rest) : defaultRest());
  function fmtRest(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function restWords(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (!m) return plural(r, 'second');
    return plural(m, 'minute') + (r ? ' ' + plural(r, 'second') : '');
  }
  const totalSets = (items) => items.reduce((a, it) => a + (Number(it.sets) || 0), 0);
  function estimate(d) { try { return Number(F.q.estimateMinutes(d)) || 0; } catch (_) { return 0; } }

  /** "Chest & Biceps", "Chest, Shoulders & Triceps" from focus keys. */
  function autoTitle(focus) {
    const labels = (focus || []).filter((m) => has(MUSCLES(), m)).map((m) => MUSCLES()[m].label);
    if (!labels.length) return '';
    if (labels.length === 1) return labels[0];
    return labels.slice(0, -1).join(', ') + ' & ' + labels[labels.length - 1];
  }
  /** True when the title was never really chosen by the athlete (so focus changes may rename it). */
  function isAutoTitle(title, focus) {
    const t = String(title || '').trim();
    if (!t || /^(rest( day)?|rest & recover|training day|workout|untitled( day)?)$/i.test(t)) return true;
    const auto = autoTitle(focus);
    return !!auto && t.toLowerCase() === auto.toLowerCase();
  }
  const cleanTplTitle = (t) => String(t || '').replace(/\s+[AB]$/, '').trim();
  const shownTitle = (d) => d.title || (d.rest ? 'Rest Day' : 'Untitled day');

  /** One line out of splitInfo.summary ("each training day focuses on …"), with a fallback. */
  function splitLine(info) {
    const s = String((info && info.summary) || '');
    const m = /:\s*([^,.;:]+)/.exec(s);
    if (m) {
      const t = m[1].trim();
      if (t.length >= 20 && t.length <= 90) return t.charAt(0).toUpperCase() + t.slice(1) + '.';
    }
    const aka = info && Array.isArray(info.aka) ? info.aka : [];
    return aka.length ? 'Also called ' + aka.slice(0, 2).join(' · ') + '.' : 'Your training week at a glance.';
  }

  function snapshot(k) {
    const d = getDay(k);
    try { return JSON.parse(JSON.stringify({ title: d.title, rest: d.rest, focus: d.focus, items: d.items })); } catch (_) { return null; }
  }

  function equipIcons(ex) {
    const keys = (Array.isArray(ex.equipment) ? ex.equipment : []).filter((k) => k !== 'bodyweight');
    const list = keys.length ? keys : ['bodyweight'];
    const labels = list.map((k) => (has(EQUIP(), k) ? EQUIP()[k].label : String(k)));
    return h('span.pv-eq', { title: labels.join(', ') },
      list.map((k) => h('span', { class: ['pv-eq__i', owns(k) ? null : 'is-missing'], attrs: { 'aria-hidden': 'true' } },
        icon((has(EQUIP(), k) && EQUIP()[k].icon) || 'dumbbell', { size: 16 }))),
      h('span.sr-only', null, 'Equipment: ' + labels.join(', ') + '.'));
  }

  let uidSeq = 0;
  const nextId = (p) => p + (++uidSeq).toString(36);

  /* ================================================================== view */

  function render(el, params, ctx) {
    const P = params && typeof params === 'object' ? params : {};
    let sel = validDay(P.day) ? P.day : todayKey();
    let reorder = false;
    let editingTitle = false;
    let bodyMode = null;          // 'train' | 'rest'
    let pendingFresh = null;      // day key whose list should rebuild with a stagger on next sync
    let scrollToId = null;        // first newly added card → scroll into view
    const fx = new Map();         // itemId → 'new' | 'restored' | 'swapped' | 'updated' | 'moved'
    const cards = new Map();      // itemId → li.pv-item (current day only)
    let T = null;                 // training body refs
    let R = null;                 // rest body refs
    let ro = null;

    /* ---------------------------------------------------------------- header */

    const info = program().splitInfo || {};
    const head = h('header.view-head.pv-head', null,
      h('div.view-head__titles', null,
        h('p.eyebrow', null, 'Weekly split'),
        h('h2.h1.pv-head__title', null, info.name || 'Your week'),
        h('p.pv-head__lede', null,
          h('span', null, splitLine(info) + ' '),
          h('button.pv-link', { type: 'button', on: { click: openSplitInfo } }, 'Why it works', icon('chevron-right', { size: 16 })))),
      h('div.view-head__actions', null,
        h('button.btn.btn--ghost.btn--icon', { type: 'button', 'aria-label': 'About your split', title: 'About your split', on: { click: openSplitInfo } }, icon('info', { size: 22 })),
        h('button.btn.btn--ghost.btn--icon', { type: 'button', 'aria-label': 'Plan options', title: 'Plan options', on: { click: openPlanMenu } }, icon('more', { size: 22 }))));

    /* ---------------------------------------------------------------- week rail */

    const weekSum = h('p.pv-week__sum');
    const ink = h('span.pv-week__ink', { attrs: { 'aria-hidden': 'true' } });
    const rail = h('div.pv-week__rail', { role: 'tablist', 'aria-label': 'Days of the week', on: { keydown: onRailKey } }, ink);
    const tiles = {};
    for (const k of dayKeys()) {
      tiles[k] = buildTile(k);
      rail.appendChild(tiles[k].btn);
    }
    const week = h('section.pv-week', { 'aria-labelledby': 'pv-week-title' },
      h('div.pv-week__head', null, h('h3.pv-label#pv-week-title', null, 'Your week'), weekSum),
      rail);

    function buildTile(k) {
      const title = h('span.pv-tile__title');
      const num = h('span.pv-tile__num');
      const unit = h('span.pv-tile__unit');
      const fill = h('span.pv-tile__fill');
      const btn = h('button.pv-tile', {
        type: 'button', role: 'tab', id: 'pv-tab-' + k, 'aria-controls': 'pv-panel', dataset: { day: k },
        on: { click: () => selectDay(k) }
      },
      h('span.pv-tile__edge', { attrs: { 'aria-hidden': 'true' } }),
      h('span.pv-tile__top', { attrs: { 'aria-hidden': 'true' } }, h('span.pv-tile__abbr', null, dayShort(k)), h('span.pv-tile__today')),
      h('span.pv-tile__body', { attrs: { 'aria-hidden': 'true' } }, title, h('span.pv-tile__count', null, num, unit)),
      h('span.pv-tile__load', { attrs: { 'aria-hidden': 'true' } }, fill));
      return { btn, title, num, unit, fill };
    }

    function updateWeek() {
      const tk = todayKey();
      const all = dayKeys().map((k) => ({ k, d: getDay(k) }));
      const maxSets = Math.max(1, ...all.map((x) => (x.d.rest ? 0 : totalSets(x.d.items))));
      let trainDays = 0; let mins = 0; let sets = 0;
      for (const { k, d } of all) {
        const t = tiles[k];
        const n = d.items.length;
        const isTrain = !d.rest && n > 0;
        if (isTrain) { trainDays++; mins += estimate(d); sets += totalSets(d.items); }
        t.btn.dataset.plate = dayPlate(d);
        t.btn.classList.toggle('is-rest', d.rest);
        t.btn.classList.toggle('is-empty', !d.rest && !n);
        t.btn.classList.toggle('is-today', k === tk);
        const selected = k === sel;
        t.btn.setAttribute('aria-selected', String(selected));
        t.btn.tabIndex = selected ? 0 : -1;
        t.title.textContent = d.rest && /^rest\b/i.test(d.title) ? 'Rest' : shownTitle(d);
        F.util.clear(t.num);
        if (d.rest) { t.num.appendChild(icon('bed', { size: 18 })); t.unit.textContent = 'Off'; }
        else { t.num.textContent = String(n); t.unit.textContent = n ? 'ex' : 'empty'; if (!n) t.num.textContent = '0'; }
        t.fill.style.setProperty('--load', String(d.rest ? 0 : totalSets(d.items) / maxSets));
        const bits = [dayLong(k), shownTitle(d), d.rest ? 'rest day' : plural(n, 'exercise')];
        if (isTrain) bits.push('about ' + estimate(d) + ' minutes');
        if (k === tk) bits.push('today');
        t.btn.setAttribute('aria-label', bits.join(', '));
      }
      ink.dataset.plate = tiles[sel].btn.dataset.plate || 'red';
      ink.classList.toggle('is-rest', getDay(sel).rest);
      const restDays = 7 - trainDays;
      F.util.clear(weekSum);
      weekSum.append(
        h('b', null, String(trainDays)), ' training · ',
        h('b', null, String(restDays)), ' off · ',
        h('b', null, mins ? F.util.fmtDuration(mins * 60) : '0m'), ' · ',
        h('b', null, String(sets)), ' sets');
      weekSum.setAttribute('aria-label', plural(trainDays, 'training day') + ', ' + plural(restDays, 'day') + ' off, about ' +
        F.util.fmtDuration(mins * 60) + ' and ' + plural(sets, 'set') + ' per week');
    }

    function placeInk(animate) {
      const t = tiles[sel] && tiles[sel].btn;
      if (!t || !t.offsetWidth) return;
      if (!animate) rail.classList.remove('is-ready');
      ink.style.width = t.offsetWidth + 'px';
      ink.style.height = t.offsetHeight + 'px';
      ink.style.transform = 'translate3d(' + t.offsetLeft + 'px,' + t.offsetTop + 'px,0)';
      if (!animate) {
        void ink.offsetWidth;
        const arm = () => { if (ctx.isActive()) rail.classList.add('is-ready'); };
        try { requestAnimationFrame(() => requestAnimationFrame(arm)); } catch (_) { arm(); }
      }
    }
    function revealTile(k, smooth) {
      const t = tiles[k] && tiles[k].btn;
      if (!t || rail.scrollWidth <= rail.clientWidth + 1) return;
      const left = Math.max(0, t.offsetLeft - (rail.clientWidth - t.offsetWidth) / 2);
      try { rail.scrollTo({ left, behavior: smooth && !reduced() ? 'smooth' : 'auto' }); } catch (_) { rail.scrollLeft = left; }
    }
    function onRailKey(e) {
      const keys = dayKeys();
      const i = keys.indexOf(sel);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % keys.length;
      else if (e.key === 'ArrowLeft') j = (i + keys.length - 1) % keys.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = keys.length - 1;
      if (j === null) return;
      e.preventDefault();
      selectDay(keys[j]);
      try { tiles[keys[j]].btn.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }

    /* ---------------------------------------------------------------- hero */

    const heroEyebrow = h('p.eyebrow.pv-hero__eyebrow');
    const todayBadge = h('span.badge.badge--accent.pv-hero__today', null, 'Today');
    const todayBtn = h('button.btn.btn--ghost.btn--sm.pv-hero__jump', { type: 'button', on: { click: () => selectDay(todayKey()) } },
      icon('calendar'), 'Today');
    const titleText = h('span.pv-title__text');
    const titleBtn = h('button.pv-title', { type: 'button', on: { click: editTitle } },
      titleText, h('span.pv-title__pen', { attrs: { 'aria-hidden': 'true' } }, icon('edit', { size: 17 })));
    const titleH = h('h3.pv-hero__h', null, titleBtn);
    const titleWrap = h('div.pv-hero__title', null, titleH);
    const restNextText = h('span.pv-hero__next-text');
    const restNext = h('button.pv-hero__next', { type: 'button', on: { click: () => { if (restNext.dataset.day) selectDay(restNext.dataset.day); } } },
      restNextText, icon('chevron-right', { size: 16 }));
    const restNextLabel = h('span.pv-hero__next-label', null, 'Next session: ');
    const restLine = h('p.pv-hero__rest', null, icon('bed', { size: 18 }),
      h('span', null, 'Recovery day. ', restNextLabel, restNext));
    const stat = (unit) => {
      const num = h('span.pv-stat__num', null, '0');
      const lab = h('span.pv-stat__label', null, unit);
      return { el: h('div.pv-stat', null, num, lab), num, lab, v: null };
    };
    const sMin = stat('min');
    const sSets = stat('sets');
    const sEx = stat('exercises');
    const stats = h('div.pv-hero__stats', null, sMin.el, sSets.el, sEx.el);
    const mix = buildMix();
    const cta = h('button.btn.btn--primary.btn--lg.pv-hero__cta', { type: 'button', on: { click: onCta } });
    const ctaNote = h('p.pv-hero__note');
    const heroFoot = h('div.pv-hero__foot', null, cta, ctaNote);
    const hero = h('article.card.card--hero.pv-hero', null,
      h('div.pv-hero__top', null, heroEyebrow, todayBadge, todayBtn),
      titleWrap, restLine, stats, mix.el, heroFoot);

    function buildMix() {
      const segs = {};
      const bar = h('div.pv-mix__bar', { attrs: { 'aria-hidden': 'true' } });
      for (const m of Object.keys(MUSCLES())) {
        segs[m] = h('span.pv-mix__seg', { dataset: { plate: plateOfMuscle(m) || 'white' } });
        bar.appendChild(segs[m]);
      }
      const legend = h('ul.pv-mix__legend');
      const box = h('div.pv-mix', { role: 'img' }, bar, legend);
      function update(d) {
        const rows = setsByMuscle(d.items);
        const map = {};
        rows.forEach((r) => { map[r.muscle] = r.sets; });
        for (const m of Object.keys(segs)) {
          segs[m].style.flexGrow = String(map[m] || 0);
          segs[m].classList.toggle('is-on', !!map[m]);
        }
        F.util.clear(legend);
        rows.forEach((r) => legend.appendChild(h('li', { dataset: { plate: plateOfMuscle(r.muscle) || 'white' } },
          h('span.pv-mix__dot'), h('span', null, muscleLabel(r.muscle)), h('b', null, String(r.sets)))));
        box.setAttribute('aria-label', 'Sets by muscle: ' + (rows.length ? rows.map((r) => muscleLabel(r.muscle) + ' ' + r.sets).join(', ') : 'none'));
        box.hidden = !rows.length;
      }
      return { el: box, update };
    }

    /** The next day after k (wrapping round the week) that has training planned. */
    function nextTrainingDay(k) {
      const keys = dayKeys();
      const i = keys.indexOf(k);
      for (let j = 1; j < keys.length; j++) {
        const nk = keys[(i + j) % keys.length];
        const nd = getDay(nk);
        if (!nd.rest && nd.items.length) return { k: nk, d: nd };
      }
      return null;
    }

    function setStat(s, v, unitOne, unitMany) {
      const from = s.v === null ? 0 : s.v;
      s.v = v;
      s.lab.textContent = v === 1 ? unitOne : unitMany;
      try { F.util.countUp(s.num, v, { from, duration: 650 }); } catch (_) { s.num.textContent = String(v); }
    }

    function updateHero(fresh) {
      const d = getDay(sel);
      const isToday = sel === todayKey();
      hero.dataset.plate = dayPlate(d);
      hero.classList.toggle('is-rest', d.rest);
      heroEyebrow.textContent = dayLong(sel);
      todayBadge.hidden = !isToday;
      todayBtn.hidden = isToday;
      if (!editingTitle) titleText.textContent = shownTitle(d);
      titleBtn.setAttribute('aria-label', 'Rename ' + dayLong(sel) + ': ' + shownTitle(d));
      restLine.hidden = !d.rest;
      if (d.rest) {
        const next = nextTrainingDay(sel);
        restNext.hidden = !next;
        restNextLabel.hidden = !next;
        if (next) {
          restNext.dataset.day = next.k;
          restNextText.textContent = dayLong(next.k) + ' \u00b7 ' + shownTitle(next.d);
          restNext.setAttribute('aria-label', 'Next session: ' + dayLong(next.k) + ', ' + shownTitle(next.d) + '. Show it');
        }
      }
      stats.hidden = d.rest;
      if (!d.rest) {
        setStat(sMin, estimate(d), 'min', 'min');
        setStat(sSets, totalSets(d.items), 'set', 'sets');
        setStat(sEx, d.items.length, 'exercise', 'exercises');
      }
      mix.update(d.rest ? { items: [] } : d);
      if (fresh) replay(mix.el, 'is-anim');
      updateCta();
    }

    function updateCta() {
      const st = F.store.get();
      const d = getDay(sel);
      const active = st && st.active;
      F.util.clear(cta);
      if (active) {
        cta.dataset.mode = 'resume';
        cta.append(icon('play'), h('span', null, 'Resume workout'));
        ctaNote.textContent = '“' + (active.title || 'Workout') + '” is in progress';
        heroFoot.hidden = false;
        ctaNote.hidden = false;
      } else if (d.rest || !d.items.length) {
        heroFoot.hidden = true;
      } else {
        cta.dataset.mode = 'start';
        cta.append(icon('play'), h('span', null, sel === todayKey() ? 'Start today’s workout' : 'Start this workout'));
        const other = sel !== todayKey();
        ctaNote.textContent = other ? 'Logs as today, ' + F.util.fmtDate(F.util.todayISO(), 'short') : '';
        ctaNote.hidden = !other;
        heroFoot.hidden = false;
      }
    }

    function onCta() {
      const st = F.store.get();
      if (st.active) { ctx.go('workout'); return; }
      const d = getDay(sel);
      if (d.rest || !d.items.length) return;
      try { F.store.startWorkout({ dayKey: sel }); } catch (err) { console.error('[FORGE] plan: startWorkout failed', err); return; }
      haptic([10, 30, 10]);
      ctx.go('workout');
    }

    /* ---------------------------------------------------------------- title editing */

    function editTitle() {
      if (editingTitle) return;
      const k = sel;
      const d = getDay(k);
      editingTitle = true;
      const input = h('input.input.pv-title__input', {
        type: 'text',
        value: d.title,
        placeholder: autoTitle(d.focus) || dayLong(k) + ' workout',
        attrs: { maxlength: String(TITLE_MAX), 'aria-label': dayLong(k) + ' title', enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'words' }
      });
      const hint = h('p.pv-title__hint', null, 'Enter to save · Esc to cancel');
      titleH.hidden = true;
      titleWrap.append(input, hint);
      try { input.focus({ preventScroll: true }); input.select(); } catch (_) { /* ignore */ }
      let done = false;
      const finish = (save, refocus) => {
        if (done) return;
        done = true;
        editingTitle = false;
        const v = input.value.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
        input.remove();
        hint.remove();
        titleH.hidden = false;
        const cur = getDay(k);
        if (save && v !== cur.title) {
          const next = v || autoTitle(cur.focus) || (cur.rest ? 'Rest Day' : dayLong(k));
          if (next !== cur.title) {
            if (k === sel) titleText.textContent = next;
            F.store.setDay(k, { title: next });
            replay(titleBtn, 'is-saved');
          }
        } else if (k === sel) {
          titleText.textContent = shownTitle(cur);
        }
        if (refocus && ctx.isActive()) { try { titleBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
      });
      input.addEventListener('blur', () => finish(true, false));
    }

    /* ---------------------------------------------------------------- setup: rest switch + focus */

    const restSw = F.ui.switchEl({
      label: 'Rest day',
      hint: 'Turn on to recover. Exercises are kept, just hidden.',
      checked: false,
      onChange: (v) => setRest(v)
    });
    restSw.classList.add('pv-setup__switch');
    const restHint = restSw.querySelector('.switch__hint');
    const focusChips = Object.keys(MUSCLES()).map((m) => {
      const c = F.ui.chip({ label: muscleLabel(m), plate: m, active: false, onClick: () => toggleFocus(m) });
      c.dataset.muscle = m;
      return c;
    });
    const focusWrap = h('div.pv-focus', null,
      h('p.pv-label#pv-focus-label', null, 'Focus muscles'),
      h('div.chips.chips--wrap.pv-focus__chips', { role: 'group', 'aria-labelledby': 'pv-focus-label' }, focusChips));
    const setup = h('section.card.pv-setup', { 'aria-label': 'Day setup' }, restSw, focusWrap);

    function updateSetup() {
      const d = getDay(sel);
      restSw.setValue(d.rest);
      if (restHint) {
        restHint.textContent = d.rest
          ? (d.items.length ? plural(d.items.length, 'exercise') + ' kept for later. Turn off to train this day.' : 'No training planned. Turn off to plan a workout.')
          : 'Turn on to recover. Exercises are kept, just hidden.';
      }
      focusWrap.hidden = d.rest;
      focusChips.forEach((c) => c.setActive(d.focus.indexOf(c.dataset.muscle) >= 0));
    }

    function setRest(v) {
      const k = sel;
      const d = getDay(k);
      if (!!v === d.rest) return;
      const patch = { rest: !!v };
      if (!v && (!d.title || /^rest\b/i.test(d.title))) patch.title = autoTitle(d.focus) || 'Training day';
      if (v && !d.title) patch.title = 'Rest Day';
      reorder = false;
      F.store.setDay(k, patch);
      haptic(10);
    }

    function toggleFocus(m) {
      const k = sel;
      const d = getDay(k);
      const on = d.focus.indexOf(m) >= 0;
      if (!on && d.focus.length >= 8) { toast('Up to 8 focus muscles per day', { type: 'warn' }); return; }
      const next = on ? d.focus.filter((x) => x !== m) : d.focus.concat(m);
      const patch = { focus: next };
      if (isAutoTitle(d.title, d.focus)) { const t = autoTitle(next); if (t) patch.title = t; }
      F.store.setDay(k, patch);
      haptic(6);
    }

    /* ---------------------------------------------------------------- body */

    const body = h('div.pv-body');
    const panel = h('div.pv-panel#pv-panel', { role: 'tabpanel' }, hero, setup, body);

    function updateBody(fresh) {
      const d = getDay(sel);
      const mode = d.rest ? 'rest' : 'train';
      if (mode !== bodyMode) {
        bodyMode = mode;
        F.util.clear(body);
        cards.clear();
        T = null;
        R = null;
        if (mode === 'rest') { R = buildRest(); body.appendChild(R.root); } else { T = buildTrain(); body.appendChild(T.root); }
        replay(body, 'is-in');
        fresh = true;
      }
      if (mode === 'rest') updateRest(d); else updateTrain(d, fresh);
    }

    /* ---- training body */

    function buildTrain() {
      const count = h('span.pv-count');
      const reorderBtn = h('button.btn.btn--ghost.btn--sm.pv-reorder', { type: 'button', 'aria-pressed': 'false', on: { click: toggleReorder } });
      const list = h('ol.pv-list', { 'aria-label': 'Exercises' });
      const emptyBox = h('div.pv-empty');
      const add = h('button.pv-add', { type: 'button', on: { click: addExercises } },
        h('span.pv-add__disc', { attrs: { 'aria-hidden': 'true' } }, icon('plus', { size: 26 })),
        h('span.pv-add__text', null,
          h('span.pv-add__title', null, 'Add exercises'),
          h('span.pv-add__sub', null, 'Dumbbells, bar, bench or pure calisthenics')));
      const tool = (ico, label, onClick, cls) => h('button', { type: 'button', class: ['btn', 'btn--secondary', 'pv-tool', cls || null], on: { click: onClick } },
        icon(ico, { size: 20 }), h('span', null, label));
      const clearBtn = tool('trash', 'Clear day', clearDay, 'pv-tool--danger');
      const tools = h('div.pv-tools', { role: 'group', 'aria-label': 'Day tools' },
        tool('list', 'Template', openTemplates), tool('copy', 'Copy day', openCopy), clearBtn);
      const root = h('section.pv-train', { 'aria-labelledby': 'pv-ex-title' },
        h('div.pv-sec-head', null, h('h3.pv-sec-title#pv-ex-title', null, h('span', null, 'Exercises'), count), reorderBtn),
        list, emptyBox, add, tools);
      return { root, count, reorderBtn, list, emptyBox, add, tools, clearBtn };
    }

    function updateTrain(d, fresh) {
      const n = d.items.length;
      if (n < 2) reorder = false;
      T.count.textContent = String(n);
      T.count.hidden = !n;
      T.reorderBtn.hidden = n < 2;
      F.util.clear(T.reorderBtn);
      T.reorderBtn.append(icon(reorder ? 'check' : 'grip'), h('span', null, reorder ? 'Done' : 'Reorder'));
      T.reorderBtn.setAttribute('aria-pressed', String(reorder));
      T.list.classList.toggle('is-reordering', reorder);
      T.clearBtn.disabled = !n;
      if (!n) {
        if (!T.emptyBox.firstChild) {
          T.emptyBox.appendChild(F.ui.empty({
            icon: 'dumbbell',
            title: 'Nothing planned yet',
            text: 'Exercises you add to ' + dayLong(sel) + ' show up here with sets, reps and rest. Pick moves from the library, or load a ready-made template below.',
            action: { label: 'Add exercises', icon: 'plus', onClick: addExercises }
          }));
          replay(T.emptyBox, 'is-in');
        }
        T.emptyBox.hidden = false;
        T.add.hidden = true;
      } else {
        F.util.clear(T.emptyBox);
        T.emptyBox.hidden = true;
        T.add.hidden = false;
      }
      syncList(d.items, fresh);
    }

    function toggleReorder() {
      reorder = !reorder;
      haptic(6);
      const d = getDay(sel);
      if (T) updateTrain(d, false);
    }

    /* ---- exercise cards (keyed by plan item id) */

    function sigOf(it) {
      const ex = exOf(it.exId);
      const eq = (Array.isArray(ex.equipment) ? ex.equipment : []).map((k) => k + (owns(k) ? '1' : '0')).join(',');
      return [it.exId, it.sets, it.target, hasOwnRest(it) ? it.rest : 'd', restOf(it), it.note || '', ex.name, ex.missing ? 1 : 0,
        ex.custom ? 1 : 0, ex.calisthenics ? 1 : 0, ex.type, ex.muscle, eq].join('\u0001');
    }

    function buildItem(it) {
      const li = h('li.pv-item', { dataset: { id: it.id } });
      li._card = h('div.pv-card');
      li.appendChild(li._card);
      fillCard(li, it);
      return li;
    }

    function fillCard(li, it) {
      const ex = exOf(it.exId);
      const card = li._card;
      const id = it.id;
      F.util.clear(card);
      card.className = 'pv-card' + (ex.missing ? ' is-missing' : '');
      if (ex.missing) card.removeAttribute('data-plate');
      else card.dataset.plate = plateOfMuscle(ex.muscle) || 'white';
      li._sig = sigOf(it);
      const metaId = nextId('pv-meta-');
      const num = h('span.pv-card__num', { attrs: { 'aria-hidden': 'true' } });
      li._num = num;
      const iconBtn = (ico, label, onClick, cls) => h('button', {
        type: 'button', class: ['pv-icon-btn', cls || null], 'aria-label': label, title: label, on: { click: onClick }
      }, icon(ico, { size: 20 }));

      if (ex.missing) {
        const main = h('button.pv-card__main', { type: 'button', 'aria-describedby': metaId, on: { click: () => openSwap(id) } },
          h('span.pv-card__name', null, 'Exercise removed'));
        card.append(num, h('div.pv-card__content', null,
          h('div.pv-card__row', null, main),
          h('p.pv-card__meta.pv-card__meta--warn', { id: metaId }, icon('info', { size: 16 }),
            h('span', null, 'This exercise was deleted from your library. Swap in a replacement or remove it.')),
          h('div.pv-card__foot', null,
            h('span.pv-card__dose', null, h('b', null, String(it.sets)), ' × ', h('b', null, String(it.target))),
            h('span.pv-card__acts', null,
              h('button.btn.btn--secondary.btn--sm.pv-card__btn', { type: 'button', on: { click: () => removeItem(sel, id) } }, icon('trash'), 'Remove'),
              h('button.btn.btn--primary.btn--sm.pv-card__btn', { type: 'button', on: { click: () => openSwap(id) } }, icon('repeat'), 'Swap')))));
        li._up = null;
        li._down = null;
        return;
      }

      const main = h('button.pv-card__main', { type: 'button', 'aria-describedby': metaId, on: { click: () => openEdit(id) } },
        h('span.pv-card__name', null, ex.name), h('span.sr-only', null, '. Edit sets and reps'));
      const up = iconBtn('arrow-up', 'Move ' + ex.name + ' up', () => moveItem(id, -1), 'pv-card__up');
      const down = iconBtn('arrow-down', 'Move ' + ex.name + ' down', () => moveItem(id, 1), 'pv-card__down');
      li._up = up;
      li._down = down;
      const tags = h('span.pv-card__tags', null,
        equipIcons(ex),
        ex.calisthenics ? h('span.badge.pv-badge-cali', null, icon('body'), 'Calisthenics') : null,
        ex.custom ? h('span.badge', null, 'Custom') : null);
      card.append(num, h('div.pv-card__content', null,
        h('div.pv-card__row', null,
          main,
          h('span.pv-card__ctl', null,
            h('span.pv-card__order', null, up, down),
            iconBtn('more', 'More actions for ' + ex.name, () => openMenu(id), 'pv-card__more'))),
        h('p.pv-card__meta', { id: metaId },
          h('span.pv-card__dose', null, h('b', null, String(it.sets)), ' × ', h('b', null, String(it.target))),
          h('span.pv-card__rest', { 'aria-label': restWords(restOf(it)) + ' rest' + (hasOwnRest(it) ? '' : ' (default)') },
            icon('timer', { size: 15 }), fmtRest(restOf(it)) + ' rest')),
        h('div.pv-card__foot', null,
          tags,
          h('button.btn.btn--secondary.btn--sm.pv-card__swap', {
            type: 'button', 'aria-label': 'Swap ' + ex.name + ' for a variation', on: { click: () => openSwap(id) }
          }, icon('repeat'), 'Swap')),
        it.note ? h('p.pv-card__note', null, icon('note', { size: 15 }), h('span', null, it.note)) : null));
    }

    function updateIndex(li, i, n) {
      li._num.textContent = String(i + 1).padStart(2, '0');
      if (li._up) { li._up.disabled = i === 0; li._down.disabled = i === n - 1; }
    }

    function afterEnter(li) {
      const clean = () => li.classList.remove('is-enter', 'is-new', 'is-restored');
      li.addEventListener('animationend', (e) => { if (e.target === li) clean(); });
      setTimeout(clean, 2200);
    }

    function exitItem(li) {
      li._exiting = true;
      li.classList.add('is-leaving');
      li.setAttribute('aria-hidden', 'true');
      try { li.inert = true; } catch (_) { /* old engines */ }
      if (reduced() || typeof li.animate !== 'function') { li.remove(); return; }
      let done = false;
      const fin = () => { if (done) return; done = true; li.remove(); };
      try {
        const a = li.animate([{ height: li.offsetHeight + 'px' }, { height: '0px' }],
          { duration: 300, delay: 60, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
        a.onfinish = fin;
      } catch (_) { fin(); return; }
      setTimeout(fin, 800);
    }

    function syncList(items, fresh) {
      if (!T) return;
      const list = T.list;
      const n = items.length;
      if (fresh) {
        cards.clear();
        F.util.clear(list);
        items.forEach((it, i) => {
          const li = buildItem(it);
          li.classList.add('is-enter');
          li.style.setProperty('--i', String(Math.min(i, 14)));
          afterEnter(li);
          cards.set(it.id, li);
          updateIndex(li, i, n);
          list.appendChild(li);
        });
        return;
      }
      const animate = !reduced();
      const first = new Map();
      if (animate) cards.forEach((li, id) => first.set(id, li.getBoundingClientRect().top));
      const focused = document.activeElement && list.contains(document.activeElement) ? document.activeElement : null;
      const ids = new Set(items.map((it) => it.id));
      cards.forEach((li, id) => { if (!ids.has(id)) { cards.delete(id); exitItem(li); } });
      let k = 0;
      items.forEach((it, i) => {
        let li = cards.get(it.id);
        const effect = fx.get(it.id);
        if (!li) {
          li = buildItem(it);
          li.classList.add(effect === 'restored' ? 'is-restored' : 'is-new');
          li.style.setProperty('--i', String(Math.min(k++, 14)));
          afterEnter(li);
          cards.set(it.id, li);
        } else if (li._sig !== sigOf(it)) {
          const hadFocus = focused && li.contains(focused);
          fillCard(li, it);
          replay(li._card, effect === 'swapped' ? 'is-swapped' : 'is-updated');
          if (hadFocus) { const m = li.querySelector('.pv-card__main'); if (m) { try { m.focus({ preventScroll: true }); } catch (_) { /* ignore */ } } }
        }
        updateIndex(li, i, n);
      });
      // DOM order: only out-of-place nodes move (exiting nodes stay where they are while they collapse).
      let cursor = list.firstChild;
      for (const it of items) {
        const li = cards.get(it.id);
        while (cursor && cursor._exiting) cursor = cursor.nextSibling;
        if (cursor === li) { cursor = cursor.nextSibling; continue; }
        list.insertBefore(li, cursor);
      }
      if (focused && focused.isConnected && document.activeElement !== focused) {
        try { focused.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      }
      // FLIP: cards that changed position glide from where they were.
      if (animate) {
        cards.forEach((li, id) => {
          const top0 = first.get(id);
          if (top0 === undefined || typeof li.animate !== 'function') return;
          const dy = top0 - li.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) return;
          const moved = fx.get(id) === 'moved';
          if (moved) {
            li.classList.add('is-moving');
            setTimeout(() => li.classList.remove('is-moving'), 460);
          }
          try {
            li.animate([
              { transform: 'translate3d(0,' + dy + 'px,0)' + (moved ? ' scale(1.025)' : '') },
              { transform: 'none' }
            ], { duration: moved ? 420 : 340, easing: moved ? 'cubic-bezier(.34,1.4,.64,1)' : EASE });
          } catch (_) { /* ignore */ }
        });
      }
      if (scrollToId && cards.get(scrollToId)) {
        const target = cards.get(scrollToId);
        scrollToId = null;
        setTimeout(() => {
          if (!ctx.isActive() || !target.isConnected) return;
          try { target.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
        }, 60);
      }
    }

    /* ---- rest body */

    function buildRest() {
      const kept = h('p.pv-rest__kept');
      const all = Array.isArray(program().templates) ? program().templates : [];
      const ids = Array.isArray(program().restDayTemplateIds) ? program().restDayTemplateIds : [];
      const flows = ids.map((id) => all.find((t) => t && t.id === id)).filter(Boolean);
      const tip = (ico, text) => h('li', null, icon(ico, { size: 18 }), h('span', null, text));
      const flowRow = (t, i) => {
        const items = Array.isArray(t.items) ? t.items : [];
        const mins = estimate({ rest: false, items });
        return h('li', { style: { '--i': String(i) } }, h('button.pv-flow', {
          type: 'button', dataset: { plate: plateForFocus(t.focus || []) }, on: { click: () => startFlow(t) }
        },
        h('span.pv-flow__disc', { attrs: { 'aria-hidden': 'true' } }, icon('body', { size: 22 })),
        h('span.pv-flow__main', null,
          h('span.pv-flow__title', null, t.title),
          h('span.pv-flow__meta', null, plural(items.length, 'move') + ' · ~' + mins + ' min'),
          t.description ? h('span.pv-flow__desc', null, t.description) : null),
        h('span.pv-flow__go', { attrs: { 'aria-hidden': 'true' } }, icon('play', { size: 18 }))));
      };
      const root = h('section.pv-rest', { 'aria-labelledby': 'pv-rest-title' },
        h('div.pv-rest__hero', null,
          h('span.pv-rest__icon', { attrs: { 'aria-hidden': 'true' } }, icon('bed', { size: 34 })),
          h('div.pv-rest__copy', null,
            h('h3.pv-rest__title#pv-rest-title', null, 'Rest & recover'),
            h('p.pv-rest__text', null, 'Muscles grow between sessions, not during them. A calm day now means stronger lifts tomorrow.'))),
        h('ul.pv-rest__tips', null, tip('bed', 'Sleep 7–9 h'), tip('droplet', 'Hit your water'), tip('body', 'Walk & stretch')),
        flows.length ? h('div.pv-rest__flows', null,
          h('p.pv-label', null, 'Feel like moving? Optional flows'),
          h('ul.pv-flows.stagger', null, flows.map(flowRow))) : null,
        kept);
      return { root, kept };
    }

    function updateRest(d) {
      const n = d.items.length;
      R.kept.hidden = !n;
      F.util.clear(R.kept);
      if (n) R.kept.append(icon('info', { size: 16 }), h('span', null, plural(n, 'planned exercise') + ' saved for this day. Switch Rest day off to bring them back.'));
    }

    function startFlow(t) {
      const st = F.store.get();
      if (st.active) {
        toast('A workout is already in progress', { type: 'warn', action: { label: 'Resume', onClick: () => ctx.go('workout') } });
        return;
      }
      try { F.store.startWorkout({ templateId: t.id }); } catch (err) { console.error('[FORGE] plan: startWorkout failed', err); return; }
      haptic([10, 30, 10]);
      ctx.go('workout');
    }

    /* ---------------------------------------------------------------- item actions */

    function openMenu(id) {
      const k = sel;
      const d = getDay(k);
      const i = d.items.findIndex((x) => x.id === id);
      if (i < 0) return;
      const ex = exOf(d.items[i].exId);
      const n = d.items.length;
      F.ui.menu([
        { label: 'Edit sets & reps', icon: 'edit', onClick: () => openEdit(id) },
        { label: 'Swap exercise', icon: 'repeat', hint: 'Variations', onClick: () => openSwap(id) },
        !ex.missing && { label: 'How to do it', icon: 'info', onClick: () => openInfo(id) },
        { label: 'Move up', icon: 'arrow-up', disabled: i === 0, onClick: () => moveItem(id, -1) },
        { label: 'Move down', icon: 'arrow-down', disabled: i === n - 1, onClick: () => moveItem(id, 1) },
        { label: 'Remove from ' + dayLong(k), icon: 'trash', danger: true, onClick: () => removeItem(k, id) }
      ], { title: ex.missing ? 'Exercise removed' : ex.name });
    }

    function openInfo(id) {
      const it = findItem(sel, id);
      if (!it) return;
      let api = null;
      const swapBtn = h('button.btn.btn--secondary.btn--block', {
        type: 'button', on: { click: () => { if (api) api.close('swap'); openSwap(id); } }
      }, icon('repeat'), 'Swap for a variation');
      api = F.picker.info(it.exId, { extra: swapBtn });
    }

    function openSwap(id) {
      const k = sel;
      const it = findItem(k, id);
      if (!it) return;
      F.picker.swap(it.exId, {
        title: 'Swap exercise',
        onPick: (newId) => {
          fx.set(id, 'swapped');
          const res = F.store.swapPlanItem(k, id, newId);
          if (!res) { fx.delete(id); toast('That exercise could not be swapped in', { type: 'warn' }); return; }
          haptic(12);
          toast('Swapped to ' + exOf(newId).name, {
            type: 'ok', icon: 'repeat',
            action: { label: 'Undo', onClick: () => { fx.set(id, 'swapped'); F.store.updatePlanItem(k, res.prev.id, res.prev); } }
          });
        }
      });
    }

    function moveItem(id, dir) {
      const d = getDay(sel);
      const i = d.items.findIndex((x) => x.id === id);
      const to = i + dir;
      if (i < 0 || to < 0 || to >= d.items.length) return;
      fx.set(id, 'moved');
      F.store.movePlanItem(sel, id, to);
      haptic(6);
    }

    function removeItem(k, id) {
      const res = F.store.removePlanItem(k, id);
      if (!res) return;
      haptic(10);
      const ex = exOf(res.item.exId);
      toast('Removed ' + (ex.missing ? 'the deleted exercise' : ex.name), {
        icon: 'trash',
        action: { label: 'Undo', onClick: () => { fx.set(res.item.id, 'restored'); F.store.insertPlanItem(k, res.item, res.index); } }
      });
    }

    function addExercises() {
      const k = sel;
      const d = getDay(k);
      const known = d.focus.filter((m) => has(MUSCLES(), m));
      const top = setsByMuscle(d.items)[0];
      const muscle = known[0] || (top ? top.muscle : undefined);
      F.picker.open({
        title: 'Add to ' + dayLong(k),
        subtitle: shownTitle(d),
        muscle,
        onPick: (ids) => {
          if (!Array.isArray(ids) || !ids.length) return;
          const added = [];
          for (const exId of ids) {
            const it = F.store.addPlanItem(k, exId);
            if (it) { added.push(it); fx.set(it.id, 'new'); }
          }
          if (!added.length) return;
          if (k === sel) scrollToId = added[0].id;
          haptic(12);
          toast(added.length === 1 ? 'Added ' + exOf(added[0].exId).name : 'Added ' + added.length + ' exercises to ' + dayLong(k), {
            type: 'ok',
            action: { label: 'Undo', onClick: () => added.forEach((it) => F.store.removePlanItem(k, it.id)) }
          });
        }
      });
    }

    /* ---- edit sheet */

    function openEdit(id) {
      const k = sel;
      const d = getDay(k);
      const idx = d.items.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const item = d.items[idx];
      const ex = exOf(item.exId);
      if (ex.missing) { openSwap(id); return; }
      const prev = { sets: item.sets, target: item.target, rest: hasOwnRest(item) ? Number(item.rest) : null, note: item.note || '' };
      const draft = Object.assign({}, prev);
      let removed = false;
      let api = null;

      /* sets */
      const setsStep = F.ui.stepper({ label: 'Sets', value: draft.sets, min: 1, max: 20, step: 1, onChange: (v) => { if (v !== null) draft.sets = v; } });

      /* target: presets + custom */
      const hintEl = h('p.field__hint.pv-edit__hint', { attrs: { 'aria-live': 'polite' } });
      const custom = h('input.input.pv-edit__custom', {
        type: 'text',
        value: TARGET_PRESETS.indexOf(draft.target) >= 0 ? '' : draft.target,
        placeholder: 'Custom: 10, 4-6, 40s…',
        attrs: { maxlength: '24', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': 'Custom target' },
        on: {
          input: () => { const v = custom.value.trim(); if (v) setTarget(v, true); },
          keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); custom.blur(); } }
        }
      });
      const chips = TARGET_PRESETS.map((p) => {
        const c = F.ui.chip({ label: p === 'AMRAP' ? 'AMRAP' : p, active: draft.target === p, onClick: () => { setTarget(p, false); haptic(6); } });
        c.dataset.value = p;
        return c;
      });
      function describe(t) {
        let pt = { reps: null, secs: null, amrap: false };
        try { pt = F.util.parseTarget(t); } catch (_) { /* ignore */ }
        if (pt.amrap) return 'As many clean reps as you can, every set.';
        if (pt.secs) return (ex.type === 'time' ? 'Hold ' : 'Work for ') + pt.secs + ' s per set.' + (ex.type !== 'time' ? ' Timed sets suit holds and carries best.' : '');
        if (ex.type === 'time') return 'Reps on a timed hold? Seconds (e.g. 30s) track better here.';
        return /[-–]/.test(t) ? 'Stay in the range; hit the top of it on every set, then go heavier.' : t + ' reps per set.';
      }
      function setTarget(v, fromInput) {
        draft.target = v;
        chips.forEach((c) => c.setActive(c.dataset.value === v));
        if (!fromInput) custom.value = '';
        hintEl.textContent = describe(v);
      }
      hintEl.textContent = describe(draft.target);

      /* rest: 15 s steps shown as m:ss (null = default rest from settings) */
      const restBox = restStepper(draft.rest, defaultRest(), (v) => { draft.rest = v; });

      /* note */
      const note = h('textarea.textarea.pv-edit__note', {
        value: draft.note,
        placeholder: 'A cue for yourself, e.g. “pause at the bottom”',
        attrs: { maxlength: '500', rows: '3' },
        on: { input: () => { draft.note = note.value; } }
      });

      const plate = plateOfMuscle(ex.muscle) || 'white';
      const exRow = h('div.pv-edit__ex', { dataset: { plate } },
        h('span.pv-edit__exinfo', null,
          F.ui.plateDot(ex.muscle),
          h('span', null, muscleLabel(ex.muscle)),
          equipIcons(ex),
          ex.calisthenics ? h('span.badge.pv-badge-cali', null, icon('body'), 'Calisthenics') : null),
        h('span.pv-edit__exacts', null,
          h('button.btn.btn--ghost.btn--sm.btn--icon', { type: 'button', 'aria-label': 'How to do ' + ex.name, title: 'How to do it', on: { click: () => { api.close('info'); openInfo(id); } } }, icon('info')),
          h('button.btn.btn--secondary.btn--sm', { type: 'button', on: { click: () => { api.close('swap'); openSwap(id); } } }, icon('repeat'), 'Swap')));

      const content = h('div.pv-edit', null,
        exRow,
        h('div.pv-edit__grid', null, setsStep, restBox),
        h('div.field', null,
          h('p.field__label#pv-edit-target', null, 'Target per set'),
          h('div.chips.chips--wrap.pv-edit__chips', { role: 'group', 'aria-labelledby': 'pv-edit-target' }, chips),
          custom, hintEl),
        F.ui.field({ label: 'Note', input: note, hint: 'Shown on this exercise in the plan and during the workout.' }));

      api = F.ui.sheet({
        title: ex.name,
        subtitle: dayLong(k) + ' · exercise ' + (idx + 1) + ' of ' + d.items.length,
        content,
        className: 'pv-sheet pv-edit-sheet',
        actions: [
          { label: 'Remove', variant: 'danger', icon: 'trash', onClick: (close) => { removed = true; close('remove'); removeItem(k, id); } },
          { label: 'Done', variant: 'primary', icon: 'check', onClick: (close) => close('done') }
        ],
        onClose: () => { if (!removed) commit(); }
      });
      if (api && api.el) api.el.dataset.plate = plate;

      function commit() {
        const cur = findItem(k, id);
        if (!cur) return;
        const next = {
          sets: Math.max(1, Math.min(20, Math.round(Number(draft.sets) || cur.sets))),
          target: String(draft.target || '').trim().slice(0, 24) || cur.target,
          rest: draft.rest === null ? null : Math.max(0, Math.min(1800, Math.round(draft.rest))),
          note: String(draft.note || '').slice(0, 500)
        };
        const before = { sets: cur.sets, target: cur.target, rest: hasOwnRest(cur) ? Number(cur.rest) : null, note: cur.note || '' };
        const patch = {};
        for (const key of Object.keys(next)) if (next[key] !== before[key]) patch[key] = next[key];
        if (!Object.keys(patch).length) return;
        fx.set(id, 'updated');
        F.store.updatePlanItem(k, id, patch);
        toast('Saved ' + ex.name, {
          type: 'ok',
          action: { label: 'Undo', onClick: () => { fx.set(id, 'updated'); F.store.updatePlanItem(k, id, before); } }
        });
      }
    }

    /** − [m:ss] + in 15 s steps, with a "Default" chip that clears the item's own rest. */
    function restStepper(value, def, onChange) {
      let v = value;
      const label = h('span.stepper__label#pv-rest-label', null, 'Rest');
      const valEl = h('span.pv-restv__val');
      const subEl = h('span.pv-restv__sub');
      const out = h('div.stepper__field.pv-restv', {
        role: 'spinbutton', tabindex: '0', 'aria-labelledby': 'pv-rest-label',
        'aria-valuemin': '0', 'aria-valuemax': String(REST_MAX),
        on: {
          keydown: (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); bump(1); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); bump(-1); }
          }
        }
      }, valEl, subEl);
      const mk = (dir) => h('button.stepper__btn', {
        type: 'button', tabindex: '-1', 'aria-label': (dir < 0 ? 'Less' : 'More') + ' rest'
      }, icon(dir < 0 ? 'minus' : 'plus', { size: 20 }));
      const dec = mk(-1);
      const inc = mk(1);
      const defChip = F.ui.chip({ label: 'Default ' + fmtRest(def), active: v === null, onClick: () => { set(null); haptic(6); } });
      defChip.classList.add('pv-restv__def');
      const box = h('div.stepper.stepper--md.pv-restv-wrap', { role: 'group', 'aria-labelledby': 'pv-rest-label' },
        label, h('div.stepper__box', null, dec, out, inc), defChip);
      function sync() {
        const shown = v === null ? def : v;
        valEl.textContent = fmtRest(shown);
        subEl.textContent = v === null ? 'default' : '';
        subEl.hidden = v !== null;
        out.setAttribute('aria-valuenow', String(shown));
        out.setAttribute('aria-valuetext', restWords(shown) + (v === null ? ' (default)' : ''));
        dec.disabled = shown <= 0;
        inc.disabled = shown >= REST_MAX;
        defChip.setActive(v === null);
      }
      function set(next) {
        v = next;
        sync();
        onChange(v);
      }
      function bump(dir) {
        const cur = v === null ? def : v;
        const next = dir > 0 ? Math.floor(cur / REST_STEP) * REST_STEP + REST_STEP : Math.ceil(cur / REST_STEP) * REST_STEP - REST_STEP;
        const clamped = Math.max(0, Math.min(REST_MAX, next));
        if (clamped === cur && v !== null) return false;
        set(clamped);
        replay(box, 'is-bump');
        return true;
      }
      let timer = null;
      const stop = () => { clearTimeout(timer); timer = null; dec.classList.remove('is-pressed'); inc.classList.remove('is-pressed'); };
      [[dec, -1], [inc, 1]].forEach(([b, dir]) => {
        b.addEventListener('pointerdown', (e) => {
          if (e.button > 0 || b.disabled) return;
          e.preventDefault();
          try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          stop();
          b.classList.add('is-pressed');
          if (!bump(dir)) return;
          haptic(6);
          let interval = 170;
          const tick = () => {
            if (!box.isConnected || !bump(dir)) { stop(); return; }
            interval = Math.max(60, interval * 0.85);
            timer = setTimeout(tick, interval);
          };
          timer = setTimeout(tick, 420);
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.addEventListener('click', (e) => { if (e.detail === 0) bump(dir); });
      });
      sync();
      return box;
    }

    /* ---- day tools */

    function restoreDay(k, snap) {
      if (!snap) return;
      pendingFresh = k;
      F.store.setDay(k, snap);
    }

    function openTemplates() {
      const k = sel;
      const d = getDay(k);
      const list = (Array.isArray(program().templates) ? program().templates : []).filter((t) => t && Array.isArray(t.items));
      const score = (t) => (t.focus || []).filter((m) => d.focus.indexOf(m) >= 0).length;
      const suggested = list.filter((t) => !t.restDay && score(t) > 0).sort((a, b) => score(b) - score(a));
      const others = list.filter((t) => !t.restDay && suggested.indexOf(t) < 0);
      const light = list.filter((t) => t.restDay);
      let api = null;
      let i = 0;
      const row = (t) => {
        const mins = estimate({ rest: false, items: t.items });
        return h('li', { style: { '--i': String(Math.min(i++, 14)) } }, h('button.pv-tpl', {
          type: 'button', dataset: { plate: plateForFocus(t.focus || []) },
          on: { click: () => { if (api) api.close('pick'); applyTemplate(k, t); } }
        },
        h('span.pv-tpl__main', null,
          h('span.pv-tpl__title', null, t.title),
          h('span.pv-tpl__meta', null, plural(t.items.length, 'exercise') + ' · ' + totalSets(t.items) + ' sets · ~' + mins + ' min'),
          t.description ? h('span.pv-tpl__desc', null, t.description) : null,
          h('span.pv-tpl__focus', null, (t.focus || []).map((m) => h('span.pv-tpl__m', null, F.ui.plateDot(m), muscleLabel(m))))),
        h('span.pv-tpl__go', { attrs: { 'aria-hidden': 'true' } }, icon('chevron-right'))));
      };
      const section = (title, arr) => (arr.length ? h('section.pv-tpls__sec', null,
        h('h3.pv-tpls__head', null, h('span', null, title), h('span.pv-count', null, String(arr.length))),
        h('ul.pv-tpls__list.stagger', null, arr.map(row))) : null);
      api = F.ui.sheet({
        title: 'Load a template',
        subtitle: d.items.length ? 'Replaces ' + dayLong(k) + '’s ' + plural(d.items.length, 'exercise') + '. You can undo right after.' : 'Fills ' + dayLong(k) + ' with a ready-made session.',
        className: 'pv-sheet pv-tpls-sheet',
        size: 'full',
        content: h('div.pv-tpls', null,
          section('Suggested for ' + dayLong(k), suggested),
          section(suggested.length ? 'More templates' : 'Templates', others),
          section('Light & rest-day sessions', light))
      });
    }

    function applyTemplate(k, t) {
      const d = getDay(k);
      const apply = () => {
        const snap = snapshot(k);
        pendingFresh = k;
        F.store.setDay(k, {
          title: cleanTplTitle(t.title) || t.title,
          rest: false,
          focus: (t.focus || []).slice(),
          items: t.items.map((it) => Object.assign({}, it))
        });
        haptic(12);
        toast('Loaded ' + t.title + ' into ' + dayLong(k), { type: 'ok', action: { label: 'Undo', onClick: () => restoreDay(k, snap) } });
      };
      if (!d.items.length) { apply(); return; }
      F.ui.confirm({
        title: 'Replace ' + dayLong(k) + '?',
        message: t.title + ' (' + plural(t.items.length, 'exercise') + ') replaces the ' + plural(d.items.length, 'exercise') +
          ' planned now. You can undo right after.',
        confirmLabel: 'Replace'
      }).then((ok) => { if (ok) apply(); });
    }

    function openCopy() {
      const k = sel;
      let api = null;
      const rows = dayKeys().filter((x) => x !== k).map((x, i) => {
        const d = getDay(x);
        const n = d.items.length;
        return h('li', { style: { '--i': String(i) } }, h('button.pv-copy__btn', {
          type: 'button', dataset: { plate: dayPlate(d) }, class: d.rest ? 'is-rest' : null,
          on: { click: () => { if (api) api.close('pick'); copyFrom(x); } }
        },
        h('span.pv-copy__disc', { attrs: { 'aria-hidden': 'true' } }, dayShort(x)),
        h('span.pv-copy__main', null,
          h('span.pv-copy__title', null, shownTitle(d)),
          h('span.pv-copy__meta', null, dayLong(x) + ' · ' + (d.rest ? 'rest day' : plural(n, 'exercise') + (n ? ' · ' + totalSets(d.items) + ' sets' : '')))),
        h('span.pv-copy__go', { attrs: { 'aria-hidden': 'true' } }, icon('copy', { size: 18 }))));
      });
      api = F.ui.sheet({
        title: 'Copy into ' + dayLong(k),
        subtitle: 'Duplicates the title, focus and exercises of the day you pick.',
        className: 'pv-sheet pv-copy-sheet',
        content: h('ul.pv-copy.stagger', null, rows)
      });
    }

    function copyFrom(from) {
      const k = sel;
      const src = getDay(from);
      const d = getDay(k);
      const apply = () => {
        const snap = snapshot(k);
        pendingFresh = k;
        F.store.copyDay(from, k);
        haptic(12);
        toast('Copied ' + dayLong(from) + ' into ' + dayLong(k), { type: 'ok', icon: 'copy', action: { label: 'Undo', onClick: () => restoreDay(k, snap) } });
      };
      if (!d.items.length && !src.rest) { apply(); return; }
      F.ui.confirm({
        title: 'Copy ' + dayLong(from) + '?',
        message: src.rest
          ? dayLong(k) + ' becomes a rest day like ' + dayLong(from) + '. You can undo right after.'
          : dayLong(k) + '’s ' + plural(d.items.length, 'exercise') + ' will be replaced by ' + dayLong(from) + '’s ' +
            shownTitle(src) + ' (' + plural(src.items.length, 'exercise') + '). You can undo right after.',
        confirmLabel: 'Copy day'
      }).then((ok) => { if (ok) apply(); });
    }

    function clearDay() {
      const k = sel;
      const d = getDay(k);
      const n = d.items.length;
      if (!n) return;
      F.ui.confirm({
        title: 'Clear ' + dayLong(k) + '?',
        message: 'Removes all ' + plural(n, 'exercise') + ' from ' + dayLong(k) + '. The title and focus stay. You can undo right after.',
        confirmLabel: 'Clear day',
        danger: true
      }).then((ok) => {
        if (!ok) return;
        const snap = snapshot(k);
        F.store.setDay(k, { items: [] });
        haptic(14);
        toast('Cleared ' + dayLong(k), { icon: 'trash', action: { label: 'Undo', onClick: () => restoreDay(k, snap) } });
      });
    }

    /* ---- header: split info + options */

    function openSplitInfo() {
      const inf = program().splitInfo || {};
      const aka = Array.isArray(inf.aka) ? inf.aka : [];
      const why = Array.isArray(inf.why) ? inf.why : [];
      const how = Array.isArray(inf.howToProgress) ? inf.howToProgress : [];
      const all = dayKeys().map((k) => ({ k, d: getDay(k) }));
      const maxSets = Math.max(1, ...all.map((x) => (x.d.rest ? 0 : totalSets(x.d.items))));
      const weekRows = all.map(({ k, d }, i) => h('li.pv-si__day', {
        dataset: { plate: dayPlate(d) }, class: d.rest ? 'is-rest' : null, style: { '--i': String(i) }
      },
      h('span.pv-si__abbr', null, dayShort(k)),
      h('span.pv-si__dtitle', null, d.rest ? 'Rest' : shownTitle(d)),
      h('span.pv-si__bar', { attrs: { 'aria-hidden': 'true' } }, h('i', { style: { '--load': String(d.rest ? 0 : totalSets(d.items) / maxSets) } })),
      h('span.pv-si__sets', null, d.rest ? 'off' : totalSets(d.items) + ' sets')));
      const content = h('div.pv-si', null,
        aka.length ? h('div.pv-si__aka', null, h('p.pv-label', null, 'Also called'),
          h('div.cluster', null, aka.map((a) => h('span.badge.pv-si__badge', null, a)))) : null,
        inf.summary ? h('p.pv-si__summary', null, inf.summary) : null,
        h('section.pv-si__sec', null, h('h3.pv-si__head', null, icon('calendar'), 'Your week'), h('ol.pv-si__week.stagger', null, weekRows)),
        why.length ? h('section.pv-si__sec', null, h('h3.pv-si__head', null, icon('target'), 'Why it works'),
          h('ul.pv-si__list', null, why.map((w) => h('li', null, h('span.pv-si__tick', { attrs: { 'aria-hidden': 'true' } }, icon('check', { size: 16 })), h('span', null, w))))) : null,
        how.length ? h('section.pv-si__sec', null, h('h3.pv-si__head', null, icon('chart'), 'How to progress'),
          h('ol.pv-si__steps', null, how.map((w, i) => h('li', null, h('span.pv-si__n', { attrs: { 'aria-hidden': 'true' } }, String(i + 1)), h('span', null, w))))) : null);
      F.ui.sheet({
        title: inf.name || 'Your split',
        subtitle: 'What it is, why it works and how to keep progressing.',
        content,
        size: 'full',
        className: 'pv-sheet pv-si-sheet',
        actions: [{ label: 'Got it', variant: 'primary', icon: 'check' }]
      });
    }

    function openPlanMenu() {
      F.ui.menu([
        { label: 'Browse exercise library', icon: 'list', onClick: () => ctx.go('library') },
        { label: 'Reset week to the default split', icon: 'undo', danger: true, onClick: resetWeek }
      ], { title: 'Plan options' });
    }

    function resetWeek() {
      F.ui.confirm({
        title: 'Reset the whole week?',
        message: 'Every day goes back to the default ' + (info.name || 'split') + ' with its original exercises. You can undo right after.',
        confirmLabel: 'Reset week',
        danger: true
      }).then((ok) => {
        if (!ok) return;
        const snaps = {};
        dayKeys().forEach((k) => { snaps[k] = snapshot(k); });
        pendingFresh = sel;
        F.store.resetPlan();
        haptic(14);
        toast('Week reset to the default split', {
          icon: 'undo',
          action: { label: 'Undo', onClick: () => { pendingFresh = sel; dayKeys().forEach((k) => { if (snaps[k]) F.store.setDay(k, snaps[k]); }); } }
        });
      });
    }

    /* ---------------------------------------------------------------- selection + sync */

    /** Keep the chosen day across re-renders and reloads (params live in history.state). */
    function rememberDay(k) {
      try { P.day = k; } catch (_) { /* frozen params */ }
      try {
        const st = history.state;
        if (st && typeof st === 'object' && st.name === 'plan') {
          const nextParams = Object.assign({}, st.params && typeof st.params === 'object' ? st.params : {}, { day: k });
          history.replaceState(Object.assign({}, st, { params: nextParams }), '', location.hash || '#plan');
        }
      } catch (_) { /* history may be sandboxed */ }
    }

    function selectDay(k) {
      if (!validDay(k) || k === sel) return;
      const keys = dayKeys();
      const dir = keys.indexOf(k) > keys.indexOf(sel) ? 1 : -1;
      sel = k;
      reorder = false;
      rememberDay(k);
      haptic(6);
      syncAll({ fresh: true });
      replay(panel, dir > 0 ? 'is-from-next' : 'is-from-prev');
      panel.setAttribute('aria-labelledby', 'pv-tab-' + k);
      placeInk(true);
      revealTile(k, true);
    }

    function syncAll(opts) {
      const o = opts || {};
      const fresh = !!o.fresh || pendingFresh === sel;
      pendingFresh = null;
      updateWeek();
      updateHero(fresh);
      updateSetup();
      updateBody(fresh);
      fx.clear();
    }

    /* ---------------------------------------------------------------- mount */

    el.append(head, week, panel);
    panel.setAttribute('aria-labelledby', 'pv-tab-' + sel);
    syncAll({ fresh: true });
    placeInk(false);
    revealTile(sel, false);

    try {
      if (typeof ResizeObserver === 'function') {
        let raf = 0;
        ro = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => { if (ctx.isActive()) placeInk(false); });
        });
        ro.observe(rail);
        Object.keys(tiles).forEach((k) => ro.observe(tiles[k].btn));
      }
    } catch (_) { ro = null; }
    try {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (ctx.isActive()) placeInk(false); });
    } catch (_) { /* ignore */ }

    ctx.onState((state, reason) => {
      const r = String(reason || '').split(' ');
      if (r.indexOf('plan') >= 0 || r.indexOf('settings') >= 0 || r.indexOf('library') >= 0) syncAll({});
      else if (r.indexOf('workout') >= 0 || r.indexOf('finish') >= 0) updateCta();
    });

    return () => {
      try { if (ro) ro.disconnect(); } catch (_) { /* ignore */ }
    };
  }

  F.router.register('plan', { title: 'Plan', nav: 'plan', render });
})(window.Forge = window.Forge || {});
