// Brain tab: the dashboard's side of the Brain view. Loaded after app.js and memory.js and uses their state and
// helpers ($, esc, T, lang, current, view, agentMap, agentStatus, sessionStatus, toolName, sessions, visibleSessions,
// selectedId, select). Nothing of the view (its code, its styles, its data) is loaded until the tab is first opened;
// from then on it follows the session selected in Live, or every live session at once ("All live sessions"): what
// already happened is applied at once, new events as they arrive. Read-only, like Memory.
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
const brainOutcomes = new Map(); // live calls whose outcome is still to come: "<session>|<seq>" -> { sid, seq, agent, at }
const brainBorn = new Set();     // files just created that the graph doesn't have yet: born when it does
// Which sessions the brain shows: the one selected in Live ('one'), or every live one ('all'). The choice is
// remembered; until there is one, it shows all of them whenever more than one is live.
const BRAIN_MODE_KEY = 'kevmind.brain.sessions';
const BRAIN_LIVE_MS = 10 * 60_000; // a session quiet for longer than this (and not waiting) leaves "All live sessions"
const BRAIN_MAX_SESSIONS = 6;      // at most this many at once, the most recent first
let brainChosen = null;
try { brainChosen = localStorage.getItem(BRAIN_MODE_KEY); } catch { /* storage unavailable */ }
let brainMode = null;              // the mode the mounted view shows
const brainFull = new Map();       // session id -> its latest full summary (from the stream, or fetched)
const brainShown = new Map();      // "all": session id -> the last of its events applied
const brainFetching = new Set();
let brainExpiry = 0;
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
  brainMode = null;
  brainShown.clear();
  brainOutcomes.clear();
  const api = brainMod.mountBrain($('brainView'), {
    graph, strings: () => T.brain, lang: () => lang, project: brainProjectOf(current),
    onMode: (mode) => { brainChosen = mode; try { localStorage.setItem(BRAIN_MODE_KEY, mode); } catch { /* ignore */ } brainFollow(); },
    // A session clicked in the panel is selected in Live too (and, while one is shown, shown here).
    onPick: (id) => { if (id !== selectedId) select(id, true); },
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

// A live session in a project the graph doesn't have yet: a newer graph soon, as for a file just created (the view is
// rebuilt where it was), once per folder.
function brainNewProject(cwd) {
  if (brainMissed.has(`cwd:${cwd}`)) return;
  brainMissed.add(`cwd:${cwd}`);
  brainNeed = Date.now();
  clearTimeout(brainTimer);
  brainTimer = setTimeout(brainRefresh, Math.max(BRAIN_BORN_MS, brainAt + BRAIN_BORN_GAP_MS - Date.now()));
}

// The session's events as the view's: who (Claude or a numbered subagent), what, and on which node. sid: the
// session's id when several are shown (each event then says its session).
function brainEvents(s, since, past, sid) {
  const byId = agentMap(s);
  const rowOf = (id) => (id === 'user' || id === 'system' ? 'main' : byId[id]?.id || id);
  const def = (id) => { const a = byId[id]; return !a || a.id === 'main' ? { label: 'Claude', type: 'main', task: '' } : { label: `#${a.seq} ${a.type}`, type: a.type, task: a.description || '' }; };
  const abs = (p) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(p) ? p : `${s.cwd}/${p}`);
  const out = [];
  let last = since;
  for (const e of s.events) {
    if ((e.seq || 0) <= since) continue;
    last = Math.max(last, e.seq || 0);
    const who = rowOf(e.actor), ev = { agent: who, def: def(who), ts: past ? e.ts : undefined, ...(sid ? { session: sid } : {}) };
    if (e.kind === 'prompt') out.push({ ...ev, agent: 'main', def: def('main'), kind: 'start' });
    else if (e.kind === 'read' || e.kind === 'edit') {
      // A search (Grep, Glob) says where it looked; an edit, once it ends, what it changed or that it made the file.
      const search = e.tool === 'Grep' || e.tool === 'Glob';
      const node = e.path ? brainFind(abs(e.path)) : brainTool(e.tool);
      if (node == null && e.path && !past) brainMiss(abs(e.path));
      const kind = search ? 'search' : e.kind === 'edit' && e.created ? 'create' : e.kind;
      out.push({ ...ev, kind, node: node ?? undefined, text: e.detail || toolName(e.tool), ...(search ? { dir: e.dir ? abs(e.dir) : null } : {}), ...(e.add != null ? { add: e.add, del: e.del } : {}) });
      if (!past && (search ? e.found == null : e.kind === 'edit' && e.add == null && !e.created)) brainOutcomes.set(`${sid || ''}|${e.seq}`, { sid: sid || '', seq: e.seq, agent: who, at: Date.now() });
    } else if (e.kind === 'command' || e.kind === 'web' || e.kind === 'mcp' || e.kind === 'tool') {
      // Bash is a command (a pulse on the brainstem), the web leaves the brain, any other tool just lights its cell.
      out.push({ ...ev, kind: e.kind === 'command' || e.kind === 'web' ? e.kind : 'tool', node: brainTool(e.tool), text: e.detail || toolName(e.tool) });
      if (!past && e.kind === 'command' && e.ms == null) brainOutcomes.set(`${sid || ''}|${e.seq}`, { sid: sid || '', seq: e.seq, agent: who, at: Date.now() });
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
function brainSettle(s, sid = '') {
  if (!brainOutcomes.size) return;
  const abs = (p) => (/^([a-z]:[\\/]|[\\/]|~)/i.test(p) ? p : `${s.cwd}/${p}`);
  const bySeq = new Map(s.events.map((e) => [e.seq, e]));
  const tag = sid ? { session: sid } : {};
  for (const [key, w] of brainOutcomes) {
    if (w.sid !== sid) continue;
    const e = bySeq.get(w.seq);
    if (!e || Date.now() - w.at > 600_000) { brainOutcomes.delete(key); continue; } // gone from the window, or it failed
    if (e.kind === 'command') {
      if (e.ms == null) continue;
      brainApi.onEvent({ agent: w.agent, ...tag, kind: 'outcome', done: true });
    } else if (e.kind === 'edit') {
      if (e.add == null && !e.created) continue;
      const file = abs(e.path), node = brainFind(file);
      if (e.created && node == null) brainBirth(file);
      else if (e.created) brainApi.born([node]);
      else if (node != null) brainApi.onEvent({ agent: w.agent, ...tag, kind: 'outcome', node, add: e.add, del: e.del });
    } else {
      if (e.found == null) continue;
      brainApi.onEvent({ agent: w.agent, ...tag, kind: 'outcome', hits: (e.hits || []).map((h) => brainFind(abs(h))).filter((n) => n != null) });
    }
    brainOutcomes.delete(key);
  }
}

// The sessions "All live sessions" shows: those working or waiting for the user's OK, and those that had a prompt and
// were active in the last 10 minutes (Claude between prompts); waiting ones first, then the most recent, at most 6.
// statusOf: the page's status of a session (one quiet for 5 minutes is idle).
function brainLiveSessions(list, now, statusOf) {
  const rank = (s) => (statusOf(s) === 'waiting' ? 1 : 0);
  return list
    .filter((s) => { const st = statusOf(s); return st === 'working' || st === 'waiting' || (st !== 'ended' && s.prompts > 0 && now - s.lastAt < BRAIN_LIVE_MS); })
    .sort((a, b) => rank(b) - rank(a) || b.lastAt - a.lastAt)
    .slice(0, BRAIN_MAX_SESSIONS);
}
// A session's full summary (events and agents): the stream sends it with each of its events; one not heard from since
// the page loaded is asked for once.
function brainFetch(id) {
  if (brainFetching.has(id)) return;
  brainFetching.add(id);
  fetch(`/api/sessions/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((s) => {
    if (s) { brainFull.set(s.id, s); brainFollow(); }
  }).catch(() => {}).finally(() => brainFetching.delete(id));
}
// A session seen for the first time: applied silently up to now (agents where they are, what was touched still warm
// by its age). Whoever is not at work now has stopped, whatever the events say (a session that went quiet never said so).
function brainSeedSession(s, sid) {
  const { events, last } = brainEvents(s, 0, true, sid);
  // (Claude waiting for the user's OK is at work too: stopped, its marker could not blink amber.)
  const live = (a) => (a.id === 'main' ? ['working', 'waiting'].includes(sessionStatus(s)) : agentStatus(a, s) === 'running');
  for (const a of s.agents) if (!live(a)) events.push({ agent: a.id, kind: 'stop', ts: s.lastAt, ...(sid ? { session: sid } : {}) });
  brainApi.seed(events);
  return last;
}
// New events of a session already shown: what piled up (a burst, or the tab was on another view) is applied at once,
// like the past; a few play.
function brainCatchUp(s, since, sid) {
  const { events, last } = brainEvents(s, since, false, sid);
  if (events.length > 3) brainApi.seed(brainEvents(s, since, true, sid).events);
  else for (const ev of events) brainApi.onEvent(ev);
  brainSettle(s, sid || '');
  return last;
}
// Every live session at once. Each keeps its own Claude and subagents; one that leaves the list fades out.
function brainFollowAll(live) {
  const ids = new Set(live.map((s) => s.id));
  for (const id of [...brainShown.keys()]) if (!ids.has(id)) { brainShown.delete(id); brainApi.dropSession(id); }
  for (const id of [...brainFull.keys()]) if (!ids.has(id)) brainFull.delete(id);
  for (const item of live) {
    const s = brainFull.get(item.id);
    if (!s || s.lastAt < item.lastAt) brainFetch(item.id);
    if (!s) continue;
    const project = brainProjectOf(s);
    if (project == null && s.cwd) brainNewProject(s.cwd);
    brainApi.setSession({ id: s.id, project, title: s.title || s.firstPrompt || '' });
    if (!brainShown.has(s.id)) brainShown.set(s.id, brainSeedSession(s, s.id));
    else brainShown.set(s.id, brainCatchUp(s, brainShown.get(s.id), s.id));
    brainApi.setWaiting(sessionStatus(s) === 'waiting', s.id);
  }
  // A session goes quiet without telling: look again when the first one would go idle or leave the list.
  clearTimeout(brainExpiry);
  const now = Date.now(), next = Math.min(...live.flatMap((s) => [s.lastAt + 5 * 60_000, s.lastAt + BRAIN_LIVE_MS]).filter((t) => t > now));
  if (Number.isFinite(next)) brainExpiry = setTimeout(() => brainFollow(), next - now + 500);
}

// Follows the session selected in Live, or every live session ("All live sessions"). A session seen for the first
// time is applied silently up to now; after that, each new event plays as it arrives. full: a session's newest
// summary, as the stream sent it (any session, selected or not).
function brainFollow(full) {
  if (full && brainMod) brainFull.set(full.id, full); // kept only once the tab was opened (and only the live ones, below)
  if (!brainApi || !brainReady || view !== 'brain') return;
  const live = brainLiveSessions(visibleSessions(), Date.now(), sessionStatus);
  const mode = brainChosen === 'one' || brainChosen === 'all' ? brainChosen : live.length > 1 ? 'all' : 'one';
  if (mode !== brainMode) {
    brainMode = mode;
    brainApi.setMode(mode);
    brainApi.reset();
    brainApi.setOthers([]);
    brainSession = null;
    brainShown.clear();
    brainOutcomes.clear();
    clearTimeout(brainExpiry);
  }
  if (mode === 'all') return brainFollowAll(live);
  const s = current;
  if (!s) return;
  if (s.id !== brainSession) {
    brainSession = s.id;
    brainApi.reset();
    brainApi.setSession({ project: brainProjectOf(s) });
    if (brainProjectOf(s) == null && s.cwd) brainNewProject(s.cwd);
    brainOutcomes.clear();
    brainSeq = brainSeedSession(s);
  } else brainSeq = brainCatchUp(s, brainSeq);
  brainApi.setWaiting(sessionStatus(s) === 'waiting'); // Claude's marker blinks amber while the session needs the user's OK
  // Other sessions waiting for the user's OK are named under the panel, so they are never missed.
  brainApi.setOthers(sessions.filter((x) => x.id !== s.id && sessionStatus(x) === 'waiting').map((x) => ({ id: x.id, project: x.project, title: x.title || '' })));
}
window.brainFollow = brainFollow;                    // app.js: the selected session changed or got an event
window.brainLang = () => {                           // app.js: the language changed
  if (brainApi) brainApi.setLang();
  else if (view === 'brain' && !brainLoading) brainMessage(brainGraph ? T.brain.empty : T.brain.loading);
};

if (view === 'brain') window.brainShow(true);
