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

  function wimpChance(n, forbidden) {
    const row = RISK[Math.max(1, Math.min(5, n || 5))];
    let k = 0;
    if (forbidden.indexOf(5) !== -1) k++;
    if (forbidden.indexOf(10) !== -1) k++;
    if (k >= 2) return row[3];
    if (k === 1) return row[2];
    return forbidden.length ? row[1] : row[0];
  }

  function contValue(handAfter, forbidden, pointsSoFar) {
    const n = handAfter === 0 ? 5 : handAfter;   // 0 means a sweep: five fresh cubes
    const p = wimpChance(n, forbidden);
    return (1 - p) * (pointsSoFar + EXP_GAIN[n]);
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
    const canStopAfterAll = a.flash === null && handAll > 0 &&
                            (p.onBoard || afterAll >= 35);
    if (canStopAfterAll && !shouldPushOn(state, afterAll, handAll, nextForbidden))
      return all;

    return contValue(handAll, nextForbidden, afterAll) >=
           contValue(handMin, nextForbidden, afterMin) ? all : minSel;
  }

  // Would we keep rolling from this hypothetical position?
  function shouldPushOn(state, points, handSize, forbidden) {
    const R = CW.rules, p = R.player(state);
    const target = chaseTarget(state);
    if (target != null && p.banked + points <= target) return true;  // must beat it
    if (p.banked + points >= state.goal) return false;               // goal reached
    const prof = profileOf(p);
    if (points >= prof.cap) return false;
    const n = handSize === 0 ? 5 : handSize;   // 0 means a sweep: five fresh cubes
    const risk = wimpChance(n, forbidden);
    return (1 - risk) * EXP_GAIN[n] * prof.nerve > risk * points;
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
    PROFILES, ROSTER, profileOf,
  };
})(window);
