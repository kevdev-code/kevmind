// Turns raw hook payloads (and transcript lines, see transcript.js) into a model: sessions → agents → actions.
// Events are stored as language-neutral codes; the UI translates them.

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const MAX_EVENTS = 300;
const MAX_HITS = 24; // files a search matched, kept on the event (as paths) for the Brain view...
const HIT_EVENTS = 3; // ...of the newest searches only, so the session's summary stays small
export const MAX_ALERTS = 50; // per session, newest kept: a long session with many conflicts must not grow memory
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
        eventSeq: 0, // every event gets the next number, so the page can key its rows
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
    ev.seq = s.eventSeq = (s.eventSeq || 0) + 1;
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
        if (s.alerts.length > MAX_ALERTS) s.alerts.splice(0, s.alerts.length - MAX_ALERTS);
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
        const prompt = cleanPrompt(p.prompt);
        if (!s.firstPrompt && prompt) s.firstPrompt = prompt.slice(0, 80); // names the session until it has a title
        this.push(s, { ts, kind: 'prompt', actor: 'user', detail: prompt });
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
        // The file of a read or an edit, relative to the session's folder when it is inside it: the Brain view finds
        // its node by it (the feed shows only the file's name). A search says where it looked (dir).
        const dir = SEARCH_TOOLS.has(tool) && typeof input.path === 'string' && input.path ? relTo(s.cwd, input.path) : null;
        const ev = { ts, kind: kindOf(tool), actor: actor.id, tool, detail: describe(tool, input), ...(file ? { path: relTo(s.cwd, file) } : {}), ...(dir ? { dir } : {}) };
        this.push(s, ev);
        s.pending[key].ev = ev; // what the call did is written on its event when it ends (PostToolUse)
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
        // The call that was waiting for the user's OK has run (or was turned down): the wait is over. Without this the
        // session kept saying "needs your OK" until its next call, however long this one took.
        if (s.status === 'waiting' && key && key === s.asked) { s.status = 'working'; s.asked = null; }
        if (failed) {
          t.errors++;
          this.push(s, { ts, kind: 'error', actor: actor.id, tool, detail: '' });
        }
        // What the call did, on its own event: lines added and removed, a file created, the files a search matched,
        // how long a command ran. Measured by the server before the payload is cut (p.outcome); for an event that was
        // spooled or comes from an old log, from what is left of it.
        if (pend?.ev && !failed) {
          const o = p.outcome || outcomeOf(p, true);
          if (o) {
            const { hits, ...rest } = o;
            Object.assign(pend.ev, rest);
            if (hits) {
              pend.ev.hits = hits.map((f) => relTo(s.cwd, f));
              const q = (s.hitEvents ||= []);
              q.push(pend.ev);
              while (q.length > HIT_EVENTS) delete q.shift().hits;
            }
          }
          if (tool === 'Bash') pend.ev.ms = Math.max(0, ts - pend.ts);
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

      case 'Notification': {
        s.status = 'waiting';
        // What it asks about is the call that started last and has not ended: the prompt follows its PreToolUse.
        let last = null;
        for (const [k, pd] of Object.entries(s.pending)) if (!last || pd.ts >= s.pending[last].ts) last = k;
        s.asked = last;
        this.push(s, { ts, kind: 'waiting', actor: 'main', detail: String(p.message || '').slice(0, 140) });
        break;
      }

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

      // Which instruction files actually loaded, for the Memory tab. Not a feed event.
      case 'InstructionsLoaded':
        if (!p.file_path) break;
        (s.instructions ||= []).push({ ts, path: p.file_path, type: p.memory_type || null, reason: p.load_reason || null });
        if (s.instructions.length > 200) s.instructions.splice(0, s.instructions.length - 200);
        break;

      default:
        return null;
    }
    return s;
  }

  summary(s, now = Date.now()) {
    const { pending, agentSeq, transcript, instructions, hitEvents, asked, ...rest } = s;
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
      files: Object.values(s.files), tools: Object.values(s.tools), alerts: s.alerts.slice(),
    };
  }

  list(now = Date.now()) {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((s) => ({
        id: s.id, project: s.project, cwd: s.cwd, status: isStale(s, now) ? 'idle' : s.status,
        lastAt: s.lastAt, startedAt: s.startedAt, prompts: s.prompts, title: s.title || null, firstPrompt: s.firstPrompt || null,
        // How much happened, so the dashboard can fold sessions that never did anything.
        events: s.eventSeq || s.events.length,
        toolCalls: Object.values(s.tools).reduce((n, t) => n + (t.count || 0), 0),
        edits: Object.values(s.files).reduce((n, x) => n + (x.edits || 0), 0),
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

// A file's path relative to a folder when it is inside it (with forward slashes), else as it came.
function relTo(dir, file) {
  const f = String(file).replace(/\\/g, '/'), d = String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return d && f.length > d.length + 1 && f.slice(0, d.length + 1).toLowerCase() === d.toLowerCase() + '/' ? f.slice(d.length + 1) : f;
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
// Prompt text without tags or extra whitespace, short. Also cleans titles from the transcript.
export function cleanPrompt(text) {
  return String(text || '')
    .replace(/<\/?[a-z_][\w-]*(\s[^>]*)?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

// What a finished tool call did, in numbers and paths only, never content: { add, del } lines added and removed by an
// edit (from the patch Claude Code reports), created for a new file, { found, hits } the files a search matched.
// cut: the payload was already redacted and cut (long lists end at 50 entries, long strings at 2,000 characters), so
// what could have been cut is not counted rather than counted short.
export function outcomeOf(p, cut = false) {
  const r = p?.tool_response;
  if (!r || typeof r !== 'object') return null;
  const whole = (list) => !cut || list.length < 50;
  const out = {};
  if (Array.isArray(r.structuredPatch) && EDIT_TOOLS.has(p.tool_name)) {
    if (r.type === 'create') {
      out.created = true;
      const text = typeof r.content === 'string' ? r.content : p.tool_input?.content;
      if (typeof text === 'string' && !(cut && text.length >= 2000)) { out.add = lineCount(text); out.del = 0; }
    } else if (whole(r.structuredPatch) && r.structuredPatch.every((h) => Array.isArray(h?.lines) && whole(h.lines))) {
      let add = 0, del = 0;
      for (const h of r.structuredPatch) for (const l of h.lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++; }
      out.add = add; out.del = del;
    }
  }
  if (SEARCH_TOOLS.has(p.tool_name)) {
    let files = Array.isArray(r.filenames) ? r.filenames.filter((f) => typeof f === 'string') : [];
    // Grep showing the matching lines lists no files: they are the paths its lines start with ("src/a.js:12:…").
    if (!files.length && typeof r.content === 'string' && !(cut && r.content.length >= 2000)) {
      files = [...new Set([...r.content.matchAll(/^((?:[A-Za-z]:)?[^:\n]+)[:-]\d+[:-]/gm)].map((m) => m[1]))];
    }
    if (files.length || typeof r.numFiles === 'number') {
      out.found = Math.max(Number(r.numFiles) || 0, whole(files) ? files.length : 0);
      if (files.length) out.hits = files.slice(0, MAX_HITS).filter((f) => f.length <= 300);
    }
  }
  return Object.keys(out).length ? out : null;
}
const lineCount = (t) => (t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0);

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
