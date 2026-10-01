// Serves the brain prototype on a test port (127.0.0.1 only): node prototype/brain/serve.mjs [port]
// BRAIN_THREE=<folder> also serves a local three.js build at /vendor/three/ for the renderer benchmark.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const THREE = process.env.BRAIN_THREE ? path.resolve(process.env.BRAIN_THREE) : null;
const PORT = Number(process.argv[2]) || 4798;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const base = THREE && rel.startsWith('/vendor/three/') ? THREE : ROOT;
  if (base === THREE) rel = rel.slice('/vendor/three'.length);
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`brain prototype on http://127.0.0.1:${PORT}/`));
