#!/usr/bin/env node
// KevMind hook: reads the JSON Claude Code sends on stdin and forwards it to the local server.
// Never blocks or breaks Claude Code: it always exits 0. When the server can't take the event
// (down, slow, error), the event is spooled to <KEVMIND_HOME>/spool.jsonl for the server's next start.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.KEVMIND_PORT) || 4777;
const TIMEOUT_MS = 400;
// Same default as DATA_DIR in src/server.js; kept inline so the hook loads nothing but built-ins.
const SPOOL_FILE = path.join(process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind'), 'spool.jsonl');
const ts = Date.now(); // the event's own time, so spooled events keep their place on the timeline

let raw = '';
let done = false;
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
  req.on('error', () => finish(false));
  req.end(raw);
});
setTimeout(() => finish(false), TIMEOUT_MS + 200).unref();

function finish(delivered) {
  if (done) return;
  done = true;
  if (!delivered) spool();
  process.exit(0);
}

// Stored as sent (unredacted); the server redacts it when it ingests the spool.
function spool() {
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }
  try {
    fs.mkdirSync(path.dirname(SPOOL_FILE), { recursive: true });
    fs.appendFileSync(SPOOL_FILE, JSON.stringify({ ts, e: payload }) + '\n');
  } catch { /* never block Claude Code */ }
}
