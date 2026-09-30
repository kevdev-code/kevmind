// Feeds a small synthetic transcript (same shape as Claude Code's) through the tailer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { State } from '../src/state.js';
import { Tailer } from '../src/transcript.js';

const KEY = 'sk-' + 'abcdefghijklmnopqrstuvwxyz012345';
const usage = (input, output, cacheRead, cacheWrite, thinking) => ({
  input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
  output_tokens_details: { thinking_tokens: thinking },
});
const line = (o) => JSON.stringify(o) + '\n';
const assistant = (id, block, u, t) => line({ type: 'assistant', timestamp: t, message: { model: 'claude-test', id, role: 'assistant', content: [block], usage: u } });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-tx-'));
  const main = path.join(dir, 'sess.jsonl');
  const sub = path.join(dir, 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const U1 = usage(10, 20, 30, 40, 50);
  fs.writeFileSync(main,
    assistant('msg_1', { type: 'thinking', thinking: '', signature: 'CAQSxyz' }, U1, '2026-09-30T20:00:00.000Z') +
    assistant('msg_1', { type: 'text', text: `Hello ${KEY} world` }, U1, '2026-09-30T20:00:01.000Z') +
    assistant('msg_1', { type: 'tool_use', id: 'toolu_A', name: 'Agent', input: { description: 'Survey X', subagent_type: 'general-purpose', prompt: '…' } }, U1, '2026-09-30T20:00:02.000Z') +
    line({ type: 'user', timestamp: '2026-09-30T20:00:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'Async agent launched' }] },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'abc123', description: 'Survey X' } }) +
    assistant('msg_2', { type: 'thinking', thinking: 'Let me think about it', signature: 'CAQSabc' }, usage(1, 5, 0, 0, 7), '2026-09-30T20:00:04.000Z') +
    assistant('msg_2', { type: 'text', text: 'Done' }, usage(1, 5, 0, 0, 7), '2026-09-30T20:00:05.000Z'));
  fs.writeFileSync(path.join(sub, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Survey X', toolUseId: 'toolu_A', spawnDepth: 1, requestShape: 'background' }));
  const U2 = usage(1, 2, 3, 4, 0);
  fs.writeFileSync(path.join(sub, 'agent-abc123.jsonl'),
    line({ type: 'user', timestamp: '2026-09-30T20:00:03.500Z', isSidechain: true, agentId: 'abc123', message: { role: 'user', content: 'the task prompt' } }) +
    assistant('msg_s1', { type: 'text', text: 'Sub says hi' }, U2, '2026-09-30T20:00:06.000Z') +
    assistant('msg_s1', { type: 'tool_use', id: 'toolu_B', name: 'Bash', input: { command: 'ls' } }, U2, '2026-09-30T20:00:07.000Z'));
  const st = new State();
  const s = st.session({ session_id: 'sess', cwd: '/p/Proj', transcript_path: main }, Date.parse('2026-09-30T19:59:59.000Z'));
  return { dir, main, st, s, tailer: new Tailer(st, s) };
}

test('says, thinks, silent thoughts, tokens once per message, and a subagent bound from its meta', () => {
  const { st, s, tailer } = setup();
  assert.equal(tailer.tick(), true);
  assert.equal(s.model, 'claude-test');
  // msg_1 spans three lines but counts once; msg_2 twice → once; the subagent's msg_s1 twice → once.
  assert.deepEqual(s.agents.main.tokens, { input: 11, output: 25, cacheRead: 30, cacheWrite: 40 });
  assert.deepEqual(s.tokens, { input: 12, output: 27, cacheRead: 33, cacheWrite: 44 });
  const kinds = s.events.map((e) => [e.kind, e.actor, e.detail, e.tokens]);
  assert.deepEqual(kinds.filter((k) => k[0] === 'says'), [['says', 'main', 'Hello ••• world', undefined], ['says', 'main', 'Done', undefined], ['says', 'agent-1', 'Sub says hi', undefined]]);
  assert.deepEqual(kinds.filter((k) => k[0] === 'thinks'), [['thinks', 'main', '', 50], ['thinks', 'main', 'Let me think about it', undefined]]);
  assert.ok(!JSON.stringify(s.events).includes('CAQS'), 'signatures never reach the model');
  assert.ok(!JSON.stringify(s.events).includes(KEY), 'secrets are masked');
  const a = st.summary(s).agents.find((x) => x.id !== 'main');
  assert.equal(a.realId, 'abc123');
  assert.equal(a.toolUseId, 'toolu_A');
  assert.equal(a.label, 'general-purpose · Survey X');
  assert.equal(a.launch, 'background');
  assert.equal(a.status, 'running');
  assert.equal(a.endedAt, null);
  assert.deepEqual(a.tokens, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.equal(st.summary(s).agents.length, 2);
  assert.equal(tailer.tick(), false, 'nothing new, nothing changes');
});

test('a partial last line waits, and a task notification ends the background agent', () => {
  const { main, st, s, tailer } = setup();
  tailer.tick();
  const note = line({ type: 'user', timestamp: '2026-09-30T20:00:09.000Z', origin: { kind: 'task-notification' },
    message: { role: 'user', content: '<task-notification><task-id>abc123</task-id><status>completed</status><summary>done</summary></task-notification>' } });
  const half = Math.floor(note.length / 2);
  fs.appendFileSync(main, note.slice(0, half));
  tailer.tick();
  const a = () => st.summary(s).agents.find((x) => x.id !== 'main');
  assert.equal(a().status, 'running', 'half a line is not a line');
  fs.appendFileSync(main, note.slice(half));
  assert.equal(tailer.tick(), true);
  assert.equal(a().status, 'done');
  assert.equal(a().endedAt, Date.parse('2026-09-30T20:00:09.000Z'));
  assert.ok(s.events.some((e) => e.kind === 'agent_done' && e.actor === 'agent-1'));
});

test('events land in time order even when the transcript is read after later hook events', () => {
  const { st, s, tailer } = setup();
  st.apply({ session_id: 'sess', cwd: '/p/Proj', hook_event_name: 'Stop' }, Date.parse('2026-09-30T20:00:10.000Z'));
  tailer.tick();
  const ts = s.events.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort((x, y) => x - y));
  assert.equal(s.events.at(-1).kind, 'stop');
});
