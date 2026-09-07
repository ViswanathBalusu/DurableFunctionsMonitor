// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The instance workspace against the real host and the seeded hub (E5-S9-T1): the header, the tabs
// that read the history, and the actions that really reach the task hub. Nothing is mocked - a
// failing assertion means the app and the backend disagree.
//
// The mutating specs seed an instance of their own, with an id that is new on every run: a spec that
// terminates or purges something cannot share it with the specs that read it.

import { expect, test, type Page } from '@playwright/test';
import { expectToast, gotoInstance, hub, hubPath, typeInto } from './fixtures';
import { RUNNING_INSTANCE_ID, buildRetryInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** What this file seeded, so it can take it out again: the hub is left as it was found. */
const seeded: string[] = [];

/** Seeds one failed instance of this spec's own and returns its id. */
async function seedOwnInstance(prefix: string): Promise<string> {
  const instanceId = `e2e-${prefix}-${Date.now()}`;

  await seedInstances({ hub, instances: [buildRetryInstance(instanceId, new Date())] });
  seeded.push(instanceId);

  return instanceId;
}

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: seeded });
});

function tabs(page: Page) {
  return page.locator('.tabs .tab');
}

test('opens the workspace of the running order', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  // The breadcrumb, then the hero: status tile with the running clock, the id, and the meta line
  await expect(page.getByRole('link', { name: 'Instances' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(RUNNING_INSTANCE_ID);

  const tile = page.locator('.hero .tile');

  await expect(tile).toHaveClass(/st-running/);
  await expect(tile).toContainText('Running');
  await expect(tile.locator('.mono')).toHaveText(/^\d{2}:\d{2}:\d{2}$|^\d+d /);

  const meta = page.locator('.hero .hmeta');

  await expect(meta).toContainText('ProcessOrderOrchestrator');
  await expect(meta).toContainText('created');
  await expect(meta).toContainText('updated');
  await expect(meta).toContainText('parent: none');
  await expect(meta).toContainText(/history \d+/);

  // The tabs this instance has. Summary is always in the strip and hidden above 1100px by CSS;
  // Timeline is there because this backend announces /spans; Graph because the seed publishes a
  // function map this orchestrator is on; and the last tab is the hub's own Liquid template - the
  // backend really does list one, and the app really does offer it
  const labels = (await tabs(page).allTextContents()).map((label) => label.trim());

  expect(labels.slice(0, 5)).toEqual(['Summary', 'Timeline', 'History', 'Inputs', 'Sequence']);
  expect(labels).toContain('Raw');
  expect(labels.length).toBeGreaterThan(6);
});

test('lists the history, with the input rows linking into the Inputs tab', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID, 'history');

  const rows = page.locator('table.tbl tbody tr');

  await expect(rows.first()).toBeVisible();

  // The backend collapses the 33 seeded rows into the 9 that mean something: a TaskScheduled row is
  // merged into the answer that came back, and the orchestrator's own episode markers are dropped
  await expect(rows).toHaveCount(9);
  await expect(rows.first().locator('[data-label="#"]')).toHaveText('1');
  await expect(rows.first().locator('[data-label="EventType"]')).toContainText('ExecutionStarted');
  await expect(rows.nth(1).locator('[data-label="Name"]')).toHaveText('ReserveInventory');
  await expect(rows.nth(1).locator('[data-label="Duration"]')).not.toBeEmpty();

  // Two rows carry an input: ExecutionStarted #1 and EventRaised #27
  await expect(page.locator('.tag')).toHaveCount(2);

  await expect(page.locator('.tabbody .meta').filter({ hasText: 'events shown' })).toContainText('9 events shown');
  await expect(page.locator('.tfoot .meta')).toContainText('Rewound rows arrive as GenericEvent');

  await page.locator('.tag').last().click();

  await expect(page).toHaveURL(/tab=inputs/);
  await expect(page).toHaveURL(/seq=27/);
});

test('opens a history row in the JSON viewer', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID, 'history');

  await expect(page.locator('table.tbl tbody tr').first()).toBeVisible();

  await page.locator('table.tbl tbody [data-label="Result / Details"] .link').first().click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.jse-theme-dfm')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
});

test('shows the status document in the Raw tab', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID, 'raw');

  const viewer = page.getByRole('group', { name: 'Instance status JSON' });

  await expect(viewer).toBeVisible();

  // Contracts §9: fully expanded, so the nested input is on screen without a click
  for (const key of ['instanceId', 'runtimeStatus', 'input', 'orderId']) {
    await expect(viewer).toContainText(key);
  }
});

test('draws the sequence diagram of what the instance called', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID, 'sequence');

  const parts = page.locator('.seq .part');

  await expect(parts.first()).toBeVisible();
  await expect(parts.first()).toHaveClass(/n-orchestrator/);
  await expect(parts).toContainText([
    'ProcessOrderOrchestrator',
    'ReserveInventory',
    'ChargePayment',
    'NotifyCustomer',
  ]);

  await expect(page.locator('.seq .arrow').first()).toBeVisible();
  await expect(page.locator('.seq .arrow.failed')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Copy diagram code to clipboard' })).toBeVisible();
});

test('offers a Graph tab, of the hub map where there is one and of the history where there is not', async ({
  page,
}) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  // Summary is the first tab and hidden above 1100px, so the strip is waited for on a real one
  await expect(page.getByRole('tab', { name: 'History' })).toBeVisible();

  const graph = page.getByRole('tab', { name: 'Graph' });

  // Every orchestration has one now: its own history is enough to draw a graph from
  await expect(graph).toBeVisible();

  await graph.click();
  await expect(page.locator('.graph .node').first()).toBeVisible();

  // The seed publishes a function map this orchestrator is on, so the graph is the hub's, and the
  // footer is the one that says so. A host reading a storage account with no map blob serves
  // IsFunctionGraphAvailable=0, and the footer then names the instance's history instead.
  const footer = page
    .locator('.graph')
    .locator('..')
    .getByText(/ring-colored path|Built from this instance history/);

  await expect(footer).toBeVisible();
});

test('sets the customStatus and clears it again', async ({ page }) => {
  const instanceId = await seedOwnInstance('custom');

  await gotoInstance(page, instanceId);

  await page.getByRole('button', { name: 'Set customStatus' }).click();

  const dialog = page.getByRole('dialog', { name: 'Set customStatus' });

  await expect(dialog).toBeVisible();

  // The editor opens on what the instance holds now; typing over it is what changes it
  await typeInto(dialog.locator('.jse-theme-dfm .cm-content'), page, '{"step":"Rechecked","attempt":9}');

  await dialog.getByRole('button', { name: 'Set customStatus' }).click();

  await expectToast(page, `Set customStatus sent for ${instanceId}`);

  // The workspace reloads after an action, so the summary shows what the hub now holds
  await expect(page.locator('.summary')).toContainText('Rechecked');

  // ...and the dialog is gone before the header's button is the only one of that name again
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Set customStatus' }).click();

  const clearing = page.getByRole('dialog', { name: 'Set customStatus' });

  await typeInto(clearing.locator('.jse-theme-dfm .cm-content'), page, '');
  await clearing.getByRole('button', { name: 'Set customStatus' }).click();

  await expectToast(page, `Set customStatus sent for ${instanceId}`);
  await expect(page.locator('.summary')).not.toContainText('Rechecked');
});

test('suspends an instance, and reports what the hub says about resuming it', async ({ page }) => {
  await gotoInstance(page, RUNNING_INSTANCE_ID);

  // The header's own button; the dialog's confirm is called the same thing
  await page.locator('.hero .actions').getByRole('button', { name: 'Suspend' }).click();

  const confirm = page.getByRole('dialog', { name: `Suspend ${RUNNING_INSTANCE_ID}` });

  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Timers and external events are held until you resume.');

  await confirm.getByLabel('Reason (optional)').fill('e2e');
  await confirm.getByRole('button', { name: 'Suspend' }).click();

  await expectToast(page, `Suspended ${RUNNING_INSTANCE_ID}`);

  // Nothing consumes the control queue of a seeded hub, so the suspend is only ever enqueued: the
  // instance is still Running, the header still offers Suspend, and the hub is as it was found
  await expect(page.locator('.hero .tile')).toContainText('Running');
  await expect(page.locator('.hero .actions').getByRole('button', { name: 'Suspend' })).toBeVisible();
});

test('terminates an instance of its own and says so', async ({ page }) => {
  const instanceId = await seedOwnInstance('terminate');

  await gotoInstance(page, instanceId);

  await page.getByRole('button', { name: 'Terminate' }).click();

  const confirm = page.getByRole('dialog', { name: `Terminate ${instanceId}` });

  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.warn')).toBeVisible();
  await expect(confirm).toContainText('This cannot be undone.');

  await confirm.getByLabel('Reason (optional)').fill('e2e');
  await confirm.getByRole('button', { name: 'Terminate' }).click();

  // The request reaches the hub; the status only changes once a worker picks the message up, which a
  // seeded hub has none of - so what is asserted is what actually happened
  await expectToast(page, /Terminate sent for|Failed to terminate/);
});

test('purges an instance and goes back to the list', async ({ page }) => {
  const instanceId = await seedOwnInstance('purge');

  await gotoInstance(page, instanceId);

  await page.getByRole('button', { name: 'Purge', exact: true }).click();

  const confirm = page.getByRole('dialog', { name: `Purge ${instanceId}` });

  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Removes the instance');
  await confirm.getByRole('button', { name: 'Purge instance' }).click();

  await expectToast(page, `Purged ${instanceId}`);

  await expect(page).toHaveURL(new RegExp(`${hubPath('instances')}$`));
  await expect(page.getByRole('heading', { name: 'Instances', level: 1 })).toBeVisible();
});
