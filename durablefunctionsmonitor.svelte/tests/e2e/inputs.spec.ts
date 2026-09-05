// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The Inputs tab against the real host (E5-S9-T1): the eligibility the backend reports, the three
// operations, and what each of their outcomes does to the screen. The host this project runs against
// has DFM_DANGEROUS_OPERATIONS_ENABLED=true; the `dangerous-off` project runs the same tab against a
// second host that does not, which is the one thing this file cannot cover from here.
//
// Every spec seeds an instance of its own: these operations rewrite history, and an instance that
// has been rewound is not the instance the next spec expects to find.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectToast, gotoInstance, hub } from './fixtures';
import {
  FAILED_INSTANCE_ID,
  RETRY_EVENT_NAME,
  RETRY_EVENT_SEQUENCE_NUMBER,
  buildRetryInstance,
} from './seed/fixtures.mjs';
import { deleteInstances, seedInstances } from './seed/seed-hub.mjs';

/** What this file seeded, so it can take it out again: the hub is left as it was found. */
const seeded: string[] = [];

/** Seeds a failed instance that received one external event, and returns its id. */
async function seedRetryInstance(prefix: string): Promise<string> {
  const instanceId = `e2e-${prefix}-${Date.now()}`;

  await seedInstances({ hub, instances: [buildRetryInstance(instanceId, new Date())] });
  seeded.push(instanceId);

  return instanceId;
}

test.afterAll(async () => {
  await deleteInstances({ hub, instanceIds: seeded });
});

function cards(page: Page) {
  return page.locator('.card.icard');
}

/** The buttons of one card, with the line under each. */
async function ops(card: Locator): Promise<{ label: string; disabled: boolean; why: string }[]> {
  return card.locator('.op').evaluateAll((blocks) =>
    blocks.map((block) => ({
      label: block.querySelector('.btn')?.textContent?.trim() ?? '',
      disabled: (block.querySelector('.btn') as HTMLButtonElement).disabled,
      why: block.querySelector('.why')?.textContent?.trim() ?? '',
    })),
  );
}

/** Replaces what a card's editor holds; pasting is the one path that lands exactly this text. */
async function replaceInput(page: Page, card: Locator, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);

  const editor = card.locator('.jse-theme-dfm .cm-content');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(card.locator('.foot')).toContainText('edited');
}

test('says what the deployment allows before it says anything else', async ({ page }) => {
  await gotoInstance(page, FAILED_INSTANCE_ID, 'inputs');

  await expect(page.getByRole('heading', { name: 'Inputs this instance received', level: 2 })).toBeVisible();
  // The badge on the tab; the app bar carries a smaller one of its own (design §9)
  await expect(page.locator('.tabbody .dbadge')).toHaveText('Dangerous operations on');

  // A failed instance that received no external events: its initial input is the last one, and both
  // of the operations that act on an initial input are offered
  await expect(cards(page)).toHaveCount(1);

  const only = cards(page).first();

  expect(await ops(only)).toEqual([
    {
      label: 'Restart in place',
      disabled: false,
      why: 'Purges this instance and starts it again with the input shown.',
    },
    {
      label: 'Update input and rewind',
      disabled: false,
      why: 'Replaces this input and re-runs only the failed steps.',
    },
    {
      label: 'Replay from #1',
      disabled: true,
      why: 'Use restart-in-place to re-run the whole instance from its initial input.',
    },
  ]);

  await expect(only.locator('.seq')).toHaveText('#1');
  await expect(only.locator('.chip').filter({ hasText: 'last' })).toBeVisible();
});

test('offers the last event, and says why the first one is out of reach', async ({ page }) => {
  const instanceId = await seedRetryInstance('inputs-list');

  await gotoInstance(page, instanceId, 'inputs');

  await expect(cards(page)).toHaveCount(2);

  const [first, last] = [cards(page).nth(0), cards(page).nth(1)];

  // Every operation on the initial input is refused, each with the backend's own reason
  expect((await ops(first)).map((op) => op.disabled)).toEqual([true, true, true]);
  expect((await ops(first))[0].why).toContain('received external events');
  expect((await ops(first))[1].why).toContain('Only the last input-bearing event can be edited');
  await expect(first.locator('.ed')).toHaveClass(/ro/);

  await expect(last.locator('.seq')).toHaveText(`#${RETRY_EVENT_SEQUENCE_NUMBER}`);
  await expect(last.locator('.ev')).toHaveText('EventRaised');
  await expect(last).toContainText(RETRY_EVENT_NAME);

  const lastOps = await ops(last);

  expect(lastOps.find((op) => op.label === 'Update input and rewind')?.disabled).toBe(false);
  expect(lastOps.find((op) => op.label === `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}`)?.disabled).toBe(false);

  await expect(last.locator('.op .btn').filter({ hasText: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` })).toHaveClass(
    /danger/,
  );
});

test('updates the input and rewinds the instance', async ({ page }) => {
  const instanceId = await seedRetryInstance('inputs-update');

  await gotoInstance(page, instanceId, 'inputs');

  const last = cards(page).nth(1);

  await expect(last.locator('.foot')).toContainText('stored input');

  await replaceInput(page, last, '{"approved":true,"approver":"ops@contoso.com","amount":99.95}');

  await last.getByRole('button', { name: 'Update input and rewind' }).click();

  const dialog = page.getByRole('dialog', { name: 'Update input and rewind' });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('with your edited input');
  await expect(dialog.locator('.ed pre')).toContainText('99.95');

  await dialog.getByLabel('Reason (optional)').fill('e2e');
  await dialog.getByRole('button', { name: 'Update and rewind' }).click();

  await expectToast(page, 'Rewound with the updated input. Details, history and inputs reloaded.');

  // The list reloads after every run, and the edit is what the event now carries
  await expect(cards(page).nth(1).locator('.foot')).toContainText('stored input');
  await expect(cards(page).nth(1)).toContainText('99.95');
});

test('replays from the last event and says how much history it removed', async ({ page }) => {
  const instanceId = await seedRetryInstance('inputs-replay');

  await gotoInstance(page, instanceId, 'inputs');

  const last = cards(page).nth(1);

  await last.getByRole('button', { name: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` }).click();

  const dialog = page.getByRole('dialog', { name: `Replay from event #${RETRY_EVENT_SEQUENCE_NUMBER}` });

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.warn')).toBeVisible();
  await expect(dialog).toContainText('with the stored input');

  // A failed instance is terminal, so there is nothing to terminate before replaying
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);

  await dialog.getByRole('button', { name: `Replay from #${RETRY_EVENT_SEQUENCE_NUMBER}` }).click();

  await expectToast(page, new RegExp(`Replayed from #${RETRY_EVENT_SEQUENCE_NUMBER}, \\d+ history rows removed`));
});

test('reloads the list and says so when the history moved underneath', async ({ page }) => {
  const instanceId = await seedRetryInstance('inputs-conflict');

  await gotoInstance(page, instanceId, 'inputs');

  await expect(cards(page)).toHaveCount(2);

  // Another event arrives while the tab is open: the sequence number it is holding is no longer the
  // last input-bearing event, which is exactly what the concurrency token is there to catch
  const moved = buildRetryInstance(instanceId, new Date());

  moved.history.push({
    sequenceNumber: 20,
    eventType: 'EventRaised',
    timestamp: new Date(),
    eventId: -1,
    name: 'PaymentApproved',
    input: '{"approved":true,"approver":"someone.else@contoso.com","amount":1}',
  });

  await seedInstances({ hub, instances: [moved] });

  await cards(page).nth(1).getByRole('button', { name: 'Update input and rewind' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Update and rewind' }).click();

  await expectToast(page, /The list was refreshed\./);

  // The list really was reloaded: the event that arrived is on it
  await expect(cards(page)).toHaveCount(3);
});

test('blocks anything larger than the backend stores inline', async ({ page }) => {
  const instanceId = await seedRetryInstance('inputs-size');

  await gotoInstance(page, instanceId, 'inputs');

  const last = cards(page).nth(1);

  // 70 KB of UTF-16, which is past the 60 KB the backend keeps in the row
  await replaceInput(page, last, `"${'x'.repeat(36_000)}"`);

  await expect(last.locator('.meter')).toHaveClass(/over/);

  for (const op of await ops(last)) {
    expect(op.disabled).toBe(true);
  }

  expect((await ops(last)).find((op) => op.label === 'Update input and rewind')?.why).toBe(
    'Input is larger than 60 KB',
  );
});
