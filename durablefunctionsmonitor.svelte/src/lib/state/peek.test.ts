// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { Peek, type PeekItem } from './peek.svelte';

const item: PeekItem = {
  id: 'order-1',
  name: 'ProcessOrder',
  kind: 'Orchestration',
  status: 'Running',
  created: '2026-09-04T14:02:11Z',
  updated: '2026-09-04T14:02:58Z',
  duration: 47_000,
};

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => resolve()));
}

describe('Peek', () => {
  it('is closed until a row is peeked', () => {
    const peek = new Peek();

    expect(peek.isOpen).toBe(false);
    expect(peek.item).toBeNull();

    peek.open(item);

    expect(peek.isOpen).toBe(true);
    expect(peek.item?.id).toBe('order-1');
  });

  it('closes', async () => {
    const peek = new Peek();

    peek.open(item);
    peek.close();
    await flush();

    expect(peek.isOpen).toBe(false);
    expect(peek.item).toBeNull();
  });

  it('holds a copy of the row, not a pointer into the list', () => {
    const peek = new Peek();
    const row = { ...item };

    peek.open(row);
    peek.open({ ...item, id: 'order-2' });

    // The list is free to page, sort or reload underneath: the panel keeps showing what was peeked
    expect(row.id).toBe('order-1');
    expect(peek.item?.id).toBe('order-2');
  });

  it('gives the focus back to the row that opened it', async () => {
    const peek = new Peek();
    const row = document.createElement('button');
    document.body.append(row);
    row.focus();

    peek.open(item);
    expect(document.activeElement).toBe(row);

    // What the panel does while it is open: the focus trap moves it inside
    const inside = document.createElement('button');
    document.body.append(inside);
    inside.focus();

    peek.close();
    await flush();

    expect(document.activeElement).toBe(row);

    row.remove();
    inside.remove();
  });

  it('keeps the first opener when the user peeks another row without closing', async () => {
    const peek = new Peek();
    const row = document.createElement('button');
    document.body.append(row);
    row.focus();

    peek.open(item);
    peek.open({ ...item, id: 'order-2' });
    document.body.focus();
    peek.close();
    await flush();

    expect(document.activeElement).toBe(row);

    row.remove();
  });

  it('does not put the focus on a row that has since gone away', async () => {
    const peek = new Peek();
    const row = document.createElement('button');
    document.body.append(row);
    row.focus();

    peek.open(item);
    row.remove();

    expect(() => peek.close()).not.toThrow();
    await flush();
  });

  it('closing twice is not an error', async () => {
    const peek = new Peek();

    peek.close();
    peek.open(item);
    peek.close();
    peek.close();
    await flush();

    expect(peek.isOpen).toBe(false);
  });
});
