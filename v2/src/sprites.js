/* Cosmic Wimpout 2.0 — 1.0's art, made into textures for the 3D table.

   Two things, both drawn by 1.0's own code rather than redrawn here:

     faces   the 24x24 cube symbols (src/art.js FACES), packed into an atlas
             the cube shader reads texel for texel
     cloth   the playing mat -- the Sun-Star corona, the spiral score track,
             its stars -- painted with 1.0's Screen primitives onto a canvas

   Both are painted in palette INDICES rather than colours: index i is grey
   i/3. The GPU lights them, then the post pass turns tones back into the
   live palette, so switching palettes (P) costs nothing. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const ORDER = [2, 3, 4, 5, 6, 10, 'S'];
  const SYM = 24, COLS = 4, ROWS = 2;
  const GREYS = ['#000000', '#555555', '#aaaaaa', '#ffffff'];

  // RGBA8 atlas: red is 255 where the symbol is inked
  function faceAtlas() {
    const w = SYM * COLS, h = SYM * ROWS, data = new Uint8Array(w * h * 4);
    ORDER.forEach((v, i) => {
      const rows = CW.FACES[v], ox = (i % COLS) * SYM, oy = Math.floor(i / COLS) * SYM;
      for (let y = 0; y < SYM; y++) for (let x = 0; x < SYM; x++) {
        const o = ((oy + y) * w + ox + x) * 4;
        data[o] = rows[y][x] === '.' ? 0 : 255;
        data[o + 3] = 255;
      }
    });
    return { data, w, h };
  }

  /* The cloth is painted at the size the mat appears on screen with the
     camera at rest, so 1.0's board art lands on the table nearly pixel for
     pixel. The layout is 1.0's (render.js): a two-turn spiral wrapping the
     Sun-Star corona, labels above and below -- round, on a round mat, where
     1.0 squashes it to fit a wide screen. */
  const geo = { W: 0, H: 0, cx: 0, cy: 0, spiral: { rx0: 0, ry0: 0, rx1: 0, ry1: 0, turns: 2 } };

  function makeScreen() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 8;
    const scr = new CW.Screen(cv.getContext('2d'), 8, 8);
    scr.pal = GREYS;
    return { cv, scr };
  }

  function layout(W, H) {
    geo.W = W; geo.H = H; geo.cx = W / 2; geo.cy = H / 2;
    const s = geo.spiral;
    s.rx1 = W / 2 - 12; s.rx0 = s.rx1 * 0.52;
    s.ry1 = H / 2 - 12; s.ry0 = s.ry1 * 0.52;
  }

  // fixed stars, so the cloth only needs repainting when the score moves
  function drift(scr) {
    let n = 1976;
    const rnd = () => (n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < geo.W * geo.H / 260; i++) {
      const x = rnd() * geo.W, y = rnd() * geo.H;
      const ex = (x - geo.cx) / geo.spiral.rx0, ey = (y - geo.cy) / geo.spiral.ry0;
      if (ex * ex + ey * ey < 1) continue;                // keep the sun clean
      if (rnd() > 0.93) scr.pipStar(x, y, 2); else scr.px(x, y, rnd() > 0.5 ? 2 : 1);
    }
  }

  // where a score sits on the track, in cloth pixels (1.0's trackPos)
  function trackPx(score, goal) {
    return CW.Screen.prototype.spiralPoint.call(null, geo.cx, geo.cy, geo.spiral,
      Math.max(0, Math.min(1, score / goal)));
  }

  // cloth pixels -> world: the canvas spans the mat's bounding box
  function toWorld(p) {
    const e = CW.soft.TABLE.extent();
    return [(p[0] / geo.W * 2 - 1) * e[0], 0, (p[1] / geo.H * 2 - 1) * e[1]];
  }

  /* opts: { w, h, goal, points }. The turn score sits in the heart of the
     sun, as on 1.0's board; at rest the shooting star does. */
  function paintCloth(cloth, opts) {
    const W = opts.w, H = opts.h, goal = opts.goal || 300, scr = cloth.scr;
    layout(W, H);
    if (cloth.cv.width !== W || cloth.cv.height !== H) {
      cloth.cv.width = W; cloth.cv.height = H;
      scr.setSize(W, H);
    }
    scr._c = -1;
    scr.clear(0);
    drift(scr);
    const cx = geo.cx, cy = geo.cy;
    // the corona fills the spiral's heart, as 1.0's fills its board's
    const rOut = Math.min(80, geo.spiral.rx0 - 3);
    scr.flamingSun(cx, cy, rOut * 0.53, rOut, 20, 0, 2);
    scr.spiralTrack(cx, cy, geo.spiral, 1);
    for (let v = 0; v <= goal; v += 25) {
      const p = trackPx(v, goal);
      if (v % 50 === 0) scr.pipStar(p[0], p[1], 2); else scr.px(p[0], p[1], 2);
    }
    for (let v = 0; v < goal; v += 50) {
      const p = trackPx(v, goal);
      scr.textCenter(String(v), p[0], p[1] + (p[1] < cy ? -9 : 5), 2);
    }
    if (opts.points > 0) scr.textCenter(String(opts.points), cx, cy - 7, 3, 3);
    else scr.shootingStar(cx + 12, cy + 2, 2, 2);
    return cloth.cv;
  }

  CW.sprites = { ORDER, SYM, COLS, ROWS, faceAtlas, makeScreen, paintCloth, trackPx, toWorld, geo };
})(window);
