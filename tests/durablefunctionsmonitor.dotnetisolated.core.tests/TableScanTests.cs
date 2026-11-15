// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The scan of a whole table as PartitionKey ranges read side by side. Whatever the keys look like, and
    /// however the service cuts its answers into pages, it has to return what one query from the first row to
    /// the last returns - and never more than its cap.
    /// </summary>
    [TestClass]
    public class TableScanTests
    {
        private const string Table = "HubInstances";

        private InMemoryTableClient _tables;
        private int _parallelismBefore;

        [TestInitialize]
        public void TestInit()
        {
            this._tables = new InMemoryTableClient();
            this._parallelismBefore = TableScan.Parallelism;
        }

        [TestCleanup]
        public void TestCleanup()
        {
            TableScan.Parallelism = this._parallelismBefore;
        }

        private Task<(IReadOnlyList<TableEntity> rows, bool truncated)> ScanAsync(string filter = null, int maxRows = 1000000, IEnumerable<string> select = null)
        {
            return TableScan.QueryAsync(this._tables, Table, filter, select, maxRows, CancellationToken.None);
        }

        private static TableEntity Instance(string instanceId, string runtimeStatus = "Completed", string rowKey = "")
        {
            return new TableEntity(instanceId, rowKey) { ["RuntimeStatus"] = runtimeStatus, ["Input"] = "a payload" };
        }

        private static string[] Keys(IEnumerable<TableEntity> rows)
        {
            return rows.Select(row => $"{row.PartitionKey}|{row.RowKey}").ToArray();
        }

        // What one query from the first row to the last returns
        private string[] Expected(Func<TableEntity, bool> matches = null)
        {
            return Keys(this._tables.AllRows(Table).Where(matches ?? (_ => true)));
        }

        /// <summary>Instance ids of every shape there is, the ones at the edges of the ranges among them.</summary>
        private static IEnumerable<string> AllKindsOfIds(int count, int seed)
        {
            var random = new Random(seed);

            // The boundaries themselves, their neighbours, and the ends of the key space
            foreach (string boundary in TableScan.RangeBoundaries)
            {
                yield return boundary;
                yield return boundary + "0";
                yield return boundary + "￿";
            }

            yield return " ";
            yield return "!";
            yield return "0";
            yield return "00000000000000000000000000000000";
            yield return "ffffffffffffffffffffffffffffffff";
            yield return "g";
            yield return "zzz";
            yield return "~";
            yield return "été";
            yield return "中文";
            yield return "it's";
            yield return "a b";
            yield return "A";
            yield return "F00D";
            yield return "Z";
            yield return "_underscore";

            for (int i = 0; i < count; i++)
            {
                switch (random.Next(6))
                {
                    case 0:
                        // What Durable Functions calls an instance, unless told otherwise
                        yield return Guid.NewGuid().ToString("N");
                        break;
                    case 1:
                        yield return Guid.NewGuid().ToString("D").ToUpperInvariant();
                        break;
                    case 2:
                        // A sub-orchestration: the parent's execution id and the task id
                        yield return $"{Guid.NewGuid():N}:{random.Next(50)}";
                        break;
                    case 3:
                        yield return $"@counter@{random.Next(100000)}";
                        break;
                    case 4:
                        yield return $"order-{random.Next(1000000):D7}";
                        break;
                    default:
                        yield return ((char)random.Next(33, 127)).ToString() + random.Next(100000);
                        break;
                }
            }
        }

        private void AddInstances(int count, int seed, Func<int, string> runtimeStatus = null)
        {
            var ids = AllKindsOfIds(count, seed).Distinct().ToList();

            this._tables.Add(Table, ids.Select((id, i) => Instance(id, runtimeStatus?.Invoke(i) ?? "Completed")).ToArray());
        }

        [TestMethod]
        public async Task ATableThatFitsIntoOneRequestCostsOneRequest()
        {
            this.AddInstances(300, 1);

            var (rows, truncated) = await this.ScanAsync();

            Assert.IsFalse(truncated);
            CollectionAssert.AreEqual(this.Expected(), Keys(rows));

            // Exactly what it cost before there were ranges
            var request = this._tables.Requests.Single();
            Assert.IsNull(request.Filter);
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(2)]
        [DataRow(4)]
        [DataRow(16)]
        [DataRow(100)]
        public async Task ALargeTableIsReadWholeAndInKeyOrder(int parallelism)
        {
            TableScan.Parallelism = parallelism;

            this.AddInstances(6000, 2);
            this._tables.ServerPageLimit = 200;

            var (rows, truncated) = await this.ScanAsync();

            Assert.IsFalse(truncated);
            CollectionAssert.AreEqual(this.Expected(), Keys(rows));

            bool readAsRanges = this._tables.Requests.Any(r => r.Filter != null && r.Filter.Contains("PartitionKey"));
            Assert.AreEqual(parallelism > 1, readAsRanges);
        }

        [TestMethod]
        [DataRow(3, 1000, int.MaxValue)]
        [DataRow(4, 50, int.MaxValue)]
        [DataRow(5, 1, int.MaxValue)]
        // A service that answers before a page is full: short pages, and empty ones, with more to come
        [DataRow(6, 1000, 300)]
        [DataRow(7, 100, 7)]
        [DataRow(8, 1000, 1)]
        public async Task ReturnsWhatOneQueryReturnsHoweverTheServiceCutsItsAnswers(int seed, int pageLimit, int scanLimit)
        {
            this.AddInstances(2000, seed, i => i % 9 == 0 ? "Failed" : "Completed");
            this._tables.ServerPageLimit = pageLimit;
            this._tables.ScanLimit = scanLimit;

            // Everything
            var (all, allTruncated) = await this.ScanAsync();

            Assert.IsFalse(allTruncated);
            CollectionAssert.AreEqual(this.Expected(), Keys(all));

            // And the few rows of a filter that is not on the keys, which is what a scan is for
            var (failed, failedTruncated) = await this.ScanAsync("RuntimeStatus eq 'Failed'");

            Assert.IsFalse(failedTruncated);
            CollectionAssert.AreEqual(this.Expected(row => row.GetString("RuntimeStatus") == "Failed"), Keys(failed));
        }

        [TestMethod]
        public async Task KeepsAFilterWithAnOrInItWhole()
        {
            this.AddInstances(3000, 9, i => new[] { "Completed", "Failed", "Running" }[i % 3]);
            this._tables.ServerPageLimit = 100;

            var (rows, _) = await this.ScanAsync("RuntimeStatus eq 'Failed' or RuntimeStatus eq 'Running'");

            CollectionAssert.AreEqual(this.Expected(row => row.GetString("RuntimeStatus") != "Completed"), Keys(rows));
        }

        [TestMethod]
        public async Task ReadsTheRestOfThePartitionTheFirstRequestStoppedIn()
        {
            // Not one row per partition, as in XXXInstances, but many, as in XXXHistory:
            // the first request ends in the middle of a partition, and the rest of it must not be lost
            var rows = new List<TableEntity>();
            foreach (string instanceId in new[] { "3a", "3b", "7c", "b1", "ff" })
            {
                rows.AddRange(Enumerable.Range(0, 250).Select(i => Instance(instanceId, rowKey: i.ToString("X16"))));
            }

            this._tables.Add(Table, rows.ToArray());
            this._tables.ServerPageLimit = 100;

            var (result, truncated) = await this.ScanAsync();

            Assert.IsFalse(truncated);
            Assert.AreEqual(1250, result.Count);
            CollectionAssert.AreEqual(this.Expected(), Keys(result));
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(17)]
        [DataRow(100)]
        [DataRow(999)]
        [DataRow(1000)]
        [DataRow(1001)]
        [DataRow(2500)]
        public async Task StopsAtTheCapAndSaysSo(int maxRows)
        {
            this.AddInstances(4000, 10);

            var expected = this.Expected();

            var (rows, truncated) = await this.ScanAsync(maxRows: maxRows);

            Assert.IsTrue(truncated);
            Assert.AreEqual(maxRows, rows.Count);

            // Rows of the table, each once, in key order
            var keys = Keys(rows);
            CollectionAssert.IsSubsetOf(keys, expected);
            CollectionAssert.AllItemsAreUnique(keys);

            for (int i = 1; i < rows.Count; i++)
            {
                Assert.IsTrue(string.CompareOrdinal(rows[i - 1].PartitionKey, rows[i].PartitionKey) < 0, $"'{rows[i].PartitionKey}' came after '{rows[i - 1].PartitionKey}'");
            }

            // The cap is a promise about the storage account: one row more than it, to know there was more,
            // and at most a row for each range when the cap is smaller than the number of ranges
            Assert.IsTrue(this._tables.RowsReturned <= maxRows + 1 + TableScan.RangeBoundaries.Length + 2, $"{this._tables.RowsReturned} rows were read for a cap of {maxRows}");
        }

        [TestMethod]
        [DataRow(4000, 4000)]
        [DataRow(4000, 3999)]
        [DataRow(1000, 1000)]
        [DataRow(1000, 999)]
        [DataRow(1001, 1000)]
        [DataRow(1, 1)]
        public async Task TellsExactlyTheCapFromMoreThanTheCap(int rowCount, int maxRows)
        {
            this._tables.Add(Table, Enumerable.Range(0, rowCount).Select(i => Instance(Guid.NewGuid().ToString("N"))).ToArray());

            var (rows, truncated) = await this.ScanAsync(maxRows: maxRows);

            Assert.AreEqual(rowCount > maxRows, truncated);
            Assert.AreEqual(Math.Min(rowCount, maxRows), rows.Count);
        }

        [TestMethod]
        public async Task ATruncatedScanReturnsTheSameRowsEveryTime()
        {
            TableScan.Parallelism = 8;

            this.AddInstances(5000, 11);

            // Requests that take a different time each, so that the ranges finish in a different order every run
            var random = new Random(12);
            this._tables.OnRequest = async _ =>
            {
                int delay;
                lock (random) { delay = random.Next(4); }
                await Task.Delay(delay);
            };

            var first = Keys((await this.ScanAsync(maxRows: 2300)).rows);
            var second = Keys((await this.ScanAsync(maxRows: 2300)).rows);
            var third = Keys((await this.ScanAsync(maxRows: 2300)).rows);

            CollectionAssert.AreEqual(first, second);
            CollectionAssert.AreEqual(first, third);
        }

        [TestMethod]
        public async Task GivesWhatSomeRangesLeaveUnusedToTheOnesThatHaveMore()
        {
            // Nearly everything in one range (ids an application named itself), a few rows in each of the others
            var ids = Enumerable.Range(0, 3000).Select(i => $"5-order-{i:D6}")
                .Concat(Enumerable.Range(0, 64).Select(i => Guid.NewGuid().ToString("N")))
                .ToList();

            this._tables.Add(Table, ids.Select(id => Instance(id)).ToArray());
            this._tables.ServerPageLimit = 100;

            // A cap that an equal share for every range would stop far short of
            var (rows, truncated) = await this.ScanAsync(maxRows: 2000);

            Assert.IsTrue(truncated);
            Assert.AreEqual(2000, rows.Count);
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(3)]
        [DataRow(8)]
        public async Task NeverHasMoreRequestsInFlightThanItIsAllowed(int parallelism)
        {
            TableScan.Parallelism = parallelism;

            this.AddInstances(4000, 13);
            this._tables.ServerPageLimit = 50;

            int inFlight = 0;
            int mostInFlight = 0;

            this._tables.OnRequest = async _ =>
            {
                int now = Interlocked.Increment(ref inFlight);
                InterlockedMax(ref mostInFlight, now);

                await Task.Delay(1);

                Interlocked.Decrement(ref inFlight);
            };

            var (rows, _) = await this.ScanAsync();

            Assert.AreEqual(this.Expected().Length, rows.Count);
            Assert.IsTrue(mostInFlight <= parallelism, $"{mostInFlight} requests at once with a parallelism of {parallelism}");

            if (parallelism > 1)
            {
                Assert.IsTrue(mostInFlight > 1, "the ranges were read one after another");
            }
        }

        [TestMethod]
        public async Task AsksOnlyForTheColumnsItWasToldTo()
        {
            this.AddInstances(1500, 14);
            this._tables.ServerPageLimit = 100;

            var (rows, _) = await this.ScanAsync(select: new[] { "RuntimeStatus" });

            Assert.IsTrue(this._tables.Requests.Count > 1);
            Assert.IsTrue(this._tables.Requests.All(r => r.Select.SequenceEqual(new[] { "RuntimeStatus" })));
            Assert.IsTrue(rows.All(row => row.ContainsKey("RuntimeStatus") && !row.ContainsKey("Input")));
        }

        [TestMethod]
        public async Task StopsWhenItIsCancelled()
        {
            this.AddInstances(4000, 15);
            this._tables.ServerPageLimit = 50;

            using (var cts = new CancellationTokenSource())
            {
                int requests = 0;
                this._tables.OnRequest = _ =>
                {
                    if (Interlocked.Increment(ref requests) == 5)
                    {
                        cts.Cancel();
                    }

                    return Task.CompletedTask;
                };

                await Assert.ThrowsAsync<OperationCanceledException>(
                    () => TableScan.QueryAsync(this._tables, Table, null, null, 1000000, cts.Token));
            }

            Assert.IsTrue(this._tables.Requests.Count < 40, $"{this._tables.Requests.Count} requests were made after the scan was cancelled");
        }

        [TestMethod]
        public async Task AFailedRangeFailsTheScan()
        {
            this.AddInstances(4000, 16);
            this._tables.ServerPageLimit = 50;

            this._tables.OnRequest = request => request.Filter != null && request.Filter.Contains("PartitionKey ge 'c'")
                ? throw new InvalidOperationException("this range cannot be read")
                : Task.CompletedTask;

            // Part of a table is not the table
            await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => this.ScanAsync());
        }

        [TestMethod]
        [DataRow(0)]
        [DataRow(-1)]
        public async Task RejectsANonPositiveCap(int maxRows)
        {
            var ex = await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(() => this.ScanAsync(maxRows: maxRows));

            Assert.AreEqual("maxRows", ex.ParamName);
        }

        [TestMethod]
        public void TheRangesOfAWholeTableCoverEveryKeyOnce()
        {
            var ranges = TableScan.CutIntoRanges(null, null);

            Assert.AreEqual(TableScan.RangeBoundaries.Length + 1, ranges.Count);
            Assert.AreEqual("PartitionKey lt '1'", ranges.First().Filter);
            Assert.AreEqual("PartitionKey ge '1' and PartitionKey lt '2'", ranges[1].Filter);
            Assert.AreEqual("PartitionKey ge 'f'", ranges.Last().Filter);

            AssertEveryKeyIsInOneRange(ranges, AllKindsOfIds(2000, 17).Select(id => Instance(id)));
        }

        [TestMethod]
        [DataRow("", "")]
        [DataRow("0abc", "")]
        [DataRow("1", "")]
        [DataRow("3f2a", "0000000000000005")]
        [DataRow("9", "")]
        [DataRow("@counter@5", "")]
        [DataRow("a", "")]
        [DataRow("f", "")]
        [DataRow("fff", "")]
        [DataRow("zzz", "")]
        [DataRow("it's", "o'clock")]
        public void TheRangesAfterARowCoverEveryLaterKeyOnceAndNoEarlierOne(string lastPartitionKey, string lastRowKey)
        {
            var last = Instance(lastPartitionKey, rowKey: lastRowKey);
            var ranges = TableScan.CutIntoRanges("RuntimeStatus eq 'Completed'", last);

            var rows = AllKindsOfIds(1500, 18).Select(id => Instance(id)).ToList();

            // And the neighbours of the row itself, in its own partition and next to it
            rows.Add(Instance(lastPartitionKey, rowKey: lastRowKey + "0"));
            rows.Add(Instance(lastPartitionKey, rowKey: "zzzz"));
            rows.Add(Instance(lastPartitionKey + "0"));
            rows.Add(Instance(lastPartitionKey + " "));

            bool IsAfter(TableEntity row)
            {
                int byPartition = string.CompareOrdinal(row.PartitionKey, last.PartitionKey);
                return byPartition > 0 || (byPartition == 0 && string.CompareOrdinal(row.RowKey, last.RowKey) > 0);
            }

            AssertEveryKeyIsInOneRange(ranges, rows.Where(IsAfter));

            var matchers = ranges.Select(range => ODataFilter.Parse(range.Filter)).ToList();
            foreach (var row in rows.Where(row => !IsAfter(row)))
            {
                Assert.IsFalse(matchers.Any(matches => matches(row)), $"'{row.PartitionKey}|{row.RowKey}' was read already, and is in a range again");
            }

            // Each of them still carries the filter of the scan
            Assert.IsTrue(ranges.All(range => range.Filter.EndsWith(" and (RuntimeStatus eq 'Completed')")));
        }

        private static void AssertEveryKeyIsInOneRange(IReadOnlyList<TableScan.KeyRange> ranges, IEnumerable<TableEntity> rows)
        {
            var matchers = ranges.Select(range => ODataFilter.Parse(range.Filter)).ToList();

            foreach (var row in rows)
            {
                int inRanges = matchers.Count(matches => matches(row));

                Assert.AreEqual(1, inRanges, $"'{row.PartitionKey}|{row.RowKey}' is in {inRanges} ranges");
            }
        }

        private static void InterlockedMax(ref int target, int value)
        {
            int current;
            do
            {
                current = Volatile.Read(ref target);
            }
            while (value > current && Interlocked.CompareExchange(ref target, value, current) != current);
        }

        #region The stream: every row, without a cap, for a caller that reads to the end or one that may not

        private static string Key(TableEntity row)
        {
            return $"{row.PartitionKey}|{row.RowKey}";
        }

        private async Task<List<string>> StreamAsync(bool readToEnd, string filter = null, IEnumerable<string> select = null)
        {
            var keys = new List<string>();

            await foreach (var batch in TableScan.StreamAsync(this._tables, Table, filter, select, Key, readToEnd))
            {
                keys.AddRange(batch);
            }

            return keys;
        }

        [TestMethod]
        [DataRow(true)]
        [DataRow(false)]
        public async Task AStreamOfATableThatFitsIntoOneRequestCostsOneRequest(bool readToEnd)
        {
            this.AddInstances(300, 20);

            var keys = await this.StreamAsync(readToEnd);

            CollectionAssert.AreEqual(this.Expected(), keys);

            Assert.IsNull(this._tables.Requests.Single().Filter);
        }

        [TestMethod]
        // Read to the end: ranges side by side, unless told to read one request after another
        [DataRow(true, 4, 200, int.MaxValue)]
        [DataRow(true, 16, 1000, int.MaxValue)]
        [DataRow(true, 2, 50, 7)]
        [DataRow(true, 8, 1000, 1)]
        [DataRow(true, 1, 200, int.MaxValue)]
        // Not read to the end: a request at a time, whatever the parallelism
        [DataRow(false, 4, 200, int.MaxValue)]
        [DataRow(false, 16, 100, 7)]
        [DataRow(false, 1, 1000, 300)]
        public async Task AStreamReturnsWhatOneQueryReturnsHoweverItIsRead(bool readToEnd, int parallelism, int pageLimit, int scanLimit)
        {
            TableScan.Parallelism = parallelism;

            this.AddInstances(3000, 21, i => i % 9 == 0 ? "Failed" : "Completed");
            this._tables.ServerPageLimit = pageLimit;
            this._tables.ScanLimit = scanLimit;

            CollectionAssert.AreEqual(this.Expected(), await this.StreamAsync(readToEnd));

            bool readAsRanges = this._tables.Requests.Any(r => r.Filter != null && r.Filter.Contains("PartitionKey"));
            Assert.AreEqual(readToEnd && parallelism > 1, readAsRanges);

            // And the few rows of a filter that is not on the keys
            CollectionAssert.AreEqual(
                this.Expected(row => row.GetString("RuntimeStatus") == "Failed"),
                await this.StreamAsync(readToEnd, "RuntimeStatus eq 'Failed'"));
        }

        [TestMethod]
        public async Task AStreamOfManyRowsToAPartitionLosesNoneOfThem()
        {
            // The first request ends in the middle of a partition, as it does in XXXHistory
            var rows = new List<TableEntity>();
            foreach (string instanceId in new[] { "3a", "3b", "7c", "b1", "ff" })
            {
                rows.AddRange(Enumerable.Range(0, 250).Select(i => Instance(instanceId, rowKey: i.ToString("X16"))));
            }

            this._tables.Add(Table, rows.ToArray());
            this._tables.ServerPageLimit = 100;

            CollectionAssert.AreEqual(this.Expected(), await this.StreamAsync(readToEnd: true));
            CollectionAssert.AreEqual(this.Expected(), await this.StreamAsync(readToEnd: false));
        }

        [TestMethod]
        public async Task AStreamThatMayStopEarlyReadsNothingAhead()
        {
            TableScan.Parallelism = 8;

            this.AddInstances(3000, 22);
            this._tables.ServerPageLimit = 100;

            var keys = new List<string>();

            await foreach (var batch in TableScan.StreamAsync(this._tables, Table, null, null, Key, readToEnd: false))
            {
                keys.AddRange(batch);

                if (keys.Count >= 250)
                {
                    break;
                }
            }

            // Three pages of a hundred, each asked for when the one before it had been taken - and not a
            // request for what the caller did not stay for
            CollectionAssert.AreEqual(this.Expected().Take(300).ToArray(), keys);

            Assert.AreEqual(3, this._tables.Requests.Count);
            Assert.IsTrue(this._tables.Requests.All(r => r.Filter == null));
        }

        [TestMethod]
        public async Task AStreamAsksForTheNextRequestOnlyWhenTheCallerDoes()
        {
            this.AddInstances(1000, 23);
            this._tables.ServerPageLimit = 100;

            var stream = TableScan.StreamAsync(this._tables, Table, null, null, Key, readToEnd: false).GetAsyncEnumerator();
            try
            {
                Assert.AreEqual(0, this._tables.Requests.Count, "nothing is read before the first batch is asked for");

                for (int batch = 1; batch <= 4; batch++)
                {
                    Assert.IsTrue(await stream.MoveNextAsync());
                    Assert.AreEqual(batch, this._tables.Requests.Count);
                }
            }
            finally
            {
                await stream.DisposeAsync();
            }

            Assert.AreEqual(4, this._tables.Requests.Count);
        }

        [TestMethod]
        [DataRow(2)]
        [DataRow(5)]
        [DataRow(16)]
        public async Task AStreamThatIsReadToItsEndReadsItsRangesSideBySide(int parallelism)
        {
            TableScan.Parallelism = parallelism;

            this.AddInstances(4000, 24);
            this._tables.ServerPageLimit = 50;

            int inFlight = 0;
            int mostInFlight = 0;

            this._tables.OnRequest = async _ =>
            {
                int now = Interlocked.Increment(ref inFlight);
                InterlockedMax(ref mostInFlight, now);

                await Task.Delay(1);

                Interlocked.Decrement(ref inFlight);
            };

            var keys = await this.StreamAsync(readToEnd: true);

            CollectionAssert.AreEqual(this.Expected(), keys);

            Assert.IsTrue(mostInFlight > 1, "the ranges were read one after another");
            Assert.IsTrue(mostInFlight <= parallelism, $"{mostInFlight} requests at once with a parallelism of {parallelism}");
        }

        [TestMethod]
        public async Task AStreamTurnsEveryRowIntoWhatTheCallerKeepsOfItOnce()
        {
            this.AddInstances(2500, 25);
            this._tables.ServerPageLimit = 200;

            int converted = 0;
            var statuses = new List<string>();

            await foreach (var batch in TableScan.StreamAsync(
                this._tables,
                Table,
                null,
                new[] { "RuntimeStatus" },
                row =>
                {
                    Interlocked.Increment(ref converted);

                    // Only what was asked for is there to convert
                    Assert.IsFalse(row.ContainsKey("Input"));

                    return row.GetString("RuntimeStatus");
                },
                readToEnd: true))
            {
                statuses.AddRange(batch);
            }

            int rowCount = this.Expected().Length;

            Assert.AreEqual(rowCount, statuses.Count);
            Assert.AreEqual(rowCount, converted);
            Assert.IsTrue(statuses.All(status => status == "Completed"));
            Assert.IsTrue(this._tables.Requests.All(r => r.Select.SequenceEqual(new[] { "RuntimeStatus" })));
        }

        [TestMethod]
        public async Task LeavingAStreamEarlyStopsWhatWasBeingReadAheadForIt()
        {
            TableScan.Parallelism = 4;

            this.AddInstances(6000, 26);
            this._tables.ServerPageLimit = 20;
            this._tables.OnRequest = _ => Task.Delay(2);

            int requestsItTakes = this.Expected().Length / 20;
            int batches = 0;

            await foreach (var batch in TableScan.StreamAsync(this._tables, Table, null, null, Key, readToEnd: true))
            {
                // The first request, and the first of the ranges
                if (++batches == 2)
                {
                    break;
                }
            }

            int requestsWhenItLeft = this._tables.Requests.Count;

            Assert.IsTrue(requestsWhenItLeft < requestsItTakes / 2, $"{requestsWhenItLeft} of the {requestsItTakes} requests of the whole table were made for a caller that left after two batches");

            // And nothing goes on reading behind its back
            await Task.Delay(100);

            Assert.AreEqual(requestsWhenItLeft, this._tables.Requests.Count, "the table was still being read after the caller had left");
        }

        [TestMethod]
        public async Task AFailedRangeFailsTheStreamAndStopsTheOthers()
        {
            TableScan.Parallelism = 4;

            this.AddInstances(4000, 27);
            this._tables.ServerPageLimit = 50;

            this._tables.OnRequest = request => request.Filter != null && request.Filter.Contains("PartitionKey ge 'c'")
                ? throw new InvalidOperationException("this range cannot be read")
                : Task.CompletedTask;

            // Part of a table is not the table
            await Assert.ThrowsExactlyAsync<InvalidOperationException>(() => this.StreamAsync(readToEnd: true));

            int requestsWhenItFailed = this._tables.Requests.Count;

            await Task.Delay(50);

            Assert.AreEqual(requestsWhenItFailed, this._tables.Requests.Count, "the table was still being read after the stream had failed");
        }

        [TestMethod]
        [DataRow(true)]
        [DataRow(false)]
        public async Task AStreamStopsWhenItIsCancelled(bool readToEnd)
        {
            this.AddInstances(4000, 28);
            this._tables.ServerPageLimit = 50;

            using (var cts = new CancellationTokenSource())
            {
                int requests = 0;
                this._tables.OnRequest = _ =>
                {
                    if (Interlocked.Increment(ref requests) == 5)
                    {
                        cts.Cancel();
                    }

                    return Task.CompletedTask;
                };

                await Assert.ThrowsAsync<OperationCanceledException>(async () =>
                {
                    await foreach (var batch in TableScan.StreamAsync(this._tables, Table, null, null, Key, readToEnd, cts.Token))
                    {
                    }
                });
            }

            Assert.IsTrue(this._tables.Requests.Count < 40, $"{this._tables.Requests.Count} requests were made after the stream was cancelled");
        }

        #endregion

        [TestMethod]
        public async Task ReadAllFollowsEveryPageToTheEnd()
        {
            this.AddInstances(700, 19, i => i % 4 == 0 ? "Failed" : "Completed");
            this._tables.ServerPageLimit = 60;
            this._tables.ScanLimit = 45;

            var rows = await TableScan.ReadAllAsync(this._tables, Table, "RuntimeStatus eq 'Failed'", null, CancellationToken.None);

            CollectionAssert.AreEqual(this.Expected(row => row.GetString("RuntimeStatus") == "Failed"), Keys(rows));
        }
    }
}
