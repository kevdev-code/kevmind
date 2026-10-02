// Experience insights counted in work episodes (a prompt turn ending with an edit), plus git: thresholds,
// "no data" answers, per-project scope, the 400-token cap, failures with a fix, git co-change, and measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emptyAggregate, ingest, refreshGit, answerFileContext, answerFileHistory, answerKnownFailures, measure, preview, gate,
  commandFamily, errorSignature, NO_DATA, THRESHOLDS,
} from '../src/experience.js';
import { keyOf } from '../src/memory.js';
import { hasGit } from './memory-fixture.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-exp-')));
const projOf = (agg, root) => agg.projects[keyOf(root)];

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
  const one = answerFileContext(p, 'P', ['a.ts'], NOW);
  assert.ok(one.startsWith(NO_DATA), one);
  assert.match(one, /edited in 5 episodes on 1 day/);

  turn(agg, root, 'long', NOW - 2 * DAY, { edits: ['a.ts', 'b.ts'] }); // same session, a later day
  assert.match(answerFileContext(p, 'P', ['a.ts'], NOW), /changes with `b\.ts` \(episodes: 6 on 2 days; last \d{4}-\d\d-\d\d\)/);
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

test('co-editing is served at its thresholds, with no project-wide gate, and not one episode below them', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < THRESHOLDS.coEditEpisodes; i++) turn(agg, root, 'one-session', NOW - (i + 1) * DAY, { reads: ['schema.ts'], edits: ['a.ts', 'b.ts'] });
  turn(agg, root, 'one-session', NOW - 4 * DAY, { edits: ['a.ts'] }); // a.ts alone once: 3 of its 4 episodes
  const p = projOf(agg, root);
  const text = answerFileContext(p, 'P', ['a.ts'], NOW);
  assert.match(text, /changes with `b\.ts` \(episodes: 3 on 3 days/);
  assert.match(text, /usually read first: `schema\.ts` \(episodes: 3 on 3 days/);

  const below = emptyAggregate();
  for (let i = 0; i < THRESHOLDS.coEditEpisodes - 1; i++) turn(below, root, 'one-session', NOW - (i + 1) * DAY, { edits: ['a.ts', 'b.ts'] });
  const t2 = answerFileContext(projOf(below, root), 'P', ['a.ts'], NOW);
  assert.ok(t2.startsWith(NO_DATA) && t2.includes('no pattern above the thresholds'), t2);
});

test('answers stay inside the project they are asked from', () => {
  const a = tmp();
  const b = tmp();
  const agg = emptyAggregate();
  turn(agg, a, 'a1', NOW - DAY, { edits: ['own.ts'] });
  for (let i = 0; i < 4; i++) turn(agg, b, `b-${i}`, NOW - (i + 1) * DAY, { edits: ['shared.ts', 'secret-partner.ts'] });
  const text = answerFileContext(projOf(agg, a), 'A', ['shared.ts'], NOW);
  assert.ok(!text.includes('secret-partner'), 'project B co-edits never show up in project A');
  assert.match(text, /`shared\.ts`: no data/);
  assert.match(answerFileContext(projOf(agg, b), 'B', ['shared.ts'], NOW), /secret-partner/);
});

test('every answer stays under the 400-token cap, estimated as characters / 4', () => {
  const root = tmp();
  const agg = emptyAggregate();
  const files = Array.from({ length: 12 }, (_, i) => `src/very/long/directory/name/for/testing/module-${i}-with-a-long-name.ts`);
  for (let i = 0; i < 6; i++) turn(agg, root, 'big', NOW - (i + 1) * DAY, { reads: files.slice(0, 4).map((f) => f.replace('.ts', '.spec.ts')), edits: files });
  const text = answerFileContext(projOf(agg, root), 'P', files.slice(0, 10), NOW);
  assert.ok(text.length / 4 <= THRESHOLDS.maxTokens, `${Math.round(text.length / 4)} tokens`);
  assert.match(text, /left out to stay under 400 tokens/);
});

test('a recurring failure needs 2 episodes on 2 days and the same fix; grep with no match is not a failure', () => {
  const root = tmp();
  const agg = emptyAggregate();
  const err = 'Exit code 1\nError: Cannot find module \'C:/x/dist/index.js\'';
  const runs = [{ cmd: 'cd app && npm test -- --watch=false', error: err }, { cmd: 'npm run build' }, { edit: 'src/config.ts' }, { cmd: 'npm test' }, { cmd: 'grep -rn foo src', error: 'Exit code 1' }];
  turn(agg, root, 'f', NOW - 3 * DAY, { runs });
  turn(agg, root, 'f', NOW - 3 * DAY + 3_600_000, { runs }); // a second episode, same day
  const p = projOf(agg, root);
  assert.ok(answerKnownFailures(p, 'P', 'npm test', NOW).startsWith(NO_DATA), 'two episodes on one day are not enough');
  turn(agg, root, 'f', NOW - 2 * DAY, { runs });
  const text = answerKnownFailures(p, 'P', 'npm test', NOW);
  assert.match(text, /`npm test` failed with "exit 1: Error: Cannot find module <path>" \(episodes: 3 on 2 days/);
  assert.match(text, /3 times the next success came after (editing `src\/config\.ts`|running `npm run build`)/);
  assert.ok(!/grep/.test(answerKnownFailures(p, 'P', '', NOW)));
  assert.equal(commandFamily('FOO=1 npx tsc --noEmit | tail'), 'npx tsc');
  assert.equal(errorSignature('Exit code 2\n  src/a.ts(12,3): error TS2304'), 'exit 2: <path>(#,#): error TS#');
});

test('a shell syntax mistake in the command is not a known project failure, however often it repeats', async () => {
  const root = tmp();
  const agg = emptyAggregate();
  // The case seen in KevMind's own history: a heredoc left open, "fixed" by running sed, in 4 episodes on 3 days.
  const eof = "Exit code 2\n/usr/bin/bash: -c: line 108: unexpected EOF while looking for matching `''";
  const heredoc = { cmd: "cat > patch.cjs <<'EOF'\nconst a = `x`;\nEOF", error: eof };
  const others = [
    { cmd: "node -e \"console.log('a')\" | grep (", error: "Exit code 2\n/usr/bin/bash: -c: line 1: syntax error near unexpected token `('" },
    { cmd: 'nmp test', error: 'Exit code 127\n/usr/bin/bash: line 1: nmp: command not found' },
  ];
  const real = { cmd: 'npm test', error: 'Exit code 1\nFAIL test/cart.test.js' };
  const runs = [heredoc, { cmd: 'sed -i s/a/b/ patch.cjs' }, { cmd: 'cat patch.cjs' }, ...others, { cmd: 'npm test' }, real, { edit: 'src/cart.js' }, { cmd: 'npm test' }];
  turn(agg, root, 'q', NOW - 4 * DAY, { runs });
  turn(agg, root, 'q', NOW - 3 * DAY, { runs });
  turn(agg, root, 'q', NOW - 2 * DAY, { runs });
  turn(agg, root, 'q', NOW - 2 * DAY + 3_600_000, { runs });
  const p = projOf(agg, root);
  assert.ok(answerKnownFailures(p, 'P', 'cat', NOW).startsWith(NO_DATA), 'the open heredoc is not served');
  for (const cmd of ['node', 'nmp test']) assert.ok(answerKnownFailures(p, 'P', cmd, NOW).startsWith(NO_DATA), `${cmd}: a shell mistake is not served`);
  const all = answerKnownFailures(p, 'P', '', NOW);
  assert.match(all, /`npm test` failed with "exit 1: FAIL <path>"/, 'a real failure still is');
  assert.ok(!/unexpected EOF|syntax error|command not found/.test(all), all);
  assert.deepEqual(preview(p, NOW).failures.map((f) => f.fam), ['npm test'], 'and the Experience panel shows the same');
  const { gatherFacts, briefingText } = await import('../src/briefing.js');
  const facts = await gatherFacts({ agg, root, name: 'P', sid: 'new', source: 'startup', now: NOW, git: async () => null });
  const { text } = briefingText(facts);
  assert.ok(!/`cat`|unexpected EOF/.test(text), 'the briefing names no shell mistake');
});

test('git co-change works from day one; episode evidence ranks above git', { skip: !hasGit() && 'needs git' }, async () => {
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
  const text = answerFileContext(p, 'P', ['api/routes.ts'], Date.now());
  assert.match(text, /changes with `api\/schema\.ts` \(git: 4 of 5 commits/);
  assert.ok(!text.includes('package-lock') && !text.includes('.pdf'), 'lockfiles and binaries are not partners');
  assert.match(answerFileHistory(p, 'P', 'api/routes.ts', Date.now()), /git: changed in 5 commits .*, 2 labeled as fixes/);

  for (let i = 0; i < 4; i++) turn(agg, root, 'work', Date.now() - (i + 1) * DAY, { edits: ['api/routes.ts', 'api/handler.ts'] });
  const both = answerFileContext(p, 'P', ['api/routes.ts'], Date.now());
  assert.ok(both.indexOf('api/handler.ts') < both.indexOf('api/schema.ts'), both);
  assert.match(both, /`api\/handler\.ts` \(episodes: 4 on 4 days/);
});

test('calls are measured from the hook events: tokens, "no data", and whether a suggestion was followed', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 3; i++) turn(agg, root, 'base', NOW - (i + 2) * DAY, { edits: ['a.ts', 'b.ts'] });
  const t = NOW - DAY;
  const base = { session_id: 'm', cwd: root };
  ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'change a.ts' }, t - 1000);
  ingest(agg, { ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_kevmind_experience__file_context', duration_ms: 12,
    tool_response: [{ type: 'text', text: 'KevMind history for P:\n- `a.ts`:\n  - changes with `b.ts` (episodes: 3 on 3 days)' }] }, t);
  ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, 'b.ts') } }, t + 60_000);
  ingest(agg, { ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_kevmind_experience__known_failures', tool_response: [{ type: 'text', text: `${NO_DATA} nothing` }] }, t + 120_000);
  const p = projOf(agg, root);
  const m = measure(p, NOW);
  assert.equal(m.calls, 2);
  assert.equal(m.noData, 1);
  assert.equal(m.withSuggestions, 1);
  assert.equal(m.followRate, 1);
  assert.equal(m.verdict, 'collecting');
  const pv = preview(p, NOW);
  assert.equal(pv.episodePairs, 1);
  assert.equal(pv.nearest, null);
});

test('the panel says what is missing when no pair qualifies yet', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 4; i++) turn(agg, root, 'x', NOW - DAY + i * 60_000, { edits: ['a.ts', 'b.ts'] });
  const pv = preview(projOf(agg, root), NOW);
  assert.equal(pv.episodePairs, 0);
  assert.deepEqual(pv.nearest, { a: 'a.ts', b: 'b.ts', n: 4, days: 1, of: 4 });
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
  assert.match(answerFileContext(front, 'Odon/frontend', ['a.ts'], NOW, { prefix: 'frontend/' }), /changes with `frontend\/b\.ts` \(episodes: 3 on 3 days/);

  // A call citing frontend files (relative to the session root) is measured in the frontend repo; a new session,
  // since a file already touched earlier in a session doesn't count as following a suggestion.
  const t = NOW - DAY;
  ingest(agg, { session_id: 'next', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'next' }, t - 1000);
  ingest(agg, { session_id: 'next', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_kevmind_experience__file_context',
    tool_response: [{ type: 'text', text: 'KevMind history for Odon/frontend:\n- `frontend/a.ts`:\n  - changes with `frontend/b.ts`' }] }, t);
  ingest(agg, { session_id: 'next', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'frontend', 'b.ts') } }, t + 60_000);
  const m = measure(front, NOW);
  assert.deepEqual([m.calls, m.withSuggestions, m.followed], [1, 1, 1]);
  assert.equal(measure(projOf(agg, root), NOW).calls, 0);
});

test('a hub file still counts as a partner when it goes with the file far more often than with everything', () => {
  // style.css is edited in 7 of 12 episodes (a hub, over 40%), but in 4 of the 4 that edit state.js.
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 4; i++) turn(agg, root, 'x', NOW - (i + 1) * DAY, { edits: ['state.js', 'style.css'] });
  for (let i = 0; i < 3; i++) turn(agg, root, 'x', NOW - (i + 5) * DAY, { edits: ['style.css', `page${i}.html`] });
  for (let i = 0; i < 5; i++) turn(agg, root, 'x', NOW - (i + 8) * DAY, { edits: [`other${i}.js`] });
  const p = projOf(agg, root);
  assert.match(answerFileContext(p, 'P', ['state.js'], NOW), /changes with `style\.css` \(episodes: 4 on 4 days; last/);

  // A hub that goes with the file only about as often as with everything stays out: 8 of 12, and 2 of 3 here.
  const flat = emptyAggregate();
  for (let i = 0; i < 2; i++) turn(flat, root, 'y', NOW - (i + 1) * DAY, { edits: ['a.ts', 'hub.css'] });
  turn(flat, root, 'y', NOW - 3 * DAY, { edits: ['a.ts'] });
  for (let i = 0; i < 6; i++) turn(flat, root, 'y', NOW - (i + 4) * DAY, { edits: ['hub.css', `x${i}.ts`] });
  for (let i = 0; i < 3; i++) turn(flat, root, 'y', NOW - (i + 10) * DAY, { edits: [`y${i}.ts`] });
  assert.ok(!/hub\.css/.test(answerFileContext(projOf(flat, root), 'P', ['a.ts'], NOW)));
});

test('two asked files that change together are reported once, with both sources on one line', { skip: !hasGit() && 'needs git' }, async () => {
  const root = tmp();
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
  run('-c', 'init.defaultBranch=main', 'init');
  const commit = (files, msg) => {
    for (const f of files) fs.appendFileSync(path.join(root, f), msg + '\n');
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
  };
  for (let i = 0; i < 4; i++) commit(['state.js', 'style.css'], `ui ${i}`);
  for (let i = 0; i < 18; i++) commit([`f${i}.js`], `chore ${i}`);
  const agg = emptyAggregate();
  const now = Date.now();
  for (let i = 0; i < 3; i++) turn(agg, root, 's', now - (i + 1) * DAY, { edits: ['state.js', 'style.css'] });
  const p = projOf(agg, root);
  await refreshGit(p, now);
  const text = answerFileContext(p, 'P', ['style.css', 'state.js'], now);
  const together = text.match(/usually change together/g) || [];
  assert.equal(together.length, 1, text);
  assert.match(text, /- `state\.js` and `style\.css` usually change together \(episodes: 3 on 3 days; git: 4 of 4 commits; last \d{4}-\d\d-\d\d\)/);
  assert.ok(!/changes with `st/.test(text), 'the pair is not repeated under each file');
});
