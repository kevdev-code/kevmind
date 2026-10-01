# KevMind

Watch Claude Code work in real time: what it's doing, which agents it runs in parallel, which files it touches and where it fails. Everything runs on your machine; nothing leaves it.

![KevMind dashboard demo](https://raw.githubusercontent.com/kevdev-code/kevmind/main/docs/media/kevmind-demo.gif)

**English** · [Español](README.es.md)

> Status: **MVP (v0.1)**. The live dashboard works. The memory graph and "brain" view come later (see roadmap).

## What it shows

- **Sessions** from the last 24 h, per project, with their status (working, idle, needs your OK).
- **Parallel agents**: a timeline of Claude and every subagent it launches, with each one's action count.
- **Live activity**: every read, edit, command, search and MCP call as it happens.
- **Most-touched files**: how often each file was read and edited.
- **Tools**: uses, errors and average duration.
- **Conflict alerts**: when two agents edit the same file less than 5 minutes apart.
- **What Claude says and thinks**: short excerpts of its replies and of its readable thinking summaries, read from the session transcript, with a toggle to hide the thinking. When reasoning happened but nothing readable came back, the feed says so with the token count.
- **Tokens**: input, output and cache read/write per session and per agent, counted once per API call. No cost estimates: prices change.
- **Memory tab**: what Claude Code and Serena remember about each project, with problems first. It covers the `CLAUDE.md` files and their imports, Claude's auto memory, and Serena's notes. It shows how much context loads at every session start, and flags broken links and imports, notes missing from `MEMORY.md`, a `MEMORY.md` past Claude's 200-line / 25 KB limit, oversized instruction files, outdated file paths, worktree copies, large notes, possible overlaps, and notes no session reads. Each problem has a "Copy fix prompt" button to paste into Claude Code. KevMind itself never edits these files.

The dashboard is available in English and Spanish (toggle in the top-right corner).

It's lightweight: plain HTML and CSS, no 3D, no GPU. Zero dependencies; just Node 18+.

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

## Experience tools for Claude (optional)

KevMind can also answer Claude's questions about a project's history, through three MCP tools built into the plugin. They are **off by default**. Turn them on with

```bash
npx kevmind tools on
```

or with the switch at the top of the **Experience** panel in the dashboard's Memory tab. `kevmind tools off` turns them off, and `kevmind tools status` shows whether they're on and where that comes from. The setting lives in `~/.kevmind/config.json` and takes effect in the next Claude Code session. While they're off, Claude sees no tools from KevMind, so they cost no context.

As an alternative, the plugin has an "Experience tools for Claude" option (`experience_tools`) in `/config`. KevMind's own setting wins when both are set, so "off" is always respected.

- `file_context(paths)`: files that usually change or get read together with the given ones.
- `file_history(path)`: how many work episodes read and edited a file, by which agent types, and how often git changed or fixed it.
- `known_failures(command)`: failures this project has seen before, and what came before the next success.

The evidence comes from two places: KevMind's own record of past Claude Code work, counted in work episodes, and the project's git history (read-only `git log`, the last 365 days or 2,000 commits). Git alone is enough to start, so the tools are useful on any repository from day one.

A work episode is one prompt turn that ends with at least one edit; without prompts, a block of activity separated from the next by more than 30 minutes. Compactions and system messages don't start a new one, so one long session still yields many episodes. Every pattern also has to show up on at least 2 different days, so something that only repeats inside one conversation never qualifies. Each insight has its own threshold; there is no project-wide minimum besides the 20 commits git needs.

Each file belongs to the git repo that holds it. If you run Claude at a repo's root but work in `frontend/` and `backend/`, and those are separate git repos, their history is kept and answered per repo, and the answer names the repo it came from. Repos outside the folder Claude runs in are never answered.

Every answer:

- cites its source and counts on one line, episodes first, such as "changes with `b.ts` (episodes: 5 on 2 days; git: 7 of 12 commits; last 2026-10-21)". Dates and days are in your machine's local time zone. Two files you ask about that change together are reported once, as "usually change together";
- stays under about 400 tokens;
- says "No data:" instead of guessing. Nothing is served below fixed thresholds, for example "edited together in at least 3 episodes on 2 different days and in half the episodes that edited the file", "read first in at least 3 episodes" or "the same failure in at least 2 episodes on 2 days, with the same fix twice". All thresholds live in `src/experience.js`.

KevMind only reports history. It never parses code, indexes symbols or writes memory, so it works alongside Serena (for code structure) and Claude's auto memory. The answers come from `~/.kevmind/experience.json`, which the dashboard keeps up to date, and typically take under 40 ms.

The **Experience** panel in the Memory tab shows what would be served today even while the tools are off, and, once Claude uses them, how many calls were made, the tokens served, and how often a suggested file was then opened compared with a baseline. If that doesn't beat the baseline after 50 calls, the panel tells you to turn the tools off.

## Privacy

- Everything stays in `~/.kevmind/`. No telemetry.
- Before storing, it masks API keys, GitHub/AWS/Slack tokens, JWTs, private keys and variables like `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- The server only listens on `127.0.0.1`.
- Events spooled while the dashboard is down are masked by the hook before they touch disk.
- From transcripts, only excerpts of at most 200 characters are kept, masked like everything else. Thinking signatures and redacted thinking are never read, and the transcript itself is never copied.
- The Memory tab only reads. It shows metadata, descriptions and headings, never full note bodies. From Serena's global config it reads only the project list, never the `auth_secret`. Git is used only through read-only `git ls-tree`.
- The experience tools collect nothing new: they read the already-masked event log and `git log`, only for the project Claude is working in, and never write. `npx kevmind clear --project <name>` removes one project's history.

## Configuration

| Variable       | Default       | What it does       |
| -------------- | ------------- | ------------------ |
| `KEVMIND_PORT` | `4777`        | Dashboard port     |
| `KEVMIND_HOME` | `~/.kevmind`  | Where data is kept |
| `KEVMIND_DEV`  | unset         | `1` reloads the open page when a file in `public/` changes (set by `npm run dev`) |
| `KEVMIND_AUTOSTART` | on       | `0` stops the hook from starting the dashboard at session start |

## Recording a demo

Two URL parameters keep other projects off the screen:

- `http://localhost:4777/?project=KevMind` shows only that project's sessions. The dropdown above the session list does the same and remembers your choice.
- `http://localhost:4777/?focus=latest` hides the session list and shows only the most recently started session, switching to a newer one as soon as it appears.

Combine them to record a single project: `http://localhost:4777/?project=KevMind&focus=latest`.

## Clearing data

```bash
npx kevmind clear                     # removes demo sessions from the event logs
npx kevmind clear --project OdonMind  # removes one project's history (by folder name or path)
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

## Adding a language

UI strings live in [`public/i18n.js`](public/i18n.js). Copy the `en` block, translate it and add a button in `public/index.html`.

## Roadmap

- [ ] Tokens and cost per session and per agent (from transcripts).
- [ ] Replay a past session step by step.
- [ ] Memory graph: `CLAUDE.md` and notes, flagging stale, duplicate or broken-link notes.
- [ ] MCP server so Claude can query its own memory before working.
- [ ] `CLAUDE.md` suggestions based on what Claude keeps re-reading.
- [ ] Optional 3D "brain" view.

## License

MIT
