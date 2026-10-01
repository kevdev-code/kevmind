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
