---
name: dfm-design-review
description: Review a DFM Svelte screen or component against its mockup (docs/ui-plans-artifacts/Screen*.dc.html) and the neo-brutalist design system, producing a precise list of deviations with mockup line references. Use after a UI task is implemented, before ticking it, or when asked to "review the Instances screen against the mockup".
---

# DFM design review

Inputs: the task id (or screen name), the mockup file, `dfm-ui.css`, `dfm-design-system.md` §3–§8, `00-shared-contracts.md` §9–§14. Output: a numbered list of deviations, each with `where` (file:line), `expected` (mockup line or rule), `actual`, `severity` (blocker / should / nit). No prose beyond that.

## Checklist

Structure and copy
- [ ] Every element of the mockup section exists in the same order with the same class names (`ptitle`, `chips2`, `tbl-wrap`, `tfoot`, `panel-h`, …).
- [ ] Labels, placeholders, empty-state copy, dialog titles and bodies, meta lines and button labels match the mockup verbatim (sentence case, no all caps, `·` separators kept).
- [ ] Mockup-only affordances are absent (Mock outcome select, Mockup states panel, feature-flag switches as toggles).
- [ ] Data that the backend does not provide is omitted or degraded exactly as the task says, not faked.

Visual rules (design system §3–§8)
- [ ] Solid status fills with ink outline and dark text; no alpha tints, no gradients, no soft shadows (only `--shadow-brutal*`).
- [ ] One loud element per screen; tables carry the standard shadow on list screens, panels none, dialogs and peek the long shadow.
- [ ] Mono (`.mono`/`.data`/`.fine`) for ids, timestamps, durations, JSON, counters, function names; sans for everything that speaks.
- [ ] Buttons: verb + object for destructive ones; icons never alone; `danger` variant (stripe) only for Dangerous operations; disabled = 50 % opacity with a `title` reason.
- [ ] Focus ring visible on every interactive element; tab order follows the visual order.
- [ ] Status spine present on every list row (`data-st`); `data-label` on every cell for the mobile card layout.

Behaviour
- [ ] Row click opens the peek; id link opens the page; Ctrl/⌘ click opens a new tab/panel.
- [ ] Filters and tabs are in the URL; reload restores them; global time range shared across screens.
- [ ] Auto-refresh only refreshes page one; Load more appends; errors toast with Retry and stop auto-refresh.
- [ ] Read-only mode disables every write action with the reason; missing capabilities hide the item.
- [ ] JSON everywhere is pretty-printed and fully expanded; cell previews are single-line and open the viewer.
- [ ] Escape closes the innermost layer; menus close on outside click and return focus.

Theme and responsive
- [ ] Switching all five themes and both modes shows no un-tokenised colour (grep the diff for `#` colours and `rgba(`).
- [ ] At 1100 px the rail wraps and Summary becomes a tab; at 768 px bottom nav, stacked cards, peek as a bottom sheet.

Tests
- [ ] The task's named test exists and asserts the behaviour above, not just rendering.

## How to run the review

1. Read the task and the mockup lines it cites; open the implementation files.
2. Run the app against the seeded hub (`dfm-e2e-harness`) and look at the screen in Poster light, Blueprint dark, and at 1024 px and 390 px. Take screenshots with Playwright when in doubt (`npx playwright test tests/e2e/themes.spec.ts` once E12-S3-T3 exists, or an ad-hoc script).
3. Fill the deviation list. A missing or wrong copy string is a `should`; a missing element, wrong data source, fake data, or a broken rule from the design system's "never/always" list is a `blocker`.
