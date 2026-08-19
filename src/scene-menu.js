/* Cosmic Wimpout — main menu. */
(function (global) {
  'use strict';
  const CW = global.CW;

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

    // centre the stack rather than pinning its top, so two and three items
    // both sit clear of the footer
    const total = items.length * CW.ui.BTN_H + (items.length - 1) * 8;
    btns.clear().stack(cx, Math.round(142 - total / 2), 132, items, 8);

    const H = CW.hints;
    btns.add('HINTS ' + (H.enabled ? 'ON' : 'OFF'), 8, 184, 62, 'hints',
             { quiet: true, scale: 1 });
    if (H.seenCount() > 0) {
      btns.add('RESET HINTS', scr.w - 78, 184, 70, 'forget',
               { quiet: true, scale: 1 });
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
      scr.textCenter('COSMIC', cx, 20, 3, 4);
      scr.textCenter('WIMPOUT', cx, 46, 3, 4);
      scr.textCenter('A GAME OF POSSIBILITIES AND MYSTIQUE', cx, 74, 2);

      build(scr);
      btns.draw(scr);

      scr.textCenter('C3 INC 1976 - FAN IMPLEMENTATION', cx, scr.h - 10, 1);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (!a) return true;
      CW.app.blips.pick();
      if (a === 'resume') CW.scenes.go('play');
      else if (a === 'setup') CW.scenes.go('setup');
      else if (a === 'rules') CW.scenes.go('rules');
      else if (a === 'hints') CW.hints.setEnabled(!CW.hints.enabled);
      else if (a === 'forget') CW.hints.forget();
      return true;
    },

    key(k) {
      if (k === ' ' || k === 'enter') {
        if (CW.play && CW.play.hasGame()) CW.scenes.go('play');
        else CW.scenes.go('setup');
        return true;
      }
      if (k === 'h' || k === '?') { CW.scenes.go('rules'); return true; }
      return false;
    },
  };

  CW.scenes.register('menu', scene);
})(window);
