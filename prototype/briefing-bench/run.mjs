// The session briefing's controlled benchmark (design: .claude/design/briefing-benchmark.md, git-ignored).
//
//   node prototype/briefing-bench/run.mjs check                      hidden tests fail at each parent, pass at the fix (no tokens)
//   node prototype/briefing-bench/run.mjs briefing --task 1          the briefing a session at the parent would get (no tokens)
//   node prototype/briefing-bench/run.mjs run --task 1 --arm with --n 1 --model <id>     one headless run (spends tokens)
//   node prototype/briefing-bench/run.mjs series --tasks 1,2,3 --n 3 --tag stage1   one run at a time, arms alternating (spends tokens)
//   node prototype/briefing-bench/run.mjs report [--tag stage1]      every run, per task and overall, from the recorded runs
// The binary is `claude` on PATH (or --claude); it is checked against the pinned model's minimum version before any run.
//
// Each run: a fresh git worktree at the fix's parent, `claude -p` with the user's settings, plugins and MCP servers left
// out, a one-file bench plugin that hands Claude the task's briefing ("with") or nothing ("without"), then the fix
// commit's own tests copied in and run. Results go to .claude/bench/ (git-ignored), never into the package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TASKS } from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, '.claude', 'bench');
const PLUGIN = path.join(HERE, 'plugin');
const TMP = path.join(os.tmpdir(), 'kevmind-bench');
const TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(node --test:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)'];
const RUN_TIMEOUT_MS = 25 * 60_000;
const MODEL = 'claude-opus-5-5[1m]'; // the owner's usual model (settings: opus[1m])
// The Claude Code binary: --claude, else `claude` on PATH.
const claudeBin = () => arg('claude') || 'claude';
// The oldest Claude Code that can run each model, from the CLI's own error ("version 2.1.280 or newer is required").
// ponytail: one entry per model the benchmark has pinned; a model not listed is only caught by the run itself.
const MIN_VERSION = { 'claude-opus-5-5': '2.1.280' };
const SUPPORT_RE = /does not support this model/i;
// Whether this binary can run the model, before any token is spent: its version against the model's minimum.
function checkBinary(bin, model) {
  const out = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  const version = (/(\d+\.\d+\.\d+) \(Claude Code\)/.exec(out.stdout || '') || [])[1];
  if (!version) throw new Error(`"${bin}" is not a Claude Code binary (or not on PATH): ${out.error?.message || out.stderr || 'no version'}`);
  const need = MIN_VERSION[model.replace(/\[.*\]$/, '')];
  const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  if (need && older(version, need)) throw new Error(`Claude Code ${version} at "${bin}" can't run ${model}: it needs ${need} or newer. Run "claude update", or pass --claude <path to a newer binary>.`);
  if (!need) console.warn(`  warning: no known minimum Claude Code version for ${model}; a run that says it doesn't support the model stops the series.`);
  return `${version} (Claude Code)`;
}

const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 }).trim();
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const taskOf = (id) => TASKS.find((t) => String(t.id) === String(id)) || (() => { throw new Error(`no task ${id}`); })();

function worktree(rev, label) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  git(['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', dir, rev]); // files as committed (LF), as the tests expect
  return { dir, remove: () => { try { git(['worktree', 'remove', '--force', dir]); } catch { /* already gone */ } } };
}
// The fix commit's tests, copied over the worktree's, then run: the hidden tests by name, and the whole suite.
function verify(dir, task) {
  for (const f of task.hidden.files) fs.writeFileSync(path.join(dir, f), git(['show', `${task.fix}:${f}`]) + '\n');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const node = (args) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', timeout: 5 * 60_000, windowsHide: true, env: { ...process.env, KEVMIND_AUTOSTART: '0' } });
  const hidden = node(['--test', `--test-name-pattern=^(${task.hidden.tests.map(esc).join('|')})$`, ...task.hidden.files]);
  const suite = node(['--test']);
  const count = (out, k) => Number((new RegExp(`ℹ ${k} (\\d+)`).exec(out) || [])[1] || 0);
  return {
    hidden: hidden.status === 0 && count(hidden.stdout, 'pass') === task.hidden.tests.length,
    hiddenPass: count(hidden.stdout, 'pass'), suite: suite.status === 0, suitePass: count(suite.stdout, 'pass'), suiteFail: count(suite.stdout, 'fail'),
  };
}

// ---- check: each hidden test fails at the parent and passes at the fix ---------------------------------------------
function check() {
  for (const t of TASKS) {
    const parent = worktree(`${t.fix}^`, `check-${t.id}-parent`), fixed = worktree(t.fix, `check-${t.id}-fix`);
    try {
      const a = verify(parent.dir, t), b = verify(fixed.dir, t);
      console.log(`task ${t.id} (${t.fix}): at the parent hidden ${a.hidden ? 'PASSES (bad)' : 'fails (good)'}, at the fix hidden ${b.hidden ? 'passes (good)' : 'FAILS (bad)'}, suite at the fix ${b.suite ? 'passes' : `fails ${b.suiteFail}`}`);
    } finally { parent.remove(); fixed.remove(); }
  }
}

// ---- briefing: what a session starting at the parent would have received -------------------------------------------
// KevMind's records cut at the parent's commit time (later episodes dropped), git and the code of a worktree at the
// parent, its CLAUDE.md. Auto-memory notes are left out (they are written later and could give the fix away), and so
// is the line naming the tools, which are off in both arms.
async function briefing(task) {
  const src = (f) => import(pathToFileURL(path.join(REPO, 'src', f)).href);
  const [{ revive, refreshGit }, { gatherFacts, briefingText }, { scanProject }, { codeMapper }, { buildTree }] = await Promise.all(['experience.js', 'briefing.js', 'memory.js', 'codemap.js', 'tree.js'].map(src));
  const cutoff = Number(git(['log', '-1', '--format=%ct', `${task.fix}^`])) * 1000;
  const wt = worktree(`${task.fix}^`, `brief-${task.id}`);
  try {
    const agg = revive(JSON.parse(fs.readFileSync(path.join(process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind'), 'experience.json'), 'utf8')));
    const key = Object.keys(agg.projects).find((k) => path.resolve(agg.projects[k].root).toLowerCase() === REPO.toLowerCase());
    if (!key) throw new Error('KevMind has no record of this repo yet');
    const proj = agg.projects[key];
    agg.projects = { [key]: proj };
    for (const [sid, s] of Object.entries(proj.sessions)) {
      s.eps = s.eps.filter((ep) => ep.last < cutoff);
      if (!s.eps.length) { delete proj.sessions[sid]; continue; }
      s.first = Math.min(...s.eps.map((ep) => ep.start)); s.last = Math.max(...s.eps.map((ep) => ep.last));
    }
    proj.root = wt.dir; proj.git = null; proj._ctx = null;
    await refreshGit(proj, cutoff);
    const report = await scanProject(wt.dir, { now: cutoff });
    const map = await codeMapper()(wt.dir);
    const tree = await buildTree({ root: wt.dir, map, report, agg, now: cutoff }); // the project map as it was then
    const facts = await gatherFacts({ agg, root: wt.dir, name: 'KevMind', sid: 'bench', source: 'startup', now: cutoff, report, toolsOn: false, map, tree });
    const { text } = briefingText(facts);
    fs.mkdirSync(path.join(OUT, 'briefings'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'briefings', `${task.id}.txt`), text);
    return text;
  } finally { wt.remove(); }
}

// ---- run: one headless Claude Code run ----------------------------------------------------------------------------
async function run(task, arm, n, model, series = null) {
  const ctxFile = path.join(OUT, 'briefings', `${task.id}.txt`);
  if (arm === 'with' && !fs.existsSync(ctxFile)) throw new Error(`no briefing for task ${task.id}: run "briefing --task ${task.id}" first`);
  const day = new Date().toLocaleDateString('en-CA'), dir = path.join(OUT, 'results', day);
  fs.mkdirSync(dir, { recursive: true });
  const wt = worktree(`${task.fix}^`, `run-${task.id}-${arm}-${n}`);
  const streamFile = path.join(dir, `${task.id}-${arm}-${n}-${Date.now()}.jsonl`);
  const env = { ...process.env, BENCH_CONTEXT_FILE: arm === 'with' ? ctxFile : '', KEVMIND_AUTOSTART: '0', KEVMIND_PORT: '47999' };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]; // a fresh session, not a child of this one
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', model,
    '--setting-sources', 'project,local', '--plugin-dir', PLUGIN, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--no-session-persistence', '--permission-mode', 'dontAsk', '--max-turns', '60', '--allowedTools', ...TOOLS];
  const bin = claudeBin(), version = checkBinary(bin, model);
  const t0 = Date.now();
  try {
    const out = fs.createWriteStream(streamFile);
    const code = await new Promise((resolve) => {
      const child = spawn(bin, args, { cwd: wt.dir, env, windowsHide: true });
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
      child.stdout.pipe(out);
      child.stderr.on('data', (d) => process.stderr.write(d));
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
      child.stdin.end(task.prompt);
    });
    await new Promise((r) => out.end(r));
    const m = measure(fs.readFileSync(streamFile, 'utf8'), wt.dir);
    const diff = git(['diff', '--shortstat'], wt.dir);
    const untracked = git(['status', '--porcelain'], wt.dir).split('\n').filter((l) => l.startsWith('??')).length;
    const v = verify(wt.dir, task);
    const rec = { task: task.id, arm, n, model, version, series, at: t0, wallMs: Date.now() - t0, exit: code, ...m, diff, untracked, ...v, stream: path.relative(REPO, streamFile) };
    fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(rec) + '\n');
    if (m.unsupported) throw new Error(`${bin} (${version}) can't run ${model}: ${m.unsupported}`); // stops a series
    return rec;
  } finally { wt.remove(); }
}

// What a run's stream says: tokens, turns, tool calls, files read and read again, whether the hook gave context.
function measure(stream, cwd) {
  const lines = stream.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const result = lines.findLast((o) => o.type === 'result') || {};
  const init = lines.find((o) => o.type === 'system' && o.subtype === 'init') || {};
  const tools = {}, reads = [];
  for (const o of lines) {
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b.type !== 'tool_use') continue;
      tools[b.name] = (tools[b.name] || 0) + 1;
      if (b.name === 'Read' && b.input?.file_path) reads.push(path.relative(cwd, path.resolve(cwd, b.input.file_path)).split(path.sep).join('/'));
    }
  }
  const u = result.usage || {};
  const tok = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
  return {
    models: Object.keys(result.modelUsage || {}), initModel: init.model || null,
    hookContext: lines.some((o) => o.type === 'system' && /hook/.test(o.subtype || '') && /additionalContext/.test(JSON.stringify(o))),
    // An API error before any work (wrong CLI version, outage) is the harness failing, not the run: the report skips it.
    infraError: result.terminal_reason === 'api_error' && !(result.usage?.output_tokens), terminalReason: result.terminal_reason || null,
    unsupported: SUPPORT_RE.test(String(result.result || '')) ? String(result.result).slice(0, 200) : null,
    subtype: result.subtype || null, isError: !!result.is_error, turns: result.num_turns ?? null, durationMs: result.duration_ms ?? null, apiMs: result.duration_api_ms ?? null,
    tokens: { ...tok, total: tok.input + tok.output + tok.cacheRead + tok.cacheWrite, measured: tok.input + tok.output + tok.cacheRead },
    modelUsage: result.modelUsage || null,
    toolCalls: Object.values(tools).reduce((a, b) => a + b, 0), tools, filesRead: new Set(reads).size, reads: reads.length, rereads: reads.length - new Set(reads).size,
  };
}

// ---- series: tasks one at a time, n runs per arm, the arms alternating (with, without, without, with, …) ----------
async function series(ids, n, model, tag) {
  checkBinary(claudeBin(), model); // before the first token
  for (const id of ids) {
    const task = taskOf(id);
    for (let k = 1; k <= n; k++) {
      for (const arm of k % 2 ? ['with', 'without'] : ['without', 'with']) {
        const t0 = Date.now();
        const r = await run(task, arm, k, model, tag);
        console.log(`task ${id} ${arm} #${k}: ${(r.tokens.total / 1e6).toFixed(2)} M tokens, ${((Date.now() - t0) / 60_000).toFixed(1)} min, ${r.hidden && r.suite ? 'success' : 'FAILED'}`);
      }
    }
  }
}

// ---- report: every run, then per task (median of each arm) and overall ---------------------------------------------
// The verdict rule, decided before the runs: "saves" only if every task's median tokens are at least 10% lower with
// the briefing and successes with ≥ without; "costs" if every task is at least 10% higher; otherwise "unclear".
function report(tag) {
  const runs = fs.readdirSync(path.join(OUT, 'results')).flatMap((d) => { const f = path.join(OUT, 'results', d, 'runs.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; })
    .filter((r) => (tag ? tag.split(',').includes(r.series) : true) && !r.infraError && !r.superseded && r.tokens.total > 0); // superseded: a task fixed since
  const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
  const M = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
  const min = (ms) => `${(ms / 60_000).toFixed(1)} min`;
  const pct = (a, b) => (a == null || !b ? '—' : `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`);
  const ok = (r) => r.hidden && r.suite;
  const out = [`# Briefing benchmark${tag ? ` (${tag})` : ''}`, '', `Model: ${[...new Set(runs.map((r) => r.model))].join(', ')}. Claude Code: ${[...new Set(runs.map((r) => r.version))].join(', ')}. Runs: ${runs.length}.`, '', '## Every run', '',
    '| Task | Arm | # | Success | Tokens | Cache reads | Cache writes | Output | Wall time | Turns | Tool calls | Files read | Re-reads | Diff |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...runs].sort((a, b) => a.task - b.task || a.at - b.at)) {
    out.push(`| ${r.task} | ${r.arm} | ${r.n} | ${ok(r) ? 'yes' : `no (hidden ${r.hidden ? 'pass' : 'fail'}, suite ${r.suite ? 'pass' : `${r.suiteFail} fail`})`} | ${M(r.tokens.total)} | ${M(r.tokens.cacheRead)} | ${M(r.tokens.cacheWrite)} | ${M(r.tokens.output)} | ${min(r.wallMs)} | ${r.turns} | ${r.toolCalls} | ${r.filesRead} | ${r.rereads} | ${r.diff || '—'} |`);
  }
  out.push('', '## Per task (medians)', '', '| Task | Success with | Success without | Tokens with | Tokens without | Change | Wall with | Wall without | Change | Tool calls with / without | Files read with / without |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const per = [];
  for (const t of TASKS) {
    const w = runs.filter((r) => r.task === t.id && r.arm === 'with'), wo = runs.filter((r) => r.task === t.id && r.arm === 'without');
    if (!w.length || !wo.length) continue;
    const x = { task: t.id, okW: w.filter(ok).length, okWo: wo.filter(ok).length, nW: w.length, nWo: wo.length, tW: med(w.map((r) => r.tokens.total)), tWo: med(wo.map((r) => r.tokens.total)), sW: med(w.map((r) => r.wallMs)), sWo: med(wo.map((r) => r.wallMs)) };
    per.push(x);
    out.push(`| ${t.id} | ${x.okW}/${x.nW} | ${x.okWo}/${x.nWo} | ${M(x.tW)} | ${M(x.tWo)} | ${pct(x.tW, x.tWo)} | ${min(x.sW)} | ${min(x.sWo)} | ${pct(x.sW, x.sWo)} | ${med(w.map((r) => r.toolCalls))} / ${med(wo.map((r) => r.toolCalls))} | ${med(w.map((r) => r.filesRead))} / ${med(wo.map((r) => r.filesRead))} |`);
  }
  const lower = per.filter((x) => x.tW <= x.tWo * 0.9).length, higher = per.filter((x) => x.tW >= x.tWo * 1.1).length;
  const okW = per.reduce((n, x) => n + x.okW, 0), okWo = per.reduce((n, x) => n + x.okWo, 0);
  const verdict = per.length && lower === per.length && okW >= okWo ? 'saves tokens without hurting success' : per.length && higher === per.length ? 'costs tokens' : 'unclear';
  const ratios = per.map((x) => x.tW / x.tWo);
  out.push('', '## Overall', '',
    `- Tasks with at least 10% fewer tokens with the briefing: ${lower} of ${per.length}; at least 10% more: ${higher} of ${per.length}.`,
    `- Median of the per-task token ratios (with / without): ${ratios.length ? med(ratios).toFixed(2) : '—'}; wall time: ${per.length ? med(per.map((x) => x.sW / x.sWo)).toFixed(2) : '—'}.`,
    `- Successes: ${okW} of ${per.reduce((n, x) => n + x.nW, 0)} with, ${okWo} of ${per.reduce((n, x) => n + x.nWo, 0)} without.`,
    `- Tokens spent by these runs: ${M(runs.reduce((n, r) => n + r.tokens.total, 0))}.`,
    `- Verdict (rule fixed in advance: every task at least 10% lower and no fewer successes): **${verdict}**.`);
  const text = out.join('\n');
  fs.writeFileSync(path.join(OUT, `report${tag ? `-${tag}` : ''}.md`), text + '\n');
  console.log(text);
}

const cmd = process.argv[2];
if (cmd === 'check') check();
else if (cmd === 'briefing') console.log(await briefing(taskOf(arg('task', 1))));
else if (cmd === 'run') console.log(JSON.stringify(await run(taskOf(arg('task', 1)), arg('arm', 'with'), Number(arg('n', 1)), arg('model', 'claude-opus-5-5[1m]')), null, 1));
else if (cmd === 'claude-check') console.log(`ok: ${claudeBin()} is Claude Code ${checkBinary(claudeBin(), arg('model', MODEL))}, which can run ${arg('model', MODEL)}`);
else if (cmd === 'series') await series(String(arg('tasks', '1,2,3')).split(','), Number(arg('n', 3)), arg('model', MODEL), arg('tag', null));
else if (cmd === 'report') report(arg('tag', null));
else console.log('usage: run.mjs check | briefing --task N | run --task N --arm with|without --n K [--model ID] | series --tasks 1,2,3 --n 3 --tag NAME | report [--tag NAME]');
