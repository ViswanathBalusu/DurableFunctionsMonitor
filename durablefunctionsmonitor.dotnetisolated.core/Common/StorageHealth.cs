// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Globalization;
using Azure;
using Azure.Data.Tables;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Queues;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The Azure Storage implementation of DfmExtensionPoints.GetStorageHealthRoutine - everything the
    /// /storage endpoint (and the Overview backlog panel) shows, read straight from the storage account
    /// rather than from the Durable Task Framework.
    ///
    /// The layout is the one DurableTask.AzureStorage creates for a Task Hub:
    ///   - '{hub lower}-leases' holds 'taskhub.json' (the blob written when the hub is created, carrying
    ///     the partition count every worker then agrees on) and, on hubs using the blob partition manager,
    ///     one lease blob per control queue;
    ///   - '{hub lower}-control-NN' (one per partition) and '{hub lower}-workitems' are the queues whose
    ///     depth is the actual backlog;
    ///   - '{hub}Partitions' is the table the newer table partition manager keeps ownership in;
    ///   - '{hub lower}-largemessages' holds the payloads that did not fit into a table column.
    ///
    /// Nothing here applies to a provider other than Azure Storage: MSSQL and Netherite have no such
    /// queues, so those packages set the routine to null and /about reports storageHealth false.
    /// </summary>
    static class StorageHealth
    {
        /// <summary>
        /// Collects the storage health of one Task Hub.
        ///
        /// Every individual read degrades to a null rather than failing the whole request: a queue that is
        /// not there, a taskhub.json that was never written and a Partitions table that does not exist are
        /// all normal states of a real account, and the response says so explicitly (a null count, an
        /// 'unknown'/'none' source) instead of pretending otherwise.
        ///
        /// Provider and AccountName are deliberately left unset: they belong to the caller (B4-S1-T3, the
        /// /storage function), which fills them from DfmExtensionPoints.ProviderName and the connection string.
        /// </summary>
        /// <param name="connEnvVariableName">Name of the environment variable holding the connection string</param>
        /// <param name="hubName">Task Hub name, in its original casing</param>
        /// <param name="counts">Whether to also count the rows of the Instances and History tables (expensive)</param>
        /// <param name="instanceId">Optional instance to scope the large-message statistics to</param>
        /// <param name="ct">Cancellation token</param>
        public static async Task<StorageHealthResult> GetAsync(string connEnvVariableName, string hubName, bool counts, string instanceId, CancellationToken ct)
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            var blobServiceClient = Globals.GetBlobServiceClient(connEnvVariableName);
            var queueServiceClient = Globals.GetQueueServiceClient(connEnvVariableName);
            var tableClient = TableClient.GetTableClient(connEnvVariableName);

            var leasesContainer = blobServiceClient.GetBlobContainerClient(GetLeasesContainerName(hubName));

            // The partition count decides how many control queues (and therefore partitions) there are, so
            // this comes first. A hub whose taskhub.json cannot be read falls back to the framework's own
            // default of 4, which is what the overwhelming majority of hubs run with.
            var taskHubInfo = ParseTaskHubInfo(hubName, await TryDownloadTaskHubJsonAsync(leasesContainer, ct));
            int partitionCount = taskHubInfo.PartitionCount ?? DefaultPartitionCount;

            var queues = BuildQueueList(hubName, taskHubInfo.PartitionCount);
            foreach (var queue in queues)
            {
                queue.ApproximateMessageCount = await TryGetApproximateMessageCountAsync(queueServiceClient, queue.Name, ct);
            }

            var tableNames = await TryListTableNamesAsync(tableClient);

            string instancesTable = $"{hubName}Instances";
            string historyTable = $"{hubName}History";
            string partitionsTable = $"{hubName}{PartitionsTableSuffix}";
            string auditTable = $"{hubName}{AuditTableSuffix}";

            var tables = new StorageTablesInfo
            {
                // The two tables a hub cannot work without are always named, whether or not they exist yet
                Instances = instancesTable,
                History = historyTable,
                Partitions = tableNames.Contains(partitionsTable) ? partitionsTable : null,
                Audit = tableNames.Contains(auditTable) ? auditTable : null
            };

            var partitions = await GetPartitionsAsync(tableClient, tables.Partitions, leasesContainer, hubName, partitionCount, ct);

            var largeMessages = await GetLargeMessagesAsync(blobServiceClient, hubName, instanceId, ct);

            var rowCounts = new StorageCountsInfo();
            if (counts)
            {
                // Both scans are projected down to the keys and capped, so the worst case is bounded by
                // MaxRowsToCount rather than by the size of the hub. Truncation is reported, never hidden.
                var (instancesRows, instancesTruncated) = await TryCountRowsAsync(tableClient, tableNames, instancesTable, ct);
                var (historyRows, historyTruncated) = await TryCountRowsAsync(tableClient, tableNames, historyTable, ct);

                rowCounts.InstancesRows = instancesRows;
                rowCounts.HistoryRows = historyRows;
                rowCounts.Partial = instancesTruncated || historyTruncated;
            }

            return new StorageHealthResult
            {
                TaskHub = taskHubInfo,
                Queues = queues,
                Partitions = partitions,
                Tables = tables,
                LargeMessages = largeMessages,
                Counts = rowCounts,
                GeneratedAt = DateTimeOffset.UtcNow,
                ElapsedMs = stopwatch.ElapsedMilliseconds,
                Cached = false
            };
        }

        #region Naming

        /// <summary>Container the framework keeps taskhub.json and the lease blobs in.</summary>
        internal static string GetLeasesContainerName(string hubName)
        {
            return $"{hubName.ToLowerInvariant()}-leases";
        }

        /// <summary>The queue activities are picked up from. One per hub.</summary>
        internal static string GetWorkItemQueueName(string hubName)
        {
            return $"{hubName.ToLowerInvariant()}-workitems";
        }

        /// <summary>The queue the orchestrator messages of one partition go through.</summary>
        internal static string GetControlQueueName(string hubName, int partition)
        {
            return $"{hubName.ToLowerInvariant()}-control-{partition:00}";
        }

        #endregion

        #region Pure parsing

        /// <summary>
        /// Turns the contents of '{hub lower}-leases/taskhub.json' into the taskHub part of the response.
        ///
        /// The blob is DurableTask.AzureStorage's TaskHubInfo: { "TaskHubName", "CreatedAt", "PartitionCount" }.
        /// Anything that cannot be read from it - a missing blob, a truncated or reshaped document, a
        /// partition count that is not a number - leaves the corresponding field null, and a document that
        /// is not there at all leaves the source 'unknown', so the UI can say 'not known' rather than show
        /// a made-up 4.
        /// </summary>
        internal static StorageTaskHubInfo ParseTaskHubInfo(string hubName, string json)
        {
            var result = new StorageTaskHubInfo
            {
                Name = hubName,
                PartitionCount = null,
                CreatedAt = null,
                Source = TaskHubSourceUnknown
            };

            if (string.IsNullOrWhiteSpace(json))
            {
                return result;
            }

            JObject document;
            try
            {
                // DateParseHandling.None keeps 'CreatedAt' a string, so ToDateTimeOffset() below is the only
                // place a date is interpreted (and always as UTC).
                document = JsonConvert.DeserializeObject<JObject>(json, new JsonSerializerSettings { DateParseHandling = DateParseHandling.None });
            }
            catch (JsonException)
            {
                return result;
            }

            if (document == null)
            {
                return result;
            }

            result.Source = TaskHubSourceTaskHubJson;
            result.PartitionCount = TryGetInt32(document, PartitionCountProperty);
            result.CreatedAt = TryGetDateTimeOffset(document, CreatedAtProperty);

            return result;
        }

        /// <summary>
        /// The queues of a hub, in the order the Storage screen lists them: the work-item queue first, then
        /// one control queue per partition. Counts are left null for the caller to fill in.
        /// A hub whose partition count is unknown is assumed to run the framework default of 4.
        /// </summary>
        internal static List<StorageQueueInfo> BuildQueueList(string hubName, int? partitionCount)
        {
            int partitions = partitionCount ?? DefaultPartitionCount;

            var result = new List<StorageQueueInfo>
            {
                new StorageQueueInfo
                {
                    Name = GetWorkItemQueueName(hubName),
                    Kind = QueueKindWorkItems,
                    Partition = null,
                    ApproximateMessageCount = null
                }
            };

            for (int partition = 0; partition < partitions; partition++)
            {
                result.Add(new StorageQueueInfo
                {
                    Name = GetControlQueueName(hubName, partition),
                    Kind = QueueKindControl,
                    Partition = partition,
                    ApproximateMessageCount = null
                });
            }

            return result;
        }

        /// <summary>
        /// Maps one row of the '{hub}Partitions' table onto a partition of the response.
        ///
        /// IMPORTANT: the column names below are those of DurableTask.AzureStorage's TableLease, the entity
        /// its table partition manager writes (RowKey = the control queue name, CurrentOwner/NextOwner =
        /// worker ids, OwnedSince = when the current owner took over, IsDraining = a hand-over in progress).
        /// They are a storage detail of another library, not a contract, which is why the lookup is tolerant
        /// (case-insensitive, and forgiving about the stored CLR type) and why StorageHealthParsingTests
        /// parses a captured row shape: should the framework rename a column, that test fails instead of the
        /// Storage screen quietly showing every partition as unowned.
        /// </summary>
        internal static StoragePartitionInfo ParsePartitionRow(TableEntity row)
        {
            return new StoragePartitionInfo
            {
                Name = row.RowKey,
                Owner = NullIfEmpty(TryGetString(row, CurrentOwnerColumn)),
                OwnedSince = TryGetDateTimeOffset(row, OwnedSinceColumn),
                IsDraining = TryGetBoolean(row, IsDrainingColumn),
                NextOwner = NullIfEmpty(TryGetString(row, NextOwnerColumn)),
                Source = PartitionSourceTable
            };
        }

        /// <summary>
        /// Maps one lease blob of '{hub lower}-leases' onto a partition. Hubs on the blob partition manager
        /// have no Partitions table: the owner is a piece of blob metadata, and the only timestamp available
        /// is the blob's own LastModified, which is when the current owner last renewed (or took) the lease.
        /// Draining and the next owner are not expressible there, hence null.
        /// </summary>
        internal static StoragePartitionInfo ParseLeaseBlob(string blobName, IDictionary<string, string> metadata, DateTimeOffset? lastModified)
        {
            return new StoragePartitionInfo
            {
                Name = blobName,
                Owner = NullIfEmpty(TryGetMetadata(metadata, LeaseOwnerMetadataName)),
                OwnedSince = lastModified?.ToUniversalTime(),
                IsDraining = null,
                NextOwner = null,
                Source = PartitionSourceLeaseBlob
            };
        }

        /// <summary>
        /// A partition nothing could be said about: neither a Partitions table nor a lease blob was found.
        /// The name is still known (it is the control queue's), so the screen can show the row and be
        /// explicit that ownership is unavailable rather than drop the partition altogether.
        /// </summary>
        internal static StoragePartitionInfo UnknownPartition(string hubName, int partition)
        {
            return new StoragePartitionInfo
            {
                Name = GetControlQueueName(hubName, partition),
                Owner = null,
                OwnedSince = null,
                IsDraining = null,
                NextOwner = null,
                Source = PartitionSourceNone
            };
        }

        #endregion

        #region Storage reads

        private static async Task<string> TryDownloadTaskHubJsonAsync(BlobContainerClient leasesContainer, CancellationToken ct)
        {
            try
            {
                var response = await leasesContainer.GetBlobClient(TaskHubBlobName).DownloadContentAsync(ct);

                return response.Value.Content.ToString();
            }
            catch (RequestFailedException)
            {
                // No container, no blob, or no permission to read it - all of them mean 'not known'
                return null;
            }
        }

        private static async Task<int?> TryGetApproximateMessageCountAsync(QueueServiceClient queueServiceClient, string queueName, CancellationToken ct)
        {
            try
            {
                var properties = await queueServiceClient.GetQueueClient(queueName).GetPropertiesAsync(ct);

                return properties.Value.ApproximateMessagesCount;
            }
            catch (RequestFailedException)
            {
                // A control queue past the hub's real partition count, a hub that never started, or a queue
                // that could not be read. ApproximateMessageCount is null for all of them.
                return null;
            }
        }

        private static async Task<HashSet<string>> TryListTableNamesAsync(ITableClient tableClient)
        {
            try
            {
                return new HashSet<string>(await tableClient.ListTableNamesAsync(), StringComparer.OrdinalIgnoreCase);
            }
            catch (RequestFailedException)
            {
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }
        }

        private static async Task<IReadOnlyList<StoragePartitionInfo>> GetPartitionsAsync(
            ITableClient tableClient,
            string partitionsTableName,
            BlobContainerClient leasesContainer,
            string hubName,
            int partitionCount,
            CancellationToken ct)
        {
            // The table partition manager is the newer of the two and, where it is in use, the only one that
            // knows about draining and hand-overs. So it wins whenever it has anything to say.
            if (partitionsTableName != null)
            {
                var rows = await TryQueryPartitionRowsAsync(tableClient, partitionsTableName, ct);
                if (rows.Count > 0)
                {
                    return rows
                        .OrderBy(row => row.RowKey, StringComparer.Ordinal)
                        .Select(ParsePartitionRow)
                        .ToList();
                }
            }

            var leaseBlobs = await TryListLeaseBlobsAsync(leasesContainer, hubName, ct);
            if (leaseBlobs.Count > 0)
            {
                return leaseBlobs
                    .OrderBy(blob => blob.Name, StringComparer.Ordinal)
                    .Select(blob => ParseLeaseBlob(blob.Name, blob.Metadata, blob.Properties?.LastModified))
                    .ToList();
            }

            return Enumerable.Range(0, partitionCount).Select(partition => UnknownPartition(hubName, partition)).ToList();
        }

        private static async Task<IReadOnlyList<TableEntity>> TryQueryPartitionRowsAsync(ITableClient tableClient, string partitionsTableName, CancellationToken ct)
        {
            try
            {
                // No filter: the framework has not always used the same PartitionKey convention for this
                // table, and the table is per-hub anyway. The cap keeps the scan bounded regardless.
                var (rows, _) = await tableClient.QueryAsync(partitionsTableName, null, PartitionColumns, MaxPartitionRowsToScan, ct);

                return rows;
            }
            catch (RequestFailedException)
            {
                return Array.Empty<TableEntity>();
            }
        }

        private static async Task<IReadOnlyList<BlobItem>> TryListLeaseBlobsAsync(BlobContainerClient leasesContainer, string hubName, CancellationToken ct)
        {
            var result = new List<BlobItem>();

            try
            {
                // The '{hub lower}-control-' prefix also excludes taskhub.json, which lives in the same container
                string prefix = $"{hubName.ToLowerInvariant()}-control-";

                await foreach (var blob in leasesContainer.GetBlobsAsync(BlobTraits.Metadata, BlobStates.None, prefix, ct))
                {
                    result.Add(blob);

                    if (result.Count >= MaxPartitionRowsToScan)
                    {
                        break;
                    }
                }
            }
            catch (RequestFailedException)
            {
                return Array.Empty<BlobItem>();
            }

            return result;
        }

        private static async Task<StorageLargeMessagesInfo> GetLargeMessagesAsync(BlobServiceClient blobServiceClient, string hubName, string instanceId, CancellationToken ct)
        {
            string containerName = LargeMessageBlobs.GetContainerName(hubName);

            var result = new StorageLargeMessagesInfo
            {
                Container = containerName,
                Exists = false,
                BlobCount = null,
                TotalBytes = null
            };

            var container = blobServiceClient.GetBlobContainerClient(containerName);

            try
            {
                result.Exists = await container.ExistsAsync(ct);
            }
            catch (RequestFailedException)
            {
                return result;
            }

            if (!result.Exists || string.IsNullOrEmpty(instanceId))
            {
                // Without an instance there is nothing cheap to count: the container holds the payloads of
                // the whole hub, so both numbers stay null rather than trigger a full container listing.
                return result;
            }

            try
            {
                int blobCount = 0;
                long totalBytes = 0;

                // The framework names an offloaded payload '{instanceId}/...', so this prefix is what bounds
                // the listing: it only ever walks the blobs of the one instance that was asked about.
                await foreach (var blob in container.GetBlobsAsync(BlobTraits.None, BlobStates.None, $"{instanceId}/", ct))
                {
                    blobCount++;
                    totalBytes += blob.Properties?.ContentLength ?? 0;
                }

                result.BlobCount = blobCount;
                result.TotalBytes = totalBytes;
            }
            catch (RequestFailedException)
            {
                result.BlobCount = null;
                result.TotalBytes = null;
            }

            return result;
        }

        private static async Task<(long? count, bool truncated)> TryCountRowsAsync(ITableClient tableClient, HashSet<string> tableNames, string tableName, CancellationToken ct)
        {
            if (!tableNames.Contains(tableName))
            {
                // A hub that never ran has no tables. That is 'unknown', not zero.
                return (null, false);
            }

            try
            {
                // Projected down to the keys: counting rows must never drag Input/Output/CustomStatus over
                // the wire. ITableClient adds PartitionKey and RowKey to every projection.
                var (rows, truncated) = await tableClient.QueryAsync(tableName, null, CountColumns, MaxRowsToCount, ct);

                return (rows.Count, truncated);
            }
            catch (RequestFailedException)
            {
                return (null, false);
            }
        }

        #endregion

        #region Tolerant readers

        // Every reader below is deliberately forgiving: these rows and documents are written by other
        // libraries, and a column that changed its CLR type (or its casing) has to degrade to 'unknown'
        // rather than throw a 500 at a screen whose whole job is to say what the storage account looks like.

        private static string TryGetString(TableEntity entity, string columnName)
        {
            return TryGetValue(entity, columnName, out object value) ? value as string : null;
        }

        private static bool? TryGetBoolean(TableEntity entity, string columnName)
        {
            if (!TryGetValue(entity, columnName, out object value))
            {
                return null;
            }

            switch (value)
            {
                case bool booleanValue:
                    return booleanValue;
                case string stringValue:
                    return bool.TryParse(stringValue, out bool parsedValue) ? parsedValue : null;
                default:
                    return null;
            }
        }

        private static DateTimeOffset? TryGetDateTimeOffset(TableEntity entity, string columnName)
        {
            return TryGetValue(entity, columnName, out object value) ? ToDateTimeOffset(value) : null;
        }

        private static bool TryGetValue(TableEntity entity, string columnName, out object value)
        {
            if (entity.TryGetValue(columnName, out value) && value != null)
            {
                return true;
            }

            // Case-insensitive fallback, so a row written with a different spelling still reads
            foreach (var pair in entity)
            {
                if (string.Equals(pair.Key, columnName, StringComparison.OrdinalIgnoreCase) && pair.Value != null)
                {
                    value = pair.Value;
                    return true;
                }
            }

            value = null;
            return false;
        }

        private static int? TryGetInt32(JObject document, string propertyName)
        {
            var token = GetProperty(document, propertyName);
            if (token == null)
            {
                return null;
            }

            switch (token.Type)
            {
                case JTokenType.Integer:
                    long longValue = token.Value<long>();
                    return longValue >= int.MinValue && longValue <= int.MaxValue ? (int)longValue : null;
                case JTokenType.String:
                    return int.TryParse(token.Value<string>(), NumberStyles.Integer, CultureInfo.InvariantCulture, out int parsedValue) ? parsedValue : null;
                default:
                    return null;
            }
        }

        private static DateTimeOffset? TryGetDateTimeOffset(JObject document, string propertyName)
        {
            var token = GetProperty(document, propertyName);
            if (token == null)
            {
                return null;
            }

            return ToDateTimeOffset(token is JValue jValue ? jValue.Value : null);
        }

        private static JToken GetProperty(JObject document, string propertyName)
        {
            // OrdinalIgnoreCase, because nothing guarantees the casing of a blob another library wrote
            var token = document.GetValue(propertyName, StringComparison.OrdinalIgnoreCase);

            return token == null || token.Type == JTokenType.Null ? null : token;
        }

        private static DateTimeOffset? ToDateTimeOffset(object value)
        {
            switch (value)
            {
                case DateTimeOffset dateTimeOffsetValue:
                    return dateTimeOffsetValue.ToUniversalTime();
                case DateTime dateTimeValue:
                    return new DateTimeOffset(dateTimeValue.ToUniversalTime(), TimeSpan.Zero);
                case string stringValue:
                    return DateTimeOffset.TryParse(stringValue, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsedValue) ? parsedValue : null;
                default:
                    return null;
            }
        }

        private static string TryGetMetadata(IDictionary<string, string> metadata, string name)
        {
            if (metadata == null)
            {
                return null;
            }

            if (metadata.TryGetValue(name, out string value))
            {
                return value;
            }

            // Storage lower-cases metadata keys on the way out, but nothing promises that forever
            foreach (var pair in metadata)
            {
                if (string.Equals(pair.Key, name, StringComparison.OrdinalIgnoreCase))
                {
                    return pair.Value;
                }
            }

            return null;
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }

        #endregion

        internal const string TaskHubBlobName = "taskhub.json";

        internal const string TaskHubSourceTaskHubJson = "taskhub.json";
        internal const string TaskHubSourceUnknown = "unknown";

        internal const string QueueKindWorkItems = "workitems";
        internal const string QueueKindControl = "control";

        internal const string PartitionSourceTable = "table";
        internal const string PartitionSourceLeaseBlob = "lease-blob";
        internal const string PartitionSourceNone = "none";

        internal const string PartitionsTableSuffix = "Partitions";
        internal const string AuditTableSuffix = "DfmAudit";

        /// <summary>The number of control queues DurableTask.AzureStorage creates unless told otherwise.</summary>
        internal const int DefaultPartitionCount = 4;

        /// <summary>Cap of the row counts of the /storage response, per table.</summary>
        internal const int MaxRowsToCount = 200000;

        /// <summary>
        /// A Task Hub cannot have more partitions than this (the framework's own maximum is 16), so a
        /// Partitions table or lease-blob listing beyond it is a sign of something else living there.
        /// </summary>
        internal const int MaxPartitionRowsToScan = 256;

        // Properties of DurableTask.AzureStorage's TaskHubInfo, the contents of taskhub.json
        private const string PartitionCountProperty = "PartitionCount";
        private const string CreatedAtProperty = "CreatedAt";

        // Columns of DurableTask.AzureStorage's TableLease - see ParsePartitionRow
        private const string CurrentOwnerColumn = "CurrentOwner";
        private const string NextOwnerColumn = "NextOwner";
        private const string OwnedSinceColumn = "OwnedSince";
        private const string IsDrainingColumn = "IsDraining";

        // Metadata key the blob partition manager stores the lease owner under
        private const string LeaseOwnerMetadataName = "owner";

        private static readonly string[] PartitionColumns = new[] { CurrentOwnerColumn, NextOwnerColumn, OwnedSinceColumn, IsDrainingColumn };

        // Nothing but the keys: PartitionKey and RowKey are added to every projection anyway, and a count
        // needs no other column
        private static readonly string[] CountColumns = new[] { "PartitionKey" };
    }
}
