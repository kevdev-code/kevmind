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
const keyOf = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
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
export async function scanProject(root, { home = os.homedir(), now = Date.now(), reads = null, loaded = [] } = {}) {
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
  const ctx = { root, home, display, problems, add: (tier, code, file, params, fix) => problems.push({ tier, code, file, params, fix }) };

  const instructions = await scanInstructions(ctx, loaded);
  const memory = await scanAutoMemory(ctx);
  const serena = await scanSerena(ctx);
  linkNotes(ctx, memory.notes, serena.notes);

  const sources = [
    ...instructions.filter((i) => i.scope !== 'worktree').map((i) => ({ owner: i, text: i.text })),
    ...memory.notes.map((n) => ({ owner: n, text: n.text })),
    ...serena.notes.map((n) => ({ owner: n, text: n.text })),
  ];
  const git = await checkCitations(ctx, sources);
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
  const { root, home, display, add } = ctx;
  const list = [];
  const byKey = new Map();
  const take = async (file, scope, load, importedBy = null) => {
    const k = keyOf(file);
    if (byKey.has(k)) return null;
    const text = await readText(file);
    if (text === null) return null;
    const item = {
      path: file, display: display(file), scope, load, importedBy,
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
        add('problem', 'broken_import', item.display, { target: ref },
          `In ${item.display}, the import @${ref} points to a file that does not exist (${display(target)}). Fix the path or remove the import.`);
        continue;
      }
      if (depth >= IMPORT_HOPS) continue;
      const added = await take(target, 'import', item.load, item.display);
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

function citedPaths(text, topDirs, home) {
  const raw = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) raw.push(m[1]);
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const m of prose.matchAll(/(?:^|[\s(["'])((?:[A-Za-z]:)?[\w.@~-]*[\\/][\w.@[\]\\/-]+)/g)) raw.push(m[1]);
  const out = new Set();
  for (let t of raw) {
    t = t.trim().replace(/^[[('"]+/, '').replace(/[\]'"),.;:!?]+$/, '').replace(/:\d+(?::\d+)?$/, '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!t || t.length > 200 || /\s|:\/\/|[*{}<>$|]/.test(t) || t.includes('node_modules')) continue;
    if (/^@[^/]/.test(t) || t === '@') continue; // an @import (checked on its own) or an npm scope, not a cited file
    if (t.startsWith('/') && !t.startsWith(slash(home))) continue; // a URL path such as /api/x, not a file on disk
    if (t.startsWith('./')) t = t.slice(2);
    if (t.startsWith('~/')) t = slash(path.join(home, t.slice(2)));
    const segs = t.split('/');
    const base = segs[segs.length - 1];
    const hasExt = EXT.test(t) && base.replace(EXT, '').length > 0;
    if (hasExt && base.startsWith('.')) continue;                          // ".d.ts", ".eslintrc.json": an extension or a dotfile
    if (/(^|[-_])(x|xx|foo|bar|example)(\.|$)/i.test(base)) continue;       // placeholders such as x.test.ts
    if (!hasExt && segs.every((s) => topDirs.has(s))) continue;            // prose such as "backend/frontend"
    const abs = /^[A-Za-z]:\//.test(t) || t.startsWith('/');
    if (abs ? hasExt : hasExt || (t.startsWith('@/') && t.length > 2) || (t.includes('/') && topDirs.has(segs[0]))) out.add(t);
  }
  return [...out];
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

// Each cited path is checked in the working tree and on the default branch of the project's repositories
// (the root plus any direct subfolder that is its own git repository).
async function checkCitations(ctx, sources) {
  const { root, home, add } = ctx;
  const repos = [root];
  for (const e of await entries(root)) if (e.isDirectory() && (await exists(path.join(root, e.name, '.git')))) repos.push(path.join(root, e.name));
  const listings = new Map();
  const topDirs = new Set();
  for (const r of repos) {
    for (const e of await entries(r)) if (e.isDirectory()) topDirs.add(e.name);
    if (await exists(path.join(r, '.git'))) listings.set(r, await gitListing(r));
  }
  const status = new Map();
  const check = async (p) => {
    if (status.has(p)) return status.get(p);
    let working = false;
    let branch = listings.size ? false : null;
    if (/^[A-Za-z]:\//.test(p) || p.startsWith('/')) {
      working = await exists(p);
      branch = null;
    } else {
      const rel = p.startsWith('@/') ? 'src/' + p.slice(2) : p;
      const variants = EXT.test(rel) ? [rel] : GUESS_EXT.map((x) => rel + x);
      for (const r of repos) for (const v of variants) if (!working && (await exists(path.join(r, v)))) working = true;
      for (const [r, l] of listings) {
        // A path that starts with a subproject's folder ("backend/src/...") is that repository's "src/...".
        const name = path.basename(r);
        const forms = r !== root && rel.startsWith(name + '/') ? [rel.slice(name.length + 1), rel] : [rel];
        if (!working && l.head && forms.some((f) => listed(l.head, f))) working = true; // tracked files stand in for a search of the working tree
        if (l.def && forms.some((f) => listed(l.def, f))) branch = true;
      }
      if (!working && !listings.size && !p.includes('/')) working = null; // a bare filename can't be located without git
    }
    const s = { working, branch };
    status.set(p, s);
    return s;
  };

  for (const { owner, text } of sources) {
    const missing = [];
    owner.cites = [];
    for (const p of citedPaths(text, topDirs, home)) {
      const s = await check(p);
      owner.cites.push({ path: p, ...s });
      if (s.working === false && s.branch !== true) missing.push(p);
    }
    if (missing.length) {
      const list = missing.slice(0, 8).join(', ') + (missing.length > 8 ? `, and ${missing.length - 8} more` : '');
      add('warning', 'cited_file_missing', owner.display, { count: missing.length, cited: missing.slice(0, 3).join(', ') },
        `${owner.display} cites ${missing.length === 1 ? 'a file that no longer exists' : `${missing.length} files that no longer exist`} in the working tree or on the default branch: ${list}. ` +
        'For each one, find where the code lives now and update the path, or rewrite the passage if the code was removed on purpose.');
    }
  }
  return [...listings].map(([dir, l]) => ({ repo: ctx.display(dir), ref: l.ref }));
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
