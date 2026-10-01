// KevMind's event log, one file per month: events-YYYY-MM.jsonl. Writing side (the server and `kevmind clear`).
import fs from 'node:fs';
import path from 'node:path';
import { logFiles } from './experience.js';

export const monthOf = (ts) => new Date(ts).toISOString().slice(0, 7);
export const logPath = (dataDir, ts) => path.join(dataDir, `events-${monthOf(ts)}.jsonl`);

// The single events.jsonl of earlier versions is split into monthly files once, then removed.
// Each month file is written to a temp name and renamed, so an interrupted migration leaves the original intact.
export function migrateLegacyLog(dataDir) {
  const legacy = path.join(dataDir, 'events.jsonl');
  if (!fs.existsSync(legacy)) return 0;
  const byMonth = new Map();
  let n = 0;
  for (const line of fs.readFileSync(legacy, 'utf8').split('\n')) {
    if (!line) continue;
    let ts;
    try { ts = JSON.parse(line).ts; } catch { continue; }
    const m = monthOf(ts);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(line);
    n++;
  }
  for (const [m, lines] of byMonth) {
    const target = path.join(dataDir, `events-${m}.jsonl`);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    atomicWrite(target, lines.join('\n') + '\n' + existing);
  }
  fs.rmSync(legacy, { force: true });
  return n;
}

// Appends events, switching files when the month changes. Events with an older timestamp (from the spool)
// go to their own month's file.
export function logWriter(dataDir) {
  let month = null;
  let stream = null;
  return {
    write(ts, line) {
      const m = monthOf(ts);
      if (m !== monthOf(Date.now()) && m !== month) { fs.appendFileSync(logPath(dataDir, ts), line + '\n'); return; }
      if (m !== month) { stream?.end(); stream = fs.createWriteStream(logPath(dataDir, ts), { flags: 'a' }); month = m; }
      stream.write(line + '\n');
    },
    end() { stream?.end(); stream = null; month = null; },
  };
}

// Lines of the logs whose timestamp is at or after `since`, oldest file first.
export function readSince(dataDir, since) {
  const out = [];
  for (const name of logFiles(dataDir)) {
    const m = /^events-(\d{4}-\d{2})\.jsonl$/.exec(name);
    if (m && m[1] < monthOf(since)) continue;
    for (const line of fs.readFileSync(path.join(dataDir, name), 'utf8').split('\n')) if (line) out.push(line);
  }
  return out;
}

// Rewrites every log keeping only the events that pass `keep`. Returns how many were dropped.
export function rewriteLogs(dataDir, keep) {
  let dropped = 0;
  for (const name of logFiles(dataDir)) {
    const file = path.join(dataDir, name);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const kept = lines.filter((l) => { try { return keep(JSON.parse(l).e); } catch { return false; } });
    dropped += lines.length - kept.length;
    if (kept.length !== lines.length) atomicWrite(file, kept.map((l) => l + '\n').join(''));
  }
  return dropped;
}

export function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
