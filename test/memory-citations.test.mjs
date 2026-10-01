// Cited paths in a workspace of nested repositories: resolved from the citing file, negations and "Don't"
// sections skipped, moved files reported as suggestions, and a shared parent CLAUDE.md reported once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/memory.js';
import { buildWorkspaceFixture, hasGit } from './memory-fixture.mjs';

const fixture = () => buildWorkspaceFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-ws-')));
const git = hasGit();

test('the root CLAUDE.md flags only the two truly missing paths, with their lines', { skip: !git && 'needs git' }, async () => {
  const { home, root, projects } = fixture();
  const r = await scanProject(root, { home, projects });
  const missing = r.problems.filter((p) => p.code === 'cited_file_missing');
  assert.deepEqual(missing.map((p) => p.file), ['CLAUDE.md'], 'only the root CLAUDE.md has missing paths');
  assert.deepEqual(missing[0].params.items, [
    { path: 'backend/src/gone.ts', lines: [6], to: [] },
    { path: 'docs/old-guide.md', lines: [7], to: [] },
    { path: '.claude/worktrees/gone-wt', lines: [29], to: [] },
  ]);
  assert.match(missing[0].fix, /backend\/src\/gone\.ts \(line 6\)/);
  assert.match(missing[0].fix, /docs\/old-guide\.md \(line 7\)/);

  const cited = r.instructions.find((i) => i.display === 'CLAUDE.md').cites.map((c) => c.path).sort();
  for (const p of ['service/types/user.types.ts', 'data/rolePermissions.ts', 'backend/src/app.ts', 'db/tenantContext.ts', 'docs/guide.md']) {
    assert.ok(cited.includes(p), `${p} is cited and found`);
  }
  for (const p of ['middleware/tenantContext.ts', 'backend/src/legacy.ts', 'src/legacy/old-api.ts', 'src/generated/schema.ts', 'src/old/thing.ts',
    'test/integration-harness', 'doctors.service.ts', 'backend/src/middleware/tenantContext.ts', '.claude/worktrees/old-wt']) {
    assert.ok(!cited.includes(p), `${p} is skipped (negation, Don't list or column, stale column, ❌ item, or a branch name)`);
  }
});

test('a file that moved is a low-confidence suggestion with its new location, not a warning', { skip: !git && 'needs git' }, async () => {
  const { home, root, projects } = fixture();
  const r = await scanProject(root, { home, projects });
  const moved = r.problems.filter((p) => p.code === 'possibly_moved');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].tier, 'suggestion');
  assert.ok(moved[0].file.endsWith('dates.md'));
  assert.deepEqual(moved[0].params.items, [
    { path: 'frontend/src/core/utils/formatDate.ts', lines: [10], to: ['frontend/src/lib/formatDate.ts'] },
    { path: '@/core/utils/formatDate', lines: [11], to: ['frontend/src/lib/formatDate.ts'] },
  ]);
  assert.ok(!r.problems.some((p) => p.code === 'cited_file_missing' && p.file.endsWith('dates.md')));
});

test('a shared parent CLAUDE.md is reported once, where it lives; child projects only say they inherit it', { skip: !git && 'needs git' }, async () => {
  const { home, root, backend, frontend, projects } = fixture();
  const b = await scanProject(backend, { home, projects });
  assert.ok(!b.problems.some((p) => p.tier !== 'info'), `backend has no problems of its own: ${JSON.stringify(b.problems.map((p) => p.code))}`);
  const inherits = b.problems.filter((p) => p.code === 'inherits');
  assert.equal(inherits.length, 1);
  assert.equal(inherits[0].params.project, 'Workspace');
  assert.ok(inherits[0].file.endsWith('Workspace/CLAUDE.md'));
  assert.ok(b.startup.parts.find((x) => x.label === 'project').tokens > 0, 'the inherited file still counts toward what loads');

  // frontend/CLAUDE.md belongs to the frontend project: its missing path is reported there, and only there.
  const f = await scanProject(frontend, { home, projects });
  assert.deepEqual(f.problems.filter((p) => p.code === 'cited_file_missing').map((p) => [p.file, p.params.items.map((i) => i.path)]), [['CLAUDE.md', ['src/helpers/gone-helper.ts']]]);
  const w = await scanProject(root, { home, projects });
  assert.ok(!w.problems.some((p) => p.code === 'cited_file_missing' && p.file.includes('frontend')));
  assert.deepEqual(w.problems.filter((p) => p.code === 'nested_project').map((p) => [p.file, p.params.project]), [['frontend/CLAUDE.md', 'frontend']]);
});
