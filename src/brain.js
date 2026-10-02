// The Brain view's data: one graph of what KevMind already knows about the user's projects. Read-only and derived:
// instruction files, memory notes, Serena notes and what they cite come from the memory report (src/memory.js); the
// code files Claude touched, with what changes together and what is read first, from the experience aggregate
// (src/experience.js, with its thresholds); which of those files import which, from their import statements
// (src/imports.js); the tools from the event logs. Nothing here runs a command or writes a file, and nothing is
// invented: a node is a real file or tool, a link is a real relation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyOf } from './memory.js';
import { partners, readFirst, relPath } from './experience.js';
import { importScanner } from './imports.js';
import { toolLabel } from '../public/brain/graph.js';

// A brain stays readable and smooth up to a few thousand nodes: the most active files are kept.
export const LIMITS = { filesPerProject: 1200, nodes: 4000, tools: 40, projects: 12 };
// The file tools act on files, which are nodes themselves; they are not tool nodes.
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead']);
const slash = (p) => String(p).split(path.sep).join('/');
const inside = (root, file) => relPath(root, file);

// projects: [{ key, name, root, report }] (report: scanProject's result, or null when it could not be read);
// agg: the experience aggregate; tools: Map(tool name -> { uses, errors, lastAt }).
// Returns { generatedAt, projects: [{ id, name, root }], nodes, edges: [{ a, b, type }] }. A node:
// { type: instruction | memory | serena | file | tool, name, path, project (id, or null when shared), abs (only for
// a file outside its project's folder), tokens, reads, edits, lastAt, noteType, indexed, uses, errors }.
export async function buildBrain({ projects, agg, tools = new Map(), now = Date.now(), home = os.homedir(), exists = fs.existsSync, imports = importScanner() }) {
  const nodes = [], edges = [];
  const byFile = new Map(); // absolute path -> node index: a file is one node, whoever mentions it
  const fileOf = new Map(); // and back: node index -> absolute path
  // A project inside another one (a repo nested in the workspace, where sessions were also started) is part of it:
  // its notes and instruction files join the outer project, whose files already include the nested repo's.
  const all = projects.map((p) => ({ ...p, root: path.resolve(p.root) }));
  const outerOf = (p) => all.filter((o) => o !== p && inside(o.root, p.root)).sort((a, b) => a.root.length - b.root.length)[0] || p;
  const roots = new Map(all.map((p) => [p.key, outerOf(p).root]));
  const idOfProject = new Map(all.map((p) => [p.key, outerOf(p).key]));
  const counted = new Set(); // the experience projects already added: each file's reads and edits count once
  const abs = (display, root) => (display.startsWith('~/') ? path.join(home, display.slice(2)) : path.resolve(root, display));
  const add = (n, file) => {
    const k = file ? keyOf(file) : null;
    if (k && byFile.has(k)) return byFile.get(k);
    const root = n.project ? roots.get(n.project) : null;
    const rel = file && root ? inside(root, file) : null;
    const id = nodes.push({ ...n, path: rel || n.path, ...(file && !rel ? { abs: slash(file) } : {}) }) - 1;
    if (k) { byFile.set(k, id); fileOf.set(id, file); }
    return id;
  };
  const edge = (a, b, type) => { if (a != null && b != null && a !== b) edges.push({ a, b, type }); };

  for (const own of all) {
    const p = { ...own, key: idOfProject.get(own.key) }; // filed under the outer project
    const root = roots.get(own.key), r = own.report;
    if (r) {
      // Instruction files (worktree copies are copies: skipped). The user's own are shared by every project.
      const byDisplay = new Map();
      const own = [];
      for (const i of r.instructions) {
        if (i.scope === 'worktree') continue;
        const shared = i.scope === 'user' || i.scope === 'managed';
        const project = shared ? null : i.ownedBy && idOfProject.has(i.ownedBy.key) ? idOfProject.get(i.ownedBy.key) : p.key;
        const id = add({ type: 'instruction', name: path.basename(i.path), path: i.display, project, tokens: i.tokens }, i.path);
        byDisplay.set(i.display, id);
        own.push([i, id, path.dirname(i.path)]);
      }
      for (const i of r.instructions) if (i.importedBy) edge(byDisplay.get(i.importedBy), byDisplay.get(i.display), 'import');

      // Memory: MEMORY.md and its notes, then Serena's.
      const notes = [];
      const mem = r.memory;
      const index = mem?.index ? add({ type: 'memory', noteType: 'index', name: 'MEMORY.md', path: mem.index.display, project: p.key, tokens: mem.index.tokens }, abs(mem.index.display, root)) : null;
      for (const n of mem?.notes || []) {
        const id = add({ type: 'memory', noteType: n.type || 'project', name: path.basename(n.path), path: n.display, project: p.key, tokens: n.tokens, indexed: !!n.indexed, lastAt: n.lastRead || 0 }, n.path);
        byDisplay.set(n.display, id);
        notes.push([n, id, root]);
        if (n.indexed) edge(index, id, 'index');
      }
      for (const n of r.serena?.notes || []) {
        const id = add({ type: 'serena', name: path.basename(n.path), path: n.display, project: p.key, tokens: n.tokens }, n.path);
        byDisplay.set(n.display, id);
        notes.push([n, id, root]);
      }
      for (const [n, id] of notes) for (const to of n.linksOut || []) edge(id, byDisplay.get(to), 'link');

      // What they cite: a code file that is there. A note's paths are relative to the project; an instruction file's
      // to its own folder or one above it, up to the project.
      const cited = (owner, id, dir) => {
        for (const c of owner.cites || []) {
          if (c.working !== true || !/\.[A-Za-z0-9]+$/.test(c.path)) continue;
          let file = null;
          for (let d = dir; ; d = path.dirname(d)) {
            const f = path.resolve(d, c.path);
            if (byFile.has(keyOf(f)) || exists(f)) { file = f; break; }
            if (keyOf(d) === keyOf(root) || path.dirname(d) === d || !inside(root, d)) break;
          }
          if (!file || !inside(root, file)) continue;
          edge(id, add({ type: 'file', name: path.basename(file), path: slash(file), project: p.key }, file), 'cites');
        }
      };
      for (const [i, id, dir] of own) if (i.scope !== 'user' && i.scope !== 'managed') cited(i, id, inside(root, dir) ? dir : root);
      for (const [n, id, dir] of notes) cited(n, id, dir);
    }

    // The files Claude touched in the last 90 days: this project's, and those of the repos nested inside it.
    for (const q of Object.values(agg?.projects || {})) {
      const qroot = path.resolve(q.root);
      if ((keyOf(qroot) !== keyOf(root) && !inside(root, qroot)) || counted.has(keyOf(qroot))) continue;
      counted.add(keyOf(qroot));
      const stat = new Map();
      for (const s of Object.values(q.sessions)) {
        for (const ep of s.eps) {
          for (const [f, n] of Object.entries(ep.rc)) { const x = stat.get(+f) || stat.set(+f, { reads: 0, edits: 0, last: 0 }).get(+f); x.reads += n; x.last = Math.max(x.last, ep.last); }
          for (const [f, n] of Object.entries(ep.ec)) { const x = stat.get(+f) || stat.set(+f, { reads: 0, edits: 0, last: 0 }).get(+f); x.edits += n; x.last = Math.max(x.last, ep.last); }
        }
      }
      const top = [...stat].sort((a, b) => (b[1].edits * 3 + b[1].reads) - (a[1].edits * 3 + a[1].reads)).slice(0, LIMITS.filesPerProject);
      const idOf = new Map();
      for (const [f, x] of top) {
        const file = path.join(qroot, q.files[f]);
        const id = add({ type: 'file', name: path.basename(file), path: slash(file), project: p.key }, file);
        const n = nodes[id]; // a file already known (an instruction file Claude read, a cited file) gets its counts
        n.reads = (n.reads || 0) + x.reads; n.edits = (n.edits || 0) + x.edits; n.lastAt = Math.max(n.lastAt || 0, x.last);
        idOf.set(f, id);
      }
      for (const [f, x] of top) {
        if (!x.edits) continue;
        for (const g of partners(q, f, now)) edge(idOf.get(f), idOf.get(g.f), 'cochange');
        for (const g of readFirst(q, f, now)) edge(idOf.get(g.f), idOf.get(f), 'readfirst');
      }
    }
  }

  // Imports between the files that are nodes: what each one's import statements point at, when that is a node too.
  const sources = [...fileOf].filter(([id]) => nodes[id].project && !nodes[id].abs).map(([id, file]) => ({ file, root: roots.get(nodes[id].project) }));
  for (const [from, to] of await imports(sources)) edge(byFile.get(keyOf(from)), byFile.get(keyOf(to)), 'import');

  // Tools: every tool of an MCP server is one node, the server's.
  const byLabel = new Map();
  for (const [name, t] of tools) {
    if (FILE_TOOLS.has(name) || !t.uses) continue;
    const label = toolLabel(name), x = byLabel.get(label) || byLabel.set(label, { uses: 0, errors: 0, lastAt: 0 }).get(label);
    x.uses += t.uses; x.errors += t.errors || 0; x.lastAt = Math.max(x.lastAt, t.lastAt || 0);
  }
  for (const [label, x] of [...byLabel].sort((a, b) => b[1].uses - a[1].uses).slice(0, LIMITS.tools)) {
    nodes.push({ type: 'tool', name: label, path: `tool:${label}`, project: null, uses: x.uses, errors: x.errors, lastAt: x.lastAt });
  }

  // Over the limit: the least active code files go (and their links), never a note, an instruction file or a tool.
  let keep = nodes.map(() => true);
  if (nodes.length > LIMITS.nodes) {
    const files = nodes.map((n, i) => [n, i]).filter(([n]) => n.type === 'file').sort((a, b) => ((a[0].edits || 0) * 3 + (a[0].reads || 0)) - ((b[0].edits || 0) * 3 + (b[0].reads || 0)));
    for (const [, i] of files.slice(0, nodes.length - LIMITS.nodes)) keep[i] = false;
  }
  const renum = new Map();
  const outNodes = [];
  nodes.forEach((n, i) => { if (keep[i]) { renum.set(i, outNodes.length); outNodes.push(n); } });
  const seen = new Set();
  const outEdges = [];
  for (const e of edges) {
    const a = renum.get(e.a), b = renum.get(e.b);
    if (a == null || b == null) continue;
    const k = `${Math.min(a, b)}|${Math.max(a, b)}|${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outEdges.push({ a, b, type: e.type });
  }
  // Only the projects that have something to show, the outer ones.
  const used = new Set(outNodes.map((n) => n.project));
  return { generatedAt: now, projects: all.filter((p) => idOfProject.get(p.key) === p.key && used.has(p.key)).map((p) => ({ id: p.key, name: p.name, root: slash(p.root) })), nodes: outNodes, edges: outEdges };
}
