// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System;
using System.Collections.Generic;
using System.Linq;
using DurableFunctionsMonitor.DotNetIsolated;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace durablefunctionsmonitor.dotnetisolated.core.tests
{
    /// <summary>
    /// The pure grouping behind /failures: which rows end up in one group, how the groups and the instances
    /// inside them are ordered, and what each row reports.
    ///
    /// The normalisation rules that decide when two messages are 'the same' are specified by
    /// FailureSignatureTests; the storage half by the Azurite FailuresTests.
    /// </summary>
    [TestClass]
    public class FailuresAggregatorTests
    {
        [TestMethod]
        public void GroupsRowsThatShareAnOrchestratorAndASignature()
        {
            // Arrange: the same failure with a different SKU and warehouse each time

            var rows = new[]
            {
                Row("order-1", "ProcessOrderOrchestrator", Error("InventoryUnavailable: SKU-4471 has 0 units in warehouse-07")),
                Row("order-2", "ProcessOrderOrchestrator", Error("InventoryUnavailable: SKU-1200 has 0 units in warehouse-03")),
                Row("order-3", "ProcessOrderOrchestrator", Error("Timeout: ChargePayment did not complete within 20 s")),
                Row("ledger-1", "ReconcileLedgerOrchestrator", Error("Ledger checksum mismatch for account \\\"4471-EU\\\""))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            Assert.AreEqual(3, result.Groups.Count);
            Assert.AreEqual(4, result.TotalFailed);
            Assert.AreEqual(4, result.Scanned);
            Assert.IsFalse(result.Partial);
            Assert.AreEqual(1000, result.Cap);

            // The two inventory failures share a signature, the other two do not
            var inventory = result.Groups.First();
            Assert.AreEqual(2, inventory.Count);
            CollectionAssert.AreEquivalent(new[] { "order-1", "order-2" }, inventory.Instances.Select(i => i.InstanceId).ToArray());

            // The key is '{name}|{signature}', and the signature has the volatile parts starred out
            Assert.AreEqual(FailureSignature.GroupKey(inventory.Name, inventory.Signature), inventory.Key);
            Assert.AreEqual("ProcessOrderOrchestrator", inventory.Name);
            StringAssert.StartsWith(inventory.Signature, "InventoryUnavailable: SKU-*");
        }

        [TestMethod]
        public void TheSameMessageFromTwoOrchestratorsIsTwoGroups()
        {
            // Arrange

            var rows = new[]
            {
                Row("a-1", "AlphaOrchestrator", Error("Boom")),
                Row("b-1", "BetaOrchestrator", Error("Boom"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert: the orchestrator is part of the key - the same message from two of them is two problems

            Assert.AreEqual(2, result.Groups.Count);
        }

        [TestMethod]
        public void SortsGroupsByCountThenByMostRecentFailure()
        {
            // Arrange: 'Quiet' is older than 'Recent', both have two failures; 'Loud' has three

            var rows = new List<FailedInstanceRow>();
            for (int i = 0; i < 3; i++)
            {
                rows.Add(Row($"loud-{i}", "AlphaOrchestrator", Error("Loud"), lastUpdated: T("10:00:00")));
            }
            for (int i = 0; i < 2; i++)
            {
                rows.Add(Row($"quiet-{i}", "AlphaOrchestrator", Error("Quiet"), lastUpdated: T("09:00:00")));
            }
            for (int i = 0; i < 2; i++)
            {
                rows.Add(Row($"recent-{i}", "AlphaOrchestrator", Error("Recent"), lastUpdated: T("11:00:00")));
            }

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            CollectionAssert.AreEqual(
                new[] { "Loud", "Recent", "Quiet" },
                result.Groups.Select(g => g.Signature).ToArray());

            Assert.AreEqual(T("11:00:00"), result.Groups[1].LastSeenAt);
        }

        [TestMethod]
        public void ListsTheInstancesOfAGroupNewestFirst()
        {
            // Arrange

            var rows = new[]
            {
                Row("old", "AlphaOrchestrator", Error("Boom"), created: T("09:00:00")),
                Row("new", "AlphaOrchestrator", Error("Boom"), created: T("11:00:00")),
                Row("middle", "AlphaOrchestrator", Error("Boom"), created: T("10:00:00"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            CollectionAssert.AreEqual(
                new[] { "new", "middle", "old" },
                result.Groups.Single().Instances.Select(i => i.InstanceId).ToArray());
        }

        [TestMethod]
        public void CarriesAtMostFiveSampleIdsAndFiftyInstances()
        {
            // Arrange: 60 failures of the same kind

            var rows = Enumerable.Range(0, 60)
                .Select(i => Row($"order-{i:D3}", "AlphaOrchestrator", Error("Boom"), created: T("10:00:00").AddMinutes(i)))
                .ToList();

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert: the count is the whole group, the lists are bounded

            var group = result.Groups.Single();
            Assert.AreEqual(60, group.Count);
            Assert.AreEqual(FailuresAggregator.MaxSampleIds, group.SampleIds.Count);
            Assert.AreEqual(FailuresAggregator.MaxInstancesPerGroup, group.Instances.Count);

            // And both start at the newest instance
            Assert.AreEqual("order-059", group.SampleIds[0]);
            Assert.AreEqual("order-059", group.Instances[0].InstanceId);
        }

        [TestMethod]
        public void ARowReportsItsOwnMessageNotTheGroupSignature()
        {
            // Arrange

            var rows = new[]
            {
                Row("order-1", "ProcessOrderOrchestrator", Error("InventoryUnavailable: SKU-4471 has 0 units in warehouse-07"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert: the signature has the ids starred out, which is not what the user needs to see on a row

            var instance = result.Groups.Single().Instances.Single();
            Assert.AreEqual("InventoryUnavailable: SKU-4471 has 0 units in warehouse-07", instance.Reason);
            Assert.AreNotEqual(instance.Reason, result.Groups.Single().Signature);
        }

        [TestMethod]
        public void ComputesTheDurationFromCompletedTimeWhenThereIsOne()
        {
            // Arrange

            var rows = new[]
            {
                Row("order-1", "AlphaOrchestrator", Error("Boom"), created: T("10:00:00"), completed: T("10:00:20"), lastUpdated: T("10:05:00"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            var instance = result.Groups.Single().Instances.Single();
            Assert.AreEqual(20000d, instance.DurationMs);
            Assert.AreEqual(T("10:00:20"), instance.CompletedTime);
        }

        [TestMethod]
        public void FallsBackToLastUpdatedTimeForTheDuration()
        {
            // Arrange: a failed instance's row is written when it fails, so LastUpdatedTime is the best end

            var rows = new[]
            {
                Row("order-1", "AlphaOrchestrator", Error("Boom"), created: T("10:00:00"), completed: null, lastUpdated: T("10:00:30"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            var instance = result.Groups.Single().Instances.Single();
            Assert.AreEqual(30000d, instance.DurationMs);
            Assert.IsNull(instance.CompletedTime);
        }

        [TestMethod]
        public void ReportsANullDurationRatherThanANegativeOne()
        {
            // Arrange: clock skew between the workers that wrote the two timestamps

            var rows = new[]
            {
                Row("order-1", "AlphaOrchestrator", Error("Boom"), created: T("10:00:10"), completed: T("10:00:00"))
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            Assert.IsNull(result.Groups.Single().Instances.Single().DurationMs);
        }

        [TestMethod]
        public void RowsWithoutAnOutputGroupUnderNoMessage()
        {
            // Arrange: a terminated-then-failed instance can have an empty Output

            var rows = new[]
            {
                Row("order-1", "AlphaOrchestrator", null),
                Row("order-2", "AlphaOrchestrator", string.Empty)
            };

            // Act

            var result = FailuresAggregator.Group(rows, false, 1000);

            // Assert

            var group = result.Groups.Single();
            Assert.AreEqual(2, group.Count);
            Assert.AreEqual(FailureSignature.NoMessage, group.Signature);
        }

        [TestMethod]
        public void ReportsAPartialScanAsGiven()
        {
            // Act

            var result = FailuresAggregator.Group(new[] { Row("order-1", "AlphaOrchestrator", Error("Boom")) }, true, 10);

            // Assert: the numbers are a lower bound, and the response says so

            Assert.IsTrue(result.Partial);
            Assert.AreEqual(10, result.Cap);
        }

        [TestMethod]
        public void AnEmptyScanIsAnEmptyResult()
        {
            // Act

            var result = FailuresAggregator.Group(Array.Empty<FailedInstanceRow>(), false, 1000);

            // Assert

            Assert.AreEqual(0, result.Groups.Count);
            Assert.AreEqual(0, result.TotalFailed);
            Assert.AreEqual(0, result.Scanned);
        }

        #region Fixture helpers

        private static FailedInstanceRow Row(
            string instanceId,
            string name,
            string output,
            DateTimeOffset? created = null,
            DateTimeOffset? completed = null,
            DateTimeOffset? lastUpdated = null)
        {
            var createdTime = created ?? T("10:00:00");

            return new FailedInstanceRow
            {
                InstanceId = instanceId,
                Name = name,
                CreatedTime = createdTime,
                CompletedTime = completed,
                LastUpdatedTime = lastUpdated ?? completed ?? createdTime,
                Output = output
            };
        }

        /// <summary>An Output as the framework writes it for a failed orchestration.</summary>
        private static string Error(string message)
        {
            return "{\"ErrorType\":\"System.Exception\",\"ErrorMessage\":\"" + message + "\"}";
        }

        private static DateTimeOffset T(string timeOfDay)
        {
            return DateTimeOffset.Parse(
                "2026-09-04T" + timeOfDay + "Z",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal);
        }

        #endregion
    }
}
