// "View on phone": off by default. While it is on, a second listener on the PC's home-network address serves the
// dashboard read-only to devices holding the current token (the link's ?t=, then a cookie). It is turned on and off,
// and its link regenerated, only from this PC (the loopback server). Nothing leaves the home network: no tunnels.
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';

// Adapters that are not the home network: virtual switches, VPNs, containers.
const VIRTUAL = /vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|VMnet|vbox|virbr|veth|^br-|Loopback|Tailscale|ZeroTier|Hamachi|VPN|TAP|TUN|utun|WireGuard|^wg\d|Npcap|Bluetooth|Teredo|isatap/i;
const PREFERRED = /wi-?fi|wlan|wireless|^wl|^en\d|^eth\d|ethernet/i;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// The PC's addresses on the home network, best first: private IPv4 on Wi-Fi or Ethernet before anything else.
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || !PRIVATE.test(a.address) || VIRTUAL.test(name)) continue;
      out.push({ name, address: a.address, score: (PREFERRED.test(name) ? 2 : 0) + (a.address.startsWith('192.168.') ? 1 : 0) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export const COOKIE = 'kevmind_t';
const DAY = 24 * 60 * 60;
const newToken = () => crypto.randomBytes(18).toString('base64url'); // 144 bits
const same = (a, b) => { if (!a || !b) return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (req) => /(?:^|;\s*)kevmind_t=([^;]+)/.exec(req.headers.cookie || '')?.[1];

const DENIED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KevMind</title>
<body style="font:16px/1.5 system-ui,sans-serif;margin:0;padding:32px 24px;background:#1a1a22;color:#ececf4">
<h1 style="font-size:20px;margin:0 0 12px">KevMind</h1>
<p>This link is no longer valid. On your PC, open <b>View on phone</b> and scan the QR code again.</p>
<p lang="es" style="color:#b9b9c9">Este enlace ya no es válido. En tu PC, abre <b>Ver en el teléfono</b> y vuelve a escanear el código QR.</p></body>`;

// handle(req, res, shared): the dashboard's own request handler. onChange(): sharing state changed (on, off, a new
// link, a viewer came or went). host: the address to listen on (KEVMIND_SHARE_HOST, else the best LAN address).
export function makeShare({ port, handle, onChange = () => {}, host = process.env.KEVMIND_SHARE_HOST }) {
  let server = null, token = null, address = null, error = null;
  const viewers = new Set(); // the open live streams of shared devices
  const sockets = new Set();
  const changed = () => { try { onChange(); } catch { /* a listener's problem, not sharing's */ } };

  // Every request from the network: the token first, then read-only.
  function guard(req, res) {
    const url = new URL(req.url, 'http://x');
    const fromLink = url.searchParams.get('t');
    if (!((fromLink && same(fromLink, token)) || (cookieOf(req) && same(cookieOf(req), token)))) {
      const page = (req.headers.accept || '').includes('text/html');
      res.writeHead(401, { 'content-type': page ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store' });
      return res.end(page ? DENIED : JSON.stringify({ error: 'a valid link is needed' }));
    }
    if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/(api\/share|shutdown|events)\b/.test(url.pathname)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'read-only' }));
    }
    if (fromLink) { // the first visit: keep the token in a cookie and take it out of the address bar
      res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * DAY}`);
      if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        url.searchParams.delete('t');
        res.writeHead(302, { location: url.pathname + url.search });
        return res.end();
      }
    }
    handle(req, res, true);
  }

  const status = () => ({ on: !!server, url: server ? `http://${address}:${port}/?t=${token}` : null, address: server ? address : null, viewers: viewers.size, error });

  async function start() {
    if (server) return status();
    address = host || lanAddresses()[0]?.address || null;
    error = address ? null : 'no-network';
    if (!address) { changed(); return status(); }
    token = newToken();
    const s = http.createServer(guard);
    s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
    await new Promise((resolve) => {
      s.once('error', (e) => { error = e.code || e.message; resolve(); });
      s.listen(port, address, () => { server = s; resolve(); });
    });
    if (!server) token = null;
    changed();
    return status();
  }

  // Closing the listener and every open connection: a phone loses access at once, live stream included.
  function cut() { for (const sock of sockets) sock.destroy(); viewers.clear(); }
  function stop() {
    if (!server) return status();
    server.close();
    cut();
    server = null; token = null; error = null;
    changed();
    return status();
  }
  function regenerate() {
    if (!server) return status();
    token = newToken();
    cut();
    changed();
    return status();
  }
  function watching(res) { // a shared live stream opened
    viewers.add(res);
    changed();
    res.on('close', () => { if (viewers.delete(res)) changed(); });
  }
  return { status, start, stop, regenerate, watching };
}
