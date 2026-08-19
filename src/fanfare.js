/* Cosmic Wimpout — the big moments.

   A Freight Train, a Supernova and a five-star win are the most dramatic things
   the game can do, and until now each passed as one line of message text. They
   get the whole screen for a couple of seconds instead. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  const KINDS = {
    freight: { dur: 2600, top: 'FREIGHT TRAIN', sub: 'FIVE OF A KIND' },
    instant_win: { dur: 3200, top: 'FIVE STARS', sub: 'THE GAME IS YOURS' },
    supernova: { dur: 3200, top: 'SUPERNOVA', sub: 'TOO MANY POINTS. YOU ARE OUT' },
  };

  const S = {
    active: null,

    fire(kind, note) {
      const k = KINDS[kind];
      if (!k) return;
      S.active = { kind, note: note || '', start: 0, dur: k.dur };
    },

    clear() { S.active = null; },

    draw(scr, t) {
      const a = S.active;
      if (!a) return;
      if (!a.start) a.start = t;
      const p = (t - a.start) / a.dur;
      if (p >= 1) { S.active = null; return; }

      const cx = scr.w / 2, cy = 100;
      const k = KINDS[a.kind];

      // wash the board out so the moment reads as an interruption
      for (let y = 0; y < scr.h; y++) {
        if ((y + Math.floor(p * 40)) % 2 === 0) scr.rect(0, y, scr.w, 1, 0);
      }

      if (a.kind === 'supernova') {
        // collapsing rings: the star falling in on itself
        for (let i = 0; i < 5; i++) {
          const r = Math.round((1 - p) * (150 - i * 22) + i * 4);
          if (r > 2) scr.circle(cx, cy, r, i % 2 ? 2 : 1);
        }
        scr.disc(cx, cy, Math.round(3 + p * 9), 3);
      } else {
        // radiating spokes for a train or a win
        const spokes = a.kind === 'instant_win' ? 24 : 16;
        for (let i = 0; i < spokes; i++) {
          const ang = i * Math.PI * 2 / spokes + p * 1.6;
          const r0 = 16 + p * 40, r1 = r0 + 26 + (i % 3) * 8;
          scr.line(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0,
                   cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1,
                   i % 2 ? 3 : 2);
        }
        scr.disc(cx, cy, Math.round(14 - p * 6), 1);
      }

      /* Solid band behind the words: the rings and spokes sweep straight
         through the text otherwise, and the subtitle becomes unreadable at the
         exact moment it matters most. */
      // headline runs cy-24..cy-9, subtitle cy+22..cy+27, note cy+34..cy+44
      const bandTop = cy - 30, bandH = a.note ? 82 : 64;
      scr.rect(0, bandTop, scr.w, bandH, 0);
      scr.rect(0, bandTop, scr.w, 1, 1);
      scr.rect(0, bandTop + bandH - 1, scr.w, 1, 1);

      // headline holds steady while the effect moves behind it
      const flick = p > 0.75 && Math.sin(t * 0.03) < 0 ? 2 : 3;
      scr.textCenter(k.top, cx, cy - 24, flick, 3);
      scr.textCenter(k.sub, cx, cy + 22, 2);
      if (a.note) scr.textCenter(a.note, cx, cy + 34, 3, 2);
    },
  };

  CW.fanfare = S;
})(window);
