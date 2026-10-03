// The benchmark's tasks: each one is a past KevMind fix. The run starts at the fix's parent commit; the prompt says
// what is wrong the way a user would, plus the contract the hidden test checks (names it uses), never the fix.
// Success: the fix commit's own tests (copied in after the run) pass, and so does the whole suite.
export const TASKS = [
  {
    id: 1,
    fix: '6eb8790',
    hidden: { files: ['test/experience.test.mjs'], tests: ['a shell syntax mistake in the command is not a known project failure, however often it repeats'] },
    prompt: `Known failures (the known_failures tool, the Experience panel in the Memory tab and the session briefing) list shell syntax mistakes as if the project were failing. For example a heredoc or a quote left open ("unexpected EOF while looking for matching \`''"), "syntax error near unexpected token \`('", or "nmp: command not found" after a typo. Those are mistakes in the command itself, not failures of the project, so none of the three should count them, however often they repeat. Real failures, such as a test that fails, must still count. Fix it, add a regression test, and run the tests at the end.`,
  },
  {
    id: 2,
    fix: '4b4a281',
    hidden: { files: ['test/alerts.test.mjs'], tests: ['conflict alerts keep only the newest 50 per session', 'every event gets an increasing sequence number, also after the event list is trimmed'] },
    prompt: `In a long session where two agents keep editing the same files, the conflict alerts of a session grow without limit, in the server's memory and in what the page receives. Keep only the newest 50 alerts per session; export the limit as \`MAX_ALERTS\` from src/state.js. Also give every event of a session an increasing sequence number in a \`seq\` field (the first event is 1), which keeps increasing after the event list is trimmed to its newest 300, so the page can key its rows by it. Add tests and run the tests at the end.`,
  },
  {
    id: 3,
    fix: '25a03bb',
    hidden: { files: ['test/transcript.test.mjs'], tests: ['the session title: a custom title wins over the latest prompt, redacted and short; the first prompt is kept'] },
    prompt: `Sessions in the dashboard need better names. Give each session (in what \`State.list()\` returns) a \`firstPrompt\`: the first real prompt the user typed, with whitespace collapsed (system messages such as "<task-notification>…" don't count). And a \`title\` read from the session's transcript by the tailer: \`null\` until the transcript has a title record; a "custom-title" record (customTitle) wins over "last-prompt" records (lastPrompt), even later ones; titles are redacted like everything else and capped at 80 characters. Add a test and run the tests at the end.`,
  },
  {
    id: 4,
    fix: '8243aef',
    hidden: { files: ['test/outcome.test.mjs'], tests: ['an event says what its call did: lines added and removed, a file created, files matched, a command ended', 'an outcome is measured before the payload is cut, and not counted short after', '"needs your OK" ends when the call that asked runs, not at the next call'] },
    prompt: `Two things in src/state.js.

1. An event should say what its tool call did, written on the event when the call ends (PostToolUse), as numbers and paths, never content: for an edit, \`add\` and \`del\` (lines added and removed, from the patch Claude Code reports, context lines not counted); for a new file, \`created: true\` with its lines as \`add\`; for a search (Grep, Glob), \`found\` (how many files matched) and \`hits\` (the matched paths, relative to the session's folder; for Grep in content mode, the paths its lines start with), with only the newest searches keeping their \`hits\` so the summary stays small, and a search's \`dir\` (the folder it searched, relative); for a command, \`ms\` (how long it ran). Nothing is known before the call ends, and a failed call gets no outcome. Export \`outcomeOf(event, cut)\` returning \`{ add, del }\` or similar, or null when there is nothing to count; the outcome must be measured before the payload is redacted and cut, and when \`cut\` is true and the patch looks truncated (a list cut at 50 entries) it returns null instead of a short count.
2. "Needs your OK" (status 'waiting' after a permission prompt) ends when the call that asked for permission runs, not when some other call ends.

Add tests and run the tests at the end.`,
  },
];
