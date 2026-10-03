// The knowledge tree: a project's baseline, so KevMind is useful before it has recorded any session. Project → areas
// (folders, from the code map) → files → exported names, and every fact carries its source: `code` (import and export
// statements), `git` (the history, 12 months by default) or `claude` (KevMind's record of Claude Code sessions). The
// user's memory (auto-memory notes, CLAUDE.md sections, Serena notes) is linked to the areas it talks about; KevMind
// organizes it and never writes or edits a note. No model, no tokens. This module only reads: git only `log`, through
// one guarded helper (test/tree.test.mjs); the dashboard server writes the result to ~/.kevmind/tree/.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileIndex, areaLinks, keyFiles } from './codemap.js';
import { failures } from './experience.js';
import { projectsUnder } from './briefing.js';

export const TREE = {
  months: 12,            // git history read by default ('all' on demand)
  hotDays: 90,           // "busy": commits in this many days...
  busy: 5,               // ...at least this many (an area), or...
  fragile: 5,            // ...at least this many commits labeled fix (an area)
  dormantDays: 180,      // no commit in this long: dormant
  manyNotes: 4,          // this many files (notes, instruction files) about one area: worth checking that they agree
  commonWord: 0.2,       // a folder name found in more than this share of the docs links none of them
  maxListed: 3,          // gap checks list at most this many areas each
  maxFilesPerCommit: 30, // a commit touching more (a format, a rename) says nothing about any one file
  refreshMs: 10 * 60_000, // an incremental refresh at most this often per project
};
const DAY = 86_400_000;
const FIX_RE = /\b(fix|fixes|fixed|bug|bugfix|hotfix|revert)\b|^fix(\(|:|!)/i;
const REVERT_RE = /^Revert "/;
// Folder names too common to say what a note is about.
const GENERIC = new Set(('src lib app apps components component ui service services api hooks hook types type utils util index test tests ' +
  '__tests__ spec specs frontend backend client server web mobile feature features module modules pages page modals modal routes route ' +
  'config configs common shared public core db schema schemas store stores controllers controller middleware helpers helper models model ' +
  'views view widgets widget screens screen assets styles style scripts docs data main base lang locales i18n bin dist build').split(' '));

const GIT_TREE = new Set(['log']);
function gitRead(cwd, args) {
  if (!GIT_TREE.has(args[0])) throw new Error(`git ${args[0]} is not allowed here`);
  return new Promise((resolve) => execFile('git', args, { cwd, timeout: 20_000, windowsHide: true, maxBuffer: 128 << 20 }, (err, out) => resolve(err ? null : String(out))));
}
const FORMAT = '--format=%x1e%H%x1f%ct%x1f%s';
function parseLog(out, pre) {
  const commits = [];
  for (const rec of out.split('\x1e')) {
    const [head, ...rest] = rec.split('\n');
    if (!head.trim()) continue;
    const [hash, ct, subject = ''] = head.split('\x1f');
    commits.push({ hash, ts: Number(ct) * 1000, subject, fix: FIX_RE.test(subject), revert: REVERT_RE.test(subject), files: rest.map((l) => l.trim()).filter(Boolean).map((f) => pre + f) });
  }
  return commits;
}
const since = (months, now) => Math.floor((now - months * 30.44 * DAY) / 1000);

// Each repo's commits in the window: only the new ones when the previous tree read the same window (`<head>..HEAD`),
// all of them when it didn't or when that range no longer exists (history rewritten).
async function readGit(root, repoDirs, prev, months, now) {
  const old = prev && prev.months === months ? decode(prev.git) : [];
  const repos = {}, commits = [];
  for (const dir of repoDirs) {
    const rel = path.relative(root, dir).split(path.sep).join('/'), pre = rel ? `${rel}/` : '';
    const head = prev && prev.months === months ? prev.repos?.[rel]?.head : null;
    let out = head ? await gitRead(dir, ['log', '--no-merges', '--name-only', FORMAT, `${head}..HEAD`]) : null;
    const full = out === null;
    if (full) out = await gitRead(dir, ['log', '--no-merges', '--name-only', FORMAT, ...(months === 'all' ? [] : [`--since=${since(months, now)}`])]);
    const fresh = out === null ? [] : parseLog(out, pre);
    const kept = full ? [] : old.filter((c) => c.repo === rel);
    repos[rel] = { head: fresh[0]?.hash || head || null };
    commits.push(...fresh.map((c) => ({ ...c, repo: rel })), ...kept);
  }
  const cut = months === 'all' ? 0 : since(months, now) * 1000;
  return { repos, commits: commits.filter((c) => c.ts >= cut).sort((a, b) => b.ts - a.ts) };
}
// Commits are stored compactly: [hash (12 chars), ts, flags (1 fix, 2 revert), repo, [file ids], subject (reverts
// only)], with one table of paths.
function encode(commits) {
  const files = [], id = new Map();
  const of = (f) => { if (!id.has(f)) { id.set(f, files.length); files.push(f); } return id.get(f); };
  return { files, commits: commits.map((c) => [c.hash.slice(0, 12), c.ts, (c.fix ? 1 : 0) | (c.revert ? 2 : 0), c.repo, c.files.map(of), ...(c.revert ? [c.subject.slice(0, 80)] : [])]) };
}
function decode(git) {
  if (!git?.commits) return [];
  return git.commits.map(([hash, ts, flags, repo, ids, subject = '']) => ({ hash, ts, subject, fix: !!(flags & 1), revert: !!(flags & 2), repo, files: ids.map((i) => git.files[i]) }));
}

// ---- memory: what each note and CLAUDE.md section talks about ----------------------------------------------------
const PATH_TOKEN = /`([^`\n]+)`|(?:^|[\s(])((?:[\w.@~-]+\/)+[\w.@-]+\.\w+)/gm;
function sectionsOf(text, display) {
  const out = [];
  let sec = { title: null, text: '' };
  const flush = () => { if (sec.text.trim()) out.push({ id: sec.title ? `${display} § ${sec.title}` : display, title: sec.title, text: sec.text }); };
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) { flush(); sec = { title: m[1], text: '' }; } else sec.text += `${line}\n`;
  }
  flush();
  return out;
}
// Docs from the memory report: auto-memory notes, Serena notes, and the project's instruction files by section (those
// of repos nested in it too: they talk about its code). label: how a doc is named to the user and to Claude.
function docsOf(report) {
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const inProject = (i) => i.scope !== 'worktree' && i.scope !== 'user' && i.scope !== 'managed';
  const base = (p) => String(p).split(/[\\/]/).pop();
  return [
    ...(report?.memory?.notes || []).map((n) => ({ kind: 'note', id: n.display, file: n.display, label: base(n.display), text: read(n.path) })),
    ...(report?.serena?.notes || []).map((n) => ({ kind: 'serena', id: n.display, file: n.display, label: `Serena: ${base(n.display)}`, text: read(n.path) })),
    ...(report?.instructions || []).filter(inProject).flatMap((i) => sectionsOf(read(i.path), i.display).map((s) => ({ kind: 'instructions', id: s.id, file: i.display, label: s.id, title: s.title, text: s.text }))),
  ].filter((d) => d.text);
}
// The areas a doc talks about: files it cites, exported names it mentions (names exported by at most 2 files), and
// the folders it names (the area's last folder, when that is not a generic word).
function linkDocs(docs, map) {
  const names = new Map();
  map.info.forEach((x, i) => { for (const n of x.names) if (n.length > 3) (names.get(n) || names.set(n, []).get(n)).push(i); });
  const folderRe = map.areas.map((a) => {
    const leaf = a.folder.split('/').pop() || '';
    if (leaf.length <= 4 || GENERIC.has(leaf.toLowerCase())) return null;
    return new RegExp(`(?:^|[^\\w/-])${leaf.split(/[-_.]/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[-_ ]?')}(?![\\w-])`, 'i');
  });
  // A folder word most docs use is the project's vocabulary ("shop" in a shop app), not a topic: left out.
  folderRe.forEach((re, k) => { if (re && docs.filter((d) => re.test(d.text)).length > Math.max(3, docs.length * TREE.commonWord)) folderRe[k] = null; });
  return docs.map((d) => {
    const files = new Set(), areas = new Set();
    for (const m of d.text.matchAll(PATH_TOKEN)) {
      const tok = (m[1] || m[2]).trim().replace(/[),.;:]+$/, '').replace(/\(\)$/, '');
      const i = fileIndex(map, tok);
      if (i != null) files.add(i);
      else if (names.has(tok) && names.get(tok).length <= 2) for (const j of names.get(tok)) files.add(j);
    }
    for (const i of files) areas.add(map.areaOf.get(i));
    const cited = [...areas].filter((k) => k != null).sort((a, b) => a - b); // the strong links: a file or a name in the area
    folderRe.forEach((re, k) => { if (re && re.test(d.text)) areas.add(k); });
    return { kind: d.kind, id: d.id, file: d.file, label: d.label, title: d.title || null, files: files.size, areas: [...areas].filter((k) => k != null).sort((a, b) => a - b), cited };
  });
}

// ---- the tree ------------------------------------------------------------------------------------------------------
// root: the project folder; map: its code map (src/codemap.js); report: its memory report (src/memory.js); agg: the
// experience aggregate; prev: the last tree, for an incremental refresh; months: the git window (a number or 'all');
// progress(phase, detail): called as the build moves on.
export async function buildTree({ root, map, report = null, agg = null, prev = null, months = prev?.months ?? TREE.months, now = Date.now(), progress = () => {} }) {
  const t0 = Date.now();
  progress('code', { files: map.files.length });
  progress('git', { repos: map.repoDirs.length });
  const { repos, commits } = await readGit(root, map.repoDirs, prev, months, now);
  progress('memory', { commits: commits.length });

  // git facts per file (code files only; a commit counts for a file unless it touched too many files at once)
  const git = new Map();
  for (const c of commits) {
    if (c.files.length > TREE.maxFilesPerCommit) continue;
    for (const f of c.files) {
      const g = git.get(f) || { n: 0, fix: 0, n90: 0, last: 0 };
      g.n++; if (c.fix) g.fix++; if (now - c.ts < TREE.hotDays * DAY) g.n90++; g.last = Math.max(g.last, c.ts);
      git.set(f, g);
    }
  }
  // claude facts per file: episodes that read it, episodes that edited it (an episode mirrored into a nested repo counts once)
  const projs = agg ? projectsUnder(agg, root) : [];
  const reads = new Map(), edits = new Map();
  let firstSession = null, sessions = 0;
  for (const { p, pre } of projs) {
    for (const s of Object.values(p.sessions)) {
      sessions++;
      firstSession = Math.min(firstSession ?? s.first, s.first);
      for (const ep of s.eps) {
        const key = ep.of ?? ep.start;
        for (const f of Object.keys(ep.r)) { const k = pre + p.files[+f]; (reads.get(k) || reads.set(k, new Set()).get(k)).add(key); }
        for (const f of Object.keys(ep.e)) { const k = pre + p.files[+f]; (edits.get(k) || edits.set(k, new Set()).get(k)).add(key); }
      }
    }
  }
  const fails = projs.flatMap(({ p, pre }) => failures(p, now).map((x) => ({ fam: x.fam, sig: x.sig, episodes: x.episodes, days: x.days, fix: x.fix.kind === 'file' ? pre + x.fix.name : null })));

  // memory linked to areas
  const docs = linkDocs(docsOf(report), map);

  const areas = map.areas.map((a, k) => {
    const files = a.files.map((i) => {
      const f = map.files[i], g = git.get(f), r = reads.get(f)?.size || 0, e = edits.get(f)?.size || 0;
      return { f, names: map.info[i].names, by: map.importers[i].size, ...(g ? { git: g } : {}), ...(r || e ? { claude: { read: r, edit: e } } : {}) };
    });
    const set = new Set(files.map((x) => x.f));
    const touching = commits.filter((c) => c.files.length <= TREE.maxFilesPerCommit && c.files.some((f) => set.has(f)));
    const last = touching[0]?.ts || 0;
    const epsRead = new Set(), epsEdit = new Set();
    for (const x of files) { for (const e of reads.get(x.f) || []) epsRead.add(e); for (const e of edits.get(x.f) || []) epsEdit.add(e); }
    const links = areaLinks(map, k);
    return {
      name: a.name, top: a.top.map((i) => map.files[i]), files,
      uses: links.dependsOn.map(([o, n]) => [map.areas[o].name, n]), usedBy: links.usedBy.map(([o, n]) => [map.areas[o].name, n]),
      shared: links.shared.map(([j]) => map.files[j]),
      git: { commits: touching.length, fixes: touching.filter((c) => c.fix).length, n90: touching.filter((c) => now - c.ts < TREE.hotDays * DAY).length, last, dormant: !last || now - last > TREE.dormantDays * DAY },
      claude: { read: epsRead.size, edit: epsEdit.size, failures: fails.filter((x) => x.fix && set.has(x.fix)).map(({ fam, sig, episodes, days }) => ({ fam, sig, episodes, days })) },
      notes: docs.map((d, j) => (d.areas.includes(k) ? j : -1)).filter((j) => j >= 0),
    };
  });

  const { key, hubs } = keyFiles(map, 5);
  const busy = (a) => a.git.n90 >= TREE.busy || a.git.fixes >= TREE.fragile;
  // Files that cite something in the area (sections of one CLAUDE.md are one file; naming the folder is not enough).
  const sources = (a) => new Set(a.notes.filter((j) => docs[j].cited.includes(areas.indexOf(a))).map((j) => docs[j].file)).size;
  const byActivity = (a, b) => b.git.n90 - a.git.n90 || b.git.fixes - a.git.fixes;
  const tree = {
    v: 1, root, name: path.basename(root), at: now, months,
    repos, git: encode(commits),
    code: { files: map.files.length, names: map.info.reduce((n, x) => n + x.names.length, 0), imports: map.importers.reduce((n, s) => n + s.size, 0), key: key.map((i) => map.files[i]), shared: hubs.map((i) => map.files[i]) },
    areas, docs,
    reverted: commits.filter((c) => c.revert).map((c) => [c.hash.slice(0, 12), c.subject.slice(0, 80), c.ts]),
    claude: { sessions, since: firstSession },
    gaps: {
      // Busy or fragile areas no note talks about; areas many notes talk about (worth checking that they agree).
      quiet: areas.map((a, k) => k).filter((k) => busy(areas[k]) && !areas[k].notes.length).sort((x, y) => byActivity(areas[x], areas[y])),
      crowded: areas.map((a, k) => k).filter((k) => sources(areas[k]) >= TREE.manyNotes).sort((x, y) => sources(areas[y]) - sources(areas[x])),
    },
  };
  tree.ms = Date.now() - t0;
  progress('done', { ms: tree.ms });
  return tree;
}

// The project profile, in numbers: what the Memory tab says at the top and the tools say when asked for an overview.
export function profileOf(tree) {
  const active = tree.areas.filter((a) => !a.git.dormant);
  const byN90 = [...tree.areas].filter((a) => a.git.n90).sort((a, b) => b.git.n90 - a.git.n90).slice(0, 3);
  const byFix = [...tree.areas].filter((a) => a.git.fixes).sort((a, b) => b.git.fixes - a.git.fixes).slice(0, 3);
  const linked = tree.docs.filter((d) => d.areas.length).length;
  return {
    files: tree.code.files, repos: Object.keys(tree.repos).length, areas: tree.areas.length, active: active.length, dormant: tree.areas.length - active.length,
    commits: tree.git.commits.length, months: tree.months,
    busiest: byN90.map((a) => ({ name: a.name, n90: a.git.n90, fixes: a.git.fixes })), fixes: byFix.map((a) => ({ name: a.name, fixes: a.git.fixes, commits: a.git.commits })),
    docs: tree.docs.length, linked, quiet: tree.gaps.quiet.length, sessions: tree.claude.sessions, since: tree.claude.since,
  };
}

// The gap checks, as Memory tab problems with a prompt to copy. They describe; they never ask Claude to write a note on
// its own or judge what notes say.
export function gapProblems(tree) {
  if (!tree) return [];
  const months = tree.months === 'all' ? 'all of git history' : `the last ${tree.months} months`;
  const quiet = tree.gaps.quiet.slice(0, TREE.maxListed).map((k) => {
    const a = tree.areas[k];
    return {
      tier: 'suggestion', code: 'busy_area_no_notes', file: a.name, params: { area: a.name, n90: a.git.n90, fixes: a.git.fixes, days: TREE.hotDays },
      fix: `In ${tree.name}, the area \`${a.name}\` (${a.files.length} code files) changed in ${a.git.n90} commits in the last ${TREE.hotDays} days, ${a.git.fixes} of them labeled fix in ${months}, and no memory note or CLAUDE.md section talks about it. ` +
        'Look at its recent history (git log on that folder). If something there is not obvious from the code, such as a rule, a pitfall or a decision, suggest a short note for me to review; don\'t write it yet.',
    };
  });
  const crowded = tree.gaps.crowded.slice(0, TREE.maxListed).map((k) => {
    const a = tree.areas[k], notes = a.notes.map((j) => tree.docs[j]).filter((d) => d.cited.includes(k));
    return {
      tier: 'suggestion', code: 'many_notes_area', file: a.name, params: { area: a.name, count: new Set(notes.map((d) => d.file)).size, items: notes.map((d) => ({ path: d.id, lines: [] })) },
      fix: `In ${tree.name}, ${notes.length} memory notes and CLAUDE.md sections talk about the area \`${a.name}\`:\n${notes.map((d) => `- ${d.id}`).join('\n')}\n` +
        'Read them and tell me whether any of them contradict each other or the current code, and which could be merged. Don\'t change anything yet.',
    };
  });
  return [...quiet, ...crowded];
}
