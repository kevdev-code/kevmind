// KevMind only reports on memory files; it never changes them. This reads src/memory.js as text and fails
// if the module could write, rename or delete anything, or run git with anything but ls-tree / show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/memory.js', import.meta.url), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('memory.js imports only read-capable built-ins', () => {
  const imports = [...code.matchAll(/^import\s+(.+?)\s+from\s+'([^']+)';/gm)].map((m) => `${m[1]} from ${m[2]}`);
  assert.deepEqual(imports.sort(), [
    "fs from node:fs",
    "fsp from node:fs/promises",
    "os from node:os",
    "path from node:path",
    "{ execFile } from node:child_process",
  ].sort());
  assert.ok(!/\brequire\(|\bimport\(/.test(code), 'no dynamic imports');
});

test('memory.js calls only read-only filesystem functions', () => {
  const used = (obj) => new Set([...code.matchAll(new RegExp(`\\b${obj}\\.(\\w+)`, 'g'))].map((m) => m[1]));
  const allowed = { fs: ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'lstatSync'], fsp: ['readFile', 'readdir', 'stat', 'lstat', 'access'] };
  for (const [obj, ok] of Object.entries(allowed)) {
    const extra = [...used(obj)].filter((f) => !ok.includes(f));
    assert.deepEqual(extra, [], `${obj} functions outside the read-only list`);
  }
  // Any call to a write-capable method, on any object.
  const writes = code.match(/\.(?:write\w*|append\w*|unlink\w*|rm|rmSync|rmdir\w*|rename\w*|mkdir\w*|copyFile\w*|cp|cpSync|truncate|truncateSync|symlink\w*|chmod\w*|chown\w*|utimes\w*|createWriteStream|open|openSync)\s*\(/g);
  assert.equal(writes, null, `write-capable calls found: ${writes}`);
  assert.ok(!/\b(?:spawn|execSync|fork)\s*\(/.test(code), 'no other way to start a process');
});

test('git runs read-only, through one guarded helper', () => {
  assert.ok(code.includes("const GIT_READ = new Set(['ls-tree', 'show']);"));
  assert.equal(code.match(/execFile\(/g).length, 1, 'a single execFile call, inside gitRead');
  assert.match(code, /if \(!GIT_READ\.has\(args\[0\]\)\) throw/);
  for (const m of code.matchAll(/gitRead\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.ok(['ls-tree', 'show'].includes(m[1]), `git ${m[1]}`);
});
