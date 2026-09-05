# DFM UI mockup — handoff notes

Clickable mockup of the Durable Functions Monitor rewrite, built on the neo-brutalist design system
(`uploads/files/dfm-design-system.md`, `dfm-rewrite-plan.md`, `dfm-migration-plan.md`). Open `DFM App.dc.html`.

## Files

| File | Svelte target | Purpose |
|---|---|---|
| `dfm-tokens.css` | `src/app.css` (import the original with Tailwind v4) | Raw variable layer of the user's `dfm-tokens.css`, verbatim, Tailwind directives stripped so a browser loads it directly |
| `dfm-ui.css` | the `@utility` layer + shadcn-svelte component styles | Plain-CSS mirror of `brutal`, `brutal-flat`, `brutal-lg`, `brutal-press`, `rule-b/t/r`, `stripes`, `display`, `condensed`, `data`, `bg-pattern` plus every DFM component class (`.btn`, `.chip`, `.st-*`, `.tbl`, `.stat-tile`, `.fchip`, `.bulk`, `.dialog`, `.peek`, `.palette`, `.node`, `.lane`, …) and the responsive rules |
| `DFM App.dc.html` | `src/App.svelte`, `lib/shell/*` | Shell: side nav, top bar (hub switcher, instance jump, badges, auto-refresh, UTC/Local, theme + mode menu, user menu), bottom tab bar, More sheet, peek panel, command palette, toast, progress bar, client routing |
| `ScreenLogin.dc.html` | `src/routes/Login.svelte` | Sign in, hub list from `task-hub-names`, connection-string fallback |
| `ScreenOverview.dc.html` | `src/routes/Overview.svelte` | Stat tiles, throughput with brush, needs attention, top orchestrators, backlog, recent activity, partial banner, empty state |
| `ScreenInstances.dc.html` | `src/routes/Instances.svelte` | Facet chips, filter rail, saved views, Table/Timeline/Histogram, multi-select + bulk action bar, batch confirm, Start new instance, Long JSON dialog |
| `ScreenInstance.dc.html` | `src/routes/Instance.svelte` | Header + actions, Summary column, Timeline (swimlane ↔ history hover link), History, Inputs (2 cards, eligibility, size meter, 3 confirms, 3 recovery dialogs, mock 200/409/413/500), Sequence, Graph, Raw, Liquid tab |
| `ScreenFailures.dc.html` | `src/routes/Failures.svelte` | Groups by orchestrator + error signature, per-row recovery actions, group bulk Rewind/Purge |
| `ScreenEntities.dc.html` | `src/routes/Entities.svelte` | Entity table with parsed state, Signal, Purge, Clean entity storage |
| `ScreenFunctions.dc.html` | `src/routes/Functions.svelte` | byName table + function graph (node click filters table), Table/Both/Graph |
| `ScreenStorage.dc.html` | `src/routes/Storage.svelte` | Task hub info, queue depths, partition owners, tables, large messages |
| `ScreenActivity.dc.html` | `src/routes/Activity.svelte` | Audit table with operation filter, empty state explaining how to enable auditing |
| `ScreenSettings.dc.html` | `src/routes/Settings.svelte` | Connection, hub administration dialogs, templates, appearance (theme/mode/density/time/thresholds), feature flags, mockup-only state toggles |

Every screen file starts with an HTML comment naming its route, Svelte component(s) and the endpoints it reads.

## Theme and mode

- `data-theme="poster|riso|memphis|blueprint|hazard"` and `.dark` on the document element, `data-density="compact|comfortable"` for the row height.
- Persisted as `dfm.theme`, `dfm.mode`, `dfm.density`, `dfm.nav` in localStorage (→ `ITypedLocalStorage` so the VS Code host persists them through `PersistState`).
- Switchers: top bar theme menu (desktop), Settings › Appearance (all sizes), command palette ("Theme: Riso", "Switch to dark mode").

## Screen → endpoints

| Screen | Endpoints |
|---|---|
| Overview | `GET /stats?from&to&bins=48`, `GET /storage`, `GET /audit`, `GET /about` |
| Instances | `GET /orchestrations?$filter&$orderby&$top&$skip`, `GET /id-suggestions`, `POST /orchestrations`, `POST /orchestrations/batch` |
| Instance | `GET orchestrations('{id}')`, `/history`, `/spans`, `/children`, `/input-events`; `POST suspend|resume|rewind|terminate|raise-event|set-custom-status|restart|purge`, `update-input-and-rewind` (Write), `replay`, `restart-in-place` (Dangerous); `GET /function-map`, `custom-tab-markup('{template}')` |
| Failures | `GET /failures?from&to`, `POST /orchestrations/batch` |
| Entities | `GET /orchestrations` (entity filter) / `GET /entities`, `POST raise-event`, `POST purge`, `POST /clean-entity-storage` |
| Functions | `GET /stats`, `GET /function-map` |
| Storage | `GET /storage` |
| Activity | `GET /audit?from&to&operation` |
| Settings | `GET /about`, `POST /purge-history`, `POST /clean-entity-storage`, `POST /delete-task-hub`, `GET /manage-connection` |
| Login | `GET ../easyauth-config`, `GET ../task-hub-names` |

## Status code → UI (Inputs tab, mocked with the "Mock outcome" select)

200 → completed toast + reload · 409 → reload inputs, destructive toast prefixed "The list was refreshed." · 413 → "Input is larger than 60 KB" · 500 → stripe-banded recovery dialog (Start new instance with this input / Raise event now / Rewind).

## Responsive rules (in `dfm-ui.css`)

- ≤ 1100 px: filter rail wraps, Overview tiles 3-up, workspace Summary becomes a tab (`.ws[data-tab="summary"]`), inputs cards stack, failures rows wrap.
- ≤ 768 px: side nav → bottom tab bar (Overview, Instances, Failures, Entities, More sheet), tables → stacked cards with the status spine as the left border (`td[data-label]` becomes the label; `.tbl-wrap.keep` opts out), bulk bar and toast sit above the bottom nav, peek panel → bottom sheet, command palette → full screen, theme/mode controls leave the top bar (Settings keeps them).

## Keyboard

`Ctrl/⌘ K` palette · `/` focus instance jump · `g o` `g i` `g f` `g e` `g s` navigate · `Esc` closes palette, peek, menus · arrows + Enter inside the palette.

## Mockup-only affordances (remove in the product)

Settings › Mockup states (partial banner, empty hub, error toast, loading bar), the Inputs tab "Mock outcome" select, Feature-flag switches driving Read only / Dangerous operations.
