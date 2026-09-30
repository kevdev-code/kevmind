// Replays the real hook sequence of a session that launched three background subagents in parallel
// (redacted copy in fixtures/). Hooks only, no transcript: this is the fallback path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { State } from '../src/state.js';

const lines = fs.readFileSync(new URL('./fixtures/agents-session.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('three background subagents stay working until their SubagentStop, with no duplicate rows', () => {
  const st = new State();
  let s;
  const stops = [];
  for (const { ts, e } of lines) {
    if (e.hook_event_name === 'SubagentStop') {
      const before = s.agents[e.agent_id];
      assert.ok(before, `agent ${e.agent_id} is known before its SubagentStop`);
      assert.equal(before.endedAt, null, `${before.label} has no endedAt before its SubagentStop`);
      assert.ok(['running', 'working'].includes(before.status), `${before.label} is ${before.status} before its SubagentStop`);
    }
    s = st.apply(e, ts) || s;
    if (e.hook_event_name === 'SubagentStop') {
      const after = s.agents[e.agent_id];
      assert.equal(after.status, 'done');
      assert.equal(after.endedAt, ts);
      stops.push(after.id);
    }
  }
  const agents = st.summary(s).agents.filter((a) => a.id !== 'main');
  assert.equal(agents.length, 3, `exactly 3 subagent rows, got ${agents.map((a) => a.id).join(', ')}`);
  assert.equal(new Set(stops).size, 3, 'each SubagentStop ended a different row');
  for (const a of agents) {
    assert.ok(a.realId, `${a.id} is bound to a real agent id`);
    assert.ok(a.actions >= 1, `${a.label} did its own actions (${a.actions})`);
    assert.equal(a.launch, 'background');
    assert.match(a.label, /^general-purpose · Survey /);
  }
  // The explicit link in tool_response.agentId wins over the first-come guess: descriptions match the real ids.
  const byReal = Object.fromEntries(agents.map((a) => [a.realId, a.description]));
  assert.equal(byReal.ace82fd24b5cf9483, 'Survey transcript main-thread lines');
  assert.equal(byReal.a42cd866c580a87a8, 'Survey thinking blocks and usage');
  assert.equal(byReal.a8d98202ffab056ea, 'Survey subagent transcript linkage');
});

test('a foreground launch still ends on its PostToolUse', () => {
  const st = new State();
  const base = { session_id: 'fg', cwd: '/p' };
  st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { subagent_type: 'Explore', description: 'look' } }, 1000);
  st.apply({ ...base, hook_event_name: 'SubagentStart', agent_id: 'x1', agent_type: 'Explore' }, 1001);
  st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't2', tool_input: { file_path: '/p/a.js' }, agent_id: 'x1' }, 1002);
  const s = st.apply({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: {}, tool_response: { status: 'completed', agentId: 'x1' } }, 1500);
  const a = s.agents.x1;
  assert.equal(a.status, 'done');
  assert.equal(a.endedAt, 1500);
  assert.equal(a.actions, 1);
  assert.equal(st.summary(s).agents.length, 2);
});

test('an action after a wrong end clears endedAt', () => {
  const st = new State();
  const base = { session_id: 'late', cwd: '/p' };
  st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { subagent_type: 'general-purpose' } }, 1000);
  st.apply({ ...base, hook_event_name: 'SubagentStart', agent_id: 'g1', agent_type: 'general-purpose' }, 1001);
  st.apply({ ...base, hook_event_name: 'SubagentStop', agent_id: 'g1' }, 1002);
  const s = st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't3', tool_input: {}, agent_id: 'g1' }, 1003);
  assert.equal(s.agents.g1.endedAt, null);
  assert.equal(s.agents.g1.status, 'running');
});
