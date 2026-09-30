/* FORGE charts — F.charts (SPEC §9.2). Small, dependency-free SVG charts that
   re-render at their real pixel width (crisp text), use token colours only,
   draw in on mount (unless reduced motion) and degrade to friendly empty states. */
(function (F) {
  'use strict';

  /* ------------------------------------------------------------ helpers */

  const NS = 'http://www.w3.org/2000/svg';
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LEVEL_MIX = [0, 38, 60, 80, 100]; // % of accent per heatmap level

  const h = (...args) => F.util.h(...args);
  const icon = (name, opts) => (F.icon ? F.icon(name, opts) : document.createElement('span'));

  /** Create an SVG element; `style` may be an object of CSS properties (tokens welcome). */
  function s(tag, attrs, ...children) {
    const el = document.createElementNS(NS, tag);
    const a = attrs || {};
    Object.keys(a).forEach((k) => {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'style' && typeof v === 'object') {
        Object.keys(v).forEach((p) => { if (v[p] !== null && v[p] !== undefined) el.style.setProperty(p, String(v[p])); });
      } else {
        el.setAttribute(k, String(v));
      }
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  const title = (text) => s('title', null, String(text));

  function reducedMotion() {
    try {
      if (F.util && typeof F.util.reducedMotion === 'function') return !!F.util.reducedMotion();
    } catch (_) { /* fall through */ }
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  let seq = 0;
  const uid = (p) => 'fgc-' + p + '-' + (++seq).toString(36);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const textW = (str, px) => String(str).length * (px || 11) * 0.56; // condensed label font estimate

  function safeFmt(fn, v, fallback) {
    try {
      const out = fn(v);
      return out === null || out === undefined ? '' : String(out);
    } catch (_) { return fallback !== undefined ? fallback : String(v); }
  }

  // Local-date helpers (ISO 'YYYY-MM-DD'); DST-safe day numbers.
  function dayNum(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 864e5);
  }
  function isoFromDayNum(n) {
    const d = new Date(n * 864e5);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const monIndex = (iso) => (((dayNum(iso) + 3) % 7) + 7) % 7; // 0 = Monday (day 0 = Thu 1 Jan 1970)
  function todayISO() {
    try { if (F.util && F.util.todayISO) return F.util.todayISO(); } catch (_) { /* fall back */ }
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(iso, style) {
    try { if (F.util && F.util.fmtDate) return F.util.fmtDate(iso, style); } catch (_) { /* fall back */ }
    const [, m, d] = iso.split('-').map(Number);
    return d + ' ' + MONTHS[m - 1];
  }

  /** "Nice" axis: rounded bounds and 2–5 ticks. */
  function niceScale(lo, hi, count) {
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (hi === lo) { const pad = Math.abs(hi) * 0.2 || 1; lo -= pad; hi += pad; }
    const raw = (hi - lo) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = min; v <= max + step / 2; v += step) ticks.push(r2(v));
    return { min, max: max === min ? min + step : max, ticks };
  }

  function emptyState(text, height) {
    const el = h('div.chart-empty', null, icon('chart', { size: 26 }), h('span', null, text || 'No data yet'));
    el.style.setProperty('--h', Math.round(height || 120) + 'px');
    return el;
  }

  /**
   * Render `draw(width, animate)` into `root` now (at a guessed width) and again
   * whenever the root's real width changes. Only the first real-width render
   * animates. `deferred` renders from rAF (for charts whose height depends on width).
   */
  function mount(root, draw, guessW, deferred) {
    let lastW = 0;
    let settled = false;
    let queued = false;
    const render = (w, animate) => {
      lastW = w;
      let out = null;
      try { out = draw(w, animate && !reducedMotion()); } catch (err) { console.error('[forge/charts]', err); }
      root.replaceChildren(...(out ? [].concat(out) : []));
    };
    render(guessW, true);
    if (typeof ResizeObserver !== 'function') return;
    new ResizeObserver((entries) => {
      const w = Math.floor(entries[entries.length - 1].contentRect.width);
      if (!w) return; // hidden (display:none) — wait until it has a width
      if (Math.abs(w - lastW) < 2) { settled = true; return; }
      if (queued) return;
      const run = () => { queued = false; render(Math.floor(root.getBoundingClientRect().width) || w, !settled); settled = true; };
      if (deferred || settled) { queued = true; requestAnimationFrame(run); } else run();
    }).observe(root);
  }

  const plateVar = (p) => {
    const name = F.ui && F.ui.plateOf ? F.ui.plateOf(p) : p;
    return name ? 'var(--plate-' + name + ')' : null;
  };
  function dot(plate) {
    if (F.ui && F.ui.plateDot) return F.ui.plateDot(plate);
    return h('span.plate-dot', { attrs: { 'aria-hidden': 'true' } });
  }

  /* ------------------------------------------------------------ line */

  function line(opts) {
    const o = opts || {};
    const H = clamp(num(o.height) || 180, 90, 640);
    const color = o.color || 'var(--accent)';
    const fmtY = typeof o.fmtY === 'function' ? o.fmtY : String;
    const fmtX = typeof o.fmtX === 'function' ? o.fmtX
      : (x) => (typeof x === 'string' && ISO_RE.test(x) ? fmtDate(x, 'dm') : String(x));
    const pts = (Array.isArray(o.points) ? o.points : [])
      .filter((p) => p && isFinite(num(p.y)))
      .map((p) => ({ x: p.x, y: num(p.y), label: p.label }));
    const root = h('div.chart.chart--line');
    if (!pts.length) { root.appendChild(emptyState(o.emptyText || 'No data yet — log a session to start the line.', H * 0.7)); return root; }

    const allIso = pts.every((p) => typeof p.x === 'string' && ISO_RE.test(p.x));
    const allNum = !allIso && pts.every((p) => isFinite(num(p.x)));
    const xs = pts.map((p, i) => (allIso ? dayNum(p.x) : allNum ? num(p.x) : i));
    const ys = pts.map((p) => p.y);
    const goal = num(o.goal);
    const hasGoal = isFinite(goal);
    const last = pts[pts.length - 1];
    const tip = (p) => p.label || (safeFmt(fmtX, p.x) + ': ' + safeFmt(fmtY, p.y));

    mount(root, (W, animate) => {
      let lo = Math.min(...ys, hasGoal ? goal : Infinity);
      const hi = Math.max(...ys, hasGoal ? goal : -Infinity);
      if (lo > 0 && lo < hi * 0.4) lo = 0; // widely spread positive data: anchor at zero
      const sc = niceScale(lo, hi, H < 150 ? 3 : 4);
      const yLabels = sc.ticks.map((t) => safeFmt(fmtY, t));
      const padL = clamp(Math.max(...yLabels.map((l) => textW(l))) + 12, 24, 72);
      const padR = 14;
      const padT = 18;
      const padB = 24;
      const pw = Math.max(20, W - padL - padR);
      const ph = H - padT - padB;
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const X = (x) => r2(padL + (x1 === x0 ? pw / 2 : ((x - x0) / (x1 - x0)) * pw));
      const Y = (y) => r2(padT + (1 - (y - sc.min) / (sc.max - sc.min)) * ph);
      const gradId = uid('grad');

      const svg = s('svg', {
        class: 'chart__svg' + (animate ? ' chart--anim' : ''),
        viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H,
        role: 'img',
        'aria-label': 'Line chart, ' + pts.length + (pts.length === 1 ? ' point' : ' points') +
          ', from ' + safeFmt(fmtX, pts[0].x) + ' to ' + safeFmt(fmtX, last.x) + '. Latest ' + safeFmt(fmtY, last.y) +
          ', best ' + safeFmt(fmtY, Math.max(...ys)) + (hasGoal ? ', goal ' + safeFmt(fmtY, goal) : '') + '.',
        style: { height: H + 'px' }
      });
      svg.appendChild(s('defs', null,
        s('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 },
          s('stop', { offset: '0%', style: { 'stop-color': color, 'stop-opacity': 0.34 } }),
          s('stop', { offset: '100%', style: { 'stop-color': color, 'stop-opacity': 0 } }))));

      // grid + y labels
      sc.ticks.forEach((t, i) => {
        svg.appendChild(s('line', { class: i === 0 ? 'chart__base' : 'chart__grid', x1: padL, x2: W - padR, y1: Y(t), y2: Y(t) }));
        svg.appendChild(s('text', { x: padL - 8, y: Y(t) + 4, 'text-anchor': 'end' }, yLabels[i]));
      });

      // x labels: greedy, non-overlapping, always keeping the last point
      const minGap = 58;
      const keep = [];
      pts.forEach((p, i) => {
        const px = X(xs[i]);
        if (!keep.length || px - X(xs[keep[keep.length - 1]]) >= minGap) keep.push(i);
      });
      const lastI = pts.length - 1;
      if (keep[keep.length - 1] !== lastI) {
        if (keep.length > 1 && X(xs[lastI]) - X(xs[keep[keep.length - 1]]) < minGap) keep.pop();
        keep.push(lastI);
      }
      keep.forEach((i) => {
        const px = X(xs[i]);
        const anchor = pts.length === 1 ? 'middle' : px - padL < 24 ? 'start' : W - padR - px < 24 ? 'end' : 'middle';
        svg.appendChild(s('text', { x: px, y: H - 6, 'text-anchor': anchor }, safeFmt(fmtX, pts[i].x)));
      });

      // goal
      if (hasGoal) {
        const gy = Y(goal);
        svg.appendChild(s('line', { class: 'chart__goal', x1: padL, x2: W - padR, y1: gy, y2: gy }, title('Goal: ' + safeFmt(fmtY, goal))));
        svg.appendChild(s('text', { class: 'chart__goal-label', x: padL + 4, y: gy - 5 }, 'GOAL ' + safeFmt(fmtY, goal)));
      }

      // area + line
      if (pts.length > 1) {
        const d = pts.map((p, i) => (i ? 'L' : 'M') + X(xs[i]) + ' ' + Y(p.y)).join(' ');
        if (o.area !== false) {
          svg.appendChild(s('path', {
            class: 'chart__area',
            d: d + ' L' + X(xs[lastI]) + ' ' + (padT + ph) + ' L' + X(xs[0]) + ' ' + (padT + ph) + ' Z',
            fill: 'url(#' + gradId + ')'
          }));
        }
        svg.appendChild(s('path', { class: 'chart__line', d, pathLength: 1, style: { stroke: color } }));
      }

      // dots (with generous invisible hit targets for the <title> tooltips)
      const showDots = o.dots !== false && pts.length <= 60;
      pts.forEach((p, i) => {
        const isLast = i === lastI;
        if (!showDots && !isLast) return;
        const cx = X(xs[i]);
        const cy = Y(p.y);
        svg.appendChild(s('g', null,
          title(tip(p)),
          s('circle', { class: 'chart__hit', cx, cy, r: 12 }),
          s('circle', {
            class: 'chart__dot' + (isLast ? ' chart__dot--last' : ''), cx, cy, r: isLast ? 5 : 3.5,
            style: { fill: isLast ? color : 'var(--surface)', stroke: isLast ? 'var(--surface)' : color, '--i': i }
          })));
      });

      // latest value tag
      const lx = X(xs[lastI]);
      const ly = Y(last.y);
      const tag = safeFmt(fmtY, last.y);
      const tw = textW(tag, 12);
      const tx = clamp(lx, padL + tw / 2, W - padR - tw / 2 + 8);
      svg.appendChild(s('text', { class: 'chart__tag', x: tx, y: ly - 12 < 10 ? ly + 20 : ly - 12, 'text-anchor': 'middle' }, tag));

      if (pts.length === 1) {
        return [svg, h('p.chart__note', null, 'One session logged — the trend line appears after the next one.')];
      }
      return svg;
    }, 340);
    return root;
  }

  /* ------------------------------------------------------------ bars */

  function bars(opts) {
    const o = opts || {};
    const H = clamp(num(o.height) || 150, 90, 600);
    const fmtY = typeof o.fmtY === 'function' ? o.fmtY : String;
    const base = o.color || 'var(--accent)';
    const list = (Array.isArray(o.bars) ? o.bars : []).filter(Boolean).map((b) => ({
      label: b.label === null || b.label === undefined ? '' : String(b.label),
      value: Math.max(0, num(b.value) || 0),
      plate: b.plate,
      color: b.color,
      highlight: !!b.highlight,
      title: b.title
    }));
    const root = h('div.chart.chart--bars');
    if (!list.length) { root.appendChild(emptyState(o.emptyText || 'Nothing to show yet.', H * 0.7)); return root; }

    const goal = num(o.goal);
    const hasGoal = isFinite(goal) && goal > 0;
    const anyHi = list.some((b) => b.highlight);
    const fill = (b) => b.color || plateVar(b.plate) ||
      (b.highlight || !anyHi ? base : 'color-mix(in srgb, ' + base + ' 45%, var(--surface-3))');

    mount(root, (W, animate) => {
      const top = Math.max(...list.map((b) => b.value), hasGoal ? goal : 0);
      const sc = niceScale(0, top > 0 ? top : 1, H < 140 ? 2 : 3);
      const yLabels = sc.ticks.map((t) => safeFmt(fmtY, t));
      const padL = clamp(Math.max(...yLabels.map((l) => textW(l))) + 10, 22, 72);
      const padR = 6;
      const padT = 20;
      const padB = 24;
      const pw = Math.max(20, W - padL - padR);
      const ph = H - padT - padB;
      const n = list.length;
      const band = pw / n;
      const bw = clamp(band * 0.62, 3, 46);
      const Y = (v) => r2(padT + (1 - (v - sc.min) / (sc.max - sc.min)) * ph);
      const bottom = padT + ph;

      const svg = s('svg', {
        class: 'chart__svg' + (animate ? ' chart--anim' : ''),
        viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img',
        'aria-label': 'Bar chart: ' + list.map((b) => b.label + ' ' + safeFmt(fmtY, b.value)).join(', ') +
          (hasGoal ? '. Goal ' + safeFmt(fmtY, goal) : ''),
        style: { height: H + 'px' }
      });

      sc.ticks.forEach((t, i) => {
        svg.appendChild(s('line', { class: i === 0 ? 'chart__base' : 'chart__grid', x1: padL, x2: W - padR, y1: Y(t), y2: Y(t) }));
        svg.appendChild(s('text', { x: padL - 8, y: Y(t) + 4, 'text-anchor': 'end' }, yLabels[i]));
      });

      // label thinning when bands are narrow
      const labelEvery = Math.max(1, Math.ceil(Math.max(...list.map((b) => textW(b.label))) / Math.max(1, band - 4)));
      const valueFits = list.every((b) => textW(safeFmt(fmtY, b.value), 10.5) <= band - 2);

      list.forEach((b, i) => {
        const cx = padL + band * i + band / 2;
        const x = r2(cx - bw / 2);
        const tip = b.title || (b.label + ': ' + safeFmt(fmtY, b.value));
        const g = s('g', null, title(tip), s('rect', { class: 'chart__hit', x: r2(padL + band * i), y: padT, width: r2(band), height: ph }));
        if (b.value > 0) {
          const y = Y(b.value);
          const hgt = Math.max(2, bottom - y);
          const rad = Math.min(6, bw / 2, hgt);
          const d = 'M' + x + ' ' + bottom + ' V' + r2(bottom - hgt + rad) +
            ' Q' + x + ' ' + r2(bottom - hgt) + ' ' + r2(x + rad) + ' ' + r2(bottom - hgt) +
            ' H' + r2(x + bw - rad) + ' Q' + r2(x + bw) + ' ' + r2(bottom - hgt) + ' ' + r2(x + bw) + ' ' + r2(bottom - hgt + rad) +
            ' V' + bottom + ' Z';
          g.appendChild(s('path', { class: 'chart__bar', d, style: { fill: fill(b), '--i': i } }));
        } else {
          g.appendChild(s('rect', { class: 'chart__bar', x, y: bottom - 2, width: r2(bw), height: 2, rx: 1, style: { fill: 'var(--line-strong)', '--i': i } }));
        }
        if ((valueFits && b.value > 0) || b.highlight) {
          g.appendChild(s('text', {
            class: 'chart__value' + (b.highlight ? ' chart__value--hi' : ''),
            x: r2(cx), y: Math.max(11, (b.value > 0 ? Y(b.value) : bottom) - 6), 'text-anchor': 'middle'
          }, safeFmt(fmtY, b.value)));
        }
        if (i % labelEvery === 0 || b.highlight || i === n - 1) {
          g.appendChild(s('text', { class: b.highlight ? 'chart__xlabel--hi' : null, x: r2(cx), y: H - 6, 'text-anchor': 'middle' }, b.label));
        }
        svg.appendChild(g);
      });

      if (hasGoal) {
        const gy = Y(goal);
        svg.appendChild(s('line', { class: 'chart__goal', x1: padL, x2: W - padR, y1: gy, y2: gy }, title('Goal: ' + safeFmt(fmtY, goal))));
        svg.appendChild(s('text', { class: 'chart__goal-label', x: W - padR, y: gy - 5, 'text-anchor': 'end' }, 'GOAL'));
      }
      return svg;
    }, 340);
    return root;
  }

  /* ------------------------------------------------------------ hbars (HTML) */

  function hbars(opts) {
    const o = opts || {};
    const fmt = typeof o.fmt === 'function' ? o.fmt : String;
    const rows = (Array.isArray(o.rows) ? o.rows : []).filter(Boolean).map((r) => ({
      label: r.label === null || r.label === undefined ? '' : String(r.label),
      value: Math.max(0, num(r.value) || 0),
      plate: F.ui && F.ui.plateOf ? F.ui.plateOf(r.plate) : r.plate
    }));
    if (!rows.length) {
      const root = h('div.chart.chart--hbars');
      root.appendChild(emptyState(o.emptyText || 'Nothing logged yet.', 100));
      return root;
    }
    const max = Math.max(...rows.map((r) => r.value)) || 1;
    const el = h('div.hbars', { attrs: { role: 'list' } });
    rows.forEach((r, i) => {
      const value = safeFmt(fmt, r.value);
      const row = h('div.hbars__row', { attrs: { role: 'listitem', title: r.label + ': ' + value } },
        h('span.hbars__label', null, dot(r.plate), h('span', null, r.label)),
        h('span.hbars__track', { attrs: { 'aria-hidden': 'true' } }, h('span.hbars__bar')),
        h('span.hbars__value', null, value));
      row.style.setProperty('--v', String(r2(r.value / max)));
      row.style.setProperty('--i', String(i));
      if (r.plate) row.dataset.plate = r.plate;
      el.appendChild(row);
    });
    return el;
  }

  /* ------------------------------------------------------------ spark */

  function spark(opts) {
    const o = opts || {};
    const W = clamp(num(o.width) || 96, 24, 1200);
    const H = clamp(num(o.height) || 28, 8, 400);
    const color = o.color || 'var(--accent)';
    const vals = (Array.isArray(o.values) ? o.values : []).map(num).filter((v) => isFinite(v));
    const pad = 3.5;
    const svg = s('svg', {
      class: 'spark' + (reducedMotion() ? '' : ' chart--anim'),
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H,
      role: 'img',
      'aria-label': vals.length ? 'Trend: ' + vals.length + ' values, latest ' + vals[vals.length - 1] : 'No trend yet'
    });
    if (vals.length < 2) {
      svg.appendChild(s('line', { x1: pad, x2: W - pad, y1: H / 2, y2: H / 2, 'stroke-dasharray': '3 4', 'stroke-width': 1.5, style: { stroke: 'var(--line-strong)' } }));
      if (vals.length === 1) svg.appendChild(s('circle', { cx: W - pad, cy: H / 2, r: 2.5, style: { fill: color } }));
      return svg;
    }
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const X = (i) => r2(pad + (i / (vals.length - 1)) * (W - pad * 2));
    const Y = (v) => r2(hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2));
    const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i) + ' ' + Y(v)).join(' ');
    svg.appendChild(s('path', {
      d: d + ' L' + X(vals.length - 1) + ' ' + H + ' L' + X(0) + ' ' + H + ' Z',
      style: { fill: color, 'fill-opacity': 0.12, stroke: 'none' }
    }));
    svg.appendChild(s('path', { class: 'spark__line chart__line', d, pathLength: 1, style: { stroke: color } }));
    svg.appendChild(s('circle', { cx: X(vals.length - 1), cy: Y(vals[vals.length - 1]), r: 2.6, style: { fill: color } }));
    return svg;
  }

  /* ------------------------------------------------------------ heatmap */

  const levelFill = (lvl) => (lvl <= 0 ? 'var(--surface-3)'
    : 'color-mix(in srgb, var(--accent) ' + LEVEL_MIX[clamp(lvl, 1, 4)] + '%, var(--surface-3))');

  /** 7 rows (Mon..Sun) × N week columns; month labels; today outlined; rest days hatched. */
  function heatmap(opts) {
    const o = opts || {};
    const onCell = typeof o.onCell === 'function' ? o.onCell : null;
    const cells = (Array.isArray(o.cells) ? o.cells : [])
      .filter((c) => c && typeof c.iso === 'string' && ISO_RE.test(c.iso))
      .slice()
      .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
    const root = h('div.heatmap.chart' + (onCell ? '.is-clickable' : ''));
    if (!cells.length) { root.appendChild(emptyState(o.emptyText || 'Your training calendar fills in as you log workouts.', 110)); return root; }

    const today = todayISO();
    const start = dayNum(cells[0].iso) - monIndex(cells[0].iso); // Monday of first week
    const byIso = new Map();
    let weeks = 1;
    const items = cells.map((c) => {
      const off = dayNum(c.iso) - start;
      const it = {
        iso: c.iso,
        col: Math.floor(off / 7),
        row: off % 7,
        level: clamp(Math.round(num(c.level) || 0), 0, 4),
        trained: !!c.trained,
        isRest: !!c.isRest,
        future: !!c.future || c.iso > today
      };
      weeks = Math.max(weeks, it.col + 1);
      byIso.set(c.iso, it);
      return it;
    });
    const workouts = items.filter((it) => it.trained).length;
    const describe = (it) => fmtDate(it.iso, 'short') + ' — ' + (it.future ? 'upcoming'
      : it.trained ? 'trained' : it.isRest ? 'rest day' : 'no workout') + (it.iso === today ? ' (today)' : '');

    let focusIso = (byIso.get(today) || items.filter((it) => !it.future).pop() || items[0]).iso;
    const live = h('span.sr-only', { attrs: { 'aria-live': 'polite' } });
    const holder = h('div');
    const swatch = (bg) => { const i = h('i', { attrs: { 'aria-hidden': 'true' } }); i.style.background = bg; return i; };
    const legend = h('div.heatmap__legend', { attrs: { 'aria-hidden': 'true' } },
      h('span', null, 'Less'),
      [0, 1, 2, 3, 4].map((l) => swatch(levelFill(l))),
      h('span', null, 'More'),
      h('span.heatmap__rest-key'),
      swatch('linear-gradient(135deg, transparent 42%, var(--muted) 42% 58%, transparent 58%), var(--surface-2)'),
      h('span', null, 'Rest'));

    mount(holder, (W, animate) => {
      const labelW = 16;
      const top = 16;
      const gap = W < 380 ? 3 : 4;
      const cell = clamp(Math.floor((W - labelW - gap * (weeks - 1)) / weeks), 6, 26);
      const gridW = labelW + weeks * cell + (weeks - 1) * gap;
      const H = top + 7 * cell + 6 * gap;
      legend.style.maxWidth = gridW + 'px'; // keep the key flush with the grid's right edge
      const rx = Math.max(2, Math.round(cell * 0.24));
      const svg = s('svg', {
        class: 'chart__svg' + (animate ? ' chart--anim' : ''),
        viewBox: '0 0 ' + gridW + ' ' + H, width: gridW, height: H,
        role: onCell ? 'group' : 'img',
        tabindex: onCell ? 0 : null,
        'aria-label': 'Training heatmap, last ' + weeks + ' weeks: ' + workouts + (workouts === 1 ? ' workout' : ' workouts') +
          (onCell ? '. Use arrow keys to move, Enter to open a day.' : ''),
        style: { width: gridW + 'px', 'max-width': '100%', height: 'auto' }
      });

      // day-of-week labels
      const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
      letters.forEach((l, r) => {
        if (cell < 11 && r % 2) return;
        svg.appendChild(s('text', { x: 0, y: top + r * (cell + gap) + cell / 2 + 3.5, style: { 'font-size': '9.5px' } }, l));
      });
      // month labels at the first column of each month (skipping crowded ones)
      let lastLabelCol = -9;
      for (let c = 0; c < weeks; c++) {
        const iso = isoFromDayNum(start + c * 7);
        const prev = c ? isoFromDayNum(start + (c - 1) * 7) : null;
        const m = Number(iso.slice(5, 7));
        if (c && prev && Number(prev.slice(5, 7)) === m) continue;
        if (c === 0) { // label the first column only if the next month change is far enough away
          let next = 1;
          while (next < weeks && Number(isoFromDayNum(start + next * 7).slice(5, 7)) === m) next++;
          if (next < 3 && next < weeks) continue;
        }
        if (c - lastLabelCol < 3) continue;
        lastLabelCol = c;
        svg.appendChild(s('text', { x: labelW + c * (cell + gap), y: 10, style: { 'font-size': '10px' } }, MONTHS[m - 1]));
      }

      items.forEach((it) => {
        const x = labelW + it.col * (cell + gap);
        const y = top + it.row * (cell + gap);
        const cls = ['heatmap__cell', it.future && 'is-future', it.isRest && !it.trained && 'is-rest', it.iso === today && 'is-today']
          .filter(Boolean).join(' ');
        const fillC = it.future ? 'var(--surface-2)' : (it.isRest && !it.trained ? 'var(--surface-2)' : levelFill(it.trained ? Math.max(1, it.level) : it.level));
        const g = s('g', { class: cls, 'data-iso': it.iso, style: { '--i': it.col } },
          title(describe(it)),
          s('rect', { x, y, width: cell, height: cell, rx, style: { fill: fillC, opacity: it.future ? 0.45 : null } }));
        if (it.isRest && !it.trained && !it.future && cell >= 8) {
          g.appendChild(s('path', {
            d: 'M' + r2(x + cell * 0.3) + ' ' + r2(y + cell * 0.7) + ' L' + r2(x + cell * 0.7) + ' ' + r2(y + cell * 0.3),
            style: { stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: 0.55 }
          }));
        }
        if (it.iso === today) {
          g.appendChild(s('rect', { x: x + 1, y: y + 1, width: cell - 2, height: cell - 2, rx: Math.max(1, rx - 1), style: { fill: 'none', stroke: 'var(--fg)', 'stroke-width': 2 } }));
        }
        svg.appendChild(g);
      });

      if (onCell) {
        const f = byIso.get(focusIso);
        if (f) {
          svg.appendChild(s('rect', {
            class: 'heatmap__focus',
            x: labelW + f.col * (cell + gap) - 2.5, y: top + f.row * (cell + gap) - 2.5,
            width: cell + 5, height: cell + 5, rx: rx + 2,
            style: { fill: 'none', stroke: 'var(--accent-ink)', 'stroke-width': 2, opacity: 0, 'pointer-events': 'none' }
          }));
        }
      }
      return svg;
    }, 320, true);

    if (onCell) {
      holder.addEventListener('click', (e) => {
        const g = e.target.closest && e.target.closest('[data-iso]');
        if (!g || g.classList.contains('is-future')) return;
        focusIso = g.getAttribute('data-iso');
        try { onCell(focusIso); } catch (err) { console.error('[forge/charts]', err); }
      });
      const showFocus = (visible) => {
        const ring = holder.querySelector('.heatmap__focus');
        const target = holder.querySelector('[data-iso="' + focusIso + '"] rect');
        if (!ring || !target) return;
        ring.setAttribute('x', Number(target.getAttribute('x')) - 2.5);
        ring.setAttribute('y', Number(target.getAttribute('y')) - 2.5);
        ring.style.opacity = visible ? '1' : '0';
      };
      holder.addEventListener('focusin', () => { showFocus(true); live.textContent = describe(byIso.get(focusIso)); });
      holder.addEventListener('focusout', () => showFocus(false));
      holder.addEventListener('keydown', (e) => {
        const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
        if (delta) {
          e.preventDefault();
          const next = isoFromDayNum(dayNum(focusIso) + delta);
          const it = byIso.get(next);
          if (it && !it.future) {
            focusIso = next;
            showFocus(true);
            live.textContent = describe(it);
          }
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          try { onCell(focusIso); } catch (err) { console.error('[forge/charts]', err); }
        }
      });
    }

    root.append(holder, legend, live);
    return root;
  }

  F.charts = { line, bars, hbars, spark, heatmap };
})(window.Forge = window.Forge || {});
