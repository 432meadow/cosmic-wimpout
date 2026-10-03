/* Cosmic Wimpout 2.0 — the play scene: a match on the 3D table.

   1.0's play scene (src/scene-play.js), with real cubes. The flow is the
   same -- roll, take, bank, continue, the Reroll Clause sending cubes back,
   the opponents' pacing, persistence, records, fanfare, hints -- and so is
   everything drawn over the table: 1.0's chips, status line, message,
   buttons and game-over panel come straight from src/render.js.

   What changes is where a throw's faces come from. 1.0 rolls in the engine
   and animates afterwards; here the cubes are thrown first, and when they
   have settled the faces read off them are fed to the engine as its rng
   draws, one per cube in the order it draws them. */
(function (global) {
  'use strict';
  const CW = global.CW;
  const R = CW.rules;

  let state = null;
  let aiTimer = null;
  let aiStage = 0;
  let counted = false;
  let last = 0;

  // the same shape as 1.0's view, so saves read the same way
  const view = { faces: {}, aside: {}, busy: false };

  const app = () => CW.app;
  const blips = () => CW.app.blips;
  const isHuman = () => !!(state && state.players[state.current].human);

  // feed faces read off the cubes back through the engine's rng, in its order
  function rngFor(order, faces) {
    let k = 0;
    return () => {
      const id = order[k++];
      const pool = id === 's' ? R.SUN_FACES : R.COMMON_FACES;
      return (Math.max(0, pool.indexOf(faces[id])) + 0.5) / 6;
    };
  }

  function scheduleAI(ms) { clearTimeout(aiTimer); aiTimer = setTimeout(aiStep, ms); }
  function stopAI() { clearTimeout(aiTimer); aiTimer = null; aiStage = 0; }

  function newGame(opts) {
    stopAI();
    counted = false;
    CW.fanfare.clear();
    state = R.newGame(opts || { goal: 300 });
    view.faces = {}; view.aside = {}; view.busy = false;
    if (app().table) app().table.gather();
    persist();
    CW.ai.tableFor(state.mods);         // measured now, not mid-turn
    if (state.light) CW.fanfare.fire('light', state.light.name, state.light.blurb);
  }

  function persist() { if (state) CW.save.write(state, view); }

  /* Pick a match back up: set-aside cubes back in their places, and a throw
     that was waiting to be picked from laid out showing its faces. */
  function restore() {
    const saved = CW.save.read();
    if (!saved) return false;
    state = saved.state;
    view.faces = saved.faces || {};
    view.aside = saved.aside || {};
    view.busy = false;
    const T = app().table;
    if (T) {
      T.aside(Object.keys(view.aside));
      const t = state.turn;
      if (t.result) {
        Object.keys(t.result).forEach((id, k) => {
          const d = T.byId(id), axis = d.faces.indexOf(t.result[id]);
          if (axis < 0 || view.aside[id]) return;
          const q = CW.quat.mul(CW.quat.axisAngle([0, 1, 0], Math.random() * 6.28), CW.Table.alignAxisUp(axis));
          d.body.setPose([(k - 2) * 1.3, 0.5, -0.4 + (k % 2) * 1.2], q);
        });
      }
    }
    return true;
  }

  // ------------------------------------------------------------------- moves
  function throwCubes(ids, then) {
    view.busy = true;
    blips().ensure();
    // from wherever the player is looking: the toss leaves their side of the table
    app().table.throw(ids, { yaw: app().cam.yaw }).then(faces => {
      if (!state) return;
      then(faces);
      finishRoll();
    });
  }

  function beginRoll() {
    if (!state || state.phase !== 'READY' || view.busy) return;
    const hand = state.turn.hand.slice();
    throwCubes(hand, faces => R.roll(state, rngFor(hand, faces)));
  }

  // Reroll Clause: the offending cubes go back, everything else stays put
  function beginReroll() {
    if (!state || state.phase !== 'REROLL' || view.busy) return;
    const back = state.mods.strictReroll && state.turn.lastThrown
      ? state.turn.lastThrown.slice() : state.turn.analysis.forced.slice();
    throwCubes(back, faces => R.rerollForced(state, rngFor(back, faces)));
  }

  function finishRoll() {
    view.busy = false;
    const t = state.turn;
    if (t.result) for (const id in t.result) view.faces[id] = t.result[id];
    const b = blips(), ev = state.event, a = t.analysis;
    if (ev === 'supernova') b.nova();
    else if (ev === 'wimpout') b.wimp();
    else if (ev === 'flash') b.flash();
    else if (ev === 'instant_win') b.win();
    else if (ev === 'mercy') b.mercy();
    else if (ev === 'reroll') b.unpick();
    else b.score();

    // records are the player's own
    if (isHuman()) {
      if (ev === 'flash' && a) CW.stats.note('flash', a.flashPoints);
      else if (ev === 'wimpout') CW.stats.note('wimpout', Object.keys(t.result || {}).length === 5);
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
    persist();

    if (state.phase === 'REROLL') {
      setTimeout(() => { if (state && state.phase === 'REROLL') beginReroll(); }, 750);
      return;
    }
    // nothing to choose: show it for a beat, then take it
    if (state.phase === 'SELECT' && a && a.optional.length === 0 && isHuman()) {
      setTimeout(() => { if (state && state.phase === 'SELECT') doConfirm(); }, 850);
    }
  }

  function doConfirm() {
    if (!R.canConfirm(state) || view.busy) return;
    const t = state.turn, a = t.analysis;
    const used = a.flashDice.concat(Object.keys(t.kept));
    R.confirm(state);
    const T = app().table;
    if (state.turn.swept) {
      // all five scored: every cube comes back to hand, where it lies
      view.aside = {}; view.faces = {};
      T.gather();
      blips().bank();
    } else {
      used.forEach(d => { view.aside[d] = true; });
      T.aside(used, app().cam.yaw);
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

  function doNext() {
    if (state.phase !== 'TURN_OVER' || view.busy) return;
    R.nextTurn(state);
    if (state.phase === 'GAME_OVER' && !counted) { counted = true; CW.stats.gameOver(state); }
    view.aside = {}; view.faces = {};
    app().table.gather();
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

  function toggle(id) {
    const was = state.turn.kept[id];
    if (R.toggleKeep(state, id)) was ? blips().unpick() : blips().pick();
  }

  // --------------------------------------------------------------- the Oracle
  /* 1.0's discipline: one timer, one pending step, and every branch either
     returns or schedules exactly once, so the chain never forks. */
  function aiStep() {
    aiTimer = null;
    if (!state || isHuman() || state.phase === 'GAME_OVER') { aiStage = 0; return; }
    if (view.busy) return scheduleAI(120);
    switch (state.phase) {
      case 'READY':
        aiStage = 0;
        if (CW.ai.shouldRoll(state)) { beginRoll(); scheduleAI(950); }
        else { doBank(); scheduleAI(1200); }
        break;
      case 'SELECT':
        if (aiStage === 0) {
          state.turn.kept = {};
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
        scheduleAI(250);
        break;
      case 'TURN_OVER':
        if (aiStage === 0) { aiStage = 1; scheduleAI(1500); }
        else { aiStage = 0; doNext(); }
        break;
    }
  }

  // ------------------------------------------------------- what the cubes say
  /* 1.0's rules for how a cube looks (render.js drawDice): set-aside cubes are
     dimmed; while picking, a flash is locked, a kept cube held, a cube that
     cannot score dimmed; the Reroll Clause spotlights the cubes going back.
     Nothing is marked while the cubes are in the air. */
  function markCubes() {
    const T = app().table, t = state.turn, a = t.analysis;
    for (const d of T.dice) {
      d.dim = false; d.mark = 0;
      const inHand = t.hand.indexOf(d.id) !== -1;
      if (view.aside[d.id] && !inHand) { d.dim = true; continue; }
      if (view.busy) continue;
      if (state.phase === 'SELECT' && a && t.result && d.id in t.result) {
        if (a.flashDice.indexOf(d.id) !== -1 || a.special) d.mark = 2;
        else if (t.kept[d.id]) d.mark = 1;
        else if (!a.optional.some(o => o.die === d.id)) d.dim = true;
      } else if (state.phase === 'REROLL' && a && t.result && d.id in t.result) {
        if (a.forced.indexOf(d.id) === -1) d.dim = true; else d.mark = 2;
      }
    }
  }

  /* Which cube is under a tap: the cube the ray hits, else the nearest cube
     centre within a fingertip -- 1.0 pads its cube targets the same way. */
  function cubeAt(x, y) {
    const { world, table, cam } = app();
    const ray = cam.ray(x, y);
    const hit = world.pick(ray.o, ray.d);
    if (hit) return table.dice.find(d => d.body === hit.body);
    let best = null, bd = 18;
    for (const d of table.dice) {
      const p = cam.project(Array.from(d.body.c));
      const dd = Math.hypot(p[0] - x, p[1] - y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  // the players' markers ride the cloth's score track, as on 1.0's board
  function drawMarkers(scr) {
    const { cam } = app(), Rn = CW.render;
    state.players.forEach((pl, i) => {
      if (pl.out) return;
      const p = CW.sprites.trackPx(pl.banked, state.goal);
      const s = cam.project(CW.sprites.toWorld(p));
      const x = Math.round(s[0]), y = Math.round(s[1]);
      scr.disc(x, y, 4, 0);
      (Rn.MARKERS[i] || Rn.MARKERS[3])(scr, x, y, i === 0 ? 3 : 2);
    });
  }

  // --------------------------------------------------------------- the scene
  const scene = {
    enter(opts) {
      if (!app().renderer) { CW.scenes.go('nogpu'); return; }
      if (!state || (opts && opts.fresh)) newGame(opts && opts.game);
      last = 0;
      if (state.phase === 'REROLL' && isHuman()) setTimeout(beginReroll, 500);
      if (!isHuman() && state.phase !== 'GAME_OVER') scheduleAI(600);
    },

    exit() { stopAI(); },

    // the table runs and renders here; draw() only lays the HUD over it
    tick(now) {
      const { table, world, renderer, cam } = app();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      table.update(dt);
      world.update(dt);
      // a cube landing hard clicks, as 1.0's tumbling cubes tick
      let hit = 0;
      for (const b of world.bodies) hit = Math.max(hit, b.impact);
      if (hit > 2.5) blips().tick();

      if (!view.busy) CW.hints.check(state, state.event, now);
      markCubes();
      renderer.render({
        cam, time: now / 1000, palette: app().scr.pal, dice: table.sceneDice(),
        cloth: { goal: state.goal, points: state.phase === 'GAME_OVER' ? 0 : state.turn.points },
      });
    },

    /* 1.0's furniture, spread over the full-window canvas: the chips stay on
       the top edge; the status line, message, buttons and hints move down --
       to the bottom edge in landscape, to just under the table when the phone
       is upright -- and the game-over panel and fanfare sit over the table.
       Where everything goes is worked out by the shell (game.js). */
    draw(scr, t) {
      const Rn = CW.render, v = app().view, ctx = scr.ctx;
      ctx.clearRect(0, 0, scr.w, scr.h);
      scr._c = -1;
      Rn.layout(scr.w);
      drawMarkers(scr);
      Rn.drawHud(scr, state);
      ctx.save();
      ctx.translate(0, v.low);
      Rn.layoutButtons(state, view.busy, v.btn);
      Rn.drawButtons(scr);
      // the words sit just above the buttons (further down when upright)
      ctx.translate(0, v.drop);
      Rn.drawStatus(scr, state);
      Rn.drawMessage(scr, state, view, t);
      CW.hints.draw(scr, t);
      ctx.restore();
      ctx.save();
      ctx.translate(0, v.fan);
      if (state.phase === 'GAME_OVER') Rn.drawGameOver(scr, state);
      CW.fanfare.draw(scr, t);
      ctx.restore();
    },

    // a button under this point? (they are drawn along the bottom edge)
    onButton(x, y) { return !!CW.render.buttonAt(x, y - app().view.low); },

    hot(x, y) {
      if (this.onButton(x, y)) return true;
      return !!(state && state.phase === 'SELECT' && isHuman() && !view.busy && cubeAt(x, y));
    },

    press(x, y) {
      const action = CW.render.buttonAt(x, y - app().view.low);
      // MENU stays live while opponents play
      if (action === 'menu') { act(action); return true; }
      if (!isHuman() && state.phase !== 'GAME_OVER') return true;
      if (action) { act(action); return true; }
      if (state.phase === 'SELECT' && !view.busy) {
        const d = cubeAt(x, y);
        if (d) toggle(d.id);
      }
      return true;
    },

    key(k) {
      if (k === 'escape') { CW.scenes.go('menu'); return true; }
      if (!isHuman() && state.phase !== 'GAME_OVER') return true;
      if (k >= '1' && k <= '5' && state.phase === 'SELECT' && !view.busy) {
        toggle(R.DICE[+k - 1]);
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

    hasGame() { return !!state && state.phase !== 'GAME_OVER'; },
    persist, newGame, restore,
    state: () => state,
    view,
  };

  CW.scenes.register('play', scene);
  CW.play = scene;
})(window);
