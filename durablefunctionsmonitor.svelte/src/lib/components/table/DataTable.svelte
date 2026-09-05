<script lang="ts" generics="Row">
  import type { Snippet } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { spineAttr } from '$lib/format/status';
  import { cn } from '$lib/utils';
  import { sortClass, visibleColumns, type ColumnDef, type SortState } from './columns';

  interface Props {
    columns: ColumnDef<Row>[];
    rows: Row[];
    /** Stable key per row; also what the selection set holds. */
    rowKey: (row: Row) => string;
    /** The runtime status that colours the spine (`data-st`). */
    rowStatus?: (row: Row) => string | undefined;
    selectable?: boolean;
    /** Bindable set of selected row keys. */
    selected?: Set<string>;
    /** Bindable list of hidden column ids. */
    hiddenColumns?: string[];
    sort?: SortState | null;
    /** Adds `.keep`, which opts the table out of the mobile card layout (contracts §14). */
    keep?: boolean;
    /** Adds `.flat`: no border or shadow, for a table inside another frame. */
    flat?: boolean;
    /** The row to mark with `.hl` (the timeline hover linkage). */
    highlightKey?: string | null;
    ariaLabel: string;
    /** Rendered inside `.tfoot` under the table. */
    footer?: Snippet;
    class?: string;
    style?: string;
    onRowClick?: (row: Row) => void;
    onSort?: (id: string) => void;
    onRowEnter?: (row: Row) => void;
    onRowLeave?: (row: Row) => void;
    /** Rows past this many are virtualised; below it the whole table is in the DOM. */
    virtualizeAbove?: number;
  }

  let {
    columns,
    rows,
    rowKey,
    rowStatus,
    selectable = false,
    selected = $bindable(new Set<string>()),
    hiddenColumns = $bindable([]),
    sort = null,
    keep = false,
    flat = false,
    highlightKey = null,
    ariaLabel,
    footer,
    class: className,
    style,
    onRowClick,
    onSort,
    onRowEnter,
    onRowLeave,
    virtualizeAbove = 200,
  }: Props = $props();

  /**
   * Long tables are virtualised: a thousand instances is a normal page here, and a thousand rows of
   * eight cells each is what makes a table feel broken. Below the threshold everything is rendered,
   * which keeps Ctrl+F and the mobile card layout working on the tables that are actually short.
   */
  const virtualized = $derived(rows.length > virtualizeAbove);

  let scrollElement = $state<HTMLDivElement | null>(null);

  /** The row height the stylesheet is using right now; it changes with the density preference. */
  let rowHeight = $state(40);

  $effect(() => {
    const probe = scrollElement?.querySelector('tbody tr');
    const measured = probe ? Math.round(probe.getBoundingClientRect().height) : 0;

    if (measured > 0 && measured !== rowHeight) {
      rowHeight = measured;
    }
  });

  const virtualizer = $derived(
    createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
      count: virtualized ? rows.length : 0,
      getScrollElement: () => scrollElement,
      estimateSize: () => rowHeight,
      overscan: 8,
    }),
  );

  /** How many rows to render before the virtualiser has measured anything. */
  const FALLBACK_WINDOW = 30;

  /** The rows actually in the DOM, with their index, plus the spacer heights above and below. */
  const window = $derived.by(() => {
    if (!virtualized) {
      return { items: rows.map((row, index) => ({ row, index })), before: 0, after: 0 };
    }

    const items = $virtualizer.getVirtualItems();

    if (items.length === 0) {
      // Before the first measurement - and in jsdom, where a scroll element has no height at all -
      // the virtualiser has no range to offer. Render a first screenful rather than nothing, and keep
      // the space of the rest so the scrollbar is honest from the start.
      const head = Math.min(rows.length, FALLBACK_WINDOW);

      return {
        items: rows.slice(0, head).map((row, index) => ({ row, index })),
        before: 0,
        after: (rows.length - head) * rowHeight,
      };
    }

    const total = $virtualizer.getTotalSize();

    return {
      items: items.map((item) => ({ row: rows[item.index], index: item.index })),
      before: items[0].start,
      after: total - items[items.length - 1].end,
    };
  });

  const shown = $derived(visibleColumns(columns, hiddenColumns));

  const keys = $derived(rows.map(rowKey));

  const allSelected = $derived(keys.length > 0 && keys.every((key) => selected.has(key)));

  /** What the owner puts in the footer: "n columns hidden · show all". */
  export function hiddenCount(): number {
    return hiddenColumns.length;
  }

  function toggleAll(): void {
    // Selecting all means the rows on screen: the backend paginates, and a set of ids the user cannot
    // see is not a selection anybody asked for.
    selected = allSelected ? new Set() : new Set(keys);
  }

  function toggleRow(key: string): void {
    // A new Set every time rather than a mutated one: `selected` is a prop the owner binds, and a
    // reassignment is what tells it (and Svelte) that the selection changed.
    selected = new Set(selected.has(key) ? [...selected].filter((other) => other !== key) : [...selected, key]);
  }

  function cellValue(column: ColumnDef<Row>, row: Row): string {
    const value = column.accessor?.(row);
    return value === null || value === undefined ? '' : String(value);
  }
</script>

<!-- Markup of ScreenInstances.dc.html L77-L97: a `.tbl-wrap` frame around a `.tbl`, an optional
     select column, the status spine, then the data columns - each cell carrying the `data-label`
     the mobile card layout reads (contracts §14). -->
<div
  bind:this={scrollElement}
  class={cn('tbl-wrap', keep ? 'keep' : '', flat ? 'flat' : '', className)}
  style={virtualized ? `max-height:70vh;overflow:auto;${style ?? ''}` : style}
>
  <table class="tbl" aria-label={ariaLabel}>
    <thead>
      <tr>
        {#if selectable}
          <th class="sel-cell">
            <button
              class={cn('box', allSelected ? 'on' : '')}
              type="button"
              aria-label="Select all"
              aria-pressed={allSelected}
              onclick={toggleAll}
            ></button>
          </th>
        {/if}
        <th class="spine"></th>
        {#each shown as column (column.id)}
          <th
            class={sortClass(sort, column.id)}
            style={column.width ? `width:${column.width}` : undefined}
            aria-sort={sort?.id === column.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
          >
            {#if column.sortable && onSort}
              <button class="link" type="button" onclick={() => onSort?.(column.id)}>{column.header}</button>
            {:else}
              {column.header}
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#if window.before > 0}
        <tr aria-hidden="true" style={`height:${window.before}px`}></tr>
      {/if}
      {#each window.items as item (rowKey(item.row))}
        {@const row = item.row}
        {@const index = item.index}
        {@const key = rowKey(row)}
        <tr
          data-st={spineAttr(rowStatus?.(row))}
          data-clickable={onRowClick ? 'true' : undefined}
          aria-selected={selectable ? selected.has(key) : undefined}
          class={highlightKey === key ? 'hl' : undefined}
          onclick={() => onRowClick?.(row)}
          onmouseenter={() => onRowEnter?.(row)}
          onmouseleave={() => onRowLeave?.(row)}
        >
          {#if selectable}
            <td class="sel-cell nolabel">
              <button
                class={cn('box', selected.has(key) ? 'on' : '')}
                type="button"
                aria-label="Select row"
                aria-pressed={selected.has(key)}
                onclick={(event) => {
                  event.stopPropagation();
                  toggleRow(key);
                }}
              ></button>
            </td>
          {/if}
          <td class="spine"></td>
          {#each shown as column (column.id)}
            <td
              class={cn(column.mono ? 'mono' : '', column.trunc ? 'trunc' : '')}
              data-label={column.header}
              data-row-index={index}
            >
              {#if column.cell}
                {@render column.cell(row)}
              {:else}
                {cellValue(column, row)}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
      {#if window.after > 0}
        <tr aria-hidden="true" style={`height:${window.after}px`}></tr>
      {/if}
    </tbody>
  </table>

  {#if footer}
    <div class="tfoot">
      {@render footer()}
    </div>
  {/if}
</div>
