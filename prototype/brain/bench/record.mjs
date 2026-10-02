// Records the README's video of the Brain tab (docs/media/brain-demo.mp4) from the harness's synthetic data: headless
// Edge on the real GPU, one directed take of about 33 s. The intro, the replay (Claude and three subagents), a few
// actions sent by hand (an edit with its lines, a search with its matches, a web fetch, a new file), Auto-rotate, the
// labels and the Cut. DevTools screencast frames are resampled to a constant frame rate and encoded with ffmpeg (not a
// dependency: pass its path in FFMPEG).
//   FFMPEG=<ffmpeg.exe> node prototype/brain/bench/record.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [outDir = '.'] = process.argv.slice(2);
const FPS = 20, W = 1280, H = 800, PORT = 4796, FROM = 0.8, END = 34.3;
const ffmpeg = process.env.FFMPEG;

const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), String(PORT)], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { server.kill(); } catch {} });
await sleep(500);
const e = await launch({ port: 9380, width: W, height: H });
const p = await e.open('about:blank');
const frames = [];
p.listen('Page.screencastFrame', (f) => {
  frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
  p.send('Page.screencastFrameAck', { sessionId: f.sessionId });
});
await p.send('Page.enable');
await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
// English, animations on, labels off (they come on later), Auto-rotate off. The harness's header is not the
// dashboard's: hidden, so the view fills the frame.
await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('kevmind.lang', 'en'); localStorage.setItem('kevmind.brain.labels', 'off'); localStorage.removeItem('kevmind.brain.anim'); localStorage.removeItem('kevmind.brain.rotate'); } catch {}
  addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'header.top { display: none !important; }'; document.head.append(s); });` });
await p.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const start = Date.now();
await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
for (let i = 0; i < 100 && !(await p.eval('!!(window.__brain && window.__graph)').catch(() => false)); i++) await sleep(100);
// The harness's own box is not part of the dashboard either. The cells the hand-sent actions land on, in demo-agency.
await p.eval(`document.getElementById('replayBtn').closest('section').style.display = 'none';
window.__take = (() => {
  const inP = __graph.nodes.filter((n) => n.project === 'demo-agency'), name = (i) => __graph.nodes[i].name;
  const file = (re) => inP.find((n) => n.type === 'file' && re.test(n.path)).id;
  const tool = (t) => inP.find((n) => n.type === 'tool' && n.name === t).id;
  const hits = inP.filter((n) => n.type === 'file' && /backend\\/src\\/services\\//.test(n.path)).slice(0, 8).map((n) => n.id);
  const ed = file(/services/), cr = file(/routes/), send = (ev) => __brain.event({ agent: 'main', ...ev });
  return {
    edit: () => send({ kind: 'edit', node: ed, text: name(ed), add: 14, del: 6 }),
    search: () => { send({ kind: 'search', node: tool('Grep'), text: '"BookingService"', dir: '/backend/src/services' }); setTimeout(() => send({ kind: 'outcome', hits }), 350); },
    web: () => send({ kind: 'web', node: tool('WebFetch'), text: 'docs.example.com/api' }),
    create: () => send({ kind: 'create', node: cr, text: name(cr) }),
  };
})(); true`);
const at = async (s) => { const ms = s * 1000 - (Date.now() - start); if (ms > 0) await sleep(ms); };
const run = (js) => p.eval(js);
const click = (id) => run(`document.getElementById('${id}').click()`);
await at(7.5); await run('__take.edit()');
await at(9.5); await click('rotateBtn');
await at(12); await run('__take.search()');
await at(15); await run('__take.web()');
await at(18); await click('labelsBtn');
await at(21); await run('__take.create()');
await at(24); await click('rotateBtn'); await click('fitBtn');
await at(26); await click('cutBtn');
await at(32.5); await click('cutBtn');
await at(END + 0.5);
await p.send('Page.stopScreencast');
await e.close();

// Resample to a constant frame rate between FROM and END (seconds after navigation).
const dir = path.join(outDir, 'frames');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
frames.sort((a, b) => a.t - b.t);
let k = 0, n = 0;
for (let t = start + FROM * 1000; t <= start + END * 1000; t += 1000 / FPS) {
  while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
  if (!frames[k] || frames[k].t > t) continue;
  fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(frames[k].data, 'base64'));
}
console.log(`${frames.length} screencast frames -> ${n} frames at ${FPS} fps`);
if (ffmpeg) {
  // CRF 32 keeps the 33 s under 5 MB; the filaments are what costs.
  const mp4 = path.join(outDir, 'brain-demo.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  console.log('wrote', mp4, Math.round(fs.statSync(mp4).size / 1024), 'KB');
}
process.exit(0);
