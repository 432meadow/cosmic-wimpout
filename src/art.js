/* Cosmic Wimpout — palette, pixel primitives, font and sprites.
   Logical buffer is 384x216; integer-scaled x5 it lands on exactly 1920x1080.
   Four colours only, everything drawn pixel by pixel. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  /* Logical height is fixed so type, cube and vertical rhythm stay constant on
     every device. Logical WIDTH is derived from the viewport aspect at runtime
     (see game.js resize), so the board fills an iPhone edge to edge in landscape
     instead of letterboxing. These are the desktop 16:9 defaults. */
  const W = 384, H = 216;
  const W_MIN = 384, W_MAX = 520;

  // 0 = void, 1 = deep, 2 = mid, 3 = light
  const PALETTES = {
    cosmic: ['#1a0f2e', '#573280', '#a86ba8', '#f5deb3'],
    dmg:    ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
    dusk:   ['#241734', '#6b3f5e', '#c17f7f', '#f7e0c0'],
    ether:  ['#101828', '#2f5d62', '#7ea8a1', '#e8e0c8'],
  };

  // ---------------------------------------------------------------- font 3x5
  const GLYPHS = {
    '0': '111,101,101,101,111', '1': '010,110,010,010,111',
    '2': '111,001,111,100,111', '3': '111,001,111,001,111',
    '4': '101,101,111,001,001', '5': '111,100,111,001,111',
    '6': '111,100,111,101,111', '7': '111,001,001,001,001',
    '8': '111,101,111,101,111', '9': '111,101,111,001,111',
    'A': '111,101,111,101,101', 'B': '110,101,110,101,110',
    'C': '111,100,100,100,111', 'D': '110,101,101,101,110',
    'E': '111,100,111,100,111', 'F': '111,100,111,100,100',
    'G': '111,100,101,101,111', 'H': '101,101,111,101,101',
    'I': '111,010,010,010,111', 'J': '001,001,001,101,111',
    'K': '101,101,110,101,101', 'L': '100,100,100,100,111',
    'M': '101,111,111,101,101', 'N': '101,111,111,111,101',
    'O': '111,101,101,101,111', 'P': '111,101,111,100,100',
    'Q': '111,101,101,111,001', 'R': '111,101,111,110,101',
    'S': '111,100,111,001,111', 'T': '111,010,010,010,010',
    'U': '101,101,101,101,111', 'V': '101,101,101,101,010',
    'W': '101,101,111,111,101', 'X': '101,101,010,101,101',
    'Y': '101,101,010,010,010', 'Z': '111,001,010,100,111',
    ' ': '000,000,000,000,000', '.': '000,000,000,000,010',
    '!': '010,010,010,000,010', '?': '111,001,011,000,010',
    '-': '000,000,111,000,000', ':': '000,010,000,010,000',
    '+': '000,010,111,010,000', '/': '001,001,010,100,100',
    "'": '010,010,000,000,000', ',': '000,000,000,010,100',
    '>': '100,010,001,010,100', '<': '001,010,100,010,001',
    '(': '001,010,010,010,001', ')': '100,010,010,010,100',
    '*': '101,010,101,000,000', '=': '000,111,000,111,000',
  };
  const GLYPH_CACHE = {};
  for (const k in GLYPHS) GLYPH_CACHE[k] = GLYPHS[k].split(',');

  // ------------------------------------------------- die faces, 24x24 symbols
  const FACES = {
    // two half moons -- the 2004 design, and on-theme
    2: ['........................',
        '.....###................',
        '....#####...............',
        '...###..................',
        '...###..................',
        '..###...................',
        '..###...................',
        '..###...................',
        '...###..................',
        '...###..................',
        '....#####...............',
        '.....###................',
        '................###.....',
        '...............#####....',
        '..............###.......',
        '..............###.......',
        '.............###........',
        '.............###........',
        '.............###........',
        '..............###.......',
        '..............###.......',
        '...............#####....',
        '................###.....',
        '........................'],
    // three pyramids
    3: ['........................',
        '........................',
        '........................',
        '........................',
        '...........#............',
        '..........###...........',
        '.........#####..........',
        '........#######.........',
        '.......#########........',
        '......###########.......',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '.....#.............#....',
        '....###...........###...',
        '...#####.........#####..',
        '..#######.......#######.',
        '.#########.....#########',
        '........................',
        '........................',
        '........................'],
    // four-pointed starburst
    4: ['...........##...........',
        '...........##...........',
        '..........####..........',
        '..........####..........',
        '..........####..........',
        '.........######.........',
        '.........######.........',
        '.........######.........',
        '........########........',
        '......############......',
        '...##################...',
        '########################',
        '########################',
        '...##################...',
        '......############......',
        '........########........',
        '.........######.........',
        '.........######.........',
        '.........######.........',
        '..........####..........',
        '..........####..........',
        '..........####..........',
        '...........##...........',
        '...........##...........'],
    5: ['........................',
        '........................',
        '........................',
        '.....##############.....',
        '.....##############.....',
        '.....##############.....',
        '.....###................',
        '.....###................',
        '.....###................',
        '.....###########........',
        '.....#############......',
        '.....##############.....',
        '...............####.....',
        '...............####.....',
        '...............####.....',
        '...............####.....',
        '.....###.......####.....',
        '.....####.....#####.....',
        '.....##############.....',
        '......############......',
        '.......##########.......',
        '........................',
        '........................',
        '........................'],
    // six stars
    6: ['........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '...##......##......##...',
        '...##......##......##...',
        '.######..######..######.',
        '.######..######..######.',
        '...##......##......##...',
        '...##......##......##...',
        '........................',
        '........................',
        '........................',
        '...##......##......##...',
        '...##......##......##...',
        '.######..######..######.',
        '.######..######..######.',
        '...##......##......##...',
        '...##......##......##...',
        '........................',
        '........................',
        '........................',
        '........................'],
    10: ['........................',
         '........................',
         '........................',
         '....##...####...####....',
         '...###..########.####...',
         '..####.############.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.###......###.##..',
         '....##.############.##..',
         '..######.##########.....',
         '..######..########......',
         '........................',
         '........................',
         '........................',
         '........................'],
    /* The flaming Sun-Star, after the real cube: a bright ring of irregular
       flame tendrils around a dark centre holding a shooting star. */
    S: ['........................',
        '...........#............',
        '...........#............',
        '...#....#..##..#....#...',
        '....#...#..##..#...#....',
        '.....#...#.##.#...#.....',
        '......#...####...#......',
        '.......##########.......',
        '...##..###....###..##...',
        '.....####...##.####.....',
        '......##....#...##......',
        '.#######...#....#####...',
        '...#####..##....#######.',
        '......##........##......',
        '.....####......####.....',
        '...##..###....###..##...',
        '.......##########.......',
        '......#...####...#......',
        '.....#...#.##.#...#.....',
        '....#...#..##..#...#....',
        '...#....#..##..#....#...',
        '............#...........',
        '............#...........',
        '........................'],
  };

  const DIE = 32;                       // cube footprint
  const SYM = 24;                       // symbol footprint
  const CORNER = [4, 2, 1, 1];          // per-row inset for the rounded corners

  // ------------------------------------------------------------- the buffer
  function Screen(ctx, w, h) {
    this.ctx = ctx;
    this.w = w || W;
    this.h = h || H;
    this.pal = PALETTES.cosmic;
    this._c = -1;
  }

  Screen.prototype.setSize = function (w, h) {
    this.w = w; this.h = h; this._c = -1;
  };

  Screen.prototype.setPalette = function (name) {
    this.pal = PALETTES[name] || PALETTES.cosmic;
    this._c = -1;
  };

  // Setting fillStyle is the expensive part, so only touch it on a colour change.
  Screen.prototype.ink = function (c) {
    if (c !== this._c) { this.ctx.fillStyle = this.pal[c]; this._c = c; }
  };

  Screen.prototype.clear = function (c) {
    this.ink(c || 0);
    this.ctx.fillRect(0, 0, this.w, this.h);
  };

  Screen.prototype.px = function (x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.ink(c);
    this.ctx.fillRect(x, y, 1, 1);
  };

  Screen.prototype.rect = function (x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    this.ink(c);
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  };

  Screen.prototype.frame = function (x, y, w, h, c) {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  };

  Screen.prototype.roundRect = function (x, y, w, h, insets, c) {
    const n = insets.length;
    for (let j = 0; j < h; j++) {
      let ins = 0;
      if (j < n) ins = insets[j];
      else if (j >= h - n) ins = insets[h - 1 - j];
      this.rect(x + ins, y + j, w - ins * 2, 1, c);
    }
  };

  Screen.prototype.roundFrame = function (x, y, w, h, insets, c) {
    const n = insets.length;
    const insetAt = j => (j < n ? insets[j] : (j >= h - n ? insets[h - 1 - j] : 0));
    for (let j = 0; j < h; j++) {
      const ins = insetAt(j);
      if (j === 0 || j === h - 1) {
        this.rect(x + ins, y + j, w - ins * 2, 1, c);
      } else {
        const prev = insetAt(j - 1);
        if (prev > ins) this.rect(x + ins, y + j, prev - ins, 1, c);
        else this.px(x + ins, y + j, c);
        if (prev > ins) this.rect(x + w - prev, y + j, prev - ins, 1, c);
        else this.px(x + w - 1 - ins, y + j, c);
      }
    }
  };

  Screen.prototype.circle = function (cx, cy, r, c) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      const pts = [[x, y], [y, x], [-x, y], [-y, x],
                   [-x, -y], [-y, -x], [x, -y], [y, -x]];
      for (const p of pts) this.px(cx + p[0], cy + p[1], c);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  };

  Screen.prototype.disc = function (cx, cy, r, c) {
    const r2 = r * r;
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r2 - y * y)));
      this.rect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  };

  Screen.prototype.line = function (x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };

  Screen.prototype.blit = function (rows, x, y, ink) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== '.') this.px(x + i, y + r, ink);
      }
    }
  };

  // scale = integer pixel multiplier, for headings
  Screen.prototype.text = function (str, x, y, c, scale) {
    scale = scale || 1;
    str = String(str).toUpperCase();
    let cx = x;
    for (const ch of str) {
      const g = GLYPH_CACHE[ch];
      if (g) {
        for (let r = 0; r < 5; r++)
          for (let i = 0; i < 3; i++)
            if (g[r][i] === '1')
              this.rect(cx + i * scale, y + r * scale, scale, scale, c);
      }
      cx += 4 * scale;
    }
    return cx - x;
  };

  Screen.prototype.textWidth = function (str, scale) {
    return String(str).length * 4 * (scale || 1) - (scale || 1);
  };

  Screen.prototype.textCenter = function (str, cx, y, c, scale) {
    this.text(str, cx - (this.textWidth(str, scale) >> 1), y, c, scale);
  };

  // ------------------------------------------------------------------- dice
  Screen.prototype.die = function (x, y, face, opts) {
    opts = opts || {};
    /* The Sun Cube is black with a pale sun, like the real one -- so it needs a
       lit edge, otherwise it dissolves into the background. */
    const isSun = !!opts.sunCube;
    const body = isSun ? 0 : (opts.dim ? 2 : 3);
    const ink = isSun ? (opts.dim ? 1 : 3) : (opts.dim ? 1 : 0);
    const edge = isSun ? (opts.dim ? 1 : 2) : 0;

    this.roundRect(x - 1, y - 1, DIE + 2, DIE + 2, CORNER, edge);
    this.roundRect(x, y, DIE, DIE, CORNER, body);

    const rows = FACES[face];
    if (rows) this.blit(rows, x + (DIE - SYM) / 2, y + (DIE - SYM) / 2, ink);

    if (opts.held) {
      this.roundFrame(x - 4, y - 4, DIE + 8, DIE + 8, CORNER, 3);
    } else if (opts.locked) {
      const n = DIE + 8, x0 = x - 4, y0 = y - 4;
      for (let i = 2; i < n - 2; i += 3) {
        this.px(x0 + i, y0, 2); this.px(x0 + i, y0 + n - 1, 2);
        this.px(x0, y0 + i, 2); this.px(x0 + n - 1, y0 + i, 2);
      }
    }
  };

  /* ---------------------------------------------------------- the cloth
     After the 1980 Cosmic Wimpout playing mat: white screen-print on black --
     a numbered spiral score track wrapping a crescent moon with a face, a
     flaming sun and a drift of stars. */

  // Score spiral. t runs 0..1 from the inner end to the outer end.
  Screen.prototype.spiralPoint = function (cx, cy, g, t) {
    const a = -Math.PI / 2 + t * g.turns * Math.PI * 2;
    return [cx + Math.cos(a) * (g.rx0 + (g.rx1 - g.rx0) * t),
            cy + Math.sin(a) * (g.ry0 + (g.ry1 - g.ry0) * t)];
  };

  Screen.prototype.spiralTrack = function (cx, cy, g, c) {
    const steps = Math.round(g.turns * 260);
    for (let i = 0; i <= steps; i++) {
      const p = this.spiralPoint(cx, cy, g, i / steps);
      this.px(p[0], p[1], c);
    }
  };

  Screen.prototype.pipStar = function (x, y, c) {
    x = Math.round(x); y = Math.round(y);
    this.px(x, y - 1, c); this.px(x, y + 1, c);
    this.px(x - 1, y, c); this.px(x + 1, y, c);
    this.px(x, y, c);
  };

  /* The Sun-Star corona: a ring of flames drawn as hollow outlined commas, the
     way they are inked on the real logo. Each flame is a centreline that bulges
     tangentially and returns (a lick, not a spiral arm), swept by a half-width
     that is rounded at the base, widest a fifth of the way along, and a point at
     the tip. Outlines are offset along the true path normal so the shape stays
     clean where it curves. */
  Screen.prototype.flamingSun = function (cx, cy, rIn, rOut, n, t, c) {
    const LEN  = [1, 0.79, 0.93, 0.71, 0.88, 0.97, 0.76, 0.9];
    const WAVE = [0.24, 0.15, 0.30, 0.19, 0.26, 0.13];
    const WID  = [1, 0.82, 1.12, 0.9, 1.04];
    const BASE = [1, 0.93, 1.07];
    const HOOK = [1.9, 1.2, 2.4, 1.5];
    const STEPS = 18;
    const mid = [], half = [];

    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + t * 0.00004;
      const base = rIn * BASE[i % BASE.length];
      const tip = base + (rOut - base) * LEN[i % LEN.length];
      const wave = WAVE[i % WAVE.length];
      const hook = HOOK[i % HOOK.length];
      const wMax = 4.2 * WID[i % WID.length];

      mid.length = 0; half.length = 0;
      for (let s = 0; s <= STEPS; s++) {
        const f = s / STEPS;
        const r = base + (tip - base) * f;
        const over = f > 0.6 ? f - 0.6 : 0;
        // bulge and return, plus a hook that only bites over the last third
        const a = a0 + wave * Math.sin(f * Math.PI) + hook * over * over;
        mid.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        let w = wMax * Math.pow(1 - f, 0.95);
        if (f < 0.18) w *= 0.38 + 0.62 * (f / 0.18);   // round off the base
        half.push(w);
      }

      let pl = null, pr = null, l0 = null, r0 = null;
      for (let s = 0; s <= STEPS; s++) {
        const p0 = mid[s > 0 ? s - 1 : 0], p1 = mid[s < STEPS ? s + 1 : STEPS];
        let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= d; dy /= d;
        const ox = -dy * half[s], oy = dx * half[s];
        const l = [mid[s][0] + ox, mid[s][1] + oy];
        const r_ = [mid[s][0] - ox, mid[s][1] - oy];
        if (pl) {
          this.line(pl[0], pl[1], l[0], l[1], c);
          this.line(pr[0], pr[1], r_[0], r_[1], c);
        } else { l0 = l; r0 = r_; }
        pl = l; pr = r_;
      }
      this.line(l0[0], l0[1], r0[0], r0[1], c);        // cap the rounded base
    }
  };

  const STAR5 = [
    '.....#.....',
    '.....#.....',
    '....###....',
    '....###....',
    '###########',
    '.#########.',
    '..#######..',
    '..#######..',
    '.###...###.',
    '.##.....##.',
    '.#.......#.',
  ];

  // The shooting star at the heart of the sun, with its trail of motion arcs.
  Screen.prototype.shootingStar = function (cx, cy, c, trailC) {
    for (let k = 0; k < 5; k++) {
      const r = 8 + k * 4;
      let px_ = 0, py_ = 0;
      for (let s = 0; s <= 12; s++) {
        const a = Math.PI * (0.93 + 0.34 * (s / 12));
        const x = cx + Math.cos(a) * r * 1.3, y = cy + Math.sin(a) * r;
        if (s) this.line(px_, py_, x, y, trailC);
        px_ = x; py_ = y;
      }
    }
    this.blit(STAR5, cx - 5, cy - 5, c);
  };

  // -------------------------------------------------------------- starfield
  function Stars(n, seed) {
    this.pts = [];
    let s = seed || 1;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // normalised, so the field restretches when the logical width changes
    for (let i = 0; i < n; i++)
      this.pts.push({ x: rnd(), y: rnd(), p: rnd() * 6.283, s: 0.4 + rnd() });
  }
  Stars.prototype.draw = function (scr, t) {
    for (const p of this.pts) {
      const tw = Math.sin(t * 0.0012 * p.s + p.p);
      if (tw > 0.55) scr.px(p.x * scr.w, p.y * scr.h, tw > 0.9 ? 2 : 1);
    }
  };

  // ------------------------------------------------------------------ audio
  function Blips() { this.ctx = null; this.on = true; }
  Blips.prototype.ensure = function () {
    if (!this.ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  };
  Blips.prototype.play = function (freq, dur, type, vol) {
    if (!this.on) return;
    const ac = this.ensure();
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ac.currentTime);
    g.gain.setValueAtTime(vol == null ? 0.05 : vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  };
  Blips.prototype.tick = function () { this.play(300 + Math.random() * 240, 0.035); };
  Blips.prototype.pick = function () { this.play(880, 0.05); };
  Blips.prototype.unpick = function () { this.play(520, 0.05); };
  Blips.prototype.score = function () { this.play(660, 0.08); };
  Blips.prototype.flash = function () {
    this.play(523, 0.08); setTimeout(() => this.play(784, 0.13), 80);
  };
  Blips.prototype.bank = function () {
    this.play(440, 0.08); setTimeout(() => this.play(659, 0.1), 70);
    setTimeout(() => this.play(880, 0.18), 150);
  };
  Blips.prototype.wimp = function () {
    this.play(220, 0.18, 'sawtooth');
    setTimeout(() => this.play(130, 0.32, 'sawtooth'), 120);
  };
  Blips.prototype.nova = function () {
    for (let i = 0; i < 8; i++)
      setTimeout(() => this.play(90 + i * 26, 0.26, 'sawtooth', 0.07), i * 90);
  };
  Blips.prototype.win = function () {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.play(f, 0.2), i * 110));
  };

  CW.W = W; CW.H = H; CW.W_MIN = W_MIN; CW.W_MAX = W_MAX; CW.DIE = DIE;
  CW.PALETTES = PALETTES;
  CW.FACES = FACES;
  CW.Screen = Screen;
  CW.Stars = Stars;
  CW.Blips = Blips;
})(window);
