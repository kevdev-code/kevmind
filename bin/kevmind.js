#!/usr/bin/env node
import { startServer } from '../src/server.js';

const [cmd = 'start', ...args] = process.argv.slice(2);
const port = Number(process.env.KEVMIND_PORT) || 4777;

const HELP = `
KevMind · mira en vivo cómo trabaja Claude Code

  kevmind              Inicia el panel en http://localhost:${port}
  kevmind install      Agrega los hooks a ~/.claude/settings.json
  kevmind uninstall    Quita los hooks de KevMind
  kevmind demo         Inicia el panel y simula una sesión de prueba

  Variables: KEVMIND_PORT (puerto, 4777), KEVMIND_HOME (datos, ~/.kevmind)
`;

switch (cmd) {
  case 'start': {
    startServer({ port }).on('listening', () => {
      console.log(`\n  KevMind corriendo en http://localhost:${port}\n  (Ctrl+C para salir)\n`);
    }).on('error', (e) => fail(e.code === 'EADDRINUSE' ? `El puerto ${port} ya está en uso. ¿KevMind ya está abierto?` : e.message));
    break;
  }
  case 'install': {
    const { install } = await import('../src/install.js');
    try {
      const r = install();
      console.log(`\n  ✓ Hooks instalados en ${r.settings}\n  (respaldo en settings.json.kevmind-backup)\n\n  Ahora corre "kevmind" y abre una sesión nueva de Claude Code.\n`);
    } catch (e) { fail(e.message); }
    break;
  }
  case 'uninstall': {
    const { uninstall } = await import('../src/install.js');
    try { uninstall(); console.log('\n  ✓ Hooks de KevMind eliminados.\n'); } catch (e) { fail(e.message); }
    break;
  }
  case 'demo': {
    const { runDemo } = await import('../src/demo.js');
    const server = startServer({ port });
    server.on('error', (e) => fail(e.message));
    server.on('listening', async () => {
      console.log(`\n  KevMind (demo) en http://localhost:${port}\n  Simulando una sesión en 3 s...\n`);
      await new Promise((r) => setTimeout(r, 3000));
      await runDemo(port, Number(args[0]) || 1);
      console.log('  ✓ Demo terminada. El panel sigue abierto (Ctrl+C para salir).');
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
