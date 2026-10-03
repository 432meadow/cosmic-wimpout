/* Cosmic Wimpout 2.0 — when there is no table to draw.

   The 3D table needs WebGPU. Without it, this says why, in 1.0's own type,
   and offers 1.0 itself, which needs nothing but a canvas. */
(function (global) {
  'use strict';
  const CW = global.CW;

  const WHY = {
    missing: ['NO WEBGPU',
      'THIS BROWSER DOES NOT OFFER WEBGPU, WHICH THE 3D TABLE NEEDS. CHROME OR EDGE 113 AND LATER HAVE IT ON DESKTOP, ' +
      'CHROME 121 AND LATER ON ANDROID, AND SAFARI 26 ON MAC, IPHONE AND IPAD.'],
    insecure: ['NOT A SECURE PAGE',
      'BROWSERS ONLY OFFER WEBGPU OVER HTTPS OR ON LOCALHOST. OPEN THE GAME FROM AN HTTPS ADDRESS, OR FROM LOCALHOST.'],
    adapter: ['NO GRAPHICS ADAPTER',
      'THE BROWSER HAS WEBGPU BUT NO GPU ANSWERED. IT MAY BE SWITCHED OFF, BLOCKED FOR THIS DRIVER, OR UNAVAILABLE IN A ' +
      'VIRTUAL MACHINE OR REMOTE DESKTOP.'],
    lost: ['THE GPU WAS LOST',
      'THE GRAPHICS DEVICE STOPPED ANSWERING. RELOADING THE PAGE USUALLY BRINGS IT BACK.'],
    error: ['THE TABLE WOULD NOT START',
      'WEBGPU IS HERE, BUT SETTING UP THE TABLE FAILED.'],
  };

  const btns = new CW.ui.Buttons();
  let reason = 'missing', stars = null;

  const scene = {
    enter(opts) {
      if (!stars) stars = new CW.Stars(120, 5);
      reason = (opts && opts.reason) || (CW.app.gpuFailure && CW.app.gpuFailure.reason) || 'error';
      document.title = 'error: ' + reason;
    },

    draw(scr, t) {
      const w = WHY[reason] || WHY.error, cx = scr.w / 2;
      const oy = Math.max(0, Math.round((scr.h - 216) / 2));   // centred if tall
      scr.clear(0);
      stars.draw(scr, t);
      scr.flamingSun(cx, oy + 56, 20, 38, 16, t, 1);
      scr.textCenter('COSMIC WIMPOUT 2.0', cx, oy + 14, 2);
      scr.textCenter(w[0], cx, oy + 50, 3, 2);
      const lines = CW.ui.wrap(w[1], Math.floor((scr.w - 48) / 4));
      lines.forEach((l, i) => scr.textCenter(l, cx, oy + 100 + i * 9, 2));
      const bw = Math.min(96, (scr.w - 40) / 2);
      btns.clear().add('PLAY 1.0', cx - bw - 8, oy + 170, bw, 'classic')
        .add('RELOAD', cx + 8, oy + 170, bw, 'reload', { quiet: true });
      btns.draw(scr);
    },

    press(x, y) {
      const a = btns.hit(x, y);
      if (a === 'classic') global.location.href = '../index.html';
      else if (a === 'reload') global.location.reload();
      return true;
    },
    hot(x, y) { return !!btns.hit(x, y); },
  };

  CW.scenes.register('nogpu', scene);
})(window);
