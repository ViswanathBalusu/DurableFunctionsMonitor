// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ShellHarness from '../../../tests/unit/harnesses/ShellHarness.svelte';

function bottomButtons(): string[] {
  return Array.from(document.querySelectorAll('nav.bottom-nav > button')).map((b) => b.textContent?.trim() ?? '');
}

describe('BottomNav', () => {
  it('is five slots: four screens and More', () => {
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', capabilities: { failures: true, storageHealth: true } },
    });

    expect(bottomButtons()).toEqual(['Overview', 'Instances', 'Failures', 'Entities', 'More']);
  });

  it('moves the next screen up when a capability hides one', () => {
    // No failures capability: Entities and Functions move into the free slots
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', capabilities: { stats: true } } });

    expect(bottomButtons()).toEqual(['Overview', 'Instances', 'Entities', 'Functions', 'More']);
  });

  it('marks the screen the user is on', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub/entities' } });

    const entities = document.querySelector('nav.bottom-nav > button.active');
    expect(entities?.textContent?.trim()).toBe('Entities');
  });

  it('lights up More when the current screen lives inside it', () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub/settings' } });

    const more = Array.from(document.querySelectorAll('nav.bottom-nav > button')).at(-1);
    expect(more).toHaveClass('active');
  });

  it('shows the failure count over its slot', () => {
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', capabilities: { failures: true }, failuresCount: 9 },
    });

    const badge = document.querySelector('nav.bottom-nav .bcnt');
    expect(badge?.textContent).toBe('9');
  });

  it('navigates on tap', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    const entities = Array.from(document.querySelectorAll('nav.bottom-nav > button')).find((b) =>
      b.textContent?.includes('Entities'),
    ) as HTMLElement;

    await fireEvent.click(entities);

    expect(window.location.pathname).toBe('/DurableFunctionsHub/entities');
  });
});

describe('MoreSheet', () => {
  async function openSheet() {
    const more = Array.from(document.querySelectorAll('nav.bottom-nav > button')).at(-1) as HTMLElement;
    await fireEvent.click(more);
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());
  }

  it('holds what the bottom nav could not fit, still capability-gated', async () => {
    render(ShellHarness, {
      props: {
        path: '/DurableFunctionsHub',
        capabilities: { failures: true, stats: true, storageHealth: true, audit: true },
        onOpenPalette: () => {},
      },
    });

    await openSheet();

    const items = Array.from(document.querySelectorAll('.sheet [role="menuitem"]')).map(
      (item) => item.textContent?.trim().split('theme')[0].trim() ?? '',
    );

    expect(items).toEqual([
      'Functions',
      'Storage',
      'Activity',
      'Settings',
      'Command palette',
      'Switch hub or sign out',
    ]);
  });

  it('leaves out the screens the backend cannot serve', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', capabilities: { failures: true } } });

    await openSheet();

    expect(screen.queryByRole('menuitem', { name: 'Storage' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Activity' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeInTheDocument();
  });

  it('says what Settings holds', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openSheet();

    expect(screen.getByRole('menuitem', { name: /Settings/ }).textContent).toContain('theme, mode, density');
  });

  it('navigates and closes', async () => {
    // Storage is the fifth screen here, so it is the sheet that holds it
    render(ShellHarness, {
      props: { path: '/DurableFunctionsHub', capabilities: { failures: true, storageHealth: true } },
    });

    await openSheet();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Storage' }));

    expect(window.location.pathname).toBe('/DurableFunctionsHub/storage');
    await waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
  });

  it('closes on Escape', async () => {
    render(ShellHarness, { props: { path: '/DurableFunctionsHub' } });

    await openSheet();
    await fireEvent.keyDown(document.querySelector('.sheet') as Element, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
  });

  it('opens the palette from the sheet', async () => {
    const onOpenPalette = vi.fn();
    render(ShellHarness, { props: { path: '/DurableFunctionsHub', onOpenPalette } });

    await openSheet();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Command palette' }));

    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
