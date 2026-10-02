// "View on phone": off means the dashboard listens on 127.0.0.1 only; a shared device needs the link's token; a new
// link revokes the old one (open streams included); a shared device can only read. The network listener binds to
// 127.0.0.2 here (KEVMIND_SHARE_HOST), so the test never opens a port on the real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from '../src/share.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'kevmind.js');
const SHARE_HOST = '127.0.0.2';

function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('picks the home network adapter and skips virtual ones', () => {
  const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal });
  const ifaces = {
    'vEthernet (WSL)': [v4('172.20.0.1')],
    'vEthernet (Default Switch)': [v4('172.28.48.1')],
    'Ethernet 2': [v4('10.0.0.7')],
    'Wi-Fi': [{ family: 'IPv6', address: 'fe80::1', internal: false }, v4('192.168.1.23')],
    Tailscale: [v4('100.101.1.2')],
    'Bluetooth Network Connection': [v4('169.254.3.4')],
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    'docker0': [v4('172.17.0.1')],
  };
  const found = lanAddresses(ifaces);
  assert.equal(found[0].address, '192.168.1.23', 'Wi-Fi first');
  assert.deepEqual(found.map((a) => a.name), ['Wi-Fi', 'Ethernet 2']);
  assert.deepEqual(lanAddresses({ 'vEthernet (WSL)': [v4('172.20.0.1')] }), [], 'nothing to share on');
});

test('sharing: off by default, a token to get in, a new link revokes the old, read-only, off closes it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-share-'));
  const port = 47000 + Math.floor(Math.random() * 900);
  const env = { ...process.env, KEVMIND_HOME: home, KEVMIND_PORT: String(port), KEVMIND_SHARE_HOST: SHARE_HOST, KEVMIND_AUTOSTART: '0' };
  const child = spawn(process.execPath, [BIN, 'start'], { env, stdio: 'ignore', windowsHide: true });
  const local = `http://127.0.0.1:${port}`, shared = `http://${SHARE_HOST}:${port}`;
  const post = (p, body, headers = {}) => req(`${local}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 50; i++) { try { await req(`${local}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

    // Off: nothing listens beyond 127.0.0.1, not on the share address and not on the real network.
    assert.equal(JSON.parse((await req(`${local}/api/health`)).body).share.on, false);
    await assert.rejects(req(`${shared}/api/health`), /ECONNREFUSED/);
    const lan = lanAddresses()[0];
    if (lan) await assert.rejects(req(`http://${lan.address}:${port}/api/health`), /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/);
    assert.match(execFileSync(process.execPath, [BIN, 'share', 'status'], { env, encoding: 'utf8' }), /Sharing is off\. The dashboard listens on 127\.0\.0\.1 only\./);

    // Only this PC's own page or the CLI turns it on: another web page can't, not even one rebound to 127.0.0.1.
    assert.equal((await post('/api/share', { on: true }, { origin: 'http://evil.example' })).status, 403);
    const rebound = { host: `evil.example:${port}` };
    assert.equal((await post('/api/share', { on: true }, { ...rebound, origin: `http://evil.example:${port}` })).status, 403);
    assert.equal((await req(`${local}/api/health`, { headers: rebound })).status, 403);
    assert.equal((await req(`${local}/api/health`, { headers: { host: `localhost:${port}` } })).status, 200);
    const cli = execFileSync(process.execPath, [BIN, 'share', 'on'], { env, encoding: 'utf8' });
    assert.match(cli, new RegExp(`Shared on your network \\(read-only\\)\\n\\n {2}http://127\\.0\\.0\\.2:${port}/\\?t=`));
    assert.match(cli, /[█▀▄]{20}/, 'the QR code in the terminal');
    const on = JSON.parse((await req(`${local}/api/share`)).body);
    assert.equal(on.on, true);
    const token = new URL(on.url).searchParams.get('t');
    assert.ok(token.length >= 24);

    // Without the token: 401, as a page and as data; a wrong cookie too.
    const page = await req(`${shared}/`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 401);
    assert.match(page.body, /no longer valid/);
    assert.equal((await req(`${shared}/api/sessions`)).status, 401);
    assert.equal((await req(`${shared}/api/sessions`, { headers: { cookie: 'kevmind_t=nope' } })).status, 401);

    // The link: a cookie, and the token leaves the address bar.
    const first = await req(`${shared}/?t=${token}`, { headers: { accept: 'text/html' } });
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/');
    assert.match(first.headers['set-cookie'][0], new RegExp(`^kevmind_t=${token}; Path=/; HttpOnly; SameSite=Strict`));
    const cookie = `kevmind_t=${token}`;
    assert.equal((await req(`${shared}/`, { headers: { cookie } })).status, 200);
    const health = JSON.parse((await req(`${shared}/api/health`, { headers: { cookie } })).body);
    assert.equal(health.shared, true);
    assert.equal(health.share, undefined, 'a shared device never sees the link');

    // Read-only: nothing that changes anything.
    for (const [method, p] of [['POST', '/api/tools'], ['POST', '/api/share'], ['POST', '/api/share/regenerate'], ['POST', '/events'], ['POST', '/shutdown'], ['GET', '/api/share']]) {
      const r = await req(`${shared}${p}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: '{"on":true}' });
      assert.equal(r.status, 403, `${method} ${p} is refused`);
    }

    // A new link: the old token stops working at once, the open live stream included.
    const stream = new Promise((resolve) => {
      http.get(`${shared}/stream`, { headers: { cookie }, agent: false }, (res) => { res.once('data', () => resolve(res)); });
    });
    const open = await stream;
    const closed = new Promise((resolve) => { open.on('close', resolve); open.on('end', resolve); open.resume(); });
    assert.equal(JSON.parse((await req(`${local}/api/share`)).body).viewers, 1);
    const fresh = JSON.parse((await post('/api/share/regenerate', {})).body);
    await closed;
    const token2 = new URL(fresh.url).searchParams.get('t');
    assert.notEqual(token2, token);
    assert.equal((await req(`${shared}/api/sessions`, { headers: { cookie } })).status, 401);
    assert.equal((await req(`${shared}/api/sessions`, { headers: { cookie: `kevmind_t=${token2}` } })).status, 200);

    // Off: the network listener is gone.
    assert.equal(JSON.parse((await post('/api/share', { on: false })).body).on, false);
    await assert.rejects(req(`${shared}/api/health`), /ECONNREFUSED/);
  } finally {
    child.kill();
  }
});
