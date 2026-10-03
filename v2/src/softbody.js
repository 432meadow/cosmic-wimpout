/* Cosmic Wimpout 2.0 — the cubes. XPBD on a tetrahedral lattice.

   Pure simulation: no DOM, no GPU, so it also runs under Node for the tuning
   harness. Every die shares one topology (a warped N^3 lattice, five tets per
   cell) and owns only its node state.

   One substep, in order:
     predict          v += g dt, x += v dt
     elasticity       co-rotational shape matching per tet, then per cell
     volume           per tet, nearly incompressible
     strain limits    hard, on every lattice edge
     contacts         floor and rim, then die against die, with friction
     stiffness        shape matching of the whole cube, which keeps it a cube
     velocities       v = dx/dt, then damp any flex about the rigid motion

   Small steps with a single iteration, so lambda starts at zero each substep
   (Macklin 2019) and the solver is just the XPBD update applied once.

   The cubes are stiff: the compliances are small enough that shape matching
   holds them essentially rigid, and what little give is left is damped out at
   once. The lattice is kept because it is what gives the contacts and the
   rounded corners their footing, and it costs little.

   Units: one die edge is 1.0. Gravity is low for the size, deliberately: at
   1.0's 216 rows a throw has to stay in the air long enough to be seen. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  /* The tray. Its shape is a stadium -- the points within some distance of
     the segment x in [-L, L] on z = 0 -- which with L = 0, as now, is simply a
     circle: a big round mat the camera can circle. */
  const TABLE = {
    L: 0,             // half-length of any straight sides (none: it is round)
    matR: 5.0,        // the mat reaches this far from the centre
    rimR: 5.42,       // the rim's tube is centred this far out
    rimT: 0.42,       // and is this thick: tall enough to stop a sliding cube
  };
  // signed distance from the centre line, less r: negative inside a stadium of radius r
  TABLE.dist = (x, z, r) => Math.hypot(Math.max(Math.abs(x) - TABLE.L, 0), z) - r;
  TABLE.extent = () => [TABLE.L + TABLE.matR, TABLE.matR];

  const OPT = {
    n: 5,             // nodes per lattice edge
    half: 0.5,        // half the edge
    round: 0.10,      // corner radius: a cube, slightly eased, as 1.0 draws it
    density: 1.0,
    gravity: 120,           // floaty, for a toss you can follow at 216 rows
    substeps: 8,

    /* Fraction of the way each node is pulled to the whole cube's best-fit
       rigid pose every substep. This is what makes the cubes stiff: one tet or
       cell constraint per substep cannot carry a hard landing across the
       lattice fast enough, but the whole-cube goal reaches every node at once. */
    rigid: 0.97,

    // XPBD compliances (alpha) for the local constraints
    tetShape: 5e-3,
    cellShape: 5e-3,
    volume: 2e-7,
    stretchMax: 1.04,       // hard strain limits on edge length
    stretchMin: 0.96,

    muS: 0.5, muK: 0.3,     // a cube on cloth
    muDie: 0.35,
    defDamp: 40,            // 1/s, deformation only: no ringing
    rollDamp: 3.2,          // 1/s, angular velocity while touching the floor
    airDamp: 0.04,

    bounceSpeed: 1.0,       // landing faster than this gets an impact response
    restitution: 0.4,       // a cube on cloth bounces, a little
    muImpact: 0.3,          // friction at the instant of a landing

    sleepSpeed: 0.11,       // node speed that counts as moving, for waking
    sleepDisp: 0.006,       // calm: the die drifts less than this...
    sleepTime: 0.30,        // ...for this long, then sleep
    wakeGap: 0.18,

  };

  // ------------------------------------------------------------------ helpers
  // Rounded-box warp: a point on the cube of half-size A goes to the rounded
  // box of the same half-size and radius rr. Nested shells give the interior.
  function warp(ux, uy, uz, a, r, out) {
    const s = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(uz)) / a;
    if (s < 1e-9) { out[0] = out[1] = out[2] = 0; return; }
    const rr = r * s, B = a * s - rr;
    const qx = Math.max(-B, Math.min(B, ux));
    const qy = Math.max(-B, Math.min(B, uy));
    const qz = Math.max(-B, Math.min(B, uz));
    const dx = ux - qx, dy = uy - qy, dz = uz - qz;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-12) { out[0] = ux; out[1] = uy; out[2] = uz; return; }
    out[0] = qx + dx / L * rr; out[1] = qy + dy / L * rr; out[2] = qz + dz / L * rr;
  }

  function quatToMat(q, o, R) {
    const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
    R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
    R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
  }

  /* Rotational part of A (row-major 3x3) by Mueller et al. 2016, warm-started
     from the quaternion at q[o]. Always returns a proper rotation, which is
     what lets inverted elements recover: the goal shape is never inverted. */
  function extractRotation(A, q, o, iters) {
    let x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
    for (let it = 0; it < iters; it++) {
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
      const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
      const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
      // omega = sum_c r_c x a_c / |sum_c r_c . a_c|   (columns)
      const a00 = A[0], a10 = A[3], a20 = A[6];
      const a01 = A[1], a11 = A[4], a21 = A[7];
      const a02 = A[2], a12 = A[5], a22 = A[8];
      const ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12);
      const oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22);
      const oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 +
                           r02 * a02 + r12 * a12 + r22 * a22) + 1e-9;
      const wx = ox / den, wy = oy / den, wz = oz / den;
      const ang = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (ang < 1e-9) break;
      const h = 0.5 * ang, sh = Math.sin(h) / ang, ch = Math.cos(h);
      const px = wx * sh, py = wy * sh, pz = wz * sh, pw = ch;
      // q = p * q
      const nx = pw * x + px * w + py * z - pz * y;
      const ny = pw * y - px * z + py * w + pz * x;
      const nz = pw * z + px * y - py * x + pz * w;
      const nw = pw * w - px * x - py * y - pz * z;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
      x = nx * l; y = ny * l; z = nz * l; w = nw * l;
    }
    q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = w;
  }

  // ----------------------------------------------------------------- topology
  function buildTopology(opt) {
    const n = opt.n, a = opt.half, r = opt.round, h = 2 * a / (n - 1);
    const nn = n * n * n;
    const id = (i, j, k) => i + n * (j + n * k);
    const grid = new Float64Array(nn * 3), rest = new Float64Array(nn * 3);
    const tmp = [0, 0, 0];
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = id(i, j, k) * 3;
      const ux = -a + i * h, uy = -a + j * h, uz = -a + k * h;
      grid[p] = ux; grid[p + 1] = uy; grid[p + 2] = uz;
      warp(ux, uy, uz, a, r, tmp);
      rest[p] = tmp[0]; rest[p + 1] = tmp[1]; rest[p + 2] = tmp[2];
    }

    const cells = [], tets = [];
    // corners by bit: x=1, y=2, z=4
    const EVEN = [[0, 1, 2, 4], [3, 2, 1, 7], [5, 1, 4, 7], [6, 4, 2, 7], [1, 2, 4, 7]];
    const ODD = [[1, 0, 3, 5], [2, 0, 3, 6], [4, 0, 5, 6], [7, 3, 5, 6], [0, 3, 5, 6]];
    for (let k = 0; k < n - 1; k++) for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const c = [];
      for (let b = 0; b < 8; b++) c.push(id(i + (b & 1), j + ((b >> 1) & 1), k + ((b >> 2) & 1)));
      cells.push(c);
      for (const t of ((i + j + k) & 1) ? ODD : EVEN) tets.push(t.map(b => c[b]));
    }

    const vol = (t) => {
      const P = i => [rest[t[i] * 3], rest[t[i] * 3 + 1], rest[t[i] * 3 + 2]];
      const p0 = P(0), p1 = P(1), p2 = P(2), p3 = P(3);
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const e3 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      return (e1[0] * (e2[1] * e3[2] - e2[2] * e3[1]) - e1[1] * (e2[0] * e3[2] - e2[2] * e3[0]) +
              e1[2] * (e2[0] * e3[1] - e2[1] * e3[0])) / 6;
    };

    const nt = tets.length, nc = cells.length;
    const tetIdx = new Int32Array(nt * 4), tetV0 = new Float64Array(nt);
    const mass = new Float64Array(nn);
    let totalV = 0;
    for (let t = 0; t < nt; t++) {
      let T = tets[t];
      let v = vol(T);
      if (v < 0) { T = [T[0], T[2], T[1], T[3]]; v = -v; }
      tets[t] = T;
      for (let q = 0; q < 4; q++) { tetIdx[t * 4 + q] = T[q]; mass[T[q]] += v * opt.density / 4; }
      tetV0[t] = v;
      totalV += v;
    }
    const invMass = new Float64Array(nn);
    let M = 0;
    for (let i = 0; i < nn; i++) { invMass[i] = 1 / mass[i]; M += mass[i]; }

    // rest centre (mass-weighted; zero by symmetry, but say so honestly)
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < nn; i++) {
      cx += mass[i] * rest[i * 3]; cy += mass[i] * rest[i * 3 + 1]; cz += mass[i] * rest[i * 3 + 2];
    }
    cx /= M; cy /= M; cz /= M;
    const local = new Float64Array(nn * 3);
    for (let i = 0; i < nn; i++) {
      local[i * 3] = rest[i * 3] - cx; local[i * 3 + 1] = rest[i * 3 + 1] - cy;
      local[i * 3 + 2] = rest[i * 3 + 2] - cz;
    }

    // rest-centred offsets for shape matching
    function centred(list, k) {
      const idx = new Int32Array(list.length * k), Q = new Float64Array(list.length * k * 3);
      const mSum = new Float64Array(list.length);
      for (let e = 0; e < list.length; e++) {
        const L = list[e];
        let m = 0, x = 0, y = 0, z = 0;
        for (const i of L) {
          m += mass[i]; x += mass[i] * rest[i * 3]; y += mass[i] * rest[i * 3 + 1];
          z += mass[i] * rest[i * 3 + 2];
        }
        x /= m; y /= m; z /= m;
        mSum[e] = m;
        L.forEach((i, q) => {
          idx[e * k + q] = i;
          Q[(e * k + q) * 3] = rest[i * 3] - x;
          Q[(e * k + q) * 3 + 1] = rest[i * 3 + 1] - y;
          Q[(e * k + q) * 3 + 2] = rest[i * 3 + 2] - z;
        });
      }
      return { idx, Q, mSum };
    }
    const T4 = centred(tets, 4), C8 = centred(cells, 8);

    // unique edges, for the strain limits
    const seen = new Map(), edges = [];
    for (const T of tets) for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      const lo = Math.min(T[p], T[q]), hi = Math.max(T[p], T[q]);
      const key = lo * nn + hi;
      if (!seen.has(key)) { seen.set(key, 1); edges.push(lo, hi); }
    }
    const ne = edges.length / 2;
    const edgeIdx = new Int32Array(edges), edgeL0 = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      const i = edges[e * 2] * 3, j = edges[e * 2 + 1] * 3;
      edgeL0[e] = Math.hypot(rest[i] - rest[j], rest[i + 1] - rest[j + 1], rest[i + 2] - rest[j + 2]);
    }

    // surface nodes: the only ones that can touch anything
    const surf = [];
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === n - 1) surf.push(id(i, j, k));
    }

    // a rounded cube's inertia is isotropic: I = (2/3) sum m r^2
    let mr2 = 0;
    for (let i = 0; i < nn; i++) mr2 += mass[i] * (local[i * 3] ** 2 + local[i * 3 + 1] ** 2 + local[i * 3 + 2] ** 2);
    const invInertia = 1 / (2 / 3 * mr2);

    return {
      n, nn, a, r, h, grid, rest, local, mass, invMass, M, volume: totalV, invInertia,
      nt, tetIdx, tetQ: T4.Q, tetM: T4.mSum, tetV0,
      nc, cellIdx: C8.idx, cellQ: C8.Q, cellM: C8.mSum,
      ne, edgeIdx, edgeL0,
      surf: new Int32Array(surf),
      id,
    };
  }

  // --------------------------------------------------------------------- body
  function Body(topo, index) {
    const nn = topo.nn;
    this.topo = topo;
    this.index = index;
    this.x = new Float64Array(nn * 3);
    this.xp = new Float64Array(nn * 3);
    this.v = new Float64Array(nn * 3);
    this.tetQ = new Float64Array(topo.nt * 4);
    this.cellQ = new Float64Array(topo.nc * 4);
    this.q = new Float64Array([0, 0, 0, 1]);     // rigid frame
    this.R = new Float64Array(9);
    this.c = new Float64Array(3);
    this.vcm = new Float64Array(3);
    this.w = new Float64Array(3);
    this.dc = new Float64Array(3);       // rigid push from contacts, per substep
    this.dth = new Float64Array(3);
    this.c0 = new Float64Array(3);
    this.moved = false;
    this.asleep = false;
    this.kinematic = false;     // driven by the table (pickups), not simulated
    this.pinned = false;        // kinematic and holding still (set aside)
    this.enabled = true;
    this.calm = 0;
    this.restless = 0;
    this.floorContacts = 0;
    this.dieContacts = 0;
    this.impact = 0;            // strongest impact this frame, for sound
    this.age = 0;
    this.setPose([0, 1, 0], [0, 0, 0, 1]);
  }

  /* Place the die rigidly. Element rotations are warm-started from the same
     quaternion, so the first substep after a teleport converges at once. */
  Body.prototype.setPose = function (c, q, v, w) {
    const T = this.topo, R = this.R, L = T.local, nn = T.nn;
    this.q.set(q);
    quatToMat(this.q, 0, R);
    for (let i = 0; i < nn; i++) {
      const lx = L[i * 3], ly = L[i * 3 + 1], lz = L[i * 3 + 2];
      const rx = R[0] * lx + R[1] * ly + R[2] * lz;
      const ry = R[3] * lx + R[4] * ly + R[5] * lz;
      const rz = R[6] * lx + R[7] * ly + R[8] * lz;
      this.x[i * 3] = c[0] + rx; this.x[i * 3 + 1] = c[1] + ry; this.x[i * 3 + 2] = c[2] + rz;
      let vx = 0, vy = 0, vz = 0;
      if (v) { vx = v[0]; vy = v[1]; vz = v[2]; }
      if (w) { vx += w[1] * rz - w[2] * ry; vy += w[2] * rx - w[0] * rz; vz += w[0] * ry - w[1] * rx; }
      this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    }
    this.xp.set(this.x);
    for (let t = 0; t < T.nt; t++) this.tetQ.set(q, t * 4);
    for (let e = 0; e < T.nc; e++) this.cellQ.set(q, e * 4);
    this.c[0] = c[0]; this.c[1] = c[1]; this.c[2] = c[2];
    // the rigid motion it is given, as the next impact will want to know
    for (let k = 0; k < 3; k++) {
      this.vcm[k] = v ? v[k] : 0; this.w[k] = w ? w[k] : 0;
    }
    this.pv = Float64Array.from(this.vcm); this.pw = Float64Array.from(this.w);
    this.calm = 0;
    this.snapC = null;
  };

  // Centre of mass and the best-fit rotation of the whole die.
  Body.prototype.frame = function () {
    const T = this.topo, x = this.x, m = T.mass, L = T.local, nn = T.nn;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < nn; i++) { cx += m[i] * x[i * 3]; cy += m[i] * x[i * 3 + 1]; cz += m[i] * x[i * 3 + 2]; }
    cx /= T.M; cy /= T.M; cz /= T.M;
    const A = SCR_A;
    A.fill(0);
    for (let i = 0; i < nn; i++) {
      const px = (x[i * 3] - cx) * m[i], py = (x[i * 3 + 1] - cy) * m[i], pz = (x[i * 3 + 2] - cz) * m[i];
      const qx = L[i * 3], qy = L[i * 3 + 1], qz = L[i * 3 + 2];
      A[0] += px * qx; A[1] += px * qy; A[2] += px * qz;
      A[3] += py * qx; A[4] += py * qy; A[5] += py * qz;
      A[6] += pz * qx; A[7] += pz * qy; A[8] += pz * qz;
    }
    extractRotation(A, this.q, 0, 4);
    quatToMat(this.q, 0, this.R);
    this.c[0] = cx; this.c[1] = cy; this.c[2] = cz;
  };

  // Rigid velocity: centre-of-mass velocity and angular velocity.
  Body.prototype.rigidVelocity = function () {
    const T = this.topo, x = this.x, v = this.v, m = T.mass, nn = T.nn, c = this.c;
    let px = 0, py = 0, pz = 0, lx = 0, ly = 0, lz = 0;
    let i00 = 0, i01 = 0, i02 = 0, i11 = 0, i12 = 0, i22 = 0;
    for (let i = 0; i < nn; i++) {
      const mi = m[i];
      const rx = x[i * 3] - c[0], ry = x[i * 3 + 1] - c[1], rz = x[i * 3 + 2] - c[2];
      const vx = v[i * 3], vy = v[i * 3 + 1], vz = v[i * 3 + 2];
      px += mi * vx; py += mi * vy; pz += mi * vz;
      lx += mi * (ry * vz - rz * vy); ly += mi * (rz * vx - rx * vz); lz += mi * (rx * vy - ry * vx);
      const r2 = rx * rx + ry * ry + rz * rz;
      i00 += mi * (r2 - rx * rx); i11 += mi * (r2 - ry * ry); i22 += mi * (r2 - rz * rz);
      i01 -= mi * rx * ry; i02 -= mi * rx * rz; i12 -= mi * ry * rz;
    }
    this.vcm[0] = px / T.M; this.vcm[1] = py / T.M; this.vcm[2] = pz / T.M;
    // invert the symmetric inertia tensor
    const c00 = i11 * i22 - i12 * i12, c01 = i02 * i12 - i01 * i22, c02 = i01 * i12 - i02 * i11;
    const det = i00 * c00 + i01 * c01 + i02 * c02;
    if (Math.abs(det) < 1e-12) { this.w.fill(0); return; }
    const c11 = i00 * i22 - i02 * i02, c12 = i01 * i02 - i00 * i12, c22 = i00 * i11 - i01 * i01;
    const id = 1 / det;
    this.w[0] = (c00 * lx + c01 * ly + c02 * lz) * id;
    this.w[1] = (c01 * lx + c11 * ly + c12 * lz) * id;
    this.w[2] = (c02 * lx + c12 * ly + c22 * lz) * id;
  };

  // Add a rigid velocity change to every node.
  Body.prototype.addRigid = function (dv, dw) {
    const nn = this.topo.nn, x = this.x, v = this.v, c = this.c;
    for (let i = 0; i < nn; i++) {
      const rx = x[i * 3] - c[0], ry = x[i * 3 + 1] - c[1], rz = x[i * 3 + 2] - c[2];
      let ax = 0, ay = 0, az = 0;
      if (dv) { ax = dv[0]; ay = dv[1]; az = dv[2]; }
      if (dw) { ax += dw[1] * rz - dw[2] * ry; ay += dw[2] * rx - dw[0] * rz; az += dw[0] * ry - dw[1] * rx; }
      v[i * 3] += ax; v[i * 3 + 1] += ay; v[i * 3 + 2] += az;
    }
  };

  /* Which face points up, and how squarely. axis 0..5 is +x,-x,+y,-y,+z,-z in
     the die's own frame; `align` is the cosine to world up. */
  Body.prototype.upFace = function () {
    const R = this.R;
    const u = [R[3], R[4], R[5]];     // R^T * (0,1,0)
    let best = 0, axis = 0;
    for (let k = 0; k < 3; k++) {
      if (u[k] > best) { best = u[k]; axis = k * 2; }
      if (-u[k] > best) { best = -u[k]; axis = k * 2 + 1; }
    }
    return { axis, align: best };
  };

  Body.prototype.wake = function () {
    if (this.asleep) { this.asleep = false; this.calm = 0; this.restless = 0; this.snapC = null; }
  };

  Body.prototype.sleep = function () {
    this.asleep = true;
    this.v.fill(0);
    this.xp.set(this.x);
  };

  // world point -> die-local (rigid frame)
  Body.prototype.toLocal = function (p, out) {
    const R = this.R, c = this.c;
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
    out[0] = R[0] * dx + R[3] * dy + R[6] * dz;
    out[1] = R[1] * dx + R[4] * dy + R[7] * dz;
    out[2] = R[2] * dx + R[5] * dy + R[8] * dz;
    return out;
  };

  const SCR_A = new Float64Array(9);

  // --------------------------------------------------------------- the world
  function World(opts) {
    this.opt = Object.assign({}, OPT, opts || {});
    this.topo = buildTopology(this.opt);
    this.bodies = [];
    this.time = 0;
    this.acc = 0;
    this.stats = { steps: 0, ms: 0 };
  }

  World.prototype.add = function () {
    const b = new Body(this.topo, this.bodies.length);
    this.bodies.push(b);
    return b;
  };

  /* Advance by frame time dt. Fixed substeps; at most two frames of catch-up
     so a stall never turns into a spiral. */
  World.prototype.update = function (dt) {
    const o = this.opt;
    const step = 1 / 60;
    this.acc = Math.min(this.acc + dt, step * 2);
    let did = 0;
    for (const b of this.bodies) b.impact = 0;
    while (this.acc >= step * 0.999) {
      this.acc -= step;
      this.frameStep(step);
      did++;
    }
    return did;
  };

  World.prototype.frameStep = function (dt) {
    const o = this.opt, bodies = this.bodies;
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    this.wakeNeighbours();
    const live = bodies.filter(b => b.enabled && !b.asleep && !b.kinematic);
    for (const b of bodies) b.touch = 0;
    const h = dt / o.substeps;
    this.h = h;
    for (let s = 0; s < o.substeps; s++) {
      for (const b of live) this.predict(b, h);
      for (const b of live) this.solveElastic(b, h);
      this.solveDice(live);
      for (const b of live) this.solveGround(b);
      for (const b of live) this.solveRigid(b);
      for (const b of live) this.finishSubstep(b, h);
    }
    for (const b of live) this.settle(b, dt);
    this.sleepIslands(live);
    this.time += dt;
    this.stats.steps++;
    this.stats.ms = 0.9 * this.stats.ms + 0.1 * ((typeof performance !== 'undefined' ? performance : Date).now() - t0);
  };

  /* A sleeping die wakes when a moving one comes close. Only a moving one:
     two calm dice resting against each other must not keep waking each other,
     or neither could ever sleep. */
  World.prototype.wakeNeighbours = function () {
    const bodies = this.bodies, gap = 1.75 + this.opt.wakeGap;
    const moving = this.opt.sleepSpeed * 3;
    for (const a of bodies) {
      if (!a.enabled || a.asleep) continue;
      const held = a.kinematic && !a.pinned;     // pinned cubes are still
      if (!held && a.calm > 0 && !(a.maxSpeed > moving)) continue;
      for (const b of bodies) {
        if (b === a || !b.enabled || !b.asleep) continue;
        const dx = a.c[0] - b.c[0], dy = a.c[1] - b.c[1], dz = a.c[2] - b.c[2];
        if (dx * dx + dy * dy + dz * dz < gap * gap) b.wake();
      }
    }
  };

  World.prototype.predict = function (b, h) {
    const nn = this.topo.nn, x = b.x, xp = b.xp, v = b.v, g = this.opt.gravity * h;
    for (let i = 0; i < nn; i++) {
      const p = i * 3;
      v[p + 1] -= g;
      xp[p] = x[p]; xp[p + 1] = x[p + 1]; xp[p + 2] = x[p + 2];
      x[p] += v[p] * h; x[p + 1] += v[p + 1] * h; x[p + 2] += v[p + 2] * h;
    }
    /* Turn every element's remembered rotation, and the cube's own, by the
       spin it is about to make. Shape matching re-fits each rotation with a
       single iteration per substep, and starting from last substep's answer
       it lags a spinning cube and drags it back: a stiff cube would stop
       turning in mid-air. */
    const w = b.w, ang = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]) * h;
    if (ang > 1e-7) {
      const s = Math.sin(ang / 2) / (ang / h), dx = w[0] * s, dy = w[1] * s, dz = w[2] * s, dw = Math.cos(ang / 2);
      const turn = (Q, n) => {
        for (let e = 0; e < n; e++) {
          const o = e * 4, qx = Q[o], qy = Q[o + 1], qz = Q[o + 2], qw = Q[o + 3];
          Q[o] = dw * qx + dx * qw + dy * qz - dz * qy;
          Q[o + 1] = dw * qy - dx * qz + dy * qw + dz * qx;
          Q[o + 2] = dw * qz + dx * qy - dy * qx + dz * qw;
          Q[o + 3] = dw * qw - dx * qx - dy * qy - dz * qz;
        }
      };
      turn(b.tetQ, this.topo.nt);
      turn(b.cellQ, this.topo.nc);
      turn(b.q, 1);
    }
  };

  /* The whole cube toward its best-fit rigid pose. Run after the contacts:
     position-based friction pins each touching node where it began the
     substep, so a stiffness correction made before it would simply be undone,
     and a cube would land crushed and stay so. Run after, it turns whatever
     the contacts did to a few nodes into a motion of the whole cube. */
  World.prototype.solveRigid = function (b) {
    const k = this.opt.rigid;
    if (!(k > 0)) return;
    const T = this.topo, x = b.x;
    b.frame();
    const Rb = b.R, c = b.c, L = T.local;
    for (let i = 0; i < T.nn; i++) {
      const p = i * 3, lx = L[p], ly = L[p + 1], lz = L[p + 2];
      x[p] += (c[0] + Rb[0] * lx + Rb[1] * ly + Rb[2] * lz - x[p]) * k;
      x[p + 1] += (c[1] + Rb[3] * lx + Rb[4] * ly + Rb[5] * lz - x[p + 1]) * k;
      x[p + 2] += (c[2] + Rb[6] * lx + Rb[7] * ly + Rb[8] * lz - x[p + 2]) * k;
    }
  };

  World.prototype.solveElastic = function (b, h) {
    const T = this.topo, o = this.opt, x = b.x, w = T.invMass, m = T.mass;
    const ih2 = 1 / (h * h);
    const A = SCR_A, R = SCR_R;

    // shape matching, generic over element size k
    const shape = (count, k, idx, Q, M, quats, alpha) => {
      for (let e = 0; e < count; e++) {
        const base = e * k;
        let cx = 0, cy = 0, cz = 0;
        for (let q = 0; q < k; q++) {
          const i = idx[base + q], mi = m[i];
          cx += mi * x[i * 3]; cy += mi * x[i * 3 + 1]; cz += mi * x[i * 3 + 2];
        }
        const Me = M[e];
        cx /= Me; cy /= Me; cz /= Me;
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0;
        for (let q = 0; q < k; q++) {
          const i = idx[base + q], mi = m[i], qq = (base + q) * 3;
          const px = (x[i * 3] - cx) * mi, py = (x[i * 3 + 1] - cy) * mi, pz = (x[i * 3 + 2] - cz) * mi;
          const qx = Q[qq], qy = Q[qq + 1], qz = Q[qq + 2];
          a0 += px * qx; a1 += px * qy; a2 += px * qz;
          a3 += py * qx; a4 += py * qy; a5 += py * qz;
          a6 += pz * qx; a7 += pz * qy; a8 += pz * qz;
        }
        A[0] = a0; A[1] = a1; A[2] = a2; A[3] = a3; A[4] = a4; A[5] = a5; A[6] = a6; A[7] = a7; A[8] = a8;
        extractRotation(A, quats, e * 4, 1);
        quatToMat(quats, e * 4, R);
        // one stiffness for the element keeps linear momentum exact
        const s = 1 / (1 + alpha * ih2 * (Me / k));
        for (let q = 0; q < k; q++) {
          const i = idx[base + q], qq = (base + q) * 3, p = i * 3;
          const qx = Q[qq], qy = Q[qq + 1], qz = Q[qq + 2];
          const gx = cx + R[0] * qx + R[1] * qy + R[2] * qz;
          const gy = cy + R[3] * qx + R[4] * qy + R[5] * qz;
          const gz = cz + R[6] * qx + R[7] * qy + R[8] * qz;
          x[p] += (gx - x[p]) * s; x[p + 1] += (gy - x[p + 1]) * s; x[p + 2] += (gz - x[p + 2]) * s;
        }
      }
    };
    shape(T.nt, 4, T.tetIdx, T.tetQ, T.tetM, b.tetQ, o.tetShape);
    shape(T.nc, 8, T.cellIdx, T.cellQ, T.cellM, b.cellQ, o.cellShape);

    // volume
    const ti = T.tetIdx, V0 = T.tetV0, av = o.volume * ih2;
    for (let t = 0; t < T.nt; t++) {
      const i0 = ti[t * 4] * 3, i1 = ti[t * 4 + 1] * 3, i2 = ti[t * 4 + 2] * 3, i3 = ti[t * 4 + 3] * 3;
      const x0 = x[i0], y0 = x[i0 + 1], z0 = x[i0 + 2];
      const e1x = x[i1] - x0, e1y = x[i1 + 1] - y0, e1z = x[i1 + 2] - z0;
      const e2x = x[i2] - x0, e2y = x[i2 + 1] - y0, e2z = x[i2 + 2] - z0;
      const e3x = x[i3] - x0, e3y = x[i3 + 1] - y0, e3z = x[i3 + 2] - z0;
      // gradients (times 6)
      const g1x = e2y * e3z - e2z * e3y, g1y = e2z * e3x - e2x * e3z, g1z = e2x * e3y - e2y * e3x;
      const g2x = e3y * e1z - e3z * e1y, g2y = e3z * e1x - e3x * e1z, g2z = e3x * e1y - e3y * e1x;
      const g3x = e1y * e2z - e1z * e2y, g3y = e1z * e2x - e1x * e2z, g3z = e1x * e2y - e1y * e2x;
      const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
      const V = (e1x * g1x + e1y * g1y + e1z * g1z) / 6;
      const C = V - V0[t];
      const w0 = w[i0 / 3], w1 = w[i1 / 3], w2 = w[i2 / 3], w3 = w[i3 / 3];
      const W = (w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
                 w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z)) / 36;
      if (W < 1e-14) continue;
      const dl = -C / (W + av) / 6;
      x[i0] += w0 * g0x * dl; x[i0 + 1] += w0 * g0y * dl; x[i0 + 2] += w0 * g0z * dl;
      x[i1] += w1 * g1x * dl; x[i1 + 1] += w1 * g1y * dl; x[i1 + 2] += w1 * g1z * dl;
      x[i2] += w2 * g2x * dl; x[i2 + 1] += w2 * g2y * dl; x[i2 + 2] += w2 * g2z * dl;
      x[i3] += w3 * g3x * dl; x[i3 + 1] += w3 * g3y * dl; x[i3 + 2] += w3 * g3z * dl;
    }

    // hard strain limits
    const ei = T.edgeIdx, L0 = T.edgeL0, hi = o.stretchMax, lo = o.stretchMin;
    for (let e = 0; e < T.ne; e++) {
      const a = ei[e * 2], c = ei[e * 2 + 1], pa = a * 3, pc = c * 3;
      const dx = x[pc] - x[pa], dy = x[pc + 1] - x[pa + 1], dz = x[pc + 2] - x[pa + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let target;
      if (L > L0[e] * hi) target = L0[e] * hi;
      else if (L < L0[e] * lo) target = L0[e] * lo;
      else continue;
      if (L < 1e-9) continue;
      const wa = w[a], wc = w[c];
      const k = (L - target) / (L * (wa + wc));
      x[pa] += wa * k * dx; x[pa + 1] += wa * k * dy; x[pa + 2] += wa * k * dz;
      x[pc] -= wc * k * dx; x[pc + 1] -= wc * k * dy; x[pc + 2] -= wc * k * dz;
    }
  };
  const SCR_R = new Float64Array(9);

  /* Floor and rim. Position-based friction: static below muS times the
     penetration, kinetic above it. Only surface nodes can touch. */
  World.prototype.solveGround = function (b) {
    const T = this.topo, o = this.opt, x = b.x, xp = b.xp, surf = T.surf;
    const R0 = TABLE.rimR, rt = TABLE.rimT;
    let contacts = 0;
    for (let s = 0; s < surf.length; s++) {
      const p = surf[s] * 3;
      // floor, y = 0
      if (x[p + 1] < 0) {
        const d = -x[p + 1];
        x[p + 1] = 0;
        const tx = x[p] - xp[p], tz = x[p + 2] - xp[p + 2];
        const tl = Math.sqrt(tx * tx + tz * tz);
        if (tl < o.muS * d) { x[p] = xp[p]; x[p + 2] = xp[p + 2]; }
        else if (tl > 0) {
          const k = Math.min(1, o.muK * d / tl);
          x[p] -= tx * k; x[p + 2] -= tz * k;
        }
        contacts++;
      }
      // the rim: a tube swept along the stadium
      let px = x[p], py = x[p + 1], pz = x[p + 2];
      let ax = Math.abs(px) > TABLE.L ? px - Math.sign(px) * TABLE.L : 0;
      let rho = Math.sqrt(ax * ax + pz * pz);
      /* and above it, an invisible wall: a hard toss must not carry a cube
         over the rim and off the table, whatever it hits on the way */
      const wall = R0;
      if (rho > wall && py > rt * 0.5) {
        const dd = rho - wall, nx = -ax / rho, nz = -pz / rho;
        x[p] += nx * dd; x[p + 2] += nz * dd;
        frictionAgainst(x, xp, p, nx, 0, nz, dd, o.muS, o.muK);
        px = x[p]; pz = x[p + 2];
        ax = Math.abs(px) > TABLE.L ? px - Math.sign(px) * TABLE.L : 0;
        rho = Math.sqrt(ax * ax + pz * pz);
        contacts++;
      }
      if (rho > R0 - rt - 0.05 && rho > 1e-6) {
        const qr = rho - R0, ql = Math.sqrt(qr * qr + py * py);
        if (ql < rt && ql > 1e-9) {
          const dd = rt - ql;
          const nx = qr / ql * ax / rho, ny = py / ql, nz = qr / ql * pz / rho;
          x[p] += nx * dd; x[p + 1] += ny * dd; x[p + 2] += nz * dd;
          frictionAgainst(x, xp, p, nx, ny, nz, dd, o.muS, o.muK);
          contacts++;
        }
      }
    }
    b.floorContacts = contacts;
  };

  function frictionAgainst(x, xp, p, nx, ny, nz, d, muS, muK) {
    let tx = x[p] - xp[p], ty = x[p + 1] - xp[p + 1], tz = x[p + 2] - xp[p + 2];
    const dn = tx * nx + ty * ny + tz * nz;
    tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < muS * d) { x[p] -= tx; x[p + 1] -= ty; x[p + 2] -= tz; }
    else if (tl > 0) {
      const k = Math.min(1, muK * d / tl);
      x[p] -= tx * k; x[p + 1] -= ty * k; x[p + 2] -= tz * k;
    }
  }

  /* Die against die: every surface node of one is tested against the other's
     rounded box, in that die's rigid frame.

     The reaction on the other die is rigid -- a shift and a small turn of its
     frame, applied Gauss-Seidel style so later contacts see the moved box,
     then laid onto its nodes once. Pushing the reaction into the other die's
     lattice nodes instead dents it where its analytic box cannot follow, and
     the two shapes then pump energy into each other indefinitely. Each die
     still dents locally, because the pair is visited from both sides. */
  World.prototype.solveDice = function (live) {
    const bodies = this.bodies;
    for (const b of live) {
      b.dieContacts = 0;
      b.dc[0] = b.dc[1] = b.dc[2] = 0;
      b.dth[0] = b.dth[1] = b.dth[2] = 0;
      b.c0[0] = b.c[0]; b.c0[1] = b.c[1]; b.c0[2] = b.c[2];
      b.moved = false;
    }
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      if (!A.enabled) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j];
        if (!B.enabled) continue;
        const aLive = live.indexOf(A) !== -1, bLive = live.indexOf(B) !== -1;
        if (!aLive && !bLive) continue;
        const dx = A.c[0] - B.c[0], dy = A.c[1] - B.c[1], dz = A.c[2] - B.c[2];
        if (dx * dx + dy * dy + dz * dz > 1.8 * 1.8) continue;
        if (aLive) this.nodesAgainst(A, B, bLive);
        if (bLive) this.nodesAgainst(B, A, aLive);
      }
    }
    // lay each frame's accumulated rigid shift onto its nodes
    for (const b of live) {
      if (!b.moved) continue;
      const x = b.x, nn = this.topo.nn, c = b.c0, d = b.dc, t = b.dth;
      for (let i = 0; i < nn; i++) {
        const p = i * 3;
        const rx = x[p] - c[0], ry = x[p + 1] - c[1], rz = x[p + 2] - c[2];
        x[p] += d[0] + t[1] * rz - t[2] * ry;
        x[p + 1] += d[1] + t[2] * rx - t[0] * rz;
        x[p + 2] += d[2] + t[0] * ry - t[1] * rx;
      }
    }
  };

  // shift and turn a die's frame in place (small rotation)
  function nudgeFrame(B, dcx, dcy, dcz, tx, ty, tz) {
    B.c[0] += dcx; B.c[1] += dcy; B.c[2] += dcz;
    B.dc[0] += dcx; B.dc[1] += dcy; B.dc[2] += dcz;
    B.dth[0] += tx; B.dth[1] += ty; B.dth[2] += tz;
    const q = B.q, x = q[0], y = q[1], z = q[2], w = q[3];
    const nx = x + 0.5 * (tx * w + ty * z - tz * y);
    const ny = y + 0.5 * (ty * w + tz * x - tx * z);
    const nz = z + 0.5 * (tz * w + tx * y - ty * x);
    const nw = w - 0.5 * (tx * x + ty * y + tz * z);
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    q[0] = nx * l; q[1] = ny * l; q[2] = nz * l; q[3] = nw * l;
    quatToMat(q, 0, B.R);
    B.moved = true;
  }

  World.prototype.nodesAgainst = function (A, B, bMoves) {
    const T = this.topo, o = this.opt, x = A.x, xp = A.xp, surf = T.surf;
    const R = B.R, c = B.c, a = T.a, r = T.r, bb = a - r, w = T.invMass;
    const margin = 0.004, iM = 1 / T.M, iI = T.invInertia;
    const h = this.h;
    for (let s = 0; s < surf.length; s++) {
      const node = surf[s], p = node * 3;
      const ex = x[p] - c[0], ey = x[p + 1] - c[1], ez = x[p + 2] - c[2];
      if (ex * ex + ey * ey + ez * ez > 0.9) continue;
      const lx = R[0] * ex + R[3] * ey + R[6] * ez;
      const ly = R[1] * ex + R[4] * ey + R[7] * ez;
      const lz = R[2] * ex + R[5] * ey + R[8] * ez;
      // rounded box SDF and gradient
      const qx = Math.abs(lx) - bb, qy = Math.abs(ly) - bb, qz = Math.abs(lz) - bb;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const inner = Math.min(Math.max(qx, qy, qz), 0);
      const sd = ol + inner - r;
      if (sd > margin) continue;
      let gx, gy, gz;
      if (ol > 1e-9) { gx = ox / ol; gy = oy / ol; gz = oz / ol; }
      else if (qx >= qy && qx >= qz) { gx = 1; gy = 0; gz = 0; }
      else if (qy >= qz) { gx = 0; gy = 1; gz = 0; }
      else { gx = 0; gy = 0; gz = 1; }
      gx *= Math.sign(lx) || 1; gy *= Math.sign(ly) || 1; gz *= Math.sign(lz) || 1;
      const nx = R[0] * gx + R[1] * gy + R[2] * gz;
      const ny = R[3] * gx + R[4] * gy + R[5] * gz;
      const nz = R[6] * gx + R[7] * gy + R[8] * gz;
      const C = sd - margin;

      // B as a rigid body at the contact point
      let wB = 0, kx = 0, ky = 0, kz = 0;
      if (bMoves) {
        kx = ey * nz - ez * ny; ky = ez * nx - ex * nz; kz = ex * ny - ey * nx;   // r x n
        wB = iM + (kx * kx + ky * ky + kz * kz) * iI;
      }
      const wA = w[node];
      const dl = -C / (wA + wB);
      x[p] += wA * dl * nx; x[p + 1] += wA * dl * ny; x[p + 2] += wA * dl * nz;
      if (bMoves) nudgeFrame(B, -dl * nx * iM, -dl * ny * iM, -dl * nz * iM, -dl * kx * iI, -dl * ky * iI, -dl * kz * iI);

      // friction: slip of the node against B's surface point
      let rx = x[p] - xp[p], ry = x[p + 1] - xp[p + 1], rz = x[p + 2] - xp[p + 2];
      if (B.vcm) {
        const bw = B.w, bv = B.vcm;
        rx -= (bv[0] + bw[1] * ez - bw[2] * ey) * h;
        ry -= (bv[1] + bw[2] * ex - bw[0] * ez) * h;
        rz -= (bv[2] + bw[0] * ey - bw[1] * ex) * h;
      }
      const rn = rx * nx + ry * ny + rz * nz;
      rx -= rn * nx; ry -= rn * ny; rz -= rn * nz;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rl > 1e-12) {
        const depth = Math.max(-C, 0.25 * o.gravity * h * h);
        const k = rl < o.muDie * depth ? 1 : Math.min(1, o.muDie * 0.8 * depth / rl);
        const share = wA / (wA + wB);
        x[p] -= rx * k * share; x[p + 1] -= ry * k * share; x[p + 2] -= rz * k * share;
        if (bMoves) {
          // the drag on B, as a rigid push along the slip
          const f = k / (wA + wB);
          const fx = rx * f, fy = ry * f, fz = rz * f;
          const tx = ey * fz - ez * fy, ty = ez * fx - ex * fz, tz = ex * fy - ey * fx;
          nudgeFrame(B, fx * iM, fy * iM, fz * iM, tx * iI, ty * iI, tz * iI);
        }
      }
      A.dieContacts++;
      A.touch |= 1 << B.index;
      B.touch |= 1 << A.index;
    }
  };

  /* Rest-frame point -> the eight lattice nodes around it, trilinear weights.
     The rest lattice is warped, but near the surface the warp is close enough
     to the plain grid that its grid coordinates serve. */
  function embed(T, p, idx, wts) {
    const n = T.n, a = T.a, h = T.h;
    let fx = (p[0] + a) / h, fy = (p[1] + a) / h, fz = (p[2] + a) / h;
    let ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    ix = Math.max(0, Math.min(n - 2, ix)); iy = Math.max(0, Math.min(n - 2, iy)); iz = Math.max(0, Math.min(n - 2, iz));
    const tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy)), tz = Math.max(0, Math.min(1, fz - iz));
    for (let b = 0; b < 8; b++) {
      const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
      idx[b] = (ix + bx) + n * ((iy + by) + n * (iz + bz));
      wts[b] = (bx ? tx : 1 - tx) * (by ? ty : 1 - ty) * (bz ? tz : 1 - tz);
    }
  }

  /* Velocities from positions, then damping that only touches the wobble:
     each node's velocity is split into the die's rigid motion plus the rest,
     and only the rest is damped. On the floor the spin is resisted too. */
  World.prototype.finishSubstep = function (b, h) {
    const o = this.opt, T = this.topo, nn = T.nn, x = b.x, xp = b.xp, v = b.v;
    const ih = 1 / h;
    const vyBefore = b.vcm[1];
    for (let i = 0; i < nn * 3; i++) v[i] = (x[i] - xp[i]) * ih;
    b.frame();
    b.rigidVelocity();

    /* A landing, answered as a rigid body would answer it. Position-based
       contact has no bounce, and friction at the instant of impact swallows a
       cube's way along the table, so a stiff cube would land dead. Instead
       the velocities from just before impact get an impulse at the contact
       point: restitution along the normal, Coulomb friction across it -- and
       because the contact is off-centre, the friction turns sliding into the
       tumble a real die makes. */
    let keep = Math.exp(-o.defDamp * h);
    if (b.floorContacts > 0 && vyBefore < -o.bounceSpeed && b.pv) {
      let rx = 0, ry = 0, rz = 0, n = 0;
      const surf = T.surf, c = b.c;
      for (let s = 0; s < surf.length; s++) {
        const p = surf[s] * 3;
        if (x[p + 1] < 0.01) { rx += x[p] - c[0]; ry += x[p + 1] - c[1]; rz += x[p + 2] - c[2]; n++; }
      }
      if (n) {
        rx /= n; ry /= n; rz /= n;
        const pv = b.pv, pw = b.pw, iM = 1 / T.M, iI = T.invInertia;
        // velocity of the contact point just before the impact
        const vx = pv[0] + pw[1] * rz - pw[2] * ry;
        const vy = pv[1] + pw[2] * rx - pw[0] * rz;
        const vz = pv[2] + pw[0] * ry - pw[1] * rx;
        if (vy < 0) {
          // normal (0,1,0): effective mass through r x n = (-rz, 0, rx)
          const kn = iM + (rz * rz + rx * rx) * iI;
          const jn = -(1 + o.restitution) * vy / kn;
          const tl = Math.hypot(vx, vz);
          let jx = 0, jz = 0;
          if (tl > 1e-6) {
            const tx = vx / tl, tz = vz / tl;
            // r x t for t = (tx, 0, tz)
            const cx = ry * tz, cy = rz * tx - rx * tz, cz = -ry * tx;
            const kt = iM + (cx * cx + cy * cy + cz * cz) * iI;
            const jt = Math.min(o.muImpact * jn, tl / kt);
            jx = -tx * jt; jz = -tz * jt;
          }
          const Jx = jx, Jy = jn, Jz = jz;
          b.vcm[0] = pv[0] + Jx * iM; b.vcm[1] = pv[1] + Jy * iM; b.vcm[2] = pv[2] + Jz * iM;
          b.w[0] = pw[0] + (ry * Jz - rz * Jy) * iI;
          b.w[1] = pw[1] + (rz * Jx - rx * Jz) * iI;
          b.w[2] = pw[2] + (rx * Jy - ry * Jx) * iI;
          keep = 0;                          // the cube moves as one after the blow
          b.impact = Math.max(b.impact, -vyBefore);
        }
      }
    }
    const vc = b.vcm, wv = b.w, c = b.c;
    const wx = wv[0], wy = wv[1], wz = wv[2];
    let dwx = 0, dwy = 0, dwz = 0;
    if (b.floorContacts > 2) {                   // a cube on the cloth stops turning
      const f = 1 - Math.exp(-o.rollDamp * h);
      dwx = -wx * f; dwy = -wy * f; dwz = -wz * f;
    }
    const air = Math.exp(-o.airDamp * h);
    for (let i = 0; i < nn; i++) {
      const p = i * 3;
      const rx = x[p] - c[0], ry = x[p + 1] - c[1], rz = x[p + 2] - c[2];
      const ux = vc[0] + wy * rz - wz * ry, uy = vc[1] + wz * rx - wx * rz, uz = vc[2] + wx * ry - wy * rx;
      v[p] = (ux + (v[p] - ux) * keep + dwy * rz - dwz * ry) * air;
      v[p + 1] = (uy + (v[p + 1] - uy) * keep + dwz * rx - dwx * rz) * air;
      v[p + 2] = (uz + (v[p + 2] - uz) * keep + dwx * ry - dwy * rx) * air;
    }
    // the rigid motion as it leaves this substep, for the next impact
    if (!b.pv) { b.pv = new Float64Array(3); b.pw = new Float64Array(3); }
    b.pv[0] = vc[0] * air; b.pv[1] = vc[1] * air; b.pv[2] = vc[2] * air;
    b.pw[0] = (wx + dwx) * air; b.pw[1] = (wy + dwy) * air; b.pw[2] = (wz + dwz) * air;
  };

  /* Sleep once calm for a while. A sleeping die is frozen exactly where it is,
     so a settled die cannot jitter: nothing touches its nodes at all. */
  World.prototype.settle = function (b, dt) {
    const o = this.opt, v = b.v, nn = this.topo.nn;
    b.age += dt;
    let m = 0;
    for (let i = 0; i < nn * 3; i += 3) {
      const s = v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2];
      if (s > m) m = s;
    }
    b.maxSpeed = Math.sqrt(m);
    /* Calm means the die as a whole has stayed put for a while: its centre
       and its orientation have not drifted. Not that the node velocities
       happen to be small this frame -- two cubes leaning on each other can
       settle into a sub-pixel contact buzz whose speed never quite drops,
       and they must still go to sleep. The speed cap keeps a cube that is
       still moving from being frozen mid-roll. */
    if (!b.snapC) { b.snapC = Float64Array.from(b.c); b.snapQ = Float64Array.from(b.q); }
    const sc = b.snapC, sq = b.snapQ;
    const dq = Math.abs(sq[0] * b.q[0] + sq[1] * b.q[1] + sq[2] * b.q[2] + sq[3] * b.q[3]);
    const turn = 2 * Math.acos(Math.min(1, dq));
    const drift = Math.hypot(b.c[0] - sc[0], b.c[1] - sc[1], b.c[2] - sc[2]) + turn * 0.5;
    const touching = b.floorContacts > 0 || b.dieContacts > 0;
    /* A cube that has been resting in contact for a while but will not quite
       come to rest -- a chain of cubes leaning on each other can creep and
       buzz indefinitely -- gets a steadily wider tolerance, so every pile
       sleeps within a few seconds. */
    if (touching && b.maxSpeed < 1.5) b.restless += dt; else b.restless = 0;
    const loose = 1 + Math.max(0, b.restless - 1.5) * 2.5;
    if (touching && drift < o.sleepDisp * loose && b.maxSpeed < o.sleepSpeed * 4 * loose) b.calm += dt;
    else { b.calm = 0; sc.set(b.c); sq.set(b.q); }

    // anything non-finite: put the die back on the table rather than lose it
    if (!(b.c[0] === b.c[0]) || b.c[1] < -3 || Math.abs(b.c[0]) > 40 || Math.abs(b.c[2]) > 40) {
      b.setPose([0, 2, 0], [0, 0, 0, 1]);
    }
  };

  /* Dice resting against each other sleep together or not at all. If one of a
     touching pair slept alone, the other would be pushing on a frozen die and
     the contact would change character the moment it woke again -- which is
     exactly the kind of switch that makes a settled pile twitch. */
  World.prototype.sleepIslands = function (live) {
    const T = this.opt.sleepTime, bodies = this.bodies;
    for (const b of live) {
      if (b.asleep || b.calm < T) continue;
      // flood the contact island and require all of it to be calm
      let seen = 1 << b.index, stack = [b], ok = true;
      const members = [];
      while (stack.length) {
        const d = stack.pop();
        members.push(d);
        if (!d.asleep && !d.kinematic && d.calm < T) { ok = false; break; }
        for (const e of bodies) {
          if (!(d.touch & (1 << e.index)) || (seen & (1 << e.index))) continue;
          seen |= 1 << e.index;
          stack.push(e);
        }
      }
      if (ok) for (const d of members) if (!d.asleep) d.sleep();
    }
  };

  // ------------------------------------------------------------- interaction
  /* Ray against each die's rounded box, sphere-traced in the die's frame.
     Returns { body, point, normal, local } or null. */
  World.prototype.pick = function (ro, rd) {
    let best = null, bestT = Infinity;
    const T = this.topo, bb = T.a - T.r;
    for (const b of this.bodies) {
      if (!b.enabled) continue;
      // bounding sphere first
      const ox = ro[0] - b.c[0], oy = ro[1] - b.c[1], oz = ro[2] - b.c[2];
      const B = ox * rd[0] + oy * rd[1] + oz * rd[2];
      const Cc = ox * ox + oy * oy + oz * oz - 0.95 * 0.95;
      const disc = B * B - Cc;
      if (disc < 0) continue;
      let t = Math.max(0, -B - Math.sqrt(disc));
      const tEnd = -B + Math.sqrt(disc);
      const R = b.R;
      for (let it = 0; it < 64 && t < tEnd; it++) {
        const px = ox + rd[0] * t, py = oy + rd[1] * t, pz = oz + rd[2] * t;
        const lx = R[0] * px + R[3] * py + R[6] * pz;
        const ly = R[1] * px + R[4] * py + R[7] * pz;
        const lz = R[2] * px + R[5] * py + R[8] * pz;
        const sd = sdBox(lx, ly, lz, bb, T.r);
        if (sd < 1e-3) {
          if (t < bestT) {
            bestT = t;
            const n = gradBox(lx, ly, lz, bb, T.r);
            best = {
              body: b, t,
              point: [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t],
              local: [lx, ly, lz],
              normal: [R[0] * n[0] + R[1] * n[1] + R[2] * n[2],
                       R[3] * n[0] + R[4] * n[1] + R[5] * n[2],
                       R[6] * n[0] + R[7] * n[1] + R[8] * n[2]],
            };
          }
          break;
        }
        t += Math.max(sd, 2e-3);
      }
    }
    return best;
  };

  function sdBox(x, y, z, b, r) {
    const qx = Math.abs(x) - b, qy = Math.abs(y) - b, qz = Math.abs(z) - b;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }
  function gradBox(x, y, z, b, r) {
    const e = 1e-4;
    const gx = sdBox(x + e, y, z, b, r) - sdBox(x - e, y, z, b, r);
    const gy = sdBox(x, y + e, z, b, r) - sdBox(x, y - e, z, b, r);
    const gz = sdBox(x, y, z + e, b, r) - sdBox(x, y, z - e, b, r);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  }

  World.prototype.allAsleep = function (list) {
    for (const b of (list || this.bodies)) if (b.enabled && !b.asleep && !b.kinematic) return false;
    return true;
  };

  // node positions, packed xyz1 per node per body, for the GPU
  World.prototype.pack = function (out) {
    const nn = this.topo.nn;
    let o = 0;
    for (const b of this.bodies) {
      const x = b.x;
      for (let i = 0; i < nn; i++) {
        out[o++] = x[i * 3]; out[o++] = x[i * 3 + 1]; out[o++] = x[i * 3 + 2]; out[o++] = 1;
      }
    }
    return out;
  };

  CW.soft = { World, Body, buildTopology, warp, embed, quatToMat, TABLE, OPT, sdBox };
  if (typeof module !== 'undefined') module.exports = CW.soft;
})(typeof window !== 'undefined' ? window : globalThis);
