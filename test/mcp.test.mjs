// The stdio MCP server end to end: initialize, tools/list, tools/call, errors, the off switch, and project scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SERVER = new URL('../mcp/server.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DAY = 86_400_000;

// A KevMind home with one month of logs: project A has a.ts and b.ts edited together in 4 of 12 sessions.
function home() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-mcp-')));
  const a = path.join(dir, 'ProjectA');
  const b = path.join(dir, 'ProjectB');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const now = Date.now();
  const lines = [];
  const add = (ts, e) => lines.push(JSON.stringify({ ts, e }));
  for (let i = 0; i < 12; i++) {
    const ts = now - (i + 1) * DAY;
    const files = i < 4 ? ['a.ts', 'b.ts'] : [`f${i}.ts`];
    for (const f of files) add(ts + 1000, { session_id: `s${i}`, cwd: a, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(a, f) } });
    add(ts, { session_id: `b${i}`, cwd: b, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(b, 'only-in-b.ts') } });
  }
  const byMonth = {};
  for (const l of lines) (byMonth[new Date(JSON.parse(l).ts).toISOString().slice(0, 7)] ||= []).push(l);
  for (const [m, ls] of Object.entries(byMonth)) if (ls.length) fs.writeFileSync(path.join(dir, `events-${m}.jsonl`), ls.join('\n') + '\n');
  return { dir, a, b };
}

function client(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  const waiting = new Map();
  const stray = [];
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const m = JSON.parse(line); // every stdout line must be a JSON-RPC message
      if (waiting.has(m.id)) waiting.get(m.id)(m); else stray.push(m);
    }
  });
  let id = 0;
  return {
    rpc: (method, params) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); }),
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    raw: (text) => child.stdin.write(text + '\n'),
    stray,
    close: () => new Promise((r) => { child.on('exit', r); child.stdin.end(); }),
  };
}

test('initialize, tools/list and tools/call over stdio', async () => {
  const { dir, a } = home();
  const c = client({ KEVMIND_HOME: dir, CLAUDE_PROJECT_DIR: a, KEVMIND_EXPERIENCE: 'true' });
  const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'kevmind-experience');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  c.notify('notifications/initialized');

  const list = await c.rpc('tools/list');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['file_context', 'file_history', 'known_failures']);
  for (const t of list.result.tools) {
    assert.ok(t.description.length < 420, `${t.name} description stays short`);
    assert.match(t.description, /Not on every task/);
    assert.match(t.description, /use Serena or other code tools if available; KevMind only reports history/);
  }

  const t0 = performance.now();
  const r = await c.rpc('tools/call', { name: 'file_context', arguments: { paths: ['a.ts', 'only-in-b.ts'] } });
  const ms = performance.now() - t0;
  const text = r.result.content[0].text;
  assert.match(text, /changes with `b\.ts` \(episodes: 4 on 4 days/);
  assert.match(text, /`only-in-b\.ts`: no data/, 'project B is invisible from project A');
  assert.ok(text.length / 4 <= 400);
  assert.ok(ms < 1000, `first call took ${ms.toFixed(0)} ms`);

  const failures = await c.rpc('tools/call', { name: 'known_failures', arguments: {} });
  assert.ok(failures.result.content[0].text.startsWith('No data:'));

  assert.equal((await c.rpc('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  assert.equal((await c.rpc('resources/list')).error.code, -32601);
  assert.deepEqual((await c.rpc('ping')).result, {});
  c.raw('{not json');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(c.stray[0]?.error?.code, -32700);
  await c.close();
});

test('with the option off, the server lists no tools and refuses calls', async () => {
  const { dir, a } = home();
  const c = client({ KEVMIND_HOME: dir, CLAUDE_PROJECT_DIR: a, KEVMIND_EXPERIENCE: 'false' });
  await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.deepEqual((await c.rpc('tools/list')).result.tools, []);
  const r = await c.rpc('tools/call', { name: 'file_context', arguments: { paths: ['a.ts'] } });
  assert.equal(r.result.isError, true);
  await c.close();
});
