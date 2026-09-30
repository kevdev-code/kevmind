# KevMind

Local dashboard that watches Claude Code work in real time. Hooks POST events to a Node server, which streams them to a plain HTML/CSS/JS page over SSE.

## Rules

- Code, comments, commit messages and README are in English. The UI is bilingual through `public/i18n.js`: every new UI string needs both `en` and `es`.
- Zero runtime dependencies. Node 18+. Reach for `node:` built-ins before writing anything.
- Never break Claude Code: `hooks/send.js` must always exit 0 and stay fast, whether or not the server is running.
- On Windows, stage files by name (`git add <file>`), never `git add -A`. The repo has `core.filemode=true`, so `-A` silently drops the executable bit on `bin/kevmind.js` and `hooks/send.js`.

## The live dashboard

The user keeps a real dashboard running on port 4777 with real data.

- At the start of a work session, check it is up: `GET http://127.0.0.1:4777/api/sessions`. If it is not, start it detached with `npm run dev -- --background`, so it keeps running after this Claude Code session ends. Its output goes to `~/.kevmind/server.log` and its PID to `~/.kevmind/server.pid`.
- Never ask the user to restart it. Changes under `src/` or `bin/` restart the server automatically, and the open page reloads by itself after a restart or a change under `public/`.
- If it is stuck, run `node bin/kevmind.js restart`. It relaunches the server the same way it was running (dev mode, detached).
- Events sent while the dashboard is down are spooled by the hook and ingested at the next start, so a short outage loses nothing.

## Tests and probes

- Always use a temporary `KEVMIND_HOME` and a non-default `KEVMIND_PORT`, so nothing is ever written to the user's real data or shown in their dashboard.
- Stop every test server you started when you are done.
- `kevmind clear --all` is destructive. Never run it against the real data dir unless the user asks for it.

## Planned

- Coexist with Serena: read `.serena/memories` later. Do not reimplement code indexing here.
