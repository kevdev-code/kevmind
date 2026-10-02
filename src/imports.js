// Import links for the Brain view: which of the graph's code files import which. It reads only the import statements
// of files that are already nodes (never symbols, never an index, never a file nobody touched) and resolves each one
// to a file the way the language does: relative paths, tsconfig/jsconfig aliases, a Dart package's own name,
// composer's PSR-4 folders, Python packages, C# namespaces. What it cannot place on disk is not a link (an npm or pub
// package, the standard library). Read-only: it reads files and lists folders, nothing else.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024; // bigger than this is a bundle or generated code, not something to read for imports
const WIN = process.platform === 'win32';
const fold = (s) => (WIN ? s.toLowerCase() : s);

const JS_EXT = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.vue', '.svelte', '.astro'];
const TS_FOR = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }; // "./x.js" written, x.ts on disk
// What each language is called, and the files it covers: the answer to "which languages are supported".
export const LANGUAGES = {
  js: { name: 'JavaScript / TypeScript', ext: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro'] },
  dart: { name: 'Dart', ext: ['.dart'] },
  py: { name: 'Python', ext: ['.py'] },
  php: { name: 'PHP', ext: ['.php'] },
  cs: { name: 'C#', ext: ['.cs'] },
  css: { name: 'CSS / Sass / Less', ext: ['.css', '.scss', '.sass', '.less'] },
  html: { name: 'HTML', ext: ['.html', '.htm'] },
};
const LANG_OF = new Map(Object.entries(LANGUAGES).flatMap(([k, l]) => l.ext.map((e) => [e, k])));

// A line that is commented out is not an import.
const commented = (text, i) => /^\s*(?:\/\/|\*|\/\*|#)/.test(text.slice(text.lastIndexOf('\n', i) + 1, i));
const bare = (spec) => spec.replace(/(?!^)[?#].*$/, ''); // "./icon.svg?react", but not the alias "#db/client"
const remote = (spec) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(spec); // https:, data:, //cdn
// tsconfig and jsconfig allow comments and trailing commas.
const jsonc = (text) => JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s || '').replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (m, s, t) => s || t));

// ---- What a file imports, as written (pure: text in, specifiers out) ----

const parse = {
  // import x from '…', import '…', export … from '…', import('…'), require('…'); also inside .vue/.svelte/.astro.
  js(text) {
    const out = new Set();
    for (const m of text.matchAll(/^[ \t]*(?:import|export)\b(?:[^'"`;/]|\/(?!\/))*?\bfrom\s*['"]([^'"\n]+)['"]/gm)) out.add(m[1]);
    for (const m of text.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm)) out.add(m[1]);
    for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) if (!commented(text, m.index)) out.add(m[1]);
    return [...out];
  },
  // import/export/part '…', part of '…', and the other sides of a conditional import.
  dart(text) {
    return [...new Set([...text.matchAll(/^[ \t]*(?:import|export|part(?:\s+of)?)\s+['"]([^'"\n]+)['"]/gm), ...text.matchAll(/\bif\s*\(\s*dart\.library\.[^)]*\)\s*['"]([^'"\n]+)['"]/g)].map((m) => m[1]))];
  },
  // import a.b, c as d / from a.b import c, d / from . import x / from ..pkg import (y, z)
  py(text) {
    const names = (s) => s.replace(/#[^\n]*/g, '').replace(/[()\\]/g, ' ').split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter((x) => /^[\w.]+$/.test(x));
    const out = [];
    for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) out.push({ from: m[1], names: names(m[2]) });
    for (const m of text.matchAll(/^[ \t]*import[ \t]+([^\n#]+)/gm)) for (const n of names(m[1])) out.push({ from: n, names: [] });
    return out;
  },
  // use App\Models\User; use App\Models\{User, Order as O}; require/include '…' (with or without __DIR__).
  php(text) {
    const uses = [], files = [];
    for (const m of text.matchAll(/^[ \t]*use\s+(?!function\b|const\b)([^;()=]+);/gm)) {
      const group = m[1].match(/^([^{]*)\{([^}]*)\}/);
      for (const part of group ? group[2].split(',').map((x) => group[1].trim() + x.trim()) : m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/i)[0].trim().replace(/^\\/, '');
        if (name.includes('\\')) uses.push(name);
      }
    }
    for (const m of text.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"\n]+)['"]/g)) if (!commented(text, m.index)) files.push(m[1]);
    return { uses, files };
  },
  // using N; global using N; using static N.T; using X = N.T; plus the file's own namespace and the type names it
  // mentions: "using" names a namespace, not a file, so the file is found by the type it declares (see csLinks).
  cs(text) {
    return {
      ns: (text.match(/^[ \t]*namespace\s+([\w.]+)/m) || [])[1] || '',
      using: [...text.matchAll(/^[ \t]*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm)].map((m) => m[1]),
      words: new Set(text.match(/\b[A-Z]\w+\b/g) || []),
    };
  },
  // @import '…', @import url(…), Sass @use / @forward.
  css(text) {
    return [...new Set([...text.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)].map((m) => m[1]))];
  },
  // <script src>, <link href>.
  html(text) {
    return [...new Set([...text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  },
};

export const specifiersOf = (text, ext) => { const lang = LANG_OF.get(ext.toLowerCase()); return lang ? parse[lang](text) : null; };

// ---- Where each one lands on disk ----

// One build's view of the disk: folders are listed once, config files read once.
function disk() {
  const dirs = new Map(), texts = new Map();
  const ls = (dir) => {
    const k = fold(dir);
    if (!dirs.has(k)) {
      const m = new Map();
      try { for (const d of fs.readdirSync(dir, { withFileTypes: true })) m.set(fold(d.name), !d.isDirectory()); } catch { /* not a folder */ }
      dirs.set(k, m);
    }
    return dirs.get(k);
  };
  const isFile = (p) => ls(path.dirname(p)).get(fold(path.basename(p))) === true;
  const text = (file) => {
    const k = fold(file);
    if (!texts.has(k)) { let t = null; if (isFile(file)) try { t = fs.readFileSync(file, 'utf8'); } catch { /* unreadable */ } texts.set(k, t); }
    return texts.get(k);
  };
  const json = (file) => { try { return jsonc(text(file) || ''); } catch { return null; } };
  const pick = (candidates) => candidates.find(isFile) || null;
  // The folders from a file's own up to its project's.
  const up = (dir, root) => {
    const out = [];
    for (let d = dir, i = 0; i < 40; d = path.dirname(d), i++) {
      out.push(d);
      if (fold(d) === fold(root) || path.dirname(d) === d) break;
    }
    return out;
  };
  const memo = new Map();
  const once = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
  return { isFile, text, json, pick, up, once };
}

const jsFiles = (base) => {
  const ext = path.extname(base);
  return [base, ...(TS_FOR[ext] || []).map((e) => base.slice(0, -ext.length) + e), ...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => path.join(base, 'index' + e))];
};

// The aliases a tsconfig or jsconfig declares: "paths" (against baseUrl, or the config's folder), baseUrl itself, and
// what it extends or references (Vite keeps the app's in tsconfig.app.json).
function aliasRules(file, d, depth = 0) {
  const cfg = d.json(file);
  if (!cfg || typeof cfg !== 'object') return [];
  const dir = path.dirname(file), co = cfg.compilerOptions || {};
  const base = typeof co.baseUrl === 'string' ? path.resolve(dir, co.baseUrl) : null;
  const rules = Object.entries(co.paths || {}).map(([key, to]) => ({ key, to: [].concat(to).filter((t) => typeof t === 'string').map((t) => path.resolve(base || dir, t)) }));
  if (base) rules.push({ key: '*', to: [path.join(base, '*')] });
  if (depth < 2) {
    for (const ref of [].concat(cfg.extends || [], (Array.isArray(cfg.references) ? cfg.references : []).map((r) => r && r.path))) {
      if (typeof ref !== 'string' || !ref.startsWith('.')) continue;
      const f = path.resolve(dir, ref);
      rules.push(...aliasRules(f.endsWith('.json') ? f : d.isFile(f + '.json') ? f + '.json' : path.join(f, 'tsconfig.json'), d, depth + 1));
    }
  }
  return rules;
}

const resolve = {
  js(file, root, specs, d) {
    const dir = path.dirname(file), out = [];
    for (const raw of specs) {
      const spec = bare(raw);
      if (!spec || remote(spec)) continue;
      if (/^\.\.?(?:\/|$)/.test(spec)) { out.push(d.pick(jsFiles(path.resolve(dir, spec)))); continue; }
      if (spec.startsWith('/')) continue;
      let hit = null;
      for (const folder of d.up(dir, root)) {
        const rules = d.once('alias:' + fold(folder), () => [...aliasRules(path.join(folder, 'tsconfig.json'), d), ...aliasRules(path.join(folder, 'jsconfig.json'), d)]);
        for (const { key, to } of rules) {
          const star = key.indexOf('*');
          if (star < 0 ? spec !== key : !(spec.length >= key.length - 1 && spec.startsWith(key.slice(0, star)) && spec.endsWith(key.slice(star + 1)))) continue;
          const mid = star < 0 ? '' : spec.slice(star, spec.length - (key.length - star - 1));
          hit = d.pick(to.flatMap((t) => jsFiles(t.replace('*', () => mid))));
          if (hit) break;
        }
        if (hit) break;
      }
      // No config says what "@/" or "~/" is (a bundler alias only): the convention is the package's src folder.
      if (!hit && /^[@~]\//.test(spec)) {
        const pkg = d.up(dir, root).find((f) => d.isFile(path.join(f, 'package.json')));
        if (pkg) hit = d.pick([...jsFiles(path.join(pkg, 'src', spec.slice(2))), ...jsFiles(path.join(pkg, spec.slice(2)))]);
      }
      out.push(hit);
    }
    return out;
  },
  dart(file, root, specs, d) {
    const dir = path.dirname(file);
    return specs.map((spec) => {
      const pkg = spec.match(/^package:([^/]+)\/(.+)$/);
      if (pkg) {
        // "package:name/…" is this package's own lib folder when name is the one in its pubspec.yaml.
        const home = d.up(dir, root).find((f) => ((d.text(path.join(f, 'pubspec.yaml')) || '').match(/^name:\s*['"]?([\w.-]+)/m) || [])[1] === pkg[1]);
        return home ? d.pick([path.join(home, 'lib', pkg[2])]) : null;
      }
      return remote(spec) ? null : d.pick([path.resolve(dir, spec)]);
    });
  },
  py(file, root, specs, d) {
    const out = [];
    const module = (base, parts) => d.pick([path.join(base, ...parts) + '.py', path.join(base, ...parts, '__init__.py')]);
    for (const { from, names } of specs) {
      const dots = from.match(/^\.*/)[0].length, mod = from.slice(dots).split('.').filter(Boolean);
      // Relative: one dot is the file's folder, each extra dot one folder up. Absolute: the nearest folder above
      // the file (or its src) that holds the package.
      let from0 = path.dirname(file);
      for (let i = 1; i < dots; i++) from0 = path.dirname(from0);
      const bases = dots ? [from0] : d.up(from0, root).flatMap((f) => [f, path.join(f, 'src')]);
      for (const base of bases) {
        const subs = names.map((n) => module(base, [...mod, n])).filter(Boolean); // from pkg import submodule
        const own = mod.length && subs.length < Math.max(names.length, 1) ? module(base, mod) : null;
        if (subs.length || own) { out.push(...subs, own); break; }
      }
    }
    return out;
  },
  php(file, root, { uses, files }, d) {
    const dir = path.dirname(file), out = files.map((f) => d.pick([path.resolve(dir, f.replace(/^[/\\]+/, ''))]));
    if (!uses.length) return out;
    // composer.json says which folder holds each namespace (PSR-4).
    const home = d.up(dir, root).find((f) => d.isFile(path.join(f, 'composer.json')));
    const cfg = home ? d.json(path.join(home, 'composer.json')) : null;
    const psr4 = Object.entries({ ...cfg?.['autoload-dev']?.['psr-4'], ...cfg?.autoload?.['psr-4'] }).sort((a, b) => b[0].length - a[0].length);
    for (const name of uses) {
      const rule = psr4.find(([prefix]) => name.startsWith(prefix));
      if (rule) out.push(d.pick([].concat(rule[1]).map((folder) => path.join(home, folder, ...name.slice(rule[0].length).split('\\')) + '.php')));
    }
    return out;
  },
  css(file, root, specs, d) {
    const dir = path.dirname(file);
    return specs.map((raw) => {
      const spec = bare(raw);
      if (!spec || remote(spec)) return null;
      const base = path.resolve(dir, spec), partial = path.join(path.dirname(base), '_' + path.basename(base));
      return d.pick([base, ...['.css', '.scss', '.sass', '.less'].map((e) => base + e), ...['.scss', '.sass'].map((e) => partial + e)]);
    });
  },
  html(file, root, specs, d) {
    const dir = path.dirname(file);
    return specs.map((raw) => {
      const spec = bare(raw);
      if (!spec || remote(spec)) return null;
      // "/x" is from the site's root, which is some folder above the page (or its public folder).
      if (spec.startsWith('/')) return d.pick(d.up(dir, root).flatMap((f) => [path.join(f, spec), path.join(f, 'public', spec)]));
      return d.pick([path.resolve(dir, spec)]);
    });
  },
};

// C#: a file is linked to the files of the namespaces it can see (its usings, its own namespace and the ones around
// it) whose type it mentions, a type's file being the one named after it.
function csLinks(files) {
  const out = [], byNs = new Map();
  const typeOf = (file) => path.basename(file).split('.')[0];
  for (const f of files) (byNs.get(f.data.ns) || byNs.set(f.data.ns, []).get(f.data.ns)).push(f);
  for (const f of files) {
    const seen = new Set(f.data.using);
    for (let ns = f.data.ns; ns; ns = ns.includes('.') ? ns.slice(0, ns.lastIndexOf('.')) : '') seen.add(ns);
    for (const ns of seen) for (const g of byNs.get(ns) || []) if (g !== f && f.data.words.has(typeOf(g.file))) out.push([f.file, g.file]);
    // using static N.T; using X = N.T;: the type is named outright.
    for (const u of f.data.using) {
      const cut = u.lastIndexOf('.');
      if (cut > 0) for (const g of byNs.get(u.slice(0, cut)) || []) if (g !== f && typeOf(g.file) === u.slice(cut + 1)) out.push([f.file, g.file]);
    }
  }
  return out;
}

// links(files) takes the graph's files, [{ file (absolute), root (its project's folder) }], and returns
// [[from, to]] pairs of absolute paths: "from imports to". A target may or may not be a node; the caller keeps the
// ones that are. What each file imports is remembered until the file changes.
export function importScanner() {
  const cache = new Map(); // file -> { version, data }
  return async function links(files) {
    const d = disk(), out = [], live = new Set(), cs = new Map();
    let n = 0;
    for (const { file, root } of files) {
      if (++n % 100 === 0) await new Promise(setImmediate); // a big graph must not hold the server: hooks keep being answered
      const lang = LANG_OF.get(path.extname(file).toLowerCase());
      if (!lang) continue;
      const k = fold(file);
      let stat = null;
      try { stat = fs.statSync(file); } catch { /* gone */ }
      if (!stat || !stat.isFile() || stat.size > MAX_BYTES) continue;
      const version = `${stat.mtimeMs}:${stat.size}`;
      let hit = cache.get(k);
      if (!hit || hit.version !== version) {
        let text = null;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        hit = { version, data: parse[lang](text) };
        cache.set(k, hit);
      }
      live.add(k);
      if (lang === 'cs') { (cs.get(fold(root)) || cs.set(fold(root), []).get(fold(root))).push({ file, data: hit.data }); continue; }
      for (const to of resolve[lang](file, root, hit.data, d)) if (to && fold(to) !== k) out.push([file, to]);
    }
    for (const group of cs.values()) out.push(...csLinks(group));
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    return out;
  };
}
