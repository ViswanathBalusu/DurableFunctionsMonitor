---
name: Durable Functions Monitor
description: A calm developer console for Azure Durable Functions task hubs, where status and the failure onset are the loudest things on screen.
colors:
  iris-indigo: "#5b5bd6"
  iris-indigo-hover: "#4c4cc8"
  iris-link: "#4747bf"
  iris-wash: "#ececfc"
  iris-selection: "#dcdcfb"
  iris-ring-dark: "#8b8dfa"
  jade-teal: "#0e7f73"
  ember-copper: "#b45309"
  ember-link: "#8a4b21"
  ember-warm-grey: "#85766a"
  mono-blue: "#0068e0"
  cool-ground: "#f6f6f9"
  panel-white: "#ffffff"
  ink: "#121218"
  muted-surface: "#f1f1f5"
  muted-text: "#5b5d6e"
  hairline: "#e4e4eb"
  line-soft: "#eeeef3"
  line-strong: "#d4d4dd"
  row-hover: "#f8f8fb"
  ground-dark: "#09090c"
  panel-dark: "#111116"
  popover-dark: "#17171e"
  ink-dark: "#ececf1"
  muted-text-dark: "#9c9dae"
  hairline-dark: "#24242d"
  status-completed: "#2f9e62"
  status-running: "#e5a031"
  status-failed: "#e5484d"
  status-pending: "#3e86f5"
  status-terminated: "#8b8d98"
  status-canceled: "#b2b4be"
  status-continued: "#8e62e3"
  status-suspended: "#ef7b3a"
  pill-completed-bg: "#e3f5ea"
  pill-completed-fg: "#146c37"
  pill-running-bg: "#fcf0d9"
  pill-running-fg: "#8a5207"
  pill-failed-bg: "#fde7e9"
  pill-failed-fg: "#b51d2a"
  pill-pending-bg: "#e6effe"
  pill-pending-fg: "#1c56c4"
  pill-terminated-bg: "#eeeef2"
  pill-terminated-fg: "#4a4c58"
  pill-continued-bg: "#efe9fd"
  pill-continued-fg: "#6431c9"
  pill-suspended-bg: "#fdebe0"
  pill-suspended-fg: "#a1400c"
  destructive: "#cf333a"
  destructive-hover: "#b92d33"
  entity-pink: "#db5c9b"
typography:
  display:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.003em"
    fontFeature: "\"cv11\", \"ss01\""
  label:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 550
  caption:
    fontFamily: "Mona Sans Variable, Mona Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 550
  data:
    fontFamily: "JetBrains Mono, JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  control: "8px"
  overlay: "10px"
  panel: "12px"
  dialog: "14px"
  sheet: "16px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.iris-indigo}"
    textColor: "{colors.panel-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.iris-indigo-hover}"
  button-secondary:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.row-hover}"
  button-ghost-hover:
    backgroundColor: "{colors.muted-surface}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.control}"
    height: "32px"
  button-destructive-hover:
    backgroundColor: "{colors.destructive-hover}"
  button-sm:
    height: "28px"
    padding: "0 10px"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
  status-pill-failed:
    backgroundColor: "{colors.pill-failed-bg}"
    textColor: "{colors.pill-failed-fg}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  status-pill-completed:
    backgroundColor: "{colors.pill-completed-bg}"
    textColor: "{colors.pill-completed-fg}"
    rounded: "{rounded.pill}"
    height: "22px"
  status-pill-running:
    backgroundColor: "{colors.pill-running-bg}"
    textColor: "{colors.pill-running-fg}"
    rounded: "{rounded.pill}"
    height: "22px"
  tab:
    textColor: "{colors.muted-text}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "38px"
  tab-selected:
    textColor: "{colors.ink}"
  nav-item:
    textColor: "{colors.muted-text}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.iris-wash}"
    textColor: "{colors.ink}"
  panel:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
  table-row:
    height: "36px"
  table-row-selected:
    backgroundColor: "{colors.iris-wash}"
  popover:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.overlay}"
    padding: "4px"
  dialog:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.dialog}"
    padding: "20px 22px"
---

# Design System: Durable Functions Monitor

## Overview

**Creative North Star: "The Quiet Console"**

DfMon is a contemporary developer console held to the craft level of Linear, Vercel, Trigger.dev and Inngest. The surfaces are calm and neutral: a near-white or near-black ground, panels one step off it, structure drawn with 1px low-contrast hairlines, one confident accent per theme. Everything else is turned down so that status colour and the onset of failures are the loudest things on any screen. An operator on a bad day reads the hub's health from one strip, sees where failures began, and reaches the failing thing in a click.

The system is one family, **studio**, with four themes that share every shape, type and status rule and differ only in their neutrals and their accent: **Iris** (indigo on cool grey, the default), **Jade** (teal on slate), **Ember** (warm grey, with the ember kept to what is pressed and followed) and **Mono** (black, white and blue). Each has a light and a dark face. The frontmatter tokens are Iris light unless a key says otherwise; the other themes swap the same roles. It is dense in the way an Operate surface should be (32px controls, 36px rows, 14px body) without being cramped.

It refuses the looks it replaced: hard-offset brutalist shadows and thick ink outlines, frosted glass, neumorphism and rainbow KPI tiles. The seven older themes (Poster, Riso, Memphis, Blueprint and Hazard as the brutal papers; Glass; Neu) remain selectable legacy families in `src/styles/families/` and the frozen base sheets, but they are not this system and new work does not draw from them.

**Key Characteristics:**
- One accent per theme; status hues are family-level and never borrowed as an accent.
- 1px hairlines everywhere; no thick outlines.
- 8px controls, 12px panels, pills fully round.
- Status as a tinted pill with a solid dot; spines, chart series, swimlane bars and swatches in the strong hue.
- Mona Sans for the interface, JetBrains Mono for machine values.
- A lifted shadow only on what floats; resting surfaces carry at most a 1px contact shadow.

## Colors

Neutral grounds with a single theme accent, and a fixed set of status hues that outrank everything else on the page.

### Primary
- **Iris Indigo** (`iris-indigo`): the default theme's accent and `--primary`. Fills primary buttons, checked boxes, switches, the logo tile and the selected calendar ends; it is the focus ring and the active-tab underline in light. Dark mode keeps the same fill and lifts the ring to `iris-ring-dark` and links to a paler indigo.
- **Iris Wash** (`iris-wash`) and **Iris Selection** (`iris-selection`): the accent's tints, for the selected table row, the active nav item, the active menu and palette row, the highlighted lane, the brushed chart range and text selection.
- **Iris Link** (`iris-link`): links and Needs attention actions, a step deeper than the fill for 4.5:1 on white.

### Secondary (the other three themes' accents)
- **Jade Teal** (`jade-teal`): Jade's fill and light ring; dark ring and chart neutral move to a brighter teal (#2dd4bf).
- **Ember Copper** (`ember-copper`): Ember's fill, used only on filled buttons, checked boxes, the logo, the focus ring and (as the browner `ember-link`) links. Its highlights, selection, row wash, chart neutral and orchestrator colour are warm greys (`ember-warm-grey`, #e8dfd5, #f1ebe5), and its active tab and active nav icon take the foreground.
- **Mono Blue** (`mono-blue`): Mono's `--primary`, used for focus, links and selection only. Mono's buttons are inverse (the foreground as fill: #111111 on light, #ededed on dark) and its indicator is the foreground.

### Tertiary (status)
- **Completed Green** (`status-completed`), **Running Amber** (`status-running`), **Failed Red** (`status-failed`), **Pending Blue** (`status-pending`), **Terminated Grey** (`status-terminated`), **Canceled Grey** (`status-canceled`), **ContinuedAsNew Violet** (`status-continued`), **Suspended Orange** (`status-suspended`): the strong hues. They paint the table row spine (3px), stat-strip dots and sparklines, chart series, swimlane bars, legend and "Where the time went" swatches. Dark mode lifts each a step (for example Failed #f2555a).
- **Status pills** (`pill-*-bg` / `pill-*-fg`): a light tint of the hue with text in a deep shade of it, each pair at 4.5:1 or better; in dark mode the tint is a deep wash and the text a pale shade.
- **Entity Pink** (`entity-pink`): the entity kind (its tile dot, sparkline and a pink-tinted kind pill); orchestration kind is a muted grey pill.
- **Destructive** (`destructive`, hover `destructive-hover`): filled destructive buttons, the 3px warning edge of a confirm dialog. The failure wash on the chart's onset band is the failed hue at 7% (10% in dark).

### Neutral
- **Cool Ground** (`cool-ground`): the page and the side rail in light Iris.
- **Panel White** (`panel-white`): panels, cards, table headers, inputs, popovers and secondary buttons.
- **Ink** (`ink`): text and marks (`--glyph`: the sort caret, the disclosure triangle, sequence arrows, the orchestrator line on a swimlane).
- **Muted Surface** (`muted-surface`) and **Muted Text** (`muted-text`): segmented-control troughs, read-only editors, banners and notes; secondary text, table headers, inactive tabs and nav items.
- **Hairline** (`hairline`), **Line Soft** (`line-soft`), **Line Strong** (`line-strong`): the outline of every control and panel; the divider between rows and inside panels; hover borders, ghost-button outlines, checkbox edges and the scrollbar.
- **Row Hover** (`row-hover`): hover on rows, tiles and secondary buttons.
- **Dark faces** (`ground-dark`, `panel-dark`, `popover-dark`, `ink-dark`, `muted-text-dark`, `hairline-dark`): Iris dark, three steps of near-black for ground, panel and floating layer.

### Named Rules
**The Status Owns The Warm Side Rule.** Status hues are family-level, identical in all four themes, and no theme's accent may read as one. Ember proves it: because Failed, Suspended and Running already hold red, orange and amber, Ember's highlights are warm greys and its copper stays on what is pressed and followed.

**The One Primary Rule.** `--primary` is the theme's swatch and has the same value in light and dark for every studio theme (an e2e theme matrix asserts it). What a primary button is filled with is `--solid`, which equals the accent except in Mono.

**The Hue Is For Marks, The Tint Is For Words Rule.** A status shown as text sits in a tinted pill with deep text; a status shown as a mark (spine, bar, series, swatch, dot in the strip) uses the strong hue.

## Typography

**Display Font:** Mona Sans Variable (with ui-sans-serif, system-ui, Segoe UI)
**Body Font:** Mona Sans Variable
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** A neutral, slightly tight grotesk at in-between variable weights (550, 650) carries the whole interface; the mono is reserved for values a machine produced. Both faces are bundled from npm, never fetched, because of the CSP and the VS Code webview.

### Hierarchy
- **Display** (600, 26px, line-height 1, -0.02em): the counts in the status strip.
- **Headline** (650, 22px, -0.025em): page titles and the empty-state heading; the instance hero title runs clamp(20px, 2.2vw, 26px); dialog titles 17px/650.
- **Title** (600, 14px, -0.015em): panel and section headings.
- **Body** (400, 14px, line-height 1.5, -0.003em, features cv11 and ss01): everything else.
- **Label** (550, 13px): buttons, tabs, nav items, segmented controls, field labels.
- **Caption** (550, 12px): table headers, status pills (11px in the small pill), legends at 500, side notes at 500.
- **Data** (JetBrains Mono, 12.5px, tabular figures): instance ids, timestamps, durations, payloads, and the numeric cells and chart axes of tables and plots.

### Named Rules
**The Machine Voice Rule.** Mono only for what a machine wrote: ids, times, durations, counts in cells, payloads. Prose about the data (side notes, placeholders, the hub name, the find field, the onset label) stays in Mona Sans.

**The No Shouting Rule.** No uppercase tracked labels and no overline kickers; hierarchy comes from weight and size alone.

## Layout

A two-column shell: a 240px side rail (64px collapsed) beside the content, with a 52px one-row top bar over the content. Pages are a single column of panels with a 20px gap; panels pad 14px 16px. The Overview opens with one status strip, six cells on a shared panel split by 1px hairlines (the line colour shows through a 1px grid gap), then throughput beside Needs attention, then tables.

Spacing runs on small steps (2, 4, 8, 12, 16, 20px); controls gap 6-8px inside, 12px between groups. Control height is 32px (36px large, 28px small), table rows 36px, tabs 38px.

Responsive behaviour: at 1100px the strip folds to three columns; at 768px the shell becomes one column with a bottom navigation, the strip folds to two columns, cards replace table rows and every other chart tick is dropped. The top bar steps down by container query (1000, 920, 780, 650px), hiding or moving its tools to a second row before anything is crushed. A table wider than its frame fades its scrolled edge into the card (40px) so cut-off cells read as "more". Swimlane labels that do not fit their bar spill beside it rather than clipping mid-letter.

## Elevation & Depth

Depth is mostly tonal: ground, panel one step off it, popover one step further (most visible in dark). Shadows are soft and grey, never offset. Resting controls and panels carry only a near-invisible 1px contact shadow; the one real lifted shadow belongs to layers that float above the page: popovers, menus, dialogs, toasts, the bulk bar, the peek panel and the phone sheet, over a 40% veil (60% in dark).

### Shadow Vocabulary
- **Contact** (`box-shadow: 0 1px 2px rgba(17, 17, 26, 0.05)`): resting buttons, inputs, panels, cards, the status strip, failure groups.
- **Hover** (`box-shadow: 0 2px 6px rgba(17, 17, 26, 0.08)`): graph nodes.
- **Lifted** (`box-shadow: 0 16px 40px -12px rgba(17, 17, 26, 0.22), 0 4px 12px -4px rgba(17, 17, 26, 0.08)`): every floating layer. Dark uses `0 24px 56px -16px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.04)`.
- **Sheen** (`inset 0 1px 0 rgba(255, 255, 255, 0.03)`, dark only): a top-edge highlight on panels, cards and the hero.

### Named Rules
**The Only What Floats Rule.** A lifted shadow means "this is above the page". Nothing at rest gets more than the contact shadow, and no shadow is ever offset.

## Shapes

Gently rounded, never soft. Controls (buttons, inputs, segmented controls, nav items, the logo tile) are 8px; panels, tables, the strip, charts and the swimlane frame 12px; popovers, toasts, banners and notes 10px; dialogs and the instance hero 14px; the phone sheet 16px at its top. Small parts step down: 6px for menu rows, segmented buttons, tags and calendar days, 4px for checkboxes, swatches and swimlane bars, 3px for legend keys. Pills (status, filter chips, the danger badge, switches) are fully round. Every outline is 1px; a dashed line marks something provisional or temporal (the empty state, the add-filter chip, the failure onset, waiting bars, lifelines, the now line).

## Components

### Buttons
Quiet and exact: a white button with a hairline, the accent kept for the one action that matters.
- **Shape:** 8px corners, 32px tall (28px small), 13px/550 label, 12px side padding.
- **Primary:** filled with the theme's solid (the accent; Mono's foreground) with white or inverse text.
- **Secondary (default):** panel white, hairline border, ink text, contact shadow.
- **Hover / Focus:** background to row hover and border to line strong, fading 120ms ease-out on the way in only; no lift, no transform. Focus is a 2px ring in the theme's ring colour at 2px offset. Disabled is 45% opacity.
- **Ghost / Flat:** transparent with a line-strong outline, muted surface on hover.
- **Destructive:** filled destructive red; in a failure row it becomes an outline in the failed hue that tints on hover, while the group's own Purge all stays filled. A dangerous operation (replay, restart in place) adds a 2px amber edge along its top.

### Status pills and chips
- **Style:** 22px (18px small) fully round, 8px padding, 12px/550, a 6px dot in the text colour before the label, tinted background, no border.
- **Filter chips:** 28px round, hairline outline on panel white, a round 16px clear button that tints red on hover; the add chip is dashed.
- **Danger badge:** a 26px pill in the Running tint with a dot ("Dangerous operations on").

### Cards / Containers
- **Corner Style:** 12px (14px for the instance hero).
- **Background:** panel white on the ground.
- **Shadow Strategy:** contact shadow only (see Elevation & Depth).
- **Border:** 1px hairline.
- **Internal Padding:** 14px 16px; the empty state is a dashed line-strong frame.

### Inputs / Fields
- **Style:** 32px, 8px corners, hairline border, input white (a step below the panel in dark), contact shadow. Checkboxes are 16px with 4px corners, filled with the solid when checked; switches 34x20 round, solid when on.
- **Focus:** border to the ring colour plus the 2px focus ring; hover strengthens the border.
- **Error / Disabled:** disabled follows the 45% rule; the find field carries a small keycap hint.

### Navigation
- **Side rail:** 32px items, 8px corners, muted text at 550; hover takes the muted surface; the active item takes the accent wash with its icon in the indicator colour (the accent, or the foreground in Ember and Mono). Failure count as a red pill.
- **Tabs:** a text row over one hairline; inactive muted, the selected one ink with a 2px underline in the indicator colour.
- **Top bar:** 52px, ground background, hairline below.
- **Phone:** a bottom navigation on the card surface; the active item in the link colour.

### Tables
Header 36px on the panel, muted 12px/550; rows 36px divided by line soft, tabular figures, a 3px status spine at the start of the row; hover row-hover, selected the accent wash. Links in cells look like the cell until pointed at.

### The Status Strip (signature)
Six cells on one panel split by hairlines: a 7px dot in the strong hue before a muted label, a 26px count, and a 1.5px sparkline in the same hue; the Failed cell can carry a "since" note as a small failure-tinted pill.

### Charts and the Failure Onset (signature)
Stacked throughput columns separated by 2px of the panel colour so stacks read as blocks; gridlines line soft, axis labels 10.5px. The onset of failures is a band from the first failing bin: a 7% failed wash with a 1.5px dashed failed edge and a 11.5px/600 label in the failure text colour. The brushed range is the selection tint with the ring as its edge. Swimlane bars are 18px with 4px corners in the strong status hue; the orchestrator's own time is a 4px line in ink, and in the time breakdown a mid grey, so activities are what the eye finds.

## Do's and Don'ts

### Do:
- **Do** keep one accent per theme and spend it on the primary action, checked state, focus, links and the active indicator.
- **Do** show status as a tinted pill with a dot in text, and as the strong hue on spines, bars, series and swatches.
- **Do** draw every outline at 1px, with hairline for structure, line soft for dividers and line strong for hover and emphasis.
- **Do** use 8px corners on controls and 12px on panels, fully round on pills.
- **Do** keep `--primary` identical in light and dark for each theme.
- **Do** give the lifted shadow only to popovers, menus, dialogs, toasts, the bulk bar, the peek and the sheet.
- **Do** honour `prefers-contrast: more` (stronger lines) and `prefers-reduced-motion`; keep pill text at 4.5:1 and the ring at 3:1.

### Don't:
- **Don't** let a theme's accent, highlight, selection or active indicator be read as a status: no red, orange or amber wash, tab line or row tint (which is why Ember's highlights are warm greys), and no accent on a dot, spine or bar.
- **Don't** use hard offset shadows, thick ink outlines, frosted glass, neumorphic insets or rainbow KPI tiles; those belong to the legacy families.
- **Don't** add uppercase tracked kickers or eyebrow labels above headings.
- **Don't** set prose, notes or placeholders in the mono face.
- **Don't** animate theme or mode changes, or lift buttons on hover.
