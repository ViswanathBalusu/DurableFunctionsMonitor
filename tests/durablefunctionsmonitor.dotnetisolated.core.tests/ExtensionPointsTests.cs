// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Microsoft.VisualStudio.TestTools.UnitTesting;
using DurableFunctionsMonitor.DotNetIsolated;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    [TestClass]
    public class ExtensionPointsTests
    {
        /// Serializes exactly like HttpRequestData.ReturnJson() does, then re-reads the payload the way the
        /// UI sees it: as plain JSON, without Newtonsoft's automatic string-to-DateTime conversion.
        private static JObject SerializeAsDfMonWould(object obj)
        {
            string json = JsonConvert.SerializeObject(obj, Globals.SerializerSettings);

            using (var reader = new JsonTextReader(new System.IO.StringReader(json)) { DateParseHandling = DateParseHandling.None })
            {
                return JObject.Load(reader);
            }
        }

        [TestMethod]
        public void ProviderNameDefaultsToAzureStorage()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert
            Assert.AreEqual("AzureStorage", extensionPoints.ProviderName);
        }

        [TestMethod]
        public void AggregationRoutinesAreNullByDefault()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert
            Assert.IsNull(extensionPoints.GetFailuresRoutine);
            Assert.IsNull(extensionPoints.WriteAuditRecordRoutine);
            Assert.IsNull(extensionPoints.ReadAuditRecordsRoutine);
        }

        [TestMethod]
        public void SpansRoutinesHaveTheirAzureStorageDefaults()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert (B2 gave these two their Azure Storage default; the ones still asserted null above
            // are waiting for B3, B4 and B5)
            Assert.IsNotNull(extensionPoints.GetEpisodeMarkersRoutine);
            Assert.IsNotNull(extensionPoints.GetInstanceRowInfoRoutine);
        }

        [TestMethod]
        public void ChildrenRoutineHasItsAzureStorageDefault()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert (B1-S3-T1 wired AzureStorageAggregations.GetChildrenAsync as the default, so
            // /about reports capabilities.children == true for Azure Storage)
            Assert.IsNotNull(extensionPoints.GetChildrenRoutine);
        }

        [TestMethod]
        public void StorageHealthRoutineHasItsAzureStorageDefault()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert (B4-S1-T2 wired StorageHealth.GetAsync as the default, so /about reports
            // capabilities.storageHealth == true for Azure Storage)
            Assert.IsNotNull(extensionPoints.GetStorageHealthRoutine);
        }

        [TestMethod]
        public void StatsRoutineHasItsAzureStorageDefault()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert (B1-S2-T2 wired AzureStorageAggregations.GetStatsAsync as the default, so /about
            // reports capabilities.stats == true for Azure Storage)
            Assert.IsNotNull(extensionPoints.GetStatsRoutine);
        }

        [TestMethod]
        public void PreExistingRoutinesStillHaveTheirAzureStorageDefaults()
        {
            // Act
            var extensionPoints = new DfmExtensionPoints();

            // Assert
            Assert.IsNotNull(extensionPoints.GetInstanceHistoryRoutine);
            Assert.IsNotNull(extensionPoints.GetParentInstanceIdRoutine);
            Assert.IsNotNull(extensionPoints.GetTaskHubNamesRoutine);
            Assert.IsNotNull(extensionPoints.GetHistoryEventInputRoutine);
            Assert.IsNotNull(extensionPoints.UpdateHistoryEventInputRoutine);
            Assert.IsNotNull(extensionPoints.TruncateHistoryRoutine);
        }

        [TestMethod]
        public void EveryRoutineCanBeReplacedAndNulledOut()
        {
            // Arrange
            var extensionPoints = new DfmExtensionPoints();

            // Act
            extensionPoints.ProviderName = "MsSql";
            extensionPoints.GetStatsRoutine = (client, connName, hubName, query, ct) => Task.FromResult(new StatsResult());
            extensionPoints.GetFailuresRoutine = (client, connName, hubName, query, ct) => Task.FromResult(new FailuresResult());
            extensionPoints.GetChildrenRoutine = (client, connName, hubName, instanceId) => Task.FromResult(new ChildrenResult());
            extensionPoints.GetEpisodeMarkersRoutine = (client, connName, hubName, instanceId) =>
                Task.FromResult((IReadOnlyList<EpisodeMarker>)new List<EpisodeMarker>());
            extensionPoints.GetInstanceRowInfoRoutine = (client, connName, hubName, instanceId) => Task.FromResult(new InstanceRowInfo());
            extensionPoints.GetStorageHealthRoutine = (connName, hubName, counts, instanceId, ct) => Task.FromResult(new StorageHealthResult());
            extensionPoints.WriteAuditRecordRoutine = (connName, hubName, record) => Task.CompletedTask;
            extensionPoints.ReadAuditRecordsRoutine = (connName, hubName, query) => Task.FromResult(new AuditPage());

            // Assert
            Assert.AreEqual("MsSql", extensionPoints.ProviderName);
            Assert.IsNotNull(extensionPoints.GetStatsRoutine);
            Assert.IsNotNull(extensionPoints.GetFailuresRoutine);
            Assert.IsNotNull(extensionPoints.GetChildrenRoutine);
            Assert.IsNotNull(extensionPoints.GetEpisodeMarkersRoutine);
            Assert.IsNotNull(extensionPoints.GetInstanceRowInfoRoutine);
            Assert.IsNotNull(extensionPoints.GetStorageHealthRoutine);
            Assert.IsNotNull(extensionPoints.WriteAuditRecordRoutine);
            Assert.IsNotNull(extensionPoints.ReadAuditRecordsRoutine);

            // Act
            extensionPoints.GetStatsRoutine = null;
            extensionPoints.GetFailuresRoutine = null;
            extensionPoints.GetChildrenRoutine = null;
            extensionPoints.GetEpisodeMarkersRoutine = null;
            extensionPoints.GetInstanceRowInfoRoutine = null;
            extensionPoints.GetStorageHealthRoutine = null;
            extensionPoints.WriteAuditRecordRoutine = null;
            extensionPoints.ReadAuditRecordsRoutine = null;

            // Assert
            Assert.IsNull(extensionPoints.GetStatsRoutine);
            Assert.IsNull(extensionPoints.GetFailuresRoutine);
            Assert.IsNull(extensionPoints.GetChildrenRoutine);
            Assert.IsNull(extensionPoints.GetEpisodeMarkersRoutine);
            Assert.IsNull(extensionPoints.GetInstanceRowInfoRoutine);
            Assert.IsNull(extensionPoints.GetStorageHealthRoutine);
            Assert.IsNull(extensionPoints.WriteAuditRecordRoutine);
            Assert.IsNull(extensionPoints.ReadAuditRecordsRoutine);
        }

        [TestMethod]
        public void StatsResultSerializesToTheContractShape()
        {
            // Arrange
            var result = new StatsResult
            {
                From = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero),
                To = new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero),
                BinCount = 1,
                Totals = new StatusCounts { { "Completed", 3 }, { "Failed", 1 }, { "all", 4 }, { "entities", 2 } },
                Bins = new List<StatsBin>
                {
                    new StatsBin
                    {
                        Start = new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero),
                        End = new DateTimeOffset(2026, 9, 2, 0, 0, 0, TimeSpan.Zero),
                        Counts = new StatusCounts { { "Completed", 3 } }
                    }
                },
                ByName = new List<StatsByName>
                {
                    new StatsByName { Name = "OrderFlow", Started = 4, Completed = 3, Failed = 1, Running = 0, FailureRate = 0.25, P50Ms = 100, P95Ms = null, LastFailedAt = null }
                },
                EntitiesByName = new List<EntityNameCount> { new EntityNameCount { Name = "Counter", Count = 2 } },
                Stuck = new StuckSummary { Count = 1, OldestLastUpdatedAt = null, SampleIds = new List<string> { "abc" } },
                OldestPending = new PendingSummary { Count = 0, OldestCreatedAt = null, SampleIds = new List<string>() },
                Suspended = new StuckSummary(),
                Scanned = 4,
                Partial = false,
                Cap = 50000,
                ElapsedMs = 12,
                GeneratedAt = new DateTimeOffset(2026, 9, 2, 3, 4, 5, TimeSpan.Zero),
                Cached = false
            };

            // Act
            var json = SerializeAsDfMonWould(result);

            // Assert
            Assert.AreEqual("2026-09-01T00:00:00Z", json["from"].Value<string>());
            Assert.AreEqual(1, json["binCount"].Value<int>());

            // Dictionary keys keep their PascalCase RuntimeStatus spelling, the extra keys stay lowercase
            Assert.AreEqual(3, json["totals"]["Completed"].Value<int>());
            Assert.AreEqual(1, json["totals"]["Failed"].Value<int>());
            Assert.AreEqual(4, json["totals"]["all"].Value<int>());
            Assert.AreEqual(2, json["totals"]["entities"].Value<int>());
            Assert.AreEqual(3, json["bins"][0]["counts"]["Completed"].Value<int>());

            Assert.AreEqual("OrderFlow", json["byName"][0]["name"].Value<string>());
            Assert.AreEqual(0.25, json["byName"][0]["failureRate"].Value<double>());
            Assert.AreEqual(100, json["byName"][0]["p50Ms"].Value<int>());
            Assert.AreEqual(JTokenType.Null, json["byName"][0]["p95Ms"].Type);
            Assert.AreEqual(JTokenType.Null, json["byName"][0]["lastFailedAt"].Type);

            Assert.AreEqual("Counter", json["entitiesByName"][0]["name"].Value<string>());
            Assert.AreEqual("abc", json["stuck"]["sampleIds"][0].Value<string>());
            Assert.AreEqual(JTokenType.Null, json["stuck"]["oldestLastUpdatedAt"].Type);
            Assert.AreEqual(JTokenType.Null, json["oldestPending"]["oldestCreatedAt"].Type);
            Assert.AreEqual(0, json["suspended"]["count"].Value<int>());

            Assert.AreEqual(4, json["scanned"].Value<int>());
            Assert.IsFalse(json["partial"].Value<bool>());
            Assert.AreEqual(50000, json["cap"].Value<int>());
            Assert.AreEqual(12, json["elapsedMs"].Value<int>());
            Assert.AreEqual("2026-09-02T03:04:05Z", json["generatedAt"].Value<string>());
            Assert.IsFalse(json["cached"].Value<bool>());

            // No stray fields: the query's CacheKey helper never leaks into a response
            Assert.IsNull(json["cacheKey"]);
        }

        [TestMethod]
        public void ChildrenAndSpansSupportModelsSerializeToTheContractShape()
        {
            // Arrange
            var children = new ChildrenResult
            {
                Children = new List<ChildInstance>
                {
                    new ChildInstance
                    {
                        InstanceId = "exec-1:0",
                        Name = "ChargePayment",
                        RuntimeStatus = "Running",
                        CreatedTime = new DateTimeOffset(2026, 9, 1, 10, 0, 0, TimeSpan.Zero),
                        LastUpdatedTime = new DateTimeOffset(2026, 9, 1, 10, 0, 5, TimeSpan.Zero)
                    }
                },
                Complete = false
            };

            var marker = new EpisodeMarker { Start = new DateTimeOffset(2026, 9, 1, 10, 0, 0, TimeSpan.Zero), End = null };
            var rowInfo = new InstanceRowInfo { ExecutionId = "exec-1", Generation = null, HistoryBytesEstimate = null };

            // Act
            var childrenJson = SerializeAsDfMonWould(children);
            var markerJson = SerializeAsDfMonWould(marker);
            var rowInfoJson = SerializeAsDfMonWould(rowInfo);

            // Assert
            Assert.AreEqual("exec-1:0", childrenJson["children"][0]["instanceId"].Value<string>());
            Assert.AreEqual("Running", childrenJson["children"][0]["runtimeStatus"].Value<string>());
            Assert.AreEqual("2026-09-01T10:00:00Z", childrenJson["children"][0]["createdTime"].Value<string>());
            Assert.AreEqual("2026-09-01T10:00:05Z", childrenJson["children"][0]["lastUpdatedTime"].Value<string>());
            Assert.IsFalse(childrenJson["complete"].Value<bool>());

            Assert.AreEqual("2026-09-01T10:00:00Z", markerJson["start"].Value<string>());
            Assert.AreEqual(JTokenType.Null, markerJson["end"].Type);

            Assert.AreEqual("exec-1", rowInfoJson["executionId"].Value<string>());
            Assert.AreEqual(JTokenType.Null, rowInfoJson["generation"].Type);
            Assert.AreEqual(JTokenType.Null, rowInfoJson["historyBytesEstimate"].Type);
        }

        [TestMethod]
        public void FailuresResultSerializesToTheContractShape()
        {
            // Arrange
            var result = new FailuresResult
            {
                Groups = new List<FailureGroup>
                {
                    new FailureGroup
                    {
                        Key = "OrderFlow|InventoryUnavailable: SKU-*",
                        Name = "OrderFlow",
                        Signature = "InventoryUnavailable: SKU-*",
                        Count = 2,
                        LastSeenAt = new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero),
                        SampleIds = new List<string> { "a", "b" },
                        Instances = new List<FailureInstance>
                        {
                            new FailureInstance
                            {
                                InstanceId = "a",
                                CreatedTime = new DateTimeOffset(2026, 9, 1, 11, 0, 0, TimeSpan.Zero),
                                CompletedTime = null,
                                DurationMs = null,
                                Reason = "InventoryUnavailable: SKU-4471"
                            }
                        }
                    }
                },
                TotalFailed = 2,
                Scanned = 10,
                Partial = true,
                Cap = 10,
                ElapsedMs = 7,
                GeneratedAt = new DateTimeOffset(2026, 9, 1, 12, 0, 1, TimeSpan.Zero),
                Cached = true
            };

            // Act
            var json = SerializeAsDfMonWould(result);

            // Assert
            Assert.AreEqual("OrderFlow|InventoryUnavailable: SKU-*", json["groups"][0]["key"].Value<string>());
            Assert.AreEqual("InventoryUnavailable: SKU-*", json["groups"][0]["signature"].Value<string>());
            Assert.AreEqual(2, json["groups"][0]["count"].Value<int>());
            Assert.AreEqual("2026-09-01T12:00:00Z", json["groups"][0]["lastSeenAt"].Value<string>());
            Assert.AreEqual("b", json["groups"][0]["sampleIds"][1].Value<string>());
            Assert.AreEqual("a", json["groups"][0]["instances"][0]["instanceId"].Value<string>());
            Assert.AreEqual(JTokenType.Null, json["groups"][0]["instances"][0]["completedTime"].Type);
            Assert.AreEqual(JTokenType.Null, json["groups"][0]["instances"][0]["durationMs"].Type);
            Assert.AreEqual("InventoryUnavailable: SKU-4471", json["groups"][0]["instances"][0]["reason"].Value<string>());
            Assert.AreEqual(2, json["totalFailed"].Value<int>());
            Assert.AreEqual(10, json["scanned"].Value<int>());
            Assert.IsTrue(json["partial"].Value<bool>());
            Assert.AreEqual(10, json["cap"].Value<int>());
            Assert.AreEqual(7, json["elapsedMs"].Value<int>());
            Assert.IsTrue(json["cached"].Value<bool>());
        }

        [TestMethod]
        public void StorageHealthResultSerializesToTheContractShape()
        {
            // Arrange
            var result = new StorageHealthResult
            {
                Provider = "AzureStorage",
                AccountName = "devstoreaccount1",
                TaskHub = new StorageTaskHubInfo { Name = "TestHub", PartitionCount = 4, CreatedAt = null, Source = "taskhub.json" },
                Queues = new List<StorageQueueInfo>
                {
                    new StorageQueueInfo { Name = "testhub-workitems", Kind = "workitems", Partition = null, ApproximateMessageCount = 0 },
                    new StorageQueueInfo { Name = "testhub-control-00", Kind = "control", Partition = 0, ApproximateMessageCount = null }
                },
                Partitions = new List<StoragePartitionInfo>
                {
                    new StoragePartitionInfo { Name = "testhub-control-00", Owner = null, OwnedSince = null, IsDraining = null, NextOwner = null, Source = "none" }
                },
                Tables = new StorageTablesInfo { Instances = "TestHubInstances", History = "TestHubHistory", Partitions = null, Audit = null },
                LargeMessages = new StorageLargeMessagesInfo { Container = "testhub-largemessages", Exists = true, BlobCount = null, TotalBytes = null },
                Counts = new StorageCountsInfo { InstancesRows = null, HistoryRows = null, Partial = false },
                GeneratedAt = new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero),
                ElapsedMs = 3,
                Cached = false
            };

            // Act
            var json = SerializeAsDfMonWould(result);

            // Assert
            Assert.AreEqual("AzureStorage", json["provider"].Value<string>());
            Assert.AreEqual("devstoreaccount1", json["accountName"].Value<string>());
            Assert.AreEqual(4, json["taskHub"]["partitionCount"].Value<int>());
            Assert.AreEqual(JTokenType.Null, json["taskHub"]["createdAt"].Type);
            Assert.AreEqual("taskhub.json", json["taskHub"]["source"].Value<string>());
            Assert.AreEqual("workitems", json["queues"][0]["kind"].Value<string>());
            Assert.AreEqual(JTokenType.Null, json["queues"][0]["partition"].Type);
            Assert.AreEqual(0, json["queues"][1]["partition"].Value<int>());
            Assert.AreEqual(JTokenType.Null, json["queues"][1]["approximateMessageCount"].Type);
            Assert.AreEqual("none", json["partitions"][0]["source"].Value<string>());
            Assert.AreEqual(JTokenType.Null, json["partitions"][0]["isDraining"].Type);
            Assert.AreEqual("TestHubInstances", json["tables"]["instances"].Value<string>());
            Assert.AreEqual(JTokenType.Null, json["tables"]["audit"].Type);
            Assert.IsTrue(json["largeMessages"]["exists"].Value<bool>());
            Assert.AreEqual(JTokenType.Null, json["largeMessages"]["totalBytes"].Type);
            Assert.AreEqual(JTokenType.Null, json["counts"]["instancesRows"].Type);
            Assert.IsFalse(json["counts"]["partial"].Value<bool>());
            Assert.AreEqual(3, json["elapsedMs"].Value<int>());
        }

        [TestMethod]
        public void AuditModelsSerializeToTheContractShape()
        {
            // Arrange
            var page = new AuditPage
            {
                Rows = new List<AuditRecord>
                {
                    new AuditRecord
                    {
                        At = new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero),
                        User = "anonymous",
                        Operation = "Terminate",
                        Kind = "Write",
                        InstanceId = "abc",
                        Outcome = "ok",
                        Status = 202,
                        Message = null,
                        Route = "/a/p/i/-TestHub/orchestrations('abc')/terminate"
                    }
                },
                HasMore = true
            };

            // Act
            var json = SerializeAsDfMonWould(page);

            // Assert
            Assert.AreEqual("2026-09-01T12:00:00Z", json["rows"][0]["at"].Value<string>());
            Assert.AreEqual("anonymous", json["rows"][0]["user"].Value<string>());
            Assert.AreEqual("Terminate", json["rows"][0]["operation"].Value<string>());
            Assert.AreEqual("Write", json["rows"][0]["kind"].Value<string>());
            Assert.AreEqual("abc", json["rows"][0]["instanceId"].Value<string>());
            Assert.AreEqual("ok", json["rows"][0]["outcome"].Value<string>());
            Assert.AreEqual(202, json["rows"][0]["status"].Value<int>());
            Assert.AreEqual(JTokenType.Null, json["rows"][0]["message"].Type);
            Assert.IsTrue(json["hasMore"].Value<bool>());
        }

        [TestMethod]
        public void QueryCacheKeysAreStableAndRoundedDownToTheMinute()
        {
            // Arrange
            var statsQuery = new StatsQuery
            {
                From = new DateTimeOffset(2026, 9, 1, 10, 30, 12, TimeSpan.Zero),
                To = new DateTimeOffset(2026, 9, 1, 11, 30, 59, TimeSpan.Zero),
                Cap = 50000
            };
            var sameMinuteQuery = new StatsQuery
            {
                From = new DateTimeOffset(2026, 9, 1, 10, 30, 44, TimeSpan.Zero),
                To = new DateTimeOffset(2026, 9, 1, 11, 30, 1, TimeSpan.Zero),
                Cap = 50000
            };
            var otherQuery = new StatsQuery
            {
                From = new DateTimeOffset(2026, 9, 1, 10, 31, 0, TimeSpan.Zero),
                To = new DateTimeOffset(2026, 9, 1, 11, 30, 59, TimeSpan.Zero),
                Cap = 50000
            };

            // Act & Assert
            Assert.AreEqual(statsQuery.CacheKey, sameMinuteQuery.CacheKey);
            Assert.AreNotEqual(statsQuery.CacheKey, otherQuery.CacheKey);

            // Defaults of the optional parameters, as the contract states them
            Assert.AreEqual(48, statsQuery.Bins);
            Assert.AreEqual(60, statsQuery.StuckAfterMinutes);
            Assert.AreEqual(10, statsQuery.PendingAfterMinutes);
            Assert.AreEqual(100, new AuditQuery().Top);

            var failuresQuery = new FailuresQuery { From = statsQuery.From, To = statsQuery.To, Cap = 50000 };
            Assert.AreEqual(failuresQuery.CacheKey, new FailuresQuery { From = sameMinuteQuery.From, To = sameMinuteQuery.To, Cap = 50000 }.CacheKey);
        }
    }
}
