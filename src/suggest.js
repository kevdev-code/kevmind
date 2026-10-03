// Memory suggestions: short, copyable edits to what Claude reads at every session start (CLAUDE.md, the memory index
// and notes), each with its evidence. Built from facts only (the memory report's docs ↔ code checks, the project map,
// git, and KevMind's record of Claude Code sessions): no model, no tokens. KevMind never writes them; the user applies
// them, and the server then measures whether what each one targeted improved. This module only reads
// (test/suggest.test.mjs enforces it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tokensOf } from './memory.js';
import { failures, projectsUnder, sessionsOf } from './experience.js';
import { commitsOf, TREE } from './tree.js';

export const SUGGEST = {
  shown: 5,              // cards shown per project; the rest are folded
  maxChars: 160,         // an added line stays under this (about 40 tokens): CLAUDE.md loads in every session
  oversizedLines: 200,   // past this, CLAUDE.md gets no new line: the text becomes a memory note (one index line)
  readShare: 0.5,        // a file read without being edited in at least this share of the sessions with work...
  readSessions: 5,       // ...and at least this many of them...
  readDays: 3,           // ...on at least this many local days
  partnerCommits: 3,     // "usually changes with": committed together at least this many times...
  partnerShare: 0.5,     // ...and in at least this share of the file's commits
  verdictSessions: 5,    // a verdict on an applied suggestion waits for this many sessions (or episodes) after it...
  verdictDays: 3,        // ...on at least this many local days
  readDrop: 0.2,         // orientation reads: the share must drop by this much (absolute) to count as helped
  areaDrop: 0.2,         // a fix-prone area: files read before the first edit must drop by this share
};

// The Memory tab problems the suggestions replace (one list, not two).
export const COVERED = new Set(['cited_file_missing', 'possibly_moved', 'stale_name', 'missing_script', 'never_read', 'busy_area_no_notes']);
const RANK = { fix: 1, failure: 2, orient: 3, area: 4, history: 5, trim: 6 };
const FIX_CODES = new Set(['cited_file_missing', 'possibly_moved', 'stale_name', 'missing_script']);
// Files that change with everything: never named as a partner.
const NOISE_RE = /(^|\/)(package(-lock)?\.json|CHANGELOG\.md|README(\.\w+)?\.md|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.(json|lock)|pubspec\.(yaml|lock)|CLAUDE\.md)$/i;
const INSTRUCTIONS_RE = /(^|\/)CLAUDE(\.local)?\.md$/i;

const day = (ts) => new Date(ts).toLocaleDateString('en-CA'); // the local day
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const linesOf = (t) => t.split(/\r?\n/);
const idOf = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
const code = (s) => `\`${s}\``;
const base = (p) => p.split('/').pop();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

// What Claude reads of this project: its instruction files (not the user's or another project's), the memory index,
// the notes, Serena's notes; with their text.
export function projectDocs(report) {
  const own = (i) => !['user', 'managed', 'worktree'].includes(i.scope) && !i.ownedBy;
  return [
    ...report.instructions.filter(own).map((i) => ({ path: i.path, display: i.display, kind: 'instructions' })),
    ...(report.memory.index ? [{ path: path.join(report.memory.dir, 'MEMORY.md'), display: report.memory.index.display, kind: 'index' }] : []),
    ...report.memory.notes.map((n) => ({ path: n.path, display: n.display, kind: 'note' })),
    ...report.serena.notes.map((n) => ({ path: n.path, display: n.display, kind: 'serena' })),
  ].map((d) => ({ ...d, text: read(d.path) ?? '' }));
}
const mentions = (docs, token) => docs.some((d) => d.text.includes(token));

// Where a new line about a path goes: the nearest CLAUDE.md above it (one in a subfolder loads only when Claude works
// there), else the project's own, else a new one; a memory note when the line would take that file past its target.
function targeter(report) {
  const files = report.instructions.filter((i) => ['project', 'nested'].includes(i.scope) && /(^|\/)CLAUDE\.md$/.test(i.display))
    .map((i) => ({ i, dir: i.display === 'CLAUDE.md' ? '' : i.display.slice(0, -'CLAUDE.md'.length) }));
  return (rel = '') => {
    const hit = files.filter((f) => rel.startsWith(f.dir)).sort((a, b) => b.dir.length - a.dir.length)[0];
    if (!hit) return { kind: 'create', display: 'CLAUDE.md', dir: '', lines: [] };
    if (hit.i.lines + 1 > SUGGEST.oversizedLines) return { kind: 'note', display: report.memory.display, dir: '', lines: hit.i.lines, over: hit.i.display };
    return { kind: 'file', display: hit.i.display, dir: hit.dir, lines: linesOf(read(hit.i.path) ?? '') };
  };
}
// A path as the target file may write it: from the project root, or from the folder of a nested CLAUDE.md.
const forms = (t, p) => (t.dir && p.startsWith(t.dir) ? [p, p.slice(t.dir.length)] : [p]);
// An added line: after the last line that mentions the anchor (the file's folder, the area, the command), else at the
// end; as a memory note when CLAUDE.md is oversized (the note costs its index line at every start).
function addEdit(t, text, anchor, note) {
  if (t.kind === 'note') {
    const file = `${note.stem}.md`, index = `- [${note.title}](${file}) — ${note.hook}`;
    return { op: 'note', file: `${t.display}/${file}`, body: `---\nname: ${note.title}\ndescription: ${note.hook}\ntype: project\n---\n\n${text}\n`, index, indexFile: `${t.display}/MEMORY.md`, oversized: t.lines, over: t.over, tokens: tokensOf(`${index}\n`) };
  }
  let after = t.lines.length;
  const hit = anchor ? t.lines.findLastIndex((l) => forms(t, anchor).some((a) => l.includes(a))) : -1;
  if (hit >= 0) after = hit + 1;
  else while (after > 0 && !t.lines[after - 1].trim()) after--;
  return { op: 'add', file: t.display, after, text, create: t.kind === 'create', tokens: tokensOf(`${text}\n`) };
}

// The file committed most often with f (at least SUGGEST.partnerCommits times and in half its commits), or null.
function partnerOf(commits, f) {
  const mine = commits.filter((c) => c.files.length <= TREE.maxFilesPerCommit && c.files.includes(f));
  const n = new Map();
  for (const c of mine) for (const g of c.files) if (g !== f && !NOISE_RE.test(g)) n.set(g, (n.get(g) || 0) + 1);
  const [g, k] = [...n].sort((a, b) => b[1] - a[1])[0] || [];
  return g && k >= SUGGEST.partnerCommits && k / mine.length >= SUGGEST.partnerShare ? g : null;
}

// ---- A. wrong facts in what Claude reads (the docs ↔ code checks) ---------------------------------------------------
// The line is about the reference: a list item, table cell or heading that starts with it, or nothing but it (a
// command in a code block). Removing it then loses nothing else.
function aboutIt(line, token) {
  const t = line.replace(/^\s*(?:[-*+]|\d+[.)]|#+|\|)\s*/, '').replace(/^(\*\*|__)/, '').trim();
  return [token, code(token), `[${token}]`, `[${code(token)}]`].some((x) => t === x || t.startsWith(`${x} `) || t.startsWith(`${x}:`) || t.startsWith(`${x},`));
}
function fixes(report, root) {
  const owners = new Map([
    ...report.instructions.map((i) => [i.display, { path: i.path, kind: 'instructions' }]),
    ...report.memory.notes.map((n) => [n.display, { path: n.path, kind: 'note' }]),
    ...report.serena.notes.map((n) => [n.display, { path: n.path, kind: 'serena' }]),
  ]);
  const byLine = new Map();
  for (const p of report.problems) {
    if (!FIX_CODES.has(p.code)) continue;
    const owner = owners.get(p.file) || { path: path.resolve(root, p.file), kind: 'readme' };
    for (const it of p.params?.items || []) {
      for (const line of it.lines || []) {
        const k = `${p.file}|${line}`;
        if (!byLine.has(k)) byLine.set(k, { file: p.file, owner, line, items: [] });
        byLine.get(k).items.push({ code: p.code, token: it.path, to: it.to || [], date: it.date || null });
      }
    }
  }
  const out = [];
  for (const g of byLine.values()) {
    const old = linesOf(read(g.owner.path) ?? '')[g.line - 1];
    if (old == null) continue;
    // A moved path whose new place the line already names is mentioned on purpose ("then at x; moved to y").
    g.items = g.items.filter((x) => !(x.code === 'possibly_moved' && x.to.some((to) => old.includes(to))));
    if (!g.items.length) continue;
    const history = g.owner.kind === 'note' || g.owner.kind === 'serena';
    const moved = g.items.filter((x) => x.code === 'possibly_moved' && x.to.length === 1 && old.includes(x.token));
    let edit;
    if (moved.length === g.items.length) {
      let text = old;
      for (const x of moved) text = text.split(x.token).join(x.to[0]);
      edit = { op: 'replace', file: g.file, line: g.line, old, text, tokens: tokensOf(text) - tokensOf(old) };
    } else if (g.items.some((x) => aboutIt(old, x.token))) {
      edit = { op: 'remove', file: g.file, line: g.line, old, tokens: -tokensOf(`${old}\n`) };
    } else edit = { op: 'prompt', file: g.file, line: g.line, old, tokens: 0 };
    out.push({
      id: idOf('fix', g.file, old), kind: 'fix', rank: history ? RANK.history : RANK.fix, history, weight: g.items.length, edit,
      why: { code: 'fix', items: g.items.map(({ code: c, token, to, date }) => ({ code: c, token, to, date })) },
      fact: { gone: { path: g.owner.path, line: old } },
    });
  }
  return out;
}

// ---- B. repeated failures with a known fix ----------------------------------------------------------------------
function failureSuggestions(projs, docs, to, now) {
  const out = [];
  for (const { p, pre } of projs) {
    for (const f of failures(p, now)) {
      const fix = f.fix.kind === 'file' ? pre + f.fix.name : f.fix.name;
      if (mentions(docs, f.fam) && mentions(docs, fix)) continue; // already written down: measured if it was ours
      const how = f.fix.kind === 'cmd' ? `run ${code(fix)} first` : `fixed by editing ${code(fix)}`;
      const head = (s) => `- ${code(f.fam)} failing with "${s}"`, tail = `: ${how} (${f.fix.n} times).`;
      const room = SUGGEST.maxChars - (head('') + tail).length;
      const sig = f.sig.length > room ? `${f.sig.slice(0, Math.max(8, room - 1)).trimEnd()}…` : f.sig;
      const text = head(sig) + tail;
      out.push({
        id: idOf('failure', f.fam, f.sig), kind: 'failure', rank: RANK.failure, weight: f.episodes,
        edit: addEdit(to(pre), text, f.fam, { stem: `failure-${slug(f.fam)}`, title: `${f.fam} failure`, hook: `${f.fam} fails with "${sig}"; ${how.replace(/`/g, '')}` }),
        why: { code: 'failure', fam: f.fam, sig: f.sig, episodes: f.episodes, days: f.days, occurrences: f.occurrences, fix, fixKind: f.fix.kind, fixN: f.fix.n, last: day(f.last) },
        fact: { all: [f.fam, fix] }, metric: { kind: 'failure', fam: f.fam, sig: f.sig },
      });
    }
  }
  return out;
}

// ---- C. files Claude reads to find its way, every session -------------------------------------------------------
// A Read comes before every Edit in Claude Code, so only sessions that read a file and didn't edit it count.
function orientation(sessions) {
  const per = new Map();
  let total = 0;
  for (const s of sessions.values()) {
    const reads = new Set(), edits = new Set();
    for (const { ep, p, pre } of s.eps) {
      for (const f of Object.keys(ep.r)) reads.add(pre + p.files[+f]);
      for (const f of Object.keys(ep.e)) edits.add(pre + p.files[+f]);
    }
    if (!reads.size && !edits.size) continue;
    total++;
    for (const f of reads) {
      if (edits.has(f)) continue;
      const c = per.get(f) || per.set(f, { n: 0, days: new Set() }).get(f);
      c.n++;
      c.days.add(day(s.first));
    }
  }
  return { per, total };
}
function orientSuggestions(sessions, docs, to, tree, commits) {
  const { per, total } = orientation(sessions);
  const info = new Map((tree?.areas || []).flatMap((a) => a.files.map((x) => [x.f, x])));
  const out = [];
  for (const [f, c] of per) {
    if (c.n < SUGGEST.readSessions || c.n / total < SUGGEST.readShare || c.days.size < SUGGEST.readDays) continue;
    if (INSTRUCTIONS_RE.test(f) || forms(to(f), f).some((x) => mentions(docs, x))) continue;
    const names = info.get(f)?.names || [], partner = partnerOf(commits, f);
    const line = (k) => `- ${code(f)}: ${[names.length ? `exports ${names.slice(0, k).join(', ')}${names.length > k ? ', …' : ''}` : '', partner ? `changes with ${code(partner)}` : ''].filter(Boolean).join('; ')}.`;
    let k = Math.min(names.length, 6);
    while (k > 1 && line(k).length > SUGGEST.maxChars) k--;
    const text = names.length || partner ? line(k) : null;
    out.push({
      id: idOf('orient', f), kind: 'orient', rank: RANK.orient, weight: c.n,
      edit: text && line(k).length <= SUGGEST.maxChars
        ? addEdit(to(f), text, f.includes('/') ? `${f.split('/').slice(0, -1).join('/')}/` : null, { stem: `file-${slug(base(f))}`, title: base(f), hook: `what ${base(f)} holds` })
        : { op: 'prompt', file: to(f).display, tokens: 0 },
      why: { code: 'orient', file: f, n: c.n, of: total, days: c.days.size },
      fact: { any: forms(to(f), f) }, metric: { kind: 'orient', file: f },
    });
  }
  return out;
}

// ---- D. busy or fix-prone areas no note covers -------------------------------------------------------------------
function areaSuggestions(tree, to, commits) {
  if (!tree) return [];
  const window = tree.months === 'all' ? 'all of git history' : `${tree.months} months`;
  const out = [];
  for (const k of tree.gaps.quiet) {
    const a = tree.areas[k];
    const fragile = a.git.fixes >= TREE.fragile;
    const top = a.files.filter((x) => (fragile ? x.git?.fix : x.git?.n90)).sort((x, y) => (fragile ? y.git.fix - x.git.fix : y.git.n90 - x.git.n90)).slice(0, 2).map((x) => x.f);
    const label = a.name === '.' ? 'Top-level files' : code(`${a.name}/`);
    const head = fragile ? `- ${label} ${a.name === '.' ? 'are' : 'is'} fix-prone: ${a.git.fixes} fix commits in ${window}` : `- ${label} ${a.name === '.' ? 'change' : 'changes'} often: ${a.git.n90} commits in ${TREE.hotDays} days`;
    const partner = top[0] ? partnerOf(commits, top[0]) : null;
    const parts = [head, top.length ? `, mostly ${top.map((f) => code(base(f))).join(', ')}` : '',
      partner ? `; ${code(base(top[0]))} usually changes with ${code(a.name !== '.' && partner.startsWith(`${a.name}/`) ? base(partner) : partner)}` : ''];
    while (parts.length > 1 && `${parts.join('')}.`.length > SUGGEST.maxChars) parts.pop();
    const text = `${parts.join('')}.`;
    out.push({
      id: idOf('area', a.name), kind: 'area', rank: RANK.area, weight: fragile ? a.git.fixes : a.git.n90,
      edit: addEdit(to(a.name === '.' ? '' : `${a.name}/`), text, a.name === '.' ? null : a.name, { stem: `area-${slug(a.name.split('/').slice(-2).join('-'))}`, title: a.name === '.' ? 'Top-level files' : a.name, hook: fragile ? 'fix-prone area' : 'busy area' }),
      why: { code: 'area', area: a.name, files: a.files.length, n90: a.git.n90, fixes: a.git.fixes, months: tree.months, fragile, hotDays: TREE.hotDays },
      fact: { any: a.name === '.' ? [top[0] || '.'] : forms(to(`${a.name}/`), a.name) }, metric: { kind: 'area', files: a.files.map((x) => x.f) },
    });
  }
  return out;
}

// ---- E. lines that cost tokens and do nothing -------------------------------------------------------------------
function trims(report, tree) {
  const out = [];
  // Notes no session opened: their MEMORY.md line goes (the note itself costs nothing until it is read).
  const indexPath = report.memory.index ? path.join(report.memory.dir, 'MEMORY.md') : null;
  const index = indexPath ? linesOf(read(indexPath) ?? '') : [];
  for (const p of report.problems.filter((x) => x.code === 'never_read')) {
    const stem = base(p.file);
    const i = index.findIndex((l) => l.includes(`(${stem})`) || l.includes(`/${stem})`));
    if (i < 0) continue;
    out.push({
      id: idOf('never_read', p.file), kind: 'trim', rank: RANK.trim, weight: 1,
      edit: { op: 'remove', file: report.memory.index.display, line: i + 1, old: index[i], tokens: -tokensOf(`${index[i]}\n`) },
      why: { code: 'never_read', note: p.file, days: p.params.days },
      fact: { gone: { path: indexPath, line: index[i] } },
    });
  }
  // CLAUDE.md sections that cite only code nobody touched: no commit in TREE.dormantDays, no session in the window.
  const instructions = new Map(report.instructions.map((i) => [i.display, i.path]));
  for (const d of tree?.docs || []) {
    if (d.kind !== 'instructions' || !d.title || !d.cited.length) continue;
    const areas = d.cited.map((k) => tree.areas[k]);
    if (!areas.every((a) => a.git.dormant && !a.claude.read && !a.claude.edit)) continue;
    const file = instructions.get(d.file), lines = linesOf(read(file) ?? '');
    const from = lines.findIndex((l) => /^#{1,3}\s/.test(l) && l.replace(/^#{1,3}\s+/, '').replace(/\s*#*\s*$/, '') === d.title);
    if (from < 0) continue;
    const level = /^#+/.exec(lines[from])[0].length;
    let to = lines.findIndex((l, j) => j > from && /^#{1,6}\s/.test(l) && /^#+/.exec(l)[0].length <= level);
    if (to < 0) to = lines.length;
    while (to - 1 > from && !lines[to - 1].trim()) to--;
    const text = lines.slice(from, to).join('\n'), last = Math.max(0, ...areas.map((a) => a.git.last));
    out.push({
      id: idOf('dormant', d.file, d.title), kind: 'trim', rank: RANK.trim, weight: tokensOf(text),
      edit: { op: 'remove_range', file: d.file, from: from + 1, to, title: d.title, tokens: -tokensOf(`${text}\n`) },
      why: { code: 'dormant', section: d.title, areas: areas.map((a) => a.name), last: last ? day(last) : null, days: TREE.dormantDays },
      fact: { gone: { path: file, line: lines[from] } },
    });
  }
  return out;
}

// ---- prompts: the same edit, worded for Claude Code (always English, like the Memory tab's fix prompts) -------------
const REASON = {
  cited_file_missing: (x) => `${code(x.token)} exists nowhere in the project (working tree or default branch).`,
  possibly_moved: (x) => `${code(x.token)} is not there; a file with the same name is at ${x.to.map(code).join(' or ')}.`,
  stale_name: (x) => `no code file has ${code(x.token)} anymore${x.date ? ` (git: it was last in the code on ${x.date})` : ''}.`,
  missing_script: (x) => `no package.json in the project has the script in ${code(x.token)}.`,
};
function promptOf(s, root) {
  const e = s.edit, end = `\n\nChange nothing else. Project root: ${root.replace(/\\/g, '/')} (paths starting with ~ are in your home folder).`;
  switch (e.op) {
    case 'add': return `${e.create ? `Create ${e.file} with this line` : `In ${e.file}, add this line ${e.after ? `after line ${e.after}` : 'at the top'}`}:\n\n${e.text}${end}`;
    case 'replace': return `In ${e.file}, replace line ${e.line}:\n\n${e.old}\n\nwith:\n\n${e.text}${end}`;
    case 'remove': return `In ${e.file}, delete line ${e.line}:\n\n${e.old}${end}`;
    case 'remove_range': return `In ${e.file}, delete lines ${e.from}-${e.to}: the section "${e.title}".${end}`;
    case 'note': return `Create the memory note ${e.file} with exactly this content:\n\n${e.body}\nThen add this line to ${e.indexFile}:\n\n${e.index}${end}`;
    default:
      if (s.kind === 'orient') {
        return `Claude Code read ${code(s.why.file)} without editing it in ${s.why.n} of the last ${s.why.of} sessions of this project. Read it and suggest one line for ${e.file} ` +
          `(under ${SUGGEST.maxChars} characters) saying what it holds, so a session knows without opening it. Don't write it yet; show me the line.${end.replace('\n\nChange nothing else.', '')}`;
      }
      return `In ${e.file}, line ${e.line} says:\n\n${e.old}\n\nBut ${s.why.items.map((x) => REASON[x.code](x)).join(' And ')}\n` +
        `Check the current code. If the line describes how things are now, update it; if it tells history on purpose, leave it. Show me the change before saving it.${end.replace('\n\nChange nothing else.', '')}`;
  }
}

// Every suggestion for a project, best first. report: its memory report (with problems); tree: its project map;
// agg: the experience aggregate.
export function buildSuggestions({ root, report, tree = null, agg = null, now = Date.now() }) {
  const docs = projectDocs(report);
  const to = targeter(report);
  const projs = agg ? projectsUnder(agg, root) : [];
  const commits = tree ? commitsOf(tree.git) : [];
  const list = [
    ...fixes(report, root),
    ...failureSuggestions(projs, docs, to, now),
    ...orientSuggestions(sessionsOf(projs), docs, to, tree, commits),
    ...areaSuggestions(tree, to, commits),
    ...trims(report, tree),
  ];
  for (const s of list) s.prompt = promptOf(s, root);
  return list.sort((a, b) => a.rank - b.rank || b.weight - a.weight);
}

// ---- applied, and did it help ------------------------------------------------------------------------------------
// Applied: the stale line is gone (any change to it counts), or a doc now names what an added line names (the user
// may reword it).
export function isApplied(fact, docs) {
  if (fact?.gone) { const text = read(fact.gone.path); return text === null || !linesOf(text).includes(fact.gone.line); }
  if (fact?.all) return docs.some((d) => fact.all.every((x) => d.text.includes(x)));
  if (fact?.any) return fact.any.some((x) => mentions(docs, x));
  return false;
}

// What happened after a suggestion was applied, measured on the same kind of thing it targeted. Correlation, never
// proof. sessions: sessionsOf(projectsUnder(agg, root)).
export function outcome(rec, sessions, now = Date.now()) {
  const m = rec.metric, at = rec.appliedAt;
  if (!m) return { status: 'done', tokens: rec.edit?.tokens || 0 };
  const list = [...sessions.values()];
  const wait = (have, days) => (have < SUGGEST.verdictSessions || days < SUGGEST.verdictDays ? { status: 'waiting', have, need: SUGGEST.verdictSessions, days, needDays: SUGGEST.verdictDays } : null);
  if (m.kind === 'failure') {
    const runs = (s) => s.eps.flatMap(({ ep, p }) => ep.runs.filter((r) => p.fams[r[1]] === m.fam).map((r) => ({ ok: r[2], sig: r[3] >= 0 ? p.sigs[r[3]] : null })));
    const ran = list.map((s) => ({ s, r: runs(s) })).filter((x) => x.r.length);
    const after = ran.filter((x) => x.s.first >= at), before = ran.filter((x) => x.s.last < at);
    const hits = (xs) => xs.reduce((n, x) => n + x.r.filter((r) => !r.ok && r.sig === m.sig).length, 0);
    const counts = { before: hits(before), beforeSessions: before.length, after: hits(after), afterSessions: after.length };
    return { ...counts, ...(wait(after.length, new Set(after.map((x) => day(x.s.first))).size) || { status: counts.after === 0 ? 'helped' : 'no_change' }) };
  }
  if (m.kind === 'orient') {
    const share = (xs) => (xs.length ? xs.filter((s) => s.r.has(m.file) && !s.e.has(m.file)).length / xs.length : null);
    const work = list.map((s) => {
      const r = new Set(), e = new Set();
      for (const { ep, p, pre } of s.eps) { for (const f of Object.keys(ep.r)) r.add(pre + p.files[+f]); for (const f of Object.keys(ep.e)) e.add(pre + p.files[+f]); }
      return { first: s.first, last: s.last, r, e };
    }).filter((s) => s.r.size || s.e.size);
    const after = work.filter((s) => s.first >= at);
    const before = work.filter((s) => s.last < at).sort((a, b) => b.last - a.last).slice(0, Math.max(SUGGEST.verdictSessions, after.length));
    const counts = { before: share(before), beforeSessions: before.length, after: share(after), afterSessions: after.length };
    return { ...counts, ...(wait(after.length, new Set(after.map((s) => day(s.first))).size) || { status: counts.before !== null && counts.before - counts.after >= SUGGEST.readDrop ? 'helped' : 'no_change' }) };
  }
  // area: files read before the first edit in the area, per work episode that edits it (episodes of nested repos merged)
  const files = new Set(m.files), eps = new Map();
  for (const [sid, s] of sessions) {
    for (const { ep, p, pre } of s.eps) {
      const k = `${sid}|${ep.of ?? ep.start}`, x = eps.get(k) || eps.set(k, { start: ep.of ?? ep.start, r: [], e: [] }).get(k);
      for (const [f, ts] of Object.entries(ep.r)) x.r.push([pre + p.files[+f], ts]);
      for (const [f, ts] of Object.entries(ep.e)) x.e.push([pre + p.files[+f], ts]);
    }
  }
  const counts = [];
  for (const x of eps.values()) {
    const first = Math.min(...x.e.filter(([f]) => files.has(f)).map(([, ts]) => ts));
    if (first === Infinity) continue;
    counts.push({ start: x.start, n: new Set(x.r.filter(([, ts]) => ts < first).map(([f]) => f)).size });
  }
  const after = counts.filter((c) => c.start >= at), before = counts.filter((c) => c.start < at);
  const res = { before: median(before.map((c) => c.n)), beforeSessions: before.length, after: median(after.map((c) => c.n)), afterSessions: after.length };
  return { ...res, ...(wait(after.length, new Set(after.map((c) => day(c.start))).size) || { status: res.before && res.after <= res.before * (1 - SUGGEST.areaDrop) ? 'helped' : 'no_change' }) };
}

// An applied line that changed nothing after its window: suggest removing it (it costs tokens at every start).
export function retire(rec, result, docs, root) {
  if (result.status !== 'no_change' || !(rec.fact?.all || rec.fact?.any)) return null;
  const named = (l) => (rec.fact.all ? rec.fact.all.every((x) => l.includes(x)) : rec.fact.any.some((x) => l.includes(x)));
  for (const d of docs) {
    const lines = linesOf(d.text), i = lines.findIndex(named);
    if (i < 0) continue;
    const s = {
      id: idOf('retire', rec.id), kind: 'trim', rank: RANK.trim, weight: 1,
      edit: { op: 'remove', file: d.display, line: i + 1, old: lines[i], tokens: -tokensOf(`${lines[i]}\n`) },
      why: { code: 'no_change', of: rec.kind, before: result.before, after: result.after, sessions: result.afterSessions },
      fact: { gone: { path: d.path, line: lines[i] } },
    };
    s.prompt = promptOf(s, root);
    return s;
  }
  return null;
}
