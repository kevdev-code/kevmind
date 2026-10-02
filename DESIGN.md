---
name: KevMind
description: A calm, local dashboard that shows what Claude Code is doing, dark first, light on request.
colors:
  canvas: "oklch(17% 0.009 285)"
  surface: "oklch(21% 0.011 285)"
  raised: "oklch(25% 0.012 285)"
  border: "oklch(30% 0.013 285)"
  border-strong: "oklch(37% 0.014 285)"
  ink: "oklch(94.5% 0.006 285)"
  ink-2: "oklch(80% 0.011 285)"
  ink-3: "oklch(69% 0.013 285)"
  accent: "oklch(74% 0.145 288)"
  accent-fill: "oklch(56% 0.190 288)"
  accent-soft: "oklch(30% 0.065 288)"
  working: "oklch(78% 0.150 155)"
  waiting: "oklch(83% 0.140 80)"
  error: "oklch(72% 0.170 25)"
  read: "oklch(76% 0.115 245)"
  edit: "oklch(77% 0.130 350)"
  done: "oklch(48% 0.014 285)"
  working-soft: "oklch(26% 0.040 155)"
  waiting-soft: "oklch(26% 0.035 80)"
  error-soft: "oklch(25.5% 0.035 25)"
  light-canvas: "oklch(97.2% 0.005 285)"
  light-surface: "oklch(100% 0 285)"
  light-raised: "oklch(95.2% 0.007 285)"
  light-border: "oklch(90.5% 0.008 285)"
  light-border-strong: "oklch(84% 0.010 285)"
  light-ink: "oklch(23% 0.016 285)"
  light-ink-2: "oklch(42% 0.016 285)"
  light-ink-3: "oklch(52% 0.016 285)"
  light-accent: "oklch(50% 0.200 288)"
  light-accent-fill: "oklch(56% 0.200 288)"
  light-accent-soft: "oklch(94% 0.032 288)"
  light-working: "oklch(49.5% 0.125 155)"
  light-waiting: "oklch(52% 0.115 70)"
  light-error: "oklch(53% 0.190 27)"
  light-read: "oklch(51% 0.140 250)"
  light-edit: "oklch(53% 0.180 350)"
  light-done: "oklch(70% 0.012 285)"
  light-working-soft: "oklch(95% 0.035 155)"
  light-waiting-soft: "oklch(95.5% 0.045 80)"
  light-error-soft: "oklch(95.5% 0.030 27)"
  brain-night: "oklch(9.5% 0.045 282)"
  brain-night-center: "oklch(19% 0.085 280)"
  brain-veil: "oklch(15.5% 0.016 285)"
  brain-dust: "oklch(80% 0.025 250)"
  brain-command: "oklch(72% 0.012 285)"
  lobe-prefrontal: "oklch(84% 0.16 90)"
  lobe-frontal: "oklch(72% 0.14 254)"
  lobe-parietal: "oklch(61% 0.2 298)"
  lobe-occipital: "oklch(81% 0.11 204)"
  lobe-temporal: "oklch(67% 0.24 350)"
  lobe-cerebellum: "oklch(88% 0.18 146)"
  lobe-stem: "oklch(93% 0.03 85)"
  agent-main: "oklch(74% 0.14 38)"
  brain-breath: "oklch(80% 0.09 42)"
  agent-sub: "oklch(93% 0.008 260)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.45
  meta:
    fontFamily: "system-ui, -apple-system, Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 350
    lineHeight: 1.45
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  segmented-control:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-control-pressed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  list-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
  list-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "7px 8px"
  status-working:
    backgroundColor: "{colors.working-soft}"
    textColor: "{colors.working}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 10px"
  status-waiting:
    backgroundColor: "{colors.waiting-soft}"
    textColor: "{colors.waiting}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 10px"
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  issue-problem:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  issue-warning:
    backgroundColor: "{colors.waiting-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  brain-lobe-label:
    textColor: "{colors.ink-3}"
    padding: "0"
  brain-agent-chip:
    backgroundColor: "{colors.brain-veil}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "2px 8px 2px 6px"
  brain-overlay:
    backgroundColor: "{colors.brain-veil}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px"
---

# Design System: KevMind

## 1. Overview

**Creative North Star: "The Quiet Instrument"**

KevMind sits on a second monitor or a third of the screen for hours, glanced at every minute or two, often in a dim room late in the day. It should read like a well-made instrument rather than a show: calm, precise, quietly confident. One thing on the screen is loud, and only when it is true: Claude needs you. Everything else steps back until you look for it.

The system is dark first, with a light theme for bright rooms, chosen by the system or by the switch in the header. Neutrals are tinted slightly toward the brand's purple hue (285), so the dark is warm-violet rather than blue-gray; the purple accent itself is reserved for selection, focus and primary actions. State has its own vocabulary, one hue per meaning, as clear as GitHub Primer's. Density follows Linear: many small labels and rows, generous only where it separates groups. The side rails sit directly on the canvas; only the center work uses panels, so the eye lands there.

It rejects, by name, the anti-references in PRODUCT.md: the neon "AI dashboard" (glows, gradients, glassmorphism, purple haze; glow, depth and a lit ground exist only inside the brain view's well, see section 7), the Grafana wall where every panel shouts at the same volume, the SaaS admin template of identical cards and big hero numbers with tiny labels, and the hacker terminal (monospace is for paths, commands and file names only).

**Key Characteristics:**
- Dark first, light on request; both pass WCAG AA for every text pair on every surface it appears on.
- Restrained color: tinted neutrals, one purple accent, one hue per state.
- Rails without cards; panels only for the center.
- Status leads; numbers are quiet.
- Motion only for a real change, never while idle.
- System fonts only, no downloads.

## 2. Colors

A violet-tinted neutral ramp with one restrained purple and a small, strict state vocabulary.

### Primary
- **Restrained Violet** (`accent` oklch(74% 0.145 288) dark, oklch(50% 0.200 288) light): selection, focus rings, links, the "show all" control, the on-state of the switch (as `accent-fill` oklch(56% 0.190 288)). Never decoration, never a state.
- **Selected Row Violet** (`accent-soft` oklch(30% 0.065 288) dark, oklch(94% 0.032 288) light): the background of the selected session or project. Selection is a tint, never a side stripe.

### Secondary
- **Working Green** (`working`): a session or agent that is running, the connection dot, "all clear".
- **Needs-You Amber** (`waiting`): Claude waiting for your OK, conflict alerts, warnings. The one color allowed to take over a panel.
- **Failure Red** (`error`): failed tools, errors, memory problems.

### Tertiary
- **Read Blue** (`read`): reads, in the feed and in the files bar.
- **Edit Pink** (`edit`): edits, in the feed and in the files bar.

### Neutral
- **Night Canvas** (`canvas` oklch(17% 0.009 285); light oklch(97.2% 0.005 285)): page background, header, rails.
- **Panel Surface** (`surface` oklch(21% 0.011 285); light white): center panels, alert rows, buttons.
- **Raised Tint** (`raised` oklch(25% 0.012 285); light oklch(95.2% 0.007 285)): hover, bar tracks, chips, segmented-control wells.
- **Hairline** (`border`) and **Control Edge** (`border-strong`): 1px dividers and control outlines.
- **Ink, Ink 2, Ink 3** (`ink` 94.5%, `ink-2` 80%, `ink-3` 69% lightness in dark): primary text, secondary text, meta (labels, times, paths). Ink 3 still passes 4.5:1 on every surface, including selected rows.
- **Finished Gray** (`done`): finished agents and closed sessions. A finished thing no longer needs a color.

### Named Rules
**The One Meaning Rule.** A hue means one thing everywhere. Amber is "needs you"; it is never an edit, a tool or "not yet". Tools, commands and finished work are neutral.
**The Quiet Accent Rule.** Purple marks selection, focus and primary actions only, well under 10% of any screen.
**The Not-By-Color-Alone Rule.** Every state color has a word beside it (status chip, agent status word, feed kind, tally label).

The One Meaning Rule has exactly one exemption, the categorical lobe colors inside the brain view's well (section 7, The Brain Well Exemption).

## 3. Typography

**Body Font:** system-ui (Segoe UI Variable on Windows 11, San Francisco on macOS), with Roboto, Helvetica Neue and Arial as fallbacks.
**Label/Mono Font:** ui-monospace / Cascadia Mono at weight 350, for paths, commands and file names only.

**Character:** One quiet sans carries everything; the monospace appears only where text is literally code, set slightly lighter so it sits with the sans instead of shouting.

### Hierarchy
- **Headline** (600, 1.125rem / 18px): the project name in the Now and Memory headers. Nothing larger appears in the panels.
- **Title** (600, 1rem / 16px): stat values, Claude's request when it waits for you.
- **Body** (400, 0.875rem / 14px, tabular numbers): list names, the status chip, general text. Prose capped at 75 characters a line.
- **Label** (600, 0.8125rem / 13px, sentence case): panel titles and feed rows.
- **Meta** (400, 0.75rem / 12px): labels under values, times, counts, subtitles. 12px is the floor.

### Named Rules
**The No-Eyebrow Rule.** Panel titles are sentence case, 13px semibold, with a quiet subtitle. No uppercase, no letter-spacing.
**The Twelve-Pixel Floor.** Nothing renders below 12px.

## 4. Elevation

Flat. Depth comes from tonal layers (canvas, surface, raised) and 1px hairlines, never from shadows. The only shadow-like line is the 1px ring on a pressed segmented button. A panel that needs a shadow to stand out is a panel that shouldn't exist.

### Named Rules
**The Flat Rule.** No box-shadows on panels, rows or buttons. If it looks lifted, it is wrong.

## 5. Components

### Buttons
- **Shape:** gently rounded (6px).
- **Default:** surface background, ink text, a `border-strong` 1px edge, 12px label, padding 4px 10px. Used for "Copy fix prompt".
- **Hover / Focus:** border and text turn violet over 120ms ease-out; focus is a 2px violet ring offset by 2px. A copied state turns the edge and text green for 1.6s.
- **Link button:** violet text, no chrome ("show all", "see project").
- **Primary:** the violet fill with white text, one per surface at most ("Share on your network").

### View on phone
- **Header button:** a default button with a phone icon, Live tab only, hidden while sharing is on.
- **Shared indicator:** a neutral pill on the raised tint with a `border-strong` ring: broadcast icon, "Shared on your network" (opens the panel), and a quieter "Stop". Neutral on purpose: sharing is a state, not an alarm.
- **Panel:** a native modal `<dialog>` (12px radius, surface, hairline, 45% black backdrop, 440px max). The QR code is always black on white with its 4-module quiet zone, 220px, in both themes, so every camera reads it. The link and the firewall command sit in monospace on the raised tint, each with a Copy button.
- **Shared device:** a "Read-only" outline pill in the header; every control that changes something is gone, not disabled (`body.shared .owner-only`).

### Segmented controls
- **Style:** a raised well (8px radius, 2px padding) holding text or icon buttons; the pressed one becomes a surface chip with a hairline ring. Used for the view (Live / Memory), the theme (system / dark / light, icons with labels for assistive tech) and the language.

### Chips
- **Status chip:** pill, dot plus word, tinted by state (working green, waiting amber, neutral otherwise).
- **Tallies and counts:** pill on the raised tint; the number in ink, the word in ink 2.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** surface, with a hairline border. No shadow.
- **Internal Padding:** 16px. 12px between center panels, 24px between columns, 16px page gutter (12px on phones).
- **Waiting state:** the Now panel turns to the amber tint with an amber edge and says what Claude is asking and for how long. The only panel that ever changes color.

### Inputs / Fields
- **Select:** surface background, hairline border, 8px radius, 13px text.
- **Switch:** a 30×18px track (border-strong off, violet on) with a white knob that slides 12px in 120ms.
- **Checkbox:** native, tinted with the violet fill.

### Navigation
- **Lists:** sessions and projects are full-width buttons with a dot, a semibold name and a meta line; hover is the raised tint, selection the violet tint (`aria-current`). Keyboard reachable, Enter to select.
- **Phone:** the header wraps into two rows (brand and view, then connection, theme and language); the rails stack above the center.

### Agent timeline (signature)
Two-line labels (agent type, then its task), an 8px bar on a raised track, and on the right a muted status word (running / done / failed) above the action count. Bars move by clip-path, so the page repaints but never lays out. A running agent has one small opacity beat at the leading edge of its bar.

### Activity feed (signature)
Rows of time, kind and text. A time prints only when it changes from the row above. Kinds keep their word and one color each (read blue, edit pink, error red, waiting amber, agents green, everything else neutral); paths and commands in monospace. New rows fade in once (200ms, 3px).

## 6. Do's and Don'ts

### Do:
- **Do** let status lead: the chip and project name are the first thing in the Now panel, and "waiting for you" takes over that panel in amber and marks the browser tab ("⏸ Needs your OK · KevMind" and an amber favicon dot).
- **Do** keep one hue per meaning, as listed in Colors, and put a word beside every state color.
- **Do** use the 4px spacing grid, the 12px type floor and tabular numbers.
- **Do** move only on a real change: a new feed row (once) and a running agent's beat. Transform and opacity only, 120–200ms ease-out, and nothing under `prefers-reduced-motion`.
- **Do** write only what changed: idle screens do no layout or paint, hidden tabs render nothing.

### Don't:
- **Don't** build the neon "AI dashboard": no glows, gradients, glassmorphism or purple haze in the dashboard's panels, rails and header. Glow, depth and a lit ground are allowed only inside the brain view's well (section 7).
- **Don't** build a Grafana wall where every panel shouts at the same volume, or a chart wall.
- **Don't** use the SaaS admin template: no identical cards, no big hero numbers with tiny labels, no generic icon tiles.
- **Don't** go hacker terminal: no green on black, no monospace outside paths, commands and file names.
- **Don't** use a colored `border-left` or `border-right` wider than 1px as an accent on rows, alerts or issues. Tint the background and use a full border.
- **Don't** put uppercase tracked labels above panels, or text below 12px.
- **Don't** let a list grow without bound on screen: alerts show the latest three with "show all", the feed keeps 150 rows.

## 7. Brain view

The Brain tab (Phase 4; `public/brain/`, with its benchmark harness in `prototype/brain/`) is a second world nested inside the instrument: a night well holding a living 3D brain of the project, where regions are colored lobes, links are glowing fibers and agents travel as white-cored beams. Everything outside the well (header, rail, filters, switches, buttons) stays the dashboard above, unchanged. Everything inside the well is drawn as additive light on a dark ground, which is why the well has its own rules.

### Colors

**The Brain Well Exemption.** Inside the well, and only there, each lobe has a categorical color by what it holds. This is the one exemption from the One Meaning Rule; the lobe hues never leave the well (the rail's region legend repeats them as dots beside their words, which is the same key, not a new use). Everywhere else, One Meaning holds.

One saturated hue per lobe, about 50 degrees apart around the wheel, so the regions are told apart at a glance: amber, blue, violet, cyan, magenta, green, and a warm white for the brainstem. Their lightness differs too (from 61% to 93%), so the pairs that color-blind eyes confuse by hue (blue and violet, cyan and green, amber and green) stay apart: the closest pair is 14.6 apart in OKLab × 100 with normal vision, and 9.0, 7.7 and 7.3 with simulated protanopia, deuteranopia and tritanopia (the earlier pastel palette: 3.7, 2.3, 2.7 and 2.2). `test/brain-prototype.test.mjs` keeps every pair at 14 or more (7 or more for each deficiency), every color inside sRGB, and every label at AA. No region uses Claude's coral: the amber sits at hue 90, 52 degrees from it. A lobe's color is on its cells, its links, its label, its haze, and, at 30%, on the strands of its shell.

- **Prefrontal Amber** (`lobe-prefrontal`): instructions (CLAUDE.md, rules) and feedback notes.
- **Frontal Blue** (`lobe-frontal`): docs.
- **Parietal Violet** (`lobe-parietal`): logic, the code.
- **Occipital Cyan** (`lobe-occipital`): interface.
- **Temporal Magenta** (`lobe-temporal`): memory.
- **Cerebellum Green** (`lobe-cerebellum`): tools and tests.
- **Brainstem Warm White** (`lobe-stem`): infrastructure.

Regions inside a lobe shift around its color so neighbors stay apart, without leaving the lobe's band of hue: hue by 0, +7, −7, +12, −12 degrees and lightness by 0, +3, −3 points, in the order the regions appear. Text in a lobe's or region's color (labels, the focus card, the legend dot) is lifted to at least 76% lightness, so the darkest hues (violet, magenta) keep AA on the night.

**The White Core Rule.** Activity never passes for a region. Whatever happened, rather than what something is, carries a white core, a label or a ring:
- **Agents** are told from regions by kind, not by hue: regions are colors; subagents are silver-white (`agent-sub`: marker, beam, trail, tag dot), told apart by their number ("#1 Explore"); Claude itself is coral (`agent-main`), a color no region uses: its marker, its trail and the glow of its thinking breath (`brain-breath`, a softer coral). So an agent can never pass for a region. The chip dot and the row in the agents panel are a white center ringed by silver (`oklch(82% 0.012 260)`) or by coral.
- **Kind rings** on the node an agent lands on use the dashboard's dark state hues: read blue (`read`), edit pink (`edit`), error red (`error`), and command gray (`brain-command`) for commands and tools, never white (white is Claude). The ring's word is in the chip.
- **Selection** is the restrained violet (`accent`): a ring around the focused node, and its links mixed 45% toward violet at 0.6 opacity.
- **Heat:** where an agent is working the light is hot: a small glow in the region's color (0.11 of the brain's units) that turns near white at its center (0.05), on the cell the agent is on. When the agent moves on, the cell it left cools back to its region's color over 4.5s. The bloom (below) picks this up. Hot spots don't add up: the strongest keeps its glow, and one within 0.2 of it only shows by how far it is (its strength times the distance squared), so several agents on neighboring cells stay one bright spot, not a blob; a region flashes once at a time.
- **Embers:** a touched node keeps a whitened core that cools in steps (full under 1 min, 0.55 under 5 min, 0.28 under 15 min, then gone), checked every 15s.

**The Working Project Rule.** While a session works, its project's nodes and fibers rise to 1.15 and every other project drops to half; idle, all sit at 0.8.

### Elevation & depth

**The Night Well Rule.** The well is always dark, in both themes, because glow is additive light and needs a dark ground. It forces the dark token set on its own text and overlays, so a light-theme page frames a night window.

- **Ground:** a deep blue-violet night from `brain-night-center` at the middle (slightly above center) to `brain-night` at the edges, darkened by a vignette toward the corners, with a very sparse, very dim, static starfield (one candidate per 7px cell, about 1% lit). Screen space, never moves, never data.
- **Filament shell:** the cerebrum, cerebellum and brainstem are a web of short, slightly curved strands that turns with the scene: each of the shell's points (26,000; 12,000 on phones) joins its nearest neighbors ahead and behind along its gyrus, and now and then one in any direction, so the ridges read as strands and the whole as tissue (about 37,000 strands, 17,000 on phones, drawn as instanced ribbons in one draw call). Strands vary in opacity (0.25 to 1) and mix two tints, `brain-dust` (a cool blue-gray) and a little violet, and each takes 30% of its lobe's color, so the regions read on the shell too; a sparkle of junctions (the points themselves, faint) sits on top. The cerebellum is drawn as folia: twenty stacked leaf lines on its upper and lower surfaces, the level lines of the distance from its hilum (the middle of its front, where the brainstem joins), so from the side they are arcs that follow the dome and on the surface they are folds that run across it and never cross; closer together toward the rim, dimmer where the occipital lobes cover them, pale over a soft green glow so it reads as one solid structure. The brainstem's strands run along its axis in warm white. As before, the shell is brightest where it faces the camera (folds read as texture), has a soft, thin edge just inside the near side's rim, and is almost gone on the far side; it stays dimmer than nodes, tracts and pulses. Where agents work, the shell's points around their lobe light up softly (easing in over 0.6s, fading back over 2s), tinted halfway toward the lobe's color. The shape comes from four views traced from public-domain plates (`docs/reference/`): the side from Gray 728 with the brainstem from an 1892 plate (with the frontal lobe about 7% longer, warped smoothly so both ends stay put, and a fuller, rounder lower front; and the cerebellum 12% taller and wider, 6% longer and hanging a little lower, so more of it shows), the top, a coronal section and the cerebellum from Gray's Anatomy; each side-view column takes the coronal cross-section, scaled to its height and to the top view's width, so from the front it is a smooth dome with the temporal lobes as the lower part of each side, from the top an oval wider at the back, and from behind the occipital lobes sit right on the cerebellum's two rounded lobes. A thin fissure (about 2.5% of the width) splits the hemispheres; strands never cross it. While the camera moves the strands draw straight (their curve returns the moment it stops). Decoration: never interactive, never counted, never picked.
- **Glow:** region haze (soft sprites in each region's color, 0.035 strength) and the lit lobe (where agents are or recently were, up to 0.075, cooling with the embers, updated at most every 2s). Glow lives only inside the well.
- **Bloom:** where work adds a lot of light, it glows. The finished frame is halved by the GPU down to a quarter of its CSS size; what the cached brain already holds there (ground, shell, tracts, links) is taken out, so structure never blooms, however dense; a threshold (0.3, knee 0.3) passes only what is bright over an area (hot cells, beams, trails, agents); it is blurred in two passes (strength 0.9), plus a second, wider and fainter octave at half that size (0.3), and both are added back over the brain, capped at 0.45 per pixel in the light's own color: a hot area stays a bright glowing spot and never whites out. Adaptive: both octaves on a GPU; the tight one only, and weaker, on phones; none on a software renderer (there it costs about a core and a half, and at 3,000 nodes that renderer is already under the frame cap without it); and it steps down by itself (full, light, off, one way) when frames stay over 1.2 times the frame cap's interval for about a second and a half with it on.
- **Depth fog:** the far side of the brain is smaller (perspective), dimmer and a little greyer: nodes desaturate up to 30% and dim up to 60%, so their hue still reads; fibers desaturate up to 35% and, with sprites, lose up to 60% opacity; the shell fades by its surface's facing instead. Zoomed in, the fog starts just in front of what is looked at, so a close-up keeps its colors. Labels do not fade: they must stay readable.
- **Overlays** on the well (title, trace, camera bar, agents panel, focus card, tooltip) sit on an opaque `brain-veil` with a hairline border and 12px radius, never glass. Labels over the light get a dark halo behind the letters only (stacked `text-shadow`s of the night: three at 2px, three at 4px, two at 8px, two at 14px), the only shadow in the system, and only for legibility.

### Shapes

- **Nodes** are neon cells: the type's shape as a glowing outline in the region's color, hollow, with a bright core. The outline is a tube (lighter along its middle, a tight glow on both sides that ends inside the sprite) drawn from the distance to the shape, about a sixth of its radius wide and never under about a pixel and a half, so it is crisp at any zoom; from far away, below about 5px, it closes into a point of light in the region's color (the white core only shows as the shape grows). Per type: memory notes are triangles, code files circles, instructions diamonds, Serena notes hexagons, tools two concentric rings (no core); the rail's legend draws the same outlines. Nearer cells are a little bigger, farther ones smaller, dimmer and a little greyer. Their color is always their region's, at full strength: cells dim only where a lobe really is crowded (by its nodes per volume against a fixed reference, 3,000 nodes over the whole brain: full neon at 600 nodes, down to 0.42 in the densest lobe at 3,000). A cell that was just touched fills with light and turns white-hot, then cools back to its color. **Outlines by room:** a lobe's patch of screen holds only so many outlines before they merge into a painted patch and the tissue behind is lost: about one per 150px² at overview for a full-size cell, less for the smaller cells of a crowded lobe. Each lobe's cells are ranked by importance (instructions, then activity); those within the lobe's room are outlines, the far side's room is halved, and the rest collapse to small points (3px) of their color at 55% of their light, with fainter dendrites, so the filaments show through. The room grows with the square of the zoom, so closing in brings the outlines back; a cell that is hot, focused or found is always an outline. At 600 nodes every lobe has room for all its cells; at 3,000 about 1,250 are outlines at overview. Size grows only a little with activity (under 2x from the quietest to the busiest), so no cell dominates; an active cell (an ember, a flash) gets a wider glow, a lit inside and its kind ring. Life: each cell's light breathes slowly and softly (12%, 5 to 9 s a cycle), out of step with its neighbors; it shows whenever the brain is drawing anyway (work, the camera, Claude thinking) and stops with everything else when idle. Dendrites and an axon are drawn as thin fibers in the cached layer: memory notes and instructions are pyramidal cells (an apical dendrite toward the surface that forks, two or three basal dendrites, an axon down toward the core); code files, Serena notes and tools are round cells (three or four dendrites around, a shorter axon). Branches never leave the brain (a branch that would is shortened or dropped). Level of detail: at overview the main branches are faint (30% of full) and the forks hidden; zoomed in (from half the overview distance) everything shows in full; the focus, its neighbors and search hits are always in full detail, and a neuron that was just read, edited or run is drawn bright and in full every frame (at most 40) until its ember cools.
- **Density-adaptive light.** Lobes hold very different numbers of nodes per volume (at 3,000 nodes the occipital lobe packs about ten times the average, the frontal lobes a sixth of it). Each lobe gets a gain from its density against the average (to the power 0.6, between 0.22 and 1.6): its cells' size (gain to the power 0.4, between 0.58 and 1.2), their dendrites and its region haze follow it. The cells' own light goes by a second gain, from the lobe's density against a fixed reference (3,000 nodes over the whole brain; to the power 0.6, between 0.42 and 1.12), because an outline carries little light: full neon at 600 nodes, dimmer only where thousands share a lobe. A dense lobe never becomes a solid stain and the sparse front reads as evenly as the back; the same nodes, lit differently, nothing added. Nodes keep at least 0.04 from the shell in every direction, so none, and no halo, pokes outside it.
- **Fibers** are links drawn as curved ribbons with a bright core and a soft glow, colored from one region's color to the other's. Links within a region bow gently; links between regions run as a B-spline through the lobes they join along one shared lane per pair of lobes (arching up and in over the middle inside a hemisphere, longer lanes higher, like the long association tracts; crossing between hemispheres along the corpus callosum's arch; dipping toward the core to and from the brainstem), so they gather into bundles instead of fanning out. Base opacity is low (the tracts carry the structure) and differs by type (imports 0.25, links 0.2, read-first 0.16, cites 0.14, co-change 0.09, index 0.07), and drops with the number of links (×(900 / links)^0.65, at least 0.3) so thousands of crossings never burn out to white or paint a region. Co-change links are statistical, so they are dashed and thinner (2.2px against 3.2px). While the camera moves, fibers draw straight (one segment each) so slow GPUs keep up; the smooth curves (14 segments between regions, two inside one) return the moment it stops.
- **Tracts** are the busiest lanes (the top ten pairs of lobes by links, each at least 3% of the links between lobes) drawn as thick, smooth, glowing bundles: five to eight strands, one with a white core, tight in the middle and fanning out (and fading) before the lobes' centers, brighter and wider the more links they carry. Fixed structures go with them: the corpus callosum (eight strands along its arch, brighter the more links cross between hemispheres), the brainstem as a bright warm-white bundle up its axis that fans into both hemispheres, and seven Purkinje cells in the cerebellum (a soma and a flat fan of branches, four levels deep). While work goes on, pulses (white-cored, 0.9–1.3s each, at most six) run along the tracts that touch the lobe just worked on.
- **Beams** are an agent's trip: a 16px glowing tube, a white core inside a wide halo in its hue, that travels the fiber lane between lobes (or arcs over the surface inside one lobe) from where it was to the file it now reads or edits, drawn from 60% behind the head up to the head, lingering 480ms after it lands. **Trails:** behind the head the whole path stays as a thinner arc (10px, white core) in the agent's color (silver for a subagent, coral for Claude), a little brighter toward where it went, and fades over 4.5s, so an agent's way from file to file can be seen (the newest 14; none with animations off). In a narrow well (under 900px) beams and trails get thinner, down to 60% on a phone.

### Components

- **Lobe labels:** hidden at overview, so only the agent tags show and the brain has room to breathe. A lobe's label appears when the pointer is over it (the nearest node within 64px), for all lobes when zoomed in past 0.72 of the overview distance, or always with the **Labels** toggle (remembered per device). On the brain, right on the region it names, with no box and no leader line: centered on the projected center of the lobe's nodes in the hemisphere that faces the camera (both from the front, the back or above; the one that is left when cut open). Plain text over a dark halo behind the letters only, one line, a 6px dot and the lobe's name in its color (12px, weight 500, tracked 0.02em), its role dimmer in ink 2 ("● Frontal · docs"), at 0.86 opacity. Labels never overlap: by priority (where agents work, then node count) each takes the free spot nearest its center, and never leaves its region (it moves at most 0.6 of the lobe's radius on screen; with no free spot there, or under a panel, it is not shown). Over a crowded patch of cells (more than one per 220px² under it) the halo behind the letters is stronger (eighteen stacked shadows up to 18px, opacity 0.95), still with no box. A lobe on the far side (more than a quarter of the brain's radius behind its center, like the prefrontal lobe from the back) has no label unless agents work there. The lobe's groups (in their region colors, most important first: focused region, where agents work, the working project, then size; at most three and "+n") show on a second line only for the lobe under the pointer, or zoomed in past 0.55 for lobes near the middle of the view. Labels fade out only for the user's hand: a drag and its throw. When the camera moves by itself (Auto-rotate, Follow, a zoom) they stay and track their regions, laid out every frame: each keeps its spot while it is free and glides to its place (30% of the way a frame), fading in and out as its lobe turns toward or away from the viewer. Where agents work the label brightens (full opacity, weight 600); the others dim through their dot, never their text. An agent's tag wins: chips take a spot that covers no label when they can, and a label under one fades to 0.1. On a phone (below 520px) one label at most: the lobe where an agent last worked; none when nothing works.
- **Agent chips:** pill on `brain-veil`, hairline border, the white-core dot in the agent's hue, the number (and type when there is room), the kind word in its state color and the target in monospace. They follow their agent and fade out (200ms) about 2.6s after it finishes. Agents within 70px of each other share one stack of chips, in their order on screen, each with a thin line (its agent's hue at 0.6) back to its agent, so tags never overlap.
- **Activity trace:** a 250px card with an EEG-like line from real events (an ink 2 line, thinking tokens as a faint ink 3 band) and a status word (working in green, thinking, idle) on its own row above the line; below 640px a compact 190px card keeps only the word and the line.
- **Camera bar:** a segmented control on the veil: +, −, Fit, Re-layout, Follow, Auto-rotate. The view opens, and Fit returns, at a 3/4 side view (frontal toward the viewer's right) that frames the particle shell with a margin, on phones too.
- **Focus card:** the focused node's card on the veil, its region in the region's color. On wells wider than 900px the camera eases aside by half the card's width, so the card never covers the brain, and its height stops above the agents panel (its neighbor list scrolls inside), so live status stays visible.
- **Animations switch:** the dashboard's switch, top right of the well, with a small segmented control beside it (under it on phones): **Labels** (always show lobe labels) and **Cut**.
- **Cut:** a midsagittal cutaway. The hemisphere facing the camera loses its cerebrum's shell, its nodes, links and dendrites are hidden (so nothing shows outside the half that stays), and the far hemisphere's inner wall shows (its back-facing strands at 0.4), so the inside reads: the corpus callosum's arch, neurons, the brainstem bundle, the cerebellum. The cut follows the camera across the midline; dimmed nodes are not picked.

### Motion

Beam travel 620–1200ms (longer for farther trips) with a cubic ease-in-out; ignition ring 750ms ease-out, a flash on the node that fades over about a second, and the region glowing in its color for 1.4s; the trail of the trip and the heat of the cell the agent left fade over 4.5s; while events keep coming (the last 3s), small signals (900ms each, at most 8) run along the links of what was just touched, toward it; while Claude thinks, a soft coral glow (`brain-breath`) breathes through the whole brain every 4.2s, drawn at about 12 frames a second when nothing else moves; think ripple 2.4s across nearby nodes; a subagent appears with an 800ms ring; drag inertia decays with a 260ms time constant; zoom, Fit and Follow ease with a 140ms time constant; project dimming eases over about 220ms; embers and the lit lobe cool at 1, 5 and 15 min.

**The intro.** Once per page load the brain builds itself in about 3 seconds: a seed of light and a ring at the brainstem's base (0–0.7s), then a rising wave with a soft white glow at its front: the brainstem (from 0.25s), the cerebellum (0.6s), the cerebrum from its base to its top (0.9–1.9s), nodes and dendrites with their part, links once both ends are there; the tracts light up last (1.85–2.3s), a glow running along each from one end to the other while pulses shoot along some of their strands; one brightness wave spreads from the center through everything (2.3s, 0.55s); at 2.95s it settles into the normal state and the replay starts. It never plays with animations off or `prefers-reduced-motion`, never again on returning to the tab, and a click, drag, scroll or key skips to the end. It is drawn as a composite: the cached layers once, in full, plus a texture of when the wave reaches each pixel; each intro frame adds the ground, the brain where the wave has passed and the glow at its front, then the nodes and the tracts on their own clock, so it holds the normal frame rate. Its clock starts once the first two frames are drawn, so a slow first frame never eats the opening.

**The Still Idle Rule.** Idle is fully still, calm and a little dim (every project at 0.8). The loop draws only while something moves (the intro, camera, beams, trails, cooling heat, rings, ripples, signals, pulses, Claude's breath, Follow, Auto-rotate), at most 30 frames a second, then sleeps; nothing renders while the tab is hidden or another view is shown. Follow and Auto-rotate are off by default, and Auto-rotate is remembered per device. **Auto-rotate** (about 7 degrees a second) keeps turning through everything: agents working, events, nodes lighting up, Follow moving the camera (then it orbits what Follow looks at, at 60% of the speed). Only the user's hand pauses it (a drag, a zoom, a click), and 3s after the last touch it comes back, easing in over 1.2s. It is the one thing that may keep an idle brain moving, because the user asked for it; with it off, idle stays fully still. "Animations off", which `prefers-reduced-motion` sets by default, draws single static frames: beams land at once, no rings, ripples, flashes, signals or inertia, and the breath is a still glow.

### Layout

Wide screens: the dashboard's app shell with a 252px rail and the well filling the rest. Below 900px the rail folds into a disclosure above the well, the well is 78vh (at least 480px) and the page scrolls; below 640px the trace compacts and moves with the camera bar under the title; below 520px one lobe label at most shows and chips drop the agent type.

### Do's and Don'ts

- **Do** keep lobe colors, glow, fog and the lit ground inside the well, and keep the chrome around it the dashboard's.
- **Do** give every piece of activity a white core, a label or a ring in a state hue, so it never reads as a region.
- **Do** keep Claude's coral for Claude, and let the bloom take only what work adds: the shell, the tracts and the links never bloom.
- **Do** keep the starfield, the filament shell and the fixed structures (corpus callosum, brainstem bundle, Purkinje cells) decorative: static or turning with the scene, never interactive, never counted.
- **Do** keep the overview quiet: agent tags only; labels on hover, zoomed in or with the toggle.
- **Don't** let the well turn light in the light theme.
- **Don't** animate an idle brain: no breathing when nothing else draws, no drifting stars, no default rotation (Auto-rotate, when the user turns it on, is their choice).
- **Don't** tell an agent from a region by hue: subagents are silver, Claude is coral, regions are colors.
- **Don't** use a lobe color outside the well, or for a state.
