# KevMind roadmap

Status as of 2026-10-01. Version **0.4.2** in the repo; **0.4.1** is on npm (0.4.2 adds the hidden "never got going" sessions and the new demo, and still needs `npm publish`).

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
- **Episode insights are still building:** as of 2026-10-01 KevMind's and OdonMind's episodes are on one local day, so answers come from git only until work repeats on a second day.
- **Long sessions:** the server never prunes a session's agent list, so SSE payloads grow in sessions that launch hundreds of subagents (heap plateaus ~1.3 MB in a 1 h synthetic run).
- **721–1100 px:** two-column layout keeps the page scroll (the app shell is ≥1101 px; Memory ≥901 px).
- **Experience verdict:** "helping / turn off" needs 50 tool calls; none yet.
- **Tooling not in the repo:** the UI benchmark (headless Edge over CDP, synthetic events) and the GIF recorder lived in a session scratch folder; recreate them if needed.
- **Planned:** read `.serena/memories` in the Memory tab (never reimplement indexing). Re-run the Impeccable critique on the new design.

## Next: Phase 4, brain view

An optional, animated view of the project's memory and activity. Requirements:

- A separate tab next to Live and Memory; the everyday panels stay as they are.
- A switch to turn animations off (and `prefers-reduced-motion` respected).
- No rendering at all while the tab is hidden or the view isn't shown.
- Real data only (sessions, files, agents, memory, experience), no decorative fake nodes.
- Smooth with ~3,000 nodes on an integrated GPU; measure it with the same CDP benchmark approach.
- Compare renderer options (e.g. Canvas 2D, WebGL, SVG) with measurements before choosing one; still zero runtime dependencies unless the user agrees otherwise.
- Glows and gradients are allowed here (and only here), per DESIGN.md.
