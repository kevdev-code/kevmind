// KevMind's "work experience": what Claude Code did in a project (from KevMind's own event log) and what the
// project's git history shows, aggregated so the MCP tools answer in milliseconds. History only: no code parsing,
// no symbols, no indexing. Read-only: test/experience-readonly.test.mjs fails if this module could write anything
// or run git with anything but `log`. The dashboard server is what persists the aggregate (experience.json).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { projectRoot, keyOf, tokensOf } from './memory.js';

// Every threshold in one place. An insight below its threshold is never served.
export const THRESHOLDS = {
  windowDays: 90,          // session evidence older than this is ignored
  minSessions: 10,         // session evidence counts once a project has this many sessions...
  minSessionDays: 7,       // ...spread over at least this many days
  minGitCommits: 20,       // git evidence counts once the window holds this many commits
  coEditSessions: 3,       // edited together in at least this many sessions
  coEditDays: 2,           // ...on at least this many different days
  coEditShare: 0.5,        // ...and in at least this share of the sessions that edited the file
  readFirstSessions: 3,    // read before the file's first edit in at least this many sessions
  readFirstShare: 0.6,     // ...and this share of its edit sessions
  hubShare: 0.4,           // a file in more than this share of sessions or commits says nothing as a partner
  hubMinSample: 10,        // (the hub rule applies once there are this many sessions or commits)
  failureSessions: 2,      // the same failure (command family + error) in at least this many sessions
  fixRepeats: 2,           // the same fix before the next success at least this many times
  fixWindowMs: 15 * 60_000,
  gitMaxCommits: 2000,
  gitMaxDays: 365,
  gitMaxFilesPerCommit: 30, // bigger commits are refactors or imports, not co-change evidence
  gitCoChangeCommits: 3,
  gitCoChangeShare: 0.5,
  hotspotFixCommits: 3,    // mention "often fixed" from this many fix-labeled commits
  followWindowMs: 30 * 60_000, // a suggested file touched this soon after a call counts as followed
  maxTokens: 400,          // per tool answer, estimated as characters / 4
  maxItems: 3,             // per kind of insight, per file
};

const DAY = 86_400_000;
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const NO_MATCH_OK = new Set(['grep', 'rg', 'egrep', 'fgrep', 'diff', 'cmp', 'test', '[']); // exit 1 means "no match", not a failure
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'git', 'docker', 'cargo', 'go', 'python', 'python3', 'pip', 'make', 'node', 'deno', 'dotnet', 'mvn', 'gradle', 'php', 'composer']);
// Lockfiles, generated and binary files: they change with everything, or are outputs, so they say nothing as partners.
const LOCK_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|(^|\/)(dist|build|out|coverage|generated|__generated__|graphify-out)\/|\.(pdf|png|jpe?g|gif|webp|ico|svgz|zip|gz|tgz|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|exe|dll|so|dylib|class|jar|pyc|wasm|bin)$/i;
const FIX_RE = /\b(fix(e[sd])?|bug|hotfix|revert|arregl\w*|correg\w*|corrig\w*)\b/i;
const GIT_READ = new Set(['log']);
export const MCP_TOOL_RE = /^mcp__(?:plugin_kevmind_experience|kevmind(?:-experience)?)__(\w+)$/; // plugin and manual installs
export const NO_DATA = 'No data:';

const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const slash = (p) => p.split(path.sep).join('/');

// ---- the event logs ------------------------------------------------------------------------------------------

// Monthly logs, oldest first: events-YYYY-MM.jsonl (plus a legacy events.jsonl if not migrated yet).
export function logFiles(dataDir) {
  let names = [];
  try { names = fs.readdirSync(dataDir); } catch { return []; }
  return names.filter((n) => /^events(-\d{4}-\d{2})?\.jsonl$/.test(n)).sort((a, b) => (a === 'events.jsonl' ? -1 : b === 'events.jsonl' ? 1 : a.localeCompare(b)));
}

// ---- the aggregate -------------------------------------------------------------------------------------------
// projects[key] = { root, name, files: [relative path], sessions: { id: session }, fams: [], sigs: [], git }
// session = { first, last, r: {file: first read ts}, e: {file: first edit ts}, ed: [[ts, file]],
//   rc: {file: reads}, ec: {file: edits}, ag: {file: [agent types]}, runs: [[ts, fam, ok, sig]],
//   calls: [[ts, tool, tokens, noData, [files], ms]] }

export const emptyAggregate = () => ({ version: 2, at: 0, logs: {}, projects: {} });

// Lookup tables are rebuilt on load and never saved.
function index(proj) {
  if (!proj._fi) {
    Object.defineProperty(proj, '_fi', { value: new Map(proj.files.map((f, i) => [f, i])), enumerable: false, writable: true });
    Object.defineProperty(proj, '_fam', { value: new Map(proj.fams.map((f, i) => [f, i])), enumerable: false, writable: true });
    Object.defineProperty(proj, '_sig', { value: new Map(proj.sigs.map((f, i) => [f, i])), enumerable: false, writable: true });
  }
  return proj;
}
const intern = (proj, list, map, v) => {
  let i = proj[map].get(v);
  if (i === undefined) { i = proj[list].push(v) - 1; proj[map].set(v, i); }
  return i;
};
const fileId = (proj, rel) => intern(proj, 'files', '_fi', rel);

function projectOf(agg, cwd) {
  const root = projectRoot(cwd);
  if (!root) return null;
  const k = keyOf(root);
  if (!agg.projects[k]) agg.projects[k] = { root, name: path.basename(root), files: [], sessions: {}, fams: [], sigs: [], git: null };
  return index(agg.projects[k]);
}

// A path relative to the project root with forward slashes, or null when it is outside the project.
export function relPath(root, file) {
  if (!file) return null;
  const rel = path.relative(root, path.resolve(root, String(file)));
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : slash(rel);
}

// "npm run build" for "cd app && npm run build -- --watch | tail"; null for an empty command.
export function commandFamily(cmd) {
  const seg = String(cmd || '').split(/&&|\|\||;/).map((s) => s.trim()).find((s) => s && !/^(cd|export|set|pushd)\b/.test(s));
  if (!seg) return null;
  const toks = seg.split('|')[0].trim().split(/\s+/).filter((t) => !/^\w+=/.test(t));
  if (!toks.length) return null;
  const name = (t) => t.replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.(exe|cmd)$/i, '').toLowerCase();
  const out = [name(toks[0])];
  if (RUNNERS.has(out[0]) && toks[1]) {
    out.push(/[\\/]/.test(toks[1]) ? name(toks[1]) : toks[1].toLowerCase());
    if (/^(run|exec|run-script)$/.test(out[1]) && toks[2]) out.push(toks[2].toLowerCase());
  }
  return out.join(' ').slice(0, 60);
}

// "exit 2: Cannot find module <path>" from a tool error; numbers and paths are normalized.
export function errorSignature(error) {
  const text = String(error || '');
  const code = /Exit code (\d+)/.exec(text)?.[1] || '?';
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^Exit code \d+$/.test(l)) || '';
  const norm = line.replace(/(?:[A-Za-z]:)?[\w.@~-]*[\\/][\w.@\\/-]+/g, '<path>').replace(/['"`]/g, '').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 80);
  return `exit ${code}: ${norm}`;
}

// MCP tool results arrive as text blocks; KevMind's answers list files in backticks.
function responseText(r) {
  if (typeof r === 'string') return r;
  const blocks = Array.isArray(r) ? r : Array.isArray(r?.content) ? r.content : [];
  return blocks.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
}

// Applies one logged hook event to the aggregate.
export function ingest(agg, e, ts) {
  if (!e || !e.session_id || !e.cwd) return;
  const proj = projectOf(agg, e.cwd);
  if (!proj) return;
  if (proj._ctx) proj._ctx = null; // new evidence: the next query recomputes
  const s = (proj.sessions[e.session_id] ||= { first: ts, last: ts, r: {}, e: {}, ed: [], rc: {}, ec: {}, ag: {}, runs: [], calls: [] });
  if (ts < s.first) s.first = ts;
  if (ts > s.last) s.last = ts;
  const tool = e.tool_name || '';
  const ev = e.hook_event_name;

  if (ev === 'PreToolUse' && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool))) {
    const rel = relPath(proj.root, e.tool_input?.file_path || e.tool_input?.notebook_path);
    if (!rel) return;
    const f = fileId(proj, rel);
    const agent = e.agent_type || (e.agent_id ? 'subagent' : 'main');
    if (!(s.ag[f] ||= []).includes(agent)) s.ag[f].push(agent);
    if (READ_TOOLS.has(tool)) {
      if (!(f in s.r)) s.r[f] = ts;
      s.rc[f] = (s.rc[f] || 0) + 1;
    } else {
      if (!(f in s.e)) s.e[f] = ts;
      s.ec[f] = (s.ec[f] || 0) + 1;
      if (s.ed.length < 2000) s.ed.push([ts, f]);
    }
    return;
  }
  if ((ev === 'PostToolUse' || ev === 'PostToolUseFailure') && tool === 'Bash') {
    const fam = commandFamily(e.tool_input?.command);
    if (!fam || e.is_interrupt) return;
    let ok = ev === 'PostToolUse';
    if (!ok && /Exit code 1\b/.test(String(e.error || '')) && NO_MATCH_OK.has(fam.split(' ')[0])) ok = true;
    const famId = intern(proj, 'fams', '_fam', fam);
    const sigId = ok ? -1 : intern(proj, 'sigs', '_sig', errorSignature(e.error));
    if (s.runs.length < 2000) s.runs.push([ts, famId, ok ? 1 : 0, sigId]);
    return;
  }
  const m = MCP_TOOL_RE.exec(tool);
  if (m && (ev === 'PostToolUse' || ev === 'PostToolUseFailure')) {
    const text = responseText(e.tool_response);
    const files = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]).filter((p) => /[\w-]\.\w+$|\//.test(p)))].slice(0, 20);
    s.calls.push([ts, m[1], tokensOf(text), text.startsWith(NO_DATA) ? 1 : 0, files.map((p) => fileId(proj, p)), e.duration_ms || 0]);
  }
}

// Reads what was appended to the logs since the aggregate last saw them. Returns false when a log shrank or
// vanished (rewritten by `kevmind clear`): the caller then rebuilds from an empty aggregate.
export async function updateFromLogs(agg, dataDir, now = Date.now()) {
  const files = logFiles(dataDir);
  for (const name of Object.keys(agg.logs)) if (!files.includes(name)) return false;
  for (const name of files) {
    const file = path.join(dataDir, name);
    let size;
    try { size = fs.statSync(file).size; } catch { continue; }
    const from = agg.logs[name] || 0;
    if (size < from) return false;
    if (size === from) continue;
    const buf = await readRange(file, from, size);
    const end = buf.lastIndexOf(10); // only complete lines; a line still being written waits for the next update
    if (end < 0) continue;
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.ts >= now - THRESHOLDS.windowDays * DAY) ingest(agg, o.e, o.ts);
    }
    agg.logs[name] = from + end + 1;
  }
  prune(agg, now);
  agg.at = now;
  return true;
}

function readRange(file, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    fs.createReadStream(file, { start, end: end - 1 }).on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}

function prune(agg, now) {
  const cut = now - THRESHOLDS.windowDays * DAY;
  for (const proj of Object.values(agg.projects)) for (const [id, s] of Object.entries(proj.sessions)) if (s.last < cut) delete proj.sessions[id];
}

// Rebuilds lookup tables after JSON.parse.
export function revive(agg) {
  if (!agg || agg.version !== 2 || !agg.projects) return emptyAggregate(); // older formats are rebuilt from the logs
  for (const proj of Object.values(agg.projects)) index(proj);
  return agg;
}

// ---- git history ---------------------------------------------------------------------------------------------

function gitRead(cwd, args) {
  if (!GIT_READ.has(args[0])) throw new Error('experience.js only runs git log');
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 8000, windowsHide: true, maxBuffer: 128 * 1024 * 1024 }, (err, out) => resolve(err ? null : out));
  });
}

// Commits of the last year (at most 2,000, no merges), each with the files it changed; refreshed incrementally.
export async function refreshGit(proj, now = Date.now()) {
  if (!fs.existsSync(path.join(proj.root, '.git'))) { proj.git = { at: now, commits: [] }; return proj.git; }
  index(proj);
  const old = proj.git?.commits || [];
  const since = old.length ? Math.max(...old.map((c) => c[1])) - DAY : now - THRESHOLDS.gitMaxDays * DAY;
  const out = await gitRead(proj.root, ['log', '--no-merges', '--name-only', '--format=%x1e%h%x1f%ct%x1f%s',
    `-n${THRESHOLDS.gitMaxCommits}`, `--since=${Math.floor(since / 1000)}`]);
  if (out === null) { proj.git = { at: now, commits: old }; return proj.git; }
  const seen = new Set(old.map((c) => c[0]));
  const fresh = [];
  for (const rec of out.split('\x1e')) {
    const [head, ...rest] = rec.split('\n');
    if (!head.trim()) continue;
    const [hash, ct, subject = ''] = head.split('\x1f');
    if (seen.has(hash)) continue;
    const files = rest.map((l) => l.trim()).filter((f) => f && !LOCK_RE.test(f));
    if (!files.length || files.length > THRESHOLDS.gitMaxFilesPerCommit) continue;
    fresh.push([hash, Number(ct) * 1000, files.map((f) => fileId(proj, f)), FIX_RE.test(subject) ? 1 : 0]);
  }
  const cut = now - THRESHOLDS.gitMaxDays * DAY;
  if (proj._ctx) proj._ctx = null;
  proj.git = { at: now, commits: [...fresh, ...old].filter((c) => c[1] >= cut).sort((a, b) => b[1] - a[1]).slice(0, THRESHOLDS.gitMaxCommits) };
  return proj.git;
}

// ---- queries -------------------------------------------------------------------------------------------------

const T = THRESHOLDS;

function windowSessions(proj, now) {
  const cut = now - T.windowDays * DAY;
  return Object.values(proj.sessions).filter((s) => s.last >= cut);
}

export function gate(proj, now = Date.now()) {
  const sessions = proj ? windowSessions(proj, now) : [];
  const days = new Set(sessions.map((s) => day(s.first))).size;
  const commits = proj?.git?.commits?.length || 0;
  return {
    sessions: sessions.length, days, commits,
    sessionOk: sessions.length >= T.minSessions && days >= T.minSessionDays,
    gitOk: commits >= T.minGitCommits,
  };
}

// Precomputed per query: file -> sessions that edited it, commits that touched it, and hub files.
function context(proj, now) {
  if (proj._ctx && proj._ctx.at === now) return proj._ctx;
  const sessions = windowSessions(proj, now);
  const editedIn = new Map();
  const readIn = new Map();
  for (const s of sessions) {
    for (const f of Object.keys(s.e)) (editedIn.get(+f) || editedIn.set(+f, []).get(+f)).push(s);
    for (const f of Object.keys(s.r)) readIn.set(+f, (readIn.get(+f) || 0) + 1);
  }
  const commits = proj.git?.commits || [];
  const commitsOf = new Map();
  for (const c of commits) for (const f of c[2]) (commitsOf.get(f) || commitsOf.set(f, []).get(f)).push(c);
  const editSessions = sessions.filter((s) => Object.keys(s.e).length).length;
  const hub = (f) => (editSessions >= T.hubMinSample && (editedIn.get(f)?.length || 0) / editSessions > T.hubShare)
    || (sessions.length >= T.hubMinSample && (readIn.get(f) || 0) / sessions.length > T.hubShare);
  const gitHub = (f) => commits.length >= T.hubMinSample && (commitsOf.get(f)?.length || 0) / commits.length > T.hubShare;
  const ctx = { at: now, sessions, editedIn, commitsOf, hub, gitHub, gate: gate(proj, now) };
  Object.defineProperty(proj, '_ctx', { value: ctx, enumerable: false, writable: true, configurable: true });
  return ctx;
}

// Files changed alongside f: from sessions (edited together) and git (committed together). Session evidence first.
export function partners(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  const out = new Map();
  if (ctx.gate.sessionOk) {
    const mine = ctx.editedIn.get(f) || [];
    const count = new Map();
    for (const s of mine) {
      for (const k of Object.keys(s.e)) {
        const g = +k;
        if (g === f) continue;
        const c = count.get(g) || { n: 0, days: new Set(), last: 0 };
        c.n++;
        c.days.add(day(s.first));
        c.last = Math.max(c.last, s.last);
        count.set(g, c);
      }
    }
    for (const [g, c] of count) {
      if (c.n >= T.coEditSessions && c.days.size >= T.coEditDays && c.n / mine.length >= T.coEditShare && !ctx.hub(g)) {
        out.set(g, { f: g, s: { n: c.n, of: mine.length, last: c.last } });
      }
    }
  }
  if (ctx.gate.gitOk) {
    const mine = ctx.commitsOf.get(f) || [];
    const count = new Map();
    for (const c of mine) for (const g of c[2]) if (g !== f) { const x = count.get(g) || { n: 0, last: 0 }; x.n++; x.last = Math.max(x.last, c[1]); count.set(g, x); }
    for (const [g, c] of count) {
      if (c.n >= T.gitCoChangeCommits && c.n / mine.length >= T.gitCoChangeShare && !ctx.gitHub(g)) {
        const o = out.get(g) || { f: g };
        o.g = { n: c.n, of: mine.length, last: c.last };
        out.set(g, o);
      }
    }
  }
  return [...out.values()].sort((a, b) => (b.s ? 1 : 0) - (a.s ? 1 : 0) || (b.s?.n || 0) - (a.s?.n || 0) || (b.g?.n || 0) - (a.g?.n || 0));
}

// Files read before f's first edit, in enough of the sessions that edited it.
export function readFirst(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  if (!ctx.gate.sessionOk) return [];
  const mine = ctx.editedIn.get(f) || [];
  const count = new Map();
  for (const s of mine) {
    for (const [k, ts] of Object.entries(s.r)) {
      const g = +k;
      if (g === f || ts >= s.e[f]) continue;
      const c = count.get(g) || { n: 0, last: 0 };
      c.n++;
      c.last = Math.max(c.last, s.last);
      count.set(g, c);
    }
  }
  return [...count].filter(([g, c]) => c.n >= T.readFirstSessions && c.n / mine.length >= T.readFirstShare && !ctx.hub(g))
    .map(([g, c]) => ({ f: g, n: c.n, of: mine.length, last: c.last })).sort((a, b) => b.n - a.n);
}

// Recurring failures (same command family and error in enough sessions) that had the same fix each time.
export function failures(proj, now = Date.now(), prefix = '') {
  const ctx = context(proj, now);
  if (!ctx.gate.sessionOk) return [];
  const groups = new Map();
  for (const s of ctx.sessions) {
    const runs = s.runs;
    for (let i = 0; i < runs.length; i++) {
      const [ts, fam, ok, sig] = runs[i];
      if (ok) continue;
      const famName = proj.fams[fam];
      if (prefix && !famName.startsWith(prefix.toLowerCase())) continue;
      const key = `${fam}|${sig}`;
      const g = groups.get(key) || { fam: famName, sig: proj.sigs[sig], sessions: new Set(), occurrences: 0, fixes: new Map(), last: 0 };
      g.sessions.add(s);
      g.occurrences++;
      g.last = Math.max(g.last, ts);
      const next = runs.slice(i + 1).find((r) => r[1] === fam && r[2] === 1 && r[0] - ts <= T.fixWindowMs);
      if (next) {
        const items = new Set();
        for (const [t, f] of s.ed) if (t > ts && t < next[0]) items.add(`file:${proj.files[f]}`);
        for (const r of runs) if (r[0] > ts && r[0] < next[0] && r[2] === 1 && r[1] !== fam) items.add(`cmd:${proj.fams[r[1]]}`);
        for (const it of items) g.fixes.set(it, (g.fixes.get(it) || 0) + 1);
      }
      groups.set(key, g);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.sessions.size < T.failureSessions) continue;
    const best = [...g.fixes].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < T.fixRepeats) continue;
    const [kind, ...name] = best[0].split(':');
    out.push({ fam: g.fam, sig: g.sig, sessions: g.sessions.size, occurrences: g.occurrences, fix: { kind, name: name.join(':'), n: best[1] }, last: g.last });
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

export function history(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  let reads = 0, edits = 0, first = 0, last = 0;
  const sessions = new Set();
  const agents = {};
  for (const s of ctx.sessions) {
    if (!(f in s.r) && !(f in s.e)) continue;
    sessions.add(s);
    reads += s.rc[f] || 0;
    edits += s.ec[f] || 0;
    first = first ? Math.min(first, s.first) : s.first;
    last = Math.max(last, s.last);
    for (const a of s.ag[f] || []) agents[a] = (agents[a] || 0) + 1;
  }
  const commits = ctx.commitsOf.get(f) || [];
  return {
    sessions: sessions.size, reads, edits, first, last, agents,
    git: { changes: commits.length, fixes: commits.filter((c) => c[3]).length, last: commits[0]?.[1] || 0, first: commits.at(-1)?.[1] || 0 },
  };
}

// ---- answers (what the MCP tools return) ---------------------------------------------------------------------

const ev = (x) => (x.s ? `sessions: ${x.s.n} of ${x.s.of}, last ${day(x.s.last)}` : '') + (x.s && x.g ? '; ' : '') + (x.g ? `git: ${x.g.n} of ${x.g.of} commits, last ${day(x.g.last)}` : '');

function capped(header, lines, footer) {
  const budget = T.maxTokens * 4; // characters, the same estimate used everywhere
  let out = header + '\n';
  let omitted = 0;
  for (const l of lines) {
    if ((out + l + '\n' + footer).length > budget - 60) { omitted++; continue; }
    out += l + '\n';
  }
  if (omitted) out += `(${omitted} more line${omitted > 1 ? 's' : ''} left out to stay under ${T.maxTokens} tokens)\n`;
  return (out + footer).slice(0, budget);
}

function scope(proj, now) {
  const g = gate(proj, now);
  return `Evidence: ${g.sessions} Claude Code sessions over ${g.days} days (last ${T.windowDays} days)${g.sessionOk ? '' : ', below the session threshold'}; ` +
    `${g.commits} git commits${g.gitOk ? '' : ', below the git threshold'}. History only: for code structure use Serena or other code tools.`;
}

function notEnough(proj, name, now) {
  const g = gate(proj, now);
  return `${NO_DATA} not enough history for ${name} yet (${g.sessions} sessions over ${g.days} days, ${g.commits} git commits). ` +
    `KevMind answers once there are ${T.minSessions} sessions over ${T.minSessionDays} days, or ${T.minGitCommits} commits.`;
}

const fileOf = (proj, p) => proj._fi.get(relPath(proj.root, p) || slash(String(p || '')).replace(/^\.\//, ''));

export function answerFileContext(proj, name, paths, now = Date.now()) {
  if (!proj) return notEnough(null, name, now);
  index(proj);
  const g = context(proj, now).gate;
  if (!g.sessionOk && !g.gitOk) return notEnough(proj, name, now);
  const lines = [];
  let any = false;
  for (const p of paths.slice(0, 10)) {
    const f = fileOf(proj, p);
    const label = f === undefined ? relPath(proj.root, p) || p : proj.files[f];
    if (f === undefined) { lines.push(`- \`${label}\`: no data (never read or edited in recorded sessions, not in git history).`); continue; }
    const parts = partners(proj, f, now).slice(0, T.maxItems);
    const reads = readFirst(proj, f, now).slice(0, T.maxItems);
    const h = history(proj, f, now);
    const hot = h.git.fixes >= T.hotspotFixCommits ? `often fixed: ${h.git.fixes} of ${h.git.changes} commits touching it are fixes (git)` : '';
    if (!parts.length && !reads.length && !hot) {
      lines.push(`- \`${label}\`: no pattern above the thresholds (seen in ${plural(h.sessions, 'session')}, ${plural(h.git.changes, 'commit')}).`);
      continue;
    }
    any = true;
    lines.push(`- \`${label}\`:`);
    for (const x of parts) lines.push(`  - changes with \`${proj.files[x.f]}\` (${ev(x)})`);
    for (const x of reads) lines.push(`  - usually read first: \`${proj.files[x.f]}\` (sessions: ${x.n} of ${x.of}, last ${day(x.last)})`);
    if (hot) lines.push(`  - ${hot}`);
  }
  const header = any ? `KevMind history for ${name}:` : `${NO_DATA} no pattern above the thresholds for these files in ${name}.`;
  return capped(header, lines, scope(proj, now));
}

export function answerFileHistory(proj, name, p, now = Date.now()) {
  if (!proj) return notEnough(null, name, now);
  index(proj);
  const f = fileOf(proj, p);
  const label = f === undefined ? relPath(proj.root, p) || p : proj.files[f];
  if (f === undefined) return `${NO_DATA} \`${label}\` was never read or edited in recorded ${name} sessions and is not in its git history.\n${scope(proj, now)}`;
  const h = history(proj, f, now);
  if (!h.sessions && !h.git.changes) return `${NO_DATA} \`${label}\` has no recorded activity in the window.\n${scope(proj, now)}`;
  const lines = [];
  if (h.sessions) {
    const agents = Object.entries(h.agents).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ');
    lines.push(`- Claude Code sessions: ${h.sessions} (${day(h.first)} to ${day(h.last)}), ${h.reads} reads, ${h.edits} edits.`);
    lines.push(`- Agent types (sessions): ${agents}.`);
  } else lines.push('- Claude Code sessions: none recorded.');
  if (h.git.changes) lines.push(`- git: changed in ${h.git.changes} commits (${day(h.git.first)} to ${day(h.git.last)}), ${h.git.fixes} labeled as fixes.`);
  else lines.push('- git: no commits in the window.');
  return capped(`KevMind history of \`${label}\` in ${name}:`, lines, scope(proj, now));
}

export function answerKnownFailures(proj, name, command = '', now = Date.now()) {
  if (!proj) return notEnough(null, name, now);
  index(proj);
  const g = context(proj, now).gate;
  if (!g.sessionOk) {
    return `${NO_DATA} failures come from Claude Code sessions only, and ${name} has ${g.sessions} sessions over ${g.days} days ` +
      `(KevMind needs ${T.minSessions} over ${T.minSessionDays} days).`;
  }
  const fam = command ? commandFamily(command) || command : '';
  const list = failures(proj, now, fam);
  if (!list.length) return `${NO_DATA} no recurring failure with a consistent fix${fam ? ` for \`${fam}\`` : ''} in ${name}.\n${scope(proj, now)}`;
  const lines = list.map((x) => `- \`${x.fam}\` failed with "${x.sig}" in ${x.sessions} sessions (${x.occurrences} times, last ${day(x.last)}); ` +
    `${x.fix.n} times the next success came after ${x.fix.kind === 'file' ? `editing \`${x.fix.name}\`` : `running \`${x.fix.name}\``}.`);
  return capped(`KevMind: known failures in ${name}:`, lines, scope(proj, now));
}

// ---- dashboard: what would qualify today, and whether the tools help -----------------------------------------

export function preview(proj, now = Date.now()) {
  index(proj);
  const ctx = context(proj, now);
  const pairs = new Map();
  const reads = [];
  const files = new Set([...ctx.editedIn.keys(), ...ctx.commitsOf.keys()]);
  for (const f of files) {
    for (const x of partners(proj, f, now)) {
      const k = [Math.min(f, x.f), Math.max(f, x.f)].join('|');
      // Raw counts: the dashboard words them in its own language. ev(x) is how the tools word them for Claude.
      if (!pairs.has(k)) pairs.set(k, { a: proj.files[f], b: proj.files[x.f], s: x.s ? { ...x.s, last: day(x.s.last) } : null, g: x.g ? { ...x.g, last: day(x.g.last) } : null, session: !!x.s, n: x.s?.n || x.g?.n || 0 });
    }
    for (const x of readFirst(proj, f, now)) reads.push({ file: proj.files[f], first: proj.files[x.f], n: x.n, of: x.of });
  }
  const hotspots = [...ctx.commitsOf].map(([f, cs]) => ({ file: proj.files[f], changes: cs.length, fixes: cs.filter((c) => c[3]).length }))
    .sort((a, b) => b.fixes - a.fixes || b.changes - a.changes).slice(0, 5);
  return {
    gate: ctx.gate,
    coChange: [...pairs.values()].sort((a, b) => b.session - a.session || b.n - a.n).slice(0, 10),
    readFirst: reads.slice(0, 5),
    failures: failures(proj, now).slice(0, 5).map((x) => ({ ...x, last: day(x.last) })),
    hotspots,
  };
}

// Calls seen through the hooks, and how often a suggested file was then read or edited, against a baseline:
// how often a qualifying partner gets touched after an edit in sessions with no call. Correlation, not proof.
export function measure(proj, now = Date.now()) {
  index(proj);
  const ctx = context(proj, now);
  const calls = [];
  let opportunities = 0;
  let hits = 0;
  const partnerCache = new Map();
  const partnersOf = (f) => partnerCache.get(f) || partnerCache.set(f, partners(proj, f, now).map((x) => x.f)).get(f);
  const touchedAfter = (s, f, t0) => {
    const t = Math.min(s.r[f] ?? Infinity, s.e[f] ?? Infinity);
    return t > t0 && t - t0 <= T.followWindowMs;
  };
  for (const s of ctx.sessions) {
    if (s.calls.length) {
      for (const [ts, tool, tokens, noData, files, ms] of s.calls) {
        calls.push({ ts, tool, tokens, noData: !!noData, ms, suggested: files.map((f) => proj.files[f]), followed: files.length ? files.some((f) => touchedAfter(s, f, ts)) : null });
      }
      continue;
    }
    for (const [k, t0] of Object.entries(s.e)) {
      const ps = partnersOf(+k);
      if (!ps.length) continue;
      opportunities++;
      if (ps.some((g) => touchedAfter(s, g, t0))) hits++;
    }
  }
  calls.sort((a, b) => b.ts - a.ts);
  const withSuggestions = calls.filter((c) => c.followed !== null);
  const followed = withSuggestions.filter((c) => c.followed).length;
  const rate = withSuggestions.length ? followed / withSuggestions.length : null;
  const baseline = opportunities ? hits / opportunities : null;
  return {
    calls: calls.length,
    tokens: calls.reduce((n, c) => n + c.tokens, 0),
    noData: calls.filter((c) => c.noData).length,
    avgMs: calls.length ? Math.round(calls.reduce((n, c) => n + (c.ms || 0), 0) / calls.length) : 0,
    followRate: rate, followed, withSuggestions: withSuggestions.length,
    baseline, baselineSample: opportunities,
    verdict: calls.length < 50 ? 'collecting' : rate !== null && baseline !== null && rate <= baseline ? 'turn_off' : 'helping',
    last: calls.slice(0, 20),
  };
}
