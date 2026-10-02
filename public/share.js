// "View on phone": the header button, the "Shared on your network" indicator and the panel with the link and QR code.
// Sharing itself lives on the server (src/share.js); this page only asks it to start, stop or make a new link, which
// only works from this PC. On a shared device (a phone) the page is read-only: a badge, and no sharing controls.
import qrcode from './vendor/qrcode.mjs';

let share = { on: false, url: null, viewers: 0, error: null };
let busy = false;
let copied = '';
const panel = $('sharePanel');

// The link as an SVG QR code: dark modules on white, with the quiet zone, whatever the theme.
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), Q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + Q} ${r + Q}h1v1h-1z`;
  return `<svg class="share-qr" viewBox="0 0 ${n + 2 * Q} ${n + 2 * Q}" role="img" aria-label="${esc(T.shareQrLabel)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const FIREWALL = (port) => `New-NetFirewallRule -DisplayName "KevMind (phone, private networks)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Private`;

function render() {
  setHidden($('shareOn'), !share.on);
  setHidden($('shareButton'), share.on); // while on, the indicator opens the panel
  const body = $('shareBody');
  if (!panel.open) return;
  if (!share.on) {
    const err = share.error ? `<p class="share-err" role="alert">${esc(T.shareError[share.error] || T.shareError.other(share.error))}</p>` : '';
    patchHTML(body, `<p class="share-text">${esc(T.shareIntro)}</p>${err}
      <div class="share-actions"><button type="button" class="btn primary" id="shareStart" ${busy ? 'disabled' : ''}>${esc(busy ? T.shareStarting : T.shareStart)}</button></div>`);
    return;
  }
  const port = new URL(share.url).port || '80';
  patchHTML(body, `<p class="share-status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/><circle cx="12" cy="12" r="2"/></svg><b>${esc(T.shareOn)}</b><span class="muted">· ${esc(T.shareViewers(share.viewers))}</span></p>
    <p class="share-text">${esc(T.shareScan)}</p>
    ${qrSvg(share.url)}
    <div class="share-link"><code id="shareUrl">${esc(share.url)}</code><button type="button" class="btn" data-copy="url">${esc(copied === 'url' ? T.shareCopied : T.shareCopy)}</button></div>
    <div class="share-actions">
      <button type="button" class="btn" id="shareNew" title="${esc(T.shareNewHint)}">${esc(T.shareNew)}</button>
      <button type="button" class="btn" id="shareStop">${esc(T.shareStop)}</button>
    </div>
    <p class="muted share-note">${esc(T.shareNewHint)} ${esc(T.shareReadonlyNote)}</p>
    <details class="share-help">
      <summary>${esc(T.shareHelpTitle)}</summary>
      <ol>
        <li>${esc(T.shareHelp1)}</li>
        <li>${T.shareHelp2}<div class="share-cmd"><code>${esc(FIREWALL(port))}</code><button type="button" class="btn" data-copy="fw">${esc(copied === 'fw' ? T.shareCopied : T.shareCopy)}</button></div></li>
        <li>${esc(T.shareHelp3)}</li>
      </ol>
    </details>`);
}

async function call(path, body) {
  busy = true; render();
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) share = await r.json();
  } finally { busy = false; render(); }
}

function open() {
  if (!panel.open) panel.showModal();
  render();
}
$('shareButton').addEventListener('click', open);
$('shareOnOpen').addEventListener('click', open);
$('shareOnStop').addEventListener('click', () => call('/api/share', { on: false }));
$('shareClose').addEventListener('click', () => panel.close());
panel.addEventListener('click', (e) => {
  if (e.target === panel) return panel.close(); // a click on the backdrop
  const id = e.target.closest('button')?.id, copy = e.target.closest('[data-copy]')?.dataset.copy;
  if (id === 'shareStart') call('/api/share', { on: true });
  if (id === 'shareStop') call('/api/share', { on: false });
  if (id === 'shareNew') call('/api/share/regenerate', {});
  if (copy) {
    navigator.clipboard?.writeText(copy === 'url' ? share.url : FIREWALL(new URL(share.url).port || '80')).then(() => {
      copied = copy; render();
      setTimeout(() => { copied = ''; render(); }, 1500);
    });
  }
});

// Live updates (on, off, a new link, a phone came or went) arrive on this PC's stream; language changes re-render.
window.onShare = (s) => { share = s; render(); };
window.renderShare = () => { applyShareLabels(); render(); };
function applyShareLabels() {
  $('shareClose').setAttribute('aria-label', T.shareClose);
  $('shareButton').title = T.shareButtonTitle;
}

// Who is this page? On a shared device: read-only. On this PC: the current sharing state.
fetch('/api/health').then((r) => r.json()).then((h) => {
  if (h.shared) {
    document.body.classList.add('shared');
    setHidden($('readonlyBadge'), false);
    $('readonlyBadge').title = T.shareReadonlyTitle;
    if (typeof renderMemoryView === 'function') renderMemoryView();
    return;
  }
  if (h.share) { share = h.share; render(); }
}).catch(() => {});
applyShareLabels();
