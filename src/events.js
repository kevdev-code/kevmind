// Claude Code hook events KevMind listens to.
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Notification',
  'PreCompact',
  'Stop',
  'SessionEnd',
  'InstructionsLoaded', // which CLAUDE.md and rule files actually loaded, and why (Memory tab)
];

// Run without Claude Code waiting on them. SessionStart may launch the dashboard, and a non-async hook
// would make Claude Code wait for that long-lived child process.
export const ASYNC_EVENTS = new Set(['SessionStart']);

// Events that accept a "matcher" (tool filter).
export const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
