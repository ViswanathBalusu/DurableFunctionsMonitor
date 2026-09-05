// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Seeds the task hub every spec runs against, before Playwright starts the host (E3-S2-T3). The
// seed is idempotent, so a repeated run costs a few upserts and changes nothing; `DFM_E2E_RESET=1`
// drops the tables first, which is what a change to the fixtures themselves needs.

import { seedHub } from './seed/seed-hub.mjs';

export default async function globalSetup(): Promise<void> {
  const reset = process.env.DFM_E2E_RESET === '1';
  const summary = await seedHub({ hub: process.env.DFM_E2E_HUB, reset });

  console.log(
    `seeded ${summary.orchestrations} orchestrations, ${summary.entities} entities, ` +
      `${summary.historyRows} history rows`,
  );

  // A second hub, so the login screen has a choice to offer on a storage account that holds one
  if (process.env.DFM_E2E_HUB2) {
    await seedHub({ hub: process.env.DFM_E2E_HUB2, reset });
    console.log(`seeded the second hub ${process.env.DFM_E2E_HUB2}`);
  }
}
