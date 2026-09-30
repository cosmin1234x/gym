# FORGE — Workout Planner & Tracker

**FORGE** is a mobile-first "stick to the plan" gym app for training at home with a **pull-up bar,
dumbbells and a bench**, with plenty of **calisthenics**. Plan your week, log every set with a rest
timer, watch your PRs climb, hit your water goal and keep a training journal — all in one place,
with a gritty home-gym look (rubber floor, chalk, bumper-plate colours).

No account, no install, no build step: it is a static website that runs entirely in your browser
and keeps working offline.

## Features

- **Weekly split planner** — comes pre-loaded with your split:
  **Mon Chest & Biceps · Tue Back & Triceps · Wed Calisthenics & Core · Thu Chest & Biceps (B) ·
  Fri Back & Triceps (B) · Sat Legs & Calisthenics · Sun Rest**. Add, remove, reorder and edit
  exercises (sets, rep targets like `8-12`, `AMRAP` or `30s` holds, rest time), load templates or
  copy one day onto another.
- **Live workout logging** — start today's plan in one tap, tick sets as you go (weights prefilled
  from last time), built-in **rest timer** with sound and vibration, hold stopwatch for timed
  exercises, and your screen stays awake while you train.
- **PRs & progress charts** — automatic personal records, streaks, a training heatmap, weekly
  volume, muscle balance, and per-exercise history charts.
- **Calisthenics library** — 70+ exercises that fit your equipment: pull-up and chin-up variations,
  dips, push-up progressions, pike/handstand work, L-sits, hollow holds, leg raises, pistols and
  more. You can add your own exercises too.
- **Water tracker** — quick-add glasses and bottles, a daily goal, a 7-day chart and a streak.
  The droplet in the top bar fills up as you drink.
- **Journal & notes** — mood, energy, sleep and bodyweight, tags, pinned notes and search.
- **Daily mission** — Train · Hydrate · Journal, so every day has a clear finish line.
- **Works offline & installs like an app** (PWA), light "Chalk" and dark "Iron" themes, kg or lb.
- **Backup & export** — download your data as a JSON file and restore it any time.

## Using it

**Easiest:** open `index.html` in your browser (double-click it). Everything works from the file,
though "install to home screen" and offline caching need it to be served from a web address (below).

**Host it free on GitHub Pages** (recommended for your phone):

1. Push this folder to a GitHub repository.
2. In the repository go to **Settings → Pages**.
3. Under *Build and deployment* choose **Deploy from a branch**, pick your branch (e.g. `main`)
   and the **/ (root)** folder, then **Save**.
4. After a minute your app is live at `https://<your-username>.github.io/<repo-name>/`.

**Run it locally:**

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

### Add it to your home screen

- **iPhone / iPad (Safari):** open the site → tap the **Share** button → **Add to Home Screen** → **Add**.
- **Android (Chrome):** open the site → tap the **⋮** menu → **Install app** (or **Add to Home screen**).
- **Desktop (Chrome / Edge):** click the install icon at the right end of the address bar.

It then opens full-screen like a native app and works without a connection.

## Where your data lives

Everything is saved **in your browser's storage on that device** — nothing is sent to a server.
That means:

- Data does not automatically move between your phone and your laptop.
- Clearing your browser's site data (or using a private window) removes it.
- **Export a backup regularly:** *Settings → Export backup* downloads a `.json` file; *Import backup*
  restores it on any device.

(When FORGE runs inside claude.ai as an Artifact, it can also sync to your Claude account — the
dot in the top bar turns green when that is active.)

## About the split

Your split — **Chest + Biceps on one day, Back + Triceps on another** — has no single official
name. It is usually called an **opposing-muscle (antagonist-style) split** or a **"reverse
push/pull" split**, and it is a variation of the classic bodybuilding **"bro split"**.

The idea: each day pairs a big muscle with the small arm muscle that did **not** work during that
day's main lifts. Pressing for chest also works your triceps, so you train biceps instead — they
arrive fresh. Rows and pull-ups work your biceps, so that day you train triceps instead. Every
muscle gets hit hard, and your arms are never pre-tired when it is their turn.

## Project structure

```
index.html              app shell (top bar, tab bar, sidebar) — loads everything below
manifest.webmanifest    install info (name, icons, colours)
sw.js                   service worker — offline support
assets/                 app icons
css/
  tokens.css            colours, fonts, spacing (dark "Iron" + light "Chalk" themes)
  base.css              reset, typography, layout helpers, animations
  components.css        buttons, cards, sheets, toasts, rings…
  shell.css             app frame: top bar, tab bar, sidebar, page transitions
  picker.css            exercise picker
  views/*.css           one stylesheet per screen
js/
  core/                 util, icons, store (state), queries, persist (saving), ui kit, charts,
                        exercise picker, router
  data/                 exercise library + default split, templates and quotes
  views/                today, plan, workout, library, progress, water, journal, settings
  app.js                starts the app
docs/SPEC.md            technical contract for contributors
tests/                  unit tests (`npm test`, needs Node 18+)
tools/build-artifact.mjs builds a single-file version (`npm run build` → dist/forge.html)
```

Plain HTML, CSS and JavaScript — no frameworks and nothing to compile.
