// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Storage screen against the real host (E10-S3-T1): what `/storage` (B4) reports about the
// seeded task hub - its taskhub.json, its five queues, and the partition leases the seed writes into
// `{hub}Partitions` the way the framework's table partition manager writes them.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoHub, hub } from './fixtures';

const PREFIX = hub.toLowerCase();

function table(page: Page, name: string): Locator {
  return page.getByRole('table', { name });
}

function cellsOf(row: Locator): Locator {
  return row.locator('td');
}

test('reports the task hub the suite runs against', async ({ page }) => {
  await gotoHub(page, 'storage');

  await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();

  // The provider, and where this hub lives. Azurite's account has no name, so the hub stands alone
  await expect(page.locator('.ptitle .chip')).toHaveText('Azure Storage');
  await expect(page.locator('.ptitle .mono.muted')).toHaveText(hub);
  await expect(page.locator('.ptitle .fine.muted')).toHaveText(/^refreshed (just now|\d+ s ago)$/);

  const values = page.locator('.two.storage .panel dl.kv').first().locator('dd');

  await expect(values.nth(0)).toHaveText(hub);
  await expect(values.nth(1)).toHaveText('4');
  await expect(values.nth(2)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  // The large-message container the seed writes payloads into
  await expect(values.nth(5)).toContainText(`${PREFIX}-largemessages`);
  await expect(values.nth(5).locator('.chip')).toHaveText('exists');

  // ...and the four tables of the hub, named as the framework names them
  const tables = page.locator('.two.storage .panel dl.kv').nth(1).locator('dd');

  await expect(tables.nth(0)).toHaveText(`${hub}Instances`);
  await expect(tables.nth(1)).toHaveText(`${hub}History`);
  await expect(tables.nth(2)).toHaveText(`${hub}Partitions`);
});

test('counts the rows of the two big tables when asked, and not before', async ({ page }) => {
  const asked: string[] = [];

  page.on('request', (request) => {
    // The API call, not the navigation to the screen of the same name
    if (request.method() === 'GET' && /\/a\/p\/i\/[^/]+\/storage/.test(request.url())) {
      asked.push(request.url());
    }
  });

  await gotoHub(page, 'storage');

  const values = page.locator('.two.storage .panel dl.kv').first().locator('dd');

  // Counting is a scan of both tables, so the screen opens without one
  await expect(values.nth(3)).toContainText('—');
  await expect(asked).toHaveLength(1);
  expect(asked[0]).not.toContain('counts=true');

  await page.getByRole('button', { name: 'Count rows' }).click();

  await expect(values.nth(3)).toHaveText(/^[\d,]+ rows Count rows$/);
  await expect(values.nth(4)).toHaveText(/^[\d,]+ rows$/);

  expect(asked.at(-1)).toContain('counts=true');

  // A plain refresh brings no counts back, and the ones on screen stay the last true ones
  const counted = await values.nth(4).textContent();

  // The screen's own button, not the top bar's Auto-refresh select
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  await expect.poll(() => asked.length).toBeGreaterThan(2);
  expect(asked.at(-1)).not.toContain('counts=true');
  await expect(values.nth(4)).toHaveText(counted ?? '');
});

test('lists the queues of the hub and says what each depth means', async ({ page }) => {
  await gotoHub(page, 'storage');

  const queues = table(page, 'Queues').locator('tbody tr');

  await expect(queues).toHaveCount(5);

  // The activities queue first, then one control queue per partition (ScreenStorage.dc.html L36-L40)
  await expect(cellsOf(queues.nth(0)).nth(0)).toHaveText(`${PREFIX}-workitems`);
  await expect(cellsOf(queues.nth(0)).nth(2)).toContainText('Activities waiting for a worker.');

  for (const partition of [0, 1, 2, 3]) {
    const control = queues.nth(partition + 1);
    const number = String(partition).padStart(2, '0');

    await expect(cellsOf(control).nth(0)).toHaveText(`${PREFIX}-control-${number}`);
    await expect(cellsOf(control).nth(1)).toHaveText(/^[\d,]+$/);
    await expect(cellsOf(control).nth(2)).toHaveText(
      new RegExp(`^(Idle\\.|Orchestrator messages for partition ${number}\\.)$`),
    );
  }
});

test('says which worker holds which partition', async ({ page }) => {
  await gotoHub(page, 'storage');

  const partitions = table(page, 'Partitions').locator('tbody tr');

  await expect(partitions).toHaveCount(4);

  // The leases the seed writes: two workers, two partitions each, one hand-over in progress
  await expect(cellsOf(partitions.nth(0)).nth(0)).toHaveText('control-00');
  await expect(cellsOf(partitions.nth(0)).nth(1)).toHaveText('dfm-orders-prod_ffe2');
  await expect(cellsOf(partitions.nth(0)).nth(2)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await expect(cellsOf(partitions.nth(0)).nth(3)).toHaveText('no');

  const draining = cellsOf(partitions.nth(2)).nth(3);

  await expect(draining).toHaveText('yes → dfm-orders-prod_ffe2');
  await expect(draining.locator('.chip')).toHaveClass(/st-suspended/);

  await expect(page.locator('.tfoot .meta')).toHaveText(
    `Ownership from the ${hub}Partitions table; lease blobs are the fallback on older hubs.`,
  );

  // ...and the way back to the backlog these queues explain
  await page.getByRole('button', { name: 'Backlog on Overview' }).click();

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
});
