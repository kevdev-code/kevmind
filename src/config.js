// KevMind's own settings, in ~/.kevmind/config.json. Not Claude's memory or settings: KevMind only reads those.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from './logs.js';

export const configFile = (dataDir) => path.join(dataDir, 'config.json');

export function readConfig(dataDir) {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(dataDir), 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}

export function writeConfig(dataDir, patch) {
  fs.mkdirSync(dataDir, { recursive: true });
  const c = { ...readConfig(dataDir), ...patch };
  atomicWrite(configFile(dataDir), JSON.stringify(c, null, 2) + '\n');
  return c;
}

// The plugin's "experience_tools" option as Claude Code saved it (pluginConfigs in the user's settings.json), or
// undefined when it was never set. The MCP server gets the same value through KEVMIND_EXPERIENCE instead.
// ponytail: user settings only; managed settings can set pluginConfigs too, add them if an org ever does.
export function pluginOption(claudeDir = path.join(os.homedir(), '.claude')) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    for (const [id, v] of Object.entries(s.pluginConfigs || {})) {
      if (/^kevmind(@|$)/.test(id) && v?.options && 'experience_tools' in v.options) return v.options.experience_tools;
    }
  } catch { /* no settings file, or not JSON */ }
  return undefined;
}

const TRUE_RE = /^(1|true|yes|on)$/i;

// Whether the experience tools are on, and why. The config file wins whenever it says on or off, so "off" is
// always respected; otherwise the plugin option; otherwise off.
export function experienceTools(dataDir, option) {
  const c = readConfig(dataDir).experienceTools;
  if (typeof c === 'boolean') return { on: c, source: 'config' };
  const p = optionState(option);
  return p === null ? { on: false, source: 'default' } : { on: p, source: 'plugin' };
}

// The session briefing (src/briefing.js): off unless config.json says on.
export const briefingOn = (dataDir) => readConfig(dataDir).briefing === true;

// true/false for a set plugin option; null when unset. An empty or unsubstituted "${user_config.experience_tools}"
// counts as unset.
export function optionState(option) {
  if (option === undefined || option === null || String(option) === '' || String(option).startsWith('${')) return null;
  return option === true || TRUE_RE.test(String(option));
}
