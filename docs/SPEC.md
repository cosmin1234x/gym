# FORGE — Architecture & Build Contract

FORGE is a mobile-first workout planner + tracker ("stick to the plan" app) for one person training at
home with a **pull-up bar, dumbbells ("weights") and a flat/incline bench**, who loves **calisthenics**.
It has a weekly split (Mon Chest & Biceps · Tue Back & Triceps · Wed Shoulders & Forearms · Thu Legs ·
Fri Push · Sat/Sun off, with calisthenics variations throughout), live workout logging with a rest
timer, progress tracking & PRs, a water tracker, and a journal / notes.

This document is the single source of truth every contributor builds against. **Names, file paths,
function signatures, state shape, CSS tokens and class names below are a contract** — do not rename
them. If you need something the contract does not provide, implement it privately inside the files you
own; never edit files owned by someone else.

---------------------------------------------------------------------------------------------------

## 0. Hard constraints

* **No build step, no dependencies, no frameworks.** Plain HTML + CSS + vanilla JS (ES2020).
* **Classic scripts only** (`<script defer src>`), NOT ES modules — the site must work when
  `index.html` is opened straight from disk (`file://`), from any static host (GitHub Pages), and when
  every file is inlined into one HTML page (the claude.ai Artifact build, §11).
* Every file is an IIFE that attaches to the global namespace `window.Forge`:
  ```js
  (function (F) {
    'use strict';
    // ...
    F.util = { /* ... */ };
  })(window.Forge = window.Forge || {});
  ```
  Inside files, refer to the namespace as `F`. Never create other globals.
* **At load time a file may only define things and register itself** (e.g. `F.router.register(...)`).
  Cross-module calls happen at render/boot time (all scripts are loaded by then).
* **Security:** all user-entered text (names, notes, journal, custom exercise names, tags) is rendered
  with `textContent` / text nodes (`F.util.h` does this for string children). `innerHTML` is only
  allowed for trusted static markup (icon SVG strings shipped in the code).
* **Browser APIs that may be refused** (artifact sandbox, iOS, private mode): `localStorage`,
  `navigator.vibrate`, `AudioContext`, `navigator.wakeLock`, `serviceWorker`, `history.pushState`,
  clipboard. Wrap every use in `try/catch` / feature checks and degrade silently.
* **Never use `alert()`, `confirm()`, `prompt()`** — they are blocked in the artifact viewer. Use
  `F.ui.confirm` / `F.ui.prompt` / `F.ui.toast`.
* **Dates are local calendar dates** stored as ISO strings `'YYYY-MM-DD'` built from local
  `getFullYear/getMonth/getDate` — never `toISOString().slice(0,10)` (UTC bug). Timestamps are
  `Date.now()` numbers.
* **All weights are stored in kilograms.** Convert only for display/input via `F.util`.
* **Mobile first:** design at 360–430px wide first; must work to 1440px. No horizontal page scroll ever.
  Minimum tap target 44×44px. Inputs ≥ 16px font (prevents iOS zoom).
* **Motion:** animations everywhere for polish, but every animation must be disabled or reduced under
  `@media (prefers-reduced-motion: reduce)` (and JS checks `F.util.reducedMotion()`). Content must be
  visible at rest (never leave things at `opacity:0` waiting for JS).
* Accessibility: semantic buttons (`<button type="button">`), labels for inputs, visible
  `:focus-visible` rings, `aria-label` on icon-only buttons, `aria-live` for toasts & timers.

---------------------------------------------------------------------------------------------------

## 1. File layout & ownership

```
index.html                  shell markup + <link>/<script> tags            [SHELL]
manifest.webmanifest, sw.js, assets/icon.svg, assets/icon-maskable.svg,
.nojekyll                                                                   [SHELL]
css/tokens.css              design tokens (both themes)                     [DESIGN]
css/base.css                reset, typography, layout utilities             [DESIGN]
css/components.css          buttons, cards, chips, inputs, sheets, toasts…  [DESIGN]
css/shell.css               topbar, tabbar, sidebar, view transitions       [SHELL]
css/picker.css              exercise picker / exercise info / custom form   [EXERCISES]
css/views/<view>.css        one per view, scoped under .v-<view>            [VIEW:<view>]
js/core/util.js             helpers (§3)                                    [DATA]
js/core/icons.js            icon set (§4)                                   [DESIGN]
js/data/exercises.js        exercise library (§6)                           [EXERCISES]
js/data/program.js          default split, templates, quotes, split info    [EXERCISES]
js/core/store.js            state + mutations (§5)                          [DATA]
js/core/queries.js          derived data / selectors (§7)                   [DATA]
js/core/persist.js          localStorage + claude.ai cloud sync (§8)        [DATA]
js/core/ui.js               UI kit (§9)                                     [DESIGN]
js/core/charts.js           SVG charts (§9.2)                               [DESIGN]
js/core/picker.js           exercise picker, info sheet, custom form (§6.3) [EXERCISES]
js/core/router.js           view registry + navigation (§10)                [SHELL]
js/views/today.js           Today dashboard                                 [VIEW:today]
js/views/plan.js            Weekly split editor                             [VIEW:plan]
js/views/workout.js         Live workout logger + F.restTimer               [VIEW:workout]
js/views/library.js         Exercise library                                [VIEW:library]
js/views/progress.js        Progress, history, records                      [VIEW:progress]
js/views/water.js           Water tracker                                   [VIEW:water]
js/views/journal.js         Journal & notes                                 [VIEW:journal]
js/views/settings.js        Settings & data                                 [VIEW:settings]
js/app.js                   boot                                            [SHELL]
tests/*.test.mjs            node:test unit tests                            [DATA]
tools/build-artifact.mjs    single-file build (§11)                          [INTEGRATION]
```

### Load order (index.html)

CSS: `tokens.css, base.css, components.css, shell.css, picker.css, views/today.css, views/plan.css,
views/workout.css, views/library.css, views/progress.css, views/water.css, views/journal.css,
views/settings.css`.

JS (all `defer`, in this order): `core/util.js, core/icons.js, data/exercises.js, data/program.js,
core/store.js, core/queries.js, core/persist.js, core/ui.js, core/charts.js, core/picker.js,
core/router.js, views/today.js, views/plan.js, views/workout.js, views/library.js, views/progress.js,
views/water.js, views/journal.js, views/settings.js, app.js`.

Google Fonts (the only external resource):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800;900&family=Big+Shoulders+Stencil+Display:wght@800&family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">
```

---------------------------------------------------------------------------------------------------

## 2. Visual identity — "Iron & Chalk"

Subject world: a home gym. Rubber floor tiles, chalk, knurled steel, and **Olympic bumper-plate colours**
(red 25 kg, blue 20 kg, yellow 15 kg, green 10 kg, white 5 kg). Plate colours are the semantic colour
system: every muscle group / training day wears a plate colour.

* **Dark theme = "Iron"** (default look): warm rubber-black floor, charcoal steel surfaces, chalk-white
  text, plate-red primary accent.
* **Light theme = "Chalk"**: chalk-dust off-white, steel-grey lines, near-black ink, same plate colours
  (slightly deepened for contrast).
* **Type:** `Big Shoulders Display` (condensed, athletic, uppercase headings & big numbers — weights 800/900
  for display, 700 for sub-heads); `Big Shoulders Stencil Display` 800 only for the FORGE wordmark and
  rare stencil stamps (like paint on a gym wall); `Barlow` for body/UI; `Barlow Semi Condensed` for
  labels, eyebrows, table heads, numeric data (`font-variant-numeric: tabular-nums`).
* Texture: a very subtle noise/"chalk dust" overlay on the page background (tiny inline SVG
  `feTurbulence` data URI, low opacity) — optional, must not hurt perf.
* Motion language: snappy "plate slam" — quick ease-out entrances (fade-up 8–12px, 180–320ms), springy
  pops for checks/PRs, staggered card entrances, rings/bars animate from 0, confetti in plate colours for
  big moments (workout finished, water goal hit, PR).

### 2.1 Tokens (css/tokens.css) — names are contract

Dark-first pattern (required by the artifact host):
```css
:root { /* DARK "Iron" values */ color-scheme: dark; ... }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { /* LIGHT "Chalk" values */ color-scheme: light; } }
:root[data-theme="light"] { /* same LIGHT values */ color-scheme: light; }
```
Every colour token is first defined on bare `:root`; theme blocks only redefine. Components never use
literal colours — only tokens (`color-mix()` on tokens is fine).

| token | purpose |
|---|---|
| `--bg` | page background (rubber floor) |
| `--bg-2` | slightly raised page band (sidebar, tabbar) |
| `--surface` | cards |
| `--surface-2` | inputs, nested blocks, hovered rows |
| `--surface-3` | pressed / selected fills |
| `--line` | hairline borders |
| `--line-strong` | stronger borders, dividers on surface-2 |
| `--fg` | main text (chalk) |
| `--fg-2` | secondary text |
| `--muted` | tertiary text / captions |
| `--faint` | disabled, placeholder, chart grid |
| `--accent` | primary accent = plate red |
| `--accent-2` | hover/pressed accent |
| `--accent-fg` | text/icons on accent fills |
| `--accent-soft` | translucent accent tint for backgrounds |
| `--ok`, `--warn`, `--danger` | semantic states (separate from accent) |
| `--water`, `--water-2`, `--water-soft` | water tracker |
| `--plate-red`, `--plate-blue`, `--plate-yellow`, `--plate-green`, `--plate-white`, `--plate-orange`, `--plate-violet`, `--plate-teal` | plate palette |
| `--m-chest` (red) `--m-back` (blue) `--m-biceps` (yellow) `--m-triceps` (green) `--m-shoulders` (orange) `--m-legs` (violet) `--m-forearms` (teal) `--m-core` (white) `--m-fullbody` (white) | muscle colours (aliases of plates) |
| `--shadow-1`, `--shadow-2`, `--glow` | elevation / accent glow |
| `--r-xs` 6px, `--r-sm` 10px, `--r-md` 14px, `--r-lg` 20px, `--r-xl` 28px, `--r-pill` 999px | radii |
| `--font-display`, `--font-stencil`, `--font-body`, `--font-label` | font stacks (with fallbacks: `"Oswald", "Arial Narrow", Impact, system-ui, sans-serif` for display; `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` for body) |
| `--fs-xs` 12px `--fs-sm` 14px `--fs-md` 16px `--fs-lg` 18px `--fs-xl` 22px `--fs-2xl` 28px `--fs-3xl` 40px `--fs-4xl` 56px (use `clamp()` where sensible) | type scale |
| `--sp-1` 4px `--sp-2` 8px `--sp-3` 12px `--sp-4` 16px `--sp-5` 20px `--sp-6` 24px `--sp-7` 32px `--sp-8` 48px | spacing |
| `--ease-out` `cubic-bezier(.2,.8,.2,1)`, `--ease-spring` `cubic-bezier(.34,1.56,.64,1)`, `--dur-1` 140ms, `--dur-2` 240ms, `--dur-3` 420ms | motion |
| `--topbar-h` 56px, `--tabbar-h` 68px, `--sidebar-w` 248px, `--content-max` 760px, `--gutter` 16px | layout |

**Plate helper:** any element with `data-plate="red|blue|yellow|green|white|orange|violet|teal"` gets
`--plate: var(--plate-<colour>)` (defined in tokens.css). Components use `var(--plate, var(--accent))`.
Muscle → plate mapping (also in `F.data.program.MUSCLES`): chest→red, back→blue, biceps→yellow,
triceps→green, shoulders→orange, legs→violet, forearms→teal, core→white, fullbody→white.

---------------------------------------------------------------------------------------------------

## 3. `F.util` (js/core/util.js) [DATA]

```js
F.util = {
  // DOM
  h(tag, props?, ...children) -> HTMLElement
      // tag: 'div', or shorthand 'button.btn.btn--primary#id'
      // props: { class|className: string|string[] (falsy entries dropped), style: string|object,
      //          dataset: {}, attrs: {} (setAttribute), text, html (TRUSTED ONLY), value, checked,
      //          disabled, hidden, id, type, name, placeholder, for, role, tabindex, title,
      //          'aria-*' / 'data-*' keys (setAttribute), ref: fn(el),
      //          on: {click: fn, ...} and onClick/onInput/... (addEventListener, lowercased) }
      // children: string|number -> text node; Node; arrays (flattened); null/undefined/false/true skipped
  svgEl(markup) -> Element          // parse TRUSTED static svg string
  esc(str) -> string                // HTML-escape
  $(sel, root = document), $$(sel, root = document) -> Array
  clear(el) -> el
  uid(prefix = '') -> string        // unique-enough id
  clamp(n, min, max), round(n, dp = 0), sum(arr, fn?), avg(arr, fn?), maxBy(arr, fn), groupBy(arr, fn) -> {key: [...]}
  debounce(fn, ms), throttle(fn, ms), clone(obj) /* JSON deep clone */, wait(ms) -> Promise
  // dates (ISO = local 'YYYY-MM-DD')
  DAY_KEYS: ['mon','tue','wed','thu','fri','sat','sun'],
  DAY_SHORT: { mon: 'Mon', ... }, DAY_LONG: { mon: 'Monday', ... },
  todayISO(), toISO(date), fromISO(iso) -> Date (local midnight), addDays(iso, n) -> iso,
  diffDays(aIso, bIso) -> int (b - a, DST-safe), dayKeyOf(iso) -> 'mon'..'sun',
  weekStart(iso) -> iso of that week's Monday, weekDates(iso) -> [7 isos Mon..Sun], isToday(iso),
  fmtDate(iso, style = 'short')     // 'short' 'Tue 30 Sep' | 'long' 'Tuesday 30 September' | 'dm' '30 Sep' | 'month' 'September 2026' | 'day' '30' | 'wd' 'Tue'
  fmtRelDay(iso) -> 'Today' | 'Yesterday' | 'Tomorrow' | fmtDate(iso,'short')
  fmtTime(ts) -> '18:42', fmtClock(sec) -> '1:05' / '1:02:03', fmtDuration(sec) -> '1h 05m' | '42m' | '35s'
  fmtNum(n, dp = 0) -> '12,450'
  // units — storage is ALWAYS kg
  LB_PER_KG: 2.20462,
  toDisplayWeight(kg, units) -> number (rounded to 0.1, trailing zeros trimmed by fmt),
  fromDisplayWeight(value, units) -> kg (number),
  fmtWeight(kg, units, { unit = true } = {}) -> '22.5 kg' | '49.6 lb' | '—' for null,
  fmtVolume(kg, units) -> '12,450 kg',
  fmtMl(ml) -> '750 ml' | '2.25 L' (>= 1000),
  e1rm(kg, reps) -> number (Epley kg*(1+reps/30); reps<=0 or !kg -> 0; reps===1 -> kg),
  parseTarget(str) -> { reps: number|null, secs: number|null, amrap: bool }   // '8-12'→{reps:8}, '30s'→{secs:30}, 'AMRAP'→{amrap:true}, '12'→{reps:12}, '1:00'→{secs:60}
  // feedback
  haptic(pattern = 12)              // navigator.vibrate if settings.vibrate; try/catch
  beep(kind = 'end')                // 'end' | 'tick' | 'pr' | 'done'; WebAudio; respects settings.sound; lazy AudioContext unlocked on first pointerdown
  reducedMotion() -> bool
  countUp(el, to, { from = 0, duration = 700, format = n => fmtNum(n) } = {})
  storage: { get(key, fallback), set(key, value) -> bool, remove(key) }   // JSON localStorage, try/catch
};
```

---------------------------------------------------------------------------------------------------

## 4. Icons (js/core/icons.js) [DESIGN]

`F.icons` = map name → trusted SVG string (24×24 viewBox, `fill="none" stroke="currentColor"
stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`, hand-drawn original paths).
`F.icon(name, { size = 20, cls = '', label } = {}) -> SVGElement` (aria-hidden unless `label`).
Unknown name → a neutral fallback glyph (never throws).

Required names: `home calendar dumbbell play pause stop chart droplet book settings plus minus check x
chevron-left chevron-right chevron-up chevron-down trash edit grip search filter timer flame trophy star
note clock undo download upload moon sun monitor info bar bench bolt heart arrow-up arrow-down more repeat
target glass bottle sparkle check-circle plate list user cloud cloud-off device pin tag copy skip bed
body scale mood-1 mood-2 mood-3 mood-4 mood-5`
(`bar` = pull-up bar, `bench` = weight bench, `plate` = weight plate, `body` = calisthenics figure,
`scale` = bodyweight scale, `mood-1..5` = faces from miserable to ecstatic).

---------------------------------------------------------------------------------------------------

## 5. State & store (js/core/store.js) [DATA]

### 5.1 State shape (version 1)

```js
{
  version: 1,
  settings: {
    name: '',                     // athlete name for greetings
    units: 'kg',                  // 'kg' | 'lb'
    theme: 'auto',                // 'auto' | 'dark' | 'light'
    waterGoal: 3000,              // ml per day
    waterServings: [250, 500, 750],
    restSeconds: 90,              // default rest between sets
    sound: true, vibrate: true, keepAwake: true,
    equipment: { pullupBar: true, dumbbells: true, bench: true, barbell: false, bands: false },
    onboarded: false              // welcome card dismissed
  },
  plan: { days: { mon: PlanDay, tue: PlanDay, wed: PlanDay, thu: PlanDay, fri: PlanDay, sat: PlanDay, sun: PlanDay } },
  customExercises: [ Exercise ],  // user-created, custom: true
  sessions: [ Session ],          // completed workouts, ascending by startedAt
  active: Session | null,         // workout in progress (survives reloads)
  water: { 'YYYY-MM-DD': [ { id, ml, at } ] },
  journal: [ JournalEntry ],      // any order; sort when reading
  meta: { createdAt, updatedAt, stamps: { /* persist.js partition timestamps */ }, celebrated: { /* e.g. 'water:2026-09-30': true */ } }
}

PlanDay = { title: 'Chest & Biceps', rest: false, focus: ['chest','biceps'], items: [ PlanItem ] }
PlanItem = { id, exId, sets: 3, target: '8-12', rest: 90 | null /* null → settings.restSeconds */, note: '' }

Session = {
  id, date: 'YYYY-MM-DD', dayKey: 'mon'|…|null, title,
  startedAt, endedAt: number|null,
  exercises: [ SessionExercise ],
  note: '', feeling: 1..5 | null,
  rest: { endsAt, duration, exEntryId } | null      // only meaningful on state.active
}
SessionExercise = { id, exId, target: '8-12', rest: 90|null, note: '',
                    sets: [ { id, w: kg|null, r: int|null, t: secs|null, done: false, at: ts|null } ] }
  // exercise.type 'weight'     → uses w + r
  // exercise.type 'bodyweight' → uses r (+ optional added weight w, default null/0)
  // exercise.type 'time'       → uses t (seconds)

JournalEntry = { id, date: 'YYYY-MM-DD', createdAt, updatedAt, title: '', text: '',
                 mood: 1..5|null, energy: 1..5|null, sleep: hours|null, bodyweight: kg|null,
                 tags: ['pr','sore'], pinned: false }
```

### 5.2 Store API

```js
F.store = {
  init(loaded /* state|null from persist.loadLocal() */) -> state   // merges loaded over defaults(), migrates, never throws on garbage
  defaults() -> fresh default state (plan from F.data.program.defaultPlan())
  get() -> state                   // the live object; views treat it as READ-ONLY
  update(mutator, reason = '')     // mutator(state) mutates in place; then meta.updatedAt=now, notify, F.persist.schedule()
  replace(nextState, reason)       // wholesale (import / cloud load) — validates/merges like init
  subscribe(fn) -> unsubscribe     // fn(state, reason); notifications are batched per microtask (reasons joined by ' ')
  reset()                          // factory reset (keeps nothing)

  // settings
  setSetting(key, value)           // supports dotted keys: 'equipment.bench'
  // plan
  setDay(dayKey, patch)            // title / rest / focus / items
  addPlanItem(dayKey, exId, { sets, target, rest } = {}) -> item      // defaults from exercise.defaults
  updatePlanItem(dayKey, itemId, patch)
  removePlanItem(dayKey, itemId) -> { item, index }                   // for undo
  insertPlanItem(dayKey, item, index)                                 // undo helper
  movePlanItem(dayKey, itemId, toIndex)
  copyDay(fromKey, toKey)          // deep copy with fresh ids
  swapPlanItem(dayKey, itemId, newExId)   // keeps sets/target/rest unless the new exercise type differs (then its defaults)
  resetPlan()                      // back to F.data.program.defaultPlan()
  // custom exercises
  addCustomExercise(ex) -> ex (with id 'custom-…', custom: true)
  updateCustomExercise(id, patch), removeCustomExercise(id)
  // workout
  startWorkout({ dayKey, title, blank = false, items, templateId } = {}) -> active   // if an active workout exists, returns it unchanged
      // items: PlanItem-like [{exId, sets, target, rest}] to build from; templateId: F.data.program.templates id
      // (title defaults to the template title, dayKey to today's key). Priority: items > templateId > dayKey plan.
      // from plan: one SessionExercise per PlanItem, `sets` rows prefilled from the most recent
      // performance of that exercise (same set index, else its last set); with no history prefill
      // r/t from parseTarget(target) and w = null. date = todayISO(), dayKey defaults to today's key.
  addExerciseToActive(exId) -> SessionExercise
  removeExerciseFromActive(exEntryId) -> { entry, index }
  insertExerciseToActive(entry, index)
  moveActiveExercise(exEntryId, toIndex)
  swapActiveExercise(exEntryId, newExId)  // replaces exId; keeps the number of sets; undone sets re-prefilled for the new exercise; done sets kept only if same type
  addSet(exEntryId) -> set          // copies the previous set's values, done=false
  removeSet(exEntryId, setId)
  updateSet(exEntryId, setId, patch)   // patch of w/r/t (w in kg)
  toggleSet(exEntryId, setId) -> { done: bool, pr: PR|null }
      // marking done: at=now, and starts rest: active.rest = { endsAt: now + rest*1000, duration: rest, exEntryId }
      // where rest = entry.rest ?? settings.restSeconds. PR detection via F.q.checkPR (§7).
  setRest(restObj|null)            // rest timer control (null = skip/clear)
  setActiveField(key, value)       // 'title' | 'note' | 'feeling'
  setExerciseNote(exEntryId, text)
  finishWorkout({ note, feeling } = {}) -> { session, stats, prs } | null
      // drops undone sets and exercises with no done sets; if nothing was done returns null and leaves active untouched
      // pushes to sessions, clears active. stats = F.q.sessionStats(session); prs = F.q.sessionPRs(session)
  discardWorkout()
  updateSession(id, patch), deleteSession(id) -> { session, index }, restoreSession(session)
  // water
  addWater(ml, iso = todayISO()) -> entry
  removeWater(iso, entryId) -> entry
  restoreWater(iso, entry)
  // journal
  saveJournal(entry) -> entry      // upsert by id (creates id/createdAt when missing), sets updatedAt
  deleteJournal(id) -> entry, restoreJournal(entry)
  // misc
  markCelebrated(key)              // meta.celebrated[key] = true
};
PR = { exId, kind: 'e1rm'|'weight'|'reps'|'time', value, prev }
```

Every mutation goes through `update()` so subscribers re-render and persistence runs. Mutations on a
missing id are silent no-ops (never throw).

---------------------------------------------------------------------------------------------------

## 6. Exercise domain [EXERCISES]

### 6.1 Exercise shape (js/data/exercises.js → `F.data.exercises` = array)

```js
{ id: 'db-bench-press', name: 'Dumbbell Bench Press',
  muscle: 'chest',                                  // primary: chest|back|biceps|triceps|shoulders|forearms|legs|core|fullbody
  pattern: 'h-push',                                // movement pattern used to find swaps (see §6.4)
  alts: ['decline-push-up'],                        // optional hand-picked extra swap candidates
  secondary: ['triceps','shoulders'],
  equipment: ['dumbbells','bench'],                 // subset of: bodyweight, pullupBar, dumbbells, bench, barbell, bands
  type: 'weight' | 'bodyweight' | 'time',
  calisthenics: false,                              // true for bodyweight/bar skills
  level: 'beginner' | 'intermediate' | 'advanced',
  defaults: { sets: 3, target: '8-12', rest: 90 },
  cues: ['Feet planted, slight arch', 'Lower to mid-chest', 'Press up and slightly in'],
  custom: false }
```
Library of 70+ exercises tailored to pull-up bar + dumbbells + bench + bodyweight, with a strong
calisthenics section (pull-up/chin-up variations, dips on bench, push-up progressions, pike/handstand
work, L-sit, hollow body, hanging leg raises, toes-to-bar, dragon flag, pistol progressions, skin-the-cat,
muscle-up negatives, archer variations, planks…). A few barbell moves exist but are hidden unless
`settings.equipment.barbell`.

### 6.2 Program (js/data/program.js → `F.data.program`)

```js
F.data.program = {
  MUSCLES: { chest: { label: 'Chest', plate: 'red' }, back: {…'blue'}, biceps: {…'yellow'}, triceps: {…'green'},
             shoulders: {…'orange'}, forearms: { label: 'Forearms', plate: 'teal' }, legs: {…'violet'}, core: {…'white'},
             fullbody: { label: 'Full body', plate: 'white' } },
  EQUIPMENT: { bodyweight: { label: 'Bodyweight', icon: 'body' }, pullupBar: { label: 'Pull-up bar', icon: 'bar' },
               dumbbells: { label: 'Dumbbells', icon: 'dumbbell' }, bench: { label: 'Bench', icon: 'bench' },
               barbell: { label: 'Barbell', icon: 'plate' }, bands: { label: 'Bands', icon: 'repeat' } },
  splitInfo: { name, aka: [...], summary, why: [...], howToProgress: [...] },   // explains the user's split (see below)
  defaultPlan() -> { days: {...} }       // fresh ids each call
  templates: [ { id, title, focus: [...], description, restDay: bool, items: [ { exId, sets, target, rest } ] } ],
      // restDay: true marks the optional light calisthenics sessions offered on Sat/Sun
  restDayTemplateIds: ['calisthenics-flow', ...],   // offered on rest days ("Optional: Calisthenics Flow")
  quotes: [ '…' ],                        // 40+ short original gym lines, no attributions
  quoteFor(iso) -> string                 // deterministic per day
  plateFor(muscleOrFocusArray) -> 'red' | …
};
```

**The user's split** (they asked "idk how the split is called"; updated by the user):
Mon Chest & Biceps · Tue Back & Triceps · Wed Shoulders & Forearms · Thu Legs · Fri Push · Sat & Sun off,
with calisthenics variations mixed into every day. Equipment: dumbbells, a pull-up bar and a bench.
* The whole week is a **5-day body-part split** — in gym slang a **"bro split"** (each day focuses on
  one or two body parts), finished with a **Push day** on Friday (chest, shoulders, triceps) that hits the
  pushing muscles a second time.
* The Mon/Tue pairing (Chest + Biceps, Back + Triceps) is an **"opposing-muscle" (antagonist-style)
  pairing**, sometimes called **"reverse push/pull"**: a big pushing muscle is paired with the small
  *pulling* arm muscle (and vice-versa), so the arm you train that day is fresh instead of pre-tired by
  the big lifts.
`splitInfo` must explain this plainly: `{ name: '5-Day Bro Split', aka: ['Body-part split',
'Opposing-muscle pairing (Mon/Tue)', 'Reverse push/pull'], summary, why: [...], howToProgress: [...] }`.

Default week (`defaultPlan`) — every training day mixes dumbbell/bench work with calisthenics variations:
* **mon** Chest & Biceps (focus chest, biceps) — DB bench press, incline DB press, DB fly, decline
  (feet-on-bench) push-ups, chin-ups, DB curl, hammer curl, incline DB curl.
* **tue** Back & Triceps (back, triceps) — pull-ups, one-arm DB row, chest-supported incline DB row,
  DB pullover, bench dips, overhead DB triceps extension, DB skull crusher, diamond push-ups.
* **wed** Shoulders & Forearms (shoulders, forearms) — seated DB shoulder press, pike push-ups (or
  feet-on-bench pike), lateral raise, DB reverse fly, DB shrug, DB wrist curl, reverse wrist curl,
  dead hang (grip), farmer's carry (timed).
* **thu** Legs (legs) — goblet squat, Bulgarian split squat (bench), DB Romanian deadlift, step-ups onto
  bench, box pistol squat to bench, hip thrust / glute bridge on bench, calf raises, hanging knee/leg raise.
* **fri** Push (chest, shoulders, triceps) — incline DB press, DB shoulder press or Arnold press,
  archer or decline push-ups, lateral raise, close-grip DB press, bench dips, DB kickback.
* **sat** Rest Day (`rest: true`, items []) — Today offers optional calisthenics flows (`restDayTemplateIds`).
* **sun** Rest Day (`rest: true`, items []).

### 6.3 Picker (js/core/picker.js → `F.picker`, css/picker.css)

```js
F.picker = {
  open({ title = 'Add exercises', multi = true, onPick(exIds) }) // sheet: search, muscle chips, "Calisthenics"
      // chip, "My equipment only" toggle (default on), list grouped by muscle with plate dot, type & equipment
      // icons, tap to select (check animation), sticky "Add N" button; "Create custom exercise" entry.
  info(exId, { extra: Node } = {})   // sheet with name, muscles, equipment, level, cues, defaults; `extra` appended
  customForm({ exercise = null, onSave(ex) } = {})  // create/edit custom exercise (name, muscle, type, equipment, default sets/target, cues)
  swap(exId, { title = 'Swap exercise', onPick(newExId) })  // sheet: "Calisthenics variations" section first,
      // then "Dumbbell & bench" alternatives (from F.q.alternatives), then "Browse all exercises" → open({multi:false})
};
```

### 6.4 Calisthenics variations & swaps

Every library exercise has a `pattern` (movement pattern): `h-push` (horizontal push: presses, push-ups),
`v-push` (overhead press, pike/handstand push-ups), `h-pull` (rows), `v-pull` (pull-ups, chin-ups,
pulldowns), `elbow-flex` (curls), `elbow-ext` (triceps extensions, dips, diamond push-ups), `fly`
(chest fly / pullover), `raise` (lateral/front/rear-delt raises), `shrug`, `wrist` (wrist curls,
grip holds), `carry`, `squat`, `hinge`, `lunge`, `calf`, `core-flex` (leg raises, V-ups), `core-stab`
(planks, hollow, L-sit), `hang` (dead hang, active hang), `skill` (muscle-up, skin the cat, handstand),
`conditioning` (burpees, jumps). `alts` optionally lists extra hand-picked swap ids.
`F.q.alternatives(exId) -> { calisthenics: Exercise[], weights: Exercise[] }`: exercises the user can do
(`canDo`), excluding exId, with the same pattern or listed in `alts` (either direction), then same
primary muscle; each list sorted: same pattern first, then level beginner→advanced; max 8 each.
Plan and Workout views offer **Swap** on every exercise (uses `F.picker.swap`), so any dumbbell move can
be turned into a calisthenics variation (and back) in two taps.

---------------------------------------------------------------------------------------------------

## 7. Queries (js/core/queries.js → `F.q`) [DATA]

Pure reads over `F.store.get()` (never mutate). Must be fast (called during render).
```js
F.q = {
  alternatives(exId) -> { calisthenics: Exercise[], weights: Exercise[] }   // §6.4
  exercise(id) -> Exercise            // library or custom; unknown → placeholder { id, name: 'Deleted exercise', muscle: 'fullbody', type: 'weight', equipment: [], cues: [], defaults: {...} }
  allExercises() -> Exercise[]        // library + custom
  owns(equipmentKey) -> bool          // 'bodyweight' always true
  canDo(ex) -> bool                   // every equipment owned
  dayPlan(dayKey) -> PlanDay
  planFor(iso) -> { dayKey, day: PlanDay }
  estimateMinutes(planDay) -> int     // Σ sets × (45s + rest) rounded to 5, min 5 (0 for rest days)
  sessionsOn(iso) -> Session[]
  sessionsBetween(fromIso, toIso) -> Session[]   // inclusive
  trainedOn(iso) -> bool
  lastSession() -> Session|null
  lastPerformance(exId, { before = Infinity } = {}) -> { date, sessionId, sets: [...] } | null  // most recent session (startedAt < before) containing exId, done sets only
  exerciseHistory(exId) -> [ { date, sessionId, topW, bestE1rm, totalReps, volume, maxT, sets } ]  // chronological
  bestFor(exId, { before = Infinity, exclude } = {}) -> { maxW, maxE1rm, maxR, maxT }  // over done sets of sessions (and optionally the active session's other sets)
  checkPR(exId, set, { before, exclude }) -> PR|null   // see rules below; only if prior history exists
  sessionStats(session) -> { volume (kg), sets, reps, durationSec, exercises, byMuscle: {chest: setCount, ...} }
  sessionPRs(session) -> PR[]
  recentPRs(limit = 10) -> [ PR & { date, sessionId } ]
  records() -> [ { exId, maxW, maxE1rm, maxR, maxT, date } ]   // per exercise ever performed
  totals() -> { workouts, volume, sets, reps, minutes }
  waterTotal(iso) -> ml
  waterDays(n = 7, endIso = today) -> [ { iso, ml, goal, hit } ] oldest→newest
  journalFor(iso) -> JournalEntry[]
  dayStatus(iso) -> { iso, dayKey, day, isRest, trained, water, waterHit, journaled, isToday, isFuture, missed }
       // missed = past, not rest, not trained, and iso >= first-use date (meta.createdAt)
  missionFor(iso) -> { items: [ {key:'train'|'water'|'journal', label, done} ], done, total, pct }
       // train item is done on rest days ("Rest & recover") automatically
  weekSummary(iso = today) -> { dates, days: [dayStatus x7], planned, done, volume, waterAvg }
  workoutStreak() -> int   // walk back from today: skip rest days; trained planned day → +1; today not yet trained → skip; missed → stop; extra sessions on rest days also +1. Stop at first-use date.
  waterStreak() -> int     // consecutive days goal hit (today counts only if hit, and doesn't break if not yet)
  consistency(days = 28) -> { planned, done, pct }  // only days since first use
  muscleSplit(days = 30) -> [ { muscle, sets } ] sorted desc
  weeklyVolume(weeks = 8) -> [ { weekStart, volume, sessions } ] oldest→newest
  heatmap(weeks = 16) -> [ { iso, level: 0..4, trained, isRest, future } ]   // Mon-aligned, ending this week
};
```
PR rules (`checkPR`): weight type → PR if `e1rm(w,r) > prev.maxE1rm` (kind 'e1rm') or `w > prev.maxW`
(kind 'weight'); bodyweight → PR if `r > prev.maxR` (kind 'reps') or `(w||0) > prev.maxW > 0`
(kind 'weight'); time → `t > prev.maxT` (kind 'time'). No PR when the exercise has no prior done sets
(first time is a baseline, not a PR).

---------------------------------------------------------------------------------------------------

## 8. Persistence (js/core/persist.js → `F.persist`) [DATA]

Two layers:
1. **localStorage** key `forge:v1` holds the whole state JSON (try/catch; quota errors → toast once
   via `F.ui && F.ui.toast`).
2. **claude.ai cloud** (only when running as a claude.ai Artifact): if `window.claude && typeof
   window.claude.use === 'function'` → `db = await claude.use('db')`, `user = await claude.use('user')`,
   `uid = user && await user.id()`; all three required, else stay local. Documents live in the viewer's
   private collection `data/users/<uid>` (3 segments = collection). State is partitioned into docs:
   `settings`, `plan`, `library` (customExercises), `active`, `meta`, `sessions-YYYY-MM`,
   `water-YYYY-MM`, `journal-YYYY-MM` (month = from date). Doc body: `{ v: <partition value>,
   updatedAt: ts }` (bodies must be objects, < 256 KiB).
   * Boot: render from local immediately; then `collection.get()`; per partition take the newer of
     local stamp (`meta.stamps[key]`) and cloud `updatedAt`; if cloud is empty but local has data, push
     local. After merging call `F.store.replace(merged, 'cloud')` only if something changed.
   * Save: debounce ~1s; diff each partition's JSON against the last synced JSON; write only changed
     docs, **one write at a time per doc** (serialize with a per-doc promise chain); delete docs for
     partitions that disappeared (e.g. last session of a month deleted). Update `meta.stamps[key]` when
     a partition changes (without triggering a notify loop).
   * On `visibilitychange` → visible (throttled ≥ 30 s): re-pull and merge (so phone + laptop stay in step).
   * Errors: `unavailable` → retry once after a random 1–3 s delay; `quota_exceeded` → toast; `revoked`
     / `not_granted` → fall back to local silently.

```js
F.persist = {
  loadLocal() -> state|null
  schedule()                      // called by store.update
  flush()                         // immediate local save (pagehide / hidden)
  connectCloud() -> Promise<void>
  status() -> 'local' | 'connecting' | 'cloud' | 'offline'
  onStatus(fn) -> unsubscribe
  exportJSON() -> string           // pretty JSON of the full state + { app: 'forge', exportedAt }
  importJSON(text) -> { ok: bool, error? }   // validates app/version, then F.store.replace(...)
  download(filename, text) -> Promise<bool>   // artifact: claude.use('downloads').save({filename, data}); else Blob + <a download>
};
```

---------------------------------------------------------------------------------------------------

## 9. UI kit (js/core/ui.js → `F.ui`, css/components.css) [DESIGN]

```js
F.ui = {
  toast(message, { type = 'info' /* info|ok|warn|error|pr */, action /* {label, onClick} */, duration = 3200, icon } = {})
  sheet({ title, subtitle, content /* Node | (close)=>Node */, actions /* [{label, variant, icon, onClick(close)}] */,
          size = 'auto' /* 'auto'|'full' */, onClose, dismissible = true, className }) -> { el, body, close }
      // bottom sheet (<720px wide) with drag handle + swipe-down-to-close; centered dialog on wide screens.
      // Esc closes, backdrop click closes, focus trapped & restored, body scroll locked, stacked sheets OK.
  confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) -> Promise<bool>
  prompt({ title, label, value = '', placeholder, type = 'text', inputmode, confirmLabel = 'Save' }) -> Promise<string|null>
  menu(items /* [{label, icon, danger, onClick}] */, { title } = {})   // action sheet
  ring({ size = 120, stroke = 10, value = 0 /* 0..1+ */, color = 'var(--accent)', track = 'var(--surface-2)', label, sublabel, className }) -> Element
  setRing(ringEl, value)             // animates stroke
  stepper({ id, value, step = 1, min = 0, max = 9999, decimals = 0, unit, label, onChange, size = 'md' }) -> Element  // − [input] +, long-press repeat
  segmented({ id, options /* [{value,label,icon}] */, value, onChange, label }) -> Element
  tabs({ id, tabs /* [{value,label,count}] */, value, onChange }) -> Element     // underline tabs with sliding indicator
  switchEl({ id, checked, onChange, label, hint }) -> Element
  chip({ label, active, plate, icon, onClick, count }) -> Element
  field({ label, input /* Node */, hint, id }) -> Element
  moodPicker({ id, value /* 1..5|null */, onChange, size = 'md' }) -> Element   // faces mood-1..5 w/ labels Rough/Meh/Okay/Good/Beast
  ratingDots({ value, max = 5, icon = 'bolt', onChange }) -> Element             // energy etc.
  progressBar({ value /* 0..1 */, plate, label }) -> Element
  empty({ icon, title, text, action /* {label, onClick, icon} */ }) -> Element
  confetti({ x, y, count = 90 } = {})     // canvas burst in plate colours; no-op if reduced motion
  celebrate({ title, subtitle, icon = 'trophy', plate = 'red' })   // big stamp overlay (≈1.4s) + confetti
  plateDot(muscleOrPlate) -> Element      // small coloured dot
};
```

### 9.1 CSS classes (components.css / base.css) — contract

Layout/typography (base.css): `.stack` (flex column, `gap: var(--gap, var(--sp-3))`), `.stack-lg`,
`.cluster` (flex wrap, gap, align center), `.row-between`, `.grid-2`, `.grid-auto` (auto-fill
minmax(160px,1fr)), `.scroll-x` (horizontal scroller w/o page overflow), `.h-display` (Big Shoulders
900, huge, uppercase, tight), `.h1`, `.h2`, `.h3`, `.eyebrow` (Barlow Semi Condensed, 12px, uppercase,
letter-spacing .12em, muted), `.muted`, `.faint`, `.num` (tabular nums, label font), `.big-num`
(display font number), `.sr-only`, `.truncate`, `.center`, `.mt-*`? (avoid; use gap).

Components (components.css): `.btn` + modifiers `--primary --secondary --ghost --danger --lg --sm
--icon --block --pill`; `.card` (+ `--flat --hero --interactive --plate` with `data-plate` stripe);
`.card__head .card__title .card__body .card__foot`; `.chip` (`.is-active`, `data-plate` dot),
`.chips` (scroll row); `.input .textarea .select` (+ `.input--lg` for set logging), `.field
.field__label .field__hint`; `.stepper`; `.seg` (segmented); `.tabs .tabs__tab .tabs__ink`; `.switch`;
`.list .list-row .list-row__main .list-row__meta`; `.badge` (+ `--ok --warn --accent --plate`);
`.divider`; `.empty`; `.ring`; `.progress`; `.plate-dot`; `.sheet .sheet__backdrop .sheet__panel
.sheet__handle .sheet__head .sheet__title .sheet__body .sheet__foot`; `.toast-stack .toast`
(`--ok --warn --error --pr`); `.mood .mood__opt`; `.rating`; `.skeleton`; `.kbd`; `.stat` (label +
big number tile) `.stat__label .stat__value .stat__unit`.

Animation utilities & keyframes: `.anim-in` (fade-up on mount), `.stagger > *` (children fade-up
with `animation-delay: calc(var(--i, 0) * 45ms)`; JS sets `style="--i:n"`), `.pop` (spring scale),
`.shake`, `.pulse`, `.flicker` (flame); keyframes `fg-fade-up`, `fg-fade`, `fg-pop`, `fg-shake`,
`fg-pulse`, `fg-flicker`, `fg-slide-up`, `fg-shimmer`, `fg-spin`, `fg-wave`, `fg-stamp`. All disabled
under reduced motion.

### 9.2 Charts (js/core/charts.js → `F.charts`) [DESIGN]

Responsive SVG (viewBox + `width:100%`), colours from tokens, text uses `var(--muted)`, animated draw-in
(respecting reduced motion), `<title>` tooltips on marks, and graceful empty state (0/1 point).
```js
F.charts = {
  line({ points /* [{x: iso|number, y, label?}] */, height = 180, color = 'var(--accent)', area = true, dots = true,
         fmtY = String, fmtX /* iso → 'dm' */, goal /* y */ }) -> Element
  bars({ bars /* [{label, value, plate?, highlight?, title?}] */, height = 150, goal, fmtY = String }) -> Element
  hbars({ rows /* [{label, value, plate}] */, fmt = String }) -> Element
  spark({ values, width = 96, height = 28, color = 'var(--accent)' }) -> Element
  heatmap({ cells /* F.q.heatmap() */, onCell(iso) }) -> Element      // 7 rows (Mon..Sun) × N weeks, month labels
};
```

---------------------------------------------------------------------------------------------------

## 10. Shell & router [SHELL]

### 10.1 index.html body (ids are contract)

```html
<div class="app" id="app">
  <aside class="sidebar" id="sidebar"> brand + nav (desktop ≥ 1024px) </aside>
  <header class="topbar" id="topbar">
    <a class="brand">FORGE wordmark</a> <h1 class="topbar__title" id="topbar-title"></h1>
    <div class="topbar__actions"> sync-status dot (#sync-dot), water quick button (#water-btn → 'water',
      shows a tiny fill level), settings button (#settings-btn) </div>
  </header>
  <main class="main" id="main"><div class="view-host" id="view"></div></main>
  <div class="rest-dock" id="rest-dock"></div>
  <nav class="tabbar" id="tabbar" aria-label="Main"> 5 tabs </nav>
  <div id="overlay-root"></div>
  <div class="toast-stack" id="toast-root" aria-live="polite"></div>
</div>
```
Tabs (mobile bottom bar, `data-nav`): `today` (Today, home), `plan` (Plan, calendar), `workout`
(Train, dumbbell — raised centre button in accent; shows a pulsing dot when a workout is active),
`progress` (Progress, chart), `journal` (Journal, book). Sidebar (desktop) shows the same plus
`water` (Water, droplet), `library` (Exercises, list), `settings` (Settings, settings).
Content column: centred, `max-width: var(--content-max)` (wider views may opt into 1100px), side
gutter ≥ 16px, bottom padding clears the tabbar + safe area + rest dock.
Safe areas: fixed bars add `env(safe-area-inset-*)` to their own padding.

### 10.2 Router (js/core/router.js → `F.router`)

```js
F.router = {
  register(name, { title /* string | (params)=>string */, nav /* nav key to highlight, default name */, wide = false,
                   render(el, params, ctx) /* may return a cleanup fn */ })
  start()                         // initial route from location.hash (bare token like '#water'), else 'today'
  go(name, params = {}, { replace = false } = {})
  back(fallback = 'today')
  current() -> { name, params }
  refresh()                       // re-render current view (after import / theme / cloud load)
};
ctx = { params, go, setTitle(text), rerender(), onState(fn) /* store subscription auto-removed on leave */, onLeave(fn) }
```
* Creates `<section class="view v-<name>" data-view="<name>">` inside `#view`, runs render, plays an
  enter animation (`view-enter` forward / `view-enter-back` when going back), scrolls to top.
* History: `history.pushState({name, params}, '', '#' + name)` (try/catch; hash is a bare token);
  `popstate` renders without pushing. Unknown route → 'today'.
* Highlights `[data-nav="<nav>"]` with `.is-active` + `aria-current="page"` in tabbar & sidebar.
* Sets `#topbar-title` and `document.title = '<Title> · FORGE'`.
* Views should update the DOM surgically for frequent interactions (typing weights, ticking sets)
  instead of re-rendering the whole view, so inputs keep focus and animations stay smooth. Use
  `ctx.rerender()` for coarse changes.

### 10.3 Boot (js/app.js → `F.app`)

```js
F.app = { version: '1.0.0', boot(), applyTheme(), keepAwake(on) -> Promise, isStandalone() }
```
boot: `F.store.init(F.persist.loadLocal())` → `applyTheme()` (settings.theme 'auto' removes our
data-theme only if we set it; 'dark'/'light' sets it; updates `<meta name="theme-color">`) → wire
nav/topbar → `F.restTimer && F.restTimer.mount(document.getElementById('rest-dock'))` →
`F.router.start()` → `F.persist.connectCloud()` → register `sw.js` only when
`location.protocol` is http(s), not framed (`window.top === window`, try/catch) and supported →
`pagehide`/`visibilitychange` → `F.persist.flush()`. Topbar water button + tabbar active-workout dot
update on store changes. Boot errors must show a readable fallback message instead of a blank page.

---------------------------------------------------------------------------------------------------

## 11. Artifact build (tools/build-artifact.mjs) [INTEGRATION]

`node tools/build-artifact.mjs` → `dist/forge.html`: a single file with `<title>` first, then the
Google Fonts `<link>`s, inlined `<style>` (all CSS in load order), the body markup, and inlined
`<script>`s (all JS in load order). No `<!doctype>`, `<html>`, `<head>`, `<body>` wrappers, no
manifest / service worker / icon links. The app must behave identically in that form (it detects
`window.claude` for cloud sync; router uses bare-token hashes; no alert/confirm/prompt).

---------------------------------------------------------------------------------------------------

## 12. Views (each owns js/views/<view>.js + css/views/<view>.css, root class `.v-<view>`)

Every view registers itself: `F.router.register('<view>', { title, render(el, params, ctx) {...} })`.
Views read state via `F.store.get()` / `F.q`, mutate only via `F.store.*` actions, subscribe with
`ctx.onState`. Page layout: a view header block (`.eyebrow` + `.h1`/`.h-display`), then content in
`.stack`. Show designed empty states (`F.ui.empty`) that say what will appear and how to add it.

* **today** — (rest days: calm "Rest Day" hero with recovery tips and an optional "Calisthenics Flow"
  button per `restDayTemplateIds` → `F.store.startWorkout({ templateId })` → workout) date eyebrow; greeting (settings.name); today's split day as a big display title on a plate-
  coloured hero card with est. minutes & exercise count and the primary CTA (Start / Resume / Done ✓ →
  summary / Rest day → "Train anyway"); welcome card while `!settings.onboarded` (name input, units,
  water goal, explains the split, "Let's go" → onboarded); week strip Mon–Sun with plate markers and
  done/missed/today/rest states (tap → plan day); **Daily mission** checklist (Train · Hydrate · Journal)
  with a completion ring; stats row (workout streak with flame, this week done/planned, 28-day
  consistency %); water card (mini ring/bottle + quick-add servings); journal quick card (mood picker →
  opens journal editor for today); last workout card; quote of the day; collapsible "About your split".
* **plan** — split name + one-line explainer (link to info sheet); 7-day selector (plate coloured, today
  marked; `params.day`); day editor: title (inline edit), rest-day switch, focus muscle chips; exercise
  list cards (plate dot, name, sets × target, rest, equipment icons, calisthenics badge) with **Swap**
  (`F.picker.swap` → `F.store.swapPlanItem`), edit sheet (sets stepper,
  target presets 5 / 6-8 / 8-12 / 12-15 / AMRAP / 30s / 45s / 60s + custom, rest stepper, note), move
  up/down, delete with undo toast, info (`F.picker.info`); "Add exercises" (`F.picker.open`); "Load
  template" (program.templates, confirm replace) / "Copy from day"; "Start this workout"; estimated time.
* **workout** — no active workout: start screen (today's plan hero → Start; other days' plans; "Empty
  workout" (prompt name); repeat a recent session). Active: sticky header (title, live elapsed clock,
  finish button) + a barbell-style progress bar that loads plates as sets complete; exercise cards (plate
  dot, name, target, "Last: 20 kg × 10 · 10 · 9", info, menu: swap (`F.picker.swap` →
  `F.store.swapActiveExercise`)/move/remove/note), set table rows
  (`#`, previous, kg|+kg, reps | seconds, ✓) with large inputs (`inputmode="decimal"`/`numeric`), check
  → row animates, haptic, rest timer starts, PR → `F.ui.celebrate` / toast; time-type sets have a hold
  stopwatch that fills seconds; add/remove set; add exercise (`F.picker.open`); workout note; finish →
  confirm if unfinished sets → summary sheet (duration, volume, sets, reps, PRs, feeling mood picker,
  note) → save → confetti → today; discard (confirm). Also defines **`F.restTimer`**: `{ mount(dockEl) }`
  — a floating pill above the tabbar while `state.active.rest` is running (countdown ring + m:ss,
  −15 s / +15 s / skip), beeps + vibrates + toasts at zero, survives navigation & reload; wake lock
  (`F.app.keepAwake`) while a workout is active and `settings.keepAwake`.
* **library** — search, muscle chips, Calisthenics chip, "My equipment" toggle, type filter; grouped
  list; tap → `F.picker.info(exId, { extra })` where extra shows your PRs + sparkline + "Add to plan day"
  (choose day) ; create / edit / delete custom exercises (`F.picker.customForm`).
* **progress** — tabs Overview | History | Exercises | Records (`params.tab`, `params.exId`). Overview:
  totals tiles (workouts, volume, time), streaks, 16-week heatmap, weekly volume bars (8 weeks), muscle
  split hbars (30 days). History: sessions grouped by month → detail sheet (sets, stats, note, delete with
  undo). Exercises: performed exercises with sparkline → detail (line chart of best e1RM / reps / hold,
  best sets, history). Records: PR board + recent PRs.
* **water** — big animated bottle with SVG wave filling to % of goal + count-up ml & %; quick-add
  servings, custom amount stepper; goal hit → `F.ui.celebrate` once per day (`meta.celebrated`); today's
  log with times, delete + undo; 7-day bars with goal line; water streak; tip line; goal/servings edit
  shortcut (→ settings).
* **journal** — pinned notes section + timeline grouped by month (mood face, date, title/snippet, tags,
  energy, bodyweight); search + tag filter; new entry FAB; editor sheet (`size:'full'`: date, mood
  picker, energy rating, sleep stepper, bodyweight input (units), title, text (autosaving draft), tags
  with suggestions `pr sore tired motivated diet sleep form goal`, pin toggle, delete); shows that day's
  workout summary inside the editor; bodyweight trend mini chart when ≥ 2 entries; `params.date` /
  `params.id` / `params.new` open the editor directly.
* **settings** — profile name; units (kg/lb); theme (Auto / Iron (dark) / Chalk (light)); water goal &
  serving sizes; default rest; sound / vibration / keep screen awake; my equipment switches; data: sync
  status (explains local vs claude.ai account sync), export backup (`F.persist.download`), import backup
  (file input + FileReader + confirm), reset plan to default split, erase everything (double confirm);
  about (version, split explainer).
