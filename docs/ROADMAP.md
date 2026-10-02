# KevMind roadmap

Status as of 2026-10-02. Version **0.5.0**, on npm: the Brain tab, View on your phone and import links. What each version changed is in [CHANGELOG.md](../CHANGELOG.md).

## What each phase delivered

**Phase 1: live dashboard (0.1–0.2).** Hooks → local server → SSE page. Sessions of the last 24 h, a timeline of Claude and its parallel subagents, a live activity feed, most-touched files, tools (uses, errors, average time), edit-conflict alerts, what Claude says and thinks (short redacted excerpts from the transcript), tokens per session and agent. Spool while the server is down, auto-start from the SessionStart hook, `kevmind start/stop/restart/clear/demo/install`, Claude Code plugin marketplace, project filter and `?focus=latest`, English/Spanish.

**Phase 2: Memory tab (0.2).** Read-only report per project: `CLAUDE.md` files and imports, Claude's auto memory, Serena notes, what loads at session start (InstructionsLoaded hook), and problems first (broken links/imports, notes missing from `MEMORY.md`, size limits, outdated cited paths, worktree copies, duplicates, notes never read), each with a "copy fix prompt".

**Phase 3: experience tools (0.3.x).** Opt-in MCP server in the plugin with `file_context`, `file_history`, `known_failures`: which files change or get read together, a file's history, recurring failures and what fixed them. Evidence from KevMind's event log (work episodes) and `git log`. Monthly event logs, `experience.json` aggregate, project wipe (`clear --project`), on/off switch (`kevmind tools on|off`, dashboard toggle, config file wins over the plugin option), nested-repo routing, local-time dates, hub partners by lift, a measurement panel (calls, tokens, follow rate vs a baseline).

**Design pass (0.4.x).** PRODUCT.md and DESIGN.md (Impeccable process: critique 25/40 before). OKLCH tokens for dark and light (WCAG AA everywhere), system/dark/light switch, one hue per meaning, rails without cards, status-first Now panel, "needs your OK" in the tab title and favicon, agent status words, grouped conflict alerts capped at 50 per session. Incremental rendering (rAF batching, keyed rows, change-only writes, nothing while hidden). 0.4.1: app shell, sessions grouped by project with titles from the transcript, distinct file names. 0.4.2: sessions that never got going are hidden or folded; new README GIF and light screenshot.

## Key decisions and why

- **History only, no code parsing; coexist with Serena.** Serena already indexes code; KevMind reports what happened (sessions, git). Two tools doing structure would conflict and cost context.
- **Work episodes, not sessions.** Many users (the owner included) work in 1–3 long sessions; an episode (a prompt turn ending with an edit) is the unit that repeats.
- **At least 2 distinct local days per insight.** Patterns that only repeat inside one conversation are not knowledge. Days are local, not UTC, so an evening isn't counted twice.
- **Read-only Memory tab.** It reports and hands out fix prompts; Claude Code (with the user) makes the changes.
- **Experience tools opt-in via `kevmind tools`.** Off costs zero context (`tools/list` is empty). The desktop app can't change plugin options, so KevMind has its own switch.
- **No cost shown.** Prices change; token counts are exact, money would be a guess.
- **Local only.** 127.0.0.1, no telemetry, no CDN or web fonts, zero runtime dependencies.

## Open items and known limitations

- **Per-event cost:** 3.6–3.9 ms of main thread per event at 5 events/s (goal was 2 ms; was 25 ms). Script is ~0.6 ms; the rest is the browser producing frames. Idle and hidden-tab budgets are met (no layout/paint when idle; ~0.2% CPU hidden).
- **Timeline zoom:** never narrower than 60 s, so in short sessions the bars are slivers at the right edge.
- **Episode insights are thin:** as of 2026-10-02 few patterns pass the thresholds on the owner's machine (one "read before edit" pair; most "changed together" answers come from git, see [BRAIN.md](BRAIN.md#the-links-and-what-is-scenery)). Projects with only 2 or 3 edit episodes get git answers only.
- **Long sessions:** the server never prunes a session's agent list, so SSE payloads grow in sessions that launch hundreds of subagents (heap plateaus ~1.3 MB in a 1 h synthetic run).
- **721–1100 px:** two-column layout keeps the page scroll (the app shell is ≥1101 px; Memory ≥901 px).
- **Experience verdict:** "helping / turn off" needs 50 tool calls first.
- **Tooling not in the repo:** the UI benchmark (headless Edge over CDP, synthetic events) and the Live GIF recorder (`kevmind demo` on a test server, `?focus=latest`, screencast frames to ffmpeg) live in session scratch folders; recreate them if needed. The Brain tab's video is recorded by `prototype/brain/bench/record.mjs`.
- **Planned:** read `.serena/memories` in the Memory tab (never reimplement indexing). Re-run the Impeccable critique on the new design.

## Phase 4: Brain tab (0.5.0)

A third tab next to Live and Memory: what KevMind knows about your projects as a living 3D brain. Instruction files, memory notes, Serena notes, the code files Claude touched and the tools it used are cells in lobes (one hue per kind of knowledge); their real links are fibers; the session selected in Live, or every live session at once, plays on it (Claude in coral, subagents in silver). How it looks and why is in [DESIGN.md, section 7](../DESIGN.md); how it was built, measured and integrated is in [BRAIN.md](BRAIN.md).

What the requirements became:

- A separate tab; Live and Memory are as they were, and load none of its code until it is first opened.
- Real data only: `GET /api/brain` builds the graph from the memory report, the experience aggregate, the import statements of the code files in it and tool counts. Read-only. How each kind of link is built: [BRAIN.md](BRAIN.md#the-links-and-what-is-scenery).
- A switch for animations (`prefers-reduced-motion` sets it off by default); idle is fully still unless Auto-rotate is on.
- Nothing renders while the tab is hidden or another view is shown.
- Raw WebGL2, zero dependencies; 30 fps on the RTX at ~600 and ~3,000 nodes; on SwiftShader (the stand-in for a machine without a GPU) 28.8 fps in normal use and about 25 with the camera moving at 3,000 nodes.
- Works on a phone through "View on phone" (read-only), with a lighter brain.
- The session selected in Live, or every live session at once ("All live sessions", at most 6), each Claude tagged with its project.

Known limits:

- A file Claude touches for the first time appears after the next graph refresh (about 6 to 30 s; a file it creates, 2.5 to 8 s, and its cell is born then): the view is rebuilt in place, which shows as a short blink.
- The dots of an edit (lines added and removed) and the files a search matched come from what Claude Code reports when the call ends; a tool that reports neither shows its figure without them.
- At most 1,200 code files per project and 4,000 nodes in all (the most active are kept); tools are shared by all projects.
- Import links are read for JavaScript/TypeScript, Dart, Python, PHP, C#, CSS and HTML, and only between files that are nodes (touched by Claude or cited by a note); Go, Rust, Java, Kotlin and others are not read yet.
- Regions come from folder names (`lobeOfPath` in `public/brain/graph.js`): a project with unusual folder names lands mostly in the parietal lobe.

## Session briefing (v1, Unreleased)

A short, factual note for Claude at each session start (`src/briefing.js`, `hooks/brief.js`), off by default, measured against starts without it. Design and examples on real data: the owner's local design doc (`.claude/design/code-map-and-briefing.md`, git-ignored). Decisions (2026-10-02): the narrower rule for the code map is approved (reads import/export statements and names, keeps a per-file cache, read-only, never type-checks or edits; CLAUDE.md, README and the tool descriptions change when it is built); read-only `git ls-files` and `git status --porcelain` are approved (the briefing uses `status`); Serena stays optional for exact references; the briefing and the code map are each off by default with their own switch.

Known limits:

- The verdict needs 20 measured starts on each side; with a few working sessions a day, expect weeks.
- A session's last reply and its running subagents are known only for sessions of the last 24 hours (the server's live state); older ones get the rest.
- Tokens come from the transcript tailer, which follows sessions of the last 24 hours: a start whose stretch settles later is measured without tokens.

## Next

- The code map (exported names and who uses them, key files, areas, one MCP query tool, docs-vs-code name checks), then briefing v2 (map lines) as a new arm of the same measurement.

- Replay a past session step by step (the Brain tab would be a good stage for it).
- `CLAUDE.md` suggestions based on what Claude keeps re-reading.
