// Panel de KevMind: escucha /stream (SSE) y pinta la sesión seleccionada.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STATUS = { working: 'trabajando', idle: 'en espera', waiting: 'espera tu OK', ended: 'cerrada' };
const AGENT_STATUS = { running: 'trabajando', working: 'trabajando', idle: 'en espera', done: 'terminó', error: 'con error' };
const WINDOW_MS = 15 * 60 * 1000;

let sessions = [];
let current = null;      // resumen completo de la sesión seleccionada
let selectedId = null;
let pinned = false;      // si el usuario eligió una sesión a mano
let lastEventCount = 0;

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
  $('conn').className = 'conn ' + (on ? 'on' : 'off');
  $('connText').textContent = on ? 'conectado' : 'sin conexión, reintentando…';
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

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function renderSessions() {
  $('noSessions').hidden = sessions.length > 0;
  $('sessionList').innerHTML = sessions.map((s) => `
    <li data-id="${esc(s.id)}" class="${s.id === selectedId ? 'sel' : ''}" title="${esc(s.cwd)}">
      <span class="sdot ${esc(s.status)}"></span>
      <span class="sname">${esc(s.project)}</span>
      <span class="smeta">${STATUS[s.status] || s.status} · ${ago(s.lastAt)}</span>
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
  $('nowStatus').textContent = STATUS[s.status] || s.status;
  $('nowStatus').className = 'status ' + s.status;
  const active = s.agents.filter((a) => a.status === 'running' || a.status === 'working').length;
  $('stAgents').textContent = active;
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
      const sub = a.id === 'main' ? (STATUS[s.status] || '') : `${AGENT_STATUS[a.status] || a.status} · ${a.actions} acciones`;
      return `<div class="grow">
        <div class="glabel" title="${esc(a.description || '')}">${a.id === 'main' ? '<b>Claude</b>' : '↳ ' + esc(a.label)}<small>${esc(sub)}</small></div>
        <div class="gtrack"><div class="gbar ${esc(cls)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${esc(a.description || a.label)}"></div></div>
      </div>`;
    });
  const mins = Math.round(span / 60000);
  $('gantt').innerHTML = rows.join('') +
    `<div class="gaxis"><div></div><div><span>${mins > 0 ? `hace ${mins} min` : 'inicio'}</span><span>ahora</span></div></div>`;
}

function renderFeed(s) {
  const byId = Object.fromEntries(s.agents.map((a) => [a.id, a]));
  const who = (id) => (id === 'user' ? 'Tú' : id === 'main' ? 'Claude' : byId[id]?.label || id);
  const events = s.events.slice().reverse();
  const fresh = Math.max(0, s.events.length - lastEventCount);
  lastEventCount = s.events.length;
  $('feed').innerHTML = events.slice(0, 150).map((e, i) => `
    <li class="${i < fresh && fresh < 20 ? 'new' : ''}">
      <span class="t">${hhmm(e.ts)}</span>
      <span class="k ${esc(e.kind)}">${esc(e.tool && !['lee', 'edita'].includes(e.kind) ? e.tool : e.kind)}</span>
      <span class="x"><span class="who">${esc(who(e.actor))}</span>${esc(e.text)}</span>
    </li>`).join('');
}

function renderSide(s) {
  const alerts = s.alerts.slice().reverse();
  $('noAlerts').hidden = alerts.length > 0;
  $('alerts').innerHTML = alerts.map((a) => `<li><b>${esc(a.kind)}</b>${esc(a.text)}</li>`).join('');

  const files = s.files.slice().sort((a, b) => (b.edits * 3 + b.reads) - (a.edits * 3 + a.reads)).slice(0, 8);
  const max = Math.max(1, ...files.map((f) => f.reads + f.edits));
  $('files').innerHTML = files.map((f) => {
    const name = f.path.split(/[\\/]/).pop();
    return `<li title="${esc(f.path)}">
      <span class="fname">${esc(name)}</span>
      <span class="fnum">${f.reads} lee · ${f.edits} edita</span>
      <span class="fbar"><i class="r" style="width:${(f.reads / max) * 100}%"></i><i class="e" style="width:${(f.edits / max) * 100}%"></i></span>
    </li>`;
  }).join('') || '<li class="empty">Nada todavía.</li>';

  const tools = s.tools.slice().sort((a, b) => b.count - a.count).slice(0, 10);
  $('tools').innerHTML = tools.map((t) => `<tr>
      <td title="${esc(t.name)}">${esc(t.name)}</td><td>${t.count}</td>
      <td class="${t.errors ? 'err' : ''}">${t.errors}</td>
      <td>${t.timed ? fmtMs(t.totalMs / t.timed) : '—'}</td></tr>`).join('');
}
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

// Refresca barras y tiempos relativos cada segundo sin esperar eventos.
setInterval(() => { renderGantt(); renderSessions(); }, 1000);
connect();
