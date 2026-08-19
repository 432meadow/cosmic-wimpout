/* Cosmic Wimpout — the shell.

   Owns the canvas, the scaling, the frame loop and raw input, and nothing else.
   Everything with a screen of its own lives in a scene (see scenes.js); this
   file just routes to whichever is active. Loaded last, and boots the game. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const scr = new CW.Screen(ctx, canvas.width, canvas.height);
  const blips = new CW.Blips();
  const PAL_NAMES = Object.keys(CW.PALETTES);
  let palIndex = 0;

  // shared services for scenes
  CW.app = { canvas, ctx, scr, blips };

  // -------------------------------------------------------------------- scale
  /* Logical height is fixed; logical width follows the viewport aspect so the
     board fills the screen instead of letterboxing. On a phone the CSS scale is
     fractional -- integer-only scaling collapses to 1x on a 393pt-wide iPhone --
     so we rely on image-rendering: pixelated, which snaps to device pixels and
     at 3x DPR makes the uneven pixel widths invisible.

     The keyboard hint is dropped whenever dropping it buys a bigger scale, so a
     1080p desktop fullscreen still lands on an exact integer multiple. */
  const hintEl = document.getElementById('hint');
  const isTouch = matchMedia('(hover: none)').matches;

  function resize() {
    const HINT = isTouch ? 0 : 23;
    const availW = global.innerWidth;
    const availH = Math.max(120, global.innerHeight - HINT);

    const lw = Math.max(CW.W_MIN, Math.min(CW.W_MAX,
      Math.round(CW.H * availW / availH)));
    if (canvas.width !== lw) {
      canvas.width = lw;
      canvas.height = CW.H;
      ctx.imageSmoothingEnabled = false;
      scr.setSize(lw, CW.H);
    }

    let s = Math.min(availW / lw, availH / CW.H);
    if (!isTouch) {
      const withHint = Math.floor(s);
      const without = Math.floor(Math.min(availW / lw, global.innerHeight / CW.H));
      const keep = withHint >= without;
      if (hintEl) hintEl.style.display = keep ? '' : 'none';
      s = Math.max(1, keep ? withHint : without);
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }

    canvas.style.width = (lw * s) + 'px';
    canvas.style.height = (CW.H * s) + 'px';
    canvas.dataset.scale = s;
  }
  global.addEventListener('resize', resize);
  // iOS reports stale dimensions during rotation, so settle then re-measure.
  global.addEventListener('orientationchange', () => setTimeout(resize, 200));
  if (global.visualViewport) global.visualViewport.addEventListener('resize', resize);

  // -------------------------------------------------------------------- input
  // Derive the scale from the live rect rather than a stored number: on a phone
  // it is fractional and can change on rotation or safe-area shifts.
  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * (canvas.width / rect.width),
            (e.clientY - rect.top) * (canvas.height / rect.height)];
  }

  /* pointerdown, not click: it fires immediately on touch and doubles as the
     user gesture iOS requires before an AudioContext will start. */
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    blips.ensure();
    const p = toLogical(e);
    CW.scenes.press(p[0], p[1]);
  }, { passive: false });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  if (!isTouch) {
    canvas.addEventListener('mousemove', e => {
      const [x, y] = toLogical(e);
      const s = CW.scenes.active;
      canvas.style.cursor = (s && s.hot && s.hot(x, y)) ? 'pointer' : 'default';
    });
  }

  global.addEventListener('keydown', e => {
    blips.ensure();
    const k = e.key.toLowerCase();
    // shell-level keys work in every scene
    if (k === 'p') {
      palIndex = (palIndex + 1) % PAL_NAMES.length;
      scr.setPalette(PAL_NAMES[palIndex]);
      return;
    }
    if (k === 'm') { blips.on = !blips.on; return; }
    if (CW.scenes.key(k, e)) e.preventDefault();
  });

  // --------------------------------------------------------------------- loop
  function frame(now) {
    CW.scenes.tick(now);
    CW.scenes.draw(scr, now);
    requestAnimationFrame(frame);
  }

  resize();
  CW.scenes.go('menu');
  requestAnimationFrame(frame);

  global.CWgame = {
    scenes: CW.scenes,
    go: (n, o) => CW.scenes.go(n, o),
    state: () => CW.play.state(),
    view: CW.play.view,
  };
})(window);
