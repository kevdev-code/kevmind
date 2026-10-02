// The session briefing: when a Claude Code session starts (startup, /clear, a compaction), a short note about the
// project for Claude, built only from facts KevMind already has: its record of past sessions (the experience
// aggregate and the live session state), the memory report, and read-only git (`log`, `status --porcelain`). Nothing
// is invented, nothing is written to the project, CLAUDE.md or memory. Off by default (config.json `briefing`,
// `kevmind briefing on|off`, the Memory tab). This module only reads: the server records each start in
// briefings.jsonl.
//
// Every start is measured: half of them get the briefing and half don't (by a hash of the session and the start), and
// both are compared on what happened next, tokens included (from the session's transcript), so the Experience panel
// can say whether showing it saves anything. While the code map is on (with the experience tools), the shown half gets
// v2: the same briefing plus lines from the code map. With it off, the shown half gets v1.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { keyOf } from './memory.js';
import { relPath, failures, partners, isShellError } from './experience.js';
import { fileIndex, areaLinks, keyFiles } from './codemap.js';

// Every limit in one place.
export const BRIEF = {
  maxChars: 1500,            // about 350 tokens; past this, the lowest lines go
  leftOffDays: 7,            // "where the last session left off" only when it was this recent
  replyChars: 120,           // the last reply, quoted at most this long
  maxFiles: 5,               // files named per line
  maxFailures: 2, maxTogether: 2, maxNotes: 3, maxStale: 2,
  budgetMs: 1200,            // the hook waits 1.5 s: past this nothing is sent (and the start is not measured)
  promptMs: 10 * 60_000,     // a start counts when a prompt follows within this
  settleMs: 30 * 60_000,     // a start's stretch closes when its session has been quiet this long...
  maxStretchMs: 8 * 3600_000, // ...or this long after it began, or at the session's next start
  firstReads: 30,            // re-reads: of the first this many files read
  minPerArm: 20,             // the verdict waits for this many measured starts on each side
  clearChange: 0.1,          // a difference counts from 10% of the median
};

const GIT_BRIEF = new Set(['log', 'status']); // read-only, approved for the briefing
function gitRead(cwd, args) {
  if (!GIT_BRIEF.has(args[0])) throw new Error(`git ${args[0]} is not allowed here`);
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 800, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : String(out)));
  });
}

// Which arm a start falls in, half and half: a hash of the session and how many starts it had before this one.
// 'withheld' against 'shown' (v1) or, with the code map on, against 'map' (v2: v1's lines plus the code map's).
export const ARMS = { v1: ['withheld', 'shown'], v2: ['withheld', 'map'] };
export function armOf(sid, n = 0, arms = ARMS.v1) {
  return arms[crypto.createHash('sha1').update(`${sid}|${n}`).digest()[0] % arms.length];
}

const when = (ts) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
const code = (p) => `\`${p}\``;
const list = (xs) => xs.map(code).join(', ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---- facts ---------------------------------------------------------------------------------------------------
// The aggregate's projects for a session's project: its root and any git repo nested in it (frontend/, backend/),
// each with the prefix that turns its paths into the root's.
export function projectsUnder(agg, root) {
  return Object.values(agg.projects)
    .filter((p) => keyOf(p.root) === keyOf(root) || relPath(root, p.root))
    .map((p) => ({ p, pre: keyOf(p.root) === keyOf(root) ? '' : `${relPath(root, p.root)}/` }));
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
const fileName = (x, f) => x.pre + x.p.files[f];

// A failed command that only said "Exit code 1" answered a question (git check-ignore, a test -f), and a shell syntax
// mistake in the command itself is not the project failing: neither counts as a failure.
const silent = (sig) => /^exit 1: $/.test(sig || '') || isShellError(sig);
// "Still failing" is about builds, tests and scripts: commands run by a runner. A shell chain that ended in a grep
// with no match, or a git probe, is not.
const RUNNER_RE = /^(npm|pnpm|yarn|bun|bunx|npx|node|deno|tsx|tsc|vitest|jest|eslint|python3?|py|pytest|pip|uv|ruff|mypy|cargo|go|make|cmake|dotnet|mvn|gradle|php|composer|artisan|docker|flutter|dart|swift|xcodebuild)\b/;

// Everything the briefing may say, from the records. live: the server's session state (agents, replies) for sessions
// of the last 24 h; report: the memory report when it is at hand (else no notes); git(repo, args): read-only git;
// map: the project's code map, for v2 only (else no map lines).
export async function gatherFacts({ agg, root, name, sid, source, now = Date.now(), live = null, report = null, toolsOn = false, git = gitRead, map = null }) {
  const projs = projectsUnder(agg, root);
  const sessions = sessionsOf(projs);
  const facts = { name, now, source, last: null, git: [], failures: [], rereads: [], together: [], notes: [], stale: [], toolsOn, items: [] };
  const recent = new Set();
  // Where the last session with edits left off (this one too after /clear or a compaction).
  let last = null;
  for (const [id, s] of sessions) {
    if ((source === 'startup' && id === sid) || now - s.last > BRIEF.leftOffDays * 86_400_000) continue;
    if (s.eps.some(({ ep }) => ep.ed.length) && (!last || s.last > last.s.last)) last = { id, s };
  }
  if (last) {
    const turns = new Map(); // a prompt turn's episodes, across repos (mirrored ones share `of`)
    for (const x of last.s.eps) if (x.ep.ed.length) { const k = x.ep.of ?? x.ep.start; (turns.get(k) || turns.set(k, []).get(k)).push(x); }
    const turn = [...turns.values()].sort((a, b) => Math.max(...b.map((x) => x.ep.last)) - Math.max(...a.map((x) => x.ep.last)))[0];
    const turnStart = Math.min(...turn.map((x) => x.ep.start));
    // The files it edited last (across the session), and the commands of its final turn that never succeeded after.
    const edits = last.s.eps.flatMap((x) => x.ep.ed.map(([ts, f]) => [ts, fileName(x, f)])).sort((a, b) => b[0] - a[0]);
    const edited = [...new Set(edits.map((e) => e[1]))].slice(0, BRIEF.maxFiles);
    const runs = last.s.eps.flatMap((x) => x.ep.runs.map(([ts, fam, ok, sig]) => ({ ts, fam: x.p.fams[fam], ok, sig: sig >= 0 ? x.p.sigs[sig] : '' }))).filter((r) => r.ts >= turnStart).sort((a, b) => a.ts - b.ts);
    // Only commands the project runs regularly (also run in another session): a one-off script that was dropped is not news.
    const regular = new Set([...sessions].filter(([id]) => id !== last.id).flatMap(([, s]) => s.eps.flatMap((x) => x.ep.runs.map((q) => x.p.fams[q[1]]))));
    const failing = new Map();
    runs.forEach((r, i) => { if (!r.ok && !silent(r.sig) && RUNNER_RE.test(r.fam) && regular.has(r.fam) && !runs.slice(i + 1).some((q) => q.fam === r.fam && q.ok)) failing.set(r.fam, r); });
    const ls = live?.get(last.id);
    // Subagents launched in its final turn and never seen ending (older rows of a long session are not reliable).
    const agents = ls ? [...new Set(Object.values(ls.agents))].filter((a) => a.startedAt >= turnStart) : [];
    const reply = ls ? [...ls.events].reverse().find((e) => e.kind === 'says' && e.actor === 'main')?.detail || '' : '';
    facts.last = {
      first: last.s.first, last: last.s.last, edited,
      failing: [...failing.values()].slice(-BRIEF.maxFailures),
      running: [...new Set(agents.filter((a) => a.id !== 'main' && (a.status === 'running' || a.status === 'working')).map((a) => a.type))],
      waiting: ls?.status === 'waiting',
      reply: reply.length > BRIEF.replyChars ? `${reply.slice(0, BRIEF.replyChars - 1).trimEnd()}…` : reply,
    };
    for (const f of edited) recent.add(f);
  }
  // git, in the project and each repo nested in it: the last commit and what is not committed.
  const repos = [{ dir: root, label: '' }, ...projs.filter((x) => x.pre).map((x) => ({ dir: x.p.root, label: x.pre.replace(/\/$/, '') }))];
  facts.git = (await Promise.all(repos.map(async (r) => {
    const [head, status] = await Promise.all([git(r.dir, ['log', '-1', '--format=%h%x09%ct%x09%s']), git(r.dir, ['status', '--porcelain'])]);
    if (head == null) return null;
    const [hash, ct, ...subject] = head.trim().split('\t');
    const dirty = (status || '').split('\n').filter(Boolean).map((l) => (r.label ? `${r.label}/` : '') + l.slice(3).replace(/^"|"$/g, ''));
    return hash ? { label: r.label, hash, ts: Number(ct) * 1000, subject: subject.join('\t').slice(0, 80), dirty } : null;
  }))).filter(Boolean);
  // Known failures (the experience tools' thresholds) and files read in each of the last three sessions.
  for (const x of projs) for (const f of failures(x.p, now)) facts.failures.push({ ...f, fix: f.fix.kind === 'file' ? { ...f.fix, name: x.pre + f.fix.name } : f.fix });
  facts.failures = facts.failures.sort((a, b) => b.last - a.last).slice(0, BRIEF.maxFailures);
  const withReads = [...sessions].filter(([id, s]) => !(source === 'startup' && id === sid) && s.eps.some(({ ep }) => Object.keys(ep.r).length)).sort((a, b) => b[1].last - a[1].last).slice(0, 3);
  if (withReads.length === 3) {
    const sets = withReads.map(([, s]) => new Set(s.eps.flatMap((x) => Object.keys(x.ep.r).map((f) => fileName(x, +f)))));
    facts.rereads = [...sets[0]].filter((f) => sets[1].has(f) && sets[2].has(f) && !recent.has(f)).slice(0, BRIEF.maxFiles);
    for (const f of facts.rereads) recent.add(f);
  }
  // What usually changes with the files last edited (episodes or git, at the tools' thresholds).
  if (facts.last) {
    const seen = new Set(facts.last.edited);
    for (const f of facts.last.edited) {
      const x = projs.find((y) => f.startsWith(y.pre) && y.p._fi?.has(f.slice(y.pre.length)));
      if (!x) continue;
      const g = partners(x.p, x.p._fi.get(f.slice(x.pre.length)), now)[0];
      if (!g || seen.has(x.pre + x.p.files[g.f])) continue;
      seen.add(x.pre + x.p.files[g.f]);
      facts.together.push({ a: f, b: x.pre + x.p.files[g.f], how: [g.s && `${plural(g.s.n, 'work episode')} on ${plural(g.s.days, 'day')}`, g.g && `git: ${g.g.n} of ${g.g.of} commits`].filter(Boolean).join('; ') });
      if (facts.together.length >= BRIEF.maxTogether) break;
    }
  }
  // Notes that cite those files, and notes whose cited paths are gone near them.
  if (report) {
    const notes = [...(report.memory?.notes || []), ...(report.serena?.notes || [])];
    const near = (p) => [...recent].some((f) => f.split('/').slice(0, 2).join('/') === String(p).split('/').slice(0, 2).join('/'));
    facts.notes = notes.filter((n) => (n.cites || []).some((c) => recent.has(c.path))).slice(0, BRIEF.maxNotes).map((n) => ({ name: noteName(n.path), cites: n.cites.filter((c) => recent.has(c.path)).map((c) => c.path) }));
    facts.stale = (report.problems || []).filter((pr) => (pr.code === 'cited_file_missing' || pr.code === 'possibly_moved') && /[\\/]memory[\\/]|\.serena/.test(pr.file || '') && (pr.params?.items || []).some((it) => near(it.path)))
      .slice(0, BRIEF.maxStale).map((pr) => ({ note: noteName(pr.file), path: pr.params.items[0].path, moved: pr.code === 'possibly_moved' }));
  }
  if (map) facts.map = mapFacts(map, facts, report);
  return facts;
}

// v2: the area the last edits fall in (most of them), what it leans on and who leans on it; the most depended-on
// files; and notes that name code no code file has anymore (the Memory tab's stale names).
function mapFacts(map, facts, report) {
  const counts = new Map();
  for (const f of facts.last?.edited || []) {
    const a = map.areaOf.get(fileIndex(map, f));
    if (a != null) counts.set(a, (counts.get(a) || 0) + 1);
  }
  const k = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
  let area = null;
  if (k != null) {
    const a = map.areas[k], l = areaLinks(map, k);
    area = { name: a.name, files: a.files.length, core: a.top.slice(0, 2).map((i) => map.files[i]), dependsOn: l.dependsOn.slice(0, 2).map(([o]) => map.areas[o].name), usedBy: l.usedBy.slice(0, 2).map(([o]) => map.areas[o].name), others: counts.size - 1 };
  }
  const { key, hubs } = keyFiles(map);
  const stale = (report?.problems || []).filter((pr) => pr.code === 'stale_name').slice(0, BRIEF.maxStale)
    .map((pr) => ({ note: noteName(pr.file), names: pr.params.items.map((it) => it.path).slice(0, 3), date: pr.params.items[0].date }));
  return { area, key: key.filter((i) => map.importers[i].size).map((i) => ({ file: map.files[i], by: map.importers[i].size })), hubs: hubs.map((i) => ({ file: map.files[i], by: map.importers[i].size })), stale };
}
const noteName = (p) => { const parts = String(p).split(/[\\/]/); return parts.slice(-2).join('/'); };

// ---- the text ------------------------------------------------------------------------------------------------
// Facts as plain statements, never instructions (Claude Code's guidance for injected context). Each line has a rank
// (RANK, lower first) and is shown in that order. Past maxChars the lowest-ranked lines go, whole, one at a time;
// the line naming the tools always stays, last. Returns { text, items }: items are the files and commands the shown
// lines name, for the measurement (what was then opened).
const RANK = { leftOff: 10, git: 20, failure: 30, area: 35, rereads: 40, together: 50, notes: 60, keyFiles: 65, staleNote: 70, staleName: 80 };
export function briefingText(f) {
  const lines = []; // { rank, text, items }
  const add = (rank, build) => { const items = []; const name = (xs) => { for (const x of xs) items.push(`file:${x}`); return list(xs); }; const text = build(name, items); lines.push({ rank, text, items }); };
  if (f.last) {
    add(RANK.leftOff, (name, items) => {
      const l = f.last, parts = [`Last session with edits: ${when(l.first)} to ${when(l.last)}.`];
      if (l.edited.length) parts.push(`Its last edits: ${name(l.edited)}.`);
      if (l.failing.length) { parts.push(`Still failing when it stopped: ${l.failing.map((r) => `${code(r.fam)} ("${r.sig}")`).join(', ')}.`); for (const r of l.failing) items.push(`cmd:${r.fam}`); }
      if (l.running.length) parts.push(`Subagents left running: ${l.running.join(', ')}.`);
      if (l.waiting) parts.push('It ended waiting for the user\'s OK.');
      if (l.reply) parts.push(`Its last reply: "${l.reply}"`);
      return parts.join(' ');
    });
  }
  for (const g of f.git) {
    add(RANK.git, (name) => {
      const dirty = g.dirty.length ? `${plural(g.dirty.length, 'uncommitted file')}: ${name(g.dirty.slice(0, BRIEF.maxFiles))}${g.dirty.length > BRIEF.maxFiles ? ', …' : ''}.` : 'nothing uncommitted.';
      return `${g.label ? `git (${g.label})` : 'git'}: last commit ${g.hash} on ${when(g.ts)}, "${g.subject}"; ${dirty}`;
    });
  }
  for (const x of f.failures) {
    add(RANK.failure, (name, items) => {
      items.push(`cmd:${x.fam}`);
      return `Known failure: ${code(x.fam)} failed with "${x.sig}" in ${plural(x.episodes, 'work episode')} on ${plural(x.days, 'day')}; ${x.fix.n} times the next success came after ${x.fix.kind === 'file' ? `editing ${name([x.fix.name])}` : `running ${code(x.fix.name)}`}.`;
    });
  }
  if (f.rereads.length) add(RANK.rereads, (name) => `Read in each of the last 3 sessions: ${name(f.rereads)}.`);
  for (const t of f.together) add(RANK.together, (name) => `${code(t.a)} usually changes with ${name([t.b])} (${t.how}).`);
  if (f.notes.length) add(RANK.notes, () => `Notes that cite these files: ${f.notes.map((n) => code(n.name)).join(', ')}.`);
  for (const s of f.stale) add(RANK.staleNote, () => `${code(s.note)} cites ${code(s.path)}, which ${s.moved ? 'seems to have moved' : 'is not in the working tree'}.`);
  // v2 only: the code map's lines, ranked among v1's.
  if (f.map) {
    const { area: a, key, hubs, stale } = f.map;
    if (a) {
      const links = [a.dependsOn.length && `uses ${a.dependsOn.join(', ')}`, a.usedBy.length && `is used by ${a.usedBy.join(', ')}`].filter(Boolean);
      add(RANK.area, (name) => `Code map (from imports and exports, approximate): the last edits are in the ${a.name} area (${plural(a.files, 'file')}; core ${name(a.core)})${links.length ? `, which ${links.join(' and ')}` : ''}.${a.others ? ` They also touch ${plural(a.others, 'other area')}.` : ''}`);
    }
    if (key.length) add(RANK.keyFiles, (name) => `Most depended-on files: ${key.map((k) => `${name([k.file])} (imported by ${k.by})`).join(', ')}${hubs.length ? `; shared by most of the code: ${hubs.map((h) => `${code(h.file.split('/').pop())} (${h.by})`).join(', ')}` : ''}.`);
    for (const s of stale) add(RANK.staleName, () => `${code(s.note)} names ${list(s.names)}, which no code file has anymore (git: last in the code on ${s.date}).`);
  }
  if (!lines.length) return { text: '', items: [] };
  const kept = lines.map((l, i) => ({ ...l, i })).sort((x, y) => x.rank - y.rank || x.i - y.i);
  const tools = f.toolsOn ? `KevMind's file_context, file_history${f.map ? ', known_failures and code_map' : ' and known_failures'} tools answer questions like these on demand.` : null;
  const head = `KevMind's record of ${f.name}, from its past Claude Code sessions and git (${when(f.now)}):`;
  const render = () => [head, ...kept.map((l) => `- ${l.text}`), ...(tools ? [`- ${tools}`] : [])].join('\n');
  while (kept.length > 1 && render().length > BRIEF.maxChars) kept.pop();
  if (render().length > BRIEF.maxChars) return { text: '', items: [] }; // ponytail: one line longer than the budget on its own; never seen, cut it if it ever is
  return { text: render(), items: [...new Set(kept.flatMap((l) => l.items))] };
}

// ---- the measurement -------------------------------------------------------------------------------------------
// One start's stretch [t0, t1): what happened after the briefing was shown or withheld. eps: the session's episodes
// across the project's repos ({ ep, p, pre }); prevReads: files the project's previous session read; known: failures
// ("family|signature") seen before t0; usage: the session's API calls [ts, input, output, cacheRead]; items: what the
// briefing named. Returns null when no prompt came within promptMs (nothing was asked: not a measured start).
export function measureStretch({ t0, t1, eps, prevReads = new Set(), known = new Set(), usage = null, items = [] }) {
  const inside = (ts) => ts >= t0 && ts < t1;
  const starts = eps.map((x) => x.ep.start).filter(inside).sort((a, b) => a - b);
  const prompt = starts[0];
  if (prompt == null || prompt - t0 > BRIEF.promptMs) return null;
  const edits = eps.flatMap((x) => Object.values(x.ep.e)).filter((ts) => ts >= prompt && ts < t1);
  const edit = edits.length ? Math.min(...edits) : null;
  const reads = eps.flatMap((x) => Object.entries(x.ep.r).map(([f, ts]) => [ts, x.pre + x.p.files[+f]])).filter(([ts]) => inside(ts)).sort((a, b) => a[0] - b[0]);
  const runs = eps.flatMap((x) => x.ep.runs.map(([ts, fam, ok, sig]) => ({ ts, fam: x.p.fams[fam], ok, sig: sig >= 0 ? x.p.sigs[sig] : '' }))).filter((r) => inside(r.ts));
  const failed = runs.filter((r) => !r.ok && !silent(r.sig));
  const first = reads.slice(0, BRIEF.firstReads);
  const sum = (to) => (usage ? usage.filter(([ts]) => ts >= t0 && ts < to).reduce((n, u) => n + u[1] + u[2] + u[3], 0) : null);
  const named = items.filter((i) => i.startsWith('file:')).map((i) => i.slice(5));
  const opened = new Set(reads.map((r) => r[1]).concat(eps.flatMap((x) => Object.entries(x.ep.e).filter(([, ts]) => inside(ts)).map(([f]) => x.pre + x.p.files[+f]))));
  return {
    prompt, edit,
    minutesToEdit: edit == null ? null : +((edit - prompt) / 60_000).toFixed(1),
    stepsToEdit: edit == null ? null : reads.filter(([ts]) => ts < edit).length + runs.filter((r) => r.ts < edit).length,
    rereadShare: first.length ? +(first.filter(([, f]) => prevReads.has(f)).length / first.length).toFixed(2) : null,
    failures: failed.length,
    repeated: failed.filter((r) => known.has(`${r.fam}|${r.sig}`)).length,
    tokens: sum(t1),
    tokensToEdit: edit == null ? null : sum(edit),
    followed: named.length ? +(named.filter((f) => opened.has(f)).length / named.length).toFixed(2) : null,
  };
}

const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null; };

// The Experience panel's comparison: per arm, the measured starts and their medians; each shown arm (v1 'shown',
// v2 'map') gets its own verdict against the withheld starts, about tokens (until the first edit, and for the whole
// stretch).
export function compare(results) {
  const arm = (a) => {
    const rs = results.filter((r) => r.arm === a && r.m);
    return {
      n: rs.length,
      tokens: median(rs.map((r) => r.m.tokens)), tokensToEdit: median(rs.map((r) => r.m.tokensToEdit)),
      minutesToEdit: median(rs.map((r) => r.m.minutesToEdit)), stepsToEdit: median(rs.map((r) => r.m.stepsToEdit)),
      rereadShare: median(rs.map((r) => r.m.rereadShare)), repeated: mean(rs.map((r) => r.m.repeated)), failures: mean(rs.map((r) => r.m.failures)),
      followed: median(rs.map((r) => r.m.followed)), chars: median(rs.map((r) => r.chars)),
    };
  };
  const shown = arm('shown'), withheld = arm('withheld'), map = arm('map');
  const against = (s) => {
    const change = (k) => (s[k] == null || !withheld[k] ? null : +((s[k] - withheld[k]) / withheld[k]).toFixed(2));
    const tokens = { toEdit: change('tokensToEdit'), total: change('tokens') };
    let verdict = 'collecting';
    if (s.n >= BRIEF.minPerArm && withheld.n >= BRIEF.minPerArm) {
      const c = BRIEF.clearChange, both = [tokens.toEdit, tokens.total];
      verdict = both.every((x) => x != null && x <= -c) ? 'saves' : both.every((x) => x != null && x >= c) ? 'costs' : 'unclear';
    }
    return { tokens, verdict };
  };
  const v1 = against(shown), v2 = against(map);
  return { shown, withheld, map, tokens: v1.tokens, verdict: v1.verdict, mapTokens: v2.tokens, mapVerdict: v2.verdict, minPerArm: BRIEF.minPerArm };
}

