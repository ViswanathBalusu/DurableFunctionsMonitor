// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DataTableHarness from '../../../../tests/unit/harnesses/DataTableHarness.svelte';

interface Row {
  instanceId: string;
  name: string;
  runtimeStatus: string;
  customStatus?: unknown;
}

const rows: Row[] = [
  { instanceId: 'order-1', name: 'ProcessOrderOrchestrator', runtimeStatus: 'Failed', customStatus: { step: 2 } },
  { instanceId: 'order-2', name: 'ProcessOrderOrchestrator', runtimeStatus: 'Running' },
  { instanceId: 'order-3', name: 'ReconcileLedgerOrchestrator', runtimeStatus: 'Completed' },
];

function bodyRows(): HTMLTableRowElement[] {
  return Array.from(document.querySelectorAll('tbody tr:not([aria-hidden])'));
}

describe('DataTable', () => {
  it('renders the mockups’ frame, spine and columns', () => {
    render(DataTableHarness, { props: { rows } });

    expect(document.querySelector('.tbl-wrap > table.tbl')).not.toBeNull();
    expect(document.querySelectorAll('thead th.spine')).toHaveLength(1);
    expect(bodyRows()).toHaveLength(3);

    const first = bodyRows()[0];
    expect(first.getAttribute('data-st')).toBe('Failed');
    expect(first.querySelector('td.spine')).not.toBeNull();
  });

  it('labels every data cell for the mobile card layout', () => {
    render(DataTableHarness, { props: { rows } });

    for (const cell of Array.from(bodyRows()[0].querySelectorAll('td'))) {
      if (cell.classList.contains('spine') || cell.classList.contains('sel-cell')) {
        expect(cell.getAttribute('data-label')).toBeNull();
        continue;
      }

      expect(cell.getAttribute('data-label')).toBeTruthy();
    }
  });

  it('opens the row on click, but not when the id link is clicked', async () => {
    const onRowClick = vi.fn();
    const onOpen = vi.fn();

    render(DataTableHarness, { props: { rows, onRowClick, onOpen } });

    await fireEvent.click(bodyRows()[0]);
    expect(onRowClick).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole('button', { name: 'order-2' }));
    expect(onOpen).toHaveBeenCalledWith('order-2');
    expect(onRowClick).toHaveBeenCalledOnce();
  });

  it('selects rows and reports the set', async () => {
    render(DataTableHarness, { props: { rows, selectable: true } });

    const boxes = screen.getAllByRole('button', { name: 'Select row' });
    await fireEvent.click(boxes[0]);

    expect(bodyRows()[0].getAttribute('aria-selected')).toBe('true');
    expect(boxes[0]).toHaveClass('on');
    expect(screen.getByTestId('selection').textContent).toBe('order-1');
  });

  it('selecting a row does not open it', async () => {
    const onRowClick = vi.fn();
    render(DataTableHarness, { props: { rows, selectable: true, onRowClick } });

    await fireEvent.click(screen.getAllByRole('button', { name: 'Select row' })[0]);

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('select-all toggles every row and lights up only when all are selected', async () => {
    render(DataTableHarness, { props: { rows, selectable: true } });

    const all = screen.getByRole('button', { name: 'Select all' });
    expect(all).not.toHaveClass('on');

    await fireEvent.click(all);
    expect(screen.getByTestId('selection').textContent).toBe('order-1,order-2,order-3');
    expect(screen.getByRole('button', { name: 'Select all' })).toHaveClass('on');

    // Unselecting one takes the header box back off
    await fireEvent.click(screen.getAllByRole('button', { name: 'Select row' })[1]);
    expect(screen.getByRole('button', { name: 'Select all' })).not.toHaveClass('on');

    await fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByTestId('selection').textContent).toBe('order-1,order-2,order-3');
  });

  it('marks the sorted column and reports clicks on a sortable header', async () => {
    const onSort = vi.fn();
    render(DataTableHarness, { props: { rows, sort: { id: 'name', dir: 'desc' }, onSort } });

    const header = screen.getByRole('columnheader', { name: 'name' });
    expect(header).toHaveClass('sort');
    expect(header).toHaveClass('desc');
    expect(header.getAttribute('aria-sort')).toBe('descending');

    await fireEvent.click(screen.getByRole('button', { name: 'name' }));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('hides the columns the chooser turned off', () => {
    render(DataTableHarness, { props: { rows, hiddenColumns: ['name'] } });

    expect(screen.queryByRole('columnheader', { name: 'name' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'instanceId' })).toBeInTheDocument();
  });

  it('highlights the linked row and reports hover', async () => {
    const onRowEnter = vi.fn();
    render(DataTableHarness, { props: { rows, highlightKey: 'order-2', onRowEnter } });

    expect(bodyRows()[1]).toHaveClass('hl');

    await fireEvent.mouseEnter(bodyRows()[0]);
    expect(onRowEnter).toHaveBeenCalledOnce();
  });

  it('adds keep and flat when asked', () => {
    render(DataTableHarness, { props: { rows, keep: true, flat: true } });

    const wrap = document.querySelector('.tbl-wrap');
    expect(wrap).toHaveClass('keep');
    expect(wrap).toHaveClass('flat');
  });

  it('drops the header row when the columns need no naming, and keeps the labels', () => {
    render(DataTableHarness, { props: { rows, hideHeader: true } });

    expect(document.querySelector('table.tbl thead')).toBeNull();
    expect(bodyRows()).toHaveLength(3);

    // The mobile card layout reads the label off the cell, not off a header that is not there
    expect(bodyRows()[0].querySelector('td[data-label="name"]')).not.toBeNull();
  });

  it('renders the footer the owner passes', () => {
    render(DataTableHarness, { props: { rows } });

    expect(screen.getByText(/Showing 3/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 3/).closest('.tfoot')).not.toBeNull();
  });

  it('shows a JSON cell as a one-line preview that opens the viewer', async () => {
    const onOpenJson = vi.fn();
    render(DataTableHarness, { props: { rows, onOpenJson } });

    const preview = screen.getByRole('button', { name: '{"step":2}' });
    await fireEvent.click(preview);

    expect(onOpenJson).toHaveBeenCalledWith({ step: 2 }, 'customStatus');

    // The row without a customStatus shows the em dash, not an empty cell
    expect(bodyRows()[1].textContent).toContain('—');
  });

  it('virtualises a long table: only a window of rows is in the DOM', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      instanceId: `order-${i}`,
      name: 'ProcessOrderOrchestrator',
      runtimeStatus: 'Completed',
    }));

    render(DataTableHarness, { props: { rows: many } });

    await waitFor(() => expect(bodyRows().length).toBeGreaterThan(0));

    // jsdom reports a zero-height viewport, so the window is the overscan; what matters is that it is
    // a window at all rather than a thousand rows.
    expect(bodyRows().length).toBeLessThan(100);

    // And the space the missing rows take is kept, so the scrollbar is honest
    const spacers = document.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(spacers.length).toBeGreaterThan(0);
  });

  it('renders every row of a short table', () => {
    const some = Array.from({ length: 50 }, (_, i) => ({
      instanceId: `order-${i}`,
      name: 'ProcessOrderOrchestrator',
      runtimeStatus: 'Completed',
    }));

    render(DataTableHarness, { props: { rows: some } });

    expect(bodyRows()).toHaveLength(50);
    expect(document.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(0);
  });
});
