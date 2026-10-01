// GPU cost per layer of the WebGL renderer (timer queries), uncapped, on the GPU and on SwiftShader.
//   node bench/breakdown.mjs
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep, cpuTimes } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), '4795'], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { server.kill(); } catch {} });
await sleep(500);
const variants = (process.env.VARIANTS || 'all|skip=bg|skip=haze|skip=edges|skip=nodes|skip=bg,haze,edges|aa=0|dpr=1.5').split('|');
for (const gpu of (process.env.GPUS || 'hw,swiftshader').split(',')) {
  for (const v of variants) {
    const scale = v.startsWith('dpr') ? 2 : Number(process.env.DSF || 1);
    const e = await launch({ port: 9390, gpu });
    const p = await e.open('about:blank');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });
    await p.send('Page.navigate', { url: `http://127.0.0.1:4795/bench/scene.html?r=webgl&nodes=3000&${v === "all" ? "mode=max" : v.includes("mode=") ? v : "mode=max&" + v}` });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await p.eval('!!(window.__bench && __bench.frames > 5)').catch(() => false)) break; }
    await sleep(1500);
    await p.eval('__bench.reset()');
    const c0 = await cpuTimes(e.browser);
    await sleep(5000);
    const c1 = await cpuTimes(e.browser);
    const cpu = (k) => (((c1.by[k] || 0) - (c0.by[k] || 0)) / 5 * 100).toFixed(0).padStart(4) + '%';
    const b = JSON.parse(await p.eval('JSON.stringify(__bench)'));
    console.log(gpu.padEnd(11), `dsf=${scale}`, v.padEnd(22), 'gpu ms/frame', (b.gpuMs / b.gpuFrames).toFixed(2).padStart(6), ' fps', (b.frames / 5).toFixed(0).padStart(3), ' renderer', cpu('renderer'), ' gpu-process', cpu('GPU'));
    e.close();
    await sleep(500);
  }
}
process.exit(0);
