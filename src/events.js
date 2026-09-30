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
];

// Events that accept a "matcher" (tool filter).
export const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
