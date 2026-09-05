// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '$lib/api/client';
import { normalizeAbout, type Endpoints } from '$lib/api/endpoints';
import type { Capabilities } from '$lib/api/types';
import { host } from '$lib/host.svelte';
import { Router } from '$lib/router.svelte';
import { AppState } from '$lib/state/app.svelte';
import { Prefs } from '$lib/state/prefs.svelte';
import { CHORD_MS, installShortcuts } from './shortcuts';

function makeApp(path = '/DurableFunctionsHub', capabilities: Partial<Capabilities> = {}) {
  window.history.replaceState({}, '', path);

  const app = new AppState({
    host,
    client: {} as BackendClient,
    endpoints: {} as Endpoints,
    router: new Router({ mode: 'history', routePrefix: '' }),
    prefs: new Prefs(host, { setItem: () => {}, setItems: () => {}, getItem: () => null, removeItem: () => {} }),
  });

  app.about = normalizeAbout({ hubName: 'DurableFunctionsHub', capabilities: capabilities as Capabilities });

  return app;
}

function press(key: string, init: KeyboardEventInit & { target?: HTMLElement } = {}) {
  const { target, ...rest } = init;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest });

  (target ?? window).dispatchEvent(event);

  return event;
}

let dispose: (() => void) | null = null;

function install(app: AppState, targets: Partial<Parameters<typeof installShortcuts>[1]> = {}) {
  const calls = { focusJump: vi.fn(), togglePalette: vi.fn(), closePalette: vi.fn() };

  dispose = installShortcuts(app, { ...calls, ...targets });

  return calls;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('installShortcuts', () => {
  it('toggles the palette on Ctrl K and on ⌘ K, and swallows the browser default', () => {
    const app = makeApp();
    const calls = install(app);

    const ctrl = press('k', { ctrlKey: true });
    expect(calls.togglePalette).toHaveBeenCalledOnce();
    expect(ctrl.defaultPrevented).toBe(true);

    press('K', { metaKey: true });
    expect(calls.togglePalette).toHaveBeenCalledTimes(2);

    // Bare k is a keystroke like any other
    press('k');
    expect(calls.togglePalette).toHaveBeenCalledTimes(2);
  });

  it('focuses the instance jump on /', () => {
    const app = makeApp();
    const calls = install(app);

    const event = press('/');

    expect(calls.focusJump).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('navigates on g then o, i, f, e or s', () => {
    const app = makeApp('/DurableFunctionsHub', { failures: true });
    install(app);

    for (const [key, path] of [
      ['i', '/DurableFunctionsHub/instances'],
      ['f', '/DurableFunctionsHub/failures'],
      ['e', '/DurableFunctionsHub/entities'],
      ['s', '/DurableFunctionsHub/settings'],
      ['o', '/DurableFunctionsHub'],
    ] as const) {
      press('g');
      press(key);
      expect(window.location.pathname).toBe(path);
    }
  });

  it('forgets the g after 900 ms', () => {
    const app = makeApp();
    install(app);

    press('g');
    vi.advanceTimersByTime(CHORD_MS + 1);
    press('i');

    expect(window.location.pathname).toBe('/DurableFunctionsHub');

    // Within the window it still counts
    press('g');
    vi.advanceTimersByTime(CHORD_MS - 100);
    press('i');

    expect(window.location.pathname).toBe('/DurableFunctionsHub/instances');
  });

  it('takes only the key right after the g', () => {
    const app = makeApp();
    install(app);

    press('g');
    press('x');
    press('i');

    expect(window.location.pathname).toBe('/DurableFunctionsHub');
  });

  it('does not go to a screen this backend has no capability for', () => {
    const app = makeApp();
    install(app);

    // No /about capability for failures, so the screen is not in the nav and the chord is inert
    press('g');
    press('f');

    expect(window.location.pathname).toBe('/DurableFunctionsHub');
  });

  it('closes the peek on Escape', () => {
    const app = makeApp();
    install(app);

    app.peek.open({
      id: 'order-1',
      name: 'ProcessOrder',
      kind: 'Orchestration',
      status: 'Running',
      created: '2026-09-04T14:02:11Z',
      updated: '2026-09-04T14:02:58Z',
      duration: 47_000,
    });

    press('Escape');

    expect(app.peek.isOpen).toBe(false);
  });

  it('closes the palette before the peek', () => {
    const app = makeApp();
    const calls = install(app, { paletteOpen: () => true });

    app.peek.open({
      id: 'order-1',
      name: 'ProcessOrder',
      kind: 'Orchestration',
      status: 'Running',
      created: '2026-09-04T14:02:11Z',
      updated: '2026-09-04T14:02:58Z',
      duration: 47_000,
    });

    press('Escape');

    expect(calls.closePalette).toHaveBeenCalledOnce();
    expect(app.peek.isOpen).toBe(true);
  });

  it('leaves the peek alone while a dialog is open over it', () => {
    const app = makeApp();
    install(app);

    // bits-ui closes its own dialog on Escape; the peek behind it is not the innermost thing
    const dialog = document.createElement('div');
    dialog.setAttribute('data-slot', 'dialog-content');
    document.body.append(dialog);

    app.peek.open({
      id: 'order-1',
      name: 'ProcessOrder',
      kind: 'Orchestration',
      status: 'Running',
      created: '2026-09-04T14:02:11Z',
      updated: '2026-09-04T14:02:58Z',
      duration: 47_000,
    });

    press('Escape');

    expect(app.peek.isOpen).toBe(true);
  });

  it('stays out of the way of whatever is being typed', () => {
    const app = makeApp();
    const calls = install(app);

    for (const tag of ['input', 'textarea', 'select']) {
      const element = document.createElement(tag);
      document.body.append(element);

      press('/', { target: element });
      press('g', { target: element });
      press('i', { target: element });
    }

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not implement contentEditable's effect on isContentEditable
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(editable);

    press('/', { target: editable });

    expect(calls.focusJump).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/DurableFunctionsHub');
  });

  it('still opens the palette from inside a field', () => {
    const app = makeApp();
    const calls = install(app);

    const input = document.createElement('input');
    document.body.append(input);

    press('k', { ctrlKey: true, target: input });

    expect(calls.togglePalette).toHaveBeenCalledOnce();
  });

  it('is inert while the palette is open, apart from Ctrl K and Escape', () => {
    const app = makeApp();
    const calls = install(app, { paletteOpen: () => true });

    press('/');
    press('g');
    press('i');

    expect(calls.focusJump).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/DurableFunctionsHub');

    press('k', { ctrlKey: true });
    expect(calls.togglePalette).toHaveBeenCalledOnce();
  });

  it('is inert on the login route', () => {
    const app = makeApp('/');
    const calls = install(app);

    expect(app.router.current.name).toBe('login');

    press('/');
    press('g');
    press('i');

    expect(calls.focusJump).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('stops listening when it is disposed', () => {
    const app = makeApp();
    const calls = install(app);

    dispose?.();
    dispose = null;

    press('k', { ctrlKey: true });
    press('/');

    expect(calls.togglePalette).not.toHaveBeenCalled();
    expect(calls.focusJump).not.toHaveBeenCalled();
  });
});
