// Memory tab: what Claude Code and Serena remember about a project, problems first. Read-only: the one action
// is copying a fix prompt to paste into Claude Code. Loaded after app.js and uses its helpers ($, esc, T, fmtK).
const VIEW_KEY = 'kevmind.view';
const MEM_POLL_MS = 15_000;
let view = 'live';
let memProjects = [];
let memKey = null;
let memReport = null;
let memExp = null; // the Experience panel's data: what the MCP tools would serve, and how calls went
let expToggleError = null; // why the last on/off change failed, if it did
let memError = null;
let memTimer = null;
const memOpen = new Set(); // rows whose details are expanded
const memPathsOpen = new Set(); // problem rows whose list of paths is expanded, kept across refreshes

try { if (localStorage.getItem(VIEW_KEY) === 'memory' && !focus) view = 'memory'; } catch { /* storage unavailable */ }
if (params.get('view') === 'memory' && !focus) view = 'memory';

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function setView(next) {
  view = next;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  document.body.classList.toggle('view-memory', view === 'memory');
  $('memoryView').hidden = view !== 'memory';
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  clearInterval(memTimer);
  if (view === 'memory') {
    loadMemory();
    memTimer = setInterval(loadMemory, MEM_POLL_MS);
  }
}

async function loadMemory() {
  try {
    memProjects = (await (await fetch('/api/memory')).json()).projects || [];
    if (!memProjects.some((p) => p.key === memKey)) {
      // The live view's project filter, then the selected session's project, then the most recent one.
      const pick = memProjects.find((p) => p.name === projectFilter) || memProjects.find((p) => p.name === current?.project) || memProjects[0];
      memKey = pick ? pick.key : null;
      memReport = null;
    }
    renderMemoryView();
    if (!memKey) return;
    const key = memKey;
    const [res, exp] = await Promise.all([
      fetch(`/api/memory/project?key=${encodeURIComponent(key)}`),
      fetch(`/api/experience?key=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => null),
    ]);
    const body = await res.json();
    memError = res.ok ? null : body.error || String(res.status);
    if (res.ok && body.key === memKey) memReport = body;
    if (key === memKey) memExp = exp;
  } catch (e) {
    memError = String(e.message || e);
  }
  renderMemoryView();
}

function selectMemProject(key) {
  if (key === memKey) return;
  memKey = key;
  memReport = null;
  memExp = null;
  memOpen.clear();
  memPathsOpen.clear();
  renderMemoryView();
  loadMemory();
}

for (const id of ['memProjectList', 'memOtherList']) {
  $(id).addEventListener('click', (e) => {
    const li = e.target.closest('li[data-key]');
    if (li) selectMemProject(li.dataset.key);
  });
}

// ---- rendering ----

const estTok = (n) => T.memTokens(fmtK(n || 0));
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fileName = (p) => String(p || '').split('/').pop();

function renderMemoryView() {
  if (view !== 'memory') return;
  const row = (p) => `<li data-key="${esc(p.key)}" class="${p.key === memKey ? 'sel' : ''}" title="${esc(p.root)}"><span class="sname">${esc(p.name)}</span><span class="smeta">${esc(p.root)}</span></li>`;
  const mine = memProjects.filter((p) => p.source === 'session');
  const others = memProjects.filter((p) => p.source !== 'session');
  $('memProjectList').innerHTML = mine.map(row).join('');
  $('memOtherList').innerHTML = others.map(row).join('');
  $('memOtherWrap').hidden = !others.length;
  $('memOtherCount').textContent = others.length ? `(${others.length})` : '';
  if (others.some((p) => p.key === memKey)) $('memOtherWrap').open = true;
  $('memNoProjects').hidden = memProjects.length > 0;

  const r = memReport;
  const p = memProjects.find((x) => x.key === memKey);
  $('memName').textContent = p ? p.name : '—';
  $('memRoot').textContent = p ? p.root : '';
  $('memUpdated').textContent = memError ? T.memError(memError) : r ? T.memUpdated(new Date(r.generatedAt).toLocaleTimeString(lang, { hourCycle: 'h23' })) : p ? T.memLoading : '';
  renderExperience(memExp);
  if (!r) {
    for (const id of ['memBudget', 'memProblems', 'memInstructions', 'memNotes', 'memSerena']) $(id).innerHTML = '';
    $('memClaudeDir').textContent = '';
    $('memSerenaDir').textContent = '';
    return;
  }
  renderBudget(r);
  renderProblems(r);
  renderTables(r);
}

function renderBudget(r) {
  const total = r.startup.total || 1;
  const seg = (part) => `<i class="b-${esc(part.label)}" style="width:${(part.tokens / total) * 100}%" title="${esc(T.memPart[part.label])}: ${esc(estTok(part.tokens))}"></i>`;
  $('memBudget').innerHTML = `
    <div class="budget-head"><b>${esc(T.memStartup)}</b> <span>${esc(estTok(r.startup.total))}</span>
      <small>${esc(r.startup.observed ? T.memObserved : T.memInferred)}</small></div>
    <div class="budget-bar">${r.startup.parts.filter((x) => x.tokens > 0).map(seg).join('')}</div>
    <div class="budget-legend">${r.startup.parts.map((x) => `<span><i class="b-${esc(x.label)}"></i>${esc(T.memPart[x.label])} ${esc(fmtK(x.tokens))}</span>`).join('')}</div>`;
}

const SHARED = new Set(['inherits', 'nested_project']);

function renderProblems(r) {
  const tiers = ['problem', 'warning', 'suggestion'];
  // Files shared with another project: one line each, with a way to go where their issues are listed.
  const shared = r.problems.filter((p) => SHARED.has(p.code)).map((p) => `<li class="mem-shared">
      <span>${esc(T.memInfo[p.code]({ ...p.params, file: p.file }))}</span>
      <button type="button" class="link" data-goto="${esc(p.params.key)}">${esc(T.memSee(p.params.project))}</button>
    </li>`).join('');
  const info = r.problems.filter((p) => p.tier === 'info' && !SHARED.has(p.code));
  const html = tiers.map((tier) => {
    const list = r.problems.map((p, i) => ({ p, i })).filter(({ p }) => p.tier === tier);
    const notes = tier === 'suggestion' ? info.map((p) => `<li class="mem-info">${esc(T.memInfo[p.code]?.(p.params) || p.code)}</li>`).join('') : '';
    const rows = list.map(({ p, i }) => `<li class="mem-issue ${tier}">
        <div class="mem-issue-text">${esc(T.memProblem[p.code]?.(p.params) || p.code)}<small>${esc(p.file || '')}</small>${pathList(p)}</div>
        ${p.fix ? `<button type="button" class="copy-fix" data-fix="${i}">${esc(T.memCopyFix)}</button>` : ''}
      </li>`).join('');
    return `<section class="mem-group">
      <h3 class="tier ${tier}">${esc(T.memTier[tier])} <small>${list.length}</small></h3>
      <ul>${rows || `<li class="mem-none">${esc(T.memNoneTier)}</li>`}${notes}</ul>
    </section>`;
  }).join('');
  const actionable = r.problems.filter((p) => p.tier === 'problem' || p.tier === 'warning').length;
  const all = actionable ? `<div class="mem-fix-all"><button type="button" class="copy-fix" data-fix-all>${esc(T.memCopyAll)}</button>
    <small>${esc(T.memCopyAllHint(actionable))}</small></div>` : '';
  $('memProblems').innerHTML = all + (shared ? `<ul class="mem-shared-list">${shared}</ul>` : '') + html;
}

// Every path behind a "missing" or "moved" row, with the lines it is cited on, so each can be checked.
function pathList(p) {
  const items = p.params?.items;
  if (!items?.length) return '';
  const key = `${p.code}|${p.file}`;
  return `<details class="mem-paths" data-key="${esc(key)}"${memPathsOpen.has(key) ? ' open' : ''}>
    <summary>${esc(T.memShowPaths(items.length))}</summary>
    <ul>${items.map((it) => `<li><code>${esc(it.path)}</code> <span class="muted">${esc(T.memLines(it.lines))}</span>${
      it.to?.length ? ` <span class="moved">${esc(T.memMaybe)} ${it.to.map((t) => `<code>${esc(t)}</code>`).join(' · ')}</span>` : ''}</li>`).join('')}</ul>
  </details>`;
}

$('memProblems').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.mem-paths');
  if (!d) return;
  if (d.open) memPathsOpen.add(d.dataset.key); else memPathsOpen.delete(d.dataset.key);
}, true);

const FIX_ALL_INTRO = 'Fix these memory and instruction issues. For each one, check the current code first; if a cited path moved, update it; ' +
  'if it was deleted on purpose and the note still has value, rewrite the line to say so in past tense; if the note is obsolete, tell me before deleting it.';

// One prompt for every problem and warning of the project (not suggestions), grouped by file. Always English,
// like the single-row prompts. Rows that list paths become one item per path, with the lines it is cited on.
function fixAllPrompt(r) {
  const byFile = new Map();
  for (const p of r.problems.filter((x) => x.tier === 'problem' || x.tier === 'warning')) {
    const items = byFile.get(p.file) || [];
    if (p.code === 'cited_file_missing') {
      for (const it of p.params.items) {
        items.push(`- Line${it.lines.length > 1 ? 's' : ''} ${it.lines.join(', ')}: \`${it.path}\` exists nowhere in the workspace (working tree or default branch). Find where it lives now and update the path, or rewrite the passage if the code was removed on purpose.`);
      }
    } else {
      const line = p.params?.line ? `Line ${p.params.line}: ` : '';
      items.push(`- ${line}${p.fix.replace(/\s*\n\s*/g, ' ')}`);
    }
    byFile.set(p.file, items);
  }
  const sections = [...byFile].map(([file, items]) => `## ${file}\n${items.join('\n')}`);
  return `${FIX_ALL_INTRO}\n\nProject root: ${r.root.replace(/\\/g, '/')} (paths starting with ~ are in your home folder).\n\n${sections.join('\n\n')}\n`;
}

$('memProblems').addEventListener('click', async (e) => {
  const go = e.target.closest('button[data-goto]');
  if (go) { selectMemProject(go.dataset.goto); return; }
  const all = e.target.closest('button[data-fix-all]');
  if (all && memReport) { await copyText(all, fixAllPrompt(memReport), T.memCopyAll); return; }
  const b = e.target.closest('button[data-fix]');
  if (!b || !memReport) return;
  const text = memReport.problems[Number(b.dataset.fix)]?.fix;
  if (text) await copyText(b, text, T.memCopyFix);
});

async function copyText(b, text, label) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea'); // older browsers, or a page without clipboard permission
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  b.textContent = ok ? T.memCopied : T.memCopyFailed;
  b.classList.toggle('done', ok);
  setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1600);
}

function renderTables(r) {
  const issues = new Map();
  for (const p of r.problems) if (p.file && p.tier !== 'info') issues.set(p.file, (issues.get(p.file) || 0) + 1);
  const count = (file) => issues.get(file) ? `<span class="issue-count">${issues.get(file)}</span>` : '';

  // Instructions
  $('memInstructions').innerHTML = r.instructions.length ? table(
    [T.memCol.file, T.memCol.scope, T.memCol.loads, T.memCol.lines, T.memCol.tokens, T.memCol.observed, T.memCol.issues],
    r.instructions.map((i) => ({
      id: 'i:' + i.display,
      cells: [`<code>${esc(i.display)}</code>${i.importedBy ? `<small>${esc(T.memImportedBy(i.importedBy))}</small>` : ''}`,
        esc(T.memScope[i.scope] || i.scope), esc(T.memLoads[i.load] || i.load), i.lines, esc(fmtK(i.tokens)),
        i.observed ? T.memYes : '—', count(i.display)],
      detail: () => citesHtml(i.cites),
    })),
  ) : `<p class="empty small">${esc(T.memNone)}</p>`;

  // Claude memory
  const m = r.memory;
  $('memClaudeDir').textContent = m.display;
  const idx = m.index ? `<p class="mem-index"><code>MEMORY.md</code> ${esc(T.memIndexStats(m.index.lines, fmtK(m.index.tokens), m.index.entries))}${m.index.truncated ? ` <b class="warn">${esc(T.memTruncated)}</b>` : ''}</p>` : '';
  $('memNotes').innerHTML = !m.exists ? `<p class="empty small">${esc(T.memNoAutoMemory)}</p>` : idx + table(
    [T.memCol.note, T.memCol.type, T.memCol.tokens, T.memCol.modified, T.memCol.links, T.memCol.lastRead, T.memCol.issues],
    m.notes.slice().sort((a, b) => (issues.get(b.display) || 0) - (issues.get(a.display) || 0) || a.title.localeCompare(b.title)).map((n) => ({
      id: 'm:' + n.display,
      cells: [`<span title="${esc(n.description)}">${esc(n.title)}</span><small>${esc(fileName(n.display))}</small>`,
        esc(T.memType[n.type] || n.type || '—'), esc(fmtK(n.tokens)), esc(dateOf(n.modified)),
        `${n.linksIn.length} / ${n.linksOut.length}`, n.lastRead ? esc(T.ago(secondsSince(n.lastRead))) : '—', count(n.display)],
      detail: () => noteDetail(n),
    })),
  );

  // Serena
  const s = r.serena;
  $('memSerenaDir').textContent = s.exists ? s.display : '';
  $('memSerena').innerHTML = !s.notes.length ? `<p class="empty small">${esc(T.memNoSerena)}</p>` : table(
    [T.memCol.note, T.memCol.tokens, T.memCol.modified, T.memCol.links, T.memCol.issues],
    s.notes.map((n) => ({
      id: 's:' + n.display,
      cells: [esc(n.name), esc(fmtK(n.tokens)), esc(dateOf(n.modified)), `${n.linksIn.length} / ${n.linksOut.length}`, count(n.display)],
      detail: () => noteDetail(n),
    })),
  );
}

// What the experience tools would tell Claude about this project today, and whether calls help. Shown whether
// or not the tools are on, so it's clear when turning them on is worth it.
function renderExperience(x) {
  const el = $('memExperience');
  if (!x) { el.innerHTML = ''; return; }
  const t = x.tools || { on: false, source: 'default' };
  const toggle = `<div class="exp-switch">
      <label><input type="checkbox" id="expToggle"${t.on ? ' checked' : ''}> <b>${esc(T.expToggle)}</b></label>
      <span class="muted">${esc(T.expSource[t.source] || '')} · ${esc(T.expNextSession)}</span>
      ${expToggleError ? `<span class="exp-err">${esc(T.expToggleError(expToggleError))}</span>` : ''}
    </div>`;
  if (!x.known) { el.innerHTML = `${toggle}<p class="empty small">${esc(T.expUnknown)}</p>`; return; }
  const { gate, coChange, readFirst, failures, hotspots } = x.preview;
  const th = x.thresholds;
  const m = x.measure;
  const ok = (b) => `<b class="${b ? 'ok' : 'off'}">${esc(b ? T.expMet : T.expNotYet)}</b>`;
  const list = (items, fn) => (items.length ? `<ul class="exp-list">${items.map((i) => `<li>${fn(i)}</li>`).join('')}</ul>` : `<p class="empty small">${esc(T.expNone)}</p>`);
  const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  el.innerHTML = `${toggle}
    <div class="exp-gate">
      <div>${esc(T.expEpisodes(gate.episodes, gate.days))} ${ok(x.preview.episodePairs > 0)}</div>
      ${x.preview.episodePairs ? '' : `<div class="muted">${esc(x.preview.nearest
        ? T.expNearest(x.preview.nearest.a, x.preview.nearest.b, x.preview.nearest.n, x.preview.nearest.days, th.coEditEpisodes, th.minDays)
        : T.expNoEpisodes(th.coEditEpisodes, th.minDays))}</div>`}
      <div>${esc(T.expCommits(gate.commits, th.minGitCommits))} ${ok(gate.gitOk)}</div>
      <p class="muted">${esc(T.expHowTo)}</p>
    </div>
    <h3 class="exp-h">${esc(T.expWouldServe)}</h3>
    <div class="exp-grid">
      <section><h4>${esc(T.expCoChange)}</h4>${list(coChange, (p) => `<code>${esc(p.a)}</code> + <code>${esc(p.b)}</code><small>${esc([p.s && T.expByEpisodes(p.s.n, p.s.days, p.s.last), p.g && T.expByGit(p.g.n, p.g.of, p.g.last)].filter(Boolean).join(' · '))}</small>`)}</section>
      <section><h4>${esc(T.expReadFirst)}</h4>${list(readFirst, (p) => `<code>${esc(p.first)}</code> → <code>${esc(p.file)}</code><small>${esc(T.expByEpisodes(p.n, p.days))}</small>`)}</section>
      <section><h4>${esc(T.expFailures)}</h4>${list(failures, (f) => `<code>${esc(f.fam)}</code> ${esc(f.sig)}<small>${esc(T.expFix(f.episodes, f.days, f.fix.n, f.fix.name))}</small>`)}</section>
      <section><h4>${esc(T.expHotspots)}</h4>${list(hotspots, (h) => `<code>${esc(h.file)}</code><small>${esc(T.expHot(h.changes, h.fixes))}</small>`)}</section>
    </div>
    <h3 class="exp-h">${esc(T.expUse)}</h3>
    <div class="stats exp-stats">
      <div><b>${m.calls}</b><span>${esc(T.expCalls)}</span></div>
      <div><b>${esc(fmtK(m.tokens))}</b><span>${esc(T.expTokens)}</span></div>
      <div><b>${m.calls ? pct(m.noData / m.calls) : '—'}</b><span>${esc(T.expNoData)}</span></div>
      <div><b>${pct(m.followRate)}</b><span>${esc(T.expFollow(m.withSuggestions))}</span></div>
      <div><b>${pct(m.baseline)}</b><span>${esc(T.expBaseline(m.baselineSample))}</span></div>
    </div>
    <p class="muted">${esc(T.expVerdict[m.verdict])}</p>
    ${m.last.length ? `<ul class="exp-list">${m.last.map((c) => `<li><code>${esc(c.tool)}</code> ${esc(new Date(c.ts).toLocaleString(lang))} · ≈ ${c.tokens} tok${c.noData ? ` · ${esc(T.expNoDataShort)}` : ''}${
      c.followed === null ? '' : ` · ${esc(c.followed ? T.expFollowed : T.expIgnored)}`}<small>${esc(c.suggested.join(', '))}</small></li>`).join('')}</ul>` : ''}`;
}

// The on/off switch writes KevMind's own ~/.kevmind/config.json through the server (not Claude's settings).
$('memExperience').addEventListener('change', async (e) => {
  if (e.target.id !== 'expToggle') return;
  try {
    const r = await fetch('/api/tools', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: e.target.checked }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (memExp) memExp.tools = await r.json();
    expToggleError = null;
  } catch (err) {
    expToggleError = err.message;
  }
  renderExperience(memExp);
});

// A table whose rows expand to show metadata, headings, links and cited files (never the note's body).
function table(head, rows) {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => {
    const open = memOpen.has(row.id);
    return `<tr class="mem-row${open ? ' open' : ''}" data-row="${esc(row.id)}">${row.cells.map((c) => `<td>${c}</td>`).join('')}</tr>` +
      (open ? `<tr class="mem-detail"><td colspan="${head.length}">${row.detail()}</td></tr>` : '');
  }).join('')}</tbody></table>`;
}

for (const id of ['memInstructions', 'memNotes', 'memSerena']) {
  $(id).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-row]');
    if (!tr) return;
    const rowId = tr.dataset.row;
    if (memOpen.has(rowId)) memOpen.delete(rowId); else memOpen.add(rowId);
    renderTables(memReport);
  });
}

function noteDetail(n) {
  const list = (items, cls = '') => (items.length ? `<ul class="${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<span class="muted">—</span>`);
  return `<dl class="mem-dl">
    ${n.description ? `<dt>${esc(T.memDetail.description)}</dt><dd>${esc(n.description)}</dd>` : ''}
    <dt>${esc(T.memDetail.file)}</dt><dd><code>${esc(n.display)}</code> · ${esc(estTok(n.tokens))}</dd>
    <dt>${esc(T.memDetail.headings)}</dt><dd>${list(n.headings)}</dd>
    <dt>${esc(T.memDetail.linksOut)}</dt><dd>${list(n.linksOut.map(fileName))}</dd>
    <dt>${esc(T.memDetail.linksIn)}</dt><dd>${list(n.linksIn.map(fileName))}</dd>
    <dt>${esc(T.memDetail.cites)}</dt><dd>${citesHtml(n.cites)}</dd>
  </dl>`;
}

function citesHtml(cites) {
  if (!cites || !cites.length) return `<span class="muted">${esc(T.memDetail.noCites)}</span>`;
  const flag = (v) => (v === true ? T.memYes : v === false ? T.memNo : '?');
  return `<table class="cites"><thead><tr><th>${esc(T.memDetail.path)}</th><th>${esc(T.memDetail.working)}</th><th>${esc(T.memDetail.branch)}</th></tr></thead><tbody>${
    cites.map((c) => `<tr class="${c.working === false && c.branch !== true ? 'missing' : ''}"><td><code>${esc(c.path)}</code></td><td>${esc(flag(c.working))}</td><td>${esc(flag(c.branch))}</td></tr>`).join('')
  }</tbody></table>`;
}

if (focus) document.querySelector('.views').hidden = true;
setView(view);
