// Full-resolution screenshot of a page in headless Edge: node bench/shot.mjs <url> <out.png> [width] [height] [waitMs] [js-before-shot] (DPR=2 for a phone)
import fs from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const [url, out, w = '1440', h = '900', wait = '8000', js = ''] = process.argv.slice(2);
const e = await launch({ port: 9350, width: Number(w), height: Number(h) });
try {
  const p = await e.open('about:blank');
  await p.send('Page.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: Number(process.env.DPR) || 1, mobile: Number(w) < 600 });
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.SCHEME || 'dark' }] });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('kevmind.lang', '${process.env.LANG_UI || 'en'}'); } catch {}` });
  await p.send('Page.navigate', { url });
  await sleep(Number(wait));
  if (js) await p.eval(js);
  if (js) await sleep(600);
  const shot = await p.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote', out);
} finally { await e.close(); }
process.exit(0);
