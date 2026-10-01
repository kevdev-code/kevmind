// Brain prototype (Phase 4): the synthetic graph is deterministic and OdonMind-sized, paths land in the right lobe,
// and the layout keeps every node inside its lobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGraph, makeReplay, lobeOfPath, regionOfPath } from '../prototype/brain/data.js';
import { layout, lobeShape, shellPoints } from '../prototype/brain/layout.js';

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

test('layout keeps every node inside its lobe, on its hemisphere', () => {
  const g = makeGraph({ target: 1500 });
  const { pos, side } = layout(g);
  let left = 0;
  g.nodes.forEach((n, i) => {
    const s = lobeShape(g.regions[n.region].lobe, side[n.region]);
    if (pos[i * 3 + 2] < 0) left++;
    const d = [0, 1, 2].reduce((t, k) => t + ((pos[i * 3 + k] - s.c[k]) / s.r[k]) ** 2, 0);
    assert.ok(Number.isFinite(d) && d <= 1.0001, `${n.path} outside ${g.regions[n.region].lobe}`);
  });
  assert.ok(Math.abs(left / g.nodes.length - 0.5) < 0.1, `hemispheres balanced (${left} of ${g.nodes.length} on the left)`);
});

test('the shell has brain proportions (about 1.4 : 1 : 1.05 length : width : height)', () => {
  const s = shellPoints(6000), mn = [9, 9, 9], mx = [-9, -9, -9];
  for (let i = 0; i < s.length; i += 4) if (s[i + 3] <= 1) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], s[i + a]); mx[a] = Math.max(mx[a], s[i + a]); }
  const [l, h, w] = [0, 1, 2].map((a) => mx[a] - mn[a]);
  assert.ok(Math.abs(l / w - 1.4) < 0.1 && Math.abs(h / w - 1.05) < 0.1, `${(l / w).toFixed(2)} : 1 : ${(h / w).toFixed(2)}`);
});
