// The code map (src/codemap.js): exported names, imports through barrels and aliases, and names the docs
// still mention after the code dropped them. Also the Memory tab's checks built on it (stale names, missing scripts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportsOf, codeMapper, fileIndex, staleNames } from '../src/codemap.js';
import { scanProject } from '../src/memory.js';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-codemap-'));
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: dir, stdio: 'ignore', windowsHide: true });

test('exported names: declarations, lists, defaults, barrels, CommonJS and Dart', () => {
  const ts = exportsOf([
    'export async function loadUser() {}',
    'export default class UserCard {}',
    'export const MAX_ROWS = 5;',
    'export type UserId = string;',
    'const a = 1, b = 2;',
    'export { a, b as renamed, type UserShape };',
    'function local() {}',
  ].join('\n'), '.ts');
  assert.deepEqual(ts.names.sort(), ['MAX_ROWS', 'UserCard', 'UserId', 'UserShape', 'a', 'loadUser', 'renamed']);
  assert.equal(ts.barrel, false);
  assert.equal(exportsOf("export * from './format';\nexport { thing } from './thing';", '.ts').barrel, true);
  assert.deepEqual(exportsOf("export * as helpers from './helpers';", '.js').names, ['helpers']);
  assert.deepEqual(exportsOf('module.exports = { send, redact: mask };\nexports.extra = 1;', '.js').names.sort(), ['extra', 'redact', 'send']);
  const dart = exportsOf('class OrderCard extends StatelessWidget {}\nclass _Private {}\nString formatPrice(int c) {\n  return "";\n}\nfinal defaultTax = 0.16;', '.dart');
  assert.deepEqual(dart.names.sort(), ['OrderCard', 'defaultTax', 'formatPrice']);
  assert.deepEqual(exportsOf('def thing(): pass', '.py').names, [], 'names are read for JavaScript, TypeScript and Dart only');
});

// a.ts imports format.ts directly, b.ts through the barrel, d.ts through a tsconfig alias; c.ts imports format.ts but
// never mentions formatDate; e.ts mentions formatDate without importing it.
function project(dir) {
  write(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
  write(path.join(dir, 'src', 'util', 'format.ts'), 'export function formatDate(d: Date) { return String(d); }\nexport const unusedThing = 1;\n');
  write(path.join(dir, 'src', 'index.ts'), "export * from './util/format';\n");
  write(path.join(dir, 'src', 'a.ts'), "import { formatDate } from './util/format';\nexport const a = formatDate(new Date());\n");
  write(path.join(dir, 'src', 'b.ts'), "import { formatDate } from './index';\nexport const b = formatDate(new Date());\n");
  write(path.join(dir, 'src', 'c.ts'), "import { unusedThing } from './util/format';\nexport const c = unusedThing;\n");
  write(path.join(dir, 'src', 'd.ts'), "import { formatDate } from '@/util/format';\nimport { a } from './a';\nexport const d = formatDate(a);\n");
  write(path.join(dir, 'src', 'e.ts'), '// formatDate is mentioned here but never imported\nexport const e = 1;\n');
}

test('imports resolve directly, through a barrel and through an alias; a bare name finds its file', async () => {
  const dir = tmp();
  project(dir);
  const map = await codeMapper()(dir);
  const f = (p) => fileIndex(map, p);
  const importers = (p) => [...map.importers[f(p)]].map((i) => map.files[i]).sort();
  assert.deepEqual(importers('src/util/format.ts'), ['src/a.ts', 'src/c.ts', 'src/d.ts', 'src/index.ts']);
  assert.deepEqual(importers('src/index.ts'), ['src/b.ts']);
  assert.ok(map.info[f('src/index.ts')].barrel);
  assert.equal(f('a.ts'), f('src/a.ts'), 'a bare file name works when only one file has it');
});
test('names the code dropped: only those git shows in the code before, never planned or present ones', async () => {
  const dir = tmp();
  project(dir);
  git(dir, 'init', '-q');
  write(path.join(dir, 'src', 'old.ts'), 'export function legacyHelper() {}\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'add legacy helper');
  fs.rmSync(path.join(dir, 'src', 'old.ts'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'remove legacy helper');
  const map = await codeMapper()(dir);
  const gone = await staleNames(map, ['legacyHelper', 'plannedFeature', 'formatDate'], 20_000);
  assert.deepEqual([...gone.keys()], ['legacyHelper']);
  assert.match(gone.get('legacyHelper').date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(gone.get('legacyHelper').subject, 'remove legacy helper');
});

test('Memory tab: stale names (not in negated sentences) and scripts no package.json has', async () => {
  const dir = tmp();
  const home = path.join(dir, 'home'), root = path.join(dir, 'proj');
  write(path.join(home, '.claude', 'CLAUDE.md'), '# User\n');
  write(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node x', test: 'node --test' } }));
  write(path.join(root, 'node_modules', '.bin', 'tsc.cmd'), '');
  write(path.join(root, 'CLAUDE.md'), [
    '# Rules',
    'Dates go through `legacyHelper`.',
    'The old `retiredWidget` was removed in September.',
    'Run `npm run dev`, then `npm run gone-script` and `bun run tsc`.',
    '```',
    'bun run seed:all',
    '```',
  ].join('\n'));
  write(path.join(root, 'README.md'), 'Start with `npm run dev -- --background`.\n');
  let asked = null;
  const codeNames = async (names) => { asked = names; return new Map(names.filter((n) => n !== 'plannedOne').map((n) => [n, { commit: 'abc1234', date: '2026-09-29', subject: 'cleanup' }])); };
  const r = await scanProject(root, { home, codeNames });
  assert.deepEqual(asked.sort(), ['legacyHelper'], 'a name in a negated sentence is never asked about');
  const stale = r.problems.find((p) => p.code === 'stale_name');
  assert.equal(stale.tier, 'suggestion');
  assert.deepEqual(stale.params.items, [{ path: 'legacyHelper', lines: [2], date: '2026-09-29' }]);
  assert.match(stale.fix, /`legacyHelper` \(line 2\), last changed in abc1234 on 2026-09-29: "cleanup"/);
  const scripts = r.problems.filter((p) => p.code === 'missing_script');
  assert.equal(scripts.length, 1, 'README has only scripts that exist');
  assert.deepEqual(scripts[0].params.items.map((i) => [i.path, i.lines]), [['npm run gone-script', [4]], ['bun run seed:all', [6]]]);
  const off = await scanProject(root, { home });
  assert.equal(off.problems.filter((p) => p.code === 'stale_name').length, 0, 'no names checked while the code map is off');
});
