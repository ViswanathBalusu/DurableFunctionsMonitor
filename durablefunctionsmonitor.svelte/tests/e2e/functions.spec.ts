// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Functions screen against the real host (E7-S4-T1): the orchestrators of the range as a table
// and as a graph, and the one selection they share.
//
// The graph needs a function map, which the seed publishes as a blob the host reads once at startup
// (`durable-functions-monitor/function-maps/dfm-func-map.json`). A host that has none serves
// `IsFunctionGraphAvailable=0` and there is no graph to assert, so those specs say so and skip.

import { expect, test, type Page } from '@playwright/test';
import { gotoHub, hub } from './fixtures';
import { ORCHESTRATORS } from './seed/fixtures.mjs';

/** Whether this host published a function map, which is what the graph half needs. */
async function hasGraph(page: Page): Promise<boolean> {
  return (await page.locator('.graph, [role="group"][aria-label="Layout"]').count()) > 0;
}

test('lists every orchestrator of the range, and says what it cannot count', async ({ page }) => {
  await gotoHub(page, 'functions');

  await expect(page.getByRole('heading', { name: 'Functions', level: 1 })).toBeVisible();

  const headers = page.locator('table.tbl thead th');

  await expect(headers).toHaveText([
    '',
    'orchestrator',
    'started',
    'completed',
    'failed',
    'rate',
    'p50',
    'p95',
    'last failure',
  ]);

  // The header is drawn before /stats answers, so the rows are what this waits for
  await expect(page.locator('tbody tr').first()).toBeVisible();

  const names = await page.locator('tbody td[data-label="orchestrator"]').allTextContents();

  expect(names.join(' ')).toContain(ORCHESTRATORS.processOrder);

  // The spine of every row is the orchestrator node colour, not a runtime status
  await expect(page.locator('tbody td.spine').first()).toHaveAttribute('style', /--node-orchestrator/);

  await expect(page.locator('.tfoot .meta')).toContainText('Activity-level numbers need history scans');
  await expect(page.locator('.tfoot .fine.muted')).toHaveText(/^scanned [\d,]+ · full$/);
});

test('opens the instances of the orchestrator whose name was clicked', async ({ page }) => {
  await gotoHub(page, 'functions');

  await page.getByRole('button', { name: ORCHESTRATORS.processOrder, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`name=${ORCHESTRATORS.processOrder}`));
  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();
});

test('carries one selection between the table and the graph', async ({ page }) => {
  await gotoHub(page, 'functions');

  test.skip(!(await hasGraph(page)), 'this host publishes no function map');

  const row = page
    .locator('tbody tr')
    .filter({ has: page.getByRole('button', { name: ORCHESTRATORS.processOrder, exact: true }) });

  await row.click();

  await expect(page).toHaveURL(new RegExp(`selected=${ORCHESTRATORS.processOrder}`));
  await expect(row).toHaveClass(/\bhl\b/);

  // The card of the same function is the one the graph has picked out
  const card = page.locator('.graph .node').filter({ hasText: ORCHESTRATORS.processOrder });

  await expect(card).toHaveClass(/\bsel\b/);
});

test('shows one half at a time, and says which in the URL', async ({ page }) => {
  await gotoHub(page, 'functions');

  test.skip(!(await hasGraph(page)), 'this host publishes no function map');

  const layout = page.getByRole('group', { name: 'Layout' });

  await layout.getByRole('button', { name: 'Table' }).click();

  await expect(page).toHaveURL(/layout=table/);
  await expect(page.locator('.graph')).toHaveCount(0);
  await expect(page.locator('table.tbl')).toBeVisible();
  await expect(page.locator('.page > .two')).toHaveClass(/\bsingle\b/);

  await layout.getByRole('button', { name: 'Graph' }).click();

  await expect(page).toHaveURL(/layout=graph/);
  await expect(page.locator('table.tbl')).toHaveCount(0);
  await expect(page.locator('.graph')).toBeVisible();

  // A link carries the layout it was copied with
  await page.reload();

  await expect(page.locator('table.tbl')).toHaveCount(0);
});

test('draws the hub the map describes, with the counters the range gave it', async ({ page }) => {
  await gotoHub(page, 'functions');

  test.skip(!(await hasGraph(page)), 'this host publishes no function map');

  await expect(page.locator('.graph .node').first()).toBeVisible();

  const orchestrator = page.locator('.graph .node').filter({ hasText: ORCHESTRATORS.processOrder });

  await expect(orchestrator).toHaveClass(/n-orchestrator/);
  await expect(orchestrator.locator('.metrics .mini')).toHaveCount(3);

  // The sub-orchestration of the seeded hub is drawn as one, not as another orchestrator
  await expect(page.locator('.graph .n-suborchestrator').first()).toBeVisible();
  await expect(page.locator('.graph .n-entity').first()).toBeVisible();

  // The seven kinds of card, named under the picture
  await expect(page.locator('.legend > span')).toHaveText([
    'HTTP',
    'timer',
    'queue / Service Bus',
    'orchestrator',
    'activity',
    'sub-orchestrator',
    'entity',
  ]);
});

test('saves the picture as a file named after the hub', async ({ page }) => {
  await gotoHub(page, 'functions');

  test.skip(!(await hasGraph(page)), 'this host publishes no function map');

  await expect(page.locator('.graph .node').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as SVG' }).click(),
  ]);

  expect(download.suggestedFilename()).toBe(`${hub}-functions.svg`);
});
