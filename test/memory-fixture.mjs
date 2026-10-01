// Builds a fake home and project in which every memory problem KevMind detects appears exactly once.
// Used by test/memory.test.mjs and handy for trying the Memory tab against a temp KEVMIND_HOME.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slugOf } from '../src/memory.js';

export const SECRET = 'fixture-auth-secret-0123456789';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const note = (name, description, body, type = 'project') =>
  `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  node_type: memory\n  type: ${type}\n  modified: 2026-09-01T10:00:00.000Z\n---\n\n${body}\n`;

export function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; }
}

export function buildFixture(dir) {
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'Fixture');
  const memDir = path.join(home, '.claude', 'projects', slugOf(root), 'memory');

  write(path.join(home, '.claude', 'CLAUDE.md'), '# User instructions\n\nAnswer in English.\n');

  // Project: an oversized CLAUDE.md with one working and one broken import, and a worktree copy of it.
  const filler = Array.from({ length: 220 }, (_, i) => `- Rule number ${i + 1} explains a convention that every session needs to follow.`).join('\n');
  const claude = `# Fixture\n\nMore context in @docs/extra.md and in @docs/missing.md.\n\n${filler}\n`;
  write(path.join(root, 'CLAUDE.md'), claude);
  write(path.join(root, 'docs', 'extra.md'), '# Extra\n\nImported from CLAUDE.md.\n');
  write(path.join(root, '.claude', 'worktrees', 'wt1', 'CLAUDE.md'), claude);
  write(path.join(root, 'src', 'app.ts'), 'export const app = 1;\n');
  write(path.join(root, 'src', 'committed-only.ts'), 'export const gone = 1;\n');

  // src/committed-only.ts stays on main but is deleted on the checked-out branch: not missing, only elsewhere.
  const git = hasGit();
  if (git) {
    const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
    const commit = (msg) => run('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', msg);
    run('-c', 'init.defaultBranch=main', 'init');
    run('add', '-A');
    commit('fixture');
    run('checkout', '-b', 'feature');
    run('rm', '-q', 'src/committed-only.ts');
    commit('drop committed-only');
  } else {
    fs.rmSync(path.join(root, 'src', 'committed-only.ts'));
  }

  // Auto memory.
  const index = [
    '- [Alpha](alpha.md) — the main note',
    '- [Beta](beta.md) — linked from alpha',
    '- [Ghost](ghost.md) — this note was deleted',
    '- [Big](big.md) — a very long note',
    '- [Server dates](dates-a.md) — timezone bug on the server',
    '- [Date shift](dates-b.md) — timezone bug in date-only fields',
    ...Array.from({ length: 200 }, (_, i) => `- Fact ${i + 1} that belongs in a topic note instead.`),
  ].join('\n');
  write(path.join(memDir, 'MEMORY.md'), index + '\n');
  write(path.join(memDir, 'alpha.md'), note('alpha', 'Main fixture note', [
    'Links to [[beta-note]] and to [[missing-note]].',
    'The code lives in `src/app.ts`, used to live in `src/old.ts`, and `src/committed-only.ts` is still on main.',
    '',
    '**Why:** fixture.',
    '**How to apply:** fixture.',
  ].join('\n')));
  write(path.join(memDir, 'beta.md'), note('beta-note', 'Second fixture note', 'Back to [[alpha]].\n\n## Details\n\nNothing else.'));
  write(path.join(memDir, 'orphan.md'), note('orphan', 'A note nobody listed in MEMORY.md', 'Orphan body.'));
  write(path.join(memDir, 'big.md'), note('big', 'A very long note', 'Long history paragraph. '.repeat(1000)));
  write(path.join(memDir, 'dates-a.md'), note('dates-server-utc', 'Server timezone UTC shifts appointment dates for Mexico clinics', 'Server side dates.'));
  write(path.join(memDir, 'dates-b.md'), note('dates-only-utc-shift', 'Date-only fields shift one day because of UTC timezone in Mexico', 'Client side dates.'));

  // Serena: one project note with a broken mem: link, and a global config holding a secret KevMind must not keep.
  write(path.join(root, '.serena', 'memories', 'overview.md'), '# Overview\n\nSee mem:auth/login and mem:missing-topic.\n');
  write(path.join(root, '.serena', 'memories', 'auth', 'login.md'), '# Login\n\nHow login works.\n');
  write(path.join(home, '.serena', 'serena_config.yml'),
    `# Serena config\nauth_secret: ${SECRET}\nproject_serena_folder_location: $projectDir/.serena\nprojects:\n- ${root}\n- ${path.join(dir, 'OnlySerena')}\n`);

  return { home, root, memDir, git };
}
