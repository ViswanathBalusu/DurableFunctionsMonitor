// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Collections.Concurrent;
using System.Globalization;
using Azure;
using Azure.Data.Tables;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The Azure Table implementation of the two audit extension points: the writer the middleware calls
    /// after every Write or Dangerous operation, and the reader behind GET /audit.
    ///
    /// Rows live in '{hub}DfmAudit', one partition per UTC day ('yyyyMMdd') and a row key that counts
    /// down from DateTime.MaxValue, so Table Storage's own ordering (PartitionKey, then RowKey ascending)
    /// already returns the newest record of a day first and the reader never has to sort. A random suffix
    /// keeps two operations in the same tick apart.
    ///
    /// The table is created on first write, so an installation that never turns auditing on never grows
    /// one, and an installation that does needs no setup step.
    /// </summary>
    static class AuditStore
    {
        /// <summary>
        /// Appends one audit record. Called fire-and-forget by the middleware: it must not throw into the
        /// request, so the caller logs and swallows - see AuditWriter.
        /// </summary>
        public static async Task WriteAsync(string connEnvVariableName, string hubName, AuditRecord record)
        {
            ArgumentNullException.ThrowIfNull(record);

            string tableName = GetTableName(hubName);

            var table = Globals.GetTableServiceClient(connEnvVariableName).GetTableClient(tableName);

            await EnsureTableExistsAsync(table, connEnvVariableName, tableName);

            await table.AddEntityAsync(ToEntity(record));
        }

        /// <summary>
        /// Reads one page of audit records, newest first.
        ///
        /// The scan walks day partitions backwards from the day of <see cref="AuditQuery.To"/> to the day
        /// of <see cref="AuditQuery.From"/> - at most <see cref="RangeQuery.MaxRangeDays"/> of them, the
        /// same bound every aggregation endpoint enforces - and stops as soon as it has collected
        /// Skip + Top + 1 rows, which is exactly enough to fill the page and know whether there is another.
        /// The two boundary days are filtered on At client-side: a partition is a whole day, the range is
        /// not.
        /// </summary>
        public static async Task<AuditPage> ReadAsync(string connEnvVariableName, string hubName, AuditQuery query)
        {
            ArgumentNullException.ThrowIfNull(query);

            string tableName = GetTableName(hubName);

            var table = Globals.GetTableServiceClient(connEnvVariableName).GetTableClient(tableName);

            // One more than the page needs, so HasMore is an observation rather than a guess
            int wanted = query.Skip + query.Top + 1;

            var rows = new List<AuditRecord>();

            foreach (var day in DaysNewestFirst(query.From, query.To))
            {
                // CreateQueryFilter escapes the interpolated values, so an operation name cannot break out
                string filter = query.Operation == null
                    ? Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey eq {day}")
                    : Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey eq {day} and Operation eq {query.Operation}");

                rows.AddRange(await ReadDayAsync(table, filter, query.From, query.To, wanted - rows.Count));

                if (rows.Count >= wanted)
                {
                    break;
                }
            }

            var page = rows.Skip(query.Skip).Take(query.Top).ToList();

            return new AuditPage
            {
                Rows = page,

                // More rows exist when the scan found at least one past this page
                HasMore = rows.Count > query.Skip + page.Count
            };
        }

        /// <summary>The audit table of a Task Hub. Public so /storage can report it by the same name.</summary>
        internal static string GetTableName(string hubName)
        {
            return $"{hubName}{TableSuffix}";
        }

        /// <summary>
        /// The row key of a record: the ticks left until DateTime.MaxValue, zero-padded, so that ascending
        /// row keys are descending timestamps, plus a short random suffix so two records written in the
        /// same tick cannot collide.
        /// </summary>
        internal static string BuildRowKey(DateTimeOffset at)
        {
            return $"{DateTime.MaxValue.Ticks - at.UtcTicks:D19}-{Guid.NewGuid():N}".Substring(0, 19 + 1 + 8);
        }

        /// <summary>The partition of a record: its UTC day.</summary>
        internal static string BuildPartitionKey(DateTimeOffset at)
        {
            return at.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        }

        internal static TableEntity ToEntity(AuditRecord record)
        {
            var at = record.At.ToUniversalTime();

            return new TableEntity(BuildPartitionKey(at), BuildRowKey(at))
            {
                [AtColumn] = at,
                [UserColumn] = record.User ?? string.Empty,
                [OperationColumn] = record.Operation ?? string.Empty,
                [KindColumn] = record.Kind ?? string.Empty,

                // An empty string, not null: a hub-wide operation has no instance, and Table Storage
                // cannot store a null property at all
                [InstanceIdColumn] = record.InstanceId ?? string.Empty,
                [OutcomeColumn] = record.Outcome ?? string.Empty,
                [StatusColumn] = record.Status,

                // A whole error body would be pointless to store and expensive to read back
                [MessageColumn] = Truncate(record.Message, MaxMessageChars),
                [RouteColumn] = record.Route ?? string.Empty
            };
        }

        internal static AuditRecord ToRecord(TableEntity entity)
        {
            return new AuditRecord
            {
                At = entity.GetDateTimeOffset(AtColumn) ?? default,
                User = entity.GetString(UserColumn),
                Operation = entity.GetString(OperationColumn),
                Kind = entity.GetString(KindColumn),

                // Stored as an empty string, reported as null: 'this operation was not about an instance'
                InstanceId = NullIfEmpty(entity.GetString(InstanceIdColumn)),
                Outcome = entity.GetString(OutcomeColumn),
                Status = entity.GetInt32(StatusColumn) ?? 0,
                Message = NullIfEmpty(entity.GetString(MessageColumn)),
                Route = entity.GetString(RouteColumn)
            };
        }

        /// <summary>
        /// The UTC days a range covers, newest first, capped at the longest range any endpoint allows.
        /// </summary>
        internal static IEnumerable<string> DaysNewestFirst(DateTimeOffset from, DateTimeOffset to)
        {
            var day = to.UtcDateTime.Date;
            var firstDay = from.UtcDateTime.Date;

            for (int i = 0; i <= RangeQuery.MaxRangeDays && day >= firstDay; i++)
            {
                yield return day.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

                day = day.AddDays(-1);
            }
        }

        /// <summary>
        /// Reads at most <paramref name="maxRows"/> records of one day partition that fall inside
        /// [from, to]. Rows of a partition come back in ascending RowKey order, which
        /// <see cref="BuildRowKey"/> makes 'newest first', so no sorting is needed here or in the caller.
        /// </summary>
        private static async Task<List<AuditRecord>> ReadDayAsync(
            Azure.Data.Tables.TableClient table,
            string filter,
            DateTimeOffset from,
            DateTimeOffset to,
            int maxRows)
        {
            var result = new List<AuditRecord>();

            try
            {
                await foreach (var entity in table.QueryAsync<TableEntity>(filter, maxPerPage: MaxPageSize))
                {
                    var record = ToRecord(entity);

                    // The first and the last day of the range are only partly inside it
                    if (record.At < from || record.At > to)
                    {
                        continue;
                    }

                    result.Add(record);

                    if (result.Count >= maxRows)
                    {
                        break;
                    }
                }
            }
            catch (RequestFailedException)
            {
                // A table that does not exist yet (auditing was never on for this hub) is an empty log,
                // not an error
            }

            return result;
        }

        private static async Task EnsureTableExistsAsync(Azure.Data.Tables.TableClient table, string connEnvVariableName, string tableName)
        {
            // One CreateIfNotExists per table per process: the audit writer runs after every write
            // operation, and that call is a round trip nobody needs to pay for twice.
            string key = $"{connEnvVariableName}|{tableName}";

            if (CreatedTables.ContainsKey(key))
            {
                return;
            }

            await table.CreateIfNotExistsAsync();

            CreatedTables.TryAdd(key, true);
        }

        private static string Truncate(string text, int maxChars)
        {
            if (string.IsNullOrEmpty(text))
            {
                return string.Empty;
            }

            return text.Length <= maxChars ? text : text.Substring(0, maxChars);
        }

        private static string NullIfEmpty(string value)
        {
            return string.IsNullOrEmpty(value) ? null : value;
        }

        /// <summary>Suffix of the audit table, appended to the Task Hub name.</summary>
        internal const string TableSuffix = "DfmAudit";

        /// <summary>How much of an error message is stored. Anything longer is cut off.</summary>
        internal const int MaxMessageChars = 8 * 1024;

        private const int MaxPageSize = 1000;

        private const string AtColumn = "At";
        private const string UserColumn = "User";
        private const string OperationColumn = "Operation";
        private const string KindColumn = "Kind";
        private const string InstanceIdColumn = "InstanceId";
        private const string OutcomeColumn = "Outcome";
        private const string StatusColumn = "Status";
        private const string MessageColumn = "Message";
        private const string RouteColumn = "Route";

        // Tables this process has already made sure exist, by connection and name
        private static readonly ConcurrentDictionary<string, bool> CreatedTables = new();
    }
}
