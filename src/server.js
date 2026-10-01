// Local server: receives hook events, stores them and streams them live to the browser (SSE).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { State, baseName } from './state.js';
import { Tailer } from './transcript.js';
import { listProjects, scanProject, projectRoot } from './memory.js';
import { redact } from '../hooks/redact.js'; // shared with hooks/send.js, which masks spooled events

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const DATA_DIR = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
export const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
export const SPOOL_FILE = path.join(DATA_DIR, 'spool.jsonl'); // written by hooks/send.js while the server is down
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const SERVER_LOG = path.join(DATA_DIR, 'server.log');
const REPLAY_MS = 24 * 60 * 60 * 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
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
  const state = new State();
  const isDuplicate = makeDedupe();
  replay(state, isDuplicate);

  const clients = new Set();
  const log = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  ingestSpool(state, log, isDuplicate);
  // New on every start; the page reloads when a reconnect hands it a different one.
  const bootId = Math.random().toString(36).slice(2);
  const detached = process.env.KEVMIND_DETACHED === '1';

  function broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
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

  const server = http.createServer((req, res) => {
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
        log.write(JSON.stringify({ ts, e: clean }) + '\n');
        const s = state.apply(clean, ts);
        if (s) broadcast({ type: 'session', session: state.summary(s), sessions: state.list() });
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
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (url.pathname === '/api/health') return json(res, { ok: true, dev, detached, bootId, pid: process.pid });

    if (url.pathname === '/api/memory') return json(res, { projects: memory.projects() });
    if (url.pathname === '/api/memory/project') {
      memory.report(url.searchParams.get('key')).then(
        (r) => (r ? json(res, r) : json(res, { error: 'unknown project' }, 404)),
        (err) => json(res, { error: String(err?.message || err) }, 500),
      );
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
  });

  // Dev only: reload the open page when a dashboard file changes (debounced, editors fire several events per save).
  let reloadTimer;
  const watcher = dev ? fs.watch(PUBLIC_DIR, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcast({ type: 'reload' }), 100);
  }) : null;

  function shutdown() {
    watcher?.close();
    clearInterval(tailTimer);
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

// Rewrites events.jsonl keeping only the lines whose event passes `keep`. Returns how many were dropped.
export function clearEvents(keep) {
  if (!fs.existsSync(LOG_FILE)) return 0;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter((l) => { try { return keep(JSON.parse(l).e); } catch { return false; } });
  fs.writeFileSync(LOG_FILE, kept.map((l) => l + '\n').join(''));
  return lines.length - kept.length;
}

export function clearAll() {
  for (const f of [LOG_FILE, SPOOL_FILE]) fs.rmSync(f, { force: true });
}

export const isDemoEvent = (e) => String(e?.session_id || '').startsWith('demo-') || baseName(e?.cwd || '') === 'demo-kevmind';

// Memory tab data. The project list and "last read" come from the whole event log (not only the 24 h in memory),
// read incrementally; what loaded comes from the InstructionsLoaded events of the project's latest session.
function memoryApi(state) {
  const usage = { offset: 0, rest: '', since: null, cwds: new Map(), reads: [] };
  const refresh = () => {
    let size;
    try { size = fs.statSync(LOG_FILE).size; } catch { return; }
    if (size < usage.offset) Object.assign(usage, { offset: 0, rest: '', since: null, cwds: new Map(), reads: [] });
    if (size === usage.offset) return;
    const fd = fs.openSync(LOG_FILE, 'r');
    const buf = Buffer.alloc(size - usage.offset);
    fs.readSync(fd, buf, 0, buf.length, usage.offset);
    fs.closeSync(fd);
    usage.offset = size;
    const lines = (usage.rest + buf.toString('utf8')).split('\n');
    usage.rest = lines.pop();
    for (const line of lines) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const e = o.e || {};
      usage.since = Math.min(usage.since ?? o.ts, o.ts);
      if (e.cwd) usage.cwds.set(e.cwd, Math.max(usage.cwds.get(e.cwd) || 0, o.ts));
      if (e.hook_event_name === 'PreToolUse' && e.tool_name === 'Read' && e.cwd && e.tool_input?.file_path) {
        usage.reads.push({ ts: o.ts, root: projectRoot(e.cwd), path: e.tool_input.file_path });
      }
    }
  };
  const projects = () => { refresh(); return listProjects({ cwds: usage.cwds }); };
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
    }).then((r) => ({ ...r, key, source: p.source }));
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key));
    return promise;
  };
  return { projects, report };
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
}

// Rebuilds state from the last 24 h of events on startup. Logs written before the duplicate filter
// existed may hold repeats, so the filter applies here too.
function replay(state, isDuplicate) {
  if (!fs.existsSync(LOG_FILE)) return;
  const since = Date.now() - REPLAY_MS;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
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
    log.write(JSON.stringify({ ts, e: clean }) + '\n');
    if (ts >= since) state.apply(clean, ts);
  }
}
