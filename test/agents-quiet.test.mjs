// Subagents that stop reporting end ("went quiet"), at their last sign of life: the replay of a real case where six
// background subagents stayed "running" with 0 actions in an idle session for days (their end was a transcript
// attachment KevMind didn't read, and nothing expired them). A tool call still open gets a much longer limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { State } from '../src/state.js';
import { Tailer } from '../src/transcript.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 19, 50);
const base = { session_id: 'sess', cwd: '/p/Proj' };
const sub = (s) => s.agents.agentA;

// The parent launches a background subagent; it makes one call; then the parent's turn ends (the session is idle).
function launched(st, { open = false } = {}) {
  let s = st.apply({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'review the docs' }, T0);
  st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_1', tool_input: { description: 'Write the docs section', subagent_type: 'documenter', run_in_background: true } }, T0 + 1000);
  st.apply({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_1', tool_response: { isAsync: true, status: 'async_launched', agentId: 'agentA' } }, T0 + 2000);
  st.apply({ ...base, agent_id: 'agentA', agent_type: 'documenter', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_2', tool_input: { command: 'npm test' } }, T0 + 3000);
  if (!open) st.apply({ ...base, agent_id: 'agentA', agent_type: 'documenter', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_2', tool_response: { stdout: '' } }, T0 + 4000);
  s = st.apply({ ...base, hook_event_name: 'Stop' }, T0 + 5000);
  return s;
}

test('a background subagent that stops reporting ends after 10 minutes, at its last sign of life', () => {
  const st = new State();
  const s = launched(st);
  assert.equal(sub(s).status, 'running');
  assert.equal(st.expireAgents(s, T0 + 9 * MIN), false, 'still within 10 minutes of its last event');
  assert.equal(sub(s).status, 'running');
  assert.equal(st.expireAgents(s, T0 + 11 * MIN), true);
  assert.deepEqual([sub(s).status, sub(s).endedAt], ['quiet', T0 + 4000], 'ended when it was last heard from, not when it was noticed');
  const done = s.events.filter((e) => e.kind === 'agent_done');
  assert.deepEqual(done.map((e) => [e.actor, e.detail, e.ts]), [[sub(s).id, 'quiet', T0 + 4000]], 'the feed says it went quiet, once');
  assert.equal(st.summary(s, T0 + 11 * MIN).agents.filter((a) => a.status === 'running').length, 0, 'no agent left running in Live or the Brain');
  assert.equal(st.expireAgents(s, T0 + 60 * MIN), false, 'nothing more to end');

  // Its real end, arriving later, still says how it ended; an action after it means it came back.
  st.endAgent(s, 'agentA', T0 + 20 * MIN, 'done');
  assert.deepEqual([sub(s).status, sub(s).endedAt], ['done', T0 + 20 * MIN]);
  assert.equal(s.events.filter((e) => e.kind === 'agent_done').length, 1);
  st.apply({ ...base, agent_id: 'agentA', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_3', tool_input: { file_path: '/p/Proj/a.md' } }, T0 + 30 * MIN);
  assert.deepEqual([sub(s).status, sub(s).endedAt], ['running', null]);
});

test('a subagent with a tool call still open (a long build or test run) waits 2 hours, or for the session to close', () => {
  const st = new State();
  const s = launched(st, { open: true });
  assert.equal(st.expireAgents(s, T0 + 30 * MIN), false, 'npm test has been running for 30 minutes: not quiet');
  assert.equal(st.expireAgents(s, T0 + 119 * MIN), false);
  assert.equal(sub(s).status, 'running');
  assert.equal(st.expireAgents(s, T0 + 121 * MIN), true, 'past 2 hours the open call is taken as lost');
  assert.equal(sub(s).status, 'quiet');

  const st2 = new State();
  const s2 = launched(st2, { open: true });
  st2.apply({ ...base, hook_event_name: 'SessionEnd', reason: 'exit' }, T0 + 6 * MIN);
  assert.equal(st2.expireAgents(s2, T0 + 6 * MIN), true, 'a closed session ends its subagents at once');
  assert.equal(s2.agents.agentA.endedAt, T0 + 3000);
});

test('the transcript ends a background agent from its queued task notification (newer Claude Code)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-quiet-'));
  try {
    const main = path.join(dir, 'sess.jsonl');
    const at = (ms) => new Date(T0 + ms).toISOString();
    const line = (o) => JSON.stringify(o) + '\n';
    // Redacted shapes of the real lines: the async launch result, then the end as an attachment, not a user message.
    fs.writeFileSync(main,
      line({ type: 'assistant', timestamp: at(1000), message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Write the docs section', subagent_type: 'documenter' } }] } }) +
      line({ type: 'user', timestamp: at(2000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }] }, toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'agentA', description: 'Write the docs section' } }) +
      line({ type: 'queue-operation', operation: 'enqueue', timestamp: at(240_000), content: '<task-notification><task-id>agentA</task-id>…' }) +
      line({ type: 'attachment', timestamp: at(240_000), attachment: { type: 'queued_command', prompt: '<task-notification><task-id>agentA</task-id><status>completed</status><summary>…</summary></task-notification>', commandMode: 'task-notification', origin: { kind: 'task-notification', producer: 'session-task' } } }));
    const st = new State();
    const s = st.session({ ...base, transcript_path: main }, T0);
    new Tailer(st, s).tick();
    assert.deepEqual([s.agents.agentA.status, s.agents.agentA.endedAt], ['done', T0 + 240_000]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
