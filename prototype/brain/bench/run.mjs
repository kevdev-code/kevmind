// Brain benchmark over CDP in headless Edge. Never touches KevMind's data or port 4777: it serves the prototype
// folder itself on a test port.
//   node bench/run.mjs <out.json>
// Per GPU mode (the machine's GPU, and SwiftShader as a worst case) and size (~600 and ~3,000 nodes): the intro (frames
// drawn in it and the longest wait between two), first frame, the replay at 30 fps, a hidden tab, another view,
// animations off, Follow, idle, and Auto-rotate. Everything after the intro loads with ?nointro.
// The renderer comparison (Canvas 2D vs raw WebGL vs three.js) was run at commit e753723; see docs/BRAIN.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep, cpuTimes } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4797;
const out = process.argv[2] || 'bench.json';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), String(PORT)], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { server.kill(); } catch {} });
await sleep(500);

// Windows performance counters: average 3D-engine utilization of one process (the browser's GPU process).
function gpuUtil(pid, seconds) {
  const ps = `$s = Get-Counter -Counter "\\GPU Engine(pid_${pid}_*)\\Utilization Percentage" -SampleInterval 1 -MaxSamples ${seconds} -ErrorAction SilentlyContinue;` +
    ` $v = $s | ForEach-Object { ($_.CounterSamples | Where-Object { $_.InstanceName -like '*engtype_3d*' } | Measure-Object CookedValue -Sum).Sum };` +
    ` [math]::Round((($v | Measure-Object -Average).Average), 2)`;
  return new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout) => resolve(err ? null : Number(stdout.trim()))));
}
const metrics = async (p) => Object.fromEntries((await p.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

// One sampling window: frames drawn, cache rebuilds, main-thread busy time, renderer and GPU process CPU, GPU engine.
async function sample(e, p, seconds) {
  const f0 = await p.eval('__brain.frames()'), s0 = await p.eval('__brain.staticDraws()');
  const m0 = await metrics(p), c0 = await cpuTimes(e.browser), t0 = Date.now();
  const util = e.gpu === 'hw' ? gpuUtil(c0.pids.GPU, seconds) : Promise.resolve(null);
  await sleep(seconds * 1000);
  const m1 = await metrics(p), c1 = await cpuTimes(e.browser), wall = (Date.now() - t0) / 1000;
  const f1 = await p.eval('__brain.frames()'), s1 = await p.eval('__brain.staticDraws()');
  const pct = (x) => +((x / wall) * 100).toFixed(1);
  return {
    seconds: +wall.toFixed(1),
    fps: +((f1 - f0) / wall).toFixed(2),
    cacheRebuildsPerSec: +((s1 - s0) / wall).toFixed(2),
    mainThreadPct: pct(m1.TaskDuration - m0.TaskDuration),
    rendererCpuPct: pct((c1.by.renderer || 0) - (c0.by.renderer || 0)),
    gpuProcessCpuPct: pct((c1.by.GPU || 0) - (c0.by.GPU || 0)),
    gpuEngine3dPct: await util,
    heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
  };
}

// Warm-up launch, thrown away.
// The first Windows GPU-counter query of a run also stalls the browser's frames for a while, so it happens here.
{ const w = await launch({ port: 9373 }); const p = await w.open('about:blank'); await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?noreplay` }); await sleep(2000); await gpuUtil((await cpuTimes(w.browser)).pids.GPU, 3); await sleep(4000); await w.close(); await sleep(800); }

const results = { runs: [] };
const ONLY = process.env.ONLY; // e.g. ONLY=hw:0 to rerun one configuration
for (const [gpu, nodes] of [['hw', 0], ['hw', 3000], ['swiftshader', 0], ['swiftshader', 3000]].filter(([g, n]) => !ONLY || ONLY === `${g}:${n}`)) {
  const e = await launch({ port: 9372, gpu });
  e.gpu = gpu;
  const p = await e.open('about:blank');
  await p.send('Performance.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('kevmind.lang', 'en'); localStorage.removeItem('kevmind.brain.anim'); localStorage.removeItem('kevmind.brain.rotate'); } catch {}" });
  await p.send('Page.enable');
  // The intro, on its own load: frames drawn while it plays (the cap is 30 fps) and the longest wait between two.
  let intro = null;
  if (process.env.INTRO !== '0') {
    await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?noreplay${nodes ? `&nodes=${nodes}` : ''}` });
    for (let i = 0; i < 300; i++) { await sleep(100); if (await p.eval('!!(window.__brain && __brain.intro && __brain.intro.done)').catch(() => false)) break; }
    const st = await p.eval('JSON.stringify(__brain.introStats ? __brain.introStats() : null)');
    intro = st === 'null' ? null : JSON.parse(st);
    log(gpu, nodes, 'intro', JSON.stringify(intro));
  }
  const t0 = Date.now();
  await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?nointro${nodes ? `&nodes=${nodes}` : ''}` });
  for (let i = 0; i < 200; i++) { await sleep(100); if (await p.eval('!!(window.__brain && __brain.frames() > 0)').catch(() => false)) break; }
  const at = (s) => sleep(Math.max(0, s * 1000 - (Date.now() - t0)));
  const run = { gpu, nodes: await p.eval('__brain.nodes'), edges: await p.eval('__brain.edges'), firstFrameMs: await p.eval('__brain.firstFrameMs()'), intro };
  await at(6);
  run.replay = await sample(e, p, 12);
  log(gpu, run.nodes, 'replay', JSON.stringify(run.replay));
  // Hidden tab: another tab in front (and no focus emulation, which would keep this one "visible").
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const other = await e.open('about:blank');
  await fetch(`http://127.0.0.1:${e.port}/json/activate/${other.targetId}`);
  await sleep(800);
  run.hiddenState = await p.eval('document.visibilityState');
  run.hidden = await sample(e, p, 7);
  log('hidden', run.hiddenState, JSON.stringify(run.hidden));
  await fetch(`http://127.0.0.1:${e.port}/json/activate/${p.targetId}`);
  await p.send('Page.bringToFront');
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await sleep(600);
  await p.eval('__brain.hide()'); // as when another view of the dashboard is shown
  run.otherView = await sample(e, p, 5);
  log('other view', JSON.stringify(run.otherView));
  await p.eval('__brain.show()');
  await sleep(400);
  await p.eval("document.getElementById('animSwitch').click()");
  run.animationsOff = await sample(e, p, 8);
  log('animations off', JSON.stringify(run.animationsOff));
  await p.eval("document.getElementById('animSwitch').click()");
  await p.eval('__brain.setFollow(true)');
  await sleep(300);
  run.follow = await sample(e, p, 8);
  log('follow', JSON.stringify(run.follow));
  await p.eval('__brain.setFollow(false)');
  // Idle: the replay is over (paused so it doesn't loop) and the last effects have settled.
  await at(59.5);
  await p.eval("document.getElementById('replayBtn').click()");
  for (let i = 0; i < 100 && (await p.eval('__brain.busy')); i++) await sleep(100);
  await sleep(1500);
  run.idle = await sample(e, p, 12);
  log('idle', JSON.stringify(run.idle));
  await p.eval('__brain.setAutoRotate(true)');
  await sleep(3500);
  run.autoRotate = await sample(e, p, 8);
  log('auto-rotate', JSON.stringify(run.autoRotate));
  await p.eval('__brain.setAutoRotate(false)');
  run.bloom = await p.eval('__brain.bloom'); // the level it ended at: 2 full, 1 light, 0 off (it steps down by itself)
  log('bloom level', run.bloom);
  results.runs.push(run);
  try { other.ws.close(); } catch {}
  await e.close();
  await sleep(800);
}
fs.writeFileSync(out, JSON.stringify(results, null, 2));
log('wrote', out);
process.exit(0);
