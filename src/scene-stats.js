/* Cosmic Wimpout — lifetime records. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const btns = new CW.ui.Buttons();
  let stars = null;
  let confirming = false;

  function rows() {
    const d = CW.stats.data;
    const rate = d.games ? Math.round(100 * d.wins / d.games) + '%' : '-';
    return [
      ['GAMES PLAYED', d.games],
      ['GAMES WON', d.wins + '   (' + rate + ')'],
      ['BEST GAME', d.bestGame],
      null,
      ['BEST TURN', d.bestTurn],
      ['BEST FLASH', d.bestFlash],
      ['FLASHES ROLLED', d.flashes],
      null,
      ['FREIGHT TRAINS', d.freights],
      ['SUPERNOVAS', d.supernovas],
      ['WIMPOUTS', d.wimpouts],
      ['TRAIN WRECKS', d.trainWrecks],
    ];
  }

  const scene = {
    enter() { confirming = false; if (!stars) stars = new CW.Stars(100, 17); },

    draw(scr, t) {
      const cx = scr.w / 2;
      scr.clear(0);
      stars.draw(scr, t);
      scr.flamingSun(cx, 104, 46, 96, 20, t, 1);

      scr.textCenter('RECORDS', cx, 12, 3, 2);

      const list = rows();
      /* two columns, so twelve rows fit a 216-tall screen without scrolling;
         on a canvas taller than it is wide, one column down the middle */
      const tall = scr.h > scr.w;
      const half = tall ? list.length : Math.ceil(list.length / 2);
      const colW = tall ? Math.min(190, scr.w - 40) : Math.min(190, (scr.w - 40) / 2);
      const x0 = tall ? cx - colW / 2 : cx - colW - 6;
      const by = tall ? scr.h - 40 : 182;

      list.forEach((r, i) => {
        if (!r) return;
        const col = i < half ? 0 : 1;
        const y = 34 + (i - col * half) * (tall ? 14 : 11);
        const x = x0 + col * (colW + 12);
        scr.text(r[0], x, y, 2);
        const v = String(r[1]);
        scr.text(v, x + colW - scr.textWidth(v), y, 3);
      });

      if (!CW.stats.any()) {
        scr.textCenter('NOTHING RECORDED YET. GO ROLL SOMETHING', cx, tall ? 34 + 14 * 13 : 150, 1);
      }

      btns.clear();
      btns.add('BACK', 8, by, 60, 'menu', { quiet: true, scale: 1 });
      // both resets live together, away from anything you might hit by accident
      if (CW.hints.seenCount() > 0) {
        if (tall) btns.add('RESET HINTS', scr.w - 94, by - 32, 86, 'forget', { quiet: true, scale: 1 });
        else btns.add('RESET HINTS', scr.w - 174, 182, 76, 'forget', { quiet: true, scale: 1 });
      }
      if (CW.stats.any()) {
        btns.add(confirming ? 'SURE? TAP AGAIN' : 'CLEAR RECORDS',
                 scr.w - 94, by, 86, 'reset', { quiet: true, scale: 1 });
      }
      btns.draw(scr);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (!a) { confirming = false; return true; }
      CW.app.blips.pick();
      if (a === 'menu') CW.scenes.go('menu');
      else if (a === 'forget') { CW.hints.forget(); confirming = false; }
      else if (a === 'reset') {
        // destructive and irreversible, so make it take two taps
        if (confirming) { CW.stats.reset(); confirming = false; }
        else confirming = true;
      }
      return true;
    },

    key(k) {
      if (k === 'escape' || k === 'backspace') { CW.scenes.go('menu'); return true; }
      return false;
    },
  };

  CW.scenes.register('stats', scene);
})(window);
