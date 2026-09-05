// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Global Vitest setup, loaded once per test file via vite.config.ts `test.setupFiles`
// (docs/plans/svelte-rewrite/E3-test-harness.md E3-S1-T1). Keep this file infra-only:
// component-specific mocks belong in the test that needs them.

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// tsconfig.json limits `types` to svelte + vite/client, so Node globals are not ambient here;
// `process` is a real Vitest/Node global at runtime, this just gives it a minimal local type.
declare const process: { env: Record<string, string | undefined> };

// jsdom has no notion of a machine timezone; without pinning one, `fmtDateTime`/
// `fmtAgo`/`fmtDurationClock` tests would pass locally and fail (or vice versa) in
// CI depending on the runner's TZ. Etc/GMT-2 is UTC+2 (POSIX `Etc/GMT` signs are
// inverted from common usage) - deliberately not UTC, so a test that hard-codes
// UTC by mistake fails loudly, and deliberately not a real-world DST zone, so
// results stay stable across the calendar.
process.env.TZ = 'Etc/GMT-2';

// jsdom does not implement window.matchMedia; components/hooks that read prefers-color-scheme
// or other media queries (mode-watcher, responsive table/card switches) would throw
// "not implemented" without this.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom does not implement ResizeObserver; svelte-virtual and any measured-size
// component would throw a ReferenceError when constructing one.
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom does not implement IntersectionObserver either (used by "load more"/lazy panels).
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

// jsdom prints a "not implemented" console error for window.scrollTo; components that
// scroll a panel into view (Inputs tab `seq` deep link) would otherwise spam test output.
if (!window.scrollTo) {
  window.scrollTo = vi.fn();
}

// jsdom has no Clipboard API; copy-to-clipboard buttons (instance id, JSON viewer) need one.
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  configurable: true,
  writable: true,
});

// The seven globals index.html injects (contracts §2/§3) that src/lib/host.svelte.ts
// reads once at module-evaluation time. Tests that simulate a host (browser vs VS
// Code) set these before dynamically re-importing host.svelte.ts with `vi.resetModules()`;
// resetGlobals() clears them so one test's globals never leak into the next.
const HOST_GLOBAL_KEYS = [
  'DfmRoutePrefix',
  'DfmApiRoutePrefix',
  'DfmClientConfig',
  'DfmViewMode',
  'IsFunctionGraphAvailable',
  'OrchestrationIdFromVsCode',
  'StateFromVsCode',
] as const;

export function resetGlobals(): void {
  for (const key of HOST_GLOBAL_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  resetGlobals();
});
