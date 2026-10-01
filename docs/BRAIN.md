# Phase 4: the brain view (prototype)

Status 2026-10-01: iteration 2 of a standalone prototype, for review. Nothing in the dashboard changed; integration waits for your OK. The design rules are in [DESIGN.md, section 7](../DESIGN.md).

```bash
node prototype/brain/serve.mjs
```

Then open http://127.0.0.1:4798/ (test port; `?nodes=3000` for the stress case, `?speed=2` for a faster replay). The data is synthetic and labeled so on the page.

Recording: [docs/media/brain-prototype.mp4](media/brain-prototype.mp4) (33 s of the replay at 1280 x 800 with an orbit halfway through, recorded in headless Edge on the real GPU with `prototype/brain/bench/record.mjs`).

## Decisions (owner, 2026-10-01)

- Renderer: raw WebGL2. three.js isn't worth 2.1 MB for the same shaders.
- Agent beams in color (cyan, chartreuse, lilac), each with a white core and its numbered label, so they never pass for a region color. No orange.
- Keep the tools area in the cerebellum and the "notes citing code" links, as long as they come from real data.
- The brain's well stays dark in the light theme.
- Idle is fully still by default.
- The working project is brighter and the others drop to half; the camera easing toward it is the "Follow" control.
- SwiftShader (Chrome's GPU running on the CPU) is the accepted stand-in for an integrated GPU for now.

## What it shows

**Synthetic data shaped like your projects.** `demo-clinic` is OdonMind-sized (its real memory report: 51 notes, 4 instruction files, 1 Serena note, nested repos): 49 memory notes plus `MEMORY.md`, 3 instruction files plus the shared `~/.claude/CLAUDE.md`, 1 Serena note, 346 touched files across nested `frontend/` and `backend/` repos, and 7 tools. With `demo-shop` and `demo-kevmind`: 597 nodes and 773 links. The stress case adds clinic-shaped projects up to 3,068 nodes and 4,021 links (10 projects). Names are invented. Generator: `prototype/brain/data.js`.

**A replay of one working session:** Claude reads its instructions and memory, launches three parallel subagents (Explore, general-purpose, code-reviewer) that read, edit, run tests (one fails, then passes) and think (with thinking-token counts), then Claude edits and runs the tests again. 57 s of activity, 12 s of stillness, then it loops.

**A 3D brain.** Proportions of a real one: about 1.4 : 1 : 1.05 (length : width : height with the cerebellum), checked by `test/brain-prototype.test.mjs`. Two hemispheres touch along a shallow midline fissure; the frontal lobe is rounded forward, the temporal lobe bulges down and forward along the side, the occipital sits at the back, a small cerebellum is tucked under it, the brainstem goes down from the center. The surface is a particle shell (13,000 points) with sulci carved into it (the lateral fissure rising toward the back, the central sulcus and its neighbors, the superior temporal and parieto-occipital sulci), softer gyri between them, and fine parallel folia on the cerebellum, that turns with the scene; behind it, a dim static starfield and a vignette. Shell and stars are decoration: never interactive, never counted, never picked. It opens at a 3/4 side view, like your inspiration, framed so the whole shell fits with a margin (on a phone too).

Each lobe holds one kind of knowledge, in both hemispheres, and inside it each region is a project's folder or kind of note, as a 3D volume:

| Lobe | Color | What lives there |
|---|---|---|
| Prefrontal | amber | `CLAUDE.md` files and imports, feedback notes |
| Frontal | green | docs |
| Parietal (top, back) | violet | server and logic code |
| Occipital (back) | azure | interface code |
| Temporal (low, on the side) | pink | auto memory (`MEMORY.md` and notes), Serena notes |
| Cerebellum (under the back) | teal | tests and tools (Bash, Grep, Agent, MCP servers) |
| Brainstem | orange | infrastructure: config, migrations, Docker, `package.json` |

A file's lobe comes from its path alone (`lobeOfPath` in `data.js`). Regions go to the hemisphere with less load in their lobe, preferring their project's side, so projects keep a side when they can and a single project still fills both.

**Colors.** The lobe colors are categorical, the brain view's one exemption from DESIGN.md's one-hue-per-meaning rule, confined to the well (the rail's Regions legend is their key). Regions shift slightly around their lobe's hue. Activity never passes for a region: it is always white-cored and labeled. Agent beams and heads carry a white core and the chip "#1 Explore · reads …"; the node an agent lands on flashes white and gets a ring in DESIGN.md's state colors (read blue, edit pink, error red, command gray); a touched node keeps a whitened core that cools at 1, 5 and 15 minutes; selection is violet.

**Nodes** are neuron sprites: a small shape per type (diamond instruction, triangle memory note, square Serena note, dot code file, ring tool) with up to four short dendrites and a soft halo in the region color, sized by activity. **Links** are curved, glowing fibers colored from one region to the other, low base opacity; links between regions follow one shared lane per pair of lobes (through the lobes they join, dipping toward the core inside a hemisphere and crossing the midline high between hemispheres, like the corpus callosum), so they gather into bundles; co-change links are dashed (a statistic); links around recently touched nodes brighten. **Beams** are glowing tubes (a white core in a wide halo of the agent's hue) that arc over the surface from where an agent was to the file it now reads or edits, the chip riding the head. **The lit lobe:** where agents work, the lobe glows in its color and cools with the embers. "Thinks" sends a ripple through nearby nodes in the agent's color. **Depth:** perspective, size attenuation, and fog (far is smaller, dimmer, greyer).

**Labels:** one per lobe, inside the brain on the side facing the camera: the lobe small on top, under it its groups in their region colors, most important first (where agents work, the focused node's region, the working project, then size), names deduplicated, "+n" for the rest. They sit on a dark backing, never under the panels, and agent chips move around them rather than cover them.

**The activity trace** (bottom left): an EEG-like line of events and a band of thinking tokens over the last 5 minutes, from the replay's events only, with a word on its own row above the line: thinking, working or idle. It scrolls every 2 s while something happened in the last 30 s, then stays still.

**Camera:** full 360-degree orbit (pitch stops short of the poles), inertia when you let go, zoom toward the cursor, Shift-drag or right-drag to pan. The bar: zoom in and out, Fit (back to the opening view; with a node focused, the camera also steps aside by half the card so the card never covers the brain), Re-layout (lays out again what the filters show, behind a short fade), Follow (the camera eases toward where agents work and back to the whole brain when the session is idle) and Auto-rotate (slow turn while idle). Follow and Auto-rotate are off by default.

**Interaction:** hover a node for its name, type, lobe, project, path and stats; click to focus it (neighbors lit, the rest dimmed, a card lists the neighbors as buttons, the keyboard path through the graph); search with `/` (Enter focuses the first match and moves keyboard focus into its neighbors; Esc clears); filters for projects, node types and link types.

**Switches and chrome:** "Animations" off (the default under `prefers-reduced-motion`) draws single static frames: beams land at once, no rings, ripples or inertia. Header, rail and controls are DESIGN.md's. English and Spanish. Below 900 px the rail folds into a "Filters" disclosure, below 640 px the trace shrinks to its word and line and moves with the camera bar under the title, below 520 px chips shrink to "#n".

## Renderer: raw WebGL2 (decided)

Measured on the iteration-1 scene at commit `e753723` (same 3,068 nodes and 4,021 links, full redraw every frame; reproduce with `git checkout e753723 -- prototype/brain`):

| | Canvas 2D | Raw WebGL2 | three.js 0.186 |
|---|---|---|---|
| Code to ship | 6.6 KB | 18 KB | 2,121 KB (417 KB gzip) |
| RTX 3080 Ti, 30 fps: script per frame / GPU process | 3.85 ms / 68% | 0.19 ms / 5% | 0.25 ms / 5% |
| RTX 3080 Ti uncapped | 47 fps | 120 fps (display limit) | 120 fps |
| SwiftShader, 30 fps cap | 0.4 fps | 28.8 fps | 28.8 fps |

three.js ran the same shaders, so it costs the same per frame; it would only add 2.1 MB to a package that is 0.3 MB today. Canvas 2D fails the budget. The renderer today is `gl.js`, 22 KB (7.5 KB gzip).

## Performance (iteration 2)

Headless Edge 154 at 1440 x 900, 30 fps cap, `prototype/brain/bench/run.mjs`. Percentages are of one CPU core.

| | 597 nodes, RTX 3080 Ti | 3,068 nodes, RTX 3080 Ti | 3,068 nodes, SwiftShader |
|---|---|---|---|
| First frame after navigation (data, layout, shell, GL setup) | 246 ms | 320 ms | 367 ms |
| **Replay, camera still**: frames per second | 30.0 | 30.0 | 24.9 |
| main thread / GPU process | 3.2% / 4.5% | 2.8% / 3.9% | 2.6% / 556% |
| GPU 3D engine | 1.6% | 2.0% | n/a |
| **Auto-rotate** (camera moving every frame): frames per second | 30.0 | 29.9 | 24.6 |
| main thread / GPU process | 2.7% / 4.8% | 3.0% / 4.7% | 1.9% / 1,653% |
| **Follow** during the replay: frames per second | 4.8 | 5.2 | 12.2 |
| **Hidden tab** / **another view**: frames | 0 / 0 | 0 / 0 | 0 / 0 |
| **Animations off**, replay running: frames per second | 0.9 | 1.1 | 1.1 |
| **Idle** (replay over, effects settled): frames, main thread | 0, 0% | 0, 0.1% | 0, 0.1% |
| JS heap | 2.3-12.3 MB | 2.8-8.9 MB | 2.8-4.0 MB |

- **What moves costs, what doesn't is cached.** The static layers (ground and stars, shell, haze, fibers) are drawn once into a cache and redrawn only when the camera, filters, focus or the lit lobes change (0.5 rebuilds per second during the replay); each frame copies the cache and draws the nodes, beams and rings on top.
- **Fibers have two levels of detail.** On SwiftShader the fibers dominate a moving frame and their cost grows with curve segments, not with pixels (measured: halving their width changed nothing). While the camera moves they draw straight (one segment); the smooth curves (14 segments between regions) return the moment it stops. That took SwiftShader's auto-rotate from 4.9 to 24 fps; on the RTX it makes no difference.
- **Follow** only draws while the camera eases toward where the work moved.
- **Idle** draws one frame every 15 s while touched nodes are still cooling (up to 15 minutes after the last action), then nothing; none fell in these 12 s windows.
- **Iteration 1 vs 2 on SwiftShader, replay:** 265% → 556% of a core: the neuron sprites are bigger and draw dendrites, beams are wide glowing tubes, and the bundled fibers take 14 segments each to curve smoothly (SwiftShader pays per segment; the last review round alone cost about 2 fps and took "Animations off" from 135% to 234% of a core while the replay runs, since each event redraws the cache). On the RTX all of it stays at ~4%.
- Two benchmark artifacts, fixed: the first Windows GPU-counter query of a run stalls the browser's frames for several seconds (the benchmark warms it up in a throwaway launch); and a fresh Edge profile still signs into the Windows account and syncs its extensions, whose welcome tabs take the foreground a few seconds in and throttle the measured page to 1 fps at random. The harness now launches Edge with sync and extensions off.

## Integrated GPUs: SwiftShader is the stand-in

This machine has no integrated GPU enabled (the Ryzen 9 9950X3D's Radeon graphics is off; only the RTX 3080 Ti shows up), so the numbers above use SwiftShader, which you accepted as the stand-in. SwiftShader is harsher than an integrated GPU in a specific way: it pays per triangle on the CPU, which a real GPU does in hardware. At 3,000 nodes it holds 25 fps on the replay and while rotating, using many CPU cores to do it. Running `node prototype/brain/bench/run.mjs out.json` on a laptop with an integrated GPU would replace the stand-in with real numbers before integrating.

## Design review (Impeccable 4.4)

Iteration 2: your inspiration and the iteration-2 list were the pinned direction (no concept round). Two review rounds. The first returned **fix** with 8 items, all resolved: the shell read as an egg on a stem (now sulci, a temporal bulge and a separate cerebellum), the ground was too black (now an indigo night), fibers fanned into hubs (now shared lanes per pair of lobes), beams were thin (now glowing tubes), Fit didn't frame the brain and the focus card covered it, the copy said "star" and node shapes were too small at Fit, and phones had no trace. The second and last round returned **fix** with two items, both fixed afterward without a third review: the lanes bent at hard angles (now fewer control points and 14 segments per curve) and the focus card covered the agents panel (now it stops above it). Known and minor: where a bundle is active its stacked light can saturate toward white, close to the white core that marks activity; and the lateral fissure is faint at Fit.

Iteration 1: your inspiration images were the pinned direction (no concept round). The reviewer returned **fix** with 8 items, all resolved over two batches.

## Integration plan (after your OK)

1. Server: `GET /api/brain?key=<project>|all` builds the graph from what KevMind already has: the memory report (instructions and imports, notes, `MEMORY.md` index, links, cites, Serena), the experience aggregate (touched files with reads and edits from episodes, co-change pairs from episodes and git through `partners`, read-before-edit through `readFirst`, with the existing thresholds), and tool counts from the logs. Cached per project and rebuilt when those change. Read-only, like the Memory tab.
2. Client: `public/brain.js` (the renderer from `gl.js` plus the view) behind a third view button. Live activity from the existing `/stream` events: `read`, `edit`, `command`, `error`, `thinks`, `agent_start`, `agent_done` map one-to-one to the replay's kinds; the trace uses the event rate and the transcript's thinking tokens. Layout runs on load (about 50 ms at 600 nodes and 160 ms at 3,000 in Node) or in a worker if real projects get bigger.
3. Settle the breakpoints with the dashboard's (720, 900, 1,100 px) and move the brain's tokens from `prototype/brain/style.css` into `public/style.css`.
4. The benchmark and `test/brain-prototype.test.mjs` move with it.

## Files

- `prototype/brain/index.html`, `style.css`, `app.js`: the page (camera, labels, chips, trace, filters, focus, search, replay, frame loop).
- `prototype/brain/gl.js`: the WebGL2 renderer (ground and stars, neuron sprites, fibers and beams, dust and glow sprites, the static-layer cache, matrices).
- `prototype/brain/layout.js`: lobes, hemispheres, 3D layout, the particle shell.
- `prototype/brain/data.js`: synthetic data and the replay.
- `prototype/brain/serve.mjs`: static server on 127.0.0.1.
- `prototype/brain/bench/`: `cdp.mjs` (DevTools driver), `run.mjs` (the numbers above), `shot.mjs`, `record.mjs`.
