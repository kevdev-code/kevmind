// Import links (src/imports.js): the ways imports are really written in each supported language, resolved to files
// on disk; what is not a file of the project (a package, the standard library, a commented-out line) is no link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importScanner, specifiersOf, typeOnlySpecifiers, LANGUAGES } from '../src/imports.js';
import { buildBrain } from '../src/brain.js';
import { emptyAggregate, ingest } from '../src/experience.js';
import { keyOf } from '../src/memory.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-imports-')));
// Writes a project and returns its import links as "from -> to" (paths relative to the project), sorted.
async function linksOf(files, { only } = {}) {
  const root = tmp();
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const from = Object.keys(files).filter((f) => !only || only.includes(f)).map((f) => ({ file: path.join(root, f), root }));
  return (await importScanner()(from)).map(([a, b]) => `${rel(a)} -> ${rel(b)}`).sort();
}

test('JavaScript and TypeScript: relative paths, extensions, index files, barrels, every import form', async () => {
  const links = await linksOf({
    'src/app.ts': [
      "import React from 'react';",                       // a package: no link
      "import fs from 'node:fs';",
      "import { a } from './a';",                          // extension left out
      "import b from './b.js';",                           // written .js, the file is .ts
      "import type { C } from '../types/c';",
      'import {',
      '  one,',
      '  two,',
      "} from './many';",                                  // over several lines
      "import './styles.css';",                            // side effect only
      "import logo from './logo.svg?react';",              // bundler suffix
      "export * from './reexported';",
      "export { x as y } from './named.mjs';",
      "const lazy = () => import('./lazy');",
      "const old = require('./legacy.cjs');",
      "import { Button } from './components';",            // a folder: its index file (a barrel)
      "// import gone from './commented';",
      " * import doc from './commented';",
      "const s = \"text that says from './commented'\";",
    ].join('\n'),
    'src/a.ts': '', 'src/b.ts': '', 'types/c.d.ts': '', 'src/many.tsx': '', 'src/styles.css': '', 'src/logo.svg': '', 'src/reexported.ts': '',
    'src/named.mjs': '', 'src/lazy.jsx': '', 'src/legacy.cjs': '', 'src/commented.ts': '',
    'src/components/index.ts': "export * from './Button';\nexport { default as Card } from './Card';\n",
    'src/components/Button.tsx': '', 'src/components/Card.tsx': '',
  });
  assert.deepEqual(links, [
    'src/app.ts -> src/a.ts', 'src/app.ts -> src/b.ts', 'src/app.ts -> src/components/index.ts', 'src/app.ts -> src/lazy.jsx', 'src/app.ts -> src/legacy.cjs',
    'src/app.ts -> src/logo.svg', 'src/app.ts -> src/many.tsx', 'src/app.ts -> src/named.mjs', 'src/app.ts -> src/reexported.ts', 'src/app.ts -> src/styles.css',
    'src/app.ts -> types/c.d.ts', 'src/components/index.ts -> src/components/Button.tsx', 'src/components/index.ts -> src/components/Card.tsx',
  ]);
});

test('JavaScript and TypeScript: aliases from tsconfig or jsconfig, with comments, references, extends and baseUrl', async () => {
  const links = await linksOf({
    // A Vite app: tsconfig.json only references tsconfig.app.json, which holds the alias (with comments and a trailing comma).
    'web/package.json': '{}',
    'web/tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    'web/tsconfig.app.json': '{\n  /* Bundler mode */\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"], "@ui": ["./src/components/ui/index.ts"], }, // aliases\n  },\n}',
    'web/src/pages/Home.tsx': "import { api } from '@/service/api';\nimport { Button } from '@ui';\nimport { cn } from '@/lib/utils';\nimport x from '@tanstack/react-query';\n",
    'web/src/service/api.ts': '', 'web/src/components/ui/index.ts': '', 'web/src/lib/utils/index.ts': '',
    // A server with baseUrl and an inherited config.
    'api/tsconfig.base.json': '{ "compilerOptions": { "baseUrl": "./src", "paths": { "#db/*": ["db/*"] } } }',
    'api/tsconfig.json': '{ "extends": "./tsconfig.base.json" }',
    'api/src/routes/users.ts': "import { db } from '#db/client';\nimport { env } from 'config/env';\nimport express from 'express';\n",
    'api/src/db/client.ts': '', 'api/src/config/env.ts': '',
    // Plain JavaScript with a jsconfig.
    'tool/jsconfig.json': '{ "compilerOptions": { "paths": { "~lib/*": ["lib/*"] } } }',
    'tool/main.js': "const { run } = require('~lib/run');\n",
    'tool/lib/run.js': '',
    // No config at all (a bundler alias only): "@/" is the package's src folder.
    'site/package.json': '{}',
    'site/src/App.vue': "<script setup>\nimport Nav from '@/components/Nav.vue'\nimport { useCart } from '~/stores/cart'\n</script>\n",
    'site/src/components/Nav.vue': '', 'site/src/stores/cart.js': '',
  });
  assert.deepEqual(links, [
    'api/src/routes/users.ts -> api/src/config/env.ts', 'api/src/routes/users.ts -> api/src/db/client.ts',
    'site/src/App.vue -> site/src/components/Nav.vue', 'site/src/App.vue -> site/src/stores/cart.js',
    'tool/main.js -> tool/lib/run.js',
    'web/src/pages/Home.tsx -> web/src/components/ui/index.ts', 'web/src/pages/Home.tsx -> web/src/lib/utils/index.ts', 'web/src/pages/Home.tsx -> web/src/service/api.ts',
  ]);
});

test('Dart: the package\'s own name, relative paths, parts, exports and conditional imports', async () => {
  const links = await linksOf({
    'app/pubspec.yaml': 'name: shop_app\ndescription: A shop\n',
    'app/lib/views/catalog.page.dart': [
      "import 'dart:convert';",
      "import 'package:flutter/material.dart';",            // another package
      "import 'package:shop_app/models/catalog_item.dart';",          // this package: its lib folder
      "import 'package:shop_app/services/session.service.dart' as auth show login;",
      "import 'base.model.dart';",                     // relative, no ./
      "import '../widgets/busy.dart';",
      "export 'catalog.exports.dart';",
      "part 'catalog.page.g.dart';",
      "import 'io_stub.dart' if (dart.library.io) 'io_real.dart';",
      "// import 'package:shop_app/models/gone.dart';",
    ].join('\n'),
    'app/lib/views/catalog.page.g.dart': "part of 'catalog.page.dart';\n",
    'app/lib/models/catalog_item.dart': '', 'app/lib/models/gone.dart': '', 'app/lib/services/session.service.dart': '', 'app/lib/views/base.model.dart': '',
    'app/lib/widgets/busy.dart': '', 'app/lib/views/catalog.exports.dart': '', 'app/lib/views/io_stub.dart': '', 'app/lib/views/io_real.dart': '',
    // A second app in the same workspace with the same package name: each resolves to its own lib.
    'kiosk/pubspec.yaml': 'name: shop_app\n',
    'kiosk/lib/main.dart': "import 'package:shop_app/models/catalog_item.dart';\n",
    'kiosk/lib/models/catalog_item.dart': '',
  });
  assert.deepEqual(links, [
    'app/lib/views/catalog.page.dart -> app/lib/models/catalog_item.dart', 'app/lib/views/catalog.page.dart -> app/lib/services/session.service.dart',
    'app/lib/views/catalog.page.dart -> app/lib/views/base.model.dart', 'app/lib/views/catalog.page.dart -> app/lib/views/catalog.exports.dart',
    'app/lib/views/catalog.page.dart -> app/lib/views/catalog.page.g.dart', 'app/lib/views/catalog.page.dart -> app/lib/views/io_real.dart',
    'app/lib/views/catalog.page.dart -> app/lib/views/io_stub.dart', 'app/lib/views/catalog.page.dart -> app/lib/widgets/busy.dart',
    'app/lib/views/catalog.page.g.dart -> app/lib/views/catalog.page.dart', 'kiosk/lib/main.dart -> kiosk/lib/models/catalog_item.dart',
  ]);
});

test('Python: relative dots, packages from the folder above or src, submodules, several per line', async () => {
  const links = await linksOf({
    'backend/app/api/users.py': [
      'import os, sys',                                     // standard library
      'import requests',
      'from . import deps',                                 // a module next to this one
      'from .schemas import UserOut',
      'from ..core import config, security',                // two submodules of a package
      'from app.db.session import get_db',                  // absolute: found from the folder above "app"
      'import app.models.user as user_model',
      'from app.models import (',
      '    order,',
      '    Base,  # a name of the package itself',
      ')',
      '# from app.models import gone',
    ].join('\n'),
    'backend/app/__init__.py': '', 'backend/app/api/__init__.py': '', 'backend/app/api/deps.py': '', 'backend/app/api/schemas.py': '',
    'backend/app/core/__init__.py': '', 'backend/app/core/config.py': '', 'backend/app/core/security.py': '',
    'backend/app/db/session.py': '', 'backend/app/models/__init__.py': '', 'backend/app/models/user.py': '', 'backend/app/models/order.py': '', 'backend/app/models/gone.py': '',
    // A src layout, imported from the tests.
    'lib/src/shop/cart.py': '', 'lib/tests/test_cart.py': 'from shop.cart import Cart\nfrom shop import *\n', 'lib/src/shop/__init__.py': '',
  });
  assert.deepEqual(links, [
    'backend/app/api/users.py -> backend/app/api/deps.py', 'backend/app/api/users.py -> backend/app/api/schemas.py',
    'backend/app/api/users.py -> backend/app/core/config.py', 'backend/app/api/users.py -> backend/app/core/security.py',
    'backend/app/api/users.py -> backend/app/db/session.py', 'backend/app/api/users.py -> backend/app/models/__init__.py',
    'backend/app/api/users.py -> backend/app/models/order.py', 'backend/app/api/users.py -> backend/app/models/user.py',
    'lib/tests/test_cart.py -> lib/src/shop/__init__.py', 'lib/tests/test_cart.py -> lib/src/shop/cart.py',
  ]);
});

test('PHP: use statements through composer\'s PSR-4 folders, grouped and aliased, and required files', async () => {
  const links = await linksOf({
    'composer.json': JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/', 'Database\\Seeders\\': 'database/seeders/' } }, 'autoload-dev': { 'psr-4': { 'Tests\\': 'tests/' } } }),
    'app/Http/Controllers/InvoiceController.php': [
      '<?php',
      'namespace App\\Http\\Controllers;',
      'use Illuminate\\Http\\Request;',                    // the framework, in vendor: no link
      'use Exception;',
      'use App\\Models\\Invoice;',
      'use App\\Models\\{User, Supplier as Source};',
      'use App\\Services\\Billing as Bill, App\\Services\\Mailer;',
      'use function App\\Helpers\\money;',                 // a function, not a file
      'use Tests\\TestCase;',
      "require_once __DIR__ . '/../../Helpers/format.php';",
      "include 'partials/footer.php';",
      'class InvoiceController extends Controller {',
      '    use \\App\\Traits\\Billable;',                  // a trait, by its full name
      '    public function index() { return array_map(function ($o) use ($x) { return $o; }, []); }',
      '}',
    ].join('\n'),
    'app/Models/Invoice.php': '', 'app/Models/User.php': '', 'app/Models/Supplier.php': '', 'app/Services/Billing.php': '', 'app/Services/Mailer.php': '',
    'app/Helpers/money.php': '', 'app/Helpers/format.php': '', 'app/Traits/Billable.php': '', 'tests/TestCase.php': '', 'app/Http/Controllers/partials/footer.php': '',
  }, { only: ['app/Http/Controllers/InvoiceController.php'] });
  assert.deepEqual(links, [
    'app/Helpers/format.php', 'app/Http/Controllers/partials/footer.php', 'app/Models/Invoice.php', 'app/Models/Supplier.php', 'app/Models/User.php',
    'app/Services/Billing.php', 'app/Services/Mailer.php', 'app/Traits/Billable.php', 'tests/TestCase.php',
  ].map((to) => `app/Http/Controllers/InvoiceController.php -> ${to}`));
});

test('C#: a using names a namespace, so the link goes to the files of that namespace whose type the file mentions', async () => {
  const links = await linksOf({
    'Api/Controllers/OrdersController.cs': [
      'using System;',
      'using System.Collections.Generic;',
      'using Shop.Services;',
      'using Shop.Models;',
      'using static Shop.Util.Money;',
      'using Json = Shop.Util.JsonHelper;',
      'namespace Shop.Api.Controllers;',                    // file-scoped namespace
      'public class OrdersController : BaseController {',  // same namespace, no using needed
      '    private readonly OrderService _orders;',
      '    public Order Get(int id) => _orders.Find(id);',
      '}',
    ].join('\n'),
    'Api/Controllers/BaseController.cs': 'namespace Shop.Api.Controllers;\npublic class BaseController {}\n',
    'Services/OrderService.cs': 'using Shop.Models;\nnamespace Shop.Services {\n  public class OrderService { public Order Find(int id) => null; }\n}\n',
    'Services/MailService.cs': 'namespace Shop.Services { public class MailService {} }\n', // used namespace, type never mentioned
    'Models/Order.cs': 'namespace Shop.Models;\npublic class Order {}\n',
    'Models/Customer.cs': 'namespace Shop.Models;\npublic class Customer {}\n',
    'Util/Money.cs': 'namespace Shop.Util;\npublic static class Money {}\n',
    'Util/JsonHelper.cs': 'namespace Shop.Util;\npublic static class JsonHelper {}\n',
    'Other/Order.cs': 'namespace Legacy.Other;\npublic class Order {}\n',           // same type name, a namespace nobody uses
  });
  assert.deepEqual(links, [
    'Api/Controllers/OrdersController.cs -> Api/Controllers/BaseController.cs', 'Api/Controllers/OrdersController.cs -> Models/Order.cs',
    'Api/Controllers/OrdersController.cs -> Services/OrderService.cs', 'Api/Controllers/OrdersController.cs -> Util/JsonHelper.cs',
    'Api/Controllers/OrdersController.cs -> Util/Money.cs', 'Services/OrderService.cs -> Models/Order.cs',
  ]);
});

test('CSS and HTML: @import, Sass partials, script and link tags, paths from the site root; nothing remote', async () => {
  const links = await linksOf({
    'public/index.html': '<link rel="stylesheet" href="style.css?v=3">\n<link rel="preconnect" href="https://fonts.example.com">\n<script src="app.js"></script>\n<script type="module" src="/src/main.ts"></script>\n<script src="//cdn.example.com/x.js"></script>\n<a href="about.html">About</a>\n',
    'public/style.css': "@import './base.css';\n@import url(\"theme/dark.css\");\n@import url(https://fonts.example.com/css);\n@import 'tailwindcss';\n",
    'public/base.css': '', 'public/theme/dark.css': '', 'public/app.js': '', 'public/about.html': '', 'src/main.ts': '',
    'styles/main.scss': "@use 'sass:math';\n@use './variables';\n@import 'mixins';\n",
    'styles/_variables.scss': '', 'styles/_mixins.scss': '',
  });
  assert.deepEqual(links, [
    'public/index.html -> public/app.js', 'public/index.html -> public/style.css', 'public/index.html -> src/main.ts',
    'public/style.css -> public/base.css', 'public/style.css -> public/theme/dark.css',
    'styles/main.scss -> styles/_mixins.scss', 'styles/main.scss -> styles/_variables.scss',
  ]);
});

test('what is written is read as written, and languages without import reading are left alone', () => {
  assert.deepEqual(specifiersOf("import a from './a'\nexport { b } from \"../b\"\nawait import('./c')\n", '.TS'), ['./a', '../b', './c']);
  assert.equal(specifiersOf('package main\nimport "fmt"\n', '.go'), null);
  assert.deepEqual(Object.values(LANGUAGES).map((l) => l.name), ['JavaScript / TypeScript', 'Dart', 'Python', 'PHP', 'C#', 'CSS / Sass / Less', 'HTML']);
});

test('in the graph, an import is a link only between files that are nodes; it adds no node and follows the file', async () => {
  const root = path.join(tmp(), 'Shop'), agg = emptyAggregate(), NOW = Date.UTC(2026, 9, 20, 12);
  const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
  write('src/orders.ts', "import { stock } from './stock';\nimport { never } from './untouched';\n");
  write('src/stock.ts', '');
  write('src/untouched.ts', '');
  write('src/cart.ts', '');
  const base = { session_id: 's', cwd: root };
  ingest(agg, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'look' }, NOW - 5000);
  for (const [i, f] of ['src/orders.ts', 'src/stock.ts', 'src/cart.ts'].entries()) ingest(agg, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(root, f) } }, NOW - 4000 + i);
  const imports = importScanner();
  const build = () => buildBrain({ projects: [{ key: keyOf(root), name: 'Shop', root, report: null }], agg, now: NOW, imports });
  const pairs = (g) => g.edges.filter((e) => e.type === 'import').map((e) => `${g.nodes[e.a].path} -> ${g.nodes[e.b].path}`).sort();
  let g = await build();
  assert.deepEqual(g.nodes.map((n) => n.path).sort(), ['src/cart.ts', 'src/orders.ts', 'src/stock.ts'], 'the imported file nobody touched is not a node');
  assert.deepEqual(pairs(g), ['src/orders.ts -> src/stock.ts']);
  // The file changes: the next graph has its new import (what a file imports is only remembered while it is unchanged).
  write('src/orders.ts', "import { stock } from './stock';\nimport { cart } from './cart';\n// a longer file\n");
  g = await build();
  assert.deepEqual(pairs(g), ['src/orders.ts -> src/cart.ts', 'src/orders.ts -> src/stock.ts']);
});

test('imports for types only: import type, export type, all-type named imports; any value import wins', () => {
  const text = [
    "import type { Report } from './a';",
    "import { type A, type B } from './b';",
    "import { type C, d } from './c';",
    "export type { E } from './e';",
    "import type F from './f';",
    "import { g } from './f';",
    "import './side-effect';",
    "import type { H } from './h';",
    "const lazy = () => import('./h');",
  ].join('\n');
  assert.deepEqual([...typeOnlySpecifiers(text)].sort(), ['./a', './b', './e']);
});

test('a link says whether it brings only types', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-types-'));
  try {
    for (const [f, t] of Object.entries({ 'api.ts': 'export type R = 1; export const get = () => 1;\n', 'screen.ts': "import { get } from './api';\n", 'form.ts': "import type { R } from './api';\n", 'both.ts': "import type { R } from './api';\nimport { get } from './api';\n" })) fs.writeFileSync(path.join(dir, f), t);
    const links = await importScanner()(['screen.ts', 'form.ts', 'both.ts'].map((f) => ({ file: path.join(dir, f), root: dir })));
    const of = (f) => links.filter(([a]) => path.basename(a) === f).map(([, b, t]) => [path.basename(b), t]);
    assert.deepEqual([of('screen.ts'), of('form.ts'), of('both.ts')], [[['api.ts', 0]], [['api.ts', 1]], [['api.ts', 0]]], 'one link per imported file; a value import makes it a value link');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reading imports only reads: files and folder listings, no writes, no processes', () => {
  const src = fs.readFileSync(new URL('../src/imports.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  assert.ok(!/child_process|\b(?:spawn|execFile|execSync|fork)\s*\(/.test(src), 'it starts no process');
  assert.deepEqual([...new Set([...src.matchAll(/\bfs\.(\w+)/g)].map((m) => m[1]))].sort(), ['readFileSync', 'readdirSync', 'statSync']);
});
