// Brain geometry and node layout in 3D: x back→front, y down→up, z the right (+) and left (−) hemispheres.
// Built from four traced views (shape.js): the side view's region map gives each column's top and bottom; the top
// view gives the width along the length; the coronal section gives the cross-section's shape, scaled into every
// column; the cerebellum's front view gives its two lobes. So the cerebrum's outline matches the side, top and front
// views at once: a dome with the temporal lobes as the lower part of each side, split by a thin fissure into
// hemispheres with flat inner faces. The cerebellum sits under the occipital lobes, the brainstem is a round tube.
// Lobes are the side map's regions through the whole depth, mirrored on both hemispheres, so a lobe's nodes fill its
// territory; each lobe's volume is shared among its regions in proportion to their node counts, and a short force
// simulation evens the nodes out inside it.
import { rng } from './data.js';
import { SHAPE, SHAPE_PD, CORONAL, TOP, CEREBELLUM } from './shape.js';

// Proportions of a real brain: length 1 : width 0.83 : cerebrum height 0.62 (here the length is 2).
const HALF_WIDTH = 0.83; // the widest half-width (the top view's widest point)
const GAP = 0.02; // half the fissure between the hemispheres: about 2.5% of the width
const CBL_HALF = 0.5, CBL_LIFT = 0.15; // the cerebellum's half-width; how far its top reaches up under the occipital lobes
const STEM_R = 0.075;

// The region map, decoded: one code per cell, 0 outside.
// The side map: ?side=pd shows the one traced from public-domain plates, for comparison.
const SIDE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('side') === 'pd' ? SHAPE_PD : SHAPE;
const G = SIDE.size, CODES = '.PFAOTCS';
const T_ = 5, C_ = 6, S_ = 7;
const LOBE_OF = [null, 'prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'];
const cls = new Uint8Array(G * G);
SIDE.rows.forEach((row, gy) => {
  let gx = 0;
  for (const m of row.matchAll(/(\d+)(.)/g)) { cls.fill(CODES.indexOf(m[2]), gy * G + gx, gy * G + gx + Number(m[1])); gx += Number(m[1]); }
});
const isCer = (c) => c >= 1 && c <= T_;
// Grid ↔ world: the cerebrum is 2 long, centered on x = 0, its top at y = 0.7; the map's front (left) is +x.
let gx0 = G, gx1 = 0, gyTop = G;
for (let i = 0; i < G * G; i++) if (isCer(cls[i])) { const x = i % G, y = (i / G) | 0; gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gyTop = Math.min(gyTop, y); }
const CELL = 2 / (gx1 - gx0 + 1), UMID = (gx0 + gx1 + 1) / 2, TOP_Y = 0.7;
const toU = (x) => UMID - x / CELL, toV = (y) => gyTop + (TOP_Y - y) / CELL;
const cellX = (gx) => (UMID - gx - 0.5) * CELL, cellY = (gy) => TOP_Y - (gy + 0.5 - gyTop) * CELL;
const cellAt = (x, y) => { const u = Math.floor(toU(x)), v = Math.floor(toV(y)); return u < 0 || v < 0 || u >= G || v >= G ? 0 : cls[v * G + u]; };

// Each part's column in the side view: its bottom and top at every x, interpolated between cell centers.
function columns(test, lift = 0) {
  const b = new Float32Array(G).fill(NaN), t = new Float32Array(G).fill(NaN);
  for (let gx = 0; gx < G; gx++) for (let gy = 0; gy < G; gy++) if (test(cls[gy * G + gx])) {
    const top = cellY(gy) + CELL / 2, bot = cellY(gy) - CELL / 2;
    if (Number.isNaN(t[gx]) || top > t[gx]) t[gx] = top + lift;
    if (Number.isNaN(b[gx]) || bot < b[gx]) b[gx] = bot;
  }
  let x0 = 9, x1 = -9;
  for (let gx = 0; gx < G; gx++) if (!Number.isNaN(b[gx])) { x0 = Math.min(x0, cellX(gx) - CELL / 2); x1 = Math.max(x1, cellX(gx) + CELL / 2); }
  const at = (x) => {
    const u = toU(x) - 0.5, i = Math.floor(u), w = u - i;
    const pick = (a) => { const p = a[Math.max(0, Math.min(G - 1, i))], q = a[Math.max(0, Math.min(G - 1, i + 1))]; return Number.isNaN(p) ? q : Number.isNaN(q) ? p : p * (1 - w) + q * w; };
    if (x < x0 || x > x1) return null;
    const bb = pick(b), tt = pick(t);
    return Number.isNaN(bb) || Number.isNaN(tt) || tt <= bb ? null : [bb, tt];
  };
  return { at, x0, x1 };
}
const colCer = columns(isCer), colCbl = columns((c) => c === C_, CBL_LIFT);

// A traced profile as a function: lookup with linear interpolation, and a rounded cap where its top and bottom have
// not met at an end, so every surface closes smoothly (no flat wall, no bright rim).
function profile(top, bottom, { both = false, aspect = 1.4 } = {}) {
  const n = top.length, pts = []; // [position, bottom, top], position 0..1 (or -1..1 when both ends cap)
  const cap = (k, dir) => { // a quarter-circle cap beyond sample k, outward in direction dir
    const c = (top[k] + bottom[k]) / 2, h = Math.max(0, (top[k] - bottom[k]) / 2), out = [];
    for (let j = 1; j <= 8; j++) { const a = (j / 8) * (Math.PI / 2); out.push([dir * Math.sin(a) * h / aspect, c - h * Math.cos(a), c + h * Math.cos(a)]); }
    return out;
  };
  const span = both ? 2 : 1, start = both ? -1 : 0;
  for (let i = 0; i < n; i++) pts.push([start + (i / (n - 1)) * span, bottom[i], top[i]]);
  const end = cap(n - 1, 1).map(([d, b, t]) => [start + span + d * span, b, t]);
  const head = both ? cap(0, -1).map(([d, b, t]) => [start + d * span, b, t]).reverse() : [];
  const all = [...head, ...pts, ...end];
  const lo = all[0][0], hi = all[all.length - 1][0];
  const P = all.map(([p, b, t]) => [start + ((p - lo) / (hi - lo)) * span, b, t]); // the caps fit inside the range
  return (pos) => {
    if (pos < P[0][0] || pos > P[P.length - 1][0]) return null;
    let k = 1;
    while (k < P.length - 1 && P[k][0] < pos) k++;
    const [p0, b0, t0] = P[k - 1], [p1, b1, t1] = P[k], w = p1 > p0 ? (pos - p0) / (p1 - p0) : 0;
    return [b0 + (b1 - b0) * w, t0 + (t1 - t0) * w];
  };
}
const coronal = profile(CORONAL.top, CORONAL.bottom);
const cerebellumProfile = profile(CEREBELLUM.top, CEREBELLUM.bottom, { both: true, aspect: 2 });
const widthAt = (u) => { const f = Math.max(0, Math.min(1, u)) * (TOP.length - 1), i = Math.floor(f), w = f - i; return TOP[i] * (1 - w) + (TOP[Math.min(TOP.length - 1, i + 1)] ?? TOP[i]) * w; };
const cerW = (x) => HALF_WIDTH * widthAt((x - colCer.x0) / (colCer.x1 - colCer.x0)); // the top view: back (0) to front (1)
const cblW = (x) => { const c = (colCbl.x0 + colCbl.x1) / 2, h = (colCbl.x1 - colCbl.x0) / 2, q = 1 - ((x - c) / h) ** 2; return q > 0 ? CBL_HALF * q ** 0.35 : 0; };

// The surfaces' height at a point of the cross-section: [bottom y, top y] (null outside).
function cerSpan(x, z) {
  const col = colCer.at(x);
  if (!col) return null;
  const pr = coronal(Math.abs(z) / cerW(x));
  return pr && pr[1] > pr[0] ? [col[0] + pr[0] * (col[1] - col[0]), col[0] + pr[1] * (col[1] - col[0])] : null;
}
function cblSpan(x, z) {
  const col = colCbl.at(x), w = cblW(x);
  if (!col || !w) return null;
  const pr = cerebellumProfile(z / w);
  return pr && pr[1] > pr[0] ? [col[0] + pr[0] * (col[1] - col[0]), col[0] + pr[1] * (col[1] - col[0])] : null;
}
const within = (s, y, m = 0) => !!s && y > s[0] + m && y < s[1] - m;
const inCerebrum = (p, m = 0) => within(cerSpan(p[0], p[2]), p[1], m);
const inCerebellum = (p, m = 0) => within(cblSpan(p[0], p[2]), p[1], m);

// The brainstem: a round tube around the side map's stem, from its distance to the stem's outline.
function distance(inside) { // per cell: distance (world units) to the nearest cell where inside() is false
  const d = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) d[i] = inside(i) ? 1e9 : 0;
  const R2 = Math.SQRT2;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const i = y * G + x;
    if (!d[i]) continue;
    if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
    if (y) { d[i] = Math.min(d[i], d[i - G] + 1); if (x) d[i] = Math.min(d[i], d[i - G - 1] + R2); if (x < G - 1) d[i] = Math.min(d[i], d[i - G + 1] + R2); }
  }
  for (let y = G - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) {
    const i = y * G + x;
    if (!d[i]) continue;
    if (x < G - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
    if (y < G - 1) { d[i] = Math.min(d[i], d[i + G] + 1); if (x < G - 1) d[i] = Math.min(d[i], d[i + G + 1] + R2); if (x) d[i] = Math.min(d[i], d[i + G - 1] + R2); }
  }
  for (let i = 0; i < G * G; i++) d[i] = Math.min(d[i], 99) * CELL;
  return d;
}
function signed(inside) {
  const a = distance(inside), b = distance((i) => !inside(i)), s = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) s[i] = a[i] > 0 ? a[i] - CELL / 2 : -(b[i] - CELL / 2);
  return s;
}
function sample(f, x, y, outside = 0) { // bilinear, at a world (x, y)
  const u = toU(x) - 0.5, v = toV(y) - 0.5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  const at = (p, q) => (p < 0 || q < 0 || p >= G || q >= G ? outside : f[q * G + p]);
  return (at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - b) + (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * b;
}
const sdStem = signed((i) => cls[i] === S_);
const R = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : Math.sqrt(1 - (1 - t) ** 2));
const zStem = (x, y) => STEM_R * 1.3 * R(sample(sdStem, x, y, -1) / STEM_R);
// The main fissures on the surface: the Sylvian (temporal lobe against the frontal and parietal lobes above it) and the
// central sulcus (frontal against parietal), as distances in the side view.
const nearTo = (from, to) => { const d = distance((i) => !to(cls[i])); return d.map((v, i) => (from(cls[i]) ? v : 99)); };
const upper = (c) => c >= 1 && c <= 3;
const dSylv = (() => { const a = nearTo((c) => c === T_, upper), b = nearTo(upper, (c) => c === T_); return a.map((v, i) => Math.min(v, b[i])); })();
const dCent = (() => { const a = nearTo((c) => c === 2, (c) => c === 3), b = nearTo((c) => c === 3, (c) => c === 2); return a.map((v, i) => Math.min(v, b[i])); })();

// Which lobe and hemisphere a point is in, as [lobe, side] (side 0 for the midline brainstem), or null outside the
// volumes nodes use (a little inside the shell, off the fissure).
function classify(p) {
  const c = cellAt(p[0], p[1]), z = Math.abs(p[2]), side = p[2] > 0 ? 1 : -1;
  if (c === S_) return z < 0.85 * zStem(p[0], p[1]) && sample(sdStem, p[0], p[1], -1) > 0 ? ['stem', 0] : null;
  if (inCerebrum(p)) {
    if (z < GAP * 2 || !isCer(c) || !inCerebrum(p, 0.04) || Math.abs(p[2]) > 0.94 * cerW(p[0])) return null;
    return [LOBE_OF[c], side];
  }
  return z > 0.01 && inCerebellum(p, 0.03) ? ['cerebellum', side] : null;
}
export const lobeAt = classify;

// A fixed pool of points spread through each lobe's volume: shares out the volume among regions and gives each lobe
// its center, extent and volume.
const LOBE_NAMES = ['prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'];
const BOX = [[-1.05, 1.05], [-1.05, 0.75], [-0.9, 0.9]];
const POOL_N = 60000;
const pool = new Map(), VOL = {};
{
  const r = rng(17), tmp = new Map();
  for (let k = 0; k < POOL_N; k++) {
    const p = BOX.map(([a, b]) => Math.fround(a + r() * (b - a))), c = classify(p); // as stored
    if (!c) continue;
    const key = c.join('|');
    if (!tmp.has(key)) tmp.set(key, []);
    tmp.get(key).push(p[0], p[1], p[2]);
  }
  for (const [k, v] of tmp) {
    VOL[k] = v.length / 3;
    // Small lobes (the brainstem) get extra points from their own box, so even a crowded one has a place per node.
    const lo = [9, 9, 9], hi = [-9, -9, -9];
    for (let i = 0; i < v.length; i++) { lo[i % 3] = Math.min(lo[i % 3], v[i]); hi[i % 3] = Math.max(hi[i % 3], v[i]); }
    for (let t = 0; v.length < 1800 && t < 200000; t++) {
      const p = [0, 1, 2].map((a) => Math.fround(lo[a] - 0.03 + r() * (hi[a] - lo[a] + 0.06))), c = classify(p);
      if (c && c.join('|') === k) v.push(p[0], p[1], p[2]);
    }
    pool.set(k, Float32Array.from(v));
  }
}
const sidesOf = (lobe) => (lobe === 'stem' ? [0] : [1, -1]);
const BOX_VOL = BOX.reduce((v, [a, b]) => v * (b - a), 1);
export const LOBES = Object.fromEntries(LOBE_NAMES.map((l) => [l, {
  midline: l === 'stem',
  vol: sidesOf(l).reduce((t, s) => t + (VOL[`${l}|${s}`] || 0), 0) / POOL_N * BOX_VOL,
}]));
// A lobe's volume on one side (side 0 for the midline stem), as center and extent (an ellipsoid of the same spread).
const shapes = new Map();
export const lobeShape = (lobe, side) => {
  const key = `${lobe}|${LOBES[lobe].midline ? 0 : side}`;
  if (!shapes.has(key)) {
    const pts = pool.get(key), n = pts.length / 3, c = [0, 0, 0], v = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) { c[i % 3] += pts[i]; v[i % 3] += pts[i] * pts[i]; }
    for (let a = 0; a < 3; a++) { c[a] /= n; v[a] = Math.sqrt(Math.max(1e-6, 5 * (v[a] / n - c[a] * c[a]))); }
    shapes.set(key, { c, r: v });
  }
  return shapes.get(key);
};
const STEM_BOTTOM = (() => { let b = 0; for (let i = 0; i < G * G; i++) if (cls[i] === S_) b = Math.max(b, (i / G) | 0); return cellY(b); })();
export const BRAIN_CENTER = [0, (TOP_Y + STEM_BOTTOM) / 2, 0];
export const BRAIN_RADIUS = Math.hypot(1.05, (TOP_Y - STEM_BOTTOM) / 2); // bounding sphere, for framing and depth fog

// Positions for every node (Float32Array x,y,z, world), plus per region: side, centroid, spread, count.
// Only nodes with visible[i] (default: all) are laid out, so "Re-layout" can respread what the filters show.
export function layout(graph, { seed = 3, iterations = 40, visible = null } = {}) {
  const r = rng(seed);
  const { nodes, edges, regions, projects } = graph;
  const n = nodes.length;
  const on = (i) => !visible || visible[i];
  const pos = new Float32Array(n * 3);
  const projOrder = new Map(projects.map((p, i) => [p.id, i]));
  const count = new Int32Array(regions.length);
  for (let i = 0; i < n; i++) if (on(i)) count[nodes[i].region]++;

  // 1. Hemispheres: in each lobe, regions go to the side with less load, preferring their project's home side,
  // so projects keep a side when they can and a single project still fills both hemispheres.
  const side = new Int8Array(regions.length);
  for (const lobe of LOBE_NAMES) {
    const rs = regions.filter((g) => g.lobe === lobe && count[g.id]).sort((a, b) => count[b.id] - count[a.id]);
    const load = { 1: 0, [-1]: 0 };
    for (const g of rs) {
      if (LOBES[lobe].midline) { side[g.id] = 0; continue; }
      const home = (projOrder.get(g.project) ?? 0) % 2 ? -1 : 1;
      const s = load[home] <= load[-home] + count[g.id] * 0.5 ? home : -home;
      side[g.id] = s;
      load[s] += count[g.id];
    }
  }

  // 2. Each lobe's volume is shared among its regions by splitting its pool of points in two along the longest axis,
  // in proportion to their node counts, again and again: every region gets a compact block, and together they fill
  // the lobe.
  const block = new Map();
  for (const lobe of LOBE_NAMES) for (const s of sidesOf(lobe)) {
    const rs = regions.filter((g) => g.lobe === lobe && count[g.id] && side[g.id] === s).sort((a, b) => count[b.id] - count[a.id]);
    const pts = pool.get(`${lobe}|${s}`);
    if (!rs.length || !pts) continue;
    const split = (ix, list) => {
      if (list.length === 1 || ix.length < 2) { for (const g of list) block.set(g.id, { pts, ix }); return; }
      const total = list.reduce((t, g) => t + count[g.id], 0);
      let k = 0, acc = 0;
      while (k < list.length - 1 && acc + count[list[k].id] <= total / 2) acc += count[list[k++].id];
      if (!k) acc = count[list[k++].id];
      let ax = 0, best = -1;
      for (let a = 0; a < 3; a++) {
        let lo = 9, hi = -9;
        for (const i of ix) { const v = pts[i * 3 + a]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; ax = a; }
      }
      ix.sort((i, j) => pts[i * 3 + ax] - pts[j * 3 + ax]);
      const cut = Math.max(1, Math.min(ix.length - 1, Math.round((ix.length * acc) / total)));
      split(ix.slice(0, cut), list.slice(0, k));
      split(ix.slice(cut), list.slice(k));
    };
    split(Array.from({ length: pts.length / 3 }, (_, i) => i), rs);
  }

  // 3. Nodes start on points of their region's block (brain frame).
  const taken = new Map();
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue;
    const g = nodes[i].region, b = block.get(g);
    let t = taken.get(g);
    if (!t) { t = { ix: [...b.ix], k: 0 }; for (let j = t.ix.length - 1; j > 0; j--) { const m = Math.floor(r() * (j + 1)); [t.ix[j], t.ix[m]] = [t.ix[m], t.ix[j]]; } taken.set(g, t); }
    const p = t.ix[t.k++ % t.ix.length], q = [0, 1, 2].map((a) => b.pts[p * 3 + a]);
    const jit = q.map((v) => v + (r() - 0.5) * 0.02); // a point used twice moves a little, staying in its lobe
    pos.set(t.k > t.ix.length && classify(jit)?.join('|') === classify(q).join('|') ? jit : q, i * 3);
  }

  // 4. Forces even the nodes out; a node never leaves its lobe (a step that would is undone). ponytail: uniform grid
  // (counting sort into a fixed box) for repulsion, O(n) per pass; fine to ~20k nodes, Barnes-Hut beyond that.
  const vel = new Float32Array(n * 3);
  const cell = 0.06;
  const idx = [];
  for (let i = 0; i < n; i++) if (on(i)) idx.push(i);
  const home = idx.map((i) => { const g = nodes[i].region; return `${regions[g].lobe}|${side[g]}`; });
  const live = edges.filter((e) => on(e.a) && on(e.b) && e.a !== e.b);
  // The MEMORY.md index is a hub: as a spring it would knot every note around it.
  const intra = live.filter((e) => e.type !== 'index' && nodes[e.a].region === nodes[e.b].region);
  const GX = Math.ceil(2.2 / cell), GY = Math.ceil(1.7 / cell), GZ = Math.ceil(1.8 / cell);
  const cellOf = (i) => {
    const x = Math.min(GX - 1, Math.max(0, Math.floor((pos[i * 3] + 1.1) / cell)));
    const y = Math.min(GY - 1, Math.max(0, Math.floor((pos[i * 3 + 1] + 0.9) / cell)));
    const z = Math.min(GZ - 1, Math.max(0, Math.floor((pos[i * 3 + 2] + 0.9) / cell)));
    return (x * GY + y) * GZ + z;
  };
  const start = new Int32Array(GX * GY * GZ + 1);
  const order = new Int32Array(idx.length);
  const cellIdx = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    start.fill(0);
    for (const i of idx) { cellIdx[i] = cellOf(i); start[cellIdx[i] + 1]++; }
    for (let c = 0; c < GX * GY * GZ; c++) start[c + 1] += start[c];
    const fill = start.slice(0, -1);
    for (const i of idx) order[fill[cellIdx[i]]++] = i;
    for (const i of idx) {
      const c = cellIdx[i], cz = c % GZ, cy = ((c / GZ) | 0) % GY, cx = (c / (GY * GZ)) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const x0 = cx + dx, y0 = cy + dy, z0 = cz + dz;
        if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= GX || y0 >= GY || z0 >= GZ) continue;
        const o = (x0 * GY + y0) * GZ + z0;
        for (let k = start[o]; k < start[o + 1]; k++) {
          const j = order[k];
          if (j <= i) continue;
          const x = pos[j * 3] - pos[i * 3], y = pos[j * 3 + 1] - pos[i * 3 + 1], z = pos[j * 3 + 2] - pos[i * 3 + 2];
          const d = Math.hypot(x, y, z) || 1e-5;
          if (d >= cell) continue;
          const f = ((cell - d) / d) * 0.15;
          vel[i * 3] -= x * f; vel[i * 3 + 1] -= y * f; vel[i * 3 + 2] -= z * f;
          vel[j * 3] += x * f; vel[j * 3 + 1] += y * f; vel[j * 3 + 2] += z * f;
        }
      }
    }
    for (const e of intra) { // linked notes and files lean together, without knotting
      const a = e.a * 3, b = e.b * 3;
      const x = pos[b] - pos[a], y = pos[b + 1] - pos[a + 1], z = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(x, y, z) || 1e-5, f = ((d - 0.08) / d) * 0.003;
      vel[a] += x * f; vel[a + 1] += y * f; vel[a + 2] += z * f;
      vel[b] -= x * f; vel[b + 1] -= y * f; vel[b + 2] -= z * f;
    }
    idx.forEach((i, k) => {
      const j = i * 3, old = [pos[j], pos[j + 1], pos[j + 2]];
      for (let a = 0; a < 3; a++) { pos[j + a] += vel[j + a] * cool; vel[j + a] *= 0.5; }
      const c = classify([pos[j], pos[j + 1], pos[j + 2]]);
      if (!c || c.join('|') !== home[k]) for (let a = 0; a < 3; a++) { pos[j + a] = old[a]; vel[j + a] = 0; }
    });
  }
  // A node that float rounding puts across its lobe's edge steps toward its block's middle.
  idx.forEach((i, k) => {
    const b = block.get(nodes[i].region), mid = [0, 0, 0];
    let p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    for (let t = 0; t < 12; t++) {
      pos.set(p, i * 3);
      if (lobeAt([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])?.join('|') === home[k]) return;
      if (!t) { for (const j of b.ix) for (let a = 0; a < 3; a++) mid[a] += b.pts[j * 3 + a] / b.ix.length; }
      p = p.map((v, a) => v + (mid[a] - v) * 0.1);
    }
  });

  // 5. Region centroids and spread, for labels, haze and fiber bundles.
  const centroid = regions.map(() => [0, 0, 0]);
  for (const i of idx) for (let a = 0; a < 3; a++) centroid[nodes[i].region][a] += pos[i * 3 + a];
  for (const g of regions) {
    const fallback = lobeShape(g.lobe, side[g.id] || 1).c;
    for (let a = 0; a < 3; a++) centroid[g.id][a] = count[g.id] ? centroid[g.id][a] / count[g.id] : fallback[a];
  }
  const spread = regions.map(() => 0);
  for (const i of idx) { const c = centroid[nodes[i].region]; spread[nodes[i].region] += Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]); }
  for (const g of regions) spread[g.id] = count[g.id] ? spread[g.id] / count[g.id] : 0;
  return { pos, side, centroid, spread, count };
}

// ---- the decorative particle shell (never interactive, never counted) ----------------------------------------
// Gyri: winding bands along the level sets of a smooth, warped field, with thin dark grooves (sulci) between them.
const gyri = (x, y, z) =>
  Math.sin(7.1 * x + 2.3 * Math.sin(5.3 * y + 1.7 * z) + 1.1 * Math.sin(4.1 * z - 2.2 * x)) +
  Math.sin(4.4 * y + 3.1 * z - 1.9 * Math.sin(4.7 * x + 2.9 * z) + 1.3 * Math.sin(3.7 * x + 1.1 * y)) +
  0.9 * Math.sin(5.7 * z - 3.3 * y + 2.1 * Math.sin(6.1 * x - 1.3 * y));
export const GYRI = { bands: 1.05, ridge: 0.5 }; // bands per unit of the field; the share of each band that is ridge
const PARTS = ['cerebrum', 'cerebellum', 'stem'];

// The shell: { pos, nrm (Float32Array, x y z per point), part (0 cerebrum, 1 cerebellum, 2 brainstem), ranges }.
// Points are grouped by lobe and hemisphere (ranges: "lobe|side" → [start, count]) so a lobe's patch can be drawn on
// its own, and shuffled inside each group, so any prefix of a group is an even sample of it.
export function shellPoints(count = 26000, seed = 9) {
  const r = rng(seed), groups = new Map();
  const add = (key, p, n, part) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push([p, n, part]); };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
  // A part whose surfaces are the top and bottom of its cross-section over (x, z): sampled evenly by area.
  const surfaces = (want, span, x0, x1, zMax, part, keep) => {
    const CAP = 4, e = 0.006;
    for (let k = 0, tries = 0; k < want && tries < want * 80; tries++) {
      const x = x0 + r() * (x1 - x0), z = (r() * 2 - 1) * zMax, s = span(x, z);
      if (!s) continue;
      const top = r() < 0.5, y = s[top ? 1 : 0];
      const fy = (xx, zz) => { const q = span(xx, zz); return q ? q[top ? 1 : 0] : null; };
      const ax = fy(x + e, z), bx = fy(x - e, z), az = fy(x, z + e), bz = fy(x, z - e);
      if (ax == null || bx == null || az == null || bz == null) continue; // the very rim
      const gx = (ax - bx) / (2 * e), gz = (az - bz) / (2 * e), slope = Math.hypot(1, gx, gz);
      if (r() * CAP > Math.min(CAP, slope)) continue; // even over the surface, steep sides included
      const n = norm(top ? [-gx, 1, -gz] : [gx, -1, gz]), p = [x, y, z];
      const key = keep(p, top);
      if (key) { add(key, p, n, part); k++; }
    }
  };
  // The cerebrum: gyri on every lobe; the Sylvian fissure, the central sulcus and the midline fissure are the
  // clearest grooves.
  surfaces(count * 0.8, cerSpan, colCer.x0, colCer.x1, HALF_WIDTH, 0, (p, top) => {
    const c = cellAt(p[0], p[1]), zn = Math.abs(p[2]) / cerW(p[0]);
    if (top && Math.abs(p[2]) < GAP) return null; // the longitudinal fissure
    if (inCerebellum(p)) return null; // the cerebellum's surface shows there instead
    const syl = sample(dSylv, p[0], p[1], 99), cen = sample(dCent, p[0], p[1], 99);
    if (zn > 0.55 && syl < 0.03) return null; // the Sylvian fissure, the clearest groove on the side
    if (cen < 0.02) return null; // the central sulcus
    const u = gyri(...p) * GYRI.bands, q = Math.abs(u - Math.round(u)) * 2;
    if (q > GYRI.ridge || r() > 1 - (q / GYRI.ridge) * 0.8) return null; // dense along each ridge, empty in the grooves
    return `${isCer(c) ? LOBE_OF[c] : 'parietal'}|${p[2] > 0 ? 1 : -1}`;
  });
  // The cerebellum: fine curved folia; only the part under the cerebrum shows.
  surfaces(count * 0.14, cblSpan, colCbl.x0, colCbl.x1, CBL_HALF, 1, (p) => {
    if (inCerebrum(p)) return null;
    if (Math.abs(Math.sin(62 * (p[1] + 0.25 * (p[0] + 0.6) ** 2))) < 0.42) return null;
    return `cerebellum|${p[2] > 0 ? 1 : -1}`;
  });
  // The brainstem: a round tube, ±half-width over the side map, its normal from the half-width's slope.
  let sx0 = 9, sx1 = -9, sy0 = 9, sy1 = -9;
  for (let i = 0; i < G * G; i++) if (cls[i] === S_) { const x = cellX(i % G), y = cellY((i / G) | 0); sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y); }
  for (let k = 0, tries = 0, want = count * 0.06; k < want && tries < want * 60; tries++) {
    const x = sx0 + r() * (sx1 - sx0), y = sy0 + r() * (sy1 - sy0);
    if (sample(sdStem, x, y, -1) <= 0) continue;
    const z = zStem(x, y), e = 0.006, gx = (zStem(x + e, y) - zStem(x - e, y)) / (2 * e), gy = (zStem(x, y + e) - zStem(x, y - e)) / (2 * e);
    if (r() * 3 > Math.min(3, Math.hypot(1, gx, gy))) continue;
    const s = r() < 0.5 ? 1 : -1, p = [x, y, s * z];
    if (inCerebrum(p) || inCerebellum(p)) continue;
    add('stem|0', p, norm([-gx, -gy, s]), 2);
    k++;
  }
  const n = [...groups.values()].reduce((t, g) => t + g.length, 0);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), part = new Uint8Array(n), ranges = new Map();
  let o = 0;
  for (const [key, list] of groups) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    ranges.set(key, [o, list.length]);
    for (const [p, nv, pt] of list) { pos.set(p, o * 3); nrm.set(nv, o * 3); part[o] = pt; o++; }
  }
  return { pos, nrm, part, ranges, parts: PARTS };
}
