// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '../host.svelte';
import type { PrefsFields } from '../storage/prefs-storage';
import type { ITypedLocalStorage } from '../storage/typed-local-storage';
import { THEMES } from '../themes';
import { Prefs, defaultThresholds, themeNames } from './prefs.svelte';

/** An in-memory ITypedLocalStorage, so a test can seed and read back what was persisted. */
function fakeStorage(seed: Partial<Record<keyof PrefsFields, string>> = {}) {
  const values = new Map<string, string>(Object.entries(seed) as [string, string][]);

  const storage: ITypedLocalStorage<PrefsFields> = {
    setItem: (field, value) => void values.set(field, value),
    setItems: (items) => {
      for (const item of items) {
        if (item.value === null) {
          values.delete(item.fieldName);
        } else {
          values.set(item.fieldName, item.value);
        }
      }
    },
    getItem: (field) => values.get(field) ?? null,
    removeItem: (field) => void values.delete(field),
  };

  return { storage, values };
}

function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    kind: 'browser',
    vsCodeApi: null,
    routePrefix: '',
    apiRoutePrefix: 'a/p/i',
    clientConfig: {},
    viewMode: 0,
    functionGraphAvailable: false,
    orchestrationIdFromVsCode: '',
    stateFromVsCode: {},
    ...overrides,
  };
}

/** Makes `prefers-color-scheme: dark` answer whatever the test needs. */
function stubPrefersDark(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? dark : !dark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('Prefs defaults', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    document.documentElement.classList.remove('dark');
  });

  it('falls back to the documented defaults on fresh storage', () => {
    const { storage } = fakeStorage();

    const prefs = new Prefs(fakeHost(), storage);

    expect(prefs.theme).toBe('poster');
    expect(prefs.mode).toBe('system');
    expect(prefs.density).toBe('compact');
    expect(prefs.showTimeAs).toBe('UTC');
    expect(prefs.navCollapsed).toBe(false);
    expect(prefs.thresholds).toEqual(defaultThresholds);
    expect(prefs.savedViews).toEqual([]);
    expect(prefs.autoRefresh).toEqual({ instances: 0, instance: 0 });
  });

  it('takes the theme and the mode the host injected when the user has chosen neither', () => {
    const { storage } = fakeStorage();

    const prefs = new Prefs(fakeHost({ clientConfig: { theme: 'dark', dfmTheme: 'blueprint' } }), storage);

    expect(prefs.theme).toBe('blueprint');
    expect(prefs.resolvedMode).toBe('dark');
  });

  it('prefers the stored choice over the injected one', () => {
    const { storage } = fakeStorage({ theme: 'hazard', mode: 'light' });

    const prefs = new Prefs(fakeHost({ clientConfig: { theme: 'dark', dfmTheme: 'blueprint' } }), storage);

    expect(prefs.theme).toBe('hazard');
    expect(prefs.resolvedMode).toBe('light');
  });

  it('ignores a stored value that is no longer a theme', () => {
    const { storage } = fakeStorage({ theme: 'neon' });

    expect(new Prefs(fakeHost(), storage).theme).toBe('poster');
  });

  it('accepts exactly the keys of THEMES, in their order', () => {
    expect(themeNames).toEqual(THEMES.map((entry) => entry.key));
  });

  it('takes showTimeAs from the host config when the user has not chosen', () => {
    const { storage } = fakeStorage();

    expect(new Prefs(fakeHost({ clientConfig: { showTimeAs: 'Local' } }), storage).showTimeAs).toBe('Local');
  });

  it('starts with the nav collapsed inside VS Code and expanded in the browser', () => {
    expect(new Prefs(fakeHost({ kind: 'vscode' }), fakeStorage().storage).navCollapsed).toBe(true);
    expect(new Prefs(fakeHost(), fakeStorage().storage).navCollapsed).toBe(false);

    // A stored choice wins over the host default
    expect(new Prefs(fakeHost({ kind: 'vscode' }), fakeStorage({ nav: 'expanded' }).storage).navCollapsed).toBe(false);
  });

  it('merges stored thresholds over the defaults', () => {
    const { storage } = fakeStorage({ thresholds: JSON.stringify({ stuckMinutes: 5 }) });

    expect(new Prefs(fakeHost(), storage).thresholds).toEqual({ ...defaultThresholds, stuckMinutes: 5 });
  });

  it('survives a preference that no longer parses', () => {
    const { storage } = fakeStorage({ thresholds: '{ not json', savedViews: 'nope' });

    const prefs = new Prefs(fakeHost(), storage);

    expect(prefs.thresholds).toEqual(defaultThresholds);
    expect(prefs.savedViews).toEqual([]);
  });

  it('reads the two auto-refresh intervals', () => {
    const { storage } = fakeStorage({ 'autoRefresh.instances': '10', 'autoRefresh.instance': '5' });

    expect(new Prefs(fakeHost(), storage).autoRefresh).toEqual({ instances: 10, instance: 5 });
  });
});

describe('resolvedMode', () => {
  it('follows the operating system when nothing else says', () => {
    stubPrefersDark(true);
    expect(new Prefs(fakeHost(), fakeStorage().storage).resolvedMode).toBe('dark');

    stubPrefersDark(false);
    expect(new Prefs(fakeHost(), fakeStorage().storage).resolvedMode).toBe('light');

    vi.unstubAllGlobals();
  });

  it("means 'follow VS Code' inside the webview", () => {
    const host = fakeHost({ kind: 'vscode', clientConfig: { theme: 'dark' } });

    expect(new Prefs(host, fakeStorage().storage).resolvedMode).toBe('dark');
  });
});

describe('persistence and apply()', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    document.documentElement.classList.remove('dark');
  });

  it('writes the theme and puts it on the document element', () => {
    const { storage, values } = fakeStorage();
    const prefs = new Prefs(fakeHost(), storage);

    prefs.setTheme('riso');

    expect(values.get('theme')).toBe('riso');
    expect(document.documentElement.dataset.theme).toBe('riso');
  });

  it('toggles the dark class from the resolved mode', () => {
    const { storage, values } = fakeStorage();
    const prefs = new Prefs(fakeHost(), storage);

    prefs.setMode('dark');

    expect(values.get('mode')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    prefs.setMode('light');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('writes the density onto the document element', () => {
    const { storage, values } = fakeStorage();
    const prefs = new Prefs(fakeHost(), storage);

    prefs.setDensity('comfortable');

    expect(values.get('density')).toBe('comfortable');
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });

  it('persists the remaining preferences immediately', () => {
    const { storage, values } = fakeStorage();
    const prefs = new Prefs(fakeHost(), storage);

    prefs.setShowTimeAs('Local');
    prefs.setNavCollapsed(true);
    prefs.setThresholds({ stuckMinutes: 15, pendingMinutes: 2, queueDepth: 500 });
    prefs.setSavedViews([{ name: 'Failures today', url: '/hub/instances?range=24h' }]);
    prefs.setAutoRefresh('instances', 30);

    expect(values.get('showTimeAs')).toBe('Local');
    expect(values.get('nav')).toBe('collapsed');
    expect(JSON.parse(values.get('thresholds')!)).toEqual({ stuckMinutes: 15, pendingMinutes: 2, queueDepth: 500 });
    expect(JSON.parse(values.get('savedViews')!)).toEqual([
      { name: 'Failures today', url: '/hub/instances?range=24h' },
    ]);
    expect(values.get('autoRefresh.instances')).toBe('30');

    // The other screen's interval is untouched
    expect(prefs.autoRefresh).toEqual({ instances: 30, instance: 0 });
  });

  it('reloads what it wrote', () => {
    const { storage } = fakeStorage();

    const first = new Prefs(fakeHost(), storage);
    first.setTheme('memphis');
    first.setMode('dark');
    first.setDensity('comfortable');

    const second = new Prefs(fakeHost(), storage);

    expect(second.theme).toBe('memphis');
    expect(second.mode).toBe('dark');
    expect(second.density).toBe('comfortable');
  });
});
