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
                                                                └─▶ ~/.kevmind/events.jsonl
```

1. Claude Code fires hooks (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, etc.).
2. `send.js` forwards the event to the local server. If the server isn't running, it spools the event to `~/.kevmind/spool.jsonl` and exits: **it never blocks Claude**. The server ingests the spool at its next start, so nothing is lost while the dashboard is down.
3. The server masks secrets (tokens, keys, `.env` lines), stores the event and streams it to the browser.

## Privacy

- Everything stays in `~/.kevmind/`. No telemetry.
- Before storing, it masks API keys, GitHub/AWS/Slack tokens, JWTs, private keys and variables like `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- The server only listens on `127.0.0.1`.
- Events spooled while the dashboard is down are masked by the hook before they touch disk.
- From transcripts, only excerpts of at most 200 characters are kept, masked like everything else. Thinking signatures and redacted thinking are never read, and the transcript itself is never copied.

## Configuration

| Variable       | Default       | What it does       |
| -------------- | ------------- | ------------------ |
| `KEVMIND_PORT` | `4777`        | Dashboard port     |
| `KEVMIND_HOME` | `~/.kevmind`  | Where data is kept |
| `KEVMIND_DEV`  | unset         | `1` reloads the open page when a file in `public/` changes (set by `npm run dev`) |

## Recording a demo

Two URL parameters keep other projects off the screen:

- `http://localhost:4777/?project=KevMind` shows only that project's sessions. The dropdown above the session list does the same and remembers your choice.
- `http://localhost:4777/?focus=latest` hides the session list and shows only the most recently started session, switching to a newer one as soon as it appears.

Combine them to record a single project: `http://localhost:4777/?project=KevMind&focus=latest`.

## Clearing data

```bash
npx kevmind clear          # removes demo sessions from ~/.kevmind/events.jsonl
npx kevmind clear --all    # wipes everything (asks first; --yes skips the question)
```

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
