# KevMind

Local dashboard that watches Claude Code work in real time. Hooks (`hooks/send.js`) POST events to a Node server (`src/server.js`, state in `src/state.js`), which streams them to a plain HTML/CSS/JS page (`public/`) over SSE. The server also tails each recent session's transcript (`src/transcript.js`) for what Claude says and thinks, token usage, session titles and the exact identity of subagents; hook payloads are the fallback. The Memory tab (`src/memory.js`) reports what Claude Code and Serena remember; the opt-in experience tools (`src/experience.js`, `mcp/server.js`) give Claude a project's history; the Brain tab (`src/brain.js`, `public/brain/`) draws all of it as a living 3D brain.

Status, decisions and what comes next: [docs/ROADMAP.md](docs/ROADMAP.md). Design system: [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md).

## Rules

- Code, comments, commit messages and README are in English. The UI is bilingual through `public/i18n.js`: every new UI string needs both `en` and `es`, with the same keys in both (Spanish runs longer; check it fits).
- Zero runtime dependencies. Node 18+. Reach for `node:` built-ins first. Temporary tools for one-off jobs (ffmpeg, etc.) go in a scratch folder, never in `package.json`.
- Never break Claude Code: `hooks/send.js` must always exit 0 and stay fast, whether or not the server is running.
- Everything stays local: the server listens on 127.0.0.1 only, no telemetry, no CDN or web fonts. Never show cost estimates from token counts.
- The one exception is "View on phone" (`src/share.js`, `public/share.js`, `kevmind share`): off by default, home network only (never VPN/WSL/Docker/Hyper-V adapters, no tunnels), a random token per link (401 without it, a new link revokes the old one and its open streams), read-only (GET/HEAD only; never the share controls or the link itself). `test/share.test.mjs` enforces it and binds to 127.0.0.2 through `KEVMIND_SHARE_HOST`, so tests never open a port on the real network.
- Transcript data is sensitive: keep only short redacted excerpts (titles and prompts are cleaned, redacted and capped at 80 chars), never read thinking signatures or redacted thinking, never copy a transcript into KevMind's data.
- `npm test` runs the regression tests (Node's built-in runner, `test/*.test.mjs`). When you fix a tracking bug, add a replay of the sequence that exposed it (redacted). Pure helpers in `public/app.js` are tested by lifting them from the source (`test/ui-helpers.test.mjs`).

## Data and dates

- Data lives in `~/.kevmind` (or `KEVMIND_HOME`): monthly event logs `events-YYYY-MM.jsonl` (`src/logs.js`, months in UTC), `spool.jsonl` (events sent while the server was down), `experience.json`, `config.json`, `server.log`, `server.pid`.
- Timestamps are stored as epoch ms. Every date shown to the user or to Claude, and every count of "distinct days", uses the machine's local time zone, never UTC.
- Per session the server keeps the newest 300 events and 50 alerts; every event gets an increasing `seq`, which the page uses to key feed rows.

## Experience tools (Phase 3)

- History only: no code parsing, symbols or indexing, ever, and no writes; git only through `git log`. `test/experience-readonly.test.mjs` enforces it. For code structure, Claude uses Serena; KevMind coexists with it and never reimplements indexing.
- Evidence is counted in work episodes (a prompt turn that ends with at least one edit; without prompts, a block separated by more than 30 min). Every episode-based insight also needs at least 2 distinct local days. Every threshold is a named constant in `THRESHOLDS` in `src/experience.js`; nothing below a threshold is served; answers stay under 400 tokens and cite their counts.
- Paths are routed to the git repo that holds them when it is nested inside the session's folder (e.g. `frontend/` with its own `.git`); repos outside the session folder are never answered.
- The dashboard server owns `~/.kevmind/experience.json` (written atomically); the MCP server only reads it. The on/off switch is `~/.kevmind/config.json` (`src/config.js`), written by `kevmind tools on|off` and the dashboard toggle; it wins over the plugin option. Changes take effect in the next Claude Code session.

## Memory tab (Phase 2)

Read-only by design: it never edits, moves or deletes memory or instruction files, runs git only through `ls-tree`/`show`, and reads only the project list from Serena's config (never its secrets). `test/memory-readonly.test.mjs` enforces this. Its fixes are prompts the user copies, not actions.

## Brain tab (Phase 4)

- Real data only: a node is a real file or tool, a link a real relation. `src/brain.js` builds the graph (`GET /api/brain`) from the memory report, the experience aggregate (with its thresholds) and tool counts from the logs; it only reads (`test/brain.test.mjs` enforces it). Never add decorative nodes; the shell, the tracts and the stars are scenery and are never counted.
- Import links (`src/imports.js`) read only the import statements of files that are already nodes: never symbols, never an index, never a file nobody touched (Serena stays the tool for code structure). Each import is resolved to a file the way its language does (JS/TS with tsconfig/jsconfig aliases, Dart, Python, PHP through composer's PSR-4, C# by namespace and type name, CSS, HTML); it is a link only when that file is a node too, and it never adds one. `test/imports.test.mjs` holds the real-world import styles: a new language or style gets a case there.
- The view lives in `public/brain/` (`view.js` mounts it, `gl.js` renders, `layout.js` and `shape.js` are the brain, `graph.js` places nodes, `brain.css` is scoped to `.brain-view`). None of it loads until the tab is first opened (`public/brain.js` is the glue); Live and Memory pay nothing for it. Its words are the `brain` block of `public/i18n.js`.
- It follows the session selected in Live: past events are applied at once (no animation), new ones play. A file the graph doesn't have yet makes the page ask for a newer graph and rebuild the view where it was.
- Owner's rules (DESIGN.md section 7): idle is fully still, and Auto-rotate is the one exception because the user turns it on (it never pauses for activity, only for the user's hand); agents are told from regions by kind, never by hue (subagents silver, Claude coral); the bloom takes only what work adds and is off on software renderers; nothing renders while the tab or the view is hidden. An agent's trip goes through the network: over real links (fewest hops, at most 7, strongest first, whatever the filters show; `pathFinder` in `graph.js`) or, with no path, along the lane between the lobes, never through unrelated files; and no trail ever leaves the brain's volume (`pathInside` in `layout.js`, tested). The tract bundles are the links that are shown, added up.
- `prototype/brain/` is the benchmark harness: the same view on synthetic data (`data.js`) at ~600 and ~3,000 nodes, with `bench/run.mjs` (headless Edge, the RTX and SwiftShader as the worst case). Any rendering change is measured there before and after, and the numbers go in `docs/BRAIN.md`.

## UI and performance budget

- Follow DESIGN.md: OKLCH tokens for dark and light, one hue per meaning (working green, waiting amber, error red, read blue, edit pink; tools and finished work neutral), purple only for selection/focus/primary, system fonts, 12px floor, no side-stripe borders, no uppercase eyebrows, no glows or gradients (reserved for the Brain view's well).
- WCAG AA in both themes for every text pair (check the contrast of any new color on every surface it appears on), state never by color alone, keyboard reachable with a visible focus ring, `prefers-reduced-motion` respected, works at phone width (no sideways scroll at 375 px).
- Motion only for a real change (a new feed row at a calm pace, a running agent), transform/opacity only, nothing looping when idle.
- Rendering: SSE messages update state and request one animation frame; rows are keyed and updated in place; write only what changed (`setText`, `setClass`, `patchHTML`); no per-second layout or paint when idle; nothing renders and nothing polls while the tab is hidden (only the tab title/favicon follow "needs your OK"). Any UI change that could cost CPU gets measured before and after (idle CPU, layouts/paints per second, ms per event at 5 events/s, hidden-tab cost, heap/nodes/listeners over time) with headless Edge over CDP on a test server.
- Wide screens use an app shell (fixed header, each column scrolls); phones keep normal page scroll.

## The live dashboard

The user keeps a real dashboard running on port 4777 with real data.

- The hook starts the dashboard by itself at session start when nothing answers on the port (`KEVMIND_AUTOSTART=0` disables it), but as a plain server without file watching.
- At the start of a work session, check it: `GET http://127.0.0.1:4777/api/health`. If nothing answers, start it detached with `npm run dev -- --background`, so it keeps running after this Claude Code session ends. If it answers with `"dev": false`, run `node bin/kevmind.js restart --dev` so changes reload it. Output goes to `~/.kevmind/server.log`, the PID to `~/.kevmind/server.pid`.
- Never ask the user to restart it. Changes under `src/` or `bin/` restart the server automatically, and the open page reloads by itself after a restart or a change under `public/`.
- If it is stuck, run `node bin/kevmind.js restart`. It relaunches the server the same way it was running.
- It's fine to verify features on the real dashboard by reading it (the user asks for real-data results); never write test events into it.

## Tests and probes

- Always use a temporary `KEVMIND_HOME` and a non-default `KEVMIND_PORT`, so nothing is written to the user's real data or shown in their dashboard. `kevmind demo` data (session ids `demo-…`, project `demo-kevmind`) is for demos and recordings only.
- Stop every test server you started when you are done.
- `kevmind clear --all` is destructive. Never run it against the real data dir unless the user asks for it.

## Windows notes

- Stage files by name (`git add <file>`), never `git add -A`: the repo has `core.filemode=true`, and `-A` silently drops the executable bit on `bin/kevmind.js`, `hooks/send.js` and `mcp/server.js`. After committing, `git ls-files -s` on those three should show `100755`. CRLF warnings on commit are expected.
- The Bash tool strips one level of backslashes, even inside quoted heredocs. Write scripts and tests that contain backslashes (Windows paths, regex escapes, `\n` in strings) with the file tools, or build them at runtime (`String.fromCharCode(92)`). Import local `.mjs` files with `file:///C:/...` URLs.
- Headless Edge for screenshots and benchmarks: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; Node 24's global `WebSocket` drives it over CDP with no dependencies.

## Commits, versions, publishing

- Commit in logical steps, staged by name, and push when a request is done. End commit messages with the `Co-Authored-By` trailer the harness gives.
- Run `npm test` before every commit and `claude plugin validate .` after any change to `.claude-plugin/`.
- A version bump changes `package.json` and `.claude-plugin/plugin.json` together (the plugin version pins installed users until it changes). The user publishes to npm; never run `npm publish`. A version already on npm can't be republished, so changes after a publish need a new patch version.
