// Records the prototype for review: headless Edge on the real GPU, DevTools screencast frames resampled to a constant
// frame rate, encoded with ffmpeg (not a dependency: pass its path in FFMPEG).
//   FFMPEG=<ffmpeg.exe> node bench/record.mjs <outDir> [url-query] [fromS] [toS]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [outDir, query = '', fromS = '3', toS = '33'] = process.argv.slice(2);
const FPS = 20, W = 1280, H = 800, PORT = 4796;
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
await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('kevmind.lang', 'en'); localStorage.removeItem('kevmind.brain.anim'); } catch {}" });
await p.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const start = Date.now();
await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html${query}` });
await sleep(Number(toS) * 1000 + 500);
await p.send('Page.stopScreencast');
e.close();

// Resample to a constant frame rate between fromS and toS (seconds after navigation).
const dir = path.join(outDir, 'frames');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
frames.sort((a, b) => a.t - b.t);
let k = 0, n = 0;
for (let t = start + Number(fromS) * 1000; t <= start + Number(toS) * 1000; t += 1000 / FPS) {
  while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
  if (!frames[k] || frames[k].t > t) continue;
  fs.writeFileSync(path.join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(frames[k].data, 'base64'));
}
console.log(`${frames.length} screencast frames -> ${n} frames at ${FPS} fps`);
if (ffmpeg) {
  const mp4 = path.join(outDir, 'brain-prototype.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
  console.log('wrote', mp4);
}
process.exit(0);
