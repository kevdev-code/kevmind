// Minimal DevTools-protocol driver for Edge (Node's built-in WebSocket, no dependencies).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const EDGE = path.join('C:', path.sep, 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// gpu: 'hw' = the machine's GPU through ANGLE/D3D11, 'swiftshader' = WebGL rendered on the CPU (worst case).
export async function launch({ port = 9333, gpu = 'hw', width = 1440, height = 900, headless = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-brain-edge-'));
  const flags = gpu === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
  const proc = spawn(EDGE, [...(headless ? ['--headless=new'] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...flags, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(100); } }
  const browser = await Session.connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  return {
    proc, port, browser,
    async open(url) {
      const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
      const s = await Session.connect(t.webSocketDebuggerUrl);
      s.targetId = t.id;
      await s.send('Page.bringToFront');
      await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      return s;
    },
    close() { try { browser.ws.close(); } catch {} try { proc.kill(); } catch {} },
  };
}

export class Session {
  static connect(url) {
    const s = new Session();
    return new Promise((resolve, reject) => {
      s.ws = new WebSocket(url);
      s.ws.onopen = () => resolve(s);
      s.ws.onerror = reject;
      s.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && s.wait.has(msg.id)) { s.wait.get(msg.id)(msg); s.wait.delete(msg.id); }
        else if (msg.method) for (const fn of s.on.get(msg.method) || []) fn(msg.params);
      };
    });
  }
  constructor() { this.n = 0; this.wait = new Map(); this.on = new Map(); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.n;
      this.wait.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  listen(method, fn) { if (!this.on.has(method)) this.on.set(method, []); this.on.get(method).push(fn); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

// CPU seconds used so far by each Edge process type (browser, renderer, GPU), from SystemInfo.getProcessInfo.
export async function cpuTimes(browser) {
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  const by = {};
  for (const p of processInfo) by[p.type] = (by[p.type] || 0) + p.cpuTime;
  return { by, pids: Object.fromEntries(processInfo.map((p) => [p.type, p.id])) };
}
