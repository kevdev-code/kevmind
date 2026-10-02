// Brain view (Phase 4): the synthetic graph of the benchmark is deterministic and the size of a mid-sized workspace, paths land in the right lobe,
// and the layout keeps every node inside its lobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeGraph, makeReplay, lobeOfPath, regionOfPath } from '../prototype/brain/data.js';
import { layout, lobeAt, insideBrain, enclosed, pathInside, leavesBrain, lobeShape, shellPoints, shellFilaments, purkinjeTrees, FIL_FLOATS, STEM_AXIS, CALLOSUM, callosumY } from '../public/brain/layout.js';
import { FIL_FLOATS as GL_FIL_FLOATS } from '../public/brain/gl.js';

test('paths map to lobes and regions', () => {
  assert.equal(lobeOfPath('frontend/src/features/bookings/BookingsPage.tsx'), 'occipital');
  assert.equal(lobeOfPath('backend/src/services/bookings.service.ts'), 'parietal');
  assert.equal(lobeOfPath('backend/test/integration/bookings.test.ts'), 'cerebellum');
  assert.equal(lobeOfPath('frontend/src/api/__tests__/customers.api.test.ts'), 'cerebellum');
  assert.equal(lobeOfPath('backend/migrations/main/0003_create_customers.sql'), 'stem');
  assert.equal(lobeOfPath('package.json'), 'stem');
  assert.equal(lobeOfPath('docs/architecture/overview.md'), 'frontal');
  assert.equal(regionOfPath('frontend/src/features/bookings/X.tsx'), 'frontend/src/features');
  assert.equal(regionOfPath('src/state.js'), 'src');
  assert.equal(regionOfPath('package.json'), '(root)');
});

test('synthetic graph is deterministic and shaped like the real projects', () => {
  const a = makeGraph({ now: 0 }), b = makeGraph({ now: 0 });
  assert.deepEqual(a, b);
  const agency = a.nodes.filter((n) => n.project === 'demo-agency');
  const notes = agency.filter((n) => n.type === 'memory' && n.noteType !== 'index');
  assert.ok(notes.length >= 45 && notes.length <= 55, `~50 memory notes, got ${notes.length}`);
  assert.ok(agency.filter((n) => n.type === 'file').length >= 250, 'a few hundred files');
  assert.ok(makeGraph({ target: 3000 }).nodes.length >= 3000);
  const r = makeReplay(a);
  assert.deepEqual(new Set(r.events.map((e) => e.agent)), new Set(['main', 'a1', 'a2', 'a3']));
  assert.ok(r.events.every((e) => e.node == null || a.nodes[e.node].project === 'demo-agency'));
});

test('layout keeps every node inside its lobe, on its hemisphere, and fills the lobe', () => {
  const g = makeGraph({ target: 1500 });
  const { pos, side } = layout(g);
  let left = 0;
  const per = new Map();
  g.nodes.forEach((n, i) => {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], want = [g.regions[n.region].lobe, side[n.region]];
    if (p[2] < 0) left++;
    assert.deepEqual(lobeAt(p), want, `${n.path} outside ${want.join(' ')}`);
    const k = want.join('|');
    if (!per.has(k)) per.set(k, []);
    per.get(k).push(p);
  });
  assert.ok(Math.abs(left / g.nodes.length - 0.5) < 0.1, `hemispheres balanced (${left} of ${g.nodes.length} on the left)`);
  // Fill: a crowded lobe's nodes spread as wide as the lobe itself, not in a ball at its middle.
  for (const [k, list] of per) {
    if (list.length < 60) continue;
    const [lobe, s] = k.split('|'), shape = lobeShape(lobe, Number(s));
    for (let a = 0; a < 3; a++) {
      const m = list.reduce((t, p) => t + p[a], 0) / list.length;
      const spread = Math.sqrt((5 * list.reduce((t, p) => t + (p[a] - m) ** 2, 0)) / list.length);
      assert.ok(spread > shape.r[a] * 0.8, `${k} fills axis ${a}: ${spread.toFixed(2)} of ${shape.r[a].toFixed(2)}`);
    }
  }
});

test('the shell has a brain\'s proportions (length 1 : width 0.83 : cerebrum height 0.6-0.65)', () => {
  const sh = shellPoints(12000), s = new Float32Array(sh.part.length * 4); // x, y, z, part
  sh.part.forEach((pt, i) => s.set([sh.pos[i * 3], sh.pos[i * 3 + 1], sh.pos[i * 3 + 2], pt], i * 4));
  const ext = (parts) => {
    const mn = [9, 9, 9], mx = [-9, -9, -9];
    for (let i = 0; i < s.length; i += 4) if (parts.includes(s[i + 3])) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], s[i + a]); mx[a] = Math.max(mx[a], s[i + a]); }
    return { mn, mx, d: [0, 1, 2].map((a) => mx[a] - mn[a]) };
  };
  const cer = ext([0]), brain = ext([0, 1]), cbl = ext([1]), stem = ext([2]);
  const [l, h, w] = cer.d;
  assert.ok(Math.abs(w / l - 0.83) < 0.04 && h / l > 0.58 && h / l < 0.67, `1 : ${(w / l).toFixed(2)} : ${(h / l).toFixed(2)}`);
  assert.ok(brain.d[2] > brain.d[1] * 1.1, `wider than tall from the front (${(brain.d[2] / brain.d[1]).toFixed(2)})`);
  // From the top: wider at the back than at the front.
  const half = (x0, x1) => { let m = 0; for (let i = 0; i < s.length; i += 4) if (s[i + 3] === 0 && s[i] >= x0 && s[i] < x1) m = Math.max(m, Math.abs(s[i + 2])); return m; };
  assert.ok(half(-0.7, -0.4) > half(0.4, 0.7) * 1.05, 'wider at the back');
  // The fissure is a thin gap, not a valley: about 2-3% of the width.
  let gap = 9;
  for (let i = 0; i < s.length; i += 4) if (s[i + 3] === 0 && s[i + 1] > 0.3) gap = Math.min(gap, Math.abs(s[i + 2]));
  assert.ok((2 * gap) / w > 0.015 && (2 * gap) / w < 0.03, `fissure ${((200 * gap) / w).toFixed(1)}% of the width`);
  // The cerebellum is a compact mass under the back, narrower than the cerebrum; the brainstem leaves the base, tilted back.
  assert.ok(cbl.mx[0] < 0 && cbl.d[0] < 0.4 * l && cbl.d[2] < 0.75 * w && cbl.mx[1] < 0, 'cerebellum under the back');
  const stemX = (y0, y1) => { let t = 0, n = 0; for (let i = 0; i < s.length; i += 4) if (s[i + 3] === 2 && s[i + 1] >= y0 && s[i + 1] < y1) { t += s[i]; n++; } return t / n; };
  const mid = (stem.mn[1] + stem.mx[1]) / 2;
  assert.ok(stem.mx[1] < cer.mn[1] + 0.25 && stemX(stem.mn[1], mid) < stemX(mid, stem.mx[1]), 'brainstem below the base, tilted back');
});

test('the shell is a web of short strands along its own points; the cerebellum has folia', () => {
  const sh = shellPoints(12000), f = shellFilaments(sh), d = f.data, n = d.length / FIL_FLOATS;
  assert.equal(FIL_FLOATS, GL_FIL_FLOATS, 'layout and renderer agree on the layout of a strand');
  assert.ok(n > sh.part.length * 0.9, `about one strand or more per point (${n} for ${sh.part.length})`);
  // The ranges cover every strand once, by lobe and hemisphere.
  let covered = 0;
  for (const [key, [start, count]] of f.ranges) { assert.match(key, /^[a-z]+\|(-1|0|1)$/); assert.equal(start, covered); covered += count; }
  assert.equal(covered, n);
  const points = new Set();
  for (let i = 0; i < sh.part.length; i++) points.add([0, 1, 2].map((a) => sh.pos[i * 3 + a].toFixed(5)).join());
  let folia = 0, total = 0;
  const cbl = [[9, 9, 9], [-9, -9, -9]];
  for (let i = 0; i < sh.part.length; i++) if (sh.part[i] === 1) for (let a = 0; a < 3; a++) { cbl[0][a] = Math.min(cbl[0][a], sh.pos[i * 3 + a]); cbl[1][a] = Math.max(cbl[1][a], sh.pos[i * 3 + a]); }
  for (let i = 0; i < n; i++) {
    const o = i * FIL_FLOATS, p0 = [d[o], d[o + 1], d[o + 2]], p1 = [d[o + 3], d[o + 4], d[o + 5]], c = [d[o + 6], d[o + 7], d[o + 8]], part = d[o + 13];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), mid = [0, 1, 2].map((a) => (p0[a] + p1[a]) / 2);
    assert.ok(Math.hypot(c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]) <= 0.21 * len + 1e-6, 'slightly curved, never a loop');
    if (part === 1) { // folia: short pieces of level lines on the cerebellum's surface, among its own points
      folia++;
      assert.ok(len <= 0.05, `a short piece of a folium (${len.toFixed(3)})`);
      for (const p of [p0, p1]) assert.ok(p.every((v, a) => v >= cbl[0][a] - 0.03 && v <= cbl[1][a] + 0.03), 'on the cerebellum');
      continue;
    }
    total += len;
    assert.ok(len <= 0.055 + 1e-6, `a short strand (${len.toFixed(3)})`);
    assert.ok(points.has(p0.map((v) => v.toFixed(5)).join()) && points.has(p1.map((v) => v.toFixed(5)).join()), 'joins two shell points');
    if (part === 0) assert.ok(p0[2] * p1[2] >= 0, 'never across the fissure');
  }
  assert.ok(folia > 1000, `the cerebellum's folia (${folia} pieces)`);
  assert.ok(total / (n - folia) < 0.03, 'mostly short ridge strands');
});

test('the fixed structures sit where they belong', () => {
  // The corpus callosum arches through the cerebrum, highest in its middle.
  for (let x = CALLOSUM.x0; x <= CALLOSUM.x1; x += 0.05) {
    const where = lobeAt([x, callosumY(x), 0.06]);
    assert.ok(where && !['cerebellum', 'stem'].includes(where[0]), `callosum at x ${x.toFixed(2)} inside the cerebrum`);
  }
  assert.ok(callosumY(CALLOSUM.xc) > callosumY(CALLOSUM.x0) + 0.1 && callosumY(CALLOSUM.xc) > callosumY(CALLOSUM.x1) + 0.1, 'an arch');
  // The brainstem's axis leans back going down.
  assert.ok(STEM_AXIS.bottom[0] < STEM_AXIS.top[0] && STEM_AXIS.bottom[1] < STEM_AXIS.top[1]);
  // Purkinje cells: somas and every branch inside the cerebellum.
  const pk = purkinjeTrees(7);
  assert.equal(pk.somas.length, 7);
  for (const p of pk.somas) assert.equal(lobeAt(p)?.[0], 'cerebellum');
  for (const [, b] of pk.segs) assert.ok(lobeAt(b) === null || lobeAt(b)[0] === 'cerebellum', 'a branch stays in the cerebellum');
  assert.ok(pk.segs.length > 7 * 10, 'branching trees');
});

// The region colors are told apart at a glance, also with the common color vision deficiencies, never take Claude's
// coral, and read as label text on the night. The palette is lifted from the page's source (it needs a DOM to load).
test('region colors: apart for every kind of color vision, in gamut, readable as labels, coral kept for Claude', () => {
  const src = fs.readFileSync(new URL('../public/brain/view.js', import.meta.url), 'utf8');
  const lift = (name) => new Function(`return ${src.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`))[1]}`)();
  const LOBE_COLOR = lift('LOBE_COLOR'), coral = JSON.parse(src.match(/const AGENT_MAIN = (\[[^\]]*\])/)[1]);
  assert.deepEqual(Object.keys(LOBE_COLOR), ['prefrontal', 'frontal', 'parietal', 'occipital', 'temporal', 'cerebellum', 'stem']);
  const lin = ([l, c, h]) => {
    const L = l / 100, a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
    const x = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, y = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, z = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z, -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z, -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z];
  };
  const lab = ([r, g, b]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const clip = (v) => v.map((x) => Math.min(1, Math.max(0, x)));
  // Machado, Oliveira & Fernandes (2009), severity 1.0, in linear RGB: normal, protanopia, deuteranopia, tritanopia.
  const SEE = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  ];
  const colors = [...Object.values(LOBE_COLOR), coral], names = [...Object.keys(LOBE_COLOR), 'coral'];
  for (const [k, c] of Object.entries(LOBE_COLOR)) assert.ok(lin(c).every((v) => v > -0.002 && v < 1.002), `${k} is inside sRGB`);
  SEE.forEach((m, q) => {
    const seen = colors.map((c) => lab(clip(m.map((r) => { const v = clip(lin(c)); return r[0] * v[0] + r[1] * v[1] + r[2] * v[2]; }))));
    for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
      const d = Math.hypot(...seen[i].map((v, a) => v - seen[j][a])) * 100;
      assert.ok(d >= (q ? 7 : 14), `${names[i]} and ${names[j]} are ${d.toFixed(1)} apart (vision ${q})`);
    }
  });
  // As label text (lifted to at least 76% lightness) on the night's lightest part, at the labels' 0.86 opacity: AA.
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055), dec = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2], night = clip(lin([19, 0.085, 280]));
  for (const [k, [l, c, h]] of Object.entries(LOBE_COLOR)) {
    const text = clip(lin([Math.max(76, l + 4), c, h])).map((v, a) => dec(enc(v) * 0.86 + enc(night[a]) * 0.14)); // blended as the browser does
    assert.ok((lum(text) + 0.05) / (lum(night) + 0.05) >= 4.5, `${k} label contrast`);
  }
});

test('a trail never leaves the brain: cells are inside, and any way between two of them is brought back in', () => {
  const g = makeGraph({ target: 1500 });
  const { pos } = layout(g);
  const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  g.nodes.forEach((n, i) => assert.ok(insideBrain(at(i)), `${n.path} is inside the brain`));
  // Outside: above, beside and under the brain, and in the corner between the cerebellum and the brainstem.
  for (const p of [[0, 0.75, 0], [0, 0, 0.9], [-0.75, -0.7, 0], [-0.6, -0.75, 0.2], [-0.35, -0.95, 0.15]]) assert.ok(!insideBrain(p) && !enclosed(p), `${p} is outside`);
  // Enclosed: the pocket where the brainstem enters between the temporal lobes is in no part, yet no side shows it
  // outside the brain's outline.
  for (const p of [[-0.05, -0.27, 0], [-0.03, -0.285, 0.04]]) assert.ok(!insideBrain(p) && enclosed(p), `${p} is between parts`);
  assert.ok(leavesBrain([at(0), [-0.6, -0.75, 0.2], at(1)]) && !leavesBrain([at(0), at(0)]));

  // Curved ways between cells, many of them bulging out of the brain like the old free arcs did: fitted, every
  // point of every one is inside (or enclosed where it crosses between two parts), and they still join the same cells.
  let seed = 7, bulging = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 2500; k++) {
    const a = at(Math.floor(rnd() * g.nodes.length)), b = at(Math.floor(rnd() * g.nodes.length));
    const mid = [0, 1, 2].map((i) => (a[i] + b[i]) / 2), out = mid.map((v, i) => v - [0, 0.12, 0][i]), ol = Math.hypot(...out) || 1;
    const c = k % 2 ? mid.map((v, i) => v + (out[i] / ol) * 0.35) : mid.map((v) => v + (rnd() - 0.5) * 0.5); // away from the core, or anywhere
    const way = Array.from({ length: 17 }, (_, q) => { const t = q / 16; return [0, 1, 2].map((i) => (1 - t) * (1 - t) * a[i] + 2 * (1 - t) * t * c[i] + t * t * b[i]); });
    if (leavesBrain(way)) bulging++;
    const path = pathInside(way);
    assert.ok(!leavesBrain(path), `way ${k} stays in the brain`);
    assert.deepEqual([path[0], path[path.length - 1]], [way[0], way[16]]);
    assert.ok(path.length < 200);
  }
  assert.ok(bulging > 300, `many of the free curves left the brain (${bulging} of 2500)`);
});
