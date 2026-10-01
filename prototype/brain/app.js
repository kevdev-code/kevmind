// Brain prototype: synthetic graph + replay → WebGL2 renderer, with DOM labels, chips, filters and focus.
// Rendering rules: nothing renders while the tab is hidden or another view is shown; frames are capped at 30 fps
// and the loop stops as soon as nothing moves; "Animations off" (or reduced motion) draws single static frames.
import { makeGraph, makeReplay, NODE_TYPES, EDGE_TYPES } from './data.js';
import { layout, fissureLines, profileLines, LOBE_SHAPES } from './layout.js';
import { Renderer, oklch, KIND, SHAPE, EDGE, perspective, multiply, orbitView } from './gl.js';

const params = new URLSearchParams(location.search);
const TARGET = Number(params.get('nodes')) || 0;
const SPEED = Number(params.get('speed')) || 1;
const FRAME_MS = 1000 / 30;
const FOV = (30 * Math.PI) / 180;
const T0 = performance.now();
const $ = (id) => document.getElementById(id);
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- words ---------------------------------------------------------------------------------------------------
const I18N = {
  en: {
    viewLive: 'Live', viewMemory: 'Memory', viewBrain: 'Brain', prototype: 'Prototype', synthetic: 'synthetic data', filters: 'Filters',
    search: 'Search notes and files', noResults: 'No matches', projects: 'Projects', nodeTypes: 'Node types', edgeTypes: 'Links',
    colors: 'Activity colors', nodes: 'Nodes', anim: 'Animations', zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetView: 'Reset view',
    hint: 'Drag to turn · Shift-drag to move · Scroll to zoom · Click a star to focus',
    noWebgl: 'This view needs WebGL 2, which is turned off in this browser.',
    elsewhere: 'Live and Memory are in the real dashboard. This prototype only has the Brain view, and it stops rendering while you are here.',
    t_instruction: 'Instruction files', t_memory: 'Memory notes', t_serena: 'Serena notes', t_file: 'Code files', t_tool: 'Tools',
    e_link: 'Links between notes', e_index: 'Index entries', e_import: 'Imports', e_cites: 'Notes citing code', e_cochange: 'Changed together', e_readfirst: 'Read before edit',
    k_read: 'read', k_edit: 'edit', k_error: 'error', k_command: 'command', k_focus: 'selected',
    v_read: 'reads', v_edit: 'edits', v_command: 'runs', v_error: 'failed', thinking: 'thinking', done: 'done', started: 'started',
    working: 'working', idle: 'idle', running: 'running', waitingStart: 'no session yet',
    counts: (p, n, e) => `${p} ${p === 1 ? 'project' : 'projects'} · ${n.toLocaleString('en')} nodes · ${e.toLocaleString('en')} links`,
    reads: (n) => (n === 1 ? 'read' : 'reads'), edits: (n) => (n === 1 ? 'edit' : 'edits'), uses: (n) => (n === 1 ? 'use' : 'uses'),
    errors: (n) => (n === 1 ? 'error' : 'errors'), links: (n) => (n === 1 ? 'link' : 'links'), tokens: 'tokens', indexed: 'in MEMORY.md', notIndexed: 'not in MEMORY.md',
    last: 'last touched', ago: (s) => s, now: 'now', min: (n) => `${n} min ago`, hr: (n) => `${n} h ago`, day: (n) => `${n} d ago`, never: 'never',
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
    colors: 'Colores de actividad', nodes: 'Nodos', anim: 'Animaciones', zoomIn: 'Acercar', zoomOut: 'Alejar', resetView: 'Restablecer vista',
    hint: 'Arrastra para girar · Mayús + arrastra para mover · Rueda para zoom · Clic en una estrella para enfocarla',
    noWebgl: 'Esta vista necesita WebGL 2, que está desactivado en este navegador.',
    elsewhere: 'En vivo y Memoria están en el panel real. Este prototipo solo tiene la vista Cerebro, que deja de dibujarse mientras estás aquí.',
    t_instruction: 'Instrucciones', t_memory: 'Notas de memoria', t_serena: 'Notas de Serena', t_file: 'Archivos de código', t_tool: 'Herramientas',
    e_link: 'Enlaces entre notas', e_index: 'Entradas del índice', e_import: 'Importaciones', e_cites: 'Notas que citan código', e_cochange: 'Cambian juntos', e_readfirst: 'Leído antes de editar',
    k_read: 'lectura', k_edit: 'edición', k_error: 'error', k_command: 'comando', k_focus: 'seleccionado',
    v_read: 'lee', v_edit: 'edita', v_command: 'ejecuta', v_error: 'falló', thinking: 'pensando', done: 'terminó', started: 'empezó',
    working: 'trabajando', idle: 'inactivo', running: 'en curso', waitingStart: 'sin sesión todavía',
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

// ---- colors (DESIGN.md tokens, dark) -------------------------------------------------------------------------
const C = (l, c, h) => oklch(l / 100, c, h);
const P = {
  bg: C(12.5, 0.014, 285), bgCenter: C(17.5, 0.03, 288),
  node: C(90, 0.035, 285), lobeGlow: C(80, 0.04, 285), accent: C(74, 0.145, 288), haze: C(58, 0.05, 288),
  kinds: [[0, 0, 0], C(76, 0.115, 245), C(77, 0.13, 350), C(72, 0.17, 25), C(72, 0.012, 285), C(74, 0.145, 288)].flat(),
  edgeColors: [C(78, 0.03, 285), C(70, 0.03, 285), C(82, 0.03, 285), C(74, 0.03, 285), C(70, 0.025, 285), C(76, 0.03, 285), C(70, 0.04, 288), C(76, 0.04, 288)].flat(),
  edgeAlpha: [0.2, 0.09, 0.3, 0.12, 0.09, 0.16, 0.34, 0.42],
};
const kindRgb = (k) => P.kinds.slice(KIND[k] * 3, KIND[k] * 3 + 3);
// Agent identity hues sit in the gaps between DESIGN.md's state hues; Claude itself is ink white.
// Subagents get the widest gaps between state hues: cyan 200 (45 deg from working and read), chartreuse 117 (37 deg from
// amber and working), a soft magenta 314 (36 deg from edit, 26 deg from the violet accent, at lower chroma). A fourth
// subagent reuses cyan; its chip number tells them apart.
const AGENT_HUES = [[95, 0.02, 285], [82, 0.12, 200], [87, 0.16, 117], [76, 0.11, 314]];

// ---- data ----------------------------------------------------------------------------------------------------
const graph = makeGraph({ target: TARGET });
const N = graph.nodes.length;
const L = layout(graph);
const replay = makeReplay(graph);
const projIndex = new Map(graph.projects.map((p, i) => [p.id, i]));
const nodes = graph.nodes;
const edges = graph.edges;
const pos = L.pos;
const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const stats = nodes.map((n) => ({ reads: n.reads || 0, edits: n.edits || 0, lastAt: n.lastAt || 0 }));
const adj = nodes.map(() => []);
edges.forEach((e, k) => { adj[e.a].push(k); adj[e.b].push(k); });

const activityOf = (i) => {
  const n = nodes[i];
  if (n.type === 'tool') return n.uses / 10;
  if (n.type === 'file') return stats[i].reads + 2 * stats[i].edits;
  return (n.tokens || 300) / 100 + stats[i].reads + adj[i].length;
};
// Additive light saturates where a lobe is crowded: crowded lobes get dimmer, smaller stars.
const lobeLoad = {};
for (const n of nodes) { const l = graph.regions[n.region].lobe; lobeLoad[l] = (lobeLoad[l] || 0) + 1; }
const crowd = Object.fromEntries(Object.entries(LOBE_SHAPES).map(([l, s]) => [l, Math.min(1, Math.max(0.4, Math.sqrt(260 / ((lobeLoad[l] || 1) / (Math.PI * s.r[0] * s.r[1])))))]));
const crowdOf = (i) => crowd[graph.regions[nodes[i].region].lobe];
const sizeOf = (i) => (nodes[i].type === 'instruction' ? 0.042 : (0.014 + 0.0042 * Math.sqrt(Math.min(activityOf(i), 140))) * Math.sqrt(crowdOf(i)));
const brightOf = (i) => (nodes[i].type === 'instruction' ? 1 : (0.42 + 0.58 * Math.min(1, Math.sqrt(activityOf(i) / 70))) * crowdOf(i));

const size = new Float32Array(N), shape = new Float32Array(N), proj = new Float32Array(N), bright = new Float32Array(N);
for (let i = 0; i < N; i++) {
  size[i] = sizeOf(i);
  bright[i] = brightOf(i);
  shape[i] = SHAPE[nodes[i].type];
  proj[i] = nodes[i].project == null ? -1 : projIndex.get(nodes[i].project);
}
const state = new Float32Array(N * 4); // brightness, ember, ignition time, kind
for (let i = 0; i < N; i++) state[i * 4 + 2] = -100;

// ---- view state ----------------------------------------------------------------------------------------------
const filter = { projects: new Set(graph.projects.map((p) => p.id)), types: new Set(NODE_TYPES), edges: new Set(EDGE_TYPES) };
const visible = new Uint8Array(N);
let focus = null, focusSet = null, matchSet = null, hover = -1;
let view = 'brain';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let anim = (() => { try { const v = localStorage.getItem('kevmind.brain.anim'); if (v) return v === 'on'; } catch {} return !reduced.matches; })();
const cam = { yaw: -0.22, pitch: 0.1, zoom: 1, target: [0.02, -0.02, 0] };
let W = 1, H = 1, VP = null, PX = 1, camDirty = true, labelsDirty = true;
let staticKey = 0; // bumped whenever the cached static layers (ground, outline, haze, edges) must be redrawn
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
try {
  R = new Renderer(canvas, P);
  R.setNodes(pos, size, shape, proj, state);
  const ev = new Float32Array(edges.length * 12);
  edges.forEach((e, k) => {
    const a = at(e.a), b = at(e.b), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const pj = proj[e.a] >= 0 ? proj[e.a] : proj[e.b];
    ev.set([...a, 0, EDGE[e.type], pj, ...b, len, EDGE[e.type], pj], k * 12);
  });
  R.setEdges(ev, new Float32Array(edges.length * 2).fill(1));
  const fv = [];
  for (const line of fissureLines()) for (let i = 0; i + 5 < line.length; i += 3) fv.push(...line.slice(i, i + 3), 0, EDGE.fissure, -1, ...line.slice(i + 3, i + 6), 0, EDGE.fissure, -1);
  const prof = profileLines();
  for (let i = 0; i < prof.length; i += 6) fv.push(...prof.slice(i, i + 3), 0, EDGE.profile, -1, ...prof.slice(i + 3, i + 6), 0, EDGE.profile, -1);
  R.setFissures(new Float32Array(fv));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('noGl').hidden = false; });
} catch (err) {
  console.warn(err);
  $('noGl').hidden = false;
}

// ---- visibility, emphasis --------------------------------------------------------------------------------------
function nodeBright(i) {
  if (!visible[i]) return 0;
  let b = bright[i];
  if (focusSet) b *= focusSet.has(i) ? 1.4 : 0.14;
  else if (matchSet) b *= matchSet.has(i) ? 1.4 : 0.16;
  return Math.max(b, 0.002);
}
const edgeHl = new Float32Array(edges.length * 2);
function refresh() {
  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    visible[i] = filter.types.has(n.type) && (n.project == null ? filter.projects.size > 0 : filter.projects.has(n.project)) ? 1 : 0;
  }
  for (let i = 0; i < N; i++) state[i * 4] = nodeBright(i);
  let shown = 0;
  edges.forEach((e, k) => {
    let v = visible[e.a] && visible[e.b] && filter.edges.has(e.type) ? 1 : 0;
    if (v) shown++;
    if (v && focusSet) v = e.a === focus || e.b === focus ? 2 : 0.2;
    else if (v && matchSet) v = matchSet.has(e.a) && matchSet.has(e.b) ? 1 : 0.2;
    edgeHl[k * 2] = edgeHl[k * 2 + 1] = v;
  });
  if (R) { R.updateState(state); R.updateEdges(edgeHl); }
  staticKey++;
  let n = 0;
  for (let i = 0; i < N; i++) n += visible[i];
  setText($('counts'), T.counts(filter.projects.size, n, shown));
  canvas.setAttribute('aria-label', T.canvas(filter.projects.size, n, shown));
  labelsDirty = true;
  request();
}

// ---- camera ------------------------------------------------------------------------------------------------------
function fitDist() {
  const t = Math.tan(FOV / 2), aspect = W / H;
  return Math.max(1.0 / t, 1.12 / (t * aspect)) + 0.25;
}
function updateCamera() {
  const dist = fitDist() * cam.zoom;
  VP = multiply(perspective(FOV, W / H, 0.1, 30), orbitView(cam.target, dist, cam.yaw, cam.pitch));
  PX = H / (2 * Math.tan(FOV / 2));
  for (let i = 0; i < N; i++) {
    const p = project(at(i));
    scr[i * 3] = p[0]; scr[i * 3 + 1] = p[1]; scr[i * 3 + 2] = p[2];
  }
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

// ---- agents, comets, embers ------------------------------------------------------------------------------------
const agents = new Map();
const session = { status: 'idle', project: replay.project };
function agentOf(id) {
  let a = agents.get(id);
  if (!a) {
    const def = replay.agents.find((x) => x.id === id);
    const hue = AGENT_HUES[agents.size % AGENT_HUES.length];
    a = { id, def, css: `oklch(${hue[0]}% ${hue[1]} ${hue[2]})`, rgb: C(...hue), status: 'idle', node: null, pos: null, comet: null, kind: '', text: '', chip: null, li: null, hideAt: 0 };
    agents.set(id, a);
  }
  return a;
}
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
function cometAt(c, u) {
  const e = ease(Math.min(1, Math.max(0, u))), v = 1 - e;
  return [0, 1, 2].map((k) => v * v * c.from[k] + 2 * v * e * c.ctrl[k] + e * e * c.to[k]);
}
const animating = () => anim && R && !document.hidden && view === 'brain';

function onEvent(ev) {
  const now = performance.now();
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
      a.node = main.node; a.pos = main.comet ? cometAt(main.comet, (now - main.comet.t0) / main.comet.dur) : main.pos;
      if (animating()) { rings.push({ p: a.pos, t0: now, dur: 800, rgb: a.rgb, s: 0.6 }); busy(now + 800); }
    }
    a.kind = 'start'; a.text = T.started;
  } else if (ev.kind === 'stop') {
    if (a.comet) arrive(a, false);
    a.status = 'done'; a.kind = 'done'; a.text = T.done;
    a.hideAt = now + 2600;
    setTimeout(() => { labelsDirty = true; request(); }, 2700);
    if (ev.agent === 'main') { session.status = 'idle'; setProjectActive(null); }
  } else if (ev.kind === 'think') {
    a.kind = 'think'; a.text = T.thinking;
    if (animating() && a.pos) { ripples.push({ p: a.pos, t: tSec(now), c: a.rgb }); busy(now + 2500); }
  } else {
    a.kind = ev.kind;
    a.text = ev.text;
    if (a.comet) arrive(a, false); // a new action before the last comet landed: land it now
    const to = at(ev.node);
    if (!animating() || !a.pos) { a.comet = { to, node: ev.node, kind: ev.kind }; arrive(a, false); }
    else {
      const from = a.pos, d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
      const out = Math.hypot(mid[0], mid[1]) || 1;
      const ctrl = [mid[0] + (mid[0] / out) * d * 0.25, mid[1] + (mid[1] / out) * d * 0.25 + d * 0.1, mid[2] + 0.18 + d * 0.3];
      const dur = 520 + 480 * Math.min(1, d / 1.2);
      a.comet = { from, to, ctrl, t0: now, dur, node: ev.node, kind: ev.kind };
      busy(now + dur + 40);
    }
  }
  renderNow();
  labelsDirty = true;
  request();
}

function arrive(a, animate) {
  const c = a.comet, i = c.node, now = performance.now();
  a.comet = null; a.node = i; a.pos = at(i);
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
}

// Embers cool in steps (1 min, 5 min, 15 min), checked every 15 s, so a cooling node costs one frame per step.
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
let raf = 0, lastFrame = 0;
function request() {
  if (!raf && R && view === 'brain' && !document.hidden) raf = requestAnimationFrame(frame);
}
function frame(now) {
  raf = 0;
  if (!R || view !== 'brain' || document.hidden) return;
  if (anim && now - lastFrame < FRAME_MS - 2) { raf = requestAnimationFrame(frame); return; } // 30 fps cap
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  // project emphasis eases toward its target
  for (let k = 0; k < 32; k++) {
    const d = projTarget[k] - projCur[k];
    if (Math.abs(d) > 0.002) { projCur[k] += anim ? d * Math.min(1, dt / 220) : d; staticKey++; } else projCur[k] = projTarget[k];
  }
  for (const a of agents.values()) if (a.comet && (!anim || now >= a.comet.t0 + a.comet.dur)) arrive(a, anim);
  if (camDirty) updateCamera();
  const time = tSec(now);
  ripples = ripples.filter((r) => time - r.t < 2.4);
  for (let k = rings.length - 1; k >= 0; k--) if (now - rings[k].t0 > rings[k].dur) rings.splice(k, 1);
  const haze = buildSprites(now);
  R.draw({ vp: VP, px: PX, time, ripples, proj: projCur }, { haze, staticKey });
  if (labelsDirty) layoutLabels();
  placeChips(now);
  if (anim && now < busyUntil) request();
}

// Haze per region, then agent markers, comet trails and rings, in one sprite buffer.
let spriteData = new Float32Array(0), heatSig = '', heatAt = -1e9, heatTimer = 0;
const lobeOf = (i) => graph.regions[nodes[i].region].lobe;
function buildSprites(now) {
  const list = [];
  for (const g of graph.regions) {
    const n = L.count[g.id];
    if (!n || (g.project != null && !filter.projects.has(g.project))) continue;
    const pf = g.project == null ? 1 : projCur[projIndex.get(g.project)];
    const s = Math.max(0.2, L.spread[g.id] * 5);
    list.push(...L.centroid[g.id], s, ...P.haze, 0.17 * pf * pf * (focusSet || matchSet ? 0.4 : 1), 0);
  }
  const heat = {};
  const shown = heatSig ? Object.fromEntries(heatSig.split(',').filter(Boolean).map((x) => [x.replace(/[\d.]+$/, ''), Number(x.match(/[\d.]+$/)[0])])) : {};
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') heat[lobeOf(a.node)] = 1;
  for (const [i] of embers) heat[lobeOf(i)] = Math.max(heat[lobeOf(i)] || 0, state[i * 4 + 1] * 0.6);
  for (const [lobe, h] of Object.entries(shown)) {
    const { c, r } = LOBE_SHAPES[lobe], wide = r[0] >= r[1], k = wide ? r[0] : r[1];
    for (const t of [-0.5, 0, 0.5]) list.push(c[0] + (wide ? t * k : 0), c[1] + (wide ? 0 : t * k), c[2], Math.min(r[0], r[1]) * 3.4, ...P.lobeGlow, 0.075 * h, 0);
  }
  const sig = Object.entries(heat).map(([l, h]) => l + h.toFixed(2)).sort().join();
  // The glow lives in the cached layer; a change rebuilds it, so it follows the work at most every 2 s.
  if (sig !== heatSig && now - heatAt > 2000) { heatSig = sig; heatAt = now; staticKey++; }
  else if (sig !== heatSig && !heatTimer) heatTimer = setTimeout(() => { heatTimer = 0; request(); }, 2100 - (now - heatAt));
  const haze = list.length / 9;
  for (const a of agents.values()) {
    if (!a.pos || (a.hideAt && now > a.hideAt)) continue;
    const fade = a.status === 'done' ? 0.5 : 1;
    if (a.comet) {
      const u = (now - a.comet.t0) / a.comet.dur;
      for (let k = 12; k >= 0; k--) {
        const p = cometAt(a.comet, u - k * 0.03);
        const f = 1 - k / 13;
        list.push(...p, 0.022 + 0.05 * f * f, ...a.rgb, (k ? 0.55 : 1) * f, 0);
      }
    } else {
      list.push(...a.pos, 0.11, ...a.rgb, 0.35 * fade, 0, ...a.pos, 0.07, ...a.rgb, 0.9 * fade, 1);
    }
  }
  for (const r of rings) {
    const u = (now - r.t0) / r.dur, e = 1 - (1 - u) ** 3;
    list.push(...r.p, (0.04 + 0.13 * e) * (r.s || 1), ...r.rgb, (1 - u) * 0.9, 1);
  }
  if (focus != null) list.push(...at(focus), size[focus] * 2.2, ...P.accent, 0.95, 1);
  if (list.length > spriteData.length) spriteData = new Float32Array(list.length * 2);
  spriteData.set(list);
  R.setSprites(spriteData.subarray(0, list.length));
  return haze;
}

// ---- labels and chips (DOM over the canvas; transforms only) --------------------------------------------------
const labelBox = $('labels'), chipBox = $('chips');
const LOBE_AT = { prefrontal: [1.07, 0.24, 0], frontal: [0.56, 0.84, 0], parietal: [-0.3, 0.88, 0], occipital: [-1.06, 0.34, 0],
  temporal: [0.46, -0.5, 0], cerebellum: [-0.92, -0.56, 0], stem: [-0.08, -0.98, 0] };
const lobeEls = {};
const regionEls = new Map();
function regionName(g) {
  if (T.regionNames[g.label]) return T.regionNames[g.label];
  const parts = g.label.split('/');
  return parts[parts.length - 1] === 'api' || parts[parts.length - 1] === '__tests__' ? parts.slice(-2).join('/') : parts[parts.length - 1];
}
function layoutLabels() {
  labelsDirty = false;
  const taken = [];
  const free = (x, y, w, h) => !taken.some((r) => x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + h);
  for (const [lobe, p3] of Object.entries(LOBE_AT)) {
    let el = lobeEls[lobe];
    if (!el) { el = lobeEls[lobe] = document.createElement('span'); el.className = 'lbl lobe'; labelBox.append(el); }
    const [a, b] = T.lobes[lobe];
    const html = W < 520 ? esc(b) : `<b>${esc(a)}</b> · ${esc(b)}`;
    if (el.innerHTML !== html) { el.innerHTML = html; el._w = 0; }
    const p = project(p3);
    const w = (el._w ||= el.offsetWidth || 120), h = 16;
    const x = Math.max(8, Math.min(W - w - 8, p3[0] < -0.6 ? p[0] - w - 6 : p3[0] > 0.9 ? p[0] + 6 : p[0] - w / 2));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(p[1] - h / 2)}px)`;
    el._box = [x, p[1] - h / 2, w, h];
    taken.push([x - 4, p[1] - h / 2 - 2, w + 8, h + 4]);
  }
  const live = new Set();
  for (const a of agents.values()) if (a.node != null && a.status !== 'done') live.add(nodes[a.node].region);
  const multi = filter.projects.size > 1;
  const cands = graph.regions.filter((g) => L.count[g.id] && (g.project == null || filter.projects.has(g.project))).map((g) => {
    let pr = L.count[g.id];
    if (g.project === session.project && session.status === 'working') pr += 200;
    if (live.has(g.id)) pr += 1000;
    if (focus != null && nodes[focus].region === g.id) pr += 2000;
    return [g, pr];
  }).sort((x, y) => y[1] - x[1]);
  const max = Math.round((14 * Math.min(1, W / 1000)) / Math.min(1, cam.zoom)); // fewer labels on narrow wells
  let shown = 0;
  for (const [g, pr] of cands) {
    let el = regionEls.get(g.id);
    const ok = shown < max || pr >= 1000;
    const c = project(L.centroid[g.id]);
    const suffix = multi && g.project && !(session.status === 'working' && g.project === session.project);
    const text = `${esc(regionName(g))}${suffix ? `<small>${esc(g.project)}</small>` : ''}`;
    const w = (regionName(g).length + (suffix ? g.project.length + 1 : 0)) * 6.6 + 4, h = 15;
    const x = c[0] - w / 2, y = c[1] - h / 2;
    const fits = ok && c[2] > 0 && x > 8 && x + w < W - 8 && y > 40 && y + h < H - 8 && free(x - 3, y - 2, w + 6, h + 4);
    if (!fits) { if (el && !el.hidden) el.hidden = true; continue; }
    if (!el) { el = document.createElement('span'); el.className = 'lbl region'; regionEls.set(g.id, el); labelBox.append(el); }
    if (el.innerHTML !== text) el.innerHTML = text;
    el.classList.toggle('on', pr >= 1000);
    if (el.hidden) el.hidden = false;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el._box = [x, y, w, h];
    taken.push([x - 3, y - 2, w + 6, h + 4]);
    shown++;
  }
}
function placeChips(now) {
  const placed = [];
  for (const a of agents.values()) {
    const show = a.pos && !(a.hideAt && now > a.hideAt + 400);
    if (!a.chip) {
      if (!show) continue;
      a.chip = document.createElement('span');
      a.chip.className = 'chip';
      a.chip.innerHTML = `<span class="dot" style="background:${a.css}"></span><span class="who"></span><span class="k"></span><code></code>`;
      chipBox.append(a.chip);
    }
    a.chip.hidden = !show;
    if (!show) continue;
    a.chip.classList.toggle('gone', !!(a.hideAt && now > a.hideAt));
    const p = project(a.comet ? cometAt(a.comet, (now - a.comet.t0) / a.comet.dur) : a.pos);
    const [, who, k, code] = a.chip.children;
    const verb = { read: T.v_read, edit: T.v_edit, command: T.v_command, error: T.v_error, think: T.thinking, done: T.done, start: T.started }[a.kind] || '';
    const compact = W < 520;
    const key = `${a.def.label}|${verb}|${a.kind}|${a.text}|${compact}`;
    if (a.chipKey !== key) { // text changed: rewrite it; its width is measured once below
      a.chipKey = key;
      setText(who, compact ? a.def.label.split(' ')[0] : a.def.label);
      setText(k, compact ? '' : verb);
      k.className = `k ${a.kind}`;
      setText(code, !compact && ['read', 'edit', 'command', 'error'].includes(a.kind) ? a.text : '');
      a.chipW = 0;
    }
    placed.push([a, p[0] + 12, p[1] - 26]);
  }
  // Two agents on neighboring stars: stack their chips instead of overlapping them.
  placed.sort((x, y) => x[2] - y[2]);
  const boxes = [];
  for (const [a] of placed) if (!a.chipW) a.chipW = a.chip.offsetWidth || 160; // reads after all text writes: one layout at most
  for (const [a, x0, y0] of placed) {
    const el = a.chip, w = a.chipW, x = Math.max(8, Math.min(W - w - 8, x0));
    let y = y0;
    for (const b of boxes) if (x < b[0] + b[2] && b[0] < x + w && y < b[1] + 24 && b[1] < y + 24) y = b[1] + 25;
    boxes.push([x, y, w, a]);
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }
  const busyBoxes = boxes.map(([x, y, w]) => [x, y, w, 22]); // every chip; markers only for agents at rest (below)
  for (const [a, x0, y0] of placed) if (!a.comet) busyBoxes.push([x0 - 26, y0 + 12, 28, 28]); // the agent's marker, under its chip
  const hit = (b) => busyBoxes.some((o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3]);
  for (const el of [...regionEls.values(), ...Object.values(lobeEls)]) {
    const under = !el.hidden && !!el._box && hit(el._box);
    if (el._under !== under) { el._under = under; el.classList.toggle('under', under); }
  }
}

// ---- the Now panel (agents legend) -----------------------------------------------------------------------------
function renderNow() {
  const st = $('nowStatus');
  st.className = `status ${session.status}`;
  setText($('nowStatusText'), session.status === 'working' ? T.working : T.idle);
  setText($('nowProject'), session.project);
  const ul = $('agentList');
  for (const a of agents.values()) {
    if (!a.li) {
      a.li = document.createElement('li');
      a.li.innerHTML = `<span class="sw" style="background:${a.css}"></span><span class="lb"></span><span class="st"></span><span class="act"></span>`;
      ul.append(a.li);
    }
    const [, lb, stt, act] = a.li.children;
    setText(lb, a.def.label);
    setText(stt, a.status === 'done' ? T.done : a.status === 'idle' ? T.idle : a.id === 'main' ? T.working : T.running);
    const verb = { read: T.v_read, edit: T.v_edit, command: T.v_command, error: T.v_error, think: T.thinking, start: T.started, done: a.def.task || '' }[a.kind] || '';
    setText(act, ['read', 'edit', 'command', 'error'].includes(a.kind) ? `${verb} ${a.text}` : a.kind === 'done' ? (a.def.task || T.done) : verb || a.def.task || '');
    a.li.className = a.status === 'done' ? 'done' : '';
  }
}

// ---- filters, search, focus, tooltip -----------------------------------------------------------------------------
const SHAPE_SVG = {
  file: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/>',
  instruction: '<path d="M8 2.5L13.5 8L8 13.5L2.5 8Z" fill="currentColor"/>',
  memory: '<path d="M8 3L13.5 12.5H2.5Z" fill="currentColor"/>',
  serena: '<rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/>',
  tool: '<circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/>',
};
const shapeIcon = (t) => `<svg viewBox="0 0 16 16" aria-hidden="true">${SHAPE_SVG[t]}</svg>`;
const lineIcon = (t) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8H15" stroke="currentColor" stroke-width="1.5" ${t === 'cochange' ? 'stroke-dasharray="2.5 2"' : ''}/></svg>`;

function renderFilters() {
  const typeCount = Object.fromEntries(NODE_TYPES.map((t) => [t, nodes.filter((n) => n.type === t).length]));
  const edgeCount = Object.fromEntries(EDGE_TYPES.map((t) => [t, edges.filter((e) => e.type === t).length]));
  $('typeList').innerHTML = NODE_TYPES.map((t) => `<li><label><input type="checkbox" data-type="${t}" ${filter.types.has(t) ? 'checked' : ''}>${shapeIcon(t)}<span class="nm">${esc(T['t_' + t])}</span><span class="n">${typeCount[t]}</span></label></li>`).join('');
  $('edgeList').innerHTML = EDGE_TYPES.map((t) => `<li><label><input type="checkbox" data-edge="${t}" ${filter.edges.has(t) ? 'checked' : ''}>${lineIcon(t)}<span class="nm">${esc(T['e_' + t])}</span><span class="n">${edgeCount[t]}</span></label></li>`).join('');
  $('kindLegend').innerHTML = ['read', 'edit', 'error', 'command', 'focus'].map((k) => `<li><span class="dot ${k === 'focus' ? 'sel' : k}"></span>${esc(T['k_' + k])}</li>`).join('');
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
  const n = nodes[i], st = stats[i];
  const kind = `${shapeIcon(n.type)}${esc(T['t_' + n.type])} · ${esc(n.project || T.shared)}`;
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

// ---- pointer: orbit, pan, zoom, hover, click ---------------------------------------------------------------------
let drag = null;
function pick(x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (!visible[i] || scr[i * 3 + 2] <= 0) continue;
    const dx = scr[i * 3] - x, dy = scr[i * 3 + 1] - y, d2 = dx * dx + dy * dy;
    const r = Math.max(7, (size[i] * PX) / scr[i * 3 + 2] * 0.22 + 3);
    if (d2 < r * r && d2 < bd) { bd = d2; best = i; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 2 };
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    canvas.classList.add('dragging');
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const k = (2 * Math.tan(FOV / 2) * fitDist() * cam.zoom) / H;
      cam.target[0] -= dx * k * Math.cos(cam.yaw); cam.target[2] += dx * k * Math.sin(cam.yaw); cam.target[1] += dy * k;
    } else {
      cam.yaw = Math.max(-0.7, Math.min(0.7, cam.yaw - dx * 0.005));
      cam.pitch = Math.max(-0.35, Math.min(0.4, cam.pitch + dy * 0.004));
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
  if (was && !was.moved) {
    const r = canvas.getBoundingClientRect();
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    setFocus(i >= 0 ? i : null);
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoom = Math.max(0.3, Math.min(1.6, cam.zoom * Math.exp(e.deltaY * 0.0012)));
  hideTip();
  camDirty = true;
  request();
}, { passive: false });
const zoomBy = (f) => { cam.zoom = Math.max(0.3, Math.min(1.6, cam.zoom * f)); camDirty = true; request(); };
$('zoomIn').addEventListener('click', () => zoomBy(0.8));
$('zoomOut').addEventListener('click', () => zoomBy(1.25));
$('resetView').addEventListener('click', () => { Object.assign(cam, { yaw: -0.22, pitch: 0.1, zoom: 1, target: [0.02, -0.02, 0] }); camDirty = true; request(); });

new ResizeObserver(() => {
  const r = $('well').getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  if (R) R.resize(W, H, Math.min(2, devicePixelRatio || 1));
  camDirty = true;
  request();
}).observe($('well'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; return; }
  for (const a of agents.values()) if (a.comet) arrive(a, false); // what happened while hidden lands at once
  rings.length = 0; ripples = [];
  request();
});

// ---- switches: animations, view, theme, language, prototype controls --------------------------------------------
const animSwitch = $('animSwitch');
function setAnim(on, save) {
  anim = on;
  animSwitch.setAttribute('aria-checked', String(on));
  if (save) try { localStorage.setItem('kevmind.brain.anim', on ? 'on' : 'off'); } catch {}
  if (!on) {
    for (const a of agents.values()) if (a.comet) arrive(a, false);
    rings.length = 0; ripples = [];
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
  else { for (const a of agents.values()) if (a.comet) arrive(a, false); request(); }
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
  renderFilters();
  renderNow();
  renderFocus();
  renderReplay();
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
setTheme((() => { try { return localStorage.getItem('kevmind.theme') || 'system'; } catch { return 'system'; } })());
setAnim(anim, false);
applyLang(lang);
setView('brain');
if (!params.has('noreplay')) nextEvent();
// For the benchmark harness: counters only, read over CDP.
window.__brain = { nodes: N, edges: edges.length, frames: () => frames, staticDraws: () => (R ? R.staticDraws || 0 : 0), firstFrameMs: () => firstFrame, get busy() { return busyUntil > performance.now(); } };
let frames = 0, firstFrame = 0;
const _draw = R ? R.draw.bind(R) : null;
if (R) R.draw = (...a) => { frames++; if (!firstFrame) firstFrame = Math.round(performance.now()); return _draw(...a); };
