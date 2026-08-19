/* Cosmic Wimpout — the play scene: a match in progress.

   Owns the game state, the roll animation and the Oracle's pacing. Rendering is
   delegated to render.js; rules to engine.js. The match survives leaving for the
   menu, which is what lets the menu offer RESUME. */
(function (global) {
  'use strict';
  const CW = global.CW;
  const R = CW.rules;

  let state = null;
  let aiTimer = null;
  let aiStage = 0;                 // sub-step inside the current engine phase

  const view = {
    faces: {},          // dieId -> face currently shown
    jitter: {},         // dieId -> [dx,dy]
    aside: {},          // dieId -> true, set aside this turn
    stars: null,
    busy: false,
    rollUntil: 0,
    thrown: [],
    trueFaces: null,
    nextTick: 0,
  };

  const blips = () => CW.app.blips;
  // Seat 0 is the human by convention, but ask the roster rather than assume it.
  const isHuman = () => !!(state && state.players[state.current].human);

  function scheduleAI(ms) {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(aiStep, ms);
  }

  function stopAI() { clearTimeout(aiTimer); aiTimer = null; aiStage = 0; }

  function resetView() {
    view.aside = {}; view.faces = {}; view.jitter = {};
    view.busy = false; view.thrown = []; view.trueFaces = null;
  }

  function newGame(opts) {
    stopAI();
    counted = false;
    CW.fanfare.clear();
    state = R.newGame(opts || { goal: 300 });
    resetView();
    persist();
    /* Warm the AI's risk table now rather than on its first decision: it is
       measured per rule set and costs a few dozen milliseconds, which would
       otherwise land as a hitch partway through the opening turn. */
    CW.ai.tableFor(state.mods);

    // announce the extra rule up front; it governs the whole game
    if (state.light) CW.fanfare.fire('light', state.light.name, state.light.blurb);
  }

  function persist() { CW.save.write(state, view); }

  /* Pick the match back up from a cold start. The view snapshot matters: cubes
     already set aside have no face recorded in the engine state, so without it
     a restored board would come back with holes in it. */
  function restore() {
    const saved = CW.save.read();
    if (!saved) return false;
    state = saved.state;
    resetView();
    view.faces = saved.faces || {};
    view.aside = saved.aside || {};
    return true;
  }

  // ------------------------------------------------------------------- moves
  function animateThrow(dice, ms) {
    view.thrown = dice;
    view.trueFaces = {};
    for (const d of dice) {
      view.trueFaces[d] = state.turn.result[d];
      view.jitter[d] = [(Math.random() * 9 - 4) | 0, (Math.random() * 9 - 4) | 0];
    }
    view.busy = true;
    view.rollUntil = performance.now() + ms;
    view.nextTick = 0;
  }

  function beginRoll() {
    if (state.phase !== 'READY' || view.busy) return;
    const thrown = state.turn.hand.slice();
    R.roll(state);
    persist();
    animateThrow(thrown, 780);
    blips().ensure();
  }

  // Reroll Clause: the offending cubes go back, everything else stays put.
  function beginReroll() {
    if (state.phase !== 'REROLL' || view.busy) return;
    const forced = state.turn.analysis.forced.slice();
    R.rerollForced(state);
    persist();
    animateThrow(forced, 600);
  }

  function finishRoll() {
    view.busy = false;
    for (const d of view.thrown) view.faces[d] = view.trueFaces[d];
    const b = blips(), ev = state.event, a = state.turn.analysis;
    if (ev === 'supernova') b.nova();
    else if (ev === 'wimpout') b.wimp();
    else if (ev === 'flash') b.flash();
    else if (ev === 'instant_win') b.win();
    else if (ev === 'mercy') b.mercy();
    else if (ev === 'reroll') b.unpick();
    else b.score();

    // Records are the player's own: an Oracle's lucky flash is not an achievement.
    if (isHuman()) {
      if (ev === 'flash' && a) CW.stats.note('flash', a.flashPoints);
      else if (ev === 'wimpout') CW.stats.note('wimpout', view.thrown.length === 5);
    }
    if (a && a.special === 'freight') {
      if (isHuman()) CW.stats.note('freight');
      CW.fanfare.fire('freight', String(a.flashPoints));
    } else if (ev === 'supernova') {
      if (isHuman()) CW.stats.note('supernova');
      CW.fanfare.fire('supernova', state.players[state.current].name);
    } else if (ev === 'instant_win') {
      CW.fanfare.fire('instant_win', state.players[state.current].name);
    }
    if (state.phase === 'GAME_OVER' && !counted) { counted = true; CW.stats.gameOver(state); }

    // Reroll Clause fired: show the offending cube, then throw it again.
    if (state.phase === 'REROLL') {
      setTimeout(() => { if (state.phase === 'REROLL') beginReroll(); }, 750);
      return;
    }

    // nothing to choose: show the result for a beat, then take it
    if (state.phase === 'SELECT' && state.turn.analysis &&
        state.turn.analysis.optional.length === 0 && isHuman()) {
      setTimeout(() => { if (state.phase === 'SELECT') doConfirm(); }, 850);
    }
  }

  function doConfirm() {
    if (!R.canConfirm(state) || view.busy) return;
    const t = state.turn, a = t.analysis;
    const used = a.flashDice.concat(Object.keys(t.kept));
    R.confirm(state);
    if (state.turn.swept) {
      view.aside = {}; view.faces = {}; view.jitter = {};
      blips().bank();
    } else {
      used.forEach(d => { view.aside[d] = true; });
      blips().pick();
    }
    persist();
  }

  function doBank() {
    if (!R.canBank(state) || view.busy) return;
    const scored = state.turn.points, mine = isHuman();
    R.bank(state);
    if (mine) CW.stats.note('bank', scored);
    blips().bank();
    persist();
  }

  let counted = false;
  function doNext() {
    if (state.phase !== 'TURN_OVER') return;
    R.nextTurn(state);
    if (state.phase === 'GAME_OVER' && !counted) { counted = true; CW.stats.gameOver(state); }
    view.aside = {}; view.faces = {}; view.jitter = {};
    aiStage = 0;
    persist();
    if (state.phase !== 'GAME_OVER' && !isHuman()) scheduleAI(750);
  }

  function act(action) {
    switch (action) {
      case 'roll': beginRoll(); break;
      case 'bank': doBank(); break;
      case 'confirm': doConfirm(); break;
      case 'next': doNext(); break;
      case 'new': newGame(); break;
      case 'menu': CW.scenes.go('menu'); break;
    }
  }

  // --------------------------------------------------------------- the Oracle
  /* One timer, one pending step, always. Every branch either returns or calls
     scheduleAI exactly once, so the chain can never fork. */
  function aiStep() {
    aiTimer = null;
    if (!state || isHuman() || state.phase === 'GAME_OVER') {
      aiStage = 0; return;
    }
    if (view.busy) return scheduleAI(120);

    switch (state.phase) {
      case 'READY':
        aiStage = 0;
        if (CW.ai.shouldRoll(state)) { beginRoll(); scheduleAI(950); }
        else { doBank(); scheduleAI(1200); }
        break;

      case 'SELECT':
        if (aiStage === 0) {
          state.turn.kept = {};                    // set, never toggle
          for (const d of CW.ai.chooseKeeps(state)) R.toggleKeep(state, d);
          aiStage = 1;
          scheduleAI(640);
        } else {
          aiStage = 0;
          doConfirm();
          scheduleAI(620);
        }
        break;

      case 'REROLL':
        scheduleAI(250);          // resolves itself; just wait it out
        break;

      case 'TURN_OVER':
        if (aiStage === 0) { aiStage = 1; scheduleAI(1500); }
        else { aiStage = 0; doNext(); }
        break;
    }
  }

  // --------------------------------------------------------------- the scene
  const ALL_FACES = [2, 3, 4, 5, 6, 10];
  const SUN_FACES = [2, 'S', 4, 5, 6, 10];

  const scene = {
    enter(opts) {
      if (!view.stars) view.stars = new CW.Stars(110, 9);
      if (!state || (opts && opts.fresh)) newGame(opts && opts.game);
      // an Oracle turn was in flight when we left; pick it back up
      if (!isHuman() && state.phase !== 'GAME_OVER') scheduleAI(600);
    },

    exit() { stopAI(); },

    tick(now) {
      // Only once the cubes have settled -- a hint about a flash is meaningless
      // while the faces are still tumbling.
      if (!view.busy) CW.hints.check(state, state && state.event, now);
      if (!view.busy) return;
      if (now >= view.rollUntil) { finishRoll(); return; }
      if (now < view.nextTick) return;
      const left = view.rollUntil - now;
      view.nextTick = now + (left < 260 ? 110 : 55);
      for (const d of view.thrown) {
        const pool = d === 's' ? SUN_FACES : ALL_FACES;
        view.faces[d] = pool[(Math.random() * 6) | 0];
        view.jitter[d] = [(Math.random() * 7 - 3) | 0, (Math.random() * 7 - 3) | 0];
      }
      blips().tick();
    },

    draw(scr, t) {
      CW.render.draw(scr, state, view, t);
      CW.hints.draw(scr, t);
      CW.fanfare.draw(scr, t);
    },

    press(x, y) {
      const action = CW.render.buttonAt(x, y);
      // MENU stays live while opponents play, or you would be trapped watching
      // three of them take their turns with no way out.
      if (action === 'menu') { act(action); return true; }
      if (!isHuman() && state.phase !== 'GAME_OVER') return true;
      if (action) { act(action); return true; }
      if (state.phase === 'SELECT' && !view.busy) {
        for (const id in CW.render.dieRects) {
          if (CW.ui.inside(CW.render.dieRects[id], x, y)) {
            const was = state.turn.kept[id];
            if (R.toggleKeep(state, id)) was ? blips().unpick() : blips().pick();
            return true;
          }
        }
      }
      return true;
    },

    key(k, e) {
      if (k === 'escape') { CW.scenes.go('menu'); return true; }
      if (!isHuman() && state.phase !== 'GAME_OVER') return true;

      if (k >= '1' && k <= '5' && state.phase === 'SELECT' && !view.busy) {
        const id = R.DICE[+k - 1];
        const was = state.turn.kept[id];
        if (R.toggleKeep(state, id)) was ? blips().unpick() : blips().pick();
        return true;
      }
      if (k === 'b') { doBank(); return true; }
      if (k === ' ' || k === 'enter') {
        if (state.phase === 'GAME_OVER') newGame();
        else if (state.phase === 'READY') beginRoll();
        else if (state.phase === 'SELECT') doConfirm();
        else if (state.phase === 'TURN_OVER') doNext();
        return true;
      }
      return false;
    },

    // used by the menu to decide between PLAY and RESUME
    hasGame() { return !!state && state.phase !== 'GAME_OVER'; },
    persist,
    newGame,
    state: () => state,
    view,
  };

  CW.scenes.register('play', scene);
  CW.play = scene;

  // Before the shell boots the menu, so RESUME is offered on a cold start.
  restore();
})(window);
