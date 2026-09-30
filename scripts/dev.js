#!/usr/bin/env node
// Runs the dashboard under Node's file watcher so it restarts when src/ or bin/ change.
// --watch-path is only supported on macOS and Windows; Linux gets plain --watch, which restarts on any imported file.
// `--background` hands off to `kevmind start --dev --background`, which detaches this same script.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'kevmind.js');
const args = process.argv.slice(2);

if (args.includes('--background')) {
  process.exit(spawnSync(process.execPath, [BIN, 'start', '--dev', '--background'], { stdio: 'inherit' }).status ?? 0);
}

const watch = process.platform === 'linux' ? ['--watch'] : ['--watch-path=src', '--watch-path=bin'];
const child = spawn(process.execPath, [...watch, BIN, 'start', '--dev', ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  // Detached, this process has no console, and Windows would give the watcher a new visible one
  // (closing it kills the dashboard). Hidden, the watcher's console is inherited by the server it spawns.
  windowsHide: process.env.KEVMIND_DETACHED === '1',
  env: { ...process.env, KEVMIND_WATCHED: '1' }, // lets the server take the watcher down with it on shutdown
});
child.on('exit', (code) => process.exit(code ?? 0));
