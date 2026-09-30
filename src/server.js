// Servidor local: recibe eventos de los hooks, los guarda y los manda en vivo al navegador (SSE).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { State } from './state.js';
import { redact } from './redact.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const DATA_DIR = process.env.KEVMIND_HOME || path.join(os.homedir(), '.kevmind');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
const REPLAY_MS = 24 * 60 * 60 * 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function startServer({ port = 4777, host = '127.0.0.1' } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const state = new State();
  replay(state);

  const clients = new Set();
  const log = fs.createWriteStream(LOG_FILE, { flags: 'a' });

  function broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/events') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
      req.on('end', () => {
        res.writeHead(204).end();
        let payload;
        try { payload = JSON.parse(body); } catch { return; }
        const clean = redact(payload);
        const ts = Date.now();
        log.write(JSON.stringify({ ts, e: clean }) + '\n');
        const s = state.apply(clean, ts);
        if (s) broadcast({ type: 'session', session: state.summary(s), sessions: state.list() });
      });
      return;
    }

    if (url.pathname === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', sessions: state.list() })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (url.pathname === '/api/sessions') return json(res, state.list());

    if (url.pathname.startsWith('/api/sessions/')) {
      const s = state.sessions.get(decodeURIComponent(url.pathname.slice('/api/sessions/'.length)));
      return s ? json(res, state.summary(s)) : json(res, { error: 'no existe' }, 404);
    }

    // Archivos estáticos del panel
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('No encontrado');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
    });
  });

  server.listen(port, host);
  return server;
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
}

// Reconstruye el estado con los eventos de las últimas 24 h al arrancar.
function replay(state) {
  if (!fs.existsSync(LOG_FILE)) return;
  const since = Date.now() - REPLAY_MS;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const { ts, e } = JSON.parse(line);
      if (ts >= since) state.apply(e, ts);
    } catch { /* línea corrupta: se ignora */ }
  }
}
