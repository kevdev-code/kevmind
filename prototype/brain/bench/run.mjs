// Brain benchmark over CDP in headless Edge. Never touches KevMind's data or port 4777: it serves the prototype
// folder itself on a test port.
//   node bench/run.mjs renderers <out.json>   Canvas 2D vs raw WebGL vs three.js, 3,000 nodes, GPU and SwiftShader
//   node bench/run.mjs proto <out.json>       the prototype: load, replay at 30 fps, hidden tab, other view, animations off, idle
// BRAIN_THREE=<three/build folder> is required for the three.js runs (not vendored in the repo).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep, cpuTimes } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4797;
const [mode = 'renderers', out = 'bench.json'] = process.argv.slice(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), String(PORT)], { env: process.env, stdio: 'ignore', windowsHide: true });
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

// One sampling window: page counters, main-thread busy time, CPU of the renderer and GPU processes, GPU engine use.
async function sample(e, p, seconds, { counters = true, gpu = true } = {}) {
  if (counters) await p.eval('window.__bench && window.__bench.reset()');
  const f0 = await p.eval('window.__brain ? window.__brain.frames() : 0');
  const m0 = await metrics(p), c0 = await cpuTimes(e.browser), t0 = Date.now();
  const util = gpu && e.gpu === 'hw' ? gpuUtil(c0.pids.GPU, seconds) : Promise.resolve(null);
  await sleep(seconds * 1000);
  const m1 = await metrics(p), c1 = await cpuTimes(e.browser), wall = (Date.now() - t0) / 1000;
  const b = counters ? await p.eval('JSON.stringify(window.__bench || null)').then(JSON.parse) : null;
  const f1 = await p.eval('window.__brain ? window.__brain.frames() : 0');
  const pct = (x) => +((x / wall) * 100).toFixed(1);
  return {
    seconds: +wall.toFixed(1),
    fps: b ? +(b.frames / wall).toFixed(1) : +((f1 - f0) / wall).toFixed(2),
    jsMsPerFrame: b && b.frames ? +(b.jsMs / b.frames).toFixed(2) : undefined,
    gpuMsPerFrame: b && b.gpuFrames ? +(b.gpuMs / b.gpuFrames).toFixed(3) : undefined,
    mainThreadPct: pct(m1.TaskDuration - m0.TaskDuration),
    rendererCpuPct: pct((c1.by.renderer || 0) - (c0.by.renderer || 0)),
    gpuProcessCpuPct: pct((c1.by.GPU || 0) - (c0.by.GPU || 0)),
    gpuEngine3dPct: await util,
    heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1),
  };
}

async function openPage(e, url, ready) {
  const p = await e.open('about:blank');
  await p.send('Performance.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('kevmind.lang', 'en'); localStorage.removeItem('kevmind.brain.anim'); } catch {}" });
  await p.send('Page.enable');
  await p.send('Page.navigate', { url });
  for (let i = 0; i < 200; i++) { await sleep(100); if (await p.eval(ready).catch(() => false)) break; }
  return p;
}

const results = { machine: null, runs: [] };
const env = await launch({ port: 9370, gpu: 'hw' });
const info = await env.browser.send('SystemInfo.getInfo');
results.machine = { gpu: info.gpu.devices.map((d) => d.deviceString), cpu: info.modelName || '', edge: (await env.browser.send('Browser.getVersion')).product };
env.close();
await sleep(500);

if (mode === 'renderers') {
  for (const gpu of ['hw', 'swiftshader']) {
    for (const [nodes, edges] of [[3000, 0], [3000, 9000]]) {
      for (const r of ['canvas', 'webgl', 'three']) {
        if (r === 'three' && !process.env.BRAIN_THREE) continue;
        const e = await launch({ port: 9371, gpu });
        e.gpu = gpu;
        const p = await openPage(e, `http://127.0.0.1:${PORT}/bench/scene.html?r=${r}&nodes=${nodes}&edges=${edges}&mode=cap`, 'window.__bench && window.__bench.frames > 5');
        const load = await p.eval(`(() => { const res = performance.getEntriesByType('resource').filter((x) => x.name.endsWith('.js'));
          return { firstFrameMs: Math.round(__bench.firstFrameMs), scriptKB: Math.round(res.reduce((s, x) => s + x.encodedBodySize, 0) / 1024),
            timer: __bench.timer, nodes: __bench.nodes, edges: __bench.edges }; })()`);
        await sleep(2000);
        const cap = await sample(e, p, 12);
        await p.eval("__bench.setMode('max')");
        await sleep(1500);
        const max = await sample(e, p, 8, { gpu: false });
        const run = { gpu, renderer: r, ...load, cap30: cap, uncapped: max };
        results.runs.push(run);
        log(gpu, r, nodes, load.edges, JSON.stringify({ load, cap, max }));
        e.close();
        await sleep(800);
      }
    }
  }
}

if (mode === 'proto') {
  for (const [gpu, nodes] of [['hw', 0], ['hw', 3000], ['swiftshader', 3000]]) {
    const e = await launch({ port: 9372, gpu });
    e.gpu = gpu;
    // Baseline: the same browser showing an empty page, so the brain's share can be told apart from Edge's own.
    const blank = await e.open('about:blank');
    await blank.send('Performance.enable');
    await sleep(2000);
    const baseline = await sample(e, blank, 8, { counters: false });
    try { blank.ws.close(); } catch {}
    await e.browser.send('Target.closeTarget', { targetId: blank.targetId });
    const t0 = Date.now();
    const p = await openPage(e, `http://127.0.0.1:${PORT}/index.html${nodes ? `?nodes=${nodes}` : ''}`, 'window.__brain && window.__brain.frames() > 0');
    const run = { gpu, baseline, nodes: await p.eval('__brain.nodes'), edges: await p.eval('__brain.edges'),
      firstFrameMs: await p.eval('__brain.firstFrameMs()') };
    const since = () => (Date.now() - t0) / 1000;
    await sleep(Math.max(0, 6000 - (Date.now() - t0)));
    log(gpu, nodes, 'replay, animations on');
    run.replayAnimated = await sample(e, p, 14, { counters: false });
    log(JSON.stringify(run.replayAnimated));
    // Hidden tab: another tab in front (and no focus emulation, which would keep this one "visible").
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const other = await e.open('about:blank');
    await fetch(`http://127.0.0.1:${e.port}/json/activate/${other.targetId}`);
    await sleep(800);
    run.hiddenState = await p.eval('document.visibilityState');
    run.hidden = await sample(e, p, 8, { counters: false });
    log('hidden', run.hiddenState, JSON.stringify(run.hidden));
    await fetch(`http://127.0.0.1:${e.port}/json/activate/${p.targetId}`);
    await p.send('Page.bringToFront');
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await sleep(800);
    run.returnedState = await p.eval('document.visibilityState');
    // Another view (Live) shown instead of the brain.
    await p.eval("document.querySelector('[data-view=live]').click()");
    run.otherView = await sample(e, p, 6, { counters: false });
    log('other view', JSON.stringify(run.otherView));
    await p.eval("document.querySelector('[data-view=brain]').click()");
    await sleep(500);
    // Animations off: a static frame per change only.
    await p.eval("document.getElementById('animSwitch').click()");
    run.animationsOff = await sample(e, p, 10, { counters: false });
    log('animations off', JSON.stringify(run.animationsOff));
    await p.eval("document.getElementById('animSwitch').click()");
    // Idle: wait for the replay to end, pause it so it doesn't loop, let the last effects settle.
    await sleep(Math.max(0, 59500 - (Date.now() - t0)));
    await p.eval("document.getElementById('replayBtn').click()");
    for (let i = 0; i < 100 && (await p.eval('__brain.busy')); i++) await sleep(100); // the last event's effects settle
    await sleep(1000);
    run.idleAt = +since().toFixed(1);
    run.idle = await sample(e, p, 15, { counters: false });
    log('idle', JSON.stringify(run.idle));
    run.nodesShown = await p.eval("document.getElementById('counts').textContent");
    results.runs.push(run);
    try { other.ws.close(); } catch {}
    e.close();
    await sleep(800);
  }
}

fs.writeFileSync(out, JSON.stringify(results, null, 2));
log('wrote', out);
process.exit(0);
