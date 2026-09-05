// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * The data every Playwright spec runs against (E3-S2-T1).
 *
 * Pure: no Azure SDK, no clock reading beyond the `now` that is passed in, so a spec can assert against the
 * same objects the seed wrote without touching storage. `seed-hub.mjs` turns them into rows of the
 * `{hub}Instances` and `{hub}History` tables the way the Durable Task Azure Storage provider writes them,
 * so the standalone host lists and opens them as if a real app had run them.
 *
 * The instances are the nine rows of `docs/ui-plans-artifacts/ScreenInstances.dc.html` L190-L198 and the two
 * entities of L201-L202, with the history of `ScreenInstance.dc.html` L311-L325 on `order-2026-09-04-000913`.
 * Timestamps are relative to `now` (the mockup's own clock is 2026-09-04 14:02:58), so time-range filters
 * work on any day.
 */

/** The task hub the e2e suite seeds unless `DFM_E2E_HUB` says otherwise. */
export const DEFAULT_HUB = 'DurableFunctionsHub';

/** The orchestrator of the filler rows, which exist only so the list has a second page. */
export const FILLER_ORCHESTRATOR = 'PagingFillerOrchestrator';

/** Their ids all start with this, and with nothing the mockup's own rows start with. */
export const FILLER_INSTANCE_PREFIX = 'filler-';

/** The `RuntimeStatus` the mockup's entity rows carry (ScreenInstances.dc.html L201-L202). */
export const ENTITY_RUNTIME_STATUS = 'Pending';

/**
 * A payload the Durable Task Framework moved out of its tables into the `{hub}-largemessages` container.
 * @typedef {object} SeedBlob
 * @property {string} name blob name inside the container
 * @property {string} text the payload, uploaded gzipped
 */

/**
 * One row of the `{hub}History` table. `sequenceNumber` becomes the 16 hex digit RowKey.
 * @typedef {object} SeedHistoryRow
 * @property {number} sequenceNumber
 * @property {string} eventType
 * @property {Date} timestamp written to `_Timestamp`
 * @property {number} eventId
 * @property {string} [name]
 * @property {string} [input]
 * @property {string} [result]
 * @property {string} [details]
 * @property {string} [reason]
 * @property {number} [taskScheduledId]
 * @property {number} [timerId]
 * @property {Date} [fireAt]
 * @property {string} [instanceId] the child's id on a `SubOrchestrationInstanceCreated` row
 * @property {string} [orchestrationStatus] on an `ExecutionCompleted` row
 * @property {SeedBlob} [inputBlob] when set, `Input` is emptied and `InputBlobName` points at the blob
 */

/**
 * One row of the `{hub}Instances` table, plus the history rows of that instance.
 * @typedef {object} SeedInstance
 * @property {string} instanceId
 * @property {string} name
 * @property {string} executionId
 * @property {string} runtimeStatus
 * @property {Date} createdTime
 * @property {Date} lastUpdatedTime
 * @property {Date | null} completedTime
 * @property {string | null} input
 * @property {string | null} output
 * @property {string | null} customStatus
 * @property {string | null} parentInstanceId
 * @property {boolean} isEntity
 * @property {SeedBlob} [inputBlob] when set, `Input` holds the blob's URL instead of the payload
 * @property {SeedHistoryRow[]} history
 */

/**
 * @typedef {object} SeedData
 * @property {string} hub
 * @property {Date} now
 * @property {SeedInstance[]} instances every row of the Instances table, entities included
 * @property {SeedInstance[]} orchestrations
 * @property {SeedInstance[]} entities
 * @property {SeedBlob[]} blobs every payload that lives in `{hub}-largemessages`
 * @property {number} historyRowCount history rows, without the per-instance `sentinel` row
 */

const PROCESS_ORDER = 'ProcessOrderOrchestrator';
const RECONCILE_LEDGER = 'ReconcileLedgerOrchestrator';
const ONBOARD_TENANT = 'OnboardTenantOrchestrator';
const NOTIFY_CUSTOMER = 'NotifyCustomer';

/** The running order of ScreenInstance.dc.html: its history is the one every history spec reads. */
export const RUNNING_INSTANCE_ID = 'order-2026-09-04-000913';

/** The failed order of ScreenInstances.dc.html L192, the one the Failures screen groups on. */
export const FAILED_INSTANCE_ID = 'order-2026-09-04-000911';

/** The sub-orchestration `RUNNING_INSTANCE_ID` started. See the note on its execution id below. */
export const SUB_ORCHESTRATION_INSTANCE_ID = `${RUNNING_INSTANCE_ID}:0`;

/** The entity of ScreenInstances.dc.html L201. */
export const ENTITY_INSTANCE_ID = '@counter@warehouse-07';

/**
 * @param {Date} now
 * @param {number} seconds
 * @returns {Date}
 */
function ago(now, seconds) {
  return new Date(now.getTime() - seconds * 1000);
}

/**
 * @param {Date} moment
 * @param {number} ms
 * @returns {Date}
 */
function plus(moment, ms) {
  return new Date(moment.getTime() + ms);
}

/**
 * @param {string} errorType
 * @param {string} errorMessage
 * @returns {string} the Output a failed instance carries
 */
export function failureOutput(errorType, errorMessage) {
  return JSON.stringify({ ErrorType: errorType, ErrorMessage: errorMessage });
}

/**
 * @param {number} sequenceNumber
 * @param {string} eventType
 * @param {Date} createdTime
 * @param {number} offsetMs
 * @param {Partial<SeedHistoryRow>} [extra]
 * @returns {SeedHistoryRow}
 */
function row(sequenceNumber, eventType, createdTime, offsetMs, extra = {}) {
  return {
    sequenceNumber,
    eventType,
    timestamp: plus(createdTime, offsetMs),
    eventId: -1,
    ...extra,
  };
}

/**
 * The history of an instance that scheduled one activity and then ended (or is still running): two episodes
 * wrapped in `OrchestratorStarted`/`OrchestratorCompleted` markers, the way the framework writes them.
 *
 * @param {Date} createdTime
 * @param {object} options
 * @param {string} options.name orchestrator name
 * @param {string | null} options.input
 * @param {string} options.activity the one activity the orchestrator calls
 * @param {number} options.durationMs
 * @param {'Completed' | 'Failed' | 'ContinuedAsNew' | 'Terminated' | 'Suspended' | 'Running'} options.ending
 * @param {string | null} [options.result] the activity's result, or the failure text on a failed run
 * @param {string | null} [options.output] what the terminal row records
 * @param {string} [options.errorType] on a failed run, the `Reason` of the `TaskFailed` row
 * @param {SeedBlob} [options.inputBlob]
 * @returns {SeedHistoryRow[]}
 */
function simpleHistory(createdTime, options) {
  const { name, input, activity, durationMs, ending, result = null, output = null, errorType, inputBlob } = options;

  /** @type {SeedHistoryRow[]} */
  const rows = [
    row(0, 'OrchestratorStarted', createdTime, -13),
    row(1, 'ExecutionStarted', createdTime, 0, {
      name,
      ...(input === null ? {} : { input }),
      ...(inputBlob ? { inputBlob } : {}),
    }),
    row(2, 'TaskScheduled', createdTime, 91, { name: activity, eventId: 0 }),
    row(3, 'OrchestratorCompleted', createdTime, 100),
    row(4, 'OrchestratorStarted', createdTime, Math.max(durationMs - 120, 200)),
  ];

  if (ending === 'Failed') {
    rows.push(
      row(5, 'TaskFailed', createdTime, Math.max(durationMs - 100, 220), {
        name: activity,
        taskScheduledId: 0,
        reason: errorType ?? 'Exception',
        details: result ?? '',
      }),
    );
  } else if (ending !== 'Suspended' && ending !== 'Running') {
    rows.push(
      row(5, 'TaskCompleted', createdTime, Math.max(durationMs - 100, 220), {
        taskScheduledId: 0,
        ...(result === null ? {} : { result }),
      }),
    );
  }

  if (ending === 'Suspended') {
    rows.push(
      row(5, 'ExecutionSuspended', createdTime, Math.max(durationMs - 100, 220), { reason: 'paused by operator' }),
    );
    rows.push(row(6, 'OrchestratorCompleted', createdTime, durationMs));
    return rows;
  }

  if (ending === 'Running') {
    rows.push(row(5, 'OrchestratorCompleted', createdTime, durationMs));
    return rows;
  }

  if (ending === 'Terminated') {
    rows.push(
      row(6, 'ExecutionTerminated', createdTime, durationMs - 10, {
        ...(output === null ? {} : { input: output }),
      }),
    );
  } else {
    rows.push(
      row(6, 'ExecutionCompleted', createdTime, durationMs - 10, {
        orchestrationStatus: ending,
        ...(output === null ? {} : { result: output }),
      }),
    );
  }

  rows.push(row(7, 'OrchestratorCompleted', createdTime, durationMs));

  return rows;
}

/**
 * The history of `ScreenInstance.dc.html` L311-L325: reserve, charge, a timeout, a retry timer, the external
 * event `PaymentApproved`, the successful retry and the sub-orchestration that is still running. Every group
 * sits between an `OrchestratorStarted` and an `OrchestratorCompleted` marker, so the episode markers the
 * Instance screen draws are real rows.
 *
 * The mockup numbers only the rows it shows; the markers take the numbers it skips, which is why the last two
 * rows sit one above the mockup's #30/#31 - an episode's closing and the next episode's opening marker cannot
 * share a sequence number.
 *
 * @param {Date} createdTime
 * @returns {SeedHistoryRow[]}
 */
function runningOrderHistory(createdTime) {
  const orderInput = JSON.stringify({
    orderId: 'A-1043',
    customerId: 88214,
    items: [{ sku: 'SKU-4471', qty: 2 }],
    total: 129.5,
    currency: 'USD',
  });
  const chargeInput = '{"amount":129.5,"currency":"USD"}';

  return [
    row(0, 'OrchestratorStarted', createdTime, -13),
    row(1, 'ExecutionStarted', createdTime, 0, { name: PROCESS_ORDER, input: orderInput }),
    row(2, 'TaskScheduled', createdTime, 91, {
      name: 'ReserveInventory',
      eventId: 0,
      input: '{"sku":"SKU-4471","qty":2}',
    }),
    row(3, 'OrchestratorCompleted', createdTime, 100),
    row(4, 'OrchestratorStarted', createdTime, 1997),
    row(5, 'TaskCompleted', createdTime, 2004, { taskScheduledId: 0, result: '{"sku":"SKU-4471","reserved":2}' }),
    row(6, 'TaskScheduled', createdTime, 2089, { name: 'ChargePayment', eventId: 1, input: chargeInput }),
    row(7, 'OrchestratorCompleted', createdTime, 2100),
    row(8, 'OrchestratorStarted', createdTime, 5186),
    row(9, 'TaskCompleted', createdTime, 5193, {
      taskScheduledId: 1,
      result: '{"transactionId":"tx_8f3a1b2c","amount":129.5,"currency":"USD"}',
    }),
    row(10, 'TaskScheduled', createdTime, 5297, { name: 'ChargePayment', eventId: 2, input: chargeInput }),
    row(11, 'OrchestratorCompleted', createdTime, 5310),
    // The batch dequeued at 12 lost its lease before it produced anything; 13 is the redelivery that ran
    row(12, 'OrchestratorStarted', createdTime, 9100),
    row(13, 'OrchestratorStarted', createdTime, 9380),
    row(14, 'TaskFailed', createdTime, 9387, {
      name: 'ChargePayment',
      taskScheduledId: 2,
      reason: 'TimeoutException',
      details: 'TimeoutException: payment gateway did not answer within 4 s',
    }),
    row(15, 'TimerCreated', createdTime, 9489, { eventId: 3, fireAt: plus(createdTime, 12489) }),
    row(16, 'OrchestratorCompleted', createdTime, 9500),
    row(17, 'OrchestratorStarted', createdTime, 12490),
    row(18, 'TimerFired', createdTime, 12497, { timerId: 3, fireAt: plus(createdTime, 12489) }),
    row(19, 'OrchestratorCompleted', createdTime, 12510),
    row(26, 'OrchestratorStarted', createdTime, 12990),
    row(27, 'EventRaised', createdTime, 13000, {
      name: 'PaymentApproved',
      input: '{"approved":true,"approver":"ops@contoso.com","amount":129.5}',
    }),
    row(28, 'TaskScheduled', createdTime, 13088, { name: 'ChargePayment', eventId: 4, input: chargeInput }),
    row(29, 'OrchestratorCompleted', createdTime, 13100),
    row(30, 'OrchestratorStarted', createdTime, 16195),
    row(31, 'TaskCompleted', createdTime, 16201, {
      taskScheduledId: 4,
      result: '{"transactionId":"tx_9c2d","amount":129.5,"currency":"USD"}',
    }),
    row(32, 'SubOrchestrationInstanceCreated', createdTime, 16487, {
      name: NOTIFY_CUSTOMER,
      eventId: 5,
      instanceId: SUB_ORCHESTRATION_INSTANCE_ID,
      input: '{"orderId":"A-1043","channel":"email"}',
    }),
    row(33, 'OrchestratorCompleted', createdTime, 16500),
  ];
}

/**
 * The failed order of the mockup: an inventory check that came back empty, so the run ended with a
 * `TaskFailed` and an `ExecutionCompleted` carrying the failure.
 *
 * @param {Date} createdTime
 * @param {string} output
 * @returns {SeedHistoryRow[]}
 */
function failedOrderHistory(createdTime, output) {
  const orderInput = JSON.stringify({
    orderId: 'A-1041',
    customerId: 88214,
    items: [{ sku: 'SKU-4471', qty: 3 }],
    total: 194.25,
    currency: 'USD',
  });

  return [
    row(0, 'OrchestratorStarted', createdTime, -13),
    row(1, 'ExecutionStarted', createdTime, 0, { name: PROCESS_ORDER, input: orderInput }),
    row(2, 'TaskScheduled', createdTime, 91, {
      name: 'ReserveInventory',
      eventId: 0,
      input: '{"sku":"SKU-4471","qty":3}',
    }),
    row(3, 'OrchestratorCompleted', createdTime, 100),
    row(4, 'OrchestratorStarted', createdTime, 16800),
    row(5, 'TaskFailed', createdTime, 16810, {
      name: 'ReserveInventory',
      taskScheduledId: 0,
      reason: 'InventoryUnavailableException',
      details: 'InventoryUnavailable: SKU-4471 has 0 units in warehouse-07',
    }),
    row(6, 'ExecutionCompleted', createdTime, 16900, { orchestrationStatus: 'Failed', result: output }),
    row(7, 'OrchestratorCompleted', createdTime, 17000),
  ];
}

/**
 * An input the framework had to offload: it keeps at most 60 KB of UTF-16 in a table cell, this is well past
 * that.
 * @returns {string}
 */
function largeTenantInput() {
  /** @type {{ id: string; email: string; roles: string[] }[]} */
  const users = [];
  for (let i = 0; i < 1200; i++) {
    users.push({ id: `u-${1000 + i}`, email: `user${i}@contoso.com`, roles: ['reader'] });
  }

  return JSON.stringify({ tenant: 'contoso', region: 'westeurope', plan: 'enterprise', users });
}

/**
 * Builds every row the seed writes.
 *
 * @param {string} [hub] only used for the `TaskHubName` column
 * @param {Date} [now] the moment the fixtures are relative to
 * @param {object} [options]
 * @param {number} [options.filler] extra completed instances, so the list has more than one page
 * @returns {SeedData}
 */
export function buildSeedData(hub = DEFAULT_HUB, now = new Date(), options = {}) {
  /** @type {SeedInstance[]} */
  const instances = [];

  /**
   * @param {object} spec
   * @param {string} spec.instanceId
   * @param {string} spec.name
   * @param {string} spec.executionId
   * @param {string} spec.runtimeStatus
   * @param {number} spec.createdSecondsAgo
   * @param {number} spec.durationMs how long the run took, or has been running for
   * @param {boolean} spec.terminal whether a `CompletedTime` is written
   * @param {string | null} [spec.input]
   * @param {string | null} [spec.output]
   * @param {string | null} [spec.customStatus]
   * @param {string | null} [spec.parentInstanceId]
   * @param {boolean} [spec.isEntity]
   * @param {SeedBlob} [spec.inputBlob]
   * @param {(created: Date) => SeedHistoryRow[]} [spec.history]
   * @returns {void}
   */
  function add(spec) {
    const createdTime = ago(now, spec.createdSecondsAgo);
    const lastUpdatedTime = plus(createdTime, spec.durationMs);

    instances.push({
      instanceId: spec.instanceId,
      name: spec.name,
      executionId: spec.executionId,
      runtimeStatus: spec.runtimeStatus,
      createdTime,
      lastUpdatedTime,
      completedTime: spec.terminal ? lastUpdatedTime : null,
      input: spec.input ?? null,
      output: spec.output ?? null,
      customStatus: spec.customStatus ?? null,
      parentInstanceId: spec.parentInstanceId ?? null,
      isEntity: spec.isEntity ?? false,
      ...(spec.inputBlob ? { inputBlob: spec.inputBlob } : {}),
      history: spec.history ? spec.history(createdTime) : [],
    });
  }

  const inventoryError = 'InventoryUnavailableException';
  const timeoutMessage = 'Timeout: ChargePayment did not complete within 20 s';
  const failed911Output = failureOutput(inventoryError, 'InventoryUnavailable: SKU-4471 has 0 units in warehouse-07');

  // ScreenInstances.dc.html L190: the running order, 47 s in
  add({
    instanceId: RUNNING_INSTANCE_ID,
    name: PROCESS_ORDER,
    // Not a GUID on purpose: the Durable Task Framework names a sub-orchestration
    // '{parentExecutionId}:{taskId}', and the mockup's child is 'order-2026-09-04-000913:0'
    executionId: RUNNING_INSTANCE_ID,
    runtimeStatus: 'Running',
    createdSecondsAgo: 47,
    durationMs: 47000,
    terminal: false,
    input:
      '{"orderId":"A-1043","customerId":88214,"items":[{"sku":"SKU-4471","qty":2}],"total":129.5,"currency":"USD"}',
    customStatus: '{"step":"ChargePayment","attempt":2}',
    history: runningOrderHistory,
  });

  // The sub-orchestration row 32 of that history created, so the children endpoint has a tree to walk
  add({
    instanceId: SUB_ORCHESTRATION_INSTANCE_ID,
    name: NOTIFY_CUSTOMER,
    executionId: 'a4f1c7e2-1d34-4a1f-9a0e-2b6d5f0c9a10',
    runtimeStatus: 'Running',
    createdSecondsAgo: 31,
    durationMs: 30900,
    terminal: false,
    input: '{"orderId":"A-1043","channel":"email"}',
    parentInstanceId: RUNNING_INSTANCE_ID,
    history: (created) =>
      simpleHistory(created, {
        name: NOTIFY_CUSTOMER,
        input: '{"orderId":"A-1043","channel":"email"}',
        activity: 'SendEmail',
        durationMs: 30900,
        ending: 'Running',
      }),
  });

  // L191: the completed order
  const input912 =
    '{"orderId":"A-1042","customerId":88214,"items":[{"sku":"SKU-1180","qty":1}],"total":42,"currency":"USD"}';
  const output912 = '{"orderId":"A-1042","status":"Shipped","trackingId":"TRK-77201"}';
  add({
    instanceId: 'order-2026-09-04-000912',
    name: PROCESS_ORDER,
    executionId: '2f5c8a91-7b0e-4d21-9a3f-11c2d3e4f5a6',
    runtimeStatus: 'Completed',
    createdSecondsAgo: 258,
    durationMs: 25000,
    terminal: true,
    input: input912,
    output: output912,
    history: (created) =>
      simpleHistory(created, {
        name: PROCESS_ORDER,
        input: input912,
        activity: 'ReserveInventory',
        durationMs: 25000,
        ending: 'Completed',
        result: '{"sku":"SKU-1180","reserved":1}',
        output: output912,
      }),
  });

  // L192: the failed order the Failures screen opens
  add({
    instanceId: FAILED_INSTANCE_ID,
    name: PROCESS_ORDER,
    executionId: '7c1b4d0a-9e52-4f88-a6c3-0d9e8f7a6b5c',
    runtimeStatus: 'Failed',
    createdSecondsAgo: 716,
    durationMs: 17000,
    terminal: true,
    input:
      '{"orderId":"A-1041","customerId":88214,"items":[{"sku":"SKU-4471","qty":3}],"total":194.25,"currency":"USD"}',
    output: failed911Output,
    customStatus: '{"error":"InventoryUnavailable","sku":"SKU-4471"}',
    history: (created) => failedOrderHistory(created, failed911Output),
  });

  // L193: the second failed order of the mockup
  const input907 =
    '{"orderId":"A-1037","customerId":41028,"items":[{"sku":"SKU-2210","qty":1}],"total":18.75,"currency":"USD"}';
  const message907 = 'InventoryUnavailable: SKU-2210 has 0 units in warehouse-03';
  const output907 = failureOutput(inventoryError, message907);
  add({
    instanceId: 'order-2026-09-04-000907',
    name: PROCESS_ORDER,
    executionId: 'b8e3f2a1-4c6d-4e90-8f21-3a5b7c9d1e2f',
    runtimeStatus: 'Failed',
    createdSecondsAgo: 1367,
    durationMs: 15000,
    terminal: true,
    input: input907,
    output: output907,
    customStatus: '{"error":"InventoryUnavailable","sku":"SKU-2210"}',
    history: (created) =>
      simpleHistory(created, {
        name: PROCESS_ORDER,
        input: input907,
        activity: 'ReserveInventory',
        durationMs: 15000,
        ending: 'Failed',
        errorType: inventoryError,
        result: message907,
        output: output907,
      }),
  });

  // L194: pending, never dequeued, so it has no history at all
  add({
    instanceId: 'order-2026-09-04-000899',
    name: PROCESS_ORDER,
    executionId: 'd1c2b3a4-5e6f-4708-9a1b-2c3d4e5f6a7b',
    runtimeStatus: 'Pending',
    createdSecondsAgo: 6774,
    durationMs: 0,
    terminal: false,
    input: '{"orderId":"A-1029","customerId":77310,"items":[{"sku":"SKU-9004","qty":5}],"total":310,"currency":"USD"}',
  });

  // L195: continued as new
  const input880 =
    '{"orderId":"A-1010","customerId":50221,"items":[{"sku":"SKU-1180","qty":2}],"total":84,"currency":"USD"}';
  add({
    instanceId: 'order-2026-09-04-000880',
    name: PROCESS_ORDER,
    executionId: 'e5d4c3b2-1a09-4f87-b6c5-4d3e2f1a0b9c',
    runtimeStatus: 'ContinuedAsNew',
    createdSecondsAgo: 10858,
    durationMs: 31000,
    terminal: true,
    input: input880,
    history: (created) =>
      simpleHistory(created, {
        name: PROCESS_ORDER,
        input: input880,
        activity: 'ReserveInventory',
        durationMs: 31000,
        ending: 'ContinuedAsNew',
        result: '{"sku":"SKU-1180","reserved":2}',
      }),
  });

  // L196: the onboarding run whose input was too large to stay in the table
  const tenantInput = largeTenantInput();
  add({
    instanceId: '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8',
    name: ONBOARD_TENANT,
    executionId: '3c9d1f4a-2b8e-4c76-9d05-6e7f8a9b0c1d',
    runtimeStatus: 'Completed',
    createdSecondsAgo: 17418,
    durationMs: 141000,
    terminal: true,
    output: '{"tenant":"contoso","provisioned":true,"users":1200}',
    customStatus: '{"tenant":"contoso","step":"done"}',
    inputBlob: {
      name: '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8/execution-3c9d1f4a-Input.json.gz',
      text: tenantInput,
    },
    history: (created) =>
      simpleHistory(created, {
        name: ONBOARD_TENANT,
        input: null,
        activity: 'ProvisionTenant',
        durationMs: 141000,
        ending: 'Completed',
        result: '{"provisioned":true}',
        output: '{"tenant":"contoso","provisioned":true,"users":1200}',
        inputBlob: {
          name: '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8/history-0000000000000001-ExecutionStarted-1A2B3C4D-Input.json.gz',
          text: tenantInput,
        },
      }),
  });

  // L197: the terminated nightly job
  add({
    instanceId: 'nightly-reconcile-20260903',
    name: RECONCILE_LEDGER,
    executionId: '9a8b7c6d-5e4f-4312-8091-a2b3c4d5e6f7',
    runtimeStatus: 'Terminated',
    createdSecondsAgo: 129778,
    durationMs: 2533000,
    terminal: true,
    input: '{"ledgerDate":"2026-09-03","accounts":18420}',
    output: '"operator requested stop"',
    customStatus: '{"reason":"operator"}',
    history: (created) =>
      simpleHistory(created, {
        name: RECONCILE_LEDGER,
        input: '{"ledgerDate":"2026-09-03","accounts":18420}',
        activity: 'LoadLedger',
        durationMs: 2533000,
        ending: 'Terminated',
        output: '"operator requested stop"',
      }),
  });

  // L198: suspended, and still the longest-running instance of the hub at 14 h
  const input4411 =
    '{"orderId":"A-0994","customerId":88214,"items":[{"sku":"SKU-4471","qty":1}],"total":64.75,"currency":"USD"}';
  add({
    instanceId: 'order-2026-09-03-004411',
    name: PROCESS_ORDER,
    executionId: 'c4d5e6f7-8a9b-40c1-92d3-e4f5a6b7c8d9',
    runtimeStatus: 'Suspended',
    createdSecondsAgo: 50688,
    durationMs: 112000,
    terminal: false,
    input: input4411,
    customStatus: '{"step":"ChargePayment","attempt":3}',
    history: (created) =>
      simpleHistory(created, {
        name: PROCESS_ORDER,
        input: input4411,
        activity: 'ChargePayment',
        durationMs: 112000,
        ending: 'Suspended',
      }),
  });

  // Four more inventory failures, so the Failures screen groups six instances under one signature
  const moreInventoryFailures = [
    { instanceId: 'order-2026-09-04-000905', sku: 'SKU-1180', warehouse: 'warehouse-07', createdSecondsAgo: 1800 },
    { instanceId: 'order-2026-09-04-000903', sku: 'SKU-4471', warehouse: 'warehouse-12', createdSecondsAgo: 2400 },
    { instanceId: 'order-2026-09-04-000898', sku: 'SKU-3092', warehouse: 'warehouse-03', createdSecondsAgo: 3600 },
    { instanceId: 'order-2026-09-04-000894', sku: 'SKU-4471', warehouse: 'warehouse-07', createdSecondsAgo: 5400 },
  ];

  for (const failure of moreInventoryFailures) {
    const message = `InventoryUnavailable: ${failure.sku} has 0 units in ${failure.warehouse}`;
    const output = failureOutput(inventoryError, message);
    const input = `{"orderId":"A-${failure.instanceId.slice(-4)}","customerId":41028,"items":[{"sku":"${failure.sku}","qty":2}],"total":58.5,"currency":"USD"}`;

    add({
      instanceId: failure.instanceId,
      name: PROCESS_ORDER,
      executionId: `f0${failure.instanceId.slice(-4)}a1-1b2c-4d3e-8f90-a1b2c3d4e5f6`,
      runtimeStatus: 'Failed',
      createdSecondsAgo: failure.createdSecondsAgo,
      durationMs: 12000,
      terminal: true,
      input,
      output,
      customStatus: `{"error":"InventoryUnavailable","sku":"${failure.sku}"}`,
      history: (created) =>
        simpleHistory(created, {
          name: PROCESS_ORDER,
          input,
          activity: 'ReserveInventory',
          durationMs: 12000,
          ending: 'Failed',
          errorType: inventoryError,
          result: message,
          output,
        }),
    });
  }

  // Two timeouts: a second signature under the same orchestrator name
  const timeouts = [
    { instanceId: 'order-2026-09-04-000889', createdSecondsAgo: 7200 },
    { instanceId: 'order-2026-09-04-000885', createdSecondsAgo: 9000 },
  ];

  for (const timeout of timeouts) {
    const output = failureOutput('TimeoutException', timeoutMessage);
    const input = `{"orderId":"A-${timeout.instanceId.slice(-4)}","customerId":77310,"items":[{"sku":"SKU-9004","qty":1}],"total":129.5,"currency":"USD"}`;

    add({
      instanceId: timeout.instanceId,
      name: PROCESS_ORDER,
      executionId: `a1${timeout.instanceId.slice(-4)}b2-3c4d-4e5f-9a0b-1c2d3e4f5a6b`,
      runtimeStatus: 'Failed',
      createdSecondsAgo: timeout.createdSecondsAgo,
      durationMs: 20400,
      terminal: true,
      input,
      output,
      customStatus: '{"step":"ChargePayment","attempt":3}',
      history: (created) =>
        simpleHistory(created, {
          name: PROCESS_ORDER,
          input,
          activity: 'ChargePayment',
          durationMs: 20400,
          ending: 'Failed',
          errorType: 'TimeoutException',
          result: timeoutMessage,
          output,
        }),
    });
  }

  // A third signature, under a different orchestrator name
  const ledgerMessage = 'Ledger checksum mismatch for account "4471-EU"';
  const ledgerOutput = failureOutput('LedgerChecksumException', ledgerMessage);
  add({
    instanceId: 'nightly-reconcile-20260902',
    name: RECONCILE_LEDGER,
    executionId: '6f5e4d3c-2b1a-4098-8765-4321fedcba09',
    runtimeStatus: 'Failed',
    createdSecondsAgo: 108000,
    durationMs: 184000,
    terminal: true,
    input: '{"ledgerDate":"2026-09-02","accounts":18397}',
    output: ledgerOutput,
    history: (created) =>
      simpleHistory(created, {
        name: RECONCILE_LEDGER,
        input: '{"ledgerDate":"2026-09-02","accounts":18397}',
        activity: 'VerifyChecksums',
        durationMs: 184000,
        ending: 'Failed',
        errorType: 'LedgerChecksumException',
        result: ledgerMessage,
        output: ledgerOutput,
      }),
  });

  // ScreenInstances.dc.html L201-L202: the two entities, state in the framework's envelope
  const entitySpecs = [
    { instanceId: ENTITY_INSTANCE_ID, value: 1284, updatedSecondsAgo: 71 },
    { instanceId: '@counter@warehouse-12', value: 312, updatedSecondsAgo: 2569 },
  ];

  for (const entity of entitySpecs) {
    const createdSecondsAgo = 280978;
    const state = JSON.stringify({ value: entity.value });

    add({
      instanceId: entity.instanceId,
      name: entity.instanceId,
      executionId: `entity-${entity.instanceId.slice(-2)}-0000-4000-8000-000000000000`,
      runtimeStatus: ENTITY_RUNTIME_STATUS,
      createdSecondsAgo,
      durationMs: (createdSecondsAgo - entity.updatedSecondsAgo) * 1000,
      terminal: false,
      input: JSON.stringify({ exists: true, state }),
      isEntity: true,
      history: (created) => [
        row(0, 'OrchestratorStarted', created, -13),
        row(1, 'ExecutionStarted', created, 0, {
          name: entity.instanceId,
          input: JSON.stringify({ exists: false, state: null }),
        }),
        row(2, 'EventRaised', created, 91, { name: 'add', input: '{"amount":1}' }),
        row(3, 'OrchestratorCompleted', created, 100),
      ],
    });
  }

  // Enough rows for the table to page (E4-S9-T1): the mockup's nine cannot fill a 50-row page.
  // They are dull on purpose - one name, one status, a minute apart - so a spec can tell them from
  // the rows the mockups care about, and they are older than every one of those.
  for (let index = 0; index < (options.filler ?? 0); index += 1) {
    const createdSecondsAgo = 4000 + index * 60;

    add({
      instanceId: `${FILLER_INSTANCE_PREFIX}${String(index).padStart(3, '0')}`,
      name: FILLER_ORCHESTRATOR,
      executionId: `filler-${String(index).padStart(4, '0')}-0000-4000-8000-000000000000`,
      runtimeStatus: 'Completed',
      createdSecondsAgo,
      durationMs: 30_000,
      terminal: true,
      input: JSON.stringify({ index }),
      output: JSON.stringify({ ok: true }),
    });
  }

  const orchestrations = instances.filter((instance) => !instance.isEntity);
  const entities = instances.filter((instance) => instance.isEntity);

  /** @type {SeedBlob[]} */
  const blobs = [];
  let historyRowCount = 0;
  for (const instance of instances) {
    if (instance.inputBlob) {
      blobs.push(instance.inputBlob);
    }
    for (const historyRow of instance.history) {
      historyRowCount++;
      if (historyRow.inputBlob) {
        blobs.push(historyRow.inputBlob);
      }
    }
  }

  return { hub, now, instances, orchestrations, entities, blobs, historyRowCount };
}

/** Where the backend looks for a function map: `durable-functions-monitor/function-maps` (Globals). */
export const TEMPLATE_CONTAINER = 'durable-functions-monitor';

/** A map for every hub of the account, which is what a name without a hub segment means. */
export const FUNCTION_MAP_BLOB = 'function-maps/dfm-func-map.json';

/** The orchestrators of the seeded hub, which the Functions screen lists and draws. */
export const ORCHESTRATORS = {
  processOrder: PROCESS_ORDER,
  reconcileLedger: RECONCILE_LEDGER,
  onboardTenant: ONBOARD_TENANT,
  notifyCustomer: NOTIFY_CUSTOMER,
};

/**
 * The function map the seed publishes for this account: the hub the seed writes, described the way
 * az-func-as-a-graph describes a project. It is what makes `IsFunctionGraphAvailable` true on the
 * host, so the Functions screen has a graph to draw and the workspace has a Graph tab.
 *
 * The names are the ones the instances carry, so the table and the graph are about the same hub:
 * three triggers, three orchestrators, one sub-orchestration, five activities and the entity.
 *
 * @returns {{ functions: Record<string, object>; proxies: Record<string, object> }}
 */
export function buildFunctionMap() {
  /**
   * @param {string} trigger
   * @param {object} [extra]
   * @returns {object}
   */
  const fn = (trigger, extra = {}) => ({ bindings: [{ type: trigger, direction: 'in' }], ...extra });

  return {
    functions: {
      StartOrder: fn('httpTrigger'),
      NightlyReconcile: fn('timerTrigger'),
      OnPaymentSettled: fn('serviceBusTrigger'),
      StartOnboarding: fn('httpTrigger'),

      [PROCESS_ORDER]: fn('orchestrationTrigger', { isCalledBy: ['StartOrder', 'OnPaymentSettled'] }),
      [RECONCILE_LEDGER]: fn('orchestrationTrigger', { isCalledBy: ['NightlyReconcile'] }),
      [ONBOARD_TENANT]: fn('orchestrationTrigger', { isCalledBy: ['StartOnboarding'] }),

      // Called by an orchestration, which is what makes it a sub-orchestration
      [NOTIFY_CUSTOMER]: fn('orchestrationTrigger', { isCalledBy: [PROCESS_ORDER] }),

      ReserveInventory: fn('activityTrigger', { isCalledBy: [PROCESS_ORDER] }),
      ChargePayment: fn('activityTrigger', { isCalledBy: [PROCESS_ORDER] }),
      SendConfirmation: fn('activityTrigger', { isCalledBy: [PROCESS_ORDER] }),
      ExportReport: fn('activityTrigger', { isCalledBy: [RECONCILE_LEDGER] }),
      ArchiveBlob: fn('activityTrigger', { isCalledBy: [RECONCILE_LEDGER] }),

      Counter: fn('entityTrigger', { isSignalledBy: [{ name: PROCESS_ORDER, signalName: 'add' }] }),
    },
    proxies: {},
  };
}

/**
 * A failed instance that received an external event before it failed - the one state the Inputs tab
 * exists for, and the one the mockup's own rows do not cover: the initial input can no longer be
 * acted on (external events since), while the last `EventRaised` can be edited and rewound, or
 * replayed from.
 *
 * Built on its own rather than seeded into the hub by default, so a spec can create one per run and
 * rewrite it as much as it likes without moving the ground under any other spec.
 *
 * @param {string} instanceId
 * @param {Date} [now]
 * @returns {SeedInstance}
 */
export function buildRetryInstance(instanceId, now = new Date()) {
  const createdTime = ago(now, 900);
  const input =
    '{"orderId":"A-1099","customerId":88214,"items":[{"sku":"SKU-4471","qty":1}],"total":64.75,"currency":"USD"}';
  const eventInput = '{"approved":true,"approver":"ops@contoso.com","amount":64.75}';
  const message = 'ChargePayment: the payment gateway refused the approved amount';
  const output = failureOutput('PaymentRefusedException', message);

  return {
    instanceId,
    name: PROCESS_ORDER,
    executionId: `${instanceId}-exec`,
    runtimeStatus: 'Failed',
    createdTime,
    lastUpdatedTime: plus(createdTime, 21000),
    completedTime: plus(createdTime, 21000),
    input,
    output,
    customStatus: '{"step":"ChargePayment","attempt":2}',
    parentInstanceId: null,
    isEntity: false,
    history: [
      row(0, 'OrchestratorStarted', createdTime, -12),
      row(1, 'ExecutionStarted', createdTime, 0, { name: PROCESS_ORDER, input }),
      row(2, 'TaskScheduled', createdTime, 90, {
        name: 'ReserveInventory',
        eventId: 0,
        input: '{"sku":"SKU-4471","qty":1}',
      }),
      row(3, 'OrchestratorCompleted', createdTime, 100),
      row(4, 'OrchestratorStarted', createdTime, 1990),
      row(5, 'TaskCompleted', createdTime, 2000, { taskScheduledId: 0, result: '{"sku":"SKU-4471","reserved":1}' }),
      row(6, 'OrchestratorCompleted', createdTime, 2010),
      row(7, 'OrchestratorStarted', createdTime, 8990),
      // The external event this instance waited for, and the last input it ever received
      row(8, 'EventRaised', createdTime, 9000, { name: 'PaymentApproved', input: eventInput }),
      row(9, 'TaskScheduled', createdTime, 9100, {
        name: 'ChargePayment',
        eventId: 1,
        input: '{"amount":64.75,"currency":"USD"}',
      }),
      row(10, 'OrchestratorCompleted', createdTime, 9110),
      row(11, 'OrchestratorStarted', createdTime, 20890),
      row(12, 'TaskFailed', createdTime, 20900, {
        name: 'ChargePayment',
        taskScheduledId: 1,
        reason: 'PaymentRefusedException',
        details: message,
      }),
      row(13, 'ExecutionCompleted', createdTime, 21000, { orchestrationStatus: 'Failed', result: output }),
      row(14, 'OrchestratorCompleted', createdTime, 21010),
    ],
  };
}

/**
 * One durable entity, as the framework stores it: the instance id is `@name@key`, the state sits in the
 * Input column inside the framework's `{ exists, state }` envelope, and the row is `Pending` between
 * signals. Built on its own, so a spec that signals or purges an entity can own the one it touches.
 *
 * @param {string} instanceId `@name@key`
 * @param {unknown} state whatever the entity holds
 * @param {Date} [now]
 * @returns {SeedInstance}
 */
export function buildEntityInstance(instanceId, state, now = new Date()) {
  const createdTime = ago(now, 280978);

  return {
    instanceId,
    name: instanceId,
    executionId: `${instanceId}-exec`,
    runtimeStatus: ENTITY_RUNTIME_STATUS,
    createdTime,
    lastUpdatedTime: plus(createdTime, 280907000),
    completedTime: null,
    input: JSON.stringify({ exists: true, state: JSON.stringify(state) }),
    output: null,
    customStatus: null,
    parentInstanceId: null,
    isEntity: true,
    history: [
      row(0, 'OrchestratorStarted', createdTime, -13),
      row(1, 'ExecutionStarted', createdTime, 0, {
        name: instanceId,
        input: JSON.stringify({ exists: false, state: null }),
      }),
      row(2, 'EventRaised', createdTime, 91, { name: 'add', input: '{"amount":1}' }),
      row(3, 'OrchestratorCompleted', createdTime, 100),
    ],
  };
}

/** The sequence number of the `EventRaised` row `buildRetryInstance` writes: the last input event. */
export const RETRY_EVENT_SEQUENCE_NUMBER = 8;

/** What that event is called, which is what a replay raises again. */
export const RETRY_EVENT_NAME = 'PaymentApproved';
