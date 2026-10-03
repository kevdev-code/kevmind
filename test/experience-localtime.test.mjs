// "Distinct days" are local days: an evening that crosses midnight UTC is one day of work. Stored timestamps don't
// change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'America/Tijuana'; // UTC-7 in September; set before any Date is formatted
const { emptyAggregate, ingest, partners, gate } = await import('../src/experience.js');
const { keyOf } = await import('../src/memory.js');

test('local days: one evening across midnight UTC is one day', () => {
  assert.equal(new Date(Date.UTC(2026, 9, 1, 3)).getDate(), 30, 'TZ is honored on this platform');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-tz-')));
  const agg = emptyAggregate();
  // Sep 30, 15:00 to 23:00 Tijuana = Sep 30 22:00 UTC to Oct 1 06:00 UTC.
  const start = Date.UTC(2026, 8, 30, 22);
  for (let i = 0; i < 5; i++) {
    const ts = start + i * 2 * 3600_000;
    ingest(agg, { session_id: 'eve', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'go' }, ts);
    for (const f of ['a.ts', 'b.ts']) ingest(agg, { session_id: 'eve', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } }, ts + 1000);
  }
  const p = agg.projects[keyOf(root)];
  const now = start + 86_400_000;
  assert.deepEqual(gate(p, now), { episodes: 5, days: 1, commits: 0, gitOk: false }, 'one local day, although it spans two UTC days');
  assert.deepEqual(partners(p, p.files.indexOf('a.ts'), now), [], 'so a.ts and b.ts are not partners yet');
});
