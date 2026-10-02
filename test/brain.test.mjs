// The Brain view's data: the graph the server builds from what KevMind knows (src/brain.js), how the page places it
// (public/brain/graph.js), the file a read or edit event carries (src/state.js), and that building it only reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBrain, LIMITS } from '../src/brain.js';
import { emptyAggregate, ingest } from '../src/experience.js';
import { keyOf } from '../src/memory.js';
import { State } from '../src/state.js';
import { assemble, pathIndex, toolIndex, toolLabel, lobeOfPath, pathFinder } from '../public/brain/graph.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-brain-')));
const write = (file, text = 'x\n') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// One prompt turn in a session: reads, then edits.
function turn(agg, root, sid, ts, { reads = [], edits = [] }) {
  let t = ts;
  const base = { session_id: sid, cwd: root };
  ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'do the thing' }, t);
  for (const f of reads) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, f) } }, t += 1000);
  for (const f of edits) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } }, t += 1000);
}

// A workspace with a nested repo, memory notes that link and cite, and three days of work on two files.
function fixture() {
  const dir = tmp(), home = path.join(dir, 'home'), root = path.join(dir, 'Shop'), nested = path.join(root, 'frontend');
  const mem = path.join(home, '.claude', 'projects', 'shop', 'memory');
  for (const f of ['src/orders.js', 'src/stock.js', 'src/unused.js', 'CLAUDE.md', 'frontend/src/Cart.tsx']) write(path.join(root, f));
  const note = (name, extra) => ({ kind: 'memory', path: path.join(mem, name), display: `~/.claude/projects/shop/memory/${name}`, tokens: 120, linksOut: [], cites: [], ...extra });
  const report = {
    instructions: [
      { path: path.join(home, '.claude', 'CLAUDE.md'), display: '~/.claude/CLAUDE.md', scope: 'user', tokens: 40 },
      { path: path.join(root, 'CLAUDE.md'), display: 'CLAUDE.md', scope: 'project', tokens: 300, cites: [{ path: 'src/orders.js', working: true }] },
      { path: path.join(root, 'docs', 'rules.md'), display: 'docs/rules.md', scope: 'import', importedBy: 'CLAUDE.md', tokens: 90 },
      { path: path.join(root, '.claude', 'worktrees', 'x', 'CLAUDE.md'), display: '.claude/worktrees/x/CLAUDE.md', scope: 'worktree', tokens: 300 },
    ],
    memory: {
      index: { display: '~/.claude/projects/shop/memory/MEMORY.md', tokens: 60 },
      notes: [
        note('feedback-tests.md', { type: 'feedback', indexed: true, linksOut: ['~/.claude/projects/shop/memory/project-orders.md'] }),
        note('project-orders.md', { type: 'project', indexed: false, lastRead: NOW - DAY, cites: [{ path: 'src/orders.js', working: true }, { path: 'src/gone.js', working: false }, { path: 'src', working: true }] }),
      ],
    },
    serena: { notes: [{ kind: 'serena', path: path.join(root, '.serena', 'memories', 'style.md'), display: '.serena/memories/style.md', tokens: 80, linksOut: [], cites: [{ path: 'src/unused.js', working: true }] }] },
  };
  const agg = emptyAggregate();
  for (let d = 3; d >= 1; d--) turn(agg, root, `s${d}`, NOW - d * DAY, { reads: ['src/stock.js', 'CLAUDE.md'], edits: ['src/orders.js', 'src/stock.js'] });
  // Work started inside the nested repo is filed under that repo by the aggregate.
  write(path.join(nested, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  turn(agg, nested, 'n1', NOW - DAY, { reads: ['src/Cart.tsx'], edits: ['src/Cart.tsx'] });
  const tools = new Map([['Bash', { uses: 10, errors: 1, lastAt: NOW }], ['Read', { uses: 50, errors: 0, lastAt: NOW }],
    ['mcp__plugin_serena_serena__find_symbol', { uses: 2, errors: 0, lastAt: NOW - 5 }], ['mcp__plugin_serena_serena__get_symbols_overview', { uses: 1, errors: 1, lastAt: NOW }]]);
  const projects = [{ key: keyOf(root), name: 'Shop', root, report }, { key: keyOf(nested), name: 'frontend', root: nested, report: null }];
  return { home, root, nested, projects, agg, tools };
}

test('the graph is what KevMind knows: files, notes, tools and their real links, each file once', async () => {
  const { home, root, projects, agg, tools } = fixture();
  const g = await buildBrain({ projects, agg, tools, now: NOW, home });
  const P = keyOf(root);
  const node = (p) => g.nodes.find((n) => n.path === p);
  const has = (a, b, type) => g.edges.some((e) => e.type === type && ((g.nodes[e.a] === a && g.nodes[e.b] === b) || (g.nodes[e.a] === b && g.nodes[e.b] === a)));

  // The nested repo is part of the workspace: one project, its files under their folder, counted once.
  assert.deepEqual(g.projects.map((p) => p.name), ['Shop']);
  const cart = node('frontend/src/Cart.tsx');
  assert.equal(cart.project, P);
  assert.deepEqual([cart.reads, cart.edits], [1, 1]);

  // Files Claude touched, with their counts over the three days; what was only cited is there with none.
  const orders = node('src/orders.js'), stock = node('src/stock.js');
  assert.deepEqual([orders.type, orders.reads || 0, orders.edits], ['file', 0, 3]);
  assert.deepEqual([stock.reads, stock.edits], [3, 3]);
  assert.ok(stock.lastAt > NOW - 2 * DAY);
  assert.deepEqual([node('src/unused.js').reads || 0, node('src/unused.js').edits || 0], [0, 0]);
  assert.equal(node('src/gone.js'), undefined, 'a cited file that is not there is not a node');
  assert.equal(node('src'), undefined, 'a cited folder is not a node');

  // Instruction files: the user's own is shared (no project) and keeps its full path; a worktree copy is skipped;
  // one that Claude also read keeps being an instruction file, with the reads.
  const user = node('~/.claude/CLAUDE.md'), claude = node('CLAUDE.md');
  assert.deepEqual([user.type, user.project], ['instruction', null]);
  assert.ok(user.abs.endsWith('/.claude/CLAUDE.md'));
  assert.deepEqual([claude.type, claude.project, claude.abs, claude.reads], ['instruction', P, undefined, 3]);
  assert.equal(g.nodes.filter((n) => n.type === 'instruction').length, 3);
  assert.ok(has(claude, node('docs/rules.md'), 'import'));

  // Memory: MEMORY.md indexes what it lists; notes link to each other and cite code; feedback notes are marked.
  const index = g.nodes.find((n) => n.noteType === 'index'), fb = g.nodes.find((n) => n.name === 'feedback-tests.md'), po = g.nodes.find((n) => n.name === 'project-orders.md');
  assert.deepEqual([fb.type, fb.noteType, fb.indexed, po.indexed, po.lastAt], ['memory', 'feedback', true, false, NOW - DAY]);
  assert.ok(has(index, fb, 'index') && !has(index, po, 'index'));
  assert.ok(has(fb, po, 'link') && has(po, orders, 'cites') && has(claude, orders, 'cites'));
  assert.ok(has(g.nodes.find((n) => n.type === 'serena'), node('src/unused.js'), 'cites'));

  // Experience, at its thresholds: edited together in 3 episodes on 3 days.
  assert.ok(has(orders, stock, 'cochange'));
  assert.equal(g.edges.filter((e) => e.type === 'cochange').length, 1);

  // Tools: the file tools are not nodes; an MCP server is one node for all its tools.
  const toolsOut = g.nodes.filter((n) => n.type === 'tool');
  assert.deepEqual(toolsOut.map((n) => [n.name, n.uses, n.errors]), [['Bash', 10, 1], ['mcp: serena', 3, 1]]);
  assert.ok(g.edges.every((e) => g.nodes[e.a] && g.nodes[e.b] && e.a !== e.b));
});

test('over the limit, the least active code files go; notes, instruction files and tools stay', async () => {
  const dir = tmp(), root = path.join(dir, 'Big'), agg = emptyAggregate(), n = LIMITS.filesPerProject + 40;
  const base = { session_id: 's', cwd: root };
  ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'read everything' }, NOW - DAY);
  for (let i = 0; i < n; i++) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, `src/f${i}.js`) } }, NOW - DAY + i);
  for (let k = 0; k < 5; k++) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/hot.js') } }, NOW - DAY + n + k);
  const g = await buildBrain({ projects: [{ key: keyOf(root), name: 'Big', root, report: null }], agg, now: NOW });
  assert.equal(g.nodes.length, LIMITS.filesPerProject);
  assert.ok(g.nodes.some((x) => x.path === 'src/hot.js'), 'the most active file is kept');
});

test('the page places every node in a lobe and finds it again from an event', async () => {
  const { home, root, projects, agg, tools } = fixture();
  const graph = assemble(await buildBrain({ projects, agg, tools, now: NOW, home }));
  const lobe = (p) => graph.regions[(graph.nodes.find((n) => n.path === p) || graph.nodes.find((n) => n.name === p)).region];
  assert.deepEqual([lobe('CLAUDE.md').lobe, lobe('CLAUDE.md').label], ['prefrontal', 'Instructions']);
  assert.deepEqual([lobe('~/.claude/CLAUDE.md').label, lobe('~/.claude/CLAUDE.md').project], ['~/.claude', null]);
  assert.deepEqual([lobe('feedback-tests.md').lobe, lobe('project-orders.md').lobe, lobe('.serena/memories/style.md').lobe], ['prefrontal', 'temporal', 'temporal']);
  assert.deepEqual([lobe('src/orders.js').lobe, lobe('src/orders.js').label], ['parietal', 'src']);
  assert.deepEqual([lobe('frontend/src/Cart.tsx').lobe, lobe('frontend/src/Cart.tsx').label], ['occipital', 'frontend/src']);
  assert.equal(lobe('Bash').lobe, 'cerebellum');
  assert.equal(lobeOfPath('backend/test/orders.test.ts'), 'cerebellum');

  // An event's file: as the hook gave it (backslashes, any case on Windows), inside or outside the project.
  const find = pathIndex(graph), id = (p) => graph.nodes.findIndex((n) => n.path === p);
  assert.equal(find(path.join(root, 'src', 'orders.js')), id('src/orders.js'));
  assert.equal(find(path.join(root, 'frontend', 'src', 'Cart.tsx')), id('frontend/src/Cart.tsx'));
  assert.equal(find(path.join(home, '.claude', 'CLAUDE.md')), id('~/.claude/CLAUDE.md'));
  assert.equal(find(path.join(root, 'src', 'never-seen.js')), undefined);
  assert.equal(pathIndex({ projects: [{ id: 'p', root: 'C:/Dev/Shop' }], nodes: [{ id: 0, type: 'file', project: 'p', path: 'src/a.js' }] })('c:\\dev\\shop\\SRC\\a.js'), 0, 'Windows paths: any case, either slash');
  const tool = toolIndex(graph);
  assert.equal(graph.nodes[tool('mcp__plugin_serena_serena__find_symbol')].name, 'mcp: serena');
  assert.equal(graph.nodes[tool('Bash')].name, 'Bash');
  assert.equal(tool('Edit'), undefined);
  assert.equal(toolLabel('mcp__4c29315c-b7e7-43c9-b52d-30bb5085615e__search'), 'mcp: 4c29315c', 'a connector named by an id keeps its first characters');
});

test('a read or edit event carries its file, relative to the session folder when inside it', () => {
  const state = new State();
  const ev = (file, tool = 'Read') => state.apply({ hook_event_name: 'PreToolUse', session_id: 's', cwd: 'C:\\Dev\\Shop', tool_name: tool, tool_input: { file_path: file } }, 1000).events.at(-1);
  assert.deepEqual([ev('C:\\Dev\\Shop\\src\\orders.js').path, ev('c:/dev/shop/src/stock.js', 'Edit').path], ['src/orders.js', 'src/stock.js']);
  assert.equal(ev('C:\\Users\\me\\.claude\\CLAUDE.md').path, 'C:/Users/me/.claude/CLAUDE.md');
  assert.equal(ev('C:\\Dev\\Shopping\\x.js').path, 'C:/Dev/Shopping/x.js', 'a folder that only starts the same is outside');
  assert.equal(state.apply({ hook_event_name: 'PreToolUse', session_id: 's', cwd: 'C:\\Dev\\Shop', tool_name: 'Bash', tool_input: { command: 'ls' } }, 2000).events.at(-1).path, undefined);
});

test('building the graph only reads: no writes, no processes', () => {
  const src = fs.readFileSync(new URL('../src/brain.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.equal(src.match(/\.(?:write\w*|append\w*|unlink\w*|rm|rmSync|rmdir\w*|rename\w*|mkdir\w*|copyFile\w*|cp|cpSync|truncate\w*|symlink\w*|chmod\w*|chown\w*|utimes\w*)\(/g), null);
  assert.ok(!/child_process|\b(?:spawn|execFile|execSync|fork)\s*\(/.test(src), 'it starts no process');
  assert.deepEqual([...new Set([...src.matchAll(/\bfs\.(\w+)/g)].map((m) => m[1]))], ['existsSync']);
});

test('the Brain view has every word in both languages', () => {
  const w = {};
  new Function('window', fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'))(w);
  const { en, es } = w.I18N;
  assert.deepEqual(Object.keys(es.brain).sort(), Object.keys(en.brain).sort());
  assert.ok(en.viewBrain && es.viewBrain);
  for (const k of ['lobes', 'regionNames', 'did']) assert.deepEqual(Object.keys(es.brain[k]).sort(), Object.keys(en.brain[k]).sort());
  // Every word the view asks for (T.name) exists.
  const view = fs.readFileSync(new URL('../public/brain/view.js', import.meta.url), 'utf8');
  const asked = new Set([...view.matchAll(/\bT\.([a-zA-Z_]\w*)/g)].map((m) => m[1]).concat([...view.matchAll(/data-bi18n(?:-placeholder|-label)?="(\w+)"/g)].map((m) => m[1])));
  for (const t of ['instruction', 'memory', 'serena', 'file', 'tool']) asked.add('t_' + t);
  assert.deepEqual([...asked].filter((k) => !(k in en.brain)), []);
});

test('an agent\'s way between two cells: real links only, fewest hops, then the strongest; never invented', () => {
  const link = (a, b, type) => ({ a, b, type });
  // 0 → 2 two ways in two hops: through 1 over imports, or through 3 over index entries (weaker).
  const edges = [link(0, 1, 'import'), link(1, 2, 'import'), link(0, 3, 'index'), link(3, 2, 'index'), link(2, 4, 'cochange'), link(5, 6, 'link')];
  const find = pathFinder(7, edges), cells = (a, b) => { const p = find(a, b); if (!p) return p; let u = a; return [a, ...p.map((k) => (u = edges[k].a === u ? edges[k].b : edges[k].a))]; };
  assert.deepEqual(cells(0, 2), [0, 1, 2], 'the stronger links');
  assert.deepEqual(cells(2, 0), [2, 1, 0], 'either direction: a link is walked both ways');
  assert.deepEqual(cells(0, 4), [0, 1, 2, 4]);
  assert.deepEqual(find(0, 0), [], 'the same cell: nowhere to go');
  assert.equal(find(0, 5), null, 'no path: nothing is invented');
  // Fewer hops win over stronger links: a direct index entry beats two imports.
  assert.deepEqual(pathFinder(3, [link(0, 1, 'import'), link(1, 2, 'import'), link(0, 2, 'index')])(0, 2), [2]);
  // Two kinds of link between the same two cells are a stronger tie than one.
  const twice = [link(0, 1, 'cochange'), link(1, 3, 'cochange'), link(0, 2, 'cochange'), link(0, 2, 'import'), link(2, 3, 'cochange')];
  assert.deepEqual(pathFinder(4, twice)(0, 3), [3, 4], 'through the doubly linked cell, over its import');
  // At most 7 hops: a chain of 8 cells is in reach end to end, one of 9 is not.
  const chain = (n) => Array.from({ length: n - 1 }, (_, i) => link(i, i + 1, 'import'));
  assert.equal(pathFinder(8, chain(8))(0, 7).length, 7);
  assert.equal(pathFinder(9, chain(9))(0, 8), null);
  assert.equal(pathFinder(9, chain(9), 8)(0, 8).length, 8);
});

// A function of the view, lifted from its source with the words it uses (the view itself needs a browser).
function liftView(name, scope) {
  const src = fs.readFileSync(new URL('../public/brain/view.js', import.meta.url), 'utf8'), start = src.indexOf(`function ${name}(`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return new Function(...Object.keys(scope), `${src.slice(start, i + 1)}; return ${name};`)(...Object.values(scope));
  }
  throw new Error(`${name} not found`);
}

test('an agent\'s tag says one verb and the file or command, in both languages', () => {
  const w = {};
  new Function('window', fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'))(w);
  const say = (lang, kind, text) => { const { verb, text: t } = liftView('saying', { T: w.I18N[lang].brain })({ kind, text }); return `${verb} ${t}`.trim(); };
  assert.equal(say('en', 'read', 'view.js'), 'reads view.js');
  assert.equal(say('es', 'edit', 'view.js'), 'edita view.js');
  assert.equal(say('en', 'read', 'README.md'), 'reads README.md', 'a name that only starts like the verb keeps it');
  assert.equal(say('en', 'command', 'npm test'), 'runs npm test');
  // A command described with its own verb is not given a second one (the screenshots said "edits edits a file").
  assert.equal(say('en', 'command', 'Run the tests'), 'Run the tests');
  assert.equal(say('en', 'edit', 'edits a file'), 'edits a file');
  assert.equal(say('es', 'command', 'Ejecutar las pruebas'), 'Ejecutar las pruebas');
  assert.equal(say('es', 'read', 'lee un archivo'), 'lee un archivo');
  assert.equal(say('en', 'think', 'anything'), 'thinking', 'only actions on a file or a tool carry a text');
});

test('the benchmark\'s replay names files and tools only: no verbs, no notes', async () => {
  const { makeGraph, makeReplay } = await import('../prototype/brain/data.js');
  const graph = makeGraph({}), names = new Set(graph.nodes.map((n) => n.name));
  for (const e of makeReplay(graph).events) assert.ok(!e.text || names.has(e.text), `"${e.text}" is a node's name`);
});
