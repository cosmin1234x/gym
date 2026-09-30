/* FORGE — js/views/today.js  [VIEW:today]
 * The home dashboard (SPEC §12 "today"): greeting, today's split day as a plate-coloured hero with the
 * one primary action (Start / Resume / Done → summary / Rest day flows), first-run welcome card, week
 * strip, daily mission, streak & consistency stats, water quick-add, journal quick entry, last workout,
 * quote of the day and "About your split".
 *
 * Updates are surgical: every section has a data signature. On a relevant store notification each
 * section recomputes it and only rebuilds (or patches itself, e.g. water count-ups and mission checks)
 * when its own data changed — so a water tap never re-renders the hero, and inputs keep focus.
 */
(function (F) {
  'use strict';

  const REASONS = ['water', 'journal', 'workout', 'set', 'finish', 'session', 'settings', 'plan', 'library'];

  // Recovery tips for rest days; three are shown, rotating by date.
  const REST_TIPS = [
    { icon: 'droplet', text: 'Keep sipping water all day. Recovery runs on it.' },
    { icon: 'bed', text: 'Aim for 7–9 hours of sleep tonight; that is when muscle gets rebuilt.' },
    { icon: 'body', text: 'Take an easy 20–30 minute walk to move blood through sore muscles.' },
    { icon: 'bar', text: 'Dead-hang from the bar for 30 seconds to decompress your spine.' },
    { icon: 'heart', text: 'Get protein in every meal. Muscle is built on rest days, not in the gym.' },
    { icon: 'repeat', text: 'Ten minutes of hip and shoulder mobility keeps your next session smooth.' },
    { icon: 'calendar', text: 'Glance at the plan so you walk into your next session knowing the first lift.' },
    { icon: 'sparkle', text: 'Sore? Gentle movement clears it faster than sitting still.' },
    { icon: 'book', text: 'Jot down how your body feels. Patterns show up in the journal.' }
  ];

  const MOOD_PLATE = { 1: 'violet', 2: 'blue', 3: 'white', 4: 'green', 5: 'red' };
  // Look of the optional rest-day sessions (by position): calm plates, distinct icons.
  const FLOW_LOOK = [{ plate: 'teal', icon: 'body' }, { plate: 'orange', icon: 'bar' }, { plate: 'violet', icon: 'heart' }];

  /* ------------------------------------------------------------------ small helpers */

  const h = (...a) => F.util.h(...a);
  const ic = (name, size, cls) => F.icon(name, { size: size || 20, cls: cls || '' });
  const prog = () => (F.data && F.data.program) || {};
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : (d || ''));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  function plateFor(focus) {
    try { return prog().plateFor ? prog().plateFor(focus) : 'red'; } catch (_) { return 'red'; }
  }
  function muscleLabel(m) {
    const M = prog().MUSCLES || {};
    if (M[m] && M[m].label) return M[m].label;
    const s = String(m || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Muscle';
  }
  /** Effective rest flag (matches F.q.dayStatus): marked rest, or no exercises. */
  const isRestDay = (day) => !day || !!day.rest || !Array.isArray(day.items) || !day.items.length;
  const items = (day) => (day && Array.isArray(day.items) ? day.items : []);

  /** A training day switched to rest keeps its old title and focus: show "Rest Day" then. */
  function restTitle(day) {
    const hasFocus = day && Array.isArray(day.focus) && day.focus.length;
    return !hasFocus && day && str(day.title) ? str(day.title) : 'Rest Day';
  }
  function dayTitle(day, dayKey) {
    if (day && str(day.title)) return str(day.title);
    if (day && day.rest) return 'Rest Day';
    return F.util.DAY_LONG[dayKey] || 'Workout';
  }
  /** Most-trained primary muscle of a list of exercise ids → plate. */
  function plateFromExIds(ids) {
    const counts = {};
    let best = null;
    for (const id of ids) {
      const m = F.q.exercise(id).muscle || 'fullbody';
      counts[m] = (counts[m] || 0) + 1;
      if (!best || counts[m] > counts[best]) best = m;
    }
    return best ? plateFor(best) : 'red';
  }
  function plateOfDay(day) {
    if (!day) return 'red';
    if (Array.isArray(day.focus) && day.focus.length) return plateFor(day.focus);
    const ids = items(day).map((i) => i.exId);
    return ids.length ? plateFromExIds(ids) : 'white';
  }
  function plateOfSession(s) {
    try {
      const by = F.q.sessionStats(s).byMuscle || {};
      let best = null;
      for (const m of Object.keys(by)) if (!best || by[m] > by[best]) best = m;
      return best ? plateFor(best) : 'red';
    } catch (_) { return 'red'; }
  }
  function totalSets(day) {
    let n = 0;
    for (const it of items(day)) n += Math.max(0, num(it.sets));
    return n;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  /** Title text with a plate-coloured ampersand; every piece is a text node. */
  function titleNodes(text) {
    const out = [];
    // keep "&" glued to the next word so it never ends up alone on a line
    String(text).replace(/&[ \t]+/g, '&\u00a0').split('&').forEach((part, i) => {
      if (i) out.push(h('span.td-amp', '&'));
      if (part) out.push(part);
    });
    return out;
  }
  /** Sizing hint for the display title: the longest word must fit on one line (no mid-word breaks)
   *  and long titles shrink so they stay within about three lines. */
  function fitVar(text, minLw) {
    const t = String(text).replace(/&[ \t]+/g, '&_');
    let lw = Math.max(4, num(minLw));
    for (const w of t.split(/[ \t\n]+/)) lw = Math.max(lw, w.length);
    return String(Math.min(Math.max(lw, Math.ceil(t.length / 2.6)), 30));
  }

  function greetingText(name) {
    const hr = new Date().getHours();
    const part = hr < 5 ? 'Late night' : hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : hr < 22 ? 'Evening' : 'Late night';
    const n = str(name);
    return n ? part + ', ' + n : 'Let’s work';
  }

  /** Next training day after `iso` (within a week). */
  function upNext(iso) {
    const u = F.util;
    for (let i = 1; i <= 7; i++) {
      const d = u.addDays(iso, i);
      const p = F.q.planFor(d);
      if (!isRestDay(p.day)) return { iso: d, dayKey: p.dayKey, day: p.day, inDays: i };
    }
    return null;
  }
  function upNextLabel(n) {
    if (!n) return '';
    const when = n.inDays === 1 ? 'Tomorrow' : F.util.DAY_LONG[n.dayKey];
    return when + ' · ' + dayTitle(n.day, n.dayKey);
  }

  function relDay(iso, today) {
    const d = F.util.diffDays(iso, today);
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d > 1 && d < 7) return d + ' days ago';
    return F.util.fmtDate(iso, 'short');
  }

  /** Live workout progress: sets done/total and the next exercise with an open set. */
  function activeProgress(a) {
    let done = 0; let total = 0; let next = null;
    for (const e of Array.isArray(a && a.exercises) ? a.exercises : []) {
      const sets = Array.isArray(e.sets) ? e.sets : [];
      total += sets.length;
      let open = -1;
      sets.forEach((s, i) => { if (s && s.done) done++; else if (open < 0) open = i; });
      if (!next && open >= 0) next = { name: F.q.exercise(e.exId).name, set: open + 1, of: sets.length };
    }
    return { done, total, next };
  }
  function activePlate(a) {
    const ex = Array.isArray(a.exercises) ? a.exercises : [];
    if (a.dayKey) {
      const d = F.q.dayPlan(a.dayKey);
      if (d && !d.rest && str(d.title) === str(a.title) && Array.isArray(d.focus) && d.focus.length) return plateFor(d.focus);
    }
    return ex.length ? plateFromExIds(ex.map((e) => e.exId)) : 'red';
  }

  function dayIndexOf(dayKey) {
    const keys = F.util.DAY_KEYS.filter((k) => !isRestDay(F.q.dayPlan(k)));
    return { n: keys.indexOf(dayKey) + 1, of: keys.length };
  }

  /** SVG water bottle (trusted static markup + a generated clip id). --fill (0..1) sets the level. */
  const BOTTLE = 'M18 9h12v5c0 3 9 5 9 12v48a6 6 0 0 1-6 6H15a6 6 0 0 1-6-6V26c0-7 9-9 9-12z';
  let bottleSeq = 0;
  function bottleSvg() {
    const id = 'td-bottle-clip-' + (++bottleSeq);
    return F.util.svgEl(
      '<svg class="td-bottle" viewBox="0 0 48 84" aria-hidden="true" focusable="false">' +
        '<defs><clipPath id="' + id + '"><path d="' + BOTTLE + '"/></clipPath></defs>' +
        '<rect class="td-bottle__cap" x="16.5" y="2" width="15" height="7" rx="2.5"/>' +
        '<g clip-path="url(#' + id + ')">' +
          '<rect class="td-bottle__bg" x="0" y="0" width="48" height="84"/>' +
          '<g class="td-bottle__fill"><path class="td-bottle__wave" d="M0 3q6-4 12 0t12 0t12 0t12 0t12 0t12 0V90H0z"/></g>' +
          '<path class="td-bottle__marks" d="M9 30h5M9 42h4M9 54h5M9 66h4"/>' +
        '</g>' +
        '<path class="td-bottle__glass" d="' + BOTTLE + '"/>' +
        '<path class="td-bottle__shine" d="M33 30v36"/>' +
      '</svg>');
  }
  const CHECK_SVG = '<svg class="td-check__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path pathLength="1" d="m5.5 12.8 4.2 4.2 8.8-9.6"/></svg>';

  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  /* ------------------------------------------------------------------ view */

  function render(el, params, ctx) {
    const u = F.util;
    const store = F.store;
    const S = () => store.get();
    const today = u.todayISO();
    const todayKey = u.dayKeyOf(today);

    const root = h('div.td.stagger');
    el.appendChild(root);

    /* ---------- section registry: key() → signature, build(fresh, prevSig) → node, patch(prevSig) → bool */
    const sections = [];
    let order = 0;
    function add(def, parent) {
      const s = Object.assign({ node: null, sig: null }, def);
      s.sig = s.key();
      s.node = s.build(true, null);
      if (!parent) s.node.style.setProperty('--i', String(order++));
      (parent || root).appendChild(s.node);
      sections.push(s);
      return s;
    }
    function swap(s, next) {
      const old = s.node;
      const active = document.activeElement;
      const fk = active && old.contains(active) && active.getAttribute('data-fk');
      const i = old.style.getPropertyValue('--i');
      if (i) next.style.setProperty('--i', i);
      next.classList.add('td-swap');
      old.replaceWith(next);
      s.node = next;
      if (fk) {
        const again = next.querySelector('[data-fk="' + fk + '"]');
        if (again) { try { again.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
      }
    }
    function refresh(s) {
      try {
        const sig = s.key();
        if (sig !== s.sig) {
          const prev = s.sig;
          s.sig = sig;
          if (!(s.patch && s.patch(prev) === true)) swap(s, s.build(false, prev));
        }
        if (s.tick) s.tick();
      } catch (err) {
        console.error('[FORGE] today: section "' + s.name + '" failed to update', err);
      }
    }

    /* ---------- live clock for an active workout */
    let clockTimer = null;
    function stopClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }
    function startClock(clockEl, startedAt) {
      stopClock();
      const t0 = num(startedAt) || Date.now();
      const tick = () => {
        if (!ctx.isActive()) { stopClock(); return; }
        const txt = u.fmtClock((Date.now() - t0) / 1000);
        if (clockEl.textContent !== txt) clockEl.textContent = txt;
      };
      tick();
      clockTimer = setInterval(tick, 1000);
    }

    /* ================================================================ header */
    add({
      name: 'head',
      key: () => str(S().settings.name),
      build() {
        return h('header.view-head.td-head',
          h('div.view-head__titles',
            h('p.eyebrow.td-head__date', (u.DAY_LONG[todayKey] || '') + ' · ' + u.fmtDate(today, 'dm')),
            h('h2.h1.td-greet', greetingText(S().settings.name))));
      },
      patch() {
        const g = this.node.querySelector('.td-greet');
        if (g) g.textContent = greetingText(S().settings.name);
        return true;
      }
    });

    /* ================================================================ welcome (first run) */
    function buildWelcome() {
      const st = S().settings;
      if (st.onboarded) return h('div.td-slot', { hidden: true });
      const P = prog();
      const info = P.splitInfo || {};
      let units = st.units === 'lb' ? 'lb' : 'kg';
      let goal = num(st.waterGoal) || 3000;

      const nameIn = h('input.input.td-welcome__name', {
        id: 'td-welcome-name', type: 'text', value: st.name || '', placeholder: 'e.g. Alex', maxLength: 60,
        autocomplete: 'given-name', attrs: { enterkeyhint: 'go', 'data-fk': 'w-name' },
        onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } }
      });
      const unitsSeg = F.ui.segmented({
        id: 'td-welcome-units', label: 'Weight units', value: units,
        options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
        onChange: (v) => { units = v; }
      });
      const goalStep = F.ui.stepper({
        id: 'td-welcome-goal', label: 'Daily water goal', value: goal, step: 250, min: 250, max: 10000, unit: 'ml',
        onChange: (v) => { if (v) goal = v; }
      });
      // first sentence of the explainer (no regex lookbehind: older Safari can't parse it)
      const summary = String(info.summary || '');
      const cut = /[.!?](\s|$)/.exec(summary);
      const firstSentence = cut ? summary.slice(0, cut.index + 1) : summary;
      const week = u.DAY_KEYS.map((k) => {
        const d = F.q.dayPlan(k);
        const rest = isRestDay(d);
        return h('li.td-wk', { class: rest ? 'is-rest' : null, dataset: { plate: rest ? 'white' : plateOfDay(d) } },
          h('span.td-wk__day', u.DAY_SHORT[k]),
          h('span.td-wk__dot', { attrs: { 'aria-hidden': 'true' } }),
          h('span.td-wk__title', rest ? 'Rest' : dayTitle(d, k)));
      });

      const go = h('button.btn.btn--primary.btn--lg.td-welcome__go', { type: 'button', attrs: { 'data-fk': 'w-go' }, onClick: finish },
        'Let’s go', ic('arrow-up', 20, 'td-welcome__go-ic'));
      const skip = h('button.btn.btn--ghost.td-welcome__skip', { type: 'button', onClick: () => store.setSetting('onboarded', true) }, 'Skip');

      function finish() {
        const name = nameIn.value.trim().slice(0, 60);
        store.setSetting('name', name);
        store.setSetting('units', units);
        store.setSetting('waterGoal', goal);
        store.setSetting('onboarded', true);
        u.haptic(14);
        F.ui.toast(name ? 'You’re set, ' + name + '. Let’s get to work.' : 'You’re set. Let’s get to work.', { type: 'ok', icon: 'bolt' });
      }

      return h('section.card.td-welcome', { attrs: { 'aria-labelledby': 'td-welcome-title' } },
        h('div.td-welcome__head',
          h('span.td-welcome__badge', { attrs: { 'aria-hidden': 'true' } }, ic('bolt', 22)),
          h('div.td-welcome__titles',
            h('p.eyebrow', 'Welcome to FORGE'),
            h('h3.h2#td-welcome-title', 'Set up in 10 seconds'))),
        h('p.td-welcome__lead', 'Three quick settings and you’re training. Change any of them later in Settings.'),
        F.ui.field({ label: 'Your name', input: nameIn, hint: 'Used for your greeting.' }),
        h('div.td-welcome__row',
          F.ui.field({ label: 'Units', input: unitsSeg }),
          goalStep),
        h('div.td-welcome__split',
          h('p.eyebrow', 'Your split'),
          h('p.td-welcome__split-name', info.name || 'Your weekly split'),
          firstSentence ? h('p.td-welcome__split-text', firstSentence) : null,
          h('ul.td-wks', week)),
        h('div.td-welcome__actions', go, skip));
    }
    add({
      name: 'welcome',
      key: () => (S().settings.onboarded ? '1' : '0'),
      build: buildWelcome,
      patch(prev) {
        if (!(prev === '0' && S().settings.onboarded)) return false;
        const node = this.node;
        const placeholder = h('div.td-slot', { hidden: true });
        const done = () => {
          if (this.node !== node) return;
          const hadFocus = node.contains(document.activeElement);
          swap(this, placeholder);
          const head = el.querySelector('.td-greet');
          if (head && hadFocus) {
            // same treatment the router gives headings: focusable by script, no outline
            if (!head.hasAttribute('tabindex')) { head.setAttribute('tabindex', '-1'); head.setAttribute('data-route-focus', ''); }
            try { head.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
          }
        };
        if (u.reducedMotion()) { done(); return true; }
        node.style.height = node.offsetHeight + 'px';
        void node.offsetHeight;
        node.classList.add('is-leaving');
        node.style.height = '0px';
        setTimeout(done, 520);
        return true;
      }
    });

    /* ================================================================ hero */
    function heroMode() {
      const st = S();
      const plan = F.q.planFor(today);
      if (st.active) return { mode: 'active', plan };
      const todays = F.q.sessionsOn(today);
      if (todays.length) return { mode: 'done', plan, todays };
      if (plan.day && plan.day.rest) return { mode: 'rest', plan };
      if (!items(plan.day).length) return { mode: 'empty', plan };
      return { mode: 'plan', plan };
    }
    function heroKey() {
      const st = S();
      const m = heroMode();
      const next = upNext(today);
      const nextSig = next ? next.dayKey + ':' + dayTitle(next.day, next.dayKey) : '';
      switch (m.mode) {
        case 'active': {
          const a = st.active;
          return ['A', a.id, a.title, a.startedAt, a.dayKey, (a.exercises || []).map((e) => e.exId).join(',')].join('|');
        }
        case 'done':
          return ['D', m.todays.map((s) => s.id + ':' + s.endedAt + ':' + s.title).join(','), st.settings.units, nextSig].join('|');
        case 'rest':
          return ['R', restTitle(m.plan.day), nextSig, st.settings.restSeconds].join('|');
        case 'empty':
          return ['E', dayTitle(m.plan.day, todayKey)].join('|');
        default:
          return ['P', JSON.stringify(m.plan.day), st.settings.restSeconds,
            items(m.plan.day).map((i) => F.q.exercise(i.exId).name).join(','),
            u.DAY_KEYS.map((k) => (isRestDay(F.q.dayPlan(k)) ? 0 : 1)).join('')].join('|');
      }
    }

    function heroShell(plate, mode, children) {
      return h('section.card.card--hero.td-hero', {
        class: 'td-hero--' + mode, dataset: { plate, mode }, attrs: { 'aria-labelledby': 'td-hero-title' }
      }, children);
    }
    function heroTitle(text, sub, minLw) {
      return h('div.td-hero__titles',
        h('h3.h-display.td-hero__title#td-hero-title', { style: { '--lw': fitVar(text, minLw) } }, titleNodes(text)),
        sub ? h('p.td-hero__sub', sub) : null);
    }
    function upNextEl(next) {
      if (!next) return null;
      return h('p.td-upnext', { dataset: { plate: plateOfDay(next.day) } },
        h('span.td-upnext__label', 'Up next'), h('span.td-upnext__dot', { attrs: { 'aria-hidden': 'true' } }),
        h('span.td-upnext__text', upNextLabel(next)));
    }

    function heroPlan(m, fresh) {
      const { dayKey, day } = m.plan;
      const title = dayTitle(day, dayKey);
      const plate = plateOfDay(day);
      const list = items(day);
      const mins = F.q.estimateMinutes(day);
      const idx = dayIndexOf(dayKey);
      const focus = Array.isArray(day.focus) ? day.focus : [];
      const preview = list.slice(0, 4).map((it, i) => {
        const ex = F.q.exercise(it.exId);
        return h('li.td-prev', { style: { '--i': i }, class: ex.missing ? 'is-missing' : null },
          h('span.td-prev__n', String(i + 1).padStart(2, '0')),
          h('span.td-prev__name', ex.name,
            ex.calisthenics ? h('span.td-prev__cali', { title: 'Calisthenics', attrs: { 'aria-label': 'calisthenics' } }, ic('body', 14)) : null),
          h('span.td-prev__sets.num', num(it.sets) + ' × ' + str(it.target, '—')));
      });
      if (list.length > 4) preview.push(h('li.td-prev.td-prev--more', { style: { '--i': 4 } }, '+ ' + plural(list.length - 4, 'more exercise')));

      const start = h('button.btn.btn--primary.btn--lg.td-cta', {
        type: 'button', attrs: { 'data-fk': 'hero-cta' },
        onClick: () => {
          const a = store.startWorkout({ dayKey });
          if (!a) return;
          u.haptic(16);
          ctx.go('workout');
        }
      }, ic('play', 22), 'Start workout');
      const planBtn = h('button.btn.btn--secondary.btn--lg.btn--icon.td-hero__side', {
        type: 'button', title: 'Open in Plan', attrs: { 'aria-label': 'Open ' + u.DAY_LONG[dayKey] + ' in Plan', 'data-fk': 'hero-plan' },
        onClick: () => ctx.go('plan', { day: dayKey })
      }, ic('calendar', 22));

      return heroShell(plate, 'plan', [
        h('div.td-hero__top',
          h('p.eyebrow.td-hero__eyebrow', idx.n > 0 ? 'Today · Day ' + idx.n + ' of ' + idx.of : 'Today’s session'),
          mins ? h('span.td-hero__chip.num', ic('clock', 15), '~' + mins + ' min') : null),
        heroTitle(title),
        h('div.td-hero__meta',
          focus.map((f) => h('span.badge.badge--plate', { dataset: { plate: plateFor(f) } }, muscleLabel(f))),
          h('span.td-hero__facts', plural(list.length, 'exercise') + ' · ' + plural(totalSets(day), 'set'))),
        h('ol.td-prev-list', { class: fresh ? 'stagger' : null, attrs: { 'aria-label': 'First exercises' } }, preview),
        h('div.td-hero__cta', start, planBtn)
      ]);
    }

    function heroActive() {
      const a = S().active;
      const plate = activePlate(a);
      const clock = h('span.td-clock__time', { attrs: { 'aria-hidden': 'true' } }, u.fmtClock((Date.now() - (num(a.startedAt) || Date.now())) / 1000));
      const doneEl = h('span.td-sets__done', '0');
      const totalEl = h('span.td-sets__total', '/ 0');
      const bar = F.ui.progressBar({ value: 0, plate });
      bar.classList.add('td-hero__bar');
      const nextEl = h('p.td-hero__nextset');
      const node = heroShell(plate, 'active', [
        h('div.td-hero__top',
          h('p.eyebrow.td-live', h('span.td-live__dot', { attrs: { 'aria-hidden': 'true' } }), 'Workout in progress'),
          h('span.td-hero__chip.num', ic('clock', 15), 'Started ' + u.fmtTime(a.startedAt))),
        heroTitle(str(a.title, 'Workout')),
        h('div.td-hero__live',
          h('div.td-clock', clock, h('span.td-clock__label', 'Elapsed')),
          h('div.td-sets', h('span.td-sets__nums', doneEl, totalEl), h('span.td-clock__label', 'Sets done'))),
        bar,
        nextEl,
        h('div.td-hero__cta',
          h('button.btn.btn--primary.btn--lg.td-cta', { type: 'button', attrs: { 'data-fk': 'hero-cta' }, onClick: () => ctx.go('workout') },
            ic('play', 22), 'Resume workout'))
      ]);
      node._refs = { doneEl, totalEl, bar, nextEl };
      startClock(clock, a.startedAt);
      return node;
    }
    function heroActiveTick(node) {
      const r = node && node._refs;
      const a = S().active;
      if (!r || !a) return;
      const p = activeProgress(a);
      if (r.doneEl.textContent !== String(p.done)) {
        r.doneEl.textContent = String(p.done);
        replay(r.doneEl, 'td-bump');
      }
      r.totalEl.textContent = '/ ' + p.total;
      r.bar.setValue(p.total ? p.done / p.total : 0);
      r.nextEl.textContent = '';
      if (p.next) {
        r.nextEl.append(h('span.td-hero__nextlabel', 'Next'), ' ' + p.next.name + ' · set ' + p.next.set + ' of ' + p.next.of);
      } else if (p.total) {
        r.nextEl.append(h('span.td-hero__nextlabel', 'All sets done'), ' Finish the workout to log it.');
      } else {
        r.nextEl.append(h('span.td-hero__nextlabel', 'Empty'), ' Add exercises in the workout screen.');
      }
    }

    function heroDone(m) {
      const todays = m.todays;
      const last = todays[todays.length - 1];
      let dur = 0; let vol = 0; let sets = 0; let prs = 0;
      for (const s of todays) {
        const st = F.q.sessionStats(s);
        dur += st.durationSec; vol += st.volume; sets += st.sets;
        try { prs += F.q.sessionPRs(s).length; } catch (_) { /* ignore */ }
      }
      const plate = plateOfSession(last);
      const stat = (label, value) => h('div.td-hero__stat', h('span.td-hero__statv', value), h('span.td-hero__statl', label));
      return heroShell(plate, 'done', [
        h('div.td-hero__top',
          h('p.eyebrow.td-hero__eyebrow', todays.length > 1 ? plural(todays.length, 'session') + ' logged today' : 'Today · Workout logged'),
          h('span.td-stamp', { attrs: { 'aria-hidden': 'true' } }, 'Done', ic('check', 18))),
        heroTitle(str(last.title, 'Workout'), 'Plan done. Streak alive.'),
        h('div.td-hero__stats',
          stat('Time', u.fmtDuration(dur)),
          stat('Volume', vol > 0 ? u.fmtVolume(vol) : '—'),
          stat('Sets', String(sets))),
        prs ? h('p.td-hero__prs', ic('trophy', 18), plural(prs, 'personal record') + ' today') : null,
        h('div.td-hero__cta',
          h('button.btn.btn--primary.btn--lg.td-cta', {
            type: 'button', attrs: { 'data-fk': 'hero-cta' },
            onClick: () => ctx.go('progress', { tab: 'history', sessionId: last.id })
          }, ic('chart', 22), 'View summary')),
        upNextEl(upNext(today))
      ]);
    }

    function heroRest(m) {
      const P = prog();
      const day0 = u.diffDays('2020-01-06', today);
      const tips = [0, 1, 2].map((k) => REST_TIPS[((day0 * 3 + k) % REST_TIPS.length + REST_TIPS.length) % REST_TIPS.length]);
      const tpls = Array.isArray(P.templates) ? P.templates : [];
      const flows = (Array.isArray(P.restDayTemplateIds) ? P.restDayTemplateIds : [])
        .map((id) => tpls.find((t) => t && t.id === id)).filter(Boolean);
      const flowBtns = flows.map((t, i) => {
        const mins = F.q.estimateMinutes({ rest: false, items: t.items || [] });
        return h('button.td-flow', {
          type: 'button', style: { '--i': i }, dataset: { plate: FLOW_LOOK[i % FLOW_LOOK.length].plate },
          attrs: { 'aria-label': 'Start ' + t.title + ', about ' + mins + ' minutes', 'data-fk': 'flow-' + t.id },
          onClick: () => {
            const a = store.startWorkout({ templateId: t.id });
            if (!a) return;
            u.haptic(16);
            ctx.go('workout');
          }
        },
        h('span.td-flow__icon', { attrs: { 'aria-hidden': 'true' } }, ic(FLOW_LOOK[i % FLOW_LOOK.length].icon, 20)),
        h('span.td-flow__main', h('span.td-flow__title', t.title), h('span.td-flow__meta.num', '~' + mins + ' min · ' + plural((t.items || []).length, 'move'))),
        ic('play', 18, 'td-flow__go'));
      });
      return heroShell('white', 'rest', [
        h('div.td-hero__top',
          h('p.eyebrow.td-hero__eyebrow', (u.DAY_LONG[todayKey] || '') + ' · Rest day'),
          h('span.td-hero__chip', ic('bed', 15), 'Off')),
        heroTitle(restTitle(m.plan.day), 'Recover & grow', String(restTitle(m.plan.day)).length),
        h('ul.td-tips', tips.map((t) => h('li.td-tip', h('span.td-tip__icon', { attrs: { 'aria-hidden': 'true' } }, ic(t.icon, 18)), h('span', t.text)))),
        flowBtns.length ? h('div.td-flows',
          h('p.divider', 'Optional · calisthenics'),
          h('div.td-flows__list', flowBtns)) : null,
        h('div.td-hero__foot',
          upNextEl(upNext(today)),
          h('button.btn.btn--ghost.btn--sm.td-anyway', { type: 'button', onClick: () => ctx.go('workout') }, 'Train anyway', ic('chevron-right', 16)))
      ]);
    }

    function heroEmpty(m) {
      const { dayKey, day } = m.plan;
      return heroShell(plateOfDay(day), 'empty', [
        h('div.td-hero__top', h('p.eyebrow.td-hero__eyebrow', 'Today · ' + u.DAY_LONG[dayKey])),
        heroTitle(dayTitle(day, dayKey), 'No exercises planned yet.'),
        h('p.td-hero__lead', 'Add a few moves to today’s plan and your Start button appears here. Mix dumbbell work with calisthenics variations.'),
        h('div.td-hero__cta',
          h('button.btn.btn--primary.btn--lg.td-cta', { type: 'button', attrs: { 'data-fk': 'hero-cta' }, onClick: () => ctx.go('plan', { day: dayKey }) },
            ic('plus', 22), 'Plan today'))
      ]);
    }

    add({
      name: 'hero',
      key: heroKey,
      build(fresh) {
        const m = heroMode();
        if (m.mode !== 'active') stopClock();
        switch (m.mode) {
          case 'active': return heroActive();
          case 'done': return heroDone(m);
          case 'rest': return heroRest(m);
          case 'empty': return heroEmpty(m);
          default: return heroPlan(m, fresh);
        }
      },
      tick() { if (this.node && this.node.dataset.mode === 'active') heroActiveTick(this.node); }
    });
    sections[sections.length - 1].tick();

    /* ================================================================ week strip */
    function tileModel(d) {
      if (d.trained) return { state: 'done', icon: 'check', text: 'done' };
      if (d.missed) return { state: 'missed', icon: 'x', text: 'missed' };
      if (d.isRest) return { state: 'rest', icon: 'bed', text: 'rest day' };
      if (d.isToday) return { state: 'planned', icon: null, text: 'planned for today' };
      if (d.isFuture) return { state: 'planned', icon: null, text: 'planned' };
      return { state: 'idle', icon: 'minus', text: 'before you started' };
    }
    function weekKey() {
      const w = F.q.weekSummary(today);
      return JSON.stringify(w.days.map((d) => [tileModel(d).state, isRestDay(d.day) ? 'rest' : plateOfDay(d.day), dayTitle(d.day, d.dayKey)]));
    }
    add({
      name: 'week',
      key: weekKey,
      build(fresh, prevSig) {
        const w = F.q.weekSummary(today);
        let prev = null;
        try { prev = prevSig ? JSON.parse(prevSig) : null; } catch (_) { prev = null; }
        const tiles = w.days.map((d, i) => {
          const t = tileModel(d);
          const rest = isRestDay(d.day);
          const plate = rest ? 'white' : plateOfDay(d.day);
          const title = rest ? 'Rest day' : dayTitle(d.day, d.dayKey);
          const changed = prev && prev[i] && prev[i][0] !== t.state;
          return h('li', { style: { '--i': i } },
            h('button.td-day', {
              type: 'button',
              class: ['is-' + t.state, d.isToday ? 'is-today' : null, d.isFuture ? 'is-future' : null, changed ? 'is-changed' : null],
              dataset: { plate, day: d.dayKey },
              title: title,
              attrs: { 'aria-label': u.DAY_LONG[d.dayKey] + ' ' + u.fmtDate(d.iso, 'dm') + ', ' + title + ', ' + t.text + (d.isToday ? ' (today)' : ''), 'data-fk': 'day-' + d.dayKey },
              onClick: () => ctx.go('plan', { day: d.dayKey })
            },
            h('span.td-day__abbr', u.DAY_SHORT[d.dayKey]),
            h('span.td-day__num', u.fmtDate(d.iso, 'day')),
            h('span.td-day__mark', { attrs: { 'aria-hidden': 'true' } }, t.icon ? ic(t.icon, 14) : null)));
        });
        return h('section.td-week', { attrs: { 'aria-labelledby': 'td-week-title' } },
          h('div.td-sec-head',
            h('h3.td-sec-title#td-week-title', 'This week'),
            h('span.td-sec-meta.num', u.fmtDate(w.dates[0], 'dm') + ' – ' + u.fmtDate(w.dates[6], 'dm'))),
          h('ol.td-week__grid', { class: fresh ? 'stagger' : null }, tiles));
      }
    });

    /* ================================================================ daily mission */
    function missionModel() {
      const m = F.q.missionFor(today);
      const st = S();
      const goal = num(st.settings.waterGoal);
      const ml = F.q.waterTotal(today);
      const { day } = F.q.planFor(today);
      const rest = isRestDay(day);
      const trainedToday = F.q.trainedOn(today);
      const journal = F.q.journalFor(today);
      const byKey = {};
      for (const it of m.items) byKey[it.key] = it.done;
      const rows = [
        {
          key: 'train', done: !!byKey.train, plate: rest ? 'white' : plateOfDay(day),
          title: rest && !trainedToday ? 'Rest & recover' : 'Train',
          sub: rest && !trainedToday ? 'Rest day — recovery counts' : (trainedToday ? dayTitle(day, todayKey) + ' · logged' : dayTitle(day, todayKey)),
          aria: 'Training'
        },
        {
          key: 'water', done: !!byKey.water, plate: 'blue',
          title: 'Hydrate', sub: u.fmtMl(ml) + ' of ' + u.fmtMl(goal), aria: 'Water'
        },
        {
          key: 'journal', done: !!byKey.journal, plate: 'yellow',
          title: 'Journal', sub: journal.length ? plural(journal.length, 'entry', 'entries') + ' today' : 'How did today go?', aria: 'Journal'
        }
      ];
      return { rows, done: m.done, total: m.total, pct: m.pct };
    }
    const missionSig = () => JSON.stringify(missionModel());
    function taskGo(key) {
      if (key === 'train') {
        if (S().active) { ctx.go('workout'); return; }
        const todays = F.q.sessionsOn(today);
        if (todays.length) { ctx.go('progress', { tab: 'history', sessionId: todays[todays.length - 1].id }); return; }
        ctx.go(isRestDay(F.q.planFor(today).day) ? 'plan' : 'workout', isRestDay(F.q.planFor(today).day) ? { day: todayKey } : {});
        return;
      }
      if (key === 'water') { ctx.go('water'); return; }
      const j = F.q.journalFor(today);
      if (j.length) ctx.go('journal', { id: j[0].id });
      else ctx.go('journal', { new: true, date: today });
    }
    function missionHeadText(mm) {
      if (mm.done >= mm.total) return { big: 'Mission complete', sub: 'Every box ticked. That\u2019s a day on plan.' };
      const left = mm.total - mm.done;
      return { big: left + ' to go', sub: 'Train, hydrate, journal. Tick all three to keep the day on plan.' };
    }
    add({
      name: 'mission',
      key: missionSig,
      build(fresh) {
        const mm = missionModel();
        const complete = mm.done >= mm.total;
        const ring = F.ui.ring({
          size: 84, stroke: 9, value: mm.pct / 100, className: 'td-mission__ring',
          color: complete ? 'var(--ok)' : 'var(--accent)', track: 'var(--surface-2)',
          label: mm.done + '/' + mm.total, sublabel: 'done'
        });
        const ht = missionHeadText(mm);
        const big = h('p.td-mission__big', ht.big);
        const sub = h('p.td-mission__sub', ht.sub);
        const rows = mm.rows.map((r, i) => {
          const subEl = h('span.td-task__sub', r.sub);
          const btn = h('button.td-task', {
            type: 'button', class: r.done ? 'is-done' : null, dataset: { plate: r.plate, task: r.key },
            style: { '--i': i },
            attrs: { 'aria-label': r.aria + ': ' + r.sub + (r.done ? ', done' : ', not done yet'), 'data-fk': 'task-' + r.key },
            onClick: () => taskGo(r.key)
          },
          h('span.td-check', { attrs: { 'aria-hidden': 'true' } }, u.svgEl(CHECK_SVG)),
          h('span.td-task__main', h('span.td-task__title', r.title), subEl),
          ic('chevron-right', 18, 'td-task__chev'));
          btn._sub = subEl;
          return h('li', null, btn);
        });
        const node = h('section.card.td-mission', { class: complete ? 'is-complete' : null, attrs: { 'aria-labelledby': 'td-mission-title' } },
          h('div.td-mission__head',
            ring,
            h('div.td-mission__titles',
              h('h3.eyebrow.td-mission__eyebrow#td-mission-title', ic('target', 14), 'Daily mission'),
              big, sub)),
          h('ul.td-tasks', { class: fresh ? 'td-tasks--intro' : null }, rows));
        node._refs = { ring, big, sub, rows };
        return node;
      },
      patch(prevSig) {
        let prev;
        try { prev = JSON.parse(prevSig); } catch (_) { return false; }
        const mm = missionModel();
        const r = this.node._refs;
        if (!r || !prev || !Array.isArray(prev.rows) || prev.rows.length !== mm.rows.length) return false;
        const complete = mm.done >= mm.total;
        F.ui.setRing(r.ring, mm.pct / 100);
        r.ring.style.color = complete ? 'var(--ok)' : 'var(--accent)';
        const bar = r.ring.querySelector('.ring__bar');
        if (bar) bar.style.stroke = complete ? 'var(--ok)' : 'var(--accent)';
        const lab = r.ring.querySelector('.ring__label');
        if (lab) lab.textContent = mm.done + '/' + mm.total;
        const ht = missionHeadText(mm);
        r.big.textContent = ht.big;
        r.sub.textContent = ht.sub;
        this.node.classList.toggle('is-complete', complete);
        mm.rows.forEach((row, i) => {
          const btn = r.rows[i] && r.rows[i].firstChild;
          if (!btn) return;
          btn.dataset.plate = row.plate;
          btn.classList.toggle('is-done', row.done);
          btn.querySelector('.td-task__title').textContent = row.title;
          btn._sub.textContent = row.sub;
          btn.setAttribute('aria-label', row.aria + ': ' + row.sub + (row.done ? ', done' : ', not done yet'));
          if (row.done && !prev.rows[i].done) replay(btn, 'is-pop');
        });
        if (complete && prev.done < prev.total) {
          replay(r.ring, 'is-pop');
          const key = 'mission:' + today;
          if (!(S().meta.celebrated || {})[key]) {
            store.markCelebrated(key);
            try {
              const b = r.ring.getBoundingClientRect();
              F.ui.confetti({ x: b.left + b.width / 2, y: b.top + b.height / 2, count: 70 });
            } catch (_) { /* ignore */ }
            F.ui.toast('Daily mission complete. That’s a day on plan.', { type: 'ok', icon: 'trophy' });
          }
        }
        return true;
      }
    });

    /* ================================================================ stats row */
    function statsModel() {
      const w = F.q.weekSummary(today);
      const c = F.q.consistency(28);
      return { streak: F.q.workoutStreak(), done: w.done, planned: w.planned, cPlanned: c.planned, pct: c.pct };
    }
    add({
      name: 'stats',
      key: () => JSON.stringify(statsModel()),
      build(fresh) {
        const m = statsModel();
        const tile = (cls, iconName, value, unit, cap, extraIconCls) => {
          const n = h('span.td-stat__num', '0');
          const node = h('div.stat.td-stat', { class: cls },
            h('span.td-stat__icon', { attrs: { 'aria-hidden': 'true' } }, ic(iconName, 20, extraIconCls)),
            h('span.stat__value', n, unit !== null ? h('span.stat__unit', unit) : null),
            h('span.td-stat__cap', cap));
          node._n = n;
          return node;
        };
        const streak = tile('td-stat--streak' + (m.streak > 0 ? ' is-hot' : ''), 'flame', m.streak, m.streak === 1 ? 'day' : 'days', 'Workout streak', m.streak > 0 ? 'flicker' : '');
        const week = tile('td-stat--week', 'calendar', m.done, '/ ' + m.planned, 'This week');
        const cons = tile('td-stat--cons', 'target', m.pct, m.cPlanned ? '%' : null, '28-day consistency');
        const node = h('section.td-stats', { attrs: { 'aria-label': 'Your numbers' } }, streak, week, cons);
        node._refs = { streak, week, cons };
        const dur = fresh ? 900 : 500;
        u.countUp(streak._n, m.streak, { duration: dur });
        u.countUp(week._n, m.done, { duration: dur });
        if (m.cPlanned) u.countUp(cons._n, m.pct, { duration: dur + 200 });
        else cons._n.textContent = '—';
        return node;
      },
      patch(prevSig) {
        let p;
        try { p = JSON.parse(prevSig); } catch (_) { return false; }
        const m = statsModel();
        const r = this.node._refs;
        if (!r || !p) return false;
        const fl = r.streak.querySelector('.icon');
        if (m.streak !== p.streak) {
          u.countUp(r.streak._n, m.streak, { from: p.streak, duration: 600 });
          r.streak.querySelector('.stat__unit').textContent = m.streak === 1 ? 'day' : 'days';
          r.streak.classList.toggle('is-hot', m.streak > 0);
          if (fl) fl.classList.toggle('flicker', m.streak > 0);
          replay(r.streak, 'is-pop');
        }
        if (m.done !== p.done || m.planned !== p.planned) {
          u.countUp(r.week._n, m.done, { from: p.done, duration: 600 });
          r.week.querySelector('.stat__unit').textContent = '/ ' + m.planned;
          if (m.done > p.done) replay(r.week, 'is-pop');
        }
        if (m.pct !== p.pct || m.cPlanned !== p.cPlanned) {
          if (!m.cPlanned || !p.cPlanned) return false; // unit appears/disappears: rebuild
          u.countUp(r.cons._n, m.pct, { from: p.pct, duration: 600 });
        }
        return true;
      }
    });

    /* ================================================================ water + journal */
    const duo = h('div.td-duo');
    duo.style.setProperty('--i', String(order++));
    root.appendChild(duo);

    function waterModel() {
      const st = S().settings;
      const servings = Array.isArray(st.waterServings) ? st.waterServings.filter((x) => num(x) > 0) : [];
      return { ml: F.q.waterTotal(today), goal: num(st.waterGoal) || 1, servings: servings.join(',') };
    }
    const mlParts = (ml) => (ml >= 1000 ? { n: u.fmtNum(ml / 1000, 2), unit: 'L' } : { n: u.fmtNum(Math.round(ml)), unit: 'ml' });
    function waterPct(m) { return Math.round((m.ml / m.goal) * 100); }
    function waterAria(m) { return 'Water today: ' + u.fmtMl(m.ml) + ' of ' + u.fmtMl(m.goal) + ' (' + waterPct(m) + '%). Open water tracker'; }

    let waterToast = null;
    function quickAdd(ml, btn) {
      const iso = today;
      const goal = num(S().settings.waterGoal);
      const before = F.q.waterTotal(iso);
      const entry = store.addWater(ml, iso);
      if (!entry) return;
      u.haptic(10);
      replay(btn, 'is-pop');
      const after = before + entry.ml;
      if (waterToast) waterToast.close(); // one live toast; Undo always targets the latest add
      waterToast = F.ui.toast('+' + u.fmtMl(entry.ml) + ' · ' + u.fmtMl(after) + ' of ' + u.fmtMl(goal), {
        type: 'ok', icon: 'droplet',
        action: { label: 'Undo', onClick: () => store.removeWater(iso, entry.id) }
      });
      const key = 'water:' + iso;
      if (goal > 0 && before < goal && after >= goal && !(S().meta.celebrated || {})[key]) {
        store.markCelebrated(key);
        F.ui.celebrate({ title: 'Hydrated', subtitle: u.fmtMl(goal) + ' goal hit', icon: 'droplet', plate: 'blue' });
      }
    }

    add({
      name: 'water',
      key: () => { const m = waterModel(); return [m.ml, m.goal, m.servings].join('|'); },
      build(fresh) {
        const m = waterModel();
        const bottle = bottleSvg();
        const fill = Math.min(1, m.ml / m.goal);
        bottle.style.setProperty('--fill', String(fill));
        if (fresh) bottle.classList.add('td-bottle--intro'); // CSS pours the level in from empty
        const parts = mlParts(m.ml);
        const numEl = h('span.td-water__n', fresh ? '0' : parts.n);
        const unitEl = h('span.td-water__unit', parts.unit);
        const ofEl = h('span.td-water__of', 'of ' + u.fmtMl(m.goal) + ' · ' + waterPct(m) + '%');
        const hit = m.ml >= m.goal;
        const main = h('button.td-water__main', {
          type: 'button', attrs: { 'aria-label': waterAria(m), 'data-fk': 'water-main' }, onClick: () => ctx.go('water')
        },
        h('span.td-water__bottle', bottle),
        h('span.td-water__txt',
          h('span.eyebrow.td-water__eyebrow', ic('droplet', 14), 'Water today'),
          h('span.td-water__big', numEl, unitEl),
          ofEl),
        ic('chevron-right', 20, 'td-water__chev'));
        const servings = m.servings ? m.servings.split(',').map(Number) : [];
        const quick = h('div.td-water__quick', { attrs: { role: 'group', 'aria-label': 'Quick add water' } },
          servings.map((ml) => {
            const b = h('button.btn.btn--secondary.td-water__add', {
              type: 'button', attrs: { 'aria-label': 'Add ' + u.fmtMl(ml) + ' of water', 'data-fk': 'water-' + ml },
              onClick: () => quickAdd(ml, b)
            }, ic('plus', 16), u.fmtMl(ml));
            return b;
          }));
        const node = h('section.card.td-water', { class: hit ? 'is-hit' : null, attrs: { 'aria-label': 'Water' } }, main, quick);
        node._refs = { bottle, numEl, unitEl, ofEl, main };
        if (fresh) {
          u.countUp(numEl, m.ml, { duration: 900, format: (n) => (m.ml >= 1000 ? u.fmtNum(n / 1000, 2) : u.fmtNum(Math.round(n))) });
        }
        return node;
      },
      patch(prevSig) {
        const [pml, pgoal, pserv] = String(prevSig).split('|');
        const m = waterModel();
        if (String(m.goal) !== pgoal || m.servings !== pserv) return false;
        const r = this.node._refs;
        if (!r) return false;
        const from = num(pml);
        const big = m.ml >= 1000;
        r.unitEl.textContent = big ? 'L' : 'ml';
        u.countUp(r.numEl, m.ml, { from, duration: 600, format: (n) => (big ? u.fmtNum(n / 1000, 2) : u.fmtNum(Math.round(n))) });
        r.bottle.style.setProperty('--fill', String(Math.min(1, m.ml / m.goal)));
        r.ofEl.textContent = 'of ' + u.fmtMl(m.goal) + ' · ' + waterPct(m) + '%';
        r.main.setAttribute('aria-label', waterAria(m));
        this.node.classList.toggle('is-hit', m.ml >= m.goal);
        if (m.ml > from) replay(r.bottle, 'is-slosh');
        return true;
      }
    }, duo);

    function journalKey() {
      return JSON.stringify(F.q.journalFor(today).map((e) => [e.id, e.updatedAt, e.mood, e.title, (e.text || '').slice(0, 160), e.tags]));
    }
    add({
      name: 'journal',
      key: journalKey,
      build() {
        const entries = F.q.journalFor(today);
        const head = (right) => h('div.td-card-head',
          h('h3.eyebrow.td-card-eyebrow', ic('book', 14), 'Journal \u00b7 Today'),
          right);
        if (!entries.length) {
          let picked = false;
          const picker = F.ui.moodPicker({
            id: 'td-mood', label: 'How did today go?', value: null,
            onChange: (mood) => {
              if (!mood || picked) return;
              picked = true;
              setTimeout(() => { if (ctx.isActive()) ctx.go('journal', { new: true, date: today, mood }); }, 180);
            }
          });
          return h('section.card.td-journal', { attrs: { 'aria-labelledby': 'td-journal-q' } },
            head(h('button.btn.btn--ghost.btn--sm.td-journal__write', {
              type: 'button', attrs: { 'data-fk': 'journal-write' },
              onClick: () => ctx.go('journal', { new: true, date: today })
            }, ic('edit', 16), 'Write')),
            h('p.td-journal__q#td-journal-q', 'How did today go?'),
            picker,
            h('p.td-journal__hint', 'Tap a face to start today’s entry. It takes a minute and shows up in your journal.'));
        }
        const e = entries[0];
        const text = str(e.text);
        const title = str(e.title) || (text ? text.split('\n')[0].slice(0, 80) : 'Untitled note');
        const snippet = str(e.title) ? text : text.split('\n').slice(1).join(' ');
        const mood = num(e.mood) >= 1 && num(e.mood) <= 5 ? Math.round(num(e.mood)) : null;
        const tags = Array.isArray(e.tags) ? e.tags.slice(0, 3) : [];
        return h('section.card.td-journal.td-journal--has', { attrs: { 'aria-label': 'Journal' } },
          head(entries.length > 1
            ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onClick: () => ctx.go('journal', { date: today }) }, '+' + (entries.length - 1) + ' more')
            : null),
          h('button.td-entry', {
            type: 'button', attrs: { 'data-fk': 'journal-entry', 'aria-label': 'Open today’s journal entry: ' + title },
            onClick: () => ctx.go('journal', { id: e.id })
          },
          mood ? h('span.td-entry__mood', { dataset: { plate: MOOD_PLATE[mood] }, attrs: { 'aria-hidden': 'true' } }, ic('mood-' + mood, 28)) : null,
          h('span.td-entry__main',
            h('span.td-entry__title', title),
            snippet ? h('span.td-entry__text', snippet) : null,
            tags.length || e.pinned ? h('span.td-entry__tags',
              e.pinned ? h('span.badge', ic('pin', 12), 'Pinned') : null,
              tags.map((t) => h('span.badge', '#' + t))) : null),
          ic('chevron-right', 18, 'td-entry__chev')),
          h('button.btn.btn--ghost.btn--sm.td-journal__add', { type: 'button', onClick: () => ctx.go('journal', { new: true, date: today }) }, ic('plus', 16), 'Add another note'));
      }
    }, duo);

    /* ================================================================ last workout */
    function lastBefore() {
      const last = F.q.lastSession();
      if (!last) return { kind: 'none' };
      if (last.date !== today) return { kind: 'session', s: last };
      const earlier = F.q.sessionsBetween('0000-01-01', u.addDays(today, -1));
      return earlier.length ? { kind: 'session', s: earlier[earlier.length - 1] } : { kind: 'hidden' };
    }
    add({
      name: 'last',
      key: () => { const l = lastBefore(); return l.kind + (l.s ? '|' + l.s.id + '|' + l.s.endedAt + '|' + l.s.title : '') + '|' + S().settings.units; },
      build() {
        const l = lastBefore();
        if (l.kind === 'hidden') return h('div.td-slot', { hidden: true });
        if (l.kind === 'none') {
          const e = F.ui.empty({
            icon: 'dumbbell', title: 'No workouts yet',
            text: 'Your finished sessions land here with their time, volume and sets. Hit Start workout above to log your first one.'
          });
          e.classList.add('td-empty');
          return h('section.td-last-empty', { attrs: { 'aria-label': 'Last workout' } }, e);
        }
        const s = l.s;
        const st = F.q.sessionStats(s);
        const stat = (label, value) => h('span.td-last__stat', h('span.td-last__v', value), h('span.td-last__l', label));
        return h('button.card.card--interactive.card--plate.td-last', {
          type: 'button', dataset: { plate: plateOfSession(s) },
          attrs: { 'aria-label': 'Last workout: ' + str(s.title, 'Workout') + ', ' + relDay(s.date, today) + '. Open in history', 'data-fk': 'last' },
          onClick: () => ctx.go('progress', { tab: 'history', sessionId: s.id })
        },
        h('span.td-last__head',
          h('span.eyebrow', 'Last workout · ' + relDay(s.date, today)),
          ic('chevron-right', 18, 'td-last__chev')),
        h('span.td-last__title', str(s.title, 'Workout')),
        h('span.td-last__stats',
          stat('Time', u.fmtDuration(st.durationSec)),
          stat('Volume', st.volume > 0 ? u.fmtVolume(st.volume) : '—'),
          stat('Sets', String(st.sets))));
      }
    });

    /* ================================================================ quote of the day */
    add({
      name: 'quote',
      key: () => today,
      build() {
        let q = '';
        try { q = prog().quoteFor ? prog().quoteFor(today) : ''; } catch (_) { q = ''; }
        if (!q) return h('div.td-slot', { hidden: true });
        return h('figure.td-quote',
          h('figcaption.td-quote__cap', h('span.td-quote__tape', { attrs: { 'aria-hidden': 'true' } }), 'Quote of the day'),
          h('blockquote.td-quote__text', h('p', q)));
      }
    });

    /* ================================================================ about your split */
    add({
      name: 'split',
      key: () => u.DAY_KEYS.map((k) => { const d = F.q.dayPlan(k); return isRestDay(d) ? 'r' : plateOfDay(d) + ':' + dayTitle(d, k); }).join('|'),
      build() {
        const info = prog().splitInfo || {};
        const plates = u.DAY_KEYS.map((k) => {
          const d = F.q.dayPlan(k);
          const rest = isRestDay(d);
          return h('span.td-split__plate', { class: rest ? 'is-rest' : null, dataset: { plate: rest ? 'white' : plateOfDay(d) } });
        });
        const week = u.DAY_KEYS.map((k) => {
          const d = F.q.dayPlan(k);
          const rest = isRestDay(d);
          return h('li.td-wk', { class: rest ? 'is-rest' : null, dataset: { plate: rest ? 'white' : plateOfDay(d) } },
            h('span.td-wk__day', u.DAY_SHORT[k]),
            h('span.td-wk__dot', { attrs: { 'aria-hidden': 'true' } }),
            h('span.td-wk__title', rest ? 'Rest' : dayTitle(d, k)));
        });
        const list = (arr, tag) => h(tag + '.td-split__list', (Array.isArray(arr) ? arr : []).map((t) => h('li', String(t))));
        return h('details.card.td-split',
          h('summary.td-split__sum',
            h('span.td-split__plates', { attrs: { 'aria-hidden': 'true' } }, plates),
            h('span.td-split__titles',
              h('span.td-split__label', 'About your split'),
              h('span.td-split__name', info.name || 'Your weekly split')),
            ic('chevron-down', 20, 'td-split__chev')),
          h('div.td-split__body',
            Array.isArray(info.aka) && info.aka.length ? h('p.td-split__aka', h('span.eyebrow', 'Also called'), info.aka.map((a) => h('span.badge', a))) : null,
            info.summary ? h('p.td-split__summary', info.summary) : null,
            h('ul.td-wks.td-wks--split', week),
            h('h4.td-split__h', ic('sparkle', 16), 'Why it works'),
            list(info.why, 'ul'),
            h('h4.td-split__h', ic('arrow-up', 16), 'How to progress'),
            list(info.howToProgress, 'ol'),
            h('button.btn.btn--secondary.td-split__edit', { type: 'button', onClick: () => ctx.go('plan', { day: todayKey }) }, ic('calendar', 18), 'Edit your week')));
      }
    });

    /* ---------- subscriptions & timers */
    ctx.onState((state, reason) => {
      const r = String(reason || '').split(' ');
      if (!r.some((x) => REASONS.indexOf(x) >= 0)) return;
      for (const s of sections) refresh(s);
    });

    // Day rollover (app left open past midnight, or resumed next morning): rebuild for the new day.
    const rollover = () => { if (ctx.isActive() && u.todayISO() !== today) ctx.rerender(); };
    const dayTimer = setInterval(rollover, 30000);
    const onVis = () => { try { if (document.visibilityState === 'visible') rollover(); } catch (_) { /* ignore */ } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopClock();
      clearInterval(dayTimer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  F.router.register('today', { title: 'Today', nav: 'today', render });
})(window.Forge = window.Forge || {});
