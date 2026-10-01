// Renderer benchmark scene: the prototype's brain at N nodes with everything moving (camera turning every frame,
// four comets with trails, rings, think ripples), drawn by one of three renderers chosen with ?r=canvas|webgl|three.
// Counters live in window.__bench and are read over CDP by run.mjs.
import { makeGraph, rng } from '../data.js';
import { layout, fissureLines, profileLines } from '../layout.js';
import { Renderer, oklch, KIND, SHAPE, EDGE, perspective, multiply, orbitView } from '../gl.js';

const q = new URLSearchParams(location.search);
const R = q.get('r') || 'webgl';
const TARGET = Number(q.get('nodes') || 3000);
const EDGES = Number(q.get('edges') || 0);
const SKIP = new Set((q.get('skip') || '').split(','));
const DPR_CAP = Number(q.get('dpr') || 2);
let mode = q.get('mode') || 'cap'; // cap = 30 fps by skipping animation frames, timer = 30 fps by sleeping between frames, max = every frame
const FOV = (30 * Math.PI) / 180;
const t0 = performance.now();

// ---- the scene (same arrays for every renderer) ----
const C = (l, c, h) => oklch(l / 100, c, h);
const P = {
  bg: C(12.5, 0.014, 285), bgCenter: C(17.5, 0.03, 288), node: C(90, 0.035, 285), accent: C(74, 0.145, 288), haze: C(58, 0.05, 288),
  kinds: [[0, 0, 0], C(76, 0.115, 245), C(77, 0.13, 350), C(72, 0.17, 25), C(94.5, 0.006, 285), C(74, 0.145, 288)].flat(),
  edgeColors: [C(78, 0.03, 285), C(70, 0.03, 285), C(82, 0.03, 285), C(74, 0.03, 285), C(70, 0.025, 285), C(76, 0.03, 285), C(70, 0.04, 288), C(76, 0.04, 288)].flat(),
  edgeAlpha: [0.2, 0.09, 0.3, 0.12, 0.09, 0.16, 0.22, 0.42],
};
const graph = makeGraph({ target: TARGET });
const r = rng(5);
if (EDGES > graph.edges.length) { // edge-heavy variant: extra co-change edges inside regions
  const byRegion = new Map();
  graph.nodes.forEach((n, i) => { if (!byRegion.has(n.region)) byRegion.set(n.region, []); byRegion.get(n.region).push(i); });
  const lists = [...byRegion.values()].filter((l) => l.length > 1);
  while (graph.edges.length < EDGES) { const l = r.pick(lists); graph.edges.push({ a: r.pick(l), b: r.pick(l), type: 'cochange' }); }
}
const L = layout(graph);
const N = graph.nodes.length, E = graph.edges.length;
const pos = L.pos;
const projIndex = new Map(graph.projects.map((p, i) => [p.id, i]));
const size = new Float32Array(N), shape = new Float32Array(N), proj = new Float32Array(N), state = new Float32Array(N * 4);
graph.nodes.forEach((n, i) => {
  const act = n.type === 'tool' ? n.uses / 10 : (n.reads || 0) + 2 * (n.edits || 0);
  size[i] = 0.014 + 0.0042 * Math.sqrt(Math.min(act, 140));
  shape[i] = SHAPE[n.type];
  proj[i] = n.project == null ? -1 : projIndex.get(n.project);
  state.set([0.4 + 0.6 * Math.min(1, Math.sqrt(act / 70)), r() < 0.05 ? 0.6 : 0, -100, r() < 0.05 ? 1 + r.int(4) : 0], i * 4);
});
const edgeVerts = new Float32Array(E * 12);
graph.edges.forEach((e, k) => {
  const a = [pos[e.a * 3], pos[e.a * 3 + 1], pos[e.a * 3 + 2]], b = [pos[e.b * 3], pos[e.b * 3 + 1], pos[e.b * 3 + 2]];
  const pj = proj[e.a] >= 0 ? proj[e.a] : proj[e.b];
  edgeVerts.set([...a, 0, EDGE[e.type], pj, ...b, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), EDGE[e.type], pj], k * 12);
});
const lineVerts = [];
for (const line of fissureLines()) for (let i = 0; i + 5 < line.length; i += 3) lineVerts.push(...line.slice(i, i + 3), 0, EDGE.fissure, -1, ...line.slice(i + 3, i + 6), 0, EDGE.fissure, -1);
const prof = profileLines();
for (let i = 0; i < prof.length; i += 6) lineVerts.push(...prof.slice(i, i + 3), 0, EDGE.profile, -1, ...prof.slice(i + 3, i + 6), 0, EDGE.profile, -1);
const fissures = new Float32Array(lineVerts);
const projCur = new Float32Array(32).fill(0.5);
projCur[0] = 1.15;
const S = { P, N, E, pos, size, shape, proj, state, edgeVerts, edgeHl: new Float32Array(E * 2).fill(1), fissures, regions: graph.regions, L };

// ---- motion: comets, rings, ripples ----
const AGENTS = [[95, 0.02, 285], [82, 0.12, 200], [87, 0.16, 125], [80, 0.14, 55]].map((h) => C(...h));
const comets = AGENTS.map((rgb) => ({ rgb, from: 0, to: r.int(N), t0: 0, dur: 800 }));
const rings = [];
const ripples = [];
const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
function cometPoint(c, u) {
  const a = at(c.from), b = at(c.to), e = ease(Math.min(1, Math.max(0, u))), v = 1 - e;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.3];
  return [0, 1, 2].map((k) => v * v * a[k] + 2 * v * e * m[k] + e * e * b[k]);
}
let stateDirty = [];
function step(now) {
  const time = (now - t0) / 1000;
  for (const c of comets) {
    if (now - c.t0 > c.dur) {
      state[c.to * 4 + 2] = time; state[c.to * 4 + 3] = 1 + r.int(4); state[c.to * 4 + 1] = 1;
      stateDirty.push(c.to);
      rings.push({ p: at(c.to), t0: now, rgb: P.kinds.slice(3, 6) });
      c.from = c.to; c.to = r.int(N); c.t0 = now; c.dur = 600 + r.int(400);
    }
  }
  while (rings.length && now - rings[0].t0 > 750) rings.shift();
  if (!ripples.length || time - ripples[ripples.length - 1].t > 3) ripples.push({ p: at(comets[1].from), t: time, c: AGENTS[1] });
  while (ripples.length > 4) ripples.shift();
  const list = [];
  for (const g of graph.regions) {
    if (!L.count[g.id]) continue;
    const pf = g.project == null ? 1 : projCur[projIndex.get(g.project)];
    list.push(...L.centroid[g.id], Math.max(0.2, L.spread[g.id] * 5), ...P.haze, 0.17 * pf * pf, 0);
  }
  const haze = list.length / 9;
  for (const c of comets) {
    const u = (now - c.t0) / c.dur;
    for (let k = 12; k >= 0; k--) { const f = 1 - k / 13; list.push(...cometPoint(c, u - k * 0.03), 0.022 + 0.05 * f * f, ...c.rgb, (k ? 0.55 : 1) * f, 0); }
  }
  for (const g of rings) { const u = (now - g.t0) / 750, e = 1 - (1 - u) ** 3; list.push(...g.p, 0.04 + 0.13 * e, ...g.rgb, (1 - u) * 0.9, 1); }
  const still = q.get('cam') === 'still';
  const yaw = still ? -0.22 : -0.22 + 0.35 * Math.sin(time * 0.5);
  const dist = Math.max(1.0 / Math.tan(FOV / 2), 1.12 / (Math.tan(FOV / 2) * (W / H))) + 0.25;
  const vp = multiply(perspective(FOV, W / H, 0.1, 30), orbitView([0.02, -0.02, 0], dist, yaw, 0.1));
  return { view: { vp, px: H / (2 * Math.tan(FOV / 2)), time, ripples: ripples.filter((x) => time - x.t < 2.4), proj: projCur }, sprites: new Float32Array(list), haze };
}

// ---- renderer adapters ----
const canvas = document.getElementById('c');
let W = innerWidth, H = innerHeight;
const dpr = Math.min(DPR_CAP, devicePixelRatio || 1);
let draw, gl = null;
if (R === 'webgl') {
  const rd = new Renderer(canvas, P, { antialias: q.get('aa') !== '0' });
  rd.setNodes(pos, size, shape, proj, state);
  rd.setEdges(edgeVerts, S.edgeHl);
  rd.setFissures(fissures);
  rd.resize(W, H, dpr);
  gl = rd.gl;
  draw = (f) => {
    for (const i of stateDirty) rd.updateState(state, i, i + 1);
    stateDirty = [];
    rd.setSprites(SKIP.has('haze') ? f.sprites.subarray(f.haze * 9) : f.sprites);
    rd.draw(f.view, { staticKey: q.get('cam') === 'still' ? 1 : null, haze: SKIP.has('haze') ? 0 : f.haze, bg: !SKIP.has('bg'), edges: !SKIP.has('edges'), nodes: !SKIP.has('nodes') });
  };
} else if (R === 'canvas') {
  const { CanvasRenderer } = await import('./r-canvas.js');
  const rd = new CanvasRenderer(canvas, S);
  rd.resize(W, H, dpr);
  draw = (f) => { stateDirty = []; rd.draw(f.view, f.sprites, f.haze); };
} else {
  const { ThreeRenderer } = await import('./r-three.js');
  const rd = await ThreeRenderer.create(canvas, S);
  rd.resize(W, H, dpr);
  gl = rd.gl;
  draw = (f) => { rd.updateState(stateDirty); stateDirty = []; rd.draw(f.view, f.sprites, f.haze); };
}

// GPU time per frame where the browser allows it (WebGL timer queries).
const tq = gl && gl.getExtension('EXT_disjoint_timer_query_webgl2');
const queries = [];
const B = (window.__bench = { renderer: R, nodes: N, edges: E, frames: 0, jsMs: 0, gpuMs: 0, gpuFrames: 0, timer: !!tq, firstFrameMs: 0, setMode(m) { mode = m; },
  reset() { this.frames = 0; this.jsMs = 0; this.gpuMs = 0; this.gpuFrames = 0; } });
let last = 0;
function schedule() {
  if (mode === 'timer') setTimeout(() => requestAnimationFrame(frame), Math.max(0, last + 1000 / 30 - performance.now() - 4));
  else requestAnimationFrame(frame);
}
function frame(now) {
  schedule();
  if (mode !== 'max' && now - last < 1000 / 30 - 2) return;
  last = now;
  const s = performance.now();
  const f = step(now);
  let qy = null;
  if (tq) { qy = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, qy); }
  draw(f);
  if (tq) { gl.endQuery(tq.TIME_ELAPSED_EXT); queries.push(qy); }
  B.jsMs += performance.now() - s;
  B.frames++;
  if (!B.firstFrameMs) B.firstFrameMs = performance.now();
  while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const qq = queries.shift(), ns = gl.getQueryParameter(qq, gl.QUERY_RESULT);
    gl.deleteQuery(qq);
    if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { B.gpuMs += ns / 1e6; B.gpuFrames++; }
  }
}
requestAnimationFrame(frame);
