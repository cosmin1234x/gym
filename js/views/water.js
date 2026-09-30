/* FORGE — js/views/water.js  [VIEW:water]  (SPEC §12 "water")
 *
 * Water tracker. Summary first: a big stylised gym-shaker bottle whose liquid (two offset SVG sine
 * waves) fills to today's % of goal, with a count-up ml read-out, % of goal, what is left and a pace
 * check. Then one-tap quick-add servings (a droplet falls into the bottle and splashes), a custom
 * amount stepper, today's log (newest first, delete + Undo), the last 7 days (bars with goal line,
 * streak, average, goals hit) and a practical pacing tip with a shortcut to the goal settings.
 *
 * Frequent interactions (adding / deleting drinks) patch the DOM surgically: the bottle level,
 * numbers and log rows update in place, so the custom-amount input keeps focus and animations stay
 * smooth. The goal-hit celebration fires once per day (meta.celebrated['water:<iso>']).
 */
(function (F) {
  'use strict';

  /* ------------------------------------------------------------------ constants */

  // Bottle geometry, in viewBox units (0 0 184 320).
  const VB_W = 184;
  const VB_H = 320;
  const TOP = 80;        // liquid level at 100 %
  const BOT = 308;       // bottom of the inside
  const WALL_T = 72;     // body top (under the collar)
  const WALL_B = 290;    // where the bottom rounding starts
  const BODY = 'M16 72H144L139 290Q138 308 120 308H40Q22 308 21 290Z';
  const WAVE_P = 62;     // wave period; the CSS keyframes shift exactly one period (seamless loop)
  const WAVE_A = 4.5;    // wave amplitude
  const DROP = 'M0 -13C3.6 -7.6 6.2 -4.2 6.2 0.6A6.2 6.2 0 0 1 -6.2 0.6C-6.2 -4.2 -3.6 -7.6 0 -13Z';

  const DAY_START = 7;   // waking window used for the pace check (07:00 – 22:00)
  const DAY_END = 22;
  const FALLBACK_SERVINGS = [250, 500, 750];

  let customMl = 300;    // the custom stepper remembers its value while the app is open
  let seq = 0;

  /* ------------------------------------------------------------------ small helpers */

  const U = () => F.util;
  const S = () => F.store.get();
  const num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
  const hasReason = (reason, keys) => {
    const parts = String(reason || '').split(' ');
    return keys.some((k) => parts.indexOf(k) >= 0);
  };
  const ic = (name, size, cls) => F.icon(name, { size: size || 20, cls: cls || '' });
  const mlText = (ml) => U().fmtNum(Math.max(0, Math.round(ml))) + ' ml';
  /** Short scale label: 500 → '500', 1000 → '1L', 2500 → '2.5L'. */
  const scaleLabel = (ml) => (ml >= 1000 ? U().fmtNum(ml / 1000, 1) + 'L' : String(ml));

  function reduced() {
    try { return U().reducedMotion(); } catch (_) { return false; }
  }

  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    if (reduced()) return;
    void el.getBoundingClientRect(); // reflow: restart the one-shot animation
    el.classList.add(cls);
  }

  function goalOf() {
    const g = num(S().settings && S().settings.waterGoal, 3000);
    return g > 0 ? g : 3000;
  }
  function servingsOf() {
    const raw = S().settings && S().settings.waterServings;
    const list = Array.isArray(raw) ? raw.map((x) => Math.round(num(x, 0))).filter((x) => x > 0 && x <= 5000) : [];
    const uniq = Array.from(new Set(list)).slice(0, 6);
    return uniq.length ? uniq : FALLBACK_SERVINGS.slice();
  }
  function entriesOf(iso) {
    const list = S().water && S().water[iso];
    return Array.isArray(list) ? list.filter((e) => e && e.id && num(e.ml, 0) > 0) : [];
  }

  /** Name + icon for a serving size (glass / bottle / shaker). */
  function kindOf(ml) {
    if (ml <= 300) return { name: 'Glass', icon: 'glass' };
    if (ml <= 600) return { name: 'Bottle', icon: 'bottle' };
    return { name: 'Shaker', icon: 'bottle' };
  }

  /** Where you should be by now (ml), or null outside the waking window. */
  function paceTarget(goal, now) {
    const d = now || new Date();
    const hrs = d.getHours() + d.getMinutes() / 60;
    if (hrs < DAY_START) return null;
    const f = Math.min(1, (hrs - DAY_START) / (DAY_END - DAY_START));
    return Math.round((goal * f) / 50) * 50;
  }

  /* ------------------------------------------------------------------ the bottle */

  /** Liquid surface y (viewBox units) for a fill fraction. Empty sits just below the bottom. */
  const levelY = (f) => (f <= 0 ? BOT + WAVE_A + 4 : BOT - Math.min(1, f) * (BOT - TOP));
  /** x of the right / left wall at height y (the body tapers slightly). */
  const wallR = (y) => 144 - (5 * (Math.min(WALL_B, Math.max(WALL_T, y)) - WALL_T)) / (WALL_B - WALL_T);
  const wallL = (y) => 16 + (5 * (Math.min(WALL_B, Math.max(WALL_T, y)) - WALL_T)) / (WALL_B - WALL_T);

  /** Periodic wave outline starting at x0, `periods` long; closed downwards when `depth` is given. */
  function wavePath(x0, periods, depth) {
    let d = 'M' + x0 + ' 0';
    for (let i = 0; i < periods * 2; i++) d += 'q' + WAVE_P / 4 + ' ' + (i % 2 ? WAVE_A : -WAVE_A) + ' ' + WAVE_P / 2 + ' 0';
    if (depth) d += 'V' + depth + 'H' + x0 + 'Z';
    return d;
  }

  function bottle() {
    const u = U();
    const h = u.h;
    const id = ++seq;
    const clip = 'wt-clip-' + id;
    const grad = 'wt-grad-' + id;
    const ridges = [];
    for (let x = 22; x <= 138; x += 8) ridges.push('M' + x + ' 53v14');
    // Trusted static markup: numbers and our own generated ids only.
    const svg = u.svgEl(
      '<svg class="wt-bottle__svg" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" role="img" focusable="false">' +
        '<defs>' +
          '<clipPath id="' + clip + '"><path d="' + BODY + '"/></clipPath>' +
          '<linearGradient id="' + grad + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop class="wt-stop-a" offset="0"/><stop class="wt-stop-b" offset="1"/>' +
          '</linearGradient>' +
        '</defs>' +
        // lid: carry loop, dome, spout + flip cap
        '<path class="wt-b__loop-o" d="M30 46C23 14 58 4 67 30"/>' +
        '<path class="wt-b__loop-i" d="M30 46C23 14 58 4 67 30"/>' +
        '<path class="wt-b__dome" d="M20 51C20 37 42 29 80 29C118 29 140 37 140 51Z"/>' +
        '<rect class="wt-b__spout" x="93" y="16" width="30" height="18" rx="5"/>' +
        '<rect class="wt-b__cap" x="88" y="9" width="40" height="10" rx="5"/>' +
        // body
        '<path class="wt-b__glass" d="' + BODY + '"/>' +
        '<g clip-path="url(#' + clip + ')">' +
          '<g class="wt-b__level">' +
            '<g class="wt-b__slosh">' +
              '<g class="wt-b__wave wt-b__wave--back"><path d="' + wavePath(8, 4, 440) + '" transform="translate(0 -3)"/></g>' +
              '<g class="wt-b__wave wt-b__wave--front">' +
                '<path class="wt-b__liquid" d="' + wavePath(8, 4, 440) + '" fill="url(#' + grad + ')"/>' +
                '<path class="wt-b__surface" d="' + wavePath(8, 4, 0) + '"/>' +
              '</g>' +
            '</g>' +
            '<g class="wt-b__bubbles">' +
              '<circle cx="46" cy="40" r="3" style="--rise:34;--d:0s"/>' +
              '<circle cx="104" cy="70" r="2.2" style="--rise:64;--d:1.1s"/>' +
              '<circle cx="72" cy="110" r="3.4" style="--rise:104;--d:2.2s"/>' +
              '<circle cx="118" cy="30" r="1.8" style="--rise:24;--d:.6s"/>' +
              '<circle cx="60" cy="150" r="2.4" style="--rise:144;--d:1.7s"/>' +
            '</g>' +
          '</g>' +
          '<g class="wt-b__drops"></g>' +
          '<path class="wt-b__shine" d="M31 94V284"/>' +
          '<path class="wt-b__shine wt-b__shine--thin" d="M43 98V150"/>' +
          '<text class="wt-b__brand" transform="translate(86 246) rotate(-90)" text-anchor="middle">FORGE</text>' +
          '<g class="wt-b__ticks"></g>' +
          '<g class="wt-b__pace-line"></g>' +
        '</g>' +
        '<path class="wt-b__outline" d="' + BODY + '"/>' +
        // collar with grip ridges
        '<rect class="wt-b__collar" x="12" y="48" width="136" height="24" rx="7"/>' +
        '<path class="wt-b__ridges" d="' + ridges.join('') + '"/>' +
        '<g class="wt-b__labels"></g>' +
        '<g class="wt-b__pace"></g>' +
      '</svg>');

    const stops = svg.querySelectorAll('stop');
    const level = svg.querySelector('.wt-b__level');
    const slosh = svg.querySelector('.wt-b__slosh');
    const drops = svg.querySelector('.wt-b__drops');
    const ticks = svg.querySelector('.wt-b__ticks');
    const labels = svg.querySelector('.wt-b__labels');
    const paceG = svg.querySelector('.wt-b__pace');
    const paceLine = svg.querySelector('.wt-b__pace-line');
    // gradient stops coloured by tokens (CSS classes can't reach <stop> colours in every engine)
    if (stops[0]) stops[0].style.stopColor = 'var(--water)';
    if (stops[1]) stops[1].style.stopColor = 'var(--water-2)';

    const el = h('div.wt-bottle', null, svg);
    let curY = levelY(0);
    let scaleGoal = null;
    let pendingTimer = null;

    function setY(y, delay) {
      curY = y;
      level.style.transitionDelay = (delay || 0) + 'ms';
      level.style.transform = 'translate(0px, ' + y.toFixed(2) + 'px)';
    }

    function drawScale(goal) {
      if (scaleGoal === goal) return;
      scaleGoal = goal;
      u.clear(ticks);
      u.clear(labels);
      const step = 500;
      const marks = [];
      for (let ml = step; ml < goal - 1; ml += step) marks.push(ml);
      marks.push(goal);
      const labelAll = goal <= 1500;
      let lastLabelY = -Infinity;
      // top (goal) first so crowded labels just below it are skipped
      marks.slice().reverse().forEach((ml) => {
        const y = +(BOT - (ml / goal) * (BOT - TOP)).toFixed(2);
        const isGoal = ml === goal;
        const major = isGoal || ml % 1000 === 0;
        const xr = wallR(y);
        ticks.appendChild(h('line', {
          class: ['wt-b__tick', major ? 'is-major' : null, isGoal ? 'is-goal' : null],
          x1: +(xr - (major ? 15 : 9)).toFixed(2), x2: +(xr + 2).toFixed(2), y1: y, y2: y
        }));
        if ((isGoal || major || labelAll) && y - lastLabelY >= 17) {
          labels.appendChild(h('text', {
            class: ['wt-b__label', isGoal ? 'is-goal' : null],
            x: +(xr + 6).toFixed(2), y: +(y + 5).toFixed(2)
          }, scaleLabel(ml)));
          lastLabelY = y;
        }
      });
    }

    /** Pace marker: a small arrow + dashed line at "where you should be by now". */
    function drawPace(targetMl, goal, show) {
      u.clear(paceG);
      u.clear(paceLine);
      if (!show || !(targetMl > 0)) return;
      const y = +(BOT - Math.min(1, targetMl / goal) * (BOT - TOP)).toFixed(2);
      const xl = wallL(y);
      paceG.appendChild(h('path', {
        class: 'wt-b__pace-arrow',
        d: 'M' + (xl - 13).toFixed(2) + ' ' + (y - 5.5) + 'L' + (xl - 2).toFixed(2) + ' ' + y + 'L' + (xl - 13).toFixed(2) + ' ' + (y + 5.5) + 'Z'
      }));
      paceLine.appendChild(h('line', { class: 'wt-b__pace-dash', x1: 18, x2: 142, y1: y, y2: y }));
    }

    /** Update level (fraction of goal), scale and states. `delay` lets a falling drop land first. */
    function set(ml, goal, opts) {
      const o = opts || {};
      const f = goal > 0 ? ml / goal : 0;
      drawScale(goal);
      el.classList.toggle('is-empty', ml <= 0);
      el.classList.toggle('is-full', f >= 1);
      svg.setAttribute('aria-label', 'Water bottle, ' + Math.round(f * 100) + '% of your daily goal');
      const y = levelY(f);
      clearTimeout(pendingTimer);
      if (o.instant) {
        level.classList.add('is-instant');
        setY(y, 0);
        void level.getBoundingClientRect();
        level.classList.remove('is-instant');
      } else {
        setY(y, o.delay || 0);
      }
      if (o.slosh) pendingTimer = setTimeout(() => replay(slosh, 'is-sloshing'), o.delay || 0);
    }

    /** A droplet falls from under the collar onto the liquid surface and splashes. */
    function drop() {
      if (reduced() || typeof svg.animate !== 'function') return 0;
      const x = 62 + Math.random() * 36;
      const land = Math.min(BOT - 6, curY);
      const dist = Math.max(0, land - (TOP - 4));
      const dur = Math.round(260 + Math.sqrt(dist) * 14);
      try {
        const g = h('g.wt-drop', null, h('path', { d: DROP }));
        drops.appendChild(g);
        const a = g.animate([
          { transform: 'translate(' + x + 'px, ' + (TOP - 10) + 'px) scale(.55, .7)', opacity: 0 },
          { transform: 'translate(' + x + 'px, ' + (TOP + 4) + 'px) scale(.8, .9)', opacity: 1, offset: 0.12 },
          { transform: 'translate(' + x + 'px, ' + land + 'px) scale(.85, 1.2)', opacity: 1 }
        ], { duration: dur, easing: 'cubic-bezier(.5, 0, .9, .5)', fill: 'forwards' });
        a.onfinish = () => { g.remove(); splash(x, land); };
        setTimeout(() => { if (g.isConnected) g.remove(); }, dur + 400);
      } catch (_) { return 0; }
      return dur;
    }

    function splash(x, y) {
      try {
        const ring = h('ellipse.wt-splash', { cx: 0, cy: 0, rx: 14, ry: 3.5 });
        const g = h('g', { transform: 'translate(' + x + ' ' + y + ')' }, ring);
        const bits = [-1, 1, 0].map((dir) => {
          const c = h('circle.wt-splash__bit', { cx: 0, cy: 0, r: dir === 0 ? 2.6 : 2 });
          g.appendChild(c);
          return [c, dir];
        });
        drops.appendChild(g);
        ring.animate([
          { transform: 'scale(.2)', opacity: 0.9 },
          { transform: 'scale(1.7)', opacity: 0 }
        ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        bits.forEach(([c, dir]) => {
          c.animate([
            { transform: 'translate(0px, 0px)', opacity: 1 },
            { transform: 'translate(' + dir * 9 + 'px, -16px)', opacity: 1, offset: 0.45 },
            { transform: 'translate(' + dir * 15 + 'px, 2px)', opacity: 0 }
          ], { duration: 520, easing: 'ease-out', fill: 'forwards' });
        });
        setTimeout(() => g.remove(), 620);
      } catch (_) { /* decorative only */ }
    }

    return { el, set, drop, drawPace };
  }

  /* ------------------------------------------------------------------ view */

  function render(el, params, ctx) {
    const u = U();
    const h = u.h;
    const store = F.store;
    let today = u.todayISO();

    el.classList.add('stagger');
    let order = 0;
    const put = (node) => { node.style.setProperty('--i', String(order++)); el.appendChild(node); return node; };

    // shared state for surgical updates
    let shownMl = F.q.waterTotal(today);
    let lastToast = null;
    let dropLandsAt = 0;

    /* ---------------------------------------------------------------- header */

    const titleFor = (ml, goal) => (ml >= goal ? 'Hydrated' : ml > 0 ? 'Keep sipping' : 'Fill the tank');
    const titleEl = h('h2.h1.wt-title', titleFor(shownMl, goalOf()));
    put(h('header.view-head.wt-head', null,
      h('div.view-head__titles', null,
        h('p.eyebrow', 'Water · ' + u.DAY_LONG[u.dayKeyOf(today)] + ' · ' + u.fmtDate(today, 'dm')),
        titleEl),
      h('div.view-head__actions', null,
        h('button.btn.btn--ghost.btn--sm.wt-head__goal', {
          type: 'button',
          attrs: { 'aria-label': 'Goal ' + u.fmtMl(goalOf()) + ': edit goal and servings' },
          onClick: () => ctx.go('settings', { section: 'water' })
        }, ic('target', 16), h('span.wt-head__goal-txt', 'Goal ' + u.fmtMl(goalOf()))))));
    const goalBtn = el.querySelector('.wt-head__goal');
    const goalBtnTxt = el.querySelector('.wt-head__goal-txt');

    /* ---------------------------------------------------------------- hero */

    const bot = bottle();
    const numEl = h('span.wt-read__num', u.fmtNum(0));
    const ofEl = h('span.wt-read__of');
    const pctEl = h('span.wt-read__pct');
    const leftN = h('span.wt-left__n');
    const leftL = h('span.wt-left__l');
    const leftIcon = h('span.wt-left__icon', { attrs: { 'aria-hidden': 'true' } }, ic('check-circle', 22));
    const leftEl = h('div.wt-left', null, leftIcon, h('span.wt-left__txt', null, leftN, leftL));
    const paceEl = h('span.badge.wt-pace');
    const lastEl = h('p.wt-read__last');
    const bigEl = h('p.wt-read__big', null, numEl, h('span.wt-read__unit', 'ml'));
    const read = h('div.wt-read', null,
      h('p.eyebrow.wt-read__eyebrow', null, ic('droplet', 14), 'Today'),
      bigEl,
      h('p.wt-read__goal', null, ofEl, pctEl),
      leftEl,
      h('div.wt-read__foot', null, paceEl, lastEl));

    const quickEl = h('div.wt-quick', { attrs: { role: 'group', 'aria-label': 'Quick add water' } });
    const stepper = F.ui.stepper({
      id: 'wt-custom', label: 'Custom amount', value: customMl, step: 50, min: 50, max: 5000, unit: 'ml',
      onChange: (v) => { if (v) customMl = v; }
    });
    const addBtn = h('button.btn.wt-custom__add', {
      type: 'button',
      attrs: { 'aria-label': 'Add custom amount of water' },
      onClick: () => {
        const v = Math.round(num(stepper.getValue(), customMl));
        if (!(v > 0)) { replay(stepper, 'shake'); return; }
        customMl = v;
        addWater(v, addBtn);
      }
    }, ic('plus', 20), 'Add');
    stepper.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setTimeout(() => addBtn.click(), 0); // the stepper commits on Enter first
    });

    const hero = put(h('section.card.card--hero.wt-hero', { attrs: { 'aria-label': 'Today’s water' } },
      h('div.wt-hero__top', null, bot.el, read),
      h('div.wt-hero__add', null,
        h('div.wt-hero__addhead', null,
          h('h3.wt-sub', 'Quick add'),
          h('span.wt-hint', 'One tap logs a drink')),
        quickEl,
        h('div.wt-custom', null, stepper, addBtn))));

    function buildQuick() {
      u.clear(quickEl);
      servingsOf().forEach((ml, i) => {
        const k = kindOf(ml);
        const b = h('button.wt-serve', {
          type: 'button',
          attrs: { 'aria-label': 'Add ' + u.fmtMl(ml) + ' (' + k.name.toLowerCase() + ')', 'data-ml': String(ml) },
          style: { '--i': i },
          onClick: () => addWater(ml, b)
        },
        h('span.wt-serve__icon', { attrs: { 'aria-hidden': 'true' } }, ic(k.icon, 24)),
        h('span.wt-serve__amt', null, h('span.wt-serve__plus', '+'),
          ml >= 1000 ? u.fmtNum(ml / 1000, 2) : u.fmtNum(ml), h('span.wt-serve__unit', ml >= 1000 ? 'L' : 'ml')),
        h('span.wt-serve__name', k.name));
        quickEl.appendChild(b);
      });
      const n = quickEl.childElementCount;
      quickEl.style.setProperty('--cols', String(n <= 3 ? n : n === 4 ? 2 : 3));
      quickEl.style.setProperty('--n', String(n));
      quickEl.dataset.sig = servingsOf().join(',');
    }
    buildQuick();

    /* ---------------------------------------------------------------- week + log */

    const grid = put(h('div.wt-grid'));

    // Last 7 days
    const kStreak = h('span.wt-kpi__v');
    const kStreakUnit = h('span.wt-kpi__unit', 'days');
    const kStreakIcon = h('span.wt-kpi__flame', { attrs: { 'aria-hidden': 'true' } }, ic('flame', 18));
    const kAvg = h('span.wt-kpi__v');
    const kHit = h('span.wt-kpi__v');
    const chartHost = h('div.wt-chart');
    const weekSub = h('span.wt-hint');
    grid.appendChild(h('section.card.wt-week', { attrs: { 'aria-label': 'Last 7 days' } },
      h('div.wt-sechead', null, h('h3.wt-sub', 'Last 7 days'), weekSub),
      h('div.wt-kpis', null,
        h('div.wt-kpi', null, h('span.wt-kpi__label', 'Streak'), h('span.wt-kpi__val', null, kStreakIcon, kStreak, kStreakUnit)),
        h('div.wt-kpi', null, h('span.wt-kpi__label', 'Daily avg'), h('span.wt-kpi__val', null, kAvg)),
        h('div.wt-kpi', null, h('span.wt-kpi__label', 'Goals hit'), h('span.wt-kpi__val', null, kHit, h('span.wt-kpi__unit', '/ 7')))),
      chartHost));

    // Today's log
    const logCount = h('span.wt-hint');
    const listEl = h('ul.list.wt-log__list', { attrs: { 'aria-label': 'Drinks logged today' } });
    const emptyHost = h('div.wt-log__empty');
    grid.appendChild(h('section.wt-log', { attrs: { 'aria-label': 'Today’s log' } },
      h('div.wt-sechead', null, h('h3.wt-sub', 'Today’s log'), logCount),
      listEl,
      emptyHost));

    /* ---------------------------------------------------------------- tip + settings link */

    const tipText = h('p.wt-tip__text');
    put(h('footer.wt-tip', null,
      h('span.wt-tip__icon', { attrs: { 'aria-hidden': 'true' } }, ic('clock', 20)),
      tipText,
      h('button.btn.btn--ghost.btn--sm.wt-tip__link', { type: 'button', onClick: () => ctx.go('settings', { section: 'water' }) },
        ic('settings', 16), 'Edit goal & servings')));

    /* ---------------------------------------------------------------- actions */

    function addWater(ml, sourceEl) {
      const goal = goalOf();
      const before = F.q.waterTotal(today);
      const entry = store.addWater(ml, today);
      if (!entry) { replay(sourceEl, 'shake'); return; }
      u.haptic(12);
      if (sourceEl) replay(sourceEl, 'is-hit');
      const fall = bot.drop();
      dropLandsAt = fall ? performance.now() + fall : 0;
      const after = before + entry.ml;
      if (lastToast) lastToast.close(); // one live toast: Undo always targets the latest drink
      lastToast = F.ui.toast('+' + mlText(entry.ml) + ' · ' + u.fmtNum(after) + ' of ' + mlText(goal), {
        type: 'ok', icon: 'droplet',
        action: { label: 'Undo', onClick: () => store.removeWater(today, entry.id) }
      });
      const key = 'water:' + today;
      const celebrated = (S().meta && S().meta.celebrated) || {};
      if (before < goal && after >= goal && !celebrated[key]) {
        store.markCelebrated(key);
        setTimeout(() => {
          F.ui.celebrate({ title: 'HYDRATED', subtitle: u.fmtMl(goal) + ' goal hit', icon: 'droplet', plate: 'blue' });
          u.beep('done');
        }, reduced() ? 0 : (fall || 0) + 520);
      }
    }

    function deleteEntry(entry, row) {
      const btn = row && row.querySelector('.wt-row__del');
      if (btn) btn.disabled = true;
      const go = () => {
        const removed = store.removeWater(today, entry.id);
        if (!removed) return;
        u.haptic(8);
        if (lastToast) lastToast.close();
        lastToast = F.ui.toast('Removed ' + mlText(removed.ml) + ' (' + u.fmtTime(removed.at) + ')', {
          icon: 'trash',
          action: { label: 'Undo', onClick: () => store.restoreWater(today, removed) }
        });
      };
      if (row && !reduced()) {
        row.classList.add('is-leaving');
        setTimeout(go, 200);
      } else {
        go();
      }
    }

    /* ---------------------------------------------------------------- updates */

    function updateRead(animateFrom) {
      const goal = goalOf();
      const ml = F.q.waterTotal(today);
      const entries = entriesOf(today);
      const pct = Math.round((ml / goal) * 100);
      const hit = ml >= goal;

      const fmt = (n) => u.fmtNum(Math.round(n));
      bigEl.classList.toggle('is-long', fmt(ml).length > 5);
      if (animateFrom !== undefined && animateFrom !== ml) {
        u.countUp(numEl, ml, { from: animateFrom, duration: 650, format: fmt });
        if (ml > animateFrom) replay(bigEl, 'is-bump');
      } else {
        numEl.textContent = fmt(ml);
      }
      shownMl = ml;
      ofEl.textContent = 'of ' + mlText(goal);
      pctEl.textContent = pct + '%';
      read.classList.toggle('is-hit', hit);
      hero.classList.toggle('is-hit', hit);
      titleEl.textContent = titleFor(ml, goal);
      if (goalBtnTxt) goalBtnTxt.textContent = 'Goal ' + u.fmtMl(goal);
      if (goalBtn) goalBtn.setAttribute('aria-label', 'Goal ' + u.fmtMl(goal) + ': edit goal and servings');

      if (hit) {
        leftN.textContent = 'Goal smashed';
        leftL.textContent = ml > goal ? '+' + mlText(ml - goal) + ' extra' : 'Right on target';
      } else {
        leftN.textContent = mlText(goal - ml);
        leftL.textContent = 'to go';
      }
      leftEl.classList.toggle('is-hit', hit);

      // pace: where you should be by now inside the 07:00–22:00 window
      const target = paceTarget(goal);
      paceEl.className = 'badge wt-pace';
      if (hit) {
        paceEl.hidden = true;
      } else if (target === null) {
        paceEl.hidden = false;
        paceEl.classList.add('wt-pace--early');
        paceEl.textContent = 'Day starts 07:00';
      } else if (ml <= 0) {
        paceEl.hidden = false;
        paceEl.classList.add('wt-pace--early');
        paceEl.textContent = target > 0 ? 'Aim: ' + mlText(target) + ' by now' : 'Fresh start';
      } else if (ml >= target - 100) {
        paceEl.hidden = false;
        paceEl.classList.add('badge--ok');
        paceEl.textContent = ml >= target + 250 ? 'Ahead of pace' : 'On pace';
      } else {
        paceEl.hidden = false;
        paceEl.classList.add('badge--warn');
        paceEl.textContent = mlText(target - ml) + ' behind pace';
      }
      paceEl.title = target === null ? '' : 'Pace: ' + mlText(target) + ' by now (07:00–22:00)';
      bot.drawPace(target, goal, !hit && target !== null && target > 0);

      const last = entries.length ? entries[entries.length - 1] : null;
      lastEl.textContent = last ? 'Last drink ' + u.fmtTime(last.at) : 'No drinks logged yet';

      return { ml, goal };
    }

    function updateBottle(opts) {
      const goal = goalOf();
      const ml = F.q.waterTotal(today);
      const o = opts || {};
      const delay = dropLandsAt ? Math.max(0, dropLandsAt - performance.now()) : 0;
      dropLandsAt = 0;
      bot.set(ml, goal, { delay: Math.round(delay), slosh: !!o.slosh, instant: !!o.instant });
    }

    // Log rows keyed by entry id so adds / deletes / undos patch in place.
    const rows = new Map();
    let logBuilt = false;
    function rowFor(entry) {
      const k = kindOf(entry.ml);
      const amt = h('span.wt-row__amt');
      const sub = h('span.list-row__sub.wt-row__sub');
      let stamp = null;
      try { stamp = new Date(entry.at).toISOString(); } catch (_) { stamp = null; }
      const time = h('time.wt-row__time', { attrs: { datetime: stamp } }, u.fmtTime(entry.at));
      const li = h('li.wt-row', null,
        h('div.list-row', null,
          h('span.wt-row__icon', { attrs: { 'aria-hidden': 'true' } }, ic(k.icon, 20)),
          h('div.list-row__main', null, amt, sub),
          h('span.list-row__meta', null, time),
          h('button.btn.btn--ghost.btn--icon.btn--sm.wt-row__del', {
            type: 'button',
            attrs: { 'aria-label': 'Delete ' + u.fmtMl(entry.ml) + ' logged at ' + u.fmtTime(entry.at) },
            onClick: () => deleteEntry(entry, li)
          }, ic('trash', 18))));
      li._refs = { amt, sub };
      return li;
    }
    function updateLog() {
      const entries = entriesOf(today);
      const running = new Map();
      let t = 0;
      entries.forEach((e) => { t += num(e.ml, 0); running.set(e.id, t); });
      const newest = entries.slice().reverse();
      const ids = new Set(newest.map((e) => e.id));

      rows.forEach((li, id) => { if (!ids.has(id)) { li.remove(); rows.delete(id); } });
      let prev = null;
      newest.forEach((e, i) => {
        let li = rows.get(e.id);
        if (!li) {
          li = rowFor(e);
          rows.set(e.id, li);
          if (logBuilt) li.classList.add('is-new');
          else li.style.setProperty('--i', String(i));
        }
        const k = kindOf(e.ml);
        li._refs.amt.textContent = '+' + mlText(e.ml);
        li._refs.sub.textContent = k.name + ' · total ' + mlText(running.get(e.id));
        const want = prev ? prev.nextSibling : listEl.firstChild;
        if (want !== li) listEl.insertBefore(li, want);
        prev = li;
      });
      listEl.classList.toggle('stagger', !logBuilt);
      logBuilt = true;

      const n = entries.length;
      listEl.hidden = n === 0;
      logCount.textContent = n ? n + (n === 1 ? ' drink · ' : ' drinks · ') + u.fmtMl(t) : '';
      if (n === 0) {
        if (!emptyHost.firstChild) {
          const first = servingsOf()[0];
          emptyHost.appendChild(F.ui.empty({
            icon: 'droplet',
            title: 'Nothing logged yet',
            text: 'Every drink you add shows up here with its time and your running total. Start with a glass now.',
            action: { label: 'Add ' + u.fmtMl(first), icon: 'plus', onClick: () => addWater(first, null) }
          }));
        }
        emptyHost.hidden = false;
      } else {
        u.clear(emptyHost);
        emptyHost.hidden = true;
      }
    }

    let weekSig = '';
    function updateWeek(quiet) {
      const goal = goalOf();
      const days = F.q.waterDays(7, today);
      const sig = goal + '|' + days.map((d) => d.ml).join(',');
      const firstUse = (F.q.firstUse && F.q.firstUse()) || today;

      // KPIs
      const streak = F.q.waterStreak();
      kStreak.textContent = String(streak);
      kStreakUnit.textContent = streak === 1 ? 'day' : 'days';
      kStreakIcon.classList.toggle('is-lit', streak > 0);
      const prior = F.q.waterDays(7, u.addDays(today, -1)).filter((d) => d.ml > 0 || d.iso >= firstUse);
      const avg = prior.length ? prior.reduce((a, d) => a + d.ml, 0) / prior.length : 0;
      kAvg.textContent = prior.length && avg > 0 ? u.fmtMl(Math.round(avg / 10) * 10) : '—';
      kAvg.title = 'Average per day over the 7 days before today';
      const hits = days.filter((d) => d.hit).length;
      kHit.textContent = String(hits);
      weekSub.textContent = u.fmtDate(days[0].iso, 'dm') + ' – ' + u.fmtDate(today, 'dm');

      if (sig === weekSig) return;
      weekSig = sig;
      const fmtY = (v) => (v >= 1000 ? u.fmtNum(v / 1000, 1) + 'L' : v > 0 ? u.fmtNum(v) : '0');
      const chart = F.charts.bars({
        height: 164,
        goal,
        fmtY,
        color: 'var(--water)',
        bars: days.map((d) => {
          const isT = d.iso === today;
          return {
            label: isT ? 'Today' : u.fmtDate(d.iso, 'wd'),
            value: d.ml,
            highlight: isT,
            color: isT ? 'var(--water)'
              : d.hit ? 'color-mix(in srgb, var(--water) 72%, var(--surface-3))'
                : 'color-mix(in srgb, var(--water) 34%, var(--surface-3))',
            title: u.fmtDate(d.iso, 'short') + ': ' + u.fmtMl(d.ml) + (d.hit ? ' — goal hit' : '')
          };
        }),
        emptyText: 'Your week fills in as you log water.'
      });
      chartHost.classList.toggle('is-quiet', !!quiet);
      u.clear(chartHost).appendChild(chart);
    }

    function updateTip() {
      const goal = goalOf();
      const ml = F.q.waterTotal(today);
      if (ml >= goal) {
        tipText.textContent = 'Goal done. Keep sipping to thirst, and add about 500 ml for every hour of hard training.';
        return;
      }
      const per = Math.max(50, Math.round(goal / 8 / 25) * 25);
      const hrs = (DAY_END - DAY_START) / 8;
      const every = hrs >= 1.75 && hrs <= 2.25 ? '2 hours' : u.fmtNum(hrs, 1) + ' h';
      tipText.textContent = 'Split ' + mlText(goal) + ' into 8 drinks of ~' + mlText(per) +
        ': one every ' + every + ' from 07:00 keeps you on pace.';
    }

    /* ---------------------------------------------------------------- first paint */

    const first = updateRead();
    updateLog();
    updateWeek(false);
    updateTip();
    // Pour the level in from empty (CSS transition); the number counts up alongside.
    bot.set(0, first.goal, { instant: true });
    if (reduced()) {
      updateBottle({ instant: true });
    } else {
      u.countUp(numEl, first.ml, { from: 0, duration: 900, format: (n) => u.fmtNum(Math.round(n)) });
      requestAnimationFrame(() => requestAnimationFrame(() => { if (ctx.isActive()) updateBottle(); }));
    }

    /* ---------------------------------------------------------------- subscriptions */

    ctx.onState((state, reason) => {
      if (u.todayISO() !== today) { ctx.rerender(); return; }
      const water = hasReason(reason, ['water']);
      const settings = hasReason(reason, ['settings']);
      if (!water && !settings) return;
      if (settings && quickEl.dataset.sig !== servingsOf().join(',')) buildQuick();
      const prevMl = shownMl;
      updateRead(prevMl);
      updateBottle({ slosh: water && F.q.waterTotal(today) > prevMl });
      updateLog();
      updateWeek(true);
      updateTip();
    });

    // Once a minute: roll over at midnight and keep the pace check honest.
    const tick = setInterval(() => {
      if (!ctx.isActive()) return;
      if (u.todayISO() !== today) { ctx.rerender(); return; }
      updateRead(); // also redraws the pace marker
    }, 60000);

    return () => { clearInterval(tick); lastToast = null; };
  }

  F.router.register('water', { title: 'Water', nav: 'water', render });
})(window.Forge = window.Forge || {});
