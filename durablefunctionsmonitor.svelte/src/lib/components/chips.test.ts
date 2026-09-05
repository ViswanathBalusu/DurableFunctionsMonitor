// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChipsHarness from '../../../tests/unit/harnesses/ChipsHarness.svelte';
import Segmented from './Segmented.svelte';
import { isKnownStatus, kindClass, spineAttr, statusClass } from '$lib/format/status';

describe('status.ts', () => {
  it.each([
    ['Completed', 'st-completed'],
    ['Running', 'st-running'],
    ['Failed', 'st-failed'],
    ['Pending', 'st-pending'],
    ['Terminated', 'st-terminated'],
    ['Canceled', 'st-canceled'],
    ['Suspended', 'st-suspended'],
  ])('maps %s to %s', (status, expected) => {
    expect(statusClass(status)).toBe(expected);
  });

  it('maps ContinuedAsNew to the short class the contract names', () => {
    expect(statusClass('ContinuedAsNew')).toBe('st-continued');
  });

  it('gives an unknown status no class rather than a wrong one', () => {
    expect(statusClass(undefined)).toBe('');
    expect(statusClass('')).toBe('');
  });

  it('carries the status verbatim into the spine attribute', () => {
    expect(spineAttr('ContinuedAsNew')).toBe('ContinuedAsNew');
    expect(spineAttr(null)).toBe('');
  });

  it('tells the two kinds apart', () => {
    expect(kindClass('DurableEntity')).toBe('kind-entity');
    expect(kindClass('Orchestration')).toBe('kind-orchestration');
    expect(kindClass(undefined)).toBe('kind-orchestration');
  });

  it('knows which statuses it knows', () => {
    expect(isKnownStatus('Failed')).toBe(true);
    expect(isKnownStatus('Reticulating')).toBe(false);
  });
});

describe('Chip', () => {
  it('renders .chip with its children', () => {
    render(ChipsHarness, { props: { which: 'chip', label: 'entity' } });

    expect(screen.getByText('entity')).toHaveClass('chip');
  });

  it('shrinks with size="sm"', () => {
    render(ChipsHarness, { props: { which: 'chip', label: 'entity', size: 'sm' } });

    expect(screen.getByText('entity')).toHaveClass('sm');
  });

  it('takes the entity kind class the mockups put on it', () => {
    render(ChipsHarness, { props: { which: 'chip', label: 'entity', class: 'kind-entity' } });

    expect(screen.getByText('entity')).toHaveClass('kind-entity');
  });
});

describe('StatusChip', () => {
  it('shows the status text and its class', () => {
    render(ChipsHarness, { props: { which: 'status', status: 'Failed' } });

    const chip = screen.getByText('Failed');
    expect(chip).toHaveClass('chip');
    expect(chip).toHaveClass('st-failed');
  });

  it('shows ContinuedAsNew as it comes, with st-continued', () => {
    render(ChipsHarness, { props: { which: 'status', status: 'ContinuedAsNew' } });

    expect(screen.getByText('ContinuedAsNew')).toHaveClass('st-continued');
  });
});

describe('DangerBadge', () => {
  it('says what it means and why it is there', () => {
    render(ChipsHarness, { props: { which: 'danger' } });

    const badge = screen.getByText('Dangerous operations on');
    expect(badge).toHaveClass('dbadge');
    expect(badge.getAttribute('title')).toBe('/about lists DurableFunctionsMonitor.DangerousOperations');
  });
});

describe('Tag', () => {
  it('is a button, because it opens the value viewer', async () => {
    const onclick = vi.fn();
    render(ChipsHarness, { props: { which: 'tag', label: 'input', onclick } });

    const tag = screen.getByRole('button', { name: 'input' });
    expect(tag).toHaveClass('tag');

    await fireEvent.click(tag);
    expect(onclick).toHaveBeenCalledOnce();
  });
});

describe('MiniCounter', () => {
  it('renders the number with the status colour', () => {
    render(ChipsHarness, { props: { which: 'mini', count: 9, status: 'Failed' } });

    const mini = screen.getByText('9');
    expect(mini).toHaveClass('mini');
    expect(mini).toHaveClass('st-failed');
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'utc', label: 'UTC' },
    { value: 'local', label: 'Local' },
  ];

  it('marks the chosen segment with aria-pressed', () => {
    render(Segmented, { props: { options, value: 'utc', ariaLabel: 'Show time as' } });

    expect(screen.getByRole('button', { name: 'UTC' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Local' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('changes on click', async () => {
    const onchange = vi.fn();
    render(Segmented, { props: { options, value: 'utc', ariaLabel: 'Show time as', onchange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Local' }));

    expect(onchange).toHaveBeenCalledWith('local');
    expect(screen.getByRole('button', { name: 'Local' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not fire when the same segment is clicked again', async () => {
    const onchange = vi.fn();
    render(Segmented, { props: { options, value: 'utc', ariaLabel: 'Show time as', onchange } });

    await fireEvent.click(screen.getByRole('button', { name: 'UTC' }));

    expect(onchange).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys and wraps around', async () => {
    const onchange = vi.fn();
    render(Segmented, { props: { options, value: 'utc', ariaLabel: 'Show time as', onchange } });

    await fireEvent.keyDown(screen.getByRole('button', { name: 'UTC' }), { key: 'ArrowRight' });
    expect(onchange).toHaveBeenLastCalledWith('local');

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Local' }), { key: 'ArrowRight' });
    expect(onchange).toHaveBeenLastCalledWith('utc');
  });

  it('is a labelled group, so a screen reader announces what is being chosen', () => {
    render(Segmented, { props: { options, value: 'utc', ariaLabel: 'Show time as' } });

    expect(screen.getByRole('group', { name: 'Show time as' })).toHaveClass('seg');
  });
});
