// Brain prototype (Phase 4): the synthetic graph is deterministic and OdonMind-sized, paths land in the right lobe,
// and the layout keeps every node inside its lobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGraph, makeReplay, lobeOfPath, regionOfPath } from '../prototype/brain/data.js';
import { layout, lobeAt, lobeShape, shellPoints } from '../prototype/brain/layout.js';

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
