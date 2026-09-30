// Lista de eventos de Claude Code que KevMind escucha.
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

// Eventos que aceptan "matcher" (filtro por herramienta).
export const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
