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

export function install() {
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
