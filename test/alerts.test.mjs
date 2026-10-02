// A long session where two agents keep editing the same files: conflict alerts are capped per session (newest
// kept), so neither the server's memory nor the page's alert list grows without bound. Every event is numbered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, MAX_ALERTS } from '../src/state.js';

const base = { session_id: 'long-conflicts', cwd: '/work/acme-api' };
const edit = (st, ts, file, agent) => st.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: `t${ts}`,
  tool_input: { file_path: `/work/acme-api/${file}` }, ...(agent ? { agent_id: agent, agent_type: 'general-purpose' } : {}) }, ts);

test('conflict alerts keep only the newest 50 per session', () => {
  const st = new State();
  const t0 = Date.UTC(2026, 9, 1, 12);
  let s;
  // Claude and one subagent take turns on the same file every 2 s for 10 minutes: 299 conflicts.
  for (let i = 0; i < 300; i++) s = edit(st, t0 + i * 2000, 'src/routes/orders.ts', i % 2 ? 'agent-x' : null);
  assert.equal(s.alerts.length, MAX_ALERTS);
  assert.equal(MAX_ALERTS, 50);
  assert.equal(s.alerts.at(-1).ts, t0 + 299 * 2000, 'the newest alert is kept');
  assert.equal(s.alerts[0].ts, t0 + 250 * 2000, 'the oldest ones are dropped');
  for (const a of s.alerts) assert.deepEqual([a.kind, a.file], ['conflict', 'orders.ts']);
  assert.equal(st.summary(s).alerts.length, MAX_ALERTS, 'the page gets the same capped list');
});

test('every event gets an increasing sequence number, also after the event list is trimmed', () => {
  const st = new State();
  const t0 = Date.UTC(2026, 9, 1, 12);
  let s;
  for (let i = 0; i < 400; i++) s = edit(st, t0 + i * 1000, `f${i % 7}.ts`);
  const seqs = s.events.map((e) => e.seq);
  assert.equal(s.events.length, 300);
  assert.equal(seqs.at(-1), 400);
  assert.ok(seqs.every((n, i) => i === 0 || n > seqs[i - 1]));
});
