// Memory suggestions (src/suggest.js): each kind from its facts, the exact edit, where it goes, when it counts as
// applied, what happened since, and the server's store and routes. KevMind never writes a project file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSuggestions, projectDocs, isApplied, outcome, retire, COVERED, SUGGEST } from '../src/suggest.js';
import { emptyAggregate, ingest, projectsUnder, sessionsOf } from '../src/experience.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-sg-')));

// A memory report as src/memory.js returns it, for files written here: CLAUDE.md (and nested ones), notes, problems.
function reportOf(root, { problems = [], notes = [], nested = [] } = {}) {
  const dir = path.join(root, '..', 'memory');
  const ins = (display, scope) => { const p = path.join(root, display); const text = fs.readFileSync(p, 'utf8'); return { path: p, display, scope, lines: text.split('\n').length, tokens: Math.round(text.length / 4) }; };
  return {
    instructions: [...(fs.existsSync(path.join(root, 'CLAUDE.md')) ? [ins('CLAUDE.md', 'project')] : []), ...nested.map((d) => ins(d, 'nested'))],
    memory: { dir, display: '~/memory', index: notes.length ? { display: '~/memory/MEMORY.md' } : null, notes: notes.map((n) => ({ path: path.join(dir, n), display: `~/memory/${n}` })) },
    serena: { notes: [] },
    problems,
  };
}
const missing = (file, token, lines, code = 'cited_file_missing', extra = {}) => ({ tier: 'warning', code, file, params: { items: [{ path: token, lines, to: [], ...extra }] } });

// One prompt turn with reads, edits and commands, as the hooks report them.
function turn(agg, root, sid, ts, { reads = [], edits = [], runs = [] } = {}) {
  let t = ts;
  const base = { session_id: sid, cwd: root };
  ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'go' }, t);
  for (const f of reads) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, f) } }, t += 1000);
  for (const f of edits) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } }, t += 1000);
  for (const r of runs) {
    if (r.edit) { ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, r.edit) } }, t += 1000); continue; }
    ingest(agg, r.error
      ? { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: r.cmd }, error: r.error, is_interrupt: false }
      : { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: r.cmd }, tool_response: { stdout: '' } }, t += 1000);
  }
}

test('suggest.js only reads: no writes, no processes', () => {
  const src = fs.readFileSync(new URL('../src/suggest.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(src.match(/\.(?:writeFile\w*|append\w*|unlink\w*|rm\w*|rename\w*|mkdir\w*|copyFile\w*|createWriteStream|open\w*)\s*\(/g), null);
  assert.ok(!/child_process|\bspawn\(|\bexec\w*\(/.test(src.replace(/\.exec\(/g, '')));
  assert.deepEqual([...new Set([...src.matchAll(/\bfs\.(\w+)/g)].map((m) => m[1]))], ['readFileSync']);
});

test('wrong facts: a line about a missing path goes, a moved path is replaced, history and prose get a prompt', () => {
  const root = tmp();
  write(path.join(root, 'CLAUDE.md'), [
    '# Project', '',
    '- `src/gone.ts` - payment gateway',                          // 3: about it: remove
    'Dates are formatted in `src/old/date.ts`.',                   // 4: moved: replace
    'The cache was in `src/old/cache.ts` (now `src/cache.ts`).',   // 5: names its new place: left alone
    'Totals add tax from `src/tax.ts` before rounding.',           // 6: prose, missing: prompt
    '```', 'bun run seed:all', '```',                              // 8: a command that doesn't exist: remove
  ].join('\n'));
  write(path.join(root, '..', 'memory', 'bug.md'), '# Bug\n\nRoot cause: `legacyTotal` rounded twice.\n');
  const report = reportOf(root, {
    notes: ['bug.md'],
    problems: [missing('CLAUDE.md', 'src/gone.ts', [3]), missing('CLAUDE.md', 'src/tax.ts', [6]),
      { tier: 'suggestion', code: 'possibly_moved', file: 'CLAUDE.md', params: { items: [{ path: 'src/old/date.ts', lines: [4], to: ['src/lib/date.ts'] }, { path: 'src/old/cache.ts', lines: [5], to: ['src/cache.ts'] }] } },
      missing('CLAUDE.md', 'bun run seed:all', [8], 'missing_script'),
      missing('~/memory/bug.md', 'legacyTotal', [3], 'stale_name', { date: '2026-09-18' })],
  });
  const list = buildSuggestions({ root, report });
  const byLine = Object.fromEntries(list.map((s) => [`${s.edit.file}:${s.edit.line}`, s]));
  assert.equal(byLine['CLAUDE.md:3'].edit.op, 'remove');
  assert.ok(byLine['CLAUDE.md:3'].edit.tokens < 0, 'a removal saves tokens');
  assert.deepEqual([byLine['CLAUDE.md:4'].edit.op, byLine['CLAUDE.md:4'].edit.text], ['replace', 'Dates are formatted in `src/lib/date.ts`.']);
  assert.equal(byLine['CLAUDE.md:5'], undefined, 'a line that already names the new place mentions the old one on purpose');
  assert.equal(byLine['CLAUDE.md:6'].edit.op, 'prompt');
  assert.match(byLine['CLAUDE.md:6'].prompt, /`src\/tax\.ts` exists nowhere in the project.*Show me the change before saving it/s);
  assert.equal(byLine['CLAUDE.md:8'].edit.op, 'remove');
  const note = byLine['~/memory/bug.md:3'];
  assert.ok(note.history && note.rank > byLine['CLAUDE.md:6'].rank, 'a note may tell history: it ranks after CLAUDE.md');
  assert.match(byLine['CLAUDE.md:3'].prompt, /^In CLAUDE\.md, delete line 3:\n\n- `src\/gone\.ts` - payment gateway\n\nChange nothing else\./);

  // Applied: any change to the stale line counts; until then it doesn't.
  const s = byLine['CLAUDE.md:3'];
  assert.equal(isApplied(s.fact, projectDocs(report)), false);
  write(path.join(root, 'CLAUDE.md'), fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace('- `src/gone.ts` - payment gateway\n', ''));
  assert.equal(isApplied(s.fact, projectDocs(report)), true);
  assert.deepEqual(outcome({ ...s, appliedAt: Date.now() }, new Map()), { status: 'done', tokens: s.edit.tokens });
});

test('a failure that keeps coming back: one short line where the command is mentioned, then measured', () => {
  const root = tmp();
  write(path.join(root, 'CLAUDE.md'), '# Project\n\n## Commands\n\n- `npm test` runs the suite.\n- `npm run lint` checks style.\n');
  const agg = emptyAggregate();
  const err = 'Exit code 1\nError: Cannot find module \'C:/x/dist/index.js\'';
  const fail = [{ cmd: 'npm test', error: err }, { cmd: 'npm run build' }, { cmd: 'npm test' }];
  const now = Date.now();
  for (const d of [9, 8, 7]) turn(agg, root, `f${d}`, now - d * DAY, { edits: ['src/a.ts'], runs: fail });
  const report = reportOf(root);
  const [s] = buildSuggestions({ root, report, agg, now }).filter((x) => x.kind === 'failure');
  assert.equal(s.edit.op, 'add');
  assert.equal(s.edit.after, 5, 'after the last line that mentions the command');
  assert.equal(s.edit.text, '- `npm test` failing with "exit 1: Error: Cannot find module <path>": run `npm run build` first (3 times).');
  assert.ok(s.edit.text.length <= SUGGEST.maxChars);
  assert.equal(s.why.episodes, 3);

  // Applied once a doc names the command and the fix (reworded is fine); then nothing qualifies anew.
  const at = now - 6 * DAY;
  write(path.join(root, 'CLAUDE.md'), `${fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')}- If \`npm test\` can't find dist, \`npm run build\` first.\n`);
  assert.equal(isApplied(s.fact, projectDocs(report)), true);
  assert.equal(buildSuggestions({ root, report: reportOf(root), agg, now }).filter((x) => x.kind === 'failure').length, 0);

  // Five sessions on three days after it, the command passing: helped. Failing again: no change, and then a removal.
  const rec = { ...s, appliedAt: at };
  for (let i = 0; i < 5; i++) turn(agg, root, `ok${i}`, now - (5 - Math.floor(i / 2)) * DAY + i * 60_000, { edits: ['src/b.ts'], runs: [{ cmd: 'npm test' }] });
  const sessions = () => sessionsOf(projectsUnder(agg, root));
  assert.deepEqual(outcome(rec, sessions(), now), { before: 3, beforeSessions: 3, after: 0, afterSessions: 5, status: 'helped' });
  turn(agg, root, 'again', now - DAY, { edits: ['src/c.ts'], runs: fail });
  const o = outcome(rec, sessions(), now);
  assert.equal(o.status, 'no_change');
  const r = retire(rec, o, projectDocs(reportOf(root)), root);
  assert.equal(r.edit.op, 'remove');
  assert.match(r.edit.old, /npm run build/);
});

test('files read every session without being edited: a line from the exports and a co-change partner, and a waiting verdict', () => {
  const root = tmp();
  write(path.join(root, 'CLAUDE.md'), '# Project\n\n- `src/` holds the app.\n');
  const agg = emptyAggregate();
  const now = Date.now();
  // Six sessions on four days read src/state.ts and never edit it; a seventh edits it (it needs a read first: not counted).
  for (let i = 0; i < 6; i++) turn(agg, root, `s${i}`, now - (10 - Math.floor(i * 0.7)) * DAY + i * 60_000, { reads: ['src/state.ts', 'src/x.ts'], edits: ['src/x.ts'] });
  turn(agg, root, 'edit', now - 2 * DAY, { reads: ['src/state.ts'], edits: ['src/state.ts'] });
  const commits = [0, 1, 2].map((i) => [`c${i}`, now - i * DAY, 0, '', [0, 1]]);
  const tree = { months: 12, areas: [{ name: 'src', files: [{ f: 'src/state.ts', names: ['createState', 'applyEvent', 'summary'] }], git: {}, claude: {} }], gaps: { quiet: [] }, docs: [], git: { files: ['src/state.ts', 'src/app.ts'], commits } };
  const [s] = buildSuggestions({ root, report: reportOf(root), tree, agg, now }).filter((x) => x.kind === 'orient');
  assert.equal(s.why.file, 'src/state.ts');
  assert.deepEqual([s.why.n, s.why.of], [6, 7]);
  assert.equal(s.edit.text, '- `src/state.ts`: exports createState, applyEvent, summary; changes with `src/app.ts`.');
  assert.equal(s.edit.after, 3, 'next to the line about its folder');
  assert.ok(!buildSuggestions({ root, report: reportOf(root), tree, agg, now }).some((x) => x.why.file === 'src/x.ts'), 'a file edited in the same session is not orientation');
  const o = outcome({ ...s, appliedAt: now - DAY }, sessionsOf(projectsUnder(agg, root)), now);
  assert.equal(o.status, 'waiting');
  assert.deepEqual([o.have, o.need, o.needDays], [0, SUGGEST.verdictSessions, SUGGEST.verdictDays]);
});

test('where an added line goes: the nearest CLAUDE.md, a memory note when it would pass 200 lines, a new CLAUDE.md when there is none', () => {
  const root = tmp();
  write(path.join(root, 'CLAUDE.md'), `# Project\n${'- a rule\n'.repeat(SUGGEST.oversizedLines - 1)}`);
  write(path.join(root, 'frontend', 'CLAUDE.md'), '# Frontend\n\n- Screens live in `src/screens/`.\n');
  const commits = [];
  const area = (name, fixes) => ({ name, files: [{ f: `${name}/a.ts`, names: [], git: { fix: fixes, n90: 2 } }, { f: `${name}/b.ts`, names: [], git: { fix: 1, n90: 1 } }], git: { fixes, n90: 3, commits: 9, dormant: false }, claude: {} });
  const tree = { months: 12, areas: [area('frontend/src/screens', 6), area('backend/src', 5)], gaps: { quiet: [0, 1] }, docs: [], git: { files: [], commits } };
  const list = buildSuggestions({ root, report: reportOf(root, { nested: ['frontend/CLAUDE.md'] }), tree });
  const front = list.find((s) => s.why.area === 'frontend/src/screens'), back = list.find((s) => s.why.area === 'backend/src');
  assert.deepEqual([front.edit.op, front.edit.file, front.edit.after], ['add', 'frontend/CLAUDE.md', 3], 'the nested file, after the line naming the folder from its own root');
  assert.equal(front.edit.text, '- `frontend/src/screens/` is fix-prone: 6 fix commits in 12 months, mostly `a.ts`, `b.ts`.');
  assert.equal(back.edit.op, 'note', 'the root CLAUDE.md is at its target: a memory note');
  assert.match(back.edit.index, /^- \[backend\/src\]\(area-backend-src\.md\) — fix-prone area$/);
  assert.match(back.edit.body, /^---\nname: backend\/src\ndescription: fix-prone area\ntype: project\n---\n\n- `backend\/src\/` is fix-prone/);
  assert.ok(back.edit.tokens < 30, 'a note costs only its index line at every start');

  const bare = tmp();
  const [created] = buildSuggestions({ root: bare, report: reportOf(bare), tree: { ...tree, gaps: { quiet: [1] } } });
  assert.deepEqual([created.edit.op, created.edit.file, created.edit.create], ['add', 'CLAUDE.md', true]);
  assert.match(created.prompt, /^Create CLAUDE\.md with this line:/);
});

test('trims: the index line of a note nobody opens, and a section that only cites dormant code', () => {
  const root = tmp();
  write(path.join(root, 'CLAUDE.md'), '# Project\n\n## Legacy export\n\nThe CSV export lives in `old/export.ts`.\nIt uses `old/csv.ts`.\n\n## Today\n\nEverything else.\n');
  write(path.join(root, '..', 'memory', 'MEMORY.md'), '- [Style](style.md) — commit style\n- [Old](old.md) — an old idea\n');
  write(path.join(root, '..', 'memory', 'old.md'), '# Old\n');
  const report = reportOf(root, { notes: ['old.md'], problems: [{ tier: 'suggestion', code: 'never_read', file: '~/memory/old.md', params: { days: 14 } }] });
  const tree = {
    months: 12, gaps: { quiet: [] }, git: { files: [], commits: [] },
    areas: [{ name: 'old', files: [], git: { dormant: true, last: Date.UTC(2025, 0, 5, 12) }, claude: { read: 0, edit: 0 } }],
    docs: [{ kind: 'instructions', id: 'CLAUDE.md § Legacy export', file: 'CLAUDE.md', title: 'Legacy export', cited: [0], areas: [0] }],
  };
  const list = buildSuggestions({ root, report, tree });
  const idx = list.find((s) => s.why.code === 'never_read'), sec = list.find((s) => s.why.code === 'dormant');
  assert.deepEqual([idx.edit.op, idx.edit.line, idx.edit.old], ['remove', 2, '- [Old](old.md) — an old idea']);
  assert.deepEqual([sec.edit.op, sec.edit.from, sec.edit.to], ['remove_range', 3, 6]);
  assert.equal(sec.why.last, '2025-01-05');
  assert.ok(list.every((s) => s.kind === 'trim'));
});

test('the problems a suggestion covers leave the Memory tab list', () => {
  for (const c of ['cited_file_missing', 'possibly_moved', 'stale_name', 'missing_script', 'never_read', 'busy_area_no_notes']) assert.ok(COVERED.has(c), c);
  for (const c of ['broken_link', 'index_truncated', 'instructions_oversized', 'many_notes_area', 'possible_overlap']) assert.ok(!COVERED.has(c), c);
});

const req = (url, opts = {}) => new Promise((resolve, reject) => {
  const r = http.request(url, { method: opts.method || 'GET', headers: opts.body ? { 'content-type': 'application/json' } : {} }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  r.on('error', reject);
  r.end(opts.body);
});

test('the server: suggestions per project, dismiss in KevMind\'s own store, and no project file touched', async () => {
  const dir = tmp(), root = path.join(dir, 'shop'), home = path.join(dir, 'kevmind'), fakeHome = path.join(dir, 'user');
  write(path.join(root, 'CLAUDE.md'), '# Shop\n\n- `src/gone.ts` - the old cart\n');
  write(path.join(root, 'src', 'cart.ts'), 'export const cart = 1;\n');
  const before = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  const port = 47800 + Math.floor(Math.random() * 90), base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, KEVMIND_HOME: home, KEVMIND_PORT: String(port), KEVMIND_AUTOSTART: '0', USERPROFILE: fakeHome, HOME: fakeHome };
  const child = spawn(process.execPath, [path.join(HERE, '..', 'bin', 'kevmind.js'), 'start'], { env, stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { try { await req(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await req(`${base}/events`, { method: 'POST', body: JSON.stringify({ session_id: 'sg-1', cwd: root, hook_event_name: 'SessionStart', source: 'startup' }) });
    let key = null; // the event reaches the log a moment after the reply
    for (let i = 0; i < 50 && !key; i++) { key = JSON.parse((await req(`${base}/api/memory`)).body).projects.find((p) => p.name === 'shop')?.key; if (!key) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(key, 'the project appears after its first session event');
    const q = encodeURIComponent(key);
    const mem = JSON.parse((await req(`${base}/api/memory/project?key=${q}`)).body);
    assert.ok(!mem.problems.some((p) => COVERED.has(p.code)), 'covered problems are not listed twice');
    const sg = JSON.parse((await req(`${base}/api/suggestions?key=${q}`)).body);
    const fix = sg.shown.find((s) => s.edit.old === '- `src/gone.ts` - the old cart');
    assert.equal(fix.edit.op, 'remove');
    assert.equal((await req(`${base}/api/suggestions/dismiss`, { method: 'POST' })).status, 403, 'JSON only');
    assert.deepEqual(JSON.parse((await req(`${base}/api/suggestions/dismiss`, { method: 'POST', body: JSON.stringify({ id: fix.id, reason: 'history' }) })).body), { ok: true });
    const after = JSON.parse((await req(`${base}/api/suggestions?key=${q}`)).body);
    assert.ok(!after.shown.some((s) => s.id === fix.id));
    assert.equal(after.dismissed, 1);
    const store = JSON.parse(fs.readFileSync(path.join(home, 'suggestions.json'), 'utf8'));
    assert.equal(store.items[fix.id].dismissed.reason, 'history');
    assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), before, 'the project file is untouched');
    assert.deepEqual(fs.readdirSync(root).sort(), ['CLAUDE.md', 'src']);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
