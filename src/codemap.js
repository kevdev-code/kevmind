// The code map: what a project's code files export and who uses it, the files the project depends on most, and the
// areas of files that work together. Built from import and export statements and the names they carry: imports are
// resolved by src/imports.js (aliases, barrels, nested repos), exported names are read by regex (JavaScript and
// TypeScript, Dart), and a file uses a name when it imports the file that exports it (directly or through one barrel)
// and mentions the name. Approximate on purpose: it never type-checks, resolves members or edits anything; exact
// references stay with Serena or another language server. Read-only; git only `ls-files` and `log`. Each file is
// read again only when its size or modification time changed.
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
const groupBy = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; }; // Map.groupBy needs Node 21

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
    const typeLinks = new Set(), valueLinks = new Set(); // "i>j": i imports only types from j when it is in the first only
    for (const [a, b, typeOnly] of await scan(N.map((f) => ({ file: f.abs, root: f.repo.dir })))) {
      const i = idx.get(fold(path.resolve(a))), j = idx.get(fold(path.resolve(b))); // the resolver may write paths its own way
      if (i == null || j == null || i === j) continue;
      imports[i].add(j); importers[j].add(i);
      (typeOnly ? typeLinks : valueLinks).add(`${i}>${j}`);
    }
    const typesOnly = new Set([...typeLinks].filter((k) => !valueLinks.has(k)));
    const map = { root, repos: repos.length, repoDirs: repos.map((r) => r.dir), files: N.map((f) => f.rel), info, imports, importers, typesOnly, at: Date.now() };
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
// Who uses a name: files that import its file (or a barrel that imports it) and mention it. [{ file, users: [i] }]
export function usesOf(map, name) {
  const out = [];
  map.info.forEach((x, i) => {
    if (!x.names.includes(name)) return;
    const direct = [...map.importers[i]];
    const via = direct.filter((b) => map.info[b].barrel).flatMap((b) => [...map.importers[b]]);
    const users = [...new Set([...direct, ...via])].filter((u) => u !== i && map.info[u].idents.has(name));
    out.push({ file: i, users });
  });
  return out.sort((a, b) => b.users.length - a.users.length);
}

// How file a reaches file b: the shortest chain of imports in either direction, or the files both import.
export function connection(map, a, b) {
  const chain = (from, to) => {
    const prev = new Map([[from, -1]]), q = [from];
    while (q.length) { const i = q.shift(); if (i === to) break; for (const j of map.imports[i]) if (!prev.has(j)) { prev.set(j, i); q.push(j); } }
    if (!prev.has(to)) return null;
    const p = []; for (let i = to; i !== -1; i = prev.get(i)) p.unshift(i);
    return p;
  };
  const ab = chain(a, b);
  if (ab) return { kind: 'imports', path: ab };
  const ba = chain(b, a);
  if (ba) return { kind: 'imported by', path: ba };
  const shared = [...map.imports[a]].filter((j) => map.imports[b].has(j));
  return { kind: shared.length ? 'shared' : 'none', shared };
}

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

// ---- answers (the MCP tool code_map) ---------------------------------------------------------------------------
// Under 200 tokens each (characters / 4), whole lines only; the last line says how far to trust it. hist(key): one
// line of the project's history for a file, or for two files "a|b" (or ''), from the experience aggregate.
const CAP = 800;
const list = (xs, n = 3) => xs.slice(0, n).map((x) => `\`${x}\``).join(', ') + (xs.length > n ? ', …' : '');
const base = (f) => f.split('/').pop();
const TRUST = 'Approximate: from import and export statements and name matches, no type check. Exact references: Serena or a language server.';
function capped(lines, footer) {
  let out = '';
  for (const l of lines) if ((out + l + '\n' + footer).length <= CAP) out += l + '\n';
  return out + footer;
}
const byFolder = (map, ids) => [...groupBy(ids, (i) => map.files[i].split('/').slice(0, -1).join('/') || '.')].sort((a, b) => b[1].length - a[1].length);

// list: true: the complete list behind an answer, LIST_PAGE paths a page (the one answer not held to ~200 tokens).
// name: every file that uses it; file: every file that imports it, then every file it imports; area: every file in it,
// then every file outside it that imports one of them.
// An importer that takes nothing but types from the file (`import type`) is marked "(types only)".
export const LIST_PAGE = 60;
function listAnswer(map, name, args) {
  const typeOnly = (i, j) => map.typesOnly?.has(`${i}>${j}`);
  const mark = (i, j) => `${map.files[i]}${typeOnly(i, j) ? ' (types only)' : ''}`;
  let title, items;
  if (args.name) {
    const found = usesOf(map, String(args.name));
    if (!found.length) return `No data: no code file in ${name} exports \`${args.name}\` (as its import and export statements say).\n${TRUST}`;
    items = found.flatMap((u) => u.users.map((i) => {
      // Through a barrel: types only when the importer takes only types from every barrel it reaches the file through.
      const via = map.importers[u.file].has(i) ? [u.file] : [...map.imports[i]].filter((b) => map.info[b].barrel && map.imports[b].has(u.file));
      const types = via.length && via.every((b) => typeOnly(i, b));
      return `${map.files[i]}${types ? ' (types only)' : ''}${found.length > 1 ? ` (from \`${map.files[u.file]}\`)` : ''}`;
    })).sort();
    title = `\`${args.name}\` (${found.map((u) => `\`${map.files[u.file]}\``).join(', ')}) is used in ${items.length} file${items.length === 1 ? '' : 's'}`;
  } else if (args.file) {
    const i = fileIndex(map, args.file);
    if (i == null) return `No data: \`${args.file}\` is not a code file of ${name} the map knows.\n${TRUST}`;
    const by = [...map.importers[i]].map((j) => mark(j, i)).sort(), uses = [...map.imports[i]].map((j) => map.files[j]).sort();
    items = [...by.map((x) => `imported by: ${x}`), ...uses.map((x) => `imports: ${x}`)];
    title = `\`${map.files[i]}\`: imported by ${by.length} file${by.length === 1 ? '' : 's'}, imports ${uses.length}`;
  } else if (args.area) {
    const q = String(args.area).toLowerCase().replace(/\/+$/, '');
    const a = map.areas.find((x) => x.name.toLowerCase() === q) || map.areas.find((x) => x.name.toLowerCase().includes(q));
    if (!a) return `No data: no area of ${name} is called \`${args.area}\`. Ask with no arguments for the list.\n${TRUST}`;
    // Its files, then every file outside it that imports one of them (types only when it takes nothing else from it).
    const inside = new Set(a.files), outside = new Map(); // importer -> imports only types from the area so far
    for (const i of a.files) for (const j of map.importers[i]) if (!inside.has(j)) outside.set(j, (outside.get(j) ?? true) && typeOnly(j, i));
    const own = a.files.map((i) => map.files[i]).sort(), users = [...outside].map(([j, t]) => `${map.files[j]}${t ? ' (types only)' : ''}`).sort();
    items = [...own.map((x) => `in the area: ${x}`), ...users.map((x) => `used from outside by: ${x}`)];
    title = `Area \`${a.name}\`: ${own.length} code file${own.length === 1 ? '' : 's'}, used from outside by ${users.length}`;
  } else return `No data: list needs a name, a file or an area.\n${TRUST}`;
  const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE)), page = Math.max(1, Math.floor(Number(args.page) || 1));
  if (page > pages) return `No data: page ${page} is past the end (${pages} page${pages === 1 ? '' : 's'}).\n${TRUST}`;
  const rows = items.slice((page - 1) * LIST_PAGE, page * LIST_PAGE);
  return `${title} (page ${page} of ${pages}):\n${rows.map((x) => `- ${x}`).join('\n')}\n${page < pages ? `Page ${page} of ${pages}: ask again with page: ${page + 1} for the next.` : 'End of the list.'}\n${TRUST}`;
}

// tree: the project's knowledge tree (src/tree.js), when built: areas then add their git activity, Claude's record
// and the notes about them, each with its source.
export async function answerCodeMap(map, name, args = {}, hist = async () => '', tree = null) {
  if (args.list) return listAnswer(map, name, args);
  const day = (ts) => new Date(ts).toLocaleDateString('en-CA');
  const window = tree ? (tree.months === 'all' ? 'all history' : `${tree.months} months`) : '';
  const fi = (p) => fileIndex(map, p);
  const histLine = async (i) => { const h = await hist(map.files[i]); return h ? `History of \`${base(map.files[i])}\`: ${h}` : ''; };
  if (args.name) {
    const found = usesOf(map, String(args.name));
    if (!found.length) return `No data: no code file in ${name} exports \`${args.name}\` (as its import and export statements say). It may be a member, a local name, or in a language the map does not read for names (it reads JavaScript, TypeScript and Dart).\n${TRUST}`;
    const lines = [];
    for (const u of found.slice(0, 2)) {
      lines.push(`\`${args.name}\` (\`${map.files[u.file]}\`) is used in ${u.users.length} file${u.users.length === 1 ? '' : 's'} that import it${u.users.length ? ':' : '.'}`);
      for (const [dir, ids] of byFolder(map, u.users).slice(0, 5)) lines.push(`- ${dir}: ${ids.length} (${list(ids.map((i) => base(map.files[i])))})`);
      const h = await histLine(u.file);
      if (h) lines.push(h);
    }
    if (found.length > 2) lines.push(`Also exported by ${found.length - 2} more file${found.length > 3 ? 's' : ''}.`);
    return capped(lines, TRUST);
  }
  if (args.from || args.to) {
    const a = fi(args.from), b = fi(args.to);
    if (a == null || b == null) return `No data: \`${a == null ? args.from : args.to}\` is not a code file of ${name} the map knows.\n${TRUST}`;
    const c = connection(map, a, b), lines = [];
    if (c.kind === 'imports' || c.kind === 'imported by') {
      const p = c.path.map((i) => `\`${map.files[i]}\``);
      lines.push(`${p[0]} imports ${p.slice(1).join(', which imports ')}${c.kind === 'imported by' ? ' (the other way round)' : ''}.`);
    } else if (c.kind === 'shared') lines.push(`No import chain between them. Both import ${list(c.shared.map((i) => map.files[i]))}.`);
    else lines.push('No import chain between them and nothing imported by both: whatever links them (HTTP, events, configuration) does not show in imports.');
    const h = await hist(`${map.files[a]}|${map.files[b]}`);
    if (h) lines.push(`History: ${h}`);
    return capped(lines, TRUST);
  }
  if (args.file) {
    const i = fi(args.file);
    if (i == null) return `No data: \`${args.file}\` is not a code file of ${name} the map knows.\n${TRUST}`;
    const area = map.areaOf.get(i), lines = [`\`${map.files[i]}\`${area != null ? ` (area: ${map.areas[area].name}, ${map.areas[area].files.length} files)` : ''}:`];
    const exp = map.info[i].names.map((n) => [n, usesOf(map, n).find((u) => u.file === i)?.users.length || 0]).sort((x, y) => y[1] - x[1]);
    if (exp.length) lines.push(`- Exports ${exp.length}: ${exp.slice(0, 5).map(([n, k]) => `${n} (used in ${k})`).join(', ')}${exp.length > 5 ? ', …' : ''}.`);
    const by = [...map.importers[i]];
    if (map.hub[i]) lines.push(`- Shared infrastructure: imported by ${by.length} files.`);
    else if (by.length) lines.push(`- Imported by ${by.length}: ${byFolder(map, by).slice(0, 3).map(([d, ids]) => `${d} (${ids.length})`).join(', ')}.`);
    else lines.push('- Imported by no code file the map reads (an entry point, a page loaded by path, or unused).');
    if (map.imports[i].size) lines.push(`- Imports ${map.imports[i].size}: ${list([...map.imports[i]].map((j) => map.files[j]), 4)}.`);
    const h = await histLine(i);
    if (h) lines.push(h);
    return capped(lines, TRUST);
  }
  if (args.area) {
    const q = String(args.area).toLowerCase();
    const a = map.areas.find((x) => x.name.toLowerCase() === q) || map.areas.find((x) => x.name.toLowerCase().includes(q)) || map.areas.find((x) => x.folder && x.folder.toLowerCase().startsWith(q.replace(/\/+$/, '')));
    if (!a) return `No data: no area of ${name} is called \`${args.area}\`. Ask with no arguments for the list.\n${TRUST}`;
    const { shared, dependsOn, usedBy } = areaLinks(map, map.areas.indexOf(a));
    const lines = [`Area \`${a.name}\`: ${a.files.length} code files, ${a.inside} imports inside, ${a.outside} to other files.`,
      `- Core: ${list(a.top.map((i) => map.files[i]))}.`];
    if (shared.length) lines.push(`- Uses shared: ${shared.map(([j]) => `\`${base(map.files[j])}\``).join(', ')}.`);
    if (dependsOn.length) lines.push(`- Depends on: ${dependsOn.map(([o, n]) => `${map.areas[o].name} (${n})`).join(', ')}.`);
    if (usedBy.length) lines.push(`- Used by: ${usedBy.map(([o, n]) => `${map.areas[o].name} (${n})`).join(', ')}.`);
    const k = tree ? tree.areas.findIndex((x) => x.name === a.name) : -1;
    if (k >= 0) {
      const t = tree.areas[k], g = t.git;
      const hot = t.files.filter((x) => x.git?.n90).sort((x, y) => y.git.n90 - x.git.n90).slice(0, 3);
      const busiest = hot.map((x) => `${list([base(x.f)])} (${x.git.n90}, ${x.git.fix} fix)`).join(', ');
      lines.splice(1, 0, `- git (${window}): ${g.commits} commits, ${g.fixes} labeled fix, ${g.n90} in the last 90 days${g.last ? `; last change ${day(g.last)}` : ''}${g.dormant ? ' (dormant)' : ''}.${hot.length ? ` Busiest: ${busiest}.` : ''}`);
      const notes = t.notes.map((j) => tree.docs[j]).sort((x, y) => y.cited.includes(k) - x.cited.includes(k)).slice(0, 4);
      if (notes.length) lines.splice(2, 0, `- Notes to read: ${list(notes.map((d) => d.label || d.id), 4)}.`);
      const c = t.claude, fails = c.failures.slice(0, 2).map((x) => `${list([x.fam])} ("${x.sig}")`).join(', ');
      if (c.read || c.edit || c.failures.length) lines.push(`- Claude sessions: read in ${c.read} work episodes, edited in ${c.edit}${fails ? `; known failures fixed by editing here: ${fails}` : ''}.`);
    }
    return capped(lines, TRUST);
  }
  const { key, hubs } = keyFiles(map);
  const lines = [`Code map of ${name}: ${map.files.length} code files${map.repos > 1 ? ` in ${map.repos} repos` : ''}, ${map.importers.reduce((n, s) => n + s.size, 0)} imports.`,
    `- Key files: ${key.map((i) => `\`${map.files[i]}\` (imported by ${map.importers[i].size})`).join(', ')}.`];
  if (tree) {
    const busy = [...tree.areas].filter((a) => a.git.n90).sort((x, y) => y.git.n90 - x.git.n90).slice(0, 3);
    lines.push(`- Areas: ${tree.areas.length} folders; busiest in the last 90 days (git): ${busy.map((a) => `${a.name} (${a.git.n90} commits, ${a.git.fixes} fix)`).join(', ') || 'none'}.`);
    const quiet = tree.gaps.quiet.slice(0, 3).map((k) => tree.areas[k].name);
    lines.push(`- Notes: ${tree.docs.filter((d) => d.areas.length).length} of ${tree.docs.length} notes and CLAUDE.md sections talk about an area${quiet.length ? `; busy areas no note talks about: ${quiet.join(', ')}` : ''}.`);
  } else lines.push(`- Areas: ${map.areas.slice(0, 6).map((a) => `${a.name} (${a.files.length})`).join(', ')}${map.areas.length > 6 ? `, and ${map.areas.length - 6} more` : ''}.`);
  // Lines go whole past the cap, from here on: shared infrastructure is the first to go.
  if (hubs.length) lines.push(`- Shared infrastructure (imported by ${map.hubAt}+ files): ${hubs.map((i) => `\`${base(map.files[i])}\` (${map.importers[i].size})`).join(', ')}.`);
  return capped(lines, TRUST);
}
