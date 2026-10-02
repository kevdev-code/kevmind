// The dashboard's Brain view (public/brain/view.js) on synthetic data (data.js): for the benchmark (bench/run.mjs)
// and for checks at a known size, where real data would be whatever the machine happens to hold. It mounts the same
// view the dashboard does and plays a replay of one working session in a loop.
// ?nodes=3000 (the stress case), ?speed=2, ?nointro, ?noreplay, ?light, ?bloom=off|light|full|only, ?skip=layers, ?shell=n.
// ?actions: instead of the replay, each action's figure in turn (the ten of the legend), to look at them one by one.
// ?sessions: three sessions in three projects working at once, with the switch between the selected one and all.
import { mountBrain } from '../../public/brain/view.js';
import { makeGraph, makeReplay, makeSessions } from './data.js';

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
const MULTI = params.has('sessions');
const replay = MULTI ? makeSessions(graph) : makeReplay(graph);
// An event's agent definition: per session with ?sessions.
const defs = MULTI ? new Map(Object.entries(replay.agents).flatMap(([sid, list]) => list.map((a) => [`${sid}/${a.id}`, a])))
  : new Map(replay.agents.map((a) => [a.id, a]));
const defOf = (ev) => defs.get(ev.session ? `${ev.session}/${ev.agent}` : ev.agent);
// "All live sessions" or only the first one, as the dashboard's switch does; another session waiting for the OK is
// then named under the panel.
let mode = 'all';
const waitingElsewhere = new Map();
function showSessions() {
  brain.reset();
  waitingElsewhere.clear();
  brain.setOthers([]);
  if (mode === 'all') for (const s of replay.sessions) brain.setSession(s);
  else brain.setSession({ project: replay.sessions[0].project });
  brain.setMode(mode);
}
function play(ev) {
  if (!MULTI) return brain.onEvent({ ...ev, def: defOf(ev) });
  if (mode === 'all') return brain.onEvent({ ...ev, def: defOf(ev) });
  if (ev.session === replay.sessions[0].id) return brain.onEvent({ ...ev, session: undefined, def: defOf(ev) });
  if (ev.agent !== 'main') return;
  const s = replay.sessions.find((x) => x.id === ev.session);
  if (ev.kind === 'wait') waitingElsewhere.set(s.id, { id: s.id, project: s.project, title: s.title });
  else waitingElsewhere.delete(s.id);
  brain.setOthers([...waitingElsewhere.values()]);
}
const brain = mountBrain(document.getElementById('brainView'), {
  graph, strings: () => window.I18N[lang].brain, lang: () => lang, project: MULTI ? replay.sessions[0].project : replay.project,
  onMode: MULTI ? (m) => { mode = m; restartReplay(); } : undefined,
  options: { skip: (params.get('skip') || '').split(',').filter(Boolean), shell: params.get('shell'), light: params.has('light'), bloom: params.get('bloom'), intro: params.has('nointro') ? false : undefined },
  onReady: () => setTimeout(params.has('actions') ? startActions : startReplay, 0), // once the intro is over (or skipped)
});
window.__brain = Object.assign(brain.debug, { hide: brain.hide, show: brain.show, event: brain.onEvent, seed: brain.seed, reset: brain.reset, born: brain.born, setWaiting: brain.setWaiting,
  setSession: brain.setSession, dropSession: brain.dropSession, setOthers: brain.setOthers, setMode: brain.setMode });
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
  rp.timer = setTimeout(() => { play(ev); rp.idx++; renderReplay(); nextEvent(); }, Math.max(0, (ev.at - elapsed) / SPEED));
}
function startReplay() {
  if (MULTI) showSessions();
  if (params.has('noreplay')) return;
  rp.t0 = performance.now(); rp.idx = 0;
  nextEvent();
}
// The actions, one every 2.8 s, on cells of the demo project; then again. What a real session would send is sent here
// by hand: an edit's lines, a search's folder and its matches, a command's end.
function startActions() {
  const P = replay.project, inP = graph.nodes.filter((n) => n.project === P), words = window.I18N[lang].brain.fx;
  const file = (re) => inP.find((n) => n.type === 'file' && re.test(n.path)).id, tool = (name) => inP.find((n) => n.type === 'tool' && n.name === name).id;
  const main = { agent: 'main', def: defs.get('main') }, sub = { agent: 'a1', def: defs.get('a1') };
  const a = file(/features/), b = file(/services/), c = file(/routes/), name = (i) => graph.nodes[i].name;
  const matches = inP.filter((n) => n.type === 'file' && /backend\/src\/services\//.test(n.path)).slice(0, 8).map((n) => n.id);
  const send = (ev) => brain.onEvent(ev), later = (ms, ev) => setTimeout(() => send(ev), ms);
  const steps = [
    ['read', () => send({ ...main, kind: 'read', node: a, text: name(a) })],
    ['edit', () => send({ ...main, kind: 'edit', node: b, text: name(b), add: 14, del: 6 })],
    ['create', () => send({ ...main, kind: 'create', node: c, text: name(c) })],
    ['search', () => { send({ ...main, kind: 'search', node: tool('Grep'), text: '"BookingService"', dir: '/backend/src/services' }); later(350, { ...main, kind: 'outcome', hits: matches }); }],
    ['command', () => { send({ ...main, kind: 'command', node: tool('Bash'), text: 'npm test' }); later(1900, { ...main, kind: 'outcome', done: true }); }],
    ['web', () => send({ ...main, kind: 'web', node: tool('WebFetch'), text: 'docs.example.com/api' })],
    ['agent', () => send({ ...sub, kind: 'start' })],
    ['wait', () => send({ ...main, kind: 'wait' })],
    ['error', () => send({ ...main, kind: 'error', node: tool('Bash'), text: 'Bash' })],
    ['done', () => { send({ ...sub, kind: 'stop' }); send({ ...main, kind: 'stop' }); }],
  ];
  let k = 0;
  const next = () => {
    if (k === 0) { brain.reset(); send({ ...main, kind: 'start' }); send({ ...main, kind: 'read', node: file(/controllers|features/), text: '' }); }
    const [key, run] = steps[k];
    document.getElementById('replayClock').textContent = `${k + 1}/${steps.length} · ${words[key][0]}`;
    run();
    k = (k + 1) % steps.length;
    rp.timer = setTimeout(next, 2800 / SPEED);
  };
  document.getElementById('replayBtn').hidden = true;
  setTimeout(next, 600);
}
function restartReplay() {
  if (MULTI) showSessions(); else brain.reset();
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
