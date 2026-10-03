/* Cosmic Wimpout 2.0 — geometry.

   The dice: a rounded-cube surface embedded in the physics lattice. Each render
   vertex stores where it sits in its lattice cell (trilinear coordinates), the
   small rest offset between the true rounded surface and the lattice's own
   interpolation of it, and its rest normal. The GPU then rebuilds position and
   normal every frame from node positions alone: x = sum N x + F d, and
   n = cof(F) n0, with F interpolated from per-node deformation gradients.

   The board: the floor the cloth is printed on, and the raised rim. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  /* Samples along one face axis, from -a to a. The flat part is uniform; the
     rounded part is spaced by equal angle, so the edges stay smooth in
     silhouette without spending vertices on the flat. */
  function axisSamples(a, r, flatSegs, arcSegs) {
    const b = a - r, out = [];
    for (let i = arcSegs; i > 0; i--) out.push(-(b + r * Math.tan(i / arcSegs * Math.PI / 4)));
    for (let i = 0; i <= flatSegs; i++) out.push(-b + 2 * b * i / flatSegs);
    for (let i = 1; i <= arcSegs; i++) out.push(b + r * Math.tan(i / arcSegs * Math.PI / 4));
    return out;
  }

  function diceMesh(topo) {
    const a = topo.a, r = topo.r, b = a - r, n = topo.n, h = topo.h;
    const S = axisSamples(a, r, 10, 3);
    const m = S.length;
    const rest = [], idx = [];
    const tmp = [0, 0, 0];
    let count = 0;

    for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const faceId = axis * 2 + (sign < 0 ? 1 : 0);
      const base = count;
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const p = [0, 0, 0];
        p[axis] = sign * a; p[u] = S[i]; p[v] = S[j];
        CW.soft.warp(p[0], p[1], p[2], a, r, tmp);
        const X = tmp.slice();
        // rest normal: from the inner box to the surface
        const q = p.map(c => Math.max(-b, Math.min(b, c)));
        let nx = X[0] - q[0], ny = X[1] - q[1], nz = X[2] - q[2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // lattice cell and trilinear coordinates, from the unwarped cube point
        const cell = [0, 0, 0], t = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const f = (p[k] + a) / h;
          cell[k] = Math.max(0, Math.min(n - 2, Math.floor(f)));
          t[k] = Math.max(0, Math.min(1, f - cell[k]));
        }
        const c0 = cell[0] + n * (cell[1] + n * cell[2]);
        let ix = 0, iy = 0, iz = 0;
        for (let bb = 0; bb < 8; bb++) {
          const bx = bb & 1, by = (bb >> 1) & 1, bz = (bb >> 2) & 1;
          const node = c0 + bx + n * (by + n * bz);
          const w = (bx ? t[0] : 1 - t[0]) * (by ? t[1] : 1 - t[1]) * (bz ? t[2] : 1 - t[2]);
          ix += w * topo.rest[node * 3]; iy += w * topo.rest[node * 3 + 1]; iz += w * topo.rest[node * 3 + 2];
        }
        rest.push({
          t, c0, d: [X[0] - ix, X[1] - iy, X[2] - iz], faceId,
          n0: [nx, ny, nz], uv: [S[i] / b, S[j] / b], X,
        });
        count++;
      }
      for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
        const i0 = base + j * m + i, i1 = i0 + 1, i2 = i0 + m, i3 = i2 + 1;
        // wind counter-clockwise seen from outside
        const A = rest[i0].X, B = rest[i1].X, C = rest[i3].X;
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nn = rest[i0].n0;
        if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] >= 0) idx.push(i0, i1, i3, i0, i3, i2);
        else idx.push(i0, i3, i1, i0, i2, i3);
      }
    }

    // GPU layout: four vec4 per vertex
    const buf = new ArrayBuffer(count * 64);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    rest.forEach((R, k) => {
      const o = k * 16;
      f[o] = R.t[0]; f[o + 1] = R.t[1]; f[o + 2] = R.t[2]; u[o + 3] = R.c0;
      f[o + 4] = R.d[0]; f[o + 5] = R.d[1]; f[o + 6] = R.d[2]; f[o + 7] = R.faceId;
      f[o + 8] = R.n0[0]; f[o + 9] = R.n0[1]; f[o + 10] = R.n0[2]; f[o + 11] = 0;
      f[o + 12] = R.uv[0]; f[o + 13] = R.uv[1]; f[o + 14] = 0; f[o + 15] = 0;
    });

    return { count, restData: buf, indices: new Uint32Array(idx), nodeInfo: nodeInfo(topo) };
  }

  /* Per node: the six lattice neighbours used for finite differences (central
     inside, one-sided on the boundary), and the inverse of the same
     differences taken on the rest lattice. Then F = [dI dJ dK] * M, and the
     difference scales cancel. */
  function nodeInfo(topo) {
    const n = topo.n, nn = topo.nn, X = topo.rest;
    const buf = new ArrayBuffer(nn * 80);
    const u = new Uint32Array(buf), f = new Float32Array(buf);
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const id = topo.id(i, j, k);
      const pair = (c, lim) => [Math.max(0, c - 1), Math.min(lim - 1, c + 1)];
      const [i0, i1] = pair(i, n), [j0, j1] = pair(j, n), [k0, k1] = pair(k, n);
      const nb = [topo.id(i0, j, k), topo.id(i1, j, k), topo.id(i, j0, k), topo.id(i, j1, k),
                  topo.id(i, j, k0), topo.id(i, j, k1)];
      const o = id * 20;
      for (let q = 0; q < 6; q++) u[o + q] = nb[q];
      u[o + 6] = 0; u[o + 7] = 0;
      const col = (a, b) => [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]];
      const J = [col(nb[0], nb[1]), col(nb[2], nb[3]), col(nb[4], nb[5])];   // columns
      const M = inv3cols(J);
      for (let c = 0; c < 3; c++) {
        f[o + 8 + c * 4] = M[c][0]; f[o + 9 + c * 4] = M[c][1]; f[o + 10 + c * 4] = M[c][2]; f[o + 11 + c * 4] = 0;
      }
    }
    return buf;
  }

  // inverse of a 3x3 given and returned as columns
  function inv3cols(c) {
    const a = c[0][0], b = c[1][0], cc = c[2][0];
    const d = c[0][1], e = c[1][1], ff = c[2][1];
    const g = c[0][2], h = c[1][2], i = c[2][2];
    const A = e * i - ff * h, B = -(d * i - ff * g), C = d * h - e * g;
    const det = a * A + b * B + cc * C;
    const id = 1 / det;
    // rows of the inverse
    const r0 = [A * id, -(b * i - cc * h) * id, (b * ff - cc * e) * id];
    const r1 = [B * id, (a * i - cc * g) * id, -(a * ff - cc * d) * id];
    const r2 = [C * id, -(a * h - b * g) * id, (a * e - b * d) * id];
    return [[r0[0], r1[0], r2[0]], [r0[1], r1[1], r2[1]], [r0[2], r1[2], r2[2]]];
  }

  // ------------------------------------------------------------------- board
  /* Points along the stadium at distance r from its centre line, with their
     outward normals: the straight far side, the right end, the near side, the
     left end. */
  function stadium(T, r, n) {
    const pts = [];
    if (T.L < 1e-6) {                       // no straight sides: a circle
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        pts.push([Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
      }
      return pts;
    }
    const ends = Math.round(n * 0.3), sides = Math.round(n * 0.2);
    for (let i = 0; i < sides; i++) pts.push([-T.L + 2 * T.L * i / sides, -r, 0, -1]);
    for (let i = 0; i < ends; i++) {
      const a = -Math.PI / 2 + Math.PI * i / ends;
      pts.push([T.L + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
    for (let i = 0; i < sides; i++) pts.push([T.L - 2 * T.L * i / sides, r, 0, 1]);
    for (let i = 0; i < ends; i++) {
      const a = Math.PI / 2 + Math.PI * i / ends;
      pts.push([-T.L + Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }

  /* Vertex: position, normal, uv, material. Material 0 is the floor -- one
     big quad; the shader prints the cloth inside the mat and 1.0's starry
     void outside it -- and 2 is the rim, a tube swept round the stadium. */
  function boardMesh(T) {
    const v = [], idx = [];
    const push = (p, nrm, mat) => { v.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], 0, 0, mat); return v.length / 9 - 1; };

    const F = 80;
    const a = push([-F, 0, -F], [0, 1, 0], 0), b = push([F, 0, -F], [0, 1, 0], 0);
    const c = push([F, 0, F], [0, 1, 0], 0), d = push([-F, 0, F], [0, 1, 0], 0);
    idx.push(a, d, b, b, d, c);

    const path = stadium(T, T.rimR, 200), tv = 20, n = path.length;
    const t0 = v.length / 9;
    for (let i = 0; i < n; i++) for (let j = 0; j < tv; j++) {
      const p = path[i], ang = j / tv * Math.PI * 2, cb = Math.cos(ang), sb = Math.sin(ang);
      const nx = p[2] * cb, nz = p[3] * cb;
      push([p[0] + nx * T.rimT, sb * T.rimT, p[1] + nz * T.rimT], [nx, sb, nz], 2);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < tv; j++) {
      const i1 = (i + 1) % n, j1 = (j + 1) % tv;
      const q0 = t0 + i * tv + j, q1 = t0 + i1 * tv + j, q2 = t0 + i * tv + j1, q3 = t0 + i1 * tv + j1;
      idx.push(q0, q1, q2, q1, q3, q2);
    }
    return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
  }

  CW.mesh = { diceMesh, boardMesh, stadium, axisSamples };
})(typeof window !== 'undefined' ? window : globalThis);
