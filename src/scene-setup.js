/* Cosmic Wimpout — choose who you are playing against.

   The personalities only matter if the player can see they differ, so each one
   states its habit on the card rather than hiding behind a name. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const btns = new CW.ui.Buttons();
  const cards = [];
  let chosen = ['ORACLE'];
  let stars = null;

  function layoutCards(scr) {
    const roster = CW.ai.ROSTER;
    const gap = 12;
    const w = Math.min(146, (scr.w - 44 - (roster.length - 1) * gap) / roster.length);
    const total = roster.length * w + (roster.length - 1) * gap;
    let x = scr.w / 2 - total / 2;
    cards.length = 0;
    for (const name of roster) {
      cards.push({ name, x: Math.round(x), y: 44, w: Math.round(w), h: 96 });
      x += w + gap;
    }
  }

  function toggle(name) {
    const i = chosen.indexOf(name);
    if (i === -1) {
      if (chosen.length >= 3) return false;         // four seats at the table
      chosen.push(name);
    } else {
      if (chosen.length === 1) return false;        // never leave an empty table
      chosen.splice(i, 1);
    }
    return true;
  }

  const scene = {
    enter() { if (!stars) stars = new CW.Stars(120, 11); },

    draw(scr, t) {
      const cx = scr.w / 2;
      scr.clear(0);
      stars.draw(scr, t);
      scr.flamingSun(cx, 104, 46, 96, 20, t, 1);

      scr.textCenter('CHOOSE YOUR OPPONENTS', cx, 12, 3, 2);
      scr.textCenter('TAP TO ADD OR REMOVE - UP TO THREE', cx, 32, 1);

      layoutCards(scr);
      for (const c of cards) {
        const on = chosen.indexOf(c.name) !== -1;
        scr.roundRect(c.x, c.y, c.w, c.h, [4, 2, 1], on ? 1 : 0);
        scr.roundFrame(c.x, c.y, c.w, c.h, [4, 2, 1], on ? 3 : 1);
        scr.textCenter(c.name, c.x + c.w / 2, c.y + 10, on ? 3 : 2, 2);

        const lines = CW.ui.wrap(CW.ai.PROFILES[c.name].blurb,
                                 Math.floor((c.w - 14) / 4));
        let y = c.y + 32;
        for (const line of lines) { scr.textCenter(line, c.x + c.w / 2, y, on ? 2 : 1); y += 8; }

        // seat marker, matching the shape this opponent uses on the track
        const seat = chosen.indexOf(c.name) + 1;
        if (on) scr.textCenter('SEAT ' + seat, c.x + c.w / 2, c.y + c.h - 12, 2);
      }

      btns.clear();
      btns.add('BACK', 8, 182, 60, 'menu', { quiet: true, scale: 1 });
      btns.add('START', cx - 44, 182, 88, 'start');
      btns.draw(scr);

      scr.textCenter(chosen.length + ' OPPONENT' + (chosen.length > 1 ? 'S' : '') +
                     ' - ' + (chosen.length + 1) + ' AT THE TABLE', cx, 150, 2);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (a === 'menu') { CW.app.blips.pick(); CW.scenes.go('menu'); return true; }
      if (a === 'start') {
        CW.app.blips.bank();
        CW.scenes.go('play', { fresh: true, game: { goal: 300, opponents: chosen.slice() } });
        return true;
      }
      for (const c of cards) {
        if (CW.ui.inside(c, x, y)) {
          if (toggle(c.name)) CW.app.blips.pick(); else CW.app.blips.unpick();
          return true;
        }
      }
      return true;
    },

    key(k) {
      if (k === 'escape' || k === 'backspace') { CW.scenes.go('menu'); return true; }
      if (k === ' ' || k === 'enter') {
        CW.scenes.go('play', { fresh: true, game: { goal: 300, opponents: chosen.slice() } });
        return true;
      }
      if (k >= '1' && k <= '3') {
        const name = CW.ai.ROSTER[+k - 1];
        if (name) toggle(name);
        return true;
      }
      return false;
    },

    selection() { return chosen.slice() },
  };

  CW.scenes.register('setup', scene);
})(window);
