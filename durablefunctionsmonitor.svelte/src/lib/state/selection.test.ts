// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { Selection } from './selection.svelte';

const rows = [
  { instanceId: 'order-1', name: 'ProcessOrder' },
  { instanceId: 'order-2', name: 'ProcessOrder' },
  { instanceId: 'order-3', name: 'ReconcileLedger' },
];

describe('Selection', () => {
  it('starts empty', () => {
    const selection = new Selection();

    expect(selection.count).toBe(0);
    expect(selection.isEmpty).toBe(true);
    expect(selection.list).toEqual([]);
  });

  it('toggles one row on and off, keeping its name for the dialogs', () => {
    const selection = new Selection();

    selection.toggle('order-1', 'ProcessOrder');

    expect(selection.has('order-1')).toBe(true);
    expect(selection.nameOf('order-1')).toBe('ProcessOrder');

    selection.toggle('order-1');

    expect(selection.has('order-1')).toBe(false);
    expect(selection.nameOf('order-1')).toBe('');
  });

  it('keeps the order rows were selected in', () => {
    const selection = new Selection();

    selection.toggle('order-3');
    selection.toggle('order-1');

    expect(selection.list).toEqual(['order-3', 'order-1']);
  });

  it('selects every visible row, then clears them all on a second toggle', () => {
    const selection = new Selection();

    selection.toggleAll(rows);
    expect(selection.list).toEqual(['order-1', 'order-2', 'order-3']);
    expect(selection.hasAll(rows)).toBe(true);

    selection.toggleAll(rows);
    expect(selection.isEmpty).toBe(true);
  });

  it('adds the visible rows that are missing rather than clearing a partial selection', () => {
    const selection = new Selection();

    selection.toggle('order-2');
    selection.toggleAll(rows);

    expect(selection.count).toBe(3);
  });

  it('clears only the visible rows, so a row selected on an earlier page survives', () => {
    const selection = new Selection();

    selection.toggle('order-from-page-1');
    selection.toggleAll(rows);
    selection.toggleAll(rows);

    expect(selection.list).toEqual(['order-from-page-1']);
  });

  it('has no "all" to speak of when nothing is visible', () => {
    const selection = new Selection();

    selection.toggleAll([]);

    expect(selection.isEmpty).toBe(true);
    expect(selection.hasAll([])).toBe(false);
  });

  it('takes a whole selection at once, ids or rows', () => {
    const selection = new Selection();

    selection.set(rows);
    expect(selection.count).toBe(3);
    expect(selection.nameOf('order-3')).toBe('ReconcileLedger');

    selection.set(['order-9']);
    expect(selection.list).toEqual(['order-9']);
    expect(selection.nameOf('order-9')).toBe('');
  });

  // Reactivity itself is SvelteSet's and SvelteMap's, and is exercised by the bulk bar's own tests:
  // a rune cannot be read from a plain .ts test file.
  it('clears', () => {
    const selection = new Selection();

    selection.set(rows);
    selection.clear();

    expect(selection.isEmpty).toBe(true);
    expect(selection.names.size).toBe(0);
  });
});
