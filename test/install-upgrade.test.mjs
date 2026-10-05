// Upgrading from 0.5.1 with manual hooks: `kevmind install` replaces them and drops the removed session briefing's hook
// (its settings entry and its copy in ~/.kevmind); until then `kevmind start` says so. Runs in a temporary home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = pathToFileURL(path.join(HERE, '..', 'src', 'install.js')).href;

test('kevmind install removes the 0.5.1 briefing hook and file, keeps the user\'s own hooks', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-upgrade-')));
  try {
    const data = path.join(home, '.kevmind'), settingsFile = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(data, { recursive: true });
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const q = (p) => `node "${p.split(path.sep).join('/')}"`;
    // What `kevmind install` wrote in 0.5.1: send.mjs on every event, brief.mjs on SessionStart; plus a hook of the user's.
    fs.writeFileSync(path.join(data, 'brief.mjs'), '// 0.5.1 briefing hook\n');
    fs.writeFileSync(settingsFile, JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: q(path.join(data, 'send.mjs')), timeout: 5, async: true }] },
          { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: q(path.join(data, 'brief.mjs')), timeout: 3 }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      },
    }));
    const env = { ...process.env, HOME: home, USERPROFILE: home, KEVMIND_HOME: data };
    const run = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(INSTALL)});\n${code}`], { env, encoding: 'utf8', windowsHide: true }).trim();

    assert.equal(run('console.log(m.staleBriefingHook())'), 'true', 'kevmind start tells the user to reinstall');
    assert.equal(run('console.log(JSON.stringify(m.install({ force: true })))').includes('"briefing":true'), true);
    const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const commands = Object.values(after.hooks).flat().flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(!commands.some((c) => c.includes('brief.mjs')), 'no hook runs the briefing anymore');
    assert.ok(commands.some((c) => c.includes('send.mjs')), 'the event hook is back');
    assert.ok(commands.includes('echo mine'), 'the user\'s own hook is kept');
    assert.equal(after.theme, 'dark');
    assert.equal(fs.existsSync(path.join(data, 'brief.mjs')), false, 'its copy is gone');
    assert.equal(run('console.log(m.staleBriefingHook())'), 'false');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
