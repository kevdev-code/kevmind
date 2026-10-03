// The session briefing's controlled benchmark (design: .claude/design/briefing-benchmark*.md, git-ignored).
//
//   node prototype/briefing-bench/run.mjs check                      hidden tests fail at each parent, pass at the fix (no tokens)
//   node prototype/briefing-bench/run.mjs briefing --task 1          the briefing a session at the parent would get (no tokens)
//   node prototype/briefing-bench/run.mjs run --task 1 --arm with --n 1 [--model <id>]     one headless run (spends tokens)
//   node prototype/briefing-bench/run.mjs series --tasks 1,2,3 --n 3 --tag stage1   one run at a time, arms alternating (spends tokens)
//   node prototype/briefing-bench/run.mjs report [--tag stage1]      every run, per task and overall, from the recorded runs
//   --project <name>: another project's tasks, from .claude/bench/<name>/tasks.mjs (git-ignored: private code). KevMind's
//   own tasks are in ./tasks.mjs.
// The binary is `claude` on PATH (or --claude); it is checked against the pinned model's minimum version before any run.
//
// Each run: the project's workspace as it was (its repo, and repos nested in it, as git worktrees: the task's repo at
// the fix's parent, the others at their last commit before then), `claude -p` with the user's settings, plugins and MCP
// servers left out, a one-file bench plugin that hands Claude the task's briefing ("with") or nothing ("without"), then
// the fix commit's own tests copied in and run. Results go to .claude/bench/ (git-ignored), never into the package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PLUGIN = path.join(HERE, 'plugin');
const TMP = path.join(os.tmpdir(), 'kevmind-bench');
const RUN_TIMEOUT_MS = 25 * 60_000;
const MODEL = 'claude-opus-5-5[1m]'; // the owner's usual model (settings: opus[1m])
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };

// The project: KevMind by default; another one from its git-ignored tasks file. A project says where it lives, the repos
// nested in it, the folders linked into each workspace (node_modules: never installed per run), the tools a run may use,
// and how its test runners report.
const KEVMIND = {
  key: 'kevmind', name: 'KevMind', root: REPO, nested: [], links: [], maxTurns: 60,
  tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(node --test:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)'],
};
const projectName = arg('project', 'kevmind');
const { PROJECT, TASKS } = projectName === 'kevmind'
  ? { PROJECT: KEVMIND, TASKS: (await import('./tasks.mjs')).TASKS }
  : await import(pathToFileURL(path.join(REPO, '.claude', 'bench', projectName, 'tasks.mjs')).href);
const OUT = PROJECT.key === 'kevmind' ? path.join(REPO, '.claude', 'bench') : path.join(REPO, '.claude', 'bench', PROJECT.key);
const taskOf = (id) => TASKS.find((t) => String(t.id) === String(id)) || (() => { throw new Error(`no task ${id}`); })();
const repoDir = (rel = '') => path.join(PROJECT.root, rel);
const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 }).trim();

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

// ---- the workspace as it was ----------------------------------------------------------------------------------------
// The task's repo at the fix's parent (or the fix, with at = 'fix'); every other repo of the project at its last commit
// before that moment, nested where it lives. Files as committed (LF), as the tests expect. Linked folders are junctions
// to the real ones, and they are removed BEFORE the worktrees: `git worktree remove --force` would follow a junction and
// delete what it points to (tried: it does).
function workspace(task, label, at = 'parent') {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  const rev = at === 'fix' ? task.fix : `${task.fix}^`, own = task.repo || '';
  const time = Number(git(['log', '-1', '--format=%ct', rev], repoDir(own)));
  const revOf = (r) => (r === own ? rev : git(['rev-list', '-1', `--before=${time}`, 'HEAD'], repoDir(r)));
  const made = [], links = [];
  const remove = () => {
    for (const l of links) { try { fs.rmSync(l); } catch { /* not there */ } }
    if (links.some((l) => { try { fs.lstatSync(l); return true; } catch { return false; } })) throw new Error(`a linked folder is still in ${dir}: not removing the worktrees (it would delete the real folder)`);
    for (const [repo, d] of made.reverse()) { try { git(['worktree', 'remove', '--force', d], repo); } catch { /* already gone */ } }
  };
  try {
    for (const r of ['', ...PROJECT.nested]) {
      const d = path.join(dir, r);
      git(['-c', 'core.autocrlf=false', 'worktree', 'add', '--detach', d, revOf(r)], repoDir(r));
      made.push([repoDir(r), d]);
    }
    for (const l of PROJECT.links) { const link = path.join(dir, l); fs.symlinkSync(path.join(PROJECT.root, l), link, 'junction'); links.push(link); }
  } catch (e) { remove(); throw e; }
  return { dir, own: path.join(dir, own), time: time * 1000, remove };
}

// ---- verify: the fix commit's tests, copied over the workspace's, then run ------------------------------------------
// task.hidden: { files, tests (names), count (how many must pass), cmd: [bin, ...args] } and task.suite: [bin, ...args],
// both run in the task's repo; task.runner: 'node' | 'vitest' | 'bun' (how its output counts passes and failures).
const RUNNERS = {
  node: { pass: /ℹ pass (\d+)/, fail: /ℹ fail (\d+)/ },
  vitest: { pass: /Tests\s+(?:\d+ failed \| )?(\d+) passed/, fail: /Tests\s+(\d+) failed/ },
  bun: { pass: /^\s*(\d+) pass/m, fail: /^\s*(\d+) fail/m },
};
function verify(ws, task) {
  const own = repoDir(task.repo || '');
  for (const f of task.hidden.files) fs.writeFileSync(path.join(ws.own, f), git(['show', `${task.fix}:${f}`], own) + '\n');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exec = ([bin, ...args]) => spawnSync(bin === 'node' ? process.execPath : bin, args, { cwd: ws.own, encoding: 'utf8', timeout: 8 * 60_000, windowsHide: true, env: { ...process.env, KEVMIND_AUTOSTART: '0', NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' } });
  const hiddenCmd = task.hidden.cmd || ['node', '--test', `--test-name-pattern=^(${task.hidden.tests.map(esc).join('|')})$`, ...task.hidden.files];
  const hidden = exec(hiddenCmd), suite = exec(task.suite || ['node', '--test']);
  const R = RUNNERS[task.runner || 'node'], all = (r) => `${r.stdout}\n${r.stderr}`;
  const count = (out, re) => Number((re.exec(out) || [])[1] || 0);
  const need = task.hidden.count ?? task.hidden.tests.length;
  return {
    hidden: hidden.status === 0 && count(all(hidden), R.pass) >= need,
    hiddenPass: count(all(hidden), R.pass), suite: suite.status === 0, suitePass: count(all(suite), R.pass), suiteFail: count(all(suite), R.fail),
  };
}

// ---- check: each hidden test fails at the parent and passes at the fix ---------------------------------------------
function check() {
  for (const t of TASKS) {
    const parent = workspace(t, `check-${t.id}-parent`), fixed = workspace(t, `check-${t.id}-fix`, 'fix');
    try {
      const a = verify(parent, t), b = verify(fixed, t);
      console.log(`task ${t.id} (${t.repo || '.'} ${t.fix}): at the parent hidden ${a.hidden ? 'PASSES (bad)' : `fails (good: ${a.hiddenPass} of ${t.hidden.count ?? t.hidden.tests.length} pass)`}, at the fix hidden ${b.hidden ? `passes (good: ${b.hiddenPass})` : `FAILS (bad: ${b.hiddenPass} pass)`}, suite at the fix ${b.suite ? `passes (${b.suitePass})` : `fails ${b.suiteFail}`}`);
    } finally { parent.remove(); fixed.remove(); }
  }
}

// ---- briefing: what a session starting at the parent would have received -------------------------------------------
// KevMind's records of the project cut at that moment (later episodes dropped), git and the code of the workspace as it
// was, its CLAUDE.md files, and the project map built from them. Auto-memory notes are left out (they have no history,
// and later notes could give the fix away), and so is the line naming the tools, which are off in both arms.
async function briefing(task) {
  const src = (f) => import(pathToFileURL(path.join(REPO, 'src', f)).href);
  const [{ revive, refreshGit }, { gatherFacts, briefingText }, { scanProject }, { codeMapper }, { buildTree }] = await Promise.all(['experience.js', 'briefing.js', 'memory.js', 'codemap.js', 'tree.js'].map(src));
  const ws = workspace(task, `brief-${task.id}`), cutoff = ws.time;
  try {
    const agg = revive(JSON.parse(fs.readFileSync(path.join(process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind'), 'experience.json'), 'utf8')));
    // The project's repos in the records, moved into the workspace.
    const kept = {};
    for (const r of ['', ...PROJECT.nested]) {
      const key = Object.keys(agg.projects).find((k) => path.resolve(agg.projects[k].root).toLowerCase() === repoDir(r).toLowerCase());
      if (!key) continue;
      const proj = agg.projects[key];
      for (const [sid, s] of Object.entries(proj.sessions)) {
        s.eps = s.eps.filter((ep) => ep.last < cutoff);
        if (!s.eps.length) { delete proj.sessions[sid]; continue; }
        s.first = Math.min(...s.eps.map((ep) => ep.start)); s.last = Math.max(...s.eps.map((ep) => ep.last));
      }
      proj.root = path.join(ws.dir, r); proj.git = null; proj._ctx = null;
      await refreshGit(proj, cutoff);
      kept[key] = proj;
    }
    agg.projects = kept;
    const report = await scanProject(ws.dir, { now: cutoff });
    const map = await codeMapper()(ws.dir);
    const tree = await buildTree({ root: ws.dir, map, report, agg, now: cutoff }); // the project map as it was then
    const facts = await gatherFacts({ agg, root: ws.dir, name: PROJECT.name, sid: 'bench', source: 'startup', now: cutoff, report, toolsOn: false, map, tree });
    const { text } = briefingText(facts);
    fs.mkdirSync(path.join(OUT, 'briefings'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'briefings', `${task.id}.txt`), text);
    return text;
  } finally { ws.remove(); }
}

// ---- run: one headless Claude Code run ----------------------------------------------------------------------------
async function run(task, arm, n, model, series = null) {
  const ctxFile = path.join(OUT, 'briefings', `${task.id}.txt`);
  if (arm === 'with' && !fs.existsSync(ctxFile)) throw new Error(`no briefing for task ${task.id}: run "briefing --task ${task.id}" first`);
  const day = new Date().toLocaleDateString('en-CA'), dir = path.join(OUT, 'results', day);
  fs.mkdirSync(dir, { recursive: true });
  const bin = claudeBin(), version = checkBinary(bin, model);
  const ws = workspace(task, `run-${task.id}-${arm}-${n}`);
  const streamFile = path.join(dir, `${task.id}-${arm}-${n}-${Date.now()}.jsonl`);
  const env = { ...process.env, BENCH_CONTEXT_FILE: arm === 'with' ? ctxFile : '', KEVMIND_AUTOSTART: '0', KEVMIND_PORT: '47999' };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]; // a fresh session, not a child of this one
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', model,
    '--setting-sources', 'project,local', '--plugin-dir', PLUGIN, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--no-session-persistence', '--permission-mode', 'dontAsk', '--max-turns', String(PROJECT.maxTurns), '--allowedTools', ...PROJECT.tools];
  const t0 = Date.now();
  try {
    const out = fs.createWriteStream(streamFile);
    const code = await new Promise((resolve) => {
      const child = spawn(bin, args, { cwd: ws.dir, env, windowsHide: true });
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
      child.stdout.pipe(out);
      child.stderr.on('data', (d) => process.stderr.write(d));
      child.on('close', (c) => { clearTimeout(timer); resolve(c); });
      child.stdin.end(task.prompt);
    });
    await new Promise((r) => out.end(r));
    const m = measure(fs.readFileSync(streamFile, 'utf8'), ws.dir);
    const diff = git(['diff', '--shortstat'], ws.own);
    const untracked = git(['status', '--porcelain'], ws.own).split('\n').filter((l) => l.startsWith('??')).length;
    const v = verify(ws, task);
    const rec = { task: task.id, arm, n, model, version, series, at: t0, wallMs: Date.now() - t0, exit: code, ...m, diff, untracked, ...v, stream: path.relative(REPO, streamFile) };
    fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(rec) + '\n');
    if (m.unsupported) throw new Error(`${bin} (${version}) can't run ${model}: ${m.unsupported}`); // stops a series
    return rec;
  } finally { ws.remove(); }
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
// A control task (task.control: its prompt names what to change, so it needs little exploring) is reported apart and
// left out of the verdict.
function report(tag) {
  const runs = fs.readdirSync(path.join(OUT, 'results')).flatMap((d) => { const f = path.join(OUT, 'results', d, 'runs.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; })
    .filter((r) => (tag ? tag.split(',').includes(r.series) : true) && !r.infraError && !r.superseded && r.tokens.total > 0); // superseded: a task fixed since
  const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
  const M = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
  const min = (ms) => `${(ms / 60_000).toFixed(1)} min`;
  const pct = (a, b) => (a == null || !b ? '—' : `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`);
  const ok = (r) => r.hidden && r.suite;
  const control = new Set(TASKS.filter((t) => t.control).map((t) => String(t.id)));
  const out = [`# Briefing benchmark: ${PROJECT.name}${tag ? ` (${tag})` : ''}`, '', `Model: ${[...new Set(runs.map((r) => r.model))].join(', ')}. Claude Code: ${[...new Set(runs.map((r) => r.version))].join(', ')}. Runs: ${runs.length}.`, '', '## Every run', '',
    '| Task | Arm | # | Success | Tokens | Cache reads | Cache writes | Output | Wall time | Turns | Tool calls | Files read | Re-reads | Diff |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of [...runs].sort((a, b) => String(a.task).localeCompare(String(b.task)) || a.at - b.at)) {
    out.push(`| ${r.task}${control.has(String(r.task)) ? ' (control)' : ''} | ${r.arm} | ${r.n} | ${ok(r) ? 'yes' : `no (hidden ${r.hidden ? 'pass' : 'fail'}, suite ${r.suite ? 'pass' : `${r.suiteFail} fail`})`} | ${M(r.tokens.total)} | ${M(r.tokens.cacheRead)} | ${M(r.tokens.cacheWrite)} | ${M(r.tokens.output)} | ${min(r.wallMs)} | ${r.turns} | ${r.toolCalls} | ${r.filesRead} | ${r.rereads} | ${r.diff || '—'} |`);
  }
  out.push('', '## Per task (medians)', '', '| Task | Success with | Success without | Tokens with | Tokens without | Change | Wall with | Wall without | Change | Tool calls with / without | Files read with / without |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const per = [];
  for (const t of TASKS) {
    const w = runs.filter((r) => String(r.task) === String(t.id) && r.arm === 'with'), wo = runs.filter((r) => String(r.task) === String(t.id) && r.arm === 'without');
    if (!w.length || !wo.length) continue;
    const x = { task: t.id, control: !!t.control, okW: w.filter(ok).length, okWo: wo.filter(ok).length, nW: w.length, nWo: wo.length, tW: med(w.map((r) => r.tokens.total)), tWo: med(wo.map((r) => r.tokens.total)), sW: med(w.map((r) => r.wallMs)), sWo: med(wo.map((r) => r.wallMs)) };
    per.push(x);
    out.push(`| ${t.id}${t.control ? ' (control)' : ''} | ${x.okW}/${x.nW} | ${x.okWo}/${x.nWo} | ${M(x.tW)} | ${M(x.tWo)} | ${pct(x.tW, x.tWo)} | ${min(x.sW)} | ${min(x.sWo)} | ${pct(x.sW, x.sWo)} | ${med(w.map((r) => r.toolCalls))} / ${med(wo.map((r) => r.toolCalls))} | ${med(w.map((r) => r.filesRead))} / ${med(wo.map((r) => r.filesRead))} |`);
  }
  const main = per.filter((x) => !x.control);
  const lower = main.filter((x) => x.tW <= x.tWo * 0.9).length, higher = main.filter((x) => x.tW >= x.tWo * 1.1).length;
  const okW = main.reduce((n, x) => n + x.okW, 0), okWo = main.reduce((n, x) => n + x.okWo, 0);
  const verdict = main.length && lower === main.length && okW >= okWo ? 'saves tokens without hurting success' : main.length && higher === main.length ? 'costs tokens' : 'unclear';
  const ratios = main.map((x) => x.tW / x.tWo);
  out.push('', `## Overall${control.size ? ' (control tasks left out)' : ''}`, '',
    `- Tasks with at least 10% fewer tokens with the briefing: ${lower} of ${main.length}; at least 10% more: ${higher} of ${main.length}.`,
    `- Median of the per-task token ratios (with / without): ${ratios.length ? med(ratios).toFixed(2) : '—'}; wall time: ${main.length ? med(main.map((x) => x.sW / x.sWo)).toFixed(2) : '—'}.`,
    `- Successes: ${okW} of ${main.reduce((n, x) => n + x.nW, 0)} with, ${okWo} of ${main.reduce((n, x) => n + x.nWo, 0)} without.`,
    `- Tokens spent by these runs (control included): ${M(runs.reduce((n, r) => n + r.tokens.total, 0))}.`,
    `- Verdict (rule fixed in advance: every task at least 10% lower and no fewer successes): **${verdict}**.`);
  const text = out.join('\n');
  fs.writeFileSync(path.join(OUT, `report${tag ? `-${tag.replace(/,/g, '+')}` : ''}.md`), text + '\n');
  console.log(text);
}

const cmd = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--')); // the first word that is not a flag's value
if (cmd === 'check') check();
else if (cmd === 'briefing') console.log(await briefing(taskOf(arg('task', TASKS[0].id))));
else if (cmd === 'run') console.log(JSON.stringify(await run(taskOf(arg('task', TASKS[0].id)), arg('arm', 'with'), Number(arg('n', 1)), arg('model', MODEL)), null, 1));
else if (cmd === 'claude-check') console.log(`ok: ${claudeBin()} is Claude Code ${checkBinary(claudeBin(), arg('model', MODEL))}, which can run ${arg('model', MODEL)}`);
else if (cmd === 'series') await series(String(arg('tasks', TASKS.map((t) => t.id).join(','))).split(','), Number(arg('n', 3)), arg('model', MODEL), arg('tag', null));
else if (cmd === 'report') report(arg('tag', null));
else console.log('usage: run.mjs [--project NAME] check | briefing --task ID | run --task ID --arm with|without --n K [--model ID] | series --tasks A,B --n 3 --tag NAME | report [--tag NAME]');
