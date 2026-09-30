/* FORGE - js/data/program.js
 * Training program data (SPEC 6.2): muscle, equipment & movement-pattern maps, the athlete's split
 * explained, the default week, loadable templates (incl. optional rest-day calisthenics sessions),
 * and the quote of the day.
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
    forearms: { label: 'Forearms', plate: 'teal' },
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

  // Extras (not in the SPEC table, additive): labels for exercise.type / exercise.level / exercise.pattern.
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
  // Movement patterns (SPEC 6.4). Swaps look for the same pattern first, then the same muscle.
  const PATTERNS = {
    'h-push': { label: 'Horizontal push', hint: 'Presses and push-ups' },
    'v-push': { label: 'Overhead push', hint: 'Shoulder presses, pike and handstand push-ups' },
    'h-pull': { label: 'Row', hint: 'Horizontal pulls' },
    'v-pull': { label: 'Vertical pull', hint: 'Pull-ups and chin-ups' },
    'elbow-flex': { label: 'Curl', hint: 'Elbow flexion' },
    'elbow-ext': { label: 'Triceps extension', hint: 'Extensions, dips, diamond push-ups' },
    fly: { label: 'Fly', hint: 'Chest flyes and pullovers' },
    raise: { label: 'Raise', hint: 'Lateral, front and rear-delt raises' },
    shrug: { label: 'Shrug', hint: 'Upper traps' },
    wrist: { label: 'Wrist & grip', hint: 'Wrist curls and grip holds' },
    carry: { label: 'Carry', hint: 'Loaded walks' },
    squat: { label: 'Squat', hint: 'Knee-dominant, both legs or pistols' },
    hinge: { label: 'Hinge', hint: 'Deadlifts, hip thrusts, hamstrings' },
    lunge: { label: 'Lunge', hint: 'Split stance and step-ups' },
    calf: { label: 'Calf raise', hint: 'Calves' },
    'core-flex': { label: 'Core flexion', hint: 'Leg raises, crunches, V-ups' },
    'core-stab': { label: 'Core hold', hint: 'Planks, hollow body, L-sit' },
    hang: { label: 'Hang', hint: 'Dead and active hangs' },
    skill: { label: 'Skill', hint: 'Muscle-ups, levers, handstands' },
    conditioning: { label: 'Conditioning', hint: 'Burpees, jumps, crawls' }
  };

  /* ------------------------------------------------------------------ the split, explained */

  const splitInfo = {
    name: '5-Day Bro Split',
    aka: ['Body-part split', 'Opposing-muscle pairing (Mon/Tue)', 'Reverse push/pull'],
    summary: 'Your week is a 5-day body-part split, known in the gym as a "bro split": each training day ' +
      'focuses on one or two muscle groups, and Friday\u2019s Push day hits chest, shoulders and triceps a ' +
      'second time. Monday and Tuesday use an opposing-muscle pairing, sometimes called "reverse ' +
      'push/pull": chest (a push muscle) goes with biceps (a pull muscle), and back goes with triceps, so ' +
      'the arm you train is fresh instead of already tired from the big lifts. Saturday and Sunday are ' +
      'rest days, with optional light calisthenics if you feel like moving.',
    why: [
      'Opposing pairs keep your arms fresh: pressing on Monday doesn\u2019t pre-tire your biceps, and rowing on Tuesday doesn\u2019t pre-tire your triceps.',
      'Each day has one clear job, so you can push a muscle group hard and it still gets a full week to recover.',
      'Friday\u2019s Push day gives chest, shoulders and triceps a second hit, and Wednesday\u2019s grip work makes pull-ups and heavy dumbbells easier.',
      'Two rest days let joints and energy recover. Calisthenics variations run through every day, so skills keep improving alongside the weights.'
    ],
    howToProgress: [
      'Double progression: when every set reaches the top of the range (say 3 \u00d7 12), add weight next time and build back up from the bottom (3 \u00d7 8).',
      'For calisthenics, progress the variation instead of the load: incline \u2192 full \u2192 decline \u2192 archer push-ups; negatives \u2192 pull-ups \u2192 archer pull-ups; pike \u2192 feet-on-bench pike \u2192 wall handstand push-ups. Swap moves any exercise up or down a step.',
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
        ['db-bench-press', 4, '8-12', 120, 'Main lift. Once all 4 sets reach 12, go up a weight.'],
        ['incline-db-press', 3, '8-12', 90, ''],
        ['db-fly', 3, '10-15', 60, 'Light and stretchy; stop where your shoulders start to feel it.'],
        ['decline-push-up', 3, 'AMRAP', 90, 'Stop 1\u20132 reps before your form breaks.'],
        ['chin-up', 3, 'AMRAP', 120, 'Can\u2019t do 5 yet? Swap to negative chin-ups.'],
        ['db-curl', 3, '10-12', 60, ''],
        ['hammer-curl', 3, '10-12', 60, ''],
        ['incline-db-curl', 2, '10-12', 60, 'Finisher: full stretch at the bottom of every rep.']
      ]
    },
    chestBicepsB: {
      title: 'Chest & Biceps', focus: ['chest', 'biceps'],
      items: [
        ['db-bench-press', 4, '6-8', 120, 'Heavy day: pick a weight you can press about 8 times.'],
        ['squeeze-press', 3, '10-12', 90, ''],
        ['incline-db-fly', 3, '12-15', 60, ''],
        ['wide-push-up', 3, 'AMRAP', 60, 'Ready for more? Swap to archer push-ups.'],
        ['chin-up', 3, 'AMRAP', 120, 'Take 3 seconds on every lowering.'],
        ['db-preacher-curl', 3, '10-12', 60, ''],
        ['zottman-curl', 3, '8-12', 60, ''],
        ['chin-up-hold', 2, '20s', 60, 'Hold your chin over the bar as long as you can.']
      ]
    },
    backTricepsA: {
      title: 'Back & Triceps', focus: ['back', 'triceps'],
      items: [
        ['pull-up', 4, 'AMRAP', 120, 'Fewer than 5 reps? Finish each set with slow negatives.'],
        ['one-arm-db-row', 3, '8-12', 90, 'Reps are per side.'],
        ['chest-supported-db-row', 3, '10-12', 90, ''],
        ['db-pullover', 3, '10-12', 60, ''],
        ['bench-dip', 3, '10-15', 60, 'Too easy? Straighten your legs or rest a dumbbell on your lap.'],
        ['overhead-db-extension', 3, '10-12', 60, ''],
        ['db-skull-crusher', 3, '10-12', 60, ''],
        ['diamond-push-up', 2, 'AMRAP', 60, 'Finisher: leave a rep in the tank.']
      ]
    },
    backTricepsB: {
      title: 'Back & Triceps', focus: ['back', 'triceps'],
      items: [
        ['wide-pull-up', 4, 'AMRAP', 120, 'Still building up? Swap to negative pull-ups.'],
        ['db-bent-over-row', 4, '8-12', 90, ''],
        ['renegade-row', 3, '6-10', 90, 'Reps are per side. Feet wide, hips square.'],
        ['scapular-pull-up', 3, '8-12', 60, ''],
        ['close-grip-db-press', 3, '8-12', 90, ''],
        ['straight-bar-dip', 3, '5-8', 120, 'Can\u2019t do 5 yet? Swap to bench dips.'],
        ['bodyweight-triceps-extension', 3, '8-12', 60, ''],
        ['db-kickback', 2, '12-15', 45, '']
      ]
    },
    shouldersForearmsA: {
      title: 'Shoulders & Forearms', focus: ['shoulders', 'forearms'],
      items: [
        ['db-shoulder-press', 4, '8-12', 90, ''],
        ['pike-push-up', 3, '6-10', 90, 'Too easy? Put your feet on the bench (elevated pike push-up).'],
        ['lateral-raise', 3, '12-15', 60, ''],
        ['db-reverse-fly', 3, '12-15', 60, ''],
        ['db-shrug', 3, '12-15', 60, ''],
        ['db-wrist-curl', 3, '12-15', 45, ''],
        ['db-reverse-wrist-curl', 2, '12-15', 45, ''],
        ['db-farmer-carry', 2, '40s', 60, 'Heaviest dumbbells you can carry with a tall posture.'],
        ['dead-hang', 2, '30s', 60, 'Grip finisher: add 5 s each week.']
      ]
    },
    shouldersForearmsB: {
      title: 'Shoulders & Forearms', focus: ['shoulders', 'forearms'],
      items: [
        ['arnold-press', 4, '8-12', 90, ''],
        ['elevated-pike-push-up', 3, '5-8', 120, 'Hips stacked over your shoulders; next step is the wall handstand push-up.'],
        ['lateral-raise', 4, '12-15', 60, ''],
        ['incline-reverse-fly', 3, '12-15', 60, ''],
        ['prone-ytw', 2, '8-10', 45, ''],
        ['reverse-db-curl', 3, '10-12', 60, ''],
        ['hammer-wrist-raise', 2, '12-15', 45, 'Reps are per arm.'],
        ['behind-back-wrist-curl', 3, '12-15', 45, ''],
        ['towel-hang', 3, '20s', 60, 'No towels? Hang with a thumbless grip.']
      ]
    },
    legsA: {
      title: 'Legs', focus: ['legs'],
      items: [
        ['goblet-squat', 4, '10-12', 90, ''],
        ['bulgarian-split-squat', 3, '8-12', 90, 'Reps are per leg.'],
        ['db-romanian-deadlift', 3, '8-12', 90, ''],
        ['step-up', 2, '10-12', 60, 'Reps are per leg.'],
        ['box-pistol-squat', 3, '5-8', 90, 'Pistol progression: sit to the bench slowly, stand without rocking.'],
        ['hip-thrust', 3, '10-12', 90, ''],
        ['single-leg-calf-raise', 3, '10-15', 45, 'Hold a dumbbell once 15 reps feel easy.'],
        ['hanging-knee-raise', 3, '10-15', 60, 'Progress to hanging leg raises, then toes-to-bar.']
      ]
    },
    legsB: {
      title: 'Legs', focus: ['legs'],
      items: [
        ['jump-squat', 3, '6-8', 60, 'First, while you are fresh: fast and explosive.'],
        ['db-reverse-lunge', 3, '8-12', 90, 'Reps are per leg.'],
        ['db-single-leg-rdl', 3, '8-10', 60, 'Reps are per leg.'],
        ['cossack-squat', 3, '6-10', 60, 'Reps are per side.'],
        ['single-leg-hip-thrust', 3, '8-12', 60, 'Reps are per leg.'],
        ['nordic-curl', 3, '3-6', 120, 'Lower as slowly as you can; catch yourself with your hands.'],
        ['db-calf-raise', 4, '12-15', 60, ''],
        ['hanging-leg-raise', 3, '8-12', 90, '']
      ]
    },
    pushA: {
      title: 'Push', focus: ['chest', 'shoulders', 'triceps'],
      items: [
        ['incline-db-press', 4, '6-10', 120, 'Go a little heavier than Monday.'],
        ['arnold-press', 3, '8-12', 90, ''],
        ['archer-push-up', 3, '4-8', 90, 'Reps are per side. Too hard? Swap to decline push-ups.'],
        ['lateral-raise', 3, '12-15', 60, ''],
        ['close-grip-db-press', 3, '8-12', 90, ''],
        ['bench-dip', 3, 'AMRAP', 60, ''],
        ['db-kickback', 2, '12-15', 45, 'Finisher: light weight, hard squeeze.']
      ]
    },
    pushB: {
      title: 'Push', focus: ['chest', 'shoulders', 'triceps'],
      items: [
        ['db-floor-press', 4, '6-10', 120, 'Pause each rep with your arms on the floor.'],
        ['db-shoulder-press', 3, '8-12', 90, ''],
        ['explosive-push-up', 3, '5-8', 90, 'Fast and powerful; add a clap when you are ready.'],
        ['elevated-pike-push-up', 3, '5-8', 120, ''],
        ['incline-db-fly', 3, '12-15', 60, ''],
        ['diamond-push-up', 3, 'AMRAP', 60, ''],
        ['overhead-db-extension', 3, '10-12', 60, '']
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
    legsCalisthenics: {
      title: 'Legs & Calisthenics', focus: ['legs', 'core'],
      items: [
        ['jump-squat', 3, '6-8', 60, 'First, while you are fresh: fast and explosive.'],
        ['box-pistol-squat', 3, '5-8', 90, 'Reps are per leg.'],
        ['jumping-lunge', 3, '6-10', 60, 'Reps are per leg.'],
        ['cossack-squat', 3, '6-10', 60, 'Reps are per side.'],
        ['single-leg-hip-thrust', 3, '8-12', 60, 'Reps are per leg.'],
        ['nordic-curl', 3, '3-6', 120, ''],
        ['single-leg-calf-raise', 3, '10-15', 45, ''],
        ['wall-sit', 2, '45s', 60, 'Finisher.']
      ]
    },
    // Optional rest-day sessions (restDay: true). Light, quick, skill-focused.
    calisthenicsFlow: {
      title: 'Calisthenics Flow', focus: ['fullbody', 'core'],
      items: [
        ['pull-up', 2, '5', 45, 'Crisp reps well short of failure. Can\u2019t do 5? Do slow negatives.'],
        ['push-up', 2, '10', 45, ''],
        ['pike-push-up', 2, '6-8', 45, ''],
        ['bench-dip', 2, '10', 45, ''],
        ['box-pistol-squat', 2, '5', 45, 'Reps are per leg.'],
        ['hollow-body-hold', 2, '20s', 30, ''],
        ['l-sit', 2, '10s', 30, 'Tuck your knees if the full L is too hard.'],
        ['dead-hang', 2, '30s', 30, 'Relax and let your spine decompress.']
      ]
    },
    calisthenicsSkills: {
      title: 'Calisthenics Skills', focus: ['fullbody', 'shoulders'],
      items: [
        ['scapular-pull-up', 2, '8-10', 45, 'Warm-up: slow and controlled.'],
        ['negative-pull-up', 3, '3-5', 90, 'Five-second lowering on every rep.'],
        ['wall-handstand-hold', 3, '20s', 60, 'Chest-to-wall teaches the straight line fastest.'],
        ['l-sit', 3, '10s', 60, 'Tuck one or both knees if needed.'],
        ['archer-push-up', 2, '3-5', 90, 'Reps are per side. Quality over quantity.'],
        ['tuck-front-lever', 3, '10s', 90, ''],
        ['skin-the-cat', 2, '3', 90, 'Only as deep as feels good for your shoulders.']
      ]
    },
    coreRecovery: {
      title: 'Core & Recovery', focus: ['core'],
      items: [
        ['dead-hang', 2, '30s', 30, 'Relaxed grip; let your spine lengthen.'],
        ['deep-squat-hold', 2, '45s', 30, ''],
        ['cossack-squat', 2, '6-8', 30, 'Slow and easy; reps are per side.'],
        ['dead-bug', 2, '10', 30, ''],
        ['bird-dog', 2, '8', 30, 'Reps are per side.'],
        ['side-plank', 2, '30s', 30, 'Time is per side.'],
        ['glute-bridge', 2, '15', 30, ''],
        ['active-hang', 2, '20s', 30, '']
      ]
    }
  };

  /* ------------------------------------------------------------------ templates */

  // Week templates first (A = the default day, B = a variation), then the optional rest-day
  // sessions, then extras. Ids are stable: views and saved links may reference them.
  const TEMPLATE_DEFS = [
    { id: 'chest-biceps-a', title: 'Chest & Biceps A', day: 'chestBicepsA',
      description: 'Monday\u2019s default: flat and incline presses, flyes and decline push-ups, then chin-ups and three curls.' },
    { id: 'chest-biceps-b', title: 'Chest & Biceps B', day: 'chestBicepsB',
      description: 'Heavy bench, squeeze press and wide push-ups, then chin-ups, preacher and Zottman curls and a chin-up hold.' },
    { id: 'back-triceps-a', title: 'Back & Triceps A', day: 'backTricepsA',
      description: 'Tuesday\u2019s default: pull-ups, rows and pullovers, then bench dips, extensions and a diamond push-up finisher.' },
    { id: 'back-triceps-b', title: 'Back & Triceps B', day: 'backTricepsB',
      description: 'Wide pull-ups, bent-over and renegade rows, scapular pulls, then close-grip press, bar dips and extensions.' },
    { id: 'shoulders-forearms-a', title: 'Shoulders & Forearms A', day: 'shouldersForearmsA',
      description: 'Wednesday\u2019s default: presses, pike push-ups and raises, then shrugs, wrist curls, carries and a dead hang.' },
    { id: 'shoulders-forearms-b', title: 'Shoulders & Forearms B', day: 'shouldersForearmsB',
      description: 'Arnold press, feet-on-bench pikes, raises and Y-T-Ws, then reverse curls, wrist work and towel hangs.' },
    { id: 'legs-a', title: 'Legs A', day: 'legsA',
      description: 'Thursday\u2019s default: goblet squats, Bulgarians, RDLs, step-ups, box pistols, hip thrusts, calves and hanging raises.' },
    { id: 'legs-b', title: 'Legs B', day: 'legsB',
      description: 'Jump squats, lunges and single-leg RDLs, Cossack squats, single-leg hip thrusts, Nordic curls and calves.' },
    { id: 'push-a', title: 'Push A', day: 'pushA',
      description: 'Friday\u2019s default: incline press, Arnold press and archer push-ups, raises, then close-grip press, dips and kickbacks.' },
    { id: 'push-b', title: 'Push B', day: 'pushB',
      description: 'Floor press, shoulder press, explosive and pike push-ups, flyes, then diamond push-ups and overhead extensions.' },
    { id: 'calisthenics-flow', title: 'Calisthenics Flow', day: 'calisthenicsFlow', restDay: true,
      description: 'Optional rest-day circuit, about 20\u201325 min: pull-ups, push-ups, pikes, dips, box pistols, hollow hold, L-sit, hang.' },
    { id: 'calisthenics-skills', title: 'Calisthenics Skills', day: 'calisthenicsSkills', restDay: true,
      description: 'Optional skill practice: scapular pulls, negatives, handstand, L-sit, archer push-ups and the tuck front lever.' },
    { id: 'core-recovery', title: 'Core & Recovery', day: 'coreRecovery', restDay: true,
      description: 'Easy rest-day session, about 20 min: hangs to decompress, gentle core work and bodyweight mobility.' },
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
    { id: 'calisthenics-core', title: 'Calisthenics & Core', day: 'calisthenicsCore',
      description: 'Skill day on the bar and floor: clean pull-ups, push-ups, pike push-ups, L-sits and hollow holds.' },
    { id: 'legs-calisthenics', title: 'Legs & Calisthenics', day: 'legsCalisthenics',
      description: 'No dumbbells needed: jumps, box pistols, lunges, Cossack squats, hip thrusts, Nordic curls and a wall sit.' },
    { id: 'pull-up-builder', title: 'Pull-up Builder', focus: ['back', 'biceps'],
      description: 'Stuck on pull-ups? Grip, scapular strength and slow negatives until the first strict rep lands.',
      items: [
        ['dead-hang', 3, '30s', 60, ''],
        ['scapular-pull-up', 3, '8-12', 60, ''],
        ['negative-pull-up', 4, '3-5', 90, 'Five-second lowering.'],
        ['chin-up', 3, 'AMRAP', 120, 'Even one rep counts.'],
        ['one-arm-db-row', 3, '8-12', 90, ''],
        ['hollow-body-hold', 3, '30s', 60, '']
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
    { id: 'quick-pump', title: '20-min Quick Pump', focus: ['fullbody'],
      description: 'Short on time? Five moves, three sets each, 30 s rest. Something always beats nothing.',
      items: [
        ['push-up', 3, 'AMRAP', 30, ''],
        ['one-arm-db-row', 3, '10-12', 30, 'Reps are per side.'],
        ['goblet-squat', 3, '12-15', 30, ''],
        ['db-shoulder-press', 3, '10-12', 30, ''],
        ['hammer-curl', 3, '12-15', 30, '']
      ] }
  ];

  // Offered on rest days ("Optional: Calisthenics Flow"), in this order.
  const restDayTemplateIds = ['calisthenics-flow', 'calisthenics-skills', 'core-recovery'];

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
  const restDay = () => ({ title: 'Rest Day', rest: true, focus: [], items: [] });

  /** The athlete's week (SPEC 6.2). Fresh objects and item ids on every call. */
  function defaultPlan() {
    return {
      days: {
        mon: buildDay(DAYS.chestBicepsA),
        tue: buildDay(DAYS.backTricepsA),
        wed: buildDay(DAYS.shouldersForearmsA),
        thu: buildDay(DAYS.legsA),
        fri: buildDay(DAYS.pushA),
        sat: restDay(),
        sun: restDay()
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
      restDay: t.restDay === true,
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
    PATTERNS,
    splitInfo,
    defaultPlan,
    templates,
    restDayTemplateIds,
    quotes,
    quoteFor,
    plateFor
  };
})(window.Forge = window.Forge || {});
