'use strict';
/* Cosmic Wimpout 2.0 — physics checks. node v2/test/check.js
   Headless, deterministic, against the same softbody.js and table.js the
   page runs. Exits non-zero on any failure. */
global.window = global;
require('../src/math.js'); require('../src/softbody.js'); require('../src/table.js');
const CW = global.CW, S = CW.soft;
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const seeded = s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

// 1. Throws settle, and a settled pile never moves again.
{
  let worst = 0, unsettled = 0, drift = 0, slowest = 0;
  for (const seed of [3, 5, 11, 21, 42, 77, 99, 123]) {
    const rnd = seeded(seed);
    for (let trial = 0; trial < 6; trial++) {
      const W = new S.World();
      const bs = [];
      for (let i = 0; i < 5; i++) {
        const b = W.add();
        // the table's own handful at the thrower's edge: spaced and staggered so no two overlap
        b.setPose([(i - 2) * 1.0, 2.1 + (i % 2) * 1.3 + rnd() * 0.15, 3.4 - (i % 2) * 0.4], CW.quat.random(rnd),
          [(rnd() - 0.5) * 2.5, 1.2, -6 - rnd() * 2.6], [(rnd() - 0.5) * 22, (rnd() - 0.5) * 12, (rnd() - 0.5) * 22]);
        bs.push(b);
      }
      let at = -1;
      for (let f = 0; f < 600 && at < 0; f++) { W.frameStep(1 / 60); if (W.allAsleep()) at = (f + 1) / 60; }
      if (at < 0) { unsettled++; continue; }
      slowest = Math.max(slowest, at);
      const snap = bs.map(b => Float64Array.from(b.x));
      for (let f = 0; f < 120; f++) W.frameStep(1 / 60);
      bs.forEach((b, i) => { for (let k = 0; k < b.x.length; k++) drift = Math.max(drift, Math.abs(b.x[k] - snap[i][k])); });
      worst = Math.max(worst, ...bs.map(b => S.TABLE.dist(b.c[0], b.c[2], 0)));
    }
  }
  check('48 five-cube throws all come to rest', unsettled === 0, 'slowest ' + slowest.toFixed(2) + 's');
  check('a settled pile never moves', drift === 0, 'max drift ' + drift);
  check('every cube stays inside the rim', worst < S.TABLE.rimR - S.TABLE.rimT, 'furthest from the centre line ' + worst.toFixed(2));
}

// 2. The cubes are stiff: a hard landing barely dents them, and they settle.
{
  const W = new S.World();
  const b = W.add();
  b.setPose([0, 3.2, 0], CW.quat.axisAngle([1, 0.3, 0.2], 0.5), [0, -1, 0], [0.5, 0, 0.3]);
  let worst = 0, rebound = 0, landed = false;
  const L0 = W.topo.edgeL0, E = W.topo.edgeIdx;
  for (let f = 0; f < 120; f++) {
    W.frameStep(1 / 60);
    for (let e = 0; e < W.topo.ne; e++) {
      const i = E[e * 2] * 3, j = E[e * 2 + 1] * 3;
      const L = Math.hypot(b.x[i] - b.x[j], b.x[i + 1] - b.x[j + 1], b.x[i + 2] - b.x[j + 2]);
      worst = Math.max(worst, Math.abs(L / L0[e] - 1));
    }
    if (b.c[1] < 0.6) landed = true;
    if (landed) rebound = Math.max(rebound, b.c[1] - 0.5);
  }
  check('a cube holds its shape through a hard landing', worst < 0.045, 'worst edge strain ' + (worst * 100).toFixed(1) + '%');
  check('and does not bounce like rubber', rebound < 0.25, 'rebound ' + rebound.toFixed(3));
  check('and comes to rest', b.asleep);
}

// 3. Inverted elements recover.
{
  const W = new S.World();
  const b = W.add();
  b.setPose([0, 1.0, 0], [0, 0, 0, 1]);
  // crush the top half through the bottom half
  for (let i = 0; i < W.topo.nn; i++) b.x[i * 3 + 1] = 1.0 - (b.x[i * 3 + 1] - 1.0);
  b.xp.set(b.x);
  for (let f = 0; f < 180; f++) W.frameStep(1 / 60);
  let inverted = 0;
  const T = W.topo, x = b.x;
  for (let t = 0; t < T.nt; t++) {
    const p = k => T.tetIdx[t * 4 + k] * 3;
    const e = k => [x[p(k)] - x[p(0)], x[p(k) + 1] - x[p(0) + 1], x[p(k) + 2] - x[p(0) + 2]];
    const a = e(1), c = e(2), d = e(3);
    const V = a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0]);
    if (V <= 0) inverted++;
  }
  check('an inside-out die recovers its shape', inverted === 0, inverted + ' inverted tets left');
}

// 4. A cube left cocked against another is nudged at most twice, then read flat.
{
  let bad = 0, maxNudges = 0;
  for (let trial = 0; trial < 8; trial++) {
    const W = new S.World();
    const T = new CW.Table(W);
    T.rnd = seeded(1 + trial * 7);
    const [a, b] = T.dice;
    T.dice.slice(2).forEach(d => d.body.setPose([-3 + d.i, 0.5, -2.5], [0, 0, 0, 1]));
    a.body.setPose([0, 0.5, 0], [0, 0, 0, 1]);
    b.body.setPose([1.05, 0.75, 0.1], CW.quat.axisAngle([0, 0, 1], 0.45 + trial * 0.04));
    for (let f = 0; f < 120; f++) W.frameStep(1 / 60);
    let out = null, t = 0;
    T.pending = { list: [a, b], resolve: r => { out = r; }, t: 0 };
    while (!out && t < 15) { T.update(1 / 60); W.update(1 / 60); t += 1 / 60; }
    maxNudges = Math.max(maxNudges, b.nudges);
    if (!out || T.readFace(b).align < 0.94) bad++;
  }
  check('cocked cubes are nudged, then read flat', bad === 0 && maxNudges <= 2, 'most nudges ' + maxNudges);
}

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
