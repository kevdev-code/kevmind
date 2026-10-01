// Monthly event logs: the old single events.jsonl is split by month once, and rewrites span every month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyLog, rewriteLogs, readSince, logWriter } from '../src/logs.js';
import { logFiles } from '../src/experience.js';

test('events.jsonl is split into events-YYYY-MM.jsonl and removed; rewrites cover every month', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-logs-'));
  const ev = (iso, sid) => JSON.stringify({ ts: Date.parse(iso), e: { session_id: sid, cwd: '/p', hook_event_name: 'Stop' } });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [ev('2026-08-31T23:00:00Z', 'a'), ev('2026-09-01T01:00:00Z', 'demo-1'), ev('2026-09-15T10:00:00Z', 'b'), 'corrupt'].join('\n') + '\n');
  assert.equal(migrateLegacyLog(dir), 3);
  assert.deepEqual(logFiles(dir), ['events-2026-08.jsonl', 'events-2026-09.jsonl']);
  assert.equal(fs.existsSync(path.join(dir, 'events.jsonl')), false);
  assert.equal(migrateLegacyLog(dir), 0, 'runs once');
  assert.equal(readSince(dir, Date.parse('2026-09-10T00:00:00Z')).length, 2, 'older months are skipped whole');

  assert.equal(rewriteLogs(dir, (e) => !e.session_id.startsWith('demo-')), 1);
  assert.equal(fs.readFileSync(path.join(dir, 'events-2026-09.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')), 'no temp files left behind');

  // An event from an earlier month (the spool) goes to that month's file.
  const w = logWriter(dir);
  w.write(Date.parse('2026-08-02T00:00:00Z'), ev('2026-08-02T00:00:00Z', 'late'));
  w.end();
  assert.equal(fs.readFileSync(path.join(dir, 'events-2026-08.jsonl'), 'utf8').trim().split('\n').length, 2);
});
