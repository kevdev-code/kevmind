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

const gitIn = (dir) => {
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', windowsHide: true });
  return {
    init: () => run('-c', 'init.defaultBranch=main', 'init'),
    commitAll: (msg) => { run('add', '-A'); run('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', msg); },
  };
};

// A workspace with nested repositories: a root repository with backend/ and frontend/ as their own repositories (ignored by
// the root), a CLAUDE.md at the root that every one of them inherits, and memory notes for the root project.
// Each line of the root CLAUDE.md tests one rule; `expect` lists what must be flagged and where.
export function buildWorkspaceFixture(dir) {
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'Workspace');
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  write(path.join(home, '.claude', 'CLAUDE.md'), '# User\n');

  write(path.join(backend, 'src', 'app.ts'), 'export {};\n');
  write(path.join(backend, 'src', 'db', 'requestContext.ts'), 'export {};\n');
  write(path.join(frontend, 'src', 'api', 'types', 'order.types.ts'), 'export {};\n');
  write(path.join(frontend, 'src', 'data', 'shippingRules.ts'), 'export {};\n');
  write(path.join(frontend, 'src', 'lib', 'shortDate.ts'), 'export {};\n');
  write(path.join(frontend, 'CLAUDE.md'), '# Frontend\n\nHelpers live in `src/helpers/gone-helper.ts`.\n');
  write(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  write(path.join(root, '.gitignore'), 'backend/\nfrontend/\n');
  write(path.join(root, 'CLAUDE.md'), [
    '# Workspace',                                                                                  // 1
    '',                                                                                             // 2
    'Frontend types live in `api/types/order.types.ts` and `data/shippingRules.ts`.',          // 3: found under frontend/src
    'The API starts in `backend/src/app.ts`.',                                                      // 4: found in the backend repo
    'There is **no** `middleware/requestContext.ts`. Request context lives in `db/requestContext.ts`.', // 5: negated, then found
    'Old code in `backend/src/gone.ts` must be ported.',                                            // 6: MISSING
    'See [the guide](docs/guide.md) and [the old guide](docs/old-guide.md).',                      // 7: link found, link MISSING
    'El archivo `backend/src/legacy.ts` ya no existe.',                                             // 8: negated (Spanish)
    '',                                                                                             // 9
    "**Don't:**",                                                                                   // 10
    '- import from `src/legacy/old-api.ts`',                                                        // 11: in a Don't list
    '',                                                                                             // 12
    '## Conventions',                                                                               // 13
    '',                                                                                             // 14
    "| Do | Don't |",                                                                               // 15
    '|---|---|',                                                                                    // 16
    '| use `backend/src/app.ts` | edit `src/generated/schema.ts` |',                                // 17: Don't column
    '- ❌ never touch `src/old/thing.ts`',                                                         // 18: ❌ item
    '',                                                                                             // 19
    'Work happens on the backend branch `test/integration-harness`.',                              // 20: a branch, not a folder
    '',                                                                                             // 21
    '| Was written | Reality |',                                                                    // 22
    '|---|---|',                                                                                    // 23
    '| Service `drivers.service.ts` | `backend/src/app.ts` |',                                      // 24: stale column
    '| Key file `backend/src/middleware/requestContext.ts` | Does not exist |',                       // 25: negation elsewhere on the line
    '',                                                                                             // 26
    'Se borraron `.claude/worktrees/old-wt` y nada más.',                                           // 27: Spanish removal verb
    'Fixed in a1b2c3d on `test/old-branch`, then merged.',                                         // 28: a deleted branch in a known namespace
    'Scratch output went to `.claude/worktrees/gone-wt` that week.',                               // 29: MISSING folder, despite no git talk
  ].join('\n') + '\n');
  write(path.join(backend, 'test', 'app.test.ts'), 'export {};\n'); // makes "test" a known folder name
  write(path.join(root, '.claude', 'settings.local.json'), '{}\n');   // and ".claude", as in a real project

  if (hasGit()) {
    for (const repo of [backend, frontend]) { const g = gitIn(repo); g.init(); g.commitAll('init'); }
    execFileSync('git', ['branch', 'test/integration-harness'], { cwd: backend, stdio: 'ignore', windowsHide: true });
    const g = gitIn(root);
    g.init();
    g.commitAll('init');
  }

  // The root project's memory: a note citing a file that moved.
  const memDir = path.join(home, '.claude', 'projects', slugOf(root), 'memory');
  write(path.join(memDir, 'MEMORY.md'), '- [Dates](dates.md) — where date formatting lives\n');
  write(path.join(memDir, 'dates.md'), note('dates', 'Date formatting', [
    'Dates are formatted in `frontend/src/core/utils/shortDate.ts`.', // line 10: now at frontend/src/lib/shortDate.ts
    'Imported as `@/core/utils/shortDate`.',                          // line 11: extensionless, same file
  ].join('\n')));

  const projects = [{ root, name: 'Workspace' }, { root: backend, name: 'backend' }, { root: frontend, name: 'frontend' }];
  return { home, root, backend, frontend, memDir, projects, git: hasGit() };
}

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
  write(path.join(memDir, 'dates-a.md'), note('dates-server-utc', 'Server timezone UTC shifts delivery dates for Lisbon stores', 'Server side dates.'));
  write(path.join(memDir, 'dates-b.md'), note('dates-only-utc-shift', 'Date-only fields shift one day because of UTC timezone in Lisbon', 'Client side dates.'));

  // Serena: one project note with a broken mem: link, and a global config holding a secret KevMind must not keep.
  write(path.join(root, '.serena', 'memories', 'overview.md'), '# Overview\n\nSee mem:auth/login and mem:missing-topic.\n');
  write(path.join(root, '.serena', 'memories', 'auth', 'login.md'), '# Login\n\nHow login works.\n');
  write(path.join(home, '.serena', 'serena_config.yml'),
    `# Serena config\nauth_secret: ${SECRET}\nproject_serena_folder_location: $projectDir/.serena\nprojects:\n- ${root}\n- ${path.join(dir, 'OnlySerena')}\n`);

  return { home, root, memDir, git };
}
