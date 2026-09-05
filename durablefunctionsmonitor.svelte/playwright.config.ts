// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The end-to-end suite runs against the real standalone host on Azurite (E3-S2-T3): the seeded task
// hub of tests/e2e/seed, the built UI it serves from DfmStatics, and no mocks anywhere. Auth is off
// through DFM_NONCE, so there is no sign-in step.

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.DFM_E2E_PORT ?? 7072);
const hub = process.env.DFM_E2E_HUB ?? 'DurableFunctionsHub';

/**
 * Everything the app serves lives under the host's own route prefix, and the trailing slash is load
 * bearing: Playwright resolves a spec's path with `new URL(path, baseURL)`, so a leading slash would
 * throw the prefix away and a base without the slash would eat its own last segment. Every path in a
 * spec is therefore relative - `hubPath()` in tests/e2e/fixtures.ts builds them that way.
 */
export const baseURL = process.env.DFM_E2E_BASE_URL ?? `http://localhost:${port}/durable-functions-monitor/`;

/** What the webServer waits for: /about answers only once the host is really up. */
const readyUrl = `${baseURL}a/p/i/--${hub}/about`;

export default defineConfig({
  testDir: 'tests/e2e',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // The host answers /about only with the nonce header; the page itself sends it from DfmClientConfig
    extraHTTPHeaders: { 'x-dfm-nonce': process.env.DFM_NONCE ?? 'i_sure_know_what_i_am_doing' },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/*.mobile.spec.ts' },
    // 390px wide, and only the specs written for it: the bottom nav, the More sheet and the stacked
    // table cards are what lives below 768px (contracts §14)
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testMatch: '**/*.mobile.spec.ts',
    },
  ],

  globalSetup: './tests/e2e/global-setup.ts',

  webServer: {
    command: 'node ../scripts/harness/start-host.mjs',
    url: readyUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DFM_NONCE: process.env.DFM_NONCE ?? 'i_sure_know_what_i_am_doing',
      DFM_DANGEROUS_OPERATIONS_ENABLED: process.env.DFM_DANGEROUS_OPERATIONS_ENABLED ?? 'true',
      DFM_AUDIT_ENABLED: process.env.DFM_AUDIT_ENABLED ?? 'true',
      DFM_E2E_HUB: hub,
    },
  },
});
