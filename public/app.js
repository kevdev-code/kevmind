// KevMind dashboard: listens to /stream (SSE) and renders the selected session.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WINDOW_MS = 15 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const LANG_KEY = 'kevmind.lang';
const THINKS_KEY = 'kevmind.thinks';
const PROJECT_KEY = 'kevmind.project';
const params = new URLSearchParams(location.search);
// ?focus=latest: no session list, always the most recently started session of the chosen project.
const focus = params.get('focus') === 'latest';
if (focus) document.body.classList.add('focus');

let sessions = [];
let current = null;      // full summary of the selected session
let selectedId = null;
let pinned = false;      // true when the user picked a session manually
let lastEventCount = 0;
let connected = null;
let bootId = null;       // server boot id from the first "hello"; a different one means the server restarted
// ?project=Name for this page load, else the remembered choice, else all projects.
let projectFilter = params.get('project') || '';
if (!projectFilter) { try { projectFilter = localStorage.getItem(PROJECT_KEY) || ''; } catch { /* storage unavailable */ } }
let projectOptions = '';  // the option set last rendered, so an open dropdown isn't rebuilt under the mouse
const visibleSessions = () => (projectFilter ? sessions.filter((s) => s.project === projectFilter) : sessions);
const newestVisible = () => visibleSessions().slice().sort((a, b) => b.startedAt - a.startedAt)[0];
$('projectFilter').addEventListener('change', (e) => {
  projectFilter = e.target.value;
  try { localStorage.setItem(PROJECT_KEY, projectFilter); } catch { /* ignore */ }
  pinned = false;
  const visible = visibleSessions();
  if (!visible.some((s) => s.id === selectedId)) { selectedId = null; current = null; clearSession(); }
  renderSessions();
  if (!selectedId && visible[0]) select(visible[0].id, false);
});
let showThinks = true;   // feed toggle for "thinks" events
try { showThinks = localStorage.getItem(THINKS_KEY) !== '0'; } catch { /* storage unavailable */ }
$('showThinks').checked = showThinks;
$('showThinks').addEventListener('change', (e) => {
  showThinks = e.target.checked;
  try { localStorage.setItem(THINKS_KEY, showThinks ? '1' : '0'); } catch { /* ignore */ }
  if (current) renderFeed(current);
});

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
  if (typeof renderMemoryView === 'function') renderMemoryView();
}

function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = T[el.dataset.i18nHtml]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  $('projectFilter').setAttribute('aria-label', T.projectFilter);
  projectOptions = ''; // the option labels change with the language
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
    if (msg.type === 'reload') return location.reload();
    if (msg.type === 'hello') {
      if (bootId && msg.bootId !== bootId) return location.reload();
      bootId = msg.bootId;
    }
    sessions = msg.sessions || sessions;
    const shown = (s) => !projectFilter || s.project === projectFilter;
    if (focus) {
      const newest = newestVisible();
      if (newest && newest.id !== selectedId) {
        if (msg.type === 'session' && msg.session.id === newest.id) { selectedId = newest.id; current = msg.session; lastEventCount = 0; }
        else return select(newest.id, false);
      } else if (msg.type === 'session' && msg.session.id === selectedId) current = msg.session;
    } else if (msg.type === 'session' && shown(msg.session) && (!pinned || msg.session.id === selectedId)) {
      if (msg.session.id !== selectedId) lastEventCount = 0;
      selectedId = msg.session.id;
      current = msg.session;
    }
    const first = visibleSessions()[0];
    if (!selectedId && first) return select(first.id, false);
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
const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));
const tokensTip = (t) => `${T.tokensInOut}: ${t.input} / ${t.output} · ${T.cacheRW}: ${t.cacheRead} / ${t.cacheWrite}`;
// Agents by their row id and by their real id, since events may carry either.
const agentMap = (s) => {
  const m = {};
  for (const a of s.agents) { m[a.id] = a; if (a.realId) m[a.realId] = a; }
  return m;
};
// Mirrors the server's stale rule so the dots go idle on the 1 s tick, without waiting for a new event.
const isStale = (s) => (s.status === 'working' || s.status === 'waiting') && Date.now() - s.lastAt > STALE_MS;
const sessionStatus = (s) => (isStale(s) ? 'idle' : s.status);
const agentStatus = (a, s) => (isStale(s) && (a.status === 'running' || a.status === 'working') ? 'idle' : a.status);

function renderSessions() {
  const names = [...new Set(sessions.map((s) => s.project))].sort((a, b) => a.localeCompare(b));
  if (projectFilter && !names.includes(projectFilter)) names.push(projectFilter);
  const options = `<option value="">${esc(T.allProjects)}</option>` +
    names.map((n) => `<option value="${esc(n)}"${n === projectFilter ? ' selected' : ''}>${esc(n)}</option>`).join('');
  if (options !== projectOptions) { $('projectFilter').innerHTML = options; projectOptions = options; }
  const visible = visibleSessions();
  $('noSessions').hidden = visible.length > 0;
  $('noSessions').innerHTML = sessions.length && !visible.length ? esc(T.noProjectSessions) : T.noSessions;
  $('sessionList').innerHTML = visible.map((s) => {
    const st = sessionStatus(s);
    return `
    <li data-id="${esc(s.id)}" class="${s.id === selectedId ? 'sel' : ''}" title="${esc(s.cwd)}">
      <span class="sdot ${esc(st)}"></span>
      <span class="sname">${esc(s.project)}</span>
      <span class="smeta">${esc(T.status[st] || st)} · ${T.ago(secondsSince(s.lastAt))}</span>
    </li>`;
  }).join('');
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
  $('nowModel').textContent = s.model || '';
  $('nowModel').hidden = !s.model;
  $('nowLoading').hidden = !s.loading;
  $('stActions').textContent = s.agents.reduce((n, a) => n + a.actions, 0);
  $('stPrompts').textContent = s.prompts;
  const t = s.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  $('stTokens').textContent = `${fmtK(t.input)} / ${fmtK(t.output)}`;
  $('stTokens').title = tokensTip(t);
  $('stCache').textContent = `${fmtK(t.cacheRead)} / ${fmtK(t.cacheWrite)}`;
  $('stCache').title = tokensTip(t);
  renderStatus(s);
  renderGantt();
  renderFeed(s);
  renderSide(s);
}

// Nothing to show for the chosen project: blank the panels rather than leave another project on screen.
function clearSession() {
  $('nowProject').textContent = '—';
  $('nowCwd').textContent = '';
  $('nowModel').hidden = true;
  $('nowLoading').hidden = true;
  $('nowStatus').textContent = '—';
  $('nowStatus').className = 'status';
  for (const id of ['stAgents', 'stActions', 'stPrompts']) $(id).textContent = '0';
  $('stTime').textContent = '0 min';
  $('stTokens').textContent = '—';
  $('stCache').textContent = '—';
  for (const id of ['gantt', 'feed', 'alerts', 'files', 'tools']) $(id).innerHTML = '';
  $('noAlerts').hidden = false;
}

function renderStatus(s) {
  const st = sessionStatus(s);
  $('nowStatus').textContent = T.status[st] || st;
  $('nowStatus').className = 'status ' + st;
  $('stAgents').textContent = s.agents.filter((a) => ['running', 'working'].includes(agentStatus(a, s))).length;
}

function renderGantt() {
  const s = current;
  if (!s) return;
  const now = Date.now();
  $('stTime').textContent = `${Math.max(0, Math.round((now - s.startedAt) / 60000))} min`;
  const st = sessionStatus(s);
  const live = (a) => (a.id === 'main' ? st === 'working' || st === 'waiting' : ['running', 'working'].includes(agentStatus(a, s)));
  const endOf = (a) => (live(a) ? now : a.endedAt || now); // a live bar reaches "now" whatever endedAt says
  // Zoom to the subagents: from their earliest start (the session start if there are none) with 10 % padding,
  // never more than 15 min back, never narrower than 60 s.
  const subs = s.agents.filter((a) => a.id !== 'main');
  const first = subs.length ? Math.min(...subs.map((a) => a.startedAt)) : s.startedAt;
  const from = Math.min(Math.max(first - (now - first) * 0.1, now - WINDOW_MS), now - 60_000);
  const span = Math.max(1, now - from);
  const rows = s.agents
    .filter((a) => a.id === 'main' || endOf(a) >= from)
    .map((a) => {
      const start = Math.max(a.startedAt, from);
      const end = Math.max(start, endOf(a));
      const left = ((start - from) / span) * 100;
      const width = ((end - start) / span) * 100;
      const ast = a.id === 'main' ? st : agentStatus(a, s);
      const hasTokens = a.tokens && (a.tokens.input || a.tokens.output || a.tokens.cacheRead || a.tokens.cacheWrite);
      const tk = hasTokens ? `${fmtK(a.tokens.input + a.tokens.cacheRead + a.tokens.cacheWrite)}/${fmtK(a.tokens.output)}` : '';
      const sub = T.agentStats((a.id === 'main' ? T.status[ast] : T.agentStatus[ast]) || ast, a.actions, tk);
      const tip = (a.description || a.label) + (a.tokens ? '\n' + tokensTip(a.tokens) : '');
      return `<div class="grow">
        <div class="glabel" title="${esc(tip)}">${a.id === 'main' ? '<b>Claude</b>' : '<span class="branch"></span>' + esc(a.label)}<small>${esc(sub)}</small></div>
        <div class="gtrack"><div class="gbar ${esc(ast)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="${esc(tip)}"></div></div>
      </div>`;
    });
  const mins = Math.round(span / 60000);
  $('gantt').innerHTML = rows.join('') +
    `<div class="gaxis"><div></div><div><span>${mins > 0 ? T.minAgo(mins) : T.start}</span><span>${T.now}</span></div></div>`;
  // The pulse needs room: only bars wider than 24 px get it.
  for (const bar of $('gantt').querySelectorAll('.gbar')) if (bar.getBoundingClientRect().width > 24) bar.classList.add('pulse');
}

function renderFeed(s) {
  const byId = agentMap(s);
  const who = (id) => (id === 'user' ? T.you : id === 'system' ? T.system : id === 'main' ? 'Claude' : byId[id]?.label || id);
  const text = (e) => {
    const fn = T.text[e.kind];
    if (e.kind === 'agent_start') return fn(who(e.target), e.detail);
    if (e.kind === 'agent_done') return fn(who(e.actor));
    return fn ? fn(e.detail, e.actor, e.tool, e) : e.detail;
  };
  const events = s.events.filter((e) => showThinks || e.kind !== 'thinks').reverse();
  const fresh = Math.max(0, s.events.length - lastEventCount);
  lastEventCount = s.events.length;
  $('feed').innerHTML = events.slice(0, 150).map((e, i) => {
    const label = e.tool && !['read', 'edit', 'error', 'mcp'].includes(e.kind) ? e.tool : T.kind[e.kind] || e.kind;
    const showWho = e.kind !== 'agent_done';
    return `<li class="${esc(e.kind)}${i < fresh && fresh < 20 ? ' new' : ''}">
      <span class="t">${hhmm(e.ts)}</span>
      <span class="k ${esc(e.kind)}">${esc(label)}</span>
      <span class="x">${showWho ? `<span class="who">${esc(who(e.actor))}</span>` : ''}${esc(text(e))}</span>
    </li>`;
  }).join('');
}

function renderSide(s) {
  const byId = agentMap(s);
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
setInterval(() => { renderGantt(); renderSessions(); if (current) renderStatus(current); }, 1000);
applyStatic();
connect();
