// KevMind's own switch for the experience tools: ~/.kevmind/config.json wins over the plugin option, so "off" is
// always respected; the CLI and the dashboard endpoint write the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { readConfig, writeConfig, experienceTools, optionState, pluginOption, configFile } from '../src/config.js';

const BIN = new URL('../bin/kevmind.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kevmind-cfg-')));

test('precedence: config file, then plugin option, then off', () => {
  const dir = tmp();
  assert.deepEqual(experienceTools(dir, undefined), { on: false, source: 'default' });
  for (const unset of ['', null, '${user_config.experience_tools}']) assert.deepEqual(experienceTools(dir, unset), { on: false, source: 'default' });
  assert.deepEqual(experienceTools(dir, 'true'), { on: true, source: 'plugin' });
  assert.deepEqual(experienceTools(dir, true), { on: true, source: 'plugin' });
  assert.deepEqual(experienceTools(dir, 'false'), { on: false, source: 'plugin' });

  writeConfig(dir, { experienceTools: false });
  assert.deepEqual(experienceTools(dir, 'true'), { on: false, source: 'config' }, '"off" in the file beats the plugin option');
  writeConfig(dir, { experienceTools: true });
  assert.deepEqual(experienceTools(dir, 'false'), { on: true, source: 'config' });
  assert.deepEqual(experienceTools(dir, undefined), { on: true, source: 'config' });

  fs.writeFileSync(configFile(dir), '{"experienceTools": "yes"}'); // not a boolean: the file doesn't decide
  assert.deepEqual(experienceTools(dir, 'true'), { on: true, source: 'plugin' });
  fs.writeFileSync(configFile(dir), 'not json');
  assert.deepEqual(experienceTools(dir, undefined), { on: false, source: 'default' });
  assert.equal(optionState('1'), true);
  assert.equal(optionState('off'), false);
});

test('writing keeps other keys and leaves no temp file behind', () => {
  const dir = path.join(tmp(), 'nested', 'home');
  writeConfig(dir, { other: 1 });
  writeConfig(dir, { experienceTools: true });
  assert.deepEqual(readConfig(dir), { other: 1, experienceTools: true });
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('the plugin option is read from pluginConfigs in Claude user settings', () => {
  const claude = tmp();
  assert.equal(pluginOption(claude), undefined);
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ pluginConfigs: { 'other@x': { options: { experience_tools: true } } } }));
  assert.equal(pluginOption(claude), undefined, 'another plugin\'s option is not ours');
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ pluginConfigs: { 'kevmind@kevmind': { options: { experience_tools: true } } } }));
  assert.equal(pluginOption(claude), true);
});

test('kevmind tools on | off | status', () => {
  const home = tmp();
  const user = tmp(); // a stand-in user profile, so the real ~/.claude/settings.json is not consulted
  const run = (...a) => execFileSync(process.execPath, [BIN, 'tools', ...a], { env: { ...process.env, KEVMIND_HOME: home, HOME: user, USERPROFILE: user }, encoding: 'utf8', windowsHide: true });
  assert.match(run('status'), /Experience tools: off\n {2}Source: default \(nothing set\)/);
  assert.match(run('on'), /Experience tools: on\n {2}Source: config file \(.*config\.json\)/);
  assert.deepEqual(readConfig(home), { experienceTools: true });
  fs.mkdirSync(path.join(user, '.claude'));
  fs.writeFileSync(path.join(user, '.claude', 'settings.json'), JSON.stringify({ pluginConfigs: { 'kevmind@kevmind': { options: { experience_tools: true } } } }));
  const off = run('off');
  assert.match(off, /Experience tools: off\n {2}Source: config file/);
  assert.match(off, /Plugin option: on \(the config file wins\)/);
  assert.match(off, /next Claude Code session/);
  fs.rmSync(configFile(home));
  assert.match(run('status'), /Experience tools: on\n {2}Source: plugin option "experience_tools"/);
  assert.throws(() => run('maybe'), /Usage: kevmind tools on \| off \| status/);
});

test('the dashboard switch writes the same file, and only for a same-origin JSON request', async () => {
  const home = tmp();
  const port = 47000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [BIN, 'start'], { env: { ...process.env, KEVMIND_HOME: home, KEVMIND_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const post = (body, headers = { 'content-type': 'application/json' }) => fetch(`${base}/api/tools`, { method: 'POST', headers, body });
    const r = await post('{"on": true}');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { on: true, source: 'config' });
    assert.deepEqual(readConfig(home), { experienceTools: true });

    assert.equal((await post('{"on": false}', { 'content-type': 'text/plain' })).status, 403, 'a plain form post is refused');
    assert.equal((await post('{"on": false}', { 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403, 'another origin is refused');
    assert.equal((await post('{"on": "no"}')).status, 400);
    assert.deepEqual(readConfig(home), { experienceTools: true }, 'nothing refused was written');

    const panel = await (await fetch(`${base}/api/experience?key=nope`)).json();
    assert.deepEqual(panel.tools, { on: true, source: 'config' });
  } finally {
    child.kill();
  }
});
