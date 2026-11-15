// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Text;
using Azure.Data.Tables;
using Microsoft.DurableTask.Client;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The default (Azure Storage) implementation of DfmExtensionPoints.ListInstancesRoutine: the instances of
    /// the Instances screen, read from the XXXInstances table itself.
    ///
    /// The screen shows 50 instances at a time, sorted by a column of the user's choosing. Table Storage can
    /// sort by nothing but its keys, so every page of the screen is every instance of the time range, read,
    /// sorted, and cut down to its 50. Through the DurableTaskClient that is one query from the first row of
    /// the table to the last, a thousand rows a request, each request waiting for the one before it, and each
    /// row passed from the storage account to the Functions host, from the host to this worker, and turned
    /// into objects twice on the way.
    ///
    /// Here the same rows are read by <see cref="TableScan"/>: as PartitionKey ranges side by side when the
    /// table does not fit into one request, with the same filter the Durable Task Framework sends, and with
    /// only the five columns a row of the screen is made of. Each row becomes an OrchestrationMetadata the
    /// moment it arrives, so what is held of a large hub is a list of those and not of table rows.
    ///
    /// Not every request sorts: the Histogram view walks the list as it comes, a thousand instances at a time,
    /// and a caller of the API may ask for the first fifty of it. Such a request stops reading where it stops
    /// asking, so for it nothing is read ahead: a request to the table at a time, the way the client's own
    /// paging went, without the trip through the host.
    ///
    /// It returns what DurableTaskClient.GetAllInstancesAsync returns, in the same order, so everything after
    /// it (entities, the filter on a column, sorting, paging) is the code it always was. And it only takes the
    /// queries it can answer exactly as the client would: see <see cref="List"/>.
    /// </summary>
    internal static class AzureStorageInstances
    {
        /// <summary>
        /// Lists the orchestration instances of a query, or returns null for a query that is the client's to
        /// answer:
        ///   - one that wants inputs and outputs. The host replaces a payload that lives in a blob with the
        ///     contents of that blob on the way out, and the table only holds the link to it;
        ///   - one for the ids that start with a prefix, which is a different (and already cheap) question;
        ///   - any query, when the DfMonDisableInstancesTableScan feature flag is set.
        ///
        /// <paramref name="readToEnd"/> is true when the caller is going to read the whole list (it sorts it),
        /// and false when it may stop after the first rows: see <see cref="TableScan.StreamAsync"/>.
        ///
        /// Nothing is read until the list is enumerated. A Task Hub that has no XXXInstances table (it is kept
        /// by another storage provider) fails on the first request, before an instance has been returned, and
        /// GET /orchestrations then lists through the client instead.
        /// </summary>
        public static IAsyncEnumerable<OrchestrationMetadata> List(DurableTaskClient durableClient, string connEnvVariableName, string hubName, OrchestrationQuery query, bool readToEnd)
        {
            if (query == null || query.FetchInputsAndOutputs || !string.IsNullOrEmpty(query.InstanceIdPrefix) || !string.IsNullOrEmpty(query.ContinuationToken))
            {
                return null;
            }

            if (query.TaskHubNames != null && query.TaskHubNames.Any())
            {
                return null;
            }

            string featureFlags = Environment.GetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags);
            if (featureFlags != null && featureFlags.Contains(Globals.DfMonDisableInstancesTableScan))
            {
                return null;
            }

            return ReadAsync(connEnvVariableName, hubName, BuildFilter(query), readToEnd);
        }

        private static async IAsyncEnumerable<OrchestrationMetadata> ReadAsync(string connEnvVariableName, string hubName, string filter, bool readToEnd)
        {
            var tableClient = TableClient.GetTableClient(connEnvVariableName);

            await foreach (var instances in TableScan.StreamAsync(tableClient, $"{hubName}Instances", filter, InstanceColumns, ToMetadata, readToEnd))
            {
                foreach (var instance in instances)
                {
                    yield return instance;
                }
            }
        }

        /// <summary>
        /// The filter DurableTask.AzureStorage builds for the same query (OrchestrationInstanceStatusQueryCondition),
        /// condition for condition: the same rows have to come back.
        /// </summary>
        internal static string BuildFilter(OrchestrationQuery query)
        {
            var conditions = new List<string>();

            // Both ends inclusive, as the framework has them
            if (query.CreatedFrom.HasValue && query.CreatedFrom.Value.UtcDateTime > DateTime.MinValue)
            {
                conditions.Add(Azure.Data.Tables.TableClient.CreateQueryFilter($"CreatedTime ge {query.CreatedFrom.Value.UtcDateTime}"));
            }

            if (query.CreatedTo.HasValue && query.CreatedTo.Value.UtcDateTime < DateTime.MaxValue)
            {
                conditions.Add(Azure.Data.Tables.TableClient.CreateQueryFilter($"CreatedTime le {query.CreatedTo.Value.UtcDateTime}"));
            }

            if (query.Statuses != null && query.Statuses.Any())
            {
                // The table spells a status the way the enum does
                conditions.Add(string.Join(" or ", query.Statuses.Select(status => Azure.Data.Tables.TableClient.CreateQueryFilter($"RuntimeStatus eq {status.ToString()}"))));
            }

            // Entities live in the same table, under ids that start with '@'. The client leaves them out of a
            // list of orchestrations (the Entities API lists them), and so does this.
            conditions.Add(ExcludeEntitiesFilter);

            return string.Join(" and ", conditions.Select(condition => $"({condition})"));
        }

        /// <summary>
        /// Makes of an XXXInstances row what the client makes of it. Inputs and outputs were not asked for and
        /// are not there.
        /// </summary>
        internal static OrchestrationMetadata ToMetadata(TableEntity row)
        {
            // What is not in the table comes out of the client as an empty name, not as none
            return new OrchestrationMetadata(row.GetString(NameColumn) ?? string.Empty, UnescapePartitionKey(row.PartitionKey))
            {
                CreatedAt = GetDateTimeOffset(row, CreatedTimeColumn),
                LastUpdatedAt = GetDateTimeOffset(row, LastUpdatedTimeColumn),

                // A status the enum does not know is -1 on its way through the framework, and stays that
                RuntimeStatus = Enum.TryParse(row.GetString(RuntimeStatusColumn), out OrchestrationRuntimeStatus runtimeStatus) ? runtimeStatus : (OrchestrationRuntimeStatus)(-1),

                SerializedCustomStatus = row.GetString(CustomStatusColumn)
            };
        }

        /// <summary>
        /// Turns a PartitionKey back into the instance id it stands for. A key cannot hold '/', '\', '#', '?' or
        /// a control character, so DurableTask.AzureStorage writes those as '^' and a stand-in (KeySanitation),
        /// and '^' itself as '^^'.
        /// </summary>
        internal static string UnescapePartitionKey(string key)
        {
            if (key == null || key.IndexOf(EscapeChar) < 0)
            {
                return key;
            }

            var result = new StringBuilder(key.Length);

            for (int i = 0; i < key.Length; i++)
            {
                char c = key[i];

                if (c != EscapeChar || i == key.Length - 1)
                {
                    // An escape character with nothing after it is not one the framework wrote. It stays as it is.
                    result.Append(c);
                    continue;
                }

                c = key[++i];

                switch (c)
                {
                    case '0':
                        result.Append('/');
                        break;
                    case '1':
                        result.Append('\\');
                        break;
                    case '2':
                        result.Append('#');
                        break;
                    case '3':
                        result.Append('?');
                        break;
                    case EscapeChar:
                        result.Append(EscapeChar);
                        break;
                    default:
                        // A control character, moved up by this much to become a character a key may hold
                        result.Append(c < ControlCharOffset ? c : (char)(c - ControlCharOffset));
                        break;
                }
            }

            return result.ToString();
        }

        // TableEntity.GetDateTimeOffset() casts, so a column another tool wrote as text would throw.
        // A time that cannot be read is the beginning of time, which is what the client makes of a missing one.
        private static DateTimeOffset GetDateTimeOffset(TableEntity row, string columnName)
        {
            if (!row.TryGetValue(columnName, out object value))
            {
                return default;
            }

            switch (value)
            {
                case DateTimeOffset dateTimeOffsetValue:
                    return dateTimeOffsetValue.ToUniversalTime();
                case DateTime dateTimeValue:
                    return new DateTimeOffset(dateTimeValue.ToUniversalTime(), TimeSpan.Zero);
                default:
                    return default;
            }
        }

        private const string NameColumn = "Name";
        private const string RuntimeStatusColumn = "RuntimeStatus";
        private const string CreatedTimeColumn = "CreatedTime";
        private const string LastUpdatedTimeColumn = "LastUpdatedTime";
        private const string CustomStatusColumn = "CustomStatus";

        private const char EscapeChar = '^';
        private const char ControlCharOffset = 'À';

        /// <summary>
        /// Every id that does not start with '@': everything below it, and everything from 'A' (the character
        /// after it) on. Exactly the condition the framework adds for the same purpose.
        /// </summary>
        internal const string ExcludeEntitiesFilter = "PartitionKey lt '@' or PartitionKey ge 'A'";

        // A row of the Instances screen, and nothing else of the row in the table. Input and Output, which are
        // most of it, are never asked for here. PartitionKey and RowKey come back regardless.
        private static readonly string[] InstanceColumns = new[] { NameColumn, RuntimeStatusColumn, CreatedTimeColumn, LastUpdatedTimeColumn, CustomStatusColumn };
    }
}
