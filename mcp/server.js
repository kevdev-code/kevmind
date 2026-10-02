#!/usr/bin/env node
// KevMind experience: a stdio MCP server (JSON-RPC, one message per line) that tells Claude what this project's
// history shows (past Claude Code sessions recorded by KevMind, and git) and, through code_map, its approximate
// structure from import and export statements (src/codemap.js: names, never types; exact references are Serena's).
// It reads ~/.kevmind/experience.json, kept current by the dashboard, plus any log lines newer than that file,
// and never writes anything (test/experience-readonly.test.mjs). Off unless ~/.kevmind/config.json or the plugin's
// "experience_tools" option turns it on (src/config.js). Logs go to stderr; stdout carries protocol messages only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyAggregate, revive, updateFromLogs, refreshGit, projectAt, repoFor, relPath, history, partners, answerFileContext, answerFileHistory, answerKnownFailures, THRESHOLDS,
} from '../src/experience.js';
import { codeMapper, answerCodeMap } from '../src/codemap.js';
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

const SERENA = 'For structure, KevMind\'s code_map is approximate (imports, exports, names); exact references and definitions come from Serena or a language server.';
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
  {
    name: 'code_map',
    description: 'This project\'s code from its import and export statements, with its history: where an exported name is used, what a file holds and who imports it, ' +
      'how one file reaches another, what an area of files holds; with no arguments, the key files and areas. Approximate (names, no type check): ' +
      'exact references come from Serena or a language server. Answers in under 200 tokens. Not on every task.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string', description: 'An exported name (function, class, constant, type): which files use it' },
      file: { type: 'string', description: 'A code file: what it exports and who uses it, what it imports, its area' },
      from: { type: 'string', description: 'With to: how this file reaches the other one through imports' },
      to: { type: 'string', description: 'With from: the other file' },
      area: { type: 'string', description: 'An area name from the overview, or a folder' },
    } },
  },
];

// The code map: rebuilt at most every 10 s, and then only the files that changed are read again.
const mapper = codeMapper();
let map = null, mapAt = 0;
async function codeMapNow() {
  if (!map || Date.now() - mapAt > 10_000) { map = await mapper(ROOT); mapAt = Date.now(); }
  return map;
}
// One line of history for a file, or for two files ("a|b": whether they change together), from the aggregate.
async function historyOf(key) {
  const now = Date.now(), [a, b] = key.split('|');
  const repo = repoFor(ROOT, a), proj = await projectFor(repo);
  if (!proj) return '';
  const idOf = (p) => proj._fi.get(relPath(proj.root, path.resolve(ROOT, p)));
  const f = idOf(a);
  if (f === undefined) return '';
  if (b !== undefined) {
    // Either way round: a pattern can qualify from one file's side only (3 of 3 commits of one, 3 of 14 of the other).
    const g = idOf(b), x = g === undefined ? null : partners(proj, f, now).find((y) => y.f === g) || partners(proj, g, now).find((y) => y.f === f);
    return x ? `they usually change together (${[x.s && `${x.s.n} work episodes on ${x.s.days} days`, x.g && `git: ${x.g.n} of ${x.g.of} commits`].filter(Boolean).join('; ')})` : '';
  }
  const h = history(proj, f, now), parts = [];
  if (h.editEpisodes) parts.push(`edited in ${h.editEpisodes} work episode${h.editEpisodes === 1 ? '' : 's'} on ${h.editDays} day${h.editDays === 1 ? '' : 's'} (Claude Code)`);
  if (h.git.changes) parts.push(`git: ${h.git.changes} commit${h.git.changes === 1 ? '' : 's'}, ${h.git.fixes} labeled as fix${h.git.fixes === 1 ? '' : 'es'}`);
  return parts.join('; ');
}

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
  if (name === 'code_map') return answerCodeMap(await codeMapNow(), NAME, args || {}, historyOf);
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
