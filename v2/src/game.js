/* Cosmic Wimpout 2.0 — the shell.

   1.0's shell (src/game.js) with a second canvas underneath. The top canvas
   is 1.0's: a 2D pixel buffer every scene draws into, exactly as in 1.0. The
   one below is WebGPU, where the play scene renders the table. Both share one
   logical size and one CSS scale with crisp pixels, so the table and the type
   over it are on a single pixel grid.

   Unlike 1.0 it fills the whole window. The scale is 1.0's -- whole pixels on
   desktop, as large as fits 384 x 216 on touch -- but instead of
   letterboxing, the logical canvas grows to cover the screen. 1.0's scenes
   are laid out for 216 rows, so they are drawn centred in whatever height
   there is; the play scene spreads out, with the scoreboard along the top,
   the message and buttons along the bottom, and the table between.

   On the table: tap a cube or a button as in 1.0, drag to spin the table,
   pinch or scroll to zoom. Loaded last; boots the game. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const canvas = document.getElementById('screen');
  const gl = document.getElementById('gl');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const scr = new CW.Screen(ctx, canvas.width, canvas.height);
  const blips = new CW.Blips();
  const PAL_NAMES = Object.keys(CW.PALETTES);
  let palIndex = 0;
  const ambient = new CW.Ambient(blips);
  const stars = new CW.Stars(260, 11);     // round 1.0's centred scenes, edge to edge

  // the cubes and the table exist from the start; the GPU arrives shortly
  const world = new CW.soft.World();
  const table = new CW.Table(world);
  const cam = new CW.Camera();

  /* view: the logical size and where things go in it.
       mid    centres a 216-row layout (1.0's scenes, in landscape)
       low    how far the play furniture -- status, message, buttons, hints --
              moves down from where 1.0 draws it
       fan    the same for the middle: the game-over panel and the fanfare
       band   the rows the table is fitted between
       btn    where the buttons go, when not 1.0's row (see render.js) */
  const view = { w: CW.W_MIN, h: CW.H, mid: 0, low: 0, fan: 0, band: [31, 163], btn: null, portrait: false };
  CW.app = { canvas, ctx, scr, blips, ambient, world, table, cam, view, renderer: null };

  // -------------------------------------------------------------------- scale
  const isTouch = matchMedia('(hover: none)').matches;
  /* Upright, 1.0's 384-wide layouts would leave a phone with pixels about a
     point across. Instead the canvas is 240 wide -- pixels about as big as
     1.0's on a phone held sideways -- and the scenes lay themselves out tall. */
  const PORTRAIT_W = 240;

  function resize() {
    const iw = global.innerWidth, ih = global.innerHeight;
    const portrait = ih > iw;
    let s = portrait ? iw / PORTRAIT_W : Math.min(iw / CW.W_MIN, ih / CW.H);
    if (!isTouch) s = Math.max(1, Math.floor(s));        // whole pixels on desktop
    else s = Math.max(0.5, s);
    const lw = Math.ceil(iw / s), lh = Math.ceil(ih / s);
    if (canvas.width !== lw || canvas.height !== lh) {
      canvas.width = lw; canvas.height = lh;
      ctx.imageSmoothingEnabled = false;
      scr.setSize(lw, lh);
    }
    view.w = lw; view.h = lh; view.portrait = portrait;
    view.mid = Math.floor((lh - CW.H) / 2);
    if (!portrait) {
      // 1.0's layout, stretched: chips on top, furniture on the bottom edge
      view.band = [31, lh - 53];
      view.low = lh - CW.H;
      view.btn = null;
    } else {
      /* Upright: the table right under the chips, the message under the
         table, then -- with room to breathe -- the big buttons, and MENU
         below those. The whole group sits a little above the middle of what
         is left. */
      const tableH = Math.round(lw * 0.9), blockH = tableH + 154;
      const top = 32 + Math.max(0, Math.round((lh - 32 - blockH) * 0.42));
      view.band = [top, top + tableH];
      view.low = top + tableH - 158;                     // status and message 10 below
      view.btn = { y: CW.render.BTN_Y + 46, w: 100, h: 34, single: 168,
                   menu: { x: lw / 2 - 26, y: CW.render.BTN_Y + 96 } };
    }
    view.fan = Math.round((view.band[0] + view.band[1]) / 2 - 98);
    if (CW.app.renderer) CW.app.renderer.setSize(lw, lh);
    else { gl.width = lw; gl.height = lh; }
    cam.fit(lw, lh, view.band);
    for (const c of [canvas, gl]) {
      c.style.width = (lw * s) + 'px';
      c.style.height = (lh * s) + 'px';
    }
    canvas.dataset.scale = s;
  }
  global.addEventListener('resize', resize);
  global.addEventListener('orientationchange', () => setTimeout(resize, 200));
  if (global.visualViewport) global.visualViewport.addEventListener('resize', resize);

  /* 1.0's scenes think in 216 rows. In landscape they are drawn centred in
     the taller canvas; upright they get the whole of it and lay out tall. */
  const inPlay = () => CW.scenes.name === 'play';
  const centred = () => !inPlay() && !view.portrait;
  const scenePoint = (x, y) => (centred() ? [x, y - view.mid] : [x, y]);

  // -------------------------------------------------------------------- input
  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * (canvas.width / rect.width),
            (e.clientY - rect.top) * (canvas.height / rect.height)];
  }

  /* Pointers. Everywhere but the table, a press acts at once, as in 1.0. On
     the table a press on a button still does; anywhere else it waits to see
     whether it is a tap (a cube, as in 1.0) or a drag (spin the table), and
     two fingers pinch to zoom. */
  const TAP_PX = 5;
  const pointers = new Map();
  let pinch = 0;

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    blips.ensure();
    const p = toLogical(e);
    if (!inPlay() || CW.play.onButton(p[0], p[1])) {
      const q = scenePoint(p[0], p[1]);
      CW.scenes.press(q[0], q[1]);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: p[0], y: p[1], x0: p[0], y0: p[1], t: performance.now(), moved: false });
    cam.hold();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      a.moved = b.moved = true;                         // a pinch is never a tap
    }
  }, { passive: false });

  canvas.addEventListener('pointermove', e => {
    const p = toLogical(e);
    const ptr = pointers.get(e.pointerId);
    if (!ptr) {
      if (!isTouch) {
        const q = scenePoint(p[0], p[1]);
        const s = CW.scenes.active;
        canvas.style.cursor = (s && s.hot && s.hot(q[0], q[1])) ? 'pointer' : 'default';
      }
      return;
    }
    const now = performance.now(), dt = (now - ptr.t) / 1000;
    const dx = p[0] - ptr.x, dy = p[1] - ptr.y;
    ptr.x = p[0]; ptr.y = p[1]; ptr.t = now;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) cam.zoomBy(pinch / d);
      pinch = d;
      return;
    }
    if (!ptr.moved && Math.hypot(p[0] - ptr.x0, p[1] - ptr.y0) > TAP_PX) ptr.moved = true;
    if (ptr.moved) { canvas.style.cursor = 'grabbing'; cam.orbit(dx, dy, dt); }
  });

  function release(e) {
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    canvas.style.cursor = 'default';
    if (!ptr.moved && e.type === 'pointerup' && inPlay()) CW.scenes.press(ptr.x0, ptr.y0);
    if (performance.now() - ptr.t > 80) cam.hold();     // let go still: no fling
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (inPlay()) cam.zoomBy(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  global.addEventListener('keydown', e => {
    blips.ensure();
    const k = e.key.toLowerCase();
    // the palette is the whole look, table included
    if (k === 'p') {
      palIndex = (palIndex + 1) % PAL_NAMES.length;
      scr.setPalette(PAL_NAMES[palIndex]);
      return;
    }
    if (k === 'm') { blips.on = !blips.on; return; }
    if (CW.scenes.key(k, e)) e.preventDefault();
  });

  function flush() { if (CW.play && CW.play.persist) CW.play.persist(); }
  global.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // --------------------------------------------------------------------- loop
  let last = 0;
  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (inPlay() || !blips.on) ambient.stop();
    else if (blips.ctx && blips.ctx.state === 'running') ambient.start();

    // the table is only visible in play; elsewhere 1.0's scenes draw opaque
    gl.style.visibility = inPlay() ? 'visible' : 'hidden';
    cam.update(dt);
    CW.scenes.tick(now);
    if (!centred()) {
      CW.scenes.draw(scr, now);
    } else {
      // a 216-row scene, centred in the full-window canvas
      scr.setSize(view.w, view.h);
      scr._c = -1;
      scr.clear(0);
      stars.draw(scr, now);
      ctx.save();
      ctx.translate(0, view.mid);
      scr.setSize(view.w, CW.H);
      CW.scenes.draw(scr, now);
      ctx.restore();
      scr.setSize(view.w, view.h);
      scr._c = -1;
    }
    if (CW.app.renderer && CW.app.renderer.lost && CW.scenes.name !== 'nogpu') {
      CW.scenes.go('nogpu', { reason: 'lost' });
    }
    requestAnimationFrame(frame);
  }

  resize();
  CW.scenes.go('menu');
  requestAnimationFrame(frame);

  // the GPU: once it is up, the saved match (if any) is laid out on the table
  CW.Renderer.create(gl, world, 5).then(r => {
    CW.app.renderer = r;
    resize();
    r.setSize(view.w, view.h);
    CW.play.restore();
    document.title = 'Cosmic Wimpout 2.0';
  }).catch(e => {
    console.error(e);
    CW.app.gpuFailure = e;
    CW.scenes.go('nogpu', { reason: e.reason || 'error', detail: String(e.message || e) });
  });

  // a handle for the console and the headless tests
  global.CW2 = {
    world, table, cam, scr, layout: view,
    get renderer() { return CW.app.renderer; },
    get view() { return CW.play.view; },          // the play scene's view
    scenes: CW.scenes,
    state: () => CW.play.state(),
  };
})(window);
