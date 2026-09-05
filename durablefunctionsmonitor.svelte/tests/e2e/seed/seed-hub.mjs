#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Seeds the synthetic task hub the Playwright suite runs against (E3-S2-T1).
 *
 * Writes the rows the Durable Task Azure Storage provider would have written itself - `{hub}Instances`,
 * `{hub}History` with 16 hex digit row keys and a `sentinel` row per instance, the `{hub}-leases` container
 * with its `taskhub.json`, the `{hub}-largemessages` container for payloads above the 60 KB inline limit and
 * the (empty) control and work-item queues - so the standalone host lists and opens the seeded
 * orchestrations as if a real app had run them.
 *
 * Usage:
 *   node tests/e2e/seed/seed-hub.mjs [--reset] [--hub <name>] [--connection-string <cs>] [--quiet]
 *
 * Connection string: `DFM_TEST_STORAGE_CONNECTION_STRING`, or the Azurite default below.
 * Hub name: `--hub`, or `DFM_E2E_HUB`, or `DurableFunctionsHub`.
 *
 * Idempotent: every row is upserted, so running it twice leaves the same row counts. `--reset` drops the two
 * tables and the offloaded payloads first, for when the fixtures themselves changed.
 */

import process from 'node:process';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { QueueServiceClient } from '@azure/storage-queue';
import { buildSeedData, DEFAULT_HUB } from './fixtures.mjs';

/**
 * The well-known Azurite development account, the same one
 * `tests/durablefunctionsmonitor.dotnetisolated.core.integrationtests/StorageEmulator.cs` uses. The account
 * key below is public and documented by Microsoft - it is not a secret.
 */
export const AZURITE_CONNECTION_STRING =
  'AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'DefaultEndpointsProtocol=http;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' +
  'QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;' +
  'TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';

/** The partition count `taskhub.json` declares, and therefore the number of control queues. */
export const PARTITION_COUNT = 4;

/** Table Storage refuses transactions of more than 100 entities. */
const MAX_BATCH_SIZE = 100;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveConnectionString(env = process.env) {
  return env.DFM_TEST_STORAGE_CONNECTION_STRING || AZURITE_CONNECTION_STRING;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveHubName(env = process.env) {
  return env.DFM_E2E_HUB || DEFAULT_HUB;
}

/**
 * @param {string} hub
 * @returns {{ instances: string; history: string }}
 */
export function tableNames(hub) {
  return { instances: `${hub}Instances`, history: `${hub}History` };
}

/**
 * Blob containers and queues are lower case, the way the framework names them.
 * @param {string} hub
 * @returns {{ leases: string; largeMessages: string }}
 */
export function containerNames(hub) {
  return { leases: `${hub.toLowerCase()}-leases`, largeMessages: `${hub.toLowerCase()}-largemessages` };
}

/**
 * @param {string} hub
 * @returns {string[]}
 */
export function queueNames(hub) {
  const prefix = hub.toLowerCase();
  const controlQueues = [];
  for (let partition = 0; partition < PARTITION_COUNT; partition++) {
    controlQueues.push(`${prefix}-control-${String(partition).padStart(2, '0')}`);
  }

  return [`${prefix}-workitems`, ...controlQueues];
}

/**
 * The RowKey the framework gives a history row: its sequence number as 16 upper case hex digits.
 * @param {number} sequenceNumber
 * @returns {string}
 */
export function historyRowKey(sequenceNumber) {
  return sequenceNumber.toString(16).toUpperCase().padStart(16, '0');
}

/**
 * @param {number} value
 * @returns {{ value: number; type: 'Int32' }} an explicitly typed column, so .NET reads it back with GetInt32
 */
function int32(value) {
  return { value, type: 'Int32' };
}

/**
 * The `BlobEndpoint` of a connection string, without its trailing slash.
 * @param {string} connectionString
 * @returns {string}
 */
export function blobEndpointOf(connectionString) {
  for (const part of connectionString.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex > 0 && part.slice(0, separatorIndex).trim() === 'BlobEndpoint') {
      return part
        .slice(separatorIndex + 1)
        .trim()
        .replace(/\/$/, '');
    }
  }

  const accountName = /(?:^|;)\s*AccountName=([^;]+)/.exec(connectionString)?.[1];

  return `https://${accountName}.blob.core.windows.net`;
}

/**
 * One row of the Instances table. A payload above the inline limit is not in the row at all: the framework
 * puts the blob's URL in the column instead.
 *
 * @param {import('./fixtures.mjs').SeedInstance} instance
 * @param {string} hub
 * @param {string} largeMessageBaseUrl
 * @returns {Record<string, unknown>}
 */
export function instanceEntity(instance, hub, largeMessageBaseUrl) {
  /** @type {Record<string, unknown>} */
  const entity = {
    partitionKey: instance.instanceId,
    rowKey: '',
    ExecutionId: instance.executionId,
    Name: instance.name,
    Version: '',
    RuntimeStatus: instance.runtimeStatus,
    CreatedTime: instance.createdTime,
    LastUpdatedTime: instance.lastUpdatedTime,
    TaskHubName: hub,
    Generation: int32(0),
  };

  if (instance.inputBlob) {
    entity.Input = `${largeMessageBaseUrl}/${instance.inputBlob.name}`;
  } else if (instance.input !== null) {
    entity.Input = instance.input;
  }

  if (instance.output !== null) {
    entity.Output = instance.output;
  }

  if (instance.customStatus !== null) {
    entity.CustomStatus = instance.customStatus;
  }

  if (instance.completedTime !== null) {
    entity.CompletedTime = instance.completedTime;
  }

  if (instance.parentInstanceId !== null) {
    entity.ParentInstanceId = instance.parentInstanceId;
  }

  return entity;
}

/**
 * One row of the History table.
 *
 * @param {import('./fixtures.mjs').SeedInstance} instance
 * @param {import('./fixtures.mjs').SeedHistoryRow} row
 * @returns {Record<string, unknown>}
 */
export function historyEntity(instance, row) {
  /** @type {Record<string, unknown>} */
  const entity = {
    partitionKey: instance.instanceId,
    rowKey: historyRowKey(row.sequenceNumber),
    ExecutionId: instance.executionId,
    EventType: row.eventType,
    _Timestamp: row.timestamp,
    IsPlayed: true,
    EventId: int32(row.eventId),
  };

  if (row.name !== undefined) {
    entity.Name = row.name;
  }

  if (row.inputBlob) {
    // What the framework leaves behind when it offloads a payload: an empty cell and the blob's name
    entity.Input = '';
    entity.InputBlobName = row.inputBlob.name;
  } else if (row.input !== undefined) {
    entity.Input = row.input;
  }

  if (row.result !== undefined) {
    entity.Result = row.result;
  }

  if (row.reason !== undefined) {
    entity.Reason = row.reason;
  }

  if (row.details !== undefined) {
    entity.Details = row.details;
  }

  if (row.taskScheduledId !== undefined) {
    entity.TaskScheduledId = int32(row.taskScheduledId);
  }

  if (row.timerId !== undefined) {
    entity.TimerId = int32(row.timerId);
  }

  if (row.fireAt !== undefined) {
    entity.FireAt = row.fireAt;
  }

  if (row.instanceId !== undefined) {
    entity.InstanceId = row.instanceId;
  }

  if (row.orchestrationStatus !== undefined) {
    entity.OrchestrationStatus = row.orchestrationStatus;
  }

  return entity;
}

/**
 * The row the framework keeps at the end of every history partition. Its ETag is what a live session
 * checkpoints against.
 *
 * @param {import('./fixtures.mjs').SeedInstance} instance
 * @returns {Record<string, unknown>}
 */
export function sentinelEntity(instance) {
  return {
    partitionKey: instance.instanceId,
    rowKey: 'sentinel',
    ExecutionId: instance.executionId,
    IsCheckpointComplete: true,
    CheckpointCompletedTimestamp: instance.lastUpdatedTime,
  };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
function statusCodeOf(error) {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? /** @type {{ statusCode?: number }} */ (error).statusCode
    : undefined;
}

/**
 * Creating a table right after deleting it fails until the service finished the deletion, which on real
 * Azure takes up to a minute.
 *
 * @param {TableServiceClient} tableService
 * @param {string} name
 * @returns {Promise<void>}
 */
async function createTable(tableService, name) {
  const deadline = Date.now() + 120_000;

  for (;;) {
    try {
      await tableService.createTable(name);
      return;
    } catch (error) {
      if (statusCodeOf(error) !== 409) {
        throw error;
      }

      const code = /** @type {{ details?: { errorCode?: string } }} */ (error).details?.errorCode;
      if (code === 'TableAlreadyExists') {
        return;
      }

      if (Date.now() > deadline) {
        throw error;
      }

      await delay(3000);
    }
  }
}

/**
 * @param {import('@azure/data-tables').TableClient} tableClient
 * @param {Record<string, unknown>[]} entities all of one partition
 * @returns {Promise<void>}
 */
async function upsertBatch(tableClient, entities) {
  for (let start = 0; start < entities.length; start += MAX_BATCH_SIZE) {
    const chunk = entities.slice(start, start + MAX_BATCH_SIZE);

    await tableClient.submitTransaction(chunk.map((entity) => ['upsert', /** @type {never} */ (entity), 'Replace']));
  }
}

/**
 * @typedef {object} SeedSummary
 * @property {string} hub
 * @property {string} instancesTable
 * @property {string} historyTable
 * @property {number} instanceRows
 * @property {number} orchestrations
 * @property {number} entities
 * @property {number} historyRows
 * @property {number} sentinelRows
 * @property {number} blobs
 * @property {string[]} queues
 */

/**
 * Creates the hub's tables, containers and queues and writes every fixture row into them.
 *
 * @param {object} [options]
 * @param {string} [options.connectionString]
 * @param {string} [options.hub]
 * @param {boolean} [options.reset] drop the tables and the offloaded payloads first
 * @param {Date} [options.now] the moment the fixtures are relative to
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<SeedSummary>}
 */
export async function seedHub(options = {}) {
  const connectionString = options.connectionString ?? resolveConnectionString();
  const hub = options.hub ?? resolveHubName();
  const log = options.log ?? (() => {});

  const tables = tableNames(hub);
  const containers = containerNames(hub);
  const queues = queueNames(hub);
  const seed = buildSeedData(hub, options.now ?? new Date());

  const tableService = TableServiceClient.fromConnectionString(connectionString, { allowInsecureConnection: true });
  const blobService = BlobServiceClient.fromConnectionString(connectionString);
  const queueService = QueueServiceClient.fromConnectionString(connectionString);

  const largeMessages = blobService.getContainerClient(containers.largeMessages);
  const leases = blobService.getContainerClient(containers.leases);

  if (options.reset) {
    log(`Dropping ${tables.instances}, ${tables.history} and the offloaded payloads of ${containers.largeMessages}`);

    for (const table of [tables.instances, tables.history]) {
      await tableService.deleteTable(table);
    }

    if (await largeMessages.exists()) {
      for await (const blob of largeMessages.listBlobsFlat()) {
        await largeMessages.deleteBlob(blob.name);
      }
    }
  }

  await createTable(tableService, tables.instances);
  await createTable(tableService, tables.history);
  await largeMessages.createIfNotExists();
  await leases.createIfNotExists();

  for (const queue of queues) {
    await queueService.getQueueClient(queue).createIfNotExists();
  }

  // The blob the framework writes when it creates a task hub, and reads to find out how many partitions it has
  const taskHubJson = JSON.stringify({
    TaskHubName: hub,
    CreatedAt: new Date().toISOString(),
    PartitionCount: PARTITION_COUNT,
  });
  await leases.getBlockBlobClient('taskhub.json').upload(taskHubJson, Buffer.byteLength(taskHubJson), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  // Payloads above the inline limit live in '{hub}-largemessages', gzipped
  for (const blob of seed.blobs) {
    const compressed = gzipSync(Buffer.from(blob.text, 'utf8'));
    await largeMessages.getBlockBlobClient(blob.name).uploadData(compressed);
  }

  const largeMessageBaseUrl = `${blobEndpointOf(connectionString)}/${containers.largeMessages}`;
  const instancesTable = TableClient.fromConnectionString(connectionString, tables.instances, {
    allowInsecureConnection: true,
  });
  const historyTable = TableClient.fromConnectionString(connectionString, tables.history, {
    allowInsecureConnection: true,
  });

  let historyRows = 0;
  let sentinelRows = 0;

  for (const instance of seed.instances) {
    await instancesTable.upsertEntity(instanceEntity(instance, hub, largeMessageBaseUrl), 'Replace');

    if (instance.history.length === 0) {
      continue;
    }

    const rows = instance.history.map((row) => historyEntity(instance, row));
    rows.push(sentinelEntity(instance));
    await upsertBatch(historyTable, rows);

    historyRows += instance.history.length;
    sentinelRows++;
  }

  log(
    `Seeded task hub '${hub}': ${tables.instances} ${seed.instances.length} rows ` +
      `(${seed.orchestrations.length} orchestrations, ${seed.entities.length} entities), ` +
      `${tables.history} ${historyRows} rows + ${sentinelRows} sentinel rows, ` +
      `${containers.largeMessages} ${seed.blobs.length} blobs, ` +
      `${containers.leases} taskhub.json, queues ${queues.join(', ')}`,
  );

  return {
    hub,
    instancesTable: tables.instances,
    historyTable: tables.history,
    instanceRows: seed.instances.length,
    orchestrations: seed.orchestrations.length,
    entities: seed.entities.length,
    historyRows,
    sentinelRows,
    blobs: seed.blobs.length,
    queues,
  };
}

/**
 * @param {string[]} argv
 * @returns {{ hub?: string; connectionString?: string; reset: boolean; quiet: boolean; help: boolean }}
 */
export function parseSeedArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      hub: { type: 'string' },
      'connection-string': { type: 'string' },
      reset: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  return {
    hub: values.hub,
    connectionString: values['connection-string'],
    reset: values.reset === true,
    quiet: values.quiet === true,
    help: values.help === true,
  };
}

const USAGE = `Usage: node tests/e2e/seed/seed-hub.mjs [options]

  --hub <name>                task hub to seed (default: $DFM_E2E_HUB or ${DEFAULT_HUB})
  --connection-string <cs>    storage account (default: $DFM_TEST_STORAGE_CONNECTION_STRING or Azurite)
  --reset                     drop the tables and offloaded payloads before seeding
  --quiet                     print nothing on success
  --help                      print this
`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseSeedArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(USAGE);
  } else {
    await seedHub({
      hub: args.hub,
      connectionString: args.connectionString,
      reset: args.reset,
      log: args.quiet ? undefined : (message) => process.stdout.write(`${message}\n`),
    });
  }
}
