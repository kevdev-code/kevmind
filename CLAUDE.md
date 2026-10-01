# KevMind

Local dashboard that watches Claude Code work in real time. Hooks POST events to a Node server, which streams them to a plain HTML/CSS/JS page over SSE. The server also tails each active session's transcript (`src/transcript.js`) for what Claude says and thinks, token usage, and the exact identity of subagents; the hook payloads are the fallback when no transcript is available.

## Rules

- Code, comments, commit messages and README are in English. The UI is bilingual through `public/i18n.js`: every new UI string needs both `en` and `es`.
- Zero runtime dependencies. Node 18+. Reach for `node:` built-ins before writing anything.
- Never break Claude Code: `hooks/send.js` must always exit 0 and stay fast, whether or not the server is running.
- On Windows, stage files by name (`git add <file>`), never `git add -A`. The repo has `core.filemode=true`, so `-A` silently drops the executable bit on `bin/kevmind.js` and `hooks/send.js`.
- `npm test` runs the regression tests with Node's built-in runner. When you fix a tracking bug, add a replay of the sequence that exposed it (redacted) to `test/`.
- Transcript data is sensitive: keep only short redacted excerpts, never read thinking signatures or redacted thinking, never copy a transcript into KevMind's data, and never invent cost figures from token counts.
- The experience tools (`src/experience.js`, `mcp/server.js`) only report history: no code parsing, symbols or indexing, ever, and no writes; git only through `git log`. `test/experience-readonly.test.mjs` enforces it. Every threshold is a named constant in `THRESHOLDS` in `src/experience.js`; nothing below a threshold is served, and answers stay under 400 tokens. The dashboard server owns `~/.kevmind/experience.json` (written atomically); the MCP server only reads it. Event logs are monthly, `events-YYYY-MM.jsonl` (`src/logs.js`). Their on/off switch is KevMind's own `~/.kevmind/config.json` (`src/config.js`), written by `kevmind tools on|off` and the dashboard toggle; it wins over the plugin option, and the MCP server only reads it.
- The Memory tab (`src/memory.js`) is read-only by design: it never edits, moves or deletes memory or instruction files, runs git only through `ls-tree`/`show`, and reads only the project list from Serena's config. `test/memory-readonly.test.mjs` enforces this. Its fixes are prompts the user copies, not actions.

## The live dashboard

The user keeps a real dashboard running on port 4777 with real data.

- The hook starts the dashboard by itself at session start when nothing answers on the port, but as a plain server without file watching.
- At the start of a work session, check it: `GET http://127.0.0.1:4777/api/health`. If nothing answers, start it detached with `npm run dev -- --background`, so it keeps running after this Claude Code session ends. If it answers with `"dev": false` (the hook started it), run `node bin/kevmind.js restart --dev` so changes reload it. Its output goes to `~/.kevmind/server.log` and its PID to `~/.kevmind/server.pid`.
- Never ask the user to restart it. Changes under `src/` or `bin/` restart the server automatically, and the open page reloads by itself after a restart or a change under `public/`.
- If it is stuck, run `node bin/kevmind.js restart`. It relaunches the server the same way it was running (dev mode, detached).
- Events sent while the dashboard is down are spooled by the hook and ingested at the next start, so a short outage loses nothing.

## Tests and probes

- Always use a temporary `KEVMIND_HOME` and a non-default `KEVMIND_PORT`, so nothing is ever written to the user's real data or shown in their dashboard.
- Stop every test server you started when you are done.
- `kevmind clear --all` is destructive. Never run it against the real data dir unless the user asks for it.

## Planned

- Coexist with Serena: read `.serena/memories` later. Do not reimplement code indexing here.
