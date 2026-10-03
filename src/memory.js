// Read-only map of what Claude Code and Serena remember about a project: instruction files (CLAUDE.md and the
// files it imports), Claude's auto memory, Serena's notes, the code files they cite, and the problems found in them.
// Nothing here changes a file: test/memory-readonly.test.mjs fails if this module calls a filesystem function
// outside the read-only allow list, or runs git with anything but ls-tree / show.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MEMORY_LINES = 200;        // Claude Code loads the first 200 lines of MEMORY.md...
const MEMORY_BYTES = 25 * 1024;  // ...or its first 25 KB, whichever comes first
const TARGET_LINES = 200;        // documented size target for one CLAUDE.md
const LARGE_NOTE_TOKENS = 5000;
const NEVER_READ_DAYS = 7;       // with less history than this, "never read" says nothing
const IMPORT_HOPS = 4;
const GIT_READ = new Set(['ls-tree', 'show']);
const GIT_TTL_MS = 60_000;
const INDEX_RE = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+?\.md)\)\s*(?:[—–-]+\s*(.*))?$/;
const EXT = /\.(?:[cm]?[jt]sx?|json|mdx?|css|scss|less|html?|py|rb|go|rs|java|kt|cs|php|ya?ml|toml|sql|prisma|sh|ps1|txt|svg|png|jpe?g|gif|webp|ico)$/i;
const GUESS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];
const STOP = new Set(('the and for not but are was with from that this when what into have will your their about after before ' +
  'los las del que por una sin con para como cuando sobre entre desde pero esta este estos estas tiene hay muy mas ' +
  'gotcha project feedback reference note notes user memory nota').split(' '));

export const tokensOf = (text) => Math.round(text.length / 4); // an estimate: characters divided by four
export const keyOf = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
const slash = (p) => p.split(path.sep).join('/');
const lineCount = (t) => (t ? t.split(/\r?\n/).length - (/\r?\n$/.test(t) ? 1 : 0) : 0);
const norm = (s) => s.trim().toLowerCase().replace(/_/g, '-');

async function readText(file) {
  try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
}
async function isFile(file) {
  try { return (await fsp.stat(file)).isFile(); } catch { return false; }
}
async function exists(p) {
  try { await fsp.stat(p); return true; } catch { return false; }
}
async function entries(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

// ---- projects ----------------------------------------------------------------------------------------------

// Claude Code keys auto memory by git repository; a worktree shares the main repository's memory.
const rootCache = new Map();
export function projectRoot(cwd) {
  if (!cwd) return null;
  const k = keyOf(cwd);
  if (rootCache.has(k)) return rootCache.get(k);
  let root = path.resolve(cwd);
  for (let dir = root; ; dir = path.dirname(dir)) {
    let st = null;
    try { st = fs.statSync(path.join(dir, '.git')); } catch { /* not here */ }
    if (st?.isDirectory()) { root = dir; break; }
    if (st?.isFile()) { root = mainRepoOf(path.join(dir, '.git')) || dir; break; }
    if (path.dirname(dir) === dir) break;
  }
  rootCache.set(k, root);
  return root;
}

function mainRepoOf(dotGitFile) {
  try {
    const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dotGitFile, 'utf8'));
    if (!m) return null;
    const gitdir = path.resolve(path.dirname(dotGitFile), m[1].trim());
    const i = gitdir.replace(/\\/g, '/').toLowerCase().lastIndexOf('/.git/worktrees/');
    return i >= 0 ? gitdir.slice(0, i) : null;
  } catch { return null; }
}

// Claude Code names a project's folder after its path, with every character that isn't a letter or digit as "-".
export const slugOf = (root) => path.resolve(root).replace(/[^a-zA-Z0-9]/g, '-');

// Only two keys are read from Serena's global config; the rest of it (including auth_secret) is never kept.
export function serenaConfig(home = os.homedir()) {
  let text;
  try { text = fs.readFileSync(path.join(home, '.serena', 'serena_config.yml'), 'utf8'); } catch { return { projects: [], folder: null }; }
  const unq = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  const projects = [];
  let folder = null;
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    const flow = /^projects:\s*\[(.*)\]\s*$/.exec(line);
    if (flow) { for (const p of flow[1].split(',')) if (p.trim()) projects.push(unq(p)); continue; }
    if (/^projects:\s*$/.test(line)) { inList = true; continue; }
    if (inList) {
      const item = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (item) { projects.push(unq(item[1])); continue; }
      if (/^\S/.test(line)) inList = false;
    }
    const f = /^project_serena_folder_location:\s*(.+?)\s*$/.exec(line);
    if (f) folder = unq(f[1]);
  }
  text = null;
  return { projects, folder };
}

// Projects seen in KevMind sessions first (most recent first), then projects only Serena knows.
export function listProjects({ cwds = new Map(), home = os.homedir() } = {}) {
  const seen = new Map();
  for (const [cwd, lastAt] of cwds) {
    const root = projectRoot(cwd);
    if (!root) continue;
    const k = keyOf(root);
    if (!seen.has(k) || lastAt > seen.get(k).lastAt) seen.set(k, { key: k, root, name: path.basename(root) || root, source: 'session', lastAt });
  }
  const others = [];
  for (const p of serenaConfig(home).projects) {
    const k = keyOf(p);
    if (!seen.has(k) && !others.some((o) => o.key === k)) others.push({ key: k, root: path.resolve(p), name: path.basename(p), source: 'serena', lastAt: 0 });
  }
  return [...[...seen.values()].sort((a, b) => b.lastAt - a.lastAt), ...others.sort((a, b) => a.name.localeCompare(b.name))];
}

// ---- the report ----------------------------------------------------------------------------------------------

// reads: { since, items: [{ ts, root, path }] } from KevMind's events (Read tool calls).
// loaded: [{ path, reason, type }] from the latest InstructionsLoaded events of this project's sessions.
// projects: [{ root, name }] every known project, so a file shared by several (a parent folder's CLAUDE.md)
// has its problems reported once, under the project it lives in.
// codeNames(names): resolves to a Map of the names no code file has anymore but git shows in the code before
// (name -> { commit, date, subject }), from the code map; null skips the check.
export async function scanProject(root, { home = os.homedir(), now = Date.now(), reads = null, loaded = [], projects = [], codeNames = null } = {}) {
  root = path.resolve(root);
  const problems = [];
  const display = (p) => {
    const rel = path.relative(root, p);
    if (!rel) return '.';
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return slash(rel);
    const relHome = path.relative(home, p);
    if (!relHome.startsWith('..') && !path.isAbsolute(relHome)) return '~/' + slash(relHome);
    return slash(p);
  };
  const known = projects.map((p) => ({ key: keyOf(p.root), root: path.resolve(p.root), name: p.name || path.basename(p.root) }));
  // The deepest known project that contains a file, when that is not the one being scanned.
  const ownerOf = (file) => {
    let best = null;
    for (const p of known) {
      const rel = path.relative(p.root, path.dirname(file));
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (!best || p.root.length > best.root.length) best = p;
    }
    return best && best.key !== keyOf(root) ? best : null;
  };
  const ctx = { root, home, display, problems, ownerOf, codeNames, add:(tier, code, file, params, fix) => problems.push({ tier, code, file, params, fix }) };

  const instructions = await scanInstructions(ctx, loaded);
  const memory = await scanAutoMemory(ctx);
  const serena = await scanSerena(ctx);
  linkNotes(ctx, memory.notes, serena.notes);

  // Paths cited in a file are resolved from that file's own workspace: the nearest git root above it.
  // Notes live outside the project, so theirs is the project root. User-level files cite nothing project-specific.
  const own = (i) => i.scope !== 'worktree' && i.scope !== 'user' && i.scope !== 'managed' && !i.ownedBy;
  const sources = [
    ...instructions.filter(own).map((i) => ({ owner: i, text: i.text, base: gitRootOf(i.path), fileDir: path.dirname(i.path) })),
    ...memory.notes.map((n) => ({ owner: n, text: n.text, base: root, fileDir: root })),
    ...serena.notes.map((n) => ({ owner: n, text: n.text, base: root, fileDir: root })),
  ];
  const git = await checkCitations(ctx, sources);
  await checkScripts(ctx, sources);
  lastReads(ctx, memory.notes, reads, now);
  overlaps(ctx, memory.notes);

  // Startup context: what the InstructionsLoaded hook saw at session start if we have it, else the documented rules.
  const observed = loaded.length > 0;
  const atStart = instructions.filter((i) => (observed ? i.observedAtStart : i.load === 'startup'));
  const sum = (list) => list.reduce((n, i) => n + i.tokens, 0);
  const parts = [
    { label: 'user', tokens: sum(atStart.filter((i) => i.scope === 'user' || i.scope === 'managed')) },
    { label: 'project', tokens: sum(atStart.filter((i) => i.scope !== 'user' && i.scope !== 'managed')) },
    { label: 'memory', tokens: memory.index ? memory.index.loadedTokens : 0 },
  ];
  const strip = ({ text, observedAtStart, ...rest }) => rest;
  return {
    root, name: path.basename(root), generatedAt: now,
    startup: { observed, total: parts.reduce((n, p) => n + p.tokens, 0), parts },
    instructions: instructions.map(strip),
    memory: { ...memory, notes: memory.notes.map(strip) },
    serena: { ...serena, notes: serena.notes.map(strip) },
    git,
    reads: { days: reads ? Math.floor((now - reads.since) / 86_400_000) : 0 },
    problems,
  };
}

// ---- instruction files ---------------------------------------------------------------------------------------

function managedPaths() {
  if (process.platform === 'win32') return ['C:\\Program Files\\ClaudeCode\\CLAUDE.md'];
  if (process.platform === 'darwin') return ['/Library/Application Support/ClaudeCode/CLAUDE.md'];
  return ['/etc/claude-code/CLAUDE.md'];
}

async function scanInstructions(ctx, loaded) {
  const { root, home, display, add, ownerOf } = ctx;
  const list = [];
  const byKey = new Map();
  const take = async (file, scope, load, importedBy = null) => {
    const k = keyOf(file);
    if (byKey.has(k)) return null;
    const text = await readText(file);
    if (text === null) return null;
    const owner = scope === 'user' || scope === 'managed' ? null : ownerOf(file);
    const item = {
      path: file, display: display(file), scope, load, importedBy, ownedBy: owner ? { key: owner.key, name: owner.name } : null,
      bytes: Buffer.byteLength(text), lines: lineCount(text), tokens: tokensOf(text), observed: false, text,
    };
    byKey.set(k, item);
    list.push(item);
    return item;
  };
  const rules = async (dir, scope) => {
    for (const f of await mdTree(dir, 6)) {
      const text = await readText(f);
      await take(f, scope, /^---[\s\S]*?\npaths:/m.test(text || '') ? 'glob' : 'startup');
    }
  };

  for (const f of managedPaths()) await take(f, 'managed', 'startup');
  await take(path.join(home, '.claude', 'CLAUDE.md'), 'user', 'startup');
  await rules(path.join(home, '.claude', 'rules'), 'user');
  if (path.dirname(root) !== root) {
    const chain = [];
    for (let d = path.dirname(root); ; d = path.dirname(d)) { chain.unshift(d); if (path.dirname(d) === d) break; }
    for (const d of chain) {
      await take(path.join(d, 'CLAUDE.md'), 'ancestor', 'startup');
      await take(path.join(d, 'CLAUDE.local.md'), 'ancestor', 'startup');
    }
  }
  await take(path.join(root, 'CLAUDE.md'), 'project', 'startup');
  await take(path.join(root, '.claude', 'CLAUDE.md'), 'project', 'startup');
  await take(path.join(root, 'CLAUDE.local.md'), 'local', 'startup');
  await rules(path.join(root, '.claude', 'rules'), 'rule');
  for (const f of await nestedInstructionFiles(root)) {
    await take(f, slash(path.relative(root, f)).startsWith('.claude/worktrees/') ? 'worktree' : 'nested', 'lazy');
  }

  // @imports, resolved from the importing file, at most four hops deep. Worktree copies are not followed.
  const queue = list.filter((i) => i.scope !== 'worktree').map((item) => ({ item, depth: 0 }));
  for (let q = 0; q < queue.length; q++) {
    const { item, depth } = queue[q];
    for (const ref of importsOf(item.text)) {
      const target = resolveImport(ref, item.path, home);
      if (!(await isFile(target))) {
        if (!item.ownedBy) {
          add('problem', 'broken_import', item.display, { target: ref },
            `In ${item.display}, the import @${ref} points to a file that does not exist (${display(target)}). Fix the path or remove the import.`);
        }
        continue;
      }
      if (depth >= IMPORT_HOPS) continue;
      const added = await take(target, 'import', item.load, item.display);
      if (added && item.ownedBy) added.ownedBy = item.ownedBy; // what a shared file imports belongs to its owner too
      if (added) queue.push({ item: added, depth: depth + 1 });
    }
  }

  // What the InstructionsLoaded hook actually reported, when available.
  for (const l of loaded) {
    let item = byKey.get(keyOf(l.path));
    if (!item) item = await take(l.path, String(l.type || 'project').toLowerCase(), l.reason === 'session_start' ? 'startup' : 'lazy');
    if (!item) continue;
    item.observed = true;
    if (l.reason === 'session_start' || l.reason === 'include') item.observedAtStart = true;
  }

  const rootFile = byKey.get(keyOf(path.join(root, 'CLAUDE.md')));
  for (const i of list) {
    if (i.ownedBy) {
      // Reported once, under the project the file lives in; here, just say it is shared.
      if (i.scope === 'import') continue;
      const inside = !path.relative(root, i.path).startsWith('..');
      add('info', inside ? 'nested_project' : 'inherits', i.display, { project: i.ownedBy.name, key: i.ownedBy.key }, null);
      continue;
    }
    if (i.scope !== 'worktree' && i.lines > TARGET_LINES) {
      add('warning', 'instructions_oversized', i.display, { lines: i.lines, tokens: i.tokens },
        `${i.display} has ${i.lines} lines, over the documented 200-line target, and costs about ${i.tokens} tokens of context (estimate)${i.load === 'startup' ? ' at every session start' : ' whenever it loads'}. ` +
        'Move topic-specific sections into .claude/rules/ files with paths: frontmatter, or into CLAUDE.md files in the subfolders they describe, and keep this file to what every session needs.');
    }
    if (i.scope === 'worktree' && rootFile) {
      const pct = Math.round(overlap(i.text, rootFile.text) * 100);
      if (pct >= 50) {
        add('warning', 'worktree_copy', i.display, { of: rootFile.display, pct },
          `${i.display} is a ${pct}% copy of ${rootFile.display}. A Claude Code session started in that worktree loads both files. ` +
          'If the worktree is no longer used, remove it with git worktree remove; otherwise bring its CLAUDE.md up to date.');
      }
    }
  }
  return list;
}

// Markdown files in a folder tree (rules folders, Serena memories).
async function mdTree(dir, depth) {
  const out = [];
  if (depth < 0) return out;
  for (const e of await entries(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await mdTree(p, depth - 1)));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

// CLAUDE.md and CLAUDE.local.md in subfolders: loaded lazily, when Claude reads a file in that subtree.
async function nestedInstructionFiles(root) {
  const found = [];
  let budget = 20_000;
  const walk = async (dir, depth) => {
    if (depth > 8 || --budget < 0) return;
    const inClaude = path.basename(dir) === '.claude';
    for (const e of await entries(dir)) {
      const p = path.join(dir, e.name);
      if (e.isFile()) {
        if (dir !== root && (e.name === 'CLAUDE.md' || e.name === 'CLAUDE.local.md')) found.push(p);
      } else if (e.isDirectory()) {
        if (inClaude ? e.name !== 'worktrees' : (e.name.startsWith('.') && e.name !== '.claude') || SKIP_DIRS.has(e.name)) continue;
        await walk(p, depth + 1);
      }
    }
  };
  await walk(root, 0);
  return found;
}
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'graphify-out', 'vendor', 'target', 'venv', '__pycache__', 'tmp', 'logs']);

function importsOf(text) {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out = [];
  for (const m of clean.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/])?[^\s`"'<>()]+)/g)) {
    const ref = m[1].replace(/[.,;:!?)\]]+$/, '');
    if (/[\\/]/.test(ref) || /\.\w{1,6}$/.test(ref)) out.push(ref);
  }
  return out;
}

function resolveImport(ref, from, home) {
  if (ref.startsWith('~/')) return path.join(home, ref.slice(2));
  if (path.isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref)) return path.resolve(ref);
  return path.resolve(path.dirname(from), ref);
}

// Share of the second text's meaningful lines that also appear in the first.
function overlap(a, b) {
  const lines = (t) => new Set(t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 20));
  const A = lines(a);
  const B = lines(b);
  if (!B.size) return 0;
  let n = 0;
  for (const l of B) if (A.has(l)) n++;
  return n / B.size;
}

// ---- auto memory ---------------------------------------------------------------------------------------------

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    // Four layouts exist (metadata nested or flat); the first value of a key wins.
    if (kv && kv[2] && !(kv[1] in fm)) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/\\"/g, '"');
  }
  return { fm, body: text.slice(m[0].length) };
}

const headingsOf = (text) => [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].slice(0, 12).map((m) => m[1].slice(0, 80));

async function scanAutoMemory(ctx) {
  const { root, home, display, add } = ctx;
  const dir = path.join(home, '.claude', 'projects', slugOf(root), 'memory');
  const indexPath = path.join(dir, 'MEMORY.md');
  const indexText = await readText(indexPath);
  const files = (await entries(dir)).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name !== 'MEMORY.md').map((e) => e.name);
  if (indexText === null && !files.length) return { display: display(dir), exists: false, index: null, notes: [] };

  const lines = (indexText || '').split(/\r?\n/);
  const listed = new Map();
  lines.forEach((l, i) => {
    const m = INDEX_RE.exec(l);
    if (m) listed.set(path.basename(m[2].trim()).toLowerCase(), { line: i + 1, title: m[1].trim(), file: m[2].trim() });
  });
  let index = null;
  if (indexText !== null) {
    const bytes = Buffer.byteLength(indexText);
    const total = lineCount(indexText);
    let loadedText = lines.slice(0, MEMORY_LINES).join('\n');
    if (Buffer.byteLength(loadedText) > MEMORY_BYTES) loadedText = Buffer.from(loadedText).subarray(0, MEMORY_BYTES).toString();
    index = { display: display(indexPath), lines: total, bytes, tokens: tokensOf(indexText), loadedTokens: tokensOf(loadedText), truncated: total > MEMORY_LINES || bytes > MEMORY_BYTES, entries: listed.size };
    if (index.truncated) {
      add('problem', 'index_truncated', index.display, { lines: total, kb: Math.round(bytes / 1024) },
        `${index.display} has ${total} lines and ${Math.round(bytes / 1024)} KB, but Claude Code only loads its first 200 lines or 25 KB, so the rest is silently dropped. ` +
        'Keep MEMORY.md to one short line per note and move details into the topic notes.');
    }
  }

  const notes = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const text = await readText(file);
    if (text === null) continue;
    let mtime = null;
    try { mtime = (await fsp.stat(file)).mtime.toISOString(); } catch { /* keep null */ }
    const { fm, body } = frontmatter(text);
    const stem = name.replace(/\.md$/i, '');
    const entry = listed.get(name.toLowerCase());
    notes.push({
      kind: 'memory', path: file, display: display(file), stem, name: fm.name || stem, title: entry?.title || fm.name || stem,
      description: (fm.description || '').slice(0, 240), type: fm.type || null, modified: fm.modified || mtime,
      bytes: Buffer.byteLength(text), tokens: tokensOf(text), headings: headingsOf(body), indexed: !!entry,
      refs: [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1].trim()), text,
    });
  }

  if (index) {
    const present = new Set(files.map((f) => f.toLowerCase()));
    for (const [base, e] of listed) {
      if (present.has(base)) continue;
      add('problem', 'index_missing_note', index.display, { target: e.file, line: e.line },
        `Line ${e.line} of ${index.display} lists ${e.file}, but that note does not exist in ${display(dir)}. Remove the line, or restore the note if it was deleted by mistake.`);
    }
  }
  for (const n of notes) {
    if (index && !n.indexed) {
      add('problem', 'note_not_indexed', n.display, {},
        `The memory note ${n.display} is not listed in ${index.display}, so Claude does not know it exists. Add a one-line entry for it in the form "- [Title](${n.stem}.md) — hook", or delete the note if it is obsolete.`);
    }
    if (n.tokens > LARGE_NOTE_TOKENS) {
      add('warning', 'note_large', n.display, { tokens: n.tokens },
        `${n.display} is about ${n.tokens} tokens (estimate), so every time Claude reads it a large part of the context goes to this one note. Split it into smaller topic notes, or trim history that no longer matters.`);
    }
  }
  return { display: display(dir), exists: true, index, notes };
}

// ---- Serena --------------------------------------------------------------------------------------------------

async function scanSerena(ctx) {
  const { root, home, display } = ctx;
  const { folder } = serenaConfig(home);
  const base = folder ? path.resolve(root, folder.replace('$projectDir', root)) : path.join(root, '.serena');
  const dir = path.join(base, 'memories');
  const files = await mdTree(dir, 4);
  if (!files.length) return { display: display(dir), exists: await exists(dir), notes: [] };
  const notes = [];
  for (const file of files) {
    const text = await readText(file);
    if (text === null) continue;
    let mtime = null;
    try { mtime = (await fsp.stat(file)).mtime.toISOString(); } catch { /* keep null */ }
    const name = slash(path.relative(dir, file)).replace(/\.md$/i, '');
    notes.push({
      kind: 'serena', path: file, display: display(file), name, title: name, description: '', type: null, modified: mtime,
      bytes: Buffer.byteLength(text), tokens: tokensOf(text), headings: headingsOf(text),
      refs: [...text.matchAll(/\bmem:([\w./-]+)/g)].map((m) => m[1].replace(/[.]+$/, '')), text,
    });
  }
  return { display: display(dir), exists: true, notes };
}

// ---- links between notes -------------------------------------------------------------------------------------

function linkNotes(ctx, memoryNotes, serenaNotes) {
  const resolve = (notes, aliasesOf) => {
    const map = new Map();
    for (const n of notes) for (const a of aliasesOf(n)) if (!map.has(a)) map.set(a, n);
    return map;
  };
  const memMap = resolve(memoryNotes, (n) => [norm(n.name), norm(n.stem)]);
  const serMap = resolve(serenaNotes, (n) => [norm(n.name)]);
  for (const n of [...memoryNotes, ...serenaNotes]) { n.linksOut = []; n.linksIn = []; }
  for (const [notes, map, syntax] of [[memoryNotes, memMap, (r) => `[[${r}]]`], [serenaNotes, serMap, (r) => `mem:${r}`]]) {
    for (const n of notes) {
      for (const ref of n.refs) {
        const target = map.get(norm(ref));
        if (!target) {
          ctx.add('problem', 'broken_link', n.display, { link: syntax(ref) },
            `In ${n.display}, the link ${syntax(ref)} points to no note. Find the note it was meant for and fix the link, or remove it.`);
          continue;
        }
        if (target === n || n.linksOut.includes(target.display)) continue;
        n.linksOut.push(target.display);
        target.linksIn.push(n.display);
      }
    }
  }
  for (const n of [...memoryNotes, ...serenaNotes]) delete n.refs;
}

// ---- cited code files ----------------------------------------------------------------------------------------

// A mention in a negated sentence ("there is no x.ts", "ya no existe") is not a claim that the file exists.
// Removal and move words count too: a sentence that says a file was deleted or moved isn't claiming it is there.
const NEG_RE = /(?:^|[^\p{L}'’])(?:no|not|never|nunca|removed|deleted|purged|moved|renamed|doesn['’]t|don['’]t|do not|does not|no longer|ya no|(?:eliminad|borrad|purgad|movid|renombrad)[oa]s?|(?:elimin|borr)(?:ó|aron|amos|é))(?![\p{L}])/iu;
const DONT_RE = /^[\s#>*_|-]*(?:❌|✗|✘|🚫)?\s*(?:don['’]?t|do not|avoid|never|evitar|no hacer|nunca|prohibido)\b/iu;
// A sentence about git: with a branch-namespace prefix ("test/", "feat/"), a mention is a branch, even a deleted one.
const GIT_TALK_RE = /\b(?:branch(?:es)?|ramas?|cherry-pick|rebase|merge|checkout|commit|develop)\b|\b[0-9a-f]{7,40}\b/i;
// Table columns that hold the stale side of a comparison ("Was written | Reality"): their paths aren't claims either.
const STALE_COL_RE = /^\s*(?:was written|wrong|incorrect|claimed|before|old|outdated|antes|incorrect[oa]|err[oó]ne[oa]|dec[ií]a)\b/iu;
const DO_RE = /^[\s#>*_|-]*(?:✅|✓|✔)?\s*(?:do|haz|s[ií])\b(?!\s+not)/iu;
const ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE_RE = /^\s*(?:```|~~~)/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}/;

// A code name in backticks: camelCase or PascalCase of at least two words (`fetchUser`, `UserCard`); not an ID such
// as `prod_123`, a constant in capitals or a single word. A trailing "()" is dropped.
const NAME_RE = /^(?:[a-z]+|[A-Z][a-z0-9]+)(?:[A-Z][a-z0-9]+)+$/;
const nameOf = (t) => { t = t.trim().replace(/\(\)$/, ''); return NAME_RE.test(t) ? t : null; };

// The path a token names, normalized, or null when it doesn't look like a cited file.
function acceptPath(t, topDirs, home) {
  t = t.trim().replace(/^[[('"]+/, '').replace(/[\]'"),.;:!?]+$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!t || t.length > 200 || /\s|:\/\/|[*{}<>$|#]/.test(t) || t.includes('node_modules')) return null;
  if (/^@[^/]/.test(t) || t === '@') return null; // an @import (checked on its own) or an npm scope, not a cited file
  if (t.startsWith('/') && !t.startsWith(slash(home))) return null; // a URL path such as /api/x, not a file on disk
  if (t.startsWith('./')) t = t.slice(2);
  if (t.startsWith('~/')) t = slash(path.join(home, t.slice(2)));
  const segs = t.split('/');
  const base = segs[segs.length - 1];
  const hasExt = EXT.test(t) && base.replace(EXT, '').length > 0;
  if (hasExt && base.startsWith('.')) return null;                          // ".d.ts", ".eslintrc.json": an extension or a dotfile
  if (/(^|[-_])(x|xx|foo|bar|example)(\.|$)/i.test(base)) return null;       // placeholders such as x.test.ts
  if (!hasExt && segs.every((s) => topDirs.has(s))) return null;            // prose such as "backend/frontend"
  const abs = /^[A-Za-z]:\//.test(t) || t.startsWith('/');
  return (abs ? hasExt : hasExt || (t.startsWith('@/') && t.length > 2) || (t.includes('/') && topDirs.has(segs[0]))) ? t : null;
}

// Every path a Markdown text cites, with the lines it is cited on. Skipped: code blocks, mentions in a negated
// sentence or table cell, items under a "Don't" heading or label, cells in a "Don't" column, and ❌ items.
function citations(text, topDirs, home) {
  const found = new Map();
  const record = (p, line, gitTalk, name = null) => {
    if (!found.has(p)) found.set(p, { path: p, name, lines: new Set(), gitTalk: false });
    found.get(p).lines.add(line);
    if (gitTalk) found.get(p).gitTalk = true;
  };
  // Scans one paragraph (lines joined with spaces) for paths; sentences end at . ! ? before a space, or at a |.
  const scan = (parts, negatedAll, dontCols, row = false) => {
    let text = '';
    const starts = [];
    for (const p of parts) {
      if (text) text += ' ';
      starts.push({ at: text.length, line: p.line });
      text += p.text;
    }
    const lineAt = (at) => { let n = starts[0].line; for (const s of starts) if (s.at <= at) n = s.line; return n; };
    const blank = (s, i, len) => s.slice(0, i) + ' '.repeat(len) + s.slice(i + len);
    const toks = [];
    let mask = text;
    for (const m of text.matchAll(/\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
      toks.push({ t: m[1], at: m.index + m[0].indexOf(m[1]) });
      mask = blank(mask, m.index, m[0].length);
    }
    for (const m of mask.matchAll(/`([^`]+)`/g)) {
      toks.push({ t: m[1], at: m.index + 1, code: true });
      mask = blank(mask, m.index, m[0].length);
    }
    for (const m of mask.matchAll(/(?:^|[\s(["'])((?:[A-Za-z]:)?[\w.@~-]*[\\/][\w.@[\]\\/-]+)/g)) toks.push({ t: m[1], at: m.index + m[0].length - m[1].length });
    for (const tok of toks) {
      const p = acceptPath(tok.t, topDirs, home);
      const name = !p && tok.code ? nameOf(tok.t) : null;
      if ((!p && !name) || negatedAll) continue;
      let start = 0;
      let end = text.length;
      for (const m of text.matchAll(/[.!?](?=\s)|\|/g)) {
        if (m.index < tok.at) start = m.index + 1; else if (m.index >= tok.at + tok.t.length - 1) { end = m.index; break; }
      }
      // Table cells are numbered like the header's: the first cell after the leading "|" is 0.
      if (dontCols && dontCols.has((text.slice(0, tok.at).match(/\|/g) || []).length - 1)) continue;
      // Negated if a negation sits in the same sentence; in a table row, anywhere on the row ("| x.ts | Does not exist |").
      // Prose keeps to the sentence, so "There is no a.ts. It lives in b.ts." still checks b.ts.
      const context = row ? text : text.slice(start, end);
      const rel = tok.at - (row ? 0 : start);
      const around = context.slice(0, rel) + ' ' + context.slice(rel + tok.t.length);
      if (NEG_RE.test(around)) continue;
      if (name) record(`\`${name}`, lineAt(tok.at), false, name); else record(p, lineAt(tok.at), GIT_TALK_RE.test(around));
    }
  };

  const lines = text.split(/\r?\n/);
  let fence = false;
  let dont = false;
  let dontCols = null;
  let para = null;
  const flush = () => { if (para) scan(para.parts, para.negated, null); para = null; };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const n = i + 1;
    if (FENCE_RE.test(line)) { flush(); fence = !fence; return; }
    if (fence) return;
    if (!line.trim()) { flush(); dontCols = null; return; }
    if (/^\s*\|/.test(line)) {
      flush();
      if (TABLE_SEP_RE.test(line)) return;
      if (TABLE_SEP_RE.test(lines[i + 1] || '')) { // header row: which columns are the "Don't" side
        dontCols = new Set(line.split('|').slice(1).map((c, k) => (DONT_RE.test(c) || STALE_COL_RE.test(c) ? k : -1)).filter((k) => k >= 0));
        return;
      }
      scan([{ line: n, text: line }], dont || /^\s*\|\s*(?:❌|✗|✘|🚫)/.test(line), dontCols, true);
      return;
    }
    dontCols = null;
    const trimmed = line.trim();
    const heading = /^#{1,6}\s/.test(trimmed);
    const label = heading || (trimmed.length <= 48 && (/:\s*(?:\*\*|__)?$/.test(trimmed) || /^(?:\*\*|__).+(?:\*\*|__):?$/.test(trimmed)));
    if (label) {
      flush();
      if (DONT_RE.test(trimmed)) dont = true; else if (heading || DO_RE.test(trimmed)) dont = false;
      scan([{ line: n, text: line }], dont, null);
      return;
    }
    if (ITEM_RE.test(line) || !para) {
      flush();
      para = { parts: [], negated: dont || /^\s*(?:[-*+]|\d+[.)])?\s*(?:❌|✗|✘|🚫)/.test(line) };
    }
    para.parts.push({ line: n, text: line });
  });
  flush();
  return [...found.values()]
    .map((c) => ({ path: c.path, name: c.name, lines: [...c.lines].sort((a, b) => a - b), gitTalk: c.gitTalk }))
    .sort((a, b) => a.lines[0] - b.lines[0] || a.path.localeCompare(b.path));
}

// The nearest folder at or above a file that is a git repository root, else the file's folder.
function gitRootOf(file) {
  const dir = path.dirname(file);
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return dir;
  }
}

// Does a git file list hold this path, either exactly or as the end of a longer path? Notes often cite paths
// relative to a src/ folder or a subproject, such as "middleware/auth.ts" for "backend/src/middleware/auth.ts".
function listed(listing, rel) {
  const vs = EXT.test(rel) ? [rel] : GUESS_EXT.map((x) => rel + x);
  if (vs.some((v) => listing.files.has(v)) || listing.dirs.has(rel)) return true;
  for (const v of vs) for (const f of listing.byBase.get(v.slice(v.lastIndexOf('/') + 1)) || []) if (f.endsWith('/' + v)) return true;
  if (!EXT.test(rel)) for (const d of listing.dirs) if (d.endsWith('/' + rel)) return true;
  return false;
}

function gitRead(cwd, args) {
  if (!GIT_READ.has(args[0])) throw new Error('memory.js only runs read-only git commands');
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 4000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? null : out));
  });
}

const gitCache = new Map();
async function gitListing(dir) {
  const hit = gitCache.get(keyOf(dir));
  if (hit && Date.now() - hit.at < GIT_TTL_MS) return hit;
  const files = async (ref) => {
    const out = await gitRead(dir, ['ls-tree', '-r', '--name-only', '-z', ref]);
    if (out === null) return null;
    const list = out.split('\0').filter(Boolean);
    const dirs = new Set();
    const byBase = new Map();
    for (const f of list) {
      for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
      const b = f.slice(f.lastIndexOf('/') + 1);
      if (!byBase.has(b)) byBase.set(b, []);
      byBase.get(b).push(f);
    }
    return { files: new Set(list), dirs, byBase };
  };
  const head = await files('HEAD');
  let def = null;
  let ref = null;
  if (head) {
    for (const r of ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master']) {
      def = await files(r);
      if (def) { ref = r; break; }
    }
  }
  const res = { at: Date.now(), head, def, ref };
  gitCache.set(keyOf(dir), res);
  return res;
}

// A citing file's workspace: its git root, every git repository up to two levels inside it (backend/,
// frontend/, ...), and the src/ folder of each. Paths are looked up in all of them.
async function workspace(base, cache) {
  const k = keyOf(base);
  if (cache.has(k)) return cache.get(k);
  const repos = [];
  const visit = async (dir, depth) => {
    if (await exists(path.join(dir, '.git'))) repos.push({ dir, rel: slash(path.relative(base, dir)), listing: await gitListing(dir) });
    if (depth >= 2) return;
    for (const e of await entries(dir)) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) await visit(path.join(dir, e.name), depth + 1);
    }
  };
  await visit(base, 0);
  const roots = [base, ...repos.map((r) => r.dir).filter((d) => keyOf(d) !== k)];
  const dirs = [...roots];
  for (const d of roots) if (await exists(path.join(d, 'src'))) dirs.push(path.join(d, 'src'));
  const topDirs = new Set();
  for (const d of dirs) for (const e of await entries(d)) if (e.isDirectory()) topDirs.add(e.name);
  const branches = new Set();
  for (const r of repos) for (const b of await branchNames(r.dir)) branches.add(b);
  const namespaces = new Set([...branches].filter((b) => b.includes('/')).map((b) => b.split('/')[0]));
  const ws = { base, repos, dirs, topDirs, branches, namespaces };
  cache.set(k, ws);
  return ws;
}

// Branch names (local and remote) read from .git as plain files: "test/integration-harness" may be a branch, not a folder.
async function branchNames(repoDir) {
  const gitDir = path.join(repoDir, '.git');
  const names = new Set();
  const walk = async (dir, prefix) => {
    for (const e of await entries(dir)) {
      if (e.isDirectory()) await walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else names.add(prefix + e.name);
    }
  };
  await walk(path.join(gitDir, 'refs', 'heads'), '');
  for (const e of await entries(path.join(gitDir, 'refs', 'remotes'))) if (e.isDirectory()) await walk(path.join(gitDir, 'refs', 'remotes', e.name), '');
  for (const m of ((await readText(path.join(gitDir, 'packed-refs'))) || '').matchAll(/ refs\/(?:heads|remotes\/[^/\s]+)\/(\S+)/g)) names.add(m[1]);
  names.delete('HEAD');
  return names;
}

// Where a cited path is: in the working tree and/or on the default branch, anywhere in the workspace.
// Not found there but a file with the same name exists elsewhere: "moved" candidates, a low-confidence guess.
async function locate(ws, p, fileDir) {
  if (/^[A-Za-z]:\//.test(p) || p.startsWith('/')) {
    const ok = await exists(p);
    return { working: ok, branch: null, found: ok, moved: [] };
  }
  const rel = p.startsWith('@/') ? 'src/' + p.slice(2) : p;
  const variants = EXT.test(rel) ? [rel] : GUESS_EXT.map((x) => rel + x);
  let working = false;
  for (const d of [fileDir, ...ws.dirs]) {
    for (const v of variants) if (!working && (await exists(path.join(d, v)))) working = true;
  }
  let branch = ws.repos.length ? false : null;
  for (const r of ws.repos) {
    // A path that starts with a repository's folder ("backend/src/...") is that repository's "src/...".
    const forms = r.rel && rel.startsWith(r.rel + '/') ? [rel.slice(r.rel.length + 1), rel] : [rel];
    if (!working && r.listing.head && forms.some((f) => listed(r.listing.head, f))) working = true; // tracked files stand in for a search of the working tree
    if (r.listing.def && forms.some((f) => listed(r.listing.def, f))) branch = true;
  }
  const found = working || branch === true;
  let moved = [];
  if (!found) {
    // Same file name elsewhere; an extensionless import such as "@/core/utils/shortDate" tries the usual extensions.
    const last = rel.slice(rel.lastIndexOf('/') + 1);
    const names = EXT.test(rel) ? [last] : ['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((x) => last + x);
    const hits = new Set();
    for (const r of ws.repos) {
      for (const l of [r.listing.def, r.listing.head]) for (const n of names) for (const f of l?.byBase.get(n) || []) hits.add((r.rel ? r.rel + '/' : '') + f);
    }
    moved = [...hits].slice(0, 3);
  }
  if (!found && !ws.repos.length && !p.includes('/')) working = null; // a bare filename can't be located without git
  return { working, branch, found, moved };
}

async function checkCitations(ctx, sources) {
  const { home, add, display } = ctx;
  const cache = new Map();
  const lines = (c) => `line${c.lines.length > 1 ? 's' : ''} ${c.lines.join(', ')}`;
  const where = (list) => list.map((c) => `- ${c.path} (${lines(c)})${c.to?.length ? `, maybe now ${c.to.join(' or ')}` : ''}`).join('\n');
  const named = []; // { owner, names }: code names each file mentions, checked together below
  for (const { owner, text, base, fileDir } of sources) {
    const ws = await workspace(base, cache);
    const scope = display(base) === '.' ? 'this project' : display(base);
    const missing = [];
    const moved = [];
    const names = [];
    owner.cites = [];
    for (const c of citations(text, ws.topDirs, home)) {
      if (c.name) { names.push(c); continue; }
      // A branch name, not a folder: an existing branch, or a branch-namespace name in a sentence about git.
      if (!EXT.test(c.path) && (ws.branches.has(c.path) || (c.gitTalk && ws.namespaces.has(c.path.split('/')[0])))) continue;
      const s = await locate(ws, c.path, fileDir);
      owner.cites.push({ path: c.path, lines: c.lines, working: s.working, branch: s.branch, moved: s.moved });
      if (s.found || s.working === null) continue;
      (s.moved.length ? moved : missing).push({ path: c.path, lines: c.lines, to: s.moved });
    }
    if (missing.length) {
      add('warning', 'cited_file_missing', owner.display, { count: missing.length, cited: missing.slice(0, 3).map((m) => m.path).join(', '), items: missing },
        `${owner.display} cites ${missing.length === 1 ? 'a path' : `${missing.length} paths`} that exist nowhere in ${scope}, neither in the working tree nor on the default branch:\n${where(missing)}\n` +
        'For each one, find where the code lives now and update the path, or rewrite the passage if the code was removed on purpose.');
    }
    if (moved.length) {
      add('suggestion', 'possibly_moved', owner.display, { count: moved.length, cited: moved[0].path, items: moved },
        `${owner.display} cites ${moved.length === 1 ? 'a path that is' : `${moved.length} paths that are`} not where it says, but a file with the same name exists elsewhere in ${scope}:\n${where(moved)}\n` +
        'This is a low-confidence guess from file names. Check whether each is the same file and, if so, update the path.');
    }
    if (names.length) named.push({ owner, names });
  }
  // Names no code file has anymore although git shows them in the code before (codeNames comes from the code map).
  // A name that was never in the code is planned work or not code: left out.
  if (ctx.codeNames && named.length) {
    const gone = await ctx.codeNames([...new Set(named.flatMap((x) => x.names.map((c) => c.name)))]);
    for (const { owner, names } of named) {
      const stale = names.filter((c) => gone.has(c.name)).map((c) => ({ ...c, ...gone.get(c.name) }));
      if (!stale.length) continue;
      // A suggestion, not a warning: notes about a fixed bug name the removed code on purpose.
      add('suggestion', 'stale_name', owner.display, { count: stale.length, cited: stale.slice(0, 3).map((c) => c.name).join(', '), items: stale.map((c) => ({ path: c.name, lines: c.lines, date: c.date })) },
        `${owner.display} names ${stale.length === 1 ? 'something' : `${stale.length} things`} no code file in this project has anymore, though git shows ${stale.length === 1 ? 'it' : 'each'} in the code before:\n` +
        stale.map((c) => `- \`${c.name}\` (${lines(c)}), last changed in ${c.commit} on ${c.date}: "${c.subject}"`).join('\n') + '\n' +
        'If the passage tells the history on purpose (a fixed bug, a removed feature), leave it. Otherwise find what replaced each one (git show <commit> helps) and update the passage.');
    }
  }
  const mine = await workspace(ctx.root, cache);
  return mine.repos.map((r) => ({ repo: r.rel || '.', ref: r.listing.ref }));
}

// ---- package scripts -----------------------------------------------------------------------------------------

const RUN_RE = /\b(npm|bun|pnpm|yarn)\s+run\s+([\w:.-]+)(?=$|[\s`'")|;&,])/g;

// "npm run x" (or bun, pnpm, yarn) in instruction files, notes and READMEs when no package.json of the project has
// a script x. Code blocks count: that is where commands usually are. bun and yarn also run installed binaries
// ("bun run tsc") and files ("bun run index.ts"): those are not scripts.
// ponytail: package.json at the root and in each nested repo; a monorepo with "workspaces" is skipped whole.
async function checkScripts(ctx, sources) {
  const ws = await workspace(ctx.root, new Map());
  const dirs = [ctx.root, ...ws.repos.map((r) => r.dir).filter((d) => keyOf(d) !== keyOf(ctx.root))];
  const scripts = new Set();
  let packages = 0;
  for (const d of dirs) {
    const text = await readText(path.join(d, 'package.json'));
    if (text === null) continue;
    let pkg;
    try { pkg = JSON.parse(text); } catch { return; }
    if (pkg.workspaces) return;
    packages++;
    for (const k of Object.keys(pkg.scripts || {})) scripts.add(k);
  }
  if (!packages) return;
  const bins = new Set();
  for (const d of dirs) for (const e of await entries(path.join(d, 'node_modules', '.bin'))) bins.add(e.name.replace(/\.(?:exe|cmd|ps1|bunx)$/i, ''));
  const readmes = [];
  for (const d of dirs) {
    const file = path.join(d, 'README.md'), text = await readText(file);
    if (text !== null) readmes.push({ owner: { display: ctx.display(file) }, text });
  }
  for (const { owner, text } of [...sources, ...readmes]) {
    const missing = new Map();
    text.split(/\r?\n/).forEach((l, i) => {
      for (const [cmd, tool, s] of l.matchAll(RUN_RE)) {
        if (scripts.has(s) || ((tool === 'bun' || tool === 'yarn') && (s.includes('.') || bins.has(s)))) continue;
        if (!missing.has(s)) missing.set(s, { path: cmd, lines: [] });
        if (!missing.get(s).lines.includes(i + 1)) missing.get(s).lines.push(i + 1);
      }
    });
    if (!missing.size) continue;
    const items = [...missing.values()];
    ctx.add('warning', 'missing_script', owner.display, { count: items.length, cited: items[0].path, items },
      `${owner.display} runs ${items.length === 1 ? 'a script' : `${items.length} scripts`} that no package.json in this project has:\n` +
      items.map((c) => `- ${c.path} (line${c.lines.length > 1 ? 's' : ''} ${c.lines.join(', ')})`).join('\n') + '\n' +
      'For each one, find the script in package.json that does this now and update the command, or remove it if the script is gone.');
  }
}

// ---- reading history and overlaps ----------------------------------------------------------------------------

function lastReads(ctx, notes, reads, now) {
  const days = reads ? Math.floor((now - reads.since) / 86_400_000) : 0;
  const mine = keyOf(ctx.root);
  const last = new Map();
  for (const r of reads?.items || []) {
    if (!r.root || keyOf(r.root) !== mine) continue;
    const k = keyOf(r.path);
    if ((last.get(k) || 0) < r.ts) last.set(k, r.ts);
  }
  for (const n of notes) n.lastRead = last.get(keyOf(n.path)) || null;
  if (!notes.length) return;
  if (days < NEVER_READ_DAYS) {
    ctx.add('info', 'reads_window', null, { days, need: NEVER_READ_DAYS }, null);
    return;
  }
  for (const n of notes) {
    if (n.lastRead) continue;
    ctx.add('suggestion', 'never_read', n.display, { days },
      `No ${path.basename(ctx.root)} session opened ${n.display} in the last ${days} days. Check whether it is still useful: delete it if not, or improve its MEMORY.md line so Claude recognizes when it is relevant.`);
  }
}

function overlaps(ctx, notes) {
  // ponytail: plural trim instead of real stemming; enough to pair "date"/"dates" in English and Spanish.
  const words = (s) => new Set((s.toLowerCase().match(/\p{L}[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/s$/, '') : w)));
  const prepared = notes.map((n) => ({ n, w: words(`${n.name.replace(/[-_]/g, ' ')} ${n.title} ${n.description}`), cites: new Set((n.cites || []).map((c) => c.path)) }));
  const pairs = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.n.linksOut.includes(b.n.display) || b.n.linksOut.includes(a.n.display)) continue;
      let common = 0;
      for (const w of a.w) if (b.w.has(w)) common++;
      const jac = common / (a.w.size + b.w.size - common || 1);
      let shared = 0;
      for (const c of a.cites) if (b.cites.has(c)) shared++;
      if (jac >= 0.3 || (shared >= 2 && jac >= 0.15)) pairs.push({ a: a.n, b: b.n, score: jac + shared * 0.05 });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  for (const { a, b } of pairs.slice(0, 10)) {
    ctx.add('suggestion', 'possible_overlap', a.display, { a: a.display, b: b.display },
      `${a.display} and ${b.display} may cover the same topic (a low-confidence guess from their names, descriptions and cited files). ` +
      'Compare them: merge them into one note if they repeat each other, or add a [[link]] between them if both are needed.');
  }
}
