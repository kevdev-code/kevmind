// Tails a session's transcript (and its subagents/ folder) to learn what Claude says and thinks,
// how many tokens each agent used, and the exact identity of every subagent.
// Only short redacted excerpts ever leave this module; the transcript is never copied.
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { redact } from '../hooks/redact.js';
import { cleanPrompt } from './state.js';

const EXCERPT = 200;
const CHUNK = 1 << 20; // read 1 MB at a time, so a big transcript never sits in memory whole
const AGENT_TOOLS = new Set(['Task', 'Agent']);

export class Tailer {
  constructor(state, s) {
    this.state = state;
    this.s = s;
    this.files = new Map();
    this.agentsDir = path.join(s.transcript.replace(/\.jsonl$/i, ''), 'subagents');
    this.changed = false;
    this.attach(s.transcript, 'main');
  }

  attach(file, actor) {
    this.files.set(file, { file, actor, offset: 0, rest: '', dec: new StringDecoder('utf8'), seen: new Set(), cur: null, busy: false });
  }

  // Reads whatever is new. Returns true when the session model changed since the last tick.
  // Known files first: the parent's Agent tool_use line must create a row (with the launch time) before the
  // subagent's own file binds to it; then the files found in this tick. Files still catching up are left
  // to their own setImmediate chain.
  tick() {
    for (const f of this.files.values()) if (!f.busy) this.read(f);
    for (const f of this.scanAgents()) this.read(f);
    const changed = this.changed; // includes chunks the catch-up chain processed between ticks
    this.changed = false;
    return changed;
  }

  // New agent-<id>.jsonl files: bind the agent from its meta.json and tail it too. The folder may never exist.
  scanAgents() {
    const added = [];
    let names;
    try { names = fs.readdirSync(this.agentsDir); } catch { return added; }
    for (const name of names) {
      const m = /^agent-([a-z0-9]+)\.jsonl$/i.exec(name);
      const file = path.join(this.agentsDir, name);
      if (!m || this.files.has(file)) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(this.agentsDir, `agent-${m[1]}.meta.json`), 'utf8')); } catch { /* no meta yet */ }
      let ts = Date.now();
      try { ts = fs.statSync(file).birthtimeMs || ts; } catch { /* keep now */ }
      const a = this.state.bindAgent(this.s, {
        agentId: m[1], toolUseId: meta.toolUseId, type: meta.agentType, description: meta.description,
        launch: meta.requestShape === 'background' ? 'background' : meta.requestShape ? 'foreground' : null, ts,
      });
      this.attach(file, a.id);
      added.push(this.files.get(file));
      this.changed = true;
    }
    return added;
  }

  // Reads one chunk. When more is waiting (a big file on first attach), the rest follows on setImmediate,
  // one chunk per turn of the event loop, so hooks and SSE keep being served while the history loads.
  read(f) {
    let size;
    try { size = fs.statSync(f.file).size; } catch { return; }
    if (size < f.offset) { f.offset = 0; f.rest = ''; f.dec = new StringDecoder('utf8'); } // rewritten from scratch
    if (size > f.offset) {
      const fd = fs.openSync(f.file, 'r');
      try {
        const buf = Buffer.allocUnsafe(Math.min(CHUNK, size - f.offset));
        const n = fs.readSync(fd, buf, 0, buf.length, f.offset);
        if (n > 0) {
          f.offset += n;
          const lines = (f.rest + f.dec.write(buf.subarray(0, n))).split('\n');
          f.rest = lines.pop(); // a partial last line waits for the rest
          for (const line of lines) this.line(f, line);
        }
      } finally {
        fs.closeSync(fd);
      }
    }
    f.busy = f.offset < size;
    if (f.busy) setImmediate(() => this.read(f));
    const loading = [...this.files.values()].some((x) => x.busy);
    if (loading !== !!this.s.loading) { this.s.loading = loading; this.changed = true; }
  }

  line(f, raw) {
    if (!raw.trim()) return;
    let o;
    try { o = JSON.parse(raw); } catch { return; }
    const ts = Date.parse(o.timestamp) || Date.now();
    if (o.type === 'assistant') this.assistant(f, o, ts);
    else if (o.type === 'user') this.user(f, o, ts);
    else if (f.actor === 'main' && (o.type === 'custom-title' || o.type === 'last-prompt')) this.title(o);
  }

  // The session's name in the sessions rail: a custom title when it has one, otherwise its latest prompt.
  // Redacted, without tags, at most 80 characters.
  title(o) {
    const custom = o.type === 'custom-title';
    if (!custom && this.s.titleFrom === 'custom') return;
    const t = cleanPrompt(redact(String((custom ? o.customTitle : o.lastPrompt) || ''))).slice(0, 80);
    if (!t || (t === this.s.title && (this.s.titleFrom === 'custom') === custom)) return;
    this.s.title = t;
    this.s.titleFrom = custom ? 'custom' : 'prompt';
    this.changed = true;
  }

  // One content block per line; lines of one API call share message.id and repeat the same usage.
  assistant(f, o, ts) {
    const m = o.message || {};
    const block = Array.isArray(m.content) ? m.content[0] : null;
    if (!block) return;
    if (m.model) this.s.model = m.model;
    if (m.id && !f.seen.has(m.id)) {
      f.seen.add(m.id); // ponytail: grows with the session (~100 B per API call); fine for days, not for months
      this.state.addUsage(this.s, f.actor, m.usage, ts);
      f.cur = { id: m.id, thought: false, silent: false, thinkingTokens: m.usage?.output_tokens_details?.thinking_tokens || 0 };
      this.changed = true;
    }
    if (block.type === 'thinking') {
      const text = excerpt(block.thinking);
      if (text && f.cur) f.cur.thought = true;
      if (text) this.push({ ts, kind: 'thinks', actor: f.actor, detail: text });
      return; // the signature is never read
    }
    this.silentThought(f, ts);
    if (block.type === 'text') {
      const text = excerpt(block.text);
      if (text) this.push({ ts, kind: 'says', actor: f.actor, detail: text });
    } else if (block.type === 'tool_use' && AGENT_TOOLS.has(block.name)) {
      this.state.launchAgent(this.s, { toolUseId: block.id, type: block.input?.subagent_type, description: block.input?.description, parent: f.actor, ts });
      this.changed = true;
    }
  }

  // Reasoning happened but nothing readable came back: say so once per API call, with the token count.
  silentThought(f, ts) {
    const c = f.cur;
    if (!c || c.thought || c.silent || !c.thinkingTokens) return;
    c.silent = true;
    this.push({ ts, kind: 'thinks', actor: f.actor, detail: '', tokens: c.thinkingTokens });
  }

  // Prompts are reported by the hooks already; user lines matter here only for agent lifecycle.
  user(f, o, ts) {
    const c = o.message?.content;
    if (typeof c === 'string') {
      if (o.origin?.kind !== 'task-notification') return;
      const id = /<task-id>([^<]+)<\/task-id>/.exec(c)?.[1];
      const status = /<status>([^<]+)<\/status>/.exec(c)?.[1] || 'completed';
      if (id) { this.state.endAgent(this.s, id.trim(), ts, status === 'completed' ? 'done' : 'error'); this.changed = true; }
      return;
    }
    const r = o.toolUseResult;
    if (!Array.isArray(c) || !r || typeof r !== 'object' || !r.agentId) return;
    const toolUseId = c[0]?.tool_use_id;
    if (r.isAsync || r.status === 'async_launched') {
      this.state.bindAgent(this.s, { agentId: r.agentId, toolUseId, description: r.description, launch: 'background', ts });
    } else {
      this.state.bindAgent(this.s, { agentId: r.agentId, toolUseId, type: r.agentType, launch: 'foreground', ts });
      this.state.endAgent(this.s, r.agentId, ts, r.status && r.status !== 'completed' ? 'error' : 'done');
    }
    this.changed = true;
  }

  push(ev) {
    this.state.push(this.s, ev);
    this.changed = true;
  }
}

// Masked first, then cut, so a secret straddling the cut is still masked.
function excerpt(text) {
  return redact(String(text || '')).replace(/\s+/g, ' ').trim().slice(0, EXCERPT);
}
