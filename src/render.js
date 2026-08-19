/* Cosmic Wimpout — board rendering. Reads state, writes pixels, owns no logic.

   Layout is fluid horizontally. Logical HEIGHT is fixed at 216 so type, cube
   size and vertical rhythm are identical on every device; logical WIDTH comes
   from the viewport aspect (see game.js resize). An iPhone in landscape is about
   2.17:1 and fills edge to edge; desktop 16:9 reproduces the original 384-wide
   board. Anything positioned across the screen must therefore be expressed
   against the live width, never against a constant. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const DIE = 32;
  const TAP_PAD = 6;                   // grows cube hit-rects to ~44 logical px

  /* Vertical budget, tuned for touch. The button strip is 26 logical px, which
     at iPhone landscape scale (~1.8x) clears Apple's 44pt minimum target. */
  const CY = 98;                       // board centre
  const BTN_Y = 182, BTN_H = 26;
  const MSG_Y = 168;
  const RY0 = 34, RY1 = 66;            // spiral vertical radii

  // Cube slots: (fraction of half-width, absolute y) offset from board centre.
  const SLOT_OFF = [
    [-0.344, -32], [0, -46], [0.344, -32], [-0.271, 36], [0.271, 36],
  ];

  const L = {
    w: 0, cx: 192,
    spiral: { rx0: 92, ry0: RY0, rx1: 176, ry1: RY1, turns: 2 },
    slots: [],
  };

  function layout(w) {
    if (L.w === w) return;
    L.w = w;
    L.cx = w / 2;
    L.spiral.rx1 = w / 2 - 16;
    L.spiral.rx0 = L.spiral.rx1 * 0.52;
    L.slots = SLOT_OFF.map(o => [
      Math.round(L.cx + o[0] * (w / 2) - DIE / 2),
      Math.round(CY + o[1] - DIE / 2),
    ]);
  }

  const buttons = [];
  const dieRects = {};

  function slotFor(dieId) {
    const i = CW.rules.DICE.indexOf(dieId);
    return L.slots[i < 0 ? 0 : i];
  }

  function trackPos(scr, score, goal) {
    return scr.spiralPoint(L.cx, CY, L.spiral, Math.max(0, Math.min(1, score / goal)));
  }

  // The printed cloth: the Sun-Star corona under the spiral score track.
  function drawCloth(scr, s, t) {
    scr.flamingSun(L.cx, CY, 42, 80, 20, t, 2);

    scr.spiralTrack(L.cx, CY, L.spiral, 1);
    for (let v = 0; v <= s.goal; v += 25) {
      const p = trackPos(scr, v, s.goal);
      if (v % 50 === 0) scr.pipStar(p[0], p[1], 2);
      else scr.px(p[0], p[1], 2);
    }
    // The outer end sits under the HUD, and the goal is already shown there.
    for (let v = 0; v < s.goal; v += 50) {
      const p = trackPos(scr, v, s.goal);
      scr.textCenter(String(v), p[0], p[1] + (p[1] < CY ? -9 : 5), 2);
    }
  }

  function drawMarkers(scr, s) {
    s.players.forEach((pl, i) => {
      if (pl.out) return;
      const p = trackPos(scr, pl.banked, s.goal);
      const x = Math.round(p[0]), y = Math.round(p[1]);
      scr.disc(x, y, 4, 0);                       // halo, so it reads over art
      if (i === 0) {
        for (let d = -3; d <= 3; d++) {
          const w = 3 - Math.abs(d);
          scr.rect(x - w, y + d, w * 2 + 1, 1, 3);
        }
      } else {
        scr.rect(x - 3, y - 3, 7, 7, 2);
        scr.rect(x - 1, y - 1, 3, 3, 0);
      }
    });
  }

  function drawHud(scr, s) {
    const you = s.players[0], him = s.players[1];
    const right = scr.w - 8;

    scr.text('YOU', 8, 4, 2);
    scr.text(you.banked, 8, 11, 3, 2);
    if (you.out) scr.text('OUT', 8, 24, 2);
    else if (!you.onBoard) scr.text('OFF BOARD', 8, 24, 1);

    const nm = 'ORACLE';
    scr.text(nm, right - scr.textWidth(nm), 4, 2);
    const sc = String(him.banked);
    scr.text(sc, right - scr.textWidth(sc, 2), 11, 3, 2);
    const tag = him.out ? 'OUT' : (him.onBoard ? '' : 'OFF BOARD');
    if (tag) scr.text(tag, right - scr.textWidth(tag), 24, him.out ? 2 : 1);

    const goal = s.lastLicks ? 'LAST LICKS ' + s.lastLicks.target : 'GOAL ' + s.goal;
    scr.textCenter(goal, L.cx, 5, 2);
    if (s.phase !== 'GAME_OVER') {
      scr.textCenter(s.current === 0 ? 'YOUR TURN' : 'ORACLE ROLLS', L.cx, 14, 1);
    }
  }

  function drawTurnScore(scr, s, t) {
    if (s.phase === 'GAME_OVER') return;
    const pts = s.turn.points;
    // The heart of the sun shows the shooting star at rest, the turn score in play.
    if (pts <= 0) { scr.shootingStar(L.cx + 12, CY + 2, 2, 2); return; }
    const pulse = Math.sin(t * 0.006) > 0.4 ? 3 : 2;
    scr.textCenter(String(pts), L.cx, CY - 7, pulse, 3);
  }

  function drawDice(scr, s, view) {
    for (const k in dieRects) delete dieRects[k];
    const R = CW.rules, t = s.turn;
    const a = t.analysis;

    for (const id of R.DICE) {
      const inHand = t.hand.indexOf(id) !== -1;
      const face = view.faces[id];
      if (face == null) continue;
      const aside = view.aside[id];
      if (!inHand && !aside) continue;

      const slot = slotFor(id);
      const j = view.jitter[id] || [0, 0];
      const x = slot[0] + j[0], y = slot[1] + j[1];

      const opts = { sunCube: id === 's' };
      if (aside && !inHand) {
        opts.dim = true;
      } else if (s.phase === 'SELECT' && a) {
        if (a.flashDice.indexOf(id) !== -1 || a.special) opts.locked = true;
        else if (t.kept[id]) opts.held = true;
        else if (!a.optional.some(o => o.die === id)) opts.dim = true;
      } else if (s.phase === 'REROLL' && a) {
        // spotlight the cubes the Reroll Clause is sending back
        if (a.forced.indexOf(id) === -1) opts.dim = true;
        else opts.locked = true;
      }
      scr.die(x, y, face, opts);
      dieRects[id] = { x: x - TAP_PAD, y: y - TAP_PAD,
                       w: DIE + TAP_PAD * 2, h: DIE + TAP_PAD * 2 };
    }
  }

  function addButton(label, x, w, action, enabled) {
    buttons.push({ label, x: Math.round(x), y: BTN_Y, w, h: BTN_H,
                   action, enabled: !!enabled });
  }

  function layoutButtons(s) {
    buttons.length = 0;
    const R = CW.rules, W = 88, GAP = 12;
    if (s.phase === 'GAME_OVER') {
      addButton('NEW GAME', L.cx - W / 2, W, 'new', true);
      return;
    }
    if (s.current !== 0) return;                      // the Oracle plays itself
    if (s.phase === 'READY') {
      if (R.canBank(s)) {
        addButton('ROLL', L.cx - W - GAP / 2, W, 'roll', true);
        addButton('BANK ' + s.turn.points, L.cx + GAP / 2, W, 'bank', true);
      } else {
        addButton('ROLL', L.cx - W / 2, W, 'roll', true);
      }
    } else if (s.phase === 'SELECT') {
      addButton('TAKE', L.cx - W / 2, W, 'confirm', R.canConfirm(s));
    } else if (s.phase === 'TURN_OVER') {
      addButton('CONTINUE', L.cx - W / 2, W, 'next', true);
    }
  }

  function drawButtons(scr) {
    for (const b of buttons) {
      const lit = b.enabled;
      scr.roundRect(b.x, b.y, b.w, b.h, [4, 2, 1], lit ? 1 : 0);
      scr.roundFrame(b.x, b.y, b.w, b.h, [4, 2, 1], lit ? 3 : 1);
      scr.textCenter(b.label, b.x + b.w / 2, b.y + (b.h - 10) / 2, lit ? 3 : 1, 2);
    }
  }

  function drawStatus(scr, s) {
    const t = s.turn;
    if (t.forbidden.length) {
      scr.text('CLEAR: NO ' + t.forbidden.join('/'), 8, MSG_Y, 2);
    } else if (!CW.rules.player(s).onBoard) {
      scr.text('NEED 35', 8, MSG_Y, 1);
    }
    if (s.phase !== 'GAME_OVER') {
      const n = 'CUBES ' + t.hand.length;
      scr.text(n, scr.w - 8 - scr.textWidth(n), MSG_Y, 1);
    }
  }

  function drawMessage(scr, s, t) {
    const urgent = s.event === 'wimpout' || s.event === 'supernova';
    const c = urgent ? (Math.sin(t * 0.02) > 0 ? 3 : 2) : 3;
    scr.textCenter(s.message || '', L.cx, MSG_Y, c);
  }

  function drawGameOver(scr, s) {
    const w = Math.min(240, scr.w - 40), h = 56;
    const x = L.cx - w / 2, y = CY - h / 2;
    scr.roundRect(x, y, w, h, [4, 2, 1, 1], 0);
    scr.roundFrame(x, y, w, h, [4, 2, 1, 1], 3);
    const won = s.winner === 0;
    scr.textCenter(won ? 'YOU WIN' : 'THE ORACLE WINS', L.cx, y + 12, 3, 2);
    scr.textCenter(s.players[0].banked + ' - ' + s.players[1].banked, L.cx, y + 32, 2);
    scr.textCenter(won ? 'THE COSMOS SMILES' : 'SOMETIMES YOU WIMP OUT',
                   L.cx, y + 42, 1);
  }

  function draw(scr, s, view, t) {
    layout(scr.w);
    scr.clear(0);
    view.stars.draw(scr, t);
    drawCloth(scr, s, t);
    drawMarkers(scr, s);
    drawTurnScore(scr, s, t);
    drawDice(scr, s, view);
    drawHud(scr, s);
    drawStatus(scr, s);
    drawMessage(scr, s, t);
    layoutButtons(s);
    drawButtons(scr);
    if (s.phase === 'GAME_OVER') drawGameOver(scr, s);
  }

  CW.render = { draw, buttons, dieRects, slotFor, layout, L, CY };
})(window);
