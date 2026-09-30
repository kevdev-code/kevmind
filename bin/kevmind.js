#!/usr/bin/env node
import { startServer } from '../src/server.js';

const [cmd = 'start', ...args] = process.argv.slice(2);
const port = Number(process.env.KEVMIND_PORT) || 4777;

const HELP = `
KevMind · watch Claude Code work in real time

  kevmind              Start the dashboard at http://localhost:${port}
  kevmind install      Add the hooks to ~/.claude/settings.json
  kevmind uninstall    Remove KevMind's hooks
  kevmind demo         Start the dashboard and simulate a sample session

  Env: KEVMIND_PORT (port, 4777), KEVMIND_HOME (data dir, ~/.kevmind)
`;

switch (cmd) {
  case 'start': {
    startServer({ port }).on('listening', () => {
      console.log(`\n  KevMind running at http://localhost:${port}\n  (Ctrl+C to quit)\n`);
    }).on('error', (e) => fail(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is KevMind already running?` : e.message));
    break;
  }
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

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}
