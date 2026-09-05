// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it } from 'vitest';
import { nextSort, sortClass, visibleColumns } from './columns';

describe('nextSort', () => {
  it('starts a new column ascending', () => {
    expect(nextSort(null, 'createdTime')).toEqual({ id: 'createdTime', dir: 'asc' });
    expect(nextSort({ id: 'name', dir: 'desc' }, 'createdTime')).toEqual({ id: 'createdTime', dir: 'asc' });
  });

  it('cycles ascending → descending → unsorted on the same column', () => {
    const asc = nextSort(null, 'createdTime');
    expect(asc).toEqual({ id: 'createdTime', dir: 'asc' });

    const desc = nextSort(asc, 'createdTime');
    expect(desc).toEqual({ id: 'createdTime', dir: 'desc' });

    expect(nextSort(desc, 'createdTime')).toBeNull();
  });
});

describe('sortClass', () => {
  it('marks only the sorted column, and says which way', () => {
    expect(sortClass({ id: 'createdTime', dir: 'asc' }, 'createdTime')).toBe('sort');
    expect(sortClass({ id: 'createdTime', dir: 'desc' }, 'createdTime')).toBe('sort desc');
    expect(sortClass({ id: 'createdTime', dir: 'asc' }, 'name')).toBe('');
    expect(sortClass(null, 'name')).toBe('');
  });
});

describe('visibleColumns', () => {
  const columns = [
    { id: 'instanceId', header: 'instanceId' },
    { id: 'name', header: 'name' },
    { id: 'input', header: 'input' },
  ];

  it('keeps the order and drops the hidden ones', () => {
    expect(visibleColumns(columns, ['name']).map((c) => c.id)).toEqual(['instanceId', 'input']);
  });

  it('keeps everything when nothing is hidden', () => {
    expect(visibleColumns(columns, [])).toHaveLength(3);
  });
});
