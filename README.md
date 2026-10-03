# KevMind

Watch Claude Code work in real time: what it's doing, which agents it runs in parallel, which files it touches and where it fails. Everything runs on your machine; nothing leaves it.

![KevMind dashboard demo](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-demo.gif)

![KevMind Live view in the light theme](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-light.png)

**English** · [Español](README.es.md)

> Status: **0.6** (unreleased). The live dashboard, the Memory tab with its memory suggestions, the project map, the Brain tab and View on your phone work. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## What it shows

- **Sessions** from the last 24 h, grouped by project (most recent first, the current one open), each named by its title or first prompt, with start time and duration; closed sessions older than 2 h fold under "Show closed". Status: working, idle, needs your OK. When a session needs your OK, the browser tab says so even when you are looking at another one: the title starts with "⏸ Needs your OK" and the icon gets an amber dot. No sounds, no notifications.
- **Parallel agents**: a timeline of Claude and every subagent it launches, with each one's action count.
- **Live activity**: every read, edit, command, search and MCP call as it happens.
- **Most-touched files**: how often each file was read and edited.
- **Tools**: uses, errors and average duration.
- **Conflict alerts**: when two agents edit the same file less than 5 minutes apart, grouped by file and pair of agents; the latest three are shown, with "show all".
- **What Claude says and thinks**: short excerpts of its replies and of its readable thinking summaries, read from the session transcript, with a toggle to hide the thinking. When reasoning happened but nothing readable came back, the feed says so with the token count.
- **Tokens**: input, output and cache read/write per session and per agent, counted once per API call. No cost estimates: prices change.
- **Project map**: each project from day one, without any session history: its areas (folders), how busy each one is and how many of its commits were fixes (git), what Claude did there, and which memory notes and `CLAUDE.md` sections talk about it. Built in the background, read-only.
- **Memory tab**: what Claude Code and Serena remember about each project. It covers the `CLAUDE.md` files and their imports, Claude's auto memory, and Serena's notes, and shows how much context loads at every session start. On top, [memory suggestions](#memory-suggestions): short edits to what Claude reads, each with its evidence and the exact text. Below, it flags broken links and imports, notes missing from `MEMORY.md`, a `MEMORY.md` past Claude's 200-line / 25 KB limit, oversized instruction files, worktree copies, large notes and possible overlaps, each with a "Copy fix prompt" button to paste into Claude Code. KevMind itself never edits these files.
- **Brain tab**: everything above as a living 3D brain. Instruction files, memory notes, Serena notes, the code files Claude touched and the tools it used are cells grouped in lobes, one color per kind of knowledge (instructions, docs, logic, interface, memory, tools and tests, infrastructure); their real links are fibers (notes that link or cite code, files that import each other or change together). While a session works, Claude (coral) and its subagents (silver, numbered) travel from file to file along the links between them, leaving a trail, and what they touch glows and cools. When Claude works in several projects at once, "All live sessions" shows them all on the same brain, each tag with its project, and a session waiting for your OK comes first. Each kind of action (read, edit, new file, search, command, web, subagent, waiting for your OK, error) has its own short animation, so you can tell what Claude is doing at a glance. Orbit, zoom, search, filter, click a cell for its details, or turn on Auto-rotate. Only real data, read-only, and it rests completely when nothing happens.

The dashboard is available in English and Spanish, in a dark and a light theme (it follows your system, or pick one with the switch in the top-right corner), and it works at phone width. On wide screens the page stays still and each column (sessions, center, right rail) scrolls on its own; the activity feed scrolls inside its panel.

It's lightweight: plain HTML and CSS with system fonts. Zero dependencies; just Node 18+. It renders only what changed, does no work while idle, and stops rendering while its tab is hidden. The Brain tab is the one place that uses the GPU (WebGL 2, hand-written, still no dependencies): its code loads only when you open it, it draws at most 30 frames a second while something moves and none at rest, and it has a switch to turn animations off. The design system is documented in [DESIGN.md](DESIGN.md).

## The Brain tab

![The Brain tab while a session works: Claude and three subagents travel along the links between files](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-live.webp)

Claude (coral) and its subagents (silver, numbered) at work, on demo data. Every cell is a real file, note or tool and every fiber a real relation; the anatomy is traced from public-domain plates.

https://github.com/user-attachments/assets/a6ae002e-35aa-4a21-8e9f-80fc2a9ad993

A 33-second recording on the same demo data: the intro, agents at work, Auto-rotate, the labels and the Cut. If the player doesn't show (on npm, for example), the file is in the repo: [brain-demo.mp4](https://github.com/kevdev-code/kevmind/raw/main/docs/media/brain-demo.mp4) (4 MB download).

![One short animation per kind of action: read, edit, new file, search, command, web, subagent, needs your OK, error, done](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-actions.webp)

Each kind of action has its own short animation, built only on what the hook events say. The legend is one click away in the tab.

## Install

### Option A: as a Claude Code plugin (recommended)

KevMind is a plugin for Claude Code only; it has nothing to do on claude.ai or in Cowork, which also refuse plugins that ship a top-level `bin/` folder. KevMind keeps its `bin/`, so `kevmind` is on the Bash tool's PATH while the plugin is enabled.

The repository is its own plugin marketplace. In a Claude Code session, add it once and install the plugin from it:

```text
/plugin marketplace add kevdev-code/kevmind
/plugin install kevmind@kevmind
```

The second command opens the plugin's details, where you pick a scope and confirm. On Claude Code 2.1.275 or later, one command does both steps: `/plugin install kevmind --marketplace kevdev-code/kevmind`. From a shell instead of a session:

```bash
claude plugin marketplace add kevdev-code/kevmind
claude plugin install kevmind@kevmind
```

The plugin registers the hooks for you. Then open the dashboard:

```bash
npx kevmind
```

To get a newer version later: `/plugin marketplace update kevmind`, then `/plugin update kevmind@kevmind`.

### Option B: manual hooks

```bash
npx kevmind install    # adds the hooks to ~/.claude/settings.json (with a backup)
npx kevmind            # opens the dashboard at http://localhost:4777
```

To remove them: `npx kevmind uninstall`.

Use one option, not both: with the plugin and the manual hooks installed together, every event would arrive twice. `kevmind install` refuses when it finds the plugin installed (`--force` overrides), and if you installed the hooks manually, run `npx kevmind uninstall` before installing the plugin. The server also drops an exact repeat of an event that arrives within 3 seconds, as a safety net.

You don't have to keep it running yourself: when a Claude Code session starts and nothing answers on the port, the hook starts the dashboard in the background, with no window, and returns at once. Set `KEVMIND_AUTOSTART=0` to turn that off.

`npx kevmind start --background` starts it detached, so it keeps running after you close the terminal (output in `~/.kevmind/server.log`). `npx kevmind stop` closes the running dashboard; `npx kevmind restart` closes it if it's running and starts it again the same way it was started.

### Try it without Claude Code

```bash
npx kevmind demo
```

Simulates a session with three parallel agents. It shows up as project `demo-kevmind` so it's never confused with real data.

## How it works

```
Claude Code ──hook (stdin JSON)──▶ hooks/send.js ──POST──▶ local server :4777 ──SSE──▶ web dashboard
                                                                │
                                                                └─▶ ~/.kevmind/events-YYYY-MM.jsonl (one file per month)
```

1. Claude Code fires hooks (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, etc.).
2. `send.js` forwards the event to the local server. If the server isn't running, it spools the event to `~/.kevmind/spool.jsonl` and exits: **it never blocks Claude**. The server ingests the spool at its next start, so nothing is lost while the dashboard is down.
3. The server masks secrets (tokens, keys, `.env` lines), stores the event and streams it to the browser.

## Memory suggestions

Claude reads `CLAUDE.md` and its memory index at the start of every session, and a nested `CLAUDE.md` when it works in that folder. So KevMind helps by improving what Claude already reads: the Memory tab proposes short edits, each with its evidence and the exact text, and you apply the ones you want. KevMind never writes them.

- **Wrong facts:** a path that no longer exists or moved, a code name the code dropped (`git log -S` tells removed names from planned ones), an `npm run` script no `package.json` has. The edit replaces or removes that exact line; when the line says more than the stale reference, a prompt asks Claude to update it. Notes often tell history on purpose: there, **Keep, it's history** dismisses the suggestion for good.
- **A failure that keeps coming back** with the same fix (the same command and error in at least 2 work episodes on 2 days, fixed the same way at least twice): one line saying what fixes it.
- **Files Claude reads every session without editing them** (in at least half the sessions with work, at least 5 of them, on 3 days): one line with what the file exports and the file it usually changes with. A Read before an Edit doesn't count; Claude Code requires it.
- **Busy or fix-prone areas no note covers:** one line with the commits, the fixes and the files most often fixed.
- **Trims:** the `MEMORY.md` line of a note no session opens, a `CLAUDE.md` section that only cites code nobody touched in 180 days, and an added line that changed nothing.

Every added line stays under 160 characters (about 40 tokens) and goes to the nearest `CLAUDE.md` above the code it names; when that file would pass 200 lines, it becomes a memory note with one line in `MEMORY.md` instead. Each card shows the tokens it adds or saves, the edit as a diff, **Copy text**, **Copy prompt** (the same edit worded for Claude Code) and **Dismiss**. At most 5 are shown per project; the rest are folded.

**Does it help?** When a suggestion's edit shows up in the files (reworded is fine), KevMind measures what it targeted, before and after, over at least 5 sessions on 3 days: whether the failure stops repeating, whether the file is read without being edited in fewer sessions (at least 20 points fewer), whether fewer files are read before the first edit in that area. A line that changed nothing is then suggested for removal, since it costs tokens every time it loads. It's a correlation, not proof, and the panel says so.

Suggestions from code, git and your notes work from day one; those from sessions need about a week of normal use. Work is counted in work episodes: a prompt turn that ends with at least one edit (without prompts, a block of activity separated from the next by more than 30 minutes). Dates and days are in your machine's local time zone. Each file belongs to the git repo that holds it, so a `frontend/` and a `backend/` with their own repos are counted per repo.

**Why not tools or a briefing?** Earlier versions also gave Claude four MCP tools (`file_context`, `file_history`, `known_failures`, `code_map`) and a session briefing. In controlled benchmarks Claude never called the tools on its own, not even with a one-line hint, and the briefing showed no consistent token saving; in two days of real use, the tools were called 4 times in 39 sessions. Both were removed in 0.6.0. [docs/BENCHMARK.md](docs/BENCHMARK.md) records how they were measured.

## Project map

KevMind shouldn't need weeks of sessions to know a project. The first time a project has a Claude Code session, the dashboard builds its map in the background (about a second for a thousand files); `npx kevmind init [path]` or the **Rebuild** button in the Memory tab builds it now.

- **Areas are folders.** A folder with more than 40 code files is split into its subfolders. For each area: its core files and which areas it uses (from imports), commits in the last 90 days and in the last 12 months, how many were labeled fix, reverts, when it last changed (git), what Claude read and edited there and which known failures were fixed there (KevMind's record), and the notes that talk about it.
- **Your memory, organized.** Auto-memory notes, Serena notes and each `CLAUDE.md` section are linked to the areas they cite or name. KevMind never writes or edits a note. Busy areas no note talks about become [memory suggestions](#memory-suggestions); areas many notes cite are flagged with a prompt to copy.
- **Every fact says where it comes from**: code, git, Claude sessions or notes. The memory suggestions are built on it.
- **History window:** 12 months by default; `npx kevmind init --all` (or `--months=N`) reads more.
- The map lives in `~/.kevmind/tree/` (25 KB for a 70-file project, about 0.5 MB for one with 950 files and 1,000 commits). Nothing is written to the project.

## View on your phone

Watch the dashboard from your phone on the same Wi-Fi. Click **View on phone** in the Live tab (or run `npx kevmind share`) and scan the QR code.

<img src="https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/brain-phone.webp" alt="The Brain tab at phone width, on demo data" width="300">

- **Off by default.** Until you turn it on, the dashboard listens on `127.0.0.1` only. While it's on, the header shows **Shared on your network** with a button to stop.
- **Home network only.** It listens on your Wi-Fi or Ethernet address, never on VPN, WSL, Docker or Hyper-V adapters, and nothing goes through the internet (no tunnels).
- **A private link.** Each time you turn it on, KevMind makes a random token. The link carries it, your phone keeps it in a cookie, and anything without it gets a 401. **New link** (or `npx kevmind share new`) makes the old link and QR code stop working at once.
- **Read-only.** The phone can watch everything but can't change settings or sharing.
- **Phone can't connect?** On Windows, allow Node.js on **Private** networks only (never Public), and check that your Wi-Fi is set to Private. The panel and `npx kevmind share` show the exact firewall command.

`npx kevmind share off` stops it; `npx kevmind share status` shows the link again.

## Privacy

- Everything stays in `~/.kevmind/`. No telemetry.
- Before storing, it masks API keys, GitHub/AWS/Slack tokens, JWTs, private keys and variables like `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- The server only listens on `127.0.0.1`, unless you turn on [View on your phone](#view-on-your-phone): then it also listens on your home network, read-only and behind a private link.
- Events spooled while the dashboard is down are masked by the hook before they touch disk.
- From transcripts, only excerpts of at most 200 characters are kept, masked like everything else. Thinking signatures and redacted thinking are never read, and the transcript itself is never copied.
- The Memory tab only reads. It shows metadata, descriptions and headings, never full note bodies. From Serena's global config it reads only the project list, never the `auth_secret`. Git is used only through read-only `git ls-tree`, `git ls-files`, `git log` and `git log -S` (to tell code names that were removed from ones that never existed).
- Memory suggestions are built from what KevMind already has: the masked event log, the project map and the Memory report. KevMind keeps its own record of them in `~/.kevmind/suggestions.json` (which were shown, dismissed and applied, and their evidence: counts and paths, never file contents) and never writes a project file, `CLAUDE.md` or note. Nothing reaches Claude unless you paste it.
- The project map keeps paths, exported names, counts, commit hashes and the subject of revert commits (at most 80 characters); never file contents.
- `npx kevmind clear --project <name>` removes one project's history and map.

## Configuration

| Variable       | Default       | What it does       |
| -------------- | ------------- | ------------------ |
| `KEVMIND_PORT` | `4777`        | Dashboard port     |
| `KEVMIND_HOME` | `~/.kevmind`  | Where data is kept |
| `KEVMIND_DEV`  | unset         | `1` reloads the open page when a file in `public/` changes (set by `npm run dev`) |
| `KEVMIND_AUTOSTART` | on       | `0` stops the hook from starting the dashboard at session start |
| `KEVMIND_SHARE_HOST` | detected | The address [View on your phone](#view-on-your-phone) listens on, if the detected Wi-Fi/Ethernet one is wrong |

## Recording a demo

Two URL parameters keep other projects off the screen:

- `http://localhost:4777/?project=KevMind` shows only that project's sessions. The dropdown above the session list does the same and remembers your choice.
- `http://localhost:4777/?focus=latest` hides the session list and shows only the most recently started session, switching to a newer one as soon as it appears.

Combine them to record a single project: `http://localhost:4777/?project=KevMind&focus=latest`.

## Clearing data

```bash
npx kevmind clear                     # removes demo sessions from the event logs
npx kevmind clear --project my-app  # removes one project's history and map (by folder name or path)
npx kevmind clear --all               # wipes everything (asks first; --yes skips the question)
```

Events are kept in one file per month (`events-YYYY-MM.jsonl`, months in UTC). A single `events.jsonl` from an earlier version is split into monthly files the first time the dashboard starts.

If the dashboard is running, it is stopped and started again so it reflects the change.

## Development

```bash
npm run dev                   # in this terminal
npm run dev -- --background   # detached: keeps running after the terminal closes
```

Restarts the server whenever something under `src/` or `bin/` changes, and the open dashboard reloads itself after a restart or when a file under `public/` changes. No build step, no dependencies. Detached, the output goes to `~/.kevmind/server.log` and the server's PID to `~/.kevmind/server.pid`.

`npm test` runs the regression tests (Node's built-in runner), including a replay of a real session with three parallel subagents.

## Known limitations

- To know which subagent performed each action, KevMind uses the hook's `agent_id` field when Claude Code sends it. If your version doesn't, subagent actions are attributed to "Claude", although the timeline of when each subagent starts and ends still works.
- Each hook starts a Node process (~50 ms). Not noticeable in normal use.
- The Brain tab shows at most 6 live sessions at once, and reads imports only for JavaScript/TypeScript, Dart, Python, PHP, C#, CSS and HTML.

## Adding a language

UI strings live in [`public/i18n.js`](public/i18n.js). Copy the `en` block, translate it and add a button in `public/index.html`.

## Roadmap

- [x] Tokens per session and per agent, from transcripts (no cost estimates: prices change).
- [x] Memory tab: `CLAUDE.md` files, auto memory and Serena notes, flagging stale, duplicate or broken-link notes.
- [x] Brain tab: memory, files, tools and live agents as a 3D brain.
- [x] Brain tab: every live session at once.
- [x] Project map: areas, git history and the notes about each area, from day one.
- [x] Memory suggestions: copyable edits to `CLAUDE.md` and notes, measured after you apply them.
- [ ] Replay a past session step by step.
- Tried and removed: MCP tools for Claude and a session briefing (see [docs/BENCHMARK.md](docs/BENCHMARK.md)).

Current status, decisions and known limitations: [docs/ROADMAP.md](docs/ROADMAP.md).

## License

MIT
