// Experience insights counted in work episodes (a prompt turn ending with an edit), plus git: thresholds, per-project
// scope, failures with a fix, git co-change, hubs and nested repos. The memory suggestions are built on these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emptyAggregate, ingest, refreshGit, partners, readFirst, failures, gate, commandFamily, errorSignature, THRESHOLDS,
} from '../src/experience.js';
import { keyOf } from '../src/memory.js';
import { hasGit } from './memory-fixture.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-exp-')));
const projOf = (agg, root) => agg.projects[keyOf(root)];
const id = (p, f) => p.files.indexOf(f);
const names = (p, list) => list.map((x) => p.files[x.f]);

// One prompt turn: a user prompt, then reads, edits and commands a few seconds apart. Returns the last timestamp.
function turn(agg, root, sid, ts, { prompt = 'do the thing', reads = [], edits = [], runs = [] } = {}) {
  let t = ts;
  const base = { session_id: sid, cwd: root };
  if (prompt !== null) ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt }, t);
  for (const f of reads) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, f) } }, t += 1000);
  for (const f of edits) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } }, t += 1000);
  for (const r of runs) {
    if (r.edit) { ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, r.edit) } }, t += 1000); continue; }
    const e = r.error
      ? { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: r.cmd }, error: r.error, is_interrupt: false }
      : { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: r.cmd }, tool_response: { stdout: '' } };
    ingest(agg, e, t += 1000);
  }
  return t;
}

test('one long session on one day never qualifies; the same pattern on a second day does', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 5; i++) turn(agg, root, 'long', NOW - 5 * DAY + i * 60_000, { edits: ['a.ts', 'b.ts'] });
  const p = projOf(agg, root);
  assert.deepEqual(partners(p, id(p, 'a.ts'), NOW), [], '5 episodes on 1 day');
  turn(agg, root, 'long', NOW - 2 * DAY, { edits: ['a.ts', 'b.ts'] }); // same session, a later day
  const [x] = partners(p, id(p, 'a.ts'), NOW);
  assert.equal(p.files[x.f], 'b.ts');
  assert.deepEqual([x.s.n, x.s.days], [6, 2]);
  assert.deepEqual(gate(p, NOW), { episodes: 6, days: 2, commits: 0, gitOk: false });
});

test('turns without edits are not episodes; compactions and system prompts do not split one', () => {
  const root = tmp();
  const agg = emptyAggregate();
  const sid = 's';
  // A read-only turn, then a turn whose edit comes after a compaction and a task notification.
  turn(agg, root, sid, NOW - 3 * DAY, { reads: ['x.ts'] });
  let t = turn(agg, root, sid, NOW - 3 * DAY + 600_000, { edits: ['a.ts'] });
  ingest(agg, { session_id: sid, cwd: root, hook_event_name: 'PreCompact', trigger: 'auto' }, t += 1000);
  ingest(agg, { session_id: sid, cwd: root, hook_event_name: 'SessionStart', source: 'compact' }, t += 1000);
  ingest(agg, { session_id: sid, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: '<task-notification><status>completed</status></task-notification>' }, t += 1000);
  ingest(agg, { session_id: sid, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'b.ts') } }, t += 1000);
  const s = projOf(agg, root).sessions[sid];
  assert.equal(s.eps.length, 2, 'two turns');
  assert.deepEqual(s.eps.map((ep) => ep.ed.length), [0, 2], 'a.ts and b.ts land in the same episode');
  assert.equal(gate(projOf(agg, root), NOW).episodes, 1, 'the read-only turn is not an episode');
});

test('without prompts, more than 30 minutes of silence starts a new episode', () => {
  const root = tmp();
  const agg = emptyAggregate();
  const t = NOW - DAY;
  for (const [dt, f] of [[0, 'a.ts'], [10 * 60_000, 'b.ts'], [45 * 60_000, 'c.ts'], [50 * 60_000, 'd.ts']]) {
    ingest(agg, { session_id: 'np', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } }, t + dt);
  }
  assert.deepEqual(projOf(agg, root).sessions.np.eps.map((ep) => ep.ed.length), [2, 2]);
});

test('co-editing and reading first count at their thresholds, and not one episode below them', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < THRESHOLDS.coEditEpisodes; i++) turn(agg, root, 'one-session', NOW - (i + 1) * DAY, { reads: ['schema.ts'], edits: ['a.ts', 'b.ts'] });
  turn(agg, root, 'one-session', NOW - 4 * DAY, { edits: ['a.ts'] }); // a.ts alone once: 3 of its 4 episodes
  const p = projOf(agg, root);
  assert.deepEqual(names(p, partners(p, id(p, 'a.ts'), NOW)), ['b.ts']);
  const [first] = readFirst(p, id(p, 'a.ts'), NOW);
  assert.deepEqual([p.files[first.f], first.n, first.days], ['schema.ts', 3, 3]);

  const below = emptyAggregate();
  for (let i = 0; i < THRESHOLDS.coEditEpisodes - 1; i++) turn(below, root, 'one-session', NOW - (i + 1) * DAY, { edits: ['a.ts', 'b.ts'] });
  const q = projOf(below, root);
  assert.deepEqual(partners(q, id(q, 'a.ts'), NOW), []);
});

test('evidence stays inside its project', () => {
  const a = tmp();
  const b = tmp();
  const agg = emptyAggregate();
  turn(agg, a, 'a1', NOW - DAY, { edits: ['own.ts'] });
  for (let i = 0; i < 4; i++) turn(agg, b, `b-${i}`, NOW - (i + 1) * DAY, { edits: ['shared.ts', 'secret-partner.ts'] });
  const pa = projOf(agg, a), pb = projOf(agg, b);
  assert.equal(id(pa, 'shared.ts'), -1, 'project B files never show up in project A');
  assert.deepEqual(names(pb, partners(pb, id(pb, 'shared.ts'), NOW)), ['secret-partner.ts']);
});

test('a recurring failure needs 2 episodes on 2 days and the same fix; grep with no match is not a failure', () => {
  const root = tmp();
  const agg = emptyAggregate();
  const err = 'Exit code 1\nError: Cannot find module \'C:/x/dist/index.js\'';
  const runs = [{ cmd: 'cd app && npm test -- --watch=false', error: err }, { cmd: 'npm run build' }, { edit: 'src/config.ts' }, { cmd: 'npm test' }, { cmd: 'grep -rn foo src', error: 'Exit code 1' }];
  turn(agg, root, 'f', NOW - 3 * DAY, { runs });
  turn(agg, root, 'f', NOW - 3 * DAY + 3_600_000, { runs }); // a second episode, same day
  const p = projOf(agg, root);
  assert.deepEqual(failures(p, NOW), [], 'two episodes on one day are not enough');
  turn(agg, root, 'f', NOW - 2 * DAY, { runs });
  const [f, ...rest] = failures(p, NOW);
  assert.equal(rest.length, 0, 'grep with no match is not a failure');
  assert.deepEqual([f.fam, f.sig, f.episodes, f.days], ['npm test', 'exit 1: Error: Cannot find module <path>', 3, 2]);
  assert.ok((f.fix.kind === 'file' && f.fix.name === 'src/config.ts') || (f.fix.kind === 'cmd' && f.fix.name === 'npm run build'), JSON.stringify(f.fix));
  assert.equal(f.fix.n, 3);
  assert.equal(commandFamily('FOO=1 npx tsc --noEmit | tail'), 'npx tsc');
  assert.equal(errorSignature('Exit code 2\n  src/a.ts(12,3): error TS2304'), 'exit 2: <path>(#,#): error TS#');
});

test('a shell syntax mistake in the command is not a known project failure, however often it repeats', () => {
  const root = tmp();
  const agg = emptyAggregate();
  // The case seen in KevMind's own history: a heredoc left open, "fixed" by running sed, in 4 episodes on 3 days.
  const eof = "Exit code 2\n/usr/bin/bash: -c: line 108: unexpected EOF while looking for matching `''";
  const heredoc = { cmd: "cat > patch.cjs <<'EOF'\nconst a = `x`;\nEOF", error: eof };
  const others = [
    { cmd: "node -e \"console.log('a')\" | grep (", error: "Exit code 2\n/usr/bin/bash: -c: line 1: syntax error near unexpected token `('" },
    { cmd: 'nmp test', error: 'Exit code 127\n/usr/bin/bash: line 1: nmp: command not found' },
    { cmd: "echo 'oops", error: "Exit code 1\nzsh:1: unmatched '" },
  ];
  const real = { cmd: 'npm test', error: 'Exit code 1\nFAIL test/cart.test.js' };
  const runs = [heredoc, { cmd: 'sed -i s/a/b/ patch.cjs' }, { cmd: 'cat patch.cjs' }, ...others, { cmd: 'npm test' }, real, { edit: 'src/cart.js' }, { cmd: 'npm test' }];
  turn(agg, root, 'q', NOW - 4 * DAY, { runs });
  turn(agg, root, 'q', NOW - 3 * DAY, { runs });
  turn(agg, root, 'q', NOW - 2 * DAY, { runs });
  turn(agg, root, 'q', NOW - 2 * DAY + 3_600_000, { runs });
  const all = failures(projOf(agg, root), NOW);
  assert.deepEqual(all.map((f) => [f.fam, f.sig]), [['npm test', 'exit 1: FAIL <path>']], 'only the real failure');
});

test('git co-change works from day one; lockfiles and binaries are never partners', { skip: !hasGit() && 'needs git' }, async () => {
  const root = tmp();
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
  run('-c', 'init.defaultBranch=main', 'init');
  const commit = (files, msg) => {
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.appendFileSync(path.join(root, f), msg + '\n'); }
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
  };
  for (let i = 0; i < 4; i++) commit(['api/routes.ts', 'api/schema.ts'], i % 2 ? `fix: route ${i}` : `feat: route ${i}`);
  for (let i = 0; i < 18; i++) commit([`other/f${i}.ts`], `chore ${i}`);
  commit(['package-lock.json', 'api/routes.ts', 'docs/diagram.pdf'], 'deps');

  const agg = emptyAggregate();
  turn(agg, root, 'one', Date.now() - DAY, { edits: ['README.md'] });
  const p = projOf(agg, root);
  await refreshGit(p);
  const list = partners(p, id(p, 'api/routes.ts'), Date.now());
  assert.deepEqual(names(p, list), ['api/schema.ts']);
  assert.deepEqual([list[0].g.n, list[0].g.of], [4, 5]);

  for (let i = 0; i < 4; i++) turn(agg, root, 'work', Date.now() - (i + 1) * DAY, { edits: ['api/routes.ts', 'api/handler.ts'] });
  assert.deepEqual(names(p, partners(p, id(p, 'api/routes.ts'), Date.now())), ['api/handler.ts', 'api/schema.ts'], 'episode evidence ranks above git');
});

test('a hub file still counts as a partner when it goes with the file far more often than with everything', () => {
  // style.css is edited in 7 of 12 episodes (a hub, over 40%), but in 4 of the 4 that edit state.js.
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 4; i++) turn(agg, root, 'x', NOW - (i + 1) * DAY, { edits: ['state.js', 'style.css'] });
  for (let i = 0; i < 3; i++) turn(agg, root, 'x', NOW - (i + 5) * DAY, { edits: ['style.css', `page${i}.html`] });
  for (let i = 0; i < 5; i++) turn(agg, root, 'x', NOW - (i + 8) * DAY, { edits: [`other${i}.js`] });
  const p = projOf(agg, root);
  assert.deepEqual(names(p, partners(p, id(p, 'state.js'), NOW)), ['style.css']);

  // A hub that goes with the file only about as often as with everything stays out: 8 of 12, and 2 of 3 here.
  const flat = emptyAggregate();
  for (let i = 0; i < 2; i++) turn(flat, root, 'y', NOW - (i + 1) * DAY, { edits: ['a.ts', 'hub.css'] });
  turn(flat, root, 'y', NOW - 3 * DAY, { edits: ['a.ts'] });
  for (let i = 0; i < 6; i++) turn(flat, root, 'y', NOW - (i + 4) * DAY, { edits: ['hub.css', `x${i}.ts`] });
  for (let i = 0; i < 3; i++) turn(flat, root, 'y', NOW - (i + 10) * DAY, { edits: [`y${i}.ts`] });
  const q = projOf(flat, root);
  assert.ok(!names(q, partners(q, id(q, 'a.ts'), NOW)).includes('hub.css'));
});

test('work on a nested repo is filed under that repo, with episodes that follow the session prompts', () => {
  const root = tmp();
  for (const r of ['', 'frontend']) fs.mkdirSync(path.join(root, r, '.git'), { recursive: true });
  const agg = emptyAggregate();
  for (let i = 0; i < 3; i++) turn(agg, root, 'long', NOW - (i + 2) * DAY, { edits: ['frontend/a.ts', 'frontend/b.ts', 'notes.md'] });
  turn(agg, root, 'long', NOW - (2 * DAY) + 60_000, { reads: ['frontend/a.ts'] }); // a read-only turn: no episode anywhere
  const front = projOf(agg, path.join(root, 'frontend'));
  assert.deepEqual(front.files.sort(), ['a.ts', 'b.ts']);
  assert.deepEqual(projOf(agg, root).files, ['notes.md']);
  assert.deepEqual(gate(front, NOW), { episodes: 3, days: 3, commits: 0, gitOk: false });
  assert.deepEqual(names(front, partners(front, id(front, 'a.ts'), NOW)), ['b.ts']);
});
