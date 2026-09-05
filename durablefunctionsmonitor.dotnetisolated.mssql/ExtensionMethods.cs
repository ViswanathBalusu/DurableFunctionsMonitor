// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Hosting;
using Microsoft.DurableTask.Client;
using Microsoft.Data.SqlClient;
using System.Data.Common;
using Newtonsoft.Json.Linq;
using System.Reflection;

namespace DurableFunctionsMonitor.DotNetIsolated.MsSql
{
    /// <summary>
    /// Extension methods for configuring DfMon
    /// </summary>
    public static class ExtensionMethods
    {
        private static string ConnString;
        private static string SchemaName = "dt";

        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IFunctionsWorkerApplicationBuilder UseDurableFunctionsMonitorWithMsSqlDurability(
            this IFunctionsWorkerApplicationBuilder builder,
            Action<DfmSettings> optionsBuilder = null
        )
        {
            // Trying to get custom SQL conn string name from host.json
            string connStringName = "DFM_SQL_CONNECTION_STRING";
            
            string hostJsonFileName = GetHostJsonPath();
            if (File.Exists(hostJsonFileName))
            {
                dynamic hostJson = JObject.Parse(File.ReadAllText(hostJsonFileName));

                string connStringNameFromHostJson = hostJson?.extensions?.durableTask?.storageProvider?.connectionStringName;
                if (!string.IsNullOrEmpty(connStringNameFromHostJson))
                {
                    connStringName = connStringNameFromHostJson;
                }

                string schemaNameFromHostJson = hostJson?.extensions?.durableTask?.storageProvider?.schemaName;
                if (!string.IsNullOrEmpty(schemaNameFromHostJson))
                {
                    SchemaName = schemaNameFromHostJson;
                }
            }

            ConnString = Environment.GetEnvironmentVariable(connStringName)!;

            // Getting custom schema name passed to us by VsCode ext
            string schemaNameFromEnvVar = Environment.GetEnvironmentVariable("AzureFunctionsJobHost__extensions__durableTask__storageProvider__schemaName");
            if (!string.IsNullOrEmpty(schemaNameFromEnvVar))
            {
                SchemaName = schemaNameFromEnvVar;
            }

            return builder.UseDurableFunctionsMonitor((settings, extPoints) =>
            {
                optionsBuilder?.Invoke(settings);

                extPoints.ProviderName = "MsSql";

                extPoints.GetInstanceHistoryRoutine = (client, connName, hubName, instanceId) => Task.FromResult(GetInstanceHistory(client, connName, hubName, instanceId));
                extPoints.GetParentInstanceIdRoutine = GetParentInstanceId;
                extPoints.GetTaskHubNamesRoutine = GetTaskHubNames;

                // The history query above returns complete payloads, and the defaults for the two editing routines
                // work on Azure Storage tables. Editing dt.History/dt.Payloads is not implemented yet, so the
                // update-input-and-rewind and replay endpoints answer 400 for this provider.
                extPoints.GetHistoryEventInputRoutine = null;
                extPoints.UpdateHistoryEventInputRoutine = null;
                extPoints.TruncateHistoryRoutine = null;

                // The defaults for these read the XXXHistory/XXXInstances tables of Azure Storage,
                // which do not exist here, so each gets its own SQL implementation.
                extPoints.GetEpisodeMarkersRoutine = GetEpisodeMarkers;
                extPoints.GetInstanceRowInfoRoutine = GetInstanceRowInfo;
                extPoints.GetStatsRoutine = GetStats;
                extPoints.GetChildrenRoutine = GetChildren;

                // A SQL Task Hub has no storage account behind it: no control queues, no leases
                // container, no Partitions table. So /storage answers 400 and /about reports
                // capabilities.storageHealth == false.
                extPoints.GetStorageHealthRoutine = null;

                // The SQL provider keeps its failures in dt.Instances, which the Azure Storage scan
                // cannot read. B3-S2-T1 leaves the SQL implementation for later (same rule as the
                // grouped-SQL stats), so /failures answers 400 and the Failures screen shows its
                // empty state on MSSQL.
                extPoints.GetFailuresRoutine = null;

                // The audit log lives in an Azure Table, which a SQL Task Hub has no storage account
                // for. Until a SQL audit store exists, nothing is written and /audit reports itself
                // as disabled.
                extPoints.WriteAuditRecordRoutine = null;
                extPoints.ReadAuditRecordsRoutine = null;
            });
        }

        /// <summary>
        /// Configures Durable Functions Monitor endpoint
        /// </summary>
        public static IHostBuilder UseDurableFunctionsMonitorWithMsSqlDurability(this IHostBuilder hostBuilder, Action<DfmSettings> optionsBuilder = null)
        {
            return hostBuilder.ConfigureFunctionsWorkerDefaults((HostBuilderContext builderContext, IFunctionsWorkerApplicationBuilder builder) =>
            {
                builder.UseDurableFunctionsMonitorWithMsSqlDurability(optionsBuilder);
            });
        }

        /// <summary>
        /// Custom routine for fetching Task Hub names
        /// </summary>
        public static async Task<IEnumerable<string>> GetTaskHubNames(string connName)
        {
            var result = new List<string>();

            string sql =
                $@"SELECT DISTINCT
                    i.TaskHub as TaskHub
                FROM
                    [{SchemaName}].Instances i";

            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    using (var reader = cmd.ExecuteReader())
                    {
                        while (await reader.ReadAsync())
                        {
                            result.Add(reader["TaskHub"].ToString()!);
                        }
                    }
                }
            }

            return result;
        }

        /// <summary>
        /// Custom routine for fetching parent orchestration id
        /// </summary>
        public static async Task<string> GetParentInstanceId(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            string sql =
                $@"SELECT 
                    i.ParentInstanceID as ParentInstanceID
                FROM
                    [{SchemaName}].Instances i
                WHERE
                    i.InstanceID = @OrchestrationInstanceId AND i.TaskHub = @TaskHub";

            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@OrchestrationInstanceId", instanceId);
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);
                    using (var reader = cmd.ExecuteReader())
                    {
                        if (await reader.ReadAsync())
                        {
                            var parentInstanceId = reader["ParentInstanceID"];
                            if (parentInstanceId != null)
                            {
                                string parentInstanceIdString = parentInstanceId.ToString();
                                if (!string.IsNullOrWhiteSpace(parentInstanceIdString))
                                {
                                    return parentInstanceIdString;
                                }
                            }
                        }
                    }
                }
            }

            return null;
        }

        /// <summary>
        /// Custom routine for reading the orchestrator episodes of an instance.
        /// Pairs the OrchestratorStarted/OrchestratorCompleted rows of dt.History in sequence order;
        /// an OrchestratorStarted that has no OrchestratorCompleted after it is an open episode (End == null).
        /// </summary>
        public static async Task<IReadOnlyList<EpisodeMarker>> GetEpisodeMarkers(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            string sql =
                $@"SELECT
                    h.EventType as EventType,
                    h.Timestamp as Timestamp
                FROM
                    [{SchemaName}].History h
                WHERE
                    h.InstanceID = @OrchestrationInstanceId AND h.TaskHub = @TaskHub
                    AND
                    h.EventType IN ('OrchestratorStarted', 'OrchestratorCompleted')
                ORDER BY
                    h.SequenceNumber";

            var result = new List<EpisodeMarker>();
            DateTimeOffset? episodeStart = null;

            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@OrchestrationInstanceId", instanceId);
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (await reader.ReadAsync())
                        {
                            if (reader["Timestamp"] is DBNull)
                            {
                                // A row without a timestamp cannot be placed on a timeline
                                continue;
                            }

                            // Same conversion the history rows above go through, so that markers and events
                            // end up on one and the same time axis
                            var timestamp = new DateTimeOffset(((DateTime)reader["Timestamp"]).ToUniversalTime());

                            if (reader["EventType"].ToString() == "OrchestratorStarted")
                            {
                                if (episodeStart != null)
                                {
                                    // An episode that never completed (the host crashed mid-replay, say). It stays
                                    // open, and the row that follows it opens the next one.
                                    result.Add(new EpisodeMarker { Start = episodeStart.Value, End = null });
                                }

                                episodeStart = timestamp;
                            }
                            else if (episodeStart != null)
                            {
                                result.Add(new EpisodeMarker { Start = episodeStart.Value, End = timestamp });

                                episodeStart = null;
                            }
                        }
                    }
                }
            }

            if (episodeStart != null)
            {
                // The orchestrator is running right now
                result.Add(new EpisodeMarker { Start = episodeStart.Value, End = null });
            }

            return result;
        }

        /// <summary>
        /// Custom routine for reading the storage row of an instance (execution id and generation).
        /// Returns null when there is no such row.
        /// </summary>
        public static async Task<InstanceRowInfo> GetInstanceRowInfo(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            // Selecting the whole row rather than the two columns by name: 'Generation' only exists in the
            // newer versions of the durabletask-mssql schema, and naming a column that is not there would fail
            // the whole query instead of just leaving that one value unknown.
            string sql =
                $@"SELECT TOP 1
                    *
                FROM
                    [{SchemaName}].Instances i
                WHERE
                    i.InstanceID = @OrchestrationInstanceId AND i.TaskHub = @TaskHub";

            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@OrchestrationInstanceId", instanceId);
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (!await reader.ReadAsync())
                        {
                            return null;
                        }

                        return new InstanceRowInfo
                        {
                            ExecutionId = GetValueOrNull(reader, "ExecutionID")?.ToString(),
                            Generation = GetValueOrNull(reader, "Generation") is object generation ? Convert.ToInt32(generation) : null,

                            // dt.History keeps payloads in a separate table, so there is no cheap size to report
                            HistoryBytesEstimate = null
                        };
                    }
                }
            }
        }

        /// <summary>
        /// Custom routine for producing the Task Hub statistics of the /stats endpoint.
        ///
        /// Reads the [schema].Instances rows created inside the requested range - InstanceID, Name,
        /// RuntimeStatus, CreatedTime, LastUpdatedTime and CompletedTime only - with a TOP (cap + 1) bound,
        /// then hands them to the shared <see cref="StatsAggregator"/>, so that MSSQL and Azure Storage
        /// reach exactly the same numbers from the same rows. Grouping the counters in SQL (GROUP BY
        /// RuntimeStatus / Name) is a later optimisation: the percentiles, the bins, the stuck/pending/
        /// suspended sets and the entity split all need row-level data anyway, and within the cap this
        /// query is exact.
        /// </summary>
        public static async Task<StatsResult> GetStats(DurableTaskClient durableClient, string connName, string hubName, StatsQuery query, CancellationToken cancellationToken)
        {
            ArgumentNullException.ThrowIfNull(query);

            // The endpoint fills StatsQuery.Cap from DfmSettings; a custom caller might not
            int cap = query.Cap > 0 ? query.Cap : DefaultStatsScanCap;

            using (var conn = new SqlConnection(ConnString))
            {
                await conn.OpenAsync(cancellationToken);

                using (var cmd = new SqlCommand(BuildStatsSql(SchemaName), conn))
                {
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);

                    // dt.Instances keeps UTC timestamps, so the range goes in as UTC and comes back as UTC
                    cmd.Parameters.AddWithValue("@From", query.From.UtcDateTime);
                    cmd.Parameters.AddWithValue("@To", query.To.UtcDateTime);

                    // One row more than the cap, so that hitting the cap is detectable
                    cmd.Parameters.AddWithValue("@Top", cap + 1);

                    using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
                    {
                        var scan = await ReadStatsRowsAsync(reader, cap, cancellationToken);

                        return StatsAggregator.Aggregate(scan.Rows, query, DateTimeOffset.UtcNow, scan.Truncated, cap);
                    }
                }
            }
        }

        /// <summary>
        /// How many instance rows /stats scans when the caller did not set <see cref="StatsQuery.Cap"/>.
        /// Mirrors the default of the DFM_STATS_CAP setting.
        /// </summary>
        private const int DefaultStatsScanCap = 50000;

        // The /stats query. Deliberately unordered: TOP without ORDER BY lets SQL Server stop at the cap
        // instead of sorting the whole matching set, and the aggregation does not depend on row order
        // (when the cap does bite, the response says so via 'partial').
        private static string BuildStatsSql(string schemaName)
        {
            return
                $@"SELECT TOP (@Top)
                    i.InstanceID as InstanceID,
                    i.Name as Name,
                    i.RuntimeStatus as RuntimeStatus,
                    i.CreatedTime as CreatedTime,
                    i.LastUpdatedTime as LastUpdatedTime,
                    i.CompletedTime as CompletedTime
                FROM
                    [{schemaName}].Instances i
                WHERE
                    i.TaskHub = @TaskHub AND i.CreatedTime >= @From AND i.CreatedTime <= @To";
        }

        // Reads at most 'cap' rows; Truncated is true when the query returned more (the TOP (cap + 1) row)
        private static async Task<(List<InstanceRowLite> Rows, bool Truncated)> ReadStatsRowsAsync(DbDataReader reader, int cap, CancellationToken cancellationToken)
        {
            var rows = new List<InstanceRowLite>();
            bool truncated = false;

            while (await reader.ReadAsync(cancellationToken))
            {
                if (rows.Count >= cap)
                {
                    truncated = true;
                    break;
                }

                rows.Add(ToInstanceRowLite(reader));
            }

            return (rows, truncated);
        }

        // Maps one row of the /stats query onto the aggregator's input record
        private static InstanceRowLite ToInstanceRowLite(DbDataReader reader)
        {
            DateTimeOffset createdTime = ToUtcOrNull(reader["CreatedTime"]) ?? default;

            return new InstanceRowLite
            {
                InstanceId = ToStringOrNull(reader["InstanceID"]),
                Name = ToStringOrNull(reader["Name"]),
                RuntimeStatus = ToStringOrNull(reader["RuntimeStatus"]),
                CreatedTime = createdTime,

                // A row is always written at least once, but an older schema might leave this empty
                LastUpdatedTime = ToUtcOrNull(reader["LastUpdatedTime"]) ?? createdTime,

                // NULL while the instance is still going
                CompletedTime = ToUtcOrNull(reader["CompletedTime"])
            };
        }

        private static string ToStringOrNull(object value)
        {
            return value is null || value is DBNull ? null : value.ToString();
        }

        // dt.Instances stores UTC in datetime2 columns, which come back as DateTimeKind.Unspecified.
        // They have to be *labelled* UTC rather than converted (as GetInstanceHistory does for history
        // timestamps): the /stats range parameters go in as UTC, so shifting the values by the local
        // offset would push rows outside the very range they were selected by, and the bins would be wrong.
        private static DateTimeOffset? ToUtcOrNull(object value)
        {
            if (value is null || value is DBNull)
            {
                return null;
            }

            var dateTime = (DateTime)value;

            return new DateTimeOffset(dateTime.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(dateTime, DateTimeKind.Utc)
                : dateTime.ToUniversalTime());
        }

        // Reads a column by name, tolerating both a missing column and a NULL value
        private static object GetValueOrNull(SqlDataReader reader, string columnName)
        {
            for (int i = 0; i < reader.FieldCount; i++)
            {
                if (string.Equals(reader.GetName(i), columnName, StringComparison.OrdinalIgnoreCase))
                {
                    return reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
            }

            return null;
        }

        /// <summary>
        /// Custom routine for listing the sub-orchestrations of an instance.
        ///
        /// dt.Instances carries the parent's id in its own column, so unlike Azure Storage (which has to
        /// match the generated "{parent ExecutionId}:{taskId}" instance ids) this finds explicitly named
        /// children too - hence Complete == true.
        /// </summary>
        public static async Task<ChildrenResult> GetChildren(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            string sql =
                $@"SELECT
                    i.InstanceID as InstanceID,
                    i.Name as Name,
                    i.RuntimeStatus as RuntimeStatus,
                    i.CreatedTime as CreatedTime,
                    i.LastUpdatedTime as LastUpdatedTime
                FROM
                    [{SchemaName}].Instances i
                WHERE
                    i.ParentInstanceID = @OrchestrationInstanceId AND i.TaskHub = @TaskHub
                ORDER BY
                    i.CreatedTime";

            var children = new List<ChildInstance>();

            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@OrchestrationInstanceId", instanceId);
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (await reader.ReadAsync())
                        {
                            DateTimeOffset createdTime = ToUtcOrNull(reader["CreatedTime"]) ?? default;

                            children.Add(new ChildInstance
                            {
                                InstanceId = ToStringOrNull(reader["InstanceID"]),
                                Name = ToStringOrNull(reader["Name"]),

                                // The PascalCase RuntimeStatus name, verbatim as the row spells it
                                RuntimeStatus = ToStringOrNull(reader["RuntimeStatus"]),
                                CreatedTime = createdTime,

                                // A row is always written at least once, but an older schema might leave this empty
                                LastUpdatedTime = ToUtcOrNull(reader["LastUpdatedTime"]) ?? createdTime
                            });
                        }
                    }
                }
            }

            return new ChildrenResult { Children = children, Complete = true };
        }

        /// <summary>
        /// Custom routine for fetching orchestration history
        /// </summary>
        public static IEnumerable<HistoryEvent> GetInstanceHistory(DurableTaskClient durableClient, string connName, string hubName, string instanceId)
        {
            string sql =
                $@"SELECT 
                    IIF(h2.TaskID IS NULL, h.Timestamp, h2.Timestamp) as Timestamp, 
                    IIF(h2.TaskID IS NULL, h.EventType, h2.EventType) as EventType,
                    h.TaskID as EventId,
                    h.SequenceNumber as SequenceNumber,
                    h.Name as Name,
                    IIF(h2.TaskID IS NULL, NULL, h.Timestamp) as ScheduledTime,
                    p1.Text as Input,
                    p2.Text as Result,
                    p2.Reason as Details,
                    cih.InstanceID as SubOrchestrationId
                FROM
                    [{SchemaName}].History h
                    LEFT JOIN
                    [{SchemaName}].History h2
                    ON
                    (
                        h.EventType IN ('TaskScheduled', 'SubOrchestrationInstanceCreated')
                        AND
                        h2.EventType IN ('SubOrchestrationInstanceCompleted', 'SubOrchestrationInstanceFailed', 'TaskCompleted', 'TaskFailed')
                        AND
                        h.InstanceID = h2.InstanceID AND h.ExecutionID = h2.ExecutionID AND h.TaskHub = h2.TaskHub AND h.TaskID = h2.TaskID AND h.SequenceNumber != h2.SequenceNumber
                    )
                    LEFT JOIN
                    [{SchemaName}].Payloads p1
                    ON
                    p1.PayloadID = h.DataPayloadID AND p1.TaskHub = h.TaskHub AND p1.InstanceID = h.InstanceID
                    LEFT JOIN
                    [{SchemaName}].Payloads p2
                    ON
                    p2.PayloadID = h2.DataPayloadID AND p2.TaskHub = h2.TaskHub AND p2.InstanceID = h2.InstanceID
                    LEFT JOIN
                    (
                        select 
                            cii.ParentInstanceID,
                            cii.InstanceID,
                            cii.TaskHub,
                            chh.TaskID
                        from 
                            [{SchemaName}].Instances cii
                            INNER JOIN
                            [{SchemaName}].History chh
                            ON
                            (chh.InstanceID = cii.InstanceID AND chh.TaskHub = cii.TaskHub AND chh.EventType = 'ExecutionStarted')
                    ) cih
                    ON
                    (cih.ParentInstanceID = h.InstanceID AND cih.TaskHub = h.TaskHub AND cih.TaskID = h.TaskID AND h.EventType = 'SubOrchestrationInstanceCreated')
                WHERE
                    h.EventType IN 
                    (
                        'ExecutionStarted', 'ExecutionCompleted', 'ExecutionFailed', 'ExecutionTerminated', 'TaskScheduled', 'SubOrchestrationInstanceCreated',
                        'ContinueAsNew', 'TimerCreated', 'TimerFired', 'EventRaised', 'EventSent'
                    )
                    AND
                    h.InstanceID = @OrchestrationInstanceId AND h.TaskHub = @TaskHub
                ORDER BY
                    h.SequenceNumber";


            using (var conn = new SqlConnection(ConnString))
            {
                conn.Open();

                using (var cmd = new SqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("@OrchestrationInstanceId", instanceId);
                    cmd.Parameters.AddWithValue("@TaskHub", hubName);
                    using (var reader = cmd.ExecuteReader())
                    {
                        // Memorizing 'ExecutionStarted' event, to further correlate with 'ExecutionCompleted'
                        DateTimeOffset? executionStartedTimestamp = null;

                        while (reader.Read())
                        {
                            var evt = ToHistoryEvent(reader, executionStartedTimestamp);

                            if (evt.EventType == "ExecutionStarted")
                            {
                                executionStartedTimestamp = evt.Timestamp;
                            }

                            yield return evt;
                        }
                    }
                }
            }
        }

        private static HistoryEvent ToHistoryEvent(SqlDataReader reader, DateTimeOffset? executionStartTime)
        {
            var evt = new HistoryEvent
            {
                SequenceNumber = reader["SequenceNumber"] is DBNull ? null : Convert.ToInt64(reader["SequenceNumber"]),
                Timestamp = ((DateTime)reader["Timestamp"]).ToUniversalTime(),
                EventType = reader["EventType"].ToString(),
                EventId = reader["EventId"] is DBNull ? null : (int?)reader["EventId"],
                Name = reader["Name"].ToString(),
                Result = reader["Result"].ToString(),
                Details = reader["Details"].ToString(),
                SubOrchestrationId = reader["SubOrchestrationId"].ToString(),
            };

            var rawScheduledTime = reader["ScheduledTime"];
            if (!(rawScheduledTime is DBNull))
            {
                evt.ScheduledTime = ((DateTime)rawScheduledTime).ToUniversalTime();
            }
            else if (evt.EventType == "ExecutionCompleted")
            {
                evt.ScheduledTime = executionStartTime?.ToUniversalTime();
            }

            if (evt.ScheduledTime.HasValue)
            {
                evt.DurationInMs = (evt.Timestamp - evt.ScheduledTime.Value).TotalMilliseconds;
            }

            return evt;
        }

        private static string GetHostJsonPath()
        {
            string assemblyLocation = Assembly.GetExecutingAssembly().Location;

            // First trying current folder
            string result = Path.Combine(Path.GetDirectoryName(assemblyLocation), "host.json");

            if (File.Exists(result))
            {
                return result;
            }

            // Falling back to parent folder
            result = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(assemblyLocation)), "host.json");

            return result;
        }
    }
}