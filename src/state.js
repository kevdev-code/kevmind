// Convierte los eventos crudos de los hooks en un modelo: sesiones → agentes → acciones.
import path from 'node:path';

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const MAX_EVENTS = 300;
const CONFLICT_WINDOW_MS = 5 * 60 * 1000;

export class State {
  constructor() {
    this.sessions = new Map();
  }

  session(p, ts) {
    const id = p.session_id || 'sin-sesion';
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        cwd: p.cwd || '',
        project: p.cwd ? path.basename(p.cwd.replace(/[\\/]+$/, '')) : 'desconocido',
        startedAt: ts,
        lastAt: ts,
        status: 'idle',
        prompts: 0,
        compactions: 0,
        agents: {
          main: { id: 'main', label: 'Claude', type: 'principal', startedAt: ts, endedAt: null, status: 'idle', actions: 0 },
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
      s.project = path.basename(p.cwd.replace(/[\\/]+$/, ''));
    }
    s.lastAt = ts;
    return s;
  }

  // Quién hizo la acción: un subagente (si Claude Code manda agent_id) o el agente principal.
  actor(s, p, ts) {
    const aid = p.agent_id;
    if (!aid) return s.agents.main;
    if (!s.agents[aid]) {
      // Intentar asociarlo con un subagente lanzado que aún no tiene id real.
      const orphan = Object.values(s.agents).find((a) => a.id !== 'main' && !a.realId && a.status === 'running');
      if (orphan) {
        orphan.realId = aid;
        s.agents[aid] = orphan;
      } else {
        s.agents[aid] = {
          id: aid, label: p.agent_type || 'subagente', type: p.agent_type || 'subagente',
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
        const other = s.agents[f.lastEditBy]?.label || f.lastEditBy;
        s.alerts.push({ ts, kind: 'conflicto', text: `${actor.label} y ${other} editaron ${path.basename(file)} con menos de 5 min de diferencia` });
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
        this.push(s, { ts, kind: 'sesion', actor: 'main', text: `Sesión iniciada (${p.source || 'nueva'})` });
        break;

      case 'UserPromptSubmit': {
        s.prompts++;
        s.status = 'working';
        s.agents.main.status = 'working';
        const prompt = String(p.prompt || '').replace(/\s+/g, ' ').slice(0, 140);
        this.push(s, { ts, kind: 'prompt', actor: 'user', text: prompt });
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
            label: `${input.subagent_type || 'subagente'} #${s.agentSeq}`,
            type: input.subagent_type || 'general',
            description: String(input.description || '').slice(0, 120),
            startedAt: ts, endedAt: null, status: 'running', actions: 0,
          };
          s.pending[key].agentId = id;
          this.push(s, { ts, kind: 'agente', actor: actor.id, text: `lanzó ${s.agents[id].label}: ${s.agents[id].description}` });
          break;
        }

        const file = input.file_path || input.notebook_path || null;
        if (READ_TOOLS.has(tool)) this.touchFile(s, file, 'read', actor, ts);
        if (EDIT_TOOLS.has(tool)) this.touchFile(s, file, 'edit', actor, ts);
        this.push(s, { ts, kind: kindOf(tool), actor: actor.id, tool, text: describe(tool, input) });
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
          this.push(s, { ts, kind: 'error', actor: actor.id, tool, text: `${tool} falló` });
        }
        if (AGENT_TOOLS.has(tool)) {
          const agent = pend?.agentId ? s.agents[pend.agentId] : Object.values(s.agents).find((a) => a.status === 'running');
          if (agent) {
            agent.status = failed ? 'error' : 'done';
            agent.endedAt = ts;
            this.push(s, { ts, kind: 'listo', actor: agent.id, text: `${agent.label} terminó` });
          }
        }
        break;
      }

      case 'SubagentStart': {
        if (p.agent_id) this.actor(s, p, ts);
        break;
      }

      case 'SubagentStop': {
        const a = p.agent_id ? s.agents[p.agent_id] : null;
        if (a && a.status === 'running') { a.status = 'done'; a.endedAt = ts; }
        break;
      }

      case 'Notification':
        s.status = 'waiting';
        this.push(s, { ts, kind: 'espera', actor: 'main', text: String(p.message || 'Esperando tu respuesta').slice(0, 140) });
        break;

      case 'PreCompact':
        s.compactions++;
        this.push(s, { ts, kind: 'compacta', actor: 'main', text: `Compactando contexto (${p.trigger || 'auto'})` });
        break;

      case 'Stop':
        s.status = 'idle';
        s.agents.main.status = 'idle';
        this.push(s, { ts, kind: 'listo', actor: 'main', text: 'Terminó de responder' });
        break;

      case 'SessionEnd':
        s.status = 'ended';
        s.agents.main.endedAt = ts;
        this.push(s, { ts, kind: 'sesion', actor: 'main', text: `Sesión cerrada (${p.reason || 'fin'})` });
        break;

      default:
        return null;
    }
    return s;
  }

  summary(s) {
    const { pending, agentSeq, ...rest } = s;
    // Quitar alias duplicados de agentes (mismo objeto con id real).
    const seen = new Set();
    const agents = [];
    for (const a of Object.values(s.agents)) {
      if (seen.has(a)) continue;
      seen.add(a);
      agents.push(a);
    }
    return { ...rest, agents, files: Object.values(s.files), tools: Object.values(s.tools), alerts: s.alerts.slice(-20) };
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .map((s) => ({ id: s.id, project: s.project, cwd: s.cwd, status: s.status, lastAt: s.lastAt, startedAt: s.startedAt, prompts: s.prompts }));
  }
}

function isError(r) {
  if (!r || typeof r !== 'object') return false;
  return r.is_error === true || r.success === false || (typeof r.error === 'string' && r.error.length > 0);
}

function kindOf(tool) {
  if (READ_TOOLS.has(tool)) return 'lee';
  if (EDIT_TOOLS.has(tool)) return 'edita';
  if (tool === 'Bash') return 'comando';
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'herramienta';
}

function describe(tool, input) {
  const base = (f) => (f ? path.basename(String(f)) : '');
  switch (tool) {
    case 'Read': return base(input.file_path);
    case 'Edit': case 'MultiEdit': case 'Write': return base(input.file_path);
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
