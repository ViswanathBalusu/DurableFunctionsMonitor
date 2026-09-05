# E1 · Design system and shared components

Goal: every visual primitive the screens use, rendered with the mockup stylesheet so screens are assembled, not styled. After E1 a screen task never writes CSS for a button, chip, table, dialog, popover, tab, form control, JSON view or chart frame.

Prerequisites: E0. Read contracts §9, §10, §11, §12, §14, and `dfm-design-system.md` §3–§8.

Rules for every component in this epic:
- Use the class names from `dfm-ui.css` (contracts §12). Do not restate their CSS. App-specific additions go to `src/styles/dfm-ext.css`, never to `dfm-ui.css`.
- Props are typed; `class` passthrough via `class?: string`; rest props spread onto the root element.
- Sentence case labels; no all-caps; icons always beside a text label on buttons.
- Every interactive component is keyboard reachable and shows the `:focus-visible` ring (comes from the stylesheet; do not suppress).
- A component test with `@testing-library/svelte` per component (render + the one interaction it owns).

### E1-S1 Stylesheets and primitives from shadcn-svelte

#### E1-S1-T1 Port dfm-ui.css verbatim
Files: `src/styles/dfm-ui.css`, `src/styles/dfm-ext.css`, `src/app.css`, `tests/unit/styles-verbatim.test.ts`
Depends: E0-S1-T3
Do:
1. Copy `docs/ui-plans-artifacts/dfm-ui.css` to `src/styles/dfm-ui.css` unchanged.
2. `src/app.css` imports in this order: `dfm-tokens.css` (which imports Tailwind), `dfm-ui.css`, `dfm-ext.css`. Later files win the cascade over Tailwind preflight for the same specificity, which is intended (`button { border: 0; background: none }` etc. in `dfm-ui.css` L18).
3. `dfm-ext.css` starts with a comment: "Additions the mockup stylesheet lacks. Keep small. Never override a dfm-ui.css rule here; change the component markup instead."
4. Add the `svelte-jsoneditor` and `@xyflow/svelte` base stylesheets: `@import 'svelte-jsoneditor/themes/jse-theme-default.css'` is not needed (the component injects its own); `@import '@xyflow/svelte/dist/style.css'` before `dfm-ui.css` so the `.svelte-flow` bridge in the tokens file and `dfm-ext.css` override it.
Accept:
- [ ] `styles-verbatim.test.ts` asserts `src/styles/dfm-ui.css` equals the artifact byte for byte (same for the tokens file, reuse E0's test).
- [ ] `npm run build` still passes the verify script (CSS is still one file).
Test: the verbatim test.

#### E1-S1-T2 Add and restyle shadcn-svelte primitives
Files: `src/lib/components/ui/{dialog,alert-dialog,dropdown-menu,popover,select,command,checkbox,switch,tabs,tooltip,sheet,table}/*`, `src/lib/components/ui/README.md`
Depends: E1-S1-T1
Do:
1. `npx shadcn-svelte@1.6.1 add dialog alert-dialog dropdown-menu popover select command checkbox switch tabs tooltip sheet table` (accept overwrite of nothing).
2. Restyle each generated file by replacing its Tailwind class strings with the DFM classes: dialog overlay → `overlay`, dialog content → `dialog` (body slot gets `body`, footer `foot`); dropdown-menu/popover content → `pop` (+ `right` when `align="end"`), items → `mi`, separator → `sep`, destructive item → `mi destructive`; select trigger → `input` inside a `sel` wrapper, select content → `pop`, item → `mi`; command → `palette` structure (`plist`, `grp`, `prow`, `sel` for the active row, `kbd`), command input → the bare `<input>` of the palette; checkbox → `box` (`on` when checked) inside a `check` label; switch → `switch` (`on`); tabs list → `tabs`, trigger → `tab` (selected state through `aria-selected`, already used by the CSS); tooltip content → `pop` with 12 px `meta` text; sheet content (side right) → `peek`, (side bottom) → `sheet`; table parts → `tbl-wrap`/`tbl` structure (headers get `th`, the spine cell is a plain `td.spine`).
3. Remove `tailwind-variants`/`cn` class merging where the DFM class is fixed; keep `cn` for passthrough only.
4. Write `ui/README.md`: which primitive maps to which DFM class, and that these files are the only place bits-ui is imported directly.
Accept:
- [ ] A Storybook-like page is not required; instead `tests/unit/ui-primitives.test.ts` renders each primitive open and asserts the DFM class is on the expected element (`.dialog`, `.pop`, `.mi`, `.box.on`, `.switch.on`, `.tab[aria-selected="true"]`, `.peek`).
- [ ] No generated file still contains `rounded-`, `shadow-`, `bg-white`, `ring-` utility classes (grep).
Test: as above.

### E1-S2 Buttons, chips, badges

#### E1-S2-T1 Button and LinkButton
Files: `src/lib/components/Button.svelte`, `src/lib/components/LinkButton.svelte`, tests
Depends: E1-S1-T1
Do:
1. `Button`: props `variant: 'default'|'primary'|'secondary'|'destructive'|'danger'|'ghost'` (default `'default'`), `size: 'md'|'sm'`, `flat?: boolean`, `disabled`, `title`, `type`, `href?` (renders `<a>` with the same classes), `onclick`; children snippet; optional `icon` snippet rendered before the label at 16 px. Classes: `btn` + variant + `sm` + `flat`. `danger` is the stripe-topped destructive used for Dangerous operations (dfm-ui.css L93–L94).
2. `LinkButton`: `<button class="link">` (or `<a class="link">` with `href`), prop `mono` adds the `mono` class, `muted` adds `muted`. Stops propagation of click when `stopPropagation` prop is set (row links inside clickable rows).
Accept:
- [ ] Disabled button has `disabled` attribute and no hover transform (CSS handles it).
- [ ] `href` renders an anchor with `role="button"` omitted (a real link).
Test: render each variant, assert classes; click handler called once.

#### E1-S2-T2 Chip, StatusChip, DangerBadge, Tag, MiniCounter, Segmented
Files: `src/lib/components/{Chip,StatusChip,DangerBadge,Tag,MiniCounter,Segmented}.svelte`, `src/lib/format/status.ts`, tests
Depends: E1-S1-T1
Do:
1. `status.ts`: `statusClass(status)` → `st-*` per contracts §11 (`ContinuedAsNew` → `st-continued`); `spineAttr(status)` → the `data-st` value; `kindClass(entityType)`.
2. `Chip`: props `size: 'md'|'sm'`, `class`, children; `StatusChip`: prop `status`, `size`, renders the status text (`ContinuedAsNew` shown as is). Entities: `Chip` with `kind-entity` and text `entity` (Instances L86, Entities L44).
3. `DangerBadge`: `dbadge` (+ `sm`), default text "Dangerous operations on", `title` attribute "/about lists DurableFunctionsMonitor.DangerousOperations" (App L69).
4. `Tag`: `tag` button, used for the history "input" tag (Instance L109).
5. `MiniCounter`: `mini` + status class, number child (Functions L57).
6. `Segmented`: `seg` (+ `sm`), props `options: { value, label }[]`, `value` (bindable), `ariaLabel`; buttons with `aria-pressed`.
Accept:
- [ ] `StatusChip status="ContinuedAsNew"` has class `st-continued`.
- [ ] Segmented emits `change` and updates `aria-pressed` on click and with arrow keys.
Test: as above.

### E1-S3 Form controls

#### E1-S3-T1 TextInput, Field, Select
Files: `src/lib/components/{TextInput,Field,Select}.svelte`, tests
Depends: E1-S1-T2
Do:
1. `TextInput`: `<input class="input">`, props `value` (bindable), `mono` (adds `mono`), `placeholder`, `ariaLabel`, `readonly`, `onEnter` callback, `class`, `style`.
2. `Field`: `<div class="field"><label>{label}</label>{children}</div>` with `for` wiring through a generated id.
3. `Select`: bits-ui Select restyled (E1-S1-T2) presented as `<div class="sel"><button class="input">…</button></div>` so the mockup's native-select look is kept (dfm-ui.css L120–L122); props `options: { value, label }[]`, `value` (bindable), `ariaLabel`, `width`, `size: 'md'|'sm'` (`sm` sets `height: 30px` like the mockup's inline style on range selects), `chip?: boolean` (renders as `select.fchip` for filter chips, Instances L48).
Accept:
- [ ] `Select` opens with Enter/Space/ArrowDown, moves with arrows, closes on Escape, and emits the chosen value.
Test: as above.

#### E1-S3-T2 Checkbox, Switch, CheckRow
Files: `src/lib/components/{Checkbox,Switch,CheckRow}.svelte`, tests
Depends: E1-S1-T2
Do:
1. `Checkbox`: `<button class="check" role="checkbox" aria-checked><span class="box on?"></span>{label}</button>` over bits-ui Checkbox (Entities L69).
2. `Switch`: `<button class="check" role="switch" aria-checked style="justify-content:space-between;width:100%;min-height:36px"><span>{label}<span class="meta">{hint}</span></span><span class="switch on?"></span></button>` (Settings L50–L51).
3. `CheckRow`: the popover variant with a chip inside (Instances L34): `box` + `StatusChip`.
Accept:
- [ ] Space toggles; `aria-checked` reflects state; `onchange` receives the boolean.
Test: as above.

#### E1-S3-T3 DateTimeField
Files: `src/lib/components/DateTimeField.svelte`, tests
Depends: E1-S3-T1
Do:
1. bits-ui `DateField` with `granularity="minute"` (or `"second"` via prop), values as `@internationalized/date` `ZonedDateTime` in UTC or local per `prefs.showTimeAs`; presented inside `.input.mono` styling with width 190 px (Instance L122–L123, Settings L101).
2. Props: `value: string | null` (ISO, bindable), `placeholder` ("now"), `enabled` (renders an inline checkbox that enables the field, port of React's "till" checkbox), `ariaLabel`.
3. Emits `change` with an ISO UTC string. Invalid input reverts to the last valid value on blur (React behaviour).
Accept:
- [ ] Typing a date in local mode with UTC offset +2 emits the correct UTC ISO string.
- [ ] `enabled=false` renders the checkbox unchecked and the field disabled.
Test: as above with a fixed timezone (`process.env.TZ` in the vitest config: use `Etc/GMT-2`).

#### E1-S3-T4 Combobox
Files: `src/lib/components/Combobox.svelte`, tests
Depends: E1-S1-T2
Do:
1. bits-ui Combobox: input with class `input mono`, listbox rendered as `.pop` with `.mi.mono` options (App L57–L67). Props: `value` (bindable), `items: string[]` (already filtered by the owner), `placeholder`, `ariaLabel`, `emptyText` ("No instance id starts with that."), `onSelect(item)`, `onEnter(typed)`, `minChars` (default 2), `ref` for focusing.
2. Enter with no highlighted option calls `onEnter(value)`; Escape blurs.
Accept:
- [ ] Arrow keys move the highlight; Enter selects; Escape closes and blurs.
Test: as above.

### E1-S4 Surfaces and dialogs

#### E1-S4-T1 Page, PageTitle, Panel, Card, Kv, Banner, EmptyState, Tabs
Files: `src/lib/components/{Page,PageTitle,Panel,Card,Kv,Banner,EmptyState,Tabs}.svelte`, tests
Depends: E1-S1-T2
Do:
1. `Page`: `<section class="page">`; `PageTitle`: `<div class="ptitle"><h1 class="display">{title}</h1>{children}</div>` (children are the controls after the title; Overview L17–L22).
2. `Panel`: `<div class="panel"><div class="panel-h"><h2>{title}</h2>{meta snippet, right aligned}</div>{children}</div>`; `Card`: `<div class="card">`.
3. `Kv`: `<dl class="kv">` with a `rows: { k, v (snippet or string), mono?, extra? }[]` prop and a `columns` prop for the three-column variant (`grid-template-columns:auto 1fr auto`, Overview L92).
4. `Banner`: `<div class="banner" role="status">` with a leading chip slot, text, and a trailing action slot (Overview L24).
5. `EmptyState`: `<div class="empty"><h2 class="display">{title}</h2><p>{text}</p><div class="row">{actions}</div></div>` (Overview L27).
6. `Tabs`: bits-ui Tabs restyled: `tabs` list, `tab` triggers with `aria-selected`, optional `summary-tab` class on the first trigger, a trailing `grow` spacer and a `controls` snippet (auto-refresh select + Refresh, Instance L51–L53). Props `tabs: { id, label, summaryTab? }[]`, `value` (bindable).
Accept:
- [ ] `Tabs` moves with arrow keys and exposes `role="tablist"`.
- [ ] `Kv` renders `dt`/`dd` pairs with `mono` on values when asked.
Test: as above.

#### E1-S4-T2 Dialog and ConfirmDialog
Files: `src/lib/components/{Dialog,ConfirmDialog}.svelte`, tests
Depends: E1-S1-T2
Do:
1. `Dialog`: shadcn dialog restyled; props `open` (bindable), `title` (rendered `<h3 class="display">`), `band?: boolean` (renders `<div class="warn"></div>` at the top), `ariaLabel`, `width` (default 560), children (body, inside `.body`), `footer` snippet (inside `.foot`). Escape and overlay click close; focus is trapped; returns focus on close.
2. `ConfirmDialog`: props `open`, `title`, `body` (string; `<p>` under 70ch), `band`, `confirmLabel`, `confirmVariant: 'primary'|'destructive'|'danger'`, `cancelLabel` (default "Cancel"), `secondaryLabel?` + `onSecondary`, `confirmDisabled`, `busy` (shows the `.progress` bar above the footer and disables buttons), `onConfirm`, children for extra controls (reason field, ids preview, checkboxes), `hint?` (rendered `<p class="meta">`). Footer order: Cancel, secondary, confirm (Instance L271).
3. Helper snippet components used by many confirms: `IdsPreview.svelte` (`<div class="ed ro"><pre>` with the first ten ids and "… and n more", Instances L148, L251), `ReasonField.svelte` (`Field` "Reason (optional)" + `TextInput` placeholder "Written to the audit log", Instance L265).
Accept:
- [ ] `band` renders the stripe; Escape closes; the confirm button is disabled while `busy`.
- [ ] `IdsPreview` shows 10 ids and the "… and 3 more" line for 13 ids.
Test: as above.

#### E1-S4-T3 Pop (menu/popover surfaces) and MenuItem
Files: `src/lib/components/{Pop,MenuItem}.svelte`, tests
Depends: E1-S1-T2
Do:
1. `Pop`: wraps the restyled dropdown-menu or popover (prop `kind: 'menu'|'popover'`) with an `anchor` snippet (the trigger, wrapped in `<div class="anchor">`) and content children rendered in `.pop` (`right` when `align="end"`, `minWidth`, `padding`).
2. `MenuItem`: `.mi` with `active`/`destructive` classes, `role` `menuitem`/`menuitemradio`/`menuitemcheckbox`, `checked`, leading snippet, trailing `meta` snippet (App L50).
3. Outside click and Escape close; focus returns to the trigger.
Accept:
- [ ] Menu opens on click and on ArrowDown from the trigger; items are reachable with arrows; Enter activates.
Test: as above.

#### E1-S4-T4 ProgressBar and Toast primitives
Files: `src/lib/components/{ProgressBar,Toast}.svelte`, tests
Depends: E1-S1-T1
Do:
1. `ProgressBar`: `<div class="progress" role="progressbar" aria-label="Loading">`, prop `inline` adds the border-width style used under the top bar (App L96).
2. `Toast`: `<div class="toast ok?" role="status"><span class="grow">{message}</span>{retry button}<button class="btn ghost" aria-label="Dismiss">×</button></div>` (App L216); props `kind: 'ok'|'error'`, `message`, `onRetry?`, `onClose`. The host that mounts it is E2-S6-T1.
Accept:
- [ ] Retry button appears only when `onRetry` is given.
Test: as above.

### E1-S5 Data table

#### E1-S5-T1 DataTable
Files: `src/lib/components/table/DataTable.svelte`, `src/lib/components/table/columns.ts`, `src/lib/components/table/cells/{SpineCell,SelectCell,JsonCell,MonoCell,LinkCell,StatusCell}.svelte`, tests
Depends: E1-S2-T2, E1-S6-T3
Do:
1. Built on `@tanstack/table-core` through the shadcn `createSvelteTable` helper (added in E1-S1-T2 under `ui/data-table`), with row virtualisation from `@tanstack/svelte-virtual` when `rows.length > 200` (fixed row height `var(--row-h)`; read it from `getComputedStyle` at mount and on density change).
2. Markup exactly as Instances L77–L97: `<div class="tbl-wrap"><table class="tbl"><thead><tr>…` with an optional first `th.sel-cell` (select-all `box`), then `th.spine`, then columns. Header cells get class `sort asc|desc` when sorted; clicking a sortable header calls `onSort(columnId)` (three-state: asc → desc → none, React parity).
3. Body rows: `<tr data-st={spineAttr(status)} data-clickable aria-selected>`; `td.sel-cell.nolabel` with the row `box`; `td.spine`; every data cell carries `data-label={column header}` (mobile card layout, contracts §14) and `class="mono"` for mono columns, `trunc` for truncating columns.
4. Props: `columns: ColumnDef[]` (id, header, accessor, mono, sortable, hidden, width, cell snippet), `rows`, `rowKey`, `selectable`, `selected: Set<string>` (bindable), `onRowClick`, `onSort`, `sort: { id, dir } | null`, `keep` (adds `keep`), `flat` (adds `flat`), `highlightKey` (adds class `hl` to the matching row), `onRowEnter`/`onRowLeave` (hover linkage for the Timeline tab), `footer` snippet rendered in `.tfoot`.
5. Column chooser: `hiddenColumns: string[]` (bindable) and a header context menu ("Hide column", "Show all columns") through `Pop`; the footer shows "n columns hidden · show all" through the owner (the table exposes `hiddenCount`).
6. Cells: `SpineCell` (none; the spine is a plain td), `SelectCell`, `JsonCell` (preview + opens `JsonDialog` via `onOpenJson(value, title)`), `MonoCell`, `LinkCell` (`LinkButton mono` with `stopPropagation`), `StatusCell` (`StatusChip`).
Accept:
- [ ] Row click calls `onRowClick(row)`; clicking the id link does not (stopPropagation).
- [ ] Select-all toggles every visible row; the header box shows `on` only when all are selected.
- [ ] With 1,000 rows only the visible rows plus overscan are in the DOM.
- [ ] Every `td` except `.spine` and `.sel-cell` has `data-label`.
Test: as above.

**Deviations, E1-S5-T1 (2026-09-05).** Two things in this task could not be done as written.
`@tanstack/table-core` 9.2.4 is the v9 line: `constructTable`/`coreFeatures`/`createCoreRowModel`,
with no Svelte adapter in the pinned set, and shadcn-svelte 1.6.1 has no `data-table` component to
add - it is a documentation recipe, so E1-S1-T2 could not add `ui/data-table` either. The table this
app needs is sorted and paged by the backend and renders its own cells, so table-core would have
contributed a row model and nothing else; `DataTable` builds that model directly and keeps
`columns.ts` (sort cycle, sort class, visible columns) as the pure part that is unit tested.
Virtualisation is real, through the pinned `@tanstack/svelte-virtual`: above 200 rows only a window
plus overscan is in the DOM, with spacer rows keeping the scrollbar honest. jsdom reports a
zero-height viewport, so the virtualiser has no range to offer there; the component renders a first
screenful in that case, which is also what a real browser gets before its first measurement.

### E1-S6 JSON

#### E1-S6-T1 json.ts helpers
Files: `src/lib/format/json.ts`, `src/lib/format/json.test.ts`
Depends: E0-S1-T1
Do:
1. `parseMaybeJson(value)`: strings that parse as JSON are parsed (recursively once; the backend returns JSON inside strings for inputs and results); everything else returned as is.
2. `formatJson(value)`: contracts §9. `previewJson(value, max = 120)`: single line (`JSON.stringify` without indentation), whitespace collapsed, truncated with `…`.
3. `tokenizeJson(text)`: returns `{ cls: 'jk'|'js'|'jn'|'jb'|'jz'|'jp'|'', text }[]` for the pretty-printed text (keys, strings, numbers, booleans, null, punctuation), used by `JsonPre`.
4. `isBlobUrl(value)`: string starting with `https://` or `http://` and ending with a blob path (React: any absolute URL).
Accept:
- [ ] `formatJson('{"a":1}')` → `"{\n  \"a\": 1\n}"`; `formatJson({a:[1,{b:null}]})` is fully expanded (no `[...]`).
- [ ] `previewJson({ step: 'ChargePayment', attempt: 2 })` → `{"step":"ChargePayment","attempt":2}`.
- [ ] `tokenizeJson` classifies every token of a sample with nested arrays and escaped quotes.
Test: `json.test.ts`.

#### E1-S6-T2 JsonPre
Files: `src/lib/components/json/JsonPre.svelte`, tests
Depends: E1-S6-T1
Do:
1. `<pre class="json">` with tokenized spans (Instance L69, L230–L244). Props `value`, `maxHeight?` (clips with `overflow:hidden`), `transparent?` (removes background and padding for the Summary panel look), `wrap?` (`white-space: pre-wrap; overflow-wrap: anywhere`).
2. Always shows `formatJson(value)`; never a collapsed form (contracts §9).
Accept:
- [ ] Renders keys with class `jk`, strings `js`, numbers `jn`, `null` as `jz`.
Test: as above.

#### E1-S6-T3 JsonViewer, JsonEditor, SizeMeter, JsonDialog, BlobLink
Files: `src/lib/components/json/{JsonViewer,JsonEditor,SizeMeter,JsonDialog,BlobLink}.svelte`, tests
Depends: E1-S6-T1, E1-S4-T2
Do:
1. `JsonViewer`: `svelte-jsoneditor` `JSONEditor` with `mode="tree"`, `readOnly`, `mainMenuBar` (prop, default true), `navigationBar` (auto: true when the document has more than 200 nodes), `statusBar={false}`, `indentation={2}`, host element `class="jse-theme-dfm"`. On mount and whenever `value` changes: `set({ json })` then `expand([], () => true)` (expand all, contracts §9). Prop `height` (default `min(60vh, 520px)`).
2. `JsonEditor`: `mode="text"`, `indentation={2}`, `statusBar` on, `mainMenuBar` off, `readOnly` prop (adds `ro` to the `.ed` wrapper), bindable `text` (string), `onChange(text, isValid)`, `ariaLabel`, `rows` (min height). Wrapped as `<div class="ed"><JSONEditor…/><div class="foot">{footer snippet}</div></div>` so the footer can hold the chips and the meter (Instance L176–L181).
3. `SizeMeter`: `<span class="meter over?"><i style="--pct:{pct}%"></i>{fmtBytes(bytes)} of 60 KB</span>`; props `bytes`, `limit` (61440).
4. `JsonDialog`: `Dialog` with title, `subtitle` (`<p class="meta">` or `mono muted`), body `JsonViewer` (menu bar on), footer "Copy to clipboard" (default button) + "Close" (primary) (Instances L173–L184). Props `open`, `title`, `subtitle`, `value`, `downloadField?: { instanceId, field }` which adds a "Download" button calling `endpoints.downloadField`. When `isBlobUrl(value)`, render `BlobLink` instead of the viewer.
5. `BlobLink`: mono link showing the URL and a "Download" button (contracts §9).
6. Copy uses `navigator.clipboard.writeText(formatJson(value))` and toasts "Copied to the clipboard" through a `onCopied` callback (the toast host is E2).
Accept:
- [ ] Viewer test: after `set`, every nested node is expanded (query the rendered DOM for collapsed markers: none present).
- [ ] Editor test: typing invalid JSON reports `isValid=false`; `readOnly` adds `ro`.
- [ ] SizeMeter shows `over` above 61,440 bytes.
Test: as above (svelte-jsoneditor renders in jsdom; if a test needs layout, mock `ResizeObserver` in `tests/unit/setup.ts`).

### E1-S7 Icons

#### E1-S7-T1 NavIcon and Icon
Files: `src/lib/components/icons/NavIcon.svelte`, `src/lib/components/icons/Icon.svelte`
Depends: E0-S1-T1
Do:
1. `NavIcon name="overview|instances|failures|entities|functions|storage|activity|settings|collapse|expand"` renders the exact inline SVG paths from `DFM App.dc.html` L28–L37 (viewBox 24, class `ico`; `collapse`/`expand` are the two polylines at L37 and L373).
2. `Icon`: thin wrapper around `@lucide/svelte` icons with `size` 20 (16 inside buttons), `strokeWidth={2.5}`, `absoluteStrokeWidth`, `aria-hidden`.
Accept:
- [ ] Snapshot test of `NavIcon` markup for each name.
Test: as above.

### E1-S8 Chart frames (D3)

#### E1-S8-T1 chart-tokens.ts and svg-export.ts
Files: `src/lib/charts/chart-tokens.ts`, `src/lib/charts/svg-export.ts`, tests
Depends: E0-S1-T3
Do:
1. `tokenColor(name)`: `getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim()`; `statusColor(status)`, `chartSeriesColor(i)` (`--chart-1..5`, cycling), `inkColor()`, `mutedColor()`. Components use `style="fill: var(--x)"` for live theming and call these only for export.
2. `svg-export.ts`: `serializeSvg(svgEl)`: clones the SVG, inlines computed `fill`, `stroke`, `stroke-width`, `font-family`, `font-size`, `font-weight` on every element, sets `xmlns`, returns the string; `saveSvg(client, svgEl, fileName)`: `client.host.saveAs(serializeSvg(svgEl), fileName)` in VS Code, `<a download>` in the browser. Export must not contain `<script>` (VS Code refuses SVGs with scripts, `MonitorView.looksLikeSvg`).
Accept:
- [ ] `serializeSvg` output starts with `<svg` and ends with `</svg>` and has no `var(` left.
Test: as above.

#### E1-S8-T2 Sparkline
Files: `src/lib/charts/Sparkline.svelte`, tests
Depends: E1-S8-T1
Do:
1. `<svg viewBox="0 0 100 26" preserveAspectRatio="none">` with one `<polyline>` (Overview L31) built with `d3-scale` from `values: number[]` (y range inverted, padding 4). Stroke inherits `currentColor` via the stat-tile CSS.
Accept:
- [ ] 9 values produce a polyline with 9 points; all zeros produce a flat line at the bottom.
Test: as above.

#### E1-S8-T3 StackedColumns with brush and legend
Files: `src/lib/charts/StackedColumns.svelte`, `src/lib/charts/stacked-columns.ts`, tests
Depends: E1-S8-T1
Do:
1. Data: `bins: { start: Date; end: Date; values: Record<string, number> }[]`, `series: { key, label, color }[]` (color is a CSS var name), `brush: { from: Date; to: Date } | null` (bindable), `onBrush(range | null)`, `xTicks` (formatter and count), `height` (160), `ariaLabel`.
2. Render with D3 scales into Svelte-controlled SVG: columns per bin with segments stacked bottom-up in series order, each segment `stroke: var(--ink)` 2 px, no gaps (`.hist`, `.col`, `.seg-b` look of Overview L41–L55 reproduced in SVG), a 1 px muted baseline, x ticks in mono 11 (`.axis` row under the chart, Overview L57), legend below with 14 px ink-outlined squares (`.legend`, Overview L60).
3. Brush: `d3-brush` brushX; the selection rectangle is drawn as an ink-outlined rect filled with a diagonal hatch `<pattern>` (never translucent, design system §8). Release calls `onBrush({ from, to })` snapped to bin edges; a `clear` link resets. Keyboard: Escape clears.
4. Hover tooltip: ink-outlined card with bin time range and per-series counts in mono.
Accept:
- [ ] 12 bins × 3 series render 36 rect segments whose heights sum per bin to the column height.
- [ ] Brushing from bin 7 to bin 10 calls `onBrush` with those bins' start/end.
Test: as above (jsdom: assert DOM structure; brush via dispatching pointer events on the overlay or by calling the exported `applyBrush` helper).

#### E1-S8-T4 Swimlane
Files: `src/lib/charts/Swimlane.svelte`, `src/lib/charts/swimlane.ts`, tests
Depends: E1-S8-T1
Do:
1. Markup follows Instance L89–L98 and dfm-ui.css L290–L304 (HTML lanes, not SVG, so the CSS applies): `.swim > .swim-in > .axis (label + ticks) + .lane* (.lbl + .track > .bar* + .blbl? + .now?)`.
2. Props: `lanes: { key, label, bars: { key, cls, left, width, text?, title?, sequenceNumbers? }[], lbl?, lblLeft?, now? }[]` where `left`/`width` are percentages computed by `swimlane.ts` `layout(spansOrRows, domain)` from ISO times; `domain: { from, to }`; `ticks: number` (6); `highlightKey` (adds `hl` to the lane and `bar.hl` to bars whose key matches); `onLaneEnter(key)`, `onLaneLeave()`; `minWidth` (720).
3. Bars narrower than 6 % render their text as a `.blbl` after the bar instead of inside (Instances L264).
4. Export: the component exposes `toSvg()` producing an SVG equivalent (rects + text) for "Save as SVG".
Accept:
- [ ] A bar from 25 % to 89 % of the domain gets `left:25%;width:64%`.
- [ ] Hovering a lane calls `onLaneEnter(key)`; `highlightKey` adds `hl`.
Test: as above.
