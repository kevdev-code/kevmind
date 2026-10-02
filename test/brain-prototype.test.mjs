// Brain prototype (Phase 4): the synthetic graph is deterministic and OdonMind-sized, paths land in the right lobe,
// and the layout keeps every node inside its lobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGraph, makeReplay, lobeOfPath, regionOfPath } from '../prototype/brain/data.js';
import { layout, lobeAt, lobeShape, shellPoints, shellFilaments, purkinjeTrees, FIL_FLOATS, STEM_AXIS, CALLOSUM, callosumY } from '../prototype/brain/layout.js';
import { FIL_FLOATS as GL_FIL_FLOATS } from '../prototype/brain/gl.js';

test('paths map to lobes and regions', () => {
  assert.equal(lobeOfPath('frontend/src/features/appointments/AppointmentsPage.tsx'), 'occipital');
  assert.equal(lobeOfPath('backend/src/services/appointments.service.ts'), 'parietal');
  assert.equal(lobeOfPath('backend/test/integration/appointments.test.ts'), 'cerebellum');
  assert.equal(lobeOfPath('frontend/src/service/api/__tests__/patients.api.test.ts'), 'cerebellum');
  assert.equal(lobeOfPath('backend/drizzle/tenant/0003_create_patients.sql'), 'stem');
  assert.equal(lobeOfPath('package.json'), 'stem');
  assert.equal(lobeOfPath('docs/architecture/overview.md'), 'frontal');
  assert.equal(regionOfPath('frontend/src/features/appointments/X.tsx'), 'frontend/src/features');
  assert.equal(regionOfPath('src/state.js'), 'src');
  assert.equal(regionOfPath('package.json'), '(root)');
});

test('synthetic graph is deterministic and shaped like the real projects', () => {
  const a = makeGraph({ now: 0 }), b = makeGraph({ now: 0 });
  assert.deepEqual(a, b);
  const clinic = a.nodes.filter((n) => n.project === 'demo-clinic');
  const notes = clinic.filter((n) => n.type === 'memory' && n.noteType !== 'index');
  assert.ok(notes.length >= 45 && notes.length <= 55, `~50 memory notes, got ${notes.length}`);
  assert.ok(clinic.filter((n) => n.type === 'file').length >= 250, 'a few hundred files');
  assert.ok(makeGraph({ target: 3000 }).nodes.length >= 3000);
  const r = makeReplay(a);
  assert.deepEqual(new Set(r.events.map((e) => e.agent)), new Set(['main', 'a1', 'a2', 'a3']));
  assert.ok(r.events.every((e) => e.node == null || a.nodes[e.node].project === 'demo-clinic'));
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
