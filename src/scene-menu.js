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
      items.push({ label: 'NEW GAME', action: 'new' });
    } else {
      items.push({ label: 'PLAY', action: 'new' });
    }
    items.push({ label: 'HOW TO PLAY', action: 'rules' });
    btns.clear().stack(cx, 112, 132, items, 8);
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
      scr.textCenter('COSMIC', cx, 22, 3, 4);
      scr.textCenter('WIMPOUT', cx, 48, 3, 4);
      scr.textCenter('A GAME OF POSSIBILITIES AND MYSTIQUE', cx, 76, 2);

      build(scr);
      btns.draw(scr);

      scr.textCenter('C3 INC 1976 - FAN IMPLEMENTATION', cx, scr.h - 12, 1);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (!a) return true;
      CW.app.blips.pick();
      if (a === 'resume') CW.scenes.go('play');
      else if (a === 'new') CW.scenes.go('play', { fresh: true });
      else if (a === 'rules') CW.scenes.go('rules');
      return true;
    },

    key(k) {
      if (k === ' ' || k === 'enter') {
        CW.scenes.go('play', { fresh: !(CW.play && CW.play.hasGame()) });
        return true;
      }
      if (k === 'h' || k === '?') { CW.scenes.go('rules'); return true; }
      return false;
    },
  };

  CW.scenes.register('menu', scene);
})(window);
