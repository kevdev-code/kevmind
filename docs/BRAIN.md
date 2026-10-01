# Phase 4: the brain view (proposal and prototype)

Status 2026-10-01: a standalone prototype for review. Nothing in the dashboard changed; integration waits for your OK.

```bash
node prototype/brain/serve.mjs
```

Then open http://127.0.0.1:4798/ (test port; `?nodes=3000` for the stress case, `?speed=2` for a faster replay). The data is synthetic and labeled so on the page.

Recording: [docs/media/brain-prototype.mp4](media/brain-prototype.mp4) (33 s of the replay at 1280 x 800, recorded in headless Edge on the real GPU with `prototype/brain/bench/record.mjs`).

## What it shows

**Synthetic data shaped like your projects.** `demo-clinic` is OdonMind-sized (its real memory report: 51 notes, 4 instruction files, 1 Serena note, nested repos): 49 memory notes (10 feedback, 37 project, 2 reference) plus `MEMORY.md`, 3 instruction files plus the shared `~/.claude/CLAUDE.md`, 1 Serena note, 346 touched files across nested `frontend/` and `backend/` repos, and 7 tools. Two smaller projects (`demo-shop`, `demo-kevmind`) make 597 nodes and 773 links in all. The stress case adds clinic-shaped projects up to 3,068 nodes and 4,021 links (10 projects). Names are invented. Generator: `prototype/brain/data.js`.

**A replay of one working session:** Claude reads its instructions and memory, launches three parallel subagents (Explore, general-purpose, code-reviewer) that read, edit, run tests (one fails, then passes) and think, then Claude edits and runs the tests again. 57 s of activity, 12 s of stillness, then it loops.

**The brain.** A lateral view facing right, drawn as an outline with the three main fissures (chrome, never particles, so nothing decorative passes for data). Each lobe holds one kind of knowledge, and inside it each region is a project's folder or kind of note:

| Lobe | What lives there | Why |
|---|---|---|
| Prefrontal | `CLAUDE.md` files and imports, feedback notes | rules and plans |
| Frontal | docs (`*.md` outside memory) | |
| Parietal | server and logic code | |
| Occipital | interface code (`frontend/`, components, CSS, `*.tsx`) | the visual cortex |
| Temporal | auto memory (`MEMORY.md` and notes), Serena notes | memory |
| Cerebellum | tests and tools (Bash, Grep, Agent, MCP servers) | checks and coordination |
| Brainstem | infrastructure: config, migrations, Docker, `package.json` | |

A file's lobe comes from its path alone (`lobeOfPath` in `data.js`, covered by `test/brain-prototype.test.mjs`).

**Nodes.** Shape names the type (diamond: instruction file, triangle: memory note, square: Serena note, dot: code file, ring: tool), so type never depends on color. Size and brightness follow activity (reads + 2 x edits for files, uses for tools, tokens and links for notes). Crowded lobes get dimmer, smaller stars so additive light doesn't burn out to white.

**Links.** Links between notes, `MEMORY.md` index entries, `@imports`, notes citing code (the memory report's `cites`), files changed together (dashed: a statistic, from episodes and git), and read-before-edit. All hairlines at low alpha; the focused node's links light up in violet.

**Live activity.**
- Each agent is a comet in its own color that travels from the node it was on to the file it now reads, edits or runs (Bash and Agent are tool nodes), with a chip riding along: "#2 general-purpose · edits appointments.test.ts".
- On arrival the node ignites in the kind's color from DESIGN.md (read blue, edit pink, error red, command gray) with a ring, then keeps an ember of that color that cools in steps at 1, 5 and 15 minutes.
- The lobe where agents are working glows softly (brighter, not a hue), and the glow cools with the embers after they leave: the "where is the work" answer at a glance.
- "Thinks" sends a ripple through the stars around the agent, in the agent's color.
- While a session works, its project is brighter and the other projects drop to half (your answer to the scope question).
- Idle is fully still: the loop stops. I didn't add breathing because it would keep the GPU and the compositor busy for nothing (see the numbers).

**Color rules.** Kinds keep DESIGN.md's hues; violet stays selection and focus only; commands are a neutral gray, so white means Claude only. Subagents get the three widest gaps between the state hues (cyan 200, chartreuse 117, magenta 320, each 31-45 degrees from any state hue); a fourth parallel subagent reuses cyan and its chip number tells them apart. Every color has a word next to it in the chip and in the agents panel. Nodes themselves are neutral ink-violet; color on a node always means a recent action.

**Interaction.** Hover a star for its name, type, project, path and stats (reads, edits, tokens, links, and "edited 3 min ago" or "last touched 4 d ago"). Click to focus it: its neighbors stay lit, everything else dims, and a card lists the neighbors by link type as buttons (the keyboard path through the graph; Esc clears). Search (`/`) dims non-matches and lists the top 8; Enter focuses the first and moves keyboard focus into its neighbor list. Filters for projects, node types and link types. Drag to turn (limited to about 40 degrees, so the lateral reading holds), Shift-drag or right-drag to move, wheel or buttons to zoom.

**Switches.** "Animations" in the well's corner: off draws single static frames (one per change, no loop at all, no comets or rings, embers still show). It starts off under `prefers-reduced-motion` unless you turned it on. The choice is remembered.

**Chrome.** Header, rail, segmented controls, switch and panels are DESIGN.md's (same tokens, 12 px floor, sentence case, no shadows). The well is a night window that stays dark in the light theme too, because the glow is additive light and needs a dark ground. Glows, gradients and depth live only inside the well. English and Spanish. Below 900 px the rail folds into a closed "Filters" disclosure above the well; below 520 px the chips shrink to a dot and "#n" (the agents panel keeps the verbs). Labels hide wherever a chip or a resting agent sits on them, and on phones lobe labels show only their meaning ("memory", "interface").

## Renderer options (measured)

Same scene for all three: 3,068 nodes, 4,021 links (and a 9,000-link variant), outline, haze, four comets with trails, rings, think ripples, and the camera turning every frame so every frame is a full redraw. Headless Edge 154 at 1440 x 900, driven over CDP (`prototype/brain/bench/run.mjs renderers`). three.js ran the prototype's own shaders as `RawShaderMaterial`s, so its GPU work is identical and the difference is three.js itself.

| 3,068 nodes, 4,021 links, full redraw every frame | Canvas 2D | Raw WebGL2 (`gl.js`) | three.js 0.186 |
|---|---|---|---|
| Renderer code to ship | 6.6 KB (2.3 KB gzip) | 18 KB (6.1 KB gzip) | 2,121 KB (417 KB gzip), plus the same shaders |
| npm package (today 98 KB packed, 308 KB unpacked) | +7 KB | +18 KB | +2.1 MB |
| First frame, including layout | 262 ms | 311 ms | 338 ms (513 ms on SwiftShader) |
| **RTX 3080 Ti, 30 fps cap** | | | |
| frames per second | 30 | 30 | 30 |
| script per frame | 3.85 ms | 0.19 ms | 0.25 ms |
| main thread busy | 18.7% | 1.9% | 1.9% |
| renderer process, all threads | 33% | 16% | 15% |
| GPU process | 68% | 5% | 5% |
| GPU 3D engine (Windows counter) | 9.1% | 3.4% | 3.0% |
| JS heap | 3.1 MB | 3.3 MB | 6.3 MB |
| **RTX 3080 Ti, uncapped** | 47 fps | 120 fps (display limit) | 120 fps |
| GPU time per frame (timer query) | not measurable | 1.0 ms | 0.4-0.9 ms |
| **SwiftShader, 30 fps cap** | 0.4 fps | 28.8 fps | 28.8 fps |
| GPU process (cores x 100) | 1,547% | 843% | 840% |
| GPU time per frame | | 17.4 ms | 17.2 ms |
| **9,000 links**: 3080 Ti uncapped / SwiftShader capped | 39 / 0.2 fps | 120 / 28.8 fps | 120 / 28.8 fps |

Percentages are of one CPU core, over 12 s windows at the cap and 8 s uncapped. "GPU process" is Edge's GPU process CPU time; with SwiftShader that process *is* the GPU, so its CPU time is the rendering cost.

**SVG** was not measured: 7,000 animated DOM nodes repainting at 30 fps is out of budget by construction.

**Recommendation: raw WebGL2.** It costs the same per frame as three.js at under 1% of the size: the brain is points, lines and sprites with custom shaders, so three.js would only wrap a `RawShaderMaterial` and add 2.1 MB to a package that is 0.3 MB today. Canvas 2D fails the budget: 3.9 ms of script per frame and 68% of a core in the GPU process on a fast machine, and under 1 fps on SwiftShader. The cost of raw WebGL is ~400 lines of GL code to own (`gl.js`) and a "needs WebGL 2" message for the rare browser without it.

**2.5D, not a full 3D brain.** The prototype is a lateral view with real depth (perspective, depth fade, a limited turn). A free-orbit 3D brain would need a closed 3D surface, depth-sorted labels, and would lose the stable lateral reading where lobe labels sit in the same place every time. I don't think it's worth it.

**One optimization found by measuring.** On the software GPU, 4x MSAA was more than half of a frame and links were the largest layer. The renderer now draws the static layers (ground, outline, haze, links) with MSAA into a cache and redraws that only when the camera, filters, focus or project emphasis change; animation frames copy the cache and draw the stars and comets on top (stars antialias in their own shader). With the camera still, which is the normal state while agents work:

| GPU time per frame | camera moving | camera still (cached) |
|---|---|---|
| RTX 3080 Ti | 0.9-1.0 ms | 0.2-0.3 ms |
| SwiftShader | 16.2 ms | 3.3-3.7 ms |

At 30 fps on SwiftShader that is the GPU process going from 836% to 261% of a core.

## The prototype's own numbers

The prototype page itself (`run.mjs proto`): 30 fps cap, the replay running, camera still, 1440 x 900.

| | 597 nodes, RTX 3080 Ti | 3,068 nodes, RTX 3080 Ti | 3,068 nodes, SwiftShader |
|---|---|---|---|
| First frame after navigation (data, layout, GL setup) | 151 ms | 301 ms | 289 ms |
| **Replay, animations on**: frames per second | 30.0 | 30.0 | 28.8 |
| main thread | 2.5% | 2.7% | 2.8% |
| renderer process | 4.8% | 5.1% | 5.3% |
| GPU process | 4.0% | 3.9% | 265% |
| GPU 3D engine | 1.5% | 1.6% | n/a |
| **Hidden tab** (another tab in front): frames | 0 | 0 | 0 |
| main thread / GPU process | 0% / 0% | 0% / 0.1% | 0% / 0.4% |
| **Another view shown** (Live): frames | 0 | 0 | 0 |
| **Animations off**, replay running: frames per second | 0.8 | 0.9 | 0.7 |
| main thread / GPU process | 0.1% / 0.4% | 0.2% / 0.5% | 0.2% / 29% |
| **Idle** (replay over, effects settled): frames per second | 0.07 | 0.07 | 0.07 |
| main thread / GPU process | 0% / 0% | 0% / 0% | 0% / 0.6% |
| JS heap | 1.7-3.9 MB | 3.7-7.7 MB | 2.7-4.8 MB |

- Animations off draws one static frame per change (an event lands, a filter changes), with no loop in between.
- Idle draws one frame every 15 s while embers are still cooling (up to 15 minutes after the last action), then nothing.
- With SwiftShader the GPU process also composites the whole page in software, so it shows 13-29% even with zero or few brain frames.
- Labels and chips are DOM over the canvas. Two things I measured and fixed: per-label compositor layers and opacity fades on labels cost ~170% of a core on SwiftShader (labels now sit in one layer and hide instantly under a chip); the lobe glow first rebuilt the cached layer on every change (now at most every 2 s).
- For comparison, the Live view costs about 0.2% CPU with the tab hidden (`docs/ROADMAP.md`) and measured 0.37% of the main thread while a session works in the 0.4.0 benchmark.

## What I couldn't measure

This machine has no integrated GPU enabled: the Ryzen 9 9950X3D's Radeon graphics is off and only the RTX 3080 Ti shows up. So I measured the real GPU and SwiftShader (Chrome's GPU on the CPU) as a stricter-than-integrated worst case: the cached path holds 28.8 of 30 fps there at 3,000 nodes, with 3.5 ms of GPU work per frame. My expectation is that an Intel or AMD iGPU does this point-and-line workload faster than SwiftShader on 16 cores, but that is an expectation, not a measurement. Running `node prototype/brain/bench/run.mjs proto out.json` on a laptop with an iGPU would settle it before integrating. Headless Edge also skips the final present to a window, so a real window adds a little compositor work.

## Design review (Impeccable 4.4)

Your inspiration images were the pinned direction (no concept round). The finish reviewer, a separate agent with screenshots at 1440 x 900 and 390 px, dark, light and Spanish, returned **fix** with 8 items; one batch resolved 7 (agent hues, labels under chips, the phone view, the lit lobe, the cerebellum drawing, copy and plurals, the brief), and a second batch resolved the 3 regressions it found. Its last open item, the temporal and occipital lobes not filling to the rim, I fixed after the final verdict (regions now take their lobe's shape), so that change was checked by me in screenshots, not by the reviewer. A documenter pass (report only) prepared the DESIGN.md "Brain view" text and design.json entries to paste at integration; it also flagged two things to settle then: the prototype's breakpoints (900 and 520 px) against the dashboard's (720, 900, 1100), and the agents panel's compact status chip (12 px instead of 14).

## Decisions for you

1. **Agent colors.** Comets in gap hues (cyan, chartreuse, magenta) with words beside them, or neutral comets told apart by their numbered chips only? The gaps are 31-45 degrees wide, so cyan sits nearer read blue and magenta nearer edit pink than I'd like; the chips carry the meaning either way. An orange fourth hue was dropped in review: it read as "needs you" amber.
2. **Two additions beyond your list.** A tools region in the cerebellum (where "runs a command" lands; sized by real tool counts) and "notes citing code" links (real data from the memory report). Keep both?
3. **Light theme.** The well stays dark. The alternative is a second, non-additive palette for light, which looks flatter.
4. **Idle.** Fully still (chosen) rather than slow breathing.
5. **Active project.** Brighter, others at half. Camera easing toward it is not built; I'd only add it as an opt-in "follow" button.

## Integration plan (after your OK)

1. Server: `GET /api/brain?key=<project>|all` builds the graph from what KevMind already has: the memory report (instructions and imports, notes, `MEMORY.md` index, links, cites, Serena), the experience aggregate (touched files with reads and edits from episodes, co-change pairs from episodes and git through `partners`, read-before-edit through `readFirst`, with the existing thresholds), and tool counts from the logs. Cached per project and rebuilt when those change. Read-only, like the Memory tab.
2. Client: `public/brain.js` (the renderer from `gl.js` plus the view) behind a third view button. Live activity from the existing `/stream` events: `read`, `edit`, `command`, `error`, `thinks`, `agent_start`, `agent_done` map one-to-one to the replay's kinds. Layout runs on load (about 40 ms at 600 nodes and 170 ms at 3,000 in Node) or in a worker if real projects get bigger.
3. DESIGN.md: a "Brain view" section with the night tokens, the agent hues and the rules above.
4. The benchmark and `test/brain-prototype.test.mjs` move with it; the CDP harness replaces the scratch one noted in the roadmap.

## Files

- `prototype/brain/index.html`, `style.css`, `app.js`: the page (view, labels, chips, filters, focus, search, replay, frame loop).
- `prototype/brain/gl.js`: the WebGL2 renderer (shaders, cached static layers, matrices).
- `prototype/brain/data.js`, `layout.js`: synthetic data, replay, brain geometry and layout.
- `prototype/brain/serve.mjs`: static server on 127.0.0.1.
- `prototype/brain/bench/`: CDP harness (`cdp.mjs`), renderer scene (`scene.html`, `scene.js`, `r-canvas.js`, `r-three.js`), `run.mjs`, `breakdown.mjs`, `shot.mjs`, `record.mjs`. three.js is not vendored; `BRAIN_THREE=<three/build>` points the benchmark at a local copy.
