// Brain tab: the dashboard's side of the Brain view. Loaded after app.js and memory.js and uses their state and
// helpers ($, esc, T, lang, current, view, agentMap, agentStatus, sessionStatus, toolName). Nothing of the view
// (its code, its styles, its data) is loaded until the tab is first opened; from then on it follows the session
// selected in Live: what already happened is applied at once, new events as they arrive. Read-only, like Memory.
const BRAIN_STALE_MS = 60_000;   // opening the tab again after this long asks the server for the graph again
const BRAIN_MISS_MS = 6_000;     // Claude touched a file the graph doesn't have: ask again this soon (the server
const BRAIN_REFRESH_MS = 30_000; // refreshes what it knows every 15 s), but not more often than this
let brainMod = null;    // { mountBrain, assemble, pathIndex, toolIndex, pathKey }
let brainApi = null;    // the mounted view's handle
let brainGraph = null;
let brainSig = '';      // what the mounted graph holds, to tell when a newer one differs
let brainAt = 0;        // when it was fetched
let brainFind = null, brainTool = null; // an event's file or tool -> its node
let brainReady = false; // the intro is over: events may flow
let brainSession = null, brainSeq = 0;  // the session followed, and the last of its events applied
let brainLoading = null, brainTimer = 0;
const brainMissed = new Set(); // files asked for and still not in the graph: not asked for again
const BRAIN_BORN_MS = 2_500;   // a file was just created: ask for the graph this soon, so its cell is born while it matters...
const BRAIN_BORN_GAP_MS = 8_000; // ...but not more often than this
let brainNeed = 0;               // the graph must be newer than this (the time of the newest file it lacks)
const brainOutcomes = new Map(); // live calls whose outcome is still to come: the event's seq -> { agent, at }
const brainBorn = new Set();     // files just created that the graph doesn't have yet: born when it does
// ?nointro, ?bloom=off|light|full, ?light: the view's options, for checks.
const brainOptions = { intro: params.has('nointro') ? false : undefined, bloom: params.get('bloom') || undefined, light: params.has('light') };

function brainMessage(text) {
  $('brainView').innerHTML = `<div class="brain-empty"><p>${esc(text)}</p></div>`;
}
function brainStyles() {
  if (document.getElementById('brainCss')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = Object.assign(document.createElement('link'), { id: 'brainCss', rel: 'stylesheet', href: 'brain/brain.css' });
    link.onload = link.onerror = resolve;
    document.head.append(link);
  });
}
const brainFacts = async () => {
  const r = await fetch(brainNeed ? `/api/brain?after=${brainNeed}` : '/api/brain');
  const body = await r.json();
  if (!r.ok || body.error) throw new Error(body.error || String(r.status));
  return body;
};
const sigOf = (facts) => `${facts.nodes.length}|${facts.edges.length}|${facts.nodes.map((n) => n.path).join('\n').length}|${facts.projects.map((p) => p.id).join()}`;

// The project (of the graph) a session works in: the deepest one whose folder holds the session's.
function brainProjectOf(s) {
  if (!s?.cwd || !brainGraph) return null;
  const cwd = brainMod.pathKey(s.cwd) + '/';
  let best = null;
  for (const p of brainGraph.projects) {
    const root = brainMod.pathKey(p.root) + '/';
    if (cwd.startsWith(root) && (!best || root.length > best.len)) best = { id: p.id, len: root.length };
  }
  return best ? best.id : null;
}

function brainMount(facts, { camera, intro } = {}) {
  const graph = brainMod.assemble(facts);
  brainApi?.destroy();
  brainApi = null;
  brainGraph = graph;
  brainSig = sigOf(facts);
  brainAt = Date.now();
  if (!graph.projects.length) return brainMessage(T.brain.empty); // tools alone are not a brain
  brainFind = brainMod.pathIndex(graph);
  brainTool = brainMod.toolIndex(graph);
  brainReady = false;
  brainSession = null;
  const api = brainMod.mountBrain($('brainView'), {
    graph, strings: () => T.brain, lang: () => lang, project: brainProjectOf(current),
    options: { ...brainOptions, camera, intro: intro === false ? false : brainOptions.intro, shown: view === 'brain' },
    // After the intro (or at once without it): from here on the session's events are applied.
    onReady: () => setTimeout(() => {
      if (brainApi !== api) return;
      brainReady = true;
      brainFollow();
      // The files created since the last graph are cells now: each is born.
      const cells = [...brainBorn].filter((f) => brainFind(f) != null);
      for (const f of cells) brainBorn.delete(f);
      if (cells.length) api.born(cells.map((f) => brainFind(f)));
      if (brainBorn.size > 40) brainBorn.clear();
    }, 0),
  });
  brainApi = api;
  window.__brain = api.debug; // counters for the benchmark, read over CDP
}

// Called when the Brain tab is shown or hidden (memory.js's setView).
window.brainShow = (on) => {
  if (!on) { brainApi?.hide(); return; }
  if (brainApi) {
    brainApi.show();
    brainFollow();
    if (Date.now() - brainAt > BRAIN_STALE_MS) brainRefresh();
    return;
  }
  if (brainLoading) return;
  brainLoading = (async () => {
    try {
      await brainStyles();
      brainMessage(T.brain.loading);
      if (!brainMod) {
        const [v, g] = await Promise.all([import('./brain/view.js'), import('./brain/graph.js')]);
        brainMod = { mountBrain: v.mountBrain, assemble: g.assemble, pathIndex: g.pathIndex, toolIndex: g.toolIndex, pathKey: g.pathKey };
      }
      brainMount(await brainFacts());
    } catch (e) {
      brainMessage(T.brain.loadError(String(e.message || e)));
    } finally { brainLoading = null; }
  })();
};

// A newer graph, when it differs: the view is rebuilt where it was (same camera, no intro) and catches up.
async function brainRefresh() {
  clearTimeout(brainTimer);
  brainTimer = 0;
  if (!brainMod || view !== 'brain' || document.hidden) return;
  try {
    const facts = await brainFacts();
    brainAt = Date.now();
    brainNeed = 0;
    if (sigOf(facts) !== brainSig) brainMount(facts, { camera: brainApi?.camera(), intro: false });
  } catch { /* the next miss or the next opening asks again */ }
}
function brainMiss(file) {
  if (brainMissed.has(file)) return;
  brainMissed.add(file);
  if (!brainTimer) brainTimer = setTimeout(brainRefresh, Math.max(BRAIN_MISS_MS, brainAt + BRAIN_REFRESH_MS - Date.now()));
}
// A file that was just created: its cell should be born soon, so the graph is asked for earlier, and newer than now.
function brainBirth(file) {
  brainBorn.add(file);
  brainNeed = Date.now();
  clearTimeout(brainTimer);
  brainTimer = setTimeout(brainRefresh, Math.max(BRAIN_BORN_MS, brainAt + BRAIN_BORN_GAP_MS - Date.now()));
}

// The session's events as the view's: who (Claude or a numbered subagent), what, and on which node.
function brainEvents(s, since, past) {
  const byId = agentMap(s);
  const rowOf = (id) => (id === 'user' || id === 'system' ? 'main' : byId[id]?.id || id);
  const def = (id) => { const a = byId[id]; return !a || a.id === 'main' ? { label: 'Claude', type: 'main', task: '' } : { label: `#${a.seq} ${a.type}`, type: a.type, task: a.description || '' }; };
  const abs = (p) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(p) ? p : `${s.cwd}/${p}`);
  const out = [];
  let last = since;
  for (const e of s.events) {
    if ((e.seq || 0) <= since) continue;
    last = Math.max(last, e.seq || 0);
    const who = rowOf(e.actor), ev = { agent: who, def: def(who), ts: past ? e.ts : undefined };
    if (e.kind === 'prompt') out.push({ ...ev, agent: 'main', def: def('main'), kind: 'start' });
    else if (e.kind === 'read' || e.kind === 'edit') {
      // A search (Grep, Glob) says where it looked; an edit, once it ends, what it changed or that it made the file.
      const search = e.tool === 'Grep' || e.tool === 'Glob';
      const node = e.path ? brainFind(abs(e.path)) : brainTool(e.tool);
      if (node == null && e.path && !past) brainMiss(abs(e.path));
      const kind = search ? 'search' : e.kind === 'edit' && e.created ? 'create' : e.kind;
      out.push({ ...ev, kind, node: node ?? undefined, text: e.detail || toolName(e.tool), ...(search ? { dir: e.dir ? abs(e.dir) : null } : {}), ...(e.add != null ? { add: e.add, del: e.del } : {}) });
      if (!past && (search ? e.found == null : e.kind === 'edit' && e.add == null && !e.created)) brainOutcomes.set(e.seq, { agent: who, at: Date.now() });
    } else if (e.kind === 'command' || e.kind === 'web' || e.kind === 'mcp' || e.kind === 'tool') {
      // Bash is a command (a pulse on the brainstem), the web leaves the brain, any other tool just lights its cell.
      out.push({ ...ev, kind: e.kind === 'command' || e.kind === 'web' ? e.kind : 'tool', node: brainTool(e.tool), text: e.detail || toolName(e.tool) });
      if (!past && e.kind === 'command' && e.ms == null) brainOutcomes.set(e.seq, { agent: who, at: Date.now() });
    }
    else if (e.kind === 'error') out.push({ ...ev, kind: 'error', node: brainTool(e.tool), text: toolName(e.tool) });
    else if (e.kind === 'thinks') out.push({ ...ev, kind: 'think', tokens: e.tokens || 0 });
    else if (e.kind === 'agent_start') { const id = rowOf(e.target); out.push({ ...ev, agent: id, def: def(id), kind: 'start' }); }
    else if (e.kind === 'agent_done') out.push({ ...ev, kind: 'stop' });
    else if (e.kind === 'stop' || e.kind === 'session_end') out.push({ ...ev, agent: 'main', def: def('main'), kind: 'stop' });
  }
  return { events: out, last };
}

// What a call did reaches its event when the call ends (the server writes it there): the lines an edit added and
// removed, a file created, the files a search matched, a command that finished. The view shows it then.
function brainSettle(s) {
  if (!brainOutcomes.size) return;
  const abs = (p) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(p) ? p : `${s.cwd}/${p}`);
  const bySeq = new Map(s.events.map((e) => [e.seq, e]));
  for (const [seq, w] of brainOutcomes) {
    const e = bySeq.get(seq);
    if (!e || Date.now() - w.at > 600_000) { brainOutcomes.delete(seq); continue; } // gone from the window, or it failed
    if (e.kind === 'command') {
      if (e.ms == null) continue;
      brainApi.onEvent({ agent: w.agent, kind: 'outcome', done: true });
    } else if (e.kind === 'edit') {
      if (e.add == null && !e.created) continue;
      const file = abs(e.path), node = brainFind(file);
      if (e.created && node == null) brainBirth(file);
      else if (e.created) brainApi.born([node]);
      else if (node != null) brainApi.onEvent({ agent: w.agent, kind: 'outcome', node, add: e.add, del: e.del });
    } else {
      if (e.found == null) continue;
      brainApi.onEvent({ agent: w.agent, kind: 'outcome', hits: (e.hits || []).map((h) => brainFind(abs(h))).filter((n) => n != null) });
    }
    brainOutcomes.delete(seq);
  }
}

// Follows the session selected in Live. A session seen for the first time is applied silently up to now (agents
// where they are, what was touched still warm by its age); after that, each new event plays as it arrives.
function brainFollow() {
  const s = current;
  if (!brainApi || !brainReady || !s || view !== 'brain') return;
  if (s.id !== brainSession) {
    brainSession = s.id;
    brainApi.reset();
    brainApi.setSession({ project: brainProjectOf(s) });
    const { events, last } = brainEvents(s, 0, true);
    // Whoever is not at work now has stopped, whatever the events say (a session that went quiet never said so).
    const live = (a) => (a.id === 'main' ? sessionStatus(s) === 'working' : agentStatus(a, s) === 'running');
    for (const a of s.agents) if (!live(a)) events.push({ agent: a.id, kind: 'stop', ts: s.lastAt });
    brainApi.seed(events);
    brainApi.setWaiting(sessionStatus(s) === 'waiting');
    brainSeq = last;
    brainOutcomes.clear();
    return;
  }
  // What piled up (the tab was on another view, or a burst): applied at once, like the past; a few play.
  const { events, last } = brainEvents(s, brainSeq, false);
  if (events.length > 3) brainApi.seed(brainEvents(s, brainSeq, true).events);
  else for (const ev of events) brainApi.onEvent(ev);
  brainSeq = last;
  brainSettle(s);
  brainApi.setWaiting(sessionStatus(s) === 'waiting'); // Claude's marker blinks amber while the session needs the user's OK
}
window.brainFollow = brainFollow;                    // app.js: the selected session changed or got an event
window.brainLang = () => {                           // app.js: the language changed
  if (brainApi) brainApi.setLang();
  else if (view === 'brain' && !brainLoading) brainMessage(brainGraph ? T.brain.empty : T.brain.loading);
};

if (view === 'brain') window.brainShow(true);
