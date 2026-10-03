/* Cosmic Wimpout 2.0 — WGSL. 1.0's look, in three dimensions.

   The table is drawn at 1.0's own logical resolution (216 rows) and then
   reduced to its four-colour palette, so a cube in 3D is the same few dozen
   pixels as a cube on 1.0's board, and the type and buttons drawn over it are
   on the same grid.

   The scene pass does not write colour. It writes a TONE (0 void .. 1 light,
   lit), which object a pixel belongs to, and how far away it is. The post
   pass then dithers tone to palette index, inks every cube's edge in 1.0's
   colours, and draws the held and locked rings 1.0 draws around a cube. */
(function (global) {
  'use strict';
  const CW = global.CW || (global.CW = {});

  /* ---------------------------------------------------------------- compute
     Positions in, surface out. Per node: the deformation gradient F from
     lattice finite differences. Per render vertex: trilinear position plus
     F times the rest offset, and the normal as cof(F) n0. */
  const compute = /* wgsl */`
struct NodeInfo { nb0: vec4u, nb1: vec4u, m0: vec4f, m1: vec4f, m2: vec4f };
struct Vtx { pos: vec4f, nrm: vec4f, tu: vec4f, tv: vec4f };
struct Rest { t: vec4f, d: vec4f, n0: vec4f, uv: vec4f };
@group(0) @binding(0) var<uniform> C: vec4u;   // nodes per die, verts per die, dice, n
@group(0) @binding(1) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(2) var<storage, read> info: array<NodeInfo>;
@group(0) @binding(3) var<storage, read_write> defo: array<mat3x3f>;
@group(0) @binding(4) var<storage, read> rest: array<Rest>;
@group(0) @binding(5) var<storage, read_write> verts: array<Vtx>;

@compute @workgroup_size(64)
fn nodeF(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= C.x * C.z) { return; }
  let die = i / C.x;
  let base = die * C.x;
  let nf = info[i - base];
  let dI = nodes[base + nf.nb0.y].xyz - nodes[base + nf.nb0.x].xyz;
  let dJ = nodes[base + nf.nb0.w].xyz - nodes[base + nf.nb0.z].xyz;
  let dK = nodes[base + nf.nb1.y].xyz - nodes[base + nf.nb1.x].xyz;
  defo[i] = mat3x3f(dI, dJ, dK) * mat3x3f(nf.m0.xyz, nf.m1.xyz, nf.m2.xyz);
}

fn axisVec(a: u32) -> vec3f {
  if (a == 0u) { return vec3f(1, 0, 0); }
  if (a == 1u) { return vec3f(0, 1, 0); }
  return vec3f(0, 0, 1);
}

@compute @workgroup_size(64)
fn skin(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= C.y * C.z) { return; }
  let die = i / C.y;
  let v = i - die * C.y;
  let r = rest[v];
  let base = die * C.x;
  let c0 = bitcast<u32>(r.t.w);
  let n = C.w;
  let t = r.t.xyz;
  var x = vec3f(0.0);
  var Fm = mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  for (var b = 0u; b < 8u; b++) {
    let bx = b & 1u; let by = (b >> 1u) & 1u; let bz = (b >> 2u) & 1u;
    let node = base + c0 + bx + n * (by + n * bz);
    let w = select(1.0 - t.x, t.x, bx == 1u) * select(1.0 - t.y, t.y, by == 1u) *
            select(1.0 - t.z, t.z, bz == 1u);
    x += w * nodes[node].xyz;
    Fm += defo[node] * w;
  }
  x += Fm * r.d.xyz;
  let a = Fm[0]; let bb = Fm[1]; let c = Fm[2];
  let nrm = cross(bb, c) * r.n0.x + cross(c, a) * r.n0.y + cross(a, bb) * r.n0.z;
  let axis = u32(r.d.w + 0.5) / 2u;
  let tu = Fm * axisVec((axis + 1u) % 3u);
  let tv = Fm * axisVec((axis + 2u) % 3u);
  verts[i] = Vtx(vec4f(x, 1.0), vec4f(normalize(nrm), 0.0), vec4f(tu, 0.0), vec4f(tv, 0.0));
}
`;

  const common = /* wgsl */`
struct Frame {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  eye: vec4f,        // xyz, w = time in seconds
  light: vec4f,      // xyz unit, toward the light; w = a face's flat half-width
  res: vec4f,        // w, h, 1/w, 1/h
  counts: vec4u,     // nodes per die, verts per die, dice, lattice n
  table: vec4f,      // stadium half-length L, mat reach, rim reach, rim tube
};
/* Per cube: x = 1 for the Sun Cube, y = 1 when dimmed, z = mark (0 none,
   1 held, 2 locked), w = 1 when visible. */
struct Die { info: vec4f, faces0: vec4f, faces1: vec4f, pad: vec4f };
struct Vtx { pos: vec4f, nrm: vec4f, tu: vec4f, tv: vec4f };
struct Rest { t: vec4f, d: vec4f, n0: vec4f, uv: vec4f };

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> verts: array<Vtx>;
@group(0) @binding(2) var<storage, read> dice: array<Die>;
@group(0) @binding(3) var<storage, read> rest: array<Rest>;
@group(0) @binding(4) var faceTex: texture_2d<f32>;
@group(0) @binding(5) var clothTex: texture_2d<f32>;
@group(0) @binding(6) var shadowMap: texture_depth_2d;

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}

// 1.0 for lit, 0.0 in a cube's shadow; one tap, hard, as pixel art wants it
fn lit(P: vec3f) -> f32 {
  let lp = F.lightViewProj * vec4f(P, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  let size = vec2f(textureDimensions(shadowMap));
  let d = textureLoad(shadowMap, vec2i(uv * size), 0);
  return select(1.0, 0.0, d < lp.z - 0.004);
}
`;

  const scene = common + /* wgsl */`
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) ids: vec2u,
};

fn diceVertex(vi: u32, ii: u32, m: mat4x4f) -> VOut {
  let v = verts[ii * F.counts.y + vi];
  let r = rest[vi];
  var o: VOut;
  o.clip = m * vec4f(v.pos.xyz, 1.0);
  o.wpos = v.pos.xyz;
  o.nrm = v.nrm.xyz;
  o.uv = r.uv.xy;
  o.ids = vec2u(u32(r.d.w + 0.5), ii);
  return o;
}
@vertex fn vs_dice(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  return diceVertex(vi, ii, F.viewProj);
}
@vertex fn vs_light(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  return diceVertex(vi, ii, F.lightViewProj);
}

fn faceValue(d: Die, face: u32) -> f32 {
  if (face < 4u) { return d.faces0[face]; }
  return d.faces1[face - 4u];
}
fn faceCell(val: f32) -> u32 {
  let v = i32(val + 0.5);
  switch v {
    case 2: { return 0u; }
    case 3: { return 1u; }
    case 4: { return 2u; }
    case 5: { return 3u; }
    case 6: { return 4u; }
    case 10: { return 5u; }
    default: { return 6u; }   // 1: the Sun
  }
}
/* Is this point of a face inked? A 1.0 cube is 32 pixels with a 24-pixel
   symbol in the middle, so the symbol spans the middle three quarters of the
   face. Negative faces are mirrored, so a numeral never reads backwards. */
fn inked(uv: vec2f, val: f32, face: u32) -> f32 {
  let sx = select(1.0, -1.0, (face & 1u) == 1u);
  let w = vec2f(uv.x * sx, -uv.y) * F.light.w;          // world offset on the face
  let p = vec2i(floor((w + 0.5) * 32.0)) - vec2i(4);
  if (any(p < vec2i(0)) || any(p > vec2i(23))) { return 0.0; }
  let i = faceCell(val);
  let t = vec2i(i32(i % 4u) * 24, i32(i / 4u) * 24) + p;
  return textureLoad(faceTex, t, 0).x;
}

struct SceneOut { @location(0) v: vec4f };
fn out(tone: f32, id: f32, P: vec3f) -> SceneOut {
  var o: SceneOut;
  o.v = vec4f(tone, id, length(P - F.eye.xyz), 1.0);
  return o;
}

/* The cubes: 1.0's common cube is light with void symbols, the Sun Cube void
   with light ones. Lit from above and in front, in flat bands -- a top, a
   lit side, a shaded side -- each one palette colour, so a cube reads as a
   drawn cube rather than a dithered blur. Dimmed cubes take 1.0's dim
   colours: body a step down, ink to the deep tone. */
fn band(lam: f32) -> i32 { return select(select(2, 1, lam > 0.32), 0, lam > 0.7); }
@fragment fn fs_dice(in: VOut) -> SceneOut {
  let d = dice[in.ids.y];
  let N = normalize(in.nrm);
  let b = band(dot(N, F.light.xyz));
  let sun = d.info.x > 0.5;
  let dim = d.info.y > 0.5;
  // palette index per band, lit to shaded
  var body = vec3f(3.0, 2.0, 1.0);
  var ink = 0.0;
  if (sun) { body = vec3f(1.0, 0.0, 0.0); ink = 3.0; }
  if (dim) {
    body = select(vec3f(2.0, 1.0, 1.0), vec3f(0.0), sun);
    ink = 1.0;
  }
  let k = inked(in.uv, faceValue(d, in.ids.x), in.ids.x);
  let idx = mix(body[b], ink, step(0.5, k));
  return out(idx / 3.0, f32(in.ids.y + 1u), in.wpos);
}

// --------------------------------------------------------------- the table
struct BIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) uv: vec2f, @location(3) mat: f32 };
struct BOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) @interpolate(flat) mat: u32,
};
@vertex fn vs_board(i: BIn) -> BOut {
  var o: BOut;
  o.clip = F.viewProj * vec4f(i.pos, 1.0);
  o.wpos = i.pos; o.nrm = i.nrm; o.mat = u32(i.mat + 0.5);
  return o;
}

/* The floor is 1.0's void, with its field of single-pixel twinkling stars;
   on the mat it is the cloth, read texel for texel. The rim is a hoop in two
   flat tones. A cube's shadow takes a step off whatever it falls on --
   invisible on the void, a dither on the cloth's printing. */
fn stadium(p: vec2f, r: f32) -> f32 {
  return length(vec2f(max(abs(p.x) - F.table.x, 0.0), p.y)) - r;
}
@fragment fn fs_board(in: BOut) -> SceneOut {
  let P = in.wpos;
  var tone = 0.0;
  if (in.mat == 2u) {
    tone = select(1.0, 2.0, dot(normalize(in.nrm), F.light.xyz) > 0.62) / 3.0;
  } else if (stadium(P.xz, F.table.y) < 0.0) {
    let size = vec2f(textureDimensions(clothTex));
    let ext = vec2f(F.table.x + F.table.y, F.table.y);
    let uv = P.xz / (2.0 * ext) + 0.5;
    tone = textureLoad(clothTex, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * size), 0).x;
  } else {
    // 1.0's starfield: single screen pixels, each twinkling on its own clock
    let h = hash2(floor(in.clip.xy) + 0.5);
    if (h > 0.9965) {
      let tw = sin(F.eye.w * (0.6 + fract(h * 97.0) * 1.6) + h * 400.0);
      tone = select(0.0, select(1.0 / 3.0, 2.0 / 3.0, tw > 0.9), tw > 0.55);
    }
  }
  if (in.mat != 2u) { tone *= mix(0.62, 1.0, lit(P + vec3f(0.0, 0.01, 0.0))); }
  return out(tone, select(0.0, 7.0, in.mat == 2u), P);
}
`;

  /* ------------------------------------------------------------------- post
     Tone to palette, cube edges, and 1.0's selection rings. */
  const post = /* wgsl */`
struct Post {
  pal: array<vec4f, 4>,    // the live palette, as sRGB-encoded values
  info: array<vec4f, 5>,   // per cube: x sun, y dim, z mark, w visible
};
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: Post;

struct FOut { @builtin(position) clip: vec4f };
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> FOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: FOut;
  o.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// 4x4 ordered dither
fn bayer(p: vec2i) -> f32 {
  let m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0;
}

fn at(p: vec2i) -> vec4f {
  let dim = vec2i(textureDimensions(src));
  return textureLoad(src, clamp(p, vec2i(0), dim - 1), 0);
}

@fragment fn fs_post(in: FOut) -> @location(0) vec4f {
  let p = vec2i(in.clip.xy);
  let c = at(p);
  // exact palette tones stay flat; anything between two dithers between them
  let x = clamp(c.x, 0.0, 1.0) * 3.0;
  let base = floor(x + 1e-4);
  var level = i32(base) + select(0, 1, x - base > bayer(p) && base < 3.0);
  let id = i32(c.y + 0.5);

  if (id >= 1 && id <= 5) {
    // a cube's edge: 1.0 inks the common cube's in void and lights the Sun's
    var edge = false;
    for (var k = 0; k < 4; k++) {
      let o = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1))[k];
      let n = at(p + o);
      if (i32(n.y + 0.5) != id && n.z > c.z - 0.3) { edge = true; }
    }
    if (edge) {
      let inf = P.info[id - 1];
      level = select(0, select(2, 1, inf.y > 0.5), inf.x > 0.5);
    }
  } else {
    /* The rings 1.0 draws four pixels outside a cube: solid in the lightest
       colour when held, dotted in mid when locked into a flash. Found by the
       nearest pixel of each marked cube, three steps away. */
    var best = 9;
    var mark = 0.0;
    for (var dy = -3; dy <= 3; dy++) {
      for (var dx = -3; dx <= 3; dx++) {
        let n = i32(at(p + vec2i(dx, dy)).y + 0.5);
        if (n >= 1 && n <= 5) {
          let m = P.info[n - 1].z;
          let dd = max(abs(dx), abs(dy));
          if (m > 0.5 && dd < best) { best = dd; mark = m; }
          if (m < 0.5 && dd < best) { best = dd; mark = 0.0; }
        }
      }
    }
    if (best == 3 && mark > 1.5 && ((p.x + p.y) % 3) == 0) { level = 2; }
    if (best == 3 && mark > 0.5 && mark < 1.5) { level = 3; }
  }
  return P.pal[clamp(level, 0, 3)];
}
`;

  CW.shaders = { compute, scene, post };
})(window);
