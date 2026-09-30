// KevMind dashboard: listens to /stream (SSE) and renders the selected session.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WINDOW_MS = 15 * 60 * 1000;
const LANG_KEY = 'kevmind.lang';

let sessions = [];
let current = null;      // full summary of the selected session
let selectedId = null;
let pinned = false;      // true when the user picked a session manually
let lastEventCount = 0;
let connected = null;

// ---------- i18n ----------
let lang = pickLang();
let T = I18N[lang];

function pickLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && I18N[saved]) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}

function setLang(next) {
  if (!I18N[next]) return;
  lang = next;
  T = I18N[lang];
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  applyStatic();
  renderSessions();
  renderSession();
}

function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = T[el.dataset.i18nHtml]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  if (connected !== null) setConn(connected);
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- data ----------
function connect() {
  const es = new EventSource('/stream');
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    sessions = msg.sessions || sessions;
    if (msg.type === 'session') {
      const s = msg.session;
      if (!pinned || s.id === selectedId) {
        if (s.id !== selectedId) lastEventCount = 0;
        selectedId = s.id;
        current = s;
      }
    }
    if (msg.type === 'hello' && !selectedId && sessions[0]) select(sessions[0].id, false);
    renderSessions();
    renderSession();
  };
}

function setConn(on) {
  connected = on;
  $('conn').className = 'conn ' + (on ? 'on' : 'off');
  $('connText').textContent = on ? T.connected : T.disconnected;
}

async function select(id, byUser = true) {
  selectedId = id;
  pinned = byUser;
  lastEventCount = 0;
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (r.ok) current = await r.json();
  renderSessions();
  renderSession();
}

// ---------- rendering ----------
const secondsSince = (ts) => Math.max(0, Math.round((Date.now() - ts) / 1000));
const hhmm = (ts) => new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
// "mcp__server__tool" → "server › tool"; other names unchanged.
const toolName = (n) => (n.startsWith('mcp__') ? n.slice(5).split('__').join(' › ') : n);

function renderSessions() {
  $('noSessions').hidden = sessions.length > 0;
  $('sessionList').innerHTML = sessions.map((s) => `
    <li data-id="${esc(s.id)}" class="${s.id === selectedId ? 'sel' : ''}" title="${esc(s.cwd)}">
      <span class="sdot ${esc(s.status)}"></span>
      <span class="sname">${esc(s.project)}</span>
      <span class="smeta">${esc(T.status[s.status] || s.status)} · ${T.ago(secondsSince(s.lastAt))}</span>
    </li>`).join('');
}
$('sessionList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) select(li.dataset.id);
});

function renderSession() {
  const s = current;
  if (!s) return;
  $('nowProject').textContent = s.project;
  $('nowCwd').textContent = s.cwd;
  $('nowStatus').textContent = T.status[s.status] || s.status;
  $('nowStatus').className = 'status ' + s.status;
  $('stAgents').textContent = s.agents.filter((a) => a.status === 'running' || a.status === 'working').length;
  $('stActions').textContent = s.agents.reduce((n, a) => n + a.actions, 0);
  $('stPrompts').textContent = s.prompts;
  renderGantt();
  renderFeed(s);
  renderSide(s);
}

function renderGantt() {
  const s = current;
  if (!s) return;
  const now = Date.now();
  $('stTime').textContent = `${Math.max(0, Math.round((now - s.startedAt) / 60000))} min`;
  const from = Math.max(s.startedAt, now - WINDOW_MS);
  const span = Math.max(1, now - from);
  const rows = s.agents
    .filter((a) => a.id === 'main' || (a.endedAt || now) >= from)
    .map((a) => {
      const start = Math.max(a.startedAt, from);
      const end = a.endedAt || now;
      const left = ((start - from) / span) * 100;
      const width = Math.max(0.5, ((end - start) / span) * 100);
      const cls = a.id === 'main' ? s.status : a.status;
      const sub = a.id === 'main' ? (T.status[s.status] || '') : T.agentStats(T.agentStatus[a.status] || a.status, a.actions);
      return `<div class="grow">
        <div class="glabel" title="${esc(a.description || '')}">${a.id === 'main' ? '<b>Claude</b>' : '↳ ' + esc(a.label)}<small>${esc(sub)}</small></div>
        <div class="gtrack"><div class="gbar ${esc(cls)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${esc(a.description || a.label)}"></div></div>
      </div>`;
    });
  const mins = Math.round(span / 60000);
  $('gantt').innerHTML = rows.join('') +
    `<div class="gaxis"><div></div><div><span>${mins > 0 ? T.minAgo(mins) : T.start}</span><span>${T.now}</span></div></div>`;
}

function renderFeed(s) {
  const byId = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  const who = (id) => (id === 'user' ? T.you : id === 'main' ? 'Claude' : byId[id]?.label || id);
  const text = (e) => {
    const fn = T.text[e.kind];
    if (e.kind === 'agent_start') return fn(who(e.target), e.detail);
    if (e.kind === 'agent_done') return fn(who(e.actor));
    return fn ? fn(e.detail, e.actor, e.tool) : e.detail;
  };
  const events = s.events.slice().reverse();
  const fresh = Math.max(0, s.events.length - lastEventCount);
  lastEventCount = s.events.length;
  $('feed').innerHTML = events.slice(0, 150).map((e, i) => {
    const label = e.tool && !['read', 'edit', 'error', 'mcp'].includes(e.kind) ? e.tool : T.kind[e.kind] || e.kind;
    const showWho = e.kind !== 'agent_done';
    return `<li class="${i < fresh && fresh < 20 ? 'new' : ''}">
      <span class="t">${hhmm(e.ts)}</span>
      <span class="k ${esc(e.kind)}">${esc(label)}</span>
      <span class="x">${showWho ? `<span class="who">${esc(who(e.actor))}</span>` : ''}${esc(text(e))}</span>
    </li>`;
  }).join('');
}

function renderSide(s) {
  const byId = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  const name = (id) => (id === 'main' ? 'Claude' : byId[id]?.label || id);
  const alerts = s.alerts.slice().reverse();
  $('noAlerts').hidden = alerts.length > 0;
  $('alerts').innerHTML = alerts.map((a) =>
    `<li><b>${esc(T.alertKind[a.kind] || a.kind)}</b>${esc(T.conflict(name(a.a), name(a.b), a.file))}</li>`).join('');

  const files = s.files.slice().sort((a, b) => (b.edits * 3 + b.reads) - (a.edits * 3 + a.reads)).slice(0, 8);
  const max = Math.max(1, ...files.map((f) => f.reads + f.edits));
  $('files').innerHTML = files.map((f) => `<li title="${esc(f.path)}">
      <span class="fname">${esc(f.path.split(/[\\/]/).pop())}</span>
      <span class="fnum">${T.fileStats(f.reads, f.edits)}</span>
      <span class="fbar"><i class="r" style="width:${(f.reads / max) * 100}%"></i><i class="e" style="width:${(f.edits / max) * 100}%"></i></span>
    </li>`).join('') || `<li class="empty">${T.nothingYet}</li>`;

  const tools = s.tools.slice().sort((a, b) => b.count - a.count).slice(0, 10);
  $('tools').innerHTML = tools.map((t) => `<tr>
      <td title="${esc(t.name)}">${esc(toolName(t.name))}</td><td>${t.count}</td>
      <td class="${t.errors ? 'err' : ''}">${t.errors}</td>
      <td>${t.timed ? fmtMs(t.totalMs / t.timed) : '—'}</td></tr>`).join('');
}

// Refresh bars and relative times every second without waiting for events.
setInterval(() => { renderGantt(); renderSessions(); }, 1000);
applyStatic();
connect();
