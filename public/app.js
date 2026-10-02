// KevMind dashboard: listens to /stream (SSE) and renders the selected session.
// Cheap by design: SSE messages only update state and ask for one animation frame; a frame renders what changed;
// rows are kept and updated in place (only changed text is written); nothing renders while the tab is hidden,
// and the page catches up when it is shown again. The tab title and favicon still follow "needs your OK".
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WINDOW_MS = 15 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const FEED_MAX = 150;
const ALERTS_SHOWN = 3;
const LANG_KEY = 'kevmind.lang';
const THINKS_KEY = 'kevmind.thinks';
const PROJECT_KEY = 'kevmind.project';
const THEME_KEY = 'kevmind.theme';
const params = new URLSearchParams(location.search);
// ?focus=latest: no session list, always the most recently started session of the chosen project.
const focus = params.get('focus') === 'latest';
if (focus) document.body.classList.add('focus');

// Writes that skip the DOM when nothing changed: the 1 s tick and every frame go through these.
const setText = (el, v) => { v = String(v ?? ''); if (el._t !== v) { el._t = v; el.textContent = v; } };
const setClass = (el, v) => { if (el._c !== v) { el._c = v; el.className = v; } };
// A stat tile: the number and, next to it, its word in the singular or plural the number asks for.
const stat = (id, n, word) => { setText($(id), n); setText($(id).nextElementSibling, word(n)); };
const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
const setHidden = (el, h) => { if (el.hidden !== h) el.hidden = h; };
const patchHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };

let sessions = [];
let current = null;      // full summary of the selected session
let selectedId = null;
let pinned = false;      // true when the user picked a session manually
let connected = null;
let bootId = null;       // server boot id from the first "hello"; a different one means the server restarted
// ?project=Name for this page load, else the remembered choice, else all projects.
let projectFilter = params.get('project') || '';
if (!projectFilter) { try { projectFilter = localStorage.getItem(PROJECT_KEY) || ''; } catch { /* storage unavailable */ } }
let projectOptions = '';  // the option set last rendered, so an open dropdown isn't rebuilt under the mouse
let alertsOpen = false;
const visibleSessions = () => (projectFilter ? sessions.filter((s) => s.project === projectFilter) : sessions);
const newestVisible = () => visibleSessions().slice().sort((a, b) => b.startedAt - a.startedAt)[0];
$('projectFilter').addEventListener('change', (e) => {
  projectFilter = e.target.value;
  try { localStorage.setItem(PROJECT_KEY, projectFilter); } catch { /* ignore */ }
  pinned = false;
  const visible = visibleSessions();
  if (!visible.some((s) => s.id === selectedId)) { selectedId = null; current = null; clearSession(); }
  schedule();
  if (!selectedId && visible[0]) select(visible[0].id, false);
});
let showThinks = true;   // feed toggle for "thinks" events
try { showThinks = localStorage.getItem(THINKS_KEY) !== '0'; } catch { /* storage unavailable */ }
$('showThinks').checked = showThinks;
$('showThinks').addEventListener('change', (e) => {
  showThinks = e.target.checked;
  try { localStorage.setItem(THINKS_KEY, showThinks ? '1' : '0'); } catch { /* ignore */ }
  schedule();
});

// ---------- theme: system / dark / light, remembered per browser ----------
let theme = 'system';
try { theme = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* storage unavailable */ }
function applyTheme() {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme; else root.removeAttribute('data-theme');
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme)));
}
document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
  theme = b.dataset.themeSet;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  applyTheme();
}));

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
  schedule();
  updateAttention();
  if (typeof renderMemoryView === 'function') renderMemoryView();
  window.renderShare?.();
  window.brainLang?.();
}

function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = T[el.dataset.i18nHtml]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  document.querySelectorAll('[data-theme-set]').forEach((b) => { b.title = T.theme[b.dataset.themeSet]; b.setAttribute('aria-label', T.theme[b.dataset.themeSet]); });
  $('viewGroup').setAttribute('aria-label', T.viewGroup);
  $('themeGroup').setAttribute('aria-label', T.themeGroup);
  $('langGroup').setAttribute('aria-label', T.langGroup);
  $('projectFilter').setAttribute('aria-label', T.projectFilter);
  projectOptions = ''; // the option labels change with the language
  if (connected !== null) setConn(connected);
}

document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- rendering is batched: one frame for any number of messages ----------
let frame = 0;
let dirty = false;
const liveVisible = () => !document.hidden && !document.body.classList.contains('view-memory') && !document.body.classList.contains('view-brain');
function schedule() {
  dirty = true;
  if (!frame && liveVisible()) frame = requestAnimationFrame(flush);
}
function flush() {
  frame = 0;
  if (!dirty || !liveVisible()) return; // stays dirty: wakeLive() renders it when the page is shown again
  dirty = false;
  renderSessions();
  renderSession();
}
// Called when the Live view or the tab becomes visible again: catch up once.
function wakeLive() { schedule(); startTick(); }

let tickTimer = 0;
function startTick() { if (!tickTimer && !document.hidden) tickTimer = setInterval(tick, 1000); }
function stopTick() { clearInterval(tickTimer); tickTimer = 0; }
// Relative times, staleness and live bars. Only writes text that changed; when nothing runs, nothing changes.
function tick() {
  if (!liveVisible()) return;
  renderSessions();
  if (current) { renderNow(current); renderGantt(); }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTick();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  } else {
    wakeLive();
  }
});

// ---------- data ----------
function connect() {
  const es = new EventSource('/stream');
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'reload') return location.reload();
    if (msg.type === 'share') return window.onShare?.(msg.share); // View on phone (share.js); this PC's pages only
    if (msg.type === 'hello') {
      if (bootId && msg.bootId !== bootId) return location.reload();
      bootId = msg.bootId;
    }
    sessions = msg.sessions || sessions;
    updateAttention();
    const shown = (s) => !projectFilter || s.project === projectFilter;
    if (focus) {
      const newest = newestVisible();
      if (newest && newest.id !== selectedId) {
        if (msg.type === 'session' && msg.session.id === newest.id) { selectedId = newest.id; current = msg.session; }
        else return select(newest.id, false);
      } else if (msg.type === 'session' && msg.session.id === selectedId) current = msg.session;
    } else if (msg.type === 'session' && shown(msg.session) && (!pinned || msg.session.id === selectedId)) {
      selectedId = msg.session.id;
      current = msg.session;
    }
    const first = visibleSessions()[0];
    if (!selectedId && first) return select(first.id, false);
    window.brainFollow?.(); // the Brain tab follows the selected session (brain.js)
    schedule();
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
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (r.ok) current = await r.json();
  window.brainFollow?.();
  schedule();
}

// ---------- "needs your OK" from another tab: title and favicon, no sound, no notifications ----------
const favicon = $('favicon');
const FAVICON = favicon.getAttribute('href');
const FAVICON_WAIT = FAVICON.replace('</svg>', "<circle cx='25' cy='7' r='6.5' fill='%23f2a93b' stroke='white' stroke-width='2'/></svg>");
let attentionTimer = 0;
function updateAttention() {
  const waiting = sessions.filter((s) => sessionStatus(s) === 'waiting');
  const title = waiting.length ? `⏸ ${T.needsOk} · KevMind` : 'KevMind';
  if (document.title !== title) document.title = title;
  const href = waiting.length ? FAVICON_WAIT : FAVICON;
  if (favicon.getAttribute('href') !== href) favicon.setAttribute('href', href);
  // A waiting session goes idle after 5 min without events: clear the marker then, with one timeout, not a poll.
  clearTimeout(attentionTimer);
  if (waiting.length) attentionTimer = setTimeout(updateAttention, Math.max(1000, Math.min(...waiting.map((s) => s.lastAt + STALE_MS - Date.now())) + 500));
}

// ---------- formatting ----------
const secondsSince = (ts) => Math.max(0, Math.round((Date.now() - ts) / 1000));
// Intl formatters are costly to build: one per language, reused.
const fmtCache = {};
const timeFmt = () => (fmtCache[lang] ||= {
  s: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
  m: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
});
const hhmmss = (ts) => timeFmt().s.format(ts);
const hhmm = (ts) => timeFmt().m.format(ts);
const dayFmt = () => (fmtCache['d' + lang] ||= new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }));
// A start time today reads "08:12"; on another day "30 sep 22:10".
const startOf = (ts, today = new Date().toDateString()) => (new Date(ts).toDateString() === today ? hhmm(ts) : `${dayFmt().format(ts)} ${hhmm(ts)}`);
const fmtMin = (m) => { m = Math.max(0, Math.round(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
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
const isLive = (st) => st === 'running' || st === 'working';

// ---------- sessions: grouped by project, keyed buttons updated in place ----------
// Groups are ordered by their latest activity. The selected session's project opens by itself (and stays open
// until you close it); closed sessions older than 2 h fold under "Show closed (N)" inside their group.
const sessionRows = new Map();  // session id -> row
const groupEls = new Map();     // project -> group
const groupOpen = new Map();    // project -> open, once decided (by you, or by selecting one of its sessions)
const closedOpen = new Set();   // projects whose closed sessions are shown
function sessionRow(id) {
  const li = document.createElement('li');
  li.innerHTML = '<button type="button"><span class="dot"></span><span class="name"></span><span class="meta"></span></button>';
  const btn = li.firstChild;
  btn.dataset.id = id;
  return { li, btn, dot: btn.children[0], name: btn.children[1], meta: btn.children[2] };
}
function sessionGroup(project) {
  const li = document.createElement('li');
  li.className = 'group';
  li.innerHTML = '<button type="button" class="ghead"><span class="chev" aria-hidden="true"></span><span class="gname"></span><span class="count"></span></button>' +
    '<ul class="list"></ul><button type="button" class="more gclosed"></button><ul class="list"></ul>';
  const [head, list, closedBtn, closedList] = li.children;
  head.dataset.group = project;
  closedBtn.dataset.closed = project;
  return { li, head, name: head.children[1], count: head.children[2], list, closedBtn, closedList };
}
// Rows in this order inside ul: moves only what is out of place.
function placeRows(ul, rows) {
  let prev = null;
  for (const r of rows) {
    const want = prev ? prev.nextSibling : ul.firstChild;
    if (r.li !== want) ul.insertBefore(r.li, want);
    prev = r.li;
  }
}
// Where a session goes in its group: shown; folded under "Show closed" (closed over 2 h ago, or one that never got
// going but did call a tool); or skipped (never got going and did nothing: no prompt, no title, at most 3 events,
// no tool call, no edit). A working or waiting session is always shown.
function sessionFold(s, st, now) {
  if (st === 'working' || st === 'waiting') return 'show';
  const quiet = !s.title && !s.firstPrompt && (s.events ?? Infinity) <= 3;
  if (quiet) return (s.toolCalls || 0) + (s.edits || 0) > 0 ? 'closed' : 'skip';
  return st === 'ended' && now - s.lastAt > 2 * 60 * 60 * 1000 ? 'closed' : 'show';
}
const sessionTitle = (s) => s.title || (s.firstPrompt ? (s.firstPrompt.length > 42 ? s.firstPrompt.slice(0, 40).trimEnd() + '…' : s.firstPrompt) : T.noTitle);
function renderSessions() {
  const names = [...new Set(sessions.map((s) => s.project))].sort((a, b) => a.localeCompare(b));
  if (projectFilter && !names.includes(projectFilter)) names.push(projectFilter);
  const options = `<option value="">${esc(T.allProjects)}</option>` +
    names.map((n) => `<option value="${esc(n)}"${n === projectFilter ? ' selected' : ''}>${esc(n)}</option>`).join('');
  if (options !== projectOptions) { $('projectFilter').innerHTML = options; projectOptions = options; }
  const visible = visibleSessions();
  setHidden($('noSessions'), visible.length > 0);
  if (!visible.length) patchHTML($('noSessions'), sessions.length ? esc(T.noProjectSessions) : T.noSessions);
  const now = Date.now();
  const today = new Date(now).toDateString();
  const byProject = new Map();
  for (const s of visible) {
    const st = sessionStatus(s);
    const fold = s.id === selectedId ? 'show' : sessionFold(s, st, now);
    if (fold === 'skip') continue; // never did anything: not listed, not counted
    (byProject.get(s.project) || byProject.set(s.project, []).get(s.project)).push({ s, st, fold });
  }
  const latest = (list) => Math.max(...list.map((x) => x.s.lastAt));
  const groups = [...byProject].sort((a, b) => latest(b[1]) - latest(a[1]));
  const selProject = (current?.id === selectedId ? current?.project : null) || sessions.find((s) => s.id === selectedId)?.project;
  if (selProject && !groupOpen.has(selProject)) groupOpen.set(selProject, true);
  const root = $('sessionList');
  const seenGroups = new Set();
  const seenRows = new Set();
  let prevGroup = null;
  for (const [project, list] of groups) {
    let g = groupEls.get(project);
    if (!g) { g = sessionGroup(project); groupEls.set(project, g); }
    seenGroups.add(project);
    const open = groupOpen.get(project) === true;
    setAttr(g.head, 'aria-expanded', String(open));
    setText(g.name, project);
    const recent = [];
    const closed = [];
    for (const { s, st, fold } of list) {
      let r = sessionRows.get(s.id);
      if (!r) { r = sessionRow(s.id); sessionRows.set(s.id, r); }
      seenRows.add(s.id);
      const live = st === 'working' || st === 'waiting';
      setClass(r.dot, 'dot ' + st);
      setText(r.name, sessionTitle(s));
      // Start and duration change at most once a minute; the status word only for sessions that need a look.
      const dur = fmtMin(((live ? now : s.lastAt) - s.startedAt) / 60000);
      const startKey = `${lang}|${today}|${s.startedAt}`; // the start label changes only with the language or at midnight
      if (r.startKey !== startKey) { r.startKey = startKey; r.start = startOf(s.startedAt, today); }
      setText(r.meta, `${live ? (T.status[st] || st) + ' · ' : ''}${r.start} · ${dur}`);
      setAttr(r.btn, 'aria-current', String(s.id === selectedId));
      const tip = `${s.title || s.firstPrompt || T.noTitle}\n${T.status[st] || st} · ${s.cwd || ''}`;
      if (r.btn.title !== tip) r.btn.title = tip;
      (fold === 'closed' ? closed : recent).push(r);
    }
    setText(g.count, recent.length); // what the group shows; the folded ones are counted in "Show closed (N)"
    placeRows(g.list, recent);
    placeRows(g.closedList, closed);
    const showClosed = closedOpen.has(project);
    setHidden(g.list, !open);
    setHidden(g.closedBtn, !open || !closed.length);
    setText(g.closedBtn, showClosed ? T.hideClosed : T.showClosed(closed.length));
    setAttr(g.closedBtn, 'aria-expanded', String(showClosed));
    setHidden(g.closedList, !open || !showClosed || !closed.length);
    const want = prevGroup ? prevGroup.nextSibling : root.firstChild;
    if (g.li !== want) root.insertBefore(g.li, want);
    prevGroup = g.li;
  }
  for (const [id, r] of sessionRows) if (!seenRows.has(id)) { r.li.remove(); sessionRows.delete(id); }
  for (const [p, g] of groupEls) if (!seenGroups.has(p)) { g.li.remove(); groupEls.delete(p); }
}
$('sessionList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.id) return select(b.dataset.id);
  if (b.dataset.group !== undefined) groupOpen.set(b.dataset.group, b.getAttribute('aria-expanded') !== 'true');
  if (b.dataset.closed !== undefined) { if (closedOpen.has(b.dataset.closed)) closedOpen.delete(b.dataset.closed); else closedOpen.add(b.dataset.closed); }
  renderSessions();
});

function renderSession() {
  const s = current;
  if (!s) return;
  renderNow(s);
  renderGantt();
  renderFeed(s);
  renderSide(s);
}

// Nothing to show for the chosen project: blank the panels rather than leave another project on screen.
function clearSession() {
  setText($('nowProject'), '—');
  setText($('nowPath'), '');
  setHidden($('nowLoading'), true);
  setHidden($('nowAsk'), true);
  setText($('nowStatusText'), '—');
  setClass($('nowStatus'), 'status');
  setClass($('nowDot'), 'dot');
  setClass($('now'), 'panel now');
  stat('stAgents', 0, T.activeAgents); stat('stActions', 0, T.actions); stat('stPrompts', 0, T.messages);
  setText($('stTime'), '0 min');
  for (const id of ['stTokens', 'stCache']) { setText($(id), '—'); setClass($(id), 'none'); }
  for (const id of ['gantt', 'feed', 'alerts', 'files', 'tools']) patchHTML($(id), '');
  ganttRows.clear();
  feedRows.clear();
  feedSig = '';
  setHidden($('noAlerts'), false);
  setHidden($('alertCount'), true);
  setHidden($('alertsMore'), true);
}

// ---------- now: status first ----------
function renderNow(s) {
  const st = sessionStatus(s);
  setText($('nowStatusText'), T.status[st] || st);
  setClass($('nowStatus'), 'status ' + st);
  setClass($('nowDot'), 'dot ' + st);
  setClass($('now'), st === 'waiting' ? 'panel now waiting' : 'panel now');
  setText($('nowProject'), s.project);
  setText($('nowPath'), s.model ? `${s.cwd} · ${s.model}` : s.cwd);
  setHidden($('nowLoading'), !s.loading);
  // What Claude is asking for, and for how long: the last "waiting" event.
  let ask = null;
  if (st === 'waiting') for (let i = s.events.length - 1; i >= 0; i--) if (s.events[i].kind === 'waiting') { ask = s.events[i]; break; }
  setHidden($('nowAsk'), st !== 'waiting');
  if (st === 'waiting') {
    setText($('nowAskText'), ask?.detail || T.askTitle);
    setText($('nowAskAgo'), `· ${T.ago(secondsSince(ask?.ts || s.lastAt))}`);
  }
  stat('stAgents', s.agents.filter((a) => isLive(agentStatus(a, s))).length, T.activeAgents);
  stat('stActions', s.agents.reduce((n, a) => n + a.actions, 0), T.actions);
  stat('stPrompts', s.prompts, T.messages);
  setText($('stTime'), fmtMin(((isLive(st) || st === 'waiting' ? Date.now() : s.lastAt) - s.startedAt) / 60000));
  const t = s.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const known = t.input || t.output || t.cacheRead || t.cacheWrite;
  setText($('stTokens'), known ? `${fmtK(t.input)} / ${fmtK(t.output)}` : '—');
  setText($('stCache'), known ? `${fmtK(t.cacheRead)} / ${fmtK(t.cacheWrite)}` : '—');
  setClass($('stTokens'), known ? '' : 'none');
  setClass($('stCache'), known ? '' : 'none');
  const tip = known ? tokensTip(t) : '';
  if ($('stTokens').title !== tip) { $('stTokens').title = tip; $('stCache').title = tip; }
}

// ---------- agents timeline: keyed rows; bars move by clip-path (repaint, no layout) ----------
const ganttRows = new Map();
function ganttRow() {
  const el = document.createElement('div');
  el.className = 'grow';
  el.innerHTML = '<div class="glabel"><span class="ty"><span class="dot"></span><span></span></span><span class="task"></span></div>' +
    '<div class="gtrack"><div class="gbar"></div></div><span class="gnum"><span class="gst"></span><span></span></span>';
  const [label, track, num] = el.children;
  return { el, dot: label.children[0].children[0], ty: label.children[0].children[1], task: label.children[1], label,
    bar: track.children[0], st: num.children[0], n: num.children[1] };
}
function renderGantt() {
  const s = current;
  if (!s) return;
  const st = sessionStatus(s);
  const live = (a) => (a.id === 'main' ? st === 'working' || st === 'waiting' : isLive(agentStatus(a, s)));
  const anyLive = s.agents.some(live);
  // When nothing runs, "now" stops at the last activity: the bars stand still and an idle page does no work.
  const now = anyLive ? Date.now() : Math.max(s.lastAt, ...s.agents.map((a) => a.endedAt || 0));
  const endOf = (a) => (live(a) ? now : Math.min(a.endedAt || now, now));
  // Zoom to the subagents: from their earliest start (the session start if there are none) with 10 % padding,
  // never more than 15 min back, never narrower than 60 s.
  const subs = s.agents.filter((a) => a.id !== 'main');
  const first = subs.length ? Math.min(...subs.map((a) => a.startedAt)) : s.startedAt;
  const from = Math.min(Math.max(first - (now - first) * 0.1, now - WINDOW_MS), now - 60_000);
  const span = Math.max(1, now - from);
  const list = $('gantt');
  const seen = new Set();
  let prev = null;
  for (const a of s.agents) {
    if (a.id !== 'main' && endOf(a) < from) continue;
    let r = ganttRows.get(a.id);
    if (!r) { r = ganttRow(); ganttRows.set(a.id, r); }
    seen.add(a.id);
    const ast = a.id === 'main' ? st : agentStatus(a, s);
    const isMain = a.id === 'main';
    setClass(r.dot, 'dot ' + ast);
    setText(r.ty, isMain ? 'Claude' : a.type || a.label);
    setText(r.task, isMain ? T.mainSession : a.description || a.label);
    setText(r.st, isMain ? T.status[ast] || ast : T.agentWord[ast] || ast);
    setText(r.n, T.actionsN(a.actions));
    const tip = (a.description || a.label) + (a.tokens && (a.tokens.input || a.tokens.output) ? '\n' + tokensTip(a.tokens) : '');
    if (r.label.title !== tip) r.label.title = tip;
    const start = Math.max(a.startedAt, from);
    const end = Math.max(start, endOf(a));
    const left = ((start - from) / span) * 100;
    const right = 100 - Math.max(left + 0.6, Math.min(100, ((end - from) / span) * 100)); // at least a sliver
    setClass(r.bar, 'gbar ' + ast);
    const clip = `inset(0 ${right.toFixed(2)}% 0 ${left.toFixed(2)}% round 4px)`;
    if (r.bar._clip !== clip) { r.bar._clip = clip; r.bar.style.clipPath = clip; }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (r.el !== want) list.insertBefore(r.el, want);
    prev = r.el;
  }
  for (const [id, r] of ganttRows) if (!seen.has(id)) { r.el.remove(); ganttRows.delete(id); }
  const mins = Math.round(span / 60000);
  setText($('ganttFrom'), mins > 0 ? T.minAgo(mins) : T.start);
  setText($('ganttNow'), anyLive ? T.now : hhmm(now));
}

// ---------- activity feed: rows keyed by event number; new ones are added, old ones dropped ----------
const feedRows = new Map(); // seq -> li
let feedSig = '';
let lastFeedAdd = 0;
const PATHY = new Set(['read', 'edit', 'command', 'web', 'mcp', 'tool']);
function feedRow(e, s, byId) {
  // Agents by type in the feed (the timeline shows their task); the full label is on hover.
  const who = (id) => (id === 'user' ? T.you : id === 'system' ? T.system : id === 'main' ? 'Claude' : byId[id]?.type || byId[id]?.label || id);
  const full = (id) => byId[id]?.label || '';
  const fn = T.text[e.kind];
  const text = e.kind === 'agent_start' ? fn(who(e.target), e.detail) : e.kind === 'agent_done' ? fn(who(e.actor)) : fn ? fn(e.detail, e.actor, e.tool, e) : e.detail;
  const label = e.tool && !['read', 'edit', 'error', 'mcp'].includes(e.kind) ? toolName(e.tool) : T.kind[e.kind] || e.kind;
  const body = PATHY.has(e.kind) && !fn ? `<code>${esc(text)}</code>` : esc(text);
  const li = document.createElement('li');
  li.className = e.kind;
  li.innerHTML = `<span class="t">${hhmmss(e.ts)}</span><span class="k ${esc(e.kind)}">${esc(label)}</span>` +
    `<span class="x">${e.kind !== 'agent_done' ? `<span class="who" title="${esc(full(e.actor))}">${esc(who(e.actor))}</span>` : ''}${body}</span>`;
  li._time = li.firstChild;
  return li;
}
function renderFeed(s) {
  const byId = agentMap(s);
  // Row text depends on the language, the thinking toggle and agent names: when one changes, rebuild once.
  const sig = `${s.id}|${lang}|${showThinks}|${s.agents.map((a) => a.id + ':' + a.label).join(',')}`;
  const list = $('feed');
  if (sig !== feedSig) { feedSig = sig; feedRows.clear(); list.textContent = ''; }
  const events = [];
  for (let i = s.events.length - 1; i >= 0 && events.length < FEED_MAX; i--) {
    const e = s.events[i];
    if (showThinks || e.kind !== 'thinks') events.push(e);
  }
  // Rows added after the first render fade in, but only when events come at a calm pace: in a burst every
  // frame would be animating, which says nothing and costs a repaint per frame.
  const now = Date.now();
  const fade = list.firstChild !== null && now - lastFeedAdd > 1200;
  let added = 0;
  const keep = new Set();
  let node = list.firstChild;
  let prevTime = null;
  for (const e of events) {
    const key = e.seq ?? `${e.ts}|${e.kind}|${e.actor}|${e.detail}`;
    keep.add(key);
    let li = feedRows.get(key);
    if (!li) {
      li = feedRow(e, s, byId);
      if (fade && added < 20) li.classList.add('new');
      added++;
      feedRows.set(key, li);
    }
    if (li !== node) list.insertBefore(li, node); else node = node.nextSibling;
    // A time is printed only when it changes from the row above.
    const time = li._time.textContent;
    setClass(li._time, time === prevTime ? 't same' : 't');
    prevTime = time;
  }
  for (const [key, li] of feedRows) if (!keep.has(key)) { li.remove(); feedRows.delete(key); }
  if (added) lastFeedAdd = now;
}

// File names, with just enough of the parent path to tell apart files that share a name:
// "src/memory.js" and "mcp/memory.js", but plain "app.js" when it is the only one.
function shortPaths(paths) {
  const parts = paths.map((p) => String(p).split(/[\\/]/).filter(Boolean));
  const names = parts.map((p) => p[p.length - 1] || '');
  for (let k = 2; ; k++) {
    const seen = new Map();
    names.forEach((n, i) => (seen.get(n) || seen.set(n, []).get(n)).push(i));
    let grew = false;
    for (const same of seen.values()) {
      if (same.length < 2) continue;
      for (const i of same) if (parts[i].length >= k) { names[i] = parts[i].slice(-k).join('/'); grew = true; }
    }
    if (!grew) return names;
  }
}

// ---------- right rail: rewritten only when its HTML changes ----------
const WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
function renderSide(s) {
  const byId = agentMap(s);
  const name = (id) => (id === 'main' ? 'Claude' : byId[id]?.type || byId[id]?.label || id);
  // The same two agents on the same file make one row with a count; newest first.
  const groups = new Map();
  for (const a of s.alerts) {
    const pair = [name(a.a), name(a.b)];
    const key = `${a.kind}|${a.file}|${[a.a, a.b].sort().join('|')}`;
    const g = groups.get(key) || { ...a, pair, n: 0, last: 0 };
    g.n++;
    g.last = Math.max(g.last, a.ts);
    groups.set(key, g);
  }
  const all = [...groups.values()].sort((x, y) => y.last - x.last);
  const shown = alertsOpen ? all : all.slice(0, ALERTS_SHOWN);
  patchHTML($('alerts'), shown.map((g) => `<li>${WARN_ICON}<div><b>${esc(T.conflictTitle)}</b>${g.n > 1 ? `<span class="count">×${g.n}</span>` : ''}` +
    `<code>${esc(g.file)}</code><small>${esc(T.conflictWho(g.pair[0], g.pair[1], hhmm(g.last)))}</small></div></li>`).join(''));
  setHidden($('noAlerts'), all.length > 0);
  setHidden($('alertCount'), !all.length);
  setText($('alertCount'), all.length);
  setHidden($('alertsMore'), all.length <= ALERTS_SHOWN);
  setText($('alertsMore'), alertsOpen ? T.showFewer : T.showAll(all.length));

  const files = s.files.slice().sort((a, b) => (b.edits * 3 + b.reads) - (a.edits * 3 + a.reads)).slice(0, 8);
  const max = Math.max(1, ...files.map((f) => f.reads + f.edits));
  const labels = shortPaths(files.map((f) => f.path));
  patchHTML($('files'), files.map((f, i) => `<li title="${esc(f.path)}"><span class="fn">${esc(labels[i])}</span>` +
    `<span class="fc">${esc(T.fileStats(f.reads, f.edits))}</span><span class="fbar"><i class="r" style="width:${((f.reads / max) * 100).toFixed(1)}%"></i>` +
    `<i class="e" style="width:${((f.edits / max) * 100).toFixed(1)}%"></i></span></li>`).join('') || `<li class="empty">${esc(T.nothingYet)}</li>`);

  const tools = s.tools.slice().sort((a, b) => b.count - a.count).slice(0, 10);
  patchHTML($('tools'), tools.map((t) => `<tr><td title="${esc(t.name)}">${esc(toolName(t.name))}</td><td>${t.count}</td>` +
    `<td class="${t.errors ? 'err' : ''}">${t.errors}</td><td>${t.timed ? fmtMs(t.totalMs / t.timed) : '—'}</td></tr>`).join(''));
}
$('alertsMore').addEventListener('click', () => { alertsOpen = !alertsOpen; if (current) renderSide(current); });

applyTheme();
applyStatic();
startTick();
connect();
