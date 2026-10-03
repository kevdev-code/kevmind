// The experience module and the code map only read: no file writes, renames or deletes; git only `log` (and `ls-files` for the map).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const files = { experience: '../src/experience.js', codemap: '../src/codemap.js' };
const code = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, strip(fs.readFileSync(new URL(f, import.meta.url), 'utf8'))]));

for (const [name, src] of Object.entries(code)) {
  test(`${name}: no write-capable calls, no other way to start a process`, () => {
    const writes = src.match(/\.(?:write(?!\()\w+|writeFile\w*|append\w*|unlink\w*|rm|rmSync|rmdir\w*|rename\w*|mkdir\w*|copyFile\w*|cp|cpSync|truncate|truncateSync|symlink\w*|chmod\w*|chown\w*|utimes\w*|createWriteStream|open|openSync)\s*\(/g);
    assert.equal(writes, null, `write-capable calls: ${writes}`);
    assert.ok(!/(?<!\.)\b(?:spawn|execSync|fork|exec)\s*\(/.test(src), 'no spawn/exec/fork (RegExp .exec calls are fine)');
    const fsCalls = new Set([...src.matchAll(/\bfs\.(\w+)/g)].map((m) => m[1]));
    const allowed = ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'createReadStream'];
    assert.deepEqual([...fsCalls].filter((f) => !allowed.includes(f)), [], 'fs functions outside the read-only list');
  });
}

test('experience.js runs git only as `git log`, through one guarded helper', () => {
  assert.ok(code.experience.includes("const GIT_READ = new Set(['log']);"));
  assert.equal(code.experience.match(/execFile\(/g).length, 1);
  assert.match(code.experience, /if \(!GIT_READ\.has\(args\[0\]\)\) throw/);
  for (const m of code.experience.matchAll(/gitRead\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.equal(m[1], 'log');
});

test('codemap.js runs git only as `git ls-files` and `git log`, through one guarded helper', () => {
  assert.ok(code.codemap.includes("const GIT_MAP = new Set(['ls-files', 'log']);"));
  assert.equal(code.codemap.match(/execFile\(/g).length, 1);
  assert.match(code.codemap, /if \(!GIT_MAP\.has\(args\[0\]\)\) throw/);
  for (const m of code.codemap.matchAll(/gitRead\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.ok(['ls-files', 'log'].includes(m[1]), m[1]);
});
