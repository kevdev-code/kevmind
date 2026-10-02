#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, clearEvents, clearAll, isDemoEvent, projectMatcher, DATA_DIR, SERVER_LOG, PID_FILE } from '../src/server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const [cmd = 'start', ...args] = argv.filter((a) => !a.startsWith('--'));
const dev = flags.has('--dev') || process.env.KEVMIND_DEV === '1';
const background = flags.has('--background');
const port = Number(process.env.KEVMIND_PORT) || 4777;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELP = `
KevMind · watch Claude Code work in real time

  kevmind                      Start the dashboard at http://localhost:${port}
  kevmind start --background   Start it detached: it keeps running after this terminal closes
  kevmind stop                 Stop the running dashboard
  kevmind restart [--dev]      Stop it if running, then start it again the same way (--dev adds file watching)
  kevmind clear                Delete demo sessions from the stored events
  kevmind clear --project <n>  Delete one project's history (by folder name or path)
  kevmind clear --all          Delete all stored data (asks first; --yes skips the question)
  kevmind install [--force]    Add the hooks to ~/.claude/settings.json (refuses when the plugin is installed)
  kevmind uninstall            Remove KevMind's hooks
  kevmind demo                 Start the dashboard and simulate a sample session
  kevmind tools on|off|status  Turn the experience tools for Claude on or off, or show their state and its source
  kevmind share [on|off|status|new]  View the dashboard on your phone over your home Wi-Fi: a read-only link and QR
                               code (new: a new link; the old one stops working). Off by default.

  Flags: --dev (reload the page when public/ changes)  --background (detach; output in server.log)
  Dev:   npm run dev [-- --background]   Also restarts the server when src/ or bin/ change
  Env:   KEVMIND_PORT (port, 4777), KEVMIND_HOME (data dir, ~/.kevmind),
         KEVMIND_AUTOSTART=0 (don't let the hook start the server at session start)
`;

switch (cmd) {
  case 'start':
    await start({ dev, background });
    break;
  case 'stop':
    console.log((await stop()) ? '\n  ✓ KevMind stopped.\n' : '\n  KevMind is not running.\n');
    break;
  case 'restart': {
    // Same launch mode as before; --dev / --background add to it (e.g. to bring an auto-started server into dev mode).
    const was = await stop();
    const launch = was ? launchOf(was) : { dev, background };
    if (dev) launch.dev = true;
    if (background) launch.background = true;
    await start(launch);
    break;
  }
  case 'clear': {
    const all = flags.has('--all');
    // --project <name> or --project=<name>: one project's history, matched by folder name or path.
    const project = [...flags].find((f) => f.startsWith('--project='))?.slice(10) || (flags.has('--project') ? args[0] : null);
    if (flags.has('--project') && !project) fail('Usage: kevmind clear --project <name or path>');
    if (all && !flags.has('--yes') && !(await confirm(`\n  Delete ALL KevMind data in ${DATA_DIR}? [y/N] `))) {
      console.log('\n  Nothing deleted.\n');
      break;
    }
    const was = await stop();
    if (all) {
      clearAll();
      console.log(`\n  ✓ All data deleted from ${DATA_DIR}.\n`);
    } else if (project) {
      const isProject = projectMatcher(project);
      const n = clearEvents((e) => !isProject(e));
      console.log(n ? `\n  ✓ Removed ${n} event${n === 1 ? '' : 's'} of project ${project}.\n` : `\n  No events of project ${project}.\n`);
    } else {
      const n = clearEvents((e) => !isDemoEvent(e));
      console.log(`\n  ✓ Removed ${n} demo event${n === 1 ? '' : 's'}.\n`);
    }
    if (was) await start(launchOf(was));
    break;
  }
  case 'install': {
    const { install } = await import('../src/install.js');
    try {
      const r = install({ force: flags.has('--force') });
      console.log(`\n  ✓ Hooks installed in ${r.settings}\n  (backup at settings.json.kevmind-backup)\n\n  Now run "kevmind" and start a new Claude Code session.\n`);
    } catch (e) { fail(e.message); }
    break;
  }
  case 'uninstall': {
    const { uninstall } = await import('../src/install.js');
    try { uninstall(); console.log('\n  ✓ KevMind hooks removed.\n'); } catch (e) { fail(e.message); }
    break;
  }
  case 'demo': {
    const { runDemo } = await import('../src/demo.js');
    const server = startServer({ port, dev });
    server.on('error', (e) => fail(e.message));
    server.on('listening', async () => {
      console.log(`\n  KevMind (demo) at http://localhost:${port}\n  Simulating a session in 3 s...\n`);
      await sleep(3000);
      await runDemo(port, Number(args[0]) || 1);
      console.log('  ✓ Demo finished. The dashboard stays open (Ctrl+C to quit).');
    });
    break;
  }
  case 'tools': {
    // The experience tools for Claude: KevMind's own switch, in config.json. It wins over the plugin option.
    const { writeConfig, experienceTools, optionState, pluginOption, configFile } = await import('../src/config.js');
    const sub = args[0] || 'status';
    if (sub === 'on' || sub === 'off') writeConfig(DATA_DIR, { experienceTools: sub === 'on' });
    else if (sub !== 'status') fail('Usage: kevmind tools on | off | status');
    const option = pluginOption();
    const st = experienceTools(DATA_DIR, option);
    const from = { config: `config file (${configFile(DATA_DIR)})`, plugin: 'plugin option "experience_tools"', default: 'default (nothing set)' }[st.source];
    console.log(`\n  Experience tools: ${st.on ? 'on' : 'off'}\n  Source: ${from}`);
    if (st.source === 'config' && optionState(option) !== null) console.log(`  Plugin option: ${optionState(option) ? 'on' : 'off'} (the config file wins)`);
    console.log(`\n  Changes take effect in the next Claude Code session.\n`);
    break;
  }
  case 'share': {
    // "View on phone" (src/share.js): the running dashboard opens a read-only listener on the home network.
    const sub = args[0] || 'on';
    if (!['on', 'off', 'status', 'new'].includes(sub)) fail('Usage: kevmind share [on | off | status | new]');
    if (!(await isUp())) fail('KevMind is not running. Start it first: kevmind start --background');
    const call = (p, body) => fetch(`${base}${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then((r) => r.json());
    const st = sub === 'status' ? await call('/api/share') : sub === 'new' ? await call('/api/share/regenerate', {}) : await call('/api/share', { on: sub === 'on' });
    await printShare(st);
    break;
  }
  case '-h': case '--help': case 'help':
    console.log(HELP);
    break;
  default:
    console.log(HELP);
    process.exit(1);
}

async function printShare(st) {
  if (st.error) {
    const why = { 'no-network': 'No home network found (Wi-Fi or Ethernet with a private address).', EADDRINUSE: `Port ${port} is already in use on the network address.`, EADDRNOTAVAIL: 'That network address is not available.' }[st.error] || st.error;
    return console.log(`\n  ✗ Could not share: ${why}\n`);
  }
  if (!st.on) return console.log('\n  Sharing is off. The dashboard listens on 127.0.0.1 only.\n');
  console.log(`\n  Shared on your network (read-only)\n\n  ${st.url}\n\n${await terminalQr(st.url)}\n`);
  console.log(`  ${st.viewers} device${st.viewers === 1 ? '' : 's'} watching. Stop with: kevmind share off   New link: kevmind share new`);
  if (process.platform === 'win32') {
    console.log(`\n  Phone can't connect? When Windows asks, allow Node.js on Private networks only (never Public).
  If you dismissed that, run this in an administrator PowerShell:
    New-NetFirewallRule -DisplayName "KevMind (phone, private networks)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Private
  And make sure this Wi-Fi is set to Private (Settings > Network & internet > Wi-Fi > your network).`);
  }
  console.log('');
}

// The link as a QR code in the terminal: light modules in the text color, two rows per line (for dark terminals).
async function terminalQr(text) {
  const { default: qrcode } = await import('../public/vendor/qrcode.mjs');
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), light = (r, c) => !(r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c));
  const lines = [];
  for (let r = -2; r < n + 2; r += 2) {
    let line = '  ';
    for (let c = -2; c < n + 2; c++) { const t = light(r, c), b = light(r + 1, c); line += t && b ? '█' : t ? '▀' : b ? '▄' : ' '; }
    lines.push(line);
  }
  return lines.join('\n');
}

// What a server reported about its own launch (from /shutdown), as start() options.
function launchOf(info) {
  return { dev: !!info.dev, background: !!info.detached };
}

async function start({ dev, background }) {
  if (!background) {
    startServer({ port, dev }).on('listening', () => {
      console.log(`\n  KevMind running at http://localhost:${port}\n  (Ctrl+C to quit)\n`);
    }).on('error', (e) => fail(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is KevMind already running?` : e.message));
    return;
  }
  if (await isUp()) return console.log(`\n  KevMind is already running at http://localhost:${port}\n`);
  // Detached child: own console on Windows, output to server.log, and this process does not wait for it.
  // In dev mode the child is scripts/dev.js, which runs the server under Node's watcher.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = fs.openSync(SERVER_LOG, 'a');
  const script = dev ? [path.join(ROOT, 'scripts', 'dev.js')] : [path.join(ROOT, 'bin', 'kevmind.js'), 'start'];
  const child = spawn(process.execPath, script, {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, out],
    env: { ...process.env, KEVMIND_DETACHED: '1' },
  });
  child.unref();
  fs.closeSync(out);
  console.log((await waitUp())
    ? `\n  KevMind running in the background at http://localhost:${port}\n  log: ${SERVER_LOG}\n`
    : `\n  ✗ KevMind did not answer on port ${port}. See ${SERVER_LOG}\n`);
}

// Asks the running server to close and waits until its process is gone (or, for an older server
// that wrote no PID file, until the port is refused). Returns what the server said about its
// launch ({ dev, detached }), or null when nothing was listening.
// ponytail: a server too hung to answer /shutdown looks like "not running"; kill it by hand in that case.
async function stop() {
  const pid = readPid();
  let info;
  try {
    const r = await fetch(`${base}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null; // an older server without /shutdown answers 404
    info = await r.json().catch(() => ({}));
  } catch { return null; }
  for (let i = 0; i < 50 && (pid ? alive(pid) : await isUp()); i++) await sleep(100);
  return info;
}

function readPid() {
  try { return Number(fs.readFileSync(PID_FILE, 'utf8')) || null; } catch { return null; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// One fresh connection per probe: a keep-alive socket the closing server still holds would answer after the port is gone.
function isUp() {
  return new Promise((resolve) => {
    const req = http.get(`${base}/api/sessions`, { agent: false, timeout: 500 }, (res) => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(true); }); // slow, but something is there
    req.on('error', () => resolve(false));
  });
}

async function waitUp() {
  for (let i = 0; i < 30; i++) {
    if (await isUp()) return true;
    await sleep(100);
  }
  return false;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}
