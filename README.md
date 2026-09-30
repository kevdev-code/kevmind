# KevMind

Watch Claude Code work in real time: what it's doing, which agents it runs in parallel, which files it touches and where it fails. Everything runs on your machine; nothing leaves it.

**English** · [Español](README.es.md)

> Status: **MVP (v0.1)**. The live dashboard works. The memory graph and "brain" view come later (see roadmap).

## What it shows

- **Sessions** from the last 24 h, per project, with their status (working, idle, needs your OK).
- **Parallel agents**: a timeline of Claude and every subagent it launches, with each one's action count.
- **Live activity**: every read, edit, command, search and MCP call as it happens.
- **Most-touched files**: how often each file was read and edited.
- **Tools**: uses, errors and average duration.
- **Conflict alerts**: when two agents edit the same file less than 5 minutes apart.

The dashboard is available in English and Spanish (toggle in the top-right corner).

It's lightweight: plain HTML and CSS, no 3D, no GPU. Zero dependencies; just Node 18+.

## Install

### Option A: as a Claude Code plugin (recommended)

```bash
/plugin install <path-or-repo-of-kevmind>
```

The plugin registers the hooks for you. Then open the dashboard:

```bash
npx kevmind
```

### Option B: manual hooks

```bash
npx kevmind install    # adds the hooks to ~/.claude/settings.json (with a backup)
npx kevmind            # opens the dashboard at http://localhost:4777
```

To remove them: `npx kevmind uninstall`.

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
2. `send.js` forwards the event to the local server. If the server isn't running, it exits silently: **it never blocks Claude**.
3. The server masks secrets (tokens, keys, `.env` lines), stores the event and streams it to the browser.

## Privacy

- Everything stays in `~/.kevmind/`. No telemetry.
- Before storing, it masks API keys, GitHub/AWS/Slack tokens, JWTs, private keys and variables like `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`.
- The server only listens on `127.0.0.1`.

## Configuration

| Variable       | Default       | What it does       |
| -------------- | ------------- | ------------------ |
| `KEVMIND_PORT` | `4777`        | Dashboard port     |
| `KEVMIND_HOME` | `~/.kevmind`  | Where data is kept |

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
