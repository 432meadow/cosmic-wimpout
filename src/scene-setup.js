/* Cosmic Wimpout — choose opponents, target and whether the Guiding Light burns.

   The personalities only matter if the player can see they differ, so each card
   states its habit. Deliberately no difficulty label: temperament is the point,
   and naming one of them "easy" would flatten it into a menu of levels. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const GOALS = [300, 500, 1000];

  const btns = new CW.ui.Buttons();
  const cards = [];
  let chosen = ['ORACLE'];
  let goal = 300;
  let light = false;
  let stars = null;

  /* 1.0 is always landscape: cards side by side, exactly as before. A canvas
     taller than it is wide (the 3D edition on an upright phone) stacks the
     cards and spreads the rest down the screen. */
  const tall = scr => scr.h > scr.w;

  function geometry(scr) {
    if (!tall(scr)) {
      return { title: 6, sub: 20, sun: 104, goalLabel: [8, 121], goals: 114, light: 144,
               lightNote: 172, bottom: 182 };
    }
    // everything as one column, START right under the options
    const end = 46 + 3 * 58 + 2 * 8;
    return { title: 12, sub: 30, sun: 46 + (end - 46) / 2, goalLabel: null, goals: end + 24,
             light: end + 60, lightNote: end + 90, bottom: Math.min(scr.h - 40, end + 112) };
  }

  function layoutCards(scr) {
    const roster = CW.ai.ROSTER;
    cards.length = 0;
    if (tall(scr)) {
      roster.forEach((name, i) => cards.push({ name, x: 12, y: 46 + i * 66, w: scr.w - 24, h: 58 }));
      return;
    }
    const gap = 12;
    const w = Math.min(146, (scr.w - 44 - (roster.length - 1) * gap) / roster.length);
    const total = roster.length * w + (roster.length - 1) * gap;
    let x = scr.w / 2 - total / 2;
    for (const name of roster) {
      cards.push({ name, x: Math.round(x), y: 30, w: Math.round(w), h: 82 });
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
      const cx = scr.w / 2, g = geometry(scr);
      scr.clear(0);
      stars.draw(scr, t);
      scr.flamingSun(cx, g.sun, 46, 96, 20, t, 1);

      scr.textCenter('CHOOSE YOUR OPPONENTS', cx, g.title, 3, 2);
      scr.textCenter('TAP TO ADD OR REMOVE - ' + (chosen.length + 1) +
                     ' AT THE TABLE', cx, g.sub, 1);

      layoutCards(scr);
      for (const c of cards) {
        const on = chosen.indexOf(c.name) !== -1;
        scr.roundRect(c.x, c.y, c.w, c.h, [4, 2, 1], on ? 1 : 0);
        scr.roundFrame(c.x, c.y, c.w, c.h, [4, 2, 1], on ? 3 : 1);
        scr.textCenter(c.name, c.x + c.w / 2, c.y + 8, on ? 3 : 2, 2);
        const lines = CW.ui.wrap(CW.ai.PROFILES[c.name].blurb,
                                 Math.floor((c.w - 14) / 4));
        let y = c.y + 28;
        for (const l of lines) { scr.textCenter(l, c.x + c.w / 2, y, on ? 2 : 1); y += 8; }
        const seat = chosen.indexOf(c.name) + 1;
        if (on) scr.textCenter('SEAT ' + seat, c.x + c.w / 2, c.y + c.h - 11, 2);
      }

      btns.clear();

      // target score
      if (g.goalLabel) scr.text('PLAY TO', g.goalLabel[0], g.goalLabel[1], 1);
      else scr.textCenter('PLAY TO', cx, g.goals - 10, 1);
      const gw = 54, gap = 8;
      const gx = cx - (GOALS.length * gw + (GOALS.length - 1) * gap) / 2;
      GOALS.forEach((v, i) => {
        btns.add(String(v), gx + i * (gw + gap), g.goals, gw, 'goal' + v,
                 { h: 24, scale: 1, quiet: v !== goal });
      });

      // the Guiding Light
      const lw = Math.min(200, scr.w - 24);
      btns.add(light ? 'GUIDING LIGHT: ON' : 'GUIDING LIGHT: OFF',
               cx - lw / 2, g.light, lw, 'light', { h: 24, scale: 1, quiet: !light });
      scr.textCenter(light ? 'ONE RANDOM EXTRA RULE, REVEALED AT THE START'
                           : 'THE PRINTED RULES, EXACTLY AS WRITTEN',
                     cx, g.lightNote, light ? 2 : 1);

      btns.add('BACK', 8, g.bottom, 60, 'menu', { quiet: true, scale: 1 });
      btns.add('START', cx - 44, g.bottom, 88, 'start');
      btns.draw(scr);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (a === 'menu') { CW.app.blips.pick(); CW.scenes.go('menu'); return true; }
      if (a === 'light') { light = !light; CW.app.blips.pick(); return true; }
      if (a && a.indexOf('goal') === 0) {
        goal = +a.slice(4); CW.app.blips.pick(); return true;
      }
      if (a === 'start') {
        CW.app.blips.bank();
        CW.scenes.go('play', { fresh: true, game: {
          goal: goal, opponents: chosen.slice(), light: light,
        } });
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
      if (k === 'g') { light = !light; return true; }
      if (k === ' ' || k === 'enter') {
        CW.scenes.go('play', { fresh: true, game: {
          goal: goal, opponents: chosen.slice(), light: light,
        } });
        return true;
      }
      if (k >= '1' && k <= '3') {
        const name = CW.ai.ROSTER[+k - 1];
        if (name) toggle(name);
        return true;
      }
      return false;
    },

    selection() { return { opponents: chosen.slice(), goal: goal, light: light }; },
  };

  CW.scenes.register('setup', scene);
})(window);
