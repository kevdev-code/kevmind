// Memory tab: what Claude Code and Serena remember about a project, problems first. Read-only: the one action
// is copying a fix prompt to paste into Claude Code. Loaded after app.js and uses its helpers ($, esc, T, fmtK,
// patchHTML, setText, wakeLive). Sections are rewritten only when their HTML changes, and polling stops while
// the tab is hidden.
const VIEW_KEY = 'kevmind.view';
const MEM_POLL_MS = 15_000;
let view = 'live';
let memProjects = [];
let memKey = null;
let memReport = null;
let memError = null;
let memTimer = null;
let memSg = null; // memory suggestions (src/suggest.js): the cards to show, and the applied ones with what happened since
let memTree = null; // the project map (src/tree.js): profile, areas, notes; fetched again only when it changed
let treeState = null; // { key, phase, ... } while a map is being built, from the server's SSE messages
const memOpen = new Set(); // rows whose details are expanded
const memPathsOpen = new Set(); // problem rows whose list of paths is expanded, kept across refreshes

const VIEWS = ['live', 'memory', 'brain'];
try { const v = localStorage.getItem(VIEW_KEY); if (VIEWS.includes(v) && !focus) view = v; } catch { /* storage unavailable */ }
if (VIEWS.includes(params.get('view')) && !focus) view = params.get('view');

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function setView(next) {
  view = next;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  document.body.classList.toggle('view-memory', view === 'memory');
  document.body.classList.toggle('view-brain', view === 'brain');
  $('memoryView').hidden = view !== 'memory';
  $('brainView').hidden = view !== 'brain';
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  pollMemory();
  if (view === 'live') wakeLive();
  window.brainShow?.(view === 'brain'); // brain.js: built when first shown, drawn only while shown
}

// Poll only while the Memory view is shown and the tab is visible.
function pollMemory() {
  clearInterval(memTimer);
  memTimer = null;
  if (view !== 'memory' || document.hidden) return;
  loadMemory();
  memTimer = setInterval(loadMemory, MEM_POLL_MS);
}
document.addEventListener('visibilitychange', pollMemory);

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
    const [res, tree, sg] = await Promise.all([
      fetch(`/api/memory/project?key=${encodeURIComponent(key)}`),
      fetch(`/api/tree?key=${encodeURIComponent(key)}&since=${memTree?.key === key ? memTree.at : ''}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/suggestions?key=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => null),
    ]);
    const body = await res.json();
    memError = res.ok ? null : body.error || String(res.status);
    if (res.ok && body.key === memKey) memReport = body;
    if (key === memKey) {
      if (tree && !tree.unchanged) memTree = tree.tree ? { ...tree.tree, key } : null;
      if (tree?.building && !treeState) treeState = { key, phase: 'code' };
      if (sg?.key === key) memSg = sg;
    }
  } catch (e) {
    memError = String(e.message || e);
  }
  renderMemoryView();
}

function selectMemProject(key) {
  if (key === memKey) return;
  memKey = key;
  memReport = null;
  memTree = null;
  memSg = null;
  memOpen.clear();
  memPathsOpen.clear();
  renderMemoryView();
  loadMemory();
}

for (const id of ['memProjectList', 'memOtherList']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) selectMemProject(b.dataset.key);
  });
}

// ---- rendering ----

const estTok = (n) => T.memTokens(fmtK(n || 0));
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fileName = (p) => String(p || '').split('/').pop();

function renderMemoryView() {
  if (view !== 'memory') return;
  const row = (p) => `<li><button type="button" data-key="${esc(p.key)}" aria-current="${p.key === memKey}" title="${esc(p.root)}">` +
    `<span class="name">${esc(p.name)}</span><span class="meta">${esc(p.root)}</span></button></li>`;
  const mine = memProjects.filter((p) => p.source === 'session');
  const others = memProjects.filter((p) => p.source !== 'session');
  patchHTML($('memProjectList'), mine.map(row).join(''));
  patchHTML($('memOtherList'), others.map(row).join(''));
  $('memOtherWrap').hidden = !others.length;
  setText($('memOtherCount'), others.length ? `(${others.length})` : '');
  if (others.some((p) => p.key === memKey)) $('memOtherWrap').open = true;
  $('memNoProjects').hidden = memProjects.length > 0;

  const r = memReport;
  const p = memProjects.find((x) => x.key === memKey);
  setText($('memName'), p ? p.name : '—');
  setText($('memRoot'), p ? p.root : '');
  setText($('memUpdated'), memError ? T.memError(memError) : r ? T.memUpdated(new Date(r.generatedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })) : p ? T.memLoading : '');
  renderTree();
  renderSuggestions();
  if (!r) {
    for (const id of ['memBudget', 'memProblems', 'memInstructions', 'memNotes', 'memSerena']) patchHTML($(id), '');
    setText($('memClaudeDir'), '');
    setText($('memSerenaDir'), '');
    return;
  }
  renderBudget(r);
  renderProblems(r);
  renderTables(r);
}

function renderBudget(r) {
  const total = r.startup.total || 1;
  const seg = (part) => `<i class="b-${esc(part.label)}" style="width:${((part.tokens / total) * 100).toFixed(2)}%" title="${esc(T.memPart[part.label])}: ${esc(estTok(part.tokens))}"></i>`;
  patchHTML($('memBudget'), `
    <div class="budget-line"><b>${esc(T.memStartup)}</b> <span>${esc(estTok(r.startup.total))}</span>
      <small>${esc(r.startup.observed ? T.memObserved : T.memInferred)}</small></div>
    <div class="bar">${r.startup.parts.filter((x) => x.tokens > 0).map(seg).join('')}</div>
    <div class="legend">${r.startup.parts.map((x) => `<span><i class="b-${esc(x.label)}"></i>${esc(T.memPart[x.label])} ${esc(fmtK(x.tokens))}</span>`).join('')}</div>`);
}

const SHARED = new Set(['inherits', 'nested_project']);
const TIERS = ['problem', 'warning', 'suggestion'];

// One row of counts, then only the issues that exist, worst first. Nothing found says so once.
function renderProblems(r) {
  const shared = r.problems.filter((p) => SHARED.has(p.code)).map((p) => `<li class="shared">
      <span class="txt">${esc(T.memInfo[p.code]({ ...p.params, file: p.file }))}</span>
      <button type="button" class="link" data-goto="${esc(p.params.key)}">${esc(T.memSee(p.params.project))}</button>
    </li>`).join('');
  const notes = r.problems.filter((p) => p.tier === 'info' && !SHARED.has(p.code))
    .map((p) => `<li class="note">${esc(T.memInfo[p.code]?.(p.params) || p.code)}</li>`).join('');
  const counts = Object.fromEntries(TIERS.map((t) => [t, r.problems.filter((p) => p.tier === t).length]));
  const tallies = `<div class="tallies">${TIERS.map((t) => `<span class="tally"><span class="dot ${t === 'problem' ? 'error' : t === 'warning' ? 'waiting' : 'suggestion'}"></span><b>${counts[t]}</b> ${esc(T.memTally[t](counts[t]))}</span>`).join('')}</div>`;
  const rows = TIERS.flatMap((tier) => r.problems.map((p, i) => ({ p, i })).filter(({ p }) => p.tier === tier).map(({ p, i }) => `<li class="${tier}">
      <div class="txt">${esc(T.memProblem[p.code]?.(p.params) || p.code)}<small>${esc(p.file || '')}</small>${pathList(p)}</div>
      ${p.fix ? `<button type="button" class="btn" data-fix="${i}">${esc(T.memCopyFix)}</button>` : ''}
    </li>`)).join('');
  const actionable = counts.problem + counts.warning;
  const all = actionable ? `<div class="fix-all"><button type="button" class="btn" data-fix-all>${esc(T.memCopyAll)}</button>
    <small>${esc(T.memCopyAllHint(actionable))}</small></div>` : '';
  const calm = !rows ? `<p class="calm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>${esc(T.memAllClear)}</p>` : '';
  patchHTML($('memProblems'), tallies + calm + all + `<ul class="issues">${shared}${rows}${notes}</ul>`);
}

// Every path behind a "missing" or "moved" row, with the lines it is cited on, so each can be checked.
function pathList(p) {
  const items = p.params?.items;
  if (!items?.length) return '';
  const key = `${p.code}|${p.file}`;
  return `<details class="paths" data-key="${esc(key)}"${memPathsOpen.has(key) ? ' open' : ''}>
    <summary>${esc(T.memShowPaths(items.length))}</summary>
    <ul>${items.map((it) => `<li><code>${esc(it.path)}</code> <span class="muted">${esc(T.memLines(it.lines))}</span>${
      it.to?.length ? ` <span class="moved">${esc(T.memMaybe)} ${it.to.map((t) => `<code>${esc(t)}</code>`).join(' · ')}</span>` : ''}</li>`).join('')}</ul>
  </details>`;
}

$('memProblems').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.paths');
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
  patchHTML($('memInstructions'), r.instructions.length ? table(
    [T.memCol.file, T.memCol.scope, T.memCol.loads, T.memCol.lines, T.memCol.tokens, T.memCol.observed, T.memCol.issues],
    r.instructions.map((i) => ({
      id: 'i:' + i.display,
      cells: [`<code>${esc(i.display)}</code>${i.importedBy ? `<small>${esc(T.memImportedBy(i.importedBy))}</small>` : ''}`,
        esc(T.memScope[i.scope] || i.scope), esc(T.memLoads[i.load] || i.load), i.lines, esc(fmtK(i.tokens)),
        i.observed ? T.memYes : '—', count(i.display)],
      detail: () => citesHtml(i.cites),
    })),
  ) : `<p class="empty">${esc(T.memNone)}</p>`);

  // Claude memory
  const m = r.memory;
  setText($('memClaudeDir'), m.display);
  const idx = m.index ? `<p class="mem-index"><code>MEMORY.md</code> ${esc(T.memIndexStats(m.index.lines, fmtK(m.index.tokens), m.index.entries))}${m.index.truncated ? ` <b class="warn">${esc(T.memTruncated)}</b>` : ''}</p>` : '';
  patchHTML($('memNotes'), !m.exists ? `<p class="empty">${esc(T.memNoAutoMemory)}</p>` : idx + table(
    [T.memCol.note, T.memCol.type, T.memCol.tokens, T.memCol.modified, T.memCol.links, T.memCol.lastRead, T.memCol.issues],
    m.notes.slice().sort((a, b) => (issues.get(b.display) || 0) - (issues.get(a.display) || 0) || a.title.localeCompare(b.title)).map((n) => ({
      id: 'm:' + n.display,
      cells: [`<span title="${esc(n.description)}">${esc(n.title)}</span><small>${esc(fileName(n.display))}</small>`,
        esc(T.memType[n.type] || n.type || '—'), esc(fmtK(n.tokens)), esc(dateOf(n.modified)),
        `${n.linksIn.length} / ${n.linksOut.length}`, n.lastRead ? esc(T.ago(secondsSince(n.lastRead))) : '—', count(n.display)],
      detail: () => noteDetail(n),
    })),
  ));

  // Serena
  const s = r.serena;
  setText($('memSerenaDir'), s.exists ? s.display : '');
  patchHTML($('memSerena'), !s.notes.length ? `<p class="empty">${esc(T.memNoSerena)}</p>` : table(
    [T.memCol.note, T.memCol.tokens, T.memCol.modified, T.memCol.links, T.memCol.issues],
    s.notes.map((n) => ({
      id: 's:' + n.display,
      cells: [esc(n.name), esc(fmtK(n.tokens)), esc(dateOf(n.modified)), `${n.linksIn.length} / ${n.linksOut.length}`, count(n.display)],
      detail: () => noteDetail(n),
    })),
  ));
}

// Memory suggestions: each card is one edit to a file Claude reads, with its evidence and the exact text, shown as a
// diff ("+" added, "−" removed, so not by color alone). The user applies it: "Copy text" copies the line, "Copy prompt"
// the same edit worded for Claude Code. Dismiss (or "Keep, it's history" for a note) goes to KevMind's own store.
// Applied ones list what happened since, measured on what they targeted.
const sgOpen = { more: false };
const ticks = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
function sgDiff(e) {
  const line = (sign, text, cls) => `<span class="${cls}"><span class="sg-sign" aria-hidden="true">${sign}</span>${esc(text)}</span>`;
  const pre = (lines) => `<pre class="sg-diff" aria-label="${esc(T.sgDiffLabel)}">${lines.join('\n')}</pre>`;
  // A new note is two edits: the note itself, and its line in MEMORY.md.
  if (e.op === 'note') return `<p class="sg-where"><code>${esc(e.file.split('/').pop())}</code></p>${pre(e.body.trim().split('\n').map((l) => line('+', l, 'ins')))}` +
    `<p class="sg-where"><code>MEMORY.md</code></p>${pre([line('+', e.index, 'ins')])}`;
  const out = [];
  if (e.op === 'add') out.push(line('+', e.text, 'ins'));
  else if (e.op === 'replace') out.push(line('−', e.old, 'del'), line('+', e.text, 'ins'));
  else if (e.op === 'remove') out.push(line('−', e.old, 'del'));
  else if (e.op === 'remove_range') out.push(line('−', T.sgSection(e.title, e.from, e.to), 'del'));
  else if (e.old) out.push(line(' ', e.old, 'ctx'));
  return out.length ? pre(out) : '';
}
function sgCard(s) {
  const e = s.edit, shared = document.body.classList.contains('shared');
  const copyable = e.text || e.op === 'note';
  return `<li class="sg" data-sg="${esc(s.id)}">
    <div class="sg-head"><b>${ticks(T.sgKind[s.why.code](s.why))}</b>${e.tokens ? `<span class="muted">${esc(T.sgTokens(e.tokens))}</span>` : ''}</div>
    <p class="sg-why">${ticks(T.sgWhy[s.why.code](s.why))}</p>
    <p class="sg-where">${ticks(T.sgWhere(e))}</p>
    ${sgDiff(e)}
    ${e.op === 'prompt' ? `<p class="sg-why">${esc(T.sgNoText)}</p>` : ''}
    ${s.history ? `<p class="sg-why">${esc(T.sgHistoryHint)}</p>` : ''}
    <div class="sg-actions">
      ${copyable ? `<button type="button" class="btn" data-sg-copy>${esc(T.sgCopyText)}</button>` : ''}
      <button type="button" class="btn${copyable ? '' : ' primary'}" data-sg-prompt>${esc(T.sgCopyPrompt)}</button>
      ${shared ? '' : `${s.history ? `<button type="button" class="btn" data-sg-dismiss="history">${esc(T.sgHistory)}</button>` : ''}<button type="button" class="btn link" data-sg-dismiss="dismissed">${esc(T.sgDismiss)}</button>`}
    </div>
  </li>`;
}
function renderSuggestions() {
  const el = $('memSuggest');
  const x = memSg?.key === memKey ? memSg : null;
  if (!x) { patchHTML(el, memKey ? `<p class="empty">${esc(T.memLoading)}</p>` : ''); return; }
  const calm = `<p class="calm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>${esc(T.sgNone)}</p>`;
  const more = x.more.length ? `<details class="sg-more"${sgOpen.more ? ' open' : ''}><summary>${esc(T.sgMore(x.more.length))}</summary><ul class="sg-list">${x.more.map(sgCard).join('')}</ul></details>` : '';
  const applied = x.applied.length ? `<h3 class="sg-h">${esc(T.sgApplied)}</h3><ul class="sg-applied">${x.applied.map((a) => `<li>
      <b>${ticks(T.sgKind[a.why.code](a.why))}</b> <span class="muted">${ticks(T.sgWhere(a.edit))} · ${esc(new Date(a.appliedAt).toLocaleDateString(lang, { day: 'numeric', month: 'short' }))}</span>
      <span class="sg-status">${esc(T.sgOutcome(a.kind, a.outcome))}</span></li>`).join('')}</ul><p class="muted">${esc(T.sgCorrelation)}</p>` : '';
  const dismissed = x.dismissed ? `<p class="muted">${esc(T.sgDismissed(x.dismissed))}</p>` : '';
  patchHTML(el, `${x.shown.length ? `<ul class="sg-list">${x.shown.map(sgCard).join('')}</ul>` : calm}${more}${applied}${dismissed}`);
}
$('memSuggest').addEventListener('toggle', (e) => { if (e.target.matches?.('details.sg-more')) sgOpen.more = e.target.open; }, true);
$('memSuggest').addEventListener('click', async (e) => {
  const card = e.target.closest('li[data-sg]');
  const s = card && memSg && [...memSg.shown, ...memSg.more].find((x) => x.id === card.dataset.sg);
  if (!s) return;
  const b = e.target.closest('button');
  if (b?.hasAttribute('data-sg-copy')) await copyText(b, s.edit.op === 'note' ? `${s.edit.body}\n${s.edit.index}\n` : s.edit.text, T.sgCopyText);
  else if (b?.hasAttribute('data-sg-prompt')) await copyText(b, s.prompt, T.sgCopyPrompt);
  else if (b?.dataset.sgDismiss) {
    b.disabled = true;
    try {
      const r = await fetch('/api/suggestions/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: s.id, reason: b.dataset.sgDismiss }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      memSg = { ...memSg, shown: memSg.shown.filter((x) => x.id !== s.id), more: memSg.more.filter((x) => x.id !== s.id), dismissed: memSg.dismissed + 1 };
      renderSuggestions();
      loadMemory();
    } catch { b.disabled = false; b.textContent = T.memCopyFailed; }
  }
});

// The project map (src/tree.js): a short profile, then the areas (folders) by recent activity, each with what the
// code, git, Claude sessions and the notes say about it, every fact under its source. Built by the server; the
// button rebuilds it now (not on a shared screen).
const treeOpen = new Set(); // areas expanded, by name
const TREE_FILES = 12; // files listed per area, busiest first
function renderTree() {
  const el = $('memTree');
  const t = memTree?.key === memKey ? memTree : null;
  const shared = document.body.classList.contains('shared');
  const st = treeState?.key === memKey ? treeState : null;
  const status = st ? `<span class="muted" role="status">${esc(T.treeBuilding(st))}</span>`
    : t ? `<span class="muted">${esc(T.treeBuilt(new Date(t.at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), t.ms))}</span>` : '';
  const button = shared ? '' : `<button type="button" class="btn" id="treeBuild"${st ? ' disabled' : ''}>${esc(t ? T.treeRebuild : T.treeBuild)}</button>`;
  const top = `<div class="exp-switch">${button}${status}</div>`;
  if (!t) { patchHTML(el, `${top}<p class="empty">${esc(memKey ? T.treeNone : '')}</p>`); return; }
  const p = t.profile, day = (ts) => new Date(ts).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const src = (k) => `<b class="src">${esc(T.treeSrc[k])}</b>`;
  const profile = `<ul class="tree-profile">${T.treeProfile(p, p.since ? day(p.since) : null).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  const areas = t.areas.map((a, k) => ({ a, k })).sort((x, y) => y.a.git.n90 - x.a.git.n90 || y.a.git.commits - x.a.git.commits || x.a.name.localeCompare(y.a.name));
  const rows = areas.map(({ a }) => {
    const notes = a.notes.map((j) => t.docs[j]);
    const files = [...a.files].sort((x, y) => (y.git?.n90 || 0) - (x.git?.n90 || 0) || (y.git?.n || 0) - (x.git?.n || 0) || x.f.localeCompare(y.f)).slice(0, TREE_FILES);
    const fileRow = (f) => `<li><code>${esc(f.f.split('/').pop())}</code><small>${esc([
      f.git && `${T.treeSrc.git}: ${T.treeFileGit(f.git.n, f.git.fix, f.git.last ? day(f.git.last) : '')}`,
      f.claude && `${T.treeSrc.claude}: ${T.treeFileClaude(f.claude.read, f.claude.edit)}`,
    ].filter(Boolean).join(' · '))}</small></li>`;
    const open = treeOpen.has(a.name);
    return `<li><details data-area="${esc(a.name)}"${open ? ' open' : ''}><summary><code>${esc(a.name)}</code> <span class="muted">${esc(T.treeAreaMeta(a.files.length, a.git.n90, a.git.fixes, notes.length, a.git.dormant))}</span></summary>
      <p>${src('git')} ${esc(T.treeAreaGit(a.git.commits, a.git.fixes, a.git.last ? day(a.git.last) : null, t.months))}</p>
      ${a.claude.read || a.claude.edit || a.claude.failures.length ? `<p>${src('claude')} ${esc(T.treeAreaClaude(a.claude.read, a.claude.edit, a.claude.failures.map((x) => x.fam)))}</p>` : ''}
      <p>${src('notes')} ${notes.length ? notes.map((d) => `<code title="${esc(d.id)}">${esc(d.label || d.id)}</code>`).join(', ') : esc(T.treeNoNotes)}</p>
      <ul class="exp-list tree-files">${files.map(fileRow).join('')}</ul>
      ${a.files.length > files.length ? `<p class="muted">${esc(T.treeMoreFiles(a.files.length - files.length))}</p>` : ''}</details></li>`;
  }).join('');
  patchHTML(el, `${top}${profile}<ul class="tree-areas">${rows}</ul>`);
}
$('memTree').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details[data-area]');
  if (!d) return;
  if (d.open) treeOpen.add(d.dataset.area); else treeOpen.delete(d.dataset.area);
}, true);
$('memTree').addEventListener('click', async (e) => {
  if (!e.target.closest('#treeBuild') || !memKey) return;
  const key = memKey;
  treeState = { key, phase: 'code' };
  renderTree();
  try {
    const r = await fetch('/api/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    treeState = null;
  } catch (err) { treeState = { key, phase: 'error', error: err.message }; }
  if (key === memKey) memTree = null; // fetched again, in full
  loadMemory();
});
// Progress of a build, from the server: each phase, then done (or an error). When done, the map is fetched again.
window.onTree = (msg) => {
  treeState = msg.phase === 'done' ? null : msg;
  if (msg.phase === 'done' && msg.key === memKey && view === 'memory' && !document.hidden) loadMemory();
  else if (view === 'memory') renderTree();
};

// A table whose rows expand to show metadata, headings, links and cited files (never the note's body).
// Rows are focusable and open with Enter or Space as well as a click.
function table(head, rows) {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => {
    const open = memOpen.has(row.id);
    return `<tr class="mem-row${open ? ' open' : ''}" data-row="${esc(row.id)}" tabindex="0" aria-expanded="${open}">${row.cells.map((c) => `<td>${c}</td>`).join('')}</tr>` +
      (open ? `<tr class="mem-detail"><td colspan="${head.length}">${row.detail()}</td></tr>` : '');
  }).join('')}</tbody></table>`;
}

function toggleRow(tr) {
  const rowId = tr.dataset.row;
  if (memOpen.has(rowId)) memOpen.delete(rowId); else memOpen.add(rowId);
  renderTables(memReport);
  document.querySelector(`tr[data-row="${CSS.escape(rowId)}"]`)?.focus();
}
for (const id of ['memInstructions', 'memNotes', 'memSerena']) {
  $(id).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-row]');
    if (tr) toggleRow(tr);
  });
  $(id).addEventListener('keydown', (e) => {
    const tr = e.target.closest?.('tr[data-row]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleRow(tr); }
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

if (focus) $('viewGroup').hidden = true;
setView(view);
