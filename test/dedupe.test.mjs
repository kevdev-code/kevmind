// With the plugin and the manual hooks both installed, every event arrives twice; the server keeps the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDedupe } from '../src/server.js';

test('exact repeats within the window are dropped, later or different events are kept', () => {
  const dup = makeDedupe(3000);
  const a = { session_id: 's', hook_event_name: 'PreToolUse', tool_use_id: 't1', tool_input: { x: 1 } };
  assert.equal(dup(a, 1000), false);
  assert.equal(dup({ ...a }, 1500), true, 'the second hook source');
  assert.equal(dup({ ...a, hook_event_name: 'PostToolUse' }, 1600), false, 'same tool_use_id, other event');
  assert.equal(dup({ ...a, tool_use_id: 't2' }, 1700), false);
  const p = { session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: 'hi' };
  assert.equal(dup(p, 2000), false);
  assert.equal(dup({ ...p }, 2100), true, 'no tool_use_id: whole payload compared');
  assert.equal(dup({ ...p, prompt: 'hi!' }, 2200), false);
  assert.equal(dup({ ...p, session_id: 'other' }, 2300), false);
  assert.equal(dup({ ...p }, 6000), false, 'after the window it is a new event');
});
