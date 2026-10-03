// The code map (src/codemap.js): exported names, who uses them, how files connect, its answers, and names the docs
// still mention after the code dropped them. Also the Memory tab's checks built on it (stale names, missing scripts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { exportsOf, codeMapper, usesOf, connection, fileIndex, answerCodeMap, staleNames } from '../src/codemap.js';
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

test('who uses a name: importers that mention it, directly, through a barrel or an alias', async () => {
  const dir = tmp();
  project(dir);
  const map = await codeMapper()(dir);
  const f = (p) => fileIndex(map, p);
  const uses = usesOf(map, 'formatDate');
  assert.equal(uses.length, 1);
  assert.equal(map.files[uses[0].file], 'src/util/format.ts');
  assert.deepEqual(uses[0].users.map((i) => map.files[i]).sort(), ['src/a.ts', 'src/b.ts', 'src/d.ts']);
  assert.deepEqual(usesOf(map, 'unusedThing')[0].users.map((i) => map.files[i]), ['src/c.ts']);
  assert.equal(f('a.ts'), f('src/a.ts'), 'a bare file name works when only one file has it');
  assert.deepEqual(connection(map, f('src/d.ts'), f('src/util/format.ts')), { kind: 'imports', path: [f('src/d.ts'), f('src/util/format.ts')] });
  assert.deepEqual(connection(map, f('src/util/format.ts'), f('src/b.ts')).kind, 'imported by');
  assert.deepEqual(connection(map, f('src/a.ts'), f('src/c.ts')), { kind: 'shared', shared: [f('src/util/format.ts')] });
  assert.equal(connection(map, f('src/e.ts'), f('src/a.ts')).kind, 'none');
});

test('answers stay under 200 tokens, end with how far to trust them, and say "No data" when they have none', async () => {
  const dir = tmp();
  project(dir);
  const map = await codeMapper()(dir);
  const hist = async (key) => (key.includes('|') ? '' : 'edited in 3 work episodes on 2 days (Claude Code)');
  const answers = await Promise.all([
    answerCodeMap(map, 'demo', {}, hist),
    answerCodeMap(map, 'demo', { name: 'formatDate' }, hist),
    answerCodeMap(map, 'demo', { file: 'src/util/format.ts' }, hist),
    answerCodeMap(map, 'demo', { from: 'src/d.ts', to: 'src/util/format.ts' }, hist),
  ]);
  for (const a of answers) {
    assert.ok(a.length <= 800, `${a.length} chars`);
    assert.match(a, /Approximate: .*Serena or a language server\.$/);
  }
  assert.match(answers[1], /`formatDate` \(`src\/util\/format\.ts`\) is used in 3 files/);
  assert.match(answers[1], /History of `format\.ts`: edited in 3 work episodes/);
  assert.match(answers[3], /`src\/d\.ts` imports `src\/util\/format\.ts`/);
  assert.match(await answerCodeMap(map, 'demo', { name: 'nothingLikeThis' }), /^No data: /);
  assert.match(await answerCodeMap(map, 'demo', { file: 'src/missing.ts' }), /^No data: /);
});

test('list: true gives the complete list, 60 paths a page, and marks importers of types only', async () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'src', 'lib', 'api.ts'), 'export type Row = { id: number };\nexport function fetchRows() { return []; }\n');
    for (let i = 0; i < 5; i++) write(path.join(dir, 'src', 'lib', `helper${i}.ts`), `export const h${i} = ${i};\n`); // six files: lib is an area of its own
    for (let i = 0; i < 64; i++) write(path.join(dir, 'src', 'screens', `screen${i}.ts`), `import { fetchRows } from '../lib/api';\nexport const s${i} = fetchRows();\n`);
    write(path.join(dir, 'src', 'forms', 'form.ts'), "import type { Row } from '../lib/api';\nexport const empty: Row[] = [];\n");
    const map = await codeMapper()(dir);
    const one = await answerCodeMap(map, 'demo', { name: 'fetchRows', list: true });
    assert.match(one, /^`fetchRows` \(`src\/lib\/api\.ts`\) is used in 64 files \(page 1 of 2\):\n/);
    assert.equal(one.split('\n').filter((l) => l.startsWith('- ')).length, 60);
    assert.match(one, /Page 1 of 2: ask again with page: 2 for the next\./);
    const two = await answerCodeMap(map, 'demo', { name: 'fetchRows', list: true, page: 2 });
    assert.equal(two.split('\n').filter((l) => l.startsWith('- ')).length, 4);
    assert.match(two, /End of the list\./);
    assert.match(await answerCodeMap(map, 'demo', { name: 'fetchRows', list: true, page: 3 }), /^No data: page 3 is past the end \(2 pages\)/);
    const file = await answerCodeMap(map, 'demo', { file: 'src/lib/api.ts', list: true, page: 2 });
    assert.match(file, /- imported by: src\/screens\/screen9\.ts\n/);
    const area = await answerCodeMap(map, 'demo', { area: 'src/lib', list: true });
    assert.match(area, /^Area `src\/lib`: 6 code files, used from outside by 65 \(page 2 of 2\):\n|^Area `src\/lib`: 6 code files, used from outside by 65 \(page 1 of 2\):\n/);
    assert.match(area, /- in the area: src\/lib\/api\.ts\n(- in the area: src\/lib\/helper\d\.ts\n){5}- used from outside by: src\/forms\/form\.ts \(types only\)\n- used from outside by: src\/screens\/screen0\.ts\n/);
    const plain = await answerCodeMap(map, 'demo', { name: 'fetchRows' });
    assert.ok(plain.length <= 800, 'without list, the answer stays short');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
