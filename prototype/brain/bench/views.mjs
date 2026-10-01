// The brain from six fixed views (left, right, top, front, back and the 3/4 opening view), at ~600 and ~3,000 nodes:
// a screenshot of each, the outline measured in it, and one contact sheet per size with the expected proportions.
//   [REF=<side-view image, front at the left> REF_BOX=x0,y0,x1,y1 (its brain's bounding box in pixels)] node bench/views.mjs <outDir>
// With REF, each sheet also shows the left view with the reference over it at 50% opacity, and the two side by side.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || 'views');
const PORT = 4795;
// A real brain: length 1 : width 0.83 : cerebrum height 0.6-0.65.
const VIEWS = [
  { name: 'Left', yaw: Math.PI, pitch: 0, axes: 'length × height', want: [1 / 0.65, 1 / 0.6] },
  { name: 'Right', yaw: 0, pitch: 0, axes: 'length × height', want: [1 / 0.65, 1 / 0.6] },
  { name: 'Top', yaw: -Math.PI / 2, pitch: 1.55, axes: 'width × length', want: [0.83, 0.83] },
  { name: 'Front', yaw: Math.PI / 2, pitch: 0, axes: 'width × height', want: [0.83 / 0.65, 0.83 / 0.6] },
  { name: 'Back', yaw: -Math.PI / 2, pitch: 0, axes: 'width × height', want: [0.83 / 0.65, 0.83 / 0.6] },
  { name: '3/4 (opening view)', yaw: 0.32, pitch: 0.16, axes: 'oblique', want: null },
];

fs.mkdirSync(out, { recursive: true });
const REF = process.env.REF, refFile = REF && 'reference' + path.extname(REF);
if (REF) fs.copyFileSync(REF, path.join(out, refFile));
const RB = (process.env.REF_BOX || '20,112,955,873').split(',').map(Number);
const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), String(PORT)], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { server.kill(); } catch {} });
await sleep(500);
const e = await launch({ port: 9390, width: 1440, height: 900 });
const p = await e.open('about:blank');
await p.send('Page.enable');
await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('kevmind.lang', 'en'); localStorage.removeItem('kevmind.brain.anim'); } catch {}" });
const results = {};
for (const nodes of [0, 3000]) {
  await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?noreplay${nodes ? `&nodes=${nodes}` : ''}` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await p.eval('!!(window.__brain && __brain.frames() > 0)').catch(() => false)) break; }
  await sleep(800);
  const count = await p.eval('__brain.nodes');
  const well = JSON.parse(await p.eval("JSON.stringify(document.getElementById('well').getBoundingClientRect())"));
  const rows = [];
  for (const v of VIEWS) {
    await p.eval(`__brain.view(${v.yaw}, ${v.pitch})`);
    await sleep(700);
    const m = JSON.parse(await p.eval('JSON.stringify(__brain.outline())'));
    const labels = JSON.parse(await p.eval('JSON.stringify(__brain.labels())'));
    const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: well.x, y: well.y, width: well.width, height: well.height, scale: 1 } });
    const file = `${count}-${v.name.split(' ')[0].replace('/', '-')}.png`;
    fs.writeFileSync(path.join(out, file), Buffer.from(shot.data, 'base64'));
    rows.push({ ...v, file, m, labels });
  }
  results[count] = rows;
  const ratio = (wh) => wh[0] / wh[1];
  const cell = (r) => {
    const c = ratio(r.m.cerebrum), a = ratio(r.m.all);
    const ok = r.want ? (c >= r.want[0] - 0.02 && c <= r.want[1] + 0.02 ? 'ok' : 'off') : '';
    const want = r.want ? ` (real: ${r.want[0].toFixed(2)}${r.want[1] !== r.want[0] ? `–${r.want[1].toFixed(2)}` : ''})` : '';
    return `<figure><img src="${r.file}"><figcaption><b>${r.name}</b> <span>${r.axes}</span><br>` +
      `cerebrum ${r.m.cerebrum[0].toFixed(2)} × ${r.m.cerebrum[1].toFixed(2)} = <b class="${ok}">${c.toFixed(2)}</b>${want}` +
      ` · with cerebellum and brainstem ${a.toFixed(2)} · on screen ${r.m.px[0]} × ${r.m.px[1]} px` +
      ` · ${r.labels.length} labels${r.labels.some((l) => l.leader) ? `, ${r.labels.filter((l) => l.leader).length} with a leader line` : ''}</figcaption></figure>`;
  };
  // The reference over the left view: one scale (the mean of the two bounding boxes' ratios), centers aligned.
  const left = rows[0], [bx0, by0, bx1, by1] = left.m.box, sx = (bx1 - bx0) / (RB[2] - RB[0]), sy = (by1 - by0) / (RB[3] - RB[1]), k = (sx + sy) / 2;
  const pct = (v, of) => ((v / of) * 100).toFixed(2) + '%';
  const refFig = !REF ? '' : `<section><figure><div class="ov"><img src="${left.file}"><img class="ref" src="${refFile}" style="left:${pct((bx0 + bx1) / 2 - ((RB[0] + RB[2]) / 2) * k, well.width)};top:${pct((by0 + by1) / 2 - ((RB[1] + RB[3]) / 2) * k, well.height)};width:${pct(980 * k, well.width)}"></div>` +
    `<figcaption><b>Left view with the reference at 50%</b><br>bounding box height ÷ width: ours ${((by1 - by0) / (bx1 - bx0)).toFixed(3)}, reference ${((RB[3] - RB[1]) / (RB[2] - RB[0])).toFixed(3)}</figcaption></figure>` +
    `<figure><div class="pair"><img src="${left.file}"><img src="${refFile}"></div><figcaption><b>Left view next to the reference</b></figcaption></figure></section>`;
  fs.writeFileSync(path.join(out, `views-${count}.html`), `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; padding: 20px; background: #0d0d14; color: #cfcfe0; font: 15px system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 14px; } main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
figure { margin: 0; } img { width: 100%; display: block; border-radius: 8px; } figcaption { margin-top: 6px; line-height: 1.5; }
figcaption span { color: #8a8aa0; } .ok { color: #7ee0a0; } .off { color: #ff8a8a; }
section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; } .ov { position: relative; overflow: hidden; border-radius: 8px; }
.ov .ref { position: absolute; opacity: 0.5; border-radius: 0; } .pair { display: grid; grid-template-columns: 1.6fr 1fr; gap: 8px; align-items: center; background: #fff; border-radius: 8px; } .pair img { border-radius: 0; }
</style><h1>${count} nodes · six fixed views · outline measured orthographically in brain units (width × height on screen)</h1><main>${rows.map(cell).join('')}</main>${refFig}`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: pathToFileURL(path.join(out, `views-${count}.html`)).href });
  await sleep(1200);
  const sheet = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(out, `views-${count}.png`), Buffer.from(sheet.data, 'base64'));
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log(count, 'nodes:', rows.map((r) => `${r.name} ${(r.m.cerebrum[0] / r.m.cerebrum[1]).toFixed(2)} (labels ${r.labels.length})`).join(' · '));
}
fs.writeFileSync(path.join(out, 'views.json'), JSON.stringify(results, null, 2));
await e.close();
process.exit(0);
