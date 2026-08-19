/* Cosmic Wimpout — rules engine. No rendering, no DOM.
   Implements RULES.md including house rulings A-G. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const SUN = 'S';
  const COMMON_FACES = [2, 3, 4, 5, 6, 10];
  const SUN_FACES = [2, SUN, 4, 5, 6, 10];
  const DICE = ['c0', 'c1', 'c2', 'c3', 's'];

  const SINGLES = { 5: 5, 10: 10 };        // only 5s and 10s score alone

  function rnd() { return Math.random(); }

  function throwDice(hand, rng) {
    rng = rng || rnd;
    const out = {};
    for (const d of hand) {
      const faces = d === 's' ? SUN_FACES : COMMON_FACES;
      out[d] = faces[Math.floor(rng() * 6)];
    }
    return out;
  }

  /* Analyse one throw.
     Returns { special, specialFace, flash, flashDice, flashPoints,
               optional:[{die,face,points}], wimpout } */
  function analyse(result, forbidden) {
    const ids = Object.keys(result);
    forbidden = forbidden || [];

    // Freight Train: five dice all showing the same numeric face.
    // Ruling A: the Sun *face* cannot complete one; a natural 10 on the Sun Cube can.
    if (ids.length === 5) {
      const faces = ids.map(d => result[d]);
      const f0 = faces[0];
      if (f0 !== SUN && faces.every(f => f === f0)) {
        const special = f0 === 6 ? 'instant_win' : f0 === 10 ? 'supernova' : 'freight';
        return {
          special, specialFace: f0,
          flash: null, flashDice: ids.slice(), flashPoints: special === 'freight' ? 100 * f0 : 0,
          optional: [], forced: [], wimpout: false,
        };
      }
    }

    /* Ruling C+D: dice showing a flash face cannot be kept, and the Sun never
       matches. Such dice are not simply dead -- the Reroll Clause says they must
       be thrown again "until you can keep 'em or Wimp out", so they are reported
       as `forced` and the caller re-throws them. */
    const legal = {}, forced = [];
    for (const d of ids) {
      const f = result[d];
      if (f === SUN || forbidden.indexOf(f) === -1) legal[d] = f;
      else forced.push(d);
    }

    const counts = {};
    for (const d in legal) if (legal[d] !== SUN) counts[legal[d]] = (counts[legal[d]] || 0) + 1;
    const sunWild = result.s === SUN;

    let flash = null, flashDice = [], flashPoints = 0;

    const triples = Object.keys(counts).filter(f => counts[f] >= 3).map(Number);
    if (triples.length) {
      flash = Math.max.apply(null, triples);
      flashDice = Object.keys(legal).filter(d => legal[d] === flash).slice(0, 3);
    } else if (sunWild) {
      // Flaming Sun Rule: Sun + a pair MUST become a flash.
      const pairs = Object.keys(counts).filter(f => counts[f] === 2).map(Number);
      if (pairs.length) {
        flash = Math.max.apply(null, pairs);       // ruling B: best available
        flashDice = Object.keys(legal).filter(d => legal[d] === flash).slice(0, 2).concat(['s']);
      }
    }
    if (flash !== null) flashPoints = 10 * flash;

    // Optional tier (ruling G): loose 5s, 10s and the Sun.
    const optional = [];
    for (const d in legal) {
      if (flashDice.indexOf(d) !== -1) continue;
      const f = legal[d];
      if (f === SUN) optional.push({ die: d, face: SUN, points: 10 });
      else if (SINGLES[f]) optional.push({ die: d, face: f, points: SINGLES[f] });
    }
    optional.sort((a, b) => b.points - a.points);

    return {
      special: null, specialFace: null,
      flash, flashDice, flashPoints, optional, forced,
      wimpout: flash === null && optional.length === 0,
    };
  }

  // --------------------------------------------------------------- game state
  function newGame(opts) {
    opts = opts || {};
    return {
      goal: opts.goal || 300,
      players: [
        { name: 'YOU', banked: 0, onBoard: false, out: false, human: true },
        { name: 'ORACLE', banked: 0, onBoard: false, out: false, human: false },
      ],
      current: 0,
      phase: 'READY',        // READY | SELECT | TURN_OVER | GAME_OVER
      turn: freshTurn(),
      lastLicks: null,       // { leader, queue:[idx], target }
      winner: null,
      message: 'ROLL TO BEGIN',
      event: null,           // transient: 'flash' | 'wimpout' | 'supernova' | ...
    };
  }

  function freshTurn() {
    return {
      points: 0,
      hand: DICE.slice(),
      forbidden: [],
      result: null,
      analysis: null,
      kept: {},              // dieId -> true, player's optional picks
      swept: false,
      mustRoll: true,        // first throw of a turn is always required
      throws: 0,
    };
  }

  function player(s) { return s.players[s.current]; }

  function canBank(s) {
    if (s.phase !== 'READY') return false;
    const t = s.turn;
    if (t.throws === 0 || t.points === 0) return false;
    if (t.forbidden.length) return false;                    // Futtless
    if (t.swept) return false;                               // Y.M.N.W.T.B.Y.M.
    if (!player(s).onBoard && t.points < 35) return false;   // opening roll
    return true;
  }

  function whyMustRoll(s) {
    const t = s.turn;
    if (t.forbidden.length) return 'FUTTLESS: CLEAR THE FLASH';
    if (t.swept) return 'ALL FIVE SCORED - YOU MUST';
    if (!player(s).onBoard && t.points < 35) return 'NEED 35 TO GET ON THE BOARD';
    return '';
  }

  // Roll the dice in hand. Moves to SELECT, REROLL, or ends the turn.
  function roll(s, rng) {
    const t = s.turn;
    t.result = throwDice(t.hand, rng);
    t.throws++;
    t.swept = false;
    return resolveThrow(s);
  }

  /* Reroll Clause: throw the offending cubes again, keeping everything else on
     the table. Ruling C -- only the dice that matched a flash face. */
  function rerollForced(s, rng) {
    const t = s.turn;
    const again = throwDice(t.analysis.forced, rng);
    for (const d in again) t.result[d] = again[d];
    return resolveThrow(s);
  }

  function resolveThrow(s) {
    const t = s.turn;
    t.analysis = analyse(t.result, t.forbidden);
    t.kept = {};
    const a = t.analysis;

    if (a.special === 'supernova') {
      player(s).out = true;
      t.points = 0;
      s.event = 'supernova';
      s.message = 'SUPERNOVA! TOO MANY POINTS';
      s.phase = 'TURN_OVER';
      return s;
    }
    if (a.special === 'instant_win') {
      s.winner = s.current;
      s.event = 'instant_win';
      s.message = 'FREIGHT TRAIN OF STARS - INSTANT WIN';
      s.phase = 'GAME_OVER';
      return s;
    }
    if (a.wimpout) {
      // Nothing scored -- but if that is only because cubes matched a flash face,
      // the Reroll Clause sends them back, it does not end the turn.
      if (a.forced.length) {
        s.event = 'reroll';
        s.phase = 'REROLL';
        s.message = 'REROLL CLAUSE - NO ' + t.forbidden.join('/');
        return s;
      }
      const train = Object.keys(t.result).length === 5;
      t.points = 0;
      s.event = 'wimpout';
      s.message = train ? 'TRAIN WRECK! ALL POINTS LOST' : 'WIMPOUT! ALL POINTS LOST';
      s.phase = 'TURN_OVER';
      return s;
    }

    s.event = a.flash !== null ? 'flash' : 'score';
    s.phase = 'SELECT';
    s.message = a.flash !== null
      ? 'FLASH! ' + a.flashPoints + ' POINTS'
      : 'PICK YOUR DICE';
    return s;
  }

  function toggleKeep(s, dieId) {
    if (s.phase !== 'SELECT') return false;
    const a = s.turn.analysis;
    if (!a.optional.some(o => o.die === dieId)) return false;
    if (s.turn.kept[dieId]) delete s.turn.kept[dieId];
    else s.turn.kept[dieId] = true;
    return true;
  }

  function selectionPoints(s) {
    const t = s.turn, a = t.analysis;
    let p = a.flashPoints;
    for (const o of a.optional) if (t.kept[o.die]) p += o.points;
    return p;
  }

  function canConfirm(s) {
    if (s.phase !== 'SELECT') return false;
    const a = s.turn.analysis;
    if (a.special) return true;
    if (a.flash !== null) return true;                       // flash alone scores
    return Object.keys(s.turn.kept).length > 0;              // min. one die
  }

  // Commit the selection: bank points into the turn, work out what must happen next.
  function confirm(s) {
    if (!canConfirm(s)) return s;
    const t = s.turn, a = t.analysis;

    t.points += selectionPoints(s);

    const used = a.flashDice.slice();
    for (const o of a.optional) if (t.kept[o.die]) used.push(o.die);

    if (a.special === 'freight') {
      t.forbidden = [];
      t.hand = DICE.slice();
      t.swept = true;
      s.message = 'FREIGHT TRAIN! ' + a.flashPoints + ' POINTS';
    } else {
      if (a.flash !== null) {
        if (t.forbidden.indexOf(a.flash) === -1) t.forbidden.push(a.flash);
      } else {
        t.forbidden = [];                                    // flash cleared
      }
      t.hand = t.hand.filter(d => used.indexOf(d) === -1);
      t.swept = t.hand.length === 0;
      if (t.swept) t.hand = DICE.slice();
    }

    t.result = null;
    t.analysis = null;
    t.kept = {};
    s.phase = 'READY';
    s.event = null;

    const why = whyMustRoll(s);
    t.mustRoll = !!why;
    s.message = why || ('TURN: ' + t.points + ' - ROLL OR BANK');
    return s;
  }

  function bank(s) {
    if (!canBank(s)) return s;
    const p = player(s);
    p.banked += s.turn.points;
    p.onBoard = true;
    s.event = 'bank';
    s.message = p.name + ' BANKS ' + s.turn.points;
    s.phase = 'TURN_OVER';
    return s;
  }

  // Advance to the next player, handling Last Licks and the game goal.
  function nextTurn(s) {
    if (s.phase === 'GAME_OVER') return s;
    const alive = s.players.filter(p => !p.out);
    if (alive.length === 1) {
      s.winner = s.players.indexOf(alive[0]);
      s.phase = 'GAME_OVER';
      s.message = s.players[s.winner].name + ' WINS';
      return s;
    }

    if (s.lastLicks) {
      s.lastLicks.queue.shift();
      if (!s.lastLicks.queue.length) {
        let best = -1, bi = -1;
        s.players.forEach((p, i) => { if (!p.out && p.banked > best) { best = p.banked; bi = i; } });
        s.winner = bi;
        s.phase = 'GAME_OVER';
        s.message = s.players[bi].name + ' WINS WITH ' + best;
        return s;
      }
      s.current = s.lastLicks.queue[0];
    } else {
      const leader = s.players.findIndex(p => !p.out && p.banked >= s.goal);
      if (leader !== -1) {
        const queue = [];
        for (let i = 1; i < s.players.length; i++) {
          const idx = (leader + i) % s.players.length;
          if (!s.players[idx].out) queue.push(idx);
        }
        if (!queue.length) {
          s.winner = leader;
          s.phase = 'GAME_OVER';
          s.message = s.players[leader].name + ' WINS';
          return s;
        }
        s.lastLicks = { leader, queue, target: s.players[leader].banked };
        s.current = queue[0];
        s.turn = freshTurn();
        s.phase = 'READY';
        s.message = 'LAST LICKS - BEAT ' + s.lastLicks.target;
        return s;
      }
      do { s.current = (s.current + 1) % s.players.length; }
      while (s.players[s.current].out);
    }

    s.turn = freshTurn();
    s.phase = 'READY';
    s.message = player(s).name + ' TO ROLL';
    return s;
  }

  CW.rules = {
    SUN, DICE, COMMON_FACES, SUN_FACES,
    throwDice, analyse,
    newGame, freshTurn, player,
    canBank, canConfirm, whyMustRoll, selectionPoints,
    roll, rerollForced, toggleKeep, confirm, bank, nextTurn,
  };
})(window);
