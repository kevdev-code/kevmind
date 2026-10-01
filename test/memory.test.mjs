// The memory scanner against a fixture with one of each problem type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProject, listProjects } from '../src/memory.js';
import { buildFixture, SECRET } from './memory-fixture.mjs';

const DAY = 86_400_000;

test('every problem type is found once, nothing secret leaks, and estimates are counted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-mem-'));
  const { home, root, memDir, git } = buildFixture(dir);
  const now = Date.now();
  const read = (f) => ({ ts: now - DAY, root, path: path.join(memDir, f) });
  const reads = { since: now - 10 * DAY, items: ['alpha.md', 'beta.md', 'orphan.md', 'big.md', 'dates-a.md'].map(read) };
  const loaded = [{ path: path.join(root, 'CLAUDE.md'), reason: 'session_start', type: 'Project' }];
  const r = await scanProject(root, { home, now, reads, loaded });

  const codes = (tier) => r.problems.filter((p) => p.tier === tier).map((p) => `${p.code} ${p.file}`).sort();
  assert.deepEqual(codes('problem'), [
    'broken_import CLAUDE.md',
    'broken_link .serena/memories/overview.md',
    `broken_link ~/.claude/projects/${path.basename(path.dirname(memDir))}/memory/alpha.md`,
    `index_missing_note ~/.claude/projects/${path.basename(path.dirname(memDir))}/memory/MEMORY.md`,
    `index_truncated ~/.claude/projects/${path.basename(path.dirname(memDir))}/memory/MEMORY.md`,
    `note_not_indexed ~/.claude/projects/${path.basename(path.dirname(memDir))}/memory/orphan.md`,
  ].sort());
  assert.deepEqual(codes('warning').map((c) => c.split(' ')[0]).sort(), ['cited_file_missing', 'instructions_oversized', 'note_large', 'worktree_copy']);
  assert.deepEqual(codes('suggestion').map((c) => c.split(' ')[0]).sort(), ['never_read', 'possible_overlap']);

  const missing = r.problems.find((p) => p.code === 'cited_file_missing');
  assert.equal(missing.params.cited, 'src/old.ts', 'src/app.ts exists, src/committed-only.ts is on the default branch');
  assert.deepEqual(missing.params.items, [{ path: 'src/old.ts', lines: [11], to: [] }], 'every flagged path, with the line it is cited on (8 frontmatter lines, a blank, then the body)');
  if (git) {
    const alpha = r.memory.notes.find((n) => n.stem === 'alpha');
    const c = alpha.cites.find((x) => x.path === 'src/committed-only.ts');
    assert.deepEqual([c.working, c.branch], [false, true]);
    assert.deepEqual(r.git.map((g) => g.ref), ['main']);
  }
  assert.equal(r.problems.find((p) => p.code === 'never_read').file.endsWith('dates-b.md'), true);
  assert.equal(r.problems.find((p) => p.code === 'broken_link' && p.file.endsWith('alpha.md')).params.link, '[[missing-note]]');
  assert.equal(r.problems.find((p) => p.code === 'broken_link' && p.file.endsWith('overview.md')).params.link, 'mem:missing-topic');

  // Every actionable row carries a specific English prompt that names the file.
  for (const p of r.problems.filter((x) => x.tier !== 'info')) assert.ok(p.fix && p.fix.includes(p.file.split('/').pop()), `fix prompt for ${p.code} names the file`);

  // Links resolve by frontmatter name or by filename; the worktree copy is noticed; the import is followed.
  const beta = r.memory.notes.find((n) => n.stem === 'beta');
  assert.deepEqual(beta.linksIn, [r.memory.notes.find((n) => n.stem === 'alpha').display]);
  assert.ok(r.instructions.some((i) => i.display === 'docs/extra.md' && i.scope === 'import' && i.load === 'startup'));
  assert.ok(r.instructions.find((i) => i.display === 'CLAUDE.md').observed);
  assert.equal(r.startup.observed, true);
  assert.equal(r.memory.index.truncated, true);
  assert.ok(r.memory.index.loadedTokens < r.memory.index.tokens, 'only the loaded part of MEMORY.md counts at startup');
  assert.deepEqual(r.serena.notes.map((n) => n.name).sort(), ['auth/login', 'overview']);

  assert.ok(!JSON.stringify(r).includes(SECRET), 'Serena auth_secret never reaches the report');
  assert.ok(!JSON.stringify(r).includes('Long history paragraph'), 'note bodies are not part of the report');
});

test('with little history, "never read" is not judged yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-mem-'));
  const { home, root } = buildFixture(dir);
  const now = Date.now();
  const r = await scanProject(root, { home, now, reads: { since: now - 2 * DAY, items: [] } });
  assert.ok(!r.problems.some((p) => p.code === 'never_read'));
  assert.deepEqual(r.problems.find((p) => p.code === 'reads_window').params, { days: 2, need: 7 });
  assert.equal(r.startup.observed, false, 'without InstructionsLoaded data the startup total is inferred');
});

test('projects seen in sessions come first, Serena-only projects after, and the secret is not read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-mem-'));
  const { home, root } = buildFixture(dir);
  const list = listProjects({ home, cwds: new Map([[path.join(root, 'src'), 2000]]) });
  assert.deepEqual(list.map((p) => [p.name, p.source]), [['Fixture', 'session'], ['OnlySerena', 'serena']]);
  assert.ok(!JSON.stringify(list).includes(SECRET));
});
