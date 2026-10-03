// Benchmark only. Prints the file named by BENCH_CONTEXT_FILE as SessionStart context, the way hooks/brief.js hands
// Claude the briefing; prints nothing when it is unset or empty (the "without" arm). Always exits 0.
import fs from 'node:fs';

try {
  const file = process.env.BENCH_CONTEXT_FILE;
  const text = file ? fs.readFileSync(file, 'utf8').trim() : '';
  if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }));
} catch { /* no context */ }
process.exit(0);
