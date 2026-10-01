// Brain geometry and node layout in 3D: x back→front, y down→up, z the right (+) and left (−) hemispheres.
// Lobes are ellipsoid volumes in each hemisphere (the brainstem sits on the midline). Each region (a project's
// folder or kind of note) is an ellipsoid inside its lobe, sized by node count; its nodes settle in it with a
// short force simulation (springs on links, repulsion, containment).
import { rng } from './data.js';

// The right hemisphere's lobes; the left one mirrors z.
// Placed where they are anatomically: prefrontal and frontal at the front, parietal top-back, occipital at the back,
// temporal low on the side, cerebellum tucked under the back, brainstem down from the center.
export const LOBES = {
  prefrontal: { c: [0.80, 0.16, 0.32], r: [0.20, 0.32, 0.26] },
  frontal: { c: [0.40, 0.52, 0.36], r: [0.32, 0.26, 0.32] },
  parietal: { c: [-0.24, 0.56, 0.37], r: [0.36, 0.26, 0.33] },
  occipital: { c: [-0.78, 0.20, 0.32], r: [0.22, 0.30, 0.26] },
  temporal: { c: [0.20, -0.26, 0.49], r: [0.42, 0.16, 0.19] },
  cerebellum: { c: [-0.62, -0.56, 0.24], r: [0.22, 0.10, 0.19] },
  stem: { c: [-0.14, -0.82, 0], r: [0.07, 0.24, 0.07], midline: true },
};
// The volume of one lobe on one side (side 0 for the midline stem).
export const lobeShape = (lobe, side) => {
  const L = LOBES[lobe];
  return { c: [L.c[0], L.c[1], L.midline ? 0 : L.c[2] * side], r: L.r };
};
export const BRAIN_CENTER = [0, -0.06, 0];
export const BRAIN_RADIUS = 1.25; // bounding sphere around BRAIN_CENTER, for framing and depth fog

const inside = (p, s) => (p[0] - s.c[0]) ** 2 / s.r[0] ** 2 + (p[1] - s.c[1]) ** 2 / s.r[1] ** 2 + (p[2] - s.c[2]) ** 2 / s.r[2] ** 2;
const ballPoint = (r) => { // uniform in the unit ball
  for (;;) { const p = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; if (p[0] ** 2 + p[1] ** 2 + p[2] ** 2 <= 1) return p; }
};

// Positions for every node (Float32Array x,y,z), plus per region: side, centroid, spread, count.
// Only nodes with visible[i] (default: all) are laid out, so "Re-layout" can respread what the filters show.
export function layout(graph, { seed = 3, iterations = 60, visible = null } = {}) {
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
  for (const [lobe, L] of Object.entries(LOBES)) {
    const rs = regions.filter((g) => g.lobe === lobe && count[g.id]).sort((a, b) => count[b.id] - count[a.id]);
    const load = { 1: 0, [-1]: 0 };
    for (const g of rs) {
      if (L.midline) { side[g.id] = 0; continue; }
      const home = (projOrder.get(g.project) ?? 0) % 2 ? -1 : 1;
      const s = load[home] <= load[-home] + count[g.id] * 0.5 ? home : -home;
      side[g.id] = s;
      load[s] += count[g.id];
    }
  }

  // 2. Region anchors: inside each lobe volume (in lobe-normalized units, where the lobe is the unit ball), each
  // region a ball whose volume share follows its node count, packed by relaxation.
  const anchor = regions.map(() => [0, 0, 0]);
  const rho = new Float32Array(regions.length);
  for (const lobe of Object.keys(LOBES)) {
    for (const s of LOBES[lobe].midline ? [0] : [1, -1]) {
      const rs = regions.filter((g) => g.lobe === lobe && count[g.id] && side[g.id] === s).sort((a, b) => count[b.id] - count[a.id]);
      const total = rs.reduce((t, g) => t + count[g.id], 0);
      const u = rs.map((g, i) => {
        rho[g.id] = Math.cbrt(count[g.id] / total) * 0.92;
        const k = (i + 0.5) / rs.length, rad = Math.cbrt(k) * 0.7, th = i * 2.39996, ph = Math.acos(1 - 2 * k);
        return [rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph), rad * Math.sin(ph) * Math.sin(th)];
      });
      for (let it = 0; it < 80; it++) {
        for (let i = 0; i < rs.length; i++) {
          for (let j = i + 1; j < rs.length; j++) {
            const d = [u[j][0] - u[i][0], u[j][1] - u[i][1], u[j][2] - u[i][2]], len = Math.hypot(...d) || 1e-4;
            const min = (rho[rs[i].id] + rho[rs[j].id]) * 0.9;
            if (len < min) for (let a = 0; a < 3; a++) { const push = (d[a] / len) * (min - len) * 0.5; u[i][a] -= push; u[j][a] += push; }
          }
          const lim = Math.max(0.05, 1 - rho[rs[i].id] * 0.6), len = Math.hypot(...u[i]);
          if (len > lim) for (let a = 0; a < 3; a++) u[i][a] *= lim / len;
        }
      }
      const shape = lobeShape(lobe, s);
      rs.forEach((g, i) => { anchor[g.id] = [0, 1, 2].map((a) => shape.c[a] + u[i][a] * shape.r[a]); });
    }
  }
  const regionShape = (g) => ({ c: anchor[g], r: LOBES[regions[g].lobe].r.map((x) => x * rho[g] * 1.12) });

  // 3. Nodes start uniformly inside their region's volume.
  for (let i = 0; i < n; i++) {
    if (!on(i)) continue;
    const g = nodes[i].region, rs = regionShape(g), p = ballPoint(r);
    for (let a = 0; a < 3; a++) pos[i * 3 + a] = rs.c[a] + p[a] * rs.r[a];
  }

  // 4. Forces. ponytail: uniform grid (counting sort into a fixed box) for repulsion, O(n) per pass; fine to
  // ~20k nodes, Barnes-Hut beyond that.
  const vel = new Float32Array(n * 3);
  const cell = 0.05;
  const idx = [];
  for (let i = 0; i < n; i++) if (on(i)) idx.push(i);
  const live = edges.filter((e) => on(e.a) && on(e.b) && e.a !== e.b);
  // The MEMORY.md index is a hub: as a spring it would knot every note around it.
  const intra = live.filter((e) => e.type !== 'index' && nodes[e.a].region === nodes[e.b].region);
  const cross = live.filter((e) => e.type !== 'index' && nodes[e.a].region !== nodes[e.b].region);
  const GX = Math.ceil(2.4 / cell), GY = Math.ceil(2 / cell), GZ = Math.ceil(1.8 / cell);
  const cellOf = (i) => {
    const x = Math.min(GX - 1, Math.max(0, Math.floor((pos[i * 3] + 1.2) / cell)));
    const y = Math.min(GY - 1, Math.max(0, Math.floor((pos[i * 3 + 1] + 1) / cell)));
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
          const f = ((cell - d) / d) * 0.12;
          vel[i * 3] -= x * f; vel[i * 3 + 1] -= y * f; vel[i * 3 + 2] -= z * f;
          vel[j * 3] += x * f; vel[j * 3 + 1] += y * f; vel[j * 3 + 2] += z * f;
        }
      }
    }
    const spring = (list, k, rest) => {
      for (const e of list) {
        const a = e.a * 3, b = e.b * 3;
        const x = pos[b] - pos[a], y = pos[b + 1] - pos[a + 1], z = pos[b + 2] - pos[a + 2];
        const d = Math.hypot(x, y, z) || 1e-5;
        const f = ((d - rest) / d) * k;
        vel[a] += x * f; vel[a + 1] += y * f; vel[a + 2] += z * f;
        vel[b] -= x * f; vel[b + 1] -= y * f; vel[b + 2] -= z * f;
      }
    };
    spring(intra, 0.006, 0.06);
    spring(cross, 0.001, 0.25);
    for (const i of idx) {
      const g = nodes[i].region, j = i * 3, rs = regionShape(g);
      for (let a = 0; a < 3; a++) { pos[j + a] += vel[j + a] * cool; vel[j + a] *= 0.5; }
      // Soft pull back onto the region's volume, hard containment in the lobe's.
      const p = [pos[j], pos[j + 1], pos[j + 2]];
      const er = inside(p, rs);
      if (er > 1) { const f = (1 - 1 / Math.sqrt(er)) * 0.3; for (let a = 0; a < 3; a++) pos[j + a] -= (p[a] - rs.c[a]) * f; }
      const lobe = lobeShape(regions[g].lobe, side[g]);
      const q = [pos[j], pos[j + 1], pos[j + 2]], e = inside(q, lobe);
      if (e > 1) { const s = 1 / Math.sqrt(e); for (let a = 0; a < 3; a++) pos[j + a] = lobe.c[a] + (q[a] - lobe.c[a]) * s; }
    }
  }

  // 5. Region centroids and spread, for labels, haze and fiber bundles.
  const centroid = regions.map(() => [0, 0, 0]);
  for (const i of idx) for (let a = 0; a < 3; a++) centroid[nodes[i].region][a] += pos[i * 3 + a];
  for (const g of regions) for (let a = 0; a < 3; a++) centroid[g.id][a] = count[g.id] ? centroid[g.id][a] / count[g.id] : anchor[g.id][a];
  const spread = regions.map(() => 0);
  for (const i of idx) { const c = centroid[nodes[i].region]; spread[nodes[i].region] += Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]); }
  for (const g of regions) spread[g.id] = count[g.id] ? spread[g.id] / count[g.id] : 0;
  return { pos, side, centroid, spread, count };
}

// ---- the decorative particle shell (never interactive, never counted) ----------------------------------------
// The brain's surface as the soft union of a few ellipsoids per hemisphere, plus cerebellum and brainstem.
// About 1.4 : 1 : 1.05 (length : width : height with the cerebellum); each hemisphere is a body plus a rounded
// frontal lobe, a high parietal, an occipital pole and a temporal lobe bulging down and forward on the side. The
// hemispheres touch along the midline, leaving a shallow fissure.
const CEREBRUM = [
  { c: [-0.04, 0.24, 0.36], r: [0.98, 0.64, 0.38] },
  { c: [0.60, 0.20, 0.33], r: [0.44, 0.50, 0.35] },
  { c: [-0.22, 0.42, 0.36], r: [0.56, 0.42, 0.37] },
  { c: [-0.76, 0.18, 0.31], r: [0.32, 0.42, 0.30] },
  { c: [0.20, -0.27, 0.49], r: [0.52, 0.26, 0.25] },
];
const CEREBELLUM = [{ c: [-0.62, -0.56, 0.24], r: [0.28, 0.16, 0.25] }];
const STEM = [{ c: [-0.14, -0.80, 0], r: [0.10, 0.30, 0.10] }];

// Sulci in the lateral view (x, y), carved as thin gaps on the outer surface of each hemisphere.
const SULCI = [
  [[0.66, -0.07], [0.35, -0.02], [0.05, 0.05], [-0.25, 0.14], [-0.45, 0.24]], // lateral (Sylvian) fissure
  [[0.06, 0.88], [0.12, 0.66], [0.2, 0.42], [0.28, 0.18], [0.32, 0.04]], // central
  [[0.24, 0.84], [0.3, 0.6], [0.38, 0.36], [0.46, 0.12]], // precentral
  [[-0.1, 0.86], [-0.06, 0.62], [0.02, 0.38], [0.1, 0.16]], // postcentral
  [[0.92, 0.42], [0.7, 0.56], [0.46, 0.66], [0.3, 0.7]], // superior frontal
  [[0.58, -0.25], [0.3, -0.19], [0.0, -0.12], [-0.3, -0.04]], // superior temporal
  [[-0.5, 0.78], [-0.56, 0.6], [-0.62, 0.42], [-0.66, 0.26]], // parieto-occipital
  [[-0.2, 0.7], [-0.36, 0.54], [-0.52, 0.48]], // intraparietal
];
const sulcusDist = (x, y) => {
  let best = 9;
  for (const line of SULCI) for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
};

// [x, y, z, part] per particle: part 0 cerebrum, 1 cerebellum, 2 brainstem, 3 midline.
export function shellPoints(count = 7000, seed = 9) {
  const r = rng(seed);
  const out = [];
  const groups = [];
  for (const s of [1, -1]) {
    groups.push({ part: 0, side: s, list: CEREBRUM.map((e) => ({ c: [e.c[0], e.c[1], e.c[2] * s], r: e.r })) });
    groups.push({ part: 1, side: s, list: CEREBELLUM.map((e) => ({ c: [e.c[0], e.c[1], e.c[2] * s], r: e.r })) });
  }
  groups.push({ part: 2, side: 0, list: STEM });
  const area = (e) => 4 * Math.PI * (((e.r[0] * e.r[1]) ** 1.6 + (e.r[0] * e.r[2]) ** 1.6 + (e.r[1] * e.r[2]) ** 1.6) / 3) ** (1 / 1.6);
  const all = groups.flatMap((g) => g.list.map((e) => ({ g, e, a: area(e) })));
  const total = all.reduce((t, x) => t + x.a, 0);
  for (const { g, e, a } of all) {
    const want = Math.round((count * 0.95 * a) / total);
    for (let k = 0, tries = 0; k < want && tries < want * 12; tries++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
      const d = [q * Math.cos(th), u, q * Math.sin(th)];
      const jit = 1 + (r() - 0.5) * 0.03;
      const p = [0, 1, 2].map((i) => e.c[i] + d[i] * e.r[i] * jit);
      if (g.list.some((o) => o !== e && inside(p, o) < 0.97)) continue; // only the union's outer surface
      if (g.part === 0 && p[2] * g.side < 0.015) continue; // the shallow fissure between hemispheres
      if (g.part === 0 && CEREBELLUM.some((o) => inside(p, { c: [o.c[0], o.c[1], o.c[2] * g.side], r: o.r }) < 1)) continue;
      // Folds: density follows a gyri-like pattern, so the surface reads as a cortex, not a balloon.
      if (g.part === 0 && Math.abs(p[2]) > 0.16 && sulcusDist(p[0], p[1]) < 0.024) continue; // a sulcus
      const fold = Math.abs(Math.sin(11 * p[0] + 4 * Math.sin(7 * p[1] + 2 * p[2])) * Math.sin(10 * p[1] + 3 * Math.sin(8 * p[2] + 3 * p[0])));
      if (g.part === 0 && r() > 0.42 + 0.58 * fold) continue; // softer gyri between the sulci
      if (g.part === 1 && Math.abs(Math.sin(40 * p[1] + 6 * p[0])) < 0.45) continue; // the cerebellum's fine parallel folia
      out.push(p[0], p[1], p[2], g.part);
      k++;
    }
  }
  // The midline: the valley where the hemispheres meet on top.
  for (let k = 0; k < count * 0.05; k++) {
    const x = (r() * 2 - 1) * 0.98, e = CEREBRUM[0];
    const dz = (0.015 - e.c[2]) / e.r[2], v = 1 - ((x - e.c[0]) / e.r[0]) ** 2 - dz * dz;
    if (v <= 0) continue;
    out.push(x, e.c[1] + e.r[1] * Math.sqrt(v), (r() - 0.5) * 0.015, 3);
  }
  return new Float32Array(out);
}
