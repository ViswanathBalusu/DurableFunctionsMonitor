// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Kv from './Kv.svelte';
import Tabs from './Tabs.svelte';
import SurfacesHarness from '../../../tests/unit/harnesses/SurfacesHarness.svelte';

describe('Page and PageTitle', () => {
  it('renders a .page section with a .ptitle heading and its controls', () => {
    render(SurfacesHarness, { props: { which: 'page' } });

    const page = document.querySelector('section.page');
    expect(page).not.toBeNull();

    const title = screen.getByRole('heading', { name: 'Overview', level: 1 });
    expect(title).toHaveClass('display');
    expect(title.parentElement).toHaveClass('ptitle');

    // The controls after the title are the caller's children
    expect(screen.getByRole('button', { name: 'Refresh' }).parentElement).toHaveClass('ptitle');
  });
});

describe('Panel', () => {
  it('renders a .panel with a .panel-h heading', () => {
    render(SurfacesHarness, { props: { which: 'panel' } });

    const heading = screen.getByRole('heading', { name: 'Needs attention', level: 2 });
    expect(heading.parentElement).toHaveClass('panel-h');
    expect(heading.closest('.panel')).not.toBeNull();
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });

  it('puts the meta snippet at the right end of the header', () => {
    render(SurfacesHarness, { props: { which: 'panel' } });

    const meta = screen.getByText('3 groups');
    expect(meta.previousElementSibling).toHaveClass('grow');
  });

  it('drops to h3 when asked', () => {
    render(SurfacesHarness, { props: { which: 'panel', level: 3 } });

    expect(screen.getByRole('heading', { name: 'Needs attention', level: 3 })).toBeInTheDocument();
  });

  it('renders without a header when there is no title', () => {
    render(SurfacesHarness, { props: { which: 'panel-bare' } });

    expect(document.querySelector('.panel-h')).toBeNull();
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });
});

describe('Card, Banner and EmptyState', () => {
  it('renders a .card', () => {
    render(SurfacesHarness, { props: { which: 'card' } });

    expect(screen.getByText('Card body').closest('.card')).not.toBeNull();
  });

  it('renders a .banner with its chip, text and action, and announces itself', () => {
    render(SurfacesHarness, { props: { which: 'banner' } });

    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('banner');
    expect(banner.querySelector('.chip')?.textContent).toBe('Partial results');
    expect(banner.textContent).toContain('Counted the first 50,000 instances');
    expect(screen.getByRole('button', { name: 'Narrow the range' })).toBeInTheDocument();
  });

  it('renders an .empty state with its title, text and actions', () => {
    render(SurfacesHarness, { props: { which: 'empty' } });

    const empty = document.querySelector('.empty');
    expect(empty).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'No orchestrations', level: 2 })).toHaveClass('display');
    expect(screen.getByText(/Nothing was created/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new instance' }).closest('.row')).not.toBeNull();
  });
});

describe('Kv', () => {
  const rows = [
    { k: 'workitems', v: '1,240', mono: true },
    { k: 'control-00', v: '12', mono: true },
  ];

  it('renders dt/dd pairs with mono on the values that ask for it', () => {
    render(Kv, { props: { rows } });

    const terms = document.querySelectorAll('dl.kv dt');
    const values = document.querySelectorAll('dl.kv dd');

    expect(terms).toHaveLength(2);
    expect(terms[0].textContent).toBe('workitems');
    expect(values[0].textContent).toBe('1,240');
    expect(values[0]).toHaveClass('mono');
  });

  it('leaves the value plain when mono is not asked for', () => {
    render(Kv, { props: { rows: [{ k: 'Task hub', v: 'DurableFunctionsHub' }] } });

    expect(document.querySelector('dl.kv dd')).not.toHaveClass('mono');
  });

  it('adds the third column when asked', () => {
    render(Kv, { props: { rows, columns: 3 } });

    expect(document.querySelectorAll('dl.kv dd')).toHaveLength(4);
    expect(document.querySelector('dl.kv')?.getAttribute('style')?.replace(/\s/g, '')).toContain(
      'grid-template-columns:auto1frauto',
    );
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'summary', label: 'Summary', summaryTab: true },
    { id: 'timeline', label: 'Timeline' },
    { id: 'history', label: 'History' },
  ];

  it('is a tablist of .tab buttons with the selected one marked', () => {
    render(Tabs, { props: { tabs, value: 'history', ariaLabel: 'Instance views' } });

    const list = screen.getByRole('tablist', { name: 'Instance views' });
    expect(list).toHaveClass('tabs');

    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('false');
  });

  it('marks the summary tab so the wide layout can hide it', () => {
    render(Tabs, { props: { tabs, value: 'history', ariaLabel: 'Instance views' } });

    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveClass('summary-tab');
  });

  it('selects on click', async () => {
    const onchange = vi.fn();
    render(Tabs, { props: { tabs, value: 'history', ariaLabel: 'Instance views', onchange } });

    await fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));

    expect(onchange).toHaveBeenCalledWith('timeline');
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true');
  });

  it('moves with the arrow keys, wrapping, and with Home and End', async () => {
    const onchange = vi.fn();
    render(Tabs, { props: { tabs, value: 'summary', ariaLabel: 'Instance views', onchange } });

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'ArrowLeft' });
    expect(onchange).toHaveBeenLastCalledWith('history');

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(onchange).toHaveBeenLastCalledWith('summary');

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' });
    expect(onchange).toHaveBeenLastCalledWith('history');

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'Home' });
    expect(onchange).toHaveBeenLastCalledWith('summary');
  });

  it('keeps only the selected tab in the tab order', () => {
    render(Tabs, { props: { tabs, value: 'history', ariaLabel: 'Instance views' } });

    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('tabindex')).toBe('-1');
  });

  it('renders the controls after a spacer', () => {
    render(SurfacesHarness, { props: { which: 'tabs' } });

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh.previousElementSibling).toHaveClass('grow');
    expect(refresh.closest('.tabs')).not.toBeNull();
  });
});
