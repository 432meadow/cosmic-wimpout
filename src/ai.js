/* Cosmic Wimpout — the ORACLE. Opponent policy.
   Risk figures are lifted from sim/flash_chain.py rather than guessed. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  /* Wimpout rate per throw, measured against the live engine with the Reroll
     Clause resolving properly. Columns:
       0  nothing forbidden
       1  only non-scoring faces forbidden (2/3/4/6)
       2  one scoring face forbidden (5 or 10)
       3  both 5 and 10 forbidden

     Note column 1 is SAFER than column 0: a forbidden face cannot end your turn,
     it buys you a free re-throw. Flashing 2s or 4s is protective. */
  const RISK = {
    1: [0.496, 0.400, 0.606, 0.747],
    2: [0.338, 0.241, 0.481, 0.753],
    3: [0.208, 0.128, 0.361, 0.703],
    4: [0.117, 0.058, 0.241, 0.599],
    5: [0.058, 0.020, 0.143, 0.440],
  };
  // Mean points from a throw that does score.
  const EXP_GAIN = { 0: 0, 1: 7, 2: 10, 3: 14, 4: 18, 5: 24 };

  /* Opponent personalities.

     There is a hard ceiling on how different these can feel, and it belongs to
     the game rather than the code: measured over 30k turns, 68% of all throws
     are FORCED by the rules (Futtless, the five-cube sweep, the 35-point
     opening), and 65% of all busts happen on one. No temperament dodges those.

     Of the knobs tried, only two survived measurement:

       cap    turn-score ceiling. The real lever, but only below ~25, because
              the break-even policy already stops near 26 on its own.
       nerve  scales the reward side of the push/bank comparison. Inert BELOW
              1.0 -- the margin at three or four cubes is too wide for scaling
              down to flip it -- but bites above 1.0, turning stop into push.

     A `minHand` floor was also tried and removed: chooseKeeps already keeps the
     hand at three or four cubes, so the AI never chose to throw one anyway.

     Measured bust rate / mean points per turn, 40k turns each:
     HERMIT 24% / 24.4, ORACLE 34% / 26.8, COMET 51% / 25.8. Near-identical
     yield, very different shape -- which is the point. */
  const PROFILES = {
    ORACLE: { nerve: 1.00, cap: 999, blurb: 'PLAYS THE ODDS STRAIGHT' },
    HERMIT: { nerve: 1.00, cap: 12,  blurb: 'BANKS EARLY AND OFTEN' },
    COMET:  { nerve: 2.20, cap: 999, blurb: 'CHASES EVERYTHING. BURNS HALF THE TIME' },
  };
  const ROSTER = Object.keys(PROFILES);

  function profileOf(player) {
    return (player && PROFILES[player.name]) || PROFILES.ORACLE;
  }

  /* The table above is exact for the printed rules and badly wrong for several
     Guiding Lights -- under HALF MOONS RISE the true five-cube bust rate is 0.8%
     against the 5.8% assumed here, so the AI would play as if in danger while
     nearly safe. Rather than hand-tabulate every variant (and re-tabulate every
     time one is added), the AI measures the rules it is actually playing under.

     One calibration per rule set, cached by signature, a few dozen milliseconds
     behind the opening announcement. */
  const cache = {};

  function signature(m) {
    return JSON.stringify([m.singles, m.sunTrain, m.sunMatches,
                           m.strictReroll, m.sampler, m.fullHouse]);
  }

  // does a single throw end the turn, once the Reroll Clause has settled?
  function bustOnce(hand, forbidden, m) {
    const R = CW.rules;
    const result = R.throwDice(hand);
    for (let g = 0; g < 40; g++) {
      const a = R.analyse(result, forbidden, m);
      if (a.special) return { bust: a.special === 'supernova', pts: a.flashPoints };
      if (!a.wimpout) {
        let pts = a.flashPoints;
        for (const o of a.optional) pts += o.points;
        return { bust: false, pts: pts };
      }
      if (!a.forced.length) return { bust: true, pts: 0 };
      const back = m.strictReroll ? hand : a.forced;
      Object.assign(result, R.throwDice(back));
    }
    return { bust: true, pts: 0 };
  }

  function calibrate(m) {
    const R = CW.rules;
    const scoring = Object.keys(m.singles).map(Number);
    const dead = [2, 3, 4, 6].filter(f => scoring.indexOf(f) === -1);
    // one representative forbidden set per class
    const sets = [
      [],
      dead.length ? [dead[0]] : [],
      [scoring[scoring.length - 1]],
      scoring.slice(-2),
    ];
    const risk = {}, gain = {};
    for (let n = 1; n <= 5; n++) {
      const hand = n === 5 ? R.DICE.slice() : R.DICE.slice(0, n - 1).concat(['s']);
      risk[n] = []; gain[n] = [];
      for (let c = 0; c < 4; c++) {
        let bust = 0, pts = 0, ok = 0;
        for (let i = 0; i < 1200; i++) {
          const r = bustOnce(hand, sets[c], m);
          if (r.bust) bust++; else { ok++; pts += r.pts; }
        }
        risk[n].push(bust / 1200);
        gain[n].push(ok ? pts / ok : 0);
      }
    }
    return { risk: risk, gain: gain, scoring: scoring };
  }

  function tableFor(m) {
    const key = signature(m);
    if (!cache[key]) cache[key] = calibrate(m);
    return cache[key];
  }

  // how many of the forbidden faces actually score under these rules?
  function forbiddenClass(forbidden, tbl) {
    if (!forbidden.length) return 0;
    let k = 0;
    for (const f of forbidden) if (tbl.scoring.indexOf(f) !== -1) k++;
    return k >= 2 ? 3 : (k === 1 ? 2 : 1);
  }

  function wimpChance(n, forbidden, m) {
    n = Math.max(1, Math.min(5, n || 5));
    if (!m) {                                  // no rule set given: printed rules
      const row = RISK[n];
      let k = 0;
      if (forbidden.indexOf(5) !== -1) k++;
      if (forbidden.indexOf(10) !== -1) k++;
      if (k >= 2) return row[3];
      if (k === 1) return row[2];
      return forbidden.length ? row[1] : row[0];
    }
    const tbl = tableFor(m);
    return tbl.risk[n][forbiddenClass(forbidden, tbl)];
  }

  function expGain(n, forbidden, m) {
    n = Math.max(1, Math.min(5, n || 5));
    if (!m) return EXP_GAIN[n];
    const tbl = tableFor(m);
    return tbl.gain[n][forbiddenClass(forbidden, tbl)];
  }

  function contValue(handAfter, forbidden, pointsSoFar, m) {
    const n = handAfter === 0 ? 5 : handAfter;   // 0 means a sweep: five fresh cubes
    const p = wimpChance(n, forbidden, m);
    return (1 - p) * (pointsSoFar + expGain(n, forbidden, m));
  }

  /* Which optional dice to set aside.

     Ruling G makes this a real decision, and the shape is counter-intuitive:
     taking EVERY scoring die is good when it empties the hand (Y.M.N.W.T.B.Y.M.
     hands back five fresh cubes), and taking the FEWEST is good otherwise
     (a bigger hand is a safer throw). Taking some middle amount is the worst of
     both -- it neither sweeps nor keeps the hand healthy. */
  function chooseKeeps(state) {
    const R = CW.rules, t = state.turn, a = t.analysis;
    if (!a || !a.optional.length) return [];

    const all = a.optional.map(o => o.die);
    const allPts = a.optional.reduce((s, o) => s + o.points, 0);
    const used = a.flashDice.length;
    const handAll = t.hand.length - used - all.length;

    if (handAll === 0) return all;                       // sweep: always worth it

    const nextForbidden = a.flash !== null
      ? t.forbidden.concat([a.flash]) : [];

    // Minimum legal selection: nothing if the flash already scores, else the best die.
    const minSel = a.flash !== null ? [] : [a.optional[0].die];
    const minPts = a.flash !== null ? 0 : a.optional[0].points;
    const handMin = t.hand.length - used - minSel.length;

    const p = R.player(state);
    const flashPts = a.flashPoints;
    const afterAll = t.points + flashPts + allPts;
    const afterMin = t.points + flashPts + minPts;

    // If taking everything lets us stop, and stopping is fine, take everything.
    // the opening threshold is a variant, not a constant
    const m = state.mods || CW.rules.BASE_MODS;
    const canStopAfterAll = a.flash === null && handAll > 0 &&
                            (p.onBoard || afterAll >= m.openAt);
    if (canStopAfterAll && !shouldPushOn(state, afterAll, handAll, nextForbidden))
      return all;

    return contValue(handAll, nextForbidden, afterAll, m) >=
           contValue(handMin, nextForbidden, afterMin, m) ? all : minSel;
  }

  // Would we keep rolling from this hypothetical position?
  function shouldPushOn(state, points, handSize, forbidden) {
    const R = CW.rules, p = R.player(state);
    const target = chaseTarget(state);
    if (target != null && p.banked + points <= target) return true;  // must beat it
    if (p.banked + points >= state.goal) return false;               // goal reached
    const prof = profileOf(p);
    if (points >= prof.cap) return false;
    const m = state.mods || CW.rules.BASE_MODS;

    /* Under MERCY the first bust of the game banks the turn instead of losing
       it, so while that pass is still in hand there is no downside to another
       throw. Without this the AI plays as though it could lose points it
       cannot, and a reckless policy beats it outright. */
    if (m.mercy && !p.usedMercy && (p.onBoard || points >= m.openAt)) return true;

    const n = handSize === 0 ? 5 : handSize;   // 0 means a sweep: five fresh cubes
    const risk = wimpChance(n, forbidden, m);
    return (1 - risk) * expGain(n, forbidden, m) * prof.nerve > risk * points;
  }

  // In Last Licks we must actually pass the leader, so banking short is pointless.
  function chaseTarget(state) {
    if (!state.lastLicks) return null;
    return state.lastLicks.target;
  }

  function shouldRoll(state) {
    const R = CW.rules, t = state.turn;
    if (!R.canBank(state)) return true;                  // forced anyway
    return shouldPushOn(state, t.points, t.hand.length, t.forbidden);
  }

  CW.ai = {
    chooseKeeps, shouldRoll, wimpChance, chaseTarget,
    PROFILES, ROSTER, profileOf, expGain, tableFor,
  };
})(window);
