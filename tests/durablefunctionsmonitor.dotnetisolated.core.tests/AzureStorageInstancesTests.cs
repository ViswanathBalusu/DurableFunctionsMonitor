// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Azure.Data.Tables;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.DurableTask.Client;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The instances of the Instances screen, read from the XXXInstances table instead of through the
    /// DurableTaskClient. It stands in for the client, so what it has to be held to is the client: the same
    /// instances for the same query, with the same values, in the same order - and a clear 'not mine' for the
    /// queries it cannot answer that way.
    ///
    /// (That it really is the same, against the client itself, was checked with a real host on real and seeded
    /// Task Hubs, query by query. What is pinned here is every rule that comparison rests on.)
    /// </summary>
    [TestClass]
    public class AzureStorageInstancesTests
    {
        private const string Table = "HubInstances";

        private static readonly DateTimeOffset T0 = new DateTimeOffset(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

        private InMemoryTableClient _tables;

        [TestInitialize]
        public void TestInit()
        {
            this._tables = new InMemoryTableClient();

            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = this._tables;
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, null);
        }

        [TestCleanup]
        public void TestCleanup()
        {
            DurableFunctionsMonitor.DotNetIsolated.TableClient.MockedTableClient = null;
            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, null);
        }

        private static TableEntity Row(string instanceId, string name = "MyOrchestrator", string status = "Completed", int createdMinute = 0, string customStatus = "null")
        {
            var row = new TableEntity(instanceId, string.Empty)
            {
                ["Name"] = name,
                ["RuntimeStatus"] = status,
                ["CreatedTime"] = T0.AddMinutes(createdMinute),
                ["LastUpdatedTime"] = T0.AddMinutes(createdMinute).AddSeconds(42.5),
                ["ExecutionId"] = "exec-1",
                ["ParentInstanceId"] = string.Empty,
                ["Input"] = "{\"an\":\"input\"}",
                ["Output"] = "\"an output\""
            };

            if (customStatus != null)
            {
                row["CustomStatus"] = customStatus;
            }

            return row;
        }

        private static OrchestrationQuery Query(DateTimeOffset? from = null, DateTimeOffset? to = null, params OrchestrationRuntimeStatus[] statuses)
        {
            return new OrchestrationQuery
            {
                CreatedFrom = from,
                CreatedTo = to,
                Statuses = statuses.Length == 0 ? null : statuses,
                FetchInputsAndOutputs = false,
                PageSize = 1000
            };
        }

        private static async Task<List<OrchestrationMetadata>> ListAsync(OrchestrationQuery query, bool readToEnd = true)
        {
            var instances = AzureStorageInstances.List(null, "SomeConnString", "Hub", query, readToEnd);

            Assert.IsNotNull(instances, "this query is the table's to answer");

            var result = new List<OrchestrationMetadata>();
            await foreach (var instance in instances)
            {
                result.Add(instance);
            }

            return result;
        }

        [TestMethod]
        public async Task ListsTheInstancesInKeyOrderWithWhatTheClientWouldSayOfThem()
        {
            this._tables.Add(Table,
                Row("b-instance", "Second", "Running", 5, "{\"progress\":50}"),
                Row("a-instance", "First", "Completed", 1),
                Row("c-instance", "Third", "Failed", 9, customStatus: null));

            var instances = await ListAsync(Query());

            CollectionAssert.AreEqual(new[] { "a-instance", "b-instance", "c-instance" }, instances.Select(i => i.InstanceId).ToArray());

            var second = instances[1];
            Assert.AreEqual("Second", second.Name);
            Assert.AreEqual(OrchestrationRuntimeStatus.Running, second.RuntimeStatus);
            Assert.AreEqual(T0.AddMinutes(5), second.CreatedAt);
            Assert.AreEqual(T0.AddMinutes(5).AddSeconds(42.5), second.LastUpdatedAt);
            Assert.AreEqual("{\"progress\":50}", second.SerializedCustomStatus);

            // Not asked for, not there
            Assert.IsNull(second.SerializedInput);
            Assert.IsNull(second.SerializedOutput);

            // The custom status as the table has it: the text 'null' where the engine wrote that, nothing where it wrote nothing
            Assert.AreEqual("null", instances[0].SerializedCustomStatus);
            Assert.IsNull(instances[2].SerializedCustomStatus);
        }

        [TestMethod]
        public async Task ReadsFiveColumnsOfARowAndNotItsPayloads()
        {
            this._tables.Add(Table, Row("a-instance"));

            await ListAsync(Query());

            var request = this._tables.Requests.Single();

            CollectionAssert.AreEquivalent(
                new[] { "Name", "RuntimeStatus", "CreatedTime", "LastUpdatedTime", "CustomStatus" },
                request.Select.ToArray());
        }

        [TestMethod]
        public async Task LeavesTheEntitiesOutAsTheClientDoes()
        {
            // Entities are rows of the same table, under ids that start with '@'. Its neighbours in the order of
            // the keys are on both sides of it here: '9' and ':' before it, 'A', '[' and 'a' after it.
            this._tables.Add(Table,
                Row("9-digits"),
                Row(":colon"),
                Row("@counter@one", name: "@counter"),
                Row("@counter@two", name: "@counter"),
                Row("@", name: "@"),
                Row("A-upper"),
                Row("[bracket"),
                Row("a-lower"));

            var instances = await ListAsync(Query());

            CollectionAssert.AreEqual(
                new[] { "9-digits", ":colon", "A-upper", "[bracket", "a-lower" },
                instances.Select(i => i.InstanceId).ToArray());
        }

        [TestMethod]
        public async Task TakesTheTimeRangeWithBothItsEnds()
        {
            this._tables.Add(Table,
                Row("a", createdMinute: 0),
                Row("b", createdMinute: 10),
                Row("c", createdMinute: 20),
                Row("d", createdMinute: 30),
                Row("e", createdMinute: 40));

            CollectionAssert.AreEqual(new[] { "b", "c", "d" }, Ids(await ListAsync(Query(T0.AddMinutes(10), T0.AddMinutes(30)))));
            CollectionAssert.AreEqual(new[] { "d", "e" }, Ids(await ListAsync(Query(from: T0.AddMinutes(30)))));
            CollectionAssert.AreEqual(new[] { "a", "b" }, Ids(await ListAsync(Query(to: T0.AddMinutes(10)))));

            // A range given in another time zone is the same moments
            var plusTwo = TimeSpan.FromHours(2);
            CollectionAssert.AreEqual(
                new[] { "b", "c", "d" },
                Ids(await ListAsync(Query(T0.AddMinutes(10).ToOffset(plusTwo), T0.AddMinutes(30).ToOffset(plusTwo)))));
        }

        [TestMethod]
        public async Task TakesTheStatusesThatWereAskedFor()
        {
            this._tables.Add(Table,
                Row("a", status: "Completed"),
                Row("b", status: "Failed"),
                Row("c", status: "Running"),
                Row("d", status: "Pending"),
                Row("e", status: "Terminated"),
                Row("f", status: "Suspended"),
                Row("g", status: "ContinuedAsNew"),
                Row("h", status: "Canceled"));

            CollectionAssert.AreEqual(new[] { "b" }, Ids(await ListAsync(Query(null, null, OrchestrationRuntimeStatus.Failed))));

            CollectionAssert.AreEqual(
                new[] { "c", "d", "f" },
                Ids(await ListAsync(Query(null, null, OrchestrationRuntimeStatus.Running, OrchestrationRuntimeStatus.Pending, OrchestrationRuntimeStatus.Suspended))));

            // Each of them is spelled in the table as the enum spells it
            foreach (var status in Enum.GetValues<OrchestrationRuntimeStatus>())
            {
                var instances = await ListAsync(Query(null, null, status));

                Assert.AreEqual(1, instances.Count, status.ToString());
                Assert.AreEqual(status, instances[0].RuntimeStatus);
            }
        }

        [TestMethod]
        public async Task CombinesTheRangeTheStatusesAndTheEntities()
        {
            this._tables.Add(Table,
                Row("a", status: "Failed", createdMinute: 5),
                Row("b", status: "Failed", createdMinute: 50),
                Row("c", status: "Completed", createdMinute: 5),
                Row("@entity@x", status: "Failed", createdMinute: 5),
                Row("d", status: "Running", createdMinute: 6));

            var instances = await ListAsync(Query(T0, T0.AddMinutes(10), OrchestrationRuntimeStatus.Failed, OrchestrationRuntimeStatus.Running));

            CollectionAssert.AreEqual(new[] { "a", "d" }, Ids(instances));
        }

        [TestMethod]
        public void BuildsTheConditionsTheEngineBuilds()
        {
            Assert.AreEqual(
                "(PartitionKey lt '@' or PartitionKey ge 'A')",
                AzureStorageInstances.BuildFilter(Query()));

            // The engine's conditions, in the engine's order. (It writes a moment with all seven digits of its
            // seconds and the tables SDK leaves the zeros at the end out: the same moment either way.)
            Assert.AreEqual(
                "(CreatedTime ge datetime'2026-11-14T10:00:00Z') and (CreatedTime le datetime'2026-11-14T11:30:00Z') and (RuntimeStatus eq 'Failed' or RuntimeStatus eq 'Running') and (PartitionKey lt '@' or PartitionKey ge 'A')",
                AzureStorageInstances.BuildFilter(Query(T0, T0.AddMinutes(90), OrchestrationRuntimeStatus.Failed, OrchestrationRuntimeStatus.Running)));

            // Nothing of a moment is rounded away: the screen asks in milliseconds, the table answers in ticks
            Assert.AreEqual(
                "(CreatedTime ge datetime'2026-11-14T10:00:00.1234567Z') and (CreatedTime le datetime'2026-11-14T10:00:00.999Z') and (PartitionKey lt '@' or PartitionKey ge 'A')",
                AzureStorageInstances.BuildFilter(Query(T0.AddTicks(1234567), T0.AddMilliseconds(999))));

            // A time in another zone is said in UTC
            Assert.AreEqual(
                "(CreatedTime ge datetime'2026-11-14T10:00:00Z') and (PartitionKey lt '@' or PartitionKey ge 'A')",
                AzureStorageInstances.BuildFilter(Query(from: T0.ToOffset(TimeSpan.FromHours(5.5)))));
        }

        [TestMethod]
        public async Task ReadsALargeTableAsRangesAndStillInKeyOrder()
        {
            // More than one request returns: the rest is read as PartitionKey ranges, side by side
            var ids = HexIds(5000, 20261114);

            ids.AddRange(Enumerable.Range(0, 200).Select(i => $"@counter@{i}"));

            this._tables.Add(Table, ids.Select((id, i) => Row(id, createdMinute: i % 60)).ToArray());
            this._tables.ServerPageLimit = 200;

            var instances = await ListAsync(Query());

            var expected = ids.Where(id => !id.StartsWith('@')).OrderBy(id => id, StringComparer.Ordinal).ToArray();

            CollectionAssert.AreEqual(expected, Ids(instances));
            Assert.IsTrue(this._tables.Requests.Any(r => r.Filter.StartsWith("(PartitionKey ge 'a' and PartitionKey lt 'b') and (")), "the table was not read as ranges");
        }

        [TestMethod]
        public void LeavesToTheClientWhatItCannotAnswerAsTheClientWould()
        {
            // Inputs and outputs: the host fetches the ones that live in a blob, and the table only has the link
            foreach (bool readToEnd in new[] { true, false })
            {
                Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query() with { FetchInputsAndOutputs = true }, readToEnd));

                // The ids that start with something: another question, with entities in its answer
                Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query() with { InstanceIdPrefix = "abc" }, readToEnd));

                // A page somewhere in the middle of the client's own paging
                Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query() with { ContinuationToken = "token" }, readToEnd));

                // Other Task Hubs than the one of the table
                Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query() with { TaskHubNames = new[] { "AnotherHub" } }, readToEnd));

                Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", null, readToEnd));
            }

            // Nothing was read to find that out
            Assert.AreEqual(0, this._tables.Requests.Count);
        }

        [TestMethod]
        public void CanBeSwitchedOff()
        {
            Assert.IsNotNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), true));
            Assert.IsNotNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), false));

            Environment.SetEnvironmentVariable(EnvVariableNames.AzureWebJobsFeatureFlags, $"EnableWorkerIndexing,{Globals.DfMonDisableInstancesTableScan}");

            Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), true));
            Assert.IsNull(AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), false));
        }

        [TestMethod]
        public void ReadsNothingBeforeItIsAskedForAnInstance()
        {
            this._tables.Add(Table, Row("a-instance"));

            // A list nobody enumerates costs nothing: the caller may still decide not to
            var whole = AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), true);
            var page = AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), false);

            Assert.IsNotNull(whole);
            Assert.IsNotNull(page);
            Assert.AreEqual(0, this._tables.Requests.Count);
        }

        [TestMethod]
        public async Task APageOfAnUnsortedListCostsWhatItTakesAndNoMore()
        {
            this._tables.Add(Table, HexIds(3500, 7).Select((id, i) => Row(id, createdMinute: i % 60)).ToArray());
            this._tables.Add(Table, Row("@counter@one", name: "@counter"));

            var expected = this._tables.AllRows(Table).Select(row => row.PartitionKey).Where(id => !id.StartsWith('@')).ToArray();

            // The first fifty, as the Histogram view or a caller of the API asks for them
            var firstFifty = new List<string>();

            await foreach (var instance in AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), false))
            {
                firstFifty.Add(instance.InstanceId);

                if (firstFifty.Count == 50)
                {
                    break;
                }
            }

            CollectionAssert.AreEqual(expected.Take(50).ToArray(), firstFifty);

            // One request, which is what it cost through the client: not a scan of the table
            Assert.AreEqual(1, this._tables.Requests.Count);

            // A page further in costs the requests up to it, one after another, and nothing side by side
            this._tables.ClearRequests();

            var firstTwoThousandFive = new List<string>();

            await foreach (var instance in AzureStorageInstances.List(null, "SomeConnString", "Hub", Query(), false))
            {
                firstTwoThousandFive.Add(instance.InstanceId);

                if (firstTwoThousandFive.Count == 2005)
                {
                    break;
                }
            }

            CollectionAssert.AreEqual(expected.Take(2005).ToArray(), firstTwoThousandFive);

            Assert.AreEqual(3, this._tables.Requests.Count);
            Assert.IsTrue(this._tables.Requests.All(r => r.Filter == "(PartitionKey lt '@' or PartitionKey ge 'A')"), "an unsorted list was read as ranges");
        }

        [TestMethod]
        public async Task IsTheSameListWhicheverWayItIsRead()
        {
            this._tables.Add(Table, HexIds(4200, 8).Select((id, i) => Row(id, status: i % 5 == 0 ? "Failed" : "Completed", createdMinute: i % 90)).ToArray());
            this._tables.Add(Table, Enumerable.Range(0, 30).Select(i => Row($"@counter@{i}", name: "@counter")).ToArray());
            this._tables.ServerPageLimit = 300;

            foreach (var query in new[] { Query(), Query(T0.AddMinutes(10), T0.AddMinutes(70), OrchestrationRuntimeStatus.Failed) })
            {
                var whole = await ListAsync(query, readToEnd: true);
                var pageByPage = await ListAsync(query, readToEnd: false);

                Assert.IsTrue(whole.Count > 300, "more than one request returns");

                CollectionAssert.AreEqual(Describe(whole), Describe(pageByPage));
            }
        }

        [TestMethod]
        public async Task IsTheSameListFromAServiceThatAnswersAMissingColumnWithANull()
        {
            // Rows that lack some of the five columns: no custom status, no last-updated time, nothing but a key.
            // Table Storage puts a null where a row has no such column; the emulator leaves the column out.
            this._tables.Add(Table,
                Row("a-instance", customStatus: null),
                Row("b-instance", status: "Running", customStatus: "{\"progress\":50}"),
                new TableEntity("c-bare-instance", string.Empty),
                new TableEntity("d-half-instance", string.Empty) { ["Name"] = "Half", ["CreatedTime"] = T0 });

            var asTheEmulatorAnswers = Describe(await ListAsync(Query()));

            this._tables.MissingColumnsComeBackAsNulls = true;

            var asTheServiceAnswers = Describe(await ListAsync(Query()));

            Assert.AreEqual(4, asTheServiceAnswers.Length);
            CollectionAssert.AreEqual(asTheEmulatorAnswers, asTheServiceAnswers);
        }

        [TestMethod]
        public async Task NoFilterItSendsHasMoreComparisonsThanTableStorageTakes()
        {
            // Table Storage refuses a $filter with more than 15 comparisons, and no emulator does. The longest
            // one this can send: both ends of a time range, every status there is, the entities left out -
            // and, around all of that, the PartitionKey range it is read in.
            this._tables.Add(Table, HexIds(3000, 9).Select((id, i) => Row(id, status: i % 2 == 0 ? "Completed" : "Failed", createdMinute: i % 50)).ToArray());
            this._tables.ServerPageLimit = 100;

            var everyStatus = Enum.GetValues<OrchestrationRuntimeStatus>();

            foreach (bool readToEnd in new[] { true, false })
            {
                this._tables.ClearRequests();

                var instances = await ListAsync(Query(T0, T0.AddMinutes(60), everyStatus), readToEnd);

                Assert.AreEqual(3000, instances.Count);

                int most = this._tables.Requests.Max(r => InMemoryTableClient.CountComparisons(r.Filter));

                Assert.IsTrue(most <= InMemoryTableClient.MaxComparisonsInAFilter, $"{most} comparisons in one filter");

                // And the count is of what was really sent: the ranges, when it was read as ranges
                Assert.AreEqual(readToEnd ? 14 : 12, most);
            }
        }

        [TestMethod]
        [DataRow("PartitionKey eq 'a'", 1)]
        [DataRow("(CreatedTime ge datetime'2026-11-14T10:00:00Z') and (RuntimeStatus eq 'Failed' or RuntimeStatus eq 'Running')", 3)]
        [DataRow("PartitionKey eq 'it''s eq to nothing' and RowKey gt ''", 2)]
        [DataRow("PartitionKey eq ' ge ' and Name ne ' lt le '", 2)]
        [DataRow("", 0)]
        [DataRow(null, 0)]
        public void ComparisonsAreCountedOutsideTheValues(string filter, int expected)
        {
            // The counter the two tests of the limit rest on
            Assert.AreEqual(expected, InMemoryTableClient.CountComparisons(filter));
        }

        // Ids as the engine makes them up for an instance (32 hex digits), the same ones on every run
        private static List<string> HexIds(int count, int seed)
        {
            var random = new Random(seed);

            return Enumerable.Range(0, count).Select(i =>
            {
                var bytes = new byte[16];
                random.NextBytes(bytes);

                return Convert.ToHexString(bytes).ToLowerInvariant();
            })
            .ToList();
        }

        private static string[] Describe(IEnumerable<OrchestrationMetadata> instances)
        {
            return instances
                .Select(i => $"{i.InstanceId}|{i.Name}|{i.RuntimeStatus}|{i.CreatedAt:O}|{i.LastUpdatedAt:O}|{i.SerializedCustomStatus}")
                .ToArray();
        }

        [TestMethod]
        public void MakesOfAnOddRowWhatTheClientMakesOfIt()
        {
            // A status the enum does not know is -1 all the way through the engine, the host and the client
            var unknownStatus = AzureStorageInstances.ToMetadata(Row("a", status: "SomethingNew"));
            Assert.AreEqual((OrchestrationRuntimeStatus)(-1), unknownStatus.RuntimeStatus);

            // A row with nothing but its key
            var bare = AzureStorageInstances.ToMetadata(new TableEntity("bare-instance", string.Empty));

            Assert.AreEqual("bare-instance", bare.InstanceId);
            Assert.AreEqual(string.Empty, bare.Name);
            Assert.AreEqual((OrchestrationRuntimeStatus)(-1), bare.RuntimeStatus);
            Assert.AreEqual(default, bare.CreatedAt);
            Assert.AreEqual(default, bare.LastUpdatedAt);
            Assert.IsNull(bare.SerializedCustomStatus);

            // And it is the list that the rest of the pipeline is fed with, so it has to make a status of it
            var status = new DurableOrchestrationStatus(bare);
            Assert.AreEqual("bare-instance", status.InstanceId);
        }

        [TestMethod]
        [DataRow("plain-instance-id", "plain-instance-id")]
        [DataRow("", "")]
        [DataRow(null, null)]
        [DataRow("orders^0eu^02026", "orders/eu/2026")]
        [DataRow("a^1b", "a\\b")]
        [DataRow("issue^2" + "42", "issue#42")]
        [DataRow("really^3", "really?")]
        [DataRow("caret^^caret", "caret^caret")]
        [DataRow("^^0", "^0")]
        [DataRow("^0^1^2^3^^", "/\\#?^")]
        // A control character is moved up by 0xC0 to become a character a key may hold: tab (9) is 0xC9
        [DataRow("tab^Éseparated", "tab\tseparated")]
        [DataRow("line^Êbreak", "line\nbreak")]
        // An escape character at the very end is not one the engine wrote
        [DataRow("trailing^", "trailing^")]
        public void TurnsAPartitionKeyBackIntoTheInstanceId(string partitionKey, string instanceId)
        {
            Assert.AreEqual(instanceId, AzureStorageInstances.UnescapePartitionKey(partitionKey));
        }

        [TestMethod]
        public async Task ListsAnInstanceUnderItsIdAndNotUnderItsKey()
        {
            // 'orders/eu/1' cannot be a key, so the engine stores it as 'orders^0eu^01'
            this._tables.Add(Table, Row("orders^0eu^01"));

            var instances = await ListAsync(Query());

            Assert.AreEqual("orders/eu/1", instances.Single().InstanceId);
        }

        private static string[] Ids(IEnumerable<OrchestrationMetadata> instances)
        {
            return instances.Select(i => i.InstanceId).ToArray();
        }
    }
}
