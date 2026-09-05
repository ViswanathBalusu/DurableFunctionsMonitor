// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { normalizeAbout } from '$lib/api/endpoints';
import type { Capabilities, StatsResponse } from '$lib/api/types';
import type { AppState } from '$lib/state/app.svelte';
import { NO_STATS_TEXT, NO_STATS_TITLE } from '$lib/state/overview.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Overview from './Overview.svelte';
import { audit as auditFixture } from '../../tests/unit/fixtures/audit';
import { partialStats, stats as statsFixture } from '../../tests/unit/fixtures/stats';
import { storage as storageFixture } from '../../tests/unit/fixtures/storage';

function mount(
  options: {
    path?: string;
    stats?: StatsResponse;
    capabilities?: Partial<Capabilities>;
    onStats?: () => void;
  } = {},
) {
  return render(ScreenHarness, {
    props: {
      screen: Overview,
      path: options.path ?? '/DurableFunctionsHub',
      capabilities: options.capabilities ?? { stats: true },
      endpoints: {
        stats: async () => {
          options.onStats?.();

          return options.stats ?? statsFixture();
        },
        storage: async () => storageFixture(),
        audit: async () => auditFixture(),
      },
    },
  });
}

function appOf(rendered: { component: unknown }): AppState {
  return (rendered.component as { appState: () => AppState }).appState();
}

describe('Overview: the title row', () => {
  it('is the page of the mockup: the title, the range and Refresh', async () => {
    mount();

    expect(document.querySelector('section.page[data-screen-label="Overview"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toHaveClass('display');

    expect(screen.getByRole('button', { name: 'Time range' })).toHaveTextContent('Last 24 hours');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('ghost');

    await waitFor(() =>
      expect(document.querySelector('.ptitle .fine.muted')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'refreshed just now · scanned 1,229 (full)',
      ),
    );
  });

  it('says nothing about freshness until something has been loaded', () => {
    mount();

    expect(document.querySelector('.ptitle .fine.muted')).toBeNull();
  });

  it('reloads when the shared range changes', async () => {
    const onStats = vi.fn();
    const rendered = mount({ onStats });

    await waitFor(() => expect(onStats).toHaveBeenCalledOnce());

    appOf(rendered).setTimeRange({ preset: '7d' });

    await waitFor(() => expect(onStats).toHaveBeenCalledTimes(2));
  });

  it('reloads when anything asks the app to refresh', async () => {
    const onStats = vi.fn();
    const rendered = mount({ onStats });

    await waitFor(() => expect(onStats).toHaveBeenCalledOnce());

    appOf(rendered).refresh();

    await waitFor(() => expect(onStats).toHaveBeenCalledTimes(2));
  });
});

describe('Overview: the partial banner', () => {
  it('says how far the backend counted, and offers a range it can count fully', async () => {
    const rendered = mount({ path: '/DurableFunctionsHub?range=30d', stats: partialStats({ cap: 50_000 }) });

    const banner = await screen.findByRole('status');

    expect(banner).toHaveClass('banner');
    expect(banner.querySelector('.chip.sm.st-running')?.textContent).toBe('Partial results');
    expect(banner.textContent).toContain(
      'Counted the first 50,000 instances of the range; narrow the range for exact numbers.',
    );

    const narrow = screen.getByRole('button', { name: 'Use last 24 hours' });

    await narrow.click();

    await waitFor(() => expect(appOf(rendered).timeRange).toEqual({ preset: '24h' }));
  });

  it('does not offer the range that is already in force', async () => {
    mount({ stats: partialStats() });

    await screen.findByRole('status');

    expect(screen.queryByRole('button', { name: 'Use last 24 hours' })).toBeNull();
  });

  it('is not there when nothing was counted at all', async () => {
    mount({ stats: partialStats({ totals: { all: 0, entities: 0 } }) });

    await screen.findByRole('heading', { name: 'No orchestrations' });

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Overview: the empty state', () => {
  it('names the range that came back empty and offers a wider one', async () => {
    const rendered = mount({ stats: statsFixture({ totals: { all: 0, entities: 0 }, byName: [] }) });

    const empty = await screen.findByRole('heading', { name: 'No orchestrations' });

    expect(empty.closest('.empty')?.querySelector('p')?.textContent).toBe(
      'Nothing was created in the last 24 hours. Widen the time range or start a new instance.',
    );

    await screen.getByRole('button', { name: 'Widen to 7 days' }).click();

    await waitFor(() => expect(appOf(rendered).timeRange).toEqual({ preset: '7d' }));
  });

  it('opens the dialog the Instances screen owns, by going there and asking for it', async () => {
    const rendered = mount({ stats: statsFixture({ totals: { all: 0, entities: 0 }, byName: [] }) });

    await screen.findByRole('heading', { name: 'No orchestrations' });

    const start = screen.getByRole('button', { name: 'Start new instance' });

    expect(start).toHaveClass('primary');

    await start.click();

    const app = appOf(rendered);

    await waitFor(() => expect(app.router.current.name).toBe('instances'));
    expect(app.router.current.query.get('start')).toBe('1');
  });

  it('uses the dialog directly when the screen that owns it is on', async () => {
    const openWith = vi.fn();
    const rendered = mount({ stats: statsFixture({ totals: { all: 0, entities: 0 }, byName: [] }) });

    appOf(rendered).dialogs.startNewInstance = { open: false, openWith };

    await screen.findByRole('heading', { name: 'No orchestrations' });

    await screen.getByRole('button', { name: 'Start new instance' }).click();

    expect(openWith).toHaveBeenCalledOnce();
    expect(appOf(rendered).router.current.name).toBe('overview');
  });

  it('counts an entity-only range as something rather than nothing', async () => {
    mount({ stats: statsFixture({ totals: { all: 0, entities: 7 }, byName: [] }) });

    await waitFor(() => expect(document.querySelector('.ptitle .fine.muted')).not.toBeNull());

    expect(screen.queryByRole('heading', { name: 'No orchestrations' })).toBeNull();
  });
});

describe('Overview: the panels that need a capability', () => {
  it('puts Backlog beside Recent activity when the backend serves both', async () => {
    mount({ capabilities: { stats: true, storageHealth: true, audit: true } });

    await screen.findByRole('heading', { name: 'Backlog', level: 2 });

    expect(screen.getByRole('heading', { name: 'Recent activity', level: 2 })).toBeInTheDocument();
    expect(document.querySelector('.panels.wide-right')?.className).toBe('panels wide-right');
  });

  it('gives Backlog the whole width when there is no audit trail to put beside it', async () => {
    mount({ capabilities: { stats: true, storageHealth: true } });

    await screen.findByRole('heading', { name: 'Backlog', level: 2 });

    expect(screen.queryByRole('heading', { name: 'Recent activity', level: 2 })).toBeNull();
    expect(document.querySelector('.panels.wide-right')).toHaveClass('single');
  });

  it('has no second row of panels at all when the backend serves neither', async () => {
    mount();

    await waitFor(() => expect(document.querySelector('.tiles')).not.toBeNull());

    expect(document.querySelectorAll('.panels')).toHaveLength(1);
  });
});

describe('Overview: without the stats capability', () => {
  it('asks again as soon as /about says the backend can count', async () => {
    const onStats = vi.fn();
    const rendered = mount({ capabilities: {}, onStats });

    // Every screen renders before /about has answered, and every capability is false until it has
    await waitFor(() => expect(screen.getByRole('heading', { name: NO_STATS_TITLE })).toBeInTheDocument());

    expect(onStats).not.toHaveBeenCalled();

    appOf(rendered).about = normalizeAbout({
      hubName: 'DurableFunctionsHub',
      capabilities: { stats: true } as Capabilities,
    });

    await waitFor(() => expect(onStats).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.querySelector('.tiles')).not.toBeNull());
  });

  it('says what is missing and where the app still works, and asks the backend nothing', async () => {
    const onStats = vi.fn();

    mount({ capabilities: {}, onStats });

    expect(screen.getByRole('heading', { name: NO_STATS_TITLE })).toBeInTheDocument();
    expect(screen.getByText(NO_STATS_TEXT)).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Instances' }).click();

    expect(onStats).not.toHaveBeenCalled();
  });
});
