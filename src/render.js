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
  // pulled in from 66 to leave a clear line at y=30 for the goal caption, now
  // that the player chips occupy the whole top strip
  const RY0 = 32, RY1 = 62;            // spiral vertical radii

  // Cube slots: (fraction of half-width, absolute y) offset from board centre.
  const SLOT_OFF = [
    [-0.344, -30], [0, -42], [0.344, -30], [-0.271, 34], [0.271, 34],
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

  const btns = new CW.ui.Buttons();
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

  // Distinct silhouettes, not just colours: at this size four players need to be
  // told apart by shape when two markers land on the same stretch of track.
  const MARKERS = [
    function diamond(scr, x, y, c) {
      for (let d = -3; d <= 3; d++) {
        const w = 3 - Math.abs(d);
        scr.rect(x - w, y + d, w * 2 + 1, 1, c);
      }
    },
    function ring(scr, x, y, c) {
      scr.rect(x - 3, y - 3, 7, 7, c);
      scr.rect(x - 1, y - 1, 3, 3, 0);
    },
    function triangle(scr, x, y, c) {
      for (let d = 0; d < 4; d++) scr.rect(x - d, y + d - 2, d * 2 + 1, 1, c);
    },
    function cross(scr, x, y, c) {
      scr.rect(x - 3, y - 1, 7, 3, c);
      scr.rect(x - 1, y - 3, 3, 7, c);
    },
  ];

  function drawMarkers(scr, s) {
    s.players.forEach((pl, i) => {
      if (pl.out) return;
      const p = trackPos(scr, pl.banked, s.goal);
      const x = Math.round(p[0]), y = Math.round(p[1]);
      scr.disc(x, y, 4, 0);                       // halo, so it reads over art
      (MARKERS[i] || MARKERS[3])(scr, x, y, i === 0 ? 3 : 2);
    });
  }

  /* One chip per seat, spread across the top strip. This scales to two players
     or four without a special case, and the lit chip says whose turn it is,
     which frees the line the old "YOUR TURN" caption used. */
  function drawHud(scr, s) {
    const n = s.players.length;
    const colW = scr.w / n;

    s.players.forEach((p, i) => {
      const cx = colW * (i + 0.5);
      const turn = s.current === i && s.phase !== 'GAME_OVER';
      if (turn) scr.roundRect(cx - colW / 2 + 3, 0, colW - 6, 28, [3, 1], 1);
      scr.textCenter(p.name, cx, 3, turn ? 3 : 2);
      scr.textCenter(String(p.banked), cx, 11, p.out ? 1 : 3, 2);
      const tag = p.out ? 'OUT' : (p.onBoard ? '' : 'OFF BOARD');
      if (tag) scr.textCenter(tag, cx, 23, p.out ? 2 : 1);
    });

    /* Four chips already crowd the top strip, so this line is reserved for
       whatever is currently governing the game: Last Licks outranks a Guiding
       Light, since it is the more urgent of the two. */
    if (s.lastLicks) {
      scr.textCenter('LAST LICKS ' + s.lastLicks.target, L.cx, 30, 2);
    } else if (s.light) {
      scr.textCenter('* ' + s.light.name + ' *', L.cx, 30, 2);
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

  function layoutButtons(s) {
    btns.clear();
    const R = CW.rules, W = 88, GAP = 12;

    /* Quiet, always-available way out. The match stays alive when we leave, so
       the menu can offer RESUME and this is never destructive. */
    btns.add('MENU', 8, BTN_Y, 52, 'menu', { quiet: true, scale: 1 });

    if (s.phase === 'GAME_OVER') {
      btns.add('NEW GAME', L.cx - W / 2, BTN_Y, W, 'new');
      return;
    }
    if (!s.players[s.current].human) return;          // opponents play themselves
    if (s.phase === 'READY') {
      if (R.canBank(s)) {
        btns.add('ROLL', L.cx - W - GAP / 2, BTN_Y, W, 'roll');
        btns.add('BANK ' + s.turn.points, L.cx + GAP / 2, BTN_Y, W, 'bank');
      } else {
        btns.add('ROLL', L.cx - W / 2, BTN_Y, W, 'roll');
      }
    } else if (s.phase === 'SELECT') {
      btns.add('TAKE', L.cx - W / 2, BTN_Y, W, 'confirm',
               { enabled: R.canConfirm(s) });
    } else if (s.phase === 'TURN_OVER') {
      btns.add('CONTINUE', L.cx - W / 2, BTN_Y, W, 'next');
    }
  }

  function drawStatus(scr, s) {
    const t = s.turn;
    // one slot, in priority order: what blocks you, then what you are aiming at
    if (t.forbidden.length) {
      scr.text('CLEAR: NO ' + t.forbidden.join('/'), 8, MSG_Y, 2);
    } else if (!CW.rules.player(s).onBoard) {
      scr.text('NEED 35', 8, MSG_Y, 1);
    } else if (!s.lastLicks) {
      scr.text('GOAL ' + s.goal, 8, MSG_Y, 1);
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
    const w = Math.min(280, scr.w - 40), h = 62;
    const x = L.cx - w / 2, y = CY - h / 2;
    scr.roundRect(x, y, w, h, [4, 2, 1, 1], 0);
    scr.roundFrame(x, y, w, h, [4, 2, 1, 1], 3);
    const won = s.winner === 0;
    const name = s.winner != null ? s.players[s.winner].name : '';
    scr.textCenter(won ? 'YOU WIN' : name + ' WINS', L.cx, y + 10, 3, 2);
    // final standings, highest first
    const line = s.players.map((p, i) => ({ p, i }))
      .sort((a, b) => b.p.banked - a.p.banked)
      .map(o => o.p.name + ' ' + o.p.banked).join('   ');
    scr.textCenter(line, L.cx, y + 30, 2);
    scr.textCenter(won ? 'THE COSMOS SMILES' : 'SOMETIMES YOU WIMP OUT',
                   L.cx, y + 44, 1);
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
    btns.draw(scr);
    if (s.phase === 'GAME_OVER') drawGameOver(scr, s);
  }

  CW.render = {
    draw, dieRects, slotFor, layout, L, CY,
    buttons: btns.list,
    buttonAt: (x, y) => btns.hit(x, y),
  };
})(window);
