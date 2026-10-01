// Brain geometry and node layout in 3D: x back→front, y down→up, z the right (+) and left (−) hemispheres.
// The side view is a region map traced from a real brain (shape.js); each part is inflated from it into a solid: the
// cerebrum rounds off toward its outline with a broad base (two hemispheres with flat inner faces, split by a thin
// fissure), the cerebellum is a compact flattened dome, the brainstem a round tube. Lobes are the map's regions
// through the whole depth, mirrored on both hemispheres, so a lobe's nodes fill its part of the shell. Each lobe's
// volume is shared among its regions (a project's folder or kind of note) in proportion to their node counts, and a
// short force simulation evens the nodes out inside it.
import { rng } from './data.js';
import { SHAPE } from './shape.js';

// Proportions of a real brain: length 1 : width 0.83 : cerebrum height 0.62 (here the length is 2).
const HALF_WIDTH = 0.785, TAPER = 0.08; // a little wider at the back than at the front
const ROUND = 0.5; // how deep the cerebrum's rounding reaches in from its outline
const GAP = 0.02; // half the fissure between the hemispheres: about 2.5% of the width
const NOTCH = 0.03; // how far the top dips at the fissure, seen from the front
const CBL_HALF = 0.52, CBL_ROUND = 0.3, STEM_R = 0.075;

// The region map, decoded: one code per cell, 0 outside.
const G = SHAPE.size, CODES = '.PFAOTCS';
const T_ = 5, C_ = 6, S_ = 7;
const LOBE_OF = [null, 'prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'];
const cls = new Uint8Array(G * G);
SHAPE.rows.forEach((row, gy) => {
  let gx = 0;
  for (const m of row.matchAll(/(\d+)(.)/g)) { cls.fill(CODES.indexOf(m[2]), gy * G + gx, gy * G + gx + Number(m[1])); gx += Number(m[1]); }
});
const isCer = (c) => c >= 1 && c <= T_;
// Grid ↔ world: the cerebrum is 2 long, centered on x = 0, its top at y = 0.7; the map's front (left) is +x.
let gx0 = G, gx1 = 0, gyTop = G;
for (let i = 0; i < G * G; i++) if (isCer(cls[i])) { const x = i % G, y = (i / G) | 0; gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gyTop = Math.min(gyTop, y); }
const CELL = 2 / (gx1 - gx0 + 1), UMID = (gx0 + gx1 + 1) / 2, TOP = 0.7;
const toU = (x) => UMID - x / CELL, toV = (y) => gyTop + (TOP - y) / CELL;
const cellX = (gx) => (UMID - gx - 0.5) * CELL, cellY = (gy) => TOP - (gy + 0.5 - gyTop) * CELL;

// Distance (world units) from each cell to the nearest cell where inside() is false: a two-pass chamfer transform.
function distance(inside) {
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
// Signed: positive inside (distance to the outline), negative outside.
function signed(inside) {
  const a = distance(inside), b = distance((i) => !inside(i)), s = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) s[i] = a[i] > 0 ? a[i] - CELL / 2 : -(b[i] - CELL / 2);
  return s;
}
const sdCer = signed((i) => isCer(cls[i])), sdCbl = signed((i) => cls[i] === C_), sdStem = signed((i) => cls[i] === S_);
// The main fissures on the surface: the Sylvian (temporal lobe against the frontal and parietal lobes above it) and the
// central sulcus (frontal against parietal).
const nearTo = (from, to) => { const d = distance((i) => !to(cls[i])); return d.map((v, i) => (from(cls[i]) ? v : 99)); };
const upper = (c) => c >= 1 && c <= 3;
const dSylvA = nearTo((c) => c === T_, upper), dSylvB = nearTo(upper, (c) => c === T_);
const dSylv = dSylvA.map((v, i) => Math.min(v, dSylvB[i]));
const dCentA = nearTo((c) => c === 2, (c) => c === 3), dCentB = nearTo((c) => c === 3, (c) => c === 2);
const dCent = dCentA.map((v, i) => Math.min(v, dCentB[i]));

// Half-widths: the cerebrum rounds off over ROUND from its outline (a little faster toward its base, so the base is
// broad), the cerebellum over CBL_ROUND, the brainstem is round.
const R = (t) => (t >= 1 ? 1 : t <= 0 ? 0 : Math.sqrt(1 - (1 - t) ** 2));
const vMid = new Float32Array(G);
for (let gx = 0; gx < G; gx++) {
  let a = -1, b = -1;
  for (let gy = 0; gy < G; gy++) if (isCer(cls[gy * G + gx])) { if (a < 0) a = gy; b = gy; }
  vMid[gx] = a < 0 ? G / 2 : (a + b + 1) / 2;
}
const base = new Float32Array(G * G); // how much faster the rounding goes: 1 down to each column's middle, 1.25 at its base
for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
  const below = Math.max(0, Math.min(1, (gy + 0.5 - vMid[gx]) / (vMid[gx] - gyTop + 1)));
  base[gy * G + gx] = 1 + 0.25 * below * below;
}
// Bilinear sample of a cell field at a world (x, y).
function sample(f, x, y) {
  const u = toU(x) - 0.5, v = toV(y) - 0.5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  const at = (p, q) => (p < 0 || q < 0 || p >= G || q >= G ? f === sdCer || f === sdCbl || f === sdStem ? -1 : 0 : f[q * G + p]);
  return (at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - b) + (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * b;
}
// Half-widths from the smoothly interpolated distance, so each surface closes to zero exactly at its outline.
const zCer = (x, y) => HALF_WIDTH * (1 - TAPER * x) * R((sample(sdCer, x, y) * sample(base, x, y)) / ROUND);
const zCbl = (x, y) => CBL_HALF * R(sample(sdCbl, x, y) / CBL_ROUND);
const zStem = (x, y) => STEM_R * 1.3 * R(sample(sdStem, x, y) / STEM_R);
const cellAt = (x, y) => { const u = Math.floor(toU(x)), v = Math.floor(toV(y)); return u < 0 || v < 0 || u >= G || v >= G ? 0 : cls[v * G + u]; };

// Which lobe and hemisphere a point is in, as [lobe, side] (side 0 for the midline brainstem), or null outside the
// volumes nodes use (a little inside the shell, off the fissure).
function classify(p) {
  const c = cellAt(p[0], p[1]);
  if (!c) return null;
  const z = Math.abs(p[2]), side = p[2] > 0 ? 1 : -1;
  if (c === S_) return z < 0.85 * zStem(p[0], p[1]) && sample(sdStem, p[0], p[1]) > 0 ? ['stem', 0] : null;
  if (c === C_) return z > 0.01 && z < 0.88 * zCbl(p[0], p[1]) && sample(sdCbl, p[0], p[1]) > 0 ? ['cerebellum', side] : null;
  if (z < GAP * 2 || z > 0.9 * zCer(p[0], p[1]) || sample(sdCer, p[0], p[1]) <= 0) return null;
  return [LOBE_OF[c], side];
}
export const lobeAt = classify;

// A fixed pool of points spread through each lobe's volume: shares out the volume among regions and gives each lobe
// its center, extent and volume.
const LOBE_NAMES = ['prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'];
const BOX = [[-1.05, 1.05], [-1.05, 0.75], [-0.92, 0.92]];
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
export const BRAIN_CENTER = [0, (TOP + STEM_BOTTOM) / 2, 0];
export const BRAIN_RADIUS = Math.hypot(1.05, (TOP - STEM_BOTTOM) / 2); // bounding sphere, for framing and depth fog

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

// [x, y, z, part] per particle: part 0 cerebrum, 1 cerebellum, 2 brainstem. Each part's surface is its two sides,
// ±half-width over the side view, sampled evenly over its area.
export function shellPoints(count = 20000, seed = 9) {
  const r = rng(seed);
  const out = [];
  const parts = [
    { part: 0, z: zCer, sd: sdCer, share: 0.82 },
    { part: 1, z: zCbl, sd: sdCbl, share: 0.12 },
    { part: 2, z: zStem, sd: sdStem, share: 0.06 },
  ];
  for (const P of parts) {
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (let i = 0; i < G * G; i++) if (P.sd[i] > 0) { const x = cellX(i % G), y = cellY((i / G) | 0); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 -= CELL; x1 += CELL; y0 -= CELL; y1 += CELL;
    const want = Math.round(count * P.share);
    for (let k = 0, tries = 0; k < want && tries < want * 60; tries++) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      if (sample(P.sd, x, y) <= 0) continue;
      const z = P.z(x, y), e = 0.008;
      const gx = (P.z(x + e, y) - P.z(x - e, y)) / (2 * e), gy = (P.z(x, y + e) - P.z(x, y - e)) / (2 * e);
      if (r() * 3 > Math.min(3, Math.hypot(1, gx, gy))) continue; // even over the surface, the steepest rims a little sparser
      const s = r() < 0.5 ? 1 : -1, p = [x, y, s * z * (1 + (r() - 0.5) * 0.02)];
      if (P.part === 0) {
        const c = cellAt(x, y);
        if (z < GAP && c !== T_) continue; // the longitudinal fissure between the hemispheres
        const syl = sample(dSylv, x, y), cen = sample(dCent, x, y);
        if (z > 0.2 && syl < 0.03) continue; // the Sylvian fissure, the clearest groove on the side
        if (cen < 0.02) continue; // the central sulcus
        const u = gyri(x, y, p[2]) * GYRI.bands, q = Math.abs(u - Math.round(u)) * 2;
        if (q > GYRI.ridge || r() > 1 - q / GYRI.ridge * 0.8) continue; // dense along each ridge, empty in the grooves
        const near = Math.min(z > 0.2 ? syl : 9, cen);
        p[2] *= 1 - 0.07 * Math.exp(-((near / 0.05) ** 2)); // the big grooves sink in a little
        if (toV(y) < vMid[Math.min(G - 1, Math.max(0, Math.floor(toU(x))))]) p[1] -= NOTCH * Math.exp(-((z / 0.08) ** 2)); // the top dips at the fissure
      } else if (P.part === 1) {
        if (Math.abs(Math.sin(62 * (y + 0.25 * (x + 0.6) ** 2))) < 0.42) continue; // the cerebellum's fine, curved folia
      }
      out.push(p[0], p[1], p[2], P.part);
      k++;
    }
  }
  // Shuffled, so any prefix is an even sample of the whole shell (the renderer draws half of it while the camera moves).
  const n = out.length / 4, res = new Float32Array(out.length);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((j, i) => res.set(out.slice(j * 4, j * 4 + 4), i * 4));
  return res;
}
