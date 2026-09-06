// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Capabilities, FailuresResponse } from '$lib/api/types';
import { DANGER_OFF_TITLE, DANGER_TITLE } from '$lib/failures/FailureRow.svelte';
import { GROUP_NOTE, groupNote } from '$lib/failures/FailureGroup.svelte';
import type { AppState } from '$lib/state/app.svelte';
import ScreenHarness from '../../tests/unit/harnesses/ScreenHarness.svelte';
import Failures, { NO_FAILURES_TEXT, NO_FAILURES_TITLE, SIGNATURE_NOTE } from './Failures.svelte';
import { failureGroup, failures as failuresFixture } from '../../tests/unit/fixtures/failures';

function mount(
  options: {
    path?: string;
    response?: FailuresResponse;
    capabilities?: Partial<Capabilities>;
    readOnly?: boolean;
    dangerous?: boolean;
  } = {},
) {
  const rendered = render(ScreenHarness, {
    props: {
      screen: Failures,
      path: options.path ?? '/DurableFunctionsHub/failures',
      capabilities: options.capabilities ?? { failures: true },
      readOnly: options.readOnly ?? false,
      dangerous: options.dangerous ?? false,
      endpoints: { failures: async () => options.response ?? failuresFixture() },
    },
  });

  const app = (rendered.component as unknown as { appState: () => AppState }).appState();

  return { ...rendered, app };
}

function groups(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.group'));
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.frow'));
}

/** Renders the screen and waits for the groups the fixture answers with. */
async function mounted(options: Parameters<typeof mount>[0] = {}) {
  const rendered = mount(options);

  await waitFor(() => expect(groups()).toHaveLength((options.response ?? failuresFixture()).groups.length));

  return rendered;
}

describe('Failures: the title row', () => {
  it('counts the failures and says how far the backend looked', async () => {
    await mounted();

    expect(document.querySelector('section.page[data-screen-label="Failures"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Failures', level: 1 })).toHaveClass('display');
    expect(screen.getByRole('button', { name: 'Time range' })).toHaveTextContent('Last 24 hours');

    // ScreenFailures.dc.html L20-L21
    const meta = document.querySelector('.ptitle .meta') as HTMLElement;

    expect(meta.textContent?.replace(/\s+/g, ' ').trim()).toBe('9 failed in 3 groups');
    expect(within(meta).getByText('9')).toHaveClass('chip', 'st-failed', 'sm');

    expect(document.querySelector('.ptitle .fine.muted')?.textContent).toBe(
      `scanned 12,408 · full · ${SIGNATURE_NOTE}`,
    );
  });

  it('says nothing about a scan that has not happened yet', () => {
    mount();

    expect(document.querySelector('.ptitle .fine.muted')).toBeNull();
    expect(document.querySelector('.ptitle .meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '0 failed in 0 groups',
    );
  });

  it('reloads for the range the user picks, and shares it with every screen', async () => {
    const { app } = await mounted();

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Time range' }), { key: 'ArrowDown' });

    // bits-ui selects on pointerup, which is what a click in jsdom is not
    const option = await screen.findByRole('option', { name: 'Last 7 days' });

    await fireEvent.pointerDown(option, { pointerType: 'mouse' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() => expect(app.timeRange).toEqual({ preset: '7d' }));
    expect(new URLSearchParams(window.location.search).get('range')).toBe('7d');
  });
});

describe('Failures: the groups', () => {
  it('lists what the backend grouped, largest first, with the first one open', async () => {
    await mounted();

    const heads = groups().map((group) => group.querySelector('.ghead') as HTMLElement);

    expect(heads.map((head) => head.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'ProcessOrderOrchestrator InventoryUnavailable: SKU-* is out of stock 6 last 13:51:19',
      'ProcessOrderOrchestrator TimeoutException: payment gateway did not answer within * s 2 last 12:31:44',
      'ReconcileLedgerOrchestrator LedgerOutOfBalance: * entries could not be matched 1 last 02:42:13',
    ]);

    expect(groups().map((group) => group.getAttribute('data-expanded'))).toEqual(['true', 'false', 'false']);

    // ...and only the open one has rows under it
    expect(rows()).toHaveLength(6);
    expect(within(heads[0]).getByText('6')).toHaveClass('chip', 'st-failed', 'sm');
    expect(heads[0].querySelector('.tri')).not.toBeNull();
  });

  it('opens and closes a group where it stands', async () => {
    await mounted();

    await fireEvent.click(groups()[1].querySelector('.ghead') as HTMLElement);

    expect(groups()[1].getAttribute('data-expanded')).toBe('true');
    expect(rows()).toHaveLength(8);

    await fireEvent.click(groups()[0].querySelector('.ghead') as HTMLElement);

    expect(rows()).toHaveLength(2);
  });

  it('offers the two group recoveries, and says why the other two are not there', async () => {
    await mounted();

    const foot = groups()[0].querySelector('.gfoot') as HTMLElement;

    expect(within(foot).getByRole('button', { name: 'Rewind all 6' })).toBeEnabled();
    expect(within(foot).getByRole('button', { name: 'Purge all 6' })).toHaveClass('destructive');
    expect(foot.querySelector('.meta')?.textContent).toBe(GROUP_NOTE);
  });

  it('counts what it can act on when the backend carried only the newest of them', async () => {
    // B3 counts every instance that failed and carries the newest fifty
    const capped = failureGroup({ count: 340 });

    await mounted({ response: failuresFixture({ groups: [capped], totalFailed: 340 }) });

    const foot = document.querySelector('.gfoot') as HTMLElement;

    expect(within(document.querySelector('.ghead') as HTMLElement).getByText('340')).toHaveClass('chip');
    expect(within(foot).getByRole('button', { name: 'Rewind all 6' })).toBeInTheDocument();
    expect(foot.querySelector('.meta')?.textContent).toBe(`the newest 6 of 340 · ${GROUP_NOTE}`);
    expect(groupNote(340, 6)).toBe(`the newest 6 of 340 · ${GROUP_NOTE}`);
  });

  it('disables every action of a read-only deployment', async () => {
    await mounted({ readOnly: true, dangerous: true });

    for (const button of Array.from(rows()[0].querySelectorAll('.acts .btn'))) {
      expect(button).toBeDisabled();
    }

    for (const button of Array.from(document.querySelectorAll('.gfoot .btn'))) {
      expect(button).toBeDisabled();
    }
  });
});

describe('Failures: a row', () => {
  it('is the instance, when it failed, how long it ran and why', async () => {
    await mounted();

    const row = within(rows()[0]);
    const link = row.getByRole('link', { name: 'order-2026-09-04-000911' });

    expect(link).toHaveAttribute('href', '/DurableFunctionsHub/instances/order-2026-09-04-000911');
    expect(link).toHaveClass('link', 'mono');

    expect(rows()[0].querySelector('.t')?.textContent).toBe('13:51:02');
    expect(rows()[0].querySelector('.d')?.textContent).toBe('17 s');

    // One line of it; the whole message is the tooltip
    const reason = rows()[0].querySelector('.reason') as HTMLElement;

    expect(reason.textContent?.trim()).toBe('InventoryUnavailable: SKU-4471 is out of stock');
    expect(reason).toHaveAttribute('title', 'InventoryUnavailable: SKU-4471 is out of stock');
    expect(reason).toHaveClass('muted');

    expect(Array.from(rows()[0].querySelectorAll('.acts .btn')).map((button) => button.textContent?.trim())).toEqual([
      'Rewind',
      'Update input',
      'Restart in place',
      'Purge',
    ]);
  });

  it('says why Restart in place is off when the deployment forbids it', async () => {
    await mounted();

    const restart = within(rows()[0]).getByRole('button', { name: 'Restart in place' });

    expect(restart).toBeDisabled();
    expect(restart).toHaveClass('danger');
    expect(restart).toHaveAttribute('title', DANGER_OFF_TITLE);
  });

  it('says what it does when the deployment allows it', async () => {
    await mounted({ dangerous: true });

    const restart = within(rows()[0]).getByRole('button', { name: 'Restart in place' });

    expect(restart).toBeEnabled();
    expect(restart).toHaveAttribute('title', DANGER_TITLE);
  });

  it('opens the instance on the Inputs tab, where the payload is', async () => {
    const { app } = await mounted();

    await fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Update input' }));

    expect(app.router.current).toMatchObject({ name: 'instance', instanceId: 'order-2026-09-04-000911' });
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('inputs');
  });

  it('peeks the row from its reason, with what the endpoint said and nothing else', async () => {
    const { app } = await mounted();

    await fireEvent.click(rows()[0].querySelector('.reason') as HTMLElement);

    expect(app.peek.item).toEqual({
      id: 'order-2026-09-04-000911',
      name: 'ProcessOrderOrchestrator',
      kind: 'Orchestration',
      status: 'Failed',
      created: '2026-09-04T13:51:02Z',
      updated: '2026-09-04T13:51:19Z',
      duration: 17_000,
    });
  });

  it('works out the end of a run the provider gave no completion time for', async () => {
    const group = failureGroup({
      instances: [failureGroup().instances[0]].map((instance) => ({ ...instance, completedTime: null })),
      count: 1,
    });

    const { app } = await mounted({ response: failuresFixture({ groups: [group], totalFailed: 1 }) });

    await fireEvent.click(document.querySelector('.reason') as HTMLElement);

    // created + the duration B3 measured, which is the same clock the provider's own row was written on
    expect(app.peek.item?.updated).toBe('2026-09-04T13:51:19.000Z');
  });
});

describe('Failures: the recoveries', () => {
  it('confirms one instance by name and a group by count', async () => {
    await mounted();

    await fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Rewind' }));

    expect(screen.getByRole('heading', { name: 'Rewind order-2026-09-04-000911' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('.dialog')).toBeNull());

    await fireEvent.click(screen.getByRole('button', { name: 'Purge all 6' }));

    expect(screen.getByRole('heading', { name: 'Purge 6 instances' })).toBeInTheDocument();
    expect(document.querySelector('.dialog .ed.ro pre')?.textContent?.split('\n')).toHaveLength(6);
  });
});

describe('Failures: nothing to show', () => {
  it('says the range was quiet, and what to do about it', async () => {
    mount({ response: failuresFixture({ groups: [], totalFailed: 0 }) });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'No failures' })).toBeInTheDocument());

    expect(document.querySelector('.empty p')?.textContent).toBe(
      'Nothing failed in the last 24 hours. Widen the range to look further back.',
    );
  });

  it('asks nothing of a backend without the endpoint, and points at the list that works', async () => {
    const { app } = mount({ capabilities: {} });

    await waitFor(() => expect(screen.getByRole('heading', { name: NO_FAILURES_TITLE })).toBeInTheDocument());

    expect(document.querySelector('.empty p')?.textContent).toBe(NO_FAILURES_TEXT);

    await fireEvent.click(screen.getByRole('button', { name: 'Failed instances' }));

    expect(app.router.current).toMatchObject({ name: 'instances' });
    expect(new URLSearchParams(window.location.search).get('status')).toBe('Failed');
  });
});
