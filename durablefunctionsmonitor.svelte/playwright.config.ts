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

/**
 * A second host of the same build, running the deployment whose switches are turned down:
 * `DFM_DANGEROUS_OPERATIONS_ENABLED=false` and a `DFM_STATS_CAP` of five rows. Neither is something
 * a spec can fake - /about says the first, and the backend refuses the two dangerous operations with
 * a reason naming the environment variable; the second is what makes /stats answer `partial: true`,
 * which is the banner the Overview screen shows over numbers that are a lower bound. So the suite
 * runs a second host, and two projects point at it.
 */
const dangerousOffPort = Number(process.env.DFM_E2E_PORT_DANGEROUS_OFF ?? port + 1);

export const dangerousOffBaseURL = `http://localhost:${dangerousOffPort}/durable-functions-monitor/`;

/** How many rows that host scans before it gives up and reports what it has (B1's DFM_STATS_CAP). */
export const STATS_CAP = '5';

/** What the webServer waits for: /about answers only once the host is really up. */
const readyUrl = `${baseURL}a/p/i/--${hub}/about`;
const dangerousOffReadyUrl = `${dangerousOffBaseURL}a/p/i/--${hub}/about`;

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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/*.mobile.spec.ts', '**/*.dangerous-off.spec.ts', '**/*.capped.spec.ts'],
    },
    // The same UI against the host that has dangerous operations switched off
    {
      name: 'dangerous-off',
      use: { ...devices['Desktop Chrome'], baseURL: dangerousOffBaseURL },
      testMatch: '**/*.dangerous-off.spec.ts',
    },
    // The same host again, for the specs that need a backend which stops counting early
    {
      name: 'stats-capped',
      use: { ...devices['Desktop Chrome'], baseURL: dangerousOffBaseURL },
      testMatch: '**/*.capped.spec.ts',
    },
    // 390px wide, and only the specs written for it: the bottom nav, the More sheet and the stacked
    // table cards are what lives below 768px (contracts §14)
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testMatch: '**/*.mobile.spec.ts',
    },
  ],

  globalSetup: './tests/e2e/global-setup.ts',

  webServer: [
    {
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
    {
      // `--no-build`: two builds of the same project at once fight over the output dll, and this
      // host is the same build serving the same statics with one environment variable turned off
      command: `node ../scripts/harness/start-host.mjs --port=${dangerousOffPort} --no-build`,
      url: dangerousOffReadyUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DFM_NONCE: process.env.DFM_NONCE ?? 'i_sure_know_what_i_am_doing',
        DFM_DANGEROUS_OPERATIONS_ENABLED: 'false',
        DFM_AUDIT_ENABLED: process.env.DFM_AUDIT_ENABLED ?? 'true',
        // Low enough that the seeded hub does not fit in it, which is what `partial` means
        DFM_STATS_CAP: STATS_CAP,
        DFM_E2E_HUB: hub,
      },
    },
  ],
});
