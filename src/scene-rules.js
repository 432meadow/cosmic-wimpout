/* Cosmic Wimpout — how to play. Paged rather than scrolling: pages are cheap to
   hit-test, need no momentum physics, and read better on a short landscape
   screen than a scrolling column would. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const PAGES = [
    {
      title: 'THE CUBES',
      body:
        'Five cubes. Four common, and the black Sun Cube.\n' +
        '\n' +
        'Only 5s and 10s score on their own, for 5 and 10 points. Half moons, ' +
        'pyramids, starbursts and stars score nothing alone.\n' +
        '\n' +
        'The Flaming Sun is wild. Take it as a 5 or a 10, use it in a flash, or ' +
        'leave it and roll it again - though you must take it if it is the ' +
        'only cube scoring on that throw.',
    },
    {
      title: 'FLASHES AND TRAINS',
      body:
        'Three matching faces in ONE throw is a FLASH, worth ten times the face ' +
        'value. Three half moons is 20, three 10s is 100.\n' +
        '\n' +
        'Five matching faces is a FREIGHT TRAIN, worth a hundred times. Five ' +
        'stars wins the game outright. Five 10s is a SUPERNOVA - too many ' +
        'points, and you are out.\n' +
        '\n' +
        'Roll the Sun beside a pair and you MUST make it a flash.',
    },
    {
      title: 'WIMPING OUT',
      body:
        'Roll no 5, no 10, no flash and no train, and you WIMPOUT. The turn ends ' +
        'and every point you gathered this turn is gone.\n' +
        '\n' +
        'Points you have BANKED are never lost.\n' +
        '\n' +
        'Wimping out on all five cubes is a TRAIN WRECK.',
    },
    {
      title: 'YOU MUST KEEP ROLLING',
      body:
        'Three rules take away your choice to stop.\n' +
        '\n' +
        '35 TO GET ON THE BOARD. You cannot bank until you have 35. The best ' +
        'single throw without a flash is only 30, so you need either a flash ' +
        'or several throws in a row that keep scoring.\n' +
        '\n' +
        'THE FUTTLESS RULE. After a flash you must keep rolling to clear it.\n' +
        '\n' +
        'YOU MAY NOT WANT TO BUT YOU MUST. Score with all five cubes and you ' +
        'pick all five back up.',
    },
    {
      title: 'THE REROLL CLAUSE',
      body:
        'While clearing a flash you may not keep a cube showing the face you ' +
        'flashed. Roll one and it goes straight back to be thrown again.\n' +
        '\n' +
        'That is a re-throw, not a loss - and it cuts both ways. Flashing a face ' +
        'that does not score is protective, because every time you roll it you ' +
        'get a free throw instead of losing the turn.\n' +
        '\n' +
        'Flash 10s and your 10s are dead while you clear. Big score, bad odds.',
    },
    {
      title: 'WINNING',
      body:
        'First past the target triggers LAST LICKS: everyone else gets one final ' +
        'turn to catch and pass the leader.\n' +
        '\n' +
        'Or end it in a single throw. Five stars and the game is yours.\n' +
        '\n' +
        'Most players agree that hesitation is a bad idea. So roll, already.',
    },
  ];

  const btns = new CW.ui.Buttons();
  let page = 0;
  let stars = null;

  const scene = {
    enter() { page = 0; if (!stars) stars = new CW.Stars(90, 21); },

    /* 1.0 is always landscape and gets its layout exactly. A canvas taller
       than it is wide (the 3D edition on an upright phone) gets a tall panel
       and a button row it can fit. */
    draw(scr, t) {
      const cx = scr.w / 2;
      const p = PAGES[page];
      const tall = scr.h > scr.w;
      const pw = Math.min(scr.w - (tall ? 16 : 40), 380), px = cx - pw / 2;
      const chars = Math.floor((pw - 20) / 4), step = tall ? 9 : 8;
      /* Tall: the panel fits the longest page, so it does not jump about as
         you page, and title, panel and buttons sit centred as one block. */
      let panelH = 122, oy = 0;
      if (tall) {
        const most = PAGES.reduce((m, q) => Math.max(m, CW.ui.wrap(q.body, chars).length), 0);
        panelH = Math.min(scr.h - 100, most * step + 16);
        oy = Math.max(0, Math.round((scr.h - (42 + panelH + 14 + 26)) / 2));
      }
      const by = tall ? oy + 42 + panelH + 14 : 182;   // the button row

      scr.clear(0);
      stars.draw(scr, t);
      scr.flamingSun(cx, tall ? oy + 42 + panelH / 2 : 104, 46, 92, 20, t, 1);

      scr.textCenter(p.title, cx, oy + 14, 3, 2);
      scr.textCenter((page + 1) + ' / ' + PAGES.length, cx, oy + 32, tall ? 2 : 1);

      // panel keeps the body legible over the corona
      scr.roundRect(px, oy + 42, pw, panelH, [4, 2, 1], 0);
      scr.roundFrame(px, oy + 42, pw, panelH, [4, 2, 1], 1);

      const lines = CW.ui.wrap(p.body, chars);
      let y = oy + 50;
      for (const line of lines) {
        if (y > oy + 42 + panelH - 8) break;
        scr.text(line, px + 10, y, line === line.toUpperCase() && line ? 3 : 2);
        y += step;
      }

      btns.clear();
      btns.add('BACK', 8, by, 60, 'menu', { quiet: true, scale: 1 });
      const bw = tall ? Math.min(80, (scr.w - 84) / 2) : 88;
      const left = tall ? 76 : cx - 96, right = tall ? scr.w - 8 - bw : cx + 8;
      if (page > 0) btns.add('PREV', left, by, bw, 'prev');
      if (page < PAGES.length - 1) btns.add('NEXT', right, by, bw, 'next');
      else btns.add('PLAY', right, by, bw, 'play');
      btns.draw(scr);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (!a) return true;
      CW.app.blips.pick();
      if (a === 'prev') page = Math.max(0, page - 1);
      else if (a === 'next') page = Math.min(PAGES.length - 1, page + 1);
      else if (a === 'menu') CW.scenes.go('menu');
      else if (a === 'play') CW.scenes.go('play', { fresh: !CW.play.hasGame() });
      return true;
    },

    key(k) {
      if (k === 'escape' || k === 'backspace') { CW.scenes.go('menu'); return true; }
      if (k === 'arrowleft') { page = Math.max(0, page - 1); return true; }
      if (k === 'arrowright' || k === ' ') {
        page = Math.min(PAGES.length - 1, page + 1);
        return true;
      }
      return false;
    },
  };

  CW.scenes.register('rules', scene);
})(window);
