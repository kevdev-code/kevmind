#!/usr/bin/env node
// KevMind experience: a stdio MCP server (JSON-RPC, one message per line) that tells Claude what this project's
// history shows: past Claude Code sessions recorded by KevMind, and git. History only, no code parsing.
// It reads ~/.kevmind/experience.json, kept current by the dashboard, plus any log lines newer than that file,
// and never writes anything (test/experience-readonly.test.mjs). Off unless KEVMIND_EXPERIENCE is true, which the
// plugin sets from its "experience_tools" option. Logs go to stderr; stdout carries protocol messages only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyAggregate, revive, updateFromLogs, refreshGit, answerFileContext, answerFileHistory, answerKnownFailures } from '../src/experience.js';
import { projectRoot, keyOf } from '../src/memory.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
const ENABLED = /^(1|true|yes|on)$/i.test(process.env.KEVMIND_EXPERIENCE || '');
const DATA_DIR = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
const AGG_FILE = path.join(DATA_DIR, 'experience.json');
const ROOT = projectRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const KEY = keyOf(ROOT);
const NAME = path.basename(ROOT);
const REFRESH_MS = 2000;
const GIT_STALE_MS = 24 * 60 * 60_000;

const SERENA = 'For code structure (symbols, references, definitions) use Serena or other code tools if available; KevMind only reports history.';
const TOOLS = [
  {
    name: 'file_context',
    description: 'Call before editing files you have not worked on in this session: which files usually change or get read alongside them, ' +
      'from this project\'s past Claude Code sessions and git history, with counts and dates. Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'File paths, relative to the project or absolute' } }, required: ['paths'] },
  },
  {
    name: 'file_history',
    description: 'How often past sessions read and edited one file, by which agent types, and how often git changed or fixed it. ' +
      'Call when unsure whether a file is risky to touch. Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File path, relative to the project or absolute' } }, required: ['path'] },
  },
  {
    name: 'known_failures',
    description: 'Call after a command fails: whether this project saw the same failure before and what came before the next success. ' +
      'Not on every task. ' + SERENA,
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'The failing command, or its start such as "npm test"' } } },
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
  const proj = agg.projects[KEY];
  if (proj && (!proj.git || now - proj.git.at > GIT_STALE_MS)) await refreshGit(proj, now);
  if (!proj && fs.existsSync(path.join(ROOT, '.git'))) {
    // No KevMind session here yet: git alone can answer.
    agg.projects[KEY] = { root: ROOT, name: NAME, files: [], sessions: {}, fams: [], sigs: [], git: null };
    await refreshGit(revive(agg).projects[KEY], now);
  }
  return agg;
}

async function call(name, args = {}) {
  const proj = (await data()).projects[KEY] || null;
  const now = Date.now();
  if (name === 'file_context') return answerFileContext(proj, NAME, Array.isArray(args.paths) ? args.paths.map(String) : [], now);
  if (name === 'file_history') return answerFileHistory(proj, NAME, String(args.path || ''), now);
  if (name === 'known_failures') return answerKnownFailures(proj, NAME, args.command ? String(args.command) : '', now);
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
      if (!ENABLED) return { content: [{ type: 'text', text: 'KevMind experience tools are turned off (plugin option "experience_tools").' }], isError: true };
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
    handle(msg).then(
      (result) => { if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); },
      (e) => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); },
    );
  }
});
process.stdin.on('end', () => process.exit(0));
