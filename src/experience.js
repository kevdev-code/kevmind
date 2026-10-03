// KevMind's "work experience": what Claude Code did in a project (from KevMind's own event log) and what the
// project's git history shows, aggregated so the MCP tools answer in milliseconds. History only: no code parsing,
// no symbols, no indexing. Read-only: test/experience-readonly.test.mjs fails if this module could write anything
// or run git with anything but `log`. The dashboard server is what persists the aggregate (experience.json).
//
// The unit of session evidence is the work episode, not the session, because one long session can hold days of
// work: a user prompt turn that ends with at least one edit, or, in a session without prompts, a block of activity
// separated from the next by more than 30 minutes. Compactions and system-injected prompts don't start one.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { projectRoot, keyOf, tokensOf } from './memory.js';

// Every threshold in one place. An insight below its threshold is never served.
export const THRESHOLDS = {
  windowDays: 90,          // episodes older than this are ignored
  episodeGapMs: 30 * 60_000, // in a session without prompts, this much silence starts a new episode
  minDays: 2,              // every episode-based insight must repeat on at least this many different days
  coEditEpisodes: 3,       // edited together in at least this many episodes...
  coEditShare: 0.5,        // ...and in at least this share of the episodes that edited the file
  readFirstEpisodes: 3,    // read before the file's first edit in at least this many episodes...
  readFirstShare: 0.6,     // ...and this share of its edit episodes
  failureEpisodes: 2,      // the same failure (command family + error) in at least this many episodes
  fixRepeats: 2,           // the same fix before the next success at least this many times
  fixWindowMs: 15 * 60_000,
  hubShare: 0.4,           // a file in more than this share of episodes or commits is a hub: it changes with everything...
  hubLift: 1.25,           // ...so as a partner it must change with the file at least this many times as often as overall
  hubMinSample: 10,        // (the hub rule applies once there are this many episodes or commits)
  minGitCommits: 20,       // git evidence counts once the window holds this many commits
  gitMaxCommits: 2000,
  gitMaxDays: 365,
  gitMaxFilesPerCommit: 30, // bigger commits are refactors or imports, not co-change evidence
  gitCoChangeCommits: 3,
  gitCoChangeShare: 0.5,
  hotspotFixCommits: 3,    // mention "often fixed" from this many fix-labeled commits
  followWindowMs: 30 * 60_000, // a suggested file touched this soon after a call counts as followed
  areaWindowMs: 15 * 60_000, // reads in an area are counted this long after a call (or after entering it), within the prompt turn
  minStretches: 3,           // comparable stretches without a call needed before a call is compared
  maxTokens: 400,          // per tool answer, estimated as characters / 4
  maxItems: 3,             // per kind of insight, per file
};

const DAY = 86_400_000;
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const NO_MATCH_OK = new Set(['grep', 'rg', 'egrep', 'fgrep', 'diff', 'cmp', 'test', '[']); // exit 1 means "no match", not a failure
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'git', 'docker', 'cargo', 'go', 'python', 'python3', 'pip', 'make', 'node', 'deno', 'dotnet', 'mvn', 'gradle', 'php', 'composer']);
// Claude Code's own messages arrive through UserPromptSubmit too; they don't start an episode.
const SYSTEM_PROMPT_RE = /^\s*<(task-notification|bash-notification|bash-stdout|bash-stderr|system-reminder|command-message|local-command-stdout)[\s>]/i;
// Lockfiles, generated and binary files: they change with everything, or are outputs, so they say nothing as partners.
const LOCK_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|(^|\/)(dist|build|out|coverage|generated|__generated__|graphify-out)\/|\.(pdf|png|jpe?g|gif|webp|ico|svgz|zip|gz|tgz|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|exe|dll|so|dylib|class|jar|pyc|wasm|bin)$/i;
// A shell syntax mistake in the command itself (a heredoc or a quote left open, a stray token, a mistyped command) is
// not a failure of the project: never a known failure, and not counted as one by the briefing's measurement.
const SHELL_ERROR_RE = /unexpected EOF while looking for matching|syntax error near unexpected token|syntax error: unexpected end of file|unterminated quoted string|unmatched ['"`]|bad substitution|command not found/i;
export const isShellError = (sig) => SHELL_ERROR_RE.test(String(sig || ''));
const FIX_RE = /\b(fix(e[sd])?|bug|hotfix|revert|arregl\w*|correg\w*|corrig\w*)\b/i;
const GIT_READ = new Set(['log']);
export const MCP_TOOL_RE = /^mcp__(?:plugin_kevmind_experience|kevmind(?:-experience)?)__(\w+)$/; // plugin and manual installs
export const NO_DATA = 'No data:';

// The machine's local calendar day, for display and for counting distinct days: an evening that crosses midnight
// UTC is still one day of work. Timestamps are stored as they are.
const pad2 = (n) => String(n).padStart(2, '0');
const day = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
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
// session = { first, last, prompted, eps: [episode] }
// episode = { start, last, r: {file: first read ts}, e: {file: first edit ts}, ed: [[ts, file]],
//   rc: {file: reads}, ec: {file: edits}, ag: {file: [agent types]}, runs: [[ts, fam, ok, sig]],
//   calls: [[ts, tool, tokens, noData, [files], ms]], of?: start of the session-project episode it mirrors }
// An episode without edits is kept (for reads, calls and measurement) but never counted as evidence.

export const emptyAggregate = () => ({ version: 4, at: 0, logs: {}, projects: {} });

const hidden = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: false, writable: true, configurable: true });

// Lookup tables are rebuilt on load and never saved.
function index(proj) {
  if (!proj._fi) {
    hidden(proj, '_fi', new Map(proj.files.map((f, i) => [f, i])));
    hidden(proj, '_fam', new Map(proj.fams.map((f, i) => [f, i])));
    hidden(proj, '_sig', new Map(proj.sigs.map((f, i) => [f, i])));
  }
  return proj;
}
const intern = (proj, list, map, v) => {
  let i = proj[map].get(v);
  if (i === undefined) { i = proj[list].push(v) - 1; proj[map].set(v, i); }
  return i;
};
const fileId = (proj, rel) => intern(proj, 'files', '_fi', rel);

export function projectAt(agg, root) {
  const k = keyOf(root);
  if (!agg.projects[k]) agg.projects[k] = { root, name: path.basename(root), files: [], sessions: {}, fams: [], sigs: [], git: null };
  return index(agg.projects[k]);
}

// The git repo holding a file or folder: a separate repo nested inside the session's project (such as frontend/
// with its own .git), or the project itself. Repos outside the project are never returned.
export function repoFor(root, file) {
  const abs = path.resolve(root, String(file));
  if (!relPath(root, abs)) return root;
  const r = projectRoot(abs);
  return r && keyOf(r) !== keyOf(root) && relPath(root, r) && fs.existsSync(path.join(r, '.git')) ? r : root;
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

const newEpisode = (ts) => ({ start: ts, last: ts, r: {}, e: {}, ed: [], rc: {}, ec: {}, ag: {}, runs: [], calls: [] });
const hasActivity = (ep) => ep.ed.length || ep.runs.length || ep.calls.length || Object.keys(ep.r).length;

// The episode an event belongs to. A real user prompt opens a new one; in a session that never had a prompt,
// more than 30 minutes of silence does. Compactions and system-injected prompts never do.
function episodeFor(s, ts, e) {
  const cur = s.eps[s.eps.length - 1];
  if (e.hook_event_name === 'UserPromptSubmit') {
    if (SYSTEM_PROMPT_RE.test(String(e.prompt || ''))) return cur || (s.eps.push(newEpisode(ts)), s.eps[0]);
    s.prompted = true;
    if (cur && !hasActivity(cur)) { cur.start = ts; return cur; }
    s.eps.push(newEpisode(ts));
    return s.eps[s.eps.length - 1];
  }
  if (!cur || (!s.prompted && ts - cur.last > THRESHOLDS.episodeGapMs)) s.eps.push(newEpisode(ts));
  return s.eps[s.eps.length - 1];
}

// Work on a file in a nested repo is filed under that repo, in an episode that mirrors the session's current one
// (`of` is its start), so episode boundaries still follow the user's prompts.
function mirror(agg, repo, sid, ep, ts) {
  const p = projectAt(agg, repo);
  if (p._ctx) p._ctx = null;
  const s = (p.sessions[sid] ||= { first: ts, last: ts, prompted: false, eps: [] });
  if (ts < s.first) s.first = ts;
  if (ts > s.last) s.last = ts;
  let x = s.eps[s.eps.length - 1];
  if (!x || x.of !== ep.start) s.eps.push(x = { ...newEpisode(ts), of: ep.start });
  if (ts > x.last) x.last = ts;
  return [p, x];
}

// Applies one logged hook event to the aggregate.
export function ingest(agg, e, ts) {
  if (!e || !e.session_id || !e.cwd) return;
  const root = projectRoot(e.cwd);
  if (!root) return;
  const proj = projectAt(agg, root);
  if (proj._ctx) proj._ctx = null; // new evidence: the next query recomputes
  const s = (proj.sessions[e.session_id] ||= { first: ts, last: ts, prompted: false, eps: [] });
  if (ts < s.first) s.first = ts;
  if (ts > s.last) s.last = ts;
  const ep = episodeFor(s, ts, e);
  if (ts > ep.last) ep.last = ts;
  const tool = e.tool_name || '';
  const ev = e.hook_event_name;

  if (ev === 'PreToolUse' && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool))) {
    const file = e.tool_input?.file_path || e.tool_input?.notebook_path;
    if (!relPath(proj.root, file)) return;
    const abs = path.resolve(proj.root, file);
    const repo = repoFor(proj.root, abs);
    const [p, x] = repo === proj.root ? [proj, ep] : mirror(agg, repo, e.session_id, ep, ts);
    const f = fileId(p, relPath(p.root, abs));
    recordFile(x, f, tool, e, ts);
    return;
  }
  if ((ev === 'PostToolUse' || ev === 'PostToolUseFailure') && tool === 'Bash') {
    const fam = commandFamily(e.tool_input?.command);
    if (!fam || e.is_interrupt) return;
    let ok = ev === 'PostToolUse';
    if (!ok && /Exit code 1\b/.test(String(e.error || '')) && NO_MATCH_OK.has(fam.split(' ')[0])) ok = true;
    const famId = intern(proj, 'fams', '_fam', fam);
    const sigId = ok ? -1 : intern(proj, 'sigs', '_sig', errorSignature(e.error));
    if (ep.runs.length < 2000) ep.runs.push([ts, famId, ok ? 1 : 0, sigId]);
    return;
  }
  const m = MCP_TOOL_RE.exec(tool);
  if (m && (ev === 'PostToolUse' || ev === 'PostToolUseFailure')) {
    // Answers cite files relative to the session's project; a call is recorded in every repo whose files it cites.
    const text = responseText(e.tool_response);
    const cited = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]).filter((p) => /[\w-]\.\w+$|\//.test(p)))].slice(0, 20);
    const byRepo = new Map([[proj.root, []]]);
    for (const c of cited) {
      const abs = path.resolve(proj.root, c);
      const repo = relPath(proj.root, abs) ? repoFor(proj.root, abs) : proj.root;
      (byRepo.get(repo) || byRepo.set(repo, []).get(repo)).push(repo === proj.root ? c : relPath(repo, abs));
    }
    for (const [repo, files] of byRepo) {
      if (repo === proj.root && !files.length && byRepo.size > 1) continue;
      const [p, x] = repo === proj.root ? [proj, ep] : mirror(agg, repo, e.session_id, ep, ts);
      x.calls.push([ts, m[1], tokensOf(text), text.startsWith(NO_DATA) ? 1 : 0, files.map((c) => fileId(p, c)), e.duration_ms || 0]);
    }
  }
}

function recordFile(ep, f, tool, e, ts) {
  const agent = e.agent_type || (e.agent_id ? 'subagent' : 'main');
  if (!(ep.ag[f] ||= []).includes(agent)) ep.ag[f].push(agent);
  if (READ_TOOLS.has(tool)) {
    if (!(f in ep.r)) ep.r[f] = ts;
    ep.rc[f] = (ep.rc[f] || 0) + 1;
  } else {
    if (!(f in ep.e)) ep.e[f] = ts;
    ep.ec[f] = (ep.ec[f] || 0) + 1;
    if (ep.ed.length < 2000) ep.ed.push([ts, f]);
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
  for (const proj of Object.values(agg.projects)) {
    for (const [id, s] of Object.entries(proj.sessions)) {
      s.eps = s.eps.filter((ep) => ep.last >= cut);
      if (!s.eps.length) delete proj.sessions[id];
    }
  }
}

// Rebuilds lookup tables after JSON.parse. Older formats are rebuilt from the logs.
export function revive(agg) {
  if (!agg || agg.version !== 4 || !agg.projects) return emptyAggregate();
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
const isEpisode = (ep) => ep.ed.length > 0;

// Precomputed per query: every episode in the window with its session and day, which edit episodes touched each
// file, which commits did, and the hub files.
function context(proj, now) {
  if (proj._ctx && proj._ctx.at === now) return proj._ctx;
  const cut = now - T.windowDays * DAY;
  const all = [];
  for (const s of Object.values(proj.sessions)) for (const ep of s.eps) if (ep.last >= cut) all.push({ ep, s, day: day(ep.start) });
  const episodes = all.filter((x) => isEpisode(x.ep));
  const editedIn = new Map();
  const readIn = new Map();
  for (const x of episodes) {
    for (const f of Object.keys(x.ep.e)) (editedIn.get(+f) || editedIn.set(+f, []).get(+f)).push(x);
    for (const f of Object.keys(x.ep.r)) readIn.set(+f, (readIn.get(+f) || 0) + 1);
  }
  const commits = proj.git?.commits || [];
  const commitsOf = new Map();
  for (const c of commits) for (const f of c[2]) (commitsOf.get(f) || commitsOf.set(f, []).get(f)).push(c);
  // A hub partner (in most episodes or commits anyway) only counts when it goes with the file clearly more often
  // than it goes with everything: share >= its overall rate x hubLift.
  const rate = (f) => Math.max(editedIn.get(f)?.length || 0, readIn.get(f) || 0) / episodes.length;
  const hubOk = (g, share) => episodes.length < T.hubMinSample || rate(g) <= T.hubShare || share >= Math.min(1, rate(g) * T.hubLift);
  const gitRate = (f) => (commitsOf.get(f)?.length || 0) / commits.length;
  const gitHubOk = (g, share) => commits.length < T.hubMinSample || gitRate(g) <= T.hubShare || share >= Math.min(1, gitRate(g) * T.hubLift);
  const ctx = { at: now, all, episodes, editedIn, commitsOf, hubOk, gitHubOk, gate: gate(proj, now, episodes) };
  hidden(proj, '_ctx', ctx);
  return ctx;
}

// What evidence a project has: edit episodes and their days, and git commits (git counts from 20).
export function gate(proj, now = Date.now(), episodes = null) {
  if (!proj) return { episodes: 0, days: 0, commits: 0, gitOk: false };
  const eps = episodes || context(proj, now).episodes;
  const commits = proj.git?.commits?.length || 0;
  return { episodes: eps.length, days: new Set(eps.map((x) => x.day)).size, commits, gitOk: commits >= T.minGitCommits };
}

// Files changed alongside f: from episodes (edited together) and git (committed together). Episodes rank first.
export function partners(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  const out = new Map();
  const mine = ctx.editedIn.get(f) || [];
  const count = new Map();
  for (const x of mine) {
    for (const k of Object.keys(x.ep.e)) {
      const g = +k;
      if (g === f) continue;
      const c = count.get(g) || { n: 0, days: new Set(), last: 0 };
      c.n++;
      c.days.add(x.day);
      c.last = Math.max(c.last, x.ep.last);
      count.set(g, c);
    }
  }
  for (const [g, c] of count) {
    if (c.n >= T.coEditEpisodes && c.days.size >= T.minDays && c.n / mine.length >= T.coEditShare && ctx.hubOk(g, c.n / mine.length)) {
      out.set(g, { f: g, s: { n: c.n, days: c.days.size, of: mine.length, last: c.last } });
    }
  }
  if (ctx.gate.gitOk) {
    const theirs = ctx.commitsOf.get(f) || [];
    const gc = new Map();
    for (const c of theirs) for (const g of c[2]) if (g !== f) { const x = gc.get(g) || { n: 0, last: 0 }; x.n++; x.last = Math.max(x.last, c[1]); gc.set(g, x); }
    for (const [g, c] of gc) {
      if (c.n >= T.gitCoChangeCommits && c.n / theirs.length >= T.gitCoChangeShare && ctx.gitHubOk(g, c.n / theirs.length)) {
        const o = out.get(g) || { f: g };
        o.g = { n: c.n, of: theirs.length, last: c.last };
        out.set(g, o);
      }
    }
  }
  return [...out.values()].sort((a, b) => (b.s ? 1 : 0) - (a.s ? 1 : 0) || (b.s?.n || 0) - (a.s?.n || 0) || (b.g?.n || 0) - (a.g?.n || 0));
}

// Files read before f's first edit, in enough of the episodes that edited it, on enough days.
export function readFirst(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  const mine = ctx.editedIn.get(f) || [];
  const count = new Map();
  for (const x of mine) {
    for (const [k, ts] of Object.entries(x.ep.r)) {
      const g = +k;
      if (g === f || ts >= x.ep.e[f]) continue;
      const c = count.get(g) || { n: 0, days: new Set(), last: 0 };
      c.n++;
      c.days.add(x.day);
      c.last = Math.max(c.last, x.ep.last);
      count.set(g, c);
    }
  }
  return [...count].filter(([g, c]) => c.n >= T.readFirstEpisodes && c.days.size >= T.minDays && c.n / mine.length >= T.readFirstShare && ctx.hubOk(g, c.n / mine.length))
    .map(([g, c]) => ({ f: g, n: c.n, days: c.days.size, of: mine.length, last: c.last })).sort((a, b) => b.n - a.n);
}

// Recurring failures (same command family and error in enough episodes, on enough days) with the same fix each time.
// The fix is what happened between the failure and the next success of the same command in that session.
export function failures(proj, now = Date.now(), prefix = '') {
  const ctx = context(proj, now);
  const bySession = new Map();
  for (const x of ctx.all) (bySession.get(x.s) || bySession.set(x.s, []).get(x.s)).push(x);
  const groups = new Map();
  for (const [, list] of bySession) {
    const runs = list.flatMap((x) => x.ep.runs.map((r) => ({ r, x }))).sort((a, b) => a.r[0] - b.r[0]);
    const edits = list.flatMap((x) => x.ep.ed);
    for (let i = 0; i < runs.length; i++) {
      const { r: [ts, fam, ok, sig], x } = runs[i];
      if (ok || !isEpisode(x.ep) || isShellError(proj.sigs[sig])) continue;
      const famName = proj.fams[fam];
      if (prefix && !famName.startsWith(prefix.toLowerCase())) continue;
      const key = `${fam}|${sig}`;
      const g = groups.get(key) || { fam: famName, sig: proj.sigs[sig], episodes: new Set(), days: new Set(), occurrences: 0, fixes: new Map(), last: 0 };
      g.episodes.add(x.ep);
      g.days.add(x.day);
      g.occurrences++;
      g.last = Math.max(g.last, ts);
      const next = runs.slice(i + 1).find(({ r }) => r[1] === fam && r[2] === 1 && r[0] - ts <= T.fixWindowMs);
      if (next) {
        const items = new Set();
        for (const [t, f] of edits) if (t > ts && t < next.r[0]) items.add(`file:${proj.files[f]}`);
        for (const { r } of runs) if (r[0] > ts && r[0] < next.r[0] && r[2] === 1 && r[1] !== fam) items.add(`cmd:${proj.fams[r[1]]}`);
        for (const it of items) g.fixes.set(it, (g.fixes.get(it) || 0) + 1);
      }
      groups.set(key, g);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.episodes.size < T.failureEpisodes || g.days.size < T.minDays) continue;
    const best = [...g.fixes].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < T.fixRepeats) continue;
    const [kind, ...name] = best[0].split(':');
    out.push({ fam: g.fam, sig: g.sig, episodes: g.episodes.size, days: g.days.size, occurrences: g.occurrences, fix: { kind, name: name.join(':'), n: best[1] }, last: g.last });
  }
  return out.sort((a, b) => b.episodes - a.episodes);
}

export function history(proj, f, now = Date.now()) {
  const ctx = context(proj, now);
  let reads = 0, edits = 0, first = 0, last = 0;
  const editDays = new Set();
  let editEpisodes = 0;
  const agents = {};
  for (const x of ctx.all) {
    if (!(f in x.ep.r) && !(f in x.ep.e)) continue;
    reads += x.ep.rc[f] || 0;
    edits += x.ep.ec[f] || 0;
    first = first ? Math.min(first, x.ep.start) : x.ep.start;
    last = Math.max(last, x.ep.last);
    if (f in x.ep.e) { editEpisodes++; editDays.add(x.day); }
    for (const a of x.ep.ag[f] || []) agents[a] = (agents[a] || 0) + 1;
  }
  const commits = ctx.commitsOf.get(f) || [];
  return {
    editEpisodes, editDays: editDays.size, reads, edits, first, last, agents,
    git: { changes: commits.length, fixes: commits.filter((c) => c[3]).length, last: commits[0]?.[1] || 0, first: commits.at(-1)?.[1] || 0 },
  };
}

// ---- answers (what the MCP tools return) ---------------------------------------------------------------------

const epEv = (s) => `episodes: ${s.n} on ${plural(s.days, 'day')}, last ${day(s.last)}`;
// Both sources on one line, episodes first, with the latest date of either.
const ev = (x) => [x.s && `episodes: ${x.s.n} on ${plural(x.s.days, 'day')}`, x.g && `git: ${x.g.n} of ${x.g.of} commits`,
  `last ${day(Math.max(x.s?.last || 0, x.g?.last || 0))}`].filter(Boolean).join('; ');
const stronger = (a, b) => (!a ? b : !b ? a : b.n / b.of > a.n / a.of ? b : a);

function capped(header, lines, footer, tokens = T.maxTokens) {
  const budget = tokens * 4; // characters, the same estimate used everywhere
  let out = header + '\n';
  let omitted = 0;
  for (const l of lines) {
    if ((out + l + '\n' + footer).length > budget - 60) { omitted++; continue; }
    out += l + '\n';
  }
  if (omitted) out += `(${omitted} more line${omitted > 1 ? 's' : ''} left out to stay under ${tokens} tokens)\n`;
  return (out + footer).slice(0, budget);
}

function scope(proj, now) {
  const g = gate(proj, now);
  return `Evidence: ${plural(g.episodes, 'work episode')} on ${plural(g.days, 'day')} (last ${T.windowDays} days); ` +
    `${plural(g.commits, 'git commit')}${g.gitOk ? '' : ` (git counts from ${T.minGitCommits})`}. History only: for code structure, code_map (approximate) or Serena.`;
}

const fileOf = (proj, p) => proj._fi.get(relPath(proj.root, p) || slash(String(p || '')).replace(/^\.\//, ''));

// o.prefix: where the repo sits inside the session's project ("frontend/"), so cited paths open from there;
// o.tokens: this answer's share of the cap when one call spans several repos.
export function answerFileContext(proj, name, paths, now = Date.now(), o = {}) {
  if (!proj) return `${NO_DATA} KevMind has no history for ${name} yet: no recorded sessions and no git history.`;
  index(proj);
  const pre = o.prefix || '';
  const lines = [];
  const asked = []; // [label, file id or undefined, outside?]
  for (const p of paths.slice(0, 10)) {
    if (p && !relPath(proj.root, p)) { asked.push([p, undefined, true]); continue; }
    const f = fileOf(proj, p);
    if (!asked.some((a) => a[1] !== undefined && a[1] === f)) asked.push([pre + (f === undefined ? relPath(proj.root, p) || p : proj.files[f]), f, false]);
  }
  const ids = new Set(asked.map((a) => a[1]).filter((f) => f !== undefined));
  const parts = new Map([...ids].map((f) => [f, partners(proj, f, now)]));
  // Two asked files that change together: said once, with the stronger direction's evidence from each source.
  const pairs = new Map();
  for (const [f, list] of parts) {
    for (const x of list) {
      if (!ids.has(x.f)) continue;
      const k = [Math.min(f, x.f), Math.max(f, x.f)].join('|');
      const pr = pairs.get(k) || { a: Math.min(f, x.f), b: Math.max(f, x.f), s: null, g: null };
      pr.s = stronger(pr.s, x.s);
      pr.g = stronger(pr.g, x.g);
      pairs.set(k, pr);
    }
  }
  for (const pr of pairs.values()) lines.push(`- \`${pre}${proj.files[pr.a]}\` and \`${pre}${proj.files[pr.b]}\` usually change together (${ev(pr)})`);
  let any = pairs.size > 0;
  for (const [label, f, outside] of asked) {
    if (outside) { lines.push(`- \`${label}\`: outside ${name}; KevMind only answers for repos inside the session's folder.`); continue; }
    if (f === undefined) { lines.push(`- \`${label}\`: no data (never read or edited in recorded sessions, not in git history).`); continue; }
    const others = parts.get(f).filter((x) => !ids.has(x.f)).slice(0, T.maxItems);
    const reads = readFirst(proj, f, now).slice(0, T.maxItems);
    const h = history(proj, f, now);
    const hot = h.git.fixes >= T.hotspotFixCommits ? `often fixed: ${h.git.fixes} of ${h.git.changes} commits touching it are fixes (git)` : '';
    if (!others.length && !reads.length && !hot) {
      if (parts.get(f).length) continue; // its only pattern is the pair above
      lines.push(`- \`${label}\`: no pattern above the thresholds (edited in ${plural(h.editEpisodes, 'episode')} on ${plural(h.editDays, 'day')}, ${plural(h.git.changes, 'commit')}).`);
      continue;
    }
    any = true;
    lines.push(`- \`${label}\`:`);
    for (const x of others) lines.push(`  - changes with \`${pre}${proj.files[x.f]}\` (${ev(x)})`);
    for (const x of reads) lines.push(`  - usually read first: \`${pre}${proj.files[x.f]}\` (${epEv(x)})`);
    if (hot) lines.push(`  - ${hot}`);
  }
  const header = any ? `KevMind history for ${name}:` : `${NO_DATA} no pattern above the thresholds for these files in ${name}.`;
  return capped(header, lines, scope(proj, now), o.tokens);
}

export function answerFileHistory(proj, name, p, now = Date.now(), o = {}) {
  if (!proj) return `${NO_DATA} KevMind has no history for ${name} yet: no recorded sessions and no git history.`;
  index(proj);
  if (p && !relPath(proj.root, p)) return `${NO_DATA} \`${p}\` is outside ${name}; KevMind only answers for repos inside the session's folder.`;
  const f = fileOf(proj, p);
  const label = (o.prefix || '') + (f === undefined ? relPath(proj.root, p) || p : proj.files[f]);
  if (f === undefined) return `${NO_DATA} \`${label}\` was never read or edited in recorded ${name} sessions and is not in its git history.\n${scope(proj, now)}`;
  const h = history(proj, f, now);
  if (!h.reads && !h.edits && !h.git.changes) return `${NO_DATA} \`${label}\` has no recorded activity in the window.\n${scope(proj, now)}`;
  const lines = [];
  if (h.reads || h.edits) {
    const agents = Object.entries(h.agents).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ');
    lines.push(`- Claude Code: edited in ${plural(h.editEpisodes, 'work episode')} on ${plural(h.editDays, 'day')} (${day(h.first)} to ${day(h.last)}), ${h.reads} reads, ${h.edits} edits.`);
    lines.push(`- Agent types (episodes): ${agents}.`);
  } else lines.push('- Claude Code: no recorded activity.');
  if (h.git.changes) lines.push(`- git: changed in ${h.git.changes} commits (${day(h.git.first)} to ${day(h.git.last)}), ${h.git.fixes} labeled as fixes.`);
  else lines.push('- git: no commits in the window.');
  return capped(`KevMind history of \`${label}\` in ${name}:`, lines, scope(proj, now));
}

export function answerKnownFailures(proj, name, command = '', now = Date.now()) {
  if (!proj) return `${NO_DATA} KevMind has no recorded sessions for ${name} yet.`;
  index(proj);
  const fam = command ? commandFamily(command) || command : '';
  const list = failures(proj, now, fam);
  if (!list.length) {
    return `${NO_DATA} no failure${fam ? ` of \`${fam}\`` : ''} in ${name} repeated in ${T.failureEpisodes} work episodes on ${T.minDays} days with the same fix.\n${scope(proj, now)}`;
  }
  const lines = list.map((x) => `- \`${x.fam}\` failed with "${x.sig}" (episodes: ${x.episodes} on ${plural(x.days, 'day')}, ${x.occurrences} times, last ${day(x.last)}); ` +
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
  // The strongest co-edit pair from episodes, qualifying or not, to say what is missing.
  let nearest = null;
  for (const f of ctx.editedIn.keys()) {
    const count = new Map();
    for (const x of ctx.editedIn.get(f)) {
      for (const k of Object.keys(x.ep.e)) {
        if (+k === f) continue;
        const c = count.get(+k) || { n: 0, days: new Set() };
        c.n++;
        c.days.add(x.day);
        count.set(+k, c);
      }
    }
    for (const [g, c] of count) {
      const score = Math.min(c.n / T.coEditEpisodes, 1) + Math.min(c.days.size / T.minDays, 1);
      if (!nearest || score > nearest.score || (score === nearest.score && c.n > nearest.n)) nearest = { a: proj.files[f], b: proj.files[g], n: c.n, days: c.days.size, of: ctx.editedIn.get(f).length, score };
    }
  }
  for (const f of files) {
    for (const x of partners(proj, f, now)) {
      const k = [Math.min(f, x.f), Math.max(f, x.f)].join('|');
      // Raw counts: the dashboard words them in its own language. ev(x) is how the tools word them for Claude.
      if (!pairs.has(k)) pairs.set(k, { a: proj.files[f], b: proj.files[x.f], s: x.s ? { ...x.s, last: day(x.s.last) } : null, g: x.g ? { ...x.g, last: day(x.g.last) } : null, session: !!x.s, n: x.s?.n || x.g?.n || 0 });
    }
    for (const x of readFirst(proj, f, now)) reads.push({ file: proj.files[f], first: proj.files[x.f], n: x.n, days: x.days });
  }
  const hotspots = [...ctx.commitsOf].map(([f, cs]) => ({ file: proj.files[f], changes: cs.length, fixes: cs.filter((c) => c[3]).length }))
    .sort((a, b) => b.fixes - a.fixes || b.changes - a.changes).slice(0, 5);
  const coChange = [...pairs.values()].sort((a, b) => b.session - a.session || b.n - a.n);
  return {
    gate: ctx.gate,
    episodePairs: coChange.filter((p) => p.session).length,
    nearest: coChange.some((p) => p.session) ? null : nearest && { a: nearest.a, b: nearest.b, n: nearest.n, days: nearest.days, of: nearest.of },
    coChange: coChange.slice(0, 10),
    readFirst: reads.slice(0, 5),
    failures: failures(proj, now).slice(0, 5).map((x) => ({ ...x, last: day(x.last) })),
    hotspots,
  };
}

// Calls seen through the hooks, and how often a suggested file was then read or edited, against a baseline:
// how often a qualifying partner gets touched after an edit in episodes with no call. Correlation, not proof.
// Per tool, also the files read in the area a call was about (the areas of the files its answer cites; areaOf: a
// project path to its area, the project map's folders when built, else the file's folder) in the rest of its prompt
// turn, at most T.areaWindowMs, against comparable stretches without a call: the same window after a prompt turn with
// no call first reads a file in that area. A call is compared once T.minStretches such stretches exist (for its areas,
// else for the project).
export function measure(proj, now = Date.now(), areaOf = (p) => p.split('/').slice(0, -1).join('/') || '.') {
  index(proj);
  const ctx = context(proj, now);
  const calls = [];
  let opportunities = 0;
  let hits = 0;
  const partnerCache = new Map();
  const partnersOf = (f) => partnerCache.get(f) || partnerCache.set(f, partners(proj, f, now).map((x) => x.f)).get(f);
  const touches = new Map(); // session -> file -> every first-touch time across its episodes
  const touchesOf = (s) => {
    if (!touches.has(s)) {
      const m = new Map();
      for (const ep of s.eps) for (const src of [ep.r, ep.e]) for (const [k, t] of Object.entries(src)) (m.get(+k) || m.set(+k, []).get(+k)).push(t);
      touches.set(s, m);
    }
    return touches.get(s);
  };
  const followed = (s, f, t0) => {
    const ts = touchesOf(s).get(f) || [];
    return !ts.some((t) => t <= t0) && ts.some((t) => t > t0 && t - t0 <= T.followWindowMs);
  };
  for (const { ep, s } of ctx.all) {
    for (const [ts, tool, tokens, noData, files, ms] of ep.calls) {
      calls.push({ ts, tool, tokens, noData: !!noData, ms, suggested: files.map((f) => proj.files[f]), followed: files.length ? files.some((f) => followed(s, f, ts)) : null });
    }
    if (ep.calls.length || !isEpisode(ep)) continue;
    for (const [k, t0] of Object.entries(ep.e)) {
      const ps = partnersOf(+k);
      if (!ps.length) continue;
      opportunities++;
      if (ps.some((g) => { const t = Math.min(ep.r[g] ?? Infinity, ep.e[g] ?? Infinity); return t > t0 && t - t0 <= T.followWindowMs; })) hits++;
    }
  }
  // Reads in the area after a call, against stretches without one.
  const areaOfId = new Map(), area = (f) => areaOfId.get(f) ?? areaOfId.set(f, areaOf(proj.files[f])).get(f);
  const readIn = (ep, areas, from, incl) => Object.entries(ep.r).filter(([f, t]) => (incl ? t >= from : t > from) && t <= Math.min(from + T.areaWindowMs, ep.last) && areas.has(area(+f))).length;
  const stretches = new Map(); // area -> counts after first entering it, in prompt turns with no call
  for (const { ep } of ctx.all) {
    if (ep.calls.length) continue;
    const first = new Map();
    for (const [f, t] of Object.entries(ep.r)) { const a = area(+f); if (!first.has(a) || t < first.get(a)) first.set(a, t); }
    for (const [a, t1] of first) (stretches.get(a) || stretches.set(a, []).get(a)).push(readIn(ep, new Set([a]), t1, true));
  }
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
  const everyStretch = [...stretches.values()].flat();
  const byTool = new Map();
  for (const { ep } of ctx.all) {
    for (const [ts, tool, , noData, files] of ep.calls) {
      const t = byTool.get(tool) || byTool.set(tool, { tool, calls: 0, noData: 0, after: [], base: [], fewer: 0, compared: 0 }).get(tool);
      t.calls++; if (noData) t.noData++;
      if (!files.length) continue;
      const areas = new Set(files.map(area));
      const own = [...areas].flatMap((a) => stretches.get(a) || []);
      const base = own.length >= T.minStretches ? median(own) : everyStretch.length >= T.minStretches ? median(everyStretch) : null;
      const after = readIn(ep, areas, ts, false);
      t.after.push(after);
      if (base === null) continue;
      t.base.push(base); t.compared++;
      if (after < base) t.fewer++;
    }
  }
  const tools = [...byTool.values()].sort((a, b) => b.calls - a.calls).map(({ after, base, ...t }) => ({ ...t, withArea: after.length, readsAfter: median(after), readsWithout: median(base) }));
  calls.sort((a, b) => b.ts - a.ts);
  const withSuggestions = calls.filter((c) => c.followed !== null);
  const followedN = withSuggestions.filter((c) => c.followed).length;
  const rate = withSuggestions.length ? followedN / withSuggestions.length : null;
  const baseline = opportunities ? hits / opportunities : null;
  return {
    calls: calls.length,
    tokens: calls.reduce((n, c) => n + c.tokens, 0),
    noData: calls.filter((c) => c.noData).length,
    avgMs: calls.length ? Math.round(calls.reduce((n, c) => n + (c.ms || 0), 0) / calls.length) : 0,
    followRate: rate, followed: followedN, withSuggestions: withSuggestions.length,
    baseline, baselineSample: opportunities,
    verdict: calls.length < 50 ? 'collecting' : rate !== null && baseline !== null && rate <= baseline ? 'turn_off' : 'helping',
    tools, stretches: everyStretch.length,
    last: calls.slice(0, 20),
  };
}
