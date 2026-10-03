# The session briefing: a controlled benchmark

In October 2026 we checked whether KevMind's session briefing makes Claude Code cheaper on a task. **Result: no consistent token saving on isolated fixes.** The briefing stays off by default, and its live measurement (half of the session starts get it, half don't) decides.

## Setup

- **Model and tool:** Claude Opus 5.5 (1M context), Claude Code 2.1.288, headless (`claude -p`), the user's settings, plugins and MCP servers left out.
- **Two arms:** the briefing that a session starting at that commit would have received (v2: KevMind's records up to that moment, git, and the project map), handed over at session start by a one-file plugin, against nothing. The text is the same for every run of a task. KevMind's MCP tools are off in both arms.
- **Tasks:** five past bug fixes, each with its own regression test, on two projects:
  - KevMind: three fixes (commits `6eb8790`, `4b4a281`, `25a03bb`: shell syntax errors counted as known failures, unbounded conflict alerts, session titles).
  - A private web application of about 950 code files in three repositories: two fixes (one in the frontend, one in the backend), plus a control task whose prompt named the functions to write, so it needed little exploring. The control is reported apart and left out of the verdict.
- **Each run:** a fresh git worktree at the fix's parent commit (for the multi-repo project, every repo as it was then), the task described as a user would, with the contract the test checks but not the fix. Afterwards the fix commit's own tests are copied in: success means they pass, and so does the rest of the unit suite.
- **Three runs per arm,** one at a time, alternating with and without. Tokens are input, output, cache reads and cache writes, as Claude Code reports them.
- **Verdict rule, fixed before the runs:** "saves tokens" only if every task's median uses at least 10% fewer tokens with the briefing and succeeds no less often.

The runner is in [`prototype/briefing-bench/`](../prototype/briefing-bench/); the private project's task file is not in the repository.

## Results (medians of 3 runs per arm)

| Project | Task | Success with / without | Tokens with | Tokens without | Change |
|---|---|---|---|---|---|
| KevMind | Shell errors as known failures | 3/3 · 3/3 | 1.07 M | 1.05 M | +2% |
| KevMind | Cap conflict alerts, number events | 3/3 · 3/3 | 508 k | 651 k | −22% |
| KevMind | Session titles | 3/3 · 3/3 | 359 k | 415 k | −14% |
| Private app | Frontend fix | 3/3 · 3/3 | 788 k | 839 k | −6% |
| Private app | Backend fix | 2/3 · 3/3 | 920 k | 860 k | +7% |
| Private app | Control (functions named) | 3/3 · 3/3 | 570 k | 585 k | −3% |

Over the five tasks (control left out): 2 used at least 10% fewer tokens with the briefing, none used 10% more, and the median ratio (with / without) was 0.94. Successes: 14 of 15 with, 15 of 15 without. **Verdict: unclear.** About 32 M tokens were spent in all.

## Limits

- **Small sample.** Runs of the same task in the same arm varied by up to about 50%, so three runs per arm only show large effects. A first single run of the backend fix suggested −22%; with three runs it was +7%.
- **Thin briefings on the private app.** KevMind had recorded no work on it before those commits, so its briefings held only git and the key files of the project map, not where the last session left off.
- **The backend fix's hidden test accepted one approach only.** It checks that the stored time zone is set for the database session before the queries run. One run converted each date in the query instead, which is also a valid fix, and failed the test; it counts as a failure here.
- **A corrected task.** The first prompt for the conflict-alerts task left out part of what its test checks, and all six of its runs failed in both arms; the prompt was corrected and the task run again, and only the second set is counted.
- **Not tested:** resuming unfinished work (where knowing how the last session ended should matter most), and KevMind's MCP tools (`code_map`, `file_context`, `file_history`, `known_failures`), which were off in both arms. The Memory tab's Experience panel now measures the tools in real use instead: for each call, the files then read in the area it was about, against comparable stretches without a call.
