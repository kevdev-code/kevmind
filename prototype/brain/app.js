// Brain prototype: synthetic graph + replay → WebGL2 renderer, with DOM labels, chips, filters, focus and an
// activity trace. Rendering rules: nothing renders while the tab is hidden or another view is shown; frames are
// capped at 30 fps and the loop stops as soon as nothing moves (camera, beams, flashes, Follow, Auto-rotate);
// "Animations off" (or reduced motion) draws single static frames.
import { makeGraph, makeReplay, NODE_TYPES, EDGE_TYPES } from './data.js';
import { layout, shellPoints, lobeShape, LOBES, BRAIN_CENTER, BRAIN_RADIUS } from './layout.js';
import { Renderer, oklch, KIND, SHAPE, EDGE, SPRITE, NODE_FLOATS, FIBER_FLOATS, SPRITE_FLOATS, perspective, multiply, orbitView } from './gl.js';

const params = new URLSearchParams(location.search);
const TARGET = Number(params.get('nodes')) || 0;
const SPEED = Number(params.get('speed')) || 1;
const SKIP = new Set((params.get('skip') || '').split(',')); // benchmark only: draw without some layers
const FRAME_MS = 1000 / 30;
const FOV = (30 * Math.PI) / 180;
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
  bg: C(12.5, 0.028, 280), bgCenter: C(22, 0.055, 280), accent: C(74, 0.145, 288),
  // What happened to a node: DESIGN.md's state hues (read, edit, error), command gray, selection violet.
  kinds: [[0, 0, 0], C(76, 0.115, 245), C(77, 0.13, 350), C(72, 0.17, 25), C(72, 0.012, 285), C(74, 0.145, 288)].flat(),
  edgeAlpha: [0.34, 0.12, 0.42, 0.24, 0.15, 0.26, 0.5, 1],
  dust: C(82, 0.035, 290),
};
const kindRgb = (k) => P.kinds.slice(KIND[k] * 3, KIND[k] * 3 + 3);
// Categorical color per lobe kind: the brain view's one exemption from one-hue-per-meaning (DESIGN.md, Brain view).
// Regions in a lobe shift a little around its hue so neighbors stay apart.
const LOBE_COLOR = { prefrontal: [80, 0.13, 78], frontal: [78, 0.13, 152], parietal: [72, 0.14, 295], occipital: [76, 0.12, 238],
  temporal: [74, 0.15, 356], cerebellum: [78, 0.11, 190], stem: [75, 0.13, 45] };
// Agents: colored beams with a white core and a numbered label, so they never pass for a region (user's choice).
const AGENT_HUES = [[95, 0.02, 285], [82, 0.12, 200], [87, 0.16, 117], [76, 0.11, 314]];

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
// Additive light saturates where a lobe is crowded: crowded lobes get dimmer, smaller stars.
const lobeLoad = {};
for (const n of nodes) { const l = regions[n.region].lobe; lobeLoad[l] = (lobeLoad[l] || 0) + 1; }
const crowd = Object.fromEntries(Object.entries(LOBES).map(([l, s]) => [l, clamp(Math.sqrt(900 / ((lobeLoad[l] || 1) / ((4 / 3) * Math.PI * s.r[0] * s.r[1] * s.r[2] * (s.midline ? 1 : 2)))), 0.45, 1)]));
const crowdOf = (i) => crowd[lobeOf(i)];
const sizeOf = (i) => (nodes[i].type === 'instruction' ? 0.085 : (0.042 + 0.008 * Math.sqrt(Math.min(activityOf(i), 140))) * Math.sqrt(crowdOf(i)));
const brightOf = (i) => (nodes[i].type === 'instruction' ? 1 : (0.5 + 0.5 * Math.min(1, Math.sqrt(activityOf(i) / 70))) * crowdOf(i));

const size = new Float32Array(N), bright = new Float32Array(N);
for (let i = 0; i < N; i++) { size[i] = sizeOf(i); bright[i] = brightOf(i); }
const state = new Float32Array(N * 4); // brightness, ember, ignition time, kind
for (let i = 0; i < N; i++) state[i * 4 + 2] = -100;

function nodeData() {
  const d = new Float32Array(N * NODE_FLOATS);
  for (let i = 0; i < N; i++) {
    const n = nodes[i], seed = (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
    d.set([...at(i), size[i], SHAPE[n.type], n.project == null ? -1 : projIndex.get(n.project), ...regionColor[n.region], Math.abs(seed)], i * NODE_FLOATS);
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
// fiberData(cross, same): segments per curve between regions and inside one.
function fiberData(segCross, segSame) {
  const out = [], owner = [];
  edges.forEach((e, k) => {
    const pa = at(e.a), pb = at(e.b), ga = nodes[e.a].region, gb = nodes[e.b].region;
    const mid = [0, 1, 2].map((i) => (pa[i] + pb[i]) / 2);
    let pt;
    if (ga === gb) { // a gentle bow away from the region's center
      const cg = L.centroid[ga], d = [0, 1, 2].map((i) => mid[i] - cg[i]), dl = Math.hypot(...d) || 1, len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const c = [0, 1, 2].map((i) => mid[i] + (d[i] / dl) * len * 0.3);
      pt = (t) => [0, 1, 2].map((i) => (1 - t) * (1 - t) * pa[i] + 2 * (1 - t) * t * c[i] + t * t * pb[i]);
    } else {
      const ra = regions[ga], rb = regions[gb], la = lobeShape(ra.lobe, L.side[ga]).c, lb = lobeShape(rb.lobe, L.side[gb]).c;
      let poly;
      if (ra.lobe === rb.lobe && L.side[ga] === L.side[gb]) poly = [pa, L.centroid[ga], L.centroid[gb], pb];
      else {
        const m = [0, 1, 2].map((i) => (la[i] + lb[i]) / 2);
        // Across hemispheres the lane crosses the midline high, like the corpus callosum; within one it dips toward the core.
        const lane = L.side[ga] !== L.side[gb] ? [m[0] * 0.8, 0.24, 0] : [0, 1, 2].map((i) => m[i] + (CORE[i] - m[i]) * 0.35);
        poly = [pa, la, lane, lb, pb]; // few control points, so the lane bends in long curves, not corners
      }
      pt = bspline(poly.map((p, i) => [0, 1, 2].map((k) => pa[k] + (pb[k] - pa[k]) * (i / (poly.length - 1)) + (p[k] - pa[k] - (pb[k] - pa[k]) * (i / (poly.length - 1))) * 0.85)));
    }
    const S = ga === gb ? segSame : segCross;
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
  return { data: new Float32Array(out), owner: Int32Array.from(owner) };
}

let shellXYZ = new Float32Array(0); // the shell's points, also used to frame the brain
function dustData() {
  const s = (shellXYZ = shellPoints(13000)), d = new Float32Array((s.length / 4) * SPRITE_FLOATS);
  for (let i = 0, k = 0; i < s.length; i += 4, k += SPRITE_FLOATS) {
    const part = s[i + 3];
    d.set([s[i], s[i + 1], s[i + 2], part === 3 ? 0.009 : 0.011, ...P.dust, part === 3 ? 0.32 : part === 0 ? 0.5 : 0.42, SPRITE.dust], k);
  }
  return d;
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
let staticKey = 0; // bumped whenever the cached static layers (ground, shell, haze, fibers) must be redrawn
const scr = new Float32Array(N * 3);
const projCur = new Float32Array(32).fill(1), projTarget = new Float32Array(32).fill(1);
const embers = new Map();
const rings = [];
let ripples = [];
let busyUntil = 0;
const busy = (until) => { if (until > busyUntil) busyUntil = until; };
const tSec = (now = performance.now()) => (now - T0) / 1000;

// ---- renderer --------------------------------------------------------------------------------------------------
const canvas = $('brain');
let R = null;
const edgeHl = new Float32Array(edges.length);
// ponytail: two fixed levels; the coarse one exists for software and weak GPUs, where cost grows with segments.
const lod = [{ cross: 14, same: 2 }, { cross: 1, same: 1 }].map((x) => ({ ...x, owner: new Int32Array(0), hl: new Float32Array(0) }));
function uploadGeometry() {
  R.setNodes(nodeData(), state);
  lod.forEach((l, k) => {
    const f = fiberData(l.cross, l.same);
    l.owner = f.owner;
    l.hl = new Float32Array(f.owner.length);
    R.setFibers(f.data, l.hl, k);
  });
}
try {
  R = new Renderer(canvas, P);
  uploadGeometry();
  R.setDust(dustData());
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
    edgeHl[k] = v;
  });
  lod.forEach((l, k) => {
    for (let s = 0; s < l.owner.length; s++) l.hl[s] = edgeHl[l.owner[s]];
    if (R) R.updateFibers(l.hl, k);
  });
  staticKey++;
  return shown;
}
function refresh() {
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    visible[i] = filter.types.has(n.type) && (n.project == null ? filter.projects.size > 0 : filter.projects.has(n.project)) ? 1 : 0;
  }
  for (let i = 0; i < N; i++) state[i * 4] = nodeBright(i);
  if (R) R.updateState(state);
  const shown = edgeLights();
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
function frameBrain() {
  const b = orbitView(BRAIN_CENTER, 5, HOME.yaw, HOME.pitch), t = Math.tan(FOV / 2);
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
  for (let i = 0; i < shellXYZ.length; i += 4) {
    const d = [shellXYZ[i] - BRAIN_CENTER[0], shellXYZ[i + 1] - BRAIN_CENTER[1], shellXYZ[i + 2] - BRAIN_CENTER[2]];
    const px = d[0] * b.x[0] + d[1] * b.x[1] + d[2] * b.x[2], py = d[0] * b.y[0] + d[1] * b.y[1] + d[2] * b.y[2];
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const old = [...HOME.target];
  FIT.target = [0, 1, 2].map((a) => BRAIN_CENTER[a] + b.x[a] * (x0 + x1) / 2 + b.y[a] * (y0 + y1) / 2);
  FIT.dist = Math.max((y1 - y0) / 2 / t, (x1 - x0) / 2 / (t * (W / H))) * 1.1 + 0.45; // margin, and the near half is bigger
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
  camVersion++;
  labelsDirty = true;
  camDirty = false;
  staticKey++;
}
function project(p) {
  const m = VP;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [((x / w + 1) / 2) * W, ((1 - y / w) / 2) * H, w];
}
function screenPositions() { // for picking, only when asked after the camera moved
  if (scrVersion === camVersion) return;
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
const bez = (c, t) => [0, 1, 2].map((k) => (1 - t) * (1 - t) * c.from[k] + 2 * (1 - t) * t * c.ctrl[k] + t * t * c.to[k]);
const cometHead = (c, now) => bez(c, ease(clamp((now - c.t0) / c.dur, 0, 1)));
const animating = () => anim && R && !document.hidden && view === 'brain';

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
      // The beam arcs over the surface: its control point lifts away from the core.
      const from = a.pos, d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const mid = [0, 1, 2].map((i) => (from[i] + to[i]) / 2), out = [0, 1, 2].map((i) => mid[i] - CORE[i]), ol = Math.hypot(...out) || 1;
      const ctrl = [0, 1, 2].map((i) => mid[i] + (out[i] / ol) * (0.18 + d * 0.35));
      a.comet = { from, to, ctrl, t0: now, dur: 520 + 480 * Math.min(1, d / 1.2), node: ev.node, kind: ev.kind };
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
  if (animate) { rings.push({ p: a.pos, t0: now, dur: 750, rgb: kindRgb(c.kind) }); busy(now + 1700); }
  cooling();
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
    if (changed) request();
    if (embers.size) cooling();
  }, 15000);
}

function setProjectActive(id) {
  projTarget.fill(1);
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
function frame(now) {
  raf = 0;
  if (!R || view !== 'brain' || document.hidden) return;
  if (anim && now - lastFrame < FRAME_MS - 2) { raf = requestAnimationFrame(frame); return; } // 30 fps cap
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  for (let k = 0; k < 32; k++) {
    const d = projTarget[k] - projCur[k];
    if (Math.abs(d) > 0.002) { projCur[k] += anim ? d * Math.min(1, dt / 220) : d; staticKey++; } else projCur[k] = projTarget[k];
  }
  for (const a of agents.values()) if (a.comet && (!anim || now >= a.comet.t0 + a.comet.dur)) arrive(a, anim);
  const moving = camStep(now, dt) || !!(drag && drag.moved);
  if (camDirty) updateCamera();
  if (wasMoving && !moving) staticKey++; // the camera stopped: redraw the static layers with smooth fibers
  wasMoving = moving;
  const time = tSec(now);
  ripples = ripples.filter((r) => time - r.t < 2.4);
  for (let k = rings.length - 1; k >= 0; k--) if (now - rings[k].t0 > rings[k].dur) rings.splice(k, 1);
  const haze = buildSprites(now);
  R.setBeams(buildBeams(now));
  R.draw({ vp: VP, px: PX, time, ripples, proj: projCur, depth }, { haze, staticKey, skip: SKIP, lod: moving ? 1 : 0 });
  if (labelsDirty) layoutLabels();
  placeChips(now);
  if (anim && (now < busyUntil || moving)) request();
}

// Haze per region and the lit lobes (cached layer), then agent heads, markers and rings.
let spriteData = new Float32Array(0), heatSig = '', heatShown = {}, heatAt = -1e9, heatTimer = 0;
function buildSprites(now) {
  const list = [];
  for (const g of regions) {
    const n = L.count[g.id];
    if (n < 3 || (g.project != null && !filter.projects.has(g.project))) continue;
    const pf = g.project == null ? 1 : projCur[projIndex.get(g.project)];
    list.push(...L.centroid[g.id], clamp(L.spread[g.id] * 3.6, 0.12, 0.45), ...regionColor[g.id], 0.055 * pf * pf * (focusSet || matchSet ? 0.35 : 1), SPRITE.glow);
  }
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
      out.push(...bez(c, ta), ...bez(c, tb), 0, 0, ...rgb, ...rgb, EDGE.beam, 16, 1, Math.max(0.004, alphaAt((ta + tb) / 2)), -1, 0);
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
// Lobe labels sit inside the brain: the lobe once, small, and under it its groups in their region colors, the
// most important first (where agents work, the focused node's region, the working project, then size), names
// deduplicated across projects. Each label goes on the side of the brain facing the camera and fades with depth.
const lobeEls = new Map();
let chipBoxes = [];
function layoutLabels() {
  labelsDirty = false;
  // The panels over the well count as taken, so no label hides under them (read before this function writes anything).
  const wr = $('well').getBoundingClientRect();
  const taken = ['now', 'trace', 'focusCard'].map($).concat([document.querySelector('.seg.camera')]).filter((el) => el && !el.hidden && el.offsetParent)
    .map((el) => { const r = el.getBoundingClientRect(); return [r.left - wr.left, r.top - wr.top, r.width, r.height]; });
  const free = (x, y, w, h) => !taken.some((r) => x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + h);
  const live = new Set();
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') live.add(nodes[a.node].region);
  const wc = (depth[0] + depth[1]) / 2;
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
    const sides = [...new Set(list.map(([g]) => L.side[g.id]))];
    const near = sides.map((s) => lobeShape(lobe, s)).map((sh) => [sh, project(sh.c)]).sort((p, q) => p[1][2] - q[1][2])[0];
    const [sh, c0] = near, up = project([sh.c[0], sh.c[1] + sh.r[1], sh.c[2]]), fw = project([sh.c[0] + sh.r[0], sh.c[1], sh.c[2]]);
    const ry = Math.abs(up[1] - c0[1]), rx = Math.abs(fw[0] - c0[0]);
    const spots = [[0, 0], [0, -ry - 14], [0, ry + 14], [-rx * 0.7, 0], [rx * 0.7, 0]].map(([dx, dy]) => [c0[0] + dx, c0[1] + dy, c0[2]]);
    const names = [], seen = new Set();
    for (const [g] of list) { const n = regionName(g); if (!seen.has(n)) { seen.add(n); names.push([n, g.id]); } }
    return { lobe, top: list[0][1], live: list.some(([, pr]) => pr >= 1000), spots, names };
  }).sort((x, y) => y.top - x.top);
  const keep = new Set();
  const show = W < 520 ? 2 : 3;
  const agentsAt = [];
  for (const a of agents.values()) if (a.pos && !(a.hideAt && performance.now() > a.hideAt)) { const p = project(a.pos); agentsAt.push([p[0] - 18, p[1] - 18, 36, 36]); }
  for (const b of chipBoxes) agentsAt.push(b);
  const clear = (x, y, w, h) => free(x - 3, y - 3, w + 6, h + 6) && !agentsAt.some((o) => x < o[0] + o[2] && o[0] < x + w && y < o[1] + o[3] && o[1] < y + h);
  for (const c of cands) {
    const [la, lb] = T.lobes[c.lobe];
    const small = `${la} · ${lb}`;
    const list = c.names.slice(0, show), more = c.names.length - list.length;
    const html = `<small>${esc(small)}</small><span class="groups">${list.map(([n, id]) => `<b style="color:${regionCss[id]}">${esc(n)}</b>`).join('<i>·</i>')}${more > 0 ? `<i>+${more}</i>` : ''}</span>`;
    const text = list.map(([n]) => n).join(' · ') + (more > 0 ? ` +${more}` : '');
    const w = Math.max(small.length * 6.3, text.length * 7.4) + 14, h = 36;
    const fits = (s) => { const x = clamp(s[0] - w / 2, 8, W - w - 8), y = s[1] - h / 2; return s[2] > 0 && y > 56 && y + h < H - 8 ? [x, y] : null; };
    const options = c.spots.map(fits).filter(Boolean);
    const pick = options.find(([x, y]) => clear(x, y, w, h)) || options.find(([x, y]) => free(x - 3, y - 3, w + 6, h + 6));
    if (!pick) continue;
    const [x, y] = pick;
    let el = lobeEls.get(c.lobe);
    if (!el) { el = document.createElement('span'); el.className = 'lbl lobe'; lobeEls.set(c.lobe, el); labelBox.append(el); }
    if (el._html !== html) { el._html = html; el.innerHTML = html; }
    el.classList.toggle('on', c.live);
    el.classList.toggle('far', c.spots[0][2] > wc && !c.live);
    if (el.hidden) el.hidden = false;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el._box = [x, y, w, h];
    taken.push([x - 3, y - 3, w + 6, h + 6]);
    keep.add(c.lobe);
  }
  for (const [k, el] of lobeEls) if (!keep.has(k) && !el.hidden) el.hidden = true;
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
  // Lobe labels keep their place: a chip takes the first spot around its agent (up-right, up-left, down-right,
  // down-left) that covers no label and no other chip; only if none is free does it stack and the label give way.
  const hit = (b, o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3];
  const labels = [...lobeEls.values()].filter((el) => !el.hidden && el._box).map((el) => el._box);
  const boxes = [];
  for (const [a, px, py] of placed) {
    const el = a.chip, w = a.chipW;
    const spots = [[px + 14, py - 30], [px - w - 14, py - 30], [px + 14, py + 10], [px - w - 14, py + 10]].map(([x, y]) => [clamp(x, 8, W - w - 8), y, w, 22]);
    let b = spots.find((s) => !labels.some((l) => hit(s, l)) && !boxes.some((o) => hit(s, o)));
    if (!b) { b = spots[0]; for (const o of boxes) if (hit(b, o)) b = [b[0], o[1] + 25, w, 22]; }
    boxes.push(b);
    el.style.transform = `translate3d(${Math.round(b[0])}px, ${Math.round(b[1])}px, 0)`;
  }
  chipBoxes = boxes;
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
    if (!visible[i] || scr[i * 3 + 2] <= 0) continue;
    const dx = scr[i * 3] - x, dy = scr[i * 3 + 1] - y, d2 = dx * dx + dy * dy;
    const r = Math.max(7, (size[i] * PX) / scr[i * 3 + 2] * 0.2 + 3);
    const score = d2 + (scr[i * 3 + 2] - depth[0]) * 12; // the nearer of two overlapping stars wins
    if (d2 < r * r && score < bd) { bd = score; best = i; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
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
canvas.addEventListener('pointerleave', () => { if (!drag) hideTip(); });
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
  if (v !== 'brain') { cancelAnimationFrame(raf); raf = 0; hideTip(); }
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
if (!params.has('noreplay')) nextEvent();
// For the benchmark harness: counters only, read over CDP.
let frames = 0, firstFrame = 0;
window.__brain = { nodes: N, edges: edges.length, frames: () => frames, staticDraws: () => (R ? R.staticDraws || 0 : 0), firstFrameMs: () => firstFrame,
  get busy() { return busyUntil > performance.now(); }, setAutoRotate(on) { if (on !== autoRotate) $('rotateBtn').click(); }, setFollow(on) { if (on !== follow) $('followBtn').click(); },
  get cam() { return JSON.parse(JSON.stringify({ cam, goal, vel, follow, autoRotate })); }, pos: (i) => at(i),
  look(yaw, pitch, zoom = 1) { Object.assign(cam, { yaw, pitch, zoom }); Object.assign(goal, { yaw, pitch, zoom }); camDirty = true; request(); } };
const _draw = R ? R.draw.bind(R) : null;
if (R) R.draw = (...a) => { frames++; if (!firstFrame) firstFrame = Math.round(performance.now()); return _draw(...a); };
