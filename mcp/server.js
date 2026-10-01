#!/usr/bin/env node
// KevMind experience: a stdio MCP server (JSON-RPC, one message per line) that tells Claude what this project's
// history shows: past Claude Code sessions recorded by KevMind, and git. History only, no code parsing.
// It reads ~/.kevmind/experience.json, kept current by the dashboard, plus any log lines newer than that file,
// and never writes anything (test/experience-readonly.test.mjs). Off unless ~/.kevmind/config.json or the plugin's
// "experience_tools" option turns it on (src/config.js). Logs go to stderr; stdout carries protocol messages only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyAggregate, revive, updateFromLogs, refreshGit, projectAt, repoFor, answerFileContext, answerFileHistory, answerKnownFailures, THRESHOLDS,
} from '../src/experience.js';
import { projectRoot, keyOf } from '../src/memory.js';
import { experienceTools } from '../src/config.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
const DATA_DIR = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
// On when ~/.kevmind/config.json says so ("kevmind tools on" or the dashboard toggle) or, when that file doesn't
// say, when the plugin option does. Read once: a change takes effect in the next Claude Code session.
const ENABLED = experienceTools(DATA_DIR, process.env.KEVMIND_EXPERIENCE).on;
const AGG_FILE = path.join(DATA_DIR, 'experience.json');
const ROOT = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const NAME = path.basename(ROOT);
const REFRESH_MS = 2000;
const GIT_STALE_MS = 24 * 60 * 60_000;

const SERENA = 'For code structure (symbols, references, definitions) use Serena or other code tools if available; KevMind only reports history.';
const TOOLS = [
  {
    name: 'file_context',
    description: 'Call before editing files you have not worked on in this session: which files usually change or get read alongside them, ' +
      'from this project\'s past Claude Code sessions and git history, with counts and dates. Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'File paths, relative to the project or absolute. Files in a git repo nested inside the project are answered from that repo' } }, required: ['paths'] },
  },
  {
    name: 'file_history',
    description: 'How often past sessions read and edited one file, by which agent types, and how often git changed or fixed it. ' +
      'Call when unsure whether a file is risky to touch. Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File path, relative to the project or absolute. A file in a git repo nested inside the project is answered from that repo' } }, required: ['path'] },
  },
  {
    name: 'known_failures',
    description: 'Call after a command fails: whether this project saw the same failure before and what came before the next success. ' +
      'Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: {
      command: { type: 'string', description: 'The failing command, or its start such as "npm test"' },
      path: { type: 'string', description: 'Optional: the folder the command ran in, to answer from a git repo nested in this project (such as "frontend")' },
    } },
  },
];

// The aggregate: the dashboard's file if present, brought up to date with newer log lines; built from the logs
// once when the file is missing. Kept in memory and refreshed at most every 2 s.
let agg = null;
let aggMtime = 0;
let checked = 0;
async function data() {
  const now = Date.now();
  if (agg && now - checked < REFRESH_MS) return agg;
  checked = now;
  let mtime = 0;
  try { mtime = fs.statSync(AGG_FILE).mtimeMs; } catch { /* the dashboard has not written it yet */ }
  if (!agg || mtime > aggMtime) {
    agg = emptyAggregate();
    if (mtime) { try { agg = revive(JSON.parse(fs.readFileSync(AGG_FILE, 'utf8'))); aggMtime = mtime; } catch { agg = emptyAggregate(); } }
  }
  if (!(await updateFromLogs(agg, DATA_DIR, now))) { agg = emptyAggregate(); await updateFromLogs(agg, DATA_DIR, now); }
  return agg;
}

// One repo's project, with git refreshed when stale. With no KevMind activity there yet, git alone can answer.
async function projectFor(root) {
  const a = await data();
  const now = Date.now();
  let proj = a.projects[keyOf(root)];
  if (!proj && !fs.existsSync(path.join(root, '.git'))) return null;
  proj ||= projectAt(a, root);
  if (!proj.git || now - proj.git.at > GIT_STALE_MS) await refreshGit(proj, now);
  return proj;
}

// Each path is answered from the git repo that holds it, when that is a separate repo nested inside the session's
// folder (frontend/ with its own .git); never from repos outside it. Answers name the repo when it isn't the root.
function where(repo) {
  if (repo === ROOT) return { name: NAME, prefix: '' };
  const rel = path.relative(ROOT, repo).split(path.sep).join('/');
  return { name: `${NAME}/${rel} (a separate git repo inside ${NAME})`, prefix: rel + '/' };
}

async function call(name, args = {}) {
  const now = Date.now();
  if (name === 'file_context') {
    const groups = new Map();
    for (const p of (Array.isArray(args.paths) ? args.paths.map(String) : []).slice(0, 10)) {
      const repo = repoFor(ROOT, p);
      (groups.get(repo) || groups.set(repo, []).get(repo)).push(repo === ROOT ? p : path.resolve(ROOT, p));
    }
    if (!groups.size) groups.set(ROOT, []);
    // An equal share of the cap per repo; what a short answer leaves unused goes to the ones that were cut.
    const answer = async ([repo, paths], tokens) => {
      const w = where(repo);
      return answerFileContext(await projectFor(repo), w.name, paths, now, { prefix: w.prefix, tokens });
    };
    const list = [...groups];
    const share = Math.floor(THRESHOLDS.maxTokens / list.length) - 1; // 1 token for the blank line between answers
    const out = [];
    for (const g of list) out.push(await answer(g, share));
    for (let i = 0; i < out.length; i++) {
      const spare = list.length * share - out.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
      if (spare > 0 && /left out to stay under/.test(out[i])) out[i] = await answer(list[i], Math.ceil(out[i].length / 4) + spare);
    }
    return out.join('\n\n');
  }
  if (name === 'file_history') {
    const p = String(args.path || '');
    const repo = p ? repoFor(ROOT, p) : ROOT;
    const w = where(repo);
    return answerFileHistory(await projectFor(repo), w.name, repo === ROOT ? p : path.resolve(ROOT, p), now, { prefix: w.prefix });
  }
  if (name === 'known_failures') {
    const repo = args.path ? repoFor(ROOT, String(args.path)) : ROOT;
    return answerKnownFailures(await projectFor(repo), where(repo).name, args.command ? String(args.command) : '', now);
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kevmind-experience', version: VERSION } };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: ENABLED ? TOOLS : [] };
    case 'tools/call': {
      if (!ENABLED) return { content: [{ type: 'text', text: 'KevMind experience tools are turned off. Turn them on with "kevmind tools on" or in the Experience panel of the dashboard.' }], isError: true };
      try {
        return { content: [{ type: 'text', text: await call(params?.name, params?.arguments) }] };
      } catch (e) {
        if (e.code) throw e;
        process.stderr.write(`kevmind-experience: ${e.stack || e}\n`);
        return { content: [{ type: 'text', text: `KevMind could not answer: ${e.message}` }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined; // a notification, such as notifications/initialized
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    const p = handle(msg).then(
      (result) => { if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); },
      (e) => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); },
    ).finally(() => pending.delete(p));
    pending.add(p);
  }
});
// When the client closes stdin, answer what was already asked, then exit.
const pending = new Set();
process.stdin.on('end', async () => {
  await Promise.allSettled(pending);
  process.stdout.write('', () => process.exit(0));
});
