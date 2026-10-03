# What was tried: the session briefing and the MCP tools

Until 0.5, KevMind also gave Claude context of its own: a short briefing at session start, and four MCP tools to ask about a project's history and code. In October 2026 both were measured. **The briefing showed no consistent token saving, and Claude never called the tools on its own.** Both were removed in 0.6.0; KevMind now helps by improving what Claude already reads (`CLAUDE.md` and memory, through the Memory tab's suggestions). This page is the record of how they were measured.

## The session briefing: a controlled benchmark

Did the briefing make Claude Code cheaper on a task? **Result: no consistent token saving on isolated fixes.**

### Setup

- **Model and tool:** Claude Opus 5.5 (1M context), Claude Code 2.1.288, headless (`claude -p`), the user's settings, plugins and MCP servers left out.
- **Two arms:** the briefing that a session starting at that commit would have received (v2: KevMind's records up to that moment, git, and the project map), handed over at session start by a one-file plugin, against nothing. The text is the same for every run of a task. KevMind's MCP tools are off in both arms.
- **Tasks:** five past bug fixes, each with its own regression test, on two projects:
  - KevMind: three fixes (commits `6eb8790`, `4b4a281`, `25a03bb`: shell syntax errors counted as known failures, unbounded conflict alerts, session titles).
  - A private web application of about 950 code files in three repositories: two fixes (one in the frontend, one in the backend), plus a control task whose prompt named the functions to write, so it needed little exploring. The control is reported apart and left out of the verdict.
- **Each run:** a fresh git worktree at the fix's parent commit (for the multi-repo project, every repo as it was then), the task described as a user would, with the contract the test checks but not the fix. Afterwards the fix commit's own tests are copied in: success means they pass, and so does the rest of the unit suite.
- **Three runs per arm,** one at a time, alternating with and without. Tokens are input, output, cache reads and cache writes, as Claude Code reports them.
- **Verdict rule, fixed before the runs:** "saves tokens" only if every task's median uses at least 10% fewer tokens with the briefing and succeeds no less often.

The runner was `prototype/briefing-bench/`, removed in 0.6.0 (it is in the git history up to commit `05d4d88`); the private project's task file was never in the repository.

### Results (medians of 3 runs per arm)

| Project | Task | Success with / without | Tokens with | Tokens without | Change |
|---|---|---|---|---|---|
| KevMind | Shell errors as known failures | 3/3 · 3/3 | 1.07 M | 1.05 M | +2% |
| KevMind | Cap conflict alerts, number events | 3/3 · 3/3 | 508 k | 651 k | −22% |
| KevMind | Session titles | 3/3 · 3/3 | 359 k | 415 k | −14% |
| Private app | Frontend fix | 3/3 · 3/3 | 788 k | 839 k | −6% |
| Private app | Backend fix | 2/3 · 3/3 | 920 k | 860 k | +7% |
| Private app | Control (functions named) | 3/3 · 3/3 | 570 k | 585 k | −3% |

Over the five tasks (control left out): 2 used at least 10% fewer tokens with the briefing, none used 10% more, and the median ratio (with / without) was 0.94. Successes: 14 of 15 with, 15 of 15 without. **Verdict: unclear.** About 32 M tokens were spent in all.

### Limits

- **Small sample.** Runs of the same task in the same arm varied by up to about 50%, so three runs per arm only show large effects. A first single run of the backend fix suggested −22%; with three runs it was +7%.
- **Thin briefings on the private app.** KevMind had recorded no work on it before those commits, so its briefings held only git and the key files of the project map, not where the last session left off.
- **The backend fix's hidden test accepted one approach only.** It checks that the stored time zone is set for the database session before the queries run. One run converted each date in the query instead, which is also a valid fix, and failed the test; it counts as a failure here.
- **A corrected task.** The first prompt for the conflict-alerts task left out part of what its test checks, and all six of its runs failed in both arms; the prompt was corrected and the task run again, and only the second set is counted.
- **Not tested:** resuming unfinished work (where knowing how the last session ended should matter most), and KevMind's MCP tools (`code_map`, `file_context`, `file_history`, `known_failures`), which were off in both arms. They were measured separately (below).

## The MCP tools: do they get called?

The four tools were `file_context`, `file_history`, `known_failures` and `code_map` (an approximate code map from import and export statements, with a complete-list mode). Before a full benchmark, a probe checked whether Claude uses them at all.

- **Task:** list every file in the frontend of the same private application (about 950 code files) that calls its API service modules directly instead of through a hook. The ground truth, 8 files, came from the TypeScript checker following each value import to its declaration, through barrels. Grep for the import path finds 12 candidates: 5 import only types, and it misses one import through a barrel.
- **Arms:** the tools off; the tools on (the MCP server connected and its four tools listed to Claude, with the project map built for that commit); the tools on plus a one-line hint at session start naming them. Same model and harness as above.

| Arm | Runs | KevMind tool calls | Files found | Tokens per run |
|---|---|---|---|---|
| Tools off | 1 | — | 8 of 8 | 424 k |
| Tools on | 3 | 0 | 8 of 8 each | 363 k, 454 k, 477 k |
| Tools on + hint | 2 | 0 | 8 of 8 each | 374 k, 441 k |

Claude used Grep, Bash and Read in every run and found all 8 files; the tools were never called, so whether they would help when used could not be measured. Every run's tool list included Claude Code's tool search, which suggests MCP tools were deferred (Claude sees their names, not their descriptions, until it searches); this was not verified. One more limit: the code map's area list would have missed the barrel import too.

**Real use agreed.** Over 2.3 days with the tools on, across 39 sessions in three projects, the event log shows 4 calls in 2 sessions, both in KevMind's own repository, one of them a development session testing them. A full run (about 17–32 M tokens) was not worth spending to measure tools that go unused, and the tools were removed.
