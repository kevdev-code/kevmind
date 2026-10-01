// The experience module and the MCP server only read: no file writes, renames or deletes, and git only as `git log`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const files = { experience: '../src/experience.js', mcp: '../mcp/server.js' };
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

test('mcp server writes only protocol messages to stdout and logs to stderr', () => {
  const writes = [...code.mcp.matchAll(/process\.(stdout|stderr)\.write\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ['stderr', 'stdout']);
  assert.ok(!/console\.(log|info|warn|error)\(/.test(code.mcp), 'console output would corrupt the protocol or go unnoticed');
});

test('experience.js runs git only as `git log`, through one guarded helper', () => {
  assert.ok(code.experience.includes("const GIT_READ = new Set(['log']);"));
  assert.equal(code.experience.match(/execFile\(/g).length, 1);
  assert.match(code.experience, /if \(!GIT_READ\.has\(args\[0\]\)\) throw/);
  for (const m of code.experience.matchAll(/gitRead\([^,]+,\s*\[\s*'([\w-]+)'/g)) assert.equal(m[1], 'log');
  assert.ok(!/execFile/.test(code.mcp), 'the MCP server itself never runs a process');
});
