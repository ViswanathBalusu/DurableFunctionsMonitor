// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// The fixtures compile against types.ts by being imported here; these assertions guard the two
// things a type cannot: that they say what the mockups say, and that they stay self-consistent.

import { describe, expect, it } from 'vitest';
import { OPERATIONS } from '$lib/state/activity.svelte';
import { about, capabilities, noCapabilities } from './fixtures/about';
import { audit, auditDisabled } from './fixtures/audit';
import { children } from './fixtures/children';
import { childDetails, details, failedDetails } from './fixtures/details';
import { entities } from './fixtures/entities';
import { entityInstances, instance, instances, page } from './fixtures/instances';
import { failures } from './fixtures/failures';
import { history, historyResponse } from './fixtures/history';
import { inputEvents, runningInputEvents } from './fixtures/input-events';
import { spansResponse } from './fixtures/spans';
import { stats } from './fixtures/stats';
import { storage } from './fixtures/storage';

describe('fixtures', () => {
  it('take overrides', () => {
    expect(instance({ runtimeStatus: 'Failed' })).toMatchObject({
      instanceId: 'order-2026-09-04-000913',
      runtimeStatus: 'Failed',
    });

    expect(about({ readOnly: true }).readOnly).toBe(true);
    expect(capabilities({ stats: false }).stats).toBe(false);
  });

  it('know a backend that can do nothing optional', () => {
    expect(Object.values(noCapabilities()).every((value) => value === false)).toBe(true);
    expect(noCapabilities({ stats: true }).stats).toBe(true);
  });

  it('are the rows the Instances mockup draws', () => {
    expect(instances).toHaveLength(9);

    // Seven of the eight statuses; the mockup's table has no Canceled row
    expect(new Set(instances.map((row) => row.runtimeStatus)).size).toBe(7);

    expect(instances[2]).toMatchObject({
      instanceId: 'order-2026-09-04-000911',
      runtimeStatus: 'Failed',
      customStatus: { error: 'InventoryUnavailable', sku: 'SKU-4471' },
    });
  });

  it('give every row a duration that matches its timestamps', () => {
    for (const row of [...instances, ...entityInstances, ...page(3)]) {
      const elapsed = new Date(row.lastUpdatedTime).getTime() - new Date(row.createdTime).getTime();

      expect(row.duration).toBe(elapsed);
    }
  });

  it('are the history of the workspace mockup, including the raised event', () => {
    expect(historyResponse().history).toBe(history);
    expect(history.at(-1)?.SequenceNumber).toBe(31);

    expect(history.find((event) => event.EventType === 'EventRaised')).toMatchObject({
      SequenceNumber: 27,
      Name: 'PaymentApproved',
    });
  });

  it('offer the two inputs the Inputs tab lists', () => {
    const events = inputEvents().events;

    expect(events.map((event) => event.eventType)).toEqual(['ExecutionStarted', 'EventRaised']);
    expect(events[1].isLast).toBe(true);

    // The default instance is failed, and a failed instance is terminal: nothing to terminate
    expect(events[1].operations.replay).toEqual({ allowed: true, requiresTerminate: false });
    expect(runningInputEvents().events[1].operations.replay.requiresTerminate).toBe(true);
  });

  it('describe the same instance across the details, spans and children fixtures', () => {
    expect(spansResponse().instanceId).toBe(details().instanceId);
    expect(children().children[0].instanceId).toBe(childDetails().instanceId);
    expect(childDetails().parentInstanceId).toBe(details().instanceId);
  });

  it('group the failures the Failures mockup shows, largest first', () => {
    const groups = failures().groups;

    expect(groups.map((group) => group.count)).toEqual([6, 2, 1]);
    expect(groups[0].signature).toBe('InventoryUnavailable: SKU-* is out of stock');
    expect(groups[0].instances[0].instanceId).toBe(failedDetails().instanceId);

    // B3: a group counts every instance that failed and carries the newest fifty of them
    expect(groups.map((group) => group.instances.length)).toEqual(groups.map((group) => group.count));
    expect(failures().totalFailed).toBe(groups.reduce((total, group) => total + group.count, 0));
  });

  it('add up the stats bins to something the totals can hold', () => {
    const response = stats();

    expect(response.bins).toHaveLength(response.binCount);
    expect(response.totals.all).toBeGreaterThan(response.totals.Failed ?? 0);
    expect(response.byName.map((row) => row.name)).toContain('ProcessOrderOrchestrator');
  });

  it('report the storage of the hub the other fixtures live in', () => {
    expect(storage().taskHub.name).toBe(about().hubName);
    expect(storage().accountName).toBe(about().accountName);
    expect(storage().queues.filter((row) => row.kind === 'control')).toHaveLength(4);
  });

  it('summarise an entity state, and admit one it could not parse', () => {
    const rows = entities().entities;

    // What EntityState.Summarize writes: the state itself, with no whitespace in it
    expect(rows[0].stateSummary).toBe(JSON.stringify(rows[0].state));
    expect(rows[2]).toMatchObject({ state: null, stateSummary: null });
    expect(rows[2].stateError).toBeTruthy();

    for (const row of rows) {
      // An entity id is `@name@key`, and the name of it is the lower-case one in the id
      expect(row.instanceId).toBe(`@${row.entityName}@${row.key}`);
      expect(row.runtimeStatus).toBe('Running');
    }
  });

  it('audit both kinds of operation, and know when auditing is off', () => {
    expect(new Set(audit().rows.map((row) => row.kind))).toEqual(new Set(['Write', 'Dangerous']));
    expect(audit().rows.find((row) => row.outcome === 'failed')?.message).toBeTruthy();

    // The names the middleware writes (Common/AuditOperations.cs), which the filter matches verbatim
    expect(audit().rows.map((row) => row.operation)).toEqual([
      'Terminate',
      'Raise event',
      'Replay',
      'Update input and rewind',
      'Restart in place',
      'Purge history',
    ]);

    for (const row of audit().rows) {
      expect(OPERATIONS).toContain(row.operation);
    }

    // The two the screen tags as dangerous, and one that is dangerous without being one of them
    expect(
      audit()
        .rows.filter((row) => row.kind === 'Dangerous')
        .map((row) => row.operation),
    ).toEqual(['Replay', 'Update input and rewind', 'Restart in place']);

    expect(auditDisabled()).toMatchObject({ rows: [], enabled: false });
  });
});
