// Synthetic data for the brain prototype, shaped like the owner's real projects (OdonMind: ~50 memory notes,
// 4 instruction files, 1 Serena note, nested frontend/backend repos, a few hundred touched files). Every name is
// invented; the page labels it synthetic. Deterministic: the same seed gives the same graph and replay.

export const NODE_TYPES = ['instruction', 'memory', 'serena', 'file', 'tool'];
export const EDGE_TYPES = ['link', 'index', 'import', 'cites', 'cochange', 'readfirst'];
// Lobe of each kind of knowledge. Geometry lives in layout.js.
export const LOBES = ['prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem'];

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

const DOMAINS = ['appointments', 'patients', 'treatments', 'odontogram', 'invoices', 'payments', 'schedule', 'reminders',
  'inventory', 'prescriptions', 'xrays', 'insurance', 'reports', 'notifications', 'settings', 'clinics', 'users', 'auth',
  'roles', 'audit', 'budgets', 'labs', 'consents', 'referrals'];
const pascal = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
const UI = ['Page', 'List', 'Form', 'Detail', 'Card', 'Dialog', 'Table', 'Filters'];
const FEEDBACK = ['code-in-english', 'dates-in-local-time', 'short-commits', 'no-i18n-fallback', 'ask-before-migrations', 'tests-before-commit',
  'tenant-scoping', 'small-prs', 'measure-first', 'spanish-ui-copy', 'no-any-types', 'no-new-deps'];
const ASPECTS = ['rules', 'edge-cases', 'data-model', 'flows', 'decisions', 'migration-notes', 'open-questions'];
const DOC_TOPICS = ['overview', 'tenancy', 'auth-flow', 'deploy', 'onboarding', 'testing', 'api-conventions', 'glossary'];
const TOOLS = ['Bash', 'Grep', 'Glob', 'WebFetch', 'Browser', 'Serena', 'Agent'];

// Folder → how to name its files. `n` is the count at scale 1.
const CLINIC_FOLDERS = [
  ['frontend/src/features', 70, (d, r) => `frontend/src/features/${d}/${pascal(d)}${r.pick(UI)}.tsx`],
  ['frontend/src/service/api', 45, (d, r) => `frontend/src/service/api/${d}.${r.pick(['api', 'queries', 'types', 'keys'])}.ts`],
  ['frontend/src/components', 35, (d, r) => `frontend/src/components/${r.pick(['ui', 'layout', 'forms'])}/${pascal(r.pick(['button', 'modal', 'date-field', 'select', 'tabs', 'toast', 'sidebar', 'header', 'empty-state', 'avatar', 'badge']))}${r.int(9) || ''}.tsx`],
  ['frontend/src/lib', 12, (d, r) => `frontend/src/lib/${r.pick(['dates', 'money', 'format', 'http', 'i18n', 'storage', 'validation'])}${r.int(3) || ''}.ts`],
  ['frontend/src/service/api/__tests__', 10, (d) => `frontend/src/service/api/__tests__/${d}.api.test.ts`],
  ['backend/src/controllers', 30, (d) => `backend/src/controllers/${d}.controller.ts`],
  ['backend/src/routes', 24, (d) => `backend/src/routes/${d}.routes.ts`],
  ['backend/src/services', 22, (d) => `backend/src/services/${d}.service.ts`],
  ['backend/src/schemas', 18, (d) => `backend/src/schemas/${d}.schema.ts`],
  ['backend/src/middleware', 6, (d, r) => `backend/src/middleware/${r.pick(['tenant', 'session', 'errors', 'rate-limit', 'audit', 'cors'])}.ts`],
  ['backend/test/integration', 26, (d, r) => `backend/test/integration/${d}${r.pick(['', '.create', '.update', '.list', '.auth'])}.test.ts`],
  ['backend/drizzle/tenant', 20, (d, r) => `backend/drizzle/tenant/${String(r.int(90) + 1).padStart(4, '0')}_${r.pick(['create', 'alter', 'index', 'seed'])}_${d}.sql`],
  ['backend/drizzle/global', 8, (d, r) => `backend/drizzle/global/${String(r.int(40) + 1).padStart(4, '0')}_${r.pick(['create', 'alter'])}_${d}.sql`],
  ['(root)', 8, (d, r) => r.pick(['package.json', 'docker-compose.yml', 'frontend/package.json', 'backend/package.json', 'backend/tsconfig.json', 'frontend/vite.config.ts', 'backend/drizzle.config.ts', '.env.example', 'frontend/tsconfig.json', 'backend/Dockerfile'])],
  ['docs', 12, (d, r) => `docs/${r.pick(['architecture', 'onboarding', 'research'])}/${r.pick(DOC_TOPICS)}.md`],
];
const SMALL_FOLDERS = [
  ['src', 18, (d, r) => `src/${r.pick(['server', 'state', 'logs', 'config', 'events', 'memory', 'experience', 'transcript', 'install', 'demo'])}${r.int(4) || ''}.js`],
  ['public', 8, (d, r) => `public/${r.pick(['app.js', 'style.css', 'index.html', 'i18n.js', 'memory.js', 'brain.js'])}`],
  ['test', 16, (d, r) => `test/${r.pick(['agents', 'alerts', 'config', 'logs', 'memory', 'transcript', 'experience', 'mcp', 'dedupe'])}${r.int(3) || ''}.test.mjs`],
  ['bin', 2, () => 'bin/cli.js'],
  ['hooks', 3, (d, r) => `hooks/${r.pick(['send.js', 'redact.js'])}`],
  ['docs', 4, (d, r) => `docs/${r.pick(['ROADMAP.md', 'DESIGN.md', 'PRODUCT.md'])}`],
  ['(root)', 4, (d, r) => r.pick(['package.json', 'README.md', '.claude-plugin/plugin.json'])],
];

const BASE = [
  { name: 'demo-clinic', folders: CLINIC_FOLDERS, notes: { feedback: 10, project: 39, reference: 2 }, serena: 1,
    instructions: ['CLAUDE.md', 'frontend/CLAUDE.md', 'backend/CLAUDE.md'], filesScale: 1 },
  { name: 'demo-shop', folders: CLINIC_FOLDERS, notes: { feedback: 4, project: 14, reference: 2 }, serena: 3,
    instructions: ['CLAUDE.md'], filesScale: 0.25 },
  { name: 'demo-kevmind', folders: SMALL_FOLDERS, notes: { feedback: 2, project: 2, reference: 1 }, serena: 0,
    instructions: ['CLAUDE.md'], filesScale: 1 },
];
const EXTRA = ['demo-lab', 'demo-mobile', 'demo-billing', 'demo-portal', 'demo-api', 'demo-agenda', 'demo-ops', 'demo-site', 'demo-crm'];

// The graph: { synthetic, projects, regions, nodes, edges }. `target` adds clinic-shaped projects until the node
// count reaches it (the 3,000-node stress case).
export function makeGraph({ seed = 7, target = 0, now = Date.now() } = {}) {
  const r = rng(seed);
  const projects = [];
  const regions = [];
  const nodes = [];
  const edges = [];
  const regionIndex = new Map();
  const nodeByKey = new Map();
  const region = (project, lobe, label) => {
    const k = `${project}|${label}`;
    if (!regionIndex.has(k)) { regionIndex.set(k, regions.length); regions.push({ id: regions.length, project, lobe, label }); }
    return regionIndex.get(k);
  };
  // Activity: a long tail, a few hot files. Hot things were touched recently.
  const activity = (hot) => {
    const h = Math.pow(r(), hot ? 1.2 : 3.2);
    const reads = Math.round(h * 60);
    const edits = Math.round(reads * r() * 0.6);
    const lastAt = now - Math.round((1 - h) * (1 - h) * 30 * 86400e3 + r() * 3600e3);
    return { reads, edits, lastAt };
  };
  const node = (n) => {
    const key = `${n.project}|${n.path}`;
    if (nodeByKey.has(key)) return nodeByKey.get(key);
    n.id = nodes.length;
    nodes.push(n);
    nodeByKey.set(key, n.id);
    return n.id;
  };
  const edge = (a, b, type) => { if (a !== b && a != null && b != null) edges.push({ a, b, type }); };

  // Shared by every project: the user-level instructions.
  const userClaude = node({ project: null, region: region(null, 'prefrontal', '~/.claude'), type: 'instruction', name: 'CLAUDE.md',
    path: '~/.claude/CLAUDE.md', tokens: 58, ...activity(true) });

  const specs = [...BASE];
  const estimate = () => specs.reduce((s, p) => s + p.notes.feedback + p.notes.project + p.notes.reference + p.serena + 12 +
    p.folders.reduce((t, f) => t + Math.round(f[1] * p.filesScale), 0), 1);
  for (let i = 0; target && estimate() < target; i++) {
    specs.push({ name: EXTRA[i % EXTRA.length] + (i >= EXTRA.length ? `-${(i / EXTRA.length) | 0}` : ''), folders: CLINIC_FOLDERS,
      notes: { feedback: 6, project: 24, reference: 2 }, serena: 1, instructions: ['CLAUDE.md', 'frontend/CLAUDE.md', 'backend/CLAUDE.md'], filesScale: 0.9 });
  }

  for (const spec of specs) {
    const P = spec.name;
    projects.push({ id: P, name: P });
    const domains = DOMAINS.slice(0, 8 + r.int(DOMAINS.length - 8));

    // Instructions
    const instr = spec.instructions.map((p) => node({ project: P, region: region(P, 'prefrontal', 'Instructions'), type: 'instruction',
      name: p.split('/').pop(), path: p, tokens: 800 + r.int(2500), ...activity(true) }));
    edge(instr[0], userClaude, 'import'); // ponytail: "both load at startup", drawn as an import so the shared file joins each project

    // Files, by folder
    const files = [];
    const byDomain = new Map();
    for (const [, n, make] of spec.folders) {
      const count = Math.round(n * spec.filesScale);
      for (let k = 0; k < count; k++) {
        const d = r.pick(domains);
        let p = make(d, r);
        if (nodeByKey.has(`${P}|${p}`)) p = p.replace(/(\.[a-z]+)$/, `${k}$1`);
        if (nodeByKey.has(`${P}|${p}`)) continue;
        const lobe = lobeOfPath(p);
        const id = node({ project: P, region: region(P, lobe, regionOfPath(p)), type: 'file', name: p.split('/').pop(), path: p,
          domain: d, ...activity(r() < 0.12) });
        files.push(id);
        if (!byDomain.has(d)) byDomain.set(d, []);
        byDomain.get(d).push(id);
      }
    }

    // Memory: MEMORY.md index, notes, Serena
    const memRegion = region(P, 'temporal', 'Memory');
    const index = node({ project: P, region: memRegion, type: 'memory', noteType: 'index', name: 'MEMORY.md', path: 'memory/MEMORY.md',
      tokens: 900 + r.int(1200), ...activity(true) });
    const notes = [];
    for (const [noteType, n] of Object.entries(spec.notes)) {
      for (let k = 0; k < n; k++) {
        const d = r.pick(domains);
        const stem = noteType === 'feedback' ? `feedback-${FEEDBACK[k % FEEDBACK.length]}${k >= FEEDBACK.length ? k : ''}`
          : noteType === 'reference' ? `reference-${r.pick(['api-docs', 'design-tokens', 'staging-urls', 'payment-sandbox'])}-${k}`
          : `project-${d}-${r.pick(ASPECTS)}`;
        const lobe = noteType === 'feedback' ? 'prefrontal' : 'temporal';
        const id = node({ project: P, region: lobe === 'prefrontal' ? region(P, 'prefrontal', 'Feedback') : memRegion, type: 'memory', noteType,
          name: stem + '.md', path: `memory/${stem}.md`, domain: d, tokens: 150 + r.int(1400), ...activity(r() < 0.2) });
        if (notes.includes(id)) continue;
        notes.push(id);
        if (r() < 0.95) edge(index, id, 'index');
      }
    }
    for (let k = 0; k < spec.serena; k++) {
      const id = node({ project: P, region: region(P, 'temporal', 'Serena'), type: 'serena', name: `${['business-context', 'suggested-commands', 'code-style'][k % 3]}.md`,
        path: `.serena/memories/${['business-context', 'suggested-commands', 'code-style'][k % 3]}.md`, tokens: 300 + r.int(900), ...activity(false) });
      notes.push(id);
    }

    // Tools (used in this project's sessions)
    for (const t of TOOLS) {
      const uses = Math.round(Math.pow(r(), 1.5) * 600) + 3;
      node({ project: P, region: region(P, 'cerebellum', 'Tools'), type: 'tool', name: t, path: `tool:${t}`, uses, errors: Math.round(uses * r() * 0.05),
        reads: 0, edits: 0, lastAt: now - r.int(5 * 86400e3) });
    }

    // Links between notes (mostly same domain), cites from notes to code, imports from CLAUDE.md to docs
    for (const id of notes) {
      const d = nodes[id].domain;
      const peers = notes.filter((x) => x !== id && nodes[x].domain === d);
      for (let k = r.int(3); k > 0; k--) edge(id, peers.length && r() < 0.7 ? r.pick(peers) : r.pick(notes), 'link');
      const code = byDomain.get(d) || [];
      for (let k = r.int(4); k > 0 && code.length; k--) edge(id, r.pick(code), 'cites');
    }
    const docs = files.filter((f) => nodes[f].path.endsWith('.md'));
    for (const i of instr) for (let k = 0; k < 2 && docs.length; k++) edge(i, r.pick(docs), 'import');
    for (const i of instr.slice(1)) edge(instr[0], i, 'import');

    // Co-change (git and work episodes): the layers of one domain change together. Read-first: tests after services.
    for (const group of byDomain.values()) {
      for (const f of group) {
        for (let k = r() < 0.75 ? 1 + r.int(2) : 0; k > 0; k--) edge(f, r.pick(group), 'cochange');
        if (/\.test\./.test(nodes[f].path) && r() < 0.6) {
          const src = group.find((g) => /\.service\.|\.api\./.test(nodes[g].path));
          if (src != null) edge(src, f, 'readfirst');
        }
      }
    }
    for (let k = Math.round(files.length * 0.08); k > 0; k--) edge(r.pick(files), r.pick(files), 'cochange');
  }

  // Drop duplicate edges (either direction, same type)
  const seen = new Set();
  const unique = edges.filter((e) => {
    const k = `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}|${e.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { synthetic: true, projects, regions, nodes, edges: unique };
}

// A replay of one working session in demo-clinic: Claude plus three parallel subagents, ~80 s, then idle.
// Each event: { at (ms), agent, kind: start | stop | read | edit | command | think | error, node, text, tokens }.
export function makeReplay(graph, { seed = 11 } = {}) {
  const r = rng(seed);
  const P = 'demo-clinic';
  const inP = graph.nodes.filter((n) => n.project === P);
  const find = (re, type = 'file') => {
    const hits = inP.filter((n) => n.type === type && re.test(n.path));
    return hits.length ? hits[r.int(hits.length)].id : inP.find((n) => n.type === type).id;
  };
  const tool = (t) => inP.find((n) => n.type === 'tool' && n.name === t).id;
  const events = [];
  const agents = [
    { id: 'main', label: 'Claude', type: 'main' },
    { id: 'a1', label: '#1 Explore', type: 'Explore', task: 'Find callers of AppointmentService' },
    { id: 'a2', label: '#2 general-purpose', type: 'general-purpose', task: 'Write integration tests' },
    { id: 'a3', label: '#3 code-reviewer', type: 'code-reviewer', task: 'Review date validation' },
  ];
  const script = (agent, at, steps) => {
    for (const [kind, node, gap] of steps) {
      // tokens: thinking tokens of a think event (the transcript gives them per message), for the activity trace
      events.push({ at, agent, kind, node, text: node != null ? graph.nodes[node].name : '', tokens: kind === 'think' ? 150 + r.int(1200) : 0 });
      at += gap ?? 900 + r.int(1500);
    }
    return at;
  };
  const svc = find(/backend\/src\/services\/appointments/);
  let t = script('main', 0, [
    ['start', null, 300], ['think', null, 700], ['read', find(/^CLAUDE\.md$/, 'instruction'), 900], ['read', find(/MEMORY\.md$/, 'memory'), 800],
    ['read', find(/project-appointments/, 'memory')], ['read', svc], ['think', null, 1200], ['command', tool('Agent'), 400],
  ]);
  const launch = t;
  script('a1', launch + 200, [
    ['start', null, 500], ['read', tool('Grep')], ['read', find(/controllers\/appointments/)], ['read', find(/routes\/appointments/)],
    ['read', find(/features\/appointments/)], ['read', find(/api\/appointments/)], ['read', tool('Grep')], ['read', find(/features\/schedule/)],
    ['read', find(/components\//)], ['read', find(/project-schedule|project-appointments/, 'memory')], ['read', find(/features\/reminders/)],
    ['read', find(/lib\/dates/)], ['stop', null],
  ]);
  script('a2', launch + 500, [
    ['start', null, 500], ['read', svc], ['read', find(/schemas\/appointments/)], ['read', find(/test\/integration\/appointments/)],
    ['think', null, 1400], ['edit', find(/test\/integration\/appointments/)], ['command', tool('Bash'), 2200], ['error', tool('Bash'), 800],
    ['think', null, 1300], ['read', find(/middleware\/tenant/)], ['edit', find(/test\/integration\/appointments/)], ['command', tool('Bash'), 2400],
    ['edit', find(/test\/integration\/schedule|test\/integration\/reminders/)], ['command', tool('Bash'), 2000], ['stop', null],
  ]);
  script('a3', launch + 800, [
    ['start', null, 500], ['read', find(/schemas\/appointments/)], ['read', find(/feedback-dates/, 'memory')], ['think', null, 1500],
    ['read', svc], ['read', find(/lib\/dates/)], ['think', null, 1400], ['read', find(/project-appointments/, 'memory')],
    ['read', find(/middleware\//)], ['read', find(/controllers\/schedule|controllers\/appointments/)], ['think', null, 1200], ['stop', null],
  ]);
  const agentsDone = Math.max(...events.map((e) => e.at)) + 1500;
  script('main', Math.max(t + 4000, agentsDone), [
    ['think', null, 1200], ['read', find(/test\/integration\/appointments/)], ['edit', svc], ['edit', find(/schemas\/appointments/)],
    ['command', tool('Bash'), 2600], ['edit', find(/features\/appointments/)], ['command', tool('Bash'), 2200], ['think', null, 900], ['stop', null],
  ]);
  events.sort((a, b) => a.at - b.at);
  const end = events[events.length - 1].at;
  return { project: P, agents, events, length: end + 12000 }; // 12 s of stillness before it loops
}
