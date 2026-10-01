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
---

# Design System: KevMind

## 1. Overview

**Creative North Star: "The Quiet Instrument"**

KevMind sits on a second monitor or a third of the screen for hours, glanced at every minute or two, often in a dim room late in the day. It should read like a well-made instrument rather than a show: calm, precise, quietly confident. One thing on the screen is loud, and only when it is true: Claude needs you. Everything else steps back until you look for it.

The system is dark first, with a light theme for bright rooms, chosen by the system or by the switch in the header. Neutrals are tinted slightly toward the brand's purple hue (285), so the dark is warm-violet rather than blue-gray; the purple accent itself is reserved for selection, focus and primary actions. State has its own vocabulary, one hue per meaning, as clear as GitHub Primer's. Density follows Linear: many small labels and rows, generous only where it separates groups. The side rails sit directly on the canvas; only the center work uses panels, so the eye lands there.

It rejects, by name, the anti-references in PRODUCT.md: the neon "AI dashboard" (glows, gradients, glassmorphism, purple haze, which are reserved for the future, optional brain view), the Grafana wall where every panel shouts at the same volume, the SaaS admin template of identical cards and big hero numbers with tiny labels, and the hacker terminal (monospace is for paths, commands and file names only).

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
- **Don't** build the neon "AI dashboard": no glows, gradients, glassmorphism or purple haze. They are reserved for the future, optional brain view.
- **Don't** build a Grafana wall where every panel shouts at the same volume, or a chart wall.
- **Don't** use the SaaS admin template: no identical cards, no big hero numbers with tiny labels, no generic icon tiles.
- **Don't** go hacker terminal: no green on black, no monospace outside paths, commands and file names.
- **Don't** use a colored `border-left` or `border-right` wider than 1px as an accent on rows, alerts or issues. Tint the background and use a full border.
- **Don't** put uppercase tracked labels above panels, or text below 12px.
- **Don't** let a list grow without bound on screen: alerts show the latest three with "show all", the feed keeps 150 rows.
