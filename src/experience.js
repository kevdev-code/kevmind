// KevMind's "work experience": what Claude Code did in a project (from KevMind's own event log) and what the
// project's git history shows, aggregated for the memory suggestions, the project map and the Brain. History only:
// no code parsing, no symbols, no indexing. Read-only: test/experience-readonly.test.mjs fails if this module could
// write anything or run git with anything but `log`. The dashboard server is what persists the aggregate (experience.json).
//
// The unit of session evidence is the work episode, not the session, because one long session can hold days of
// work: a user prompt turn that ends with at least one edit, or, in a session without prompts, a block of activity
// separated from the next by more than 30 minutes. Compactions and system-injected prompts don't start one.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { projectRoot, keyOf } from './memory.js';

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
// not a failure of the project: never a known failure.
const SHELL_ERROR_RE = /unexpected EOF while looking for matching|syntax error near unexpected token|syntax error: unexpected end of file|unterminated quoted string|unmatched ['"`]|bad substitution|command not found/i;
export const isShellError = (sig) => SHELL_ERROR_RE.test(String(sig || ''));
const FIX_RE = /\b(fix(e[sd])?|bug|hotfix|revert|arregl\w*|correg\w*|corrig\w*)\b/i;
const GIT_READ = new Set(['log']);

// The machine's local calendar day, for display and for counting distinct days: an evening that crosses midnight
// UTC is still one day of work. Timestamps are stored as they are.
const pad2 = (n) => String(n).padStart(2, '0');
const day = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
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
//   of?: start of the session-project episode it mirrors }
// An episode without edits is kept (for its reads) but never counted as evidence.

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

const newEpisode = (ts) => ({ start: ts, last: ts, r: {}, e: {}, ed: [], rc: {}, ec: {}, ag: {}, runs: [] });
const hasActivity = (ep) => ep.ed.length || ep.runs.length || Object.keys(ep.r).length;

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

// ---- a project and the repos nested in it ------------------------------------------------------------------
// The aggregate's projects for a session's project: its root and any git repo nested in it (frontend/, backend/),
// each with the prefix that turns its paths into the root's.
export function projectsUnder(agg, root) {
  return Object.values(agg.projects)
    .filter((p) => keyOf(p.root) === keyOf(root) || relPath(root, p.root))
    .map((p) => ({ p: index(p), pre: keyOf(p.root) === keyOf(root) ? '' : `${relPath(root, p.root)}/` }));
}
// Sessions of the project across those repos: id -> { first, last, eps: [{ ep, p, pre }] }.
export function sessionsOf(projs) {
  const out = new Map();
  for (const { p, pre } of projs) {
    for (const [sid, s] of Object.entries(p.sessions)) {
      const x = out.get(sid) || { first: s.first, last: s.last, eps: [] };
      x.first = Math.min(x.first, s.first);
      x.last = Math.max(x.last, s.last);
      for (const ep of s.eps) x.eps.push({ ep, p, pre });
      out.set(sid, x);
    }
  }
  return out;
}
