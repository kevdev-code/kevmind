# Changelog

What changed in each version of KevMind. Dates are local. Versions before 0.5.0 are reconstructed from the commit history.

## 0.5.0 (2026-10-02)

### Added

- **Brain tab.** Everything KevMind knows about your projects as a living 3D brain: instruction files, memory notes, Serena notes, the code files Claude touched and the tools it used are cells, and their real relations are fibers. Real data only, read-only; none of its code loads until the tab is first opened.
  - Anatomy traced from public-domain plates (Gray's Anatomy and an 1892 lateral plate, listed in `docs/reference/SOURCES.md`): cerebrum, cerebellum with its folia, brainstem, corpus callosum.
  - A filament shell, neon cells, one color per region (each lobe holds one kind of knowledge; the colors stay apart for every kind of color vision) and a bloom that takes only what work adds (off on software renderers).
  - Live agents: Claude (coral) and its subagents (silver, numbered) travel from file to file through real links (fewest hops, at most 7, strongest first) and leave a trail. No trail ever leaves the brain's volume.
  - One short animation per kind of action (read, edit, new file, search, command, web, subagent, needs your OK, error, done), built only on what the hook events say, with a legend in English and Spanish. With animations off or reduced motion, a cell only lights up.
  - An intro, orbit, zoom, search, filters with a "Filters active · Reset" hint, a midline Cut, labels, Follow, Auto-rotate and a details panel for each cell.
  - Hand-written WebGL 2, no dependencies: at most 30 frames a second while something moves, none at rest, nothing while the tab is hidden.
- **View on your phone.** Opt-in sharing of the dashboard on the home network (`kevmind share`, or the button in Live), with a QR code. Read-only, behind a private link.
- **Code import detection.** The Brain's "Imports" links are read from the import statements of files that are already cells: JavaScript/TypeScript (with tsconfig/jsconfig aliases), Dart, Python, PHP (composer's PSR-4), C#, CSS and HTML. No symbols, no index.
- Events say what a call did when it ends: lines added and removed, a file created, the files a search matched, how long a command ran. Numbers and paths only, never content.

### Fixed

- Counters say one thing in the singular in both languages ("1 conexión", not "1 conexiones").
- "Needs your OK" ends when the call that asked runs, not at the next call.
- The Brain's labels say one verb plus the file name, never internal notes.

### Security

- The local server answers only loopback Host names, so a web page on another domain that resolves to 127.0.0.1 (DNS rebinding) can't read the dashboard.
- View on your phone is off by default and listens only on the Wi-Fi or Ethernet address (never VPN, WSL, Docker or Hyper-V adapters, no tunnels). Each link carries a random token kept in an HttpOnly, SameSite=Strict cookie; anything without it gets a 401; a new link revokes the old one and closes its open streams; shared devices can only read.
- What a call did is measured before the payload is redacted and cut, and only numbers and paths are kept.
- Tests, fixtures and docs use invented names only.

### Known limitations

- The Brain follows one session at a time (the one selected in Live), not every live session at once.
- Imports are not read yet for Go, Rust, Java, Kotlin, Swift, Ruby, C or C++.

## 0.4.2 (2026-10-01)

- Sessions that never got going are hidden from the sessions rail.
- New README demo GIF and a light-theme screenshot, from `kevmind demo`.

## 0.4.1 (2026-10-01)

- App shell on wide screens: fixed header, each column scrolls on its own.
- Sessions grouped by project, each named by its title from the transcript (the first prompt as fallback).
- Files with the same name are told apart.

## 0.4.0 (2026-10-01, not published to npm)

- Design pass: a calmer dashboard in dark and light themes (OKLCH tokens, WCAG AA), one hue per meaning, "needs your OK" in the tab title and icon.
- Incremental rendering: keyed rows, change-only writes, no per-second work when idle, nothing while the tab is hidden.
- Conflict alerts grouped and capped at 50 per session; every event numbered.

## 0.3.2 (2026-09-30)

- Experience tools: dates and "distinct days" in the machine's local time zone, hub partners ranked by lift, a pair of asked files reported once.

## 0.3.1 (2026-09-30)

- Experience tools: KevMind's own on/off switch (`kevmind tools on|off`, the dashboard toggle), which wins over the plugin option.
- Evidence counted in work episodes instead of sessions; each path answered from the nested git repo that holds it.

## 0.3.0 (2026-09-30)

- Experience tools for Claude: an opt-in MCP server in the plugin (`file_context`, `file_history`, `known_failures`), from KevMind's event log and `git log`.
- Monthly event logs (`events-YYYY-MM.jsonl`).
- `kevmind clear --project <name>` removes one project's history.

## 0.2.0 (2026-09-30)

- Memory tab: what Claude Code and Serena remember about each project, problems first, each with a "Copy fix prompt" (and "Copy all fix prompts").
- InstructionsLoaded hook: what loads at session start.
- The hook starts the dashboard at session start when it isn't running.

## 0.1.0 (2026-09-30)

- First release: the live dashboard. Sessions, a timeline of Claude and its parallel subagents, the activity feed, most-touched files, tools, edit-conflict alerts.
- What Claude says and thinks and tokens per agent, read from the session transcript.
- Events spooled while the server is down; secrets masked before they touch disk.
- Claude Code plugin (the repo is its own marketplace) and `kevmind install` for manual hooks.
- English and Spanish; project filter and focus mode for recording demos.
