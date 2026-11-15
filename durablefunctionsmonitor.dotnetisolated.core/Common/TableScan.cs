// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Runtime.CompilerServices;
using Azure.Data.Tables;

namespace DurableFunctionsMonitor.DotNetIsolated
{
    /// <summary>
    /// The scan of a whole table: every row that matches a filter, when the filter is not on the keys and so
    /// every row of the table has to be looked at (the instances created in a time range, the failed ones, a
    /// row count). Up to a cap (<see cref="QueryAsync"/>) for what counts and samples, and without one
    /// (<see cref="StreamAsync"/>) for a list that has to hold every row to sort it.
    ///
    /// Table Storage has one index, (PartitionKey, RowKey), and answers such a query by walking the table in
    /// key order, a request at a time: a request returns after 1000 matches or after five seconds of walking,
    /// whichever comes first, with a token to continue from. On a table of millions of rows where few match,
    /// that is thousands of requests one after another, each waiting for the one before it.
    ///
    /// The requests do not have to wait for each other. A table is cut into PartitionKey ranges, each range is
    /// a query of its own that only walks its part of the table, and the ranges are read side by side:
    ///
    ///   1. One request first, the way it always was. A table small enough to be answered by it (no
    ///      continuation token) costs exactly that one request, as before.
    ///   2. Otherwise the rest of the key space, from the last row that request returned, is cut at
    ///      <see cref="RangeBoundaries"/> and read <see cref="Parallelism"/> ranges at a time.
    ///
    /// The cap is kept, and kept deterministic: every range first gets an equal share of what is left of it,
    /// and what the ranges with few matches leave unused is then handed, in key order, to the ranges that have
    /// more. So the scan never holds more than the cap (plus the one row that tells 'exactly the cap' from
    /// 'more than the cap'), the same table gives the same rows every time, and the rows come back in key
    /// order, exactly as from <see cref="ITableClient.QueryAsync"/>. The one difference is which rows a
    /// truncated scan holds: not the first ones of the table, but the first ones of every range of it.
    /// </summary>
    internal static class TableScan
    {
        /// <summary>Default of <see cref="Parallelism"/>, and of DfmSettings.TableScanParallelism.</summary>
        internal const int DefaultParallelism = 4;

        /// <summary>
        /// The most ranges read at once. More would not be faster: there are <see cref="RangeBoundaries"/> + 1
        /// ranges to read, and a storage account that the Function App itself lives on.
        /// </summary>
        internal const int MaxParallelism = 16;

        /// <summary>
        /// How many PartitionKey ranges are read at once. 1 reads the table the old way, one request after
        /// another. Set from DfmSettings.TableScanParallelism when DfMon is configured; a static for the same
        /// reason <see cref="TableClient.CustomUserAgent"/> is one (no DI in an installed NuGet package).
        /// </summary>
        internal static int Parallelism = DefaultParallelism;

        /// <summary>
        /// Where the key space is cut. Instance ids are, unless the application names its instances itself,
        /// GUIDs in lower-case hex, so cutting at every hex digit gives sixteen ranges of about the same size.
        /// The first range also takes everything below '1' and the last everything from 'f' on, so the ranges
        /// cover every possible key whatever the ids look like: ids of another shape still all get read, just
        /// not in equal parts (entity ids, which start with '@', and upper-case ids all fall between '9' and 'a').
        /// </summary>
        internal static readonly string[] RangeBoundaries = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f" };

        /// <summary>
        /// Reads at most <paramref name="maxRows"/> rows matching <paramref name="filter"/> (null == all rows),
        /// with only the <paramref name="select"/>ed properties plus the keys (null == all properties), and tells
        /// whether the table held more.
        /// </summary>
        public static async Task<(IReadOnlyList<TableEntity> rows, bool truncated)> QueryAsync(
            ITableClient tableClient,
            string tableName,
            string filter,
            IEnumerable<string> select,
            int maxRows,
            CancellationToken ct)
        {
            if (maxRows < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(maxRows), maxRows, "maxRows should be a positive number");
            }

            // One row more than asked for is what tells 'exactly maxRows rows matched' from 'the scan was cut short'
            var rows = await ScanAsync(tableClient, tableName, filter, select, (long)maxRows + 1, ct);

            if (rows.Count > maxRows)
            {
                rows.RemoveRange(maxRows, rows.Count - maxRows);

                return (rows, true);
            }

            return (rows, false);
        }

        /// <summary>
        /// Every row matching <paramref name="filter"/>, however many there are, in key order and a batch at a
        /// time, each row turned by <paramref name="convert"/> into what the caller keeps of it as soon as it
        /// arrives - so that what is held of a large table is that, and not its rows.
        ///
        /// <paramref name="readToEnd"/> says whether the caller is going to read all of it:
        ///
        ///   - true, for what has to see every row to answer at all (a list sorted by something other than its
        ///     keys holds every row before it returns the first one). A table that does not fit into one
        ///     request is then read as the same PartitionKey ranges, side by side and ahead of the caller,
        ///     without a cap.
        ///   - false, for a caller that may stop after the first rows (a page of an unsorted list). Nothing is
        ///     read ahead then: a request at a time, each only when the caller asks for more, which is what
        ///     one query from the first row of the table on costs. Reading ranges ahead for a caller that
        ///     leaves after a page would turn one request into a scan of the table.
        ///
        /// A caller that stops early (it disposes the enumerator) stops what is still being read for it.
        /// </summary>
        public static async IAsyncEnumerable<IReadOnlyList<T>> StreamAsync<T>(
            ITableClient tableClient,
            string tableName,
            string filter,
            IEnumerable<string> select,
            Func<TableEntity, T> convert,
            bool readToEnd,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            // One request first, as in a capped scan: a table that fits into it costs exactly that
            var firstPage = await tableClient.QueryPageAsync(tableName, filter, select, TableClient.MaxPageSize, null, ct);

            yield return ConvertAll(firstPage.Rows, convert);

            if (firstPage.ContinuationToken == null)
            {
                yield break;
            }

            int parallelism = Math.Clamp(Parallelism, 1, MaxParallelism);

            if (!readToEnd || parallelism == 1)
            {
                // The continuation of the one query, a request after another
                string continuationToken = firstPage.ContinuationToken;

                while (continuationToken != null)
                {
                    var page = await tableClient.QueryPageAsync(tableName, filter, select, TableClient.MaxPageSize, continuationToken, ct);

                    continuationToken = page.ContinuationToken;

                    yield return ConvertAll(page.Rows, convert);
                }

                yield break;
            }

            var ranges = CutIntoRanges(filter, firstPage.Rows.Count > 0 ? firstPage.Rows[firstPage.Rows.Count - 1] : null);

            using (var stop = CancellationTokenSource.CreateLinkedTokenSource(ct))
            using (var throttle = new SemaphoreSlim(parallelism))
            {
                // Started in the order of the keys, so the ranges the caller gets first are read first
                var reads = ranges
                    .Select(range => ReadRangeAsync(tableClient, tableName, range.Filter, select, convert, throttle, stop.Token))
                    .ToArray();

                try
                {
                    for (int i = 0; i < reads.Length; i++)
                    {
                        var rows = await reads[i];

                        // What the caller has got is the caller's to hold
                        reads[i] = null;

                        yield return rows;
                    }
                }
                finally
                {
                    // Only when the caller left early, or a range failed, is anything still being read here:
                    // nobody wants it any more, and none of it may outlive the semaphore it waits on
                    stop.Cancel();

                    foreach (var read in reads)
                    {
                        if (read != null)
                        {
                            try
                            {
                                await read;
                            }
                            catch (Exception)
                            {
                                // Stopped, or failed after the failure that is already on its way to the caller
                            }
                        }
                    }
                }
            }
        }

        // One range, read to its end as soon as it is its turn
        private static async Task<IReadOnlyList<T>> ReadRangeAsync<T>(ITableClient tableClient, string tableName, string filter, IEnumerable<string> select, Func<TableEntity, T> convert, SemaphoreSlim throttle, CancellationToken ct)
        {
            await throttle.WaitAsync(ct);
            try
            {
                var result = new List<T>();
                string continuationToken = null;

                do
                {
                    var page = await tableClient.QueryPageAsync(tableName, filter, select, TableClient.MaxPageSize, continuationToken, ct);

                    foreach (var row in page.Rows)
                    {
                        result.Add(convert(row));
                    }

                    continuationToken = page.ContinuationToken;
                }
                while (continuationToken != null);

                return result;
            }
            finally
            {
                throttle.Release();
            }
        }

        private static IReadOnlyList<T> ConvertAll<T>(IReadOnlyList<TableEntity> rows, Func<TableEntity, T> convert)
        {
            var result = new List<T>(rows.Count);

            foreach (var row in rows)
            {
                result.Add(convert(row));
            }

            return result;
        }

        // At most 'budget' rows, in key order
        private static async Task<List<TableEntity>> ScanAsync(ITableClient tableClient, string tableName, string filter, IEnumerable<string> select, long budget, CancellationToken ct)
        {
            var firstPage = await tableClient.QueryPageAsync(tableName, filter, select, PageSize(budget), null, ct);

            var rows = new List<TableEntity>(firstPage.Rows);

            if (firstPage.ContinuationToken != null && rows.Count < budget)
            {
                int parallelism = Math.Clamp(Parallelism, 1, MaxParallelism);

                if (parallelism == 1)
                {
                    await ReadOnAsync(tableClient, tableName, filter, select, rows, firstPage.ContinuationToken, budget, ct);
                }
                else
                {
                    var ranges = CutIntoRanges(filter, rows.Count > 0 ? rows[rows.Count - 1] : null);

                    await ReadRangesAsync(tableClient, tableName, select, ranges, budget - rows.Count, parallelism, ct);

                    // In the order of the ranges, which is the order of the keys
                    foreach (var range in ranges)
                    {
                        rows.AddRange(range.Rows);
                    }
                }
            }

            return rows;
        }

        // How many rows to ask one request for, when that many are still wanted
        private static int PageSize(long rowsWanted)
        {
            return (int)Math.Min(TableClient.MaxPageSize, rowsWanted);
        }

        /// <summary>
        /// Reads everything that matches, however much that is, a page after another. For the queries that are
        /// bounded by what they ask for (the rows of one partition, a range of ids) rather than by a cap.
        /// </summary>
        public static async Task<List<TableEntity>> ReadAllAsync(ITableClient tableClient, string tableName, string filter, IEnumerable<string> select, CancellationToken ct)
        {
            var rows = new List<TableEntity>();
            string continuationToken = null;

            do
            {
                var page = await tableClient.QueryPageAsync(tableName, filter, select, TableClient.MaxPageSize, continuationToken, ct);

                rows.AddRange(page.Rows);
                continuationToken = page.ContinuationToken;
            }
            while (continuationToken != null);

            return rows;
        }

        /// <summary>
        /// The filters of the ranges that together hold every row after <paramref name="lastRowRead"/> (every
        /// row of the table, when there is none), each combined with the filter of the scan. In key order.
        /// </summary>
        internal static List<KeyRange> CutIntoRanges(string filter, TableEntity lastRowRead)
        {
            var ranges = new List<KeyRange>();

            string lastPartitionKey = lastRowRead?.PartitionKey;

            if (lastRowRead != null)
            {
                // What is left of the partition the first request stopped in. Nothing, where a partition is one
                // row (XXXInstances), and that costs one request that reads one partition to find out.
                ranges.Add(new KeyRange(And(
                    Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey eq {lastPartitionKey} and RowKey gt {lastRowRead.RowKey}"),
                    filter)));
            }

            for (int i = 0; i <= RangeBoundaries.Length; i++)
            {
                string from = i == 0 ? null : RangeBoundaries[i - 1];
                string to = i == RangeBoundaries.Length ? null : RangeBoundaries[i];

                if (lastPartitionKey != null)
                {
                    if (to != null && string.CompareOrdinal(to, lastPartitionKey) <= 0)
                    {
                        // The whole range is before the last row read
                        continue;
                    }

                    if (from == null || string.CompareOrdinal(from, lastPartitionKey) <= 0)
                    {
                        // The range the last row read is in: only the part of it after that row is left
                        ranges.Add(new KeyRange(And(
                            to == null
                                ? Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey gt {lastPartitionKey}")
                                : Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey gt {lastPartitionKey} and PartitionKey lt {to}"),
                            filter)));

                        continue;
                    }
                }

                string rangeFilter =
                    from == null ? Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey lt {to}") :
                    to == null ? Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey ge {from}") :
                    Azure.Data.Tables.TableClient.CreateQueryFilter($"PartitionKey ge {from} and PartitionKey lt {to}");

                ranges.Add(new KeyRange(And(rangeFilter, filter)));
            }

            return ranges;
        }

        private static string And(string rangeFilter, string filter)
        {
            return string.IsNullOrEmpty(filter) ? rangeFilter : $"({rangeFilter}) and ({filter})";
        }

        // The old way: the continuation of one query, a request after another
        private static async Task ReadOnAsync(ITableClient tableClient, string tableName, string filter, IEnumerable<string> select, List<TableEntity> rows, string continuationToken, long budget, CancellationToken ct)
        {
            while (continuationToken != null && rows.Count < budget)
            {
                var page = await tableClient.QueryPageAsync(tableName, filter, select, PageSize(budget - rows.Count), continuationToken, ct);

                rows.AddRange(page.Rows);
                continuationToken = page.ContinuationToken;
            }
        }

        private static async Task ReadRangesAsync(ITableClient tableClient, string tableName, IEnumerable<string> select, List<KeyRange> ranges, long budget, int parallelism, CancellationToken ct)
        {
            // An equal share for every range first, side by side. Rounded down, so that together the ranges
            // cannot hold more than the budget (but at least a row each, or a tiny cap would read nothing).
            // Without a cap the share is as good as endless, and every range is simply read to its end.
            long share = Math.Max(1, budget / ranges.Count);

            using (var throttle = new SemaphoreSlim(parallelism))
            {
                await Task.WhenAll(ranges.Select(async range =>
                {
                    await throttle.WaitAsync(ct);
                    try
                    {
                        await range.ReadAsync(tableClient, tableName, select, share, ct);
                    }
                    finally
                    {
                        throttle.Release();
                    }
                }));
            }

            // Then what was left unused goes to the ranges that have more to give, in key order and one at a
            // time: that order is what makes a truncated scan return the same rows every time it runs.
            long unused = budget - ranges.Sum(range => (long)range.Rows.Count);

            foreach (var range in ranges)
            {
                if (unused <= 0)
                {
                    break;
                }

                if (range.Exhausted)
                {
                    continue;
                }

                long before = range.Rows.Count;

                await range.ReadAsync(tableClient, tableName, select, before + unused, ct);

                unused -= range.Rows.Count - before;
            }
        }

        /// <summary>One PartitionKey range of a scan: its filter, and what has been read of it so far.</summary>
        internal sealed class KeyRange
        {
            public KeyRange(string filter)
            {
                this.Filter = filter;
            }

            public string Filter { get; }

            public List<TableEntity> Rows { get; } = new List<TableEntity>();

            /// <summary>True once the range has been read to its end.</summary>
            public bool Exhausted { get; private set; }

            // Where the next page of this range starts
            private string _continuationToken;

            /// <summary>Reads on until the range holds <paramref name="maxRows"/> rows, or ends.</summary>
            public async Task ReadAsync(ITableClient tableClient, string tableName, IEnumerable<string> select, long maxRows, CancellationToken ct)
            {
                while (!this.Exhausted && this.Rows.Count < maxRows)
                {
                    var page = await tableClient.QueryPageAsync(tableName, this.Filter, select, PageSize(maxRows - this.Rows.Count), this._continuationToken, ct);

                    this.Rows.AddRange(page.Rows);

                    this._continuationToken = page.ContinuationToken;
                    this.Exhausted = page.ContinuationToken == null;
                }
            }
        }
    }
}
