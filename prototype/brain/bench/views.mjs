// The brain from six fixed views (left, right, top, front, back and the 3/4 opening view), at ~600 and ~3,000 nodes:
// a screenshot of each, the outline measured in it, and one contact sheet per size. Each sheet also overlays the
// public-domain plates in docs/reference/ on the left, front, back and top views at 50%, next to the plates themselves.
//   node bench/views.mjs <outDir>
// The overlays are shot with the shell 2.5 times as bright, so its outline reads.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFS = path.join(HERE, '..', '..', '..', 'docs', 'reference');
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
// Plates over views: which part of our outline each one is matched to (one scale, centers aligned), and its own
// bounding box in pixels.
const OVERLAYS = [
  { view: 'Left', title: 'Left over Gray 728 (lobes; the side map was traced from it)', plates: [{ file: 'Gray728.png', w: 500, h: 348, box: [16, 19, 497, 313], part: 'cer' }] },
  { view: 'Front', title: 'Front over Gray 718 (coronal section, right half mirrored)', plates: [{ file: 'Gray718-front.png', w: 630, h: 590, box: [8, 78, 621, 559], part: 'cer' }] },
  { view: 'Back', title: 'Back over Gray 718 (cerebrum) and Gray 703 (cerebellum)', plates: [{ file: 'Gray718-front.png', w: 630, h: 590, box: [8, 78, 621, 559], part: 'cer' }, { file: 'Gray703.png', w: 600, h: 350, box: [5, 48, 585, 332], part: 'cbl' }] },
  { view: 'Top', title: 'Top over Gray 725 (left hemisphere from above, mirrored)', plates: [{ file: 'Gray725-top.png', w: 494, h: 600, box: [10, 9, 483, 599], part: 'cer' }] },
];
fs.mkdirSync(out, { recursive: true });
for (const o of OVERLAYS) for (const pl of o.plates) fs.copyFileSync(path.join(REFS, pl.file), path.join(out, pl.file));

const server = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs'), String(PORT)], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => { try { server.kill(); } catch {} });
await sleep(500);
const e = await launch({ port: 9390, width: 1440, height: 900 });
const p = await e.open('about:blank');
await p.send('Page.enable');
await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('kevmind.lang', 'en'); localStorage.removeItem('kevmind.brain.anim'); } catch {}" });
const load = async (q) => {
  await p.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?noreplay${q}` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await p.eval('!!(window.__brain && __brain.frames() > 0)').catch(() => false)) break; }
  await sleep(800);
};
const shoot = async (v, file, well) => {
  await p.eval(`__brain.view(${v.yaw}, ${v.pitch})`);
  await sleep(700);
  const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: well.x, y: well.y, width: well.width, height: well.height, scale: 1 } });
  fs.writeFileSync(path.join(out, file), Buffer.from(shot.data, 'base64'));
  return { m: JSON.parse(await p.eval('JSON.stringify(__brain.outline())')), labels: JSON.parse(await p.eval('JSON.stringify(__brain.labels())')) };
};
const pct = (v, of) => ((v / of) * 100).toFixed(2) + '%';
const results = {};
for (const nodes of [0, 3000]) {
  const q = nodes ? `&nodes=${nodes}` : '';
  await load(q);
  const count = await p.eval('__brain.nodes');
  const well = JSON.parse(await p.eval("JSON.stringify(document.getElementById('well').getBoundingClientRect())"));
  const rows = [];
  for (const v of VIEWS) { const file = `${count}-${v.name.split(' ')[0].replace('/', '-')}.png`; rows.push({ ...v, file, ...(await shoot(v, file, well)) }); }
  await load(q + '&shell=2.5'); // the overlays: the same views with the shell brighter
  const ovs = [];
  for (const o of OVERLAYS) { const file = `${count}-${o.view}-overlay.png`; ovs.push({ ...o, file, ...(await shoot(VIEWS.find((x) => x.name === o.view), file, well)) }); }
  results[count] = { rows: rows.map((r) => ({ view: r.name, m: r.m, labels: r.labels })), overlays: ovs.map((o) => ({ view: o.view, m: o.m })) };
  const ratio = (wh) => wh[0] / wh[1];
  const cell = (r) => {
    const c = ratio(r.m.cerebrum), a = ratio(r.m.all);
    const ok = r.want ? (c >= r.want[0] - 0.02 && c <= r.want[1] + 0.02 ? 'ok' : 'off') : '';
    const want = r.want ? ` (real: ${r.want[0].toFixed(2)}${r.want[1] !== r.want[0] ? `–${r.want[1].toFixed(2)}` : ''})` : '';
    return `<figure><img src="${r.file}"><figcaption><b>${r.name}</b> <span>${r.axes}</span><br>` +
      `cerebrum ${r.m.cerebrum[0].toFixed(2)} × ${r.m.cerebrum[1].toFixed(2)} = <b class="${ok}">${c.toFixed(2)}</b>${want}` +
      ` · with cerebellum and brainstem ${a.toFixed(2)} · ${r.labels.length} labels${r.labels.some((l) => l.leader) ? `, ${r.labels.filter((l) => l.leader).length} with a leader line` : ''}</figcaption></figure>`;
  };
  const overlay = (o) => {
    const imgs = o.plates.map((pl) => {
      const [bx0, by0, bx1, by1] = o.m[pl.part === 'cer' ? 'boxCer' : pl.part === 'cbl' ? 'boxCbl' : 'box'];
      const [rx0, ry0, rx1, ry1] = pl.box, k = ((bx1 - bx0) / (rx1 - rx0) + (by1 - by0) / (ry1 - ry0)) / 2;
      const left = (bx0 + bx1) / 2 - ((rx0 + rx1) / 2) * k, top = (by0 + by1) / 2 - ((ry0 + ry1) / 2) * k;
      const name = pl.part === 'cbl' ? 'cerebellum' : pl.part === 'cer' ? 'cerebrum' : 'brain';
      return { html: `<img class="ref" src="${pl.file}" style="left:${pct(left, well.width)};top:${pct(top, well.height)};width:${pct(pl.w * k, well.width)}">`, text: `${name}: ours ${((by1 - by0) / (bx1 - bx0)).toFixed(3)}, plate ${((ry1 - ry0) / (rx1 - rx0)).toFixed(3)}` };
    });
    return `<figure><div class="pair"><div class="ov"><img src="${o.file}">${imgs.map((x) => x.html).join('')}</div>` +
      `<div class="plates">${o.plates.map((pl) => `<img src="${pl.file}">`).join('')}</div></div>` +
      `<figcaption><b>${o.title}</b>, at 50% · height ÷ width, ${imgs.map((x) => x.text).join(' · ')}</figcaption></figure>`;
  };
  fs.writeFileSync(path.join(out, `views-${count}.html`), `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; padding: 20px; background: #0d0d14; color: #cfcfe0; font: 15px system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 14px; } h2 { font-size: 17px; margin: 22px 0 10px; }
main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; } section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
figure { margin: 0; } img { width: 100%; display: block; border-radius: 8px; } figcaption { margin-top: 6px; line-height: 1.5; }
figcaption span { color: #8a8aa0; } .ok { color: #7ee0a0; } .off { color: #ff8a8a; }
.pair { display: grid; grid-template-columns: 1.7fr 1fr; gap: 10px; align-items: center; } .ov { position: relative; overflow: hidden; border-radius: 8px; }
.ov .ref { position: absolute; opacity: 0.5; border-radius: 0; filter: invert(1); mix-blend-mode: screen; }
.plates { display: grid; gap: 8px; background: #fff; border-radius: 8px; padding: 8px; } .plates img { border-radius: 0; }
</style><h1>${count} nodes · six fixed views · outline measured orthographically in brain units (width × height on screen)</h1>
<main>${rows.map(cell).join('')}</main>
<h2>The plates over our views at 50% (inverted so their lines read on the dark well; the shell 2.5 times as bright in these shots)</h2>
<section>${ovs.map(overlay).join('')}</section>`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 1400, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url: pathToFileURL(path.join(out, `views-${count}.html`)).href });
  await sleep(1500);
  const sheet = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(out, `views-${count}.png`), Buffer.from(sheet.data, 'base64'));
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log(count, 'nodes:', rows.map((r) => `${r.name} ${(r.m.cerebrum[0] / r.m.cerebrum[1]).toFixed(2)} (labels ${r.labels.length})`).join(' · '));
}
fs.writeFileSync(path.join(out, 'views.json'), JSON.stringify(results, null, 2));
await e.close();
process.exit(0);
