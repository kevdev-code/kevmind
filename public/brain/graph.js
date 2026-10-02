// The brain's graph, from what KevMind knows (GET /api/brain): instruction files, memory notes, Serena notes, the
// code files Claude touched and the tools it used, with the links between them. Real data only; nothing is invented.
// This module places each node in a lobe and a region; layout.js gives it a position.

export const NODE_TYPES = ['instruction', 'memory', 'serena', 'file', 'tool'];
export const EDGE_TYPES = ['link', 'index', 'import', 'cites', 'cochange', 'readfirst'];

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

// Where a code file lives in the brain, from its path alone.
export function lobeOfPath(p) {
  const s = p.toLowerCase();
  if (/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/.test(s)) return 'cerebellum';
  if (/(^|\/)(drizzle|migrations|\.github|scripts|docker)\/|(^|\/)(package\.json|tsconfig[^/]*|[^/]*\.config\.[a-z]+|dockerfile|docker-compose\.ya?ml|\.env\.example)$/.test(s)) return 'stem';
  if (/(^|\/)docs?\/|\.mdx?$/.test(s)) return 'frontal';
  if (/(^|\/)(frontend|client|web|public|components|pages|app|features|styles)\/|\.(tsx|jsx|css|scss|html|vue|svelte)$/.test(s)) return 'occipital';
  return 'parietal';
}

// Region of a code file: its folder, two levels deep (three inside a nested repo).
export function regionOfPath(p) {
  const parts = p.split('/');
  if (parts.length === 1) return '(root)';
  const nested = /^(frontend|backend|client|server|web|api|mobile)$/.test(parts[0]);
  return parts.slice(0, Math.min(parts.length - 1, nested ? 3 : 2)).join('/');
}

// The server's facts ({ projects: [{ id, name, root }], nodes, edges }) as the graph the view draws:
// { projects, regions: [{ id, project, lobe, label }], nodes (each with its region), edges }.
// Instruction files go to the prefrontal lobe (the user's own, shared by every project, in "~/.claude"), feedback
// notes with them; memory and Serena notes to the temporal lobe; tools to the cerebellum; code files by their path.
export function assemble(facts) {
  const regions = [], index = new Map();
  const region = (project, lobe, label) => {
    const k = `${project}|${lobe}|${label}`;
    if (!index.has(k)) { index.set(k, regions.length); regions.push({ id: regions.length, project, lobe, label }); }
    return index.get(k);
  };
  const nodes = facts.nodes.map((n, id) => {
    const P = n.project ?? null;
    let g;
    if (n.type === 'instruction') g = P == null ? region(null, 'prefrontal', '~/.claude') : region(P, 'prefrontal', 'Instructions');
    else if (n.type === 'memory') g = n.noteType === 'feedback' ? region(P, 'prefrontal', 'Feedback') : region(P, 'temporal', 'Memory');
    else if (n.type === 'serena') g = region(P, 'temporal', 'Serena');
    else if (n.type === 'tool') g = region(P, 'cerebellum', 'Tools');
    else g = region(P, lobeOfPath(n.path), regionOfPath(n.path));
    return { ...n, id, project: P, region: g, reads: n.reads || 0, edits: n.edits || 0, lastAt: n.lastAt || 0 };
  });
  const seen = new Set();
  const edges = facts.edges.filter((e) => {
    if (e.a === e.b || !nodes[e.a] || !nodes[e.b] || !EDGE_TYPES.includes(e.type)) return false;
    const k = `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}|${e.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { projects: facts.projects.map((p) => ({ id: p.id, name: p.name, root: p.root })), regions, nodes, edges, generatedAt: facts.generatedAt };
}

// A file's path as a key: forward slashes, and case-folded when it is a Windows path (a drive letter).
export const pathKey = (p) => { const s = String(p || '').replace(/\\/g, '/'); return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s; };

// Looks a node up by the absolute path an event carries. Nodes inside a project have a path relative to its root;
// those outside (the user's instructions, memory notes) carry their own absolute path (`abs`).
export function pathIndex(graph) {
  const roots = new Map(graph.projects.map((p) => [p.id, p.root || '']));
  const map = new Map();
  for (const n of graph.nodes) {
    if (n.type === 'tool') continue;
    const abs = n.abs ? pathKey(n.abs) : roots.get(n.project) ? pathKey(`${roots.get(n.project)}/${n.path}`) : null;
    if (abs && !map.has(abs)) map.set(abs, n.id);
  }
  return (file) => map.get(pathKey(file));
}

// The node of a tool: "Bash", "Grep"; every tool of an MCP server is that server's node ("mcp: serena"). A
// connector named by an id keeps its first eight characters.
export const toolLabel = (name) => {
  const m = /^mcp__(.+?)__/.exec(String(name || ''));
  if (!m) return String(name || '');
  const server = m[1].replace(/^plugin_/, '').replace(/^([a-z0-9-]+)_\1$/i, '$1');
  return `mcp: ${/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(server) ? server.slice(0, 8) : server}`;
};
export function toolIndex(graph) {
  const map = new Map();
  for (const n of graph.nodes) if (n.type === 'tool') map.set(n.name, n.id);
  return (name) => map.get(toolLabel(name));
}
