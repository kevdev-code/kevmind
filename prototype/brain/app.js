// Brain prototype: synthetic graph + replay → WebGL2 renderer, with DOM labels, chips, filters, focus and an
// activity trace. Rendering rules: nothing renders while the tab is hidden or another view is shown; frames are
// capped at 30 fps and the loop stops as soon as nothing moves (camera, beams, flashes, Follow, Auto-rotate);
// "Animations off" (or reduced motion) draws single static frames.
import { makeGraph, makeReplay, NODE_TYPES, EDGE_TYPES, rng } from './data.js';
import { layout, lobeAt, shellPoints, shellFilaments, purkinjeTrees, lobeShape, LOBES, BRAIN_CENTER, BRAIN_RADIUS, STEM_AXIS, CALLOSUM, callosumY } from './layout.js';
import { Renderer, oklch, KIND, SHAPE, EDGE, SPRITE, NODE_FLOATS, FIBER_FLOATS, SPRITE_FLOATS, INTRO, perspective, multiply, orbitView } from './gl.js';

const params = new URLSearchParams(location.search);
const TARGET = Number(params.get('nodes')) || 0;
const SPEED = Number(params.get('speed')) || 1;
const SKIP = new Set((params.get('skip') || '').split(',')); // benchmark only: draw without some layers
const SHELL = Number(params.get('shell')) || 1; // checks only: the shell this many times as bright, so its outline reads
// Phones (and ?light) get a lighter brain to save battery: fewer shell dots, 20 frames a second, fewer fiber segments.
const LIGHT = params.has('light') || matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const FRAME_MS = 1000 / (LIGHT ? 20 : 30);
const FOV = (24 * Math.PI) / 180;
const T0 = performance.now();
const $ = (id) => document.getElementById(id);
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---- words ---------------------------------------------------------------------------------------------------
const I18N = {
  en: {
    viewLive: 'Live', viewMemory: 'Memory', viewBrain: 'Brain', prototype: 'Prototype', synthetic: 'synthetic data', filters: 'Filters',
    search: 'Search notes and files', noResults: 'No matches', projects: 'Projects', nodeTypes: 'Node types', edgeTypes: 'Links',
    regions: 'Regions', colors: 'Activity', nodes: 'Nodes', anim: 'Animations', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    fit: 'Fit', relayout: 'Re-layout', follow: 'Follow', rotate: 'Auto-rotate', camera: 'Camera',
    look: 'What to show', labels: 'Labels', cut: 'Cut',
    hint: 'Drag to orbit · Shift-drag to pan · Scroll to zoom toward the cursor · Click a node to focus',
    noWebgl: 'This view needs WebGL 2, which is turned off in this browser.',
    elsewhere: 'Live and Memory are in the real dashboard. This prototype only has the Brain view, and it stops rendering while you are here.',
    t_instruction: 'Instruction files', t_memory: 'Memory notes', t_serena: 'Serena notes', t_file: 'Code files', t_tool: 'Tools',
    e_link: 'Links between notes', e_index: 'Index entries', e_import: 'Imports', e_cites: 'Notes citing code', e_cochange: 'Changed together', e_readfirst: 'Read before edit',
    k_read: 'read', k_edit: 'edit', k_error: 'error', k_command: 'command', k_focus: 'selected', k_agent: 'agent (white core)',
    v_read: 'reads', v_edit: 'edits', v_command: 'runs', v_error: 'failed', thinking: 'thinking', done: 'done', started: 'started',
    working: 'working', idle: 'idle', running: 'running',
    trace: 'Activity, last 5 min', traceAria: (e, t) => `Activity over the last 5 minutes: ${e} events and ${t} thinking tokens.`,
    traceLegend: ['events', 'thinking tokens'],
    counts: (p, n, e) => `${p} ${p === 1 ? 'project' : 'projects'} · ${n.toLocaleString('en')} nodes · ${e.toLocaleString('en')} links`,
    reads: (n) => (n === 1 ? 'read' : 'reads'), edits: (n) => (n === 1 ? 'edit' : 'edits'), uses: (n) => (n === 1 ? 'use' : 'uses'),
    errors: (n) => (n === 1 ? 'error' : 'errors'), links: (n) => (n === 1 ? 'link' : 'links'), tokens: 'tokens', indexed: 'in MEMORY.md', notIndexed: 'not in MEMORY.md',
    last: 'last touched', now: 'now', min: (n) => `${n} min ago`, hr: (n) => `${n} h ago`, day: (n) => `${n} d ago`, never: 'never',
    did: { read: 'read', edit: 'edited', error: 'failed', command: 'ran' },
    neighbors: 'Neighbors', clear: 'Clear', pause: 'Pause replay', play: 'Resume replay', step: (i, n) => `event ${i} of ${n}`,
    regionNames: { Instructions: 'Instructions', Feedback: 'Feedback', Memory: 'Memory', Serena: 'Serena', Tools: 'Tools', '(root)': 'root files' },
    lobes: { prefrontal: ['Prefrontal', 'instructions'], frontal: ['Frontal', 'docs'], parietal: ['Parietal', 'logic'], occipital: ['Occipital', 'interface'],
      temporal: ['Temporal', 'memory'], cerebellum: ['Cerebellum', 'tools and tests'], stem: ['Brainstem', 'infrastructure'] },
    canvas: (p, n, e) => `Brain of ${p} projects: ${n} nodes and ${e} links. Use the search box or the neighbor list to move through it.`,
    shared: 'shared',
  },
  es: {
    viewLive: 'En vivo', viewMemory: 'Memoria', viewBrain: 'Cerebro', prototype: 'Prototipo', synthetic: 'datos sintéticos', filters: 'Filtros',
    search: 'Buscar notas y archivos', noResults: 'Sin resultados', projects: 'Proyectos', nodeTypes: 'Tipos de nodo', edgeTypes: 'Conexiones',
    regions: 'Regiones', colors: 'Actividad', nodes: 'Nodos', anim: 'Animaciones', zoomIn: 'Acercar', zoomOut: 'Alejar',
    fit: 'Encuadrar', relayout: 'Reacomodar', follow: 'Seguir', rotate: 'Girar solo', camera: 'Cámara',
    look: 'Qué mostrar', labels: 'Etiquetas', cut: 'Corte',
    hint: 'Arrastra para orbitar · Mayús + arrastra para mover · Rueda para acercar al cursor · Clic en un nodo para enfocarlo',
    noWebgl: 'Esta vista necesita WebGL 2, que está desactivado en este navegador.',
    elsewhere: 'En vivo y Memoria están en el panel real. Este prototipo solo tiene la vista Cerebro, que deja de dibujarse mientras estás aquí.',
    t_instruction: 'Instrucciones', t_memory: 'Notas de memoria', t_serena: 'Notas de Serena', t_file: 'Archivos de código', t_tool: 'Herramientas',
    e_link: 'Enlaces entre notas', e_index: 'Entradas del índice', e_import: 'Importaciones', e_cites: 'Notas que citan código', e_cochange: 'Cambian juntos', e_readfirst: 'Leído antes de editar',
    k_read: 'lectura', k_edit: 'edición', k_error: 'error', k_command: 'comando', k_focus: 'seleccionado', k_agent: 'agente (núcleo blanco)',
    v_read: 'lee', v_edit: 'edita', v_command: 'ejecuta', v_error: 'falló', thinking: 'pensando', done: 'terminó', started: 'empezó',
    working: 'trabajando', idle: 'inactivo', running: 'en curso',
    trace: 'Actividad, últimos 5 min', traceAria: (e, t) => `Actividad de los últimos 5 minutos: ${e} eventos y ${t} tokens de pensamiento.`,
    traceLegend: ['eventos', 'tokens de pensamiento'],
    counts: (p, n, e) => `${p} ${p === 1 ? 'proyecto' : 'proyectos'} · ${n.toLocaleString('es')} nodos · ${e.toLocaleString('es')} conexiones`,
    reads: (n) => (n === 1 ? 'lectura' : 'lecturas'), edits: (n) => (n === 1 ? 'edición' : 'ediciones'), uses: (n) => (n === 1 ? 'uso' : 'usos'),
    errors: (n) => (n === 1 ? 'error' : 'errores'), links: (n) => (n === 1 ? 'conexión' : 'conexiones'), tokens: 'tokens', indexed: 'en MEMORY.md', notIndexed: 'fuera de MEMORY.md',
    last: 'último uso', now: 'ahora', min: (n) => `hace ${n} min`, hr: (n) => `hace ${n} h`, day: (n) => `hace ${n} d`, never: 'nunca',
    did: { read: 'leído', edit: 'editado', error: 'falló', command: 'ejecutado' },
    neighbors: 'Vecinos', clear: 'Quitar', pause: 'Pausar reproducción', play: 'Reanudar reproducción', step: (i, n) => `evento ${i} de ${n}`,
    regionNames: { Instructions: 'Instrucciones', Feedback: 'Feedback', Memory: 'Memoria', Serena: 'Serena', Tools: 'Herramientas', '(root)': 'archivos raíz' },
    lobes: { prefrontal: ['Prefrontal', 'instrucciones'], frontal: ['Frontal', 'documentos'], parietal: ['Parietal', 'lógica'], occipital: ['Occipital', 'interfaz'],
      temporal: ['Temporal', 'memoria'], cerebellum: ['Cerebelo', 'herramientas y tests'], stem: ['Tronco', 'infraestructura'] },
    canvas: (p, n, e) => `Cerebro de ${p} proyectos: ${n} nodos y ${e} conexiones. Usa la búsqueda o la lista de vecinos para recorrerlo.`,
    shared: 'compartido',
  },
};
let lang = (() => { try { return localStorage.getItem('kevmind.lang'); } catch { return null; } })() || (navigator.language.startsWith('es') ? 'es' : 'en');
let T = I18N[lang];

// ---- colors ------------------------------------------------------------------------------------------------------
const C = (l, c, h) => oklch(l / 100, c, h);
const P = {
  // A deep blue-violet night.
  bg: C(9.5, 0.045, 282), bgCenter: C(19, 0.085, 280), accent: C(74, 0.145, 288),
  // What happened to a node: DESIGN.md's state hues (read, edit, error), command gray, selection violet.
  kinds: [[0, 0, 0], C(76, 0.115, 245), C(77, 0.13, 350), C(72, 0.17, 25), C(72, 0.012, 285), C(74, 0.145, 288)].flat(),
  // The six link types (fainter than before: the tracts carry the structure), the midline, beams, dendrites, tracts
  // and the fixed structures.
  edgeAlpha: [0.2, 0.07, 0.25, 0.14, 0.09, 0.16, 0.5, 1, 0.85, 0.42, 0.4],
  // The shell: a web of thin strands, cool blue-gray with a little violet, with a soft edge and a few sparkling
  // junctions; nodes, tracts and pulses stay brighter.
  dust: C(80, 0.025, 250), dustTint: C(74, 0.07, 292), filCbl: C(93, 0.045, 212), filStem: C(93, 0.05, 250), filAlpha: 0.34 * SHELL, filWidth: LIGHT ? 1.7 : 1.4,
  dustAlpha: 0.3 * SHELL, dustSize: LIGHT ? 0.0145 : 0.0105, dustEdge: 0.5,
  breath: C(82, 0.07, 60), // Claude thinking: a warm cream glow through the whole brain
};
const kindRgb = (k) => P.kinds.slice(KIND[k] * 3, KIND[k] * 3 + 3);
const DENDRITE_ALPHA = P.edgeAlpha[EDGE.dendrite];
// Categorical color per lobe kind: the brain view's one exemption from one-hue-per-meaning (DESIGN.md, Brain view).
// Regions in a lobe shift a little around its hue so neighbors stay apart.
// A tight palette: blue and cyan, violet, pink; the cerebellum and brainstem nearly white.
const LOBE_COLOR = { prefrontal: [80, 0.12, 268], frontal: [74, 0.13, 236], parietal: [71, 0.15, 306], occipital: [77, 0.11, 200],
  temporal: [74, 0.15, 352], cerebellum: [80, 0.09, 205], stem: [82, 0.08, 255] };
// Agents: colored beams with a white core and a numbered label, so they never pass for a region (user's choice).
// Claude itself is coral, its warm color, the one warm hue on screen; subagents are cyan, orchid and ice blue.
const AGENT_HUES = [[74, 0.14, 38], [84, 0.11, 195], [79, 0.13, 322], [88, 0.07, 250]];

// ---- data ----------------------------------------------------------------------------------------------------
const graph = makeGraph({ target: TARGET });
const N = graph.nodes.length;
const nodes = graph.nodes, edges = graph.edges, regions = graph.regions;
let L = layout(graph);
const replay = makeReplay(graph);
const projIndex = new Map(graph.projects.map((p, i) => [p.id, i]));
const at = (i) => [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]];
const stats = nodes.map((n) => ({ reads: n.reads || 0, edits: n.edits || 0, lastAt: n.lastAt || 0 }));
const adj = nodes.map(() => []);
edges.forEach((e, k) => { adj[e.a].push(k); adj[e.b].push(k); });
const lobeOf = (i) => regions[nodes[i].region].lobe;

const regionColor = [], regionCss = [];
{
  const seen = {};
  for (const g of regions) {
    const k = (seen[g.lobe] = (seen[g.lobe] || 0) + 1) - 1;
    const [l, c, h] = LOBE_COLOR[g.lobe];
    const hh = h + [0, 10, -10, 18, -18][k % 5], ll = l + [0, 3, -3][k % 3];
    regionColor[g.id] = C(ll, c, hh);
    regionCss[g.id] = `oklch(${Math.min(88, ll + 6)}% ${c} ${hh})`;
  }
}
const lobeCss = (lobe) => { const [l, c, h] = LOBE_COLOR[lobe]; return `oklch(${l + 4}% ${c} ${h})`; };

const activityOf = (i) => {
  const n = nodes[i];
  if (n.type === 'tool') return n.uses / 10;
  if (n.type === 'file') return stats[i].reads + 2 * stats[i].edits;
  return (n.tokens || 300) / 100 + stats[i].reads + adj[i].length;
};
// Density-adaptive light. Lobes hold very different numbers of nodes per volume (the occipital lobe packs about ten
// times the average, the frontal lobes a sixth of it), and additive light piles up where they crowd. Each lobe gets a
// gain from its density against the average: a dense lobe's cells are dimmer and smaller, a sparse lobe's brighter
// and a little larger, so no area turns into a solid stain and the front reads as evenly as the back. The same nodes,
// lit differently: nothing is added.
const lobeLoad = {};
for (const n of nodes) { const l = regions[n.region].lobe; lobeLoad[l] = (lobeLoad[l] || 0) + 1; }
const avgDensity = N / Object.values(LOBES).reduce((t, s) => t + s.vol, 0);
const gain = Object.fromEntries(Object.entries(LOBES).map(([l, s]) => [l, clamp((avgDensity / ((lobeLoad[l] || 1) / s.vol)) ** 0.6, 0.22, 1.6)]));
const crowdOf = (i) => gain[lobeOf(i)];
// The same for links: where thousands cross, each draws fainter (the six link types; the midline and beams keep theirs).
const linkScale = clamp(Math.sqrt(900 / Math.max(1, edges.length)), 0.5, 1);
P.edgeAlpha = P.edgeAlpha.map((v, k) => (k < 6 ? v * linkScale : v));
// Size grows a little with activity (under 2x from the quietest to the busiest), so no cell dominates.
const sizeOf = (i) => 0.58 * (nodes[i].type === 'instruction' ? 0.08 : 0.05 + 0.0035 * Math.sqrt(Math.min(activityOf(i), 120))) * clamp(crowdOf(i) ** 0.4, 0.65, 1.2);
const brightOf = (i) => 0.8 * (nodes[i].type === 'instruction' ? 1 : 0.55 + 0.45 * Math.min(1, Math.sqrt(activityOf(i) / 70))) * crowdOf(i);

const size = new Float32Array(N), bright = new Float32Array(N);
for (let i = 0; i < N; i++) { size[i] = sizeOf(i); bright[i] = brightOf(i); }
const state = new Float32Array(N * 4); // brightness, ember, ignition time, kind
for (let i = 0; i < N; i++) state[i * 4 + 2] = -100;

// The part of the brain a node is in (0 cerebrum, 1 cerebellum, 2 brainstem): when the intro reaches it.
const partOf = (i) => ({ stem: 2, cerebellum: 1 })[lobeOf(i)] || 0;
function nodeData() {
  const d = new Float32Array(N * NODE_FLOATS);
  for (let i = 0; i < N; i++) {
    const n = nodes[i], seed = (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
    d.set([...at(i), size[i], SHAPE[n.type], n.project == null ? -1 : projIndex.get(n.project), ...regionColor[n.region], Math.abs(seed), partOf(i)], i * NODE_FLOATS);
  }
  return d;
}

// Links as curved fibers. Links inside a region bow gently; links between regions share a control point between the
// two regions, pulled toward the core, so they gather into bundles like white-matter tracts.
const CORE = [0, 0.12, 0];
// A clamped uniform cubic B-spline through control points, as t in [0, 1] → point.
function bspline(P) {
  const Q = [P[0], P[0], ...P, P[P.length - 1], P[P.length - 1]], n = Q.length - 3;
  return (t) => {
    const s = Math.min(n - 1e-9, t * n), i = Math.floor(s), u = s - i, v = 1 - u;
    const w = [v * v * v, 3 * u * u * u - 6 * u * u + 4, -3 * u * u * u + 3 * u * u + 3 * u + 1, u * u * u];
    return [0, 1, 2].map((k) => (w[0] * Q[i][k] + w[1] * Q[i + 1][k] + w[2] * Q[i + 2][k] + w[3] * Q[i + 3][k]) / 6);
  };
}
// The path between points of two regions in different lobes: a B-spline through the lobes' centers and one lane per
// pair of lobes (across hemispheres it crosses the midline high, like the corpus callosum; within one it dips toward
// the core), so fibers gather into bundles and an agent's pulse travels along them.
function laneCurve(lobeA, sa, lobeB, sb, pa, pb) {
  const la = lobeShape(lobeA, sa).c, lb = lobeShape(lobeB, sb).c;
  const m = [0, 1, 2].map((i) => (la[i] + lb[i]) / 2), x = clamp(m[0] * 0.8, CALLOSUM.x0, CALLOSUM.x1);
  // Within a hemisphere the lane arches up and in over the middle, longer lanes higher (like the long association
  // tracts); the brainstem's lanes dip toward the core instead.
  const span = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
  const lane = sa * sb < 0 ? [x, callosumY(x), 0]
    : sa === 0 || sb === 0 ? [0, 1, 2].map((i) => m[i] + (CORE[i] - m[i]) * 0.35)
    : [m[0] * 0.9, Math.min(0.42, Math.max(m[1], CORE[1]) + 0.08 + 0.16 * span), m[2] * 0.7];
  const poly = [pa, la, lane, lb, pb]; // few control points, so the lane bends in long curves, not corners
  return bspline(poly.map((p, i) => [0, 1, 2].map((k) => pa[k] + (pb[k] - pa[k]) * (i / 4) + (p[k] - pa[k] - (pb[k] - pa[k]) * (i / 4)) * 0.85)));
}
const lanePath = (pa, ga, pb, gb) => laneCurve(regions[ga].lobe, L.side[ga], regions[gb].lobe, L.side[gb], pa, pb);
// fiberData(cross, same): segments per curve between regions and inside one.
function fiberData(segCross, segSame) {
  const out = [], owner = [], start = new Int32Array(edges.length), segs = new Int32Array(edges.length);
  edges.forEach((e, k) => {
    start[k] = owner.length;
    const pa = at(e.a), pb = at(e.b), ga = nodes[e.a].region, gb = nodes[e.b].region;
    const mid = [0, 1, 2].map((i) => (pa[i] + pb[i]) / 2);
    let pt;
    if (ga === gb) { // a gentle bow away from the region's center
      const cg = L.centroid[ga], d = [0, 1, 2].map((i) => mid[i] - cg[i]), dl = Math.hypot(...d) || 1, len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const c = [0, 1, 2].map((i) => mid[i] + (d[i] / dl) * len * 0.3);
      pt = (t) => [0, 1, 2].map((i) => (1 - t) * (1 - t) * pa[i] + 2 * (1 - t) * t * c[i] + t * t * pb[i]);
    } else if (regions[ga].lobe === regions[gb].lobe && L.side[ga] === L.side[gb]) {
      const poly = [pa, L.centroid[ga], L.centroid[gb], pb];
      pt = bspline(poly.map((p, i) => [0, 1, 2].map((k) => pa[k] + (pb[k] - pa[k]) * (i / 3) + (p[k] - pa[k] - (pb[k] - pa[k]) * (i / 3)) * 0.85)));
    } else pt = lanePath(pa, ga, pb, gb);
    const S = ga === gb ? segSame : segCross;
    segs[k] = S;
    const ca = regionColor[ga].map((x) => x * 0.95), cb = regionColor[gb].map((x) => x * 0.95);
    const col = (t) => [0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t);
    const pj = nodes[e.a].project != null ? projIndex.get(nodes[e.a].project) : nodes[e.b].project != null ? projIndex.get(nodes[e.b].project) : -1;
    const type = EDGE[e.type];
    let prev = pt(0), dist = 0;
    for (let s = 0; s < S; s++) {
      const p = pt((s + 1) / S), d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      out.push(...prev, ...p, dist, dist + d, ...col(s / S), ...col((s + 1) / S), type, e.type === 'cochange' ? 2.2 : 3.2, 0, 0, pj, 0);
      owner.push(k);
      prev = p; dist += d;
    }
  });
  return { data: new Float32Array(out), owner: Int32Array.from(owner), start, segs };
}

let shellXYZ = new Float32Array(0); // the shell's points, also used to frame the brain
const partY = new Float32Array([9, -9, 9, -9, 9, -9]); // each part's lowest and highest point: the intro's wave
function shellData() {
  const sh = shellPoints(LIGHT ? 12000 : 26000), n = sh.part.length;
  shellXYZ = new Float32Array(n * 4); // x, y, z, part: for framing and the outline
  for (let i = 0; i < n; i++) {
    const y = sh.pos[i * 3 + 1], k = sh.part[i] * 2;
    shellXYZ.set([sh.pos[i * 3], y, sh.pos[i * 3 + 2], sh.part[i]], i * 4);
    partY[k] = Math.min(partY[k], y); partY[k + 1] = Math.max(partY[k + 1], y);
  }
  return { sh, fil: shellFilaments(sh) };
}

// ---- neurons: dendrites and axons ------------------------------------------------------------------------------
// Each node is a neuron: its soma is the sprite; its dendrites and axon are short fibers in the cached layer.
// Pyramidal cells (memory notes, instructions): an apical dendrite toward the surface that forks, two or three basal
// dendrites, an axon down toward the core. Round cells (code files, Serena notes, tools): three or four dendrites
// around and a shorter axon. The main branches (level 0) come first; the forks (level 1) only show zoomed in or
// while the neuron is active (the shader decides), and only the main ones are drawn while the camera moves.
const v3 = {
  add: (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k],
  unit: (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
const neuron = { owner: new Int32Array(0), hl: new Float32Array(0) };
function neuronData() {
  const L0 = [], L1 = [], o0 = [], o1 = [];
  for (let i = 0; i < N; i++) {
    const n = nodes[i], p = at(i), r = rng(i * 7919 + 13), part = partOf(i);
    const pj = n.project == null ? -1 : projIndex.get(n.project);
    const col = regionColor[n.region].map((c) => c * 0.85 + 0.12);
    const seg = (a, b, w, level) => {
      (level ? L1 : L0).push(...a, ...b, 0, 0, ...col, ...col, EDGE.dendrite, w, 0, 0, pj, level + 2 * part);
      (level ? o1 : o0).push(i);
    };
    const u = v3.unit([p[0] * 0.7, p[1] + 0.12, p[2]]); // outward, from the core toward the surface
    const e1 = v3.unit(v3.cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = v3.cross(u, e1);
    const around = (a) => v3.add(v3.add([0, 0, 0], e1, Math.cos(a)), e2, Math.sin(a));
    const jitter = (d, k) => v3.unit(v3.add(d, around(r() * 6.283), k * r()));
    const neg = (d) => d.map((c) => -c);
    const len = size[i] * 2.3 * Math.min(1.2, 0.65 + 0.35 * crowdOf(i)), soma = size[i] * 0.2;
    // A branch stays inside the brain: one that would leave its volume is shortened, or dropped.
    const inside = (a, d, l) => { for (let t = 0; t < 3; t++, l /= 2) if (lobeAt(v3.add(a, d, l))) return l; return 0; };
    const limb = (from, dir, l, w, forks) => {
      l = inside(from, dir, l);
      if (!l) return;
      const to = v3.add(from, dir, l);
      seg(from, to, w, 0);
      for (let k = 0; k < forks; k++) {
        const d = v3.unit(v3.add(dir, around(r() * 6.283), k % 2 ? -0.75 : 0.75)), lf = inside(to, d, l * (0.4 + 0.2 * r()));
        if (lf) seg(to, v3.add(to, d, lf), w * 0.85, 1);
      }
    };
    if (n.type === 'memory' || n.type === 'instruction') {
      limb(v3.add(p, u, soma), jitter(u, 0.25), len * 1.5, 3, 2); // apical
      const basal = n.type === 'instruction' ? 3 : 2, a0 = r() * 6.283;
      for (let k = 0; k < basal; k++) limb(p, v3.unit(v3.add(neg(u).map((c) => c * 0.55), around(a0 + (k * 6.283) / basal))), len * 0.6, 2.6, 1);
      limb(v3.add(p, u, -soma), jitter(neg(u), 0.15), len * 2.2, 2.4, 1); // axon
    } else {
      const k0 = 3 + (r() < 0.5 ? 1 : 0), a0 = r() * 6.283;
      for (let k = 0; k < k0; k++) limb(p, v3.unit(v3.add(around(a0 + (k * 6.283) / k0), u, (r() - 0.35) * 0.9)), len * 0.6, 2.6, 1);
      limb(p, jitter(neg(u), 0.25), len * 1.2, 2.4, 0); // axon
    }
  }
  neuron.owner = Int32Array.from([...o0, ...o1]);
  neuron.hl = new Float32Array(neuron.owner.length);
  neuron.data = new Float32Array([...L0, ...L1]);
  neuron.segsOf = nodes.map(() => []); // each neuron's segments, for the active layer
  neuron.owner.forEach((i, s) => neuron.segsOf[i].push(s));
  return { data: neuron.data };
}

// ---- tracts: the main lanes as thick, glowing bundles, and the fixed structures --------------------------------
// The busiest lanes between lobes become bundles of a few strands that fan out at both ends, along the paths the
// agents' pulses take (across hemispheres, over the corpus callosum's arch). With them, fixed and decorative: the
// corpus callosum itself (strands along its arch), the brainstem as a bright bundle fanning up into both
// hemispheres, and Purkinje cells in the cerebellum. Pulses run along the strands while work goes on.
let tractStrands = []; // [{ pts, rgb, lobes }]: where pulses run
let purkinje = { segs: [], somas: [] };
function tractData() {
  const out = [], hl = [], strands = [], r = rng(23);
  // A strand: segments along the points, fading in and out at its ends (taper) so bundles dissolve into the lobes.
  const strand = (pts, rgb, type, width, core, k, part, lobes, taper = 0.18) => {
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1], pts[j][2] - pts[j - 1][2]));
    const total = cum[cum.length - 1] || 1;
    for (let j = 0; j + 1 < pts.length; j++) {
      const t = (cum[j] + cum[j + 1]) / 2 / total, end = taper ? Math.min(1, Math.min(t, 1 - t) / taper) : 1;
      out.push(...pts[j], ...pts[j + 1], cum[j] / total, cum[j + 1] / total, ...rgb, ...rgb, type, width, core, 0, -1, 2 * part);
      hl.push(k * Math.max(0.02, end * end * (3 - 2 * end)));
    }
    if (lobes) strands.push({ pts, rgb, lobes });
  };
  const white = (c, k) => c.map((v) => v + (1 - v) * k);
  const frame = (d) => { const e1 = v3.unit(v3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); return [e1, v3.cross(d, e1)]; };
  // 1. The busiest lanes, from the links themselves.
  const lanes = new Map();
  let cross = 0, total = 0;
  for (const e of edges) {
    const ga = nodes[e.a].region, gb = nodes[e.b].region, ka = `${regions[ga].lobe}|${L.side[ga]}`, kb = `${regions[gb].lobe}|${L.side[gb]}`;
    if (ka === kb) continue;
    total++;
    if (L.side[ga] * L.side[gb] < 0) cross++;
    const key = ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
    lanes.set(key, (lanes.get(key) || 0) + 1);
  }
  const top = [...lanes].sort((a, b) => b[1] - a[1]).filter(([, c], k) => k < 10 && c >= Math.max(3, total * 0.03));
  const max = top.length ? top[0][1] : 1;
  for (const [key, count] of top) {
    const [[la, sa], [lb, sb]] = key.split('>').map((x) => { const [l, sd] = x.split('|'); return [l, Number(sd)]; });
    const A = lobeShape(la, sa).c, B = lobeShape(lb, sb).c, path = laneCurve(la, sa, lb, sb, A, B), k = Math.sqrt(count / max);
    const ca = C(...LOBE_COLOR[la]), cb = C(...LOBE_COLOR[lb]), rgb = white(ca.map((c, i) => (c + cb[i]) / 2), 0.08);
    const K = 5 + Math.round(3 * k), wMid = 0.01 + 0.012 * k, wEnd = 0.07 + 0.05 * k;
    for (let j = 0; j < K; j++) {
      const a = r() * 6.283, rad = j ? 0.35 + 0.65 * r() : 0, pts = [];
      for (let q = 0; q <= 24; q++) { // the middle 80% of the lane: the bundle fans out and fades before the lobes' centers
        const t = 0.1 + (0.8 * q) / 24, b = path(t), t0 = path(t - 0.01), t1 = path(t + 0.01), s = (t - 0.1) / 0.8;
        const [e1, e2] = frame(v3.unit([t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]])), w = (wMid + (wEnd - wMid) * (1 - Math.sin(Math.PI * s)) ** 2) * rad;
        pts.push(v3.add(v3.add(b, e1, Math.cos(a) * w), e2, Math.sin(a) * w));
      }
      strand(pts, rgb, EDGE.tract, j ? 1.6 + 1.2 * k : 2.4 + 1.6 * k, j ? 0 : 1, (0.45 + 0.55 * k) * (j ? 0.7 : 1), 0, new Set([la, lb]), 0.3);
    }
  }
  // 2. The corpus callosum: strands along its arch, side by side across the midline, brighter the more links cross.
  const cc = C(80, 0.1, 205), kc = 0.45 + 0.55 * Math.min(1, (cross / Math.max(1, total)) * 3);
  for (let j = 0; j < 8; j++) {
    const z = (j - 3.5) * 0.03, dy = (r() - 0.5) * 0.035, pts = [];
    for (let q = 0; q <= 32; q++) { const x = CALLOSUM.x0 + ((CALLOSUM.x1 - CALLOSUM.x0) * q) / 32; pts.push([x, callosumY(x) + dy - Math.abs(z) * 0.4, z]); }
    if (j % 2) pts.reverse(); // half run back to front, so the intro lights it from both ends
    strand(pts, cc, EDGE.tract, j === 3 || j === 4 ? 2.6 : 1.8, j === 3 || j === 4 ? 1 : 0, kc * (j === 3 || j === 4 ? 1 : 0.75), 0, new Set(['prefrontal', 'frontal', 'parietal', 'occipital', 'temporal']), 0.12);
  }
  // 3. The brainstem: a bright bundle up its axis and through the core, fanning into both hemispheres.
  const sb = white(C(...LOBE_COLOR.stem), 0.1), A = STEM_AXIS, perp = [A.dir[1], -A.dir[0], 0];
  for (let j = 0; j < 12; j++) {
    const a = r() * 6.283, rr = A.radius * 0.55 * Math.sqrt(r()), ox = Math.cos(a) * rr, oz = Math.sin(a) * rr, side = j % 2 ? 1 : -1;
    const at0 = v3.add(v3.add(A.bottom, perp, ox), [0, 0, 1], oz), at1 = v3.add(v3.add(A.top, perp, ox), [0, 0, 1], oz);
    const core = [A.top[0] + 0.08, A.top[1] + 0.22, oz * 2 + side * 0.03];
    const to = [-0.22 + r() * 0.45, 0.02 + r() * 0.12, side * (0.12 + r() * 0.14)];
    const path = bspline([at0, v3.add(at0, A.dir, 0.15), at1, core, to]), pts = [];
    for (let q = 0; q <= 28; q++) pts.push(path(q / 28));
    strand(pts, sb, EDGE.structure, j < 4 ? 2.2 : 1.6, j < 4 ? 1 : 0, 0.9, 2, new Set(['stem']), 0.06);
  }
  // 4. Purkinje cells: flat, branching trees in the cerebellum (their somas are sprites).
  purkinje = purkinjeTrees(LIGHT ? 4 : 7);
  const pk = white(C(...LOBE_COLOR.cerebellum), 0.35);
  for (const [a, b, level] of purkinje.segs) { out.push(...a, ...b, 0, 0, ...pk, ...pk, EDGE.structure, level ? 2 : 2.6, 0, 0, -1, level + 2); hl.push(0.8); }
  tractStrands = strands;
  return { data: new Float32Array(out), hl: new Float32Array(hl) };
}
// Where agents work, the shell around their lobe brightens softly, then fades back (eases in 0.6 s, out 2 s).
const shellGlow = new Map();
function glowLayer(now, dt) {
  const want = new Map();
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') want.set(`${lobeOf(a.node)}|${L.side[nodes[a.node].region]}`, 1);
  for (const k of want.keys()) if (!shellGlow.has(k)) shellGlow.set(k, 0);
  const out = [];
  for (const [k, v] of shellGlow) {
    const t = want.get(k) || 0, nv = !anim ? t : v + (t - v) * Math.min(1, dt / (t > v ? 600 : 2000));
    if (Math.abs(t - nv) > 0.01) busy(now + 60); else if (!t) { shellGlow.delete(k); continue; }
    shellGlow.set(k, nv);
    const range = R && R.dustRanges && R.dustRanges.get(k), lobe = k.split('|')[0];
    if (range) out.push({ range, strength: nv, color: P.dust.map((c, i) => c * 0.5 + C(...LOBE_COLOR[lobe])[i] * 0.5) });
  }
  return out;
}

// ---- view state ----------------------------------------------------------------------------------------------
const filter = { projects: new Set(graph.projects.map((p) => p.id)), types: new Set(NODE_TYPES), edges: new Set(EDGE_TYPES) };
const visible = new Uint8Array(N);
let focus = null, focusSet = null, matchSet = null, hover = -1;
let view = 'brain';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let anim = (() => { try { const v = localStorage.getItem('kevmind.brain.anim'); if (v) return v === 'on'; } catch {} return !reduced.matches; })();
const HOME = { yaw: 0.32, pitch: 0.16, zoom: 1, target: [...BRAIN_CENTER] }; // a 3/4 side view: reads as a brain, depth at once
const cam = structuredClone(HOME), goal = structuredClone(HOME), vel = { yaw: 0, pitch: 0 };
let follow = false, autoRotate = false, lastInput = 0, lastEvent = -1e9;
let W = 1, H = 1, VP = null, PX = 1, basis = null, depth = [3, 6], camDirty = true, camVersion = 0, scrVersion = -1, labelsDirty = true;
let staticKey = 0; // bumped whenever the main cache (haze and links over the deep cache) must be redrawn
let deepKey = 0; // bumped whenever the deep cache (ground, shell, dendrites, tracts) must be redrawn
const scr = new Float32Array(N * 3);
const projCur = new Float32Array(32).fill(0.8), projTarget = new Float32Array(32).fill(0.8);
const embers = new Map();
const rings = [];
const flashes = []; // a region glowing where an agent just landed
const signals = []; // small pulses running along fibers around recent work
let lastSignal = 0;
let ripples = [];
let busyUntil = 0;
const busy = (until) => { if (until > busyUntil) busyUntil = until; };
const pulses = []; // pulses running along the tracts
let lastPulse = 0;
// Labels: off at overview (only the agent tags show); on while zoomed in, for the lobe under the pointer, or always
// with the Labels toggle.
let labelsOn = (() => { try { return localStorage.getItem('kevmind.brain.labels') === 'on'; } catch { return false; } })();
let hoverLobe = null;
// The cut: the near hemisphere's cerebrum cut away (its shell gone, its nodes and links dimmed) to show the inside.
let cutOn = false, cutSide = 0, cutChanged = false;
const cutAway = (i) => cutSide !== 0 && partOf(i) === 0 && L.pos[i * 3 + 2] * cutSide > 0.004;
// The intro: once per page load the brain builds itself (gl.js INTRO has the timeline); a click, a drag, the wheel or
// a key skips to the end.
const intro = { on: false, done: false, t0: 0, pulsed: false };
const introAllowed = () => anim && !reduced.matches && !params.has('nointro');
const tSec = (now = performance.now()) => (now - T0) / 1000;

// ---- renderer --------------------------------------------------------------------------------------------------
const canvas = $('brain');
let R = null;
const edgeHl = new Float32Array(edges.length);
// ponytail: two fixed levels; the coarse one exists for software and weak GPUs, where cost grows with segments.
const lod = [{ cross: LIGHT ? 8 : 14, same: 2 }, { cross: 1, same: 1 }].map((x) => ({ ...x, owner: new Int32Array(0), hl: new Float32Array(0) }));
let fine = null; // the smooth fibers, for signals running along them
let tractHl = new Float32Array(0), tractShown = new Float32Array(0);
function uploadGeometry() {
  R.setNodes(nodeData(), state);
  const nd = neuronData();
  R.setLayer('dendrites', nd.data, neuron.hl);
  const td = tractData();
  tractHl = td.hl;
  tractShown = new Float32Array(tractHl);
  R.setLayer('tracts', td.data, tractShown);
  lod.forEach((l, k) => {
    const f = fiberData(l.cross, l.same);
    l.owner = f.owner;
    if (!k) fine = f;
    l.hl = new Float32Array(f.owner.length);
    R.setFibers(f.data, l.hl, k);
  });
}
try {
  R = new Renderer(canvas, P);
  const shell = shellData();
  uploadGeometry();
  R.setDust(shell.sh);
  R.setFilaments(shell.fil);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('noGl').hidden = false; });
} catch (err) {
  console.warn(err);
  $('noGl').hidden = false;
}

// ---- visibility, emphasis, lit paths -----------------------------------------------------------------------------
function nodeBright(i) {
  if (!visible[i]) return 0;
  let b = bright[i];
  if (focusSet) b *= focusSet.has(i) ? 1.4 : 0.14;
  else if (matchSet) b *= matchSet.has(i) ? 1.4 : 0.16;
  if (cutAway(i)) return 0; // the cut-away half: gone, so nothing shows outside the half that stays
  return Math.max(b, 0.002);
}
// Link brightness: hidden, dimmed (focus or search elsewhere), normal, lit where work just happened (embers), focus.
function edgeLights() {
  let shown = 0;
  edges.forEach((e, k) => {
    let v = visible[e.a] && visible[e.b] && filter.edges.has(e.type) ? 1 : 0;
    if (v) shown++;
    if (v && focusSet) v = e.a === focus || e.b === focus ? 3 : 0.12;
    else if (v && matchSet) v = matchSet.has(e.a) && matchSet.has(e.b) ? 1.2 : 0.12;
    else if (v) v = 1 + 1.4 * Math.max(state[e.a * 4 + 1], state[e.b * 4 + 1]);
    if (v && (cutAway(e.a) || cutAway(e.b))) v = 0;
    edgeHl[k] = v;
  });
  lod.forEach((l, k) => {
    for (let s = 0; s < l.owner.length; s++) l.hl[s] = edgeHl[l.owner[s]];
    if (R) R.updateFibers(l.hl, k);
  });
  staticKey++;
  return shown;
}
// The deep cache's lighting, which only filters, focus, search and the cut change. Dendrites: hidden with their
// neuron, dimmed by focus, search and the cut; the focus and its neighbors, and search hits, above 1.5 (full detail
// at any zoom). Tracts dim with focus and search.
function deepLights() {
  for (let s = 0; s < neuron.owner.length; s++) {
    const i = neuron.owner[s];
    let v = visible[i] ? (0.35 + 0.6 * bright[i]) * crowdOf(i) : 0; // crowded lobes: dimmer, like their nodes
    if (v && focusSet) v = focusSet.has(i) ? (i === focus ? 2.6 : 1.7) : 0.12;
    else if (v && matchSet) v = matchSet.has(i) ? 1.7 : 0.12;
    if (cutAway(i)) v = 0;
    neuron.hl[s] = v;
  }
  for (let k = 0; k < tractHl.length; k++) tractShown[k] = tractHl[k] * (focusSet || matchSet ? 0.35 : 1);
  if (R) { R.updateLayer('dendrites', neuron.hl); R.updateLayer('tracts', tractShown); }
  deepKey++;
}
// Active neurons (embers: just read, edited or run): their dendrites in full detail and bright, redrawn every frame
// on top of the cache, so activity never redraws the cache's thousands of dendrites. At most the 40 most recent.
function activeNeurons() {
  if (!R) return;
  const live = [...embers].filter(([i]) => visible[i] && !cutAway(i) && state[i * 4 + 1] > 0).sort((a, b) => b[1].at - a[1].at).slice(0, 40);
  const segs = [], hl = [];
  for (const [i] of live) for (const s of neuron.segsOf[i] || []) {
    segs.push(...neuron.data.subarray(s * FIBER_FLOATS, (s + 1) * FIBER_FLOATS));
    hl.push(1.6 + state[i * 4 + 1]);
  }
  R.setLayer('active', new Float32Array(segs), new Float32Array(hl));
}
function refresh() {
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    visible[i] = filter.types.has(n.type) && (n.project == null ? filter.projects.size > 0 : filter.projects.has(n.project)) ? 1 : 0;
  }
  for (let i = 0; i < N; i++) state[i * 4] = nodeBright(i);
  if (R) R.updateState(state);
  const shown = edgeLights();
  deepLights();
  activeNeurons();
  let n = 0;
  for (let i = 0; i < N; i++) n += visible[i];
  setText($('counts'), T.counts(filter.projects.size, n, shown));
  canvas.setAttribute('aria-label', T.canvas(filter.projects.size, n, shown));
  labelsDirty = true;
  request();
}

// ---- camera: full orbit, inertia, zoom toward the cursor, Fit, Follow, Auto-rotate ------------------------------
const PITCH = 1.35; // just short of the poles, so the view never flips
const FIT = { dist: 5, target: [...BRAIN_CENTER] };
let cardShift = [0, 0, 0];
// The shell's extent across the view from an angle (orthographic, in brain units), parts as listed.
function extent(yaw, pitch, parts = [0, 1, 2]) {
  const b = orbitView(BRAIN_CENTER, 5, yaw, pitch);
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
  for (let i = 0; i < shellXYZ.length; i += 4) {
    if (!parts.includes(shellXYZ[i + 3])) continue;
    const d = [shellXYZ[i] - BRAIN_CENTER[0], shellXYZ[i + 1] - BRAIN_CENTER[1], shellXYZ[i + 2] - BRAIN_CENTER[2]];
    const px = d[0] * b.x[0] + d[1] * b.x[1] + d[2] * b.x[2], py = d[0] * b.y[0] + d[1] * b.y[1] + d[2] * b.y[2];
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { b, x0, x1, y0, y1 };
}
// Where the camera looks and how far it stands so the whole brain fits the well from an angle, with a margin.
function fitFor(yaw, pitch) {
  const { b, x0, x1, y0, y1 } = extent(yaw, pitch), t = Math.tan(FOV / 2);
  return {
    target: [0, 1, 2].map((a) => BRAIN_CENTER[a] + b.x[a] * (x0 + x1) / 2 + b.y[a] * (y0 + y1) / 2),
    dist: Math.max((y1 - y0) / 2 / t, (x1 - x0) / 2 / (t * (W / H))) * 1.1 + 0.45, // margin, and the near half is bigger
  };
}
function frameBrain() {
  const old = [...HOME.target], f = fitFor(HOME.yaw, HOME.pitch);
  FIT.target = f.target;
  FIT.dist = f.dist;
  HOME.target = [...FIT.target];
  if (goal.target.every((v, a) => Math.abs(v - old[a] - cardShift[a]) < 1e-6)) { // not moved by hand: follow the new frame
    goal.target = FIT.target.map((v, a) => v + cardShift[a]);
    cam.target = [...goal.target];
  }
}
const fitDist = () => FIT.dist;
function updateCamera() {
  const dist = fitDist() * cam.zoom;
  basis = orbitView(cam.target, dist, cam.yaw, cam.pitch);
  basis.dist = dist;
  VP = multiply(perspective(FOV, W / H, 0.1, 40), basis);
  PX = H / (2 * Math.tan(FOV / 2));
  const wc = project(BRAIN_CENTER)[2];
  depth = [wc - BRAIN_RADIUS, wc + BRAIN_RADIUS];
  const cs = cutOn ? (basis.eye[2] >= BRAIN_CENTER[2] ? 1 : -1) : 0; // the cut takes the hemisphere facing the camera
  if (cs !== cutSide) { cutSide = cs; cutChanged = true; }
  camVersion++;
  labelsDirty = true;
  camDirty = false;
  staticKey++; deepKey++;
}
function project(p) {
  const m = VP;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [((x / w + 1) / 2) * W, ((1 - y / w) / 2) * H, w];
}
function screenPositions() { // for picking, only when asked after the camera moved
  if (scrVersion === camVersion || !VP) return;
  scrVersion = camVersion;
  for (let i = 0; i < N; i++) { const p = project(at(i)); scr[i * 3] = p[0]; scr[i * 3 + 1] = p[1]; scr[i * 3 + 2] = p[2]; }
}
const angleTo = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
let rotateTimer = 0;
function camStep(now, dt) {
  let moving = false;
  if (!drag && (Math.abs(vel.yaw) > 2e-5 || Math.abs(vel.pitch) > 2e-5)) {
    if (anim) {
      cam.yaw += vel.yaw * dt;
      cam.pitch = clamp(cam.pitch + vel.pitch * dt, -PITCH, PITCH);
      const k = Math.exp(-dt / 260);
      vel.yaw *= k; vel.pitch *= k;
      goal.yaw = cam.yaw; goal.pitch = cam.pitch;
      moving = true;
    } else vel.yaw = vel.pitch = 0;
  }
  if (autoRotate && anim && !drag) {
    const wake = Math.max(lastInput + 3000, lastEvent + 4000) - now;
    if (wake <= 0) { cam.yaw += 0.00012 * dt; goal.yaw = cam.yaw; moving = true; }
    else if (!rotateTimer) rotateTimer = setTimeout(() => { rotateTimer = 0; request(); }, wake + 20);
  }
  const k = anim ? 1 - Math.exp(-dt / 140) : 1;
  const ease = (obj, key, eps) => {
    const d = goal[key] - cam[key];
    if (Math.abs(d) > eps) { cam[key] += d * k; moving = true; } else cam[key] = goal[key];
  };
  goal.yaw = angleTo(cam.yaw, goal.yaw);
  ease(cam, 'zoom', 0.0005); ease(cam, 'yaw', 0.0005); ease(cam, 'pitch', 0.0005);
  for (let a = 0; a < 3; a++) {
    const d = goal.target[a] - cam.target[a];
    if (Math.abs(d) > 0.0005) { cam.target[a] += d * k; moving = true; } else cam.target[a] = goal.target[a];
  }
  if (moving) camDirty = true;
  return moving;
}
// Follow: the camera eases toward where agents are working, and back to the whole brain when the session is idle.
function followGoal() {
  if (!follow) return;
  const pts = [...agents.values()].filter((a) => a.pos && a.status !== 'done' && !(a.hideAt && performance.now() > a.hideAt)).map((a) => a.node != null ? at(a.node) : a.pos);
  if (pts.length && session.status === 'working') {
    goal.target = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
    goal.zoom = 0.62;
  } else { goal.target = [...HOME.target]; goal.zoom = 1; }
  request();
}

// ---- agents, beams, embers ---------------------------------------------------------------------------------------
const agents = new Map();
const session = { status: 'idle', project: replay.project };
function agentOf(id) {
  let a = agents.get(id);
  if (!a) {
    const def = replay.agents.find((x) => x.id === id);
    const hue = AGENT_HUES[agents.size % AGENT_HUES.length];
    a = { id, def, css: `oklch(${hue[0]}% ${hue[1]} ${hue[2]})`, rgb: C(...hue), status: 'idle', node: null, pos: null, comet: null, after: null, kind: '', text: '', chip: null, li: null, hideAt: 0 };
    agents.set(id, a);
  }
  return a;
}
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const cometHead = (c, now) => c.pt(ease(clamp((now - c.t0) / c.dur, 0, 1)));
const animating = () => anim && R && !document.hidden && view === 'brain';
const thinking = () => { for (const a of agents.values()) if (a.kind === 'think' && a.status !== 'done') return true; return false; };

function onEvent(ev) {
  const now = performance.now();
  lastEvent = now;
  trace.add(ev, now);
  const a = agentOf(ev.agent);
  const main = agentOf('main');
  if (ev.kind === 'start') {
    a.status = ev.agent === 'main' ? 'working' : 'running';
    a.hideAt = 0;
    if (ev.agent === 'main') {
      session.status = 'working';
      setProjectActive(session.project);
      const start = nodes.findIndex((n) => n.project === session.project && n.type === 'instruction');
      a.node = start; a.pos = at(start);
    } else {
      a.node = main.node; a.pos = main.comet ? cometHead(main.comet, now) : main.pos;
      if (animating()) { rings.push({ p: a.pos, t0: now, dur: 800, rgb: a.rgb, s: 0.7 }); busy(now + 800); }
    }
    a.kind = 'start'; a.text = T.started;
  } else if (ev.kind === 'stop') {
    if (a.comet) arrive(a, false);
    a.status = 'done'; a.kind = 'done'; a.text = T.done;
    a.hideAt = now + 2600;
    setTimeout(() => { labelsDirty = true; followGoal(); request(); }, 2700);
    if (ev.agent === 'main') { session.status = 'idle'; setProjectActive(null); }
  } else if (ev.kind === 'think') {
    a.kind = 'think'; a.text = T.thinking;
    if (animating() && a.pos) { ripples.push({ p: a.pos, t: tSec(now), c: a.rgb }); busy(now + 2500); }
  } else {
    a.kind = ev.kind;
    a.text = ev.text;
    if (a.comet) arrive(a, false); // a new action before the last beam landed: land it now
    const to = at(ev.node);
    if (!animating() || !a.pos) { a.comet = { to, node: ev.node, kind: ev.kind }; arrive(a, false); }
    else {
      // Between lobes the pulse travels the fiber lane; inside one lobe it arcs over the surface.
      const from = a.pos, d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const ga = a.node != null ? nodes[a.node].region : null, gb = nodes[ev.node].region;
      let pt;
      if (ga != null && (regions[ga].lobe !== regions[gb].lobe || L.side[ga] !== L.side[gb])) pt = lanePath(from, ga, to, gb);
      else {
        const mid = [0, 1, 2].map((i) => (from[i] + to[i]) / 2), out = [0, 1, 2].map((i) => mid[i] - CORE[i]), ol = Math.hypot(...out) || 1;
        const ctrl = [0, 1, 2].map((i) => mid[i] + (out[i] / ol) * (0.18 + d * 0.35));
        pt = (t) => [0, 1, 2].map((k) => (1 - t) * (1 - t) * from[k] + 2 * (1 - t) * t * ctrl[k] + t * t * to[k]);
      }
      a.comet = { from, to, pt, t0: now, dur: 620 + 580 * Math.min(1, d / 1.2), node: ev.node, kind: ev.kind };
      busy(now + a.comet.dur + 40);
    }
  }
  renderNow();
  followGoal();
  labelsDirty = true;
  request();
}

function arrive(a, animate) {
  const c = a.comet, i = c.node, now = performance.now();
  a.comet = null; a.node = i; a.pos = at(i);
  if (animate && c.from) { a.after = { c, t0: now }; busy(now + 480); } // the beam lingers a moment after landing
  if (c.kind === 'read') stats[i].reads++;
  if (c.kind === 'edit') stats[i].edits++;
  stats[i].lastAt = Date.now();
  size[i] = sizeOf(i); bright[i] = brightOf(i);
  if (R) R.setSize(i, size[i]);
  embers.set(i, { kind: c.kind, at: Date.now() });
  state[i * 4] = nodeBright(i); state[i * 4 + 1] = 1; state[i * 4 + 2] = animate ? tSec(now) : -100; state[i * 4 + 3] = KIND[c.kind];
  if (R) R.updateState(state, i, i + 1);
  if (animate) { rings.push({ p: a.pos, t0: now, dur: 750, rgb: kindRgb(c.kind) }); flashes.push({ g: nodes[i].region, t0: now }); busy(now + 1700); }
  cooling();
  activeNeurons();
  if (focus === i) renderFocus();
  labelsDirty = true;
  followGoal();
}

// Embers cool in steps (1, 5, 15 min), checked every 15 s, so a cooling node costs one frame per step.
let coolTimer = 0;
function cooling() {
  if (coolTimer) return;
  coolTimer = setTimeout(() => {
    coolTimer = 0;
    const now = Date.now();
    let changed = false;
    for (const [i, e] of embers) {
      const age = (now - e.at) / 1000;
      const s = age < 60 ? 1 : age < 300 ? 0.55 : age < 900 ? 0.28 : 0;
      if (state[i * 4 + 1] !== s) { state[i * 4 + 1] = s; changed = true; if (R) R.updateState(state, i, i + 1); }
      if (!s) { embers.delete(i); state[i * 4 + 3] = 0; }
    }
    if (changed) { activeNeurons(); request(); }
    if (embers.size) cooling();
  }, 15000);
}

function setProjectActive(id) {
  projTarget.fill(0.8); // idle: calm and a little dim
  if (id != null) { projTarget.fill(0.5); projTarget[projIndex.get(id)] = 1.15; }
  if (!animating()) projCur.set(projTarget);
  busy(performance.now() + 900);
  renderProjects();
}

// ---- frame loop ------------------------------------------------------------------------------------------------
let raf = 0, lastFrame = 0, wasMoving = false;
function request() {
  if (!raf && R && view === 'brain' && !document.hidden) raf = requestAnimationFrame(frame);
}
// The clock starts once the first two frames are drawn: the first one draws the caches in full (and compiles shaders
// in a fresh browser), which can take a moment on a slow machine, and that moment shouldn't eat the opening.
function startIntro(now) { intro.on = true; intro.t0 = null; intro.warm = 0; busy(now + INTRO.end * 1000 + 600); }
function endIntro() {
  if (intro.done) return;
  intro.on = false; intro.done = true;
  staticKey++;
  labelsDirty = true;
  startReplay();
  request();
}
// The shaders' intro clock and the closing wave's radius.
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function introView(clock) {
  const u = (clock - INTRO.wave[0]) / INTRO.wave[1];
  return [clock, u >= 0 && u <= 1 ? u * BRAIN_RADIUS * 1.25 : -9, -9, 0];
}
function frame(now) {
  raf = 0;
  if (!R || view !== 'brain' || document.hidden) return;
  if (!intro.done && !intro.on) { if (introAllowed()) startIntro(now); else endIntro(); }
  // 30 fps cap; about 12 when only Claude's breath moves
  if (anim && now - lastFrame < (now < busyUntil || wasMoving || drag ? FRAME_MS : 80) - 2) { raf = requestAnimationFrame(frame); return; }
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  let clock = 99; // the intro's clock (s); 99 once it's over
  if (intro.on) {
    clock = intro.t0 == null ? 0 : (now - intro.t0) / 1000;
    if (clock >= INTRO.end) { endIntro(); clock = 99; } else busy(now + 50);
  }
  for (let k = 0; k < 32; k++) {
    const d = projTarget[k] - projCur[k];
    if (Math.abs(d) > 0.002) { projCur[k] += anim ? d * Math.min(1, dt / 220) : d; staticKey++; } else projCur[k] = projTarget[k];
  }
  for (const a of agents.values()) if (a.comet && (!anim || now >= a.comet.t0 + a.comet.dur)) arrive(a, anim);
  const moving = camStep(now, dt) || !!(drag && drag.moved);
  if (camDirty) updateCamera();
  if (cutChanged) { cutChanged = false; refresh(); }
  if (wasMoving && !moving) staticKey++; // the camera stopped: redraw the static layers with smooth fibers
  wasMoving = moving;
  const time = tSec(now);
  ripples = ripples.filter((r) => time - r.t < 2.4);
  for (let k = rings.length - 1; k >= 0; k--) if (now - rings[k].t0 > rings[k].dur) rings.splice(k, 1);
  const haze = buildSprites(now, clock);
  R.setBeams(buildBeams(now));
  // Neurons: faint dendrites at overview, full ones zoomed in (active neurons are always full, through their hl).
  P.edgeAlpha[EDGE.dendrite] = DENDRITE_ALPHA * (0.3 + 0.7 * smooth(1, 0.5, cam.zoom));
  const mid = project(BRAIN_CENTER); // the brain's center and radius on screen, for the intro's closing waves
  R.draw({ vp: VP, px: PX, time, ripples, proj: projCur, depth, eye: basis.eye, intro: introView(clock), yr: partY, center: BRAIN_CENTER, cut: cutSide, life: anim ? 1 : 0,
    mid, radiusPx: (BRAIN_RADIUS * PX) / mid[2], waveR: BRAIN_RADIUS },
  { haze, deepKey, mainKey: staticKey, skip: SKIP, lod: moving && !intro.on ? 1 : 0, glow: glowLayer(now, dt), introOn: intro.on });
  if (intro.on && intro.t0 == null && ++intro.warm >= 2) intro.t0 = performance.now();
  if (labelsDirty) layoutLabels();
  placeChips(now);
  if (anim && (now < busyUntil || moving || thinking() || intro.on)) request();
}

// Haze per region and the lit lobes (cached layer), then agent heads, markers and rings.
let spriteData = new Float32Array(0), heatSig = '', heatShown = {}, heatAt = -1e9, heatTimer = 0;
const PK_RGB = C(88, 0.07, 205), STEM_RGB = C(90, 0.05, 245), CBL_GLOW = C(78, 0.07, 208);
function buildSprites(now, clock = 99) {
  const list = [];
  for (const g of regions) {
    const n = L.count[g.id];
    if (n < 3 || (g.project != null && !filter.projects.has(g.project))) continue;
    const pf = g.project == null ? 1 : projCur[projIndex.get(g.project)];
    list.push(...L.centroid[g.id], clamp(L.spread[g.id] * 3.6, 0.12, 0.45), ...regionColor[g.id], 0.035 * pf * pf * Math.min(1, gain[g.lobe]) * (focusSet || matchSet ? 0.35 : 1), SPRITE.glow);
  }
  for (const p of purkinje.somas) list.push(...p, 0.025, ...PK_RGB, 0.35, SPRITE.glow, ...p, 0.009, ...PK_RGB, 0.6, SPRITE.head);
  // The cerebellum's soft glow: its folia read as a solid structure, not a wire frame.
  for (const sd of [1, -1]) { const c = lobeShape('cerebellum', sd).c; list.push(c[0], c[1], c[2] * 0.8, 0.62, ...CBL_GLOW, 0.05, SPRITE.glow); }
  // The lit lobe: where agents are, or recently were, the lobe glows in its color and cools with the embers. It is
  // in the cached layer, so it follows the work at most every 2 s (and links lit by embers update with it).
  const heat = {};
  const key = (i) => `${lobeOf(i)}|${L.side[nodes[i].region]}`;
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') heat[key(a.node)] = 1;
  for (const [i] of embers) heat[key(i)] = Math.max(heat[key(i)] || 0, state[i * 4 + 1] * 0.6);
  const sig = Object.entries(heat).map(([l, h]) => l + h.toFixed(2)).sort().join() + '/' + [...embers.keys()].map((i) => state[i * 4 + 1]).join();
  if (sig !== heatSig && now - heatAt > 2000) { heatSig = sig; heatAt = now; heatShown = heat; edgeLights(); }
  else if (sig !== heatSig && !heatTimer) heatTimer = setTimeout(() => { heatTimer = 0; request(); }, 2100 - (now - heatAt));
  for (const [k, h] of Object.entries(heatShown)) {
    const [lobe, side] = k.split('|'), s = lobeShape(lobe, Number(side)), [l, c, hh] = LOBE_COLOR[lobe];
    list.push(...s.c, Math.max(...s.r) * 2.8, ...C(l, c, hh), 0.075 * h, SPRITE.glow);
  }
  const haze = list.length / SPRITE_FLOATS;
  for (const a of agents.values()) {
    if (!a.pos || (a.hideAt && now > a.hideAt)) continue;
    const fade = a.status === 'done' ? 0.5 : 1;
    if (a.comet) list.push(...cometHead(a.comet, now), 0.075, ...a.rgb, 1, SPRITE.head);
    else list.push(...a.pos, 0.1, ...a.rgb, 0.75 * fade, SPRITE.ring, ...a.pos, 0.045, ...a.rgb, 0.9 * fade, SPRITE.head);
  }
  for (const r of rings) {
    const u = (now - r.t0) / r.dur, e = 1 - (1 - u) ** 3;
    list.push(...r.p, (0.06 + 0.16 * e) * (r.s || 1), ...r.rgb, (1 - u) * 0.9, SPRITE.ring);
  }
  for (let k = flashes.length - 1; k >= 0; k--) {
    const fl = flashes[k], u = (now - fl.t0) / 1400;
    if (u >= 1 || !anim) { flashes.splice(k, 1); continue; }
    list.push(...L.centroid[fl.g], clamp(L.spread[fl.g] * 3.4, 0.16, 0.5), ...regionColor[fl.g], 0.16 * (1 - u) ** 2, SPRITE.glow);
  }
  // While events keep coming (the last 3 s), signals run along the links of what was just touched, toward it.
  if (anim && fine && now - lastEvent < 3000 && now - lastSignal > 200 && signals.length < 8 && embers.size) {
    lastSignal = now;
    const recent = [...embers].sort((x, y) => y[1].at - x[1].at).slice(0, 6), [i] = recent[Math.floor(Math.random() * recent.length)];
    const ks = adj[i].filter((k) => edgeHl[k] > 0);
    if (ks.length) {
      const k = ks[Math.floor(Math.random() * ks.length)];
      signals.push({ k, toB: edges[k].b === i, t0: now, rgb: regionColor[nodes[i].region] });
      busy(now + 950);
    }
  }
  for (let s = signals.length - 1; s >= 0; s--) {
    const sg = signals[s], u = (now - sg.t0) / 900;
    if (u >= 1) { signals.splice(s, 1); continue; }
    const v = sg.toB ? u : 1 - u, n = fine.segs[sg.k], j = Math.min(n - 1, Math.floor(v * n)), w = v * n - j, o = (fine.start[sg.k] + j) * FIBER_FLOATS;
    const p = [0, 1, 2].map((q) => fine.data[o + q] + (fine.data[o + 3 + q] - fine.data[o + q]) * w);
    list.push(...p, 0.03, ...sg.rgb, 0.85 * Math.sin(Math.PI * u), SPRITE.head);
  }
  // The intro: a seed of light at the brainstem's base and a ring of it spreading out; then, as the tracts light up,
  // a pulse shoots along some of their strands.
  if (intro.on && clock < 0.7) {
    const u = clock / 0.7, b = STEM_AXIS.bottom;
    list.push(...b, 0.05 + 0.22 * Math.sin(Math.PI * Math.min(1, clock / 0.55)), ...STEM_RGB, 0.9 * (1 - u), SPRITE.glow);
    list.push(...b, 0.04 + 0.9 * (1 - (1 - u) ** 3), ...STEM_RGB, 0.75 * (1 - u) ** 2, SPRITE.ring);
  }
  if (intro.on && !intro.pulsed && clock > INTRO.tracts[0]) {
    intro.pulsed = true;
    for (const s of tractStrands) if (Math.random() < 0.4) pulses.push({ s, t0: now + Math.random() * 200, dur: INTRO.tracts[1] * 1000 + 150, back: false });
  }
  // While work goes on (events in the last 3 s), pulses run along the tracts that touch the lobe just worked on.
  if (anim && tractStrands.length && embers.size && now - lastEvent < 3000 && now - lastPulse > 300 && pulses.length < 6) {
    lastPulse = now;
    let last = -1, lastAt = -1;
    for (const [i, e] of embers) if (e.at > lastAt) { lastAt = e.at; last = i; }
    const near = tractStrands.filter((s) => s.lobes.has(lobeOf(last))), from = near.length ? near : tractStrands;
    pulses.push({ s: from[Math.floor(Math.random() * from.length)], t0: now, dur: 900 + Math.random() * 400, back: Math.random() < 0.5 });
    busy(now + 1400);
  }
  for (let k = pulses.length - 1; k >= 0; k--) {
    const pu = pulses[k], u = (now - pu.t0) / pu.dur;
    if (u >= 1 || !anim) { pulses.splice(k, 1); continue; }
    if (u < 0) continue;
    const pts = pu.s.pts, f = (pu.back ? 1 - u : u) * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)), w = f - j;
    list.push(pts[j][0] + (pts[j + 1][0] - pts[j][0]) * w, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * w, pts[j][2] + (pts[j + 1][2] - pts[j][2]) * w, 0.04, ...pu.s.rgb, 0.9 * Math.sin(Math.PI * u), SPRITE.head);
  }
  // Claude thinking: a slow, warm breath through the whole brain (still, with animations off).
  if (thinking()) list.push(BRAIN_CENTER[0], BRAIN_CENTER[1] + 0.12, 0, 1.25, ...P.breath, anim ? 0.035 + 0.04 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 4200)) : 0.05, SPRITE.glow);
  if (focus != null) list.push(...at(focus), size[focus] * 1.6, ...P.accent, 0.95, SPRITE.ring);
  if (list.length > spriteData.length) spriteData = new Float32Array(list.length * 2);
  spriteData.set(list);
  R.setSprites(spriteData.subarray(0, list.length));
  return haze;
}

// Beams: a white-cored ribbon in the agent's color from where it was to where it goes, drawn up to the head.
let beamData = new Float32Array(0);
function buildBeams(now) {
  const out = [];
  const ribbon = (c, t0, t1, alphaAt, rgb) => {
    const S = 16;
    for (let s = 0; s < S; s++) {
      const ta = t0 + ((t1 - t0) * s) / S, tb = t0 + ((t1 - t0) * (s + 1)) / S;
      out.push(...c.pt(ta), ...c.pt(tb), 0, 0, ...rgb, ...rgb, EDGE.beam, 16, 1, Math.max(0.004, alphaAt((ta + tb) / 2)), -1, 0);
    }
  };
  for (const a of agents.values()) {
    if (a.comet && a.comet.from) {
      const head = ease(clamp((now - a.comet.t0) / a.comet.dur, 0, 1)), tail = Math.max(0, head - 0.6);
      if (head > tail) ribbon(a.comet, tail, head, (t) => 0.95 * ((t - tail) / (head - tail)) ** 1.5, a.rgb);
    } else if (a.after) {
      const age = (now - a.after.t0) / 480;
      if (age >= 1) a.after = null;
      else ribbon(a.after.c, 0.4, 1, (t) => 0.7 * (1 - age) * ((t - 0.4) / 0.6), a.rgb);
    }
  }
  if (out.length > beamData.length) beamData = new Float32Array(out.length * 2);
  beamData.set(out);
  return beamData.subarray(0, out.length);
}

// ---- labels and chips (DOM over the canvas) ----------------------------------------------------------------------
const labelBox = $('labels'), chipBox = $('chips');
function regionName(g) {
  if (T.regionNames[g.label]) return T.regionNames[g.label];
  if (g.project == null) return g.label; // the shared ~/.claude
  const parts = g.label.split('/');
  return parts[parts.length - 1] === 'api' || parts[parts.length - 1] === '__tests__' ? parts.slice(-2).join('/') : parts[parts.length - 1];
}
// Lobe labels: one per lobe, at the projected center of its nodes in both hemispheres, so they follow the anatomy in
// every view. The lobe once, small, and under it its groups in their region colors, the most important first (where
// agents work, the focused node's region, the working project, then size), names deduplicated across projects. When
// that spot is taken (another label, a panel, an agent), the label moves outside the brain's outline, straight out
// from the brain's center, with a leader line back to the lobe's center.
const lobeEls = new Map();
let chipBoxes = [];
const chipLines = { svg: null, key: '' };
const NS = 'http://www.w3.org/2000/svg';
const leaders = document.createElementNS(NS, 'svg');
leaders.setAttribute('class', 'leaders');
labelBox.prepend(leaders);
chipLines.svg = document.createElementNS(NS, 'svg');
chipLines.svg.setAttribute('class', 'leaders chip-leaders');
chipBox.prepend(chipLines.svg);
const leaderEls = new Map();
// The outline: the farthest projected shell point from the outline's center, in 48 directions.
function silhouette() {
  const pts = [];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < shellXYZ.length; i += 20) {
    const p = project([shellXYZ[i], shellXYZ[i + 1], shellXYZ[i + 2]]);
    if (p[2] <= 0) continue;
    pts.push(p);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = new Float32Array(48);
  for (const p of pts) {
    const b = Math.round((Math.atan2(p[1] - cy, p[0] - cx) / (2 * Math.PI)) * 48 + 48) % 48;
    rad[b] = Math.max(rad[b], Math.hypot(p[0] - cx, p[1] - cy));
  }
  const at = (a) => { const b = Math.round((a / (2 * Math.PI)) * 48 + 48) % 48; return Math.max(rad[b], rad[(b + 1) % 48], rad[(b + 47) % 48]); };
  return { cx, cy, at };
}
function layoutLabels() {
  labelsDirty = false;
  // The panels over the well count as taken, so no label hides under them (read before this function writes anything).
  const wr = $('well').getBoundingClientRect();
  const taken = ['now', 'trace', 'focusCard'].map($).concat([...document.querySelectorAll('.seg.camera, .overlay.tl, .overlay.tr')]).filter((el) => el && !el.hidden && el.offsetParent)
    .map((el) => { const r = el.getBoundingClientRect(); return [r.left - wr.left, r.top - wr.top, r.width, r.height]; });
  const hit = (x, y, w, h, list) => list.some((r) => x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + h);
  const live = new Set();
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') live.add(nodes[a.node].region);
  const wc = project(BRAIN_CENTER)[2];
  const byLobe = new Map();
  for (const g of regions) {
    if (!L.count[g.id] || (g.project != null && !filter.projects.has(g.project))) continue;
    let pr = L.count[g.id];
    if (g.project === session.project && session.status === 'working') pr += 200;
    if (live.has(g.id)) pr += 1000;
    if (focus != null && nodes[focus].region === g.id) pr += 2000;
    if (!byLobe.has(g.lobe)) byLobe.set(g.lobe, []);
    byLobe.get(g.lobe).push([g, pr]);
  }
  const cands = [...byLobe].map(([lobe, list]) => {
    list.sort((x, y) => y[1] - x[1]);
    const c = [0, 0, 0];
    let n = 0;
    for (const [g] of list) { const k = L.count[g.id]; n += k; for (let a = 0; a < 3; a++) c[a] += L.centroid[g.id][a] * k; }
    const names = [], seen = new Set();
    for (const [g] of list) { const nm = regionName(g); if (!seen.has(nm)) { seen.add(nm); names.push([nm, g.id]); } }
    return { lobe, top: list[0][1], live: list.some(([, pr]) => pr >= 1000), at: project(c.map((v) => v / n)), names };
  }).sort((x, y) => y.top - x.top)
    // A lobe on the far side of the brain (prefrontal from the back) has no label, unless agents work there.
    .filter((c) => c.live || c.at[2] - wc < 0.25 * BRAIN_RADIUS)
    // At overview, only the lobe under the pointer; all of them zoomed in or with the Labels toggle; none in the intro.
    .filter((c) => !intro.on && (labelsOn || cam.zoom < 0.72 || c.lobe === hoverLobe));
  const keep = new Set();
  const show = W < 520 ? 2 : 3;
  const agentsAt = [];
  for (const a of agents.values()) if (a.pos && !(a.hideAt && performance.now() > a.hideAt)) { const p = project(a.pos); agentsAt.push([p[0] - 18, p[1] - 18, 36, 36]); }
  for (const b of chipBoxes) agentsAt.push(b);
  const sil = silhouette();
  const inWell = (x, y, w, h) => x >= 8 && x + w <= W - 8 && y >= 8 && y + h <= H - 8;
  const clear = (x, y, w, h) => inWell(x, y, w, h) && !hit(x - 3, y - 3, w + 6, h + 6, taken) && !hit(x, y, w, h, agentsAt);
  for (const c of cands) {
    const [la, lb] = T.lobes[c.lobe];
    const small = `${la} · ${lb}`;
    const list = c.names.slice(0, show), more = c.names.length - list.length;
    const html = `<small>${esc(small)}</small><span class="groups">${list.map(([nm, id]) => `<b style="color:${regionCss[id]}">${esc(nm)}</b>`).join('<i>·</i>')}${more > 0 ? `<i>+${more}</i>` : ''}</span>`;
    const text = list.map(([nm]) => nm).join(' · ') + (more > 0 ? ` +${more}` : '');
    const w = Math.max(small.length * 6.3, text.length * 7.4) + 14, h = 36;
    const [ax, ay] = c.at;
    let pick = null, lead = false;
    if (c.at[2] > 0) {
      // On the center, or just beside it (a short leader once it no longer covers the center)...
      for (const [dx, dy] of [[0, 0], [w * 0.3, 0], [-w * 0.3, 0], [0, -h * 0.8], [0, h * 0.8], [0, -h * 1.6], [0, h * 1.6], [0, -h * 2.4], [0, h * 2.4]]) {
        const x = ax - w / 2 + dx, y = ay - h / 2 + dy;
        if (clear(x, y, w, h)) { pick = [x, y]; lead = Math.abs(dy) > h / 2; break; }
      }
      // ...else outside the outline on the lobe's own side (within 70 degrees), where the leader is shortest.
      const base = Math.atan2(ay - sil.cy, ax - sil.cx);
      for (let k = -6, best = Infinity; !pick && k <= 6; k++) {
        const an = base + (k * Math.PI) / 16, dx = Math.cos(an), dy = Math.sin(an);
        const d = sil.at(an) + 12 + (Math.abs(dx) * w) / 2 + (Math.abs(dy) * h) / 2;
        const x = sil.cx + dx * d - w / 2, y = sil.cy + dy * d - h / 2;
        if (!clear(x, y, w, h)) continue;
        const len = Math.hypot(clamp(ax, x, x + w) - ax, clamp(ay, y, y + h) - ay);
        if (len < best) { best = len; c.out = [x, y]; }
      }
      if (!pick && c.out) { pick = c.out; lead = true; }
    }
    let line = leaderEls.get(c.lobe);
    if (!pick) { if (line && line.style.display !== 'none') line.style.display = 'none'; continue; }
    const [x, y] = pick;
    let el = lobeEls.get(c.lobe);
    if (!el) { el = document.createElement('span'); el.className = 'lbl lobe'; lobeEls.set(c.lobe, el); labelBox.append(el); }
    if (el._html !== html) { el._html = html; el.innerHTML = html; }
    el.classList.toggle('on', c.live);
    if (el.hidden) el.hidden = false;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el._box = [x, y, w, h];
    taken.push([x - 3, y - 3, w + 6, h + 6]);
    keep.add(c.lobe);
    if (!line) {
      line = document.createElementNS(NS, 'g');
      line.innerHTML = '<line></line><circle r="2.5"></circle>';
      line.style.color = lobeCss(c.lobe);
      leaderEls.set(c.lobe, line);
      leaders.append(line);
    }
    line.style.display = lead ? '' : 'none';
    if (lead) { // from the lobe's center to the nearest point of the label
      const ex = clamp(ax, x, x + w), ey = clamp(ay, y, y + h), [ln, dot] = line.children;
      ln.setAttribute('x1', ax.toFixed(1)); ln.setAttribute('y1', ay.toFixed(1)); ln.setAttribute('x2', ex.toFixed(1)); ln.setAttribute('y2', ey.toFixed(1));
      dot.setAttribute('cx', ax.toFixed(1)); dot.setAttribute('cy', ay.toFixed(1));
    }
  }
  for (const [k, el] of lobeEls) if (!keep.has(k) && !el.hidden) el.hidden = true;
  for (const [k, g] of leaderEls) if (!keep.has(k) && g.style.display !== 'none') g.style.display = 'none';
}
function placeChips(now) {
  const placed = [];
  const compact = W < 520;
  for (const a of agents.values()) {
    const show = a.pos && !(a.hideAt && now > a.hideAt + 400);
    if (!a.chip) {
      if (!show) continue;
      a.chip = document.createElement('span');
      a.chip.className = 'chip';
      a.chip.innerHTML = `<span class="dot" style="--agent:${a.css}"></span><span class="who"></span><span class="k"></span><code></code>`;
      chipBox.append(a.chip);
    }
    a.chip.hidden = !show;
    if (!show) continue;
    a.chip.classList.toggle('gone', !!(a.hideAt && now > a.hideAt));
    const p = project(a.comet && a.comet.from ? cometHead(a.comet, now) : a.pos);
    const [, who, k, code] = a.chip.children;
    const verb = { read: T.v_read, edit: T.v_edit, command: T.v_command, error: T.v_error, think: T.thinking, done: T.done, start: T.started }[a.kind] || '';
    const label = a.id === 'main' ? a.def.label : a.def.label.split(' ')[0]; // "#1": the number that ties chip, beam and panel
    const key = `${label}|${verb}|${a.kind}|${a.text}|${compact}|${a.def.type}`;
    if (a.chipKey !== key) {
      a.chipKey = key;
      setText(who, compact || a.id === 'main' ? label : `${label} ${a.def.type}`);
      setText(k, compact ? '' : verb);
      k.className = `k ${a.kind}`;
      setText(code, !compact && ['read', 'edit', 'command', 'error'].includes(a.kind) ? a.text : '');
      a.chipW = 0;
    }
    placed.push([a, p[0], p[1]]);
  }
  placed.sort((x, y) => x[2] - y[2]);
  for (const [a] of placed) if (!a.chipW) a.chipW = a.chip.offsetWidth || 160; // reads after all text writes: one layout at most
  // Agents close together (within 70 px) share one stack of chips, top to bottom in their order on screen, so tags
  // never overlap; a stack of several gets a thin line from each chip to its agent. Each stack takes the first spot
  // around its group (up-right, up-left, down-right, down-left) that covers no label and no other stack; lobe labels
  // keep their place and give way only when no spot is free.
  const hit = (b, o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3];
  const labels = [...lobeEls.values()].filter((el) => !el.hidden && el._box).map((el) => el._box);
  const groups = [];
  for (const it of placed) {
    const g = groups.find((q) => q.some(([, x, y]) => Math.hypot(x - it[1], y - it[2]) < 70));
    if (g) g.push(it); else groups.push([it]);
  }
  const boxes = [], lines = [];
  for (const g of groups) {
    const cx = g.reduce((t, it) => t + it[1], 0) / g.length, top = Math.min(...g.map((it) => it[2])), bot = Math.max(...g.map((it) => it[2]));
    const w = Math.max(...g.map(([a]) => a.chipW)), h = g.length * 25 - 3, gap = g.length > 1 ? 26 : 14;
    const spots = [[cx + gap, top - h - 8], [cx - w - gap, top - h - 8], [cx + gap, bot + 10], [cx - w - gap, bot + 10]].map(([x, y]) => [clamp(x, 8, W - w - 8), clamp(y, 8, H - h - 8), w, h]);
    let b = spots.find((s) => !labels.some((l) => hit(s, l)) && !boxes.some((o) => hit(s, o)));
    if (!b) { b = spots[0]; for (const o of boxes) if (hit(b, o)) b = [b[0], o[1] + o[3] + 3, w, h]; }
    boxes.push(b);
    g.forEach(([a, px, py], k) => {
      const y = b[1] + k * 25;
      a.chip.style.transform = `translate3d(${Math.round(b[0])}px, ${Math.round(y)}px, 0)`;
      if (g.length > 1) lines.push([px, py, b[0] + (b[0] > px ? 0 : a.chipW), y + 11, a.css]);
    });
  }
  chipBoxes = boxes;
  // The stacks' lines to their agents (reused SVG lines, written only when they change).
  const key = lines.map((l) => l.map((v) => (typeof v === 'number' ? Math.round(v) : v)).join()).join(';');
  if (key !== chipLines.key) {
    chipLines.key = key;
    while (chipLines.svg.children.length < lines.length) chipLines.svg.append(document.createElementNS(NS, 'line'));
    [...chipLines.svg.children].forEach((ln, k) => {
      const l = lines[k];
      ln.style.display = l ? '' : 'none';
      if (!l) return;
      ln.setAttribute('x1', l[0].toFixed(1)); ln.setAttribute('y1', l[1].toFixed(1)); ln.setAttribute('x2', l[2].toFixed(1)); ln.setAttribute('y2', l[3].toFixed(1));
      ln.style.color = l[4];
    });
  }
  // A label only gives way where a chip had nowhere else to go.
  const busyBoxes = boxes;
  for (const el of lobeEls.values()) {
    const b = el._box, under = !el.hidden && !!b && busyBoxes.some((o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3]);
    if (el._under !== under) { el._under = under; el.classList.toggle('under', under); }
  }
}

// ---- the agents panel ------------------------------------------------------------------------------------------
// The focus card stops above the agents panel, whatever its height, so live status stays visible.
new ResizeObserver(([e]) => $('now').parentElement.style.setProperty('--now-h', `${Math.ceil(e.borderBoxSize[0].blockSize)}px`)).observe($('now'));
function renderNow() {
  const st = $('nowStatus');
  st.className = `status ${session.status}`;
  setText($('nowStatusText'), session.status === 'working' ? T.working : T.idle);
  setText($('nowProject'), session.project);
  const ul = $('agentList');
  for (const a of agents.values()) {
    if (!a.li) {
      a.li = document.createElement('li');
      a.li.innerHTML = `<span class="sw" style="--agent:${a.css}"></span><span class="lb"></span><span class="st"></span><span class="act"></span>`;
      ul.append(a.li);
    }
    const [, lb, stt, act] = a.li.children;
    setText(lb, a.def.label);
    setText(stt, a.status === 'done' ? T.done : a.status === 'idle' ? T.idle : a.id === 'main' ? T.working : T.running);
    const verb = { read: T.v_read, edit: T.v_edit, command: T.v_command, error: T.v_error, think: T.thinking, start: T.started }[a.kind] || '';
    setText(act, ['read', 'edit', 'command', 'error'].includes(a.kind) ? `${verb} ${a.text}` : a.kind === 'done' ? (a.def.task || T.done) : verb || a.def.task || '');
    a.li.className = a.status === 'done' ? 'done' : '';
  }
}

// ---- the activity trace: events and thinking tokens over the last 5 minutes (real data only) --------------------
const trace = {
  items: [], timer: 0, canvas: $('eeg'),
  add(ev, now) { this.items.push({ t: now, think: ev.kind === 'think', tokens: ev.tokens || 0 }); this.draw(); },
  stateAt(now) {
    const last = this.items[this.items.length - 1];
    if (!last || now - last.t > 15000) return 'idle';
    return this.items.some((x) => x.think && now - x.t < 6000) ? 'thinking' : 'working';
  },
  draw() {
    if (document.hidden || view !== 'brain') return;
    const now = performance.now(), span = 300000, B = 120, step = span / B;
    this.items = this.items.filter((x) => now - x.t < span);
    const ev = new Float32Array(B), tk = new Float32Array(B);
    let events = 0, tokens = 0;
    for (const x of this.items) {
      const b = Math.min(B - 1, Math.floor((B - 1) - (now - x.t) / step));
      ev[b]++; tk[b] += x.tokens; events++; tokens += x.tokens;
    }
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(c);
    const maxE = Math.max(3, ...ev), maxT = Math.max(800, ...tk), base = h - 3;
    g.fillStyle = cs.getPropertyValue('--trace-think');
    g.beginPath(); g.moveTo(0, base);
    for (let b = 0; b < B; b++) g.lineTo((b / (B - 1)) * w, base - (tk[b] / maxT) * (h - 8));
    g.lineTo(w, base); g.closePath(); g.fill();
    g.strokeStyle = cs.getPropertyValue('--trace-line');
    g.lineWidth = 1.25;
    g.beginPath();
    for (let b = 0; b < B; b++) { const x = (b / (B - 1)) * w, y = base - (ev[b] / maxE) * (h - 8); b ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    const st = this.stateAt(now);
    $('trace').className = `trace ${st}`;
    setText($('traceState'), T[st]);
    c.setAttribute('aria-label', T.traceAria(events, tokens));
    // It scrolls (every 2 s) only while something happened in the last 30 s; then it stays still.
    clearTimeout(this.timer);
    const last = this.items[this.items.length - 1];
    if (last && now - last.t < 30000) this.timer = setTimeout(() => this.draw(), 2000);
  },
};

// ---- filters, search, focus, tooltip -----------------------------------------------------------------------------
const SHAPE_SVG = {
  file: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/>',
  instruction: '<path d="M8 2.5L13.5 8L8 13.5L2.5 8Z" fill="currentColor"/>',
  memory: '<path d="M8 3L13.5 12.5H2.5Z" fill="currentColor"/>',
  serena: '<rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/>',
  tool: '<circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const shapeIcon = (t) => `<svg viewBox="0 0 16 16" aria-hidden="true">${SHAPE_SVG[t]}</svg>`;
const lineIcon = (t) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 11Q8 2 15 11" fill="none" stroke="currentColor" stroke-width="1.5" ${t === 'cochange' ? 'stroke-dasharray="2.5 2"' : ''}/></svg>`;

function renderFilters() {
  const typeCount = Object.fromEntries(NODE_TYPES.map((t) => [t, nodes.filter((n) => n.type === t).length]));
  const edgeCount = Object.fromEntries(EDGE_TYPES.map((t) => [t, edges.filter((e) => e.type === t).length]));
  $('typeList').innerHTML = NODE_TYPES.map((t) => `<li><label><input type="checkbox" data-type="${t}" ${filter.types.has(t) ? 'checked' : ''}>${shapeIcon(t)}<span class="nm">${esc(T['t_' + t])}</span><span class="n">${typeCount[t]}</span></label></li>`).join('');
  $('edgeList').innerHTML = EDGE_TYPES.map((t) => `<li><label><input type="checkbox" data-edge="${t}" ${filter.edges.has(t) ? 'checked' : ''}>${lineIcon(t)}<span class="nm">${esc(T['e_' + t])}</span><span class="n">${edgeCount[t]}</span></label></li>`).join('');
  $('regionLegend').innerHTML = Object.keys(LOBES).map((l) => `<li><span class="dot" style="background:${lobeCss(l)}"></span>${esc(T.lobes[l][1])} <small>${esc(T.lobes[l][0])}</small></li>`).join('');
  $('kindLegend').innerHTML = ['read', 'edit', 'error', 'command', 'focus'].map((k) => `<li><span class="dot ${k === 'focus' ? 'sel' : k}"></span>${esc(T['k_' + k])}</li>`).join('') +
    `<li class="wide"><span class="dot agent"></span>${esc(T.k_agent)}</li>`;
  renderProjects();
}
function renderProjects() {
  const count = Object.fromEntries(graph.projects.map((p) => [p.id, nodes.filter((n) => n.project === p.id).length]));
  const html = graph.projects.map((p) => {
    const working = session.status === 'working' && session.project === p.id;
    return `<li><label><input type="checkbox" data-project="${esc(p.id)}" ${filter.projects.has(p.id) ? 'checked' : ''}><span class="dot" style="background:${working ? 'var(--working)' : 'var(--done)'}" title="${working ? T.working : T.idle}"></span><span class="nm">${esc(p.name)}${working ? ` <span class="n">· ${esc(T.working)}</span>` : ''}</span><span class="n">${count[p.id]}</span></label></li>`;
  }).join('');
  if ($('projectList').innerHTML !== html) $('projectList').innerHTML = html;
}
$('rail').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.type) t.checked ? filter.types.add(t.dataset.type) : filter.types.delete(t.dataset.type);
  else if (t.dataset.edge) t.checked ? filter.edges.add(t.dataset.edge) : filter.edges.delete(t.dataset.edge);
  else if (t.dataset.project) t.checked ? filter.projects.add(t.dataset.project) : filter.projects.delete(t.dataset.project);
  else return;
  if (focus != null && !visible[focus]) setFocus(null);
  refresh();
});

const search = $('search');
function runSearch() {
  const q = search.value.trim().toLowerCase();
  const ul = $('results');
  if (!q) { matchSet = null; ul.innerHTML = ''; refresh(); return; }
  const hits = [];
  for (let i = 0; i < N; i++) if (visible[i] && (nodes[i].name.toLowerCase().includes(q) || nodes[i].path.toLowerCase().includes(q))) hits.push(i);
  hits.sort((a, b) => activityOf(b) - activityOf(a));
  matchSet = new Set(hits);
  ul.innerHTML = hits.length ? hits.slice(0, 8).map((i) => nodeButton(i)).join('') : `<li class="none">${esc(T.noResults)}</li>`;
  refresh();
}
const nodeButton = (i) => `<li><button type="button" data-node="${i}">${shapeIcon(nodes[i].type)}<span class="nm">${esc(nodes[i].name)}</span><span class="pj">${esc(nodes[i].project || T.shared)} · ${esc(nodes[i].path)}</span></button></li>`;
search.addEventListener('input', runSearch);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && matchSet && matchSet.size) { e.preventDefault(); /* or this Enter's keypress clicks the button focus moves to */ setFocus([...matchSet].sort((a, b) => activityOf(b) - activityOf(a))[0], true); }
  if (e.key === 'Escape') { search.value = ''; runSearch(); }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-node]');
  if (b) setFocus(Number(b.dataset.node), true); // from a list: keyboard focus follows into the neighbors
  if (e.target.closest('#clearFocus')) setFocus(null);
});
document.addEventListener('keydown', (e) => {
  if (intro.on) endIntro();
  if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  if (e.key === 'Escape' && focus != null) setFocus(null);
});

function frameForCard(open) {
  if (!basis) return;
  const k = (2 * Math.tan(FOV / 2) * basis.dist) / H, px = open && W > 900 ? ($('focusCard').offsetWidth + 24) / 2 : 0;
  const shift = basis.x.map((v) => v * px * k);
  goal.target = goal.target.map((v, a) => v - cardShift[a] + shift[a]);
  cardShift = shift;
  request();
}
function setFocus(i, moveFocus = false) {
  const card = $('focusCard');
  const wasInCard = card.contains(document.activeElement);
  focus = i;
  focusSet = null;
  if (i != null) {
    focusSet = new Set([i]);
    for (const k of adj[i]) if (filter.edges.has(edges[k].type)) { focusSet.add(edges[k].a); focusSet.add(edges[k].b); }
  }
  renderFocus();
  frameForCard(i != null);
  refresh();
  if (moveFocus && i != null) (card.querySelector('.nbrs button') || card.querySelector('#clearFocus'))?.focus({ preventScroll: true });
  else if (i == null && wasInCard) search.focus({ preventScroll: true });
}
const ago = (ms) => {
  if (!ms) return T.never;
  const s = (Date.now() - ms) / 1000;
  return s < 60 ? T.now : s < 3600 ? T.min(Math.round(s / 60)) : s < 86400 ? T.hr(Math.round(s / 3600)) : T.day(Math.round(s / 86400));
};
function nodeInfo(i) {
  const n = nodes[i], st = stats[i], g = regions[n.region];
  const kind = `${shapeIcon(n.type)}${esc(T['t_' + n.type])} · <span style="color:${regionCss[g.id]}">${esc(T.lobes[g.lobe][1])}</span> · ${esc(n.project || T.shared)}`;
  const bits = [];
  if (n.type === 'tool') bits.push(`<span><b>${n.uses}</b> ${T.uses(n.uses)}</span>`, `<span><b>${n.errors}</b> ${T.errors(n.errors)}</span>`);
  else {
    bits.push(`<span><b>${st.reads}</b> ${T.reads(st.reads)}</span>`);
    if (n.type === 'file') bits.push(`<span><b>${st.edits}</b> ${T.edits(st.edits)}</span>`);
    if (n.tokens) bits.push(`<span><b>${n.tokens.toLocaleString(lang)}</b> ${T.tokens}</span>`);
    if (n.type === 'memory' && n.noteType !== 'index') bits.push(`<span>${adj[i].some((k) => edges[k].type === 'index') ? T.indexed : T.notIndexed}</span>`);
  }
  bits.push(`<span><b>${adj[i].length}</b> ${T.links(adj[i].length)}</span>`);
  const em = embers.get(i);
  bits.push(em ? `<span class="ember ${em.kind}">${T.did[em.kind]} ${ago(em.at)}</span>` : `<span>${T.last} ${ago(st.lastAt)}</span>`);
  return `<div class="nname">${esc(n.name)}</div><div class="nkind">${kind}</div>${n.type !== 'tool' ? `<div class="npath">${esc(n.path)}</div>` : ''}<div class="nstats">${bits.join('')}</div>`;
}
function renderFocus() {
  const card = $('focusCard');
  if (focus == null) { card.hidden = true; card.innerHTML = ''; return; }
  const groups = new Map();
  for (const k of adj[focus]) {
    const e = edges[k];
    if (!filter.edges.has(e.type)) continue;
    const other = e.a === focus ? e.b : e.a;
    if (!visible[other]) continue;
    if (!groups.has(e.type)) groups.set(e.type, []);
    groups.get(e.type).push(other);
  }
  let total = 0;
  for (const g of groups.values()) total += g.length;
  card.innerHTML = `<button type="button" class="btn x" id="clearFocus">${esc(T.clear)}</button>${nodeInfo(focus)}` +
    `<div class="nbrs"><div class="head">${esc(T.neighbors)} <small>${total}</small></div>` +
    [...groups].map(([t, list]) => `<h3>${esc(T['e_' + t])}</h3><ul>${list.slice(0, 30).map(nodeButton).join('')}</ul>`).join('') + '</div>';
  card.hidden = false;
}

// ---- pointer: orbit with inertia, pan, zoom toward the cursor, hover, click --------------------------------------
let drag = null;
function pick(x, y) {
  screenPositions();
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (!visible[i] || scr[i * 3 + 2] <= 0 || cutAway(i)) continue;
    const dx = scr[i * 3] - x, dy = scr[i * 3 + 1] - y, d2 = dx * dx + dy * dy;
    const r = Math.max(7, (size[i] * PX) / scr[i * 3 + 2] * 0.2 + 3);
    const score = d2 + (scr[i * 3 + 2] - depth[0]) * 12; // the nearer of two overlapping stars wins
    if (d2 < r * r && score < bd) { bd = score; best = i; }
  }
  return best;
}
// The lobe under the pointer: the nearest node's, within 64 px.
function lobeNear(x, y) {
  screenPositions();
  let best = null, bd = 64 * 64;
  for (let i = 0; i < N; i++) {
    if (!visible[i] || scr[i * 3 + 2] <= 0 || cutAway(i)) continue;
    const dx = scr[i * 3] - x, dy = scr[i * 3 + 1] - y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = lobeOf(i); }
  }
  return best;
}
function setHoverLobe(l) { if (l !== hoverLobe) { hoverLobe = l; labelsDirty = true; request(); } }
canvas.addEventListener('pointerdown', (e) => {
  if (intro.on) endIntro();
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, pan: e.shiftKey || e.button === 2 };
  vel.yaw = vel.pitch = 0;
  lastInput = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    canvas.classList.add('dragging');
    const dtEv = Math.max(8, now - drag.t);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    lastInput = now;
    if (drag.pan) {
      const k = (2 * Math.tan(FOV / 2) * basis.dist) / H;
      for (let a = 0; a < 3; a++) goal.target[a] = cam.target[a] = cam.target[a] - basis.x[a] * dx * k + basis.y[a] * dy * k;
    } else {
      const dyaw = -dx * 0.0065, dpitch = dy * 0.005;
      cam.yaw += dyaw; cam.pitch = clamp(cam.pitch + dpitch, -PITCH, PITCH);
      goal.yaw = cam.yaw; goal.pitch = cam.pitch;
      vel.yaw = vel.yaw * 0.6 + (dyaw / dtEv) * 0.4; vel.pitch = vel.pitch * 0.6 + (dpitch / dtEv) * 0.4;
    }
    hideTip();
    camDirty = true;
    request();
    return;
  }
  const i = pick(e.clientX - r.left, e.clientY - r.top);
  setHoverLobe(i >= 0 ? lobeOf(i) : lobeNear(e.clientX - r.left, e.clientY - r.top));
  if (i !== hover) {
    hover = i;
    canvas.classList.toggle('over', i >= 0);
    if (i >= 0) { $('tip').innerHTML = nodeInfo(i); $('tip').hidden = false; } else hideTip();
  }
  if (i >= 0) {
    const tip = $('tip'), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
    if (x + tw > W - 8) x = e.clientX - r.left - tw - 12;
    if (y + th > H - 8) y = e.clientY - r.top - th - 12;
    tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }
});
const hideTip = () => { $('tip').hidden = true; hover = -1; canvas.classList.remove('over'); };
canvas.addEventListener('pointerleave', () => { if (!drag) { hideTip(); setHoverLobe(null); } });
canvas.addEventListener('pointerup', (e) => {
  const was = drag;
  drag = null;
  canvas.classList.remove('dragging');
  if (!was) return;
  if (!was.moved) {
    const r = canvas.getBoundingClientRect();
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    setFocus(i >= 0 ? i : null);
    return;
  }
  if (performance.now() - was.t > 80) vel.yaw = vel.pitch = 0; // held still before letting go: no throw
  request();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function zoomAt(f, mx = W / 2, my = H / 2) {
  const nz = clamp(goal.zoom * f, 0.2, 2.8), t = Math.tan(FOV / 2), dist = fitDist() * goal.zoom;
  if (basis) {
    const nx = (mx / W) * 2 - 1, ny = 1 - (my / H) * 2;
    const P3 = [0, 1, 2].map((a) => goal.target[a] + basis.x[a] * nx * t * (W / H) * dist + basis.y[a] * ny * t * dist);
    goal.target = [0, 1, 2].map((a) => clamp(goal.target[a] + (P3[a] - goal.target[a]) * (1 - nz / goal.zoom), -1.6, 1.6));
  }
  goal.zoom = nz;
  lastInput = performance.now();
  hideTip();
  request();
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (intro.on) endIntro();
  const r = canvas.getBoundingClientRect();
  zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
$('zoomIn').addEventListener('click', () => zoomAt(0.8));
$('zoomOut').addEventListener('click', () => zoomAt(1.25));
$('fitBtn').addEventListener('click', () => { vel.yaw = vel.pitch = 0; cardShift = [0, 0, 0]; Object.assign(goal, structuredClone(HOME)); frameForCard(focus != null); lastInput = performance.now(); request(); });
$('followBtn').addEventListener('click', (e) => {
  follow = !follow;
  e.currentTarget.setAttribute('aria-pressed', String(follow));
  if (follow) followGoal(); else { goal.target = [...HOME.target]; goal.zoom = 1; request(); }
});
$('rotateBtn').addEventListener('click', (e) => {
  autoRotate = !autoRotate;
  e.currentTarget.setAttribute('aria-pressed', String(autoRotate));
  try { localStorage.setItem('kevmind.brain.rotate', autoRotate ? 'on' : 'off'); } catch {}
  lastInput = 0;
  request();
});
// Re-layout: lay out again what the filters show, with a new seed, behind a short fade.
$('relayoutBtn').addEventListener('click', () => {
  if (!R) return;
  canvas.classList.add('fading');
  setTimeout(() => {
    const old = L.pos;
    L = layout(graph, { seed: (Math.random() * 1e9) | 0, visible });
    for (let i = 0; i < N; i++) if (!visible[i]) for (let a = 0; a < 3; a++) L.pos[i * 3 + a] = old[i * 3 + a];
    uploadGeometry();
    for (const a of agents.values()) { if (a.comet) arrive(a, false); if (a.node != null) a.pos = at(a.node); a.after = null; }
    refresh();
    camDirty = true;
    canvas.classList.remove('fading');
    request();
  }, anim ? 170 : 0);
});

new ResizeObserver(() => {
  const r = $('well').getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  if (R) R.resize(W, H, Math.min(2, devicePixelRatio || 1));
  frameBrain();
  camDirty = true;
  request();
}).observe($('well'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; return; }
  for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; } // what happened while hidden lands at once
  rings.length = 0; ripples = [];
  trace.draw();
  request();
});

// ---- switches: animations, view, theme, language, prototype controls --------------------------------------------
const animSwitch = $('animSwitch');
function setAnim(on, save) {
  anim = on;
  animSwitch.setAttribute('aria-checked', String(on));
  if (save) try { localStorage.setItem('kevmind.brain.anim', on ? 'on' : 'off'); } catch {}
  if (!on) {
    endIntro();
    pulses.length = 0;
    for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; }
    rings.length = 0; ripples = [];
    vel.yaw = vel.pitch = 0;
    for (let i = 0; i < N; i++) state[i * 4 + 2] = -100;
    projCur.set(projTarget);
    if (R) R.updateState(state);
  }
  request();
}
animSwitch.addEventListener('click', () => setAnim(!anim, true));
reduced.addEventListener('change', () => { try { if (localStorage.getItem('kevmind.brain.anim')) return; } catch {} setAnim(!reduced.matches, false); });

function setView(v) {
  view = v;
  for (const b of $('viewGroup').children) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  $('brainView').hidden = v !== 'brain';
  $('elsewhere').hidden = v === 'brain';
  if (v !== 'brain') { cancelAnimationFrame(raf); raf = 0; hideTip(); if (intro.on) endIntro(); }
  else { for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; } trace.draw(); request(); }
}
$('viewGroup').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

function setTheme(t) {
  try { localStorage.setItem('kevmind.theme', t); } catch {}
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  for (const b of $('themeGroup').children) b.setAttribute('aria-pressed', String(b.dataset.themeSet === t));
}
$('themeGroup').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.themeSet); });

function applyLang(l) {
  lang = l; T = I18N[l];
  document.documentElement.lang = l;
  try { localStorage.setItem('kevmind.lang', l); } catch {}
  for (const el of document.querySelectorAll('[data-i18n]')) setText(el, T[el.dataset.i18n]);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = T[el.dataset.i18nPlaceholder];
  for (const el of document.querySelectorAll('[data-i18n-label]')) { el.setAttribute('aria-label', T[el.dataset.i18nLabel]); el.title = T[el.dataset.i18nLabel]; }
  for (const b of $('langGroup').children) b.setAttribute('aria-pressed', String(b.dataset.lang === l));
  $('traceLegend').innerHTML = `<span class="ev">${esc(T.traceLegend[0])}</span><span class="tk">${esc(T.traceLegend[1])}</span>`;
  renderFilters();
  renderNow();
  renderFocus();
  renderReplay();
  trace.draw();
  if (search.value) runSearch(); else refresh();
}
$('langGroup').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) applyLang(b.dataset.lang); });

for (const b of $('sizeGroup').children) {
  b.setAttribute('aria-pressed', String(Number(b.dataset.size) === TARGET || (!TARGET && b.dataset.size === '0')));
  b.addEventListener('click', () => { const u = new URL(location.href); if (b.dataset.size === '0') u.searchParams.delete('nodes'); else u.searchParams.set('nodes', b.dataset.size); location.href = u; });
}

// ---- replay ----------------------------------------------------------------------------------------------------
const rp = { t0: performance.now(), idx: 0, paused: false, pausedAt: 0, timer: 0 };
function renderReplay() {
  setText($('replayBtn'), rp.paused ? T.play : T.pause);
  setText($('replayClock'), T.step(rp.idx, replay.events.length));
}
function nextEvent() {
  clearTimeout(rp.timer);
  if (rp.paused) return;
  const elapsed = (performance.now() - rp.t0) * SPEED;
  const ev = replay.events[rp.idx];
  if (!ev) { rp.timer = setTimeout(restartReplay, Math.max(0, (replay.length - elapsed) / SPEED)); return; }
  rp.timer = setTimeout(() => { onEvent(ev); rp.idx++; renderReplay(); nextEvent(); }, Math.max(0, (ev.at - elapsed) / SPEED));
}
// The replay starts once the intro is over (or skipped).
function startReplay() {
  if (params.has('noreplay')) return;
  rp.t0 = performance.now(); rp.idx = 0;
  nextEvent();
}
function restartReplay() {
  for (const a of agents.values()) { a.chip?.remove(); a.li?.remove(); }
  agents.clear();
  rp.t0 = performance.now(); rp.idx = 0;
  renderReplay();
  nextEvent();
}
$('replayBtn').addEventListener('click', () => {
  rp.paused = !rp.paused;
  if (rp.paused) rp.pausedAt = performance.now();
  else { rp.t0 += performance.now() - rp.pausedAt; nextEvent(); }
  renderReplay();
});

// ---- start -----------------------------------------------------------------------------------------------------
if (matchMedia('(max-width: 900px)').matches) $('filters').open = false; // phones: the brain first, filters on demand
try { if (localStorage.getItem('kevmind.brain.rotate') === 'on') { autoRotate = true; $('rotateBtn').setAttribute('aria-pressed', 'true'); } } catch {}
setTheme((() => { try { return localStorage.getItem('kevmind.theme') || 'system'; } catch { return 'system'; } })());
setAnim(anim, false);
applyLang(lang);
setView('brain');
if (!R) endIntro(); // no WebGL: no intro, the panels still follow the replay
// Labels and Cut: two toggles next to the animations switch.
const labelsBtn = $('labelsBtn'), cutBtn = $('cutBtn');
labelsBtn.setAttribute('aria-pressed', String(labelsOn));
labelsBtn.addEventListener('click', () => {
  labelsOn = !labelsOn;
  labelsBtn.setAttribute('aria-pressed', String(labelsOn));
  try { localStorage.setItem('kevmind.brain.labels', labelsOn ? 'on' : 'off'); } catch {}
  labelsDirty = true;
  request();
});
cutBtn.addEventListener('click', () => {
  cutOn = !cutOn;
  cutBtn.setAttribute('aria-pressed', String(cutOn));
  camDirty = true; // the camera decides which half goes
  staticKey++;
  request();
});
// For the benchmark harness: counters only, read over CDP.
let frames = 0, firstFrame = 0;
window.__brain = { light: LIGHT, nodes: N, edges: edges.length, frames: () => frames, staticDraws: () => (R ? R.staticDraws || 0 : 0), firstFrameMs: () => firstFrame,
  get intro() { return { on: intro.on, done: intro.done, clock: intro.on && intro.t0 != null ? (performance.now() - intro.t0) / 1000 : null }; },
  counts: () => (R ? { ...R.counts, dendrites: R.layers.dendrites?.count, tracts: R.layers.tracts?.count } : null),
  get busy() { return busyUntil > performance.now(); }, setAutoRotate(on) { if (on !== autoRotate) $('rotateBtn').click(); }, setFollow(on) { if (on !== follow) $('followBtn').click(); },
  get cam() { return JSON.parse(JSON.stringify({ cam, goal, vel, follow, autoRotate })); }, pos: (i) => at(i),
  look(yaw, pitch, zoom = 1) { Object.assign(cam, { yaw, pitch, zoom }); Object.assign(goal, { yaw, pitch, zoom }); camDirty = true; request(); },
  // Close-ups for checks: the camera on a lobe's center (or a point), from an angle, zoomed.
  aim(at, yaw, pitch, zoom) {
    const target = typeof at === 'string' ? lobeShape(at, -1).c : at;
    vel.yaw = vel.pitch = 0;
    Object.assign(cam, { yaw, pitch, zoom, target: [...target] });
    Object.assign(goal, structuredClone(cam));
    lastInput = performance.now();
    camDirty = true;
    request();
  },
  cut(on) { if (on !== cutOn) cutBtn.click(); },
  // The position of the k-th node of a type, for close-ups.
  nodeOf(type, k = 0) { const list = nodes.map((n, i) => [n, i]).filter(([n]) => n.type === type); return list.length ? at(list[k % list.length][1]) : null; },
  // A fixed view, framed like Fit (top uses pitch 1.55, past the orbit's limit), and the outline measured from it.
  view(yaw, pitch) {
    const f = fitFor(yaw, pitch);
    vel.yaw = vel.pitch = 0;
    Object.assign(cam, { yaw, pitch, zoom: f.dist / FIT.dist, target: [...f.target] });
    Object.assign(goal, structuredClone(cam));
    lastInput = performance.now();
    camDirty = true;
    request();
  },
  outline() {
    const size = (parts) => { const e = extent(cam.yaw, cam.pitch, parts); return [+(e.x1 - e.x0).toFixed(3), +(e.y1 - e.y0).toFixed(3)]; };
    const b = [0, 1, 2, 3].map(() => [1e9, 1e9, -1e9, -1e9]); // per part, then all: screen boxes
    for (let i = 0; i < shellXYZ.length; i += 4) {
      const p = project([shellXYZ[i], shellXYZ[i + 1], shellXYZ[i + 2]]);
      for (const k of [shellXYZ[i + 3], 3]) { const q = b[k]; q[0] = Math.min(q[0], p[0]); q[1] = Math.min(q[1], p[1]); q[2] = Math.max(q[2], p[0]); q[3] = Math.max(q[3], p[1]); }
    }
    const box = b.map((q) => q.map(Math.round));
    return { cerebrum: size([0]), all: size([0, 1, 2]), px: [box[3][2] - box[3][0], box[3][3] - box[3][1]], box: box[3], boxCer: box[0], boxCbl: box[1] };
  },
  labels: () => [...lobeEls].filter(([, el]) => !el.hidden).map(([l, el]) => ({ lobe: l, box: el._box.map(Math.round), leader: leaderEls.get(l)?.style.display !== 'none' })) };
const _draw = R ? R.draw.bind(R) : null;
// The intro, measured: frames drawn, their rate between the first and the last, the longest wait between two, and how
// long its first two frames took (its clock starts after them).
let introFrames = 0, introGap = 0, lastDraw = 0, introFirst = 0, introLast = 0;
window.__brain.introStats = () => ({ frames: introFrames, fps: +((introFrames - 1) / ((introLast - introFirst) / 1000)).toFixed(1), maxGapMs: Math.round(introGap), warmMs: Math.round(intro.t0 - introFirst) });
if (R) R.draw = (...a) => {
  const t = performance.now();
  frames++;
  if (!firstFrame) firstFrame = Math.round(t);
  if (intro.on) { if (introFrames) introGap = Math.max(introGap, t - lastDraw); else introFirst = t; introFrames++; introLast = t; }
  lastDraw = t;
  return _draw(...a);
};
