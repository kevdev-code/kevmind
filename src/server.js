// Local server: receives hook events, stores them and streams them live to the browser (SSE).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { State, baseName, outcomeOf } from './state.js';
import { Tailer } from './transcript.js';
import { listProjects, scanProject, projectRoot, keyOf, slugOf } from './memory.js';
import { emptyAggregate, revive, updateFromLogs, refreshGit, logFiles, preview, measure, THRESHOLDS } from './experience.js';
import { migrateLegacyLog, logWriter, readSince, rewriteLogs, atomicWrite } from './logs.js';
import { writeConfig, experienceTools, pluginOption, briefingOn } from './config.js';
import { BRIEF, ARMS, armOf, gatherFacts, briefingText, measureStretch, compare, projectsUnder, sessionsOf } from './briefing.js';
import { redact } from '../hooks/redact.js'; // shared with hooks/send.js, which masks spooled events
import { makeShare } from './share.js';
import { buildBrain, LIMITS as BRAIN_LIMITS } from './brain.js';
import { importScanner } from './imports.js';
import { codeMapper, staleNames } from './codemap.js';
import { buildTree, profileOf, gapProblems, TREE } from './tree.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const DATA_DIR = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
export const SPOOL_FILE = path.join(DATA_DIR, 'spool.jsonl'); // written by hooks/send.js while the server is down
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const SERVER_LOG = path.join(DATA_DIR, 'server.log');
export const EXPERIENCE_FILE = path.join(DATA_DIR, 'experience.json'); // read by mcp/server.js
export const BRIEFINGS_FILE = path.join(DATA_DIR, 'briefings.jsonl'); // every session start the briefing saw, and its measurement
export const TREE_DIR = path.join(DATA_DIR, 'tree'); // each project's knowledge tree (src/tree.js), read by mcp/server.js
export const treeFile = (key) => path.join(TREE_DIR, `${slugOf(key)}.json`);
const REPLAY_MS = 24 * 60 * 60 * 1000;
const EXPERIENCE_TICK_MS = 15_000;
const GIT_REFRESH_MS = 10 * 60_000;
const BRAIN_CACHE_MS = 20_000;
const BRAIN_FRESH_MS = 5_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const DEDUPE_MS = 3000;

// With two hook sources (the plugin plus hooks from `kevmind install`) every event arrives twice.
// Returns a filter that keeps the first of any exact repeat within a few seconds, keyed on
// session + event + tool_use_id, or a hash of the whole payload when there is no tool_use_id.
export function makeDedupe(windowMs = DEDUPE_MS) {
  const recent = new Map();
  return (payload, ts) => {
    const id = payload.tool_use_id || crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    const key = `${payload.session_id}|${payload.hook_event_name}|${id}`;
    const last = recent.get(key);
    if (last !== undefined && ts - last < windowMs) return true;
    recent.set(key, ts);
    if (recent.size > 5000) for (const [k, t] of recent) if (ts - t >= windowMs) recent.delete(k);
    return false;
  };
}

export function startServer({ port = 4777, host = '127.0.0.1', dev = process.env.KEVMIND_DEV === '1' } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const migrated = migrateLegacyLog(DATA_DIR);
  if (migrated) console.log(`  Split events.jsonl into monthly logs (${migrated} events).`);
  const state = new State();
  const isDuplicate = makeDedupe();
  replay(state, isDuplicate);

  const clients = new Set();
  const log = logWriter(DATA_DIR);
  ingestSpool(state, log, isDuplicate);
  // New on every start; the page reloads when a reconnect hands it a different one.
  const bootId = Math.random().toString(36).slice(2);
  const detached = process.env.KEVMIND_DETACHED === '1';

  function broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
  }
  // Sharing state carries the link: only this PC's pages get it, never a shared device.
  function broadcastLocal(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) if (!res.shared) res.write(data);
  }

  // Transcript tailers for the sessions active in the last 24 h; a new one stream-parses its file on attach.
  const tailers = new Map();
  function tailTranscripts() {
    const now = Date.now();
    for (const s of state.sessions.values()) {
      const live = s.transcript && now - s.lastAt < REPLAY_MS;
      if (live && !tailers.has(s.id)) tailers.set(s.id, new Tailer(state, s));
      if (!live) tailers.delete(s.id);
    }
    for (const [id, t] of tailers) {
      let changed = false;
      try { changed = t.tick(); } catch { /* a file mid-write; next tick */ }
      if (changed && clients.size) broadcast({ type: 'session', session: state.summary(state.sessions.get(id)), sessions: state.list() });
    }
  }
  tailTranscripts();
  const tailTimer = setInterval(tailTranscripts, 1000);
  const memory = memoryApi(state);
  const experience = experienceKeeper();
  const trees = treeKeeper(memory, experience, broadcast);
  // The Brain view's graph: built from the memory reports, the experience aggregate and the tool counts, at most
  // every 20 s (the view asks again when Claude touches a file it doesn't know yet). Read-only, like the Memory tab.
  let brainHit = null;
  const scanImports = importScanner(); // remembers what each file imports until the file changes
  const brain = (after = 0) => {
    // after: the page needs a graph built after that moment (a file was just created); never more often than every 5 s.
    if (brainHit && Date.now() - brainHit.at < BRAIN_CACHE_MS && !(after > brainHit.at && Date.now() - brainHit.at > BRAIN_FRESH_MS)) return brainHit.promise;
    const promise = (async () => {
      const projects = memory.projects().filter((p) => p.source === 'session').slice(0, BRAIN_LIMITS.projects);
      const reports = await Promise.all(projects.map((p) => memory.report(p.key).catch(() => null)));
      return buildBrain({ projects: projects.map((p, i) => ({ ...p, report: reports[i] })), agg: await experience.aggregate(), tools: memory.tools(), imports: scanImports });
    })();
    brainHit = { at: Date.now(), promise };
    promise.catch(() => { brainHit = null; });
    return promise;
  };

  const briefing = briefingKeeper(state, memory, experience, trees);

  // "View on phone": a second, read-only listener on the home network while it is on (src/share.js).
  const share = makeShare({ port, handle, onChange: () => broadcastLocal({ type: 'share', share: share.status() }) });
  // A JSON POST from this PC's own page (or the CLI, which sends no Origin): another web page can't make one.
  const ownJson = (req) => LOCAL.has(req.socket.remoteAddress) && /^application\/json\b/.test(req.headers['content-type'] || '') && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`);
  const readBody = (req, max, done) => { let body = ''; req.on('data', (c) => { body += c; if (body.length > max) req.destroy(); }); req.on('end', () => done(body)); };

  // shared: the request came through the sharing listener (already token-checked and read-only there).
  function handle(req, res, shared = false) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/events') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
      req.on('end', () => {
        res.writeHead(204).end();
        let payload;
        try { payload = JSON.parse(body); } catch { return; }
        const ts = Date.now();
        if (isDuplicate(payload, ts)) return;
        const clean = redact(payload);
        // What the call did (lines added and removed, files matched), measured before the payload is cut: numbers and paths.
        const outcome = payload.hook_event_name === 'PostToolUse' ? outcomeOf(payload) : null;
        if (outcome) clean.outcome = outcome;
        log.write(ts, JSON.stringify({ ts, e: clean }));
        const s = state.apply(clean, ts);
        if (s) broadcast({ type: 'session', session: state.summary(s), sessions: state.list() });
        if (clean.hook_event_name === 'SessionStart' && clean.cwd) { const root = projectRoot(clean.cwd); if (root) trees.ensure(keyOf(root), root); }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/shutdown') {
      if (!LOCAL.has(req.socket.remoteAddress)) return res.writeHead(403).end();
      json(res, { dev, detached }); // how it was launched, so `kevmind restart` can relaunch it the same way
      shutdown();
      return;
    }

    if (url.pathname === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', bootId, sessions: state.list() })}\n\n`);
      clients.add(res);
      res.shared = shared;
      if (shared) share.watching(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (url.pathname === '/api/health') return json(res, shared ? { ok: true, shared: true, bootId } : { ok: true, dev, detached, bootId, pid: process.pid, share: share.status() });

    // Sharing on and off, and a new link: from this PC only (a shared device never reaches here: read-only).
    if (url.pathname === '/api/share' && req.method === 'GET') return shared ? res.writeHead(403).end() : json(res, share.status());
    if (url.pathname === '/api/share' && req.method === 'POST') {
      if (shared || !ownJson(req)) return res.writeHead(403).end();
      readBody(req, 1000, async (body) => {
        let on;
        try { on = JSON.parse(body).on; } catch { /* handled below */ }
        if (typeof on !== 'boolean') return json(res, { error: 'expected {"on": true|false}' }, 400);
        json(res, on ? await share.start() : share.stop());
      });
      return;
    }
    if (url.pathname === '/api/share/regenerate' && req.method === 'POST') {
      if (shared || !ownJson(req)) return res.writeHead(403).end();
      readBody(req, 1000, () => json(res, share.regenerate()));
      return;
    }

    if (url.pathname === '/api/memory') return json(res, { projects: memory.projects() });
    if (url.pathname === '/api/memory/project') {
      const key = url.searchParams.get('key');
      trees.ensure(key);
      memory.report(key).then(
        (r) => (r ? json(res, { ...r, problems: [...r.problems, ...gapProblems(trees.load(key))] }) : json(res, { error: 'unknown project' }, 404)),
        (err) => json(res, { error: String(err?.message || err) }, 500),
      );
      return;
    }
    // The Experience panel's switch: KevMind's own config.json, read by mcp/server.js at the next session start.
    // JSON only and same origin only, so another web page can't flip it (a cross-site JSON POST needs CORS).
    if (req.method === 'POST' && url.pathname === '/api/tools') {
      const origin = req.headers.origin;
      if (!LOCAL.has(req.socket.remoteAddress) || !/^application\/json\b/.test(req.headers['content-type'] || '') || (origin && origin !== `http://${req.headers.host}`)) return res.writeHead(403).end();
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1000) req.destroy(); });
      req.on('end', () => {
        let on;
        try { on = JSON.parse(body).on; } catch { /* handled below */ }
        if (typeof on !== 'boolean') return json(res, { error: 'expected {"on": true|false}' }, 400);
        writeConfig(DATA_DIR, { experienceTools: on });
        json(res, experienceTools(DATA_DIR, pluginOption()));
      });
      return;
    }
    // The session briefing. The hook (hooks/brief.js) asks for it at each session start: the answer is the text
    // to give Claude, or nothing (off, withheld for the measurement, or too slow). JSON from this PC only.
    if (req.method === 'POST' && url.pathname === '/api/briefing') {
      if (shared || !ownJson(req)) return res.writeHead(403).end();
      readBody(req, 20_000, async (body) => {
        let p = {};
        try { p = JSON.parse(body); } catch { /* handled below */ }
        json(res, await briefing.serve(p).catch(() => ({ text: '' })));
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/briefing/switch') {
      if (shared || !ownJson(req)) return res.writeHead(403).end();
      readBody(req, 1000, (body) => {
        let on;
        try { on = JSON.parse(body).on; } catch { /* handled below */ }
        if (typeof on !== 'boolean') return json(res, { error: 'expected {"on": true|false}' }, 400);
        writeConfig(DATA_DIR, { briefing: on });
        json(res, { on: briefingOn(DATA_DIR) });
      });
      return;
    }
    // The Memory tab: what Claude received at each start of this project's sessions, and the comparison.
    if (url.pathname === '/api/briefing') return json(res, briefing.panel(url.searchParams.get('key')));
    // What a session starting now would receive (nothing is recorded).
    if (url.pathname === '/api/briefing/preview') {
      briefing.preview(url.searchParams.get('key')).then((r) => json(res, r), (err) => json(res, { error: String(err?.message || err) }, 500));
      return;
    }
    // The knowledge tree, for the Memory tab: its profile and areas (not the commit table). since: the tree the page
    // already has, so an unchanged tree is not sent again at every poll.
    if (url.pathname === '/api/tree') {
      const key = url.searchParams.get('key'), t = trees.load(key), building = trees.building(key);
      if (!t) return json(res, { tree: null, building });
      if (String(t.at) === url.searchParams.get('since')) return json(res, { unchanged: true, at: t.at, building });
      const { git, ...rest } = t;
      return json(res, { tree: { ...rest, profile: profileOf(t) }, building });
    }
    // Build or refresh a project's tree now: the Memory tab's button and `kevmind init` (which sends a path).
    // months: the git window for this tree (a number or 'all'); it stays until the next init says otherwise.
    if (req.method === 'POST' && url.pathname === '/api/init') {
      if (shared || !ownJson(req)) return res.writeHead(403).end();
      readBody(req, 5000, async (body) => {
        let p = {};
        try { p = JSON.parse(body); } catch { /* handled below */ }
        const root = p.root ? projectRoot(path.resolve(p.root)) || path.resolve(p.root) : memory.projects().find((x) => x.key === p.key)?.root;
        const months = p.months === 'all' ? 'all' : Number(p.months) > 0 ? Number(p.months) : undefined;
        if (!root || !fs.existsSync(root)) return json(res, { error: 'unknown project' }, 404);
        const t = await trees.build(keyOf(root), { root, months, force: true });
        json(res, t ? { ok: true, key: keyOf(root), file: treeFile(keyOf(root)), ms: t.ms, profile: profileOf(t) } : { error: 'the build failed; see server.log' }, t ? 200 : 500);
      });
      return;
    }
    if (url.pathname === '/api/experience') {
      experience.panel(url.searchParams.get('key')).then(
        (r) => json(res, r),
        (err) => json(res, { error: String(err?.message || err) }, 500),
      );
      return;
    }

    if (url.pathname === '/api/brain') {
      brain(Math.min(Number(url.searchParams.get('after')) || 0, Date.now())).then((g) => json(res, g), (err) => json(res, { error: String(err?.message || err) }, 500));
      return;
    }

    if (url.pathname === '/api/sessions') return json(res, state.list());

    if (url.pathname.startsWith('/api/sessions/')) {
      const s = state.sessions.get(decodeURIComponent(url.pathname.slice('/api/sessions/'.length)));
      return s ? json(res, state.summary(s)) : json(res, { error: 'not found' }, 404);
    }

    // Static dashboard files
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
  }
  // Only loopback names: a web page on another domain that resolves to 127.0.0.1 (DNS rebinding) can't read the
  // dashboard or the sharing link.
  const server = http.createServer((req, res) => (LOOPBACK_HOST.test(req.headers.host || '') ? handle(req, res, false) : res.writeHead(403).end()));

  // Dev only: reload the open page when a dashboard file changes (debounced, editors fire several events per save).
  let reloadTimer;
  const watchers = dev ? [PUBLIC_DIR, path.join(PUBLIC_DIR, 'brain')].map((dir) => fs.watch(dir, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcast({ type: 'reload' }), 100);
  })) : [];

  function shutdown() {
    share.stop();
    for (const w of watchers) w.close();
    clearInterval(tailTimer);
    experience.stop();
    trees.stop();
    briefing.stop();
    for (const res of clients) res.end();
    log.end();
    try { fs.unlinkSync(PID_FILE); } catch { /* never written */ }
    server.close(exit);
    setImmediate(() => server.closeAllConnections?.()); // after the /shutdown reply is handed to the socket
    setTimeout(exit, 1000).unref(); // whatever still holds the process open must not delay the exit
  }

  function exit() {
    // Under scripts/dev.js the parent is Node's watcher: take it down too, or it sits idle and later collides on the port.
    if (process.env.KEVMIND_WATCHED === '1') { try { process.kill(process.ppid); } catch { /* already gone */ } }
    process.exit(0);
  }

  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
  server.once('listening', () => fs.writeFileSync(PID_FILE, String(process.pid)));
  server.listen(port, host);
  return server;
}

// Rewrites the logs keeping only the events that pass `keep`. Returns how many were dropped.
// The experience aggregate is derived from the logs, so it is dropped and rebuilt.
export function clearEvents(keep) {
  migrateLegacyLog(DATA_DIR);
  const dropped = rewriteLogs(DATA_DIR, keep);
  if (dropped) fs.rmSync(EXPERIENCE_FILE, { force: true });
  return dropped;
}

export function clearAll() {
  for (const name of logFiles(DATA_DIR)) fs.rmSync(path.join(DATA_DIR, name), { force: true });
  for (const f of [SPOOL_FILE, EXPERIENCE_FILE]) fs.rmSync(f, { force: true });
}

export const isDemoEvent = (e) => String(e?.session_id || '').startsWith('demo-') || baseName(e?.cwd || '') === 'demo-kevmind';

// Memory tab data. The project list and "last read" come from all the logs (not only the 24 h in memory),
// read incrementally; what loaded comes from the InstructionsLoaded events of the project's latest session.
function memoryApi(state) {
  const usage = { offsets: {}, rest: {}, since: null, cwds: new Map(), reads: [], tools: new Map() };
  const refresh = () => {
    for (const name of logFiles(DATA_DIR)) {
      const file = path.join(DATA_DIR, name);
      let size;
      try { size = fs.statSync(file).size; } catch { continue; }
      const from = usage.offsets[name] || 0;
      if (size < from) { Object.assign(usage, { offsets: {}, rest: {}, since: null, cwds: new Map(), reads: [], tools: new Map() }); return refresh(); }
      if (size === from) continue;
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      fs.closeSync(fd);
      usage.offsets[name] = size;
      const lines = ((usage.rest[name] || '') + buf.toString('utf8')).split('\n');
      usage.rest[name] = lines.pop();
      for (const line of lines) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const e = o.e || {};
        usage.since = Math.min(usage.since ?? o.ts, o.ts);
        if (e.cwd) usage.cwds.set(e.cwd, Math.max(usage.cwds.get(e.cwd) || 0, o.ts));
        // How often each tool was used and failed, for the Brain view's tool nodes.
        if (e.tool_name && (e.hook_event_name === 'PreToolUse' || e.hook_event_name === 'PostToolUseFailure')) {
          const t = usage.tools.get(e.tool_name) || usage.tools.set(e.tool_name, { uses: 0, errors: 0, lastAt: 0 }).get(e.tool_name);
          if (e.hook_event_name === 'PreToolUse') { t.uses++; t.lastAt = Math.max(t.lastAt, o.ts); } else t.errors++;
        }
        if (e.hook_event_name === 'PreToolUse' && e.tool_name === 'Read' && e.cwd && e.tool_input?.file_path) {
          usage.reads.push({ ts: o.ts, root: projectRoot(e.cwd), path: e.tool_input.file_path });
        }
      }
    }
  };
  const projects = () => { refresh(); return listProjects({ cwds: usage.cwds }); };
  // The code map of each project whose report asked for it (one builder each: a builder keeps one project's files),
  // reused for a minute: reports come every 20 s while the Brain is open, and a warm rebuild costs ~250 ms on 1,000 files.
  // ponytail: kept for the server's life, about 10 MB for a project of 1,000 files; drop idle ones if that grows.
  const mappers = new Map(); // key -> { build, map, at, running }
  const codeMap = (root) => {
    const k = keyOf(root);
    if (!mappers.has(k)) mappers.set(k, { build: codeMapper(), map: null, at: 0, running: null });
    const m = mappers.get(k);
    if (!m.running && (!m.map || Date.now() - m.at > 60_000)) {
      m.running = m.build(root).then((x) => { Object.assign(m, { map: x, at: Date.now() }); return x; }, () => m.map).finally(() => { m.running = null; });
    }
    return m.running || Promise.resolve(m.map);
  };
  const lastMap = (root) => mappers.get(keyOf(root))?.map || null;
  const codeNames = (root) => async (names) => { const map = await codeMap(root); return map ? staleNames(map, names) : new Map(); };
  const cache = new Map();
  const report = async (key) => {
    const p = projects().find((x) => x.key === key);
    if (!p) return null;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 5000) return hit.promise;
    let latest = null;
    for (const s of state.sessions.values()) {
      if (!s.instructions?.length || !s.cwd || projectRoot(s.cwd)?.toLowerCase() !== p.root.toLowerCase()) continue;
      if (!latest || s.lastAt > latest.lastAt) latest = s;
    }
    const promise = scanProject(p.root, {
      reads: { since: usage.since ?? Date.now(), items: usage.reads },
      loaded: latest ? latest.instructions : [],
      projects: projects(), // so a file shared by several projects reports its problems once, where it lives
      codeNames: experienceTools(DATA_DIR, pluginOption()).on ? codeNames(p.root) : null, // the code map is off with the tools
    }).then((r) => ({ ...r, key, source: p.source }));
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key));
    return promise;
  };
  return { projects, report, codeMap, lastMap, tools: () => { refresh(); return usage.tools; } };
}

// Keeps ~/.kevmind/experience.json current for the MCP server: new log lines every 15 s, each project's git
// history at most every 10 min, written atomically and only when something changed.
function experienceKeeper() {
  let agg = emptyAggregate();
  try { agg = revive(JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf8'))); } catch { /* first run: built from the logs */ }
  let running = null;
  const tick = () => {
    if (running) return running;
    running = (async () => {
      const now = Date.now();
      const before = JSON.stringify(agg.logs) + Object.values(agg.projects).map((p) => p.git?.at || 0).join();
      if (!(await updateFromLogs(agg, DATA_DIR, now))) {
        agg = emptyAggregate();
        await updateFromLogs(agg, DATA_DIR, now);
      }
      for (const proj of Object.values(agg.projects)) if (!proj.git || now - proj.git.at > GIT_REFRESH_MS) await refreshGit(proj, now);
      const after = JSON.stringify(agg.logs) + Object.values(agg.projects).map((p) => p.git?.at || 0).join();
      if (after !== before || !fs.existsSync(EXPERIENCE_FILE)) atomicWrite(EXPERIENCE_FILE, JSON.stringify(agg));
    })().catch((e) => console.error(`  experience: ${e.message}`)).finally(() => { running = null; });
    return running;
  };
  tick();
  const timer = setInterval(tick, EXPERIENCE_TICK_MS);
  // The dashboard panel: what the tools would serve today and how calls have gone, even while the tools are off.
  const panel = async (key) => {
    await tick();
    const proj = agg.projects[key];
    const tools = experienceTools(DATA_DIR, pluginOption());
    if (!proj) return { known: false, tools, thresholds: THRESHOLDS };
    const now = Date.now();
    return { known: true, tools, thresholds: THRESHOLDS, preview: preview(proj, now), measure: measure(proj, now) };
  };
  // now(): the aggregate as it is (up to 15 s behind the logs), for the briefing, which must answer at once.
  return { panel, aggregate: async () => { await tick(); return agg; }, now: () => agg, stop: () => clearInterval(timer) };
}

// Each project's knowledge tree (src/tree.js), in ~/.kevmind/tree/: built in the background the first time a project
// with sessions appears (one at a time, progress over SSE), refreshed incrementally when its Memory tab is open or a
// session starts in it (at most every TREE.refreshMs), and on demand (POST /api/init). Read-only on the project.
function treeKeeper(memory, experience, broadcast) {
  const trees = new Map(); // key -> { tree, building }
  const load = (key) => {
    if (!key) return null;
    const c = trees.get(key);
    if (c?.tree) return c.tree;
    try {
      const t = JSON.parse(fs.readFileSync(treeFile(key), 'utf8'));
      if (t?.v === 1) { trees.set(key, { ...c, tree: t }); return t; }
    } catch { /* not built yet */ }
    return null;
  };
  let queue = Promise.resolve();
  const build = (key, { root, months } = {}) => {
    const c = trees.get(key) || {};
    if (c.building) return c.building;
    root = root || memory.projects().find((p) => p.key === key)?.root;
    if (!root) return Promise.resolve(null);
    const run = async () => {
      const send = (phase, detail = {}) => broadcast({ type: 'tree', key, phase, ...detail });
      try {
        const prev = load(key);
        const [report, map, agg] = await Promise.all([memory.report(key).catch(() => null), memory.codeMap(root), experience.aggregate()]);
        if (!map) throw new Error('no code map');
        const tree = await buildTree({ root, map, report, agg, prev, months: months ?? prev?.months ?? TREE.months, progress: send });
        fs.mkdirSync(TREE_DIR, { recursive: true });
        atomicWrite(treeFile(key), JSON.stringify(tree));
        trees.set(key, { tree });
        return tree;
      } catch (e) {
        console.error(`  tree (${path.basename(root)}): ${e.message}`);
        send('error', { error: e.message });
        return null;
      }
    };
    const building = queue = queue.then(run, run); // one build at a time
    trees.set(key, { ...c, building });
    building.finally(() => { const x = trees.get(key); if (x?.building === building) trees.set(key, { tree: x.tree }); });
    return building;
  };
  // A tree that is missing or older than TREE.refreshMs is (re)built in the background; the current one is returned.
  const ensure = (key, root) => { const t = load(key); if (!t || Date.now() - t.at > TREE.refreshMs) build(key, { root }); return t; };
  // The first time a project with sessions appears, its tree is built (checked every minute).
  const firstSeen = () => { for (const p of memory.projects().filter((x) => x.source === 'session')) if (!load(p.key) && !trees.get(p.key)?.building) build(p.key); };
  const boot = setTimeout(firstSeen, 3000);
  const timer = setInterval(firstSeen, 60_000);
  boot.unref(); timer.unref();
  return { load, build, ensure, building: (key) => !!trees.get(key)?.building, stop: () => { clearTimeout(boot); clearInterval(timer); } };
}

// `kevmind init` with no dashboard running: the same build, in this process, written where the dashboard keeps it.
export async function initOffline(dir, months) {
  const root = projectRoot(path.resolve(dir)) || path.resolve(dir);
  let agg = null;
  try { agg = revive(JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf8'))); } catch { /* no sessions recorded yet */ }
  const key = keyOf(root), file = treeFile(key);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first build */ }
  const [report, map] = await Promise.all([scanProject(root).catch(() => null), codeMapper()(root)]);
  const tree = await buildTree({ root, map, report, agg, prev: prev?.v === 1 ? prev : null, months: months ?? prev?.months ?? TREE.months });
  fs.mkdirSync(TREE_DIR, { recursive: true });
  atomicWrite(file, JSON.stringify(tree));
  return { ok: true, key, file, ms: tree.ms, profile: profileOf(tree) };
}
// `kevmind clear --project`: the project's map goes with its history (matched by folder name or path, like its events).
export function clearTrees(nameOrPath) {
  const wanted = String(nameOrPath).toLowerCase();
  let n = 0;
  for (const f of fs.existsSync(TREE_DIR) ? fs.readdirSync(TREE_DIR) : []) {
    try {
      const { root } = JSON.parse(fs.readFileSync(path.join(TREE_DIR, f), 'utf8'));
      if (path.basename(root).toLowerCase() === wanted || keyOf(root) === keyOf(nameOrPath)) { fs.rmSync(path.join(TREE_DIR, f)); n++; }
    } catch { /* not a tree */ }
  }
  return n;
}

// The session briefing (src/briefing.js): built when a session starts, recorded in briefings.jsonl whether it was
// shown or withheld (in equal shares; with the code map on, also shown as v2), and measured once the stretch that
// followed has settled.
function briefingKeeper(state, memory, experience, trees) {
  // ponytail: every record is read at start and kept in memory (about 2 KB a start); rotate the file if it ever grows past a few MB.
  const records = [];
  try { for (const l of fs.readFileSync(BRIEFINGS_FILE, 'utf8').split('\n')) if (l) try { records.push(JSON.parse(l)); } catch { /* skip */ } } catch { /* none yet */ }
  const append = (r) => { records.push(r); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(BRIEFINGS_FILE, JSON.stringify(r) + '\n'); };
  const reports = new Map(); // the memory report, when it is at hand (it can take a second to build)
  const reportOf = (key) => {
    const p = memory.report(key).then((r) => { reports.set(key, r); return r; }).catch(() => null);
    return Promise.race([p, new Promise((r) => setTimeout(() => r(reports.get(key) || null), 150))]);
  };
  // v2's code map: the one at hand within 400 ms, else the last one built (a cold build goes on for the next start).
  const mapOf = (root) => Promise.race([memory.codeMap(root), new Promise((r) => setTimeout(() => r(memory.lastMap(root)), 400))]);
  const toolsOn = () => experienceTools(DATA_DIR, pluginOption()).on;
  const build = async (root, sid, source, withMap, wait = false) => {
    const key = keyOf(root);
    const [report, map] = await Promise.all([reportOf(key), withMap ? (wait ? memory.codeMap(root) : mapOf(root)) : null]);
    const facts = await gatherFacts({ agg: experience.now(), root, name: path.basename(root), sid, source, live: state.sessions, report, toolsOn: toolsOn(), map, tree: trees.load(key) });
    return briefingText(facts);
  };
  async function serve(p) {
    const sid = p.session_id, source = p.source || 'startup', root = p.cwd ? projectRoot(p.cwd) : null;
    if (!briefingOn(DATA_DIR) || !sid || !root || !['startup', 'clear', 'compact'].includes(source)) return { text: '' };
    // v2 is an arm only while the code map is on (with the experience tools).
    const t0 = Date.now(), arm = armOf(sid, records.filter((r) => r.type === 'start' && r.sid === sid).length, toolsOn() ? ARMS.v2 : ARMS.v1);
    const late = Symbol('late');
    const b = await Promise.race([build(root, sid, source, arm === 'map'), new Promise((r) => setTimeout(() => r(late), BRIEF.budgetMs))]);
    if (b === late) { append({ type: 'start', ts: t0, sid, key: keyOf(root), root, source, arm: 'late', chars: 0, items: [], text: '', ms: Date.now() - t0 }); return { text: '' }; }
    append({ type: 'start', ts: t0, sid, key: keyOf(root), root, source, arm: b.text ? arm : 'empty', chars: b.text.length, items: b.items, text: b.text, ms: Date.now() - t0 });
    return { text: b.text && arm !== 'withheld' ? b.text : '' };
  }
  // A start's stretch closes at the session's next start, once the session has been quiet for a while, or after
  // 8 h; then what followed is measured and recorded.
  function settle() {
    const now = Date.now(), agg = experience.now();
    const done = new Set(records.filter((r) => r.type === 'result').map((r) => `${r.sid}|${r.t0}`));
    for (const r of records) {
      if (r.type !== 'start' || !ARMS.v2.includes(r.arm) || done.has(`${r.sid}|${r.ts}`)) continue;
      const next = records.find((x) => x.type === 'start' && x.sid === r.sid && x.ts > r.ts);
      const projs = projectsUnder(agg, r.root), sessions = sessionsOf(projs), mine = sessions.get(r.sid);
      const last = Math.max(state.sessions.get(r.sid)?.lastAt || 0, mine?.last || 0);
      const t1 = next ? next.ts : now - last >= BRIEF.settleMs ? last + 1 : now - r.ts >= BRIEF.maxStretchMs ? r.ts + BRIEF.maxStretchMs : null;
      if (t1 == null) continue;
      const before = [...sessions].filter(([id, s]) => id !== r.sid && s.first < r.ts).sort((a, b) => b[1].last - a[1].last);
      const prevReads = new Set(before[0] ? before[0][1].eps.flatMap((x) => Object.keys(x.ep.r).map((f) => x.pre + x.p.files[+f])) : []);
      const known = new Set(before.flatMap(([, s]) => s.eps.flatMap((x) => x.ep.runs.filter((q) => !q[2] && q[0] < r.ts).map((q) => `${x.p.fams[q[1]]}|${q[3] >= 0 ? x.p.sigs[q[3]] : ''}`))));
      const m = measureStretch({ t0: r.ts, t1, eps: mine?.eps || [], prevReads, known, usage: state.sessions.get(r.sid)?.usage || null, items: r.items });
      append({ type: 'result', sid: r.sid, t0: r.ts, key: r.key, arm: r.arm, chars: r.chars, t1, m });
    }
  }
  const timer = setInterval(() => { try { settle(); } catch (e) { console.error(`  briefing: ${e.message}`); } }, 60_000);
  timer.unref();
  return {
    serve, stop: () => clearInterval(timer),
    panel(key) {
      const mine = records.filter((r) => r.key === key);
      const starts = mine.filter((r) => r.type === 'start').sort((x, y) => y.ts - x.ts).slice(0, 8).map(({ ts, source, arm, chars, text, ms }) => ({ ts, source, arm, chars, text, ms }));
      return { on: briefingOn(DATA_DIR), mapArm: toolsOn(), starts, compare: compare(mine.filter((r) => r.type === 'result')) };
    },
    // What a session starting now would get: v2 while the code map is on (v1's lines come first in it).
    async preview(key) {
      const root = memory.projects().find((p) => p.key === key)?.root;
      if (!root) return { text: '', error: 'unknown project' };
      const t0 = Date.now(), map = toolsOn(), b = await build(root, 'preview', 'startup', map, true);
      return { text: b.text, chars: b.text.length, ms: Date.now() - t0, map };
    },
  };
}

// Events of a project, for `kevmind clear --project`: matched by project folder name or path.
export function projectMatcher(nameOrPath) {
  const wanted = String(nameOrPath).toLowerCase();
  const cache = new Map();
  return (e) => {
    if (!e?.cwd) return false;
    if (!cache.has(e.cwd)) {
      const root = projectRoot(e.cwd);
      cache.set(e.cwd, !!root && (path.basename(root).toLowerCase() === wanted || keyOf(root) === keyOf(nameOrPath)));
    }
    return cache.get(e.cwd);
  };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
}

// Rebuilds state from the last 24 h of events on startup. Logs written before the duplicate filter
// existed may hold repeats, so the filter applies here too.
function replay(state, isDuplicate) {
  const since = Date.now() - REPLAY_MS;
  for (const line of readSince(DATA_DIR, since)) {
    try {
      const { ts, e } = JSON.parse(line);
      if (ts >= since && !isDuplicate(e, ts)) state.apply(e, ts);
    } catch { /* skip corrupt line */ }
  }
}

// Events the hook spooled while the server was down: redact, persist and apply them with the hook's own timestamps.
// ponytail: a hook that appends between the read and the unlink loses its event; the window is milliseconds at startup.
function ingestSpool(state, log, isDuplicate) {
  if (!fs.existsSync(SPOOL_FILE)) return;
  const items = [];
  for (const line of fs.readFileSync(SPOOL_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try { items.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  fs.unlinkSync(SPOOL_FILE);
  items.sort((a, b) => a.ts - b.ts);
  const since = Date.now() - REPLAY_MS;
  for (const { ts, e } of items) {
    if (isDuplicate(e, ts)) continue;
    const clean = redact(e);
    log.write(ts, JSON.stringify({ ts, e: clean }));
    if (ts >= since) state.apply(clean, ts);
  }
}
