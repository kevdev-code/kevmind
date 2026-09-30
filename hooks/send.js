#!/usr/bin/env node
// KevMind hook: lee el JSON que Claude Code manda por stdin y lo reenvía al servidor local.
// Nunca bloquea ni rompe a Claude Code: si el servidor no está corriendo, sale en silencio.
import http from 'node:http';

const PORT = Number(process.env.KEVMIND_PORT) || 4777;
const TIMEOUT_MS = 400;

let raw = '';
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
      res.on('end', () => process.exit(0));
    }
  );
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(raw);
});
setTimeout(() => process.exit(0), TIMEOUT_MS + 200).unref();
