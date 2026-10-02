// The Brain view: what KevMind knows about your projects, as a brain. Nodes are real files and tools (graph.js),
// placed in lobes (layout.js) and drawn by a WebGL2 renderer (gl.js), with DOM labels, agent tags, filters, focus and
// an activity trace on top. mountBrain() builds the view inside a host element and returns its handle: the dashboard
// (public/brain.js) gives it the graph and the live session's events; the benchmark harness (prototype/brain) gives
// it synthetic ones. Rendering rules: nothing renders while the tab is hidden or another view is shown; frames are
// capped at 30 fps and the loop stops as soon as nothing moves (camera, beams, flashes, Follow, Auto-rotate);
// "Animations off" (or reduced motion) draws single static frames.
import { NODE_TYPES, EDGE_TYPES, rng, pathFinder, pathKey } from './graph.js';
import { layout, lobeAt, insideBrain, enclosed, pathInside, shellPoints, shellFilaments, purkinjeTrees, lobeShape, LOBES, BRAIN_CENTER, BRAIN_RADIUS, STEM_AXIS, CALLOSUM, callosumY } from './layout.js';
import { Renderer, oklch, KIND, SHAPE, EDGE, SPRITE, NODE_FLOATS, FIBER_FLOATS, SPRITE_FLOATS, INTRO, perspective, multiply, orbitView } from './gl.js';

// The view's own markup: the rail (search, filters, legends) and the well (canvas, labels, tags, panels). Words come
// from the host's strings by data-bi18n (not data-i18n, which the dashboard fills from its own table).
const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${d}</svg>`;
// The legend's small pictures of each action's figure.
const FX_ICONS = {
  read: '<circle cx="12" cy="12" r="8.5" opacity=".4"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  edit: '<circle cx="11" cy="13" r="5"/><path d="M17 7l2.5-2.5M18.5 12H21M11 5.5V3"/>',
  create: '<circle cx="12" cy="12" r="2.6"/><path d="M12 9.4V4M14.3 13.3L19 16M9.7 13.3L5 16"/>',
  search: '<path d="M3 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 16c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>',
  command: '<path d="M12 21V8M8.5 11.500L12 8l3.5 3.5"/><circle cx="12" cy="4.5" r="1.5" fill="currentColor"/>',
  web: '<path d="M6 18L17 7M17 7h-5.500M17 7v5.5"/><path d="M20 13a8 8 0 0 1-8 8" opacity=".45"/>',
  agent: '<circle cx="9" cy="14.5" r="4.5"/><circle cx="17.5" cy="7" r="2.3"/><path d="M12.5 11.500l3-2.6"/>',
  wait: '<circle cx="12" cy="12" r="8"/><path d="M12 7.500V12l3 2"/>',
  error: '<path d="M13 3L6 13.500h5l-1 7.5 7-10.500h-5z"/>',
  done: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="8" opacity=".4"/>',
};
// An agent's name on its tag: "Claude", or a subagent's number ("#2", with its type when there is room). With several
// sessions on screen its project follows as a badge ("Claude · OdonMind", "#2 · OdonMind": the type gives way). Small
// (a narrow screen, until tapped): the project's initials only ("OM", "#2 OM"); the dot's color says who.
function tagOf(main, label, type, project, small) {
  if (small) { const ini = project ? initialsOf(project) : ''; return [main ? ini || label : ini ? `${label} ${ini}` : label, '']; }
  const who = main || project || !type ? label : `${label} ${type}`;
  return [who, project ? `· ${project}` : ''];
}
// A project's initials, for small tags: "demo-agency" → "DA", "OdonMind" → "OM", "kevmind" → "K".
function initialsOf(name) {
  return (String(name).match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) || [String(name)]).map((w) => w[0].toUpperCase()).join('').slice(0, 3);
}
const TEMPLATE = `
<aside class="rail" id="rail">
  <details class="filters" id="filters" open>
    <summary data-bi18n="filters"></summary>
    <div class="search">${ICON('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>')}<input type="search" id="search" autocomplete="off" spellcheck="false" data-bi18n-placeholder="search" /><kbd aria-hidden="true">/</kbd></div>
    <ul class="results" id="results" aria-live="polite"></ul>
    <section><h2 class="head" data-bi18n="projects"></h2><ul class="checks" id="projectList"></ul></section>
    <section><h2 class="head" data-bi18n="nodeTypes"></h2><ul class="checks" id="typeList"></ul></section>
    <section><h2 class="head" data-bi18n="edgeTypes"></h2><ul class="checks" id="edgeList"></ul></section>
    <section><h2 class="head" data-bi18n="regions"></h2><ul class="legend regions" id="regionLegend"></ul></section>
    <section><h2 class="head" data-bi18n="colors"></h2><ul class="legend" id="kindLegend"></ul></section>
  </details>
</aside>
<section class="well" id="well" aria-labelledby="wellTitle">
  <canvas id="brain" role="img"></canvas>
  <div class="labels" id="labels" aria-hidden="true"></div>
  <div class="chips" id="chips" aria-hidden="true"></div>
  <div class="overlay tl">
    <div class="titlerow"><h2 class="title" id="wellTitle" data-bi18n="viewBrain"></h2><span class="muted" id="counts"></span><span class="filtered" id="filtered" hidden><span data-bi18n="filtersOn"></span> · <button type="button" id="filtersReset" data-bi18n="filtersReset"></button></span></div>
    <p class="hint" id="hint" data-bi18n="hint"></p>
    <div class="seg sessmode" role="group" id="sessMode" data-bi18n-label="sessMode" hidden>
      <button type="button" data-mode="one" aria-pressed="true" data-bi18n="sessOne"></button>
      <button type="button" data-mode="all" aria-pressed="false" data-bi18n="sessAll"></button>
    </div>
  </div>
  <div class="overlay tr">
    <div class="animrow"><div class="fxhelp" id="fxHelp">
      <button type="button" class="fxbtn" id="fxBtn" aria-expanded="false" aria-controls="fxLegend" data-bi18n-label="fxTitle">${ICON('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.9M12 17h.01"/>')}</button>
      <div class="fxlegend" id="fxLegend" role="note"></div>
    </div>
    <button type="button" class="switch" role="switch" id="animSwitch" aria-checked="true"><span class="knob"></span><span data-bi18n="anim"></span></button></div>
    <div class="seg looks" role="group" data-bi18n-label="look">
      <button type="button" id="labelsBtn" aria-pressed="false" data-bi18n="labels"></button>
      <button type="button" id="cutBtn" aria-pressed="false" data-bi18n="cut"></button>
    </div>
  </div>
  <aside class="card fcard" id="focusCard" hidden aria-live="polite"></aside>
  <div class="overlay bl">
    <div class="trace" id="trace">
      <div class="trace-top"><span class="dot"></span><b id="traceState"></b><small data-bi18n="trace"></small></div>
      <div class="trace-legend" id="traceLegend"></div>
      <canvas id="eeg" role="img"></canvas>
    </div>
    <div class="seg camera" role="group" data-bi18n-label="camera">
      <button type="button" id="zoomIn" data-bi18n-label="zoomIn">${ICON('<path d="M12 5v14M5 12h14"/>')}</button>
      <button type="button" id="zoomOut" data-bi18n-label="zoomOut">${ICON('<path d="M5 12h14"/>')}</button>
      <button type="button" id="fitBtn" data-bi18n="fit"></button>
      <button type="button" id="relayoutBtn" data-bi18n="relayout"></button>
      <button type="button" id="followBtn" aria-pressed="false" data-bi18n="follow"></button>
      <button type="button" id="rotateBtn" aria-pressed="false" data-bi18n="rotate"></button>
    </div>
  </div>
  <div class="overlay br now" id="brainNow">
    <ul class="sessions" id="sessList"></ul>
    <ul class="others" id="othersList" hidden></ul>
  </div>
  <div class="tip" id="tip" hidden></div>
  <p class="nogl" id="noGl" hidden data-bi18n="noWebgl"></p>
</section>`;

// The shell is the same for every graph: built once per size and kept across mounts (about 280 ms the first time).
const shells = new Map();

// host: the element the view fills (class "brain-view"). env:
//   graph: { projects, regions, nodes, edges } (graph.js's assemble(), or the harness's synthetic one);
//   strings(): the words, in the current language; lang(): its code, for number and date formats;
//   project: the id of the project being worked on (the one lit while a session works);
//   options: { skip: [layers not drawn, for benchmarks], shell: its brightness (checks), light: the phone's lighter
//     brain, bloom: 'off' | 'light' | 'full' | 'only', intro: false for none, camera: { yaw, pitch, zoom } to start
//     from, shown: false to start hidden };
//   onReady(): the intro is over (or was skipped): events may flow.
//   Several sessions at once (optional): events then carry `session` (its id); setSession({ id, project, title })
//   names each one's project, dropSession(id) lets one go. onMode(mode) ('one' | 'all') shows the header's switch
//   between the selected session and every live one; onPick(id): a session was clicked in the panel.
// Returns { onEvent, seed, reset, setSession, dropSession, setWaiting, setOthers, setMode, setLang, show, hide, camera,
//   destroy, debug }.
export function mountBrain(host, env) {
  const opt = env.options || {};
  const SKIP = new Set(opt.skip || []); // benchmark only: draw without some layers
  const SHELL = Number(opt.shell) || 1; // checks only: the shell this many times as bright, so its outline reads
  // Phones (and options.light) get a lighter brain to save battery: fewer shell dots, 20 frames a second, fewer fiber segments.
  const LIGHT = !!opt.light || matchMedia('(max-width: 640px), (pointer: coarse)').matches;
  const FRAME_MS = 1000 / (LIGHT ? 20 : 30);
  // Bloom: both octaves on a GPU, the tight one only on phones, none on a software renderer (there it costs about a core
  // and a half, and at 3,000 nodes that renderer is already under the frame cap); it also steps down by itself (see
  // paceBloom) on a machine that can't hold the frame rate with it. options.bloom forces a level, for checks.
  const BLOOM = opt.bloom || null;
  let bloomLevel = BLOOM === 'off' ? 0 : BLOOM === 'light' || (LIGHT && BLOOM !== 'full') ? 1 : 2;
  const FOV = (24 * Math.PI) / 180;
  const T0 = performance.now();
  host.innerHTML = TEMPLATE;
  // Everything listening outside the host (the document, media queries) goes with this signal when the view is destroyed.
  const ac = new AbortController(), outside = { signal: ac.signal };
  const observers = [];
  const $ = (id) => document.getElementById(id);
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  const setClass = (el, c, on) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- words: the host's, in its language ------------------------------------------------------------------------
  let lang = env.lang(), T = env.strings();

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
    dust: C(80, 0.025, 250), dustTint: C(74, 0.07, 292), filCbl: C(93, 0.03, 170), filStem: C(93, 0.025, 85), filAlpha: 0.34 * SHELL, filWidth: LIGHT ? 1.7 : 1.4,
    dustAlpha: 0.3 * SHELL, dustSize: LIGHT ? 0.0145 : 0.0105, dustEdge: 0.5,
    // threshold, knee, the tight octave's strength, the wide one's, and the most the bloom adds to a pixel: a hot area
    // stays a bright spot of its region's color, never a white-out.
    bloom: LIGHT ? [0.35, 0.3, 0.7, 0, 0.4] : [0.3, 0.3, 0.9, 0.3, 0.45],
    breath: C(80, 0.09, 42), // Claude thinking: a soft glow of its coral through the whole brain
    lobeMix: 0.3, // how much of its lobe's color a strand of the shell takes
  };
  // What each kind of action lights a cell as: a search reads; the web and other tools are commands; a new file is an edit.
  const BASE = { search: 'read', web: 'command', tool: 'command', create: 'edit' };
  const baseOf = (k) => BASE[k] || k;
  const kindRgb = (k) => P.kinds.slice(KIND[baseOf(k)] * 3, KIND[baseOf(k)] * 3 + 3);
  // A change's two colors (lines added, lines removed) and the amber of waiting for the user.
  const FX = { add: C(78, 0.15, 155), del: C(72, 0.17, 25), wait: C(83, 0.14, 80) };
  const whiten = (c, k) => c.map((v) => v + (1 - v) * k);
  const DENDRITE_ALPHA = P.edgeAlpha[EDGE.dendrite];
  // Categorical color per lobe kind: the brain view's one exemption from one-hue-per-meaning (DESIGN.md, Brain view).
  // Regions in a lobe shift a little around its hue so neighbors stay apart.
  // One saturated hue per lobe, told apart at a glance: amber, blue, violet, cyan, magenta, green, and a warm white for
  // the brainstem. Their lightness differs too, so the pairs that color-blind eyes confuse by hue (blue and violet,
  // cyan and green, amber and green) stay apart: the closest pair is 14.6 apart in OKLab x100 with normal vision and
  // 9.0, 7.7 and 7.3 with simulated protanopia, deuteranopia and tritanopia (it was 3.7, 2.3, 2.7 and 2.2). The amber
  // sits at hue 90, well away from Claude's coral (38), which no region uses.
  const LOBE_COLOR = { prefrontal: [84, 0.16, 90], frontal: [72, 0.14, 254], parietal: [61, 0.2, 298], occipital: [81, 0.11, 204],
    temporal: [67, 0.24, 350], cerebellum: [88, 0.18, 146], stem: [93, 0.03, 85] };
  P.filLobe = Object.keys(LOBES).flatMap((l) => C(...LOBE_COLOR[l])); // in the layout's lobe order
  // Agents are told from regions by kind, not by hue: regions are colors; subagents are silver-white (marker, trail,
  // tag dot), told apart by their number; Claude itself is coral, a color no region uses (its marker, its trail and
  // its breath). So an agent can never pass for a region.
  const AGENT_MAIN = [74, 0.14, 38], AGENT_SUB = [93, 0.008, 260];
  const AGENT_SUB_CSS = 'oklch(82% 0.012 260)'; // the ring around a subagent's white dot, in the tag and the panel

  // ---- data ----------------------------------------------------------------------------------------------------
  const graph = env.graph;
  const N = graph.nodes.length;
  const nodes = graph.nodes, edges = graph.edges, regions = graph.regions;
  let L = layout(graph);
  const projIndex = new Map(graph.projects.map((p, i) => [p.id, i]));
  const projName = new Map(graph.projects.map((p) => [p.id, p.name]));
  const pname = (id) => (id == null ? T.shared : projName.get(id) || id);
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
      const hh = h + [0, 7, -7, 12, -12][k % 5], ll = l + [0, 3, -3][k % 3]; // inside its lobe's band of hue
      regionColor[g.id] = C(ll, c, hh);
      regionCss[g.id] = `oklch(${clamp(ll + 6, 76, 92)}% ${c} ${hh})`;
    }
  }
  // As text: lifted to at least 76% lightness, so the darkest hues (violet, magenta) keep AA on the night.
  const lobeCss = (lobe) => { const [l, c, h] = LOBE_COLOR[lobe]; return `oklch(${Math.max(76, l + 4)}% ${c} ${h})`; };

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
  // The cells' own light goes by how crowded a lobe really is, not against the average: an outline carries little light,
  // so cells only dim where thousands share a lobe (full neon at 600 nodes, the same balance as before at 3,000).
  const REF_DENSITY = 3000 / Object.values(LOBES).reduce((t, s) => t + s.vol, 0);
  const neon = Object.fromEntries(Object.entries(LOBES).map(([l, s]) => [l, clamp((REF_DENSITY / ((lobeLoad[l] || 1) / s.vol)) ** 0.6, 0.42, 1.12)]));
  // The same for links: where thousands cross, each draws fainter (the six link types; the midline and beams keep theirs).
  const linkScale = clamp((900 / Math.max(1, edges.length)) ** 0.65, 0.3, 1);
  P.edgeAlpha = P.edgeAlpha.map((v, k) => (k < 6 ? v * linkScale : v));
  // Size grows a little with activity (under 2x from the quietest to the busiest), so no cell dominates.
  const sizeOf = (i) => 0.72 * (nodes[i].type === 'instruction' ? 0.08 : 0.05 + 0.0035 * Math.sqrt(Math.min(activityOf(i), 120))) * clamp(crowdOf(i) ** 0.4, 0.58, 1.2);
  const brightOf = (i) => (nodes[i].type === 'instruction' ? 1 : 0.72 + 0.28 * Math.min(1, Math.sqrt(activityOf(i) / 70))) * neon[lobeOf(i)];

  // Outlines by room. A lobe's patch of screen holds only so many outlines before they merge into a painted patch and
  // the tissue behind is lost: about one per 150 px² at overview for a full-size cell (less for the smaller cells of a
  // crowded lobe). Each lobe's cells are ranked by importance (instructions, then activity); minor[i] is a cell's rank
  // over its lobe's room, so cells under 1 are outlines at overview and the rest collapse to small points of their
  // color. The shader gives more room as the camera comes closer and less to the far side, and a cell that is hot,
  // focused or found is always an outline. At 600 nodes every lobe has room for all its cells.
  const AREA_PER_OUTLINE = 150, OVERVIEW_PX = 350; // px², and px per unit of the brain at overview on a desktop
  const minor = new Float32Array(N);
  {
    const by = {};
    for (let i = 0; i < N; i++) (by[lobeOf(i)] = by[lobeOf(i)] || []).push(i);
    const weight = (i) => (nodes[i].type === 'instruction' ? 1e6 : 0) + activityOf(i);
    for (const [l, list] of Object.entries(by)) {
      const s = LOBES[l], k = clamp(gain[l] ** 0.4, 0.58, 1.2);
      const room = (1.21 * (s.vol / (s.midline ? 1 : 2)) ** (2 / 3) * OVERVIEW_PX ** 2) / (AREA_PER_OUTLINE * k * k);
      list.sort((a, b) => weight(b) - weight(a));
      list.forEach((i, r) => { minor[i] = r / room; });
    }
  }
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
      d.set([...at(i), size[i], SHAPE[n.type], n.project == null ? -1 : projIndex.get(n.project), ...regionColor[n.region], Math.abs(seed), partOf(i), minor[i]], i * NODE_FLOATS);
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
    const count = LIGHT ? 12000 : 26000;
    if (!shells.has(count)) { const points = shellPoints(count); shells.set(count, { sh: points, fil: shellFilaments(points) }); }
    const { sh, fil } = shells.get(count), n = sh.part.length;
    shellXYZ = new Float32Array(n * 4); // x, y, z, part: for framing and the outline
    for (let i = 0; i < n; i++) {
      const y = sh.pos[i * 3 + 1], k = sh.part[i] * 2;
      shellXYZ.set([sh.pos[i * 3], y, sh.pos[i * 3 + 2], sh.part[i]], i * 4);
      partY[k] = Math.min(partY[k], y); partY[k + 1] = Math.max(partY[k + 1], y);
    }
    return { sh, fil };
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
  // agents' pulses take (across hemispheres, over the corpus callosum's arch). They are the links that are shown,
  // added up: hide a kind of link, a project or a kind of node and the bundles are counted again without them. With
  // them, fixed and decorative: the corpus callosum itself (strands along its arch), the brainstem as a bright bundle
  // fanning up into both hemispheres, and Purkinje cells in the cerebellum. Pulses run along the strands while work
  // goes on.
  let tractStrands = []; // [{ pts, rgb, lobes }]: where pulses run
  let purkinje = { segs: [], somas: [] };
  const edgeShown = (e) => visible[e.a] && visible[e.b] && filter.edges.has(e.type);
  // The lanes between lobes, from the links shown: the 10 busiest that carry at least 3 links and 3% of them.
  function lanesOf() {
    const lanes = new Map();
    let cross = 0, total = 0;
    for (const e of edges) {
      if (!edgeShown(e)) continue;
      const ga = nodes[e.a].region, gb = nodes[e.b].region, ka = `${regions[ga].lobe}|${L.side[ga]}`, kb = `${regions[gb].lobe}|${L.side[gb]}`;
      if (ka === kb) continue;
      total++;
      if (L.side[ga] * L.side[gb] < 0) cross++;
      const key = ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
      lanes.set(key, (lanes.get(key) || 0) + 1);
    }
    const top = [...lanes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).filter(([, c], k) => k < 10 && c >= Math.max(3, total * 0.03));
    let shown = 0;
    for (const e of edges) if (edgeShown(e)) shown++;
    // The corpus callosum and the brainstem's bundle are scenery, but they look like bundles of links: with few links
    // shown they dim (down to 30%), so they are not read as links that are not there.
    const share = shown / Math.max(1, edges.length), w = clamp((share - 0.02) / 0.48, 0, 1);
    return { top, crossShare: cross / Math.max(1, total), fixed: 0.3 + 0.7 * w * w * (3 - 2 * w) };
  }
  function tractData({ top, crossShare, fixed }) {
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
    const white = whiten;
    const frame = (d) => { const e1 = v3.unit(v3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); return [e1, v3.cross(d, e1)]; };
    // 1. The busiest lanes, from the links themselves. Each lane's strands come from its own name, so a bundle keeps
    // its shape when the filters change which other lanes are drawn.
    const max = top.length ? top[0][1] : 1;
    for (const [key, count] of top) {
      let seed = 23;
      for (let q = 0; q < key.length; q++) seed = (Math.imul(seed, 31) + key.charCodeAt(q)) | 0;
      const r = rng(seed);
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
    const cc = C(88, 0.04, 250), kc = (0.45 + 0.55 * Math.min(1, crossShare * 3)) * fixed;
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
      strand(pts, sb, EDGE.structure, j < 4 ? 2.2 : 1.6, j < 4 ? 1 : 0, 0.9 * fixed, 2, new Set(['stem']), 0.06);
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
  if (opt.camera) { Object.assign(cam, opt.camera); Object.assign(goal, opt.camera); } // where it was, when the view is rebuilt
  let follow = false, autoRotate = false, lastInput = 0, lastEvent = -1e9;
  let W = 1, H = 1, VP = null, PX = 1, basis = null, depth = [3, 6], camDirty = true, camVersion = 0, scrVersion = -1, labelsDirty = true;
  let staticKey = 0; // bumped whenever the main cache (haze and links over the deep cache) must be redrawn
  let deepKey = 0; // bumped whenever the deep cache (ground, shell, dendrites, tracts) must be redrawn
  const scr = new Float32Array(N * 3);
  const projCur = new Float32Array(32).fill(0.8), projTarget = new Float32Array(32).fill(0.8);
  const embers = new Map();
  const rings = [];
  const flashes = []; // a region glowing where an agent just landed
  const heats = [], HEAT_R = 0.2; // [{ i, t0 }]: cells an agent just left, cooling; within HEAT_R hot spots merge
  const sparks = [], SPARK_MS = 650; // [{ i, t0, rgb, life, big }]: cells a pulse just passed through, or a search matched
  const effects = []; // the figures of the actions under way (see "actions")
  const born = new Map(), BIRTH_MS = 1400; // cells being born: i -> { t0: when its figure started, links: its links show }
  const unborn = (i) => { const b = born.get(i); return !!b && !b.links; };
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
  const introAllowed = () => anim && !reduced.matches && opt.intro !== false;
  const tSec = (now = performance.now()) => (now - T0) / 1000;

  // ---- renderer --------------------------------------------------------------------------------------------------
  const canvas = $('brain');
  let R = null;
  const edgeHl = new Float32Array(edges.length);
  // ponytail: two fixed levels; the coarse one exists for software and weak GPUs, where cost grows with segments.
  const lod = [{ cross: LIGHT ? 8 : 14, same: 2 }, { cross: 1, same: 1 }].map((x) => ({ ...x, owner: new Int32Array(0), hl: new Float32Array(0) }));
  let fine = null; // the smooth fibers, for signals running along them
  let tractHl = new Float32Array(0), tractShown = new Float32Array(0);
  let tractSig = null;
  function syncTracts(force) {
    const lanes = lanesOf(), sig = `${lanes.top.map(([k, c]) => `${k}:${c}`).join(',')}|${Math.round(lanes.crossShare * 50)}|${Math.round(lanes.fixed * 20)}`;
    if (sig === tractSig && !force) return;
    tractSig = sig;
    const td = tractData(lanes);
    tractHl = td.hl;
    tractShown = new Float32Array(tractHl);
    pulses.length = 0; // they ran along the old strands
    if (R) R.setLayer('tracts', td.data, tractShown);
  }
  function seeNodes() {
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      visible[i] = filter.types.has(n.type) && (n.project == null ? filter.projects.size > 0 : filter.projects.has(n.project)) ? 1 : 0;
    }
  }
  function uploadGeometry() {
    R.setNodes(nodeData(), state);
    const nd = neuronData();
    R.setLayer('dendrites', nd.data, neuron.hl);
    seeNodes();
    syncTracts(true);
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
    if (R.software && !BLOOM) bloomLevel = 0;
    const shell = shellData();
    uploadGeometry();
    R.setDust(shell.sh);
    R.setFilaments(shell.fil);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (view !== 'gone') $('noGl').hidden = false; });
  } catch (err) {
    console.warn(err);
    $('noGl').hidden = false;
  }

  // ---- visibility, emphasis, lit paths -----------------------------------------------------------------------------
  function nodeBright(i, evenBorn) {
    if (!visible[i] || (born.has(i) && !evenBorn)) return 0; // a cell being born is drawn by its figure
    let b = bright[i];
    if (focusSet) b *= focusSet.has(i) ? 1.4 : 0.14;
    else if (matchSet) b *= matchSet.has(i) ? 1.4 : 0.16;
    if (cutAway(i)) return 0; // the cut-away half: gone, so nothing shows outside the half that stays
    // + 10: the focus, its neighbors and search hits are always drawn as outlines (the shader takes the 10 back).
    return Math.max(b, 0.002) + ((focusSet && focusSet.has(i)) || (matchSet && matchSet.has(i)) ? 10 : 0);
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
      if (v && (cutAway(e.a) || cutAway(e.b) || unborn(e.a) || unborn(e.b))) v = 0; // a cell being born has no links yet
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
      let v = visible[i] ? (0.35 + 0.6 * bright[i]) * crowdOf(i) * (minor[i] > 1 ? 0.5 : 1) : 0; // crowded lobes: dimmer, like their nodes; fainter for the cells drawn as points
      if (v && focusSet) v = focusSet.has(i) ? (i === focus ? 2.6 : 1.7) : 0.12;
      else if (v && matchSet) v = matchSet.has(i) ? 1.7 : 0.12;
      if (cutAway(i) || born.has(i)) v = 0; // a cell being born grows its own branches (activeNeurons)
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
    // A cell being born: its branches grow, the main ones first.
    const nowMs = performance.now();
    for (const [i, b] of born) {
      const u = clamp((nowMs - b.t0) / BIRTH_MS, 0, 1), all = neuron.segsOf[i] || [];
      all.forEach((s, k) => {
        const w = clamp((u * 1.25 - 0.15 - (k / all.length) * 0.6) / 0.25, 0, 1);
        if (w > 0) { segs.push(...neuron.data.subarray(s * FIBER_FLOATS, (s + 1) * FIBER_FLOATS)); hl.push(2.4 * w); }
      });
    }
    R.setLayer('active', new Float32Array(segs), new Float32Array(hl));
  }
  function refresh() {
    seeNodes();
    for (let i = 0; i < N; i++) state[i * 4] = nodeBright(i);
    if (R) R.updateState(state);
    const shown = edgeLights();
    syncTracts();
    deepLights();
    activeNeurons();
    let n = 0;
    for (let i = 0; i < N; i++) n += visible[i];
    setText($('counts'), T.counts(filter.projects.size, n, shown));
    // Something is hidden by a filter: say so next to the counts, with the way back, so it is not read as missing data.
    $('filtered').hidden = filter.projects.size === graph.projects.length && filter.types.size === NODE_TYPES.length && filter.edges.size === EDGE_TYPES.length;
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
    // The fog runs from the brain's near side to its far side; zoomed in, from just in front of what is looked at, so a
    // close-up keeps its colors.
    depth = [Math.max(wc - BRAIN_RADIUS, basis.dist * 0.6), wc + BRAIN_RADIUS];
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
    // Auto-rotate keeps turning through everything (agents working, events, Follow moving the camera: then it orbits
    // what Follow looks at, a little slower). Only the user's hand pauses it (a drag, a zoom, a click); 3 s after the
    // last touch it comes back, easing in over about a second.
    if (autoRotate && anim && !drag) {
      const since = now - lastInput - 3000;
      if (since > 0) { cam.yaw += 0.00012 * dt * smooth(0, 1200, since) * (follow && goal.zoom < 1 ? 0.6 : 1); goal.yaw = cam.yaw; moving = true; }
      else if (!rotateTimer) rotateTimer = setTimeout(() => { rotateTimer = 0; request(); }, 20 - since);
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
  // Follow: the camera eases toward where agents are working (only the session picked in the panel, when one is), and
  // back to the whole brain when nothing works.
  function followGoal() {
    if (!follow) return;
    const pick = sessions.has(followSid) ? followSid : null, now = performance.now();
    const pts = [...agents.values()].filter((a) => (pick == null || a.sid === pick) && a.pos && a.status !== 'done' && !(a.hideAt && now > a.hideAt)).map((a) => a.node != null ? at(a.node) : a.pos);
    if (pts.length && [...sessions.values()].some((s) => s.status === 'working' && (pick == null || s.id === pick))) {
      const c = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);
      if (pick == null && sessions.size > 1) {
        // Several sessions, none picked: the camera frames them all, wider the farther apart they work, and lets small
        // shifts pass, so busy sessions don't keep it (and every cached layer) moving: on a software renderer at
        // 3,000 nodes that held 17 frames a second instead of 25.
        const zoom = clamp(0.62 + 0.45 * Math.max(...pts.map((p) => dist3(p, c))), 0.62, 1);
        if (dist3(c, goal.target) < 0.16 && Math.abs(zoom - goal.zoom) < 0.1) { request(); return; }
        goal.target = c; goal.zoom = zoom;
      } else { goal.target = c; goal.zoom = 0.62; }
    } else { goal.target = [...HOME.target]; goal.zoom = 1; }
    request();
  }

  // ---- agents, beams, embers ---------------------------------------------------------------------------------------
  // Sessions: one (id ''), or several at once when the host sends each event with its session's id. Each has its own
  // Claude (agent key "<session>/main") and subagents, all in the same colors (coral, silver): with several on screen,
  // a tag says its project. The projects of the sessions at work are lit.
  const agents = new Map();
  const sessions = new Map(); // id -> { id, status: 'idle' | 'working', project, title, order, li }
  let sessOrder = 0, followSid = null, hoverProject = null;
  function sess(id = '') {
    let s = sessions.get(id);
    if (!s) { s = { id, status: 'idle', project: id === '' ? env.project ?? null : null, title: '', order: sessOrder++, li: null }; sessions.set(id, s); }
    return s;
  }
  sess('');
  const agentKey = (sid, local) => (sid ? `${sid}/${local}` : local);
  const workingProjects = () => { const lit = new Set(); for (const s of sessions.values()) if (s.status === 'working' && s.project != null) lit.add(s.project); return lit; };
  const defs = new Map(); // agent key -> { label, type, task }, from the events
  let silent = false; // applying what already happened: no animation
  function agentOf(key, sid = '', local = key) {
    let a = agents.get(key);
    if (!a) {
      const main = local === 'main', hue = main ? AGENT_MAIN : AGENT_SUB;
      const def = defs.get(key) || { label: main ? 'Claude' : local, type: main ? 'main' : '', task: '' };
      a = { id: key, sid, local, main, def, css: main ? `oklch(${hue[0]}% ${hue[1]} ${hue[2]})` : AGENT_SUB_CSS, rgb: C(...hue), status: 'idle', node: null, pos: null, comet: null, after: null, kind: '', text: '', chip: null, li: null, hideAt: 0 };
      agents.set(key, a);
    }
    return a;
  }
  // What an agent is doing, in words: a verb and what it acts on (a file's name, a command). The verb is said once: a
  // text that already starts with it (a command described as "Run the tests", "Ejecutar pruebas") stands alone.
  function saying(a) {
    if (isWaiting(a)) return { verb: T.v_wait, text: '', cls: 'wait' };
    const verb = { read: T.v_read, edit: T.v_edit, create: T.v_create, search: T.v_search, command: T.v_command, tool: T.v_command, web: T.v_web, error: T.v_error, think: T.thinking, done: T.done, start: T.started }[a.kind] || '';
    const text = ['read', 'edit', 'create', 'search', 'command', 'tool', 'web', 'error'].includes(a.kind) ? String(a.text || '').trim() : '';
    const first = (text.match(/^\p{L}+/u) || [''])[0].toLowerCase(), v = verb.toLowerCase();
    return { verb: first && (first === v || first + 's' === v || first === v + 'r') ? '' : verb, text, cls: baseOf(a.kind) };
  }
  function setWaiting(a, on) {
    if (!!a.waiting === on) return;
    a.waiting = on ? performance.now() : 0; // since when
    renderNow();
    labelsDirty = true;
    request();
  }
  const DONE_MS = 15_000;
  const dismiss = (a) => { a.chip?.remove(); a.li?.remove(); agents.delete(a.id); };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const headT = (c, now) => c.route.head(clamp((now - c.t0) / c.dur, 0, 1)); // how far along its route (0..1)
  const cometHead = (c, now) => c.route.pt(headT(c, now));
  const animating = () => anim && R && !document.hidden && view === 'brain' && !silent;
  const thinking = () => { for (const a of agents.values()) if (a.kind === 'think' && a.status !== 'done') return true; return false; };
  // Waiting for the user's OK: until the answer, or for WAIT_MS at most (a session that quiet has gone stale, and a
  // marker must not blink for hours in front of nobody).
  const WAIT_MS = 5 * 60_000;
  const isWaiting = (a, now = performance.now()) => !!a.waiting && a.status !== 'done' && now - a.waiting < WAIT_MS;
  const waiting = () => { for (const a of agents.values()) if (a.pos && isWaiting(a)) return true; return false; };

  // ---- routes: an agent's way from one cell to the next ----------------------------------------------------------
  // A thought travels through the network, never through the air. From cell to cell it follows real links: the path
  // with the fewest hops (at most 7) and, among those, the one over the strongest links, whatever the filters
  // show, along each link's own fiber. Where no such path exists nothing is invented through unrelated files: the
  // pulse takes the lane between the two lobes (the tracts' way), or passes by the regions' centers inside one lobe.
  // Every point of a route is kept inside the brain's volume. A route is worked out once per pair of cells and kept.
  const graphPath = pathFinder(N, edges);
  const lerp3 = (p, q, w) => [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
  const dist3 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  // n + 1 points evenly spaced along a polyline.
  function resample(poly, n) {
    const cum = [0], out = [];
    for (let j = 1; j < poly.length; j++) cum.push(cum[j - 1] + dist3(poly[j - 1], poly[j]));
    for (let q = 0, j = 0; q <= n; q++) {
      const d = (cum[cum.length - 1] * q) / n;
      while (j < poly.length - 2 && cum[j + 1] < d) j++;
      out.push(lerp3(poly[j], poly[j + 1], cum[j + 1] > cum[j] ? (d - cum[j]) / (cum[j + 1] - cum[j]) : 0));
    }
    return out;
  }
  // A link's fiber as drawn (the smooth level), in the direction traveled.
  function fiberPoints(k, forward) {
    const n = fine.segs[k], o = fine.start[k] * FIBER_FLOATS, d = fine.data, pts = [];
    for (let j = 0; j < n; j++) pts.push([d[o + j * FIBER_FLOATS], d[o + j * FIBER_FLOATS + 1], d[o + j * FIBER_FLOATS + 2]]);
    const e = o + (n - 1) * FIBER_FLOATS;
    pts.push([d[e + 3], d[e + 4], d[e + 5]]);
    return forward ? pts : pts.reverse();
  }
  // For the checks: of a polyline's points (each segment's ends and three points between), how many are outside the
  // brain's parts, how many of those are in the open (no part on both sides of them), and how far out the farthest is
  // (0.02, 0.04, 0.08 or more: the nearest step at which a point around it is inside).
  const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0], [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]].map((d) => v3.unit(d));
  function outsideOf(pts) {
    const o = { points: 0, outside: 0, open: 0, far: 0 };
    for (let j = 0; j + 1 < pts.length; j++) for (let q = j ? 1 : 0; q <= 4; q++) {
      const p = lerp3(pts[j], pts[j + 1], q / 4);
      o.points++;
      if (insideBrain(p)) continue;
      o.outside++;
      if (!enclosed(p)) o.open++;
      o.far = Math.max(o.far, [0.02, 0.04, 0.08].find((rad) => AROUND.some((u) => insideBrain(v3.add(p, u, rad)))) || 0.16);
    }
    return o;
  }
  const routes = new Map();
  // { pts, cum (0..1 along it), hops (0: no real path, a glide), marks: the cells passed [{ t, i }], legs: each hop as
  // { key (its link, or the pair of cells for a glide), t0, t1 }, length, span (the bright head's share), head(u): where
  // the head is at time u, pt(t) }.
  function routeTo(a, b) {
    const key = a * N + b;
    if (routes.has(key)) return routes.get(key);
    const from = at(a), to = at(b), path = graphPath(a, b), pts = [from], passed = [];
    if (path) {
      const per = clamp(Math.round(18 / path.length), 5, 14); // segments per hop
      let u = a;
      path.forEach((k, h) => {
        const fwd = edges[k].a === u, v = fwd ? edges[k].b : edges[k].a;
        pts.push(...pathInside(resample(fiberPoints(k, fwd), per)).slice(1)); // the link's own fiber, kept inside the brain
        if (h < path.length - 1) passed.push([pts.length - 1, v]);
        u = v;
      });
    } else {
      const ga = nodes[a].region, gb = nodes[b].region, ca = L.centroid[ga], cb = L.centroid[gb];
      let pt;
      if (regions[ga].lobe !== regions[gb].lobe || L.side[ga] !== L.side[gb]) pt = lanePath(from, ga, to, gb);
      else if (ga !== gb) pt = bspline([from, ca, cb, to]);
      else { const c = lerp3(lerp3(from, to, 0.5), ca, 0.5); pt = (t) => [0, 1, 2].map((i) => (1 - t) * (1 - t) * from[i] + 2 * (1 - t) * t * c[i] + t * t * to[i]); }
      pts.push(...pathInside([from, ...Array.from({ length: 15 }, (_, q) => pt((q + 1) / 16)), to]).slice(1));
    }
    const cum = new Float32Array(pts.length);
    for (let j = 1; j < pts.length; j++) cum[j] = cum[j - 1] + dist3(pts[j - 1], pts[j]);
    const length = cum[pts.length - 1] || 1e-6;
    for (let j = 0; j < pts.length; j++) cum[j] /= length;
    cum[pts.length - 1] = 1;
    const hops = path ? path.length : 0, stops = [0, ...passed.map(([j]) => cum[j]), 1], n = stops.length - 1;
    const share = stops.slice(1).map((t, j) => 0.5 / n + 0.5 * (t - stops[j])); // each hop's share of the time
    const route = {
      pts, cum, hops, length, marks: passed.map(([j, i]) => ({ t: cum[j], i })), span: hops > 1 ? Math.max(0.18, 0.75 / hops) : 0.6,
      legs: path ? path.map((k, j) => ({ key: k, t0: stops[j], t1: stops[j + 1] })) : [{ key: -1 - (a < b ? a * N + b : b * N + a), t0: 0, t1: 1 }],
      // Hop by hop: the head slows into each cell and out of it.
      head(u) {
        if (n === 1) return ease(u);
        let j = 0, t0 = 0;
        while (j < n - 1 && u > t0 + share[j]) t0 += share[j++];
        const w = clamp((u - t0) / share[j], 0, 1);
        return stops[j] + (stops[j + 1] - stops[j]) * w * w * (3 - 2 * w);
      },
      pt(t) {
        let j = 0;
        while (j < pts.length - 2 && cum[j + 1] < t) j++;
        return lerp3(pts[j], pts[j + 1], cum[j + 1] > cum[j] ? clamp((t - cum[j]) / (cum[j + 1] - cum[j]), 0, 1) : 0);
      },
    };
    if (routes.size > 600) routes.clear();
    routes.set(key, route);
    return route;
  }

  // ---- actions: what each kind of work looks like ---------------------------------------------------------------
  // One short figure per kind of action, so what an agent does can be told at a glance, without reading its tag:
  //   read      a soft ripple closes in on the cell
  //   edit      a spark redraws the cell's outline; green dots go in for the lines added and red ones leave for the
  //             lines removed, only when the event says how many (a dot per PER_DOT lines, MAX_DOTS at most)
  //   create    the cell is born: it fades in, its branches grow, its links reach out
  //   search    a wave sweeps the folder searched; the files that matched light up as it reaches them
  //   command   a pulse runs up the brainstem when it starts and down when it ends
  //   web       a beam leaves the brain and comes back: the only signal that goes outside
  //   subagent  a silver spark splits off Claude's marker and becomes the subagent
  //   wait      Claude's marker blinks amber until the user answers (drawn with the markers, in buildSprites)
  //   error     a short red flicker, like a short circuit
  //   stop      one calm wave
  // Each is a few sprites (the web's beam and a newborn's links are ribbons) for under 1.5 s, then gone. With
  // animations off none is drawn: what is left is the cell's static light in its kind's color.
  const TAU = 2 * Math.PI, PER_DOT = 3, MAX_DOTS = 10;
  // sprites(list, u, now, fx) and beams(ribbon, u) draw the figure at u (0..1); end() runs when it is over.
  function effect(dur, sprites, beams = null, delay = 0, end = null) {
    if (!animating()) { if (end) end(); return; }
    const t0 = performance.now() + delay;
    effects.push({ t0, dur, sprites, beams, end });
    busy(t0 + dur + 60);
    request();
  }
  // On a narrow well (a phone) the brain is small, so the figures are drawn bigger there, up to 1.7 times: their
  // distances here, their sprites where they are drawn (buildSprites).
  const fxScale = () => clamp(820 / W, 1, 1.7);
  // A point at distance r from p, at an angle on the plane that faces the camera.
  const facing = (p, r, ang) => { const k = r * fxScale(); return [0, 1, 2].map((q) => p[q] + (basis.x[q] * Math.cos(ang) + basis.y[q] * Math.sin(ang)) * k); };

  function fxRead(i) {
    const p = at(i), rgb = kindRgb('read');
    effect(650, (list, u) => {
      for (let k = 0; k < 2; k++) { // two rings, one after the other, closing in
        const w = (u - k * 0.24) / 0.76;
        if (w > 0 && w < 1) list.push(...p, 0.05 + 0.24 * (1 - w) ** 1.5, ...rgb, 0.85 * Math.sin(Math.PI * w) ** 0.7, SPRITE.ring);
      }
    });
  }
  function fxEdit(i) {
    const p = at(i), rgb = kindRgb('edit'), hot = whiten(rgb, 0.55), a0 = Math.random() * TAU, r = 0.055; // just outside the agent's own ring
    effect(800, (list, u) => {
      const turn = (w) => a0 + ease(w) * TAU * 1.25, fade = 1 - u ** 3;
      for (let k = 0; k < 7; k++) list.push(...facing(p, r, turn(u) - k * 0.16), 0.04 - k * 0.004, ...(k ? rgb : hot), fade * (1 - k / 7), SPRITE.head); // the point that redraws the outline, and its tail
      for (let k = 0; k < 5; k++) { // sparks thrown off as it passes
        const from = 0.1 + k * 0.15, w = (u - from) / 0.3;
        if (w > 0 && w < 1) list.push(...facing(p, r + 0.07 * w, turn(from) + 0.5 * w), 0.02, ...hot, 0.9 * (1 - w), SPRITE.head);
      }
    });
  }
  // Lines added come in (green, from the upper left); lines removed leave (red, to the lower right).
  const dots = (n) => (n > 0 ? Math.min(MAX_DOTS, Math.ceil(n / PER_DOT)) : 0);
  function fxDiff(i, add, del, delay = 0) {
    const p = at(i), na = dots(add), nd = dots(del);
    if (!na && !nd) return;
    effect(620 + 70 * Math.max(na, nd), (list, u, now, fx) => {
      const t = u * fx.dur;
      for (let k = 0; k < na; k++) {
        const w = (t - k * 70) / 600; // one after another
        if (w > 0 && w < 1) list.push(...facing(p, 0.02 + 0.12 * (1 - ease(w)), 2.36 + ((k % 5) - 2) * 0.2), 0.032, ...FX.add, Math.sin(Math.PI * w) ** 0.5, SPRITE.head);
      }
      for (let k = 0; k < nd; k++) {
        const w = (t - k * 70) / 600;
        if (w > 0 && w < 1) list.push(...facing(p, 0.02 + 0.12 * ease(w), -0.78 + ((k % 5) - 2) * 0.2), 0.032, ...FX.del, 1 - w * w, SPRITE.head);
      }
    }, null, delay);
  }
  function fxError(i) {
    const p = at(i), rgb = kindRgb('error'), hot = whiten(rgb, 0.6);
    effect(560, (list, u, now) => {
      const on = [1, 0.1, 1, 0.25, 0.9, 0.5, 0.25, 0.1][Math.min(7, Math.floor(u * 8))]; // it stutters, then dies out
      list.push(...p, 0.16, ...rgb, 0.75 * on, SPRITE.glow, ...p, 0.075, ...rgb, 0.9 * on, SPRITE.ring);
      const tick = Math.floor(now / 70); // its sparks jump to another place every 70 ms
      for (let k = 0; k < 3; k++) {
        const s = Math.sin(tick * 12.9898 + k * 78.233) * 43758.5453, f = s - Math.floor(s);
        list.push(...facing(p, 0.022 + 0.035 * f, f * TAU * 3), 0.015, ...hot, on, SPRITE.head);
      }
    });
  }
  // A command: pulses along the brainstem's own strands, up when it starts, down when it ends.
  function fxStem(up) {
    if (!animating()) return;
    const now = performance.now(), rgb = whiten(kindRgb('command'), 0.55);
    tractStrands.filter((s) => s.lobes.size === 1 && s.lobes.has('stem')).slice(0, 3)
      .forEach((s, j) => pulses.push({ s, t0: now + j * 120, dur: 780, back: !up, span: [0.02, 0.6], size: 0.1, rgb }));
    busy(now + 1200);
  }
  // The web: a beam in the agent's color leaves the brain, touches the outside and comes back.
  function fxWeb(i, rgb) {
    // Outward as the camera sees it, so it is seen leaving the brain's outline: away from the brain's center on the
    // plane that faces the camera (down, from a cell in the middle), to just beyond the brain's edge.
    const p = at(i), d = [0, 1, 2].map((q) => p[q] - BRAIN_CENTER[q]), S = 10;
    let dx = d[0] * basis.x[0] + d[1] * basis.x[1] + d[2] * basis.x[2], dy = d[0] * basis.y[0] + d[1] * basis.y[1] + d[2] * basis.y[2];
    const off = Math.hypot(dx, dy);
    if (off < 0.08) { dx = 0; dy = -1; } else { dx /= off; dy /= off; }
    const out = [0, 1, 2].map((q) => basis.x[q] * dx + basis.y[q] * dy), far = Math.max(0.5, BRAIN_RADIUS * 1.05 - off);
    const pts = Array.from({ length: S + 1 }, (_, q) => v3.add(p, out, (far * q) / S)), way = { pts, cum: Float32Array.from(pts, (_, q) => q / S) };
    const reach = (u) => (u < 0.45 ? ease(u / 0.45) : u < 0.55 ? 1 : 1 - ease((u - 0.55) / 0.45)); // out, a beat outside, back
    effect(1250, (list, u) => {
      list.push(...v3.add(p, out, far * reach(u)), 0.07, ...rgb, 1, SPRITE.head);
      if (u > 0.4 && u < 0.62) { const w = (u - 0.4) / 0.22; list.push(...pts[S], 0.05 + 0.16 * w, ...rgb, 0.8 * (1 - w), SPRITE.ring); } // it touched the outside
    }, (ribbon, u) => {
      const h = reach(u);
      if (h > 0.02) ribbon(way, 0, h, () => 0.28, rgb, 8);
      if (u < 0.45) { const tail = Math.max(0, h - 0.5); if (h > tail) ribbon(way, tail, h, (t) => 0.9 * ((t - tail) / (h - tail)) ** 2, rgb, 14); }
      else if (u > 0.55 && h < 0.98) { const top = Math.min(1, h + 0.5); ribbon(way, h, top, (t) => 0.9 * (1 - (t - h) / (top - h)) ** 2, rgb, 14); }
    });
  }
  // A subagent: a spark in its color leaves Claude's marker in an arc and comes back as the subagent's own ring.
  function fxSpawn(a, p) {
    if (!animating()) return;
    const a0 = Math.random() * TAU;
    a.hatch = performance.now() + 620; // its marker shows when the spark lands
    effect(640, (list, u) => {
      const r = 0.12 * Math.sin(Math.PI * u), w = a0 + u * 2.4;
      list.push(...facing(p, r, w), 0.065 - 0.02 * u, ...a.rgb, 1, SPRITE.head, ...facing(p, r * 0.75, w - 0.3), 0.032, ...a.rgb, 0.5, SPRITE.head);
    }, null, 0, () => { const now = performance.now(); a.hatch = 0; if (animating()) { rings.push({ p, t0: now, dur: 650, rgb: a.rgb, s: 0.65 }); busy(now + 700); } });
  }
  // The cells a search looks through: the files under the folder it names, or its whole project.
  const rootKey = new Map(graph.projects.map((p) => [p.id, pathKey(p.root || '')]));
  function scopeOf(dir, project) {
    const key = dir ? pathKey(dir).replace(/\/+$/, '') : null, under = [], all = [];
    for (let i = 0; i < N; i++) {
      const n = nodes[i];
      if (n.type === 'tool' || n.project == null) continue;
      if (n.project === project) all.push(i);
      if (key) { const f = pathKey(`${rootKey.get(n.project)}/${n.path}`); if (f === key || f.startsWith(key + '/')) under.push(i); }
    }
    return under.length ? under : all;
  }
  let lastWave = null; // the newest search's wave: its matches light up as it reaches them
  function fxSearch(cells) {
    if (!animating() || !cells.length) return;
    const c = [0, 0, 0];
    for (const i of cells) { const p = at(i); for (let q = 0; q < 3; q++) c[q] += p[q] / cells.length; }
    let rad = 0.14;
    for (const i of cells) rad = Math.max(rad, dist3(c, at(i)));
    rad = Math.min(rad + 0.03, 0.8);
    const now = performance.now(), speed = rad / 1.0, rgb = kindRgb('read');
    ripples.push({ p: c, t: tSec(now), c: rgb.map((v) => v * 0.85), k: [speed, 1.15] }); // the cells light up as its front passes
    lastWave = { c, speed, t0: now };
    effects.push({ t0: now, dur: 1100, exact: true, sprites: (list, u) => { list.push(...c, 2.5 * rad * u, ...rgb, 0.45 * (1 - u) ** 1.3, SPRITE.ring); } }); // the wave's front, at its true size
    busy(now + 1200);
  }
  function fxHits(ids) {
    if (!animating() || !ids.length) return;
    const now = performance.now(), wave = lastWave && now - lastWave.t0 < 1500 ? lastWave : null, rgb = kindRgb('read');
    ids.slice(0, 24).forEach((i, k) => sparks.push({ i, rgb, life: 750, big: true, t0: Math.max(now + k * 30, wave ? wave.t0 + (dist3(wave.c, at(i)) / wave.speed) * 1000 : 0) }));
    busy(now + 2400);
  }
  // A cell about to be born is hidden (itself, its branches, its links) until its figure draws it.
  function hideUnborn(i) {
    if (born.has(i)) return;
    born.set(i, { t0: Infinity, links: false });
    state[i * 4] = 0;
    if (R) R.updateState(state, i, i + 1);
    edgeLights();
    deepLights();
  }
  function unhide(i) {
    if (!born.delete(i)) return;
    state[i * 4] = nodeBright(i);
    if (R) R.updateState(state, i, i + 1);
    edgeLights();
    deepLights();
    activeNeurons();
  }
  function birth(i) {
    if (!animating()) { unhide(i); return; }
    hideUnborn(i);
    const b = born.get(i), p = at(i), lit = whiten(regionColor[nodes[i].region], 0.45);
    if (b.t0 !== Infinity) return; // already under way
    b.t0 = performance.now();
    const links = adj[i].slice(0, 14).map((k) => { // its links' own fibers, from the new cell outward
      const pts = fiberPoints(k, edges[k].a === i), cum = new Float32Array(pts.length);
      for (let j = 1; j < pts.length; j++) cum[j] = cum[j - 1] + dist3(pts[j - 1], pts[j]);
      for (let j = 1; j < pts.length; j++) cum[j] /= cum[pts.length - 1] || 1;
      return { pts, cum };
    });
    effect(BIRTH_MS, (list, u) => {
      // A seed of light swells and a ring opens; the cell fades in inside it while its branches grow.
      list.push(...p, 0.06 + 0.2 * Math.sin(Math.PI * Math.min(1, u / 0.55)), ...lit, 0.75 * (1 - u) ** 1.3, SPRITE.glow);
      if (u < 0.6) list.push(...p, 0.03 + 0.17 * (u / 0.6), ...lit, 0.7 * (1 - u / 0.6), SPRITE.ring);
      state[i * 4] = nodeBright(i, true) * smooth(0.08, 0.6, u);
      R.updateState(state, i, i + 1);
      activeNeurons();
      if (u > 0.88 && !b.links) { b.links = true; edgeLights(); } // the links themselves take over from their ribbons
    }, (ribbon, u) => {
      const w = ease(clamp((u - 0.3) / 0.55, 0, 1)), fade = u < 0.85 ? 1 : (1 - u) / 0.15;
      if (w > 0.01) for (const l of links) ribbon(l, 0, w, () => 0.7 * fade, lit, 7);
    }, 0, () => unhide(i));
  }
  // The figure of an action, where the agent lands.
  function figure(c, a, i, now) {
    const k = c.kind;
    if (k === 'read') fxRead(i);
    else if (k === 'edit') { fxEdit(i); if (c.add != null) fxDiff(i, c.add, c.del, 280); }
    else if (k === 'create') birth(i);
    else if (k === 'web') fxWeb(i, a.rgb);
    else if (k === 'error') fxError(i);
    else { // a command, another tool, a search (its wave is already on its way): a ring opens where it lands
      rings.push({ p: at(i), t0: now, dur: 750, rgb: kindRgb(k) });
      if (k === 'command') fxStem(true);
    }
  }
  // What a call did, known a moment after it started: the lines an edit added and removed, the files a search
  // matched, a command that ended. { agent, session, node, add, del } | { hits: [nodes] } | { done: true }.
  function outcome(ev) {
    if (silent || !animating()) return;
    const a = agents.get(agentKey(ev.session || '', ev.agent));
    if (ev.hits) fxHits(ev.hits);
    if (ev.done) fxStem(false);
    if (ev.add != null && ev.node != null && a) {
      if (a.comet && a.comet.node === ev.node) { a.comet.add = ev.add; a.comet.del = ev.del; } // still on its way: shown when it lands
      else if (a.node === ev.node) fxDiff(ev.node, ev.add, ev.del);
    }
  }

  // ev: { agent, kind: start | stop | read | edit | create | search | command | web | tool | error | think | wait |
  // outcome, node, text, tokens, dir (a search's folder), add, del (an edit's lines, when known), def: the agent's
  // { label, type, task }, ts: when it happened (only for what is applied from the past, see seed), session: its
  // session's id when several are shown }.
  function onEvent(ev) {
    if (ev.kind === 'outcome') { outcome(ev); return; }
    const now = performance.now(), age = ev.ts ? Math.max(0, Date.now() - ev.ts) : 0;
    if (!silent) lastEvent = now;
    trace.add(ev, now - age);
    const sid = ev.session || '', S = sess(sid), key = agentKey(sid, ev.agent);
    if (ev.def) defs.set(key, ev.def);
    const a = agentOf(key, sid, ev.agent);
    if (ev.def) a.def = ev.def;
    const main = agentOf(agentKey(sid, 'main'), sid, 'main');
    if (ev.kind === 'wait') { setWaiting(a, true); return; }
    a.waiting = 0; // whatever it does next, the wait is over
    if (ev.kind === 'start') {
      a.status = a.main ? 'working' : 'running';
      a.hideAt = 0;
      if (a.main) {
        S.status = 'working';
        lightProjects();
        if (a.node == null) { // where Claude starts: its project's instructions
          let start = nodes.findIndex((n) => n.project === S.project && n.type === 'instruction');
          if (start < 0) start = nodes.findIndex((n) => n.project === S.project);
          if (start >= 0) { a.node = start; a.pos = at(start); }
        }
      } else {
        a.node = main.node; a.pos = main.pos; // it starts at the cell Claude is at (or just left)
        if (animating() && a.pos) fxSpawn(a, a.pos);
      }
      a.kind = 'start'; a.text = T.started;
    } else if (ev.kind === 'stop') {
      if (a.comet) arrive(a, false);
      if (a.node != null && animating()) {
        heats.push({ i: a.node, t0: now });
        if (a.status !== 'done') { // done: one calm wave, in its color
          const p = a.pos, rgb = a.rgb;
          ripples.push({ p, t: tSec(now), c: rgb, k: [0.3, 1.4] });
          effect(1400, (list, u) => { list.push(...p, 0.08 + 0.9 * u, ...rgb, 0.3 * (1 - u) ** 1.5, SPRITE.ring); });
        }
        busy(now + TRAIL_MS);
      }
      a.status = 'done'; a.kind = 'done'; a.text = T.done;
      a.hideAt = silent ? 1 : now + 2600;
      if (!silent) setTimeout(() => { labelsDirty = true; followGoal(); request(); }, 2700);
      if (a.main) { S.status = 'idle'; lightProjects(); }
      // A subagent that is done leaves the panel a little later (at once when it ended before the view opened): a
      // long session launches dozens, and the panel lists who is at work. Claude's row stays.
      else if (silent) dismiss(a);
      else setTimeout(() => { if (a.status === 'done' && agents.get(a.id) === a) { dismiss(a); renderNow(); } }, DONE_MS);
    } else if (ev.kind === 'think') {
      a.kind = 'think'; a.text = T.thinking;
      if (animating() && a.pos) { ripples.push({ p: a.pos, t: tSec(now), c: a.rgb }); busy(now + 2500); }
    } else {
      a.kind = ev.kind;
      a.text = ev.text;
      // An action from an agent that was never seen starting (or was seen ending): it is at work.
      if (a.status === 'idle' || a.status === 'done') { a.status = a.main ? 'working' : 'running'; a.hideAt = 0; }
      if (a.main && S.status !== 'working') { S.status = 'working'; lightProjects(); }
      if (a.comet) arrive(a, false); // a new action before the last beam landed: land it now
      const target = ev.node ?? a.node; // an action with no node of its own (a failure) shows where the agent is
      if (ev.kind === 'search') fxSearch(scopeOf(ev.dir, S.project)); // the wave starts at once, wherever the agent is
      const known = ev.add != null ? { add: ev.add, del: ev.del } : null; // what an edit changed, when the event already says
      if (target == null) { /* nowhere to show it yet: the tag and the panel still say what it does */ }
      else if (!animating() || a.node == null || !fine) { a.comet = { node: target, kind: ev.kind, ts: ev.ts, past: silent }; arrive(a, false); }
      else if (target === a.node) { a.comet = { node: target, kind: ev.kind, ...known }; arrive(a, true); } // the same cell again: its figure plays, nothing travels
      else {
        heats.push({ i: a.node, t0: now }); // where it was cools down
        const route = routeTo(a.node, target);
        // Over links: a beat per hop. With no path, a glide along the lane, as long as the way is.
        const dur = route.hops ? Math.min(1700, 420 + 260 * route.hops) : 620 + 580 * Math.min(1, route.length / 1.2);
        a.comet = { route, t0: now, dur, node: target, kind: ev.kind, next: 0, ...known };
        if (ev.kind === 'create') hideUnborn(target); // it is born when the agent gets there
        // A way taken again is drawn once: older trails give up the links this pulse runs over, so light doesn't pile up.
        const mine = new Set(route.legs.map((l) => l.key));
        for (const tr of trails) tr.c.legs.forEach((l, j) => { if (mine.has(l.key)) tr.off.add(j); });
        busy(now + dur + 40);
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
    if (c.route && animating()) { // its way stays as a trail that fades (also when the next action cut the trip short)
      if (animate) a.after = { c: c.route, t0: now }; // and the beam lingers a moment where it landed
      trails.push({ c: c.route, rgb: a.rgb, t0: now, off: new Set() });
      if (trails.length > 14) trails.shift();
      busy(now + TRAIL_MS + 60);
    }
    if (!c.past) { // what is applied from the past is already in the graph's counts
      if (c.kind === 'read') stats[i].reads++;
      if (c.kind === 'edit' || c.kind === 'create') stats[i].edits++;
    }
    stats[i].lastAt = Math.max(stats[i].lastAt, c.ts || Date.now());
    size[i] = sizeOf(i); bright[i] = brightOf(i);
    if (R) R.setSize(i, size[i]);
    embers.set(i, { kind: baseOf(c.kind), at: c.ts || Date.now() });
    if (c.kind === 'create' && !animate) unhide(i);
    state[i * 4] = nodeBright(i); state[i * 4 + 1] = 1; state[i * 4 + 2] = animate ? tSec(now) : -100; state[i * 4 + 3] = KIND[baseOf(c.kind)];
    if (R) R.updateState(state, i, i + 1);
    if (animate) { figure(c, a, i, now); const g = nodes[i].region, was = flashes.findIndex((f) => f.g === g); if (was >= 0) flashes.splice(was, 1); flashes.push({ g, t0: now }); busy(now + 1700); } // one flash per region: they don't pile up
    cooling();
    activeNeurons();
    if (focus === i) renderFocus();
    labelsDirty = true;
    followGoal();
  }

  // Embers cool in steps (1, 5, 15 min), checked every 15 s, so a cooling node costs one frame per step.
  let coolTimer = 0;
  function coolStep() {
    const now = Date.now();
    let changed = false;
    for (const [i, e] of embers) {
      const age = (now - e.at) / 1000;
      const s = age < 60 ? 1 : age < 300 ? 0.55 : age < 900 ? 0.28 : 0;
      if (state[i * 4 + 1] !== s) { state[i * 4 + 1] = s; changed = true; if (R) R.updateState(state, i, i + 1); }
      if (!s) { embers.delete(i); state[i * 4 + 3] = 0; }
    }
    return changed;
  }
  function cooling() {
    if (coolTimer) return;
    coolTimer = setTimeout(() => {
      coolTimer = 0;
      if (coolStep()) { activeNeurons(); request(); }
      if (embers.size) cooling();
    }, 15000);
  }

  // Lit: the projects of the sessions at work (several at once), the others a little dimmer; nothing at work, all calm
  // and a little dim. Hovering a session in the panel lights its project alone while the pointer is there.
  function lightProjects() {
    const lit = hoverProject != null ? new Set([hoverProject]) : workingProjects();
    projTarget.fill(!lit.size ? 0.8 : hoverProject != null ? 0.35 : 0.5);
    for (const id of lit) if (projIndex.has(id)) projTarget[projIndex.get(id)] = 1.15;
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
    if (env.onReady) env.onReady();
    request();
  }
  // The shaders' intro clock and the closing wave's radius.
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function introView(clock) {
    const u = (clock - INTRO.wave[0]) / INTRO.wave[1];
    return [clock, u >= 0 && u <= 1 ? u * BRAIN_RADIUS * 1.25 : -9, -9, 0];
  }
  // The bloom steps down by itself (full, light, off) on a machine that can't hold the frame rate with it. While frames
  // follow one another at the cap's pace, their average interval is watched; about a second and a half over 1.2 times
  // the cap's takes one step down, for the rest of the session.
  // ponytail: one way only; to step back up when the load eases, probe again after a while.
  const pace = { ema: 0, slow: 0, was: false };
  function paceBloom(dt, fast) {
    const run = fast && pace.was && dt < 250;
    pace.was = fast;
    if (!run || !bloomLevel || !anim || BLOOM) return;
    pace.ema = pace.ema ? pace.ema * 0.9 + dt * 0.1 : dt;
    pace.slow = pace.ema > FRAME_MS * 1.2 ? pace.slow + 1 : 0;
    if (pace.slow > 45) { bloomLevel--; pace.slow = 0; pace.ema = 0; }
  }
  function frame(now) {
    raf = 0;
    if (!R || view !== 'brain' || document.hidden) return;
    if (!intro.done && !intro.on) { if (introAllowed()) startIntro(now); else endIntro(); }
    // 30 fps cap; about 12 when only Claude's breath moves
    const fast = now < busyUntil || wasMoving || !!drag;
    if (anim && now - lastFrame < (fast ? FRAME_MS : 80) - 2) { raf = requestAnimationFrame(frame); return; }
    paceBloom(now - lastFrame, fast);
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
    for (const a of agents.values()) {
      const c = a.comet;
      if (!c) continue;
      if (!anim || now >= c.t0 + c.dur) { arrive(a, anim); continue; }
      if (c.route) for (const h = headT(c, now); c.next < c.route.marks.length && h >= c.route.marks[c.next].t - 1e-3; c.next++) {
        sparks.push({ i: c.route.marks[c.next].i, t0: now, rgb: a.rgb }); // a cell on the way lights up as the pulse passes
        busy(now + SPARK_MS);
      }
    }
    const moving = camStep(now, dt) || !!(drag && drag.moved);
    if (camDirty) updateCamera();
    if (cutChanged) { cutChanged = false; refresh(); }
    if (wasMoving && !moving) { staticKey++; labelsDirty = true; } // the camera stopped: redraw the static layers with smooth fibers, settle the labels
    wasMoving = moving;
    const time = tSec(now);
    ripples = ripples.filter((r) => time - r.t < (r.k ? r.k[1] : 2.4));
    for (let k = rings.length - 1; k >= 0; k--) if (now - rings[k].t0 > rings[k].dur) rings.splice(k, 1);
    const haze = buildSprites(now, clock);
    R.setBeams(buildBeams(now));
    // Neurons: faint dendrites at overview, full ones zoomed in (active neurons are always full, through their hl).
    P.edgeAlpha[EDGE.dendrite] = DENDRITE_ALPHA * (0.3 + 0.7 * smooth(1, 0.5, cam.zoom));
    const mid = project(BRAIN_CENTER); // the brain's center and radius on screen, for the intro's closing waves
    R.draw({ vp: VP, px: PX, room: (PX / basis.dist / OVERVIEW_PX) ** 2, time, ripples, proj: projCur, depth, eye: basis.eye, intro: introView(clock), yr: partY, center: BRAIN_CENTER, cut: cutSide, life: anim ? 1 : 0,
      mid, radiusPx: (BRAIN_RADIUS * PX) / mid[2], waveR: BRAIN_RADIUS },
    { haze, deepKey, mainKey: staticKey, skip: SKIP, lod: moving && !intro.on ? 1 : 0, glow: glowLayer(now, dt), introOn: intro.on, bloom: bloomLevel, bloomOnly: BLOOM === 'only' });
    if (intro.on && intro.t0 == null && ++intro.warm >= 2) intro.t0 = performance.now();
    // Labels fade out only for the user's hand: a drag and its throw. When the camera moves by itself (Auto-rotate,
    // Follow, a zoom) they stay and track their regions, laid out every frame.
    const hand = !!(drag && drag.moved) || Math.abs(vel.yaw) > 2e-5 || Math.abs(vel.pitch) > 2e-5;
    if (hand !== labelsAway) { labelsAway = hand; labelBox.classList.toggle('away', hand); if (!hand) labelsDirty = true; }
    setClass(labelBox, 'tracking', moving && !hand);
    if (!labelsAway && (labelsDirty || moving)) layoutLabels(moving);
    placeChips(now);
    if (anim && (now < busyUntil || moving || thinking() || waiting() || intro.on)) request();
  }

  // Haze per region and the lit lobes (cached layer), then agent heads, markers and rings.
  let spriteData = new Float32Array(0), heatSig = '', heatShown = {}, heatAt = -1e9, heatTimer = 0;
  const PK_RGB = C(90, 0.1, 146), STEM_RGB = C(92, 0.04, 85), CBL_GLOW = C(80, 0.1, 146);
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
    const big = fxScale();
    const stack = new Map(); // agents on the same cell: each one's ring a little wider, so all of them show
    for (const a of agents.values()) {
      if (!a.pos || (a.hideAt && now > a.hideAt) || (a.hatch && now < a.hatch)) continue;
      const fade = a.status === 'done' ? 0.5 : 1;
      if (a.comet && a.comet.route) { list.push(...cometHead(a.comet, now), 0.075, ...a.rgb, 1, SPRITE.head); continue; }
      const n = stack.get(a.node) || 0;
      stack.set(a.node, n + 1);
      list.push(...a.pos, 0.1 + 0.035 * n, ...a.rgb, 0.75 * fade, SPRITE.ring, ...a.pos, 0.045, ...a.rgb, 0.9 * fade, SPRITE.head);
      // Waiting for the user's OK: the marker blinks slowly in amber (a steady amber ring with animations off).
      if (isWaiting(a, now)) {
        const k = anim ? 0.5 - 0.5 * Math.cos((TAU * now) / 1600) : 1;
        list.push(...a.pos, (0.18 + 0.035 * n) * big, ...FX.wait, 0.15 + 0.75 * k, SPRITE.ring, ...a.pos, 0.28 * big, ...FX.wait, 0.2 * k, SPRITE.glow);
      }
    }
    // The figures of the actions under way.
    for (let k = effects.length - 1; k >= 0; k--) {
      const fx = effects[k], u = (now - fx.t0) / fx.dur;
      if (u >= 1 || !anim) { effects.splice(k, 1); if (fx.end) fx.end(); continue; }
      if (u < 0 || !fx.sprites) continue;
      const from = list.length;
      fx.sprites(list, u, now, fx);
      if (big > 1 && !fx.exact) for (let q = from + 3; q < list.length; q += SPRITE_FLOATS) list[q] *= big; // bigger on a phone
    }
    // Heat: where an agent works the light is hot, near white at its center; a cell it just left cools back to its
    // region's color in a few seconds. This is what the bloom picks up. Sources close together don't add up: the
    // strongest keeps its glow and one within HEAT_R of it only shows by how far it is, so several agents on
    // neighboring cells stay one bright spot, not a blob.
    const hot = [];
    for (const a of agents.values()) {
      if (a.node == null || a.comet || a.status === 'done' || (a.hideAt && now > a.hideAt)) continue;
      hot.push([a.pos, 1, nodes[a.node].region, 0]);
    }
    for (let k = heats.length - 1; k >= 0; k--) {
      const h = heats[k], u = (now - h.t0) / TRAIL_MS;
      if (u >= 1 || !anim) { heats.splice(k, 1); continue; }
      hot.push([at(h.i), 0.8 * (1 - u) ** 2, nodes[h.i].region, u]);
    }
    hot.sort((x, y) => y[1] - x[1]);
    for (let k = 0; k < hot.length; k++) {
      const [p, s, g, u] = hot[k];
      let v = s;
      for (let j = 0; j < k; j++) { const o = hot[j][0], d = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) / HEAT_R; if (d < 1) v = Math.min(v, s * d * d); }
      if (v < 0.03) continue;
      const rc = regionColor[g];
      list.push(...p, 0.11, ...whiten(rc, 0.4 * (1 - u)), 0.42 * v, SPRITE.glow, ...p, 0.05, ...whiten(rc, 0.8 * (1 - u)), 0.7 * v, SPRITE.glow);
    }
    for (let k = sparks.length - 1; k >= 0; k--) {
      const sp = sparks[k], u = (now - sp.t0) / (sp.life || SPARK_MS);
      if (u >= 1 || !anim) { sparks.splice(k, 1); continue; }
      if (u < 0) continue; // a match the search's wave has not reached yet
      const p = at(sp.i), s = sp.big ? 1.6 * fxScale() : 1;
      list.push(...p, 0.07 * s, ...whiten(regionColor[nodes[sp.i].region], 0.6), 0.6 * (1 - u) ** 2, SPRITE.glow, ...p, (0.03 + 0.05 * u) * s, ...sp.rgb, 0.8 * (1 - u), SPRITE.ring);
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
      const pts = pu.s.pts, [f0, f1] = pu.span || [0, 1], v = pu.back ? 1 - u : u; // span: the stretch of the strand it runs
      const f = (f0 + (f1 - f0) * v) * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)), w = f - j;
      list.push(pts[j][0] + (pts[j + 1][0] - pts[j][0]) * w, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * w, pts[j][2] + (pts[j + 1][2] - pts[j][2]) * w, pu.size || 0.04, ...(pu.rgb || pu.s.rgb), 0.9 * Math.sin(Math.PI * u), SPRITE.head);
    }
    // Claude thinking: a slow, warm breath through the whole brain (still, with animations off).
    if (thinking()) list.push(BRAIN_CENTER[0], BRAIN_CENTER[1] + 0.12, 0, 1.25, ...P.breath, anim ? 0.035 + 0.04 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 4200)) : 0.05, SPRITE.glow);
    if (focus != null) list.push(...at(focus), size[focus] * 1.6, ...P.accent, 0.95, SPRITE.ring);
    if (list.length > spriteData.length) spriteData = new Float32Array(list.length * 2);
    spriteData.set(list);
    R.setSprites(spriteData.subarray(0, list.length));
    return haze;
  }

  // Beams: a white-cored ribbon in the agent's color from where it was to where it goes, drawn up to the head. Behind
  // it the whole path stays as a thinner arc in the agent's color and fades over a few seconds: the agent's trail, so
  // its way from file to file can be seen.
  let beamData = new Float32Array(0);
  const trails = [], TRAIL_MS = 4500; // [{ c: the route, rgb, t0, off: the legs a newer pulse took over }], the newest 14
  function buildBeams(now) {
    const out = [];
    const thin = clamp(W / 900, 0.6, 1); // a phone's brain is small: thinner ribbons
    const ribbon = ({ pts, cum }, t0, t1, alphaAt, rgb, width = 16) => { // the route's own segments, from t0 to t1
      width *= thin;
      for (let j = 0; j + 1 < pts.length; j++) {
        const ta = Math.max(t0, cum[j]), tb = Math.min(t1, cum[j + 1]), span = cum[j + 1] - cum[j];
        if (tb - ta < 1e-5) continue;
        out.push(...lerp3(pts[j], pts[j + 1], (ta - cum[j]) / span), ...lerp3(pts[j], pts[j + 1], (tb - cum[j]) / span), 0, 0, ...rgb, ...rgb, EDGE.beam, width, 1, Math.max(0.004, alphaAt((ta + tb) / 2)), -1, 0);
      }
    };
    const trail = (t) => 0.5 * (0.55 + 0.45 * t); // a little brighter toward where it went
    for (let k = trails.length - 1; k >= 0; k--) {
      const tr = trails[k], age = (now - tr.t0) / TRAIL_MS;
      if (age >= 1 || !anim || tr.off.size === tr.c.legs.length) { trails.splice(k, 1); continue; }
      tr.c.legs.forEach((l, j) => { if (!tr.off.has(j)) ribbon(tr.c, l.t0, l.t1, (t) => trail(t) * (1 - age) ** 1.6, tr.rgb, 10); });
    }
    for (const a of agents.values()) {
      if (a.comet && a.comet.route) {
        const rt = a.comet.route, head = headT(a.comet, now), tail = Math.max(0, head - rt.span);
        if (tail > 0.01) ribbon(rt, 0, tail, trail, a.rgb, 10); // the way so far
        // The pulse: the link it is on glows, brightest at the head, down to the trail's light behind it (one ribbon,
        // so the two don't add up).
        if (head > tail) ribbon(rt, tail, head, (t) => { const w = (t - tail) / (head - tail), b = trail(t); return b + (0.92 - b) * w * w; }, a.rgb, 14);
      } else if (a.after) {
        const age = (now - a.after.t0) / 480, rt = a.after.c, t0 = 1 - rt.span;
        if (age >= 1) a.after = null;
        else ribbon(rt, t0, 1, (t) => 0.6 * (1 - age) * ((t - t0) / rt.span) ** 2, a.rgb, 14);
      }
    }
    for (const fx of effects) { const u = (now - fx.t0) / fx.dur; if (fx.beams && u >= 0 && u < 1) fx.beams(ribbon, u); }
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
  // Lobe labels: on the brain, each right on the region it names, with no box and no leader line. Plain text over a
  // soft dark halo: a dot and the lobe's name in its color, its role dimmer ("● Frontal · docs"); its folders under it
  // only for the lobe under the pointer, or the lobes in the middle of the view when zoomed in. Each is centered on the
  // projected center of its lobe's nodes in the hemisphere that faces the camera. Labels never overlap: by priority
  // (where agents work, then size) each takes the free spot nearest its center, and never leaves its region (it moves
  // at most 0.6 of the lobe's radius on screen; with no free spot there, it is not shown). Over a crowded patch of
  // cells the halo behind the letters is stronger. They fade out only while the user drags the brain (and while its
  // throw lasts); when the camera moves by itself (Auto-rotate, Follow, a zoom) they stay and track their regions:
  // each keeps its spot while it is free and glides to its place. Where agents work the label brightens and the others
  // dim; an agent's tag wins, and a label under one fades. On a phone, only the label of the lobe being worked on.
  const lobeEls = new Map();
  let chipBoxes = [];
  const chipLines = { svg: null, key: '' };
  const NS = 'http://www.w3.org/2000/svg';
  chipLines.svg = document.createElementNS(NS, 'svg');
  chipLines.svg.setAttribute('class', 'leaders chip-leaders');
  chipBox.prepend(chipLines.svg);
  let labelsAway = false; // faded out while the user drags
  const boxesHit = (b, o, m = 0) => b[0] < o[0] + o[2] + m && o[0] < b[0] + b[2] + m && b[1] < o[1] + o[3] + m && o[1] < b[1] + b[3] + m;
  // The panels over the well: labels stay clear of them. Read at most twice a second (they only change with the
  // agents list, the focus card and the well's size), so a moving camera doesn't read layout every frame.
  const panels = { at: -1e9, boxes: [] };
  function panelBoxes(now) {
    if (now - panels.at < 500) return panels.boxes;
    const wr = $('well').getBoundingClientRect();
    panels.at = now;
    panels.boxes = ['brainNow', 'trace', 'focusCard'].map($).concat([...document.querySelectorAll('.seg.camera, .overlay.tl, .overlay.tr')]).filter((el) => el && !el.hidden && el.offsetParent)
      .map((el) => { const r = el.getBoundingClientRect(); return [r.left - wr.left, r.top - wr.top, r.width, r.height]; });
    return panels.boxes;
  }
  // tracking: the camera is moving by itself, so labels keep their spots and glide instead of jumping.
  function layoutLabels(tracking = false) {
    labelsDirty = false;
    const taken = panelBoxes(performance.now()); // read before this function writes anything
    const live = new Set();
    for (const a of agents.values()) if (a.node != null && a.status !== 'done') live.add(nodes[a.node].region);
    const wc = project(BRAIN_CENTER)[2];
    // The hemisphere facing the camera (0, both, from the front, the back or above); cut open, the one that is left.
    const ez = basis.eye[2] - BRAIN_CENTER[2], near = cutSide ? -cutSide : Math.abs(ez) > 0.2 * basis.dist ? Math.sign(ez) : 0;
    const byLobe = new Map(), lit = workingProjects();
    for (const g of regions) {
      if (!L.count[g.id] || (g.project != null && !filter.projects.has(g.project))) continue;
      let pr = L.count[g.id];
      if (lit.has(g.project)) pr += 200;
      if (live.has(g.id)) pr += 1000;
      if (focus != null && nodes[focus].region === g.id) pr += 2000;
      if (!byLobe.has(g.lobe)) byLobe.set(g.lobe, []);
      byLobe.get(g.lobe).push([g, pr]);
    }
    let cands = [...byLobe].map(([lobe, list]) => {
      list.sort((x, y) => y[1] - x[1]);
      const facing = list.filter(([g]) => !near || !L.side[g.id] || L.side[g.id] === near), use = facing.length ? facing : list;
      const c = [0, 0, 0];
      let n = 0;
      for (const [g] of use) { const k = L.count[g.id]; n += k; for (let a = 0; a < 3; a++) c[a] += L.centroid[g.id][a] * k; }
      const names = [], seen = new Set();
      for (const [g] of list) { const nm = regionName(g); if (!seen.has(nm)) { seen.add(nm); names.push([nm, g.id]); } }
      const at = project(c.map((v) => v / n)), sh = lobeShape(lobe, near || 1);
      return { lobe, live: list.some(([, pr]) => pr >= 1000), n, at, reach: (0.6 * ((sh.r[0] + sh.r[1] + sh.r[2]) / 3) * PX) / at[2], names };
    })
      // A lobe on the far side of the brain (prefrontal from the back) has no label, unless agents work there.
      .filter((c) => c.at[2] > 0 && (c.live || c.at[2] - wc < 0.25 * BRAIN_RADIUS))
      // At overview, only the lobe under the pointer; all of them zoomed in or with the Labels toggle; none in the intro.
      .filter((c) => !intro.on && (labelsOn || cam.zoom < 0.72 || c.lobe === hoverLobe));
    // A phone: at most one label, the lobe of the most recent action where agents work.
    if (W < 520) {
      let recent = null, at = -1;
      for (const [i, e] of embers) if (e.at > at && cands.some((c) => c.live && c.lobe === lobeOf(i))) { at = e.at; recent = lobeOf(i); }
      cands = cands.filter((c) => c.live && c.lobe === (recent || cands.find((x) => x.live)?.lobe));
    }
    // 1. Content (every write first, then one read of the sizes).
    const zoomedIn = cam.zoom < 0.55;
    for (const c of cands) {
      let el = lobeEls.get(c.lobe);
      if (!el) { el = document.createElement('span'); el.className = 'lbl lobe off'; lobeEls.set(c.lobe, el); labelBox.append(el); }
      const [name, role] = T.lobes[c.lobe], col = lobeCss(c.lobe);
      c.open = c.lobe === hoverLobe || (zoomedIn && Math.abs(c.at[0] - W / 2) < W * 0.25 && Math.abs(c.at[1] - H / 2) < H * 0.25);
      const list = c.names.slice(0, W < 520 ? 2 : 3), more = c.names.length - list.length;
      const html = `<span class="row"><span class="dot" style="background:${col}"></span><b style="color:${col}">${esc(name)}</b><i>· ${esc(role)}</i></span>` +
        (c.open ? `<span class="groups">${list.map(([nm, id]) => `<span style="color:${regionCss[id]}">${esc(nm)}</span>`).join('<i>·</i>')}${more > 0 ? `<i>+${more}</i>` : ''}</span>` : '');
      if (el._html !== html) { el._html = html; el.innerHTML = html; el._w = 0; }
      c.el = el;
    }
    for (const c of cands) if (!c.el._w) { c.el._w = c.el.offsetWidth; c.el._h = c.el.offsetHeight; }
    // 2. Places: the most important first, each on its center or the nearest free spot around it, inside its region.
    //    While tracking, the spot it had comes first, so a label doesn't hop between two spots as the brain turns.
    const placed = [], keep = new Set();
    cands.sort((a, b) => b.live - a.live || b.n - a.n);
    for (const c of cands) {
      const el = c.el, w = el._w, h = el._h, sy = (h + 6) / 2, spots = [];
      for (let j = -4; j <= 4; j++) for (let i = -2; i <= 2; i++) {
        const dx = (i * w) / 4, dy = j * sy;
        if (Math.hypot(dx, dy) <= c.reach || (!i && !j)) spots.push([dx, dy]);
      }
      spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      if (tracking && el._shown && el._spot && Math.hypot(...el._spot) <= c.reach) spots.unshift(el._spot);
      for (const s of spots) {
        const b = [clamp(c.at[0] - w / 2 + s[0], 8, W - 8 - w), clamp(c.at[1] - h / 2 + s[1], 8, H - 8 - h), w, h];
        if (placed.some((o) => boxesHit(b, o, 4)) || taken.some((o) => boxesHit(b, o, 2))) continue;
        c.box = b;
        el._spot = s;
        placed.push(b);
        break;
      }
    }
    // 3. Positions (gliding while tracking), emphasis, and a stronger halo over a crowded patch of cells.
    screenPositions();
    const anyLive = cands.some((c) => c.live);
    for (const c of cands) {
      const el = c.el;
      if (!c.box) continue;
      const [x, y, w, h] = c.box, glide = tracking && el._shown && el._box;
      const px = glide ? el._box[0] + (x - el._box[0]) * 0.3 : x, py = glide ? el._box[1] + (y - el._box[1]) * 0.3 : y;
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (!visible[i] || scr[i * 3 + 2] <= 0) continue;
        const sx = scr[i * 3], sy = scr[i * 3 + 1];
        if (sx > x - 8 && sx < x + w + 8 && sy > y - 8 && sy < y + h + 8) n++;
      }
      setClass(el, 'dense', n * 220 > (w + 16) * (h + 16)); // more than a cell per 220 px² under it
      setClass(el, 'on', c.live);
      setClass(el, 'dim', anyLive && !c.live);
      setClass(el, 'off', false);
      el._box = [px, py, w, h];
      el._shown = true;
      keep.add(c.lobe);
    }
    for (const [k, el] of lobeEls) if (!keep.has(k) && el._shown) { el._shown = false; setClass(el, 'off', true); }
  }
  function placeChips(now) {
    const placed = [];
    // Narrow screens: a compact tag (the dot and the project's initials, or the number) that a tap opens for a moment.
    const compact = W < 520;
    // The panels: a stack of tags never covers one, and stays between those that span the screen (on a phone, the
    // top controls and the sessions panel at the bottom). Read before anything below writes.
    const taken = panelBoxes(now), wide = taken.filter((b) => b[2] > W * 0.5);
    const ceil = Math.max(8, ...wide.filter((b) => b[1] + b[3] / 2 < H / 2).map((b) => b[1] + b[3] + 6));
    const floor = Math.min(H - 8, ...wide.filter((b) => b[1] + b[3] / 2 >= H / 2).map((b) => b[1] - 6));
    for (const a of agents.values()) {
      const show = a.pos && !(a.hideAt && now > a.hideAt + 400);
      if (!a.chip) {
        if (!show) continue;
        a.chip = document.createElement('span');
        a.chip.className = 'chip';
        a.chip.innerHTML = `<span class="dot" style="--agent:${a.css}"></span><span class="who"></span><span class="pj"></span><span class="k"></span><code></code>`;
        chipBox.append(a.chip);
      }
      a.chip.hidden = !show;
      if (!show) continue;
      a.chip.classList.toggle('gone', !!(a.hideAt && now > a.hideAt));
      const p = project(a.comet && a.comet.route ? cometHead(a.comet, now) : a.pos);
      const [, who, pj, k, code] = a.chip.children;
      const { verb, text, cls } = saying(a);
      const label = a.main ? a.def.label : a.def.label.split(' ')[0]; // "#1": the number that ties chip, beam and panel
      const S = sessions.get(a.sid), badge = sessions.size > 1 && S && S.project != null ? pname(S.project) : '';
      const small = compact && !(a.openUntil > now); // a tapped tag says everything for a moment
      const key = `${label}|${badge}|${verb}|${a.kind}|${text}|${small}|${a.def.type}`;
      if (a.chipKey !== key) {
        a.chipKey = key;
        const [name, tag] = tagOf(a.main, label, a.def.type, badge, small);
        setText(who, name);
        setText(pj, tag);
        setText(k, small ? '' : verb);
        k.className = `k ${cls}`;
        setText(code, small ? '' : text);
        a.chip.classList.toggle('tap', compact);
        a.chip.classList.toggle('wait', cls === 'wait'); // waiting for the OK: an amber edge, which a small tag keeps
        a.chip.title = compact ? `${a.def.label}${badge ? ` · ${badge}` : ''}` : '';
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
    const labels = [...lobeEls.values()].filter((el) => el._shown && el._box).map((el) => el._box);
    const groups = [];
    for (const it of placed) {
      const g = groups.find((q) => q.some(([, x, y]) => Math.hypot(x - it[1], y - it[2]) < 70));
      if (g) g.push(it); else groups.push([it]);
    }
    const boxes = [], lines = [];
    for (const g of groups) {
      const cx = g.reduce((t, it) => t + it[1], 0) / g.length, top = Math.min(...g.map((it) => it[2])), bot = Math.max(...g.map((it) => it[2]));
      const w = Math.max(...g.map(([a]) => a.chipW)), h = g.length * 25 - 3, gap = g.length > 1 ? 26 : 14;
      const low = Math.max(ceil, floor - h); // the lowest a stack may sit
      const spots = [[cx + gap, top - h - 8], [cx - w - gap, top - h - 8], [cx + gap, bot + 10], [cx - w - gap, bot + 10]].map(([x, y]) => [clamp(x, 8, W - w - 8), clamp(y, ceil, low), w, h]);
      const free = (s) => !taken.some((t) => hit(s, t)) && !boxes.some((o) => hit(s, o));
      let b = spots.find((s) => free(s) && !labels.some((l) => hit(s, l))) || spots.find(free);
      if (!b) { b = spots[0]; for (const o of boxes) if (hit(b, o)) b = [b[0], Math.min(o[1] + o[3] + 3, low), w, h]; }
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
      const b = el._box, under = !!el._shown && !!b && busyBoxes.some((o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3]);
      if (el._under !== under) { el._under = under; el.classList.toggle('under', under); }
    }
  }

  // ---- the sessions panel ----------------------------------------------------------------------------------------
  // The focus card stops above the panel, whatever its height, so live status stays visible. One block per session
  // (the one followed, or every live one, grouped by project): its status, its project and its agents. With several,
  // clicking a block follows that session (Follow then follows it) and hovering one lights its project. A session
  // waiting for the user's OK says so in amber; so do other sessions waiting while only one is shown (setOthers).
  const observe = (el, fn) => { const o = new ResizeObserver(fn); o.observe(el); observers.push(o); };
  observe($('brainNow'), ([e]) => $('brainNow').parentElement.style.setProperty('--now-h', `${Math.ceil(e.borderBoxSize[0].blockSize)}px`));
  const sessList = $('sessList');
  let sessKey = null; // the blocks' order as last written (null: write it)
  function sessionBlock(s) {
    if (!s.li) {
      s.li = document.createElement('li');
      s.li.className = 'sess';
      s.li.innerHTML = '<button type="button" class="now-top"><span class="status"><span class="dot"></span><span></span></span><span class="nowproj"></span><span class="ttl"></span></button><ul class="agents"></ul>';
      s.li.firstElementChild.addEventListener('click', () => pickSession(s.id));
      s.li.addEventListener('mouseenter', () => hoverSession(s.id));
      s.li.addEventListener('mouseleave', () => hoverSession(null));
    }
    return s.li;
  }
  const waitingIn = (s) => { const lead = agents.get(agentKey(s.id, 'main')); return !!lead && isWaiting(lead); };
  function renderNow() {
    const multi = sessions.size > 1;
    // A session waiting for the user's OK comes first, so it never scrolls out of sight; then by project.
    const list = [...sessions.values()].sort((x, y) => waitingIn(y) - waitingIn(x) || pname(x.project).localeCompare(pname(y.project), lang) || x.order - y.order);
    const key = list.map((s) => `#${s.id}`).join(); // "#" so a lone unnamed session ('') differs from no session
    if (key !== sessKey) { sessKey = key; for (const s of list) sessList.append(sessionBlock(s)); } // moves blocks only when the order changes
    for (const s of list) {
      const li = sessionBlock(s), [btn] = li.children, [st, pj, ttl] = btn.children, wait = waitingIn(s);
      st.className = `status ${wait ? 'waiting' : s.status}`;
      setText(st.lastChild, wait ? T.v_wait : s.status === 'working' ? T.working : T.idle);
      setText(pj, s.project == null ? '' : pname(s.project));
      setText(ttl, multi ? s.title || '' : '');
      btn.disabled = !multi;
      setClass(li, 'sel', multi && follow && followSid === s.id);
      setClass(li, 'wait', wait);
    }
    for (const a of agents.values()) {
      const S = sessions.get(a.sid);
      if (!S) continue;
      if (!a.li) {
        a.li = document.createElement('li');
        a.li.innerHTML = `<span class="sw" style="--agent:${a.css}"></span><span class="lb"></span><span class="st"></span><span class="act"></span>`;
      }
      if (a.li.parentElement !== S.li.lastElementChild) S.li.lastElementChild.append(a.li);
      const [, lb, stt, act] = a.li.children;
      setText(lb, a.def.label);
      const main = a.main; // Claude between prompts is idle, not "done"
      setText(stt, a.status === 'done' ? (main ? T.idle : T.done) : a.status === 'idle' ? T.idle : main ? T.working : T.running);
      const { verb, text } = saying(a);
      setText(act, text ? `${verb} ${text}`.trim() : a.kind === 'done' ? (main ? '' : a.def.task || T.done) : verb || a.def.task || '');
      a.li.className = a.status === 'done' ? 'done' : '';
    }
  }
  function pickSession(id) {
    if (sessions.size < 2) return;
    followSid = id;
    if (!follow) { follow = true; $('followBtn').setAttribute('aria-pressed', 'true'); }
    followGoal();
    renderNow();
    env.onPick?.(id);
  }
  function hoverSession(id) {
    const p = id == null || sessions.size < 2 ? null : sessions.get(id)?.project ?? null;
    if (p === hoverProject) return;
    hoverProject = p;
    lightProjects();
    request();
  }
  // Other sessions waiting for the user's OK while only one is shown: [{ id, project (a name), title }].
  function setOthers(list) {
    const ul = $('othersList'), html = list.map((o) => `<li><button type="button" data-sid="${esc(o.id)}"><span class="status waiting"><span class="dot"></span>${esc(T.v_wait)}</span><span class="nowproj">${esc(o.project || o.title || '')}</span></button></li>`).join('');
    if (ul._h !== html) { ul._h = html; ul.innerHTML = html; }
    ul.hidden = !list.length;
  }
  $('othersList').addEventListener('click', (e) => { const b = e.target.closest('button[data-sid]'); if (b) env.onPick?.(b.dataset.sid); });
  // A small tag (narrow screens) opens on a tap and says everything for 5 s; a second tap closes it.
  const OPEN_MS = 5000;
  chipBox.addEventListener('click', (e) => {
    const el = e.target.closest('.chip.tap'), a = el && [...agents.values()].find((x) => x.chip === el);
    if (!a) return;
    const now = performance.now();
    a.openUntil = a.openUntil > now ? 0 : now + OPEN_MS;
    labelsDirty = true;
    request();
    setTimeout(() => { labelsDirty = true; request(); }, OPEN_MS + 50);
  });

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
    file: '<circle cx="8" cy="8" r="4.75" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>',
    instruction: '<path d="M8 1.75L13.25 8L8 14.25L2.75 8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>',
    memory: '<path d="M8 2.5L14 13H2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="9.5" r="1.5" fill="currentColor"/>',
    serena: '<path d="M8 2L13.2 5V11L8 14L2.8 11V5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>',
    tool: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.25" fill="none" stroke="currentColor" stroke-width="1.5"/>',
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
    $('fxLegend').innerHTML = `<h3>${esc(T.fxTitle)}</h3><ul>${Object.keys(FX_ICONS).map((k) => `<li><span class="fxi fx-${k}">${ICON(FX_ICONS[k])}</span><span><b>${esc(T.fx[k][0])}</b> ${esc(T.fx[k][1])}</span></li>`).join('')}</ul><p>${esc(T.fxOff)}</p>`;
    renderProjects();
  }
  function renderProjects() {
    const count = Object.fromEntries(graph.projects.map((p) => [p.id, nodes.filter((n) => n.project === p.id).length]));
    const lit = workingProjects();
    const html = graph.projects.map((p) => {
      const working = lit.has(p.id);
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

  $('filtersReset').addEventListener('click', () => {
    for (const p of graph.projects) filter.projects.add(p.id);
    for (const t of NODE_TYPES) filter.types.add(t);
    for (const t of EDGE_TYPES) filter.edges.add(t);
    for (const box of $('rail').querySelectorAll('.checks input[type=checkbox]')) box.checked = true;
    refresh();
  });

  // The legend of the actions' figures: shown on hover or focus (CSS), pinned with a click or a tap, closed with Escape
  // or a click elsewhere.
  const pinLegend = (on) => { $('fxHelp').classList.toggle('open', on); $('fxBtn').setAttribute('aria-expanded', String(on)); };
  $('fxBtn').addEventListener('click', () => pinLegend(!$('fxHelp').classList.contains('open')));
  $('fxHelp').addEventListener('keydown', (e) => { if (e.key === 'Escape') { pinLegend(false); $('fxBtn').blur(); } });
  document.addEventListener('pointerdown', (e) => { if (!$('fxHelp').contains(e.target)) pinLegend(false); }, outside);

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
  const nodeButton = (i) => `<li><button type="button" data-node="${i}">${shapeIcon(nodes[i].type)}<span class="nm">${esc(nodes[i].name)}</span><span class="pj">${esc(pname(nodes[i].project))} · ${esc(nodes[i].path)}</span></button></li>`;
  search.addEventListener('input', runSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matchSet && matchSet.size) { e.preventDefault(); /* or this Enter's keypress clicks the button focus moves to */ setFocus([...matchSet].sort((a, b) => activityOf(b) - activityOf(a))[0], true); }
    if (e.key === 'Escape') { search.value = ''; runSearch(); }
  });
  const onDoc = (type, fn) => document.addEventListener(type, fn, outside);
  onDoc('click', (e) => {
    const b = e.target.closest('[data-node]');
    if (b) setFocus(Number(b.dataset.node), true); // from a list: keyboard focus follows into the neighbors
    if (e.target.closest('#clearFocus')) setFocus(null);
  });
  onDoc('keydown', (e) => {
    if (view !== 'brain' || e.target.closest?.('dialog')) return;
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
    const kind = `${shapeIcon(n.type)}${esc(T['t_' + n.type])} · <span style="color:${regionCss[g.id]}">${esc(T.lobes[g.lobe][1])}</span> · ${esc(pname(n.project))}`;
    const bits = [];
    if (n.type === 'tool') bits.push(`<span><b>${n.uses}</b> ${T.uses(n.uses)}</span>`, `<span><b>${n.errors}</b> ${T.errors(n.errors)}</span>`);
    else {
      bits.push(`<span><b>${st.reads}</b> ${T.reads(st.reads)}</span>`);
      if (n.type === 'file') bits.push(`<span><b>${st.edits}</b> ${T.edits(st.edits)}</span>`);
      if (n.tokens) bits.push(`<span><b>${n.tokens.toLocaleString(lang)}</b> ${T.tokens(n.tokens)}</span>`);
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
    renderNow(); // the followed session's block is marked while Follow is on
  });
  $('sessMode').addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b && b.getAttribute('aria-pressed') !== 'true') env.onMode?.(b.dataset.mode); });
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
      routes.clear(); // the cells moved
      for (const a of agents.values()) { if (a.comet) arrive(a, false); if (a.node != null) a.pos = at(a.node); a.after = null; }
      trails.length = 0; sparks.length = 0;
      refresh();
      camDirty = true;
      canvas.classList.remove('fading');
      request();
    }, anim ? 170 : 0);
  });

  observe($('well'), () => {
    const r = $('well').getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    if (R) R.resize(W, H, Math.min(2, devicePixelRatio || 1));
    frameBrain();
    camDirty = true;
    request();
  });
  onDoc('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; return; }
    for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; } // what happened while hidden lands at once
    rings.length = 0; ripples = []; trails.length = 0; sparks.length = 0;
    trace.draw();
    request();
  });

  // ---- switches: animations, shown or hidden, language -----------------------------------------------------------
  const animSwitch = $('animSwitch');
  function setAnim(on, save) {
    anim = on;
    animSwitch.setAttribute('aria-checked', String(on));
    if (save) try { localStorage.setItem('kevmind.brain.anim', on ? 'on' : 'off'); } catch {}
    if (!on) {
      endIntro();
      pulses.length = 0;
      for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; }
      rings.length = 0; ripples = []; trails.length = 0; heats.length = 0; sparks.length = 0;
      vel.yaw = vel.pitch = 0;
      for (let i = 0; i < N; i++) state[i * 4 + 2] = -100;
      projCur.set(projTarget);
      if (R) R.updateState(state);
    }
    request();
  }
  animSwitch.addEventListener('click', () => setAnim(!anim, true));
  reduced.addEventListener('change', () => { try { if (localStorage.getItem('kevmind.brain.anim')) return; } catch {} setAnim(!reduced.matches, false); }, outside);

  // Shown or hidden by the host (another view of the dashboard): nothing is drawn while hidden.
  function setShown(on) {
    if (view === 'gone') return;
    view = on ? 'brain' : 'other';
    if (!on) { cancelAnimationFrame(raf); raf = 0; hideTip(); if (intro.on) endIntro(); }
    else { for (const a of agents.values()) { if (a.comet) arrive(a, false); a.after = null; } trace.draw(); request(); }
  }

  // The host's language changed (or the view just started): every word again.
  function applyLang() {
    lang = env.lang(); T = env.strings();
    for (const el of host.querySelectorAll('[data-bi18n]')) setText(el, T[el.dataset.bi18n]);
    for (const el of host.querySelectorAll('[data-bi18n-placeholder]')) el.placeholder = T[el.dataset.bi18nPlaceholder];
    for (const el of host.querySelectorAll('[data-bi18n-label]')) { el.setAttribute('aria-label', T[el.dataset.bi18nLabel]); el.title = T[el.dataset.bi18nLabel]; }
    $('traceLegend').innerHTML = `<span class="ev">${esc(T.traceLegend[0])}</span><span class="tk">${esc(T.traceLegend[1])}</span>`;
    for (const a of agents.values()) a.chipKey = ''; // the tags' words
    renderFilters();
    renderNow();
    renderFocus();
    trace.draw();
    if (search.value) runSearch(); else refresh();
  }

  // ---- start -----------------------------------------------------------------------------------------------------
  if (matchMedia('(max-width: 900px)').matches) $('filters').open = false; // phones: the brain first, filters on demand
  try { if (localStorage.getItem('kevmind.brain.rotate') === 'on') { autoRotate = true; $('rotateBtn').setAttribute('aria-pressed', 'true'); } } catch {}
  setAnim(anim, false);
  applyLang();
  setShown(opt.shown !== false);
  if (!R) endIntro(); // no WebGL: no intro, the panels still follow the events
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
  // Counters and checks for the benchmark harness and the tests, read over CDP.
  let frames = 0, firstFrame = 0;
  const debug = { light: LIGHT, nodes: N, edges: edges.length, frames: () => frames, staticDraws: () => (R ? R.staticDraws || 0 : 0), firstFrameMs: () => firstFrame,
    get intro() { return { on: intro.on, done: intro.done, clock: intro.on && intro.t0 != null ? (performance.now() - intro.t0) / 1000 : null }; },
    counts: () => (R ? { ...R.counts, dendrites: R.layers.dendrites?.count, tracts: R.layers.tracts?.count } : null),
    lanes: () => lanesOf().top,
    fx: () => ({ effects: effects.length, beams: effects.filter((x) => x.beams).length, born: born.size, sparks: sparks.length, pulses: pulses.length, ripples: ripples.length, waiting: waiting() }),
    // Checks for the routes. routeCheck: n random moves between cells: how many follow real links, their hops, how
    // long working one out takes, and how many of their points (each segment's ends and three points between) fall
    // outside the brain. trailsNow: the same for what is on screen. linkCheck: the links' own fibers.
    route(a, b) { const rt = routeTo(a, b); return { hops: rt.hops, cells: [a, ...rt.marks.map((mk) => mk.i), b].map((i) => nodes[i].path), segments: rt.pts.length - 1 }; },
    routeCheck(n = 1000) {
      const out = { moves: 0, real: 0, glide: 0, hops: {}, points: 0, outside: 0, open: 0, far: {}, segments: 0, maxSegments: 0, msPerRoute: 0 };
      const t0 = performance.now(), list = [];
      for (let k = 0; k < n; k++) {
        const a = Math.floor(Math.random() * N), b = Math.floor(Math.random() * N);
        if (a !== b) list.push(routeTo(a, b));
      }
      out.msPerRoute = +((performance.now() - t0) / Math.max(1, list.length)).toFixed(3);
      for (const rt of list) {
        out.moves++;
        if (rt.hops) { out.real++; out.hops[rt.hops] = (out.hops[rt.hops] || 0) + 1; } else out.glide++;
        out.segments += rt.pts.length - 1; out.maxSegments = Math.max(out.maxSegments, rt.pts.length - 1);
        const o = outsideOf(rt.pts);
        out.points += o.points; out.outside += o.outside; out.open += o.open;
        if (o.far) out.far[o.far] = (out.far[o.far] || 0) + 1;
      }
      routes.clear();
      return out;
    },
    trailsNow() {
      const all = [...trails.map((tr) => tr.c), ...[...agents.values()].filter((a) => a.comet && a.comet.route).map((a) => a.comet.route)];
      const out = { trails: trails.length, flying: all.length - trails.length, hops: all.map((rt) => rt.hops), points: 0, outside: 0, open: 0, far: 0, sparks: sparks.length };
      for (const rt of all) { const o = outsideOf(rt.pts); out.points += o.points; out.outside += o.outside; out.open += o.open; out.far = Math.max(out.far, o.far); }
      return out;
    },
    linkCheck() {
      const out = { links: edges.length, points: 0, outside: 0, open: 0, far: {} };
      for (let k = 0; k < edges.length; k++) { const o = outsideOf(fiberPoints(k, true)); out.points += o.points; out.outside += o.outside; out.open += o.open; if (o.far) out.far[o.far] = (out.far[o.far] || 0) + 1; }
      return out;
    },
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
    labels: () => [...lobeEls].filter(([, el]) => el._shown).map(([l, el]) => ({ lobe: l, box: el._box.map(Math.round), under: !!el._under, dense: el.classList.contains('dense') })),
    // How many cells are drawn as outlines in this view (the shader's rule, without the hot and focused ones).
    outlines: () => { let n = 0; const room = (PX / basis.dist / OVERVIEW_PX) ** 2; screenPositions(); for (let i = 0; i < N; i++) if (visible[i] && minor[i] * (1 + clamp((scr[i * 3 + 2] - depth[0]) / (depth[1] - depth[0]), 0, 1)) < room) n++; return n; },
    agents: () => [...agents.values()].map((a) => ({ id: a.id, session: a.sid, label: a.def.label, status: a.status, kind: a.kind, waiting: isWaiting(a), node: a.node == null ? null : nodes[a.node].path })),
    sessions: () => [...sessions.values()].map((s) => ({ id: s.id, project: s.project, status: s.status, title: s.title, followed: follow && followSid === s.id })),
    lit: () => graph.projects.map((p) => [p.id, +projTarget[projIndex.get(p.id)].toFixed(2)]),
    pick: (id) => pickSession(id), hover: (id) => hoverSession(id),
    embers: () => [...embers].map(([i, e]) => ({ path: nodes[i].path, kind: e.kind, level: state[i * 4 + 1] })),
    get bloom() { return bloomLevel; }, software: R ? R.software : null };
  const _draw = R ? R.draw.bind(R) : null;
  // The intro, measured: frames drawn, their rate between the first and the last, the longest wait between two, and how
  // long its first two frames took (its clock starts after them).
  let introFrames = 0, introGap = 0, lastDraw = 0, introFirst = 0, introLast = 0;
  debug.introStats = () => ({ frames: introFrames, fps: +((introFrames - 1) / ((introLast - introFirst) / 1000)).toFixed(1), maxGapMs: Math.round(introGap), warmMs: Math.round(intro.t0 - introFirst) });
  if (R) R.draw = (...a) => {
    const t = performance.now();
    frames++;
    if (!firstFrame) firstFrame = Math.round(t);
    if (intro.on) { if (introFrames) introGap = Math.max(introGap, t - lastDraw); else introFirst = t; introFrames++; introLast = t; }
    lastDraw = t;
    return _draw(...a);
  };

  // ---- the handle --------------------------------------------------------------------------------------------------
  // What already happened in the session (events with `ts`, when they happened), applied at once with no animation:
  // agents where they are, embers as warm as their age allows, the trace with its last five minutes.
  function seed(events) {
    silent = true;
    try { for (const ev of events) onEvent(ev); } finally { silent = false; }
    coolStep();
    activeNeurons();
    edgeLights();
    renderNow();
    labelsDirty = true;
    request();
  }
  // Another session (or set of sessions) to follow: no sessions, no agents, no embers, an empty trace.
  function reset() {
    for (const a of agents.values()) { a.chip?.remove(); a.li?.remove(); }
    agents.clear();
    for (const s of sessions.values()) s.li?.remove();
    sessions.clear(); sessKey = null; followSid = null; hoverProject = null;
    embers.clear();
    trails.length = 0; heats.length = 0; sparks.length = 0; rings.length = 0; flashes.length = 0; signals.length = 0; pulses.length = 0; ripples = [];
    effects.length = 0;
    if (born.size) { born.clear(); deepLights(); }
    for (let i = 0; i < N; i++) { state[i * 4] = nodeBright(i); state[i * 4 + 1] = 0; state[i * 4 + 2] = -100; state[i * 4 + 3] = 0; }
    if (R) R.updateState(state);
    trace.items = [];
    lightProjects();
    activeNeurons();
    edgeLights();
    trace.draw();
    renderNow();
    labelsDirty = true;
    request();
  }
  function destroy() {
    view = 'gone';
    cancelAnimationFrame(raf); raf = 0;
    ac.abort();
    for (const o of observers) o.disconnect();
    for (const t of [coolTimer, heatTimer, rotateTimer, trace.timer]) clearTimeout(t);
    if (R) R.gl.getExtension('WEBGL_lose_context')?.loseContext(); // browsers keep only so many live contexts
    R = null;
    host.textContent = '';
  }
  return {
    onEvent, seed, reset, destroy, debug,
    // Cells of files that were just created: each is born (it fades in, its branches grow, its links reach out).
    born(ids) { for (const i of ids) if (i != null && i >= 0 && i < N) birth(i); },
    // A session's Claude is waiting for the user's OK (or no longer is).
    setWaiting(on, id = '') { setWaiting(agentOf(agentKey(id, 'main'), id, 'main'), !!on); },
    // A session's project (lit while it works) and its title (said in the panel when several are shown).
    setSession({ id = '', project, title } = {}) {
      const s = sess(id);
      if (project === s.project && (title === undefined || title === s.title)) return;
      if (project !== undefined) s.project = project;
      if (title !== undefined) s.title = title;
      lightProjects(); renderNow(); labelsDirty = true; request();
    },
    // A session leaves (it went quiet): its agents fade out, its block goes.
    dropSession(id) {
      const s = sessions.get(id);
      if (!s) return;
      const now = performance.now();
      for (const a of [...agents.values()]) if (a.sid === id) { if (a.comet) arrive(a, false); a.after = null; a.hideAt = now; setTimeout(() => { if (agents.get(a.id) === a) dismiss(a); }, 600); }
      sessions.delete(id);
      if (followSid === id) followSid = null;
      if (s.li) { s.li.classList.add('gone'); setTimeout(() => s.li.remove(), 400); }
      sessKey = null;
      lightProjects(); renderNow(); followGoal(); labelsDirty = true; request();
    },
    setOthers,
    // Which sessions the host shows: 'one' (the selected one) or 'all' (every live one). The switch shows when the
    // host gave onMode.
    setMode(mode) { $('sessMode').hidden = !env.onMode; for (const b of $('sessMode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); },
    setLang: applyLang,
    show() { setShown(true); },
    hide() { setShown(false); },
    camera: () => ({ yaw: goal.yaw, pitch: goal.pitch, zoom: goal.zoom }),
  };
}
