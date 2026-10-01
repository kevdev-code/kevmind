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
  brain-night: "oklch(12.5% 0.028 280)"
  brain-night-center: "oklch(22% 0.055 280)"
  brain-veil: "oklch(15.5% 0.016 285)"
  brain-label-veil: "oklch(12.5% 0.028 280 / 0.82)"
  brain-dust: "oklch(82% 0.035 290)"
  brain-command: "oklch(72% 0.012 285)"
  lobe-prefrontal: "oklch(80% 0.13 78)"
  lobe-frontal: "oklch(78% 0.13 152)"
  lobe-parietal: "oklch(72% 0.14 295)"
  lobe-occipital: "oklch(76% 0.12 238)"
  lobe-temporal: "oklch(74% 0.15 356)"
  lobe-cerebellum: "oklch(78% 0.11 190)"
  lobe-stem: "oklch(75% 0.13 45)"
  agent-main: "oklch(95% 0.02 285)"
  agent-cyan: "oklch(82% 0.12 200)"
  agent-chartreuse: "oklch(87% 0.16 117)"
  agent-lilac: "oklch(76% 0.11 314)"
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
    backgroundColor: "{colors.brain-label-veil}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.sm}"
    padding: "2px 8px 3px"
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

The Brain tab (Phase 4, prototyped standalone in `prototype/brain/`) is a second world nested inside the instrument: a night well holding a living 3D brain of the project, where regions are colored lobes, links are glowing fibers and agents travel as white-cored beams. Everything outside the well (header, rail, filters, switches, buttons) stays the dashboard above, unchanged. Everything inside the well is drawn as additive light on a dark ground, which is why the well has its own rules.

### Colors

**The Brain Well Exemption.** Inside the well, and only there, each lobe has a categorical color by what it holds. This is the one exemption from the One Meaning Rule; the lobe hues never leave the well (the rail's region legend repeats them as dots beside their words, which is the same key, not a new use). Everywhere else, One Meaning holds.

- **Prefrontal Amber** (`lobe-prefrontal`): instructions (CLAUDE.md, rules) and feedback notes.
- **Frontal Green** (`lobe-frontal`): docs.
- **Parietal Violet** (`lobe-parietal`): logic, the code.
- **Occipital Azure** (`lobe-occipital`): interface.
- **Temporal Pink** (`lobe-temporal`): memory.
- **Cerebellum Teal** (`lobe-cerebellum`): tools and tests.
- **Brainstem Orange** (`lobe-stem`): infrastructure.

Regions inside a lobe shift around its color so neighbors stay apart: hue by 0, +10, −10, +18, −18 degrees and lightness by 0, +3, −3 points, in the order the regions appear. Text in a region's color (labels, the focus card) is lifted 6 points of lightness, capped at 88%; the legend dot is the lobe color lifted 4 points.

**The White Core Rule.** Activity never passes for a region. Whatever happened, rather than what something is, carries a white core, a label or a ring:
- **Agents** are colored beams and heads with a white core and a numbered chip ("#1 Explore"). The main agent is near-white (`agent-main`); subagents take, in order, cyan (`agent-cyan`), chartreuse (`agent-chartreuse`) and lilac (`agent-lilac`). The same hue marks the agent's chip dot and its row in the agents panel, always a white center ringed by the hue.
- **Kind rings** on the node an agent lands on use the dashboard's dark state hues: read blue (`read`), edit pink (`edit`), error red (`error`), and command gray (`brain-command`) for commands and tools, never white (white is Claude). The ring's word is in the chip.
- **Selection** is the restrained violet (`accent`): a ring around the focused node, and its links mixed 45% toward violet at 0.6 opacity.
- **Embers:** a touched node keeps a whitened core that cools in steps (full under 1 min, 0.55 under 5 min, 0.28 under 15 min, then gone), checked every 15s.

**The Working Project Rule.** While a session works, its project's nodes and fibers rise to 1.15 and every other project drops to half; idle, all sit at 1.

### Elevation & depth

**The Night Well Rule.** The well is always dark, in both themes, because glow is additive light and needs a dark ground. It forces the dark token set on its own text and overlays, so a light-theme page frames a night window.

- **Ground:** a radial night from `brain-night-center` at the middle (slightly above center) to `brain-night` at the edges, darkened by a vignette toward the corners, with a sparse, dim, static starfield (one candidate per 6px cell, about 1.4% lit). Screen space, never moves, never data.
- **Particle shell:** about 13,000 dust points in `brain-dust` sketch the cerebrum, cerebellum, brainstem and a faint midline fissure, and turn with the scene. Decoration: never interactive, never counted, never picked.
- **Glow:** region haze (soft sprites in each region's color, 0.055 strength) and the lit lobe (where agents are or recently were, up to 0.075, cooling with the embers, updated at most every 2s). Glow lives only inside the well.
- **Depth fog:** the far side of the brain is smaller (perspective), dimmer and greyer. Nodes desaturate up to 55% and dim up to 50%; fibers and sprites lose up to 60% opacity; far lobe labels drop to 0.6.
- **Overlays** on the well (title, trace, camera bar, agents panel, focus card, tooltip) sit on an opaque `brain-veil` with a hairline border and 12px radius, never glass. Labels over the light get a dark halo (`text-shadow` 0 0 6px and 0 0 2px of the night), the only shadow in the system, and only for legibility.

### Shapes

- **Nodes** are neuron sprites: a crisp shape per type with a soft halo in the region color and up to four short dendrites (fixed per node, drawn only once the sprite is over 10px). Files are dots, instructions diamonds, memories triangles, Serena memories squares, tools rings. Size and brightness grow with activity; crowded lobes get smaller, dimmer nodes so additive light does not blow out. The rail's type filter shows the same shapes as icons.
- **Fibers** are links drawn as curved ribbons with a bright core and a soft glow, colored from one region's color to the other's. Links within a region bow gently; links between regions run as a B-spline through the lobes they join along one shared lane per pair of lobes (dipping toward the core inside a hemisphere, crossing the midline high between hemispheres, like the corpus callosum), so they gather into bundles instead of fanning out. Base opacity is low and differs by type (imports 0.42, links 0.34, read-first 0.26, cites 0.24, co-change 0.15, index 0.12, midline 0.5). Co-change links are statistical, so they are dashed and thinner (2.2px against 3.2px). While the camera moves, fibers draw straight (one segment each) so slow GPUs keep up; the smooth curves (14 segments between regions, two inside one) return the moment it stops.
- **Beams** are an agent's trip: a 16px glowing tube, a white core inside a wide halo in its hue, that arcs over the surface (lifting away from the core) from where it was to the file it now reads or edits, drawn from 60% behind the head up to the head, lingering 480ms after it lands.

### Components

- **Lobe labels:** one per lobe, placed inside the brain on the side facing the camera. The lobe is small on top in ink 3 ("Prefrontal · instructions", 12px, sentence case, ink 2 while agents work there); under it the lobe's groups in their region colors (13px semibold, most important first: focused region, where agents work, the working project, then size), at most three (two below 520px) and "+n". On a `brain-label-veil` with 6px radius. A label never covers an agent: chips take the first free spot around their agent, and a label gives way only when a chip has nowhere else to go.
- **Agent chips:** pill on `brain-veil`, hairline border, the white-core dot in the agent's hue, the number (and type when there is room), the kind word in its state color and the target in monospace. They follow their agent and fade out (200ms) about 2.6s after it finishes.
- **Activity trace:** a 250px card with an EEG-like line from real events (an ink 2 line, thinking tokens as a faint ink 3 band) and a status word (working in green, thinking, idle) on its own row above the line; below 640px a compact 190px card keeps only the word and the line.
- **Camera bar:** a segmented control on the veil: +, −, Fit, Re-layout, Follow, Auto-rotate. The view opens, and Fit returns, at a 3/4 side view (frontal toward the viewer's right) that frames the particle shell with a margin, on phones too.
- **Focus card:** the focused node's card on the veil, its region in the region's color. On wells wider than 900px the camera eases aside by half the card's width, so the card never covers the brain, and its height stops above the agents panel (its neighbor list scrolls inside), so live status stays visible.
- **Animations switch:** the dashboard's switch, top right of the well.

### Motion

Beam travel 520–1000ms (longer for farther trips) with a cubic ease-in-out; ignition ring 750ms ease-out and a flash on the node that fades over about a second; think ripple 2.4s across nearby nodes; a subagent appears with an 800ms ring; drag inertia decays with a 260ms time constant; zoom, Fit and Follow ease with a 140ms time constant; project dimming eases over about 220ms; embers and the lit lobe cool at 1, 5 and 15 min.

**The Still Idle Rule.** Idle is fully still. The loop draws only while something moves (camera, beams, rings, ripples, Follow, Auto-rotate), at most 30 frames a second, then sleeps; nothing renders while the tab is hidden or another view is shown. Follow and Auto-rotate are off by default; Auto-rotate (about 7 degrees a second) waits 3s after input and 4s after an event. "Animations off", which `prefers-reduced-motion` sets by default, draws single static frames: beams land at once, no rings, no ripples, no inertia.

### Layout

Wide screens: the dashboard's app shell with a 252px rail and the well filling the rest. Below 900px the rail folds into a disclosure above the well, the well is 78vh (at least 480px) and the page scrolls; below 640px the trace compacts and moves with the camera bar under the title; below 520px labels show two groups and chips drop the agent type.

### Do's and Don'ts

- **Do** keep lobe colors, glow, fog and the lit ground inside the well, and keep the chrome around it the dashboard's.
- **Do** give every piece of activity a white core, a label or a ring in a state hue, so it never reads as a region.
- **Do** keep the starfield and the particle shell decorative: static or turning with the scene, never interactive, never counted.
- **Don't** let the well turn light in the light theme.
- **Don't** animate an idle brain: no breathing, no drifting stars, no default rotation.
- **Don't** use a lobe color outside the well, or for a state.
