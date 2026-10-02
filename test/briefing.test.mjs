// The session briefing: facts only (never instructions), within its budget; half the starts shown and half withheld;
// what followed each start measured, tokens included; the hook never breaks Claude Code; the server records what
// Claude received. Every server runs on a temporary KEVMIND_HOME and port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyAggregate, ingest } from '../src/experience.js';
import { BRIEF, armOf, gatherFacts, briefingText, measureStretch, compare, projectsUnder, sessionsOf } from '../src/briefing.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'kevmind.js');
const HOOK = path.join(HERE, '..', 'hooks', 'brief.js');
const MIN = 60_000;

// A project with a nested repo (backend/) and three past sessions, as hook events through the aggregate.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-brief-'));
  const root = path.join(dir, 'demo-shop');
  for (const d of ['.git', 'backend/.git', 'src', 'backend/src']) fs.mkdirSync(path.join(root, d), { recursive: true });
  return { dir, root };
}
function history(root, now) {
  const agg = emptyAggregate();
  let n = 0;
  const ev = (sid, ts, e) => ingest(agg, { session_id: sid, cwd: root, ...e }, ts);
  const read = (sid, ts, f) => ev(sid, ts, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, f) }, tool_use_id: `t${++n}` });
  const edit = (sid, ts, f) => ev(sid, ts, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) }, tool_use_id: `t${++n}` });
  const run = (sid, ts, command, ok, error = '') => ev(sid, ts, { hook_event_name: ok ? 'PostToolUse' : 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command }, ...(ok ? {} : { error }) });
  const prompt = (sid, ts) => ev(sid, ts, { hook_event_name: 'UserPromptSubmit', prompt: 'work' });
  for (const [sid, t] of [['s1', now - 3 * 86_400_000], ['s2', now - 2 * 86_400_000], ['s3', now - 3 * 3600_000]]) {
    prompt(sid, t);
    read(sid, t + MIN, 'src/cart.js');
    read(sid, t + 2 * MIN, 'README.md');
  }
  run('s2', now - 2 * 86_400_000 + 5 * MIN, 'npm test', true); // a command the project runs regularly
  run('s3', now - 3 * 3600_000 + 2 * MIN, 'node scratch.mjs', true);
  edit('s3', now - 3 * 3600_000 + 3 * MIN, 'src/cart.js');
  edit('s3', now - 3 * 3600_000 + 4 * MIN, 'backend/src/total.ts');
  prompt('s3', now - 2 * 3600_000); // the final turn
  run('s3', now - 2 * 3600_000 + MIN, 'npm test', false, 'Exit code 1\nFAIL test/cart.test.js');
  run('s3', now - 2 * 3600_000 + 2 * MIN, 'cat a.txt && grep x a.txt', false, 'Exit code 1\nsome text');
  run('s3', now - 2 * 3600_000 + 3 * MIN, 'git check-ignore -q .env', false, 'Exit code 1');
  run('s3', now - 2 * 3600_000 + 3 * MIN + 1000, 'node scratch.mjs', false, 'Exit code 1\nTypeError: x'); // a one-off script: not news
  edit('s3', now - 2 * 3600_000 + 4 * MIN, 'src/cart.js');
  return agg;
}
const git = (dir, args) => Promise.resolve(args[0] === 'log' ? `abc1234\t${Math.floor((Date.now() - 3600_000) / 1000)}\tFix the cart total\n` : dir.endsWith('backend') ? ' M src/total.ts\n' : '');

test('the briefing says where the last session left off, from the records and git, as facts within its budget', async () => {
  const { dir, root } = project();
  try {
    const now = Date.now(), agg = history(root, now);
    const facts = await gatherFacts({ agg, root, name: 'demo-shop', sid: 's4', source: 'startup', now, git, toolsOn: true });
    assert.deepEqual(facts.last.edited, ['src/cart.js', 'backend/src/total.ts'], 'the files it edited last, across the nested repo');
    assert.deepEqual(facts.last.failing.map((r) => r.fam), ['npm test'], 'a test still failing; a grep chain and a git probe are not failures');
    assert.deepEqual(facts.rereads, ['README.md'], 'read in each of the last three sessions (src/cart.js is already named)');
    assert.deepEqual(facts.git.map((g) => [g.label, g.dirty]), [['', []], ['backend', ['backend/src/total.ts']]]);
    const { text, items } = briefingText(facts);
    assert.ok(text.length <= BRIEF.maxChars);
    assert.match(text, /^KevMind's record of demo-shop, from its past Claude Code sessions and git/);
    assert.match(text, /Its last edits: `src\/cart\.js`, `backend\/src\/total\.ts`\./);
    assert.match(text, /Still failing when it stopped: `npm test` \("exit 1: FAIL <path>"\)\./);
    assert.match(text, /git \(backend\): last commit abc1234 .*1 uncommitted file: `backend\/src\/total\.ts`\./);
    assert.match(text, /Read in each of the last 3 sessions: `README\.md`\./);
    // Facts, never instructions: Claude Code's guidance for injected context.
    assert.ok(!/\b(you should|you must|always|never|do not|don't|make sure|remember to|please)\b/i.test(text), text);
    assert.ok(items.includes('file:src/cart.js') && items.includes('cmd:npm test'));
    // Too much to say: whole lines go from the end, the head stays.
    const long = briefingText({ ...facts, rereads: Array.from({ length: 5 }, (_, i) => `src/${'x'.repeat(200)}${i}.js`), notes: Array.from({ length: 3 }, (_, i) => ({ name: `memory/${'n'.repeat(300)}${i}.md` })) });
    assert.ok(long.text.length <= BRIEF.maxChars && long.text.split('\n').every((l) => l.startsWith('KevMind') || l.startsWith('- ')));
    assert.equal(briefingText({ ...facts, last: null, git: [], failures: [], rereads: [], together: [], notes: [], stale: [] }).text, '', 'nothing to say: nothing is sent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('half the starts are shown and half withheld, the same way every time', () => {
  const shown = Array.from({ length: 4000 }, (_, i) => armOf(`session-${i}`, i % 3)).filter((a) => a === 'shown').length;
  assert.ok(shown > 1880 && shown < 2120, `${shown} of 4000 shown`);
  assert.equal(armOf('abc', 0), armOf('abc', 0));
});

test('what followed a start: time, steps, re-reads, repeated failures and tokens until the first edit', () => {
  const { dir, root } = project();
  try {
    const now = Date.now(), agg = history(root, now);
    const eps = sessionsOf(projectsUnder(agg, root)).get('s3').eps;
    const t0 = now - 2 * 3600_000 - 30_000; // a start 30 s before the final turn's prompt
    const usage = [[t0 - 1000, 999, 999, 999], [t0 + MIN, 1000, 200, 5000], [t0 + 3 * MIN, 500, 100, 6000], [t0 + 10 * MIN, 400, 50, 7000]];
    const m = measureStretch({ t0, t1: now, eps, prevReads: new Set(['src/cart.js']), known: new Set(['npm test|exit 1: FAIL <path>']), usage, items: ['file:src/cart.js', 'file:src/other.js'] });
    assert.equal(m.minutesToEdit, 4);
    assert.equal(m.stepsToEdit, 4, 'four commands before the edit, no new reads');
    assert.equal(m.failures, 3, 'the git probe that only said "Exit code 1" is not a failure');
    assert.equal(m.repeated, 1);
    assert.equal(m.tokensToEdit, 1000 + 200 + 5000 + 500 + 100 + 6000, 'input, output and cache reads from the start until the first edit');
    assert.equal(m.tokens, m.tokensToEdit + 400 + 50 + 7000);
    assert.equal(m.followed, 0.5, 'one of the two files it named was then edited');
    assert.equal(measureStretch({ t0: now - 1000, t1: now, eps }), null, 'no prompt after the start: not a measured start');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the verdict is about tokens: saves, costs, unclear, or still collecting', () => {
  const r = (arm, tokens, tokensToEdit) => ({ arm, chars: 900, m: { tokens, tokensToEdit, minutesToEdit: 3, stepsToEdit: 4, rereadShare: 0.5, repeated: 0, failures: 0, followed: 0.5 } });
  const many = (arm, t, e) => Array.from({ length: BRIEF.minPerArm }, () => r(arm, t, e));
  assert.equal(compare([...many('shown', 80_000, 20_000), ...many('withheld', 100_000, 25_000)]).verdict, 'saves');
  assert.equal(compare([...many('shown', 120_000, 30_000), ...many('withheld', 100_000, 25_000)]).verdict, 'costs');
  assert.equal(compare([...many('shown', 97_000, 20_000), ...many('withheld', 100_000, 25_000)]).verdict, 'unclear');
  const few = compare([...many('shown', 80_000, 20_000).slice(0, 5), ...many('withheld', 100_000, 25_000)]);
  assert.equal(few.verdict, 'collecting');
  assert.deepEqual([few.shown.n, few.withheld.n], [5, BRIEF.minPerArm]);
  assert.deepEqual(compare([...many('shown', 80_000, 20_000), ...many('withheld', 100_000, 25_000)]).tokens, { toEdit: -0.2, total: -0.2 });
});

const runHook = (input, port) => spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, KEVMIND_PORT: String(port) }, encoding: 'utf8', timeout: 5000 });

test('the hook never breaks Claude Code: nothing on bad input or with the dashboard down, the context when it answers', async () => {
  const t = Date.now();
  let r = runHook(JSON.stringify({ session_id: 'x', cwd: '/w', source: 'startup' }), 1); // nothing listens on port 1
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(Date.now() - t < 3000);
  assert.equal(runHook('not json', 1).status, 0);
  const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res.end(JSON.stringify({ text: `briefing for ${JSON.parse(b).source}` }))); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [HOOK], { env: { ...process.env, KEVMIND_PORT: String(server.address().port) } });
      let so = '';
      child.stdout.on('data', (c) => { so += c; });
      child.on('close', (code) => resolve({ code, so }));
      child.stdin.end(JSON.stringify({ session_id: 'x', cwd: '/w', source: 'compact' }));
    });
    assert.equal(out.code, 0);
    assert.deepEqual(JSON.parse(out.so), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'briefing for compact' } });
  } finally { server.close(); }
});

function req(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('the server: off by default; on, every start is recorded with its text, and only shown ones reach Claude', async () => {
  const { dir, root } = project();
  const home = path.join(dir, 'kevmind');
  fs.mkdirSync(home, { recursive: true });
  // Past work in the logs before the server starts, so its aggregate has something to say.
  const now = Date.now(), month = new Date(now).toISOString().slice(0, 7);
  const lines = [['s1', now - 2 * 3600_000, 'UserPromptSubmit', {}], ['s1', now - 2 * 3600_000 + MIN, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/cart.js') }, tool_use_id: 'e1' }]]
    .map(([sid, ts, ev, extra]) => JSON.stringify({ ts, e: { session_id: sid, cwd: root, hook_event_name: ev, prompt: 'work', ...extra } }));
  fs.writeFileSync(path.join(home, `events-${month}.jsonl`), lines.join('\n') + '\n');
  const port = 47600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [BIN, 'start'], { env: { ...process.env, KEVMIND_HOME: home, KEVMIND_PORT: String(port), KEVMIND_AUTOSTART: '0' }, stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { try { await req(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await new Promise((r) => setTimeout(r, 800)); // its first pass over the logs
    const start = (sid) => req(`${base}/api/briefing`, { method: 'POST', body: JSON.stringify({ session_id: sid, cwd: root, source: 'startup' }) }).then((x) => JSON.parse(x.body));
    assert.deepEqual(await start('off-1'), { text: '' }, 'off by default');
    assert.ok(!fs.existsSync(path.join(home, 'briefings.jsonl')), 'nothing recorded while off');
    assert.equal((await req(`${base}/api/briefing/switch`, { method: 'POST', body: '{"on":true}' })).status, 200);
    const answers = [];
    for (let i = 0; i < 12; i++) answers.push([`s-${i}`, await start(`s-${i}`)]);
    const recs = fs.readFileSync(path.join(home, 'briefings.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(recs.length, 12);
    for (const [sid, a] of answers) {
      const rec = recs.find((x) => x.sid === sid);
      assert.match(rec.text, /Last session with edits: .* Its last edits: `src\/cart\.js`\./, 'the text is recorded either way');
      assert.equal(a.text, rec.arm === 'shown' ? rec.text : '', `${rec.arm}: Claude gets the text only when shown`);
    }
    assert.ok(recs.some((x) => x.arm === 'shown') && recs.some((x) => x.arm === 'withheld'));
    const panel = JSON.parse((await req(`${base}/api/briefing?key=${encodeURIComponent(recs[0].key)}`)).body);
    assert.equal(panel.on, true);
    assert.equal(panel.starts.length, 8, 'the panel lists the last eight starts, each with its text');
    assert.equal(panel.compare.verdict, 'collecting');
    // Only JSON from this PC: a simple cross-site form post is refused.
    assert.equal((await new Promise((resolve) => { const r = http.request(`${base}/api/briefing`, { method: 'POST', headers: { 'content-type': 'text/plain' } }, (res) => { res.resume(); resolve(res.statusCode); }); r.end('{}'); })), 403);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('briefing.js only reads: no writes, git only `log` and `status` through one guarded helper', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'briefing.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(src.match(/\.(?:write\w*|append\w*|unlink\w*|rm\w*|rename\w*|mkdir\w*|copyFile\w*)\s*\(/g), null);
  assert.ok(src.includes("const GIT_BRIEF = new Set(['log', 'status']);"));
  assert.equal(src.match(/execFile\(/g).length, 1);
  assert.match(src, /if \(!GIT_BRIEF\.has\(args\[0\]\)\) throw/);
  for (const m of src.matchAll(/git\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.ok(['log', 'status'].includes(m[1]), m[1]);
});
