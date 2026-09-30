#!/usr/bin/env node
import { startServer } from '../src/server.js';

const argv = process.argv.slice(2);
if (argv.includes('--dev')) process.env.KEVMIND_DEV = '1';
const [cmd = 'start', ...args] = argv.filter((a) => a !== '--dev');
const port = Number(process.env.KEVMIND_PORT) || 4777;
const base = `http://127.0.0.1:${port}`;

const HELP = `
KevMind · watch Claude Code work in real time

  kevmind              Start the dashboard at http://localhost:${port}
  kevmind stop         Stop the running dashboard
  kevmind restart      Stop it if running, then start it again
  kevmind install      Add the hooks to ~/.claude/settings.json
  kevmind uninstall    Remove KevMind's hooks
  kevmind demo         Start the dashboard and simulate a sample session

  Dev:  npm run dev    Restart on src/ changes; the open page reloads by itself
  Env:  KEVMIND_PORT (port, 4777), KEVMIND_HOME (data dir, ~/.kevmind),
        KEVMIND_DEV (1 = reload the page when public/ changes)
`;

switch (cmd) {
  case 'start':
    start();
    break;
  case 'stop':
    console.log((await stop()) ? '\n  ✓ KevMind stopped.\n' : '\n  KevMind is not running.\n');
    break;
  case 'restart':
    await stop();
    start();
    break;
  case 'install': {
    const { install } = await import('../src/install.js');
    try {
      const r = install();
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
    const server = startServer({ port });
    server.on('error', (e) => fail(e.message));
    server.on('listening', async () => {
      console.log(`\n  KevMind (demo) at http://localhost:${port}\n  Simulating a session in 3 s...\n`);
      await new Promise((r) => setTimeout(r, 3000));
      await runDemo(port, Number(args[0]) || 1);
      console.log('  ✓ Demo finished. The dashboard stays open (Ctrl+C to quit).');
    });
    break;
  }
  case '-h': case '--help': case 'help':
    console.log(HELP);
    break;
  default:
    console.log(HELP);
    process.exit(1);
}

function start() {
  startServer({ port }).on('listening', () => {
    console.log(`\n  KevMind running at http://localhost:${port}\n  (Ctrl+C to quit)\n`);
  }).on('error', (e) => fail(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is KevMind already running?` : e.message));
}

// Asks the running server to close, then waits until the port is free. False when nothing was listening.
// ponytail: a server too hung to answer /shutdown looks like "not running"; kill it by hand in that case.
async function stop() {
  try {
    const r = await fetch(`${base}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false; // an older server without /shutdown answers 404
  } catch { return false; }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(500) }); } catch { return true; }
  }
  return true;
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}
