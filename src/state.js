// Turns raw hook payloads into a model: sessions → agents → actions.
// Events are stored as language-neutral codes; the UI translates them.

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const MAX_EVENTS = 300;
const CONFLICT_WINDOW_MS = 5 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
// Claude Code injects its own messages through UserPromptSubmit wrapped in one of these tags.
const SYSTEM_TAGS = ['task-notification', 'bash-notification', 'bash-stdout', 'bash-stderr', 'system-reminder', 'command-message', 'local-command-stdout'];
const SYSTEM_RE = new RegExp(`^<(${SYSTEM_TAGS.join('|')})[\\s>]`, 'i');

export class State {
  constructor() {
    this.sessions = new Map();
  }

  session(p, ts) {
    const id = p.session_id || 'no-session';
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        cwd: p.cwd || '',
        project: p.cwd ? projectName(p.cwd) : 'unknown',
        startedAt: ts,
        lastAt: ts,
        status: 'idle', // idle | working | waiting | ended
        prompts: 0,
        compactions: 0,
        agents: {
          main: { id: 'main', label: 'Claude', type: 'main', startedAt: ts, endedAt: null, status: 'idle', actions: 0 },
        },
        pending: {},
        events: [],
        files: {},
        tools: {},
        alerts: [],
        agentSeq: 0,
      };
      this.sessions.set(id, s);
    }
    if (p.cwd && !s.cwd) {
      s.cwd = p.cwd;
      s.project = projectName(p.cwd);
    }
    s.lastAt = ts;
    return s;
  }

  // Who performed the action: a subagent (when Claude Code sends agent_id) or the main agent.
  actor(s, p, ts) {
    const aid = p.agent_id;
    if (!aid) return s.agents.main;
    if (!s.agents[aid]) {
      // Try to bind it to a launched subagent that has no real id yet.
      const orphan = Object.values(s.agents).find((a) => a.id !== 'main' && !a.realId && a.status === 'running');
      if (orphan) {
        orphan.realId = aid;
        s.agents[aid] = orphan;
      } else {
        s.agents[aid] = {
          id: aid, label: p.agent_type || 'subagent', type: p.agent_type || 'subagent',
          startedAt: ts, endedAt: null, status: 'running', actions: 0, parent: 'main',
        };
      }
    }
    return s.agents[aid];
  }

  push(s, ev) {
    s.events.push(ev);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  }

  touchFile(s, file, kind, actor, ts) {
    if (!file) return;
    const f = (s.files[file] ||= { path: file, reads: 0, edits: 0, lastEditBy: null, lastEditAt: 0 });
    if (kind === 'read') f.reads++;
    if (kind === 'edit') {
      if (f.lastEditBy && f.lastEditBy !== actor.id && ts - f.lastEditAt < CONFLICT_WINDOW_MS) {
        s.alerts.push({ ts, kind: 'conflict', a: actor.id, b: f.lastEditBy, file: baseName(file) });
      }
      f.edits++;
      f.lastEditBy = actor.id;
      f.lastEditAt = ts;
    }
  }

  apply(p, ts = Date.now()) {
    const name = p.hook_event_name;
    const s = this.session(p, ts);

    switch (name) {
      case 'SessionStart':
        s.status = 'idle';
        this.push(s, { ts, kind: 'session_start', actor: 'main', detail: p.source || '' });
        break;

      case 'UserPromptSubmit': {
        s.status = 'working';
        s.agents.main.status = 'working';
        const sys = systemDetail(p.prompt);
        if (sys) { this.push(s, { ts, kind: 'system', actor: 'system', detail: sys }); break; }
        s.prompts++;
        this.push(s, { ts, kind: 'prompt', actor: 'user', detail: cleanPrompt(p.prompt) });
        break;
      }

      case 'PreToolUse': {
        const actor = this.actor(s, p, ts);
        actor.actions++;
        s.status = 'working';
        if (actor.status !== 'running') actor.status = 'working';
        const tool = p.tool_name || '?';
        const key = p.tool_use_id || `${tool}:${ts}:${Math.random()}`;
        s.pending[key] = { ts, tool, actor: actor.id };
        const t = (s.tools[tool] ||= { name: tool, count: 0, errors: 0, totalMs: 0, timed: 0 });
        t.count++;
        const input = p.tool_input || {};

        if (AGENT_TOOLS.has(tool)) {
          const id = `agent-${++s.agentSeq}`;
          s.agents[id] = {
            id, toolUseId: p.tool_use_id || null, parent: actor.id,
            label: `${input.subagent_type || 'subagent'} #${s.agentSeq}`,
            type: input.subagent_type || 'general',
            description: String(input.description || '').slice(0, 120),
            startedAt: ts, endedAt: null, status: 'running', actions: 0,
          };
          s.pending[key].agentId = id;
          this.push(s, { ts, kind: 'agent_start', actor: actor.id, target: id, detail: s.agents[id].description });
          break;
        }

        const file = input.file_path || input.notebook_path || null;
        if (READ_TOOLS.has(tool)) this.touchFile(s, file, 'read', actor, ts);
        if (EDIT_TOOLS.has(tool)) this.touchFile(s, file, 'edit', actor, ts);
        this.push(s, { ts, kind: kindOf(tool), actor: actor.id, tool, detail: describe(tool, input) });
        break;
      }

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const actor = this.actor(s, p, ts);
        const key = p.tool_use_id && s.pending[p.tool_use_id]
          ? p.tool_use_id
          : Object.keys(s.pending).find((k) => s.pending[k].tool === p.tool_name && s.pending[k].actor === actor.id);
        const pend = key ? s.pending[key] : null;
        if (key) delete s.pending[key];
        const tool = p.tool_name || pend?.tool || '?';
        const t = (s.tools[tool] ||= { name: tool, count: 0, errors: 0, totalMs: 0, timed: 0 });
        if (pend) { t.totalMs += ts - pend.ts; t.timed++; }
        const failed = name === 'PostToolUseFailure' || isError(p.tool_response);
        if (failed) {
          t.errors++;
          this.push(s, { ts, kind: 'error', actor: actor.id, tool, detail: '' });
        }
        if (AGENT_TOOLS.has(tool)) {
          const agent = pend?.agentId ? s.agents[pend.agentId] : Object.values(s.agents).find((a) => a.status === 'running');
          if (agent) {
            agent.status = failed ? 'error' : 'done';
            agent.endedAt = ts;
            this.push(s, { ts, kind: 'agent_done', actor: agent.id, detail: '' });
          }
        }
        break;
      }

      case 'SubagentStart':
        if (p.agent_id) this.actor(s, p, ts);
        break;

      case 'SubagentStop': {
        const a = p.agent_id ? s.agents[p.agent_id] : null;
        if (a && a.status === 'running') { a.status = 'done'; a.endedAt = ts; }
        break;
      }

      case 'Notification':
        s.status = 'waiting';
        this.push(s, { ts, kind: 'waiting', actor: 'main', detail: String(p.message || '').slice(0, 140) });
        break;

      case 'PreCompact':
        s.compactions++;
        this.push(s, { ts, kind: 'compact', actor: 'main', detail: p.trigger || 'auto' });
        break;

      case 'Stop':
        s.status = 'idle';
        s.agents.main.status = 'idle';
        this.push(s, { ts, kind: 'stop', actor: 'main', detail: '' });
        break;

      case 'SessionEnd':
        s.status = 'ended';
        s.agents.main.endedAt = ts;
        this.push(s, { ts, kind: 'session_end', actor: 'main', detail: p.reason || '' });
        break;

      default:
        return null;
    }
    return s;
  }

  summary(s, now = Date.now()) {
    const { pending, agentSeq, ...rest } = s;
    const stale = isStale(s, now);
    // Drop duplicate agent aliases (same object registered under its real id).
    const seen = new Set();
    const agents = [];
    for (const a of Object.values(s.agents)) {
      if (seen.has(a)) continue;
      seen.add(a);
      agents.push(stale && (a.status === 'running' || a.status === 'working') ? { ...a, status: 'idle' } : a);
    }
    return {
      ...rest, status: stale ? 'idle' : s.status, agents,
      files: Object.values(s.files), tools: Object.values(s.tools), alerts: s.alerts.slice(-20),
    };
  }

  list(now = Date.now()) {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((s) => ({
        id: s.id, project: s.project, cwd: s.cwd, status: isStale(s, now) ? 'idle' : s.status,
        lastAt: s.lastAt, startedAt: s.startedAt, prompts: s.prompts,
      }));
  }
}

// A session that never got Stop/SessionEnd stays "working" in storage; report it idle once it goes quiet.
// Computed at read time so a late event still resumes it normally.
function isStale(s, now) {
  return (s.status === 'working' || s.status === 'waiting') && now - s.lastAt > STALE_MS;
}

// Last path segment, accepting both / and \ so Windows paths work on any host.
export function baseName(p) {
  return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

function projectName(cwd) {
  return baseName(cwd) || cwd;
}

// Short label for a system-injected prompt (its <summary>, else <status>, else the tag name), or null for a real user prompt.
function systemDetail(text) {
  const t = String(text || '').trim();
  const m = SYSTEM_RE.exec(t);
  if (!m) return null;
  const inner = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(t)?.[1].trim();
  return (inner('summary') || inner('status') || m[1]).slice(0, 140);
}

// Strip Claude Code's internal tags (e.g. <pasted_content id="x">) from the prompt text.
function cleanPrompt(text) {
  return String(text || '')
    .replace(/<\/?[a-z_][\w-]*(\s[^>]*)?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function isError(r) {
  if (!r || typeof r !== 'object') return false;
  return r.is_error === true || r.success === false || (typeof r.error === 'string' && r.error.length > 0);
}

function kindOf(tool) {
  if (READ_TOOLS.has(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (tool === 'Bash') return 'command';
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'tool';
}

function describe(tool, input) {
  const base = (f) => (f ? baseName(f) : '');
  switch (tool) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': return base(input.file_path);
    case 'NotebookEdit': return base(input.notebook_path);
    case 'Glob': return input.pattern || '';
    case 'Grep': return `"${String(input.pattern || '').slice(0, 60)}"`;
    case 'Bash': return String(input.description || input.command || '').slice(0, 100);
    case 'WebSearch': return String(input.query || '').slice(0, 100);
    case 'WebFetch': return String(input.url || '').slice(0, 100);
    default:
      if (tool.startsWith('mcp__')) return tool.split('__').slice(1).join(' › ');
      return '';
  }
}
