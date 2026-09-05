// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Entities screen against the real host (E10-S3-T1): the entities `/entities` (B4) lists with
// their state parsed, the filters that narrow them, and the two things that can be done to one.
//
// The entity this spec signals and purges is its own - it seeds it and deletes it again - because a
// purge removes an entity for good, and the two seeded counters are what other specs read.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectToast, gotoHub, hub, typeInto } from './fixtures';
import { ENTITY_INSTANCE_ID, buildEntityInstance } from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** The key half of `@counter@warehouse-07`, which is what the table shows and the filter matches. */
const SEEDED_KEY = ENTITY_INSTANCE_ID.split('@')[2];

/** The entity this spec owns, signals and finally purges. */
const OWNED_KEY = `e2e-${Date.now()}`;
const OWNED_ID = `@counter@${OWNED_KEY}`;

test.beforeAll(async () => {
  await seedInstances({ hub, instances: [buildEntityInstance(OWNED_ID, { value: 42 })] });
});

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: [OWNED_ID] });
});

function rows(page: Page): Locator {
  return page.locator('.tbl tbody tr');
}

/** The row of one entity, by the key its second cell shows. */
function row(page: Page, key: string): Locator {
  return rows(page).filter({ has: page.getByRole('button', { name: key, exact: true }) });
}

test('lists the entities of the hub with their state parsed', async ({ page }) => {
  await gotoHub(page, 'entities');

  await expect(page.getByRole('heading', { name: 'Entities', level: 1 })).toBeVisible();
  await expect(row(page, SEEDED_KEY)).toHaveCount(1);

  const cells = row(page, SEEDED_KEY).locator('td');

  // The name is the `@name@` part of the id, which is lower case, and every entity is one
  await expect(cells.nth(1)).toContainText('counter');
  await expect(cells.nth(1).locator('.chip.kind-entity')).toHaveText('entity');

  // The state as one line, out of the framework's envelope (ScreenEntities.dc.html L46)
  await expect(cells.nth(3)).toHaveText('{"value":1284}');
  await expect(cells.nth(5)).toHaveText('Running');

  // The hub's own numbers, from /stats, and what the state column is
  await expect(page.locator('.ptitle .meta')).toHaveText(/^\d+ durable entities · \d+ entity names?$/);
  await expect(page.locator('.tfoot .meta')).toContainText(
    'state is the first line of the entity row, full state in the peek panel',
  );
});

test('narrows the list to a key prefix', async ({ page }) => {
  await gotoHub(page, 'entities');

  await expect(row(page, OWNED_KEY)).toHaveCount(1);

  await page.getByRole('textbox', { name: 'Key starts with' }).fill('warehouse-0');
  await page.getByRole('textbox', { name: 'Key starts with' }).press('Enter');

  await expect(page).toHaveURL(/key=warehouse-0/);

  // Only `@counter@warehouse-07` starts with it - not warehouse-12, and not this spec's own entity
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, SEEDED_KEY)).toHaveCount(1);

  // ...and the name facet filters by the one name the hub has
  await page.getByRole('button', { name: '+ entity name' }).click();
  await page.getByRole('menuitem', { name: /^counter/ }).click();

  await expect(page).toHaveURL(/name=counter/);
  await expect(row(page, SEEDED_KEY)).toHaveCount(1);
});

test('opens the whole state in the peek panel', async ({ page }) => {
  await gotoHub(page, 'entities');

  await row(page, SEEDED_KEY).locator('td').nth(3).getByRole('button').click();

  const peek = page.getByRole('dialog', { name: 'Instance peek' });

  await expect(peek).toBeVisible();
  await expect(peek.locator('.phead .mono').first()).toHaveText(ENTITY_INSTANCE_ID);

  // Pretty-printed and fully expanded, as every JSON value in the UI is (contracts §9)
  await expect(peek.locator('pre')).toHaveText('{\n  "value": 1284\n}');
});

test('signals an entity, and purges the one it owns', async ({ page }) => {
  await gotoHub(page, 'entities');

  const mine = row(page, OWNED_KEY);

  await expect(mine).toHaveCount(1);
  await expect(mine.locator('td').nth(3)).toHaveText('{"value":42}');

  await mine.getByRole('button', { name: 'Signal' }).click();

  const signal = page.getByRole('dialog', { name: `Send signal to ${OWNED_KEY}` });

  await expect(signal).toContainText('Raises an operation on the entity.');

  await signal.getByLabel('Signal name').fill('add');
  await typeInto(signal.locator('.jse-theme-dfm .cm-content'), page, '{"amount":5}');
  await signal.getByRole('button', { name: 'Send signal' }).click();

  // The signal is queued for the entity - the monitor has no worker of its own to run it
  await expectToast(page, `Signal sent to ${OWNED_KEY}`);

  await mine.getByRole('button', { name: 'Purge' }).click();

  const purge = page.getByRole('dialog', { name: `Purge ${OWNED_KEY}` });

  await expect(purge).toContainText('Removes the entity row and its history.');

  await purge.getByRole('button', { name: 'Purge entity' }).click();

  await expectToast(page, `Purged ${OWNED_ID}`);

  // A purge is not queued: the row is gone from the hub, and the screen reloads without it
  await expect(row(page, OWNED_KEY)).toHaveCount(0);
  await expect(row(page, SEEDED_KEY)).toHaveCount(1);
});

test('says when a window holds no entity at all', async ({ page }) => {
  await gotoHub(page, 'entities');

  await expect(rows(page).first()).toBeVisible();

  await page.getByRole('button', { name: 'Updated in' }).click();
  await page.getByRole('option', { name: 'Updated in the last 24 hours' }).click();

  await expect(page).toHaveURL(/updated=24h/);

  // Every seeded entity was last touched days ago
  await expect(page.getByRole('heading', { name: 'No entities' })).toBeVisible();
  await expect(page.locator('.empty p')).toHaveText(
    'No durable entity matches these filters. Clear the name chip or the key prefix.',
  );
});
