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
    /// StatsAggregator is the pure function behind the Overview screen and the specification every storage
    /// provider has to reproduce (Azure Storage in B1-S2-T2, MSSQL in B1-S2-T4), so every rule of
    /// docs/plans/svelte-rewrite/00-shared-contracts.md section 6 (StatsResponse) is asserted here.
    ///
    /// Most tests run against one 40 row fixture (4 orchestrator names, 2 entities), whose expected numbers
    /// are hand-computed in BuildFortyRows below.
    /// </summary>
    [TestClass]
    public class StatsAggregatorTests
    {
        #region The 40 row fixture

        // The range the fixture is aggregated over: one full day split into four 6 hour bins.
        private static readonly DateTimeOffset From = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset To = new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero);

        // 'Now' is the end of the range, so with the default 60 minutes a Running row is stuck when it was
        // last updated before 23:00, and with the default 10 minutes a Pending row is old when it was
        // created before 23:50.
        private static readonly DateTimeOffset Now = To;

        private static DateTimeOffset At(int hour, int minute)
        {
            return From.AddHours(hour).AddMinutes(minute);
        }

        private static InstanceRowLite Terminal(string id, string name, string status, DateTimeOffset created, double durationMs)
        {
            return new InstanceRowLite
            {
                InstanceId = id,
                Name = name,
                RuntimeStatus = status,
                CreatedTime = created,
                CompletedTime = created.AddMilliseconds(durationMs),
                LastUpdatedTime = created.AddMilliseconds(durationMs)
            };
        }

        private static InstanceRowLite Open(string id, string name, string status, DateTimeOffset created, DateTimeOffset lastUpdated)
        {
            return new InstanceRowLite
            {
                InstanceId = id,
                Name = name,
                RuntimeStatus = status,
                CreatedTime = created,
                LastUpdatedTime = lastUpdated,
                CompletedTime = null
            };
        }

        /// <summary>
        /// 40 rows: 38 orchestrations across 4 names (Alpha 16, Beta 10, Gamma 7, Delta 5) in 5 statuses
        /// plus 2 Durable Entities.
        ///
        /// Expected, per bin (bin0 00:00-06:00, bin1 06:00-12:00, bin2 12:00-18:00, bin3 18:00-24:00):
        ///   bin0 11 = Completed 8, Running 1, Failed 1, Suspended 1
        ///   bin1 12 = Completed 8, Failed 2, Running 1, Suspended 1
        ///   bin2  8 = Completed 3, Failed 2, Running 3
        ///   bin3  7 = Failed 2, Running 3, Pending 2
        /// Totals: Completed 19, Failed 7, Running 8, Pending 2, Suspended 2, all 38, entities 2.
        /// </summary>
        private static List<InstanceRowLite> BuildFortyRows()
        {
            return new List<InstanceRowLite>
            {
                // Alpha: 10 Completed (durations 1000..10000 ms), 4 Failed (11000..14000 ms), 2 Running.
                // The 14 terminal durations sorted are 1000, 2000, ... 14000, so nearest-rank
                // p50 = value 7 = 7000 and p95 = value ceil(0.95 * 14) = 14 = 14000.
                Terminal("a01", "Alpha", "Completed", At(0, 30), 1000),
                Terminal("a02", "Alpha", "Completed", At(1, 30), 2000),
                Terminal("a03", "Alpha", "Completed", At(2, 30), 3000),
                Terminal("a04", "Alpha", "Completed", At(3, 30), 4000),
                Terminal("a05", "Alpha", "Completed", At(4, 30), 5000),
                Terminal("a06", "Alpha", "Completed", At(6, 30), 6000),
                Terminal("a07", "Alpha", "Completed", At(7, 30), 7000),
                Terminal("a08", "Alpha", "Completed", At(8, 30), 8000),
                Terminal("a09", "Alpha", "Completed", At(9, 30), 9000),
                Terminal("a10", "Alpha", "Completed", At(10, 30), 10000),
                Terminal("a11", "Alpha", "Failed", At(12, 30), 11000),
                Terminal("a12", "Alpha", "Failed", At(13, 30), 12000),
                Terminal("a13", "Alpha", "Failed", At(18, 30), 13000),
                Terminal("a14", "Alpha", "Failed", At(19, 30), 14000),
                Open("a15", "Alpha", "Running", At(20, 30), At(23, 10)),
                Open("a16", "Alpha", "Running", At(21, 30), At(23, 20)),

                // Beta: 6 Completed (500..5500 ms), 2 Failed (6500, 7500 ms), 2 Pending.
                // 8 terminal durations, so p50 = value 4 = 3500 and p95 = value 8 = 7500.
                Terminal("b01", "Beta", "Completed", At(1, 0), 500),
                Terminal("b02", "Beta", "Completed", At(2, 0), 1500),
                Terminal("b03", "Beta", "Completed", At(7, 0), 2500),
                Terminal("b04", "Beta", "Completed", At(8, 0), 3500),
                Terminal("b05", "Beta", "Completed", At(13, 0), 4500),
                Terminal("b06", "Beta", "Completed", At(14, 0), 5500),
                Terminal("b07", "Beta", "Failed", At(9, 0), 6500),
                Terminal("b08", "Beta", "Failed", At(10, 0), 7500),
                Open("b09", "Beta", "Pending", At(22, 0), At(22, 0)),
                Open("b10", "Beta", "Pending", At(23, 0), At(23, 0)),

                // Gamma: 3 Completed (100, 200, 300 ms) and 4 Running, three of which are stuck.
                // 3 terminal durations, so p50 = value 2 = 200 and p95 = value 3 = 300.
                Terminal("g01", "Gamma", "Completed", At(3, 0), 100),
                Terminal("g02", "Gamma", "Completed", At(11, 0), 200),
                Terminal("g03", "Gamma", "Completed", At(15, 0), 300),
                Open("g04", "Gamma", "Running", At(4, 0), At(4, 10)),
                Open("g05", "Gamma", "Running", At(11, 30), At(11, 40)),
                Open("g06", "Gamma", "Running", At(16, 0), At(22, 0)),
                Open("g07", "Gamma", "Running", At(17, 0), At(23, 30)),

                // Delta: 1 Failed that never got a CompletedTime (so no duration at all: p50/p95 null),
                // 2 Suspended and 2 Running.
                Open("d01", "Delta", "Failed", At(5, 0), At(5, 20)),
                Open("d02", "Delta", "Suspended", At(5, 30), At(5, 45)),
                Open("d03", "Delta", "Suspended", At(6, 0), At(6, 15)),
                Open("d04", "Delta", "Running", At(12, 0), At(12, 10)),
                Open("d05", "Delta", "Running", At(23, 30), At(23, 40)),

                // Two Durable Entities. Their Name column holds the entity *function* name on purpose:
                // entitiesByName must report the '@name@' part of the instance id instead. Their status is
                // Running, so counting them anywhere but totals.entities would show up immediately.
                Open("@counter@a", "CounterEntityFunction", "Running", At(2, 0), At(2, 5)),
                Open("@counter@b", "CounterEntityFunction", "Running", At(3, 0), At(3, 5))
            };
        }

        private static StatsQuery FixtureQuery()
        {
            return new StatsQuery { From = From, To = To, Bins = 4, Cap = 50000 };
        }

        private static StatsResult AggregateFixture()
        {
            return StatsAggregator.Aggregate(BuildFortyRows(), FixtureQuery(), Now, false, 50000);
        }

        private static StatsByName ByName(StatsResult result, string name)
        {
            return result.ByName.Single(n => n.Name == name);
        }

        private static void AssertCounts(StatusCounts actual, params (string Status, int Count)[] expected)
        {
            Assert.AreEqual(expected.Length, actual.Count, "statuses present: " + string.Join(", ", actual.Keys));

            foreach (var pair in expected)
            {
                Assert.IsTrue(actual.ContainsKey(pair.Status), "missing status " + pair.Status);
                Assert.AreEqual(pair.Count, actual[pair.Status], "status " + pair.Status);
            }
        }

        #endregion

        #region The 40 row fixture - acceptance

        [TestMethod]
        public void Aggregate_FortyRowFixture_ProducesExpectedTotals()
        {
            var result = AggregateFixture();

            Assert.AreEqual(38, result.Totals["all"]);
            Assert.AreEqual(2, result.Totals["entities"]);
            Assert.AreEqual(19, result.Totals["Completed"]);
            Assert.AreEqual(7, result.Totals["Failed"]);
            Assert.AreEqual(8, result.Totals["Running"]);
            Assert.AreEqual(2, result.Totals["Pending"]);
            Assert.AreEqual(2, result.Totals["Suspended"]);

            // Statuses nobody is in are absent, not zero.
            Assert.IsFalse(result.Totals.ContainsKey("Terminated"));
            Assert.IsFalse(result.Totals.ContainsKey("Canceled"));
            Assert.IsFalse(result.Totals.ContainsKey("ContinuedAsNew"));
            Assert.AreEqual(7, result.Totals.Count);

            Assert.AreEqual(From, result.From);
            Assert.AreEqual(To, result.To);
            Assert.AreEqual(4, result.BinCount);
        }

        [TestMethod]
        public void Aggregate_FortyRowFixture_ProducesExpectedBins()
        {
            var result = AggregateFixture();

            Assert.AreEqual(4, result.Bins.Count);

            Assert.AreEqual(At(0, 0), result.Bins[0].Start);
            Assert.AreEqual(At(6, 0), result.Bins[0].End);
            Assert.AreEqual(At(6, 0), result.Bins[1].Start);
            Assert.AreEqual(At(12, 0), result.Bins[1].End);
            Assert.AreEqual(At(12, 0), result.Bins[2].Start);
            Assert.AreEqual(At(18, 0), result.Bins[2].End);
            Assert.AreEqual(At(18, 0), result.Bins[3].Start);
            Assert.AreEqual(To, result.Bins[3].End);

            AssertCounts(result.Bins[0].Counts, ("Completed", 8), ("Running", 1), ("Failed", 1), ("Suspended", 1));
            AssertCounts(result.Bins[1].Counts, ("Completed", 8), ("Failed", 2), ("Running", 1), ("Suspended", 1));
            AssertCounts(result.Bins[2].Counts, ("Completed", 3), ("Failed", 2), ("Running", 3));
            AssertCounts(result.Bins[3].Counts, ("Failed", 2), ("Running", 3), ("Pending", 2));

            // Every orchestration row, and only those, landed in a bin.
            Assert.AreEqual(38, result.Bins.Sum(b => b.Counts.Values.Sum()));
        }

        [TestMethod]
        public void Aggregate_FortyRowFixture_ProducesExpectedByNameAndPercentiles()
        {
            var result = AggregateFixture();

            Assert.AreEqual(4, result.ByName.Count);

            // Sorted by Started descending.
            CollectionAssert.AreEqual(
                new[] { "Alpha", "Beta", "Gamma", "Delta" },
                result.ByName.Select(n => n.Name).ToArray());

            var alpha = ByName(result, "Alpha");
            Assert.AreEqual(16, alpha.Started);
            Assert.AreEqual(10, alpha.Completed);
            Assert.AreEqual(4, alpha.Failed);
            Assert.AreEqual(2, alpha.Running);
            Assert.AreEqual(4d / 14d, alpha.FailureRate, 1e-12);
            Assert.AreEqual(7000d, alpha.P50Ms.Value, 1e-9);
            Assert.AreEqual(14000d, alpha.P95Ms.Value, 1e-9);
            Assert.AreEqual(At(19, 30).AddMilliseconds(14000), alpha.LastFailedAt);

            var beta = ByName(result, "Beta");
            Assert.AreEqual(10, beta.Started);
            Assert.AreEqual(6, beta.Completed);
            Assert.AreEqual(2, beta.Failed);
            // The 2 Pending rows count as 'running'.
            Assert.AreEqual(2, beta.Running);
            Assert.AreEqual(0.25d, beta.FailureRate, 1e-12);
            Assert.AreEqual(3500d, beta.P50Ms.Value, 1e-9);
            Assert.AreEqual(7500d, beta.P95Ms.Value, 1e-9);
            Assert.AreEqual(At(10, 0).AddMilliseconds(7500), beta.LastFailedAt);

            var gamma = ByName(result, "Gamma");
            Assert.AreEqual(7, gamma.Started);
            Assert.AreEqual(3, gamma.Completed);
            Assert.AreEqual(0, gamma.Failed);
            Assert.AreEqual(4, gamma.Running);
            Assert.AreEqual(0d, gamma.FailureRate, 1e-12);
            Assert.AreEqual(200d, gamma.P50Ms.Value, 1e-9);
            Assert.AreEqual(300d, gamma.P95Ms.Value, 1e-9);
            Assert.IsNull(gamma.LastFailedAt);

            var delta = ByName(result, "Delta");
            Assert.AreEqual(5, delta.Started);
            Assert.AreEqual(0, delta.Completed);
            Assert.AreEqual(1, delta.Failed);
            // 2 Running + 2 Suspended.
            Assert.AreEqual(4, delta.Running);
            Assert.AreEqual(1d, delta.FailureRate, 1e-12);
            // Its only terminal row has no CompletedTime, so there is no duration to take a percentile of.
            Assert.IsNull(delta.P50Ms);
            Assert.IsNull(delta.P95Ms);
            Assert.AreEqual(At(5, 20), delta.LastFailedAt);

            // The entity function name never becomes an orchestrator.
            Assert.IsFalse(result.ByName.Any(n => n.Name == "CounterEntityFunction"));
        }

        [TestMethod]
        public void Aggregate_FortyRowFixture_ProducesExpectedEntities()
        {
            var result = AggregateFixture();

            Assert.AreEqual(1, result.EntitiesByName.Count);
            Assert.AreEqual("counter", result.EntitiesByName[0].Name);
            Assert.AreEqual(2, result.EntitiesByName[0].Count);
        }

        [TestMethod]
        public void Aggregate_FortyRowFixture_ProducesExpectedStuckPendingAndSuspendedSets()
        {
            var result = AggregateFixture();

            // Running rows last updated before 23:00: g04 (04:10), g05 (11:40), d04 (12:10), g06 (22:00).
            Assert.AreEqual(4, result.Stuck.Count);
            Assert.AreEqual(At(4, 10), result.Stuck.OldestLastUpdatedAt);
            CollectionAssert.AreEqual(new[] { "g04", "g05", "d04", "g06" }, result.Stuck.SampleIds.ToArray());

            // Pending rows created before 23:50: b09 (22:00), b10 (23:00).
            Assert.AreEqual(2, result.OldestPending.Count);
            Assert.AreEqual(At(22, 0), result.OldestPending.OldestCreatedAt);
            CollectionAssert.AreEqual(new[] { "b09", "b10" }, result.OldestPending.SampleIds.ToArray());

            // Every Suspended row, no threshold.
            Assert.AreEqual(2, result.Suspended.Count);
            Assert.AreEqual(At(5, 45), result.Suspended.OldestLastUpdatedAt);
            CollectionAssert.AreEqual(new[] { "d02", "d03" }, result.Suspended.SampleIds.ToArray());
        }

        [TestMethod]
        public void Aggregate_FortyRowFixture_PassesScannedPartialAndCapThrough()
        {
            var notTruncated = StatsAggregator.Aggregate(BuildFortyRows(), FixtureQuery(), Now, false, 50000);

            Assert.AreEqual(40, notTruncated.Scanned);
            Assert.IsFalse(notTruncated.Partial);
            Assert.AreEqual(50000, notTruncated.Cap);

            var truncated = StatsAggregator.Aggregate(BuildFortyRows(), FixtureQuery(), Now, true, 40);

            // Scanned counts entity rows too: it is how many rows the provider read.
            Assert.AreEqual(40, truncated.Scanned);
            Assert.IsTrue(truncated.Partial);
            Assert.AreEqual(40, truncated.Cap);
        }

        [TestMethod]
        public void Aggregate_GeneratedAt_IsTheSuppliedNow()
        {
            var result = AggregateFixture();

            Assert.AreEqual(Now, result.GeneratedAt);
            Assert.AreEqual(0, result.ElapsedMs);
            Assert.IsFalse(result.Cached);
        }

        #endregion

        #region Empty input

        [TestMethod]
        public void Aggregate_NoRows_ReturnsZeroTotalsAndEmptyBins()
        {
            var result = StatsAggregator.Aggregate(new List<InstanceRowLite>(), FixtureQuery(), Now, false, 50000);

            Assert.AreEqual(2, result.Totals.Count);
            Assert.AreEqual(0, result.Totals["all"]);
            Assert.AreEqual(0, result.Totals["entities"]);

            Assert.AreEqual(4, result.Bins.Count);
            Assert.IsTrue(result.Bins.All(b => b.Counts.Count == 0));
            Assert.AreEqual(At(0, 0), result.Bins[0].Start);
            Assert.AreEqual(To, result.Bins[3].End);

            Assert.AreEqual(0, result.ByName.Count);
            Assert.AreEqual(0, result.EntitiesByName.Count);

            Assert.AreEqual(0, result.Stuck.Count);
            Assert.IsNull(result.Stuck.OldestLastUpdatedAt);
            Assert.AreEqual(0, result.Stuck.SampleIds.Count);

            Assert.AreEqual(0, result.OldestPending.Count);
            Assert.IsNull(result.OldestPending.OldestCreatedAt);
            Assert.AreEqual(0, result.OldestPending.SampleIds.Count);

            Assert.AreEqual(0, result.Suspended.Count);
            Assert.IsNull(result.Suspended.OldestLastUpdatedAt);
            Assert.AreEqual(0, result.Suspended.SampleIds.Count);

            Assert.AreEqual(0, result.Scanned);
            Assert.IsFalse(result.Partial);
        }

        [TestMethod]
        public void Aggregate_NullRows_IsTreatedAsEmpty()
        {
            var result = StatsAggregator.Aggregate(null, FixtureQuery(), Now, false, 50000);

            Assert.AreEqual(0, result.Scanned);
            Assert.AreEqual(0, result.Totals["all"]);
            Assert.AreEqual(4, result.Bins.Count);
        }

        [TestMethod]
        public void Aggregate_NullQuery_Throws()
        {
            Assert.ThrowsExactly<ArgumentNullException>(
                () => StatsAggregator.Aggregate(new List<InstanceRowLite>(), null, Now, false, 0));
        }

        #endregion

        #region Bin boundaries

        [TestMethod]
        public void Aggregate_BinBoundaries_LeftEdgeInclusiveRightEdgeExclusiveLastBinClosed()
        {
            // Two 1 hour bins over [00:00, 02:00].
            var query = new StatsQuery { From = From, To = From.AddHours(2), Bins = 2 };

            var rows = new List<InstanceRowLite>
            {
                Open("at-from", "N", "Running", From, From),
                Open("just-before-edge", "N", "Running", From.AddHours(1).AddTicks(-1), From),
                Open("at-edge", "N", "Running", From.AddHours(1), From),
                Open("just-before-to", "N", "Running", From.AddHours(2).AddTicks(-1), From),
                Open("at-to", "N", "Running", From.AddHours(2), From)
            };

            var result = StatsAggregator.Aggregate(rows, query, Now, false, 0);

            Assert.AreEqual(2, result.Bins[0].Counts["Running"]);
            Assert.AreEqual(3, result.Bins[1].Counts["Running"]);
            Assert.AreEqual(5, result.Totals["all"]);
        }

        [TestMethod]
        public void Aggregate_RowsOutsideTheRange_CountInTotalsButNotInBins()
        {
            var query = new StatsQuery { From = From, To = From.AddHours(2), Bins = 2 };

            var rows = new List<InstanceRowLite>
            {
                Open("before", "N", "Running", From.AddTicks(-1), From),
                Open("inside", "N", "Running", From.AddMinutes(30), From),
                Open("after", "N", "Running", From.AddHours(2).AddTicks(1), From)
            };

            var result = StatsAggregator.Aggregate(rows, query, Now, false, 0);

            Assert.AreEqual(3, result.Totals["all"]);
            Assert.AreEqual(3, result.Scanned);
            Assert.AreEqual(1, result.Bins.Sum(b => b.Counts.Values.Sum()));
            Assert.AreEqual(1, result.Bins[0].Counts["Running"]);
            Assert.AreEqual(0, result.Bins[1].Counts.Count);
        }

        [TestMethod]
        public void Aggregate_MaximumRangeAndBins_PlacesEdgeRowsInTheRightBin()
        {
            // 92 days x 366 bins is where naive tick arithmetic overflows a long, so the edges of a few
            // buckets are checked explicitly.
            var to = From.AddDays(92);
            var query = new StatsQuery { From = From, To = to, Bins = 366 };

            long span = (to - From).Ticks;
            var rows = new List<InstanceRowLite>();
            var expectedBins = new[] { 0, 1, 42, 200, 365 };

            foreach (int bin in expectedBins)
            {
                var start = From.AddTicks((long)((decimal)span * bin / 366));
                rows.Add(Open("bin-" + bin, "N", "Running", start, From));
            }

            var result = StatsAggregator.Aggregate(rows, query, Now, false, 0);

            Assert.AreEqual(366, result.Bins.Count);
            Assert.AreEqual(From, result.Bins[0].Start);
            Assert.AreEqual(to, result.Bins[365].End);

            foreach (int bin in expectedBins)
            {
                Assert.AreEqual(1, result.Bins[bin].Counts["Running"], "bin " + bin);
            }

            Assert.AreEqual(expectedBins.Length, result.Bins.Sum(b => b.Counts.Values.Sum()));

            // The bins tile the range with no gaps and no overlap.
            for (int i = 1; i < result.Bins.Count; i++)
            {
                Assert.AreEqual(result.Bins[i - 1].End, result.Bins[i].Start);
            }
        }

        [TestMethod]
        public void Aggregate_DefaultQuery_Uses48Bins()
        {
            var result = StatsAggregator.Aggregate(
                new List<InstanceRowLite>(), new StatsQuery { From = From, To = To }, Now, false, 0);

            Assert.AreEqual(48, result.BinCount);
            Assert.AreEqual(48, result.Bins.Count);
        }

        [TestMethod]
        public void Aggregate_BinsOutOfBounds_AreClamped()
        {
            var tooMany = StatsAggregator.Aggregate(
                new List<InstanceRowLite>(), new StatsQuery { From = From, To = To, Bins = 5000 }, Now, false, 0);
            Assert.AreEqual(StatsAggregator.MaxBins, tooMany.BinCount);

            var tooFew = StatsAggregator.Aggregate(
                new List<InstanceRowLite>(), new StatsQuery { From = From, To = To, Bins = 0 }, Now, false, 0);
            Assert.AreEqual(1, tooFew.BinCount);
        }

        [TestMethod]
        public void Aggregate_EmptyRange_DoesNotThrow()
        {
            var query = new StatsQuery { From = From, To = From, Bins = 4 };

            var result = StatsAggregator.Aggregate(
                new List<InstanceRowLite> { Open("x", "N", "Running", From, From) }, query, Now, false, 0);

            Assert.AreEqual(4, result.Bins.Count);
            Assert.IsTrue(result.Bins.All(b => b.Start == From && b.End == From));
            Assert.AreEqual(1, result.Totals["all"]);
            Assert.AreEqual(1, result.Bins.Sum(b => b.Counts.Values.Sum()));
        }

        #endregion

        #region Statuses

        [TestMethod]
        public void Aggregate_UnknownStatus_DoesNotThrowAndKeepsTheValue()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("x", "N", "Bizarre", From.AddMinutes(1), From),
                Open("y", "N", "Completed", From.AddMinutes(2), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(1, result.Totals["Bizarre"]);
            Assert.AreEqual(2, result.Totals["all"]);
            Assert.AreEqual(1, result.Bins[0].Counts["Bizarre"]);

            var byName = ByName(result, "N");
            Assert.AreEqual(2, byName.Started);
            // An unknown status is neither completed, nor failed, nor running.
            Assert.AreEqual(1, byName.Completed);
            Assert.AreEqual(0, byName.Failed);
            Assert.AreEqual(0, byName.Running);
        }

        [TestMethod]
        public void Aggregate_MissingStatus_CountsAsUnknown()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("x", "N", null, From.AddMinutes(1), From),
                Open("y", "N", "   ", From.AddMinutes(2), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(2, result.Totals[StatsAggregator.UnknownStatus]);
            Assert.AreEqual(2, result.Totals["all"]);
        }

        [TestMethod]
        public void Aggregate_DifferentlyCasedStatus_CountsUnderTheCanonicalName()
        {
            var rows = new List<InstanceRowLite>
            {
                Terminal("x", "N", "completed", From.AddMinutes(1), 1000),
                Terminal("y", "N", "COMPLETED", From.AddMinutes(2), 3000),
                Open("z", "N", "continuedasnew", From.AddMinutes(3), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(2, result.Totals["Completed"]);
            Assert.AreEqual(1, result.Totals["ContinuedAsNew"]);
            Assert.IsFalse(result.Totals.ContainsKey("completed"));

            var byName = ByName(result, "N");
            Assert.AreEqual(2, byName.Completed);
            Assert.AreEqual(1, byName.Running);
        }

        [TestMethod]
        public void NormalizeStatus_CanonicalisesKnownValuesAndPassesOthersThrough()
        {
            Assert.AreEqual("Completed", StatsAggregator.NormalizeStatus(" completed "));
            Assert.AreEqual("ContinuedAsNew", StatsAggregator.NormalizeStatus("CONTINUEDASNEW"));
            Assert.AreEqual("Terminated", StatsAggregator.NormalizeStatus("Terminated"));
            Assert.AreEqual("Canceled", StatsAggregator.NormalizeStatus("canceled"));
            Assert.AreEqual("Whatever", StatsAggregator.NormalizeStatus("Whatever"));
            Assert.AreEqual(StatsAggregator.UnknownStatus, StatsAggregator.NormalizeStatus(null));
            Assert.AreEqual(StatsAggregator.UnknownStatus, StatsAggregator.NormalizeStatus(""));
        }

        #endregion

        #region Entities

        [TestMethod]
        public void Aggregate_EntityRows_CountOnlyIntoEntitiesAndEntitiesByName()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("@counter@a", "CounterEntity", "Running", From.AddMinutes(1), From),
                Open("@counter@b", "CounterEntity", "Running", From.AddMinutes(2), From),
                Open("@cart@u1", "CartEntity", "Running", From.AddMinutes(3), From),
                Open("@basket@u2", "BasketEntity", "Running", From.AddMinutes(4), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(0, result.Totals["all"]);
            Assert.AreEqual(4, result.Totals["entities"]);
            Assert.AreEqual(2, result.Totals.Count);

            Assert.AreEqual(0, result.Bins.Sum(b => b.Counts.Values.Sum()));
            Assert.AreEqual(0, result.ByName.Count);
            Assert.AreEqual(0, result.Stuck.Count);
            Assert.AreEqual(0, result.Suspended.Count);
            Assert.AreEqual(4, result.Scanned);

            // Sorted by Count descending, then by name.
            CollectionAssert.AreEqual(
                new[] { "counter", "basket", "cart" },
                result.EntitiesByName.Select(e => e.Name).ToArray());
            CollectionAssert.AreEqual(new[] { 2, 1, 1 }, result.EntitiesByName.Select(e => e.Count).ToArray());
        }

        #endregion

        #region Stuck, pending and suspended thresholds

        [TestMethod]
        public void Aggregate_StuckThreshold_IsStrictlyOlderThanNowMinusStuckAfterMinutes()
        {
            var query = new StatsQuery { From = From, To = To, Bins = 4, StuckAfterMinutes = 30 };
            var threshold = Now.AddMinutes(-30);

            var rows = new List<InstanceRowLite>
            {
                Open("older", "N", "Running", From, threshold.AddTicks(-1)),
                Open("exactly-at", "N", "Running", From, threshold),
                Open("newer", "N", "Running", From, threshold.AddTicks(1)),
                // Not Running, so never stuck however old it is.
                Open("pending", "N", "Pending", From, threshold.AddMinutes(-60))
            };

            var result = StatsAggregator.Aggregate(rows, query, Now, false, 0);

            Assert.AreEqual(1, result.Stuck.Count);
            CollectionAssert.AreEqual(new[] { "older" }, result.Stuck.SampleIds.ToArray());
            Assert.AreEqual(threshold.AddTicks(-1), result.Stuck.OldestLastUpdatedAt);
        }

        [TestMethod]
        public void Aggregate_PendingThreshold_IsStrictlyOlderThanNowMinusPendingAfterMinutes()
        {
            var query = new StatsQuery { From = From, To = To, Bins = 4, PendingAfterMinutes = 15 };
            var threshold = Now.AddMinutes(-15);

            var rows = new List<InstanceRowLite>
            {
                Open("older", "N", "Pending", threshold.AddTicks(-1), Now),
                Open("exactly-at", "N", "Pending", threshold, Now),
                Open("newer", "N", "Pending", threshold.AddTicks(1), Now),
                // Not Pending.
                Open("running", "N", "Running", From, Now)
            };

            var result = StatsAggregator.Aggregate(rows, query, Now, false, 0);

            Assert.AreEqual(1, result.OldestPending.Count);
            CollectionAssert.AreEqual(new[] { "older" }, result.OldestPending.SampleIds.ToArray());
            Assert.AreEqual(threshold.AddTicks(-1), result.OldestPending.OldestCreatedAt);
        }

        [TestMethod]
        public void Aggregate_DefaultThresholds_Are60And10Minutes()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("stuck", "N", "Running", From, Now.AddMinutes(-61)),
                Open("not-stuck", "N", "Running", From, Now.AddMinutes(-59)),
                Open("old-pending", "N", "Pending", Now.AddMinutes(-11), Now),
                Open("fresh-pending", "N", "Pending", Now.AddMinutes(-9), Now)
            };

            var result = StatsAggregator.Aggregate(rows, new StatsQuery { From = From, To = To }, Now, false, 0);

            CollectionAssert.AreEqual(new[] { "stuck" }, result.Stuck.SampleIds.ToArray());
            CollectionAssert.AreEqual(new[] { "old-pending" }, result.OldestPending.SampleIds.ToArray());
        }

        [TestMethod]
        public void Aggregate_MoreThanTenStuckRows_ReportsFullCountButOnlyTenSampleIds()
        {
            var rows = new List<InstanceRowLite>();
            for (int i = 0; i < 14; i++)
            {
                // i = 0 is the oldest.
                rows.Add(Open("s" + i.ToString("00"), "N", "Running", From, Now.AddHours(-13).AddMinutes(i)));
            }

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(14, result.Stuck.Count);
            Assert.AreEqual(StatsAggregator.MaxSampleIds, result.Stuck.SampleIds.Count);
            // The oldest ones first.
            CollectionAssert.AreEqual(
                new[] { "s00", "s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09" },
                result.Stuck.SampleIds.ToArray());
            Assert.AreEqual(Now.AddHours(-13), result.Stuck.OldestLastUpdatedAt);
        }

        #endregion

        #region Per-name aggregates

        [TestMethod]
        public void Aggregate_SingleTerminalRow_P50AndP95AreItsDuration()
        {
            var rows = new List<InstanceRowLite> { Terminal("x", "N", "Completed", From.AddMinutes(1), 1234) };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(1234d, ByName(result, "N").P50Ms.Value, 1e-9);
            Assert.AreEqual(1234d, ByName(result, "N").P95Ms.Value, 1e-9);
        }

        [TestMethod]
        public void Aggregate_TwentyDurations_P95IsTheNineteenthValue()
        {
            // ceil(20 * 0.95) is 19; computing it in binary floating point can give 20 instead, which is
            // what the integer rank arithmetic in the aggregator avoids.
            var rows = new List<InstanceRowLite>();
            for (int i = 1; i <= 20; i++)
            {
                rows.Add(Terminal("x" + i, "N", "Completed", From.AddMinutes(i), i * 1000));
            }

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(10000d, ByName(result, "N").P50Ms.Value, 1e-9);
            Assert.AreEqual(19000d, ByName(result, "N").P95Ms.Value, 1e-9);
        }

        [TestMethod]
        public void Aggregate_NoTerminalRows_LeavesPercentilesNull()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("x", "N", "Running", From.AddMinutes(1), From),
                Open("y", "N", "Pending", From.AddMinutes(2), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            var byName = ByName(result, "N");
            Assert.IsNull(byName.P50Ms);
            Assert.IsNull(byName.P95Ms);
            Assert.IsNull(byName.LastFailedAt);
            // failed / max(1, completed + failed) never divides by zero.
            Assert.AreEqual(0d, byName.FailureRate, 1e-12);
        }

        [TestMethod]
        public void Aggregate_PercentilesUseTerminalRowsOfBothCompletedAndFailed()
        {
            var rows = new List<InstanceRowLite>
            {
                Terminal("c1", "N", "Completed", From.AddMinutes(1), 1000),
                Terminal("c2", "N", "Completed", From.AddMinutes(2), 2000),
                Terminal("f1", "N", "Failed", From.AddMinutes(3), 3000),
                // Running rows have no CompletedTime and never contribute a duration.
                Open("r1", "N", "Running", From.AddMinutes(4), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            var byName = ByName(result, "N");
            Assert.AreEqual(2000d, byName.P50Ms.Value, 1e-9);
            Assert.AreEqual(3000d, byName.P95Ms.Value, 1e-9);
            Assert.AreEqual(1d / 3d, byName.FailureRate, 1e-12);
        }

        [TestMethod]
        public void Aggregate_ByName_SortedByStartedDescendingThenByName()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("z1", "Zeta", "Running", From.AddMinutes(1), From),
                Open("a1", "Aleph", "Running", From.AddMinutes(2), From),
                Open("m1", "Mu", "Running", From.AddMinutes(3), From),
                Open("m2", "Mu", "Running", From.AddMinutes(4), From)
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            CollectionAssert.AreEqual(
                new[] { "Mu", "Aleph", "Zeta" },
                result.ByName.Select(n => n.Name).ToArray());
        }

        [TestMethod]
        public void Aggregate_LastFailedAt_IsTheNewestFailedLastUpdatedTime()
        {
            var rows = new List<InstanceRowLite>
            {
                Open("f1", "N", "Failed", From.AddMinutes(1), At(3, 0)),
                Open("f2", "N", "Failed", From.AddMinutes(2), At(9, 0)),
                Open("f3", "N", "Failed", From.AddMinutes(3), At(6, 0)),
                // A newer non-failed row must not move it.
                Open("r1", "N", "Running", From.AddMinutes(4), At(20, 0))
            };

            var result = StatsAggregator.Aggregate(rows, FixtureQuery(), Now, false, 0);

            Assert.AreEqual(At(9, 0), ByName(result, "N").LastFailedAt);
        }

        #endregion
    }
}
