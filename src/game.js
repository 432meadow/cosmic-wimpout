/* Cosmic Wimpout — loop, input, animation, opponent pacing. */
(function (global) {
  'use strict';
  const CW = global.CW;
  const R = CW.rules;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const scr = new CW.Screen(ctx);
  const blips = new CW.Blips();
  const PAL_NAMES = Object.keys(CW.PALETTES);
  let palIndex = 0;

  let state = R.newGame({ goal: 300 });

  const view = {
    faces: {},          // dieId -> face currently shown
    jitter: {},         // dieId -> [dx,dy]
    aside: {},          // dieId -> true, set aside this turn
    stars: new CW.Stars(110, 9),
    busy: false,
    rollUntil: 0,
    thrown: [],
    trueFaces: null,
    nextTick: 0,
  };

  let aiTimer = null;
  let aiStage = 0;                 // sub-step inside the current engine phase
  function scheduleAI(ms) {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(aiStep, ms);
  }

  // ------------------------------------------------------------------ scale
  /* Logical height is fixed; logical width follows the viewport aspect so the
     board fills the screen instead of letterboxing. On a phone the CSS scale is
     fractional -- integer-only scaling collapses to 1x on a 393pt-wide iPhone --
     so we rely on image-rendering: pixelated, which snaps to device pixels and
     at 3x DPR makes the uneven pixel widths invisible.

     The keyboard hint is dropped whenever dropping it buys a bigger scale, so a
     1080p desktop fullscreen still lands on an exact integer multiple. */
  const hintEl = document.getElementById('hint');
  const isTouch = matchMedia('(hover: none)').matches;

  function resize() {
    const HINT = isTouch ? 0 : 23;
    const availW = global.innerWidth;
    const availH = Math.max(120, global.innerHeight - HINT);

    // widen the logical buffer to match the screen, within sane bounds
    const lw = Math.max(CW.W_MIN, Math.min(CW.W_MAX,
      Math.round(CW.H * availW / availH)));
    if (canvas.width !== lw) {
      canvas.width = lw;
      canvas.height = CW.H;
      ctx.imageSmoothingEnabled = false;
      scr.setSize(lw, CW.H);
    }

    let s = Math.min(availW / lw, availH / CW.H);
    if (!isTouch) {
      // desktop: prefer whole pixels, and drop the hint if that buys a step up
      const withHint = Math.floor(s);
      const without = Math.floor(Math.min(availW / lw, global.innerHeight / CW.H));
      const keep = withHint >= without;
      if (hintEl) hintEl.style.display = keep ? '' : 'none';
      s = Math.max(1, keep ? withHint : without);
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }

    canvas.style.width = (lw * s) + 'px';
    canvas.style.height = (CW.H * s) + 'px';
    canvas.dataset.scale = s;
  }
  global.addEventListener('resize', resize);
  // iOS reports stale dimensions during rotation, so settle then re-measure.
  global.addEventListener('orientationchange', () => setTimeout(resize, 200));
  if (global.visualViewport) global.visualViewport.addEventListener('resize', resize);

  // ------------------------------------------------------------------ moves
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
    animateThrow(thrown, 780);
    blips.ensure();
  }

  // Reroll Clause: the offending cubes go back, everything else stays put.
  function beginReroll() {
    if (state.phase !== 'REROLL' || view.busy) return;
    const forced = state.turn.analysis.forced.slice();
    R.rerollForced(state);
    animateThrow(forced, 600);
  }

  function finishRoll() {
    view.busy = false;
    for (const d of view.thrown) view.faces[d] = view.trueFaces[d];
    const ev = state.event;
    if (ev === 'supernova') blips.nova();
    else if (ev === 'wimpout') blips.wimp();
    else if (ev === 'flash') blips.flash();
    else if (ev === 'instant_win') blips.win();
    else if (ev === 'reroll') blips.unpick();
    else blips.score();

    // Reroll Clause fired: show the offending cube, then throw it again.
    if (state.phase === 'REROLL') {
      setTimeout(() => { if (state.phase === 'REROLL') beginReroll(); }, 750);
      return;
    }

    // nothing to choose: show the result for a beat, then take it
    if (state.phase === 'SELECT' && state.turn.analysis &&
        state.turn.analysis.optional.length === 0 && state.current === 0) {
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
      blips.bank();
    } else {
      used.forEach(d => { view.aside[d] = true; });
      blips.pick();
    }
  }

  function doBank() {
    if (!R.canBank(state) || view.busy) return;
    R.bank(state);
    blips.bank();
  }

  function doNext() {
    if (state.phase !== 'TURN_OVER') return;
    R.nextTurn(state);
    view.aside = {}; view.faces = {}; view.jitter = {};
    aiStage = 0;
    if (state.phase !== 'GAME_OVER' && state.current === 1) scheduleAI(750);
  }

  function doNewGame() {
    clearTimeout(aiTimer);
    aiTimer = null; aiStage = 0;
    state = R.newGame({ goal: 300 });
    view.aside = {}; view.faces = {}; view.jitter = {};
    view.busy = false;
  }

  function act(action) {
    switch (action) {
      case 'roll': beginRoll(); break;
      case 'bank': doBank(); break;
      case 'confirm': doConfirm(); break;
      case 'next': doNext(); break;
      case 'new': doNewGame(); break;
    }
  }

  // -------------------------------------------------------------- the Oracle
  /* One timer, one pending step, always. Every branch either returns or calls
     scheduleAI exactly once, so the chain can never fork. */
  function aiStep() {
    aiTimer = null;
    if (state.current !== 1 || state.phase === 'GAME_OVER') { aiStage = 0; return; }
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

  // ------------------------------------------------------------------ input
  // Derive the scale from the live rect rather than a stored number: on a phone
  // it is fractional and can change on rotation or safe-area shifts.
  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * (canvas.width / rect.width),
            (e.clientY - rect.top) * (canvas.height / rect.height)];
  }

  function hit(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  function press(x, y) {
    for (const b of CW.render.buttons) {
      if (b.enabled && hit(b, x, y)) { act(b.action); return; }
    }
    if (state.phase === 'SELECT' && !view.busy) {
      for (const id in CW.render.dieRects) {
        if (hit(CW.render.dieRects[id], x, y)) {
          const was = state.turn.kept[id];
          if (R.toggleKeep(state, id)) was ? blips.unpick() : blips.pick();
          return;
        }
      }
    }
  }

  /* pointerdown, not click: it fires immediately on touch and doubles as the
     user gesture iOS requires before an AudioContext will start. */
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    blips.ensure();
    if (state.current !== 0 && state.phase !== 'GAME_OVER') return;
    const p = toLogical(e);
    press(p[0], p[1]);
  }, { passive: false });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  if (!isTouch) {
    canvas.addEventListener('mousemove', e => {
      const [x, y] = toLogical(e);
      let hot = CW.render.buttons.some(b => b.enabled && hit(b, x, y));
      if (!hot && state.phase === 'SELECT' && state.current === 0) {
        for (const id in CW.render.dieRects) {
          if (hit(CW.render.dieRects[id], x, y) &&
              state.turn.analysis.optional.some(o => o.die === id)) hot = true;
        }
      }
      canvas.style.cursor = hot ? 'pointer' : 'default';
    });
  }

  global.addEventListener('keydown', e => {
    blips.ensure();
    const k = e.key.toLowerCase();
    if (k === 'p') {
      palIndex = (palIndex + 1) % PAL_NAMES.length;
      scr.setPalette(PAL_NAMES[palIndex]);
      return;
    }
    if (k === 'm') { blips.on = !blips.on; return; }
    if (state.current !== 0 && state.phase !== 'GAME_OVER') return;

    if (k >= '1' && k <= '5' && state.phase === 'SELECT' && !view.busy) {
      const id = R.DICE[+k - 1];
      const was = state.turn.kept[id];
      if (R.toggleKeep(state, id)) was ? blips.unpick() : blips.pick();
      e.preventDefault();
      return;
    }
    if (k === 'b') { doBank(); return; }
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (state.phase === 'GAME_OVER') doNewGame();
      else if (state.phase === 'READY') beginRoll();
      else if (state.phase === 'SELECT') doConfirm();
      else if (state.phase === 'TURN_OVER') doNext();
    }
  });

  // ------------------------------------------------------------------- loop
  const ALL_FACES = [2, 3, 4, 5, 6, 10];
  const SUN_FACES = [2, 'S', 4, 5, 6, 10];

  function frame(now) {
    if (view.busy) {
      if (now >= view.rollUntil) {
        finishRoll();
      } else if (now >= view.nextTick) {
        const left = view.rollUntil - now;
        view.nextTick = now + (left < 260 ? 110 : 55);
        for (const d of view.thrown) {
          const pool = d === 's' ? SUN_FACES : ALL_FACES;
          view.faces[d] = pool[(Math.random() * 6) | 0];
          view.jitter[d] = [(Math.random() * 7 - 3) | 0, (Math.random() * 7 - 3) | 0];
        }
        blips.tick();
      }
    }
    CW.render.draw(scr, state, view, now);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
  global.CWgame = { state: () => state, view, act };
})(window);
