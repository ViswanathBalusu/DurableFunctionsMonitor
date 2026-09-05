// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from '$lib/state/app.svelte';
import { Prefs } from '$lib/state/prefs.svelte';
import { Suggestions } from '$lib/state/suggestions.svelte';
import { Palette, type PaletteOptions } from './palette.svelte';

function makeApp(path = '/DurableFunctionsHub', capabilities: Partial<Capabilities> = {}) {
  window.history.replaceState({}, '', path);

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: { idSuggestions: async () => [] } as unknown as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub', capabilities: capabilities as Capabilities });

  return app;
}

function labels(palette: Palette, group: string): string[] {
  return palette.groups.find((candidate) => candidate.name === group)?.items.map((item) => item.label) ?? [];
}

function find(palette: Palette, label: string) {
  const item = palette.items.find((candidate) => candidate.label === label);

  if (!item) {
    throw new Error(`No palette row "${label}" in: ${palette.items.map((i) => i.label).join(', ')}`);
  }

  return item;
}

function makePalette(app = makeApp(), options: PaletteOptions = {}) {
  return new Palette(app, options);
}

describe('Palette', () => {
  it('opens on an empty query and closes', () => {
    const palette = makePalette();

    expect(palette.open).toBe(false);

    palette.setQuery('order');
    palette.toggle();

    expect(palette.open).toBe(true);
    expect(palette.query).toBe('');

    palette.toggle();
    expect(palette.open).toBe(false);
  });

  it('lists the three groups of the mockup', () => {
    expect(makePalette().groups.map((group) => group.name)).toEqual(['Go to', 'Actions', 'Preferences']);
  });

  it('offers only the screens this backend can serve, with their chords', () => {
    const bare = makePalette();

    expect(labels(bare, 'Go to')).toEqual(['Overview', 'Instances', 'Entities', 'Settings']);

    const all = makePalette(
      makeApp('/DurableFunctionsHub', { failures: true, stats: true, storageHealth: true, audit: true }),
    );

    expect(labels(all, 'Go to')).toEqual([
      'Overview',
      'Instances',
      'Failures',
      'Entities',
      'Functions',
      'Storage',
      'Activity',
      'Settings',
    ]);

    expect(find(all, 'Instances').kbd).toBe('g i');
    expect(find(all, 'Failures').kbd).toBe('g f');
    expect(find(all, 'Functions').kbd).toBeUndefined();
  });

  it('goes to the screen a row names', () => {
    const app = makeApp();
    const palette = makePalette(app);

    palette.show();
    palette.run(find(palette, 'Entities'));

    expect(window.location.pathname).toBe('/DurableFunctionsHub/entities');
    expect(palette.open).toBe(false);
  });

  it('offers the instance ids the backend suggests, once the query is long enough', async () => {
    const app = makeApp();
    const suggestions = new Suggestions(
      { idSuggestions: async () => ['order-1', 'order-2'] } as unknown as Endpoints,
      0,
    );
    const palette = makePalette(app, { suggestions });

    palette.setQuery('o');
    expect(labels(palette, 'Go to')).not.toContain('Instance order-1');

    palette.setQuery('or');
    await vi.waitFor(() => expect(suggestions.items).toHaveLength(2));

    // The filter runs on the label too, and "Instance order-1" contains "or"
    expect(labels(palette, 'Go to')).toEqual(['Instance order-1', 'Instance order-2']);
  });

  it('opens a known failed instance on its Inputs tab', async () => {
    const app = makeApp();
    const suggestions = new Suggestions(
      { idSuggestions: async () => ['order-1', 'order-2'] } as unknown as Endpoints,
      0,
    );
    const palette = makePalette(app, { suggestions, isFailed: (id) => id === 'order-2' });

    palette.setQuery('order');
    await vi.waitFor(() => expect(suggestions.items).toHaveLength(2));

    expect(labels(palette, 'Go to')).toEqual(['Instance order-1', 'Instance order-2 (failed)']);

    palette.run(find(palette, 'Instance order-2 (failed)'));

    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances/order-2');
    expect(app.router.current.query.get('tab')).toBe('inputs');
  });

  it('lists the actions, and the instance pair only on the workspace', () => {
    const onInstanceAction = vi.fn();

    expect(labels(makePalette(makeApp(), { onInstanceAction }), 'Actions')).toEqual([
      'Start new instance',
      'Refresh',
      'Purge instance history…',
      'Switch task hub',
    ]);

    const workspace = makePalette(makeApp('/DurableFunctionsHub/instances/order-1'), { onInstanceAction });
    expect(labels(workspace, 'Actions')).toContain('Suspend current instance');

    const suspended = makePalette(makeApp('/DurableFunctionsHub/instances/order-1'), {
      onInstanceAction,
      instanceSuspended: () => true,
    });
    expect(labels(suspended, 'Actions')).toContain('Resume current instance');

    // Without a handler there is no confirm behind the row, so the row is not offered
    const noHandler = makePalette(makeApp('/DurableFunctionsHub/instances/order-1'));
    expect(labels(noHandler, 'Actions')).not.toContain('Suspend current instance');
  });

  it('runs the actions', () => {
    const app = makeApp();
    const load = vi.fn();
    const onSwitchHub = vi.fn();
    const onInstanceAction = vi.fn();
    const palette = makePalette(app, { onSwitchHub, onInstanceAction });

    app.onRefresh(load);
    palette.run(find(palette, 'Refresh'));
    expect(load).toHaveBeenCalledOnce();

    palette.run(find(palette, 'Switch task hub'));
    expect(onSwitchHub).toHaveBeenCalledOnce();

    palette.run(find(palette, 'Start new instance'));
    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances');
    expect(app.router.current.query.get('start')).toBe('1');

    palette.run(find(palette, 'Purge instance history…'));
    expect(window.location.pathname).toBe('/DurableFunctionsHub/settings');
  });

  it('suspends the instance the workspace is on', () => {
    const onInstanceAction = vi.fn();
    const palette = makePalette(makeApp('/DurableFunctionsHub/instances/order-1'), { onInstanceAction });

    palette.run(find(palette, 'Suspend current instance'));

    expect(onInstanceAction).toHaveBeenCalledWith('suspend');
  });

  it('lists the preferences with the current theme and range marked', () => {
    const app = makeApp('/DurableFunctionsHub?range=7d');
    const palette = makePalette(app);

    expect(labels(palette, 'Preferences')).toEqual([
      'Switch to dark mode',
      'Theme: Poster',
      'Theme: Riso',
      'Theme: Memphis',
      'Theme: Blueprint',
      'Theme: Hazard',
      'Density: comfortable rows (44 px)',
      'Time range: Last 15 minutes',
      'Time range: Last hour',
      'Time range: Last 24 hours',
      'Time range: Last 7 days',
      'Time range: Last 30 days',
      'Show time as local',
    ]);

    expect(find(palette, 'Theme: Poster').kbd).toBe('current');
    expect(find(palette, 'Theme: Riso').kbd).toBeUndefined();
    expect(find(palette, 'Time range: Last 7 days').kbd).toBe('current');
  });

  it('applies a preference and closes', () => {
    const app = makeApp();
    const palette = makePalette(app);

    palette.show();
    palette.run(find(palette, 'Theme: Riso'));

    expect(app.prefs.theme).toBe('riso');
    expect(palette.open).toBe(false);

    palette.run(find(palette, 'Switch to dark mode'));
    expect(app.prefs.resolvedMode).toBe('dark');

    // And the row now offers the way back
    expect(labels(palette, 'Preferences')[0]).toBe('Switch to light mode');
  });

  it('switches the density and the clock', () => {
    const app = makeApp();
    const palette = makePalette(app);

    palette.run(find(palette, 'Density: comfortable rows (44 px)'));
    expect(app.prefs.density).toBe('comfortable');
    expect(labels(palette, 'Preferences')).toContain('Density: compact rows (36 px)');

    palette.run(find(palette, 'Show time as local'));
    expect(app.prefs.showTimeAs).toBe('Local');
    expect(labels(palette, 'Preferences')).toContain('Show time as UTC');
  });

  it('sets the shared time range', () => {
    const app = makeApp();
    const palette = makePalette(app);

    palette.run(find(palette, 'Time range: Last 7 days'));

    expect(app.timeRange).toEqual({ preset: '7d' });
  });

  it('filters on the label, case insensitively, and drops the groups left empty', () => {
    const palette = makePalette();

    palette.setQuery('RISO');

    expect(palette.groups).toHaveLength(1);
    expect(palette.groups[0].name).toBe('Preferences');
    expect(palette.groups[0].items.map((item) => item.label)).toEqual(['Theme: Riso']);
  });

  it('has nothing to show for a query nothing matches', () => {
    const palette = makePalette();

    palette.setQuery('zzz');

    expect(palette.groups).toEqual([]);
    expect(palette.isEmpty).toBe(true);
  });
});
