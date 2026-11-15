// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.integrationtests
{
    /// <summary>
    /// The page-at-a-time query of ITableClient, and the scan of a whole table as PartitionKey ranges that is
    /// built on it, against a real Table endpoint: the continuation tokens, the projection, the filters of the
    /// ranges with the filter of the scan inside them, and the way the service orders and compares keys.
    /// And the list of the Instances screen, which is such a scan without a cap.
    ///
    /// One table of instance rows for the whole class - more than one request returns, with ids of every shape -
    /// because nothing here changes it.
    /// </summary>
    [TestClass]
    public class TableScanStorageTests
    {
        private const int RowCount = 1300;

        [ClassInitialize]
        public static async Task ClassInit(TestContext context)
        {
            if (!StorageEmulator.IsAvailable)
            {
                return;
            }

            _tableName = "DfmScan" + Guid.NewGuid().ToString("N").Substring(0, 12) + "Instances";

            _service = new TableServiceClient(StorageEmulator.ConnectionString);
            await _service.CreateTableIfNotExistsAsync(_tableName);

            var table = _service.GetTableClient(_tableName);

            _rows = InstanceIds().Distinct().Take(RowCount).Select((id, i) => new TableEntity(id, string.Empty)
            {
                ["Name"] = $"Orchestrator{i % 3}",
                ["RuntimeStatus"] = i % 7 == 0 ? "Failed" : (i % 7 == 1 ? "Running" : "Completed"),
                ["CreatedTime"] = BaseTime.AddMinutes(i),
                ["Input"] = new string('i', 2000)
            }).ToList();

            // Every instance is a partition of its own, so there is no batching these
            await Parallel.ForEachAsync(_rows, new ParallelOptions { MaxDegreeOfParallelism = 16 }, async (row, ct) =>
            {
                await table.UpsertEntityAsync(row, TableUpdateMode.Replace, ct);
            });
        }

        [ClassCleanup]
        public static async Task ClassCleanup()
        {
            if (_service != null)
            {
                await _service.DeleteTableAsync(_tableName);
            }
        }

        [TestInitialize]
        public void TestInit()
        {
            StorageEmulator.SkipIfUnavailable();

            Environment.SetEnvironmentVariable(ConnStringName, StorageEmulator.ConnectionString);

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            this._tableClient = new CountingTableClient(DurableFunctionsMonitor.DotNetIsolated.TableClient.GetTableClient(ConnStringName));

            this._parallelismBefore = TableScan.Parallelism;
        }

        [TestCleanup]
        public void TestCleanup()
        {
            TableScan.Parallelism = this._parallelismBefore;

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
        }

        /// <summary>
        /// Ids of the shapes instances have, the ones at the edges of the ranges among them. Only characters a
        /// key may hold: no '/', '\', '#' or '?'.
        /// </summary>
        private static IEnumerable<string> InstanceIds()
        {
            foreach (string boundary in TableScan.RangeBoundaries)
            {
                yield return boundary;
                yield return boundary + "0";
                yield return boundary + "zz";
            }

            yield return "0";
            yield return "00000000000000000000000000000000";
            yield return "ffffffffffffffffffffffffffffffff";
            yield return "g";
            yield return "zzz";
            yield return "~tilde";
            yield return "it's-quoted";
            yield return "with space";
            yield return "été";
            yield return "中文";
            yield return "A";
            yield return "F00D";
            yield return "Z";
            yield return "_underscore";
            yield return "!bang";
            yield return "(brackets)";
            yield return "100%";

            var random = new Random(20261114);

            while (true)
            {
                switch (random.Next(5))
                {
                    case 0:
                    case 1:
                        yield return Guid.NewGuid().ToString("N");
                        break;
                    case 2:
                        yield return Guid.NewGuid().ToString("D").ToUpperInvariant();
                        break;
                    case 3:
                        yield return $"@counter@{random.Next(1000000)}";
                        break;
                    default:
                        yield return $"order-{random.Next(10000000):D8}";
                        break;
                }
            }
        }

        // What one query from the first row to the last returns, in the order the service returns it
        private async Task<string[]> EverythingAsync(string filter)
        {
            return (await this._tableClient.GetAllAsync(_tableName, filter)).Select(row => row.PartitionKey).ToArray();
        }

        private static string[] Ids(IEnumerable<TableEntity> rows)
        {
            return rows.Select(row => row.PartitionKey).ToArray();
        }

        [TestMethod]
        public async Task APageIsOneRequestAndSaysWhereTheNextOneStarts()
        {
            var everything = await this.EverythingAsync(null);
            Assert.AreEqual(RowCount, everything.Length);

            this._tableClient.Reset();

            var first = await this._tableClient.QueryPageAsync(_tableName, null, null, 1000, null, CancellationToken.None);

            Assert.AreEqual(1000, first.Rows.Count);
            Assert.IsNotNull(first.ContinuationToken);

            var second = await this._tableClient.QueryPageAsync(_tableName, null, null, 1000, first.ContinuationToken, CancellationToken.None);

            Assert.AreEqual(RowCount - 1000, second.Rows.Count);
            Assert.IsNull(second.ContinuationToken);

            // Together, the table, in its order
            CollectionAssert.AreEqual(everything, Ids(first.Rows.Concat(second.Rows)));
        }

        [TestMethod]
        public async Task APageHoldsNoMoreRowsThanItWasAskedFor()
        {
            var everything = await this.EverythingAsync(null);

            var rows = new List<TableEntity>();
            string continuationToken = null;
            int pages = 0;

            do
            {
                var page = await this._tableClient.QueryPageAsync(_tableName, null, Array.Empty<string>(), 170, continuationToken, CancellationToken.None);

                Assert.IsTrue(page.Rows.Count <= 170);

                rows.AddRange(page.Rows);
                continuationToken = page.ContinuationToken;
                pages++;
            }
            while (continuationToken != null);

            CollectionAssert.AreEqual(everything, Ids(rows));
            Assert.IsTrue(pages >= (RowCount + 169) / 170);
        }

        [TestMethod]
        public async Task APageBringsOnlyTheColumnsItWasAskedFor()
        {
            var page = await this._tableClient.QueryPageAsync(_tableName, "RuntimeStatus eq 'Failed'", new[] { "Name" }, 5, null, CancellationToken.None);

            Assert.AreEqual(5, page.Rows.Count);

            foreach (var row in page.Rows)
            {
                // The keys always, the column that was asked for, and not the payload
                Assert.IsFalse(string.IsNullOrEmpty(row.PartitionKey));
                Assert.AreEqual(string.Empty, row.RowKey);
                Assert.IsTrue(row.GetString("Name").StartsWith("Orchestrator"));
                Assert.IsFalse(row.ContainsKey("Input"));
                Assert.IsFalse(row.ContainsKey("RuntimeStatus"));
            }
        }

        [TestMethod]
        public async Task APageOfNothingIsEmptyAndTheLast()
        {
            var page = await this._tableClient.QueryPageAsync(_tableName, "RuntimeStatus eq 'NoSuchStatus'", null, 1000, null, CancellationToken.None);

            Assert.AreEqual(0, page.Rows.Count);
            Assert.IsNull(page.ContinuationToken);
        }

        [TestMethod]
        public async Task AnEntityCanBeReadWithOnlySomeOfItsColumns()
        {
            string instanceId = _rows[42].PartitionKey;

            var whole = await this._tableClient.GetEntityAsync(_tableName, instanceId, string.Empty);
            var part = await this._tableClient.GetEntityAsync(_tableName, instanceId, string.Empty, new[] { "RuntimeStatus" });

            Assert.IsTrue(whole.ContainsKey("Input"));

            Assert.AreEqual(instanceId, part.PartitionKey);
            Assert.AreEqual(whole.GetString("RuntimeStatus"), part.GetString("RuntimeStatus"));
            Assert.IsFalse(part.ContainsKey("Input"));
            Assert.IsFalse(part.ContainsKey("Name"));

            Assert.IsNull(await this._tableClient.GetEntityAsync(_tableName, "no-such-instance", string.Empty, new[] { "RuntimeStatus" }));
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(4)]
        [DataRow(16)]
        public async Task TheScanOfATableReturnsWhatOneQueryReturns(int parallelism)
        {
            TableScan.Parallelism = parallelism;

            var expected = await this.EverythingAsync(null);

            this._tableClient.Reset();

            var (rows, truncated) = await TableScan.QueryAsync(this._tableClient, _tableName, null, new[] { "Name" }, 100000, CancellationToken.None);

            Assert.IsFalse(truncated);
            CollectionAssert.AreEqual(expected, Ids(rows));

            // More than a page of rows, so the rest of the table was cut into ranges - unless told not to
            bool cutIntoRanges = this._tableClient.PageFilters.Any(filter => filter != null && filter.Contains("PartitionKey"));
            Assert.AreEqual(parallelism > 1, cutIntoRanges);
        }

        [TestMethod]
        public async Task TheScanKeepsTheFilterItWasGivenInEveryRange()
        {
            // The filters of /stats and /failures: a status, and a range of creation times, neither of them a key
            string filter = Azure.Data.Tables.TableClient.CreateQueryFilter(
                $"RuntimeStatus eq {"Failed"} and CreatedTime ge {BaseTime.AddMinutes(100)} and CreatedTime le {BaseTime.AddMinutes(1200)}");

            var expected = await this.EverythingAsync(filter);
            Assert.IsTrue(expected.Length > 100, "the filter should match a good number of rows");

            // A page smaller than the result, so that the scan has ranges to read
            var (rows, truncated) = await ScanInSmallPagesAsync(this._tableClient, filter, 100000);

            Assert.IsFalse(truncated);
            CollectionAssert.AreEqual(expected, Ids(rows));
        }

        [TestMethod]
        public async Task TheScanKeepsAFilterWithAnOrInItWhole()
        {
            string filter = "RuntimeStatus eq 'Failed' or RuntimeStatus eq 'Running'";

            var expected = await this.EverythingAsync(filter);

            var (rows, _) = await ScanInSmallPagesAsync(this._tableClient, filter, 100000);

            CollectionAssert.AreEqual(expected, Ids(rows));
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(250)]
        [DataRow(999)]
        [DataRow(1000)]
        [DataRow(1001)]
        [DataRow(1299)]
        public async Task TheScanStopsAtItsCapAndSaysSo(int maxRows)
        {
            var everything = await this.EverythingAsync(null);

            this._tableClient.Reset();

            var (rows, truncated) = await TableScan.QueryAsync(this._tableClient, _tableName, null, Array.Empty<string>(), maxRows, CancellationToken.None);

            Assert.IsTrue(truncated);
            Assert.AreEqual(maxRows, rows.Count);

            // Rows of the table, each once, in the order of the table
            var ids = Ids(rows);
            CollectionAssert.AllItemsAreUnique(ids);
            CollectionAssert.AreEqual(everything.Where(new HashSet<string>(ids).Contains).ToArray(), ids);

            // And no more read than the cap allows: a row to know there was more, and one per range for a tiny cap
            Assert.IsTrue(this._tableClient.RowsReturned <= maxRows + 1 + TableScan.RangeBoundaries.Length + 2, $"{this._tableClient.RowsReturned} rows were read for a cap of {maxRows}");
        }

        [TestMethod]
        public async Task TheScanTellsExactlyTheCapFromMoreThanTheCap()
        {
            var (rows, truncated) = await TableScan.QueryAsync(this._tableClient, _tableName, null, Array.Empty<string>(), RowCount, CancellationToken.None);

            Assert.IsFalse(truncated);
            Assert.AreEqual(RowCount, rows.Count);
        }

        [TestMethod]
        public async Task ATruncatedScanReturnsTheSameRowsEveryTime()
        {
            TableScan.Parallelism = 8;

            // A cap past the first request, so that the rest is read as ranges, side by side
            var first = Ids((await TableScan.QueryAsync(this._tableClient, _tableName, null, Array.Empty<string>(), 1150, CancellationToken.None)).rows);
            var second = Ids((await TableScan.QueryAsync(this._tableClient, _tableName, null, Array.Empty<string>(), 1150, CancellationToken.None)).rows);

            Assert.AreEqual(1150, first.Length);
            CollectionAssert.AreEqual(first, second);

            Assert.IsTrue(this._tableClient.PageFilters.Any(filter => filter != null && filter.Contains("PartitionKey")), "the scan was not cut into ranges");
        }

        [TestMethod]
        public async Task TheRangesCoverEveryRowOfTheTableOnce()
        {
            // Each range as a query of its own, against the service: what it takes for a key to be in a range
            // is the service's to say, not this test's
            var seen = new List<string>();

            foreach (var range in TableScan.CutIntoRanges(null, null))
            {
                seen.AddRange(await this.EverythingAsync(range.Filter));
            }

            CollectionAssert.AreEqual(await this.EverythingAsync(null), seen.ToArray());
        }

        [TestMethod]
        public async Task TheRangesAfterARowCoverEveryLaterRowOnce()
        {
            var everything = await this.EverythingAsync(null);

            // After a row in the middle of every kind of id there is
            foreach (int position in new[] { 0, 1, 57, 400, 650, 999, 1200, RowCount - 2, RowCount - 1 })
            {
                var seen = new List<string>();

                foreach (var range in TableScan.CutIntoRanges(null, new TableEntity(everything[position], string.Empty)))
                {
                    seen.AddRange(await this.EverythingAsync(range.Filter));
                }

                CollectionAssert.AreEqual(everything.Skip(position + 1).ToArray(), seen.ToArray(), $"after '{everything[position]}'");
            }
        }

        [TestMethod]
        [DataRow(1)]
        [DataRow(4)]
        [DataRow(16)]
        public async Task TheListOfInstancesIsEveryOrchestrationOfTheTableInItsOrder(int parallelism)
        {
            TableScan.Parallelism = parallelism;

            // Entities are rows of the same table, and not a part of this list
            var everything = await this.EverythingAsync(null);
            var expected = everything.Where(id => !id.StartsWith('@')).ToArray();

            Assert.IsTrue(expected.Length > 0 && expected.Length < everything.Length, "the table should hold orchestrations and entities");

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tableClient;
            this._tableClient.Reset();

            var instances = await this.ListInstancesAsync(new OrchestrationQuery());

            CollectionAssert.AreEqual(expected, instances.Select(i => i.InstanceId).ToArray());

            // All of them, and not a row of the table more: the entities stayed in the storage account
            Assert.AreEqual(expected.Length, this._tableClient.RowsReturned);

            // What a row of the list says is what the row of the table says
            var row = _rows.First(r => r.PartitionKey == expected[expected.Length / 2]);
            var instance = instances[expected.Length / 2];

            Assert.AreEqual(row.GetString("Name"), instance.Name);
            Assert.AreEqual(row.GetString("RuntimeStatus"), instance.RuntimeStatus.ToString());
            Assert.AreEqual(row.GetDateTimeOffset("CreatedTime"), instance.CreatedAt);
            Assert.IsNull(instance.SerializedInput);
        }

        [TestMethod]
        public async Task TheListOfInstancesKeepsItsTimeRangeAndItsStatusesInEveryRange()
        {
            var from = BaseTime.AddMinutes(100);
            var to = BaseTime.AddMinutes(1200);

            var rowsById = _rows.ToDictionary(r => r.PartitionKey);

            var expected = (await this.EverythingAsync(null)).Where(id =>
            {
                var created = rowsById[id].GetDateTimeOffset("CreatedTime").Value;
                string status = rowsById[id].GetString("RuntimeStatus");

                return !id.StartsWith('@') && created >= from && created <= to && (status == "Failed" || status == "Running");
            })
            .ToArray();

            Assert.IsTrue(expected.Length > 100, "the query should match a good number of rows");

            // Pages smaller than the answer, so that it is read as ranges
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = new SmallPages(this._tableClient, 40);
            this._tableClient.Reset();

            var instances = await this.ListInstancesAsync(new OrchestrationQuery
            {
                CreatedFrom = from,
                CreatedTo = to,
                Statuses = new[] { OrchestrationRuntimeStatus.Failed, OrchestrationRuntimeStatus.Running }
            });

            CollectionAssert.AreEqual(expected, instances.Select(i => i.InstanceId).ToArray());

            Assert.IsTrue(this._tableClient.PageFilters.Any(filter => filter.Contains("PartitionKey ge 'a' and PartitionKey lt 'b'")), "the list was not read as ranges");
            Assert.IsTrue(this._tableClient.PageFilters.All(filter => filter.Contains("CreatedTime ge") && filter.Contains("RuntimeStatus eq 'Failed' or RuntimeStatus eq 'Running'")));
        }

        [TestMethod]
        public async Task TheListOfInstancesTakesBothEndsOfItsTimeRange()
        {
            var row = _rows.Where(r => !r.PartitionKey.StartsWith('@')).ElementAt(500);
            var created = row.GetDateTimeOffset("CreatedTime").Value;

            // Every row of the table was created in a minute of its own
            var instances = await this.ListInstancesAsync(new OrchestrationQuery { CreatedFrom = created, CreatedTo = created });

            Assert.AreEqual(row.PartitionKey, instances.Single().InstanceId);

            // A range that starts right after that moment and ends right before the next one holds nothing
            instances = await this.ListInstancesAsync(new OrchestrationQuery { CreatedFrom = created.AddMilliseconds(1), CreatedTo = created.AddMinutes(1).AddMilliseconds(-1) });

            Assert.AreEqual(0, instances.Count);

            // And the same range said in another time zone is the same range
            var elsewhere = created.ToOffset(TimeSpan.FromHours(-7));
            instances = await this.ListInstancesAsync(new OrchestrationQuery { CreatedFrom = elsewhere, CreatedTo = elsewhere });

            Assert.AreEqual(row.PartitionKey, instances.Single().InstanceId);
        }

        [TestMethod]
        public async Task APageOfTheUnsortedListOfInstancesCostsTheRequestsUpToItAndNoMore()
        {
            var expected = (await this.EverythingAsync(null)).Where(id => !id.StartsWith('@')).ToArray();

            // Pages of forty, so that the table is many requests long
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = new SmallPages(this._tableClient, 40);
            this._tableClient.Reset();

            // The first hundred, the way a caller that does not sort takes them: it stops asking when it has them
            var instances = await this.ListInstancesAsync(new OrchestrationQuery(), readToEnd: false, take: 100);

            CollectionAssert.AreEqual(expected.Take(100).ToArray(), instances.Select(i => i.InstanceId).ToArray());

            // Three requests of forty, one after another, as one query from the first row on - and not the table
            Assert.AreEqual(3, this._tableClient.Pages);
            Assert.AreEqual(120, this._tableClient.RowsReturned);
            Assert.IsTrue(this._tableClient.PageFilters.All(filter => filter == $"({AzureStorageInstances.ExcludeEntitiesFilter})"), "an unsorted list was read as ranges");

            // Read to its end that way, it is still every orchestration of the table, in its order
            instances = await this.ListInstancesAsync(new OrchestrationQuery(), readToEnd: false);

            CollectionAssert.AreEqual(expected, instances.Select(i => i.InstanceId).ToArray());
        }

        [TestMethod]
        [DataRow(true)]
        [DataRow(false)]
        public async Task TheListOfAHubThatHasNoTableFailsOnItsFirstRequest(bool readToEnd)
        {
            // A Task Hub of another storage provider, as the default routine sees it. Failing here, before an
            // instance has been returned, is what lets GET /orchestrations hand the query to the client instead.
            var instances = AzureStorageInstances.List(null, ConnStringName, "DfmNoSuchHub" + Guid.NewGuid().ToString("N").Substring(0, 12), new OrchestrationQuery(), readToEnd);

            Assert.IsNotNull(instances);

            var failure = await Assert.ThrowsExactlyAsync<Azure.RequestFailedException>(async () =>
            {
                await foreach (var instance in instances)
                {
                }
            });

            Assert.AreEqual(404, failure.Status);
        }

        private async Task<List<OrchestrationMetadata>> ListInstancesAsync(OrchestrationQuery query, bool readToEnd = true, int take = int.MaxValue)
        {
            // The table is XXXInstances, and XXX is the Task Hub
            string hubName = _tableName.Substring(0, _tableName.Length - "Instances".Length);

            var instances = AzureStorageInstances.List(null, ConnStringName, hubName, query, readToEnd);

            Assert.IsNotNull(instances, "this query is the table's to answer");

            var result = new List<OrchestrationMetadata>();
            await foreach (var instance in instances)
            {
                result.Add(instance);

                if (result.Count >= take)
                {
                    break;
                }
            }

            return result;
        }

        // The scan, with the pages of the service made small: the same table then takes ranges to read
        private static Task<(IReadOnlyList<TableEntity> rows, bool truncated)> ScanInSmallPagesAsync(ITableClient tableClient, string filter, int maxRows)
        {
            return TableScan.QueryAsync(new SmallPages(tableClient, 40), _tableName, filter, Array.Empty<string>(), maxRows, CancellationToken.None);
        }

        /// <summary>The same tables, answering with pages of at most so many rows.</summary>
        private sealed class SmallPages : ITableClient
        {
            public SmallPages(ITableClient inner, int pageSize)
            {
                this._inner = inner;
                this._pageSize = pageSize;
            }

            public Task<TablePage> QueryPageAsync(string tableName, string filter, IEnumerable<string> select, int maxPerPage, string continuationToken, CancellationToken ct)
                => this._inner.QueryPageAsync(tableName, filter, select, Math.Min(maxPerPage, this._pageSize), continuationToken, ct);

            public Task<IEnumerable<string>> ListTableNamesAsync() => this._inner.ListTableNamesAsync();
            public IEnumerable<TableEntity> GetAll(string tableName, string filter) => this._inner.GetAll(tableName, filter);
            public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter) => this._inner.GetAllAsync(tableName, filter);
            public Task<IEnumerable<TableEntity>> GetAllAsync(string tableName, string filter, CancellationToken ct) => this._inner.GetAllAsync(tableName, filter, ct);
            public Task<(IReadOnlyList<TableEntity> rows, bool truncated)> QueryAsync(string tableName, string filter, IEnumerable<string> select, int maxRows, CancellationToken ct) => this._inner.QueryAsync(tableName, filter, select, maxRows, ct);
            public Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey) => this._inner.GetEntityAsync(tableName, partitionKey, rowKey);
            public Task<TableEntity> GetEntityAsync(string tableName, string partitionKey, string rowKey, IEnumerable<string> select) => this._inner.GetEntityAsync(tableName, partitionKey, rowKey, select);
            public Task ReplaceEntityAsync(string tableName, TableEntity entity) => this._inner.ReplaceEntityAsync(tableName, entity);
            public Task UpsertEntityAsync(string tableName, TableEntity entity) => this._inner.UpsertEntityAsync(tableName, entity);
            public Task DeleteEntitiesAsync(string tableName, IEnumerable<TableEntity> entities) => this._inner.DeleteEntitiesAsync(tableName, entities);

            private readonly ITableClient _inner;
            private readonly int _pageSize;
        }

        private static readonly DateTimeOffset BaseTime = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);

        private static string _tableName;
        private static TableServiceClient _service;
        private static List<TableEntity> _rows;

        private CountingTableClient _tableClient;
        private int _parallelismBefore;

        private const string ConnStringName = "DfmTestTableScanConnString";
    }
}
