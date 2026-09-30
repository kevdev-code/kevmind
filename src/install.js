// Installs/uninstalls KevMind hooks in ~/.claude/settings.json (for users not using the plugin).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOOK_EVENTS, MATCHER_EVENTS } from './events.js';
import { DATA_DIR } from './server.js';

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const HOOK_SRC = path.join(HOOK_DIR, 'send.js');
const HOOK_DST = path.join(DATA_DIR, 'send.mjs');
// send.mjs imports ./redact.js when it spools, so the redactor must live next to it.
const REDACT_SRC = path.join(HOOK_DIR, 'redact.js');
const REDACT_DST = path.join(DATA_DIR, 'redact.js');
const TAG = 'kevmind';

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  const txt = fs.readFileSync(SETTINGS, 'utf8');
  try { return JSON.parse(txt); } catch {
    throw new Error(`Could not parse ${SETTINGS} (invalid JSON). Fix it before installing.`);
  }
}

function writeSettings(obj) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + '.kevmind-backup');
  fs.writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + '\n');
}

function isOurs(group) {
  return (group.hooks || []).some((h) => String(h.command || '').includes(TAG));
}

function strip(settings) {
  if (!settings.hooks) return settings;
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = (settings.hooks[ev] || []).filter((g) => !isOurs(g));
    if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

// The plugin registers the same hooks; with both, every event arrives twice. Claude Code records
// installed plugins in enabledPlugins (user, project and local settings) and in installed_plugins.json.
export function pluginInstalled(cwd = process.cwd()) {
  const found = [];
  const settingsFiles = [SETTINGS, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')];
  for (const file of settingsFiles) {
    let s;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const [id, on] of Object.entries(s.enabledPlugins || {})) if (on && id.startsWith('kevmind@')) found.push(`${id} enabled in ${file}`);
  }
  const pluginsDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(os.homedir(), '.claude', 'plugins');
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8'));
    for (const id of Object.keys(rec.plugins || {})) if (id.startsWith('kevmind@')) found.push(`${id} in installed_plugins.json`);
  } catch { /* nothing installed */ }
  return found;
}

export function install({ force = false } = {}) {
  const found = force ? [] : pluginInstalled();
  if (found.length) {
    throw new Error(`The KevMind plugin already provides these hooks (${found[0]}).\n    Installing them again would report every event twice. Use --force to install anyway.`);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(HOOK_SRC, HOOK_DST);
  fs.copyFileSync(REDACT_SRC, REDACT_DST);
  const settings = strip(readSettings());
  settings.hooks ||= {};
  const command = `node "${HOOK_DST.replace(/\\/g, '/')}"`;
  for (const ev of HOOK_EVENTS) {
    const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (MATCHER_EVENTS.has(ev)) group.matcher = '*';
    (settings.hooks[ev] ||= []).push(group);
  }
  writeSettings(settings);
  return { settings: SETTINGS, hook: HOOK_DST };
}

export function uninstall() {
  if (!fs.existsSync(SETTINGS)) return { settings: SETTINGS, changed: false };
  writeSettings(strip(readSettings()));
  return { settings: SETTINGS, changed: true };
}
