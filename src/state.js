// Turns raw hook payloads (and transcript lines, see transcript.js) into a model: sessions → agents → actions.
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

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

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
        transcript: null, // path of the session transcript, tailed by transcript.js
        model: null,
        tokens: zeroTokens(),
        startedAt: ts,
        lastAt: ts,
        status: 'idle', // idle | working | waiting | ended
        prompts: 0,
        compactions: 0,
        agents: {
          main: { id: 'main', label: 'Claude', type: 'main', startedAt: ts, endedAt: null, status: 'idle', actions: 0, tokens: zeroTokens() },
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
    if (p.transcript_path && !s.transcript) s.transcript = p.transcript_path;
    s.lastAt = ts;
    return s;
  }

  // ---- agents -------------------------------------------------------------
  // A subagent has a row from the moment its Task/Agent call is seen (toolUseId) and gets its real id
  // (agent_id in hook payloads, agent-<id>.jsonl in the transcript) when the two can be linked.

  // The row for a Task/Agent tool_use id, created on first sight.
  launchAgent(s, { toolUseId, type, description, parent, ts }) {
    let a = toolUseId ? this.byToolUse(s, toolUseId) : null;
    if (a) return a;
    const seq = ++s.agentSeq;
    a = s.agents[`agent-${seq}`] = {
      id: `agent-${seq}`, seq, realId: null, toolUseId: toolUseId || null, parent: parent || 'main',
      type: type || 'subagent', description: String(description || '').slice(0, 120), launch: null,
      startedAt: ts, endedAt: null, status: 'running', actions: 0, tokens: zeroTokens(),
    };
    a.label = labelOf(a);
    this.push(s, { ts, kind: 'agent_start', actor: a.parent, target: a.id, detail: a.description });
    return a;
  }

  // An explicit link between a real agent id and its launch (from tool_response.agentId, the transcript's
  // async_launched result, or the subagent's meta.json). Wins over any earlier heuristic guess.
  bindAgent(s, { agentId, toolUseId, type, description, launch, ts }) {
    let a = toolUseId ? this.byToolUse(s, toolUseId) : null;
    const holder = s.agents[agentId];
    if (a && holder && holder !== a) {
      // ponytail: the guess attributed a second or two of actions to the wrong row; move the counts, keep the events.
      a.actions += holder.actions;
      addTokens(a.tokens, holder.tokens);
      holder.actions = 0;
      holder.tokens = zeroTokens();
      holder.realId = null;
    }
    if (!a) a = holder || this.launchAgent(s, { toolUseId, type, description, parent: 'main', ts });
    a.realId = agentId;
    s.agents[agentId] = a;
    if (toolUseId && !a.toolUseId) a.toolUseId = toolUseId;
    if (type) a.type = type;
    if (description) a.description = String(description).slice(0, 120);
    if (launch) a.launch = launch;
    a.label = labelOf(a);
    return a;
  }

  // Who performed a hook event: the main agent, a known subagent, or a launched row bound by best guess.
  // Guess order: same agent_type without a real id yet, else any row without one, else a new row. Never by status.
  actor(s, p, ts) {
    const aid = p.agent_id;
    if (!aid) return s.agents.main;
    if (s.agents[aid]) return s.agents[aid];
    const unbound = Object.values(s.agents).filter((a) => a.id !== 'main' && !a.realId).sort((x, y) => x.startedAt - y.startedAt);
    const pick = (p.agent_type && unbound.find((a) => a.type === p.agent_type)) || unbound[0];
    if (pick) {
      pick.realId = aid;
      s.agents[aid] = pick;
      if (p.agent_type) pick.type = p.agent_type;
      pick.label = labelOf(pick);
      return pick;
    }
    const seq = ++s.agentSeq;
    const a = s.agents[aid] = {
      id: aid, seq, realId: aid, toolUseId: null, parent: 'main', type: p.agent_type || 'subagent', description: '', launch: null,
      startedAt: ts, endedAt: null, status: 'running', actions: 0, tokens: zeroTokens(),
    };
    a.label = labelOf(a);
    return a;
  }

  endAgent(s, agentId, ts, status = 'done') {
    const a = s.agents[agentId];
    if (!a || a.id === 'main') return;
    if (a.endedAt && status !== 'error') return; // already ended; only a failure can still change the outcome
    if (!a.endedAt) this.push(s, { ts, kind: 'agent_done', actor: a.id, detail: '' });
    a.status = status;
    a.endedAt = ts;
  }

  byToolUse(s, toolUseId) {
    return Object.values(s.agents).find((a) => a.toolUseId === toolUseId) || null;
  }

  // One API call's usage, counted by the caller exactly once per message id.
  addUsage(s, actorId, u) {
    if (!u) return;
    const n = (v) => Number(v) || 0;
    const t = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
    addTokens(s.tokens, t);
    const a = s.agents[actorId];
    if (a) addTokens(a.tokens, t);
  }

  // Keeps events in time order: transcript lines can arrive later than the hook events of the same moment.
  push(s, ev) {
    const evs = s.events;
    let i = evs.length;
    while (i > 0 && evs[i - 1].ts > ev.ts) i--;
    if (i === evs.length) evs.push(ev); else evs.splice(i, 0, ev);
    if (evs.length > MAX_EVENTS) evs.splice(0, evs.length - MAX_EVENTS);
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
        actor.endedAt = null; // an action after an end means the end was wrong (or the agent resumed)
        actor.status = actor.id === 'main' ? 'working' : 'running';
        s.status = 'working';
        const tool = p.tool_name || '?';
        const key = p.tool_use_id || `${tool}:${ts}:${Math.random()}`;
        s.pending[key] = { ts, tool, actor: actor.id };
        const t = (s.tools[tool] ||= { name: tool, count: 0, errors: 0, totalMs: 0, timed: 0 });
        t.count++;
        const input = p.tool_input || {};

        if (AGENT_TOOLS.has(tool)) {
          const a = this.launchAgent(s, { toolUseId: p.tool_use_id, type: input.subagent_type, description: input.description, parent: actor.id, ts });
          s.pending[key].agentId = a.id;
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
          const r = p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {};
          const background = r.isAsync === true || r.status === 'async_launched' || p.tool_input?.run_in_background === true;
          let agent = pend?.agentId ? s.agents[pend.agentId] : (p.tool_use_id ? this.byToolUse(s, p.tool_use_id) : null);
          if (r.agentId) agent = this.bindAgent(s, { agentId: r.agentId, toolUseId: p.tool_use_id || agent?.toolUseId, description: r.description, launch: background ? 'background' : 'foreground', ts });
          if (!agent) break;
          // A background launch returns at once; the agent ends on its SubagentStop or task notification.
          if (background) agent.launch = 'background';
          else this.endAgent(s, agent.id, ts, failed ? 'error' : 'done');
        }
        break;
      }

      case 'SubagentStart':
        if (p.agent_id) this.actor(s, p, ts).status = 'running';
        break;

      case 'SubagentStop':
        if (p.agent_id) this.endAgent(s, p.agent_id, ts, 'done');
        break;

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
    const { pending, agentSeq, transcript, ...rest } = s;
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

function labelOf(a) {
  return a.description ? `${a.type} · ${a.description}` : `${a.type} #${a.seq}`;
}

function addTokens(into, t) {
  into.input += t.input; into.output += t.output; into.cacheRead += t.cacheRead; into.cacheWrite += t.cacheWrite;
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
