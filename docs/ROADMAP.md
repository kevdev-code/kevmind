# KevMind roadmap

Status as of 2026-10-05. Version **0.6.0**. KevMind is three things: watch Claude work live (Live), think in a brain (Brain), and keep its memory healthy (Memory, with the memory suggestions). The MCP tools, the session briefing and every code-graph feature are removed; code structure is left to CodeGraph, Serena or a language server. 0.5.1 brought every live session at once in the Brain; 0.5.0 the Brain tab, View on your phone and import links. What each version changed is in [CHANGELOG.md](../CHANGELOG.md).

## What each phase delivered

**Phase 1: live dashboard (0.1–0.2).** Hooks → local server → SSE page. Sessions of the last 24 h, a timeline of Claude and its parallel subagents, a live activity feed, most-touched files, tools (uses, errors, average time), edit-conflict alerts, what Claude says and thinks (short redacted excerpts from the transcript), tokens per session and agent. Spool while the server is down, auto-start from the SessionStart hook, `kevmind start/stop/restart/clear/demo/install`, Claude Code plugin marketplace, project filter and `?focus=latest`, English/Spanish.

**Phase 2: Memory tab (0.2).** Read-only report per project: `CLAUDE.md` files and imports, Claude's auto memory, Serena notes, what loads at session start (InstructionsLoaded hook), and problems first (broken links/imports, notes missing from `MEMORY.md`, size limits, outdated cited paths, worktree copies, duplicates, notes never read), each with a "copy fix prompt".

**Phase 3: experience data (0.3.x).** KevMind's record of past work: monthly event logs, the `experience.json` aggregate counted in work episodes, `git log`, project wipe (`clear --project`), nested-repo routing, local-time dates, hub partners by lift. Until 0.6.0 it fed an opt-in MCP server (`file_context`, `file_history`, `known_failures`, later `code_map`); it now feeds the memory suggestions, the project map and the Brain.

**Design pass (0.4.x).** PRODUCT.md and DESIGN.md (Impeccable process: critique 25/40 before). OKLCH tokens for dark and light (WCAG AA everywhere), system/dark/light switch, one hue per meaning, rails without cards, status-first Now panel, "needs your OK" in the tab title and favicon, agent status words, grouped conflict alerts capped at 50 per session. Incremental rendering (rAF batching, keyed rows, change-only writes, nothing while hidden). 0.4.1: app shell, sessions grouped by project with titles from the transcript, distinct file names. 0.4.2: sessions that never got going are hidden or folded; new README GIF and light screenshot.

**Phase 4: Brain tab (0.5.x).** Below.

**Phase 5: memory suggestions (0.6.0).** Below.

## Key decisions and why

- **Improve what Claude already reads; add nothing of its own.** Claude always reads `CLAUDE.md` and the memory index; it doesn't call extra tools, and a briefing saved no tokens consistently ([BENCHMARK.md](BENCHMARK.md)). So KevMind proposes edits to those files and measures them, and the user applies them. The MCP tools and the briefing were removed in 0.6.0.
- **Not a code graph.** KevMind reports what happened (sessions, git) and keeps memory healthy. Its code map is an internal engine (the code files, their exported names and identifiers, folder areas) for the project map and the stale-name check; it reads no imports and ranks nothing. Code structure stays with CodeGraph, Serena or a language server; reimplementing it would conflict and cost context. The Brain reads import statements only to draw links between files that are already cells.
- **Work episodes, not sessions.** Many users work in 1–3 long sessions; an episode (a prompt turn ending with an edit) is the unit that repeats.
- **At least 2 distinct local days per insight.** Patterns that only repeat inside one conversation are not knowledge. Days are local, not UTC, so an evening isn't counted twice.
- **Read-only Memory tab.** It reports, suggests and hands out text and prompts; Claude Code (with the user) makes the changes.
- **No cost shown.** Prices change; token counts are exact, money would be a guess.
- **Local only.** 127.0.0.1, no telemetry, no CDN or web fonts, zero runtime dependencies.

## Open items and known limitations

- **Per-event cost:** 3.6–3.9 ms of main thread per event at 5 events/s (goal was 2 ms; was 25 ms). Script is ~0.6 ms; the rest is the browser producing frames. Idle and hidden-tab budgets are met (no layout/paint when idle; ~0.2% CPU hidden).
- **Timeline zoom:** never narrower than 60 s, so in short sessions the bars are slivers at the right edge.
- **Episode evidence is thin at first:** the suggestions from sessions (failures, orientation reads) need about a week of normal use; the event log on the main test machine covered 2.3 days when 0.6.0 was built, and none qualified yet.
- **Long sessions:** the server never prunes a session's agent list, so SSE payloads grow in sessions that launch hundreds of subagents (heap plateaus ~1.3 MB in a 1 h synthetic run).
- **721–1100 px:** two-column layout keeps the page scroll (the app shell is ≥1101 px; Memory ≥901 px).
- **Tooling not in the repo:** the UI benchmark (headless Edge over CDP, synthetic events) and the Live GIF recorder (`kevmind demo` on a test server, `?focus=latest`, screencast frames to ffmpeg) live in session scratch folders; recreate them if needed. The Brain tab's video is recorded by `prototype/brain/bench/record.mjs`.
- **Planned:** read `.serena/memories` in the Memory tab (never reimplement indexing). Re-run the Impeccable critique on the new design.

## Phase 4: Brain tab (0.5.0)

A third tab next to Live and Memory: what KevMind knows about your projects as a living 3D brain. Instruction files, memory notes, Serena notes, the code files Claude touched and the tools it used are cells in lobes (one hue per kind of knowledge); their real links are fibers; the session selected in Live, or every live session at once, plays on it (Claude in coral, subagents in silver). How it looks and why is in [DESIGN.md, section 7](../DESIGN.md); how it was built, measured and integrated is in [BRAIN.md](BRAIN.md).

What the requirements became:

- A separate tab; Live and Memory are as they were, and load none of its code until it is first opened.
- Real data only: `GET /api/brain` builds the graph from the memory report, the experience aggregate, the import statements of the code files in it and tool counts. Read-only. How each kind of link is built: [BRAIN.md](BRAIN.md#the-links-and-what-is-scenery).
- A switch for animations (`prefers-reduced-motion` sets it off by default); idle is fully still unless Auto-rotate is on.
- Nothing renders while the tab is hidden or another view is shown.
- Raw WebGL2, zero dependencies; 30 fps on a high-end discrete GPU at ~600 and ~3,000 nodes; on SwiftShader (the stand-in for a machine without a GPU) 28.8 fps in normal use and about 25 with the camera moving at 3,000 nodes.
- Works on a phone through "View on phone" (read-only), with a lighter brain.
- The session selected in Live, or every live session at once ("All live sessions", at most 6), each Claude tagged with its project.

Known limits:

- A file Claude touches for the first time appears after the next graph refresh (about 6 to 30 s; a file it creates, 2.5 to 8 s, and its cell is born then): the view is rebuilt in place, which shows as a short blink.
- The dots of an edit (lines added and removed) and the files a search matched come from what Claude Code reports when the call ends; a tool that reports neither shows its figure without them.
- At most 1,200 code files per project and 4,000 nodes in all (the most active are kept); tools are shared by all projects.
- Import links are read for JavaScript/TypeScript, Dart, Python, PHP, C#, CSS and HTML, and only between files that are nodes (touched by Claude or cited by a note); Go, Rust, Java, Kotlin and others are not read yet.
- Regions come from folder names (`lobeOfPath` in `public/brain/graph.js`): a project with unusual folder names lands mostly in the parietal lobe.

## Project map (0.6.0)

`src/tree.js`, built by the dashboard for every project with sessions the first time it appears, refreshed incrementally, and on demand (`kevmind init`, the Memory tab's button). Project → areas (folders) → files, each fact with its source; memory notes and `CLAUDE.md` sections linked to the areas they cite or name; the memory suggestions are built on it.

Decisions (2026-10-02): areas by folder rather than import clusters (on the largest test app the busiest import cluster mixed four unrelated features that all imported one form, and notes linked to 45 of 51 folder areas against 28 of 51 clusters); 12 months of git by default, `--all` on demand; area summaries written by a model are left out.

The code behind it (`src/codemap.js`): the code files, their exported names and identifiers by regex (JavaScript, TypeScript, Dart), folder areas. Since 0.6.0 it reads no imports and ranks nothing: a real app of 957 code files in three repos builds in about 455 ms cold and 111 ms warm (255 ms warm when it still scanned imports); KevMind itself in 44 / 27 ms. Its tree takes 542 ms and 429 KB on that app.

Measured on the test machine (map warm means the code map's per-file cache is filled):

| Project | Repos | Code files | Commits (12 months) | Full build | Incremental | On disk |
|---|---|---|---|---|---|---|
| The largest app | 3 | 957 | 1,051 | 1.2 s (memory report 0.3, code map 0.4, tree 0.5) | 0.23 to 0.46 s | 0.5 MB |
| KevMind | 1 | 70 | 115 | 0.2 s | 0.03 to 0.07 s | 25 KB |

Known limits:

- Folder words link a note to an area by name ("billing"); a word the project uses everywhere ("shop" in a shop app) is ignored, but a common word below that (in under a fifth of the notes) can still link loosely. The "many notes" check counts only notes that cite a file or exported name in the area.
- The experience aggregate keeps its own `git log` for "changes together" (365 days or 2,000 commits); the map reads its own window.
- Areas in the Brain view come in a later step.

## Live: subagents that go quiet (0.6.0)

Claude Code now records a background agent's end as a queued `attachment` line in the transcript, which KevMind didn't read: six background subagents of one session stayed "running" with 0 actions for days. The tailer reads it now, and a subagent that stops reporting ends at its last sign of life: after 10 minutes with nothing in progress, after 2 hours while a tool call is still open (a long build or test run says nothing until it ends), at once when its session closes. Live and the Brain follow the same state.

## Phase 5: memory suggestions (0.6.0)

Short, copyable edits to `CLAUDE.md` and memory notes, each with its evidence and the exact text (`src/suggest.js`, the Memory tab's first panel): wrong facts from the docs ↔ code checks, failures that keep coming back with their fix, files read every session without being edited, busy or fix-prone areas no note covers, and trims. Added lines stay under 160 characters and go to the nearest `CLAUDE.md`, or to a memory note when that file would pass 200 lines. KevMind never writes them; when one is applied, it measures what it targeted before and after, and proposes removing a line that changed nothing.

Decisions (2026-10-02): the MCP tools, the tools switch and the session briefing are removed (live counts: 4 tool calls in 39 sessions over 2.3 days, all in KevMind's own repository); the suggestions replace the Memory problems they cover; `CLAUDE.md` by default, a memory note when it is oversized; thresholds in `SUGGEST`.

On real data when it was built: one project's oversized `CLAUDE.md` (256 lines) cited three files that no longer exist, each a list line to remove (−15 to −17 tokens per session), and five fix-prone areas went to memory notes; another project had a README command for a script that doesn't exist and three busy frontend areas, whose lines go to the frontend's own `CLAUDE.md`. The route answers in about 1 ms cached and 6 to 220 ms when it recomputes (mostly the memory report), only while the Memory tab is open.

Known limits:

- The added text is built from facts only (exported names, commits, fixes, co-change), so it says what and where, not why; when there are no facts to say, the card offers a prompt for Claude instead of text.
- "Applied" is detected by the key fact (a path, a command and its fix), not the exact wording: a doc that already mentions the path elsewhere counts.
- A verdict needs 5 sessions on 3 days after the edit, so it takes about a week; the before window is the same number of sessions before it.

## Removed in 0.6.0

- **The session briefing** (0.5.1): a factual note at session start, half the starts withheld to compare. A controlled benchmark (5 tasks on 2 projects, 3 runs per arm, Opus 5.5) found no consistent token saving on isolated fixes.
- **The MCP tools** (0.3–0.5.1): `file_context`, `file_history`, `known_failures` and `code_map` (with a complete-list mode). In a probe on a 950-file app Claude never called them, not even with a one-line hint, and found the answer with Grep alone; in real use they were called 4 times in 39 sessions.
- **Code-graph features** (0.5.1): the code map's import scan, key files (PageRank), shared infrastructure, links between areas, and the Memory tab's lines showing them; the suggestion text that listed a file's exports. CodeGraph covers code graphs.

[BENCHMARK.md](BENCHMARK.md) records both. The code is in the git history (the last commit with them is `05d4d88`).

## Next

- Use 0.6.0 for a while and see what the memory suggestions' outcomes say.
- The Brain's areas from the project map.
- Replay a past session step by step (the Brain tab would be a good stage for it).
