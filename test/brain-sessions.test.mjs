// Several sessions at once ("All live sessions" in the Brain tab): the server keeps simultaneous sessions apart, the
// page picks which ones are live, every agent's tag names its project, and the benchmark's replay has three projects
// working at the same time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { State } from '../src/state.js';

// A function lifted out of a browser script, with the names it needs from around it.
function lift(file, name, scope = {}) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8'), start = src.indexOf(`function ${name}(`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return new Function(...Object.keys(scope), `${src.slice(start, i + 1)}; return ${name};`)(...Object.values(scope));
  }
  throw new Error(`${name} not found`);
}

test('three sessions in three projects at once: each keeps its own agents, events and wait', () => {
  const st = new State();
  const t0 = Date.now() - 60_000; // just now: a session quiet for 5 minutes is reported idle
  let n = 0, ts = t0;
  const hook = (sid, cwd, e) => st.apply({ session_id: sid, cwd, ...e }, (ts += 1000));
  const S = [['s-a', '/w/demo-agency'], ['s-b', '/w/demo-shop'], ['s-c', '/w/demo-notes']];
  for (const [sid, cwd] of S) { hook(sid, cwd, { hook_event_name: 'SessionStart', source: 'startup' }); hook(sid, cwd, { hook_event_name: 'UserPromptSubmit', prompt: `work in ${cwd}` }); }
  // Interleaved: a read in each, a subagent in the first, an edit in the second, another read in the third.
  for (const [sid, cwd] of S) {
    const id = `t${++n}`;
    hook(sid, cwd, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `${cwd}/src/a.js` }, tool_use_id: id });
    hook(sid, cwd, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: `${cwd}/src/a.js` }, tool_use_id: id, tool_response: { type: 'text' } });
  }
  hook('s-a', S[0][1], { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'Explore', description: 'Find callers', prompt: 'x' }, tool_use_id: 'task-1' });
  hook('s-a', S[0][1], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `${S[0][1]}/src/b.js` }, tool_use_id: 't-sub', agent_id: 'ag-1', agent_type: 'Explore' });
  hook('s-b', S[1][1], { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: `${S[1][1]}/src/cart.js` }, tool_use_id: 't-edit' });
  // The second session asks for permission: it alone needs the user's OK.
  hook('s-b', S[1][1], { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 't-bash' });
  hook('s-b', S[1][1], { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  hook('s-c', S[2][1], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: `${S[2][1]}/README.md` }, tool_use_id: 't-c2' });

  const list = Object.fromEntries(st.list().map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(list).sort(), ['s-a', 's-b', 's-c']);
  assert.equal(list['s-b'].status, 'waiting');
  assert.equal(list['s-a'].status, 'working');
  assert.equal(list['s-c'].status, 'working');
  const sum = (id) => st.summary(st.sessions.get(id));
  assert.equal(sum('s-a').agents.filter((a) => a.id !== 'main').length, 1, 'the subagent belongs to its own session');
  assert.equal(sum('s-b').agents.filter((a) => a.id !== 'main').length, 0);
  assert.equal(sum('s-c').agents.filter((a) => a.id !== 'main').length, 0);
  for (const [sid, cwd] of S) {
    const s = sum(sid), seqs = s.events.map((e) => e.seq);
    assert.equal(s.cwd, cwd);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), `${sid}: its events in order`);
  }
  assert.ok(sum('s-b').events.some((e) => e.kind === 'edit'), 'the edit stays in the session that made it');
  assert.ok(!sum('s-a').events.some((e) => e.kind === 'edit') && !sum('s-c').events.some((e) => e.kind === 'edit'));
});

test('"All live sessions": working and waiting ones, then the recently active; waiting first, at most 6', () => {
  const live = lift('../public/brain.js', 'brainLiveSessions', { BRAIN_LIVE_MS: 10 * 60_000, BRAIN_MAX_SESSIONS: 6 });
  const now = Date.UTC(2026, 9, 2, 12), min = 60_000;
  const s = (id, status, ago, prompts = 1) => ({ id, status, lastAt: now - ago * min, prompts });
  const statusOf = (x) => x.status;
  const pick = (list) => live(list, now, statusOf).map((x) => x.id);
  assert.deepEqual(pick([s('a', 'working', 1), s('b', 'idle', 3), s('c', 'idle', 25), s('d', 'ended', 1), s('e', 'idle', 2, 0), s('f', 'waiting', 4)]),
    ['f', 'a', 'b'], 'waiting first; an idle session with a prompt in the last 10 min stays; one quiet for 25 min, an ended one and one that never had a prompt go');
  const many = Array.from({ length: 9 }, (_, i) => s(`w${i}`, 'working', i));
  assert.deepEqual(pick(many), ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'], 'the 6 most recent');
  assert.deepEqual(pick([...many, s('late', 'waiting', 9)])[0], 'late', 'a session waiting for the OK is never left out');
  assert.deepEqual(pick([]), []);
});

test('an agent\'s tag names its project when several sessions are shown; small tags say its initials', () => {
  const initialsOf = lift('../public/brain/view.js', 'initialsOf');
  const tagOf = lift('../public/brain/view.js', 'tagOf', { initialsOf });
  assert.deepEqual(tagOf(true, 'Claude', 'main', '', false), ['Claude', '']);
  assert.deepEqual(tagOf(false, '#2', 'general-purpose', '', false), ['#2 general-purpose', '']);
  assert.deepEqual(tagOf(false, '#2', 'general-purpose', '', true), ['#2', ''], 'a phone: the number only');
  assert.deepEqual(tagOf(true, 'Claude', 'main', 'demo-shop', false), ['Claude', '· demo-shop']);
  assert.deepEqual(tagOf(false, '#2', 'general-purpose', 'demo-shop', false), ['#2', '· demo-shop'], 'the type gives way to the project');
  // Narrow screens, several sessions: the dot and the project's initials, until tapped.
  assert.deepEqual(tagOf(true, 'Claude', 'main', 'demo-shop', true), ['DS', '']);
  assert.deepEqual(tagOf(false, '#2', 'Explore', 'demo-agency', true), ['#2 DA', '']);
  assert.deepEqual(['demo-agency', 'demo-shop', 'KevMind', 'kevmind', 'notes.backend', 'API'].map(initialsOf), ['DA', 'DS', 'KM', 'K', 'NB', 'A']);
});

test('the benchmark\'s multi-session replay: three projects working at the same time, each in its own cells', async () => {
  const { makeGraph, makeSessions } = await import('../prototype/brain/data.js');
  const graph = makeGraph({}), names = new Set(graph.nodes.map((n) => n.name));
  const r = makeSessions(graph), again = makeSessions(graph);
  assert.deepEqual(r.events, again.events, 'deterministic');
  assert.deepEqual(r.sessions.map((s) => s.project), ['demo-agency', 'demo-shop', 'demo-kevmind']);
  const span = {};
  for (const s of r.sessions) {
    const evs = r.events.filter((e) => e.session === s.id);
    assert.ok(evs.length >= 10, `${s.id} has work`);
    assert.deepEqual([evs[0].agent, evs[0].kind], ['main', 'start'], `${s.id}: Claude starts it`);
    for (const e of evs) {
      if (e.node != null) assert.equal(graph.nodes[e.node].project, s.project, `${s.id}: ${graph.nodes[e.node].path} is one of its project's cells`);
      assert.ok(!e.text || names.has(e.text), `"${e.text}" is a node's name`);
      assert.ok(r.agents[s.id].some((a) => a.id === e.agent), `${s.id}: ${e.agent} is one of its agents`);
    }
    span[s.id] = [evs[0].at, evs[evs.length - 1].at];
  }
  // All three at work at once: there is a moment inside every session's span.
  const from = Math.max(...Object.values(span).map((x) => x[0])), to = Math.min(...Object.values(span).map((x) => x[1]));
  assert.ok(to - from > 20_000, `the three overlap for ${Math.round((to - from) / 1000)} s`);
  assert.ok(r.events.some((e) => e.kind === 'wait'), 'one session waits for the user\'s OK');
});
