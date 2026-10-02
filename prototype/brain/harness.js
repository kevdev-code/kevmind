// The dashboard's Brain view (public/brain/view.js) on synthetic data (data.js): for the benchmark (bench/run.mjs)
// and for checks at a known size, where real data would be whatever the machine happens to hold. It mounts the same
// view the dashboard does and plays a replay of one working session in a loop.
// ?nodes=3000 (the stress case), ?speed=2, ?nointro, ?noreplay, ?light, ?bloom=off|light|full|only, ?skip=layers, ?shell=n.
import { mountBrain } from '../../public/brain/view.js';
import { makeGraph, makeReplay } from './data.js';

const params = new URLSearchParams(location.search);
const TARGET = Number(params.get('nodes')) || 0;
const SPEED = Number(params.get('speed')) || 1;
const lang = (() => { try { return localStorage.getItem('kevmind.lang'); } catch { return null; } })() === 'es' ? 'es' : 'en';
const W = {
  en: { tag: 'Benchmark harness · synthetic data', box: 'Harness', synthetic: 'synthetic data', nodes: 'Nodes', pause: 'Pause replay', play: 'Resume replay', step: (i, n) => `event ${i} of ${n}` },
  es: { tag: 'Banco de pruebas · datos sintéticos', box: 'Banco de pruebas', synthetic: 'datos sintéticos', nodes: 'Nodos', pause: 'Pausar reproducción', play: 'Reanudar reproducción', step: (i, n) => `evento ${i} de ${n}` },
}[lang];
document.documentElement.lang = lang;
document.getElementById('harnessTag').textContent = W.tag;

const graph = makeGraph({ target: TARGET });
const replay = makeReplay(graph);
const defs = new Map(replay.agents.map((a) => [a.id, a]));
const brain = mountBrain(document.getElementById('brainView'), {
  graph, strings: () => window.I18N[lang].brain, lang: () => lang, project: replay.project,
  options: { skip: (params.get('skip') || '').split(',').filter(Boolean), shell: params.get('shell'), light: params.has('light'), bloom: params.get('bloom'), intro: params.has('nointro') ? false : undefined },
  onReady: () => setTimeout(startReplay, 0), // once the intro is over (or skipped)
});
window.__brain = Object.assign(brain.debug, { hide: brain.hide, show: brain.show, event: brain.onEvent });
window.__graph = graph; // for scripted moves in screenshots

// The harness's own controls, at the end of the rail.
document.getElementById('filters').insertAdjacentHTML('beforeend', `<section>
  <h2 class="head">${W.box} <small>${W.synthetic}</small></h2>
  <div class="row"><button type="button" class="btn" id="replayBtn"></button><span class="muted" id="replayClock"></span></div>
  <div class="row"><span class="muted">${W.nodes}</span><div class="seg" role="group" id="sizeGroup"><button type="button" data-size="0">~600</button><button type="button" data-size="3000">~3,000</button></div></div>
</section>`);
for (const b of document.getElementById('sizeGroup').children) {
  b.setAttribute('aria-pressed', String(Number(b.dataset.size) === TARGET || (!TARGET && b.dataset.size === '0')));
  b.addEventListener('click', () => { const u = new URL(location.href); if (b.dataset.size === '0') u.searchParams.delete('nodes'); else u.searchParams.set('nodes', b.dataset.size); location.href = u; });
}

// The replay: each event at its time, then a pause, then again.
const rp = { t0: performance.now(), idx: 0, paused: false, pausedAt: 0, timer: 0 };
function renderReplay() {
  document.getElementById('replayBtn').textContent = rp.paused ? W.play : W.pause;
  document.getElementById('replayClock').textContent = W.step(rp.idx, replay.events.length);
}
function nextEvent() {
  clearTimeout(rp.timer);
  if (rp.paused) return;
  const elapsed = (performance.now() - rp.t0) * SPEED;
  const ev = replay.events[rp.idx];
  if (!ev) { rp.timer = setTimeout(restartReplay, Math.max(0, (replay.length - elapsed) / SPEED)); return; }
  rp.timer = setTimeout(() => { brain.onEvent({ ...ev, def: defs.get(ev.agent) }); rp.idx++; renderReplay(); nextEvent(); }, Math.max(0, (ev.at - elapsed) / SPEED));
}
function startReplay() {
  if (params.has('noreplay')) return;
  rp.t0 = performance.now(); rp.idx = 0;
  nextEvent();
}
function restartReplay() {
  brain.reset();
  rp.t0 = performance.now(); rp.idx = 0;
  renderReplay();
  nextEvent();
}
document.getElementById('replayBtn').addEventListener('click', () => {
  rp.paused = !rp.paused;
  if (rp.paused) rp.pausedAt = performance.now();
  else { rp.t0 += performance.now() - rp.pausedAt; nextEvent(); }
  renderReplay();
});
renderReplay();
