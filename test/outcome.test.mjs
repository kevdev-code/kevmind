// What a tool call did, measured from the hook events (src/state.js): lines added and removed, a file created, the
// files a search matched, how long a command ran, as numbers and paths only; and when "needs your OK" ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, outcomeOf } from '../src/state.js';

test('an event says what its call did: lines added and removed, a file created, files matched, a command ended', () => {
  const state = new State(), cwd = 'C:\\Dev\\Shop';
  const hook = (name, tool, id, extra, ts) => state.apply({ hook_event_name: name, session_id: 's', cwd, tool_name: tool, tool_use_id: id, ...extra }, ts);
  const ev = (seq) => state.sessions.get('s').events.find((e) => e.seq === seq);
  // An edit: the patch Claude Code reports has 2 lines added and 1 removed (context lines are not counted).
  hook('PreToolUse', 'Edit', 'e1', { tool_input: { file_path: 'C:\\Dev\\Shop\\src\\orders.js', old_string: 'a', new_string: 'b' } }, 1000);
  assert.equal(ev(1).add, undefined, 'unknown until the call ends');
  hook('PostToolUse', 'Edit', 'e1', { tool_response: { filePath: 'x', structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' keep', '-old', '+new', '+more', ' keep'] }] } }, 1040);
  assert.deepEqual([ev(1).kind, ev(1).add, ev(1).del, ev(1).created], ['edit', 2, 1, undefined]);
  // A new file: created, with its lines as added.
  hook('PreToolUse', 'Write', 'w1', { tool_input: { file_path: 'C:\\Dev\\Shop\\src\\cart.js', content: 'one\ntwo\nthree\n' } }, 2000);
  hook('PostToolUse', 'Write', 'w1', { tool_response: { type: 'create', filePath: 'x', content: 'one\ntwo\nthree\n', structuredPatch: [], originalFile: null } }, 2050);
  assert.deepEqual([ev(2).created, ev(2).add, ev(2).del], [true, 3, 0]);
  // A search: where it looked, how many files matched and which (as paths, relative to the session's folder).
  hook('PreToolUse', 'Grep', 'g1', { tool_input: { pattern: 'total', path: 'C:\\Dev\\Shop\\src', output_mode: 'files_with_matches' } }, 3000);
  assert.deepEqual([ev(3).kind, ev(3).tool, ev(3).dir, ev(3).path], ['read', 'Grep', 'src', undefined]);
  hook('PostToolUse', 'Grep', 'g1', { tool_response: { mode: 'files_with_matches', numFiles: 2, filenames: ['C:\\Dev\\Shop\\src\\orders.js', 'C:\\Dev\\Shop\\src\\cart.js'] } }, 3080);
  assert.deepEqual([ev(3).found, ev(3).hits], [2, ['src/orders.js', 'src/cart.js']]);
  // Grep showing lines names no files: they are the paths its lines start with. No content is kept, only the paths.
  hook('PreToolUse', 'Grep', 'g2', { tool_input: { pattern: 'total', output_mode: 'content' } }, 4000);
  hook('PostToolUse', 'Grep', 'g2', { tool_response: { mode: 'content', numFiles: 0, filenames: [], content: 'src/orders.js:12:const total = 1;\nsrc/orders.js:40:  return total;\nC:\\Dev\\Shop\\test\\orders.test.js:7:total\n', numLines: 3 } }, 4060);
  assert.deepEqual([ev(4).found, ev(4).hits, ev(4).dir], [2, ['src/orders.js', 'test/orders.test.js'], undefined]);
  assert.ok(!JSON.stringify(state.summary(state.sessions.get('s'))).includes('return total'), 'matching lines never reach the session');
  // Only the newest searches keep their list of files, so the summary stays small.
  for (let k = 0; k < 3; k++) {
    hook('PreToolUse', 'Glob', `q${k}`, { tool_input: { pattern: '**/*.js' } }, 5000 + k * 10);
    hook('PostToolUse', 'Glob', `q${k}`, { tool_response: { filenames: ['C:\\Dev\\Shop\\src\\orders.js'], numFiles: 1, truncated: false } }, 5005 + k * 10);
  }
  assert.deepEqual([ev(3).hits, ev(3).found, ev(4).hits, ev(7).hits], [undefined, 2, undefined, ['src/orders.js']]);
  // A command: how long it ran. A failed call gets an error event and no outcome.
  hook('PreToolUse', 'Bash', 'b1', { tool_input: { command: 'npm test' } }, 6000);
  hook('PostToolUse', 'Bash', 'b1', { tool_response: { stdout: '', stderr: '' } }, 8500);
  assert.equal(ev(8).ms, 2500);
  hook('PreToolUse', 'Edit', 'e2', { tool_input: { file_path: 'C:\\Dev\\Shop\\src\\orders.js' } }, 9000);
  hook('PostToolUseFailure', 'Edit', 'e2', { error: 'String to replace not found' }, 9010);
  assert.deepEqual([ev(9).add, state.sessions.get('s').events.at(-1).kind], [undefined, 'error']);
});

test('an outcome is measured before the payload is cut, and not counted short after', () => {
  const lines = Array.from({ length: 120 }, (_, i) => (i % 2 ? `+line ${i}` : `-line ${i}`));
  const post = { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_response: { structuredPatch: [{ lines }] } };
  assert.deepEqual(outcomeOf(post), { add: 60, del: 60 });
  // What the redaction leaves of it (lists end at 50 entries): unknown, not 25 and 25.
  const cut = { ...post, tool_response: { structuredPatch: [{ lines: lines.slice(0, 50) }] } };
  assert.equal(outcomeOf(cut, true), null);
  assert.deepEqual(outcomeOf({ ...post, tool_response: { structuredPatch: [{ lines: ['+a', ' b'] }] } }, true), { add: 1, del: 0 });
  assert.equal(outcomeOf({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: { type: 'text' } }), null);
  assert.equal(outcomeOf({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'x' } }), null);
});

test('"needs your OK" ends when the call that asked runs, not at the next call', () => {
  const state = new State(), base = { session_id: 'w', cwd: 'C:\\Dev\\Shop' };
  const status = () => state.sessions.get('w').status;
  state.apply({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'run the tests' }, 1000);
  state.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: 'C:\\Dev\\Shop\\a.js' } }, 2000);
  state.apply({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' } }, 2010);
  state.apply({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }, 2020);
  assert.equal(status(), 'waiting');
  state.apply({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'r1', tool_response: {} }, 2100);
  assert.equal(status(), 'waiting', 'another call ending does not answer the prompt');
  state.apply({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_response: { stdout: '' } }, 9000);
  assert.equal(status(), 'working', 'the user said yes and the command ran');
});
