// The knowledge tree (src/tree.js): folder areas, git facts, Claude's record, memory linked to areas, the gap checks,
// an incremental refresh, the answers built on it, and the server's routes. Fixtures are temporary git repos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codeMapper, answerCodeMap } from '../src/codemap.js';
import { buildTree, profileOf, gapProblems, TREE } from '../src/tree.js';
import { emptyAggregate, ingest } from '../src/experience.js';
import { briefingText } from '../src/briefing.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const DAY = 86_400_000;

// 22 order files and 22 billing files (so src/ splits into two areas), two helpers in lib/ (too few for an area of
// their own: they stay with the top level). Orders change often and no note talks about them; billing has fixes, a
// revert, and four notes that cite it.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-tree-'));
  const root = path.join(dir, 'demo-shop');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, stdio: 'ignore', windowsHide: true });
  fs.mkdirSync(root, { recursive: true });
  git('init', '-q');
  for (let i = 0; i < 22; i++) write(path.join(root, 'src', 'orders', `order${i}.ts`), `import { money } from '../../lib/money';\nexport const order${i} = () => money(${i});\n`);
  for (let i = 0; i < 22; i++) write(path.join(root, 'src', 'billing', `invoice${i}.ts`), `import { money } from '../../lib/money';\nexport function invoiceTotal${i}() { return money(${i}); }\n`);
  write(path.join(root, 'lib', 'money.ts'), 'export const money = (n: number) => n;\n');
  write(path.join(root, 'lib', 'dates.ts'), 'export const today = () => 0;\n');
  write(path.join(root, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
  git('add', '-A'); git('commit', '-q', '-m', 'first');
  for (let k = 0; k < 6; k++) { fs.appendFileSync(path.join(root, 'src', 'orders', `order${k}.ts`), `// ${k}\n`); git('commit', '-qam', `orders: step ${k}`); }
  for (let k = 0; k < 3; k++) { fs.appendFileSync(path.join(root, 'src', 'billing', 'invoice1.ts'), `// fix ${k}\n`); git('commit', '-qam', `fix: invoice rounding ${k}`); }
  git('revert', '--no-edit', 'HEAD');
  const home = path.join(dir, 'home'), notes = path.join(home, 'memory');
  for (let k = 0; k < 4; k++) write(path.join(notes, `billing_${k}.md`), `# Billing ${k}\n\nTotals are computed in \`src/billing/invoice1.ts\` with \`invoiceTotal1\`.\n`);
  write(path.join(notes, 'style.md'), '# Style\n\nShort commit messages.\n');
  write(path.join(root, 'CLAUDE.md'), '# Demo shop\n\n## Money\n\nAll amounts go through `lib/money.ts`.\n');
  const report = {
    memory: { notes: fs.readdirSync(notes).map((f) => ({ path: path.join(notes, f), display: `~/memory/${f}` })) },
    serena: { notes: [] },
    instructions: [{ path: path.join(root, 'CLAUDE.md'), display: 'CLAUDE.md', scope: 'project' }],
  };
  // Claude's record: one session that read and edited an invoice file.
  const agg = emptyAggregate();
  const now = Date.now();
  ingest(agg, { session_id: 's1', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'fix totals' }, now - DAY);
  ingest(agg, { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: path.join(root, 'src', 'billing', 'invoice1.ts') } }, now - DAY + 1000);
  ingest(agg, { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: path.join(root, 'src', 'billing', 'invoice1.ts') } }, now - DAY + 2000);
  return { dir, root, git, report, agg };
}

test('areas are folders; facts come with their source: code, git, Claude sessions, notes', async () => {
  const { dir, root, report, agg } = fixture();
  try {
    const map = await codeMapper()(root);
    const tree = await buildTree({ root, map, report, agg });
    const area = (n) => tree.areas.find((a) => a.name === n);
    assert.deepEqual(tree.areas.map((a) => a.name).sort(), ['.', 'src/billing', 'src/orders'], 'src/ splits; lib/ is too small and stays with the top level');
    assert.deepEqual(area('.').files.map((f) => f.f).sort(), ['lib/dates.ts', 'lib/money.ts']);
    // code
    assert.equal(area('src/billing').files.find((f) => f.f === 'src/billing/invoice1.ts').names[0], 'invoiceTotal1');
    assert.deepEqual([area('src/billing').uses, area('src/billing').shared], [[], ['lib/money.ts']], 'money.ts is imported by every order and invoice: shared infrastructure, not a link between areas');
    // git: 6 order commits; billing 3 fixes and a revert (which counts as a fix too), the first commit too big to count
    assert.deepEqual([area('src/orders').git.commits, area('src/orders').git.n90, area('src/orders').git.fixes], [6, 6, 0]);
    assert.deepEqual([area('src/billing').git.commits, area('src/billing').git.fixes], [4, 4]);
    assert.equal(tree.reverted.length, 1);
    assert.match(tree.reverted[0][1], /^Revert "fix: invoice rounding 2"/);
    assert.equal(area('src/orders').git.dormant, false);
    // Claude sessions
    assert.deepEqual([area('src/billing').claude.read, area('src/billing').claude.edit], [1, 1]);
    assert.deepEqual(area('src/billing').files.find((f) => f.f === 'src/billing/invoice1.ts').claude, { read: 1, edit: 1 });
    // notes: four cite billing; the CLAUDE.md section cites lib/money.ts; the style note talks about no area
    const labels = (a) => a.notes.map((j) => tree.docs[j].label).sort();
    assert.deepEqual(labels(area('src/billing')), ['billing_0.md', 'billing_1.md', 'billing_2.md', 'billing_3.md']);
    assert.deepEqual(labels(area('.')), ['CLAUDE.md § Money']);
    assert.deepEqual(tree.docs.find((d) => d.label === 'style.md').areas, []);
    // gaps: orders is busy and no note talks about it; billing is cited by four files
    assert.deepEqual(tree.gaps.quiet.map((k) => tree.areas[k].name), ['src/orders']);
    assert.deepEqual(tree.gaps.crowded.map((k) => tree.areas[k].name), ['src/billing']);
    const p = profileOf(tree);
    assert.deepEqual([p.files, p.areas, p.commits, p.docs, p.linked, p.quiet, p.sessions], [46, 3, 11, 6, 5, 1, 1]);
    assert.ok(!JSON.stringify(tree).includes('return money'), 'no file contents in the tree');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the gap checks describe; their prompts never have Claude write a note or judge one on its own', async () => {
  const { dir, root, report, agg } = fixture();
  try {
    const tree = await buildTree({ root, map: await codeMapper()(root), report, agg });
    const probs = gapProblems(tree);
    assert.deepEqual(probs.map((x) => [x.code, x.tier, x.file]), [['busy_area_no_notes', 'suggestion', 'src/orders'], ['many_notes_area', 'suggestion', 'src/billing']]);
    assert.match(probs[0].fix, /suggest a short note for me to review; don't write it yet/);
    assert.match(probs[1].fix, /Don't change anything yet/);
    assert.equal(probs[1].params.count, 4);
    assert.deepEqual(gapProblems(null), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a refresh reads only the new commits; a different window reads them all again', async () => {
  const { dir, root, git, report, agg } = fixture();
  try {
    const mapper = codeMapper();
    const first = JSON.parse(JSON.stringify(await buildTree({ root, map: await mapper(root), report, agg })));
    fs.appendFileSync(path.join(root, 'src', 'orders', 'order9.ts'), '// more\n');
    git('commit', '-qam', 'orders: one more');
    const next = await buildTree({ root, map: await mapper(root), report, agg, prev: first });
    assert.equal(next.git.commits.length, first.git.commits.length + 1);
    assert.equal(next.areas.find((a) => a.name === 'src/orders').git.commits, 7);
    assert.notEqual(next.repos[''].head, first.repos[''].head);
    const all = await buildTree({ root, map: await mapper(root), report, agg, prev: next, months: 'all' });
    assert.equal(all.months, 'all');
    assert.equal(all.git.commits.length, next.git.commits.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('code_map(area) and the briefing say where each fact comes from', async () => {
  const { dir, root, report, agg } = fixture();
  try {
    const map = await codeMapper()(root);
    const tree = await buildTree({ root, map, report, agg });
    const a = await answerCodeMap(map, 'demo-shop', { area: 'src/billing' }, async () => '', tree);
    assert.ok(a.length <= 800);
    assert.match(a, /- git \(12 months\): 4 commits, 4 labeled fix, 4 in the last 90 days; last change \d{4}-\d{2}-\d{2}\./);
    assert.match(a, /- Notes to read: `billing_0\.md`/);
    assert.match(a, /- Claude sessions: read in 1 work episodes, edited in 1\./);
    const overview = await answerCodeMap(map, 'demo-shop', {}, async () => '', tree);
    assert.match(overview, /busy areas no note talks about: src\/orders/);
    const { text } = briefingText({
      name: 'demo-shop', now: Date.now(), toolsOn: false, last: null, git: [], failures: [], rereads: [], together: [], notes: [], stale: [],
      map: { area: { name: 'src/billing', files: 22, core: ['src/billing/invoice1.ts'], dependsOn: ['.'], usedBy: [], others: 0, git: { n90: 4, fixes: 4, months: 12 }, notes: ['billing_0.md'] }, key: [], hubs: [], stale: [] },
    });
    assert.match(text, /in the area `src\/billing` \(22 code files; core `src\/billing\/invoice1\.ts`\), which uses \.\. git: 4 commits in the last 90 days; 4 labeled fix in 12 months\. Notes about it: `billing_0\.md`\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tree.js only reads: no writes, git only `log` through one guarded helper', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'tree.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(src.match(/\.(?:write\w*|append\w*|unlink\w*|rm\w*|rename\w*|mkdir\w*|copyFile\w*)\s*\(/g), null);
  assert.ok(src.includes("const GIT_TREE = new Set(['log']);"));
  assert.equal(src.match(/execFile\(/g).length, 1);
  assert.match(src, /if \(!GIT_TREE\.has\(args\[0\]\)\) throw/);
  for (const m of src.matchAll(/gitRead\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.equal(m[1], 'log');
  assert.equal(TREE.months, 12);
});

const req = (url, opts = {}) => new Promise((resolve, reject) => {
  const r = http.request(url, { method: opts.method || 'GET', headers: opts.body ? { 'content-type': 'application/json' } : {} }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  r.on('error', reject);
  r.end(opts.body);
});

test('the server builds a project\'s map on demand, serves it once per change, and adds the gap checks to the Memory tab', async () => {
  const { dir, root } = fixture();
  const home = path.join(dir, 'kevmind');
  fs.mkdirSync(home, { recursive: true });
  const port = 47900 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(HERE, '..', 'bin', 'kevmind.js'), 'start'], { env: { ...process.env, KEVMIND_HOME: home, KEVMIND_PORT: String(port), KEVMIND_AUTOSTART: '0' }, stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { try { await req(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const init = JSON.parse((await req(`${base}/api/init`, { method: 'POST', body: JSON.stringify({ root, months: 6 }) })).body);
    assert.equal(init.ok, true);
    assert.equal(init.profile.months, 6);
    assert.ok(fs.existsSync(init.file) && init.file.startsWith(path.join(home, 'tree')), 'written in KevMind\'s data dir, never in the project');
    assert.ok(!fs.readdirSync(root).some((f) => /kevmind|tree/i.test(f)));
    const t = JSON.parse((await req(`${base}/api/tree?key=${encodeURIComponent(init.key)}`)).body);
    assert.equal(t.tree.profile.areas, 3);
    assert.equal(t.tree.git, undefined, 'the commit table stays on the server');
    assert.deepEqual(JSON.parse((await req(`${base}/api/tree?key=${encodeURIComponent(init.key)}&since=${t.tree.at}`)).body), { unchanged: true, at: t.tree.at, building: false });
    assert.equal((await req(`${base}/api/init`, { method: 'POST', body: JSON.stringify({ root: path.join(dir, 'nowhere') }) })).status, 404);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
