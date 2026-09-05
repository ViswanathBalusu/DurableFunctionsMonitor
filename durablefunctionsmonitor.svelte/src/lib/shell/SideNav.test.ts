// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { NoCapabilities } from '$lib/api/endpoints';
import type { Host } from '$lib/host.svelte';
import { NAV_ITEMS, activeNavId, visibleNavItems } from './nav-items';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

const host = { functionGraphAvailable: false } as Host;

describe('nav-items', () => {
  it('lists the screens in the order the mockup draws them', () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      'overview',
      'instances',
      'failures',
      'entities',
      'functions',
      'storage',
      'activity',
    ]);
  });

  it('shows only what the backend can actually serve', () => {
    const ids = visibleNavItems(NoCapabilities, host).map((item) => item.id);

    // Overview, Instances and Entities need no capability; the rest do
    expect(ids).toEqual(['overview', 'instances', 'entities']);
  });

  it('adds each screen as its capability arrives', () => {
    const all = visibleNavItems(
      { ...NoCapabilities, failures: true, stats: true, storageHealth: true, audit: true },
      host,
    );

    expect(all.map((item) => item.id)).toEqual(NAV_ITEMS.map((item) => item.id));
  });

  it('shows Functions for the graph alone, without /stats', () => {
    const ids = visibleNavItems(NoCapabilities, { ...host, functionGraphAvailable: true } as Host).map((i) => i.id);

    expect(ids).toContain('functions');
  });

  it('lights up Instances while the workspace is open', () => {
    expect(activeNavId('instance')).toBe('instances');
    expect(activeNavId('failures')).toBe('failures');
  });
});

describe('SideNav', () => {
  /**
   * The shell draws the side nav and the bottom nav at once - which one the user sees is the
   * stylesheet's business, and jsdom applies no media query - so these queries stay inside `nav.snav`.
   */
  const sideNav = () => within(document.querySelector('nav.snav') as HTMLElement);

  it('renders the brand and the items a bare backend supports', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(document.querySelector('nav.snav .brand .lbl')?.textContent).toBe('DFM');

    expect(sideNav().getByRole('button', { name: 'Overview' })).toHaveClass('item');
    expect(sideNav().getByRole('button', { name: 'Settings' })).toBeInTheDocument();

    // No /about yet, so no capability is on and the gated screens are absent from the DOM
    expect(sideNav().queryByRole('button', { name: 'Activity' })).toBeNull();
    expect(sideNav().queryByRole('button', { name: 'Failures' })).toBeNull();
  });

  it('adds the gated screens once /about announces them', () => {
    render(ShellHarness, {
      props: {
        path: '/DurableFunctionsHub',
        capabilities: { failures: true, storageHealth: true, audit: true, stats: true },
      },
    });

    for (const name of ['Failures', 'Functions', 'Storage', 'Activity']) {
      // Exact names: the hub switcher's button is called "DurableFunctionsHub"
      expect(sideNav().getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the current screen', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub/entities' } });

    const entities = sideNav().getByRole('button', { name: 'Entities' });
    expect(entities).toHaveClass('active');
    expect(entities.getAttribute('aria-current')).toBe('page');
  });

  it('keeps Instances lit while the workspace is open', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub/instances/order-1' } });

    expect(sideNav().getByRole('button', { name: 'Instances' })).toHaveClass('active');
  });

  it('navigates on click', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await fireEvent.click(sideNav().getByRole('button', { name: 'Entities' }));

    expect(window.location.pathname).toBe('/DurableFunctionsHub/entities');
    expect(await screen.findByRole('heading', { name: 'Entities', level: 1 })).toBeInTheDocument();
  });

  it('collapses and expands, and the shell follows', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    expect(document.querySelector('.shell')).not.toHaveClass('collapsed');

    await fireEvent.click(sideNav().getByRole('button', { name: 'Collapse' }));

    expect(document.querySelector('.shell')).toHaveClass('collapsed');
    expect(sideNav().getByRole('button', { name: 'Collapse' }).getAttribute('title')).toBe('Expand');
  });

  it('shows the failure count when there is one', () => {
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', capabilities: { failures: true }, failuresCount: 9 },
    });

    const badge = sideNav().getByRole('button', { name: 'Failures 9' }).querySelector('.cnt');
    expect(badge?.textContent).toBe('9');
    expect(badge).toHaveClass('st-failed');
  });
});
