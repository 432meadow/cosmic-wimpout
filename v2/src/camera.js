/* Cosmic Wimpout 2.0 — the camera.

   It circles the tray: drag the empty table to spin it round or tip it up
   and down, pinch or scroll to zoom. However it is turned, it aims at the
   middle of the mat, and the picture is shifted so the mat sits centred in
   the band 1.0's layout leaves free -- below the players' chips, above the
   message line and buttons.

   fit() runs when the screen changes shape: it finds the distance at which
   the whole tray just fills that band. Zoom is a factor on that distance. */
(function (global) {
  'use strict';
  const CW = global.CW;

  // 1.0's vertical budget: chips end at 30, the message line is 53 from the bottom
  const BAND_TOP = 31, BAND_BOTTOM_GAP = 53, SIDE = 6;
  const PITCH_MIN = 0.34, PITCH_MAX = 1.45, ZOOM_MIN = 0.42, ZOOM_MAX = 1.9;

  class Camera {
    constructor() {
      this.yaw = 0;
      this.pitch = 1.0;
      this.zoom = 1;
      this.fov = 30 * Math.PI / 180;
      this.base = 14;              // fitted distance
      this.shift = 0;              // the band's centre, as a clip-space offset
      this.vyaw = 0; this.vpitch = 0;
      this.w = 0; this.h = 0;
    }

    get dist() { return this.base * this.zoom; }

    // project a world point to logical pixels
    project(p) {
      const c = CW.m4.xform(this.viewProj, p);
      return [(c[0] / c[3] * 0.5 + 0.5) * this.w, (0.5 - c[1] / c[3] * 0.5) * this.h, c[3]];
    }

    place(yaw, pitch, dist) {
      const cp = Math.cos(pitch);
      this.eye = [Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist];
      this.view = CW.m4.lookAt(this.eye, [0, 0, 0], [0, 1, 0]);
      const proj = CW.m4.perspective(this.fov, this.w / this.h, 0.5, 260);
      // slide the picture so the table's middle sits in the band's middle:
      // clip y gains shift * z_view, which is -shift in NDC
      proj[9] += this.shift;
      this.viewProj = CW.m4.mul(proj, this.view);
      this.invViewProj = CW.m4.invert(this.viewProj);
    }

    update(dt) {
      if (dt > 0 && (this.vyaw || this.vpitch)) {
        this.yaw += this.vyaw * dt;
        this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + this.vpitch * dt));
        const k = Math.exp(-dt * 8);
        this.vyaw *= k; this.vpitch *= k;
        if (Math.abs(this.vyaw) < 2e-3) this.vyaw = 0;
        if (Math.abs(this.vpitch) < 2e-3) this.vpitch = 0;
      }
      this.place(this.yaw, this.pitch, this.dist);
    }

    // a drag across the table, in logical pixels
    orbit(dx, dy, dt) {
      const ky = 0.009, kp = 0.007, cap = 4;
      this.yaw -= dx * ky;
      this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dy * kp));
      // a flick carries on a little, never a spin
      if (dt > 0) {
        this.vyaw = Math.max(-cap, Math.min(cap, -dx * ky / dt));
        this.vpitch = Math.max(-cap, Math.min(cap, dy * kp / dt));
      }
    }
    hold() { this.vyaw = this.vpitch = 0; }
    zoomBy(f) { this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * f)); }

    // the tray's outline on screen: the rim's outer edge, top included
    bounds() {
      const T = CW.soft.TABLE;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const q of CW.mesh.stadium(T, T.rimR + T.rimT, 64)) {
        for (const y of [0, T.rimT]) {
          const p = this.project([q[0], y, q[1]]);
          x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
        }
      }
      return { x0, x1, y0, y1 };
    }

    /* Logical pixels per world unit at the middle of the mat, as the camera
       sits at rest: what the cloth is painted to. Measured by fit(). */
    clothScale() { return this.ppu; }

    /* Fit to a logical screen of w x h, at the default angle: the distance at
       which the tray just fills the band, and the shift that centres it. */
    fit(w, h) {
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      const top = BAND_TOP, bottom = h - BAND_BOTTOM_GAP;
      this.shift = 0;
      let lo = 4, hi = 120;
      for (let it = 0; it < 32; it++) {
        const d = (lo + hi) / 2;
        this.place(0, 1.0, d);
        const b = this.bounds();
        if (b.y1 - b.y0 > bottom - top || b.x1 - b.x0 > w - SIDE * 2) lo = d; else hi = d;
      }
      this.base = hi;
      // centre it: move the picture until the tray's box sits mid-band
      for (let it = 0; it < 12; it++) {
        this.place(0, 1.0, this.base);
        const b = this.bounds(), mid = (b.y0 + b.y1) / 2, want = (top + bottom) / 2;
        this.shift -= (mid - want) / h * 2;
      }
      const o = this.project([0, 0, 0]), x = this.project([1, 0, 0]);
      this.ppu = x[0] - o[0];
      this.place(this.yaw, this.pitch, this.dist);
    }

    // a ray through a logical pixel
    ray(x, y) {
      const M = CW.m4, nx = x / this.w * 2 - 1, ny = 1 - y / this.h * 2;
      const a = M.xform(this.invViewProj, [nx, ny, 0]), b = M.xform(this.invViewProj, [nx, ny, 1]);
      const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      return { o: p0, d: CW.v3.norm(CW.v3.sub(p1, p0)) };
    }
  }

  CW.Camera = Camera;
})(window);
