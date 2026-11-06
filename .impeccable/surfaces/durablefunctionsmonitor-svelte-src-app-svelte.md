---
version: 1
slug: "durablefunctionsmonitor-svelte-src-app-svelte"
primary_target: "durablefunctionsmonitor.svelte/src/App.svelte"
related_targets: ["durablefunctionsmonitor.svelte/src/styles/families/studio.css"]
---

Scope: the whole DfMon app shell and every screen (Operate mode). Audience and job: an operator on a bad day, and developers in the VS Code webview; know, find, fix. Constraints: capability-driven screens, the JSON rule, WCAG 2.1 AA, one JS and one CSS bundle under a strict CSP (fonts bundled from npm), the frozen design-system stylesheets stay verbatim, so the new look is a theme family sheet (`src/styles/families/studio.css`). The seven older themes stay selectable. Benchmarks the user accepted after asking for online research: Linear, Vercel, Trigger.dev and Inngest; their craft level is the bar.

## Direction contract

THESIS: DfMon reads as a contemporary developer console at the craft level of Linear, Vercel and Trigger.dev: calm neutral surfaces, hairline structure and one confident accent, so status colour and the failure onset are the loudest things on any screen. It refuses the dated looks it replaces: hard-shadow brutalism, frosted glass, neumorphism and rainbow KPI tiles.

OWN-WORLD: One system, four themes: Iris (indigo, default), Jade (teal), Ember (warm grey; its ember only on filled buttons, checked boxes, the logo, focus and links, its highlights warm greys, because every warm hue is already a status), Mono (black and white, inverse buttons). Near-black or near-white grounds, panels one step off the ground, 1px low-contrast lines, 12px panel radius and 8px controls, soft shadow only on what floats. Status is a tinted pill with a solid dot, the spine and chart series keep the strong hue. Mona Sans with tight-tracked headings; JetBrains Mono only for ids, times, payloads and the figures of tables and chart axes, where digits have to line up.

STORY: The operator reads the hub's health in one status strip, sees when failures began in the shaded onset band of the throughput chart, and reaches the failing group or instance in one click; payloads and history read whole on the same calm surfaces; destructive writes stand apart from ordinary ones.

FIRST VIEWPORT: A left rail with the mark and the nav (the active item tinted with the accent, the failure count as a red pill); a one-row top bar (hub picker, find field with its key hint, the dangerous-operations pill, auto-refresh, UTC or Local, theme, command palette, account); the Overview title with range and refresh; one status strip of counts with sparklines; throughput columns with the failure onset band beside Needs attention; the orchestrators table below.

FORM: The contemporary developer-console canon, taken as the standing exit after the user rejected the dealt hand as dated (safer register), position: canon. seed:2a38e08c267eec1d

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
