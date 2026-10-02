#!/usr/bin/env node
// KevMind's session briefing hook (SessionStart: startup, clear, compact). Asks the local dashboard for a short note
// about the project and hands it to Claude Code as additionalContext. Off unless `kevmind briefing on`. Claude's first
// reply waits for this hook, so it gives up after 1.5 s and says nothing; whatever happens it exits 0, and with the
// dashboard down it returns at once (the other SessionStart hook starts the dashboard).
import http from 'node:http';

const PORT = Number(process.env.KEVMIND_PORT) || 4777;
const TIMEOUT_MS = 1500;

let raw = '', done = false;
const finish = (text) => {
  if (done) return;
  done = true;
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
  process.exit(0);
};
setTimeout(() => finish(''), TIMEOUT_MS + 300).unref();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let p;
  try { p = JSON.parse(raw); } catch { return finish(''); }
  const body = JSON.stringify({ session_id: p.session_id, cwd: p.cwd, source: p.source, transcript_path: p.transcript_path });
  const req = http.request({
    host: '127.0.0.1', port: PORT, path: '/api/briefing', method: 'POST', timeout: TIMEOUT_MS,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (res) => {
    let out = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { out += c; });
    res.on('end', () => { try { finish(res.statusCode === 200 ? String(JSON.parse(out).text || '') : ''); } catch { finish(''); } });
  });
  req.on('timeout', () => { req.destroy(); finish(''); });
  req.on('error', () => finish(''));
  req.end(body);
});
