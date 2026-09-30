/* FORGE - js/data/program.js
 * Training program data (SPEC 6.2): muscle & equipment maps, the athlete's split explained,
 * the default week, loadable templates, and the quote of the day.
 * Load-time: definitions only. No dependency on other modules (F.util.uid is used at call time
 * when present, with a local fallback).
 */
(function (F) {
  'use strict';

  F.data = F.data || {};

  /* ------------------------------------------------------------------ vocab */

  // Key order is the display order everywhere (chips, groups, charts).
  const MUSCLES = {
    chest: { label: 'Chest', plate: 'red' },
    back: { label: 'Back', plate: 'blue' },
    biceps: { label: 'Biceps', plate: 'yellow' },
    triceps: { label: 'Triceps', plate: 'green' },
    shoulders: { label: 'Shoulders', plate: 'orange' },
    legs: { label: 'Legs', plate: 'violet' },
    core: { label: 'Core', plate: 'white' },
    fullbody: { label: 'Full body', plate: 'white' }
  };

  const EQUIPMENT = {
    bodyweight: { label: 'Bodyweight', icon: 'body' },
    pullupBar: { label: 'Pull-up bar', icon: 'bar' },
    dumbbells: { label: 'Dumbbells', icon: 'dumbbell' },
    bench: { label: 'Bench', icon: 'bench' },
    barbell: { label: 'Barbell', icon: 'plate' },
    bands: { label: 'Bands', icon: 'repeat' }
  };

  // Extras (not in the SPEC table, additive): labels for exercise.type / exercise.level.
  const TYPES = {
    weight: { label: 'Weighted', short: 'Weight', icon: 'dumbbell', logs: 'Logs weight \u00d7 reps' },
    bodyweight: { label: 'Bodyweight', short: 'Reps', icon: 'body', logs: 'Logs reps (added weight optional)' },
    time: { label: 'Timed hold', short: 'Hold', icon: 'timer', logs: 'Logs seconds held' }
  };
  const LEVELS = {
    beginner: { label: 'Beginner', rank: 1 },
    intermediate: { label: 'Intermediate', rank: 2 },
    advanced: { label: 'Advanced', rank: 3 }
  };

  /* ------------------------------------------------------------------ the split, explained */

  const splitInfo = {
    name: 'Opposing-Muscle Split',
    aka: ['Antagonist-style split', 'Reverse push/pull', 'Bro-split variant'],
    summary: 'Monday pairs chest with biceps and Tuesday pairs back with triceps: a big pushing muscle ' +
      'with the small pulling arm muscle, and the other way round. That way the arm you train is fresh ' +
      'instead of already tired from the big lifts. The split has no single official name. Coaches call ' +
      'it an opposing-muscle (antagonist-style) split or a "reverse push/pull", and it is a variation ' +
      'of the classic bodybuilding "bro split".',
    why: [
      'Big muscle first, fresh small muscle second: pressing doesn\u2019t pre-tire your biceps and rowing doesn\u2019t pre-tire your triceps.',
      'Pushing and pulling stay balanced across the week, which keeps shoulders healthy and posture upright.',
      'Chest, back and arms are each trained twice a week (A days Mon/Tue, B days Thu/Fri), the sweet spot for growth.',
      'Easy to recover from: Wednesday is lighter skill work, Saturday is legs and Sunday is off.'
    ],
    howToProgress: [
      'Double progression: when every set reaches the top of the range (say 3 \u00d7 12), add weight next time and build back up from the bottom (3 \u00d7 8).',
      'For calisthenics, progress the variation instead of the load: knee \u2192 incline \u2192 full \u2192 decline \u2192 archer push-ups; negatives \u2192 pull-ups \u2192 L-sit or archer pull-ups.',
      'Log every set. Beating last week by one rep or one small plate is a win.',
      'Every 6\u20138 weeks take a deload week (about half the sets, same weights) so joints and energy catch up.'
    ]
  };

  /* ------------------------------------------------------------------ day recipes */

  // [exId, sets, target, rest seconds, coaching note]
  const DAYS = {
    chestBicepsA: {
      title: 'Chest & Biceps', focus: ['chest', 'biceps'],
      items: [
        ['db-bench-press', 4, '8-12', 120, ''],
        ['incline-db-press', 3, '8-12', 90, ''],
        ['db-fly', 3, '10-15', 60, ''],
        ['decline-push-up', 3, 'AMRAP', 90, 'Stop 1\u20132 reps before your form breaks.'],
        ['chin-up', 3, 'AMRAP', 120, 'Can\u2019t do 5 yet? Swap in negative pull-ups with an underhand grip.'],
        ['db-curl', 3, '10-12', 60, ''],
        ['hammer-curl', 3, '10-12', 60, ''],
        ['incline-db-curl', 3, '10-12', 60, '']
      ]
    },
    backTricepsA: {
      title: 'Back & Triceps', focus: ['back', 'triceps'],
      items: [
        ['pull-up', 4, 'AMRAP', 120, 'Fewer than 5 reps? Finish each set with slow negatives.'],
        ['one-arm-db-row', 4, '8-12', 90, ''],
        ['chest-supported-db-row', 3, '10-12', 90, ''],
        ['db-pullover', 3, '10-12', 60, ''],
        ['bench-dip', 3, '10-15', 60, ''],
        ['overhead-db-extension', 3, '10-12', 60, ''],
        ['db-skull-crusher', 3, '10-12', 60, ''],
        ['diamond-push-up', 2, 'AMRAP', 60, 'Finisher: leave a rep in the tank.']
      ]
    },
    calisthenicsCore: {
      title: 'Calisthenics & Core', focus: ['fullbody', 'core'],
      items: [
        ['scapular-pull-up', 3, '8-12', 60, 'Warm-up for the shoulders. Slow and controlled.'],
        ['pull-up', 3, '5', 120, 'Crisp, perfect reps, not max effort. Use negatives if 5 is too many.'],
        ['push-up', 3, 'AMRAP', 60, 'Too easy? Move on to archer or pseudo planche push-ups.'],
        ['pike-push-up', 3, '6-10', 90, ''],
        ['hanging-knee-raise', 3, '10-15', 60, 'Progress to hanging leg raises, then toes-to-bar.'],
        ['tuck-l-sit', 3, '15s', 60, 'Holding 20 s with ease? Switch to the full L-sit.'],
        ['hollow-body-hold', 3, '30s', 60, ''],
        ['plank', 3, '45s', 60, '']
      ]
    },
    chestBicepsB: {
      title: 'Chest & Biceps', focus: ['chest', 'biceps'],
      items: [
        ['incline-db-press', 4, '6-10', 120, 'Heavier than Monday: aim for a weight you can do about 8 times.'],
        ['squeeze-press', 3, '10-12', 90, ''],
        ['incline-db-fly', 3, '12-15', 60, ''],
        ['wide-push-up', 3, 'AMRAP', 60, 'Ready for more? Try archer push-ups.'],
        ['chin-up', 3, 'AMRAP', 120, 'Take 3 seconds on every lowering.'],
        ['db-preacher-curl', 3, '10-12', 60, ''],
        ['zottman-curl', 3, '8-12', 60, ''],
        ['concentration-curl', 2, '12-15', 60, '']
      ]
    },
    backTricepsB: {
      title: 'Back & Triceps', focus: ['back', 'triceps'],
      items: [
        ['wide-pull-up', 4, 'AMRAP', 120, 'Still building up? Use negative pull-ups.'],
        ['db-bent-over-row', 4, '8-12', 90, ''],
        ['incline-reverse-fly', 3, '12-15', 60, ''],
        ['db-shrug', 3, '12-15', 60, ''],
        ['close-grip-db-press', 3, '8-12', 90, ''],
        ['bodyweight-triceps-extension', 3, '8-12', 60, ''],
        ['db-kickback', 3, '12-15', 45, ''],
        ['dead-hang', 2, '45s', 60, 'Decompress your spine and build grip to finish.']
      ]
    },
    legsCalisthenics: {
      title: 'Legs & Calisthenics', focus: ['legs', 'core'],
      items: [
        ['jump-squat', 3, '6-8', 60, 'First, while you are fresh: fast and explosive.'],
        ['goblet-squat', 4, '10-12', 90, ''],
        ['db-romanian-deadlift', 4, '8-12', 120, ''],
        ['bulgarian-split-squat', 3, '8-12', 90, 'Reps are per leg.'],
        ['box-pistol-squat', 3, '5-8', 90, 'Pistol progression: lower yourself slowly to the bench.'],
        ['single-leg-calf-raise', 3, '10-15', 45, ''],
        ['hanging-leg-raise', 3, '8-12', 90, '']
      ]
    }
  };

  /* ------------------------------------------------------------------ templates */

  const TEMPLATE_DEFS = [
    { id: 'chest-biceps-a', title: 'Chest & Biceps A', day: 'chestBicepsA',
      description: 'Flat and incline pressing, flyes and decline push-ups, then chin-ups and three curl angles.' },
    { id: 'chest-biceps-b', title: 'Chest & Biceps B', day: 'chestBicepsB',
      description: 'Heavier incline work, squeeze press and wide push-ups, then chin-ups with slow negatives and preacher, Zottman and concentration curls.' },
    { id: 'back-triceps-a', title: 'Back & Triceps A', day: 'backTricepsA',
      description: 'Pull-ups and heavy rows, pullovers, then bench dips, extensions, skull crushers and a diamond push-up finisher.' },
    { id: 'back-triceps-b', title: 'Back & Triceps B', day: 'backTricepsB',
      description: 'Wide pull-ups, bent-over rows, rear delts and traps, then close-grip press and bodyweight extensions.' },
    { id: 'calisthenics-core', title: 'Calisthenics & Core', day: 'calisthenicsCore',
      description: 'Skill day on the bar and floor: clean pull-ups, push-ups, pike push-ups, L-sits and hollow holds.' },
    { id: 'legs-calisthenics', title: 'Legs & Calisthenics', day: 'legsCalisthenics',
      description: 'Explosive jumps, goblet squats, RDLs and Bulgarians, a pistol progression, calves and hanging leg raises.' },
    { id: 'full-body-calisthenics', title: 'Full-Body Calisthenics', focus: ['fullbody', 'core'],
      description: 'Bar, bench and floor only. Pull, push, squat and core in one session with a burpee finisher.',
      items: [
        ['pull-up', 4, 'AMRAP', 120, ''],
        ['decline-push-up', 4, 'AMRAP', 90, ''],
        ['box-pistol-squat', 3, '5-8', 90, 'Reps are per leg.'],
        ['pike-push-up', 3, '6-10', 90, ''],
        ['bench-dip', 3, '10-15', 60, ''],
        ['hanging-leg-raise', 3, '8-12', 60, ''],
        ['hollow-body-hold', 3, '30s', 60, ''],
        ['burpee', 2, '10', 60, 'Finisher: all out.']
      ] },
    { id: 'shoulders-arms', title: 'Shoulders & Arms', focus: ['shoulders', 'biceps', 'triceps'],
      description: 'Presses and raises for round shoulders, then paired curls and extensions for a big arm pump.',
      items: [
        ['arnold-press', 4, '8-12', 90, ''],
        ['lateral-raise', 4, '12-15', 60, ''],
        ['incline-reverse-fly', 3, '12-15', 60, ''],
        ['incline-db-curl', 3, '10-12', 60, ''],
        ['overhead-db-extension', 3, '10-12', 60, ''],
        ['hammer-curl', 3, '10-12', 60, ''],
        ['db-skull-crusher', 3, '10-12', 60, '']
      ] },
    { id: 'quick-pump', title: '20-min Quick Pump', focus: ['fullbody'],
      description: 'Short on time? Five moves, three sets each, 30 s rest. Something always beats nothing.',
      items: [
        ['push-up', 3, 'AMRAP', 30, ''],
        ['one-arm-db-row', 3, '10-12', 30, 'Reps are per side.'],
        ['goblet-squat', 3, '12-15', 30, ''],
        ['db-shoulder-press', 3, '10-12', 30, ''],
        ['hammer-curl', 3, '12-15', 30, '']
      ] },
    { id: 'beginner-bodyweight', title: 'Beginner Bodyweight', focus: ['fullbody'],
      description: 'The foundation: easier push-ups, pull-up negatives, squats, bridges and core holds. Run it 2\u20133 times a week.',
      items: [
        ['incline-push-up', 3, '8-12', 60, ''],
        ['negative-pull-up', 3, '3-5', 90, ''],
        ['bodyweight-squat', 3, '12-15', 60, ''],
        ['glute-bridge', 3, '12-15', 45, ''],
        ['dead-hang', 2, '20s', 60, ''],
        ['plank', 3, '30s', 45, ''],
        ['dead-bug', 3, '10-12', 45, '']
      ] },
    { id: 'pull-up-builder', title: 'Pull-up Builder', focus: ['back', 'biceps'],
      description: 'Stuck on pull-ups? Grip, scapular strength and slow negatives until the first strict rep lands.',
      items: [
        ['dead-hang', 3, '30s', 60, ''],
        ['scapular-pull-up', 3, '8-12', 60, ''],
        ['negative-pull-up', 4, '3-5', 90, 'Five-second lowering.'],
        ['chin-up', 3, 'AMRAP', 120, 'Even one rep counts.'],
        ['one-arm-db-row', 3, '8-12', 90, ''],
        ['hollow-body-hold', 3, '30s', 60, '']
      ] }
  ];

  /* ------------------------------------------------------------------ quotes */

  const quotes = [
    'Discipline outlasts motivation.',
    'Show up. Warm up. Level up.',
    'Strength is built one boring rep at a time.',
    'Your future self is watching this set.',
    'Chalk up and get after it.',
    'Progress hides in the last two reps.',
    'Rest days are part of the plan, not a break from it.',
    'Add a rep. Add a plate. Repeat for years.',
    'Tired is a feeling. Done is a decision.',
    'Own the bar, own the day.',
    'Log it or it didn\u2019t happen.',
    'Good form today, big numbers tomorrow.',
    'Hydrate. Lift. Recover. Repeat.',
    'Slow negatives, fast progress.',
    'Earn the pump.',
    'Squeeze every rep like it owes you money.',
    'The pull-up bar doesn\u2019t take excuses.',
    'Nobody drifts into strong. You climb.',
    'Stack the days and the results stack themselves.',
    'Brace. Breathe. Drive.',
    'A little stronger than last week is plenty.',
    'The bench is ready when you are.',
    'Chase reps, not mirrors.',
    'Sore today, stronger tomorrow.',
    'Control the weight or it controls you.',
    'One finished session beats ten perfect plans.',
    'Motivation starts the set. Discipline finishes it.',
    'Your body keeps the receipts.',
    'Consistency compounds.',
    'Leave the ego at the door. Take the gains home.',
    'Grip it like you mean it.',
    'Own the push-up before you chase the planche.',
    'Strict reps build real strength.',
    'Quiet work, loud results.',
    'Water first. Then weights.',
    'One workout away from a better mood.',
    'The logbook remembers what you forget.',
    'Be the one who finishes the plan.',
    'Rest hard. Train harder.',
    'Nothing heavy ever lifted itself.',
    'Bodyweight is free. Excuses cost you.',
    'Hang tough. Literally.',
    'Earn the rest day.',
    'Strong is a habit, not a mood.',
    'Beat last week\u2019s logbook, not someone else\u2019s.',
    'Do it tired. Do it anyway.',
    'The plan works when you do.',
    'Small plates add up.',
    'Win the warm-up and the rest follows.',
    'You never regret the set you finished strong.'
  ];

  /* ------------------------------------------------------------------ helpers */

  let seq = 0;
  /** Plan-item id: F.util.uid when available (call time), else a local fallback. */
  function uid() {
    try {
      if (F.util && typeof F.util.uid === 'function') return F.util.uid('pi-');
    } catch (_) { /* fall back */ }
    seq = (seq + 1) % 1679616;
    return 'pi-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + seq.toString(36);
  }

  const toItem = (row) => ({ exId: row[0], sets: row[1], target: row[2], rest: row[3], note: row[4] || '' });

  /** Fresh PlanDay from a recipe (new item ids every call). */
  function buildDay(recipe) {
    return {
      title: recipe.title,
      rest: false,
      focus: recipe.focus.slice(),
      items: recipe.items.map((row) => Object.assign({ id: uid() }, toItem(row)))
    };
  }

  function defaultPlan() {
    return {
      days: {
        mon: buildDay(DAYS.chestBicepsA),
        tue: buildDay(DAYS.backTricepsA),
        wed: buildDay(DAYS.calisthenicsCore),
        thu: buildDay(DAYS.chestBicepsB),
        fri: buildDay(DAYS.backTricepsB),
        sat: buildDay(DAYS.legsCalisthenics),
        sun: { title: 'Rest & Recover', rest: true, focus: [], items: [] }
      }
    };
  }

  const templates = TEMPLATE_DEFS.map((t) => {
    const recipe = t.day ? DAYS[t.day] : t;
    return {
      id: t.id,
      title: t.title,
      focus: recipe.focus.slice(),
      description: t.description,
      items: recipe.items.map(toItem)
    };
  });

  /** Day number for a local ISO date ('YYYY-MM-DD'), timezone-independent; null when malformed. */
  function dayNumber(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  /**
   * Quote of the day. Deterministic per date: the day number is scrambled by a stride that is
   * coprime with the list length, so consecutive days never repeat until the list is exhausted.
   */
  function quoteFor(iso) {
    const n = quotes.length;
    let day = dayNumber(iso);
    if (day === null) { // any other input still maps deterministically (FNV-1a hash)
      let hsh = 2166136261;
      const s = String(iso == null ? '' : iso);
      for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 16777619) >>> 0; }
      day = hsh;
    }
    let stride = 17;
    while (gcd(stride, n) !== 1) stride++;
    const idx = ((day * stride + 11) % n + n) % n;
    return quotes[idx];
  }

  /** Plate colour for a muscle key, or for the first known muscle of a focus array. Default 'red'. */
  function plateFor(muscleOrFocus) {
    const list = Array.isArray(muscleOrFocus) ? muscleOrFocus : [muscleOrFocus];
    for (const m of list) {
      const key = typeof m === 'string' ? m.trim().toLowerCase() : '';
      if (key && Object.prototype.hasOwnProperty.call(MUSCLES, key)) return MUSCLES[key].plate;
    }
    return 'red';
  }

  F.data.program = {
    MUSCLES,
    EQUIPMENT,
    TYPES,
    LEVELS,
    splitInfo,
    defaultPlan,
    templates,
    quotes,
    quoteFor,
    plateFor
  };
})(window.Forge = window.Forge || {});
