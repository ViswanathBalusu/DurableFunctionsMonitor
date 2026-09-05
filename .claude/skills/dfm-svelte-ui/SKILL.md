---
name: dfm-svelte-ui
description: Conventions, templates and pitfalls for building the Durable Functions Monitor Svelte 5 UI (durablefunctionsmonitor.svelte) so screens match the neo-brutalist mockups exactly - component skeletons, rune state modules, app context, backend endpoints, router links, JSON display rule, table markup, dialogs, tests. Use for any task in E1-E12 that creates or edits .svelte or .svelte.ts files.
---

# DFM Svelte UI conventions

Read once per task: `docs/plans/svelte-rewrite/00-shared-contracts.md` §1 (layout), §9 (JSON), §11 (status classes), §12 (class map), §14 (responsive).

## The three laws

1. Markup uses the mockup's classes from `src/styles/dfm-ui.css` (`btn`, `chip`, `tbl`, `panel`, `pop`, `mi`, `dialog`…). Never write CSS for something the stylesheet already styles. App-specific additions go to `src/styles/dfm-ext.css` only. Tailwind utilities are for layout (`flex`, `grid`, `gap-*`, `min-w-0`) and one-off spacing.
2. Every JSON value the user sees is `formatJson(value)`: pretty-printed with two spaces and fully expanded. Viewers call `expand([], () => true)`. The only exception is a one-line `previewJson` inside a table cell that opens the full viewer.
3. Behaviour comes from the backend: capabilities from `/about`, eligibility from `input-events`, counts from `/stats`. Do not hard-code provider names or invent data. Degrade as the task says.

## Component skeleton (Svelte 5 runes)

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import type { AppState } from '$lib/state/app.svelte';
  import Button from '$lib/components/Button.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    size?: 'md' | 'sm';
    class?: string;
    meta?: Snippet;          // optional slot
    children?: Snippet;
    onselect?: (id: string) => void;
  }
  let { title, size = 'md', class: cls = '', meta, children, onselect }: Props = $props();

  const app = getContext<AppState>('dfm');
  let open = $state(false);
  const label = $derived(size === 'sm' ? title.slice(0, 12) : title);
</script>

<div class="panel {cls}">
  <div class="panel-h"><h2>{label}</h2>{#if meta}<span class="fine muted" style="margin-left:auto">{@render meta()}</span>{/if}</div>
  {@render children?.()}
</div>
```

- Props via `$props()` with an explicit interface; `class` is renamed to `cls`.
- Snippets replace slots. Events are callback props (`onselect`), not `createEventDispatcher`.
- `$effect` only in components (DOM, timers, subscriptions), never in `.svelte.ts` modules.
- Keep components dumb: state lives in `src/lib/state/*.svelte.ts`; components read and call it.

## State module skeleton

```ts
// src/lib/state/failures.svelte.ts
import type { AppState } from './app.svelte';
import type { FailuresResponse } from '$lib/api/types';

export class FailuresState {
  data = $state<FailuresResponse | null>(null);
  loading = $state(false);
  open = $state(new Set<string>());
  #requestId = 0;

  constructor(private app: AppState) {}

  get summary() {
    return this.data ? `${this.data.totalFailed} failed in ${this.data.groups.length} groups` : '';
  }

  async load() {
    const id = ++this.#requestId;
    this.loading = true;
    try {
      const { from, to } = this.app.resolvedRange;
      const res = await this.app.track(this.app.endpoints.failures({ from, to }));
      if (id !== this.#requestId) return;      // a newer request superseded this one
      this.data = res;
    } catch (err) {
      this.app.toast.fromError('Load failed', err, () => this.load());
    } finally {
      if (id === this.#requestId) this.loading = false;
    }
  }
}
```

- Class fields with `$state`; getters for derived values; `#requestId` guards stale responses (replaces React's CancelToken).
- Loaders go through `app.track()` so the progress stripe shows.
- Errors always through `app.toast.fromError(prefix, err, retry?)`.

## App context

`const app = getContext<AppState>('dfm')` gives: `app.host`, `app.client`, `app.endpoints`, `app.router` (`navigate`, `href`, `setQuery`, `current`), `app.prefs` (theme, mode, density, showTimeAs, thresholds, savedViews, autoRefresh), `app.about`, `app.capabilities`, `app.readOnly`, `app.dangerous`, `app.timeRange` / `app.resolvedRange` / `app.setTimeRange`, `app.toast`, `app.track`, `app.onRefresh`, `app.actions` (shared confirm dialogs), `app.dialogs.startNewInstance`, `app.peek`, `app.selection`.

Links: `<a href={app.router.href({ name: 'instance', hub, instanceId })}>` or `app.router.navigate(route, { query })`. Never build paths by string concatenation.

Time and numbers: `fmtDateTime`, `fmtTimeMs`, `fmtAgo` from `$lib/format/time`; `fmtDuration`, `fmtDurationClock` from `$lib/format/duration`; `fmtInt`, `fmtPct`; `fmtBytes`, `utf16Bytes`, `MAX_INLINE_BYTES` from `$lib/format/bytes`; `statusClass`, `spineAttr` from `$lib/format/status`.

## Tables

Use `DataTable` (`$lib/components/table/DataTable.svelte`). Rows must render `data-st={spineAttr(status)}` on `<tr>` and `data-label="<header>"` on every data cell (mobile card layout). Links inside clickable rows use `LinkButton` with `stopPropagation` so the row click (peek) does not fire. Add `keep` when a table must stay a table on mobile (storage, results dialogs).

## Dialogs and menus

`Dialog` / `ConfirmDialog` (`band` for destructive), `Pop` + `MenuItem` for menus, `Select`, `Combobox`, `Checkbox`, `Switch`, `Segmented`, `Tabs`. These wrap bits-ui through `src/lib/components/ui/*`; never import `bits-ui` directly in a screen.

## JSON

- `JsonPre` for inline read-only previews (Summary column, peek state).
- `JsonViewer` (tree, expanded) inside `JsonDialog` for anything opened from a cell, the Raw tab, `/about`.
- `JsonEditor` (text mode) for editable payloads with `SizeMeter` when a 60 KB limit applies.
- `previewJson(value, 120)` for table cells only.

## svelte-jsoneditor snippet

```svelte
<script lang="ts">
  import { JSONEditor, type JSONEditorType } from 'svelte-jsoneditor';
  let { value }: { value: unknown } = $props();
  let editor: JSONEditorType;
  $effect(() => {
    const json = value;                 // track
    editor?.set({ json });
    editor?.expand([], () => true);     // always fully expanded
  });
</script>
<div class="jse-theme-dfm"><JSONEditor bind:this={editor} mode="tree" readOnly mainMenuBar indentation={2} statusBar={false} /></div>
```

## Tests

Component test template (`@testing-library/svelte`, jsdom):

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createFakeApp } from '../../tests/unit/fake-app';
import Subject from './Subject.svelte';

it('opens the peek on row click', async () => {
  const app = createFakeApp({ endpoints: { failures: async () => fixture } });
  render(Subject, { context: new Map([['dfm', app]]), props: { rows } });
  await fireEvent.click(screen.getByRole('row', { name: /order-2026/ }));
  expect(app.peek.item?.id).toBe('order-2026-09-04-000913');
});
```

Unit-test pure modules (`format`, `filters`, `router`, model builders) exhaustively; component tests cover render + the one interaction the component owns; e2e covers the screen against the seeded hub.

## Pitfalls

- Do not use `on:click`; use `onclick`. Do not use `export let`; use `$props()`.
- `$state` on a `Set`/`Map`: use `SvelteSet`/`SvelteMap` from `svelte/reactivity`.
- Reading `window` globals anywhere but `host.svelte.ts` breaks the VS Code host.
- Auto-refresh reloads only page one; "Load more" appends. Never reload everything on a timer.
- Copy text (labels, empty states, dialog bodies) comes from the mockup verbatim, sentence case, no all caps.
- Hidden, not disabled: nav items and panels the hub cannot serve disappear. Disabled with a `title` reason: actions the user lacks permission for.
