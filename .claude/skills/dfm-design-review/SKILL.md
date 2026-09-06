---
name: dfm-design-review
description: Review a DFM Svelte screen or component against its mockup (docs/ui-plans-artifacts/Screen*.dc.html) and the neo-brutalist design system, producing a precise list of deviations with mockup line references. Use after a UI task is implemented, before ticking it, or when asked to "review the Instances screen against the mockup".
---

# DFM design review

Inputs: the task id (or screen name), the mockup file, `dfm-ui.css`, `dfm-design-system.md` §3–§8, `00-shared-contracts.md` §9–§14 and §16 (which of the design system's rules hold in every theme family and which only in the papers). Output: a numbered list of deviations, each with `where` (file:line), `expected` (mockup line or rule), `actual`, `severity` (blocker / should / nit). No prose beyond that.

## Checklist

Structure and copy
- [ ] Every element of the mockup section exists in the same order with the same class names (`ptitle`, `chips2`, `tbl-wrap`, `tfoot`, `panel-h`, …).
- [ ] Labels, placeholders, empty-state copy, dialog titles and bodies, meta lines and button labels match the mockup verbatim (sentence case, no all caps, `·` separators kept).
- [ ] Mockup-only affordances are absent (Mock outcome select, Mockup states panel, feature-flag switches as toggles).
- [ ] Data that the backend does not provide is omitted or degraded exactly as the task says, not faked.

Visual rules, universal (design system §3–§8 as contracts §16 splits them; every theme family)
- [ ] Solid status fills with dark text that keep their hue; the status spine on every list row is the one loud thing in a table.
- [ ] One loud element per screen; colour is a vocabulary (eight statuses, two kinds, seven node kinds, five series), never decoration.
- [ ] Mono (`.mono`/`.data`/`.fine`) for ids, timestamps, durations, JSON, counters, function names; sans for everything that speaks.
- [ ] Buttons: verb + object for destructive ones; icons never alone; `danger` variant (stripe) only for Dangerous operations; disabled = 50 % opacity with a `title` reason.
- [ ] Focus ring visible on every interactive element, as a colour and never as the line; tab order follows the visual order.
- [ ] Status spine present on every list row (`data-st`); `data-label` on every cell for the mobile card layout.
- [ ] Small marks (ticks, knobs, carets, sort triangles, arrowheads, the "now" line, hatches) are drawn in `--glyph`; outlines in `--ink`.
- [ ] Motion only in answer to an action; `prefers-reduced-motion` removes it.

Visual rules, brutalist (when the theme's family is `brutal`, which every paper is)
- [ ] Ink outline on every control and container; no alpha tints, no gradients, no blur, no soft shadows (only `--shadow-brutal*`).
- [ ] Tables carry the standard shadow on list screens, panels none, dialogs and peek the long shadow.
- [ ] Behind the page only the theme's own paper pattern (halftone, dots, grid) or nothing.

Family look (when the theme's family is not `brutal`; the look is specified in E14 and E15)
- [ ] Glass: one `backdrop-filter` per surface class (`.snav`, `.topbar`, `.panel`, `.card`, `.tbl-wrap`, `.pop`, `.dialog`, `.peek`, `.palette`…), never on rows, chips or buttons; the backdrop blobs only on the page (`body::before`); a strong `--glyph` over a soft `--ink`; `prefers-reduced-transparency` makes the surfaces opaque.
- [ ] Neu: one material for page, card and input; elevation from the light/shade shadow pair; inputs, pressed buttons, pressed segments and the selected tab inset (`--shadow-inset`); panels raised; no visible line, and `prefers-contrast: more` gives every surface an edge.

Behaviour
- [ ] Row click opens the peek; id link opens the page; Ctrl/⌘ click opens a new tab/panel.
- [ ] Filters and tabs are in the URL; reload restores them; global time range shared across screens.
- [ ] Auto-refresh only refreshes page one; Load more appends; errors toast with Retry and stop auto-refresh.
- [ ] Read-only mode disables every write action with the reason; missing capabilities hide the item.
- [ ] JSON everywhere is pretty-printed and fully expanded; cell previews are single-line and open the viewer.
- [ ] Escape closes the innermost layer; menus close on outside click and return focus.

Theme and responsive
- [ ] Switching every theme in `THEMES` and both modes shows no un-tokenised colour (grep the diff for `#` colours and `rgba(`).
- [ ] At 1100 px the rail wraps and Summary becomes a tab; at 768 px bottom nav, stacked cards, peek as a bottom sheet.

Tests
- [ ] The task's named test exists and asserts the behaviour above, not just rendering.

## How to run the review

1. Read the task and the mockup lines it cites; open the implementation files.
2. Run the app against the seeded hub (`dfm-e2e-harness`) and look at the screen in Poster light, Blueprint dark, and at 1024 px and 390 px - and, when the task is an E14/E15 one, in the family's own theme in both modes. Take screenshots with Playwright when in doubt (`npx playwright test tests/e2e/themes.spec.ts` shoots every theme and mode; `npm run preview:styles` shoots the design-system preview page with the family sheets).
3. Fill the deviation list. A missing or wrong copy string is a `should`; a missing element, wrong data source, fake data, or a broken rule from the design system's "never/always" list is a `blocker`.
