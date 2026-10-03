/* Cosmic Wimpout 2.0 — the table. Turns the simulation into dice you can
   throw and read.

   Owns the five physical cubes and what they are: which face value sits on
   which side (Cosmic Wimpout cubes are not laid out like ordinary dice, so
   each cube gets its own arrangement), and where a set-aside cube waits. A
   throw is: lift the cubes into a loose handful, let go with a toss, wait
   until everything sleeps, read each top face. A cube resting cocked against
   another gets a small nudge, twice at most, before it is read.

   Knows nothing about the rules: it hands back faces, and the play scene
   decides what they mean. */
(function (global) {
  'use strict';
  const CW = global.CW;
  const Q = CW.quat;

  const IDS = ['c0', 'c1', 'c2', 'c3', 's'];
  const COCKED = 0.94;            // cos ~20 degrees: flatter than this reads
  const MAX_NUDGES = 2;
  const MAX_WAIT = 7.0;           // seconds before a throw is read regardless
  const LIFT_TIME = 0.42;
  const ASIDE_TIME = 0.5;

  /* Where set-aside cubes wait: in an arc near the rim on the thrower's
     right, clear of the throw, which runs away from the thrower -- the way 1.0
     leaves a kept cube on the board, dimmed. */
  const ASIDE_R = 3.95, ASIDE_STEP = 1.3 / 3.95;

  function rngFrom(seed) {
    return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  }

  // face value -> what the shader draws (1 is the Sun)
  const shaderValue = v => (v === 'S' ? 1 : v);

  class Table {
    constructor(world) {
      this.world = world;
      this.rnd = Math.random;
      const arrange = rngFrom(19760401);
      this.dice = IDS.map((id, i) => {
        const faces = id === 's' ? [2, 'S', 4, 5, 6, 10] : [2, 3, 4, 5, 6, 10];
        // a fixed, per-cube arrangement of faces over the six sides
        for (let k = faces.length - 1; k > 0; k--) {
          const j = Math.floor(arrange() * (k + 1));
          [faces[k], faces[j]] = [faces[j], faces[k]];
        }
        const body = world.add();
        return { id, i, body, faces, where: 'table', dim: false, mark: 0, visible: true };
      });
      this.tweens = [];
      this.pending = null;        // the throw being waited on
      this.layout();
    }

    byId(id) { return this.dice.find(d => d.id === id); }

    // a gentle opening arrangement: all five resting on the mat
    layout() {
      const spots = [[-2.4, 0.4], [-1.0, -1.2], [0.4, 0.6], [1.7, -0.9], [2.6, 1.3]];
      this.dice.forEach((d, i) => {
        const q = Q.mul(Q.axisAngle([0, 1, 0], (this.rnd() - 0.5) * 1.2), uprightFor(d, this.rnd));
        d.body.setPose([spots[i][0], 0.5, spots[i][1]], q);
        d.where = 'table';
      });
      for (let k = 0; k < 40; k++) this.world.frameStep(1 / 60);
    }

    // ------------------------------------------------------------ reading
    readFace(d) {
      const u = d.body.upFace();
      return { value: d.faces[u.axis], axis: u.axis, align: u.align };
    }

    // ---------------------------------------------------------- set aside
    /* Set-aside cubes go to their places on the flanks, scored face up, and
       are pinned there: a throw can bounce off them but not knock them about. */
    aside(ids, yaw) {
      yaw = yaw || 0;
      const taken = new Set(this.dice.filter(d => d.where === 'aside' && ids.indexOf(d.id) === -1).map(d => d.slot));
      for (const id of ids) {
        const d = this.byId(id);
        if (d.where === 'aside') continue;
        let k = 0;
        while (taken.has(k)) k++;
        taken.add(k);
        d.slot = k;
        d.where = 'aside';
        const face = this.readFace(d);
        const q = Q.mul(Q.axisAngle([0, 1, 0], (this.rnd() - 0.5) * 0.3), alignAxisUp(face.axis));
        // slots fan out from the point on the rim to the thrower's right
        const a = Math.atan2(-Math.sin(yaw), Math.cos(yaw)) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ASIDE_STEP;
        this.tween(d, [Math.cos(a) * ASIDE_R, 0.5, Math.sin(a) * ASIDE_R], q, ASIDE_TIME, 1.2, null, true);
      }
    }

    // every cube back in hand: unpinned, left where it lies
    gather() {
      for (const d of this.dice) {
        if (d.where === 'aside') { d.where = 'table'; d.body.pinned = false; d.body.kinematic = false; d.body.wake(); }
      }
    }

    // ------------------------------------------------------------- throws
    /* Throw the given cubes. Resolves with { id: face } once they have all
       come to rest and been read. */
    throw(ids, opts) {
      opts = opts || {};
      const list = ids.map(id => this.byId(id));
      const n = list.length;
      const rnd = this.rnd;
      return new Promise(resolve => {
        /* Gather into a loose handful above the thrower's edge of the mat,
           and toss it away from them: f points from the centre toward the
           thrower (the camera), u to their right. */
        const yaw = opts.yaw || 0;
        const f = [Math.sin(yaw), 0, Math.cos(yaw)], u = [Math.cos(yaw), 0, -Math.sin(yaw)];
        const across = d => d.body.c[0] * u[0] + d.body.c[2] * u[2];
        const order = list.slice().sort((a, b) => across(a) - across(b));
        const aim = (rnd() - 0.5) * 0.4;               // the whole toss leans a little
        const R = CW.soft.TABLE.matR;
        order.forEach((d, k) => {
          d.where = 'flight';
          d.nudges = 0;
          /* A stiff cube spans up to 1.73 corner to corner, so neighbours in
             the handful are staggered in height as well as spaced: they must
             not overlap when they let go, or they shove each other apart. */
          const a = (k - (n - 1) / 2) * 1.0 + (rnd() - 0.5) * 0.12;
          const b = R - 1.6 - (k % 2) * 0.4 + (rnd() - 0.5) * 0.2;
          const p = [u[0] * a + f[0] * b, 2.1 + (k % 2) * 1.3 + rnd() * 0.15, u[2] * a + f[2] * b];
          const q = Q.random(rnd);
          this.tween(d, p, q, LIFT_TIME + k * 0.04 + rnd() * 0.05, 2.0, () => {
            // the toss: across the mat, fanning out, tumbling
            const speed = (opts.soft ? 0.7 : 1) * (Table.SPEED + rnd() * 2.6);
            const th = aim + (rnd() - 0.5) * 0.5 - a * 0.08;
            const dir = [-f[0] * Math.cos(th) + u[0] * Math.sin(th), 0, -f[2] * Math.cos(th) + u[2] * Math.sin(th)];
            const v = [dir[0] * speed, 0.6 + rnd() * 1.8, dir[2] * speed];
            /* Mostly a forward roll, about the axis across the direction of
               travel, as a hand releases dice -- with some wobble off it. A
               strong random backspin would make a cube bite on landing and
               skid back toward the thrower. */
            const spin = 8 + rnd() * 10;
            const roll = CW.v3.cross([0, 1, 0], dir);
            const ax = CW.v3.norm([roll[0] + (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, roll[2] + (rnd() - 0.5) * 0.9]);
            const w = [ax[0] * spin, ax[1] * spin, ax[2] * spin];
            d.body.setPose(d.body.c.slice(), d.body.q.slice(), v, w);
            d.body.wake();
          });
        });
        this.pending = { list, resolve, t: 0, phase: 'flying' };
      });
    }

    busy() { return !!this.pending || this.tweens.length > 0; }

    // ------------------------------------------------------------- tweens
    /* A kinematic move: the cube follows an arc rigidly, then is handed back
       to the simulation. `arc` is the extra height at the midpoint. */
    tween(d, p1, q1, dur, arc, done, pin) {
      this.tweens = this.tweens.filter(t => t.d !== d);
      const b = d.body;
      b.kinematic = true;
      b.pinned = false;
      b.wake();
      this.tweens.push({ d, p0: Array.from(b.c), q0: Array.from(b.q), p1, q1, dur, arc, t: 0, done, pin });
    }

    update(dt) {
      // tweens
      for (const tw of this.tweens.slice()) {
        tw.t += dt;
        const u = Math.min(1, tw.t / tw.dur);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const p = [0, 1, 2].map(k => tw.p0[k] + (tw.p1[k] - tw.p0[k]) * e);
        p[1] += Math.sin(Math.PI * e) * tw.arc;
        const q = Q.slerp(tw.q0, tw.q1, e);
        tw.d.body.setPose(p, q);
        if (u >= 1) {
          this.tweens.splice(this.tweens.indexOf(tw), 1);
          if (tw.pin) tw.d.body.pinned = true;      // stays kinematic, and still
          else { tw.d.body.kinematic = false; tw.d.body.wake(); }
          if (tw.done) tw.done();
        }
      }

      // the throw in progress
      const P = this.pending;
      if (!P) return;
      P.t += dt;
      const flying = P.list.some(d => d.body.kinematic);
      if (flying) return;
      const calm = P.list.every(d => d.body.asleep);
      if (!calm && P.t < MAX_WAIT) return;

      // everything has settled: anything off the mat or cocked gets nudged
      const T = CW.soft.TABLE;
      let nudged = false;
      for (const d of P.list) {
        d.nudges = d.nudges || 0;
        const f = this.readFace(d);
        const edge = T.dist(d.body.c[0], d.body.c[2], T.matR);
        const off = edge > -0.15;
        if ((f.align < COCKED || off) && d.nudges < MAX_NUDGES) {
          d.nudges++;
          this.nudge(d, off || edge > -1.0);
          nudged = true;
        } else if ((off || f.align < COCKED) && d.nudges < MAX_NUDGES + 3) {
          /* Twice nudged and still on the rim or still leaning: set it down
             flat, on the face that was most nearly up, a little nearer the
             middle. A read is never taken from a tilted cube. */
          const c = d.body.c;
          const q = Q.mul(Q.axisAngle([0, 1, 0], this.rnd() * 6.28), alignAxisUp(f.axis));
          const r = Math.hypot(c[0], c[2]) || 1, k = Math.min(1, (T.matR - 1.4) / r);
          d.body.setPose([c[0] * k, 0.62, c[2] * k], q);
          d.body.wake();
          d.nudges++;
          nudged = true;
        }
      }
      if (nudged) { P.t = Math.min(P.t, MAX_WAIT - 3); P.nudgedAt = P.t; return; }

      this.pending = null;
      const out = {};
      for (const d of P.list) { out[d.id] = this.readFace(d).value; d.where = 'table'; }
      P.resolve(out);
    }

    /* A small nudge: a hop and a slight turn, back toward the middle of the
       mat. Enough to tip a cube off another, not enough to re-throw it. */
    nudge(d, towardCentre) {
      const b = d.body, rnd = this.rnd;
      b.wake();
      // always a little toward the centre line of the mat
      const c = b.c, T = CW.soft.TABLE;
      const tx = -(c[0] - Math.max(-T.L, Math.min(T.L, c[0]))) - c[0] * 0.1, tz = -c[2];
      const rho = Math.hypot(tx, tz) || 1, k = towardCentre ? 1.6 : 0.6;
      const v = [tx / rho * k + (rnd() - 0.5) * 0.6, 2.4 + rnd() * 0.5, tz / rho * k + (rnd() - 0.5) * 0.6];
      const w = [(rnd() - 0.5) * 5, (rnd() - 0.5) * 3, (rnd() - 0.5) * 5];
      b.addRigid(v, w);
      this.onNudge && this.onNudge(d);
    }

    // what the renderer needs per cube
    sceneDice() {
      return this.dice.map(d => ({
        visible: d.visible, sun: d.id === 's', dim: d.dim, mark: d.mark,
        faces: d.faces.map(shaderValue),
      }));
    }
  }

  // rotation taking die-local axis (0..5 = +x -x +y -y +z -z) to world up
  function alignAxisUp(axis) {
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][axis];
    // q such that q * v = (0,1,0)
    const up = [0, 1, 0];
    const d = v[1];
    if (d > 0.999) return [0, 0, 0, 1];
    if (d < -0.999) return [1, 0, 0, 0];
    const ax = CW.v3.cross(v, up);
    return Q.axisAngle(ax, Math.acos(d));
  }
  function uprightFor(d, rnd) { return alignAxisUp(Math.floor(rnd() * 6)); }

  Table.SPEED = 6;                 // the toss, before its random share: lands mid-mat

  CW.Table = Table;
  CW.Table.IDS = IDS;
  CW.Table.alignAxisUp = alignAxisUp;
})(window);
