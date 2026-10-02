// Pure helpers of the dashboard script (public/app.js is a browser script, so they are lifted out of its source).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const lift = (name) => {
  const start = src.indexOf(`function ${name}(`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return new Function(`${src.slice(start, i + 1)}; return ${name};`)();
  }
  throw new Error(`${name} not found`);
};
const win = (...parts) => parts.join(String.fromCharCode(92)); // a Windows path, built at runtime

test('files panel: the shortest parent path that tells same-named files apart', () => {
  const shortPaths = lift('shortPaths');
  assert.deepEqual(shortPaths([win('C:', 'p', 'KevMind', 'src', 'memory.js'), win('C:', 'p', 'KevMind', 'public', 'memory.js'), win('C:', 'p', 'KevMind', 'public', 'app.js')]),
    ['src/memory.js', 'public/memory.js', 'app.js']);
  assert.deepEqual(shortPaths(['/a/x/lib/util.js', '/a/y/lib/util.js', '/a/lib/util.js']), ['x/lib/util.js', 'y/lib/util.js', 'a/lib/util.js']);
  assert.deepEqual(shortPaths(['/r/memory.js', '/r/src/memory.js']), ['r/memory.js', 'src/memory.js']);
  assert.deepEqual(shortPaths(['/r/a.js', '/r/a.js']), ['r/a.js', 'r/a.js'], 'identical paths end without looping');
  assert.deepEqual(shortPaths([]), []);
});

test('sessions rail: sessions that never got going are folded or skipped, live ones always shown', () => {
  const sessionFold = lift('sessionFold');
  const now = Date.UTC(2026, 9, 1, 12);
  const base = { title: null, firstPrompt: null, events: 2, toolCalls: 0, edits: 0, lastAt: now - 60_000 };
  assert.equal(sessionFold(base, 'ended', now), 'skip', 'no prompt, no title, 2 events, nothing done');
  assert.equal(sessionFold({ ...base, toolCalls: 1 }, 'ended', now), 'closed', 'a tool call folds it instead');
  assert.equal(sessionFold({ ...base, edits: 1 }, 'idle', now), 'closed');
  assert.equal(sessionFold({ ...base, events: 4 }, 'ended', now), 'show', 'more than 3 events');
  assert.equal(sessionFold({ ...base, firstPrompt: 'Fix it' }, 'ended', now), 'show');
  assert.equal(sessionFold({ ...base, title: 'Billing' }, 'ended', now), 'show');
  assert.equal(sessionFold(base, 'working', now), 'show', 'a running session is never hidden');
  assert.equal(sessionFold(base, 'waiting', now), 'show');
  assert.equal(sessionFold({ ...base, firstPrompt: 'x', lastAt: now - 3 * 3600_000 }, 'ended', now), 'closed', 'closed more than 2 h ago');
  assert.equal(sessionFold({ ...base, firstPrompt: 'x', lastAt: now - 3 * 3600_000 }, 'idle', now), 'show', 'idle, not closed');
});

test('counters: one of something is said in the singular, in both languages', () => {
  const w = {};
  new Function('window', fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'))(w);
  const { en, es } = w.I18N;
  // The phone showed "1 conexiones".
  assert.equal(es.brain.counts(1, 1, 1), '1 proyecto · 1 nodo · 1 conexión');
  assert.equal(en.brain.counts(1, 1, 1), '1 project · 1 node · 1 link');
  assert.equal(es.brain.counts(3, 1200, 2), '3 proyectos · 1200 nodos · 2 conexiones');
  // Every counter of the dashboard with 1: no "1" followed by a plural.
  const ones = (T) => [
    T.brain.counts(1, 1, 1), T.brain.canvas(1, 1, 1), T.brain.traceAria(1, 1), `1 ${T.brain.links(1)}`, `1 ${T.brain.reads(1)}`, `1 ${T.brain.edits(1)}`, `1 ${T.brain.uses(1)}`,
    `1 ${T.brain.errors(1)}`, `1 ${T.brain.tokens(1)}`, `1 ${T.activeAgents(1)}`, `1 ${T.actions(1)}`, `1 ${T.messages(1)}`, `1 ${T.expCalls(1)}`, T.actionsN(1), T.silentThought(1),
    T.shareViewers(1), T.expEpisodes(1, 1), T.expCommits(1, 5), T.expHot(1, 1), T.expByGit(1, 1, 'x'), T.expByEpisodes(1, 1), T.expFollow(1), T.expBaseline(1), T.memCopyAllHint(1),
    T.memIndexStats(1, '5', 1), T.memShowPaths(1), `1 ${T.memTally.problem(1)}`, `1 ${T.memTally.warning(1)}`, `1 ${T.memTally.suggestion(1)}`, T.memInfo.reads_window({ need: 14, days: 1 }),
  ];
  for (const T of [en, es]) {
    const plural = ones(T).filter((s) => /(?:^|[^\d.,])1 [a-záéíóúñ]+s\b/i.test(s.replace(/\b(?:git|episodes:|episodios:)\s/g, '')));
    assert.deepEqual(plural, []);
  }
  assert.deepEqual([en.activeAgents(2), es.activeAgents(1), es.actions(1), es.messages(0)], ['active agents', 'agente activo', 'acción', 'mensajes']);
});
