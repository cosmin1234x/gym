/* FORGE — js/views/journal.js  [VIEW:journal]  (SPEC §12 "journal")
 *
 * Training diary. Summary first: a "last 30 days" pulse card (entries, average mood, sleep and
 * energy, a journaling streak) with the bodyweight trend line when two or more weigh-ins exist.
 * Then search + tag filter chips, pinned notes (goals, form tips) and the timeline: entries grouped
 * by month on a date rail, each card showing mood, relative date, title / first line, a snippet,
 * tags, energy bolts, sleep, bodyweight and a dumbbell badge when a workout was logged that day.
 * An empty slot for today offers one-tap mood logging.
 *
 * The editor is a full-height sheet (date, mood, energy, sleep, bodyweight, title, auto-growing
 * text, tag chips with suggestions, pin switch, that day's workout summary). Unsaved editor
 * contents autosave to localStorage 'forge:journal-draft' (one draft per entry / one for a new
 * entry); closing the sheet by accident keeps the draft and offers "Restore draft?".
 *
 * Params: { new: true, date, mood } opens a new, prefilled entry; { id } opens that entry;
 * { date } opens that day's only entry, a new one when there is none, or spotlights the day in
 * the timeline when it has several. Params are consumed once (also removed from history.state),
 * so a reload, back navigation or cloud refresh does not reopen the editor.
 *
 * Frequent interactions (typing in search, filtering, editing) patch the DOM in place: the search
 * input is never rebuilt and the editor updates its own controls, so focus is kept.
 */
(function (F) {
  'use strict';

  /* ------------------------------------------------------------------ constants & module state */

  const DRAFT_KEY = 'forge:journal-draft';
  const DRAFT_MAX = 6;
  const SUGGESTED_TAGS = ['pr', 'sore', 'tired', 'motivated', 'diet', 'sleep', 'form', 'goal'];
  const MOOD_PLATE = { 1: 'violet', 2: 'blue', 3: 'white', 4: 'green', 5: 'red' };
  const ENERGY_WORDS = ['', 'Drained', 'Low', 'Steady', 'Strong', 'Wired'];
  const MAX_TAGS = 12;
  const TAG_LEN = 24;
  const PAGE = 40;

  let editor = null;              // the open editor sheet: { close(reason), slot }
  let hooks = null;               // callbacks into the mounted view (null while off-screen)
  let freshId = null;             // entry to spotlight on the next timeline render (undo restore)
  let seq = 0;
  let limit = PAGE;               // timeline entries rendered (grows with "Show older")
  const filter = { q: '', tag: null };
  const seen = typeof WeakSet === 'function' ? new WeakSet() : null; // params objects already handled

  /* ------------------------------------------------------------------ small helpers */

  const U = () => F.util;
  const S = () => F.store.get();
  const h = (...args) => F.util.h(...args);
  const ic = (name, size, cls) => F.icon(name, { size: size || 20, cls: cls || '' });
  const str = (v) => (typeof v === 'string' ? v : '');
  const units = () => (S().settings && S().settings.units === 'lb' ? 'lb' : 'kg');
  const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const hasReason = (reason, keys) => {
    const parts = String(reason || '').split(' ');
    return keys.some((k) => parts.indexOf(k) >= 0);
  };
  function validRating(v) {
    if (!isNum(v)) return null;
    const n = Math.round(Number(v));
    return n >= 1 && n <= 5 ? n : null;
  }
  function moodWord(m) {
    try { if (F.ui && typeof F.ui.moodLabel === 'function') return F.ui.moodLabel(m); } catch (_) { /* fall through */ }
    return ['', 'Rough', 'Meh', 'Okay', 'Good', 'Beast mode'][m] || '';
  }
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
  /** Spotlight classes are added even under reduced motion: the static highlight still helps. */
  function mark(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /** Display number for a stored kg value (null stays null). */
  function toDisp(kg) {
    if (!isNum(kg)) return null;
    return U().toDisplayWeight(Number(kg), units());
  }

  function topMuscle(byMuscle) {
    let best = null;
    let n = 0;
    for (const k of Object.keys(byMuscle || {})) if (byMuscle[k] > n) { n = byMuscle[k]; best = k; }
    return best;
  }
  function plateOfSession(session) {
    try {
      const st = F.q.sessionStats(session);
      return (F.ui.plateOf && F.ui.plateOf(topMuscle(st.byMuscle))) || 'red';
    } catch (_) { return 'red'; }
  }

  /** Every valid entry, newest date first (then newest created first). */
  function allEntries() {
    const u = U();
    const list = Array.isArray(S().journal) ? S().journal : [];
    return list.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && u.isISO(e.date))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)));
  }
  function findEntry(id) {
    if (!id) return null;
    const list = Array.isArray(S().journal) ? S().journal : [];
    return list.find((e) => e && e.id === id) || null;
  }
  function tagCounts(list) {
    const m = new Map();
    for (const e of list || allEntries()) {
      for (const t of Array.isArray(e.tags) ? e.tags : []) if (typeof t === 'string' && t) m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
  }
  /** Most recent logged value of a numeric field (e.g. 'bodyweight', 'sleep'). */
  function lastValue(key) {
    for (const e of allEntries()) if (isNum(e[key])) return Number(e[key]);
    return null;
  }
  /** Average of the last `n` logged values of a numeric field, or null. */
  function usualValue(key, n) {
    const vals = [];
    for (const e of allEntries()) { if (isNum(e[key])) vals.push(Number(e[key])); if (vals.length >= n) break; }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  function normTag(raw) {
    return String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase()
      .replace(/^#+/, '').replace(/[\s,]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, TAG_LEN);
  }

  /** 'Today' · 'Yesterday' · '3 days ago' · 'Last week' · '5 weeks ago' · '2 Mar 2026'. */
  function relLabel(iso) {
    const u = U();
    const d = u.diffDays(iso, u.todayISO());
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d === -1) return 'Tomorrow';
    if (d < 0) return 'In ' + (-d) + ' days';
    if (d < 7) return d + ' days ago';
    if (d < 14) return 'Last week';
    if (d < 60) return Math.floor(d / 7) + ' weeks ago';
    return u.fmtDate(iso, 'dmy');
  }
  function ago(ts) {
    const u = U();
    const t = Number(ts) || 0;
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const iso = u.toISO(t);
    if (iso === u.todayISO()) return 'today ' + u.fmtTime(t);
    return u.fmtDate(iso, 'dm') + ' ' + u.fmtTime(t);
  }

  /** Title + body for display: the title, or the first sentence / line of the text. */
  function textParts(e) {
    const text = str(e.text).replace(/\r/g, '').trim();
    const title = str(e.title).trim();
    if (title) return { title, body: text };
    if (!text) return { title: '', body: '' };
    const nl = text.indexOf('\n');
    const line = nl >= 0 ? text.slice(0, nl) : text;
    let rest = nl >= 0 ? text.slice(nl + 1) : '';
    let head = line;
    const stop = line.search(/[.!?](\s|$)/);
    if (stop > 0 && stop < 90) {
      head = line.slice(0, stop + (line[stop] === '.' ? 0 : 1));
      rest = (line.slice(stop + 1).trim() + (rest ? '\n' + rest : '')).trim();
    } else if (line.length > 90) {
      const cut = line.lastIndexOf(' ', 64);
      const at = cut > 24 ? cut : 64;
      head = line.slice(0, at).trim() + '…';
      rest = ('…' + line.slice(at).trim() + (rest ? '\n' + rest : '')).trim();
    }
    return { title: head.trim(), body: rest.trim() };
  }
  function autoTitle(e) {
    const m = validRating(e && e.mood);
    return m ? moodWord(m) + ' day' : 'Check-in';
  }

  /* ------------------------------------------------------------------ search */

  function termsOf(q) {
    return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  }
  function matches(e, terms, tag) {
    const tags = Array.isArray(e.tags) ? e.tags : [];
    if (tag && tags.indexOf(tag) < 0) return false;
    if (!terms.length) return true;
    const hay = (str(e.title) + '\n' + str(e.text) + '\n' + tags.map((t) => '#' + t).join(' ')).toLowerCase();
    return terms.every((t) => hay.indexOf(t) >= 0);
  }
  /** Text with search terms wrapped in <mark> (text nodes only — user text never becomes markup). */
  function marked(text, terms) {
    const s = String(text || '');
    const ts = (terms || []).map((t) => t.replace(/^#/, '')).filter(Boolean);
    if (!ts.length || !s) return s;
    const lower = s.toLowerCase();
    const out = [];
    let i = 0;
    while (i < s.length) {
      let best = -1;
      let len = 0;
      for (const t of ts) {
        const j = lower.indexOf(t, i);
        if (j >= 0 && (best < 0 || j < best || (j === best && t.length > len))) { best = j; len = t.length; }
      }
      if (best < 0) break;
      if (best > i) out.push(s.slice(i, best));
      out.push(h('mark.jr-hl', s.slice(best, best + len)));
      i = best + len;
    }
    if (i < s.length) out.push(s.slice(i));
    return out;
  }
  /** Snippet (newlines folded), centred on the first search hit when it sits deep in the text. */
  function snippet(body, terms) {
    let s = String(body || '').replace(/\s*\n+\s*/g, ' · ').replace(/\s{2,}/g, ' ').trim();
    const ts = (terms || []).map((t) => t.replace(/^#/, '')).filter(Boolean);
    if (ts.length) {
      const lower = s.toLowerCase();
      let first = -1;
      for (const t of ts) { const j = lower.indexOf(t); if (j >= 0 && (first < 0 || j < first)) first = j; }
      if (first > 110) {
        const from = s.lastIndexOf(' ', first - 40);
        s = '…' + s.slice(from > 0 ? from + 1 : first - 40);
      }
    }
    return s.length > 320 ? s.slice(0, 320).trim() + '…' : s;
  }

  /* ------------------------------------------------------------------ editor fields & drafts */

  /** Sanitised editor fields (never throws on odd data). */
  function cleanFields(raw) {
    const u = U();
    const r = raw && typeof raw === 'object' ? raw : {};
    const sleep = isNum(r.sleep) ? u.clamp(u.round(Number(r.sleep), 1), 0, 24) : null;
    const bw = isNum(r.bodyweight) && Number(r.bodyweight) > 0 && Number(r.bodyweight) <= 500 ? u.round(Number(r.bodyweight), 3) : null;
    const tags = [];
    for (const t of Array.isArray(r.tags) ? r.tags : []) {
      const n = normTag(t);
      if (n && tags.indexOf(n) < 0 && tags.length < MAX_TAGS) tags.push(n);
    }
    return {
      date: u.isISO(r.date) ? r.date : u.todayISO(),
      mood: validRating(r.mood),
      energy: validRating(r.energy),
      sleep,
      bodyweight: bw,
      title: str(r.title).slice(0, 120),
      text: str(r.text).slice(0, 20000),
      tags,
      pinned: r.pinned === true
    };
  }
  function isBlank(f) {
    return !f.title.trim() && !f.text.trim() && f.mood === null && f.energy === null &&
      f.sleep === null && f.bodyweight === null && !f.tags.length;
  }
  const slotOf = (id) => id || 'new';

  function readDrafts() {
    const raw = U().storage.get(DRAFT_KEY, null);
    const items = raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object' ? raw.items : {};
    const out = {};
    for (const k of Object.keys(items)) {
      const d = items[k];
      if (!d || typeof d !== 'object' || !d.f || typeof d.f !== 'object') continue;
      out[k] = { id: typeof d.id === 'string' && d.id ? d.id : null, f: cleanFields(d.f), at: Number(d.at) || 0 };
    }
    return out;
  }
  function writeDrafts(items) {
    const keys = Object.keys(items).sort((a, b) => items[b].at - items[a].at).slice(0, DRAFT_MAX);
    if (!keys.length) { U().storage.remove(DRAFT_KEY); return; }
    const out = {};
    keys.forEach((k) => { out[k] = items[k]; });
    U().storage.set(DRAFT_KEY, { v: 2, items: out });
  }
  function putDraft(slot, id, f) {
    const all = readDrafts();
    all[slot] = { id: id || null, f: JSON.parse(JSON.stringify(f)), at: Date.now() };
    writeDrafts(all);
  }
  function dropDraft(slot) {
    const all = readDrafts();
    if (!all[slot]) return;
    delete all[slot];
    writeDrafts(all);
  }

  /* ------------------------------------------------------------------ editor sheet */

  /**
   * Open the entry editor.
   * o: { id, date, mood, pinned, tags, title,   // target entry, or presets for a new one
   *      slot, restore }                        // restore: start from the stored draft in `slot`
   */
  function openEditor(opts) {
    const o = opts || {};
    const u = U();
    if (editor) editor.close('replace');

    const k = ++seq;
    const idOf = (name) => 'jr-ed-' + name + '-' + k;
    const today = u.todayISO();
    const U_ = units();

    let entryId = null;
    let base = null;
    const existing = o.id ? findEntry(o.id) : null;
    if (existing) { entryId = existing.id; base = cleanFields(existing); }
    if (!base) {
      base = cleanFields({
        date: u.isISO(o.date) ? o.date : today, mood: o.mood, pinned: o.pinned === true,
        tags: Array.isArray(o.tags) ? o.tags : [], title: o.title || ''
      });
    }
    const slot = o.slot || slotOf(entryId);
    const stored = readDrafts()[slot] || null;
    let f = JSON.parse(JSON.stringify(base));
    let restored = false;
    if (o.restore && stored) { f = JSON.parse(JSON.stringify(stored.f)); restored = true; }
    let baseline = JSON.stringify(base);
    let wrote = restored;       // this editor owns the stored draft in `slot`
    let pending = !restored && !!stored && JSON.stringify(stored.f) !== baseline ? stored : null;
    let closing = null;         // 'save' | 'delete' once one of those started
    let savedId = null;
    const dirty = () => JSON.stringify(f) !== baseline;

    const persist = u.debounce(() => {
      if (pending || closing) return;
      if (dirty()) { putDraft(slot, entryId, f); wrote = true; } else if (wrote) { dropDraft(slot); wrote = false; }
    }, 350);
    function changed() { persist(); }

    /* ---- restore offer --------------------------------------------------------------- */
    let offerEl = null;
    if (pending) {
      const dp = textParts(pending.f);
      offerEl = h('div.jr-offer', { attrs: { role: 'status' } },
        h('span.jr-offer__icon', ic('edit', 20)),
        h('div.jr-offer__main',
          h('span.jr-offer__title', 'Restore draft?'),
          h('span.jr-offer__sub', 'Unsaved changes, kept ' + ago(pending.at) +
            (dp.title ? ' · “' + (dp.title.length > 40 ? dp.title.slice(0, 40) + '…' : dp.title) + '”' : ''))),
        h('div.jr-offer__btns',
          h('button.btn.btn--primary.btn--sm', { type: 'button', onClick: () => resolveOffer(true) }, 'Restore'),
          h('button.btn.btn--ghost.btn--sm', { type: 'button', onClick: () => resolveOffer(false) }, 'Discard')));
    }
    function resolveOffer(restore) {
      const d = pending;
      pending = null;
      if (restore && d) {
        f = JSON.parse(JSON.stringify(d.f));
        wrote = true;
        syncControls();
        u.haptic(10);
      } else {
        dropDraft(slot);
      }
      if (offerEl) {
        const node = offerEl;
        offerEl = null;
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), reduced() ? 0 : 220);
      }
      changed();
    }

    /* ---- date + that day's workout ----------------------------------------------------- */
    const dateInput = h('input.input.jr-ed-date', { id: idOf('date'), type: 'date', value: f.date });
    const relEl = h('span.jr-ed-rel');
    const wkBox = h('div.jr-ed-wk');
    dateInput.addEventListener('change', () => {
      const v = dateInput.value;
      if (u.isISO(v) && v !== f.date) { f.date = v; updateWhen(); changed(); }
    });
    dateInput.addEventListener('blur', () => { if (!u.isISO(dateInput.value)) dateInput.value = f.date; });

    function updateWhen() {
      relEl.textContent = relLabel(f.date);
      relEl.classList.toggle('is-today', f.date === today);
      const sub = api && api.panel.querySelector('.sheet__subtitle');
      if (sub) sub.textContent = u.fmtDate(f.date, 'full');
      renderWorkout();
    }
    function renderWorkout() {
      u.clear(wkBox);
      let sessions = [];
      try { sessions = F.q.sessionsOn(f.date) || []; } catch (_) { sessions = []; }
      if (sessions.length) {
        sessions.slice(0, 3).forEach((s) => {
          let st = null;
          try { st = F.q.sessionStats(s); } catch (_) { st = null; }
          const stats = st ? [
            [u.fmtDuration(st.durationSec), 'time'],
            st.volume > 0 ? [u.fmtNum(Math.round(toDisp(st.volume) || 0)), units() + ' volume'] : [u.fmtNum(st.reps), 'reps'],
            [String(st.sets), st.sets === 1 ? 'set' : 'sets']
          ] : [];
          wkBox.append(h('div.jr-wk', { dataset: { plate: plateOfSession(s) } },
            h('span.jr-wk__icon', ic('dumbbell', 20)),
            h('div.jr-wk__main',
              h('span.jr-wk__eyebrow', 'Trained' + (s.startedAt ? ' · ' + u.fmtTime(s.startedAt) : '')),
              h('span.jr-wk__title', str(s.title) || 'Workout')),
            h('div.jr-wk__stats', stats.map(([v, l]) => h('span.jr-wk__stat', h('b', v), h('small', l))))));
        });
        return;
      }
      let ds = null;
      try { ds = F.q.dayStatus(f.date); } catch (_) { ds = null; }
      const planned = ds && ds.day && str(ds.day.title);
      let text;
      let icon = 'calendar';
      if (ds && ds.isRest) { text = 'Rest day — recovery counts too.'; icon = 'bed'; }
      else if (ds && ds.isFuture) text = planned ? 'Planned: ' + planned : 'Nothing planned';
      else if (f.date === today) text = planned ? 'Not trained yet · planned ' + planned : 'No workout logged yet';
      else text = 'No workout logged' + (planned ? ' · planned ' + planned : '');
      wkBox.append(h('div.jr-wk.jr-wk--none', h('span.jr-wk__icon', ic(icon, 18)), h('span.jr-wk__note', text)));
    }

    /* ---- mood, energy, sleep, bodyweight -------------------------------------------------- */
    const moodEl = F.ui.moodPicker({ id: idOf('mood'), value: f.mood, label: 'Mood', onChange: (v) => { f.mood = v; changed(); } });
    const energyWord = h('span.jr-ed-word');
    const setEnergyWord = () => {
      energyWord.textContent = f.energy ? ENERGY_WORDS[f.energy] : 'Tap a bolt';
      energyWord.classList.toggle('is-set', !!f.energy);
    };
    const energyEl = F.ui.ratingDots({
      value: f.energy, max: 5, icon: 'bolt', label: 'Energy',
      onChange: (v) => { f.energy = v; setEnergyWord(); changed(); }
    });

    const usualSleep = usualValue('sleep', 7);
    const lastBw = lastValue('bodyweight');
    const bwMin = U_ === 'lb' ? 44 : 20;
    const bwMax = U_ === 'lb' ? 660 : 300;

    let sleepEl = null;
    let bwEl = null;
    const sleepClear = h('button.jr-clear', { type: 'button', attrs: { 'aria-label': 'Clear sleep' }, onClick: () => { f.sleep = null; sleepEl.setValue(null); syncClears(); changed(); } }, 'Clear');
    const bwClear = h('button.jr-clear', { type: 'button', attrs: { 'aria-label': 'Clear bodyweight' }, onClick: () => { f.bodyweight = null; bwEl.setValue(null); syncClears(); changed(); } }, 'Clear');
    function syncClears() {
      sleepClear.hidden = f.sleep === null;
      bwClear.hidden = f.bodyweight === null;
    }
    sleepEl = F.ui.stepper({
      id: idOf('sleep'), value: f.sleep, step: 0.5, min: 0, max: 14, decimals: 1, unit: 'h', label: 'Sleep', labelHidden: true,
      onChange: (v) => {
        let val = v;
        // + / − on an empty field starts from your usual sleep instead of 0.5 h
        if (f.sleep === null && val !== null && document.activeElement !== sleepEl.input) {
          val = usualSleep !== null ? u.clamp(Math.round(usualSleep * 2) / 2, 0, 14) : 7.5;
          sleepEl.setValue(val);
        }
        f.sleep = val;
        syncClears();
        changed();
      }
    });
    sleepEl.input.placeholder = '–';
    bwEl = F.ui.stepper({
      id: idOf('bw'), value: toDisp(f.bodyweight), step: 0.1, min: bwMin, max: bwMax, decimals: 1, unit: U_, label: 'Bodyweight', labelHidden: true,
      onChange: (v) => {
        let val = v;
        // + / − on an empty field starts from the last weigh-in
        if (f.bodyweight === null && val !== null && document.activeElement !== bwEl.input) {
          val = lastBw !== null ? toDisp(lastBw) : (U_ === 'lb' ? 170 : 75);
          bwEl.setValue(val);
        }
        f.bodyweight = val === null ? null : u.fromDisplayWeight(val, U_);
        syncClears();
        changed();
      }
    });
    bwEl.input.placeholder = '–';
    syncClears();
    setEnergyWord();

    const metric = (label, forId, extra, control, hint) => h('div.jr-metric',
      h('div.jr-metric__head', forId ? h('label.field__label', { for: forId }, label) : h('span.field__label', label), extra),
      control,
      hint ? h('span.jr-metric__hint', hint) : null);

    /* ---- title, text ---------------------------------------------------------------------- */
    const textArea = h('textarea.textarea.jr-ed-text', {
      id: idOf('text'), value: f.text, rows: 5, maxLength: 20000,
      placeholder: 'How did training go? What felt strong, what hurt, what to change next time…'
    });
    const wordsEl = h('span.jr-ed-words');
    const titleInput = h('input.input.jr-ed-title', {
      id: idOf('title'), type: 'text', value: f.title, maxLength: 120, autocomplete: 'off',
      placeholder: 'Title (optional)', attrs: { enterkeyhint: 'next' }
    });
    titleInput.addEventListener('input', () => { f.title = titleInput.value; changed(); });
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); textArea.focus(); } });
    function grow() {
      try {
        textArea.style.height = 'auto';
        textArea.style.height = Math.max(148, textArea.scrollHeight + 2) + 'px';
      } catch (_) { /* layout not ready */ }
    }
    function countWords() {
      const n = f.text.trim() ? f.text.trim().split(/\s+/).length : 0;
      wordsEl.textContent = n ? plural(n, 'word', 'words') : '';
    }
    textArea.addEventListener('input', () => { f.text = textArea.value; grow(); countWords(); changed(); });
    countWords();

    /* ---- tags ----------------------------------------------------------------------------- */
    const tagInput = h('input.jr-tagbox__input', {
      id: idOf('tags'), type: 'text', autocomplete: 'off', maxLength: 60,
      attrs: { enterkeyhint: 'done', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': idOf('tags-hint') }
    });
    const tagList = h('span.jr-tagbox__list');
    const tagBox = h('div.jr-tagbox', null, tagList, tagInput);
    tagBox.addEventListener('click', (e) => { if (e.target === tagBox || e.target === tagList) tagInput.focus(); });
    const suggestEl = h('div.chips.chips--wrap.jr-suggest', { attrs: { role: 'group', 'aria-label': 'Suggested tags' } });
    const usedTags = tagCounts();

    function renderTags(popTag) {
      u.clear(tagList);
      f.tags.forEach((t) => {
        tagList.append(h('button.jr-tagchip', {
          type: 'button', class: t === popTag ? 'pop' : null, dataset: { tag: t },
          attrs: { 'aria-label': 'Remove tag ' + t },
          onClick: (e) => removeTag(t, e && e.detail === 0)
        }, h('span.jr-tagchip__hash', '#'), h('span.jr-tagchip__t', t), ic('x', 14)));
      });
      tagInput.placeholder = f.tags.length ? 'Add…' : 'Add a tag…';
      renderSuggest();
    }
    function renderSuggest() {
      const q = normTag(tagInput.value);
      const pool = SUGGESTED_TAGS.concat(Array.from(usedTags.keys()).sort((a, b) => usedTags.get(b) - usedTags.get(a)));
      const list = Array.from(new Set(pool)).filter((t) => f.tags.indexOf(t) < 0 && (!q || t.indexOf(q) === 0)).slice(0, q ? 12 : 8);
      u.clear(suggestEl);
      list.forEach((t) => suggestEl.append(h('button.chip.jr-suggest__chip', {
        type: 'button', attrs: { 'aria-label': 'Add tag ' + t },
        onClick: () => { addTag(t); tagInput.value = ''; renderSuggest(); }
      }, ic('plus', 14), h('span.chip__label', '#' + t))));
      suggestEl.hidden = !list.length || f.tags.length >= MAX_TAGS;
    }
    function addTag(raw) {
      const t = normTag(raw);
      if (!t) return false;
      if (f.tags.indexOf(t) >= 0) {
        replay(tagList.querySelector('[data-tag="' + t.replace(/["\\]/g, '') + '"]'), 'shake');
        return false;
      }
      if (f.tags.length >= MAX_TAGS) { F.ui.toast('Up to ' + MAX_TAGS + ' tags per entry', { type: 'warn' }); return false; }
      f.tags = f.tags.concat(t);
      renderTags(t);
      u.haptic(8);
      changed();
      return true;
    }
    function removeTag(t, viaKeyboard) {
      f.tags = f.tags.filter((x) => x !== t);
      renderTags();
      changed();
      if (viaKeyboard) tagInput.focus();
    }
    function commitTagInput() {
      if (!tagInput.value.trim()) return;
      addTag(tagInput.value);
      tagInput.value = '';
      renderSuggest();
    }
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTagInput(); }
      else if (e.key === 'Backspace' && !tagInput.value && f.tags.length) { e.preventDefault(); removeTag(f.tags[f.tags.length - 1], true); }
    });
    tagInput.addEventListener('input', () => {
      if (tagInput.value.indexOf(',') >= 0) { // Android keyboards send ',' as text, not a key
        const bits = tagInput.value.split(',');
        const last = bits.pop();
        bits.forEach((b) => addTag(b));
        tagInput.value = last;
      }
      renderSuggest();
    });
    tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) commitTagInput(); });
    renderTags();

    /* ---- pin ------------------------------------------------------------------------------ */
    const pinEl = F.ui.switchEl({
      id: idOf('pin'), checked: f.pinned, label: 'Pin to top',
      hint: 'Keep goals and form tips above the timeline.',
      onChange: (v) => { f.pinned = !!v; changed(); }
    });

    function syncControls() {
      dateInput.value = f.date;
      moodEl.setValue(f.mood);
      energyEl.setValue(f.energy);
      setEnergyWord();
      sleepEl.setValue(f.sleep);
      bwEl.setValue(toDisp(f.bodyweight));
      syncClears();
      titleInput.value = f.title;
      textArea.value = f.text;
      grow();
      countWords();
      renderTags();
      pinEl.setValue(f.pinned);
      updateWhen();
    }

    /* ---- assemble ------------------------------------------------------------------------- */
    const content = h('div.jr-ed',
      offerEl,
      h('section.jr-ed__sec.jr-ed__when', { attrs: { 'aria-label': 'Date and workout' } },
        h('div.jr-ed__daterow',
          h('label.field__label', { for: idOf('date') }, 'Date'),
          h('div.jr-ed__dateline', dateInput, relEl)),
        wkBox),
      h('section.jr-ed__sec', { attrs: { 'aria-label': 'Mood' } },
        h('span.field__label', 'Mood'),
        moodEl),
      h('section.jr-ed__sec.jr-ed__metrics', { attrs: { 'aria-label': 'Energy, sleep and bodyweight' } },
        metric('Energy', null, energyWord, energyEl),
        metric('Sleep', idOf('sleep'), sleepClear, sleepEl, usualSleep !== null ? 'Usually ' + U().fmtNum(Math.round(usualSleep * 2) / 2, 1) + ' h' : 'Hours last night'),
        metric('Bodyweight', idOf('bw'), bwClear, bwEl, lastBw !== null ? 'Last ' + U().fmtWeight(lastBw) : 'Optional weigh-in')),
      h('section.jr-ed__sec.jr-ed__notes', { attrs: { 'aria-label': 'Notes' } },
        h('div.field', h('label.field__label', { for: idOf('title') }, 'Title'), titleInput),
        h('div.field',
          h('div.jr-ed__texthead', h('label.field__label', { for: idOf('text') }, 'Notes'), wordsEl),
          textArea)),
      h('section.jr-ed__sec', { attrs: { 'aria-label': 'Tags' } },
        h('div.jr-ed__texthead', h('label.field__label', { for: idOf('tags') }, 'Tags'),
          h('span.jr-ed-words', { id: idOf('tags-hint') }, 'Enter or comma to add')),
        tagBox,
        suggestEl),
      h('section.jr-ed__sec.jr-ed__pin', pinEl));

    const actions = [];
    if (entryId) {
      actions.push({ id: idOf('delete'), icon: 'trash', variant: 'danger', className: 'btn--icon jr-ed-del', onClick: () => del() });
    }
    actions.push({ id: idOf('save'), label: entryId ? 'Save changes' : 'Save entry', icon: 'check', variant: 'primary', className: 'jr-ed-save', onClick: () => save() });

    let api = null;
    api = F.ui.sheet({
      title: entryId ? 'Edit entry' : 'New entry',
      subtitle: u.fmtDate(f.date, 'full'),
      content,
      actions,
      size: 'full',
      className: 'jr-sheet',
      onClose: (reason) => onClose(reason)
    });
    const delBtn = api.panel.querySelector('.jr-ed-del');
    if (delBtn) { delBtn.setAttribute('aria-label', 'Delete entry'); delBtn.title = 'Delete entry'; }
    const saveBtn = api.panel.querySelector('.jr-ed-save');

    updateWhen();
    requestAnimationFrame(grow);
    setTimeout(grow, 60); // once fonts / sheet layout have settled

    const handle = { slot, close: (reason) => api.close(reason) };
    editor = handle;
    if (hooks) hooks.draftsChanged();

    /* ---- save / delete / close ------------------------------------------------------------ */
    function save() {
      if (closing) return;
      if (isBlank(f)) {
        replay(textArea, 'shake');
        F.ui.toast('Add a note, a mood or a metric first', { type: 'warn' });
        return;
      }
      const payload = {
        date: f.date, title: f.title.trim(), text: f.text.replace(/\s+$/, ''),
        mood: f.mood, energy: f.energy, sleep: f.sleep, bodyweight: f.bodyweight,
        tags: f.tags.slice(), pinned: f.pinned
      };
      if (entryId) payload.id = entryId;
      let saved = null;
      try { saved = F.store.saveJournal(payload); } catch (err) { console.error('[journal] save failed', err); }
      if (!saved) { F.ui.toast('Couldn’t save this entry', { type: 'error' }); return; }
      closing = 'save';
      savedId = saved.id;
      persist.cancel();
      dropDraft(slot);
      wrote = false;
      baseline = JSON.stringify(f);
      if (saveBtn) {
        saveBtn.classList.add('is-saved');
        u.clear(saveBtn);
        saveBtn.append(ic('check', 22), h('span', 'Saved'));
      }
      u.haptic([10, 30, 16]);
      if (!reduced() && saveBtn) {
        try {
          const r = saveBtn.getBoundingClientRect();
          F.ui.confetti({ x: r.left + r.width / 2, y: r.top + 6, count: 36 });
        } catch (_) { /* confetti is decoration */ }
      }
      setTimeout(() => api.close('save'), reduced() ? 0 : 520);
    }

    async function del() {
      if (closing || !entryId) return;
      const ok = await F.ui.confirm({
        title: 'Delete this entry?',
        message: 'It disappears from your journal. You can undo right after.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok || closing) return;
      closing = 'delete';
      persist.cancel();
      const removed = F.store.deleteJournal(entryId);
      dropDraft(slot);
      wrote = false;
      api.close('delete');
      if (removed) {
        const copy = JSON.parse(JSON.stringify(removed));
        F.ui.toast('Entry deleted', {
          icon: 'trash',
          action: { label: 'Undo', onClick: () => { freshId = copy.id; F.store.restoreJournal(copy); } }
        });
      }
    }

    function onClose(reason) {
      persist.cancel();
      if (editor === handle) editor = null;
      if (closing !== 'save' && closing !== 'delete') {
        if (dirty()) {
          putDraft(slot, entryId, f);
          wrote = true;
          if (['button', 'escape', 'backdrop', 'swipe'].indexOf(reason) >= 0) {
            F.ui.toast('Draft kept — nothing is lost', {
              icon: 'edit',
              action: { label: 'Restore', onClick: () => openEditor({ id: entryId, slot, restore: true }) }
            });
          }
        } else if (wrote) {
          dropDraft(slot);
        }
      }
      if (hooks) {
        hooks.draftsChanged();
        if (closing === 'save' && savedId) hooks.spotlight(savedId);
      }
      if (closing === 'save') F.ui.toast(entryId ? 'Entry updated' : 'Saved to your journal', { type: 'ok', icon: 'book' });
    }

    return handle;
  }

  /* ------------------------------------------------------------------ history params */

  /** Remove consumed params from history.state so reload / back does not reopen the editor. */
  function stripHistoryParams() {
    try {
      const st = window.history.state;
      if (st && typeof st === 'object' && st.name === 'journal' && st.params && typeof st.params === 'object' && Object.keys(st.params).length) {
        window.history.replaceState(Object.assign({}, st, { params: {} }), '', window.location.href);
      }
    } catch (_) { /* history refused (sandbox): the params simply stay */ }
  }

  /* ------------------------------------------------------------------ view */

  function render(el, params, ctx) {
    const u = U();
    const p = params && typeof params === 'object' ? params : {};
    const firstVisit = seen ? !seen.has(p) : true;
    if (seen) seen.add(p);
    if (firstVisit) { filter.q = ''; filter.tag = null; limit = PAGE; }
    const today = u.todayISO();

    /* ---- skeleton ------------------------------------------------------------------------ */
    const head = h('header.view-head.jr-head',
      h('div.view-head__titles',
        h('p.eyebrow', u.DAY_LONG[u.dayKeyOf(today)] + ' · ' + u.fmtDate(today, 'dm')),
        h('h2.h1', 'Journal')));
    const draftSlot = h('div.jr-slot-drafts');
    const pulseSlot = h('div.jr-slot-pulse');

    const searchInput = h('input.input.jr-search__input', {
      id: 'jr-search', type: 'search', value: filter.q, autocomplete: 'off', placeholder: 'Search notes & #tags',
      attrs: { 'aria-label': 'Search journal', enterkeyhint: 'search', spellcheck: 'false' }
    });
    const clearQ = h('button.jr-search__clear', { type: 'button', hidden: !filter.q, attrs: { 'aria-label': 'Clear search' } }, ic('x', 18));
    const chipsEl = h('div.chips.jr-tagfilter', { attrs: { role: 'group', 'aria-label': 'Filter by tag' } });
    const filtersEl = h('section.jr-filters', { attrs: { 'aria-label': 'Search and filter' } },
      h('div.jr-search', ic('search', 20, 'jr-search__icon'), searchInput, clearQ),
      chipsEl);
    const resultsEl = h('div.jr-results');
    const liveEl = h('p.sr-only', { attrs: { 'aria-live': 'polite' } });
    const fab = h('button.fab.jr-fab', {
      type: 'button', attrs: { 'aria-label': 'New journal entry' },
      onClick: () => openEditor({ date: today })
    }, ic('plus', 22), h('span.jr-fab__label', 'New entry'));

    el.append(head, draftSlot, pulseSlot, filtersEl, resultsEl, liveEl, fab);

    /* ---- search & filters --------------------------------------------------------------- */
    const runSearch = u.debounce(() => { renderResults(allEntries(), false, true); }, 140);
    searchInput.addEventListener('input', () => {
      filter.q = searchInput.value;
      clearQ.hidden = !filter.q;
      runSearch();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); e.stopPropagation(); setQuery(''); }
      else if (e.key === 'Enter') { runSearch.flush(); try { searchInput.blur(); } catch (_) { /* ignore */ } }
    });
    clearQ.addEventListener('click', () => { setQuery(''); searchInput.focus(); });
    // Phones: lift the search box to the top so results show above the keyboard.
    searchInput.addEventListener('focus', () => {
      try {
        if (window.innerWidth >= 720) return;
        const r = filtersEl.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.3) filtersEl.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      } catch (_) { /* ignore */ }
    });
    function setQuery(q) {
      runSearch.cancel();
      filter.q = q;
      searchInput.value = q;
      clearQ.hidden = !q;
      renderResults(allEntries(), false, true);
    }
    function clearFilters() {
      runSearch.cancel();
      filter.q = '';
      filter.tag = null;
      searchInput.value = '';
      clearQ.hidden = true;
      syncChips();
      renderResults(allEntries(), false, true);
    }

    const chipRefs = [];
    function renderChips(list) {
      u.clear(chipsEl);
      chipRefs.length = 0;
      const counts = tagCounts(list);
      if (filter.tag && !counts.has(filter.tag)) filter.tag = null;
      chipsEl.hidden = !counts.size;
      if (!counts.size) return;
      const all = F.ui.chip({ label: 'All', active: !filter.tag, onClick: () => pickTag(null) });
      all.dataset.tag = '';
      chipsEl.append(all);
      chipRefs.push(all);
      Array.from(counts.keys())
        .sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1))
        .forEach((t) => {
          const c = F.ui.chip({ label: '#' + t, count: counts.get(t), active: filter.tag === t, onClick: () => pickTag(t) });
          c.dataset.tag = t;
          chipsEl.append(c);
          chipRefs.push(c);
        });
    }
    function syncChips() {
      chipRefs.forEach((c) => c.setActive((c.dataset.tag || null) === (filter.tag || null)));
    }
    function pickTag(t) {
      filter.tag = t && filter.tag !== t ? t : null;
      syncChips();
      u.haptic(8);
      renderResults(allEntries(), false, true);
    }

    /* ---- drafts banner ----------------------------------------------------------------- */
    function renderDrafts() {
      u.clear(draftSlot);
      const drafts = readDrafts();
      const keys = Object.keys(drafts)
        .filter((k) => !(editor && editor.slot === k))
        .sort((a, b) => drafts[b].at - drafts[a].at)
        .slice(0, 3);
      if (!keys.length) return;
      draftSlot.append(h('section.jr-drafts.anim-in', { attrs: { 'aria-label': 'Unsaved drafts' } },
        keys.map((k) => draftRow(k, drafts[k]))));
    }
    function draftRow(k, d) {
      const tp = textParts(d.f);
      const name = tp.title || (isBlank(d.f) ? 'Untitled entry' : autoTitle(d.f));
      const target = d.id && findEntry(d.id);
      return h('div.jr-draft',
        h('span.jr-draft__icon', ic('edit', 18)),
        h('div.jr-draft__main',
          h('span.jr-draft__title', 'Restore draft?'),
          h('span.jr-draft__sub', '“' + (name.length > 48 ? name.slice(0, 48) + '…' : name) + '” · ' +
            (target ? 'edits to ' + u.fmtDate(d.f.date, 'dm') : 'new entry') + ' · ' + ago(d.at))),
        h('div.jr-draft__btns',
          h('button.btn.btn--primary.btn--sm', {
            type: 'button', attrs: { 'aria-label': 'Restore draft: ' + name },
            onClick: () => openEditor({ id: target ? d.id : null, slot: k, restore: true })
          }, 'Restore'),
          h('button.btn.btn--ghost.btn--sm', {
            type: 'button', attrs: { 'aria-label': 'Discard draft: ' + name },
            onClick: () => {
              const all = readDrafts();
              const was = all[k];
              delete all[k];
              writeDrafts(all);
              renderDrafts();
              F.ui.toast('Draft discarded', {
                action: { label: 'Undo', onClick: () => { const a = readDrafts(); if (was) a[k] = was; writeDrafts(a); if (hooks) hooks.draftsChanged(); } }
              });
            }
          }, 'Discard')));
    }

    /* ---- pulse (summary) ---------------------------------------------------------------- */
    function journalStreak(list) {
      const days = new Set(list.map((e) => e.date));
      let d = days.has(today) ? today : u.addDays(today, -1);
      let n = 0;
      while (days.has(d) && n < 3650) { n++; d = u.addDays(d, -1); }
      return n;
    }
    function bodyweightSeries(list) {
      const byDate = new Map();
      for (const e of list) { // newest first → the first seen per date is that day's latest weigh-in
        if (!isNum(e.bodyweight) || byDate.has(e.date)) continue;
        byDate.set(e.date, Number(e.bodyweight));
      }
      return Array.from(byDate.entries()).map(([date, kg]) => ({ date, kg }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60);
    }
    function renderPulse(list, animate) {
      u.clear(pulseSlot);
      const since = u.addDays(today, -29);
      const recent = list.filter((e) => e.date >= since && e.date <= today);
      const avgOf = (key, lo, hi) => {
        const vals = recent.map((e) => e[key]).filter(isNum).map(Number).filter((n) => n >= lo && n <= hi);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const mood = avgOf('mood', 1, 5);
      const sleep = avgOf('sleep', 0, 24);
      const energy = avgOf('energy', 1, 5);
      const streak = journalStreak(list);
      const moodR = mood !== null ? Math.max(1, Math.min(5, Math.round(mood))) : null;

      const kpi = (cls, label, valueNode, extra, plate) => h('div.jr-kpi' + cls, { dataset: { plate: plate || undefined } },
        h('span.jr-kpi__v', valueNode, extra),
        h('span.jr-kpi__l', label));
      const countEl = h('span.jr-num', String(recent.length));
      const sleepEl = h('span.jr-num', sleep !== null ? u.fmtNum(sleep, 1) : '—');
      const energyEl = h('span.jr-num', energy !== null ? u.fmtNum(energy, 1) : '—');

      const bw = bodyweightSeries(list);
      const card = h('section.card.jr-pulse', { class: { 'anim-in': animate, 'has-bw': bw.length >= 2 }, attrs: { 'aria-labelledby': 'jr-pulse-t' } },
        h('div.jr-pulse__head',
          h('h3.jr-pulse__title#jr-pulse-t', 'Last 30 days'),
          streak >= 2
            ? h('span.badge.jr-streak', ic('flame', 14, animate ? 'flicker' : ''), plural(streak, 'day', 'days') + ' in a row')
            : h('span.jr-pulse__meta', plural(list.length, 'entry', 'entries') + ' total')),
        h('div.jr-kpis',
          kpi('.jr-kpi--count', recent.length === 1 ? 'Entry' : 'Entries', countEl),
          kpi('.jr-kpi--mood', moodR ? moodWord(moodR) : 'Mood',
            moodR ? h('span.jr-kpi__face', ic('mood-' + moodR, 30)) : h('span.jr-num', '—'), null, moodR ? MOOD_PLATE[moodR] : null),
          kpi('.jr-kpi--sleep', 'Sleep', sleepEl, sleep !== null ? h('small.jr-kpi__u', 'h') : null),
          kpi('.jr-kpi--energy', 'Energy', energyEl, energy !== null ? ic('bolt', 16, 'jr-kpi__bolt') : null)));

      if (bw.length >= 2) {
        const U_ = units();
        const first = bw[0];
        const last = bw[bw.length - 1];
        const a = toDisp(first.kg);
        const b = toDisp(last.kg);
        const diff = u.round(b - a, 1);
        const span = u.diffDays(first.date, last.date);
        const spanText = span < 14 ? plural(span, 'day', 'days') : Math.round(span / 7) + ' wks';
        const valueEl = h('span.jr-bw__num', u.fmtNum(b, 1));
        card.append(h('div.jr-bw',
          h('div.jr-bw__head',
            h('span.jr-bw__label', ic('scale', 16), 'Bodyweight'),
            h('span.jr-bw__now', valueEl, h('small', U_)),
            h('span.jr-bw__delta', { class: { 'is-flat': diff === 0 } },
              diff !== 0 ? ic(diff > 0 ? 'arrow-up' : 'arrow-down', 14) : null,
              (diff > 0 ? '+' : diff < 0 ? '−' : '±') + u.fmtNum(Math.abs(diff), 1) + ' ' + U_ + ' · ' + spanText)),
          F.charts.line({
            points: bw.map((pt) => ({ x: pt.date, y: toDisp(pt.kg), label: u.fmtDate(pt.date, 'dm') + ': ' + u.fmtWeight(pt.kg) })),
            height: 132, color: 'var(--plate-yellow)', dots: bw.length <= 24,
            fmtY: (n) => u.fmtNum(n, 1)
          })));
        if (animate) u.countUp(valueEl, b, { from: a, duration: 900, format: (n) => u.fmtNum(n, 1) });
      } else if (bw.length === 1) {
        card.append(h('div.jr-bw.jr-bw--one',
          h('span.jr-bw__label', ic('scale', 16), 'Bodyweight'),
          h('span.jr-bw__one', h('b', u.fmtWeight(bw[0].kg)), ' · log another weigh-in to see your trend')));
      }
      pulseSlot.append(card);
      if (animate) {
        u.countUp(countEl, recent.length, { duration: 700, format: (n) => String(Math.round(n)) });
        if (sleep !== null) u.countUp(sleepEl, sleep, { duration: 800, format: (n) => u.fmtNum(n, 1) });
        if (energy !== null) u.countUp(energyEl, energy, { duration: 800, format: (n) => u.fmtNum(n, 1) });
      }
    }

    /* ---- cards ------------------------------------------------------------------------- */
    function boltsRO(v) {
      const out = h('span.rating.rating--static.jr-bolts', { attrs: { role: 'img', 'aria-label': 'Energy ' + v + ' of 5' } });
      for (let i = 1; i <= 5; i++) out.append(h('span.rating__opt', { class: { 'is-on': i <= v } }, ic('bolt', 14)));
      return out;
    }
    function trainedBadge(iso) {
      let trained = false;
      try { trained = F.q.trainedOn(iso); } catch (_) { trained = false; }
      if (!trained) return null;
      let sessions = [];
      try { sessions = F.q.sessionsOn(iso) || []; } catch (_) { sessions = []; }
      const s0 = sessions[0];
      return h('span.badge.badge--plate.jr-trained', { dataset: { plate: s0 ? plateOfSession(s0) : 'red' }, title: 'Workout logged this day' },
        ic('dumbbell', 14),
        h('span.jr-trained__t', (s0 && str(s0.title)) || 'Trained'),
        sessions.length > 1 ? h('span.jr-trained__more', '+' + (sessions.length - 1)) : null);
    }
    function entryCard(e, terms) {
      const tp = textParts(e);
      const mood = validRating(e.mood);
      const energy = validRating(e.energy);
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const metrics = [];
      if (energy) metrics.push(boltsRO(energy));
      if (isNum(e.sleep)) metrics.push(h('span.jr-ro', { title: 'Sleep' }, ic('bed', 16), u.fmtNum(Number(e.sleep), 1) + ' h'));
      if (isNum(e.bodyweight)) metrics.push(h('span.jr-ro', { title: 'Bodyweight' }, ic('scale', 16), u.fmtWeight(Number(e.bodyweight))));
      const badge = trainedBadge(e.date);
      return h('button.jr-entry', {
        type: 'button', class: { 'has-mood': !!mood },
        dataset: { id: e.id, plate: mood ? MOOD_PLATE[mood] : undefined },
        onClick: () => openEditor({ id: e.id })
      },
      h('span.sr-only', u.fmtDate(e.date, 'full') + '. '),
      h('span.jr-entry__top',
        h('span.jr-entry__when', relLabel(e.date)),
        mood ? h('span.jr-entry__mood', ic('mood-' + mood, 24), h('span.jr-entry__moodword', moodWord(mood))) : null),
      h('span.jr-entry__title', { class: { 'is-auto': !tp.title } }, marked(tp.title || autoTitle(e), terms)),
      tp.body ? h('span.jr-entry__text', marked(snippet(tp.body, terms), terms)) : null,
      badge || tags.length ? h('span.jr-entry__tags', badge,
        tags.map((t) => h('span.jr-tag', { class: { 'is-match': filter.tag === t } }, h('span.jr-tag__hash', '#'), marked(t, terms)))) : null,
      metrics.length ? h('span.jr-entry__metrics', metrics) : null);
    }
    function pinCard(e, terms, i) {
      const tp = textParts(e);
      const tags = Array.isArray(e.tags) ? e.tags : [];
      return h('button.jr-pin', { type: 'button', dataset: { id: e.id }, style: { '--i': i }, onClick: () => openEditor({ id: e.id }) },
        h('span.jr-pin__head',
          h('span.jr-pin__icon', ic('pin', 16)),
          h('span.jr-pin__title', marked(tp.title || autoTitle(e), terms))),
        tp.body ? h('span.jr-pin__text', marked(snippet(tp.body, terms), terms)) : null,
        tags.length ? h('span.jr-pin__tags', tags.slice(0, 4).map((t) => h('span', '#', marked(t, terms)))) : null);
    }
    function dateBlock(iso) {
      return h('div.jr-date', { class: { 'is-today': iso === today }, attrs: { 'aria-hidden': 'true' } },
        h('span.jr-date__wd', iso === today ? 'Today' : u.fmtDate(iso, 'wd')),
        h('span.jr-date__d', u.fmtDate(iso, 'day')));
    }
    function todaySlot() {
      const picker = F.ui.moodPicker({
        size: 'sm', label: 'How was today?',
        onChange: (v) => {
          if (!v) return;
          setTimeout(() => {
            if (!ctx.isActive()) return;
            openEditor({ date: today, mood: v });
            picker.setValue(null);
          }, reduced() ? 0 : 180);
        }
      });
      return h('div.jr-today',
        h('div.jr-today__txt',
          h('span.jr-today__title', 'How was today?'),
          h('span.jr-today__sub', 'Tap a face to start today’s entry.')),
        picker);
    }
    function moodBar(entries) {
      const counts = [0, 0, 0, 0, 0, 0];
      entries.forEach((e) => { const m = validRating(e.mood); if (m) counts[m]++; });
      const total = counts.reduce((a, b) => a + b, 0);
      if (!total) return h('span.jr-moodbar.is-empty', { attrs: { 'aria-hidden': 'true' } });
      const label = [5, 4, 3, 2, 1].filter((m) => counts[m]).map((m) => moodWord(m) + ' ' + counts[m]).join(', ');
      return h('span.jr-moodbar', { attrs: { role: 'img', 'aria-label': 'Moods: ' + label }, title: label },
        [5, 4, 3, 2, 1].filter((m) => counts[m]).map((m) => h('span.jr-moodbar__seg', { dataset: { plate: MOOD_PLATE[m] }, style: { flexGrow: counts[m] } })));
    }

    /* ---- results: pinned + timeline ---------------------------------------------------- */
    function renderResults(list, animate, viaFilter) {
      u.clear(resultsEl);
      if (viaFilter) replay(resultsEl, 'jr-swap');
      const terms = termsOf(filter.q);
      const filtering = terms.length > 0 || !!filter.tag;
      resultsEl.classList.toggle('is-filtering', filtering);
      const shown = list.filter((e) => matches(e, terms, filter.tag));
      liveEl.textContent = filtering ? plural(shown.length, 'entry matches', 'entries match') : '';

      if (filtering) {
        resultsEl.append(h('div.jr-resmeta',
          h('span.jr-resmeta__txt', h('b', String(shown.length)), ' of ' + plural(list.length, 'entry', 'entries')),
          shown.length ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onClick: clearFilters }, ic('x', 16), 'Clear filters') : null));
        if (!shown.length) {
          resultsEl.append(F.ui.empty({
            icon: 'search', title: 'No matches',
            text: 'Nothing in your journal matches ' + (terms.length ? '“' + filter.q.trim() + '”' : '') +
              (terms.length && filter.tag ? ' with ' : '') + (filter.tag ? '#' + filter.tag : '') + '. Try another word or tag.',
            action: { label: 'Clear filters', icon: 'x', onClick: clearFilters }
          }));
          return;
        }
      }

      const pins = shown.filter((e) => e.pinned === true);
      const rest = shown.filter((e) => e.pinned !== true);

      if (pins.length) {
        resultsEl.append(h('section.jr-pinned', { attrs: { 'aria-labelledby': 'jr-pinned-t' } },
          h('div.jr-sechead',
            h('h3.jr-sechead__title#jr-pinned-t', ic('pin', 18), 'Pinned'),
            h('span.jr-sechead__meta', String(pins.length))),
          h('div.jr-pins', { class: { stagger: animate, 'is-single': pins.length === 1 } }, pins.map((e, i) => pinCard(e, terms, i)))));
      } else if (!filtering) {
        resultsEl.append(h('button.jr-pinhint', {
          type: 'button',
          onClick: () => openEditor({ date: today, pinned: true, tags: ['goal'], title: 'My goals' })
        }, h('span.jr-pinhint__icon', ic('target', 20)),
        h('span.jr-pinhint__txt', h('b', 'Pin a goal'), h('span', 'Keep goals and form tips at the top of your journal.')),
        ic('plus', 20, 'jr-pinhint__plus')));
      }

      const needSlot = !filtering && !rest.some((e) => e.date === today);
      const items = rest.slice(0, limit);
      if (!items.length && !needSlot) {
        if (!filtering) {
          resultsEl.append(h('p.jr-note', 'Only pinned notes so far. Your day-to-day entries will line up here by date.'));
        }
        return;
      }

      // month → date → entries (newest first)
      const months = new Map();
      const put = (iso, e) => {
        const mk = iso.slice(0, 7);
        if (!months.has(mk)) months.set(mk, new Map());
        const days = months.get(mk);
        if (!days.has(iso)) days.set(iso, []);
        if (e) days.get(iso).push(e);
      };
      if (needSlot) put(today, null);
      items.forEach((e) => put(e.date, e));
      const monthTotals = u.groupBy(rest, (e) => e.date.slice(0, 7));

      const tl = h('section.jr-timeline', { attrs: { 'aria-label': 'Timeline' } });
      let i = 0;
      Array.from(months.keys()).sort().reverse().forEach((mk) => {
        const all = monthTotals[mk] || [];
        const y = mk.slice(0, 4);
        const monthName = u.MONTH_LONG[Number(mk.slice(5, 7)) - 1] || mk;
        const days = months.get(mk);
        const daysEl = h('div.jr-days', { class: { stagger: animate } });
        Array.from(days.keys()).sort().reverse().forEach((iso) => {
          const entries = days.get(iso);
          daysEl.append(h('div.jr-day', { dataset: { date: iso }, style: { '--i': i++ } },
            dateBlock(iso),
            h('div.jr-day__list', entries.length ? entries.map((e) => entryCard(e, terms)) : todaySlot())));
        });
        tl.append(h('section.jr-month', { attrs: { 'aria-label': monthName + ' ' + y } },
          h('div.jr-month__head',
            h('h3.jr-month__title', monthName, y !== today.slice(0, 4) ? h('span.jr-month__year', ' ' + y) : null),
            h('span.jr-month__meta', plural(all.length, 'entry', 'entries')),
            moodBar(all)),
          daysEl));
      });
      resultsEl.append(tl);

      if (rest.length > items.length) {
        const left = rest.length - items.length;
        resultsEl.append(h('button.btn.btn--secondary.btn--block.jr-more', {
          type: 'button',
          onClick: () => {
            const before = resultsEl.querySelectorAll('.jr-entry').length;
            limit += PAGE;
            renderResults(allEntries(), false, false);
            // keep keyboard / screen-reader users in place: focus the first newly shown entry
            const next = resultsEl.querySelectorAll('.jr-entry')[before];
            if (next) { try { next.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
          }
        }, ic('chevron-down', 18), 'Show older entries (' + left + ')'));
      }

      if (freshId) {
        const id = freshId;
        freshId = null;
        spotlight(id);
      }
    }

    function renderEmpty() {
      u.clear(resultsEl);
      const starter = (icon, title, sub, onClick) => h('button.jr-starter', { type: 'button', onClick },
        h('span.jr-starter__icon', ic(icon, 22)),
        h('span.jr-starter__txt', h('b', title), h('span', sub)));
      resultsEl.append(h('div.jr-empty.stack', { class: 'anim-in' },
        F.ui.empty({
          icon: 'book',
          title: 'Your training diary',
          text: 'Log how each session felt, your mood, energy, sleep and bodyweight. Pin goals and form tips to the top. Patterns show up here over time.',
          action: { label: 'Write your first entry', icon: 'plus', onClick: () => openEditor({ date: today }) }
        }),
        h('div.jr-starters',
          h('p.eyebrow', 'Or start with'),
          h('div.jr-starters__row.stagger',
            [
              starter('target', 'Set a goal', 'Pinned note · #goal', () => openEditor({ date: today, pinned: true, tags: ['goal'], title: 'My goals' })),
              starter('check-circle', 'Form tips', 'Pinned note · #form', () => openEditor({ date: today, pinned: true, tags: ['form'], title: 'Form tips' })),
              starter('mood-4', 'Today’s check-in', 'Mood, energy, sleep', () => openEditor({ date: today }))
            ].map((b, i) => { b.style.setProperty('--i', String(i)); return b; })))));
    }

    /* ---- refresh ----------------------------------------------------------------------- */
    function refresh(animate) {
      const list = allEntries();
      renderDrafts();
      fab.hidden = !list.length; // the empty state carries its own big call to action
      if (!list.length) {
        filtersEl.hidden = true;
        u.clear(pulseSlot);
        liveEl.textContent = '';
        renderEmpty();
        return;
      }
      filtersEl.hidden = false;
      renderPulse(list, animate);
      renderChips(list);
      renderResults(list, animate, false);
    }

    /** Scroll an entry card into view and play the "fresh" animation on it. */
    function spotlight(id) {
      if (!ctx.isActive()) return;
      const card = Array.from(el.querySelectorAll('[data-id]')).find((n) => n.getAttribute('data-id') === id);
      if (!card) return;
      try {
        const r = card.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        if (r.top < 70 || r.bottom > vh - 90) card.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      } catch (_) { /* ignore */ }
      mark(card, 'is-fresh');
    }
    function spotlightDate(iso) {
      if (filter.q || filter.tag) clearFilters();
      const rest = allEntries().filter((e) => e.pinned !== true);
      const idx = rest.findIndex((e) => e.date === iso);
      if (idx >= limit) { limit = Math.ceil((idx + 1) / PAGE) * PAGE; renderResults(allEntries(), false, false); }
      const day = el.querySelector('.jr-day[data-date="' + iso + '"]');
      if (!day) return;
      try { day.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
      mark(day, 'is-spot');
    }

    // Extended FAB: shrinks to a round "+" while scrolling down, full label when scrolling up.
    let lastY = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY || 0;
        if (Math.abs(y - lastY) < 6) return;
        fab.classList.toggle('is-compact', y > lastY && y > 160);
        lastY = y;
      });
    };
    try { window.addEventListener('scroll', onScroll, { passive: true }); } catch (_) { /* ignore */ }
    ctx.onLeave(() => { try { window.removeEventListener('scroll', onScroll); } catch (_) { /* ignore */ } });

    const myHooks = {
      draftsChanged: () => { if (ctx.isActive()) renderDrafts(); },
      spotlight: (id) => setTimeout(() => spotlight(id), 30)
    };
    hooks = myHooks;

    refresh(true);

    ctx.onState((state, reason) => {
      if (hasReason(reason, ['journal', 'session', 'finish', 'settings'])) refresh(false);
    });

    /* ---- params (consumed once) -------------------------------------------------------- */
    if (firstVisit) {
      const wantsNew = p.new === true || p.new === 'true' || p.new === 1;
      const id = typeof p.id === 'string' && p.id ? p.id : null;
      const date = u.isISO(p.date) ? p.date : null;
      const mood = validRating(p.mood);
      if (wantsNew || id || date) {
        stripHistoryParams();
        setTimeout(() => {
          if (!ctx.isActive()) return;
          if (id) {
            if (findEntry(id)) openEditor({ id });
            else F.ui.toast('That journal entry no longer exists', { type: 'warn' });
            return;
          }
          if (wantsNew) { openEditor({ date: date || today, mood }); return; }
          const onDate = F.q.journalFor(date);
          if (onDate.length === 1) openEditor({ id: onDate[0].id });
          else if (!onDate.length) openEditor({ date, mood });
          else spotlightDate(date);
        }, 40);
      }
    }

    ctx.onLeave(() => {
      runSearch.cancel();
      if (hooks === myHooks) hooks = null;
      // Leaving the journal (not just re-rendering it) closes the editor; its draft is kept.
      setTimeout(() => {
        let cur = null;
        try { cur = F.router.current(); } catch (_) { cur = null; }
        if (editor && (!cur || cur.name !== 'journal')) editor.close('leave');
      }, 0);
    });
  }

  F.router.register('journal', { title: 'Journal', nav: 'journal', render });
})(window.Forge = window.Forge || {});
