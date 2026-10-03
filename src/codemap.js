// The code map behind the project map (src/tree.js) and the docs ↔ code checks: what a project's code files export,
// the files the project depends on most, and its areas (folders). Built from import and export statements and the
// names they carry: imports are resolved by src/imports.js (aliases, barrels, nested repos), exported names are read
// by regex (JavaScript and TypeScript, Dart). Approximate on purpose: it never type-checks, resolves members or edits
// anything; exact references stay with Serena or another language server. Read-only; git only `ls-files` and `log`.
// Each file is read again only when its size or modification time changed.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { importScanner, LANGUAGES } from './imports.js';

export const MAP = {
  maxFiles: 5000,     // per repo; past this, the most recently changed are kept
  maxBytes: 512 * 1024, // bigger is a bundle or generated code
  hubShare: 0.97,     // a file imported by more files than this share of the others is shared infrastructure...
  hubMin: 8,          // ...and by at least this many
  areaMax: 40,        // a folder with more code files below it is split into its subfolders...
  areaMinSub: 6,      // ...except subfolders smaller than this, which stay with it
};

const CODE_EXT = new Set(Object.values(LANGUAGES).flatMap((l) => l.ext));
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.dart_tool|\.next|\.nuxt|generated|__generated__|graphify-out)\//;
const WIN = process.platform === 'win32';
const fold = (s) => (WIN ? s.toLowerCase() : s);
const slash = (p) => p.split(path.sep).join('/');

const GIT_MAP = new Set(['ls-files', 'log']); // read-only: the file list, and `log -S` for names the docs still mention
function gitRead(cwd, args) {
  if (!GIT_MAP.has(args[0])) throw new Error(`git ${args[0]} is not allowed here`);
  return new Promise((resolve) => execFile('git', args, { cwd, timeout: 5000, windowsHide: true, maxBuffer: 32 << 20 }, (err, out) => resolve(err ? null : String(out))));
}

// ---- exported names --------------------------------------------------------------------------------------------
const JS_DECL = /^[ \t]*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
const JS_LIST = /^[ \t]*export\s*(type\s*)?\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?/gm;
const JS_DEFAULT_ID = /^[ \t]*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm;
const JS_STAR = /^[ \t]*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"]/gm;
const CJS = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=|module\.exports\s*=\s*\{([^}]*)\}/g;
const DART_TYPE = /^(?:(?:abstract|sealed|base|final|interface|mixin)\s+)*(?:class|mixin|enum|extension|typedef)\s+([A-Za-z]\w*)/gm;
const DART_FN = /^(?!(?:import|export|part|library|return|if|for|while|switch|class|enum|typedef|extension|mixin|abstract|sealed|base|final|const|var|late|static|external|@)\b)(?:[A-Za-z_][\w<>?,. \[\]]*\s+)?([a-z][\w]*)\s*(?:<[^>]*>)?\s*\(/gm;
const DART_VAR = /^(?:final|const|var|late(?:\s+final)?)\s+(?:[A-Za-z_][\w<>?,. ]*\s+)?([a-zA-Z]\w*)\s*=/gm;

// { names: [exported names], barrel: re-exports what other files export }
export function exportsOf(text, ext) {
  const names = new Set();
  let barrel = false;
  if (ext === '.dart') {
    for (const re of [DART_TYPE, DART_FN, DART_VAR]) for (const m of text.matchAll(re)) if (!m[1].startsWith('_')) names.add(m[1]);
    barrel = /^export\s+['"]/m.test(text);
    return { names: [...names], barrel };
  }
  if (!LANGUAGES.js.ext.includes(ext)) return { names: [], barrel: false };
  for (const m of text.matchAll(JS_DECL)) names.add(m[1]);
  for (const m of text.matchAll(JS_LIST)) {
    if (m[3]) barrel = true;
    for (const part of m[2].split(',')) {
      const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default') names.add(n);
    }
  }
  for (const m of text.matchAll(JS_DEFAULT_ID)) names.add(m[1]);
  for (const m of text.matchAll(JS_STAR)) { barrel = true; if (m[1]) names.add(m[1]); }
  for (const m of text.matchAll(CJS)) {
    if (m[1]) names.add(m[1]);
    else for (const part of m[2].split(',')) { const n = part.trim().split(':')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); }
  }
  return { names: [...names], barrel };
}
const identsOf = (text) => new Set(text.match(/[A-Za-z_$][\w$]*/g) || []);

// ---- files -----------------------------------------------------------------------------------------------------
// The project's repos: its root and git repos nested in it (frontend/, backend/), one or two folders deep.
export function reposOf(root) {
  const out = [{ dir: root, pre: '' }];
  const look = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ents) {
      if (!d.isDirectory() || d.name.startsWith('.') || /^(node_modules|vendor|dist|build)$/.test(d.name)) continue;
      const sub = path.join(dir, d.name);
      if (fs.existsSync(path.join(sub, '.git'))) out.push({ dir: sub, pre: `${slash(path.relative(root, sub))}/` });
      else if (depth < 2) look(sub, depth + 1);
    }
  };
  look(root, 1);
  return out;
}
async function codeFiles(repo) {
  const listed = await gitRead(repo.dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  let rels = listed ? listed.split('\0').filter(Boolean) : null;
  if (!rels) { // not a git repo: walk it
    rels = [];
    const walk = (dir) => {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        if (rels.length > MAP.maxFiles * 2) return;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) { if (!d.name.startsWith('.') && !SKIP_DIR.test(`/${d.name}/`)) walk(full); } else rels.push(slash(path.relative(repo.dir, full)));
      }
    };
    walk(repo.dir);
  }
  return rels.filter((f) => CODE_EXT.has(path.extname(f).toLowerCase()) && !/\.d\.ts$/.test(f) && !SKIP_DIR.test(`/${f}`));
}

// ---- the map ---------------------------------------------------------------------------------------------------
// A builder that remembers each file's names between builds; build(root) returns the map of that project.
export function codeMapper() {
  const scan = importScanner();
  const cache = new Map(); // folded path -> { version, ext, names, barrel, idents }
  return async function build(root) {
    const t0 = Date.now();
    const repos = reposOf(root);
    const files = []; // { abs, rel (from root), repo }
    for (const repo of repos) {
      let list = (await codeFiles(repo)).map((f) => ({ abs: path.join(repo.dir, f), rel: repo.pre + f, repo }));
      if (list.length > MAP.maxFiles) list = list.map((x) => { try { x.m = fs.statSync(x.abs).mtimeMs; } catch { x.m = 0; } return x; }).sort((a, b) => b.m - a.m).slice(0, MAP.maxFiles);
      files.push(...list);
    }
    // Nested repos also show up in their parent's untracked files: each file once, in its own repo.
    const seen = new Set(), N = [];
    for (const f of files.sort((a, b) => b.repo.pre.length - a.repo.pre.length)) { const k = fold(f.abs); if (!seen.has(k)) { seen.add(k); N.push(f); } }
    N.sort((a, b) => a.rel.localeCompare(b.rel));
    const idx = new Map(N.map((f, i) => [fold(f.abs), i]));
    const live = new Set();
    const info = N.map((f) => {
      const k = fold(f.abs);
      live.add(k);
      let st = null;
      try { st = fs.statSync(f.abs); } catch { /* gone */ }
      const version = st ? `${st.mtimeMs}:${st.size}` : 'gone';
      let hit = cache.get(k);
      if (!hit || hit.version !== version) {
        let text = '';
        if (st && st.size <= MAP.maxBytes) try { text = fs.readFileSync(f.abs, 'utf8'); } catch { /* unreadable */ }
        hit = { version, ...exportsOf(text, path.extname(f.abs).toLowerCase()), idents: identsOf(text) };
        cache.set(k, hit);
      }
      return hit;
    });
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    const imports = N.map(() => new Set()), importers = N.map(() => new Set());
    for (const [a, b] of await scan(N.map((f) => ({ file: f.abs, root: f.repo.dir })))) {
      const i = idx.get(fold(path.resolve(a))), j = idx.get(fold(path.resolve(b))); // the resolver may write paths its own way
      if (i == null || j == null || i === j) continue;
      imports[i].add(j); importers[j].add(i);
    }
    const map = { root, repos: repos.length, repoDirs: repos.map((r) => r.dir), files: N.map((f) => f.rel), info, imports, importers, at: Date.now() };
    rank(map);
    areas(map);
    map.ms = Date.now() - t0;
    return map;
  };
}

// Key files: PageRank over the imports (an importer passes its weight to what it imports). Files imported by more than
// almost all others are shared infrastructure (a UI kit, utils, query keys): named as such, apart from key files.
function rank(map) {
  const n = map.files.length;
  let pr = new Float64Array(n).fill(1 / Math.max(1, n));
  for (let r = 0; r < 30; r++) {
    const next = new Float64Array(n).fill(0.15 / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!map.imports[i].size) { dangling += pr[i]; continue; }
      for (const j of map.imports[i]) next[j] += (0.85 * pr[i]) / map.imports[i].size;
    }
    for (let i = 0; i < n; i++) next[i] += (0.85 * dangling) / n;
    pr = next;
  }
  map.pr = pr;
  const fanIns = map.importers.map((s) => s.size).sort((a, b) => a - b);
  map.hubAt = Math.max(MAP.hubMin, fanIns[Math.floor(fanIns.length * MAP.hubShare)] || 0);
  map.hub = map.importers.map((s) => s.size >= map.hubAt);
}

// Areas: folders. A folder with more than MAP.areaMax code files below it is split into its subfolders; a subfolder
// with fewer than MAP.areaMinSub files stays with its parent, whose own files then form an area named after it. Every
// file is in exactly one area, named by its path ('.' for the project's own top-level files). Folders, unlike import
// clusters, stay put when the code changes and are what notes talk about; imports still say which areas use which.
function areas(map) {
  const out = [];
  const split = (prefix, ids) => {
    const sub = new Map(), here = [];
    for (const i of ids) {
      const rest = map.files[i].slice(prefix.length).split('/');
      if (rest.length === 1) here.push(i); else (sub.get(rest[0]) || sub.set(rest[0], []).get(rest[0])).push(i);
    }
    for (const [d, s] of [...sub]) if (s.length < MAP.areaMinSub) { here.push(...s); sub.delete(d); }
    const name = prefix.replace(/\/$/, '') || '.';
    if (ids.length <= MAP.areaMax || !sub.size) { out.push({ name, files: ids }); return; }
    if (here.length) out.push({ name, files: here });
    for (const [d, s] of sub) split(`${prefix}${d}/`, s);
  };
  split('', map.files.map((f, i) => i));
  map.areas = out.map(({ name, files }) => {
    const set = new Set(files);
    let inside = 0, outside = 0;
    for (const i of files) for (const j of map.imports[i]) set.has(j) ? inside++ : outside++;
    const top = [...files].sort((a, b) => map.pr[b] - map.pr[a]).slice(0, 3);
    return { name, folder: name === '.' ? '' : name, files, inside, outside, top };
  }).sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  map.areaOf = new Map();
  map.areas.forEach((a, k) => { for (const i of a.files) map.areaOf.set(i, k); });
}

// ---- questions -------------------------------------------------------------------------------------------------
// What area k leans on and who leans on it, the top 3 of each with import counts: shared infrastructure it imports
// ([file, n]), other areas it imports from and areas that import it ([area, n]).
export function areaLinks(map, k) {
  const set = new Set(map.areas[k].files), shared = new Map(), dependsOn = new Map(), usedBy = new Map();
  const bump = (m, x) => m.set(x, (m.get(x) || 0) + 1);
  for (const i of set) {
    for (const j of map.imports[i]) {
      if (set.has(j)) continue;
      if (map.hub[j]) bump(shared, j);
      else if (map.areaOf.has(j)) bump(dependsOn, map.areaOf.get(j));
    }
    for (const j of map.importers[i]) if (!set.has(j) && map.areaOf.has(j) && map.areaOf.get(j) !== k) bump(usedBy, map.areaOf.get(j));
  }
  const top = (m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, 3);
  return { shared: top(shared), dependsOn: top(dependsOn), usedBy: top(usedBy) };
}

// Key files: the most depended-on files that are not shared infrastructure (PageRank), and the shared ones by importers.
export function keyFiles(map, n = 3) {
  const all = map.files.map((f, i) => i);
  return {
    key: all.filter((i) => !map.hub[i]).sort((x, y) => map.pr[y] - map.pr[x]).slice(0, n),
    hubs: all.filter((i) => map.hub[i]).sort((x, y) => map.importers[y].size - map.importers[x].size).slice(0, n),
  };
}

// A file by path (relative to the project or absolute), or undefined.
export function fileIndex(map, p) {
  if (p == null) return undefined;
  const rel = slash(path.isAbsolute(String(p)) ? path.relative(map.root, String(p)) : String(p)).replace(/^\.\//, '');
  const k = fold(rel);
  const i = map.files.findIndex((f) => fold(f) === k);
  if (i >= 0) return i;
  const ends = map.files.map((f, j) => [f, j]).filter(([f]) => fold(f).endsWith(`/${k}`));
  return ends.length === 1 ? ends[0][1] : undefined; // a bare file name, when only one file has it
}

// Names the docs mention that no code file of the map has, but that git shows in the code before (`log -S`, code files
// only, newest commit that changed how often the name appears): Map name -> { commit, date (local), subject }. A name
// never in the code's history is planned work or not code, and is left out. `log -S` reads the whole history (seconds
// on a big repo), so it runs in the background: whatever isn't known within `budget` ms shows on a later call.
const CODE_GLOBS = [...CODE_EXT].map((x) => `*${x}`);
const PICKAXE_TTL_MS = 10 * 60_000;
const pickaxe = new Map(); // repo|name -> { at, done, hit, running, promise }; the old answer stays while a new one runs
function lookup(dir, n) {
  const k = `${fold(dir)}|${n}`;
  if (!pickaxe.has(k)) pickaxe.set(k, { at: 0, done: false, hit: null, running: false, promise: null });
  const c = pickaxe.get(k);
  if (!c.running && Date.now() - c.at > PICKAXE_TTL_MS) {
    Object.assign(c, { at: Date.now(), running: true });
    c.promise = gitRead(dir, ['log', `-S${n}`, '-1', '--format=%h%x09%ct%x09%s', '--', ...CODE_GLOBS]).then((out) => {
      const [commit, ct, ...subject] = (out || '').trim().split('\t');
      Object.assign(c, { done: true, running: false, hit: commit ? { commit, ts: Number(ct) * 1000, subject: subject.join('\t').slice(0, 80) } : null });
    });
  }
  return c;
}
export async function staleNames(map, names, budget = 1500) {
  const todo = names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !map.info.some((x) => x.idents.has(n)))
    .map((n) => ({ n, looks: map.repoDirs.map((d) => lookup(d, n)) }));
  let timer;
  await Promise.race([
    Promise.all(todo.flatMap((t) => t.looks.map((c) => c.promise))),
    new Promise((r) => { timer = setTimeout(r, budget); }),
  ]);
  clearTimeout(timer);
  const out = new Map();
  for (const { n, looks } of todo) {
    if (!looks.every((c) => c.done)) continue;
    const best = looks.map((c) => c.hit).filter(Boolean).sort((a, b) => b.ts - a.ts)[0];
    if (best) out.set(n, { commit: best.commit, date: new Date(best.ts).toLocaleDateString('en-CA'), subject: best.subject });
  }
  return out;
}
