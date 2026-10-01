// Brain geometry and node layout. Lateral view facing right: x back→front, y down→up, z toward the viewer.
// Lobes are ellipsoids; each region (a project's folder or kind of note) gets an anchor inside its lobe, and its
// nodes settle around it with a short force simulation (springs on edges, repulsion, containment).
import { rng } from './data.js';

export const LOBE_SHAPES = {
  prefrontal: { c: [0.76, 0.12, 0], r: [0.22, 0.30, 0.36] },
  frontal: { c: [0.36, 0.46, 0], r: [0.32, 0.28, 0.46] },
  parietal: { c: [-0.22, 0.48, 0], r: [0.36, 0.28, 0.48] },
  occipital: { c: [-0.72, 0.22, 0], r: [0.24, 0.30, 0.40] },
  temporal: { c: [0.12, -0.17, 0], r: [0.46, 0.19, 0.42] },
  cerebellum: { c: [-0.60, -0.45, 0], r: [0.26, 0.11, 0.30] },
  stem: { c: [-0.18, -0.68, 0], r: [0.07, 0.22, 0.08] },
};
// The drawn brain: a lateral profile (cerebrum, cerebellum, brainstem) in the mid plane. Chrome, never data.
export const PROFILE = [
  [[1.02, 0.08], [0.98, 0.36], [0.80, 0.62], [0.46, 0.80], [0.02, 0.84], [-0.40, 0.77], [-0.76, 0.56], [-0.98, 0.26], [-1.02, 0.02],
    [-0.90, -0.18], [-0.62, -0.25], [-0.30, -0.33], [0.02, -0.42], [0.38, -0.43], [0.62, -0.30], [0.67, -0.16], [0.80, -0.13], [0.95, -0.10], [1.02, 0.08]],
  [[-0.93, -0.12], [-0.92, -0.32], [-0.80, -0.50], [-0.58, -0.60], [-0.40, -0.54], [-0.31, -0.42], [-0.30, -0.33]],
  [[-0.30, -0.36], [-0.27, -0.62], [-0.24, -0.96]],
  [[-0.06, -0.42], [-0.10, -0.66], [-0.12, -0.96]],
];
// Fissures between lobes, as curves on the near surface: lateral (Sylvian), central, parieto-occipital.
export const FISSURES = [
  [[0.64, -0.08], [0.24, 0.02], [-0.18, 0.10], [-0.42, 0.22]],
  [[0.12, 0.83], [0.16, 0.56], [0.24, 0.30], [0.28, 0.10]],
  [[-0.52, 0.74], [-0.56, 0.56], [-0.62, 0.38], [-0.62, 0.26]],
];

const inEllipsoid = (p, s) => {
  const dx = (p[0] - s.c[0]) / s.r[0], dy = (p[1] - s.c[1]) / s.r[1], dz = (p[2] - s.c[2]) / s.r[2];
  return dx * dx + dy * dy + dz * dz;
};

// Positions for every node (Float32Array x,y,z), plus region centroids and radii for labels and haze.
export function layout(graph, { seed = 3, iterations = 60 } = {}) {
  const r = rng(seed);
  const { nodes, edges, regions, projects } = graph;
  const n = nodes.length;
  const pos = new Float32Array(n * 3);
  const projOrder = new Map(projects.map((p, i) => [p.id, i]));
  const count = new Int32Array(regions.length);
  for (const nd of nodes) count[nd.region]++;

  // 1. Region anchors inside each lobe: discs sized by node count, packed by relaxation, same project together.
  const anchor = regions.map(() => [0, 0, 0]);
  const rad = regions.map((g) => 0.02 + 0.01 * Math.sqrt(count[g.id]));
  for (const [lobe, shape] of Object.entries(LOBE_SHAPES)) {
    const rs = regions.filter((g) => g.lobe === lobe).sort((a, b) => (projOrder.get(a.project) ?? -1) - (projOrder.get(b.project) ?? -1) || count[b.id] - count[a.id]);
    // Shrink discs when the lobe is crowded, so they fit its area.
    const area = Math.PI * shape.r[0] * shape.r[1];
    const need = rs.reduce((s, g) => s + Math.PI * rad[g.id] ** 2, 0);
    const k = Math.sqrt(area / need);
    rs.forEach((g, i) => {
      rad[g.id] *= k;
      const a = i * 2.39996, d = Math.sqrt((i + 0.5) / rs.length) * 0.92; // sunflower
      anchor[g.id] = [shape.c[0] + Math.cos(a) * d * shape.r[0], shape.c[1] + Math.sin(a) * d * shape.r[1], (r() - 0.5) * shape.r[2] * 0.6];
    });
    for (let it = 0; it < 80; it++) {
      for (let i = 0; i < rs.length; i++) {
        const A = anchor[rs[i].id];
        for (let j = i + 1; j < rs.length; j++) {
          const B = anchor[rs[j].id];
          const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1e-4;
          const min = rad[rs[i].id] + rad[rs[j].id];
          const push = d < min ? (min - d) * 0.5 : 0;
          A[0] -= (dx / d) * push; A[1] -= (dy / d) * push; B[0] += (dx / d) * push; B[1] += (dy / d) * push;
        }
        // Keep the disc inside the lobe ellipse
        const ex = (A[0] - shape.c[0]) / Math.max(0.01, shape.r[0] - rad[rs[i].id] * 0.7);
        const ey = (A[1] - shape.c[1]) / Math.max(0.01, shape.r[1] - rad[rs[i].id] * 0.7);
        const e = Math.hypot(ex, ey);
        if (e > 1) { A[0] = shape.c[0] + (A[0] - shape.c[0]) / e; A[1] = shape.c[1] + (A[1] - shape.c[1]) / e; }
      }
    }
  }

  // 2. Nodes start in a ball around their anchor.
  for (let i = 0; i < n; i++) {
    const g = nodes[i].region, A = anchor[g], s = rad[g];
    const u = r() * 2 - 1, phi = r() * Math.PI * 2, d = Math.sqrt(r()) * s;
    const q = Math.sqrt(1 - u * u);
    pos[i * 3] = A[0] + Math.cos(phi) * q * d;
    pos[i * 3 + 1] = A[1] + Math.sin(phi) * q * d;
    pos[i * 3 + 2] = A[2] + u * d * 2.2; // deeper than wide: depth reads as volume
  }

  // 3. Forces. ponytail: uniform grid (counting sort into a fixed box) for repulsion, O(n) per pass; fine to
  // ~20k nodes, Barnes-Hut beyond that.
  const vel = new Float32Array(n * 3);
  const cell = 0.05;
  const intra = edges.filter((e) => e.type !== 'index' && nodes[e.a].region === nodes[e.b].region); // the index is a hub: as a spring it knots every note
  const cross = edges.filter((e) => nodes[e.a].region !== nodes[e.b].region);
  const GX = Math.ceil(2.4 / cell), GY = Math.ceil(2 / cell), GZ = Math.ceil(1.4 / cell);
  const cellOf = (i) => {
    const x = Math.min(GX - 1, Math.max(0, Math.floor((pos[i * 3] + 1.2) / cell)));
    const y = Math.min(GY - 1, Math.max(0, Math.floor((pos[i * 3 + 1] + 1) / cell)));
    const z = Math.min(GZ - 1, Math.max(0, Math.floor((pos[i * 3 + 2] + 0.7) / cell)));
    return (x * GY + y) * GZ + z;
  };
  const start = new Int32Array(GX * GY * GZ + 1);
  const order = new Int32Array(n);
  const cellIdx = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    start.fill(0);
    for (let i = 0; i < n; i++) { cellIdx[i] = cellOf(i); start[cellIdx[i] + 1]++; }
    for (let c = 0; c < GX * GY * GZ; c++) start[c + 1] += start[c];
    const fill = start.slice(0, -1);
    for (let i = 0; i < n; i++) order[fill[cellIdx[i]]++] = i;
    for (let i = 0; i < n; i++) {
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
    spring(cross, 0.002, 0.2);
    for (let i = 0; i < n; i++) {
      const g = nodes[i].region, A = anchor[g], j = i * 3;
      const s = rad[g] * 1.15, dx = pos[j] - A[0], dy = pos[j + 1] - A[1], dd = Math.hypot(dx, dy);
      if (dd > s) { const f = ((dd - s) / dd) * 0.08; vel[j] -= dx * f; vel[j + 1] -= dy * f; } // stay on the region's disc
      vel[j + 2] += (A[2] - pos[j + 2]) * 0.003;
      for (let a = 0; a < 3; a++) { pos[j + a] += vel[j + a] * cool; vel[j + a] *= 0.5; }
      // Containment: back inside the lobe ellipsoid
      const shape = LOBE_SHAPES[regions[g].lobe];
      const p = [pos[j], pos[j + 1], pos[j + 2]];
      const e = inEllipsoid(p, shape);
      if (e > 1) { const s = 1 / Math.sqrt(e); for (let a = 0; a < 3; a++) pos[j + a] = shape.c[a] + (p[a] - shape.c[a]) * s; }
    }
  }

  // 4. Region centroids and spread, for labels and the haze behind each region.
  const centroid = regions.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) centroid[nodes[i].region][a] += pos[i * 3 + a];
  for (const g of regions) for (let a = 0; a < 3; a++) centroid[g.id][a] /= Math.max(1, count[g.id]);
  const spread = regions.map(() => 0);
  for (let i = 0; i < n; i++) {
    const c = centroid[nodes[i].region];
    spread[nodes[i].region] += Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1]);
  }
  for (const g of regions) spread[g.id] = count[g.id] ? spread[g.id] / count[g.id] : 0;
  return { pos, centroid, spread, count };
}

// The fissures as 3D polylines on the near surface of the cerebrum shell (so they turn with the brain).
export function fissureLines(samples = 24) {
  const shell = { c: [0, 0.2, 0], r: [1.04, 0.66, 0.5] };
  return FISSURES.map((pts) => {
    const out = [];
    for (let s = 0; s <= samples; s++) {
      const t = (s / samples) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
      // Catmull-Rom through the control points
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
      const x = cr(p0[0], p1[0], p2[0], p3[0]), y = cr(p0[1], p1[1], p2[1], p3[1]);
      const ex = (x - shell.c[0]) / shell.r[0], ey = (y - shell.c[1]) / shell.r[1];
      const z = shell.r[2] * Math.sqrt(Math.max(0, 1 - ex * ex - ey * ey)) * 0.92;
      out.push(x, y, z);
    }
    return out;
  });
}

// The profile as smooth line segments [x,y,z, x,y,z, ...] in the mid plane.
export function profileLines(samples = 6) {
  const out = [];
  for (const pts of PROFILE) {
    const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    let prev = null;
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < samples; k++) {
      const f = k / samples, get = (j) => pts[closed ? (j + pts.length - 1) % (pts.length - 1) : Math.max(0, Math.min(pts.length - 1, j))];
      const p0 = get(i - 1), p1 = pts[i], p2 = pts[i + 1], p3 = get(i + 2);
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
      const p = [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), 0];
      if (prev) out.push(...prev, ...p);
      prev = p;
    }
    const last = pts[pts.length - 1];
    out.push(...prev, last[0], last[1], 0);
  }
  return out;
}
