// Experience insights from synthetic sessions and a small git repository: thresholds, "no data" answers,
// per-project scope, the 400-token cap, failures with a fix, git co-change, and the call measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emptyAggregate, ingest, refreshGit, answerFileContext, answerFileHistory, answerKnownFailures, measure, preview,
  commandFamily, errorSignature, NO_DATA, THRESHOLDS,
} from '../src/experience.js';
import { keyOf } from '../src/memory.js';
import { hasGit } from './memory-fixture.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-exp-')));

// One session: reads, then edits, then commands, a few seconds apart.
function session(agg, root, sid, ts, { reads = [], edits = [], runs = [] } = {}) {
  let t = ts;
  const base = { session_id: sid, cwd: root };
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

// Ten filler sessions over ten days, enough to pass the project gate.
function enoughHistory(agg, root) {
  for (let i = 0; i < 10; i++) session(agg, root, `fill-${i}`, NOW - (i + 1) * DAY, { reads: [`docs/n${i}.md`], edits: [`misc/f${i}.ts`] });
}

const projOf = (agg, root) => agg.projects[keyOf(root)];

test('below the project gate, every tool says "No data:" instead of guessing', () => {
  const root = tmp();
  const agg = emptyAggregate();
  for (let i = 0; i < 5; i++) session(agg, root, `s${i}`, NOW - 1000 * i, { edits: ['a.ts', 'b.ts'] });
  const p = projOf(agg, root);
  for (const text of [answerFileContext(p, 'P', ['a.ts'], NOW), answerKnownFailures(p, 'P', '', NOW)]) {
    assert.ok(text.startsWith(NO_DATA), text);
    assert.match(text, /5 sessions over 1 days/);
  }
  assert.ok(answerFileContext(null, 'P', ['a.ts'], NOW).startsWith(NO_DATA), 'a project KevMind never saw');
});

test('co-editing is served at the thresholds and not one session below them', () => {
  const root = tmp();
  const agg = emptyAggregate();
  enoughHistory(agg, root);
  for (let i = 0; i < THRESHOLDS.coEditSessions; i++) session(agg, root, `pair-${i}`, NOW - (i * 2 + 1) * DAY, { reads: ['schema.ts'], edits: ['a.ts', 'b.ts'] });
  session(agg, root, 'alone', NOW - 3 * DAY, { edits: ['a.ts'] }); // a.ts alone once: 3 of 4 sessions
  const p = projOf(agg, root);
  const text = answerFileContext(p, 'P', ['a.ts'], NOW);
  assert.match(text, /changes with `b\.ts` \(sessions: 3 of 4, last \d{4}-\d\d-\d\d\)/);
  assert.match(text, /usually read first: `schema\.ts` \(sessions: 3 of 4/);

  const below = emptyAggregate();
  enoughHistory(below, root);
  for (let i = 0; i < THRESHOLDS.coEditSessions - 1; i++) session(below, root, `pair-${i}`, NOW - (i * 2 + 1) * DAY, { edits: ['a.ts', 'b.ts'] });
  const t2 = answerFileContext(projOf(below, root), 'P', ['a.ts'], NOW);
  assert.ok(t2.startsWith(NO_DATA) && t2.includes('no pattern above the thresholds'), t2);
});

test('answers stay inside the project they are asked from', () => {
  const a = tmp();
  const b = tmp();
  const agg = emptyAggregate();
  enoughHistory(agg, a);
  enoughHistory(agg, b);
  for (let i = 0; i < 4; i++) session(agg, b, `b-${i}`, NOW - (i + 1) * DAY, { edits: ['shared.ts', 'secret-partner.ts'] });
  const text = answerFileContext(projOf(agg, a), 'A', ['shared.ts'], NOW);
  assert.ok(!text.includes('secret-partner'), 'project B co-edits never show up in project A');
  assert.match(text, /`shared\.ts`: no data/);
  assert.match(answerFileContext(projOf(agg, b), 'B', ['shared.ts'], NOW), /secret-partner/);
});

test('every answer stays under the 400-token cap, estimated as characters / 4', () => {
  const root = tmp();
  const agg = emptyAggregate();
  enoughHistory(agg, root);
  const files = Array.from({ length: 12 }, (_, i) => `src/very/long/directory/name/for/testing/module-${i}-with-a-long-name.ts`);
  for (let i = 0; i < 6; i++) session(agg, root, `big-${i}`, NOW - (i + 1) * DAY, { reads: files.slice(0, 4).map((f) => f.replace('.ts', '.spec.ts')), edits: files });
  const text = answerFileContext(projOf(agg, root), 'P', files.slice(0, 10), NOW);
  assert.ok(text.length / 4 <= THRESHOLDS.maxTokens, `${Math.round(text.length / 4)} tokens`);
  assert.match(text, /left out to stay under 400 tokens/);
});

test('a recurring failure is served only with a consistent fix; grep with no match is not a failure', () => {
  const root = tmp();
  const agg = emptyAggregate();
  enoughHistory(agg, root);
  const err = 'Exit code 1\nError: Cannot find module \'C:/x/dist/index.js\'';
  for (let i = 0; i < 2; i++) {
    session(agg, root, `fail-${i}`, NOW - (i + 2) * DAY, { runs: [
      { cmd: 'cd app && npm test -- --watch=false', error: err }, { cmd: 'npm run build' }, { edit: 'src/config.ts' }, { cmd: 'npm test' },
      { cmd: 'grep -rn foo src', error: 'Exit code 1' },
    ] });
  }
  const text = answerKnownFailures(projOf(agg, root), 'P', 'npm test', NOW);
  assert.match(text, /`npm test` failed with "exit 1: Error: Cannot find module <path>" in 2 sessions/);
  assert.match(text, /2 times the next success came after (editing `src\/config\.ts`|running `npm run build`)/);
  assert.ok(!/grep/.test(answerKnownFailures(projOf(agg, root), 'P', '', NOW)));
  assert.equal(commandFamily('FOO=1 npx tsc --noEmit | tail'), 'npx tsc');
  assert.equal(errorSignature('Exit code 2\n  src/a.ts(12,3): error TS2304'), 'exit 2: <path>(#,#): error TS#');
});

test('git co-change works from day one; session evidence ranks above git', { skip: !hasGit() && 'needs git' }, async () => {
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
  commit(['package-lock.json', 'api/routes.ts'], 'deps');

  const agg = emptyAggregate();
  session(agg, root, 'one', Date.now() - DAY, { edits: ['README.md'] }); // a single session: no session evidence yet
  const p = projOf(agg, root);
  await refreshGit(p);
  const text = answerFileContext(p, 'P', ['api/routes.ts'], Date.now());
  assert.match(text, /changes with `api\/schema\.ts` \(git: 4 of 5 commits/);
  assert.ok(!text.includes('package-lock'), 'lockfiles are not partners');
  assert.match(answerFileHistory(p, 'P', 'api/routes.ts', Date.now()), /git: changed in 5 commits .*, 2 labeled as fixes/);

  // With session evidence too, the session-backed partner comes first.
  for (let i = 0; i < 10; i++) session(agg, root, `s${i}`, Date.now() - (i + 1) * DAY, { edits: i < 4 ? ['api/routes.ts', 'api/handler.ts'] : [`x/${i}.ts`] });
  const both = answerFileContext(p, 'P', ['api/routes.ts'], Date.now());
  assert.ok(both.indexOf('api/handler.ts') < both.indexOf('api/schema.ts'), both);
  assert.match(both, /`api\/handler\.ts` \(sessions: 4 of 4/);
});

test('calls are measured from the hook events: tokens, "no data", and whether a suggestion was followed', () => {
  const root = tmp();
  const agg = emptyAggregate();
  enoughHistory(agg, root);
  const t = NOW - DAY;
  const base = { session_id: 'm', cwd: root };
  ingest(agg, { ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_kevmind_experience__file_context', duration_ms: 12,
    tool_response: [{ type: 'text', text: 'KevMind history for P:\n- `a.ts`:\n  - changes with `b.ts` (sessions: 3 of 4)' }] }, t);
  ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, 'b.ts') } }, t + 60_000);
  ingest(agg, { ...base, hook_event_name: 'PostToolUse', tool_name: 'mcp__plugin_kevmind_experience__known_failures', tool_response: [{ type: 'text', text: `${NO_DATA} nothing` }] }, t + 120_000);
  const m = measure(projOf(agg, root), NOW);
  assert.equal(m.calls, 2);
  assert.equal(m.noData, 1);
  assert.equal(m.withSuggestions, 1);
  assert.equal(m.followRate, 1);
  assert.equal(m.verdict, 'collecting');
  assert.ok(preview(projOf(agg, root), NOW).gate.sessionOk);
});
