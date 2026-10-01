#!/usr/bin/env node
// KevMind hook: reads the JSON Claude Code sends on stdin and forwards it to the local server.
// Never blocks or breaks Claude Code: it always exits 0. When the server can't take the event
// (down, slow, error), the event is masked and spooled to <KEVMIND_HOME>/spool.jsonl for the server's next start.
// On SessionStart, if nothing answers on the port, it also starts the server in the background (KEVMIND_AUTOSTART=0 opts out).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.KEVMIND_PORT) || 4777;
const TIMEOUT_MS = 400;
// Same default as DATA_DIR in src/server.js; kept inline so the hook loads nothing but built-ins.
const HOME = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
const SPOOL_FILE = path.join(HOME, 'spool.jsonl');
const ts = Date.now(); // the event's own time, so spooled events keep their place on the timeline

let raw = '';
let done = false;
let refused = false; // nothing listening on the port, as opposed to a slow or failing server
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  if (!raw.trim()) process.exit(0);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/events',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      res.resume();
      res.on('end', () => finish(res.statusCode >= 200 && res.statusCode < 300));
    }
  );
  req.on('timeout', () => { req.destroy(); finish(false); });
  req.on('error', (e) => { refused = e.code === 'ECONNREFUSED'; finish(false); });
  req.end(raw);
});
setTimeout(() => finish(false), TIMEOUT_MS + 200).unref();

function finish(delivered) {
  if (done) return;
  done = true;
  if (delivered) process.exit(0);
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* not JSON: nothing to keep */ }
  spool(payload)
    .then(() => (refused && payload?.hook_event_name === 'SessionStart' ? autostart() : null))
    .catch(() => {})
    .finally(() => process.exit(0));
}

// Masked before it touches disk. redact.js is loaded only on this path, so the normal path stays fast.
async function spool(payload) {
  if (!payload) return;
  try {
    const { redact } = await import('./redact.js');
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(SPOOL_FILE, JSON.stringify({ ts, e: redact(payload) }) + '\n');
  } catch { /* never block Claude Code */ }
}

// Starts `kevmind start` detached, with no window and output to server.log, then returns at once.
// The spooled event is ingested by that server when it comes up.
async function autostart() {
  if (process.env.KEVMIND_AUTOSTART === '0') return;
  const bin = binPath();
  if (!bin || !takeLock(path.join(HOME, 'autostart.lock'))) return;
  const { spawn } = await import('node:child_process');
  const out = fs.openSync(path.join(HOME, 'server.log'), 'a');
  spawn(process.execPath, [bin, 'start'], {
    detached: true, windowsHide: true, stdio: ['ignore', out, out],
    env: { ...process.env, KEVMIND_DETACHED: '1' },
  }).unref();
  fs.closeSync(out);
}

// The plugin ships bin/ next to hooks/; a copy made by `kevmind install` finds it through kevmind-bin.
function binPath() {
  const own = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kevmind.js');
  if (fs.existsSync(own)) return own;
  try {
    const p = fs.readFileSync(path.join(HOME, 'kevmind-bin'), 'utf8').trim();
    return fs.existsSync(p) ? p : null;
  } catch { return null; }
}

// When several sessions start at once (an app restart resumes them together), only one hook launches the server.
function takeLock(file) {
  const create = () => { fs.closeSync(fs.openSync(file, 'wx')); return true; };
  try { return create(); } catch (e) { if (e.code !== 'EEXIST') return false; }
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < 15_000) return false;
    fs.rmSync(file, { force: true });
    return create();
  } catch { return false; }
}
