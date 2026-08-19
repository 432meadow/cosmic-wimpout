/* Cosmic Wimpout — main menu.

   Layout note: the primary stack is capped at three entries and centred in the
   band between the subtitle and the secondary row. RECORDS and the hints toggle
   are secondary actions and live along the bottom, which is also what keeps the
   stack from growing into the furniture -- at four entries it collided with the
   subtitle above and the footer below, and at three it already clipped the row
   beneath it. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const TITLE_Y = 18, SUB_Y = 68;
  const BAND_TOP = 78, BAND_BOTTOM = 178;   // room the stack may occupy
  const SECONDARY_Y = 182, SECONDARY_H = 22;

  const btns = new CW.ui.Buttons();
  let stars = null;

  function build(scr) {
    const cx = scr.w / 2;
    const items = [];
    // A match survives leaving for the menu, so offer to pick it back up.
    if (CW.play && CW.play.hasGame()) {
      items.push({ label: 'RESUME', action: 'resume' });
      items.push({ label: 'NEW GAME', action: 'setup' });
    } else {
      items.push({ label: 'PLAY', action: 'setup' });
    }
    items.push({ label: 'HOW TO PLAY', action: 'rules' });

    const total = items.length * CW.ui.BTN_H + (items.length - 1) * 8;
    const top = Math.round((BAND_TOP + BAND_BOTTOM) / 2 - total / 2);
    btns.clear().stack(cx, top, 132, items, 8);

    btns.add('HINTS ' + (CW.hints.enabled ? 'ON' : 'OFF'), 8, SECONDARY_Y, 62,
             'hints', { quiet: true, scale: 1, h: SECONDARY_H });
    if (CW.stats.any()) {
      btns.add('RECORDS', scr.w - 70, SECONDARY_Y, 62, 'stats',
               { quiet: true, scale: 1, h: SECONDARY_H });
    }
  }

  const scene = {
    enter() { if (!stars) stars = new CW.Stars(140, 3); },

    draw(scr, t) {
      scr.clear(0);
      stars.draw(scr, t);
      // the emblem, dimmed so the title and buttons sit clearly on top
      scr.flamingSun(scr.w / 2, 104, 42, 86, 20, t, 1);
      scr.shootingStar(scr.w / 2 + 12, 106, 1, 1);

      const cx = scr.w / 2;
      scr.textCenter('COSMIC', cx, TITLE_Y, 3, 4);
      scr.textCenter('WIMPOUT', cx, TITLE_Y + 24, 3, 4);
      scr.textCenter("MORE THAN AN EXPERIENCE ...IT'S A GAME!", cx, SUB_Y, 2);

      build(scr);
      btns.draw(scr);

      scr.textCenter('C3 INC 1976 - FAN IMPLEMENTATION', cx, scr.h - 8, 1);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (!a) return true;
      CW.app.blips.pick();
      if (a === 'resume') CW.scenes.go('play');
      else if (a === 'setup') CW.scenes.go('setup');
      else if (a === 'rules') CW.scenes.go('rules');
      else if (a === 'stats') CW.scenes.go('stats');
      else if (a === 'hints') CW.hints.setEnabled(!CW.hints.enabled);
      return true;
    },

    key(k) {
      if (k === ' ' || k === 'enter') {
        if (CW.play && CW.play.hasGame()) CW.scenes.go('play');
        else CW.scenes.go('setup');
        return true;
      }
      if (k === 'h' || k === '?') { CW.scenes.go('rules'); return true; }
      if (k === 'r' && CW.stats.any()) { CW.scenes.go('stats'); return true; }
      return false;
    },
  };

  CW.scenes.register('menu', scene);
})(window);
