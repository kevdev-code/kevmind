# KevMind

Local dashboard with three parts: watch Claude Code work live (Live), think in a brain (Brain), and keep its memory healthy (Memory). It is not a code graph: code structure is left to CodeGraph, Serena or a language server, and nothing here offers it to Claude or the user. Hooks (`hooks/send.js`) POST events to a Node server (`src/server.js`, state in `src/state.js`), which streams them to a plain HTML/CSS/JS page (`public/`) over SSE. The server also tails each recent session's transcript (`src/transcript.js`) for what Claude says and thinks, token usage, session titles and the exact identity of subagents; hook payloads are the fallback. The Memory tab (`src/memory.js`) reports what Claude Code and Serena remember; the project map (`src/tree.js`) is each project's baseline from its code (`src/codemap.js`), git and memory; the memory suggestions (`src/suggest.js`) turn it, with KevMind's record of past sessions (`src/experience.js`), into short edits to what Claude reads; the Brain tab (`src/brain.js`, `public/brain/`) draws all of it as a living 3D brain.

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

- Data lives in `~/.kevmind` (or `KEVMIND_HOME`): monthly event logs `events-YYYY-MM.jsonl` (`src/logs.js`, months in UTC), `spool.jsonl` (events sent while the server was down), `experience.json`, `tree/<project>.json` (each project's map), `suggestions.json` (memory suggestions shown, dismissed and applied), `server.log`, `server.pid`.
- Timestamps are stored as epoch ms. Every date shown to the user or to Claude, and every count of "distinct days", uses the machine's local time zone, never UTC.
- Per session the server keeps the newest 300 events and 50 alerts; every event gets an increasing `seq`, which the page uses to key feed rows.
- A subagent that stops reporting ends at its last sign of life (a hook event or a line of its own transcript) with status `quiet` (`expireAgents` in `src/state.js`, swept every 15 s by the server): after `AGENT_QUIET_MS` (10 min) with nothing in progress, after `AGENT_BUSY_MS` (2 h) while one of its tool calls is open, at once when its session has ended. A real end arriving later still wins; an action after it brings the agent back. Background agents also end from task notifications in the transcript, as user lines (older Claude Code) or queued `attachment` lines (newer). `test/agents-quiet.test.mjs` holds the cases.

## Memory suggestions

- KevMind helps by improving what Claude already reads (`CLAUDE.md`, the memory index and notes), never by adding tools or context of its own: an MCP server and a session briefing were tried and removed in 0.6.0 (`docs/BENCHMARK.md`). Don't bring them back without new evidence.
- `src/suggest.js` builds the suggestions from facts only, no model: the Memory report's docs ↔ code checks (a line about a missing path is removed, a moved path replaced, otherwise a prompt), failures that keep coming back with the same fix, files read without being edited in most sessions, busy or fix-prone areas no note covers (`tree.gaps.quiet`), and trims (a note no session opens, a section citing only dormant code, an applied line that changed nothing). Each has its evidence (numbers and paths), the exact edit and its token delta. Ranked by kind; at most `SUGGEST.shown` per project, the rest folded. Every threshold is in `SUGGEST`.
- Added lines stay under `SUGGEST.maxChars` (160): `CLAUDE.md` loads every session. They go to the nearest `CLAUDE.md` above the code they name, placed after the last line that mentions it; when that file would pass 200 lines, a memory note with its `MEMORY.md` line instead. Text is English; the cards are bilingual.
- KevMind never writes them. The user copies the text or a prompt for Claude; prompts describe one edit and say "change nothing else". Notes can tell history on purpose: their fixes rank lower, and "Keep, it's history" is a remembered dismissal.
- The server owns `~/.kevmind/suggestions.json` (atomic writes): when each suggestion was first shown, dismissed (and why), and applied (the stale line is gone, or a doc names what the added line names). Applied ones are measured on what they targeted, before and after, with a verdict only after `verdictSessions` sessions on `verdictDays` days (`outcome()`); one that changed nothing is proposed for removal (`retire()`). Correlation, never proof; the panel says so.
- `src/suggest.js` only reads (`test/suggest.test.mjs` enforces it and covers each kind). The problems a suggestion covers (`COVERED`) leave the Memory problems list: one list, not two.

## Experience data and the code map

- `src/experience.js` keeps KevMind's record of past sessions (`~/.kevmind/experience.json`, owned by the dashboard server, written atomically): evidence is counted in work episodes (a prompt turn that ends with at least one edit; without prompts, a block separated by more than 30 min), and every episode-based insight also needs at least 2 distinct local days. Every threshold is in `THRESHOLDS`. History only: no code parsing, no writes; git only `log`.
- `src/codemap.js` is an internal engine for the project map and the stale-name check, not a code graph: the code files, the names they export and the identifiers they use (regex: JS/TS and Dart), folder areas, a per-file cache keyed by size and mtime. No imports, ranking, references or anything that describes code structure; git only `ls-files` and `log` (`log -S` for names the docs still mention). `test/experience-readonly.test.mjs` enforces both. Don't grow it into a code graph.
- Paths are routed to the git repo that holds them when it is nested inside the session's folder (e.g. `frontend/` with its own `.git`); repos outside the session folder are never counted.

## Memory tab (Phase 2)

Read-only by design: it never edits, moves or deletes memory or instruction files, runs git only through `ls-tree`/`show`, and reads only the project list from Serena's config (never its secrets). `test/memory-readonly.test.mjs` enforces this. Its fixes are prompts the user copies, not actions.

Docs ↔ code checks (shown as memory suggestions): `npm run <script>` (or bun, pnpm, yarn) that no package.json of the project has, and code names in backticks that no code file has anymore, flagged only when `git log -S` (through `codemap.js`, never `memory.js`) shows they were in the code before, never in a negated sentence. Names never in the code are planned work or not code: not flagged. `test/codemap.test.mjs` holds the cases.

## Project map (knowledge tree)

- `src/tree.js` builds each project's baseline so KevMind is useful before any session: project → areas → files. Areas are folders (`areas()` in `src/codemap.js`: a folder with more than `MAP.areaMax` code files splits into its subfolders; smaller subfolders stay with their parent). Every fact carries its source: code files, git (12 months by default, `--all` on demand), Claude sessions (the experience aggregate), notes.
- Memory is linked, never written: auto-memory notes, Serena notes and `CLAUDE.md` sections (nested repos' too) link to the areas they cite (paths, exported names) or name (folder words, unless the project uses the word everywhere). Gap checks: busy or fragile areas no note talks about (a memory suggestion), areas cited by many notes (a Memory problem with a prompt that describes; it never asks Claude to write or judge a note on its own). Thresholds in `TREE`.
- Read-only on the project; git only `log` through one guarded helper (`test/tree.test.mjs`). The dashboard server owns `~/.kevmind/tree/<project>.json` (atomic writes). Built for every project with sessions the first time it appears, refreshed incrementally when its Memory tab is open or a session starts (at most every `TREE.refreshMs`), and on demand (`kevmind init`, the Memory tab's button).

## Brain tab (Phase 4)

- Real data only: a node is a real file or tool, a link a real relation. `src/brain.js` builds the graph (`GET /api/brain`) from the memory report, the experience aggregate (with its thresholds) and tool counts from the logs; it only reads (`test/brain.test.mjs` enforces it). Never add decorative nodes; the shell, the tracts and the stars are scenery and are never counted.
- Import links (`src/imports.js`) read only the import statements of files that are already nodes: never symbols, never an index, never a file nobody touched (code structure is CodeGraph's or Serena's). Each import is resolved to a file the way its language does (JS/TS with tsconfig/jsconfig aliases, Dart, Python, PHP through composer's PSR-4, C# by namespace and type name, CSS, HTML); it is a link only when that file is a node too, and it never adds one. `test/imports.test.mjs` holds the real-world import styles: a new language or style gets a case there.
- The view lives in `public/brain/` (`view.js` mounts it, `gl.js` renders, `layout.js` and `shape.js` are the brain, `graph.js` places nodes, `brain.css` is scoped to `.brain-view`). None of it loads until the tab is first opened (`public/brain.js` is the glue); Live and Memory pay nothing for it. Its words are the `brain` block of `public/i18n.js`.
- It follows the session selected in Live, or every live session at once ("All live sessions": working, waiting for the OK, or active in the last 10 minutes after a prompt; waiting ones first, at most 6; the switch is remembered, and until it is set the brain shows all of them whenever more than one is live). Past events are applied at once (no animation), new ones play. A file, or a live session's project, the graph doesn't have yet makes the page ask for a newer graph and rebuild the view where it was. With several sessions every event carries its session and each has its own Claude and subagents (agent key `<session>/<agent>` in the view); `test/brain-sessions.test.mjs` covers them.
- Design rules (DESIGN.md section 7): idle is fully still, and Auto-rotate is the one exception because the user turns it on (it never pauses for activity, only for the user's hand); agents are told from regions by kind, never by hue (subagents silver, Claude coral); the bloom takes only what work adds and is off on software renderers; nothing renders while the tab or the view is hidden. An agent's trip goes through the network: over real links (fewest hops, at most 7, strongest first, whatever the filters show; `pathFinder` in `graph.js`) or, with no path, along the lane between the lobes, never through unrelated files; and no trail ever leaves the brain's volume (`pathInside` in `layout.js`, tested). The tract bundles are the links that are shown, added up.
- Each kind of action has its own short figure (read, edit, new file, search, command, web, subagent, needs your OK, error, done; DESIGN.md section 7), built only on what the hook events say. What a call did is written on its event when it ends (`outcomeOf` in `src/state.js`: lines added and removed, a file created, the files a search matched, how long a command ran) as numbers and paths, never content, measured before the payload is redacted and cut. No count, no particles: never invent a number. The web's beam is the only signal that may leave the brain. With animations off (or reduced motion) a cell only lights up in its kind's color.
- `prototype/brain/` is the benchmark harness: the same view on synthetic data (`data.js`) at ~600 and ~3,000 nodes, with `bench/run.mjs` (headless Edge, the discrete GPU and SwiftShader as the worst case). Any rendering change is measured there before and after, and the numbers go in `docs/BRAIN.md`.

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

- Stage files by name (`git add <file>`), never `git add -A`: the repo has `core.filemode=true`, and `-A` silently drops the executable bit on `bin/kevmind.js` and `hooks/send.js`. After committing, `git ls-files -s` on those two should show `100755`. CRLF warnings on commit are expected.
- The Bash tool strips one level of backslashes, even inside quoted heredocs. Write scripts and tests that contain backslashes (Windows paths, regex escapes, `\n` in strings) with the file tools, or build them at runtime (`String.fromCharCode(92)`). Import local `.mjs` files with `file:///C:/...` URLs.
- Headless Edge for screenshots and benchmarks: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; Node 24's global `WebSocket` drives it over CDP with no dependencies.

## Commits, versions, publishing

- Commit in logical steps, staged by name, and push when a request is done. End commit messages with the `Co-Authored-By` trailer the harness gives.
- Run `npm test` before every commit and `claude plugin validate .` after any change to `.claude-plugin/`.
- A version bump changes `package.json` and `.claude-plugin/plugin.json` together (the plugin version pins installed users until it changes). The user publishes to npm; never run `npm publish`. A version already on npm can't be republished, so changes after a publish need a new patch version.
